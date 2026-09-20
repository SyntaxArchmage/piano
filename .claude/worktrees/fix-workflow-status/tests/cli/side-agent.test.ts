import { describe, expect, it } from "vitest";
import { toolGrantsCapability } from "@piano/harness";
import { SIDE_AGENT_DIR, SIDE_AGENT_TOOLS, sideAgentRequest } from "../../packages/cli/src/side-agent.js";

describe("side agent request", () => {
  const turn = { prompt: "rename the flag", cwd: "/repo/work", runDir: "/runs/20260909T120000-run" };

  it("runs in the session workspace with the side agent's own session directory", () => {
    const request = sideAgentRequest(turn);
    expect(request.cwd).toBe("/repo/work");
    expect(request.prompt).toBe("rename the flag");
    expect(request.sessionDir).toBe(`/runs/20260909T120000-run/${SIDE_AGENT_DIR}`);
    // A sibling of `executions/`, never a child: the side agent has no
    // execution, so its transcripts must not read as a stage's evidence.
    expect(request.sessionDir).not.toContain("executions");
  });

  it("grants the write and exec capabilities that make it more than an ask-only chat", () => {
    const tools = sideAgentRequest(turn).tools ?? [];
    expect(tools).toEqual([...SIDE_AGENT_TOOLS]);
    expect(tools.some((tool) => toolGrantsCapability("pi", tool, "write"))).toBe(true);
    expect(tools.some((tool) => toolGrantsCapability("pi", tool, "exec"))).toBe(true);
  });

  it("matches the coding workflow's tool grant", () => {
    // `/btw` is "basically coding-pi": the same tools, reached without a
    // workflow. Drifting apart would make the side agent quietly weaker or
    // stronger than the stage it is modelled on.
    expect([...SIDE_AGENT_TOOLS]).toEqual(["read", "bash", "edit", "write", "find", "grep", "ls", "web_search"]);
  });

  it("leaves model, provider and thinking level unset so the pi harness config decides", () => {
    const request = sideAgentRequest(turn);
    expect(request.model).toBeUndefined();
    expect(request.provider).toBeUndefined();
    expect(request.thinkingLevel).toBeUndefined();
  });

  it("omits the optional turn plumbing instead of passing undefined through", () => {
    const request = sideAgentRequest(turn);
    expect("continuation" in request).toBe(false);
    expect("signal" in request).toBe(false);
    expect("steering" in request).toBe(false);
    expect("onEvent" in request).toBe(false);
  });

  it("carries the previous turn's continuation so consecutive prompts are one conversation", () => {
    const continuation = { harness: "pi", sessionId: "side-1", transcriptPath: "/runs/r/side-agent/t.jsonl" };
    const signal = new AbortController().signal;
    const request = sideAgentRequest({ ...turn, continuation, signal });
    expect(request.continuation).toEqual(continuation);
    expect(request.signal).toBe(signal);
  });
});
