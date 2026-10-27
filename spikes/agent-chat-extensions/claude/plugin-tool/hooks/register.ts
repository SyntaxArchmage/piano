// Piano native-tool spike for Claude Code.
//
// Registers `piano_run` as a real tool (mcp__piano__piano_run), runs the
// headless Piano CLI, streams its NDJSON as $.ui.log progress, and returns the
// summary/output as the tool result. This is the "tool call, not a log line"
// shape the product should use.
import type { EngineInterface, Register } from "claude-code";

const PREFIX = "[piano]";
const TOOL = "mcp__piano__piano_run";

function splitLines(emit: (line: string) => void): { push: (text: string) => void; flush: () => void } {
  let pending = "";
  return {
    push(text: string): void {
      pending += text;
      for (;;) {
        const newline = pending.indexOf("\n");
        if (newline < 0) return;
        const line = pending.slice(0, newline).replace(/\r$/, "");
        pending = pending.slice(newline + 1);
        if (line.trim() !== "") emit(line);
      }
    },
    flush(): void {
      const line = pending.replace(/\r$/, "");
      pending = "";
      if (line.trim() !== "") emit(line);
    },
  };
}

function eventLine(line: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const event = parsed as Record<string, unknown>;
  if (event["event"] === "run.started") return `${PREFIX} started run ${String(event["run_id"])}`;
  if (event["event"] === "run.completed") return `${PREFIX} completed`;
  if (event["event"] === "run.failed") return `${PREFIX} failed: ${String(event["error"])}`;
  if (event["event"] !== "agent_event") return undefined;
  const data = (typeof event["data"] === "object" && event["data"] !== null ? event["data"] : {}) as Record<string, unknown>;
  const workflow = (typeof data["workflow"] === "object" && data["workflow"] !== null ? data["workflow"] : {}) as Record<string, unknown>;
  const stage = workflow["stageId"] === undefined ? "" : `[${String(workflow["stageId"])}] `;
  if (event["type"] === "tool_execution_start") return `${PREFIX} ${stage}tool ${String(data["toolName"])}`;
  if (event["type"] === "turn_start") return `${PREFIX} ${stage}turn`;
  if (event["type"] === "done") return `${PREFIX} ${stage}done`;
  return undefined;
}

function textOf(record: Record<string, unknown>): string | undefined {
  const text = record["text"];
  if (typeof text === "string") return text;
  const content = record["content"];
  if (Array.isArray(content)) {
    const parts = content
      .filter((block): block is { type: "text"; text: string } =>
        typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string")
      .map((block) => block.text);
    if (parts.length > 0) return parts.join("");
  }
  return undefined;
}

async function runPiano($: EngineInterface, args: Record<string, unknown>): Promise<{ text: string; error?: string }> {
  const prompt = typeof args["prompt"] === "string" ? args["prompt"] : "";
  if (prompt.trim() === "") return { text: "piano_run requires a non-empty prompt", error: "prompt required" };
  const workflow = typeof args["workflow"] === "string" ? args["workflow"] : undefined;
  const cwd = typeof args["cwd"] === "string" ? args["cwd"] : undefined;
  const configured = await $.env.get("PIANO_PIANO_BIN");
  const piano = configured === undefined || configured.trim() === "" ? "piano" : configured;
  const argv = [piano, "-p", "--json"];
  if (workflow !== undefined) argv.push("--workflow", workflow);
  argv.push(prompt);
  let output = "";
  let error: string | undefined;
  const child = $.process.spawn({ argv, ...(cwd === undefined ? {} : { cwd }) });
  const splitter = splitLines((line) => {
    const progress = eventLine(line);
    if (progress !== undefined) $.ui.log(progress);
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed["event"] === "run.completed") output = textOf(parsed) ?? "";
      if (parsed["event"] === "run.failed") error = typeof parsed["error"] === "string" ? parsed["error"] : "Piano run failed";
    } catch {
      // stderr/progress noise is not a protocol line
    }
  });
  for await (const piece of child) {
    if (piece.stream === "stdout") splitter.push(piece.text);
    else if (piece.stream === "stderr") $.ui.log(`${PREFIX} ${piece.text.trim()}`);
  }
  splitter.flush();
  const exit = await child.result;
  if (error !== undefined) return { text: `${PREFIX} failed: ${error}`, error };
  if (exit.code !== 0) return { text: `${PREFIX} exited ${String(exit.code)}`, error: `exit ${String(exit.code)}` };
  return { text: output };
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.tool.register({
      name: "piano_run",
      description:
        "Run a Piano/Tuna workflow in a directory. Returns a summary and the final output. Use cwd for the workspace and workflow for an explicit YAML path.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The task or prompt Piano should run." },
          workflow: { type: "string", description: "Optional workflow YAML path." },
          cwd: { type: "string", description: "Workspace directory." },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      isDeferred: false,
    });
    return next(e);
  });
  on("tool.call", { tool: TOOL }, async ($, e) => {
    const result = await runPiano($, e as unknown as Record<string, unknown>);
    return result.error === undefined
      ? { result: `${PREFIX} completed\n\n${result.text}` }
      : { deny: result.text };
  });
};
