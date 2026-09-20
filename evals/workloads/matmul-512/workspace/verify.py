"""Verify + benchmark the matmul tuning case.

Readout sequence (matches the case.yaml `readout`):
  1. compileCommand imports `kernel` and asserts `run` exists.
  2. verifyCommand (this file) checks correctness against `reference.matmul`
     and, on pass, benchmarks and prints `TFLOPS: <x>`.

The import of `kernel` is done lazily inside run_matmul so `python -c "import
verify"` does not require a compiled kernel; the actual correctness/bench steps
import it here.
"""

import sys
import time

import torch

from reference import reference

M = N = K = 512


def run_matmul():
    torch.manual_seed(0)
    A = torch.randn(M, K, device="cuda", dtype=torch.float32)
    B = torch.randn(K, N, device="cuda", dtype=torch.float32)
    C_ref = reference(A, B)

    from kernel import run  # agent-provided
    C = run(A, B)

    # Combined relative+absolute tolerance (torch.allclose semantics): f32
    # accumulation-order differences over a 512-term dot product legitimately
    # reach ~1e-4 absolute, which a pure relative metric with a 1e-6 floor
    # mis-scores as failure on near-zero outputs.
    ok = torch.allclose(C, C_ref, rtol=1e-3, atol=1e-3)
    if not ok:
        err = (C - C_ref).abs().max().item()
        print(f"VERIFY: FAIL (max abs err {err})")
        sys.exit(1)
    print("VERIFY: PASS")

    flops = 2 * M * N * K
    torch.cuda.synchronize()
    t0 = time.perf_counter()
    for _ in range(5):
        run(A, B)
    torch.cuda.synchronize()
    dt = (time.perf_counter() - t0) / 5
    print(f"TFLOPS: {flops / dt / 1e12:.4f}")


if __name__ == "__main__":
    run_matmul()
