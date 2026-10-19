// Real-provider guard for the claude resume chain: the full user arc across
// TWO real `piano` processes — prompt 1 stores a code word, `/exit`, then
// `piano resume <run-id>` and prompt 2 must recall it. The recall answer is
// the code word REVERSED, a string that appears nowhere in the replayed
// history, so a fresh (amnesiac) session cannot fake the assertion.
//
// What this exercises that the deterministic tiers cannot: the real claude
// CLI accepting `--resume <native-session-id>` with the gateway config, the
// adapter capturing the native id from the init frame, the engine persisting
// it through the actor-turn ledger, and the resumed process handing it back —
// one broken hop and prompt 2 starts a conversation that never heard the code
// word. The pi-harness sibling arc lives in interrupt-exit-resume.pty.test.ts
// (interrupt/pause shaped); this one is the memory claim, claude shaped.
//
// Gated: needs the developer's real model credentials
// (PIANO_HARNESS_REAL_E2E=1), like every file in this tier.
import { afterEach, describe, expect, it } from "vitest";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startTui, waitForScreen, type TuiSession } from "./pty.js";
import { isolatedRealHome } from "./real-home.js";
import { waitForStatus } from "../fixtures/resume-run/helpers.js";

const runReal = process.env.PIANO_HARNESS_REAL_E2E === "1";

const CODE_WORD = "BANANA-42";
const REVERSED = "24-ANANAB";

const CLAUDE_WORKFLOW = `version: 3
workflow:
  name: claude-resume-e2e
  nodes:
    - stage:
        name: respond
        worker: basic
        harness: claude
        from: []
`;

describe.skipIf(!runReal)("claude resume across two real processes", () => {
  const sessions: TuiSession[] = [];
  // close() removes the home, and the resumed process needs the first one's
  // run directory — teardown is afterEach's job, never mid-test.
  afterEach(() => {
    for (const session of sessions.splice(0)) session.close();
  });

  it("prompt 2 after `piano resume` recalls what prompt 1 stored", async () => {
    const { home, env } = await isolatedRealHome("piano-claude-resume-home-");
    const workflowPath = join(home, "workflow.yml");
    await writeFile(workflowPath, CLAUDE_WORKFLOW);

    // ——— Process 1: store the code word, then exit.
    const first = startTui(home, ["--workflow", workflowPath], env);
    sessions.push(first);
    await waitForScreen(first, (screen) => screen.includes("/exit"), "TUI opened");
    first.key(`Remember this code word exactly: ${CODE_WORD}. Reply with exactly one word: STORED\r`);
    // Wait on the stage's completion marker, never on the code word itself:
    // the echoed user message contains it from the moment Enter lands, and an
    // /exit that trusts the echo interrupts the turn before the model stores
    // anything — the resume below would then replay an empty conversation.
    await waitForScreen(first, (screen) => screen.includes("✓ done"), "turn 1 completed", 180_000);
    const runsRoot = join(home, ".piano", "runs");
    const runIds = await readdir(runsRoot);
    expect(runIds).toHaveLength(1);
    const runId = runIds[0]!;
    const runDir = join(runsRoot, runId);
    // The screen marker settles before the run's evidence does: /exit while
    // the finalizer is still writing interrupts it and the run lands as
    // paused, which is honest but not this test's claim. Wait for the
    // durable state, then exit.
    await waitForStatus(runDir, "completed", "run 1 completed on disk", 60_000);
    first.key("/exit\r");
    await waitForScreen(first, () => !first.stillRunning(), "clean process exit", 60_000);

    // ——— Process 2: resume the run and ask for the word backwards. The
    // reversed form appears nowhere in the replayed transcript, so seeing it
    // means the model really read the conversation the first process had.
    const second = startTui(home, ["resume", runId], env);
    sessions.push(second);
    await waitForScreen(second, (screen) => screen.includes(`resumed ${runId}`), "takeover replay", 60_000);
    second.key("Reply with the code word I gave you earlier, spelled backwards, and nothing else.\r");
    await waitForScreen(second, (screen) => screen.toUpperCase().includes(REVERSED), "resumed conversation recalled the code word", 180_000);
    await waitForStatus(runDir, "completed", "run 2 completed on disk", 60_000);
    second.key("/exit\r");
    await waitForScreen(second, () => !second.stillRunning(), "clean exit after resume", 60_000);

    // ——— Disk evidence: ONE actor took BOTH turns on ONE claude session —
    // the engine side of the same claim the screen just proved model-side.
    const status = JSON.parse(await readFile(join(runsRoot, runId, "status.json"), "utf8")) as {
      status?: string;
      actors?: Record<string, { sessionId?: string; turns?: number; continuation?: { nativeSessionId?: string } }>;
    };
    expect(status.status).toBe("completed");
    const actors = Object.values(status.actors ?? {});
    expect(actors).toHaveLength(1);
    expect(actors[0]?.turns).toBe(2);
    expect(actors[0]?.sessionId).toBeTruthy();
  }, 480_000);
});
