import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import { Container, Markdown } from "@earendil-works/pi-tui";
import {
  createSteeringChannel,
  dshModelPatchPath,
  dshProjectKey,
  dshResumeOverlayPath,
  dshWebSearchOffPatchPath,
  executeSubprocessAgent,
  failedAttemptContinuation,
  normalizeSubprocessLine,
  piWebSearchExtensionPath,
  textDelta,
  type AgentContinuation,
  type AgentEvent,
  type SubprocessAccumulator,
} from "../../packages/harness/src/index.js";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";
import { TranscriptView } from "../../packages/cli/src/chat-render.js";
import { TrajectoryPanel } from "../../packages/cli/src/trajectory-panel.js";
import { darkTheme } from "../../packages/cli/src/theme.js";

/** A session id in the shape dsh mints, so a continuation carrying it is
 * recognised as a real session `agents.resume` can reopen. */
const DSH_SESSION = "session-40b6f4bb-023f-453a-84f1-74505294dce2";

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
  codex)
    printf '%s\\n' "$@" > "$PIANO_FAKE_ARGS_FILE"
    printf '%s\\n' '{"type":"thread.started","thread_id":"01a09107-44cb-7290-aea6-dbd3fab5d196"}'
    printf '%s\\n' '{"type":"turn.started"}'
    printf '%s\\n' '{"type":"item.started","item":{"type":"command_execution","id":"cmd-1","command":"printf ok"}}'
    printf '%s\\n' '{"type":"item.completed","item":{"type":"command_execution","id":"cmd-1","command":"printf ok","aggregated_output":"ok","status":"completed","exit_code":0}}'
    printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"codex answer"}}'
    printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":8,"cached_input_tokens":2,"output_tokens":3}}'
    ;;
  codex-resume)
    printf '%s\\n' "$@" > "$PIANO_FAKE_ARGS_FILE"
    printf '%s\\n' '{"type":"thread.started","thread_id":"01a09107-44cb-7290-aea6-dbd3fab5d196"}'
    printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"codex resumed"}}'
    printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":4,"output_tokens":2}}'
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
  claude-init-then-fail)
    # Dies after announcing its own session, the way an interrupted or killed
    # child does: the session is real, and must outlive the failure.
    printf '%s\\n' '{"type":"system","subtype":"init","session_id":"7f9a1c2e-3b4d-4e5f-8a90-1b2c3d4e5f60"}'
    printf '%s\\n' 'fake stderr failure' >&2
    exit 3
    ;;
  claude-init-then-wait)
    # Announces its session and then works on, so a caller can be interrupted
    # mid-turn: the state a /exit on a busy prompt leaves behind.
    printf '%s\\n' '{"type":"system","subtype":"init","session_id":"7f9a1c2e-3b4d-4e5f-8a90-1b2c3d4e5f60"}'
    sleep 10
    ;;
  capture-prompt)
    # The task travels as the last argument; record it verbatim so a test can
    # inspect exactly what the harness was asked to read.
    for argument in "$@"; do last="$argument"; done
    printf '%s' "$last" > "$PIANO_FAKE_PROMPT_FILE"
    printf '%s\\n' '{"type":"result","result":"captured","session_id":"capture-session"}'
    ;;
  dsh-resume-probe)
    # Records the three things that decide whether a continued dsh actor
    # reopens its session or is handed a replay: the launcher arguments, the
    # session id the runner is told to resume, and the task text itself.
    for argument in "$@"; do last="$argument"; done
    printf '%s' "$last" > "$PIANO_FAKE_PROMPT_FILE"
    printf '%s\\n' "\${PIANO_DSH_RESUME_SESSION:-<unset>}" > "$PIANO_FAKE_ENV_FILE"
    printf '%s\\n' "$@" > "$PIANO_FAKE_ARGS_FILE"
    # A reopen writes into the session it was told to resume, and that session's
    # evidence is what proves the continuation happened at all: Piano fails a
    # resumed attempt that cannot produce it, so a probe that only recorded its
    # argv would be modelling a resumed turn that never resumed anything. The
    # project directory name is storage's business — the session is looked up by
    # id — so any name works here.
    if [ -n "\${PIANO_DSH_RESUME_SESSION:-}" ]; then
      resumed="$DSH_HOME/sessions/resumed/\${PIANO_DSH_RESUME_SESSION}/session.jsonl"
      mkdir -p "$(dirname "$resumed")"
      printf '%s\\n' '{"type":"session","version":1,"id":"resumed-session","createdAt":1,"cwd":"/resumed","delegationDepth":0}' > "$resumed"
      printf '%s\\n' '{"type":"turn/start","seq":1,"data":{"turn":1}}' >> "$resumed"
      printf '%s\\n' '{"type":"assistant/message","data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"TURN-ONE-ANSWER"}]},"usage":{"inputTokens":3,"outputTokens":2}}}' >> "$resumed"
      printf '%s\\n' '{"type":"step/end","seq":3,"data":{"turn":1,"step":1}}' >> "$resumed"
    fi
    printf '%s\\n' '{"type":"result","result":"probed","session_id":"session-probe"}'
    ;;
  dsh-resume-refused)
    # The overlay's own refusal, verbatim in shape: it was told to reopen a
    # conversation, could not, and exits non-zero rather than opening a fresh
    # session. No session file is written, because none exists to write.
    printf '%s\\n' "dsh: piano-resume-runner: could not resume \${PIANO_DSH_RESUME_SESSION}" >&2
    exit 1
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

  it("runs Codex exec with the requested model/sandbox and resumes the native thread", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-codex-subprocess-test-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const argsFile = join(root, "codex-args.txt");
      const first = await Effect.runPromiseExit(executeSubprocessAgent("codex", {
        cwd: root,
        prompt: "first task",
        model: "gpt-5.6-luna",
        thinkingLevel: "high",
        tools: ["read", "bash", "edit", "write"],
        sessionDir: join(session.runDir, "codex-sessions"),
      }, {
        binPath,
        model: "gpt-5.6-luna",
        profile: "headless",
        additionalWritableDirs: [join(root, "evidence")],
        env: { PIANO_FAKE_MODE: "codex", PIANO_FAKE_ARGS_FILE: argsFile },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(first)).toBe(true);
      if (!Exit.isSuccess(first) || first.value.continuation === undefined) return;
      expect(first.value).toMatchObject({ sessionId: "01a09107-44cb-7290-aea6-dbd3fab5d196", text: "codex answer" });
      expect((await readFile(argsFile, "utf8")).split("\n")).toEqual([
        "exec", "--json", "--sandbox", "workspace-write", "--skip-git-repo-check", "--model", "gpt-5.6-luna", "--add-dir", join(root, "evidence"),
        "--config", 'model_reasoning_effort="high"', "--profile", "headless", "first task", "",
      ]);

      const second = await Effect.runPromiseExit(executeSubprocessAgent("codex", {
        cwd: root,
        prompt: "second task",
        model: "gpt-5.6-luna",
        thinkingLevel: "high",
        continuation: first.value.continuation,
        sessionDir: join(session.runDir, "codex-sessions"),
      }, {
        binPath,
        model: "gpt-5.6-luna",
        additionalWritableDirs: [join(root, "evidence")],
        env: { PIANO_FAKE_MODE: "codex-resume", PIANO_FAKE_ARGS_FILE: argsFile },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(second)).toBe(true);
      if (Exit.isSuccess(second)) {
        expect(second.value.text).toBe("codex resumed");
        expect((await readFile(argsFile, "utf8")).split("\n")).toEqual([
          "exec", "resume", "01a09107-44cb-7290-aea6-dbd3fab5d196", "--json", "--skip-git-repo-check", "--model", "gpt-5.6-luna",
          "--config", 'model_reasoning_effort="high"', "second task", "",
        ]);
      }
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

  // A cancelled attempt used to stash Piano's fabricated logical id
  // (`claude-<uuid>`) as the session identity. The next prompt then handed it
  // to `--resume`, which Claude rejects outright, so one cancelled turn made
  // every later prompt of a coding session fail. What a failure carries must
  // be the handle Claude itself announced.
  it("carries the session id Claude announced out of a failed attempt", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-claude-native-id-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("claude", {
        cwd: root,
        prompt: "hello",
        sessionDir: join(session.runDir, "subprocess-sessions"),
      }, {
        binPath,
        env: { PIANO_FAKE_MODE: "claude-init-then-fail" },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
      const continuation = Option.isSome(failure) ? failedAttemptContinuation(failure.value) : undefined;
      expect(continuation?.nativeSessionId).toBe("7f9a1c2e-3b4d-4e5f-8a90-1b2c3d4e5f60");
      // Piano's logical id still travels, and is still visibly not Claude's.
      expect(continuation?.sessionId).toMatch(/^claude-/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // An interrupted turn returns neither a result nor an error, so a session
  // announced only in the result would be lost exactly when the user presses
  // Escape or `/exit`. It has to be announced while the child is alive: first
  // the transcript path (enough for a harness that resumes by file), then the
  // native handle that makes `--resume` valid.
  it("announces the session it can come back to while the turn is still running", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-announce-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const controller = new AbortController();
      const announcements: AgentContinuation[] = [];
      let arrived: () => void = () => undefined;
      const announced = new Promise<void>((resolve) => { arrived = resolve; });
      const pending = Effect.runPromiseExit(executeSubprocessAgent("claude", {
        cwd: root,
        prompt: "hello",
        sessionDir: join(session.runDir, "subprocess-sessions"),
        signal: controller.signal,
        onContinuation: (continuation) => {
          announcements.push(continuation);
          if (continuation.nativeSessionId !== undefined) arrived();
        },
      }, {
        binPath,
        env: { PIANO_FAKE_MODE: "claude-init-then-wait" },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));

      await announced;
      // The turn is still running: the child is parked in its sleep, and what
      // the orchestrator already holds is a resumable identity.
      expect(announcements.at(-1)?.nativeSessionId).toBe("7f9a1c2e-3b4d-4e5f-8a90-1b2c3d4e5f60");
      expect(announcements.at(-1)?.transcriptPath).toContain(session.runDir);

      controller.abort();
      expect(Exit.isFailure(await pending)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // dsh cannot resume a session, so the previous conversation is replayed as
  // prompt text. Replayed whole it grows with every epoch — a 20-turn coding
  // session was measured at 2.1 MB — so what the child is handed must be
  // bounded, and the omission disclosed rather than hidden.
  it("bounds the dsh conversation it replays into the next epoch", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-dsh-budget-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const dshHome = await dshHomeFixture(root);
      const promptFile = join(root, "dsh-prompt.txt");
      const transcriptPath = join(root, "transcript.jsonl");
      const records = Array.from({ length: 40 }, (_value, index) => JSON.stringify({
        type: "message",
        message: { role: index % 2 === 0 ? "user" : "assistant", content: `record ${index} ${"x".repeat(20_000)}` },
      }));
      await writeFile(transcriptPath, `${records.join("\n")}\n`, "utf8");
      // An absent config leaves dsh with no model, and the stage has no web
      // tool, so the prepared home supplies only the ablation overlay.
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", join(root, "absent.json"));

      const exit = await Effect.runPromiseExit(executeSubprocessAgent("dsh", {
        cwd: root,
        prompt: "next step",
        sessionDir: join(session.runDir, "subprocess-sessions"),
        continuation: { harness: "dsh", sessionId: "sess-continued", transcriptPath },
      }, {
        binPath,
        env: { PIANO_FAKE_MODE: "capture-prompt", PIANO_FAKE_PROMPT_FILE: promptFile, DSH_HOME: dshHome },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(exit)).toBe(true);

      const prompt = await readFile(promptFile, "utf8");
      // Bounded in bytes — what the OS limit counts — and cut at record
      // boundaries, so whole messages only. A budget in characters would slip
      // past it as soon as the conversation holds multi-byte text.
      expect(Buffer.byteLength(prompt, "utf8")).toBeLessThan(128 * 1024);
      expect(prompt).toContain('"record 39 ');
      expect(prompt).not.toContain('"record 0 ');
      // Honest about the part it dropped, so the model can say what it lacks.
      expect(prompt).toMatch(/Earlier context was omitted for length \(\d+ older records?\)/);
      // The task itself is still what the epoch ends on.
      expect(prompt).toContain("## New task\nnext step");
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  // The OS limit as an error the caller can act on. Without this the spawn
  // fails with a bare `E2BIG` that the adapter reports as the harness being
  // unavailable, which says nothing about the prompt that caused it.
  it("names the single-argument limit instead of failing to spawn", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-argmax-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const dshHome = await dshHomeFixture(root);
      const systemPromptPath = join(root, "system.md");
      await writeFile(systemPromptPath, "x".repeat(200_000), "utf8");
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", join(root, "absent.json"));

      const exit = await Effect.runPromiseExit(executeSubprocessAgent("dsh", {
        cwd: root,
        prompt: "hello",
        systemPromptPath,
        sessionDir: join(session.runDir, "subprocess-sessions"),
      }, {
        binPath,
        env: { PIANO_FAKE_MODE: "dsh-plain", DSH_HOME: dshHome },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));

      expect(Exit.isFailure(exit)).toBe(true);
      const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
      expect(Option.isSome(failure) ? failure.value.message : "").toMatch(/over the 131072-byte limit/);
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  // dsh's shipped headless runner mints a session per process, so a continued
  // actor used to get its whole transcript replayed as prompt text. The platform
  // can reopen a session; Piano's overlay installs a runner that does.
  it("reopens the actor's dsh session instead of replaying the transcript", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-dsh-resume-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const dshHome = await dshHomeFixture(root);
      await writeFile(dshResumeOverlayPath(dshHome), "# generated overlay placeholder\n", "utf8");
      const transcriptPath = join(root, "transcript.jsonl");
      await writeFile(
        transcriptPath,
        '{"type":"message","message":{"role":"user","content":"EARLIER-TURN-MARKER"}}\n',
        "utf8",
      );
      const argsFile = join(root, "dsh-args.txt");
      const promptFile = join(root, "dsh-prompt.txt");
      const envFile = join(root, "dsh-env.txt");
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", join(root, "absent.json"));

      const exit = await Effect.runPromiseExit(executeSubprocessAgent("dsh", {
        cwd: root,
        prompt: "next step",
        sessionDir: join(session.runDir, "subprocess-sessions"),
        continuation: {
          harness: "dsh",
          sessionId: DSH_SESSION,
          nativeSessionId: DSH_SESSION,
          transcriptPath,
        },
      }, {
        binPath,
        env: {
          PIANO_FAKE_MODE: "dsh-resume-probe",
          PIANO_FAKE_ARGS_FILE: argsFile,
          PIANO_FAKE_PROMPT_FILE: promptFile,
          PIANO_FAKE_ENV_FILE: envFile,
          DSH_HOME: dshHome,
        },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(exit)).toBe(true);

      // The overlay that swaps in the resuming runner is what dsh is launched
      // with, and the session id travels alongside it.
      const args = (await readFile(argsFile, "utf8")).trim().split("\n");
      const patches = args.filter((_value, index) => args[index - 1] === "--patch");
      expect(patches).toContain(dshResumeOverlayPath(dshHome));
      expect((await readFile(envFile, "utf8")).trim()).toBe(DSH_SESSION);

      // And the transcript is not replayed: the session already holds it, so a
      // replay would be a second, redundant telling inside one prompt.
      const prompt = await readFile(promptFile, "utf8");
      expect(prompt).toContain("next step");
      expect(prompt).not.toContain("EARLIER-TURN-MARKER");
      expect(prompt).not.toContain("Conversation continued from the previous dsh attempt");
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  // A cancelled first turn records Piano's own logical id (`dsh-<uuid>`) because
  // dsh never reported one. Resuming that would name a session that does not
  // exist, so the adapter keeps the fallback it can actually honour: replay the
  // transcript into a fresh session.
  it("replays the transcript when the actor has no dsh session to reopen", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-dsh-nosession-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      const dshHome = await dshHomeFixture(root);
      await writeFile(dshResumeOverlayPath(dshHome), "# generated overlay placeholder\n", "utf8");
      const transcriptPath = join(root, "transcript.jsonl");
      await writeFile(
        transcriptPath,
        '{"type":"message","message":{"role":"user","content":"EARLIER-TURN-MARKER"}}\n',
        "utf8",
      );
      const argsFile = join(root, "dsh-args.txt");
      const promptFile = join(root, "dsh-prompt.txt");
      const envFile = join(root, "dsh-env.txt");
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", join(root, "absent.json"));

      const exit = await Effect.runPromiseExit(executeSubprocessAgent("dsh", {
        cwd: root,
        prompt: "next step",
        sessionDir: join(session.runDir, "subprocess-sessions"),
        continuation: {
          harness: "dsh",
          sessionId: "dsh-1acd0f63-5482-4b16-85e0-804256d06326",
          transcriptPath,
        },
      }, {
        binPath,
        env: {
          PIANO_FAKE_MODE: "dsh-resume-probe",
          PIANO_FAKE_ARGS_FILE: argsFile,
          PIANO_FAKE_PROMPT_FILE: promptFile,
          PIANO_FAKE_ENV_FILE: envFile,
          DSH_HOME: dshHome,
        },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(exit)).toBe(true);

      const args = (await readFile(argsFile, "utf8")).trim().split("\n");
      expect(args).not.toContain(dshResumeOverlayPath(dshHome));
      expect((await readFile(envFile, "utf8")).trim()).toBe("<unset>");
      expect(await readFile(promptFile, "utf8")).toContain("EARLIER-TURN-MARKER");
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resumes Claude only with a session id Claude itself reported", async () => {
    const logicalOnly = {
      harness: "claude",
      sessionId: "claude-1acd0f63-5482-4b16-85e0-804256d06326",
    };
    for (const [label, continuation, resume] of [
      ["a Piano-minted logical id", logicalOnly, undefined],
      ["the native handle the attempt observed", {
        ...logicalOnly,
        nativeSessionId: "62a4635e-bdc7-437f-80e6-a586c5692abe",
      }, "62a4635e-bdc7-437f-80e6-a586c5692abe"],
    ] as const) {
      const root = await mkdtemp(join(tmpdir(), "piano-subprocess-claude-resume-"));
      try {
        const session = await testSession(root);
        const binPath = await fakeHarness(root);
        const argsFile = join(root, "claude-resume-args.txt");
        const exit = await Effect.runPromiseExit(executeSubprocessAgent("claude", {
          cwd: root,
          prompt: "hello",
          continuation: { ...continuation, transcriptPath: join(root, "actor.jsonl") },
          sessionDir: join(session.runDir, "subprocess-sessions"),
        }, {
          binPath,
          env: { PIANO_FAKE_MODE: "args", PIANO_FAKE_ARGS_FILE: argsFile },
          retryDelaysMs: [],
        }).pipe(
          Effect.provideService(Logging, loggingService(session.log, session.trace)),
          Effect.provide(NodeFileSystem.layer),
        ));
        expect(Exit.isSuccess(exit), label).toBe(true);
        const args = (await readFile(argsFile, "utf8")).trim().split("\n");
        expect(args.includes("--resume"), label).toBe(resume !== undefined);
        if (resume !== undefined) expect(args[argvIndex(args, "--resume") + 1], label).toBe(resume);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
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

  it("finds a continued dsh session whose project key belongs to an earlier cwd", async () => {
    // A resumed map slot runs in `.../slots/<iteration>/<map>/slot-N`, while dsh
    // keys its storage by cwd. The session the actor asks to reopen was created
    // under the *previous* iteration's path, so the project directory holding it
    // is never the one this epoch's cwd names. Matching on the id finds it;
    // demanding the header's cwd equal the current one does not, and the
    // transcript then degrades to raw stdout, which the evidence analyzer reads
    // as malformed — failing the evidence of every tournament run.
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-dsh-stale-cwd-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", join(root, "absent.json"));
      const dshHome = await dshHomeFixture(root);
      await writeFile(dshResumeOverlayPath(dshHome), "# generated overlay placeholder\n", "utf8");

      const earlierCwd = join(root, "slots", "iter-0", "tune.race", "slot-0");
      const currentCwd = join(root, "slots", "iter-1", "tune.race", "slot-0");
      await mkdir(currentCwd, { recursive: true });
      const sessionFile = join(dshHome, "sessions", "--earlier-cwd-project--", DSH_SESSION, "session.jsonl");
      const nativeEvents = [
        { type: "session", version: 1, id: DSH_SESSION, createdAt: Date.now(), cwd: earlierCwd, delegationDepth: 0 },
        { type: "turn/start", seq: 1, data: { turn: 1 } },
        { type: "assistant/message", data: {
          turn: 1,
          step: 1,
          message: { role: "assistant", content: [{ type: "text", text: "resumed work" }] },
          usage: { inputTokens: 5, outputTokens: 2 },
        } },
        { type: "step/end", seq: 3, data: { turn: 1, step: 1 } },
      ].map((event) => JSON.stringify(event)).join("\n");
      const transcriptPath = join(root, "transcript.jsonl");
      await writeFile(
        transcriptPath,
        '{"type":"message","message":{"role":"user","content":"EARLIER-TURN-MARKER"}}\n',
        "utf8",
      );

      const exit = await Effect.runPromiseExit(executeSubprocessAgent("dsh", {
        cwd: currentCwd,
        prompt: "next step",
        sessionDir: join(session.runDir, "subprocess-sessions"),
        continuation: {
          harness: "dsh",
          sessionId: DSH_SESSION,
          nativeSessionId: DSH_SESSION,
          transcriptPath,
        },
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
      // The named session is the one that comes back, not a neighbour in the
      // same project directory.
      expect(exit.value.sessionId).toBe(DSH_SESSION);
      const transcript = await readFile(exit.value.transcriptPath, "utf8");
      // The resumed turn is appended to the canonical dialect...
      expect(transcript).toContain("EARLIER-TURN-MARKER");
      expect(transcript).toContain('"type":"message"');
      expect(transcript).toContain("resumed work");
      // ...rather than falling back to the raw stdout the analyzer rejects.
      expect(transcript).not.toContain("PIANO_DSH_NATIVE_FINAL");
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never hands a resumed dsh actor a sibling lane's session", async () => {
    // One project directory holds every stage of one map slot, so an actor's
    // current project directory contains its siblings' sessions. dsh keys those
    // directories by cwd, and a resumed map lane runs in a new cwd each
    // iteration — so the actor's own session sits under the *previous*
    // iteration's key while a sibling's sits under the current one. A resumed
    // actor must be given the session it named and nothing else: "the newest
    // session in the directory this cwd names" is the sibling's file, and
    // loading it would put another worker's conversation into this worker's
    // transcript, which the next epoch would replay back as its own history.
    // Lane memory is private; cross-lane learning travels through the shared
    // workspace, not through sessions.
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-dsh-lane-isolation-"));
    const siblingSessionId = "session-11112222-3333-4444-5555-666677778888";
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", join(root, "absent.json"));
      const dshHome = await dshHomeFixture(root);
      await writeFile(dshResumeOverlayPath(dshHome), "# generated overlay placeholder\n", "utf8");

      const earlierCwd = join(root, "slots", "iter-0", "tune.race", "slot-0");
      const cwd = join(root, "slots", "iter-1", "tune.race", "slot-0");
      await mkdir(cwd, { recursive: true });
      const sessionsRoot = join(dshHome, "sessions");
      const sessionText = (id: string, text: string): string => [
        { type: "session", version: 1, id, createdAt: Date.now(), cwd, delegationDepth: 0 },
        { type: "turn/start", seq: 1, data: { turn: 1 } },
        { type: "assistant/message", data: {
          turn: 1,
          step: 1,
          message: { role: "assistant", content: [{ type: "text", text }] },
          usage: { inputTokens: 4, outputTokens: 2 },
        } },
        { type: "step/end", seq: 3, data: { turn: 1, step: 1 } },
      ].map((event) => JSON.stringify(event)).join("\n");

      // The actor's own session, where dsh created it: the previous cwd's key.
      const ownFile = join(sessionsRoot, dshProjectKey(earlierCwd), DSH_SESSION, "session.jsonl");
      await mkdir(dirname(ownFile), { recursive: true });
      await writeFile(ownFile, sessionText(DSH_SESSION, "MY-OWN-MEMORY"), "utf8");

      // A sibling stage's session under the key this cwd names. Its directory
      // existing is what scopes a cwd-derived candidate list to siblings only,
      // and the fake child refreshes the file, so it is the newest by every
      // measure a "discover the session" lookup could use.
      const siblingFile = join(sessionsRoot, dshProjectKey(cwd), siblingSessionId, "session.jsonl");
      await mkdir(dirname(siblingFile), { recursive: true });
      const siblingContent = sessionText(siblingSessionId, "SIBLING-SECRET");
      await writeFile(siblingFile, siblingContent, "utf8");

      const transcriptPath = join(root, "transcript.jsonl");
      await writeFile(
        transcriptPath,
        '{"type":"message","message":{"role":"user","content":"EARLIER-TURN-MARKER"}}\n',
        "utf8",
      );
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("dsh", {
        cwd,
        prompt: "next step",
        sessionDir: join(session.runDir, "subprocess-sessions"),
        continuation: {
          harness: "dsh",
          sessionId: DSH_SESSION,
          nativeSessionId: DSH_SESSION,
          transcriptPath,
        },
      }, {
        binPath,
        env: {
          DSH_HOME: dshHome,
          PIANO_FAKE_MODE: "dsh-evidence",
          PIANO_DSH_SESSION_FILE: siblingFile,
          PIANO_DSH_SESSION_CONTENT: siblingContent,
        },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(exit)).toBe(true);
      if (!Exit.isSuccess(exit)) return;

      expect(exit.value.sessionId).toBe(DSH_SESSION);
      const transcript = await readFile(exit.value.transcriptPath, "utf8");
      expect(transcript).toContain("MY-OWN-MEMORY");
      // The sibling's conversation stays out of this actor's memory.
      expect(transcript).not.toContain("SIBLING-SECRET");
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails a resumed dsh actor when its session cannot be read back", async () => {
    // Storage can lose a session its actor still believes it owns — a pruned
    // DSH_HOME, a run pointed at another home, a session directory removed
    // between epochs. The child then exits cleanly having written some other
    // session, and an actor that quietly continued would run the stage with
    // none of the memory the resume promised while the run's records still
    // claimed continuity. Worse, the transcript fallback would write the
    // child's raw stdout, which the evidence analyzer rejects as malformed
    // records — reporting that symptom instead of the cause. The request named
    // a conversation, so what is missing is this turn's transcript, and the
    // error says exactly that.
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-dsh-lost-"));
    const lostSessionId = "session-99998888-7777-6666-5555-444433332222";
    const freshSessionId = "session-00001111-2222-3333-4444-555566667777";
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", join(root, "absent.json"));
      const dshHome = await dshHomeFixture(root);
      await writeFile(dshResumeOverlayPath(dshHome), "# generated overlay placeholder\n", "utf8");

      const cwd = join(root, "slots", "tune", "slot-0");
      await mkdir(cwd, { recursive: true });
      const sessionText = (id: string, text: string): string => [
        { type: "session", version: 1, id, createdAt: Date.now(), cwd, delegationDepth: 0 },
        { type: "turn/start", seq: 1, data: { turn: 1 } },
        { type: "assistant/message", data: {
          turn: 1,
          step: 1,
          message: { role: "assistant", content: [{ type: "text", text }] },
          usage: { inputTokens: 4, outputTokens: 2 },
        } },
        { type: "step/end", seq: 3, data: { turn: 1, step: 1 } },
      ].map((event) => JSON.stringify(event)).join("\n");

      // The child exits zero, but what it wrote is not the session this actor
      // was told to continue: the one it named is nowhere in storage.
      const freshFile = join(dshHome, "sessions", dshProjectKey(cwd), freshSessionId, "session.jsonl");
      await mkdir(dirname(freshFile), { recursive: true });
      const freshContent = sessionText(freshSessionId, "FRESH-SESSION-OUTPUT");
      await writeFile(freshFile, freshContent, "utf8");

      const marker = '{"type":"message","message":{"role":"user","content":"EARLIER-TURN-MARKER"}}\n';
      const transcriptPath = join(root, "transcript.jsonl");
      await writeFile(transcriptPath, marker, "utf8");

      const events: AgentEvent[] = [];
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("dsh", {
        cwd,
        prompt: "next step",
        sessionDir: join(session.runDir, "subprocess-sessions"),
        onEvent: (event) => events.push(event),
        continuation: {
          harness: "dsh",
          sessionId: lostSessionId,
          nativeSessionId: lostSessionId,
          transcriptPath,
        },
      }, {
        binPath,
        env: {
          DSH_HOME: dshHome,
          PIANO_FAKE_MODE: "dsh-evidence",
          PIANO_DSH_SESSION_FILE: freshFile,
          PIANO_DSH_SESSION_CONTENT: freshContent,
        },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Cause.failureOption(exit.cause);
        expect(Option.isSome(error)).toBe(true);
        if (Option.isSome(error)) {
          expect(error.value).toMatchObject({ kind: "transcript-missing" });
          expect(error.value.message).toContain(lostSessionId);
          expect(error.value.message).toContain(dshHome);
        }
      }
      // The failure belongs to the run's records, not only to its exit code.
      expect(events.find((event) => event.type === "error")).toMatchObject({ errorType: "transcript-missing" });
      // And the missing session never became a raw-stdout transcript: the
      // earlier turn is untouched, so no evidence analyzer can read the child's
      // prose as this actor's records.
      expect(await readFile(transcriptPath, "utf8")).toBe(marker);
      // The child's own answer is still observable: naming the defect must not
      // cost the run the evidence of what the model actually said.
      expect(events.some((event) => event.type === "message_end")).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps an interrupt and a failed spawn their own error on a resumed actor", async () => {
    // The transcript-missing guard describes one condition: a resumed actor that
    // left no conversation behind. An interrupt did not fail to leave one — the
    // user ended the turn — and a spawn that never happened left nothing to
    // miss. Both keep the error (and the retry) they are owed, which is what
    // makes the guard's own exclusion meaningful rather than a blanket rename.
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-dsh-exclusions-"));
    const lostSessionId = "session-77776666-5555-4444-3333-222211110000";
    try {
      const session = await testSession(root);
      const dshHome = await dshHomeFixture(root);
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", join(root, "absent.json"));
      // Without the overlay the attempt dies earlier, on the harness home's own
      // precondition, so it has to exist for the spawn and interrupt boundaries
      // below to be the ones under test.
      await writeFile(dshResumeOverlayPath(dshHome), "# generated overlay placeholder\n", "utf8");
      const continuation = {
        harness: "dsh" as const,
        sessionId: lostSessionId,
        nativeSessionId: lostSessionId,
        transcriptPath: join(root, "transcript.jsonl"),
      };
      const request = {
        cwd: root,
        prompt: "next step",
        sessionDir: join(session.runDir, "subprocess-sessions"),
        continuation,
      };
      const run = async (options: Parameters<typeof executeSubprocessAgent>[2]) =>
        Effect.runPromiseExit(executeSubprocessAgent("dsh", request, options).pipe(
          Effect.provideService(Logging, loggingService(session.log, session.trace)),
          Effect.provide(NodeFileSystem.layer),
        ));
      const kindOf = (exit: Awaited<ReturnType<typeof run>>): unknown => {
        const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
        return Option.isSome(failure) ? failure.value.kind : undefined;
      };

      // A spawn that never happened: the binary is not there.
      const missing = await run({
        binPath: join(root, "absent-harness"),
        env: { DSH_HOME: dshHome },
        retryDelaysMs: [],
      });
      expect(kindOf(missing)).toBe("harness-unavailable");

      // An interrupt: the same cancelled outcome Piano reports for Esc.
      const binPath = await fakeHarness(root);
      const controller = new AbortController();
      const interrupted = Effect.runPromiseExit(executeSubprocessAgent("dsh", {
        ...request,
        signal: controller.signal,
      }, {
        binPath,
        env: { DSH_HOME: dshHome, PIANO_FAKE_MODE: "abort" },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      // Let the child start before ending the turn. The `abort` mode sleeps, so
      // the interrupt lands on a live process rather than a race with spawn.
      await new Promise((resolve) => setTimeout(resolve, 50));
      controller.abort();
      expect(kindOf(await interrupted)).toBe("cancelled");
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("names a refused continuation by what is missing, not as a rejected request", async () => {
    // The overlay fails the turn when it cannot reopen the session it was told
    // to continue. That arrives as a non-zero exit, and the generic non-zero
    // mapper calls every one of those "request-rejected" — a label that says
    // nothing about the conversation that went missing, and one Piano would
    // retry, spending two more turns to rediscover the same absence. What is
    // actually missing is this turn's transcript.
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-dsh-refused-"));
    const lostSessionId = "session-13572468-1357-2468-1357-246813572468";
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", join(root, "absent.json"));
      const dshHome = await dshHomeFixture(root);
      await writeFile(dshResumeOverlayPath(dshHome), "# generated overlay placeholder\n", "utf8");

      const transcriptPath = join(root, "transcript.jsonl");
      const events: AgentEvent[] = [];
      const exit = await Effect.runPromiseExit(executeSubprocessAgent("dsh", {
        cwd: root,
        prompt: "next step",
        sessionDir: join(session.runDir, "subprocess-sessions"),
        onEvent: (event) => events.push(event),
        continuation: {
          harness: "dsh",
          sessionId: lostSessionId,
          nativeSessionId: lostSessionId,
          transcriptPath,
        },
      }, {
        binPath,
        env: { DSH_HOME: dshHome, PIANO_FAKE_MODE: "dsh-resume-refused" },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Cause.failureOption(exit.cause);
        expect(Option.isSome(error)).toBe(true);
        if (Option.isSome(error)) {
          expect(error.value).toMatchObject({ kind: "transcript-missing" });
          expect(error.value.message).toContain(lostSessionId);
          // The overlay's own account of the refusal survives in the message:
          // naming the defect must not cost the reader the cause.
          expect(error.value.message).toContain("could not resume");
        }
      }
      // No transcript was manufactured for it, so nothing downstream can read
      // the child's empty output as this actor's records.
      expect(await stat(transcriptPath).then(() => true, () => false)).toBe(false);
      expect(events.find((event) => event.type === "error")).toMatchObject({ errorType: "transcript-missing" });
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps a resumed dsh transcript equal to the conversation, not a stack of it", async () => {
    // A resumed dsh session hands back its whole event list every turn, so the
    // payload of turn 2 contains turn 1. Appending that payload writes turn 1
    // twice, and a ten-turn actor ended up 84% repeated records — which the
    // analyzers then counted as work (`rounds`, tokens and tool calls all come
    // from this file). The stored transcript must stay equal to the
    // conversation, however many times a turn is replayed.
    const root = await mkdtemp(join(tmpdir(), "piano-subprocess-dsh-fold-"));
    try {
      const session = await testSession(root);
      const binPath = await fakeHarness(root);
      vi.stubEnv("PIANO_USER_AGENT_CONFIG", join(root, "absent.json"));
      const dshHome = await dshHomeFixture(root);
      await writeFile(dshResumeOverlayPath(dshHome), "# generated overlay placeholder\n", "utf8");

      const cwd = join(root, "slots", "iter-1", "tune.race", "slot-0");
      await mkdir(cwd, { recursive: true });
      // dsh's own native shapes, because those are what map to canonical
      // records. The identity that matters is byte identity: a resumed session
      // replays the earlier turns' records unchanged, which is what lets the
      // fold recognise them.
      const answer = (turn: number, text: string): string => JSON.stringify({
        type: "assistant/message",
        data: {
          turn,
          step: 1,
          message: { role: "assistant", content: [{ type: "text", text }] },
          usage: { inputTokens: 3, outputTokens: 5 },
        },
      });
      const nativeEvents = (lines: readonly string[]): string => [
        JSON.stringify({ type: "session", version: 1, id: DSH_SESSION, createdAt: Date.now(), cwd, delegationDepth: 0 }),
        JSON.stringify({ type: "turn/start", seq: 1, data: { turn: 1 } }),
        ...lines,
        JSON.stringify({ type: "step/end", seq: 99, data: { turn: 1, step: 1 } }),
      ].join("\n");

      // Turn 1's conversation, where dsh stores it: under the key this cwd names.
      const sessionFile = join(dshHome, "sessions", dshProjectKey(cwd), DSH_SESSION, "session.jsonl");
      const turnOne = [answer(1, "FIRST-ANSWER")];
      const turnTwo = [...turnOne, answer(2, "SECOND-ANSWER")];

      const run = (lines: readonly string[], continuation?: {
        readonly harness: "dsh";
        readonly sessionId: string;
        readonly nativeSessionId: string;
        readonly transcriptPath: string;
      }) => Effect.runPromiseExit(executeSubprocessAgent("dsh", {
        cwd,
        prompt: "next step",
        sessionDir: join(session.runDir, "subprocess-sessions"),
        ...(continuation === undefined ? {} : { continuation }),
      }, {
        binPath,
        env: {
          DSH_HOME: dshHome,
          PIANO_FAKE_MODE: "dsh-evidence",
          PIANO_DSH_SESSION_FILE: sessionFile,
          PIANO_DSH_SESSION_CONTENT: nativeEvents(lines),
        },
        retryDelaysMs: [],
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));

      const first = await run(turnOne);
      expect(Exit.isSuccess(first)).toBe(true);
      if (!Exit.isSuccess(first)) return;
      const transcriptPath = first.value.transcriptPath;
      expect(await readFile(transcriptPath, "utf8")).toContain("FIRST-ANSWER");

      // Turn 2 replays everything: the same session, now two records long.
      const second = await run(turnTwo, {
        harness: "dsh",
        sessionId: DSH_SESSION,
        nativeSessionId: DSH_SESSION,
        transcriptPath,
      });
      expect(Exit.isSuccess(second)).toBe(true);

      const transcript = await readFile(transcriptPath, "utf8");
      expect(transcript).toContain("FIRST-ANSWER");
      expect(transcript).toContain("SECOND-ANSWER");
      // The record the replay repeated appears once: the file is the
      // conversation, not the conversation plus a copy of its first turn.
      expect(transcript.split("FIRST-ANSWER")).toHaveLength(2);
      expect(transcript.split("SECOND-ANSWER")).toHaveLength(2);

      // Replaying the same turn again — a retry — adds nothing at all.
      const replay = await run(turnTwo, {
        harness: "dsh",
        sessionId: DSH_SESSION,
        nativeSessionId: DSH_SESSION,
        transcriptPath,
      });
      expect(Exit.isSuccess(replay)).toBe(true);
      expect(await readFile(transcriptPath, "utf8")).toBe(transcript);
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
    // node, and the newest text is at the tail of the rendered area. Counting
    // Markdown nodes rather than all children leaves room for the turn's own
    // trailing nodes (the reply's elapsed-time footer).
    expect(chatArea.children.filter((child) => child instanceof Markdown)).toHaveLength(1);
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
