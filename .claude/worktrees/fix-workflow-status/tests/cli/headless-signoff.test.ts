// The headless (`-p`) contract: one prompt, every sign-off skipped, and the
// process exits on its own. A channel that consulted the terminal would block
// a headless run at the first gate (or fail it outright with no tty) — this
// guards that the channel answers `continue` without any interaction, and that
// it never invents a note no human wrote.
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { headlessSignoffChannel } from "../../packages/cli/src/signoff.js";
import type { WorkflowSignoffRequest } from "@piano/orchestrator";

const request: WorkflowSignoffRequest = {
  stageId: "respond#1",
  invocationId: "respond#1",
  stage: "respond",
  worker: "basic",
  harness: "pi",
  round: 1,
  transcriptPath: "/tmp/run/transcript.jsonl",
  excerpt: "READY",
  consumers: ["finalize#1"],
};

describe("headless sign-off channel", () => {
  it("continues past every gate without touching the terminal", () => {
    const decision = Effect.runSync(headlessSignoffChannel()(request));
    expect(decision).toEqual({ type: "continue" });
  });

  it("never attaches a note: no human was there to write one", () => {
    // A note is delivered to a downstream stage's prompt as the human's own
    // instruction. A headless run has no human, so the absence of a note is
    // part of the contract, not an incidental empty field.
    const decision = Effect.runSync(headlessSignoffChannel()(request));
    expect(decision.note).toBeUndefined();
  });

  it("continues even on a later retry round, skipping the gate outright", () => {
    const decision = Effect.runSync(headlessSignoffChannel()({ ...request, round: 3 }));
    expect(decision).toEqual({ type: "continue" });
  });

  it("continues when nothing consumes the stage either", () => {
    const decision = Effect.runSync(headlessSignoffChannel()({ ...request, consumers: [] }));
    expect(decision).toEqual({ type: "continue" });
  });
});
