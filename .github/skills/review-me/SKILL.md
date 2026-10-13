---
name: review-me
description: "Review a diff one decision at a time; decisions land in REVIEW.md."
---

# Review Me

Two phases, two files, one decision at a time.

- **Phase 1 — review.** Reads code, produces `REVIEW.md`.
- **Phase 2 — repair.** Applies what `REVIEW.md` records, verifies each fix, clears the file.

`TASTE.md` holds the developer's design positions; it feeds the triage filter in phase 1 and the standard in phase 2.

Write everything the developer reads — the map, each item, `REVIEW.md`, `TASTE.md` — in Chinese. This file is English to match the repository's skill convention.

The job: replace the developer's call-stack tracing and linearisation work with your own, so he spends only judgement. When a decision already exists in `TASTE.md`, record the change as settled and move on.

## The files

### `REVIEW.md` (repo root)

Session state and the phase-2 handoff. A complete file looks like this:

```markdown
# REVIEW

范围: working tree
阶段: 一 · 进行中
当前: R2

## 要你定

### R1 · 取消订单现在先锁库存，再落库
- 位置: `packages/orchestrator/src/order-service.ts:88`
- 问: 库存服务超时时，取消订单应该怎么办？
- 选项: 丙 outbox 补偿（推荐） / 甲 照常取消 / 乙 整体回滚
- 裁决: 丙
- 理由: "补偿优于阻塞，outbox 已经有了，别为库存抖动挡住用户"

## 已略过（审计）

本次 diff 共 18 处改动 — 待决 2 项 · 已略过 16 处

- M1 `packages/orchestrator/src/order-service.ts:41` — 提取 `lockTokenOf()` — 依据: 机械
- M2 `packages/logging/src/index.ts:12` — 日志字段改名 — 依据: 机械
- M3 `packages/harness/src/pi.ts:769` — 沿用 R0 决定的端口写法 — 依据: 同类已决 R0

## 修复

### R1
- 裁决原文: "取消照常，但待释放写进 outbox，后台补偿"
- 改动: `packages/orchestrator/src/order-service.ts:88-104` · +18 −6
- 检查: `npx vitest run tests/orchestrator/cancel-order.test.ts` — 通过
```

The header line 待决 N · 已略过 M is a checksum: N + M equals the change count in the diff. Check it before presenting anything.

### `TASTE.md` (repo root)

Modules down, dimensions across. A dimension is 品味 · 留空 · 防御, plus any the developer names. Update it by rewriting a cell in place.

```markdown
# TASTE

## 全局

### 品味
- 抽象时机: 只在实际出现第二个实现时抽接口。不为假想需求留接口。 `出处: AGENTS.md #7`

### 防御
- 边界: 不信任上游。一切外部输入先校验再落库。 `出处: AGENTS.md #5`

## packages/orchestrator

### 留空
- 已知要长: 多 provider 路由。新增 provider 只许改 `router.ts`，不许扩散到 stage。 `出处: 2026-10-13 R4`

### 品味
- 编排层不直接依赖 harness 内部类型，只走 `@piano/contract` 导出的类型。 `出处: 2026-10-13 R2`
```

Keep it small by rewriting:

- Keep an entry only while it would change a future decision.
- Rewrite the cell on every update; drop any line the new statement replaces.
- Add a 出处 when one exists (`出处: AGENTS.md #7`, `出处: 2026-10-13 R2`).
- On first creation, seed from `AGENTS.md` and `CLAUDE.md`; those rules are already design positions. Where a repository rule and a taste entry disagree, follow the repository rule and record the disagreement as a review item.

## Phase 1 — review

1. **Load `TASTE.md`.** Create it if missing (seeded as above). List any entry the current code contradicts.
2. **Fix the range.** Default to the uncommitted working-tree diff. For a named commit or branch use `<base>...HEAD`. Report files and hunks first; when the diff is too large to survey, agree on a narrower scope before reading deeply.
3. **Survey the change.** For every changed function, read its callers, its tests, and the repository instructions. Produce one artifact: the list of runtime flows the change touches.
4. **Triage** each change as a decision item or a settled item (rules below).
5. **Write `REVIEW.md`.** Set the range, 阶段: 一 · 进行中, the full settled list, and the decision items with 裁决: 待答.
6. **Print the map.** One block: the flows, one line each, and the counts. Follow it with one line: 如果整体方向就不对，直接说，我把它记成一项，不逐项走。
7. **Present items one at a time** through the item template below. After each item, collect the decision through the question channel, record it in `REVIEW.md`, then present the next.
8. **Close** with the transition.

When the developer interrupts with 停 / 跳过 / 展开 M2, act on it right away and update `REVIEW.md`.

### The map

```markdown
本次改动动了 3 条流程：

① 取消订单 — 新增库存锁定调用，落库顺序变了 · R1
② 库存对账 — 纯提取重构，行为未变
③ 配置加载 — 新增一个环境变量来源，优先级排在文件之后 · R2

本次 diff 共 18 处改动 — 待决 2 项 · 已略过 16 处（审计清单在 REVIEW.md）
```

Give every flow a line, including the ones with no decision.

### Resuming a session

When `REVIEW.md` already exists:

1. Recompute the fingerprint: `git diff <range> | git hash-object --stdin`. When it changed, re-resolve every pending item's anchor against the current tree and re-narrate the ones whose anchor moved.
2. Print three lines before the next item: what is already decided, what remains, and the strongest question still open.

## Triage

Classify every change into one of these four settled reasons, writing the reason into the audit list:

- **机械** — rename, format, move, comment, test fixture; no runtime behaviour.
- **已被 TASTE.md 授权** — `TASTE.md` records the developer's position on that dimension in that module. Cite the entry.
- **同类已决** — the same pattern was decided earlier in this session. Cite the item.
- **纯删除** — code removed and confirmed unused. State what confirmed it.

Everything else becomes a decision item. A pattern `TASTE.md` covers in a different module is a decision item, because the position is scoped to its module. A change you cannot describe with confidence is a decision item marked 不确定.

Print the settled list in full, one line per change. When the developer writes 展开 M3 (or anything equivalent), promote that line to a decision item immediately and re-present it.

## The item template

Fill the slots in this order. Delete a slot that has no content.

```markdown
### R1 · 取消订单现在先锁库存，再落库

**流程**

1. `apps/api/src/order-controller.ts:41` 用户点取消 → `cancelOrder(orderId="A-91")`
2. `packages/orchestrator/src/order-service.ts:88` **← 本次改动**
   - 以前: 直接 `orders.update(status=CANCELLED)`
   - 现在: 先调 `inventory.lockAndRelease("A-91")`，拿到 `lockToken` 才更新
   - 数据: `order.status: PENDING → CANCELLED`
3. `packages/orchestrator/src/order-service.ts:96` `order.lockToken` 被写入（新增字段）
4. `packages/orchestrator/src/notify.ts:22` 发邮件从「必定执行」变成「库存不超时才执行」
   - 以前: 落库后立刻发
   - 现在: 落库后立刻发，但库存调用超时会提前 return，发不出去
5. 终点: 事务提交，`order.status = CANCELLED`

**判断点**

- [防御] `order-service.ts:91` —— 原文: `if (token === null) return;` · 超时直接返回，解锁被跳过 —— 边界: 网络 · 失败后果: 订单取消了但库存没释放，且没有计数、没有日志，只能靠对账事后发现。
- [品味] `order-service.ts:88` —— 原文: `this.inventory = new InventoryClient(cfg.inventoryUrl)` · 直接构造 —— 依据: `TASTE.md#orchestrator#品味` 要求外部系统走端口，这里破了。

**要你定**

Q: 库存服务超时时，取消订单应该怎么办？

- 丙 取消照常，把待释放写进 outbox，后台补偿（推荐）—— `packages/orchestrator/src/outbox.ts` 已有现成机制，改动最小，且不阻塞用户
- 甲 照现在这样，接受库存可能没释放 —— 最简单，但会漂，且漂了没人知道
- 乙 整个取消失败并回滚 —— 保证强一致，但库存服务抖动会直接挡住用户取消订单

我倾向 **丙**。
```

How to write each slot:

- **流程** — list only the steps this change touches; collapse untouched steps into one 背景 line. When a twenty-step flow changed step 4 and shifted step 12, show 4 and 12 and name what you folded. Give every step a `file:line`. Write inferred steps as `（推测）` with the reason. Write concrete values in before/after form: `PENDING → CANCELLED`.
- **判断点** — one line per mark: the mark, `path:line`, the verbatim decisive line (原文: …), and the consequence. Produce the quote from an actual read of the file.
- **要你定** — exactly one question, two or three options, each option a concrete alternative (丙 / 甲 / 乙) with its mechanism and its cost. Put your recommendation first with (推荐) and end with 我倾向 **X**. When two questions appear, split the item.
- Write every step so it is readable alone: when two items share a flow, repeat the steps that matter.

### Writing the four marks

- `[缺陷]` — name a concrete input or interleaving, then the wrong result it produces.
- `[品味]` — name the `TASTE.md` entry this departs from. When no entry covers the module and dimension, write so explicitly and let the decision found the entry.
- `[留空]` — name the future direction and what it costs now: 接入第二个支付渠道现在必须改 OrderService.
- `[防御]` — name the boundary (外部输入 · 网络 · 并发 · 部分失败 · 幂等) and what stops working when it fails.

## The question channel

One question per item. Put the options in the question text itself. Ask it and record the answer.

- The answer is evidence: paste it into `REVIEW.md` 理由 verbatim, including free text typed instead of an option, then write the recorded verdict beside it.
- Accept 先放着 (record 裁决: 待定) and 停 (end the session) as answers.
- Accept 重开 R1 to re-open a decided item and present it again. Nothing is applied yet during phase 1, so revising is free.
- Quote any free-text answer that states a general position into `REVIEW.md` 理由; it becomes a `TASTE.md` entry at the transition.

## Transition — end of phase 1

1. **收尾.** Three short lines: what changed, what was decided, what is still 待答.
2. **Fold into `TASTE.md`.** From the positions the discussion revealed, rewrite the affected cells in place, with 出处 pointing at the session item (`出处: 2026-10-13 R2`). Delete any entry this session showed to be wrong. Print the resulting diff as the confirmation.
3. **Echo the amendments.** For each decision the developer typed himself, render the exact instruction phase 2 will carry out and get one-word confirmation.
4. **Ask before touching code.** Phase 2 begins on an explicit instruction.

## Phase 2 — repair

1. Read `TASTE.md` and `REVIEW.md`.
2. Work the decided items in `REVIEW.md` order.
3. Edit only what the decision covers. Anything else noticed goes into `REVIEW.md` as a new item.
4. For each item record three lines in `REVIEW.md`: the decision text, the diff actually made, and the check result. When the decision was amended during review, derive a check for the amended behaviour.
5. Leave 待答 and 待定 items alone.
6. When a recorded decision cannot hold against the code, stop and ask.
7. Clear `REVIEW.md` once every decided item is applied and verified and nothing is left 待答 or 待定: keep the title and one line stating the queue is empty.

## When things go wrong

- The developer says 停: write the current state to `REVIEW.md` right away and end the session.
- A presented quote turns out to be wrong: re-verify every anchor shown so far, return items resting on a broken anchor to 待定, and name the conclusions that no longer hold.
- The developer needs the diff or the editor to answer: ask which step was unclear, re-present that item, and record the miss in `REVIEW.md`.
- The decision queue exceeds 5 items: say so in the map and propose reviewing one flow at a time.
- A flow resists description: turn that into a decision item marked 不确定.
