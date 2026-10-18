// Process-level resume guard: the same half-way tuning arc as
// tests/cli/tuning-continue-real-workers.test.ts, but across TWO real `piano`
// processes on a pseudo-terminal — exactly the shape a developer hits:
//
//   process 1: piano --workflow <tuning fixture> → prompt → the fake codex
//              worker wedges on iteration 1's propose → Escape pauses the run
//              → /exit hands the shell back;
//   process 2: piano resume <run-id> (the workflow reloads from the run's own
//              trajectory) → /continue → iteration 0 is rebuilt from evidence
//              without a single worker turn, iteration 1 finishes, and every
//              worker that ran reopened its pre-pause conversation.
//
// Credential-free and deterministic like the other fake-worker guards
// (exit-arcs, tournament-workflow): isolated HOME, codex.bin → fake-codex.mjs,
// completion detected from the run's durable status.json, never from scraping
// transient panel rows. The engine/session tier twin pins the same evidence
// claims in-process; this file proves they hold across the process boundary.
import { mkdtemp as mkdtempAsync, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { startTui, waitForScreen, type TuiSession } from "./pty.js";
import {
  RESUME_PROMPT,
  WORKFLOW_PATH,
  assertResumeEvidence,
  createResumeHarnessHome,
  findNewRun,
  listRunIds,
  readLedger,
  resumeEnvironment,
  seedWorkspace,
  waitForStatus,
} from "../fixtures/resume-run/helpers.js";

const BANNER = "Piano: A Programmable Agent Workflow System.";
const ARC_TIMEOUT_MS = 300_000;

describe("tuning run paused half-way, resumed in a new process, continued from its cursor", () => {
  it("rebuilds iteration 0 from evidence and reopens every worker conversation across processes", async () => {
    const paths = await createResumeHarnessHome();
    const workspace = await mkdtempAsync(join(tmpdir(), "piano-resume-pty-ws-"));
    const env = resumeEnvironment(paths);
    const sessions: TuiSession[] = [];
    try {
      await seedWorkspace(workspace);
      const before = await listRunIds(paths);

      // ——— Process 1: run to the wedge, Escape, /exit.
      const first = startTui(paths.home, ["--workflow", WORKFLOW_PATH], env, workspace);
      sessions.push(first);
      await waitForScreen(first, (screen) => screen.includes(BANNER), "TUI opened", 60_000);
      first.key(`${RESUME_PROMPT}\r`);
      // The wedge: iteration 0 is complete evidence (6 turns) and iteration
      // 1's propose has announced its thread and is sleeping (row 7). The
      // ledger row is written before the fake can wedge, so it is the
      // deterministic signal that the target turn is open.
      await waitForLedgerRows(paths.ledger, 7);
      const runDir = await findNewRun(paths, before);
      first.key("Escape");
      await waitForStatus(runDir, "paused", "run paused after Escape", 60_000);
      first.key("/exit\r");
      await waitForScreen(first, () => !first.stillRunning(), "clean process exit", 60_000);

      // ——— Process 2: `piano resume <run-id>` takes the run over (the
      // workflow reloads from the trajectory), then `/continue` picks the
      // paused job up from its cursor.
      const runId = runDir.split("/").pop()!;
      const second = startTui(paths.home, ["resume", runId], env, workspace);
      sessions.push(second);
      await waitForScreen(second, (screen) => screen.includes(`resumed ${runId}`), "takeover replay", 60_000);
      second.key("/continue\r");
      await waitForStatus(runDir, "completed", "continued job completed", 180_000);
      second.key("/exit\r");
      await waitForScreen(second, () => !second.stillRunning(), "clean exit after continue", 60_000);

      // ——— The shared evidence claims (identical bundle the session-tier
      // twin asserts): no iteration-0 turn after the pause, every actor
      // conversation reopened rather than restarted, one job throughout.
      await assertResumeEvidence({ runDir, runId, workspace, ledgerPath: paths.ledger });
    } finally {
      if (process.env.GUARD_KEEP === undefined) {
        for (const session of sessions) session.close();
        await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } else {
        process.stderr.write(`guard evidence kept at ${workspace} / ${paths.home}\n`);
      }
    }
  }, ARC_TIMEOUT_MS);
});

/** Wait until the fake worker's ledger holds `count` rows. The pause row is
 * written before the wedge, so this is the deterministic "target turn is
 * open" signal the Escape is timed against. */
async function waitForLedgerRows(ledgerPath: string, count: number): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const rows = await readLedger(ledgerPath);
    if (rows.length >= count) {
      const last = rows[count - 1];
      if (last !== undefined && last.stage.endsWith("propose") && last.invocation.includes("iter-1")) return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for the wedged propose (row ${count}); ledger:\n`
        + (await readLedger(ledgerPath)).map((row) => `  ${row.index}: ${row.mode} ${row.stage} ${row.invocation}`).join("\n"));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
