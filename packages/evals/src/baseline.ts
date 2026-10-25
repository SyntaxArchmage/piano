import { join } from "node:path";
import { Data, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { writeFileAtomic } from "@piano/base";
import { isRecord } from "@piano/logging";
import type { BenchmarkMeasurement, CaseResult, PinnedBaseline } from "./types.js";
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

export class EvalBaselineError extends Data.TaggedError("EvalBaselineError")<{
  readonly path: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export function evalBaselinePath(root: string, caseId: string): string {
  return join(root, caseId, "baseline.json");
}

export function readBaseline(
  root: string,
  caseId: string,
): Effect.Effect<BenchmarkMeasurement | undefined, EvalBaselineError, FileSystem.FileSystem> {
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
      return yield* Effect.fail(new EvalBaselineError({ path, message: `invalid pinned baseline: ${String(cause)}`, cause }));
    }
  });
}

function mapFsError(path: string, cause: unknown): EvalBaselineError {
  return new EvalBaselineError({ path, message: String(cause), cause });
}

/** Pin the grader-owned baseline emitted by a case run. A run set's report is
 * the record of a run; the pinned baseline is the one thing a later
 * `--replay-baseline` starts from, so it is kept beside the case's reports. */
export function recordBaseline(
  root: string,
  result: CaseResult,
  runSetId: string,
  recordedAt = new Date().toISOString(),
): Effect.Effect<PinnedBaseline, EvalBaselineError, FileSystem.FileSystem> {
  if (result.baseline === undefined || usableBenchmarkValue(result.baseline) === undefined) {
    return Effect.fail(new EvalBaselineError({
      path: evalBaselinePath(root, result.caseId),
      message: "cannot record a baseline without a parsed baseline measurement",
    }));
  }
  const entry: PinnedBaseline = {
    kind: "baseline",
    caseId: result.caseId,
    runSetId,
    trial: result.trial,
    recordedAt,
    ...(result.variant === undefined ? {} : { variant: result.variant }),
    baseline: result.baseline,
  };
  const path = evalBaselinePath(root, result.caseId);
  return Effect.gen(function* () {
    yield* writeFileAtomic(path, `${JSON.stringify(entry, null, 2)}\n`, {
      mapError: (cause) => mapFsError(path, cause),
    });
    return entry;
  });
}
