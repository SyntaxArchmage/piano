# cuda-matmul-tuning workspace

Tune a native C++/CUDA GEMM for **512x512x512 float32** matrices. This is a
separate native CUDA case; the existing Python/Triton `matmul-512` case is not
changed or reused.

## Contract

- `matmul.cu` is the mutable candidate source and must compile standalone with
  `nvcc -O3 -std=c++17`.
- Keep the command-line interface: `--verify` performs a CPU-reference check
  and prints `VERIFY: PASS`/`VERIFY: FAIL`; `--bench` prints `KERNEL_MS` and
  `TFLOPS` for the same fixed problem.
- Candidate computation must be a custom CUDA kernel. Do not use cuBLAS,
  CUTLASS, PyTorch, or another library GEMM implementation.
- `verify.py`, `profile.py`, and `setup.py` are grader-owned harness entrypoints;
  do not edit them.

## Harness entrypoints

```bash
python3 setup.py                 # compile/verify seed and initialize state/
python3 verify.py --compile     # compile matmul.cu
python3 verify.py --verify      # correctness only
python3 verify.py --bench       # bounded benchmark; emits TFLOPS
python3 profile.py              # profile state/current-best.cu
```

The tuning workflow owns these run-local paths:

- `state/current-best.cu`: promoted source for the next profile/round.
- `state/tuning-state.json`: current-best metadata and append-only history.
- `candidates/iter-NNN.cu`, `rounds/iter-NNN.json`: round artifacts created by
  the orchestrator and worker.

All toolchain discovery in the harness is bounded to `PATH` and
`/usr/local/cuda*/bin`; no system-wide search is needed.
