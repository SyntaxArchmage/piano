# Topsop V2 lane failure isolation and comparison-base binding

Date: 2026-09-17

## Scope

This change fixes two defects observed in tournament run
`/home/wsj/.piano/runs/20260916T154812-a3be2f` without changing Piano framework
code or the V1 topsop workflow.

Implementation commit:
`63582f0f001535998fdace3c8975c5b969da96ea`

## Evidence and root cause

### 1. A temporary executor failure stopped the whole tournament

Iteration 1 lane 0 observed repeated `spawn bash ENOENT` and `ripgrep launch
failed` errors in its DSH tool session. The worker returned
`executor_unavailable` with `scope=run` and `block_scope=global`. Piano therefore
skipped that round's promote stage even though lanes 1 and 2 subsequently built
and measured normally.

The later healthy lanes prove that the evidence did not establish a run-wide or
host-wide outage. A single actor/tool-session failure was incorrectly widened to
the whole tournament.

### 2. Evaluate could choose the wrong incumbent median

Iteration 1 lane 1 correctly compared against the promoted revision-2 incumbent
at 122.93 us. Lane 2 compared against the original characterize baseline at
124.35 us. The existing contract carried only a free-standing
`comparison.baseline_median`, so the worker could select either value without a
machine-visible binding to the candidate's base artifact and state revision.

## Worker adjustment record

### `topsop-v2-analyze`

**Reason**

The candidate plan is the first point at which the current durable incumbent and
the candidate base are joined. The comparison baseline must be frozen there,
not reconstructed later by evaluate.

**Changes**

- Candidate plans now require `comparison_base` containing state revision,
  artifact digest, artifact identity, and incumbent metric median.
- Round 0 derives it from characterize; later rounds derive it from the previous
  accepted promotion/evaluation.
- `executor_unavailable` is contractually restricted to `kind=internal`,
  `scope=iteration`, `retryable=true`, and `block_scope=iteration`.
- Tournament instructions explicitly forbid widening one actor/tool-session
  failure to the whole run.

**Commit ID**

`63582f0f001535998fdace3c8975c5b969da96ea`

### `topsop-v2-implement`

**Reason**

Evaluate receives implement directly. Implement must therefore preserve the
incumbent binding instead of forcing evaluate to rediscover it from unrelated
handoff context.

**Changes**

- A built artifact now requires a digest-bound `comparison_base` copied from the
  admitted candidate plan.
- Instructions require its revision/artifact identity to match the candidate
  base before editing and require verbatim propagation after build.
- `executor_unavailable` is contractually iteration-scoped and retryable, so the
  failed lane has no candidate artifact but cannot globally terminate the race.

**Commit ID**

`63582f0f001535998fdace3c8975c5b969da96ea`

### `topsop-v2-evaluate`

**Reason**

A free-standing baseline number allowed different lanes in the same round to
compare against different incumbents.

**Changes**

- Measured results now require `comparison_base` propagated from implement.
- The legacy free-standing `comparison.baseline_median` field was removed.
- Signed and relative improvement must use
  `comparison_base.metric_median`; only `minimum_improvement` remains frozen by
  characterize.
- The worker must verify state revision and artifact identity before measuring.
- `executor_unavailable` is iteration-scoped and produces no referee, allowing
  other healthy lanes to remain eligible for tournament selection.

**Commit ID**

`63582f0f001535998fdace3c8975c5b969da96ea`

### `topsop-v2-promote`

**Reason**

Promotion is the final transaction boundary and must not trust inconsistent
derived comparison values from evaluate.

**Changes**

- Promote verifies `comparison_base` against the durable incumbent.
- It recomputes signed/relative improvement from the bound incumbent median and
  candidate median before KEEP.
- Durable history records the verified `comparison_base.metric_median` as the
  baseline median.

**Commit ID**

`63582f0f001535998fdace3c8975c5b969da96ea`

## Framework boundary

No files under `packages/` were changed. Existing Piano tournament semantics
already ignore iteration-scoped blocked lanes when another lane has a valid
referee. The fix uses worker-owned contracts and instructions to classify the
failure correctly and to carry the incumbent identity explicitly.

## Regression coverage

- Analyze, implement, and evaluate contracts accept only iteration-scoped,
  retryable `executor_unavailable` failures and reject global/run-scoped forms.
- Analyze candidate, built artifact, and measured evaluation all require the
  incumbent `comparison_base` binding.
- Evaluate no longer defines the ambiguous free-standing
  `comparison.baseline_median` field.
- Existing tournament runtime coverage verifies that an iteration-scoped
  blocked lane cannot beat or stop a healthy measured lane.
- Contract, scenario, knowledge-routing, focused tournament runtime tests, and
  TypeScript typecheck pass.
