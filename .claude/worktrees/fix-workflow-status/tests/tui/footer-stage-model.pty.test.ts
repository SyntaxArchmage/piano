// Real-PTY coverage for the light-blue model line in the footer's WORKFLOW
// column: the shipped binary, a real terminal, and a workflow whose stage
// declares `model:`. No prompt is submitted and no credentials are needed —
// the footer draws the DAG at boot, so this tier only pins that the model
// reaches a real screen under the stage name.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTui, type TuiSession } from "./pty.js";

const WORKFLOW = `version: 3
workflow:
  name: footer-model-pty
  nodes:
    - stage:
        name: implement
        worker: basic
        harness: pi
        model: qwen3.8-flash
        tools: [read, bash, edit, write]
        from: []
`;

// Terminals that speak an image protocol send the DAG as a picture instead of
// text. The developer's own terminal leaks these into the child through the
// inherited environment, so blank every one pi-tui probes plus Piano's sixel
// override: the text renderer must be what this test measures, in CI and on a
// Kitty/iTerm/WezTerm/Ghostty desktop alike.
const TEXT_ONLY = {
  PIANO_IMAGE_PROTOCOL: "none",
  TERM_PROGRAM: "",
  KITTY_WINDOW_ID: "",
  GHOSTTY_RESOURCES_DIR: "",
  WEZTERM_PANE: "",
  ITERM_SESSION_ID: "",
  TMUX: "",
} as const;

async function waitFor(session: TuiSession, predicate: (screen: string) => boolean, description: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate(session.capture())) return;
    if (Date.now() >= deadline || !session.stillRunning()) {
      throw new Error(`timed out waiting for ${description}; screen:\n${session.capture()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe("the footer's WORKFLOW column on a real terminal", () => {
  const sessions: TuiSession[] = [];
  const roots: string[] = [];

  afterEach(async () => {
    for (const session of sessions.splice(0)) session.close();
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });

  it("shows the stage model on the row under the stage name", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-footer-model-pty-"));
    roots.push(root);
    const workflowPath = join(root, "workflow.yml");
    await writeFile(workflowPath, WORKFLOW);
    const session = startTui(root, ["--workflow", workflowPath], { ...TEXT_ONLY });
    sessions.push(session);

    await waitFor(session, (screen) => screen.includes("qwen3.8-flash"), "the stage model in the footer");
    const rows = session.capture().split("\n");
    const modelRow = rows.findIndex((row) => row.includes("qwen3.8-flash"));
    expect(rows[modelRow - 1]).toContain("implement");
    // The footer stays inside the terminal: the model never widens a row.
    expect(rows.every((row) => row.length <= 120)).toBe(true);

    session.key("/exit");
    session.key("Enter");
    const deadline = Date.now() + 5000;
    while (session.stillRunning() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(session.stillRunning()).toBe(false);
  }, 60_000);
});
