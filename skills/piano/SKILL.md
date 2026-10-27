---
name: piano
description: "Use Piano/Tuna workflow runs from this agent: call the piano_run/piano_status/piano_result MCP tools when available, or the piano CLI as a fallback. Covers workflow selection, progress, run artifacts, headless behavior, and when not to use Piano."
---

# Piano

Piano (formerly Tuna) is a workflow orchestrator. A workflow is a YAML v3
document of `stage`, `loop`, and `tournament` nodes. Each stage runs an agent
through a harness (`pi`, `pi-cli`, `claude`, `dsh`, `codex`) with its own
prompt, tools, contract, and workspace. Piano runs the workflow headlessly and
writes one durable run directory per invocation.

Use Piano when the user asks for a multi-stage agent workflow, a tuning loop,
independent tournament candidates, or a repeatable pipeline. Do not use it for
a single-file edit that this agent can do directly.

## Prefer the tools

When this session exposes MCP tools named `piano_run`, `piano_status`, or
`piano_result` (some hosts prefix them, for example
`mcp__piano__piano_run`):

1. Call `piano_run` with the task prompt, the workspace `cwd`, and optionally a
   `workflow` path. Start with `waitSeconds` 30 for a short run.
2. If the result says `status: running`, keep the returned `runId`; call
   `piano_status` for the current stage and `piano_result` for the final
   summary and output. Do not start a second run just to poll.
3. Relay the returned `summary` and `output` to the user. Do not claim more
   than the tool returned.

The tool result's `summary` and `output` are the source of truth. A `cwd` is
required when the run should not happen in the current process directory.

## Fallback: the CLI

If the MCP tools are not available, run Piano through the shell:

```bash
piano -p --json --workflow <path> "<task>"
```

- `-p` is headless. Without `--json`, stdout contains only the final text and
  there is no progress until the run finishes.
- `--json` emits one NDJSON object per line: `run.started`, `agent_event`,
  `run.completed`, `run.failed`. It requires `-p`/`--prompt`.
- `--workflow` takes a filesystem path, absolute or relative to the cwd. It
  does not accept a builtin name. Without it, Piano uses the workflow recorded
  in `~/.piano/config.json`, or the shipped `recipes/workflows/coding-pi.yml`.
- `--mnemonic <name>` sets the lane namespace for tournament branches.
- The cwd is the workspace. There is no `--workspace` flag.
- `piano resume` and the bare `piano` TUI need a terminal; do not run them from
  a tool.

Only consume the incremental `delta` from `message_update`; its `message`
field repeats the full accumulated text. Read the final text from the
`run.completed` line. Long runs should be redirected to a log file and polled,
not held in one shell call.

## Workflows

Shipped coding templates live under `recipes/workflows/`:

- `coding-pi.yml`, `coding-claude.yml`, `coding-dsh.yml`
- There is no `coding-codex.yml`; a Codex worker needs a workflow that declares
  `harness: codex`.

Before a large run, inspect the workflow's stages and loops. `--workflow`
affects only that invocation; only the interactive picker records a new default.
Do not invent a workflow if the user has not asked for one.

## Output and artifacts

A run directory is `~/.piano/runs/<runId>/`:

- `status.json` is the authoritative lifecycle, stage counters, jobs, and
  actors.
- `system-log/log.jsonl` is the lifecycle event stream.
- `system-log/trajectory.jsonl` is the prompt/agent trajectory evidence.
- `system-log/invocations.jsonl` is the accepted-invocation ledger.
- `sessions/` holds each actor transcript.
- `eval-metrics/` holds benchmark/token/tool-call streams when the workflow
  declares them.

`piano logs <runId>` prints the run directory; it does not render the evidence.
Use `jq`/`tail` on the files above.

## Headless semantics

A headless run auto-continues sign-off gates and answers `discuss` with the
deterministic "please make decision by yourself, i am not here" substitute.
There is no human in the loop. If the task needs human review or a real
decision, ask the user to run the interactive TUI instead of `-p`.

## Cost and safety

- A workflow can spend many model turns. Check the stage/tournament count first.
- Tournaments create `tuna/<mnemonic>/lane-<n>` branches/worktrees; do not run
  two Piano runs in one workspace at the same time.
- `piano doctor` probes installed harnesses and may make a real model request;
  use it only when needed.
- Never print `~/.piano/agent.config.json`; it contains credentials.
- Do not nest a Piano worker inside another Piano worker.
- Do not kill a run unless the user asks; use the run's status and logs to
  report progress.

## When not to use Piano

- The task is a single straightforward edit in this agent.
- `piano` is not on PATH, or `piano doctor` reports the required harness as
  unavailable.
- The user needs an interactive sign-off or discuss exchange.
- The host has no shell/tool execution and the task cannot be expressed as a
  single command.
- The user did not ask for a multi-stage workflow and a direct answer is enough.
