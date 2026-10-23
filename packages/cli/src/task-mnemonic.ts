import { Effect } from "effect";
import { actorSessionDir } from "@piano/base";
import type { AgentHarnessOptions, AgentRequest, AgentRunner } from "@piano/harness";
import type { FileSystem } from "@effect/platform";
import type { Logging } from "@piano/logging";
import { isWorkflowIdentifier } from "@piano/orchestrator";

/** Run-directory home for the preflight mnemonic turn's harness session files.
 * A sibling of the workflow's actor tree, like the side agent: naming a task is
 * not a stage and must not read as one. */
export const TASK_MNEMONIC_DIR = "task-mnemonic";

/** Cap the prompt shown to the summarizer; the slug needs the task's subject,
 * not the whole brief. */
const PROMPT_EXCERPT_LIMIT = 4000;

const SUMMARY_INSTRUCTION = [
  "Name this task in 1 to 3 kebab-case words.",
  "Reply with the slug alone — lowercase letters, digits and hyphens, no punctuation, no explanation.",
  "The words must say what the task is about, not the workflow or the product.",
].join(" ");

/** Ask the configured agent for a short task slug.
 *
 * Always answers: a harness failure, a timeout or a useless reply returns
 * `undefined`, and the caller falls back to the workflow's own mnemonic. The
 * turn is a naming step, so it gets no tools and writes no workflow evidence. */
export function summarizeTaskMnemonic(input: {
  readonly prompt: string;
  readonly cwd: string;
  readonly runDir: string;
  readonly runAgent: AgentRunner;
  readonly options?: AgentHarnessOptions;
  readonly signal?: AbortSignal;
}): Effect.Effect<string | undefined, never, FileSystem.FileSystem | Logging> {
  const excerpt = input.prompt.length > PROMPT_EXCERPT_LIMIT
    ? `${input.prompt.slice(0, PROMPT_EXCERPT_LIMIT)}…`
    : input.prompt;
  const request: AgentRequest = {
    cwd: input.cwd,
    prompt: `${SUMMARY_INSTRUCTION}\n\nTask:\n${excerpt}`,
    tools: [],
    sessionDir: actorSessionDir(input.runDir, TASK_MNEMONIC_DIR),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  };
  return input.runAgent(request, input.options ?? {}).pipe(
    Effect.map((result) => normalizeMnemonic(result.text)),
    Effect.catchAll(() => Effect.succeed(undefined)),
  );
}

/** First meaningful line → a workflow identifier (lowercase, ≤32 chars), or
 * undefined. */
export function normalizeMnemonic(text: string): string | undefined {
  const line = text
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find((entry) => entry !== "");
  if (line === undefined) return undefined;
  const slug = line
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .slice(0, 32)
    .replace(/-+$/u, "");
  return slug !== "" && isWorkflowIdentifier(slug) ? slug : undefined;
}
