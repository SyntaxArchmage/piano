---
name: paper-write
description: Render a confirmed paragraph storyline into compiling LaTeX prose, then QC it against the storyline, the numbers, and the author's style.
---

# Write

Owns Layer 4 (writing plan) and Layer 5 (prose), for **one unit per round**.

**Gate first.** Read `<state_dir>/storyline-state.md`, resolving `<state_dir>`
from the `paper-storyline` result's `context.state_dir`. The target unit's L3
must be `confirmed`. If it is not, stop and report — do not write on a plan that
has not passed the narrative gate.

Read the briefing from that same result's `context` block: the manuscript root,
entry file and compile command, the venue and its page limit, the reference spec
path, and the contribution list. Inside the loop these arrive only this way, so
treat `context` as the brief rather than searching for a brief document.

## 1. Layer 4 — the writing plan

For each paragraph in the `paper-storyline` result, fill in:

| Field | Content |
|---|---|
| `id` | `§3.2-¶4` |
| `archetype` | copied from the storyline |
| `topic_sentence` | the exact opening sentence (the storyline's `topic_sentence`, polished lightly) |
| `motivation` | ¶1 of a subsection only: the one clause that makes the reader ready, per the storyline's `why_here` |
| `body` | bullets: the data points, `\ref{}` targets, and citations in order |
| `form` | prose / table / figure / equation / listing |
| `length` | target sentences |

Keep it in the result (or alongside it) so the reviewer can compare plan to prose.

## 2. Layer 5 — the prose

Write into the manuscript the brief names. Rules that decide whether the prose
survives review:

**Paragraph contract** — every paragraph:

1. Opens with its claim. The first sentence *is* the job; no warm-up.
2. Reaches evidence within two sentences: a number, a citation, a `\autoref{}`,
   or a defined term. No unsupported assertion.
3. Does one job. Two jobs means two paragraphs.
4. Ends by handing off: the closing sentence connects to the next paragraph, or
   closes the subsection's arc.
5. Uses the terminology the manuscript already uses. Introducing a synonym for
   an existing term is a defect.
6. Every number is traceable to a file recorded in the round's evidence.

**Sentence level:**

- One action per sentence. If it does two things, split it.
- The mechanism before its motivation, unless the reference spec's exemplar does
  the opposite. Copy the author's order, not the default.
- Concretely: name the thing, its quantity, and its consequence. "The check runs
  before the kernel, so a tiling error costs a message instead of a hang."
- Hedging must match the evidence. A measurement is stated, not "suggested".

**Abstract and introduction** exist to let a reviewer decide in ninety seconds
whether the paper is worth reading. Use the reference spec's arc: context →
tension → gap → insight → what was built → contributions → headline number. The
headline number appears where the reference papers put it, not at the end.

## 3. Quality control — three rounds, in this order

**Round 1 — structure.** Paragraph by paragraph against the storyline: same job,
same evidence, same order? Any paragraph that drifted gets rewritten to the plan
or the plan gets corrected in the result. Terminology consistent? Every
contribution's methodology statement reachable from the text?

**Round 2 — numbers.** Every numeral: does it match its source file exactly, at
the precision the source has? Units present? Direction correct (speedup vs.
latency)? Every `\ref` resolvable, every citation real and used? Recompute
nothing; compare.

**A placeholder site is where you write no number.** The brief's `placeholders[]`
reserves named slots for values the author has not measured. At such a site you
emit the macro `\ph{<id>}`, using the entry's `id` verbatim, and you report the id
in `placeholders_used`. Nothing else happens there:

- Do not substitute a plausible-looking value. The slot is registered precisely
  because no file produces it, and a number you supply would be the one defect in
  this manuscript that no later stage can detect — it would read exactly like a
  measurement.
- Do not work around it either. Rewriting the sentence so it no longer needs the
  number is a real editorial choice and sometimes the right one, but it is not
  yours to make silently: if you do it, say so in `storyline_deviations`, because
  the author put that placeholder there on purpose.
- Use the registered id exactly. A hand-invented `\ph{prod-speedup}` is an
  unregistered site and the audit will report it as one.
- A site that no longer needs a placeholder — because the value arrived, or the
  sentence went away — means the brief is stale. Report that; do not delete the
  macro and move on.

If a paragraph has nothing but placeholders to say, its honest home is
`unwritten` with the missing evidence named. That is a better outcome than prose
that reads as though the measurement exists.

**Round 3 — voice.** Read the reference spec's banned list and apply it. Then
read the unit aloud as the author: does any sentence sound like a product
announcement, a blog post, or a generic survey? Rewrite it. Prefer the author's
quoted openers and transitions over anything you invent.

Report which rounds you ran and what they changed. A QC round you skipped must
be reported as skipped — a silent skip is the failure this workflow cannot
detect later.

## 4. Finish

Run the brief's compile command. Report it verbatim with its outcome, the files
you changed, the numbers you used with their sources, and anything you could not
write for lack of evidence. That last list is what the next round targets.

**You may not finish on a broken build.** The contract refuses `compiles: false`,
so a build failure is not something to report and move past: it is the one thing
you must resolve before you are done. Fix it — revert your edit, repair the
environment, or find the syntax error — and report `compiles: true` with the
command that proved it.

The single exception is a manuscript that cannot be built at all from here: a
missing class file, an error that predates your edit and is outside the unit you
were given. Then report `status: "blocked"` with a `build_blocker` naming the
file, the exact error, and why it is not yours to fix. That stops the loop
instead of letting it spend the remaining budget writing into a tree that cannot
compile. Use it only for that; a reachable fix left undone and labelled "blocked"
is the failure this field will be accused of.

## 5. Self-check

- [ ] L3 was confirmed before writing.
- [ ] Every paragraph opens with its claim and reaches evidence within two sentences.
- [ ] Every numeral traces to a file, at the source's precision.
- [ ] Every `\ph{<id>}` site uses a registered id, and carries no value.
- [ ] Every placeholder you emitted is listed in `placeholders_used`.
- [ ] Three QC rounds run and their changes reported (or explicitly skipped).
- [ ] The manuscript compiles, with the command and its result reported.
- [ ] Nothing outside the target unit was restructured.
