# 03 — 搜索拓扑与候选管理

## 0. 这个模块是什么

"搜索拓扑"指的是**候选是怎么被组织、保留、变异、组合的**——也就是搜索的形状。
在这个模块里，候选的生命周期是：`idea` 生成策略 → `race` 派出 lane 执行 → 选出 winner
→ carry → 下一轮**重新**生成 3 个策略。

本文档关心的不是"某个策略好不好"，而是**"搜索的形状是否合理"**。

## 1. 它用来干嘛

当前的形状是 **每轮一次独立的 winner-take-all 锦标赛**：

```
iter-N:   [策略A] [策略B] [策略C]  →  winner  →  carry
             ↓ 全部丢弃
iter-N+1: [策略D] [策略E] [策略F]  →  winner  →  carry
```

它回答的问题是"这一轮里哪个策略最好"。它**不**回答的问题：

- 亚军里有没有**可以和冠军叠加**的正交改进？（见 M2）
- 三轮下来，探索的方向是不是越来越窄？（见 M3）
- 除了"改结构"和"调参数"，还有没有别的**维度**可搜？（见 M5）
- 是不是所有候选都值得跑完整流程？（见 `04`-M1）

## 2. 关键洞察

> **PIANO 的搜索是"宽度固定、深度为 1、无记忆"的；文献里收益最大的三个维度恰好是
> 深度（组合/迭代）、多样性保种、和搜索维度的选择。**

**洞察 1：优化是乘性的，但 PIANO 只会"选一个"。**

CUDA-L1（arXiv:2507.14111，ICLR'26）在消融里发现了一条对 PIANO 直接相关的性质：
**CUDA 优化具有乘法性质（multiplicative nature of optimizations），模型会学会把它们
策略性地组合起来达到最优性能**。还说它"识别出非显然的瓶颈，并**拒绝看起来有益但实际有害的优化**"。

PIANO 的拓扑天然阻止了这件事：亚军在第 N 轮结束时就消失了（`cleanupMapWorkspaces`），
第 N+1 轮的 idea 看不到它，因此不可能提出"A 的 tiling + C 的 pipeline"这种组合。

**洞察 2：按性能保种会把搜索收敛到同一类结构。**

MAP-Elites 家族的做法是**按行为维度保种**，而不是按分数保种。
KernelFoundry（arXiv:2603.12440，ICML'26）明确用了 **MAP-Elites quality-diversity search
with kernel-specific behavioral dimensions to sustain exploration**。
收益不是"某轮更快"，而是"不会早早卡在一个局部最优结构上"。

**洞察 3：局部微调和结构重生成需要交替，单靠一种会陷住。**

AdaExplore（arXiv:2604.16625）把候选组织成**树**，在"小步局部精化"和"大步结构重生成"之间交替，
目的是"explore the optimization landscape beyond local optima"。它的实验在 100 步内达到
L2 3.11x / L3 1.62x，且**允许继续加算力继续涨**。

PIANO 的对应问题：每轮 `idea` 都被要求"至少 3 个真正不同的策略"，但没有机制区分
"这轮该小步调优"还是"这轮该换结构"。prompt 里只有"不要重复已尝试的 base+change 组合"。

**洞察 4：反馈的密度决定搜索效率，而 PIANO 的反馈是单比特。**

kernel 内部失败时，worker 拿到的是编译错误或数值不匹配（这是好的，稠密）。
但**搜索层面**拿到的是"赢了/输了"这一比特。
Argus（arXiv:2604.18616）给出了一条更强的路：用 **data-flow invariants**（编译期规格，
描述数据在 kernel 执行中必须如何被编排）把违规变成**带反例的稠密反馈**——
"违反发生在哪个 thread、哪个数据元素、哪个程序点"。它的结果是 MI300X 上达到手写汇编吞吐的
99-104%，且比现有 agentic 系统快 2-1543x。

**洞察 5：lane 异构已经有一条在飞的路，但只用到了"模型"这一个维度。**

`feat/tournament-slot-models`（commit `1a34f6a`）已经让 `stage.model` 支持列表，
按 lane 索引，长度必须等于 `count`，并提供了实验工作流
`recipes/workflows/gpu-cuda-tuning-tournament-mixed.yml`（三条 lane 分别是
deepseek-v4-flash / qwen3.8-flash / gpt-5.6-luna）。

这与文献的共识吻合：AlphaLab（arXiv:2604.08590）发现**"两个模型在每个领域都发现了质不同的解，
没有一个在所有领域都占优"，并明确结论"multi-model campaigns provide complementary search
coverage"**。KernelArc 则是 **strategy-specialized agents run in parallel**。

但模型只是异构的一个维度，另外三个维度（思路族、抽象层、实现空间）都还没有（见 M5）。

## 3. 影响效果的关键因素

| 因素 | 为什么关键 | PIANO 现状 |
|---|---|---|
| **候选存活期** | 组合/复用要求亚军的**代码产物**活着 | region 退出即删 |
| **保种准则** | 按分数保种 → 收敛到同一类；按行为保种 → 维持探索 | 无保种 |
| **扇出宽度** | 太窄探索不足，太宽成本线性上涨 | 固定 `count: 3` |
| **多样性度量** | 没有度量就无法强制多样性；prompt 的"要不同"不可验证 | prompt 要求，契约只保证 ≥3 条 |
| **变异的幅度谱** | 缺"大步重生成"就会困在局部最优 | 无幅度概念 |
| **反馈密度** | 单比特 vs 带反例的违规信息 | 搜索层单比特 |
| **lane 隔离成本** | 每 lane 一个 workspace：worktree 或目录快照 | 已有（策略由 source 洁净度决定，整场一致） |
| **去重** | 三条 lane 提同一件事就是浪费 2/3 预算 | 契约无法检测语义重复 |

## 4. 方法总览

| 编号 | 方法 | 落点 | 风险 | 优先级 |
|---|---|---|---|---|
| M1 | 保留亚军 / archive | 引擎（workspace 生命周期） | 中（磁盘、清理） | P2 |
| M2 | 组合叠加（正交改动合并再赛） | recipe + `03`/`02` | 中 | P2 |
| M3 | 质量多样性（MAP-Elites 式保种） | 引擎 + 契约 | 中高 | P3 |
| M4 | 局部 ↔ 结构交替 + 稠密反馈 | prompt + case 契约 | 低-中 | P2 |
| M5 | lane 异构（思路 / 抽象层 / 实现空间） | recipe + DSL | 中（C1 有定位冲突） | P2 |
| M6 | 推测式并行（提前 fork） | 引擎 | 高 | P4 |
| M7 | 扇出宽度自适应 | DSL + 引擎 | 中 | P3 |

## 5. 方法逐一

### M1 — 保留亚军 / archive

#### Motivation

M2（组合）和 `02`-M2（下游看 loser）都要求败者**产物**还在。
今天 `cleanupMapWorkspaces` 在 region 退出时删除所有 slot workspace。
`docs/WORKLOG-TOURNAMENT-2026-09-04.md` 已经记录了一个相关的观察：

> lane 间各自 promotion（slot-1 也 promoted=true）：发生在隔离 snapshot 工作区内，
> engine 只把 winner carry 回共享根——符合设计。

也就是说**败者其实已经跑出了可观的结果，只是我们选择不看它**。
CUDA-L1 的"乘性优化"结论说明：这不是浪费，被丢掉的很可能是下一次加速的一半来源。

#### Motivation 的另一半（为什么要谨慎）

磁盘代价是真实的。同一份 worklog 记录了单 run `log.jsonl` 达到 **596MB / 112万行**，
当时开发者的裁定是"保持现状，记录 tradeoff"。再叠加"保留 3 份 lane workspace × 10 轮"，
量级会失控。所以本方法的重点不是"保留"，而是**"保留什么、保留多久"**。

#### 机制

分层保留，按价值递减：

| 层 | 保留物 | 大小 | 期限 |
|---|---|---|---|
| L1 | lane 的**摘要 + metric + 结局**（`02`-M1 已经在做） | KB 级 | 永久（run 内） |
| L2 | lane 的**文件 delta**（相对 baseline 的改动） | 与改动量同阶 | run 内 |
| L3 | lane 的**完整 workspace** | GB 级 | 最近 N 轮，或显式开启 |

现有能力已经覆盖了 L2 的一半：tournament 边界会冻结
`tournaments/<region>/target-before/**`（父 workspace 全量）与
`winner-change/**`（只冻结 winner 的 delta）。**把它从"只冻结 winner"扩成"冻结所有 lane 的
delta"** 是改动量最小、收益最直接的一步——因为 delta 已经是现成的概念
（`workspaceBaselineChanges` 已在用）。

#### 证据

- CUDA-L1（arXiv:2507.14111）：乘法性质 + 学会组合 + 拒绝看似有益的优化。
- Kernel-Smith（arXiv:2603.28342）：维护**可执行候选群体** + "top-performing **and diverse**"
  archive + 结构化执行反馈。
- Kernel Foundry（arXiv:2605.30359 / 2603.12440）：集中式经验库累积可复用优化知识。

#### 风险 / 待裁定

- **保留期限与清理责任**需要定义。建议：L2 永久（KB-MB 级，代价可接受），
  L3 默认关、需要显式开启且带容量上限。
- 与 `cleanupMapWorkspaces` 的 `preserve` 选项关系需要明确（现有选项语义是否够用？）。

---

### M2 — 组合叠加（正交改动合并再赛）

#### Motivation

这是 M1 的直接消费者，也是"乘性优化"最自然的落地：**第 N 轮拿了 A 和 C，
第 N+1 轮不该从 A 出发再提三个新策略，而该先试"A 的骨架 + C 的某个局部"**。

为什么这不是"随便试一个"：如果 idea 能看到 A 和 C 各自的**瓶颈归属**（M1 的 L1 摘要），
它就能判断 A 与 C 改的是不是**不同瓶颈**——不同瓶颈的改动更可能正交可叠加。
`recipes/cuda-idea-tournament/contract.json` 已经要求每条策略带 `bottleneck` 与
`technique`，`conflicts_with` 字段甚至已经允许多策略间声明冲突关系——
**这些字段今天只用于单轮内的一致性，完全可以用于跨轮组合判断**。

#### 机制

在 loop 内加一个**可选的组合轮**（或让某一轮的 lane 专门做组合）：

- 输入：上 N 轮的 winner + 亚军 delta（M1 的 L2）+ 各自的 bottleneck 标注。
- 产出：一组"组合候选"（例如 `winner + loser.kernel_body`、`winner + loser.epilogue`）。
- 参与正常仲裁（仍由单 metric 裁判决定）。

关键：组合候选必须和普通候选**同场竞技**，不能享有特权。否则会破坏裁决的一致性。

#### 证据

- CUDA-L1：学会组合、识别乘法性。
- CUDA-L2（arXiv:2512.02551）：在 HGEMM 上系统性探索 1000 个配置，
  超过 cuBLASLt-AutoTuning 11.4%（离线）/ 15.9%（服务模式）——
  说明"配置空间 + 组合"在已经高度优化的算子上仍有空间。
- MKEvolve（arXiv:2607.20501）：**模块分解 + 跨迭代 split/fuse**，
  结果是"可配置、可解释、错误和加速比可归因到具体子 kernel"，同时**减少最多 35% token**。
  这是"组合"的一个更强形态：把模块边界本身也当作搜索变量。

#### 风险

- 组合数量组合爆炸，必须限量（建议：每轮最多 1 条 lane 做组合，其余仍是探索）。
- "正交"是模型判断，可能出错。缓解：组合候选如果比 winner 差，就是一次正常的失败轮
  （机制上安全，成本是 1/3 轮预算）。

---

### M3 — 质量多样性（MAP-Elites 式保种）

#### Motivation

M1/M2 保的是**性能最好的若干个**。MAP-Elites 保的是**每个行为格子里最好的那一个**。
区别在长跑里很明显：按分数保种会把搜索推向单一结构族，
而 kernel 调优的收益常常来自**换族**（例如从"提高 occupancy"换到"减少 global traffic"）。

#### 机制

定义 2-3 个**行为维度**（而非性能维度），构成网格，每格保最优：

| 行为维度（示意） | 取值 |
|---|---|
| 瓶颈族 | compute / memory / latency / occupancy |
| 结构族 | tiling / pipeline / layout / launch topology / math-rewrite |
| 抽象层 | 自定义 kernel / CuTe / 库调用（见 M5，需先定评测定位） |

保种对象是"每格最优候选的 delta"，注入给下一轮 idea 作为"已占据的格子"。

#### 证据

- KernelFoundry（arXiv:2603.12440，ICML'26）：MAP-Elites + kernel-specific behavioral
  dimensions **to sustain exploration**；配合 meta-prompt 共进化（见 `07`-M1）
  与模板化参数优化；SYCL 上 KernelBench 平均 2.3x。
- POLCA（arXiv:2603.14769）：**ε-Net 机制维持参数多样性** + LLM Summarizer 做元学习，
  理论上证明了随机性下的近最优收敛。
- Kernel-Smith：archive 明确要"top-performing **and diverse**"。

#### 风险

- 网格定义是**强假设**：格子错了会比不做更糟。建议先用 `bottleneck` 这一维做最小实验。
- 与单 metric 裁判的交互：保种不影响裁决（裁决仍只看 metric），保种只影响**下一轮的输入**。
  这个边界必须守住。

---

### M4 — 局部 ↔ 结构交替 + 稠密反馈

#### Motivation

当前每轮都在"提新策略"，没有"这轮该微调还是该换结构"的判断。
结果是：要么在已经收敛的结构上反复做等价改动（浪费），
要么每次都想大改（不稳定、风险高、验证成本大）。

AdaExplore 的树结构 + 两种变异幅度（小步局部精化 / 大步结构重生成）就是为这个设计的。
AutoLab（arXiv:2606.05080，36 个长时程优化任务，含 CUDA kernel）还给出了一个更硬的结论：

> 决定成败的主导因素**不是首次尝试的质量，而是"持续重复 benchmark、编辑、纳入经验反馈"的
> 坚持度**。

也就是说：**节奏（rhythm）比单次质量更重要**。

#### 机制

两件可独立落地的事：

1. **显式标注变异幅度**：在 `strategies[]` 里增加 `mutation_scope: "local" | "structural"`
   （替代或补充现在的自由文本 `technique`），并在 prompt 里要求一轮内**至少覆盖一种**，
   或由 `profile` 阶段的证据决定本轮以哪种为主。
2. **稠密反馈**：把"输了"升级为"在哪一步、因为什么、有什么反例"。
   短期可用现有数据（编译诊断、数值不匹配的 shape、regression 幅度）；
   中期可考虑 Argus 形态的 data-flow invariants——但那需要 case 侧提供
   编译期规格与抽象解释支持，属**独立工程**。

#### 证据

- AdaExplore（arXiv:2604.16625）：树 + 两档变异，可随算力继续改进。
- AutoLab（arXiv:2606.05080）：坚持度主导成败；多数前沿模型会过早终止或耗尽预算无进展。
- Argus（arXiv:2604.18616）：invariants → 带反例的稠密反馈；99-104% 手写汇编吞吐。
- KernelPro（arXiv:2606.26453）：把 expert heuristics 编码成可插拔的 micro-profiling tools，
  把原始硬件指标转成可执行的自然语言指导；消融显示 micro-profiling tools 的贡献
  **p < 0.0001**（vs raw metrics）。

#### 风险

- `mutation_scope` 是新的契约字段 → 需要 case/worker 双侧更新；旧数据需容忍缺失（走默认）。
- 稠密反馈的信息来源受 `cuda-profile` 的能力限制：`recipes/cuda-profile/agents.md`
  **已明确声明可能出现 `timing-only`**（无硬件计数器时不得用猜测填充）。
  所以"稠密反馈"必须有降级路径，不能假设 counters 总是可用。

---

### M5 — lane 异构：思路 / 抽象层 / 实现空间

#### Motivation

三条 lane 现在是**同一个模型、同一个 worker、同一个抽象层**的三个策略。
`feat/tournament-slot-models` 已经把"模型"这一维打开。剩下三维：

1. **思路族异构**：三条 lane 分别负责不同瓶颈族（现在靠 prompt 请求多样性，
   契约只保证"≥3 条"，不保证真的不同）。
2. **抽象层异构**：自定义 CUDA vs CuTe/CUTLASS vs Triton。
3. **实现空间异构**：手写 kernel vs 库配置 vs 融合改写。

第 3 维对应 HIERA（arXiv:2608.21157）的核心主张：**在 PyTorch operator、CUDA 库、
自定义 CUDA kernel 之间选择实现空间**，并用 profiling 反馈与专家知识引导结构化迭代；
它在 KernelBench 上给出"更好的实现有效性、样本效率与优化性能"，
并在一个科学计算 stencil 算子上超 cuDNN 1.53x。

#### 机制

- **思路族**：由 `idea` 的 `over: idea.strategies` 驱动，但增加**契约级多样性要求**——
  例如契约校验三条 strategy 的 `bottleneck` 两两不同（现在是 prompt 请求，不可验证）。
  这是**最便宜的一维**，只改契约。
- **抽象层**：需要在 `race` 内按 lane 指定不同的 worker/skill（类似 `stage.model` 的列表机制，
  但作用于 worker 或抽象层选择）。注意 `stage.model` 的机制是"同一 stage 按 lane 索引"，
  抽象层异构需要按 lane 选择**不同的 worker**，这是新的 DSL 概念。
- **实现空间**：见风险。

#### 证据

- AlphaLab（arXiv:2604.08590）：多模型互补搜索覆盖；CUDA kernel 优化上比 torch.compile
  平均快 4.4x（最高 91x）。
- KernelArc：strategy-specialized agents 并行 + conclusions-only 共享记忆。
- HIERA：实现空间选择。
- CuTeGen（arXiv:2604.01489）：**面向 CuTe 而非裸 CUDA** + **延迟 profiling 计划**
  （等高层结构稳定后再给低层性能反馈），KernelBench L1-L2 平均 1.71x，超过 CudaForge（0.89x）。
  它的"延迟 profiling"洞察对 PIANO 的 `implement`→`measure` 分离有直接启发。
- FACT（arXiv:2604.26666）：三阶段 agent 工作流（模式发现 / 模式实现 / 模式组合），
  把综合建立在 CUTLASS C++ 上，避免"重新发现库里已有的优化"。

#### 风险 / 待裁定（重要）

**第 3 维与现有 case 契约直接冲突。** `recipes/cuda-implement-verify/agents.md` 明确要求：

> Never use cuBLAS, CUTLASS device GEMM, PyTorch, or another library call for the candidate's
> core computation.

这条规则对**"自定义 kernel 能力"的评测**是必要的（否则分数不可比），
但它同时排除了 HIERA/CuTeGen/FACT 那一整类收益（库配置、CuTe 抽象、模式组合）。
**这不是技术问题，是评测定位问题**：我们要证明的是"agent 能写快 kernel"，
还是"agent 能找到最快的实现"？两者需要不同的 case 契约，可能需要**两套 case 族**。

建议：**先不动**，等第 1 维（思路族）与第 2 维（抽象层）落地后再决定是否引入实现空间异构。

---

### M6 — 推测式并行（提前 fork）

#### Motivation

SpecGen（arXiv:2606.17518）的 workload 特征分析指出 agentic kernel 优化的三个系统级低效：

1. 推理（reasoning）导致的长生成延迟；
2. profiling 反馈不足；
3. validation/profiling 资源利用不足。

它的关键洞察：**正在进行的 reasoning 生成本身提供了一个窗口**——
可以在推理轨迹的合适触发点**fork 出非推理生成**，提前产出更多候选 kernel，
在推理还在进行时就并行验证与 profiling；一旦某个 kernel 达标，就**提前终止推理**。

PIANO 的对应浪费：`idea` 阶段（thinkingLevel: high）可能要跑很久，期间 GPU 完全空闲。

#### 机制

对 PIANO 而言，最小可行版本不是"fork 推理"，而是**让 `idea` 与 GPU 侧工作重叠**：
例如把"上一条 lane 的 profile 采样"或"上一个 winner 的回归验证"放到 `idea` 运行期间。
更激进的版本是在 `idea` 未完成时就允许 race 启动部分 lane——但这会破坏
`over: idea.strategies` 的依赖语义，**代价很高**。

#### 证据

- SpecGen：端到端时间降低（vs 三个 baseline），在固定 time/token 预算下产出更多 profiling
  反馈、提高资源利用率、提升 kernel 加速比；并动态重分配 validation/profiling GPU 池。
  （资源池部分归 `06`-M3。）

#### 风险

- **高**。依赖语义（`over` 必须在 `from` 完成后才可解析）是 DSL 的根基，
  提前 fork 需要新的"流式 fan-out"概念。建议**最后考虑**，且先量化 `idea` 阶段的
  空闲占比（`duration.jsonl` 已有数据，不需要新埋点）。

---

### M7 — 扇出宽度自适应

#### Motivation

`count: 3` 是固定的。但不同轮次的**不确定性**差别很大：

- 早期轮：瓶颈不明，需要宽探索。
- 边界轮（`regression_pp` 在 1-5pp）：需要更宽的对比才有分辨力（`01`-M2 的噪声带在这里最难）。
- 已接近上限：再宽的探索也是浪费（`04`-M4 的 SOL 判据在这里适用）。

#### 机制

宽度由**证据**决定，而非固定：

- 输入：上一轮的离散度（`01`-M1）、SOL headroom（`04`-M4）、连续未改进计数（`02`-M6）。
- 规则举例：`headroom > 50%` → 宽（5）；已连续 2 轮未决 → 宽；
  接近 SOL 或连续 3 轮未改进 → 窄（2）或转入验证性单变量。

DSL 侧：`count` 从字面量扩展为可引用的表达式**会破坏"样式极少"的取向**，
所以更可能的落点是**用 recipe 变体 + 调度决策**实现（即由外层选择用哪个 workflow 变体），
而不是让 DSL 变复杂。

#### 证据

- KernelBrain（arXiv:2608.02611）：coarse-to-fine、预算感知、只给幸存者高保真预算。
- μCUTLASS + SOL（arXiv:2603.29010）：对近 SOL 的问题**降优先级**，
  SOL-guided budgeting 省 19-43% token 且保住 ≥95% geomean 加速。
- POLCA：优先队列显式管理 exploration-exploitation。

#### 风险

- DSL 复杂度上升与"薄 DSL"目标冲突（`docs/workflow-trajectory-evaluation-prd.md` 已把
  `metrics`/`recorder`/`select` 这类字段列为 **Rejected**）。
  所以本方法应优先走"外层调度 + 变体选择"，而不是 DSL 表达式。

## 6. 落地顺序与验收

| 步 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| 1 | **思路族多样性进契约**（M5 第 1 维，最便宜） | 无 | 契约能拒掉 `bottleneck` 重复的 strategy 集 |
| 2 | **`mutation_scope` 标注 + 本轮节奏**（M4 第 1 件） | 无 | 一轮 run 里能看到 local/structural 两种轮次 |
| 3 | **lane delta 冻结扩到全部 lane**（M1 的 L2） | 无（`workspaceBaselineChanges` 已有） | 败者 delta 在 run 目录里可读 |
| 4 | **组合轮**（M2） | 步 3 | 组合候选与普通候选同场竞技、同裁判 |
| 5 | **行为维度保种**（M3） | `02`-M1 | 保种只影响下一轮输入，不影响裁决 |
| 6 | **抽象层异构**（M5 第 2 维） | `stage.model` 机制可借鉴 | 需新 DSL 概念，先写设计 |
| — | M6 / M7 / M5 第 3 维 | — | 前两项需先量化 `idea` 空闲占比；第 3 维**需先定评测定位** |

## 7. 参考文献

arXiv:2507.14111（CUDA-L1）、arXiv:2512.02551（CUDA-L2）、arXiv:2603.28342（Kernel-Smith）、
arXiv:2605.30359 / 2603.12440（Kernel Foundry / KernelFoundry）、arXiv:2604.16625（AdaExplore）、
arXiv:2606.05080（AutoLab）、arXiv:2604.18616（Argus）、arXiv:2606.26453（KernelPro）、
arXiv:2608.21157（HIERA）、arXiv:2604.01489（CuTeGen）、arXiv:2604.26666（FACT）、
arXiv:2607.20501（MKEvolve）、arXiv:2604.08590（AlphaLab）、arXiv:2603.14769（POLCA）、
arXiv:2608.17071（KernelArc）、arXiv:2606.17518（SpecGen）、arXiv:2608.02611（KernelBrain）、
arXiv:2603.29010（μCUTLASS+SOL）

内部依据：`recipes/cuda-idea-tournament/contract.json`、`recipes/cuda-implement-verify/agents.md`、
`recipes/cuda-profile/agents.md`、`docs/WORKLOG-TOURNAMENT-2026-09-04.md`、
`docs/workflow-trajectory-evaluation-prd.md` §20、分支 `feat/tournament-slot-models`
