// A `discuss: true` stage asks for a supervisor channel that only the
// in-process pi SDK can mount. A workflow that declares it on a harness which
// cannot deliver the tool, or omits the tool from the stage's allowlist, must
// fail at load rather than degrade into a silent one-shot guess.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";
import {
  compileWorkflow,
  loadAndExecuteWorkflow,
  parseWorkflow,
} from "../../packages/orchestrator/src/index.js";

function workflow(stage: string): string {
  return `version: 3
workflow:
  name: discuss-capability
  nodes:
    - stage:
${stage}
`;
}

async function run(workflowSource: string): Promise<{ message: string; workerCalls: number }> {
  const root = await mkdtemp(join(tmpdir(), "piano-discuss-capability-"));
  try {
    await writeFile(join(root, "workflow.yml"), workflowSource);
    const session = await Effect.runPromise(
      createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    let workerCalls = 0;
    const exit = await Effect.runPromiseExit(loadAndExecuteWorkflow({
      root,
      workflowPath: join(root, "workflow.yml"),
      runDir: session.runDir,
      runId: "discuss-capability",
      cwd: root,
      prompt: "ask the supervisor",
      discuss: () => Effect.succeed({ answer: "take the narrow option" }),
      agentRunner: () => Effect.sync(() => {
        workerCalls += 1;
        return { sessionId: "unused", transcriptPath: "/tmp/unused.jsonl", text: "unused" };
      }),
    }).pipe(
      Effect.provideService(Logging, loggingService(session.log, session.trace)),
      Effect.provide(NodeFileSystem.layer),
    ));
    return { message: Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "", workerCalls };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("discuss capability at load", () => {
  it("rejects a stage whose harness cannot mount the tool, before any worker runs", async () => {
    for (const harness of ["pi-cli", "codex"]) {
      const { message, workerCalls } = await run(workflow(`        name: ask
        worker: basic
        harness: ${harness}
        discuss: true
        from: []`));
      expect(workerCalls).toBe(0);
      expect(message).toContain(`stage "ask" declares discuss: true but harness "${harness}" cannot mount the discuss tool`);
    }
  });

  it("rejects a stage whose tools list names discuss without the flag", async () => {
    const { message, workerCalls } = await run(workflow(`        name: ask
        worker: basic
        harness: claude
        tools: [Read, Bash, discuss]
        from: []`));
    expect(workerCalls).toBe(0);
    expect(message).toContain('lists "discuss" in tools but does not declare discuss: true');
  });

  it("accepts claude and dsh, which receive the MCP tool", async () => {
    for (const harness of ["claude", "dsh"]) {
      const source = workflow(`        name: ask
        worker: basic
        harness: ${harness}
        discuss: true
        from: []`);
      const compiled = await Effect.runPromise(parseWorkflow(source, "/tmp/workflow.yml").pipe(
        Effect.flatMap((parsed) => compileWorkflow(parsed, "/tmp/workflow.yml")),
      ));
      expect(compiled.stages[0]?.stage.discuss).toBe(true);
    }
  });

  it("rejects a pi stage whose tool allowlist omits discuss", async () => {
    const { message, workerCalls } = await run(workflow(`        name: ask
        worker: basic
        harness: pi
        discuss: true
        tools: [read, bash]
        from: []`));
    expect(workerCalls).toBe(0);
    expect(message).toContain('stage "ask" declares discuss: true but does not list "discuss" in tools');
  });

  it("accepts a pi stage that declares the tool", async () => {
    const source = workflow(`        name: ask
        worker: basic
        harness: pi
        discuss: true
        tools: [read, bash, discuss]
        from: []`);
    const compiled = await Effect.runPromise(parseWorkflow(source, "/tmp/workflow.yml").pipe(
      Effect.flatMap((parsed) => compileWorkflow(parsed, "/tmp/workflow.yml")),
    ));
    expect(compiled.stages.map((stage) => stage.stage.name)).toEqual(["ask"]);
  });
});
