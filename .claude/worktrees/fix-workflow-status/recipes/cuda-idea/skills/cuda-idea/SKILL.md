---
name: cuda-idea
description: Select one evidence-backed, non-repeated CUDA kernel optimization for a serial tuning round.
---

# CUDA idea

Read the fresh profile and the harness-owned history before forming a proposal.
For a runnable round, emit an `optimization-proposal` whose `strategies` array
contains exactly one strategy.

1. Identify the promoted base and inspect the complete current kernel before
   selecting a change.
2. Check prior ideas, failed attempts, and KEEP/DISCARD results. Never retry an
   identical base, parameter set, and structural change.
3. Choose one change that addresses a measured bottleneck: e.g. tile/layout,
   memory movement, pipeline depth, occupancy/register pressure, or launch
   topology. Explain the causal hypothesis and implementation risk.
4. Preserve the case's fixed inputs and kernel interface. Core computation must
   remain a custom CUDA kernel; library calls are allowed only inside the
   trusted reference path, never as the candidate's compute implementation.

Do not claim an observed speedup before measurement. Do not create several
competing strategies, modify files, or use a no-op merely to fill the schema.
