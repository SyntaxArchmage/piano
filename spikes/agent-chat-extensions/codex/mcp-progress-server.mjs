#!/usr/bin/env node
/* global process, setTimeout */
// Minimal MCP stdio server for the Codex negative-confirmation spike.
//
// Exposes one tool, `slow_echo`, that runs for N seconds and emits:
//   - notifications/progress every second (rate-limited progress signal)
//   - notifications/message (MCP logging) every second
//
// The point is to prove whether any of these reach the Codex TUI main transcript.
// The server itself is plain JSON-RPC 2.0 over newline-delimited stdio.
//
// Env:
//   MCP_SPIKE_LOG  optional path to append every inbound/outbound message

import fs from "node:fs";
import readline from "node:readline";

const LOG = process.env.MCP_SPIKE_LOG || "";
const DEFAULT_SECONDS = Number(process.env.MCP_SPIKE_SECONDS || 12);

function log(dir, obj) {
  if (!LOG) return;
  fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), dir, ...obj }) + "\n");
}

function send(obj) {
  log("out", obj);
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

const TOOL = {
  name: "slow_echo",
  description:
    "Runs for several seconds, emitting MCP progress and log notifications. Used to test whether Codex renders them in the main transcript.",
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string" },
      seconds: { type: "number" },
    },
    additionalProperties: false,
  },
};

async function runSlowTool(params, id) {
  const args = params?.arguments || {};
  const message = String(args.message ?? "piano-spike");
  const seconds = Math.max(1, Number(args.seconds ?? DEFAULT_SECONDS));
  const progressToken = params?._meta?.progressToken ?? "piano-spike";
  const started = Date.now();

  send({
    jsonrpc: "2.0",
    method: "notifications/message",
    params: {
      level: "info",
      logger: "piano-spike",
      data: `slow_echo started (${seconds}s, token=${String(progressToken)})`,
    },
  });

  for (let tick = 1; tick <= seconds; tick++) {
    await new Promise((r) => setTimeout(r, 1000));
    send({
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: {
        progressToken,
        progress: tick,
        total: seconds,
        message: `PIANO-PROGRESS-LINE ${tick}/${seconds}: ${message}`,
      },
    });
    send({
      jsonrpc: "2.0",
      method: "notifications/message",
      params: {
        level: "info",
        logger: "piano-spike",
        data: `PIANO-LOG-LINE ${tick}/${seconds}: ${message}`,
      },
    });
  }

  send({
    jsonrpc: "2.0",
    id,
    result: textResult(
      `slow_echo finished after ${((Date.now() - started) / 1000).toFixed(1)}s. ` +
        `Progress and log notifications were emitted; check whether the host rendered them.`,
    ),
  });
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  log("in", msg);

  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {}, logging: {} },
        serverInfo: { name: "piano-spike-mcp", version: "0.0.1" },
      },
    });
    return;
  }
  if (msg.method === "notifications/initialized") return;
  if (msg.method === "tools/list") {
    send({ jsonrpc: "2.0", id: msg.id, result: { tools: [TOOL] } });
    return;
  }
  if (msg.method === "tools/call") {
    if (msg.params?.name !== TOOL.name) {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32602, message: `unknown tool ${msg.params?.name}` },
      });
      return;
    }
    await runSlowTool(msg.params, msg.id);
    return;
  }
  if (typeof msg.id !== "undefined") {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
  }
});

process.stderr.write("piano-spike-mcp ready\n");
