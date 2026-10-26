// Start and reuse the background dashboard server.
//
// The server itself is a standalone Node script (`server/piano-dashboard.mjs`)
// so it can outlive the CLI process that starts it and keep serving a remote
// browser after the run ends. This module owns only discovery (where the
// script is), spawn/reuse, and the state file that names the live server.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface DashboardState {
  readonly product: "piano-dashboard";
  readonly pid: number;
  readonly host: string;
  readonly port: number;
  /** URL base a remote browser can use (a LAN address when bound to 0.0.0.0). */
  readonly urlBase: string;
  /** URL base for the machine running Piano. */
  readonly localUrlBase: string;
  readonly runsRoot: string;
  readonly startedAt: string;
}

export interface DashboardHandle {
  readonly url: string;
  readonly localUrl: string;
  readonly port: number;
  readonly host: string;
  readonly pid: number;
  /** True when an already-running server was reused instead of spawned. */
  readonly reused: boolean;
}

export interface EnsureDashboardOptions {
  /** The run the caller wants to open; appended to the returned URL. */
  readonly runId?: string;
  readonly runsRoot?: string;
  readonly host?: string;
  readonly port?: number;
  readonly stateFile?: string;
  readonly timeoutMs?: number;
}

export function dashboardHome(): string {
  return process.env.PIANO_DASHBOARD_HOME ?? join(homedir(), ".piano", "dashboard");
}

export function dashboardStatePath(): string {
  return join(dashboardHome(), "server.json");
}

export function dashboardRunsRoot(): string {
  return process.env.PIANO_DASHBOARD_RUNS_ROOT ?? join(homedir(), ".piano", "runs");
}

export function readDashboardState(statePath: string = dashboardStatePath()): DashboardState | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(statePath, "utf8"));
    if (typeof value !== "object" || value === null) return undefined;
    const state = value as Partial<DashboardState>;
    if (state.product !== "piano-dashboard") return undefined;
    if (typeof state.pid !== "number" || typeof state.port !== "number") return undefined;
    if (typeof state.urlBase !== "string" || typeof state.localUrlBase !== "string") return undefined;
    return state as DashboardState;
  } catch {
    return undefined;
  }
}

/** The server script location: beside a bundled CLI, or in the package's
 * `server/` directory when running from sources. `PIANO_DASHBOARD_SERVER`
 * overrides both for tests and unusual installs. */
export function dashboardServerPath(): string | undefined {
  const explicit = process.env.PIANO_DASHBOARD_SERVER;
  if (explicit !== undefined && existsSync(explicit)) return explicit;
  const candidates = [
    new URL("./piano-dashboard.mjs", import.meta.url),
    new URL("../server/piano-dashboard.mjs", import.meta.url),
  ];
  for (const candidate of candidates) {
    const path = fileURLToPath(candidate);
    if (existsSync(path)) return path;
  }
  return undefined;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function healthCheck(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(500),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { product?: unknown };
    return body.product === "piano-dashboard";
  } catch {
    return false;
  }
}

function handleOf(state: DashboardState, runId: string | undefined, reused: boolean): DashboardHandle {
  const suffix = runId === undefined ? "/" : `/r/${encodeURIComponent(runId)}`;
  return {
    url: `${state.urlBase}${suffix}`,
    localUrl: `${state.localUrlBase}${suffix}`,
    port: state.port,
    host: state.host,
    pid: state.pid,
    reused,
  };
}

/** Ensure one dashboard server is running for the runs root. Returns undefined
 * when monitoring is disabled, the server script is missing, or the process
 * cannot be started; callers treat the dashboard as best-effort and never fail
 * a run over it. */
export async function ensureDashboard(
  options: EnsureDashboardOptions = {},
): Promise<DashboardHandle | undefined> {
  if (process.env.PIANO_DASHBOARD_DISABLE === "1") return undefined;
  const statePath = options.stateFile ?? dashboardStatePath();
  const existing = readDashboardState(statePath);
  if (existing !== undefined && pidAlive(existing.pid) && await healthCheck(existing.port)) {
    return handleOf(existing, options.runId, true);
  }
  const entry = dashboardServerPath();
  if (entry === undefined) return undefined;
  const runsRoot = options.runsRoot ?? dashboardRunsRoot();
  const host = options.host ?? process.env.PIANO_DASHBOARD_HOST ?? "0.0.0.0";
  const port = options.port ?? Number(process.env.PIANO_DASHBOARD_PORT ?? 7317);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return undefined;
  try {
    const child = spawn(
      process.execPath,
      [entry, "--host", host, "--port", String(port), "--runs-root", runsRoot, "--state-file", statePath],
      {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, PIANO_DASHBOARD_CHILD: "1" },
      },
    );
    // A missing executable emits 'error' asynchronously; without a listener it
    // would crash the run this sidecar is only supposed to observe.
    child.on("error", () => {});
    child.unref();
  } catch {
    return undefined;
  }
  const deadline = Date.now() + (options.timeoutMs ?? 2500);
  while (Date.now() < deadline) {
    const state = readDashboardState(statePath);
    if (state !== undefined && pidAlive(state.pid) && await healthCheck(state.port)) {
      return handleOf(state, options.runId, false);
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  return undefined;
}

/** Stop the server named by the state file. Returns false when none is known. */
export function stopDashboard(statePath: string = dashboardStatePath()): boolean {
  const state = readDashboardState(statePath);
  if (state === undefined) return false;
  try {
    process.kill(state.pid, "SIGTERM");
  } catch {
    // Already gone; removing the stale state file is still useful.
  }
  try {
    rmSync(statePath, { force: true });
  } catch {
    // Best effort.
  }
  return true;
}
