"""Naive baseline GEMV kernel (Triton), y = A @ x for A (M,K), x (K,).

This is the *starting point* the tuning agent improves. It is correct but
deliberately unoptimized: every thread reloads the full x vector for its row,
accumulation happens in a scalar-ish loop over K with uncoalesced strided loads
of A, and there is no program-level tiling or shared-memory reuse of x —
exactly the low-hanging fruit (row tiling, coalesced loads, x caching, split-K
reduction) the agent should exploit to raise memory-bandwidth throughput.

The grader imports `run` only; do NOT change its signature.
"""

import torch
import triton
import triton.language as tl


@triton.jit
def _gemv_kernel(A, x, y, M: tl.constexpr, K: tl.constexpr):
    # Single program over all rows; each row is a full dot product with x.
    row = tl.arange(0, M)  # (M,)
    acc = tl.zeros((M,), dtype=tl.float32)
    for k in range(0, K):
        a = tl.load(A + row * K + k)   # (M,) column k
        acc += a * tl.load(x + k)      # scalar broadcast
    tl.store(y + row, acc.to(tl.float32))


def run(A: torch.Tensor, x: torch.Tensor) -> torch.Tensor:
    """y = A @ x for A (M,K), x (K,), float32, on the current CUDA device."""
    M, K = A.shape
    y = torch.empty((M,), device=A.device, dtype=torch.float32)
    _gemv_kernel[(1,)](A, x, y, M=M, K=K)
    return y
