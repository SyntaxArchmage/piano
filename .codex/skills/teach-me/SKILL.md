---
name: teach-me
description: "Explain one mechanism, recording what lands in LEARN.md."
---

# Teach Me

One topic, one file, told straight.

- **Explain, don't quiz.** He asked to understand something. Tell him. Questions are his to ask — yours are the exception, never the loop.
- **Fragments, not documents.** No packaged output, no agenda, no final report. Short pieces, each ending when the idea has been told.
- **One topic**, statable in one sentence with a concrete noun. If it cannot be stated that way it is too broad — narrow it.
- `LEARN.md` at the repo root is this skill's file. `TASTE.md`/`REVIEW.md` belong to review-me — read them for orientation, never write them.
- Write everything the developer reads in Chinese. This file is English to match the repository's skill convention.
- Never bluff: every claim and every arrow carries a `path:line` from an actual read. A bluff is the only fatal error.

## 选点 Picking the topic

- Developer named one → use it. If it is broad, narrow to one concrete point and say so in one line ("范围收到 X，讲这个点"), then go — do not ask permission.
- Free pick — choose ONE yourself. Sources, in order: something recent he may not have read (`git log --oneline -20`, working tree); a mechanism other work leans on (Kahn 排序, handoff 记录, progress ledger vs snapshot, actor resume); an artifact he touches (`~/.piano/runs/<id>`, a recipe YAML, an eval report); a counter-intuitive fact verified in source or history.
- Prefer a `下次可深挖` hook or a low-掌握程度 block already in `LEARN.md`.
- Announce in one line: topic + one-sentence thesis + anchor. No menu, no agenda — start. Redirect is always allowed.

## 准备 Preparation (silent)

- Before saying anything, read the mechanism, its callers, one test, and one real artifact if one exists. Grep locates; Read verifies — nothing reaches the screen from grep output alone.
- Fix the small arc (3–6 fragments). State only the current fragment's goal, never the agenda.
- Anything not actually understood: omit it, or mark it 不确定 in the fragment and in `LEARN.md`.

## 开场 The opening

- ≤5 lines: the topic line (anchor + thesis), then the first thing worth knowing about it. Tell him something — do not open with a question.
- No recap of this skill, no "本次会讲三部分", no tool noise.

## 片段 Fragment shapes

Common rules — one idea per fragment; if it needs two diagrams it is two fragments. Size band 15–40 rendered lines, hard pause at ~50: diagram ≤ ~30 lines, toy code ≤ 20 lines + ≤ 10 comment lines, mapping table ≤ 8 rows, call chain ≤ 7 hops. Bold the one sentence that matters — if you cannot write that sentence, the fragment is not ready. Annotate inline, beside what is annotated; `file:line` sits next to the thing it anchors, never "see elsewhere". ASCII only (`┌─┐│└┘`, `──▶`) — the house diagram style (`docs/uml-ascii-diagrams.txt`, `docs/deep-dive-notes/*`); mermaid is banned repo-wide.

1. **图 diagram** — data flow or structure, `file:line` inside the boxes, real ids and values.
2. **玩具 toy worked example** — ≤20 lines, inline-commented, real values; a faithful simplification that names what it dropped (错误处理/并发/持久化).
3. **映射 mapping** — toy line ↔ real `file:line` ↔ what the real code adds. A toy is not complete until its mapping table is shown.
4. **调用链 call chain** — numbered linear narration, one `file:line` per hop with concrete values; fold untouched stretches into one 背景 line. (Reuse review-me's flow-narration discipline.)
5. **函数解剖 function anatomy** — one function annotated statement by statement, ≤40 lines; for larger functions name the region and walk only it.
6. **概念入门 concept primer** — for concepts the repo uses but does not contain (拓扑排序, git worktree, 原子 rename): 5–10 lines, one analogy, then bind it immediately to the repo's own code. Never stop at the abstract concept.
7. **来历/反直觉 gotcha** — a surprising fact with real numbers; git history only when actually read.

A fragment ends when the idea has been told. Do not manufacture a question to close it.

## 互动 Reading him

He drives. Your job is to notice what he signals and adjust on the next fragment — not to stop and interrogate him.

| He says | You do |
| --- | --- |
| 没懂 / 太细了 / 再讲一遍 | same idea, different channel (text→diagram→toy→analogy), and step down a level |
| 讲快点 / 太啰嗦 | cut to the call chain + the real code, skip the worked example |
| 跳过 / 换个话题 | drop it with no penalty; record it as a 未展开 hook |
| a side question | answer in ≤5 lines with an anchor, then resume the thread — never turn it into a quiz |
| 考我 / 出题 | then, and only then, ask: 2–3 questions across the arc, one at a time, feedback ≤3 lines each |
| 嗯 / 继续 / ok | pace signal only; keep the same depth |

- No question by default. If a question is genuinely needed — an ambiguity you cannot resolve from the code — ask it in one line and keep going.
- Never ask a question whose answer you have not verified; re-read the line first.
- When he restates the mechanism in his own words, or asks a sharper follow-up than the fragment warranted, that is the signal it landed. Say so in one line and move faster.
- When he goes quiet on a dense fragment, offer the toy version before he has to ask.

## 趣味 Flow and fun

- One clear goal per fragment; zero context switches; no command dumps or walls.
- Openers are a counter-intuitive fact or a real number — never a question.
- Give mechanisms accurate but memorable names of your own, marked as yours, not the repo's.
- Real numbers, real ids, real values — never invented ones.
- Easter eggs only from verified history — a wrong "did you know" poisons the session.
- 猜猜这里为什么 works as a remark you then answer yourself, not as a question you leave hanging.

## 文件 LEARN.md

Repo root; untracked under the root-markdown ignore rule; never commit it, never fold it into unrelated cleanup. It records what was established, in the repo's own vocabulary — not a transcript.

- Organize `## 模块 → ### 维度 → 机制块`. Update **in place**: rewrite the block; the replaced text is gone, never kept below. This is not an append log.
- 掌握程度 records demonstrated understanding, not praise: raised when he restated the mechanism himself or predicted a consequence correctly; lowered when he said he was lost. Scale: `未展开 → 听过 → 能讲清 → 能预测`.
- Each block: 要点 (2–4 sentences of mechanism detail with anchors), 直觉 (one sentence or analogy), 证据 (`path:line` + any test/artifact actually read), 容易误解 (only when one exists), 下次可深挖 (a concrete follow-on with an anchor, not a topic name). A block whose 要点 could only say "read workflow.ts" is too thin.
- Header: `更新:` date of the last session that touched the file; `进行中:` marks an interrupted session with its breakpoint, cleared to `—` at close.

```markdown
# LEARN

更新: 2026-10-13
进行中: —

## packages/orchestrator

### 编译与排序

- Kahn 排序的 tiebreak 用 YAML 声明序 · 掌握程度: 能讲清 · 更新: 2026-10-13
  - 要点: `orderLeaves()` 是 Kahn 排序，但 ready 队列不是 FIFO——节点按其声明 index 插入排序（`workflow.ts:975-978` 初始化，`:991-993` 新就绪节点的插入位置）。依赖只决定「能不能跑」，同深度的那一半顺序完全由 yml 声明决定。
  - 直觉: 图只约束相对次序，没约束的地方照原文排。
  - 证据: `packages/orchestrator/src/workflow.ts:971-1000`；`:998` 是环检测，`:1011` 抛 "cannot be topologically ordered"。
  - 容易误解: `ready.shift()` 看着像 BFS 队列，其实每次入队都先找插入位置，等价于按 index 排序的优先队列。
  - 下次可深挖: loop/map 展开的 dotted leaf id 怎么生成（`lowerNodes`，`:1008` 调用）。
```

Update example — the old block is replaced wholesale, nothing appended:

```markdown
before:  - Kahn 排序的 tiebreak 用 YAML 声明序 · 掌握程度: 未展开 · 更新: —
           - 线索: `orderLeaves()` `workflow.ts:971`；同深度节点看起来总照 yml 顺序跑。
after:   （整个块被上面那个 能讲清 的块替换，旧文不再存在）
```

Interrupted-session header, written mid-session and cleared at close:

```markdown
进行中: packages/orchestrator › 编译与排序 › Kahn 排序的 tiebreak — 断在「ready 队列插入排序」这一段
```

## 准确性 Accuracy discipline

- Every arrow, number, and claim traces to something read in this session, `path:line` beside it.
- Toy code simplifies, never lies: what it drops is named, and the mapping table restores the truth.
- A claim later found wrong: correct it, fix `LEARN.md`, say so plainly. Never drop it quietly.
- No claims from memory, from grep alone, or from invented history, ids, or counts.

## 停止与收尾 Stopping and closing

- 停 / 够了 takes effect at any moment, including mid-fragment: finish the sentence, do not dump the queued fragments, update `LEARN.md`, one-line close. Never "let me just finish".
- A topic switch parks the current mechanism (进行中 + breakpoint) and starts the new one.
- `LEARN.md` is updated at every sub-mechanism boundary and always before a pause or stop — not only at close. The close is a consistency rewrite plus the 下次可深挖 hooks.
- Ending report: two lines — what got told, what is queued. No quiz, no exam feel.

## Resuming

- `LEARN.md` 进行中 wins: one-line recap of the recorded boundary, continue — never restart the topic.
- A stale anchor: re-read, fix the block, then continue.
- A different topic named on resume: park the old mechanism, start the new one.
