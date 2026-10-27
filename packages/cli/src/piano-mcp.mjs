#!/usr/bin/env node
/* global process, setTimeout, clearTimeout */
// Piano's stdio MCP server for coding agents.
//
// One tool surface shared by Claude Code, dsh, and Codex: `piano_run` starts a
// headless Piano run, `piano_status` reports its stage, and `piano_result`
// returns the final text. The server owns the child process; a run that
// outlives the caller's wait window stays live for later status/result calls.
//
// Protocol bytes go to stdout only; diagnostics stay on stderr so a malformed
// child never corrupts MCP.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const PROTOCOL_VERSION = "2025-06-18";
const RUNS_ROOT = join(homedir(), ".piano", "runs");
const DEFAULT_WAIT_SECONDS = 30;
const MAX_WAIT_SECONDS = 3600;
const MAX_OUTPUT_CHARS = 32_000;

/** Live runs owned by this server process, keyed by Piano run id. A run whose
 * caller stops waiting remains here for `piano_status`/`piano_result`. Finished
 * states are kept too — a later poll reports the exact result instead of
 * re-reading disk — but the map is bounded so a long-lived server cannot grow
 * without limit. */
const runs = new Map();
const MAX_FINISHED_RUNS = 50;

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function errorMessage(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}

function cap(value, limit) {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n… (${value.length - limit} chars truncated)`;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The command that starts the Piano CLI. `PIANO_MCP_PIANO_BIN` is the
 * deployment override; otherwise use the bin beside this sidecar, so a host
 * MCP config only needs the sidecar path. */
function pianoCommand() {
  const override = process.env.PIANO_MCP_PIANO_BIN;
  if (override !== undefined && override.trim() !== "") return { command: override.trim(), args: [] };
  const sibling = resolve(dirname(fileURLToPath(import.meta.url)), "..", "bin", "piano.mjs");
  if (existsSync(sibling)) return { command: process.execPath, args: [sibling] };
  return { command: "piano", args: [] };
}

/** A run id is a directory name under the runs root, and it arrives from model
 * input, so it must not be able to walk out of that root. Same shape the
 * dashboard accepts. */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function statusPath(runId) {
  return join(RUNS_ROOT, runId, "status.json");
}

function trajectoryPath(runId) {
  return join(RUNS_ROOT, runId, "system-log", "trajectory.jsonl");
}

/** The last assistant text a finished run recorded. This is the fallback when
 * the MCP server has no live state (for example after a host restart). */
function finalTextFromRun(runId) {
  try {
    const lines = readFileSync(trajectoryPath(runId), "utf8").split("\n").filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index--) {
      let record;
      try {
        record = JSON.parse(lines[index]);
      } catch {
        continue;
      }
      const events = Array.isArray(record?.events) ? record.events : [];
      for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex--) {
        const event = events[eventIndex];
        if (event?.type !== "message_end" || event?.message?.role !== "assistant") continue;
        const content = Array.isArray(event.message.content) ? event.message.content : [];
        const text = content
          .filter((block) => block?.type === "text" && typeof block.text === "string")
          .map((block) => block.text)
          .join("");
        if (text !== "") return text;
      }
    }
  } catch {
    // No trajectory yet, or it is still being written.
  }
  return undefined;
}

function readPersistedStatus(runId) {
  try {
    const raw = readFileSync(statusPath(runId), "utf8");
    const status = JSON.parse(raw);
    if (!isRecord(status)) return undefined;
    return status;
  } catch {
    return undefined;
  }
}

/** The stage the orchestrator says is running, from the authoritative
 * `current` field. An accepted entry is the last finished stage, not progress. */
function currentStageOf(status) {
  const current = isRecord(status?.current) ? status.current : undefined;
  if (current?.status !== "running") return undefined;
  return typeof current.stageId === "string" ? current.stageId : undefined;
}

/** Fill stage counters from the run's authoritative state document. The
 * headless stream carries lifecycle lines, not the denominator; status.json
 * does. */
function refreshFromStatus(state) {
  if (state.runId === undefined) return;
  const persisted = readPersistedStatus(state.runId);
  if (persisted === undefined) return;
  if (typeof persisted.completedStages === "number") state.completedStages = persisted.completedStages;
  if (typeof persisted.plannedStages === "number") state.plannedStages = persisted.plannedStages;
  const stage = currentStageOf(persisted);
  if (stage !== undefined) state.currentStage = stage;
  if (state.runDir === undefined) state.runDir = join(RUNS_ROOT, state.runId);
}

function summaryOf(state) {
  const stages = typeof state.plannedStages === "number"
    ? ` · ${state.completedStages ?? 0}/${state.plannedStages} stages`
    : "";
  const stage = state.currentStage === undefined ? "" : ` · ${state.currentStage}`;
  return `Piano ${state.runId}: ${state.status}${stages}${stage}`;
}

function structuredOf(state) {
  return {
    runId: state.runId,
    status: state.status,
    summary: summaryOf(state),
    ...(state.output === undefined ? {} : { output: cap(state.output, MAX_OUTPUT_CHARS) }),
    ...(state.error === undefined ? {} : { error: state.error }),
    ...(state.runDir === undefined ? {} : { runDir: state.runDir }),
    ...(state.workflow === undefined ? {} : { workflow: state.workflow }),
    ...(state.durationMs === undefined ? {} : { durationMs: state.durationMs }),
    ...(state.completedStages === undefined ? {} : { completedStages: state.completedStages }),
    ...(state.plannedStages === undefined ? {} : { plannedStages: state.plannedStages }),
    ...(state.currentStage === undefined ? {} : { currentStage: state.currentStage }),
  };
}

function resultOf(state) {
  const detail = state.output !== undefined
    ? cap(state.output, MAX_OUTPUT_CHARS)
    : state.error !== undefined
      ? state.error
      : undefined;
  const text = detail === undefined ? summaryOf(state) : `${summaryOf(state)}\n\n${detail}`;
  return {
    content: [{ type: "text", text }],
    structuredContent: structuredOf(state),
    ...(state.status === "failed" ? { isError: true } : {}),
  };
}

function updateProgress(state, event) {
  const workflow = isRecord(event?.workflow) ? event.workflow : undefined;
  if (typeof workflow?.stageId === "string") state.currentStage = workflow.stageId;
  if (event?.type === "tool_execution_start" && typeof event.toolName === "string") {
    state.currentStage = `${workflow?.stageId ?? "tool"}: ${event.toolName}`;
  }
}

/** Drop the oldest finished states once the map grows past its bound. Live runs
 * are never dropped; `piano_status` still answers for them from disk. */
function pruneFinishedRuns() {
  if (runs.size <= MAX_FINISHED_RUNS) return;
  for (const [runId, state] of runs) {
    if (runs.size <= MAX_FINISHED_RUNS) return;
    if (state.status === "completed" || state.status === "failed") runs.delete(runId);
  }
}

/** A finished run no longer needs its child, whose streams hold the caller's
 * closures; the state stays for `piano_status`/`piano_result` of this process. */
function release(state) {
  state.child = undefined;
}

function parseLine(state, line) {
  // A streaming assistant update carries the whole accumulated message on every
  // token, so parsing it would cost the square of the reply length; the server
  // never reads it. `run.started` and the `agent_event` types it does read are
  // prefixed with `"type"` early in the record, so a substring test is enough.
  if (line.includes('"type":"message_update"') || line.includes('"type":"tool_execution_update"')) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (!isRecord(message)) return;
  if (message.event === "run.started") {
    state.runId = typeof message.run_id === "string" ? message.run_id : state.runId;
    if (typeof message.workflow === "string") state.workflow = message.workflow;
    state.status = "running";
    runs.set(state.runId, state);
    pruneFinishedRuns();
    state.started?.();
    return;
  }
  if (message.event === "agent_event") {
    updateProgress(state, message.data);
    return;
  }
  if (message.event === "run.completed") {
    state.status = "completed";
    state.output = cap(typeof message.text === "string" ? message.text : "", MAX_OUTPUT_CHARS);
    if (typeof message.status_path === "string") state.runDir = dirname(message.status_path);
    if (state.runDir === undefined && typeof message.progress_path === "string") state.runDir = dirname(message.progress_path);
    if (state.runDir === undefined && state.runId !== undefined) state.runDir = join(RUNS_ROOT, state.runId);
    state.durationMs = Date.now() - state.startedAt;
    refreshFromStatus(state);
    state.currentStage = undefined;
    release(state);
    state.done?.();
    return;
  }
  if (message.event === "run.failed") {
    state.status = "failed";
    state.error = typeof message.error === "string" ? message.error : "Piano run failed";
    state.durationMs = Date.now() - state.startedAt;
    release(state);
    state.done?.();
  }
}

function startRun(args) {
  const prompt = args?.prompt;
  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw new Error("piano_run requires a non-empty prompt");
  }
  const cwd = resolve(typeof args.cwd === "string" && args.cwd.trim() !== "" ? args.cwd : process.cwd());
  if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`piano_run cwd is not a directory: ${cwd}`);
  }
  const workflow = typeof args.workflow === "string" && args.workflow.trim() !== "" ? args.workflow.trim() : undefined;
  const mnemonic = typeof args.mnemonic === "string" && args.mnemonic.trim() !== "" ? args.mnemonic.trim() : undefined;
  const waitSeconds = Math.min(
    MAX_WAIT_SECONDS,
    Math.max(0, Number.isFinite(args.waitSeconds) ? args.waitSeconds : DEFAULT_WAIT_SECONDS),
  );
  const { command, args: prefix } = pianoCommand();
  const commandArgs = [...prefix, "-p", "--json"];
  if (workflow !== undefined) commandArgs.push("--workflow", workflow);
  if (mnemonic !== undefined) commandArgs.push("--mnemonic", mnemonic);
  commandArgs.push(prompt);

  let started;
  const startedPromise = new Promise((resolveStarted) => { started = resolveStarted; });
  let done;
  const donePromise = new Promise((resolveDone) => { done = resolveDone; });
  const child = spawn(command, commandArgs, {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const state = {
    runId: undefined,
    child,
    workflow,
    status: "starting",
    startedAt: Date.now(),
    output: undefined,
    error: undefined,
    runDir: undefined,
    completedStages: undefined,
    plannedStages: undefined,
    currentStage: undefined,
    started,
    done,
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line !== "") parseLine(state, line);
    }
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = cap(`${stderr}${chunk}`, 4_000);
  });
  child.on("error", (cause) => {
    state.status = "failed";
    state.error = `piano failed to start: ${errorMessage(cause)}`;
    state.done?.();
    state.started?.();
  });
  child.on("close", (code, signal) => {
    if (state.status === "completed" || state.status === "failed") return;
    state.status = "failed";
    state.error = `piano exited ${code ?? signal ?? "unknown"}${stderr.trim() === "" ? "" : `: ${stderr.trim()}`}`;
    state.done?.();
    state.started?.();
  });
  return { state, startedPromise, donePromise, waitSeconds };
}

/** Await `promise`, or give up after `ms`. The timer is cleared either way so a
 * finished wait leaves nothing pending on the event loop. */
async function waitFor(promise, ms) {
  let timer;
  try {
    await Promise.race([promise, new Promise((resolveTimeout) => {
      timer = setTimeout(resolveTimeout, ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function runTool(args) {
  const { state, startedPromise, donePromise, waitSeconds } = startRun(args);
  await waitFor(startedPromise, 15_000);
  if (state.runId === undefined) {
    if (state.status === "failed") {
      return {
        content: [{ type: "text", text: state.error ?? "Piano failed before reporting a run id" }],
        isError: true,
      };
    }
    state.status = "failed";
    state.error = `Piano did not report run.started within 15s${state.error === undefined ? "" : `: ${state.error}`}`;
    state.child?.kill();
    return { content: [{ type: "text", text: state.error }], isError: true };
  }
  if (waitSeconds === 0) return resultOf(state);
  await waitFor(donePromise, waitSeconds * 1000);
  return resultOf(state);
}

function lookupRun(runId) {
  if (typeof runId !== "string" || !RUN_ID.test(runId)) throw new Error("runId must be a Piano run id");
  const live = runs.get(runId);
  if (live !== undefined) {
    // Counters only move while the run is live; a finished run's status.json
    // would be re-read on every poll for no change.
    if (live.status === "running" || live.status === "starting") refreshFromStatus(live);
    return live;
  }
  const persisted = readPersistedStatus(runId);
  if (persisted === undefined) throw new Error(`unknown Piano run: ${runId}`);
  const status = typeof persisted.status === "string" ? persisted.status : "unknown";
  const currentStage = currentStageOf(persisted);
  return {
    runId,
    status,
    runDir: join(RUNS_ROOT, runId),
    ...(typeof persisted.workflowPath === "string" ? { workflow: persisted.workflowPath } : {}),
    ...(typeof persisted.completedStages === "number" ? { completedStages: persisted.completedStages } : {}),
    ...(typeof persisted.plannedStages === "number" ? { plannedStages: persisted.plannedStages } : {}),
    ...(currentStage === undefined ? {} : { currentStage }),
    ...(status === "completed" ? { output: finalTextFromRun(runId) } : {}),
    ...(status === "failed" && persisted.error !== undefined ? { error: String(persisted.error) } : {}),
  };
}

function statusTool(args) {
  return resultOf(lookupRun(args?.runId));
}

function resultTool(args) {
  const state = lookupRun(args?.runId);
  if (state.status === "running" || state.status === "starting") {
    return {
      content: [{
        type: "text",
        text: `${summaryOf(state)}\n\nPiano is still running. Call piano_status with the same runId.`,
      }],
      structuredContent: structuredOf(state),
    };
  }
  if (state.output === undefined && state.status === "completed") {
    state.output = finalTextFromRun(state.runId);
  }
  return resultOf(state);
}

const tools = [
  {
    name: "piano_run",
    description:
      "Run a Piano/Tuna workflow in a directory and return its summary and output. Starts a headless `piano -p --json` run. If the run outlives waitSeconds, returns status=running with a runId; call piano_status/piano_result later.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The task or prompt Piano should run." },
        workflow: { type: "string", description: "Optional workflow YAML path, absolute or relative to cwd." },
        cwd: { type: "string", description: "Workspace directory. Defaults to the MCP server process cwd." },
        mnemonic: { type: "string", description: "Optional lane namespace for tournament branches." },
        waitSeconds: {
          type: "number",
          description: `How long to wait for completion before returning a running handle. Default ${DEFAULT_WAIT_SECONDS}, max ${MAX_WAIT_SECONDS}.`,
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "piano_status",
    description: "Report a Piano run's current lifecycle status and stage. Accepts a runId returned by piano_run.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string", description: "Piano run id." } },
      required: ["runId"],
      additionalProperties: false,
    },
  },
  {
    name: "piano_result",
    description: "Return a Piano run's final summary and output. If the run is still running, reports its current status.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string", description: "Piano run id." } },
      required: ["runId"],
      additionalProperties: false,
    },
  },
];

async function handle(message) {
  const id = message?.id;
  const method = message?.method;
  if (typeof method !== "string" || method.startsWith("notifications/") || id === undefined) return;
  const reply = (result) => sendResult(id, result);
  const toolError = (text) => reply({ content: [{ type: "text", text }], isError: true });
  switch (method) {
    case "initialize":
      reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "piano", version: "0.1.0" },
      });
      return;
    case "ping":
      reply({});
      return;
    case "tools/list":
      reply({ tools });
      return;
    case "tools/call": {
      const name = message?.params?.name;
      const args = isRecord(message?.params?.arguments) ? message.params.arguments : {};
      try {
        if (name === "piano_run") reply(await runTool(args));
        else if (name === "piano_status") reply(statusTool(args));
        else if (name === "piano_result") reply(resultTool(args));
        else sendError(id, -32602, `unknown tool: ${String(name)}`);
      } catch (cause) {
        toolError(`${String(name)} failed: ${errorMessage(cause)}`);
      }
      return;
    }
    default:
      sendError(id, -32601, `unknown method: ${method}`);
  }
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  if (line.trim() === "") return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stderr.write("piano-mcp: ignored malformed JSON\n");
    return;
  }
  void handle(message).catch((cause) => {
    process.stderr.write(`piano-mcp: ${errorMessage(cause)}\n`);
  });
});

function shutdown() {
  for (const state of runs.values()) {
    if (state.child !== undefined && state.status === "running") state.child.kill();
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
