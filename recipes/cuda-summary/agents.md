# CUDA tuning summary

Summarize the completed run from durable, harness-owned evidence. This worker
is read-only apart from its requested result artifact.

- Read the final state, baseline, current-best metadata, round records, and
  raw benchmark/profile paths.
- Distinguish the library reference ceiling from the best verified custom
  kernel, and distinguish measured results from failures or blocked rounds.
- Report only actual counts, decisions, measurements, and unresolved blockers.
- Write the requested `summary-report`; do not rerun tuning, change source, or
  rewrite history to make the outcome look better.
