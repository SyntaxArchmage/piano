# Issue #51 (ISSUE-020) — loop context accumulation: worklog

Bug: multi-iteration loop stages share one actor session and the Pi SDK's
compaction was hard-disabled in Piano's spawn paths, so context accumulates
until the model window ceiling; the repair retry reopens the same full session
and hits the same wall (`stopReason:"length"`, empty reply) → `run.failed`.
Evidence run: `20260902T112939-fe2248` (tuning workflow, iterations=20, died at
25/104; r5 attempt 1+2 both empty).

## Goal checklist (AND)

- [x] issue target understood and bounded — three named layers verified in the
  current tree: `workflowActorKey` (workflow-runtime.ts:106-114), continuation
  passthrough (workflow-execution.ts:1533-1535), compaction disable
  (pi.ts:946 and pi.ts:1117), stale-path repair prompt
  (workflow-execution.ts:1621 ← 451-454)
- [x] design follows repository conventions — see decision ledger below
- [x] implementation and focused tests complete — B+C with red-first tests
- [x] diff reviewed — codex review gate run on both hunks; its `$&` finding
  fixed (callback form + boundary added to the C test)
- [x] validation evidence recorded — see Verification below
- [x] commit scoped to the issue — callback fix + worklog in one commit; B in
  `77d54ed`, C rewrite in `b8672bf`

## Decision ledger

Issue scope: "A / B 二选一或组合，C 必做"。Chosen: **B + C. A rejected.**

- **B — stop hard-disabling compaction** (both `SettingsManager.inMemory`
  sites drop `compaction: { enabled: false }`, i.e. follow SDK default
  `settings.compaction?.enabled ?? true`, settings-manager.js:507). The SDK
  natively bounds any session: `_checkCompaction` runs post-turn
  (agent-session.js:776) *and before the next prompt* (865, threshold
  `contextTokens > contextWindow − reserveTokens`), and overflow-recovery
  (empty/truncated reply → compact + auto-retry once) is precisely the
  incident's failure shape. One deletion bounds every session forever, so the
  goal "iterations 配多少都不会因上下文累积 run.failed" holds without touching
  actor identity. Developer challenge on 2026-09-03 drove this from A+B+C to
  B+C — smallest change that satisfies the request.
- **A — per-iteration fresh session** (loop frames in `workflowActorKey`):
  NOT done. It overturns a documented intentional design ("the same actor
  resumes across iterations", workflow-runtime.ts:102-105) and its dedicated
  test (`resumes the same logical loop actor across iterations`); B already
  bounds sessions, so the semantic change is unnecessary risk. Cross-iteration
  memory keeps flowing through both channels (session + handoff files).
- **C — repair prompt cites only the current attempt path**: required by the
  issue. `repairError` at workflow-execution.ts:1621 embeds the failed
  attempt's `expected "<.../attempts/N/result.json>"`, which contradicts the
  "## Required validation result" section naming `attempts/N+1` in the very
  next prompt. Fix at the assignment site by rewriting the stale path to the
  next attempt's, keeping the actionable reason text.
- Compaction events reach evidence: `compaction_start/end` already map in
  pi.ts:647-661 → AgentEvent → log/trace + TUI, with existing coverage
  (pi.test.ts:835+, events.test.ts:192+). Verified, no change needed.
- Residual risk accepted: across-iteration recall then depends on SDK
  compaction-summary quality; only L4 (a 20-round real tuning run) can prove it
  in practice.

## Concurrency note

`packages/orchestrator/src/workflow-execution.ts` carries another developer's
uncommitted changes (hunks at ~358/996/1231/2057). My C hunk (1621) and the new
test are in disjoint regions; at commit time only my hunks are staged (patch
surgery against HEAD copies), their work stays unstaged and untouched.
`workflow-runtime.ts` and `pi.ts` are clean.

## Verification

Red-first per developer instruction ("make this bug appear in test, then fix"):

- B red: `pi.test.ts` flipped assertion failed on `compaction.enabled ===
  false`; green after dropping the key at both `pi.ts` sites (codex verified
  against the real SDK: `SettingsManager.inMemory({retry}).getCompactionEnabled()
  === true`).
- C red: new `workflow-execution.test.ts` case failed on the stale
  `attempts/1/result.json` inside the repair prompt; green after the
  path-rewrite at the `repairError` assignment.
- Review gate (codex, read-only, on both #51 hunks): found one real defect —
  string-form `replaceAll` expands `$&`-sequences in the replacement when the
  run-directory name contains them. Reproduced red (test run dir now
  `run$&path`), fixed by the callback form, green. Confirmed sound: `resultPath!`
  is guarded by the validation branch, path-less schema messages pass through
  unchanged, no other Piano site disables compaction.
- `npm run typecheck` clean; eslint clean; `vitest run`
  `tests/workflow/workflow-execution.test.ts` 31/31; full suite on the final
  tree: 655 passed | 6 skipped | 0 failed.

Commands: `npx vitest run tests/harness/pi.test.ts
tests/workflow/workflow-execution.test.ts`; `npx vitest run`;
`npm run typecheck`; `npx eslint packages tests`.

## Outstanding

- Issue acceptance "L4": 20-round real tuning rerun to terminal state
  (needs the GPU test machine; run `piano run` against a tuning workflow with
  `iterations: 20` and confirm completion or earlyStop, never `run.failed`).
- A (loop frames in the actor key) deliberately NOT implemented — B bounds the
  session; A would overturn a documented design and its test. Revisit only if
  L4 shows compaction summaries losing what the loop needs.
- Flaky note: one full-suite test failed on a first `vitest run` (name lost
  before capture, likely a real-e2e timing flake); the two following full runs
  and all focused runs were green.
