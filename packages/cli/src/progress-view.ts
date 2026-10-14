// Reading a run's progress for display.
//
// Two files describe the same run: `progress.json`, the snapshot the
// orchestrator keeps for viewers, and `progress.jsonl`, the append-only stream
// it is a projection of. The snapshot is the one to read — it is one small
// file — so this module reads it, and folds the stream only when the snapshot
// is not there to read.

import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  applyProgressRecord,
  parseProgressStreamRecord,
  workflowProgressPath,
  type WorkflowProgressSnapshot,
} from "@piano/orchestrator";
import { parseWorkflowGraphSnapshot, type WorkflowGraphSnapshot } from "./workflow-graph.js";

/** The run's progress view: the snapshot file when it is readable, rebuilt
 * from the append-only stream behind it when it is not.
 *
 * The fallback reads the whole stream, which is why it stays on the path where
 * the cheap file is gone. Missing, malformed, or concurrently replaced files
 * must not interrupt the interactive session, so every failure lands on
 * `undefined`. */
export async function readWorkflowSnapshot(path: string): Promise<WorkflowGraphSnapshot | undefined> {
  try {
    return parseWorkflowGraphSnapshot(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch {
    return parseWorkflowGraphSnapshot(await foldProgressStream(path));
  }
}

/** Rebuild a snapshot from the stream beside it, or `undefined` when neither
 * the stream nor anything it holds can be read. */
async function foldProgressStream(snapshotPath: string): Promise<WorkflowProgressSnapshot | undefined> {
  const raw = await readFile(workflowProgressPath(dirname(snapshotPath)), "utf8").catch(() => "");
  return raw.split("\n").reduce<WorkflowProgressSnapshot | undefined>((previous, line) => {
    const record = parseProgressStreamRecord(line);
    return record === undefined ? previous : applyProgressRecord(previous, record);
  }, undefined);
}
