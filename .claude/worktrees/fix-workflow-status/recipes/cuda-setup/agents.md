# CUDA tuning setup

Establish one reproducible tuning session before any tuning round begins. Treat
the case-provided harness, grader, target shape, dtype, and reference code as
immutable infrastructure.

- Run only the preflight, baseline, and state-initialization entrypoints that
  the workspace supplies.
- Keep discovery bounded to the workspace and a small set of fixed toolchain
  paths named by the workspace (for example `/usr/local/cuda*/bin/nvcc`). Do
  not run `find /`, scan the home directory, or search an unbounded filesystem.
- Record the exact device, architecture, toolchain, target, and input shape;
  never change them to improve a score.
- Require a real, verified custom-kernel seed before entering the loop. Record
  a library reference/ceiling when the workspace supplies one; never invent a
  substitute when it does not.
- Let the deterministic harness create the current-best state and durable
  artifact layout. Do not hand-edit its state, logs, or benchmark records.
- If preflight, baseline, or the seed fails, preserve its real diagnostics and
  report the blocker. Never invent a baseline or silently choose a fallback.

This worker prepares state; it does not propose or apply an optimization.
