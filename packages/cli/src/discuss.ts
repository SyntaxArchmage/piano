import { Effect } from "effect";
import { WorkflowError, type WorkflowDiscussDecision, type WorkflowDiscussRequest } from "@piano/orchestrator";
import { type AskQuestionAnswer, type AskQuestionSpec } from "./ask-question.js";

export function discussSpec(request: WorkflowDiscussRequest): AskQuestionSpec {
  return {
    title: `Discuss with ${request.worker} (${request.stageId})`,
    message: request.question,
    details: [`round: ${request.round}`, `transcript: ${request.transcriptPath}`],
    options: [],
    allowText: true,
    placeholder: "Supervisor answer",
  };
}

export function runDiscussDialog(
  request: WorkflowDiscussRequest,
  ask: (spec: AskQuestionSpec) => Effect.Effect<AskQuestionAnswer | undefined, WorkflowError>,
): Effect.Effect<WorkflowDiscussDecision, WorkflowError> {
  return ask(discussSpec(request)).pipe(
    Effect.flatMap((answer) => {
      if (answer?.type === "text" && answer.value.trim() !== "") {
        return Effect.succeed({ answer: answer.value.trim() });
      }
      return Effect.fail(new WorkflowError({ phase: "schedule", path: request.stageId, message: "discussion was cancelled" }));
    }),
  );
}

/**
 * Deterministic supervisor substitute for headless runs and evals. Keep the
 * response explicit: the worker must make the decision itself rather than
 * treating the missing human as an implicit approval.
 */
export function headlessDiscussChannel(): (request: WorkflowDiscussRequest) => Effect.Effect<WorkflowDiscussDecision, WorkflowError> {
  return (_request) => Effect.succeed({ answer: "please make decision by yourself, i am not here" });
}
