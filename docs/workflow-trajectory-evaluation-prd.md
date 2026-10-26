# Unified Workflow Trajectory and Evaluation — PRD

> 历史文档（2026-10-15 标记）：§13 的 `executions/...` 一行从未落盘；实际 run 目录布局以 README.md 的「Track and manage your run artifacts」一节为准（`prompts/<n>/invocations/...` + run 根下的 `actors/`）。

- Status: **Implemented**
- Date: 2026-09-02
- Scope baseline: `e4c9bd0`
- Target branch: `dev`
- Primary areas: worker recipes, workflow validation, run evidence, trajectory recording, evals
- Compatibility follow-up: GitLab issue
  [#48](http://git.enflame.cn/heng.shi/piano/-/issues/48)

## 1. Summary

Piano will replace its tuning-specific metric extraction with one workflow-wide
trajectory model.

A workflow stage is validated automatically when its worker owns a contract.
The stage's worker owns an optional declarative `recipes/contracts/<worker>.json`,
containing
the worker result JSON Schema, an accepted example, and declarations for any
metric outputs. After a worker result passes that contract, Piano projects the
declared metrics into normalized records and sends workflow observations through
`WorkflowTrajectory`, which drives a fixed collection of recorders in the same
way that a compiler pass manager drives passes.

The initial recorders are:

1. `BenchmarkRecorder` for task performance such as throughput or latency.
2. `DurationRecorder` for Piano-observed stage and attempt wall time.
3. `TokenUsageRecorder` for token consumption attributable to an invocation and
   therefore to a loop iteration.
4. `ToolCallRecorder` for tool-call count, status, and duration.

Each record pattern owns one append-only JSONL artifact. Existing
`log.jsonl`, `trace.jsonl`, `trajectory.json`, `progress.jsonl`, `progress.json`,
context inputs, result files, and harness transcripts remain intact. The new files are
additive and become the common data surface consumed by normal runs and evals.

`WorkflowEvaluator` is the generic evaluation capability. Evals keeps case
selection, queuing, independent trials, launch association, grader-owned
baseline/final benchmark, judges, history, variants, and reporting. It stops
understanding worker contract names or worker payload shapes.

## 2. Problem

### 2.1 Metrics are inferred from one GPU-specific payload shape

Before this design, evals discovered progress measurements by reaching into
`progress.jsonl` and assuming `resultPayload.benchmark.best`. This coupled the
evaluation layer to one GPU-specific payload shape, prevented custom workers
from declaring their own outputs, and made throughput/latency support
accidental rather than a general workflow capability.

### 2.2 Worker contracts were compiled into Piano source

Before this design, workflow YAML named validators that were compiled into
Piano's TypeScript source. A custom worker
can change its prompt and skills but cannot own or evolve its result contract
without changing Piano itself. The schema authority is therefore in the wrong
layer.

### 2.3 “Trajectory” currently mixes several meanings

The existing `trajectory.json` is a bounded index of agent events and prompt
turns. Evals derives token/tool/message totals from it and from transcripts. A
task performance trajectory, however, is a sequence of accepted measurements
across workflow invocations or loop iterations. Treating agent messages and
performance measurements as the same record produces ambiguous ownership and
hard-coded extraction.

### 2.4 Evals branches on a workflow category that the workflow does not need

The eval case model distinguishes `write` and `tuning`. The runtime does not need
that distinction: tuning is an ordinary workflow with a loop and one or more
workers that emit metrics. The category leaks into timeouts, evidence checks,
reports, and scoring despite providing no useful execution semantics.

### 2.5 Runs and evals do not yet share one durable metric protocol

If evals derives metrics with private assumptions, normal runs cannot later
become data-flywheel inputs without reinterpreting worker payloads. A run must
record the same normalized trajectory that evals reads.

## 3. Goals

1. Let each worker own its result contract as declarative data in its recipe.
2. Make the worker-owned contract the only new artifact needed to validate a
   worker and expose its declared metrics; contract presence selects it, with no
   workflow switch.
3. Record benchmark, duration, token, and tool-call trajectories with stable,
   versioned, invocation-level attribution.
4. Let loop metadata naturally produce iteration-indexed records without a
   tuning workflow type or a separate `metrics: true` marker.
5. Use one recording implementation for normal runs and eval runs.
6. Keep eval orchestration and independent grader measurements intact while
   replacing payload-specific extraction with trajectory evaluation.
7. Preserve existing evidence files and support historical runs through an
   explicit legacy adapter.
8. Keep user-authored contracts declarative and non-executable.
9. Use Zod only for Piano-owned runtime boundaries and normalized internal
   records.

## 4. Non-goals

1. Redesigning workflow scheduling, loop/map execution, workspace isolation,
   actor continuation, or the harness protocol.
2. Letting contracts execute TypeScript, JavaScript, Zod source, callbacks, or
   arbitrary transformations.
3. Proving that a worker-reported benchmark was honestly or correctly measured.
   Validation proves structure and declared invariants only.
4. Replacing grader-owned baseline, compile, verify, or final benchmark steps.
5. Replacing or deleting current logs, traces, transcripts, progress records,
   result files, or `trajectory.json`.
6. Introducing a separate tuning driver or a second workflow runtime.
7. Defining future GPU materialization behavior by worker name or contract ID.
   Materialization is an explicit contract-owned protocol capability; future
   work is limited to versioned protocol evolution.
8. Creating a general expression language for metric projection.

## 5. Product principles

### 5.1 Tuning is a workflow capability, not a workflow kind

A workflow becomes performance-oriented when a validated worker emits a metric.
A loop supplies `iteration` automatically. No `write`/`tuning` discriminator is
required by the workflow or evaluator.

### 5.2 The worker owns the payload; Piano owns the normalized record

The worker contract defines what the worker must write. Piano validates that unknown
payload at the worker boundary, then converts only declared outputs into
Piano-owned records. Evals reads those records and never imports concrete worker
payload types.

### 5.3 Accepted does not mean physically true

An accepted payload is trusted for shape, types, and declarative constraints. A
validated `best: 12.3` is not proof that hardware produced 12.3. The transcript,
raw evidence paths, and independent grader benchmark remain necessary evidence.

### 5.4 One record pattern, one recorder, one file

Throughput and latency share the same benchmark pattern: name, unit, direction,
samples, and summary statistics. They therefore use one `BenchmarkRecorder`,
not parallel `ThroughputRecorder` and `LatencyRecorder` classes. Separate
recorders exist only where the record lifecycle or schema differs.

### 5.5 Recording observes execution; it never drives execution

`WorkflowTrajectory` drives recorder dispatch. It does not schedule stages,
invoke workers, validate payloads, repair agents, promote candidates, or decide
workflow success.

## 6. Terminology

- **Worker contract**: `recipes/contracts/<worker>.json`, owned by one worker.
- **Accepted payload**: the worker result after JSON parsing, contract
  validation, declared metric normalization, and any preserved domain hook.
- **Workflow observation**: a normalized Piano-internal lifecycle event supplied
  to `WorkflowTrajectory`.
- **Recorder**: a component that accepts selected observations and appends one
  versioned record pattern to its own artifact.
- **Trajectory stream**: one JSONL file produced by one recorder.
- **Trajectory evaluator**: a capability that maps trajectory input to an
  evaluation result. It is an interface, not a component nested inside an
  evaluator.
- **Transcript**: the harness-owned full agent event/message history. It is not
  a task metric trajectory and is never duplicated into one.

## 7. Worker contract design

### 7.1 Location and ownership

```text
recipes/
├── contracts/
│   └── <worker>.json   # optional, worker-owned
└── <worker>/
    ├── agents.md
    └── skills/
```

Every concrete GPU worker that currently uses a built-in validator receives its
own contract file. CUDA and Triton workers may start with equivalent contracts,
but each owns an independent file and may evolve independently. The contract's
identity is its worker name; there is no manifest id or digest. New GPU workflow
execution does not take its payload schema from Piano source.

### 7.2 Manifest

```json
{
  "schema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": ["iteration", "decision", "candidate", "current_best", "verification", "promotion", "records"],
    "properties": {
      "iteration": { "type": "integer", "minimum": 0 },
      "decision": {
        "enum": ["KEEP", "DISCARD", "COMPILE_FAIL", "VERIFY_FAIL", "BLOCKED"]
      },
      "benchmark": {
        "type": "object",
        "required": ["name", "unit", "direction", "samples", "best", "median", "runs", "warmup"],
        "properties": {
          "name": { "type": "string", "minLength": 1 },
          "unit": { "type": "string", "minLength": 1 },
          "direction": { "enum": ["higher", "lower"] },
          "samples": {
            "type": "array",
            "minItems": 1,
            "items": { "type": "number" }
          },
          "best": { "type": "number" },
          "median": { "type": "number" },
          "runs": { "type": "integer", "minimum": 1 },
          "warmup": { "type": "integer", "minimum": 0 }
        },
        "additionalProperties": true
      }
    },
    "additionalProperties": false
  },
  "example": {
    "iteration": 0,
    "decision": "KEEP",
    "candidate": { "path": "candidates/iter-000.cu" },
    "current_best": { "path": "state/current-best.cu" },
    "verification": { "compile_passed": true, "verify_passed": true },
    "benchmark": {
      "name": "throughput",
      "unit": "TFLOP/s",
      "direction": "higher",
      "samples": [10.0, 11.0],
      "best": 11.0,
      "median": 10.5,
      "runs": 2,
      "warmup": 1
    },
    "promotion": {
      "promoted": true,
      "resulting_best": { "path": "state/current-best.cu" },
      "reason": "candidate improved the durable best"
    },
    "records": {
      "round_path": "rounds/iter-000.json",
      "state_path": "state/tuning-state.json"
    }
  },
  "outputs": {
    "metrics": [
      {
        "pointer": "/benchmark",
        "format": "benchmark/v1",
        "required": false
      }
    ],
    "projections": [
      {
        "id": "workflow.status",
        "pointer": "/decision",
        "format": "string",
        "required": true
      }
    ]
  }
}
```

Manifest fields:

| Field | Meaning |
|---|---|
| `schema` | JSON Schema Draft 2020-12 for the complete result payload. |
| `example` | Prompt guidance; it must itself pass the schema and output normalization at load time. |
| `outputs.metrics` | Optional list of task metric projections. |
| `outputs.projections` | Optional worker-owned semantic projections for generic acceptance/progress transport. |
| `pointer` | RFC 6901 JSON Pointer into the accepted payload. No custom selector language. |
| `format` | Metric declarations use Piano's normalized `benchmark/v1` protocol; semantic projections use a declared generic format such as `string` or `json`. |
| `required` | If true, a missing/null pointer rejects the result and enters normal repair. If false, no corresponding metric or projection record is emitted when absent. A present value must always normalize successfully. |

### 7.3 Why JSON Schema, not worker-authored Zod

Worker recipes are user-editable data. Loading `.ts` or Zod source would execute
user code, require a TypeScript runtime, couple recipes to Piano's Zod version,
and make run-local contract copies non-portable. JSON Schema is declarative,
language neutral, serializable, and inspectable. Piano compiles Draft 2020-12
schemas with Ajv in strict, all-errors mode during workflow loading, so
malformed schemas and invalid examples fail before dispatch rather than
becoming runtime surprises.

### 7.4 Why JSON Pointer, not a `select` or `recorder` DSL field

The contract already owns payload structure. Metric location therefore belongs
beside the schema, not in workflow YAML. RFC 6901 provides the smallest standard
mechanism needed to point at a concrete field. `format` describes the expected
record protocol; it does not name a runtime class. Recorder selection remains a
Piano implementation detail.

### 7.5 Piano-internal Zod use

Zod remains appropriate for Piano-owned boundaries:

- worker contract manifest v1;
- normalized benchmark metric;
- workflow observations;
- trajectory index and stream records;
- evaluator result/history/run artifact schemas;
- internal workflow AST where runtime validation is useful.

Raw provider events are not parsed directly with a strict Zod schema. Piano first
performs the existing bounded provider normalization, then validates the
normalized internal observation or record.

## 8. Workflow DSL semantics

### 8.1 New form

```yaml
- stage:
    name: measure
    worker: cuda-benchmark-store
    from: [idea, implement]
```

- Contract presence is the only switch: a stage whose worker owns
  `recipes/contracts/<worker>.json` validates its result, and a worker without
  one runs unvalidated.
- The DSL has no `validate` field. A workflow that still declares it fails
  parse with a removal message instead of silently changing behavior.
- A malformed contract or invalid example fails workflow load before any
  worker runs.
- A contract-bearing stage must still allow a tool capable of writing its
  result.

There is no `metrics`, `recorder`, `select`, `sourceWorker`, or tuning marker in
the workflow DSL. The stage already names the worker, the worker names its
contract by ownership, and the contract declares metric outputs.

`loadWorkflow` resolves and compiles every stage's worker resources once and
stores those immutable resources on `LoadedWorkflow`, keyed by worker and
harness. Execution consumes that cached resource snapshot; it does not resolve
the worker again against a different recipe root. Contract parsing runs for
every worker/harness resource key, so a malformed contract cannot hide behind a
stage that does not seem to use it. Before a contract-bearing worker starts,
Piano copies the exact loaded contract into the run's `contracts/` directory
under the worker name, injects that run-local copy as worker context, shows the
validated example in the result instructions, and supplies the invocation-local
result path. This is how a worker learns both which contract applies and which
fields to write; canonical execution consumes contract projections rather than
worker-specific source-code payload switches.
A map source must declare the worker-contract `workflow.map-items` projection;
no historical payload adapter remains.

A malformed or missing result gets one repair turn in the same actor session.
A result that still fails that turn is accepted with a `validationWarning`
rather than failing the stage or scheduling a retry: the warning travels into
`inputs.json`, the prompt of every downstream consumer, and tournament
selection excludes the branch. Worker execution errors still fail the stage.

### 8.2 Legacy compatibility (removed)

Both the old `validate: <contract-name>` syntax and the boolean `validate`
switch were removed. Any `validate` key is rejected at parse time with a
migration message pointing at `recipes/contracts/<worker>.json`. Legacy
projections and the per-stage `stage.validation.legacy` event were removed
together; only worker-owned contracts participate in result validation.

One legacy boundary remains:

- **`LegacyRunAdapter` compatibility** reads historical run artifacts that
  predate native trajectory streams. Removing named validators does not remove
  this adapter or make old runs unevaluable.

## 9. Validation and recording lifecycle

```text
workflow load
    │
    ├─ resolve recipes/contracts/<worker>.json for every stage worker
    ├─ validate manifest + JSON Schema + example
    └─ copy each contract into the run under the worker name
            │
            ▼
stage attempt starts ──► WorkflowTrajectory.observe(stage_attempt_started)
            │
            ▼
worker agent measures and writes result.json
            │
            ▼
generic JSON validation
    │ fail                         │ success
    └─ same actor repair turn      ▼
       (one turn; failure after    project declared metrics and semantic outputs
        it becomes a warning)        │ fail                 │ success
                                     └─ same repair path    ▼
                                          preserved domain hook
                                                   │
                                                   ▼
                                            accepted payload
                                                   │
                         ┌─────────────────────────┴──────────────┐
                         ▼                                        ▼
              existing acceptance/progress                 stage_accepted observation
                                                               │
                                                               ▼
                                                     WorkflowTrajectory
                                                               │
                          ┌─────────────────┬───────────────────┼─────────────────┐
                          ▼                 ▼                   ▼                 ▼
                    Benchmark          Duration             Token             ToolCall
                    Recorder           Recorder              Recorder          Recorder
```

The declared metric protocol is part of acceptance. A payload cannot pass and
then silently produce an invalid metric. Conversely, a recorder filesystem
failure occurs after acceptance: it never reruns an agent or changes workflow
truth. It is logged, marks trajectory evidence incomplete, and causes strict
eval evidence to fail.

### 9.1 Implemented module boundaries

| Owner | Responsibility | Must not own |
|---|---|---|
| `recipes/contracts/<worker>.json` | Editable worker payload schema, accepted example, metric pointers, and semantic projections | Runtime classes, executable validation code, workflow scheduling |
| `packages/contract/src/worker-contract.ts` | Parse the Piano-owned manifest with Zod, compile its payload JSON Schema with Ajv, validate results, normalize declared metrics, and produce guidance | Worker-name switches, workflow lookup, eval policy |
| `packages/orchestrator/src/workflow.ts` | Parse the workflow AST | Concrete worker payload schemas |
| `packages/orchestrator/src/workflow-file.ts` | Resolve worker/harness resources, compile every present contract onto `LoadedWorkflow`, fail malformed contracts and contract-bearing stages without a write/exec tool | Running workers or evaluating scores |
| `packages/orchestrator/src/workflow-execution.ts` | Write/inject the run-local contract copy, provide the result path, run validation and same-actor repair, turn a surviving contract failure into a warning, preserve explicit GPU materialization, and emit accepted observations | Selecting metrics by worker name or scoring trajectories |
| `packages/trajectory` | Define normalized observations/records, dispatch them through `WorkflowTrajectory`, own recorder files and their local score functions, and maintain the trajectory index | Worker execution, agent repair, grader truth |
| `packages/evals/src/workflow-evaluator.ts` | Implement the generic workflow evaluation capability by reading native streams and applying recorder scores | Worker contracts, payload-field knowledge, workflow execution |
| `packages/evals/src/legacy-run-adapter.ts` | Isolate reconstruction of pre-migration run evidence | New-run recording or named workflow-contract compatibility |

The concrete control and data ownership chain is:

1. `loadWorkflow` uses `stage.worker` and `stage.harness` as the worker-resource
   key and compiles `recipes/contracts/<worker>.json` whenever it exists. A
   missing contract leaves the stage unvalidated; a malformed one fails load.
2. Before dispatch, execution writes the exact loaded contract to the run-local
   copy, injects its example as guidance, and gives the worker an
   invocation-local result path.
3. The worker measures task performance and writes its payload. Schema failure,
   missing required metrics, or invalid normalized metrics enters the existing
   one-turn same-actor repair path.
4. Only an accepted payload can emit `stage_accepted`; its normalized metrics,
   worker name and run-local contract copy, and declared semantic projections
   then flow through the shared acceptance/progress/trajectory path. Runtime
   duration, tokens, and tools come from orchestrator/harness observations
   instead of the worker payload.
5. Normal user runs and eval-launched runs use this same path and artifact
   layout. Evals adds queueing and independent grader measurements, then reads
   the already-recorded trajectories through `WorkflowEvaluator`.

## 10. Normalized benchmark protocol

```ts
interface BenchmarkMetricV1 {
  readonly protocol: "benchmark/v1";
  readonly name: string;
  readonly unit: string;
  readonly direction: "higher" | "lower";
  readonly samples: readonly number[];
  readonly best: number;
  readonly median: number;
  readonly runs: number;
  readonly warmup: number;
  readonly rawPath?: string;
}
```

Normalization invariants:

1. All numbers are finite; samples are non-empty.
2. `runs === samples.length`.
3. `best === max(samples)` for `higher` and `best === min(samples)` for `lower`.
4. `median` matches the conventional sorted median within a small
   floating-point tolerance.
5. `warmup` is a non-negative safe integer.
6. `name` and `unit` are non-empty.
7. A raw evidence path, when present, remains workspace-relative and is not read
   by the generic recorder.

Examples:

- Throughput: `name=throughput`, `unit=TFLOP/s`, `direction=higher`.
- Kernel latency: `name=latency`, `unit=ms`, `direction=lower`.

Both use the same recorder and comparison logic. Metric-specific truth remains
with the worker evidence and grader.

### 10.1 Operator-tuning signal mapping

| Signal | Authoritative source | Selection/normalization | Recorder and artifact |
|---|---|---|---|
| Throughput (`TFLOP/s`, items/s) | Measure worker's validated payload | Contract `outputs.metrics[].pointer`; `benchmark/v1`, `direction: higher` | `BenchmarkRecorder` → `trajectories/benchmark.jsonl` |
| Kernel/task latency (`ms`, µs) | Measure worker's validated payload | Same protocol with `direction: lower` | `BenchmarkRecorder` → `trajectories/benchmark.jsonl` |
| Worker/stage elapsed time | Orchestrator monotonic attempt boundaries | No worker payload and no DSL selector | `DurationRecorder` → `trajectories/duration.jsonl` |
| Token consumption | Normalized harness usage events | Per-actor cumulative-to-delta conversion | `TokenUsageRecorder` → `trajectories/token-usage.jsonl` |
| Tool activity | Normalized harness tool start/end events | Call id pairing and failure status | `ToolCallRecorder` → `trajectories/tool-calls.jsonl` |

The word “selection” therefore means a JSON Pointer declared beside the worker
payload schema; it is not a separate recorder or workflow primitive. The loop
runtime supplies iteration attribution to every observation. A measure worker
knows to emit throughput or latency because its own injected contract example
names that metric, while the workflow only names the `worker`.

## 11. WorkflowTrajectory and recorder interfaces

The shared trajectory module exposes small TypeScript capabilities rather than
an inheritance hierarchy. Lifecycle ownership is split deliberately: a minimal
observation recorder can participate in dispatch, while a scorable trajectory
recorder adds read/score behavior. Final index state belongs to the manager, so
individual recorders do not need a `close` hook:

```ts
type WorkflowObservation =
  | StageAttemptStartedObservation
  | TokenUsageObservation
  | ToolCallStartedObservation
  | ToolCallFinishedObservation
  | StageAttemptFinishedObservation
  | StageAcceptedObservation;

interface WorkflowObservationRecorder {
  readonly descriptor: TrajectoryStreamDescriptor;
  initialize?(runDir: string): Effect.Effect<void, TrajectoryReadError>;
  observe(observation: WorkflowObservation): Effect.Effect<void, TrajectoryRecordError>;
}

interface TrajectoryRecorder<TRecord, TScore>
  extends WorkflowObservationRecorder {
  read(runDir: string): Effect.Effect<readonly TRecord[], TrajectoryReadError>;
  score(records: readonly TRecord[]): TScore;
}

final class WorkflowTrajectory {
  static open(
    runDir: string,
    executionId: string,
    recorders?: readonly WorkflowObservationRecorder[],
  ): Effect.Effect<WorkflowTrajectory>;
  observe(observation: WorkflowObservation): Effect.Effect<void, never>;
  close(status: WorkflowCompletion): Effect.Effect<void, never>;
}

final class WorkflowEvaluator {
  // Composes recorder read/score capabilities over WorkflowEvaluationInput.
}
```

The exact Effect environment is implementation-owned. Public inputs and outputs
remain readonly, unknown data is parsed at boundaries, and record types are
discriminated/versioned. `WorkflowEvaluator` composes the recorder read/score
capabilities directly; no separate evaluator interface layer is defined.

`WorkflowTrajectory` dispatches observations to recorders in registration order,
similar to a compiler pass manager. Recorders do not call one another and do not
inspect workflow YAML.

## 12. Observation attribution

Every emitted record carries the common attribution available at the runtime
boundary:

```ts
interface TrajectoryRecordContext {
  readonly version: 1;
  readonly timestamp: string;
  readonly executionId: string;
  readonly invocationId: string;
  readonly stageId: string;
  readonly stage: string;
  readonly worker: string;
  readonly attempt: number;
  readonly iteration?: number;
  readonly instanceId?: string;
  readonly mapSlot?: number;
  readonly actorKey?: string;
  readonly sessionId?: string;
  readonly transcriptPath?: string;
}
```

`iteration` comes from the existing loop runtime frame. It is never parsed from
a worker payload. A loop stage whose worker owns a contract therefore
naturally produces an iteration-indexed benchmark trajectory.

Invocation identity is mandatory because one actor/session transcript can span
multiple loop iterations, while separate stages can have separate transcripts.
An eval case is one logical run, but the current workflow runtime may create one
physical transcript per independent worker actor/session. Forcing those files
into one synthetic transcript would lose session boundaries and alter existing
artifacts, so the implementation links all stage transcripts and keeps the
run-level bounded `trajectory.json` index. Existing transcript paths and
invocation attribution remain the source of truth.

## 13. Artifact layout

```text
~/.piano/runs/<run-id>/
├── log.jsonl                         # existing, unchanged
├── trace.jsonl                       # existing, unchanged
├── trajectory.json                  # existing bounded agent-event index
├── progress.jsonl                   # existing accepted-stage ledger
├── progress.json                    # existing latest progress view
├── contracts/
│   └── <worker>.json                # run-local worker contract copies
├── trajectories/
│   ├── index.json                   # stream discovery + completeness
│   ├── benchmark.jsonl              # BenchmarkRecordV1
│   ├── duration.jsonl               # DurationRecordV1
│   ├── token-usage.jsonl            # TokenUsageRecordV1
│   ├── tool-calls.jsonl             # ToolCallRecordV1
│   └── selection.jsonl              # SelectionRecordV1
└── executions/...                   # existing results/context/transcripts
```

`trajectories/index.json` contains:

- manifest version and execution id;
- run status;
- one descriptor per registered recorder (`id`, schema id, relative path);
- stream completion/error state;
- update timestamp.

JSONL streams are append-only and safe to inspect while a workflow is running.
The index is an atomic convenience view and may be replaced. Its absence on an
old run activates legacy reconstruction. Reopening the same execution carries
forward any prior stream error and marks an unclosed `running` index as
interrupted; a later prompt cannot erase missing evidence by successfully
rewriting the index.

## 14. Recorder behavior

### 14.1 BenchmarkRecorder

- Input: normalized metrics on `stage_accepted`.
- Output: one record per declared and present metric.
- Keeps the worker identity and JSON Pointer for attribution.
- Preserves the worker's sample set and summary; does not rerun benchmarks.
- Score: per-name/unit ordered trajectory plus the direction-aware best value
  and chronological last value. Comparative change remains an evaluator/report
  concern.

### 14.2 DurationRecorder

- Input: stage-attempt start/end observations.
- Output: one record for every completed, failed, cancelled, or validation-
  rejected attempt.
- Uses Piano monotonic elapsed time for duration and wall-clock timestamps for
  correlation.
- Represents workflow overhead and worker wall time. Task latency such as GPU
  kernel milliseconds is worker-measured performance and therefore uses
  `BenchmarkRecorder` with `direction: lower`, preserving the distinction
  between runtime telemetry and the optimized objective.
- Score: attempt count, total attempt time, and maximum attempt time. Records
  retain stage and iteration fields for consumers that need grouped analysis;
  eval wall-clock time remains independently measured by the eval driver.

### 14.3 TokenUsageRecorder

- Input: normalized harness usage events and attempt boundaries.
- Output: one invocation/attempt summary, including reported cumulative values,
  derived deltas, and reset detection.
- Reused loop sessions must not cause cumulative snapshots to be summed more
  than once. Delta state is keyed by the stable actor key (falling back to the
  invocation id), while records retain actor, session, invocation, and attempt.
- Score: input, output, cache-read, cache-write, and total token sums.

### 14.4 ToolCallRecorder

- Input: normalized tool start/end events.
- Output: one record per tool call with tool name, call id, completed/failed
  status, and duration when pairable.
- Does not duplicate arbitrary tool arguments/results; those remain bounded in
  `trajectory.json` and complete in transcripts.
- Score: total calls, failures, unique names, and summed paired duration.

## 15. Contract run copies and reproducibility

At workflow load and first use of a contract in a run, Piano:

1. reads its exact bytes while resolving `LoadedWorkflow` resources;
2. validates the manifest, JSON Schema, example, and projected example outputs;
3. before dispatch, writes the exact document to
   `contracts/<worker>.json` atomically and injects it as worker context;
4. stores the worker name and result path in accepted progress/acceptance
   metadata and benchmark records.

The run-local copy is the contract's identity. It is written once and reused by
every attempt under one loaded workflow, including same-actor repair. No id,
version, digest, or content hash rides accepted evidence, so a later workflow
reload never pretends to pin bytes it did not verify.

## 16. Evals design

### 16.1 Unified case model

`CaseShape = "write" | "tuning"` and `shape` are removed from the active eval
model. Existing coding fixtures may remain ordinary workflow cases, but neither
the runner nor evaluator branches on their category.

Existing `group` values and case ids may still contain words such as `tuning`
or `write`; they are stable user-facing labels used only for selection and
report grouping, not execution or evaluation discriminators.

Performance capability is explicit:

- a case with grader `metric`, baseline, and benchmark commands receives
  performance comparison;
- a case without them receives artifact/execution/evidence scoring only;
- workflow trajectory streams are evaluated whenever present.

For performance evidence, an accepted workflow metric must match both the
grader's metric name and direction. The grader-owned final benchmark remains
the score authority; a differently named or oppositely oriented worker metric
is retained in the trajectory but cannot satisfy the case's evidence gate.

The automatic quality mean uses three dimensions for a non-performance case
(`correctness`, `execution`, `evidence`) and four only when the complete
performance capability is present. A missing capability must not contribute a
synthetic zero. Injected judge scoring remains independent of this automatic
mean.

### 16.2 Responsibilities retained

The eval driver continues to own:

- case loading and filtering;
- queueing and independent trials;
- workspace copies and command launch;
- fail-closed run-directory association;
- grader-owned clean baseline;
- compile, correctness verification, and final benchmark;
- task/execution/evidence separation;
- judges, variants, reports, history, and baseline replay.

### 16.3 Responsibilities removed

Core evals no longer:

- imports worker contract names or concrete payload types;
- treats `resultPayload.benchmark.best` as a protocol;
- classifies execution as write versus tuning;
- infers metric-producing stages from worker names;
- treats agent messages as the task performance trajectory.

### 16.4 WorkflowEvaluator

`WorkflowEvaluator` reads `trajectories/index.json`, validates each known stream,
and delegates scoring to the corresponding recorder implementation. Unknown
future stream ids remain discoverable evidence and do not crash evaluation.
Malformed declared streams and records attributed to another execution fail
evidence explicitly.

The output separates:

- benchmark trajectories by metric name/unit;
- duration summary;
- token summary;
- tool-call summary;
- transcript analysis;
- artifact and independent grader measurements.

### 16.5 LegacyRunAdapter

Historical runs without `trajectories/index.json` remain evaluable through one
isolated compatibility adapter. It may reconstruct:

- tokens/tools from `trajectory.json` and transcripts;
- stage timing/attribution from log, acceptance, and progress records;
- old benchmark points from legacy `progress.jsonl` payloads.

The adapter is explicitly incomplete: malformed legacy JSONL, trajectory events,
duration records, or benchmark-shaped payloads are reported as issues while
other valid records remain readable. A root `benchmark-evidence` payload and
the historical nested `resultPayload.benchmark` shape are both supported. A
run with a `trajectories` directory containing native files (including an
in-flight temporary index) is never reinterpreted as legacy; only an empty
directory remains eligible for the old-run fallback. A malformed native index
is reported as incomplete native evidence.

No new run may use this path, and no core evaluator code may inspect a concrete
worker payload. The report marks reconstructed evidence as `legacy` so it is not
confused with a validated v1 trajectory stream.

## 17. Failure semantics

| Failure | Result |
|---|---|
| Missing worker contract | Stage runs unvalidated; no structured result is required. |
| Invalid contract manifest/schema/example | Workflow load fails with worker/path detail. |
| Worker result missing or invalid JSON | Existing same-actor validation repair path. |
| Payload fails JSON Schema | Existing same-actor validation repair path with concise JSON Pointer errors. |
| Required metric pointer missing | Validation repair. |
| Present metric fails normalized protocol | Validation repair. |
| Contract failure survives the one repair turn | Stage is accepted with a `validationWarning`; the workflow continues and downstream inputs/prompts treat the result as untrusted. |
| Optional metric pointer absent | Stage may be accepted; no fabricated metric record. |
| Run-local contract copy write fails | Validating stage does not start because its context cannot be injected. |
| Recorder stream write fails after acceptance | Workflow continues; log error and mark trajectory incomplete. |
| Evals sees incomplete/malformed new stream | Evidence fails closed; task result remains separately reported. |
| Evals sees no new index on historical run | Use `LegacyRunAdapter`, marked legacy. |

## 18. Migration plan

1. Add worker-contract manifest loading and JSON Schema validation; contract
   presence alone selects it, and all validation authority moves to
   `recipes/contracts/`.
2. Move all concrete CUDA/Triton schemas and examples into the flat
   `recipes/contracts/` directory. Built-in workflows carry no validation switch.
3. Add normalized trajectory protocols, `WorkflowTrajectory`, and the four
   recorders. Wire observations at existing workflow execution boundaries.
4. Copy contracts into the run under the worker name; accepted evidence records
   the worker name and the run-local contract copy, never a version or digest.
5. Add `WorkflowEvaluator`; migrate eval result/scoring/reporting to its output.
6. Remove active `write`/`tuning` branching and migrate case manifests.
7. Add legacy reconstruction for pre-migration runs.
8. Keep existing artifact writers and current CUDA/Triton promotion behavior
   intact.
9. The compatibility window is closed: string validators are rejected at
   parse time; the warning and legacy run-log event are removed.

## 19. Acceptance criteria

### Contracts and DSL

- A custom recipe can add `recipes/contracts/<worker>.json`; the stage picks it
  up without a Piano source change or a workflow switch.
- Malformed contracts and invalid examples fail before the first worker
  invocation; a missing contract leaves the stage unvalidated.
- Contract examples are checked at load time.
- A failed result reopens the same actor and succeeds after a corrected result;
  a failure that survives that one repair turn is accepted with a
  `validationWarning` instead of failing the stage.
- Built-in CUDA and Triton workflows carry no `validate` switch.
- No built-in GPU workflow selects a concrete payload schema from Piano
  TypeScript. Only worker-owned contracts validate results.
- A workflow that still declares any `validate` value fails at parse time with
  removal guidance pointing at `recipes/contracts/<worker>.json`.

### Trajectory recording

- A two-iteration GPU workflow emits two attributed benchmark points when both
  iterations measure successfully.
- A compile-failed iteration emits no fabricated benchmark point while progress
  still records its accepted outcome.
- Throughput and latency both validate and score through `BenchmarkRecorder`.
- Tokens from a resumed loop actor are counted once per invocation, not summed
  as repeated cumulative snapshots.
- Tool calls and durations carry the correct stage, invocation, attempt, and
  iteration.
- Every metric record links to its worker; the run-local contract copy is the
  identity.
- Existing run artifacts remain byte-shape compatible for their current readers.

### Evals

- Evals consumes v1 trajectory streams without reading worker payload fields.
- Normal runs and eval-launched runs produce the identical trajectory layout.
- Case execution no longer branches on `write` versus `tuning`.
- Baseline, final benchmark, acceptance, judges, history, variants, and
  fail-closed run association continue to work.
- A historical run without a trajectory index is reconstructed and labeled
  legacy.
- A malformed/incomplete new trajectory fails evidence without hiding artifact
  correctness or execution status.

### Verification

- Focused contract, workflow, recorder, evaluator, migration, and legacy tests
  pass.
- GPU workflow tests cover both CUDA and Triton contract discovery.
- `npm run typecheck`, `npm run lint`, and `npm test` pass.
- Complete diff and repository status contain only this mission's files.

## 20. Decision ledger

### Accepted

1. **Unified workflow model.** Tuning is an ordinary workflow with loop metadata
   and metric-producing workers.
2. **Worker-local declarative contracts.** Schema authority lives in
   `recipes/contracts/`, not in evals or Piano source.
3. **Automatic contract selection.** Worker identity already names the contract;
   no stage-level `validate` field exists.
4. **JSON Schema + JSON Pointer.** Declarative validation and minimal projection
   without executing user code or inventing an expression language.
5. **One benchmark recorder.** Throughput and latency differ in metadata and
   direction, not record lifecycle.
6. **Trajectory as pass manager.** `WorkflowTrajectory` drives independent
   recorders but never drives workers.
7. **Generic evaluator.** `WorkflowEvaluator` composes recorder read/score
   capabilities without a separate evaluator interface.
8. **Additive evidence.** Current log/trace/trajectory/progress/transcript files
   are preserved.
9. **Shared run/eval artifacts.** Evals reads what normal runs already record.
10. **Internal Zod only.** User contracts stay portable JSON.
11. **Independent grader truth.** Validated worker metrics remain evidence, not
    the final correctness/performance authority.
12. **Bounded compatibility.** Old-run reconstruction is an isolated migration
    adapter; named validators are removed, not adapted.
13. **Preserved transcript topology.** A case is one logical run, while its
    independent worker sessions retain their existing physical transcripts;
    trajectory records link them instead of creating a lossy merged transcript.
14. **No named-validator compatibility layer.** Validation comes only from
    `recipes/contracts/<worker>.json`; historical run evidence remains readable
    through the legacy reconstruction path.

### Rejected

1. Separate write and tuning execution/evaluation models.
2. A `TuningDriver` that owns workflow execution.
3. DSL fields such as `metrics`, `recorder`, `select`, or `sourceWorker`.
4. Evals guessing metric locations from worker names or payload conventions.
5. Worker-authored Zod/TypeScript contracts.
6. One class per metric name (`ThroughputRecorder`, `LatencyRecorder`).
7. Replacing `trajectory.json` or transcripts with the new streams.
8. Treating structural validation as proof that a measurement is true.

### Deliberate implementation choices

1. `required: false` supports truthful compile/verify/blocker outcomes with no
   benchmark. A present metric is never allowed to be malformed.
2. Recorder failures are evidence failures, not workflow-result failures,
   because recording occurs after accepted work and must not trigger duplicate
   agent actions.
3. Run-local contract copy failure is earlier and fatal because a validating
   stage must not run under an unrecorded mutable contract.
4. Built-in workflows migrate immediately; string validation is rejected at
   parse time rather than kept as a compatibility window.
5. GPU round materialization is an explicit contract-owned capability. A
   validating worker opts in by declaring `round.materialization-v1` together
   with the complete required semantic projections and formats. The executor
   applies the generic protocol only after those declarations and projected
   values pass validation. Contract IDs and worker names are not runtime
   activation switches; the only future generalization is a new protocol
   version.

## 21. Open questions

There are no blocking product questions for implementation. The named-validator
compatibility layer has been removed; validation comes only from
`recipes/contracts/<worker>.json`. Future GPU materialization changes must be
proposed as new protocol versions rather than as worker-name or contract-ID
switches.
