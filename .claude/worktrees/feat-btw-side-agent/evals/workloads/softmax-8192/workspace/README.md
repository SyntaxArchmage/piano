# softmax-8192 tuning workspace

Tune a Triton row-wise softmax kernel over an **8192x8192 float32** matrix.

## Prerequisites

- A CUDA-capable GPU with a working `torch` build.
- Python packages: `torch`, `triton` (see `requirements.txt`).

## Contract

- Write your kernel in **`kernel.py`**, exposing `run(X) -> Y` for row-wise
  softmax of `X` (`(8192, 8192)`, `float32`).
- A correct but deliberately *naive* baseline already lives in `kernel.py` —
  improve it (online/numerically-stable softmax, row blocks, vectorized loads,
  masking) for higher throughput.
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
