// Where a run keeps its files.
//
// One run is one directory, and its layout is a contract: the CLI, the
// orchestrator, the trajectory recorders and the evals reader all name the same
// directories and files. Spelling those names in each package is how a README
// and the code drift apart, so every path is built here and nowhere else.
//
// Deliberately dependency-free beyond `node:path`: this module is the floor of
// the package graph, so it cannot import the modules whose paths it names.

import { join } from "node:path";

/** The run's append-only evidence streams. Each is one JSONL file whose lines
 * are the record; a document that summarizes them is a fold, not a second
 * source. */
export const SYSTEM_LOG_DIR = "system-log";

export function systemLogDir(runDir: string): string {
  return join(runDir, SYSTEM_LOG_DIR);
}

export function logStreamPath(runDir: string): string {
  return join(systemLogDir(runDir), "log.jsonl");
}

export function traceStreamPath(runDir: string): string {
  return join(systemLogDir(runDir), "trace.jsonl");
}

export function trajectoryStreamPath(runDir: string): string {
  return join(systemLogDir(runDir), "trajectory.jsonl");
}

export function invocationStreamPath(runDir: string): string {
  return join(systemLogDir(runDir), "invocations.jsonl");
}

/** The run's single state document, written whole and atomically. */
export function runStatusPath(runDir: string): string {
  return join(runDir, "status.json");
}

/** The directory of per-run metric streams (benchmark, duration, tokens,
 * tools, tournament selections). */
export const EVAL_METRICS_DIR = "eval-metrics";

export function evalMetricsDir(runDir: string): string {
  return join(runDir, EVAL_METRICS_DIR);
}

/** One of the run's metric streams, by its own file name. */
export function evalMetricsPath(runDir: string, file: string): string {
  return join(evalMetricsDir(runDir), file);
}

/** Immutable worker-contract snapshots, named by their own digest. */
export function contractSnapshotPath(runDir: string, digest: string): string {
  return join(runDir, "contracts", `${digest}.json`);
}

/** The agent-written validation result of one attempt. The path is the published
 * contract: a worker writes it, the orchestrator pins it by content. */
export function invocationResultPath(runDir: string, ref: string, attempt: number): string {
  return join(runDir, "results", `${ref}-attempt-${attempt}.json`);
}

/** The per-invocation directory holding the immutable context injected into a
 * consumer. */
export function invocationContextDir(runDir: string, ref: string): string {
  return join(runDir, "context", ref);
}

/** The bare Git store every lane's baseline and transaction commit lands in. */
export function workspaceStorePath(runDir: string): string {
  return join(runDir, "git", "workspaces.git");
}

/** Root of the run's lane worktrees (`worktree-<key>`). */
export function workspaceRoot(runDir: string): string {
  return join(runDir, "workspaces");
}

export function workspaceWorktreePath(runDir: string, key: string): string {
  return join(workspaceRoot(runDir), `worktree-${encodeURIComponent(key)}`);
}

/** Root of the per-workspace bookkeeping records. */
export function workspaceRecordRoot(runDir: string): string {
  return join(runDir, "workspace-records");
}

export function workspaceRecordPath(runDir: string, key: string): string {
  return join(workspaceRecordRoot(runDir), encodeURIComponent(key), "record.json");
}

/** The run's per-conversation harness session directories. */
export function sessionsRoot(runDir: string): string {
  return join(runDir, "sessions");
}

/** Where one conversation's harness session lives; the name is flat so a lane
 * reads as a suffix rather than nested directories. */
export function actorSessionDir(runDir: string, name: string): string {
  return join(sessionsRoot(runDir), name);
}
