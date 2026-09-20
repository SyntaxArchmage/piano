"""Naive baseline matmul kernel (Triton), 512x512x512 f32.

This is the *starting point* the tuning agent improves. It is correct but
deliberately unoptimized: a single program computes the entire 512x512 output
tile using flat, scalar loads of A and B and an explicit K-loop accumulation.
There is no tiling across programs, no `tl.dot`, no vectorized/coalesced loads,
and no loop pipelining — exactly the low-hanging fruit the agent should exploit
(tiling into programs, `tl.dot`, coalesced loads, pipelining) to raise
throughput.

The grader imports `run` only; do NOT change its signature.
"""

import torch
import triton
import triton.language as tl


@triton.jit
def _matmul_kernel(A, B, C, M: tl.constexpr, N: tl.constexpr, K: tl.constexpr):
    # Single program: one accumulator covering the whole M x N output.
    row = tl.arange(0, M)  # (M,) constexpr arange
    col = tl.arange(0, N)  # (N,) constexpr arange
    acc = tl.zeros((M, N), dtype=tl.float32)
    for k in range(0, K):
        # a: (M,) column k of A -> (M, 1); b: (N,) row k of B -> (1, N).
        a = tl.load(A + row * K + k)
        b = tl.load(B + k * N + col)
        acc += a[:, None] * b[None, :]
    tl.store(C + row[:, None] * N + col[None, :], acc.to(tl.float32))


def run(A: torch.Tensor, B: torch.Tensor) -> torch.Tensor:
    """C = A @ B for A (M,K), B (K,N), float32, on the current CUDA device."""
    M, K = A.shape
    _, N = B.shape
    C = torch.empty((M, N), device=A.device, dtype=torch.float32)
    _matmul_kernel[(1,)](A, B, C, M=M, N=N, K=K)
    return C
