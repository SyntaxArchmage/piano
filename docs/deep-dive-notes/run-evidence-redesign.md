# run evidence（logs）重设计 — 工作稿

> **读者是 agent，不是人。** 目的：让下一次接手的人不必重新推导现状与结论。
> **基线**：`worktree-lifecycle-refactor-dsf` tip `460a9dc`（未提交：`workflow-execution.ts` 改动 + `stage-runner-support.ts` 新增）。
> **状态**：设计已定、**未实现**。所有 file:line 是 2026-10-15 实测，实现前按 §E 逐项复验。
> **来源**：9 个 codebase 读图 agent + 3 个对抗验证者（独立探针复现）+ 108 agent deep research（25/25 主张对抗验证）+ 3 方案 judge panel。
> 相关：`workflow-run-artifacts.md`（产物普查）、`../issue-51-loop-context-worklog.md`（loop actor 共享 session 为何是有意设计）、`../../README.md:391-478`（唯一准确的现行 layout 规范）。

---

## A. 现状（已核实）

### A1. 一个 run 同时服务五个消费方，且**文件内部**也在混

| 文件 | 写入方 | 实际服务 | 备注 |
|---|---|---|---|
| `log.jsonl` | logging | **debug + human + flywheel 三合一** | trace-namespace 的 `function.enter/exit`（debug）、`run.created`/`stage.*`（human）、`agent.event.received`（flywheel 抽指标，`evals/driver.ts:847-936`） |
| `trajectory.json` | logging/cli | human 回放 + flywheel 指标 + picker 元数据 | 单行 compact、**每轮全量重写**；`/rename` 走 `JSON.stringify(v,null,2)`，而 picker 用无空白正则 tail 读 → **静默退化成 id-only 行**（潜伏缺陷） |
| `progress.jsonl` / `progress.json` | orchestrator | flywheel + human + gate | 同一状态的两种表示，无一致性检查 |
| `trace.jsonl` | logging | debug | + static-analysis gate |
| `resume.json(l)` | orchestrator | **orchestrator 自续接**（唯一权威） | 标签写「agent」是误导 |
| `actors/**/session/*.jsonl` | harness | agent 记忆 + 审计 + flywheel | |
| `attempts/<k>/result.json` | **worker 自己写** | 验收输入 | 与 orchestrator 不可变证据同居一个目录，**信任级别只靠子目录名区分** |

**第五消费方**：orchestrator 控制面自恢复（`resume.json.<pid>.tmp` 崩溃恢复、`readWorkspaceRecords`/`cleanupMapWorkspaces`、consolidation sentinel）。
**第六消费方**：~40 个 test/fixture + `recipes/*/agents.md`、`skills/*/SKILL.md` —— 后者是**发布给 agent 的路径契约**，改路径等于改提示词。

### A2. 身份拼写散乱（同一对象多种写法）

- 无 frame 有 4 种：`undefined`（`runtimeInstanceId`）/ `root`（路径段）/ `root`（actorKey 拼接）/ 记录里省略（`progress.ts:96`、`handoff.ts:104`），但 log data 写 `"root"`。
- 整数基准混用：`prompts/<n>`、`attempts/<k>` 1-based；`iter-N` 0-based；人类提示渲染 `iter-1`。
- map lane 4 种：`"candidates/slot-2"` / `mapSlot: 2` / `"stage@candidates/slot-2"` / 目录 `candidates%2Fslot-2`。
- `log` 的 `instance` = harness sessionId（`harness/src/event-observer.ts:24`）；`progress` 的 `instanceId` = runtime lane。同词两义。
- `trace_id` 两个来源：`createSession` 铸随机 128-bit（`session.ts:63`），而 `LogWriter`/`TraceWriter` 默认回退成 run id（`log.ts:44`、`trace.ts:54/:222`）。
- `progress.jsonl` 记录**不带 promptIndex** → `(invocationId, attempt)` 在一 run 内不唯一（实测某 run 6 条同值行）。
- 嵌套 loop 的 `iteration` 两处取值不同：`progress.jsonl` 取第一个 loop frame，trajectory 投影取最后一个。

---

## B. loop/iteration 缺陷（3/3 验证者独立复现，结论一致）

### B1. 前提修正

**记忆续接没有被 iteration 破坏。** `workflowActorKey` / `actorSessionDirectory`（`workflow-runtime.ts:106-132`）**刻意剔除 loop frame**，actor 目录形如 `actors/pi/<stage>/root/session`，跨 iteration、跨 prompt 都是同一条对话。探针实测续接正常。这是 `issue-51` worklog 拒绝方案 A 时留下的有意设计，**不要改**。

### B2. 真机制：缺的是 **job / execution-pass 维度**

每个 prompt 与每次 `/resume` 都用**同一 `executionId` 重跑整个 workflow**，无 stage 级 checkpoint（`cli/session-run.ts:263-284`；`workflow-resume.ts:40-66` 只带 actors+promptIndex）→ loop 从 `iteration=0` 重建 frame → `runtimeInstanceId` 在第二轮**推导出完全相同的字符串** → 撞上第一轮遗留物。

| | 位置 | 结果 |
|---|---|---|
| **A** | `mapSlotKey` = `runtimeInstanceId`（含 iter-N），**无 prompt 维度**（`workspace.ts:461/:469-486`）；上一轮 tournament 退出写 `status:"cleaned"` 墓碑并删目录（`workspace.ts:1006-1018`） | 第二轮 `allocateMapWorkspace` 抛错（`workspace.ts:676-678`）→ `workspace slot "tune/iter-0/tune.race/slot-0" was already cleaned` |
| **A′** | `workspace.preserve:true` 时 record 为 `"preserved"`，走 **rebind 静默复用同一 cwd**（`workspace.ts:679-693`） | 探针实测第二轮 slot cwd 与第一轮**完全相同** → 从残留候选继续、baseline 拍脏目录 → **静默错误结果，不报错** |
| **B** | `tournamentSnapshotRoot` 含 iter-N（现 `scope-walker.ts:799`） | promptIndex 重复（无 continuation 回落成 1）→ `workspace rollback snapshot already exists`（`workspace.ts:1627-1636`） |

root 级（无 loop）tournament 同样报 `race/slot-0 was already cleaned` → **iteration 不是唯一触发条件**。

### B3. ⚠ 设计陷阱（最重要的一条）

**「把 iter-N 从 key 里删掉」是错的。** 同一轮 prompt 内 `iter-1` 会撞 `iter-0` 的 cleaned 记录（cleanup 在每个 tournament region 退出即执行）。iteration 必须留在 key 里做 **intra-pass 隔离**；要补的是 **job 维度**。正确动作是**加维度**，不是删维度。

### B4. 次要

`cli/trajectory.ts:101-109` 与 `evals/driver.ts:1004` 只在 invocationId **末尾**匹配 `iter-N` → map-in-loop（以 `slot-N` 结尾）丢 iteration 归因（仅展示/指标）。

---

## C. 设计

### C1. 骨架

> 每个写入方只写**一条 append-only stream**；所有可再生文件都是它的 **fold view**；重负载是不可变 **blob**。身份维度全进**记录字段**；磁盘只保留三类路径内容：sessionId（run 容器名）、job ordinal（`prompts/<job>/`）、blob 内人类可读标签。

**audience 规则（可测试）**：一行/一个文件只有一种角色。stream 只 append；fold 整体原子替换且必须等于 stream 折叠结果；blob 只增不改（`result.json` 例外，由 `trust` 字段显式标记）。

### C2. 目标 layout

```
~/.piano/runs/<sessionId>/                 # [M] session = run = 目录名，唯一 opaque id
├── progress.jsonl        [M] ONE ledger，唯一真相（7 种 kind）
├── progress.json         [H] fold view（可重建）
├── trajectory.jsonl      [H] run 叙事 stream
├── trajectory.json       [H] fold view（★ 写入全改 compact）
├── resume.jsonl          [M] actor 表 stream；P3 起读取优先 ledger 折叠
├── resume.json           [M] legacy 只读种子（永不改写）
├── log.jsonl             [H] 运维事件流（★ P3 起去 trace-namespace function.*）
├── trace.jsonl           [D] 唯一 debug span 视图（不变）
├── summary.json          [H] ★ P2：写侧紧凑行投影，两个 picker O(1) 读
├── contracts/<sha256>.json [M]（不变）
├── trajectories/         [F]（不变）
├── prompts/<job>/        [M] <job> = jobOrdinal
│   ├── invocations/<stageId>/<instanceId...>/
│   │   ├── handoff/record.json    [M] ★ 增 actorKey + result{path,sha256,trust}
│   │   ├── handoff-context/*.json [M]
│   │   ├── map-item.json          [M]
│   │   └── attempts/<k>/result.json [A] worker 手写（published contract，路径不变）
│   └── tournaments/<enc(instanceId+"/"+regionId)>/{baseline,slot-baselines}/** [M]
│                                    ★ create-once + `.complete` marker
├── actors/<harness>/<worker>/<lane>/session/*.jsonl  [H+A] lane 只含 map frame
├── workspaces/slots/<enc(key)>/  [M] ★ key = `job-<n>/<instanceId>` ← 唯一磁盘拼写变更
├── workspace-records/<enc(key)>/record.json  [M] ★ 同上；增 allocation provenance
└── .piano-consolidation-<txId>.*  [T]（不变）
```

### C3. 记录格式

**通用读者契约**（P1 落成代码+测试）：每类记录带 `version`，读者接受 `[1, current]`；**未知 `kind` 跳过、不得失败**；未声明字段读时忽略写时禁止（实验字段只进 `extra: {}`）；torn 末行跳过。

`progress.jsonl` 7 kind：`execution-started` / `stage-started` / `stage-accepted` / `execution-finished` / `job-closed`（沿用 branch）+ ★`region-finalized`（P1）+ ★`actor-turn`（P3）；`stage-started`/`stage-accepted` 增 `jobOrdinal`。

★ `region-finalized`（P1，region 退出恰好一次，与 stage-accepted 同一把 `progressSemaphore`）：
```
{version:1, kind, timestamp, executionId, jobOrdinal, instance, regionId, regionKind,
 outcome: carried|admitted-not-carried|no-winner|terminal-blocked|bound-iterations|bound-duration|feedback-stop,
 stopped, winnerKey?, winnerInstanceId?, incumbent?:{key,metric}, iterations?, blockedStageIds?}
```
`instance = runtimeRegionInstanceId(frames, region.id)`（写入/读取同一单点函数）。它把「region 是否结束、为何结束、赢家是谁、incumbent 指标」从推断变成证据。

★ `actor-turn`（P3）：`{kind, jobOrdinal, invocationId, attempt, actorKey, harness, worker, lane, sessionId, transcriptPath?, turn, continuation?}`。`continuation` 是 I2 指针，**禁止合成**。

### C4. 身份模型

| 维度 | 落点 | 规则 |
|---|---|---|
| session | `sessionId`（= run id = 目录名） | 任何代码不得从目录名/文件名解析；历史拼写 `run_id`/`runId`/`executionId` 是别名 |
| job | `jobOrdinal`（1-based，= 今天 promptIndex） | 字段 + `prompts/<job>/`；`nextJobOrdinal()` = `max(ledger 折叠, prompts/* 目录, legacyHint)+1` |
| invocation | `(stageId, instanceId, attempt)` | `instanceId` = frame 链；无 frame = 字段省略、路径写 `root` |
| attempt | `attempt`（1-based） | `attempts/<k>/` 只是叶子目录 |
| actor | `actorKey = v2/<sessionId>/<harness>/<worker>/<lane>` | **lane 只含 map frame**；跨 iteration/job/workflow 稳定 |
| iteration | `iteration`（0-based，**innermost loop frame**） | 存储 0-based、显示 1-based；`instanceId` 携带完整链 |
| trace | session 级 span 命名空间 id | 删 writer 的 `= runId` 默认值 |
| workspace | `key = job-<n>/<instanceId>` | 目录名仍 `encodeURIComponent(key)` |

**loop iteration vs continuing actor（Q3 答案）**：同一记录上的两个**正交维度**。`actorKey` = continuation 身份（drop loop frame → 一个 worker 一条连续对话）；`instanceId`/`iteration` = evidence 坐标（保留每次 iteration）。并列写在同一 `stage-accepted`，**禁止互相推导**。iteration 是 **orchestration coordinate**（进 workspace/tournament key 做 intra-pass 隔离），**不是** continuation segment。

### C5. loop 缺陷修复（L0–L3 + carry 三件套）

| | 改动 | 杀掉 |
|---|---|---|
| **L0** | job ordinal 分配源移到 ledger：`nextJobOrdinal()`。⚠ **branch 已部分落地**：`workflow-execution.ts:676` 现已是 `continueJob?.jobOrdinal ?? (execution?.promptIndex ?? 0) + 1`；剩余工作只是把 `execution?.promptIndex` 这个**回落源**换成从 ledger 折叠 / `prompts/*` 目录推导的 `nextJobOrdinal()` | B 的「promptIndex 回落成 1」 |
| **L1** | `mapSlotKey(jobOrdinal, frames)` → `` `job-${n}/${runtimeInstanceId(frames)}` ``；`allocateMapWorkspace` 加 `jobOrdinal` 参数（唯一生产调用点传 promptIndex） | A（already cleaned）与 A′（静默 rebind 脏目录） |
| **L2** | 新 `ensureWorkspaceSnapshot`：create-once + sibling `.complete` marker；partial 目录删除重拍并 loud log；`allocateMapWorkspace` 加显式意图 `recreateWhenSwept`（仅 continue 时置 true） | B 的重拍抛错 + 崩溃留下的 partial baseline 被静默复用 |
| **L3** | `region-finalized` 进 ledger + `/continue` **整段跳过** region（boundary 由共享纯投影器 `region-boundary.ts` 重建；incumbent 从记录恢复） | 重复 consolidation / 重复 selection 行 / incumbent 丢失 |

**为何必须整段跳过**：现 finalize 的 winner consolidation 是**一次 worker turn**（`consolidateAndGate`），重进时 `actorContexts` 为空 → `carry-failed` → `failTournamentWithPreservedSlots` → run 失败。

**carry 三件套（必须与 L1 同阶段）**：
1. **rebuild carry-context**：`rebuildAcceptedStage`（今 `stage-runner.ts:118`，调用点 `:245`）early-return 时不填 `actorContexts` → finalize 找不到 winner exit actor → carry-failed。修法：rebuild 路径重建 `ActorExecutionContext`（handoff record 增 `actorKey` 供身份；context 路径用与写函数相同的构造器重算，**不重写文件**），使 consolidation **恰好跑一次**。
2. **certified empty-delta**：空 changeSet 只有在 provenance 可证（`allocation === "fresh"` 或内容级比较为空）时才允许快路径，否则必须走 worker turn —— 堵「fresh copy 求差得空 → 静默记 carried」。
3. **already-applied 内容恢复**：把 `consolidation-transaction.ts` 的私有 `inspectGate` 提为导出 `inspectConsolidationGate`，关闭「consolidation 已提交、region-finalized 未落盘」崩溃窗口。

**/continue 的 workspace 复用语义**：pause **保留 active slots**（否则永远 rebind 不到半成品）→ 同 job 目录存活则 rebind（满足「重跑 stage 能看到已 accepted 前置 stage 的 workspace 状态」）→ 同 job 已被清扫仅在显式 continue 意图下 `recreateWhenSwept` → 新 job 恒 fresh copy。backstop 按 `job-<n>/` 前缀只清本 job。

**显式残余**：worker turn 执行中途崩溃（source 半改）仍 loud `carry-failed`，恢复 = `/restart`。修复前行为相同，非静默损坏。

### C6. `piano logs` 命令面（不废弃任何 flag）

- `piano logs` — picker 行元数据**先读 `summary.json`**，缺失回退现有链路；旧 tail 正则标 `@deprecated`
- `--trace` — 不变，现在名正言顺是唯一 debug 视图
- `--check <run-id>` — 调用不变；**progress 按 kind 分派校验**；新增 `view-stale` / `undeclared-field` / `ref-missing`
- ★ `--jobs [<run-id>]` / `--job <ordinal>` — job 作为 ledger 主要身份的**唯一人类读面**，只读 `progress.jsonl`
- ★ `--rebuild` — 从 stream 重建三个 view（`latestJob.state === "alive"` 时拒绝，`--force` 覆盖）

### C7. 记录锚点迁移（32 行表的要点）

| 锚点 | from → to | 阶段 |
|---|---|---|
| workspace key | `runtimeInstanceId(frames)` → `job-<n>/<instanceId>` | **P1** |
| tournament snapshot | 每次重拍 → `ensureWorkspaceSnapshot` create-once + marker | **P1** |
| handoff record | 增 `actorKey`（P1）+ `result{path,sha256,trust: worker\|orchestrator-materialized}`（P2） | P1/P2 |
| `attempts/<k>/result.json` | **路径不变**（published contract） | — |
| `iteration` 正则 | → 共享 `iterationOfInvocationId`（支持 map-in-loop） | P1 |
| dsh 会话候选名 | 增 `"session.v3.jsonl.zstd"` | **P0** |
| trajectory rename | `null,2` → compact | **P0** |
| static-analysis | progress 按 kind 校验 + trajectory 双形态 | **P0** |
| `log.jsonl` | P3 起去 `namespace:"trace"` 行（行格式不变） | P3 |
| `traceId` | 删 `= runId` 默认值 | P3 |
| stale 文档 | 顶部加一行「历史文档；布局以 README.md 为准」 | P3 |

### C8. 阶段

- **P0**（先于 P1）：dsh v3 文件名、rename compact、static-analysis 按 kind 分派 —— 都是 branch 现存真缺陷，且不修 P0-3 则新 run 的 `--check` 全线失败，任何结论不成立。
- **P1**（投诉 #2 在此死掉）：L0–L3 + carry 三件套 + pause-preserve + iteration 归一 + 旧 layout `/continue` **refuse**（`/restart` 照常；不回填、不重写旧证据）。
- **P2**（投诉 #1 的人类表面）：`summary.json` + `--jobs/--job` + `--rebuild` + view-stale + result ref。
- **P3**：log 去重、traceId、`actor-turn`、状态词表统一。
- **P4**（**标记 + 默认关闭**）：`trajectory.json` 停写、`executionId→sessionId`/`promptIndex→jobOrdinal` 改名、`resume.jsonl` 停 append。

---

## D. 未决 / 门控 / 范围外

**需开发者裁定**：① 落地分支与顺序（本设计叠在 lifecycle refactor 之上，而该 branch 仍在动）；② 旧 layout 是否要迁移工具 `piano migrate run-layout`；③ P4 三项触发时机；④ `summary.json` 采纳取舍；⑤ `log.jsonl` 去 trace 行的对外兼容窗口；⑥ `--rebuild` 并发守卫是否够；⑦ 旧 key workspace 记录是否要清理工具。

**独立真缺陷（默认不在 scope）**：
- **dsh 证据链静默死亡**：装机 dsh 写 `session.v3.jsonl.zstd`，`subprocess.ts` 只认 `["session.jsonl.zstd","session.jsonl"]` → `readDshSessionEvidence` 返回 undefined → canonical transcript 退化成 raw stdout markdown → `piano logs --check` 报 26 条 `transcript-invalid`。（**已修**，H1 `ae4037e`。）
- `ARCHITECTURE.txt` 与 `docs/workflow-trajectory-evaluation-prd.md` 的 `executions/<exec>/` 布局与磁盘完全不符。（**已标记**，`e5370c7`。）
- `workspace.applyWinnerWorkspace` / `recoverMapWorkspaces` 两个导出无运行时调用点。
- `piano logs` picker 在 pretty-printed `trajectory.json` 上静默退化成 id-only 行。（**已修**，H3 `7793a7e`。）

### D2. 测试面盲区审计（2026-10-15，对照真实装机工具逐项核验）

判据同 TASTE：fixture 不得照抄 reader 的假设。核验基准 = 盘上真实 dsh v3 artifact（8/8）+ 装机 dsh 0.1.5-rc.2 源码 + 装机 pi CLI 0.85.1 dist + codex 0.155.0 活体探针。

**确认的同类盲区（a 类）与处置**：
1. `dsh-resume-probe` fixture 写旧名 `session.jsonl` → **H2b 修复中**（改 `session.v3.jsonl` + header version 1→3）。
2. `fakeHarness` 默认分支是嵌合体：被 harness `"pi"` 的用例消费，却发 Anthropic 的 `content_block_delta` 和 pi 永不发的 `result`/`session_id` 帧（pi RPC 以 `agent_settled` 收尾，生产注释 subprocess.ts:1226-1231 自证）→ **H2b 修复中**（默认分支改忠实 pi RPC 方言；已确认删除的 `parses chunk-split…` 用例一并处理，其 sessionId 断言正来自幻影 result 帧；补一条真正钉住 stdout 半行重组的聚焦用例）。
3. **dsh v3 实时流已死（生产缺陷，非仅测试）**：真实 v3 文件实测 50 条 `assistant/message` 中 26 条把 packed `text-chunks` 嵌在 `data.stream`，顶层 packed 行 0 条；而 `expandDshStorageRecord`（subprocess.ts:417-459）只认 v0/v1 顶层形状 → 现装 dsh 下 TUI 回合中无任何增量文本。fixture（`dsh-stream`/`dsh-zstd-stream`）与 reader 共享 v0/v1 假设，同型盲区。→ **H2c 排队**，设计已定稿：
   - 实测成员普查（真实文件）：carrier 只有 `assistant/message`；成员 = `chunk`(390，block-start/end 边界，跳过)、`reasoning-chunks`(50)、`tool-call-chunks`(69，`id`/`name` 在成员级)、`text-chunks`(26)；成员形状 `{type, time0, index, dt, texts|args[, id, name]}` —— 无 `seq0`、无 `data` 包装。
   - 修法：`expandDshStorageRecord` 增前置分支——`data.stream` 为数组时返回 `[...expandedChunks, record]`（chunks 在父记录**之前**，delta 先动画、message_end 收尾）。新私有 `expandDshStreamMembers`：逐成员校验（同现有严格度：texts 全 string、dt.length === texts.length-1 且全有限数、index/time0 为数），坏成员跳过不丢父记录；`turn`/`step` 取父 `data`。chunk 形状复用现有 `text-delta`/`reasoning-delta`/`tool-call-delta` 构造（抽共享 builder，两路径一份实现）。
   - **合成 chunk 事件必须不带 `seq`**：`dshRecordKey`（:783-791）对带 seq 的记录用 `seq:N` 去重，同父展开会全撞一个 key 被吞；无 seq 落 JSON-key 分支，成员 time/text 各异自然唯一。mapper 的 `assistant/chunk` 分支（:679-712）不读 seq，安全。
   - 去重路径零改动：`emitAssistant → emitMessageEnd`（:1008 `lastMessageEndText`、:1379 判重）是 v0/v1 时代就有的 delta→message_end 序列防重复，v3 展开复用。
   - canonical-transcript 零影响：`dshMessageRecords`（canonical-transcript.ts:217）只映射 `assistant/message`/`user/message`/`tool/result`，合成 chunk 进 evidence events 也不入 transcript。
   - 红先测试：v3 形状 fixture（`assistant/message` + `data.stream` packed 成员）走既有 dsh-evidence 通道，断言 3 个 text delta + 恰好一个 message_end；保留 `dsh-stream`/`dsh-zstd-stream` 的 v0/v1 用例（盘上旧会话仍需可读）。**等 H2b 的 fixture agent 完成后再动**（同文件）。
4. `tests/fixtures/tournament-real-run/fake-agent.mjs`：发 pi-cli 永不发的 `result` 帧，usage 挂在幻影帧上（真实 pi-cli 只在 `message_end` 带 usage）；tournament 守卫的 per-turn usage delta 因此是 reader 形状依赖 → **H2d 排队**（usage 移回 `message_end`、删 result 帧，helpers.ts 守卫跟着改）。

**判定良性（b 类，不动）**：`pi-rpc-steer`/`pi-rpc-declined`（与 rpc-mode.js 逐字段对上）；claude-* 模式（有 live 观察记录 + gated e2e 兜底）；overlay 占位内容（生产 spawn 前只 `access()` 不解析，真实字节由 harness-home.test.ts 钉住）；`DSH_SESSION` 常量（与 8/8 真实 header 的 `session-<uuid>` 形状一致）；canonical-transcript.test.ts 的 dsh/pi fixture（与真实 v3 文件逐字段 diff 过）；events.test.ts（纯 Piano 内部词汇）。

**未定（c 类）**：codex fixture（活体探针超时，仅确认 `thread.started`/`turn.started` 与一个 fixture 未建模的顶层 `error` 记录）；claude stream-json（repo 内无真实 stdout 捕获）。→ **H2e 排队（低优先）**：各捕获一份真实 golden 进 `tests/fixtures/golden/`，把 c 类变成可 diff 的事实。repo 目前**零** golden 捕获，这是整个盲区类的存活条件。

**dsh-resume-runner.test.ts 的 HOST/STUBS**：经与装机 dsh 0.1.5-rc.2 typings/源码逐面核对为忠实镜像（b 类），gated e2e（`real-subprocess.e2e.test.ts:115-204`，同一 BLUE-HARBOR-77 种子）是漂移捕手。survey 提出的 4 条删除/放宽（P1-P4）**已经独立对抗验证全部成立**（无一构造出消费者可见回归），落于 `9333bb7`：P1 删 overlay-path 的精确拼写与 `agents.resume` 断言（`harness-home.test.ts:208/:216` 已钉同一字节）；P2 删 env-reference 字面量测试（运行时 resume 测试 + `harness-home.test.ts:218` 支配；coherent rename 下它本就不设防）；P3 删 no-steer-frames（与首条 resume 测试同场景，`{global:true}`/`listenersAfterExit` 无消费者：插件一进程一任务，runner 每帧查 `isLive()` 且 `whenIdle` 后无条件 `close()` 兜底）；P4 删 pre-arm buffering（reader attach 与 arm 在同一同步块，分支结构性不可达）。**显式决定**：P2 一并放弃了「源码无第二个形似名」正则（lint 性质，stale 别名无人读则无害、有人读则 resume 断言先红）。HOST 的 disposer plumbing 保留（ctx.on 返回 disposer 是真实 API 面，runner 会调用——保真而非死脚手架）；被删的是 `calls.*` 记录与 RunnerReport 字段。**遗留**：runner 的 pre-arm queue（`dsh-resume-runner.mjs:179/:204-208/:222-228`）成为无测试死代码，且文件头注释描述的 buffering 机制与实际送达路径（管道缓冲 + arm 后 live 路径）不符——生产侧改动属 piano-43 领地，待合并后统一处理。

**多 session 身份混淆（2026-10-15 晚，需在合并前厘清）**：`piano-4e` session 声称拥有本分支的 H1/H2b/H2c（`ae4037e`/`eddf31b`/`930d2a6`）与 H3（`7793a7e`），并把 §D2 称为「my working notes」；`piano-be` 也把 H3 归给 piano-4e。**事实**：`fix/evidence-read-chain` 上全部 14 个 commit 均由本 session（`piano logs 日志布局重构` [b6b0f6]）做出；`9333bb7`（P1-P4 批次）在 piano-4e 来信时刚提交，其「三文件 dirty 且是我的」描述与提交后状态不符。若 piano-4e 在并行执行同一 mission，属重复劳动，由开发者裁定归并。其 H2d「held」计划与我在跑的 H2d agent（tournament fixture）重复，已发信叫停。

### D3. 主 worktree 的第三方在制品（2026-10-15 观察到）

`workflow.ts`/`workflow-execution.ts`/`workflow-runtime.ts`（`buildWorkflowRuntimePlan` 改用 `stage.parentId`，删 `isDirectStageInScope`）+ `session-takeover`/`paper-writing`/`workflow-loop-map` 测试有**未提交的他方改动**（疑似 lifecycle 分支工作的移植）。与本稿的 hop 无文件冲突（H5 helper 在 workflow-runtime.ts 头部区域）。纪律：不碰、不提交、不回滚；门禁红时先归因（`git diff` 区分他方文件）。

---

## E. 实现前必做：锚点复验（重要）

branch 在本设计成稿后继续重构，**符号位置已漂移**（`workflow-execution.ts` 已被拆成 `stage-runner.ts` / `stage-runner-support.ts` / `artifact-paths.ts` / `execution-types.ts` / `execution-logs.ts` / `stage-prompt.ts` / `stage-metrics.ts` / `stage-validation.ts` 等）。已实测的新位置：

- `rebuildAcceptedStage` → `stage-runner.ts:118`（调用点 `:245`）
- `consolidateAndGate` → `workflow-execution.ts:557`
- `foldJobSpans`/`jobs`/`latestJob` → `job-spans.ts:85/:147/:163`（`JobSpan` 已含 `accepted: Set`、`attempts: Map` = cursor）
- `progressRecordKind` → `progress.ts:237-249`
- `runtimeInstanceId` → `workflow-runtime.ts:58`
- `mapSlotKey` → `workspace.ts:461/:469-486`；`allocateMapWorkspace` → `:634`
- `snapshotWorkspaceLstat` → `workspace.ts:1619`
- `tournamentSnapshotRoot` → `scope-walker.ts:799`（baseline 目录 `:806`）
- job ordinal 分配 → `workflow-execution.ts:676`

**开工前逐项复验签名与行号，差异记入任务描述；不要直接信任本文件的任何行号。**

**已确认的真实缺口**（非行号问题，可直接采信）：`progressRecordKind`（`progress.ts:237-249`）的 fallthrough 是 `return "stage-accepted"` —— **未知 kind 会被当成 stage-accepted 校验**，新增 `region-finalized`/`actor-turn` 前必须先改成「kind 缺失 → stage-accepted；已知 → 该 kind；未知 → `undefined`，调用方跳过」。

---

## F. 执行计划与进度（agent 自管 change + review）

2026-10-15 开发者授权：后续 change + review 由 agent 自己闭环，开发者不再参与 review。原则不变——小步、不破坏、每跳全量测试、每跳先清理自己相关的测试。

### F0. 依赖切分（决定了哪些跳现在能做）

主线（`chore/drop-teach-me-and-cap-commit-msg` 一线）**没有** lifecycle refactor 的任何成果：无 `job-spans`、无 cursor、无 `progress.jsonl` 的 kind 判别、`trajectory` 仍是单文档形态（无 `.jsonl` 流）。因此：

| 依赖 | 跳 |
|---|---|
| **不依赖** refactor，主线可做 | 读取链修复、测试面瘦身、trace_id 单一来源、iteration 共享 helper、audience 分离的 dual-read 步骤、workspace/tournament 碰撞修复（用 `promptIndex` 当 pass 维度） |
| **依赖** refactor | L0 的 ledger 折叠、`region-finalized`、`actor-turn`、job ordinal 语义、`/continue` 整段跳过 |

依赖项等 `worktree-lifecycle-refactor-dsf` 合入主线后再排，不阻塞前一类。

### F1. 跳次与状态

| 跳 | 内容 | 状态 |
|---|---|---|
| H1 | dsh session artifact 改按形状匹配；fixture 改用真实文件名 | ✅ 已应用（待提交，与 H2 同 commit）· 当时全量门禁 1468/23 与基线逐字相同 |
| H2 | 清理 H1 波及的测试面：删 2（递归 envelope 防御分支测试、`proxyPending` 内部态断言）· 放宽 4（codex argv 整数组→有序 indexOf、banner 序列 harness 标注 dsh→claude、dsh steer id 字面量→类型、pi steer id→比较式断言）· 合并 1 对（context-file/skill 缺资源，两 arm 都保留）· 修 `dshArguments` 注释重复 | ✅ 已应用（`subprocess.test.ts` 58→57，tsc/eslint/vitest 绿；待提交）· 对抗验证驳回了 3 处过激提议（`:425` onEvent 接缝、`:880` `--mode rpc` 值、`:363` 无序化），均已按验证结论保留 |
| H3 | `trajectory.json` 的 `/rename` 写 compact（与 `write()` 共用 `stringifyTrajectory`）；picker 测试改喂 pretty 字节保住该拼写覆盖 | ✅ 已提交 `7793a7e` · 模块门禁绿（tests/logging + logs-command + session-takeover 38/38） |
| H4 | `trace_id` 单一来源：删 `LogWriter`/`TraceWriter`/`Async*` 四处 `traceId = runId` 默认；doctor 两 probe 自铸 random hex；5 个测试文件补显式实参 | ✅ 已应用，模块门禁绿（typecheck 全仓 + 定向 126/126 + eslint）；提交被工具层临时阻塞，待重试 |
| H5 | iteration 共享 helper：`iterationOfInvocationId` 落 `workflow-runtime.ts`（parser 与 speller `runtimeInstanceId` 同址），barrel 导出；cli `loopIteration` 委托（名字保留）；`evals/driver.ts` 正则替换 | ✅ 已提交 `27d63eb` · 红先（map-in-loop 用例先红后绿）· 模块门禁绿（typecheck 全仓 + 19 文件/182 用例 + eslint） |
| H2b | fixture 方言修复（D2 的 1/2 项）：删幻影帧测试、pi 默认分支改 `agent_settled` 收尾、半行重组获独立聚焦用例、`dsh-resume-probe` 写 `session.v3.jsonl`、6 处 header version 1→3 | ✅ 已提交 `eddf31b` · tests/harness 235/235 |
| H2c | **dsh v3 实时流恢复**（生产缺陷，D2 第 3 项）：`expandDshStorageRecord` 增 `data.stream` 前置分支 + 共享 `dshChunkEvents` builder（v0/v1 与 v3 一份实现）；合成 chunk 不带 seq（`dshRecordKey` 的 `seq:N` 去重会吞掉整批）；新测试文件 `tests/harness/dsh-v3-stream.test.ts`（形状逐字段取自装机 dsh 0.1.5 真实 artifact） | ✅ 已提交 `930d2a6` · 红先（stash 生产改动后 5/5 红）· tests/harness 240/240 + tsc + eslint 绿 |
| H2d | tournament `fake-agent.mjs` 幻影 result 帧 → usage 移回 `message_end`（D2 第 4 项） | 🔄 agent 执行中 |
| H-doc | 本工作稿入库 `4726fb4`；`ARCHITECTURE.txt` 与 PRD §13 的 stale `executions/` 布局加历史标记 `e5370c7` | ✅ 已提交 |
| H6 | loop/pass 碰撞修复：workspace key 补 pass 维度 + tournament snapshot create-once + 完整性 marker | ⏸ **裁定：落在 lifecycle 分支基线，不在 main 做**。理由见 F4 |
| H7+ | audience 分离（`system-log/`、`sessions/`、`status.json`）的 dual-read 迁移 | ⏸ 同 H6：`session.ts`/`progress.ts`/`static-analysis.ts` 全是分支活跃区 |

### F2. 每跳的固定动作

1. 先审计并清理该跳波及的测试（判据见 `TASTE.md` 全局/品味）；
2. 改动本身；
3. 红先测试（能红就红，不能红要说明为何）；
4. 门禁：**模块级**（开发者 2026-10-15 裁定，本重构是模块化的，不跑全量）——`npm run typecheck` + `npx eslint <改动文件>` + `npx vitest run <受影响目录>`；报告受影响目录的用例计数，不用笼统的「绿」。全量 `npm test` 只在动共享数据结构（progress 记录形状、trajectory 文件形态）的跳次跑；
5. 能用真实盘上数据验证的，就用真实数据验证（如 H1 解了真实的 v3 文件）；
6. 在本节更新状态；单跳一个 commit（分支上，不推）。

### F3. 分支

`fix/evidence-read-chain`（从 `chore/drop-teach-me-and-cap-commit-msg` 切出，原名 `fix/dsh-session-artifact-name`，H3 提交时改名以承载整个 P0 批次）。开发者已授权自审自提（2026-10-15：「我后续不参与review了」），review 纪律照旧记录在 REVIEW.md/TASTE.md。

### F4. 与 lifecycle-refactor-dsf 分支的协调（2026-10-15 实测）

- 分支**活跃且锁定**：tip 当日从 `460a9dc` 推进到 `5eadd57`（另一 session 在提交）。
- 分支已自行落地我 P0 清单的一项：`421d1d1` "Validate the progress stream by record kind"（= static-analysis/progressRecordKind 按 kind 分派）；`a18904c` "Read a run from either of its trajectory paths"（trajectory dual-read）与 H3 相邻。**合并时 H3 可能与 a18904c 在 trajectory.ts 冲突——两边意图一致（单一 serializer/双读），解法取并集。**
- 分支**尚未**做 H6：`mapSlotKey(frames)` 无 pass 维度（branch workspace.ts:461），`region-finalized`/`ensureWorkspaceSnapshot`/`nextJobOrdinal` 均不存在。
- **裁定**：H6/H7+ 等分支合并（或按 memory 的 handoff protocol 移交）后，以分支基线执行本稿 §C5 的 L0–L3；不在 main 上重复实现——main 版会是抛弃型工作且与分支的模块拆分（`scope-walker.ts`/`stage-runner.ts`）结构性冲突。
- 本分支（`fix/evidence-read-chain`，6 commits）合并回 main 或 rebase 到分支时的预期冲突面：`trajectory.ts`（H3 vs a18904c）、`workflow-runtime.ts`（H5 纯新增，应干净）、其余无重叠。

### F5. 跨 session 协调（2026-10-15，开发者裁定：考虑合并，两 session 直接沟通，共享本文件为 status record）

- 邻居 session `lifecycle-refactor-dsf-velvet-corbato` 主动来同步：它正在做 **status.json 统一**（删 `progress.json`/`trajectory.json`/`resume.json` 三个派生视图）——与开发者第 3 点及本稿 H7 设计同向；当时未动实现，只在收集状态。
- 我已回发完整 status sync：所有权清单、目标、合并前提。**合并前提三项**：(a) 主 worktree 里未提交的 `parentId` 重构（`workflow.ts`/`workflow-execution.ts`/`workflow-runtime.ts` + 3 测试）归属确认并落库——`workflow-runtime.ts` 在合并面上，不落地 git 会拒绝合并；(b) 分支冻结点；(c) `trajectory.ts` 冲突一次解清（方向取它的 status.json 结构，保留单一 serializer 原则）。
- 实测冲突面（merge-base `fcaabbf`）：仅 5 文件 —— `evals/driver.ts`、`logging/trajectory.ts`、`orchestrator/index.ts`、`orchestrator/workflow-runtime.ts`、`tests/cli/logs-command.test.ts`，全部意图收敛型。
- 已提醒它：删 `trajectory.json` 文档时，`piano logs` picker 与 session-picker 的 tail 读取必须同一改动里切到 status.json 投影，否则静默退化成 id-only 行（本批次一直在杀的那类病）。
- **合并执行序（提案，署名 `piano logs 日志布局重构` [b6b0f6]，即本工作稿的作者 session；非 piano-4e，非任何他人的承诺）**：piano-be 落库 → 由 [b6b0f6] 在 `fix/evidence-read-chain` 执行 merge `cc92410` → 解 5 文件 → **全量** `npm test`（共享数据结构变更，按 F2 规则升格）→ 报开发者。**状态：PREPARED，未执行** —— 邻居 session 依 PF1 提请：40+ commit 的合并属 scope-changing，须开发者亲口 go 并点名执行分支后才动（本行即响应，见 F5.2）。

**F5.1 协调落定（2026-10-15 晚，三方消息往返后）**
- **G1 裁定（邻居 session 携开发者原话）**：`status.json` **取代**（不是并存）三个 fold 视图——`progress.json`/`trajectory.json`/`resume.json` 删除；`progress.jsonl` 等 append-only ledger 保留为证据与折叠源。「ignore historical compatibility, do it straightly; before delete, review all references」。我的 H3（`7793a7e`）与邻居的 `a18904c` 均被此裁定反转，按 G4 必须写进 PR 描述。
- **parentId WIP 归属确认**：`piano-be` session（同一主 worktree、同一分支上未提交的 `workflow.ts`/`workflow-runtime.ts`/`workflow-execution.ts` 3 处 + 3 测试；`regionPath: readonly string[]` → `parentId?: string`，删 `isDirectStageInScope`）。已要求其**先落库再合并**（`workflow-runtime.ts` 在合并面上，git 会拒绝带脏合并）；合并后其 3 处执行侧站点需按分支拆分后的新家重锚（`workflowProgressPlan/Projection` → `stage-runner-support.ts`）。
- **事故记录（我的）**：H3 探针把 pretty-bytes 留在了 picker 测试里并被提交（`7793a7e` 红），由 piano-43 发现、piano-be 询问后认领；修复 `d182881`（picker 测试回到 compact 现实；H3 的真守卫移到 `logging.test.ts` rename 测试的单行字节断言）。教训：**探针改动要么还原要么转正，不能带着中间态提交**；且当跳门禁必须覆盖被改测试文件本身。
- **合并执行序**（邻居冻结于 `cc92410`，全量 1542 绿）：piano-be 落库 → 我 merge `cc92410` 进本分支 → 5 文件按「trajectory.ts 取邻居方向（document 删除，stream 保留单一 serializer 原则）、logs-command.test.ts 取其 status.json 契约版」解 → 全量门禁 → 报告。
- **合并后分工提案（待邻居确认）**：它 = `session-resume`/`session-picker`/`static-analysis`/三个 writer 的 G1 收口；我 = evals 三件（driver/trajectory-evaluator/legacy-run-adapter）+ README/headless 外部契约文本 + **H6**（§C5 的 L0–L3，在其 cursor 之上）。
- **status.json 硬约束（邻居的血泪教训，进 §C 同级）**：写入 `status.json` 的一切必须 JSON-shaped——`ReadonlySet`/`ReadonlyMap` 经 `JSON.stringify` 静默变 `{}`，曾清空 `/continue` cursor 挂死 `continue-restart-arc`。`RunJob` 用 `accepted: string[]` / `attempts: Record<string, number>`；fixture 一律经 `runStatusFromParts` 构造以钉住 round-trip。
- `progressRecordKind` 未知 kind 落 `"stage-accepted"` 的缺口归邻居修（其 `421d1d1` 依赖该 fallthrough），在 `region-finalized`/`actor-turn` 之前必须落；我侧 H5 不新增 kind，无排序冲突。
- 另有 `piano-43` session 在做 `packages/harness/src` 模块化（branch `refactor/harness-module`，base 我的 `595c51e`，P1 已落 `04034e4`）；我的 H2c 与其 P2 有潜在交叠，合并后由它 rebase。

**F5.2 身份澄清与邻居的两处事实更正（2026-10-15 晚）**
- **身份**：`7793a7e`（H3）、`d182881`（红测试修复）、本工作稿及其 §F5 均出自 [b6b0f6]（本 session），**不是 piano-4e**。piano-be 与邻居此前把 H3 归给 piano-4e，已在回信中更正。16:40:01 落在 `logs-command.test.ts` 的「无主编辑」= 我的 `d182881`。
- **更正 1（邻居审计）**：「trajectory.json 是最大字节冗余」的说法**测量来源错误**——样本 run `20261014T080442-963057` 根本没有 `trajectory.jsonl`（main 的 document-only writer 产物），它只证明文档体积，不证明 stream-vs-document 重复。`message_end` 事件的真实第二副本是 **`actors/` harness 转录**；`log.jsonl` 的 `agent.event.received` 行只带 `role`/`textLength`（≤521B/行），不是冗余主体。本稿 §A 无此错误主张（已 grep 核对），记录在此防止它再流通。
- **更正 2（邻居审计）**：`trajectory.json` 的写入**非原子**（`trajectory.ts:724` 裸 `writeFileString`；`progress.json`/`status.json` 均原子）——读侧可自愈，但 `jq`/外部监控会看到撕裂。处置：G1 裁定下文档整体删除，此缺陷随之消失，**不单独立项修**。
- **P4 归并**：我原 P4 的「trajectory.json 停写（flag 门控）」与 G1 的「直接删除」是**同一步**——P4 该项撤销，由邻居的删除序（reads → writes → helpers → external contract）承接，PR 文本按 G4 写明三项反转（我的 H3、邻居的 `a18904c`、此前的 write-stop NO 建议）。
- **邻居的 picker 警示已收**：其分支上 `logs.ts` 的 145 行 tail-scan 已删、`readRunRowMetadata(runDir)` 只读 `status.json`；合并时 `logs-command.test.ts` 取其重写版，我的 `d182881` 该半自然作废（logging.test.ts 的 rename 单行守卫保留至 G1 step 2 删文档时一并消失）。

**F5.3 合并落地与 status-close 收口（2026-10-15 晚）**
- **合并完成**（邻居执行，报告在手）：`main = 6619b4d`，全量 **1542/0**。`350952e` 合入 lifecycle（cc92410, 53 commit），`6619b4d` 合入我的分支尖（f51dfc8 + piano-be 的 c0767a4 一并）。5 文件如预测：`trajectory.ts` / `logs-command.test.ts` 取邻居方向（H3 的 read-merge-rewrite 被 append-化取代，单一 serializer 原则在 `writeTrajectoryDocument` 存续）；**预测外多一个冲突**：`workflow-execution.ts`（c0767a4 的 hunk × 分解）——邻居把 piano-be 的执行侧 hunk 从该文件弃用并**移植进 `stage-runner-support.ts`**（新家），piano-be 复核中。
- **930d2a6 需移植而非合并**：我与邻居各自用 `git merge-base --is-ancestor` 独立确认它不在 piano-43 的 base `595c51e` 里（其尖 `9f86994` 仍缺）。已发信要求 piano-43 把 v3 `data.stream` 展开**移植**进其新模块（`dsh-session-storage.ts`），保留 `expandDshStorageRecord` 的导出并把 `tests/harness/dsh-v3-stream.test.ts` 的 import 重指；合成 chunk 无 seq、共享 `dshChunkEvents` builder 两条约束随信附上。
- **flake 归因**：`tests/cli/continue-restart-arc.test.ts` 在并行负载下 15s 超时（复现 2 次），单独跑 357ms 绿；邻居亦报告合并后 2 次超时 + 3 次通过、且合并前已 flake 过一次 → 记为 **pre-existing 负载敏感**，非合并缺陷，未修（非本跳）。
- **status-close-evals 分支**（我，off main @6619b4d，2 commits）：evals 三件 + headless + TUI 载体全部收口到 `status.json`——`CaseResult` 新增 `runStatusPath`/`runStatus`（`status` 名被 case 状态枚举占用，tsc 抓到的真冲突）；`trajectoryPath` 指流；legacy adapter 读 `trajectory.jsonl` 记录（逐事件校验，消息措辞随迁）；tick/报告读状态文档；headless 发 `status_path`（替代 `progress_snapshot_path`，外部契约变更，PR 写明）。**跨了邻居分工一处**：session-run 的同一映射对象同时喂 headless 与 TUI takeover（tui.ts:976），拆开改会让一侧静默丢字段，故 TUI 载体一并改名（`statusPath`），已函告邻居。全量门禁 **1543/0**（144 文件）。
- 测试面：5 个 CLI 测试的 orchestrator mock 工厂补 `runStatusPath`（枚举式 mock 随每次新 import 漂移——第 2 次同类断点，refreshRunStatus 是第 1 次）；driver-association/driver-workspace 的 snapshot fixture 改写真 status.json（含 version/runId/status 字段）；workflow-evaluator 的 legacy fixture 改流记录形状。
- 待办：邻居释放 main → 我 ff 合入 status-close-evals → main 全量门禁 → 汇报；此后我的分工余量 = README 契约文本 + H6。

**F5.4 H6a 落地与合并收口（2026-10-15 深夜）**
- **main 行进**：`6619b4d` →（邻居按 piano-43 请求 ff）`b337c0f`（harness 模块拆分 + `930d2a6` 的 v3 port 入 `dsh-session-storage.ts`，拆分为 `subprocess-events.ts`/`harness-argv.ts`/`child-process.ts`/`dsh-session-events.ts`/`event-metadata.ts`/`portable-events.ts`/`agent-contract.ts`/`json-narrowing.ts`）→ **`61daca3` = Merge branch 'status-close-evals'**（普通 merge，零冲突，24 文件）。
- **H6a 内容**（`ec760aa`，设计 L1+L2）：`mapSlotKey(jobOrdinal, frames)` = `job-<n>/<instanceId>`，贯穿 workspace path/record；`allocateMapWorkspace` 增 `jobOrdinal` 参数与 `options.recreateWhenSwept`（仅 `request.continueJob !== undefined` 时由 scope-walker 传 true；cleaned 一律大声，除非显式 continue）；record 增 `allocation: fresh | rebound | recreated-after-sweep` provenance；新 `ensureWorkspaceSnapshot`（create-once + sibling `.complete` merge marker，partial 重拍；marker 不放 snapshot 内以免污染内容比较）替换 scope-walker 两处 `snapshotWorkspaceContent`（region baseline + slot baselines）。
- **可见后果（进 PR 文本）**：winnerKey 及由其派生的 consolidation stage id 现在是 `$consolidate/job-<n>/<region>/<slot-N>`（原 `$consolidate/<region>/<slot-N>`）——裁定保持（G2：一个 key 一种拼写，层间不改写）；`selection.jsonl` 的 winnerKey、路径 `slots/job-1%2F...` 同步变化。`instanceId`（frame 身份）不变。
- **测试面**：workspace.test.ts 24 处调用点补 jobOrdinal 参数（脚本化，括号切片保证边界）；workflow-execution.test.ts 6 处断言（workspace.key/winnerKey/`$consolidate` 字面量）随迁；`real-consolidation.e2e` 中 `winnerKey toBe("race/slot-1")`（gated，未跑）留待其下次运行时更新。H6a 模块门禁 147/147 + tsc + eslint 绿。
- **hunk 级暂存技巧（复用价值高）**：piano-be 的在制品（`scheduleWorkflow` 删除）与我的改动同文件（workflow-execution.test.ts）未提交；用 `git apply --cached` + 过滤掉含 `scheduleWorkflow` 的 hunk 的补丁，把我的 6 个 hunk 精确入库、他们的 1 个留在工作区；切分支时用 `git stash push -- <file>` 单独暂存他们的 hunk、merge 后 pop 还原。全程未碰其文件、未卷入其改动。
- **钢琴-be 争议红定位**：其报告的「6619b4d 红、headless-json 发 status_path」实为**测量了我的脏工作树**（该行为我当时未提交）；邻居在干净树复核 41/41 绿 + `git grep status_path 6619b4d` = 0 命中。裁决性数字 = 本段之后在 `61daca3` 上的全量门禁。
- **遗留（我的分工余量）**：README 契约文本（`status_path`、`trajectory_path` 指向 `.jsonl`、`progress_snapshot_path` 移除）；H6b（`region-finalized` + `/continue` 整段跳过）待邻居的 `progressRecordKind` 未知 kind 修复先落。

**F5.5 H6b 执行记录（2026-10-15 深夜，隔离 worktree `.claude/worktrees/piano-logs-jobs` / `feat/piano-logs-jobs`）**
- 迁移：主 worktree 交还他方（piano-be 的 WIP 与开发者文件留守）；本 session 的全部新工作在独立 worktree，`npm ci` 装依赖后门禁自足。
- **H6b-a（`f436ad9`，已 rebase 到 `4231fd1`）**：pause 保留槽位（exit 分类 → `pausedExit` → backstop `preserve`），backstop 增 `keyPrefix: job-<n>/` 只清本 job；`cleanupMapWorkspaces` 增 `keyPrefix` 选项。红先双证：双 job 单测（移开实现 → 红）+ `Fiber.interrupt` 集成测试（旧实现记录为 `cleaned`，新实现 `preserved`）。**已知残余**：被 `/restart` 关闭的 paused job 的 preserved 槽位无清扫者（磁盘残留，正确性无影响）——记入待办。
- **H6b-b1（本跳）**：`region-finalized` 记录落地——`progress.ts` 新类型 + kind 判别 + fold（metadata-only：仅推进 updatedAt）+ `appendWorkflowProgress` 参数放宽；`job-spans.ts` 的 `JobSpan/JobView.regions`（跨 span 聚合、同 instance 后写 wins；**cursor 不受影响**——这正是邻居 `4231fd1` 的 skip 性质所保障的）；`workflow-runtime.ts` 新 `runtimeRegionInstanceId`（写入/读取同一拼写，`root/<region>` 与 invocation instanceId 可直接 join）；scope-walker 在 map 单出口 + loop 三出口（inherited-blocked / iteration-terminal / 汇聚出口携带 `bound` 局部：bound-iterations|bound-duration|feedback-stop）各写一次；`TournamentFinalization` 增 outcome/notCarriedReason（空 candidates 不写，carry-failed 不写——run 已失败）。集成断言挂在既有 carried tournament 测试上（`{instance:"root/race", outcome:"carried", winnerKey:"job-1/race/slot-1", winnerInstanceId:"root/race/slot-1"}`）。红先：移开 progress/job-spans 实现 → 2 测试红。邻居的「未知 kind」测试样本同步改为 `actor-turn`（`region-finalized` 已进入已知集）。
- **H6b-b2（下一跳）**：`/continue` 的 region 整段跳过——入口查 `continueJob.regions`、以 handoff 重建 boundary（共享纯投影器）、incumbent 恢复、carry-context 重建（design §C5 的 carry 三件套）。

