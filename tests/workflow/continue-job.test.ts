// A continue resumes a paused job from its cursor: invocations already accepted
// in the job's earlier spans are rebuilt from the producer records they left,
// not run again. The span repeats the job's ordinal, re-runs follow the attempt
// numbers already on disk, and a missing producer record falls back to a
// re-run rather than inventing a result.
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";
import {
  executeWorkflow,
  loadWorkflow,
  readWorkflowExecutionContinuation,
} from "../../packages/orchestrator/src/index.js";
import type { AgentRequest, AgentResult, AgentRunner } from "../../packages/harness/src/index.js";

const WORKFLOW = `version: 3
workflow:
  name: continue-job
  nodes:
    - stage:
        name: first
        worker: basic
        from: []
    - stage:
        name: second
        worker: basic
        handoff: first-report.json
        from: [first]
`;

type ContinueJob = {
  readonly jobOrdinal: number;
  readonly accepted: ReadonlySet<string>;
  readonly attempts: ReadonlyMap<string, number>;
};

function stageOf(request: AgentRequest): string {
  const matched = /workflow stage `([^`]+)`/.exec(request.prompt);
  if (matched?.[1] === undefined) throw new Error(`missing workflow stage context: ${request.prompt}`);
  return matched[1];
}

function scriptedRunner(calls: AgentRequest[]): AgentRunner {
  return (request) => {
    calls.push(request);
    const stage = stageOf(request);
    const filled = calls.filter((call) => stageOf(call) === stage).length;
    const sessionId = `${stage}-${filled}`;
    const transcriptPath = `/runs/continue/${sessionId}.jsonl`;
    return Effect.succeed<AgentResult>({
      sessionId,
      transcriptPath,
      text: `${stage} output`,
      continuation: { harness: "pi", sessionId, transcriptPath },
    });
  };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "piano-continue-job-"));
  await writeFile(join(root, "workflow.yml"), WORKFLOW, "utf8");
  const session = await Effect.runPromise(
    createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
  const run = (prompt: string, calls: AgentRequest[], continueJob?: ContinueJob) =>
    Effect.runPromise(
      loadWorkflow(join(root, "workflow.yml"), root).pipe(
        Effect.flatMap((loaded) => readWorkflowExecutionContinuation(session.runDir, session.id).pipe(
          Effect.flatMap((execution) => executeWorkflow(loaded, {
            runDir: session.runDir,
            cwd: root,
            prompt,
            runId: session.id,
            ...(execution === undefined ? {} : { execution }),
            ...(continueJob === undefined ? {} : { continueJob }),
            agentRunner: scriptedRunner(calls),
          })),
        )),
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ),
    );
  return { root, session, run };
}

const streamRecords = async (runDir: string): Promise<Array<Record<string, unknown>>> =>
  (await readFile(join(runDir, "progress.jsonl"), "utf8"))
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe("a continue resumes a paused job from its cursor", () => {
  it("rebuilds accepted invocations from their evidence instead of running them", async () => {
    const { root, session, run } = await setup();
    try {
      const first = await run("do the work", []);
      expect(first.stages.map((stage) => stage.id)).toEqual(["first@root", "second@root"]);

      const calls: AgentRequest[] = [];
      const second = await run("keep going", calls, {
        jobOrdinal: 1,
        accepted: new Set(["first@root"]),
        attempts: new Map([["first@root", 1]]),
      });

      // Only the unfinished stage ran; the accepted one came back from its
      // producer record, text and all.
      expect(calls.map(stageOf)).toEqual(["second"]);
      expect(second.stages.map((stage) => [stage.id, stage.text])).toEqual([
        ["first@root", "first output"],
        ["second@root", "second output"],
      ]);
      expect(second.stages[0]?.handoffRecordPath).toContain("first/root/handoff/record.json");

      // The rebuilt producer feeds the consumer's context like any other.
      const contextPath = calls[0]?.contextFilePaths?.find((path) => path.endsWith("/first-report.json"));
      const context = JSON.parse(await readFile(contextPath!, "utf8")) as { inputs: Array<{ text: string }> };
      expect(context.inputs).toMatchObject([{ text: "first output" }]);

      // The span repeats the job's ordinal, so the stream groups both spans
      // into one job, and the skipped stage is not started again.
      const records = await streamRecords(session.runDir);
      const starts = records.filter((record) => record.kind === "execution-started");
      expect(starts.map((record) => record.jobOrdinal)).toEqual([1, 1]);
      const firstStarts = records.filter((record) => record.kind === "stage-started" && record.invocationId === "first@root");
      expect(firstStarts).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("seeds a re-run's attempt after the attempts already on disk", async () => {
    const { root, session, run } = await setup();
    try {
      await run("do the work", []);
      await run("keep going", [], {
        jobOrdinal: 1,
        accepted: new Set(),
        attempts: new Map([["first@root", 1], ["second@root", 1]]),
      });

      const records = await streamRecords(session.runDir);
      const attemptsOf = (invocationId: string) => records
        .filter((record) => record.kind === "stage-started" && record.invocationId === invocationId)
        .map((record) => record.attempt);
      // The re-run follows the attempts this job recorded instead of
      // overwriting attempts/1/result.json.
      expect(attemptsOf("first@root")).toEqual([1, 2]);
      expect(attemptsOf("second@root")).toEqual([1, 2]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("re-runs an accepted invocation when its producer record is gone", async () => {
    const { root, session, run } = await setup();
    try {
      await run("do the work", []);
      await unlink(join(session.runDir, "prompts", "1", "invocations", "first", "root", "handoff", "record.json"));

      const calls: AgentRequest[] = [];
      await run("keep going", calls, {
        jobOrdinal: 1,
        accepted: new Set(["first@root"]),
        attempts: new Map([["first@root", 1]]),
      });

      // Evidence missing: the stage runs again rather than inventing a result.
      expect(calls.map(stageOf)).toEqual(["first", "second"]);
      const records = await streamRecords(session.runDir);
      const firstStarts = records.filter((record) => record.kind === "stage-started" && record.invocationId === "first@root");
      expect(firstStarts.map((record) => record.attempt)).toEqual([1, 2]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
