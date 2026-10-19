import { join } from "node:path";
import type { AgentContinuation, AgentEvent, AgentRequest, SteeringChannel } from "@piano/harness";

/** The side agent's tool grant, matching `recipes/workflows/coding-pi.yml`.
 *
 * This list is the whole point of `/btw`: `bash`/`write`/`edit` carry pi's
 * `exec` and `write` capabilities, so the side agent can act on the workspace
 * instead of only answering questions about it. */
export const SIDE_AGENT_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "find",
  "grep",
  "ls",
  "web_search",
] as const;

/** Run-directory home for the side agent's own harness session files.
 *
 * A sibling of `executions/`, never a child: the side agent has no execution,
 * no stage and no slot, so putting its transcripts under the workflow's actor
 * tree would make them read as evidence a stage produced. */
export const SIDE_AGENT_DIR = "side-agent";

export interface SideAgentTurn {
  readonly prompt: string;
  /** The session's workspace — the side agent edits the same tree the mission
   * does, which is why it is worth having at all. */
  readonly cwd: string;
  readonly runDir: string;
  /** The previous side turn's continuation. Threading it makes `/btw` one
   * conversation across prompts rather than a series of strangers. */
  readonly continuation?: AgentContinuation;
  readonly signal?: AbortSignal;
  readonly steering?: SteeringChannel;
  readonly onEvent?: (event: AgentEvent) => void;
}

/** Build the single agent call that backs one `/btw` turn.
 *
 * Deliberately not a workflow: a side task must not enter the mission's
 * execution, its progress ledger or its stage graph, and one TUI hosting two
 * workflows would make every piece of evidence ambiguous. Model, provider and
 * thinking level are left unset so the side agent resolves them from the same
 * pi harness configuration as any pi stage.
 */
export function sideAgentRequest(turn: SideAgentTurn): AgentRequest {
  return {
    cwd: turn.cwd,
    prompt: turn.prompt,
    tools: [...SIDE_AGENT_TOOLS],
    sessionDir: join(turn.runDir, "sessions", SIDE_AGENT_DIR),
    ...(turn.continuation === undefined ? {} : { continuation: turn.continuation }),
    ...(turn.signal === undefined ? {} : { signal: turn.signal }),
    ...(turn.steering === undefined ? {} : { steering: turn.steering }),
    ...(turn.onEvent === undefined ? {} : { onEvent: turn.onEvent }),
  };
}
