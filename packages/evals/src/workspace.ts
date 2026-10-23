/**
 * Eval workspace materialization: copy a case's workspace template into the
 * per-run sandbox, and own the grader's immutable diff baseline (what the
 * agent changed from its pristine start).
 */
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { execFile } from "node:child_process";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { workloadsDir } from "./case-loader.js";
import { DriverError } from "./errors.js";
import type { CodeChangeMetrics, EvalCase } from "./types.js";

// Run target: workspace templates are copied into and executed under a
// dedicated user-level eval root, NOT the caller's cwd. The source material
// under `evals/workloads/<case>/workspace` is read-only; the agent's edits,
// `state/`, `bench/`, and `reports/` must land in an isolated per-run sandbox
// so they never mutate the checked-in template (ISSUE-016).
export const DEFAULT_WORKSPACE_ROOT = join(homedir(), ".piano", "evals");

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
