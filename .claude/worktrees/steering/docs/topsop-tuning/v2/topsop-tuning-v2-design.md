# Topsop tuning V2 design

Date: 2026-09-15

## Compatibility boundary

V2 is additive. It does not rename, delete, or modify `recipes/workflows/topsop-tuning.yml` or any existing `recipes/topsop-*` V1 worker. Remote users keep the V1 behavior until they explicitly select `topsop-tuning-v2.yml`.

V2 workers use the `topsop-v2-*` namespace, contracts use `topsop-v2-*` IDs, and durable state uses `~/.piano/state/topsop-v2/`. V1 and V2 share only the workspace lease so they cannot tune the same checkout concurrently.

## Major change 1: durable session continuation

V2 defaults to continuing a compatible durable optimization chain instead of requiring users to clear state before every session. This is a protocol-level lifecycle correction, not an operator- or testcase-specific feature: durable promotion can produce revision N, so a later baseline contract cannot assume every run starts at revision 0.

The startup state machine is deliberately closed:

| Existing state | Startup result | Behavior |
|---|---|---|
| absent | `initialized` | current checkout becomes revision 0 after fresh build, correctness, and measurement |
| present and strictly compatible | `continued` | inherit source revision and candidate history, then rebuild and remeasure |
| malformed, legacy, or incompatible | `blocked` | return `durable_state_incompatible`; never delete, migrate, checkout, or silently start fresh |

Compatibility uses only generic identities: state schema/protocol version, workload fingerprint, architecture, exact workspace root, exact current-best source commit (`HEAD` equality), and exact workspace diff digest. The digest has one recipe-owned implementation, `recipes/topsop-v2-workspace-identity.py`, using algorithm `topsop-v2-workspace-manifest-v1`; every state reader/writer must consume that helper output instead of reimplementing the algorithm. It contains no operator names, shape branches, kernel paths, or case-specific recovery. Old V2 state without these identities is intentionally incompatible rather than automatically migrated.

Continuation inherits source/current-best/history, not measurements. Every session rebuilds the current-best source, reruns runtime identity and correctness, recollects timing/profile, and freezes a new session-local threshold. A verified binary is copied atomically to an immutable state-root path keyed by revision and digest; a mutable build output is never the sole cross-session recovery artifact. KEEP advances revision exactly once and binds the snapshot to the resulting Git commit and workspace diff. DISCARD restores from the immutable incumbent snapshot.

This change remains recipe-only: worker instructions, worker contracts, documentation, and synthetic scenario tests. It adds no Piano package API, workflow node/key, V1 compatibility path, automatic state migration, Git ancestry inference, or cross-worktree concurrency feature.

## Stage graph

```text
prepare -> characterize -> loop(analyze -> implement -> evaluate -> promote) -> summary
```

The loop carries only the immutable baseline bundle and the previous promotion receipt. Large evidence remains in files addressed by absolute path and SHA-256.

## Ownership

| Stage | Owns | Must not own |
|---|---|---|
| prepare | mission normalization, source/test discovery, testcase materialization, build plan, V2 state namespace | profiling, theory, kernel optimization |
| characterize | runtime identity, correctness baseline, baseline samples/profile, theory ceiling | candidate edits, promotion |
| analyze | diagnosis, falsifiable hypothesis, one admitted variable, explicit implementation constraints | source edits, measurement |
| implement | bounded edit, candidate-plan conformance, candidate build, restore point | correctness verdict, performance decision, commit |
| evaluate | full workload correctness, primary metric comparison, target metrics for latency-eligible candidates | source edits, state update |
| promote | target-evidence gate, atomic KEEP/DISCARD/CONVERGED, Git/artifact/state receipt | new optimization ideas |
| summary | truthful final outcome, final kept target observations, and cleanup | new candidate work |

## Validation layers

1. Worker-owned JSON Schema checks payload shape.
2. Worker procedures recompute paths, digests, identities, sample statistics, changed-file scope, state revision, candidate-plan constraints, and target-metric coverage.
3. Each transition references its immediate producer by contract ID, absolute accepted-result path, and SHA-256.
4. Runtime identity is strict after testcase preparation; a seed fixture is not accepted as a baseline.
5. Failures use one taxonomy: `kind`, `scope`, `retryable`, `code`, `message`, and `next_action`.

## Framework constraint

The first V2 implementation uses only primitives already present in `origin/main`: stage, loop, `from`, `feedback`, tool grants, handoff files, and worker-owned contracts. No `packages/` changes are part of V2 phase 1.

## V1 worker lineage

V2 workers are independent copies/consolidations of the mature V1 responsibilities at archive commit `8972d932734c36a4bf2205ca9bef026677e02f82`. They do not import, symlink, or mutate V1 worker files.

| V2 worker | V1 source responsibilities |
|---|---|
| topsop-v2-prepare | topsop-setup-env, topsop-explore, topsop-prepare-testcase |
| topsop-v2-characterize | topsop-theory, topsop-profile |
| topsop-v2-analyze | topsop-diagnose, topsop-hypothesis, topsop-idea |
| topsop-v2-implement | topsop-implement |
| topsop-v2-evaluate | topsop-verification, topsop-measure observation |
| topsop-v2-promote | topsop-decision, topsop-commit, topsop-measure transaction |
| topsop-v2-summary | topsop-summary |

## Bounded experiment budget and successful loop termination

V2 declares `iterations: 30` as a maximum scheduling budget, not a promise to manufacture 30 candidates. Analyze targets 10 real candidate measurements in the current run and tracks them separately from compile failures, skipped stages, convergence rounds, and historical measurements from earlier durable sessions.

Candidate search is organized into six evidence-tracked categories: data movement/overlap, tiling/partitioning, storage/layout, compute/codegen, launch specialization, and fusion/algorithm. A focused neighborhood that runs dry must expand into untested categories and then perform a structural replan. “Single variable” means one falsifiable causal mechanism; coordinated edits across files are allowed when they implement that one mechanism and share one rollback boundary.

Normal convergence still traverses one complete analyze→implement(skipped)→evaluate(skipped)→promote round so the incumbent is verified transactionally. Promote then projects contract-owned `workflow.loop-control=stop`. Piano treats only this projection on the declared feedback stage as scheduling authority, ends the loop successfully, recalculates the effective progress denominator, and proceeds to summary. An arbitrary payload field named `next_action` cannot control execution.

Before 10 real measurements, early convergence is valid only when all six categories are evidence-backed as exhausted or infeasible and expanded plus structural replanning has completed. Ten remains a target rather than a hard quota: workers must never invent or rename disproven candidates merely to reach it.

## Phase 2 capability routing

V2 still does not add a Piano-level shared-capability loader. The existing
`recipes/<worker>/skills/*/SKILL.md` discovery injects a small stage-local
`topsop-v2-knowledge-router`; that router resolves an explicit read-only corpus
under `recipes/shared-skills/`. This keeps activation recipe-only while avoiding
copying the same multi-megabyte documents into every worker.

The canonical corpus is pinned to kerneldevsuite commit
`36c559d465ac7636678e094ccf512cfc5ff61bbe` and contains:

- `topsop-gcu400-foundation`: compute-flow, compute, dataflow, scalar, DTE,
  LDST, assembly/ISA, and versioned GCU400 hardware facts;
- `topsop-gcu400-performance`: quantitative performance analysis and six
  selected optimization case studies;
- `topsop-gcu400-validation`: testing, debug references, and reviewer
  checklists;
- `topsop-operator-evidence`: bounded operator-local command, case, history, and
  progress-record rules.

`recipes/topsop-v2-knowledge-routing.json` is the machine-readable stage
allowlist. Every router applies progressive disclosure: choose one primary
domain and at most one auxiliary domain, read the capability `SKILL.md` and
index first, then open only the files/sections needed for the current claim.
Recursive corpus reads, whole-directory concatenation, GCU300-only skill sets,
communication-only material, and unselected optimization reports remain out of
scope. Shared API references may retain architecture-comparison tables, but V2
must use only their GCU400 semantics.

| Worker | Primary route | Optional auxiliary route | Historical case authority |
|---|---|---|---|
| prepare | compute-flow or operator evidence | the other of those two | path/command/dead-end clue only |
| characterize | perf-estimation | one relevant foundation domain | forbidden |
| tournament-partition | optimization or perf-estimation | operator evidence | lane hypothesis only |
| analyze | one foundation/perf-estimation domain | one cross-domain, operator-evidence, or signature-matched case | hypothesis only |
| implement | one foundation domain | one validation or operator-evidence domain | historical patches forbidden |
| evaluate | testing or perf-estimation | one debug/review/perf/operator-evidence domain | forbidden for verdicts |
| promote | operator evidence | none | cannot override accepted evaluation |
| summary | operator evidence | none | output context only |

Current checkout source/build metadata and current tool/device output remain
strictly more authoritative than the pinned corpus. Historical optimization
cases cannot establish current dispatch, current speedup, eligibility, or KEEP.
The prior four-file compact pack and its five per-worker copies are removed;
there is one document source of truth plus lightweight routers.

## Phase 2 transition hardening

Status-specific schema branches prevent a worker from claiming mutually inconsistent outcomes:

- implement `built`, `compile_failed`, `skipped`, and `blocked` each require only their valid evidence class;
- evaluate cannot attach performance claims to a correctness rejection or convergence no-op;
- promote binds `promoted/restored/terminal/blocked` to `KEEP/DISCARD/CONVERGED/BLOCKED`, the matching next action, and a contract-owned loop-control projection;
- summary requires final artifact/state evidence for completed tuning and an upstream failure for blocked or interrupted outcomes;
- candidate-local implement/evaluate blockers may project `workflow.block-scope=iteration`; global prerequisites remain terminal.


## Execution profile

Every V2 stage explicitly uses the `dsh` harness, pins `model: deepseek-flash`, and uses `thinkingLevel: low`, so execution does not depend on the user's default harness/model configuration and routine stages do not spend high-reasoning budgets on contract-shaped work. Tool grants use DSH-native lowercase names: `read`, `bash`, `write`, `edit` where mutation is owned, and `glob`/`grep` for bounded discovery. DSH does not expose standalone `ls` or `find` tool IDs; directory inspection that cannot be expressed by `glob` remains a bounded `bash` command under the command-safety skill.


## DSH continuation policy

V2 keeps stage memory enabled. Repeated loop stages may reuse their native DSH conversation for local reasoning continuity, while the baseline bundle and promotion receipt remain the authoritative cross-iteration state. Disabling memory would be functionally safe for the protocol but can discard useful unstructured source-reading context and cause repeated exploration. The DSH resume path is therefore fixed at its root: the patch overlay resolves `../profiles/headless/resume-runner.mjs` from the patch directory.

Workflow-local skills are injected by Piano as resource paths; they are not entries in DSH's global skill catalog. Workers read the injected resources directly and must not call the DSH `skill` tool by name. Workers validate domain facts and evidence digests only; Piano owns JSON Schema/projection validation after the stage returns.

Prepare is restricted to the current mission, current topsop checkout, current invocation handoffs, the V2 state namespace, and its own injected resources. Characterize executes the prepared command plan in bounded correctness, timing, and metrics/VPD batches. Neither stage may inspect Piano implementation/tests, V1 recipes, other runs, or transcripts to rediscover protocol behavior.
