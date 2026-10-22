// Shared plumbing for the resume e2e guards. The session-tier guard
// (tests/cli/tuning-continue-real-workers.test.ts) and the PTY guard
// (tests/tui/tuning-resume-continue.pty.test.ts) drive the same fixture
// workflow through real `piano` code with the same deterministic codex-CLI
// stand-in, so the isolated environment, workspace seed, ledger readers, and
// the shared evidence assertions live here once.
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const FAKE_CODEX_PATH = fileURLToPath(new URL("./fake-codex.mjs", import.meta.url));
export const WORKFLOW_PATH = fileURLToPath(new URL("./workflow.yml", import.meta.url));
export const PIANO_ENTRYPOINT = fileURLToPath(new URL("../../../packages/cli/bin/piano.mjs", import.meta.url));

/** The task both guards submit; the fake worker ignores its content, but the
 * stage prompts embed it, so it must be present like a real run's. */
export const RESUME_PROMPT =
  "Tune kernel.py in a loop: each iteration proposes two strategies, races them, and keeps the measured winner. "
  + "Write your results to kernel.py only.";

/** Wedge the first propose of iteration 1 (by then iteration 0 is accepted
 * evidence in full), which is the breaking point both guards resume from. */
export const PAUSE_AT = "propose:iter-1";

/** One row of the fake worker's resume ledger (TSV, see fake-codex.mjs). */
export interface LedgerRow {
  readonly index: number;
  /** `resumed` only when the engine asked for the thread AND its store had
   * history; anything else is `opened` — the silent-restart defect signal. */
  readonly mode: "opened" | "resumed";
  readonly stage: string;
  readonly invocation: string;
  readonly threadId: string;
  readonly priorTurns: number;
  readonly sessionFile: string;
  readonly cwd: string;
  readonly ts: string;
}

export interface ResumeRunHome {
  readonly home: string;
  readonly store: string;
  readonly ledger: string;
  readonly runsRoot: string;
}

/** An isolated `$HOME/.piano/agent.config.json` that redirects the codex
 * adapter to the deterministic stand-in, plus the fake's own evidence paths
 * (session store + resume ledger) under the same home. Nothing
 * provider-facing: this avoids the developer's credential-bearing config
 * entirely. */
export async function createResumeHarnessHome(): Promise<ResumeRunHome> {
  const home = await mkdtemp(join(tmpdir(), "piano-resume-guard-home-"));
  await mkdir(join(home, ".piano"), { recursive: true });
  await writeFile(
    join(home, ".piano", "agent.config.json"),
    JSON.stringify({ codex: { bin: FAKE_CODEX_PATH } }),
    { mode: 0o600 },
  );
  return {
    home,
    store: join(home, "fake-store"),
    ledger: join(home, "fake-ledger.tsv"),
    runsRoot: join(home, ".piano", "runs"),
  };
}

/** Environment for the fake worker. The PTY guard hands this to the spawned
 * `piano` process; the session guard stubs the same variables in-process
 * (children inherit them through the adapter's childEnv). */
export function resumeEnvironment(
  paths: Pick<ResumeRunHome, "home" | "store" | "ledger">,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    HOME: paths.home,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    PIANO_FAKE_SESSION_STORE: paths.store,
    PIANO_FAKE_RESUME_LEDGER: paths.ledger,
    PIANO_FAKE_PAUSE_AT: PAUSE_AT,
    PIANO_FAKE_PAUSE_MS: "600000",
    PIANO_HARNESS_HOME_ROOT: join(paths.home, ".piano", "harness"),
    ...extra,
  };
}

/** Workspace seed matching the fixture's stage expectations: a shared source
 * `kernel.py` plus the current-best/state artifacts the benchmark contract
 * references (same shape the tournament guards seed). */
export async function seedWorkspace(workspace: string): Promise<void> {
  await writeFile(join(workspace, "kernel.py"), "baseline\n");
  await mkdir(join(workspace, "state"), { recursive: true });
  await writeFile(join(workspace, "state", "current-best.py"), "baseline\n");
  await writeFile(join(workspace, "state", "tuning-state.json"), JSON.stringify({
    current_best: { path: "state/current-best.py", metric: { name: "tflops", best: 1, direction: "higher" } },
    history: [],
  }));
}

export async function readLedger(ledgerPath: string): Promise<LedgerRow[]> {
  const text = await readFile(ledgerPath, "utf8").catch(() => "");
  return text.split("\n").filter((line) => line.trim() !== "").map((line, index) => {
    const [mode, stage, invocation, threadId, priorTurns, sessionFile, cwd, ts] = line.split("\t");
    return {
      index,
      mode: mode as LedgerRow["mode"],
      stage: stage ?? "",
      invocation: invocation ?? "",
      threadId: threadId ?? "",
      priorTurns: Number(priorTurns ?? "0"),
      sessionFile: sessionFile ?? "",
      cwd: cwd ?? "",
      ts: ts ?? "",
    };
  });
}

/** Poll the ledger until `predicate` holds for its rows. The guards' only
 * timing hook: the fake worker writes its row before it can wedge, so the row
 * is the deterministic signal that the target turn is open. */
export async function waitForLedger(
  ledgerPath: string,
  predicate: (rows: readonly LedgerRow[]) => boolean,
  label: string,
  timeoutMs = 120_000,
): Promise<LedgerRow[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await readLedger(ledgerPath);
    if (predicate(rows)) return rows;
    if (Date.now() >= deadline) {
      throw new Error(
        `waitForLedger(${label}) timed out after ${timeoutMs}ms; rows:\n`
        + rows.map((row) => `  ${row.index}: ${row.mode} ${row.stage} ${row.invocation}`).join("\n"),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The row where the run was wedged: the first propose of iteration 1. */
export function pauseRow(rows: readonly LedgerRow[]): LedgerRow {
  const row = rows.find((entry) => entry.stage.endsWith("propose") && entry.invocation.includes("iter-1"));
  if (row === undefined) throw new Error(`no paused propose row in ledger:\n${JSON.stringify(rows, null, 2)}`);
  return row;
}

export interface RunStatusView {
  readonly status?: string;
  readonly actors?: Record<string, {
    readonly harness?: string;
    readonly sessionId?: string;
    readonly transcriptPath?: string;
    readonly turns?: number;
    readonly continuation?: { readonly nativeSessionId?: string; readonly sessionId?: string };
  }>;
  readonly jobs?: Array<{
    readonly jobOrdinal?: number;
    readonly accepted?: readonly { readonly invocationId: string; readonly stageId: string }[];
    readonly attempts?: Readonly<Record<string, number>>;
    readonly regions?: Readonly<Record<string, unknown>>;
  }>;
}

export async function readStatus(runDir: string): Promise<RunStatusView> {
  return JSON.parse(await readFile(join(runDir, "status.json"), "utf8")) as RunStatusView;
}

export async function waitForStatus(
  runDir: string,
  status: string,
  label: string,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const current = (await readStatus(runDir).catch(() => undefined))?.status;
    if (current === status) return;
    if (Date.now() >= deadline) {
      throw new Error(`waitForStatus(${label}) timed out after ${timeoutMs}ms; last status: ${current ?? "unreadable"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The run directory a fresh guard run created under the isolated home, i.e.
 * the one id not present in `before` (the tournament guards' detection trick). */
export async function findNewRun(home: ResumeRunHome, before: ReadonlySet<string>): Promise<string> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const ids = (await readdir(home.runsRoot).catch(() => [] as string[])).filter((id) => !before.has(id));
    if (ids.length === 1 && ids[0] !== undefined) return join(home.runsRoot, ids[0]);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no single new run directory under ${home.runsRoot}`);
}

export async function listRunIds(home: ResumeRunHome): Promise<ReadonlySet<string>> {
  return new Set(await readdir(home.runsRoot).catch(() => [] as string[]));
}

/** The core resume claims, shared verbatim by the session-tier and PTY
 * guards. `runDir` is the finished (completed) run both processes shared.
 *
 * What "resumed from the breaking point, not from the start" means as
 * evidence, from both sides of the seam:
 *  - the ENGINE side: iteration 0's invocations were never started again
 *    (one `stage-started` each), the wedged propose ran exactly twice
 *    (attempt 1 interrupted, attempt 2 after `/continue`), iteration 0's
 *    tournament region finalized exactly once, and the run stayed ONE job;
 *  - the WORKER side (the fake's ledger): no iteration-0 turn after the pause
 *    row, every actor's conversation was reopened rather than restarted
 *    (`resumed` + prior turns on every row after the actor's first), and the
 *    consolidation turns reused the winning slot's thread. */
export async function assertResumeEvidence(input: {
  runDir: string;
  runId: string;
  workspace: string;
  ledgerPath: string;
}): Promise<void> {
  const rows = await readLedger(input.ledgerPath);
  const ledgerDump = rows
    .map((row) => `  ${row.index}: ${row.mode}\t${row.stage}\t${row.invocation}\t${row.threadId}\tprior=${row.priorTurns}`)
    .join("\n");
  const context = (message: string): string => `${message}; ledger:\n${ledgerDump}`;

  // ——— The run finished, as ONE job: /continue repeated job 1's ordinal
  // instead of opening a second job.
  const status = await readStatus(input.runDir);
  expect(status.status, context("run did not complete")).toBe("completed");
  expect(status.jobs?.map((job) => job.jobOrdinal)).toEqual([1]);

  const paused = pauseRow(rows);

  // ——— WORKER side: nothing from iteration 0 ran again after the pause.
  const after = rows.filter((row) => row.index > paused.index);
  expect(after.length, context("nothing ran after the pause")).toBeGreaterThan(0);
  expect(
    after.filter((row) => row.invocation.includes("iter-0")).map((row) => row.stage),
    context("iteration 0 re-ran after the pause"),
  ).toEqual([]);
  // After the pause the run only finished iteration 1: the wedged propose
  // (attempt 2), two implements, two benches, one consolidation.
  expect(
    after.map((row) => row.stage).sort(),
    context("unexpected post-pause turn set"),
  ).toEqual([
    "$consolidate/job-1/tune/iter-1/tune.race/slot-1",
    "tune.propose",
    "tune.race.bench",
    "tune.race.bench",
    "tune.race.implement",
    "tune.race.implement",
  ].sort());

  // ——— WORKER side: every actor's conversation was reopened, never
  // restarted. Grouped by thread: the first row may be `opened` (that is the
  // actor's birth), every later row must be `resumed` with prior turns —
  // proving the fake read real history back from its session file, which it
  // only does when the engine handed the thread id back on argv.
  const byThread = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    byThread.set(row.threadId, [...(byThread.get(row.threadId) ?? []), row]);
  }
  // propose + 2 implement lanes + 2 bench lanes = 5 actor conversations.
  expect(byThread.size, context("unexpected actor/thread count")).toBe(5);
  for (const [threadId, threadRows] of byThread) {
    const rest = threadRows.slice(1);
    expect(
      rest.every((row) => row.mode === "resumed" && row.priorTurns > 0),
      context(`thread ${threadId} was restarted instead of resumed`),
    ).toBe(true);
  }

  // The propose actor is the one the pause hit: exactly three turns —
  // iteration 0 (opened), the wedged attempt (resumed), and the post-continue
  // attempt (resumed, having read the wedged attempt's user record back).
  const proposeRows = rows.filter((row) => row.stage.endsWith("propose"));
  expect(proposeRows, context("unexpected propose rows")).toHaveLength(3);
  expect(new Set(proposeRows.map((row) => row.threadId)).size, context("propose changed threads")).toBe(1);
  expect(proposeRows.map((row) => row.mode)).toEqual(["opened", "resumed", "resumed"]);
  expect(proposeRows.map((row) => row.priorTurns)).toEqual([0, 1, 2]);
  expect(proposeRows[2]!.index, context("attempt 2 ran before the pause")).toBeGreaterThan(paused.index);

  // ——— ENGINE side: what the state document holds. Iteration 0's stages
  // were rebuilt from evidence (one attempt each, ever); the wedged propose
  // ran twice (attempt 1 before the pause, attempt 2 after); iteration 1's
  // race stages ran once each, after the pause.
  const job = status.jobs?.[0];
  expect(job, context("the state document names no job")).toBeDefined();
  const attempts = job?.attempts ?? {};
  const countOf = (invocationId: string): number => attempts[invocationId] ?? 0;
  expect(countOf("tune.propose@tune/iter-0"), context("iter-0 propose restarted")).toBe(1);
  expect(countOf("tune.propose@tune/iter-1"), context("wedged propose did not re-run exactly once")).toBe(2);
  for (const slot of [0, 1]) {
    for (const stage of ["implement", "bench"]) {
      expect(
        countOf(`tune.race.${stage}@tune/iter-0/tune.race/slot-${slot}`),
        context(`iter-0 ${stage} slot-${slot} restarted`),
      ).toBe(1);
      expect(
        countOf(`tune.race.${stage}@tune/iter-1/tune.race/slot-${slot}`),
        context(`iter-1 ${stage} slot-${slot} missing`),
      ).toBe(1);
    }
  }
  // Iteration 0's tournament region finalized exactly once — the continue
  // skipped the finalized region instead of re-deciding it — and the loop
  // region itself finalized once, when the completed job bound its iterations.
  expect(Object.keys(job?.regions ?? {}).sort(), context("region finalizations")).toEqual([
    "tune",
    "tune/iter-0/tune.race",
    "tune/iter-1/tune.race",
  ]);

  // ——— ENGINE side: the actor table agrees with the worker ledger. The
  // propose actor took exactly two accepted turns (iteration 0 + the
  // post-continue attempt; the interrupted attempt does not count), and its
  // session id is the thread the fake actually kept history for.
  const proposeActor = status.actors?.[`v2/${input.runId}/codex/basic/root`];
  expect(proposeActor, context("propose actor missing from status.json")).toBeDefined();
  expect(proposeActor?.turns, context("propose actor turn count")).toBe(2);
  expect(proposeActor?.sessionId, context("propose actor session drifted")).toBe(proposeRows[0]!.threadId);
  // The winner's bench actor also carried both consolidations on its own
  // conversation: 2 bench turns + 2 consolidation turns.
  const winnerActor = status.actors?.[`v2/${input.runId}/codex/triton-benchmark-store/tune.race/slot-1`];
  expect(winnerActor?.turns, context("winner bench actor turn count")).toBe(4);
  // Every actor the ledger saw is in the engine's table under its thread id.
  const actorSessionIds = Object.values(status.actors ?? {}).map((actor) => actor.sessionId);
  for (const threadId of byThread.keys()) {
    expect(actorSessionIds, context(`thread ${threadId} missing from the actor table`)).toContain(threadId);
  }

  // ——— Consolidation reused the winner's conversation: each $consolidate
  // turn ran on the thread of the same iteration's winning bench slot
  // (slot-1 wins every race by construction).
  const consolidateRows = rows.filter((row) => row.stage.startsWith("$consolidate/"));
  expect(consolidateRows, context("consolidation turns")).toHaveLength(2);
  for (const [iteration, row] of consolidateRows.entries()) {
    const winnerBench = rows.find((entry) => entry.stage.endsWith(".bench")
      && entry.invocation.includes(`iter-${iteration}`)
      && entry.invocation.includes("slot-1"));
    expect(winnerBench, context(`no winning bench row for iter-${iteration}`)).toBeDefined();
    expect(row.threadId, context(`consolidation of iter-${iteration} left the winner's thread`))
      .toBe(winnerBench!.threadId);
    expect(row.mode, context(`consolidation of iter-${iteration} restarted the winner's thread`)).toBe("resumed");
  }

  // ——— Business outcome identical to the tournament guards': the winner was
  // consolidated into the shared source and both iterations carried.
  expect((await readFile(join(input.workspace, "kernel.py"), "utf8")).trim()).toBe("kernel-1");
  const selections = (await readFile(join(input.runDir, "eval-metrics", "selection.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { outcome?: string });
  expect(selections.map((record) => record.outcome)).toEqual(["carried", "carried"]);
}
