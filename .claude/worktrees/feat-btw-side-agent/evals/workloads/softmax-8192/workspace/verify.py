"""Verify + benchmark the row-wise softmax tuning case.

Readout sequence (matches the case.yaml `readout`):
  1. compileCommand imports `kernel` and asserts `run` exists.
  2. verifyCommand (this file) checks correctness against `reference.softmax`
     and, on pass, benchmarks and prints `TFLOPS: <x>`.
"""

import sys
import time

import torch

from reference import reference

M = N = 8192


def run_softmax():
    torch.manual_seed(0)
    X = torch.randn(M, N, device="cuda", dtype=torch.float32)
    Y_ref = reference(X)

    from kernel import run  # agent-provided
    Y = run(X)

    # Combined relative+absolute tolerance (torch.allclose semantics): f32
    # exp/sub/div over an 8192-wide row legitimately accumulates roundoff, which
    # a pure relative metric with a 1e-6 floor mis-scores on near-zero outputs.
    ok = torch.allclose(Y, Y_ref, rtol=1e-3, atol=1e-3)
    if not ok:
        err = (Y - Y_ref).abs().max().item()
        print(f"VERIFY: FAIL (max abs err {err})")
        sys.exit(1)
    print("VERIFY: PASS")

    # elementwise ops ~ 5 * M * N flops (exp, add, div)
    flops = 5 * M * N
    torch.cuda.synchronize()
    t0 = time.perf_counter()
    for _ in range(20):
        run(X)
    torch.cuda.synchronize()
    dt = (time.perf_counter() - t0) / 20
    print(f"TFLOPS: {flops / dt / 1e12:.4f}")


if __name__ == "__main__":
    run_softmax()
