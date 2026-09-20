// The headless (`-p`) contract: one prompt, every sign-off skipped, and the
// process exits on its own. A channel that consulted the terminal would block
// a headless run at the first gate (or fail it outright with no tty) — this
// guards that the channel answers approve without any interaction.
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
};

describe("headless sign-off channel", () => {
  it("auto-approves every gate without touching the terminal", () => {
    const decision = Effect.runSync(headlessSignoffChannel()(request));
    expect(decision).toEqual({ type: "approve" });
  });

  it("approves even on a later rejection round, skipping the gate outright", () => {
    const decision = Effect.runSync(headlessSignoffChannel()({ ...request, round: 3 }));
    expect(decision).toEqual({ type: "approve" });
  });
});
