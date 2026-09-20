// Real-PTY coverage for the stage `signoff` primitive: the dialog is Piano's
// own UI (no harness extension), so these tests drive the live terminal and
// assert the human gate behaves — reject-with-feedback resumes the same actor,
// Escape cancels the run. Headless `-p --json` never consults the terminal at
// all: its gates are auto-approved and the run exits on its own.
//
// Like the real-harness chat test this needs working model credentials, so it
// is gated by PIANO_HARNESS_REAL_E2E=1.
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startTui, type TuiSession } from "./pty.js";

const runReal = process.env.PIANO_HARNESS_REAL_E2E === "1";
const templatePath = fileURLToPath(new URL("../../scripts/agent.config.template.json", import.meta.url));

async function waitFor(session: TuiSession, predicate: (screen: string) => boolean, description: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // Evaluate the predicate before the liveness guard: predicates that wait
    // for the child to exit (headless `-p`) must be able to return true.
    if (predicate(session.capture())) return;
    if (Date.now() >= deadline || !session.stillRunning()) {
      throw new Error(`timed out waiting for ${description}; screen:\n${session.capture()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const SIGNOFF_WORKFLOW = `version: 3
workflow:
  name: signoff-pty-e2e
  nodes:
    - stage:
        name: respond
        worker: basic
        harness: pi
        signoff: true
        from: []
`;

/** Isolated home like the parity e2e uses: template backfill merged with the
 * developer's real credentials, so the mission bootstrap never regenerates
 * the developer's own ~/.piano/harness concurrently with a live run. */
async function isolatedHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "piano-signoff-pty-home-"));
  await mkdir(join(home, ".piano"), { recursive: true });
  const merged = {
    ...JSON.parse(await readFile(templatePath, "utf8")) as Record<string, unknown>,
    ...JSON.parse(await readFile(join(process.env.HOME ?? "", ".piano", "agent.config.json"), "utf8")) as Record<string, unknown>,
  };
  await writeFile(join(home, ".piano", "agent.config.json"), `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  return home;
}

describe.skipIf(!runReal)(" stage sign-off over a real PTY", () => {
  let sessions: TuiSession[] = [];
  const roots: string[] = [];

  afterEach(async () => {
    for (const session of sessions) session.close();
    sessions = [];
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function signoffTui(args: readonly string[] = []): Promise<TuiSession> {
    const root = await mkdtemp(join(tmpdir(), "piano-signoff-pty-"));
    roots.push(root);
    const workflowPath = join(root, "signoff.yml");
    await writeFile(workflowPath, SIGNOFF_WORKFLOW);
    const home = await isolatedHome();
    roots.push(home);
    // The global vitest env points the generated harness home at a shared
    // scratch directory; with an isolated HOME this mission can keep its own.
    const session = startTui(home, ["--workflow", workflowPath, ...args], {
      HOME: home,
      PIANO_HARNESS_HOME_ROOT: join(home, ".piano", "harness"),
    });
    sessions.push(session);
    // A `-p` run never opens the interactive shell and never renders a
    // sign-off dialog; its only screen content is the NDJSON stream on stdout.
    if (args.includes("-p")) return session;
    await waitFor(session, (screen) => screen.includes("trajectory"), "the Piano TUI shell", 30_000);
    return session;
  }

  it("rejects with feedback, resumes the actor, and publishes after approval", async () => {
    const session = await signoffTui();
    session.key("Remember the secret word BANANA. Then reply with exactly DRAFT1. Do not use any tools.");
    session.key("Enter");
    await waitFor(session, (screen) => screen.includes("Sign off respond?"), "the first sign-off dialog");
    expect(session.capture()).toContain("Approve");
    expect(session.capture()).toContain("Reject — you should still work on:");
    // Move to "Reject — you should still work on:" and answer it with a note.
    session.key("\x1b[B");
    session.key("Enter");
    await waitFor(session, (screen) => screen.includes("You should still work on (respond)"), "the feedback prompt");
    session.key("That was wrong. Reply with exactly DRAFT2 and mention BANANA.");
    session.key("Enter");
    // The rejection resumes the same actor; the second attempt is round 2.
    await waitFor(session, (screen) => screen.includes("Sign off respond (round 2)?"), "the second sign-off dialog");
    session.key("Enter");
    await waitFor(session, (screen) => screen.includes("DRAFT2"), "the corrected answer published to the chat");
    expect(session.capture()).toContain("BANANA");
  }, 300_000);

  it("fails the run when the reviewer cancels with Escape", async () => {
    const session = await signoffTui();
    session.key("Reply with exactly PUBLISH. Do not use any tools.");
    session.key("Enter");
    await waitFor(session, (screen) => screen.includes("Sign off respond?"), "the sign-off dialog");
    session.key("Escape");
    await waitFor(session, (screen) =>
      screen.includes("workflow failed"), "the cancelled-review error");
    // The reason text lives in the expandable error detail (Ctrl+E), the same
    // presentation every failed run uses; expand it before asserting.
    session.key("\x05");
    await waitFor(session, (screen) =>
      screen.includes("sign-off"), "the expanded sign-off cancellation reason", 5_000);
    expect(session.capture()).not.toContain("run.completed");
    // The TUI survives the failed run and returns to its idle shell.
    expect(session.stillRunning()).toBe(true);
  }, 240_000);

  it("skips every sign-off gate and exits on its own for headless --json runs", async () => {
    const session = await signoffTui(["-p", "Reply with exactly READY. Do not use any tools.", "--json"]);
    // Nobody answers the keyboard in headless: the gate must not render a
    // dialog (that would hang the run) — the process exits by itself and the
    // NDJSON stream reports completion with the result text.
    await waitFor(session, () => !session.stillRunning(), "the headless run to exit", 60_000);
    expect(session.capture()).not.toContain("Sign off respond?");
    expect(session.capture()).toContain("READY");
  }, 240_000);
});
