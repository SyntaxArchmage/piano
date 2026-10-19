#!/usr/bin/env node
// Per-actor resume inspector for one Piano run directory.
//
//   node scripts/inspect-run-resume.mjs <runDir> [--ledger <path>]
//
// Folds the run's own evidence — status.json's actor table, the ledger's
// actor-turn rows, and each job's stage-started counts — into one table that
// answers "did every worker conversation actually survive the pause?", and
// with --ledger (the resume guards' fake-worker ledger, see
// tests/fixtures/resume-run/fake-codex.mjs) cross-checks it against what the
// workers themselves saw on every turn.
//
// Flags (exit code 1 when any):
//   RESTARTED   a worker turn opened a thread that already had history —
//               the engine lost the continuation and the conversation
//               silently started over;
//   ORPHAN-*    engine actor table and worker ledger disagree about which
//               conversations exist;
//   RERUN       an invocation started more times than the worker ledger
//               shows turns for it (or vice versa) — evidence and workers
//               diverge about what actually ran.
//
// Plain node, no dependencies: it must stay runnable against a kept evidence
// directory (GUARD_KEEP=1) long after the test process is gone.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const [runDir, ...rest] = process.argv.slice(2);
if (runDir === undefined || existsSync(runDir) === false || statSync(runDir).isDirectory() === false) {
  process.stderr.write(`usage: node scripts/inspect-run-resume.mjs <runDir> [--ledger <path>]\n`);
  process.exit(2);
}
let ledgerPath;
const ledgerFlag = rest.indexOf("--ledger");
if (ledgerFlag !== -1) ledgerPath = rest[ledgerFlag + 1];

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
};
const readJsonl = (path) => {
  try {
    return readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "")
      .map((line) => {
        try { return JSON.parse(line); } catch { return undefined; }
      })
      .filter((record) => record !== undefined);
  } catch {
    return [];
  }
};

const status = readJson(join(runDir, "status.json")) ?? {};
const progress = readJsonl(join(runDir, "progress.jsonl"));
const actors = status.actors ?? {};
const flags = [];

console.log(`run ${status.runId ?? "?"}  status=${status.status ?? "?"}  workflow=${status.workflowPath ?? "?"}`);
for (const job of status.jobs ?? []) {
  console.log(`  job ${job.jobOrdinal}: ${job.state}${job.outcome ? `/${job.outcome}` : ""}`
    + `  accepted=${(job.accepted ?? []).length}`);
}

// ——— Per-actor resume table, from the engine's own state document.
console.log("\nactors (status.json):");
const actorRows = Object.entries(actors);
if (actorRows.length === 0) console.log("  (none)");
for (const [key, actor] of actorRows) {
  const transcript = actor.transcriptPath ?? "?";
  const transcriptState = existsSync(transcript) ? `${countLines(transcript)} rec` : "MISSING";
  const native = actor.continuation?.nativeSessionId ?? actor.continuation?.sessionId ?? "-";
  console.log(`  ${key}`);
  console.log(`    turns=${actor.turns}  session=${actor.sessionId ?? "?"}  native=${native}`);
  console.log(`    transcript=${transcript} (${transcriptState})`);
}

function countLines(path) {
  try {
    return readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "").length;
  } catch {
    return "?";
  }
}

// ——— Engine-side turn counts per invocation (stage-started rows).
const starts = new Map();
for (const record of progress) {
  if (record.kind !== "stage-started") continue;
  starts.set(record.invocationId, (starts.get(record.invocationId) ?? 0) + 1);
}

// ——— Worker-side cross-check against the fake ledger.
if (ledgerPath !== undefined) {
  const rows = readFileSync(existsSync(ledgerPath) ? ledgerPath : "/nonexistent", "utf8")
    .split("\n").filter((line) => line.trim() !== "")
    .map((line) => {
      const [mode, stage, invocation, threadId, priorTurns, sessionFile, cwd, ts] = line.split("\t");
      return { mode, stage, invocation, threadId, priorTurns: Number(priorTurns ?? "0"), sessionFile, cwd, ts };
    });
  console.log(`\nworker turns (${ledgerPath}): ${rows.length} rows`);
  const byThread = new Map();
  for (const row of rows) {
    byThread.set(row.threadId, [...(byThread.get(row.threadId) ?? []), row]);
  }
  for (const [threadId, threadRows] of byThread) {
    const actorKey = Object.keys(actors).find((key) => actors[key].sessionId === threadId);
    console.log(`  thread ${threadId}${actorKey === undefined ? "  ORPHAN-LEDGER (no actor claims this session)" : `  <- ${actorKey}`}`);
    if (actorKey === undefined) flags.push(`ORPHAN-LEDGER: thread ${threadId} has no actor`);
    threadRows.forEach((row, position) => {
      const suspicious = position > 0 && row.mode !== "resumed";
      if (suspicious) flags.push(`RESTARTED: thread ${threadId} turn ${position + 1} (${row.stage}) opened instead of resuming`);
      console.log(`    ${position + 1}. ${row.mode}${suspicious ? "  << RESTARTED" : ""}  prior=${row.priorTurns}  ${row.stage}  ${row.invocation}`);
    });
  }
  for (const key of Object.keys(actors)) {
    const sessionId = actors[key].sessionId;
    if (sessionId !== undefined && !byThread.has(sessionId)) {
      flags.push(`ORPHAN-ACTOR: actor ${key} session ${sessionId} never appears in the worker ledger`);
      console.log(`\n  ORPHAN-ACTOR: ${key} session ${sessionId} has no worker turns`);
    }
  }
  // Stage-started counts vs worker turns per invocation ($consolidate turns
  // carry no invocation evidence by design, so they are left out).
  console.log("\ninvocation starts (engine) vs worker turns (ledger):");
  const ledgerByInvocation = new Map();
  for (const row of rows) {
    if (row.stage.startsWith("$consolidate/")) continue;
    ledgerByInvocation.set(row.invocation, (ledgerByInvocation.get(row.invocation) ?? 0) + 1);
  }
  for (const invocationId of [...new Set([...starts.keys(), ...ledgerByInvocation.keys()])].sort()) {
    const engine = starts.get(invocationId) ?? 0;
    const worker = ledgerByInvocation.get(invocationId) ?? 0;
    const mark = engine === worker ? "" : "  << RERUN/DIVERGENCE";
    if (mark !== "") flags.push(`RERUN: ${invocationId} engine=${engine} worker=${worker}`);
    console.log(`  ${invocationId}: engine=${engine} worker=${worker}${mark}`);
  }
}

if (flags.length === 0) {
  console.log("\nresume evidence consistent.");
} else {
  console.log(`\n${flags.length} flag(s):`);
  for (const flag of flags) console.log(`  ${flag}`);
  process.exit(1);
}
