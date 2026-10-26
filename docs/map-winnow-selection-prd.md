# Tournament Map Selection and Winnow Consolidation — PRD

Status: **Implemented-baseline / deterministic-carry revision**
Date: 2026-09-03 (revision: 2026-10-24 — the winner carry is program work)
Stakeholders / agreed framing: the last work item before the preview release.
It turns the workflow `map` primitive from *fan-out without harvest* into a
`tournament`: branches compete, one metric-driven winner is chosen, and the
winner's work is carried back into the parent scope so downstream stages — and
later loop iterations — see the winning code.

Piano is its own loop optimiser (W4 invariant): the engine is thin. The
orchestrator **ranks** the winner (in-process, pure) and then **carries** it with
one deterministic program route per container: a Git lane is fast-forwarded, a
store lane has its frozen baseline-relative delta copied into the parent. No
worker turn decides or performs a carry, and no agent is asked to "apply
carefully". See §6, this page is the canonical statement of that design.

The voice is implementation-ready. The decision ledger records what is still open.

---

## 1. Summary

Today a `map:` region fans out over a field, runs each slot in an isolated
workspace, and then **deletes every slot** — a map can only contribute text/JSON
downstream, never code. We rename it `tournament`, add metric-driven selection
at region exit, rank a winner, and carry that winner back into the parent's
workspace so the next consumer starts from winning code.

The change is deliberately additive to the DSL (a rename, **zero new fields**):
the referee is the exit stage's single declared benchmark metric. All the
plumbing (contract-declared normalized metrics, workspace bindings, trajectory
recorders) already exists.

The merge-back is **deterministic program work**:
- The **orchestrator ranks** the winner only (pure, in-process, `selection.ts`).
- The **orchestrator carries** it: a `git-worktree` lane is committed on its
  branch and fast-forwarded onto the source; a `store-worktree` lane has the
  frozen baseline-relative delta copied into the parent, preserving modes and
  symlink targets. No worker turn is involved on either route.
- The **engine verifies once**: each declared path must equal the winner's
  content and no undeclared path may change. Any failure restores the pre-apply
  snapshot and reports `carry-failed`.

Each map-slot worker already runs in a per-slot workspace allocated once for the
whole race by source-cleanliness (a clean git source → detached worktrees; a
dirty/non-git source → directory snapshots). That container choice is
**whole-race**, never per-worker, so a tournament's workers are behaviourally
uniform; the only place strategy used to leak was the engine merge, and that is
gone. See §6.

---

## 2. Current state and the problem

### 2.1 Pre-migration `map` behavior: fan-out with no harvest

Before the tournament migration, `packages/orchestrator/src/workflow.ts`:

- `WorkflowMap` (lines 48-60): `{ name, from, over, count, entry, exit, nodes }`.
- `MAP_KEYS` (line 130): the region only carries those keys.
- compile `lowerNodes` (lines 460-620) validates scope rules and lowers the map
  to leaf stages; the map region is a pure expansion without an output contract
  of its own. `map.over` selects a `from` node; `map` regions do not carry `metrics`.
- `scheduleWorkflow` (lines 666-728) lowers to leaf stage order.

At run time (`packages/orchestrator/src/workflow-execution.ts`), `finalizeWorkspaces`
(~1853) is the only harvest path: it builds `candidates` from `request.workspace.winner`
and — if a winner is configured — calls `applyWinnerWorkspace`. But:

- `request.workspace.winner` is only ever populated by tests, never by the
  CLI/TUI; it is a host-side plugin hand-off, execution-scoped, that fires at
  the very end of the entire run (not at region exit). It is a residue of the
  deleted `drivePipeline` cascade and cannot serve the loop-carry case.
- If no winner is configured (production), the map just **drops every slot's
  workspace** and can only return flat text to downstream. Concretely: the only
  map branch result a downstream join sees today is `{ results: slots.flatMap(...) }` —
  text of every slot, with no notion of "best".

### 2.2 The winner-mechanism exists but is mis-placed and not a merge

- `materializeGpuPromotion` (lines 547-780) is CUDA/Triton-specific single-file
  promotion that demonstrates the KEEP/DISCARD semantics offline.
- `applyWinnerWorkspace` (workspace.ts) carries a winner by its lane's owner:
  a `git-worktree` lane is committed on its `tuna/<mnemonic>/lane-<n>` branch
  and fast-forwarded onto the source checkout; a `store-worktree` lane has its
  baseline-relative delta applied by `applyWorkspaceChangeSet` and verified
  against the pre-apply snapshot.
- The automatic tournament path uses that carry directly: git lanes merge,
  store lanes apply their delta. Both are program work; neither runs a worker
  turn (§6).

### 2.3 Requirements from the driving scenario

Our key scene is **implement + bench → branch into a tournament**. We are doing
tournament mode: a user implements several candidates (branches), then measures
them; the best branch becomes the winner and its edits become the parent's
golden copy. Loop-carry means a later iteration should start *from the winner
commit of the prior iteration*, not from the shared checkout.

These five decisions are agreed framing for this PRD (see also the decision
ledger in §20 of the unification PRD):

1. Letting Piano put a winning change into the user's repository is approved.
   The mechanism is the engine applying the baseline-relative winner delta into
   the parent scope (A1 §15). It touches only the delta's paths, refuses when
   the parent changed a winner path, and rolls the parent back on failure (§6).
2. Exactly one metric is allowed on the **deciding** (exit) stage; two or more
   is a workflow **validate error**, not a silent pick.
3. Regression guard: supported, generically and extensibly.
4. Keep losing-candidate refs; they are trajectory evidence.
5. Tests must cover the refined DSL *and* prove a real `map`/tournament can
   pick the best branch and really carry its change into the workspace with edits.

We rename `map` → `tournament` where the DSL literal is a node kind.

---

## 3. Terminology and shape of the old/new model

| Legacy | Proposed | Meaning |
|---|---|---|
| `map:` | `tournament:` | fan-out + metric winnow (selective carry) at region exit |
| slot / mapSlot | branch / tournamentBranch | one independent actor workspace per item |
| `over` field of `from` | unchanged | names the `from` source node; only the text before the first dot is read |
| — | worker-contract `workflow.map-items` projection | the source result array that supplies the fan items; the dotted `over` suffix is legacy-ignored |
| the region's single `exit` metrics | the referee | the exit stage must declare exactly 1 metric that is the basis |
| map-style result (slot outputs) | winner result | region boundary returns only the winning branch's terminal result to downstream |
| candidate / workspace | branch / workspace | one concrete producer state to compare |
| parent scope = the user's repo | the carry target | the engine applies the winner's complete slot-baseline-relative delta while preserving unrelated parent files (§6) |

Terminology note: The old engine emitted/drove a `workspace` copy. Under the
current shape the engine both ranks (§6.0) and applies+verifies the winner delta
(§6.2); no worker turn carries the winner. Branches are candidate states.

---

## 4. DSL declaration and semantics

### 4.1 YAML surface

```yaml
- tournament: t1            # former `map:`
  from: propose             # producer stage, resolves to an accepted result
  over: propose.strategies  # names the `from` source node; only `propose` is read
                            #   (the dotted suffix is legacy-ignored). The fan-out
                            #   array is the source contract's `workflow.map-items`.
  count: 3                  # fan-out width (how many items to keep)
  entry: implement          # a direct child stage/region that produces a workspace commit
  exit: measure             # direct child whose contract is the referee (below)
  nodes:                    # same shape as today's `map` children
    - stage: implement
      ...
    - stage: measure
      ...
```

The fan-out array is not the DSL path. The source stage's worker contract must
declare the `workflow.map-items` projection under `outputs.projections`;
scheduling fails when the source worker has no contract, the projection is
absent, or it does not resolve to an array.

The `exit` metric is the referee; see §5.2 — with `exit.metrics[]` length 1 the
ranking is unambiguous and no extra DSL select/rank field is added. Extensible
policy (significance, minimum lift, thresholds) lives in the `selection.ts`
module as an ordered evaluator list (§11), never as DSL fields, preserving both
the single-metric invariant and the W4 "thin DSL" goal.

### 4.2 Exit stage metrics are the referee

The decisive contract signal is the **exit stage's** worker contract. When a
tournament region `exit` is a validating stage, the workflow compiler must know
how many `outputs.metrics[]` entries that **exit stage's contract** declares
(not any inner measure stage's). Arity of the deciding contract drives whether
the tournament is a competition (promotes) or a fan-out/report (promotes
nothing):

- **0 metrics declared** — there is no referee, so nothing can be ranked. The
  tournament is a plain fan-out that carries text/JSON downstream and lands the
  latest slot's workspace (report-only; no winner merge). This stays **legal**
  so existing metric-less fan-out recipes and the report corpus keep working;
  an author who intends code competition simply has no referee signal yet. See
  D4.
- **exactly 1 metric declared** — a competition. The winner is the branch whose
  one exit metric wins under the declared `direction`; its frozen delta is
  applied to the parent scope on promotion.
- **2+ metrics declared** — ordering is underdetermined for a single-referee
  tournament — a **compile/validate error** (decision 2). The message names the
  worker id and lists its metric ids so an author can trim, or move the extra
  metrics to an inner report stage.

Arity is enforced at load/schedule time, where the worker contract (and its
`outputs.metrics`) is actually resolvable — not inside `compileWorkflow`, which
only sees the DSL. The check is a **validate error, not a silent runtime
guard**: a multi-metric competing exit refuses to begin. Metric-less fan-out is
not a promotion path and never carries; enforcement of that is at the region
exit in the execution engine (no referee → no winner → no carry).
See D3/D4 and §12.

At exit the runtime ranks `metrics` by the winning contract's declared
`direction`: compare `cmp(a, b)` = `>` when `direction: "higher"`, `<` when
`direction: "lower"`. The worker owns payload semantics; the DSL only says which
method to use (see also "direction keying" in §16 Q2). Practically the winner's
value is whatever makes its real internal result from the one contract source of
truth.

Concretely the runtime compares `best` values from each branch's terminal
result (its exit stage's normalized `metrics`). This is exactly how
`BenchmarkRecorder` already groups by `name/unit` and apply a direction.
`ContractMetric.value.best`, `.direction` are already there; we do not need a
new source of truth.

### 4.3 Validate-error room

The D2 arity check (2+ metrics on the deciding exit contract) is a **validate
error** raised at load/schedule time — where the worker contract is resolvable
via `workerResources`, not inside `compileWorkflow`, which never sees contracts.
A multi-metric competing exit refuses to begin. Metric-less ("0 metrics")
tournaments are legal and are deliberately *not* an error (D4). Tests live at
the load/schedule boundary: a multi-metric exit → validate error, run refuses
to begin; a metric-less tournament → legal report/fan-out, no merge. §8
acceptance states this.

---

## 5. Winning the tournament

### 5.1 Rank by a single declared post-exit result

Because metrics are normalized onto stage results (each validated exit stage
produces `metrics` with one `benchmark/v1`), the runtime can now, at region
exit, walk each branch's terminal internal result:

- The branch with a metric whose `name+unit` and `direction` are all equal is
  the ranked candidate.
- If a branch's exit carries no matching metric — including an exit whose
  result was accepted with a `validationWarning` after the one repair turn — it
  is **not a candidate**; it is a loser by construction and must be excluded
  before winner carry. A warned branch is ineligible even if a metric is present.
- If several branches tie on `best`, prefer the lowest `index` (fan order) for
  determinism; a future comparator would change the rank policy inside
  `selection.ts`, never the DSL.

Compare `best` by the metric's declared direction; this is orthogonal to loop
iteration and map-slot order. Downstream boundary:

- Today map boundary = `{ results: slots.flatMap(each slot boundary) }`
  (workflow-execution.ts ~1790). Under the new semantics the winnowed region
  returns **only the winning branch's terminal result group**, i.e. one producer
  that a downstream join may consume as a scalar `winner`. All other slot
  results are available to `allStages` for reporting but are not part of the
  map's own `boundary.results`.

Rationale: a downstream `summary` stage wants the winner's text callable, and a
dependent stage wants the metric tie. Keeping the losing lanes only in
`allStages` matches "admitted vs rejected" without making every downstream a
reviewer.

### 5.2 Default: exit metric is the ONLY referee; every inner branch is a candidate

This is the design we land on for this PRD as the minimal path. We additionally
recommend a guardrail (see decision 3) so a single regression that is merely
"worse on this exact basis" cannot silently override a better code.

### 5.3 Exclusion on map-item source errors

If `mapItems` fails because the source `from` result has fewer than `count`
items, that is today a loud workflow error (mapItems ~1612). Under tournament
this stays loud and the map does not run. A tournament never partially merges.

---

## 6. Winner carry — deterministic, program-applied

This is the canonical behaviour of a tournament winner's carry-back. It is the
heart of this PRD and supersedes both the earlier "engine ff-merge into a commit
frontier" design and the interim "worker consolidates" revision.

### 6.0 Player roles (invariant)

- **The engine ranks** — a pure in-process decision in `selection.ts`, no git,
  no file IO. Given the branches' terminal results and the deciding metric, it
  returns the winner (or no-winner on metric-less). That is ALL the engine does
  to "choose". The `workspace.winner` option is the extension point a future
  decision model (or any host plugin) plugs into; it changes *who wins*, never
  *how the winner is carried*.
- **The engine carries** — the winner's work reaches the parent by one of two
  program routes, chosen by the lane's container:
  - a `git-worktree` lane commits its worktree on the lane branch and
    fast-forwards the source (`git merge --ff-only`). Git is the delta, the
    record, and the verification.
  - a `store-worktree` lane (non-Git source, or a source that is a Git
    subdirectory, or a source that embeds the run directory) has the winner's
    baseline-relative delta (added / modified / deleted paths against the lane's
    fork commit) copied into the parent, preserving file modes and symlink
    targets.

  Neither route runs a worker turn. The carry is program work in both cases.
- **The engine verifies once** — after applying the delta it re-reads the
  parent: every declared path must equal the winner's content and no other path
  may have changed. On any failure the pre-apply snapshot is restored and the
  carry reports `carry-failed`, which stops the run and preserves every slot.

Container note: strategy (git-worktree vs store-worktree) is chosen once per
source at `allocateMapWorkspace` and is a **whole-race** property — a
tournament's slots are never a mix. Both routes report the same landed kinds
(`git-merged` / `delta-applied`), so downstream consumers are
strategy-independent.

### 6.1 The carry delta

The lane record stores the commit it forked from (`baseCommit`). The winner
delta is the Git tree difference between that commit and the winner slot's live
content, excluding the run directory. Deleted paths are represented only in the
change list; added and modified paths are copied from the slot with
`copyContentNode`, which preserves the executable and permission bits and the
raw symlink target.

The same fork commit is the parent's drift reference (every sibling forked from
it). The engine computes the parent's changes against it too, and **refuses the
carry** when the parent changed any path the winner also changed. This is the
loud failure that protects a user edit made mid-run; the winner's content stays
in its preserved slot instead of silently overwriting the parent.

### 6.2 Apply and verification

The store route applies the delta as one fail-closed step
(`applyWorkspaceChangeSet` in `workspace.ts`):

1. snapshot the parent (lstat inventory plus content) into a sibling scratch
   directory — the rollback anchor;
2. apply deletions first (a winner may replace a directory with a file), then
   copies in path-depth order, refusing symlink or non-directory ancestors and
   any protected name (`.git`, `.piano-run.lock`);
3. verify with a declared-path comparison (bytes plus full mode, or the raw
   symlink target) **and** an undeclared-change inventory: relative to the
   pre-apply snapshot, only the declared paths may differ. Directories are
   outside the delta model on purpose — Git trees never record empty
   directories or directory modes;
4. on any failure, restore the snapshot (`restoreWorkspaceLstat`, which
   verifies its own result) and report the carry as failed, naming the kept
   snapshot when even the restore could not be proven.

There is no repair loop and no worker feedback: the copy is deterministic, so
"the worker did it slightly wrong" is not a possible state. Verification exists
to catch engine defects and concurrent mutation, not agent mistakes.

### 6.3 Failure handling and safety boundaries

- A failed apply throws; the scope walker records `carry-failed`, preserves
  every tournament slot, writes no `region-finalized` record, and fails the run.
  A later `/continue` re-enters the region and re-applies the same delta, which
  is idempotent by construction (each declared path is removed before it is
  copied).
- Git metadata is never touched on the store route: the engine only copies
  files, never runs a Git command inside the source. The former
  Git-metadata observation/rollback transaction existed solely to police a
  worker turn and is gone with it.
- The check/use boundary still has a same-UID TOCTOU limitation inherent to
  path-based filesystem work; the identity check around the apply narrows but
  cannot eliminate it.

### 6.4 Why not worker-consolidation (decision record)

The interim revision handed the frozen delta to the winner's own coding-agent
worker and policed it with a Git-metadata transaction, evidence manifests,
sentinels, a read-only directory gate, and a bounded repair loop. That design
made the carry non-deterministic in three ways: the worker could apply the
delta differently (or touch nearby files), the outcome depended on a live model
turn, and the evidence machinery existed only to detect worker tampering.

The current design keeps the worker out of the carry entirely. The engine
already knows the exact delta (it derives it from Git trees), so applying it is
a program operation; verification is a program assertion; rollback is a program
snapshot. The 2026-10 revision removed `consolidation-transaction.ts` and
`git-metadata-transaction.ts` in full, and added the `delta-applied` carry kind.
`worker-consolidated` remains readable in persisted Trajectory records as a
legacy value written by older runs.

---

## 7. Extensibility without expanding the DSL

Constraining `exit.metrics[]` to length 1 on the deciding contract means the
ranking/uniqueness is deterministic purely from the worker's single metric. Any
future refinement — significance over `samples`, a minimum-lift threshold, a
per-name admission gate, an ordering hint — is delivered as a *policy function in
the `selection.ts` module* (an ordered evaluator list), **never** as a workflow DSL
keyword. This keeps the DSL thin (the W4 invariant) and the decision-2 single-
metric rule intact: nothing downstream of the region needs new syntax to mean
"compare by X". The reader only ever sees the metric on the deciding contract
(§4.2) and the policy seam in §11.

(This supersedes earlier plans to add `admit`/`rank` DSL fields. They are not
introduced; where the text already discussed them, that intent is retired.)

---

## 8. Guardrails and the win-now / adopt-later guarantee

The five agreed decisions plus the extensibility requirement land here. Because
the metric is the referee and merging back changes the user repo, we want three
policy seams that stay **engine-owned** (not DSL-enumerated today):

1. **Exclusion** — a branch whose exit never produced a deciding metric (failed,
   cancelled, or non-matching key) never becomes a candidate. Conversely, a
   *blocked* exit result (`resultPayload.status: "blocked"`/
   `decision: "BLOCKED"`) is a truthful terminal and is treated like any
   non-contender — never re-validated with a second agent turn (§17). Losers are
   excluded before ranking, so a winner is always *a valid **validated** metric
   holder*.
2. **Direction/Tie** — selection compares `best` against the metric's `direction`
   and orders ties lowest-index-first for determinism.

For decision 3 we adopt the following *generic extensible* form. Crucially, the
regression guard only has an incumbent **between loop iterations**, not on a
single pass:

- Define the *incumbent* for the tournament's deciding key
  (name+unit+direction): the **highest-admitted-accepted value of the same key
  among the branches in a *previous* repetition of this tournament**. This only
  exists when the tournament sits **inside a loop** (prior iteration's winner
  measure). A tournament at the *root* or in a single pass has no prior
  repetition, so there is **no incumbent** by construction — the map's `from`
  node ran *before* the map and is a fan source, never a same-key prior
  measure. (There is no map-instance-scoped history to check; BenchmarkRecorder
  only holds per-run accepted values, which do not distinguish "prior map
  invocation" for the root case.)
- Ranking within one tournament is always over that tournament's own branch
  results only. The regression knob is per *repetition*:
  - If there is **no prior repetition** (single pass / no older loop iteration):
    the branch with the strictly best `best` by `direction` is the winner —
    there is nothing to guard *against*.
  - If there is a **prior repetition**: an iterating win is only materialized
    when the new winner's `best` is better than the prior iteration's winner
    `best` by the deciding direction. A result equal or worse
    than the prior incumbent is `admitted-not-carried`, mirroring GPU KEEP:
    "accepted ≠ physically true" (PRD unification §5.3). Within a single
    tournament iteration we compare branches to each other, never to the prior
    iteration — that comparison is itself the promotion step.
- Order of enforcement is: (1) exclude branches without a terminating metric of
  the deciding key (Exclusion, above), (2) rank the survivors by direction and by
  lowest index on `best` ties (Direction/Tie), (3) admit the best (winner of the
  iteration), (4) regression-gate that winner against a prior repetition's
  incumbent when one exists, (5) apply and verify the winner's delta (§6.2);
  a failed apply rolls the parent back and fails the run (the admission outcome
  of the winner is recorded regardless).

Because the guards are policy functions in `selection.ts`, future guards
(significance on `samples`, minimum lift, per-name thresholds) plug into the
ordered list without touching the DSL or the runtime. See §11.

---

## 9. Loops and the tournament (the key scene)

Our key scene: `loop → tournament (implement+measure)`, iterating:

Illustrative (real DSL nests an ordered node list under `workflow.nodes`; a loop's
children are its region body):

```
workflow:
  nodes:
    - stage: strategy            # producer, accepted result
    - loop: expert-boost
      iterations: N
      nodes:
        - stage: implementation
        - tournament: measure-vs-implement
          entry: implementation
          exit:  measure
          over: strategy.results  # names producer `strategy`; suffix legacy-ignored
          # single metric on `measure` decides; incumbent = prior loop winner
```

Iteration mechanics under the winnow view:

- Iteration i starts from iteration i-1's **result of the winnow** (the carried
  winner state in the parent scope), so the inner branches that iteration i runs
  diverge from the real post-win parent state, not the shared checkout copy
  that the runner mutated. This is the reason map-slot workspaces were
  introduced at all; until now they were deleted.
- The loop-carry value of the winner was the gap in the old run-end `finalize`
  winner plugin. The implemented tournament finalization carries the winner at
  region exit, so the NEXT inner implementation begins with iteration i-1's
  resulting parent state.

---

## 10. Recording and trajectory (decision 4)

Observing policy:

- A tournament *decision* (winner chosen, why, whether merged and to which
  commit) is **recorded** so evals can re-derive it later, but recording never
  *drives* the choice — PRD unification §5.5.
- We keep the losing branch **refs** (`refs/piano/<execution>/<region>/slot-<n>`)
  on the repo for `git show`; that ref is trajectory, not logic.

The implemented trajectory stream includes `selection.jsonl`.

Each tournament invocation records the actual region-level selection shape:

```ts
{
  type: "selection",
  executionId,
  timestamp,
  referee?: { name, unit, direction },
  outcome: "carried" | "no-winner" | "metricless" | "merged",
  winnerKey?,
  commit?,
  skipped?,
  carrying?: {
    kind: "git-merged" | "delta-applied" | "admitted-not-carried" | "carry-failed",
    commit?, reason?
  }
}
```

`carried` means the winner's delta reached the parent (`git-merged` for a
fast-forwarded lane, `delta-applied` for the store route). `merged` remains a
legacy compatibility outcome, and `worker-consolidated` is a legacy carrying
kind written by runs from before the carry became deterministic; both stay
readable so old Trajectory streams still load.

The stream documents *why a branch won* (metric value, tie-break), *how the
winner reached the parent*, and *that verification passed or why not*. Evals
can recompute the winner from
`benchmark.jsonl` (tagged `instanceId`/`mapSlot`/`map-item`) and compare against
the decision record — a cross-check that matters once tournaments feed code
changes.

The recorder is added to the `defaultTrajectoryRecorders` list in
`workflow-trajectory.ts`; the evaluator `WorkflowEvaluator` then also imports it
so existing new-`index`-based evaluations see it. Old runs without the stream
still evaluate (the index records it absent) without a new version bump; see the
record of the `optional` decision in the ledger.

---

## 11. Module boundaries and new surfaces (implementation map)

The migration is implemented in the current source. The following table records
the current seams and the remaining compatibility boundaries.

| Module | Responsibility | Existing code / new |
|---|---|---|
| `workflow.ts` | DSL rename `map`→`tournament`; scope/lowering rules; the exit boundary used by runtime selection | implemented in parsing and compilation; the 2+ metric guard is load-time validation where worker contracts are available |
| `workflow-execution.ts` | tournament region exit: rank survivors by the deciding metric (Exclusion + Direction/Tie), collapse the region boundary to the winner result, and emit the selection observation | implemented by `automaticTournamentOutcome` and `finalizeTournament`; the carry itself is delegated to `workspace.ts` |
| `workspace.ts` | lane branch allocation, the winner delta, delta apply and verification | implemented by `workspaceBaselineChanges`/`applyWorkspaceChangeSet`/`diffWorkspaceChangeSet`; `applyWinnerWorkspace` fast-forwards a git lane and applies the delta of a store lane |
| `workflow-runtime.ts` | runtime lane identity and compatibility evidence fields | `slot`/`mapSlot` protocol names remain stable for the current evidence schema |
| `acceptance.ts` | record accepted invocation evidence and carry worker-contract-declared projections and winning producer references; loser lanes remain in `records`/`allStages` but are not handed to the join | generic projection transport; no worker-specific payload semantics |
| `progress.ts` | record generic stage/progress observations and per-branch progress; region count unchanged | projection-driven recording; no worker-specific payload semantics |
| `trajectory/ (types/schemas/recorders.ts, workflow-trajectory.ts)` | `selection` observation + recorder; register in default list; a new optional stream | additive, decision-4 |
| `evals/ workflow-evaluator.ts` | consume the selection stream for decision attribution | additive, consistent with §10 |
| `orchestrator/src/selection.ts` (new) | pure functions: rank, exclusion, incumbent/admittance, policy list | new, engine-owned; GPU materialization is a separate contract capability |

`selection.ts` is deliberately **pure and Effect-free** (like the DSL utilities
in workflow.ts) so it is unit-testable without a git repo. It owns only decision
math and admission/rejection with reasons, never file IO. The runtime calls it
with branch terminal `InternalStageResult`s, the deciding metric key, and the
incumbent history.

For the canonical contract path, the worker-owned
`recipes/contracts/<worker>.json` is the source of truth for stage-result,
acceptance, and progress meanings. Its presence selects validation; no workflow
switch exists. Its `outputs.projections` declare the stable
IDs, pointers, formats, and requiredness; the TypeScript modules only parse,
validate, normalize, transport, and record those projections generically. They
must not add a worker-name switch or recreate a worker's domain contract in
Piano source. Validation comes only from the worker contract.

---

## 12. Test/acceptance plan (decision 5)

Tests must prove DSL correctness AND a real git selection:

**DSL / load**
1. A fixture `tournament:` with a contract-bearing exit stage (worker
   contract declaring exactly 1 metric) parses/lowers with the same shape as a
   legacy `map:` region.
2. A `map:` key is rejected with a clear "renamed to tournament" parse
   error; a fixture using `tournament` compiles.
3. Exit stage whose worker contract declares **0** benchmark
   metrics → the tournament is a legal report/fan-out: it runs, carries
   text/JSON downstream, and records no carry at exit (no referee, no carry;
   see A2/D4).
4. Exit stage contract declaring **2+** benchmark metrics → workflow load/compile
   error listing the metric ids (decision 2). This is the "refined DSL"
   regression test.
5. `entry`/`exit` scope and `over` rules unchanged from `map`: `over` names a
   `from` node (a dotted suffix is ignored) and the fan items come from that
   source contract's `workflow.map-items` projection; exit is not consumed by a
   sibling; all children lie on the entry→exit path.

**selection module (pure, unit)**
6. rank by `best` honors direction; tie → lowest index.
7. exclusion: a branch whose exit failed/cancelled/no-metric is excluded before
   ranking and never reported as winner.

**real git e2e (the hard requirement)**
8. Seed a temp git repo (toplevel clean). A stub runner makes slot branches
   write, commit, and produce exit metrics. The engine then carries the winner
   into the parent workspace. Assert:
   - the parent workspace now *really contains* the winner's complete
     baseline-relative delta — the new file is present, a deleted file is gone,
     and an unrelated parent file remains (verified by the §6.2 delta gate, not
     by assuming a git ff);
   - losing branches are retained under `refs/piano/...` and `git show <ref>` works;
   - `selection.jsonl` attributes the winner, the carry kind, and the verification result;
   - every slot is cleaned afterward and the run leaves no stray workspace dir.

**regression guard e2e (decision 3)**
9. Repeat the tournament when the incumbent (prior accepted metric, same key) is
   strictly better than every branch: workflow completes, the parent workspace does
   **not** change, decision marks `admitted-not-carried`, and the reason records the
   incumbent value.
10. **Carry failure and rollback**: a delta path that cannot be written (for
    example a read-only parent directory) fails the carry; assert the parent is
    restored to its pre-apply snapshot, the run reports `carry-failed`, every
    slot is preserved, and no downstream stage runs.

**loop-tournament carry (the key scene)**
11. A `loop { tournament }` of ≥2 iterations where iteration-2's entry runs on
    iteration-1's carried winner; assert iteration-2's branches fork from
    iteration-1's resulting tree, i.e. the loop really saw the winner code (no
    shared-copy mutation).
12. A two-metric error on the deciding exit stage aborts the whole workflow
    before any branch runs (region refused at compile).

**pre-commit smoke** is the full focused suite (stage DSL + tournament selection
unit + real-git e2e), gated by the project's typecheck + lint gates.

GPU-specific round materialization is an explicit contract capability, not a
worker-name or `selection.ts` branch. A validating GPU worker opts in by
declaring `round.materialization-v1` and the complete required projections in
its contract file; the generic executor validates those projections and
applies the one compensating materialization transaction for the candidate,
current-best, durable state, round record, and accepted result. Future GPU
protocol changes require a new versioned capability; they do not add GPU
payload knowledge to the generic contract or selection modules. Named
validators are removed; every validating worker declares its schema in
`recipes/contracts/<worker>.json`. Existing `gpu-cuda` suites
remain loop/state tests unless they explicitly declare a tournament region.
Any legacy `workflow-loop-map` fixtures that relied on a metric-less map are
updated to declare a single exit metric (or removed) rather than silently
fanning out.

---

## 13. Compatibility windows (explicit)

- The node kind literal is renamed `map:` → `tournament:` this release. No
  recipe reads `map:` and no skill reads `map-item.json`, so the old literal is
  removed outright (rejected to alias later, R-series).
- Test fixtures that today spell `map:` switch to `tournament:`; the workspace
  record schema stays untouched.
- We DO retain the protocol field names `slot` / `mapSlot` and the ref shape
  `refs/piano/<exec>/<region>/slot-<n>` unchanged for the trajectory *and text*
  evidence until a schema v2 is warranted (D2). This PRD's *user* prose calls an
  instance a "branch", but writes it to evidence as `mapSlot`/`slot-<n>` so old
  runs keep evaluating and re-keying data is not required this release.

---

## 14. What we do NOT do (non-goals)

- No new DSL `select`/`best`/`admit`/`rank` field. The deciding exit's single
  contract metric is the only referee; any extension is a policy list inside
  `selection.ts` (see §11), not a DSL keyword (§7).
- GPU round materialization is not a `selection.ts` policy or a worker-name
  branch. It is the contract-owned `round.materialization-v1` capability
  described in §12; future changes are new versioned capabilities with the same
  generic executor boundary.
- Winner carry follows the lane's owner: a `git-worktree` lane is merged by git
  (`applyWinnerWorkspace` commits the lane branch and fast-forwards the source
  checkout), a `store-worktree` lane has its frozen delta applied and verified
  against a pre-apply snapshot (`applyWorkspaceChangeSet`). The engine ranks,
  applies, and verifies; both routes are program work (§6.0–§6.2).
- A metric-less code-competition fan-out that silently keeps a winner without a
  referee is not a promotion path: it never carries and records no winner (A2/D4).
  A metric-less `tournament` is nevertheless a legal report/fan-out (carries
  text/JSON downstream); only a multi-metric deciding contract is a compile error.

---

## 15. Decision ledger

### Accepted
- **A1. Piano may write a winner's change into the user repo (decision 1).** The
  carry happens at region exit, into the *parent workspace* binding, performed by
  the **engine's deterministic apply** (§6.0): the winner's frozen delta only,
  never a broad sync. The user asked for this; the previous worker-driven
  revision was replaced because it made the carry depend on a live model turn.
- **A2. A competing (validating) exit may declare at most one metric — 2+ is a
  workflow validate error (decision 2).** Keeps evaluation well-ordered without
  a select field. Metric *less* (0) competing exits are NOT an error: they are a
  legal report/fan-out that never carries (D4); only a contract that declares 2+
  metrics underdetermines the order and is refused at load/schedule.
- **A3. Keep losing-candidate refs; selection recorded as trajectory (decision
  4).** `refs/piano/<exec>/<region>/slot-<n>` retained; stream records why and
  whether/when a winner was carried.
- **A4. The carry is program work; no worker turn takes part.**
  The engine ranks, applies the frozen delta, and verifies it against the
  pre-apply snapshot (§6.0/6.2). A carry that cannot land restores the parent and
  records `carry-failed` rather than corrupting state.
- **A5. Carry follows the lane's owner.** Automatic metric selection carries a
  `git-worktree` winner by commit and fast-forward (`applyWinnerWorkspace`) and
  a `store-worktree` winner by applying and verifying its baseline-relative
  delta (§11). The execution-scoped winner selector remains an explicit
  selection surface and is the hook a future decision model replaces.

### Deliberate, still open (need code-prove before approval)
- **D1. Whether a non-loop single-pass tournament has meaningful use** beyond
  pure fan-out that we should keep (see §12, tests 1 & 5). The single-metric
  invariant is closed; whether the *evaluation shape itself* stays visible when
  no loop repetition ever exercises the regression guard is open. Current
  default: a tournament is still valid outside a loop when no metric-less fan
  edge case demands an exit (worker decides).
- **D2. Renaming the *runtime/evidence* wording `slot`→`branch` and the
  `mapSlot` trajectory context field now (co-shipped, breaks schema v1 text) vs
  not renaming now.** Holding the trajectory schema v1 stable matters for old
  runs; renaming the field today is possible only if we treat `mapSlot` as the
  integer it already is (evidence only). Recommendation: only rename the
  *user/marketing* noun (`branch`) while keeping the **technical/protocol**
  `map-slot` / `mapSlot` + ref word until schema v2. This keeps the artifact
  layout and trajectory records stable. To be reconfirmed with the author.
- **D3. Validation depth of the deciding metric** (mirrors §16 Q1): must the
  single metric live on the **exit stage's own contract**, or may a nested inner
  region (e.g. a `loop`) carry the metric one level deeper? Default here: the
  metric belongs on the tournament's exit stage itself, matching how a
  consumer references a region by its exit stage id. Confirm D3 == §16 Q1 before
  locking.
- **D4. Whether a metric-less `tournament` is recoverable at all.** This PRD's
  answer: **yes, as a legal report/fan-out.** A metric-less `tournament` runs,
  carries text/JSON downstream, and never carries a winner (no referee → no
  winner → no carry); it is not a promotion path and never silently keeps
  a winner (R3). Only 2+
  declared metrics underdetermine order and are refused (decision 2 / A2). This
  keeps existing metric-less fan-out estates working rather than removing them
  (A2).

### Rejected
- R1. A `map`/`tournament` key at load with multiple metrics should be a silent
  pick — rejected: decision 2 mandates a validate error.
- R2. Delivering a winner by unconditional overwrite-copy or a broad
  whole-tree sync — state must not be destroyed through a detour that removes
  user edits; the engine applies only the frozen delta, refuses when the parent
  changed a winner path, and restores its pre-apply snapshot on failure.
- R3. Winner chosen without a referee metric (by text length, "most tokens",
  arbitrary slot index, or "only the completed branch"). The exit metric is the
  only basis for ranking. If a genuine metric-less fan-out (report-only, no
  code-merge) returns, it is a distinct non-merge primitive, not a silent
  tournament; nothing depends on it today.
- R4. A per-stage `validate` executor inside the workflow for the deciding
  metric — the metric belongs to the contract, and contract presence alone
  selects validation. A 2+ metric deciding contract is
  a load error (A2); a contract-less (0-metric) tournament is a legal
  report/fan-out, not a re-validated fallback.

---

## 16. Open questions for the developer

1. **Dir-depth / D3**: the deciding metric must be on the **exit stage's own**
   contract; may a tournament terminate via an inner `region` (e.g. a nested
   `loop`) that carries the metric one deeper? For the key scene the measure is
   a direct child, so exit-stage-only (this PRD) is enough; confirm.
2. Metric **direction** and promotion policy are keyed on the worker's unit
   string (`name/unit`); sanction a unit mismatch between a `from` producer and
   an exit of a nested compare? Probably yes, allowing cross-worker challenge.
3. A metric-less `map`/`tournament` is a legal report/fan-out (never carries a
   winner); 2+ declared metrics is a load-time validation error (A2/D4). The
   automatic path carries a git lane by commit and fast-forward and a store
   lane by applying its delta, while the execution-scoped
   `workspace.winner` selector remains an explicit selection surface.

---

## 17. Relationship to the wider unification PRD

This document concerns the addition/rename of `map`→`tournament` with
metric-selection and deterministic winner carry-back. The *selection-as-trajectory*
shape and the canonical carry outcomes inherit and reuse the unification PRD's:

- §5.3 *accepted ≠ physically true* → §8 (regression guard),
- §5.4 one record stream → §10 (selection.jsonl),
- §5.5 recording observes, never drives → §10,
- §7.x worker contract examples `outputs.metrics[]` → referee location,
- §12 observation attribution `mapSlot`/item context → winner attribution,
- §16 evals reading streams and independently recomputing metrics → cross-check.

GPU round materialization is no longer activated by worker-name knowledge: it is
the contract-owned `round.materialization-v1` capability described in §12.
The generic executor consumes its declared projections and performs the
compensating transaction; future evolution is versioned capability evolution,
not a GPU-specific branch in `selection.ts`.
