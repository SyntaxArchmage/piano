# PIANO 调优工作流改进提案集 — 索引

本目录是 2026-09-11 的调研产物：把**近期算子调优（GPU kernel / operator tuning）的论文与方案**与
PIANO 现有工作流逐维度对照，按**模块**拆成 7 篇文档，每篇独立可读，讲清"这个模块该往哪改、为什么、
落在哪个文件、有什么风险"。

## 0. 先澄清一个命名

仓库里**不存在** `topsop-tuning-tournament`。实际有两类可比的流：

| 流 | 文件 | 形状 |
|---|---|---|
| 顺序单变量调优 | `recipes/workflows/topsop-tuning.yml` | 8 轮，每轮 `profile → idea → implement → verify → measure`，measure 出 `KEEP/DISCARD/CONVERGED` |
| 锦标赛调优（本提案集主体） | `recipes/workflows/gpu-cuda-tuning-tournament.yml` | 10 轮，每轮 `profile → idea` 出 3 个策略 → `race` 3 条 lane 并发 → 单一 metric 裁判选 winner |

顺序版在"停机判据 / roofline 引导 / asm 证据"上比锦标赛版更成熟（见 `04`、`01`-M6）；
锦标赛版在"并发候选 + 自动裁判"上更强。两边的能力互有缺口，这正是提案的主要来源。

## 1. 术语速查

| 词 | 在 PIANO 里的意思 |
|---|---|
| **lane / branch / slot** | 锦标赛的一条并行分支，每个 lane 一个独立 workspace（git worktree 或目录快照） |
| **referee / 裁判** | region **exit stage** 契约声明的唯一 metric；2 个及以上视为 load 期 validate error |
| **admission / 准入** | 跨轮闸门：候选必须**严格改进同一 metric 身份**才被 carry，否则 `admitted-not-carried` |
| **carry / consolidation** | 引擎只排序；由 winner **自己的 worker** 在父 scope 应用冻结 delta，引擎只做一次只读 diff gate |
| **referee 身份** | `name + unit + direction` 三元组；身份变了直接拒（`metric-identity-changed`） |
| **SOL** | Speed-of-Light，硬件理论上限（roofline）。`topsop-theory` 已在算，CUDA 锦标赛还没有 |

## 2. PIANO 基线（对照基准，全部有代码证据）

| 环节 | 现状 | 证据 |
|---|---|---|
| 候选来源 | `idea` 一次产出 `strategies[]`，`minItems: 3`，固定 `count: 3` | `recipes/cuda-idea-tournament/contract.json` |
| lane 并发 | `parallel` 默认 true，并发度 **`"unbounded"`** | `workflow-execution.ts:3591` |
| 裁判 | 单 metric `best`，按 `direction`；tie 先按 fan index，再按 `changedFiles`/`changedLoc` | `packages/orchestrator/src/selection.ts` |
| 跨轮闸门 | 严格改进，否则 `admitted-not-carried` | `admitWinner()` |
| 亚军信息 | `selectWinner` 算出 `runnerUpKeys`，**运行时硬写成 `[]`** | `workflow-execution.ts:3219` |
| 败者证据 | `selection.jsonl` 落盘，**生产代码零消费者**（只有测试读） | 全仓 grep |
| 败者产物 | region 退出后 `cleanupMapWorkspaces` 删除所有 slot workspace | `workflow-execution.ts` |
| 轮间传递 | 下一轮 `profile` 只拿到 **winner 的 terminal result group** | `workflow-execution.ts:3457-3465`；PRD §5.1 有意如此 |
| 测量 | 每 lane 单次采样；3 条 lane 默认**同时**在同一张 GPU 上跑 benchmark | 同上 + `docs/WORKLOG-TOURNAMENT-2026-09-04.md` 的现场记录 |
| 成本记录 | `token-usage.jsonl` / `duration.jsonl` 全量落盘（**强项**） | `packages/trajectory/src/recorders.ts` |
| 归并严谨 | 引擎只排序 + worker 自归并 + 只读 gate + 事务保护 Git 元数据（**强项，文献少见**） | `docs/map-winnow-selection-prd.md` §6 |
| 停机 | 固定 `iterations: 10` | 工作流 YAML |

### 2.1 不要动的部分（设计不变量）

这些是 PRD 明确裁定或工程上必要的，本提案集**不主张**修改：

1. **单 metric 裁判**（`exit` 契约 2+ metric = load 期报错）。多目标诉求走"约束"而非"第二 metric"，见 `01`-M5。
2. **引擎不 merge**：排序是纯函数，归并是 worker 行为，引擎只做只读 gate。
3. **契约快照 + digest 校验**：可复现性的地基。
4. **`progress.jsonl` 为 append-only 证据源**，`progress.json` 只是投影。

## 3. 文档地图

| 文档 | 模块 | 核心问题 | 落点层级 |
|---|---|---|---|
| [`00-research-survey-transcript.md`](00-research-survey-transcript.md) | **调研原始记录（逐字存档）** | 结论是怎么来的 | — |
| [`01-referee-and-measurement.md`](01-referee-and-measurement.md) | 裁判与测量保真 | 在抖动下问得出可信结论 | 契约 / prompt / `selection.ts` |
| [`02-evidence-memory.md`](02-evidence-memory.md) | 证据记忆与跨轮复用 | 别每轮从零再想 | 契约 / DSL / 引擎 |
| [`03-search-topology.md`](03-search-topology.md) | 搜索拓扑与候选管理 | 搜索的形状本身 | DSL / 引擎 / recipe |
| [`04-budget-and-stopping.md`](04-budget-and-stopping.md) | 预算、保真度分级与停机 | 什么时候停、先验谁便宜 | 契约 / DSL / recipe |
| [`05-evaluation-integrity.md`](05-evaluation-integrity.md) | 评测完整性与泛化 | 分数是不是真的 | 评测设定 / case 契约 |
| [`06-resource-scheduling.md`](06-resource-scheduling.md) | 资源调度与并发 | 别让并发污染测量 | DSL / 调度器 |
| [`07-prompt-skill-evolution.md`](07-prompt-skill-evolution.md) | Prompt/skill 自演化 | 知识能不能自己长 | recipe / 离线流程 |

### 3.1 建议阅读路径

- **只想快速动手**：`01` → `04` → `02`。
- **想理解为什么**：先读本文件的 §2，再读 `01`-§2（关键洞察）。
- **要评估工作量**：每篇文档的最后一节「落地顺序与验收」。
- **想回溯原始调研**：`00`（逐字存档，含最初的 A/B/C 分档与维度对比表）。

### 3.2 原始记录的 A/B/C 分档 → 模块文档编号

`00` 是首次调研时的原始归档，用 A/B/C 分档；本目录的模块文档把它重组为 `NN-Mn`。
两条编号的对应关系（便于交叉查阅）：

| 原始 | 含义 | 模块文档 |
|---|---|---|
| A1 | 裁判抗噪（重复采样 + 噪声带） | `01`-M1/M2 |
| A2 | 败者证据回流 | `02`-M1/M2 |
| A3 | 轮内汇总 + 停滞检测（`aggregate` 节点） | `04`-M3 |
| A4 | advisor / reference 密度 | `07`-M1 |
| B1 | 测量串行化 / 资源互斥 | `06`-M1/M2 |
| B2 | archive / population | `03`-M1/M2/M3 |
| B3 | 多目标（作为约束） | `01`-M5、`05`-M3 |
| B4 | SOL 迁移 | `04`-M4 |
| B5 | 反作弊与泛化评测 | `05`-M1/M2/M5 |
| C1 | 实现空间选择 | `03`-M5（第 3 维） |
| C2 | prompt/skill 自演化 | `07`-M2/M3/M4 |
| C3 | 代理模型 / 多保真度 | `04`-M5、`04`-M1 |

## 4. 按"风险 × 收益"排的总优先级

| 优先级 | 事项 | 文档 | 为什么排这里 |
|---|---|---|---|
| **P0** | 测量重复采样 + 噪声带判据 | `01`-M1/M2 | 直接决定每轮决策对不对；当前架构性缺陷 |
| **P0** | plateau 检测 + `aggregate` 节点 + `CONVERGED` | `04`-M3 | 纯 DSL 可做，不动引擎；补齐与 topsop 流的能力差 |
| **P1** | 败者 lane 摘要回流下一轮 | `02`-M1 | 已有 `selection.jsonl` 却没消费者，属"便宜的大收益" |
| **P1** | 预算口径 + 保真度分级 | `04`-M1/M6 | 决定长跑成本能不能控 |
| **P1** | 反作弊与 held-out 评测设定 | `05` | 决定"我们证明的是不是真的" |
| **P2** | 资源互斥（implement 并发 / measure 串行） | `06` | 需新 DSL 概念；先用现有 serial 臂量化损失 |
| **P2** | archive / 亚军保种 / 组合叠加 | `03`-M1/M2 | 依赖 `02`；收益大但要改裁判语义 |
| **P3** | SOL 引导 | `04`-M4 | CUDA 侧缺硬件计数器时需 fallback |
| **P3** | 抽象层 / 实现空间选择 | `03`-M5 | 与 case 契约"必须纯自定义 kernel"冲突，需先定评测定位 |
| **P4** | prompt/skill 自演化 | `07` | 工程量大、收益不稳，先记账 |

## 5. 文献总表（本提案集引用的全部工作）

| 简称 | arXiv | 用在哪 |
|---|---|---|
| KernelArc | 2608.17071 | `03`、`04` |
| Kernel-Smith | 2603.28342 | `03` |
| Kernel Foundry / KernelFoundry | 2605.30359 / 2603.12440 | `03`、`04` |
| KOPE | 2608.25570 | `02` |
| Trellis / KernelEvolve | 2606.29823 | `02` |
| HTAM | 2605.29734 | `02` |
| AdaExplore | 2604.16625 | `02`、`03` |
| EvoMem | 2608.10795 | `02`、`07` |
| daVinci-kernel | 2606.16497 | `02`、`07` |
| KernelSkill | 2603.10085 | `02` |
| SkillEvolver | 2605.10500 | `07` |
| EFT（Evolution Fine-Tuning） | 2606.29082 | `07` |
| KernelBrain | 2608.02611 | `04` |
| GPU Forecasters | 2605.31464 | `04` |
| SpecGen | 2606.17518 | `03`、`06` |
| μCUTLASS + SOL 引导 | 2603.29010 | `04`、`05` |
| SOLAR | 2606.26383 | `04` |
| SOL-ExecBench | 2603.19173 | `01`、`04`、`05` |
| hacker-fixer loop | 2606.08960 | `05` |
| KernelBench-Verified | 2607.16241 | `05`、`01` |
| The Correctness Illusion | 2606.20128 | `05` |
| Gaming Without an Attacker | 2608.08722 | `05` |
| AgentKernelArena | 2605.16819 | `05` |
| Atrex-Bench / AKA | 2607.14541 | `04`、`05` |
| ForgeStencil | 2609.06694 | `01`、`05` |
| Taming Bitwise Behavior | 2609.11356 | `01` |
| Argus（data-flow invariants） | 2604.18616 | `03` |
| AsmEvo | 2608.20711 | `01` |
| Harness Engineering | 2607.17979 | `07` |
| Agentic Kernel Optimization / Houmao | 2608.14560 | `07` |
| Correct but Slow | 2607.04454 | `01` |
| HIERA | 2608.21157 | `03` |
| CuTeGen | 2604.01489 | `03` |
| FACT | 2604.26666 | `03` |
| MKEvolve | 2607.20501 | `03` |
| CUDA-L1 / CUDA-L2 | 2507.14111 / 2512.02551 | `03` |
| AlphaLab | 2604.08590 | `03` |
| POLCA | 2603.14769 | `03` |
| AutoLab | 2606.05080 | `04` |
| KernelPro | 2606.26453 | `01` |
| EGG | 2606.26758 | `07` |

## 6. 已完成 / 在飞的相关工作

写文档时已核实的现状，避免与提案撞车：

| 事项 | 状态 | 位置 |
|---|---|---|
| lane 级模型异构（`stage.model` 支持列表，按 lane 索引，长度必须等于 `count`） | **在飞**，未合 main | 分支 `feat/tournament-slot-models`，commit `1a34f6a`「feat(orchestrator): pin one model per tournament lane」；实验工作流 `recipes/workflows/gpu-cuda-tuning-tournament-mixed.yml` |
| 顺序 / 并行 A/B 对照臂 | 已完成 | `recipes/workflows/gpu-cuda-tuning-tournament-serial.yml`（`parallel: false`） |
| 校验容差放宽（16-ULP → 1e-4 relative + 边界规范化） | 已合 main | `9cbaa2f`，先例见 `01`-M4 |
| median/best 派生量必须由 samples 精确重算 | 已合 main | `48d2f15` |
| 并行 run 的 live-progress 归属修正 | 已合 main | `3a8d1c3` |

> 注：`feat/tournament-slot-models` 的 `stage.model` 列表语义是本提案集 `03`-M5 的**基础设施**，
> 提案在其上继续（思路异构、抽象层异构），不重复实现模型异构。
