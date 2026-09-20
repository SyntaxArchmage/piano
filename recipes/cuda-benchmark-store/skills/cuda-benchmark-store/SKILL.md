---
name: cuda-benchmark-store
description: Benchmark a verified CUDA candidate and use the deterministic harness to record and promote a round result.
---

# CUDA benchmark and store

Close one round from the workspace's grader-owned verifier. The orchestrator
is the deterministic store: it validates this worker's result and performs
promotion/restoration and durable round/state writes after the worker exits.

1. Read the idea, verification report, and current-best state. Use the
   candidate and promoted-source paths named by the workspace contract; the
   artifact may be Python or native CUDA. The stage invocation `result.json`
   path is outside the workspace and is validation evidence only; it is not a
   valid `verification.report_path`.
2. If verification passed, run the exact grader benchmark entrypoint documented
   by the case (for example `python3 verify.py --bench` or `make bench`). Keep
   the real output, including `VERIFY: PASS` and `TFLOPS: <number>` when the
   case emits them; do not search for or invent a `round-store`/CUDA-event
   executable.
3. Persist the actual verification evidence in the workspace (normally
   `reports/verify.json`) and use that relative path in
   `verification.report_path`. Absolute paths, `..` escapes, and run-owned
   `/.../invocations/.../result.json` paths are invalid. Compare the measured
   candidate value with the current-best metric using the
   case direction and threshold. Write the requested `cuda-round-result-v2` to
   the supplied result path, including a real candidate digest, raw benchmark
   path/output, and `KEEP` or `DISCARD`.
4. If compile or verification failed, do not benchmark. Write `COMPILE_FAIL` or
   `VERIFY_FAIL` with `verification.compile_passed` / `verify_passed` set
   truthfully and omit `benchmark`.
5. Do not copy a winner or edit the promoted source or tuning-state file
   yourself. After validation the orchestrator
   atomically performs that work and writes `rounds/iter-NNN.json`; report
   those paths in `records`.

`benchmark` can describe only an actual measurement. Never invent samples,
runs, or a benchmark result just to satisfy validation.
