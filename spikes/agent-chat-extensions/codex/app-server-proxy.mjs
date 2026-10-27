#!/usr/bin/env node
/* global process, console, setTimeout, setInterval, clearInterval, fetch */
// Experimental app-server proxy for the Codex spike.
//
//   codex --remote ws://127.0.0.1:18902   ->   this proxy   ->   codex app-server
//
// It forwards every JSON-RPC frame both ways. When a turn starts, it also
// injects synthetic `item/agentMessage/delta` notifications into the TUI
// connection, carrying Piano-style progress text, and observes whether the
// official TUI renders them as assistant main text.
//
// This stands in the app-server role. It is NOT a supported Codex extension,
// will break with protocol changes, and must not be shipped as a default path.
//
// Env:
//   CODEX_HOME          required; temp home
//   PROXY_PORT          default 18902
//   REAL_PORT           default 18901
//   INJECT_TICKS        default 8
//   INJECT_INTERVAL_MS  default 1000
//   PROXY_TRACE         optional JSONL trace path

import { spawn } from "node:child_process";
import fs from "node:fs";
import { WebSocket, WebSocketServer } from "ws";

const CODEX_HOME = process.env.CODEX_HOME;
if (!CODEX_HOME) {
  console.error("CODEX_HOME is required");
  process.exit(2);
}
const PROXY_PORT = Number(process.env.PROXY_PORT || 18902);
const REAL_PORT = Number(process.env.REAL_PORT || 18901);
const REWRITE_COMPLETED = process.env.PROXY_REWRITE_COMPLETED !== "0";
const TICKS = Number(process.env.INJECT_TICKS || 8);
const INTERVAL = Number(process.env.INJECT_INTERVAL_MS || 1000);
const TRACE = process.env.PROXY_TRACE || "";
const CODEX_BIN = process.env.CODEX_BIN || "codex";

function trace(obj) {
  if (!TRACE) return;
  fs.appendFileSync(TRACE, JSON.stringify({ at: new Date().toISOString(), ...obj }) + "\n");
}

const child = spawn(CODEX_BIN, ["app-server", "--listen", `ws://127.0.0.1:${REAL_PORT}`], {
  env: { ...process.env, CODEX_HOME },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (d) => process.stderr.write(`[real] ${d}`));
child.stderr.on("data", (d) => process.stderr.write(`[real] ${d}`));

async function waitForReal(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${REAL_PORT}/healthz`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("real app-server did not become healthy");
}

const clients = new Set();

function sendToTui(client, obj) {
  if (client.readyState === WebSocket.OPEN) {
    const text = JSON.stringify(obj);
    trace({ dir: "inject", frame: obj });
    client.send(text);
  }
}

const injections = new Map(); // client -> Map(turnId -> timer info)

function startInjection(client, threadId, turnId) {
  let perTurn = injections.get(client);
  if (!perTurn) {
    perTurn = new Map();
    injections.set(client, perTurn);
  }
  if (perTurn.has(turnId)) return;
  const itemId = `piano_proxy_${turnId}`;
  let n = 0;
  const info = { timer: null, threadId, turnId, itemId, text: "" };
  const timer = setInterval(() => {
    n += 1;
    const delta = `PIANO-PROXY ${n}/${TICKS}: progress injected by app-server proxy\n`;
    info.text += delta;
    sendToTui(client, {
      jsonrpc: "2.0",
      method: "item/agentMessage/delta",
      params: { threadId, turnId, itemId, delta },
    });
    if (n >= TICKS) {
      // Keep the info until turn/completed so the proxy can append the
      // synthetic item to the authoritative turn payload.
      clearInterval(timer);
      info.done = true;
    }
  }, INTERVAL);
  info.timer = timer;
  perTurn.set(turnId, info);
  console.error(`[proxy] injecting ${TICKS} deltas into thread=${threadId} turn=${turnId}`);
}

function stopInjection(client, turnId) {
  const perTurn = injections.get(client);
  if (!perTurn) return;
  const info = perTurn.get(turnId);
  if (!info) return;
  clearInterval(info.timer);
  perTurn.delete(turnId);
  if (perTurn.size === 0) injections.delete(client);
}

function stopAllInjections(client) {
  const perTurn = injections.get(client);
  if (!perTurn) return;
  for (const info of perTurn.values()) clearInterval(info.timer);
  injections.delete(client);
}

await waitForReal();

const wss = new WebSocketServer({ host: "127.0.0.1", port: PROXY_PORT });
console.error(`[proxy] listening on ws://127.0.0.1:${PROXY_PORT} -> ws://127.0.0.1:${REAL_PORT}`);

wss.on("connection", (client, req) => {
  console.error(`[proxy] TUI connected from ${req.socket.remoteAddress}`);
  clients.add(client);
  const upstream = new WebSocket(`ws://127.0.0.1:${REAL_PORT}/`);
  const queued = [];

  upstream.on("open", () => {
    while (queued.length) upstream.send(queued.shift());
  });

  client.on("message", (data) => {
    const text = data.toString();
    trace({ dir: "client->real", raw: text.slice(0, 4000) });
    if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
    else queued.push(text);
  });

  upstream.on("message", (data) => {
    const text = data.toString();
    trace({ dir: "real->client", raw: text.slice(0, 4000) });
    let msg;
    try { msg = JSON.parse(text); } catch {
      if (client.readyState === WebSocket.OPEN) client.send(text);
      return;
    }

    let outbound = text;
    if (msg.method === "turn/started") {
      startInjection(client, msg.params.threadId, msg.params.turn.id);
    } else if (msg.method === "turn/completed") {
      // Keep the synthetic assistant item in the TUI's authoritative turn
      // payload; otherwise the TUI drops it when the turn completes.
      const perTurn = injections.get(client);
      const info = perTurn?.get(msg.params.turn?.id);
      if (REWRITE_COMPLETED && info && Array.isArray(msg.params.turn.items)) {
        msg.params.turn.items.push({
          id: info.itemId,
          type: "agentMessage",
          text: info.text,
          phase: null,
          memoryCitation: null,
          delivery: null,
          questions: null,
        });
        msg.params.turn.itemsView = "full";
        outbound = JSON.stringify(msg);
        trace({ dir: "rewritten", frame: msg });
      }
      stopInjection(client, msg.params.turn.id);
    }
    if (client.readyState === WebSocket.OPEN) client.send(outbound);
  });

  const cleanup = () => {
    clients.delete(client);
    stopAllInjections(client);
    try { upstream.close(); } catch { /* ignore */ }
  };
  client.on("close", cleanup);
  client.on("error", (e) => { console.error(`[proxy] client error: ${e.message}`); cleanup(); });
  upstream.on("close", () => { try { client.close(); } catch { /* ignore */ } });
  upstream.on("error", (e) => { console.error(`[proxy] upstream error: ${e.message}`); cleanup(); });
});

process.on("SIGINT", () => { child.kill("SIGTERM"); process.exit(0); });
process.on("SIGTERM", () => { child.kill("SIGTERM"); process.exit(0); });
