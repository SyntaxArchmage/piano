// The /continue and /restart arcs through the REAL runSession + runTui: a job
// interrupted mid-work pauses; /continue resumes it from the cursor, skipping
// the invocations whose evidence is already accepted (the first stage must NOT
// run again); /restart closes the paused job on the stream and runs its input
// again from scratch. Only "sending the prompt" is mocked, at the harness
// adapter boundary (the same seam the other session arcs drive).
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createStagingSession } from "@piano/logging";
import type { AgentRequest, AgentRunner } from "@piano/harness";
import { runSession } from "../../packages/cli/src/session-run.js";
import { FakeTerminal, plain, sleep, waitFor } from "../common/terminal.js";
import { hangUntilAbort, sessionOf, settledResult, type ActorSession } from "../common/fake-runner.js";

vi.mock("@piano/harness", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  prepareHarnessHomes: vi.fn(() => Effect.succeed({ agentOptions: {} })),
}));

const TWO_STAGE_WORKFLOW = `version: 3
workflow:
  name: arc-continue-restart
  nodes:
    - stage:
        name: first
        worker: basic
        harness: pi
        from: []
    - stage:
        name: second
        worker: basic
        harness: pi
        from: [first]
`;

const ACTOR: ActorSession = {
  harness: "pi",
  sessionId: "sess-arc",
  transcriptPath: "/runs/arc/actors/pi/basic/session/sess-arc.jsonl",
};

function stageOf(request: AgentRequest): string {
  const matched = /workflow stage `([^`]+)`/.exec(request.prompt);
  if (matched?.[1] === undefined) throw new Error(`missing workflow stage context: ${request.prompt}`);
  return matched[1];
}

/** One continuous session arc on a real TTY. Each step settles in ~300 ms when
 * the suite runs this file alone, but under parallel load the process is starved
 * enough to blow the default 15 s wait — which also happens to be the suite's
 * default testTimeout, so the failure lands exactly at the budget boundary. The
 * waits therefore carry their own budget: a slow machine must not fail a run
 * whose steps are all still making progress. */
const wait = (label: string, check: () => boolean) => waitFor(label, check, 60_000);

function progressStatus(runsRoot: string, runId: string): string | undefined {
  try {
    const raw = readFileSync(join(runsRoot, runId, "progress.json"), "utf8");
    return (JSON.parse(raw) as { status?: string }).status;
  } catch {
    return undefined;
  }
}

/** Submit a `/continue` or `/restart` until it takes effect. The TUI drops a
 * job command that lands while the previous turn is still being released — its
 * own gate, not the run's evidence, which settles first — and tells the user
 * to "run the command again"; a human does exactly that, so the arc does too,
 * bounded by the take-effect check. */
async function submitJobCommand(
  terminal: FakeTerminal,
  command: string,
  took: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!took() && Date.now() < deadline) {
    terminal.onInput?.(command);
    terminal.onInput?.("\r");
    for (const until = Date.now() + 500; !took() && Date.now() < until;) await sleep(10);
  }
  expect(took()).toBe(true);
}

function streamRecords(runsRoot: string, runId: string): Array<Record<string, unknown>> {
  try {
    return readFileSync(join(runsRoot, runId, "progress.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

/** Turn entries recorded in a run's trajectory so far (undefined mid-write). */
function recordedTurns(runsRoot: string, runId: string): Array<{ prompt: string; status: string }> | undefined {
  try {
    const raw = readFileSync(join(runsRoot, runId, "trajectory.json"), "utf8");
    const document = JSON.parse(raw) as { turns?: Array<{ prompt: string; status: string }> };
    return Array.isArray(document.turns) ? document.turns : [];
  } catch {
    return undefined;
  }
}

describe("a paused job continues from its cursor, and restarts from scratch", () => {
  it("skips the accepted stage on /continue and closes the job on /restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-arc-continue-"));
    try {
      const runsRoot = join(root, "runs");
      const workflowPath = join(root, "workflow.yml");
      await writeFile(workflowPath, TWO_STAGE_WORKFLOW);

      const requests: AgentRequest[] = [];
      let secondSeen = 0;
      const runner: AgentRunner = (request) => {
        requests.push(request);
        if (stageOf(request) === "second") {
          secondSeen += 1;
          // The first and third `second` turns hang (they are interrupted);
          // the second and fourth settle (the continue, then the restart).
          if (secondSeen === 1 || secondSeen === 3) return hangUntilAbort(request, sessionOf(request, ACTOR));
        }
        return settledResult(request, `${stageOf(request)} reply`, ACTOR);
      };

      const staging = createStagingSession({ root, cwd: root, runsRoot });
      const runId = staging.id;
      const terminal = new FakeTerminal();
      const session = Effect.runPromise(runSession(staging, {
        workflowPath,
        terminal,
        agentRunner: runner,
      }).pipe(Effect.provide(NodeFileSystem.layer)));
      await sleep(50);

      // ——— Job 1: the prompt runs first, second hangs, Escape pauses the job.
      terminal.onInput?.("build the counter");
      terminal.onInput?.("\r");
      await wait("first settled", () => requests.filter((request) => stageOf(request) === "first").length === 1);
      await wait("second hanging", () => requests.filter((request) => stageOf(request) === "second").length === 1);
      terminal.onInput?.("\x1b"); // Escape: interrupt, exactly like the real key
      await wait("the run ended as interrupted", () => plain(terminal).includes("interrupted"));
      await wait("job 1 paused", () => progressStatus(runsRoot, runId) === "paused");
      await wait("turn 1 persisted", () => recordedTurns(runsRoot, runId)?.length === 1);

      // ——— /continue: resumes job 1; the accepted first stage must NOT re-run.
      await submitJobCommand(terminal, "/continue", () => requests.filter((request) => stageOf(request) === "second").length === 2);
      await wait("job 1 completed", () => progressStatus(runsRoot, runId) === "completed");
      expect(requests.filter((request) => stageOf(request) === "first")).toHaveLength(1);
      // The continue's span repeats the job's ordinal; the skipped stage is
      // never started again, so the stream still holds exactly one start.
      const afterContinue = streamRecords(runsRoot, runId);
      expect(afterContinue.filter((record) => record.kind === "execution-started").map((record) => record.jobOrdinal))
        .toEqual([1, 1]);
      expect(afterContinue.filter((record) => record.kind === "stage-started" && record.stageId === "first"))
        .toHaveLength(1);
      // The turn records the input that actually ran, not the command.
      await wait("turn 2 persisted", () => recordedTurns(runsRoot, runId)?.length === 2);
      expect(recordedTurns(runsRoot, runId)?.map((turn) => turn.prompt))
        .toEqual(["build the counter", "build the counter"]);

      // ——— Job 2: another prompt pauses the same way.
      terminal.onInput?.("change the counter");
      terminal.onInput?.("\r");
      await wait("second hanging again", () => requests.filter((request) => stageOf(request) === "second").length === 3);
      terminal.onInput?.("\x1b");
      await wait("job 2 paused", () => progressStatus(runsRoot, runId) === "paused");
      await wait("turn 3 persisted", () => recordedTurns(runsRoot, runId)?.length === 3);

      // ——— /restart: closes the paused job on the stream, re-runs from scratch.
      await submitJobCommand(terminal, "/restart", () => requests.filter((request) => stageOf(request) === "second").length === 4);
      await wait("job 3 completed", () => progressStatus(runsRoot, runId) === "completed");
      // The restart re-ran the first stage too: a fresh job, no cursor.
      expect(requests.filter((request) => stageOf(request) === "first")).toHaveLength(3);
      const afterRestart = streamRecords(runsRoot, runId);
      expect(afterRestart.filter((record) => record.kind === "execution-started").map((record) => record.jobOrdinal))
        .toEqual([1, 1, 2, 3]);
      expect(afterRestart.filter((record) => record.kind === "job-closed")).toEqual([
        expect.objectContaining({ jobOrdinal: 2, outcome: "restarted" }),
      ]);
      // The restart's turn carries the input it re-ran.
      await wait("turn 4 persisted", () => recordedTurns(runsRoot, runId)?.length === 4);
      expect(recordedTurns(runsRoot, runId)?.map((turn) => turn.prompt))
        .toEqual(["build the counter", "build the counter", "change the counter", "change the counter"]);

      terminal.onInput?.("/exit");
      terminal.onInput?.("\r");
      await session;
      // One run directory through the whole arc — nothing stranded.
      expect((await readdir(runsRoot)).sort()).toEqual([runId]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
