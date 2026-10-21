#!/usr/bin/env node
// Deterministic pi-cli stand-in for the tournament region-exit e2e guards.
//
// This is a real subprocess speaking the real pi-CLI NDJSON protocol; only the
// model turn is scripted. Like a real worker it acts purely on what the stage
// prompt tells it (stage id, validation result path, consolidation source and
// winner paths) plus its own cwd (the slot lane encodes `slot-N`), so the
// engine cannot tell it apart from a compliant agent. Each invocation appends
// `<stage>\t<kernel.py content at entry>` to $PIANO_FAKE_TRACE first — the
// guards read that ordering to prove the winner was consolidated at the
// region exit, before the next loop iteration started.
import { appendFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { setInterval } from "node:timers";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { validationResultPathFromPrompt } from "../../common/validation-path.mjs";

const prompt = process.argv.slice(2).find((arg) => arg.includes("## Workflow stage context")) ?? process.argv.at(-1) ?? "";
const stage = /executing workflow stage `([^`]+)`/.exec(prompt)?.[1] ?? "unknown";
const invocation = /executing workflow stage `[^`]+` \(([^)]+)\)/.exec(prompt)?.[1] ?? "";
const iteration = Number(/iter-(\d+)/.exec(invocation)?.[1] ?? "0");

function kernelAt(cwd) {
  try {
    return readFileSync(`${cwd}/kernel.py`, "utf8").trim();
  } catch {
    return "-";
  }
}
// The trace lives outside the workspace on purpose: slot cleanup prunes
// anything not part of the winning lane's content, so a trace inside the
// source could be swept mid-run.
if (process.env.PIANO_FAKE_TRACE !== undefined) {
  appendFileSync(process.env.PIANO_FAKE_TRACE, `${stage}\t${kernelAt(process.cwd())}\n`);
}

// PIANO_FAKE_MODE=hang: model the wedged-worker hazard the exit-arc guards pin.
// A detached holder inherits our stdout pipe. The turn then never answers:
// top-level await parks the module BEFORE any side effect or NDJSON frame, so
// the engine has a live worker that simply never finishes. When /exit SIGTERMs
// the worker (same group), the holder — a different process group — survives
// with the pipe write-end open, so the adapter's `close`-based settlement can
// never fire. The holder's pid goes to the trace so the test can reap it.
// Default (`complete`) leaves the tournament guards byte-for-byte on the old
// path.
if (process.env.PIANO_FAKE_MODE === "hang") {
  const holder = spawn("sleep", ["600"], { detached: true, stdio: "inherit" });
  holder.unref();
  if (process.env.PIANO_FAKE_TRACE !== undefined) {
    appendFileSync(process.env.PIANO_FAKE_TRACE, `hold\t${String(holder.pid)}\n`);
  }
  // A live, silent worker: the (ref'd) timer keeps the event loop alive —
  // unref would let Node exit the unsettled await — while the parked await
  // stops this module before any side effect or NDJSON frame.
  setInterval(() => undefined, 1 << 30);
  await new Promise(() => undefined);
}

/** The validator result path a `validate` stage writes to, from its standard
 * prompt line (the extraction every guard shares). */
function writeValidation(payload) {
  const path = validationResultPathFromPrompt(prompt);
  if (path === undefined) {
    process.stderr.write(`missing validation result path for stage ${stage}\n`);
    process.exit(4);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload));
}

const slot = Number(/slot-(\d+)/.exec(process.cwd())?.[1] ?? "0");

if (stage.endsWith("propose")) {
  writeValidation({
    strategies: [
      { id: "slot-0", bottleneck: "memory", technique: "warp", rationale: "guard", predicted_speedup: 1.1, risk_level: "low" },
      { id: "slot-1", bottleneck: "compute", technique: "tile", rationale: "guard", predicted_speedup: 1.2, risk_level: "medium" },
    ],
  });
} else if (stage.endsWith(".implement")) {
  writeFileSync("kernel.py", `kernel-${slot}\n`);
} else if (stage.endsWith(".bench")) {
  // slot-1 wins each race, and every later repetition strictly improves so
  // the cross-iteration incumbent guard admits both carries.
  const best = iteration * 10 + (slot === 0 ? 4 : 9);
  writeValidation({
    iteration: 0,
    decision: "KEEP",
    candidate: { path: "kernel.py" },
    current_best: { path: "state/current-best.py" },
    verification: { compile_passed: true, verify_passed: true },
    benchmark: { name: "tflops", unit: "TFLOP/s", direction: "higher", samples: [best], best, median: best, runs: 1, warmup: 0 },
    promotion: { promoted: true, resulting_best: { path: "state/current-best.py" }, reason: "faster" },
    records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
  });
} else if (stage.startsWith("$consolidate/")) {
  const delta = /Apply your winning change from `([^`]+)` to the tournament parent at `([^`]+)`/.exec(prompt);
  if (delta?.[1] !== undefined && delta[2] !== undefined) {
    // Apply only the baseline-relative winner delta so
    // unrelated files already present in the parent remain untouched.
    const winner = delta[1];
    const parent = delta[2];
    const changes = [...prompt.matchAll(/^- (added|modified|deleted): (.+)$/gm)];
    for (const change of changes) {
      const kind = change[1];
      const path = change[2];
      if (path === undefined) continue;
      const target = join(parent, path);
      if (kind === "deleted") {
        rmSync(target, { recursive: true, force: true });
      } else {
        mkdirSync(dirname(target), { recursive: true });
        cpSync(join(winner, path), target, { recursive: true });
      }
    }
  } else {
    process.stderr.write(`missing consolidation paths for stage ${stage}\n`);
    process.exit(5);
  }
}

// pi-CLI NDJSON transcript in the json-mode dialect the subprocess adapter
// reads (`--mode json --print`): pi writes its own session header first, then
// the turn's frames. Usage rides only `message_end` — real pi-cli emits no
// terminal `result` frame in any mode (usage lives on the finalized message),
// and the adapter derives its `usage` events from that message_end alone.
// Usage is reported as session-cumulative per actor (like the real pi-cli on
// resume): the trajectory recorder subtracts the actor's previous cumulative
// snapshot to derive per-turn deltas, so a constant per-turn total would make
// every resumed iteration look like zero token growth.
const sessionId = `fake-${randomUUID()}`;
// One state file per actor (stage + lane), which the engine resumes serially
// across loop iterations — so a plain read/increment/write cannot race.
const usageKey = `${process.env.PIANO_FAKE_USAGE ?? `${process.env.PIANO_FAKE_TRACE}.usage`}.${encodeURIComponent(stage)}:${slot}`;
let turn = 1;
try {
  turn = Number(readFileSync(usageKey, "utf8")) + 1;
} catch {
  turn = 1;
}
try {
  writeFileSync(usageKey, String(turn));
} catch {
  // The usage state is fidelity decoration only; if it cannot be persisted
  // (e.g. the evidence dir was pruned), every turn just reports turn 1.
}
const frames = [
  { type: "session", version: 3, id: sessionId, timestamp: new Date().toISOString(), cwd: process.cwd() },
  { type: "agent_start" },
  { type: "message_update", message: { role: "assistant", content: "" }, assistantMessageEvent: { type: "text_delta", delta: "done" } },
  { type: "message_end", message: { role: "assistant", content: "done", usage: { input: turn, output: turn, cacheRead: 0, cacheWrite: 0, totalTokens: turn * 2 } } },
  { type: "agent_settled" },
];
process.stdout.write(`${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`);
