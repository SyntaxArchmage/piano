# Piano

Piano runs repeatable **agent tuning workflows** from YAML. Start with a prompt,
use a built-in CUDA or GCU/Topsop workflow, or tailor the harness and model to
your environment. Every run leaves behind the progress, transcripts, and
results you need to inspect what happened and continue later.

This guide follows the user journey: get Piano running, choose how to run it,
customize a tuning workflow, then inspect and evaluate the results.

---

## Get started

### Requirements

- **Node.js 22** or newer.
- A configured Pi coding-agent endpoint: a `provider`, `model`, and `apiKey`
  (see [Configuration](#configuration)).
- Optional native harnesses for workflows that select them: Claude Code's
  `claude` executable and the official DeepSeek Harness's `dsh` executable.
  Install and authenticate these manually through their own supported setup;
  Piano only detects and invokes programs already available on `PATH`.

### Install

```bash
git clone <repo-url> piano
cd piano
npm install
```

To expose the `piano` command on your `PATH`:

```bash
# User-scoped (recommended): links into ~/.local, no root access needed
npm run link:cli:user

# System-wide: links into the npm global prefix (may require sudo)
npm run link:cli
```

`link:cli:user` keeps the install inside your own account — a `piano` symlink in
`~/.local/bin` plus a package link in `~/.local/lib/node_modules`. Nothing is
written outside your home directory, so the command stays private to you.
`link:cli` does the same through the npm global prefix for a machine-wide
install.

> **Note:** `link:cli:user` only works if `~/.local/bin` is on your `PATH`,
> which is not the case for every shell. Verify it first:
>
> ```bash
> case ":$PATH:" in *":$HOME/.local/bin:"*) echo on PATH ;; *) echo missing ;; esac
> ```
>
> If it prints `missing`, add `~/.local/bin` to your shell startup file (e.g.
> `~/.bashrc`, `~/.zshrc`) and reload it, then run the link command again:
>
> ```bash
> echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
> source ~/.bashrc
> npm run link:cli:user
> ```

Without linking, replace every `piano …` below with `npm run run -- …`.

### Start in the TUI

Run `piano` with no prompt to open the interactive workspace. Use it when you
want to see the agent conversation, follow the workflow trajectory, and steer
or resume a run without leaving the terminal:

```bash
piano
```

![Piano TUI with a sign-off review](docs/assets/tui-signoff.png)

Choose a target directory with `/workspace`, select a workflow with
`/workflow`, then type a task and press Enter. The TUI keeps the current
workflow, trajectory, usage, and shortcuts visible while the agent works. A
workflow stage that requests sign-off pauses in the same view so you can
approve its result or send it back with feedback.

![Piano TUI during a workflow run](docs/assets/tui-active-workflow.png)

Use `/resume` to continue a previous run and `/side` to show or hide the
trajectory pane. See [Interactive controls](#interactive-controls) for every
command and shortcut.

### Run a task from the CLI

For a non-interactive task, pass a prompt with `-p`. Piano uses its default
workflow — the topsop tuning flow (`recipes/workflows/topsop-tuning.yml`),
loaded directly from the installed templates. The default is recorded in
`~/.piano/config.json` under `workflow`: `builtin:<template>` (for example
`builtin:topsop-tuning`) means that shipped template, and a workflow you
select (in the TUI picker) records its path and becomes the default for
later runs. When the record is missing it is created and reported on the
first default run:

```bash
piano -p "write a haiku about a piano"
```

With `-p`, the task runs headlessly and prints its result when it finishes.

For scripts, `-p` can also act as the headless switch while the prompt is the
final argument after the other flags. Pass `--workflow` to pick another
template, for example the plain coding-agent template:

```bash
piano -p --json --workflow recipes/workflows/coding-pi.yml "print the code tree of this repo"
```

### Configuration

The adapter a stage runs on is its `harness` field; when omitted it defaults
to the workflow harness — `PIANO_HARNESS`, then the root `harness` in
`~/.piano/agent.config.json`, then `pi`. `pi` is the in-process SDK adapter;
`pi-cli`, `claude`, and `dsh` are the subprocess adapters.

Model and thinking-level resolution is a fallback chain. For any stage, the
effective `model` and `thinkingLevel` are selected in this order:

1. the caller's request override,
2. the stage fields (`model`, `thinkingLevel`),
3. the adapter's environment variables (`PIANO_PI_MODEL` /
   `PIANO_PI_THINKING_LEVEL` for `pi`; the parallel `PIANO_PI_CLI_*`,
   `PIANO_CLAUDE_*`, and `PIANO_DSH_*` / legacy `PIANO_DEEPSEEK_*` for the
   subprocess adapters),
4. the adapter's section in `~/.piano/agent.config.json`.

The `provider` and `apiKey` have no stage-level fields; they resolve from the
adapter environment (`PIANO_PI_PROVIDER` / `PIANO_PI_API_KEY` and their
`PIANO_<ADAPTER>_*` counterparts), then the adapter's config section. The
root-level `provider`/`model`/`apiKey` fields double as the `pi` section (they
predate per-adapter nesting).

Example `~/.piano/agent.config.json` (this is exactly what
`scripts/agent.config.template.json` ships; Piano never prints configured
values, and a `CHANGE_ME` placeholder is treated as unset):

```json
{
  "harness": "pi",
  "provider": "enflame",
  "baseUrl": "https://api.enflame.cn/v1",
  "model": "deepseek-v4-flash",
  "apiKey": "CHANGE_ME",
  "dsh": {
    "provider": "enflame",
    "model": "deepseek-v4-flash",
    "apiKey": "CHANGE_ME",
    "baseUrl": "https://api.enflame.cn/v1"
  },
  "claude": {
    "model": "deepseek-v4-flash",
    "authToken": "CHANGE_ME",
    "baseUrl": "https://api.enflame.cn"
  },
  "models": [
    "deepseek-v4-flash",
    "qwen3.8-27b",
    "qwen3.8-max",
    "gpt-5.6-luna",
    "gpt-5.6-terra",
    "claude-sonnet-4-6",
    "claude-opus-4-8",
    "claude-opus-5"
  ]
}
```

The sections are per-adapter. Root `baseUrl`, `provider`, `model`, and
`apiKey` configure the in-process `pi` adapter (an OpenAI-compatible gateway;
a bare origin gets `/v1` appended); an explicit `pi` section overrides them.
`dsh` reads the same OpenAI-compatible shape from its own section, `claude`
uses the Anthropic-style `authToken` + `baseUrl` pair, and either native
adapter may override its executable with `bin`, pass through keys such as
`home`/`homePath`, `profile`, and `toolsMode`, or name an environment variable
that holds its key with `apiKeyEnv`.

The root `models` array records the models this install has proven against its
provider. It is the sweep range for model diagnostics, not a whitelist: a model
outside the list stays selectable, so a stale list never blocks a newly
published model. `piano doctor --model all` sweeps exactly this list, sending one
real request per model.

`scripts/setup.sh` copies `scripts/agent.config.template.json` to
`~/.piano/agent.config.json` only when that file does not exist; an existing
config is never overwritten. The template and your own config are therefore
separate files — when the proven model list changes, update both.

The `pi`, `pi-cli`, `claude`, and `dsh` namespaces are independent. A stage's
`harness` selects its native adapter; `dsh` is not a Pi fallback. During a Piano
mission, Claude and dsh run with temporary private copies of their native homes
(`CLAUDE_CONFIG_DIR` and `DSH_HOME`) plus the selected Piano provider/model/key.
The user's native files are captured before the scope starts and are never
modified; the temporary scope is removed on normal completion, `/exit`,
cancellation, and handled failure. A durable marker is recovered before the
next mission if the process was killed before cleanup.

`thinkingLevel` uses Pi's portable levels, from least to most effort:
`off` → `minimal` → `low` → `medium` → `high` → `xhigh` → `max`.

Check your setup before a long run:

```bash
piano doctor --harness all
piano doctor --model
```

---

## Choose how to run

### Run a task

The top-level command runs one workflow (headless `--json`, or the interactive
TUI when no `-p` is given) and accepts these flags:

| Flag | Meaning |
|------|---------|
| `--workflow <path>` | Select exactly one `.yaml`/`.yml` workflow file. |
| `-p` | Run headlessly; provide the prompt as the final positional argument or with `--prompt`. |
| `--prompt <text>` | Provide the prompt text (headless mode is implied). |
| `--json` | Emit a newline-delimited headless event stream to stdout (requires `-p`). |

The same workflow can run interactively, headlessly, or as a JSON event stream:

```bash
# run a workflow headlessly against a prompt
piano --workflow ./tuning.yaml -p "tune the kernel"

# stream the run as machine-readable JSON lines
piano --workflow ./tuning.yaml -p "tune the kernel" --json
```

### Terminal image protocols

The TUI renders the live workflow DAG from an SVG scene rasterised to a PNG,
then picks the transport at runtime. Terminals that negotiate a raster-image
protocol with pi-tui (Kitty, iTerm2, and similar) receive the PNG through that
protocol. Terminals without one fall back to Sixel when it is available, and
otherwise to a text line-DAG.

Sixel is selected when `PIANO_IMAGE_PROTOCOL=sixel`, and also automatically
when the terminal advertises it (`TERM` containing `sixel`, or mintty/mlterm);
set the variable to `kitty`, `iterm2`, or `none` to force Sixel off. A bare
`xterm-256color` does not advertise Sixel, so an xterm build with Sixel
compiled in needs the explicit opt-in:

```bash
PIANO_IMAGE_PROTOCOL=sixel piano --workflow ./tuning.yaml
```

Without it Piano stays on the text fallback instead of emitting graphics
escape sequences the terminal may display as garbage.

### Run a built-in tuning workflow

#### CUDA

The CUDA template takes a kernel through setup, measurement, iterative tuning,
and a final summary:

```bash
piano --workflow recipes/workflows/gpu-cuda-tuning.yml -p "optimize the gemm"
```

#### GCU / Topsop

`topsop-tuning.yml` is the built-in workflow for a GCU/Topsop operator
repository. It prepares and explores the operator, establishes a performance
model, then iterates through profile → idea → implement → verify → measure
before producing a tuning summary. Run it from the target operator workspace
and point at the Piano checkout:

```bash
piano --workflow /path/to/piano/recipes/workflows/topsop-tuning.yml \
  -p "tune this GCU operator"
```

The GCU/Topsop template commits accepted rounds in that operator repository,
so use a branch you are comfortable changing.

`gpu-triton-tuning.yml` is the equivalent starting point for Python/Triton
workloads. The workflows directory also ships harness/model variants of the
CUDA template for side-by-side comparison — `gpu-cuda-tuning-claude.yml`,
`gpu-cuda-tuning-dsh.yml`, and `gpu-cuda-tuning-qwen.yml` — plus the plain
coding-agent templates `coding-pi.yml`, `coding-dsh.yml`, and
`coding-claude.yml`, each a single `basic`-worker stage whose suffix names the
adapter it runs on.

### Try tournament mode

`gpu-cuda-tuning-tournament.yml` runs the same 10-iteration loop but replaces
the single implementer with a `tournament` region: each round the idea stage
emits several strategies, `race` fans one lane per strategy, and the benchmark
decides the winner when the region exits. Use it when broader exploration is
worth the additional tuning budget:

```bash
piano --workflow recipes/workflows/gpu-cuda-tuning-tournament.yml \
  -p "optimize the gemm"
```

Compare the built-in serial and tournament workflows directly:

```bash
diff -u recipes/workflows/gpu-cuda-tuning.yml \
  recipes/workflows/gpu-cuda-tuning-tournament.yml
```

### Choose your harness and model

Copy a built-in workflow and set the harness and optional model on the stages
you want to vary. Piano supports `pi`, `pi-cli`, `claude`, and `dsh`:

```yaml
harness: dsh
model: deepseek-v4-flash
```

The supplied CUDA variants are useful starting points, and you can mix choices
by stage. Harness and model affect tuning quality as well as token and
wall-clock efficiency, so compare them as experimental choices rather than
assuming one pair is always best.

### Tool selection and naming

A stage's `tools` list carries the **exact native tool ids of that stage's
harness**. There is no translation layer: adapters transport the names
verbatim, and a wrong-harness or wrong-cased name is rejected when the
workflow is parsed (`stage.tools has unknown tool "read" for harness
"claude"`) instead of being silently dropped by the CLI at run time.

| Harness | Name style | Names you can list |
|---------|------------|--------------------|
| `pi` | lowercase | `read`, `bash`, `edit`, `write`, `find`, `grep`, `ls`, `web_fetch`, `web_search` |
| `pi-cli` | lowercase | `read`, `bash`, `edit`, `write`, `find`, `grep`, `ls`, `web_search` |
| `claude` | PascalCase | `Read`, `Bash`, `Edit`, `Write`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Task`, `TodoWrite`, `AskUserQuestion`, … |
| `dsh` | lowercase | `read`, `bash`, `edit`, `write`, `read_image`, `glob`, `grep`, `ask_user_question`, `web_search`, … |

- **Pick the smallest set that does the job.** A read-only analysis stage
  does not need `edit`/`write`; a stage with no `tools` field inherits the
  harness's own default surface.
- **`claude` supports permission-rule scoping**: `Bash(git *)` narrows the
  Bash tool to git commands, and `mcp__<server>__<tool>` addresses MCP server
  tools. Both forms are valid only for `claude`.
- **`dsh` is the exception**: headless dsh spawns with its preset's own tool
  mount set and never receives the stage list, so most `tools` entries on a dsh
  stage document intent and are validated against dsh's native ids. `web_search`
  is the deliberate exception: dsh mounts it by default, and Piano applies a
  generated ablation overlay unless the stage explicitly declares it.
- **Extending the catalog**: the authoritative per-harness name list lives in
  `packages/harness/src/tool-names.ts`. When a harness ships a new built-in
  tool (or you install a dsh plugin), add its exact id there; parse
  validation and the write/exec capability check behind `validate:` stages
  both read from that single registry.

### Continue a previous run

List previous runs and continue one with its trajectory and evidence available
as context:

```bash
piano resume --list
piano resume <run-id>
```

A run is one execution: resuming reopens the same run directory (a
`resume.json` records the execution id, prompt index, and actor sessions),
replays the prior transcript into the chat, and continues the actors the
previous prompts left behind — it takes the same path as sending the next
prompt in a live session. Inside the TUI, `/resume` routes to the same
mechanism.

---

## Track and manage your run artifacts

Piano keeps its user-level state under **`~/.piano/`**:

```
~/.piano/
├── agent.config.json  # provider, model, and harness configuration
├── prompt-history     # interactive prompt history
├── harness/           # generated adapter configuration
├── evals/             # case history/baselines, reports, and isolated eval workspaces
└── runs/<run-id>/     # one persistent Piano run
```

Entries are created on demand, so a new installation may not contain every
path yet.

Runs live under `~/.piano/runs/<run-id>/`. A run id looks like
`20260824T051320-f17b74` (UTC timestamp + short random suffix):

```
~/.piano/runs/<run-id>/
├── log.jsonl          # run + stage lifecycle events (machine-readable)
├── trace.jsonl        # function-level span traces
├── trajectory.json    # per-run summary: status, per-prompt turns, session/transcript of the latest turn
├── progress.jsonl     # append-only ledger: one line per accepted stage attempt
├── progress.json      # live workflow plan/status snapshot for monitors
├── resume.json        # durable resume state (execution id, prompt index, actor sessions)
├── contracts/<sha256>.json       # immutable worker-contract snapshots (when validate: true)
├── trajectories/
│   ├── index.json                # recorder inventory, status, and errors
│   ├── benchmark.jsonl           # validated task metrics by iteration (when the workflow declares one)
│   ├── duration.jsonl            # stage-attempt durations
│   ├── token-usage.jsonl         # token reports: cumulative plus per-attempt deltas
│   └── tool-calls.jsonl          # tool outcomes and durations
├── prompts/<promptIndex>/
│   └── invocations/<stageId>/<instance>/
│       ├── handoff/record.json   # immutable producer record for that invocation
│       ├── handoff-context/<file> # immutable context injected into a consumer
│       └── attempts/<n>/result.json # validation result per attempt
├── actors/<harness>/<stageId>/<lane>/
│   └── session/<session>.jsonl   # per-stage actor transcript
├── side-agent/                   # `/btw` side-agent harness session files (no stage, no execution)
├── workspace-records/<key>/record.json   # durable map/tournament workspace evidence
└── workspaces/slots/<key>/               # temporary map/tournament workspace copy
```

`<instance>` is `root` for a top-level stage, `<region>/iter-<n>` inside a
loop, and `<region>/slot-<n>` (or nested paths) for tournament lanes. A run
may hold several prompts: each prompt's invocations live under its own
`prompts/<promptIndex>/`, while the actors continue under `actors/` across
prompts. `contracts/`, validated result files, handoff files, and workspace
directories appear only when the workflow uses those features; completed runs
normally clean up `workspaces/` while retaining `workspace-records/`.

Key files:

- **`trajectory.json`** — the per-run summary: `status` (`completed` |
  `failed` | `cancelled`), the per-prompt `turns` (`prompt`, `status`,
  `eventCount`), the latest `sessionId` and `transcriptPath`, plus
  `runId`/`workflowPath`/`workspaceCwd`, and a `name` once you `/rename` the
  run.
- **`progress.jsonl`** — the machine-readable stage ledger. Every accepted
  stage attempt appends a line with `stageId`, `stage`, `worker`, `attempt`,
  `invocationId`, `harness`, `sessionId`, `transcriptPath`,
  `handoffRecordPath`, the workspace, and the latest progress snapshot
  (planned/completed counts). This is where you confirm a loop actually ran
  its `iterations` times.
- **`progress.json`** — the live, worker-neutral view. It reports the planned
  stage-invocation total, completed/remaining counts, per-DSL-stage counts, and
  the currently running or last accepted invocation (including loop iteration
  and tournament slot position and validation attempt). It is updated before
  each worker turn and after each accepted stage, so a monitor never has to
  infer progress from a worker name or count accepted lines by hand.
- **`trajectories/index.json`** — the versioned workflow-trajectory index. A
  `WorkflowTrajectory` drives independent benchmark, duration, token, and tool
  recorders. Recorder errors are isolated and make the index incomplete without
  discarding the accepted stage result.
- **`trajectories/benchmark.jsonl`** — task-specific metrics projected only
  from validated worker contracts (present when the workflow declares a
  benchmark metric). A loop supplies each record's `iteration`, so throughput,
  latency, or another declared metric naturally forms a series.
- **`contracts/<sha256>.json`** — exact schemas used during this run. Metric
  records carry the matching digest for reproducible evaluation.
- **`log.jsonl`** — ordering, prompt/skill injection, agent messages, tools,
  resource cleanup. Filter by `event` (for example `run.created`,
  `workflow.loaded`, `workflow.compiled`, `stage.started`,
  `agent.turn.started`, `agent.event.received`, or `function.enter`).
- **`trace.jsonl`** — the `fn` spans through the session and orchestrator
  (`createSession`, `loadOrCreateWorkflow`, `createAgentSession`,
  `executeWorker`, `executeAgent`, `sendPrompt`, …).

### Inspect a run

```bash
# interactive logs viewer (pick a run from a list)
piano logs
piano logs --trace          # view trace spans instead of lifecycle events
piano logs --check <run-id> # offline consistency check for run evidence
```

To inspect raw evidence directly:

```bash
RUN_DIR=~/.piano/runs/20260824T051320-f17b74
jq . "$RUN_DIR/trajectory.json"
jq -C . "$RUN_DIR/log.jsonl"       | less
cat     "$RUN_DIR/progress.jsonl"  | jq -c .
jq -C . "$RUN_DIR/progress.json"
find "$RUN_DIR" -type f -print | sort
```

---

## Customize Your Own Tuning Workflow

A workflow is a single YAML document, `version: 3`, with a `workflow` block. Its
`nodes` are an ordered list of `stage`, `loop`, and `tournament` nodes. Piano compiles
this into a DAG of concrete invocations and schedules it deterministically.

Start with a few stages, then add loops or parallel alternatives as the tuning
process grows. A workflow is a first-class, diffable file rather than an
imperative graph hidden in code.

### Stage

```yaml
- stage:
    name: measure                # unique name in its scope
    worker: cuda-benchmark-store # recipes/<worker> plugin identity
    harness: pi                 # pi, pi-cli, claude, or dsh
    model: <optional-model>      # omit to fall through config/ENV
    thinkingLevel: high          # off..max
    tools: [read, bash, edit, write]  # exact native tool ids for this stage's harness
    handoff: round.json          # artifact name consumed by downstream stages
    validate: true               # use recipes/cuda-benchmark-store/contract.json
    signoff: true                # gate each accepted attempt behind a human review
    from: [idea, implement]      # scheduling dependencies in this scope
```

| Field | Required | Meaning |
|-------|----------|---------|
| `name` | yes | Identifies the stage; dotted ids nest under regions (`tune.measure`). |
| `worker` | yes | Selects a worker plugin directory under `recipes/`. |
| `harness` | no | Agent adapter: `pi`, `pi-cli`, `claude`, or `dsh`. Defaults to `PIANO_HARNESS` → root `harness` in `~/.piano/agent.config.json` → `pi`. |
| `from` | yes | Upstream stage/region names in the same scope (empty for entry stages). |
| `handoff` | no | Names the immutable context artifact this stage produces for consumers. |
| `validate` | no | `true` loads the selected worker's optional `contract.json`; omit for no validation. |
| `signoff` | no | `true` requires a human to approve each accepted attempt before its result is published. |
| `model` | no | Stage model override. |
| `thinkingLevel` | no | Pi reasoning effort. |
| `tools` | no | Tool allowlist; must be the stage harness's exact native tool ids — see [Tool selection and naming](#tool-selection-and-naming). |
| `timeout` | no | Per-stage wall-clock timeout in seconds. |

`from` only expresses **scheduling** order. It does not transfer data. A stage
that needs upstream evidence declares `handoff`, and Piano writes an
invocation-private context file containing immutable producer records.

With `validate: true`, the worker writes result JSON to a path Piano supplies.
Piano validates it against `recipes/<worker>/contract.json`; a malformed,
missing, or schema-invalid result receives one resumed repair turn in the same
actor session. The declarative contract is JSON Schema Draft 2020-12 and may
declare metric outputs with RFC 6901 pointers. An omitted `validate` means no
result contract. Named string validators remain readable only as a deprecated
compatibility path for existing workflows and emit a user-visible
`PIANO_LEGACY_WORKER_CONTRACT` deprecation warning when loaded.

With `signoff: true`, every accepted attempt pauses before its result is
published and asks the human running Piano to approve it. The review is
harness-independent — it happens in Piano's own UI after the worker turn
finishes. Approving publishes the result; rejecting with feedback resumes the
same actor with the reviewer's notes as a follow-up message, the same way a
validation repair reuses the session. Cancelling the review fails the stage.
The run needs a sign-off channel: the interactive TUI mounts each review as the
last block of the chat area — a bordered panel whose purple outline is the only
full-width colour over a very dark purple fill, so it reads as a distinct
sign-off gate pinned right above the prompt; headless `-p` runs render the
dialog on the controlling terminal. A sign-off stage in a run with no terminal
fails up front.

### Loop

A `loop` repeats its child nodes `iterations` times, entry→exit. It runs for
**exactly** `iterations` regardless of per-round results — a candidate that
underperforms is a `DISCARD`, never a reason to stop the loop.

```yaml
- loop:
    name: tune
    from: [setup]
    entry: profile
    exit: measure
    feedback: measure          # prior iteration's `measure` result feeds the next entry
    iterations: 10
    nodes:
      - stage: { name: profile, worker: …, from: [] }
      - stage: { name: measure, worker: …, from: [profile] }
```

- `entry` / `exit` name direct child nodes that begin/end each iteration.
- `feedback`, when present, names a direct child whose prior-iteration accepted
  result is prepended to the next iteration's entry inputs.

### Tournament

A `tournament` region fans out `count` lanes over a field of a `from` node
(`over` is a dotted path into that producer's result). Each lane is an
independent actor with its own workspace snapshot; the region's `exit` stage
decides the winner by the declared benchmark metric, and the winning lane is
merged back at region exit.

```yaml
- tournament:
    name: race
    from: [idea]
    over: idea.strategies     # dotted path into a producer's result field
    count: 3
    entry: implement
    exit: measure
    nodes: [ … ]
```

The `map` literal used for this in early previews was renamed `tournament`;
parsing a `map` node fails with a rename error.

### Full example

See `recipes/workflows/gpu-cuda-tuning.yml` for a complete `setup` →
`loop[profile → idea → implement → measure] × 10` → `summary` workflow.
`gpu-cuda-tuning-tournament.yml` swaps the implement+measure steps for a
per-round `race` tournament over implement strategies (see
[Try tournament mode](#try-tournament-mode)).

---

## Extend Piano with custom workers

A `worker` name in a workflow resolves to a directory under `recipes/
<worker>/`. Workers are **configuration, not workflows**: they contribute a
system prompt, agent context, and Agent Skills to the stage that selects them.

```
recipes/
  <worker-name>/
    system-prompt.md          # optional; absent = Pi default prompt
    agents.md                 # optional worker context injected as a context file
    agents.<harness>.md       # optional per-harness appendix (pi, pi-cli, claude, dsh)
    contract.json             # optional result schema; required when stages use validate: true
    skills/
      <skill-name>/           # skill name (lowercase/digits/hyphens) must match dir name
        SKILL.md              # required inside each skill directory
```

- `system-prompt.md` is the worker's system prompt override. When absent, the Pi
  harness keeps its built-in default.
- `agents.md` is read as a context file (documentation/context for the agent),
  injected automatically.
- `agents.<harness>.md` extends `agents.md` for one harness only: a stage on
  `pi` gets `agents.md` + `agents.pi.md`, a stage on `claude` gets `agents.md`
  + `agents.claude.md`, and other harnesses' appendices are ignored. An
  unknown suffix (for example `agents.gpt.md`) fails the workflow load.
- `skills/**/SKILL.md` are Agent Skills, discovered and passed to the harness.

Worker resolution is worker-bound: the stage DSL carries no system-prompt/skills
paths. Worker resources load from `recipes/` under the installed Piano root —
never from the target cwd or `~/.piano`.

### The `basic` worker

`recipes/basic/` intentionally has no prompt, context, or skills. It is the
default worker used by the coding templates (`recipes/workflows/coding-pi.yml`,
`coding-dsh.yml`, and `coding-claude.yml`).

### Example: a custom worker

To add a `review` worker:

```bash
mkdir -p recipes/review/skills/review
cat > recipes/review/system-prompt.md <<'EOF'
You are a careful code reviewer. Produce a concise, actionable review.
EOF
cat > recipes/review/skills/review/SKILL.md <<'EOF'
---
name: review
description: Review a change for correctness and clarity.
---
# Review
1. Read the change and its callers.
2. Report concrete defects with file:line references.
EOF
```

Then reference it from a stage:

```yaml
- stage:
    name: review
    worker: review
    harness: pi
    tools: [read, bash]
    validate: true
    from: []
```

Add `recipes/review/contract.json` when the stage uses `validate: true`; omit
the field when this worker does not produce a structured result.

---

## Evaluate and compare results

Run the built-in eval cases against isolated workspace copies:

```bash
# list and run all cases
piano evals

# run one group, one tag, or one case
piano evals --group coding
piano evals --group tflops
piano evals --case matmul-512

# inspect a finished run offline (add --compare for a regression table)
piano evals --report

# compare completed CUDA tuning variants offline
piano evals --report --group tuning-cuda

# repeat a case and compare against a stored baseline
piano evals --case matmul-512 --trials 3
piano evals --record-baseline
piano evals --replay-baseline
```

The report starts compactly with its performance matrix and score summary, so
quality, token efficiency, and time efficiency stay easy to compare. Add
`--details` only when you need the per-case process output.

Example output from `piano evals --report --group tuning-cuda` (results vary by
machine, harness, and model):

![Compact tuning-cuda evaluation report](docs/assets/tuning-cuda-report.svg)

Use `--dry-run` to validate cases without executing them. Evals report
trajectory evidence, artifact checks, and benchmark results; the source
workload templates remain read-only.

---

## Command reference

All CLI commands route through the `piano` binary. Arguments are parsed and
validated; unknown arguments fail with a usage message.

### `piano [--workflow <path>] [-p] [--prompt <text>] [--json] [<prompt>]`

Run one workflow. With `-p` and a prompt, runs headlessly; without a prompt,
opens the interactive TUI. `--json` streams newline-delimited events to stdout
(requires headless mode).

### `piano logs [--trace] [--check <run-id>]`

Open the interactive logs viewer (default) or trace viewer (`--trace`), picking
a run from the stored runs. `--check <run-id>` performs a non-interactive,
read-only consistency check across the log, trace, trajectory, progress, and
referenced transcript files; it prints a report and exits non-zero when evidence
is missing, malformed, or inconsistent.

### `piano resume [<run-id>] [--list]`

List prior runs (`--list`), open the session picker (plain `piano resume`), or
continue a specific run by id. Resuming reopens that run's session, replays
its transcript into the chat, and keeps writing to the same run directory —
the next prompt continues the actors the previous prompts left behind (see
[Continue a previous run](#continue-a-previous-run)).

### `piano clear-all [--days <n>] [--hours <n>] [--force]`

Remove runs older than the given age. Use `--days` **or** `--hours` (not both).
`--force` skips confirmation.

### `piano doctor --harness <pi|pi-cli|claude|dsh|all>`

Check whether a harness is configured and runnable. For the subprocess
adapters (`pi-cli`, `claude`, `dsh`), `doctor` also sends one bounded real
health request through the native executable; a version response alone is not
reported as ready. The health request may consume provider quota or incur
cost. For `pi` (the in-process SDK adapter), the SDK module and
provider/model configuration are checked.

### `piano doctor --model [<model>|all] [--harness <pi|pi-cli|claude|dsh>]`

Fetch the OpenAI-compatible model list from the configured base URL (or
`https://api.enflame.cn/v1/models` by default) and print the advertised models.
When a model name is supplied, send one minimal completion request for that
model through the selected adapter — `pi` (the in-process SDK adapter) by
default, or `pi-cli`, `claude`, or `dsh` with `--harness`. `all` sweeps every
model in the config's `models` array, one real request per model. The
configured `apiKey` is never printed.

### Real harness acceptance test

The default test suite does not make network calls. On a machine where both
native harnesses are installed and authenticated, opt into the real test
explicitly:

```bash
PIANO_HARNESS_REAL_E2E=1 PIANO_REAL_MODEL=deepseek-v4-flash \
  npm test -- --run tests/harness/real-subprocess.e2e.test.ts
```

This makes real Claude and dsh calls, creates and reads a proof file in an
isolated temporary workspace, and checks the exact bytes, tool events, usage,
final response, and transcript evidence. It is intentionally skipped without
the opt-in variable and may incur provider cost.

### `piano evals [--group <group>] [--case <id>] [--trials <n>] [--timeout <seconds>] [--variant <name>] [--record-baseline|--replay-baseline] [--dry-run] [--root <path>]`

Run the evals pipeline: load all cases under the evals workloads (`--group`
selects one group — or, when the keyword matches a grader tag, every case
carrying that tag; `--case` selects one case), optionally `--trials` (1–10)
per case, execute each in an isolated copy of its workspace template, and
print a text report. `--timeout` sets the per-case launch timeout in seconds
(cases with a complete performance readout default to six hours); `--dry-run`
skips execution; `--root` overrides the case source root. `--variant` labels
the run for comparison; `--record-baseline` pins successful grader-owned
measurements, and `--replay-baseline` reuses the pinned baseline.

### `piano evals --report [--group <group> | --case <id>] [--runset <id>] [--compare] [--details]`

Analyze persisted run sets under `~/.piano/evals` without running anything. By
default it renders the compact performance matrix plus the aggregate summary
of the latest run set (`--runset <id>` picks another); `--compare` appends a
per-case, dimension-by-dimension delta table against the previous run set for
regression spotting. With `--group`/`--case` the report becomes a board of
every persisted case matching the keyword (group name or grader tag), each
taken from its newest run set and rendered as one matrix; `--compare` then
pairs every case against its own previous stored occurrence. `--details` adds
the per-case process print (status, cost, stage and progress lines).

---

## Interactive controls

The interactive TUI (opened by plain `piano` without `-p`) accepts slash
commands typed into the input box, plus terminal shortcuts.

### Slash commands

| Command | Meaning |
|---------|---------|
| `/btw` | Hand the chat pane to a side agent that can read, edit, write and run bash in the workspace. `/btw <prompt>` enters and runs that prompt at once; a bare `/btw` toggles back to the run. |
| `/exit` | Cancel the active prompt and close the session. |
| `/quit` | Alias for `/exit`. |
| `/rename <name>` | Rename the current run. |
| `/resume` | Take over another run through the session picker (disabled while a prompt is running). |
| `/side` | Toggle the side panel (live workflow DAG). |
| `/workspace` | Choose the workspace directory. |
| `/workflow` | Choose a workflow file. |

`/btw` is one direct agent call per prompt, never a second workflow: consecutive
`/btw` prompts continue the same side conversation, and the mission chat is put
aside intact and restored on return. It shares the run's workspace, interrupt
key and run directory (its harness session files land in `<run-id>/side-agent/`),
but writes no trajectory turn — the trajectory is the workflow's evidence, so a
side task never appears as one of its turns. Switching is refused while a prompt
is running, like `/resume`.

### Keyboard shortcuts

| Key | Meaning |
|-----|---------|
| `Esc` | Interrupt the running prompt. |
| `Ctrl+C` | Exit the session. |
| `Ctrl+O` | Toggle tool-box expansion in the transcript. |
| `Ctrl+E` | Toggle the latest error detail in the transcript. |
| `Alt+C` | Toggle copy mode: hand the mouse back to the terminal for native selection and copy. |

---
