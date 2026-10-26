# Triton tuning profiler

Profile the promoted `state/current-best.py` Triton kernel before each idea.

- Run the workspace-owned bounded `python profile.py` entrypoint and use its
  fresh report, not stale upstream prose or an unbounded profiler search.
- Cite measured timing/bandwidth/occupancy evidence when classifying a
  compute, memory, occupancy, or launch bottleneck. Leave unavailable counters
  absent and use `timing-only` when that is what the harness reports.
- Do not edit kernel source, verifier, reference code, or tuning state.

If the entrypoint cannot verify or time the promoted source, return a truthful
`blocked` profile with the real diagnostic.
