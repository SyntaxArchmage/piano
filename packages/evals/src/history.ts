import { homedir } from "node:os";
import { join } from "node:path";
import { Data, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { writeFileAtomic } from "@piano/base";
import { appendJsonlLine, isRecord } from "@piano/logging";
import type {
  BenchmarkMeasurement,
  CaseResult,
  EvalHistoryEntry,
  VariantComparison,
  VariantResult,
} from "./types.js";
import { usableBenchmarkValue } from "./evidence.js";

function isBenchmarkMeasurement(value: unknown): value is BenchmarkMeasurement {
  if (!isRecord(value)) return false;
  return (value.value === undefined || (typeof value.value === "number" && Number.isFinite(value.value))) &&
    (value.iteration === undefined || (typeof value.iteration === "number" && Number.isSafeInteger(value.iteration) && value.iteration >= 0)) &&
    (value.metric === undefined || typeof value.metric === "string") &&
    (value.direction === undefined || value.direction === "higher" || value.direction === "lower") &&
    typeof value.rawOutput === "string" &&
    typeof value.passed === "boolean";
}

export const DEFAULT_EVAL_HISTORY_ROOT = join(homedir(), ".piano", "evals");

export class EvalHistoryError extends Data.TaggedError("EvalHistoryError")<{
  readonly path: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export function evalHistoryPath(root: string, caseId: string): string {
  return join(root, caseId, "history.jsonl");
}

export function evalBaselinePath(root: string, caseId: string): string {
  return join(root, caseId, "baseline.json");
}

export function readBaseline(
  root: string,
  caseId: string,
): Effect.Effect<BenchmarkMeasurement | undefined, EvalHistoryError, FileSystem.FileSystem> {
  const path = evalBaselinePath(root, caseId);
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(path).pipe(Effect.mapError((cause) => mapFsError(path, cause)));
    if (!exists) return undefined;
    const source = yield* fs.readFileString(path).pipe(Effect.mapError((cause) => mapFsError(path, cause)));
    try {
      const entry: unknown = JSON.parse(source);
      if (!isRecord(entry) ||
        !isBenchmarkMeasurement(entry.baseline) ||
        usableBenchmarkValue(entry.baseline) === undefined) {
        throw new Error("pinned baseline must contain a valid benchmark measurement");
      }
      return entry.baseline;
    } catch (cause) {
      return yield* Effect.fail(new EvalHistoryError({ path, message: `invalid pinned baseline: ${String(cause)}`, cause }));
    }
  });
}

function mapFsError(path: string, cause: unknown): EvalHistoryError {
  return new EvalHistoryError({ path, message: String(cause), cause });
}

/** Append one immutable run/baseline line. The caller supplies the root so
 * tests and deployments can keep persistence outside the source workspace. */
export function appendEvalHistory(
  root: string,
  entry: EvalHistoryEntry,
): Effect.Effect<void, EvalHistoryError, FileSystem.FileSystem> {
  const path = evalHistoryPath(root, entry.caseId);
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const line = yield* Effect.try({
      try: () => `${JSON.stringify(entry)}\n`,
      catch: (cause) => mapFsError(path, cause),
    });
    yield* appendJsonlLine(fs, path, line, (_step, cause) => mapFsError(path, cause));
  });
}

/** Read the append-only history in file order. Missing history is an empty
 * ledger; malformed lines fail rather than being silently discarded. */
export function readEvalHistory(
  root: string,
  caseId: string,
): Effect.Effect<readonly EvalHistoryEntry[], EvalHistoryError, FileSystem.FileSystem> {
  const path = evalHistoryPath(root, caseId);
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(path).pipe(Effect.mapError((cause) => mapFsError(path, cause)));
    if (!exists) return [];
    const source = yield* fs.readFileString(path).pipe(Effect.mapError((cause) => mapFsError(path, cause)));
    const entries: EvalHistoryEntry[] = [];
    for (const [index, line] of source.split("\n").entries()) {
      if (line.trim() === "") continue;
      try {
        const value: unknown = JSON.parse(line);
        if (!isRecord(value) ||
          (value.kind !== "baseline" && value.kind !== "run") ||
          typeof value.caseId !== "string" ||
          typeof value.runSetId !== "string" ||
          !Number.isSafeInteger(value.trial) ||
          typeof value.recordedAt !== "string" ||
          typeof value.status !== "string" ||
          (value.baseline !== undefined && !isBenchmarkMeasurement(value.baseline))) {
          throw new Error("history entry has invalid identity or baseline measurement");
        }
        entries.push(value as unknown as EvalHistoryEntry);
      } catch (cause) {
        return yield* Effect.fail(new EvalHistoryError({
          path,
          message: `invalid history entry at line ${index + 1}: ${String(cause)}`,
          cause,
        }));
      }
    }
    return entries;
  });
}

/** Pin the grader-owned baseline emitted by a case run and retain its lineage
 * in the append-only history. */
export function recordBaseline(
  root: string,
  result: CaseResult,
  runSetId: string,
  recordedAt = new Date().toISOString(),
): Effect.Effect<EvalHistoryEntry, EvalHistoryError, FileSystem.FileSystem> {
  if (result.baseline === undefined || usableBenchmarkValue(result.baseline) === undefined) {
    return Effect.fail(new EvalHistoryError({
      path: evalBaselinePath(root, result.caseId),
      message: "cannot record a baseline without a parsed baseline measurement",
    }));
  }
  const entry: EvalHistoryEntry = {
    kind: "baseline",
    caseId: result.caseId,
    runSetId,
    trial: result.trial,
    recordedAt,
    ...(result.variant === undefined ? {} : { variant: result.variant }),
    status: result.status,
    baseline: result.baseline,
    ...(result.baselineComparison === undefined ? {} : { comparison: result.baselineComparison }),
    ...(result.scorecard === undefined ? {} : { scorecard: result.scorecard }),
    ...(result.evidence === undefined ? {} : { evidence: result.evidence }),
  };
  const path = evalBaselinePath(root, result.caseId);
  return Effect.gen(function* () {
    yield* writeFileAtomic(path, `${JSON.stringify(entry, null, 2)}\n`, {
      mapError: (cause) => mapFsError(path, cause),
    });
    yield* appendEvalHistory(root, entry);
    return entry;
  });
}

/** Convert persisted history rows into a stable variant comparison table. */
export function compareHistoryVariants(
  caseId: string,
  entries: readonly EvalHistoryEntry[],
): VariantComparison | undefined {
  const runs = entries.filter((entry) => entry.caseId === caseId && entry.kind === "run" && entry.variant !== undefined);
  if (runs.length === 0) return undefined;
  const byVariant = new Map<string, EvalHistoryEntry[]>();
  for (const entry of runs) {
    const variant = entry.variant!;
    const values = byVariant.get(variant) ?? [];
    values.push(entry);
    byVariant.set(variant, values);
  }
  const variants: VariantResult[] = [...byVariant.entries()].map(([variant, values]) => {
    const scorecards = values.flatMap((entry) => entry.scorecard === undefined ? [] : [entry.scorecard]);
    const finals = values.flatMap((entry) => entry.comparison?.final === undefined ? [] : [entry.comparison.final]);
    const baselines = values.flatMap((entry) => entry.comparison?.baseline === undefined ? [] : [entry.comparison.baseline]);
    return {
      variant,
      runSetIds: [...new Set(values.map((entry) => entry.runSetId))],
      quality: scorecards.reduce((sum, scorecard) => sum + scorecard.quality, 0) / Math.max(1, scorecards.length),
      acceptedRate: scorecards.filter((scorecard) => scorecard.accepted).length / Math.max(1, scorecards.length),
      ...(finals.length === 0 ? {} : { finalMetric: finals.reduce((sum, value) => sum + value, 0) / finals.length }),
      ...(baselines.length === 0 ? {} : { baselineMetric: baselines.reduce((sum, value) => sum + value, 0) / baselines.length }),
    };
  });
  return { caseId, variants };
}
