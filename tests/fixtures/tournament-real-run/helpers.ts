// Shared plumbing for the tournament region-exit real-process guards. The
// non-TUI guard (tests/workflow/tournament-real-cli.e2e.test.ts) and the TUI
// guard (tests/tui/tournament-workflow.pty.test.ts) drive the same fixture
// workflow through the real `piano` binary with the same deterministic pi-cli
// stand-in, so the isolated environment, workspace seed, and evidence readers
// live here once.
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const FAKE_AGENT_PATH = fileURLToPath(new URL("./fake-agent.mjs", import.meta.url));
export const WORKFLOW_PATH = fileURLToPath(new URL("./workflow.yml", import.meta.url));
export const PIANO_ENTRYPOINT = fileURLToPath(new URL("../../../packages/cli/bin/piano.mjs", import.meta.url));

/** The task each guard submits; the fake worker ignores its content, but the
 * stage prompts embed it, so it must be present like a real run's. */
export const GUARD_PROMPT =
  "Tune kernel.py in a loop: each iteration proposes two strategies, races them, and keeps the measured winner. "
  + "Write your results to kernel.py only.";

/** An isolated `$HOME/.piano/agent.config.json` that redirects the pi-cli
 * adapter to the deterministic stand-in. Nothing provider-facing: this avoids
 * the developer's credential-bearing config entirely. */
export async function createFakeHarnessHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "piano-tournament-guard-home-"));
  await mkdir(join(home, ".piano"), { recursive: true });
  await writeFile(
    join(home, ".piano", "agent.config.json"),
    JSON.stringify({ piCli: { bin: FAKE_AGENT_PATH } }),
    { mode: 0o600 },
  );
  return home;
}

/** Workspace seed matching the guard workflow's stage expectations: a shared
 * source `kernel.py` plus the current-best/state artifacts the benchmark
 * contract references. */
export async function seedGuardWorkspace(workspace: string): Promise<void> {
  await writeFile(join(workspace, "kernel.py"), "baseline\n");
  await mkdir(join(workspace, "state"), { recursive: true });
  await writeFile(join(workspace, "state", "current-best.py"), "baseline\n");
  await writeFile(join(workspace, "state", "tuning-state.json"), JSON.stringify({
    current_best: { path: "state/current-best.py", metric: { name: "tflops", best: 1, direction: "higher" } },
    history: [],
  }));
}

/** Child environment for a guard run: isolated HOME (so the developer's own
 * `~/.piano` is never touched), the trace file for the fake worker, and the
 * harness-home scratch pointed into the isolated home instead of the shared
 * test default. */
export function guardEnvironment(home: string, tracePath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    PIANO_FAKE_TRACE: tracePath,
    PIANO_HARNESS_HOME_ROOT: join(home, ".piano", "harness"),
  };
}

export interface TraceEntry {
  readonly stage: string;
  readonly kernelAtEntry: string;
}

export async function readTrace(tracePath: string): Promise<readonly TraceEntry[]> {
  return (await readFile(tracePath, "utf8")).trim().split("\n").map((line) => {
    const [stage = "unknown", kernelAtEntry = ""] = line.split("\t");
    return { stage: stage ?? "unknown", kernelAtEntry };
  });
}

export interface SelectionRecord {
  readonly outcome: string;
  readonly winnerKey?: string;
  readonly carrying?: { readonly kind: string; readonly reason?: string };
}

export async function readSelectionRecords(runDir: string): Promise<readonly SelectionRecord[]> {
  const text = await readFile(join(runDir, "eval-metrics", "selection.jsonl"), "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as SelectionRecord);
}

/** The run directory a fresh guard run created under the isolated home, i.e.
 * the one id not present in `before` (parity's detection trick). */
export async function findNewRun(home: string, before: ReadonlySet<string>): Promise<string> {
  const runs = join(home, ".piano", "runs");
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const ids = (await readdir(runs).catch(() => [] as string[])).filter((id) => !before.has(id));
    if (ids.length === 1 && ids[0] !== undefined) return join(runs, ids[0]);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no single new run directory under ${runs}`);
}

/** Run-completion evidence the guards share across frontends. */
export async function readRunTrajectoryStatus(runDir: string): Promise<string> {
  const status = JSON.parse(await readFile(join(runDir, "status.json"), "utf8")) as { status?: string };
  return status.status ?? "missing";
}

export async function listRunIds(home: string): Promise<ReadonlySet<string>> {
  return new Set(await readdir(join(home, ".piano", "runs")).catch(() => [] as string[]));
}

/** The core region-exit claims, shared verbatim by the non-TUI and TUI
 * guards: two per-iteration carried selections, the trace ordering showing the
 * carry land between iterations, the carried source, the two exit-time log
 * records, and cleaned slot lanes. */
export async function assertRegionExitEvidence(input: {
  runDir: string;
  tracePath: string;
  workspace: string;
}): Promise<void> {
  const records = await readSelectionRecords(input.runDir);
  expect(records).toHaveLength(2);
  expect(records.map((record) => record.outcome)).toEqual(["carried", "carried"]);
  expect(records.map((record) => record.carrying?.kind)).toEqual(["delta-applied", "delta-applied"]);
  expect(records[0]?.winnerKey).toContain("iter-0");
  expect(records[0]?.winnerKey).toMatch(/slot-1$/);
  expect(records[1]?.winnerKey).toContain("iter-1");
  expect(records[1]?.winnerKey).toMatch(/slot-1$/);

  expect((await readFile(join(input.workspace, "kernel.py"), "utf8")).trim()).toBe("kernel-1");

  // Ordering — the regression these guards exist for. The fake records the
  // stage and the kernel content at every turn's entry, so the carry must
  // land at the region exit, between iterations: the second propose already
  // sees the first iteration's winner. Under run-end finalization it would
  // still see the baseline, failing this.
  const trace = await readTrace(input.tracePath);
  const proposeEntries = trace.filter((entry) => entry.stage === "tune.propose");
  expect(proposeEntries.map((entry) => entry.kernelAtEntry)).toEqual(["baseline", "kernel-1"]);
  expect(trace.some((entry) => entry.stage.startsWith("$consolidate/"))).toBe(false);
  // Iteration 1's lane snapshots are taken from the carried source:
  // its implement turns start from iter-0's winner, not the baseline.
  const secondRoundImplements = trace.filter((entry) => entry.stage === "tune.race.implement").slice(2);
  expect(secondRoundImplements).toHaveLength(2);
  for (const entry of secondRoundImplements) {
    expect(entry.kernelAtEntry).toBe("kernel-1");
  }

  // The decision was logged at each region exit (twice), and no slot lane
  // survives: cleanup ran per exit, not deferred to the run-end backstop.
  const log = await readFile(join(input.runDir, "system-log", "log.jsonl"), "utf8");
  expect((log.match(/workspace\.winner\.consolidated/g) ?? []).length).toBe(2);
  const workspacesRoot = join(input.runDir, "workspaces");
  const lanes = await readdir(workspacesRoot).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  });
  expect(lanes).toEqual([]);
}
