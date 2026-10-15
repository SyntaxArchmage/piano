// `--json` headless event stream: expose the `AgentEvent` stream as a stable
// per-event JSON contract. Every emitted
// object is a single `JSON.stringify(obj) + "\n"` line on stdout, matching the
// shape CI/automation consumers can parse without starting the TUI.
//
// The workflow execution layer already funnels worker events through one `onEvent`
// callback (see `executeWorkflow`'s `request.onEvent`), so the migration is a
// pure mapping: envelope + lifecycle events here, with no change to the runner.

import type { AgentEvent } from "@piano/harness";

/** A single machine-parseable line emitted on stdout. */
export interface HeadlessJsonLine {
  readonly event: string;
  readonly run_id: string;
  readonly [key: string]: unknown;
}

/** Wrap an agent event in the stable `agent_event` envelope,
 * carrying the stage label alongside the raw event payload so consumers can
 * correlate worker streams even though AgentEvent does not carry a per-event stage. */
export function agentEventLine(event: AgentEvent, runId: string): HeadlessJsonLine {
  return {
    event: "agent_event",
    run_id: runId,
    type: event.type,
    data: event,
  };
}

/** Lifecycle markers kept stable so automation can key on `run.started`,
 * `run.completed`, and `run.failed`. */
export function startedLine(runId: string, cwd: string, workflow?: string): HeadlessJsonLine {
  return { event: "run.started", run_id: runId, cwd, ...(workflow === undefined ? {} : { workflow }) };
}

export function completedLine(runId: string, result: {
  text: string;
  sessionId: string;
  transcriptPath: string;
  progressPath?: string;
  statusPath?: string;
}): HeadlessJsonLine {
  return {
    event: "run.completed",
    run_id: runId,
    status: "completed",
    session_id: result.sessionId,
    transcript_path: result.transcriptPath,
    ...(result.progressPath === undefined ? {} : { progress_path: result.progressPath }),
    ...(result.statusPath === undefined ? {} : { status_path: result.statusPath }),
    text: result.text,
  };
}

export function failedLine(runId: string, code: string, message: string): HeadlessJsonLine {
  return { event: "run.failed", run_id: runId, code, error: message };
}

/** Serialize a line to its on-wire representation (no trailing newline —
 * callers batch into a full stdout write). */
export function serializeLine(line: HeadlessJsonLine): string {
  try {
    const encoded = JSON.stringify(line, (_key, value: unknown) => {
      if (typeof value === "bigint") return `${value}n`;
      return value;
    });
    if (encoded !== undefined) return encoded;
  } catch {
    // Provider payloads are unknown; preserve the machine-readable envelope
    // when an event field cannot be read or serialized.
  }
  return JSON.stringify({
    event: line.event,
    run_id: line.run_id,
    ...(typeof line.type === "string" ? { type: line.type } : {}),
    data: "[unserializable]",
  });
}
