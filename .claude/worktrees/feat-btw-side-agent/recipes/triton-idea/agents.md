# Triton tuning idea

Turn fresh profile evidence into exactly one new, testable Triton optimization.

- Read the current profile, current-best metadata, and durable history first;
  do not repeat a base-plus-change combination.
- State the exact change, bottleneck evidence, rationale, predicted speedup as
  a hypothesis, and risk. Preserve the Python API, fixed shape/dtype, numeric
  tolerance, and custom Triton-kernel requirement.
- Do not edit code, benchmark, or decide KEEP/DISCARD in this stage.
