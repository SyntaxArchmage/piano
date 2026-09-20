"""Naive baseline row-wise softmax kernel (Triton), 8192x8192 f32.

This is the *starting point* the tuning agent improves. It is correct (two-pass
max-then-sum for numerical stability) but deliberately unoptimized: each of the
8192 rows is handled by a single program doing a scalar-ish reduction loop with
uncoalesced strided loads, and there is no block tiling, no online/vectorized
reduction, and no masking — exactly the low-hanging fruit the agent should
exploit (block tiling of rows, `tl.max`/`tl.sum` over block axes, vectorized
loads) to raise throughput.

The grader imports `run` only; do NOT change its signature.
"""

import torch
import triton
import triton.language as tl


@triton.jit
def _softmax_kernel(X, Y, M: tl.constexpr, N: tl.constexpr):
    row = tl.program_id(0)
    base = row * N
    idx = tl.arange(0, N)  # (N,)

    # Pass 1: row max for numerical stability.
    m = -float("inf")
    for j in range(0, N):
        v = tl.load(X + base + j)
        m = tl.maximum(m, v)

    # Pass 2: sum of exp(x - m).
    s = 0.0
    for j in range(0, N):
        v = tl.load(X + base + j)
        s += tl.exp(v - m)

    # Pass 3: write exp(x - m) / s.
    for j in range(0, N):
        v = tl.load(X + base + j)
        tl.store(Y + base + j, tl.exp(v - m) / s)


def run(X: torch.Tensor) -> torch.Tensor:
    """Row-wise softmax of X (M,N), float32, on the current CUDA device."""
    M, N = X.shape
    Y = torch.empty_like(X)
    _softmax_kernel[(M,)](X, Y, M=M, N=N)
    return Y
