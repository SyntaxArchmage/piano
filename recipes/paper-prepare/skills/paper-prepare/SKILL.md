---
name: paper-prepare
description: Align with the author on claim, evidence, contributions, venue, and reference papers, find the venue template, scaffold the manuscript workspace, then write the brief every later stage depends on.
---

# Prepare

One stage, one interactive batch, one artifact: the `paper-brief` contract
result. Read the brief's contract for the exact shape; this skill is the
procedure.

Two jobs, both required before you finish: **align** on the paper's claims, and
**prepare the workspace** the loop will write into.

## 0. Reference papers versus the manuscript

Get this wrong and the whole run is wasted, so decide it first and write it in
the brief.

**The manuscript is the write target.** A fresh tree you scaffold, or an existing
draft you were told to improve. Every later stage edits exactly `manuscript.root`
and nothing else.

**The reference papers are read-only standards.** They exist so
`paper-calibrate` can measure their *form*: section budget, the arc of their
introductions, the grammar of their figures, their prose habits. Their numbers,
claims, figures and prose belong to those papers. Never copy them, never cite
them as this paper's evidence, never write into them.

Check **disjointness by path**: no reference paper may sit inside
`manuscript.root`, and `manuscript.root` may not sit inside a reference paper.
Record the check in `scaffold.reference_disjoint`. This is the failure a reader
notices first and the pipeline cannot see at all — a run pointed at a finished
paper will "improve" it for hours, every contract will validate, and the output
will read as a lightly edited duplicate of the reference. If they overlap, do not
use that root for the manuscript: scaffold a new tree, or ask.

Then read, in this order, and take notes:

## 1. Reconnaissance: the document and the sources

### 1a. The preparation document

**Look for `PROMPT.md` in the workspace root before anything else.** It is where
the author puts what they already worked out — usually with other people, or
with another agent — so it outranks your inference from the repository and it
saves the author from restating their own decisions.

Read it whole. It has a prose part and, usually, a fenced `json` block that is
already a valid `paper-brief`; that block is the author's answer key, so take
those values verbatim where they are present. Record what you did in the brief's
`prompt_doc` block: the path you looked at, whether it was there, which brief
fields came from it, where it disagreed with the repository, and — importantly —
which questions the document *itself* lists as still open, because those are
already known to be undecided and are not worth spending the one batch on.

If there is no document, `found: false` and a path are still required: "nobody
wrote one" has to be a statement the result makes, not a field it omits, or the
next reader cannot tell "the author confirmed this" from "the agent guessed".

### 1b. Source precedence

When two sources disagree, the order is:

1. **`PROMPT.md`** — the author's settled decisions, including decisions about
   the target state that is not on disk yet.
2. **The repository** — for anything the document does not state. Measured facts
   (the real page count, whether the build works, what figures exist) live here.
3. **The `discuss` batch** — for what is genuinely undecided after both of those.
4. **A default, recorded in `open_assumptions`** — last resort, never silent.

Two cases need care. A document may describe a manuscript you cannot find, or a
page limit the tree contradicts: that is a target, not an error, so keep the
document's value and list the discrepancy in `prompt_doc.conflicts` rather than
"correcting" it to match the repository. And a document may be stale relative to
a newer branch: where the document and the *compiled* manuscript disagree about
something you can check — a number, a section that no longer exists — say so in
`conflicts` and let the loop settle it, because both readings are plausible and
silently picking one hides the disagreement.

### 1c. The code, the data, and the reference repositories

1. **The code and data** the task names. For each: where results are written,
   how they are re-derived, and whether the numbers already exist on disk. These
   are *this* paper's evidence, and `paper-audit` will check every numeral
   against them.
2. **The reference repositories** — for their **construction method**, not their
   content. Open each one and record how it is built, because the scaffold below
   follows it:

   | Look at | Why |
   |---|---|
   | the sources directory (`paper/`, `sources/`, or the root) | one file per section, or a single entry file? |
   | the build target and its tool (`Makefile` → `tectonic`, `latexmk`) | what the `compile` command is, and which engine the author uses |
   | `figures/` | are generators, derived data and built artifacts separated (`src/` `data/` `out/`)? |
   | the planning directory (`plan/`, `docs/`) | where durable notes live — the convention `manuscript.state_dir` should follow |
   | the venue template (`template-packages/*.zip`, or the class files at a repo root) | where the class/style/bib files come from |

3. **The reference papers' prose and figures**, for `paper-calibrate`: their
   section headings, page budget, figure list, abstracts. If a reference tree
   ships its own writing skills (`.cursor/skills/`, `.claude/skills/`,
   `.agents/skills/`), note the paths — they encode the author's distilled taste,
   and `calibrate` should read them.

Report what you found before asking anything. Half the questions usually
disappear at this step.

## 2. Find the template, and prepare the workspace

This is the job the rest of the workflow cannot do for you: every later stage
edits a manuscript, so the manuscript has to exist and it has to build.

### 2a. Find the template

In order of preference:

1. What `PROMPT.md` names — a template package, a directory, or an existing
   scaffold. Use it as named.
2. A template package directory in the author's workspace (for example a
   `template-packages/` holding the venue's zip). Extract it; do not hand-write
   a class file.
3. The venue's own sample, when the author's repositories already carry it.

Record where it came from in `scaffold.template_source`, and the class and
version you actually used in `scaffold.template`. Never take a template from a
reference paper's directory: those are that paper's frozen copy, and reusing it
is the first step toward duplicating it.

### 2b. Scaffold the tree

Build it the way the author's own repositories are built — you recorded that in
1c — rather than inventing a layout:

```
<manuscript.root>/
  <template files>        class, style, bibliography files the venue requires
  <entry>.tex             \input's one file per section, or is the single source
  <section>.tex           one per section, when that is the observed convention
  figures/
    src/                  generators (scripts that produce the figures)
    data/                 derived data the generators read
    out/                  built artifacts the .tex includes
  <state_dir>/            reference spec, storyline state (the author's plan/)
  Makefile | build script  one non-interactive command that builds the PDF
```

Rules that matter more than the shape:

- **Copy the template, never a reference paper.** No reference paper's `.tex`,
  `.bib`, figures or section files go into this tree. If you find yourself
  copying their text, stop — you are building a duplicate.
- **Reference the author's code and data by path.** `PROMPT.md` points at them;
  do not move or copy them into the manuscript.
- **Do not choose the section list.** Sections come from `paper-calibrate`'s
  reference budget and `paper-storyline`'s L1. If you do not yet know which
  sections exist, scaffold an entry file that compiles with a placeholder body
  and record the open question in `open_assumptions` — do not invent sections.
- **Scaffolding is structure, not prose.** No paragraphs, no claims, no figures.

### 2c. Prove the build works

Run the compile command and confirm it produces a PDF. Report it in
`scaffold.build_verified` together with the command and its result. A scaffold
whose build fails costs the loop its first hour, and `paper-write` is forbidden
from finishing on a manuscript that does not build — so this check is not
optional and a claim you did not run is worse than a reported failure.

## 3. One batch of questions

Send **one** `discuss` message containing every remaining question, numbered,
with your best guess and its justification attached to each. Structure it as:

```
1. Core claim — I read it as "<claim>". Confirm or restate.
2. Contributions — I have C1..C3 from the repo. Anything missing/overstated?
3. Venue — target name, kind (conference/journal), page limit, template, anonymized?
4. Data — are the numbers in <path> final, or will experiments be re-run?
5. Reference papers — is <A> and <B> the standard to match? Anything else?
6. Output — which directory is the submission built from?
```

Send fewer when the preparation document already answered them: asking an
author to confirm what they just wrote down is how a batch of six becomes a
batch they stop reading.

Rules for the batch:

- **Never ask more than once.** If the answer is partial, work with it and record
  the remainder as an assumption.
- **Check the tool exists first.** If `discuss` is not in your toolset at all,
  nobody is attached and no question can be sent — do not call it, do not retry,
  and do not wait. This is a configuration fact, not a failure, and it is the
  expected state on a headless run.
- **Headless detection.** If `discuss` answers `please make decision by yourself,
  i am not here`, there is no human attached. Do **not** retry the tool. Decide
  everything yourself from the repository, and list each decision in
  `open_assumptions`.
- **Say which happened.** Record in `open_assumptions` whether the alignment was
  skipped because the tool was absent, or because the answers said you were
  alone. A reader of the brief must be able to tell "the human confirmed this"
  from "the agent chose this", and those two states are otherwise identical.
- **Proof of asking.** Copy the questions you actually sent into
  `questions_asked`. If you sent none, it must be an empty array and
  `open_assumptions` must explain why every value was readable from disk.

## 4. Contributions and the C→M→E check

Write each contribution as a claim about what is *new*, not about what was built.
Then fill the mapping:

| # | Contribution | Methodology | Evaluation |
|---|---|---|---|
| C1 | ... | §3.2 | Fig. 5, §5.1 |

Flag, in `constraints`, every break you find:

- A contribution with **no** evaluation artifact → the paper cannot support it as
  written. Say so now.
- An evaluation result that serves **no** contribution → orphan evidence.
- A methodology section that serves **no** contribution → dead weight.

These flags are the most valuable thing you produce. The loop can fix a weak
paragraph; it cannot invent a missing experiment late in the night.

## 5. The brief

Write the `paper-brief` result to the path the orchestrator names. It is a
machine-read contract, not a memo:

- Paths are **exact** and resolvable from the working directory. `manuscript.root`,
  `manuscript.entry`, `manuscript.compile` are used verbatim by every later
  stage; a wrong `compile` command means the loop produces a manuscript that
  never once compiled.
- `evidence.experiment_commands` are the commands that regenerate the numbers.
  `paper-audit` uses them to check that a claimed number is real.
- `reference_papers[].why` says what this paper is a standard *for* (figure
  grammar? storyline arc? evaluation table?) so calibration can weight it.
- `prompt_doc` says what you started from and where you departed from it. A
  value you were told and a value you chose look identical in the rest of the
  brief, and only this block tells them apart.
- `open_assumptions` is the honest ledger of everything you decided alone.

### 5a. Register the placeholders the author has not measured

Some of the paper's results do not exist yet, and the author knows it. The brief
records them in `placeholders[]` so the run has a way to leave a slot visibly
empty instead of guessing a value or quietly writing around the claim.

Ask, before you write the brief: **which claims does the available evidence not
support, and does the author intend to measure them?** Then give each one an
entry:

| Field | What it must say |
|---|---|
| `id` | `ph-` plus lowercase words, e.g. `ph-prod-speedup`. This is the macro argument, so it has to be readable at the site. |
| `what` | The quantity that will go there, in the author's terms — not "a number" but "speedup when the run starts from a production kernel". |
| `where` | The section, table or figure that will carry it. |
| `source` | The command, workload or file that will produce it. If you cannot name one, say that, because the entry is then a note rather than a plan. |
| `status` | `open`. You are the only stage that writes `open`; later stages do not promote a placeholder on their own authority. |

The distinction that keeps this honest: **a placeholder is not missing
evidence.** Missing evidence is a claim with no artifact, and §4 sends that to
`constraints` where the loop must deal with it — narrow the claim or drop it. A
placeholder is a measurement the author *has decided* to make and has not made
yet; the paper keeps its claim, and the slot stays visibly empty. If you cannot
tell which of the two you are looking at, ask — that question is exactly what
§3's batch is for, and it is the one question worth spending a turn on.

Two rules for the registry:

- **The preamble must define the macro.** The manuscript needs
  `\newcommand{\ph}[1]{...}`, rendering the id in something impossible to
  mistake for prose, so an unfilled site is visible in the PDF and not just in
  the `\LaTeX` source. Put it in the scaffold (§2b) and list it in
  `scaffold.created`.
- **Never register a placeholder to avoid a hard editorial call.** If the
  evidence contradicts the claim, that is not a placeholder, that is a claim to
  narrow. A registry full of entries is the run telling you it could not write
  the paper; a short one is the run telling you what it is still owed.

When the document already carries such a list, take it verbatim — the author's
ids are what they will fill in.

## 6. Self-check before you finish

- [ ] `PROMPT.md` was looked for and `prompt_doc.found` says truthfully whether
      it was there.
- [ ] Every value `prompt_doc.used` names is byte-identical to the document's.
- [ ] Every disagreement between the document and the repository is in
      `prompt_doc.conflicts`, with which one you kept.
- [ ] Every path in the brief resolves from the working directory.
- [ ] The compile command is one you actually ran, or that you read from a
      Makefile you quote in `constraints`.
- [ ] Every contribution has a methodology **and** an evaluation target.
- [ ] Every value the paper will claim and cannot yet support is either in
      `constraints` (narrow it) or in `placeholders` (measure it later) — and
      you can say which, for each one, and why.
- [ ] Every `placeholders[].source` names something real enough that a later run
      could act on it.
- [ ] The scratch preamble defines the `\ph` macro and renders it visibly.
- [ ] `questions_asked` records the batch you really sent, and a question the
      document already answered is not in it.
- [ ] `open_assumptions` names every value you chose without being told.
