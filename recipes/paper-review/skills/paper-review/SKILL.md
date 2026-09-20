---
name: paper-review
description: Review the manuscript as the target venue's reviewer would, score it against the venue's bar, and name the unit the next round should fix.
---

# Review

Deliverable: a review a real program committee would recognize, plus
`next_round_target` — the loop's steering signal.

Read the manuscript and the injected handoff context: the `paper-storyline`
result — whose `context` block is the only place this stage can learn the venue,
the page limit, the core claim, the contribution list and the reference spec
path — plus this round's `paper-draft`, `paper-figures` and `paper-audit`
results.

Upstream results are not workspace files: each entry in the handoff record's
`inputs[]` carries the producer's `resultPayload` under its contract id and the
`resultPath` it was written to. Read them from there.

The audit result is not your job repeated: it checks truth against files, you
judge
whether the paper, as it stands, earns its page budget at this venue.

## 1. First pass — the ninety-second read

Read as a reviewer with a stack of submissions, in this order: title → abstract
→ introduction → figures → conclusions. Then write down, before reading the
methodology:

- **What did you believe the paper claims?** (If this differs from
  `brief.core_claim`, the paper's framing is broken, not your reading.)
- **What did you believe the headline result is?**
- **What, specifically, will you check first?**

Record these. Where the first pass diverges from the intent, that divergence is
itself the highest-severity finding, because most reviewers never get past it.

## 2. Score against the venue's bar

Six dimensions, each scored 1–5 with a one-sentence justification tied to
evidence in the paper:

| Dimension | The question |
|---|---|
| novelty | Is the delta over the closest prior work stated and real? |
| rigor | Are the claims supported by the method and the measurements? |
| evaluation | Are the baselines fair, the shapes representative, the spread shown? |
| clarity | Could a competent reader reproduce the artifact from the text? |
| reproducibility | Data, scripts, and evaluation protocol available and honest? |
| significance | Does it change what a practitioner would do? |

The overall `verdict` must follow from these scores at the venue's standard —
a submission with three 2s is not a weak accept because the writing is nice.
State `confidence` as the reviewer's familiarity with the area (1–5).

## 3. Issues — the attack list

For each issue, all five fields:

| Field | Content |
|---|---|
| id | `R1`, `R2`, … |
| severity | `blocker` (would sink the paper), `major` (must fix), `minor` |
| attack | The reviewer's sentence, written as they would write it |
| evidence | The section, figure, or table the attack points at |
| fix | What would defuse the attack, stated as an action |
| would_change_mind | What evidence or edit would satisfy it |

Hunt these specifically, because they are what gets papers rejected:

- **The closest prior work.** Is it cited, characterized accurately, and
  differentiated on a real axis? An uncited nearest neighbour is a `blocker`.
- **Baseline fairness.** Same shapes, same hardware, same tuning effort. A
  baseline that is weaker than what a reviewer would run invalidates the
  comparison.
- **Claim-to-evidence reach.** Every contribution in the brief — which
  artifact establishes it? A contribution whose evaluation is a figure with two
  data points is not established.
- **Reproducibility.** Could the evaluator reproduce it? Are the configurations,
  shapes, and metric definitions stated?
- **Limitations.** Is what the evaluation does *not* cover stated? Missing
  limitations read as unawareness.
- **Page budget.** Does any section carry more than its share, or is a needed
  section squeezed? Over-length submissions get rejected without review.

## 4. Name the next target

`next_round_target` = the unit the next round should attack, with a one-sentence
reason, chosen by the size of the gap between what the paper needs and what it
has. This field steers the loop: if it names a unit whose evidence does not
exist, say so in `storyline_notes` so the loop can target the next-worst unit
instead.

Also put your **storyline judgement** in `storyline_notes`: did the round's arc
work? Where did the paper lose you, and at which paragraph? That is the note the
next round's storyline most needs, and it is the one only a reader can supply.

## 5. Self-check

- [ ] The first pass was written before reading the methodology.
- [ ] Every score has a justification anchored in the paper.
- [ ] Every issue has an attack, an evidence pointer, a fix, and a
      would-change-my-mind.
- [ ] `next_round_target` is one unit, and its evidence situation is stated.
- [ ] Findings you could not resolve are reported as the reviewer's uncertainty,
      not omitted.
