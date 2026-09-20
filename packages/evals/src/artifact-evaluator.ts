/**
 * Artifact evaluator (A5) — runs a case's readout method against the generated
 * artifact in the mutated workspace tempo to measure key signals.
 *
 * Every case follows the same compile -> verify path. A case that declares the
 * complete performance readout capability additionally runs its benchmark and
 * extracts the configured metric.
 */

import { execFile } from "node:child_process";
import { Effect } from "effect";
import { Data } from "effect";
import type { ArtifactMetrics, BenchmarkMeasurement, EvalCase, TestRunSummary } from "./types.js";

export class ArtifactEvalError extends Data.TaggedError("ArtifactEvalError")<{
  readonly caseId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

function runCommand(command: string, cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile("bash", ["-lc", command], { cwd, timeout: 120_000 }, (error, stdout, stderr) => {
      const code = error === null
        ? 0
        : typeof (error as { code?: unknown }).code === "number"
          ? (error as { code: number }).code
          : 1;
      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), code });
    });
  });
}

function extractMetric(output: string, pattern: string | undefined): number | undefined {
  if (pattern === undefined) return undefined;
  const regex = new RegExp(pattern);
  const match = output.match(regex);
  if (match === null || match[1] === undefined) return undefined;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

/** Parse the final Vitest `Tests ...` summary. Unknown verifier formats remain
 * valid artifact evidence but do not invent a test pass rate. */
export function parseTestRunSummary(output: string): TestRunSummary | undefined {
  // eslint-disable-next-line no-control-regex -- strip terminal SGR before parsing the Vitest summary
  const plain = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  const summary = plain.split("\n").filter((line) => /^\s*Tests\s+/.test(line)).at(-1);
  if (summary === undefined) return undefined;
  const count = (label: "passed" | "failed" | "skipped") => {
    const match = summary.match(new RegExp(`(\\d+)\\s+${label}`));
    return match === null ? 0 : Number(match[1]);
  };
  const passed = count("passed");
  const failed = count("failed");
  const skipped = count("skipped");
  const totalMatch = summary.match(/\((\d+)\)\s*$/);
  const total = totalMatch === null ? passed + failed + skipped : Number(totalMatch[1]);
  if (total === 0) return undefined;
  const executed = passed + failed;
  return { passed, failed, skipped, total, passRate: executed === 0 ? 0 : passed / executed };
}

/** Run a grader-owned clean-workspace baseline before the agent mutates the
 * case. A failed or unparseable baseline remains explicit evidence; it is not
 * converted into a zero metric. */
export function evaluateBaseline(
  kase: EvalCase,
  workspaceDir: string,
): Effect.Effect<BenchmarkMeasurement | undefined, ArtifactEvalError> {
  if (kase.readout.baselineCommand === undefined) return Effect.succeed(undefined);
  return Effect.tryPromise({
    try: () => runCommand(kase.readout.baselineCommand!, workspaceDir),
    catch: (cause) => new ArtifactEvalError({ caseId: kase.id, message: String(cause), cause }),
  }).pipe(Effect.map((result) => {
    const rawOutput = `${result.stdout}\n${result.stderr}`.trim();
    const value = extractMetric(rawOutput, kase.readout.metricPattern);
    return {
      ...(value === undefined ? {} : { value }),
      ...(kase.metric === undefined ? {} : { metric: kase.metric.name, direction: kase.metric.direction }),
      rawOutput,
      passed: result.code === 0 && value !== undefined,
      source: "baseline" as const,
    };
  }));
}

/**
 * Verify + benchmark a case's artifact inside `workspaceDir` using its
 * {@link EvalCase.readout}.
 */
export function evaluateArtifact(
  kase: EvalCase,
  workspaceDir: string,
): Effect.Effect<ArtifactMetrics, ArtifactEvalError> {
  return Effect.gen(function* () {
    const run = (command: string): Effect.Effect<CommandResult, ArtifactEvalError> =>
      Effect.tryPromise({
        try: () => runCommand(command, workspaceDir),
        catch: (cause) => new ArtifactEvalError({ caseId: kase.id, message: String(cause), cause }),
      });

    // 1. Compile or prepare the artifact.
    const { code: compileCode, stderr: compileErr, stdout: compileOut } =
      yield* run(kase.readout.compileCommand);
    if (compileCode !== 0) {
      return {
        verified: false,
        rawOutput: `[compile]\n${compileOut}\n${compileErr}`.trim(),
      } satisfies ArtifactMetrics;
    }

    // 2. Verify correctness.
    const { code: verifyCode, stdout: verifyOut, stderr: verifyErr } =
      yield* run(kase.readout.verifyCommand);
    const combined = `${verifyOut}\n${verifyErr}`;
    const verified = verifyCode === 0 && !/VERIFY:\s*FAIL/i.test(combined);
    const testSummary = parseTestRunSummary(combined);

    // 3. Benchmark when the case declares a performance readout.
    let value: number | undefined;
    let rawOutput = combined.trim();
    if (verified && kase.readout.benchmarkCommand !== undefined) {
      const { code: benchmarkCode, stdout: benchOut, stderr: benchErr } = yield* run(kase.readout.benchmarkCommand);
      rawOutput = `${benchOut}\n${benchErr}`.trim();
      if (benchmarkCode === 0) value = extractMetric(rawOutput, kase.readout.metricPattern);
    }

    void compileOut;
    return {
      verified,
      ...(value === undefined ? {} : { value }),
      ...(testSummary === undefined ? {} : { testSummary }),
      rawOutput,
    };
  });
}
