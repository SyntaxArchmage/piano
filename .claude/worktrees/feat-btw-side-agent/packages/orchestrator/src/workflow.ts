import { load } from "js-yaml";
import { Effect } from "effect";
import { isAbsolute } from "node:path";
import {
  configuredWorkflowHarness,
  HARNESS_NAMES,
  harnessToolNames,
  isHarnessName,
  THINKING_LEVELS,
  toolGrantsCapability,
  unknownToolNames,
  type HarnessName,
  type ThinkingLevel,
} from "@piano/harness";
import { isContractName, knownContractNames } from "@piano/contract";
import { WorkflowError, errorMessage, workflowError } from "./errors.js";

export type WorkflowHarness = HarnessName;
/** The canonical in-process agent harness. */
export const PI_WORKFLOW_HARNESS = "pi";

export interface WorkflowStage {
  readonly name: string;
  readonly worker: string;
  readonly handoff?: string;
  /** `true` loads the worker-owned contract.json. String values are a
   * deprecated compatibility path for the source-defined validator registry. */
  readonly validate?: true | string;
  readonly from: readonly string[];
  readonly harness: WorkflowHarness;
  readonly model?: string;
  /** Pi thinking/reasoning effort for this stage. */
  readonly thinkingLevel?: ThinkingLevel;
  readonly tools?: readonly string[];
  /** Gate each accepted attempt behind a human sign-off before the result is
   * published. The engine asks the run's signoff channel (Piano's own TUI);
   * a rejection resumes the same actor with the reviewer's feedback. */
  readonly signoff?: boolean;
  /** Whole-stage wall-clock cap in seconds. When exceeded the stage fails
   * (and its agent session is aborted). Guards against a single runaway agent
   * tool call (e.g. a filesystem-wide `find`) blocking the whole run with no
   * recovery point. Absent means the stage runs without a cap. */
  readonly timeout?: number;
}

/** A `loop` region: repeat child nodes `iterations` times, entry→exit.
 * `feedback`, when present, adds that direct child's prior-iteration accepted
 * result to the next iteration's entry inputs. */
export interface WorkflowLoop {
  readonly name: string;
  readonly from: readonly string[];
  readonly entry: string;
  readonly exit: string;
  readonly feedback?: string;
  readonly iterations: number;
  readonly nodes: readonly WorkflowNode[];
}

/** A `tournament` region: branch `count` instances over a field of a `from`
 * node, each branch in its own workspace. The exit stage decides (see
 * metric-arity requirements); the winning branch is merged back at region exit.
 * The internal runtime still refers to this region kind as `"map"` (a fan-out
 * tournament lane); the DSL literal is `tournament`. */
export interface WorkflowTournament {
  readonly name: string;
  readonly from: readonly string[];
  readonly over: string;
  readonly count: number;
  readonly entry: string;
  readonly exit: string;
  readonly nodes: readonly WorkflowNode[];
}

/** A workflow node is a stage, a loop region, or a tournament region. The
 * `map` DSL literal was renamed `tournament`; the internal type is kept named
 * `WorkflowTournament`. */
export type WorkflowNode =
  | { readonly stage: WorkflowStage }
  | { readonly loop: WorkflowLoop }
  | { readonly tournament: WorkflowTournament };

export interface WorkflowDocument {
  readonly version: 3;
  readonly workflow: {
    readonly name: string;
    /** Orchestrator-owned winner auto-commit (ISSUE-017): when true, the loop
     * executor commits each KEEP round's `changed_files` to the caller
     * workspace using the topsop-commit template (no push). Default false —
     * opt-in per workflow, so generic workflows are unaffected. */
    readonly autoCommit?: boolean;
    readonly nodes: readonly WorkflowNode[];
  };
}

/** A region plan surviving compile: iteration/fan-out controls + resolved boundaries. */
export interface WorkflowRegionPlan {
  readonly id: string;
  readonly name: string;
  readonly kind: "loop" | "map";
  readonly entry: string;
  readonly exit: string;
  readonly entryStageId: string;
  readonly exitStageId: string;
  readonly parentId?: string;
  readonly from: readonly string[];
  readonly iterations?: number;
  /** A loop direct-child name whose prior-iteration result feeds its entry. */
  readonly feedback?: string;
  readonly over?: string;
  readonly count?: number;
}

/** A leaf stage after lowering: dotted id, region path, and its stage. */
export interface CompiledStage {
  readonly id: string;
  readonly dependsOn: readonly string[];
  /** Ancestor region names (dotted segments) for stages inside a loop/map. */
  readonly regionPath: readonly string[];
  readonly stage: WorkflowStage;
}

export interface CompiledWorkflow {
  readonly name: string;
  readonly sourcePath: string;
  /** Leaf stages ordered by dependency (regions flattened into leaves). */
  readonly stages: readonly CompiledStage[];
  readonly regions: readonly WorkflowRegionPlan[];
  /** Orchestrator-owned winner auto-commit (ISSUE-017); see WorkflowDocument. */
  readonly autoCommit: boolean;
}

export interface ScheduledStage {
  readonly id: string;
  readonly order: number;
  readonly dependsOn: readonly string[];
  readonly stage: WorkflowStage;
  /** Non-empty for stages nested inside a loop/map region. */
  readonly regionPath?: readonly string[];
}

const DOCUMENT_KEYS = new Set(["version", "workflow"]);
const WORKFLOW_KEYS = new Set(["name", "nodes", "autoCommit"]);
const STAGE_KEYS = new Set([
  "name",
  "worker",
  "handoff",
  "validate",
  "from",
  "harness",
  "model",
  "thinkingLevel",
  "tools",
  "signoff",
  "timeout",
]);
const LOOP_KEYS = new Set(["name", "from", "entry", "exit", "feedback", "iterations", "nodes"]);
const TOURNAMENT_KEYS = new Set(["name", "from", "over", "count", "entry", "exit", "nodes"]);
const NODE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function fail(
  phase: "parse" | "compile" | "schedule",
  path: string,
  message: string,
): Effect.Effect<never, WorkflowError> {
  return Effect.fail(workflowError(phase, path, message));
}

function requiredString(
  value: unknown,
  field: string,
  path: string,
): Effect.Effect<string, WorkflowError> {
  if (typeof value !== "string" || value.trim() === "") {
    return fail("parse", path, `${field} must be a non-empty string`);
  }
  return Effect.succeed(value.trim());
}

function identifier(
  value: unknown,
  field: string,
  path: string,
): Effect.Effect<string, WorkflowError> {
  return requiredString(value, field, path).pipe(
    Effect.flatMap((name) => NODE_IDENTIFIER.test(name)
      ? Effect.succeed(name)
      : fail("parse", path, `${field} must be a simple workflow identifier`)),
  );
}

function identifierPath(
  value: unknown,
  field: string,
  path: string,
): Effect.Effect<string, WorkflowError> {
  return requiredString(value, field, path).pipe(
    Effect.flatMap((name) => {
      const segments = name.split(".");
      return segments.every((segment) => NODE_IDENTIFIER.test(segment))
        ? Effect.succeed(name)
        : fail("parse", path, `${field} must be a dotted identifier path`);
    }),
  );
}

function positiveInteger(
  value: unknown,
  field: string,
  path: string,
): Effect.Effect<number, WorkflowError> {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return fail("parse", path, `${field} must be a positive integer`);
  }
  return Effect.succeed(value);
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  section: string,
  path: string,
): Effect.Effect<void, WorkflowError> {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  return unknown === undefined
    ? Effect.void
    : fail("parse", path, `unknown field "${unknown}" in ${section}`);
}

function stringList(
  value: unknown,
  field: string,
  path: string,
): Effect.Effect<readonly string[], WorkflowError> {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    return fail("parse", path, `${field} must be an array of strings`);
  }
  const values = value.map((item) => (item as string).trim());
  return new Set(values).size === values.length
    ? Effect.succeed(values)
    : fail("parse", path, `${field} must not contain duplicate values`);
}

function optionalString(
  value: Record<string, unknown>,
  field: string,
  path: string,
): Effect.Effect<string | undefined, WorkflowError> {
  return value[field] === undefined
    ? Effect.succeed(undefined)
    : requiredString(value[field], `stage.${field}`, path);
}

function optionalValidation(
  value: Record<string, unknown>,
  path: string,
): Effect.Effect<true | string | undefined, WorkflowError> {
  const validate = value.validate;
  if (validate === undefined) return Effect.succeed(undefined);
  if (validate === true) return Effect.succeed(true);
  if (validate === false) {
    return fail("parse", path, "stage.validate must be true or omitted; false is equivalent to omitting it");
  }
  return requiredString(validate, "stage.validate", path);
}

function optionalBoolean(
  value: Record<string, unknown>,
  field: string,
  path: string,
): Effect.Effect<boolean, WorkflowError> {
  if (typeof value[field] !== "boolean") {
    return fail("parse", path, `${field} must be a boolean`);
  }
  return Effect.succeed(value[field] as boolean);
}

function optionalThinkingLevel(
  value: Record<string, unknown>,
  path: string,
): Effect.Effect<ThinkingLevel | undefined, WorkflowError> {
  if (value.thinkingLevel === undefined) return Effect.succeed(undefined);
  if (typeof value.thinkingLevel !== "string" || !(THINKING_LEVELS as readonly string[]).includes(value.thinkingLevel)) {
    return fail(
      "parse",
      path,
      `stage.thinkingLevel must be one of ${THINKING_LEVELS.join(", ")}`,
    );
  }
  return Effect.succeed(value.thinkingLevel as ThinkingLevel);
}

/** `handoff` is a logical file name beneath one invocation's private
 * orchestrator-owned context directory, never an arbitrary workspace path. */
function optionalHandoffPath(
  value: Record<string, unknown>,
  path: string,
): Effect.Effect<string | undefined, WorkflowError> {
  return optionalString(value, "handoff", path).pipe(
    Effect.flatMap((handoff) => {
      if (handoff === undefined) return Effect.succeed(undefined);
      const segments = handoff.split("/");
      if (isAbsolute(handoff) || /^[A-Za-z]:[\\/]/.test(handoff) ||
        segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
        return fail("parse", path, "stage.handoff must be a safe relative file path");
      }
      return Effect.succeed(handoff);
    }),
  );
}

function parseStage(
  value: unknown,
  path: string,
): Effect.Effect<WorkflowStage, WorkflowError> {
  const stage = record(value);
  if (stage === undefined) return fail("parse", path, "stage must be an object");
  return Effect.gen(function* () {
    if (stage.contract !== undefined) {
      return yield* fail(
        "parse",
        path,
        "stage.contract was renamed to stage.validate; use stage.handoff separately for upstream context",
      );
    }
    yield* rejectUnknown(stage, STAGE_KEYS, "stage", path);
    const name = yield* identifier(stage.name, "stage.name", path);
    const worker = yield* requiredString(stage.worker, "stage.worker", path);
    const handoff = yield* optionalHandoffPath(stage, path);
    const validate = yield* optionalValidation(stage, path);
    const from = yield* stringList(stage.from, "stage.from", path);
    const requestedHarness = stage.harness === undefined
      ? configuredWorkflowHarness()
      : yield* identifier(stage.harness, "stage.harness", path);
    if (!isHarnessName(requestedHarness)) {
      return yield* fail(
        "parse",
        path,
        `stage.harness must be one of ${HARNESS_NAMES.join(", ")}`,
      );
    }
    const model = yield* optionalString(stage, "model", path);
    const thinkingLevel = yield* optionalThinkingLevel(stage, path);
    const toolsValue = stage.tools === undefined
      ? undefined
      : yield* stringList(stage.tools, "stage.tools", path);
    if (toolsValue !== undefined) {
      const unknownTools = unknownToolNames(requestedHarness, toolsValue);
      if (unknownTools.length > 0) {
        return yield* fail(
          "parse",
          path,
          `stage.tools has unknown tool "${unknownTools.join('", "')}" for harness "${requestedHarness}". ` +
          `Tool names must match the harness's native tool ids exactly; valid names are: ${harnessToolNames(requestedHarness).join(", ")}. ` +
          "See the tool naming guide in README.md.",
        );
      }
    }
    if (stage.signoff !== undefined && typeof stage.signoff !== "boolean") {
      return yield* fail("parse", path, "stage.signoff must be a boolean");
    }
    const timeout = stage.timeout === undefined
      ? undefined
      : yield* positiveInteger(stage.timeout, "stage.timeout", path);
    return {
      name,
      worker,
      ...(handoff === undefined ? {} : { handoff }),
      ...(validate === undefined ? {} : { validate }),
      from,
      harness: requestedHarness,
      ...(model === undefined ? {} : { model }),
      ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
      ...(toolsValue === undefined ? {} : { tools: toolsValue }),
      ...(stage.signoff === undefined ? {} : { signoff: stage.signoff }),
      ...(timeout === undefined ? {} : { timeout }),
    };
  });
}

function parseLoop(
  value: unknown,
  path: string,
): Effect.Effect<WorkflowLoop, WorkflowError> {
  const region = record(value);
  if (region === undefined) return fail("parse", path, "loop must be an object");
  return Effect.gen(function* () {
    yield* rejectUnknown(region, LOOP_KEYS, "loop", path);
    const name = yield* identifier(region.name, "loop.name", path);
    const from = yield* stringList(region.from, "loop.from", path);
    const entry = yield* identifier(region.entry, "loop.entry", path);
    const exit = yield* identifier(region.exit, "loop.exit", path);
    const feedback = region.feedback === undefined
      ? undefined
      : yield* identifier(region.feedback, "loop.feedback", path);
    const iterations = yield* positiveInteger(region.iterations, "loop.iterations", path);
    const nodes = yield* parseNodes(region.nodes, path);
    return {
      name,
      from,
      entry,
      exit,
      ...(feedback === undefined ? {} : { feedback }),
      iterations,
      nodes,
    };
  });
}

function parseTournament(
  value: unknown,
  path: string,
): Effect.Effect<WorkflowTournament, WorkflowError> {
  const region = record(value);
  if (region === undefined) return fail("parse", path, "tournament must be an object");
  return Effect.gen(function* () {
    yield* rejectUnknown(region, TOURNAMENT_KEYS, "tournament", path);
    const name = yield* identifier(region.name, "tournament.name", path);
    const from = yield* stringList(region.from, "tournament.from", path);
    const over = yield* identifierPath(region.over, "tournament.over", path);
    const count = yield* positiveInteger(region.count, "tournament.count", path);
    const entry = yield* identifier(region.entry, "tournament.entry", path);
    const exit = yield* identifier(region.exit, "tournament.exit", path);
    const nodes = yield* parseNodes(region.nodes, path);
    return { name, from, over, count, entry, exit, nodes };
  });
}

function parseNode(
  value: unknown,
  path: string,
): Effect.Effect<WorkflowNode, WorkflowError> {
  const node = record(value);
  if (node === undefined) return fail("parse", path, "workflow node must be an object");
  const kinds = Object.keys(node).filter((key) => key === "stage" || key === "loop" || key === "map" || key === "tournament");
  if (kinds.length !== 1) {
    return fail("parse", path, "workflow node must contain exactly one of stage, loop, or tournament");
  }
  const kind = kinds[0];
  if (kind === "stage") return parseStage(node.stage, path).pipe(Effect.map((stage) => ({ stage })));
  if (kind === "loop") return parseLoop(node.loop, path).pipe(Effect.map((loop) => ({ loop })));
  if (kind === "map") {
    // `map` was the pre-preview literal for fan-out; it is renamed `tournament`.
    return fail("parse", path, "workflow node key \"map\" was renamed to \"tournament\"");
  }
  return parseTournament(node.tournament, path).pipe(Effect.map((tournament) => ({ tournament })));
}

function parseNodes(
  value: unknown,
  path: string,
): Effect.Effect<readonly WorkflowNode[], WorkflowError> {
  if (!Array.isArray(value) || value.length === 0) {
    return fail("parse", path, "nodes must be a non-empty array");
  }
  return Effect.forEach(value, (node, index) => parseNode(node, `${path}.nodes[${index}]`));
}

export function parseWorkflow(
  source: string,
  sourcePath: string,
): Effect.Effect<WorkflowDocument, WorkflowError> {
  return Effect.try({
    try: () => load(source),
    catch: (cause) => workflowError("parse", sourcePath, errorMessage(cause)),
  }).pipe(
    Effect.flatMap((value) => {
      const document = record(value);
      const workflow = document === undefined ? undefined : record(document.workflow);
      if (document === undefined || workflow === undefined) {
        return fail("parse", sourcePath, "workflow document must contain an object workflow");
      }
      return Effect.gen(function* () {
        yield* rejectUnknown(document, DOCUMENT_KEYS, "document", sourcePath);
        if (document.version !== 3) return yield* fail("parse", sourcePath, "workflow version must be 3");
        yield* rejectUnknown(workflow, WORKFLOW_KEYS, "workflow", sourcePath);
        const name = yield* identifier(workflow.name, "workflow.name", sourcePath);
        const autoCommit = workflow.autoCommit === undefined
          ? false
          : yield* optionalBoolean(workflow, "autoCommit", sourcePath);
        const nodes = yield* parseNodes(workflow.nodes, sourcePath);
        return { version: 3 as const, workflow: { name, autoCommit, nodes } };
      });
    }),
  );
}

// ── Lowering: node tree → leaf stages + region plans ────────────────────────

interface NamedNode {
  readonly name: string;
  readonly from: readonly string[];
}

function nodeValue(node: WorkflowNode): NamedNode {
  return "stage" in node ? node.stage : "loop" in node ? node.loop : node.tournament;
}

function nestedNodes(node: WorkflowNode): readonly WorkflowNode[] | undefined {
  return "loop" in node ? node.loop.nodes : "tournament" in node ? node.tournament.nodes : undefined;
}

function scopeError(path: string, message: string): WorkflowError {
  return workflowError("compile", path, message);
}

interface Boundary {
  readonly entryStageId: string;
  readonly exitStageId: string;
}

interface InternalLeaf {
  readonly id: string;
  readonly regionPath: readonly string[];
  readonly stage: WorkflowStage;
  dependsOn: readonly string[];
}

interface LoweredWorkflow {
  readonly leaves: InternalLeaf[];
  readonly regions: WorkflowRegionPlan[];
  readonly boundaries: Map<string, Boundary>;
}

function runtimeId(path: readonly string[], name: string): string {
  return [...path, name].join(".");
}

/**
 * Lower a node tree into a leaf-stage table with dotted ids and re-wired
 * region boundaries. Validates graph scope rules in one pass: duplicate names,
 * resolvable `from` references, entry/exit and loop feedback referencing direct
 * children, entry having no local `from`, exit not consumed by a sibling,
 * every child lying on an entry→exit path, `map.over` selecting a `from` node,
 * and acyclic edges. The all-children path rule means a valid loop feedback
 * child is guaranteed to complete before its iteration returns.
 */
function lowerNodes(
  nodes: readonly WorkflowNode[],
  sourcePath: string,
): LoweredWorkflow {
  const lower = (
    scopeNodes: readonly WorkflowNode[],
    scopePath: readonly string[],
    parentId?: string,
  ): LoweredWorkflow => {
    const leaves: InternalLeaf[] = [];
    const regions: WorkflowRegionPlan[] = [];
    const boundaries = new Map<string, Boundary>();

    const byName = new Map<string, WorkflowNode>();
    for (const node of scopeNodes) {
      const { name } = nodeValue(node);
      if (byName.has(name)) throw scopeError(sourcePath, `duplicate node "${name}" in one scope`);
      byName.set(name, node);
      if (nodeValue(node).from.includes(name)) {
        throw scopeError(sourcePath, `node "${name}" cannot depend on itself`);
      }
    }
    for (const node of scopeNodes) {
      const value = nodeValue(node);
      for (const reference of value.from) {
        if (!byName.has(reference)) {
          throw scopeError(sourcePath, `node "${value.name}" has unknown from reference "${reference}" in its scope`);
        }
      }
    }

    // First pass: register leaf/region boundaries.
    for (const node of scopeNodes) {
      if ("stage" in node) {
        const id = runtimeId(scopePath, node.stage.name);
        leaves.push({ id, regionPath: scopePath, stage: node.stage, dependsOn: [] });
        boundaries.set(node.stage.name, { entryStageId: id, exitStageId: id });
        continue;
      }

      const region = "loop" in node ? node.loop : node.tournament;
      const kind = "loop" in node ? "loop" : "map"; // internal fan-out region kind stays "map"
      const id = runtimeId(scopePath, region.name);
      const children = nestedNodes(node) ?? [];
      const childrenByName = new Map(children.map((child) => [nodeValue(child).name, child]));

      const entryNode = childrenByName.get(region.entry);
      const exitNode = childrenByName.get(region.exit);
      if (entryNode === undefined || exitNode === undefined) {
        throw scopeError(sourcePath, `${kind} "${region.name}" entry and exit must reference direct child nodes`);
      }
      if (kind === "loop") {
        const feedback = (region as WorkflowLoop).feedback;
        if (feedback !== undefined && !childrenByName.has(feedback)) {
          throw scopeError(sourcePath, `loop "${region.name}" feedback "${feedback}" must reference a direct child node`);
        }
      }
      if (nodeValue(entryNode).from.length !== 0) {
        throw scopeError(sourcePath, `${kind} "${region.name}" entry "${region.entry}" must not declare local from dependencies`);
      }
      const exitConsumer = children.find((child) =>
        nodeValue(child).name !== region.exit && nodeValue(child).from.includes(region.exit),
      );
      if (exitConsumer !== undefined) {
        throw scopeError(sourcePath, `${kind} "${region.name}" exit "${region.exit}" cannot be a dependency of sibling "${nodeValue(exitConsumer).name}"`);
      }

      const outgoing = new Map<string, string[]>(children.map((child) => [nodeValue(child).name, []]));
      for (const child of children) {
        for (const dependency of nodeValue(child).from) {
          outgoing.get(dependency)?.push(nodeValue(child).name);
        }
      }
      const reachableFromEntry = new Set<string>();
      const visitForward = (name: string): void => {
        if (reachableFromEntry.has(name)) return;
        reachableFromEntry.add(name);
        for (const next of outgoing.get(name) ?? []) visitForward(next);
      };
      visitForward(region.entry);
      const canReachExit = new Set<string>([region.exit]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const child of children) {
          const childName = nodeValue(child).name;
          if (canReachExit.has(childName)) continue;
          if ((outgoing.get(childName) ?? []).some((next) => canReachExit.has(next))) {
            canReachExit.add(childName);
            changed = true;
          }
        }
      }
      for (const child of children) {
        const childName = nodeValue(child).name;
        if (!reachableFromEntry.has(childName) || !canReachExit.has(childName)) {
          throw scopeError(sourcePath, `${kind} "${region.name}" node "${childName}" must lie on a path from entry "${region.entry}" to exit "${region.exit}"`);
        }
      }
      if (kind === "map") {
        const overRoot = (region as WorkflowTournament).over.split(".", 1)[0]?.trim() ?? "";
        if (!region.from.includes(overRoot)) {
          throw scopeError(sourcePath, `tournament "${region.name}" over must select a field from one of its from nodes`);
        }
      }

      const childLowered = lower(children, [...scopePath, region.name], id);
      leaves.push(...childLowered.leaves);
      regions.push(...childLowered.regions);
      const entryBoundary = childLowered.boundaries.get(region.entry);
      const exitBoundary = childLowered.boundaries.get(region.exit);
      if (entryBoundary === undefined || exitBoundary === undefined) {
        throw scopeError(sourcePath, `${kind} "${region.name}" has an invalid boundary`);
      }

      regions.push({
        id,
        name: region.name,
        kind,
        entry: region.entry,
        exit: region.exit,
        entryStageId: entryBoundary.entryStageId,
        exitStageId: exitBoundary.exitStageId,
        ...(parentId === undefined ? {} : { parentId }),
        from: [...region.from],
        ...(kind === "loop"
          ? {
            iterations: (region as WorkflowLoop).iterations,
            ...((region as WorkflowLoop).feedback === undefined
              ? {}
              : { feedback: (region as WorkflowLoop).feedback }),
          }
          : { over: (region as WorkflowTournament).over, count: (region as WorkflowTournament).count }),
      });
      boundaries.set(region.name, {
        entryStageId: entryBoundary.entryStageId,
        exitStageId: exitBoundary.exitStageId,
      });
    }

    // Second pass: rewire `from` edges to resolved exit-stage ids.
    const resolveRef = (reference: string): string => {
      const boundary = boundaries.get(reference);
      if (boundary === undefined) {
        throw scopeError(sourcePath, `node has unknown from reference "${reference}" in its scope`);
      }
      return boundary.exitStageId;
    };
    const leavesById = new Map(leaves.map((leaf) => [leaf.id, leaf]));
    for (const node of scopeNodes) {
      if ("stage" in node) {
        const id = runtimeId(scopePath, node.stage.name);
        const leaf = leavesById.get(id);
        if (leaf !== undefined) leaf.dependsOn = node.stage.from.map(resolveRef);
      } else {
        const region = "loop" in node ? node.loop : node.tournament;
        const boundary = boundaries.get(region.name);
        if (boundary !== undefined) {
          const entryLeaf = leavesById.get(boundary.entryStageId);
          if (entryLeaf !== undefined) entryLeaf.dependsOn = region.from.map(resolveRef);
        }
      }
    }

    return { leaves, regions, boundaries };
  };

  const result = lower(nodes, []);
  return { leaves: result.leaves, regions: result.regions, boundaries: result.boundaries };
}

/** Kahn topological sort over dotted-id leaves, declaration order as tiebreak. */
function orderLeaves(leaves: readonly InternalLeaf[]): readonly InternalLeaf[] | undefined {
  const byId = new Map(leaves.map((leaf) => [leaf.id, leaf]));
  const indegree = new Map(leaves.map((leaf, index) => [leaf.id, { count: leaf.dependsOn.length, index }]));
  const ready = leaves
    .filter((leaf) => (indegree.get(leaf.id)?.count ?? 0) === 0)
    .sort((a, b) => (indegree.get(a.id)?.index ?? 0) - (indegree.get(b.id)?.index ?? 0))
    .map((leaf) => leaf.id);
  const ordered: string[] = [];

  while (ready.length > 0) {
    const id = ready.shift();
    if (id === undefined) break;
    ordered.push(id);
    for (const leaf of leaves) {
      if (!leaf.dependsOn.includes(id)) continue;
      const entry = indegree.get(leaf.id);
      if (entry === undefined) continue;
      entry.count -= 1;
      if (entry.count === 0) {
        const insertAt = ready.findIndex((queued) => (indegree.get(queued)?.index ?? 0) > entry.index);
        if (insertAt === -1) ready.push(leaf.id);
        else ready.splice(insertAt, 0, leaf.id);
      }
    }
  }

  if (ordered.length !== leaves.length) return undefined;
  return ordered.map((id) => byId.get(id)).filter((leaf): leaf is InternalLeaf => leaf !== undefined);
}

export function compileWorkflow(
  document: WorkflowDocument,
  sourcePath: string,
): Effect.Effect<CompiledWorkflow, WorkflowError> {
  return Effect.try({
    try: () => {
      const lowered = lowerNodes(document.workflow.nodes, sourcePath);
      const ordered = orderLeaves(lowered.leaves);
      if (ordered === undefined) {
        throw scopeError(sourcePath, "workflow graph cannot be topologically ordered");
      }
      for (const leaf of ordered) {
        const name = leaf.stage.validate;
        if (typeof name === "string" && !isContractName(name)) {
          throw scopeError(
            sourcePath,
            `stage "${leaf.stage.name}" validate "${name}" is not a predefined validator (known: ${knownContractNames().join(", ")})`,
          );
        }
        if (name !== undefined && leaf.stage.tools !== undefined &&
          !leaf.stage.tools.some((tool) =>
            toolGrantsCapability(leaf.stage.harness, tool, "write") ||
            toolGrantsCapability(leaf.stage.harness, tool, "exec"))) {
          throw scopeError(
            sourcePath,
            `stage "${leaf.stage.name}" declares validate and must allow write or bash to create its result`,
          );
        }
      }
      return {
        name: document.workflow.name,
        sourcePath,
        stages: ordered.map((leaf) => ({
          id: leaf.id,
          dependsOn: leaf.dependsOn,
          regionPath: leaf.regionPath,
          stage: leaf.stage,
        })),
        regions: lowered.regions,
        autoCommit: document.workflow.autoCommit === true,
      };
    },
    catch: (cause) => cause instanceof WorkflowError
      ? cause
      : workflowError("compile", sourcePath, errorMessage(cause)),
  });
}

/** Production schedule: ordered leaf-stage invocations with their region path. */
export function scheduleWorkflow(
  plan: CompiledWorkflow,
): Effect.Effect<readonly ScheduledStage[], WorkflowError> {
  return Effect.succeed(plan.stages.map((leaf, order) => ({
    id: leaf.id,
    order,
    dependsOn: leaf.dependsOn,
    stage: leaf.stage,
    ...(leaf.regionPath.length === 0 ? {} : { regionPath: leaf.regionPath }),
  })));
}
