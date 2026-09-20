# Worker recipes ()

`recipes/` is Piano's source-controlled worker-plugin registry. A worker
name in a workflow resolves to the directory with the same name:

```text
recipes/
  <worker-name>/
    system-prompt.md        # optional; absent = Pi default prompt
    agents.md               # optional shared worker context
    agents.<harness>.md     # optional per-harness appendix (pi, pi-cli, claude, dsh, codex)
    contract.json           # optional declarative result schema + metric/projection outputs
    skills/
      <skill-name>/
        SKILL.md            # Agent Skills file
```

Worker artifacts are configuration, not workflows. A worker directory must
exist, while each file above is optional except for `SKILL.md` inside an
existing skill directory. Skill names use lowercase letters, digits, and
hyphens and must match their directory name.

An `agents.<harness>.md` appendix is injected immediately after the shared
`agents.md` — but only for stages that run that harness, so a stage on `pi`
receives `agents.md` + `agents.pi.md` while a `claude` stage receives
`agents.md` + `agents.claude.md`. A file whose suffix is not a known harness
name (for example `agents.gpt.md`) fails the workflow load.

`system-prompt.md` is deliberately optional. When it is absent, Piano passes no
prompt override and the configured Pi harness retains its built-in default
system prompt. Likewise, a workflow stage that omits `tools` retains the
harness default tool set.

The canonical workflow harness is `pi`. Stages that omit `harness` use
that adapter; explicit values must be one of the adapters supported by the
workflow contract.

`model` and `thinkingLevel` are stage controls. An omitted model resolves from
the request, the stage, `PIANO_PI_MODEL`, and finally
`~/.piano/agent.config.json`; it is never the literal model id `default`.
`thinkingLevel` uses Pi's portable `off`, `minimal`, `low`, `medium`, `high`,
`xhigh`, or `max` levels and is passed to the SDK as its reasoning effort.

## Workflow templates

`workflows/` contains source templates, not mutable live workflows. Piano's
default run loads `workflows/topsop-tuning.yml` directly from the installed
templates — nothing is copied into `~/.piano/`. The default is recorded under
the `workflow` key of `~/.piano/config.json`: `builtin:<template>` (for
example `builtin:topsop-tuning` or `builtin:coding-pi`) means that shipped
template, while a file path — set by the TUI picker or by editing the config
— selects that workflow from then on. A missing config is created on the
first default run, naming the current default, and a legacy config without
the key is backfilled the same way; both events are reported in the run log.
An absent key is never a validation failure.

`workflows/coding-<harness>.yml` (`coding-pi.yml`, `coding-dsh.yml`, and
`coding-claude.yml`) are the plain coding-agent templates: a single stage on
the shipped `basic` worker, which intentionally has no prompt, context, or
skills and is the default worker used by those templates. Each template's
filename suffix names the adapter its stage runs on.

GPU tuning templates are language-specific: `gpu-triton-tuning.yml` is for
Python/Triton workloads such as `matmul-512`, while `gpu-cuda-tuning.yml` is
for native C++/CUDA workloads such as `cuda-matmul-tuning-pi-dsv4f`.

`gpu-cuda-tuning.yml` has three variants for evals comparison and manual
trials, each with a matching eval workload under `evals/workloads/`:

- `gpu-cuda-tuning-tournament.yml` (case `cuda-matmul-tuning-tournament-pi-dsv4f`): the
  round's implement→measure work fans out into a per-iteration `tournament`
  region racing three strategies proposed by `cuda-idea-tournament`. The
  winner is decided once when the region exits — the exit benchmark metric
  referees, the winner's own worker consolidates the shared source, and the
  next iteration starts from that winner.
- `gpu-cuda-tuning-tournament-mixed.yml`: the same tournament with the race's
  lanes pinned to a different model each — `model` takes a list inside a
  `tournament`, one entry per lane, whose length must equal the region's
  `count`. Lane `i` runs entry `i`, so the three lanes race
  `deepseek-v4-flash`, `qwen3.8-flash` and `gpt-5.6-luna` against each other
  instead of three strategies of one model. A template for manual trials; it
  has no eval workload.
- `gpu-cuda-tuning-dsh.yml` (case `cuda-matmul-tuning-dsh-dsv4f`): the serial
  pipeline with every stage pinned to `harness: dsh`,
  `model: deepseek-v4-flash`.
- `gpu-cuda-tuning-claude.yml` (case `cuda-matmul-tuning-claude-dsv4f`): the same
  pipeline on `harness: claude`, `model: deepseek-v4-flash` — the harness
  dimension against the Pi and dsh twins.
- `gpu-cuda-tuning-qwen.yml` (case `cuda-matmul-tuning-claude-qwen`): the same
  claude-harness pipeline with only the model swapped to `qwen3.8-flash` —
  the model dimension against `cuda-matmul-tuning-claude-dsv4f`. Note:
  `qwen3.8-flash` is not in the proven model set
  (`scripts/agent.config.template.json`); if the gateway rejects it, retry
  with `qwen3.8-max` or `qwen3.8-27b`.
- `gpu-cuda-tuning-pi-glm.yml` / `gpu-cuda-tuning-claude-glm.yml` /
  `gpu-cuda-tuning-dsh-glm.yml` (cases `cuda-matmul-tuning-pi-glm`,
  `cuda-matmul-tuning-claude-glm`, `cuda-matmul-tuning-dsh-glm`): the serial
  pipelines on the three harnesses with only the model swapped to
  `glm-5.3-flash` — the glm model dimension across harnesses (non-tournament
  only).
- `gpu-cuda-tuning-codex-luna.yml` (case `cuda-matmul-tuning-codex-luna`): the
  serial pipeline on the Codex CLI harness with `gpt-5.6-luna`.

These tuning recipes run `iterations: 10` so their per-iteration
trajectories and cost totals are directly comparable.

`paper-writing.yml` is a different shape of run: one interactive alignment
stage, then an autonomous loop, then a submission check.

```text
prepare (discuss) ──▶ calibrate ──▶ ┌─ polish loop (duration 259200) ─┐ ──▶ finalize
                                     storyline → figures → write
                                     → audit → review → revise
```

- `prepare` is the only stage that talks to a human. On `harness: pi` (the only
  adapter with Piano's `discuss` tool) it asks, in one batch, for the working
  title and core claim, the code and data that back it, the contributions, the
  target venue with its template and page limit, and — the field the whole
  workflow is built around — which **finished papers** are the standard to
  match. It writes `brief.json`, which every later stage reads.
  - Before it asks anything, it reads **`PROMPT.md`** from the workspace root if
    one exists: the document an author writes once, usually after talking a
    design through, so that the run starts from settled decisions instead of the
    agent's guesses. `recipes/workflows/paper-writing.PROMPT.md` is a
    copy-ready template for it, and the `prompt.json` block inside that template
    is validated against the `paper-brief` contract by
    `tests/workflow/paper-prompt-doc.test.ts`, so it cannot drift out of date.
  - Source precedence is `PROMPT.md` → the repository → the `discuss` batch → a
    default recorded in `open_assumptions`. Where the document and the tree
    disagree the document wins, because it may deliberately describe a target
    state the tree does not reach yet, and every such disagreement is listed in
    the brief's `prompt_doc.conflicts` rather than silently resolved.
  - `discuss` must be named in the stage's `tools` as well as set as
    `discuss: true`; the flag supplies the callback and the list is the
    allowlist. Without it the stage runs, asks nothing, and the interactive
    alignment silently does not happen.
- `calibrate` distils the named reference papers into a *reference spec*: the
  section budget they actually spend pages on, the arc each one follows, the
  grammar of their figures, and the prose habits worth imitating. The loop
  optimizes against that spec rather than against the model's memory of how
  papers are written.
- The `polish` loop is bounded by `duration`, not `iterations`: a round can be
  minutes (revising one paragraph) or hours (generating a figure set from raw
  measurements), so a fixed count would make the run's cost unknowable.
  Its `feedback: review` threads each round's reviewer findings into the next
  round's storyline, so the loop attacks what is currently worst.
- Every stage declares `retry: { attempts: unbounded, backoff: 30, backoffMax:
  900 }`, so a provider outage or gateway hiccup neither ends the run nor
  requires a human: the wait starts at 30 seconds and doubles to a 15-minute
  cap. `timeout` is a per-turn runaway guard only — a timeout ends that attempt
  and the retry policy resumes it.
- `finalize` verifies the compiled artifact against the venue's requirements
  (page limit, template, anonymization, resolved references, appendix) and
  reports, honestly, everything the loop deferred.

`paper-writing-smoke.yml` is the same pipeline with the loop turned down to a
60-second bound: it differs from the full template in exactly two lines, the
workflow name and the loop's `duration`. **It is a wiring check, not a fast
test.** `duration` bounds the loop and not the run, so `prepare`, `calibrate` and
`finalize` still run to completion; its cost is those three stages plus exactly
one loop round. What it proves is that every worker's `agents.md`, skill and
contract load, that every stage's inputs resolve, that one full round completes,
and that the loop exits on its deadline.

Two properties of this workflow are worth knowing before you read its output:

- **The loop has one gateway.** Inside a loop a stage may name only its own
  siblings in `from`, so the brief and the reference spec can enter the round at
  exactly one place — the region's `from`, which feeds the loop's entry. The
  scenario this design defends against is a stage whose skill describes a
  document that never arrives; `paper-storyline` therefore restates the venue, the
  core claim, the manuscript paths, the evidence roots and the reference spec
  path in its result's `context` block, and the later stages read them from
  there.
- **A round cannot finish on a broken manuscript.** `paper-write` and
  `paper-revise` carry an `x-piano-assertions` rule requiring `compiles: true`,
  with a `blocked` escape hatch (and a `workflow.status` projection) for a tree
  that genuinely cannot be built. Without the hatch, an unbounded retry policy
  would loop on an unbuildable manuscript forever; with it, the engine stops the
  loop and the accepted blocked record is what `finalize` reports.
- **`duration` and `retry` disagree, and `retry` wins.** `duration` bounds how
  long the loop may keep *starting* iterations, not how long the run may take.
  The iteration in flight when the deadline passes always finishes — a round is
  the unit of work and a region clock cannot interrupt a turn — and an unbounded
  retry inside it keeps the run alive past the deadline, so `finalize` is not
  reached until that stage stops failing. That is the right trade for an
  unattended run, where a transient provider fault is likelier than a permanent
  failure. It is the wrong trade while testing new workers: set `attempts` to a
  finite number for that run, so a permanently broken stage surfaces instead of
  hiding behind a retry loop.

The paper workflow's nine workers are `paper-prepare` (the interactive brief),
`paper-calibrate` (reference spec), `paper-storyline` (one unit's paragraph
plan), `paper-figures` (the figures and their captions), `paper-write` (the
prose), `paper-audit` (every number and claim checked against the data),
`paper-review` (reviewer simulation at the target venue), `paper-revise`
(applies the audit's and review's findings), and `paper-finalize` (submission
checks and the honest final report).

## Workflow data flow

`from` only expresses scheduling dependencies. A stage that needs predecessor
evidence declares `handoff`; Piano then writes an invocation-private context
file containing immutable producer records. Handoffs are not session resume.
Within one execution, an actor resumes only its own logical stage (and map
lane, where applicable).

`validate: true` selects `contract.json` from that stage's worker directory.
The file contains a versioned JSON Schema, an example shown to the agent,
optional RFC 6901 pointers to `benchmark/v1` metric payloads, and generic
semantic projections for handoff/progress transport. Piano snapshots the exact
contract into the run before dispatch, validates the worker's
invocation-local result, and gives a malformed or missing result one resumed
repair turn. Omitting `validate` means no structured result is required.
Validation does not create a scheduling dependency by itself, so a consumer
still needs `handoff` when it needs upstream evidence. A declared
`outputs.projections` block is nevertheless persisted as structured semantic
output in the handoff/progress records; it does not replace the consumer's
`handoff` declaration. String-valued validators are legacy-only.

Cross-field invariants that JSON Schema cannot express may use the generic
root-level `x-piano-assertions` expression list. Field paths, formulas,
tolerances, and error messages remain worker-owned in `contract.json`; the
contract runtime only evaluates the declared expression tree and contains no
worker-specific rules.

For schemas that intentionally tolerate extra worker fields, the root-level
`x-piano-unknown-properties: "strip"` keyword opts into recursive stripping of
unknown object properties on a cloned payload before strict validation. It does
not mutate the original worker payload; schema-declared `additionalProperties`
rules still control properties that are explicitly handled by the schema.

The canonical topsop workflow uses nine stage-specific worker contracts:
`topsop-setup-env` (environment and build credentials), `topsop-explore`
(source and architecture facts), `topsop-theory` (baseline and theoretical
ceiling), `topsop-profile` (per-round profiling), `topsop-idea` (one-variable
proposal), `topsop-implement` (apply and compile it), `topsop-verification`
(correctness), `topsop-measure` (benchmark and KEEP/DISCARD decision), and
`topsop-summary` (final result and progress record). The tuning loop uses the
last five loop roles from profile through measure; the older multi-mode
`topsop-estimate`, `topsop-optimize`, and `topsop-verify` workers remain
available for existing workflows during the deprecation window, but new
workflows should not use their union contracts.

The CUDA profile contract accepts `ready`, `timing-only`, or `blocked`. A
timing-only result may contain only measured timing/derived bandwidth and must
leave unavailable hardware counters absent; a blocked result must include the
real blocker. For a validated CUDA round, a `KEEP` decision is materialized by
the orchestrator through a digest-checked compensation transaction before the
next loop iteration. This is not a filesystem/Git atomicity guarantee: if
rollback cannot be proven, the run reports unknown source state and preserves
canonical evidence for recovery. A discarded/failed candidate is restored from
the current-best artifact so final grading never scores an unselected candidate.

If a validated stage returns `status: "blocked"` or `decision: "BLOCKED"`,
the containing scope stops before issuing more dependent/loop turns. The
accepted blocked record remains the loop boundary, so a downstream summary can
report the real blocker without pretending that tuning iterations ran.

Every stage runs with an explicit `cwd` binding. Root and loop stages share the
caller-provided workspace; map slots receive directory snapshots recorded under
the run. The stage prompt names that workspace and all injected context paths,
while the harness emits resource-loaded events for the system prompt, context,
and skills. New runs append accepted stage results to `progress.jsonl` at the
run root and write recorder-owned metric streams under `trajectories/`. The
progress stream remains the accepted-stage ledger; `benchmark.jsonl` is the
task-metric trajectory, and the per-stage Pi JSONL files remain transcripts
rather than performance trajectories.
