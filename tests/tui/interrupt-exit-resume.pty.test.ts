// Real-PTY coverage for the half-way stop UX, as ONE continuous flow: a live
// model turn is interrupted with Escape, `/exit` hands the shell back on its
// own (no Ctrl+C, no lingering process), the interrupted run is left on disk
// paused with a resumable harness session, and `piano resume <run-id>` replays
// that conversation with the interrupted turn labeled honestly.
//
// Everything here runs against the real provider, which is the whole reason this
// tier exists: the engine, session and TUI tiers drive the same arc with a
// scripted runner, so none of them can see a real adapter produce a session that
// cannot actually be resumed. This is the only place that can.
//
// It is one flow and one HOME on purpose. The two `startTui` calls are two
// PROCESSES because `piano resume` is a process-level command, not two phases to
// be set up separately: the second reads the state the first left behind, so the
// home has to survive between them. Keeping it alive is the entire fix for this
// file — the first session used to be closed mid-test, and `TuiSession.close()`
// removes the home, so the second half could never find the run it was resuming.
// Closing is `afterEach`'s job.
//
// The detailed shape of what lands on disk — `resume.json` per-actor turns,
// staging-file recovery, the actor conversation surviving an interrupt — is
// pinned deterministically and ungated at the tiers that own it
// (tests/workflow/esc-pauses-run.test.ts, tests/cli/session-pause-resume-arc.test.ts,
// tests/tui/pause-exit-resume.test.ts). This file asserts only what has to be
// true for those claims to hold against a REAL provider.
import { afterEach, describe, expect, it } from "vitest";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startTui, waitForScreen, type TuiSession } from "./pty.js";
import { isolatedRealHome } from "./real-home.js";

const runReal = process.env.PIANO_HARNESS_REAL_E2E === "1";

const LONG_WORKFLOW = `version: 3
workflow:
  name: esc-exit-resume-e2e
  nodes:
    - stage:
        name: respond
        worker: basic
        harness: pi
        from: []
`;

describe.skipIf(!runReal)("Escape, /exit and /resume over a real PTY", () => {
  const sessions: TuiSession[] = [];
  // `close()` also removes the session's home, so this is the only place either
  // session is torn down — the resumed process needs the first one's home.
  afterEach(() => {
    for (const session of sessions.splice(0)) session.close();
  });

  it("interrupts a live turn, exits without a forced kill, and resumes the same run", async () => {
    const { home, env } = await isolatedRealHome("piano-esc-pty-home-");
    const workflowPath = join(home, "workflow.yml");
    await writeFile(workflowPath, LONG_WORKFLOW);

    // ——— An interrupted turn, and an exit that needs no Ctrl+C.
    const first = startTui(home, ["--workflow", workflowPath], env);
    sessions.push(first);
    await waitForScreen(first, (screen) => screen.includes("/exit"), "TUI opened");
    // The prompt keeps the model streaming for tens of seconds, so Escape lands
    // mid-stream rather than on a turn that already finished.
    first.key("Write the numbers from 1 to 2000, one per line, no commentary.\r");
    await waitForScreen(first, (screen) => /1\r?\n2\r?\n3/.test(screen) || screen.includes("tokens"), "model started");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    first.key("Escape");
    await waitForScreen(first, (screen) => screen.includes("interrupted"), "interrupted turn", 60_000);
    // A lingering child process or stuck finalizer used to force Ctrl+C here.
    first.key("/exit\r");
    await waitForScreen(first, () => !first.stillRunning(), "clean process exit", 30_000);

    // ——— What the real provider's abort left behind: one run, paused, with a
    // session a later process can pick up. Without this the resume below would
    // have nothing to resume and the assertions after it would be meaningless.
    const runsRoot = join(home, ".piano", "runs");
    const runIds = await readdir(runsRoot);
    expect(runIds).toHaveLength(1);
    const runId = runIds[0]!;
    const progress = JSON.parse(await readFile(join(runsRoot, runId, "status.json"), "utf8")) as { status?: string };
    expect(progress.status).toBe("paused");
    const resumeState = JSON.parse(await readFile(join(runsRoot, runId, "resume.json"), "utf8")) as {
      actors?: Record<string, { sessionId?: string; continuation?: unknown }>;
    };
    const actor = Object.values(resumeState.actors ?? {})[0];
    expect(actor?.sessionId).toBeTruthy();
    expect(actor?.continuation).toBeDefined();

    // ——— A second process takes the run over and replays it honestly.
    const second = startTui(home, ["resume", runId], env);
    sessions.push(second);
    await waitForScreen(second, (screen) => screen.includes(`resumed ${runId}`), "takeover replay", 30_000);
    const replay = second.capture();
    expect(replay).toContain("interrupted");
    expect(replay).not.toContain("run failed");
    second.key("/exit\r");
    await waitForScreen(second, () => !second.stillRunning(), "clean exit after resume", 15_000);
  }, 300_000);
});
