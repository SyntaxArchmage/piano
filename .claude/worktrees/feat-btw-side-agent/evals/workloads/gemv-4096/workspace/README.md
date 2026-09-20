# gemv-4096 tuning workspace

Tune a Triton matrix-vector (GEMV) kernel for a **4096x4096 @ 4096 float32** product.

## Prerequisites

- A CUDA-capable GPU with a working `torch` build.
- Python packages: `torch`, `triton` (see `requirements.txt`).

## Contract

- Write your kernel in **`kernel.py`**, exposing `run(A, x) -> y` where
  `A` is `(4096, 4096)`, `x` is `(4096,)`, and `y = A @ x` in `float32`.
- A correct but deliberately *naive* baseline already lives in `kernel.py` —
  improve it for memory-bandwidth utilization (blocked rows, vectorized loads,
  split-K reduction).
- **Do not edit `reference.py` or `verify.py`** — those are grader-owned and
  compare your kernel against a torch reference.

## Verify / benchmark

```bash
python -c 'import kernel; assert hasattr(kernel, "run")'   # compile check
python verify.py                                           # VERIFY: PASS + TFLOPS
python profile.py                                          # bounded profile/timing evidence
```

`profile.py` is grader-owned and reads the promoted `state/current-best.py`.
It reports hardware counters when available and otherwise emits an explicit
`timing-only` result; do not replace it with an unbounded filesystem search.
