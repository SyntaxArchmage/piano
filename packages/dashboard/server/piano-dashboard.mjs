#!/usr/bin/env node
// The Piano run dashboard: a dependency-free HTTP server over ~/.piano/runs.
//
// It reads only files the runtime already writes:
//   status.json                     run state, current stage, progress
//   eval-metrics/benchmark.jsonl    benchmark/v1 metrics (the tuning curve)
//   eval-metrics/token-usage.jsonl  per-attempt token deltas
//   eval-metrics/duration.jsonl     per-attempt stage durations
//   results/*.json                  fallback metric fields for contracts that
//                                   declare projections instead of metrics
//
// The fallback is what lets a tuning workflow whose result carries
// `throughput`, `perf`, `latency`, `*_us`, `*_gbps`, and similar numeric fields
// appear on the same curve without changing its contract. The browser code in
// public/ draws the SVG chart; this file only serves JSON and static assets.

import { createServer } from "node:http";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { homedir, networkInterfaces } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const PRODUCT = "piano-dashboard";
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PUBLIC_DIR = new URL("./public/", import.meta.url);
const STATIC = new Map();

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(payload);
}

function text(response, status, body, type = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

async function staticFile(name, type) {
  const url = new URL(name, PUBLIC_DIR);
  const entry = await stat(url).catch(() => undefined);
  if (entry === undefined) throw new Error(`missing dashboard asset ${name}`);
  const cached = STATIC.get(name);
  if (cached !== undefined && cached.mtimeMs === entry.mtimeMs && cached.size === entry.size) {
    return cached;
  }
  // Re-read on mtime/size change: editing the UI takes effect on the next
  // browser reload without restarting the already-running server.
  const body = await readFile(url, "utf8");
  const value = { body, type, mtimeMs: entry.mtimeMs, size: entry.size };
  STATIC.set(name, value);
  return value;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function readJsonl(path) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch {
    return { records: [], missing: true, invalid: 0 };
  }
  const records = [];
  let invalid = 0;
  for (const line of source.split("\n")) {
    if (line.trim() === "") continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      invalid += 1;
    }
  }
  return { records, missing: false, invalid };
}

/** The metric streams moved from `trajectories/` to `eval-metrics/`; read the
 * current spelling first and fall back to the legacy one. */
async function readStream(runDir, name) {
  for (const directory of ["eval-metrics", "trajectories"]) {
    const path = join(runDir, directory, name);
    const read = await readJsonl(path);
    if (!read.missing) return { ...read, path: `${directory}/${name}` };
  }
  return { records: [], missing: true, invalid: 0, path: undefined };
}

async function exists(path) {
  return stat(path).then(() => true, () => false);
}

/** Invocation records live under `system-log/`; the root spelling is the
 * legacy layout. */
async function readInvocationStream(runDir) {
  for (const path of [join(runDir, "system-log", "invocations.jsonl"), join(runDir, "invocations.jsonl")]) {
    const read = await readJsonl(path);
    if (!read.missing) return read;
  }
  return { records: [], missing: true, invalid: 0 };
}

function truncate(value, limit) {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function errorText(error) {
  if (error === undefined) return undefined;
  if (typeof error === "string") return truncate(error, 800);
  if (error !== null && typeof error === "object") {
    const record = error;
    if (typeof record.type === "string") return truncate(record.type, 200);
    if (typeof record.message === "string") return truncate(record.message, 800);
    if (typeof record._tag === "string") return truncate(record._tag, 200);
  }
  try {
    return truncate(JSON.stringify(error), 800);
  } catch {
    return undefined;
  }
}

function summarizeStatus(status) {
  if (status === null || typeof status !== "object") return undefined;
  const actors = status.actors !== null && typeof status.actors === "object" ? status.actors : {};
  const harnesses = {};
  for (const [key, actor] of Object.entries(actors)) {
    if (actor !== null && typeof actor === "object" && typeof actor.harness === "string") {
      harnesses[key] = actor.harness;
    }
  }
  const workflowPath = typeof status.workflowPath === "string" ? status.workflowPath : undefined;
  return {
    runId: status.runId,
    status: status.status,
    updatedAt: status.updatedAt,
    name: status.name,
    mnemonic: status.mnemonic,
    workflowPath,
    workflowName: workflowPath === undefined
      ? undefined
      : basename(workflowPath).replace(/\.ya?ml$/i, ""),
    plannedStages: status.plannedStages ?? 0,
    completedStages: status.completedStages ?? 0,
    stageCounts: status.stageCounts ?? {},
    current: status.current ?? null,
    invocationTime: status.invocationTime ?? {},
    jobs: Array.isArray(status.jobs)
      ? status.jobs.map((job) => ({
        jobOrdinal: job?.jobOrdinal,
        outcome: job?.outcome,
        accepted: Array.isArray(job?.accepted) ? job.accepted.length : 0,
      }))
      : [],
    harnesses,
    error: errorText(status.error),
  };
}

function firstExternalIpv4() {
  const interfaces = networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && entry.internal === false) return entry.address;
    }
  }
  return undefined;
}

function urlBases(host, port) {
  const wildcard = host === "0.0.0.0" || host === "::";
  const displayHost = wildcard ? firstExternalIpv4() ?? "localhost" : host;
  const localHost = wildcard ? "127.0.0.1" : host;
  const bracket = (value) => (value.includes(":") ? `[${value}]` : value);
  return {
    urlBase: `http://${bracket(displayHost)}:${port}`,
    localUrlBase: `http://${bracket(localHost)}:${port}`,
  };
}

async function writeState(stateFile, state) {
  if (stateFile === undefined) return;
  await mkdir(dirname(stateFile), { recursive: true });
  const temporary = `${stateFile}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
  await rename(temporary, stateFile);
}

async function probeDashboard(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(500),
    });
    if (!response.ok) return undefined;
    const body = await response.json();
    return body?.product === PRODUCT ? body : undefined;
  } catch {
    return undefined;
  }
}

// ── evidence readers ───────────────────────────────────────────────────────

async function listRuns(root, cache) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const names = entries
    .filter((entry) => entry.isDirectory() && RUN_ID.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(0, 100);
  const runs = [];
  for (const name of names) {
    const runDir = join(root, name);
    const statusPath = join(runDir, "status.json");
    const statusStat = await stat(statusPath).catch(() => undefined);
    const key = statusStat === undefined ? "missing" : `${statusStat.mtimeMs}:${statusStat.size}`;
    const cached = cache.get(name);
    if (cached !== undefined && cached.key === key) {
      runs.push(cached.value);
      continue;
    }
    const status = await readJson(statusPath);
    if (status === undefined) continue;
    const summary = summarizeStatus(status) ?? { runId: name, status: "unknown" };
    summary.id = name;
    summary.hasBenchmark = await exists(join(runDir, "eval-metrics", "benchmark.jsonl")) ||
      await exists(join(runDir, "trajectories", "benchmark.jsonl"));
    cache.set(name, { key, value: summary });
    runs.push(summary);
  }
  return runs;
}

async function detailSignature(runDir) {
  const files = [
    "status.json",
    "system-log/invocations.jsonl",
    "invocations.jsonl",
    "eval-metrics/benchmark.jsonl",
    "trajectories/benchmark.jsonl",
    "eval-metrics/token-usage.jsonl",
    "trajectories/token-usage.jsonl",
    "eval-metrics/duration.jsonl",
    "trajectories/duration.jsonl",
    "eval-metrics/selection.jsonl",
    "trajectories/selection.jsonl",
  ];
  const parts = [];
  for (const file of files) {
    const entry = await stat(join(runDir, file)).catch(() => undefined);
    if (entry !== undefined) parts.push(`${file}:${entry.mtimeMs}:${entry.size}`);
  }
  const results = await stat(join(runDir, "results")).catch(() => undefined);
  if (results !== undefined) parts.push(`results:${results.mtimeMs}`);
  return parts.join("|");
}

const METRIC_KEY = /(throughput|perf(ormance)?|tflops|gflops|gops|gbps|bandwidth|latency|speedup|utilization|efficiency)/i;
const LOWER_BETTER = /(latency|_us$|_ms$|_ns$|time$|regression)/i;

function unitFor(key) {
  if (/tflops/i.test(key)) return "TFLOP/s";
  if (/gflops/i.test(key)) return "GFLOP/s";
  if (/gbps/i.test(key)) return "GB/s";
  if (/_ns$/i.test(key)) return "ns";
  if (/_us$/i.test(key)) return "µs";
  if (/_ms$/i.test(key)) return "ms";
  if (/speedup/i.test(key)) return "x";
  if (/efficiency|utilization/i.test(key)) return "ratio";
  return "";
}

/** Numeric performance-shaped leaves of a result document. This is the
 * compatibility path for contracts that describe their measurements as
 * projections (`profile.kernel_latency_us`) rather than declared benchmark
 * metrics. It is deliberately name-driven and bounded: at most 12 fields per
 * document, six levels deep, arrays skipped. */
function extractNumericMetrics(value) {
  const found = [];
  const seen = new Set();
  const walk = (node, path, depth) => {
    if (depth > 6 || found.length >= 12) return;
    if (node === null || typeof node !== "object" || Array.isArray(node)) return;
    for (const [key, child] of Object.entries(node)) {
      const next = path === "" ? key : `${path}.${key}`;
      if (typeof child === "number" && Number.isFinite(child)) {
        if (!METRIC_KEY.test(key) || seen.has(key)) continue;
        seen.add(key);
        found.push({
          name: key,
          pointer: `/${next.split(".").join("/")}`,
          value: child,
          unit: unitFor(key),
          direction: LOWER_BETTER.test(key) ? "lower" : "higher",
        });
      } else if (child !== null && typeof child === "object" && !Array.isArray(child)) {
        walk(child, next, depth + 1);
      }
    }
  };
  walk(value, "", 0);
  return found;
}

function iterationFrom(value) {
  const match = /(?:^|[/-])iter-(\d+)/.exec(String(value ?? ""));
  return match === null ? undefined : Number(match[1]);
}

function slotFrom(value) {
  const match = /(?:^|[/-])slot-(\d+)/.exec(String(value ?? ""));
  return match === null ? undefined : Number(match[1]);
}

async function deriveMetrics(runDir, acceptedByRef, benchmarkInvocations) {
  const resultsDir = join(runDir, "results");
  const names = await readdir(resultsDir).catch(() => []);
  const points = [];
  for (const name of names) {
    const match = /^(inv-[A-Za-z0-9_-]+)-attempt-(\d+)\.json$/.exec(name);
    if (match === null) continue;
    const ref = match[1];
    const attempt = Number(match[2]);
    const accepted = acceptedByRef.get(`${ref}\u0000${attempt}`) ?? acceptedByRef.get(ref);
    if (accepted === undefined) continue;
    if (benchmarkInvocations.has(accepted.invocationId)) continue;
    const path = join(resultsDir, name);
    const size = await stat(path).then((entry) => entry.size, () => 0);
    if (size === 0 || size > 1_000_000) continue;
    const value = await readJson(path);
    if (value === undefined) continue;
    const extracted = extractNumericMetrics(value);
    if (extracted.length === 0) continue;
    const iteration = Number.isInteger(accepted.iteration)
      ? accepted.iteration
      : iterationFrom(accepted.instanceId ?? accepted.invocationId);
    const mapSlot = Number.isInteger(accepted.mapSlot)
      ? accepted.mapSlot
      : slotFrom(accepted.instanceId ?? accepted.invocationId);
    for (const metric of extracted) {
      points.push({
        version: 1,
        timestamp: accepted.timestamp,
        runId: accepted.runId,
        invocationId: accepted.invocationId,
        stageId: accepted.stageId,
        stage: accepted.stage ?? accepted.stageId,
        worker: accepted.worker,
        attempt: accepted.attempt ?? attempt,
        ...(iteration === undefined ? {} : { iteration }),
        ...(mapSlot === undefined ? {} : { mapSlot }),
        ...(accepted.instanceId === undefined ? {} : { instanceId: accepted.instanceId }),
        ...(accepted.actorKey === undefined ? {} : { actorKey: accepted.actorKey }),
        ...(accepted.sessionId === undefined ? {} : { sessionId: accepted.sessionId }),
        kind: "benchmark",
        source: "result",
        ...(typeof value.decision === "string" ? { decision: value.decision } : {}),
        pointer: metric.pointer,
        metric: {
          protocol: "piano/derived/v1",
          name: metric.name,
          unit: metric.unit,
          direction: metric.direction,
          samples: [metric.value],
          best: metric.value,
          median: metric.value,
          runs: 1,
          warmup: 0,
        },
      });
    }
  }
  return points;
}

async function readRunDetail(root, runId, cache) {
  const runDir = resolve(root, runId);
  if (basename(runDir) !== runId || !runDir.startsWith(`${resolve(root)}${sep}`)) {
    return undefined;
  }
  const signature = await detailSignature(runDir);
  const cached = cache.get(runId);
  if (cached !== undefined && cached.signature === signature) return cached.value;
  const status = await readJson(join(runDir, "status.json"));
  if (status === undefined) return undefined;
  const [benchmark, tokens, durations, selections, invocations] = await Promise.all([
    readStream(runDir, "benchmark.jsonl"),
    readStream(runDir, "token-usage.jsonl"),
    readStream(runDir, "duration.jsonl"),
    readStream(runDir, "selection.jsonl"),
    readInvocationStream(runDir),
  ]);
  const acceptedByRef = new Map();
  for (const record of invocations.records) {
    if (record?.kind !== "invocation-accepted" || typeof record.ref !== "string") continue;
    acceptedByRef.set(`${record.ref}\u0000${record.attempt ?? 1}`, record);
    if (!acceptedByRef.has(record.ref)) acceptedByRef.set(record.ref, record);
  }
  const benchmarkInvocations = new Set(benchmark.records.map((record) => record.invocationId));
  const derived = await deriveMetrics(runDir, acceptedByRef, benchmarkInvocations);
  const warnings = [];
  for (const [label, stream] of [["benchmark", benchmark], ["token-usage", tokens], ["duration", durations], ["selection", selections]]) {
    if (stream.invalid > 0) warnings.push(`${label}.jsonl: skipped ${stream.invalid} malformed line(s)`);
  }
  const value = {
    runId,
    status: summarizeStatus(status),
    records: {
      benchmark: benchmark.records,
      derived,
      tokenUsage: tokens.records,
      duration: durations.records,
      selection: selections.records,
    },
    sources: {
      benchmark: benchmark.path,
      tokenUsage: tokens.path,
      duration: durations.path,
      selection: selections.path,
      derived: derived.length === 0 ? undefined : "results/*.json",
    },
    warnings,
    generatedAt: new Date().toISOString(),
  };
  cache.set(runId, { signature, value });
  return value;
}

// ── HTTP surface ───────────────────────────────────────────────────────────

export function createDashboardServer(options = {}) {
  const root = resolve(options.runsRoot ?? process.env.PIANO_DASHBOARD_RUNS_ROOT ?? join(homedir(), ".piano", "runs"));
  const runCache = new Map();
  const detailCache = new Map();
  const host = options.host ?? "0.0.0.0";
  const requestedPort = options.port ?? 7317;
  const stateFile = options.stateFile;

  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      json(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  async function handle(request, response) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      json(response, 405, { error: "method not allowed" });
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    } catch {
      json(response, 400, { error: "bad path" });
      return;
    }
    if (pathname === "/healthz") {
      json(response, 200, { ok: true, product: PRODUCT, pid: process.pid, runsRoot: root });
      return;
    }
    if (pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (pathname === "/api/runs") {
      json(response, 200, { runsRoot: root, runs: await listRuns(root, runCache) });
      return;
    }
    const detail = /^\/api\/runs\/([^/]+)$/.exec(pathname);
    if (detail !== null) {
      const runId = detail[1];
      if (!RUN_ID.test(runId)) {
        json(response, 400, { error: "invalid run id" });
        return;
      }
      const value = await readRunDetail(root, runId, detailCache);
      if (value === undefined) {
        json(response, 404, { error: `run ${runId} not found` });
        return;
      }
      json(response, 200, value);
      return;
    }
    if (pathname === "/" || pathname === "/index.html" || /^\/r\/[^/]+$/.test(pathname)) {
      const file = await staticFile("index.html", "text/html; charset=utf-8");
      text(response, 200, file.body, file.type);
      return;
    }
    if (pathname === "/app.js") {
      const file = await staticFile("app.js", "text/javascript; charset=utf-8");
      text(response, 200, file.body, file.type);
      return;
    }
    if (pathname === "/style.css") {
      const file = await staticFile("style.css", "text/css; charset=utf-8");
      text(response, 200, file.body, file.type);
      return;
    }
    text(response, 404, "not found\n");
  }

  async function bind(port) {
    await new Promise((resolveListen, rejectListen) => {
      const onError = (error) => {
        server.off("listening", onListening);
        rejectListen(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolveListen();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    });
  }

  return {
    server,
    async listen() {
      let port = requestedPort;
      for (let attempt = 0; attempt <= 20; attempt += 1) {
        try {
          await bind(port);
          const address = server.address();
          const actual = typeof address === "object" && address !== null ? address.port : port;
          const bases = urlBases(host, actual);
          await writeState(stateFile, {
            product: PRODUCT,
            pid: process.pid,
            host,
            port: actual,
            ...bases,
            runsRoot: root,
            startedAt: new Date().toISOString(),
          });
          return { host, port: actual, ...bases };
        } catch (error) {
          if (error?.code !== "EADDRINUSE") throw error;
          if (port === 0 || port > 65535 - 20) throw error;
          const existing = await probeDashboard(port);
          if (existing !== undefined) {
            // Another Piano instance already serves this port. Publish its
            // identity into our state file so a caller that came up first can
            // still discover the URL.
            const bases = urlBases(host, port);
            await writeState(stateFile, {
              product: PRODUCT,
              pid: typeof existing.pid === "number" ? existing.pid : process.pid,
              host,
              port,
              ...bases,
              runsRoot: typeof existing.runsRoot === "string" ? existing.runsRoot : root,
              startedAt: new Date().toISOString(),
            });
            return { host, port, ...bases, reused: true };
          }
          port += 1;
        }
      }
      throw new Error("no free port for the dashboard");
    },
    async close() {
      await new Promise((resolveClose) => server.close(() => resolveClose()));
    },
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const host = args.host ?? process.env.PIANO_DASHBOARD_HOST ?? "0.0.0.0";
  const port = Number(args.port ?? process.env.PIANO_DASHBOARD_PORT ?? 7317);
  const runsRoot = args["runs-root"] ?? process.env.PIANO_DASHBOARD_RUNS_ROOT ?? join(homedir(), ".piano", "runs");
  const stateFile = args["state-file"] ?? process.env.PIANO_DASHBOARD_STATE ?? join(homedir(), ".piano", "dashboard", "server.json");
  const dashboard = createDashboardServer({ runsRoot, stateFile, host, port });
  const info = await dashboard.listen();
  if (info.reused === true) {
    process.stdout.write(`PIANO_DASHBOARD_READY ${info.urlBase}\n`);
    return;
  }
  process.stdout.write(`PIANO_DASHBOARD_READY ${info.urlBase}\n`);
  const shutdown = () => {
    void dashboard.close().then(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

const invokedPath = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath !== undefined && import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`piano-dashboard: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
