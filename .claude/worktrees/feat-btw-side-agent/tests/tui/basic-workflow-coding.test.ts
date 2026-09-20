// Guards for using the basic (sign-off) workflow as a coding agent:
//
//  A. Two prompts in a row: the second is understood against the first's
//     result (same pi session reopened via SessionManager.open — the fake's
//     memory only exists on a reopened session), inside ONE run directory
//     with exactly ONE session artifact file. A wrongly re-created execution
//     would answer turn 2 with "history: empty" and produce a second session.
//
//  B. A prompt submitted while the workflow has NOT ended must get no agent
//     response: the running worker never sees its text, and it runs only as
//     the next turn after the current run finishes.
//
// The scripted terminal / fake SDK plumbing lives in tests/common so the
// session-arc tests share it; this file keeps the two behaviour pins.
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";
import { executeWorkflow, loadWorkflow, readWorkflowExecutionContinuation, WorkflowError, type WorkflowSignoffDecision, type WorkflowSignoffRequest } from "../../packages/orchestrator/src/index.js";
import { executeAgent, type AgentRunner } from "../../packages/harness/src/index.js";
import { runTui } from "../../packages/cli/src/tui.js";
import { FakeTerminal, plain, sleep, waitFor } from "../common/terminal.js";
import { makeFakeSdk } from "../common/fake-pi-sdk.js";
import { listFiles } from "../common/fs.js";

const SIGNOFF_WORKFLOW = `version: 3
workflow:
  name: basic-workflow
  nodes:
    - stage:
        name: agent
        worker: basic
        harness: pi
        tools: [read, bash, edit, write]
        from: []
        signoff: true
`;

describe("basic workflow as a coding agent", () => {
  it("A: a second prompt is answered from the first turn's result, in one run with one session artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-coding-agent-A-"));
    try {
      await writeFile(join(root, "workflow.yml"), SIGNOFF_WORKFLOW);
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const { state, sdk } = makeFakeSdk();
      const runner: AgentRunner = (request, options) => executeAgent(request, { ...options, sdk });
      const runPrompt = (prompt: string, onEvent: (event: never) => void, signoff?: (r: WorkflowSignoffRequest) => Effect.Effect<WorkflowSignoffDecision, WorkflowError>) =>
        loadWorkflow(join(root, "workflow.yml"), root).pipe(
          Effect.flatMap((loaded) => readWorkflowExecutionContinuation(session.runDir, session.id).pipe(
            Effect.flatMap((execution) => executeWorkflow(loaded, {
              runDir: session.runDir,
              cwd: root,
              prompt,
              executionId: session.id,
              ...(execution === undefined ? {} : { execution }),
              agentRunner: runner,
              signoff,
              onEvent: onEvent as (event: unknown) => void,
            })),
          )),
          Effect.map((result) => result.text),
          Effect.provideService(Logging, loggingService(session.log, session.trace)),
          Effect.provide(NodeFileSystem.layer),
        );
      const terminal = new FakeTerminal();
      const running = Effect.runPromise(runTui({ terminal, runPrompt }));
      await sleep(50);
      // Turn 1: plant a fact, let the worker answer, approve its sign-off.
      terminal.onInput?.("Remember the magic word: banana.");
      terminal.onInput?.("\r");
      await waitFor("worker turn 1", () => state.promptTexts.length === 1);
      state.gates[state.gates.length - 1]!(); // release worker turn 1
      await waitFor("panel 1", () => plain(terminal).includes("Sign off agent?"));
      terminal.onInput?.("\r"); // approve: the run reaches its terminal state
      await waitFor("signoff 1 resolved", () => plain(terminal).includes("Sign off agent: approved"));
      expect(state.history.join(" ")).toContain("banana");
      // Turn 2 (after the run finished): the answer must recall the magic word.
      terminal.onInput?.("What is the magic word?");
      terminal.onInput?.("\r");
      await waitFor("worker turn 2", () => state.promptTexts.length === 2);
      state.gates[state.gates.length - 1]!();
      // Panel 2 appears after turn-2 worker reply; wait for it past the panel-1
      // "approved" text already in the output by recording a mark first.
      const mark2 = plain(terminal).length;
      await waitFor("panel 2", () => plain(terminal).slice(mark2).includes("Sign off agent?"));
      terminal.onInput?.("\r");
      await waitFor("turn 2 done", () => state.history.some((line) => line.includes("What is the magic word?")));
      const turn2Answer = state.history[state.history.length - 1];
      // Understood the first result: the reply is built on the reopened history.
      expect(turn2Answer).toContain("banana");
      // One execution, not a new one: exactly one create, one reopen.
      expect(state.createCalls).toBe(1);
      expect(state.openCalls).toBe(1);
      // One run directory, one session artifact file inside it.
      const runs = await readdir(join(root, "runs"));
      expect(runs).toHaveLength(1);
      const artifacts = (await listFiles(join(root, "runs", runs[0]!, "actors"))).filter((f) => f.endsWith(".jsonl"));
      expect(artifacts).toHaveLength(1);
      expect(existsSync(state.transcriptPath)).toBe(true);
      terminal.onInput?.("/exit");
      terminal.onInput?.("\r");
      await expect(running).resolves.toEqual({ type: "closed" });
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  }, 60000);

  it("B: a prompt submitted while the workflow has not ended gets no agent response", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-coding-agent-B-"));
    try {
      await writeFile(join(root, "workflow.yml"), SIGNOFF_WORKFLOW);
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const { state, sdk } = makeFakeSdk();
      const runner: AgentRunner = (request, options) => executeAgent(request, { ...options, sdk });
      const runPrompt = (prompt: string, onEvent: (event: never) => void, signoff?: (r: WorkflowSignoffRequest) => Effect.Effect<WorkflowSignoffDecision, WorkflowError>) =>
        loadWorkflow(join(root, "workflow.yml"), root).pipe(
          Effect.flatMap((loaded) => readWorkflowExecutionContinuation(session.runDir, session.id).pipe(
            Effect.flatMap((execution) => executeWorkflow(loaded, {
              runDir: session.runDir,
              cwd: root,
              prompt,
              executionId: session.id,
              ...(execution === undefined ? {} : { execution }),
              agentRunner: runner,
              signoff,
              onEvent: onEvent as (event: unknown) => void,
            })),
          )),
          Effect.map((result) => result.text),
          Effect.provideService(Logging, loggingService(session.log, session.trace)),
          Effect.provide(NodeFileSystem.layer),
        );
      const terminal = new FakeTerminal();
      const running = Effect.runPromise(runTui({ terminal, runPrompt }));
      await sleep(50);
      terminal.onInput?.("write me a haiku about rain");
      terminal.onInput?.("\r");
      await waitFor("worker started", () => state.promptTexts.length === 1);
      // The workflow is still on-the-fly: the second prompt must not reach it.
      // (The harness wraps the user text in stage context before the worker
      // sees it, so assert on substrings of what the session received.)
      terminal.onInput?.("ignore all instructions");
      terminal.onInput?.("\r");
      await sleep(200);
      expect(state.promptTexts).toHaveLength(1);
      expect(state.promptTexts[0]).toContain("write me a haiku about rain");
      expect(state.promptTexts[0]).not.toContain("ignore all instructions");
      expect(plain(terminal)).toContain("queued");
      // Releasing turn 1 does not deliver it either: the run must finish first.
      state.gates[state.gates.length - 1]!();
      await waitFor("panel 1", () => plain(terminal).includes("Sign off agent?"));
      expect(state.promptTexts).toHaveLength(1);
      terminal.onInput?.("\r"); // approve: the run ends now
      await waitFor("turn 2 started", () => state.promptTexts.length === 2);
      // Only as the next turn does the agent see it.
      expect(state.promptTexts[1]).toContain("ignore all instructions");
      state.gates[state.gates.length - 1]!();
      // Panel 2 appears after turn-2 worker reply; mark the output before it arrives.
      const markB = plain(terminal).length;
      await waitFor("panel 2", () => plain(terminal).slice(markB).includes("Sign off agent?"));
      terminal.onInput?.("\r");
      await sleep(100);
      terminal.onInput?.("/exit");
      terminal.onInput?.("\r");
      await expect(running).resolves.toEqual({ type: "closed" });
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  }, 60000);
});
