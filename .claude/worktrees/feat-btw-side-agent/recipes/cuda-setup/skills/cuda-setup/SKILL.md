---
name: cuda-setup
description: Initialize a reproducible CUDA kernel-tuning session with real preflight and baseline evidence.
---

# CUDA setup

Run this once before the tuning loop. Read the task and workspace instructions
first, then use the workspace-provided harness commands rather than inventing
paths or benchmark logic.

1. Run preflight and retain its output: GPU availability, CUDA compiler/runtime,
   device architecture, profiler availability, and any required permissions.
   Discovery must be bounded: inspect the workspace and fixed locations such as
   `/usr/local/cuda*/bin/nvcc` only. Never run `find /`, recurse through `$HOME`,
   or search unrelated filesystems.
2. Confirm the target operator, exact shape/dtype/layout, and immutable grader
   digest. Do not alter any of them.
3. Use the trusted harness to build and numerically verify the initial custom
   kernel. Measure a library reference/ceiling under the same setup only when
   the workspace supplies that reference; never invent one.
4. Ask the harness to initialize the run-owned current-best state, baseline
   artifacts, and append-only history. The initial custom kernel is the first
   current best; the library reference is context only, never a candidate.
5. Return paths and real results needed by later stages. On failure, preserve
   the command, exit status, and diagnostics instead of fabricating success.

Never edit the grader, reference implementation, timing harness, target
configuration, or harness-owned state files. Do not begin an optimization in
this stage.
