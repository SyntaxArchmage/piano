# 02 — 证据记忆与跨轮复用

## 0. 这个模块是什么

"证据记忆"指的是：**把已经花掉的算力和 token 换来的结论沉淀下来，让下一轮（乃至下一次 run）
不必从零重推**。

在 PIANO 里，证据记忆分三层，现状差异很大：

| 层 | 现状 | 消费者 |
|---|---|---|
| **轮内 lane 证据** | `selection.jsonl` 记录每条 lane 的 referee / winnerKey / carrying reason | **没有生产消费者**（只有测试和文档读） |
| **轮间传递** | loop `feedback: race` → 下一轮 `entry`（`profile`）拿到 **winner 的 terminal result group** | 有，但只有 winner |
| **跨 run** | 无 | 无 |

关键文件：`packages/trajectory/src/recorders.ts`（recorder 定义）、
`packages/orchestrator/src/workflow-execution.ts`（`selection` observation 的发射点）。

## 1. 它用来干嘛

回答一个问题：**上一轮那三条 lane 的探索，除了"谁赢了"，还告诉了我们什么？**

具体收益有三类：

1. **不要重复失败**——"A 方案在第 3 轮已经试过且更慢"这件事，如果下一轮 idea 不知道，
   它会再提一次。
2. **不要丢正交成果**——3 条 lane 里常出现"亚军在某个维度上是对的"（例如 tile 更优但
   pipeline 更差）。winner-take-all 会把亚军整个丢掉。
3. **缩短搜索**——文献里这块收益量级最大：KOPE 在同基座下把通过率从 60.0% 提到 84.6%，
   同时把 token 消耗从 **15.9B 降到 1.113B**（约 1/14）；Trellis/KernelEvolve 在生产里报
   "跨 session 复用让达到目标加速比快约 10x、token 少 52%"。

## 2. 关键洞察

> **PIANO 已经在为证据记忆付费（落盘、schema、测试都在），但没人在收货端。**

三条具体事实（都可以用一条 grep 复核）：

**洞察 1：`selection.jsonl` 写了，但没人读。**

它的 schema 是 `piano.trajectory.selection/v1`，字段包含 `referee`、`outcome`、
`winnerKey`、`carrying`、`commit`、`skipped`——信息量足够。但全仓库搜索 `selection.jsonl`
的消费者，只有 `tests/` 和 `docs/`。也就是说：**这些数据今天只服务于事后人工审查，
不参与任何自动决策**。

**洞察 2：亚军信息是被主动丢弃的，不是没算。**

`selection.ts` 的 `selectWinner` 返回 `runnerUpKeys`（已经按 referee 排好序的其余候选）。
但运行时调用处把 `winnerKey` 单独取出，并在构造 admission 输入时**硬写成 `runnerUpKeys: []`**
（`workflow-execution.ts:3219`）。
这不是缺功能，是当年"下游只需要 winner"的设计选择留下的空缺——**修它几乎不需要新逻辑**。

**洞察 3：败者产物在 region 退出时被删掉。**

`cleanupMapWorkspaces` 在 region 结束后清理所有 slot workspace（有 `preserve` 选项但非默认）。
对"只需要 winner"的今天是正确的；对"要复用败者成果"的将来是**必须先解决的前置**——
详见 `03`-M1。

**洞察 4（最容易忽略的一点）：轮间只传 winner 是 PRD 有意裁定的。**

`docs/map-winnow-selection-prd.md` §5.1 明确写了："region boundary 只返回 winning branch 的
terminal result group；其余 slot 结果可在 `allStages` 里用于报告，但不属于 region 自己的
`boundary.results`"，理由是"下游 `summary` 想要 winner 的文本可调用，而 `validate`/handoff
想要 metric 对齐"。

**所以这件事的定性是"设计反转"，不是"修 bug"。** 本模块的 M1/M2 路线之争，本质是
"我们要不要授权下游看到败者证据"。这个决定必须由你来做。

**洞察 5：文献已经把"粒度"这个问题解决了，不必自己踩坑。**

HTAM（arXiv:2605.29734）明确指出了一个**粒度错配**：粗粒度提示可复用但难以执行；
细粒度记忆可执行但会**放大搜索空间、掩盖瓶颈**。它的解法是两层图：粗的"全局方向" +
细的"局部策略" + 两者之间的"转移经验"。PIANO 现在两个粒度都没有——这正是可以直接照搬的结构。

## 3. 影响效果的关键因素

| 因素 | 为什么关键 | PIANO 现状 |
|---|---|---|
| **注入预算** | 记忆越多越贵；上下文被历史挤满后，当前任务反而做不好 | 无记忆，预算问题尚未出现 |
| **粒度** | 粗了不可执行，细了爆搜索空间（HTAM 的结论） | 无 |
| **检索相关性** | 注错的历史比不注更糟（会误导 idea） | 无 |
| **失败信息是否结构化** | "失败了"没用；"在第几步、哪种验证、什么反例"才有用 | `carrying.reason` 已有文本，但无结构化归属 |
| **是否阻塞下一轮** | 同步聚合会拖长关键路径；异步则可能迟到 | 无 |
| **跨 run 的污染风险** | 别的 case 的经验可能不适用；SkillEvolver 专门设计了 overfit/fresh-agent 审计 | 无 |
| **谁能写记忆** | 只有引擎写 → 可信但保守；允许 worker 写 → 灵活但会灌水 | 只有引擎写 |

## 4. 方法总览

| 编号 | 方法 | 落点 | 风险 | 优先级 |
|---|---|---|---|---|
| M1 | 轮内 lane 摘要回流（**契约/prompt 路线**） | recipe 契约 + prompt | 低 | **P1** |
| M2 | 引擎暴露 loser（**设计反转路线**） | 引擎 + PRD | 中高（需裁定） | 待裁定 |
| M3 | 失败 → 有效规则记忆 | recipe + 契约 | 低 | P1 |
| M4 | 分层经验图（避免粒度错配） | recipe + DSL | 中 | P2 |
| M5 | 跨 run / 跨 case 复用 | 离线流程 + 存储 | 中高 | P3 |
| M6 | 最小可观测性（连续未改进/未决计数） | `summary` / 报表 | 低 | **P0**（最便宜） |

## 5. 方法逐一

### M1 — 轮内 lane 摘要回流（契约/prompt 路线）

#### Motivation

`docs/WORKLOG-TOURNAMENT-2026-09-04.md` 的"下一步候选"里第 2 条，就是本模块最直接的动机：

> `selection.jsonl` 的 regression-guard 记录（`admitted-not-carried`）已有 reason 文本，
> 但跨 iter 无计数/聚合，长跑时"连续未改进"不易察觉。

同理，第 1 条指出 lane 身份没有结构化归属：**要判断"哪条 lane 是亚军"，
今天只能靠 `candidates/iter-N-<id>.cu` 文件名 + `map-item.json` + `selection.jsonl` 三者 join**。
这说明数据的"可 join 性"是有的，缺的只是"有人去 join"。

#### Motivation（为什么走契约路线而不是引擎路线）

引擎路线需要改 PRD 裁定的 boundary 语义（M2），风险大、评审面广。
而"败者摘要"这件事其实可以在**不改变 boundary 语义**的前提下达成：
让 exit stage 自己多写一份证据文件，让下一轮 entry 通过既有的 handoff/context 通道读它。

#### 机制

一句话：**让 `measure` 阶段除了报自己的 metric，还把自己的"结局"写进一份轮内汇总文件。**

具体设计（细节需评审，这里是可行形状）：

1. `recipe` 侧：`recipes/cuda-benchmark-store/contract.json` 的 `resultPayload` 增加
   lane 自述字段，例如
   `{ strategy_id, outcome: "kept"|"discarded"|"indeterminate", metric, bottleneck, failure_stage?, failure_kind?, diagnostics? }`。
   注意这是**每个 lane 写自己**，不是引擎推断。
2. 轮内汇总：由 loop 内新增的一个节点（`04`-M3 的 `aggregate`）把三条 lane 的摘要合成
   `rounds/iter-N-lanes.json`——它天然同时是"停滞检测"的落点。
3. 下一轮注入：`idea` 的输入已经包含上游 handoff；把该汇总文件加入其 context 列表即可
   （`workflow-execution.ts` 的 `contextFilePaths` 通道 + `writeHandoffContext`）。

#### 证据

- KOPE（arXiv:2608.25570）：Experience Graph Memory + 固定 token 预算的上下文注入，
  通过率 60.0% → 84.6%，token 15.9B → 1.113B。
- Trellis / KernelEvolve（arXiv:2606.29823）：把经验图当一等数据库状态，
  "前沿选择是查询、跨 session 复用是向量检索"，生产环境 10x 更快达到目标 + 52% token 节省。
- HTAM（arXiv:2605.29734）：两层转移图，明确解决粒度错配。

#### 风险 / 待裁定

- **lane 身份归属**是 `docs/WORKLOG-TOURNAMENT-2026-09-04.md` 明确标注的"契约/产品决定，
  需与开发者确认"。本方法要求 lane 自己写 `strategy_id` 是最低成本的解法，但意味着
  **信任 worker 自述**（契约校验能保证字段存在与类型，不能保证语义正确）。
  替代方案是引擎把 `map-item.json` 的 `item.id` 注入 result（引擎已知），
  这样 lane 身份**不必**依赖 worker 自述——**推荐这个**。
- 注入预算：三条 lane × 10 轮的摘要会增长。建议只注入**最近 N 轮** + 一份**滚动累积的
  失败清单**（AdaExplore 的 validity rules 形态，见 M3），而不是全量历史。

---

### M2 — 引擎暴露 loser（设计反转路线）

#### Motivation

M1 让败者信息**回到 worker 手里**，但保持"region boundary 只交 winner"的引擎语义。
有些用法是 M1 做不到的：

- 下游 stage 想做**跨 lane 的对比分析**（"为什么 B 在 memory-bound 的 case 上更优"）。
- 想做 **best-of-both 组合**（拿亚军的一部分 + winner 的一部分再赛一轮，见 `03`-M2）——
  这需要**败者的实际代码产物**，不只是文本摘要。
- 想让 evals/报表在**不 join 文件**的前提下直接按 lane 打分。

#### 机制

把 region boundary 从"只有 winner"扩成"winner + 只读 loser 引用"，例如
`boundary.results = [{ winner }, { losers: [{key, metric, carrying, workspaceRef}] }]`。
关键设计点：**loser 必须是只读引用，且不参与任何 gate/consolidation**——
否则就会破坏"引擎不 merge"的不变量（`README` §2.1）。

#### 证据

- KernelArc（arXiv:2608.17071）：**conclusions-only shared memory** + read-only cross-agent
  state ——即"败者的结论可读、不可写"，正是这个形状。
- POLCA（arXiv:2603.14769）：优先队列保存候选与评估历史，前沿选择是显式操作。

#### 风险 / 待裁定

- **这是对 `docs/map-winnow-selection-prd.md` §5.1 的有意反转**，必须显式讨论并更新 PRD，
  否则后续读者会把 M1 的绕行当成"设计就是如此"。
- loser workspace 的生命周期：今天 `cleanupMapWorkspaces` 会删。若要让引用可用，
  保留策略（保留到何时、谁负责清理）需要定义 → 与 `03`-M1 同一个问题。
- 磁盘量级：`docs/WORKLOG-TOURNAMENT-2026-09-04.md` 已记录过 log 膨胀问题
  （单 run `log.jsonl` 596MB）。保留 lane workspace 会更直接地放大占用，**需要预算**。

> **建议**：先做 M1（低风险、立刻可用、收益已知），把 M2 当作 M1 落地后**用数据决定**的
> 下一步。如果 M1 已经解决了 90% 的诉求，M2 就不必付反转 PRD 的代价。

---

### M3 — 失败 → 有效规则记忆

#### Motivation

在 kernel 调优里，**失败比成功信息量大**：编译失败的模式、数值不匹配的原因、
在特定 shape 下退化的结构，都是可以复用的"可行性规则"。
但败者的失败信息今天随着 lane 一起被删掉（洞察 3），下一轮 idea 只能重新踩一遍。

AdaExplore（arXiv:2604.16625）把这件事做成了明确的两阶段之一：
**adaptation 阶段把反复出现的失败合成为可复用的 validity rules 记忆**，
使后续生成保持在可行集内；search 阶段再做多样性保持的搜索。
它的收益（L2 3.11x / L3 1.62x，100 步内）里，adaptation 阶段的贡献是明确被消融验证的。

#### 机制

维护一份**只增不改的可行性规则清单**（每 case 一份），规则来源是结构化失败证据：

```
规则形态（示意）：when <条件> then avoid <做法>, because <证据引用>
例：when M % 64 != 0 then avoid 无边界检查的 vectorized load, because iter-3 lane-2 越界读
```

规则是**文本 + 证据指针**，不是可执行代码（这与 PIANO"契约是 JSON Schema、
校验器不执行用户代码"的既有取向一致）。

注入方式：作为 `idea` 的 context 文件（M1 的同一通道），并限制总长度（预算化）。

#### 证据

- AdaExplore（arXiv:2604.16625）：failure-driven adaptation + diversity-preserving search，
  无需微调或外部知识。
- EvoMem（arXiv:2608.10795）：把成功的变异事件转成**结构化、任务相关的建议**，
  跨 run 与跨任务复用；作者也诚实报告了跨任务收益的**不稳定性**。
- daVinci-kernel（arXiv:2606.16497）：技能库只在**执行验证确认可复现加速后**才入库——
  这条门槛值得抄（见风险）。

#### 风险

- **灌水**：如果允许 worker 随意追加规则，清单会变成噪声。缓解：只接受"有结构化失败证据
  指针"的规则；并像 daVinci-kernel 一样设"入库门槛"。
- 规则冲突：新规则与旧规则矛盾时谁赢？建议**不合并**，按时间倒序注入并标注来源轮次，
  让 idea 自己判断。

---

### M4 — 分层经验图（避免粒度错配）

#### Motivation

M3 解决"失败信息"，M1 解决"轮内证据"。但两者都容易掉进 HTAM 指出的陷阱：
把历史一股脑塞进上下文，结果是**搜索空间被历史放大、真正的瓶颈被掩盖**。
HTAM 的原话是：粗粒度提示可复用但难执行，细粒度记忆可执行但模糊瓶颈。

#### 机制

按**粒度分层**组织，并在注入时**分层选择**（而不是全量注入）：

| 层 | 内容 | 例子 | 注入时机 |
|---|---|---|---|
| 粗（方向） | 全局方向：这类 kernel 该往哪个瓶颈族打 | "compute-bound，优先 pipeline depth" | 每轮都注入（短） |
| 细（策略） | 局部可执行策略：具体怎么改 | "double-buffer K 维加载" | 仅在匹配当前瓶颈时注入 |
| 转移（经验） | 上一步做了什么 → 结果如何 → 下一步建议 | "tiling 之后 occupancy 降了，别再改 tile" | 作为 M1 摘要的一部分 |

这与 PIANO 已有的结构其实很贴合：
`strategies[]` 里的 `bottleneck` + `technique` + `rationale` + `risk_level` 已经是
"方向 + 策略"的雏形，`carrying.reason` 是转移经验的雏形。

#### 证据

- HTAM（arXiv:2605.29734）：两层 Hierarchical Transition Graph（粗全局方向 + 细局部策略 +
  转移经验），KernelBench 全量上同时提升正确性、fast-solution 率与加速比，且后端与
  Robust-KBench 研究显示结构化记忆可迁移。
- KernelSkill（arXiv:2603.10085）：双级记忆（长期可复用专家技能 + 短期防重复回溯），
  KernelBench L1-3 100% 成功率的报告里明确把"短期记忆防重复回溯"列为贡献。

#### 风险

- 分层本身是**结构决策**，一旦做错比不做更难改（下游都依赖它的 key）。
  建议先做 M1+M3（平铺），观察到"历史太长/太糊"的症状后再分层。

---

### M5 — 跨 run / 跨 case 复用

#### Motivation

今天是"每次 run 从零开始"。而同一类算子（GEMM、attention、norm）的调优经验高度可迁移：
Trellis 报告跨 session 复用让达到目标加速比**快约 10x**、token 少 52%；
EFT（arXiv:2606.29082）甚至把轨迹转成训练信号，在 371 个优化任务上做跨任务泛化。

但要诚实：EvoMem 报告了跨任务收益的**可变性**，Ark 上也常有"通用经验其实没用"的情况。
收益是概率性的，不是保证的。

#### 机制

三层递进：

1. **同 case 跨 run**（最稳）：同一 case 的多次 run 共享一份规则/方向记忆。
2. **同类 case 跨 case**：按算子族（GEMM/attention/norm）组织记忆，靠 tag 关联。
3. **通用知识库**：Atrex-Kernel-Agent 形态——298 个 reference kernel 文件 +
   244 篇优化知识文档 + 外部上游项目做 API/ISA 查询（arXiv:2607.14541）。

PIANO 侧特别合适的切入点是第 3 层：文献反复指出**高质量 reference 与专家方向是关键**
（见 `07`-M4）。

#### 证据

- Trellis / KernelEvolve（arXiv:2606.29823）；KOPE（arXiv:2608.25570）。
- EFT（arXiv:2606.29082）：156K 轨迹 / 10 域 / 371 任务，held-out 22 任务平均超 base 10.22%。
- Atrex-Kernel-Agent（arXiv:2607.14541）：生产 trace 采样的 30 算子 / 440 shape。

#### 风险

- **存储与治理**：需要一个不进 `runDir` 的持久位置（`~/.piano/` 下），以及"这条记忆来自哪里"
  的溯源。PIANO 已有"契约快照按 digest 存"的先例，形态可借鉴。
- **污染**：别的 case 的经验用错地方会误导。建议默认只启用第 1 层，
  第 2/3 层需显式开启并在报表里标注。

---

### M6 — 最小可观测性：连续未改进/未决计数

#### Motivation

这是本模块里**最便宜、最该先做**的一件事。动机就直接写在仓库里
（`docs/WORKLOG-TOURNAMENT-2026-09-04.md` 的"下一步候选"第 2 条）：

> `selection.jsonl` 的 regression-guard 记录（`admitted-not-carried`）已有 reason 文本，
> 但跨 iter 无计数/聚合，长跑时"连续未改进"不易察觉。

也就是说：今天一个 10 轮的 run，如果第 3-9 轮全都 `admitted-not-carried`，
**没有任何地方会告诉你**——`summary` 阶段拿到的是 winner 的证据，没有"连续失败"这个信号。

#### 机制

纯读侧聚合，不改任何判决：

- 从 `selection.jsonl`（已存在）统计：连续 `admitted-not-carried` 轮数、
  `no-winner` 轮数、`carry-failed` 次数、metric 身份变更次数。
- 输出：`summary` 的输入 + evals 报表的一列 + TUI 的一个提示。

同一条聚合也是 `04`-M3（plateau 停机）的**判据来源**——所以这一步是两步的前置。

#### 证据

- KernelArc（arXiv:2608.17071）：**plateau-triggered drafting**——停滞是被显式检测并
  触发新动作的事件，而不是被动等待轮数耗尽。
- The tournament worklog 自身：已经把这条列为待办。

#### 风险

- 几乎无。唯一注意：`selection.jsonl` 的 schema 是 v1，加字段需保持向后可读
  （现有实现读文件时对未知字段宽容即可，但**不要**改已有字段语义）。

## 6. 落地顺序与验收

| 步 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| 1 | **M6** 聚合统计 + `summary` 暴露 | 无 | 一个 10 轮 run 的汇总里能看到连续未改进计数 |
| 2 | **M1** lane 摘要 + 轮内汇总文件 | 需先定 lane 身份来源（建议引擎注入 `map-item` id） | 下一轮 `idea` 的 context 里能看到上一轮三条 lane 的结局 |
| 3 | **M3** 失败 → 规则清单 | M1 | 规则条目带证据指针；清单长度受限 |
| 4 | **M4** 分层 | M1+M3 观察后 | 注入分层可控、有开关 |
| 5 | **M5** 跨 run | 需要存储/治理设计 | 默认关闭，显式开启 |
| — | **M2** 引擎暴露 loser | **需先裁定是否反转 PRD §5.1** | 若做：loser 只读、不参与 gate；PRD 同步更新 |

## 7. 参考文献

arXiv:2608.25570（KOPE）、arXiv:2606.29823（Trellis/KernelEvolve）、arXiv:2605.29734（HTAM）、
arXiv:2604.16625（AdaExplore）、arXiv:2608.10795（EvoMem）、arXiv:2606.16497（daVinci-kernel）、
arXiv:2603.10085（KernelSkill）、arXiv:2608.17071（KernelArc）、arXiv:2603.14769（POLCA）、
arXiv:2606.29082（EFT）、arXiv:2607.14541（Atrex-Bench/AKA）

内部依据：`docs/map-winnow-selection-prd.md` §5.1、`docs/WORKLOG-TOURNAMENT-2026-09-04.md`、
`packages/orchestrator/src/selection.ts`、`packages/trajectory/src/recorders.ts`
