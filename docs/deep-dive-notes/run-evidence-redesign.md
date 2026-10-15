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
- **dsh 证据链静默死亡**：装机 dsh 写 `session.v3.jsonl.zstd`，`subprocess.ts` 只认 `["session.jsonl.zstd","session.jsonl"]` → `readDshSessionEvidence` 返回 undefined → canonical transcript 退化成 raw stdout markdown → `piano logs --check` 报 26 条 `transcript-invalid`。（P0 已含一行修复。）
- `ARCHITECTURE.txt` 与 `docs/workflow-trajectory-evaluation-prd.md` 的 `executions/<exec>/` 布局与磁盘完全不符。
- `workspace.applyWinnerWorkspace` / `recoverMapWorkspaces` 两个导出无运行时调用点。
- `piano logs` picker 在 pretty-printed `trajectory.json` 上静默退化成 id-only 行（P0 含）。

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

