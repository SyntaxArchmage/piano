// The half-way stop arc against REAL subprocess workers: a tuning loop runs
// until the fake codex worker wedges on iteration 1's propose, Escape pauses
// the run, the session exits, and a resumed session's `/continue` picks the
// job up from its cursor — iteration 0 is rebuilt from evidence without a
// single worker turn, and every worker that does run reopens the conversation
// it had before the pause (the fake's ledger records, per turn, whether its
// thread was `resumed` with prior history or silently `opened` fresh).
//
// The tier split: only "the model" is fake here (a real subprocess speaking
// the real codex exec NDJSON protocol, pointed at via PIANO_USER_AGENT_CONFIG);
// runSession, runTui, the engine, the subprocess adapter, and all disk
// evidence are production code. tests/tui/tuning-resume-continue.pty.test.ts
// pins the same arc across two real `piano` processes; the injected-runner
// tiers (continue-restart-arc, session-pause-resume-arc) cannot see the
// harness-side resume handle at all — this tier and the PTY one can.
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSession, createStagingSession } from "@piano/logging";
import { runSession } from "../../packages/cli/src/session-run.js";
import { FakeTerminal, plain, sleep, waitFor } from "../common/terminal.js";
import {
  PAUSE_AT,
  RESUME_PROMPT,
  WORKFLOW_PATH,
  assertResumeEvidence,
  createResumeHarnessHome,
  seedWorkspace,
  type LedgerRow,
  type ResumeRunHome,
} from "../fixtures/resume-run/helpers.js";

// prepareHarnessHomes writes the developer's own harness home; the session
// tests stub it (real harness config is exercised by the e2e suites). The
// workers themselves stay real: no agentRunner is injected anywhere below.
vi.mock("@piano/harness", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  prepareHarnessHomes: vi.fn(() => Effect.succeed({ agentOptions: {} })),
}));

/** One continuous arc; generous because a slow machine starves the pacing
 * waits, and every step here is driven by real subprocess turns. */
const wait = (label: string, check: () => boolean) => waitFor(label, check, 120_000);

function statusOf(runDir: string): { status?: string; jobs?: Array<{ accepted?: string[] }> } | undefined {
  try {
    return JSON.parse(readFileSync(join(runDir, "status.json"), "utf8")) as ReturnType<typeof statusOf>;
  } catch {
    return undefined;
  }
}

function ledgerRows(ledgerPath: string): LedgerRow[] {
  try {
    return readFileSync(ledgerPath, "utf8").split("\n").filter((line) => line.trim() !== "")
      .map((line, index) => {
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
  } catch {
    return [];
  }
}

/** Submit `/continue` until it takes effect (same gate the continue-restart
 * arc uses: a job command that lands while the previous turn is still being
 * released is dropped with "run the command again"). */
async function submitContinue(terminal: FakeTerminal, took: () => boolean): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (!took() && Date.now() < deadline) {
    terminal.onInput?.("/continue");
    terminal.onInput?.("\r");
    for (const until = Date.now() + 500; !took() && Date.now() < until;) await sleep(10);
  }
  expect(took(), "/continue never took effect").toBe(true);
}

describe("a tuning run paused half-way continues from its cursor with real subprocess workers", () => {
  let paths: ResumeRunHome | undefined;
  let workspace: string | undefined;

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (process.env.GUARD_KEEP !== undefined) {
      // Keep the evidence for scripts/inspect-run-resume.mjs; both processes
      // have exited by now, so nothing is left running.
      process.stderr.write(`guard evidence kept at ${workspace ?? "?"} / ${paths?.home ?? "?"}\n`);
      return;
    }
    for (const path of [paths?.home, workspace]) {
      if (path !== undefined) await rm(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  });

  it("rebuilds iteration 0 from evidence and reopens every worker conversation", async () => {
    paths = await createResumeHarnessHome();
    workspace = await mkdtemp(join(tmpdir(), "piano-resume-guard-ws-"));
    const home = paths;
    await seedWorkspace(workspace);
    // The subprocess adapter resolves codex.bin from the agent config, and the
    // fake reads its store/ledger/pause hooks from the environment; children
    // inherit all of it through the adapter's childEnv.
    vi.stubEnv("PIANO_USER_AGENT_CONFIG", join(home.home, ".piano", "agent.config.json"));
    vi.stubEnv("PIANO_FAKE_SESSION_STORE", home.store);
    vi.stubEnv("PIANO_FAKE_RESUME_LEDGER", home.ledger);
    vi.stubEnv("PIANO_FAKE_PAUSE_AT", PAUSE_AT);
    vi.stubEnv("PIANO_FAKE_PAUSE_MS", "600000");
    vi.stubEnv("PIANO_HARNESS_HOME_ROOT", join(home.home, ".piano", "harness"));

    // ——— Session A: run to the wedge, Escape, exit.
    const staging = createStagingSession({ root: workspace, cwd: workspace, runsRoot: home.runsRoot });
    const runId = staging.id;
    const runDir = join(home.runsRoot, runId);
    const terminalA = new FakeTerminal();
    const sessionA = Effect.runPromise(runSession(staging, {
      workflowPath: WORKFLOW_PATH,
      terminal: terminalA,
    }).pipe(Effect.provide(NodeFileSystem.layer)));
    await sleep(50);
    terminalA.onInput?.(RESUME_PROMPT);
    terminalA.onInput?.("\r");
    // The wedge: iteration 0 is complete evidence (6 turns), and iteration 1's
    // propose has announced its thread and is now sleeping (row 7).
    await wait("the run wedged on iteration 1's propose", () => {
      const rows = ledgerRows(home.ledger);
      return rows.length === 7
        && rows[6]!.stage.endsWith("propose")
        && rows[6]!.invocation.includes("iter-1");
    });
    terminalA.onInput?.("\x1b"); // Escape: interrupt, exactly like the real key
    await wait("the run ended as interrupted", () => plain(terminalA).includes("interrupted"));
    await wait("the run is paused", () => statusOf(runDir)?.status === "paused");

    // The paused job's cursor: iteration 0 accepted in full, the wedged
    // propose not accepted — this is what /continue will rebuild from.
    const accepted = statusOf(runDir)?.jobs?.[0]?.accepted ?? [];
    expect([...accepted].sort()).toEqual([
      "tune.propose@tune/iter-0",
      "tune.race.bench@tune/iter-0/tune.race/slot-0",
      "tune.race.bench@tune/iter-0/tune.race/slot-1",
      "tune.race.implement@tune/iter-0/tune.race/slot-0",
      "tune.race.implement@tune/iter-0/tune.race/slot-1",
    ]);
    terminalA.onInput?.("/exit");
    terminalA.onInput?.("\r");
    await sessionA;

    // ——— Session B: resume the run and continue the paused job.
    const resumed = await Effect.runPromise(
      createSession({ root: workspace, cwd: workspace, runsRoot: home.runsRoot, id: runId })
        .pipe(Effect.provide(NodeFileSystem.layer)),
    );
    const terminalB = new FakeTerminal();
    const sessionB = Effect.runPromise(runSession(resumed, {
      resumeRunId: runId,
      workflowPath: WORKFLOW_PATH,
      terminal: terminalB,
    }).pipe(Effect.provide(NodeFileSystem.layer)));
    await sleep(50);
    // The interrupted turn replays honestly before the session accepts input.
    await wait("the wedged turn replayed", () => plain(terminalB).includes("interrupted"));
    await submitContinue(terminalB, () => ledgerRows(home.ledger).length >= 8);
    await wait("the continued job completed", () => statusOf(runDir)?.status === "completed");
    terminalB.onInput?.("/exit");
    terminalB.onInput?.("\r");
    await sessionB;

    // ——— The shared evidence claims: no iteration-0 turn after the pause,
    // every actor conversation reopened (never restarted), one job throughout.
    await assertResumeEvidence({ runDir, runId, workspace, ledgerPath: home.ledger });
    expect(basename(runDir)).toBe(runId);
  }, 240_000);
});
