// Deterministic OpenAI-compatible (DeepSeek chat-completions) stand-in used by
// the dsh spike to drive one model turn without a real provider:
//   turn 1  -> tool call `piano_spike` (only when that tool is offered)
//   turn 2  -> final assistant text after the tool result
//   titles  -> plain text
//
// Env:
//   SPIKE_PORT           listen port (default 0 = OS-assigned)
//   SPIKE_WORKFLOW_PATH  absolute workflow path handed to piano_spike
//   SPIKE_REQUEST_LOG    append one JSON summary line per request
//   SPIKE_FINAL_TEXT     final assistant text (default "OK")
//
// Stdout is one JSON line: {"port": <assigned>}.

import { createServer } from "node:http";
import { appendFileSync } from "node:fs";

const port = Number(process.env.SPIKE_PORT ?? "0");
const workflowPath = process.env.SPIKE_WORKFLOW_PATH ?? "";
const requestLog = process.env.SPIKE_REQUEST_LOG ?? "";
const finalText = process.env.SPIKE_FINAL_TEXT ?? "OK";

/** Last text content of one wire message. */
function messageText(message) {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join(" ");
}

/** Identify the auxiliary session-title request from its fixed system prompt. */
function isTitleRequest(body) {
  return (body.messages ?? []).some(
    (message) => message.role === "system" && messageText(message).includes("Create a concise title"),
  );
}

/** Append one request summary for post-run evidence. */
function logRequest(body, decision) {
  if (requestLog === "") return;
  const summary = {
    at: new Date().toISOString(),
    model: body.model,
    decision,
    stream: body.stream,
    hasTools: Array.isArray(body.tools) && body.tools.length > 0,
    toolNames: (body.tools ?? []).map((tool) => tool?.function?.name).filter(Boolean),
    roles: (body.messages ?? []).map((message) => message.role),
    lastUserText: messageText((body.messages ?? []).filter((message) => message.role === "user").at(-1)).slice(0, 300),
    lastToolText: messageText((body.messages ?? []).filter((message) => message.role === "tool").at(-1)).slice(0, 500),
  };
  appendFileSync(requestLog, `${JSON.stringify(summary)}\n`);
}

function sseChunk(res, delta, finishReason = null, usage = undefined) {
  const payload = {
    id: "chatcmpl-spike",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "deepseek-flash",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage === undefined ? {} : { usage }),
  };
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function streamToolCall(res) {
  sseChunk(res, { role: "assistant", content: "" });
  sseChunk(res, {
    tool_calls: [
      {
        index: 0,
        id: "call_piano_spike_1",
        type: "function",
        function: {
          name: "piano_spike",
          arguments: JSON.stringify({
            prompt: "print OK",
            ...(workflowPath === "" ? {} : { workflowPath }),
          }),
        },
      },
    ],
  });
  sseChunk(res, {}, "tool_calls", {
    prompt_tokens: 100,
    completion_tokens: 20,
    total_tokens: 120,
  });
  res.write("data: [DONE]\n\n");
  res.end();
}

function streamText(res, text) {
  sseChunk(res, { role: "assistant", content: "" });
  sseChunk(res, { content: text });
  sseChunk(res, {}, "stop", {
    prompt_tokens: 100,
    completion_tokens: 5,
    total_tokens: 105,
  });
  res.write("data: [DONE]\n\n");
  res.end();
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url?.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        object: "list",
        data: [{ id: "deepseek-flash", object: "model", owned_by: "spike" }],
      }),
    );
    return;
  }
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
    return;
  }
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid json" } }));
      return;
    }
    const toolNames = (body.tools ?? []).map((tool) => tool?.function?.name);
    const hasToolResult = (body.messages ?? []).some((message) => message.role === "tool");
    if (isTitleRequest(body)) {
      logRequest(body, "title-text");
      streamText(res, "Piano dsh spike");
      return;
    }
    if (!hasToolResult && toolNames.includes("piano_spike")) {
      logRequest(body, "tool-call:piano_spike");
      streamToolCall(res);
      return;
    }
    logRequest(body, "final-text");
    streamText(res, finalText);
  });
});

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(`${JSON.stringify({ port: typeof address === "object" && address !== null ? address.port : port })}\n`);
});
