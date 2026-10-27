#!/usr/bin/env node
/* global process, console, setTimeout, setInterval, clearInterval, URL */
// Minimal hand-written `codex app-server` client (JSON-RPC over stdio).
//
// Demonstrates:
//   1. initialize -> thread/start -> turn/start
//   2. rendering item/agentMessage/delta as `assistant>` main text
//   3. rendering a Piano-style heartbeat child's NDJSON as `piano>` lines
//      alongside the assistant stream
//   4. calling thread/inject_items and checking whether it produces any
//      client notification or visible thread item (expected: neither; the
//      injected assistant item only becomes model history)
//
// Env:
//   CODEX_HOME        required; must point at a temp Codex home
//   MOCK_API_KEY      required by the mock provider config (any value)
//   CODEX_BIN         default "codex"
//   SPIKE_MODEL       default "mock-model"
//   SPIKE_PROMPT      default "Say a short sentence about a piano."
//   SPIKE_TRACE       optional path to write every JSON-RPC frame
//
// Run: CODEX_HOME=... MOCK_API_KEY=dummy node app-server-client.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";

const CODEX_HOME = process.env.CODEX_HOME;
if (!CODEX_HOME) {
  console.error("CODEX_HOME is required");
  process.exit(2);
}
const CODEX_BIN = process.env.CODEX_BIN || "codex";
const MODEL = process.env.SPIKE_MODEL || "mock-model";
const PROMPT = process.env.SPIKE_PROMPT || "Say a short sentence about a piano.";
const TRACE = process.env.SPIKE_TRACE || "";
const CWD = process.env.SPIKE_CWD || process.cwd();

function trace(dir, msg) {
  if (!TRACE) return;
  fs.appendFileSync(TRACE, JSON.stringify({ at: new Date().toISOString(), dir, msg }) + "\n");
}

const child = spawn(CODEX_BIN, ["app-server", "--listen", "stdio://"], {
  cwd: CWD,
  env: { ...process.env, CODEX_HOME },
  stdio: ["pipe", "pipe", "pipe"],
});

child.stderr.on("data", (d) => process.stderr.write(`[app-server stderr] ${d}`));

const pending = new Map();
let nextId = 1;
const notifications = [];

function send(obj) {
  trace("out", obj);
  child.stdin.write(JSON.stringify(obj) + "\n");
}
function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
    send({ jsonrpc: "2.0", id, method, params });
  });
}
function logNotification(msg) {
  notifications.push(msg);
  trace("in", msg);
  const p = msg.params || {};
  switch (msg.method) {
    case "turn/started":
      console.error(`[event] turn/started thread=${p.threadId} turn=${p.turn?.id}`);
      break;
    case "item/agentMessage/delta":
      process.stdout.write(p.delta);
      break;
    case "item/completed":
      if (p.item?.type === "agentMessage") process.stdout.write("\n");
      console.error(`[event] item/completed type=${p.item?.type}`);
      break;
    case "turn/completed":
      console.error(`[event] turn/completed status=${p.turn?.status}`);
      break;
    default:
      break;
  }
}

const rl = readline.createInterface({ input: child.stdout, terminal: false });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (typeof msg.id !== "undefined" && !msg.method) {
    trace("in", msg);
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${JSON.stringify(msg.error)}`));
      else p.resolve(msg.result);
    }
    return;
  }
  if (msg.method) logNotification(msg);
  else trace("in", msg);
});

function waitForTurnCompleted(turnId, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const done = notifications.find(
        (n) => n.method === "turn/completed" && n.params?.turn?.id === turnId,
      );
      if (done) { clearInterval(timer); resolve(done.params.turn); }
      else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`turn ${turnId} did not complete in ${timeoutMs}ms`));
      }
    }, 50);
  });
}

function waitForTurnStart(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const startedEvent = notifications.findLast((n) => n.method === "turn/started");
      if (startedEvent) { clearInterval(timer); resolve(startedEvent.params); }
      else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error("turn/started did not arrive"));
      }
    }, 50);
  });
}

// Piano-style NDJSON child, rendered by this client next to assistant output.
const heartbeat = spawn(process.execPath, [new URL("./heartbeat-child.mjs", import.meta.url).pathname], {
  env: { ...process.env, HEARTBEAT_TICKS: "8", HEARTBEAT_INTERVAL_MS: "500" },
  stdio: ["ignore", "pipe", "inherit"],
});
const hb = readline.createInterface({ input: heartbeat.stdout, terminal: false });
hb.on("line", (line) => {
  try {
    const ev = JSON.parse(line);
    console.log(`piano> ${ev.text || ev.type}`);
  } catch {
    console.log(`piano> ${line}`);
  }
});

async function main() {
  const init = await request("initialize", {
    clientInfo: { name: "piano-spike-client", title: "Piano Spike", version: "0.0.1" },
    capabilities: { experimentalApi: true },
  });
  console.log(`[init] server=${init.userAgent ?? JSON.stringify(init)}`);

  const threadRes = await request("thread/start", {
    model: MODEL,
    cwd: CWD,
    approvalPolicy: "never",
    sandbox: "read-only",
    config: { model_provider: "mock" },
  });
  const threadId = threadRes.thread.id;
  console.log(`[thread] id=${threadId} model=${threadRes.model} provider=${threadRes.modelProvider}`);

  // --- Turn 1: normal assistant stream -------------------------------------
  const turn1 = await request("turn/start", {
    threadId,
    input: [{ type: "text", text: PROMPT }],
  });
  console.log(`\n[turn 1] id=${turn1.turn.id}; assistant follows:`);
  process.stdout.write("assistant> ");
  const started1 = await waitForTurnStart();
  await waitForTurnCompleted(started1.turn.id);

  // --- thread/inject_items probe -------------------------------------------
  const MARKER = "PIANO-INJECT-MARKER: injected assistant history, not rendered";
  const beforeInjectNotifications = notifications.length;
  const injectRes = await request("thread/inject_items", {
    threadId,
    items: [
      {
        type: "message",
        role: "assistant",
        id: "msg_piano_inject_1",
        content: [{ type: "output_text", text: MARKER }],
      },
    ],
  });
  await new Promise((r) => setTimeout(r, 1000));
  const injectNotifications = notifications.slice(beforeInjectNotifications);
  console.log(`\n[inject] response=${JSON.stringify(injectRes)}`);
  console.log(
    `[inject] notifications emitted for injection: ${injectNotifications.length}` +
      (injectNotifications.length ? ` -> ${injectNotifications.map((n) => n.method).join(", ")}` : " (none)"),
  );

  const listAfterInject = await request("thread/read", { threadId, includeTurns: true });
  const listText = JSON.stringify(listAfterInject);
  console.log(`[inject] injected item id visible in thread/read(includeTurns): ${listText.includes("msg_piano_inject_1")}`);
  console.log(`[inject] thread/read turns: ${listAfterInject.thread?.turns?.length ?? "?"}`);

  // --- Turn 2: does the injected item reach the model? ----------------------
  const turn2 = await request("turn/start", {
    threadId,
    input: [{ type: "text", text: "Repeat the injected marker if you can see it." }],
  });
  console.log(`\n[turn 2] id=${turn2.turn.id}; assistant follows:`);
  process.stdout.write("assistant> ");
  const started2 = await waitForTurnStart();
  await waitForTurnCompleted(started2.turn.id);
  const turn2Text = notifications
    .filter((n) => n.method === "item/agentMessage/delta" && n.params?.turnId === started2.turn.id)
    .map((n) => n.params.delta)
    .join("");
  console.log(`\n[inject] marker reached model on turn 2: ${turn2Text.includes("PIANO-INJECT-MARKER")}`);

  const listAfterTurn2 = await request("thread/read", { threadId, includeTurns: true });
  console.log(
    `[inject] injected item id visible in thread/read after turn 2: ${JSON.stringify(listAfterTurn2).includes("msg_piano_inject_1")}`,
  );

  child.stdin.end();
  child.kill("SIGTERM");
  heartbeat.kill("SIGTERM");
  process.exit(0);
}

main().catch((err) => {
  console.error(`[fatal] ${err.stack || err}`);
  child.kill("SIGTERM");
  heartbeat.kill("SIGTERM");
  process.exit(1);
});
