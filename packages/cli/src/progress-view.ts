// Reading a run's progress for display.
//
// The run keeps one state document, `status.json`, written by the orchestrator
// as it schedules. That is the file to read; there is no second way to answer
// the question.

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
