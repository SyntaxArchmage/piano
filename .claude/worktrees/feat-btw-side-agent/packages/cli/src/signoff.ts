// The human side of the stage `signoff` primitive. The engine asks; this
// module maps one sign-off request onto the AskQuestion dialog — "Approve —
// we're good to end", or "Reject — you should still work on: <feedback>",
// which continues the workflow with the same actor. No harness is involved:
// the worker turn has already finished and Piano itself owns the terminal.

import { Effect } from "effect";
import {
  WorkflowError,
  type WorkflowSignoffDecision,
  type WorkflowSignoffRequest,
} from "@piano/orchestrator";
import { type AskQuestionAnswer, type AskQuestionSpec } from "./ask-question.js";

export function signoffSpec(request: WorkflowSignoffRequest): AskQuestionSpec {
  const excerpt = request.excerpt.replace(/\s+/g, " ").trim();
  return {
    title: `Sign off ${request.stageId}${request.round > 1 ? ` (round ${request.round})` : ""}?`,
    message: `worker ${request.worker} · harness ${request.harness}`,
    details: [
      ...(excerpt === "" ? [] : [`result: ${excerpt}`]),
      ...(request.resultPath === undefined ? [] : [`validated result: ${request.resultPath}`]),
      `transcript: ${request.transcriptPath}`,
    ],
    options: [
      {
        id: "approve",
        label: "Approve — we're good to end",
        description: "publish the accepted result",
      },
      {
        id: "reject",
        label: "Reject — you should still work on:",
        description: "the workflow does not end; the same actor resumes with your feedback",
      },
    ],
  };
}

export function signoffFeedbackSpec(request: WorkflowSignoffRequest): AskQuestionSpec {
  return {
    title: `You should still work on (${request.stageId})`,
    options: [],
    allowText: true,
    placeholder: "What the actor must change",
  };
}

/** Esc during a review cancels it. A cancelled review must never silently
 * approve: the stage fails and the run stops at it. */
function signoffCancelled(request: WorkflowSignoffRequest): WorkflowError {
  return new WorkflowError({
    phase: "schedule",
    path: request.stageId,
    message: "sign-off review was cancelled",
  });
}

/** Drive the two-step dialog through any ask function — the live TUI overlay
 * or a standalone tty prompt. */
export function runSignoffDialog(
  request: WorkflowSignoffRequest,
  ask: (spec: AskQuestionSpec) => Effect.Effect<AskQuestionAnswer | undefined, WorkflowError>,
): Effect.Effect<WorkflowSignoffDecision, WorkflowError> {
  return ask(signoffSpec(request)).pipe(
    Effect.flatMap((answer) => {
      if (answer === undefined) return Effect.fail(signoffCancelled(request));
      if (answer.type === "option" && answer.id === "approve") {
        return Effect.succeed<WorkflowSignoffDecision>({ type: "approve" });
      }
      return ask(signoffFeedbackSpec(request)).pipe(
        Effect.flatMap((feedback) => {
          if (feedback === undefined) return Effect.fail(signoffCancelled(request));
          if (feedback.type === "text" && feedback.value.trim() !== "") {
            return Effect.succeed<WorkflowSignoffDecision>({ type: "reject", feedback: feedback.value.trim() });
          }
          // The text step cannot submit empty input; keep the reject valid
          // anyway so the actor always learns what happened.
          return Effect.succeed<WorkflowSignoffDecision>({
            type: "reject",
            feedback: "The reviewer rejected this result without further notes; revisit it.",
          });
        }),
      );
    }),
  );
}

/** The chat-visible line for a finished review, phrased as the user message
 * the reviewer leaves in the conversation: the gate (stage, plus the round when
 * a rejection resumed the actor) and the decision, echoing the typed feedback
 * verbatim when the review rejected. The interactive TUI appends it to the
 * transcript so the review outcome reads like a normal user turn; a cancelled
 * review has no line because no decision exists. */
export function signoffDecisionText(
  request: WorkflowSignoffRequest,
  decision: WorkflowSignoffDecision,
): string {
  const gate = `${request.stageId}${request.round > 1 ? ` (round ${request.round})` : ""}`;
  return decision.type === "approve"
    ? `Sign off ${gate}: approved — we're good to end`
    : `Sign off ${gate}: you should still work on: ${decision.feedback}`;
}

/** The sign-off channel for headless runs (`piano -p`, with or without
 * `--json`): the run takes exactly one prompt and has no reviewer at the
 * keyboard, so it must never stop at a human gate. Every sign-off request is
 * auto-approved — the accepted attempt is published, the run walks through
 * all gates, and the process exits on its own instead of hanging on a
 * terminal prompt. The interactive TUI passes its own dialog channel. */
export function headlessSignoffChannel(): (
  request: WorkflowSignoffRequest,
) => Effect.Effect<WorkflowSignoffDecision, WorkflowError> {
  return () => Effect.succeed<WorkflowSignoffDecision>({ type: "approve" });
}
