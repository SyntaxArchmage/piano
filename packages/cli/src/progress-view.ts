// Reading a run's progress for display.
//
// The run keeps one state document, `status.json`, folded from the ledgers
// that describe it. That is the file to read — it is one small file — and the
// stream behind it is folded only for a run written before the document
// existed.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  applyProgressRecord,
  parseProgressStreamRecord,
  runStatusPath,
  workflowProgressPath,
  type WorkflowProgressSnapshot,
} from "@piano/orchestrator";
import { parseWorkflowGraphSnapshot, type WorkflowGraphSnapshot } from "./workflow-graph.js";

/** The run's progress view: the state document when it is readable, rebuilt
 * from the append-only stream behind it when it is not.
 *
 * The fallback reads the whole stream, which is why it stays on the path where
 * the cheap file is gone. Missing, malformed, or concurrently replaced files
 * must not interrupt the interactive session, so every failure lands on
 * `undefined`. */
export async function readWorkflowSnapshot(runDir: string): Promise<WorkflowGraphSnapshot | undefined> {
  try {
    return parseWorkflowGraphSnapshot(JSON.parse(await readFile(runStatusPath(runDir), "utf8")) as unknown);
  } catch {
    return parseWorkflowGraphSnapshot(await foldProgressStream(join(runDir, "progress.json")));
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
