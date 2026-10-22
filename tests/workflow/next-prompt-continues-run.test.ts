// The run's workflow execution is get-or-create, never re-created, across
// prompts: a second prompt on a finished run continues the same execution
// (same runId) on the same resumed actor (same sessionId, turns 2) —
// the identical path /resume takes. This is the engine half of the TUI's
// queued-next-prompt behavior (tests/tui/prompt-queue.test.ts).
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";
import {
  executeWorkflow,
  loadWorkflow,
  readRunStatus,
  readWorkflowExecutionContinuation,
  type WorkflowExecutionContinuation,
  type WorkflowSignoffRequest,
} from "../../packages/orchestrator/src/index.js";
import { executeAgent, type AgentRequest, type AgentRunner, type PiModule } from "../../packages/harness/src/index.js";

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

function fakeSdk(): PiModule {
  const session = {
    sessionId: "workflow-session",
    sessionFile: "/tmp/workflow-session.jsonl",
    subscribe(listener: (event: unknown) => void): () => void {
      listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "ans = " } });
      listener({ type: "message_end", message: { content: "answer" } });
      return () => undefined;
    },
    prompt: async () => undefined,
    abort: async () => undefined,
    dispose: () => undefined,
  };
  return {
    ModelRuntime: { create: async () => ({ getModel: () => ({ id: "model" }), setRuntimeApiKey: async () => undefined }) },
    SessionManager: { create: () => ({}), open: () => ({}) },
    SettingsManager: { inMemory: () => ({}) },
    DefaultResourceLoader: class {
      constructor(options: Record<string, unknown>) { void options; }
      reload = async () => undefined;
    },
    createAgentSession: async () => ({ session }),
  };
}

describe("a finished run's next prompt continues its workflow execution", () => {
  it("keeps the execution id and resumes the same actor, never creating a new one", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-next-prompt-continues-"));
    try {
      await writeFile(join(root, "workflow.yml"), SIGNOFF_WORKFLOW);
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const runner: AgentRunner = (request, options) => executeAgent(request, { ...options, sdk: fakeSdk() });
      const signoff = (_request: WorkflowSignoffRequest) => Effect.succeed({ type: "continue" as const });
      // This mirrors the TUI's runPrompt: GET the run's execution first, pass it
      // to executeWorkflow, and only a first prompt (or a run with no
      // continuation) starts without one.
      const prompt = (text: string) =>
        Effect.runPromise(
          loadWorkflow(join(root, "workflow.yml"), root).pipe(
            Effect.flatMap((loaded) => readWorkflowExecutionContinuation(session.runDir).pipe(
              Effect.flatMap((execution) => executeWorkflow(loaded, {
                runDir: session.runDir,
                cwd: root,
                prompt: text,
                runId: session.id,
                ...(execution === undefined ? {} : { execution }),
                signoff,
                agentRunner: runner,
              })),
            )),
            Effect.provideService(Logging, loggingService(session.log, session.trace)),
            Effect.provide(NodeFileSystem.layer),
          ),
        );
      const first = await prompt("first prompt");
      const continued = await Effect.runPromise(
        readWorkflowExecutionContinuation(session.runDir).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      expect(continued).toBeDefined();
      const second = await prompt("second prompt");
      expect(second.text).toBeTruthy();
      // Same run = same execution; the actor was resumed, not re-created.
      expect(second.runId).toBe(first.runId);
      const after = await Effect.runPromise(
        readWorkflowExecutionContinuation(session.runDir).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      // A finished job's next prompt is new work: a second job, not a continue.
      const status = await Effect.runPromise(readRunStatus(session.runDir).pipe(Effect.provide(NodeFileSystem.layer)));
      expect(status?.jobs.map((job) => job.jobOrdinal)).toEqual([1, 2]);
      const firstActor = continued?.actors.values().next().value;
      const secondActor = after?.actors.values().next().value;
      // Resumed the very same harness session: one actor, two turns.
      expect(firstActor?.continuation?.sessionId).toBeDefined();
      expect(secondActor?.continuation?.sessionId).toBe(firstActor?.continuation?.sessionId);
      expect(secondActor?.turns).toBeGreaterThanOrEqual(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("starts a memory-disabled stage fresh on the next prompt while retaining resume state", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-next-prompt-no-memory-"));
    try {
      const workflowPath = join(root, "workflow.yml");
      await writeFile(workflowPath, SIGNOFF_WORKFLOW.replace(
        "        signoff: true\n",
        "        signoff: true\n        memory: false\n",
      ));
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const requests: AgentRequest[] = [];
      const runner: AgentRunner = (request) => Effect.sync(() => {
        requests.push(request);
        const sessionId = `workflow-session-${requests.length}`;
        return {
          sessionId,
          transcriptPath: `/tmp/${sessionId}.jsonl`,
          text: `answer ${requests.length}`,
          continuation: { harness: "pi" as const, sessionId, transcriptPath: `/tmp/${sessionId}.jsonl` },
        };
      });
      const signoff = (_request: WorkflowSignoffRequest) => Effect.succeed({ type: "continue" as const });
      const prompt = (text: string, execution?: WorkflowExecutionContinuation) =>
        Effect.runPromise(
          loadWorkflow(workflowPath, root).pipe(
            Effect.flatMap((loaded) => executeWorkflow(loaded, {
              runDir: session.runDir,
              cwd: root,
              prompt: text,
              runId: session.id,
              ...(execution === undefined ? {} : { execution }),
              signoff,
              agentRunner: runner,
            })),
            Effect.provideService(Logging, loggingService(session.log, session.trace)),
            Effect.provide(NodeFileSystem.layer),
          ),
        );
      const readBack = () =>
        Effect.runPromise(
          readWorkflowExecutionContinuation(session.runDir).pipe(Effect.provide(NodeFileSystem.layer)),
        );

      await prompt("first prompt");
      const saved = await readBack();
      await prompt("second prompt", saved);

      expect(requests.map((request) => request.continuation)).toEqual([undefined, undefined]);
      expect((await readBack())?.actors.values().next().value?.continuation).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // A live coding session switches workflow (a different stage, a different
  // worker) and switches back. Each prompt persists the actor table, so a
  // prompt that ran other actors must not evict the ones it did not touch:
  // evicted means unreachable, and the session the harness still holds on disk
  // is silently abandoned — the prompt after that starts the conversation over.
  it("keeps a workflow's actor while other prompts run a different workflow", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-switch-workflow-"));
    try {
      const FIRST_STAGE = join(root, "first.yml");
      const SECOND_STAGE = join(root, "second.yml");
      await writeFile(FIRST_STAGE, SIGNOFF_WORKFLOW);
      await writeFile(
        SECOND_STAGE,
        SIGNOFF_WORKFLOW.replace("name: agent", "name: reviewer").replace("worker: basic", "worker: smoke-test-agent"),
      );
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const runner: AgentRunner = (request, options) => executeAgent(request, { ...options, sdk: fakeSdk() });
      const signoff = (_request: WorkflowSignoffRequest) => Effect.succeed({ type: "continue" as const });
      const prompt = (workflowPath: string, text: string) =>
        Effect.runPromise(
          loadWorkflow(workflowPath, root).pipe(
            Effect.flatMap((loaded) => readWorkflowExecutionContinuation(session.runDir).pipe(
              Effect.flatMap((execution) => executeWorkflow(loaded, {
                runDir: session.runDir,
                cwd: root,
                prompt: text,
                runId: session.id,
                ...(execution === undefined ? {} : { execution }),
                signoff,
                agentRunner: runner,
              })),
            )),
            Effect.provideService(Logging, loggingService(session.log, session.trace)),
            Effect.provide(NodeFileSystem.layer),
          ),
        );
      const readBack = () =>
        Effect.runPromise(
          readWorkflowExecutionContinuation(session.runDir).pipe(Effect.provide(NodeFileSystem.layer)),
        );

      await prompt(FIRST_STAGE, "first prompt");
      const firstActorKey = `v2/${session.id}/pi/basic/root`;
      const firstSession = (await readBack())?.actors.get(firstActorKey)?.continuation.sessionId;
      expect(firstSession).toBeDefined();

      await prompt(SECOND_STAGE, "second prompt");
      const both = await readBack();

      // The workflow that did not run is still resumable, identity and all.
      expect(both?.actors.get(firstActorKey)?.continuation.sessionId).toBe(firstSession);
      expect(both?.actors.has(`v2/${session.id}/pi/smoke-test-agent/root`)).toBe(true);

      // Returning to it reopens that same conversation instead of starting over.
      await prompt(FIRST_STAGE, "third prompt");
      const after = await readBack();
      expect(after?.actors.get(firstActorKey)?.turns).toBeGreaterThanOrEqual(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // One worker, one memory: switching to a different workflow that reuses the
  // same worker continues the same conversation instead of opening a second
  // one. This is what makes "run a workflow, then keep working on it" resume
  // the same chat.
  it("shares one conversation across workflows that reuse the same worker", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-switch-worker-"));
    try {
      const FIRST_STAGE = join(root, "first.yml");
      const SECOND_STAGE = join(root, "second.yml");
      await writeFile(FIRST_STAGE, SIGNOFF_WORKFLOW);
      await writeFile(SECOND_STAGE, SIGNOFF_WORKFLOW.replace("name: agent", "name: reviewer"));
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const runner: AgentRunner = (request, options) => executeAgent(request, { ...options, sdk: fakeSdk() });
      const signoff = (_request: WorkflowSignoffRequest) => Effect.succeed({ type: "continue" as const });
      const prompt = (workflowPath: string, text: string) =>
        Effect.runPromise(
          loadWorkflow(workflowPath, root).pipe(
            Effect.flatMap((loaded) => readWorkflowExecutionContinuation(session.runDir).pipe(
              Effect.flatMap((execution) => executeWorkflow(loaded, {
                runDir: session.runDir,
                cwd: root,
                prompt: text,
                runId: session.id,
                ...(execution === undefined ? {} : { execution }),
                signoff,
                agentRunner: runner,
              })),
            )),
            Effect.provideService(Logging, loggingService(session.log, session.trace)),
            Effect.provide(NodeFileSystem.layer),
          ),
        );

      await prompt(FIRST_STAGE, "first prompt");
      await prompt(SECOND_STAGE, "second prompt");
      const actors = await Effect.runPromise(
        readWorkflowExecutionContinuation(session.runDir).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      // ONE actor under the worker key: the reviewer stage continued the
      // agent stage's conversation instead of opening its own.
      const actorKey = `v2/${session.id}/pi/basic/root`;
      expect([...(actors?.actors.keys() ?? [])]).toEqual([actorKey]);
      expect(actors?.actors.get(actorKey)?.turns).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
