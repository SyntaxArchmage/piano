// Real-run guard (non-TUI): the tournament region-exit semantics of
// finalizeTournament must hold when a genuine `piano` CLI process drives the
// workflow with genuine subprocess worker turns. The model is replaced by the
// deterministic pi-cli stand-in (tests/fixtures/tournament-real-run/) so the
// guard is credential-free and CI-stable; everything else — CLI process,
// engine, subprocess protocol, consolidation turn, workspace cleanup — is the
// real stack. The unit-level twin lives in workflow-execution.test.ts
// ("decides a loop-nested tournament at every region exit"); this is the
// end-to-end proof of the same ordering.
import { describe, expect, it } from "vitest";
import { spawn as spawnProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GUARD_PROMPT,
  PIANO_ENTRYPOINT,
  WORKFLOW_PATH,
  assertRegionExitEvidence,
  createFakeHarnessHome,
  findNewRun,
  guardEnvironment,
  listRunIds,
  readRunTrajectoryStatus,
  seedGuardWorkspace,
} from "../fixtures/tournament-real-run/helpers.js";

// Headless `piano -p` with tsx cold start plus a dozen deterministic
// subprocess turns is seconds; bind generously, nowhere near a real-model
// budget.
const RUN_TIMEOUT_MS = 180_000;

describe("tournament region-exit through the real CLI (non-TUI)", () => {
  it("consolidates each iteration's winner at the race exit, before the next iteration runs", async () => {
    const home = await createFakeHarnessHome();
    const workspace = await mkdtemp(join(tmpdir(), "piano-tournament-guard-ws-"));
    // The trace lives in the evidence home, not the workspace: slot cleanup
    // prunes the source tree, and run evidence belongs under `.piano/runs`.
    const tracePath = join(home, "fake-trace.tsv");
    try {
      await seedGuardWorkspace(workspace);
      const before = await listRunIds(home);

      const exitCode = await new Promise<number>((resolve, reject) => {
        const child = spawnProcess(
          process.execPath,
          [PIANO_ENTRYPOINT, "--workflow", WORKFLOW_PATH, "-p", GUARD_PROMPT],
          { cwd: workspace, env: guardEnvironment(home, tracePath) },
        );
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error(`CLI timed out after ${RUN_TIMEOUT_MS}ms; stdout=${stdout.slice(-2000)}; stderr=${stderr.slice(-2000)}`));
        }, RUN_TIMEOUT_MS);
        child.stdout.on("data", (chunk) => { stdout += String(chunk); });
        child.stderr.on("data", (chunk) => { stderr += String(chunk); });
        child.on("error", (error) => { clearTimeout(timer); reject(error); });
        child.on("exit", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve(0);
          else reject(new Error(`headless exited ${code}; stdout=${stdout.slice(-2000)}; stderr=${stderr.slice(-2000)}`));
        });
      });
      expect(exitCode).toBe(0);

      const runDir = await findNewRun(home, before);
      expect(await readRunTrajectoryStatus(runDir)).toBe("completed");
      await assertRegionExitEvidence({ runDir, tracePath, workspace });
    } finally {
      if (!process.env.GUARD_KEEP) {
        // maxRetries: the engine may flush run evidence a moment after exit.
        await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } else {
        process.stderr.write(`guard evidence kept at ${workspace} / ${home}\n`);
      }
    }
  }, RUN_TIMEOUT_MS);
});
