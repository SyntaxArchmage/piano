"""Verify + benchmark the GEMV tuning case.

Readout sequence (matches the case.yaml `readout`):
  1. compileCommand imports `kernel` and asserts `run` exists.
  2. verifyCommand (this file) checks correctness against `reference.gemv`
     and, on pass, benchmarks and prints `TFLOPS: <x>`.
"""

import sys
import time

import torch

from reference import reference

M = N = 4096


def run_gemv():
    torch.manual_seed(0)
    A = torch.randn(M, N, device="cuda", dtype=torch.float32)
    x = torch.randn(N, device="cuda", dtype=torch.float32)
    y_ref = reference(A, x)

    from kernel import run  # agent-provided
    y = run(A, x)

    # Combined relative+absolute tolerance (torch.allclose semantics): f32
    # accumulation-order differences over a 4096-term dot product legitimately
    # reach ~1e-4 absolute, which a pure relative metric with a 1e-6 floor
    # mis-scores as failure on near-zero outputs.
    ok = torch.allclose(y, y_ref, rtol=1e-3, atol=1e-3)
    if not ok:
        err = (y - y_ref).abs().max().item()
        print(f"VERIFY: FAIL (max abs err {err})")
        sys.exit(1)
    print("VERIFY: PASS")

    flops = 2 * M * N
    torch.cuda.synchronize()
    t0 = time.perf_counter()
    for _ in range(50):
        run(A, x)
    torch.cuda.synchronize()
    dt = (time.perf_counter() - t0) / 50
    print(f"TFLOPS: {flops / dt / 1e12:.4f}")


if __name__ == "__main__":
    run_gemv()
