/**
 * case.yaml config loading for the Piano evals system (A2).
 *
 * Each workloads/<case>/ directory carries an immutable `case.yaml` manifest
 * describing how the case is launched, what workspace template to copy, which
 * workflow file to inject, and how its artifacts are scored.
 *
 * Parsing is Effect-wrapped and strict: unknown fields are rejected, required
 * fields validated, so a malformed case surfaces clearly at load time.
 */

import { load } from "js-yaml";
import { Effect } from "effect";
import { Data } from "effect";
import type {
  ArtifactReadout,
  AcceptancePolicy,
  CaseConfig,
  CaseGraderTag,
  EvalCase,
  WorkloadDescriptor,
} from "./types.js";

export class CaseConfigError extends Data.TaggedError("CaseConfigError")<{
  readonly path: string;
  readonly message: string;
}> {}

const DOCUMENT_KEYS = new Set([
  "version",
  "id",
  "group",
  "dimensions",
  "prompt",
  "command",
  "prepareCommand",
  "workspace",
  "workflow",
  "readout",
  "tags",
  "metric",
  "acceptance",
  "workload",
] as const);

const READOUT_KEYS = new Set([
  "kind",
  "compileCommand",
  "verifyCommand",
  "benchmarkCommand",
  "baselineCommand",
  "metricPattern",
  "tolerance",
] as const);

const TAG_KEYS = new Set(["tag", "weight"] as const);
const METRIC_KEYS = new Set(["name", "direction"] as const);
const WORKLOAD_KEYS = new Set(["operator", "shape", "language", "description"] as const);
const ACCEPTANCE_KEYS = new Set([
  "requireExecution",
  "requireArtifact",
  "requireEvidence",
  "requireBaseline",
  "requireImprovement",
] as const);
const DIMENSION_KEYS = new Set(["task", "harness", "model", "effort"] as const);

type RecordOf = Record<string, unknown>;

/** A performance readout is one atomic capability. Partial declarations are
 * rejected by parseCaseConfig so callers never need a task-family flag. */
export function hasPerformanceReadout(
  kase: Pick<EvalCase, "metric" | "readout">,
): boolean {
  return kase.metric !== undefined &&
    kase.readout.baselineCommand !== undefined &&
    kase.readout.benchmarkCommand !== undefined &&
    kase.readout.metricPattern !== undefined;
}

function record(value: unknown): RecordOf | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as RecordOf
    : undefined;
}

function fail(path: string, message: string): Effect.Effect<never, CaseConfigError> {
  return Effect.fail(new CaseConfigError({ path, message }));
}

function requiredString(value: unknown, field: string, path: string): Effect.Effect<string, CaseConfigError> {
  if (typeof value !== "string" || value.trim() === "") {
    return fail(path, `${field} must be a non-empty string`);
  }
  return Effect.succeed(value.trim());
}

function rejectUnknown(
  value: RecordOf,
  allowed: ReadonlySet<string>,
  section: string,
  path: string,
): Effect.Effect<void, CaseConfigError> {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  return unknown === undefined
    ? Effect.void
    : fail(path, `unknown field "${unknown}" in ${section}`);
}

function parseReadout(value: unknown, path: string): Effect.Effect<ArtifactReadout, CaseConfigError> {
  const readout = record(value);
  if (readout === undefined) return fail(path, "readout must be an object");
  return Effect.gen(function* () {
    yield* rejectUnknown(readout, READOUT_KEYS, "readout", path);
    const kind = yield* requiredString(readout.kind, "readout.kind", path);
    if (kind !== "programmatic") return yield* fail(path, "readout.kind must be \"programmatic\"");
    const compileCommand = yield* requiredString(readout.compileCommand, "readout.compileCommand", path);
    const verifyCommand = yield* requiredString(readout.verifyCommand, "readout.verifyCommand", path);
    const benchmarkCommand = readout.benchmarkCommand === undefined
      ? undefined
      : yield* requiredString(readout.benchmarkCommand, "readout.benchmarkCommand", path);
    const baselineCommand = readout.baselineCommand === undefined
      ? undefined
      : yield* requiredString(readout.baselineCommand, "readout.baselineCommand", path);
    const metricPattern = readout.metricPattern === undefined
      ? undefined
      : yield* requiredString(readout.metricPattern, "readout.metricPattern", path);
    if (metricPattern !== undefined) {
      try {
        new RegExp(metricPattern);
      } catch (cause) {
        return yield* fail(path, `readout.metricPattern must be a valid regular expression: ${String(cause)}`);
      }
    }
    const tolerance = readout.tolerance === undefined
      ? undefined
      : typeof readout.tolerance === "number" && Number.isFinite(readout.tolerance)
        ? readout.tolerance
        : yield* fail(path, "readout.tolerance must be a finite number");
    return {
      kind: "programmatic" as const,
      compileCommand,
      verifyCommand,
      ...(benchmarkCommand === undefined ? {} : { benchmarkCommand }),
      ...(baselineCommand === undefined ? {} : { baselineCommand }),
      ...(metricPattern === undefined ? {} : { metricPattern }),
      ...(tolerance === undefined ? {} : { tolerance }),
    };
  });
}

function parseTags(value: unknown, path: string): Effect.Effect<CaseGraderTag[], CaseConfigError> {
  if (!Array.isArray(value) || value.length === 0) {
    return fail(path, "tags must be a non-empty array");
  }
  return Effect.forEach(value, (item, index): Effect.Effect<CaseGraderTag, CaseConfigError> => {
    const tag = record(item);
    if (tag === undefined) return fail(path, `tags[${index}] must be an object`);
    return Effect.gen(function* () {
      yield* rejectUnknown(tag, TAG_KEYS, `tags[${index}]`, path);
      const name = yield* requiredString(tag.tag, `tags[${index}].tag`, path);
      const weight = tag.weight === undefined
        ? 1
        : typeof tag.weight === "number" && Number.isFinite(tag.weight)
          ? tag.weight
          : yield* fail(path, `tags[${index}].weight must be a finite number`);
      return { tag: name, weight };
    });
  });
}

function parseDimensions(value: unknown, path: string) {
  const dimensions = record(value);
  if (dimensions === undefined) return fail(path, "dimensions must be an object");
  return Effect.gen(function* () {
    yield* rejectUnknown(dimensions, DIMENSION_KEYS, "dimensions", path);
    return {
      task: yield* requiredString(dimensions.task, "dimensions.task", path),
      harness: yield* requiredString(dimensions.harness, "dimensions.harness", path),
      model: yield* requiredString(dimensions.model, "dimensions.model", path),
      effort: yield* requiredString(dimensions.effort, "dimensions.effort", path),
    };
  });
}

function parseMetric(value: unknown, path: string): Effect.Effect<{ name: string; direction: "higher" | "lower" }, CaseConfigError> {
  const metric = record(value);
  if (metric === undefined) return fail(path, "metric must be an object");
  return Effect.gen(function* () {
    yield* rejectUnknown(metric, METRIC_KEYS, "metric", path);
    const name = yield* requiredString(metric.name, "metric.name", path);
    const direction = metric.direction;
    if (direction !== "higher" && direction !== "lower") {
      return yield* fail(path, "metric.direction must be \"higher\" or \"lower\"");
    }
    return { name, direction };
  });
}

function parseWorkload(value: unknown, path: string): Effect.Effect<WorkloadDescriptor, CaseConfigError> {
  const workload = record(value);
  if (workload === undefined) return fail(path, "workload must be an object");
  return Effect.gen(function* () {
    yield* rejectUnknown(workload, WORKLOAD_KEYS, "workload", path);
    const operator = yield* requiredString(workload.operator, "workload.operator", path);
    const shape = yield* requiredString(workload.shape, "workload.shape", path);
    const language = yield* requiredString(workload.language, "workload.language", path);
    const description = yield* requiredString(workload.description, "workload.description", path);
    return { operator, shape, language, description };
  });
}

function parseAcceptance(value: unknown, path: string): Effect.Effect<AcceptancePolicy, CaseConfigError> {
  const acceptance = record(value);
  if (acceptance === undefined) return fail(path, "acceptance must be an object");
  return Effect.gen(function* () {
    yield* rejectUnknown(acceptance, ACCEPTANCE_KEYS, "acceptance", path);
    const parsed: AcceptancePolicy = {};
    for (const key of ACCEPTANCE_KEYS) {
      const candidate = acceptance[key];
      if (candidate === undefined) continue;
      if (typeof candidate !== "boolean") {
        return yield* fail(path, `acceptance.${key} must be a boolean`);
      }
      parsed[key] = candidate;
    }
    return parsed;
  });
}

/**
 * Parse a case.yaml source string into a validated {@link CaseConfig}.
 */
export function parseCaseConfig(
  source: string,
  path: string,
): Effect.Effect<CaseConfig, CaseConfigError> {
  return Effect.try({
    try: () => load(source),
    catch: (cause) => new CaseConfigError({ path, message: cause instanceof Error ? cause.message : String(cause) }),
  }).pipe(
    Effect.flatMap((value) => {
      const document = record(value);
      if (document === undefined) return fail(path, "case config must be an object");
      return Effect.gen(function* () {
        yield* rejectUnknown(document, DOCUMENT_KEYS, "document", path);
        if (document.version !== 1) return yield* fail(path, "case config version must be 1");
        const id = yield* requiredString(document.id, "id", path);
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
          return yield* fail(path, "id must use only letters, digits, dots, underscores, and hyphens");
        }
        const group = yield* requiredString(document.group, "group", path);
        const dimensions = document.dimensions === undefined
          ? undefined
          : yield* parseDimensions(document.dimensions, path);
        const prompt = yield* requiredString(document.prompt, "prompt", path);
        const command = yield* requiredString(document.command, "command", path);
        const prepareCommand = document.prepareCommand === undefined
          ? undefined
          : yield* requiredString(document.prepareCommand, "prepareCommand", path);
        const workspace = yield* requiredString(document.workspace, "workspace", path);
        const workflow = document.workflow === undefined
          ? undefined
          : yield* requiredString(document.workflow, "workflow", path);
        const readout = yield* parseReadout(document.readout, path);
        const tags = yield* parseTags(document.tags, path);
        const metric = document.metric === undefined
          ? undefined
          : yield* parseMetric(document.metric, path);
        const acceptance = document.acceptance === undefined
          ? undefined
          : yield* parseAcceptance(document.acceptance, path);
        const workload = document.workload === undefined
          ? undefined
          : yield* parseWorkload(document.workload, path);
        const performanceFields = [
          ["metric", metric],
          ["readout.baselineCommand", readout.baselineCommand],
          ["readout.benchmarkCommand", readout.benchmarkCommand],
          ["readout.metricPattern", readout.metricPattern],
        ] as const;
        if (performanceFields.some(([, field]) => field !== undefined)) {
          const missing = performanceFields.find(([, field]) => field === undefined)?.[0];
          if (missing !== undefined) {
            return yield* fail(
              path,
              `performance readout requires metric, readout.baselineCommand, readout.benchmarkCommand, and readout.metricPattern (missing ${missing})`,
            );
          }
        }
        return {
          version: 1 as const,
          id,
          group,
          ...(dimensions === undefined ? {} : { dimensions }),
          prompt,
          command,
          ...(prepareCommand === undefined ? {} : { prepareCommand }),
          workspace,
          ...(workflow === undefined ? {} : { workflow }),
          readout,
          tags,
          ...(metric === undefined ? {} : { metric }),
          ...(acceptance === undefined ? {} : { acceptance }),
          ...(workload === undefined ? {} : { workload }),
        };
      });
    }),
  );
}
