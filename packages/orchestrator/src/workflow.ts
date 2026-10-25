import { load } from "js-yaml";
import { Effect } from "effect";
import { isAbsolute } from "node:path";
import { asRecord } from "@piano/logging";
import {
  configuredWorkflowHarness,
  HARNESS_NAMES,
  harnessToolNames,
  isHarnessName,
  isKnownToolName,
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
  /** Model for this stage. A single id pins every lane. Inside a `tournament`
   * the list form pins one model per lane — lane `i` runs `model[i]` — and its
   * length must equal the tournament's `count`, which compile enforces. */
  readonly model?: string | readonly string[];
  /** Pi thinking/reasoning effort for this stage. */
  readonly thinkingLevel?: ThinkingLevel;
  readonly tools?: readonly string[];
  /** Gate each accepted attempt behind a human sign-off before the result is
   * published. The engine asks the run's signoff channel (Piano's own TUI);
   * a rejection resumes the same actor with the reviewer's feedback. */
  readonly signoff?: boolean;
  /** Allow the worker to ask the supervisor for guidance during its turn. */
  readonly discuss?: boolean;
  /** Reuse this stage actor's transcript across loop iterations, retries, and
   * resumed prompts. Omitted means true; false starts every worker turn fresh. */
  readonly memory?: boolean;
  /** Spoken before the stage's work: instruction the workflow wants the worker
   * to follow before it starts, appended to its first prompt. It is plain
   * prompt text, the workflow's own words rather than the worker's work —
   * never parsed, never validated, never part of a result. */
  readonly prologue?: string;
  /** Spoken after the stage's work: one follow-up message sent to the same
   * actor session once an attempt is accepted, resumed exactly like a repair
   * turn. It exists for side effects the workflow wants but does not grade —
   * a worklog entry, tidying up — so its outcome is not evidence and its
   * failure never fails the stage. */
  readonly epilogue?: string;
  /** Whole-stage wall-clock cap in seconds. When exceeded the stage fails
   * (and its agent session is aborted). Guards against a single runaway agent
   * tool call (e.g. a filesystem-wide `find`) blocking the whole run with no
   * recovery point. Absent means the stage runs without a cap. */
  readonly timeout?: number;
  /** Retry this stage's failed attempts instead of failing the run. See
   * `WorkflowRetry`. Absent keeps the engine default. */
  readonly retry?: WorkflowRetry;
}

/** A `loop` region: repeat child nodes entry→exit until its bound is reached.
 * `feedback`, when present, adds that direct child's prior-iteration accepted
 * result to the next iteration's entry inputs.
 *
 * The bound is exactly one of two forms, never both:
 *
 * - `iterations`: stop after that many completed iterations.
 * - `duration`: stop once the region has been running for that many seconds.
 *   The first iteration always runs — a loop that never entered would not be a
 *   loop — and the deadline is sampled *between* iterations, so one iteration
 *   may overshoot it. `duration` exists because "keep improving for six hours"
 *   is a real request and a fixed iteration count cannot express it: round
 *   cost varies by orders of magnitude, so ten rounds may be twenty minutes or
 *   two days. */
export interface WorkflowLoop {
  readonly name: string;
  readonly from: readonly string[];
  readonly entry: string;
  readonly exit: string;
  readonly feedback?: string;
  readonly iterations?: number;
  /** Continuous working time in seconds. Mutually exclusive with `iterations`. */
  readonly duration?: number;
  readonly nodes: readonly WorkflowNode[];
}

/** A stage-level retry policy. Omitting it keeps the engine default: a failed
 * worker turn fails the stage, and a failed validation gets one resumed repair
 * turn (`VALIDATE_REPAIR_ATTEMPTS`).
 *
 * Declaring it makes the stage *durable*: an attempt that fails for a reason
 * that is not a human interrupt is retried after an exponentially growing wait
 * instead of failing the run. That is the useful shape for long unattended
 * runs, where the dominant failure is a provider/gateway hiccup that the next
 * attempt simply does not hit.
 *
 * `attempts` counts *retries*, not total attempts: `attempts: 3` allows the
 * initial attempt plus three more. `"unbounded"` never gives up.
 * `backoff` is the wait before the first retry, doubling each time up to
 * `backoffMax`; both are seconds. The wait stays interruptible, so a human
 * interrupt (Escape / `/exit`) still stops the run immediately. */
export interface WorkflowRetry {
  readonly attempts?: number | "unbounded";
  readonly backoff?: number;
  readonly backoffMax?: number;
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
  /** Run the lanes concurrently (the default) or one at a time when false.
   * Serializing trades wall-clock for uncontended GPU and harness capacity, so
   * this is the switch a parallel-vs-serial tuning experiment flips. */
  readonly parallel?: boolean;
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
    /** Default task namespace for lane branches (`tuna/<mnemonic>-<run>/lane-<n>`).
     * Overridable per run with `--mnemonic`; also the fallback when the
     * preflight task summary is unavailable. */
    readonly mnemonic?: string;
    /** Orchestrator-owned winner auto-commit (ISSUE-017): when true, the loop
     * executor commits each KEEP round's `changed_files` to the caller
     * workspace using the winner-commit template (no push). Default false —
     * opt-in per workflow, so generic workflows are unaffected. */
    readonly autoCommit?: boolean;
    readonly nodes: readonly WorkflowNode[];
  };
}

/** A workflow with exactly one root node, and that node is a stage. That is
 * the shape where restarting and continuing a paused job do the same work:
 * both re-enter the one stage. A region — even one holding a single stage —
 * has its own working instance, so the two commands differ there. */
export function isSingleStageWorkflow(document: WorkflowDocument): boolean {
  return document.workflow.nodes.length === 1 && "stage" in (document.workflow.nodes[0] ?? {});
}

/** A region plan surviving compile: iteration/fan-out controls + resolved
 * boundaries + its nested nodes. A region is an aggregated stage — `children`
 * is the region tree plane, the leaves of which are also members of the leaf
 * DAG plane (`CompiledWorkflow.stages`). */
export interface WorkflowRegionPlan {
  readonly id: string;
  readonly name: string;
  readonly kind: "loop" | "map";
  /** Dotted ids of the boundary leaves. The DSL's `entry`/`exit` names are
   * lowering-only; anything running or reporting a region reads these. */
  readonly entryStageId: string;
  readonly exitStageId: string;
  readonly parentId?: string;
  readonly from: readonly string[];
  readonly iterations?: number;
  /** Loops only: continuous working time in seconds, the alternative bound to
   * `iterations`. Present means the iteration count is decided at run time, so
   * importers that need a stage denominator must sample it from the frames. */
  readonly duration?: number;
  /** A loop direct-child name whose prior-iteration result feeds its entry. */
  readonly feedback?: string;
  readonly over?: string;
  readonly count?: number;
  /** Fan-out lanes only: whether they run concurrently. Absent outside fan-out
   * regions; false serializes the lanes. */
  readonly parallel?: boolean;
  /** Nested stages and sub-regions, in declaration order. */
  readonly children: readonly WorkflowRuntimeNode[];
}

/** A leaf stage after lowering: dotted id, enclosing region, and its stage. */
export interface CompiledStage {
  readonly id: string;
  readonly dependsOn: readonly string[];
  /** Innermost enclosing region id, or undefined at top level. Regions nest via
   * their own `parentId`, so the full ancestor chain is a pointer walk. */
  readonly parentId?: string;
  readonly stage: WorkflowStage;
}

/** One node of the compiled scope tree: a leaf stage or an aggregated stage
 * (region). Distinguished by presence of `stage`. */
export type WorkflowRuntimeNode = CompiledStage | WorkflowRegionPlan;

export interface CompiledWorkflow {
  readonly name: string;
  /** Default lane namespace; see WorkflowDocument.workflow.mnemonic. */
  readonly mnemonic?: string;
  readonly sourcePath: string;
  /** Leaf stages ordered by dependency (regions flattened into leaves). */
  readonly stages: readonly CompiledStage[];
  readonly regions: readonly WorkflowRegionPlan[];
  /** Root scope of the compiled region tree. Same leaf/region objects as
   * `stages`/`regions`, nested once at compile time. */
  readonly nodes: readonly WorkflowRuntimeNode[];
  /** Orchestrator-owned winner auto-commit (ISSUE-017); see WorkflowDocument. */
  readonly autoCommit: boolean;
}

const DOCUMENT_KEYS = new Set(["version", "workflow"]);
const WORKFLOW_KEYS = new Set(["name", "mnemonic", "nodes", "autoCommit"]);
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
  "discuss",
  "memory",
  "prologue",
  "epilogue",
  "timeout",
  "retry",
]);
const LOOP_KEYS = new Set(["name", "from", "entry", "exit", "feedback", "iterations", "duration", "nodes"]);
const RETRY_KEYS = new Set(["attempts", "backoff", "backoffMax"]);
const TOURNAMENT_KEYS = new Set(["name", "from", "over", "count", "parallel", "entry", "exit", "nodes"]);
const NODE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** Whether a value is usable as a workflow identifier (region, stage, or lane
 * namespace). The same rule the parser applies to every declared name. */
export function isWorkflowIdentifier(value: string): boolean {
  return NODE_IDENTIFIER.test(value);
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
    Effect.flatMap((name) => isWorkflowIdentifier(name)
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
      return segments.every((segment) => isWorkflowIdentifier(segment))
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

/** `stage.retry` in its one legal form. An empty object is accepted and
 * meaningful: it opts into automatic retries with every default (unbounded, a
 * 30s first wait doubling to 15 minutes). Spelling the policy out is therefore
 * optional, while an unparsable one is refused rather than silently defaulted —
 * a typo in `attempts` must not quietly become "unbounded". */
function parseRetry(
  value: unknown,
  path: string,
): Effect.Effect<WorkflowRetry | undefined, WorkflowError> {
  if (value === undefined) return Effect.succeed(undefined);
  const region = asRecord(value);
  if (region === undefined) return fail("parse", path, "stage.retry must be an object");
  return Effect.gen(function* () {
    yield* rejectUnknown(region, RETRY_KEYS, "stage.retry", path);
    const raw = region.attempts;
    let attempts: number | "unbounded" | undefined;
    if (raw === undefined || raw === "unbounded") {
      attempts = raw;
    } else {
      attempts = yield* positiveInteger(raw, "stage.retry.attempts", path);
    }
    const backoff = region.backoff === undefined
      ? undefined
      : yield* positiveInteger(region.backoff, "stage.retry.backoff", path);
    const backoffMax = region.backoffMax === undefined
      ? undefined
      : yield* positiveInteger(region.backoffMax, "stage.retry.backoffMax", path);
    if (backoff !== undefined && backoffMax !== undefined && backoffMax < backoff) {
      return yield* fail("parse", path, "stage.retry.backoffMax must not be smaller than stage.retry.backoff");
    }
    return {
      ...(attempts === undefined ? {} : { attempts }),
      ...(backoff === undefined ? {} : { backoff }),
      ...(backoffMax === undefined ? {} : { backoffMax }),
    } satisfies WorkflowRetry;
  });
}

/** A positive, finite number of seconds. Fractional values are legal (and are
 * what a test uses to bound a `loop.duration` without waiting a whole second),
 * but `NaN`/`Infinity` are not: either would make a deadline comparison
 * meaningless rather than merely imprecise. */
function positiveNumber(
  value: unknown,
  field: string,
  path: string,
): Effect.Effect<number, WorkflowError> {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fail("parse", path, `${field} must be a positive number`);
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

/** `stage.model` in either of its two forms: one id for every lane, or one id
 * per lane inside a tournament. Duplicates are allowed — racing one model under
 * several strategies is as meaningful as racing several models. Whether the
 * list is legal where it appears is a compile question, because only the
 * enclosing region knows the lane count. */
function optionalStageModel(
  model: unknown,
  path: string,
): Effect.Effect<string | readonly string[] | undefined, WorkflowError> {
  if (model === undefined) return Effect.succeed(undefined);
  if (typeof model === "string") return requiredString(model, "stage.model", path);
  const message = "stage.model must be a non-empty string or a non-empty array of such strings";
  if (!Array.isArray(model) || model.length === 0) return fail("parse", path, message);
  const entries: string[] = [];
  for (const entry of model) {
    if (typeof entry !== "string" || entry.trim() === "") return fail("parse", path, message);
    entries.push(entry.trim());
  }
  return Effect.succeed(entries);
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
  const stage = asRecord(value);
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
    const model = yield* optionalStageModel(stage.model, path);
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
    if (stage.discuss !== undefined && typeof stage.discuss !== "boolean") {
      return yield* fail("parse", path, "stage.discuss must be a boolean");
    }
    if (stage.memory !== undefined && typeof stage.memory !== "boolean") {
      return yield* fail("parse", path, "stage.memory must be a boolean");
    }
    const prologue = stage.prologue === undefined
      ? undefined
      : yield* requiredString(stage.prologue, "stage.prologue", path);
    const epilogue = stage.epilogue === undefined
      ? undefined
      : yield* requiredString(stage.epilogue, "stage.epilogue", path);
    const timeout = stage.timeout === undefined
      ? undefined
      : yield* positiveInteger(stage.timeout, "stage.timeout", path);
    const retry = yield* parseRetry(stage.retry, path);
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
      ...(stage.discuss === undefined ? {} : { discuss: stage.discuss }),
      ...(stage.memory === undefined ? {} : { memory: stage.memory }),
      ...(prologue === undefined ? {} : { prologue }),
      ...(epilogue === undefined ? {} : { epilogue }),
      ...(timeout === undefined ? {} : { timeout }),
      ...(retry === undefined ? {} : { retry }),
    };
  });
}

function parseLoop(
  value: unknown,
  path: string,
): Effect.Effect<WorkflowLoop, WorkflowError> {
  const region = asRecord(value);
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
    // The bound is a choice, not a pair: a loop bounded by both a count and a
    // clock would silently mean "whichever comes first", which is never what
    // an author meant to write, and a loop bounded by neither cannot terminate.
    const declarations = [region.iterations, region.duration].filter((value) => value !== undefined);
    if (declarations.length === 0) {
      return yield* fail("parse", path, `loop "${name}" declares no bound; set exactly one of iterations or duration`);
    }
    if (declarations.length > 1) {
      return yield* fail("parse", path, `loop "${name}" declares both iterations and duration; set exactly one`);
    }
    const iterations = region.iterations === undefined
      ? undefined
      : yield* positiveInteger(region.iterations, "loop.iterations", path);
    const duration = region.duration === undefined
      ? undefined
      : yield* positiveNumber(region.duration, "loop.duration", path);
    const nodes = yield* parseNodes(region.nodes, path);
    return {
      name,
      from,
      entry,
      exit,
      ...(feedback === undefined ? {} : { feedback }),
      ...(iterations === undefined ? {} : { iterations }),
      ...(duration === undefined ? {} : { duration }),
      nodes,
    };
  });
}

function parseTournament(
  value: unknown,
  path: string,
): Effect.Effect<WorkflowTournament, WorkflowError> {
  const region = asRecord(value);
  if (region === undefined) return fail("parse", path, "tournament must be an object");
  return Effect.gen(function* () {
    yield* rejectUnknown(region, TOURNAMENT_KEYS, "tournament", path);
    const name = yield* identifier(region.name, "tournament.name", path);
    const from = yield* stringList(region.from, "tournament.from", path);
    const over = yield* identifierPath(region.over, "tournament.over", path);
    const count = yield* positiveInteger(region.count, "tournament.count", path);
    const parallel = region.parallel === undefined
      ? undefined
      : yield* optionalBoolean(region, "parallel", path);
    const entry = yield* identifier(region.entry, "tournament.entry", path);
    const exit = yield* identifier(region.exit, "tournament.exit", path);
    const nodes = yield* parseNodes(region.nodes, path);
    return { name, from, over, count, ...(parallel === undefined ? {} : { parallel }), entry, exit, nodes };
  });
}

function parseNode(
  value: unknown,
  path: string,
): Effect.Effect<WorkflowNode, WorkflowError> {
  const node = asRecord(value);
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
      const document = asRecord(value);
      const workflow = document === undefined ? undefined : asRecord(document.workflow);
      if (document === undefined || workflow === undefined) {
        return fail("parse", sourcePath, "workflow document must contain an object workflow");
      }
      return Effect.gen(function* () {
        yield* rejectUnknown(document, DOCUMENT_KEYS, "document", sourcePath);
        if (document.version !== 3) return yield* fail("parse", sourcePath, "workflow version must be 3");
        yield* rejectUnknown(workflow, WORKFLOW_KEYS, "workflow", sourcePath);
        const name = yield* identifier(workflow.name, "workflow.name", sourcePath);
        const mnemonic = workflow.mnemonic === undefined
          ? undefined
          : yield* identifier(workflow.mnemonic, "workflow.mnemonic", sourcePath);
        const autoCommit = workflow.autoCommit === undefined
          ? false
          : yield* optionalBoolean(workflow, "autoCommit", sourcePath);
        const nodes = yield* parseNodes(workflow.nodes, sourcePath);
        return { version: 3 as const, workflow: { name, ...(mnemonic === undefined ? {} : { mnemonic }), autoCommit, nodes } };
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

/** The loop/tournament source union discriminates on `over`: only a tournament
 * declares it. Narrowing through this guard keeps `lowerNodes` cast-free. */
function isLoopSource(region: WorkflowLoop | WorkflowTournament): region is WorkflowLoop {
  return !("over" in region);
}

/** Kind-specific plan fields, copied from the source node exactly as declared
 * except that `parallel` resolves to a boolean so the executor never re-derives
 * the default. */
function regionControls(region: WorkflowLoop | WorkflowTournament):
  Pick<WorkflowRegionPlan, "iterations" | "duration" | "feedback" | "over" | "count" | "parallel"> {
  if (isLoopSource(region)) {
    return {
      ...(region.iterations === undefined ? {} : { iterations: region.iterations }),
      ...(region.duration === undefined ? {} : { duration: region.duration }),
      ...(region.feedback === undefined ? {} : { feedback: region.feedback }),
    };
  }
  return {
    over: region.over,
    count: region.count,
    parallel: region.parallel !== false,
  };
}

function scopeError(path: string, message: string): WorkflowError {
  return workflowError("compile", path, message);
}

interface Boundary {
  readonly entryStageId: string;
  readonly exitStageId: string;
}

interface LoweredWorkflow {
  readonly leaves: CompiledStage[];
  readonly regions: WorkflowRegionPlan[];
  /** This scope's nodes in declaration order: the region-tree children. */
  readonly nodes: WorkflowRuntimeNode[];
  readonly boundaries: Map<string, Boundary>;
}

/** Lowering rewrites `from` names into resolved exit-stage ids once every
 * boundary is known. The leaf is already published into the scope tree, so the
 * rewiring happens in place on the one object both planes share. */
function rewireDependsOn(leaf: CompiledStage, dependsOn: readonly string[]): void {
  (leaf as { dependsOn: readonly string[] }).dependsOn = dependsOn;
}

/** Region lookup by id — the one index over a compiled region table. */
export function regionIndex(
  regions: readonly WorkflowRegionPlan[],
): ReadonlyMap<string, WorkflowRegionPlan> {
  return new Map(regions.map((region) => [region.id, region]));
}

/** The chain of enclosing regions from `startId` outward, innermost first,
 * following `parentId` pointers. The one walk of the region tree; it stops at
 * an id the index does not hold. */
export function regionAncestors(
  index: ReadonlyMap<string, WorkflowRegionPlan>,
  startId: string | undefined,
): readonly WorkflowRegionPlan[] {
  const chain: WorkflowRegionPlan[] = [];
  for (let id = startId; id !== undefined; ) {
    const region = index.get(id);
    if (region === undefined) break;
    chain.push(region);
    id = region.parentId;
  }
  return chain;
}

/** The innermost fan-out region enclosing a leaf, with the lane count a
 * per-lane model list must match. `parentId` names the enclosing region, and a
 * region's `parentId` its own, so the innermost `map` ancestor is the one the
 * list is indexed against. */
function innermostTournament(
  leaf: CompiledStage,
  regions: readonly WorkflowRegionPlan[],
): { readonly name: string; readonly count: number } | undefined {
  for (const region of regionAncestors(regionIndex(regions), leaf.parentId)) {
    if (region.kind === "map" && region.count !== undefined) return { name: region.name, count: region.count };
  }
  return undefined;
}

/** A per-lane `stage.model` list is meaningful only inside a tournament, and
 * only if it names exactly one model per lane: a shorter list leaves a lane
 * without a model and a longer one silently drops entries. Both are refused at
 * load time rather than at the first lane's first turn. */
function validateSlotModels(
  sourcePath: string,
  leaves: readonly CompiledStage[],
  regions: readonly WorkflowRegionPlan[],
): void {
  for (const leaf of leaves) {
    const model = leaf.stage.model;
    if (model === undefined || typeof model === "string") continue;
    const tournament = innermostTournament(leaf, regions);
    if (tournament === undefined) {
      throw scopeError(
        sourcePath,
        `stage "${leaf.stage.name}" declares a model list but is not inside a tournament; ` +
        "a list selects one model per lane, so declare a single model here",
      );
    }
    if (model.length !== tournament.count) {
      throw scopeError(
        sourcePath,
        `stage "${leaf.stage.name}" declares ${model.length} model(s) but tournament "${tournament.name}" ` +
        `has count ${tournament.count}; the list must name exactly one model per lane`,
      );
    }
  }
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
    const leaves: CompiledStage[] = [];
    const regions: WorkflowRegionPlan[] = [];
    const nodes: WorkflowRuntimeNode[] = [];
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
        const leaf: CompiledStage = {
          id,
          ...(parentId === undefined ? {} : { parentId }),
          stage: node.stage,
          dependsOn: [],
        };
        leaves.push(leaf);
        nodes.push(leaf);
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
      if (isLoopSource(region)) {
        const feedback = region.feedback;
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
      if (!isLoopSource(region)) {
        const overRoot = region.over.split(".", 1)[0]?.trim() ?? "";
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

      const plan: WorkflowRegionPlan = {
        id,
        name: region.name,
        kind,
        entryStageId: entryBoundary.entryStageId,
        exitStageId: exitBoundary.exitStageId,
        ...(parentId === undefined ? {} : { parentId }),
        from: [...region.from],
        ...regionControls(region),
        children: childLowered.nodes,
      };
      regions.push(plan);
      nodes.push(plan);
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
        if (leaf !== undefined) rewireDependsOn(leaf, node.stage.from.map(resolveRef));
      } else {
        const region = "loop" in node ? node.loop : node.tournament;
        const boundary = boundaries.get(region.name);
        if (boundary !== undefined) {
          const entryLeaf = leavesById.get(boundary.entryStageId);
          if (entryLeaf !== undefined) rewireDependsOn(entryLeaf, region.from.map(resolveRef));
        }
      }
    }

    return { leaves, regions, nodes, boundaries };
  };

  const result = lower(nodes, []);
  validateSlotModels(sourcePath, result.leaves, result.regions);
  return result;
}

/** The model a stage runs with in one tournament lane. A single id applies to
 * every lane; a list is indexed by the lane number, and compile has already
 * proven the index is in range for the enclosing tournament. `mapSlot` is the
 * innermost fan-out frame's slot, so a stage nested in a loop inside a
 * tournament still follows the lane it belongs to. */
export function stageModelForSlot(
  model: WorkflowStage["model"],
  mapSlot: number | undefined,
): string | undefined {
  if (model === undefined) return undefined;
  if (typeof model === "string") return model;
  // The fallback covers only the type system: a list cannot reach a stage with
  // no enclosing lane, because compile refuses that shape.
  return model[mapSlot ?? 0] ?? model[0];
}

/** Kahn topological sort over dotted-id leaves, declaration order as tiebreak. */
function orderLeaves(leaves: readonly CompiledStage[]): readonly CompiledStage[] | undefined {
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
  return ordered.map((id) => byId.get(id)).filter((leaf): leaf is CompiledStage => leaf !== undefined);
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
        if (leaf.stage.discuss === true) {
          if (!isKnownToolName(leaf.stage.harness, "discuss")) {
            throw scopeError(
              sourcePath,
              `stage "${leaf.stage.name}" declares discuss: true but harness "${leaf.stage.harness}" cannot mount the discuss tool`,
            );
          }
          // The pi adapter passes the stage's tool list as the session
          // allowlist; a tool the list omits is never mounted.
          if (leaf.stage.tools !== undefined && !leaf.stage.tools.includes("discuss")) {
            throw scopeError(
              sourcePath,
              `stage "${leaf.stage.name}" declares discuss: true but does not list "discuss" in tools`,
            );
          }
        }
      }
      return {
        name: document.workflow.name,
        ...(document.workflow.mnemonic === undefined ? {} : { mnemonic: document.workflow.mnemonic }),
        sourcePath,
        stages: ordered,
        regions: lowered.regions,
        nodes: lowered.nodes,
        autoCommit: document.workflow.autoCommit === true,
      };
    },
    catch: (cause) => cause instanceof WorkflowError
      ? cause
      : workflowError("compile", sourcePath, errorMessage(cause)),
  });
}
