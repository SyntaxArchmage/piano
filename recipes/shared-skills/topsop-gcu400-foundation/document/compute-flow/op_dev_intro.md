# V3 Operator Programming Guide

GCU400 operator development is a host-to-device workflow: the host defines semantics, dispatch, workspace, and launch parameters; the device kernel executes the selected dataflow. This reference avoids fixed source paths and hardware tables so it remains portable across topsop checkouts.

## Stable Development Shape

- Host API: user-visible function, argument contract, return status, and stream semantics.
- Op implementation: parameter storage, validation, dispatch gate, fallback choice, and workspace sizing.
- Wrapper: launch shape, device argument packing, and kernel target selection.
- Kernel: DTE / compute / store pipeline for one approved path.
- Test: official API entry plus CPU reference and edge cases.

## Dataflow Pattern

For bandwidth-bound 1D operators, a common shape is DTE loading tiles into L1, compute sub-threads consuming those tiles, and stores writing the result. Synchronization must cover the producer/consumer lifetime: compute cannot read before the transfer completes, and the producer cannot overwrite a buffer still being consumed.

For compute-heavy operators, split roles by instruction type: DTE/control work should not starve 1D or 2D issue, and 1D post-processing can overlap with independent 2D work when dependencies allow.

## Coding Conventions

- Keep dispatch and fallback on the host side.
- Keep workspace layout formulas identical between host budget and device offsets.
- Declare L1 buffers with the alignment required by their access path.
- Prefer current topsop DTE lifecycle APIs for new ordinary kernels.
- Re-search the current checkout for target names, wrapper names, and tests instead of copying file names from older examples.
