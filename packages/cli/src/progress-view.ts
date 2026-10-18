// Reading a run's progress for display.
//
// The run keeps one state document, `status.json`, folded from the ledgers
// that describe it. That is the file to read: the ledgers behind it are the
// evidence and the source the document is folded from, not a second way to
// answer the question.

import { readFile } from "node:fs/promises";
import { parseRunStatus, runStatusPath } from "@piano/orchestrator";
import { parseWorkflowGraphSnapshot, type WorkflowGraphSnapshot } from "./workflow-graph.js";

/** The run's progress view.
 *
 * Missing, malformed, or concurrently replaced files must not interrupt the
 * interactive session, so every failure lands on `undefined`. */
export async function readWorkflowSnapshot(runDir: string): Promise<WorkflowGraphSnapshot | undefined> {
  try {
    return parseWorkflowGraphSnapshot(parseRunStatus(await readFile(runStatusPath(runDir), "utf8")));
  } catch {
    return undefined;
  }
}
