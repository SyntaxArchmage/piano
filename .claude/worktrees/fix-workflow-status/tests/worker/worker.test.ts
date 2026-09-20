import { Cause, Effect, Exit, Option } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentError,
  createSteeringChannel,
  executeAgent,
  type AgentRunner,
  type PiModule,
} from "../../packages/harness/src/index.js";
import { createSession, Logging, loggingService, type Session } from "../../packages/logging/src/index.js";
import { executeWorker, WorkerError } from "../../packages/workers/src/index.js";

function fakeSdk(): PiModule {
  const session = {
    sessionId: "session",
    sessionFile: "/tmp/session.jsonl",
    subscribe(listener: (event: unknown) => void): () => void {
      listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "ans = " } });
      listener({ type: "message_end", message: { content: "ans = 4" } });
      return () => undefined;
    },
    prompt: async () => undefined,
    abort: async () => undefined,
    dispose: () => undefined,
  };
  return {
    ModelRuntime: { create: async () => ({ getModel: () => ({ id: "model" }), setRuntimeApiKey: async () => undefined }) },
    SessionManager: { create: () => ({}) },
    SettingsManager: { inMemory: () => ({}) },
    DefaultResourceLoader: class {
      constructor(options: Record<string, unknown>) { void options; }
      reload = async () => undefined;
    },
    createAgentSession: async () => ({ session }),
  };
}

function fakeAgentRunner(sdk: PiModule): AgentRunner {
  return (request, options) => executeAgent(request, { ...options, sdk });
}

describe(" worker boundary", () => {
  async function createTestSession(): Promise<{ root: string; session: Session }> {
    const root = await mkdtemp(join(tmpdir(), "piano-worker-"));
    const session = await Effect.runPromise(createSession({
      root,
      cwd: root,
      runsRoot: join(root, "runs"),
    }).pipe(Effect.provide(NodeFileSystem.layer)));
    return { root, session };
  }

  it("runs the worker through the Effect-wrapped pi sdk and returns final text", async () => {
    const session = await createTestSession();
    try {
      const result = await Effect.runPromiseExit(executeWorker({
        stage: "respond",
        worker: "smoke-test-agent",
        harness: "pi",
        prompt: "hello",
        cwd: "/tmp",
        systemPromptPath: "/tmp/respond-system-prompt.md",
        agentRunner: fakeAgentRunner(fakeSdk()),
      }, { provider: "test-provider", model: "test-model" }).pipe(
        Effect.provideService(Logging, loggingService(session.session.log, session.session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
    expect(Exit.isSuccess(result)).toBe(true);
    if (Exit.isSuccess(result)) {
      expect(result.value.text).toBe("ans = 4");
      expect(result.value.stage).toBe("respond");
    }
    } finally {
      await rm(session.root, { recursive: true, force: true });
    }
  });

  it("rejects the retired default harness value", async () => {
    const session = await createTestSession();
    try {
      const result = await Effect.runPromiseExit(executeWorker({
        stage: "respond",
        worker: "smoke-test-agent",
        harness: "default",
        prompt: "hello",
        cwd: "/tmp",
        agentRunner: fakeAgentRunner(fakeSdk()),
      }, { provider: "test-provider", model: "test-model" }).pipe(
        Effect.provideService(Logging, loggingService(session.session.log, session.session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const failure = Cause.failureOption(result.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) {
          expect(failure.value).toBeInstanceOf(WorkerError);
          expect(failure.value.message).toContain("unsupported harness \"default\"");
        }
      }
    } finally {
      await rm(session.root, { recursive: true, force: true });
    }
  });

  it("fails clearly when a workflow names an unavailable harness", async () => {
    const session = await createTestSession();
    try {
      const result = await Effect.runPromiseExit(executeWorker({
        stage: "respond",
        worker: "smoke-test-agent",
        harness: "future-harness",
        prompt: "hello",
        cwd: "/tmp",
      }, { provider: "test-provider", model: "test-model" }).pipe(
        Effect.provideService(Logging, loggingService(session.session.log, session.session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const failure = Cause.failureOption(result.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) {
          expect(failure.value).toBeInstanceOf(WorkerError);
          expect(failure.value.message).toContain("unsupported harness \"future-harness\"");
        }
      }
    } finally {
      await rm(session.root, { recursive: true, force: true });
    }
  });

  it("keeps harness failure as the worker error cause", async () => {
    const session = await createTestSession();
    try {
      const sdk = fakeSdk();
      const failingSdk: PiModule = {
        ...sdk,
        ModelRuntime: {
          create: async () => ({ getModel: () => undefined, setRuntimeApiKey: async () => undefined }),
        },
      };
      const result = await Effect.runPromiseExit(executeWorker({
        stage: "respond",
        worker: "smoke-test-agent",
        prompt: "hello",
        cwd: "/tmp",
        systemPromptPath: "/tmp/respond-system-prompt.md",
        agentRunner: fakeAgentRunner(failingSdk),
      }, { provider: "test-provider", model: "test-model" }).pipe(
        Effect.provideService(Logging, loggingService(session.session.log, session.session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(result)).toBe(true);
      if (!Exit.isFailure(result)) return;
      const failure = Cause.failureOption(result.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value).toBeInstanceOf(WorkerError);
        expect(failure.value.cause).toBeInstanceOf(AgentError);
        expect(failure.value.message).toContain("worker \"smoke-test-agent\" failed at stage \"respond\"");
        expect(failure.value.message).toContain("[model-not-found]");
      }
      const log = await readFile(session.session.log.path, "utf8");
      const harnessFailed = log.split("\n").filter(Boolean).map((line) => JSON.parse(line))
        .find((entry) => entry.event === "harness.failed");
      expect(harnessFailed).toBeDefined();
      expect(harnessFailed.module).toBe("harness");
      expect(harnessFailed.attributes.kind).toBe("model-not-found");
    } finally {
      await rm(session.root, { recursive: true, force: true });
    }
  });

  // Tier: mocked integration. The worker is a transport for the steering
  // channel: `executeWorker` must hand it to the harness request verbatim, so
  // the pi adapter can bind the live session (see pi.test.ts " pi sdk
  // steering"). Identity equality is the whole contract — the worker never
  // interprets or branches on it.
  it("threads the steering channel into the harness request", async () => {
    const session = await createTestSession();
    try {
      const channel = createSteeringChannel();
      let seen: unknown;
      const runner: AgentRunner = (request) => {
        seen = request.steering;
        return Effect.succeed({
          sessionId: "steer-thread",
          transcriptPath: "/tmp/steer-thread.jsonl",
          text: "ok",
        });
      };
      const result = await Effect.runPromise(executeWorker({
        stage: "respond",
        worker: "steer-threading",
        prompt: "hello",
        cwd: "/tmp",
        steering: channel,
        agentRunner: runner,
      }).pipe(
        Effect.provideService(Logging, loggingService(session.session.log, session.session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(result.text).toBe("ok");
      expect(seen).toBe(channel);
    } finally {
      await rm(session.root, { recursive: true, force: true });
    }
  });
});
