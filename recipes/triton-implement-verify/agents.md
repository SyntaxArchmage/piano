# Triton implement and verify

Apply one proposed change to the candidate `kernel.py`, then finish its bounded
compile/run/numeric verification repair loop.

- Start from the promoted source named by state and edit only the candidate
  Triton kernel. Preserve `run(A, B)`, fixed shape/dtype, and grader rules.
- Run the workspace compile and `python verify.py` commands, retaining real
  output, exit codes, and numeric errors. Make only evidence-driven repairs.
- Return a truthful `verification-report`; `verdict: pass` requires compile,
  run, and numeric checks to pass. Do not benchmark or promote the candidate.
