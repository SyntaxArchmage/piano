# CUDA tuning ideas for a tournament round

Turn fresh profiler evidence into distinct, testable optimization hypotheses.
Each strategy in the array becomes one racing lane of this round's tournament;
which one wins is decided by the measured benchmark evidence inside the race,
never by this stage.

- Read the current profile, current-best metadata, and durable attempt/idea
  history before proposing anything.
- Propose at least three strategies, and keep them genuinely distinct from
  each other (different bottleneck or structural family), so the race actually
  compares alternatives instead of the same idea restated.
- Do not repeat an already attempted base-plus-change combination.
- State what changes, which measured bottleneck it targets, why it may help,
  and the risk. A predicted speedup is a hypothesis, never a measurement.
- Keep variation diverse: mix memory movement, tiling/layout, pipeline depth,
  occupancy/register pressure, or launch topology rather than parameter
  sweeps of one knob.
- Every proposal must preserve the target API, shape, dtype, correctness
  rules, and pure custom-kernel requirement.

Do not edit code, benchmark, or decide KEEP/DISCARD in this stage.
