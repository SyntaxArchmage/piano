// Spike mod: prove that $.ui.log can put live child-process progress into the
// main transcript while the model turn runs. Runs in Claude Code's mod
// environment (no Node, no DOM): everything outside goes through `$`.
//
// Mode is chosen at launch with PIANO_SPIKE_MODE:
//   heartbeat (default) -> 10s bash child printing a line every 500ms
//   piano               -> `piano -p --json --workflow <fast.yml> "print OK"`
//                          with its NDJSON events summarized into log lines
import type { EngineInterface, Register } from "claude-code";

const PREFIX = "[piano-spike]";

type LogLine = (text: string) => void;

/** Split streamed text into lines; a piece may hold several or half a line. */
function makeLineSplitter(emit: (line: string) => void): {
  push: (text: string) => void;
  flush: () => void;
} {
  let pending = "";
  return {
    push(text: string): void {
      pending += text;
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/, "");
        pending = pending.slice(newline + 1);
        if (line.trim() !== "") emit(line);
        newline = pending.indexOf("\n");
      }
    },
    flush(): void {
      const line = pending.replace(/\r$/, "");
      pending = "";
      if (line.trim() !== "") emit(line);
    },
  };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** 10-second heartbeat: one line every 500ms, forwarded as it arrives. */
async function runHeartbeat($: EngineInterface, log: LogLine): Promise<void> {
  const startedAt = await $.clock.now();
  const elapsed = async (): Promise<string> => {
    const now = await $.clock.now();
    return `+${Math.round(now - startedAt)}ms`;
  };
  log(`${PREFIX} heartbeat child starting (10s, 500ms cadence)`);
  try {
    const child = $.process.spawn({
      argv: [
        "bash",
        "-c",
        'for i in $(seq 1 20); do echo "heartbeat tick $i"; sleep 0.5; done',
      ],
    });
    const splitter = makeLineSplitter((line) => {
      void elapsed().then((ms) => log(`${PREFIX} ${line} (${ms})`));
    });
    for await (const piece of child) {
      if (piece.stream === "stdout") splitter.push(piece.text);
    }
    splitter.flush();
    const exit = await child.result;
    log(`${PREFIX} heartbeat child exited code=${String(exit.code)} (${await elapsed()})`);
  } catch (error) {
    log(`${PREFIX} heartbeat child failed: ${String(error)}`);
  }
}

/** Summarize one NDJSON line from `piano -p --json` into a progress line. */
function summarizePianoEvent(line: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return `${PREFIX} piano stdout (non-JSON): ${truncate(line, 300)}`;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  const event = typeof record["event"] === "string" ? record["event"] : "?";
  if (event === "run.started") {
    return `${PREFIX} piano run.started id=${String(record["run_id"])}`;
  }
  if (event === "run.completed") {
    return `${PREFIX} piano run.completed text=${JSON.stringify(truncate(String(record["text"] ?? ""), 120))}`;
  }
  if (event === "run.failed") {
    return `${PREFIX} piano run.failed code=${String(record["code"])} error=${truncate(String(record["error"]), 200)}`;
  }
  if (event !== "agent_event") return undefined;
  const data = (typeof record["data"] === "object" && record["data"] !== null
    ? record["data"]
    : {}) as Record<string, unknown>;
  const workflow = (typeof data["workflow"] === "object" && data["workflow"] !== null
    ? data["workflow"]
    : {}) as Record<string, unknown>;
  const stage = workflow["stageId"] === undefined ? "" : `[${String(workflow["stageId"])}] `;
  switch (record["type"]) {
    case "spawn":
      return `${PREFIX} piano ${stage}spawn harness=${String(data["harness"])} model=${String(data["model"])}`;
    case "turn_start":
      return `${PREFIX} piano ${stage}turn_start`;
    case "message_start":
      return `${PREFIX} piano ${stage}message_start`;
    case "message_update": {
      const delta = (typeof data["assistantMessageEvent"] === "object" && data["assistantMessageEvent"] !== null
        ? data["assistantMessageEvent"]
        : {}) as Record<string, unknown>;
      if (delta["type"] === "text_delta" && typeof delta["delta"] === "string") {
        return `${PREFIX} piano ${stage}text: ${JSON.stringify(truncate(delta["delta"], 200))}`;
      }
      if (delta["type"] === "text_start") return `${PREFIX} piano ${stage}text block start`;
      return undefined;
    }
    case "turn_end":
      return `${PREFIX} piano ${stage}turn_end`;
    case "agent_end":
      return `${PREFIX} piano ${stage}agent_end`;
    case "done":
      return `${PREFIX} piano ${stage}done exit=${String(data["exitStatus"])}`;
    default:
      return undefined;
  }
}

/** Run the real headless Piano CLI and summarize its NDJSON stream live. */
async function runPiano($: EngineInterface, log: LogLine): Promise<void> {
  const startedAt = await $.clock.now();
  const elapsed = async (): Promise<string> => {
    const now = await $.clock.now();
    return `+${Math.round(now - startedAt)}ms`;
  };
  const pianoBin = await $.env.get("PIANO_SPIKE_PIANO_BIN");
  const workflow = await $.env.get("PIANO_SPIKE_WORKFLOW");
  const prompt = (await $.env.get("PIANO_SPIKE_PROMPT")) ?? "print OK";
  const cwd = await $.env.get("PIANO_SPIKE_CWD");
  if (pianoBin === undefined || workflow === undefined) {
    log(`${PREFIX} piano mode requires PIANO_SPIKE_PIANO_BIN and PIANO_SPIKE_WORKFLOW`);
    return;
  }
  log(`${PREFIX} piano child starting: ${pianoBin} -p --json --workflow ${workflow} ${JSON.stringify(prompt)}`);
  try {
    const child = $.process.spawn({
      argv: ["node", pianoBin, "-p", "--json", "--workflow", workflow, prompt],
      ...(cwd === undefined ? {} : { cwd }),
    });
    const splitter = makeLineSplitter((line) => {
      const summary = summarizePianoEvent(line);
      if (summary !== undefined) {
        void elapsed().then((ms) => log(`${summary} (${ms})`));
      }
    });
    for await (const piece of child) {
      if (piece.stream === "stdout") splitter.push(piece.text);
    }
    splitter.flush();
    const exit = await child.result;
    log(`${PREFIX} piano child exited code=${String(exit.code)} (${await elapsed()})`);
  } catch (error) {
    log(`${PREFIX} piano child failed: ${String(error)}`);
  }
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const mode = (await $.env.get("PIANO_SPIKE_MODE")) ?? "heartbeat";
    $.ui.log(`${PREFIX} ui.log mod loaded (mode=${mode}, interactive=${String(e.isInteractive)})`);
    void (mode === "piano" ? runPiano($, (line) => $.ui.log(line)) : runHeartbeat($, (line) => $.ui.log(line)));
    return next(e);
  });
};
