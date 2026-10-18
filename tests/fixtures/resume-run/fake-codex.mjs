#!/usr/bin/env node
// Deterministic codex-CLI stand-in for the resume e2e guards
// (tests/cli/tuning-continue-real-workers.test.ts and
// tests/tui/tuning-resume-continue.pty.test.ts).
//
// This is a real subprocess speaking the real `codex exec --json` NDJSON
// protocol; only the model turn is scripted. Unlike the tournament guard's
// fake (tests/fixtures/tournament-real-run/fake-agent.mjs), this one KEEPS A
// SESSION STORE: every thread id maps to a JSONL conversation file, and a
// resumed invocation (`codex exec resume <thread-id> …`, the argv shape
// harness-argv.ts builds from the continuation) reads that file back before
// answering. That is what makes the resume claim observable from the worker
// side: each invocation appends one row to $PIANO_FAKE_RESUME_LEDGER recording
// whether the conversation was actually reopened (`resumed` with prior turns)
// or silently restarted (`opened`), so the guards — and
// scripts/inspect-run-resume.mjs — can cross-check the engine's actor table
// against what the workers themselves saw.
//
// Like the tournament fake it acts purely on what the stage prompt tells it
// (stage id, invocation, validation result path, consolidation source and
// winner paths) plus its own cwd (the slot lane encodes `slot-N`), so the
// engine cannot tell it apart from a compliant agent.
//
// PIANO_FAKE_PAUSE_AT="<stage-suffix>:<invocation-substring>" wedges the FIRST
// matching invocation (a user record and the ledger row are already down, and
// `thread.started` is already out, so the engine holds a resumable native id):
// the guard interrupts the run there and later proves `/continue` picked the
// job up from that exact point.
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { setTimeout } from "node:timers";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const prompt = args.find((arg) => arg.includes("## Workflow stage context")) ?? args.at(-1) ?? "";
const stage = /executing workflow stage `([^`]+)`/.exec(prompt)?.[1] ?? "unknown";
const invocation = /executing workflow stage `[^`]+` \(([^)]+)\)/.exec(prompt)?.[1] ?? "";
const iteration = Number(/iter-(\d+)/.exec(invocation)?.[1] ?? "0");
const slot = Number(/slot-(\d+)/.exec(process.cwd())?.[1] ?? "0");

const store = process.env.PIANO_FAKE_SESSION_STORE;
const ledger = process.env.PIANO_FAKE_RESUME_LEDGER;

const emit = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// `codex exec resume <thread-id> --json …` vs a fresh `codex exec --json …`.
// The thread id is the continuation handle the engine handed back; a fresh
// invocation mints one and reports it on the `thread.started` frame.
const resumedId = args[1] === "resume" ? args[2] : undefined;
const threadId = resumedId ?? randomUUID();

function sessionFile(id) {
  return join(store, `${id}.jsonl`);
}
function readRecords(id) {
  if (store === undefined) return [];
  try {
    return readFileSync(sessionFile(id), "utf8").split("\n").filter((line) => line.trim() !== "");
  } catch {
    return [];
  }
}
function appendRecord(id, record) {
  if (store === undefined) return;
  mkdirSync(store, { recursive: true });
  appendFileSync(sessionFile(id), `${JSON.stringify(record)}\n`);
}

const prior = readRecords(threadId);
const priorTurns = prior.filter((line) => JSON.parse(line).role === "user").length;
// `resumed` means the engine asked for this thread AND the store really held
// its history. An engine that asks to resume a thread whose store is empty —
// or one that starts a second thread for an actor that already had one —
// lands as `opened`, which is exactly the defect the guards watch for.
const mode = resumedId !== undefined && prior.length > 0 ? "resumed" : "opened";

// The user record goes down BEFORE anything can wedge: an interrupted turn
// still leaves its trace in the conversation, so the resumed attempt's
// priorTurns counts it and the guards can see the reopen really read it back.
appendRecord(threadId, {
  role: "user",
  stage,
  invocation,
  ts: new Date().toISOString(),
});
if (ledger !== undefined) {
  mkdirSync(dirname(ledger), { recursive: true });
  appendFileSync(ledger, [
    mode,
    stage,
    invocation,
    threadId,
    String(priorTurns),
    store === undefined ? "-" : sessionFile(threadId),
    process.cwd(),
    new Date().toISOString(),
  ].join("\t") + "\n");
}

// The one-shot pause hook: announce the thread (so the engine's continuation
// carries this fake's native id even though the turn never completes), then
// wedge until the guard interrupts. pause.count keeps the retry after
// /continue from wedging on the same match.
const pauseAt = process.env.PIANO_FAKE_PAUSE_AT;
if (pauseAt !== undefined && store !== undefined) {
  const [pauseStage, pauseMatch] = pauseAt.split(":");
  const matches = stage.endsWith(pauseStage)
    && (pauseMatch === undefined || invocation.includes(pauseMatch));
  const pauseCountFile = join(store, "pause.count");
  const alreadyPaused = existsSync(pauseCountFile);
  if (matches && !alreadyPaused) {
    writeFileSync(pauseCountFile, "1");
    emit({ type: "thread.started", thread_id: threadId });
    emit({ type: "turn.started" });
    await sleep(Number(process.env.PIANO_FAKE_PAUSE_MS ?? "600000"));
  }
}

/** The validator result path a `validate` stage writes to, from its standard
 * prompt line (same extraction the tournament guard's fake uses). */
function writeValidation(payload) {
  const path = prompt.split("\n").find((line) => line.trim().endsWith("/result.json"))?.trim();
  if (path === undefined) {
    process.stderr.write(`missing validation result path for stage ${stage}\n`);
    process.exit(4);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload));
}

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
  // slot-1 wins each race, and every later iteration strictly improves so the
  // cross-iteration incumbent guard admits both carries (tournament fake's
  // arithmetic, kept identical so region-exit semantics match).
  const best = iteration * 10 + (slot === 0 ? 4 : 9);
  writeValidation({
    iteration,
    decision: "KEEP",
    candidate: { path: "kernel.py" },
    current_best: { path: "state/current-best.py" },
    verification: { compile_passed: true, verify_passed: true },
    benchmark: { name: "tflops", unit: "TFLOP/s", direction: "higher", samples: [best], best, median: best, runs: 1, warmup: 0 },
    promotion: { promoted: true, resulting_best: { path: "state/current-best.py" }, reason: "faster" },
    records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
  });
} else if (stage.startsWith("$consolidate/")) {
  const wholeTree = /shared source at `([^`]+)` content-equal to your winning slot content at `([^`]+)`/.exec(prompt);
  const delta = /Apply your winning change from `([^`]+)` to the tournament parent at `([^`]+)`/.exec(prompt);
  if (wholeTree?.[1] !== undefined && wholeTree[2] !== undefined) {
    process.stderr.write("whole-tree consolidation is deprecated\n");
    process.exit(5);
  } else if (delta?.[1] !== undefined && delta[2] !== undefined) {
    // Current protocol: apply only the baseline-relative winner delta so
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

// The codex `exec --json` dialect the subprocess adapter reads
// (subprocess-events.ts normalizeCodexRecord): thread.started carries the
// resumable native id, item.completed the answer, turn.completed ends the turn.
emit({ type: "thread.started", thread_id: threadId });
emit({ type: "turn.started" });
const text = `${stage} done (turns=${priorTurns + 1})`;
emit({ type: "item.completed", item: { type: "agent_message", text } });
emit({
  type: "turn.completed",
  usage: { input_tokens: priorTurns + 1, output_tokens: priorTurns + 1 },
});
appendRecord(threadId, {
  role: "assistant",
  stage,
  invocation,
  text,
  ts: new Date().toISOString(),
});
