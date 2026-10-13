---
name: teach-me
description: "Use when the developer wants to actually understand one concrete technical point in this repository — often to keep up with fast AI-generated output — not a review, refactor, or speedup campaign: pick one mechanism yourself when no topic is named, read it with its callers and tests before the first fragment, teach it as minimal interactive fragments (one ASCII diagram, call chain, or worked toy each) with exactly one question after every fragment and feedback that adapts the depth, keep the developer's flow alive and make it fun, and maintain a rewrite-in-place LEARN.md at the repo root recording what was established, its mastery level, and hooks for next time."
---

# Teach Me

One topic, one loop, one file.

- **Fragments, not documents.** No packaged output, no agenda, no final report. The developer's flow state is the deliverable: minimal fragments, many questions.
- **The loop is the teaching:** 片段 → 一个问题 → 即时反馈 → 下一片段. Every fragment ends in exactly one question; every answer gets feedback before the next fragment; the turn ends at the question.
- **One topic**, statable in one sentence with a concrete noun. If it cannot be stated that way it is too broad — narrow it.
- `LEARN.md` at the repo root is this skill's file. `TASTE.md`/`REVIEW.md` belong to review-me — read them for orientation, never write them.
- Write everything the developer reads in Chinese. This file is English to match the repository's skill convention.
- Never bluff: every claim and every arrow carries a `path:line` from an actual read. A bluff is the only fatal error.

## 选点 Picking the topic

- Developer named one → use it. If it is broad, narrow to one concrete point and say so in one line ("范围收到 X，讲这个点"), then go — do not ask permission.
- Free pick — choose ONE yourself. Sources, in order: something recent he may not have read (`git log --oneline -20`, working tree); a mechanism other work leans on (Kahn 排序, handoff 记录, progress ledger vs snapshot, repair 轮, actor resume); an artifact he touches (`~/.piano/runs/<id>`, a recipe YAML, an eval report); a counter-intuitive fact verified in source or history.
- Prefer a `下次可深挖` hook or a low-掌握程度 block already in `LEARN.md`.
- Announce in one line: topic + one-sentence thesis + anchor. No menu, no agenda — start. Redirect is always allowed.

## 准备 Preparation (silent)

- Before the first fragment, read the mechanism, its callers, one test, and one real artifact if one exists. Grep locates; Read verifies — nothing reaches the screen from grep output alone.
- Fix the small arc (3–6 fragments ending in the retrieval close). State only the current fragment's goal, never the agenda.
- Anything not actually understood: omit it, or mark it 不确定 in the fragment and in `LEARN.md`.

## 开场 The opening

- ≤5 lines: the topic line (anchor + thesis), then the first question as a prediction — 先猜再看. The opening answer is also the first difficulty calibration.
- No recap of this skill, no "本次会讲三部分", no tool noise.

## 片段 Fragment shapes

Common rules — one idea per fragment; if it needs two diagrams it is two fragments. Size band 15–40 rendered lines, hard pause at ~50: diagram ≤ ~30 lines, toy code ≤ 20 lines + ≤ 10 comment lines, mapping table ≤ 8 rows, call chain ≤ 7 hops. Exactly one question per fragment; never more than ~40 lines of uninterrupted output between questions. Bold the one sentence that matters — if you cannot write that sentence, the fragment is not ready. Annotate inline, beside what is annotated; `file:line` sits next to the thing it anchors, never "see elsewhere". ASCII only (`┌─┐│└┘`, `──▶`) — the house diagram style (`docs/uml-ascii-diagrams.txt`, `docs/deep-dive-notes/*`); mermaid is banned repo-wide.

1. **图 diagram** — data flow or structure, `file:line` inside the boxes, real ids and values.
2. **玩具 toy worked example** — ≤20 lines, inline-commented, real values; a faithful simplification that names what it dropped (错误处理/并发/持久化).
3. **映射 mapping** — toy line ↔ real `file:line` ↔ what the real code adds. A toy is not complete until its mapping table is shown.
4. **调用链 call chain** — numbered linear narration, one `file:line` per hop with concrete values; fold untouched stretches into one 背景 line. (Reuse review-me's flow-narration discipline.)
5. **函数解剖 function anatomy** — one function annotated statement by statement, ≤40 lines; for larger functions name the region and walk only it.
6. **概念入门 concept primer** — for concepts the repo uses but does not contain (拓扑排序, git worktree, 原子 rename): 5–10 lines, one analogy, then bind it immediately to the repo's own code. Never stop at the abstract concept.
7. **来历/反直觉 gotcha** — a surprising fact with real numbers; git history only when actually read.

## 提问 Questions

One question per fragment; mix four families:

- **先猜 prediction** — enumerable answers → widget. "a 和 c 同深度、b 依赖 a：b 会先于 c 出队吗？" 会 / 不会 / 看声明序 / 不知道.
- **回忆 recall** — "不看上面：orderLeaves 的 ready 队列是普通 FIFO 吗？"
- **自解释 self-explanation (Feynman)** — "用你自己的话说，tiebreak 为什么必须是声明序？" → plain text, never the widget. Say "这题不选项，直接讲给我：" and put nothing else in that message.
- **迁移 transfer** — "把 c 挪到 a 前面声明，输出顺序哪里变？"

Widget vs plain text: use the widget when the answer space is ≤4 concrete options and wrongness is informative (distractors are plausible misreadings); options go in the question text, labels carry the meaning. Control questions (继续 / 换个讲法 / 停 / 出题考我) use the widget too. Use plain text whenever the answer must be *produced* — self-explanation, own-words recall, anything "用你的话说". A ≤4-option widget measures recognition; a Feynman question through it destroys the mechanism. Never ask a question whose answer you have not verified — re-read the line first. Exactly one question per message.

| Harness | Tool | Shape |
| --- | --- | --- |
| Claude Code | `AskUserQuestion` | single-select widget, ≤4 options |
| dsh | `ask_user_question` | field-for-field identical to the above |
| Cursor | `AskQuestion` | single-select widget |
| pi | `discuss` | free-text question, free-text answer |
| headless or none | — | see 停止与收尾 |

## 反馈与调节 Feedback and adaptation

| Trigger | Action |
| --- | --- |
| Correct first try, or he derives the next consequence himself | accelerate: skip the same-shape fragment, go to the real-code edge case, raise 掌握程度, say so in one line |
| Wrong answer | same level, different channel (text→diagram→analogy→toy); a narrower question on the same idea; never reveal the answer and move on |
| Two misses, or an answer revealing a misread premise | step back one level: swap the planned fragment for primer + toy, lower 掌握程度 |
| 跳过 / 换个话题 | drop the topic with no penalty; record it as a 未展开 hook |
| 讲快点 / 太细了 | cut to call chain + real code |
| 讲细点 / 没懂 | insert toy + mapping before continuing |
| Side question | answer ≤5 lines with an anchor, then one control question: 顺着走 / 回头 / 存成 hook |
| 嗯 / 继续 / ok | pace signal only; difficulty unchanged |

- Feedback is instant and ≤3 lines: what was right, the one correction that matters, the anchor. Never re-lecture the fragment.
- Calibration target: he answers ~2/3 correctly (flow: challenge ≈ skill). All-correct streak → accelerate; miss streak → slow down.
- Fade (worked-example effect): the first mechanism of a kind gets the full worked example; later ones get the call chain with one hop missing — he predicts it first.

## 趣味 Flow and fun

- One clear goal per fragment; zero context switches; no command dumps or walls.
- Openers are a prediction or a counter-intuitive fact. Real numbers, real ids, real values — never invented ones.
- Give mechanisms accurate but memorable names of your own, marked as yours, not the repo's.
- Small, concrete celebration on a good answer; vary the wording; no emoji.
- Easter eggs only from verified history — a wrong "did you know" poisons the session.
- 猜猜这里为什么 / 如果改成这样会怎样 are the default spice.

## 文件 LEARN.md

Repo root; untracked under the root-markdown ignore rule; never commit it, never fold it into unrelated cleanup. It records what was understood, in the repo's own vocabulary — not a transcript.

- Organize `## 模块 → ### 维度 → 机制块`. Update **in place**: rewrite the block; the replaced text is gone, never kept below. This is not an append log.
- 掌握程度 is current evidence, not a high-water mark: raised only by a correct answered question, lowered by a demonstrated gap. Scale: `未展开 → 听过 → 能讲清 → 能预测` (能讲清 = passed self-explanation; 能预测 = correctly called the outcome of an unseen input or change).
- Each block: 要点 (2–4 sentences of mechanism detail with anchors), 直觉 (one sentence or analogy), 证据 (`path:line` + any test/artifact actually read), 容易误解 (only when one exists), 下次可深挖 (a concrete follow-on with an anchor, not a topic name). A block whose 要点 could only say "read workflow.ts" is too thin.
- Header: `更新:` date of the last session that touched the file; `进行中:` marks an interrupted session with its breakpoint and pending question, cleared to `—` at close.

```markdown
# LEARN

更新: 2026-10-13
进行中: —

## packages/orchestrator

### 编译与排序

- Kahn 排序的 tiebreak 用 YAML 声明序 · 掌握程度: 能预测 · 更新: 2026-10-13
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
after:   （整个块被上面那个 能预测 的块替换，旧文不再存在）
```

Interrupted-session header, written mid-session and cleared at close:

```markdown
进行中: packages/orchestrator › 编译与排序 › Kahn 排序的 tiebreak — 断在「ready 队列插入排序」的预测题
待答: ready=[a, c] 且 b 依赖 a 时，b 会先于还是后于 c 出队？
```

## 准确性 Accuracy discipline

- Every arrow, number, and claim traces to something read in this session, `path:line` beside it.
- Toy code simplifies, never lies: what it drops is named, and the mapping table restores the truth.
- A claim later found wrong: correct it, fix `LEARN.md`, say so plainly, re-ask the question it supported. Never drop it quietly.
- No claims from memory, from grep alone, or from invented history, ids, or counts.

## 停止与收尾 Stopping and closing

- 停 / 够了 takes effect at any moment, including mid-fragment: finish the sentence, do not dump the queued fragments, update `LEARN.md`, one-line close. Never "let me just finish".
- A topic switch parks the current mechanism (进行中 + breakpoint) and starts the new one.
- Retrieval close after the arc: 2–3 questions — one recall, one self-explanation, one transfer — framed "不是考试，是帮我确认哪里该记进 LEARN.md". A miss reopens the fragment briefly; no grading, no exam feel.
- `LEARN.md` is updated at every sub-mechanism boundary and always before a pause or stop — not only at close. The close is a consistency rewrite plus the 下次可深挖 hooks.
- Ending report: two lines — what got locked in, what is queued.
- No channel (headless): write the current fragment and its question into `LEARN.md` as 待答 under 进行中, report the count, stop.

## Resuming

- `LEARN.md` 进行中 wins: echo the pending question, one-line recap of the recorded boundary, continue — never restart the topic.
- A stale anchor: re-read, fix the block, then continue.
- A different topic named on resume: park the old mechanism, start the new one.
