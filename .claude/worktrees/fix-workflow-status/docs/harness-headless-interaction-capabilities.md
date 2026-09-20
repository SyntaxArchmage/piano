# Harness Headless Interaction Capabilities — Reference

- Status: **Implemented and investigated**
- Date: 2026-09-09
- Scope: Claude Code, pi, and the official DeepSeek Harness (`dsh` 0.1.1-rc.2) as Piano drives them
  from `packages/harness/src/subprocess.ts`

## 1. Summary

Piano drives both native harnesses in one-shot headless modes. Neither harness's
user-question UI component is present in those modes, and neither hangs: both
degrade to a clean tool error that the model folds into its output. A real
question-to-human round trip would require Piano to become the UI itself, and
only the Claude side offers a supported transport for that today.

## 2. Tool-name mapping (1:1, exact ids)

| Capability | Claude Code tool | dsh tool (standard preset, 标准模式) | dsh standard-mode status |
| --- | --- | --- | --- |
| Ask the human a question | `AskUserQuestion` | `ask_user_question` | mounted |
| Web search | `WebSearch` | `web_search` | mounted (`deepseek-official` provider, 60 s budget, `DEEPSEEK_API_KEY`; on gateway deployments Piano routes the shipped provider through the configured endpoint and credential, and removes it unless the stage declares `web_search`) |
| Web fetch | `WebFetch` | `web_fetch` | **disabled** — `fetch: false` in `dsh-base/cordis.patch.yml` and in the preset; no fetch provider is mounted (official rationale: the provider defers SSRF protection and the model chooses the request target) |

`ask_user_question` argument shape mirrors `AskUserQuestion` field for field:
`questions[]` with `id`, `question`, `header`, `options[{label, description}]`,
`multi_select`; recommended option first with a `(Recommended)` label suffix;
answers returned as `{ answers: [{ id, selected, custom? }] }`.

pi has no built-in web search. Piano ships a `web_search` extension
(`packages/harness/src/pi-web-search.ts`) that calls the configured gateway's
Anthropic server-side `web_search_20250305` tool. The in-process Pi SDK loads
it through `extensionFactories`; `pi-cli` loads the same module with
`--extension`. Both are mounted only when the stage declares `web_search`.
The endpoint must serve `/messages` with that server tool enabled.

## 3. Headless behavior of the question tools

### 3.1 Claude (`claude --bare --print --output-format stream-json --verbose`)

- The interactive question UI never exists in print mode. A tool call that
  would prompt the user is auto-denied; the model receives an error tool
  result (the run's `permission_denials` surface it) and continues.
- `--permission-mode bypassPermissions` (what Piano passes for tool tasks) does
  not change this: bypass removes permission prompts, it does not create an
  interaction channel.

### 3.2 dsh (`dsh --profile headless "<task>"`)

- `ask_user_question` calls `ctx.userQuestions.ask()`, which needs one UI-side
  provider registered. The shipped provider lives in the web host runtime
  (`dsh-client-ui-user-questions` renders it there); the headless bundle mounts
  no Host, HTTP server, Web runtime, or browser plugin.
- With no provider, `ask()` fails with `Error: no user-questions provider is
  registered` — a clean, model-visible failure, not a hang. The standard
  preset's plan-mode guidance tells the model to carry unresolved questions
  into its final result in exactly this case.
- The headless stdout protocol carries no event stream at all: the process
  writes the last non-empty assistant text to stdout and exits 0/1. There is
  nothing NDJSON-shaped to parse or answer.

### 3.3 dsh streaming display in Piano

The absence of a dsh stdout event protocol does not prevent a live TUI view.
Piano starts a best-effort tailer alongside the child and reads the dsh session
artifact under `DSH_HOME/sessions/<project>/<session>/`. The official
`0.1.1-rc.2` persistence backend defaults to independently compressed zstd
frames (`session.jsonl.zstd`); the adapter also accepts the uncompressed
`session.jsonl` form.

The tailer makes the following compatibility decisions:

- Poll the append-only artifact every 50 ms, consume only complete zstd frames
  and newline-terminated JSON records, and retain an incomplete physical tail
  for the next poll.
- Expand dsh's default `packChunks: true` storage rows (`text-chunks`,
  `reasoning-chunks`, and `tool-call-chunks`) back into the corresponding
  `assistant/chunk` events before mapping them to Piano's existing
  `message_start` / `message_update` / `message_end` contract.
- Map durable assistant messages, tool calls/results, usage, and turn
  lifecycle into the same event vocabulary consumed by the TUI and trajectory
  panel. Current dsh logs use `step/start` and `step/end` inside a
  `turn/start`; if headless shutdown omits the outer `turn/end`, Piano closes
  the still-open turn during finalization.
- Use dsh's final stdout text as the authoritative completion value and as a
  fallback assistant message when no session artifact is available. The
  fallback preserves headless correctness but cannot provide live display.

This is eventual streaming, not a token transport: dsh's persistence
coordinator batches writes with a default maximum delay of 200 ms, and packed
rows are visible only when their batch is durable. The TUI can therefore lag
the provider by roughly one persistence batch even though the tailer itself is
polling more frequently. A missing, stale, or incompatible artifact never
turns a successful headless stdout result into a failure.

## 4. Can the question ride the NDJSON stream?

- **Claude:** visible but not answerable in one-shot `-p`. The
  `control_request` / `control_response` mechanism (the transport behind the
  Agent SDK's `can_use_tool`) is only emitted when stdin stays open in
  streaming-input mode (`--input-format stream-json` plus a callback or
  `--permission-prompt-tool`). Piano's single-shot invocation has neither, so
  the `tool_use` appears in the output stream and the question is denied in
  the same breath.
- **dsh:** no. Bridging would mean shipping a custom dsh plugin that calls
  `ctx.userQuestions.registerProvider()` and relays `ask()` onto a Piano
  channel. The seam exists; the plumbing is ours to write.

## 5. Adaptation options for a Piano-side question UI

1. **Claude only:** switch the subprocess to streaming-input mode, parse the
   `AskUserQuestion` `tool_use`, collect the answer in the Piano TUI, and write
   the matching `control_response` back. Bounded, protocol-supported work.
2. **dsh only:** custom `userQuestions` provider plugin plus a transport into
   the headless process (dsh ships no NDJSON protocol for it). Larger,
   off-the-shelf-path work.
3. **Accept the degradation (current posture, recommended):** worker tasks are
   one-shot and autonomous; a harness question that cannot reach a human is
   reported inside the worker's result instead. Human review, when a flow
   genuinely needs it, is an explicit workflow stage — approval should not
   ride a harness's interactive tool transparently.

## 6. Sources

- Local install inspection (2026-09-03): `@deepseek-ai/dsh` 0.1.1-rc.2 —
  `config/agent-presets/standard/{preset.yml,agent.cordis.yml}`,
  `dsh-base/cordis.patch.yml`, `dsh-headless/README.md`,
  `dsh-tool-web/lib/index.js`, `dsh-tool-ask-user/README.md`,
  `dsh-user-questions/README.md`.
- Piano invocation: `packages/harness/src/subprocess.ts` (`claudeArguments`,
  `dshArguments`, `childEnv`).
- Claude behavior: code.claude.com SDK/permission-modes documentation, via the
  claude-code-guide agent (2026-09-03).
