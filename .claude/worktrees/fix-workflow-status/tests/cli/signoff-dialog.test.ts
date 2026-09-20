// The sign-off dialog's contract, driven through a scripted `ask` so the
// two-step flow can be asserted without a terminal. The TUI panel tests cover
// the rendering and the key routing; this covers what the dialog decides.
import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { WorkflowError, type WorkflowSignoffDecision, type WorkflowSignoffRequest } from "@piano/orchestrator";
import { headlessSignoffChannel, runSignoffDialog, signoffDecisionText, signoffNoteSpec, signoffSpec } from "../../packages/cli/src/signoff.js";
import type { AskQuestionAnswer, AskQuestionSpec } from "../../packages/cli/src/ask-question.js";

function request(overrides: Partial<WorkflowSignoffRequest> = {}): WorkflowSignoffRequest {
  return {
    stageId: "respond",
    invocationId: "inv-1",
    stage: "respond",
    worker: "basic",
    harness: "pi",
    round: 1,
    transcriptPath: "/tmp/run/transcript.jsonl",
    excerpt: "DRAFT1",
    consumers: ["reviewer"],
    ...overrides,
  };
}

/** Answer each ask in order, recording the specs the dialog asked for. An
 * `undefined` entry is a *cancelled* answer (how the TUI reports Escape), which
 * is different from the script running out of answers. */
function scripted(answers: readonly (AskQuestionAnswer | undefined)[]) {
  const specs: AskQuestionSpec[] = [];
  const ask = (spec: AskQuestionSpec): Effect.Effect<AskQuestionAnswer | undefined, WorkflowError> => {
    const index = specs.length;
    specs.push(spec);
    if (index >= answers.length) {
      return Effect.fail(new WorkflowError({ phase: "schedule", path: spec.title, message: "script exhausted" }));
    }
    return Effect.succeed(answers[index]);
  };
  return { ask, specs };
}

function run(request_: WorkflowSignoffRequest, answers: readonly (AskQuestionAnswer | undefined)[]) {
  const { ask, specs } = scripted(answers);
  return {
    specs,
    exit: Effect.runPromiseExit(runSignoffDialog(request_, ask)),
  };
}

describe("sign-off dialog", () => {
  it("asks which way the workflow goes, naming both choices and the note's destination", () => {
    const spec = signoffSpec(request());
    expect(spec.options.map((option) => option.id)).toEqual(["continue", "retry"]);
    expect(spec.details).toContain("note goes to: reviewer");
  });

  it("says a note has nowhere to go when nothing consumes the stage", () => {
    const spec = signoffSpec(request({ consumers: [] }));
    expect(spec.details?.some((detail) => detail.includes("nowhere to go"))).toBe(true);
  });

  it("continues with no note when the reviewer picks the explicit no-note row", async () => {
    const { exit, specs } = run(request(), [{ type: "option", id: "continue" }, { type: "option", id: "none" }]);
    const result = await exit;
    expect(Exit.isSuccess(result)).toBe(true);
    if (Exit.isSuccess(result)) expect(result.value).toEqual({ type: "continue" });
    // Two steps: the fork, then the optional note.
    expect(specs).toHaveLength(2);
    expect(specs[1]?.options.map((option) => option.id)).toEqual(["none"]);
    expect(specs[1]?.allowText).toBe(true);
  });

  it("carries a note written for a continue", async () => {
    const { exit } = run(request(), [
      { type: "option", id: "continue" },
      { type: "text", value: "  widen the caption  " },
    ]);
    const result = await exit;
    expect(Exit.isSuccess(result)).toBe(true);
    // Trimmed on the way in: the note is prose delivered to a prompt, and
    // trailing whitespace there is noise the reviewer never typed on purpose.
    if (Exit.isSuccess(result)) expect(result.value).toEqual({ type: "continue", note: "widen the caption" });
  });

  it("carries a note written for a retry", async () => {
    const { exit } = run(request(), [
      { type: "option", id: "retry" },
      { type: "text", value: "add a test for the parser" },
    ]);
    const result = await exit;
    expect(Exit.isSuccess(result)).toBe(true);
    if (Exit.isSuccess(result)) expect(result.value).toEqual({ type: "retry", note: "add a test for the parser" });
  });

  it("retries with no note rather than inventing one", async () => {
    const { exit } = run(request(), [{ type: "option", id: "retry" }, { type: "option", id: "none" }]);
    const result = await exit;
    expect(Exit.isSuccess(result)).toBe(true);
    // No note is `undefined`, never an empty string: the engine distinguishes
    // "the reviewer said nothing" from "the reviewer typed nothing meaningful",
    // and the prompt section reads differently for each.
    if (Exit.isSuccess(result)) expect(result.value).toEqual({ type: "retry" });
  });

  it("skips the note step entirely when nothing consumes the stage", async () => {
    const { exit, specs } = run(request({ consumers: [] }), [{ type: "option", id: "continue" }]);
    const result = await exit;
    expect(Exit.isSuccess(result)).toBe(true);
    if (Exit.isSuccess(result)) expect(result.value).toEqual({ type: "continue" });
    // One ask, not two: a note with nowhere to go is not collected at all.
    expect(specs).toHaveLength(1);
  });

  it("fails the review when it is cancelled on either step", async () => {
    const first = await run(request(), [undefined]).exit;
    expect(Exit.isFailure(first)).toBe(true);
    const second = await run(request(), [{ type: "option", id: "retry" }, undefined]).exit;
    expect(Exit.isFailure(second)).toBe(true);
    // Escape anywhere in the dialog abandons the whole review: it never means
    // "skip the note", because one key cannot mean two things in one dialog.
    for (const exit of [first, second]) {
      if (Exit.isFailure(exit)) {
        expect(JSON.stringify(exit.cause)).toContain("cancelled");
      }
    }
  });

  it("fails the review on an option it does not offer", async () => {
    const exit = await run(request(), [{ type: "option", id: "approve" }]).exit;
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("sign-off note spec", () => {
  it("names the stage the note is handed to", () => {
    const spec = signoffNoteSpec(request({ consumers: ["audit", "review"] }), "continue");
    expect(spec.message).toContain("audit, review");
  });

  it("names the next attempt as the note's destination for a retry", () => {
    const spec = signoffNoteSpec(request(), "retry");
    expect(spec.message).toContain("next attempt");
    expect(spec.options[0]?.label).toBe("Retry without a note");
  });
});

describe("sign-off decision text", () => {
  it("reads as the reviewer's own message in the chat", () => {
    expect(signoffDecisionText(request(), { type: "continue" })).toBe("Continue past respond");
    expect(signoffDecisionText(request(), { type: "continue", note: "widen it" })).toBe("Continue past respond — noted: widen it");
    expect(signoffDecisionText(request(), { type: "retry" })).toBe("Retry respond");
    expect(signoffDecisionText(request(), { type: "retry", note: "redo it" })).toBe("Retry respond — noted: redo it");
  });

  it("carries the round so a second review is not mistaken for the first", () => {
    expect(signoffDecisionText(request({ round: 2 }), { type: "continue" })).toBe("Continue past respond (round 2)");
  });
});

describe("headless sign-off channel", () => {
  it("continues and never writes a note", () => {
    const decision: WorkflowSignoffDecision = Effect.runSync(headlessSignoffChannel()(request()));
    expect(decision).toEqual({ type: "continue" });
  });
});
