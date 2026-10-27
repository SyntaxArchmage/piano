# dsh spike — Piano progress as a custom Chat node

Status: **PASS for live rendering**, **BLOCKED for cold session reload** unless the
first-party Session event vocabulary is extended (see [Cold reload](#cold-reload)).

This spike answers one question: can a dsh native plugin + client UI plugin render
live Piano/heartbeat progress as a **custom Chat node in the main transcript**,
modeled on the shipped `dsh-tool-workflow` + `dsh-client-ui-workflow-run` pattern?

Environment: `dsh 0.1.5-rc.2` (global npm install), Linux, Node 22.23.2, Chrome
for Testing 145 via Playwright. All dsh state used a temporary `DSH_HOME`; the
real `~/.dsh` was never read or written.

## What is here

| Path | Role |
|---|---|
| `plugin/package.json` | Dual-face plugin package: host entry plus a `dsh.client` web declaration. |
| `plugin/lib/index.js` | Host plugin: registers `piano_spike`, spawns a 10 s heartbeat child, optionally runs `piano -p --json`, appends `piano-spike/*` log-only Session events, returns only the final text. |
| `plugin/lib/client.js` | Browser plugin in the dsh lazy-CJS bundle form: registers a Conversation Definition and a keyed `conversation.chat.node` renderer for kind `piano-spike`. |
| `fake-llm.mjs` | Deterministic OpenAI-compatible stand-in that makes turn 1 call `piano_spike` and turn 2 return final text; also answers the session-title request. |
| `fast-workflow.yml` | One-stage, zero-tool Piano workflow used for the real `piano -p --json` run. |
| `setup-profile.mjs` | Creates an isolated `DSH_HOME`, initializes a custom `dsh-spike` profile from the shipped `web` template, and writes the profile patch. |

The host plugin deliberately imports no `@deepseek-ai/*` packages: a plugin
loaded by absolute path from this checkout cannot resolve the dsh
installation's `node_modules`. It registers the same plain tool-definition
shape that `defineTool()` produces, and appends Session events through
`exec.agent.session.append(...)`.

## Setup

```sh
# 1. Temporary home, workspace, profile patch (never touches ~/.dsh).
node spikes/agent-chat-extensions/dsh/setup-profile.mjs \
  /home/albert/.claude/jobs/81a6a04a/tmp/agent-chat-extensions/dsh

# 2. Deterministic provider, because the spike must not depend on a real model.
SPIKE_PORT=39871 \
SPIKE_WORKFLOW_PATH=/home/albert/workspace/piano-dev-branch/spikes/agent-chat-extensions/dsh/fast-workflow.yml \
SPIKE_REQUEST_LOG=/home/albert/.claude/jobs/81a6a04a/tmp/agent-chat-extensions/dsh/evidence/run3/fake-llm-requests.jsonl \
node spikes/agent-chat-extensions/dsh/fake-llm.mjs

# 3. Boot the temporary profile. Unset DISPLAY so the directory-picker-auto row
#    mounts the in-app browse picker instead of a native zenity dialog that a
#    headless browser cannot drive.
cd /home/albert/.claude/jobs/81a6a04a/tmp/agent-chat-extensions/dsh/workspace
env -u DISPLAY -u WAYLAND_DISPLAY \
  DSH_HOME=/home/albert/.claude/jobs/81a6a04a/tmp/agent-chat-extensions/dsh/home \
  DSH_SPIKE_API_KEY=spike \
  dsh --profile dsh-spike --port 3099 --no-open

# 4. Open the printed tokenized URL. Choose the temporary workspace through the
#    browse picker, then send "Run the piano spike now." in the composer.
```

The generated profile layer is exactly:

```yaml
- id: llm-deepseek
  config:
    apiKeyEnv: DSH_SPIKE_API_KEY
    baseURL: http://127.0.0.1:39871

- insert:
    - id: piano-spike
      name: /home/albert/workspace/piano-dev-branch/spikes/agent-chat-extensions/dsh/plugin/lib/index.js
```

The client half is discovered by `dsh-client-modules` from the same package's
`dsh.client` declaration; the boot graph served
`dsh-piano-spike/client.js` automatically.

## Observed behavior

The run was driven with Playwright (headless Chrome) against the web UI. The
model called `piano_spike` with the fake workflow path; the tool pulsed a
heartbeat child for 10 s and then ran the real
`piano -p --json --workflow fast-workflow.yml "print OK"`.

| Check | Result | Evidence |
|---|---|---|
| Host tool registered and called | **PASS** | `toolNames` includes `piano_spike`; session `tool/call` |
| Log-only events appended | **PASS** | 17 events: `run-start`, 15 `progress`, `run-end` |
| Client bundle served | **PASS** | boot graph entry `dsh-piano-spike`, `/plugins/??...dsh-piano-spike/client.js` |
| Custom node renders in main transcript | **PASS** | node first seen 534 ms after send; `data-chat-flow-kind="piano-spike"` |
| Progress updates live | **PASS** | status `Running`, line advances every second: `heartbeat 1/10` … `heartbeat 10/10`, then phase `piano` |
| Completion updates in place | **PASS** | status `Completed`, final text `OK`, at 12.96 s |
| Model sees only the final result | **PASS** | `tool/result` content is `[{"type":"text","text":"OK"}]`; the next provider request's tool message is exactly `OK` |
| No browser errors | **PASS** | `page-errors.log` empty |
| Requires a dsh restart | Boot-time: yes for plugin/patch/client-bundle changes; no per-use restart. Cold session reopen needs the vocabulary fix. |
| Profile reusable | **PASS** | the same temporary `DSH_HOME`/`dsh-spike` profile booted repeatedly without re-initialization |
| Cold session reload | **FAIL** unpatched; **PASS** with spike-only vocabulary extension | see below |

Timings from the final run: first custom node at 534 ms, completed at
12,961 ms; the Piano child itself contributed ~2 s after the 10 s heartbeat.
The client throttle dropped 10 of 33 Piano lines (~5 appends/s cap), which is
the intended mitigation for cumulative `message_update` lines.

Run identifiers for traceability: dsh session
`91e7e18f-c862-4b6e-adaa-209a1aaeb71e`, tool run
`ecf37a49-c5f2-48e6-82cc-8440e3975840`, Piano child run
`20261027T055308-f2be60`. A freshly generated profile from `setup-profile.mjs`
was also booted once to confirm the setup script reproduces the composition.

### Node placement after completion

While the turn runs, the custom node is visible in the transcript under the
`piano_spike` tool card. After the turn settles, dsh's compact-turn logic folds
process nodes into the **"1 tool call"** disclosure; the node is still present
and durable, but hidden until the disclosure is expanded. This is existing Chat
target behavior, not a plugin failure. A product surface that must stay open
after completion needs either a non-process node placement or a change in that
fold policy; a Conversation Definition cannot override it.

## Cold reload

`piano-spike/*` are plugin-defined event types. Live append works, but on a
cold session open `dsh-session` refuses the log:

```text
session "..." contains event type "piano-spike/run-start" (seq 17) unknown to
this harness and not marked ignorable; refusing to interpret the log — it was
likely written by a newer harness
```

The public `Session.append()` API has no way to set the envelope's
`ignorable: true` marker, and `KNOWN_SESSION_EVENT_TYPES` is a closed set in
`@deepseek-ai/dsh-session`. The shipped `tool-workflow/*` events work only
because they are hard-coded there.

For the spike, `plugin/lib/index.js` contains a clearly marked **unsupported
workaround**: it resolves `@deepseek-ai/dsh-session` through the running dsh
entry point and adds the three `piano-spike/*` names to the exported mutable
`KNOWN_SESSION_EVENT_TYPES` set before registering the tool. A/B evidence:

- `PIANO_SPIKE_SKIP_VOCABULARY_PATCH=1` → cold open fails with the message above.
- Default patch → the node reconstructs from the persisted log after restart
  with status `Completed` and final text `OK`.

This workaround is not a shipping path. A real plugin needs a first-party
event-vocabulary registration API (or an append-level `ignorable` option) in
dsh before custom durable event families can survive a restart.

## Evidence

Raw captures live under
`/home/albert/.claude/jobs/81a6a04a/tmp/agent-chat-extensions/dsh/evidence/`.

| File | Content |
|---|---|
| `run3/observations.json` | Per-sample DOM state: first node 534 ms, live heartbeat lines, completion 12.96 s. |
| `run3/10-node-first-seen.png`, `run3/11-node-progress-*.png`, `run3/12-node-completed.png` | Screenshots of the custom node during and after the run. |
| `run3/13-transcript-final.png`, `run3/transcript-final.txt` | Final main transcript. |
| `run3/piano-node.html` | Rendered node HTML (`data-piano-spike`, status, line, final text). |
| `run3/boot-graph.json`, `run3/plugin-requests.json` | Client plugin in the boot graph and its served bundle. |
| `run3/session.jsonl` | Decoded durable session: 17 `piano-spike/*` events, `tool/call`, `tool/result` with only `OK`. |
| `run3/fake-llm-requests.jsonl` | Provider requests; the post-tool request has `lastToolText: "OK"`. |
| `15-node-cold-replay.png/.json` | Custom node replayed from the persisted log after restart (patched). |
| `16-cold-replay-unpatched.png/.json` | Cold-open refusal with the vocabulary patch disabled. |
| `piano-direct.ndjson`, `piano-direct.err` | Direct `piano -p --json --workflow fast-workflow.yml "print OK"` run used to validate the workflow. |
| `spike-config.yml`, `default-config.yml` | Composed temporary profile configuration. |

Reproduce the browser check with the Playwright driver used for the captures
(paths are environment-specific; the driver lives with the raw evidence):

```sh
URL=$(grep -o 'http://[^ ]*' <evidence>/dsh-final.log | head -1)
node <temp>/drive-full.mjs "$URL" <evidence>/run3 <temp>/workspace "Run the piano spike now."
```

## What shipping a dsh plugin would need

1. **Event vocabulary registration.** Resolve the cold-reload blocker with a
   supported API, e.g. `ctx.sessions.registerEventType([...])` or an append
   option that persists `ignorable: true`. Without it, every custom durable
   event family is live-only.
2. **Packaging and installation.** Ship the host and client halves as a normal
   package (`exports["./client"]`, `dsh.client.platform: "web"`, built
   `lib/client.js`), install it into the profile with
   `dsh plugin --profile <name> add <package>`, and add one profile row. The
   absolute-path insert used here is suitable only for a local spike.
3. **Stable client contract.** `ConversationNodeDefinition`,
   `conversation.chat.node`, and the boot bundle format are internal
   `0.1.5-rc.2` surfaces with no compatibility promise. A production plugin
   must pin and test against a supported dsh client API.
4. **Placement decision.** A custom Chat node is a process node, not an
   assistant message; it folds into the turn-process disclosure after the turn.
   Decide whether that is acceptable for Piano progress or whether the node
   must be anchored outside the process window.
5. **Host safety.** The host half spawns arbitrary child processes. Any shipped
   plugin needs explicit trust/installation UX and should inherit dsh's
   permission and sandbox policy rather than bypass it.

## Blockers and limitations

- **Primary:** cold reload of plugin-defined event types is refused by the
  session reader; the spike's mutable-Set patch is unsupported and version-bound.
- The client UI plugin shape (lazy-CJS bundle, `window.__ModuleLoader__.load`,
  `dsh.client.inject` ordering, Conversation Definition fields) is internal and
  tied to `dsh 0.1.5-rc.2`.
- Custom nodes cannot be assistant prose and cannot opt out of the turn-process
  fold.
- The node is durable only once the vocabulary issue is solved; otherwise a
  restart makes the whole session unreadable, not just the node.
- Piano's cumulative `message_update` lines need tail-clipping and throttling
  (implemented here: ~5 appends/s, 240-char tail). The final text is taken from
  `run.completed`, not from the cumulative stream.
- `piano -p --json` writes run state under `~/.piano/runs`; the spike did not
  redirect that (Piano has no single home override for the run root), so the
  direct Piano check leaves run artifacts there. dsh state stayed isolated.
