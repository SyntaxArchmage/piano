// The two sign-off decisions as a fork in the workflow, at the engine level.
//
// `continue` publishes the attempt and hands the reviewer's note to the stages
// that consume it; `retry` reopens the same actor and hands the note to its next
// attempt. The half that cannot be checked by reading the dialog back is where
// the note actually lands, so every assertion here is on a worker's real prompt
// or on the request the reviewer was shown.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";
import type { AgentContinuation } from "../../packages/harness/src/index.js";
import {
  loadAndExecuteWorkflow,
  type WorkflowSignoffDecision,
  type WorkflowSignoffRequest,
} from "../../packages/orchestrator/src/index.js";

/** draft is the gate; polish consumes it; publish consumes polish and so must
 * NOT receive draft's note — the note travels one edge, not down the graph. */
const CHAIN = `version: 3
workflow:
  name: signoff-note-chain
  nodes:
    - stage:
        name: draft
        worker: basic
        harness: pi
        from: []
        signoff: true
    - stage:
        name: polish
        worker: basic
        harness: pi
        from: [draft]
    - stage:
        name: publish
        worker: basic
        harness: pi
        from: [polish]
`;

/** Two stages read draft directly: both are consumers, and both must be told. */
const FORK = `version: 3
workflow:
  name: signoff-note-fork
  nodes:
    - stage:
        name: draft
        worker: basic
        harness: pi
        from: []
        signoff: true
    - stage:
        name: left
        worker: basic
        harness: pi
        from: [draft]
    - stage:
        name: right
        worker: basic
        harness: pi
        from: [draft]
`;

const continuation = (sessionId: string): AgentContinuation => ({
  harness: "pi",
  sessionId,
  nativeSessionId: sessionId,
  transcriptPath: `/tmp/${sessionId}.jsonl`,
});

interface Run {
  readonly prompts: readonly string[];
  readonly requests: readonly WorkflowSignoffRequest[];
  readonly decisions: readonly WorkflowSignoffDecision[];
  readonly exit: Exit.Exit<unknown, unknown>;
}

async function run(
  workflow: string,
  decide: (request: WorkflowSignoffRequest, round: number) => WorkflowSignoffDecision,
): Promise<Run> {
  const root = await mkdtemp(join(tmpdir(), "piano-signoff-note-"));
  try {
    await writeFile(join(root, "workflow.yml"), workflow);
    const session = await Effect.runPromise(
      createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    const prompts: string[] = [];
    const requests: WorkflowSignoffRequest[] = [];
    const decisions: WorkflowSignoffDecision[] = [];
    const exit = await Effect.runPromiseExit(loadAndExecuteWorkflow({
      root,
      workflowPath: join(root, "workflow.yml"),
      runDir: session.runDir,
      runId: "signoff-note",
      cwd: root,
      prompt: "draft the thing",
      agentRunner: (request) => Effect.promise(async () => {
        prompts.push(request.prompt);
        return {
          sessionId: "note-actor",
          transcriptPath: "/tmp/note-actor.jsonl",
          text: `turn ${prompts.length}`,
          continuation: continuation("note-actor"),
        };
      }),
      signoff: (request) => Effect.sync(() => {
        requests.push(request);
        const decision = decide(request, requests.length);
        decisions.push(decision);
        return decision;
      }),
    }).pipe(
      Effect.provideService(Logging, loggingService(session.log, session.trace)),
      Effect.provide(NodeFileSystem.layer),
    ));
    return { prompts, requests, decisions, exit };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** The prompt a given stage ran with. Every stage prompt names its own stage,
 * so the workflow's order never has to be hard-coded into the assertion. */
function promptOf(run: Run, stageId: string): string {
  const prompt = run.prompts.find((candidate) => candidate.includes(`workflow stage \`${stageId}\``));
  if (prompt === undefined) throw new Error(`no prompt recorded for stage ${stageId}`);
  return prompt;
}

describe("sign-off continue", () => {
  it("tells the reviewer which stages will receive the note", async () => {
    const result = await run(CHAIN, () => ({ type: "continue", note: "widen the caption" }));
    expect(Exit.isSuccess(result.exit)).toBe(true);
    // The promise shown in the dialog and the delivery below both come from the
    // compiled `dependsOn` edges, so this list is the contract the rest of
    // these tests check delivery against.
    expect(result.requests[0]?.consumers).toEqual(["polish"]);
  });

  it("delivers the note to the stage that consumes the reviewed one", async () => {
    const result = await run(CHAIN, () => ({ type: "continue", note: "widen the caption" }));
    expect(Exit.isSuccess(result.exit)).toBe(true);
    const polish = promptOf(result, "polish");
    expect(polish).toContain("## Reviewer guidance");
    expect(polish).toContain("after `draft`: widen the caption");
    // The reviewed stage's own prompt predates the decision.
    expect(promptOf(result, "draft")).not.toContain("## Reviewer guidance");
  });

  it("stops at the direct consumer instead of following the whole graph", async () => {
    const result = await run(CHAIN, () => ({ type: "continue", note: "widen the caption" }));
    expect(Exit.isSuccess(result.exit)).toBe(true);
    // publish consumes polish, not draft. A note about draft's work has no
    // business appearing in a later prompt as if it were still in force.
    const publish = promptOf(result, "publish");
    expect(publish).not.toContain("## Reviewer guidance");
    expect(publish).not.toContain("widen the caption");
  });

  it("delivers to every direct consumer when the stage forks", async () => {
    const result = await run(FORK, () => ({ type: "continue", note: "keep the units" }));
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect((result.requests[0]?.consumers ?? []).slice().sort()).toEqual(["left", "right"]);
    for (const stage of ["left", "right"]) {
      expect(promptOf(result, stage)).toContain("after `draft`: keep the units");
    }
  });

  it("adds no guidance section when the reviewer continued without a note", async () => {
    const result = await run(CHAIN, () => ({ type: "continue" }));
    expect(Exit.isSuccess(result.exit)).toBe(true);
    // An empty section would tell the worker a human wrote something.
    expect(promptOf(result, "polish")).not.toContain("## Reviewer guidance");
  });

  it("reports no consumers when the reviewed stage is terminal", async () => {
    const result = await run(`version: 3
workflow:
  name: signoff-note-last
  nodes:
    - stage:
        name: draft
        worker: basic
        harness: pi
        from: []
        signoff: true
`, () => ({ type: "continue", note: "unreachable" }));
    expect(Exit.isSuccess(result.exit)).toBe(true);
    // Nothing consumes it, so the note has nowhere to go. The dialog is what
    // refuses to collect one; the engine still reports the empty edge set so
    // the reviewer can be told before writing anything.
    expect(result.requests[0]?.consumers).toEqual([]);
  });

  it("delivers to a loop's entry stage without leaking to its later stages", async () => {
    // The case the `dependsOn` filter exists for. A stage inside a region
    // inherits the region's inputs, so `measure` really does hold draft's
    // result in its `inputs` even though it never declared draft in its own
    // `from:` — without the filter it would be handed a note it was never
    // promised, and which the reviewer was told belonged to `propose`.
    const result = await run(`version: 3
workflow:
  name: signoff-note-loop
  nodes:
    - stage:
        name: draft
        worker: basic
        harness: pi
        from: []
        signoff: true
    - loop:
        name: tune
        from: [draft]
        entry: propose
        exit: measure
        iterations: 1
        nodes:
          - stage:
              name: propose
              worker: basic
              harness: pi
              from: []
          - stage:
              name: measure
              worker: basic
              harness: pi
              from: [propose]
`, () => ({ type: "continue", note: "hold the units fixed" }));
    expect(Exit.isSuccess(result.exit)).toBe(true);
    // Consumers are reported as compiled stage ids, so a stage inside a region
    // shows its dotted path — the same identity the footer's DAG and the run's
    // progress records use, which is what makes it unambiguous.
    expect(result.requests[0]?.consumers).toEqual(["tune.propose"]);
    expect(promptOf(result, "tune.propose")).toContain("after `draft`: hold the units fixed");
    expect(promptOf(result, "tune.measure")).not.toContain("## Reviewer guidance");
  });
});

describe("sign-off retry", () => {
  it("carries the reviewer's note into the next attempt at the same stage", async () => {
    const result = await run(CHAIN, (_request, round) => round === 1
      ? { type: "retry", note: "the caption is too small" }
      : { type: "continue" });
    expect(Exit.isSuccess(result.exit)).toBe(true);
    const drafts = result.prompts.filter((prompt) => prompt.includes("workflow stage `draft`"));
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).not.toContain("## Sign-off retry");
    expect(drafts[1]).toContain("## Sign-off retry");
    expect(drafts[1]).toContain("Reviewer note: the caption is too small");
  });

  it("still tells the worker it is a rerun when the reviewer wrote nothing", async () => {
    const result = await run(CHAIN, (_request, round) => round === 1
      ? { type: "retry" }
      : { type: "continue" });
    expect(Exit.isSuccess(result.exit)).toBe(true);
    const rerun = result.prompts.filter((prompt) => prompt.includes("workflow stage `draft`"))[1] ?? "";
    // The worker must not have to guess why it is being asked again: without
    // the section it would see an identical prompt and no reason to change.
    expect(rerun).toContain("## Sign-off retry");
    expect(rerun).toContain("No further detail was given");
  });

  it("gives a retry note to the rerun, not to the consumers", async () => {
    const result = await run(CHAIN, (_request, round) => round === 1
      ? { type: "retry", note: "the caption is too small" }
      : { type: "continue" });
    expect(Exit.isSuccess(result.exit)).toBe(true);
    // A retry note is addressed to the stage being redone. Leaking it forward
    // would show the consumers feedback about work that was replaced.
    const polish = promptOf(result, "polish");
    expect(polish).not.toContain("the caption is too small");
    expect(polish).not.toContain("## Reviewer guidance");
  });

  it("numbers the rounds on the request so a rerun is distinguishable", async () => {
    const result = await run(CHAIN, (_request, round) => round === 1
      ? { type: "retry", note: "again" }
      : { type: "continue" });
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.requests.map((request) => request.round)).toEqual([1, 2]);
  });
});
