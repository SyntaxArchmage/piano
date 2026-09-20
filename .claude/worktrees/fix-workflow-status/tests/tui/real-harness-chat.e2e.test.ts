import { afterEach, describe, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTui, type TuiSession } from "./pty.js";

const runReal = process.env.PIANO_HARNESS_REAL_E2E === "1";
const configPath = `${process.env.HOME}/.piano/agent.config.json`;

async function waitFor(session: TuiSession, predicate: (screen: string) => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && session.stillRunning()) {
    const screen = session.capture();
    if (predicate(screen)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${description}; screen:\n${session.capture()}`);
}

function workflow(harness: "claude" | "dsh"): string {
  return `version: 3
workflow:
  name: ${harness}-chat-e2e
  nodes:
    - stage:
        name: respond
        worker: basic
        harness: ${harness}
        tools: [read]
        from: []
`;
}

describe.skipIf(!runReal)(" real harness chat area", () => {
  let sessions: TuiSession[] = [];
  const roots: string[] = [];

  afterEach(async () => {
    for (const session of sessions) session.close();
    sessions = [];
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  for (const harness of ["dsh", "claude"] as const) {
    it(`${harness} streams normalized output into the real chat area`, async () => {
      const root = await mkdtemp(join(tmpdir(), `piano-${harness}-chat-`));
      roots.push(root);
      const workflowPath = join(root, `${harness}.yml`);
      await writeFile(workflowPath, workflow(harness));
      const session = startTui(undefined, ["--workflow", workflowPath], {
        PIANO_USER_AGENT_CONFIG: configPath,
        HOME: process.env.HOME,
      });
      sessions.push(session);
      await waitFor(session, (screen) => screen.includes("trajectory"), "the Piano TUI shell");
      session.key("Respond exactly: READY");
      session.key("Enter");
      await waitFor(session, (screen) =>
        screen.includes("READY") &&
        screen.includes("↳ respond · basic  [deepseek-v4-flash]"),
      `${harness} chat output and normalized spawn marker`);
    }, 150_000);
  }
});
