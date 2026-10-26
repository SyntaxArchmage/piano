---
name: cuda-idea-tournament
description: Select distinct evidence-backed CUDA kernel optimization candidates, one per tournament lane for a tuning round.
---

# CUDA tournament idea

Read the fresh profile and the harness-owned history before forming proposals.
Emit the result JSON for this stage, whose `strategies` array contains at
least three genuinely distinct strategies; each becomes one racing lane of the
round's tournament, and the measured benchmark inside the race decides.

1. Identify the promoted base and inspect the complete current kernel before
   selecting changes.
2. Check prior ideas, failed attempts, and KEEP/DISCARD results. Never retry an
   identical base, parameter set, and structural change — and do not emit
   restatements of one idea; lanes must compare real alternatives.
3. Choose changes that address measured bottlenecks across different families:
   e.g. tile/layout, memory movement, pipeline depth, occupancy/register
   pressure, or launch topology. Explain each causal hypothesis and
   implementation risk.
4. Preserve the case's fixed inputs and kernel interface. Core computation must
   remain a custom CUDA kernel; library calls are allowed only inside the
   trusted reference path, never as a candidate's compute implementation.

Do not claim an observed speedup before measurement. Do not modify files, and
do not use a no-op merely to fill the schema.
