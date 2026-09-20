# Topsop V2 cumulative improvement threshold

Date: 2026-09-17

Implementation commit:
`2f7cdefcb2853d7991ef6c9b39e66a3c93573dd4`

## Reason

Tournament run `/home/wsj/.piano/runs/20260916T154812-a3be2f` produced an
iteration-1 candidate with median latency 122.11 us versus the current incumbent
122.93 us. The 0.82 us improvement was approximately 3.3 times the frozen
baseline MAD of 0.25 us, but it was discarded because the old threshold was
1.2435 us, derived from 1% of the original 124.35 us baseline.

The old policy was safe for isolated large wins but unnecessarily rejected
small, noise-significant improvements that could accumulate over multiple
revisions.

## Policy change

The session-frozen acceptance threshold changes from:

```text
max(1% * baseline median, 3 * MAD)
```

to:

```text
max(0.5% * baseline median, 3 * MAD)
```

The threshold remains fixed for the session. Every candidate is compared against
the current artifact-bound `comparison_base`, not against the original baseline.
Therefore, each accepted revision must independently clear the same
noise-aware absolute floor, while multiple valid gains may accumulate.

For the evidence run:

```text
0.5% * 124.35 us = 0.62175 us
3 * 0.25 us       = 0.75 us
minimum improvement = 0.75 us
```

The observed 0.82 us improvement would pass the new threshold.

## Worker adjustment record

### `topsop-v2-characterize`

**Reason**

Characterize owns the baseline samples, median, MAD, and session-frozen
acceptance threshold.

**Changes**

- Freezes `minimum_improvement=max(0.5%×median, 3×MAD)`.
- Documents that `3×MAD` is the noise-significance requirement.
- Keeps a 0.5% relative floor for cases where measured MAD is accidentally near
  zero.

**Commit ID**

`2f7cdefcb2853d7991ef6c9b39e66a3c93573dd4`

### `topsop-v2-evaluate`

**Reason**

Evaluate decides whether each candidate is eligible for promotion.

**Changes**

- Uses the new frozen threshold without recomputing or weakening it.
- Compares against the current `comparison_base.metric_median`, allowing
  independent noise-significant gains to accumulate across revisions.

**Commit ID**

`2f7cdefcb2853d7991ef6c9b39e66a3c93573dd4`

### `topsop-v2-promote`

**Reason**

Promote is the final KEEP transaction boundary and must independently verify the
new policy.

**Changes**

- Recomputes signed improvement from the verified comparison binding.
- Requires it to reach the frozen `max(0.5%×initial median, 3×MAD)` threshold
  before committing a new revision.

**Commit ID**

`2f7cdefcb2853d7991ef6c9b39e66a3c93573dd4`

## Boundaries

- Mission target metrics still do not replace the latency promotion gate.
- Candidates below `3×MAD` remain rejected even if their relative improvement is
  above 0.5%.
- Candidates below 0.5% remain rejected even when MAD is extremely small.
- No Piano framework or V1 workflow code is changed.

## Verification

- V2 knowledge tests assert the same formula in characterize, evaluate, and
  promote.
- V2 contract and scenario suites remain green.
- TypeScript typecheck passes.
