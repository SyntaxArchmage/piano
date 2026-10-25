#!/usr/bin/env node
// Measures the piano run this workspace launched: wall-clock decomposed into
// the 5 speedup-me buckets, minus LLM inference. Outputs a single metric line
// for the evals framework.
//
// Usage: node runtime-metric.mjs [runsRoot]
//   runsRoot defaults to ~/.piano/runs

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const runsRoot = process.argv[2] ?? join(homedir(), ".piano", "runs");

// The metric is wall-clock overhead and lower-is-better: a fabricated 0 would
// read as a perfect run. Every failure below exits non-zero instead, so the
// readout has no value and the case reports a missing metric.
function fail(message) {
  console.error(`# ${message}`);
  console.error("runtime_overhead_ms: n/a");
  process.exit(1);
}

if (!existsSync(runsRoot)) fail(`runs root ${runsRoot} does not exist`);

const streamPathOf = (dir, name) => join(dir, "system-log", name);

const logPathOf = (dir) => streamPathOf(dir, "log.jsonl");

const ids = readdirSync(runsRoot).filter((d) => existsSync(logPathOf(join(runsRoot, d)))).sort();

// The run this workspace belongs to: concurrent eval cases create their own
// runs, and another run's work (or a stale one) is not this case's metric.
const statusOf = (dir) => {
  try { return JSON.parse(readFileSync(join(dir, "status.json"), "utf8")); } catch { return undefined; }
};
const owned = (id) => {
  const workspaceCwd = statusOf(join(runsRoot, id))?.workspaceCwd;
  return typeof workspaceCwd === "string" && workspaceCwd === process.cwd();
};

const ownedId = ids.findLast(owned);
if (ownedId === undefined) fail(`no completed run recorded this workspace (${process.cwd()}) under ${runsRoot}`);

const runDir = join(runsRoot, ownedId);

function parseJsonl(path) {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

const traceLines = parseJsonl(streamPathOf(runDir, "trace.jsonl"));
const logLines = parseJsonl(logPathOf(runDir));

// --- bucket 1: LLM inference (sendPrompt spans) ---
let llmMs = 0;
for (const t of traceLines) {
  if (t.fn === "sendPrompt" && t.event === "exit" && typeof t.duration_ms === "number") {
    llmMs += t.duration_ms;
  }
}

// --- bucket 2: harness process overhead ---
// loadSdk, createModelRuntime, createAgentSession, subscribeSessionEvents, etc.
const harnessFns = new Set([
  "loadSdk", "createModelRuntime", "createAgentSession",
  "subscribeSessionEvents", "loadAgentResources", "loadContextFile",
  "createResourceLoader", "reloadResourceLoader", "setRuntimeApiKey", "resolveModel",
]);
let harnessMs = 0;
for (const t of traceLines) {
  if (t.event === "exit" && harnessFns.has(t.fn) && typeof t.duration_ms === "number") {
    harnessMs += t.duration_ms;
  }
}

// --- bucket 3: orchestration bookkeeping ---
const bookkeepingFns = new Set([
  "parseWorkflow", "compileWorkflow", "loadWorkflow",
  "validateStageResult", "persistActors", "writeProgressSnapshot",
  "appendWorkflowProgress", "writeHandoffRecord",
]);
let bookkeepingMs = 0;
for (const t of traceLines) {
  if (t.event === "exit" && bookkeepingFns.has(t.fn) && typeof t.duration_ms === "number") {
    bookkeepingMs += t.duration_ms;
  }
}

// --- bucket 4: serialization & queueing (gaps between stage.started) ---
let serializationMs = 0;
const stageStarts = logLines
  .filter((l) => l.event === "stage.started" && l.timestamp)
  .map((l) => Date.parse(l.timestamp))
  .sort((a, b) => a - b);
for (let i = 1; i < stageStarts.length; i++) {
  const gap = stageStarts[i] - stageStarts[i - 1];
  if (gap > 0 && gap < 200) serializationMs += gap;
}

// --- bucket 5: external waiting (retry backoff) ---
let externalMs = 0;
for (const l of logLines) {
  if (l.event === "stage.retry" && l.attributes?.delayMs) {
    externalMs += l.attributes.delayMs;
  }
}

// --- total wall clock from first to last log entry ---
const timestamps = logLines.map((l) => Date.parse(l.timestamp)).filter((t) => !isNaN(t));
const totalMs = timestamps.length >= 2 ? timestamps[timestamps.length - 1] - timestamps[0] : 0;

// --- optimizable overhead = total − LLM ---
const overheadMs = Math.max(0, totalMs - llmMs);

// Output the primary metric line (required by metricPattern)
console.log(`runtime_overhead_ms: ${overheadMs}`);

// Diagnostic breakdown
console.log(`# buckets: llm=${llmMs} harness=${harnessMs} bookkeeping=${bookkeepingMs} serialization=${serializationMs} external=${externalMs} total=${totalMs} overhead=${overheadMs}`);
