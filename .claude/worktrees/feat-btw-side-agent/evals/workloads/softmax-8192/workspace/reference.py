"""Clean torch reference for the row-wise softmax tuning case.

The grader owns this file; the tuning agent must NOT edit it. `verify.py`
compares the agent's `kernel.run(X)` against `softmax(X)` here.
"""

import torch


def reference(X: torch.Tensor) -> torch.Tensor:
    return torch.softmax(X, dim=-1)
