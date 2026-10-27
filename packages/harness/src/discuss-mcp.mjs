#!/usr/bin/env node
// Piano's stdio MCP server for the `discuss` stage flag.
//
// Claude and dsh launch this beside the worker. It speaks the small part of
// MCP they need, and forwards a question over a loopback TCP bridge to the
// Piano process that owns the TUI channel. Protocol bytes go to stdout only;
// diagnostics stay on stderr so a malformed child never corrupts MCP.
import { connect } from "node:net";
import { createInterface } from "node:readline";

const PROTOCOL_VERSION = "2025-06-18";
const TOOL_NAME = "discuss";
const MAX_QUESTION_CHARS = 16_000;

const bridgeUrl = process.env.PIANO_DISCUSS_URL;
const bridgeToken = process.env.PIANO_DISCUSS_TOKEN;

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function bridgeTarget() {
  if (typeof bridgeUrl !== "string") return undefined;
  const match = /^tcp:\/\/([^:]+):(\d+)$/u.exec(bridgeUrl);
  if (match === null) return undefined;
  return { host: match[1], port: Number(match[2]) };
}

function errorMessage(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}

/** One question over a fresh loopback connection. The bridge answers exactly
 * one line; a closed connection before that line is a tool failure, not a
 * silent default answer. */
function askSupervisor(question) {
  const target = bridgeTarget();
  if (target === undefined || typeof bridgeToken !== "string" || bridgeToken === "") {
    return Promise.reject(new Error("Piano's discussion bridge is not configured"));
  }
  return new Promise((resolve, reject) => {
    const socket = connect({ host: target.host, port: target.port });
    let buffer = "";
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn(value);
    };
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ token: bridgeToken, question })}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline).trim();
      try {
        const answer = JSON.parse(line);
        if (typeof answer?.answer === "string") finish(resolve, answer.answer);
        else if (typeof answer?.error === "string") finish(reject, new Error(answer.error));
        else finish(reject, new Error("Piano's discussion bridge returned no answer"));
      } catch (cause) {
        finish(reject, new Error(`Piano's discussion bridge returned invalid JSON: ${errorMessage(cause)}`));
      }
    });
    socket.on("error", (cause) => finish(reject, cause));
    socket.on("close", () => {
      if (!settled) finish(reject, new Error("Piano's discussion bridge closed before an answer"));
    });
  });
}

const tool = {
  name: TOOL_NAME,
  description:
    "Ask the supervisor one focused question. The answer is guidance, not approval; continue the task after receiving it.",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string", description: "One focused question for the supervisor." },
    },
    required: ["question"],
    additionalProperties: false,
  },
};

async function handle(message) {
  const id = message?.id;
  const method = message?.method;
  if (typeof method !== "string") return;
  if (method === "initialize") {
    if (id !== undefined) {
      sendResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "piano-discuss", version: "0.1.0" },
      });
    }
    return;
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (method === "ping") {
    if (id !== undefined) sendResult(id, {});
    return;
  }
  if (method === "tools/list") {
    if (id !== undefined) sendResult(id, { tools: [tool] });
    return;
  }
  if (method === "tools/call") {
    const name = message?.params?.name;
    const question = message?.params?.arguments?.question;
    if (name !== TOOL_NAME) {
      if (id !== undefined) sendError(id, -32602, `unknown tool: ${String(name)}`);
      return;
    }
    if (typeof question !== "string" || question.trim() === "") {
      if (id !== undefined) sendResult(id, {
        content: [{ type: "text", text: "discuss requires a non-empty question" }],
        isError: true,
      });
      return;
    }
    if (question.length > MAX_QUESTION_CHARS) {
      if (id !== undefined) sendResult(id, {
        content: [{ type: "text", text: `question exceeds ${MAX_QUESTION_CHARS} characters` }],
        isError: true,
      });
      return;
    }
    try {
      const answer = await askSupervisor(question);
      if (id !== undefined) sendResult(id, { content: [{ type: "text", text: answer }] });
    } catch (cause) {
      if (id !== undefined) sendResult(id, {
        content: [{ type: "text", text: `discuss failed: ${errorMessage(cause)}` }],
        isError: true,
      });
    }
    return;
  }
  if (id !== undefined) sendError(id, -32601, `unknown method: ${method}`);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  if (line.trim() === "") return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stderr.write("piano-discuss: ignored malformed JSON\n");
    return;
  }
  void handle(message).catch((cause) => {
    process.stderr.write(`piano-discuss: ${errorMessage(cause)}\n`);
  });
});
