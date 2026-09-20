// Exit arcs at the PROCESS level: the real `piano` binary on a real
// pseudo-terminal, workers spawned as the deterministic pi-cli stand-in
// (fake-agent.mjs) under an isolated HOME — no provider credentials, so this
// file is ungated and runs in `test:tui:smoke`.
//
// Completion is detected from the run directory's trajectory.json (the same
// durable evidence the tournament guard uses), never from scraping transient
// panel rows. What these tests pin, end to end:
//  1. a one-worker workflow ENDS (trajectory completed, "✓ done" rendered) and
//     a following `/exit` returns the shell — the process is actually gone;
//  2. a multi-worker (fan-out) workflow ends only after every scripted turn
//     ran (trace ordering) — same exit guarantees;
//  3. a worker whose stdout pipe outlives it (the fake parks without
//     answering while a detached `sleep` holds the pipe; the group kill takes
//     the fake down but not the holder): `/exit` must STILL hand the shell
//     back. This pins the runMain-level guarantee — a wedged worker's
//     unsettled adapter promise may leak a pipe, it must never cost the user
//     their prompt. (The visible "exiting — waiting…" line is pinned
//     deterministically at the session tier, tests/cli/tui-exit-arc.test.ts;
//     the PTY screen has no scrollback, so a short drain can render it for
//     less than a poll interval.)
import { mkdtemp as mkdtempAsync, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { startTui, type TuiSession } from "./pty.js";
import {
  createFakeHarnessHome,
  findNewRun,
  guardEnvironment,
  listRunIds,
  readRunTrajectoryStatus,
} from "../fixtures/tournament-real-run/helpers.js";

const FIXTURES = fileURLToPath(new URL("../fixtures/exit-arcs/", import.meta.url));
const BANNER = "Piano: A Programmable Agent Workflow System.";
const RUN_TIMEOUT_MS = 180_000;

async function waitFor(label: string, check: () => Promise<boolean> | boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor(${label}) timed out`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function openArc(name: string, fakeMode?: string): Promise<{
  session: TuiSession; home: string; workspace: string; tracePath: string; before: ReadonlySet<string>;
}> {
  const home = await createFakeHarnessHome();
  const workspace = await mkdtempAsync(join(tmpdir(), "piano-exit-arc-ws-"));
  const tracePath = join(home, "fake-trace.tsv");
  const env = guardEnvironment(home, tracePath);
  if (fakeMode !== undefined) env.PIANO_FAKE_MODE = fakeMode;
  const before = await listRunIds(home);
  const session = startTui(home, ["--workflow", join(FIXTURES, name)], env, workspace);
  await waitFor("banner", () => session.capture().includes(BANNER), 60_000);
  return { session, home, workspace, tracePath, before };
}

async function trajectoryCompleted(home: string, before: ReadonlySet<string>): Promise<boolean> {
  try {
    const runDir = await findNewRun(home, before);
    return (await readRunTrajectoryStatus(runDir)) === "completed";
  } catch {
    return false;
  }
}

/** Reap the hang-mode detached stdio holder recorded as `hold\t<pid>` lines. */
async function reapHolders(tracePath: string): Promise<void> {
  const text = await readFile(tracePath, "utf8").catch(() => "");
  for (const line of text.split("\n")) {
    const [kind, pid] = line.split("\t");
    if (kind === "hold" && pid !== undefined) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
        // Already reaped.
      }
    }
  }
}

async function cleanup(...paths: string[]): Promise<void> {
  for (const path of paths) {
    await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

describe("workflow end + /exit at the process level (fake pi-cli workers)", () => {
  it("one worker: workflow ends durably and on screen, /exit returns the shell", async () => {
    const { session, home, workspace, before } = await openArc("one.yml");
    try {
      session.key("answer one\r");
      await waitFor("run completed (trajectory.json)", () => trajectoryCompleted(home, before), 90_000);
      // The durable end is ALSO visible: the chat line the stage reports when
      // its worker's turn settles.
      await waitFor("done marker on screen", () => session.capture().includes("✓ done"), 5_000);
      session.key("/exit\r");
      await waitFor("process gone", () => !session.stillRunning(), 60_000);
    } finally {
      session.close();
      await cleanup(home, workspace);
    }
  }, RUN_TIMEOUT_MS);

  it("multi worker: ends only after every scripted turn ran", async () => {
    const { session, home, workspace, tracePath, before } = await openArc("two.yml");
    try {
      session.key("fan out\r");
      await waitFor("run completed (trajectory.json)", () => trajectoryCompleted(home, before), 120_000);
      const stages = (await readFile(tracePath, "utf8")).trim().split("\n").map((line) => line.split("\t")[0] ?? "");
      expect(stages).toEqual(["left", "right", "joined"]);
      session.key("/exit\r");
      await waitFor("process gone", () => !session.stillRunning(), 60_000);
    } finally {
      session.close();
      await cleanup(home, workspace);
    }
  }, RUN_TIMEOUT_MS);

  it("hung worker (orphaned stdout pipe): /exit still returns the shell", async () => {
    const { session, home, workspace, tracePath, before } = await openArc("one.yml", "hang");
    try {
      session.key("this worker will wedge\r");
      await waitFor("worker spawned", () => session.capture().includes("↳ respond"), 60_000);
      // The run never completes: a wedged worker must not fake an ending.
      expect(await trajectoryCompleted(home, before)).toBe(false);
      session.key("/exit\r");
      // The shell comes back regardless of the holder that outlived the kill:
      // /exit is bounded by the drain budget + close paint, not by the wedged
      // worker's pipe.
      await waitFor("process gone", () => !session.stillRunning(), 60_000);
      expect(await trajectoryCompleted(home, before)).toBe(false);
    } finally {
      await reapHolders(tracePath);
      session.close();
      await cleanup(home, workspace);
    }
  }, RUN_TIMEOUT_MS);
});
