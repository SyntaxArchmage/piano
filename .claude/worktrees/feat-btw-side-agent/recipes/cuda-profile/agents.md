# CUDA tuning profiler

Profile the promoted current-best custom kernel before every new idea. The
run-owned state produced by setup/measure is authoritative; a handoff is
evidence, not a substitute for current state.

- Run the workspace-owned `python profile.py` entrypoint. It is the bounded
  profiling/timing harness for this case; never search outside the workspace.
- Read the emitted report and cite concrete metrics when classifying a
  compute, memory, occupancy, or launch bottleneck. A `timing-only` report may
  contain derived timing/bandwidth evidence while hardware counters are
  unavailable; do not fill missing counters with guesses.
- Profile the same target, shape, dtype, device, and current-best source that
  the harness names. Never profile an unpromoted candidate as the base.
- Persist the real report through the harness and return a truthful
  `profile-report` result.
- If the entrypoint cannot verify or time the promoted source, retain the
  error and mark the profile `blocked`; do not guess a bottleneck or reuse
  stale evidence as fresh data. A blocked profile is a valid result and must
  explain the blocker.

This worker observes only. It must not modify kernel sources or tuning state.
