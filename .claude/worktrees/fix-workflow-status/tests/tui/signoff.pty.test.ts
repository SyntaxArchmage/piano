// Real-PTY coverage for the stage `signoff` primitive: the dialog is Piano's
// own UI (no harness extension), so these tests drive the live terminal and
// assert the human gate behaves — reject-with-feedback resumes the same actor,
// Escape cancels the run. Headless `-p --json` never consults the terminal at
// all: its gates are auto-approved and the run exits on its own.
//
// Like the real-harness chat test this needs working model credentials, so it
// is gated by PIANO_HARNESS_REAL_E2E=1.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTui, waitForScreen, type TuiSession } from "./pty.js";
import { isolatedRealHome } from "./real-home.js";

const runReal = process.env.PIANO_HARNESS_REAL_E2E === "1";

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

describe.skipIf(!runReal)(" stage sign-off over a real PTY", () => {
  let sessions: TuiSession[] = [];
  const roots: string[] = [];

  afterEach(async () => {
    for (const session of sessions) session.close();
    sessions = [];
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function signoffTui(args: readonly string[] = []): Promise<TuiSession> {
    // The workflow file goes in its own directory, the HOME comes from the
    // shared helper: both are torn down in `afterEach`.
    const root = await mkdtemp(join(tmpdir(), "piano-signoff-pty-"));
    roots.push(root);
    const workflowPath = join(root, "signoff.yml");
    await writeFile(workflowPath, SIGNOFF_WORKFLOW);
    const { home, env } = await isolatedRealHome("piano-signoff-pty-home-");
    roots.push(home);
    const session = startTui(home, ["--workflow", workflowPath, ...args], env);
    sessions.push(session);
    // A `-p` run never opens the interactive shell and never renders a
    // sign-off dialog; its only screen content is the NDJSON stream on stdout.
    if (args.includes("-p")) return session;
    await waitForScreen(session, (screen) => screen.includes("trajectory"), "the Piano TUI shell", 30_000);
    return session;
  }

  it("retries with a note, resumes the actor, and publishes after continuing", async () => {
    const session = await signoffTui();
    session.key("Remember the secret word BANANA. Then reply with exactly DRAFT1. Do not use any tools.");
    session.key("Enter");
    await waitForScreen(session, (screen) => screen.includes("Sign off respond?"), "the first sign-off dialog");
    expect(session.capture()).toContain("Continue — publish this result");
    expect(session.capture()).toContain("Retry — run this worker again");
    // Move to retry and answer it with a note.
    session.key("\x1b[B");
    session.key("Enter");
    await waitForScreen(session, (screen) => screen.includes("Retry without a note"), "the note prompt");
    session.key("That was wrong. Reply with exactly DRAFT2 and mention BANANA.");
    session.key("Enter");
    // The retry resumes the same actor; the second attempt is round 2.
    await waitForScreen(session, (screen) => screen.includes("Sign off respond (round 2)?"), "the second sign-off dialog");
    // Continue: this stage has no consumer, so there is no note step and one
    // Enter publishes it.
    session.key("Enter");
    await waitForScreen(session, (screen) => screen.includes("DRAFT2"), "the corrected answer published to the chat");
    expect(session.capture()).toContain("BANANA");
  }, 300_000);

  it("fails the run when the reviewer cancels with Escape", async () => {
    const session = await signoffTui();
    session.key("Reply with exactly PUBLISH. Do not use any tools.");
    session.key("Enter");
    await waitForScreen(session, (screen) => screen.includes("Sign off respond?"), "the sign-off dialog");
    session.key("Escape");
    await waitForScreen(session, (screen) =>
      screen.includes("workflow failed"), "the cancelled-review error");
    // The reason text lives in the expandable error detail (Ctrl+E), the same
    // presentation every failed run uses; expand it before asserting.
    session.key("\x05");
    await waitForScreen(session, (screen) =>
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
    await waitForScreen(session, () => !session.stillRunning(), "the headless run to exit", 60_000);
    expect(session.capture()).not.toContain("Sign off respond?");
    expect(session.capture()).toContain("READY");
  }, 240_000);
});
