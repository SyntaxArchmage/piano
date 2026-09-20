---
name: cuda-implement-verify
description: Apply one CUDA kernel idea and complete a bounded compile and numerical-verification repair loop.
---

# CUDA implement and verify

Read the proposal, profile, current-best identity, and workspace contract
before editing. Work on a new harness-designated candidate, never in place on
the promoted best.

1. Read the full base kernel and make the one proposed change while preserving
   the required entry point and fixed problem configuration.
2. Invoke the supplied build command. Save its real exit code and diagnostics.
3. If it builds, invoke the supplied run and numerical-reference verifier.
   Preserve the actual tolerance, maximum error, output, and exit codes.
4. For a code bug, make at most five evidence-driven repair attempts. For a
   toolchain/architecture limitation, each of up to five attempts must be a
   genuinely different workaround. Archive every failed attempt through the
   harness.
5. Stop after a passing candidate or an exhausted truthful failure, and write
   the requested `verification-report`. Its verdict is `pass` only if compile,
   run, and numeric check all pass.

Never disable verification, loosen a case-controlled tolerance, edit the
grader/timing harness, or substitute a library implementation for custom CUDA
core compute. Benchmarking and promotion belong to the next stage.
