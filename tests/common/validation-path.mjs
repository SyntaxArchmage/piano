// The one rule for recognizing `invocationResultPath`'s spelling (see
// packages/orchestrator/src/invocations.ts): the agent-written validation
// result of an attempt is `results/inv-<serial>-attempt-<k>.json`. Shared by
// the in-process guards and the subprocess fixtures, which is why this is
// plain ESM — fake-codex.mjs / fake-agent.mjs run under bare `node` and cannot
// import TypeScript. A pin in tests/workflow/acceptance.test.ts ties this matcher
// to the production speller so the two cannot drift.
const INVOCATION_RESULT_PATH = /\/results\/inv-\d+-attempt-\d+\.json$/;

/** Whether a path (or a prompt line naming one) is an invocation result file. */
export function isInvocationResultPath(path) {
  return INVOCATION_RESULT_PATH.test(path.trim());
}

/** The validation result path a stage prompt tells its worker to write. */
export function validationResultPathFromPrompt(prompt) {
  return prompt.split("\n").find((line) => isInvocationResultPath(line))?.trim();
}
