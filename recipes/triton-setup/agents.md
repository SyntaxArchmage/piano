# Triton tuning setup

Establish one reproducible Python/Triton GPU tuning session before any round.
Treat the case verifier, reference implementation, target shape, dtype, and
Triton entrypoints as immutable infrastructure.

- Run only the workspace-provided preflight, baseline, and state-initialization
  entrypoints. Confirm the real CUDA device, torch, and Triton versions.
- Require a real, numerically verified Triton seed and record its baseline.
  Never substitute CPU, a fake metric, or a library GEMM for the candidate.
- Let the deterministic harness own `state/`, logs, and benchmark records.
  Report a real blocker when preflight or the seed fails; do not guess.

This worker prepares state; it does not propose or apply an optimization.
