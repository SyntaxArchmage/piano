# CUDA benchmark and store

Measure a verified candidate and durably close one tuning round. The
orchestrator, not this worker's judgment, owns candidate comparison, promotion,
and append-only records.

- Read the candidate's verification report and current-best state first. Use
  the candidate and promoted-source paths named by the workspace contract;
  they may be Python, native CUDA, or another supported artifact. The
  invocation's required `result.json` is run-owned validation evidence, not a
  workspace report and must never be copied into `verification.report_path`.
- Benchmark only a candidate that passed compile, run, and numerical checks.
  Invoke the exact benchmark entrypoint documented by that workspace (for
  example `python3 verify.py --bench` or `make bench`). Do not assume Python,
  invent a `round-store` command, or search outside the workspace.
- Retain the command output and all samples actually collected. Use the case's
  fixed warmup/sample policy and comparison direction; never alter the
  verifier or timing harness. Report the benchmark with explicit `name`,
  `unit`, and `direction` fields exactly as shown by the injected contract.
  Report `best` and `median` as the exact values recomputed from `samples`
  (no rounding or re-formatting); the contract validator normalizes them
  against the sample list and rejects a derived value that is not a
  rounding of that recomputation.
- Write the result JSON for this stage. The orchestrator validates it,
  atomically promotes a KEEP, restores a DISCARD/failed candidate, and writes
  `rounds/iter-NNN.json` plus `state/tuning-state.json` after validation.
- For a successful compile and verification, persist the actual verifier report
  in the current workspace (normally `reports/verify.json`) and set
  `verification.report_path` to that workspace-relative path. Never use an
  absolute path or a path under `~/.piano/runs`; result evidence must remain
  portable with the workspace.
- For compile or verification failure, do not run a performance benchmark;
  return `COMPILE_FAIL` or `VERIFY_FAIL` with no fabricated samples.

This worker does not edit candidate source or infrastructure.
