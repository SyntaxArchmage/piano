/**
 * Eval workspace materialization: copy a case's workspace template into the
 * per-run sandbox, and own the grader's immutable diff baseline (what the
 * agent changed from its pristine start).
 */
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { io } from "@piano/base";
import { workloadsDir } from "./case-loader.js";
import { DriverError } from "./errors.js";
import type { CodeChangeMetrics, EvalCase } from "./types.js";

// Run target: workspace templates are copied into and executed under the
// evals root the pipeline names, NOT the caller's cwd. The source material
// under `evals/workloads/<case>/workspace` is read-only; the agent's edits,
// `state/`, `bench/`, and `reports/` must land in an isolated per-run sandbox
// so they never mutate the checked-in template (ISSUE-016).

/** The Error the promise adapter this replaced handed to `String(cause)`:
 * a node failure strings as `Error: <message>`. */
function ioCause(cause: io.IoError): Error {
  return new Error(cause.message);
}

/** One `git` invocation. A failure prefers stderr, matching the promise
 * adapter that used to wrap `execFile`. */
function gitEffect(cwd: string, args: readonly string[]): Effect.Effect<string, DriverError> {
  return io.execFile("git", [...args], { cwd, maxBuffer: 10 * 1024 * 1024 }).pipe(
    Effect.map((result) => result.stdout.trim()),
    Effect.mapError((cause) => {
      const stderr = cause.stderr ?? "";
      const error = new Error(stderr.trim() !== "" ? stderr.trim() : cause.message);
      return new DriverError({ message: String(error), cause: error });
    }),
  );
}

function fileSystemEffect<A>(effect: Effect.Effect<A, io.IoError>): Effect.Effect<A, DriverError> {
  return effect.pipe(Effect.mapError((cause) => {
    const error = ioCause(cause);
    return new DriverError({ message: String(error), cause: error });
  }));
}

interface WorkspaceDiffBaseline {
  readonly gitDir: string;
  readonly commit: string;
}

/** Create the immutable grader baseline before the agent starts. The eval
 * workspace intentionally has its own repository so later agent commits do
 * not hide changes from this original tree. */
export function prepareWorkspaceDiffBaseline(
  workspaceDir: string,
): Effect.Effect<WorkspaceDiffBaseline, DriverError> {
  return Effect.gen(function* () {
    const gitDir = join(dirname(workspaceDir), ".grader", `${basename(workspaceDir)}.git`);
    yield* fileSystemEffect(io.rm(gitDir, { recursive: true, force: true }));
    yield* fileSystemEffect(io.mkdir(dirname(gitDir), { recursive: true }));
    yield* gitEffect(workspaceDir, ["init", "--bare", "--quiet", gitDir]);
    const repository = [`--git-dir=${gitDir}`, `--work-tree=${workspaceDir}`];
    yield* gitEffect(workspaceDir, [...repository, "add", "--force", "--all"]);
    yield* gitEffect(workspaceDir, [...repository,
      "-c", "user.name=Piano Evals",
      "-c", "user.email=evals@localhost",
      "commit", "--quiet", "--allow-empty", "--message=eval workspace baseline",
    ]);
    const commit = yield* gitEffect(workspaceDir, [...repository, "rev-parse", "HEAD"]);
    return { gitDir, commit };
  });
}

/** Compare the delivered working tree with the grader baseline. Intent-to-add
 * makes untracked source files visible without staging their content. */
export function measureWorkspaceChanges(
  workspaceDir: string,
  baseline: WorkspaceDiffBaseline,
): Effect.Effect<CodeChangeMetrics, DriverError> {
  return Effect.gen(function* () {
    const repository = [`--git-dir=${baseline.gitDir}`, `--work-tree=${workspaceDir}`];
    yield* gitEffect(workspaceDir, [...repository, "add", "--intent-to-add", "--force", "--all"]);
    const output = yield* gitEffect(workspaceDir, [
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
    const nameStatus = yield* gitEffect(workspaceDir, [
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
  });
}

/** Copy a case's workspace template to a per-run destination. */
export function copyWorkspaceTemplate(
  root: string,
  kase: EvalCase,
  workspaceRoot: string,
  runSetId: string,
): Effect.Effect<string, DriverError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    // Leaf failures keep the copy step's own wording, matching the boundary
    // that previously wrapped the whole operation.
    const copyFailure = (cause: unknown): DriverError =>
      new DriverError({ message: `copy workspace for ${kase.id}: ${String(cause)}`, cause });
    const copyLeaf = <A>(effect: Effect.Effect<A, io.IoError>): Effect.Effect<A, DriverError> =>
      effect.pipe(Effect.mapError((cause) => copyFailure(ioCause(cause))));
    const reject = (message: string): Effect.Effect<never, DriverError> =>
      Effect.fail(copyFailure(new Error(message)));

    const evalRoot = resolve(root);
    const source = resolve(workloadsDir(evalRoot), kase.id, kase.workspace);
    const sourceRelative = relative(evalRoot, source);
    if (sourceRelative === ".." || sourceRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(sourceRelative)) {
      return yield* reject(`workspace template escapes eval root: ${kase.workspace}`);
    }
    const runRoot = resolve(workspaceRoot, runSetId);
    const dest = resolve(runRoot, kase.id);
    const destRelative = relative(runRoot, dest);
    if (destRelative === "" || destRelative === ".." || destRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(destRelative)) {
      return yield* reject(`case id escapes run root: ${kase.id}`);
    }
    // A caller may intentionally reuse a run-set id while retrying a failed
    // eval. Recreate the per-case destination so stale artifacts cannot
    // become part of the grader-owned baseline or final readout.
    yield* copyLeaf(io.rm(dest, { recursive: true, force: true }));
    yield* copyLeaf(io.mkdir(dest, { recursive: true }));
    const sourceStat = yield* copyLeaf(io.stat(source));
    if (sourceStat.isDirectory()) {
      yield* copyLeaf(io.cp(source, dest, { recursive: true }));
    } else if (sourceStat.isFile() && (source.endsWith(".tar.gz") || source.endsWith(".tgz"))) {
      yield* copyLeaf(io.execFile("tar", [
        "-xzf", source, "-C", dest, "--no-same-owner", "--no-same-permissions",
      ]).pipe(Effect.asVoid));
    } else {
      return yield* reject(`workspace template must be a directory or .tar.gz archive: ${source}`);
    }
    return dest;
  });
}
