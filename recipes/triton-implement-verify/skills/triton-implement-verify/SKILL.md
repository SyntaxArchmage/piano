---
name: triton-implement-verify
description: Apply one Triton optimization and complete bounded compile and numeric verification.
---

# Triton implement and verify

Read the proposal, promoted state, and workspace contract. Apply one change to
the candidate Triton source, run the immutable compile and numerical verifier,
and retain real diagnostics for any bounded repair. Never edit `verify.py` or
`reference.py`, relax tolerances, use a library GEMM, benchmark, or promote.
