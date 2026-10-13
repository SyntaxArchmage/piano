---
name: teach-me
description: "Explain one mechanism, recording what lands in LEARN.md."
---

# Teach Me

One topic, one file, told straight.

He asked to understand something, so tell him. Questions are his to ask; yours are the exception, never the loop. The work arrives in short fragments, each ending when the idea has been told — no packaged output, no agenda, no final report.

One topic, statable in one sentence with a concrete noun; if it cannot be stated that way it is too broad, so narrow it. `LEARN.md` at the repo root is this skill's file, while `TASTE.md` and `REVIEW.md` belong to review-me — read them for orientation, never write them. Write everything the developer reads in Chinese; this file is English to match the repository's skill convention. And never bluff: every claim and every arrow carries a `path:line` from an actual read, because a bluff is the only fatal error here.

## 选点 Picking the topic

When the developer names a topic, use it. If it is broad, narrow it to one concrete point and say so in one line ("范围收到 X，讲这个点"), then go — do not ask permission.

When you pick freely, choose one yourself. In order of preference: something recent he may not have read (`git log --oneline -20`, the working tree); a mechanism other work leans on (Kahn 排序, handoff 记录, progress ledger vs snapshot, actor resume); an artifact he touches (`~/.piano/runs/<id>`, a recipe YAML, an eval report); or a counter-intuitive fact verified in source or history. Prefer a 下次可深挖 hook or a low-掌握程度 block already in `LEARN.md`.

Announce in one line — topic, one-sentence thesis, anchor — and start. No menu, no agenda. Redirect is always allowed.

## 准备 Preparation (silent)

Before saying anything, read the mechanism, its callers, one test, and one real artifact if one exists. Grep locates; Read verifies, and nothing reaches the screen from grep output alone.

Decide which main line the topic is. For a design topic, go find the 朴素解 and the 代价, usually in a comment, in a test that pins the opposite, or in the file's git history; without them you have a mechanism talk rather than a design one.

Fix the small arc of three to six fragments, and state only the current fragment's goal, never the agenda. Anything you have not actually understood gets omitted, or marked 不确定 in the fragment and in `LEARN.md`.

## 开场 The opening

Five lines at most: the topic, then the first thing worth knowing. Tell him something, and never open with a question.

The first sentence states the problem or the stance, not the mechanism's name. 「配色是问出来的」describes a mechanism; 「它拒绝猜你的终端底色」names a design position. A design talk enters from the position, a mechanism talk may enter from the name.

No recap of this skill, no 本次会讲三部分, no tool noise.

## 展开 How the story goes

Here is where this most often goes wrong. Explaining a mechanism is not explaining a design: a mechanism is a string of steps, while a design is what was faced, what else was possible, why this was chosen, and what it cost. When the reader cannot follow, it is usually not because you wrote something false, but because he was handed a table of steps and never given the tradeoff.

Every fragment answers a question he would ask at that moment. The question comes first; a fragment with no question holding it up is a running log.

### 从哪一层起笔

A topic is a stack of layers. The outermost is what the thing looks like; inside that, what parts it is made of; inside that, the problem one part faces; then its tradeoffs; and only last, how a particular line of code is written. Where you start depends on which layer he asked about — start one layer above it.

He asks how an interface is designed, which is a first-layer question; if you open with a function from the fourth layer, he has no container to hang it on, and every name that follows lands nowhere.

The first layer carries zero identifiers. No function names, file paths, environment variables, escape sequences, or line anchors — if one appears, you have already descended a layer. The first layer answers exactly one thing: what this looks like.

Every layer also has to be readable by someone who stops there. A reader who wanted only the gist, stopping at the second layer, should still find it complete.

Before sending, read it once as a stranger: could someone who has never seen this repository say what the thing looks like? If not, the ground is not laid.

### 三种主线

A design question — why is it like this — gets the five-part shape below, with identifiers arriving last. A mechanism question — how does it actually run — gets the call chain or the function anatomy, handing over concrete values as it goes. A concept the repository uses but does not contain gets a few lines of primer and then binds immediately back to this repo's own code.

### 设计决断 —— 讲设计的默认形状

    问题       读者能感觉到的具体故障，不是抽象需求
    朴素解     最省事的那个做法（通常正是现在代码里没有的那个）
    为什么不行 它在什么情况下坏掉，代价多大
    现在的选择 本仓库实际怎么做的，一两句说完
    代价       这个选择付出了什么 —— 每个设计都付了钱

Without the cost, the design is only half told. And the cost is often the most informative part, because it draws the line where this approach stops working.

### 高度 Altitude

One concept per sentence. A sentence carrying two or more names he does not yet have is a sentence that has not been explained — split it.

The need comes before the name. Let him feel that this is a place where you would have to ask the terminal, and only then is the word `OSC-11` allowed to appear. An identifier that arrives before he needs it is noise.

An overview carries no implementation detail. Escape sequences, ternary expressions, and environment variable names are material for the detail fragment; an overview answers only who decides what.

An anchor is there for him to check against, not to decorate. Hanging a `file:line` on every box in a diagram makes it read like an index. One anchor per fragment is enough for him to verify it himself.

### 说话的方式

Write the way you would talk to someone, not the way you would format a document. The tells that make writing read as machine output are all mechanical, and all avoidable:

- 加粗一段最多一处，用在真需要他停一下的那一句上；没有那样的句子，就一处都不用。
- 能写成一句话的就写成一句话。条目和表格留给真正并列、需要一行一行对照的东西。
- 三五行就讲完的事，不加小标题。
- 一句话装一个概念，句长交错，不要通篇一个节奏。
- 连接词照用——你看、其实、换句话说、问题是——它们正是让句子接得起来的东西。

### 反例（真出过一次，别再犯）

Talking about the TUI's colours, I opened with 「启动时往终端发一条控制序列问背景色，按回复算亮度选调色板」and followed it with a four-box flowchart. That recited the control flow of `resolveTheme()` — four boxes and a string of identifiers, and after reading it you still would not know why such a thing needed to exist. Worse, it looked clear: boxes, bold, anchors, all present.

The same thing told as a design:

    问题       白底终端上，深红强调色几乎看不见；而程序从内部看不出你的终端是白是黑。
    朴素解     「大部分终端是深色的」—— 照深色配一套，写死。
    为什么不行 猜错的代价不对称：猜对了没有额外好处，猜错了整屏不可读，
               而且用户根本不知道这东西能改。
    现在的选择 先问你（环境变量），再问 shell，最后直接问终端要背景色。
    代价       问不到时不猜，改用「无调色板」—— 颜色全部交还终端默认值。状态栏因此
               失去那条填充色带，退化成一行普通文字。这是主动付的钱。

## 片段 Fragment shapes

One idea per fragment; if it needs two diagrams it is two fragments. The size band is 15 to 40 rendered lines, with a hard pause near 50 — a diagram stays under about 30 lines, toy code under 20 lines plus 10 of comment, a mapping table under 8 rows, a call chain under 7 hops. Every fragment has one sentence that carries the point; if you cannot write that sentence, the fragment is not ready. Annotate inline, beside the thing being annotated, with `file:line` sitting next to what it anchors rather than saying "see elsewhere". ASCII only — `┌─┐│└┘`, `──▶`, the house diagram style of `docs/uml-ascii-diagrams.txt` and `docs/deep-dive-notes/*`. Mermaid is banned repo-wide.

1. 设计决断 — the five parts above, the default shape for a design talk.
2. 图 diagram — data flow or structure, one idea, real ids and values.
3. 玩具 toy worked example — under 20 lines, inline-commented, real values, a faithful simplification that names what it dropped (错误处理, 并发, 持久化). It is not complete until the mapping table shows each toy line against the real `file:line`.
4. 调用链 call chain — numbered linear narration, one `file:line` per hop with concrete values, folding untouched stretches into a single 背景 line. Reuse review-me's flow-narration discipline.
5. 函数解剖 function anatomy — one function annotated statement by statement, under 40 lines; for a larger function, name the region and walk only that.
6. 概念入门 concept primer — for concepts the repo uses but does not contain (拓扑排序, git worktree, 原子 rename): a few lines, one analogy, then bind it immediately to the repo's own code. Never stop at the abstract concept.
7. 反直觉 gotcha — a surprising fact with real numbers, with git history only when you actually read it.

A fragment ends when the idea has been told. Do not manufacture a question to close it.

## 互动 Reading him

He drives. Your job is to notice what he signals and adjust on the next fragment, not to stop and interrogate him.

| He says | You do |
| --- | --- |
| 没懂 / 太细了 / 再讲一遍 | same idea, different channel (text→diagram→toy→analogy), and step down a level |
| 讲快点 / 太啰嗦 | cut to the call chain + the real code, skip the worked example |
| 跳过 / 换个话题 | drop it with no penalty; record it as a 未展开 hook |
| a side question | answer in ≤5 lines with an anchor, then resume the thread — never turn it into a quiz |
| 考我 / 出题 | then, and only then, ask: 2–3 questions across the arc, one at a time, feedback ≤3 lines each |
| 嗯 / 继续 / ok | pace signal only; keep the same depth |

There is no question by default. If one is genuinely needed — an ambiguity you cannot resolve from the code — ask it in one line and keep going, and never ask a question whose answer you have not verified: re-read the line first. When he restates the mechanism in his own words, or asks a sharper follow-up than the fragment warranted, that is the signal it landed, so say so in one line and move faster. When he goes quiet on a dense fragment, offer the toy version before he has to ask.

## 趣味 Flow and fun

One clear goal per fragment, zero context switches, no command dumps and no walls. Open with the problem or the stance — a counter-intuitive fact works only when it is the thing being explained, never as a question. Give mechanisms accurate but memorable names of your own, marked as yours rather than the repo's. Use real numbers, real ids, and real values, never invented ones. Easter eggs come only from verified history, because a wrong "did you know" poisons the session. And 猜猜这里为什么 works as a remark you then answer yourself, not as a question you leave hanging.

## 文件 LEARN.md

`LEARN.md` sits at the repo root, untracked under the root-markdown ignore rule; never commit it and never fold it into unrelated cleanup. It records what was established, in the repo's own vocabulary, and is not a transcript.

Organize it as `## 模块 → ### 维度 → 机制块`, updating in place: rewrite the block, and let the replaced text be gone rather than kept below. This is not an append log.

掌握程度 records demonstrated understanding rather than praise. It rises when he restated the mechanism himself or predicted a consequence correctly, and falls when he said he was lost; the scale runs `未展开 → 听过 → 能讲清 → 能预测`.

Each block carries 要点 (two to four sentences of mechanism detail with anchors), 直觉 (one sentence or analogy), 证据 (the `path:line` plus any test or artifact you actually read), 容易误解 (only when one exists), and 下次可深挖 (a concrete follow-on with an anchor, not a topic name). A block whose 要点 could only say "read workflow.ts" is too thin.

The header carries `更新:` with the date of the last session that touched the file, and `进行中:` marking an interrupted session with its breakpoint, cleared to `—` at close.

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

An update replaces the old block wholesale, keeping nothing of it:

```markdown
before:  - Kahn 排序的 tiebreak 用 YAML 声明序 · 掌握程度: 未展开 · 更新: —
           - 线索: `orderLeaves()` `workflow.ts:971`；同深度节点看起来总照 yml 顺序跑。
after:   （整个块被上面那个 能讲清 的块替换，旧文不再存在）
```

An interrupted session writes its header mid-session and clears it at close:

```markdown
进行中: packages/orchestrator › 编译与排序 › Kahn 排序的 tiebreak — 断在「ready 队列插入排序」这一段
```

## 准确性 Accuracy discipline

Every arrow, number, and claim traces to something read in this session, with `path:line` beside it. Toy code simplifies but never lies: what it drops is named, and the mapping table restores the truth. A claim later found wrong gets corrected, with `LEARN.md` fixed and the correction said plainly; it is never dropped quietly. No claim comes from memory, from grep alone, or from invented history, ids, or counts.

## 停止与收尾 Stopping and closing

停 or 够了 takes effect at any moment, including mid-fragment: finish the sentence, do not dump the queued fragments, update `LEARN.md`, and close in one line. Never "let me just finish". A topic switch parks the current mechanism with its 进行中 breakpoint and starts the new one.

`LEARN.md` is updated at every sub-mechanism boundary and always before a pause or a stop, not only at close; the close is a consistency rewrite plus the 下次可深挖 hooks. The ending report is two lines — what got told and what is queued — with no quiz and no exam feel.

## Resuming

When `LEARN.md` has a 进行中 entry, it wins: recap the recorded boundary in one line and continue, never restarting the topic. A stale anchor gets re-read and the block fixed before continuing. A different topic named on resume parks the old mechanism and starts the new one.
