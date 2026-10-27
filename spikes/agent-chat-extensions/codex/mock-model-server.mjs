#!/usr/bin/env node
/* global process, console, Buffer */
// Minimal OpenAI Responses API mock used by the Codex spike.
//
// Purpose: let `codex app-server` / `codex exec` run a real model turn with no
// credentials and no network. It is NOT a Piano component and must stay test-only.
//
// Behaviour:
// - First request for a turn: if a tool named like the spike MCP tool is offered,
//   stream a function_call that invokes it (so MCP progress notifications fire).
// - After the tool output comes back: stream a short final assistant message.
// - Requests without tools: stream a short assistant message immediately.
//
// Env:
//   MOCK_MODEL_PORT  listen port (default 18080)
//   MOCK_MODEL_LOG   optional path to append one JSON line per request (bodies logged)

import http from "node:http";
import fs from "node:fs";

const PORT = Number(process.env.MOCK_MODEL_PORT || 18080);
const LOG = process.env.MOCK_MODEL_LOG || "";

function log(obj) {
  if (!LOG) return;
  fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...obj }) + "\n");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sse(res, event) {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function messageItem(id, text, status) {
  const content = status === "completed"
    ? [{ type: "output_text", text, annotations: [] }]
    : [];
  return { id, type: "message", status, role: "assistant", content };
}

function responseObject(id, status, output, usage) {
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status,
    model: "mock-model",
    output,
    parallel_tool_calls: false,
    tool_choice: "auto",
    tools: [],
    usage: usage || null,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: {},
    temperature: 0,
    top_p: 1,
  };
}

function streamText(res, text, responseId) {
  const itemId = `msg_${responseId}`;
  sse(res, {
    type: "response.created",
    response: responseObject(responseId, "in_progress", [], null),
  });
  sse(res, {
    type: "response.output_item.added",
    output_index: 0,
    item: messageItem(itemId, "", "in_progress"),
  });
  sse(res, {
    type: "response.content_part.added",
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: "", annotations: [] },
  });
  for (const piece of text.match(/.{1,12}/gs) || [text]) {
    sse(res, {
      type: "response.output_text.delta",
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      delta: piece,
    });
  }
  sse(res, {
    type: "response.output_text.done",
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    text,
  });
  const part = { type: "output_text", text, annotations: [] };
  sse(res, {
    type: "response.content_part.done",
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    part,
  });
  const completed = messageItem(itemId, text, "completed");
  sse(res, { type: "response.output_item.done", output_index: 0, item: completed });
  sse(res, {
    type: "response.completed",
    response: responseObject(responseId, "completed", [completed], {
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 10,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 20,
    }),
  });
  res.end();
}

function streamToolCall(res, tool, args, responseId) {
  const itemId = `fc_${responseId}`;
  const callId = `call_${responseId}`;
  const item = {
    id: itemId,
    type: "function_call",
    status: "in_progress",
    name: tool.name,
    namespace: tool.namespace,
    arguments: "",
    call_id: callId,
  };
  sse(res, {
    type: "response.created",
    response: responseObject(responseId, "in_progress", [], null),
  });
  sse(res, { type: "response.output_item.added", output_index: 0, item });
  const argsText = JSON.stringify(args);
  sse(res, {
    type: "response.function_call_arguments.delta",
    item_id: itemId,
    output_index: 0,
    namespace: tool.namespace,
    delta: argsText,
  });
  sse(res, {
    type: "response.function_call_arguments.done",
    item_id: itemId,
    output_index: 0,
    namespace: tool.namespace,
    arguments: argsText,
  });
  const completed = { ...item, status: "completed", arguments: argsText };
  sse(res, { type: "response.output_item.done", output_index: 0, item: completed });
  sse(res, {
    type: "response.completed",
    response: responseObject(responseId, "completed", [completed], {
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 5,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 15,
    }),
  });
  res.end();
}

function findTool(body) {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  for (const t of tools) {
    if (t.type === "namespace" && Array.isArray(t.tools)) {
      for (const sub of t.tools) {
        if ((sub.name || "").includes("slow_echo")) {
          return { name: sub.name, namespace: t.name };
        }
      }
    }
    const name = t.name || t.function?.name || "";
    if (name.includes("slow_echo")) return { name, namespace: undefined };
  }
  return null;
}

function latestUserText(body) {
  const input = Array.isArray(body.input) ? body.input : [];
  for (let i = input.length - 1; i >= 0; i--) {
    const item = input[i];
    if (item?.role === "user" && Array.isArray(item.content)) {
      return item.content.map((c) => c.text || "").join(" ");
    }
  }
  return "";
}

function wantsSlowTool(body) {
  return /slow[ _-]?echo/i.test(latestUserText(body));
}

function hasToolOutput(body) {
  const input = Array.isArray(body.input) ? body.input : [];
  return input.some((i) => i && (i.type === "function_call_output" || i.type === "custom_tool_call_output"));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url.endsWith("/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [{ id: "mock-model", object: "model" }] }));
    return;
  }
  if (req.method !== "POST" || !req.url.endsWith("/responses")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: `unexpected ${req.method} ${req.url}` } }));
    return;
  }
  const raw = await readBody(req);
  let body = {};
  try { body = JSON.parse(raw || "{}"); } catch { /* keep empty */ }
  log({ url: req.url, headers: req.headers, body });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();

  const responseId = `resp_${Date.now()}`;
  const toolName = wantsSlowTool(body) ? findTool(body) : null;
  if (toolName && !hasToolOutput(body)) {
    streamToolCall(res, toolName, { message: "piano-spike", seconds: 12 }, responseId);
  } else {
    const inputJson = JSON.stringify(body.input ?? body.messages ?? null);
    const seesInjected = inputJson.includes("PIANO-INJECT-MARKER");
    streamText(
      res,
      hasToolOutput(body)
        ? "Mock model: the slow MCP tool finished. No progress text was rendered by the host."
        : seesInjected
          ? "Mock model sees the injected PIANO-INJECT-MARKER in its input history."
          : `Mock model reply to: ${inputJson.slice(0, 120)}`,
      responseId,
    );
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock-model-server listening on http://127.0.0.1:${PORT}/v1`);
});
