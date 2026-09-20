// The human side of the stage `signoff` primitive. The engine asks; this
// module maps one sign-off request onto a two-step AskQuestion dialog: which
// way the workflow goes — "Continue" (publish this result) or "Retry" (run
// this worker again) — and then an optional note in the reviewer's own words,
// which the engine delivers to exactly one agent. No harness is involved: the
// worker turn has already finished and Piano itself owns the terminal.

import { Effect } from "effect";
import {
  WorkflowError,
  type WorkflowSignoffDecision,
  type WorkflowSignoffRequest,
} from "@piano/orchestrator";
import { type AskQuestionAnswer, type AskQuestionSpec } from "./ask-question.js";

/** The two ways a review can send the workflow. */
type SignoffChoice = WorkflowSignoffDecision["type"];

/** The gate's name in the conversation: the stage, plus the round once a retry
 * has reopened it, so a second review is never mistaken for the first. */
function gate(request: WorkflowSignoffRequest): string {
  return `${request.stageId}${request.round > 1 ? ` (round ${request.round})` : ""}`;
}

export function signoffSpec(request: WorkflowSignoffRequest): AskQuestionSpec {
  const excerpt = request.excerpt.replace(/\s+/g, " ").trim();
  return {
    title: `Sign off ${gate(request)}?`,
    message: `worker ${request.worker} · harness ${request.harness}`,
    details: [
      ...(excerpt === "" ? [] : [`result: ${excerpt}`]),
      ...(request.resultPath === undefined ? [] : [`validated result: ${request.resultPath}`]),
      `transcript: ${request.transcriptPath}`,
      // Say where the note will land *before* the reviewer writes it. Whether
      // the answer is a list of stages or "nowhere" is the same fact the engine
      // uses to deliver it, so the two cannot drift apart.
      ...(request.consumers.length === 0
        ? ["nothing consumes this stage: a note has nowhere to go, so you will not be asked for one"]
        : [`note goes to: ${request.consumers.join(", ")}`]),
    ],
    options: [
      {
        id: "continue",
        label: "Continue — publish this result",
        description: request.consumers.length === 0
          ? "the workflow moves on"
          : `your note is handed to ${request.consumers.join(", ")}`,
      },
      {
        id: "retry",
        label: "Retry — run this worker again",
        description: "your note is added to this worker's next attempt",
      },
    ],
  };
}

/** The second step: the reviewer's own words, optional for **both** choices.
 *
 * The step always offers an explicit "without a note" option because an empty
 * Enter cannot be the answer — the question component only submits typed text
 * when it is non-blank, so with no option to fall back on the step would be a
 * dead end. Escape is deliberately not that escape hatch: it abandons the
 * whole review, and one key must not mean two things inside one dialog. */
export function signoffNoteSpec(
  request: WorkflowSignoffRequest,
  choice: SignoffChoice,
): AskQuestionSpec {
  return {
    title: `${choice === "continue" ? "Continue" : "Retry"} ${gate(request)}`,
    message: choice === "continue"
      ? `Your note is handed to ${request.consumers.join(", ")}.`
      : "Your note is added to this worker's next attempt.",
    options: [
      {
        id: "none",
        label: choice === "continue" ? "Continue without a note" : "Retry without a note",
      },
    ],
    allowText: true,
    placeholder: "Optional note — type it and press Enter",
  };
}

/** Esc during a review abandons it. A cancelled review must never silently
 * continue, and the run must not pretend it can be picked up here: Piano has no
 * mechanism to resume a run parked at a gate, so the honest outcome is a failed
 * stage, and the message says what that means for the run. */
function signoffCancelled(request: WorkflowSignoffRequest): WorkflowError {
  return new WorkflowError({
    phase: "schedule",
    path: request.stageId,
    message: "the sign-off review was cancelled, so this stage was not published and the run stopped here; "
      + "sending another prompt runs the stage again",
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
      const choice = answer !== undefined && answer.type === "option"
        && (answer.id === "continue" || answer.id === "retry")
        ? answer.id
        : undefined;
      // Esc, or an option this dialog does not offer: the review is unanswered.
      if (choice === undefined) return Effect.fail(signoffCancelled(request));
      // A `continue` that nothing consumes has nowhere to deliver a note, so
      // the second step is skipped rather than collecting words that would be
      // dropped. The engine logs the same `noteLength: 0` either way.
      if (choice === "continue" && request.consumers.length === 0) {
        return Effect.succeed<WorkflowSignoffDecision>({ type: "continue" });
      }
      return ask(signoffNoteSpec(request, choice)).pipe(
        Effect.flatMap((note) => {
          if (note === undefined) return Effect.fail(signoffCancelled(request));
          const text = note.type === "text" ? note.value.trim() : "";
          return Effect.succeed<WorkflowSignoffDecision>(
            text === "" ? { type: choice } : { type: choice, note: text },
          );
        }),
      );
    }),
  );
}

/** The chat-visible line for a finished review, phrased as the user message
 * the reviewer leaves in the conversation: the gate (stage, plus the round once
 * a retry has reopened it) and the decision, echoing the note verbatim when
 * there was one. The interactive TUI appends it to the transcript so the review
 * outcome — and the reviewer's own words — read like a normal user turn instead
 * of vanishing with the panel; a cancelled review has no line because no
 * decision exists. */
export function signoffDecisionText(
  request: WorkflowSignoffRequest,
  decision: WorkflowSignoffDecision,
): string {
  const name = gate(request);
  const note = decision.note === undefined ? "" : ` — noted: ${decision.note}`;
  return decision.type === "continue"
    ? `Continue past ${name}${note}`
    : `Retry ${name}${note}`;
}

/** The sign-off channel for headless runs (`piano -p`, with or without
 * `--json`): the run takes exactly one prompt and has no reviewer at the
 * keyboard, so it must never stop at a human gate. Every request is answered
 * `continue` with no note — the attempt is published, the run walks through
 * all gates, and the process exits on its own instead of hanging on a terminal
 * prompt. The interactive TUI passes its own dialog channel. */
export function headlessSignoffChannel(): (
  request: WorkflowSignoffRequest,
) => Effect.Effect<WorkflowSignoffDecision, WorkflowError> {
  return () => Effect.succeed<WorkflowSignoffDecision>({ type: "continue" });
}
