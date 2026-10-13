---
name: speedup-me
description: "Run a measured wall-clock speedup campaign; staged in SPEEDUP.md."
---

# Speedup Me

Three phases, one file, one decision at a time.

- **Phase 1 — identify.** Measure a baseline run, decompose it into time buckets, write ranked proposals to `SPEEDUP.md`.
- **Phase 2 — discuss.** Settle every item before any edit. Behavior-changing levers need requirement-level decisions, not just 做/不做.
- **Phase 3 — implement.** Work the approved items one at a time, measuring before and after each, until done.

**Amdahl first: no proposal without a named bucket and its share.** Name the bucket from the taxonomy below and the fraction of the pinned baseline run it holds — measured, or an estimate labeled `[估算]` with its assumption written out. A proposal whose share is unknown is not ready.

Unlike `refactor-me`, this work may change behavior: parallel structure, execution order, failure semantics, YAML semantics (backward compatible only), recipe topology, or new permanent benches. That is allowed — but every behavior change is an explicit requirement decision in phase 2, never a silent side effect of an optimization. LLM inference time is a first-class cost: every item states whether it changes model-turn count, and repair/retry turns count as LLM inference, not overhead.

Write everything the developer reads — the map, each proposal card, the questions, `SPEEDUP.md` — in Chinese. This file is English to match the repository's skill convention.

## 时间桶（先归桶，再动手）

Buckets are exhaustive and disjoint; attribute an overlap to the earlier bucket.

| 桶 | 是什么 | 从哪里量 |
| --- | --- | --- |
| LLM 推理 | 模型调用本身、repair/sign-off/consolidation 重试轮、policy retry | `trace.jsonl` `sendPrompt` span `duration_ms`；`log.jsonl` `agent.turn.started`→`completed`；`trajectories/duration.jsonl` |
| harness 进程开销 | 非 pi harness 每轮 spawn、会话续跑、流解析、退出 | 同轮 turn 总时长 − 该轮 LLM span（两份工件相减） |
| 编排簿记 | 快照与原子写、zod 校验、git 事务与轮提交、handoff/resume 写 | `trace.jsonl` 对应 fn span；`progress.json` `invocationTime[*].completedMs` |
| 串行化与排队等待 | 同 scope 单节点执行、loop 串行、槽位准备串行、信号量排队 | 相邻 `stage.started` 间隔；parent span − Σ 子 span |
| 外部等待 | backoff 睡眠、GPU/网络/人的输入 | `log.jsonl` retry 事件的 delay；无 span 覆盖的存活 gap |

- The baseline is a run artifact, not a feeling. Pin a concrete `~/.piano/runs/<id>` (disk map: `docs/deep-dive-notes/workflow-run-artifacts.md`) and its shape — recipe · harness · model · machine. Every before/after pair uses the same shape; a mismatched pair is not evidence.
- **The perf eval suite is the before/after instrument.** `piano evals --group workflow-perf` runs five topologies (serial chain, fan-out, loop, handoff chain, DAG) and emits `runtime_overhead_ms` per case — wall clock minus LLM inference. Use it for every measurement; do not reinvent the harness. To decompose a single run by bucket: `node scripts/evals/runtime-metric.mjs <runsRoot>`.
- Rollups are cheap: `jq` over `log.jsonl`/`trace.jsonl`, or a scratch tsx script (precedent: `packages/evals/src/driver.ts` reconstructs stage timings from `log.jsonl`). Temporary instrumentation and scratch rollups are allowed; commit them only if they earn a permanent home.
- `[估算]` is allowed where measurement is infeasible: write the assumption and the arithmetic 占比 × (1 − 1/因子), and badge the item. An estimate that could have been measured is a method failure.

## The file

### `SPEEDUP.md` (repo root)

Session state and the phase-3 ledger. Untracked under the root-markdown ignore rule; never commit it. A complete file:

```markdown
# SPEEDUP

范围: packages/orchestrator 调度与簿记路径
阶段: 一 · 识别进行中
基线: working tree clean @ d4f83a4 · run 2026-10-11T08-20-13-a1b2c3 · 墙钟 4021s
时间桶: LLM 推理 71% · harness 进程 9% · 编排簿记 4% · 串行等待 6% · 外部等待 10%（合计 100%）
候选 6 · 提案 3 · 已排除 3

## 提案

### P1 · tournament 槽位准备并行扇出
- 瓶颈: 串行化与排队等待 — 父快照 + N×（allocateMapWorkspace + 槽基线快照）串行，占基线 3.8%（实测: trace.jsonl workspace 段合计 154s / 4021s）
- 手法: 并行化 — `workflow-execution.ts` 槽位准备 for 循环改 `Effect.all`；git worktree add / cp 是纯 I/O
- 预期收益: 154s → ≈ max(单槽 40s)，省 ≈114s = 2.8% 墙钟 [实测]
- 行为变化面: workspace 准备事件顺序不再等于槽序；逐槽失败收集沿用现有 failTournament 保留逻辑
- 质量风险: 无 — 不触碰模型轮次与提示词
- 验证方法: 同 run 形状前后各一跑；比 trace.jsonl 准备段合计与总墙钟；槽位产物 diff 为空
- 步骤: 1) 循环体抽为 per-slot Effect 2) Effect.all + either 收集 3) 全量 gate
- 回退: 单 commit revert，无数据格式残留
- 状态: 待议
- 裁决: —
- 理由: —
- 改动: —
- 检查: —

## 已排除（审计）

- 同 scope `ready[0]` 串行调度 — 依据: 意图性设计（fail-fast + 单一可变 workspace），先议语义再动，留下轮
```

Rules:

- Every proposal carries every slot; delete a slot only when it truly has no content. `预期收益` carries `[实测]` or `[估算]` — no badge, not a proposal.
- `状态` values: `待议 → 已准 → 进行 → 已据`, plus `否决`, `暂缓`, `拆出`, `已回退`. `已据` and `已回退` both require `改动` and `检查`; `已回退` records the null measurement so the next campaign does not re-propose it.
- `## 已排除（审计）` is the checksum: 排除 + 提案 = 候选数. Measured-null results live there too — they are deliverables, not noise.

## Phase 1 — identify

1. Resume first: if `SPEEDUP.md` exists with `待议`/`进行` items, continue from it instead of re-surveying.
2. **Fix the scope** as concrete paths plus the run shape. If the developer named a symptom ("stage X takes forever", "the tournament run stalls"), localize it into buckets before proposing. Read `CLAUDE.md`/`AGENTS.md`, `ARCHITECTURE.txt`, and `TASTE.md` when it exists.
3. **Check `git status` first.** A file with uncommitted user changes is out of scope unless the developer explicitly includes it. Never stash, reset, or clean.
4. **Establish the baseline before any proposal.** Run `piano evals --group workflow-perf` and record the five `runtime_overhead_ms` values. Compute per-bucket sums for the pinned run and attribute the top buckets to `path:line` from reads you actually performed. No run artifact for the shape → run the recipe once, or proceed `[估算]`-only and say so in the map.
5. **Ask what the developer already did by hand.** Agents backgrounding slow actions with detached scripts is the strongest evidence a programmatic lever exists. Record it as a candidate with the manual saving as its first estimate.
6. **Classify every candidate's change class:** 纯内部 / 顺序或失败语义变化 / 崩溃丢失面变化 / YAML 语义扩展 / recipes 拓扑变化 / 质量换速度. The class decides what phase 2 must settle.
7. **What qualifies:** a share of a few percent of the pinned wall clock, or a fixed step cost dominated by a constant (backoff policy, per-turn spawn), or a lever that unblocks a larger share. **What does not:** micro-optimizations off the measured path, speculative concurrency for code not serialized in practice, anything defended only by "should be faster".
8. **Rank** by 占比 × 可达因子 ÷ 风险; levers that unblock other levers first; same-file items adjacent; expensive-to-verify items early and cheap to revert.
9. **Write `SPEEDUP.md`, then print the map** in Chinese: 范围, 基线, the bucket table summing to ≈100%, counts (提案 N · 已排除 M), one line per proposal（位置 · 桶+占比 · 手法 · change class）, and one line: 如果整体方向就不对，直接说，我把它记成一项，不逐项走。
10. Beyond ~8 candidates, propose rounds by area. Do not present a wall.

## Phase 2 — discuss, item by item

1. One proposal card per item, restated as prose, then exactly one question: 做 / 不做 / 改范围 / 先测再做, plus free text. Put the options in the question text itself.
2. Paste the returned string into `裁决` verbatim, verdict and `理由` beside it. Accept `停` (write state, end), `先放着` (`暂缓`), `展开` (deeper evidence, re-ask), `拆出 P1a/P1b`.
3. **Behavior-change classes are settled as requirements**, question by question; one card may need a short series, each answer recorded in `理由`:
   - **顺序保证** — which completion order may independent nodes/slots/`log.jsonl` events have? Today it is stable serial order per scope. If order stops being guaranteed, say what the TUI and evals may now see out of order.
   - **fail-fast** — today one blocked result can stop the scope before later independent nodes burn model turns. Parallelizing removes that; the replacement policy（停 / 继续 / 继续但拦截后取消）is a requirement, with its cost in wasted turns and tokens.
   - **崩溃丢失面** — for anything backgrounded or deferred, name what a crash at the worst interleaving loses. `progress.json` snapshot: lossy is fine (a monitor projection; the accepted evidence lives in `progress.jsonl`). `progress.jsonl` / resume state / handoff records: not OK by default.
   - **资源争用** — GPU, provider rate limits, token cost. State the contention ceiling and how overlap will be detected. Parallel gains end at contention; the verification compares total wall clock, not per-lane time.
   - **质量换速度** — fewer repair turns, changed prompts/model/thinkingLevel/sign-off policy need explicit approval, the quality risk stated, and a validation method (an evals group or a named manual check).
   - **YAML/拓扑** — backward compatibility is a hard requirement: new keys default to current behavior, and every recipe under `recipes/workflows/` / `recipes/eval-workflows/` plus the `evals/` consumers must parse unchanged. A topology change states what an evals comparison must show before it counts as done.
4. A batch answer like 都做 is valid only after it is echoed back as the exact numbered list and confirmed once.
5. A general design position surfaces → fold it into `TASTE.md` with 出处 (`出处: 2026-10-13 P1`) and cite it in later items.

## 背景化（backgrounding）规则

The runtime has no fire-and-forget work today, so backgrounding is a capability with named semantics — a card class of its own, not an optimization detail. Every backgrounding card states, in this order: 目标工件 · 关键路径减掉什么 · 崩溃最坏丢失什么 · 排序影响 · 汇合点 · 取消/背压.

- **Safe to background:** `progress.json` snapshots — atomic temp+rename, naturally coalescing, the truth lives in the accepted ledger.
- **Not backgroundable without an explicit 崩溃丢失面 decision:** `progress.jsonl` appends, resume state, handoff records, contract snapshots, `result.json` validation, git transactions and round commits, workspace markers, tournament snapshots.
- **Join rule:** any backgrounded write a consumer could read must be joined before the write that makes it observable. One join at scope exit, one drain at run end. A fiber that can outlive its scope with no join must document the drop explicitly.
- **Backpressure rule:** bounded or coalescing. A snapshot coalesces; a file copy does not — never background unbounded I/O.
- **Programmatic shapes for the developer's manual trick**, prefer the later when it suffices: 1) runtime-internal fork for bookkeeping/projections; 2) a YAML stage-level background capability — a slow job started detached, a later poll/join stage consumes its exit artifact (new key, default off; decide exit-status capture, orphan cleanup, progress visibility); 3) **recipe topology pipeline** — the slow job as the first node, independent work nodes in between, a `from:`-linked join node. Shape 3 needs zero runtime change; propose it before shape 2.

## Phase 3 — implement

1. Work items in `SPEEDUP.md` order; finish a `进行` item before the next. Re-verify every anchor against the current tree first; a broken anchor returns the item to `待议`.
2. Larger levers are allowed and expected: 并行化 · 流水线 · 背景化 · 批量化 · 进程复用 · 缓存 · 减少轮次 · YAML 语义扩展（向后兼容）· recipes 拓扑重构 · 永久基准. One lever per step; the only difference between the before and after measurement is the item itself.
3. **Measure after every item** — run `piano evals --group workflow-perf` and compare `runtime_overhead_ms` against the baseline. Same run shape, same machine. Numbers do not move beyond noise → `已回退`: revert the change and record the null measurement in the card. A null result is a deliverable, not a failure.
4. Gate before any commit-capable unit: `npm run typecheck && npm test`, plus `npm run lint` unless the developer narrowed it. Focused runs: `npx vitest run tests/<path>`, `npm run test:workflow|test:packages|test:cli`. The `real-*.e2e.test.ts` and `PIANO_TUI_E2E` suites are not the per-step check — name the check actually used in `检查`.
5. A red step is never carried forward: return to the last green state, fix or re-propose, rerun the same check. Never destructive git; never reset user work. One coherent commit per item; commit messages carry no AI attribution (the hook rejects it); never push unless asked; never commit `SPEEDUP.md`.
6. Two hats: a bug or contract fix found while speeding becomes a new `待议` proposal; only approval moves it into scope. An item that grows bigger than proposed → stop, rewrite with the new evidence, fresh decision.
7. An item touching `workflow.ts` schema, recipes YAML, or evals must update the schema tests and parse every workflow fixture; evals fixtures are part of the check.
8. After each commit update the card: 状态 · `改动: path:line +N −M` · `检查: <command> — 通过` · measured before/after.

### Permanent benches（若建）

- Location `tests/perf/` or `scripts/perf/` — never "benchmark" unqualified: in this repo that word means GPU kernel benchmarks.
- Deterministic: no real LLM, provider, or network. Drive the runtime through the scripted test seams (`tests/common/fake-runner.ts`, `tests/common/fake-pi-sdk.ts`) or a canned subprocess; measure bookkeeping, scheduling, and parallelism — not model latency.
- Report-only, or wide-bound assertions. A flaky perf test is worse than none; if it must gate, gate an integer invariant (span count, ordering, observed concurrency), never milliseconds.
- Build one only when an item's verification needs repeated runs, and the card names the future regression it will catch.

## Stop conditions

- No baseline obtainable and the developer declines to produce one → `[估算]`-only campaign, stated in the map; no item may claim `[实测]`.
- Contention eats the gain (per-lane durations rise when overlapped) or the total delta ≤ noise → revert and record the contention ceiling in the card.
- Numbers do not move after implementation → `已回退`. Never keep a change that only "should" help.
- Before/after run shapes differ (model, provider, recipe, machine changed mid-campaign) → the pair is invalid; re-measure before deciding anything.
- A "bench" that needs a real LLM/GPU/provider is an eval, not a bench — move it to the evals apparatus or drop it.
- A YAML extension breaks parsing of any recipe or eval fixture → stop; backward compatibility is not negotiable.
- A speedup needs a quality trade or a behavior change the developer will not approve → `否决`/`暂缓`, reported honestly. Parallelizing failure semantics with an undecided replacement policy is not implementable — back to phase 2.
- Target files carry uncommitted user changes → exclude the files, propose narrowing or 暂缓. Never touch user work.

## Closing

When every `已准`/`进行` item is `已据` or `已回退`:

1. Run the full gate once more (`npm run typecheck && npm test`, plus lint).
2. Review the complete diff as a reviewer — regressions, error paths, contracts, persistence, unrelated changes — and report in Chinese.
3. Report `待议`/`否决`/`暂缓`/`已回退` honestly; null results are part of the outcome.
4. Clear `SPEEDUP.md`: keep the title, one line stating the queue is empty, the commit list, and the measured net wall-clock delta when one exists. Never commit or push it.

Candidates discovered during implementation are reported as `待议` in the closing message. The campaign ends; it does not start them.
