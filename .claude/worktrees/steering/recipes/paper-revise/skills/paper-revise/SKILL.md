---
name: paper-revise
description: Apply the round's audit and review issues across the whole manuscript, deferring only what needs evidence that does not exist.
---

# Revise

Inputs: the manuscript, and the injected handoff context — the `paper-storyline`
result (whose `context` block carries the manuscript paths, the venue, the
contribution list and the reference spec path), plus this round's `paper-audit`
and `paper-review` results.

Upstream results are not workspace files: each entry in the handoff record's
`inputs[]` carries the producer's `resultPayload` under its contract id and the
`resultPath` it was written to. Read them from there.

**You are the loop's only reporter.** `finalize` runs outside the loop and
receives the region's exit stage, which is you: it sees your `revision.json` and
nothing else from the round. Any finding you resolved, deferred or rejected
without recording it is invisible to the final report, which is how a paper gets
submitted with a known hole in it. Record every outcome.

## 1. Build one work list

Merge the two lists, deduplicating issues that describe the same defect from two
angles (the audit's "no file produces 2.3x" and the review's "the abstract's
number is unsupported" are one job). Order by severity: audit blockers first
(false statements), then review blockers, then majors, then minors.

For each entry, decide the outcome **before** editing:

| Outcome | Rule |
|---|---|
| resolved | The fix is text-only. Apply it now. |
| deferred | The fix requires a measurement, figure, or datum that does not exist. Name precisely what is missing so the next round can target it. |
| rejected | The issue is wrong. Then the manuscript must be edited so the next reader does not make the same mistake — a reviewer's misreading is a clarity defect. |

Never resolve an issue by weakening the manuscript's honesty: a claim narrowed
to what is measured is a resolution, a measured-sounding claim with no basis is
not.

## 2. Apply text-only fixes

For a number: replace it with the value the source file holds, at that source's
precision, in **every** place the quantity appears — abstract, introduction,
evaluation, caption, table. A corrected number that survives in a caption is a
finding waiting to happen again.

For an unsupported claim: either delete it, or reduce it to what the evidence
supports and say what the evidence is. `first/only/always/never` claims need the
paper to establish the absence, which usually means the related-work section —
if it cannot, remove the superlative.

For a citation or reference: fix the target, or remove the sentence that needed
it.

For terminology: pick the term the manuscript uses most, propagate it, and
update the state file's terminology note so the next round does not reintroduce
the synonym.

For a structural issue: fix the ordering or the reference, not the surrounding
prose.

While editing, keep the round's storyline intact. Revising for a reviewer is not
licence to re-plan paragraphs; if a fix genuinely requires a different paragraph
order, record it as a `deferred` item with `needs: storyline` so the next round's
`paper-storyline` handles it properly.

## 3. Verify

1. Re-run every number you touched against its source. Report the comparison.
2. Confirm every fixed claim's old form no longer appears anywhere: search the
   manuscript for the removed phrasing.
3. Run the brief's compile command. Report it with its outcome. **You may not
   finish on a broken build**: the contract refuses `compiles: false`, so a
   build failure is the one item you must resolve before you are done. Revert
   the edit that caused it if that is the honest repair — an unfixed minor
   issue is cheaper than a manuscript that does not build.
   Only a build that cannot be fixed from here — a missing class file, an error
   predating the round — justifies `status: "blocked"` with a `build_blocker`.
   That stops the loop, so it is the correct answer for a genuinely dead tree
   and the wrong one for a fix you could have made.
4. Confirm the page count against the venue's limit. A revision that pushes the
   paper over length has traded one rejection for another; if so, say which
   section must give up pages.

## 4. Report

For each issue id: `resolved`, `deferred` (with `needs` and `reason`), or
`rejected` (with the reason and how the text now prevents the misreading).
Include `files_changed`, `compiles`, `compile_command`, and a short account of
anything you changed that no issue asked for — incidental edits are how a
revision introduces new defects.

Because `finalize` reads this result and nothing else from the round, the report
is the round's only hand-off: an outcome you do not record is an outcome the
paper's final report will not know about.

## 5. Self-check

- [ ] Every issue in both lists has an outcome.
- [ ] Every `resolved` number was re-checked against its file.
- [ ] No `resolved` item required evidence that does not exist.
- [ ] The manuscript compiles, with the command and its result reported.
- [ ] Page count is within the venue's limit, or the overrun is reported.
- [ ] Incidental changes are listed.
