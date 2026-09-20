# 00 — 调研原始记录（transcript 存档）

> **编辑说明（非原文）**：本文是 2026-09-11 那次"上网调研算子调优论文/方案并与 PIANO 对照"的
> **回复原文存档，逐字保留未做删改**。`01`-`07` 各模块文档是从这份原始记录整理、扩写、
> 并补上代码证据之后的产物；本文件用于保留最初的完整版（含当时给出的维度对比表、
> 文献分组、以及最初版本的优化方向清单），便于回溯"结论是怎么来的"。
> 原文中的文件名、行号、commit 均为当时核实的状态。
>
> 一处差异需要说明：`01`-`07` 里引用的部分工作（AlphaLab、StitchCUDA、AutoLab、Xe-Forge、
> HIERA、CuTeGen、FACT、MKEvolve、KernelPro、EGG、AgentKernelArena 等）
> 来自写模块文档时的**追加检索**，因此其中一部分**不在本存档里**——
> 本存档只包含当时那一次回复的内容，未做增补。

---

我把两边都读完了。先说一个**命名澄清**：仓库里并不存在 `topsop-tuning-tournament`。实际存在的是两条流 —— 顺序单变量版 `recipes/workflows/topsop-tuning.yml`（8 轮，profile→idea→implement→verify→measure）和锦标赛版 `recipes/workflows/gpu-cuda-tuning-tournament.yml`（10 轮，每轮 `idea` 出 3 个策略 → `race` 3 条 lane 并发→ 单一 metric 裁判选出 winner）。下面按你的意图，以**锦标赛版为对照主体**，顺序版仅在它更接近某个论文机制时提及。如果你的对象是别的，告诉我。

---

# 一、PIANO 现状（机制基线，带证据）

| 环节 | 实现 |
|---|---|
| 候选生成 | `idea` 一次产出 `strategies[]`（`minItems: 3`，要求不同 bottleneck/technique 族、禁参数扫描单一旋钮、`predicted_speedup` 只是假设）。`count: 3` 固定扇出宽度 |
| 执行 | `tournament: race`，lane 内 `implement`（compile+run+数值校验）→ `measure`。`parallel` 默认 **true**，并发度 `"unbounded"`（`workflow-execution.ts:3591`） |
| 隔离 | 整场 race 用同一种容器（clean git → detached worktree；否则目录快照），策略在 `allocateMapWorkspace` 一次性决定 |
| 裁判 | exit stage 契约声明的**唯一** metric（2+ metric = load 期 validate error）。比较 `best` 按 `direction`；tie 先按 fan index，再按 `changedFiles`/`changedLoc`（`selection.ts`） |
| 跨轮闸门 | `admitWinner` 对比 incumbent：必须**严格改进同一 metric 身份**，否则 `admitted-not-carried`（regression guard）；incumbent 由 `tournamentIncumbentKey` 跨 loop 轮次维持 |
| 归并 | 引擎只排序（纯函数）；winner 自己的 worker 在父 scope 重新打开、应用冻结 delta；引擎只做一次只读目录 diff gate，不符就精确回喂重试 |
| 持久化 | `rounds/iter-NNN.json`、`state/tuning-state.json`、`profiles/`、`reports/verify.json`、`bench/`、`asm/`、`trajectories/{benchmark,duration,token-usage,tool-calls,selection}.jsonl`、契约快照按 digest |
| 轮间传递 | loop `feedback: race` → 下一轮 `profile` 只拿到 **winner 的 terminal result group**（`workflow-execution.ts:3457-3465`） |

**两条关键的、可验证的事实**（不是我的推测）：

1. `selection.jsonl`（含每个 lane 的 referee/winnerKey/carrying reason）**没有任何生产代码读取** —— 全仓库 grep 的消费者只有测试和文档。败者证据落盘了，但不回流。
2. 运行时 admission 调用把 `runnerUpKeys` 硬写成 `[]`（`workflow-execution.ts:3219`），而 `selectWinner` 本来算好了它。亚军信息在运行时被丢弃。
3. region 退出后 `cleanupMapWorkspaces` 删掉所有 slot workspace（除非 `preserve`）。
4. 默认并发 = 3 条 lane 同时在同一张 GPU 上跑 benchmark。`docs/WORKLOG-TOURNAMENT-2026-09-04.md` 已经记录了后果：3 个 run 抢 GPU 时噪声大到出现 exact-tie 被拒。

---

# 二、近期文献（2026 为主，按机制分组）

**A. 与 PIANO 结构最接近的三个工作**

- **KernelArc**（arXiv:2608.17071）：策略特化 agent 并行 + **conclusions-only 共享记忆** + **deterministic benchmark guard** + 只读跨 agent 状态 + **plateau-triggered drafting**。H100/B200 上 SOL-ExecBench 各 L1/L2/量化/FlashInfer 任务第一。→ 几乎就是"带共享记忆与停滞触发的 PIANO 锦标赛"。
- **Kernel-Smith**（arXiv:2603.28342）：维护**可执行候选群体** + "top-performing **and diverse**" archive + 结构化编译/正确性/加速比反馈；并把长轨迹转成 step-centric 监督+RL。KernelBench(SGLang/LMDeploy 上游落地)。
- **Kernel Foundry / KernelFoundry**（arXiv:2605.30359 / 2603.12440，ICML'26）：**multi-island 进化**、诊断驱动精化、集中经验库、**MAP-Elites 质量多样性**（行为维度维持探索）、**meta-prompt 与 kernel 共同进化**、模板化参数优化。

**B. 搜索记忆 / 知识复用**

- **KOPE**（arXiv:2608.25570）：Experience Graph Memory + 固定 token 预算的主动上下文注入 —— pass rate 60.0%→84.6%，token 消耗 **15.9B→1.113B**（同基座）。
- **Trellis / KernelEvolve**（arXiv:2606.29823，Meta 生产）：把经验图做成数据库，"cross-session reuse 让达到目标加速比快 ~10x、token 少 52%"。前沿选择=查询，跨 session 复用=向量检索。
- **HTAM**（arXiv:2605.29734）：两层 Hierarchical Transition Graph 组织"粗全局方向 + 细局部策略 + 转移经验"，明确解决"粗提示不可执行 / 细记忆爆搜索空间"的粒度错配。
- **AdaExplore**（arXiv:2604.16625）：把**反复失败**转成可复用的 validity rules 记忆；搜索侧用**树**交替"小步局部微调"与"大步结构性重生成"。L2 3.11x / L3 1.62x（100 步内）。
- **EvoMem**（arXiv:2608.10795）、**daVinci-kernel**（arXiv:2606.16497，技能库 RL）、**KernelSkill**（arXiv:2603.10085，双级记忆）、**SkillEvolver**（arXiv:2605.10500，在线 skill 学习，KernelBench 1.16→1.51）。

**C. 预算 / 保真度 / 代理模型**

- **KernelBrain**（arXiv:2608.02611）：coarse-to-fine、预算感知、策略门控评测 —— 低代价筛很多候选，只给幸存者高保真预算；**最多省 48% 优化时间**，并显式承认"runtime measurements are noisy"。
- **GPU Forecasters**（arXiv:2605.31464）：LLM 当**选择性代理**预测相对性能，能在同一 GPU 预算下考察数倍候选。
- **SpecGen**（arXiv:2606.17518）：推理轨迹中途 fork 出额外候选、验证/评测池动态重分配与优先级、达标提前终止推理 —— "固定 time/token 预算下的加速"。
- **μCUTLASS + SOL 引导**（arXiv:2603.29010）：SOL 估计 headroom 来**引导与预算**搜索、对近 SOL 问题降优先级、并**标记 gaming kernel**；省 19-43% token 且保住 95% geomean。
- **SOLAR**（arXiv:2606.26383）/ **SOL-ExecBench**（arXiv:2603.19173，235 个生产 kernel，锁频 + 清 L2 + 隔离子进程 + 反 reward-hacking 静态检查）。

**D. 评测保真 / 反作弊 / 泛化**

- **hacker-fixer loop**（arXiv:2606.08960)：三 agent 交替攻防，KernelBench 攻击成功率 **62%→0%**。
- **KernelBench-Verified**（arXiv:2607.16241）：TF32 真实基线 + 四分布隐藏测试；同一模型 1.43x → **0.88x**；**28% 生成 kernel 抬高峰值显存**。
- **The Correctness Illusion**（arXiv:2606.20128）：固定 shape 的 allclose 放过 9/9 人为转录 bug。
- **Gaming Without an Attacker**（arXiv:2608.08722）：无对抗提示下 16/53（30%）胜出不迁移到 held-out 配置；held-out 探针**只在不可枚举轴上**有效。
- **AgentKernelArena**（arXiv:2605.16819）：unseen-configuration 泛化协议。
- **Atrex-Bench / AKA**（arXiv:2607.14541）：算子与 shape **从生产 trace 采样并按 GPU 时间加权**；最好的 vanilla 模型只到硬件 roofline 的 ~10%，且大量"通过"来自 PyTorch fallback。
- **ForgeStencil**（arXiv:2609.06694）：measurement-integrity harness **把夸大速度变成系统级错误**；并发现大部分收益来自**结构性/host 侧改写**而非 kernel 替换。

**E. 与硬件确定性/抽象层相关**

- **Taming Bitwise Behavior**（arXiv:2609.11356）：tile shape 决定算术，**autotuner 无法识别哪些配置位等价**；固定归约序可花掉最多 20%。
- **Argus**（arXiv:2604.18616）：data-flow invariants 把稀疏的 pass/fail 反馈变成带**反例（线程/元素/程序点）**的稠密反馈。
- **AsmEvo**（arXiv:2608.20711）：编译产物差分验证（ABI 保持 + 同 launch 下对 K0 差分）。
- **Harness Engineering**（arXiv:2607.17979）、**Agentic Kernel Optimization / Houmao**（arXiv:2608.14560）：harness 与 controller 分离、人在编排位；**Agent-Assisted 稳定优于 Full-Agent** —— expert 方向与高质量 reference 仍是关键。
- **Correct but Slow**（arXiv:2607.04454）：库相对效率 + roofline 利用率两个轻量筛子可互补标出全部"正确但低效"kernel。

---

# 三、维度对比

| 维度 | PIANO 现状 | 文献主流 | 差距 |
|---|---|---|---|
| **搜索拓扑** | 每轮重建 3 个互斥候选，winner-take-all | 候选群体/archive、multi-island、MAP-Elites、树搜索、beam、推测式 fork | 无群体、无 archive、无"局部微调↔结构重生成"的交替、扇出宽度固定 |
| **搜索记忆** | 文件落盘但**零生产消费者**；`selection.jsonl` 只被测试读；败者缺席下一轮 | 经验图/转移图/技能库 + 预算化检索（KOPE/Trellis/HTAM/EvoMem/daVinci） | 缺"检索→注入"这一环，等于每轮从零再想 |
| **裁判** | 单 metric `best` + 严格改进闸门（**这是优点**，文献少见） | 单/多目标、SOL 相对分、约束感知 | 无统计意义阈值、无显存/能耗/编译期、tie 规则是代码改动量而非成本 |
| **测量保真** | 默认 3 lane 并发同卡；单次采样 | 锁频、清 L2、隔离子进程、重复采样、policy-gated、deterministic guard | **默认架构性引入测量争用**，且噪声直接变成拒收决定 |
| **预算/保真度** | 每 lane 都跑完整 implement+verify+measure | coarse-to-fine、代理模型、early-exit、动态 GPU 池 | 无分级、无提前淘汰、无代理 |
| **抽象层/搜索空间** | 固定"手写自定义 kernel" | HIERA 实现空间选择、FACT/CuTeGen/CUTLASS 模式组合、μCUTLASS DSL、MKEvolve 模块级分解融合 | 无实现空间选择、无组合/模板化参数搜索层 |
| **SOL/headroom** | **topsop 流有**（`topsop-theory`：roofline 上限、`theory_min_us`、`bandwidth_utilization`），CUDA 锦标赛**完全没有** | SOL 驱动引导+预算+停机+识别 gaming | 已有能力未迁移到锦标赛 |
| **反作弊** | prompt 禁库调用 + 不可变 harness + 数值校验 | 对抗攻防 loop、隐藏分布、SOL 侧信道、显存指标 | 无 hidden/held-out、无显存/侧信道检查 |
| **泛化** | 只测 case 固定 shape | unseen-configuration 协议、生产 trace 加权 shape | 单配置过拟合不可见 |
| **停止判据** | 固定 10 轮 | plateau 触发、budget-aware、达标早停 | 无停滞检测、无预算感知 |
| **成本核算** | **有** `token-usage.jsonl` / `duration.jsonl`（强项） | 固定 time/token 预算下比较 | 记录不参与 admission |
| **prompt/skill** | recipes 静态 | meta-prompt 共同进化、在线 skill 学习、轨迹转训练信号 | 无自演化 |
| **归并严谨性** | 引擎只排序 + worker 自归并 + 只读 gate + 事务保护（**强项**） | 多为外部脚本合并 | — |

---

# 四、可优化方向

## A 档：低风险，落在现有契约/prompt 内

**A1. 让"裁判"抗噪（最高性价比）**
现状：单次采样 + 严格改进闸门 + 3 lane 同卡并发 ⇒ 真改进会被当 regression 拒收（worklog 有现场）。
依据：SOL-ExecBench 的锁频/清 L2/隔离子进程；KernelBrain 的 policy-gated evaluation；ForgeStencil 把夸大速度变系统级错误；KernelArc 的 deterministic benchmark guard。
建议：`cuda-benchmark-store` 契约要求 K 次重复并报告样本分布与变异系数；引擎侧把"改进量落在本轮测量噪声带内"判为 tie（不 carry、也不计入 regression）；`direction` 语义不变。
落点：`recipes/cuda-benchmark-store/contract.json` + `agents.md`（契约/prompt 级）；噪声带判定要动 `selection.ts` 的 admission（**需设计裁定**：阈值放契约还是引擎）。

**A2. 把败者证据接回下一轮**
现状：`selection.jsonl` 写了没人读；下一轮只拿到 winner。
依据：KOPE（60.0%→84.6%，token 15.9B→1.113B）、Trellis（跨 session 复用 -52% token）、HTAM（粒度错配）、AdaExplore（失败→validity rules）。
建议（**有两条路，需你裁定**）：(i) 契约/prompt 级：让 `measure` 的 resultPayload 携带本 lane 的 `{strategy_id, metric, failure/stage, diagnostics}`，由 winner 的归并轮汇成 `rounds/iter-N-lanes.json`；下一轮 `idea` 读它。(ii) 引擎级：把 region 的 loser 结果以只读形式暴露给一个 region 之后的 `aggregate` stage（PRD §5.1 当年**有意**决定只暴露 winner，这是一次设计反转）。
风险：(ii) 触碰 PRD 已裁定的语义，必须显式讨论。

**A3. 用已有 DSL 表达"轮内汇总 + 停滞检测"**
建议：loop 内加第 4 个节点 `aggregate`（`from: [race]`）并把 `exit` 改为 `aggregate`、`feedback: aggregate` —— **纯 DSL，不改引擎**。它同时是 A2 的聚合点、D9 的 plateau 判据点（连续 N 轮 `admitted-not-carried` 就产 `CONVERGED`，与 topsop 流已有的 `CONVERGED` 语义对齐）。
依据：KernelArc 的 plateau-triggered drafting；topsop 流 §9 单变量循环已有"收敛/next_variable: null"先例。

**A4. advisor/reference 密度**
依据：Harness Engineering 明确"Agent-Assisted 稳定优于 Full-Agent"，expert 方向 + 高质量 reference + workload context 仍是关键；EGG 的专家两阶段分解。
建议：给 `cuda-idea-tournament` 增加"每 case 的 reference kernel / 已知最优技术清单"输入位（现为无）。

## B 档：需设计裁定（引擎或评测设定）

**B1. 测量串行化 / 资源互斥**
现状：DSL 只有 region 级 `parallel`，没有 per-stage 资源锁；`-serial.yml` 把 implement 和 measure **一起**串行，牺牲了并行度。
依据：SpecGen 动态分配验证/评测 GPU 池并按压力排优先级；KernelArc 的 deterministic guard。
建议：引入"资源/互斥"概念（`stage.resource: gpu` 之类），使 implement 并发 + measure 互斥。这是**新 DSL 概念**，必须走设计讨论。

**B2. 从 winner-take-all 到 archive/population**
依据：CUDA-L1 的"优化具有乘性、并学会组合"；CUDA-L2 系统探索配置空间；Kernel-Smith 的 diverse archive；KernelFoundry 的 MAP-Elites；AdaExplore 的树 + 两档变异；POLCA 的优先队列 + ε-net 多样性 + 历史摘要。
建议：保留 K 个候选（不为每轮清空），允许"亚军的正交改动与冠军叠加"作为一类 lane（注意与 A1 的噪声带判据耦合）。

**B3. 多目标裁判**
依据：KernelBench-Verified（28% 抬高峰值显存）、KernelPro（能耗 -11.6%）、bitwise 论文（tile shape 改变算术、位等价类不可由 autotuner 识别）。
建议：把"显存峰值 / 确定性 / 位等价"作为**约束**而非第二 metric（因为引擎的 validate 期 arity 检查禁止 2+ metric，这是硬语义）。约束化的落点是 exit 契约的 required 字段 + gate。

**B4. SOL 迁移到锦标赛**
依据：SOLAR、SOL-ExecBench 的 SOL Score、μCUTLASS 的 SOL 引导预算与 gaming 识别。
建议：把 topsop 的 `topsop-theory` 思路（roofline ceiling、`theory_min_us`、`bandwidth_utilization`）引入 CUDA 锦标赛作为 `baseline` 阶段：驱动 (a) 候选预算，(b) `CONVERGED` 判据（利用率已贴近上限就停），(c) gaming 识别。注意 `cuda-profile/agents.md` 已声明可能出现 `timing-only`（无硬件计数器）—— 需要 fallback。

**B5. 反作弊与泛化评测**
依据：hacker-fixer loop（62%→0%）、KernelBench-Verified（四分布 + TF32 基线 + 显存）、Correctness Illusion（固定 shape allclose 放过 9/9 bug）、Gaming Without an Attacker（30% 不迁移；held-out 只在不可枚举轴有效）、AgentKernelArena（unseen 配置）。
建议：这是**评测设定**层的事，但会反过来决定工作流是否值得优化：加 held-out shape、随机化输入、显存/时间侧信道检查、禁止 PyTorch fallback 计入通过（Atrex 指出"通过率很大部分来自 fallback"）。

## C 档：超出当前范围（先记账）

**C1 实现空间选择**（HIERA：在 PyTorch op / CUDA 库 / 自定义 kernel 之间选）。与现有 case 契约"必须纯自定义 kernel"直接冲突 —— 属评测定位问题，先不要动。
**C2 prompt/skill 自演化**（KernelFoundry meta-prompt 共同进化、SkillEvolver 1.16→1.51、EFT 把轨迹转训练信号）。需要跨 run 的经验库与审计机制（SkillEvolver 还强调"fresh-agent overfit audit"以防 silent bypass），工程量大。
**C3 代理模型/多保真度**（GPU Forecasters、KernelBrain）。收益明确但需要额外模型或多次评测设施。

---

# 五、我建议的下一步

按"证据强度 × 落点清晰度"，我推荐这个顺序：

1. **A1 + A3 一起做**：一个噪声带判据 + 一个 `aggregate` 节点。两者都不改引擎核心语义（A1 的阈值判定点待你裁定），且直接改善"每轮决策质量"与"何时停"。
2. **A2 的路线裁定**：先确认是"契约/prompt 携带 lane 摘要"还是"引擎暴露 loser"。这决定了后面 archive（B2）是否可行 —— 因为它同样需要 loser 数据活着。
3. **B1 的实验**：现有 `-serial` 变体已经给了 A/B 的对照臂；可以先量化"测量争用对决策的影响"（多少真改进被噪声拒收），有数据再决定是否引入资源互斥概念。
4. 台账化 **B5/C1**：它们是评测设定问题，需要你先定"我们要证明 PIANO 的什么能力"，否则优化方向会漂。

---

需要的话我可以把这份调研落成 `docs/` 下的一篇笔记（对齐 `docs/deep-dive-notes/` 或 PRD 的写法），或者直接把 A1/A3 拆成可评审的 GitLab issue。要哪个，或者两个都要？
