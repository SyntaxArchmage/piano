import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { NodeFileSystem } from "@effect/platform-node";
import { FileSystem } from "@effect/platform";
import { Cause, Effect, Exit, Fiber, Option } from "effect";
import { describe, expect, it } from "vitest";
import {
  createSession,
  Logging,
  loggingService,
} from "../../packages/logging/src/index.js";
import {
  ACTOR_KEY_VERSION,
  allocateMapWorkspace,
  executeWorkflow,
  initializeWorkflowProgress,
  loadAndExecuteWorkflow,
  invocationStreamPath,
  loadWorkflow,
  markWorkflowStageStarted,
  parseInvocationRecords,
  readWorkflowExecutionContinuation,
  recordInvocationStart,
  WorkflowError,
  type InvocationAcceptedRecord,
  type RunAcceptedInvocation,
  type WorkflowProgressRegionFinalizedRecord,
  type WorkflowSignoffRequest,
  type WorkflowExecutionContinuation,
} from "../../packages/orchestrator/src/index.js";
import {
  AgentError,
  createSteeringChannel,
  executeAgent,
  type AgentEvent,
  type AgentRequest,
  type AgentRunner,
  type PiModule,
} from "../../packages/harness/src/index.js";
import {
  isInvocationResultPath,
  validationResultPathFromPrompt,
} from "../common/validation-path.mjs";

const runFile = promisify(execFile);

/** The installed worker registry, for tests that build their own recipe
 * repository and still use shipped workers. */
/** Test-owned worker contracts standing in for the removed named validators.
 * Suites that validate through these workers point their workflow at this
 * repository instead of the installed registry. */
const WORKFLOW_RECIPE_ROOT = fileURLToPath(new URL("../fixtures/workflow-recipes", import.meta.url));

/** Where a worker's contract lives in the flat registry beside its directory. */
function workerContractPath(workerDir: string): string {
  return join(dirname(workerDir), "contracts", `${basename(workerDir)}.json`);
}

async function writeWorkerContract(workerDir: string, source: string): Promise<void> {
  const contractPath = workerContractPath(workerDir);
  await mkdir(dirname(contractPath), { recursive: true });
  await writeFile(contractPath, source);
}

/** Give a test-owned worker a test-owned proposal contract. */
async function installTestProposalContract(root: string, worker: string): Promise<void> {
  const workerDir = join(root, "recipes", worker);
  await mkdir(workerDir, { recursive: true });
  await writeWorkerContract(
    workerDir,
    await readFile(join(WORKFLOW_RECIPE_ROOT, "recipes", "contracts", "test-proposal.json"), "utf8"),
  );
}

const BASIC_WORKFLOW = `version: 3
workflow:
  name: basic
  nodes:
    - stage:
        name: respond
        worker: basic
        from: []
`;

const CONFIGURED_WORKFLOW = `version: 3
workflow:
  name: configured
  nodes:
    - stage:
        name: respond
        worker: basic
        harness: pi
        model: stage-model
        thinkingLevel: high
        from: []
`;

const VALIDATE_WORKFLOW = BASIC_WORKFLOW
  .replace("        worker: basic\n", "        worker: test-text\n");

const TWO_STAGE_WORKFLOW = `version: 3
workflow:
  name: two-stage
  nodes:
    - stage:
        name: first
        worker: basic
        from: []
    - stage:
        name: second
        worker: smoke-test-agent
        from: [first]
`;

const SAME_WORKER_WORKFLOW = `version: 3
workflow:
  name: same-worker
  nodes:
    - stage:
        name: first
        worker: basic
        from: []
    - stage:
        name: second
        worker: basic
        from: [first]
`;

const FAN_OUT_WORKFLOW = `version: 3
workflow:
  name: fan-out
  nodes:
    - stage:
        name: left
        worker: basic
        from: []
    - stage:
        name: right
        worker: basic
        from: []
    - stage:
        name: joined
        worker: basic
        from: [left, right]
`;

const RETRY_WORKFLOW = `version: 3
workflow:
  name: retry
  nodes:
    - stage:
        name: produce
        worker: test-text
        from: []
    - stage:
        name: consume
        worker: smoke-test-agent
        from: [produce]
`;

const LOOP_WORKFLOW = `version: 3
workflow:
  name: loop
  nodes:
    - stage:
        name: seed
        worker: test-text
        from: []
    - loop:
        name: tune
        from: [seed]
        entry: propose
        exit: report
        iterations: 3
        nodes:
          - stage:
              name: propose
              worker: test-text
              from: []
          - stage:
              name: report
              worker: smoke-test-agent
              from: [propose]
`;

const LOOP_FEEDBACK_WORKFLOW = `version: 3
workflow:
  name: loop-feedback
  nodes:
    - stage:
        name: seed
        worker: test-text
        from: []
    - loop:
        name: tune
        from: [seed]
        entry: profile
        exit: measure
        feedback: measure
        iterations: 3
        nodes:
          - stage:
              name: profile
              worker: test-text
              from: []
          - stage:
              name: measure
              worker: test-text
              from: [profile]
`;

const MAP_WORKFLOW = `version: 3
workflow:
  name: map
  nodes:
    - stage:
        name: propose
        worker: triton-idea
        from: []
    - tournament:
        name: tournament
        from: [propose]
        over: propose.strategies
        count: 2
        entry: implement
        exit: verify
        nodes:
          - stage:
              name: implement
              worker: basic
              from: []
          - stage:
              name: verify
              worker: basic
              from: [implement]
    - stage:
        name: summary
        worker: triton-idea
        from: [tournament]
`;

/** `MAP_WORKFLOW` with the race's lanes pinned to one model each: lane `i` runs
 * `models[i]`, which is what the region's `count: 2` requires of the list. The
 * summary runs on a contract-less worker so this test counts exactly one turn
 * per outside stage. */
const PER_LANE_MODEL_MAP_WORKFLOW = MAP_WORKFLOW
  .replace(
    "              name: implement\n              worker: basic\n",
    "              name: implement\n              worker: basic\n              model: [m-one, m-two]\n",
  )
  .replace(
    "        name: summary\n        worker: triton-idea\n",
    "        name: summary\n        worker: basic\n",
  );

const PROJECTED_MAP_WORKFLOW = `version: 3
workflow:
  name: projected-map
  nodes:
    - stage:
        name: propose
        worker: projected-map-source
        from: []
    - tournament:
        name: tournament
        from: [propose]
        over: propose.strategies
        count: 2
        entry: implement
        exit: implement
        nodes:
          - stage:
              name: implement
              worker: basic
              from: []
`;

function projectedMapContract(includeProjection: boolean): Record<string, unknown> {
  return {
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: ["strategies", "authoritative"],
      properties: {
        strategies: { type: "array", items: { type: "object" } },
        authoritative: { type: "array", items: { type: "object" } },
      },
      additionalProperties: false,
    },
    example: {
      strategies: [{ id: "legacy-decoy-a" }, { id: "legacy-decoy-b" }],
      authoritative: [{ id: "projected-a" }, { id: "projected-b" }],
    },
    outputs: {
      metrics: [],
      projections: includeProjection
        ? [{ id: "workflow.map-items", pointer: "/authoritative", format: "json", required: true }]
        : [],
    },
  };
}

const NESTED_MAP_WORKFLOW = `version: 3
workflow:
  name: nested-map
  nodes:
    - stage:
        name: propose
        worker: triton-idea
        from: []
    - tournament:
        name: outer
        from: [propose]
        over: propose.strategies
        count: 1
        entry: seed
        exit: inner
        nodes:
          - stage:
              name: seed
              worker: triton-idea
              from: []
          - tournament:
              name: inner
              from: [seed]
              over: seed.strategies
              count: 2
              entry: implement
              exit: implement
              nodes:
                - stage:
                    name: implement
                    worker: basic
                    from: []
`;

const CUDA_ROUND_WORKFLOW = `version: 3
workflow:
  name: cuda-round
  nodes:
    - stage:
        name: measure
        worker: test-round-cuda
        from: []
`;

const NESTED_GPU_WORKFLOW = `version: 3
workflow:
  name: nested-gpu-adversarial
  nodes:
    - stage:
        name: close-round
        worker: custom-round
        from: []
`;

const NESTED_GPU_PROJECTIONS = [
  { id: "round.materialization-v1", pointer: "/report", format: "json", required: true },
  { id: "round.iteration", pointer: "/report/round_no", format: "number", required: true },
  { id: "round.decision", pointer: "/report/verdict", format: "string", required: true },
  { id: "round.candidate", pointer: "/report/artifacts/challenger", format: "json", required: true },
  { id: "round.current-best", pointer: "/report/artifacts/incumbent", format: "json", required: true },
  { id: "round.verification", pointer: "/report/checks", format: "json", required: true },
  { id: "round.promotion", pointer: "/report/application", format: "json", required: true },
  { id: "round.records", pointer: "/report/storage", format: "json", required: true },
  { id: "benchmark.evidence", pointer: "/report/measurement", format: "json", required: false },
] as const;

function nestedGpuPayload(best = 12): Record<string, unknown> {
  return {
    report: {
      round_no: 0,
      verdict: "KEEP",
      artifacts: {
        challenger: { path: "kernel.py" },
        incumbent: { path: "state/current-best.py" },
      },
      checks: { compile_passed: true, verify_passed: true },
      measurement: {
        name: "throughput",
        unit: "items/s",
        direction: "higher",
        samples: [best],
        best,
        median: best,
        runs: 1,
        warmup: 0,
      },
      application: {
        promoted: true,
        resulting_best: { path: "kernel.py" },
        reason: "faster",
      },
      storage: {
        round_path: "rounds/iter-000.json",
        state_path: "state/tuning-state.json",
      },
    },
  };
}

function nestedGpuContract(omitProjection?: string): Record<string, unknown> {
  return {
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: ["report"],
      properties: { report: { type: "object" } },
      additionalProperties: false,
    },
    example: nestedGpuPayload(),
    outputs: {
      metrics: [],
      projections: NESTED_GPU_PROJECTIONS.filter((projection) => projection.id !== omitProjection),
    },
  };
}

function strippingGpuContract(): Record<string, unknown> {
  const artifact = {
    type: "object",
    required: ["path"],
    properties: { path: { type: "string", minLength: 1 } },
  };
  return {
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      "x-piano-unknown-properties": "strip",
      type: "object",
      required: ["report"],
      properties: {
        report: {
          type: "object",
          required: ["round_no", "verdict", "artifacts", "checks", "measurement", "application", "storage"],
          properties: {
            round_no: { type: "integer", minimum: 0 },
            verdict: { enum: ["KEEP", "DISCARD", "COMPILE_FAIL", "VERIFY_FAIL", "BLOCKED"] },
            artifacts: {
              type: "object",
              required: ["challenger", "incumbent"],
              properties: { challenger: artifact, incumbent: artifact },
            },
            checks: { type: "object", additionalProperties: true },
            measurement: { type: "object", additionalProperties: true },
            application: {
              type: "object",
              required: ["promoted", "resulting_best", "reason"],
              properties: {
                promoted: { type: "boolean" },
                resulting_best: artifact,
                reason: { type: "string", minLength: 1 },
              },
            },
            storage: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    example: nestedGpuPayload(),
    outputs: { metrics: [], projections: NESTED_GPU_PROJECTIONS },
  };
}

const BLOCKED_LOOP_WORKFLOW = `version: 3
workflow:
  name: blocked-loop
  nodes:
    - stage:
        name: setup
        worker: test-setup
        from: []
    - loop:
        name: tune
        from: [setup]
        entry: profile
        exit: measure
        iterations: 30
        nodes:
          - stage:
              name: profile
              worker: test-profile
              from: []
          - stage:
              name: measure
              worker: test-round-cuda
              from: [profile]
    - stage:
        name: summary
        worker: test-summary
        from: [tune]
`;

const ABSORB_BLOCK_LOOP_WORKFLOW = `version: 3
workflow:
  name: absorb-block-loop
  nodes:
    - loop:
        name: tune
        from: []
        feedback: measure
        entry: profile
        exit: measure
        iterations: 3
        nodes:
          - stage:
              name: profile
              worker: test-profile
              from: []
          - stage:
              name: implement
              worker: test-implement
              from: [profile]
          - stage:
              name: measure
              worker: test-round-cuda
              from: [implement]
    - stage:
        name: summary
        worker: test-summary
        from: [tune]
`;

const CUDA_TUNE_LOOP_WORKFLOW = `version: 3
workflow:
  name: cuda-tune-loop
  nodes:
    - stage:
        name: setup
        worker: test-setup
        from: []
    - loop:
        name: tune
        from: [setup]
        feedback: measure
        entry: profile
        exit: measure
        iterations: 6
        nodes:
          - stage:
              name: profile
              worker: test-profile
              from: []
          - stage:
              name: measure
              worker: test-round-cuda
              from: [profile]
    - stage:
        name: summary
        worker: test-summary
        from: [tune]
`;

function stageId(request: AgentRequest): string {
  const matched = /workflow stage `([^`]+)`/.exec(request.prompt);
  if (matched?.[1] === undefined) throw new Error(`missing workflow stage context: ${request.prompt}`);
  return matched[1];
}

function expectWholeWorkflowTask(request: AgentRequest, prompt: string): void {
  expect(request.prompt.startsWith(`## User task (whole workflow)\n${prompt}\n\n`)).toBe(true);
}

function invocationId(request: AgentRequest): string {
  const matched = /workflow stage `[^`]+` \(([^)]+)\)/.exec(request.prompt);
  if (matched?.[1] === undefined) throw new Error(`missing workflow invocation context: ${request.prompt}`);
  return matched[1];
}

function iterationOf(request: AgentRequest): number {
  const matched = /iter-(\d+)/.exec(invocationId(request));
  if (matched?.[1] === undefined) throw new Error(`missing loop iteration context: ${request.prompt}`);
  return Number(matched[1]);
}

function validationPath(request: AgentRequest): string {
  const path = validationResultPathFromPrompt(request.prompt);
  if (path === undefined) throw new Error(`missing validation result path: ${request.prompt}`);
  return path;
}

function continuation(sessionId: string) {
  return { harness: "pi", sessionId, transcriptPath: `/tmp/${sessionId}.jsonl` } as const;
}

/** Map slot strategy index, derived from the per-slot lane path (slot-N). */
async function strategySlot(request: AgentRequest): Promise<number> {
  const lane = request.sessionDir ?? request.cwd;
  const matched = /[-/]slot-(\d+)(\/|$)/.exec(lane);
  if (matched?.[1] === undefined) throw new Error(`missing map slot lane: ${lane}`);
  return Number(matched[1]);
}

function fakeSdk(): PiModule {
  const session = {
    sessionId: "workflow-session",
    sessionFile: "/tmp/workflow-session.jsonl",
    subscribe(listener: (event: unknown) => void): () => void {
      listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "ans = " } });
      listener({ type: "message_end", message: { content: "ans = 4" } });
      return () => undefined;
    },
    prompt: async () => undefined,
    abort: async () => undefined,
    dispose: () => undefined,
  };
  return {
    ModelRuntime: { create: async () => ({ getModel: () => ({ id: "model" }), setRuntimeApiKey: async () => undefined }) },
    SessionManager: { create: () => ({}), open: () => ({}) },
    SettingsManager: { inMemory: () => ({}) },
    DefaultResourceLoader: class {
      constructor(options: Record<string, unknown>) { void options; }
      reload = async () => undefined;
    },
    createAgentSession: async () => ({ session }),
  };
}

function fakeAgentRunner(sdk: PiModule): AgentRunner {
  return (request, options) => executeAgent(request, { ...options, sdk });
}

async function testSession(root: string) {
  return Effect.runPromise(
    createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
}

function runWorkflow<A>(session: Awaited<ReturnType<typeof testSession>>, effect: Effect.Effect<A, unknown, Logging | import("@effect/platform").FileSystem.FileSystem>): Promise<A> {
  return Effect.runPromise(effect.pipe(
    Effect.provideService(Logging, loggingService(session.log, session.trace)),
    Effect.provide(NodeFileSystem.layer),
  ));
}

function runWorkflowWithFileSystem<A>(
  session: Awaited<ReturnType<typeof testSession>>,
  effect: Effect.Effect<A, unknown, Logging | FileSystem.FileSystem>,
  fileSystem: FileSystem.FileSystem,
): Promise<A> {
  return Effect.runPromise(effect.pipe(
    Effect.provideService(Logging, loggingService(session.log, session.trace)),
    Effect.provideService(FileSystem.FileSystem, fileSystem),
  ));
}

/** The run's state document, as its readers take it. */
async function readRunStatusFile(runDir: string): Promise<{
  status?: string;
  completedStages?: number;
  jobs: Array<{
    jobOrdinal: number;
    accepted: readonly RunAcceptedInvocation[];
    attempts: Record<string, number>;
    regions?: Record<string, WorkflowProgressRegionFinalizedRecord>;
  }>;
  actors: Record<string, Record<string, unknown>>;
}> {
  return JSON.parse(await readFile(join(runDir, "status.json"), "utf8"));
}

/** The run's accepted rows, as the invocation stream records them. */
async function acceptedRows(runDir: string): Promise<readonly InvocationAcceptedRecord[]> {
  return parseInvocationRecords(await readFile(invocationStreamPath(runDir), "utf8"))
    .filter((row): row is InvocationAcceptedRecord => row.kind === "invocation-accepted");
}

describe(" workflow execution", () => {
  it("materializes a validated CUDA KEEP before progress and downstream reads", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-promotion-run-"));
    try {
      await writeFile(join(root, "round.yml"), CUDA_ROUND_WORKFLOW);
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({ current_best: { path: "state/current-best.py" } }));
      await writeFile(join(root, "state", "current-best.py"), "seed\n");
      await writeFile(join(root, "kernel.py"), "candidate\n");
      const candidateDigest = `sha256:${createHash("sha256").update("candidate\n").digest("hex")}`;
      const session = await testSession(root);
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        root,
        workflowPath: join(root, "round.yml"),
        runDir: session.runDir,
        runId: "promotion",
        cwd: root,
        prompt: "close a round",
        agentRunner: (request) => Effect.promise(async () => {
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, JSON.stringify({
            // The worker contract accepts finite non-negative integers without
            // a safe bound.
            iteration: Number.MAX_SAFE_INTEGER + 1,
            decision: "KEEP",
            candidate: { path: "kernel.py", digest: candidateDigest },
            current_best: { path: "state/current-best.py", digest: "sha256:seed" },
            verification: { compile_passed: true, verify_passed: true },
            benchmark: { metric: "tflops", direction: "higher", samples: [2], best: 2, median: 2, runs: 1, warmup: 0 },
            // A worker may echo the candidate path here. Promotion must still
            // materialize the durable state.current_best path used by profile
            // stages on the next loop iteration.
            promotion: { promoted: true, resulting_best: { path: "kernel.py", digest: candidateDigest }, reason: "candidate improved" },
            records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
          }));
          return {
            sessionId: "promotion-session",
            transcriptPath: "/tmp/promotion.jsonl",
            text: "round closed",
            continuation: continuation("promotion-session"),
          };
        }),
      }));
      expect(await readFile(join(root, "state", "current-best.py"), "utf8")).toBe("candidate\n");
      const state = JSON.parse(await readFile(join(root, "state", "tuning-state.json"), "utf8")) as { current_best: { path?: string; digest?: string; value?: number; metric_tflops?: number; tflops?: number; iteration?: number; source?: string; promoted_at?: string }; history: unknown[] };
      expect(state.current_best.path).toBe("state/current-best.py");
      expect(state.current_best.digest).toBe(candidateDigest);
      expect(state.current_best.value).toBe(2);
      expect(state.current_best.metric_tflops).toBe(2);
      expect(state.current_best.tflops).toBe(2);
      expect(state.current_best.iteration).toBe(Number.MAX_SAFE_INTEGER + 1);
      expect(state.current_best.source).toBe("kernel.py");
      expect(state.current_best.promoted_at).toEqual(expect.any(String));
      expect(state.history).toHaveLength(1);
      const accepted = JSON.parse(await readFile(result.stages[0]!.resultPath!, "utf8")) as {
        current_best?: { path?: string; digest?: string };
        promotion?: { resulting_best?: { path?: string; digest?: string } };
      };
      expect(accepted.current_best?.path).toBe("state/current-best.py");
      expect(accepted.current_best?.digest).toBe(candidateDigest);
      expect(accepted.promotion?.resulting_best).toMatchObject({ path: "state/current-best.py", digest: candidateDigest });
      expect(result.stages[0]?.projections).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "round.materialization-v1", pointer: "" }),
        expect.objectContaining({ id: "round.decision", value: "KEEP" }),
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(["candidate", "resulting_best"] as const)(
    "fails a KEEP whose declared %s digest does not match the bytes",
    async (declaredOn) => {
      const root = await mkdtemp(join(tmpdir(), `piano-promotion-digest-${declaredOn}-`));
      try {
        await writeFile(join(root, "round.yml"), CUDA_ROUND_WORKFLOW);
        await mkdir(join(root, "state"), { recursive: true });
        await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
          current_best: { path: "state/current-best.py" },
        }));
        await writeFile(join(root, "state", "current-best.py"), "seed\n");
        await writeFile(join(root, "kernel.py"), "candidate\n");
        const actual = `sha256:${createHash("sha256").update("candidate\n").digest("hex")}`;
        const declared = declaredOn === "candidate" ? "sha256:not-the-candidate" : actual;
        const resulting = declaredOn === "resulting_best" ? "sha256:not-the-candidate" : actual;
        const session = await testSession(root);
        const calls: AgentRequest[] = [];
        await expect(runWorkflow(session, loadAndExecuteWorkflow({
          recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
          root,
          workflowPath: join(root, "round.yml"),
          runDir: session.runDir,
          runId: `promotion-digest-${declaredOn}`,
          cwd: root,
          prompt: "close a round",
          agentRunner: (request) => Effect.promise(async () => {
            calls.push(request);
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              iteration: 1,
              decision: "KEEP",
              candidate: { path: "kernel.py", digest: declared },
              current_best: { path: "state/current-best.py" },
              verification: { compile_passed: true, verify_passed: true },
              benchmark: { metric: "tflops", direction: "higher", samples: [2], best: 2, median: 2, runs: 1, warmup: 0 },
              promotion: {
                promoted: true,
                resulting_best: { path: "kernel.py", digest: resulting },
                reason: "candidate improved",
              },
              records: { round_path: "rounds/iter-001.json", state_path: "state/tuning-state.json" },
            }));
            const sessionId = `digest-${calls.length}`;
            return {
              sessionId,
              transcriptPath: `/tmp/${sessionId}.jsonl`,
              text: "round closed",
              continuation: continuation(sessionId),
            };
          }),
        }))).rejects.toThrow(declaredOn === "candidate"
          ? /KEEP candidate digest mismatch: declared=sha256:not-the-candidate, actual=sha256:/
          : /KEEP resulting-best digest mismatch: declared=sha256:not-the-candidate, actual=sha256:/);
        // A digest failure is a promotion check, not a contract failure: it
        // gets the one repair turn and then fails the stage.
        expect(calls).toHaveLength(2);
        // Nothing was materialized from the rejected round.
        expect(await readFile(join(root, "state", "current-best.py"), "utf8")).toBe("seed\n");
        const state = JSON.parse(await readFile(join(root, "state", "tuning-state.json"), "utf8")) as {
          history?: unknown[];
        };
        expect(state.history ?? []).toHaveLength(0);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("fails the run when the repaired attempt still cannot satisfy the promotion checks", async () => {
    // Repair budget is unchanged by the unified rule: a promotion error now
    // reuses the validate-repair loop, so exhaustion must still surface the
    // original WorkflowError instead of looping or silently degrading.
    const root = await mkdtemp(join(tmpdir(), "piano-promotion-exhaust-run-"));
    try {
      await writeFile(join(root, "round.yml"), CUDA_ROUND_WORKFLOW);
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({ current_best: { path: "state/current-best.py" } }));
      await writeFile(join(root, "state", "current-best.py"), "seed\n");
      const candidateDigest = `sha256:${createHash("sha256").update("candidate\n").digest("hex")}`;
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      await expect(runWorkflow(session, loadAndExecuteWorkflow({
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        root,
        workflowPath: join(root, "round.yml"),
        runDir: session.runDir,
        runId: "promotion-exhaust",
        cwd: root,
        prompt: "close a round",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, JSON.stringify({
            iteration: 1,
            decision: "KEEP",
            candidate: { path: "kernel.py", digest: candidateDigest },
            current_best: { path: "state/current-best.py" },
            verification: { compile_passed: true, verify_passed: true },
            benchmark: { metric: "tflops", direction: "higher", samples: [2], best: 2, median: 2, runs: 1, warmup: 0 },
            promotion: { promoted: true, resulting_best: { path: "kernel.py", digest: candidateDigest }, reason: "candidate improved" },
            records: { round_path: "rounds/iter-001.json", state_path: "state/tuning-state.json" },
          }));
          const sessionId = `close-${calls.length}`;
          return {
            sessionId,
            transcriptPath: `/tmp/${sessionId}.jsonl`,
            text: "round closed",
            continuation: continuation(sessionId),
          };
        }),
      }))).rejects.toThrow(/KEEP candidate is not readable/);
      expect(calls).toHaveLength(2);
      expect(await readFile(join(root, "state", "current-best.py"), "utf8")).toBe("seed\n");
      const state = JSON.parse(await readFile(join(root, "state", "tuning-state.json"), "utf8")) as { history?: unknown[] };
      expect(state.history ?? []).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("repairs a KEEP round whose candidate file is missing instead of failing the run", async () => {
    // Unified harness rule: the promotion precondition checks judge the
    // worker's output, so they must run pre-acceptance and feed back as a
    // repair turn — the live dsh run (iter-004, KEEP with no candidate on
    // disk) must self-heal instead of aborting with a schedule WorkflowError.
    const root = await mkdtemp(join(tmpdir(), "piano-missing-candidate-run-"));
    try {
      await writeFile(join(root, "round.yml"), CUDA_ROUND_WORKFLOW);
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({ current_best: { path: "state/current-best.py" } }));
      await writeFile(join(root, "state", "current-best.py"), "seed\n");
      // Attempt 1 declares KEEP but never writes the candidate file.
      const candidateDigest = `sha256:${createHash("sha256").update("candidate\n").digest("hex")}`;
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        root,
        workflowPath: join(root, "round.yml"),
        runDir: session.runDir,
        runId: "missing-candidate",
        cwd: root,
        prompt: "close a round",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const attempt = calls.length;
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, JSON.stringify({
            iteration: 1,
            decision: "KEEP",
            candidate: { path: "kernel.py", digest: candidateDigest },
            current_best: { path: "state/current-best.py" },
            verification: { compile_passed: true, verify_passed: true },
            benchmark: { metric: "tflops", direction: "higher", samples: [2], best: 2, median: 2, runs: 1, warmup: 0 },
            promotion: { promoted: true, resulting_best: { path: "kernel.py", digest: candidateDigest }, reason: "candidate improved" },
            records: { round_path: "rounds/iter-001.json", state_path: "state/tuning-state.json" },
          }));
          if (attempt === 2) await writeFile(join(root, "kernel.py"), "candidate\n");
          const sessionId = `close-${attempt}`;
          return {
            sessionId,
            transcriptPath: `/tmp/${sessionId}.jsonl`,
            text: "round closed",
            continuation: continuation(sessionId),
          };
        }),
      }));
      expect(calls).toHaveLength(2);
      expect(calls[1]?.prompt).toContain("Validation repair required");
      expect(calls[1]?.prompt).toContain("KEEP candidate is not readable");
      expect(await readFile(join(root, "state", "current-best.py"), "utf8")).toBe("candidate\n");
      const state = JSON.parse(await readFile(join(root, "state", "tuning-state.json"), "utf8")) as { history: unknown[] };
      expect(state.history).toHaveLength(1);
      expect(result.stages.find((stage) => stage.stageId === "measure")?.attempts).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("restores the promoted artifact when a validated CUDA round is discarded", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-discard-run-"));
    try {
      await writeFile(join(root, "round.yml"), CUDA_ROUND_WORKFLOW);
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({ current_best: { path: "state/current-best.py" }, history: [] }));
      await writeFile(join(root, "state", "current-best.py"), "promoted\n");
      await writeFile(join(root, "kernel.py"), "discarded\n");
      const session = await testSession(root);
      await runWorkflow(session, loadAndExecuteWorkflow({
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        root,
        workflowPath: join(root, "round.yml"),
        runDir: session.runDir,
        runId: "discard",
        cwd: root,
        prompt: "discard a round",
        agentRunner: (request) => Effect.promise(async () => {
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, JSON.stringify({
            iteration: 0,
            decision: "DISCARD",
            candidate: { path: "kernel.py" },
            current_best: { path: "state/current-best.py" },
            verification: { compile_passed: true, verify_passed: true },
            benchmark: { metric: "tflops", direction: "higher", samples: [1], best: 1, median: 1, runs: 1, warmup: 0 },
            promotion: { promoted: false, resulting_best: { path: "state/current-best.py" }, reason: "candidate did not improve" },
            records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
          }));
          return {
            sessionId: "discard-session",
            transcriptPath: "/tmp/discard.jsonl",
            text: "discarded",
            continuation: continuation("discard-session"),
          };
        }),
      }));
      expect(await readFile(join(root, "kernel.py"), "utf8")).toBe("promoted\n");
      const round = JSON.parse(await readFile(join(root, "rounds", "iter-000.json"), "utf8")) as {
        decision: string;
        promotion: { promoted: boolean };
      };
      expect(round.decision).toBe("DISCARD");
      expect(round.promotion).toMatchObject({ promoted: false });
      const state = JSON.parse(await readFile(join(root, "state", "tuning-state.json"), "utf8")) as {
        history: Array<{ decision?: string; action?: string }>;
      };
      expect(state.history).toContainEqual(expect.objectContaining({ decision: "DISCARD", action: "record" }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(["KEEP", "DISCARD"] as const)("materializes %s artifacts without UTF-8 transcoding", async (decision) => {
    const root = await mkdtemp(join(tmpdir(), `piano-binary-${decision.toLowerCase()}-`));
    try {
      await writeFile(join(root, "round.yml"), CUDA_ROUND_WORKFLOW);
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
        current_best: { path: "state/current-best.bin" },
        history: [],
      }));
      const baseline = Uint8Array.from([0x00, 0xff, 0x80, 0x41]);
      const candidate = Uint8Array.from([0xfe, 0x00, 0xc3, 0x28]);
      await writeFile(join(root, "state", "current-best.bin"), baseline);
      await writeFile(join(root, "kernel.bin"), candidate);
      const candidateDigest = `sha256:${createHash("sha256").update(candidate).digest("hex")}`;
      const session = await testSession(root);
      await runWorkflow(session, loadAndExecuteWorkflow({
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        root,
        workflowPath: join(root, "round.yml"),
        runDir: session.runDir,
        runId: `binary-${decision.toLowerCase()}`,
        cwd: root,
        prompt: "materialize a binary artifact exactly",
        agentRunner: (request) => Effect.promise(async () => {
          await writeFile(validationPath(request), JSON.stringify({
            iteration: 0,
            decision,
            candidate: { path: "kernel.bin", digest: candidateDigest },
            current_best: { path: "state/current-best.bin" },
            verification: { compile_passed: true, verify_passed: true },
            benchmark: { metric: "throughput", direction: "higher", samples: [2], best: 2, median: 2, runs: 1, warmup: 0 },
            promotion: {
              promoted: decision === "KEEP",
              resulting_best: { path: "state/current-best.bin" },
              reason: decision === "KEEP" ? "candidate improved" : "candidate regressed",
            },
            records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
          }));
          return {
            sessionId: `binary-${decision.toLowerCase()}`,
            transcriptPath: `/tmp/binary-${decision.toLowerCase()}.jsonl`,
            text: "done",
            continuation: continuation(`binary-${decision.toLowerCase()}`),
          };
        }),
      }));

      const expected = decision === "KEEP" ? candidate : baseline;
      const materializedPath = decision === "KEEP"
        ? join(root, "state", "current-best.bin")
        : join(root, "kernel.bin");
      expect(new Uint8Array(await readFile(materializedPath))).toEqual(expected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("demotes a KEEP that regresses below the durable best to a non-fatal DISCARD", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-keep-regression-"));
    try {
      await writeFile(join(root, "round.yml"), CUDA_ROUND_WORKFLOW);
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
        current_best: { path: "state/current-best.py", metric_tflops: 2, metric: { name: "tflops", best: 2, direction: "higher" } },
        history: [],
      }));
      await writeFile(join(root, "state", "current-best.py"), "seed\n");
      await writeFile(join(root, "kernel.py"), "regression\n");
      const session = await testSession(root);
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        root,
        workflowPath: join(root, "round.yml"),
        runDir: session.runDir,
        runId: "keep-regression",
        cwd: root,
        prompt: "close a regressed round",
        agentRunner: (request) => Effect.promise(async () => {
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, JSON.stringify({
            iteration: 1,
            decision: "KEEP",
            candidate: { path: "kernel.py" },
            current_best: { path: "state/current-best.py" },
            verification: { compile_passed: true, verify_passed: true },
            benchmark: { metric: "tflops", direction: "higher", samples: [1], best: 1, median: 1, runs: 1, warmup: 0 },
            promotion: { promoted: true, resulting_best: { path: "kernel.py" }, reason: "incorrect keep" },
            records: { round_path: "rounds/iter-001.json", state_path: "state/tuning-state.json" },
          }));
          return {
            sessionId: "keep-regression-session",
            transcriptPath: "/tmp/keep-regression.jsonl",
            text: "regression",
            continuation: continuation("keep-regression-session"),
          };
        }),
      }));
      // The workflow must succeed, not fail: a regression is non-fatal.
      // Current-best is unchanged (no promotion), and the regression candidate is
      // restored to match the durable best.
      expect(await readFile(join(root, "state", "current-best.py"), "utf8")).toBe("seed\n");
      expect(await readFile(join(root, "kernel.py"), "utf8")).toBe("seed\n");
      const state = JSON.parse(await readFile(join(root, "state", "tuning-state.json"), "utf8")) as {
        current_best: { metric_tflops?: number; metric?: { best?: number }; digest?: string; sha256?: string };
        history: Array<{ decision?: string; demoted_from_keep?: boolean; action?: string }>;
      };
      // The durable best is preserved, not overwritten with the regression.
      expect(state.current_best.metric_tflops).toBe(2);
      // The artifact digest is computed from the bytes still in force when the
      // worker declares none; nothing is copied from the rejected candidate.
      const seedDigest = `sha256:${createHash("sha256").update("seed\n").digest("hex")}`;
      expect(state.current_best.digest).toBe(seedDigest);
      expect(state.current_best.sha256).toBe(seedDigest);
      // The round record is preserved with the effective DISCARD decision and an
      // audit marker that the worker's KEEP was demoted.
      expect(state.history).toHaveLength(1);
      expect(state.history[0]).toMatchObject({ decision: "DISCARD", demoted_from_keep: true, action: "record" });
      const round = JSON.parse(await readFile(join(root, "rounds", "iter-001.json"), "utf8")) as {
        decision: string;
        demoted_from_keep: boolean;
        promotion: { promoted: boolean };
      };
      expect(round.decision).toBe("DISCARD");
      expect(round.demoted_from_keep).toBe(true);
      expect(round.promotion.promoted).toBe(false);
      expect(result.stages[0]?.resultPayload).toMatchObject({
        decision: "DISCARD",
        demoted_from_keep: true,
        promotion: { promoted: false },
      });
      expect(result.stages[0]?.projections).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "round.decision", value: "DISCARD" }),
        expect.objectContaining({ id: "round.promotion", value: expect.objectContaining({ promoted: false }) }),
      ]));
      expect(result.stages[0]?.projections?.find(({ id }) => id === "round.materialization-v1")?.value)
        .toEqual(result.stages[0]?.resultPayload);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("materializes a custom nested payload from the declared GPU projection protocol", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-nested-gpu-protocol-"));
    try {
      const workflowPath = join(root, "nested.yml");
      await writeFile(workflowPath, `version: 3
workflow:
  name: nested-gpu-protocol
  nodes:
    - loop:
        name: tune
        from: []
        entry: close-round
        exit: close-round
        iterations: 1
        nodes:
          - stage:
              name: close-round
              worker: custom-round
              from: []
`);
      const workerDir = join(root, "recipes", "custom-round");
      await mkdir(workerDir, { recursive: true });
      await writeWorkerContract(workerDir, JSON.stringify(nestedGpuContract()));
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "kernel.py"), "candidate\n");
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
        current_best: {
          path: "state/current-best.py",
          metric_throughput: 10,
          metric: { name: "throughput", best: 10, direction: "higher" },
        },
        history: [],
      }));
      const session = await testSession(root);
      const result = await runWorkflow(session, loadWorkflow(workflowPath, root, root).pipe(
        Effect.flatMap((loaded) => executeWorkflow(loaded, {
          runDir: session.runDir,
          runId: "nested-gpu-protocol",
          cwd: root,
          prompt: "materialize the nested round",
          agentRunner: (request) => Effect.promise(async () => {
            const payload = nestedGpuPayload();
            const report = payload.report as {
              artifacts: { challenger: Record<string, unknown>; incumbent: Record<string, unknown> };
              application: { resulting_best: Record<string, unknown> };
            };
            report.artifacts.challenger.forged = "worker-controlled";
            report.artifacts.incumbent.forged = { trust: "worker-controlled" };
            report.application.resulting_best.forged = true;
            await writeFile(validationPath(request), JSON.stringify(payload));
            return {
              sessionId: "nested-gpu",
              transcriptPath: "/tmp/nested-gpu.jsonl",
              text: "done",
              continuation: continuation("nested-gpu"),
            };
          }),
        })),
      ));

      expect(await readFile(join(root, "state", "current-best.py"), "utf8")).toBe("candidate\n");
      const durableState = JSON.parse(await readFile(join(root, "state", "tuning-state.json"), "utf8")) as {
        current_best?: { metric?: { name?: string; unit?: string; direction?: string }; tflops?: unknown };
        history?: Array<{ stage?: string }>;
      };
      expect(durableState.current_best?.metric).toMatchObject({ name: "throughput", unit: "items/s", direction: "higher" });
      expect(durableState.current_best).not.toHaveProperty("tflops");
      expect(durableState.history?.at(-1)?.stage).toBe("tune.close-round");
      const payload = result.stages[0]?.resultPayload as {
        report?: {
          verdict?: string;
          artifacts?: { challenger?: Record<string, unknown>; incumbent?: Record<string, unknown> };
          application?: { promoted?: boolean; resulting_best?: Record<string, unknown> };
        };
      };
      expect(payload.report).toMatchObject({
        verdict: "KEEP",
        artifacts: {
          challenger: { path: "kernel.py" },
          incumbent: { path: "state/current-best.py" },
        },
        application: {
          promoted: true,
          resulting_best: { path: "state/current-best.py" },
        },
      });
      expect(payload.report!.artifacts?.challenger).not.toHaveProperty("forged");
      expect(payload.report!.artifacts?.incumbent).not.toHaveProperty("forged");
      expect(payload.report!.application?.resulting_best).not.toHaveProperty("forged");
      expect(result.stages[0]?.projections).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "round.decision", pointer: "/report/verdict", value: "KEEP" }),
        expect.objectContaining({ id: "round.current-best", pointer: "/report/artifacts/incumbent" }),
      ]));
      await expect(readFile(join(root, "rounds", "iter-000.json"), "utf8"))
        .resolves.toContain('"report"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists and projects the canonical payload returned by materialized revalidation", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-gpu-materialized-normalization-"));
    try {
      const workflowPath = join(root, "nested.yml");
      await writeFile(workflowPath, NESTED_GPU_WORKFLOW);
      const workerDir = join(root, "recipes", "custom-round");
      await mkdir(workerDir, { recursive: true });
      await writeWorkerContract(workerDir, JSON.stringify(strippingGpuContract()));
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "kernel.py"), "candidate\n");
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
        current_best: { path: "state/current-best.py" },
        history: [],
      }));
      const session = await testSession(root);

      const result = await runWorkflow(session, loadWorkflow(workflowPath, root, root).pipe(
        Effect.flatMap((loaded) => executeWorkflow(loaded, {
          runDir: session.runDir,
          runId: "gpu-materialized-normalization",
          cwd: root,
          prompt: "accept only the contract-normalized materialization",
          agentRunner: (request) => Effect.promise(async () => {
            await writeFile(validationPath(request), JSON.stringify(nestedGpuPayload()));
            return {
              sessionId: "gpu-materialized-normalization",
              transcriptPath: "/tmp/gpu-materialized-normalization.jsonl",
              text: "done",
              continuation: continuation("gpu-materialized-normalization"),
            };
          }),
        })),
      ));

      const stage = result.stages[0]!;
      const accepted = stage.resultPayload as {
        report: {
          artifacts: { challenger: Record<string, unknown>; incumbent: Record<string, unknown> };
          application: { resulting_best: Record<string, unknown> };
        };
      };
      expect(accepted.report.artifacts.challenger).toEqual({ path: "kernel.py" });
      expect(accepted.report.artifacts.incumbent).toEqual({ path: "state/current-best.py" });
      expect(accepted.report.application.resulting_best).toEqual({ path: "state/current-best.py" });
      expect(stage.projections?.find(({ id }) => id === "round.materialization-v1")?.value)
        .toEqual(accepted.report);
      expect(stage.projections?.find(({ id }) => id === "round.candidate")?.value)
        .toEqual(accepted.report.artifacts.challenger);
      await expect(readFile(join(root, "rounds", "iter-000.json"), "utf8").then(JSON.parse))
        .resolves.toEqual(accepted);
      await expect(readFile(stage.resultPath!, "utf8").then(JSON.parse)).resolves.toEqual(accepted);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("revalidates a materialized payload with its worker-owned contract before any write", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-gpu-materialized-revalidation-"));
    try {
      const workflowPath = join(root, "nested.yml");
      await writeFile(workflowPath, NESTED_GPU_WORKFLOW);
      const workerDir = join(root, "recipes", "custom-round");
      await mkdir(workerDir, { recursive: true });
      const contract = nestedGpuContract() as {
        example: Record<string, unknown>;
        schema: Record<string, unknown>;
      };
      const example = nestedGpuPayload();
      const exampleReport = example.report as { artifacts: { challenger: Record<string, unknown> } };
      exampleReport.artifacts.challenger.kind = "source";
      contract.example = example;
      contract.schema = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        required: ["report"],
        properties: {
          report: {
            type: "object",
            required: ["artifacts"],
            properties: {
              artifacts: {
                type: "object",
                required: ["challenger"],
                properties: {
                  challenger: {
                    type: "object",
                    required: ["path", "kind"],
                    properties: {
                      path: { type: "string", minLength: 1 },
                      kind: { const: "source" },
                    },
                  },
                },
              },
            },
          },
        },
      };
      await writeWorkerContract(workerDir, JSON.stringify(contract));
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "kernel.py"), "candidate\n");
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      const initialState = JSON.stringify({ current_best: { path: "state/current-best.py" }, history: [] });
      await writeFile(join(root, "state", "tuning-state.json"), initialState);
      const session = await testSession(root);

      await expect(runWorkflow(session, loadWorkflow(workflowPath, root, root).pipe(
        Effect.flatMap((loaded) => executeWorkflow(loaded, {
          runDir: session.runDir,
          runId: "gpu-materialized-revalidation",
          cwd: root,
          prompt: "reject a materialized contract violation",
          agentRunner: (request) => Effect.promise(async () => {
            const payload = nestedGpuPayload();
            const report = payload.report as { artifacts: { challenger: Record<string, unknown> } };
            report.artifacts.challenger.kind = "source";
            await writeFile(validationPath(request), JSON.stringify(payload));
            return {
              sessionId: "gpu-materialized-revalidation",
              transcriptPath: "/tmp/gpu-materialized-revalidation.jsonl",
              text: "done",
              continuation: continuation("gpu-materialized-revalidation"),
            };
          }),
        })),
      ))).rejects.toThrow(/materialized result failed validator.*kind/);
      await expect(readFile(join(root, "state", "current-best.py"), "utf8")).resolves.toBe("baseline\n");
      await expect(readFile(join(root, "state", "tuning-state.json"), "utf8")).resolves.toBe(initialState);
      await expect(readFile(join(root, "rounds", "iter-000.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails an incomplete GPU projection protocol before materialization writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-incomplete-gpu-protocol-"));
    try {
      const workflowPath = join(root, "incomplete.yml");
      await writeFile(workflowPath, `version: 3
workflow:
  name: incomplete-gpu-protocol
  nodes:
    - stage:
        name: close-round
        worker: custom-round
        from: []
`);
      const workerDir = join(root, "recipes", "custom-round");
      await mkdir(workerDir, { recursive: true });
      await writeWorkerContract(
        workerDir,
        JSON.stringify(nestedGpuContract("round.records")),
      );
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "kernel.py"), "candidate\n");
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      const initialState = JSON.stringify({
        current_best: { path: "state/current-best.py", metric_throughput: 10 },
        history: [],
      });
      await writeFile(join(root, "state", "tuning-state.json"), initialState);
      const session = await testSession(root);

      await expect(runWorkflow(session, loadWorkflow(workflowPath, root, root).pipe(
        Effect.flatMap((loaded) => executeWorkflow(loaded, {
          runDir: session.runDir,
          runId: "incomplete-gpu-protocol",
          cwd: root,
          prompt: "do not partially materialize",
          agentRunner: (request) => Effect.promise(async () => {
            await writeFile(validationPath(request), JSON.stringify(nestedGpuPayload()));
            return {
              sessionId: "incomplete-gpu",
              transcriptPath: "/tmp/incomplete-gpu.jsonl",
              text: "done",
              continuation: continuation("incomplete-gpu"),
            };
          }),
        })),
      ))).rejects.toThrow(/missing projection declaration "round\.records"/);
      await expect(readFile(join(root, "state", "current-best.py"), "utf8")).resolves.toBe("baseline\n");
      await expect(readFile(join(root, "kernel.py"), "utf8")).resolves.toBe("candidate\n");
      await expect(readFile(join(root, "state", "tuning-state.json"), "utf8")).resolves.toBe(initialState);
      await expect(readFile(join(root, "rounds", "iter-000.json",), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects symlink escapes and write-target aliases before GPU materialization", async () => {
    for (const scenario of ["symlink", "alias"] as const) {
      const root = await mkdtemp(join(tmpdir(), `piano-gpu-${scenario}-`));
      const outside = await mkdtemp(join(tmpdir(), "piano-gpu-outside-"));
      try {
        await writeFile(join(root, "round.yml"), CUDA_ROUND_WORKFLOW);
        await mkdir(join(root, "state"), { recursive: true });
        await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({ current_best: { path: "state/current-best.py" }, history: [] }));
        await writeFile(join(root, "state", "current-best.py"), "baseline\n");
        await writeFile(join(root, "kernel.py"), "candidate\n");
        if (scenario === "symlink") {
          await writeFile(join(outside, "tuning-state.json"), "outside-state\n");
          await symlink(outside, join(root, "state-link"));
        }
        const session = await testSession(root);
        await expect(runWorkflow(session, loadAndExecuteWorkflow({
          recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
          root,
          workflowPath: join(root, "round.yml"),
          runDir: session.runDir,
          runId: `gpu-${scenario}`,
          cwd: root,
          prompt: `reject ${scenario}`,
          agentRunner: (request) => Effect.promise(async () => {
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              iteration: 0,
              decision: "KEEP",
              candidate: { path: "kernel.py" },
              current_best: { path: "state/current-best.py" },
              verification: { compile_passed: true, verify_passed: true },
              benchmark: { metric: "tflops", direction: "higher", samples: [2], best: 2, median: 2, runs: 1, warmup: 0 },
              promotion: { promoted: true, resulting_best: { path: "state/current-best.py" }, reason: "test" },
              records: {
                round_path: scenario === "alias" ? "state/tuning-state.json" : "rounds/iter-000.json",
                state_path: scenario === "symlink" ? "state-link/tuning-state.json" : "state/tuning-state.json",
              },
            }));
            return { sessionId: `gpu-${scenario}`, transcriptPath: `/tmp/gpu-${scenario}.jsonl`, text: "done", continuation: continuation(`gpu-${scenario}`) };
          }),
        }))).rejects.toThrow(scenario === "alias" ? /aliased paths/ : /symbolic-link component/);
        await expect(readFile(join(root, "state", "current-best.py"), "utf8")).resolves.toBe("baseline\n");
        await expect(readFile(join(root, "rounds", "iter-000.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
        if (scenario === "symlink") {
          await expect(readFile(join(outside, "tuning-state.json"), "utf8")).resolves.toBe("outside-state\n");
        }
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
      }
    }
  });

  it.each([
    ["backslash traversal", "foo\\..\\kernel.py"],
    ["drive-relative path", "C:kernel.py"],
    ["NUL path", "kernel\0.py"],
    ["dot segment", "foo/./kernel.py"],
    ["empty segment", "foo//kernel.py"],
  ] as const)("rejects %s artifact paths before any GPU write", async (_name, candidatePath) => {
    const root = await mkdtemp(join(tmpdir(), "piano-gpu-unsafe-artifact-"));
    try {
      await writeFile(join(root, "round.yml"), CUDA_ROUND_WORKFLOW);
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({ current_best: { path: "state/current-best.py" } }));
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      const initialState = await readFile(join(root, "state", "tuning-state.json"), "utf8");
      const session = await testSession(root);
      await expect(runWorkflow(session, loadAndExecuteWorkflow({
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        root,
        workflowPath: join(root, "round.yml"),
        runDir: session.runDir,
        runId: `gpu-unsafe-${_name.replaceAll(" ", "-")}`,
        cwd: root,
        prompt: "reject unsafe artifact path",
        agentRunner: (request) => Effect.promise(async () => {
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, JSON.stringify({
            iteration: 0,
            decision: "KEEP",
            candidate: { path: candidatePath },
            current_best: { path: "state/current-best.py" },
            verification: { compile_passed: true, verify_passed: true },
            benchmark: { metric: "tflops", direction: "higher", samples: [2], best: 2, median: 2, runs: 1, warmup: 0 },
            promotion: { promoted: true, resulting_best: { path: "kernel.py" }, reason: "test" },
            records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
          }));
          return { sessionId: "gpu-unsafe-artifact", transcriptPath: "/tmp/gpu-unsafe-artifact.jsonl", text: "done", continuation: continuation("gpu-unsafe-artifact") };
        }),
      }))).rejects.toThrow(/safe workspace-relative artifact path/);
      await expect(readFile(join(root, "state", "tuning-state.json"), "utf8")).resolves.toBe(initialState);
      await expect(readFile(join(root, "rounds", "iter-000.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a special filesystem node before any GPU materialization write", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-gpu-special-node-"));
    try {
      await writeFile(join(root, "round.yml"), CUDA_ROUND_WORKFLOW);
      await mkdir(join(root, "state"), { recursive: true });
      const initialState = JSON.stringify({ current_best: { path: "state/current-best.py" } });
      await writeFile(join(root, "state", "tuning-state.json"), initialState);
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await mkdir(join(root, "kernel.py"));
      const session = await testSession(root);

      await expect(runWorkflow(session, loadAndExecuteWorkflow({
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        root,
        workflowPath: join(root, "round.yml"),
        runDir: session.runDir,
        runId: "gpu-special-node",
        cwd: root,
        prompt: "reject a non-file artifact",
        agentRunner: (request) => Effect.promise(async () => {
          await writeFile(validationPath(request), JSON.stringify({
            iteration: 0,
            decision: "KEEP",
            candidate: { path: "kernel.py" },
            current_best: { path: "state/current-best.py" },
            verification: { compile_passed: true, verify_passed: true },
            benchmark: { metric: "tflops", direction: "higher", samples: [2], best: 2, median: 2, runs: 1, warmup: 0 },
            promotion: { promoted: true, resulting_best: { path: "state/current-best.py" }, reason: "test" },
            records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
          }));
          return {
            sessionId: "gpu-special-node",
            transcriptPath: "/tmp/gpu-special-node.jsonl",
            text: "done",
            continuation: continuation("gpu-special-node"),
          };
        }),
      }))).rejects.toThrow(/candidate\.path must be a regular file, got Directory/);
      await expect(readFile(join(root, "state", "tuning-state.json"), "utf8")).resolves.toBe(initialState);
      await expect(readFile(join(root, "state", "current-best.py"), "utf8")).resolves.toBe("baseline\n");
      await expect(readdir(join(root, "kernel.py"))).resolves.toEqual([]);
      await expect(readFile(join(root, "rounds", "iter-000.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects ancestor and descendant GPU write paths even when both are absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-gpu-ancestor-alias-"));
    try {
      await writeFile(join(root, "round.yml"), CUDA_ROUND_WORKFLOW);
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({ current_best: { path: "state/current-best.py" } }));
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      const session = await testSession(root);
      await expect(runWorkflow(session, loadAndExecuteWorkflow({
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        root,
        workflowPath: join(root, "round.yml"),
        runDir: session.runDir,
        runId: "gpu-ancestor-alias",
        cwd: root,
        prompt: "reject ancestor alias",
        agentRunner: (request) => Effect.promise(async () => {
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, JSON.stringify({
            iteration: 0,
            decision: "KEEP",
            candidate: { path: "records" },
            current_best: { path: "state/current-best.py" },
            verification: { compile_passed: true, verify_passed: true },
            benchmark: { metric: "tflops", direction: "higher", samples: [2], best: 2, median: 2, runs: 1, warmup: 0 },
            promotion: { promoted: true, resulting_best: { path: "kernel.py" }, reason: "test" },
            records: { round_path: "records/round.json", state_path: "records/state.json" },
          }));
          return { sessionId: "gpu-ancestor-alias", transcriptPath: "/tmp/gpu-ancestor-alias.jsonl", text: "done", continuation: continuation("gpu-ancestor-alias") };
        }),
      }))).rejects.toThrow(/aliased paths/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when durable state has no usable current_best.path", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-gpu-malformed-state-"));
    try {
      await writeFile(join(root, "round.yml"), CUDA_ROUND_WORKFLOW);
      await mkdir(join(root, "state"), { recursive: true });
      const initialState = JSON.stringify({ history: [] });
      await writeFile(join(root, "state", "tuning-state.json"), initialState);
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await writeFile(join(root, "kernel.py"), "candidate\n");
      const session = await testSession(root);
      await expect(runWorkflow(session, loadAndExecuteWorkflow({
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        root,
        workflowPath: join(root, "round.yml"),
        runDir: session.runDir,
        runId: "gpu-malformed-state",
        cwd: root,
        prompt: "reject malformed durable state",
        agentRunner: (request) => Effect.promise(async () => {
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, JSON.stringify({
            iteration: 0,
            decision: "KEEP",
            candidate: { path: "kernel.py" },
            current_best: { path: "state/current-best.py" },
            verification: { compile_passed: true, verify_passed: true },
            benchmark: { metric: "tflops", direction: "higher", samples: [2], best: 2, median: 2, runs: 1, warmup: 0 },
            promotion: { promoted: true, resulting_best: { path: "state/current-best.py" }, reason: "test" },
            records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
          }));
          return { sessionId: "gpu-malformed-state", transcriptPath: "/tmp/gpu-malformed-state.jsonl", text: "done", continuation: continuation("gpu-malformed-state") };
        }),
      }))).rejects.toThrow(/current_best\.path.*not a fallback/);
      await expect(readFile(join(root, "state", "tuning-state.json"), "utf8")).resolves.toBe(initialState);
      await expect(readFile(join(root, "rounds", "iter-000.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  const malformedDurableStateCases: readonly (readonly [string, Record<string, unknown>, RegExp])[] = [
    ["metric object with an invalid best", { metric: { name: "tflops", best: "bad", direction: "higher" } }, /durable metric best/],
    ["legacy metric with an invalid direction", { metric: "tflops", best: 10, direction: "sideways" }, /legacy durable metric direction/],
    ["legacy metric without its top-level best", { metric: "tflops", direction: "higher" }, /legacy durable metric best/],
    ["legacy metric with a modern unit alias", { metric: "tflops", best: 10, direction: "higher", unit: "TFLOP/s" }, /modern unit alias/],
    ["modern metric with an embedded legacy alias", { metric: { name: "tflops", unit: "TFLOP/s", metric: "tflops", best: 10, direction: "higher" } }, /legacy metric alias/],
    ["dynamic metric alias with an invalid type", { metric: { name: "tflops", best: 10, direction: "higher" }, metric_tflops: "bad" }, /alias "metric_tflops" must be a finite number/],
    ["dynamic metric alias conflicting with the canonical metric", { metric: { name: "tflops", best: 10, direction: "higher" }, metric_tflops: 9 }, /alias "metric_tflops" conflicts with canonical metric best 10/],
    ["dynamic metric alias for another identity", { metric: { name: "tflops", best: 10, direction: "higher" }, metric_throughput: 10 }, /alias "metric_throughput" conflicts with metric "tflops"/],
    ["generic value alias with an invalid type", { metric: { name: "tflops", best: 10, direction: "higher" }, value: "bad" }, /alias "value" must be a finite number/],
    ["generic value alias conflicting with the canonical metric", { metric: { name: "tflops", best: 10, direction: "higher" }, value: 9 }, /alias "value" conflicts with canonical metric best 10/],
    ["legacy tflops alias with an invalid type", { metric: { name: "tflops", best: 10, direction: "higher" }, tflops: "bad" }, /alias "tflops" must be a finite number/],
    ["tflops alias attached to another metric", { metric: { name: "throughput", best: 10, direction: "higher" }, tflops: 10 }, /alias "tflops" conflicts with metric "throughput"/],
    ["top-level best alias with an invalid type", { metric: { name: "tflops", best: 10, direction: "higher" }, best: "bad" }, /alias "best" must be a finite number/],
    ["top-level best alias conflicting with the canonical metric", { metric: { name: "tflops", best: 10, direction: "higher" }, best: 9 }, /alias "best" conflicts with canonical metric best 10/],
    ["top-level direction alias with an invalid value", { metric: { name: "tflops", best: 10, direction: "higher" }, direction: "sideways" }, /direction compatibility alias must be higher or lower/],
    ["top-level direction alias conflicting with the canonical metric", { metric: { name: "tflops", best: 10, direction: "higher" }, direction: "lower" }, /direction compatibility alias conflicts with canonical metric/],
    ["aliases conflicting without a canonical metric", { metric_tflops: 10, value: 9 }, /alias "value" conflicts with canonical metric best 10/],
    ["orphaned top-level best alias", { best: 10 }, /top-level best\/direction aliases require current_best\.metric/],
    ["history with a non-array shape", { history: {} }, /history must be an array/],
  ];

  it.each(malformedDurableStateCases)("fails closed for %s", async (_name, currentBestFields, expected) => {
    const root = await mkdtemp(join(tmpdir(), "piano-gpu-malformed-fields-"));
    try {
      await writeFile(join(root, "round.yml"), CUDA_ROUND_WORKFLOW);
      await mkdir(join(root, "state"), { recursive: true });
      const { history, ...durableFields } = currentBestFields;
      const initialState = JSON.stringify({
        current_best: { path: "state/current-best.py", ...durableFields },
        ...(history === undefined ? {} : { history }),
      });
      await writeFile(join(root, "state", "tuning-state.json"), initialState);
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await writeFile(join(root, "kernel.py"), "candidate\n");
      const session = await testSession(root);
      await expect(runWorkflow(session, loadAndExecuteWorkflow({
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        root,
        workflowPath: join(root, "round.yml"),
        runDir: session.runDir,
        runId: "gpu-malformed-fields",
        cwd: root,
        prompt: "reject malformed durable state fields",
        agentRunner: (request) => Effect.promise(async () => {
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, JSON.stringify({
            iteration: 0,
            decision: "KEEP",
            candidate: { path: "kernel.py" },
            current_best: { path: "state/current-best.py" },
            verification: { compile_passed: true, verify_passed: true },
            benchmark: { metric: "tflops", direction: "higher", samples: [11], best: 11, median: 11, runs: 1, warmup: 0 },
            promotion: { promoted: true, resulting_best: { path: "kernel.py" }, reason: "test" },
            records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
          }));
          return { sessionId: "gpu-malformed-fields", transcriptPath: "/tmp/gpu-malformed-fields.jsonl", text: "done", continuation: continuation("gpu-malformed-fields") };
        }),
      }))).rejects.toThrow(expected);
      await expect(readFile(join(root, "state", "tuning-state.json"), "utf8")).resolves.toBe(initialState);
      await expect(readFile(join(root, "state", "current-best.py"), "utf8")).resolves.toBe("baseline\n");
      await expect(readFile(join(root, "kernel.py"), "utf8")).resolves.toBe("candidate\n");
      await expect(readFile(join(root, "rounds", "iter-000.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects conflicting durable alias identities when a round has no benchmark identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-gpu-ambiguous-alias-identity-"));
    try {
      await writeFile(join(root, "round.yml"), CUDA_ROUND_WORKFLOW);
      await mkdir(join(root, "state"), { recursive: true });
      const initialState = JSON.stringify({
        current_best: {
          path: "state/current-best.py",
          metric_tflops: 10,
          metric_throughput: 10,
        },
        history: [],
      });
      await writeFile(join(root, "state", "tuning-state.json"), initialState);
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await writeFile(join(root, "kernel.py"), "blocked candidate\n");
      const session = await testSession(root);

      await expect(runWorkflow(session, loadAndExecuteWorkflow({
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        root,
        workflowPath: join(root, "round.yml"),
        runDir: session.runDir,
        runId: "gpu-ambiguous-alias-identity",
        cwd: root,
        prompt: "reject ambiguous durable aliases",
        agentRunner: (request) => Effect.promise(async () => {
          await writeFile(validationPath(request), JSON.stringify({
            iteration: 0,
            decision: "BLOCKED",
            candidate: { path: "kernel.py" },
            current_best: { path: "state/current-best.py" },
            verification: { compile_passed: true, verify_passed: true },
            promotion: {
              promoted: false,
              resulting_best: { path: "state/current-best.py" },
              reason: "measurement unavailable",
            },
            records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
          }));
          return {
            sessionId: "gpu-ambiguous-alias-identity",
            transcriptPath: "/tmp/gpu-ambiguous-alias-identity.jsonl",
            text: "done",
            continuation: continuation("gpu-ambiguous-alias-identity"),
          };
        }),
      }))).rejects.toThrow(/aliases encode conflicting metric identities/);
      await expect(readFile(join(root, "state", "tuning-state.json"), "utf8")).resolves.toBe(initialState);
      await expect(readFile(join(root, "state", "current-best.py"), "utf8")).resolves.toBe("baseline\n");
      await expect(readFile(join(root, "kernel.py"), "utf8")).resolves.toBe("blocked candidate\n");
      await expect(readFile(join(root, "rounds", "iter-000.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("migrates a legacy top-level metric when a matching modern round is promoted", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-gpu-legacy-metric-"));
    try {
      await writeFile(join(root, "round.yml"), NESTED_GPU_WORKFLOW);
      const workerDir = join(root, "recipes", "custom-round");
      await mkdir(workerDir, { recursive: true });
      await writeWorkerContract(workerDir, JSON.stringify(nestedGpuContract()));
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
        current_best: { path: "state/current-best.py", metric: "throughput", best: 10, direction: "higher" },
      }));
      await writeFile(join(root, "kernel.py"), "candidate\n");
      const session = await testSession(root);
      await runWorkflow(session, loadWorkflow(join(root, "round.yml"), root, root).pipe(
        Effect.flatMap((loaded) => executeWorkflow(loaded, {
          runDir: session.runDir,
          runId: "gpu-legacy-metric",
          cwd: root,
          prompt: "migrate the legacy metric",
          agentRunner: (request) => Effect.promise(async () => {
            await writeFile(validationPath(request), JSON.stringify(nestedGpuPayload(11)));
            return { sessionId: "gpu-legacy-metric", transcriptPath: "/tmp/gpu-legacy-metric.jsonl", text: "done", continuation: continuation("gpu-legacy-metric") };
          }),
        })),
      ));
      const state = JSON.parse(await readFile(join(root, "state", "tuning-state.json"), "utf8")) as {
        current_best: {
          metric?: Record<string, unknown>;
          metric_throughput?: number;
          value?: number;
          best?: number;
          direction?: string;
        };
      };
      expect(state.current_best.metric).toMatchObject({ name: "throughput", unit: "items/s", best: 11, direction: "higher" });
      expect(state.current_best).toMatchObject({
        metric_throughput: 11,
        value: 11,
        best: 11,
        direction: "higher",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rolls back all GPU materialization files when the accepted result write fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-gpu-transaction-"));
    const outside = await mkdtemp(join(tmpdir(), "piano-gpu-transaction-outside-"));
    try {
      await writeFile(join(root, "round.yml"), CUDA_ROUND_WORKFLOW);
      await mkdir(join(root, "state"), { recursive: true });
      const initialState = JSON.stringify({ current_best: { path: "state/current-best.py" }, history: [] });
      await writeFile(join(root, "state", "tuning-state.json"), initialState);
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await writeFile(join(root, "kernel.py"), "candidate\n");
      await writeFile(join(outside, "sentinel"), "outside\n");
      // This is the old predictable fallback name. The new writer must use a
      // random exclusive sibling and must never follow this pre-created link.
      await symlink(join(outside, "sentinel"), join(root, "state", "tuning-state.json.piano-write.tmp"));
      const originalBestMode = (await stat(join(root, "state", "current-best.py"))).mode;
      const session = await testSession(root);
      let acceptedResultPath: string | undefined;
      const baseFileSystem = await Effect.runPromise(Effect.gen(function* () {
        return yield* FileSystem.FileSystem;
      }).pipe(Effect.provide(NodeFileSystem.layer)));
      let acceptedResultRenameFailed = false;
      const failingFileSystem: FileSystem.FileSystem = {
        ...baseFileSystem,
        rename: (from, to) => {
          if (isInvocationResultPath(to) && !acceptedResultRenameFailed) {
            acceptedResultRenameFailed = true;
            return Effect.fail(new Error("injected accepted-result rename failure") as never);
          }
          return baseFileSystem.rename(from, to);
        },
      };
      await expect(runWorkflowWithFileSystem(session, loadAndExecuteWorkflow({
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        root,
        workflowPath: join(root, "round.yml"),
        runDir: session.runDir,
        runId: "gpu-transaction",
        cwd: root,
        prompt: "rollback materialization",
        agentRunner: (request) => Effect.promise(async () => {
          acceptedResultPath = validationPath(request);
          await mkdir(dirname(acceptedResultPath), { recursive: true });
          await writeFile(acceptedResultPath, JSON.stringify({
            iteration: 0,
            decision: "KEEP",
            candidate: { path: "kernel.py" },
            current_best: { path: "state/current-best.py" },
            verification: { compile_passed: true, verify_passed: true },
            benchmark: { metric: "tflops", direction: "higher", samples: [2], best: 2, median: 2, runs: 1, warmup: 0 },
            promotion: { promoted: true, resulting_best: { path: "kernel.py" }, reason: "test" },
            records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
          }));
          return { sessionId: "gpu-transaction", transcriptPath: "/tmp/gpu-transaction.jsonl", text: "done", continuation: continuation("gpu-transaction") };
        }),
      }), failingFileSystem)).rejects.toThrow(/materialization transaction failed.*rollback completed/);
      await expect(readFile(join(root, "state", "current-best.py"), "utf8")).resolves.toBe("baseline\n");
      expect((await stat(join(root, "state", "current-best.py"))).mode).toBe(originalBestMode);
      await expect(readFile(join(root, "state", "tuning-state.json"), "utf8")).resolves.toBe(initialState);
      await expect(readFile(join(root, "kernel.py"), "utf8")).resolves.toBe("candidate\n");
      await expect(readFile(join(root, "rounds", "iter-000.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      if (acceptedResultPath !== undefined) {
        await expect(readFile(acceptedResultPath, "utf8")).resolves.not.toContain("sha256:");
      }
      await expect(readFile(join(outside, "sentinel"), "utf8")).resolves.toBe("outside\n");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("cleans a temporary binary sibling when its write fails after creation", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-gpu-temp-cleanup-"));
    try {
      await writeFile(join(root, "round.yml"), CUDA_ROUND_WORKFLOW);
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
        current_best: { path: "state/current-best.py" },
        history: [],
      }));
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await writeFile(join(root, "kernel.py"), "candidate\n");
      const session = await testSession(root);
      const baseFileSystem = await Effect.runPromise(Effect.gen(function* () {
        return yield* FileSystem.FileSystem;
      }).pipe(Effect.provide(NodeFileSystem.layer)));
      let injected = false;
      const failingFileSystem: FileSystem.FileSystem = {
        ...baseFileSystem,
        writeFile: (path, data, options) => {
          const write = baseFileSystem.writeFile(path, data, options);
          if (!injected && String(path).includes(".piano-") && String(path).endsWith(".tmp")) {
            injected = true;
            return write.pipe(Effect.flatMap(() => Effect.fail(new Error("injected temporary write failure") as never)));
          }
          return write;
        },
      };

      await expect(runWorkflowWithFileSystem(session, loadAndExecuteWorkflow({
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        root,
        workflowPath: join(root, "round.yml"),
        runDir: session.runDir,
        runId: "gpu-temp-cleanup",
        cwd: root,
        prompt: "clean a failed materialization write",
        agentRunner: (request) => Effect.promise(async () => {
          await writeFile(validationPath(request), JSON.stringify({
            iteration: 0,
            decision: "KEEP",
            candidate: { path: "kernel.py" },
            current_best: { path: "state/current-best.py" },
            verification: { compile_passed: true, verify_passed: true },
            benchmark: { metric: "tflops", direction: "higher", samples: [2], best: 2, median: 2, runs: 1, warmup: 0 },
            promotion: { promoted: true, resulting_best: { path: "state/current-best.py" }, reason: "candidate improved" },
            records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
          }));
          return {
            sessionId: "gpu-temp-cleanup",
            transcriptPath: "/tmp/gpu-temp-cleanup.jsonl",
            text: "done",
            continuation: continuation("gpu-temp-cleanup"),
          };
        }),
      }), failingFileSystem)).rejects.toThrow(/materialization transaction failed/);

      expect(injected).toBe(true);
      expect((await readdir(join(root, "state"))).some((entry) => entry.includes(".piano-") && entry.endsWith(".tmp"))).toBe(false);
      await expect(readFile(join(root, "state", "current-best.py"), "utf8")).resolves.toBe("baseline\n");
      await expect(readFile(join(root, "kernel.py"), "utf8")).resolves.toBe("candidate\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses a recoverable replacement fallback when overwrite rename reports a Windows-style conflict", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-gpu-windows-replace-"));
    try {
      await writeFile(join(root, "round.yml"), CUDA_ROUND_WORKFLOW);
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
        current_best: { path: "state/current-best.py" },
        history: [],
      }));
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await writeFile(join(root, "kernel.py"), "candidate\n");
      const session = await testSession(root);
      const baseFileSystem = await Effect.runPromise(Effect.gen(function* () {
        return yield* FileSystem.FileSystem;
      }).pipe(Effect.provide(NodeFileSystem.layer)));
      let injected = false;
      const windowsConflictFileSystem: FileSystem.FileSystem = {
        ...baseFileSystem,
        rename: (from, to) => {
          if (!injected && String(to).endsWith("/state/current-best.py")) {
            injected = true;
            return Effect.fail(Object.assign(new Error("simulated Windows replace conflict"), { code: "EEXIST" }) as never);
          }
          return baseFileSystem.rename(from, to);
        },
      };

      await runWorkflowWithFileSystem(session, loadAndExecuteWorkflow({
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        root,
        workflowPath: join(root, "round.yml"),
        runDir: session.runDir,
        runId: "gpu-windows-replace",
        cwd: root,
        prompt: "replace current best safely",
        agentRunner: (request) => Effect.promise(async () => {
          await writeFile(validationPath(request), JSON.stringify({
            iteration: 0,
            decision: "KEEP",
            candidate: { path: "kernel.py" },
            current_best: { path: "state/current-best.py" },
            verification: { compile_passed: true, verify_passed: true },
            benchmark: { metric: "tflops", direction: "higher", samples: [2], best: 2, median: 2, runs: 1, warmup: 0 },
            promotion: { promoted: true, resulting_best: { path: "state/current-best.py" }, reason: "candidate improved" },
            records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
          }));
          return {
            sessionId: "gpu-windows-replace",
            transcriptPath: "/tmp/gpu-windows-replace.jsonl",
            text: "done",
            continuation: continuation("gpu-windows-replace"),
          };
        }),
      }), windowsConflictFileSystem);

      expect(injected).toBe(true);
      await expect(readFile(join(root, "state", "current-best.py"), "utf8")).resolves.toBe("candidate\n");
      expect((await readdir(join(root, "state"))).some((entry) => entry.includes(".piano-replace-"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("restores the destination when the Windows replacement fallback cannot install the temporary file", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-gpu-windows-replace-rollback-"));
    try {
      await writeFile(join(root, "round.yml"), CUDA_ROUND_WORKFLOW);
      await mkdir(join(root, "state"), { recursive: true });
      const initialState = JSON.stringify({
        current_best: { path: "state/current-best.py" },
        history: [],
      });
      await writeFile(join(root, "state", "tuning-state.json"), initialState);
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await writeFile(join(root, "kernel.py"), "candidate\n");
      const session = await testSession(root);
      const baseFileSystem = await Effect.runPromise(Effect.gen(function* () {
        return yield* FileSystem.FileSystem;
      }).pipe(Effect.provide(NodeFileSystem.layer)));
      let destinationAttempts = 0;
      const failedWindowsReplaceFileSystem: FileSystem.FileSystem = {
        ...baseFileSystem,
        rename: (from, to) => {
          if (String(to).endsWith("/state/current-best.py")) {
            destinationAttempts += 1;
            if (destinationAttempts === 1) {
              return Effect.fail(Object.assign(new Error("simulated Windows replace conflict"), { code: "EEXIST" }) as never);
            }
            if (destinationAttempts === 2) {
              return Effect.fail(Object.assign(new Error("simulated fallback install failure"), { code: "EACCES" }) as never);
            }
          }
          return baseFileSystem.rename(from, to);
        },
      };
      let acceptedResultPath: string | undefined;

      await expect(runWorkflowWithFileSystem(session, loadAndExecuteWorkflow({
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        root,
        workflowPath: join(root, "round.yml"),
        runDir: session.runDir,
        runId: "gpu-windows-replace-rollback",
        cwd: root,
        prompt: "restore a failed Windows replacement",
        agentRunner: (request) => Effect.promise(async () => {
          acceptedResultPath = validationPath(request);
          await writeFile(acceptedResultPath, JSON.stringify({
            iteration: 0,
            decision: "KEEP",
            candidate: { path: "kernel.py" },
            current_best: { path: "state/current-best.py" },
            verification: { compile_passed: true, verify_passed: true },
            benchmark: { metric: "tflops", direction: "higher", samples: [2], best: 2, median: 2, runs: 1, warmup: 0 },
            promotion: { promoted: true, resulting_best: { path: "state/current-best.py" }, reason: "candidate improved" },
            records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
          }));
          return {
            sessionId: "gpu-windows-replace-rollback",
            transcriptPath: "/tmp/gpu-windows-replace-rollback.jsonl",
            text: "done",
            continuation: continuation("gpu-windows-replace-rollback"),
          };
        }),
      }), failedWindowsReplaceFileSystem)).rejects.toThrow(
        /atomic replace fallback failed.*original destination restored.*rollback completed/,
      );

      expect(destinationAttempts).toBeGreaterThanOrEqual(3);
      await expect(readFile(join(root, "state", "current-best.py"), "utf8")).resolves.toBe("baseline\n");
      await expect(readFile(join(root, "state", "tuning-state.json"), "utf8")).resolves.toBe(initialState);
      await expect(readFile(join(root, "kernel.py"), "utf8")).resolves.toBe("candidate\n");
      expect((await readdir(join(root, "state"))).some((entry) => entry.includes(".piano-replace-"))).toBe(false);
      await expect(readFile(join(root, "rounds", "iter-000.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      if (acceptedResultPath !== undefined) {
        await expect(readFile(acceptedResultPath, "utf8")).resolves.not.toContain("sha256:");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects benchmark unit and direction identity mismatches", async () => {
    for (const mismatch of ["unit", "direction"] as const) {
      const root = await mkdtemp(join(tmpdir(), `piano-gpu-benchmark-${mismatch}-`));
      try {
        const workflowPath = join(root, "round.yml");
        await writeFile(workflowPath, NESTED_GPU_WORKFLOW);
        const workerDir = join(root, "recipes", "custom-round");
        await mkdir(workerDir, { recursive: true });
        await writeWorkerContract(workerDir, JSON.stringify(nestedGpuContract()));
        await mkdir(join(root, "state"), { recursive: true });
        await writeFile(join(root, "kernel.py"), "candidate\n");
        await writeFile(join(root, "state", "current-best.py"), "baseline\n");
        await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
          current_best: { path: "state/current-best.py", metric: { name: "throughput", unit: "items/s", best: 10, direction: "higher" } },
          history: [],
        }));
        const session = await testSession(root);
        await expect(runWorkflow(session, loadWorkflow(workflowPath, root, root).pipe(
          Effect.flatMap((loaded) => executeWorkflow(loaded, {
            runDir: session.runDir,
            runId: `gpu-benchmark-${mismatch}`,
            cwd: root,
            prompt: `reject benchmark ${mismatch} mismatch`,
            agentRunner: (request) => Effect.promise(async () => {
              const payload = nestedGpuPayload();
              const report = payload.report as { measurement: Record<string, unknown> };
              report.measurement[mismatch === "unit" ? "unit" : "direction"] = mismatch === "unit" ? "bytes/s" : "lower";
              await writeFile(validationPath(request), JSON.stringify(payload));
              return { sessionId: `gpu-benchmark-${mismatch}`, transcriptPath: `/tmp/gpu-benchmark-${mismatch}.jsonl`, text: "done", continuation: continuation(`gpu-benchmark-${mismatch}`) };
            }),
          })),
        ))).rejects.toThrow(/benchmark identity mismatch/);
        await expect(readFile(join(root, "state", "current-best.py"), "utf8")).resolves.toBe("baseline\n");
        await expect(readFile(join(root, "rounds", "iter-000.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  it("stops a tuning loop after a blocked prerequisite and still runs its summary", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-blocked-loop-run-"));
    try {
      await writeFile(join(root, "blocked.yml"), BLOCKED_LOOP_WORKFLOW);
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        root,
        workflowPath: join(root, "blocked.yml"),
        runDir: session.runDir,
        runId: "blocked-loop",
        cwd: root,
        prompt: "tune the blocked case",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          if (stage === "setup") {
            await writeFile(path, JSON.stringify({
              status: "blocked",
              target: { operator: "gemv", shape: "4096x4096 f32", dtype: "f32" },
              device: { name: "none", architecture: "unknown" },
              toolchain: { compiler: "missing", runtime: "missing", profiler: "missing" },
              blocker: "CUDA is not available",
            }));
          } else if (stage === "summary") {
            await writeFile(path, JSON.stringify({
              run_id: "blocked-loop",
              summary: "blocked before tuning",
              outcome: "unmeasured",
              winner: null,
            }));
          } else {
            throw new Error(`unexpected stage after blocked setup: ${stage}`);
          }
          return {
            sessionId: `${stage}-session`,
            transcriptPath: `/tmp/${stage}.jsonl`,
            text: stage,
            continuation: continuation(`${stage}-session`),
          };
        }),
      }));
      expect(calls.map(stageId)).toEqual(["setup", "summary"]);
      expect(result.stages.map((stage) => stage.stageId)).toEqual(["setup", "summary"]);
      expect(result.stages[0]?.projections).toContainEqual(expect.objectContaining({
        id: "workflow.status",
        value: "blocked",
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not derive blocking control from undeclared payload fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-undeclared-block-control-"));
    try {
      const workflowPath = join(root, "control.yml");
      await writeFile(workflowPath, `version: 3
workflow:
  name: undeclared-block-control
  nodes:
    - stage:
        name: gate
        worker: control
        from: []
    - loop:
        name: work-loop
        from: [gate]
        entry: work
        exit: work
        iterations: 2
        nodes:
          - stage:
              name: work
              worker: control
              from: []
    - stage:
        name: done
        worker: control
        from: [work-loop]
`);
      const workerDir = join(root, "recipes", "control");
      await mkdir(workerDir, { recursive: true });
      await writeWorkerContract(workerDir, JSON.stringify({
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          required: ["status", "decision", "block_scope"],
          properties: {
            status: { const: "blocked" },
            decision: { const: "BLOCKED" },
            block_scope: { const: "global" },
          },
          additionalProperties: false,
        },
        example: { status: "blocked", decision: "BLOCKED", block_scope: "global" },
        outputs: { metrics: [], projections: [] },
      }));
      const session = await testSession(root);
      const calls: string[] = [];
      const result = await runWorkflow(session, loadWorkflow(workflowPath, root, root).pipe(
        Effect.flatMap((loaded) => executeWorkflow(loaded, {
          runDir: session.runDir,
          runId: "undeclared-block-control",
          cwd: root,
          prompt: "run despite undeclared control-looking fields",
          agentRunner: (request) => Effect.promise(async () => {
            const stage = stageId(request);
            calls.push(stage);
            // Every stage names the contract-bearing `control` worker, so each
            // turn must write a valid result. The contract declares no
            // projections, so these control-looking fields stay ordinary data.
            await mkdir(dirname(validationPath(request)), { recursive: true });
            await writeFile(validationPath(request), JSON.stringify({
              status: "blocked",
              decision: "BLOCKED",
              block_scope: "global",
            }));
            return {
              sessionId: `${stage}-${calls.length}`,
              transcriptPath: `/tmp/${stage}-${calls.length}.jsonl`,
              text: stage,
              continuation: continuation(`${stage}-${calls.length}`),
            };
          }),
        })),
      ));

      expect(calls).toEqual(["gate", "work-loop.work", "work-loop.work", "done"]);
      expect(result.stages.find((stage) => stage.stageId === "gate")?.projections ?? []).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails a stage whose declared timeout is exceeded by a runaway agent", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-stage-timeout-run-"));
    try {
      const TIMEOUT_WORKFLOW = `version: 3
workflow:
  name: stage-timeout
  nodes:
    - stage:
        name: respond
        worker: basic
        timeout: 1
        from: []
`;
      await writeFile(join(root, "timeout.yml"), TIMEOUT_WORKFLOW);
      const session = await testSession(root);
      // The agent never returns (the run-away `find /` equivalent); the declared
      // 1s stage cap must abort the run instead of hanging it indefinitely.
      await expect(runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "timeout.yml"),
        runDir: session.runDir,
        runId: "stage-timeout",
        cwd: root,
        prompt: "explore forever",
        agentRunner: () => Effect.promise(() => new Promise(() => undefined)),
      }))).rejects.toThrow(/timed out after/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("absorbs an iteration-scoped blocked implement and continues the loop with pseudo-feedback", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-absorb-block-loop-"));
    try {
      await writeFile(join(root, "absorb.yml"), ABSORB_BLOCK_LOOP_WORKFLOW);
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
        current_best: { path: "state/current-best.py", metric_tflops: 1, metric: { name: "tflops", best: 1, direction: "higher" } },
        history: [],
      }));
      await writeFile(join(root, "state", "current-best.py"), "current best\n");
      await writeFile(join(root, "kernel.py"), "candidate\n");
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "absorb.yml"),
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        runDir: session.runDir,
        runId: "absorb-loop",
        cwd: root,
        prompt: "tune the blocked case",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          if (stage === "tune.profile") {
            await writeFile(path, JSON.stringify({
              status: "ready",
              target_operator: "op",
              device: { name: "mock", architecture: "mock" },
              metrics: { compute_utilization: 0.5, memory_bandwidth_utilization: 0.5, achieved_occupancy: 0.5, launch_overhead: 0.1 },
              bottlenecks: [{ type: "compute", description: "mock", evidence: "mock" }],
              analysis: "mock profile",
            }));
          } else if (stage === "tune.implement") {
            const iteration = iterationOf(request);
            const payload = iteration === 0
              ? {
                status: "blocked",
                variable: "var-r7",
                diff_summary: "proposed dte change",
                compile: { passed: false, target: "kernel" },
                blocker: "violates hardware contract",
                block_scope: "iteration",
              }
              : {
                status: "compiled",
                variable: `var-${iteration}`,
                diff_summary: "applied change",
                compile: { passed: true, target: "kernel", so_commit: "abc123" },
              };
            await writeFile(path, JSON.stringify(payload));
          } else if (stage === "tune.measure") {
            const iteration = iterationOf(request);
            await writeFile(path, JSON.stringify({
              iteration,
              decision: "KEEP",
              candidate: { path: "kernel.py" },
              current_best: { path: "state/current-best.py" },
              verification: { compile_passed: true, verify_passed: true },
              benchmark: { metric: "tflops", direction: "higher", samples: [1], best: 1, median: 1, runs: 1, warmup: 0 },
              promotion: { promoted: true, resulting_best: { path: "state/current-best.py" }, reason: "ok" },
              records: { round_path: `rounds/iter-${String(iteration).padStart(3, "0")}.json`, state_path: "state/tuning-state.json" },
            }));
          } else if (stage === "summary") {
            await writeFile(path, JSON.stringify({ run_id: "absorb-block", summary: "done", outcome: "unmeasured" }));
          } else {
            throw new Error(`unexpected stage: ${stage}`);
          }
          return {
            sessionId: `${stage}-session`,
            transcriptPath: `/tmp/${stage}.jsonl`,
            text: stage,
            continuation: continuation(`${stage}-session`),
          };
        }),
      }));
      // Round 0's implement was blocked but iteration-scoped: the loop must
      // keep running — all 3 iterations reached implement, and measure only
      // ran for the 2 compiled rounds (it is skipped while the scope stopped).
      const implementCalls = calls.filter((call) => stageId(call) === "tune.implement");
      const measureCalls = calls.filter((call) => stageId(call) === "tune.measure");
      expect(implementCalls).toHaveLength(3);
      expect(measureCalls).toHaveLength(2);
      expect(calls.some((call) => stageId(call) === "summary")).toBe(true);
      // Pseudo-feedback: round 1's profile inputs must contain round 0's
      // absorbed blocked report (threaded as feedback), so the next idea can
      // see the variable was tried and blocked instead of re-proposing it.
      const round1Profile = calls.find((call) => stageId(call) === "tune.profile" && iterationOf(call) === 1);
      const contextPath = round1Profile?.contextFilePaths?.find((path) => path.endsWith("/inputs.json"));
      const context = JSON.parse(await readFile(contextPath!, "utf8")) as {
        inputs: Array<{ resultPayload?: { status?: string; block_scope?: string } }>;
      };
      expect(context.inputs.some((input) => input.resultPayload?.status === "blocked")).toBe(true);
      expect(context.inputs.some((input) => input.resultPayload?.block_scope === "iteration")).toBe(true);
      const blocked = result.stages.find((stage) =>
        stage.stageId === "tune.implement" && stage.resultPayload !== undefined &&
        (stage.resultPayload as { status?: string }).status === "blocked");
      expect(blocked?.projections).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "workflow.status", value: "blocked" }),
        expect.objectContaining({ id: "workflow.block-scope", value: "iteration" }),
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("terminates a tuning loop on a global-scoped block inside the loop and still runs its summary", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-global-block-loop-"));
    try {
      await writeFile(join(root, "global.yml"), ABSORB_BLOCK_LOOP_WORKFLOW);
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "global.yml"),
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        runDir: session.runDir,
        runId: "global-loop",
        cwd: root,
        prompt: "tune the blocked case",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          if (stage === "tune.profile") {
            await writeFile(path, JSON.stringify({
              status: "ready",
              target_operator: "op",
              device: { name: "mock", architecture: "mock" },
              metrics: { compute_utilization: 0.5, memory_bandwidth_utilization: 0.5, achieved_occupancy: 0.5, launch_overhead: 0.1 },
              bottlenecks: [{ type: "compute", description: "mock", evidence: "mock" }],
              analysis: "mock profile",
            }));
          } else if (stage === "tune.implement") {
            await writeFile(path, JSON.stringify({
              status: "blocked",
              variable: "var-device",
              diff_summary: "device gone",
              compile: { passed: false, target: "kernel" },
              blocker: "device is not available",
              block_scope: "global",
            }));
          } else if (stage === "summary") {
            await writeFile(path, JSON.stringify({ run_id: "global-block", summary: "blocked before tuning", outcome: "unmeasured" }));
          } else {
            throw new Error(`unexpected stage after global block: ${stage}`);
          }
          return {
            sessionId: `${stage}-session`,
            transcriptPath: `/tmp/${stage}.jsonl`,
            text: stage,
            continuation: continuation(`${stage}-session`),
          };
        }),
      }));
      // A global-scoped block inside the loop is terminal: only round 0 ran,
      // measure never fired, and summary still synthesized the conclusion.
      expect(calls.map(stageId)).toEqual(["tune.profile", "tune.implement", "summary"]);
      expect(calls.filter((call) => stageId(call) === "tune.measure")).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats mixed blocked boundary scopes as terminal when any slot is global", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-mixed-block-scope-loop-"));
    try {
      await writeFile(join(root, "mixed.yml"), `version: 3
workflow:
  name: mixed-block-scope-loop
  nodes:
    - loop:
        name: tune
        from: []
        entry: seed
        exit: race
        iterations: 2
        nodes:
          - stage:
              name: seed
              worker: basic
              from: []
          - tournament:
              name: race
              from: [seed]
              over: seed.strategies
              count: 2
              entry: verify
              exit: verify
              nodes:
                - stage:
                    name: verify
                    worker: mixed-block-race
                    from: []
    - stage:
        name: summary
        worker: basic
        from: [tune]
`);
      const workerDir = join(root, "recipes", "mixed-block-race");
      await mkdir(workerDir, { recursive: true });
      await installTestProposalContract(root, "basic");
      await writeWorkerContract(workerDir, JSON.stringify({
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          required: ["status", "block_scope"],
          properties: {
            status: { const: "blocked" },
            block_scope: { enum: ["global", "iteration"] },
          },
          additionalProperties: false,
        },
        example: { status: "blocked", block_scope: "iteration" },
        outputs: {
          metrics: [],
          projections: [
            { id: "workflow.status", pointer: "/status", format: "string", required: true },
            { id: "workflow.block-scope", pointer: "/block_scope", format: "string", required: true },
          ],
        },
      }));
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      await runWorkflow(session, loadWorkflow(join(root, "mixed.yml"), root, root).pipe(
        Effect.flatMap((loaded) => executeWorkflow(loaded, {
          runDir: session.runDir,
          runId: "mixed-block-scope-loop",
          cwd: root,
          prompt: "stop when any blocked lane is globally scoped",
          agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          if (stage.endsWith(".seed")) {
            await mkdir(dirname(validationPath(request)), { recursive: true });
            await writeFile(validationPath(request), JSON.stringify({
              strategies: [
                { id: "iteration-block", bottleneck: "memory", technique: "tile", rationale: "iteration", predicted_speedup: 1.1, risk_level: "low" },
                { id: "global-block", bottleneck: "compute", technique: "warp", rationale: "global", predicted_speedup: 1.2, risk_level: "low" },
              ],
            }));
          } else if (stage.endsWith(".verify")) {
            await mkdir(dirname(validationPath(request)), { recursive: true });
            await writeFile(validationPath(request), JSON.stringify({
              status: "blocked",
              block_scope: await strategySlot(request) === 0 ? "iteration" : "global",
            }));
          } else if (stage === "summary") {
            // `basic` carries the proposal contract in this fixture, so the
            // terminal summary must publish a valid (unused) result too.
            await mkdir(dirname(validationPath(request)), { recursive: true });
            await writeFile(validationPath(request), JSON.stringify({
              strategies: [
                { id: "summary", bottleneck: "memory", technique: "tile", rationale: "done", predicted_speedup: 1, risk_level: "low" },
              ],
            }));
          } else if (stage !== "summary") {
            throw new Error(`unexpected stage: ${stage}`);
          }
          const id = `${stage}-${invocationId(request).replaceAll("/", "-")}`;
          return { sessionId: id, transcriptPath: `/tmp/${id}.jsonl`, text: id, continuation: continuation(id) };
          }),
        })),
      ));

      expect(calls.filter((call) => stageId(call).endsWith(".verify"))).toHaveLength(2);
      expect(calls.filter((call) => stageId(call) === "summary")).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs a tuning loop for the exact DSL iteration count across large metric increases and drops", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-cuda-tune-loop-run-"));
    try {
      await writeFile(join(root, "tune-loop.yml"), CUDA_TUNE_LOOP_WORKFLOW);
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
        current_best: { path: "state/current-best.py", metric_tflops: 1, metric: { name: "tflops", best: 1, direction: "higher" } },
        history: [],
      }));
      await writeFile(join(root, "state", "current-best.py"), "seed\n");
      await writeFile(join(root, "kernel.py"), "candidate\n");
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      // Metric schedule: a big jump, a huge drop, another jump, then a final
      // huge drop. Tuning is non-monotonic; the loop must still run all 6
      // iterations and never abort on a regression (drop).
      const bests = [1.0, 10.0, 0.5, 20.0, 25.0, 0.1];
      await runWorkflow(session, loadAndExecuteWorkflow({
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        root,
        workflowPath: join(root, "tune-loop.yml"),
        runDir: session.runDir,
        runId: "cuda-tune-loop",
        cwd: root,
        prompt: "tune the cuda case",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          if (stage === "setup") {
            await writeFile(path, JSON.stringify({
              status: "ready",
              target: { operator: "gemm", shape: "512x512x512", dtype: "f32" },
              device: { name: "mock", architecture: "mock" },
              toolchain: { compiler: "nvcc", runtime: "mock", profiler: "mock" },
              baseline: { custom_kernel: { path: "state/current-best.py" }, reference_metric: 1, custom_metric: 1 },
              current_best: { path: "state/current-best.py" },
              state_path: "state/tuning-state.json",
            }));
          } else if (stage === "tune.profile") {
            await writeFile(path, JSON.stringify({
              status: "timing-only",
              target_operator: "matmul",
              device: { name: "mock", architecture: "mock" },
              metrics: { compute_utilization: 0.5, memory_bandwidth_utilization: 0.5 },
              bottlenecks: [{ type: "memory", description: "mock", evidence: "mock" }],
              analysis: "mock profile",
            }));
          } else if (stage === "tune.measure") {
            // iteration is not authoritatively known to the worker; the mock uses
            // the call index for this stage to pick the per-iteration metric.
            const nthMeasure = calls.filter((call) => stageId(call) === "tune.measure").length - 1;
            const best = bests[nthMeasure] ?? 0;
            const previousBest = bests[nthMeasure - 1] ?? 1;
            const improves = best > previousBest;
            await writeFile(path, JSON.stringify({
              iteration: nthMeasure,
              decision: improves ? "KEEP" : "DISCARD",
              candidate: { path: "kernel.py" },
              current_best: { path: "state/current-best.py" },
              verification: { compile_passed: true, verify_passed: true },
              benchmark: { metric: "tflops", direction: "higher", samples: [best], best, median: best, runs: 1, warmup: 0 },
              promotion: {
                promoted: improves,
                resulting_best: { path: improves ? "kernel.py" : "state/current-best.py" },
                reason: improves ? "improved" : "did not improve",
              },
              records: { round_path: `rounds/iter-${String(nthMeasure).padStart(3, "0")}.json`, state_path: "state/tuning-state.json" },
            }));
          } else if (stage === "summary") {
            await writeFile(path, JSON.stringify({
              run_id: "cuda-tune-loop",
              summary: "tuned over 6 rounds",
              outcome: "improved",
              // ISSUE-012: improved/neutral summaries must prove the
              // progress-record write-back, so the mock carries it.
              progress_record: {
                file_path: "test/mock_progress.cc",
                current_status: "stable",
                entry: "R1: mock loop improved | evidence: cuda-tune-loop | next: none",
              },
            }));
          } else {
            throw new Error(`unexpected stage: ${stage}`);
          }
          return {
            sessionId: `${stage}-session-${calls.filter((call) => stageId(call) === stage).length}`,
            transcriptPath: `/tmp/${stage}.jsonl`,
            text: stage,
            continuation: continuation(`${stage}-session`),
          };
        }),
      }));
      // The measure stage must have run exactly `iterations` (6) times — the loop
      // runs to the DSL-specified count regardless of regression drops.
      const measureCalls = calls.filter((call) => stageId(call) === "tune.measure");
      expect(measureCalls).toHaveLength(6);
      const measureIterations = measureCalls.map((call) => iterationOf(call));
      expect(new Set(measureIterations)).toEqual(new Set([0, 1, 2, 3, 4, 5]));
      // The final durable best is 25.0 (the iter-4 peak), not the last-round
      // 0.1 drop — a drop must not corrupt current-best.
      const state = JSON.parse(await readFile(join(root, "state", "tuning-state.json"), "utf8")) as {
        current_best: { metric_tflops?: number; iteration?: number };
        history: Array<{ decision?: string; metric?: { value?: number } }>;
      };
      expect(state.current_best.metric_tflops).toBe(25);
      expect(state.current_best.iteration).toBe(4);
      // Every iteration produced a round record, including the two huge drops.
      expect(state.history.map((entry) => entry.decision)).toEqual([
        "DISCARD", "KEEP", "DISCARD", "KEEP", "KEEP", "DISCARD",
      ]);
      const rounds = await Promise.all([0, 1, 2, 3, 4, 5].map((index) =>
        readFile(join(root, "rounds", `iter-${String(index).padStart(3, "0")}.json`), "utf8")));
      expect(rounds).toHaveLength(6);
      expect(rounds.every((round) => round.includes('"decision"'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("executes dependencies and injects deterministic automatic inputs instead of prompt-concatenating outputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-dag-run-"));
    try {
      await writeFile(join(root, "two.yml"), TWO_STAGE_WORKFLOW);
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const events: AgentEvent[] = [];
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "two.yml"),
        runDir: session.runDir,
        runId: "two-stage",
        cwd: root,
        prompt: "solve the task",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          request.onEvent?.({ type: "usage", usage: { totalTokens: 7 } });
          return {
            sessionId: `session-${stage}`,
            transcriptPath: `/tmp/${stage}.jsonl`,
            text: `${stage} output`,
            continuation: continuation(`session-${stage}`),
          };
        }),
        onEvent: (event) => events.push(event),
      }));
      expect(result.stages.map((stage) => stage.id)).toEqual(["first@root", "second@root"]);
      expect(result.text).toBe("second output");
      expect(calls).toHaveLength(2);
      expect(calls[1]?.prompt).not.toContain("first output");
      expect(calls[0]?.systemPromptPath).toBeUndefined();
      expect(calls[1]?.systemPromptPath).toContain("recipes/smoke-test-agent/system-prompt.md");
      const inputsPath = calls[1]?.contextFilePaths?.find((path) => path.endsWith("/inputs.json"));
      expect(inputsPath).toBeDefined();
      // The standard, orchestrator-owned location: no workflow-chosen name.
      expect(inputsPath).toMatch(/\/context\/inv-\d+\/inputs\.json$/);
      // A stage with no upstream inputs gets no input file at all.
      expect(calls[0]?.contextFilePaths?.some((path) => path.endsWith("/inputs.json"))).toBe(false);
      const inputs = JSON.parse(await readFile(inputsPath!, "utf8")) as { inputs: Array<{ id: string; stage: string; text: string }> };
      expect(inputs.inputs).toMatchObject([{ stage: "first", text: "first output" }]);
      expect(inputs.inputs[0]?.id).toBe("first@root");
      // The scheduling log names the automatic input file only for stages with inputs.
      const dispatchLog = await readFile(join(session.runDir, "system-log", "log.jsonl"), "utf8");
      const secondScheduled = dispatchLog.split("\n").find((line) =>
        line.includes('"event":"workflow.scheduled"') && line.includes('"stage":"second"'));
      const firstScheduled = dispatchLog.split("\n").find((line) =>
        line.includes('"event":"workflow.scheduled"') && line.includes('"stage":"first"'));
      expect(secondScheduled).toContain('"inputsPath":');
      expect(firstScheduled).not.toContain('"inputsPath":');
      expect(events.map((event) => event.workflow)).toEqual([
        {
          stageId: "first",
          invocationId: "first@root",
          worker: "basic",
          attempt: 1,
          workspaceKey: "shared-root",
          workspaceCwd: root,
        },
        {
          stageId: "second",
          invocationId: "second@root",
          worker: "smoke-test-agent",
          attempt: 1,
          workspaceKey: "shared-root",
          workspaceCwd: root,
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("shares one conversation when two stages use the same worker plugin", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-same-worker-run-"));
    try {
      await writeFile(join(root, "same-worker.yml"), SAME_WORKER_WORKFLOW);
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "same-worker.yml"),
        runDir: session.runDir,
        runId: "same-worker",
        cwd: root,
        prompt: "continue the task",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          return {
            sessionId: `session-${stage}`,
            transcriptPath: `/tmp/${stage}.jsonl`,
            text: `${stage} output`,
            continuation: continuation(`session-${stage}`),
          };
        }),
      }));
      expect(result.stages.map((stage) => stage.id)).toEqual(["first@root", "second@root"]);
      expect(calls).toHaveLength(2);
      // One worker, one conversation: the second stage continues the first
      // stage's chat instead of starting a fresh one.
      expect(calls[0]?.continuation).toBeUndefined();
      expect(calls[1]?.continuation?.sessionId).toBe("session-first");
      expect(calls[1]?.contextFilePaths?.some((p) => p.endsWith("agents.pi.md"))).toBe(true);
      expect(calls[1]?.contextFilePaths?.some((p) => p.endsWith("/inputs.json"))).toBe(true);
      expect(new Set(calls.map((call) => call.sessionDir))).toHaveLength(1);
      expect(calls[0]?.sessionDir).toContain("sessions/trajectory-pi-basic-root");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("serializes ready stages that share the root workspace, then joins ordered inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-fan-out-run-"));
    try {
      await writeFile(join(root, "fan-out.yml"), FAN_OUT_WORKFLOW);
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      let active = 0;
      let maxActive = 0;
      const execution = runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "fan-out.yml"), runDir: session.runDir, runId: "fan-out", cwd: root, prompt: "fan out",
        agentRunner: (request) => Effect.promise(async () => {
          const stage = stageId(request);
          calls.push(request);
          active += 1;
          maxActive = Math.max(maxActive, active);
          try {
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
            return {
              sessionId: `session-${stage}`,
              transcriptPath: `/tmp/${stage}.jsonl`,
              text: `${stage} output`,
              continuation: continuation(`session-${stage}`),
            };
          } finally {
            active -= 1;
          }
        }),
      }));
      const result = await execution;
      expect(maxActive).toBe(1);
      expect(calls.map(stageId)).toEqual(["left", "right", "joined"]);
      expect(result.stages.map((stage) => stage.id)).toEqual(["left@root", "right@root", "joined@root"]);
      const joinCall = calls.find((call) => stageId(call) === "joined");
      // All three stages share the `basic` worker, so the join continues the
      // last accepted turn — right's.
      expect(joinCall?.continuation?.sessionId).toBe("session-right");
      const inputsPath = joinCall?.contextFilePaths?.find((path) => path.endsWith("/inputs.json"));
      const inputs = JSON.parse(await readFile(inputsPath!, "utf8")) as { inputs: Array<{ stage: string; text: string }> };
      expect(inputs.inputs).toMatchObject([
        { stage: "left", text: "left output" },
        { stage: "right", text: "right output" },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resumes the same logical loop actor across iterations while keeping its invocation evidence separate", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-loop-run-"));
    try {
      await writeFile(join(root, "loop.yml"), LOOP_WORKFLOW);
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "loop.yml"), recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT, runDir: session.runDir, runId: "loop", cwd: root, prompt: "iterate",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          const invocation = invocationId(request);
          if (stage === "seed" || stage === "tune.propose") {
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({ text: invocation }));
          }
          return {
            sessionId: `${stage}-${calls.filter((call) => stageId(call) === stage).length}`,
            transcriptPath: `/tmp/${invocation.replaceAll("/", "-")}.jsonl`,
            text: `${invocation} output`,
            continuation: continuation(`${stage}-${calls.filter((call) => stageId(call) === stage).length}`),
          };
        }),
      }));
      const proposes = calls.filter((call) => stageId(call) === "tune.propose");
      expect(proposes).toHaveLength(3);
      // The seed stage shares the `test-text` worker, so the loop entry continues
      // the seed's conversation; each iteration then continues the last one.
      expect(proposes.map((call) => call.continuation?.sessionId)).toEqual(["seed-1", "tune.propose-1", "tune.propose-2"]);
      expect(new Set(proposes.map((call) => call.sessionDir))).toHaveLength(1);
      expect(proposes[0]?.sessionDir).toContain("sessions/trajectory-pi-test-text-root");
      expect(new Set(proposes.map(validationPath)).size).toBe(3);
      // Every iteration's acceptance landed as its own stream row, under its
      // own runtime instance, matching the stages the run produced.
      const proposalRows = (await acceptedRows(session.runDir)).filter((row) => row.stageId === "tune.propose");
      expect(proposalRows.map((row) => row.instanceId).sort()).toEqual(["tune/iter-0", "tune/iter-1", "tune/iter-2"]);
      expect(result.stages.filter((stage) => stage.stageId === "tune.propose").map((stage) => stage.id).sort()).toEqual([
        "tune.propose@tune/iter-0",
        "tune.propose@tune/iter-1",
        "tune.propose@tune/iter-2",
      ]);
      const inputsPaths = proposes.map((call) => call.contextFilePaths?.find((path) => path.endsWith("/inputs.json")));
      expect(new Set(inputsPaths).size).toBe(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("starts each memory-disabled loop turn fresh while preserving automatic inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-loop-no-memory-run-"));
    try {
      await writeFile(join(root, "loop.yml"), LOOP_WORKFLOW.replace(
        "              name: propose\n              worker: test-text\n",
        "              name: propose\n              worker: test-text\n              memory: false\n",
      ));
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "loop.yml"), recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT, runDir: session.runDir, runId: "loop-no-memory", cwd: root, prompt: "iterate",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          const invocation = invocationId(request);
          if (stage === "seed" || stage === "tune.propose") {
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({ text: invocation }));
          }
          const turn = calls.filter((call) => stageId(call) === stage).length;
          return {
            sessionId: `${stage}-${turn}`,
            transcriptPath: `/tmp/${invocation.replaceAll("/", "-")}.jsonl`,
            text: `${invocation} output`,
            continuation: continuation(`${stage}-${turn}`),
          };
        }),
      }));
      const proposes = calls.filter((call) => stageId(call) === "tune.propose");
      expect(proposes).toHaveLength(3);
      expect(proposes.map((call) => call.continuation)).toEqual([undefined, undefined, undefined]);
      const inputsPaths = proposes.map((call) => call.contextFilePaths?.find((path) => path.endsWith("/inputs.json")));
      expect(inputsPaths.every((path) => path !== undefined)).toBe(true);
      expect(new Set(inputsPaths).size).toBe(3);
      expect(result.stages.filter((stage) => stage.stageId === "tune.propose")).toHaveLength(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("feeds an accepted prior-iteration child result back to the loop entry, sharing one worker conversation", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-loop-feedback-run-"));
    try {
      await writeFile(join(root, "loop-feedback.yml"), LOOP_FEEDBACK_WORKFLOW);
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const turns = new Map<string, number>();
      await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "loop-feedback.yml"),
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        runDir: session.runDir,
        runId: "loop-feedback",
        cwd: root,
        prompt: "iterate with feedback",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          const invocation = invocationId(request);
          if (calls.length === 1) {
            const running = JSON.parse(await readFile(join(session.runDir, "status.json"), "utf8")) as {
              status: string;
              plannedStages: number;
              completedStages: number;
              current?: { status?: string; stageId?: string; attempt?: number };
            };
            expect(running).toMatchObject({
              status: "running",
              plannedStages: 7,
              completedStages: 0,
              current: { status: "running", stageId: "seed", attempt: 1 },
            });
          }
          if (stage === "seed" || stage === "tune.profile" || stage === "tune.measure") {
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({ text: invocation }));
          }
          const turn = (turns.get(stage) ?? 0) + 1;
          turns.set(stage, turn);
          const sessionId = `${stage}-session-${turn}`;
          return {
            sessionId,
            transcriptPath: `/tmp/${invocation.replaceAll("/", "-")}.jsonl`,
            text: invocation,
            continuation: continuation(sessionId),
          };
        }),
      }));

      const profiles = calls.filter((call) => stageId(call) === "tune.profile");
      const measures = calls.filter((call) => stageId(call) === "tune.measure");
      expect(profiles).toHaveLength(3);
      expect(measures).toHaveLength(3);
      // seed, profile, and measure all use `test-text`, so one conversation
      // runs through the whole loop: each turn continues whatever was accepted
      // last in the root lane. The feedback inputs below are unaffected.
      expect(profiles.map((call) => call.continuation?.sessionId)).toEqual([
        "seed-session-1",
        "tune.measure-session-1",
        "tune.measure-session-2",
      ]);
      expect(measures.map((call) => call.continuation?.sessionId)).toEqual([
        "tune.profile-session-1",
        "tune.profile-session-2",
        "tune.profile-session-3",
      ]);

      const contexts = await Promise.all(profiles.map(async (call) => {
        const path = call.contextFilePaths?.find((candidate) => candidate.endsWith("/inputs.json"));
        expect(path).toBeDefined();
        return JSON.parse(await readFile(path!, "utf8")) as {
          inputs: Array<{ id: string; stageId: string; resultPayload?: { text: string } }>;
        };
      }));
      expect(contexts.map((context) => context.inputs.map((input) => input.stageId))).toEqual([
        ["seed"],
        ["seed", "tune.measure"],
        ["seed", "tune.measure"],
      ]);
      expect(contexts[1]?.inputs[1]).toMatchObject({
        id: "tune.measure@tune/iter-0",
        resultPayload: { text: "tune.measure@tune/iter-0" },
      });
      expect(contexts[2]?.inputs[1]).toMatchObject({
        id: "tune.measure@tune/iter-1",
        resultPayload: { text: "tune.measure@tune/iter-1" },
      });
      // The accepted invocations, in acceptance order, are the state
      // document's job cursor; the payloads themselves are asserted in memory
      // and in the acceptance records above.
      const status = await readRunStatusFile(session.runDir);
      const acceptedIds = (status.jobs.at(-1)?.accepted ?? []).map((entry) => entry.invocationId);
      expect(acceptedIds).toHaveLength(7);
      expect(acceptedIds.filter((id) => id.startsWith("tune.profile@"))).toEqual([
        "tune.profile@tune/iter-0",
        "tune.profile@tune/iter-1",
        "tune.profile@tune/iter-2",
      ]);
      expect(acceptedIds.filter((id) => id.startsWith("tune.measure@"))).toEqual([
        "tune.measure@tune/iter-0",
        "tune.measure@tune/iter-1",
        "tune.measure@tune/iter-2",
      ]);
      const snapshot = JSON.parse(await readFile(join(session.runDir, "status.json"), "utf8")) as {
        status: string;
        plannedStages: number;
        completedStages: number;
        current?: { status?: string; stageId?: string; instanceId?: string };
        stageCounts: Record<string, { planned: number; completed: number }>;
        invocationTime?: Record<string, { stageId?: string; instanceId?: string; completedMs?: number }>;
      };
      expect(snapshot).toMatchObject({
        status: "completed",
        plannedStages: 7,
        completedStages: 7,
        stageCounts: {
          seed: { planned: 1, completed: 1 },
          "tune.profile": { planned: 3, completed: 3 },
          "tune.measure": { planned: 3, completed: 3 },
        },
        current: {
          status: "accepted",
          stageId: "tune.measure",
          instanceId: "tune/iter-2",
        },
      });
      // Each loop iteration is timed as its own invocation, so a reader (the
      // footer) can add them into the stage's cumulative working time.
      expect(Object.values(snapshot.invocationTime ?? {})
        .filter((time) => time.stageId === "tune.measure")
        .map((time) => time.instanceId)).toEqual(["tune/iter-0", "tune/iter-1", "tune/iter-2"]);
      // An accepted invocation closes its span; a live one stays open instead.
      expect(Object.values(snapshot.invocationTime ?? {})
        .every((time) => time.completedMs === undefined || Number.isSafeInteger(time.completedMs))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("hands each tournament lane its own model from a per-lane list", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-map-lane-models-"));
    try {
      await writeFile(join(root, "map.yml"), PER_LANE_MODEL_MAP_WORKFLOW);
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      await runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "map.yml"), runDir: session.runDir, runId: "map-lane-models", cwd: root, prompt: "map candidates",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          if (stage === "propose") {
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              strategies: [
                { id: "slot-a", bottleneck: "memory", technique: "tile", rationale: "test", predicted_speedup: 1.1, risk_level: "low" },
                { id: "slot-b", bottleneck: "compute", technique: "warp", rationale: "test", predicted_speedup: 1.2, risk_level: "medium" },
              ],
            }));
          }
          const invocation = invocationId(request);
          const sessionId = `${stage}-${invocation.replaceAll("/", "-").replaceAll("@", "-")}`;
          return {
            sessionId,
            transcriptPath: `/tmp/${sessionId}.jsonl`,
            text: `${stage}:${invocation}`,
            continuation: continuation(sessionId),
          };
        }),
      }));

      // The lane index is the slot in the session/cwd path, so these two calls
      // are lane 0 and lane 1 of the same stage.
      const implementLanes = await Promise.all(calls
        .filter((call) => stageId(call) === "tournament.implement")
        .map(async (call) => ({ slot: await strategySlot(call), model: call.model })));
      expect(implementLanes.sort((left, right) => left.slot - right.slot)).toEqual([
        { slot: 0, model: "m-one" },
        { slot: 1, model: "m-two" },
      ]);

      // Only the lanes take a per-lane model: the stages outside the tournament
      // keep the harness default, so the list cannot leak into the parent scope.
      const outside = calls.filter((call) => stageId(call) === "propose" || stageId(call) === "summary");
      expect(outside).toHaveLength(2);
      expect(outside.every((call) => call.model === undefined)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("expands map slots with isolated actor lanes, map-item context, and ordered fan-in", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-map-run-"));
    try {
      await writeFile(join(root, "map.yml"), MAP_WORKFLOW);
      await writeFile(join(root, "kernel.py"), "baseline\n");
      await writeFile(join(root, ".piano-run.lock"), "stale lock\n");
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const verifiedContents = new Map<string, string>();
      let activeImplementations = 0;
      let maxActiveImplementations = 0;
      let signalBothImplementations!: () => void;
      const bothImplementationsStarted = new Promise<void>((resolve) => { signalBothImplementations = resolve; });
      let releaseImplementations!: () => void;
      const implementationGate = new Promise<void>((resolve) => { releaseImplementations = resolve; });
      const execution = runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "map.yml"), runDir: session.runDir, runId: "map", cwd: root, prompt: "map candidates",
        workspace: { preserve: true },
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          if (stage === "propose") {
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              strategies: [
                { id: "slot-a", bottleneck: "memory", technique: "tile", rationale: "test", predicted_speedup: 1.1, risk_level: "low" },
                { id: "slot-b", bottleneck: "compute", technique: "warp", rationale: "test", predicted_speedup: 1.2, risk_level: "medium" },
              ],
            }));
          }
          const invocation = invocationId(request);
          if (stage === "tournament.implement") {
            activeImplementations += 1;
            maxActiveImplementations = Math.max(maxActiveImplementations, activeImplementations);
            try {
              await writeFile(join(request.cwd, "kernel.py"), `candidate:${invocation}\n`);
              if (activeImplementations === 2) signalBothImplementations();
              await implementationGate;
            } finally {
              activeImplementations -= 1;
            }
          }
          if (stage === "tournament.verify") {
            verifiedContents.set(request.cwd, await readFile(join(request.cwd, "kernel.py"), "utf8"));
          }
          return {
            sessionId: `${stage}-${invocation.replaceAll("/", "-").replaceAll("@", "-")}`,
            transcriptPath: `/tmp/${stage}-${invocation.replaceAll("/", "-").replaceAll("@", "-")}.jsonl`,
            text: `${stage}:${invocation}`,
            continuation: continuation(`${stage}-${invocation.replaceAll("/", "-").replaceAll("@", "-")}`),
          };
        }),
      }));
      await bothImplementationsStarted;
      expect(maxActiveImplementations).toBe(2);
      releaseImplementations();
      const result = await execution;
      const implementCalls = calls.filter((call) => stageId(call) === "tournament.implement");
      expect(implementCalls).toHaveLength(2);
      expect(implementCalls.map((call) => call.continuation)).toEqual([undefined, undefined]);
      expect(new Set(implementCalls.map((call) => call.cwd)).size).toBe(2);
      expect(implementCalls.every((call) => call.cwd !== root)).toBe(true);
      await expect(readFile(join(root, "kernel.py"), "utf8")).resolves.toBe("baseline\n");
      for (const call of implementCalls) {
        await expect(readFile(join(call.cwd, "kernel.py"), "utf8")).resolves.toBe(`candidate:${invocationId(call)}\n`);
        await expect(stat(join(call.cwd, ".piano-run.lock"))).rejects.toMatchObject({ code: "ENOENT" });
      }
      expect(implementCalls.map((call) => call.sessionDir)).toEqual(expect.arrayContaining([
        expect.stringContaining("sessions/trajectory-pi-basic-tournament-slot-0"),
        expect.stringContaining("sessions/trajectory-pi-basic-tournament-slot-1"),
      ]));
      const verifyCalls = calls.filter((call) => stageId(call) === "tournament.verify");
      expect(verifyCalls).toHaveLength(2);
      // Within a lane one worker (and so one actor) runs verify, which
      // continues the implement turn that produced its candidate.
      expect(verifyCalls.map((call) => call.continuation?.sessionId).sort()).toEqual([
        "tournament.implement-tournament.implement-tournament-slot-0",
        "tournament.implement-tournament.implement-tournament-slot-1",
      ]);
      for (const call of verifyCalls) {
        expect(verifiedContents.get(call.cwd)).toBe(`candidate:${invocationId(implementCalls.find((implement) => implement.cwd === call.cwd)!)}\n`);
      }
      const mapItems = await Promise.all(implementCalls.map(async (call) => {
        const path = call.contextFilePaths?.find((candidate) => candidate.includes("/map-item.json"));
        return JSON.parse(await readFile(path!, "utf8")) as { item: { index: number; value: { id: string } } };
      }));
      expect(mapItems.map((item) => item.item).sort((left, right) => left.index - right.index)).toMatchObject([
        { index: 0, value: { id: "slot-a", bottleneck: "memory", technique: "tile", rationale: "test", predicted_speedup: 1.1, risk_level: "low" } },
        { index: 1, value: { id: "slot-b", bottleneck: "compute", technique: "warp", rationale: "test", predicted_speedup: 1.2, risk_level: "medium" } },
      ]);
      const summary = calls.find((call) => stageId(call) === "summary");
      // summary shares `basic` with the root-lane propose, so it continues it.
      expect(summary?.continuation?.sessionId).toBe("propose-propose-root");
      const summaryPath = summary?.contextFilePaths?.find((path) => path.endsWith("/inputs.json"));
      const summaryInputs = JSON.parse(await readFile(summaryPath!, "utf8")) as {
        inputs: Array<{ instanceId: string; stageId: string; workspace: { key: string; cwd: string; kind: string; recordPath: string } }>;
      };
      expect(summaryInputs.inputs).toMatchObject([
        { instanceId: "tournament/slot-0", stageId: "tournament.verify", workspace: { key: "job-1/tournament/slot-0", kind: "map-slot" } },
        { instanceId: "tournament/slot-1", stageId: "tournament.verify", workspace: { key: "job-1/tournament/slot-1", kind: "map-slot" } },
      ]);
      expect(result.stages.map((stage) => stage.id)).toEqual([
        "propose@root",
        "tournament.implement@tournament/slot-0",
        "tournament.verify@tournament/slot-0",
        "tournament.implement@tournament/slot-1",
        "tournament.verify@tournament/slot-1",
        "summary@root",
      ]);
      const mapStages = result.stages.filter((stage) => stage.workspace.kind === "map-slot");
      expect(mapStages).toHaveLength(4);
      for (const stage of mapStages) {
        await expect(readFile(stage.workspace.recordPath!, "utf8")).resolves.toContain(`"cwd": "${stage.workspace.cwd}"`);
      }
      const log = await readFile(join(session.runDir, "system-log", "log.jsonl"), "utf8");
      expect(log.match(/"event":"workspace.prepared"/g)).toHaveLength(3);
      // Tournament baselines are git commits in the run's own store — no
      // frozen directory copies.
      await expect(readdir(session.runDir)).resolves.not.toContain("prompts");
      await expect(readdir(session.runDir)).resolves.not.toContain("workspace-snapshots");
      const refs = await runFile("git", ["--git-dir", join(session.runDir, "git", "workspaces.git"), "for-each-ref", "--format=%(refname)", "refs/piano"]);
      const refNames = refs.stdout.split("\n").filter((line) => line !== "");
      expect(refNames.filter((ref) => ref.includes("/baselines/"))).toHaveLength(1);
      // Lanes are real branches of the run's store for a non-Git source.
      const branches = await runFile("git", ["--git-dir", join(session.runDir, "git", "workspaces.git"), "for-each-ref", "--format=%(refname:short)", "refs/heads/tuna/"]);
      expect(branches.stdout.split("\n").filter((line) => line !== "").sort()).toEqual([
        "tuna/map-map/lane-0",
        "tuna/map-map/lane-1",
      ]);
      const snapshot = JSON.parse(await readFile(join(session.runDir, "status.json"), "utf8")) as {
        status: string;
        plannedStages: number;
        completedStages: number;
        stageCounts: Record<string, { planned: number; completed: number }>;
        invocationTime?: Record<string, { stageId?: string; instanceId?: string }>;
      };
      expect(snapshot).toMatchObject({
        status: "completed",
        plannedStages: 6,
        completedStages: 6,
        stageCounts: {
          propose: { planned: 1, completed: 1 },
          "tournament.implement": { planned: 2, completed: 2 },
          "tournament.verify": { planned: 2, completed: 2 },
          summary: { planned: 1, completed: 1 },
        },
      });
      // Concurrent map lanes stay distinguishable, which is what lets a reader
      // give every fan-out slot its own counter instead of one map total.
      expect(Object.values(snapshot.invocationTime ?? {})
        .filter((time) => time.stageId === "tournament.implement")
        .map((time) => time.instanceId).sort()).toEqual(["tournament/slot-0", "tournament/slot-1"]);
      const status = await readRunStatusFile(session.runDir);
      expect(status.completedStages).toBe(6);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses workflow.map-items as the authoritative map source even when the payload path is a decoy", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-projected-map-run-"));
    try {
      await writeFile(join(root, "map.yml"), PROJECTED_MAP_WORKFLOW);
      await mkdir(join(root, "recipes", "contracts"), { recursive: true });
      await mkdir(join(root, "recipes", "basic"), { recursive: true });
      await writeFile(
        join(root, "recipes", "contracts", "projected-map-source.json"),
        JSON.stringify(projectedMapContract(true)),
      );
      const session = await testSession(root);
      const mappedIds: string[] = [];
      const result = await runWorkflow(session, loadWorkflow(join(root, "map.yml"), root, root).pipe(
        Effect.flatMap((loaded) => executeWorkflow(loaded, {
          runDir: session.runDir,
          runId: "projected-map",
          cwd: root,
          prompt: "map the contract-declared candidates",
          agentRunner: (request) => Effect.promise(async () => {
            const stage = stageId(request);
            if (stage === "propose") {
              await mkdir(dirname(validationPath(request)), { recursive: true });
              await writeFile(validationPath(request), JSON.stringify({
                strategies: [{ id: "legacy-decoy-a" }, { id: "legacy-decoy-b" }],
                authoritative: [{ id: "projected-a" }, { id: "projected-b" }],
              }));
            } else {
              const mapItemPath = request.contextFilePaths?.find((path) => path.endsWith("/map-item.json"));
              const context = JSON.parse(await readFile(mapItemPath!, "utf8")) as { item: { value: { id: string } } };
              mappedIds.push(context.item.value.id);
            }
            const id = `${stage}-${invocationId(request).replaceAll("/", "-")}`;
            return { sessionId: id, transcriptPath: `/tmp/${id}.jsonl`, text: id };
          }),
        })),
      ));

      expect(mappedIds.sort()).toEqual(["projected-a", "projected-b"]);
      expect(result.stages.find((stage) => stage.stageId === "propose")?.projections).toContainEqual(
        expect.objectContaining({ id: "workflow.map-items", pointer: "/authoritative" }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a worker contract that omits workflow.map-items", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-legacy-map-adapter-"));
    try {
      await writeFile(join(root, "map.yml"), PROJECTED_MAP_WORKFLOW);
      await mkdir(join(root, "recipes", "contracts"), { recursive: true });
      await mkdir(join(root, "recipes", "basic"), { recursive: true });
      await writeFile(
        join(root, "recipes", "contracts", "projected-map-source.json"),
        JSON.stringify(projectedMapContract(false)),
      );
      const session = await testSession(root);
      const mappedIds: string[] = [];
      await expect(runWorkflow(session, loadWorkflow(join(root, "map.yml"), root, root).pipe(
        Effect.flatMap((loaded) => executeWorkflow(loaded, {
          runDir: session.runDir,
          runId: "legacy-map-adapter",
          cwd: root,
          prompt: "map a contract written before semantic projections",
          agentRunner: (request) => Effect.promise(async () => {
            const stage = stageId(request);
            if (stage === "propose") {
              await mkdir(dirname(validationPath(request)), { recursive: true });
              await writeFile(validationPath(request), JSON.stringify({
                strategies: [{ id: "legacy-a" }, { id: "legacy-b" }],
                authoritative: [{ id: "unused-a" }, { id: "unused-b" }],
              }));
            } else {
              const mapItemPath = request.contextFilePaths?.find((path) => path.endsWith("/map-item.json"));
              const context = JSON.parse(await readFile(mapItemPath!, "utf8")) as { item: { value: { id: string } } };
              mappedIds.push(context.item.value.id);
            }
            const id = `${stage}-${invocationId(request).replaceAll("/", "-")}`;
            return { sessionId: id, transcriptPath: `/tmp/${id}.jsonl`, text: id };
          }),
        })),
      ))).rejects.toThrow(/must declare projection "workflow\.map-items"/);

      expect(mappedIds).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("names an upstream stage's validation warning when its map source has no projection", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-warned-map-source-"));
    try {
      await writeFile(join(root, "map.yml"), PROJECTED_MAP_WORKFLOW);
      await mkdir(join(root, "recipes", "contracts"), { recursive: true });
      await mkdir(join(root, "recipes", "basic"), { recursive: true });
      // The declaration exists; the result is what failed validation.
      await writeFile(
        join(root, "recipes", "contracts", "projected-map-source.json"),
        JSON.stringify(projectedMapContract(true)),
      );
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const failure = await runWorkflow(session, loadWorkflow(join(root, "map.yml"), root, root).pipe(
        Effect.flatMap((loaded) => executeWorkflow(loaded, {
          runDir: session.runDir,
          runId: "warned-map-source",
          cwd: root,
          prompt: "map an invalid upstream result",
          agentRunner: (request) => Effect.promise(async () => {
            calls.push(request);
            const stage = stageId(request);
            if (stage === "propose") {
              await mkdir(dirname(validationPath(request)), { recursive: true });
              // Always invalid: after the one repair turn the stage is
              // accepted with a warning and carries no projections.
              await writeFile(validationPath(request), JSON.stringify({ wrong: true }));
            }
            const id = `${stage}-${calls.length}`;
            return { sessionId: id, transcriptPath: `/tmp/${id}.jsonl`, text: id, continuation: continuation(id) };
          }),
        })),
      )).then(() => undefined, (error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      const message = (failure as Error).message;
      expect(message).toContain('stage "propose"');
      expect(message).toContain('worker "projected-map-source"');
      expect(message).toContain("failed validation");
      expect(message).toContain('failed contract "projected-map-source"');
      expect(message).not.toContain('must declare projection "workflow.map-items"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retains already-started slot evidence when one map slot fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-map-failure-"));
    try {
      await writeFile(join(root, "map.yml"), MAP_WORKFLOW);
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const exit = await Effect.runPromiseExit(loadAndExecuteWorkflow({
        root, workflowPath: join(root, "map.yml"), runDir: session.runDir, runId: "map-fail", cwd: root, prompt: "map candidates",
        agentRunner: (request) => {
          calls.push(request);
          const stage = stageId(request);
          if (stage === "tournament.verify" && invocationId(request).includes("slot-0")) {
            // Fail one slot mid-map; the other already-started slot must be
            // allowed to complete and its evidence retained, not cancelled
            // and dropped together with the whole scope.
            return Effect.fail(new AgentError({ kind: "unknown", message: "slot-0 verify crashed" }));
          }
          return Effect.promise(async () => {
            if (stage === "propose") {
              const path = validationPath(request);
              await mkdir(dirname(path), { recursive: true });
              await writeFile(path, JSON.stringify({
                strategies: [
                  { id: "slot-a", bottleneck: "memory", technique: "tile", rationale: "test", predicted_speedup: 1.1, risk_level: "low" },
                  { id: "slot-b", bottleneck: "compute", technique: "warp", rationale: "test", predicted_speedup: 1.2, risk_level: "medium" },
                ],
              }));
            }
            const invocation = invocationId(request);
            return {
              sessionId: `${stage}-${invocation.replaceAll("/", "-").replaceAll("@", "-")}`,
              transcriptPath: `/tmp/${stage}-${invocation.replaceAll("/", "-").replaceAll("@", "-")}.jsonl`,
              text: `${stage}:${invocation}`,
              continuation: continuation(`${stage}-${invocation.replaceAll("/", "-").replaceAll("@", "-")}`),
            };
          });
        },
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      let message = "";
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) message = String(failure.value instanceof Error ? failure.value.message : failure.value);
      }
      // The map node fails, but the completed slot's evidence is surfaced in
      // the failure instead of silently discarded.
      expect(message).toMatch(/map "tournament" failed 1\/2 slot/);
      expect(message).toMatch(/retained 2 stage result\(s\) from 1 completed slot/);
      // Both slots started (the failing slot did not cancel the other), and
      // the surviving slot ran its full implement -> verify chain.
      const implementCalls = calls.filter((call) => stageId(call) === "tournament.implement");
      expect(implementCalls).toHaveLength(2);
      const verifyCalls = calls.filter((call) => stageId(call) === "tournament.verify");
      expect(verifyCalls).toHaveLength(2);
      expect(verifyCalls.some((call) => invocationId(call).includes("slot-1"))).toBe(true);
      // The failed map node never feeds its downstream summary.
      expect(calls.some((call) => stageId(call) === "summary")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("lets a plugin selector apply one map winner to the source workspace and cleans every slot", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-map-winner-run-"));
    try {
      await writeFile(join(root, "map.yml"), MAP_WORKFLOW);
      await writeFile(join(root, "kernel.py"), "baseline\n");
      const session = await testSession(root);
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "map.yml"),
        runDir: session.runDir,
        runId: "map-winner",
        cwd: root,
        prompt: "select a candidate",
        workspace: {
          winner: ({ candidates }) => candidates.find((candidate) => candidate.mapItem.value && typeof candidate.mapItem.value === "object" && (candidate.mapItem.value as { id?: unknown }).id === "slot-b")?.key,
        },
        agentRunner: (request) => Effect.promise(async () => {
          const stage = stageId(request);
          if (stage === "propose") {
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              strategies: [
                { id: "slot-a", bottleneck: "memory", technique: "tile", rationale: "test", predicted_speedup: 1.1, risk_level: "low" },
                { id: "slot-b", bottleneck: "compute", technique: "warp", rationale: "test", predicted_speedup: 1.2, risk_level: "medium" },
              ],
            }));
          }
          if (stage === "tournament.implement") {
            await writeFile(join(request.cwd, "kernel.py"), request.cwd.includes("slot-1") ? "winner\n" : `candidate:${invocationId(request)}\n`);
          }
          const invocation = invocationId(request);
          return {
            sessionId: invocation,
            transcriptPath: `/tmp/${invocation.replaceAll("/", "-").replaceAll("@", "-")}.jsonl`,
            text: invocation,
            continuation: continuation(invocation),
          };
        }),
      }));
      expect(result.stages.some((stage) => stage.workspace.kind === "map-slot")).toBe(true);
      await expect(readFile(join(root, "kernel.py"), "utf8")).resolves.toBe("winner\n");
      for (const stage of result.stages.filter((candidate) => candidate.workspace.kind === "map-slot")) {
        await expect(stat(stage.workspace.recordPath!)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(stat(stage.workspace.cwd)).rejects.toMatchObject({ code: "ENOENT" });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses an explicit selector that chooses a projection-blocked candidate", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-explicit-blocked-winner-"));
    try {
      await writeFile(join(root, "map.yml"), `version: 3
workflow:
  name: explicit-blocked-winner
  nodes:
    - stage:
        name: propose
        worker: basic
        from: []
    - tournament:
        name: tournament
        from: [propose]
        over: propose.strategies
        count: 2
        entry: implement
        exit: verify
        nodes:
          - stage:
              name: implement
              worker: basic
              from: []
          - stage:
              name: verify
              worker: blocked-race
              from: [implement]
    - stage:
        name: summary
        worker: basic
        from: [tournament]
`);
      const workerDir = join(root, "recipes", "blocked-race");
      await mkdir(workerDir, { recursive: true });
      await installTestProposalContract(root, "basic");
      await writeWorkerContract(workerDir, JSON.stringify({
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          required: ["status"],
          properties: {
            status: { enum: ["blocked", "ready"] },
            block_scope: { enum: ["global", "iteration"] },
          },
          additionalProperties: false,
        },
        example: { status: "blocked", block_scope: "global" },
        outputs: {
          metrics: [],
          projections: [
            { id: "workflow.status", pointer: "/status", format: "string", required: true },
            { id: "workflow.block-scope", pointer: "/block_scope", format: "string", required: false },
          ],
        },
      }));
      await writeFile(join(root, "kernel.py"), "baseline\n");
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const result = await runWorkflow(session, loadWorkflow(join(root, "map.yml"), root, root).pipe(
        Effect.flatMap((loaded) => executeWorkflow(loaded, {
          runDir: session.runDir,
          runId: "explicit-blocked-winner",
          cwd: root,
          prompt: "select a candidate but never carry a blocked result",
          workspace: { winner: "first" },
          agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          if (stage === "propose") {
            await mkdir(dirname(validationPath(request)), { recursive: true });
            await writeFile(validationPath(request), JSON.stringify({
              strategies: [
                { id: "blocked", bottleneck: "memory", technique: "tile", rationale: "blocked", predicted_speedup: 1.1, risk_level: "low" },
                { id: "ready", bottleneck: "compute", technique: "warp", rationale: "ready", predicted_speedup: 1.2, risk_level: "low" },
              ],
            }));
          } else if (stage === "tournament.implement") {
            await writeFile(join(request.cwd, "kernel.py"), `candidate-${await strategySlot(request)}\n`);
          } else if (stage === "tournament.verify") {
            await mkdir(dirname(validationPath(request)), { recursive: true });
            await writeFile(validationPath(request), JSON.stringify(
              await strategySlot(request) === 0
                ? { status: "blocked", block_scope: "global" }
                : { status: "ready" },
            ));
          }
          const id = `${stage}-${invocationId(request).replaceAll("/", "-")}`;
          return { sessionId: id, transcriptPath: `/tmp/${id}.jsonl`, text: id, continuation: continuation(id) };
          }),
        })),
      ));

      expect(calls.some((call) => stageId(call).startsWith("$consolidate/"))).toBe(false);
      expect(calls.some((call) => stageId(call) === "summary")).toBe(true);
      await expect(readFile(join(root, "kernel.py"), "utf8")).resolves.toBe("baseline\n");
      const selectionPath = join(session.runDir, "eval-metrics", "selection.jsonl");
      const records = (await readFile(selectionPath, "utf8")).trim().split("\n")
        .map((line) => JSON.parse(line) as { outcome: string; skipped?: string });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ outcome: "no-winner" });
      expect(records[0]?.skipped).toMatch(/terminal blocked result/);
      const blocked = result.stages.find((stage) => stage.stageId === "tournament.verify" && stage.workspace.key.endsWith("slot-0"));
      expect(blocked?.projections).toContainEqual(expect.objectContaining({ id: "workflow.status", value: "blocked" }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("snapshots the current parent slot for a nested map without nesting child workspaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-nested-map-run-"));
    try {
      await writeFile(join(root, "nested.yml"), NESTED_MAP_WORKFLOW);
      await writeFile(join(root, "kernel.py"), "baseline\n");
      const session = await testSession(root);
      const childParents = new Map<string, string>();
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "nested.yml"),
        runDir: session.runDir,
        runId: "nested",
        cwd: root,
        prompt: "nested map",
        agentRunner: (request) => Effect.promise(async () => {
          const stage = stageId(request);
          if (stage === "propose" || stage === "outer.seed") {
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              strategies: [
                { id: "one", bottleneck: "memory", technique: "tile", rationale: "test", predicted_speedup: 1.1, risk_level: "low" },
                { id: "two", bottleneck: "compute", technique: "warp", rationale: "test", predicted_speedup: 1.2, risk_level: "low" },
              ],
            }));
          }
          if (stage === "outer.seed") {
            await writeFile(join(request.cwd, "kernel.py"), "outer candidate\n");
          }
          if (stage === "outer.inner.implement") {
            childParents.set(request.cwd, await readFile(join(request.cwd, "kernel.py"), "utf8"));
            await writeFile(join(request.cwd, "kernel.py"), `inner:${invocationId(request)}\n`);
          }
          const invocation = invocationId(request);
          return {
            sessionId: invocation,
            transcriptPath: `/tmp/${invocation.replaceAll("/", "-").replaceAll("@", "-")}.jsonl`,
            text: invocation,
            continuation: continuation(invocation),
          };
        }),
      }));
      const outerSeed = result.stages.find((stage) => stage.stageId === "outer.seed");
      const innerStages = result.stages.filter((stage) => stage.stageId === "outer.inner.implement");
      expect(outerSeed).toBeDefined();
      expect(innerStages).toHaveLength(2);
      expect(new Set(innerStages.map((stage) => stage.workspace.cwd)).size).toBe(2);
      for (const stage of innerStages) {
        expect(stage.workspace.sourceCwd).toBe(outerSeed?.workspace.cwd);
        expect(childParents.get(stage.workspace.cwd)).toBe("outer candidate\n");
        expect(relative(outerSeed!.workspace.cwd, stage.workspace.cwd).startsWith("..")).toBe(true);
      }
      await expect(readFile(join(root, "kernel.py"), "utf8")).resolves.toBe("baseline\n");
      const snapshot = JSON.parse(await readFile(join(session.runDir, "status.json"), "utf8")) as {
        plannedStages: number;
        completedStages: number;
        stageCounts: Record<string, { planned: number; completed: number }>;
      };
      expect(snapshot).toMatchObject({
        plannedStages: 4,
        completedStages: 4,
        stageCounts: {
          propose: { planned: 1, completed: 1 },
          "outer.seed": { planned: 1, completed: 1 },
          "outer.inner.implement": { planned: 2, completed: 2 },
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a new task that reuses a run's lane namespace", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-mnemonic-conflict-"));
    try {
      await writeFile(join(root, "basic.yml"), BASIC_WORKFLOW);
      const session = await testSession(root);
      const agentRunner = () => Effect.promise(async () => ({
        sessionId: "respond",
        transcriptPath: "/tmp/respond.jsonl",
        text: "respond",
        continuation: continuation("respond"),
      }));
      const run = (prompt: string, mnemonic: string) => loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "basic.yml"),
        runDir: session.runDir,
        runId: "mnemonic-conflict",
        mnemonic,
        cwd: root,
        prompt,
        agentRunner,
      });
      await runWorkflow(session, run("first task", "alpha-mnemonic-conflict"));
      const conflict = await Effect.runPromiseExit(run("second task", "beta-mnemonic-conflict").pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      if (!Exit.isFailure(conflict)) throw new Error("expected the namespace conflict to fail the run");
      expect(Cause.pretty(conflict.cause)).toContain("already uses lane namespace");
      // The recorded namespace is still accepted.
      await runWorkflow(session, run("same task again", "alpha-mnemonic-conflict"));
      const status = JSON.parse(await readFile(join(session.runDir, "status.json"), "utf8")) as { mnemonic?: string };
      expect(status.mnemonic).toBe("alpha-mnemonic-conflict");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("dereferences a symlinked source workspace before allocating map slots", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-symlink-map-run-"));
    const linkedRoot = `${root}-link`;
    try {
      await symlink(root, linkedRoot, "dir");
      await writeFile(join(root, "map.yml"), MAP_WORKFLOW);
      const session = await testSession(root);
      const implementationCwds: string[] = [];
      await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "map.yml"),
        runDir: session.runDir,
        runId: "symlink-map",
        cwd: linkedRoot,
        prompt: "symlink map",
        workspace: { preserve: true },
        agentRunner: (request) => Effect.promise(async () => {
          const stage = stageId(request);
          if (stage === "propose") {
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              strategies: [
                { id: "one", bottleneck: "memory", technique: "tile", rationale: "test", predicted_speedup: 1.1, risk_level: "low" },
                { id: "two", bottleneck: "compute", technique: "warp", rationale: "test", predicted_speedup: 1.2, risk_level: "low" },
              ],
            }));
          }
          if (stage === "tournament.implement") implementationCwds.push(request.cwd);
          const invocation = invocationId(request);
          return {
            sessionId: invocation,
            transcriptPath: `/tmp/${invocation.replaceAll("/", "-").replaceAll("@", "-")}.jsonl`,
            text: invocation,
            continuation: continuation(invocation),
          };
        }),
      }));
      expect(implementationCwds).toHaveLength(2);
      const sourceRealPath = await realpath(root);
      for (const cwd of implementationCwds) {
        expect(await realpath(cwd)).not.toBe(sourceRealPath);
      }
    } finally {
      await rm(linkedRoot, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a map snapshot that would retain an external file symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-external-link-map-"));
    const external = await mkdtemp(join(tmpdir(), "piano-external-link-target-"));
    try {
      await writeFile(join(root, "map.yml"), MAP_WORKFLOW);
      const externalKernel = join(external, "kernel.py");
      await writeFile(externalKernel, "shared\n");
      await symlink(externalKernel, join(root, "kernel.py"));
      const session = await testSession(root);
      const calls: string[] = [];
      const exit = await Effect.runPromiseExit(loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "map.yml"),
        runDir: session.runDir,
        runId: "external-link",
        cwd: root,
        prompt: "external link",
        agentRunner: (request) => Effect.promise(async () => {
          const stage = stageId(request);
          calls.push(stage);
          if (stage === "propose") {
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              strategies: [
                { id: "one", bottleneck: "memory", technique: "tile", rationale: "test", predicted_speedup: 1.1, risk_level: "low" },
                { id: "two", bottleneck: "compute", technique: "warp", rationale: "test", predicted_speedup: 1.2, risk_level: "low" },
              ],
            }));
          }
          const invocation = invocationId(request);
          return {
            sessionId: invocation,
            transcriptPath: `/tmp/${invocation.replaceAll("/", "-").replaceAll("@", "-")}.jsonl`,
            text: invocation,
            continuation: continuation(invocation),
          };
        }),
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(calls).toEqual(["propose"]);
      if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain("symlink targets excluded or external content");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(external, { recursive: true, force: true });
    }
  });

  it("rejects file symlinks to excluded source content before copying a map slot", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-excluded-link-map-"));
    try {
      const session = await testSession(root);
      const gitConfig = join(root, ".git", "config");
      const runResult = join(session.runDir, "result.json");
      const runLock = join(root, ".piano-run.lock");
      await mkdir(dirname(gitConfig), { recursive: true });
      await Promise.all([
        writeFile(gitConfig, "[core]\n"),
        writeFile(runResult, "run evidence\n"),
        writeFile(runLock, "lock\n"),
      ]);

      for (const [name, target] of [
        ["run", runResult],
        ["git", gitConfig],
        ["lock", runLock],
      ] as const) {
        const link = join(root, `${name}.link`);
        await symlink(target, link);
        try {
          await expect(runWorkflow(session, allocateMapWorkspace(
            session.runDir,
            `excluded-link-${name}`,
            1, [{ kind: "map", regionId: "map", slot: 0 }],
            root,
            { mnemonic: "test" },))).rejects.toThrow("symlink targets excluded or external content");
        } finally {
          await rm(link, { force: true });
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retries a failed validate result by resuming the same actor, then hands only the accepted payload downstream", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-retry-run-"));
    try {
      await writeFile(join(root, "retry.yml"), RETRY_WORKFLOW);
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "retry.yml"), recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT, runDir: session.runDir, runId: "retry", cwd: root, prompt: "produce valid json",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          if (stage === "produce") {
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            const number = calls.filter((call) => stageId(call) === "produce").length;
            await writeFile(path, JSON.stringify(number === 1 ? { wrong: true } : { text: "accepted" }));
            return {
              sessionId: `produce-${number}`,
              transcriptPath: `/tmp/produce-${number}.jsonl`,
              text: `produce attempt ${number}`,
              continuation: continuation(`produce-${number}`),
            };
          }
          return {
            sessionId: "consume-1",
            transcriptPath: "/tmp/consume-1.jsonl",
            text: "consumed",
            continuation: continuation("consume-1"),
          };
        }),
      }));
      const produces = calls.filter((call) => stageId(call) === "produce");
      expect(produces).toHaveLength(2);
      expect(produces[0]?.continuation).toBeUndefined();
      expect(produces[1]?.continuation?.sessionId).toBe("produce-1");
      expect(produces[1]?.prompt).toContain("Validation repair required");
      expect(validationPath(produces[0]!)).not.toBe(validationPath(produces[1]!));
      const consume = calls.find((call) => stageId(call) === "consume");
      const inputsPath = consume?.contextFilePaths?.find((path) => path.endsWith("/inputs.json"));
      const inputs = JSON.parse(await readFile(inputsPath!, "utf8")) as { inputs: Array<{ text: string; resultPayload: { text: string }; resultPath: string }> };
      expect(inputs.inputs).toMatchObject([{ text: "produce attempt 2", resultPayload: { text: "accepted" } }]);
      expect(inputs.inputs[0]?.resultPath).toBe(validationPath(produces[1]!));
      expect(result.stages.find((stage) => stage.stageId === "produce")?.attempts).toBe(2);
      // The record keeps the accepted result path; the run-local contract copy
      // is the identity, so no content pin rides the row.
      const produceStage = result.stages.find((stage) => stage.stageId === "produce")!;
      const acceptedRow = (await acceptedRows(session.runDir)).find((row) => row.invocationId === produceStage.id);
      expect(acceptedRow?.resultPath).toBe(produceStage.resultPath);
      expect(acceptedRow).not.toHaveProperty("result");
      expect(acceptedRow).not.toHaveProperty("contract");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("warns after the one repair turn and carries the warning into inputs and the downstream prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-warning-propagation-"));
    try {
      await writeFile(join(root, "retry.yml"), RETRY_WORKFLOW);
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "retry.yml"), recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT, runDir: session.runDir, runId: "warning-propagation", cwd: root, prompt: "produce valid json",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          if (stage === "produce") {
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            // Always invalid: the initial attempt plus exactly one repair turn.
            await writeFile(path, JSON.stringify({ wrong: true }));
          }
          const number = calls.filter((call) => stageId(call) === stage).length;
          return {
            sessionId: `${stage}-${number}`,
            transcriptPath: `/tmp/${stage}-${number}.jsonl`,
            text: `${stage} attempt ${number}`,
            continuation: continuation(`${stage}-${number}`),
          };
        }),
      }));

      const produces = calls.filter((call) => stageId(call) === "produce");
      expect(produces).toHaveLength(2);
      expect(produces[1]?.prompt).toContain("Validation repair required");
      const produceStage = result.stages.find((stage) => stage.stageId === "produce")!;
      expect(produceStage.attempts).toBe(2);
      expect(produceStage.validationWarning).toMatchObject({
        worker: "test-text",
        contractPath: expect.stringContaining("contracts/test-text.json"),
        message: expect.stringContaining('failed contract "test-text"'),
      });
      expect(produceStage.resultPayload).toBeUndefined();
      expect(produceStage.metrics).toBeUndefined();
      expect(produceStage.projections).toBeUndefined();

      const consume = calls.find((call) => stageId(call) === "consume");
      expect(consume?.prompt).toContain("## Upstream validation warnings");
      expect(consume?.prompt).toContain("after `produce` (worker `test-text`");
      expect(consume?.prompt).toContain('failed contract "test-text"');
      const inputsPath = consume?.contextFilePaths?.find((path) => path.endsWith("/inputs.json"));
      const inputs = JSON.parse(await readFile(inputsPath!, "utf8")) as {
        inputs: Array<{
          stage: string;
          resultPath?: string;
          resultPayload?: unknown;
          validationWarning?: { worker: string; contractPath?: string; message: string };
        }>;
      };
      expect(inputs.inputs).toHaveLength(1);
      expect(inputs.inputs[0]).toMatchObject({
        stage: "produce",
        resultPath: produceStage.resultPath,
        validationWarning: {
          worker: "test-text",
          contractPath: expect.stringContaining("contracts/test-text.json"),
          message: expect.stringContaining('failed contract "test-text"'),
        },
      });
      expect(inputs.inputs[0]?.resultPayload).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("starts validation repair fresh when stage memory is disabled without changing its inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-retry-no-memory-run-"));
    try {
      await writeFile(join(root, "retry.yml"), RETRY_WORKFLOW.replace(
        "        worker: test-text\n",
        "        worker: test-text\n        memory: false\n",
      ));
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "retry.yml"), recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT, runDir: session.runDir, runId: "retry-no-memory", cwd: root, prompt: "produce valid json",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          if (stage === "produce") {
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            const number = calls.filter((call) => stageId(call) === "produce").length;
            await writeFile(path, JSON.stringify(number === 1 ? { wrong: true } : { text: "accepted" }));
            return {
              sessionId: `produce-${number}`,
              transcriptPath: `/tmp/produce-${number}.jsonl`,
              text: `produce attempt ${number}`,
              continuation: continuation(`produce-${number}`),
            };
          }
          return {
            sessionId: "consume-1",
            transcriptPath: "/tmp/consume-1.jsonl",
            text: "consumed",
            continuation: continuation("consume-1"),
          };
        }),
      }));
      const produces = calls.filter((call) => stageId(call) === "produce");
      expect(produces).toHaveLength(2);
      expect(produces.map((call) => call.continuation)).toEqual([undefined, undefined]);
      expect(produces[1]?.prompt).toContain("Validation repair required");
      const consume = calls.find((call) => stageId(call) === "consume");
      const inputsPath = consume?.contextFilePaths?.find((path) => path.endsWith("/inputs.json"));
      const inputs = JSON.parse(await readFile(inputsPath!, "utf8")) as { inputs: Array<{ text: string; resultPayload: { text: string } }> };
      expect(inputs.inputs).toMatchObject([{ text: "produce attempt 2", resultPayload: { text: "accepted" } }]);
      expect(result.stages.find((stage) => stage.stageId === "produce")?.attempts).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the repair prompt pointing at the current attempt, not the stale result path", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-repair-path-run-"));
    try {
      await writeFile(join(root, "retry.yml"), RETRY_WORKFLOW);
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      await runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "retry.yml"), recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT, runDir: join(root, "run$&path"), runId: "repair-path", cwd: root, prompt: "produce valid json",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          const number = calls.filter((call) => stageId(call) === "produce").length;
          if (stage === "produce" && number > 1) {
            // Attempt 1 deliberately never writes its result: the validator's
            // `expected "<path>"` message then embeds the attempt-1 result
            // path into attempt 2's repair prompt.
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({ text: "accepted" }));
          }
          return {
            sessionId: `${stage}-${number}`,
            transcriptPath: `/tmp/${stage}-${number}.jsonl`,
            text: `${stage} attempt ${number}`,
            continuation: continuation(`${stage}-${number}`),
          };
        }),
      }));
      const produces = calls.filter((call) => stageId(call) === "produce");
      expect(produces).toHaveLength(2);
      expect(validationPath(produces[0]!)).toContain("-attempt-1.json");
      const repairPrompt = produces[1]!.prompt;
      expect(repairPrompt).toContain("Validation repair required");
      expect(repairPrompt).toContain(validationPath(produces[1]!));
      // Issue #51 companion defect: the `Reason` must not cite the previous
      // attempt's path — run fe2248 showed the agent burning its context
      // resolving two contradictory result paths inside one prompt. The run
      // dir carries `$&` because the rewrite is a string replacement and `$`
      // sequences in the replacement expand to match text: a path-rewriting
      // repair prompt must survive exactly such a legal directory name.
      expect(repairPrompt).not.toContain(validationPath(produces[0]!));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads a worker contract, repairs invalid output, snapshots it, and records its benchmark", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-worker-contract-run-"));
    try {
      const workflow = `version: 3
workflow:
  name: worker-contract
  nodes:
    - stage:
        name: measure
        worker: triton-benchmark-store
        memory: false
        from: []
`;
      await writeFile(join(root, "contract.yml"), workflow);
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "kernel.py"), "candidate\n");
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
        current_best: { path: "state/current-best.py" },
        history: [],
      }));
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "contract.yml"),
        runDir: session.runDir,
        runId: "worker-contract",
        cwd: root,
        prompt: "measure",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const attempt = calls.length;
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, JSON.stringify(attempt === 1 ? { invalid: true } : {
            iteration: 0,
            decision: "KEEP",
            candidate: { path: "kernel.py" },
            current_best: { path: "state/current-best.py" },
            verification: { compile_passed: true, verify_passed: true },
            benchmark: {
              name: "throughput",
              unit: "items/s",
              direction: "higher",
              samples: [10, 12],
              best: 12,
              median: 11,
              runs: 2,
              warmup: 1,
            },
            promotion: {
              promoted: true,
              resulting_best: { path: "state/current-best.py" },
              reason: "faster",
            },
            records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
          }));
          request.onEvent?.({ type: "tool_execution_start", toolCallId: `call-${attempt}`, toolName: "bash", args: {} });
          request.onEvent?.({ type: "tool_execution_end", toolCallId: `call-${attempt}`, toolName: "bash", result: "ok", isError: false });
          // Token accounting reads the actor's transcript at attempt end, so
          // the fixture writes what a real harness would: one canonical usage
          // record per model call.
          const transcriptPath = join(root, `measure-${attempt}.jsonl`);
          await writeFile(transcriptPath, JSON.stringify({
            type: "message",
            message: {
              role: "assistant",
              content: `attempt ${attempt}`,
              usage: { input: attempt * 6, output: attempt * 4 },
            },
          }) + "\n", "utf8");
          return {
            sessionId: `measure-${attempt}`,
            transcriptPath,
            text: `attempt ${attempt}`,
            continuation: continuation(`measure-${attempt}`),
          };
        }),
      }));

      expect(calls).toHaveLength(2);
      expect(calls[1]?.continuation).toBeUndefined();
      expect(result.stages[0]).toMatchObject({ attempts: 2, worker: "triton-benchmark-store" });
      expect(result.stages[0]?.projections).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "round.materialization-v1", pointer: "" }),
        expect.objectContaining({ id: "round.decision", value: "KEEP" }),
      ]));

      const contractSnapshotPath = join(session.runDir, "contracts", "triton-benchmark-store.json");
      expect(calls[0]?.contextFilePaths).toContain(contractSnapshotPath);
      expect(JSON.parse(await readFile(contractSnapshotPath, "utf8"))).toMatchObject({
        schema: expect.any(Object),
        example: expect.any(Object),
      });
      const benchmark = (await readFile(join(session.runDir, "eval-metrics", "benchmark.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(benchmark).toHaveLength(1);
      expect(benchmark[0]).toMatchObject({
        kind: "benchmark",
        invocationId: "measure@root",
        sessionId: "measure-2",
        worker: "triton-benchmark-store",
        metric: { name: "throughput", unit: "items/s", best: 12 },
      });
      const tokens = (await readFile(join(session.runDir, "eval-metrics", "token-usage.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(tokens).toMatchObject([
        { sessionId: "measure-1", outcome: "validation_failed", delta: { total: 10 } },
        { sessionId: "measure-2", outcome: "accepted", delta: { total: 10 } },
      ]);
      expect(JSON.parse(await readFile(join(session.runDir, "status.json"), "utf8")))
        .toMatchObject({ status: "completed" });
      await expect(readFile(join(root, "state", "current-best.py"), "utf8")).resolves.toBe("candidate\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("turns two validated loop measurements into an iteration-indexed benchmark trajectory", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-worker-contract-loop-"));
    try {
      const workflow = `version: 3
workflow:
  name: worker-contract-loop
  nodes:
    - loop:
        name: tune
        from: []
        entry: measure
        exit: measure
        iterations: 2
        nodes:
          - stage:
              name: measure
              worker: triton-benchmark-store
              from: []
`;
      await writeFile(join(root, "contract-loop.yml"), workflow);
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "kernel.py"), "baseline\n");
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
        current_best: {
          path: "state/current-best.py",
          metric_throughput: 10,
          metric: { name: "throughput", best: 10, direction: "higher" },
        },
        history: [],
      }));
      const session = await testSession(root);
      let turn = 0;
      await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "contract-loop.yml"),
        runDir: session.runDir,
        runId: "worker-contract-loop",
        cwd: root,
        prompt: "measure twice",
        agentRunner: (request) => Effect.promise(async () => {
          turn += 1;
          const iteration = turn - 1;
          await writeFile(join(root, "kernel.py"), `candidate-${turn}\n`);
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, JSON.stringify({
            iteration,
            decision: "KEEP",
            candidate: { path: "kernel.py" },
            current_best: { path: "state/current-best.py" },
            verification: { compile_passed: true, verify_passed: true },
            benchmark: {
              name: "throughput",
              unit: "items/s",
              direction: "higher",
              samples: [11 + iteration],
              best: 11 + iteration,
              median: 11 + iteration,
              runs: 1,
              warmup: 0,
            },
            promotion: {
              promoted: true,
              resulting_best: { path: "state/current-best.py" },
              reason: "faster",
            },
            records: {
              round_path: `rounds/iter-${String(iteration).padStart(3, "0")}.json`,
              state_path: "state/tuning-state.json",
            },
          }));
          return {
            sessionId: "measure-session",
            transcriptPath: "/tmp/measure-session.jsonl",
            text: `iteration ${iteration}`,
            continuation: continuation("measure-session"),
          };
        }),
      }));

      const records = (await readFile(join(session.runDir, "eval-metrics", "benchmark.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as { iteration: number; metric: { best: number } });
      expect(records.map((record) => [record.iteration, record.metric.best])).toEqual([[0, 11], [1, 12]]);
      await expect(readFile(join(root, "state", "current-best.py"), "utf8")).resolves.toBe("candidate-2\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts an invalid result with a warning when the harness cannot resume for a repair", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-validate-no-continuation-"));
    try {
      await writeFile(join(root, "validate.yml"), VALIDATE_WORKFLOW);
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "validate.yml"),
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        runDir: session.runDir,
        runId: "no-continuation",
        cwd: root,
        prompt: "write validation",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, JSON.stringify({ wrong: true }));
          return {
            sessionId: "no-continuation",
            transcriptPath: "/tmp/no-continuation.jsonl",
            text: "invalid",
          };
        }),
      }));
      // No continuation means the one repair turn is impossible: the stage is
      // accepted with the warning instead of failing the run.
      expect(calls).toHaveLength(1);
      const stage = result.stages[0]!;
      expect(stage.validationWarning).toMatchObject({
        worker: "test-text",
        message: expect.stringContaining("failed contract"),
      });
      expect(stage.resultPayload).toBeUndefined();
      expect(stage.metrics).toBeUndefined();
      expect(stage.projections).toBeUndefined();
      const accepted = (await acceptedRows(session.runDir))[0];
      expect(accepted).toMatchObject({
        validationWarning: { worker: "test-text", message: expect.stringContaining("failed contract") },
      });
      expect(accepted?.resultPath).toBe(stage.resultPath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not dispatch a dependent stage after its prerequisite fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-dependency-failure-"));
    try {
      const workflow = `version: 3
workflow:
  name: dependency-failure
  nodes:
    - stage:
        name: broken
        worker: basic
        from: []
    - stage:
        name: downstream
        worker: basic
        from: [broken]
`;
      await writeFile(join(root, "broken.yml"), workflow);
      const session = await testSession(root);
      const calls: string[] = [];
      const exit = await Effect.runPromiseExit(loadAndExecuteWorkflow({
        root, workflowPath: join(root, "broken.yml"), runDir: session.runDir, runId: "broken", cwd: root, prompt: "fail",
        agentRunner: (request) => {
          calls.push(stageId(request));
          return Effect.fail(new AgentError({ kind: "unknown", message: "intentional" }));
        },
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(calls).toEqual(["broken"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });


  it("executes an explicit workflow through one load/compile/schedule path and records lifecycle evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-explicit-run-"));
    try {
      await writeFile(join(root, "special.yml"), BASIC_WORKFLOW);
      const session = await testSession(root);
      const result = await Effect.runPromiseExit(loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "special.yml"),
        runDir: session.runDir,
        runId: "lifecycle",
        cwd: root,
        prompt: "hello",
        agentOptions: { provider: "test-provider", model: "test-model" },
        agentRunner: fakeAgentRunner(fakeSdk()),
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(result)).toBe(true);
      if (!Exit.isSuccess(result)) return;
      expect(result.value.text).toBe("ans = 4");
      expect(result.value.model).toBe("test-model");
      await expect(stat(join(session.runDir, "sessions", "trajectory-pi-basic-root"))).resolves.toMatchObject({ isDirectory: expect.any(Function) });
      const log = await readFile(join(session.runDir, "system-log", "log.jsonl"), "utf8");
      const trace = await readFile(join(session.runDir, "system-log", "trace.jsonl"), "utf8");
      expect(log).toContain('"event":"workflow.loaded"');
      expect(log).toContain('"event":"workflow.compiled"');
      expect(log).toContain('"event":"workflow.scheduled"');
      expect(log).toContain('"event":"stage.completed"');
      expect(log).toContain('"event":"agentic.task.started"');
      expect(log).toContain('"event":"agentic.task.completed"');
      expect(log).toContain('"event":"agent.turn.started"');
      expect(log).toContain('"event":"agent.turn.completed"');
      // The acceptance evidence itself lands on the invocation stream.
      expect((await acceptedRows(session.runDir)).map((row) => row.invocationId)).toEqual(["respond@root"]);
      expect(log).toContain('"key":"shared-root"');
      expect(trace).toContain('"fn":"loadWorkflow"');
      expect(trace).toContain('"fn":"compileWorkflow"');
      expect(trace).toContain('"fn":"executeWorker"');
      expect(trace).toContain('"fn":"executeAgent"');
      expect(trace).toContain('"fn":"loadSdk"');
      expect(trace).toContain('"fn":"createModelRuntime"');
      expect(trace).toContain('"fn":"resolveModel"');
      expect(trace).toContain('"fn":"createResourceLoader"');
      expect(trace).toContain('"fn":"reloadResourceLoader"');
      expect(trace).toContain('"fn":"createAgentSession"');
      expect(trace).toContain('"fn":"sendPrompt"');
      expect(trace).toContain('"workspaceKey":"shared-root"');
      expect(trace).toContain(`"workspaceCwd":"${root}"`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists requested model/thinking separately from effective harness values", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-requested-config-"));
    try {
      await writeFile(join(root, "configured.yml"), CONFIGURED_WORKFLOW);
      const session = await testSession(root);
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "configured.yml"),
        runDir: session.runDir,
        runId: "configured",
        cwd: root,
        prompt: "hello",
        agentOptions: { provider: "test-provider", model: "fallback-model" },
        agentRunner: fakeAgentRunner(fakeSdk()),
      }));

      expect(result.stages[0]).toMatchObject({
        requestedModel: "stage-model",
        requestedThinkingLevel: "high",
        model: "stage-model",
        thinkingLevel: "high",
      });
      const acceptedRow = (await acceptedRows(session.runDir)).find((row) => row.invocationId === result.stages[0]!.id);
      expect(acceptedRow).toMatchObject({
        requestedModel: "stage-model",
        requestedThinkingLevel: "high",
        model: "stage-model",
        thinkingLevel: "high",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts a missing result with a warning after the one repair turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-validate-missing-"));
    try {
      const session = await testSession(root);
      await writeFile(join(root, "workflow.yml"), VALIDATE_WORKFLOW);
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "workflow.yml"),
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        runDir: session.runDir,
        runId: "missing-validate",
        cwd: root,
        prompt: "hello",
        agentOptions: { provider: "test-provider", model: "test-model" },
        agentRunner: fakeAgentRunner(fakeSdk()),
      }));
      // The first attempt fails, the one repair turn runs, and its missing
      // result becomes a warning instead of a failed stage.
      expect(result.stages[0]?.attempts).toBe(2);
      expect(result.stages[0]?.validationWarning).toMatchObject({
        worker: "test-text",
        message: expect.stringContaining("validation result missing"),
      });
      expect(result.stages[0]?.resultPayload).toBeUndefined();
      const log = await readFile(join(session.runDir, "system-log", "log.jsonl"), "utf8");
      const trace = await readFile(join(session.runDir, "system-log", "trace.jsonl"), "utf8");
      expect(log).toContain('"event":"stage.validation.retrying"');
      expect(log).toContain('"event":"stage.validation.warning"');
      expect(log).toContain('"event":"stage.completed"');
      expect(log).not.toContain('"event":"stage.failed"');
      expect(trace).toContain('"fn":"validateStageResult"');
      const accepted = (await acceptedRows(session.runDir))[0];
      expect(accepted?.validationWarning).toMatchObject({ worker: "test-text" });
      expect(accepted?.resultPath).toBe(result.stages[0]?.resultPath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps a paused run's map slots preserved for a later continue", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-map-pause-"));
    try {
      await writeFile(join(root, "map.yml"), MAP_WORKFLOW);
      await writeFile(join(root, "kernel.py"), "baseline\n");
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      let startedImplementations = 0;
      let signalBothStarted!: () => void;
      const bothStarted = new Promise<void>((resolve) => { signalBothStarted = resolve; });
      const fiber = Effect.runFork(loadAndExecuteWorkflow({
        root, workflowPath: join(root, "map.yml"), runDir: session.runDir, runId: "map-pause", cwd: root, prompt: "map candidates",
        agentRunner: (request) => {
          const stage = stageId(request);
          if (stage === "tournament.implement") {
            // Both lanes hold until the human pause interrupts this run: the
            // slots exist and are mid-flight, exactly what a continue rebinds.
            return Effect.sync(() => {
              calls.push(request);
              startedImplementations += 1;
              if (startedImplementations === 2) signalBothStarted();
            }).pipe(Effect.andThen(Effect.async<never, never>(() => {
              // Nothing resumes this: only interruption ends the turn.
            })));
          }
          return Effect.promise(async () => {
            calls.push(request);
            if (stage === "propose") {
              const path = validationPath(request);
              await mkdir(dirname(path), { recursive: true });
              await writeFile(path, JSON.stringify({
                strategies: [
                  { id: "slot-a", bottleneck: "memory", technique: "tile", rationale: "test", predicted_speedup: 1.1, risk_level: "low" },
                  { id: "slot-b", bottleneck: "compute", technique: "warp", rationale: "test", predicted_speedup: 1.2, risk_level: "medium" },
                ],
              }));
            }
            const invocation = invocationId(request);
            const sessionId = `${stage}-${invocation.replaceAll("/", "-").replaceAll("@", "-")}`;
            return {
              sessionId,
              transcriptPath: `/tmp/${sessionId}.jsonl`,
              text: `${stage}:${invocation}`,
              continuation: continuation(sessionId),
            };
          });
        },
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      await bothStarted;
      const exit = await Effect.runPromise(Fiber.interrupt(fiber));
      expect(Exit.isFailure(exit)).toBe(true);

      // The run-end backstop ran (uninterruptible) before the interrupt
      // settled: a human pause must leave the slots rebindable, never swept.
      const recordsDir = join(session.runDir, "workspace-records");
      const entries = await readdir(recordsDir);
      expect(entries).toHaveLength(2);
      for (const entry of entries) {
        const record = JSON.parse(await readFile(join(recordsDir, entry, "record.json"), "utf8")) as {
          key: string;
          cwd: string;
          phase: string;
        };
        expect(record.key).toMatch(/^job-1\/tournament\/slot-[01]$/u);
        expect(record.phase).toBe("preserved");
        expect((await stat(record.cwd)).isDirectory()).toBe(true);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reclaims a closed job's preserved slots when the next job starts", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-closed-sweep-"));
    try {
      await writeFile(join(root, "map.yml"), MAP_WORKFLOW);
      await writeFile(join(root, "kernel.py"), "baseline\n");
      const session = await testSession(root);
      let run = 1;
      let started = 0;
      let signalBothStarted!: () => void;
      const bothStarted = new Promise<void>((resolve) => { signalBothStarted = resolve; });
      const runner: AgentRunner = (request) => {
        const stage = stageId(request);
        if (run === 1 && stage === "tournament.implement") {
          return Effect.sync(() => {
            started += 1;
            if (started === 2) signalBothStarted();
          }).pipe(Effect.andThen(Effect.async<never, never>(() => {
            // Nothing resumes this: only the pause's interrupt ends the turn.
          })));
        }
        return Effect.promise(async () => {
          if (stage === "propose") {
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              strategies: [
                { id: "slot-a", bottleneck: "memory", technique: "tile", rationale: "test", predicted_speedup: 1.1, risk_level: "low" },
                { id: "slot-b", bottleneck: "compute", technique: "warp", rationale: "test", predicted_speedup: 1.2, risk_level: "medium" },
              ],
            }));
          }
          if (stage === "tournament.implement") {
            await writeFile(join(request.cwd, "kernel.py"), `candidate:${invocationId(request)}\n`);
          }
          const invocation = invocationId(request);
          const sessionId = `${stage}-${run}-${invocation.replaceAll("/", "-").replaceAll("@", "-")}`;
          return {
            sessionId,
            transcriptPath: `/tmp/${sessionId}.jsonl`,
            text: `${stage}:${invocation}`,
            continuation: continuation(sessionId),
          };
        });
      };
      const fiber = Effect.runFork(loadAndExecuteWorkflow({
        root, workflowPath: join(root, "map.yml"), runDir: session.runDir, runId: session.id, cwd: root, prompt: "map candidates",
        agentRunner: runner,
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      await bothStarted;
      const exit = await Effect.runPromise(Fiber.interrupt(fiber));
      expect(Exit.isFailure(exit)).toBe(true);

      // A plain prompt now would restart the multi-node graph from the top
      // while the job's evidence says it stopped in the middle: refused, with
      // the two commands that can act on the pause.
      const refused = await Effect.runPromiseExit(loadAndExecuteWorkflow({
        root, workflowPath: join(root, "map.yml"), runDir: session.runDir, runId: session.id, cwd: root, prompt: "just go",
        agentRunner: () => Effect.fail(new AgentError({ kind: "unknown", message: "should not run" })),
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(refused)).toBe(true);
      if (Exit.isFailure(refused)) {
        expect(Cause.pretty(refused.cause)).toContain("run is paused mid-workflow; use /continue or /restart");
      }
      expect((await readRunStatusFile(session.runDir)).jobs).toHaveLength(1);

      const recordsDir = join(session.runDir, "workspace-records");
      const readRecords = async () => Promise.all((await readdir(recordsDir))
        .filter((entry) => !entry.startsWith("."))
        .map(async (entry) =>
        JSON.parse(await readFile(join(recordsDir, entry, "record.json"), "utf8")) as {
          key: string;
          cwd: string;
          phase: string;
        }));
      const preserved = await readRecords();
      expect(preserved.map((record) => record.key).sort())
        .toEqual(["job-1/tournament/slot-0", "job-1/tournament/slot-1"]);
      expect(preserved.every((record) => record.phase === "preserved")).toBe(true);

      // The human abandons the paused job: the restart closes it and starts
      // the next job in one state transition, reclaiming the directories the
      // pause preserved.
      run = 2;
      const second = await runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "map.yml"), runDir: session.runDir, runId: session.id, cwd: root, prompt: "map candidates again",
        restartOrdinal: 1,
        agentRunner: runner,
      }));
      // The new job allocated its own lanes under its own key.
      expect(new Set(second.stages
        .filter((stage) => stage.workspace.kind === "map-slot")
        .map((stage) => stage.workspace.key)))
        .toEqual(new Set(["job-2/tournament/slot-0", "job-2/tournament/slot-1"]));

      // Cleanup leaves no tombstone: the reclaimed job-1 slots and job-2's
      // own slots are all gone, and every worktree with them.
      const after = await readRecords();
      expect(after).toEqual([]);
      for (const record of preserved) {
        await expect(stat(record.cwd)).rejects.toThrow();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("skips a finalized region on continue without running a single worker", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-map-skip-"));
    try {
      await writeFile(join(root, "map.yml"), MAP_WORKFLOW);
      await writeFile(join(root, "kernel.py"), "baseline\n");
      const session = await testSession(root);
      const firstCalls: AgentRequest[] = [];
      const verifiedContents = new Map<string, string>();
      const runner = (calls: AgentRequest[]) => (request: AgentRequest) => Effect.promise(async () => {
        calls.push(request);
        const stage = stageId(request);
        if (stage === "propose") {
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, JSON.stringify({
            strategies: [
              { id: "slot-a", bottleneck: "memory", technique: "tile", rationale: "test", predicted_speedup: 1.1, risk_level: "low" },
              { id: "slot-b", bottleneck: "compute", technique: "warp", rationale: "test", predicted_speedup: 1.2, risk_level: "medium" },
            ],
          }));
        }
        const invocation = invocationId(request);
        if (stage === "tournament.implement") {
          await writeFile(join(request.cwd, "kernel.py"), `candidate:${invocation}\n`);
        }
        if (stage === "tournament.verify") {
          verifiedContents.set(request.cwd, await readFile(join(request.cwd, "kernel.py"), "utf8"));
        }
        const sessionId = `${stage}-${invocation.replaceAll("/", "-").replaceAll("@", "-")}`;
        return {
          sessionId,
          transcriptPath: `/tmp/${sessionId}.jsonl`,
          text: `${stage}:${invocation}`,
          continuation: continuation(sessionId),
        };
      });
      const firstRun = await runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "map.yml"), runDir: session.runDir, runId: "map-skip", cwd: root, prompt: "map candidates",
        agentRunner: runner(firstCalls),
      }));
      expect(firstCalls.length).toBeGreaterThan(0);

      // The continue's cursor, folded from the run's own stream — exactly what
      // the CLI's /continue hands over: accepted invocations and the regions
      // that already exited.
      const status = await readRunStatusFile(session.runDir);
      const cursor = status.jobs.at(-1)!;
      expect(Object.keys(cursor.regions ?? {})).toHaveLength(1);

      const secondCalls: AgentRequest[] = [];
      const secondRun = await runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "map.yml"), runDir: session.runDir, runId: "map-skip", cwd: root, prompt: "map candidates",
        agentRunner: runner(secondCalls),
        continueJob: {
          jobOrdinal: cursor.jobOrdinal,
          accepted: new Set(cursor.accepted.map((entry) => entry.invocationId)),
          attempts: new Map(Object.entries(cursor.attempts)),
          regions: new Map(Object.entries(cursor.regions ?? {})),
        },
      }));
      // The region was skipped whole: not one worker turn re-ran.
      expect(secondCalls).toEqual([]);
      // And its boundary came back from evidence alone.
      expect(secondRun.stages.map((stage) => stage.id).sort()).toEqual(firstRun.stages.map((stage) => stage.id).sort());
      const firstTerminal = firstRun.terminalStages[0];
      const secondTerminal = secondRun.terminalStages[0];
      expect(secondTerminal?.id).toBe(firstTerminal?.id);
      expect(secondTerminal?.text).toBe(firstTerminal?.text);
      // The skip is what keeps the evidence singular: a re-entered region
      // would finalize again — a second region-finalized line and a second
      // selection observation for one decision.
      const after = await readRunStatusFile(session.runDir);
      expect(Object.keys(after.jobs.at(-1)?.regions ?? {})).toHaveLength(1);
      const selectionLines = (await readFile(join(session.runDir, "eval-metrics", "selection.jsonl"), "utf8")).trim().split("\n");
      expect(selectionLines).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips a finalized loop region on continue and takes its last-iteration exit", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-loop-skip-"));
    try {
      await writeFile(join(root, "loop.yml"), `version: 3
workflow:
  name: loop-then-close
  nodes:
    - stage:
        name: seed
        worker: basic
        from: []
    - loop:
        name: tune
        from: [seed]
        entry: propose
        exit: report
        iterations: 2
        nodes:
          - stage:
              name: propose
              worker: test-text
              from: []
          - stage:
              name: report
              worker: smoke-test-agent
              from: [propose]
    - stage:
        name: close
        worker: basic
        from: [tune]
`);
      const session = await testSession(root);

      // Run 1 pauses after the loop finished: `close` hangs, the loop's own
      // exit is already on the stream.
      const runs: AgentRequest[][] = [[], []];
      let run = 0;
      let hung = false;
      let signalHanging!: () => void;
      const hanging = new Promise<void>((resolve) => { signalHanging = resolve; });
      const agentRunner: AgentRunner = (request) => {
        runs[run]!.push(request);
        const stage = stageId(request);
        if (stage === "close" && !hung) {
          hung = true;
          return Effect.sync(() => { signalHanging(); }).pipe(Effect.andThen(Effect.async<never, never>(() => {
            // Nothing resumes this: only the pause's interrupt ends the turn.
          })));
        }
        return Effect.promise(async () => {
          const invocation = invocationId(request);
          if (stage === "tune.propose") {
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({ text: invocation }));
          }
          const turn = runs[run]!.filter((call) => stageId(call) === stage).length;
          return {
            sessionId: `${stage}-${turn}`,
            transcriptPath: `/tmp/${invocation.replaceAll("/", "-")}.jsonl`,
            text: `${invocation} output`,
            continuation: continuation(`${stage}-${turn}`),
          };
        });
      };

      const fiber = Effect.runFork(loadAndExecuteWorkflow({
        root, workflowPath: join(root, "loop.yml"), recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT, runDir: session.runDir, runId: "loop-skip", cwd: root, prompt: "iterate",
        agentRunner,
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      await hanging;

      const latestJobState = async () => (await readRunStatusFile(session.runDir)).jobs.at(-1);
      const deadline = Date.now() + 20_000;
      while (Object.keys((await latestJobState())?.regions ?? {}).length !== 1 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(Object.keys((await latestJobState())?.regions ?? {})).toHaveLength(1);

      const exit = await Effect.runPromise(Fiber.interrupt(fiber));
      expect(Exit.isFailure(exit)).toBe(true);

      const cursorJob = (await latestJobState())!;
      // The loop exited before the pause: its exit evidence is in the state
      // document and is what a continue rebuilds from.
      expect(Object.keys(cursorJob.regions ?? {})).toHaveLength(1);
      expect(cursorJob.accepted.map((entry) => entry.invocationId)).toContain("tune.report@tune/iter-1");

      run = 1;
      const secondRun = await runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "loop.yml"), recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT, runDir: session.runDir, runId: "loop-skip", cwd: root, prompt: "iterate",
        agentRunner,
        continueJob: {
          jobOrdinal: cursorJob.jobOrdinal,
          accepted: new Set(cursorJob.accepted.map((entry) => entry.invocationId)),
          attempts: new Map(Object.entries(cursorJob.attempts)),
          regions: new Map(Object.entries(cursorJob.regions ?? {})),
        },
      }));

      // The loop was skipped whole: only the trailing stage ran again.
      expect(runs[1]!.map((call) => stageId(call))).toEqual(["close"]);
      // Its boundary is the last iteration's own exit, rebuilt from evidence.
      expect(secondRun.stages.map((stage) => stage.id)).toEqual(expect.arrayContaining([
        "seed@root",
        "tune.propose@tune/iter-0",
        "tune.report@tune/iter-0",
        "tune.propose@tune/iter-1",
        "tune.report@tune/iter-1",
        "close@root",
      ]));
      expect(secondRun.terminalStages[0]?.stageId).toBe("close");
      // One exit decision, one record: a re-entered loop would finalize again.
      expect(Object.keys((await latestJobState())?.regions ?? {})).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("records every actor turn in the ledger, so the table folds from it", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-actor-turns-"));
    try {
      await writeFile(join(root, "basic.yml"), BASIC_WORKFLOW);
      const session = await testSession(root);
      await runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "basic.yml"), runDir: session.runDir, runId: session.id, cwd: root, prompt: "answer",
        agentRunner: () => Effect.promise(async () => ({
          sessionId: "respond-session",
          transcriptPath: "/tmp/respond-session.jsonl",
          text: "ans = 4",
          continuation: continuation("respond-session"),
        })),
      }));

      const status = await readRunStatusFile(session.runDir);
      const execution = await Effect.runPromise(
        readWorkflowExecutionContinuation(session.runDir).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      // The state document's actor table is the table the continue path reads:
      // one write, one reader, no second copy.
      expect(new Map(Object.entries(status.actors))).toEqual(execution?.actors);
      const keys = Object.keys(status.actors);
      expect(keys).toHaveLength(1);
      expect(status.actors[keys[0]!]).toMatchObject({ harness: "pi", turns: 1 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not retry a worker failure outside validate repair", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-cancelled-no-retry-"));
    try {
      await writeFile(join(root, "basic.yml"), BASIC_WORKFLOW);
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const exit = await Effect.runPromiseExit(loadAndExecuteWorkflow({
        root, workflowPath: join(root, "basic.yml"), runDir: session.runDir, runId: "cancelled", cwd: root, prompt: "answer",
        agentRunner: (request) => {
          calls.push(request);
          return Effect.fail(new AgentError({ kind: "cancelled", message: "user aborted" }));
        },
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(calls).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Tier: mocked integration. The engine threads the steering channel to the
  // worker's harness request exactly like `signal` — transport, never
  // interpreted. The pi harness (its own API tests) decides whether a session
  // binds; the orchestrator contract is identity preservation.
  it("threads the steering channel through to the worker's agent request", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-steering-threading-"));
    try {
      await writeFile(join(root, "basic.yml"), BASIC_WORKFLOW);
      const session = await testSession(root);
      const channel = createSteeringChannel();
      const calls: AgentRequest[] = [];
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "basic.yml"), runDir: session.runDir, runId: "steer-thread", cwd: root, prompt: "answer",
        steering: channel,
        agentRunner: (request) => {
          calls.push(request);
          return Effect.succeed({
            sessionId: "steer-thread-session",
            transcriptPath: "/tmp/steer-thread.jsonl",
            text: "ans = 4",
            continuation: continuation("steer-thread-session"),
          });
        },
      }));
      expect(result.text).toBe("ans = 4");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.steering).toBe(channel);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("continues each actor's harness session when a prior execution is carried over", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-resumed-execution-"));
    try {
      await writeFile(join(root, "basic.yml"), BASIC_WORKFLOW);
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const turn = (index: number, execution?: WorkflowExecutionContinuation) => runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "basic.yml"),
        runDir: session.runDir,
        // One run is one execution, so both turns carry the same id.
        runId: session.id,
        cwd: root,
        prompt: `turn ${index}`,
        ...(execution === undefined ? {} : { execution }),
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          return {
            sessionId: "respond-session",
            transcriptPath: "/tmp/respond-session.jsonl",
            text: `turn ${index} output`,
            continuation: continuation("respond-session"),
          };
        }),
      }));

      await turn(1);
      // Rebuilt from the run's own append-only evidence, which is exactly what
      // `/resume` and the next prompt of a live run both do.
      const carried = await Effect.runPromise(
        readWorkflowExecutionContinuation(session.runDir).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      expect(carried?.actors.size).toBe(1);
      await turn(2, carried);

      expect(calls).toHaveLength(2);
      // The first turn opens a fresh chat; the second reopens the same transcript
      // instead of starting the worker over.
      expect(calls[0]?.continuation).toBeUndefined();
      expect(calls[1]?.continuation).toEqual(continuation("respond-session"));
      expect(calls[1]?.prompt).toMatch(/^## User task \(whole workflow\)\nturn 2\n\n## Workflow stage context\n/);
      expect(calls[1]?.prompt).toContain("complete task for the whole workflow");
      // Both turns stay inside the one execution directory.
      expect(calls[1]?.sessionDir).toBe(calls[0]?.sessionDir);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("mints the next job ordinal from the state document alone", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-next-ordinal-"));
    try {
      await writeFile(join(root, "basic.yml"), BASIC_WORKFLOW);
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const run = (execution?: WorkflowExecutionContinuation) => runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "basic.yml"), runDir: session.runDir, runId: session.id, cwd: root, prompt: "answer",
        ...(execution === undefined ? {} : { execution }),
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          return {
            sessionId: "respond-session",
            transcriptPath: "/tmp/respond-session.jsonl",
            text: "ans = 4",
            continuation: continuation("respond-session"),
          };
        }),
      }));

      await run();
      // A higher ordinal on the invocation stream is evidence, not identity:
      // the state document's job table is the only source the next job reads.
      await Effect.runPromise(recordInvocationStart(session.runDir, {
        runId: session.id,
        jobOrdinal: 99,
        invocationId: "decoy@root",
        stageId: "decoy",
      }).pipe(Effect.provide(NodeFileSystem.layer)));
      await run();

      const status = await readRunStatusFile(session.runDir);
      expect(status.jobs.map((job) => job.jobOrdinal)).toEqual([1, 2]);
      expect(calls).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("repairs an execution that was announced but never finished, then continues its one-node job", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-alive-repair-"));
    try {
      await writeFile(join(root, "basic.yml"), BASIC_WORKFLOW);
      const session = await testSession(root);
      // The previous process died after announcing job 1 and before installing
      // its finalizer: the document says running, and nothing is working it.
      await mkdir(session.runDir, { recursive: true });
      await Effect.runPromise(initializeWorkflowProgress(
        session.runDir,
        session.id,
        { plannedStages: 1, stageCounts: {} },
        1,
        "first",
        false,
      ).pipe(Effect.provide(NodeFileSystem.layer)));
      // The dead span had already opened attempt 1; the re-run must follow it
      // instead of overwriting the result file that attempt left.
      await Effect.runPromise(markWorkflowStageStarted(session.runDir, session.id, {
        invocationId: "respond@root",
        stageId: "respond",
        stage: "respond",
        worker: "basic",
        attempt: 1,
      }).pipe(Effect.provide(NodeFileSystem.layer)));
      expect((await readRunStatusFile(session.runDir)).status).toBe("running");

      const calls: AgentRequest[] = [];
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "basic.yml"), runDir: session.runDir, runId: session.id, cwd: root, prompt: "second",
        agentRunner: (request) => {
          calls.push(request);
          return Effect.succeed({
            sessionId: "repair-session",
            transcriptPath: "/tmp/repair-session.jsonl",
            text: "repaired",
            continuation: continuation("repair-session"),
          });
        },
      }));

      // The dead run was folded to paused, and the one-node workflow continued
      // it instead of opening a second job. The new prompt is the job's input
      // from now on, so a later restart re-runs what the human last asked.
      expect(result.text).toBe("repaired");
      expect(calls).toHaveLength(1);
      const status = await readRunStatusFile(session.runDir);
      expect(status.jobs.map((job) => job.jobOrdinal)).toEqual([1]);
      expect(status.jobs[0]).toMatchObject({ input: "second", outcome: "completed" });
      expect(status.jobs[0]?.attempts["respond@root"]).toBe(2);
      expect(status.status).toBe("completed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a continue cursor that is not the latest job", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-stale-continue-"));
    try {
      await writeFile(join(root, "basic.yml"), BASIC_WORKFLOW);
      const session = await testSession(root);
      const run = () => runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "basic.yml"), runDir: session.runDir, runId: session.id, cwd: root, prompt: "answer",
        agentRunner: () => Effect.succeed({
          sessionId: "stale-session",
          transcriptPath: "/tmp/stale-session.jsonl",
          text: "ans = 4",
          continuation: continuation("stale-session"),
        }),
      }));
      await run();
      await run();

      const exit = await Effect.runPromiseExit(loadAndExecuteWorkflow({
        root, workflowPath: join(root, "basic.yml"), runDir: session.runDir, runId: session.id, cwd: root, prompt: "again",
        // Job 1 is finished and job 2 is the latest; the older cursor is
        // retired, never reopened.
        continueJob: { jobOrdinal: 1, accepted: new Set(), attempts: new Map() },
        agentRunner: () => Effect.fail(new AgentError({ kind: "unknown", message: "should not run" })),
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("not this run's latest");
      expect((await readRunStatusFile(session.runDir)).jobs.map((job) => job.jobOrdinal)).toEqual([1, 2]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("continues actors from the ledger alone when the resume stream is gone", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-ledger-actors-"));
    try {
      await writeFile(join(root, "basic.yml"), BASIC_WORKFLOW);
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const turn = (prompt: string, execution?: WorkflowExecutionContinuation) => runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "basic.yml"), runDir: session.runDir, runId: session.id, cwd: root, prompt,
        ...(execution === undefined ? {} : { execution }),
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          return {
            sessionId: "respond-session",
            transcriptPath: "/tmp/respond-session.jsonl",
            text: "ans = 4",
            continuation: continuation("respond-session"),
          };
        }),
      }));

      await turn("first");
      // The ledger's `actor-turn` row is the only record of the table — the
      // resume stream is retired — and it must carry the whole of it.
      const carried = await Effect.runPromise(
        readWorkflowExecutionContinuation(session.runDir).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      expect(carried?.actors.size).toBe(1);
      await turn("second", carried);

      // The second turn reopens the same conversation, proven by the harness
      // session it was handed.
      expect(calls).toHaveLength(2);
      expect(calls[1]?.continuation).toEqual(continuation("respond-session"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to resume an actor that recorded a turn but no continuation", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-unresumable-actor-"));
    try {
      await writeFile(join(root, "basic.yml"), BASIC_WORKFLOW);
      const session = await testSession(root);
      const exit = await Effect.runPromiseExit(loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "basic.yml"),
        runDir: session.runDir,
        runId: session.id,
        cwd: root,
        prompt: "answer",
        execution: {
          id: session.id,
          // The current actor key, deliberately missing its continuation.
          // The cast is the point: `WorkflowActorContinuation` requires
          // `continuation`, and the reader always sets it, so this shape can only
          // arrive from a caller that built the table some other way — a JSON
          // round-trip, or JS with no type checking. The guard is what stops it.
          actors: new Map([[`${ACTOR_KEY_VERSION}/${session.id}/pi/basic/root`, { turns: 1 }]]) as unknown as WorkflowExecutionContinuation["actors"],
        },
        agentRunner: () => Effect.succeed({
          sessionId: "respond-session",
          transcriptPath: "/tmp/respond.jsonl",
          text: "output",
        }),
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));

      // Silently starting a fresh chat would lose the earlier turn's context.
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        expect(exit.cause.error.message).toContain("cannot resume safely");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe(" tournament selection promotion", () => {
  const METRIC_TOURNAMENT = `version: 3
workflow:
  name: metric-tournament
  nodes:
    - stage:
        name: propose
        worker: triton-idea
        from: []
    - tournament:
        name: race
        from: [propose]
        over: propose.strategies
        count: 2
        entry: implement
        exit: bench
        nodes:
          - stage:
              name: implement
              worker: basic
              from: []
          - stage:
              name: bench
              worker: triton-benchmark-store
              from: [implement]
`;

  /** A self-contained tournament whose exit contract declares exactly one
   * metric and no GPU-round projections: a lane can fail validation without
   * pulling in the materialization protocol. */
  const WARNING_TOURNAMENT = `version: 3
workflow:
  name: warning-tournament
  nodes:
    - stage:
        name: propose
        worker: warning-propose
        from: []
    - tournament:
        name: race
        from: [propose]
        over: propose.strategies
        count: 2
        entry: implement
        exit: bench
        nodes:
          - stage:
              name: implement
              worker: warning-implement
              from: []
          - stage:
              name: bench
              worker: warning-bench
              from: [implement]
`;

  function warningBenchmark(best: number): Record<string, unknown> {
    return {
      name: "throughput",
      unit: "items/s",
      direction: "higher",
      samples: [best],
      best,
      median: best,
      runs: 1,
      warmup: 0,
    };
  }

  async function installWarningTournamentRecipes(root: string): Promise<void> {
    const contractsDir = join(root, "recipes", "contracts");
    await mkdir(contractsDir, { recursive: true });
    await writeFile(join(contractsDir, "warning-propose.json"), JSON.stringify({
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        required: ["strategies"],
        properties: {
          strategies: {
            type: "array",
            minItems: 2,
            items: {
              type: "object",
              required: ["id", "bottleneck", "technique", "rationale", "predicted_speedup", "risk_level"],
              properties: {
                id: { type: "string" },
                bottleneck: { type: "string" },
                technique: { type: "string" },
                rationale: { type: "string" },
                predicted_speedup: { type: "number" },
                risk_level: { enum: ["low", "medium", "high"] },
              },
            },
          },
        },
        additionalProperties: false,
      },
      example: {
        strategies: [
          { id: "a", bottleneck: "memory", technique: "tile", rationale: "a", predicted_speedup: 1.1, risk_level: "low" },
          { id: "b", bottleneck: "compute", technique: "warp", rationale: "b", predicted_speedup: 1.2, risk_level: "low" },
        ],
      },
      outputs: {
        metrics: [],
        projections: [{ id: "workflow.map-items", pointer: "/strategies", format: "json", required: true }],
      },
    }));
    await writeFile(join(contractsDir, "warning-implement.json"), JSON.stringify({
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        additionalProperties: true,
      },
      example: {},
      outputs: { metrics: [], projections: [] },
    }));
    await writeFile(join(contractsDir, "warning-bench.json"), JSON.stringify({
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        required: ["benchmark"],
        properties: {
          benchmark: {
            type: "object",
            required: ["name", "unit", "direction", "samples", "best", "median", "runs", "warmup"],
            properties: {
              name: { type: "string" },
              unit: { type: "string" },
              direction: { enum: ["higher", "lower"] },
              samples: { type: "array", items: { type: "number" } },
              best: { type: "number" },
              median: { type: "number" },
              runs: { type: "integer" },
              warmup: { type: "integer" },
            },
          },
        },
        additionalProperties: false,
      },
      example: { benchmark: warningBenchmark(1) },
      outputs: {
        metrics: [{ pointer: "/benchmark", format: "benchmark/v1" }],
        projections: [],
      },
    }));
  }

  /** Run WARNING_TOURNAMENT with the given lane validity: an invalid lane
   * writes a payload whose metric would win outright but which violates the
   * contract, so only validation eligibility can exclude it. */
  async function runWarningTournament(validSlots: readonly number[]) {
    const root = await mkdtemp(join(tmpdir(), "piano-warning-tournament-"));
    await writeFile(join(root, "race.yml"), WARNING_TOURNAMENT);
    await installWarningTournamentRecipes(root);
    await writeFile(join(root, "kernel.py"), "baseline\n");
    const session = await testSession(root);
    const calls: AgentRequest[] = [];
    const result = await runWorkflow(session, loadAndExecuteWorkflow({
      root,
      workflowPath: join(root, "race.yml"),
      recipeRepositoryRoot: root,
      runDir: session.runDir,
      runId: "warning-tournament",
      cwd: root,
      prompt: "race toward a trustworthy winner",
      agentRunner: (request) => Effect.promise(async () => {
        calls.push(request);
        const stage = stageId(request);
        if (stage === "propose") {
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, JSON.stringify({
            strategies: [
              { id: "slot-0", bottleneck: "memory", technique: "tile", rationale: "a", predicted_speedup: 1.1, risk_level: "low" },
              { id: "slot-1", bottleneck: "compute", technique: "warp", rationale: "b", predicted_speedup: 1.2, risk_level: "low" },
            ],
          }));
        } else if (stage === "race.implement") {
          const slot = await strategySlot(request);
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, JSON.stringify({}));
          await writeFile(join(request.cwd, "kernel.py"), `kernel-${slot}\n`);
        } else if (stage === "race.bench") {
          const slot = await strategySlot(request);
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, JSON.stringify(
            validSlots.includes(slot)
              ? { benchmark: warningBenchmark(slot === 0 ? 4 : 9) }
              : { benchmark: warningBenchmark(99), unexpected: true },
          ));
        }
        return {
          sessionId: `${stage}-${invocationId(request).replaceAll("/", "-")}-${calls.length}`,
          transcriptPath: `/tmp/warning-${calls.length}.jsonl`,
          text: `${stage}:${invocationId(request)}`,
          continuation: continuation(`${stage}-${calls.length}`),
        };
      }),
    }));
    return { session, result, calls };
  }

  it("excludes a warned tournament branch from selection even though its metric would win", async () => {
    const { session, result, calls } = await runWarningTournament([1]);
    try {
      // The invalid lane spends its one repair turn and then warns.
      expect(calls.filter((call) => stageId(call) === "race.bench")).toHaveLength(3);
      const benchRows = (await acceptedRows(session.runDir)).filter((row) => row.stageId === "race.bench");
      const warned = benchRows.find((row) => row.instanceId === "race/slot-0");
      const clean = benchRows.find((row) => row.instanceId === "race/slot-1");
      expect(warned?.validationWarning).toMatchObject({ worker: "warning-bench" });
      expect(warned?.metrics).toBeUndefined();
      expect(clean?.validationWarning).toBeUndefined();
      expect(clean?.metrics).toHaveLength(1);

      const selectionPath = join(session.runDir, "eval-metrics", "selection.jsonl");
      const records = (await readFile(selectionPath, "utf8")).trim().split("\n")
        .map((line) => JSON.parse(line) as { outcome: string; winnerKey?: string });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ outcome: "carried", winnerKey: "job-1/race/slot-1" });
      expect(result.terminalStages[0]).toMatchObject({ stageId: "race.bench", instanceId: "race/slot-1" });
      expect(result.terminalStages[0]?.validationWarning).toBeUndefined();
    } finally {
      await rm(session.root, { recursive: true, force: true });
    }
  });

  it("selects no winner when every tournament branch warns", async () => {
    const { session, result } = await runWarningTournament([]);
    try {
      const benchRows = (await acceptedRows(session.runDir)).filter((row) => row.stageId === "race.bench");
      expect(benchRows).toHaveLength(2);
      expect(benchRows.every((row) => row.validationWarning !== undefined)).toBe(true);

      const selectionPath = join(session.runDir, "eval-metrics", "selection.jsonl");
      const records = (await readFile(selectionPath, "utf8")).trim().split("\n")
        .map((line) => JSON.parse(line) as { outcome: string; winnerKey?: string });
      expect(records).toHaveLength(1);
      expect(records[0]?.outcome).toBe("metricless");
      expect(records[0]?.winnerKey).toBeUndefined();
      expect(result.terminalStages.every((stage) => stage.validationWarning !== undefined)).toBe(true);
      const status = await readRunStatusFile(session.runDir);
      expect(Object.values(status.jobs.at(-1)?.regions ?? {})).toMatchObject([
        { instance: "race", outcome: "no-winner" },
      ]);
    } finally {
      await rm(session.root, { recursive: true, force: true });
    }
  });

  it("auto-promotes a snapshot tournament winner through the engine and records a selection", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-metric-tournament-"));
    try {
      await writeFile(join(root, "race.yml"), METRIC_TOURNAMENT);
      await writeFile(join(root, "kernel.py"), "baseline\n");
      await writeFile(join(root, "user-notes.md"), "keep my dirty note\n");
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
        current_best: { path: "state/current-best.py", metric: { name: "tflops", best: 1, direction: "higher" } },
        history: [],
      }));
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );

      // Whether this slot is the winner is decided lazily by which strategy its
      // exit bench reports the higher tflops best.
      const calls: AgentRequest[] = [];
      const outcome = await Effect.runPromiseExit(
        loadAndExecuteWorkflow({
          root,
          workflowPath: join(root, "race.yml"),
          runDir: session.runDir,
          runId: "metric-race",
          cwd: root,
          prompt: "race two kernels",
          agentRunner: (request) => Effect.promise(async () => {
            calls.push(request);
            const stage = stageId(request);
            if (stage === "propose") {
              const path = validationPath(request);
              await mkdir(dirname(path), { recursive: true });
              await writeFile(path, JSON.stringify({
                strategies: [
                  { id: "slot-0", bottleneck: "memory", technique: "warp", rationale: "test", predicted_speedup: 1.1, risk_level: "low" },
                  { id: "slot-1", bottleneck: "compute", technique: "tile", rationale: "test", predicted_speedup: 1.2, risk_level: "medium" },
                ],
              }));
            } else if (stage === "race.implement") {
              const slot = await strategySlot(request);
              await writeFile(join(request.cwd, "kernel.py"), `kernel-${slot}\n`);
            } else if (stage === "race.bench") {
              // Emit metric evidence: the slot-1 kernel reports the higher best.
              const slot = await strategySlot(request);
              const best = slot === 0 ? 4 : 9;
              const path = validationPath(request);
              await mkdir(dirname(path), { recursive: true });
              await writeFile(path, JSON.stringify({
                iteration: 0,
                decision: "KEEP",
                candidate: { path: "kernel.py" },
                current_best: { path: "state/current-best.py" },
                verification: { compile_passed: true, verify_passed: true },
                benchmark: {
                  name: "tflops",
                  unit: "TFLOP/s",
                  direction: "higher",
                  samples: [best],
                  best,
                  median: best,
                  runs: 1,
                  warmup: 0,
                },
                promotion: { promoted: true, resulting_best: { path: "state/current-best.py" }, reason: "faster" },
                records: { round_path: `rounds/iter-000.json`, state_path: "state/tuning-state.json" },
              }));
            }
            return {
              sessionId: `${stage}-${invocationId(request).replaceAll("/", "-")}`,
              transcriptPath: `/tmp/race-${stage}.jsonl`,
              text: `${stage}:${invocationId(request)}`,
              continuation: continuation(`${stage}-${invocationId(request).replaceAll("/", "-")}`),
            };
          }),
        }).pipe(
          Effect.provideService(Logging, loggingService(session.log, session.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      if (Exit.isFailure(outcome)) {
        // Surface the genuine race/defect rather than hiding it in a nested cause.
        throw new Error(Cause.pretty(outcome.cause));
      }

      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) expectWholeWorkflowTask(call, "race two kernels");
      // The engine applies the winner itself: no worker turn carries it.
      expect(calls.some((call) => stageId(call).startsWith("$consolidate/"))).toBe(false);

      // Winner reference rendered into a trajectory record + the actual winner's
      // kernel materialized into the shared source by the delta apply.
      const selectionPath = join(session.runDir, "eval-metrics", "selection.jsonl");
      const records = (await readFile(selectionPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as {
        outcome: string; winnerKey?: string; commit?: string; carrying?: { kind: string; reason?: string }; referee?: { name: string; unit: string; direction: string };
      });
      expect(records).toHaveLength(1);
      expect(records[0]?.outcome).toBe("carried");
      // The metric referee that decided the winner is recorded with the selection.
      expect(records[0]?.referee).toEqual({ name: "tflops", unit: "TFLOP/s", direction: "higher" });
      const winner = records[0]?.winnerKey;
      expect(winner).toBe("job-1/race/slot-1");
      // The region's exit is evidence of its own: one line, naming the
      // instance, the outcome and the winner a continue skips by.
      const status = await readRunStatusFile(session.runDir);
      const finalized = Object.values(status.jobs.at(-1)?.regions ?? {});
      expect(finalized).toHaveLength(1);
      expect(finalized[0]).toMatchObject({
        jobOrdinal: 1,
        instance: "race",
        regionId: "race",
        regionKind: "map",
        outcome: "carried",
        winnerInstanceId: "race/slot-1",
      });
      // A delta carry produces no git commit; the stored provenance is how the
      // winning higher-tflops kernel reached the shared source.
      expect(records[0]?.commit).toBeUndefined();
      expect(records[0]?.carrying?.kind).toBe("delta-applied");
      const sourceKernel = await readFile(join(root, "kernel.py"), "utf8");
      expect(sourceKernel.trim()).toBe("kernel-1");
      await expect(readFile(join(root, "user-notes.md"), "utf8")).resolves.toBe("keep my dirty note\n");
      expect(outcome.value.terminalStages).toHaveLength(1);
      expect(outcome.value.terminalStages[0]).toMatchObject({
        stageId: "race.bench",
        instanceId: "race/slot-1",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("carries a tournament winner whose exit a continue rebuilt from evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-rebuilt-carry-"));
    try {
      await writeFile(join(root, "race.yml"), METRIC_TOURNAMENT);
      await writeFile(join(root, "kernel.py"), "baseline\n");
      await writeFile(join(root, "user-notes.md"), "keep my dirty note\n");
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
        current_best: { path: "state/current-best.py", metric: { name: "tflops", best: 1, direction: "higher" } },
        history: [],
      }));
      const session = await testSession(root);

      // Run 1 pauses mid-region: slot 1's exit is accepted and on disk, slot
      // 0's exit never settles. That is what makes run 2 rebuild a lane.
      const runs: AgentRequest[][] = [[], []];
      let run = 0;
      let hung = false;
      let signalHanging!: () => void;
      const hanging = new Promise<void>((resolve) => { signalHanging = resolve; });
      const agentRunner: AgentRunner = (request) => {
        runs[run]!.push(request);
        const stage = stageId(request);
        if (stage === "race.bench" && invocationId(request).includes("slot-0") && !hung) {
          hung = true;
          return Effect.sync(() => { signalHanging(); }).pipe(Effect.andThen(Effect.async<never, never>(() => {
            // Nothing resumes this: only the pause's interrupt ends the turn.
          })));
        }
        return Effect.promise(async () => {
          if (stage === "propose") {
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              strategies: [
                { id: "slot-0", bottleneck: "memory", technique: "warp", rationale: "test", predicted_speedup: 1.1, risk_level: "low" },
                { id: "slot-1", bottleneck: "compute", technique: "tile", rationale: "test", predicted_speedup: 1.2, risk_level: "medium" },
              ],
            }));
          } else if (stage === "race.implement") {
            const slot = await strategySlot(request);
            await writeFile(join(request.cwd, "kernel.py"), `kernel-${slot}\n`);
          } else if (stage === "race.bench") {
            // The rebuilt lane 1 holds the winning metric; lane 0's re-run does not.
            const slot = await strategySlot(request);
            const best = slot === 0 ? 4 : 9;
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              iteration: 0,
              decision: "KEEP",
              candidate: { path: "kernel.py" },
              current_best: { path: "state/current-best.py" },
              verification: { compile_passed: true, verify_passed: true },
              benchmark: {
                name: "tflops",
                unit: "TFLOP/s",
                direction: "higher",
                samples: [best],
                best,
                median: best,
                runs: 1,
                warmup: 0,
              },
              promotion: { promoted: true, resulting_best: { path: "state/current-best.py" }, reason: "faster" },
              records: { round_path: `rounds/iter-000.json`, state_path: "state/tuning-state.json" },
            }));
          }
          const sessionId = `${stage}-${invocationId(request).replaceAll("/", "-").replaceAll("@", "-")}`;
          return {
            sessionId,
            transcriptPath: `/tmp/race-${stage}.jsonl`,
            text: `${stage}:${invocationId(request)}`,
            continuation: continuation(sessionId),
          };
        });
      };

      const fiber = Effect.runFork(loadAndExecuteWorkflow({
        root, workflowPath: join(root, "race.yml"), runDir: session.runDir, runId: "metric-continue", cwd: root, prompt: "race two kernels",
        agentRunner,
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      await hanging;

      const latestJobState = async () => (await readRunStatusFile(session.runDir)).jobs.at(-1);
      const deadline = Date.now() + 20_000;
      while (!(await latestJobState())?.accepted.some((entry) => entry.invocationId === "race.bench@race/slot-1") && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect((await latestJobState())?.accepted.map((entry) => entry.invocationId)).toContain("race.bench@race/slot-1");

      const exit = await Effect.runPromise(Fiber.interrupt(fiber));
      expect(Exit.isFailure(exit)).toBe(true);

      // The pause landed mid-region: nothing finalized it, so the continue
      // re-enters and the winner's lane must come back from its evidence.
      const cursorJob = (await latestJobState())!;
      expect(Object.keys(cursorJob.regions ?? {})).toHaveLength(0);
      // The carried conversations come from the run's own resume evidence.
      const execution = await Effect.runPromise(
        readWorkflowExecutionContinuation(session.runDir).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      expect(execution?.actors.size).toBeGreaterThan(0);

      run = 1;
      const secondRun = await runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "race.yml"), runDir: session.runDir, runId: "metric-continue", cwd: root, prompt: "race two kernels",
        ...(execution === undefined ? {} : { execution }),
        agentRunner,
        continueJob: {
          jobOrdinal: cursorJob.jobOrdinal,
          accepted: new Set(cursorJob.accepted.map((entry) => entry.invocationId)),
          attempts: new Map(Object.entries(cursorJob.attempts)),
          regions: new Map(Object.entries(cursorJob.regions ?? {})),
        },
      }));

      const secondCalls = runs[1]!;
      // The winner's exit came back from evidence: it never ran again.
      expect(secondCalls.filter((call) =>
        stageId(call) === "race.bench" && invocationId(call).includes("slot-1"))).toHaveLength(0);
      const winnerExit = runs[0]!.find((call) =>
        stageId(call) === "race.bench" && invocationId(call).includes("slot-1"));
      expect(winnerExit).toBeDefined();
      // No worker turn runs: the rebuilt exit's own slot content is all the
      // carry needs, so rebuilding the boundary is enough.
      expect(secondCalls.some((call) => stageId(call).startsWith("$consolidate/"))).toBe(false);

      // One decision, one selection: the re-entered region finalized once.
      const selection = (await readFile(join(session.runDir, "eval-metrics", "selection.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(selection).toHaveLength(1);
      expect(selection[0]).toMatchObject({ outcome: "carried", winnerKey: "job-1/race/slot-1" });
      const after = await readRunStatusFile(session.runDir);
      expect(Object.keys(after.jobs.at(-1)?.regions ?? {})).toHaveLength(1);
      // The carried winner reached the shared source.
      expect((await readFile(join(root, "kernel.py"), "utf8")).trim()).toBe("kernel-1");
      expect(secondRun.terminalStages[0]).toMatchObject({ stageId: "race.bench", instanceId: "race/slot-1" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("merges a git-worktree winner into the parent branch instead of applying a delta", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-git-carry-"));
    try {
      // A clean git repo: the lane workspaces are real worktrees of it, so the
      // winner is carried by merging, not by a frozen file delta.
      const repo = join(root, "repo");
      await mkdir(repo, { recursive: true });
      await runFile("git", ["-C", repo, "init", "-b", "main"], { encoding: "utf8" });
      await runFile("git", ["-C", repo, "config", "user.name", "Test Agent"], { encoding: "utf8" });
      await runFile("git", ["-C", repo, "config", "user.email", "agent@test.local"], { encoding: "utf8" });
      await writeFile(join(repo, "kernel.py"), "baseline\n");
      await writeFile(join(repo, "race.yml"), METRIC_TOURNAMENT);
      await mkdir(join(repo, "state"), { recursive: true });
      await writeFile(join(repo, "state", "current-best.py"), "baseline\n");
      await writeFile(join(repo, "state", "tuning-state.json"), JSON.stringify({
        current_best: { path: "state/current-best.py", metric: { name: "tflops", best: 1, direction: "higher" } },
        history: [],
      }));
      await runFile("git", ["-C", repo, "add", "-A"], { encoding: "utf8" });
      await runFile("git", ["-C", repo, "commit", "-m", "baseline"], { encoding: "utf8" });

      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const outcome = await Effect.runPromiseExit(loadAndExecuteWorkflow({
        root: repo, workflowPath: join(repo, "race.yml"), runDir: session.runDir, runId: "git-race", cwd: repo, prompt: "race two kernels",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          if (stage === "propose") {
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              strategies: [
                { id: "slot-0", bottleneck: "memory", technique: "warp", rationale: "test", predicted_speedup: 1.1, risk_level: "low" },
                { id: "slot-1", bottleneck: "compute", technique: "tile", rationale: "test", predicted_speedup: 1.2, risk_level: "medium" },
              ],
            }));
          } else if (stage === "race.implement") {
            const slot = await strategySlot(request);
            await writeFile(join(request.cwd, `kernel-${slot}.py`), `kernel-${slot}\n`);
          } else if (stage === "race.bench") {
            const slot = await strategySlot(request);
            const best = slot === 0 ? 4 : 9;
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              iteration: 0,
              decision: "KEEP",
              candidate: { path: "kernel.py" },
              current_best: { path: "state/current-best.py" },
              verification: { compile_passed: true, verify_passed: true },
              benchmark: { name: "tflops", unit: "TFLOP/s", direction: "higher", samples: [best], best, median: best, runs: 1, warmup: 0 },
              promotion: { promoted: true, resulting_best: { path: "state/current-best.py" }, reason: "faster" },
              records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
            }));
          }
          const invocation = invocationId(request);
          const sessionId = `${stage}-${invocation.replaceAll("/", "-").replaceAll("@", "-")}`;
          return {
            sessionId,
            transcriptPath: `/tmp/${sessionId}.jsonl`,
            text: `${stage}:${invocation}`,
            continuation: continuation(sessionId),
          };
        }),
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      if (Exit.isFailure(outcome)) {
        // Surface the genuine lane failure rather than hiding it in a nested cause.
        throw new Error(Cause.pretty(outcome.cause));
      }
      const result = outcome.value;

      // No consolidation turn: git carried the winner, and git is the record.
      expect(calls.some((call) => stageId(call).startsWith("$consolidate/"))).toBe(false);
      const winnerBranch = "tuna/metric-tournament-git-race/lane-1";
      const branchCommit = (await runFile("git", ["-C", repo, "rev-parse", winnerBranch], { encoding: "utf8" })).stdout.trim();
      // The winner's commit is an ancestor of the parent's HEAD — the merge is
      // verifiable with git alone.
      await runFile("git", ["-C", repo, "merge-base", "--is-ancestor", branchCommit, "HEAD"], { encoding: "utf8" });
      expect((await readFile(join(repo, "kernel-1.py"), "utf8")).trim()).toBe("kernel-1");

      const selection = (await readFile(join(session.runDir, "eval-metrics", "selection.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as {
          outcome: string; winnerKey?: string; commit?: string; carrying?: { kind: string };
        });
      expect(selection).toHaveLength(1);
      expect(selection[0]).toMatchObject({ outcome: "carried", winnerKey: "job-1/race/slot-1" });
      expect(selection[0]?.carrying?.kind).toBe("git-merged");
      expect(selection[0]?.commit).toBe(branchCommit);
      expect(result.terminalStages[0]).toMatchObject({ stageId: "race.bench", instanceId: "race/slot-1" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("does not promote a blocked slot with a better metric, and continues with the healthy winner", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-blocked-metric-tournament-"));
    try {
      await writeFile(join(root, "race.yml"), `version: 3
workflow:
  name: blocked-metric-tournament
  nodes:
    - stage:
        name: propose
        worker: racer
        from: []
    - tournament:
        name: race
        from: [propose]
        over: propose.strategies
        count: 2
        entry: implement
        exit: bench
        nodes:
          - stage:
              name: implement
              worker: racer
              from: []
          - stage:
              name: bench
              worker: racer
              from: [implement]
    - stage:
        name: summary
        worker: racer
        from: [race]
`);
      const workerDir = join(root, "recipes", "racer");
      await mkdir(workerDir, { recursive: true });
      await writeWorkerContract(workerDir, JSON.stringify({
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            strategies: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "bottleneck", "technique", "rationale", "predicted_speedup", "risk_level"],
                properties: {
                  id: { type: "string" },
                  bottleneck: { type: "string" },
                  technique: { type: "string" },
                  rationale: { type: "string" },
                  predicted_speedup: { type: "number" },
                  risk_level: { type: "string" },
                },
                additionalProperties: false,
              },
            },
            decision: { enum: ["KEEP", "BLOCKED"] },
            block_scope: { enum: ["iteration", "global"] },
            metric: {
              type: "object",
              required: ["name", "unit", "direction", "samples", "best", "median", "runs", "warmup"],
              properties: {
                name: { type: "string" },
                unit: { type: "string" },
                direction: { enum: ["higher", "lower"] },
                samples: { type: "array", minItems: 1, items: { type: "number" } },
                best: { type: "number" },
                median: { type: "number" },
                runs: { type: "integer", minimum: 1 },
                warmup: { type: "integer", minimum: 0 },
              },
              additionalProperties: false,
            },
          },
          anyOf: [
            { properties: { strategies: {} }, required: ["strategies"] },
            { properties: { decision: {}, metric: {} }, required: ["decision", "metric"] },
          ],
          additionalProperties: false,
        },
        example: {
          decision: "BLOCKED",
          metric: {
            name: "score",
            unit: "points",
            direction: "higher",
            samples: [99],
            best: 99,
            median: 99,
            runs: 1,
            warmup: 0,
          },
        },
        outputs: {
          metrics: [{ pointer: "/metric", format: "benchmark/v1", required: false }],
          projections: [
            { id: "workflow.map-items", pointer: "/strategies", format: "json", required: false },
            { id: "round.decision", pointer: "/decision", format: "string", required: false },
            { id: "workflow.block-scope", pointer: "/block_scope", format: "string", required: false },
          ],
        },
      }));
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      let summaryKernel: string | undefined;
      const exit = await Effect.runPromiseExit(
        loadWorkflow(join(root, "race.yml"), root, root).pipe(
          Effect.flatMap((loaded) => executeWorkflow(loaded, {
            runDir: session.runDir,
            runId: "blocked-metric-tournament",
            cwd: root,
            prompt: "choose the healthy kernel and continue to summary",
            agentRunner: (request) => Effect.promise(async () => {
              calls.push(request);
              const stage = stageId(request);
              if (stage === "propose") {
                await writeFile(validationPath(request), JSON.stringify({
                  strategies: [
                    { id: "slot-0", bottleneck: "memory", technique: "warp", rationale: "healthy", predicted_speedup: 1.1, risk_level: "low" },
                    { id: "slot-1", bottleneck: "compute", technique: "tile", rationale: "blocked", predicted_speedup: 1.2, risk_level: "medium" },
                  ],
                }));
              } else if (stage === "race.implement") {
                await writeFile(join(request.cwd, "kernel.py"), `kernel-${await strategySlot(request)}\n`);
              } else if (stage === "race.bench") {
                const slot = await strategySlot(request);
                const best = slot === 0 ? 1 : 99;
                await writeFile(validationPath(request), JSON.stringify({
                  decision: slot === 1 ? "BLOCKED" : "KEEP",
                  ...(slot === 1 ? { block_scope: "iteration" } : {}),
                  metric: {
                    name: "score",
                    unit: "points",
                    direction: "higher",
                    samples: [best],
                    best,
                    median: best,
                    runs: 1,
                    warmup: 0,
                  },
                }));
              } else if (stage === "summary") {
                summaryKernel = await readFile(join(request.cwd, "kernel.py"), "utf8");
              }
              const id = `${stage}-${invocationId(request).replaceAll("/", "-")}`;
              return {
                sessionId: id,
                transcriptPath: `/tmp/${id}.jsonl`,
                text: id,
                continuation: continuation(id),
              };
            }),
          })),
        ).pipe(
          Effect.provideService(Logging, loggingService(session.log, session.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );

      if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause));
      expect(calls.some((call) => stageId(call) === "summary")).toBe(true);
      expect(summaryKernel).toBe("kernel-0\n");
      const selectionPath = join(session.runDir, "eval-metrics", "selection.jsonl");
      const records = (await readFile(selectionPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as {
        outcome: string;
        winnerKey?: string;
        carrying?: { kind: string };
      });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        outcome: "carried",
        winnerKey: "job-1/race/slot-0",
        carrying: { kind: "delta-applied" },
      });
      expect(exit.value.terminalStages).toHaveLength(1);
      expect(exit.value.terminalStages[0]).toMatchObject({ stageId: "summary" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an explicitly selected stopped slot before winner carry", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-explicit-blocked-winner-"));
    try {
      await writeFile(join(root, "race.yml"), METRIC_TOURNAMENT);
      await writeFile(join(root, "kernel.py"), "baseline\n");
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
        current_best: { path: "state/current-best.py", metric: { name: "tflops", best: 1, direction: "higher" } },
        history: [],
      }));
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "race.yml"),
        runDir: session.runDir,
        runId: "explicit-blocked-winner",
        cwd: root,
        prompt: "do not carry a blocked candidate",
        workspace: { winner: "first" },
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          if (stage === "propose") {
            await writeFile(validationPath(request), JSON.stringify({
              strategies: [
                { id: "slot-0", bottleneck: "memory", technique: "warp", rationale: "blocked", predicted_speedup: 1.1, risk_level: "low" },
                { id: "slot-1", bottleneck: "compute", technique: "tile", rationale: "healthy", predicted_speedup: 1.2, risk_level: "medium" },
              ],
            }));
          } else if (stage === "race.implement") {
            await writeFile(join(request.cwd, "kernel.py"), `kernel-${await strategySlot(request)}\n`);
          } else if (stage === "race.bench") {
            const slot = await strategySlot(request);
            await writeFile(validationPath(request), JSON.stringify(slot === 0
              ? {
                iteration: 0,
                decision: "BLOCKED",
                candidate: { path: "kernel.py" },
                current_best: { path: "state/current-best.py" },
                verification: { compile_passed: true, verify_passed: true },
                promotion: { promoted: false, resulting_best: { path: "state/current-best.py" }, reason: "blocked" },
                records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
              }
              : {
                iteration: 0,
                decision: "KEEP",
                candidate: { path: "kernel.py" },
                current_best: { path: "state/current-best.py" },
                verification: { compile_passed: true, verify_passed: true },
                benchmark: { name: "tflops", unit: "TFLOP/s", direction: "higher", samples: [9], best: 9, median: 9, runs: 1, warmup: 0 },
                promotion: { promoted: true, resulting_best: { path: "state/current-best.py" }, reason: "healthy" },
                records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
              }));
          }
          const id = `${stage}-${invocationId(request).replaceAll("/", "-")}`;
          return { sessionId: id, transcriptPath: `/tmp/${id}.jsonl`, text: id, continuation: continuation(id) };
        }),
      }));

      await expect(readFile(join(root, "kernel.py"), "utf8")).resolves.toBe("baseline\n");
      const records = (await readFile(join(session.runDir, "eval-metrics", "selection.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as { outcome: string; skipped?: string });
      expect(records.at(-1)).toMatchObject({ outcome: "no-winner" });
      expect(records.at(-1)?.skipped).toContain("terminal blocked result");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("terminates a loop when any blocked tournament slot is global-scoped", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-mixed-block-scope-tournament-"));
    try {
      await writeFile(join(root, "mixed.yml"), `version: 3
workflow:
  name: mixed-block-scope-tournament
  nodes:
    - loop:
        name: tune
        from: []
        entry: propose
        exit: race
        iterations: 2
        nodes:
          - stage:
              name: propose
              worker: racer
              from: []
          - tournament:
              name: race
              from: [propose]
              over: propose.strategies
              count: 2
              entry: implement
              exit: bench
              nodes:
                - stage:
                    name: implement
                    worker: racer
                    from: []
                - stage:
                    name: bench
                    worker: racer
                    from: [implement]
`);
      const workerDir = join(root, "recipes", "racer");
      await mkdir(workerDir, { recursive: true });
      await writeWorkerContract(workerDir, JSON.stringify({
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            strategies: { type: "array", items: { type: "object", required: ["id"], properties: { id: { type: "string" } }, additionalProperties: false } },
            decision: { enum: ["BLOCKED"] },
            block_scope: { enum: ["iteration", "global"] },
            benchmark: {
              type: "object",
              required: ["name", "unit", "direction", "samples", "best", "median", "runs", "warmup"],
              properties: {
                name: { type: "string" },
                unit: { type: "string" },
                direction: { enum: ["higher", "lower"] },
                samples: { type: "array", items: { type: "number" } },
                best: { type: "number" },
                median: { type: "number" },
                runs: { type: "integer", minimum: 1 },
                warmup: { type: "integer", minimum: 0 },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        example: { strategies: [{ id: "slot-0" }] },
        outputs: {
          metrics: [{ pointer: "/benchmark", format: "benchmark/v1", required: false }],
          projections: [
            { id: "workflow.map-items", pointer: "/strategies", format: "json", required: false },
            { id: "round.decision", pointer: "/decision", format: "string", required: false },
            { id: "workflow.block-scope", pointer: "/block_scope", format: "string", required: false },
          ],
        },
      }));
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      await runWorkflow(session, loadWorkflow(join(root, "mixed.yml"), root, root).pipe(
        Effect.flatMap((loaded) => executeWorkflow(loaded, {
          runDir: session.runDir,
          runId: "mixed-block-scope-tournament",
          cwd: root,
          prompt: "stop when any tournament lane is globally blocked",
          agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          if (stage === "tune.propose") {
            await writeFile(validationPath(request), JSON.stringify({
              strategies: [{ id: "slot-0" }, { id: "slot-1" }],
            }));
          } else if (stage === "tune.race.implement") {
            await writeFile(join(request.cwd, "candidate.txt"), `slot-${await strategySlot(request)}\n`);
          } else if (stage === "tune.race.bench") {
            const slot = await strategySlot(request);
            await writeFile(validationPath(request), JSON.stringify(slot === 0
              ? { decision: "BLOCKED", block_scope: "global" }
              : {
                benchmark: {
                  name: "score",
                  unit: "points",
                  direction: "higher",
                  samples: [2],
                  best: 2,
                  median: 2,
                  runs: 1,
                  warmup: 0,
                },
              }));
          }
          const id = `${stage}-${invocationId(request).replaceAll("/", "-")}`;
          return { sessionId: id, transcriptPath: `/tmp/${id}.jsonl`, text: id, continuation: continuation(id) };
          }),
        })),
      ));

      expect(calls.filter((call) => stageId(call) === "tune.propose")).toHaveLength(1);
      expect(calls.filter((call) => stageId(call) === "tune.race.bench")).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("carries a winner deletion without treating ignored parent artifacts as deleted", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-git-delta-tournament-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-git-delta-runs-"));
    try {
      await writeFile(join(root, "race.yml"), METRIC_TOURNAMENT);
      await writeFile(join(root, ".gitignore"), "build/\nruns/\n");
      await writeFile(join(root, "kernel.py"), "baseline\n");
      await writeFile(join(root, "obsolete.txt"), "remove me\n");
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
        current_best: { path: "state/current-best.py", metric: { name: "tflops", best: 1, direction: "higher" } },
        history: [],
      }));
      await runFile("git", ["init", "-q", root]);
      await runFile("git", ["-C", root, "config", "user.email", "piano-tests@example.invalid"]);
      await runFile("git", ["-C", root, "config", "user.name", "Piano Tests"]);
      await runFile("git", ["-C", root, "add", "-A"]);
      await runFile("git", ["-C", root, "commit", "-q", "-m", "baseline"]);
      await mkdir(join(root, "build"), { recursive: true });
      await writeFile(join(root, "build", "cache.bin"), "parent-only ignored artifact\n");

      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: runRoot }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const consolidationPrompts: string[] = [];
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "race.yml"),
        runDir: session.runDir,
        runId: "git-delta-race",
        cwd: root,
        prompt: "carry only the winning source change",
        agentRunner: (request) => Effect.promise(async () => {
          const stage = stageId(request);
          if (stage.startsWith("$consolidate/")) consolidationPrompts.push(request.prompt);
          if (stage === "propose") {
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              strategies: [
                { id: "slot-0", bottleneck: "memory", technique: "warp", rationale: "test", predicted_speedup: 1.1, risk_level: "low" },
                { id: "slot-1", bottleneck: "compute", technique: "tile", rationale: "test", predicted_speedup: 1.2, risk_level: "medium" },
              ],
            }));
          } else if (stage === "race.implement") {
            const slot = await strategySlot(request);
            await writeFile(join(request.cwd, "kernel.py"), `kernel-${slot}\n`);
            if (slot === 1) await rm(join(request.cwd, "obsolete.txt"));
          } else if (stage === "race.bench") {
            const slot = await strategySlot(request);
            const best = slot === 0 ? 4 : 9;
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              iteration: 0,
              decision: "KEEP",
              candidate: { path: "kernel.py" },
              current_best: { path: "state/current-best.py" },
              verification: { compile_passed: true, verify_passed: true },
              benchmark: { name: "tflops", unit: "TFLOP/s", direction: "higher", samples: [best], best, median: best, runs: 1, warmup: 0 },
              promotion: { promoted: true, resulting_best: { path: "state/current-best.py" }, reason: "faster" },
              records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
            }));
          }
          const id = `${stage}-${invocationId(request).replaceAll("/", "-")}`;
          return { sessionId: id, transcriptPath: `/tmp/${id}.jsonl`, text: id, continuation: continuation(id) };
        }),
      }));

      // The merge carried the winner's edit and the winner's deletion...
      await expect(readFile(join(root, "kernel.py"), "utf8")).resolves.toBe("kernel-1\n");
      await expect(stat(join(root, "obsolete.txt"))).rejects.toMatchObject({ code: "ENOENT" });
      // ...without touching what the parent had and the winner never saw. An
      // ignored artifact is untracked from git's point of view, so the merge
      // leaves it alone by construction — no delta needs to exclude it.
      await expect(readFile(join(root, "build", "cache.bin"), "utf8")).resolves.toBe("parent-only ignored artifact\n");
      // Git is the record and the verification: the winner's lane branch is
      // an ancestor of the parent's HEAD.
      const winnerCommit = (await runFile("git", ["-C", root, "rev-parse", "tuna/metric-tournament-git-delta-race/lane-1"], { encoding: "utf8" })).stdout.trim();
      await runFile("git", ["-C", root, "merge-base", "--is-ancestor", winnerCommit, "HEAD"], { encoding: "utf8" });
      // A git lane is merged: no worker turn applies files.
      expect(consolidationPrompts).toHaveLength(0);
      const records = new Map(result.stages
        .filter((stage) => stage.workspace.recordPath !== undefined)
        .map((stage) => [stage.workspace.recordPath!, stage.workspace]));
      for (const workspace of records.values()) {
        expect(workspace.strategy).toBe("git-worktree");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("aborts before workers when the lane fork cannot be prepared", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-slot-baseline-failure-"));
    const runRoot = await mkdtemp(join(tmpdir(), "piano-slot-baseline-runs-"));
    try {
      await writeFile(join(root, "race.yml"), METRIC_TOURNAMENT);
      await writeFile(join(root, ".gitignore"), "build/\nruns/\n");
      await writeFile(join(root, "kernel.py"), "baseline\n");
      await runFile("git", ["init", "-q", root]);
      await runFile("git", ["-C", root, "config", "user.email", "piano-tests@example.invalid"]);
      await runFile("git", ["-C", root, "config", "user.name", "Piano Tests"]);
      await runFile("git", ["-C", root, "add", "-A"]);
      await runFile("git", ["-C", root, "commit", "-q", "-m", "baseline"]);
      // A dirty source with an external symlink: the seed commit refuses it.
      await writeFile(join(root, "unsaved.txt"), "unsaved\n");
      await symlink("/etc/hostname", join(root, "external-link"));

      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: runRoot }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const calls: AgentRequest[] = [];
      const exit = await Effect.runPromiseExit(loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "race.yml"),
        runDir: session.runDir,
        runId: "slot-baseline-failure",
        cwd: root,
        prompt: "race two kernels",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          if (stage !== "propose") throw new Error(`unexpected worker after fork failure: ${stage}`);
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, JSON.stringify({
            strategies: [
              { id: "slot-0", bottleneck: "memory", technique: "warp", rationale: "test", predicted_speedup: 1.1, risk_level: "low" },
              { id: "slot-1", bottleneck: "compute", technique: "tile", rationale: "test", predicted_speedup: 1.2, risk_level: "medium" },
            ],
          }));
          return { sessionId: "propose", transcriptPath: "/tmp/propose.jsonl", text: "propose", continuation: continuation("propose") };
        }),
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));

      if (Exit.isSuccess(exit)) throw new Error("expected lane fork preparation to fail");
      expect(Cause.pretty(exit.cause)).toContain("symlink targets excluded or external content");
      expect(calls.map(stageId)).toEqual(["propose"]);
      // The source is untouched: no seed commit, no branch, no slot, and the
      // external symlink was never followed or copied.
      expect((await runFile("git", ["-C", root, "for-each-ref", "--format=%(refname:short)", "refs/heads/tuna/"], { encoding: "utf8" })).stdout.trim()).toBe("");
      expect((await lstat(join(root, "external-link"))).isSymbolicLink()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it("rolls back a failed delta carry, stops downstream work, and preserves every slot for recovery", async () => {
    if (process.getuid?.() === 0) return; // root bypasses the directory mode
    const root = await mkdtemp(join(tmpdir(), "piano-delta-carry-rollback-"));
    const locked = join(root, "locked");
    try {
      const workflow = `${METRIC_TOURNAMENT}    - stage:
        name: summary
        worker: basic
        from: [race]
`;
      await writeFile(join(root, "race.yml"), workflow);
      await writeFile(join(root, "kernel.py"), "baseline\n");
      await writeFile(join(root, "user-notes.md"), "untouched\n");
      await mkdir(locked, { recursive: true });
      await writeFile(join(locked, "kept.txt"), "must survive\n");
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
        current_best: { path: "state/current-best.py", metric: { name: "tflops", best: 1, direction: "higher" } },
        history: [],
      }));
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const exit = await Effect.runPromiseExit(loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "race.yml"),
        runDir: session.runDir,
        runId: "delta-carry-rollback",
        cwd: root,
        prompt: "race two kernels",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          if (stage === "propose") {
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              strategies: [
                { id: "slot-0", bottleneck: "memory", technique: "warp", rationale: "test", predicted_speedup: 1.1, risk_level: "low" },
                { id: "slot-1", bottleneck: "compute", technique: "tile", rationale: "test", predicted_speedup: 1.2, risk_level: "medium" },
              ],
            }));
          } else if (stage === "race.implement") {
            const slot = await strategySlot(request);
            await writeFile(join(request.cwd, "kernel.py"), `kernel-${slot}\n`);
            if (slot === 1) {
              // The winner adds a file under a parent directory the operator
              // makes read-only while the race runs: the delta cannot land.
              await writeFile(join(request.cwd, "locked", "new.txt"), "cannot land\n");
              await chmod(locked, 0o500);
            }
          } else if (stage === "race.bench") {
            const slot = await strategySlot(request);
            const best = slot === 0 ? 4 : 9;
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              iteration: 0,
              decision: "KEEP",
              candidate: { path: "kernel.py" },
              current_best: { path: "state/current-best.py" },
              verification: { compile_passed: true, verify_passed: true },
              benchmark: { name: "tflops", unit: "TFLOP/s", direction: "higher", samples: [best], best, median: best, runs: 1, warmup: 0 },
              promotion: { promoted: true, resulting_best: { path: "state/current-best.py" }, reason: "faster" },
              records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
            }));
          }
          const id = `${stage}-${invocationId(request).replaceAll("/", "-")}`;
          return { sessionId: id, transcriptPath: `/tmp/${id}.jsonl`, text: id, continuation: continuation(id) };
        }),
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));

      expect(Exit.isFailure(exit)).toBe(true);
      expect(calls.some((call) => stageId(call) === "summary")).toBe(false);
      await expect(readFile(join(root, "kernel.py"), "utf8")).resolves.toBe("baseline\n");
      await expect(readFile(join(root, "user-notes.md"), "utf8")).resolves.toBe("untouched\n");
      await expect(readFile(join(locked, "kept.txt"), "utf8")).resolves.toBe("must survive\n");
      await expect(stat(join(locked, "new.txt"))).rejects.toMatchObject({ code: "ENOENT" });

      const recordRoot = join(session.runDir, "workspace-records");
      const records = await Promise.all((await readdir(recordRoot)).map(async (entry) =>
        JSON.parse(await readFile(join(recordRoot, entry, "record.json"), "utf8")) as { phase: string; cwd: string }));
      expect(records).toHaveLength(2);
      for (const record of records) {
        expect(record.phase).toBe("preserved");
        expect((await stat(record.cwd)).isDirectory()).toBe(true);
      }
      const selections = (await readFile(join(session.runDir, "eval-metrics", "selection.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as { outcome: string; carrying?: { kind: string } });
      expect(selections.at(-1)).toMatchObject({ outcome: "no-winner", carrying: { kind: "carry-failed" } });
    } finally {
      await chmod(locked, 0o700).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps looping when only a losing tournament slot stops, while guarding incumbent ties", async () => {
    const LOOP_RACE_WORKFLOW = `version: 3
workflow:
  name: loop-race
  nodes:
    - loop:
        name: tune
        from: []
        entry: propose
        exit: race
        feedback: race
        iterations: 3
        nodes:
          - stage:
              name: propose
              worker: basic
              from: []
          - tournament:
              name: race
              from: [propose]
              over: propose.strategies
              count: 2
              entry: implement
              exit: bench
              nodes:
                - stage:
                    name: implement
                    worker: basic
                    from: []
                - stage:
                    name: bench
                    worker: loop-benchmark-store
                    from: [implement]
`;
    const root = await mkdtemp(join(tmpdir(), "piano-loop-race-"));
    try {
      await writeFile(join(root, "loop-race.yml"), LOOP_RACE_WORKFLOW);
      await writeFile(join(root, "kernel.py"), "baseline\n");
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
        current_best: { path: "state/current-best.py", metric: { name: "tflops", best: 1, direction: "higher" } },
        history: [],
      }));
      await installTestProposalContract(root, "basic");
      const benchmarkWorkerDir = join(root, "recipes", "loop-benchmark-store");
      await mkdir(benchmarkWorkerDir, { recursive: true });
      await writeWorkerContract(benchmarkWorkerDir, JSON.stringify({
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          required: ["decision"],
          properties: {
            decision: { enum: ["KEEP", "BLOCKED"] },
            block_scope: { enum: ["iteration", "global"] },
            benchmark: {
              type: "object",
              required: ["name", "unit", "direction", "samples", "best", "median", "runs", "warmup"],
              properties: {
                name: { type: "string" },
                unit: { type: "string" },
                direction: { enum: ["higher", "lower"] },
                samples: { type: "array", minItems: 1, items: { type: "number" } },
                best: { type: "number" },
                median: { type: "number" },
                runs: { type: "integer", minimum: 1 },
                warmup: { type: "integer", minimum: 0 },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        example: { decision: "BLOCKED", block_scope: "iteration" },
        outputs: {
          metrics: [{ pointer: "/benchmark", format: "benchmark/v1", required: false }],
          projections: [
            { id: "round.decision", pointer: "/decision", format: "string", required: true },
            { id: "workflow.block-scope", pointer: "/block_scope", format: "string", required: false },
          ],
        },
      }));
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );

      // The shared source observed on entry to each iteration's propose proves
      // the ordering: the winner carried at iteration N's region exit is
      // already in the source when iteration N+1 begins — selection and carry
      // happen at the tournament's exit, not at run end.
      const sourceAtPropose: string[] = [];
      const outcome = await Effect.runPromiseExit(
        loadWorkflow(join(root, "loop-race.yml"), root, root).pipe(
          Effect.flatMap((loaded) => executeWorkflow(loaded, {
          runDir: session.runDir,
          runId: "loop-race",
          cwd: root,
          prompt: "race kernels each iteration",
          agentRunner: (request) => Effect.promise(async () => {
            const stage = stageId(request);
            if (stage === "tune.propose") {
              sourceAtPropose.push((await readFile(join(request.cwd, "kernel.py"), "utf8")).trim());
              const path = validationPath(request);
              await mkdir(dirname(path), { recursive: true });
              await writeFile(path, JSON.stringify({
                strategies: [
                  { id: "slot-0", bottleneck: "memory", technique: "warp", rationale: "test", predicted_speedup: 1.1, risk_level: "low" },
                  { id: "slot-1", bottleneck: "compute", technique: "tile", rationale: "test", predicted_speedup: 1.2, risk_level: "medium" },
                ],
              }));
            } else if (stage === "tune.race.implement") {
              const slot = await strategySlot(request);
              const iteration = iterationOf(request);
              await writeFile(join(request.cwd, "kernel.py"), `kernel-${iteration}-${slot}\n`);
            } else if (stage === "tune.race.bench") {
              const slot = await strategySlot(request);
              const iteration = iterationOf(request);
              const best = iteration < 2
                ? slot === 0 ? 4 : 9
                : slot === 0 ? 10 : 12;
              const path = validationPath(request);
              await mkdir(dirname(path), { recursive: true });
              const payload = iteration === 0 && slot === 0
                ? {
                  decision: "BLOCKED",
                  block_scope: "iteration",
                }
                : {
                  decision: "KEEP",
                  benchmark: {
                    name: "tflops",
                    unit: "TFLOP/s",
                    direction: "higher",
                    samples: [best],
                    best,
                    median: best,
                    runs: 1,
                    warmup: 0,
                  },
                };
              await writeFile(path, JSON.stringify(payload));
            }
            return {
              sessionId: `${stage}-${invocationId(request).replaceAll("/", "-")}`,
              transcriptPath: `/tmp/loop-race-${stage}.jsonl`,
              text: `${stage}:${invocationId(request)}`,
              continuation: continuation(`${stage}-${invocationId(request).replaceAll("/", "-")}`),
            };
          }),
          })),
          Effect.provideService(Logging, loggingService(session.log, session.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      if (Exit.isFailure(outcome)) {
        throw new Error(Cause.pretty(outcome.cause));
      }

      // The tied second winner is admitted as evidence but cannot overwrite
      // the incumbent. A later strict improvement can be carried normally.
      const selectionPath = join(session.runDir, "eval-metrics", "selection.jsonl");
      const records = (await readFile(selectionPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as {
        outcome: string; winnerKey?: string; carrying?: { kind: string; reason?: string };
      });
      expect(records).toHaveLength(3);
      expect(records.map((record) => record.outcome)).toEqual(["carried", "no-winner", "carried"]);
      expect(records.map((record) => record.carrying?.kind)).toEqual([
        "delta-applied",
        "admitted-not-carried",
        "delta-applied",
      ]);
      const [first, second, third] = records;
      expect(first?.winnerKey).toContain("iter-0");
      expect(first?.winnerKey).toContain("slot-1");
      expect(second?.winnerKey).toContain("iter-1");
      expect(second?.winnerKey).toContain("slot-1");
      expect(second?.carrying?.reason).toContain("did not improve incumbent 9");
      expect(third?.winnerKey).toContain("iter-2");
      expect(third?.winnerKey).toContain("slot-1");

      // Ordering: the shared source was still the baseline entering iteration 0
      // and already held iteration 0's carried winner entering iteration 1.
      expect(sourceAtPropose).toEqual(["baseline", "kernel-0-1", "kernel-0-1"]);
      expect(outcome.value.stages.filter((stage) => stage.stageId === "tune.race.bench")).toHaveLength(6);
      const sourceKernel = await readFile(join(root, "kernel.py"), "utf8");
      expect(sourceKernel.trim()).toBe("kernel-2-1");

      // Every iteration's slots were cleaned at their region exit, not left for
      // run end.
      for (const stage of outcome.value.stages.filter((candidate) => candidate.workspace.kind === "map-slot")) {
        await expect(stat(stage.workspace.recordPath!)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(stat(stage.workspace.cwd)).rejects.toMatchObject({ code: "ENOENT" });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the exact nested exit metric, carries into the direct parent, and cleans only that region", async () => {
    const workflow = `version: 3
workflow:
  name: nested-metric-races
  nodes:
    - stage:
        name: propose
        worker: triton-idea
        from: []
    - tournament:
        name: outer
        from: [propose]
        over: propose.strategies
        count: 2
        entry: seed-a
        exit: race-b
        nodes:
          - stage:
              name: seed-a
              worker: triton-idea
              from: []
          - tournament:
              name: race-a
              from: [seed-a]
              over: seed-a.strategies
              count: 2
              entry: implement-a
              exit: bench-a
              nodes:
                - stage:
                    name: implement-a
                    worker: basic
                    from: []
                - stage:
                    name: bench-a
                    worker: triton-benchmark-store
                    from: [implement-a]
          - stage:
              name: seed-b
              worker: triton-idea
              from: [race-a]
          - tournament:
              name: race-b
              from: [seed-b]
              over: seed-b.strategies
              count: 2
              entry: implement-b
              exit: bench-b
              nodes:
                - stage:
                    name: implement-b
                    worker: basic
                    from: []
                - stage:
                    name: bench-b
                    worker: triton-benchmark-store
                    from: [implement-b]
`;
    const root = await mkdtemp(join(tmpdir(), "piano-nested-metric-races-"));
    try {
      await writeFile(join(root, "nested.yml"), workflow);
      await writeFile(join(root, "kernel.py"), "baseline\n");
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(join(root, "state", "current-best.py"), "baseline\n");
      await writeFile(join(root, "state", "tuning-state.json"), JSON.stringify({
        current_best: { path: "state/current-best.py", metric: { name: "tflops", best: 1, direction: "higher" } },
        history: [],
      }));
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "nested.yml"),
        runDir: session.runDir,
        runId: "nested-metric-races",
        cwd: root,
        prompt: "pick by the final nested race",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          const stage = stageId(request);
          const invocation = invocationId(request);
          if (stage === "propose" || stage === "outer.seed-a" || stage === "outer.seed-b") {
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              strategies: Array.from({ length: 2 }, (_, index) => ({
                id: `slot-${index}`,
                bottleneck: "memory",
                technique: `candidate-${index}`,
                rationale: "test",
                predicted_speedup: 1.1 + index / 10,
                risk_level: "low",
              })),
            }));
          } else if (stage === "outer.race-a.implement-a") {
            const outerSlot = Number(/outer\/slot-(\d+)/.exec(invocation)?.[1]);
            const innerSlot = Number(/race-a\/slot-(\d+)/.exec(invocation)?.[1]);
            await writeFile(join(request.cwd, "decoy.txt"), `outer-${outerSlot}-race-a-${innerSlot}\n`);
          } else if (stage === "outer.race-b.implement-b") {
            const outerSlot = Number(/outer\/slot-(\d+)/.exec(invocation)?.[1]);
            const innerSlot = Number(/race-b\/slot-(\d+)/.exec(invocation)?.[1]);
            await writeFile(join(request.cwd, "kernel.py"), `outer-${outerSlot}-race-b-${innerSlot}\n`);
          }
          if (stage === "outer.race-a.bench-a" || stage === "outer.race-b.bench-b") {
            const outerSlot = Number(/outer\/slot-(\d+)/.exec(invocation)?.[1]);
            const region = stage.includes("race-a") ? "race-a" : "race-b";
            const innerSlot = Number(new RegExp(`${region}\\/slot-(\\d+)`).exec(invocation)?.[1]);
            // race-a favours outer slot 0, while the actual outer exit race-b
            // favours outer slot 1. Reading any map exit globally picks wrong.
            const best = region === "race-a"
              ? (outerSlot === 0 ? 10 : 1) + innerSlot
              : (outerSlot === 0 ? 20 : 30) + innerSlot;
            const path = validationPath(request);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify({
              iteration: 0,
              decision: "KEEP",
              candidate: { path: "kernel.py" },
              current_best: { path: "state/current-best.py" },
              verification: { compile_passed: true, verify_passed: true },
              benchmark: { name: "tflops", unit: "TFLOP/s", direction: "higher", samples: [best], best, median: best, runs: 1, warmup: 0 },
              promotion: { promoted: true, resulting_best: { path: "state/current-best.py" }, reason: "faster" },
              records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
            }));
          }
          const id = `${stage}-${invocation.replaceAll("/", "-")}`;
          return { sessionId: id, transcriptPath: `/tmp/${id}.jsonl`, text: id, continuation: continuation(id) };
        }),
      }));

      const outerStages = result.stages.filter((stage) => stage.stageId === "outer.seed-a");
      expect(outerStages).toHaveLength(2);
      const outerCwds = new Set(outerStages.map((stage) => stage.workspace.cwd));
      // Inner winners are clean worktrees of the run's store: git fast-forwards
      // each one into its direct parent slot, and the outer winner — a store
      // worktree of the non-Git root — has its delta applied into the root.
      // Neither route runs a worker turn.
      expect(calls.some((call) => stageId(call).startsWith("$consolidate/"))).toBe(false);
      expect(outerCwds.size).toBe(2);

      await expect(readFile(join(root, "kernel.py"), "utf8")).resolves.toBe("outer-1-race-b-1\n");
      expect(result.terminalStages).toHaveLength(1);
      expect(result.terminalStages[0]).toMatchObject({
        stageId: "outer.race-b.bench-b",
        instanceId: "outer/slot-1/outer.race-b/slot-1",
      });

      const selections = (await readFile(join(session.runDir, "eval-metrics", "selection.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as {
          winnerKey?: string;
          carrying?: { kind?: string };
        });
      expect(selections).toContainEqual(expect.objectContaining({
        winnerKey: "job-1/outer/slot-1",
        carrying: expect.objectContaining({ kind: "delta-applied" }),
      }));
      const innerMerges = selections.filter((selection) =>
        selection.winnerKey?.includes("/outer.race-a/") === true
        || selection.winnerKey?.includes("/outer.race-b/") === true);
      expect(innerMerges).toHaveLength(4);
      for (const selection of innerMerges) {
        expect(selection.carrying).toMatchObject({ kind: "git-merged" });
      }
      const records = new Map(result.stages
        .filter((stage) => stage.workspace.recordPath !== undefined)
        .map((stage) => [stage.workspace.recordPath!, stage.workspace.cwd]));
      for (const [recordPath, cwd] of records) {
        await expect(stat(recordPath)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(stat(cwd)).rejects.toMatchObject({ code: "ENOENT" });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to schedule a tournament whose deciding exit contract declares 2+ metrics (§4.2/§4.3)", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-multi-metric-exit-"));
    try {
      const session = await testSession(root);
      const workerDir = join(root, "recipes", "racer");
      await mkdir(workerDir, { recursive: true });
      const workflowPath = join(root, "race.yml");
      await writeFile(workflowPath, `version: 3
workflow:
  name: multi-metric-race
  nodes:
    - stage:
        name: propose
        worker: racer
        from: []
    - tournament:
        name: race
        from: [propose]
        over: propose.strategies
        count: 2
        entry: implement
        exit: bench
        nodes:
          - stage:
              name: implement
              worker: racer
              from: []
          - stage:
              name: bench
              worker: racer
              from: [implement]
`);
      // A competing exit whose contract declares two benchmark metrics cannot be
      // ordered by a single referee: refusing to begin is a load error.
      await writeWorkerContract(workerDir, JSON.stringify({
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
        example: {},
        outputs: { metrics: [
          { pointer: "/latency", format: "benchmark/v1", required: false },
          { pointer: "/throughput", format: "benchmark/v1", required: false },
        ] },
      }));

      const runs: string[] = [];
      const exit = await Effect.runPromiseExit(
        loadWorkflow(workflowPath, root, root).pipe(
          Effect.flatMap((loaded) => executeWorkflow(loaded, {
            runDir: session.runDir,
            runId: "multi-metric-race",
            cwd: root,
            prompt: "race two kernels",
            agentRunner: (request) => Effect.promise(async () => {
              runs.push(stageId(request));
              return {
                sessionId: `${stageId(request)}-session`,
                transcriptPath: `/tmp/multi-metric-race-${stageId(request)}.jsonl`,
                text: stageId(request),
                continuation: continuation(`${stageId(request)}-continuation`),
              };
            }),
          })),
        ).pipe(
          Effect.provideService(Logging, loggingService(session.log, session.trace)),
          Effect.provide(NodeFileSystem.layer),
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      // The arity guard fires before any worker runs.
      expect(runs).toEqual([]);
      if (Exit.isFailure(exit)) {
        const message = String(exit.cause);
        expect(message).toContain("declares 2 output metric");
        expect(message).toContain('worker "racer"');
        expect(message).toContain("/latency");
        expect(message).toContain("/throughput");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe(" stage sign-off", () => {
  const SIGNOFF_WORKFLOW = BASIC_WORKFLOW.replace(
    "        from: []\n",
    "        signoff: true\n        from: []\n",
  );

  it("publishes an accepted attempt only after the reviewer approves", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-signoff-approve-"));
    try {
      await writeFile(join(root, "signoff.yml"), SIGNOFF_WORKFLOW);
      const session = await testSession(root);
      const asked: WorkflowSignoffRequest[] = [];
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "signoff.yml"),
        runDir: session.runDir,
        runId: "signoff-approve",
        cwd: root,
        prompt: "answer once",
        agentRunner: () => Effect.promise(async () => ({
          sessionId: "signoff-session",
          transcriptPath: "/tmp/signoff-session.jsonl",
          text: "the answer is 42",
          continuation: continuation("signoff-session"),
        })),
        signoff: (request) => Effect.sync(() => {
          asked.push(request);
          return { type: "continue" } as const;
        }),
      }));
      expect(asked).toHaveLength(1);
      expect(asked[0]?.stageId).toBe("respond");
      expect(asked[0]?.worker).toBe("basic");
      expect(asked[0]?.harness).toBe("pi");
      expect(asked[0]?.round).toBe(1);
      expect(asked[0]?.transcriptPath).toBe("/tmp/signoff-session.jsonl");
      expect(asked[0]?.excerpt).toContain("the answer is 42");
      expect(result.text).toBe("the answer is 42");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resumes the same actor with the reviewer's note after a retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-signoff-reject-"));
    try {
      await writeFile(join(root, "signoff.yml"), SIGNOFF_WORKFLOW);
      const session = await testSession(root);
      const prompts: string[] = [];
      const continuations: (AgentRequest["continuation"])[] = [];
      let decisions = 0;
      const exit = await Effect.runPromiseExit(loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "signoff.yml"),
        runDir: session.runDir,
        runId: "signoff-reject",
        cwd: root,
        prompt: "draft it",
        agentRunner: (request) => Effect.promise(async () => {
          prompts.push(request.prompt);
          continuations.push(request.continuation);
          return {
            sessionId: "signoff-actor",
            transcriptPath: "/tmp/signoff-actor.jsonl",
            text: `draft v${prompts.length}`,
            continuation: continuation("signoff-actor"),
          };
        }),
        signoff: () => Effect.sync(() => {
          decisions += 1;
          return decisions === 1
            ? { type: "retry", note: "add a test for the parser" }
            : { type: "continue" } as const;
        }),
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) expect(exit.value.text).toBe("draft v2");
      expect(prompts).toHaveLength(2);
      // The first turn carries no retry section; the reviewer's note reaches
      // the same actor session as a follow-up message.
      expect(prompts[0]).not.toContain("## Sign-off retry");
      expect(prompts[1]).toContain("## Sign-off retry");
      expect(prompts[1]).toContain("Reviewer note: add a test for the parser");
      expect(continuations[0]).toBeUndefined();
      expect(continuations[1]).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails up front when a sign-off stage has no sign-off channel", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-signoff-no-channel-"));
    try {
      await writeFile(join(root, "signoff.yml"), SIGNOFF_WORKFLOW);
      const session = await testSession(root);
      let workerRuns = 0;
      const exit = await Effect.runPromiseExit(loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "signoff.yml"),
        runDir: session.runDir,
        runId: "signoff-no-channel",
        cwd: root,
        prompt: "answer once",
        agentRunner: () => Effect.promise(async () => {
          workerRuns += 1;
          return {
            sessionId: "signoff-session",
            transcriptPath: "/tmp/signoff-session.jsonl",
            text: "done",
            continuation: continuation("signoff-session"),
          };
        }),
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain("no sign-off channel");
      // The up-front guard fires before any stage runs.
      expect(workerRuns).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails the stage when the reviewer cancels the sign-off", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-signoff-cancel-"));
    try {
      await writeFile(join(root, "signoff.yml"), SIGNOFF_WORKFLOW);
      const session = await testSession(root);
      let workerRuns = 0;
      const exit = await Effect.runPromiseExit(loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "signoff.yml"),
        runDir: session.runDir,
        runId: "signoff-cancel",
        cwd: root,
        prompt: "answer once",
        agentRunner: () => Effect.promise(async () => {
          workerRuns += 1;
          return {
            sessionId: "signoff-session",
            transcriptPath: "/tmp/signoff-session.jsonl",
            text: "done",
            continuation: continuation("signoff-session"),
          };
        }),
        signoff: () => Effect.fail(new WorkflowError({
          phase: "schedule",
          path: "respond",
          message: "sign-off review was cancelled",
        })),
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain("sign-off review was cancelled");
      // The attempt did run; only its publication was declined.
      expect(workerRuns).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("loop auto-commit", () => {
  const execFileAsync = promisify(execFile);

  const LOOP_WORKFLOW = `version: 3
workflow:
  name: loop-commit
  nodes:
    - loop:
        name: tune
        from: []
        feedback: measure
        entry: implement
        exit: measure
        iterations: 3
        nodes:
          - stage:
              name: implement
              worker: test-implement
              from: []
          - stage:
              name: measure
              worker: test-round
              from: [implement]
    - stage:
        name: summary
        worker: test-summary
        from: [tune]
`;

  const LOOP_ONLY_WORKFLOW = LOOP_WORKFLOW.replace(
    `    - stage:
        name: summary
        worker: test-summary
        from: [tune]
`,
    "",
  );

  /** A real git repo workspace: one initial commit, one pre-existing tracked
   * modification, one already-staged addition, and one pre-existing untracked
   * file. Loop commits must never sweep any of that pre-existing dirt into a
   * commit. */
  async function initRepo(root: string): Promise<string> {
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    await execFileAsync("git", ["-C", repo, "init", "-b", "main"], { encoding: "utf8" });
    await execFileAsync("git", ["-C", repo, "config", "user.name", "Test Agent"], { encoding: "utf8" });
    await execFileAsync("git", ["-C", repo, "config", "user.email", "agent@test.local"], { encoding: "utf8" });
    await writeFile(join(repo, "seed.py"), "seed\n");
    await execFileAsync("git", ["-C", repo, "add", "seed.py"], { encoding: "utf8" });
    await execFileAsync("git", ["-C", repo, "commit", "-m", "initial"], { encoding: "utf8" });
    await writeFile(join(repo, "seed.py"), "seed changed before the run\n");
    await writeFile(join(repo, "user-preexisting.md"), "user work\n");
    // A pre-existing change already in the index: a bare `git commit` would
    // sweep it into the first loop commit even though the scan excludes it.
    await writeFile(join(repo, "pre-staged.md"), "staged before the run\n");
    await execFileAsync("git", ["-C", repo, "add", "pre-staged.md"], { encoding: "utf8" });
    return repo;
  }

  async function gitLog(repo: string): Promise<string> {
    const result = await execFileAsync("git", ["-C", repo, "log", "--format=%s", "--name-only"], { encoding: "utf8" });
    return result.stdout;
  }

  /** Full commit hashes, newest first. */
  async function gitHashes(repo: string): Promise<readonly string[]> {
    const result = await execFileAsync("git", ["-C", repo, "log", "--format=%H"], { encoding: "utf8" });
    return result.stdout.trim().split("\n");
  }

  async function readRunLog(session: Awaited<ReturnType<typeof testSession>>): Promise<string> {
    return readFile(join(session.runDir, "system-log", "log.jsonl"), "utf8");
  }

  /** Mock agentRunner for the tune loop: implement writes a kernel file and an
   * agent memory document; measure decides KEEP on even rounds and DISCARD on
   * odd rounds; summary writes the progress-record file. */
  function tuneRunner(repo: string): AgentRunner {
    return (request) => Effect.promise(async () => {
      const stage = stageId(request);
      const path = validationPath(request);
      await mkdir(dirname(path), { recursive: true });
      if (stage === "tune.implement") {
        const iteration = iterationOf(request);
        await writeFile(join(repo, `kernel-r${iteration}.cc`), `// r${iteration}\n`);
        // The agent's own memory document: never named in the result payload,
        // but it must ride in the iteration's commit.
        await writeFile(join(repo, "MEMORY.md"), `# memory\niteration ${iteration}\n`);
        await writeFile(path, JSON.stringify({
          status: "compiled",
          variable: `var-${iteration}`,
          diff_summary: `applied change ${iteration}`,
          // A stale commit-only field from the removed projection: it must
          // never control what is staged.
          changed_files: ["declared-but-not-committed.cc"],
          compile: { passed: true, target: "gemm", so_commit: "abc123" },
        }));
      } else if (stage === "tune.measure") {
        const iteration = iterationOf(request);
        const keep = iteration % 2 === 0;
        await writeFile(path, JSON.stringify({
          iteration,
          variable: `var-${iteration}`,
          hypothesis: `hide DTE wait for variable ${iteration}`,
          decision: keep ? "KEEP" : "DISCARD",
          candidate: { path: `kernel-r${iteration}.cc` },
          current_best: { path: "state/current-best.py" },
          verification: { compile_passed: true, verify_passed: true },
          profile: { kernel_latency_us: 158.5 + iteration, llc_rw_sum_gbps: 2588.51 },
          regression_pp: keep ? 1.5 : -0.5,
          promotion: keep
            ? { promoted: true, resulting_best: { path: `kernel-r${iteration}.cc` }, reason: "improved" }
            : { promoted: false, resulting_best: { path: "state/current-best.py" }, reason: "regressed" },
          next_variable: "next",
          records: {
            round_path: `rounds/iter-${String(iteration).padStart(3, "0")}.json`,
            state_path: "state/tuning-state.json",
          },
        }));
      } else if (stage === "summary") {
        const progressFile = "tests/unit/regression_test.cc";
        await mkdir(dirname(join(repo, progressFile)), { recursive: true });
        await writeFile(join(repo, progressFile), "// header\nR8: iter-2 winner\n");
        await writeFile(path, JSON.stringify({
          run_id: "loop-commit-run",
          summary: "target met",
          outcome: "improved",
          winner: "iter-2",
          progress_record: {
            file_path: progressFile,
            current_status: "stable",
            entry: "R8: iter-2 winner KEEP 158.50us / 2588.51 GB/s | evidence: loop-commit-run | next: none",
          },
        }));
      } else {
        throw new Error(`unexpected stage: ${stage}`);
      }
      return {
        sessionId: `${stage}-session`,
        transcriptPath: `/tmp/${stage}.jsonl`,
        text: stage,
        continuation: continuation(`${stage}-session`),
      };
    });
  }

  it("commits every loop iteration, KEEP or DISCARD, including agent-written memory", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-loop-commit-"));
    try {
      await writeFile(join(root, "loop.yml"), LOOP_WORKFLOW);
      const repo = await initRepo(root);
      const session = await testSession(root);
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "loop.yml"),
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        runDir: session.runDir,
        runId: "loop-commit",
        cwd: repo,
        prompt: "tune gemm TR-1234",
        agentRunner: tuneRunner(repo),
      }));

      // The loop really mixed decisions: iteration 1 was a DISCARD and still
      // committed. The removed workspace.changed-files projection is gone
      // from the accepted results.
      expect(result.stages
        .filter((stage) => stage.stageId === "tune.measure")
        .map((stage) => stage.projections?.find((projection) => projection.id === "round.decision")?.value))
        .toEqual(["KEEP", "DISCARD", "KEEP"]);
      const implementation = result.stages.find((stage) => stage.stageId === "tune.implement");
      expect(implementation?.projections?.some((projection) => projection.id === "workspace.changed-files")).toBe(false);

      const hashes = await gitHashes(repo);
      // Initial + one commit for each of the three iterations. The summary
      // stage is outside the loop, so it does not commit.
      expect(hashes).toHaveLength(4);
      const log = await gitLog(repo);
      expect(log).toContain("kernel-r0.cc");
      expect(log).toContain("kernel-r1.cc");
      expect(log).toContain("kernel-r2.cc");
      // Every commit uses the neutral loop template, including the DISCARD
      // rounds. The message names the loop itself, not a tuning projection.
      expect(log).toContain("[Feature](TR-1234): tune R0");
      expect(log).toContain("[Feature](TR-1234): tune R1");
      expect(log).toContain("[Feature](TR-1234): tune R2");
      // Memory written by the agent rides in the commit even though the
      // result payload never names it.
      expect(log).toContain("MEMORY.md");
      // Stale commit-only projection data is ignored: the workspace is the
      // source of truth for what gets staged.
      expect(log).not.toContain("declared-but-not-committed.cc");
      // Pre-existing tracked and untracked changes are never swept in. (The
      // initial commit legitimately contains seed.py, so inspect only the
      // loop commits' changed files.)
      expect(log).not.toContain("user-preexisting.md");
      expect(log).not.toContain("pre-staged.md");
      const stagedAfter = await execFileAsync("git", ["-C", repo, "diff", "--cached", "--name-only"], { encoding: "utf8" });
      expect(stagedAfter.stdout).toContain("pre-staged.md");
      const loopChanges = await execFileAsync("git", ["-C", repo, "diff", "--name-only", "HEAD~3", "HEAD"], { encoding: "utf8" });
      expect(loopChanges.stdout).not.toContain("seed.py");
      expect(loopChanges.stdout).not.toContain("user-preexisting.md");
      expect(await readFile(join(repo, "seed.py"), "utf8")).toBe("seed changed before the run\n");
      // The summary stage's progress record is outside the loop and stays
      // uncommitted: only loops commit.
      expect(log).not.toContain("tests/unit/regression_test.cc");
      const porcelain = await execFileAsync("git", ["-C", repo, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" });
      expect(porcelain.stdout).toContain("tests/unit/regression_test.cc");

      // The latest loop commit carries the neutral loop message: region,
      // iteration, and changed-file count. Tuning projections have no shipped
      // producer, so none of their values may leak into the message.
      const message = (await execFileAsync("git", ["-C", repo, "log", "-1", "--format=%B"], { encoding: "utf8" })).stdout;
      expect(message).toContain("Root Cause:");
      expect(message).toContain('loop "tune" iteration 2 completed');
      expect(message).toContain("Solution:");
      expect(message).toContain('commit 2 changed files after loop "tune" iteration 2');
      expect(message).toContain("Fix status:");
      expect(message).toContain("done");
      expect(message).not.toContain("hide DTE wait");
      expect(message).not.toContain("applied change");
      expect(message).not.toContain("160.50us");

      // The loop's region-finalized evidence records every iteration's commit.
      const after = await readRunStatusFile(session.runDir);
      expect(after.jobs.at(-1)?.regions?.tune?.commits).toEqual([
        { iteration: 0, commit: hashes[2] },
        { iteration: 1, commit: hashes[1] },
        { iteration: 2, commit: hashes[0] },
      ]);
      const runLog = await readRunLog(session);
      expect(runLog).toContain('"event":"auto.commit.committed"');
      expect(runLog).not.toContain('"event":"auto.commit.failed"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips the commit in a non-git workspace with an explicit reason", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-loop-commit-nogit-"));
    try {
      await writeFile(join(root, "loop.yml"), LOOP_ONLY_WORKFLOW.replace("        iterations: 3", "        iterations: 2"));
      const session = await testSession(root);
      await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "loop.yml"),
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        runDir: session.runDir,
        runId: "loop-commit-nogit",
        cwd: root,
        prompt: "tune gemm",
        agentRunner: tuneRunner(root),
      }));
      // The agent's files stay in the non-git workspace; there is no commit
      // target, so the run completes without inventing one.
      await expect(readFile(join(root, "kernel-r0.cc"), "utf8")).resolves.toBe("// r0\n");
      const runLog = await readRunLog(session);
      expect(runLog).toContain('"event":"auto.commit.skipped"');
      expect(runLog).toContain('"reason":"not-a-git-worktree"');
      expect(runLog).not.toContain('"event":"auto.commit.failed"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("logs a no-changes skip when an iteration leaves the workspace clean", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-loop-commit-clean-"));
    try {
      await writeFile(join(root, "loop.yml"), LOOP_ONLY_WORKFLOW.replace("        iterations: 3", "        iterations: 2"));
      const repo = await initRepo(root);
      const session = await testSession(root);
      await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "loop.yml"),
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        runDir: session.runDir,
        runId: "loop-commit-clean",
        cwd: repo,
        prompt: "tune gemm",
        agentRunner: (request) => Effect.promise(async () => {
          const stage = stageId(request);
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          if (stage === "tune.implement") {
            await writeFile(path, JSON.stringify({ status: "compiled" }));
          } else if (stage === "tune.measure") {
            await writeFile(path, JSON.stringify({ decision: "DISCARD" }));
          } else {
            throw new Error(`unexpected stage: ${stage}`);
          }
          return {
            sessionId: `${stage}-session`,
            transcriptPath: `/tmp/${stage}.jsonl`,
            text: stage,
            continuation: continuation(`${stage}-session`),
          };
        }),
      }));
      expect(await gitHashes(repo)).toHaveLength(1);
      const runLog = await readRunLog(session);
      expect(runLog.match(/"reason":"no-changes"/gu)).toHaveLength(2);
      expect(runLog).not.toContain('"event":"auto.commit.failed"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails the run after three rejected commit attempts", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-loop-commit-reject-"));
    try {
      await writeFile(join(root, "loop.yml"), LOOP_ONLY_WORKFLOW.replace("        iterations: 3", "        iterations: 1"));
      const repo = await initRepo(root);
      const hookDir = join(root, "hooks");
      await mkdir(hookDir, { recursive: true });
      const attemptsFile = join(root, "commit-attempts.log");
      await writeFile(
        join(hookDir, "commit-msg"),
        `#!/bin/sh\nprintf 'attempt\\n' >> ${JSON.stringify(attemptsFile)}\necho REJECTED-BY-HOOK: bad ticket >&2\nexit 1\n`,
        { mode: 0o755 },
      );
      await execFileAsync("git", ["-C", repo, "config", "core.hooksPath", hookDir], { encoding: "utf8" });
      const session = await testSession(root);
      const exit = await Effect.runPromiseExit(loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "loop.yml"),
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        runDir: session.runDir,
        runId: "loop-commit-reject",
        cwd: repo,
        prompt: "tune gemm, no ticket in mission",
        agentRunner: tuneRunner(repo),
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));

      expect(Exit.isFailure(exit)).toBe(true);
      if (!Exit.isFailure(exit)) throw new Error("expected the run to fail");
      const failure = Cause.pretty(exit.cause);
      expect(failure).toContain("loop auto-commit failed after 3 attempts");
      expect(failure).toContain("REJECTED-BY-HOOK");
      // Exactly one initial attempt plus two retries.
      expect((await readFile(attemptsFile, "utf8")).trim().split("\n")).toHaveLength(3);
      // A rejected commit leaves NOTHING staged — otherwise a later round's
      // `git checkout -- <file>` revert would restore the staged candidate
      // content instead of HEAD (silently corrupting tuning state).
      const staged = await execFileAsync("git", ["-C", repo, "diff", "--cached", "--name-only"], { encoding: "utf8" });
      // The pre-existing staged addition is not ours to unstage; the failed
      // attempt must leave only that entry in the index.
      expect(staged.stdout.trim()).toBe("pre-staged.md");
      const commits = await execFileAsync("git", ["-C", repo, "log", "--oneline"], { encoding: "utf8" });
      expect(commits.stdout.trim().split("\n")).toHaveLength(1);
      const runLog = await readRunLog(session);
      expect(runLog).toContain('"event":"auto.commit.retrying"');
      expect(runLog).toContain('"event":"auto.commit.failed"');
      expect(runLog).toContain("REJECTED-BY-HOOK");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to a generic loop message when the iteration has no projections", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-loop-commit-generic-"));
    try {
      await writeFile(join(root, "loop.yml"), `version: 3
workflow:
  name: generic-loop
  nodes:
    - loop:
        name: polish
        from: []
        entry: draft
        exit: draft
        iterations: 1
        nodes:
          - stage:
              name: draft
              worker: test-text
              from: []
`);
      const repo = await initRepo(root);
      const session = await testSession(root);
      await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "loop.yml"),
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        runDir: session.runDir,
        runId: "loop-commit-generic",
        cwd: repo,
        prompt: "draft once",
        agentRunner: (request) => Effect.promise(async () => {
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(join(repo, "notes.txt"), "draft 0\n");
          await writeFile(path, JSON.stringify({ text: "drafted" }));
          return {
            sessionId: "draft-session",
            transcriptPath: "/tmp/draft.jsonl",
            text: "drafted",
            continuation: continuation("draft-session"),
          };
        }),
      }));
      const log = await gitLog(repo);
      expect(log).toContain("notes.txt");
      const message = (await execFileAsync("git", ["-C", repo, "log", "-1", "--format=%B"], { encoding: "utf8" })).stdout;
      expect(message).toContain("[Feature](no-ticket): polish R0");
      expect(message).toContain('loop "polish" iteration 0 completed');
      expect(message).toContain('commit 1 changed file after loop "polish" iteration 0');
      expect(message).toContain("not reported");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("commits deletions, renames, and literal paths while leaving pre-existing dirt alone", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-loop-commit-statuses-"));
    try {
      await writeFile(join(root, "loop.yml"), LOOP_ONLY_WORKFLOW.replace("        iterations: 3", "        iterations: 1"));
      const repo = join(root, "repo");
      await mkdir(repo, { recursive: true });
      const git = (...args: string[]) => execFileAsync("git", ["-C", repo, ...args], { encoding: "utf8" });
      await git("init", "-q", "-b", "main");
      await git("config", "user.name", "Test Agent");
      await git("config", "user.email", "agent@test.local");
      await writeFile(join(repo, "seed.txt"), "seed\n");
      await writeFile(join(repo, "delete-me.txt"), "delete\n");
      await writeFile(join(repo, "rename-me.txt"), "rename\n");
      await git("add", "seed.txt", "delete-me.txt", "rename-me.txt");
      await git("commit", "-qm", "initial");

      // Pre-existing dirt, including a path whose leading/trailing spaces a
      // trim would corrupt, plus a pre-staged addition. Neither may enter the
      // loop commit.
      const preExistingSpacey = "  preexisting notes.md  ";
      await writeFile(join(repo, preExistingSpacey), "user work\n");
      await writeFile(join(repo, "pre-staged.md"), "staged before the run\n");
      await git("add", "pre-staged.md");

      const literalPath = "weird[1]*?.txt";
      const agentSpacey = "agent notes.md";
      const session = await testSession(root);
      await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "loop.yml"),
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        runDir: session.runDir,
        runId: "loop-commit-statuses",
        cwd: repo,
        prompt: "tune gemm",
        agentRunner: (request) => Effect.promise(async () => {
          const stage = stageId(request);
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          if (stage === "tune.implement") {
            // A staged deletion and a staged rename, the two porcelain shapes
            // that a naive `git add -- <path>` would fail on.
            await git("rm", "-q", "delete-me.txt");
            await git("mv", "rename-me.txt", "renamed.txt");
            // Pathspec metacharacters and a spaced name must be literal.
            await writeFile(join(repo, literalPath), "literal\n");
            await writeFile(join(repo, agentSpacey), "notes\n");
            await writeFile(path, JSON.stringify({ status: "compiled" }));
          } else if (stage === "tune.measure") {
            await writeFile(path, JSON.stringify({ decision: "DISCARD" }));
          } else {
            throw new Error(`unexpected stage: ${stage}`);
          }
          return {
            sessionId: `${stage}-session`,
            transcriptPath: `/tmp/${stage}.jsonl`,
            text: stage,
            continuation: continuation(`${stage}-session`),
          };
        }),
      }));

      expect(await gitHashes(repo)).toHaveLength(2);
      const committed = (await git("log", "-1", "--format=", "--name-status")).stdout;
      expect(committed).toMatch(/^D\tdelete-me\.txt$/mu);
      expect(committed).toMatch(/^R100\trename-me\.txt\trenamed\.txt$/mu);
      expect(committed).toMatch(/^A\tweird\[1\]\*\?\.txt$/mu);
      expect(committed).toMatch(/^A\tagent notes\.md$/mu);
      expect(committed).not.toContain("pre-staged.md");
      expect(committed).not.toContain("preexisting notes.md");
      // The pre-existing staged addition is untouched and still staged.
      const staged = await git("diff", "--cached", "--name-only");
      expect(staged.stdout).toBe("pre-staged.md\n");
      // The spaced pre-existing path survives byte-for-byte and stays
      // untracked; a trimmed path would not match this entry.
      const status = await git("status", "--porcelain=v1", "-z", "--untracked-files=all");
      expect(status.stdout).toContain(`?? ${preExistingSpacey}\0`);
      await expect(readFile(join(repo, preExistingSpacey), "utf8")).resolves.toBe("user work\n");
      const message = (await git("log", "-1", "--format=%B")).stdout;
      expect(message).toContain("[Feature](no-ticket): tune R0");
      expect(message).toContain('commit 4 changed files after loop "tune" iteration 0');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("commits under a fallback identity when the repository configures none", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-loop-commit-identity-"));
    const savedEnv = {
      GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
      GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM,
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL,
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME,
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL,
      EMAIL: process.env.EMAIL,
    };
    try {
      await writeFile(join(root, "loop.yml"), LOOP_ONLY_WORKFLOW.replace("        iterations: 3", "        iterations: 1"));
      const repo = join(root, "repo");
      await mkdir(repo, { recursive: true });
      const git = (...args: string[]) => execFileAsync("git", ["-C", repo, ...args], { encoding: "utf8" });
      await git("init", "-q", "-b", "main");
      await writeFile(join(repo, "seed.txt"), "seed\n");
      await git("add", "seed.txt");
      // The seed commit is setup; the loop commit is the one under test.
      await git("-c", "user.name=Setup", "-c", "user.email=setup@test.local", "commit", "-qm", "initial");
      // Remove every ambient identity so only the orchestrator's fallback can
      // author the loop commit.
      process.env.GIT_CONFIG_GLOBAL = "/dev/null";
      process.env.GIT_CONFIG_SYSTEM = "/dev/null";
      for (const key of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "EMAIL"]) {
        delete process.env[key];
      }

      const session = await testSession(root);
      await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "loop.yml"),
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        runDir: session.runDir,
        runId: "loop-commit-identity",
        cwd: repo,
        prompt: "tune gemm",
        agentRunner: (request) => Effect.promise(async () => {
          const stage = stageId(request);
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          if (stage === "tune.implement") {
            await writeFile(join(repo, "notes.txt"), "no identity configured\n");
            await writeFile(path, JSON.stringify({ status: "compiled" }));
          } else {
            await writeFile(path, JSON.stringify({ decision: "DISCARD" }));
          }
          return {
            sessionId: `${stage}-session`,
            transcriptPath: `/tmp/${stage}.jsonl`,
            text: stage,
            continuation: continuation(`${stage}-session`),
          };
        }),
      }));

      expect(await gitHashes(repo)).toHaveLength(2);
      const identity = (await git("log", "-1", "--format=%an <%ae>|%cn <%ce>")).stdout.trim();
      expect(identity).toBe("Piano <piano@localhost>|Piano <piano@localhost>");
    } finally {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails the run when the workspace git status cannot be read", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-loop-commit-broken-status-"));
    try {
      await writeFile(join(root, "loop.yml"), LOOP_ONLY_WORKFLOW.replace("        iterations: 3", "        iterations: 1"));
      const repo = await initRepo(root);
      const session = await testSession(root);
      // A corrupt index makes `git status` fail while `git rev-parse` still
      // reports a worktree: the snapshot must fail the run rather than start
      // empty and sweep pre-existing changes into the first commit.
      await writeFile(join(repo, ".git", "index"), "corrupt\n");
      let workerRuns = 0;
      const exit = await Effect.runPromiseExit(loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "loop.yml"),
        recipeRepositoryRoot: WORKFLOW_RECIPE_ROOT,
        runDir: session.runDir,
        runId: "loop-commit-broken-status",
        cwd: repo,
        prompt: "tune gemm",
        agentRunner: () => {
          workerRuns += 1;
          return Effect.die(new Error("the worker must not run"));
        },
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));

      expect(Exit.isFailure(exit)).toBe(true);
      if (!Exit.isFailure(exit)) throw new Error("expected the run to fail");
      expect(Cause.pretty(exit.cause)).toContain("cannot read workspace git status");
      expect(workerRuns).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
