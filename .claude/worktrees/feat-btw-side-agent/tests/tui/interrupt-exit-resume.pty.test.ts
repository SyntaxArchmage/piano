// Real-PTY coverage for the half-way stop UX, end to end: a live model turn is
// interrupted with Escape, `/exit` hands the shell back on its own (no Ctrl+C,
// no lingering process), the interrupted run is marked paused with a resumable
// harness session on disk, and `piano resume <run-id>` replays the conversation
// with the interrupted turn labeled honestly.
//
// Like the sign-off PTY test this needs working model credentials, so it is
// gated by PIANO_HARNESS_REAL_E2E=1.
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startTui, type TuiSession } from "./pty.js";

const runReal = process.env.PIANO_HARNESS_REAL_E2E === "1";
const templatePath = fileURLToPath(new URL("../../scripts/agent.config.template.json", import.meta.url));

async function waitFor(session: TuiSession, predicate: (screen: string) => boolean, description: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate(session.capture())) return;
    if (Date.now() >= deadline || !session.stillRunning()) {
      throw new Error(`timed out waiting for ${description}; screen:\n${session.capture()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

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

/** Isolated home like the sign-off e2e uses: template backfill merged with the
 * developer's real credentials, so the mission never regenerates the
 * developer's own ~/.piano/harness concurrently with a live run. */
async function isolatedHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "piano-esc-pty-home-"));
  await mkdir(join(home, ".piano"), { recursive: true });
  const merged = {
    ...JSON.parse(await readFile(templatePath, "utf8")) as Record<string, unknown>,
    ...JSON.parse(await readFile(join(process.env.HOME ?? "", ".piano", "agent.config.json"), "utf8")) as Record<string, unknown>,
  };
  await writeFile(join(home, ".piano", "agent.config.json"), `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  await writeFile(join(home, "workflow.yml"), LONG_WORKFLOW);
  return home;
}

describe.skipIf(!runReal)("Escape, /exit and /resume over a real PTY", () => {
  const sessions: TuiSession[] = [];
  afterEach(() => {
    for (const session of sessions.splice(0)) session.close();
  });

  it("interrupts a live turn, exits without a forced kill, and resumes the same run", async () => {
    const home = await isolatedHome();

    // Phase 1: a long generation, cut short. The prompt keeps the model
    // streaming for tens of seconds so Escape lands mid-turn.
    const first = startTui(home, ["--workflow", join(home, "workflow.yml")]);
    sessions.push(first);
    await waitFor(first, (screen) => screen.includes("/exit"), "TUI opened");
    first.key("Write the numbers from 1 to 2000, one per line, no commentary.\r");
    // Some visible model output before the interrupt: the turn is really open.
    await waitFor(first, (screen) => /1\r?\n2\r?\n3/.test(screen) || screen.includes("tokens"), "model started");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    first.key("Escape");
    await waitFor(first, (screen) => screen.includes("interrupted"), "interrupted turn", 60_000);

    // `/exit` must return the shell by itself — the bug being guarded: a
    // lingering child process or stuck finalizer used to force Ctrl+C.
    first.key("/exit\r");
    await waitFor(first, () => !first.stillRunning(), "clean process exit", 30_000);

    // The durable state says paused and carries the harness session the
    // interrupted turn opened.
    const runsRoot = join(home, ".piano", "runs");
    const runIds = (await readdir(runsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(runIds).toHaveLength(1);
    const runId = runIds[0]!;
    const progress = JSON.parse(await readFile(join(runsRoot, runId, "progress.json"), "utf8")) as { status?: string };
    expect(progress.status).toBe("paused");
    const resumeState = JSON.parse(await readFile(join(runsRoot, runId, "resume.json"), "utf8")) as {
      actors?: Record<string, { sessionId?: string; continuation?: unknown }>;
    };
    const actor = Object.values(resumeState.actors ?? {})[0];
    expect(actor?.sessionId).toBeTruthy();
    expect(actor?.continuation).toBeDefined();
    first.close();

    // Phase 2: `piano resume <run-id>` replays the interrupted conversation.
    const second = startTui(home, ["resume", runId]);
    sessions.push(second);
    await waitFor(second, (screen) => screen.includes(`resumed ${runId}`), "takeover replay", 30_000);
    const replay = second.capture();
    expect(replay).toContain("interrupted");
    expect(replay).not.toContain("run failed");
    second.key("/exit\r");
    await waitFor(second, () => !second.stillRunning(), "clean exit after resume", 15_000);
    second.close();
    await rm(home, { recursive: true, force: true });
  }, 300_000);
});
