/**
 * One case's execution: prepare the sandbox, launch the case's command,
 * associate the Piano run it created, and collect the evidence contract
 * (trace, artifact, scorecard) that `finalizeCaseResult` closes.
 */
import { Effect, Fiber } from "effect";
import { FileSystem } from "@effect/platform";
import { evalMetricsDir, sessionsRoot } from "@piano/base";
import { readdir } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { hasPerformanceReadout } from "./case-config.js";
import { workloadsDir } from "./case-loader.js";
import { evaluateArtifact, evaluateBaseline } from "./artifact-evaluator.js";
import {
  analyzeTranscriptFile,
  assessCaseEvidence,
  buildCaseScorecard,
  compareBenchmark,
  summarizeTiming,
  usableBenchmarkValue,
} from "./evidence.js";
import { DriverError } from "./errors.js";
import {
  copyWorkspaceTemplate,
  DEFAULT_WORKSPACE_ROOT,
  measureWorkspaceChanges,
  prepareWorkspaceDiffBaseline,
} from "./workspace.js";
import { matchNewRunDir, findNewRunDir } from "./run-locator.js";
import { progressTickLine, readStatus, runShell, shellQuote, substituteCommand } from "./launcher.js";
import { evalMetricsAvailable, readRunStatusSummary, readRunTrace } from "./run-reader.js";
import { defaultRunSetId } from "./runset.js";
import type {
  CaseResult,
  EvalCase,
  EvalRunOptions,
} from "./types.js";
import {
  defaultRunsRoot,
  logStreamPathCandidates,
  traceStreamPathCandidates,
  trajectoryStreamPathCandidates,
} from "@piano/logging";

// A workflow with a full performance readout can legitimately run many loop
// iterations; performance cases keep a bounded default, while coding cases
// without an explicit timeout run until their workflow exits.
export const DEFAULT_PERFORMANCE_TIMEOUT_MS = 6 * 60 * 60 * 1000;

/** A minimal execution shim: validates config + copies workspace only. */
export function dryRunCase(
  root: string,
  kase: EvalCase,
  workspaceRoot: string,
  runSetId: string,
  trial = 1,
): Effect.Effect<CaseResult, DriverError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const workspaceDir = yield* copyWorkspaceTemplate(root, kase, workspaceRoot, join(runSetId, `trial-${trial}`));
    return {
      caseId: kase.id,
      trial,
      runSetId,
      group: kase.group,
      ...(kase.dimensions === undefined ? {} : { dimensions: kase.dimensions }),
      tags: kase.tags.map((t) => t.tag),
      ...(kase.metric === undefined ? {} : { metric: kase.metric }),
      status: "skipped",
      workspaceDir,
      artifact: { verified: false, rawOutput: "dry-run: agent execution skipped" },
      error: "dry-run: agent execution skipped",
    } satisfies CaseResult;
  });
}

function pathExists(path: string | undefined): boolean {
  return path !== undefined && existsSync(path);
}

/** Add the evaluation contract after all run artifacts have been collected.
 * File checks stay at this driver boundary; acceptance, scoring, and timing
 * remain deterministic functions that can be tested without a filesystem. */
export function finalizeCaseResult(
  result: CaseResult,
  kase: Pick<EvalCase, "acceptance">,
): CaseResult {
  const evidence = assessCaseEvidence(result, {
    policy: kase.acceptance,
    availability: evidenceAvailability(result),
  });
  const comparison = compareBenchmark(
    usableBenchmarkValue(result.baseline),
    result.artifact.value,
    result.metric?.direction ?? result.baseline?.direction,
    result.metric?.name ?? result.baseline?.metric,
  );
  const timing = summarizeTiming(result);
  const enriched = {
    ...result,
    evidence,
    timing,
    ...(Object.keys(comparison).length === 0 ? {} : { baselineComparison: comparison }),
  } satisfies CaseResult;
  return { ...enriched, scorecard: buildCaseScorecard(enriched) };
}

function evidenceAvailability(result: CaseResult) {
  return {
    run: pathExists(result.runDir),
    trajectory: pathExists(result.trajectoryPath),
    evalMetrics: result.trace !== undefined,
    log: pathExists(result.logPath),
    trace: pathExists(result.tracePath),
    transcript: pathExists(result.transcriptPath),
  };
}

/**
 * Run a single case: copy the workspace template, invoke the launch command,
 * evaluate trace + artifact, and return a {@link CaseResult}.
 *
 * The launch command (`kase.command`) should reference a template that the
 * harness substitutes. The driver currently invokes it via bash with the
 * workspace as cwd and passes the workflow file as `--workflow`.
 */
export function runCase(
  root: string,
  kase: EvalCase,
  opts: EvalRunOptions,
): Effect.Effect<CaseResult, DriverError, FileSystem.FileSystem> {
  const workspaceRoot = opts.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT;
  const runSetId = opts.runSetId ?? defaultRunSetId();
  const trial = opts.trial ?? 1;
  return Effect.gen(function* () {
    if (opts.dryRun) {
      const dry = yield* dryRunCase(root, kase, workspaceRoot, runSetId, trial);
      return finalizeCaseResult({
        ...dry,
        ...(kase.metric === undefined ? {} : { metric: kase.metric }),
        ...(opts.variant === undefined ? {} : { variant: opts.variant }),
      }, kase);
    }
    const workspaceDir = yield* copyWorkspaceTemplate(root, kase, workspaceRoot, join(runSetId, `trial-${trial}`));
    if (kase.prepareCommand !== undefined) {
      const prepared = yield* Effect.tryPromise({
        try: () => runShell(kase.prepareCommand!, workspaceDir, 10 * 60 * 1000),
        catch: (cause) => new DriverError({ message: `prepare workspace for ${kase.id}: ${String(cause)}`, cause }),
      });
      if (prepared.code !== 0) {
        return yield* Effect.fail(new DriverError({
          message: `prepare workspace for ${kase.id} exited ${prepared.code}: ${prepared.stderr || prepared.stdout}`,
        }));
      }
    }
    const workspaceBaseline = yield* Effect.tryPromise({
      try: () => prepareWorkspaceDiffBaseline(workspaceDir),
      catch: (cause) => new DriverError({ message: `prepare workspace diff for ${kase.id}: ${String(cause)}`, cause }),
    });

    // Capture the grader-owned clean baseline before Piano is allowed to mutate
    // the copied workspace. This is intentionally outside the agent prompt.
    const baseline = opts.baseline ?? (yield* evaluateBaseline(kase, workspaceDir).pipe(
      Effect.mapError((cause) => new DriverError({ message: cause.message, cause })),
    ));

    // Execute the launch command. The artifact evaluator then verifies the
    // result inside the mutated workspace.
    const runsRoot = defaultRunsRoot();
    const readRunIds = Effect.promise(() => readdir(runsRoot).catch(() => [] as string[]));
    const before = new Set(yield* readRunIds);
    const command = substituteCommand(kase.command, {
      workspace: shellQuote(workspaceDir),
      prompt: shellQuote(kase.prompt),
      ...(kase.workflow === undefined ? {} : { workflow: shellQuote(join(workloadsDir(root), kase.id, kase.workflow)) }),
    });
    const startedAt = Date.now();
    const timeoutMs = opts.timeoutMs ?? (hasPerformanceReadout(kase) ? DEFAULT_PERFORMANCE_TIMEOUT_MS : undefined);
    const emit = opts.onProgress;
    const label = `${kase.id}#${trial}`;
    // CLI-only live progress: a started line plus one tick per 60s while the
    // child run is in flight, read from the run directory the child just
    // created. Binding uses the same workspace association as findNewRunDir;
    // while concurrent runs leave the association ambiguous the tick is
    // skipped rather than borrowed from another case.
    emit?.(`  ${label} started${kase.workflow === undefined ? "" : ` workflow=${kase.workflow}`} timeout=${timeoutMs === undefined ? "none" : `${Math.round(timeoutMs / 60_000)}m`}`);
    let lastTick = "";
    const poller = emit === undefined ? undefined : yield* Effect.gen(function* () {
      let watchedRunDir: string | undefined;
      for (;;) {
        yield* Effect.sleep("60 seconds");
        if (watchedRunDir === undefined) {
          const created = (yield* readRunIds)
            .filter((id) => !before.has(id))
            .sort();
          if (created.length === 0) continue;
          const associated = matchNewRunDir(runsRoot, created, workspaceDir);
          if (associated === undefined) continue;
          watchedRunDir = join(runsRoot, associated);
        }
        const tick = progressTickLine(label, watchedRunDir, startedAt);
        if (tick !== undefined && tick !== lastTick) {
          lastTick = tick;
          emit(tick);
        }
      }
    }).pipe(Effect.fork);
    const outcome = yield* Effect.tryPromise({
      try: () => runShell(command, workspaceDir, timeoutMs),
      catch: (cause) => new DriverError({ message: `run ${kase.id}: ${String(cause)}`, cause }),
    });
    if (poller !== undefined) yield* Fiber.interrupt(poller);

    const durationMs = Date.now() - startedAt;
    const codeChanges = yield* Effect.tryPromise({
      try: () => measureWorkspaceChanges(workspaceDir, workspaceBaseline),
      catch: (cause) => new DriverError({ message: `measure workspace diff for ${kase.id}: ${String(cause)}`, cause }),
    });
    const association = yield* findNewRunDir(runsRoot, before, workspaceDir, startedAt);
    const runDir = association.path;
    const evidence = runDir === undefined ? {} : evidencePaths(runDir);
    const traceOutcome = runDir === undefined
      ? undefined
      : yield* readRunTrace(runDir).pipe(Effect.either);
    const traceEvidence = traceOutcome === undefined
      ? {}
      : traceOutcome._tag === "Right"
        ? { trace: traceOutcome.right }
        : { traceError: traceOutcome.left.message };
    const statusSummary = runDir === undefined ? undefined : yield* readRunStatusSummary(runDir);
    const metricsDir = runDir !== undefined && evalMetricsAvailable(runDir)
      ? evalMetricsDir(runDir)
      : undefined;

    const shared = {
      caseId: kase.id,
      trial,
      runSetId,
      group: kase.group,
      ...(kase.dimensions === undefined ? {} : { dimensions: kase.dimensions }),
      tags: kase.tags.map((t) => t.tag),
      ...(kase.metric === undefined ? {} : { metric: kase.metric }),
      ...(opts.variant === undefined ? {} : { variant: opts.variant }),
      workspaceDir,
      durationMs,
      codeChanges,
      ...traceEvidence,
      ...(baseline === undefined ? {} : { baseline }),
      ...(statusSummary === undefined ? {} : { runStatus: statusSummary }),
      ...(metricsDir === undefined ? {} : { evalMetricsDir: metricsDir }),
    };

    if (association.reason !== undefined) {
      const associationError = outcome.code === 0
        ? association.reason
        : `launch command exited ${outcome.code}; ${association.reason}`;
      return finalizeCaseResult({
        ...shared,
        status: "failed",
        artifact: {
          verified: false,
          rawOutput: [outcome.stdout, outcome.stderr, associationError]
            .filter((part) => part !== "")
            .join("\n"),
        },
        error: associationError,
      }, kase);
    }
    if (outcome.code !== 0) {
      return finalizeCaseResult({
        ...shared,
        ...evidence,
        status: "failed",
        artifact: { verified: false, rawOutput: outcome.stderr },
        error: `launch command exited ${outcome.code}`,
      }, kase);
    }

    const artifact = yield* evaluateArtifact(kase, workspaceDir)
      .pipe(Effect.mapError((cause) => new DriverError({ message: cause.message, cause })));
    return finalizeCaseResult({
      ...shared,
      ...evidence,
      status: "completed",
      artifact,
    }, kase);
  });
}

/** The first present path of a run's evidence stream — current `system-log/`
 * layout first, the legacy root spelling second. Falls back to the primary
 * spelling so a missing stream is reported against where it would be. */
function resolveEvidencePath(candidates: readonly string[]): string {
  return candidates.find((path) => pathExists(path)) ?? candidates[0]!;
}

export function evidencePaths(runDir: string): Pick<CaseResult, "runDir" | "trajectoryPath" | "logPath" | "tracePath" | "transcriptPath" | "transcript"> {
  // The stream is the run's trajectory record; the document it used to be
  // folded into is gone, so the path names the stream.
  const trajectoryPath = resolveEvidencePath(trajectoryStreamPathCandidates(runDir));
  const transcriptPath = findTranscriptPath(runDir);
  return {
    runDir,
    ...(existsSync(trajectoryPath) ? { trajectoryPath } : {}),
    logPath: resolveEvidencePath(logStreamPathCandidates(runDir)),
    tracePath: resolveEvidencePath(traceStreamPathCandidates(runDir)),
    ...(transcriptPath === undefined ? {} : { transcriptPath, transcript: analyzeTranscriptFile(transcriptPath) }),
  };
}

export function findTranscriptPath(runDir: string): string | undefined {
  // The run's state document says where its transcript lives. The scan below
  // is for a run that failed before it recorded one.
  const recorded = readStatus(runDir)?.transcriptPath;
  if (typeof recorded === "string" && existsSync(recorded)) return recorded;
  const find = (directory: string): string | undefined => {
    try {
      for (const entry of readdirSync(directory, { withFileTypes: true, encoding: "utf8" })) {
        const path = join(directory, entry.name);
        if (entry.isFile() && entry.name.endsWith(".jsonl")) return path;
        if (entry.isDirectory()) {
          const found = find(path);
          if (found !== undefined) return found;
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  };
  // The current orchestrator writes one conversation directory per actor
  // under `sessions/`. Runs that fail before the top-level `transcriptPath` is
  // persisted (and every multi-stage run, which has no single root
  // transcript) rely on this fallback.
  return find(sessionsRoot(runDir));
}
