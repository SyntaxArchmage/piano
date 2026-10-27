// dsh spike host plugin: register a `piano_spike` tool that spawns a heartbeat
// child and (optionally) a real `piano -p --json` run, projecting both into the
// calling agent's Session as log-only events. The model only ever sees the
// tool's final text; the browser-side client plugin in ./client.js turns those
// events into a custom Chat node.
//
// Written as plain ESM with no @deepseek-ai imports: a profile mounted plugin
// loaded by absolute path cannot rely on the dsh installation's node_modules
// being reachable from this repository checkout. The tool definition object is
// the same plain shape `defineTool()` returns.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

/** Cordis plugin name. */
export const name = "piano-spike";
/** This plugin registers one model-facing tool. */
export const inject = ["tools"];

/**
 * SPIKE-ONLY WORKAROUND. dsh-session's cold loader refuses a persisted event
 * whose type is absent from its closed KNOWN_SESSION_EVENT_TYPES set unless
 * the persisted envelope carries `ignorable: true`; the public
 * `Session.append()` API cannot set that marker, and third-party plugins have
 * no vocabulary-registration seam. Without this patch the node renders live
 * but the session fails to load after a restart ("unknown event type ... not
 * marked ignorable"). The set is exported and mutable, so the spike adds its
 * three types to prove the rest of the path; a shipped plugin would need a
 * first-party event-vocabulary registration API instead. Resolution goes
 * through the dsh entry point because this plugin lives outside the dsh
 * installation's node_modules tree.
 */
const SPIKE_EVENT_TYPES = ["piano-spike/run-start", "piano-spike/progress", "piano-spike/run-end"];

async function extendKnownSessionEventTypes(ctx) {
  if (process.env.PIANO_SPIKE_SKIP_VOCABULARY_PATCH === "1") {
    ctx.logger?.info?.("piano-spike: vocabulary patch disabled by PIANO_SPIKE_SKIP_VOCABULARY_PATCH=1");
    return;
  }
  try {
    const dshEntry = process.argv[1];
    if (typeof dshEntry !== "string") throw new Error("process.argv[1] is absent");
    const requireFromDsh = createRequire(realpathSync(dshEntry));
    const sessionEntry = requireFromDsh.resolve("@deepseek-ai/dsh-session");
    const sessionModule = await import(pathToFileURL(sessionEntry).href);
    const known = sessionModule.KNOWN_SESSION_EVENT_TYPES;
    if (!(known instanceof Set)) throw new Error("KNOWN_SESSION_EVENT_TYPES is not a Set");
    for (const type of SPIKE_EVENT_TYPES) known.add(type);
    ctx.logger?.info?.(`piano-spike: extended Session event vocabulary with ${SPIKE_EVENT_TYPES.length} types`);
  } catch (error) {
    ctx.logger?.warn?.(`piano-spike: could not extend the Session event vocabulary; cold reload will reject the spike log: ${String(error)}`);
  }
}

const TOOL_NAME = "piano_spike";
const TOOL_DESCRIPTION = [
  "Spike tool that demonstrates live, log-only progress beside a durable tool result.",
  "It pulses a heartbeat child for about 10 seconds, then optionally runs",
  '`piano -p --json --workflow <workflowPath> "<prompt>"` and returns only the final Piano text.',
].join(" ");

const DEFAULT_HEARTBEAT_MS = 1000;
const DEFAULT_HEARTBEAT_COUNT = 10;
/** At most ~5 progress appends per second reach the Session log. */
const PROGRESS_MIN_INTERVAL_MS = 200;
/** Keep one progress line short; Piano's cumulative message_update lines can be huge. */
const MAX_LINE_CHARS = 240;

/** Clamp one display line to a bounded tail. */
function clipLine(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= MAX_LINE_CHARS ? text : `…${text.slice(-(MAX_LINE_CHARS - 1))}`;
}

/** Extract the latest assistant text out of one Piano `agent_event` line. */
function assistantTextOf(event) {
  const message = event?.data?.message;
  const blocks = Array.isArray(message?.content) ? message.content : [];
  for (const block of blocks) {
    if (block?.type === "text" && typeof block.text === "string") return block.text;
  }
  return "";
}

/** Describe one NDJSON line from `piano -p --json`. */
function describePianoEvent(line) {
  if (line?.event === "run.started") {
    return { phase: "piano", line: `piano run started ${line.run_id ?? ""}`, terminal: "started" };
  }
  if (line?.event === "run.completed") {
    return {
      phase: "piano",
      line: `piano run completed (${line.status ?? "completed"})`,
      terminal: "completed",
      text: typeof line.text === "string" ? line.text : "",
    };
  }
  if (line?.event === "run.failed") {
    return {
      phase: "piano",
      line: `piano run failed: ${line.code ?? "error"}: ${line.error ?? ""}`,
      terminal: "failed",
    };
  }
  if (line?.event !== "agent_event") return { phase: "piano", line: clipLine(JSON.stringify(line)) };
  if (line.type === "message_update") {
    return { phase: "piano", line: clipLine(assistantTextOf(line) || "assistant message updated") };
  }
  if (line.type === "tool_execution_start") {
    return { phase: "piano", line: clipLine(`tool started: ${line.data?.toolName ?? "unknown"}`) };
  }
  if (line.type === "tool_execution_end") {
    return { phase: "piano", line: clipLine(`tool ended: ${line.data?.toolName ?? "unknown"}`) };
  }
  if (line.type === "resource") {
    const resource = line.data?.resource;
    return {
      phase: "piano",
      line: clipLine(`resource ${resource?.kind ?? "unknown"}: ${resource?.status ?? "unknown"}`),
    };
  }
  return { phase: "piano", line: clipLine(`event ${line.type ?? "agent_event"}`) };
}

/** Spawn the heartbeat child and forward each tick. */
function heartbeat({ intervalMs, count, onTick, registerChild, signal }) {
  return new Promise((resolve, reject) => {
    const script = `
      let index = 0;
      const timer = setInterval(() => {
        index += 1;
        console.log(JSON.stringify({ index, elapsedMs: index * ${Math.max(1, intervalMs)} }));
        if (index >= ${Math.max(1, count)}) clearInterval(timer);
      }, ${Math.max(1, intervalMs)});
    `;
    const child = spawn(process.execPath, ["-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    registerChild(child);
    const reader = createInterface({ input: child.stdout });
    let ticks = 0;
    reader.on("line", (line) => {
      let tick;
      try {
        tick = JSON.parse(line);
      } catch {
        return;
      }
      ticks += 1;
      onTick(tick);
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-2000);
    });
    child.on("error", reject);
    child.on("close", (code, signalName) => {
      if (signal.aborted) resolve({ ticks, cancelled: true });
      else if (code === 0) resolve({ ticks });
      else reject(new Error(`heartbeat child exited ${code ?? signalName}${stderr === "" ? "" : `: ${stderr.trim()}`}`));
    });
  });
}

/** Spawn one real Piano headless run and forward parsed NDJSON events. */
function pianoRun({ command, args, cwd, onEvent, registerChild, signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    registerChild(child);
    const reader = createInterface({ input: child.stdout });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4000);
    });
    let result;
    reader.on("line", (raw) => {
      if (!raw.startsWith("{")) return;
      let line;
      try {
        line = JSON.parse(raw);
      } catch {
        return;
      }
      const described = describePianoEvent(line);
      if (described.terminal === "completed") {
        result = { status: "completed", text: described.text ?? "" };
      } else if (described.terminal === "failed") {
        result = { status: "failed", text: described.line };
      }
      onEvent(described);
    });
    child.on("error", reject);
    child.on("close", (code, signalName) => {
      if (signal.aborted) {
        resolve({ status: "cancelled", text: "piano_spike cancelled" });
        return;
      }
      if (code === 0 && result?.status === "completed") {
        resolve(result);
        return;
      }
      const detail = result?.text || stderr.trim() || `exited ${code ?? signalName}`;
      resolve({ status: "failed", text: `piano run failed: ${detail}` });
    });
  });
}

/** Append Session events without letting a recording failure affect the tool. */
function createRecorder(ctx, session) {
  let disabled = false;
  return (type, data) => {
    if (disabled) return;
    try {
      session.append(type, data);
    } catch (error) {
      disabled = true;
      try {
        ctx.logger.warn(`piano-spike: disabled durable record after ${type} append failed: ${String(error)}`);
      } catch {
        // Logging is best-effort only.
      }
    }
  };
}

/** Build the tool definition; exported for tests and the client-side contract. */
export function createToolDefinition(ctx) {
  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: {
          type: "string",
          description: 'Prompt for the Piano run; defaults to "print OK".',
        },
        workflowPath: {
          type: "string",
          description: "Absolute path of a Piano workflow YAML; when set, a real Piano run follows the heartbeat.",
        },
        runPiano: {
          type: "boolean",
          description: "Force or suppress the Piano run; defaults to true when workflowPath is present.",
        },
        heartbeatMs: {
          type: "integer",
          description: `Heartbeat interval in milliseconds (default ${DEFAULT_HEARTBEAT_MS}).`,
        },
        heartbeatCount: {
          type: "integer",
          description: `Heartbeat tick count (default ${DEFAULT_HEARTBEAT_COUNT}).`,
        },
        cwd: {
          type: "string",
          description: "Working directory for the Piano child; defaults to the dsh process cwd.",
        },
        pianoBin: {
          type: "string",
          description: 'Piano executable (default "piano").',
        },
      },
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: String(value) }],
    },
    async execute(args, exec) {
      const agent = exec.agent;
      if (agent === undefined) throw new Error("piano_spike requires a calling agent (exec.agent was undefined)");
      const session = agent.session;
      const runId = randomUUID();
      const record = createRecorder(ctx, session);
      const heartbeatMs = Math.max(1, Number.isSafeInteger(args.heartbeatMs) ? args.heartbeatMs : DEFAULT_HEARTBEAT_MS);
      const heartbeatCount = Math.max(1, Number.isSafeInteger(args.heartbeatCount) ? args.heartbeatCount : DEFAULT_HEARTBEAT_COUNT);
      const prompt = typeof args.prompt === "string" && args.prompt.length > 0 ? args.prompt : "print OK";
      const workflowPath = typeof args.workflowPath === "string" && args.workflowPath.length > 0 ? args.workflowPath : undefined;
      const runPiano = args.runPiano ?? (workflowPath !== undefined);
      const cwd = typeof args.cwd === "string" && args.cwd.length > 0 ? args.cwd : process.cwd();
      const pianoBin = typeof args.pianoBin === "string" && args.pianoBin.length > 0 ? args.pianoBin : "piano";

      const children = new Set();
      const registerChild = (child) => {
        children.add(child);
        child.once("close", () => children.delete(child));
      };
      const killChildren = () => {
        for (const child of children) {
          try {
            child.kill("SIGTERM");
          } catch {
            // Already gone.
          }
        }
      };
      const onAbort = () => killChildren();
      exec.signal.addEventListener("abort", onAbort, { once: true });

      let lastProgressAt = 0;
      let droppedProgress = 0;
      let lineCount = 0;
      const progress = (phase, line, force = false) => {
        lineCount += 1;
        const now = Date.now();
        if (!force && now - lastProgressAt < PROGRESS_MIN_INTERVAL_MS) {
          droppedProgress += 1;
          return;
        }
        lastProgressAt = now;
        record("piano-spike/progress", { runId, phase, line: clipLine(line), dropped: droppedProgress });
        droppedProgress = 0;
      };

      record("piano-spike/run-start", {
        runId,
        prompt,
        workflowPath: workflowPath ?? null,
        heartbeatMs,
        heartbeatCount,
        runPiano,
      });

      let status = "completed";
      let finalText = "";
      try {
        const beat = await heartbeat({
          intervalMs: heartbeatMs,
          count: heartbeatCount,
          signal: exec.signal,
          registerChild,
          onTick: (tick) => progress("heartbeat", `heartbeat ${tick.index}/${heartbeatCount} (+${tick.elapsedMs}ms)`),
        });
        if (beat.cancelled || exec.signal.aborted) throw new Error("cancelled");
        progress("heartbeat", `heartbeat complete (${beat.ticks} ticks)`, true);

        if (runPiano) {
          const run = await pianoRun({
            command: pianoBin,
            args: ["-p", "--json", ...(workflowPath === undefined ? [] : ["--workflow", workflowPath]), prompt],
            cwd,
            signal: exec.signal,
            registerChild,
            onEvent: (event) => progress(event.phase, event.line),
          });
          status = run.status;
          finalText = run.text;
        } else {
          finalText = `piano_spike heartbeat completed (${beat.ticks} ticks); no Piano run requested.`;
        }
      } catch (error) {
        status = exec.signal.aborted ? "cancelled" : "failed";
        finalText = `piano_spike ${status}: ${error instanceof Error ? error.message : String(error)}`;
        progress(status, finalText, true);
      } finally {
        exec.signal.removeEventListener("abort", onAbort);
        record("piano-spike/run-end", {
          runId,
          status,
          text: clipLine(finalText),
          lines: lineCount,
          dropped: droppedProgress,
        });
      }
      return typeof finalText === "string" ? finalText : String(finalText ?? "");
    },
  };
}

/** Register the tool. */
export async function apply(ctx) {
  await extendKnownSessionEventTypes(ctx);
  ctx.tools.register(createToolDefinition(ctx));
}
