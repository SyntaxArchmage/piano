# Steering Messages () — Feature PRD

- Status: **Implemented for pi and claude (2026-09-09)** — the generic
  `SteeringChannel` contract (`packages/harness/src/steering.ts`) plus two
  dedicated implementations: pi SDK (`PiSession.steer` bound when the
  installed SDK exposes it) and claude streaming-input (`--input-format
  stream-json`; a frame written mid-turn reaches the model at the next tool
  boundary, verified against the real CLI). Gaps 3–5 of this doc remain by
  design: execution is still one-shot per worker, and the TUI routes
  running-input through the channel, falling back to the queue when no
  session is bound. dsh/pi-cli never bind (deferred: dsh host-mode
  `Agent.steer` RPC); their dedicated implementations attach to the same
  interface without touching callers.
- Scope baseline: `f36a321` (`feat: cache and retry SDK loading`)
- Related: [[review-migration-39709bd2]] (issues #2, P2 #2)

## Summary

Let the user type into the piano input cell **while an agent is already running** and
have that message delivered to the running agent of the current stage — rather than
the current behavior, where a second `Enter` is silently discarded while `promptRunning`
is true.

The feasibility answer is: **the pi SDK already provides the entry point**; the gap is
entirely in piano's own harness/orchestrator/TUI layers.

## Investigated source

Global SDK install pinned by the harness:

- Version: `@earendil-works/pi-coding-agent@0.84.2`
- File: `dist/core/agent-session.js`

## What the SDK already provides

`AgentSession` (the object `createAgentSession` returns) exposes a full runtime
message-injection surface:

| API | Location | Semantics |
|---|---|---|
| `async steer(text, images?)` | `agent-session.js:986` | Queue a message; delivered **after the current assistant turn finishes its tool calls, before the next LLM call**. Expands skill commands + prompt templates; rejects `/extension` commands. |
| `async followUp(text, images?)` | `agent-session.js:1003` | Queue a message; delivered **only after the agent is fully idle** (no more tool calls or steering messages). Same expansion/command rules. |
| `get isStreaming` | `agent-session.js:588` | `this._isAgentRunActive` — whether an agent run is currently processing. |
| `prompt(text, { streamingBehavior })` | `agent-session.js:792` | When `isStreaming`, `prompt()` auto-redirects into `steer()`/`followUp()` based on `options.streamingBehavior`. Without the option while streaming it **throws** `"Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message."` |

Both `steer` and `followUp` bottom out in `this.agent.steer({ role: "user", content, timestamp })`
/ `this.agent.followUp(...)` (lines 1016–1044). In other words, a **steer is simply a
user-role message injected mid-run**; the two flavors differ only in *when* the agent
ingests it:

- **steer** = "interrupt and redirect the current turn" (before the next LLM call).
- **followUp** = "start the next turn after this one settles."

`queue_update { steering, followUp }` events are emitted on every enqueue (lines 303–307,
341–351, 1017/1034), so the harness already surfaces these as the read-only
`AgentEvent` `queue_update` shape (see `events.ts:QueueUpdate`).

## Why piano cannot use this today

The SDK is capable, but `harness` narrows the session to a single-shot prompt and
never exposes injection. Four compounding gaps:

### Gap 1 — harness narrows the session interface

`PiSdkSession` (`packages/harness/src/pi-sdk.ts:67`) exposes only:

```ts
interface PiSdkSession {
  subscribe(listener): () => void;
  prompt(text: string): Promise<void>;   // no streamingBehavior, no steer/followUp/isStreaming
  abort(): Promise<void>;
  dispose(): void;
}
```

`steer` / `followUp` / `isStreaming` are structurally invisible to the caller.

### Gap 2 — `prompt()` is called without `streamingBehavior`

`sendPrompt` (`pi-sdk.ts:574`) calls `session.prompt(request.prompt)` with no options.
If the caller reused the session while streaming, the SDK would throw instead of queueing.

### Gap 3 — single-shot execution model (`dispose` after one turn)

`executeAgent` runs one prompt and disposes the session on completion (the `ensuring`
finalizer). There is no notion of a reusable session handle that survives across user
turns.

### Gap 4 — no handle-return path across layers

`executeWorkflow → worker → harness` currently threads only an `AbortSignal` (for
cancellation). There is no channel to carry a "steer this running stage's session"
request back, nor to expose the live session handle upward.

### Gap 5 — TUI drops running-state input

`submitPrompt` (`packages/cli/src/tui.ts:160`) starts with:

```ts
if (promptRunning || deps.runPrompt === undefined) return;
```

A second `Enter` while running is silently ignored — this is the exact behavior this
feature would replace (and is flagged separately as review P2 #2).

## Product decision points (to resolve before implementation)

1. **steer vs followUp — which is the default user action?**
   - steer maps naturally to "the user is watching and wants to redirect."
   - followUp maps to "queue the next task."
   - Recommendation: expose both; default `Edit`/`Enter` to **steer** for a running turn.

2. **Session handle lifetime.** `executeAgent` must change from single-shot to return
   `{ result, steer?, followUp?, isStreaming? }` (or similar), deferring `dispose()` to
   an explicit close rather than the end of a turn.

3. **Routing to "the current stage".** Today `activePrompt` is one fiber wrapping the
   whole `workflow → worker → harness` chain. Steering must target the *specific agent
   session of the running stage*, which requires the worker/orchestrator to expose the
   live session handle (by sessionId) and a `steer(sessionId, text)` entry point.

4. **`streamingBehavior` propagation.** Forward the mode through `PiSdkRequest` /
   the injected method so `prompt()` (or a dedicated `steer()` call) never hits the
   SDK's missing-option throw.

## Rough implementation plan (deferred — outline only)

1. **harness**: widen `PiSdkSession` to mirror `steer(text, images?)`,
   `followUp(text, images?)`, `get isStreaming`; return a reusable handle from
   `executeAgent` and move `dispose()` to an explicit close/abort path.
2. **orchestrator / worker**: add a `steer(sessionId, text)` route that resolves
   the active session handle and forwards the message; thread it alongside `signal`.
3. **cli TUI**: replace the `promptRunning` drop with a branch that routes the
   input to the active session's `steer()`/`followUp()` based on the chosen default.
4. **Tests**: extend the harness test to assert `steer()`/`followUp()` are invoked with
   the user text; add a TUI test that a second input reaches the runner as a steer
   rather than being discarded.

## Non-goals / out of scope

- Autonomous multi-agent routing (steering a *non-current* stage).
- Persisted steering across restarts (beyond the SDK's own queue).
- Changing the single-node workflow execution model beyond exposing the live session.

## Verification

- `npm run typecheck`, `npm test` (full suite), and the real PTY TUI tests
  through `node-pty` and `@xterm/headless` must pass.
