# `PROMPT.md` — the preparation document

Copy this file into your manuscript repository as `PROMPT.md` and fill it in.
`paper-prepare` reads it before it does anything else, so the run starts from
what you decided with your co-authors instead of from the agent's guesses.

You do not have to fill in every section. Leave a section out and the agent
fills that field from the repository, then asks you about it — but the fields
below are the ones nothing else can supply. In particular, a missing
`state_dir` or `reference_papers` costs the loop its memory and its standard,
and neither is recoverable later in the run.

Replace every `<…>` placeholder. The `prompt.json` block at the bottom is a
complete, valid `paper-brief`; the agent uses it as the answer key, so keep it
consistent with the prose above it. A test in `tests/workflow/` validates this
block against the `paper-brief` contract, so it cannot drift out of date.

---

## 1. Title and claim

**Working title.** The title as you would submit it.

**Core claim, in one sentence.** The thesis every later stage checks a paragraph
against. Write it as a claim about what is *new*, not about what you built.

> Example: *A compile-time, loop-level model of cache reuse, memory coalescing
> and bank conflicts lets large operators be split into smaller subproblems,
> removing the shared-memory ceiling on fusion depth and improving DNN inference
> throughput over graph-level pattern-based fusion.*

## 2. Venue

Name, kind (conference / journal / workshop / preprint), year, page limit,
LaTeX template, and whether the submission is anonymized. The page limit is
enforced by `paper-finalize`, so state it as the venue counts it — including
references and appendices, or excluding them, whichever the call says.

If you are preparing a **camera-ready** rather than a submission, say so here
and set `anonymized: false`; the constraints differ (rights block, DOI,
page budget for the final version).

## 3. Manuscript paths

| Field | What to put |
|---|---|
| `root` | The directory holding the manuscript, relative to where you will run `piano`. **This is the write target** — a fresh tree the agent scaffolds, or an existing draft you want improved. Never a reference paper |
| `entry` | The `.tex` file that is compiled, e.g. `main.tex` |
| `compile` | The exact command that builds the PDF from `root`, e.g. `make`. It must already work: every writer stage runs it, and `paper-write` may not finish unless it succeeds |
| `figures_dir` | Where figures live, e.g. `figures` |
| `state_dir` | Where durable cross-round state goes, e.g. `plan`. The reference spec and the storyline state live here; the loop reads them every round |

### The template and the scaffold

Say where the venue's template comes from, or the agent has to guess — and a
guessed class file is a build that breaks in round one:

- **`template_source`** — a template package (e.g. a `template-packages/`
  directory holding the venue's zip), a directory, or `"existing"` when
  `manuscript.root` already contains a scaffold you want reused.
- **`scaffold`** — whether the agent should build the tree, and which of your
  repositories it should copy **the construction method** from: one file per
  section or one entry file, whether figures are split into `src/` `data/`
  `out/`, and where planning notes go.

If you already have a manuscript, say so and point `manuscript.root` at it; the
agent adopts it instead of scaffolding. Either way, list the section names only
if you have fixed them — otherwise leave the section list to the agent and
`paper-calibrate`.

The scaffold must also define one macro, in the preamble of the entry file:

```latex
\newcommand{\ph}[1]{\textcolor{red}{[#1]}}
```

Every value you have not measured yet is written as `\ph{ph-something}` rather
than as a number (see §7). Rendering it in red and in brackets is the point: an
unfilled slot is then obvious in the PDF to you, to a co-author, and to anyone
you send a draft to — a plain `TODO` comment is visible to none of them.

## 4. Reference papers — form, not content

**This is the field the whole workflow is built around, and the one most easily
misread.** These are your *finished* papers, named so the agent can measure their
**form**: the section budget they actually spend pages on, the arc their
introductions follow, the grammar of their figures, the prose habits worth
imitating. `paper-calibrate` distils them into a spec that every round is judged
against.

What the agent takes from them is shape. Their numbers, claims, figures,
experiments and prose are **theirs** — none of it goes into the new paper, and
none of it may be cited as its evidence. If your output ever reads as a lightly
edited version of a reference, this field was misread and the run is wasted.

They are **read-only**. No reference paper may live inside `manuscript.root`, and
`manuscript.root` may not live inside one. The agent verifies this by path and
records it; if they overlap, it will not use that root.

For each paper give the **path**, what it is the standard **for**, and
`"read_only": true`:

```json
{ "path": "/home/you/workspace/closest-systems-paper",
  "why": "The figure grammar and the win/loss framing inside its evaluation.",
  "role": "figure-grammar", "read_only": true }
```

Be honest about what each is good for. `figure-grammar` and `storyline` produce
rules a writer can follow; `overall` produces almost nothing. If a reference
repository ships its own writing skills (`.cursor/skills/`, `.claude/skills/`,
`.agents/skills/`), name that directory too: those are your taste already written
down and they outweigh anything the model infers.

## 5. Evidence

This is what stops the audit from having to take a number on faith. Be specific
about paths.

- **`code_roots`** — the source trees the results come from.
- **`datasets`** — the measurement directories.
- **`available_results`** — the result files that already exist and may be
  cited, including globs.
- **`experiment_commands`** — the commands that regenerate the numbers.
  `paper-audit` uses these to check a claimed value against its source, and
  reports any numeral that no command or file can produce as a blocker.

## 6. Contributions

One entry per contribution, with the two fields that make it checkable:

- **`methodology`** — the section that presents it (`§3.2`).
- **`evaluation`** — the artifact that validates it (`Fig. 5`, `Tab. 2`, `§5.1`).

If a contribution has no evaluation artifact, say so by leaving `evaluation`
describing the gap. `paper-storyline` reports that as an orphan contribution
every round until it is fixed, which is the point: it is better to know on
round one than to be asked about it in review. Do not invent an artifact to make
the table look complete.

## 7. Values you have not measured yet

This is the field that keeps the paper from lying to you, and the one worth
thinking hardest about before the run starts.

Some of the results the paper wants do not exist yet and you already know it. If
you leave them unmentioned, the writer has three bad options: invent a number,
drop the claim, or write around it so vaguely that the gap is invisible. All
three are worse than saying so. So name them:

| Field | What to put |
|---|---|
| `id` | `ph-` plus lowercase words, e.g. `ph-prod-speedup`. It becomes the macro argument, so keep it readable at the site |
| `what` | The quantity that will go there, in your terms — not "a number" but "speedup when the run starts from a production kernel" |
| `where` | The section, table or figure that will carry it |
| `source` | The command, workload or file that will produce it. If you cannot name one, you have found something else: a claim with no plan behind it |
| `status` | `open` |

The manuscript then shows `\ph{ph-prod-speedup}` at that spot. `paper-write`
writes no value there and reports the id; `paper-audit` cross-checks the registry
against the sites actually in the text; `paper-finalize` refuses to call the
paper ready while any entry is still open. You fill the values in whenever you
want — set `filled_value` and flip the status — and the loop will pick the
changed brief up on its next round.

```json
{ "id": "ph-prod-speedup",
  "what": "speedup when the run starts from a production kernel instead of a naive one",
  "where": "§5.3, Tab. 2 second block",
  "source": "a from-production eval workload under evals/workloads/",
  "status": "open" }
```

**A placeholder is not a place to hide a weak claim.** The distinction is worth
being exact about, because it is the difference between an honest paper and a
padded one:

- *The evidence contradicts the claim* → narrow the claim. That is a
  `constraint`, and the loop must deal with it. A placeholder would leave a
  claim standing that you already know is not supported.
- *The measurement is coming* → a placeholder. The claim stays; the slot stays
  visibly empty; the paper says so rather than approximating.

If you cannot tell which one you are looking at, say so and let `paper-prepare`
ask you — that is the single question worth a turn of the run's time.

## 8. Constraints and things the agent must not do

Anything that is a rule rather than a fact: an anonymity requirement, a claim
that must be narrowed, a figure that must not appear, an experiment that is
still running, a section you know is weak. The agent will not learn these from
the repository, and each one it does not know is a correction you will have to
make afterwards.

## 9. What is still open

List the questions you have not settled. `paper-prepare` treats them as the
agenda: it asks only about what is genuinely undecided, and records what it
decided alone in `open_assumptions` so you can see where the run went beyond
your instructions.

---

## `prompt.json` — the machine-readable answer key

The agent reads the prose above, and uses this block as the exact values it
should write into the brief. Edit the top half to match your decisions.

The **last three fields are the agent's report, not yours**: `prompt_doc` says
what it read and where it departed from it, `questions_asked` records what it
actually asked you, and `open_assumptions` lists what it decided alone. They are
in the block because the contract requires them, and because seeing their shape
tells you what the run will be able to justify afterwards. Leave them as they
are; the agent overwrites them, and a value you write there is a claim about the
run rather than an instruction to it.

```json
{
  "title_working": "PIANO: a production-ready high performance kernel tuning agent with a programmable agentic workflow",
  "core_claim": "A workflow rather than a prompt is what makes an agent's kernel tuning reproducible: composing stages, loops and tournaments over interchangeable agent harnesses turns an open-ended optimisation attempt into a schedule whose every decision is recorded, contract-validated and re-runnable.",
  "venue": {
    "name": "arXiv (cs.DC)",
    "kind": "preprint",
    "year": 2026,
    "page_limit": 14,
    "template": "acmart-primary",
    "anonymized": false
  },
  "manuscript": {
    "root": "paper",
    "entry": "main.tex",
    "compile": "make -C paper",
    "figures_dir": "figures",
    "state_dir": "plan"
  },
  "scaffold": {
    "template_source": "/home/albert/workspace/manuscripts-workspace/template-packages/acmart-primary.zip",
    "template": "acmart v2.12 (2024/12/28), sigconf",
    "created": [
      "paper/main.tex",
      "paper/sections/",
      "paper/acmart.cls",
      "paper/ACM-Reference-Format.bst",
      "paper/refs.bib",
      "paper/figures/src/",
      "paper/figures/data/",
      "paper/figures/out/",
      "paper/plan/",
      "paper/Makefile"
    ],
    "reused_existing": true,
    "build_verified": true,
    "reference_disjoint": true,
    "layout_followed": "Copied the construction method of the author's own paper repositories: an acmart main.tex with the class, bibliography style and refs.bib beside it, section bodies under sections/, a figures/ tree split into src/data/out so every plotted figure has a script and a data file behind it, planning notes under plan/, and a Makefile whose default target builds the PDF in one command. Structure only — no prose, number or figure was copied."
  },
  "evidence": {
    "code_roots": [
      "/home/albert/workspace/piano"
    ],
    "datasets": [
      "paper/figures/data"
    ],
    "available_results": [
      "paper/figures/data/tuning-results.json",
      "paper/figures/data/serial-vs-tournament.json"
    ],
    "experiment_commands": [
      "node paper/figures/src/extract-eval-results.mjs"
    ]
  },
  "contributions": [
    {
      "id": "C1",
      "statement": "A declarative workflow language in which agent stages compose through three node kinds — stage, loop and tournament — plus a feedback edge, and whose failure semantics (who owns the retry, what a round may leave behind) are part of the language rather than of the prompt.",
      "methodology": "§3.1",
      "evaluation": "§5.2, §5.3: the same stage graph run as a serial pipeline and as a tournament, 7 paired configurations"
    },
    {
      "id": "C2",
      "statement": "A harness abstraction that puts four different coding agents behind one event and resource surface, so a workflow names the harness per stage and the workflow itself stays model-agnostic.",
      "methodology": "§3.2",
      "evaluation": "§5.4: the identical workflow executed under pi, claude and dsh"
    },
    {
      "id": "C3",
      "statement": "An evidence chain that makes an agent's optimisation auditable after the fact: immutable handoff records, one result file per attempt, the full agent transcript, and a contract check with a bounded repair turn in place of silent acceptance.",
      "methodology": "§3.3",
      "evaluation": "§5.6: the ledger of a single run read back and reconstructed"
    },
    {
      "id": "C4",
      "statement": "An end-to-end result: agents given only a naive kernel and a benchmark entrypoint reach hardware-level throughput on a CUDA matmul, and the tournament node is what makes the outcome stable across models.",
      "methodology": "§3.1, §4",
      "evaluation": "§5.1 Tab. 1, Fig. 2; §5.2 Fig. 3"
    }
  ],
  "reference_papers": [
    {
      "path": "/home/albert/workspace/croqtile-tuner-paper",
      "why": "The closest systems paper of the author's own: the introduction's argument arc, the section budget of an acmart systems submission, and the figure grammar that pairs every plot with the script and data behind it.",
      "role": "storyline",
      "read_only": true
    },
    {
      "path": "/home/albert/workspace/manuscripts-workspace/papers/adaptive-operator-fusion-camera-ready",
      "why": "The author's acmart sigconf typesetting standard: preamble and rights block, table style, and how a speedup claim is worded and scoped.",
      "role": "evaluation",
      "read_only": true
    },
    {
      "path": "/home/albert/workspace/gemm_sp_paper",
      "why": "The evaluation-table layout and the win/loss framing used when a comparison does not go one way.",
      "role": "figure-grammar",
      "read_only": true
    }
  ],
  "placeholders": [
    {
      "id": "ph-prod-speedup",
      "what": "speedup when the run starts from a production kernel instead of a naive one",
      "where": "§5.3, Tab. 2 second block",
      "source": "a from-production eval workload, to be added under evals/workloads/ and reported the same way as the from-scratch arm",
      "status": "open"
    },
    {
      "id": "ph-second-operator",
      "what": "whether the same workflow reaches a comparable improvement on a second operator family",
      "where": "§5.1, the scope paragraph, and §6",
      "source": "a second tuning workload; until it exists the paper states one operator family and says so",
      "status": "open"
    },
    {
      "id": "ph-cost-per-round",
      "what": "tokens and wall-clock per accepted round, against the improvement that round bought",
      "where": "Tab. 1 last column",
      "source": "the per-run usage and timing already recorded in each eval report",
      "status": "open"
    }
  ],
  "prompt_doc": {
    "path": "PROMPT.md",
    "found": true,
    "used": [],
    "conflicts": [],
    "unresolved": []
  },
  "questions_asked": [],
  "open_assumptions": [
    "The section list was left to paper-calibrate, so the contribution-to-section mapping above is the document's target and may move by one subsection."
  ],
  "constraints": [
    "One operator family (dense matmul) on one GPU: every claim in §5 is scoped to that, and the scope is stated in the abstract rather than left for the reader to discover.",
    "The serial-versus-tournament comparison is a win on six of seven paired configurations and a loss on one; both are reported.",
    "Do not turn a measurement the run did not make into prose. A sentence that would need ph-prod-speedup stays a macro site with a note on what is missing."
  ]
}
```
