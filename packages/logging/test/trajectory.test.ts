import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseTrajectory, TrajectoryWriter } from "../src/trajectory.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("TrajectoryWriter", () => {
  it("persists a bounded, metrics-compatible trajectory for complex SDK events", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "runs", "run-1", "trajectory.jsonl");
    const writer = new TrajectoryWriter("run-1", path);
    const circular: Record<string, unknown> = { count: 1n };
    circular.self = circular;

    await Effect.runPromise(writer.write({
      status: "completed",
      promptLength: 4,
      events: [
        { type: "spawn", harness: "pi", model: "model", skills: [] },
        { type: "message_update", message: { role: "assistant", content: "noise" } },
        { type: "message_end", message: { role: "assistant", content: "done" } },
        { type: "turn_end", message: { role: "assistant" }, toolResults: [] },
        { type: "usage", usage: { input: 3, output: 2, totalTokens: 5 } },
        { type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: circular },
        { type: "tool_execution_end", toolCallId: "call-1", toolName: "bash", result: circular, isError: false },
      ],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events.map((event) => event.type)).toEqual([
      "spawn",
      "message_end",
      "turn_end",
      "usage",
      "tool_execution_start",
      "tool_execution_end",
    ]);
    expect(document.events[4]?.args).toMatchObject({ count: "1n", self: "[Circular]" });
    expect(document.events[5]?.result).toMatchObject({ count: "1n", self: "[Circular]" });
  });

  it("persists message events when a provider getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const message: Record<string, unknown> = { role: "assistant" };
    Object.defineProperty(message, "content", {
      enumerable: true,
      get: () => {
        throw new Error("provider content unavailable");
      },
    });

    await Effect.runPromise(new TrajectoryWriter("run-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [{ type: "message_end", message }],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events[0]).toMatchObject({
      type: "message_end",
      message: { role: "assistant", content: "[Value unavailable]" },
    });
  });

  it("persists a lifecycle event when its provider keys cannot be enumerated", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const event = new Proxy<Record<string, unknown>>({ type: "spawn", extra: "ok" }, {
      ownKeys: () => { throw new Error("event keys unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-proxy", path).write({
      status: "completed",
      promptLength: 1,
      events: [event],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{ type: "spawn" }]);
  });

  it("persists a bounded placeholder when an event type getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const event: Record<string, unknown> = {};
    Object.defineProperty(event, "type", {
      enumerable: true,
      get: () => { throw new Error("event type unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-type-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [event],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{ type: "[Value unavailable]" }]);
  });

  it("persists a bounded placeholder when an event proxy is revoked", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const event = Proxy.revocable({ type: "spawn" }, {});
    event.revoke();

    await Effect.runPromise(new TrajectoryWriter("run-revoked-event", path).write({
      status: "completed",
      promptLength: 1,
      events: [event.proxy],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: unknown[];
    };
    expect(document.events).toEqual(["[Array unavailable]"]);
  });

  it("keeps readable extras when a workflow getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const event: Record<string, unknown> = { type: "spawn", extra: "ok" };
    Object.defineProperty(event, "workflow", {
      enumerable: true,
      get: () => { throw new Error("workflow unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-workflow-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [event],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{ type: "spawn", extra: "ok" }]);
  });

  it("keeps context metadata when the system prompt path getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const context: Record<string, unknown> = {
      contextFilePaths: ["/context.md"],
      skills: ["skill"],
    };
    Object.defineProperty(context, "systemPromptPath", {
      enumerable: true,
      get: () => { throw new Error("system prompt path unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-context-system-prompt-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [{ type: "context", context }],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{
      type: "context",
      context: {
        contextFilePaths: ["/context.md"],
        skills: ["skill"],
      },
    }]);
  });

  it("keeps context metadata when the user message getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const context: Record<string, unknown> = {
      contextFilePaths: ["/context.md"],
      skills: ["skill"],
      systemPromptPath: "/system.md",
    };
    Object.defineProperty(context, "userMessage", {
      enumerable: true,
      get: () => { throw new Error("user message unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-context-user-message-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [{ type: "context", context }],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{
      type: "context",
      context: {
        contextFilePaths: ["/context.md"],
        skills: ["skill"],
        systemPromptPath: "/system.md",
      },
    }]);
  });

  it("keeps context metadata when the context-file paths getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const context: Record<string, unknown> = {
      skills: ["skill"],
      systemPromptPath: "/system.md",
      userMessage: "prompt",
    };
    Object.defineProperty(context, "contextFilePaths", {
      enumerable: true,
      get: () => { throw new Error("context-file paths unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-context-file-paths-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [{ type: "context", context }],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{
      type: "context",
      context: {
        skills: ["skill"],
        systemPromptPath: "/system.md",
        userMessage: "prompt",
      },
    }]);
  });

  it("keeps context metadata when context-file paths cannot be compacted", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const context: Record<string, unknown> = {
      skills: ["skill"],
      systemPromptPath: "/system.md",
      userMessage: "prompt",
    };
    const contextFilePaths = new Proxy(["/context.md"], {
      get: (target, property, receiver) => {
        if (property === "slice") throw new Error("context-file paths cannot be sliced");
        return Reflect.get(target, property, receiver);
      },
    });
    Object.defineProperty(context, "contextFilePaths", {
      enumerable: true,
      get: () => contextFilePaths,
    });

    await Effect.runPromise(new TrajectoryWriter("run-context-file-paths-array", path).write({
      status: "completed",
      promptLength: 1,
      events: [{ type: "context", context }],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{
      type: "context",
      context: {
        contextFilePaths: "[Array unavailable]",
        skills: ["skill"],
        systemPromptPath: "/system.md",
        userMessage: "prompt",
      },
    }]);
  });

  it("keeps context metadata when the skills getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const context: Record<string, unknown> = {
      contextFilePaths: ["/context.md"],
      systemPromptPath: "/system.md",
      userMessage: "prompt",
    };
    Object.defineProperty(context, "skills", {
      enumerable: true,
      get: () => { throw new Error("skills unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-context-skills-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [{ type: "context", context }],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{
      type: "context",
      context: {
        contextFilePaths: ["/context.md"],
        systemPromptPath: "/system.md",
        userMessage: "prompt",
      },
    }]);
  });

  it("persists an empty context when the context getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const event: Record<string, unknown> = { type: "context" };
    Object.defineProperty(event, "context", {
      enumerable: true,
      get: () => { throw new Error("context unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-context-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [event],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{
      type: "context",
      context: {},
    }]);
  });

  it("persists empty usage when the usage getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const event: Record<string, unknown> = { type: "usage" };
    Object.defineProperty(event, "usage", {
      enumerable: true,
      get: () => { throw new Error("usage unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-usage-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [event],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{
      type: "usage",
      usage: {},
    }]);
  });

  it("persists empty agent messages when the messages getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const event: Record<string, unknown> = { type: "agent_end" };
    Object.defineProperty(event, "messages", {
      enumerable: true,
      get: () => { throw new Error("messages unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-agent-messages-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [event],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{
      type: "agent_end",
      messages: [],
      willRetry: false,
    }]);
  });

  it("persists empty agent messages when the message array cannot be compacted", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const event: Record<string, unknown> = { type: "agent_end", willRetry: true };
    const messages = new Proxy([{ role: "assistant" }], {
      get: (target, property, receiver) => {
        if (property === "slice") throw new Error("agent messages cannot be sliced");
        return Reflect.get(target, property, receiver);
      },
    });
    Object.defineProperty(event, "messages", {
      enumerable: true,
      get: () => messages,
    });

    await Effect.runPromise(new TrajectoryWriter("run-agent-message-array", path).write({
      status: "completed",
      promptLength: 1,
      events: [event],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{
      type: "agent_end",
      messages: [],
      willRetry: true,
    }]);
  });

  it("keeps agent messages when the will-retry getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const event: Record<string, unknown> = {
      type: "agent_end",
      messages: [{ role: "assistant" }],
    };
    Object.defineProperty(event, "willRetry", {
      enumerable: true,
      get: () => { throw new Error("will-retry unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-agent-will-retry-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [event],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{
      type: "agent_end",
      messages: [{ role: "assistant" }],
      willRetry: false,
    }]);
  });

  it("keeps message-end extras when the message getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const event: Record<string, unknown> = { type: "message_end", extra: "ok" };
    Object.defineProperty(event, "message", {
      enumerable: true,
      get: () => { throw new Error("message unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-message-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [event],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{
      type: "message_end",
      extra: "ok",
      message: "[Value unavailable]",
    }]);
  });

  it("keeps turn-end tool results when the message getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const event: Record<string, unknown> = { type: "turn_end", toolResults: [] };
    Object.defineProperty(event, "message", {
      enumerable: true,
      get: () => { throw new Error("turn message unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-turn-message-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [event],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{
      type: "turn_end",
      message: "[Value unavailable]",
      toolResults: [],
    }]);
  });

  it("keeps turn-end records when the tool-results getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const event: Record<string, unknown> = { type: "turn_end", message: {} };
    Object.defineProperty(event, "toolResults", {
      enumerable: true,
      get: () => { throw new Error("tool results unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-tool-results-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [event],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{
      type: "turn_end",
      message: {},
      toolResults: [],
    }]);
  });

  it("keeps tool-start metadata when the args getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const event: Record<string, unknown> = {
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "bash",
    };
    Object.defineProperty(event, "args", {
      enumerable: true,
      get: () => { throw new Error("tool args unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-tool-args-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [event],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "bash",
      args: "[Value unavailable]",
    }]);
  });

  it("keeps tool-start metadata when the call-id getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const event: Record<string, unknown> = {
      type: "tool_execution_start",
      toolName: "bash",
      args: { path: "file.txt" },
    };
    Object.defineProperty(event, "toolCallId", {
      enumerable: true,
      get: () => { throw new Error("tool call id unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-tool-id-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [event],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{
      type: "tool_execution_start",
      toolCallId: "unknown",
      toolName: "bash",
      args: { path: "file.txt" },
    }]);
  });

  it("keeps tool-start metadata when the tool-name getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const event: Record<string, unknown> = {
      type: "tool_execution_start",
      toolCallId: "call-1",
      args: { path: "file.txt" },
    };
    Object.defineProperty(event, "toolName", {
      enumerable: true,
      get: () => { throw new Error("tool name unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-tool-name-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [event],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "unknown",
      args: { path: "file.txt" },
    }]);
  });

  it("keeps tool-end metadata when the result getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const event: Record<string, unknown> = {
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "bash",
      isError: true,
    };
    Object.defineProperty(event, "result", {
      enumerable: true,
      get: () => { throw new Error("tool result unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-tool-result-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [event],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "bash",
      result: "[Value unavailable]",
      isError: true,
    }]);
  });

  it("keeps tool-end records when the call-id getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const event: Record<string, unknown> = {
      type: "tool_execution_end",
      toolName: "bash",
      result: "ok",
      isError: false,
    };
    Object.defineProperty(event, "toolCallId", {
      enumerable: true,
      get: () => { throw new Error("tool end call id unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-tool-end-id-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [event],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{
      type: "tool_execution_end",
      toolCallId: "unknown",
      toolName: "bash",
      result: "ok",
      isError: false,
    }]);
  });

  it("keeps tool-end records when the tool-name getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const event: Record<string, unknown> = {
      type: "tool_execution_end",
      toolCallId: "call-1",
      result: "ok",
      isError: false,
    };
    Object.defineProperty(event, "toolName", {
      enumerable: true,
      get: () => { throw new Error("tool end name unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-tool-end-name-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [event],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "unknown",
      result: "ok",
      isError: false,
    }]);
  });

  it("keeps tool-end records when the error flag getter throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const path = join(root, "trajectory.jsonl");
    const event: Record<string, unknown> = {
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "bash",
      result: "ok",
    };
    Object.defineProperty(event, "isError", {
      enumerable: true,
      get: () => { throw new Error("tool error flag unavailable"); },
    });

    await Effect.runPromise(new TrajectoryWriter("run-tool-error-flag-getter", path).write({
      status: "completed",
      promptLength: 1,
      events: [event],
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const document = parseTrajectory(await readFile(path, "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toEqual([{
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "bash",
      result: "ok",
      isError: false,
    }]);
  });

  it("appends compact events across stage completions", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const writer = new TrajectoryWriter("run-2", join(root, "trajectory.jsonl"));

    const write = (events: readonly unknown[]) => writer.write({
      status: "completed",
      promptLength: 1,
      events,
    }).pipe(Effect.provide(NodeFileSystem.layer));
    await Effect.runPromise(write([{ type: "message_end", message: { role: "assistant", content: "one" } }]));
    await Effect.runPromise(write([{ type: "usage", usage: { totalTokens: 7 } }]));

    const document = parseTrajectory(await readFile(join(root, "trajectory.jsonl"), "utf8")) as unknown as {
      events: Array<Record<string, unknown>>;
    };
    expect(document.events).toHaveLength(2);
    expect(document.events[0]?.type).toBe("message_end");
    expect(document.events[1]?.type).toBe("usage");
  });

  it("retains one latest cumulative usage snapshot per workflow invocation", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(root);
    const writer = new TrajectoryWriter("run-3", join(root, "trajectory.jsonl"));
    const usage = (totalTokens: number) => ({
      type: "usage",
      workflow: { invocationId: "stage@root" },
      usage: { totalTokens },
    });

    const write = (events: readonly unknown[]) => writer.write({
      status: "completed",
      promptLength: 1,
      events,
    }).pipe(Effect.provide(NodeFileSystem.layer));
    await Effect.runPromise(write([usage(1), usage(2)]));
    await Effect.runPromise(write([usage(3)]));

    const document = parseTrajectory(await readFile(join(root, "trajectory.jsonl"), "utf8")) as unknown as {
      events: Array<{ type?: string; usage?: { totalTokens?: number } }>;
    };
    expect(document.events.filter((event) => event.type === "usage")).toHaveLength(1);
    expect(document.events.find((event) => event.type === "usage")?.usage?.totalTokens).toBe(3);
  });
});
