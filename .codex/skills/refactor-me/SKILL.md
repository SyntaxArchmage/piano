---
name: refactor-me
description: "Use when the developer wants a deliberate, multi-item refactoring campaign on a named scope of this TypeScript codebase — not a single bounded fix and not a diff review: survey the scope and write a ranked proposal list to REFACTOR.md, each item naming the cost it removes and the observable surface it must not change, decide every item one at a time with the developer, then implement the approved items as small behavior-preserving steps until the list is done and the file is cleared."
---

# Refactor Me

Three phases, one file, one decision at a time.

- **Phase 1 — identify.** Survey a scope, write proposals to `REFACTOR.md`.
- **Phase 2 — discuss.** Settle every item with the developer before any edit.
- **Phase 3 — implement.** Work the approved items in small verified steps until done.

Refactoring changes internal structure and **nothing observable**. In this repository the observable surface is: CLI `--json` streams, `log.jsonl`/`trace.jsonl` event shapes, `progress.json`/`progress.jsonl` formats, handoff records, workspace layouts, `@piano/contract` zod schemas, error and repair semantics, and on-disk file bytes. An edit that would move one of these is a behavior change — a separate proposal, never smuggled into a refactor step.

Two hats: one step restructures, another adds behavior. Never both in one step or one commit. The job is to spend the developer's judgement only on direction and taste, and none on tracing call sites or re-verifying the same claim twice.

Write everything the developer reads — the map, each proposal card, the questions, `REFACTOR.md` — in Chinese. This file is English to match the repository's skill convention.

## The file

### `REFACTOR.md` (repo root)

Session state and the phase-3 ledger. Untracked under the root-markdown ignore rule; never commit it. A complete file looks like this:

```markdown
# REFACTOR

范围: packages/orchestrator/src 的写入路径（handoff.ts · progress.ts · workspace.ts · resume-state.ts）
阶段: 一 · 识别进行中
基线: working tree clean @ d4f83a4 · 候选 5 · 提案 1 · 已排除 4

## 提案

### P1 · 原子 JSON 写入收敛为一个实现
- 成本: 重复 + 改动放大 — 「临时文件 + rename + 错误映射」各自实现多遍，改错误语义要改多处
- 位置: `packages/orchestrator/src/handoff.ts:68` · `progress.ts:212` · `workspace.ts:351` · `resume-state.ts:33`
- 手法: Extract Function + Move Function（新模块 `src/atomic-json.ts`）
- 行为面: `progress.json` 与 handoff 记录字节不变（`JSON.stringify(…, null, 2)` + 尾随换行）；`resume-state.ts` 的 `${path}.${pid}.tmp` 命名保留
- 测试: `tests/workflow/progress.test.ts` · `workspace.test.ts` · `resume-state.test.ts` — 已覆盖
- 步骤: 1) 新建 `atomic-json.ts`，原样搬运 handoff 的写入函数 2) 逐处替换，每处跑对应测试 3) 删除旧私有副本
- 风险: 低 — 每一步有对应测试；不碰 `progress.jsonl` 的追加写
- 状态: 待议
- 裁决: —
- 理由: —
- 改动: —
- 检查: —

## 已排除（审计）

- `workflow-execution.ts:1066` 同款临时文件写入 — 依据: 同文件无独立测试，先补特征测试再并入（留作下轮候选）
- `handoff.ts` 内联条件整理 — 依据: 只有两处，未过 Rule of Three 门槛（YAGNI）
```

Rules:

- Every proposal carries every slot; delete a slot that has no content, never leave it blank. `已据` requires `改动` and `检查` filled.
- `状态` values: `待议 → 已准 → 进行 → 已据`, plus `否决`, `暂缓`, `拆出`.
- `## 已排除（审计）` is the checksum: every surveyed candidate that is not proposed appears with one line and its exclusion reason, so 排除 + 提案 equals the candidate count. Check it before printing the map.

## Phase 1 — identify and propose

1. **Fix the scope.** If the developer named one, resolve it to concrete paths and write it in `范围`. Otherwise propose one bounded scope — a package or directory that should yield 3–10 candidates — and get one confirmation before surveying. Read `CLAUDE.md`/`AGENTS.md`, `ARCHITECTURE.txt`, and `TASTE.md` when it exists; recorded design positions there are already decisions.
2. **Check `git status` first.** A file with uncommitted user changes is out of this session's scope unless the developer explicitly includes it. Never stash, reset, or clean.
3. **Survey with evidence.** For every candidate read the target, its callers, its tests, and its contract surface. Every claim in a proposal needs a `path:line` from a read you actually performed — not from grep output alone and not from memory.
4. **Record test coverage per candidate:** 已覆盖 / 部分 / 缺失, naming the test files. 缺失 is not a veto — it makes characterization tests the item's first step: pin the current behavior green, commit that alone, only then restructure.
5. **What qualifies.** Every item names the concrete cost it removes, using one of: 重复, 改动放大, 散弹式修改, 发散式变化, 理解成本, 预备重构 (it unblocks a named next feature). An item that only says "cleaner" is not ready — discard it or re-evidence it.
6. **What does not.** No speculative abstraction (YAGNI — an interface waits for the second real implementation). No rename, deletion, or reformat driven by taste. No cross-layer coupling: orchestrator does not reach into harness internals, and cross-package types travel only through `@piano/contract`.
7. **Name the technique.** Write the Fowler move — Extract Function, Inline Function, Move Function, Rename, Split Phase, Replace Conditional with Polymorphism — so the proposal is executable without a second reading.
8. **Name the observable surface** the item must leave byte-identical, and the check that proves it. An item that must touch a compatibility boundary (exported types, `legacy-contract-projections.ts`, `recipes/*.yml`) says so and states the boundary rule it will follow.
9. **Rank and sequence.** Order by evidence strength and cost removed, not aesthetics. Constraints override rank: characterization items before the items they protect; items on the same file adjacent; independent items first; anything near an observable surface last and alone.
10. **Write `REFACTOR.md`, then print the map** in Chinese: the scope, the counts (提案 N · 已排除 M), one line per proposal (位置 · 成本 · 手法), and one line: 如果整体方向就不对，直接说，我把它记成一项，不逐项走。
11. Beyond ~8 candidates, propose working in rounds by file group. Do not present a wall of proposals.

## Phase 2 — discuss, item by item

1. Present one proposal card per item — the `REFACTOR.md` slots restated as prose — then ask exactly one question: 做 / 不做 / 改范围 / 先补测试再做, plus free text. Put the options in the question text itself; the widget is a convenience.
2. Ask through whatever question channel exists:

| Harness | Tool | Shape |
| --- | --- | --- |
| Claude Code | `AskUserQuestion` | single-select widget, ≤4 options |
| dsh | `ask_user_question` | field-for-field identical to the above |
| Cursor | `AskQuestion` | single-select widget |
| pi | `discuss` | free-text question, free-text answer |
| headless or none | — | write every item with 裁决: 待议, report the count, stop |

3. Paste the returned string into `裁决` verbatim, including free text typed instead of an option, then write the verdict and `理由` beside it. Do not paraphrase the answer.
4. Accept `停` (write state and end now), `先放着` (`暂缓`), `展开` (re-present with deeper evidence and re-ask), `拆出 P1a/P1b` (split the item, re-ask the parts). Reversing an earlier decision re-opens that item; nothing is applied yet, so revising is free.
5. A batch answer like 都做 is valid only after it is echoed back as the exact numbered list and confirmed once. An amended scope rewrites the item's `位置/步骤/检查` before it becomes `已准`.
6. When the discussion surfaces a general design position, fold it into `TASTE.md` with 出处 (`出处: 2026-10-13 P1`) and cite it in later items.

## Phase 3 — implement

1. Work items in `REFACTOR.md` order; finish a `进行` item before starting the next. Re-verify every anchor against the current tree before editing — HEAD or the working tree may have moved since phase 1. A broken anchor returns the item to `待议`.
2. If the item says 先补测试: write characterization tests that pin current behavior, run them green, and **commit them alone** with a message stating they pin behavior and no restructuring follows yet.
3. One small behavior-preserving step at a time. After each step run the narrowest check (`npx vitest run tests/workflow/<file>.test.ts`, or `npm run test:workflow` / `test:packages` / `test:cli`). Before each commit-capable unit run the repository gate `npm run typecheck && npm test`, plus `npm run lint` unless the developer narrowed it.
4. A red step is never carried forward: return that step to the last green state, fix or re-propose, rerun the same check. Never hide failing validation, never use destructive git, never reset user work. The `real-*.e2e.test.ts` and `PIANO_TUI_E2E` suites are not the per-step check — name the check you did use in `检查`.
5. **Two hats, enforced.** A bug, contract tweak, or error-semantics fix found while restructuring becomes a new proposal with 状态: 待议. Do not fix it in this campaign's commits; only the developer approving it moves it into scope.
6. An approved item turns out bigger than proposed — more callers, a new package boundary, an observable surface in play: stop, rewrite the item with the new evidence, set 状态: 待议, and get a fresh decision. Silent scope expansion is the failure mode this skill exists to prevent.
7. One coherent commit per item (or per step group). Characterization tests always ship in their own commit, separate from the restructuring. Review `git diff --stat` before each commit and include only the item's files. Commit messages are concise and carry no AI attribution — the hook rejects it. Never push unless asked. Never commit `REFACTOR.md`.
8. After each commit update the item: `状态: 已据` · `改动: path:line-line +N −M` · `检查: <command> — 通过|失败`.
9. Documentation that names structure (`ARCHITECTURE.txt` lists file names and roles) is part of the item when the item renames or moves a file. That edit is not scope creep.

## Stop conditions

- The target has no tests and behavior cannot be pinned (nondeterministic TUI or real-harness paths): 暂缓, and say why.
- A "refactor" would touch `packages/contract`, `recipes/*.yml`, exported types, or error semantics: it is a behavior change — a separate proposal, with the compatibility boundary written out.
- The target carries uncommitted user changes: exclude the file, propose narrowing or 暂缓. Never touch user work to clear the way.
- The refactor surfaces a defect: new proposal, 待议. If it makes the current step red, stop and ask.
- The item is bigger than proposed, or a cited `path:line` is wrong: re-evidence, back to 待议, fresh decision.
- Ask instead of editing whenever direction is genuinely uncertain. Report blockers precisely.

## Closing

When every `已准`/`进行` item is `已据`:

1. Run the full gate once more (`npm run typecheck && npm test`, plus lint).
2. Review the complete diff as a reviewer — regressions, error paths, public contracts, persistence, unrelated changes — and report the result in Chinese.
3. Report `待议`/`否决`/`暂缓` items honestly; they are part of the outcome, not noise to drop.
4. Clear `REFACTOR.md`: keep the title, one line stating the queue is empty, and the commit list. Never commit or push it.

Candidates discovered during implementation are reported as 待议 in the closing message. The campaign ends; it does not start them.
