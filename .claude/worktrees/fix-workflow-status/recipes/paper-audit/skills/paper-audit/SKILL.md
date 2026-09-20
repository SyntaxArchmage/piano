---
name: paper-audit
description: Check every number, claim, citation, and reference in the manuscript against the artifacts on disk, and report what does not hold.
---

# Audit

Deliverable: an issue list precise enough that `paper-revise` can act on each
entry without re-deriving it.

Read the manuscript and the injected handoff context: the `paper-storyline`
result (whose `context` block carries the manuscript paths, the venue, the
reference spec path, and — crucially — the `evidence` roots and the
`experiment_commands` that regenerate the numbers), this round's `paper-draft`
result (`numbers_used` lists every numeral the writer introduced), and the
`paper-figures` result (`data_sources` for each figure).

Upstream results are not workspace files: each entry in the handoff record's
`inputs[]` carries the producer's `resultPayload` under its contract id and the
`resultPath` it was written to. Read them from there; never go looking for a
file named after a contract.

## 1. Numbers

Build the census: every numeral in the manuscript body, tables, and figure
captions. For each one:

- **Source.** Which file produces it? Follow `numbers_used` where the writer
  recorded it; for older text, search the data directories. A number with no
  source is a `blocker`.
- **Value.** Does the file contain this value? Decimal-for-decimal at the
  source's precision. `61.5%` from a source that says `61.4` is a finding, not a
  rounding choice.
- **Unit and direction.** Speedup or latency? Higher-is-better or lower? A
  speedup quoted where the source measures latency is a factor-of-inversion
  error, the kind that survives to camera-ready.
- **Consistency.** The same quantity stated twice anywhere in the paper (abstract,
  intro, evaluation, caption) must be the same value and the same precision.

Report `numbers_checked` and every failure in `issues`, plus a separate
`unsourced_numbers` list.

### Placeholders are not numerals

A `\ph{<id>}` site is not a number, and putting it in `unsourced_numbers` is the
wrong answer: "the author has not measured this yet" and "someone wrote a number
that does not exist" are different defects, and only the second one is a
falsehood. Check the places the macro appears in a separate pass and report it in
`placeholders`:

- **Sites.** Every `\ph{<id>}` in the body, tables and figure captions, with its
  location. Also confirm the macro is actually defined in the preamble: an
  undefined macro builds to a LaTeX error, and a defined-but-invisible one
  renders a bare word into the PDF.
- **Registration.** Match every site id against the brief's `placeholders[]`.
  An id with no registry entry is `unregistered_site`, and it is exactly the
  failure the registry exists to prevent.
- **Placement.** Every registered placeholder whose `status` is `open` must have
  at least one site, or the paper claims a measurement it never shows:
  `unplaced_placeholder`. One marked `filled` whose macro is still in the text is
  `filled_but_site_remains`.
- **The one that matters most.** A real numeral sitting at a registered
  placeholder site is `value_at_placeholder_site`. That is the defect this whole
  field exists to catch: a slot the author reserved for a measurement they had
  not made, quietly filled with a plausible-looking figure. Report it as a
  `blocker` in `issues` as well, with the site, the value, and the registry entry
  that reserved it.

Report `registered_open` as the count of open entries, and set `mismatches` to
the empty list only when the registry and the text agree exactly.

## 2. Claims

Every sentence asserting a property rather than reporting a measurement. The
patterns to hunt: *fastest*, *first*, *always*, *never*, *scales linearly*,
*negligible*, *state of the art*, *general*.

For each: where in the paper is it established? Either a measurement in the
manuscript or a citation. A claim with neither is `major` at minimum; a
"first/only" claim is `blocker` unless the paper's related-work section
establishes the absence, because that is the claim a reviewer will check first.

## 3. Citations and references

- Every `\ref`/`\autoref` resolves, and points at the artifact claimed
  (a table reference to a figure is a defect reviewers enjoy finding).
- Every `\cite` key exists in the bibliography, and the cited work actually
  supports the sentence. Flag citations used as decoration — a reference listed
  after a claim it does not make.
- No placeholder text anywhere: `TODO`, `XXX`, `\todo`, empty macros,
  commented-out paragraphs, author names in an anonymized submission.

## 4. Consistency

- **Terminology.** One name per concept. List every synonym pair you find with
  the location of each use.
- **Notation.** Symbols in equations, tables, and prose agree; the metric's
  direction is stated once and used everywhere.
- **Structural.** Section numbering and cross-references match the current
  section order, including anything reordered this round.

## 5. Report

Each issue:

| Field | Content |
|---|---|
| id | `A1`, sequential per run |
| severity | `blocker` (false statement or unresolvable), `major` (unsupported claim), `minor` (precision, naming) |
| kind | number / claim / citation / terminology / structure / style |
| where | §3.2 ¶4, or `Fig. 5 caption` — findable without a search |
| what | What the paper says now |
| evidence | The file and value that contradicts it |
| fix | The concrete change, stated as an instruction |

Order by severity. Set `verdict` to `issues` if any blocker or major exists,
otherwise `clean`. Do not report zero findings as a formality: if the paper is
clean, say so plainly so the loop does not spend a round on it.

## 6. Self-check

- [ ] Every numeral in the manuscript appears in the census.
- [ ] Every `\ph{<id>}` site is registered, and every open placeholder has a site.
- [ ] No real number sits at a placeholder site.
- [ ] Every finding names a file, or states that no file exists.
- [ ] Every `fix` is actionable without reading your reasoning.
- [ ] You edited nothing.
