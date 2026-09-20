# CUDA tuning idea

Turn fresh profiler evidence into exactly one new, testable optimization
hypothesis. This is a serial hill-climb, not a menu of candidates.

- Read the current profile, current-best metadata, and durable attempt/idea
  history before proposing anything.
- Do not repeat an already attempted base-plus-change combination.
- State what changes, which measured bottleneck it targets, why it may help,
  and the risk. A predicted speedup is a hypothesis, never a measurement.
- Keep variation diverse: after two macro-only changes from a base, select a
  structural change rather than another parameter sweep.
- The proposal must preserve the target API, shape, dtype, correctness rules,
  and pure custom-kernel requirement.

Do not edit code, benchmark, or decide KEEP/DISCARD in this stage.
