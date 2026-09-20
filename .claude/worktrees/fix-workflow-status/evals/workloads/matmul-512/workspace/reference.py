"""Clean torch reference for the matmul tuning case.

The grader owns this file; the tuning agent must NOT edit it. `verify.py`
compares the agent's `kernel.run(A, B)` against `matmul(A, B)` here.
"""

import torch


def reference(A: torch.Tensor, B: torch.Tensor) -> torch.Tensor:
    return A @ B
