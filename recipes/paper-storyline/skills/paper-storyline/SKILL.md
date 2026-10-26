---
name: paper-storyline
description: Choose the round's target unit, define its paragraph-level storyline, and prove the narrative gate before anything is written.
---

# Storyline

Five layers. This stage owns 0–3; `paper-write` owns 4–5. Never skip a layer, and
never re-open a confirmed layer without a stated reason.

```
L0 core claim + contributions   (from the brief; refined, never invented)
L1 section outline + page budget (from the reference spec)
L2 subsection jobs
L3 paragraph storyline  ← the gate lives here
L4 writing plan                 (paper-write)
L5 prose                        (paper-write)
```

Read the injected accepted-input context: the `paper-brief` result, the
`paper-calibration` result (whose `reference_spec_path` names the durable spec),
the previous round's `paper-review` issues when the loop fed them back, and
`<state_dir>/storyline-state.md` if it exists. `<state_dir>` is
`brief.manuscript.state_dir`, relative to `brief.manuscript.root`.

Upstream results are not workspace files: each entry in the `inputs.json`'s
`inputs[]` carries the producer's worker name, `resultPayload`, and the
`resultPath` it was written to. Read them from there.

Also read the current manuscript — the storyline must describe the paper that
exists, not the one you wish existed.

## 0. Forward the context the rest of the round needs

**This stage is the loop's only gateway to everything outside it.** Inside the
loop a stage may reference only its own siblings, so the brief and the reference
spec reach `figures`, `write`, `audit`, `review` and `revise` through this
result and through nothing else. Two fields carry them, and both are required:

- **`context`** — copy the core claim, the venue, the manuscript's root / entry /
  compile / figures_dir, the reference spec path, the state dir, the evidence
  roots, and the contribution list out of the brief and calibration results
  **verbatim**. A paraphrase loses the precision the later stages check against,
  and an omitted field is a document that will not arrive. `paper-review`, in
  particular, cannot judge at the venue's bar if the venue is not here, and
  `paper-audit` cannot check a number against its source if `evidence` is not
  here — its whole job is the comparison.
- **`figure_directives`** — the same rule for figures. The review's figure
  findings reach `paper-figures` only as entries in this array. Read the review
  result, extract every finding about a figure (its role, its marks, its caption,
  its reading instruction), and turn each into an executable directive with the
  issue id that motivated it. An empty array is legal and means "no figure
  change this round"; an array that silently drops a review finding is the
  failure this field exists to prevent, and nothing downstream will notice.

Do this before the layers below, because it is the part of this result that
other stages depend on and the part you are most likely to treat as boilerplate.

## 1. Choose the round's target

Score each candidate unit on **claim gap** (how far the current text is from what
the core claim requires) and **evidence readiness** (are the numbers and figures
already on disk?). Pick the unit with the largest claim gap that has usable
evidence. If a unit with a large gap has no evidence, do not target it this
round: flag it as a blocker in `gate.notes` and target the next one. Writing
around missing evidence is the failure mode this rule exists to prevent.

When the loop fed back a `paper-review` result, its `next_round_target` is the
round's strongest evidence about what is actually weakest — a reader already
tried to reject the paper there. Honour it unless one of these holds, and say
which:

- `evidence_ready` is `false` or the unit's evidence is missing on disk: the
  review has named a real weakness that this round cannot fix. Record it in
  `gate.notes`, target the next-worst unit, and report the skip so the loss is
  visible rather than silent.
- The review's own `storyline_notes` name a different paragraph as where the
  paper lost the reader: that paragraph's unit wins.

Do not re-target the same unit for a third consecutive round. If a unit survives
two rounds of revision and two reviews still call it weakest, the problem is not
its prose — escalate into `gate.notes` as a claim or evidence problem and move
on, because a loop that keeps polishing the same section is spending the run's
budget on the defect it cannot fix.

Permitted targets: `abstract`, `intro`, a numbered section (`§3`, `§3.2`), or
`figures` (a figure set the text already references). State the target as
`round_target.unit` with `kind`.

When the manuscript is empty, the target is `skeleton` and this round produces
the full section skeleton plus §1 — the reference spec's budget supplies the
section list.

## 2. L0 — restate, do not renegotiate

Copy the core claim and the contribution list from the brief. Check the C→M→E
invariant and report only what the *current manuscript* breaks:

- contribution with no evaluation artifact → `orphan_contributions`
- evaluation artifact serving no contribution → `orphan_evidence`
- methodology section serving no contribution → `dead_methodology`

Escalate; never silently drop a contribution to make the text neat.

## 3. L1/L2 — the unit's shape

From the reference spec's budget, state the unit's page share and the job of
each subsection. A subsection job is one sentence that names the question it
answers — not "discusses X".

## 4. L3 — the paragraph storyline (the gate)

For every paragraph of the unit, all five fields:

| Field | Means |
|---|---|
| `topic_sentence` | The claim the paragraph makes. First sentence of the prose will be this. |
| `reader_knows` | What the reader has learned by this point. Only earlier material may appear here. |
| `why_here` | Why the reader needs this *now*, referencing what the previous paragraph or subsection established. |
| `evidence` | The number, table, figure, citation, or definition that backs it. "None" is not allowed for a claim. |
| `leads_to` | What this paragraph makes the reader ready for. |

Then run the gate. **All four must hold for the unit to be confirmed:**

| Check | Scope | Fails when |
|---|---|---|
| Opener motivation | ¶1 of every subsection | `why_here` is empty or generic ("this section explores…"), or does not reference what the previous subsection established |
| Cross-subsection bridge | last ¶ of §X.Y → ¶1 of §X.(Y+1) | the closing `leads_to` does not match the next opener's `why_here` |
| Cross-section bridge | last ¶ of §X → ¶1 of §(X+1) | same test across the boundary |
| Reader model monotonic | all paragraphs | `reader_knows` references a concept not introduced earlier |

**If any check fails, do not confirm.** Record the specific gap in
`gate.notes` with the paragraph ids involved and the concrete repair (for
example: "§3.2 ¶1 has no bridge from §3.1: add a clause to §3.1's closer mapping
the layout requirement to the co-design"). Report `gate` fields as the booleans
you actually evaluated — a passed gate you did not run is a lie the loop cannot
detect.

## 5. Alternative arcs for a long unit

When the target unit has five or more paragraphs and its ordering is genuinely
open, propose the arc you would defend against the alternatives you rejected.
Record both in `gate.notes`: the ordering chosen and the one-line reason the
others were not (chronological vs. most-important-first vs. problem→solution,
and where the aha moment sits). This is the decision the review will attack, so
state it rather than leaving it implicit.

## 6. Update the state file

Write `<state_dir>/storyline-state.md`:

```
## Layer 0   Status: confirmed|pending   Notes: ...
## Layer 1   Status: ...
## Layer 2   | Unit | Status | Confirmed |
## Layer 3   | Unit | Status | Gate | Confirmed |
## Layer 4/5 | Unit | Status | Notes |
```

Mark a layer confirmed only when the gate passed. `paper-write` refuses to work
on a unit whose L3 is not confirmed.

## 7. Self-check

- [ ] `context` carries the claim, venue, manuscript paths, spec path, state dir
      and contributions, copied rather than paraphrased.
- [ ] Every figure finding in the review result has a `figure_directives` entry,
      or is deliberately excluded with a note in `gate.notes` saying why.
- [ ] Every paragraph has all five L3 fields, and no `evidence` is "none" for a
      claim.
- [ ] The four gate booleans are the checks you actually ran.
- [ ] `gate.notes` records the gaps found and the arcs rejected, not just the
      verdict.
- [ ] The state file exists at `<state_dir>/storyline-state.md`.

## 7. Self-check

- [ ] Exactly one round target, and it is reachable with evidence that exists.
- [ ] Every paragraph has all five fields, and `evidence` is never "none" for a claim.
- [ ] Every gate boolean reflects a check you ran.
- [ ] The state file names the target and its L3 status.
- [ ] Orphans and blockers are in the result, not smoothed over.
