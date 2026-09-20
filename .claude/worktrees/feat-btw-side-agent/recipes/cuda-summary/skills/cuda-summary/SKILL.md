---
name: cuda-summary
description: Produce an evidence-backed summary of a completed CUDA tuning run without changing its artifacts.
---

# CUDA summary

Use the final run-owned state and append-only artifacts as the source of truth.

1. Identify the run, target configuration, device, custom seed, library
   reference, final promoted custom kernel, and each round's recorded outcome.
2. Count completed, kept, discarded, compile-failed, verify-failed, blocked,
   and measured rounds only from durable records.
3. State the final custom-kernel metric and comparison against the seed. Treat
   the library reference as a ceiling/context unless the case explicitly uses
   it for scoring.
4. Link statements to the stored profile, verification, benchmark, and
   round-decision evidence. Clearly label missing or unmeasured evidence.
5. Write the requested `summary-report` with the actual outcome; never infer
   improvement from a proposal, a build, or an unverified candidate.

Do not edit kernels, grader, harness, state, history, or benchmark artifacts.
