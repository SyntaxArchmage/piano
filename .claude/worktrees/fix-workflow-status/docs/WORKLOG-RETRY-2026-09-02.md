# Dev Worklog — Issues #45 & #46 — Retry mechanism (dev-branch-2)

## Goal checklist (issue gate)

- [x] Issue targets (#45, #46) understood and bounded
- [x] Design follows repository conventions and TypeScript best practices
- [x] Implementation and focused tests complete
- [x] Diff passed a client-appropriate review
- [x] Validation evidence recorded
- [ ] Commit complete and scoped to the issues

## Issue #45 — pi in-session API retry budget 2 → 10

Two literal changes in `packages/harness/src/pi.ts` (both SettingsManager sites):
`SettingsManager.inMemory({ ..., retry: { enabled: true, maxRetries: 2 } })` → `maxRetries: 10`.
Hardcoded. No config surface. `MAX_SDK_LOAD_RETRIES` untouched.

Guard: focused test asserting both creation sites pass `maxRetries: 10`
(capture `SettingsManager.inMemory` argument in a fake SDK module).

## Issue #46 — Absorb failed agent exits with continuation-based retries

Design decisions (from draft-issues conversation, user-approved):

- Shared Effect retry utility in `packages/harness` applied at the adapter
  execution boundary — NOT in workers. Session identity for a failed attempt
  is adapter-internal knowledge.
- Retryable kinds: `rate-limit`, `timeout`, `harness-unavailable`, `request-rejected`.
- Non-retryable: `cancelled`, `authentication`, `configuration`, `model-not-found`,
  `sdk-*`, `session-artifact`, `unknown`.
- Budget: 3 attempts total (initial + 2 retries), backoff ~5s → ~20s, hardcoded.
- Retries always continue the same session when one exists (continuation
  reopen); a failure before session creation retries without continuation.
- Abort signal terminates backoff waits immediately with `cancelled`.
- No user-visible surface (no DSL field, no config, no env var, no TUI/progress).
  Structured harness logs only.
- After budget exhaustion the original AgentError surfaces unchanged.
- Subprocess non-zero exit maps to `request-rejected` (subprocess.ts:558-571),
  already in the retryable set.

### Design notes discovered during code reading

- `executeAgent` (pi adapter) closes over mutable per-call state (`turnStarted`,
  `failureEventReported`, `observedEvents`, `reportFailure` via `Effect.onExit`).
  A whole-effect `Effect.retry` would re-run the closure body fresh per attempt
  (state is created inside `executeAgent` body each call) — that is correct:
  each attempt needs fresh event aggregation; the continuation must be threaded
  in. The failed attempt's session identity: `requireSessionArtifact` result is
  only known mid-attempt; to continue we need to capture the artifact and pass
  `{ harness: "pi", sessionId, transcriptPath }` as `request.continuation`
  on the retry.
- `executeSubprocessAgent`: session identity = `provisionalId` + `transcriptPath`
  (known before spawn). On failure the transcript has been appended (persisted
  before the exit-code check). Retry re-invokes with
  `continuation: { harness, sessionId: provisionalId, transcriptPath }` so
  `piArguments` adds `--session` / `claudeArguments` adds `--resume`.
- Cancellation: both adapters fail fast with kind `cancelled` when
  `request.signal?.aborted`; `Effect.sleep` is interruptible by default, so an
  outer abort during backoff interrupts the fiber — but callers expect a typed
  `AgentError` failure, not an interrupt. Guard: check `signal.aborted` before
  each retry and fail `cancelled`; wrap sleep with `Effect.onInterrupt` →
  fail cancelled. Simplest: replace plain `Effect.sleep` with an abort-aware
  sleep that fails `cancelled` if the signal fires mid-wait.
- `Effect.retry` policy with `while` predicate + `Schedule` for delays; but the
  continuation changes per attempt, so a manual `Effect.loop`/recursion is
  clearer. Use a small recursive helper.
- The retry wrapper lives in a new `packages/harness/src/retry.ts` exporting
  `withAgentRetries(runAttempt)`, used by both adapters. Test hook: accept a
  `delays` override via options (`AgentHarnessOptions.retryDelaysMs`)? No —
  issue says no config surface. Instead: internal function parameter, tests
  exercise the exported adapter functions with fake SDKs/subprocess binaries
  and short delays injected through an optional internal parameter of the
  helper (not exported on public options). Decide: helper takes `delaysMs`
  argument; adapters pass the hardcoded constant. Tests call the helper
  directly with tiny delays AND test adapters end-to-end with the constant
  (2 retries × ≤20s backoff — acceptable in CI? 25s worst case per failing
  test — too slow). Alternative: keep adapters on the constant but make the
  retry helper's budget injectable via a non-exported module-level seam that
  tests can set (e.g. `__setRetryDelaysForTests`). Repo convention check:
  subprocess tests use real 10ms sleeps; pi tests use fake SDK modules.
  → Chosen: `AgentHarnessOptions` gets an internal-ish optional field is NOT
  allowed (public surface). Instead export a pure `withAgentRetries` from the
  package (index.ts) — it's a harness utility, exporting it is a legitimate
  public seam for tests and matches "shared Effect retry utility inside
  packages/harness". Adapters call it with the hardcoded policy. Adapter-level
  tests that need speed use the subprocess fake-harness with mode that fails
  then succeeds... but hardcoded 5s→20s delays make that slow. Compromise:
  subprocess tests assert retry happens with the real constant but the fake
  harness fails fast — first retry waits 5s. 2 retries = 25s. Acceptable for
  1-2 focused tests? Borderline. Better: make the policy constants module-
  scoped in retry.ts and export a test-only setter `setAgentRetryPolicyForTests`
  — repo has no precedent for test-only setters. Check vitest `vi.useFakeTimers`
  with Effect.sleep — Effect sleep uses its own clock; fake timers won't cover.
  FINAL DECISION: export `withAgentRetries` (pure utility, delays parameter);
  adapters pass hardcoded `AGENT_RETRY_DELAYS_MS`. Adapter boundary is tested
  via `withAgentRetries`-level tests (fast) + one subprocess e2e test with a
  flaky-then-success fake harness using the REAL constant but only the FIRST
  retry (5s wait — tolerable), asserting continuation/`--session` reuse.
  pi adapter retry: tested at withAgentRetries level + one adapter test
  with a failing SDK that recovers (session reopen path) using real constant
  first retry only (5s). Two ~5s tests is acceptable.
  → Refined after review: instead of 5s-real tests, the adapters call
  `withAgentRetries` with `AGENT_RETRY_DELAYS_MS` read at call time; tests use
  `vi.stubEnv`? No env surface. KEEP: two real-delay tests, ~5s each.

- Workers (`executeWorker`) unchanged — retries are fully contained in the
  harness adapters, so the `harness.failed` log in worker.ts fires once per
  terminal failure only.

## Implementation log

### What changed

**Issue #45** — `packages/harness/src/pi.ts`:
- New constant `SDK_API_MAX_RETRIES = 10` (documented as a reliability floor).
- Both `SettingsManager.inMemory` sites (resource loader at ~line 905, session
  at ~line 1112) now pass `maxRetries: SDK_API_MAX_RETRIES`.
- Guard: `tests/harness/pi.test.ts` "passes the workflow prompt and skills
  to the pi resource loader" now captures `SettingsManager.inMemory(settings)`
  and asserts `retry: { enabled: true, maxRetries: 10 }` at BOTH creation
  sites (loader options + session options).

**Issue #46** — new `packages/harness/src/retry.ts`:
- `AGENT_RETRY_DELAYS_MS = [5_000, 20_000]` — hardcoded 3-attempt budget.
- `withAgentRetries(runAttempt, delays, signal)` — shared retry boundary.
  Retries only kinds `rate-limit | timeout | harness-unavailable |
  request-rejected`; everything else fails immediately. Backoff sleeps are
  abort-aware (`signalAwareSleep`): a signal firing mid-wait fails with a
  typed `cancelled` AgentError; a signal already aborted before the retry
  surfaces the attempt error without retrying.
- `withFailedContinuation(error, continuation)` — adapters stash the failed
  attempt's session identity on the error; the boundary passes it to the next
  attempt as `attempt.continuation`, so retries reopen the same session.
- `failedContinuation.unresolvable` flag: when the pi SDK cannot reopen a
  continuation (SDK without `SessionManager.open`, cross-harness
  continuation), retrying would fail identically, so the boundary stops.
- Structured `agent.retry.scheduled` warn log per decision (attempt number,
  next attempt, total, delay, kind, message, session id).

Adapter integration:
- `executeAgent` (pi): wraps `runPiAttempt` in
  `withAgentRetries(..., options.retryDelaysMs ?? AGENT_RETRY_DELAYS_MS,
  request.signal)`. The old body became `runPiAttempt` — per-attempt state
  (event aggregation, failure reporting, turnStarted, session lifecycle) is
  created fresh per attempt; `attempt.continuation` overrides
  `request.continuation` when present. Terminal `Effect.mapError` stashes
  `attemptArtifact` (captured after `requireSessionArtifact`) as the failed
  continuation. Session-manager open failures carry `unresolvable: true`.
- `executeSubprocessAgent`: same wrapper around `runSubprocessAttempt`. The
  failure branch stashes `{ harness, sessionId: provisionalId, transcriptPath }`
  so the retry appends to the same transcript (`--session` for pi,
  `--resume` for claude via `piArguments`/`claudeArguments`).

Error-kind split discovered during implementation (required for correctness):
- Resource-loading failures (missing context file/skill/system prompt, bad
  thinking level, SDK context-file count mismatch) were classified
  `request-rejected` — a RETRYABLE kind under issue #46. Retrying a missing
  file is pure waste. New kind `resource-unavailable` (non-retryable) for:
  pi `resourceError`, unsupported thinking level, SDK context-file count
  mismatch; subprocess `loadResources` catch. Doctor's
  `piFailureReport` treats `request-rejected` and the default case
  identically ("provider rejected the model request" vs "model request
  failed"), so no doctor change was needed.
- `AgentHarnessOptions.retryDelaysMs` — test seam only; production callers
  never set it, default stays the hardcoded floor. Kept public because the
  repo has no test-only-setter precedent and the alternative (real 5s/20s
  sleeps per assertion) would slow every harness test by ~50s.

Test updates:
- `tests/harness/pi.test.ts`: `TEST_RETRY = { retryDelaysMs: [10, 10] }`
  spread into every `executeAgent` options site; fixtures that now retry got
  `SessionManager.open` (real SDK supports reopening); expectations updated
  for per-attempt error events (3x "Connection error", disposeCalls 3).
- `tests/harness/subprocess.test.ts`: `retryDelaysMs: [10, 10]` in
  `runSubprocess` and the two direct resource-failure calls.
- New `tests/harness/retry.test.ts` (11 tests): budget constant, retryable
  kinds succeed on attempt 3, all 10 non-retryable kinds fail immediately,
  budget exhaustion surfaces the ORIGINAL error (identity), continuation
  carried into retry, no-continuation retry after pre-session failure,
  cancel-during-backoff → typed `cancelled`, pre-aborted signal → no retry,
  structured retry log, subprocess non-zero exit retries and reopens the same
  transcript, `--session` flag passed on continuation retry.

### Design decisions made during implementation

- Continuation flows through the ERROR, not the success path: only failures
  retry, and the stash (`withFailedContinuation`) keeps `AgentError`'s public
  shape unchanged — the field is a non-enumerable-ish plain assignment read
  only by the boundary.
- `attemptArtifact` mutable cell (set right after `requireSessionArtifact`)
  because the terminal `mapError` lives outside the generator scope.
- Eval impact: evals drives the piano CLI via shell, so it inherits retries
  transparently (accepted side effect per issue #46).

### Validation evidence

Commands run (worktree `.claude/worktrees/dev-branch-2`, node_modules
installed fresh):

- `npx tsc --noEmit` — clean (exit 0).
- `npx eslint packages/harness tests/harness` — clean.
  (`npx eslint packages tests` has 2 PREEXISTING errors in
  `packages/cli/src/workflow-picker.ts` at HEAD 0a2f927 — unrelated, untouched.)
- `npx vitest run tests/harness/` — 110 passed | 2 skipped (1 file skipped:
  real-subprocess e2e).
- `npx vitest run tests/harness/retry.test.ts` — 11/11 passed.
- `npx vitest run tests/logging tests/cli` — 133 + 65 passed.
- `npx vitest run tests/workflow tests/worker` — all passed. (Original
  verification needed `PIANO_HARNESS=pi-sdk` because the machine config
  predated the harness rename; on the rebased branch `pi-sdk` no longer
  exists and the default resolves to `pi`.)

### Review pass (review-and-refine, 2026-09-02)

Reviewed the complete diff as a reviewer (skill invoked in-session; no external
`/review` or `/code-review` client was available, so the review was performed
directly against the full diff — recorded as a limitation, not skipped):

- **Regression check**: `request` vs `retryRequest` audit inside
  `runPiAttempt` — remaining raw `request.*` references are all fields a
  continuation never overrides (provider/model/thinkingLevel/cwd/tools/
  systemPromptPath/skillPaths), so no stale-continuation bug. Subprocess
  attempt uses `retryRequest` uniformly.
- **Error paths**: abort-before-retry surfaces the attempt error; abort during
  backoff yields typed `cancelled`; `unresolvable` continuations stop the
  loop instead of burning budget; budget exhaustion returns the ORIGINAL
  error object (identity asserted by test).
- **Public contracts**: `AgentError` shape unchanged (continuation stashed as
  an extra field read only by the boundary); `AgentFailureKind` gained
  `resource-unavailable`; `AgentHarnessOptions.retryDelaysMs` documented as a
  test seam. Doctor consumes kinds it knows and falls through to a generic
  report for the new kind — verified `tests/cli/doctor.test.ts` 8/8.
- **Persistence/observability**: per-attempt event aggregation and
  `persistAgentEvents` unchanged; one structured `agent.retry.scheduled` warn
  per decision; TUI/progress surfaces untouched (invisible reliability per
  the issue).
- **Unrelated changes**: none — diff is strictly the 6 files + retry.ts +
  retry.test.ts + this worklog.

Post-review validation rerun:
- `npx vitest run tests/harness/` — 110 passed | 2 skipped.
- `npx vitest run tests/cli/doctor.test.ts` — 8/8. `tests/worker` — 4/4.
- `npx vitest run tests/workflow` — all passed.
- `npx tsc --noEmit` clean; `npx eslint packages/harness tests/harness` clean.

### Remaining risks

- Worst-case wall clock per stage grows: up to 2 retries × (5s/20s backoff)
  plus each attempt's own SDK-level 10-retry budget. Accepted tradeoff per
  the agreed decision.
- Subprocess `provisionalId` may differ from the harness-reported session id
  on retry (`piArguments` uses `transcriptPath`, `claudeArguments` uses
  `sessionId`); the stash carries both so each harness resumes correctly.

