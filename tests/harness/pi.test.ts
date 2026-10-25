import { Cause, Effect, Exit, Option } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AgentError,
  createSteeringChannel,
  defaultPiConfigPath,
  executeAgent,
  type AgentEvent,
  type PiModule,
} from "../../packages/harness/src/index.js";
import {
  createSession,
  Logging,
  loggingService,
} from "../../packages/logging/src/index.js";

const TEST_MODEL = { provider: "test-provider", model: "test-model" } as const;
// Default failed-exit backoff (5s/20s) would dominate these adapter tests;
// retry behavior itself is covered by the dedicated retry tests.
const TEST_RETRY = { retryDelaysMs: [10, 10] } as const;

function sdkLoaderFixture(
  root: string,
  id: string,
  observe: {
    readonly resourceLoader?: (options: Record<string, unknown>) => void;
    readonly session?: (options: Record<string, unknown>) => void;
  } = {},
): PiModule {
  const session = {
    sessionId: `${id}-session`,
    sessionFile: join(root, `${id}.jsonl`),
    subscribe: (): (() => void) => () => undefined,
    prompt: async (): Promise<void> => undefined,
    abort: async (): Promise<void> => undefined,
    dispose: (): void => undefined,
  };
  return {
    ModelRuntime: {
      create: async () => ({
        getModel: () => ({ id: `${id}-model` }),
        setRuntimeApiKey: async () => undefined,
      }),
    },
    SessionManager: { create: () => ({}) },
    SettingsManager: { inMemory: () => ({}) },
    DefaultResourceLoader: class {
      constructor(options: Record<string, unknown>) {
        observe.resourceLoader?.(options);
      }
      reload = async (): Promise<void> => undefined;
    },
    createAgentSession: async (options: Record<string, unknown>) => {
      observe.session?.(options);
      return { session };
    },
  };
}

describe("pi discuss wiring", () => {
  it("mounts a supervisor tool only with a discuss callback and returns its answer", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-discuss-wire-"));
    let sessionOptions: Record<string, unknown> | undefined;
    let asked = "";
    try {
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const result = await Effect.runPromise(executeAgent({
        cwd: root,
        prompt: "design",
        discuss: (question) => Effect.sync(() => { asked = question; return "use the narrow option"; }),
      }, {
        sdk: sdkLoaderFixture(root, "discuss", { session: (options) => { sessionOptions = options; } }),
        ...TEST_MODEL,
        ...TEST_RETRY,
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(result.text).toBe("");
      const customTools = sessionOptions?.customTools as Array<{
        name: string;
        execute: (_toolCallId: string, params: { question: string }) => Promise<{ type: string; content: string }>;
      }>;
      expect(customTools.map((tool) => tool.name)).toContain("discuss");
      const discussTool = customTools.find((tool) => tool.name === "discuss")!;
      expect(await discussTool.execute("call-1", { question: "Which option?" })).toEqual({
        type: "tool-result",
        content: "use the narrow option",
      });
      expect(asked).toBe("Which option?");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not mount discuss for ordinary requests", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-no-discuss-"));
    let sessionOptions: Record<string, unknown> | undefined;
    try {
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      await Effect.runPromise(executeAgent({ cwd: root, prompt: "ordinary" }, {
        sdk: sdkLoaderFixture(root, "ordinary", { session: (options) => { sessionOptions = options; } }),
        ...TEST_MODEL,
        ...TEST_RETRY,
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      const customTools = sessionOptions?.customTools as Array<{ name: string }> | undefined;
      expect(customTools?.some((tool) => tool.name === "discuss")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("pi web_search wiring", () => {
  it("loads the extension only for a stage that declares web_search", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-web-search-wire-"));
    const configPath = join(root, "agent.config.json");
    const previousConfig = process.env.PIANO_USER_AGENT_CONFIG;
    let resourceOptions: Record<string, unknown> | undefined;
    let sessionOptions: Record<string, unknown> | undefined;
    try {
      await writeFile(configPath, JSON.stringify({
        provider: TEST_MODEL.provider,
        model: TEST_MODEL.model,
        baseUrl: "https://gateway.example/v1",
        apiKey: "test-key",
      }));
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", configPath);
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const result = await Effect.runPromiseExit(executeAgent({
        cwd: root,
        prompt: "search",
        tools: ["web_search"],
      }, {
        sdk: sdkLoaderFixture(root, "web-search", {
          resourceLoader: (options) => { resourceOptions = options; },
          session: (options) => { sessionOptions = options; },
        }),
        ...TEST_MODEL,
        ...TEST_RETRY,
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(result)).toBe(true);
      expect(resourceOptions?.extensionFactories).toHaveLength(1);
      expect(sessionOptions?.customTools).toBeUndefined();
    } finally {
      if (previousConfig === undefined) delete process.env.PIANO_USER_AGENT_CONFIG;
      else process.env.PIANO_USER_AGENT_CONFIG = previousConfig;
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe(" pi sdk cancellation", () => {
  it("keeps the Pi config in the user config directory", () => {
    expect(defaultPiConfigPath).toBe(join(homedir(), ".piano", "agent.config.json"));
  });

  it("reuses a successful SDK module load for the same loader", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-loader-cache-"));
    try {
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const sdk = sdkLoaderFixture(root, "cached");
      let loads = 0;
      const sdkLoader = (): Effect.Effect<PiModule, AgentError> => {
        loads += 1;
        return Effect.succeed(sdk);
      };
      const run = (prompt: string) => executeAgent({
        cwd: root,
        prompt,
        tools: [],
        sessionDir: join(root, "sessions"),
      }, { sdkLoader, ...TEST_MODEL, ...TEST_RETRY }).pipe(
        Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
        Effect.provide(NodeFileSystem.layer),
      );
      expect(Exit.isSuccess(await Effect.runPromiseExit(run("first")))).toBe(true);
      expect(Exit.isSuccess(await Effect.runPromiseExit(run("second")))).toBe(true);
      expect(loads).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reopens the harness transcript when a continuation is supplied", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-continuation-"));
    try {
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const sdk = sdkLoaderFixture(root, "continued");
      let reopened: readonly string[] | undefined;
      const resumedSdk: PiModule = {
        ...sdk,
        SessionManager: {
          create: sdk.SessionManager.create,
          open: (path, sessionDir, cwd) => {
            reopened = [path, sessionDir ?? "", cwd ?? ""];
            return {};
          },
        },
      };
      const result = await Effect.runPromiseExit(executeAgent({
        cwd: root,
        prompt: "continue",
        tools: [],
        sessionDir: join(root, "sessions"),
        continuation: {
          harness: "pi",
          sessionId: "prior-session",
          transcriptPath: join(root, "prior.jsonl"),
        },
      }, { sdk: resumedSdk, ...TEST_MODEL, ...TEST_RETRY }).pipe(
        Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(result)).toBe(true);
      expect(reopened).toEqual([join(root, "prior.jsonl"), join(root, "sessions"), root]);
      if (Exit.isSuccess(result)) expect(result.value.continuation).toMatchObject({ harness: "pi" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("bounds transient SDK load retries and recovers after a failed cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-loader-retry-"));
    try {
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const sdk = sdkLoaderFixture(root, "retry");
      let loads = 0;
      let fail = true;
      const sdkLoader = (): Effect.Effect<PiModule, AgentError> => {
        loads += 1;
        return fail
          ? Effect.fail(new AgentError({
            kind: "sdk-load",
            message: "temporary module unavailable",
            cause: Object.assign(new Error("temporary module unavailable"), { code: "EAGAIN" }),
          }))
          : Effect.succeed(sdk);
      };
      const run = () => executeAgent({ cwd: root, prompt: "retry", tools: [] }, { sdkLoader, ...TEST_MODEL, ...TEST_RETRY }).pipe(
        Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
        Effect.provide(NodeFileSystem.layer),
      );
      const failed = await Effect.runPromiseExit(run());
      expect(Exit.isFailure(failed)).toBe(true);
      if (Exit.isFailure(failed)) {
        const failure = Cause.failureOption(failed.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) {
          expect(failure.value).toBeInstanceOf(AgentError);
          expect(failure.value.kind).toBe("sdk-load");
        }
      }
      expect(loads).toBe(3);
      fail = false;
      expect(Exit.isSuccess(await Effect.runPromiseExit(run()))).toBe(true);
      expect(loads).toBe(4);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not retry a permanent SDK import failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-loader-permanent-"));
    try {
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      let loads = 0;
      const sdkLoader = (): Effect.Effect<PiModule, AgentError> => {
        loads += 1;
        return Effect.fail(new AgentError({
          kind: "sdk-load",
          message: "module not found",
          cause: Object.assign(new Error("module not found"), { code: "ERR_MODULE_NOT_FOUND" }),
        }));
      };
      const result = await Effect.runPromiseExit(executeAgent({ cwd: root, prompt: "permanent", tools: [] }, { sdkLoader, ...TEST_MODEL, ...TEST_RETRY }).pipe(
        Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(result)).toBe(true);
      expect(loads).toBe(1);
      if (Exit.isFailure(result)) {
        const failure = Cause.failureOption(result.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) {
          expect(failure.value).toBeInstanceOf(AgentError);
          expect(failure.value.kind).toBe("sdk-load");
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps transient SDK load classification total when the error code getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-loader-code-getter-"));
    try {
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      let loads = 0;
      const sdkLoader = (): Effect.Effect<PiModule, AgentError> => {
        loads += 1;
        const cause = new Error("temporary module unavailable");
        Object.defineProperty(cause, "code", {
          get: () => { throw new Error("error code unavailable"); },
        });
        return Effect.fail(new AgentError({
          kind: "sdk-load",
          message: "temporary module unavailable",
          cause,
        }));
      };
      const result = await Effect.runPromiseExit(executeAgent({ cwd: root, prompt: "malformed code", tools: [] }, { sdkLoader, ...TEST_MODEL, ...TEST_RETRY }).pipe(
        Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(result)).toBe(true);
      expect(loads).toBe(3);
      if (Exit.isFailure(result)) {
        const failure = Cause.failureOption(result.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) {
          expect(failure.value).toBeInstanceOf(AgentError);
          expect(failure.value.kind).toBe("sdk-load");
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports SDK installation discovery failures separately from a missing SDK", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-discovery-"));
    const commandlessPath = await mkdtemp(join(tmpdir(), "piano-pi-no-npm-"));
    const originalPath = process.env.PATH;
    process.env.PATH = commandlessPath;
    try {
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const result = await Effect.runPromiseExit(executeAgent({
        cwd: root,
        prompt: "discover sdk",
        tools: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const failure = Cause.failureOption(result.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) {
          expect(failure.value).toBeInstanceOf(AgentError);
          expect(failure.value.kind).toBe("sdk-discovery");
          expect(failure.value.message).toContain("unable to inspect the pi SDK installation");
        }
      }
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      await rm(commandlessPath, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes the workflow prompt and skills to the pi resource loader", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-resources-"));
    try {
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      await writeFile(join(root, "AGENTS.md"), "context\n");
      const skillPath = join(root, "recipes/skills/smoke-test-agent/smoke-test-agent.md");
      const skillContent = "---\nname: smoke-test-agent\ndescription: test\n---\nskill\n";
      await mkdir(join(root, "recipes/skills/smoke-test-agent"), { recursive: true });
      await writeFile(skillPath, skillContent, { encoding: "utf8" });
      let loaderOptions: Record<string, unknown> | undefined;
      let sessionOptions: Record<string, unknown> | undefined;
      let sessionManagerCwd: string | undefined;
      let sessionManagerDir: string | undefined;
      const events: AgentEvent[] = [];
      const session = {
        sessionId: "resource-session",
        sessionFile: join(root, "session.jsonl"),
        subscribe(listener: (event: unknown) => void): () => void {
          listener({ type: "message_end", message: { role: "user", content: "resource check" } });
          listener({ type: "message_end", message: { content: "ok" } });
          return () => undefined;
        },
        prompt: async (): Promise<void> => undefined,
        abort: async (): Promise<void> => undefined,
        dispose: (): void => undefined,
      };
      const sdk: PiModule = {
        ModelRuntime: {
          create: async () => ({
            getModel: () => ({ id: "resource-model" }),
            setRuntimeApiKey: async () => undefined,
          }),
        },
        SessionManager: {
          create: (cwd, sessionDir) => {
            sessionManagerCwd = cwd;
            sessionManagerDir = sessionDir;
            return {};
          },
        },
        SettingsManager: { inMemory: (settings) => settings },
        DefaultResourceLoader: class {
          constructor(options: Record<string, unknown>) { loaderOptions = options; }
          reload = async (): Promise<void> => undefined;
          getAgentsFiles(): { agentsFiles: readonly { path: string; content: string }[] } {
            const override = loaderOptions?.agentsFilesOverride as ((base: unknown) => { agentsFiles: readonly { path: string; content: string }[] }) | undefined;
            return override?.({ agentsFiles: [] }) ?? { agentsFiles: [] };
          }
          getSkills(): { skills: readonly { name: string; filePath: string }[] } {
            return {
              skills: [{
                name: "smoke-test-agent",
                filePath: skillPath,
              }],
            };
          }
          getSystemPrompt(): string { return "system"; }
          getSystemPromptSource(): { path: string } {
            return { path: join(root, "recipes/system-prompt/smoke-test-agent-system-prompt.md") };
          }
        },
        createAgentSession: async (options) => { sessionOptions = options; return { session }; },
      };
      const result = await Effect.runPromiseExit(
        executeAgent({
          cwd: root,
          prompt: "resource check",
          systemPromptPath: join(root, "recipes/system-prompt/smoke-test-agent-system-prompt.md"),
          contextFilePaths: [join(root, "AGENTS.md")],
          skillPaths: [skillPath],
          tools: [],
          sessionDir: join(root, "session-dir"),
          onEvent: (event) => events.push(event),
        }, { sdk, ...TEST_MODEL, ...TEST_RETRY }).pipe(
          Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      expect(Exit.isSuccess(result)).toBe(true);
      expect(loaderOptions).toMatchObject({
        systemPrompt: join(root, "recipes/system-prompt/smoke-test-agent-system-prompt.md"),
        additionalSkillPaths: [skillPath],
        appendSystemPrompt: [`<workflow_skill path="${skillPath}">\n${skillContent}\n</workflow_skill>`],
        noSkills: true,
        noContextFiles: true,
      });
      const override = loaderOptions?.agentsFilesOverride as ((base: unknown) => { agentsFiles: readonly { path: string; content: string }[] }) | undefined;
      expect(override?.({ agentsFiles: [] }).agentsFiles).toEqual([
        { path: join(root, "AGENTS.md"), content: "context\n" },
      ]);
      expect(sessionOptions?.tools).toEqual([]);
      // Issue #45: both settings-manager creation sites pass the raised
      // in-session API retry budget (10), not the historical 2.
      expect(loaderOptions?.settingsManager).toMatchObject({
        retry: { enabled: true, maxRetries: 10 },
      });
      expect(sessionOptions?.settingsManager).toMatchObject({
        retry: { enabled: true, maxRetries: 10 },
      });
      // Issue #51: neither site may disable compaction. The SDK resolves
      // `compaction?.enabled ?? true`, so leaving the key absent keeps sessions
      // bounded; an explicit `false` un-bounds them and turned multi-iteration
      // loop accumulation into `run.failed` at the model window ceiling.
      for (const options of [loaderOptions, sessionOptions]) {
        const settings = options?.settingsManager as
          | { compaction?: { enabled?: boolean } }
          | undefined;
        expect(settings?.compaction?.enabled).not.toBe(false);
      }
      expect(sessionManagerCwd).toBe(root);
      expect(sessionManagerDir).toBe(join(root, "session-dir"));
      expect(events.find((event) => event.type === "context")).toMatchObject({
        context: {
          systemPromptPath: join(root, "recipes/system-prompt/smoke-test-agent-system-prompt.md"),
          contextFilePaths: [join(root, "AGENTS.md")],
        },
      });
      expect(events.filter((event) => event.type === "message_end").at(-1)).toEqual({
        type: "message_end", message: { content: "ok" },
      });
      expect(events.filter((event) => event.type === "resource")).toEqual([
        {
          type: "resource",
          resource: {
            kind: "system-prompt", status: "requested", source: "workflow",
            path: join(root, "recipes/system-prompt/smoke-test-agent-system-prompt.md"),
          },
        },
        {
          type: "resource",
          resource: { kind: "context-file", status: "requested", source: "workflow", path: join(root, "AGENTS.md") },
        },
        {
          type: "resource",
          resource: {
            kind: "skill", status: "requested", source: "workflow",
            path: skillPath,
          },
        },
        {
          type: "resource",
          resource: {
            kind: "system-prompt", status: "loaded", source: "workflow",
            path: join(root, "recipes/system-prompt/smoke-test-agent-system-prompt.md"),
            bytes: Buffer.byteLength("system", "utf8"),
          },
        },
        {
          type: "resource",
          resource: {
            kind: "context-file", status: "loaded", source: "workflow",
            path: join(root, "AGENTS.md"), bytes: Buffer.byteLength("context\n", "utf8"),
          },
        },
        {
          type: "resource",
          resource: {
            kind: "skill", status: "loaded", source: "workflow",
            path: skillPath, name: "smoke-test-agent", bytes: Buffer.byteLength(skillContent, "utf8"),
          },
        },
      ]);
      const log = await readFile(join(runSession.runDir, "system-log", "log.jsonl"), "utf8");
      expect(log).toContain('"event":"agent.resource.requested"');
      expect(log).toContain('"event":"agent.resource.loaded"');
      expect(log).toContain(join(root, "AGENTS.md"));
      expect(log).toContain(`"bytes":${Buffer.byteLength("context\n", "utf8")}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("leaves the SDK system prompt untouched when the workflow omits one", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-default-prompt-"));
    try {
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      let loaderOptions: Record<string, unknown> | undefined;
      const events: AgentEvent[] = [];
      const session = {
        sessionId: "default-prompt-session",
        sessionFile: join(root, "session.jsonl"),
        subscribe: (): (() => void) => () => undefined,
        prompt: async (): Promise<void> => undefined,
        abort: async (): Promise<void> => undefined,
        dispose: (): void => undefined,
      };
      const sdk: PiModule = {
        ModelRuntime: { create: async () => ({ getModel: () => ({ id: "default-model" }), setRuntimeApiKey: async () => undefined }) },
        SessionManager: { create: () => ({}) },
        SettingsManager: { inMemory: () => ({}) },
        DefaultResourceLoader: class {
          constructor(options: Record<string, unknown>) { loaderOptions = options; }
          reload = async (): Promise<void> => undefined;
        },
        createAgentSession: async () => ({ session }),
      };
      const result = await Effect.runPromiseExit(
        executeAgent({ cwd: root, prompt: "use default prompt", tools: [], onEvent: (event) => events.push(event) }, { sdk, ...TEST_MODEL, ...TEST_RETRY }).pipe(
          Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      expect(Exit.isSuccess(result)).toBe(true);
      expect(loaderOptions).not.toHaveProperty("systemPrompt");
      expect(events.map((event) => event.type)).toEqual(["resource", "resource", "spawn", "context", "done"]);
      expect(events.filter((event) => event.type === "resource")).toEqual([
        { type: "resource", resource: { kind: "system-prompt", status: "requested", source: "sdk-default" } },
        { type: "resource", resource: { kind: "system-prompt", status: "loaded", source: "sdk-default" } },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails instead of fabricating a transcript when the SDK omits its session file", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-missing-transcript-"));
    try {
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      let disposeCalls = 0;
      const session = {
        sessionId: "missing-transcript-session",
        sessionFile: undefined,
        subscribe: (): (() => void) => () => undefined,
        prompt: async (): Promise<void> => undefined,
        abort: async (): Promise<void> => undefined,
        dispose: (): void => { disposeCalls += 1; },
      };
      const sdk: PiModule = {
        ModelRuntime: { create: async () => ({ getModel: () => ({ id: "missing-transcript-model" }), setRuntimeApiKey: async () => undefined }) },
        SessionManager: { create: () => ({}) },
        SettingsManager: { inMemory: () => ({}) },
        DefaultResourceLoader: class { reload = async (): Promise<void> => undefined; },
        createAgentSession: async () => ({ session }),
      };
      const result = await Effect.runPromiseExit(
        executeAgent({ cwd: root, prompt: "missing transcript", tools: [] }, { sdk, ...TEST_MODEL, ...TEST_RETRY }).pipe(
          Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const failure = Cause.failureOption(result.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) {
          expect(failure.value).toBeInstanceOf(AgentError);
          expect(failure.value.kind).toBe("session-artifact");
          expect(failure.value.message).toContain("no persistent transcript file");
        }
      }
      expect(disposeCalls).toBe(1);
      const log = await readFile(join(runSession.runDir, "system-log", "log.jsonl"), "utf8");
      expect(log).toContain('"event":"agent.session.failed"');
      expect(log).toContain('"kind":"session-artifact"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records and returns a typed failure when a context resource cannot load", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-missing-context-"));
    try {
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const events: AgentEvent[] = [];
      const session = {
        sessionId: "missing-context-session",
        sessionFile: join(root, "session.jsonl"),
        subscribe: (): (() => void) => () => undefined,
        prompt: async (): Promise<void> => undefined,
        abort: async (): Promise<void> => undefined,
        dispose: (): void => undefined,
      };
      const sdk: PiModule = {
        ModelRuntime: { create: async () => ({ getModel: () => ({ id: "missing-context-model" }), setRuntimeApiKey: async () => undefined }) },
        SessionManager: { create: () => ({}) },
        SettingsManager: { inMemory: () => ({}) },
        DefaultResourceLoader: class { reload = async (): Promise<void> => undefined; },
        createAgentSession: async () => ({ session }),
      };
      const missingPath = join(root, "missing-context.md");
      const result = await Effect.runPromiseExit(
        executeAgent({
          cwd: root,
          prompt: "missing context",
          contextFilePaths: [missingPath],
          onEvent: (event) => events.push(event),
        }, { sdk, ...TEST_MODEL, ...TEST_RETRY }).pipe(
          Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const failure = Cause.failureOption(result.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) {
          expect(failure.value).toBeInstanceOf(AgentError);
          expect(failure.value.message).toContain(missingPath);
        }
      }
      expect(events.filter((event) => event.type === "resource")).toEqual([
        { type: "resource", resource: { kind: "system-prompt", status: "requested", source: "sdk-default" } },
        { type: "resource", resource: { kind: "context-file", status: "requested", source: "workflow", path: missingPath } },
        expect.objectContaining({
          type: "resource",
          resource: expect.objectContaining({ kind: "context-file", status: "failed", path: missingPath }),
        }),
      ]);
      const log = await readFile(join(runSession.runDir, "system-log", "log.jsonl"), "utf8");
      expect(log).toContain('"event":"agent.resource.failed"');
      expect(log).toContain(missingPath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("disposes the SDK session when event subscription setup fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-subscribe-failure-"));
    try {
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      let disposeCalls = 0;
      let promptCalls = 0;
      const session = {
        sessionId: "subscribe-failure-session",
        sessionFile: join(root, "session.jsonl"),
        subscribe(): () => void {
          throw new Error("event subscription failed");
        },
        prompt: async (): Promise<void> => { promptCalls += 1; },
        abort: async (): Promise<void> => undefined,
        dispose: (): void => { disposeCalls += 1; },
      };
      const sdk: PiModule = {
        ModelRuntime: { create: async () => ({ getModel: () => ({ id: "subscribe-failure-model" }), setRuntimeApiKey: async () => undefined }) },
        // Retries continue the same session, so the fixture must support
        // reopening one like the real SDK does.
        SessionManager: { create: () => ({}), open: () => ({}) },
        SettingsManager: { inMemory: () => ({}) },
        DefaultResourceLoader: class { reload = async (): Promise<void> => undefined; },
        createAgentSession: async () => ({ session }),
      };
      const result = await Effect.runPromiseExit(
        executeAgent({ cwd: root, prompt: "subscription failure", tools: [] }, { sdk, ...TEST_MODEL, ...TEST_RETRY }).pipe(
          Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const failure = Cause.failureOption(result.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) {
          expect(failure.value).toBeInstanceOf(AgentError);
          expect(failure.value.kind).toBe("request-rejected");
          expect(failure.value.message).toBe("event subscription failed");
        }
      }
      expect(promptCalls).toBe(0);
      // The subscription failure is retryable, so the adapter runs three
      // attempts (initial + two retries) before surfacing the error; each
      // attempt disposes its session.
      expect(disposeCalls).toBe(3);
      const log = await readFile(join(runSession.runDir, "system-log", "log.jsonl"), "utf8");
      expect(log).toContain('"event":"agent.session.failed"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("turns a Pi assistant error message into a typed request failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-error-"));
    try {
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const events: AgentEvent[] = [];
      const session = {
        sessionId: "error-session",
        sessionFile: join(root, "session.jsonl"),
        subscribe(listener: (event: unknown) => void): () => void {
          listener({
            type: "message_end",
            message: {
              role: "assistant",
              content: [],
              stopReason: "error",
              errorMessage: "Connection error",
            },
          });
          return () => undefined;
        },
        prompt: async (): Promise<void> => undefined,
        abort: async (): Promise<void> => undefined,
        dispose: (): void => undefined,
      };
      const sdk: PiModule = {
        ModelRuntime: {
          create: async () => ({
            getModel: () => ({ id: "error-model" }),
            setRuntimeApiKey: async () => undefined,
          }),
        },
        // Retries continue the same session, so the fixture must support
        // reopening one like the real SDK does.
        SessionManager: { create: () => ({}), open: () => ({}) },
        SettingsManager: { inMemory: () => ({}) },
        DefaultResourceLoader: class {
          constructor(options: Record<string, unknown>) { void options; }
          reload = async (): Promise<void> => undefined;
        },
        createAgentSession: async () => ({ session }),
      };
      const result = await Effect.runPromiseExit(
        executeAgent({
          cwd: root,
          prompt: "trigger provider error",
          systemPromptPath: join(root, "system-prompt.md"),
          onEvent: (event) => events.push(event),
        }, { sdk, ...TEST_MODEL, ...TEST_RETRY }).pipe(
          Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );

      expect(Exit.isFailure(result)).toBe(true);
      if (!Exit.isFailure(result)) return;
      const failure = Cause.failureOption(result.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value).toBeInstanceOf(AgentError);
        expect(failure.value.kind).toBe("request-rejected");
        expect(failure.value.message).toBe("Connection error");
      }
      // A retryable assistant failure is re-attempted (initial + two
      // retries) before surfacing, so the error event fires once per attempt.
      expect(events.filter((event) => event.type === "error")).toEqual([
        { type: "error", errorType: "request-rejected", message: "Connection error" },
        { type: "error", errorType: "request-rejected", message: "Connection error" },
        { type: "error", errorType: "request-rejected", message: "Connection error" },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies rate-limit and timeout error messages into their kinds", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-kind-"));
    try {
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const cases = [
        { kind: "rate-limit", message: "429 Too Many Requests" },
        { kind: "timeout", message: "request timed out" },
      ];
      for (const { kind, message } of cases) {
        const events: AgentEvent[] = [];
        const session = {
          sessionId: "kind-session",
          sessionFile: join(root, "kind.jsonl"),
          subscribe(listener: (event: unknown) => void): () => void {
            listener({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: message } });
            return () => undefined;
          },
          prompt: async (): Promise<void> => undefined,
          abort: async (): Promise<void> => undefined,
          dispose: (): void => undefined,
        };
        const sdk: PiModule = {
          ModelRuntime: { create: async () => ({ getModel: () => ({ id: "kind-model" }), setRuntimeApiKey: async () => undefined }) },
          // Retries continue the same session, so the fixture must support
          // reopening one like the real SDK does.
          SessionManager: { create: () => ({}), open: () => ({}) },
          SettingsManager: { inMemory: () => ({}) },
          DefaultResourceLoader: class { reload = async (): Promise<void> => undefined; },
          createAgentSession: async () => ({ session }),
        };
        const result = await Effect.runPromiseExit(
          executeAgent({
            cwd: root,
            prompt: "trigger",
            systemPromptPath: join(root, "system-prompt.md"),
            onEvent: (event) => events.push(event),
          }, { sdk, ...TEST_MODEL, ...TEST_RETRY }).pipe(
            Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
            Effect.provide(NodeFileSystem.layer),
          ),
        );
        expect(Exit.isFailure(result)).toBe(true);
        if (!Exit.isFailure(result)) continue;
        const failure = Cause.failureOption(result.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) expect(failure.value.kind).toBe(kind);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails with max-tokens when the turn settles on a truncated final message", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-max-tokens-"));
    try {
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const events: AgentEvent[] = [];
      const session = {
        sessionId: "max-tokens-session",
        sessionFile: join(root, "session.jsonl"),
        subscribe(listener: (event: unknown) => void): () => void {
          listener({ type: "message_end", message: { role: "assistant", content: [], stopReason: "length" } });
          return () => undefined;
        },
        prompt: async (): Promise<void> => undefined,
        abort: async (): Promise<void> => undefined,
        dispose: (): void => undefined,
      };
      const sdk: PiModule = {
        ModelRuntime: { create: async () => ({ getModel: () => ({ id: "max-tokens-model" }), setRuntimeApiKey: async () => undefined }) },
        SessionManager: { create: () => ({}), open: () => ({}) },
        SettingsManager: { inMemory: () => ({}) },
        DefaultResourceLoader: class { reload = async (): Promise<void> => undefined; },
        createAgentSession: async () => ({ session }),
      };
      const result = await Effect.runPromiseExit(
        executeAgent({
          cwd: root,
          prompt: "trigger truncation",
          onEvent: (event) => events.push(event),
        }, { sdk, ...TEST_MODEL, ...TEST_RETRY }).pipe(
          Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const failure = Cause.failureOption(result.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) {
          expect(failure.value).toBeInstanceOf(AgentError);
          expect(failure.value.kind).toBe("max-tokens");
        }
      }
      const truncated = { type: "error", errorType: "max-tokens", message: "assistant output was truncated by the model's output token limit" };
      expect(events.filter((event) => event.type === "error")).toEqual([truncated, truncated, truncated]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("succeeds when an intermediate length message is followed by a natural stop", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-length-then-stop-"));
    try {
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const session = {
        sessionId: "length-then-stop-session",
        sessionFile: join(root, "session.jsonl"),
        subscribe(listener: (event: unknown) => void): () => void {
          listener({ type: "message_end", message: { role: "assistant", content: [], stopReason: "length" } });
          listener({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" } });
          return () => undefined;
        },
        prompt: async (): Promise<void> => undefined,
        abort: async (): Promise<void> => undefined,
        dispose: (): void => undefined,
      };
      const sdk: PiModule = {
        ModelRuntime: { create: async () => ({ getModel: () => ({ id: "length-then-stop-model" }), setRuntimeApiKey: async () => undefined }) },
        SessionManager: { create: () => ({}), open: () => ({}) },
        SettingsManager: { inMemory: () => ({}) },
        DefaultResourceLoader: class { reload = async (): Promise<void> => undefined; },
        createAgentSession: async () => ({ session }),
      };
      const result = await Effect.runPromiseExit(
        executeAgent({
          cwd: root,
          prompt: "continue after a truncated message",
        }, { sdk, ...TEST_MODEL, ...TEST_RETRY }).pipe(
          Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      expect(Exit.isSuccess(result)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("attributes bare HTTP status failures to the endpoint and model and retries them", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-attribution-"));
    const previousConfig = process.env["PIANO_USER_AGENT_CONFIG"];
    process.env["PIANO_USER_AGENT_CONFIG"] = join(root, "agent.config.json");
    try {
      await writeFile(process.env["PIANO_USER_AGENT_CONFIG"], JSON.stringify({ baseUrl: "http://gateway.test" }));
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const events: AgentEvent[] = [];
      // Each attempt subscribes exactly once; the gateway 502s twice, then
      // recovers, exercising attribution and the retry notices end to end.
      let subscriptions = 0;
      const session = {
        sessionId: "attr-session",
        sessionFile: join(root, "attr.jsonl"),
        subscribe(listener: (event: unknown) => void): () => void {
          subscriptions += 1;
          listener(subscriptions < 3
            ? { type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "502 status code (no body)" } }
            : { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });
          return () => undefined;
        },
        prompt: async (): Promise<void> => undefined,
        abort: async (): Promise<void> => undefined,
        dispose: (): void => undefined,
      };
      const sdk: PiModule = {
        ModelRuntime: { create: async () => ({ getModel: () => ({ id: "test-model" }), setRuntimeApiKey: async () => undefined }) },
        SessionManager: { create: () => ({}), open: () => ({}) },
        SettingsManager: { inMemory: () => ({}) },
        DefaultResourceLoader: class { reload = async (): Promise<void> => undefined; },
        createAgentSession: async () => ({ session }),
      };
      const result = await Effect.runPromiseExit(
        executeAgent({
          cwd: root,
          prompt: "trigger",
          systemPromptPath: join(root, "system-prompt.md"),
          onEvent: (event) => events.push(event),
        }, { sdk, ...TEST_MODEL, ...TEST_RETRY }).pipe(
          Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      expect(Exit.isSuccess(result)).toBe(true);
      expect(subscriptions).toBe(3);
      const attributed = "502 status code (no body) [test-provider/test-model via endpoint http://gateway.test/v1]";
      const errorEvents = events.filter((event) => event.type === "error");
      expect(errorEvents).toHaveLength(2);
      for (const errorEvent of errorEvents) {
        if (errorEvent.type !== "error") continue;
        expect(errorEvent.errorType).toBe("harness-unavailable");
        expect(errorEvent.message).toBe(`${attributed}: the endpoint is unavailable; Piano will retry`);
      }
      expect(events.filter((event) => event.type === "retry")).toEqual([
        { type: "retry", event: "scheduled", attempt: 1, nextAttempt: 2, totalAttempts: 3, delayMs: 10, errorType: "harness-unavailable", message: `${attributed}: the endpoint is unavailable; Piano will retry` },
        { type: "retry", event: "scheduled", attempt: 2, nextAttempt: 3, totalAttempts: 3, delayMs: 10, errorType: "harness-unavailable", message: `${attributed}: the endpoint is unavailable; Piano will retry` },
        { type: "retry", event: "recovered", attempt: 3, totalAttempts: 3 },
      ]);
    } finally {
      if (previousConfig === undefined) delete process.env["PIANO_USER_AGENT_CONFIG"];
      else process.env["PIANO_USER_AGENT_CONFIG"] = previousConfig;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails permanently with credential attribution on an authentication status", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-401-"));
    const previousConfig = process.env["PIANO_USER_AGENT_CONFIG"];
    process.env["PIANO_USER_AGENT_CONFIG"] = join(root, "agent.config.json");
    try {
      await writeFile(process.env["PIANO_USER_AGENT_CONFIG"], JSON.stringify({ baseUrl: "http://gateway.test" }));
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      let sessions = 0;
      const session = {
        sessionId: "auth-session",
        sessionFile: join(root, "auth.jsonl"),
        subscribe(listener: (event: unknown) => void): () => void {
          listener({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "401 status code (no body)" } });
          return () => undefined;
        },
        prompt: async (): Promise<void> => undefined,
        abort: async (): Promise<void> => undefined,
        dispose: (): void => undefined,
      };
      const sdk: PiModule = {
        ModelRuntime: { create: async () => ({ getModel: () => ({ id: "test-model" }), setRuntimeApiKey: async () => undefined }) },
        SessionManager: { create: () => ({}), open: () => ({}) },
        SettingsManager: { inMemory: () => ({}) },
        DefaultResourceLoader: class { reload = async (): Promise<void> => undefined; },
        createAgentSession: async () => { sessions += 1; return { session }; },
      };
      const result = await Effect.runPromiseExit(
        executeAgent({
          cwd: root,
          prompt: "trigger",
          systemPromptPath: join(root, "system-prompt.md"),
        }, { sdk, ...TEST_MODEL, ...TEST_RETRY }).pipe(
          Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      expect(Exit.isFailure(result)).toBe(true);
      // Authentication is permanent: the retry boundary must not re-run it.
      expect(sessions).toBe(1);
      if (Exit.isFailure(result)) {
        const failure = Cause.failureOption(result.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) {
          expect(failure.value.kind).toBe("authentication");
          expect(failure.value.message).toBe(
            "401 status code (no body) [test-provider/test-model via endpoint http://gateway.test/v1]: the endpoint rejected the credential",
          );
        }
      }
    } finally {
      if (previousConfig === undefined) delete process.env["PIANO_USER_AGENT_CONFIG"];
      else process.env["PIANO_USER_AGENT_CONFIG"] = previousConfig;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("emits a normalized error event for model resolution failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-model-error-"));
    try {
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const events: AgentEvent[] = [];
      const sdk = sdkLoaderFixture(root, "missing-model");
      sdk.ModelRuntime.create = async () => ({
        getModel: () => undefined,
        setRuntimeApiKey: async () => undefined,
      });
      const result = await Effect.runPromiseExit(
        executeAgent({
          cwd: root,
          prompt: "missing model",
          onEvent: (event) => events.push(event),
        }, { sdk, ...TEST_MODEL, ...TEST_RETRY }).pipe(
          Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      expect(Exit.isFailure(result)).toBe(true);
      expect(events).toContainEqual({
        type: "error",
        errorType: "model-not-found",
        message: "model not found: test-provider/test-model",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("normalizes the complete session event families without dropping unknown events", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-events-"));
    try {
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const events: AgentEvent[] = [];
      const assistantUpdates = [
        { type: "start", partial: { role: "assistant", content: [], usage: { input: 7, output: 8, totalTokens: 15 } } },
        { type: "text_start", contentIndex: 0, partial: { role: "assistant", content: [] } },
        { type: "text_delta", contentIndex: 0, delta: "4", partial: { role: "assistant", content: [] } },
        { type: "text_end", contentIndex: 0, content: "4", partial: { role: "assistant", content: [] } },
        { type: "thinking_start", contentIndex: 1, partial: { role: "assistant", content: [] } },
        { type: "thinking_delta", contentIndex: 1, delta: "check", partial: { role: "assistant", content: [] } },
        { type: "thinking_end", contentIndex: 1, content: "check", partial: { role: "assistant", content: [] } },
        { type: "toolcall_start", contentIndex: 2, partial: { role: "assistant", content: [] } },
        { type: "toolcall_delta", contentIndex: 2, delta: "{}", partial: { role: "assistant", content: [] } },
        { type: "toolcall_end", contentIndex: 2, toolCall: { id: "call-1", name: "read", arguments: "{}" }, partial: { role: "assistant", content: [] } },
      ] as const;
      const sdkEvents = [
        { type: "agent_start" },
        { type: "turn_start" },
        { type: "message_start", message: { role: "assistant", content: [] } },
        ...assistantUpdates.map((assistantMessageEvent) => ({
          type: "message_update",
          message: { role: "assistant", content: [] },
          assistantMessageEvent,
          ...(assistantMessageEvent.type === "text_delta"
            ? { usage: { input: 1, output: 2, totalTokens: 3 } }
            : {}),
        })),
        { type: "tool_execution_start", toolCallId: "call-1", toolName: "read", args: { path: "a" } },
        { type: "tool_execution_update", toolCallId: "call-1", toolName: "read", args: { path: "a" }, partialResult: "..." },
        { type: "tool_execution_end", toolCallId: "call-1", toolName: "read", result: "ok", isError: false },
        {
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "4" }],
            usage: { input: 2, output: 1, cacheWrite1h: 3, reasoning: 4 },
          },
        },
        { type: "turn_end", message: { role: "assistant", content: "4" }, toolResults: [] },
        { type: "queue_update", steering: ["a"], followUp: ["b"] },
        { type: "compaction_start", reason: "threshold" },
        { type: "entry_appended", entry: { id: "entry-1" } },
        { type: "session_info_changed", name: "test" },
        { type: "thinking_level_changed", level: "low" },
        { type: "compaction_end", reason: "threshold", result: { summary: "ok" }, aborted: false, willRetry: false },
        { type: "auto_retry_start", attempt: 1, maxAttempts: 2, delayMs: 10, errorMessage: "busy" },
        { type: "auto_retry_end", success: true, attempt: 1 },
        { type: "summarization_retry_scheduled", attempt: 1, maxAttempts: 2, delayMs: 10, errorMessage: "busy" },
        { type: "summarization_retry_attempt_start", source: "compaction", reason: "threshold" },
        { type: "summarization_retry_finished" },
        { type: "bash_execution_update", id: "bash-1", delta: "done" },
        { type: "future_event", payload: { preserved: true } },
        { type: "agent_end", messages: [], willRetry: false },
        { type: "agent_settled" },
      ];
      const session = {
        sessionId: "events-session",
        sessionFile: join(root, "session.jsonl"),
        subscribe(listener: (event: unknown) => void): () => void {
          sdkEvents.forEach(listener);
          return () => undefined;
        },
        prompt: async (): Promise<void> => undefined,
        abort: async (): Promise<void> => undefined,
        dispose: (): void => undefined,
      };
      const sdk: PiModule = {
        ModelRuntime: {
          create: async () => ({
            getModel: () => ({ id: "events-model" }),
            setRuntimeApiKey: async () => undefined,
          }),
        },
        SessionManager: { create: () => ({}) },
        SettingsManager: { inMemory: () => ({}) },
        DefaultResourceLoader: class {
          constructor(options: Record<string, unknown>) { void options; }
          reload = async (): Promise<void> => undefined;
        },
        createAgentSession: async () => ({ session }),
      };
      const result = await Effect.runPromiseExit(
        executeAgent({
          cwd: root,
          prompt: "event check",
          systemPromptPath: join(root, "system-prompt.md"),
          onEvent: (event) => events.push(event),
        }, { sdk, ...TEST_MODEL, ...TEST_RETRY }).pipe(
          Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      expect(Exit.isSuccess(result)).toBe(true);
      expect(events.map((event) => event.type)).toEqual([
        "resource",
        "resource",
        "spawn",
        "context",
        "agent_start",
        "turn_start",
        "message_start",
        ...assistantUpdates.map(() => "message_update"),
        "tool_execution_start",
        "tool_execution_update",
        "tool_execution_end",
        "message_end",
        "usage",
        "turn_end",
        "queue_update",
        "compaction_start",
        "entry_appended",
        "session_info_changed",
        "thinking_level_changed",
        "compaction_end",
        "auto_retry_start",
        "auto_retry_end",
        "summarization_retry_scheduled",
        "summarization_retry_attempt_start",
        "summarization_retry_finished",
        "bash_execution_update",
        "unknown",
        "agent_end",
        "agent_settled",
        "done",
      ]);
      expect(events.find((event) => event.type === "unknown")).toEqual({
        type: "unknown",
        sourceType: "future_event",
        data: { type: "future_event", payload: { preserved: true } },
      });
      // usage is emitted exactly once, at message_end, carrying the finalized
      // message's cumulative counters — not per token delta (issue 010/011).
      expect(events.filter((event) => event.type === "usage")).toEqual([
        { type: "usage", usage: { input: 2, output: 1, cacheWrite1h: 3, reasoning: 4 } },
      ]);
      const normalizedUpdates = events.filter((event) => event.type === "message_update");
      expect(normalizedUpdates.map((event) => event.type === "message_update" ? event.assistantMessageEvent.type : undefined))
        .toEqual(assistantUpdates.map((event) => event.type));
      expect(normalizedUpdates.find((event) => event.type === "message_update" && event.assistantMessageEvent.type === "thinking_delta"))
        .toMatchObject({ assistantMessageEvent: { delta: "check", contentIndex: 1 } });
      expect(normalizedUpdates.find((event) => event.type === "message_update" && event.assistantMessageEvent.type === "toolcall_end"))
        .toMatchObject({ assistantMessageEvent: { toolCall: { id: "call-1", name: "read" } } });
      const log = await readFile(join(runSession.runDir, "system-log", "log.jsonl"), "utf8");
      expect(log).toContain('"event":"agent.event.received"');
      expect(log).toContain('"eventType":"tool_execution_start"');
      expect(log).toContain('"toolName":"read"');
      expect(log).not.toContain('"eventType":"message_update"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("aborts the active session and returns a typed cancellation", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-cancel-"));
    try {
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const controller = new AbortController();
      const events: AgentEvent[] = [];
      let promptStarted!: () => void;
      let resolvePrompt!: () => void;
      let abortCalls = 0;
      let disposeCalls = 0;
      let unsubscribeCalls = 0;
      const promptReady = new Promise<void>((resolve) => { promptStarted = resolve; });
      const session = {
        sessionId: "cancelled-session",
        sessionFile: join(root, "session.jsonl"),
        subscribe: (): (() => void) => () => { unsubscribeCalls += 1; },
        prompt: async (): Promise<void> => {
          promptStarted();
          await new Promise<void>((resolve) => { resolvePrompt = resolve; });
        },
        abort: async (): Promise<void> => {
          abortCalls += 1;
          resolvePrompt?.();
        },
        dispose: (): void => { disposeCalls += 1; },
      };
      const sdk: PiModule = {
        ModelRuntime: {
          create: async () => ({
            getModel: () => ({ id: "cancel-model" }),
            setRuntimeApiKey: async () => undefined,
          }),
        },
        SessionManager: { create: () => ({}) },
        SettingsManager: { inMemory: () => ({}) },
        DefaultResourceLoader: class {
          constructor(options: Record<string, unknown>) { void options; }
          reload = async (): Promise<void> => undefined;
        },
        createAgentSession: async () => ({ session }),
      };
      const resultPromise = Effect.runPromiseExit(
        executeAgent({
          cwd: root,
          prompt: "interrupt this task",
          systemPromptPath: join(root, "system-prompt.md"),
          signal: controller.signal,
          onEvent: (event) => events.push(event),
        }, { sdk, ...TEST_MODEL, ...TEST_RETRY }).pipe(
          Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );

      await promptReady;
      controller.abort();
      const result = await resultPromise;

      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const failure = Cause.failureOption(result.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) {
          expect(failure.value).toBeInstanceOf(AgentError);
          expect(failure.value.kind).toBe("cancelled");
        }
      }
      expect(abortCalls).toBe(1);
      expect(unsubscribeCalls).toBe(1);
      expect(disposeCalls).toBe(1);
      expect(events).toContainEqual({
        type: "error",
        errorType: "cancelled",
        message: "pi request cancelled",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// Tier: API. The pi harness's dedicated steering implementation: it binds the
// live SDK session's `steer` to the channel while a turn runs, and unbinds
// with the session. An SDK that lacks `steer` never binds — the channel then
// answers "no-active-turn", which is the capability the TUI consumes.
describe(" pi sdk steering", () => {
  /** Fake pi session whose `prompt` gates until the test releases it, so the
   * steering attempts happen strictly inside the live turn. */
  function gatedPiSdk(root: string, id: string, withSteer: boolean) {
    const steered: string[] = [];
    let unblockPrompt: () => void = () => undefined;
    let markStarted: () => void = () => undefined;
    const promptStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const turnOpen = new Promise<void>((resolve) => {
      unblockPrompt = resolve;
    });
    const session = {
      sessionId: `${id}-session`,
      sessionFile: join(root, `${id}.jsonl`),
      subscribe: (): (() => void) => () => undefined,
      prompt: async (): Promise<void> => {
        markStarted();
        await turnOpen;
      },
      ...(withSteer
        ? {
          steer: async (text: string): Promise<void> => {
            steered.push(text);
          },
        }
        : {}),
      abort: async (): Promise<void> => {
        unblockPrompt();
      },
      dispose: (): void => undefined,
    };
    const sdk: PiModule = {
      ModelRuntime: {
        create: async () => ({
          getModel: () => ({ id: `${id}-model` }),
          setRuntimeApiKey: async () => undefined,
        }),
      },
      SessionManager: { create: () => ({}) },
      SettingsManager: { inMemory: () => ({}) },
      DefaultResourceLoader: class { reload = async (): Promise<void> => undefined; },
      createAgentSession: async () => ({ session }),
    };
    return { sdk, steered, promptStarted, closeTurn: () => unblockPrompt() };
  }

  async function runSteeringCase(
    id: string,
    withSteer: boolean,
    assertDuringTurn: (channel: ReturnType<typeof createSteeringChannel>, steered: string[]) => Promise<void>,
  ): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), `piano-pi-steer-${id}-`));
    try {
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const fake = gatedPiSdk(root, id, withSteer);
      const channel = createSteeringChannel();
      const run = executeAgent({
        cwd: root,
        prompt: "hold the turn open",
        tools: [],
        sessionDir: join(root, "sessions"),
        steering: channel,
      }, { sdk: fake.sdk, ...TEST_MODEL, ...TEST_RETRY }).pipe(
        Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
        Effect.provide(NodeFileSystem.layer),
      );
      const running = Effect.runPromise(run);
      await fake.promptStarted;
      await assertDuringTurn(channel, fake.steered);
      fake.closeTurn();
      await running;
      return "settled";
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  it("delivers mid-turn text into the live pi session's steer", async () => {
    const outcome = await runSteeringCase("deliver", true, async (channel, steered) => {
      expect(await Effect.runPromise(channel.steer("focus on the test file first"))).toBe("delivered");
      expect(steered).toEqual(["focus on the test file first"]);
    });
    expect(outcome).toBe("settled");
  });

  it("answers no-active-turn while the session is live but the SDK cannot steer", async () => {
    const outcome = await runSteeringCase("unsupported", false, async (channel, steered) => {
      expect(await Effect.runPromise(channel.steer("ignored"))).toBe("no-active-turn");
      expect(steered).toEqual([]);
    });
    expect(outcome).toBe("settled");
  });

  it("unbinds when the turn completes, so later text is no longer delivered", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-pi-steer-after-"));
    try {
      const runSession = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const fake = gatedPiSdk(root, "after", true);
      const channel = createSteeringChannel();
      const run = executeAgent({
        cwd: root,
        prompt: "hold then finish",
        tools: [],
        sessionDir: join(root, "sessions"),
        steering: channel,
      }, { sdk: fake.sdk, ...TEST_MODEL, ...TEST_RETRY }).pipe(
        Effect.provideService(Logging, loggingService(runSession.log, runSession.trace)),
        Effect.provide(NodeFileSystem.layer),
      );
      const running = Effect.runPromise(run);
      await fake.promptStarted;
      fake.closeTurn();
      await running;
      // The completion cleanup unbound the session; steering must not find it.
      expect(await Effect.runPromise(channel.steer("too late"))).toBe("no-active-turn");
      expect(fake.steered).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
