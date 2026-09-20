import { Effect, Exit } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import { Logging, loggingService, LogWriter, TraceWriter } from "../../packages/logging/src/index.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { compileWorkflow, parseWorkflow } from "../../packages/orchestrator/src/index.js";
import { executeWorker } from "../../packages/workers/src/index.js";
import { headlessDiscussChannel } from "../../packages/cli/src/discuss.js";
import type { AgentRunner } from "../../packages/harness/src/index.js";

describe("architect discuss primitive", () => {
  it("defaults to false and parses an explicit discuss flag", async () => {
    const source = `version: 3\nworkflow:\n  name: test\n  nodes:\n    - stage:\n        name: architect\n        worker: architect\n        from: []\n`;
    const parsed = await Effect.runPromise(parseWorkflow(source, "/tmp/test.yml"));
    const compiled = await Effect.runPromise(compileWorkflow(parsed, "/tmp/test.yml"));
    expect(compiled.stages[0]?.stage.discuss).toBeUndefined();

    const withDiscuss = await Effect.runPromise(parseWorkflow(source.replace("from: []", "discuss: true\n        from: []"), "/tmp/test.yml"));
    expect(withDiscuss.workflow.nodes[0] && "stage" in withDiscuss.workflow.nodes[0]
      ? withDiscuss.workflow.nodes[0].stage.discuss
      : undefined).toBe(true);
  });

  it("mounts discuss only when enabled and returns supervisor text", async () => {
    let seen: { tools?: readonly string[]; discuss?: (question: string) => Promise<string> } | undefined;
    const runner: AgentRunner = (request) => {
      seen = request;
      return Effect.succeed({ sessionId: "s", transcriptPath: "/tmp/s", text: "done" });
    };
    const result = await Effect.runPromise(executeWorker({
      stage: "architect",
      worker: "architect",
      harness: "pi",
      prompt: "design",
      cwd: "/tmp",
      discuss: async () => "approved direction",
      agentRunner: runner,
    }).pipe(
      Effect.provideService(Logging, loggingService(
        new LogWriter("test", join(tmpdir(), "piano-discuss-test.log")),
        new TraceWriter("test", join(tmpdir(), "piano-discuss-test.trace")),
      )),
      Effect.provide(NodeFileSystem.layer),
    ));
    expect(result.text).toBe("done");
    expect(seen?.discuss).toBeDefined();
    expect(await seen!.discuss!("Is this boundary right?")).toBe("approved direction");
  });

  it("uses the deterministic self-decision reply in headless mode", async () => {
    const decision = await Effect.runPromise(headlessDiscussChannel()({
      stageId: "architect",
      invocationId: "architect@root",
      stage: "architect",
      worker: "coding-architect",
      harness: "claude",
      round: 1,
      transcriptPath: "/tmp/transcript",
      question: "Which implementation path should we choose?",
    }));
    expect(decision.answer).toBe("please make decision by yourself, i am not here");
  });

  it("rejects a malformed discuss value", async () => {
    const result = await Effect.runPromiseExit(parseWorkflow(
      `version: 3\nworkflow:\n  name: test\n  nodes:\n    - stage:\n        name: architect\n        worker: architect\n        discuss: yes\n        from: []\n`,
      "/tmp/test.yml",
    ));
    expect(Exit.isFailure(result)).toBe(true);
  });
});
