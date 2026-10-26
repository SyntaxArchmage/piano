#!/usr/bin/env node
// Bake-off harness for a local System One endpoint.
//
// It sends the same profiling-decision cases to any server that implements
// POST /v1/systemone, scores exact action agreement, and reports latency.
// Nothing here writes run evidence or changes a workflow.
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const DEFAULT_CASES = new URL("../tests/fixtures/system-one/profiling-cases.json", import.meta.url);

function usage() {
  return `Usage: node scripts/system-one-bakeoff.mjs --endpoint <url> [options]

Options:
  --endpoint <url>     Base URL of the local System One server
  --model <id>         Optional model id sent in the request body
  --cases <path>       Case JSON (default: tests/fixtures/system-one/profiling-cases.json)
  --timeout-ms <n>     Per-request timeout (default: 30000)
  --dry-run            Print requests without calling the endpoint
  -h, --help           Show this help`;
}

function parseArgs(argv) {
  const options = { cases: DEFAULT_CASES, timeoutMs: 30_000, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`missing value for ${arg}`);
    index += 1;
    if (arg === "--endpoint") options.endpoint = value;
    else if (arg === "--model") options.model = value;
    else if (arg === "--cases") options.cases = value;
    else if (arg === "--timeout-ms") {
      const timeout = Number(value);
      if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("--timeout-ms must be positive");
      options.timeoutMs = timeout;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  if (!options.help && !options.dryRun && options.endpoint === undefined) {
    throw new Error("--endpoint is required unless --dry-run is set");
  }
  return options;
}

function requestFor(fixture, value, model) {
  return {
    ...(model === undefined ? {} : { model }),
    state: value.state,
    questions: fixture.question,
  };
}

function p95(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(usage());
  process.exit(0);
}

const fixture = JSON.parse(await readFile(options.cases, "utf8"));
if (!Array.isArray(fixture.cases) || fixture.question === undefined) {
  throw new Error("case file must contain question and cases[]");
}

const requests = fixture.cases.map((entry) => ({
  id: String(entry.id),
  expected: String(entry.expected),
  request: requestFor(fixture, entry, options.model),
}));

if (options.dryRun) {
  console.log(JSON.stringify(requests.map(({ id, expected, request }) => ({ id, expected, request })), null, 2));
  process.exit(0);
}

const endpoint = `${options.endpoint.replace(/\/+$/u, "")}/v1/systemone`;
const latencies = [];
const failures = [];

for (const entry of requests) {
  const started = performance.now();
  let response;
  let body;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry.request),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    body = await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ id: entry.id, expected: entry.expected, error: message });
    console.log(`FAIL ${entry.id}: ${message}`);
    continue;
  }
  const elapsed = performance.now() - started;
  latencies.push(elapsed);
  const answer = body?.answers?.action;
  const choice = typeof answer?.choice === "string" ? answer.choice : undefined;
  if (!response.ok) {
    const message = `HTTP ${response.status}`;
    failures.push({ id: entry.id, expected: entry.expected, error: message });
    console.log(`FAIL ${entry.id}: ${message}`);
    continue;
  }
  if (choice !== entry.expected) {
    failures.push({ id: entry.id, expected: entry.expected, actual: choice ?? "missing" });
    console.log(`FAIL ${entry.id}: expected ${entry.expected}, got ${choice ?? "missing"} (${elapsed.toFixed(1)}ms)`);
    continue;
  }
  const confidence = typeof answer?.confidence === "number" ? ` confidence=${answer.confidence.toFixed(3)}` : "";
  console.log(`PASS ${entry.id} (${elapsed.toFixed(1)}ms)${confidence}`);
}

const total = requests.length;
const passed = total - failures.length;
const mean = latencies.length === 0 ? 0 : latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
console.log(`\n${passed}/${total} matched; p50=${latencies.length === 0 ? 0 : [...latencies].sort((a, b) => a - b)[Math.floor(latencies.length / 2)].toFixed(1)}ms p95=${p95(latencies).toFixed(1)}ms mean=${mean.toFixed(1)}ms`);
if (failures.length > 0) process.exitCode = 1;
