// Real-run guard (TUI): the same fixture tournament through a real `piano`
// interactive shell on a pseudo-terminal. The point is not the model turns —
// those are deterministic and covered by the non-TUI guard and the unit twin
// in workflow-execution.test.ts — but that the region-exit finalization,
// consolidation, and cleanup complete under the real interactive UI, the run
// reaches `completed`, and the TUI survives to accept `/exit`. Driven exactly
// like basic-workflow-parity.e2e.test.ts (`script -qefc`, banner marker,
// stdin prompt, run-directory polling), so it tracks the shipped TUI surface
// rather than a test-local harness.
import { describe, it } from "vitest";
import { spawn as spawnProcess } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GUARD_PROMPT,
  PIANO_ENTRYPOINT,
  WORKFLOW_PATH,
  assertRegionExitEvidence,
  createFakeHarnessHome,
  guardEnvironment,
  listRunIds,
  seedGuardWorkspace,
} from "../fixtures/tournament-real-run/helpers.js";

// The TUI path adds ink startup and a stdin round-trip to the same work;
// still seconds against a real-model budget.
const RUN_TIMEOUT_MS = 240_000;

/** Launch the TUI with the fixture workflow, submit the guard prompt once the
 * face page is up, and resolve when the run's trajectory reports completed
 * (then close the shell with `/exit`). Mirrors parity's runTui mechanics. */
async function runTui(workspace: string, home: string, tracePath: string, before: ReadonlySet<string>): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawnProcess("script", ["-qefc", `${process.execPath} ${PIANO_ENTRYPOINT} --workflow ${WORKFLOW_PATH}`, "/dev/null"], {
      cwd: workspace,
      env: guardEnvironment(home, tracePath),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let submitted = false;
    let finished = false;
    let checkingCompletion = false;
    let completedRunDir: string | undefined;
    const runs = join(home, ".piano", "runs");
    const finishWhenCompleted = (): void => {
      if (!submitted || finished || checkingCompletion) return;
      checkingCompletion = true;
      void (async () => {
        try {
          const ids = (await readdir(runs).catch(() => [] as string[])).filter((id) => !before.has(id));
          if (ids.length === 1 && ids[0] !== undefined) {
            const trajectory = JSON.parse(await readFile(join(runs, ids[0], "trajectory.json"), "utf8")) as { status?: string };
            if (trajectory.status === "completed") {
              finished = true;
              completedRunDir = join(runs, ids[0]);
              // Ask the shell to quit; resolve only when the child is actually
              // gone (see the exit handler). Resolving earlier would let the
              // finally-block rm race the TUI's final run-directory writes.
              child.stdin.write("/exit\r");
            }
          }
        } catch {
          // The run directory appears before trajectory.json; retry on the next tick.
        } finally {
          checkingCompletion = false;
        }
      })();
    };
    const completionTimer = setInterval(finishWhenCompleted, 100);
    const timeout = setTimeout(() => {
      clearInterval(completionTimer);
      child.kill();
      reject(new Error(`TUI timed out after ${RUN_TIMEOUT_MS}ms: ${output.slice(-2000)}`));
    }, RUN_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      // Face-page headline as the "shell is up" marker before typing. It must
      // track the slogan in tui-face.ts: a stale marker never matches, so the
      // prompt is never submitted and the run dies on the timeout.
      if (!submitted && output.includes("Piano: A Programmable Agent Workflow System.")) {
        submitted = true;
        child.stdin.write(`${GUARD_PROMPT}\r`);
      }
      finishWhenCompleted();
    });
    child.on("error", (error) => { clearTimeout(timeout); clearInterval(completionTimer); reject(error); });
    child.on("exit", (exitCode) => {
      clearTimeout(timeout);
      clearInterval(completionTimer);
      if (finished && completedRunDir !== undefined) {
        // The run completed and the shell took `/exit` — the guard's premise.
        resolve(completedRunDir);
        return;
      }
      reject(new Error(exitCode === 0
        ? "TUI exited before the run completed"
        : `TUI exited ${exitCode}: ${output.slice(-2000)}`));
    });
  });
}

describe("tournament region-exit through the real TUI", () => {
  it("completes every per-iteration consolidation under the interactive shell", async () => {
    const home = await createFakeHarnessHome();
    const workspace = await mkdtemp(join(tmpdir(), "piano-tournament-guard-tui-"));
    // The trace lives in the evidence home, not the workspace: slot cleanup
    // prunes the source tree, and run evidence belongs under `.piano/runs`.
    const tracePath = join(home, "fake-trace.tsv");
    try {
      await seedGuardWorkspace(workspace);
      const before = await listRunIds(home);
      const runDir = await runTui(workspace, home, tracePath, before);
      // runTui resolves only on `trajectory.status === "completed"`, so the
      // run genuinely finished under the interactive shell; a workflow
      // failure would time the guard out instead.
      await assertRegionExitEvidence({ runDir, tracePath, workspace });
    } finally {
      // maxRetries: the engine may flush run evidence a moment after exit.
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }, RUN_TIMEOUT_MS);
});
