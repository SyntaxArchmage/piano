"""Clean torch reference for the GEMV tuning case.

The grader owns this file; the tuning agent must NOT edit it. `verify.py`
compares the agent's `kernel.run(A, x)` against `gemv(A, x)` here.
"""

import torch


def reference(A: torch.Tensor, x: torch.Tensor) -> torch.Tensor:
    return A @ x
