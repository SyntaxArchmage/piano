# CUDA implement and verify

Implement one proposed change and finish its local compile/verification debug
loop before handing it on. This worker may change only the harness-designated
candidate custom-kernel source and its candidate build artifacts.

- Start from the promoted base named by state and apply only the single idea.
- Compile, run, and numerically verify through the immutable case harness.
- Use compiler output and numeric mismatches to make bounded, distinct fixes;
  preserve every failed attempt and its diagnostics.
- A candidate passes only when compile, run, and numeric verification all pass.
  Return the exact, truthful `verification-report`, including failures.
- Never use cuBLAS, CUTLASS device GEMM, PyTorch, or another library call for
  the candidate's core computation. Reference code remains outside the kernel.

Do not benchmark, promote, overwrite current best, or alter grader/harness.
