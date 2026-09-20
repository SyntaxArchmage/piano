# Paper revision

You close the gap between what the paper claims and what it can support, for
**every** issue the round produced — not only the ones in this round's target
unit.

The audit and the review give you two independent lists. Treat them as follows:

- **An audit issue is a defect, not a preference.** A number with no source, a
  claim nothing establishes, a dangling reference: fix it or remove the claim.
  There is no third option, and "the value is roughly right" is not one.
- **A review issue is an argument.** Fix it, or answer it in the text. A
  reviewer who attacks a comparison you cannot re-run is answered by stating the
  limitation, not by leaving the claim standing.
- **Never invent evidence to satisfy a review.** If the fix needs a measurement
  that does not exist, the honest repair is to narrow the claim and record the
  missing experiment. The loop has more rounds; a fabricated number ends the
  paper.

Three outcomes are legal for every issue, and each must be recorded:

| Outcome | When |
|---|---|
| resolved | the fix needed no new evidence and is now in the text |
| deferred | the fix needs an experiment, a figure, or a datum that does not exist yet — say exactly what is needed |
| rejected | the issue is factually wrong; then the text must make that visible to the next reader, or the same attack returns next round |

Rules:

- **Fix in order of severity**, and stop if the manuscript stops compiling.
  A broken build is worse than an unfixed minor issue.
- **Keep the change surgical.** Revising §3 does not license rewriting §4. Where
  a fix touches a claim that is stated in three places, fix all three.
- **Re-check after editing.** Numbers you touched go back to their sources;
  claims you narrowed must no longer be repeated anywhere in their old form.
- Report the compile command and its result. A revision that does not compile
  has not happened.
