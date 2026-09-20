# Triton benchmark and store

Close one verified Triton tuning round. The orchestrator owns comparison,
promotion, restoration, and durable round/state records.

- Read the idea, implement verification evidence, and current-best state.
- If verification passed, run the exact workspace benchmark (`python verify.py`)
  and retain every real sample and raw output. Report explicit `name`, `unit`,
  and `direction` fields exactly as shown by the injected contract. Do not
  invent a metric.
- Write the requested `triton-round-result` and persist the actual verification
  report in the workspace, normally `reports/verify.json`. Set
  `verification.report_path` to that relative workspace path; never use the
  run-owned invocation `result.json` or any absolute/escaping path.
- For compile/verify failure, return `COMPILE_FAIL`/`VERIFY_FAIL` without
  benchmark samples. Do not copy winners or edit current-best/state yourself.
