---
name: cuda-profile
description: Produce real profiler evidence for the promoted CUDA kernel before one tuning idea is proposed.
---

# CUDA profile

Every tuning round starts with a fresh profile of the current best. Read the
latest harness-owned state and the upstream evidence, then invoke the case's
profiling entrypoint on exactly that promoted source.

1. Verify the source identity, target configuration, device, and round number
   from state before running the profiler.
2. Run `python profile.py` from the workspace and retain its raw JSON report at
   the path it emits. This is a bounded case-owned entrypoint; do not run
   `find /`, inspect unrelated directories, or invent a profiler command.
3. Extract hardware-counter metrics when available. If the entrypoint reports
   `timing-only`, keep the missing counters absent and cite only its measured
   timing/derived bandwidth evidence.
4. Classify at least one bottleneck as `compute`, `memory`, `occupancy`, or
   `launch`, with a concise citation to the measured evidence. If verification
   or timing cannot run, return `status: blocked` with the real blocker.
5. Write the requested `profile-report` JSON using measured values only; never
   turn an unavailable counter into zero.

Do not replace a failed profile with intuition, a prior round's numbers, or
synthetic zeros. Do not edit source, grader, harness, or current-best state.
