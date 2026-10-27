// Piano's Claude Code mod: a real `piano_run` tool, plus live progress.
//
// The model calls `mcp__piano__piano_run`; the mod runs the headless Piano CLI
// and streams its NDJSON as `$.ui.log` rows while the tool is in flight. The
// tool result is the summary and final output, which both the model and the
// person see. Mode is a launch setting:
//   PIANO_PIANO_BIN      path to the piano binary (default: `piano`)
//   PIANO_CLAUDE_NATIVE  1 to register this tool; otherwise the plugin does
//                        nothing so the MCP server stays the only piano surface
import type { EngineInterface, Register } from "claude-code";

const PREFIX = "[piano]";
const TOOL = "mcp__piano__piano_run";
const MAX_TEXT = 32_000;

interface Lines {
  push(text: string): void;
  flush(): void;
}

function lineSplitter(emit: (line: string) => void): Lines {
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

function cap(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… (${text.length - limit} chars truncated)`;
}

/** One NDJSON line, as a progress row and as an outcome when it holds one. */
interface LineOutcome {
  readonly progress?: string;
  readonly completed?: string;
  readonly failed?: string;
}

function readLine(line: string): LineOutcome {
  // `message_update` repeats the whole accumulated message on every token and
  // nothing here reads it; skipping it before JSON.parse keeps this path
  // linear in the reply length.
  if (line.includes('"type":"message_update"')) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const record = parsed as Record<string, unknown>;
  if (record["event"] === "run.started") {
    return { progress: `${PREFIX} started run ${String(record["run_id"])}` };
  }
  if (record["event"] === "run.completed") {
    return {
      progress: `${PREFIX} completed`,
      completed: typeof record["text"] === "string" ? record["text"] : "",
    };
  }
  if (record["event"] === "run.failed") {
    const message = typeof record["error"] === "string" ? record["error"] : "Piano run failed";
    return { progress: `${PREFIX} failed: ${cap(message, 200)}`, failed: message };
  }
  if (record["event"] !== "agent_event") return {};
  const data = (typeof record["data"] === "object" && record["data"] !== null
    ? record["data"]
    : {}) as Record<string, unknown>;
  const workflow = (typeof data["workflow"] === "object" && data["workflow"] !== null
    ? data["workflow"]
    : {}) as Record<string, unknown>;
  const stage = workflow["stageId"] === undefined ? "" : `[${String(workflow["stageId"])}] `;
  switch (record["type"]) {
    case "spawn":
      return { progress: `${PREFIX} ${stage}spawn harness=${String(data["harness"])} model=${String(data["model"])}` };
    case "turn_start":
      return { progress: `${PREFIX} ${stage}turn` };
    case "tool_execution_start":
      return { progress: `${PREFIX} ${stage}tool ${String(data["toolName"])}` };
    case "turn_end":
      return { progress: `${PREFIX} ${stage}turn end` };
    case "done":
      return { progress: `${PREFIX} ${stage}done exit=${String(data["exitStatus"])}` };
    default:
      return {};
  }
}

/** Run the headless CLI and return its final text or failure. */
async function runPiano(
  $: EngineInterface,
  args: Record<string, unknown>,
  configured?: string,
): Promise<{ readonly text?: string; readonly error?: string }> {
  const prompt = typeof args["prompt"] === "string" ? args["prompt"] : "";
  if (prompt.trim() === "") return { error: "piano_run requires a non-empty prompt" };
  const workflow = typeof args["workflow"] === "string" && args["workflow"].trim() !== "" ? args["workflow"] : undefined;
  const cwd = typeof args["cwd"] === "string" && args["cwd"].trim() !== "" ? args["cwd"] : undefined;
  const mnemonic = typeof args["mnemonic"] === "string" && args["mnemonic"].trim() !== "" ? args["mnemonic"] : undefined;
  const piano = configured === undefined || configured.trim() === "" ? "piano" : configured;
  const argv = [piano, "-p", "--json"];
  if (workflow !== undefined) argv.push("--workflow", workflow);
  if (mnemonic !== undefined) argv.push("--mnemonic", mnemonic);
  argv.push(prompt);

  let output: string | undefined;
  let failure: string | undefined;
  const child = $.process.spawn({ argv, ...(cwd === undefined ? {} : { cwd }) });
  const splitter = lineSplitter((line) => {
    const outcome = readLine(line);
    if (outcome.progress !== undefined) $.ui.log(outcome.progress);
    if (outcome.completed !== undefined) output = outcome.completed;
    if (outcome.failed !== undefined) failure = outcome.failed;
  });
  for await (const piece of child) {
    if (piece.stream === "stdout") splitter.push(piece.text);
    else if (piece.stream === "stderr" && piece.text.trim() !== "") $.ui.log(`${PREFIX} ${cap(piece.text.trim(), 300)}`);
  }
  splitter.flush();
  const exit = await child.result;
  if (failure !== undefined) return { error: failure };
  if (exit.code !== 0) return { error: `piano exited ${String(exit.code ?? "unknown")}` };
  return { text: output ?? "" };
}

export const register: Register = (on, options) => {
  const native = options?.["PIANO_CLAUDE_NATIVE"] === "1";
  const pianoBin = options?.["PIANO_PIANO_BIN"];
  on("session.start", async ($, e, next) => {
    if (!native) return next(e);
    await $.tool.register({
      name: "piano_run",
      description:
        "Run a Piano/Tuna workflow in a directory. Returns a summary and the final output. Use cwd for the workspace and workflow for an explicit YAML path.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The task or prompt Piano should run." },
          workflow: { type: "string", description: "Optional workflow YAML path." },
          cwd: { type: "string", description: "Workspace directory. Defaults to the session cwd." },
          mnemonic: { type: "string", description: "Optional lane namespace for tournament branches." },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      isDeferred: false,
    });
    return next(e);
  });
  on("tool.call", { tool: TOOL }, async ($, e) => {
    const result = await runPiano($, e as unknown as Record<string, unknown>, pianoBin);
    if (result.error !== undefined) return { deny: `${PREFIX} ${result.error}` };
    return { result: `${PREFIX} completed\n\n${cap(result.text ?? "", MAX_TEXT)}` };
  });
};