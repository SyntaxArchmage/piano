# 04 — 预算、保真度分级与停机判据

## 0. 这个模块是什么

这个模块管三件相互纠缠的事：

1. **预算（budget）**：一次 run 允许花多少——轮数、wall clock、token、GPU 时。
2. **保真度分级（fidelity tiering）**：一个候选值得用多贵的评测。便宜的是编译通过 + 小样本计时，
   贵的是完整 benchmark + profiling + 边界 shape 验证。
3. **停机判据（stopping）**：什么时候不跑了。

在 PIANO 里，这三件事的现状是：预算 = 固定 `iterations`（锦标赛 10、topsop 8）；
保真度 = **每个 lane 都跑完整流程**；停机 = **跑满轮数**（`topsop-tuning.yml` 的注释明确写了
"the loop runs its fixed `iterations` cap; the only early termination is a terminal block"）。

## 1. 它用来干嘛

挡住三种浪费：

- **宽扇出 × 高保真**：3 条 lane 里可能有 1 条在编译阶段就该被淘汰，但它照样占满了
  implement → measure 的全流程。
- **无效轮次**：第 3-9 轮连续 `admitted-not-carried`，仍然跑满 10 轮。
- **无口径的长跑**：`timeout` 是 stage 级的"防挂死保险"（`workflow.ts` 注释明说
  "a generous wall-clock safety net, **not a budget**"），不是预算。

它同时也是 `01`（抗噪）和 `02`（记忆）的**放大器**：有了分级，宽扇出才便宜；
有了停机，长跑才有意义。

## 2. 关键洞察

> **PIANO 有"防挂死"的保险，没有"预算"；有"收敛"的报告，没有"收敛"的控制信号。**

**洞察 1：`timeout` 不是预算，作者自己写了。**

`packages/orchestrator/src/workflow.ts` 对 `timeout` 的定义是"whole-stage wall-clock cap，
超出则 stage 失败"——目的是"guards against a single runaway agent tool call
(e.g. a filesystem-wide `find`) blocking the whole run with no recovery point"。
`topsop-tuning.yml` 的注释更直白：

> Stage `timeout` (seconds) is a generous wall-clock safety net, **not a budget**:
> the enflame gateway's first-token latency can legitimately reach ~2h (idea once ~5h),
> so caps exist only to bound an indefinite hang.

所以"预算"这个概念在 PIANO 里**不存在**。而有意思的是：**成本数据是齐全的**——
`token-usage.jsonl` 和 `duration.jsonl` 全量落盘（`packages/trajectory/src/recorders.ts`），
`TokenUsageRecorder` 还处理了"多次累积快照合并"的细节。
**数据在，判决不用。**

**洞察 2：PIANO 已经有 `CONVERGED` 语义，但它只是报告，不是控制。**

`recipes/workflows/topsop-tuning.yml` 的注释：

> The measure stage emits `CONVERGED` + `next_variable: null` when the evidence shows
> the target is unreachable, and the summary synthesizes the final convergence conclusion.

注意"the loop runs its fixed `iterations` cap"——**CONVERGED 不会提前结束循环**。
这是一个很干净的现状：语义已经有了（worker 能判断"这个目标不可达"），
缺的只是"把这个判断变成控制信号"。这是一次**引擎能力**补充，不是评测能力补充。

**洞察 3：保真度分级是文献里收益最直接的一招。**

KernelBrain（arXiv:2608.02611）的整套设计就是它：用**低代价评测筛掉大量候选，
只把高保真预算给有希望的幸存者**，结果是"最多降低 48% 优化时间"，
同时 kernel 质量与搜索效率都提升。而且它明确指出前提：
*"generated variants can violate correctness constraints, runtime measurements are noisy,
and search often stalls early"*——这三条 PIANO 全都有。

**洞察 4：预算口径必须是多轨的，因为三种资源互相不可替换。**

- **轮数**：PIANO 现在唯一的口径。但一轮的成本可能差 10 倍（一次 `idea` 可能跑 5h）。
- **wall clock**：用户体验的直接口径（AutoLab 就是"在严格 wall-clock 预算内改进"）。
- **token / 费用**：agent 成本口径（KOPE 的报告用 token 直接对比：15.9B → 1.113B）。
- **GPU 时**：资源占用口径（SpecGen 在固定 time/token 预算下比较）。

只用轮数会出现"10 轮但 60 小时"或"10 轮但 2 小时"这两种完全不同的东西。**建议以 wall clock 为主口径、
token 为副口径，轮数为上限**（而非唯一判据）。

**洞察 5：SOL 引导能同时服务预算与停机，而且 PIANO 已经有一半。**

`topsop-theory` 已经在算理论上限：注释写明
"按 LLC 平衡判定式产出 `topsop-theory-report`"，
要求 `read_write_balanced`、3000/2500 GB/s 上限、`theory_min_us`、`bandwidth_utilization`
**互相一致**，且"contract 会校验这些算术关系"。

而 CUDA 锦标赛**完全没有**这一层。这是"已建好的能力没有迁移"，属最划算的一类改进。

## 3. 影响效果的关键因素

| 因素 | 为什么关键 | PIANO 现状 |
|---|---|---|
| **预算口径** | 口径错 → 优化目标错（省钱变成省轮数） | 只有轮数 |
| **分级阈值** | 太严→杀掉有希望的候选（假阴性）；太松→省不下钱 | 无分级 |
| **粗筛的可靠性** | 粗筛漏掉的候选再也不会回来 | 无 |
| **停滞判据** | 判据太敏感→过早停；太钝→白跑 | 无（`CONVERGED` 只是文本） |
| **SOL 可达性** | 目标本身不可达时必须能识别并停 | topsop 有，CUDA 无 |
| **计数器可用性** | 无硬件计数器时 roofline 只能走 `timing-only` | `recipes/cuda-profile/agents.md` 已声明此限制 |
| **是否允许"没结论"** | 停机后总结必须能诚实说"未收敛" | `summary` 已有"如实报告"取向 |

## 4. 方法总览

| 编号 | 方法 | 落点 | 需要什么 | 优先级 |
|---|---|---|---|---|
| M1 | 保真度分级 + policy gate | 契约 + recipe | 新增分级定义 | P1 |
| M2 | 达标早停 | 引擎（与 M3 同一机制） | 终止判据 | P3 |
| M3 | plateau 检测 + `CONVERGED` 控制化 | **DSL（可纯 DSL 起步）** + 引擎 | 聚合节点 | **P0** |
| M4 | SOL 引导（迁移 topsop-theory） | recipe（新增 baseline stage） | profile 能力 | P3 |
| M5 | 代理模型 / 性能预测 | 离线模型 | 训练数据 | P4 |
| M6 | 多轨预算口径 | 引擎 + 报表 | 无（数据已有） | P1 |

## 5. 方法逐一

### M1 — 保真度分级 + policy gate

#### Motivation

今天一个候选从提出到被裁决，要跑完整条链：
`implement`（写代码 + 编译 + 跑 + 数值校验）→ `measure`（完整 benchmark + 落盘 round record）。
而三条 lane 里，失败候选的比例可能不低（`recipes/cuda-benchmark-store/agents.md` 明确
"Benchmark only a candidate that passed compile, run, and numerical checks"——
这说明存在"编译/校验就挂掉"的候选，它们在 measure 阶段不产生 benchmark，
但**implement 阶段的成本已经全额付出了**）。

更细的机会在于：**很多候选可以用远低于完整 benchmark 的代价判断"没希望"**——
例如某个配置把寄存器压力推爆导致 occupancy 掉到 1/8，或某结构在 shape 上必然重复读。

#### 机制

三层保真度（名字不重要，边界重要）：

| 层 | 内容 | 代价 | 用途 |
|---|---|---|---|
| T0 粗筛 | 编译通过 + 极小样本计时 | 极低 | 淘汰明显无望者 |
| T1 中保真 | 完整正确性 + 中等样本 benchmark | 中 | 排序候选 |
| T2 高保真 | 完整 benchmark + profiling + 边界 shape + 约束项（`01`-M5） | 高 | 只给幸存者 |

关键设计点（这是 policy gate 的核心）：
**升级是单向的、且升级判据必须与最终裁判一致**——即 T2 用的是同一 metric、
同一方向、同一 case harness。否则分级会引入"不同保真度下不可比"的问题，
直接破坏 `01` 想要的可比性。

一个更省事的等价形态：**把 T0 放进 `implement` 阶段**（它反正要编译要跑），
让 worker 在 implement 结尾额外报一个"粗测"值，`measure` 只对粗测中处于有希望区间的候选
做 T2。这样**不需要新的 DSL 概念**，只需要契约里多一个字段与 prompt 里的一条规则。

#### 证据

- KernelBrain（arXiv:2608.02611）：低代价筛 + 高保真预算只给幸存者，
  "最多 48% lower optimization time"，且质量不降。
- μCUTLASS + SOL 引导（arXiv:2603.29010）：SOL-guided budgeting 省 19-43% token、
  保住 ≥95% geomean；"SOL 分析还能帮助识别 benchmark-gaming 的 case"。
- KernelPro（arXiv:2606.26453）：两级工具调用架构——
  **roofline-based bottleneck classification 先决定哪些专门分析工具才需要执行**
  （kernel 级 ncu / 指令级 SASS / 系统级 nsys），消融显示贡献显著。
  这就是"分级决定花多少钱"的另一种形态。

#### 风险 / 待裁定

- **假阴性不可恢复**：粗筛杀掉的真金白银候选不会回来。缓解：粗筛只做**明显**淘汰
  （例如编译失败、正确性失败、粗测比 incumbent 差一个数量级），
  并把"被粗筛淘汰"记入证据（`02`-M1），让下一轮知道自己丢了什么。
- **分级的可比性**是硬约束：不同层测出的数**不能**直接比较。
  这要求分级要么只用于"淘汰/保留"，要么升级到 T1/T2 后才进裁判。
  **建议前者**（分级只做淘汰，裁判统一在 T2）。这一点需要你确认。

---

### M2 — 达标早停

#### Motivation

SpecGen（arXiv:2606.17518）的做法：**当某个候选达到终止判据时，提前终止推理生成**，
以减少生成延迟。它的前提是"ongoing reasoning generation exposes a window"——
即推理还在跑，答案可能已经够了。

对 PIANO 的含义不同但相通：`idea` 阶段的 `thinkingLevel: high` 是昂贵的，
而"已经有一个足够好的候选"这个信息在**lane 跑完后**才可得——那时 idea 早就结束了。
所以严格照搬不成立。

**真正可用的形态**是另一层：**当本轮已经明确没有希望时，不必把这一轮的其余 lane 跑完**，
也不必进入下一轮。

#### 机制

与 M3 共用同一个机制（终止判据 + 引擎提前退出），只是触发条件不同：

| 触发 | 条件 |
|---|---|
| 达标 | winner 达到 case 声明的目标（加速比阈值 / SOL 占比） |
| 收敛 | M3 的 plateau 判据 |
| 不可达 | worker 报 `CONVERGED` + `next_variable: null`（topsop 已有此语义） |

#### 证据

- SpecGen：达到终止判据即提前结束，端到端时间下降。
- AutoLab（arXiv:2606.05080）：严格 wall-clock 预算；
  并观察到**多数前沿模型会"过早终止"或"耗尽预算无进展"**——两头都要防，
  所以"达标早停"必须与"防过早终止"同时设计。

#### 风险

- 过早停止会丢掉后续改进。**建议：达标早停只在目标被 case 明确声明时才启用**
  （即开启是 opt-in，且目标值来自契约，不由 agent 临场判断）。

---

### M3 — plateau 检测 + `CONVERGED` 控制化

#### Motivation

**这是本模块的 P0，也是最便宜的一步。**

证据就在仓库里。`docs/WORKLOG-TOURNAMENT-2026-09-04.md` 的"下一步候选"第 2 条：

> `selection.jsonl` 的 regression-guard 记录（`admitted-not-carried`）已有 reason 文本，
> 但跨 iter 无计数/聚合，长跑时"连续未改进"不易察觉。

而 `topsop-tuning.yml` 已经把语义写好了：`CONVERGED` + `next_variable: null`。
**两件事今天都不产生控制效果。**

#### 机制（分两级，第一级不需要改引擎）

**第一级：纯 DSL —— 在 loop 内加一个聚合节点。**

当前结构：

```yaml
- loop:
    name: tune
    feedback: race
    entry: profile
    exit: race          # ← 裁判叶子
    iterations: 10
    nodes: [profile, idea, tournament: race]
```

改成：

```yaml
- loop:
    name: tune
    feedback: decide    # ← 反馈来源改成聚合节点
    entry: profile
    exit: decide        # ← 裁判叶子改成聚合节点
    iterations: 10
    nodes: [profile, idea, tournament: race, decide]
```

`decide` 是一个**普通 stage**（新 worker，或复用 `cuda-summary` 的思路），输入是
`race` 的 winner + （`02`-M1 后）三条 lane 的结局，输出：
`{ decision: KEEP | NO_IMPROVEMENT | CONVERGED, reason, consecutive_no_improvement, next_focus }`。

这一步的收益：plateau 被**显式记录**、被 `summary` 读到、被报表统计到，
并且它天然是 `02`-M1（lane 摘要聚合）的落点。**不需要改引擎**——`loop.exit` 与 `loop.feedback`
都已经是"直接子节点名字"，`topsop-tuning.yml` 用的就是这个形状（`exit: measure` / `feedback: measure`，
两者都是普通 stage）。改动是一个新 recipe + 一个新 worker/契约。

（注意：tournament 自己的裁判由它**内部**的 `exit: measure` 决定，与 loop 的 `exit` 是两层；
改 loop 的 exit 不改变 race 的选优。这一点建议先跑一条最短的 smoke 变体确认。）

**第二级：引擎支持"循环提前退出"。**

`topsop-tuning.yml` 的注释说明现状"the only early termination is a terminal block"。
要让 `CONVERGED` 真正结束循环，需要引擎新增一种**非错误性的终止信号**
（与 `blocked` 区分：blocked 是失败，CONVERGED 是成功到达结论）。

设计要点：终止信号必须由**exit stage 的结构化输出**表达（契约字段），
不能是自由文本——否则引擎无法可靠判定。

#### 证据

- KernelArc（arXiv:2608.17071）：**plateau-triggered drafting**——停滞被检测后触发新动作。
- `topsop-tuning.yml`：`CONVERGED` + `next_variable: null` 已是既有语义（未控制化）。
- μCUTLASS + SOL：对近 SOL 的问题**降优先级**，是"该少花力气"的判断形态。
- KernelBrain：承认 "search often stalls early" 并把资源重分配作为核心机制。

#### 风险 / 待裁定

- 第一级无风险，建议**立即做**。
- 第二级（提前退出）需你裁定：`CONVERGED` 是否**必须**绑定"目标不可达"，
  还是也允许"改进停滞 N 轮"触发？（建议两者都可，但来源分不同字段，便于事后区分。）
- 与 `01`-M2 的耦合：`indeterminate` 轮次**不应**计入"改进停滞"以外的统计口径，
  否则噪声大的 run 会过早收敛。建议：判定用"连续 N 轮既无 admitted 也无有意义的改进方向"，
  而不是"连续 N 轮无 admitted"。

---

### M4 — SOL 引导（把 topsop-theory 迁移到 CUDA 锦标赛）

#### Motivation

两个用途，都很实在：

1. **停机**：如果已接近硬件上限，继续搜是浪费。
   SOLAR（arXiv:2606.26383）的目标就是"自动推导并验证 SOL 上界"，
   用途一栏明确写了"headroom analysis at multiple fidelity levels"——
   也就是**用剩余空间决定还值不值得搜**。
2. **识别 gaming**：μCUTLASS 的论文明确说 "SOL analysis helps detect benchmark-gaming cases,
   where kernels may appear fast while failing to perform the intended computation"。
   这句话对 PIANO 特别重要：PIANO 的防作弊主要靠 prompt 规则（禁库调用）+ 数值校验，
   缺一个**物理侧的信道**（"这个速度在物理上可能吗"）。

而 PIANO 已经有现成的能力：`topsop-theory` 阶段的 SKILL 已经要求产出 roofline 上限
（`theory_min_us`、`bandwidth_utilization`、`read_write_balanced`）且**契约会校验算术一致性**。

#### 机制

在 CUDA 锦标赛的 `setup` 之后加一个 `baseline`/`theory` 阶段（与 topsop 的 `theory` 同形）：

- 输出：`theory_min_us`、`bandwidth_utilization`、`compute_utilization`、`headroom`、
  以及 SOL Score（相对硬件上限已闭合的比例，SOL-ExecBench 的定义）。
- 用途：作为 `decide`（M3）的输入之一 → 影响停机与 `count`（`03`-M7）。

**降级路径必须先定**：`recipes/cuda-profile/agents.md` 已声明可能出现 `timing-only`
（硬件计数器不可用时，"do not fill missing counters with guesses"）。
所以 SOL 计算必须在无计数器时仍能给出**较弱但诚实**的界（例如仅基于内存带宽与 FLOPs 的分析界），
并在契约里显式标注是"分析界"还是"实测界"。

#### 证据

- SOLAR（arXiv:2606.26383）：自动推导 validated SOL bounds，**零次 SOL 违规观测**，
  多保真度分析；用于 headroom、机会识别、跨平台探索、反向 roofline 硬件配置。
- SOL-ExecBench（arXiv:2603.19173）：235 个来自 124 个生产/新兴模型的 CUDA 优化问题，
  SOL Score 量化"相对硬件 SOL 上界闭合了多少"，并配套沙箱 harness 与反作弊静态检查。
- μCUTLASS + SOL（arXiv:2603.29010）：SOL 估计 headroom 引导与预算搜索、降优先级、
  识别 gaming；省 19-43% token 保 ≥95% geomean，最优策略 1.68x 效率增益。
- `topsop-theory`（仓库内）：已有 roofline 与一致性校验的实践。

#### 风险

- 需要一个 **case 提供足够的物理参数**（带宽、峰值 FLOPs、目标 shape）。
  case 不提供时该阶段需能合法 `blocked`（现有 `cuda-profile` 已有 `blocked` 语义可借鉴）。
- SOL 是**上界**，不是可达目标；把 SOL 当 target 会持续失败。
  建议只在 `decide` 里当作"还值不值得搜"的信号，**不**作为裁判 metric。

---

### M5 — 代理模型 / 性能预测

#### Motivation

随着搜索规模扩大，**在真机上评测成为瓶颈**。
GPU Forecasters（arXiv:2605.31464）的核心主张：LLM 可以作为**选择性代理**预测相对性能，
而"选择性"是关键——代理必须**知道什么时候自己可能错，并交还给 GPU**。
它的实验显示：同一 GPU 评测预算下可以考察数倍候选，最终找到更快的 kernel。

对 PIANO 的含义：`03`-M7 想加宽扇出、`03`-M2 想加组合轮，都会放大评测次数。
代理模型是让这些变便宜的一种方式。

#### 机制

不替换真机评测，而是**排序**：用代理给候选排序，真机只评 top-K。
必须保持"选择性"（低置信度时退让），否则会引入系统性偏差。
验证方式照抄论文：准确率、**校准度（calibration）**、以及在有限 GPU 预算下能否真找到更快的 kernel。

#### 证据

- GPU Forecasters（arXiv:2605.31464）：LLM 能准确预测相对 kernel 性能；
  RL 可提升准确率与置信校准；用于搜索后在同预算下找到更快的 kernel。

#### 风险

- **这是 P4，不要先做**。理由：(a) PIANO 今天的问题是"判决不可信"（`01`）与"记忆缺失"（`02`），
  不是"评测次数太多"；(b) 代理引入新的偏差源，在 `01` 没做完之前无法评估它的伤害。
- 需要跨 run 的历史数据做训练/校准 → 依赖 `02`-M5。

---

### M6 — 多轨预算口径

#### Motivation

见洞察 4。只按轮数计预算会掩盖两种极端：一轮可能 6 小时（`idea` 的 enflame 网关首 token
可达 ~2h，`topsop-tuning.yml` 注释记录过 idea 一次跑到 ~5h），也可能几分钟。
"10 轮"不等于"可控的成本"。

而且成本数据**已经在收集**：`token-usage.jsonl`（含 `reported`/`delta`/`reset` 与合并逻辑）、
`duration.jsonl`。缺的只是"把它变成判据"。

#### 机制

- **主口径：wall clock**。run 级总预算 + 每阶段的比例告警（不是硬失败——`timeout` 已承担硬保险）。
- **副口径：token**。用于比较"不同工作流变体在同等效果下的成本"
  （这正是 KOPE 报告 15.9B → 1.113B 的方式）。
- **上限：轮数**。保留现有 `iterations` 作为结构性上限。
- **落点**：`summary` 输出 + evals 报表列 + （`03`-M7）宽度决策的输入。

一个低成本的中间形态：**在 `decide`（M3）里加一条"预算剩余"输入**——
`decide` 已经每轮都在跑，读 `duration.jsonl`/`token-usage.jsonl` 的累计值即可，
产出"本轮是否应当缩减探索"。这不需要引擎改动。

#### 证据

- AutoLab（arXiv:2606.05080）：36 个长时程任务以**严格 wall-clock 预算**为约束，
  并把"time awareness"列为 agent 的关键能力缺失。
- KOPE（arXiv:2608.25570）：以 token 为对照口径（15.9B → 1.113B）。
- SpecGen（arXiv:2606.17518）：固定 time 与 token 预算下比较。
- Trellis / KernelEvolve（arXiv:2606.29823）：跨 session 复用让达到同一目标快约 10x、
  token 少 52%——也是以"达到目标的成本"为口径。

#### 风险

- 低。唯一注意：预算读数来自轨迹流，若 recorder 失败按既有设计是
  "evidence failure, not workflow-result failure"（`docs/workflow-trajectory-evaluation-prd.md`
  的 Deliberate implementation choices 第 2 条）——所以**预算判据不能因为读数缺失而失败**，
  必须有默认行为。

## 6. 落地顺序与验收

| 步 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| 1 | **M3 第一级**：loop 内加 `decide` 节点 + plateau 计数 | 无（纯 DSL + 新 recipe） | 一个 10 轮 run 的 `decide` 输出里有连续未改进计数，且 `summary` 引用它 |
| 2 | **M6**：`decide` 读累计 wall clock / token，产出缩减建议 | 步 1 | 报表里能看到每轮累计成本 |
| 3 | **M1**：implement 内"粗测"字段 + 只做淘汰用（**需确认：分级只淘汰、裁判统一高保真**） | 无 | 被粗筛淘汰的候选在证据里可见 |
| 4 | **M3 第二级**：循环提前退出（`CONVERGED` 控制化） | **需裁定终止信号的数据形态** | 提前退出的 run 与跑满的 run 判据来源可区分 |
| 5 | **M4**：SOL/baseline 阶段迁移 | case 需提供物理参数；需定 `timing-only` 降级 | `blocked` 时诚实报 blocked，不猜数 |
| — | M2 / M5 | — | M2 需 case 声明目标；M5 在 `01`/`02` 之后 |

## 7. 参考文献

arXiv:2608.02611（KernelBrain）、arXiv:2606.17518（SpecGen）、arXiv:2606.05080（AutoLab）、
arXiv:2608.17071（KernelArc）、arXiv:2606.26383（SOLAR）、arXiv:2603.19173（SOL-ExecBench）、
arXiv:2603.29010（μCUTLASS+SOL）、arXiv:2606.26453（KernelPro）、arXiv:2605.31464（GPU Forecasters）、
arXiv:2608.25570（KOPE）、arXiv:2606.29823（Trellis/KernelEvolve）

内部依据：`recipes/workflows/topsop-tuning.yml` 与 `gpu-cuda-tuning-tournament.yml` 的头部注释、
`packages/orchestrator/src/workflow.ts`（`timeout` 定义）、
`packages/trajectory/src/recorders.ts`（token/duration recorder）、
`docs/workflow-trajectory-evaluation-prd.md` §20、`docs/WORKLOG-TOURNAMENT-2026-09-04.md`
