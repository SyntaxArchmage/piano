# Topsop tuning V2 plan-conformance and target-evidence gates

Date: 2026-09-16

## Scope

This change fixes two workflow defects observed in the completed V2 run
`/home/wsj/.piano/runs/20260916T091847-3e3368` without changing Piano framework
code or the V1 workflows/workers.

## Evidence and root cause

### 1. KEEP could happen before mission target metrics were measured

The run promoted `iter2-tiling-residual-wave-balance` because its median latency
improved from 123.76 us to 122.49 us and narrowly crossed the frozen 1% noise
threshold. The accepted evaluation did not profile the candidate's declared LLC
bandwidth or 1D-compute-efficiency targets. Consequently, promotion could prove
an incremental latency improvement but could not prove whether the user target
had been reached. The final summary correctly avoided claiming target success,
but that check happened after KEEP and therefore was too late.

### 2. Implement could diverge from the admitted candidate plan

The iteration-0 plan described retaining a single `private_dte` context, while
the implementation created three contexts. The resulting aggregate virtual
channel demand was 13, above the hardware limit of 11, and correctness rejected
the candidate. The analyze-to-implement handoff described a mechanism but did
not structure its implementation constraints, and the implement contract only
verified edit scope/build output. It had no pre-build proof that the produced
code still implemented the admitted plan.

## Changes

### `topsop-v2-analyze`

- Candidate plans now require `implementation_constraints`.
- Each constraint has a stable ID, kind, expected fact, and evidence references.
- Hardware/runtime facts that decide feasibility—DTE context/VC budget, L1/L2
  capacity, launch geometry, layout/alignment, synchronization, or instruction
  constraints—must be explicit when relevant to the candidate.

### `topsop-v2-implement`

- A built result now requires a `plan_conformance` ledger.
- The ledger proves candidate/base revision, edit scope, single-variable
  mechanism, and complete constraint coverage.
- Every candidate constraint records expected versus observed facts and current
  evidence. Resource-sensitive changes must contain an actual budget rather
  than a qualitative assertion.
- A mismatch gets one bounded correction attempt. If it remains mismatched, the
  worker restores the candidate edit and returns iteration-scoped
  `candidate_plan_mismatch` without building the divergent implementation.

### `topsop-v2-evaluate`

- Correctness and latency measurement remain the first gates.
- A candidate that does not cross the frozen latency threshold does not consume
  an additional target-profile run.
- A latency-eligible candidate must profile every declared mission target on the
  same artifact and runtime identity before `comparison.eligible` can remain
  true.
- Target evidence records the artifact/runtime digests and, for each target,
  metric, operator, threshold, observed value, result, and raw evidence.
- If target profiling is incomplete after one bounded retry, the timing result
  is retained but promotion eligibility becomes false with
  `target_metrics_unavailable`.
- A mission with no declared targets uses an explicit empty target ledger.

### `topsop-v2-promote`

- KEEP now verifies that target measurements exactly cover the prepared target
  declarations and belong to the same candidate artifact/runtime identity.
- The targets do not have to be reached for an incremental KEEP; they do have to
  be measured. The frozen latency threshold remains the promotion criterion.
- A promoted receipt must carry a digest-bound pointer to the accepted
  evaluation's `/target_validation` block.

### `topsop-v2-summary`

- An improved result must retain the final kept candidate's structured target
  observations and evidence rather than relying on free-form `next_action`
  text.
- It may report an incremental improvement while truthfully showing that the
  mission target is still unmet.

## Contract and compatibility boundary

- The fix is recipe-only: worker instructions, worker contracts, design docs,
  and workflow tests.
- No files under `packages/` are changed.
- No new workflow node, YAML key, handoff mechanism, or Piano runtime behavior is
  introduced.
- V1 remains untouched. V2 outputs produced under the old contracts are not
  accepted as new `built`, latency-eligible `measured`, `promoted`, or improved
  summary results.

## Regression coverage

The tests verify that:

1. analyze candidates without implementation constraints are rejected;
2. built artifacts without a complete matching conformance ledger are rejected;
3. latency-eligible evaluations without target observations are rejected;
4. unavailable target metrics can safely make a measured candidate ineligible;
5. rejected correctness results cannot carry target-performance claims;
6. KEEP receipts without a target-validation reference are rejected;
7. improved summaries without final target observations are rejected; and
8. worker instructions retain the owning-stage responsibilities.

The implementation commit ID and per-worker adjustment record are appended to
`/home/wsj/orch/record.md` after the commit is created.
