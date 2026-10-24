// How a stage's prompt is framed: the whole-workflow task the human wrote,
// followed by this stage's context — its identity, workspace, injected files,
// reviewer guidance, and the contract it must satisfy.
//
// Stage prompts are the only prompt writer; the rest of the file is the stage
// runner's.

import type { ThinkingLevel } from "@piano/harness";
import type {
  ResolvedStageValidation,
  SignoffRetry,
  StageReviewNote,
} from "./execution-types.js";
import { runtimeInvocationId, type WorkflowRuntimeInvocation } from "./workflow-runtime.js";
import type { WorkflowWorkspaceBinding } from "./workspace.js";

export function wholeWorkflowTask(userPrompt: string): readonly string[] {
  return ["## User task (whole workflow)", userPrompt, ""];
}

/** The guard rails under every stage prompt's context header. */
export const STAGE_CONTEXT_GUARD_RAILS: readonly string[] = [
  "The user task above is the complete task for the whole workflow. Use this stage only to advance that task.",
  "Do not replace, broaden, or reinterpret it as a repository review, an autonomous development loop, or duration-based work session unless the user explicitly asks for that.",
  "Repository instruction files constrain how you execute the task; they do not replace or broaden it.",
];

export function stagePrompt(
  userPrompt: string,
  invocation: WorkflowRuntimeInvocation,
  workspace: WorkflowWorkspaceBinding,
  contextFilePaths: readonly string[],
  validation: ResolvedStageValidation | undefined,
  resultPath: string | undefined,
  repairError: string | undefined,
  signoffRetry: SignoffRetry | undefined,
  reviewNotes: readonly StageReviewNote[],
  model: string | undefined,
  thinkingLevel: ThinkingLevel | undefined,
  prologue: string | undefined,
): string {
  const lines = [
    ...wholeWorkflowTask(userPrompt),
    "## Workflow stage context",
    ...STAGE_CONTEXT_GUARD_RAILS,
    `You are executing workflow stage \`${invocation.stageId}\` (${runtimeInvocationId(invocation)}).`,
    `Your current workspace is \`${workspace.cwd}\`.`,
    "Treat that directory as the only mutable task workspace. Do not edit the Piano source tree or run evidence outside it.",
    "The orchestrator injected the following context files; read them before acting:",
    ...(contextFilePaths.length === 0 ? ["(none)"] : contextFilePaths.map((path) => `- ${path}`)),
    "Handoff files are immutable upstream evidence; write new artifacts only in the current workspace or the requested result path.",
  ];
  // Guidance a human wrote when they let an upstream stage continue. It sits
  // after the guard rails above on purpose: it is authority from the same human
  // who owns the task, but it refines the task rather than replacing it, and
  // the wording says so instead of leaving each worker to guess.
  if (reviewNotes.length > 0) {
    lines.push(
      "",
      "## Reviewer guidance",
      "A human reviewer reviewed the stage(s) below before letting the workflow continue, and left this guidance for the work that follows.",
      "Treat it as part of the task above. It never replaces, broadens or reinterprets that task.",
      ...reviewNotes.map((review) => `- after \`${review.stageId}\`: ${review.note}`),
    );
  }
  if (model !== undefined || thinkingLevel !== undefined) {
    lines.push(
      "",
      "## Agent configuration",
      ...(model === undefined ? [] : [`Model: \`${model}\``]),
      ...(thinkingLevel === undefined ? [] : [`Thinking level: \`${thinkingLevel}\``]),
    );
  }
  if (validation !== undefined && resultPath !== undefined) {
    lines.push(
      "",
      "## Required validation result",
      `Before finishing, write valid JSON for contract \`${validation.id}\` to:`,
      resultPath,
      "Use this accepted JSON shape (replace example values with real evidence):",
      validation.guidance,
      "Create parent directories if needed. This is a stage result artifact, not a handoff file.",
    );
  }
  if (repairError !== undefined) {
    lines.push(
      "",
      "## Validation repair required",
      "Your previous turn exited, but the orchestrator rejected its result.",
      `Reason: ${repairError}`,
      "Fix the work and write the required result at the path above. Do not start a different task.",
    );
  }
  if (signoffRetry !== undefined) {
    lines.push(
      "",
      "## Sign-off retry",
      "A human reviewer looked at your finished result for this stage and sent it back for another attempt instead of accepting it.",
      ...(signoffRetry.note === undefined
        ? ["No further detail was given: re-examine your previous work critically and improve it."]
        : [`Reviewer note: ${signoffRetry.note}`]),
      "Address that in this turn. If a required result path is listed above, rewrite it there; this is still the same task, not a new one.",
    );
  }
  // The resolved prologue is appended last so it is the final instruction the
  // worker reads before it starts. It is plain prompt text from the workflow
  // (or the worker plugin's default): the author's words, not the worker's
  // work, so it grants no authority and every guard above still applies to it.
  if (prologue !== undefined) {
    lines.push("", "## Prologue", prologue);
  }
  return lines.join("\n");
}
