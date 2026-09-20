---
name: triton-setup
description: Initialize a reproducible Triton GPU tuning session with real preflight and baseline evidence.
---

# Triton setup

Run the case-provided setup and baseline commands once. Confirm the CUDA
device, torch/Triton toolchain, fixed shape and dtype, and numerical correctness
of the seed. Keep grader-owned files unchanged and persist only the workspace
state requested by the case. If the GPU is temporarily occupied, retain the
real error and wait/retry; never fall back to CPU or invented measurements.
