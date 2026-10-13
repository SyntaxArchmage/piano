---
name: speedup-me
description: "Run a measured wall-clock speedup campaign; staged in SPEEDUP.md."
---

# Speedup Me

One file, three phases, one decision at a time. Phase 1 measures a baseline run, decomposes it into time buckets, and writes ranked proposals to `SPEEDUP.md`; phase 2 settles every item before any edit, at requirement level when the lever changes behavior; phase 3 works the approved items one at a time, measuring before and after each.

Amdahl first: no proposal without a named bucket and its share. Name the bucket from the taxonomy below and the fraction of the pinned baseline run it holds — measured, or an estimate labeled `[估算]` with its assumption written out. A proposal whose share is unknown is not ready.

Unlike `refactor-me`, this work may change behavior: parallel structure, execution order, failure semantics, YAML semantics (backward compatible only), recipe topology, or new permanent benches. That is allowed, but every behavior change is an explicit requirement decision in phase 2, never a silent side effect of an optimization. LLM inference time is a first-class cost: every item states whether it changes the model-turn count, and repair and retry turns count as LLM inference, not as overhead.

Write everything the developer reads — the map, each proposal card, the questions, `SPEEDUP.md` — in Chinese. This file is English to match the repository's skill convention.

Everything you write for him reads the way you would talk to him, not the way you would format a document. At most one bold phrase per paragraph, and none when nothing needs stopping on. A sentence rather than a bullet whenever a sentence fits, with bullets and tables kept for parallel items that genuinely need line-by-line comparison. No heading on anything under about ten lines. One concept per sentence, and connectives like 你看, 其实, and 换句话说 used freely, because they are what lets one sentence pick up the last.

## 时间桶（先归桶，再动手）

Buckets are exhaustive and disjoint; attribute an overlap to the earlier bucket.

| 桶 | 是什么 | 从哪里量 |
| --- | --- | --- |
| LLM 推理 | 模型调用本身、repair/sign-off/consolidation 重试轮、policy retry | `trace.jsonl` `sendPrompt` span `duration_ms`；`log.jsonl` `agent.turn.started`→`completed`；`trajectories/duration.jsonl` |
| harness 进程开销 | 非 pi harness 每轮 spawn、会话续跑、流解析、退出 | 同轮 turn 总时长 − 该轮 LLM span（两份工件相减） |
| 编排簿记 | 快照与原子写、zod 校验、git 事务与轮提交、handoff/resume 写 | `trace.jsonl` 对应 fn span；`progress.json` `invocationTime[*].completedMs` |
| 串行化与排队等待 | 同 scope 单节点执行、loop 串行、槽位准备串行、信号量排队 | 相邻 `stage.started` 间隔；parent span − Σ 子 span |
| 外部等待 | backoff 睡眠、GPU/网络/人的输入 | `log.jsonl` retry 事件的 delay；无 span 覆盖的存活 gap |

The baseline is a run artifact, not a feeling: pin a concrete `~/.piano/runs/<id>` (disk map in `docs/deep-dive-notes/workflow-run-artifacts.md`) and its shape — recipe, harness, model, machine — because every before/after pair must use the same shape and a mismatched pair is not evidence.

The perf eval suite is the before/after instrument. `piano evals --group workflow-perf` runs five topologies (serial chain, fan-out, loop, handoff chain, DAG) and emits `runtime_overhead_ms` per case, which is wall clock minus LLM inference. Use it for every measurement rather than reinventing the harness; to decompose a single run by bucket, run `node scripts/evals/runtime-metric.mjs <runsRoot>`.

Rollups are cheap: `jq` over `log.jsonl` and `trace.jsonl`, or a scratch tsx script, with `packages/evals/src/driver.ts` as the precedent for reconstructing stage timings from `log.jsonl`. Temporary instrumentation and scratch rollups are allowed; commit them only when they earn a permanent home.

`[估算]` is allowed where measurement is infeasible — write the assumption and the arithmetic 占比 × (1 − 1/因子), and badge the item. An estimate that could have been measured is a method failure.

## The file

`SPEEDUP.md` sits at the repo root. It is untracked under the root-markdown ignore rule and is never committed; it holds the session state and the phase-3 ledger. A complete file:

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

Every proposal carries every slot; delete a slot only when it truly has no content, and an item without a `[实测]` or `[估算]` badge on 预期收益 is not a proposal. `状态` runs 待议 → 已准 → 进行 → 已据, plus 否决, 暂缓, 拆出, and 已回退; an item reaches 已据 or 已回退 only with both 改动 and 检查 filled, and a 已回退 item records the null measurement so the next campaign does not re-propose it. The `## 已排除（审计）` list is a checksum — 排除 plus 提案 equals 候选数 — and measured-null results live there too, because they are deliverables rather than noise.

## Phase 1 — identify

1. Resume first: when `SPEEDUP.md` exists with 待议 or 进行 items, continue from it instead of re-surveying.
2. Fix the scope as concrete paths plus the run shape. When the developer named a symptom ("stage X takes forever", "the tournament run stalls"), localize it into buckets before proposing anything. Read `CLAUDE.md`/`AGENTS.md`, `ARCHITECTURE.txt`, and `TASTE.md` when it exists.
3. Check `git status` first. A file carrying uncommitted user changes is out of scope unless the developer explicitly includes it. Never stash, reset, or clean.
4. Establish the baseline before any proposal. Run `piano evals --group workflow-perf` and record the five `runtime_overhead_ms` values, then compute per-bucket sums for the pinned run and attribute the top buckets to `path:line` from reads you actually performed. With no run artifact for the shape, run the recipe once, or proceed `[估算]`-only and say so in the map.
5. Ask what the developer already did by hand. An agent backgrounding a slow action with a detached script is the strongest evidence that a programmatic lever exists; record it as a candidate with the manual saving as its first estimate.
6. Classify every candidate's change class — 纯内部, 顺序或失败语义变化, 崩溃丢失面变化, YAML 语义扩展, recipes 拓扑变化, or 质量换速度. The class decides what phase 2 must settle.
7. An item qualifies when it holds a share of a few percent of the pinned wall clock, or a fixed step cost dominated by a constant such as a backoff policy or a per-turn spawn, or a lever that unblocks a larger share. It does not qualify as a micro-optimization off the measured path, as speculative concurrency for code that is not serialized in practice, or as anything defended only by "should be faster".
8. Rank by 占比 × 可达因子 ÷ 风险, putting levers that unblock other levers first, same-file items adjacent, and expensive-to-verify items early where they are still cheap to revert.
9. Write `SPEEDUP.md`, then print the map in Chinese: 范围, 基线, the bucket breakdown summing to roughly 100%, the counts (提案 N · 已排除 M), one line per proposal carrying 位置 · 桶+占比 · 手法 · change class, and one closing line: 如果整体方向就不对，直接说，我把它记成一项，不逐项走。
10. Beyond roughly eight candidates, propose rounds by area. Do not present a wall.

## Phase 2 — discuss, item by item

1. One proposal card per item, restated as prose, then exactly one question: 做 / 不做 / 改范围 / 先测再做, plus free text. Put the options in the question text itself.
2. Paste the returned string into `裁决` verbatim, with the verdict and `理由` beside it. Accept `停` (write state, end), `先放着` (`暂缓`), `展开` (deeper evidence, re-ask), and `拆出 P1a/P1b`.
3. Settle behavior-change classes as requirements, question by question; one card may need a short series, with each answer recorded in `理由`.

   顺序保证: which completion order may independent nodes, slots, and `log.jsonl` events have? Today it is stable serial order per scope. If order stops being guaranteed, say what the TUI and evals may now see out of order.

   fail-fast: today one blocked result can stop the scope before later independent nodes burn model turns, and parallelizing removes that. The replacement policy（停 / 继续 / 继续但拦截后取消）is a requirement, with its cost in wasted turns and tokens.

   崩溃丢失面: for anything backgrounded or deferred, name what a crash at the worst interleaving loses. A `progress.json` snapshot may be lossy — it is a monitor projection, and the accepted evidence lives in `progress.jsonl` — while `progress.jsonl`, resume state, and handoff records are not OK by default.

   资源争用: GPU, provider rate limits, token cost. State the contention ceiling and how overlap will be detected; parallel gains end at contention, so the verification compares total wall clock rather than per-lane time.

   质量换速度: fewer repair turns, and any change to prompts, model, thinkingLevel, or sign-off policy, need explicit approval, the quality risk stated, and a validation method — an evals group or a named manual check.

   YAML/拓扑: backward compatibility is a hard requirement, so new keys default to current behavior and every recipe under `recipes/workflows/` and `recipes/eval-workflows/`, plus the `evals/` consumers, must parse unchanged. A topology change states what an evals comparison must show before it counts as done.

4. A batch answer like 都做 is valid only after it is echoed back as the exact numbered list and confirmed once.
5. When a general design position surfaces, fold it into `TASTE.md` with 出处 (`出处: 2026-10-13 P1`) and cite it in later items.

## 背景化（backgrounding）规则

The runtime has no fire-and-forget work today, so backgrounding is a capability with named semantics — a card class of its own, not an optimization detail. Every backgrounding card states, in this order: 目标工件 · 关键路径减掉什么 · 崩溃最坏丢失什么 · 排序影响 · 汇合点 · 取消/背压.

`progress.json` snapshots are safe to background: they are atomic temp-plus-rename, naturally coalescing, and the truth lives in the accepted ledger. Everything else needs an explicit 崩溃丢失面 decision first — `progress.jsonl` appends, resume state, handoff records, contract snapshots, `result.json` validation, git transactions and round commits, workspace markers, tournament snapshots.

Any backgrounded write a consumer could read must be joined before the write that makes it observable, with one join at scope exit and one drain at run end; a fiber that can outlive its scope with no join has to document the drop explicitly. Backpressure must be bounded or coalescing — a snapshot coalesces, a file copy does not — so unbounded I/O is never backgrounded.

For the developer's manual trick there are three programmatic shapes, and the later one is preferable whenever it suffices. The first is a runtime-internal fork for bookkeeping and projections. The second is a YAML stage-level background capability: a slow job started detached, with a later poll or join stage consuming its exit artifact, which needs a new key defaulting to off plus decisions on exit-status capture, orphan cleanup, and progress visibility. The third is a recipe topology pipeline — the slow job as the first node, independent work nodes in between, and a `from:`-linked join node — which needs zero runtime change and should be proposed before the second.

## Phase 3 — implement

1. Work items in `SPEEDUP.md` order, finishing a 进行 item before the next. Re-verify every anchor against the current tree first, and return the item to 待议 when an anchor no longer resolves.
2. Larger levers are allowed and expected: 并行化, 流水线, 背景化, 批量化, 进程复用, 缓存, 减少轮次, YAML 语义扩展（向后兼容）, recipes 拓扑重构, 永久基准. One lever per step, so that the only difference between the before and after measurement is the item itself.
3. Measure after every item by running `piano evals --group workflow-perf` and comparing `runtime_overhead_ms` against the baseline, on the same run shape and the same machine. When the numbers do not move beyond noise the item becomes 已回退: revert the change and record the null measurement in the card, because a null result is a deliverable rather than a failure.
4. Gate before any commit-capable unit with `npm run typecheck && npm test`, plus `npm run lint` unless the developer narrowed it. Focused runs are `npx vitest run tests/<path>` and `npm run test:workflow|test:packages|test:cli`. The `real-*.e2e.test.ts` and `PIANO_TUI_E2E` suites are not the per-step check — name the check you actually used under `检查`.
5. A red step is never carried forward: return to the last green state, fix or re-propose, and rerun the same check. Never destructive git, never reset user work. One coherent commit per item, with a message carrying no AI attribution because the hook rejects it; never push unless asked, and never commit `SPEEDUP.md`.
6. Keep the two hats apart: a bug or contract fix found while speeding becomes a new 待议 proposal, and only approval moves it into scope. An item that grows bigger than proposed stops, gets rewritten with the new evidence, and takes a fresh decision.
7. An item touching the `workflow.ts` schema, recipes YAML, or evals must update the schema tests and parse every workflow fixture; the evals fixtures are part of the check.
8. After each commit update the card with 状态 · `改动: path:line +N −M` · `检查: <command> — 通过` · the measured before and after.

### Permanent benches（若建）

Build one only when an item's verification needs repeated runs and the card names the future regression it will catch. It lives in `tests/perf/` or `scripts/perf/`, never under the bare word "benchmark", which in this repo means GPU kernel benchmarks.

A bench must be deterministic: no real LLM, provider, or network, driving the runtime through the scripted test seams (`tests/common/fake-runner.ts`, `tests/common/fake-pi-sdk.ts`) or a canned subprocess, so that it measures bookkeeping, scheduling, and parallelism rather than model latency.

It is report-only, or asserts wide bounds. A flaky perf test is worse than none, so if it must gate, it gates an integer invariant — span count, ordering, observed concurrency — and never milliseconds.

## Stop conditions

When no baseline is obtainable and the developer declines to produce one, the campaign runs `[估算]`-only, stated in the map, and no item may claim `[实测]`. When contention eats the gain or the total delta falls within noise, revert and record the contention ceiling in the card; never keep a change that only "should" help. When the before and after run shapes differ — model, provider, recipe, or machine changed mid-campaign — the pair is invalid and must be re-measured before anything is decided. A "bench" that needs a real LLM, GPU, or provider is an eval, not a bench, and belongs in the evals apparatus or nowhere. A YAML extension that breaks parsing of any recipe or eval fixture stops the campaign, because backward compatibility is not negotiable. A speedup needing a quality trade or a behavior change the developer will not approve becomes 否决 or 暂缓, reported honestly; parallelizing failure semantics with an undecided replacement policy is simply not implementable and goes back to phase 2. Target files carrying uncommitted user changes are excluded, with narrowing or 暂缓 proposed instead of touching user work.

## Closing

When every 已准 or 进行 item is 已据 or 已回退, run the full gate once more (`npm run typecheck && npm test`, plus lint) and review the complete diff as a reviewer would — regressions, error paths, contracts, persistence, unrelated changes — reporting in Chinese. Report the 待议, 否决, 暂缓, and 已回退 items honestly; null results are part of the outcome. Then clear `SPEEDUP.md`, keeping the title, one line stating the queue is empty, the commit list, and the measured net wall-clock delta when one exists. Never commit or push it.

Candidates discovered during implementation are reported as 待议 in the closing message. The campaign ends; it does not start them.
