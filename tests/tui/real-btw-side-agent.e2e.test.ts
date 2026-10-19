import { afterEach, describe, expect, it } from "vitest";
import { parseTrajectory } from "@piano/logging";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { startTui, type TuiSession } from "./pty.js";

const runReal = process.env.PIANO_HARNESS_REAL_E2E === "1";
const configPath = `${process.env.HOME}/.piano/agent.config.json`;
const runsRoot = join(homedir(), ".piano", "runs");

/** A pi stage so the TUI opens with a real workflow graph. It is never
 * executed: these tests only ever submit `/btw` prompts, which is the point —
 * the side agent works without entering the mission's workflow. */
const WORKFLOW = `version: 3
workflow:
  name: btw-e2e
  nodes:
    - stage:
        name: respond
        worker: basic
        harness: pi
        tools: [read]
        from: []
`;

async function waitFor(
  session: TuiSession,
  predicate: () => Promise<boolean> | boolean,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && session.stillRunning()) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${description}; screen:\n${session.capture()}`);
}

const read = async (path: string): Promise<string> => {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
};

const runIds = async (): Promise<string[]> => {
  try {
    return await readdir(runsRoot);
  } catch {
    return [];
  }
};

/** The run this test created, found by the directory only a side agent makes.
 * Runs left by anything else — including other suites — are never touched. */
async function findSideRun(before: readonly string[]): Promise<string | undefined> {
  for (const id of await runIds()) {
    if (before.includes(id)) continue;
    const entries = await readdir(join(runsRoot, id)).catch(() => [] as string[]);
    if (entries.includes("side-agent")) return join(runsRoot, id);
  }
  return undefined;
}

describe.skipIf(!runReal)(" real /btw side agent", () => {
  let sessions: TuiSession[] = [];
  const workspaces: string[] = [];
  const runDirs: string[] = [];

  afterEach(async () => {
    for (const session of sessions) session.close();
    sessions = [];
    await Promise.all([...workspaces.splice(0), ...runDirs.splice(0)].map((path) =>
      rm(path, { recursive: true, force: true })));
  });

  /** Open the TUI on a throwaway workspace with the seed files a test needs. */
  async function open(seed: Record<string, string>): Promise<{ session: TuiSession; workspace: string; before: string[] }> {
    const workspace = await mkdtemp(join(tmpdir(), "piano-btw-work-"));
    workspaces.push(workspace);
    const workflowPath = join(workspace, "btw-e2e.yml");
    await writeFile(workflowPath, WORKFLOW);
    for (const [name, content] of Object.entries(seed)) {
      await writeFile(join(workspace, name), content);
    }
    const before = await runIds();
    const session = startTui(undefined, ["--workflow", workflowPath], {
      PIANO_USER_AGENT_CONFIG: configPath,
      HOME: process.env.HOME,
    }, workspace);
    sessions.push(session);
    await waitFor(session, () => session.capture().includes("trajectory"), "the Piano TUI shell");
    return { session, workspace, before };
  }

  it("edits a file in the workspace, which an ask-only side chat could not do", async () => {
    const { session, workspace, before } = await open({ "note.txt": "status: old\n" });

    session.key("/btw edit note.txt so it reads exactly \"status: new\", then reply DONE");
    session.key("Enter");
    // The banner proves the side agent owns the pane; the file proves it acted.
    await waitFor(session, () => session.capture().includes("⌥ btw"), "the side agent banner");
    await waitFor(
      session,
      async () => (await read(join(workspace, "note.txt"))).includes("status: new"),
      "note.txt to be edited by the side agent",
    );

    const runDir = await findSideRun(before);
    expect(runDir).toBeDefined();
    if (runDir === undefined) return;
    runDirs.push(runDir);
    // Evidence separation: the side agent's transcripts live beside the
    // execution tree, and the run's trajectory records no side turn — the file
    // exists because the session committed, but stays empty of turns.
    const entries = await readdir(runDir);
    expect(entries).toContain("side-agent");
    expect(entries).not.toContain("executions");
    const trajectory = parseTrajectory(await readFile(join(runDir, "system-log", "trajectory.jsonl"), "utf8"));
    expect(trajectory?.turns ?? []).toEqual([]);
  }, 240_000);

  it("runs a shell command in the workspace and keeps the conversation across turns", async () => {
    // The script's output cannot be guessed or written by hand: only actually
    // running it produces a nanosecond stamp, so `stamp.txt` is proof of bash.
    const { session, workspace } = await open({
      "mark.sh": "#!/bin/sh\ndate +%s%N > stamp.txt\n",
    });

    session.key("/btw run the script ./mark.sh in this directory, then reply RAN");
    session.key("Enter");
    await waitFor(
      session,
      async () => /^\d{10,}$/m.test(await read(join(workspace, "stamp.txt"))),
      "stamp.txt to be written by running ./mark.sh",
    );

    // A second `/btw` prompt continues the same side conversation, so the agent
    // can answer from what it did in the first turn.
    session.key("what filename did you just create? reply with the name only");
    session.key("Enter");
    await waitFor(
      session,
      () => session.capture().includes("stamp.txt"),
      "the side agent to recall its own previous turn",
    );
  }, 240_000);
});
