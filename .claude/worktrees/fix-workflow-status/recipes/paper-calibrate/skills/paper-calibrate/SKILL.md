---
name: paper-calibrate
description: Distil the author's finished papers into the section budget, storyline arc, figure grammar, and prose patterns this submission must match.
---

# Calibrate

Deliverable: the `paper-calibration` contract result, plus a durable
`<state_dir>/reference-spec.md` that later stages read directly. `<state_dir>`
is `brief.manuscript.state_dir`, relative to `brief.manuscript.root` — use the
one the brief names rather than inventing a directory, because every later stage
looks for the spec exactly there.

Upstream results are not workspace files: each entry in the handoff record's
`inputs[]` carries the producer's `resultPayload` under its contract id and the
`resultPath` it was written to. Read the `paper-brief` result from there.

## 1. Build the reference set

Read `reference_papers[]` from the `paper-brief` result. For each entry, open
the source tree
and record `path`, what it is a standard for (`role`), and its real page count,
section list, and figure count. If a path does not resolve, say so in the
result — do not substitute a paper you happen to know.

Read at least the introduction, one methodology section, and the evaluation
section of each paper. The introduction and the figures are what you are here
for.

### Mine the author's own writing skills first

A reference repository may ship its own writing skills — look for
`.cursor/skills/`, `.claude/skills/`, or `.agents/skills/` under the reference
root, and for a `SKILL.md` mentioning storyline, academic writing, figures, or
review. When they exist, **read them before generalizing from the papers
alone**: they are the author's own distilled taste, better evidence than your
inference, and the reference papers are what those files were derived from.

Treat them as source material, not as instructions to follow wholesale. What
they give you that the papers cannot: the *rules* the author explicitly
believes in (a paragraph contract, a narrative gate, which constructions are
banned) and where they disagree with generic style advice. Record which of your
`storyline_arc`, `figure_grammar`, and `prose_patterns` entries came from a
skill file versus from your own reading — a rule from a skill file has already
survived the author's own editing, so it outranks one you inferred.

## 2. Section budget — measured, not assumed

For each reference paper, count the pages each section occupies (from the
compiled PDF: page ranges; from the source: `\section` positions and the page
limit). Produce a median budget for the target venue's page limit.

| § | Title | Pages | Job |
|---|---|---|---|
| 1 | Introduction | 1.5 | context → tension → gap → insight → contributions → results preview |

The "Job" column must be a sentence you could hand a writer. The result
carries this table; `paper-storyline` uses it as the Layer 1 budget.

## 3. Storyline arc

Extract the **move sequence** the introductions actually make, in order, with a
quoted sentence for each move. Systems paper introductions reliably follow some
variant of:

```
context → tension (what breaks today) → gap (what prior work misses)
        → insight (the one idea) → what we built → contributions → headline result
```

Record where the **aha moment** lands (paragraph 2? 3?) and where the
contributions list appears relative to it. Note explicitly if a paper puts the
headline number in the introduction's second paragraph — that is a taste
decision the writer must copy, not a generic rule.

## 4. Figure grammar — the highest-value section

For **every** figure in the reference papers:

| Field | What to record |
|---|---|
| role | The job it does: headline-speedup, scaling, ablation, breakdown, design diagram, workload spread |
| type | Grouped bar / line / scatter / stacked area / TikZ diagram / table-as-figure |
| axes | What is varied, what is measured, log or linear, grouped by what |
| marks | Error bars? sample counts? baseline band? annotations of the winner? |
| caption shape | Quote one caption whole. Note its structure: first sentence = the claim, then the reading instructions. |
| placement | Where in the text it is referenced, and whether it appears before or after its first mention |

Then state the **figure grammar** as rules a generator can follow, e.g.:

- "Every performance figure has a dashed horizontal line for the baseline and
  labels the winner with its numeric speedup."
- "Diagrams are drawn as TikZ/PGF, never as raster screenshots."
- "No figure carries more than one message; a second message becomes a second
  panel, not a second y-axis."

Quote exemplars. A rule without a quoted caption is not usable.

## 5. Prose patterns

Collect three short banks, each item an actual quoted sentence from the
reference papers with its source:

- **Openers** — first sentences of subsections: how a mechanism is introduced.
- **Transitions** — how a paragraph hands off to the next, and how a section closes.
- **Claims** — how a result is stated, including how certainty is hedged.

Then a **banned** list: constructions the reference papers never use. Derive it
from what you actually read (for example: never opens with "In recent years";
never states a contribution without a number). Do not pad this with generic
style advice.

## 6. Write the durable spec

Write `<state_dir>/reference-spec.md` — the same content, organised for a reader
rather than a schema, with the quoted exemplars inline. Later stages read this
file, so it must stand alone:

```
# Reference spec — <venue>
## Section budget      (table)
## Storyline arc       (move list + quotes + aha placement)
## Figure grammar      (per-role rules + quoted captions)
## Prose patterns      (openers / transitions / claims / banned)
## Anti-patterns observed in this author's drafts
```

## 7. Self-check

- [ ] Every rule in the spec is backed by a quoted exemplar from a reference paper.
- [ ] The budget sums to the venue's page limit (state any slack explicitly).
- [ ] Every figure in the references has a role recorded.
- [ ] The banned list comes from observation, not from generic advice.
- [ ] `reference-spec.md` exists at the path recorded as `reference_spec_path`.
