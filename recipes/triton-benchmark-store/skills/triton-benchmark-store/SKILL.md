---
name: triton-benchmark-store
description: Benchmark a verified Triton candidate and close a deterministic tuning round.
---

# Triton benchmark and store

Run the case's immutable benchmark only after compile and numeric verification.
Write real samples, raw output, decision, and digests to the requested round
result. Keep the verifier report in the workspace (for example
`reports/verify.json`) and use a relative path in `verification.report_path`;
the stage `result.json` under `~/.piano/runs` is not a workspace artifact.
Promotion and restoration belong to the orchestrator.
