import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import { Container } from "@earendil-works/pi-tui";
import {
  createSteeringChannel,
  dshModelPatchPath,
  dshWebSearchOffPatchPath,
  executeSubprocessAgent,
  normalizeSubprocessLine,
  piWebSearchExtensionPath,
  textDelta,
  type AgentEvent,
  type SubprocessAccumulator,
} from "../../packages/harness/src/index.js";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";
import { TranscriptView } from "../../packages/cli/src/chat-render.js";
import { TrajectoryPanel } from "../../packages/cli/src/trajectory-panel.js";
import { darkTheme } from "../../packages/cli/src/theme.js";

async function fakeHarness(root: string): Promise<string> {
  const path = join(root, "fake-harness.sh");
  await writeFile(path, `#!/bin/sh
case "$PIANO_FAKE_MODE" in
  abort)
    sleep 10
    ;;
  abort-holder)
    # The wedged-pipe hazard: stdout's write end is handed to a detached
    # grandchild that survives the group kill, so a close-only settlement
    # would wait on a pipe that never EOFs. The holder announces its pid
    # first, so the test aborts only once the wedge is real.
    setsid sh -c 'echo $$ > "$PIANO_FAKE_HOLD_FILE"; exec sleep 60' &
    sleep 10
    ;;
  invalid-json)
    printf '%s\\n' 'not-json'
    printf '%s\\n' '{"type":"result","result":"recovered","session_id":"invalid-session"}'
    ;;
  failure)
    printf '%s\\n' 'fake stderr failure' >&2
    printf '%s\\n' '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"partial"}}'
    exit 3
    ;;
  args)
    printf '%s\\n' "$@" > "$PIANO_FAKE_ARGS_FILE"
    printf '%s\\n' '{"type":"result","result":"hello","session_id":"args-session"}'
    ;;
  dsh-plain)
    printf '%s\\n' 'PIANO_DSH_NATIVE_OUTPUT'
    ;;
  dsh-evidence)
    mkdir -p "$(dirname "$PIANO_DSH_SESSION_FILE")"
    printf '%s\\n' "$PIANO_DSH_SESSION_CONTENT" > "$PIANO_DSH_SESSION_FILE"
    printf '%s\\n' 'PIANO_DSH_NATIVE_FINAL'
    ;;
  dsh-stream)
    mkdir -p "$(dirname "$PIANO_DSH_SESSION_FILE")"
    printf '%s\\n' "$PIANO_DSH_STREAM_HEADER" > "$PIANO_DSH_SESSION_FILE"
    sleep 0.15
    printf '%s\\n' "$PIANO_DSH_STREAM_TURN" >> "$PIANO_DSH_SESSION_FILE"
    sleep 0.15
    # This is dsh's default packed storage row: the tailer must expand it into
    # three assistant/chunk text deltas before the process publishes its final
    # stdout answer.
    printf '%s\\n' "$PIANO_DSH_STREAM_ROW" >> "$PIANO_DSH_SESSION_FILE"
    sleep 0.2
    printf '%s\\n' "$PIANO_DSH_STREAM_ASSISTANT" >> "$PIANO_DSH_SESSION_FILE"
    printf '%s\\n' "$PIANO_DSH_STREAM_END" >> "$PIANO_DSH_SESSION_FILE"
    printf '%s\\n' 'one two three'
    ;;
  dsh-zstd-stream)
    # Mirror dsh-session-persistence-jsonl's default physical layout: one
    # independently decodable zstd frame per header/event batch.
    node --input-type=module -e '
      import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
      import { dirname } from "node:path";
      import { zstdCompressSync } from "node:zlib";
      const file = process.env.PIANO_DSH_SESSION_FILE;
      mkdirSync(dirname(file), { recursive: true });
      const append = (value, first = false) => {
        const bytes = zstdCompressSync(value + "\\n");
        if (first) writeFileSync(file, bytes); else appendFileSync(file, bytes);
      };
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      append(process.env.PIANO_DSH_STREAM_HEADER, true);
      await pause(150);
      append(process.env.PIANO_DSH_STREAM_TURN);
      await pause(150);
      append(process.env.PIANO_DSH_STREAM_ROW);
      await pause(200);
      append(process.env.PIANO_DSH_STREAM_ASSISTANT);
      append(process.env.PIANO_DSH_STREAM_END);
      process.stdout.write("one two three\\n");
    '
    ;;
  env)
    printf '%s\\n' '{"type":"result","result":"'"$ANTHROPIC_API_KEY|$ANTHROPIC_BASE_URL"'"}'
    ;;
  claude-steer)
    # Streaming-input fake: read the task frame, emit half a turn, then block
    # on the NEXT stdin line — which only the steering write can provide. It
    # logs every frame it took so the test can prove the bytes arrived.
    IFS= read -r task_frame
    printf '%s\\n' "$task_frame" >> "$PIANO_FAKE_STDIN_LOG"
    printf '%s\\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"half "}]},"session_id":"claude-steer-session"}'
    IFS= read -r steer_frame
    printf '%s\\n' "$steer_frame" >> "$PIANO_FAKE_STDIN_LOG"
    printf '%s\\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"steered"}]},"session_id":"claude-steer-session"}'
    printf '%s\\n' '{"type":"result","result":"half steered","session_id":"claude-steer-session"}'
    ;;
  claude-no-stdin)
    # A streaming-input child that exits without ever reading stdin: writes
    # must fail closed, and the channel must not report a live turn.
    printf '%s\\n' '{"type":"result","result":"gone","session_id":"claude-no-stdin-session"}'
    ;;
  *)
    printf '%s\\n' '{"type":"agent_start"}'
    printf '%s' '{"type":"message_update","message":{"role":"assistant","content":""},"assistantMessageEvent":{"type":"text_delta","delta":"hel'
    sleep 0.01
    printf '%s\\n' '"}}'
    printf '%s\\n' '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}'
    printf '%s\\n' '{"type":"tool_execution_start","toolCallId":"tool-1","toolName":"bash","args":{"command":"echo ok"}}'
    printf '%s\\n' '{"type":"tool_execution_update","toolCallId":"tool-1","toolName":"bash","args":{},"partialResult":"ok"}'
    printf '%s\\n' '{"type":"tool_execution_end","toolCallId":"tool-1","toolName":"bash","result":"ok","isError":false}'
    printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","content":"hello","usage":{"input_tokens":2,"output_tokens":3}}}'
    printf '%s' '{"type":"result","result":"hello","session_id":"fake-session","usage":{"total_tokens":5}}'
    printf '%s\\n' 'fake diagnostic' >&2
    ;;
esac
`);
  await chmod(path, 0o755);
  return path;
}

async function testSession(root: string) {
  return Effect.runPromise(createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)));
}

async function dshHomeFixture(root: string, model?: string): Promise<string> {
  const dshHome = join(root, "dsh-home");
  await mkdir(join(dshHome, "patches"), { recursive: true });
  await writeFile(dshWebSearchOffPatchPath(dshHome), "- id: tool-web\n", "utf8");
  if (model !== undefined) {
    await writeFile(dshModelPatchPath(dshHome, model), "- id: agent-default-model\n", "utf8");
  }
  return dshHome;
}

/** `printf '%s\n' "$@"` writes one line per argument, but a multi-line
 * argument keeps its embedded newlines — the appendix body is verified across
 * lines rather than within one captured line. */
function argvIndex(lines: readonly string[], flag: string): number {
  return lines.indexOf(flag);
}

function runSubprocess(
  session: Awaited<ReturnType<typeof testSession>>,
  root: string,
  binPath: string,
  mode: string,
  signal?: AbortSignal,
) {
  return Effect.runPromiseExit(executeSubprocessAgent("pi", {
    cwd: root,
    prompt: "hello",
    sessionDir: join(session.runDir, "subprocess-sessions"),
    signal,
  }, {
    binPath,
    env: { PIANO_FAKE_MODE: mode },
    // Default backoff (5s/20s) would dominate these harness-mapping tests;
    // retry behavior itself is covered by the dedicated retry tests.
    retryDelaysMs: [10, 10],
  }).pipe(
    Effect.provideService(Logging, loggingService(session.log, session.trace)),
    Effect.provide(NodeFileSystem.layer),
  ));
}

describe(" subprocess harness", () => {
  it("parses chunk-split and trailing NDJSON, normalizes tools, and persists transcript/observability", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-test-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const exit = await runSubprocess(session, root, binPath, "success");
      expect(Exit.isSuccess(exit)).toBe(true);
      if (!Exit.isSuccess(exit)) return;
      expect(exit.value).toMatchObject({ sessionId: "fake-session", text: "hello" });
      const transcript = await readFile(exit.value.transcriptPath, "utf8");
      expect(transcript).toContain('"type":"agent_start"');
      expect(transcript.trimEnd().endsWith('"session_id":"fake-session","usage":{"total_tokens":5}}')).toBe(true);
      const log = await readFile(session.log.path, "utf8");
      expect(log).toContain('"event":"agent.event.received"');
      expect(log).toContain('"eventType":"tool_execution_start"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("delivers normalized subprocess events to the chat and trajectory views", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-ui-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const chat = new Container();
      const transcript = new TranscriptView(chat, darkTheme);
      const trajectory = new TrajectoryPanel(darkTheme);
      trajectory.start("hello");
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("pi", {
        cwd: root,
        prompt: "hello",
        sessionDir: join(session.runDir, "subprocess-sessions"),
        onEvent: (event) => {
          transcript.renderEvent(event);
          trajectory.record(event);
        },
      }, {
        binPath,
        env: { PIANO_FAKE_MODE: "success" },
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(chat.render(80).join("\n")).toContain("hello");
      const ledger = trajectory.render(80).join("\n");
      expect(ledger).toContain("bash:");
      expect(ledger).toContain("agent:");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps invalid JSON and stderr visible while accepting a later valid frame", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-invalid-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const exit = await runSubprocess(session, root, binPath, "invalid-json");
      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) expect(exit.value.text).toBe("recovered");
      const log = await readFile(session.log.path, "utf8");
      expect(log).toContain('"sourceType":"invalid-json"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves valid non-object frames as unknown evidence", () => {
    for (const payload of [null, 7, "text", ["frame"]] as const) {
      const events: AgentEvent[] = [];
      normalizeSubprocessLine(JSON.stringify(payload), "pi", (event) => events.push(event), { text: "" });
      expect(events).toEqual([{
        type: "unknown",
        sourceType: "invalid-record",
        data: payload,
      }]);
    }

    const objectEvents: AgentEvent[] = [];
    const objectPayload = { future: true };
    normalizeSubprocessLine(JSON.stringify(objectPayload), "pi", (event) => objectEvents.push(event), { text: "" });
    expect(objectEvents).toEqual([{
      type: "unknown",
      sourceType: "pi:unknown",
      data: objectPayload,
    }]);
  });

  it("maps non-zero exit, spawn failure, and abort to typed harness errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-errors-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const failed = await runSubprocess(session, root, binPath, "failure");
      expect(Exit.isFailure(failed)).toBe(true);
      if (Exit.isFailure(failed)) {
        const error = Cause.failureOption(failed.cause);
        expect(Option.isSome(error)).toBe(true);
        if (Option.isSome(error)) expect(error.value).toMatchObject({ kind: "request-rejected" });
      }

      const missing = await runSubprocess(session, root, join(root, "missing-harness"), "success");
      expect(Exit.isFailure(missing)).toBe(true);
      if (Exit.isFailure(missing)) {
        const error = Cause.failureOption(missing.cause);
        expect(Option.isSome(error)).toBe(true);
        if (Option.isSome(error)) expect(error.value).toMatchObject({ kind: "harness-unavailable" });
      }

      const controller = new AbortController();
      const pending = runSubprocess(session, root, binPath, "abort", controller.signal);
      setTimeout(() => controller.abort(), 30);
      const aborted = await pending;
      expect(Exit.isFailure(aborted)).toBe(true);
      if (Exit.isFailure(aborted)) {
        const error = Cause.failureOption(aborted.cause);
        expect(Option.isSome(error)).toBe(true);
        if (Option.isSome(error)) expect(error.value).toMatchObject({ kind: "cancelled" });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // API tier of the hung-worker exit guarantee (process tier:
  // tests/tui/exit-arcs.pty.test.ts). Aborting a run whose killed harness left
  // an orphan holding the stdout pipe open must still settle: a pipe that can
  // never EOF may not strand the outcome promise or keep Node's event loop
  // alive past the user's exit.
  it("settles an aborted run while an orphaned holder keeps the stdout pipe open", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-abort-holder-"));
    let holderPid = 0;
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const holdFile = join(root, "holder.pid");
      const controller = new AbortController();
      const pending = Effect.runPromiseExit(executeSubprocessAgent("pi", {
        cwd: root,
        prompt: "hello",
        sessionDir: join(session.runDir, "subprocess-sessions"),
        signal: controller.signal,
      }, {
        binPath,
        env: { PIANO_FAKE_MODE: "abort-holder", PIANO_FAKE_HOLD_FILE: holdFile },
        retryDelaysMs: [10, 10],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      const startedAt = Date.now();
      for (;;) {
        try {
          holderPid = Number((await readFile(holdFile, "utf8")).trim());
          break;
        } catch {
          if (Date.now() - startedAt > 5000) throw new Error("the detached stdout holder never announced itself");
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      controller.abort();
      const aborted = await pending;
      expect(Exit.isFailure(aborted)).toBe(true);
      if (Exit.isFailure(aborted)) {
        const error = Cause.failureOption(aborted.cause);
        expect(Option.isSome(error)).toBe(true);
        if (Option.isSome(error)) expect(error.value).toMatchObject({ kind: "cancelled" });
      }
      // The settle happened with the wedge still live: the holder keeps the
      // pipe's write end, so `close` could not have arrived on its own.
      expect(() => process.kill(holderPid, 0)).not.toThrow();
    } finally {
      if (holderPid > 0) {
        try {
          process.kill(holderPid, "SIGKILL");
        } catch {
          // Already reaped.
        }
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("identifies a missing context file after the system prompt loads", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-context-resource-"));
    try {
      const session = await testSession(root);
      const systemPromptPath = join(root, "system-prompt.md");
      const missingContextPath = join(root, "missing-context.md");
      await writeFile(systemPromptPath, "system\n");
      const events: AgentEvent[] = [];
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("pi", {
        cwd: root,
        prompt: "hello",
        systemPromptPath,
        contextFilePaths: [missingContextPath],
        onEvent: (event) => events.push(event),
      }, { binPath: join(root, "unused-harness"), retryDelaysMs: [10, 10] }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));

      expect(Exit.isFailure(exit)).toBe(true);
      expect(events.find((event) => event.type === "resource" && event.resource.status === "failed")).toMatchObject({
        resource: { kind: "context-file", status: "failed", path: missingContextPath },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("identifies a missing skill after earlier resources load", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-skill-resource-"));
    try {
      const session = await testSession(root);
      const systemPromptPath = join(root, "system-prompt.md");
      const contextPath = join(root, "agents.md");
      const missingSkillPath = join(root, "skills", "missing");
      await writeFile(systemPromptPath, "system\n");
      await writeFile(contextPath, "context\n");
      const events: AgentEvent[] = [];
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("pi", {
        cwd: root,
        prompt: "hello",
        systemPromptPath,
        contextFilePaths: [contextPath],
        skillPaths: [missingSkillPath],
        onEvent: (event) => events.push(event),
      }, { binPath: join(root, "unused-harness"), retryDelaysMs: [10, 10] }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));

      expect(Exit.isFailure(exit)).toBe(true);
      expect(events.find((event) => event.type === "resource" && event.resource.status === "failed")).toMatchObject({
        resource: { kind: "skill", status: "failed", path: missingSkillPath },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("inlines the system prompt and context files into the pi subprocess argv", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-args-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const systemPromptPath = join(root, "system-prompt.md");
      const agentsPath = join(root, "agents.md");
      const appendixPath = join(root, "agents.pi-cli.md");
      const argsFile = join(root, "argv.txt");
      await writeFile(systemPromptPath, "be the fake harness\n");
      await writeFile(agentsPath, "shared worker context\n");
      await writeFile(appendixPath, "pi-cli-only rules\n");
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("pi-cli", {
        cwd: root,
        prompt: "hello",
        systemPromptPath,
        contextFilePaths: [agentsPath, appendixPath],
        sessionDir: join(session.runDir, "subprocess-sessions"),
      }, {
        binPath,
        env: { PIANO_FAKE_MODE: "args", PIANO_FAKE_ARGS_FILE: argsFile },
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(exit)).toBe(true);
      // The fake harness writes one argv entry per line; the multi-line
      // appendix arrives as a single argument, so re-join the captured lines
      // and search the full argv text for the appended payload.
      const captured = await readFile(argsFile, "utf8");
      const flag = argvIndex(captured.split("\n"), "--append-system-prompt");
      expect(flag).toBeGreaterThan(-1);
      const appended = captured.split("\n").slice(flag + 1).join("\n");
      expect(appended).toContain("be the fake harness");
      expect(appended).toContain(`# ${agentsPath}`);
      expect(appended).toContain("shared worker context");
      expect(appended).toContain(`# ${appendixPath}`);
      expect(appended).toContain("pi-cli-only rules");
      // Shared context precedes the harness appendix in the appended text.
      expect(appended.indexOf("shared worker context")).toBeLessThan(appended.indexOf("pi-cli-only rules"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("mounts the web_search extension only when a pi-cli stage names it", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-websearch-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const configPath = join(root, "agent.config.json");
      await writeFile(configPath, JSON.stringify({ piCli: { baseUrl: "http://gateway.test", apiKey: "test-key" } }));
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", configPath);
      const argsFile = join(root, "websearch-argv.txt");
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("pi-cli", {
        cwd: root,
        prompt: "hello",
        tools: ["read", "web_search"],
        sessionDir: join(session.runDir, "subprocess-sessions"),
      }, {
        binPath,
        env: { PIANO_FAKE_MODE: "args", PIANO_FAKE_ARGS_FILE: argsFile },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(exit)).toBe(true);
      const args = (await readFile(argsFile, "utf8")).trim().split("\n");
      expect(args[argvIndex(args, "--extension") + 1]).toBe(piWebSearchExtensionPath);
      expect(args[argvIndex(args, "--tools") + 1]).toBe("read,web_search");
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails before spawning pi-cli when web_search lacks gateway config", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-websearch-noconfig-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const configPath = join(root, "agent.config.json");
      const argsFile = join(root, "websearch-noconfig-argv.txt");
      await writeFile(configPath, JSON.stringify({ piCli: { baseUrl: "http://gateway.test" } }));
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", configPath);
      vi.stubEnv("PIANO_PI_CLI_API_KEY", "");
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("pi-cli", {
        cwd: root,
        prompt: "hello",
        tools: ["read", "web_search"],
        sessionDir: join(session.runDir, "subprocess-sessions"),
      }, {
        binPath,
        env: { PIANO_FAKE_MODE: "args", PIANO_FAKE_ARGS_FILE: argsFile },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain("web_search needs the endpoint");
      await expect(readFile(argsFile, "utf8")).rejects.toBeTruthy();
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  // The API tier of the Claude live-stream fix: argv must ask the CLI for
  // partial messages, or the stdout carries only whole `assistant` records
  // and the harness-level normalization above never sees a delta.
  it("requests Claude partial messages in the subprocess argv", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-claude-args-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const argsFile = join(root, "claude-args.txt");
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("claude", {
        cwd: root,
        prompt: "hello",
        sessionDir: join(session.runDir, "subprocess-sessions"),
      }, {
        binPath,
        env: { PIANO_FAKE_MODE: "args", PIANO_FAKE_ARGS_FILE: argsFile },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(exit)).toBe(true);
      const args = (await readFile(argsFile, "utf8")).trim().split("\n");
      expect(args.slice(0, 6)).toEqual(["--bare", "--print", "--output-format", "stream-json", "--verbose", "--include-partial-messages"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses Claude full mode only when a stage declares WebSearch", async () => {
    for (const [tools, bare] of [[[
      "read", "WebSearch",
    ], false], [["read"], true]] as const) {
      const root = await mkdtemp(join(tmpdir(), "piano-subprocess-claude-bare-"));
      try {
        const session = await testSession(root);
        const binPath = await fakeHarness(root);
        const argsFile = join(root, "claude-argv.txt");
        const exit = await Effect.runPromiseExit(executeSubprocessAgent("claude", {
          cwd: root,
          prompt: "hello",
          tools,
          sessionDir: join(session.runDir, "subprocess-sessions"),
        }, {
          binPath,
          env: { PIANO_FAKE_MODE: "args", PIANO_FAKE_ARGS_FILE: argsFile },
          retryDelaysMs: [],
        }).pipe(
          Effect.provideService(Logging, loggingService(session.log, session.trace)),
          Effect.provide(NodeFileSystem.layer),
        ));
        expect(Exit.isSuccess(exit)).toBe(true);
        const args = (await readFile(argsFile, "utf8")).trim().split("\n");
        expect(args.includes("--bare")).toBe(bare);
        expect(args[argvIndex(args, "--allowed-tools") + 1]).toBe(tools[0]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  it("invokes the official dsh launcher without Pi CLI flags", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-dsh-args-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const argsFile = join(root, "dsh-args.txt");
      // An absent config leaves dsh with no model, which is the boundary this
      // asserts: the developer's own config would supply one. The stage has no
      // web tool, so its prepared home supplies the ablation overlay.
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", join(root, "absent.json"));
      const dshHome = await dshHomeFixture(root);
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("dsh", {
        cwd: root,
        prompt: "hello",
        sessionDir: join(session.runDir, "subprocess-sessions"),
      }, {
        binPath,
        env: { PIANO_FAKE_MODE: "args", PIANO_FAKE_ARGS_FILE: argsFile, DSH_HOME: dshHome },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(exit)).toBe(true);
      const args = (await readFile(argsFile, "utf8")).trim().split("\n");
      expect(args.slice(0, 2)).toEqual(["--profile", "headless"]);
      expect(args).not.toContain("--mode");
      expect(args).not.toContain("--print");
      // No configured model means no model overlay to point at; the only patch
      // is the generated web_search ablation overlay.
      const patches = args.filter((_, index) => args[index - 1] === "--patch");
      expect(patches).toEqual([dshWebSearchOffPatchPath(dshHome)]);
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("selects the requested dsh model through the generated launcher overlay", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-dsh-patch-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const argsFile = join(root, "dsh-args.txt");
      const dshHome = await dshHomeFixture(root, "qwen3.8-max");
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("dsh", {
        cwd: root,
        prompt: "hello",
        sessionDir: join(session.runDir, "subprocess-sessions"),
      }, {
        binPath,
        model: "qwen3.8-max",
        env: { PIANO_FAKE_MODE: "args", PIANO_FAKE_ARGS_FILE: argsFile, DSH_HOME: dshHome },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(exit)).toBe(true);
      const args = (await readFile(argsFile, "utf8")).trim().split("\n");
      // dsh's headless entry point reads the process-wide default model, so the
      // request travels as a launcher patch resolved inside the generated home.
      expect(args.slice(0, 6)).toEqual([
        "--profile",
        "headless",
        "--patch",
        dshModelPatchPath(dshHome, "qwen3.8-max"),
        "--patch",
        dshWebSearchOffPatchPath(dshHome),
      ]);
      // The task stays the final positional argument.
      expect(args.at(-1)).toBe("hello");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ablates dsh web_search only when the stage does not declare it", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-dsh-ablate-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const configPath = join(root, "agent.config.json");
      await writeFile(configPath, JSON.stringify({ dsh: { provider: "enflame" } }));
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", configPath);
      const dshHome = await dshHomeFixture(root);
      const offPath = dshWebSearchOffPatchPath(dshHome);
      for (const [tools, ablated] of [[undefined, true], [["web_search"], false]] as const) {
        const argsFile = join(root, `dsh-args-${String(ablated)}.txt`);
        const exit = await Effect.runPromiseExit(executeSubprocessAgent("dsh", {
          cwd: root,
          prompt: "hello",
          ...(tools === undefined ? {} : { tools }),
          sessionDir: join(session.runDir, "subprocess-sessions"),
        }, {
          binPath,
          env: { PIANO_FAKE_MODE: "args", PIANO_FAKE_ARGS_FILE: argsFile, DSH_HOME: dshHome },
          retryDelaysMs: [],
        }).pipe(
          Effect.provideService(Logging, loggingService(session.log, session.trace)),
          Effect.provide(NodeFileSystem.layer),
        ));
        expect(Exit.isSuccess(exit)).toBe(true);
        const args = (await readFile(argsFile, "utf8")).trim().split("\n");
        const patches = args.map((value, index) => args[index - 1] === "--patch" ? value : null)
          .filter((value): value is string => value !== null);
        expect(patches.includes(offPath)).toBe(ablated);
      }
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails before spawning dsh when the web_search ablation overlay is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-dsh-no-ablation-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const configPath = join(root, "agent.config.json");
      await writeFile(configPath, JSON.stringify({ dsh: { provider: "enflame" } }));
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", configPath);
      const dshHome = join(root, "dsh-home");
      const argsFile = join(root, "dsh-args.txt");
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("dsh", {
        cwd: root,
        prompt: "hello",
        sessionDir: join(session.runDir, "subprocess-sessions"),
      }, {
        binPath,
        env: { PIANO_FAKE_MODE: "args", PIANO_FAKE_ARGS_FILE: argsFile, DSH_HOME: dshHome },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const [failure] = Cause.failures(exit.cause);
        expect((failure as { kind?: string }).kind).toBe("session-artifact");
        expect(String(failure)).toContain("web_search ablation overlay is missing");
      }
      await expect(readFile(argsFile, "utf8")).rejects.toBeTruthy();
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails before spawning dsh when the requested model has no generated overlay", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-dsh-no-overlay-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const argsFile = join(root, "dsh-args.txt");
      const dshHome = await dshHomeFixture(root);
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("dsh", {
        cwd: root,
        prompt: "hello",
        sessionDir: join(session.runDir, "subprocess-sessions"),
      }, {
        binPath,
        model: "qwen3.8-flash",
        env: { PIANO_FAKE_MODE: "args", PIANO_FAKE_ARGS_FILE: argsFile, DSH_HOME: dshHome },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const [failure] = Cause.failures(exit.cause);
        expect((failure as { kind?: string }).kind).toBe("model-not-found");
        expect(String(failure)).toContain("qwen3.8-flash");
        expect(String(failure)).toContain("models list");
      }
      await expect(readFile(argsFile, "utf8")).rejects.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts the official dsh plain final response as assistant text", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-dsh-plain-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", join(root, "absent.json"));
      const dshHome = await dshHomeFixture(root);
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("dsh", {
        cwd: root,
        prompt: "hello",
        sessionDir: join(session.runDir, "subprocess-sessions"),
      }, {
        binPath,
        env: { PIANO_FAKE_MODE: "dsh-plain", DSH_HOME: dshHome },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) expect(exit.value.text).toBe("PIANO_DSH_NATIVE_OUTPUT");
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("gives explicit Piano subprocess config precedence without mutating the parent env", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-env-precedence-"));
    const parentKey = process.env.ANTHROPIC_API_KEY;
    const parentBaseUrl = process.env.ANTHROPIC_BASE_URL;
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("claude", {
        cwd: root,
        prompt: "hello",
        sessionDir: join(session.runDir, "subprocess-sessions"),
      }, {
        binPath,
        apiKey: "piano-key",
        baseUrl: "https://piano.example/v1",
        env: {
          PIANO_FAKE_MODE: "env",
          ANTHROPIC_API_KEY: "parent-key-in-child",
          ANTHROPIC_BASE_URL: "https://user.example/v1",
        },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) expect(exit.value.text).toBe("piano-key|https://piano.example/v1");
      expect(process.env.ANTHROPIC_API_KEY).toBe(parentKey);
      expect(process.env.ANTHROPIC_BASE_URL).toBe(parentBaseUrl);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("maps dsh native session evidence into Piano events and transcript", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-dsh-evidence-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", join(root, "absent.json"));
      const dshHome = await dshHomeFixture(root);
      const sessionFile = join(dshHome, "sessions", "foreign-project", "native-session", "session.jsonl");
      const nativeEvents = [
        { type: "session", version: 1, id: "native-session", createdAt: Date.now(), cwd: root, delegationDepth: 0 },
        { type: "turn/start", seq: 1, data: { turn: 1 } },
        { type: "step/start", seq: 2, data: { turn: 1, step: 1 } },
        { type: "assistant/message", data: {
          turn: 1,
          step: 1,
          message: { role: "assistant", content: [{ type: "tool-call", id: "call-1", name: "write", arguments: "{\"path\":\"proof\"}" }] },
          usage: { inputTokens: 7, outputTokens: 3 },
        } },
        { type: "tool/call", data: { turn: 1, step: 1, callId: "call-1", name: "write", arguments: "{\"path\":\"proof\"}" } },
        { type: "tool/result", data: {
          turn: 1,
          step: 1,
          message: { role: "user", source: { kind: "tool", callId: "call-1" }, content: [{ type: "tool-result", toolCallId: "call-1", content: [{ type: "text", text: "created" }], isError: false }] },
        } },
        { type: "step/end", seq: 6, data: { turn: 1, step: 1 } },
        { type: "step/start", seq: 7, data: { turn: 1, step: 2 } },
        { type: "assistant/message", data: {
          turn: 1,
          step: 2,
          message: { role: "assistant", content: [{ type: "text", text: "native result" }] },
          usage: { inputTokens: 9, outputTokens: 4 },
        } },
        { type: "step/end", seq: 9, data: { turn: 1, step: 2 } },
      ].map((event) => JSON.stringify(event)).join("\n");
      const events: AgentEvent[] = [];
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("dsh", {
        cwd: root,
        prompt: "hello",
        sessionDir: join(session.runDir, "subprocess-sessions"),
        onEvent: (event) => events.push(event),
      }, {
        binPath,
        env: {
          DSH_HOME: dshHome,
          PIANO_FAKE_MODE: "dsh-evidence",
          PIANO_DSH_SESSION_FILE: sessionFile,
          PIANO_DSH_SESSION_CONTENT: nativeEvents,
        },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(exit)).toBe(true);
      if (!Exit.isSuccess(exit)) return;
      expect(exit.value).toMatchObject({ sessionId: "native-session", text: "PIANO_DSH_NATIVE_FINAL" });
      expect(events.some((event) => event.type === "tool_execution_start" && event.toolCallId === "call-1")).toBe(true);
      expect(events.some((event) => event.type === "tool_execution_end" && event.toolName === "write")).toBe(true);
      expect(events.filter((event) => event.type === "usage")).toEqual([
        { type: "usage", usage: { input: 7, output: 3 } },
        { type: "usage", usage: { input: 9, output: 4 } },
      ]);
      expect(events.some((event) => event.type === "turn_start")).toBe(true);
      expect(events.some((event) => event.type === "turn_end")).toBe(true);
      const transcript = await readFile(exit.value.transcriptPath, "utf8");
      // dsh resumes with a fresh spawn, so the persisted transcript is the
      // canonical message dialect, not the native session events.
      expect(transcript).toContain('"type":"message"');
      expect(transcript).toContain('"type":"toolCall"');
      expect(transcript).toContain('"input":9');
      expect(transcript).not.toContain('"type":"assistant/message"');
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("streams packed dsh text rows before the headless process exits", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-dsh-stream-"));
    vi.stubEnv("PIANO_USER_AGENT_CONFIG", join(root, "absent.json"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const dshHome = await dshHomeFixture(root);
      const sessionFile = join(dshHome, "sessions", "foreign-project", "native-session", "session.jsonl");
      const events: AgentEvent[] = [];
      let firstDeltaAt = 0;
      let doneAt = 0;
      const header = JSON.stringify({ type: "session", version: 1, id: "native-session", createdAt: Date.now(), cwd: root, delegationDepth: 0 });
      const turn = JSON.stringify({ type: "turn/start", seq: 1, time: Date.now(), data: { turn: 1 } });
      const row = JSON.stringify({
        type: "text-chunks",
        seq0: 2,
        time0: Date.now(),
        data: { turn: 1, step: 1, index: 0, dt: [1, 1], texts: ["one", " two", " three"] },
      });
      const assistant = JSON.stringify({
        type: "assistant/message",
        seq: 5,
        time: Date.now(),
        data: { turn: 1, step: 1, message: { role: "assistant", content: [{ type: "text", text: "one two three" }] } },
      });
      const end = JSON.stringify({ type: "turn/end", seq: 6, time: Date.now(), data: { turn: 1, reason: { kind: "completed" } } });
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("dsh", {
        cwd: root,
        prompt: "hello",
        sessionDir: join(session.runDir, "subprocess-sessions"),
        onEvent: (event) => {
          events.push(event);
          if (textDelta(event) !== undefined && firstDeltaAt === 0) firstDeltaAt = Date.now();
          if (event.type === "done") doneAt = Date.now();
        },
      }, {
        binPath,
        env: {
          DSH_HOME: dshHome,
          PIANO_FAKE_MODE: "dsh-stream",
          PIANO_DSH_SESSION_FILE: sessionFile,
          PIANO_DSH_STREAM_HEADER: header,
          PIANO_DSH_STREAM_TURN: turn,
          PIANO_DSH_STREAM_ROW: row,
          PIANO_DSH_STREAM_ASSISTANT: assistant,
          PIANO_DSH_STREAM_END: end,
        },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(firstDeltaAt).toBeGreaterThan(0);
      expect(doneAt).toBeGreaterThan(firstDeltaAt);
      expect(doneAt - firstDeltaAt).toBeGreaterThanOrEqual(100);
      expect(events.filter((event) => textDelta(event) !== undefined).map((event) => textDelta(event))).toEqual([
        "one", " two", " three",
      ]);
      expect(events.filter((event) => event.type === "message_end" && event.message.role === "assistant")).toHaveLength(1);
      if (Exit.isSuccess(exit)) expect(exit.value).toMatchObject({ sessionId: "native-session", text: "one two three" });
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("tails dsh's independently compressed zstd session frames", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-dsh-zstd-stream-"));
    vi.stubEnv("PIANO_USER_AGENT_CONFIG", join(root, "absent.json"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const dshHome = await dshHomeFixture(root);
      const sessionFile = join(dshHome, "sessions", "foreign-project", "native-session", "session.jsonl.zstd");
      const now = Date.now();
      const env = {
        DSH_HOME: dshHome,
        PIANO_FAKE_MODE: "dsh-zstd-stream",
        PIANO_DSH_SESSION_FILE: sessionFile,
        PIANO_DSH_STREAM_HEADER: JSON.stringify({ type: "session", version: 1, id: "native-session", createdAt: now, cwd: root, delegationDepth: 0 }),
        PIANO_DSH_STREAM_TURN: JSON.stringify({ type: "turn/start", seq: 1, time: now + 1, data: { turn: 1 } }),
        PIANO_DSH_STREAM_ROW: JSON.stringify({ type: "text-chunks", seq0: 2, time0: now + 2, data: { turn: 1, step: 1, index: 0, dt: [1, 1], texts: ["one", " two", " three"] } }),
        PIANO_DSH_STREAM_ASSISTANT: JSON.stringify({ type: "assistant/message", seq: 5, time: now + 5, data: { turn: 1, step: 1, message: { role: "assistant", content: [{ type: "text", text: "one two three" }] } } }),
        PIANO_DSH_STREAM_END: JSON.stringify({ type: "turn/end", seq: 6, time: now + 6, data: { turn: 1, reason: { kind: "completed" } } }),
      };
      const events: AgentEvent[] = [];
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("dsh", {
        cwd: root,
        prompt: "hello",
        sessionDir: join(session.runDir, "subprocess-sessions"),
        onEvent: (event) => events.push(event),
      }, { binPath, env, retryDelaysMs: [] }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(events.filter((event) => textDelta(event) !== undefined).map((event) => textDelta(event))).toEqual([
        "one", " two", " three",
      ]);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.sessionId).toBe("native-session");
        expect(await readFile(exit.value.transcriptPath, "utf8")).toContain("one two three");
      }
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("normalizes Claude-style content deltas through the same event contract", () => {
    const events: AgentEvent[] = [];
    const accumulator: SubprocessAccumulator = { text: "" };
    normalizeSubprocessLine(JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hello" } }), "claude", (event) => events.push(event), accumulator);
    expect(accumulator.text).toBe("hello");
    expect(events).toEqual([expect.objectContaining({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } })]);
  });

  // Claude's `--include-partial-messages` frames arrive wrapped in a
  // `stream_event` envelope. The TUI's live transcript renderer only follows
  // the `message_update` / `text_delta` contract Pi emits, so an unwrapped
  // delta that leaks out as `unknown` leaves the chat area parked at the head
  // of the transcript for the whole turn. These frames are copied verbatim
  // from a `claude --print --output-format stream-json` run.
  it("unwraps Claude stream_event frames into Pi's incremental text deltas", () => {
    const events: AgentEvent[] = [];
    const accumulator: SubprocessAccumulator = { text: "" };
    const emit = (event: AgentEvent) => events.push(event);
    const envelope = (event: unknown) => JSON.stringify({
      type: "stream_event",
      event,
      session_id: "claude-session",
      uuid: "frame-uuid",
      parent_tool_use_id: null,
    });

    normalizeSubprocessLine(envelope({ type: "message_start", message: { id: "msg-1", role: "assistant", content: [] } }), "claude", emit, accumulator);
    normalizeSubprocessLine(envelope({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }), "claude", emit, accumulator);
    normalizeSubprocessLine(envelope({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "pondering" } }), "claude", emit, accumulator);
    normalizeSubprocessLine(envelope({ type: "content_block_stop", index: 0 }), "claude", emit, accumulator);
    normalizeSubprocessLine(envelope({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }), "claude", emit, accumulator);
    for (const piece of ["Hello", ", world", "!"]) {
      normalizeSubprocessLine(envelope({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: piece } }), "claude", emit, accumulator);
    }
    // `message_stop` closes the Anthropic stream frame but not the chat turn:
    // the completed `assistant` record below is what emits `message_end`. If it
    // leaked as `unknown` it would end the live block between two blocks of
    // the same turn.
    normalizeSubprocessLine(envelope({ type: "message_stop" }), "claude", emit, accumulator);
    expect(events.filter((event) => event.type === "unknown")).toHaveLength(0);
    expect(accumulator.text).toBe("Hello, world!");
    expect(events.filter((event) => textDelta(event) !== undefined).map((event) => textDelta(event))).toEqual(["Hello", ", world", "!"]);
    // The thinking frame is lifecycle, not chat text: it must not arrive as a
    // delta or the live block would open on a non-visible turn.
    expect(events.filter((event) => event.type === "message_update" && textDelta(event) === undefined)).toHaveLength(1);

    // The completed `assistant` record closes the streamed block rather than
    // repeating it, and the terminal `result` frame repeats nothing.
    normalizeSubprocessLine(JSON.stringify({
      type: "assistant",
      session_id: "claude-session",
      message: { id: "msg-1", role: "assistant", content: [{ type: "text", text: "Hello, world!" }] },
    }), "claude", emit, accumulator);
    normalizeSubprocessLine(JSON.stringify({ type: "result", subtype: "success", result: "Hello, world!" }), "claude", emit, accumulator);

    expect(events.filter((event) => event.type === "message_end")).toHaveLength(1);
    expect(events.filter((event) => event.type === "unknown")).toHaveLength(0);
    expect(accumulator.text).toBe("Hello, world!");
  });

  // The gateway prepends a `[save-token: ...]` banner to model text, and
  // `--include-partial-messages` splits it across deltas (observed live: the
  // banner ended mid-frame). The streamed head is held until decidable so the
  // banner never enters the live block, while the durable text still agrees
  // with the completed record.
  it("holds a gateway banner split across Claude stream deltas out of the live text", () => {
    const events: AgentEvent[] = [];
    const accumulator: SubprocessAccumulator = { text: "" };
    const emit = (event: AgentEvent) => events.push(event);
    const envelope = (event: unknown) => JSON.stringify({ type: "stream_event", event, session_id: "claude-session" });
    normalizeSubprocessLine(envelope({ type: "message_start", message: { id: "msg-1", role: "assistant", content: [] } }), "claude", emit, accumulator);
    normalizeSubprocessLine(envelope({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }), "claude", emit, accumulator);
    normalizeSubprocessLine(envelope({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "pondering" } }), "claude", emit, accumulator);
    normalizeSubprocessLine(envelope({ type: "content_block_stop", index: 0 }), "claude", emit, accumulator);
    // The thinking message completes first — its record disarms the hold — and
    // the text block then opens WITHOUT a second `message_start` (observed
    // live). The re-arm at text block start is what keeps the banner out.
    normalizeSubprocessLine(JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "pondering" }] },
    }), "claude", emit, accumulator);
    normalizeSubprocessLine(envelope({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }), "claude", emit, accumulator);
    for (const piece of ["[save-token: proxy=healthy routing=proxy", " mode=full] READY", " now"]) {
      normalizeSubprocessLine(envelope({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: piece } }), "claude", emit, accumulator);
    }
    normalizeSubprocessLine(envelope({ type: "message_stop" }), "claude", emit, accumulator);
    expect(events.filter((event) => textDelta(event) !== undefined).map((event) => textDelta(event))).toEqual(["READY", " now"]);

    normalizeSubprocessLine(JSON.stringify({
      type: "assistant",
      message: { id: "msg-1", role: "assistant", content: [{ type: "text", text: "READY now" }] },
    }), "claude", emit, accumulator);
    expect(accumulator.text).toBe("READY now");
    expect(events.filter((event) => event.type === "message_end")).toHaveLength(2); // thinking record + text record
    expect(JSON.stringify(events)).not.toContain("save-token");
  });

  // The banner hold is a Claude-only gate: `--include-partial-messages` is the
  // only thing that can split a banner mid-frame. Pi's adapter emits whole
  // deltas, so arming the hold for it could strand real model text. This pins
  // that a pi-cli stream beginning with a banner-looking frame still streams
  // through verbatim.
  it("never arms the banner hold for the pi harness", () => {
    const events: AgentEvent[] = [];
    const accumulator: SubprocessAccumulator = { text: "" };
    const emit = (event: AgentEvent) => events.push(event);
    normalizeSubprocessLine(JSON.stringify({ type: "message_start", message: { role: "assistant", content: [] } }), "pi-cli", emit, accumulator);
    normalizeSubprocessLine(JSON.stringify({
      type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "[save-token: not a claude banner]" },
    }), "pi-cli", emit, accumulator);
    normalizeSubprocessLine(JSON.stringify({
      type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " and the rest" },
    }), "pi-cli", emit, accumulator);

    // Held back would drop or truncate the first delta; pi sees both exactly as
    // they arrived, the way it did before the hold existed.
    expect(events.filter((event) => textDelta(event) !== undefined).map((event) => textDelta(event))).toEqual([
      "[save-token: not a claude banner]", " and the rest",
    ]);
    expect(accumulator.proxyPending).toBeUndefined();
  });

  it("swallows Claude system lifecycle frames without losing the session id", () => {
    const events: AgentEvent[] = [];
    const accumulator: SubprocessAccumulator = { text: "" };
    // `init` announces the session and lists tools/model; it is not chat
    // content, but the session id still has to reach the accumulator.
    normalizeSubprocessLine(JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "claude-session",
      tools: ["Read"],
      model: "deepseek-v4-flash",
    }), "claude", (event) => events.push(event), accumulator);
    normalizeSubprocessLine(JSON.stringify({
      type: "system", subtype: "thinking_tokens", estimated_tokens: 12, session_id: "claude-session",
    }), "claude", (event) => events.push(event), accumulator);

    expect(accumulator.sessionId).toBe("claude-session");
    expect(events).toHaveLength(0);
  });

  it("keeps a Claude stream_event envelope from recursing and ignores empty frames", () => {
    const events: AgentEvent[] = [];
    const accumulator: SubprocessAccumulator = { text: "" };
    const emit = (event: AgentEvent) => events.push(event);
    normalizeSubprocessLine(JSON.stringify({ type: "stream_event", event: { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "nope" } } } }), "claude", emit, accumulator);
    normalizeSubprocessLine(JSON.stringify({ type: "stream_event" }), "claude", emit, accumulator);
    normalizeSubprocessLine(JSON.stringify({ type: "stream_event", event: {} }), "claude", emit, accumulator);
    expect(events).toHaveLength(0);
    expect(accumulator.text).toBe("");
  });

  it("streams a Claude turn into one live chat block that follows the newest text", () => {
    const events: AgentEvent[] = [];
    const accumulator: SubprocessAccumulator = { text: "" };
    const emit = (event: AgentEvent) => events.push(event);
    const envelope = (event: unknown) => JSON.stringify({ type: "stream_event", event, session_id: "claude-session" });
    normalizeSubprocessLine(envelope({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }), "claude", emit, accumulator);
    for (const piece of ["1. first", " line\n", "2. second", " line\n", "3. third line"]) {
      normalizeSubprocessLine(envelope({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } }), "claude", emit, accumulator);
      // A heartbeat frame lands between deltas mid-turn; it must not split the
      // block the way an `unknown` teardown used to.
      normalizeSubprocessLine(JSON.stringify({ type: "system", subtype: "thinking_tokens", session_id: "claude-session" }), "claude", emit, accumulator);
    }
    normalizeSubprocessLine(JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "1. first line\n2. second line\n3. third line" }] },
    }), "claude", emit, accumulator);

    const chatArea = new Container();
    const view = new TranscriptView(chatArea, darkTheme);
    // `route` is the TUI's own dispatcher, so this asserts the path Claude
    // actually takes rather than a copy of the routing rules.
    for (const event of events) view.route(event);

    // eslint-disable-next-line no-control-regex -- strips terminal SGR codes from a rendered frame
    const rendered = chatArea.render(60).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    // One block, not one per delta: the whole turn is a single live Markdown
    // node, and the newest text is at the tail of the rendered area.
    expect(chatArea.children).toHaveLength(1);
    expect(rendered).toContain("3. third line");
    expect(rendered.split("\n").filter((row) => row.includes("first line")).length).toBe(1);
  });

  it("closes Claude tool calls from user tool_result frames and avoids duplicate terminal text", () => {
    const events: AgentEvent[] = [];
    const accumulator: SubprocessAccumulator = { text: "" };
    const emit = (event: AgentEvent) => events.push(event);
    normalizeSubprocessLine(JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "call-1", name: "Read", input: {} },
    }), "claude", emit, accumulator);
    normalizeSubprocessLine(JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: "{\"path\":\"a\"}" },
    }), "claude", emit, accumulator);
    normalizeSubprocessLine(JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: "ok" }] },
    }), "claude", emit, accumulator);
    normalizeSubprocessLine(JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "done" }] },
    }), "claude", emit, accumulator);
    normalizeSubprocessLine(JSON.stringify({ type: "result", result: "done" }), "claude", emit, accumulator);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool_execution_start", toolCallId: "call-1", toolName: "Read" }),
      expect.objectContaining({ type: "tool_execution_update", toolCallId: "call-1", toolName: "Read", partialResult: "{\"path\":\"a\"}" }),
      expect.objectContaining({ type: "tool_execution_end", toolCallId: "call-1", toolName: "Read", result: "ok" }),
    ]));
    expect(events.filter((event) => event.type === "message_end" && event.message.role === "assistant")).toHaveLength(1);
  });

  it("retains the start-frame tool name when an update omits it", () => {
    const events: AgentEvent[] = [];
    const accumulator: SubprocessAccumulator = { text: "" };
    const emit = (event: AgentEvent) => events.push(event);
    normalizeSubprocessLine(JSON.stringify({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "Read",
      args: {},
    }), "pi", emit, accumulator);
    normalizeSubprocessLine(JSON.stringify({
      type: "tool_execution_update",
      toolCallId: "call-1",
      args: {},
      partialResult: "ok",
    }), "pi", emit, accumulator);

    expect(events).toContainEqual(expect.objectContaining({
      type: "tool_execution_update",
      toolCallId: "call-1",
      toolName: "Read",
      partialResult: "ok",
    }));
  });

  it("removes a proxy diagnostic banner from Claude assistant output", () => {
    const events: AgentEvent[] = [];
    const accumulator: SubprocessAccumulator = { text: "" };
    normalizeSubprocessLine(JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: "[save-token: proxy=healthy routing=proxy]\n\nREADY" },
    }), "claude", (event) => events.push(event), accumulator);
    expect(accumulator.text).toBe("READY");
    expect(events).toContainEqual(expect.objectContaining({
      type: "message_end",
      message: expect.objectContaining({ content: "READY" }),
    }));
  });

  it("removes a proxy diagnostic banner from a Claude terminal result frame", () => {
    const events: AgentEvent[] = [];
    const accumulator: SubprocessAccumulator = { text: "" };
    normalizeSubprocessLine(JSON.stringify({
      type: "result",
      result: "[save-token: proxy=healthy routing=proxy]\n\nREADY",
    }), "claude", (event) => events.push(event), accumulator);
    expect(accumulator.text).toBe("READY");
    expect(events).toContainEqual(expect.objectContaining({
      type: "message_end",
      message: expect.objectContaining({ content: "READY" }),
    }));
  });

  it("removes a sequence of proxy diagnostic banners from native final text", () => {
    const events: AgentEvent[] = [];
    const accumulator: SubprocessAccumulator = { text: "" };
    normalizeSubprocessLine(JSON.stringify({
      type: "result",
      result: "[save-token: proxy=healthy routing=proxy]\n[save-token: compressed 256→193 chars]\nREADY",
    }), "dsh", (event) => events.push(event), accumulator);
    expect(accumulator.text).toBe("READY");
    expect(events).toContainEqual(expect.objectContaining({
      type: "message_end",
      message: expect.objectContaining({ content: "READY" }),
    }));
  });

  // Tier: API. Claude's dedicated steering implementation: streaming stdin.
  // The task travels as the first user frame, a mid-turn steer as a second
  // one the CLI ingests before its next LLM step (tool-boundary delivery —
  // the documented v2.1 stream-json semantics), and the `result` frame ends
  // the session. The fake harness logs every stdin line it took, so "the
  // steer actually reached the running child" is asserted on real bytes.
  it("asks Claude for streaming input and takes the task as the first stdin frame", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-claude-argv-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const argsFile = join(root, "claude-args.txt");
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("claude", {
        cwd: root,
        prompt: "hello",
        sessionDir: join(root, "subprocess-sessions"),
      }, {
        binPath,
        env: { PIANO_FAKE_MODE: "args", PIANO_FAKE_ARGS_FILE: argsFile },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(exit)).toBe(true);
      const args = (await readFile(argsFile, "utf8")).trim().split("\n");
      expect(args.slice(0, 2)).toEqual(["--bare", "--print"]);
      // Output streaming and input streaming are both on: partial-message
      // deltas for the live renderer, streaming user frames for steering.
      expect(args.slice(2, 8)).toEqual([
        "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--input-format", "stream-json",
      ]);
      // The task is no longer argv — it is the first stdin frame.
      expect(args).not.toContain("--");
      expect(args).not.toContain("hello");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("steers a live Claude child: the frame lands on its stdin mid-turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-claude-steer-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const stdinLog = join(root, "claude-stdin.log");
      const channel = createSteeringChannel();
      const events: AgentEvent[] = [];
      let steerDelivery: string | undefined;
      let steerPromise: Promise<void> = Promise.resolve();
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("claude", {
        cwd: root,
        prompt: "do the task",
        sessionDir: join(root, "subprocess-sessions"),
        steering: channel,
        onEvent: (event) => {
          events.push(event);
          // The first assistant record means the child is mid-turn, blocked
          // on its next stdin line — steer exactly there.
          if (event.type === "message_end" && steerDelivery === undefined) {
            steerPromise = channel.steer("go left instead").then((d) => { steerDelivery = d; });
          }
        },
      }, {
        binPath,
        env: { PIANO_FAKE_MODE: "claude-steer", PIANO_FAKE_STDIN_LOG: stdinLog },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      await steerPromise;
      expect(Exit.isSuccess(exit)).toBe(true);
      // A live bound child took the text into its running turn.
      expect(steerDelivery).toBe("delivered");
      if (Exit.isSuccess(exit)) expect(exit.value.text).toBe("half steered");
      const frames = (await readFile(stdinLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { message?: { content?: string } });
      expect(frames).toHaveLength(2);
      expect(frames[0]?.message?.content).toBe("do the task");
      expect(frames[1]?.message?.content).toBe("go left instead");
      // The completed session unbinds: later text finds no live turn.
      expect(await channel.steer("too late")).toBe("no-active-turn");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when a Claude child is gone before the steer write", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-claude-gone-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const channel = createSteeringChannel();
      // The fake never reads stdin and exits at once; the run must still
      // succeed on its frames, and steering must not pretend to be live.
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("claude", {
        cwd: root,
        prompt: "hello",
        sessionDir: join(root, "subprocess-sessions"),
        steering: channel,
      }, {
        binPath,
        env: { PIANO_FAKE_MODE: "claude-no-stdin" },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(await channel.steer("after close")).toBe("no-active-turn");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("leaves the steering channel unbound for dsh (capability, not harness branch)", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-dsh-steer-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const channel = createSteeringChannel();
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", join(root, "absent.json"));
      const dshHome = await dshHomeFixture(root);
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("dsh", {
        cwd: root,
        prompt: "hello",
        sessionDir: join(root, "subprocess-sessions"),
        steering: channel,
      }, {
        binPath,
        env: { PIANO_FAKE_MODE: "dsh-plain", DSH_HOME: dshHome },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(await channel.steer("nowhere")).toBe("no-active-turn");
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

});
