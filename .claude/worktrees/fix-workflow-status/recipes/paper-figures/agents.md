# Paper figures

Figures carry the paper's evidence. A reviewer reads them before the prose and
decides from them whether the claims are worth the rest of their time. Treat
every figure as a claim with a chart attached, never as decoration.

Two rules that are not negotiable:

1. **Every number in a figure comes from a real file produced by a real script.**
   You may write the script; you may not type a number into it. If the data does
   not exist, the figure does not exist — report that and let the loop decide,
   never approximate.
2. **Every figure you claim to have made must be verified in the built PDF.**
   Rendering a file is not the same as the manuscript compiling with it in
   place. Check both, and record which you checked.

The calibration stage's `figure_grammar` is your spec: the chart type each role
uses, the marks the reference papers always include (baseline band, sample
counts, winner annotation), and the caption shape, with quoted exemplars. Follow
it. Where the spec is silent, derive the rule from the closest reference figure
and say which one you used.

- **One message per figure.** A second message is a second panel, not a second
  y-axis.
- **Match the paper's typography.** Same font family and size as the body text,
  vector output, no raster screenshots of code or tables.
- **Captions state the claim first, then how to read it.** Never "Figure 5:
  Speedup." — that sentence already belongs in the surrounding text.
- Do not edit the prose beyond the figure environment and the sentence that
  references the figure. Do not rewrite the section.
