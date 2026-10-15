/**
 * Eval driver (A3) — loads case configs under the evals material root,
 * copies each case's workspace template to a per-run location, invokes the
 * declared launch command (which injects the workflow via `piano --workspace`),
 * then hands the mutated workspace + transcript to the evaluators.
 *
 * Two path roots, deliberately distinct:
 *   source (read-only case material) — `DEFAULT_EVALS_ROOT`, resolved from
 *       the package's own source via `import.meta.url`, so cases are found
 *       regardless of the caller's cwd. layout: `workloads/<case>/`.
 *   target (copy + execute) — `DEFAULT_WORKSPACE_ROOT`, an isolated
 *       user-level eval root; workspace templates are copied here and the launch
 *       command runs here.
 *
 * The driver writes case results back to a report (see scorer.ts) and, on
 * dry-run, validates configs without spawning any agent.
 */

import { Effect, Fiber } from "effect";
import { Data } from "effect";
import { FileSystem } from "@effect/platform";
import { iterationOfInvocationId } from "@piano/orchestrator";
import { execFile, spawn } from "node:child_process";
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hasPerformanceReadout, parseCaseConfig } from "./case-config.js";
import { evaluateArtifact, evaluateBaseline } from "./artifact-evaluator.js";
import { evaluateTrajectoryFile, evaluateTrajectory, TrajectoryEvalError } from "./trajectory-evaluator.js";
import {
  analyzeTranscriptText,
  assessCaseEvidence,
  buildCaseScorecard,
  compareBenchmark,
  summarizeTiming,
  usableBenchmarkValue,
} from "./evidence.js";
import type {
  BenchmarkMeasurement,
  CaseResult,
  CodeChangeMetrics,
  EvalCase,
  EvalRunOptions,
  StageTrajectoryMetrics,
  TrajectoryMetrics,
} from "./types.js";
import type { AgentEvent } from "@piano/harness";
import { parseTrajectory } from "@piano/logging";
import {
  workflowEvaluator,
  type WorkflowTrajectoryEvaluation,
} from "./workflow-evaluator.js";

export class DriverError extends Data.TaggedError("DriverError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// Source material (case.yaml, workflow.yml, workspace templates) is read-only
// non-code data that lives at the repository top level, under `evals/`
// (mirroring `recipes/`), NOT inside this package. Resolve it relative to
// this source file so `piano evals` works from any cwd (a user's target
// workspace), never from `process.cwd()`. `packages/evals/src/driver.ts` →
// `../../../evals` = the repository-root `evals/`.
export const DEFAULT_EVALS_ROOT = fileURLToPath(new URL("../../../evals", import.meta.url));

// Run target: workspace templates are copied into and executed under a
// dedicated user-level eval root, NOT the caller's cwd. The source material
// under `evals/workloads/<case>/workspace` is read-only; the agent's edits,
// `state/`, `bench/`, and `reports/` must land in an isolated per-run sandbox
// so they never mutate the checked-in template (ISSUE-016).
export const DEFAULT_WORKSPACE_ROOT = join(homedir(), ".piano", "evals");
// A workflow with a full performance readout can legitimately run many loop
// iterations. Case capability, not a task-family discriminator, selects this
// Performance cases retain a bounded default; coding cases without an explicit
// timeout run until their workflow exits.
export const DEFAULT_PERFORMANCE_TIMEOUT_MS = 6 * 60 * 60 * 1000;

/** Resolve the workloads directory given an evals root. */
export function workloadsDir(root: string): string {
  return join(root, "workloads");
}

function runGit(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", [...args], { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error === null) resolve(String(stdout).trim());
      else reject(new Error(String(stderr).trim() || error.message));
    });
  });
}

interface WorkspaceDiffBaseline {
  readonly gitDir: string;
  readonly commit: string;
}

/** Create the immutable grader baseline before the agent starts. The eval
 * workspace intentionally has its own repository so later agent commits do
 * not hide changes from this original tree. */
export async function prepareWorkspaceDiffBaseline(workspaceDir: string): Promise<WorkspaceDiffBaseline> {
  const gitDir = join(dirname(workspaceDir), ".grader", `${basename(workspaceDir)}.git`);
  await rm(gitDir, { recursive: true, force: true });
  await mkdir(dirname(gitDir), { recursive: true });
  await runGit(workspaceDir, ["init", "--bare", "--quiet", gitDir]);
  const repository = [`--git-dir=${gitDir}`, `--work-tree=${workspaceDir}`];
  await runGit(workspaceDir, [...repository, "add", "--force", "--all"]);
  await runGit(workspaceDir, [...repository,
    "-c", "user.name=Piano Evals",
    "-c", "user.email=evals@localhost",
    "commit", "--quiet", "--allow-empty", "--message=eval workspace baseline",
  ]);
  const commit = await runGit(workspaceDir, [...repository, "rev-parse", "HEAD"]);
  return { gitDir, commit };
}

/** Compare the delivered working tree with the grader baseline. Intent-to-add
 * makes untracked source files visible without staging their content. */
export async function measureWorkspaceChanges(
  workspaceDir: string,
  baseline: WorkspaceDiffBaseline,
): Promise<CodeChangeMetrics> {
  const repository = [`--git-dir=${baseline.gitDir}`, `--work-tree=${workspaceDir}`];
  await runGit(workspaceDir, [...repository, "add", "--intent-to-add", "--force", "--all"]);
  const output = await runGit(workspaceDir, [
    ...repository,
    "diff", "--no-ext-diff", "--no-renames", "--numstat", baseline.commit, "--", ".",
  ]);
  let files = 0;
  let additions = 0;
  let deletions = 0;
  let addedTestFiles = 0;
  let modifiedTestFiles = 0;
  let deletedTestFiles = 0;
  for (const line of output.split("\n")) {
    if (line === "") continue;
    const [added, deleted] = line.split("\t");
    files += 1;
    if (added !== "-") additions += Number(added ?? 0);
    if (deleted !== "-") deletions += Number(deleted ?? 0);
  }
  const nameStatus = await runGit(workspaceDir, [
    `--git-dir=${baseline.gitDir}`,
    `--work-tree=${workspaceDir}`,
    "diff", "--no-renames", "--name-status", baseline.commit, "--", ".",
  ]);
  const isTestPath = (filePath: string): boolean => {
    const segments = filePath.split("/");
    const file = segments.at(-1) ?? "";
    return segments.includes("test") || segments.includes("tests") ||
      /\.(test|spec)\.[^.]+$/.test(file);
  };
  for (const line of nameStatus.split("\n")) {
    if (line === "") continue;
    const [status, filePath] = line.split("\t");
    if (!isTestPath(filePath ?? "")) continue;
    if (status === "A") addedTestFiles += 1;
    else if (status === "M") modifiedTestFiles += 1;
    else if (status === "D") deletedTestFiles += 1;
  }
  return {
    files,
    additions,
    deletions,
    total: additions + deletions,
    testIntegrity: {
      cheating: modifiedTestFiles > 0 || deletedTestFiles > 0,
      addedFiles: addedTestFiles,
      modifiedFiles: modifiedTestFiles,
      deletedFiles: deletedTestFiles,
    },
  };
}

/** List case directory names under the workloads dir. */
export function listCaseDirs(
  root: string,
): Effect.Effect<readonly string[], DriverError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = workloadsDir(root);
    const exists = yield* fs.exists(dir).pipe(
      Effect.mapError((cause) => new DriverError({ message: String(cause), cause })),
    );
    if (!exists) return [] as const;
    const entries = yield* Effect.tryPromise({
      try: () => readdir(dir, { withFileTypes: true }),
      catch: (cause) => new DriverError({ message: String(cause), cause }),
    });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  });
}

/** Load one case config from `workloads/<caseDir>/case.yaml`. */
export function loadCase(
  root: string,
  caseDir: string,
): Effect.Effect<EvalCase, DriverError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const configPath = join(workloadsDir(root), caseDir, "case.yaml");
    const source = yield* fs.readFileString(configPath).pipe(
      Effect.mapError((cause) => new DriverError({ message: `read ${configPath}: ${String(cause)}`, cause })),
    );
    return yield* parseCaseConfig(source, configPath);
  }).pipe(
    Effect.mapError((cause) => new DriverError({ message: cause.message, cause })),
  );
}

/**
 * Whether a case belongs to a selection keyword.
 *
 * A keyword names a whole family of groups, not one exact string: `--group
 * tuning` selects `tuning` and `tuning-cuda` alike, the same way one display
 * family renders both. Anything finer — a single case, a cross-cutting
 * concern — is what the grader tags are for. The match is exact or on the
 * `-` boundary, so `tuning` never selects a hypothetical `tuningX`.
 */
export function matchesSelectionKeyword(
  group: string,
  tags: readonly string[],
  keyword: string,
): boolean {
  return group === keyword || group.startsWith(`${keyword}-`) || tags.includes(keyword);
}

/** Load all case configs, optionally filtered by a selection keyword (a group
 * family name or a grader tag, so `tflops` assembles every case carrying that
 * tag) and/or case id. */
export function loadCases(
  root: string,
  options?: { group?: string; caseId?: string },
): Effect.Effect<readonly EvalCase[], DriverError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const dirs = yield* listCaseDirs(root);
    const loaded = yield* Effect.forEach(dirs, (dir) => loadCase(root, dir));
    const group = options?.group;
    const caseId = options?.caseId;
    let filtered = loaded;
    if (group !== undefined) {
      filtered = filtered.filter((kase) =>
        matchesSelectionKeyword(kase.group, kase.tags.map((tag) => tag.tag), group));
    }
    if (caseId !== undefined) filtered = filtered.filter((kase) => kase.id === caseId);
    return filtered;
  });
}

/** Copy a case's workspace template to a per-run destination. */
export function copyWorkspaceTemplate(
  root: string,
  kase: EvalCase,
  workspaceRoot: string,
  runSetId: string,
): Effect.Effect<string, DriverError, FileSystem.FileSystem> {
  return Effect.tryPromise({
    try: async () => {
      const evalRoot = resolve(root);
      const source = resolve(workloadsDir(evalRoot), kase.id, kase.workspace);
      const sourceRelative = relative(evalRoot, source);
      if (sourceRelative === ".." || sourceRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(sourceRelative)) {
        throw new Error(`workspace template escapes eval root: ${kase.workspace}`);
      }
      const runRoot = resolve(workspaceRoot, runSetId);
      const dest = resolve(runRoot, kase.id);
      const destRelative = relative(runRoot, dest);
      if (destRelative === "" || destRelative === ".." || destRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(destRelative)) {
        throw new Error(`case id escapes run root: ${kase.id}`);
      }
      // A caller may intentionally reuse a run-set id while retrying a failed
      // eval. Recreate the per-case destination so stale artifacts cannot
      // become part of the grader-owned baseline or final readout.
      await rm(dest, { recursive: true, force: true });
      await mkdir(dest, { recursive: true });
      const sourceStat = await stat(source);
      if (sourceStat.isDirectory()) {
        await cp(source, dest, { recursive: true });
      } else if (sourceStat.isFile() && (source.endsWith(".tar.gz") || source.endsWith(".tgz"))) {
        await new Promise<void>((resolve, reject) => {
          execFile("tar", ["-xzf", source, "-C", dest, "--no-same-owner", "--no-same-permissions"], (error) => {
            if (error === null) resolve();
            else reject(error);
          });
        });
      } else {
        throw new Error(`workspace template must be a directory or .tar.gz archive: ${source}`);
      }
      return dest;
    },
    catch: (cause) => new DriverError({ message: `copy workspace for ${kase.id}: ${String(cause)}`, cause }),
  });
}

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
      trajectory: {
        messageCount: 0,
        assistantMessageCount: 0,
        rounds: 0,
        toolCallCount: 0,
        toolNames: [],
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
      },
      artifact: { verified: false, rawOutput: "dry-run: agent execution skipped" },
      error: "dry-run: agent execution skipped",
    } satisfies CaseResult;
  });
}

function pathExists(path: string | undefined): boolean {
  return path !== undefined && existsSync(path);
}

/** A run's trajectory is recorded in two forms and either one is the run: the
 * document, and the append-only stream beside it. */
function trajectoryAvailable(path: string | undefined): boolean {
  return pathExists(path) || pathExists(path === undefined ? undefined : `${path}l`);
}

function evidenceAvailability(result: CaseResult) {
  return {
    run: pathExists(result.runDir),
    trajectory: trajectoryAvailable(result.trajectoryPath),
    workflowTrajectory: result.workflowTrajectory !== undefined,
    log: pathExists(result.logPath),
    trace: pathExists(result.tracePath),
    transcript: pathExists(result.transcriptPath),
    progress: pathExists(result.progressPath),
  };
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

/**
 * Run a single case: copy the workspace template, invoke the launch command,
 * evaluate trajectory + artifact, and return a {@link CaseResult}.
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
    const runsRoot = join(homedir(), ".piano", "runs");
    const before = new Set(yield* Effect.promise(async () => {
      try {
        return await readdir(runsRoot);
      } catch {
        return [];
      }
    }));
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
          const created = (yield* Effect.tryPromise({
            try: async () => {
              try {
                return await readdir(runsRoot);
              } catch {
                return [];
              }
            },
            catch: () => "readdir failed" as const,
          }).pipe(Effect.catchAll(() => Effect.succeed([] as string[]))))
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
    }).pipe(Effect.tapBoth({
      onFailure: () => Effect.void,
      onSuccess: () => Effect.void,
    }));
    if (poller !== undefined) yield* Fiber.interrupt(poller);

    const durationMs = Date.now() - startedAt;
    const codeChanges = yield* Effect.tryPromise({
      try: () => measureWorkspaceChanges(workspaceDir, workspaceBaseline),
      catch: (cause) => new DriverError({ message: `measure workspace diff for ${kase.id}: ${String(cause)}`, cause }),
    });
    const association = yield* findNewRunDir(runsRoot, before, workspaceDir, startedAt);
    const runDir = association.path;
    const evidence = runDir === undefined ? {} : evidencePaths(runDir);
    const stageTrajectories = runDir === undefined ? [] : collectStageTrajectories(runDir);
    const progress = runDir === undefined ? [] : progressRecords(runDir);
    const progressPath = runDir === undefined ? undefined : join(runDir, "progress.jsonl");
    const progressSnapshotPath = runDir === undefined ? undefined : join(runDir, "progress.json");
    const progressEvidence = {
      ...(progressPath !== undefined && existsSync(progressPath) ? { progressPath, progress } : {}),
      ...(progressSnapshotPath !== undefined && existsSync(progressSnapshotPath)
        ? { progressSnapshotPath, progressSnapshot: progressSnapshot(runDir!) }
        : {}),
    };
    const workflowTrajectoryOutcome = runDir === undefined
      ? undefined
      : yield* workflowEvaluator.evaluate({ runDir }).pipe(Effect.either);
    const workflowTrajectoryIndexPath = runDir === undefined
      ? undefined
      : join(runDir, "trajectories", "index.json");
    const workflowTrajectoryEvidence = workflowTrajectoryOutcome === undefined
      ? {}
      : workflowTrajectoryOutcome._tag === "Right"
        ? {
            workflowTrajectory: workflowTrajectoryOutcome.right,
            ...(pathExists(workflowTrajectoryIndexPath)
              ? { workflowTrajectoryPath: workflowTrajectoryIndexPath }
              : {}),
          }
        : {
            ...(pathExists(workflowTrajectoryIndexPath)
              ? { workflowTrajectoryPath: workflowTrajectoryIndexPath }
              : {}),
            workflowTrajectoryError: workflowTrajectoryOutcome.left.message,
          };
    const workflowTrajectory = workflowTrajectoryOutcome?._tag === "Right"
      ? workflowTrajectoryOutcome.right
      : undefined;
    const measurements = workflowMeasurements(workflowTrajectory, kase.metric);
    const persistedTrajectory = yield* resolveTrajectory(runDir)
      .pipe(Effect.mapError((cause) => new DriverError({ message: cause.message, cause })));
    // Each Pi stage owns an independent usage stream. A run-level
    // trajectory.json therefore cannot be folded with max() across stages:
    // that would keep only the largest stage's token snapshot. Prefer the
    // stage-segmented aggregate whenever it is available; it also preserves
    // later loop invocations that resume the same transcript.
    const legacyTrajectory = stageTrajectories.length > 0
      ? aggregateStageTrajectories(stageTrajectories)
      : persistedTrajectory.messageCount === 0
        ? evidence.transcript === undefined
          ? persistedTrajectory
          : {
              ...persistedTrajectory,
              messageCount: evidence.transcript.messageCount,
              assistantMessageCount: evidence.transcript.assistantMessageCount,
              rounds: evidence.transcript.assistantMessageCount,
              toolCallCount: evidence.transcript.toolCallCount,
              toolNames: evidence.transcript.toolNames,
              inputTokens: evidence.transcript.inputTokens,
              outputTokens: evidence.transcript.outputTokens,
              cacheReadTokens: evidence.transcript.cacheReadTokens,
              cacheWriteTokens: evidence.transcript.cacheWriteTokens,
              totalTokens: evidence.transcript.totalTokens,
            }
        : persistedTrajectory;
    const trajectory = mergeWorkflowTrajectory(legacyTrajectory, workflowTrajectory);
    if (association.reason !== undefined) {
      const associationError = outcome.code === 0
        ? association.reason
        : `launch command exited ${outcome.code}; ${association.reason}`;
      return finalizeCaseResult({
        caseId: kase.id,
        trial,
        runSetId,
        group: kase.group,
        ...(kase.dimensions === undefined ? {} : { dimensions: kase.dimensions }),
        tags: kase.tags.map((t) => t.tag),
        ...(kase.metric === undefined ? {} : { metric: kase.metric }),
        ...(opts.variant === undefined ? {} : { variant: opts.variant }),
        status: "failed",
        workspaceDir,
        launch: { exitCode: outcome.code, stdout: outcome.stdout, stderr: outcome.stderr },
        durationMs,
        codeChanges,
        trajectory,
        ...(baseline === undefined ? {} : { baseline }),
        artifact: {
          verified: false,
          rawOutput: [outcome.stdout, outcome.stderr, associationError]
            .filter((part) => part !== "")
            .join("\n"),
          ...(baseline === undefined ? {} : { baseline }),
          ...(measurements.length === 0 ? {} : { measurements }),
        },
        ...workflowTrajectoryEvidence,
        ...(stageTrajectories.length === 0 ? {} : { stageTrajectories }),
        ...progressEvidence,
        error: associationError,
      } satisfies CaseResult, kase);
    }
    if (outcome.code !== 0) {
      return finalizeCaseResult({
        caseId: kase.id,
        trial,
        runSetId,
        group: kase.group,
        ...(kase.dimensions === undefined ? {} : { dimensions: kase.dimensions }),
        tags: kase.tags.map((t) => t.tag),
        ...(kase.metric === undefined ? {} : { metric: kase.metric }),
        ...(opts.variant === undefined ? {} : { variant: opts.variant }),
        status: "failed",
        workspaceDir,
        launch: { exitCode: outcome.code, stdout: outcome.stdout, stderr: outcome.stderr },
        ...evidence,
        durationMs,
        codeChanges,
        trajectory,
        ...(baseline === undefined ? {} : { baseline }),
        artifact: {
          verified: false,
          rawOutput: outcome.stderr,
          ...(baseline === undefined ? {} : { baseline }),
          ...(measurements.length === 0 ? {} : { measurements }),
        },
        ...workflowTrajectoryEvidence,
        ...(stageTrajectories.length === 0 ? {} : { stageTrajectories }),
        ...progressEvidence,
        error: `launch command exited ${outcome.code}`,
      } satisfies CaseResult, kase);
    }

    const artifact = yield* evaluateArtifact(kase, workspaceDir)
      .pipe(Effect.mapError((cause) => new DriverError({ message: cause.message, cause })));

    // Trajectory metrics: prefer transcript/trajectory under the workspace.
    return finalizeCaseResult({
      caseId: kase.id,
      trial,
      runSetId,
      group: kase.group,
      ...(kase.dimensions === undefined ? {} : { dimensions: kase.dimensions }),
      tags: kase.tags.map((t) => t.tag),
      ...(kase.metric === undefined ? {} : { metric: kase.metric }),
      ...(opts.variant === undefined ? {} : { variant: opts.variant }),
      status: "completed",
      workspaceDir,
      launch: { exitCode: outcome.code, stdout: outcome.stdout, stderr: outcome.stderr },
      ...evidence,
      durationMs,
      codeChanges,
      trajectory,
      ...(baseline === undefined ? {} : { baseline }),
      artifact: {
        ...artifact,
        ...(baseline === undefined ? {} : { baseline }),
        ...(measurements.length === 0 ? {} : { measurements }),
      },
      ...workflowTrajectoryEvidence,
      ...(stageTrajectories.length === 0 ? {} : { stageTrajectories }),
      ...progressEvidence,
    } satisfies CaseResult, kase);
  });
}

interface ShellResult { code: number; stdout: string; stderr: string }

function runShell(command: string, cwd: string, timeoutMs?: number): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", command], {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const terminate = (signal: NodeJS.Signals): void => {
      if (child.pid !== undefined) {
        try { process.kill(-child.pid, signal); } catch { /* process already exited */ }
      }
    };
    const timeout = timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      setTimeout(() => terminate("SIGKILL"), 5_000).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ code: 1, stdout, stderr: `${stderr}${String(error)}` });
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      resolve({ code: timedOut ? 124 : code ?? 1, stdout, stderr });
    });
  });
}

export function substituteCommand(command: string, vars: Record<string, string>): string {
  // Single pass: placeholders are matched as literal tokens and substituted
  // exactly once, so a substituted value is never rescanned (a prompt
  // containing another key's placeholder stays literal) and `$` patterns in
  // values carry no replacement semantics (callback form). Longest key first
  // prevents prefix shadowing; keys are regex-escaped because callers own
  // the map.
  const keys = Object.keys(vars).sort((a, b) => b.length - a.length);
  if (keys.length === 0) return command;
  const pattern = new RegExp(keys.map((key) => `<${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>`).join("|"), "g");
  return command.replace(pattern, (match) => vars[match.slice(1, -1)]!);
}

export function shellQuote(value: string): string {
  // Standard POSIX idiom for a literal single quote inside single quotes:
  // close the quote, emit an escaped `'`, reopen the quote -> `'\''`.
  // The previous `'"'"'` double-quote idiom also emitted stray backslashes
  // (`'\"'\"'`), which broke argv splitting for prompts containing apostrophes.
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function evidencePaths(runDir: string): Pick<CaseResult, "runDir" | "trajectoryPath" | "logPath" | "tracePath" | "transcriptPath" | "transcript"> {
  const trajectoryPath = join(runDir, "trajectory.json");
  const transcriptPath = findTranscriptPath(runDir);
  return {
    runDir,
    ...(existsSync(trajectoryPath) ? { trajectoryPath } : {}),
    logPath: join(runDir, "log.jsonl"),
    tracePath: join(runDir, "trace.jsonl"),
    ...(transcriptPath === undefined ? {} : { transcriptPath, transcript: analyzeTranscript(transcriptPath) }),
  };
}

interface TranscriptRange {
  readonly startedAt?: string;
  readonly completedAt?: string;
}

function analyzeTranscript(path: string, range: TranscriptRange = {}): NonNullable<CaseResult["transcript"]> {
  try {
    return analyzeTranscriptText(path, readFileSync(path, "utf8"), range);
  } catch {
    return {
      messageCount: 0,
      userMessageCount: 0,
      assistantMessageCount: 0,
      toolResultCount: 0,
      toolCallCount: 0,
      toolNames: [],
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      finalText: "",
      fullText: "",
      valid: false,
      issues: [{ kind: "structure", line: 0, message: "transcript could not be read" }],
    };
  }
}

function trajectoryMetricsFromTranscriptAnalysis(
  transcript: NonNullable<CaseResult["transcript"]>,
): TrajectoryMetrics {
  return {
    messageCount: transcript.messageCount,
    assistantMessageCount: transcript.assistantMessageCount,
    rounds: transcript.assistantMessageCount,
    toolCallCount: transcript.toolCallCount,
    toolNames: transcript.toolNames,
    inputTokens: transcript.inputTokens,
    outputTokens: transcript.outputTokens,
    cacheReadTokens: transcript.cacheReadTokens,
    cacheWriteTokens: transcript.cacheWriteTokens,
    totalTokens: transcript.totalTokens,
  };
}

interface HandoffRecord {
  id?: unknown;
  stageId?: unknown;
  stage?: unknown;
  worker?: unknown;
  sessionId?: unknown;
  transcriptPath?: unknown;
  requestedModel?: unknown;
  requestedThinkingLevel?: unknown;
  model?: unknown;
  thinkingLevel?: unknown;
  workspace?: { cwd?: unknown };
}

export function readHandoffRecords(runDir: string): HandoffRecord[] {
  const records: HandoffRecord[] = [];
  const visit = (directory: string): void => {
    try {
      for (const entry of readdirSync(directory, { withFileTypes: true, encoding: "utf8" })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.name === "record.json") {
          try {
            const value = JSON.parse(readFileSync(path, "utf8")) as { producer?: unknown };
            if (typeof value.producer === "object" && value.producer !== null) records.push(value.producer as HandoffRecord);
          } catch {
            // A malformed record remains visible through the run logs; it is
            // excluded from derived metrics rather than guessed.
          }
        }
      }
    } catch {
      // The run may have failed before creating handoff records.
    }
  };
  // `executions/` is the historical run layout; the current orchestrator
  // writes invocation directories (and their handoff records) under
  // `prompts/<n>/invocations/`. Scan both so evidence is complete for
  // either layout.
  visit(join(runDir, "executions"));
  visit(join(runDir, "prompts"));
  return records.sort((left, right) => String(left.id ?? "").localeCompare(String(right.id ?? "")));
}

function trajectoryEvents(runDir: string): Array<Record<string, unknown>> {
  const read = (name: string): string | undefined => {
    try {
      return readFileSync(join(runDir, name), "utf8");
    } catch {
      return undefined;
    }
  };
  // Both of a run's forms, the stream first: it is the record and the document
  // beside it is folded from it, so either one describes the run.
  const stream = read("trajectory.jsonl");
  const document = read("trajectory.json");
  const trajectory = parseTrajectory({
    ...(stream === undefined ? {} : { stream }),
    ...(document === undefined ? {} : { document }),
  });
  const events: readonly unknown[] = trajectory?.events ?? [];
  return events.filter((event): event is Record<string, unknown> => typeof event === "object" && event !== null);
}

interface StageLogEvidence {
  readonly invocationId: string;
  readonly stageId?: string;
  readonly worker?: string;
  readonly workspaceCwd?: string;
  readonly transcriptPath?: string;
  readonly sessionId?: string;
  readonly requestedModel?: string;
  readonly requestedThinkingLevel?: string;
  readonly requestedTools?: readonly string[];
  readonly model?: string;
  readonly thinkingLevel?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

/** Recover invocation/transcript metadata even when a process is terminated
 * before the run-level trajectory.json is flushed. The orchestrator logs the
 * schedule and Pi session artifact events before each model turn, so this is
 * a read-only reconstruction from durable evidence, never a guessed result. */
function stageLogEvidence(runDir: string): StageLogEvidence[] {
  const byId = new Map<string, StageLogEvidence>();
  const pendingByStage = new Map<string, string[]>();
  const sessionToInvocation = new Map<string, string>();
  const stageFromTranscript = (path: string): string | undefined => {
    const parts = path.replaceAll("\\", "/").split("/");
    const actorIndex = parts.lastIndexOf("actors");
    return actorIndex >= 0 ? parts[actorIndex + 2] : undefined;
  };
  const update = (id: string, patch: Partial<StageLogEvidence>): void => {
    const previous = byId.get(id) ?? { invocationId: id };
    byId.set(id, { ...previous, ...patch });
  };
  try {
    const lines = readFileSync(join(runDir, "log.jsonl"), "utf8").split("\n");
    for (const line of lines) {
      if (line.trim() === "") continue;
      let value: Record<string, unknown>;
      try { value = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      const event = typeof value.event === "string" ? value.event : undefined;
      const attributes = typeof value.attributes === "object" && value.attributes !== null
        ? value.attributes as Record<string, unknown>
        : typeof value.data === "object" && value.data !== null
          ? value.data as Record<string, unknown>
          : {};
      if (event === "workflow.scheduled" || event === "stage.started") {
        const id = typeof attributes.id === "string" ? attributes.id : undefined;
        if (id === undefined) continue;
        const stageId = typeof attributes.stageId === "string"
          ? attributes.stageId
          : typeof value.stage === "string" ? value.stage : undefined;
        const worker = typeof value.agent === "string" ? value.agent : undefined;
        const workspace = typeof attributes.workspace === "object" && attributes.workspace !== null
          ? attributes.workspace as Record<string, unknown>
          : undefined;
        update(id, {
          stageId,
          worker,
          ...(typeof workspace?.cwd === "string" ? { workspaceCwd: workspace.cwd } : {}),
          ...(typeof attributes.requestedModel === "string" ? { requestedModel: attributes.requestedModel } : {}),
          ...(typeof attributes.requestedThinkingLevel === "string" ? { requestedThinkingLevel: attributes.requestedThinkingLevel } : {}),
          ...(Array.isArray(attributes.tools) && attributes.tools.every((tool): tool is string => typeof tool === "string")
            ? { requestedTools: attributes.tools }
            : {}),
        });
        if (event === "workflow.scheduled" && stageId !== undefined) {
          const queue = pendingByStage.get(stageId) ?? [];
          if (!queue.includes(id)) queue.push(id);
          pendingByStage.set(stageId, queue);
        }
        continue;
      }
      if (event === "agent.session.artifact.loaded") {
        const transcriptPath = typeof attributes.transcriptPath === "string" ? attributes.transcriptPath : undefined;
        const sessionId = typeof attributes.sessionId === "string" ? attributes.sessionId : undefined;
        if (transcriptPath === undefined) continue;
        const stageId = stageFromTranscript(transcriptPath);
        const queue = stageId === undefined ? undefined : pendingByStage.get(stageId);
        const id = queue?.shift();
        if (id !== undefined) {
          update(id, { transcriptPath, ...(sessionId === undefined ? {} : { sessionId }) });
          if (sessionId !== undefined) sessionToInvocation.set(sessionId, id);
        }
        continue;
      }
      if (event === "agent.event.received" && attributes.eventType === "spawn") {
        const sessionId = typeof attributes.sessionId === "string" ? attributes.sessionId : undefined;
        const id = sessionId === undefined ? undefined : sessionToInvocation.get(sessionId);
        if (id === undefined) continue;
        update(id, {
          ...(typeof attributes.model === "string" ? { model: attributes.model } : {}),
          ...(typeof attributes.thinkingLevel === "string" ? { thinkingLevel: attributes.thinkingLevel } : {}),
        });
        continue;
      }
      if (event === "agent.turn.started" || event === "agent.turn.completed") {
        const sessionId = typeof attributes.sessionId === "string" ? attributes.sessionId : undefined;
        const id = sessionId === undefined ? undefined : sessionToInvocation.get(sessionId);
        const timestamp = typeof value.timestamp === "string" ? value.timestamp : undefined;
        if (id === undefined || timestamp === undefined) continue;
        update(id, event === "agent.turn.started"
          ? { startedAt: byId.get(id)?.startedAt === undefined ? timestamp : byId.get(id)?.startedAt }
          : { completedAt: timestamp });
      }
    }
  } catch {
    // Partial/absent logs are represented by the other evidence sources.
  }
  return [...byId.values()];
}

function collectStageTrajectories(runDir: string): StageTrajectoryMetrics[] {
  const records = readHandoffRecords(runDir);
  const logEvidence = stageLogEvidence(runDir);
  const events = trajectoryEvents(runDir);
  const grouped = new Map<string, AgentEvent[]>();
  const order: string[] = [];
  for (const raw of events) {
    const workflow = raw.workflow;
    if (typeof workflow !== "object" || workflow === null) continue;
    const invocationId = typeof (workflow as { invocationId?: unknown }).invocationId === "string"
      ? (workflow as { invocationId: string }).invocationId
      : undefined;
    if (invocationId === undefined) continue;
    if (!grouped.has(invocationId)) order.push(invocationId);
    const existing = grouped.get(invocationId) ?? [];
    existing.push(raw as unknown as AgentEvent);
    grouped.set(invocationId, existing);
  }
  const recordById = new Map(records.map((record) => [String(record.id ?? ""), record]));
  const logById = new Map(logEvidence.map((evidence) => [evidence.invocationId, evidence]));
  const ids = [...new Set([
    ...order,
    ...records.map((record) => String(record.id ?? "")),
    ...logEvidence.map((evidence) => evidence.invocationId),
  ])].filter(Boolean);
  return ids.map((invocationId): StageTrajectoryMetrics => {
    const invocationEvents = grouped.get(invocationId) ?? [];
    const first = invocationEvents[0];
    const workflow = first?.workflow as {
      stageId?: string;
      worker?: string;
      workspaceCwd?: string;
    } | undefined;
    const record = recordById.get(invocationId);
    const log = logById.get(invocationId);
    const spawn = invocationEvents.find((event) => event.type === "spawn") as Extract<AgentEvent, { type: "spawn" }> | undefined;
    const transcriptPath = typeof record?.transcriptPath === "string"
      ? record.transcriptPath
      : log?.transcriptPath;
    const transcriptAnalysis = transcriptPath === undefined
      ? undefined
      : analyzeTranscript(transcriptPath, {
          startedAt: log?.startedAt,
          completedAt: log?.completedAt,
        });
    const metrics = invocationEvents.length > 0
      ? evaluateTrajectory(invocationEvents)
      : transcriptAnalysis === undefined
        ? evaluateTrajectory([])
        : trajectoryMetricsFromTranscriptAnalysis(transcriptAnalysis);
    const iteration = iterationOfInvocationId(invocationId);
    return {
      ...metrics,
      stageId: typeof workflow?.stageId === "string" ? workflow.stageId : typeof record?.stageId === "string" ? record.stageId : log?.stageId ?? "unknown",
      invocationId,
      worker: typeof workflow?.worker === "string" ? workflow.worker : typeof record?.worker === "string" ? record.worker : log?.worker ?? "unknown",
      ...(transcriptPath === undefined ? {} : { transcriptPath }),
      ...(transcriptAnalysis === undefined ? {} : {
        transcriptValid: transcriptAnalysis.valid,
        transcriptIssues: transcriptAnalysis.issues,
        transcriptUserMessageCount: transcriptAnalysis.userMessageCount,
        transcriptToolResultCount: transcriptAnalysis.toolResultCount,
      }),
      ...(typeof record?.requestedModel === "string"
        ? { requestedModel: record.requestedModel }
        : log?.requestedModel === undefined ? {} : { requestedModel: log.requestedModel }),
      ...(typeof record?.requestedThinkingLevel === "string"
        ? { requestedThinkingLevel: record.requestedThinkingLevel }
        : log?.requestedThinkingLevel === undefined ? {} : { requestedThinkingLevel: log.requestedThinkingLevel }),
      ...(log?.requestedTools === undefined ? {} : { requestedTools: log.requestedTools }),
      ...(typeof spawn?.model === "string" ? { model: spawn.model } : typeof record?.model === "string" ? { model: record.model } : log?.model === undefined ? {} : { model: log.model }),
      ...(spawn?.thinkingLevel !== undefined
        ? { thinkingLevel: spawn.thinkingLevel }
        : typeof record?.thinkingLevel === "string"
          ? { thinkingLevel: record.thinkingLevel }
          : log?.thinkingLevel === undefined ? {} : { thinkingLevel: log.thinkingLevel }),
      ...(typeof workflow?.workspaceCwd === "string"
        ? { workspaceCwd: workflow.workspaceCwd }
        : typeof record?.workspace?.cwd === "string" ? { workspaceCwd: record.workspace.cwd } : log?.workspaceCwd === undefined ? {} : { workspaceCwd: log.workspaceCwd }),
      ...(iteration === undefined ? {} : { iteration }),
      ...(() => {
        if (log?.startedAt === undefined || log.completedAt === undefined) return {};
        const durationMs = Date.parse(log.completedAt) - Date.parse(log.startedAt);
        return Number.isFinite(durationMs) ? { durationMs: Math.max(0, durationMs) } : {};
      })(),
    };
  });
}

/** Fold stage-level evidence into one run metric. Each stage invocation is a
 * separate usage stream even when a loop actor resumes the same transcript,
 * so every invocation is summed exactly once. */
export function aggregateStageTrajectories(
  stages: readonly StageTrajectoryMetrics[],
): TrajectoryMetrics {
  const toolNames = new Set<string>();
  for (const stage of stages) for (const name of stage.toolNames) toolNames.add(name);
  return {
    messageCount: stages.reduce((sum, stage) => sum + stage.messageCount, 0),
    assistantMessageCount: stages.reduce((sum, stage) => sum + stage.assistantMessageCount, 0),
    rounds: stages.reduce((sum, stage) => sum + stage.rounds, 0),
    toolCallCount: stages.reduce((sum, stage) => sum + stage.toolCallCount, 0),
    toolNames: [...toolNames],
    inputTokens: stages.reduce((sum, stage) => sum + stage.inputTokens, 0),
    outputTokens: stages.reduce((sum, stage) => sum + stage.outputTokens, 0),
    cacheReadTokens: stages.reduce((sum, stage) => sum + stage.cacheReadTokens, 0),
    cacheWriteTokens: stages.reduce((sum, stage) => sum + stage.cacheWriteTokens, 0),
    totalTokens: stages.reduce((sum, stage) => sum + stage.totalTokens, 0),
  };
}

function progressRecords(runDir: string): Record<string, unknown>[] {
  try {
    return readFileSync(join(runDir, "progress.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as unknown)
      .filter((record): record is Record<string, unknown> => typeof record === "object" && record !== null);
  } catch {
    return [];
  }
}

function progressSnapshot(runDir: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(readFileSync(join(runDir, "progress.json"), "utf8")) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

/** One live-progress tick for a run still in flight: wall time, stage
 * completion from the progress snapshot, and the trajectory's iteration
 * count plus latest best metric from benchmark.jsonl. Everything read here
 * is append-only or atomically replaced, so a torn mid-write simply yields a
 * slightly stale (or skipped, returning undefined) tick. Exported for
 * testing; the CLI progress path is runCase's poller. */
export function progressTickLine(label: string, runDir: string, startedAt: number): string | undefined {
  const snapshot = progressSnapshot(runDir);
  const completed = typeof snapshot?.completedStages === "number" ? snapshot.completedStages : undefined;
  const planned = typeof snapshot?.plannedStages === "number" ? snapshot.plannedStages : undefined;
  const current = typeof snapshot?.current === "object" && snapshot.current !== null
    ? snapshot.current as Record<string, unknown>
    : undefined;
  const currentStage = typeof current?.stageId === "string" ? current.stageId : undefined;
  let iteration: number | undefined;
  let best: string | undefined;
  try {
    const records: { iteration?: number; metric?: { name?: string; best?: number } }[] = [];
    for (const line of readFileSync(join(runDir, "trajectories", "benchmark.jsonl"), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        records.push(JSON.parse(line) as { iteration?: number; metric?: { name?: string; best?: number } });
      } catch {
        // A line torn mid-append is skipped; the next tick sees it whole.
      }
    }
    const usable = records.filter((record) => typeof record.metric?.best === "number");
    for (const record of usable) {
      if (typeof record.iteration === "number") iteration = Math.max(iteration ?? -1, record.iteration);
    }
    // All-time best across iterations. The latest record's metric.best is a
    // per-iteration value that dips when an idea is reverted, and a "best"
    // that goes backwards is misleading in a live monitor.
    let topBest: number | undefined;
    let topName: string | undefined;
    for (const record of usable) {
      const value = record.metric!.best!;
      if (topBest === undefined || value > topBest) {
        topBest = value;
        topName = record.metric!.name;
      }
    }
    if (topBest !== undefined) {
      best = `${topBest.toFixed(4)}${topName === undefined ? "" : ` ${topName}`}`;
    }
  } catch {
    // benchmark.jsonl missing — report the stage fields only.
  }
  if (completed === undefined && iteration === undefined) return undefined;
  const parts = [
    `  ${label}`,
    `elapsed=${Math.round((Date.now() - startedAt) / 60_000)}m`,
    completed === undefined || planned === undefined ? undefined : `stages=${completed}/${planned}`,
    currentStage === undefined ? undefined : `current=${currentStage}`,
    iteration === undefined ? undefined : `iter=${iteration}`,
    best === undefined ? undefined : `best=${best}`,
  ];
  return parts.filter((part): part is string => part !== undefined).join(" ");
}

function workflowMeasurements(
  evaluation: WorkflowTrajectoryEvaluation | undefined,
  metric: EvalCase["metric"],
): BenchmarkMeasurement[] {
  if (evaluation === undefined) return [];
  return evaluation.benchmarks
    .filter((point) => metric === undefined ||
      (point.name === metric.name && point.direction === metric.direction))
    .map((point) => ({
      value: point.value,
      metric: point.name,
      ...(point.unit === undefined ? {} : { unit: point.unit }),
      direction: point.direction,
      rawOutput: JSON.stringify(point),
      passed: point.accepted,
      source: evaluation.source === "native" ? "trajectory" as const : "progress" as const,
      ...(point.iteration === undefined ? {} : { iteration: point.iteration }),
      ...(point.invocationId === undefined ? {} : { invocationId: point.invocationId }),
    }));
}

function mergeWorkflowTrajectory(
  legacy: TrajectoryMetrics,
  evaluation: WorkflowTrajectoryEvaluation | undefined,
): TrajectoryMetrics {
  if (evaluation?.source !== "native") return legacy;
  return {
    ...legacy,
    toolCallCount: evaluation.tools.count,
    toolNames: [...evaluation.tools.names],
    inputTokens: evaluation.tokens.input,
    outputTokens: evaluation.tokens.output,
    cacheReadTokens: evaluation.tokens.cacheRead,
    cacheWriteTokens: evaluation.tokens.cacheWrite,
    totalTokens: evaluation.tokens.total,
  };
}

export function findTranscriptPath(runDir: string): string | undefined {
  try {
    // The run's state document says where its transcript lives. The scan below
    // is for a run that failed before it recorded one.
    const raw = readFileSync(join(runDir, "status.json"), "utf8");
    const status = JSON.parse(raw) as { transcriptPath?: unknown };
    if (typeof status.transcriptPath === "string" && existsSync(status.transcriptPath)) {
      return status.transcriptPath;
    }
  } catch {
    // A run can fail before its state is recorded; fall through to evidence discovery.
  }
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
  // `executions/` is the historical transcript root; the current orchestrator
  // writes actor session transcripts under `actors/<harness>/<stage>/…`.
  // Runs that fail before the top-level `transcriptPath` is persisted (and
  // every multi-stage run, which has no single root transcript) rely on this
  // fallback, so it must cover both layouts.
  return find(join(runDir, "executions")) ?? find(join(runDir, "actors"));
}

export interface RunDirectoryAssociation {
  readonly path?: string;
  readonly reason?: string;
  readonly candidates: readonly string[];
}

function containsValue(value: unknown, expected: string): boolean {
  if (value === expected) return true;
  if (Array.isArray(value)) return value.some((item) => containsValue(item, expected));
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).some((item) => containsValue(item, expected));
}

function referencesWorkspace(raw: string, workspaceDir: string): boolean {
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      if (containsValue(JSON.parse(line) as unknown, workspaceDir)) return true;
    } catch {
      // A malformed evidence line cannot establish ownership.
    }
  }
  return false;
}

/** The evidence streams that carry a run's workspace reference. */
const RUN_EVIDENCE_FILES = ["log.jsonl", "progress.jsonl", "trace.jsonl"] as const;

interface RunWorkspaceEvidence {
  readonly observed: boolean;
  readonly matches: boolean;
}

/** Shared association probe: does this run directory reference `workspaceDir`
 * in any evidence stream it has emitted so far? `observed` distinguishes "no
 * reference yet" from "emitted evidence that names another workspace". */
function inspectRunWorkspace(runsRoot: string, id: string, workspaceDir: string): RunWorkspaceEvidence {
  let observed = false;
  try {
    for (const file of RUN_EVIDENCE_FILES) {
      try {
        const content = readFileSync(join(runsRoot, id, file), "utf8");
        observed = true;
        if (referencesWorkspace(content, workspaceDir)) return { observed, matches: true };
      } catch {
        // A partial run may not have emitted every evidence stream yet.
      }
    }
  } catch {
    // The directory may disappear while a concurrent run is cleaned up.
  }
  return { observed, matches: false };
}

/** Choose which newly created run directory a live-progress poller may bind
 * to. A single candidate passes through — a later completion-time
 * `findNewRunDir` still verifies or fails closed before any evidence is
 * attributed. With concurrent launches, bind only on a unique workspace
 * match; otherwise return undefined so the caller skips the tick rather than
 * showing another run's progress under this case's label. */
export function matchNewRunDir(
  runsRoot: string,
  createdIds: readonly string[],
  workspaceDir: string,
): string | undefined {
  if (createdIds.length === 1) return createdIds[0];
  if (createdIds.length === 0) return undefined;
  const matches = createdIds.filter((id) => inspectRunWorkspace(runsRoot, id, workspaceDir).matches);
  return matches.length === 1 ? matches[0] : undefined;
}

export function findNewRunDir(
  runsRoot: string,
  before: ReadonlySet<string>,
  workspaceDir: string,
  startedAt: number,
): Effect.Effect<RunDirectoryAssociation, DriverError> {
  return Effect.tryPromise({
    try: async () => {
      let after: string[];
      try {
        after = await readdir(runsRoot);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
          return {
            candidates: [],
            reason: `no Piano run directory was created for workspace ${workspaceDir}`,
          };
        }
        throw cause;
      }
      const created = after
        .filter((id) => !before.has(id))
        .filter((id) => {
          try {
            return statSync(join(runsRoot, id)).mtimeMs >= startedAt - 1_000;
          } catch {
            return false;
          }
        })
        .sort();
      if (created.length === 0) {
        return {
          candidates: [],
          reason: `no new Piano run directory was created for workspace ${workspaceDir}`,
        };
      }

      // Concurrent evals can create several run directories during the same
      // launch window. Associate by the durable workspace path emitted in the
      // run log; when no unique match exists, fail closed rather than attaching
      // another run's transcript to this case.
      const inspected = created.map((id) => ({ id, ...inspectRunWorkspace(runsRoot, id, workspaceDir) }));
      const matches = inspected.filter((candidate) => candidate.matches).map((candidate) => candidate.id);
      if (created.length === 1) {
        const candidate = inspected[0];
        if (candidate?.observed === true && candidate.matches === false) {
          return {
            candidates: created,
            reason: `new Piano run does not reference workspace ${workspaceDir}; candidates: ${created.join(", ")}`,
          };
        }
        return { path: join(runsRoot, created[0] ?? ""), candidates: created };
      }
      if (matches.length === 1) {
        return { path: join(runsRoot, matches[0] ?? ""), candidates: created };
      }
      return {
        candidates: created,
        reason: matches.length === 0
          ? `could not associate Piano run with workspace ${workspaceDir}; candidates: ${created.join(", ")}`
          : `multiple Piano runs match workspace ${workspaceDir}; candidates: ${matches.join(", ")}`,
      };
    },
    catch: (cause) => new DriverError({ message: `list Piano runs: ${String(cause)}`, cause }),
  });
}

function defaultRunSetId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const millis = String(now.getMilliseconds()).padStart(3, "0");
  return `eval-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.${millis}`;
}

function resolveTrajectory(
  runDir: string | undefined,
): Effect.Effect<TrajectoryMetrics, TrajectoryEvalError> {
  // Both forms, the document first: a run recorded only in its stream has no
  // document to name, and either path resolves both files.
  const candidates = runDir === undefined ? [] : [join(runDir, "trajectory.json"), join(runDir, "trajectory.jsonl")];
  const empty: TrajectoryMetrics = {
    messageCount: 0, assistantMessageCount: 0, rounds: 0, toolCallCount: 0,
    toolNames: [], inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0,
  };
  return Effect.gen(function* () {
    for (const candidate of candidates) {
      const found = Effect.sync(() => {
        try {
          return statSync(candidate).isFile();
        } catch {
          return false;
        }
      });
      if (yield* found) return yield* evaluateTrajectoryFile(candidate);
    }
    return empty;
  });
}

/** Remove the workspace root (used by callers to clean up). */
export function cleanWorkspaces(workspaceRoot: string): Promise<void> {
  return rm(workspaceRoot, { recursive: true, force: true });
}
