# 06 — 资源调度与并发

## 0. 这个模块是什么

这个模块管的是**谁、在什么时候、用哪台设备**。

在 PIANO 里这一层非常薄：

- **DSL**：只有一个 `tournament` region 级的 `parallel?: boolean`（`workflow.ts`），
  没有 stage 级的并行/互斥概念，也没有"资源"这个类型。
- **调度器**：region 内的 lane 用 `Effect.all(..., { concurrency: ... })` 并发，
  并发度是 `region.parallel === false ? 1 : "unbounded"`（`workflow-execution.ts:3591`）。
- **跨 run**：无任何协调。多个 `piano` 进程各跑各的。

## 1. 它用来干嘛

两件事：

1. **让测量可信**——这是与 `01` 直接相邻的目标。并发跑 benchmark 会让测量互相污染。
2. **让设备不空转**——与 `04` 相邻。`idea` 阶段（`thinkingLevel: high`）可能跑很久，
   期间 GPU 空闲；而 `implement`/`measure` 需要 GPU。

这两个目标经常**互相冲突**：想测量准就要独占，想不空转就要并发。
所以本模块的核心问题是**区分**："哪些工作必须独占，哪些可以并行"。

## 2. 关键洞察

> **PIANO 的默认并发策略把"必须独占"的测量当成了"可以并行"的工作，
> 而且这个污染源是架构性的、每天都在发生的。**

**洞察 1：默认 `"unbounded"` 意味着 3 条 lane 的 benchmark 同时抢一张卡。**

`workflow-execution.ts:3591` 的并发度是 `"unbounded"`，
而 `gpu-cuda-tuning-tournament.yml` 的注释明确写了 *"`race` omits `parallel`,
so its three strategy lanes run concurrently (the tournament default)"*。

这不是理论风险，仓库里有现场记录。`docs/WORKLOG-TOURNAMENT-2026-09-04.md`：

> tournament run 完整走通：10 iter × 3 lane，selection 流 5 carried + 5 no-winner，
> 每条 no-winner 都带 `admitted-not-carried` reason（regression guard 正常；
> **当时 3 个 tuning run 并发抢 GPU，测量噪声大，iter-9 甚至出现
> exact-tie 7.511289==incumbent 被正确拒绝**）。

注意这里的量级：**3 个 tuning run 并发**，每个 run 又有 3 条 lane 并发——
也就是最多 9 个 benchmark 在同抢一张卡。
这条记录里"regression guard 正常"是正确判读（没有真改进就该拒），
但它同时说明判决已经贴着噪声底在跑（exact tie 意味着分辨力已经丧失）。

**洞察 2：DSL 里的开关粒度不对——它同时串行了该并行的和该串行的。**

唯一的开关是 region 级 `parallel`，而 `gpu-cuda-tuning-tournament-serial.yml` 的注释是诚实的：

> This is the serial arm of the experiment: `gpu-cuda-tuning-tournament.yml`
> under a different workflow name, with `race` declaring `parallel: false` so ...
> `piano evals --parallel` matrix option.

`parallel: false` 把 **implement 和 measure 一起**串行了。这不是最优解：
`implement` 是 agent 写代码 + 编译（GPU 占用低、CPU/网络占用高），
`measure` 是纯 benchmark（必须独占 GPU）。
**理想的调度是"implement 并发、measure 互斥"**，但 DSL 表达不出来。

**洞察 3：这个 A/B 实验是免费的，而且数据已经在产生。**

`serial` 变体已经存在，`--parallel` matrix 选项也已经存在。
也就是说：**"并发造成的损失有多大"这个问题可以用现有工具量化**，
不需要先设计新概念。这是一个应当**先测量再改**的典型情况。

**洞察 4：文献把这件事当作一等系统问题，而不是参数调优。**

SpecGen（arXiv:2606.17518）把"validation/profiling 资源利用不足"列为 agentic kernel 优化的
三大系统级低效之一，并给出两个具体机制：

- **动态重分配 validation/profiling GPU 池**（按到达率）；
- **请求优先级**（降低突发推测生成负载下的 profiling 反馈延迟）；
- 另外还利用 validation/profiling GPU 的空闲内存做远端 KV cache 存储，
  以消除推测生成的 prefix 重算。

KernelArc（arXiv:2608.17071）用的是另一条路：**deterministic benchmark guard**
——不靠"保证独占"，而是靠**确定性的测量守卫**让并发下的比较仍然可靠。

**洞察 5：跨 run 的资源冲突是 PIANO 特有的放大器。**

PIANO 的 `piano evals --parallel` 矩阵会把同一 case 的多个工作流变体**同时**跑起来
（`docs/WORKLOG-TOURNAMENT-2026-09-04.md` 记录了 3 个 tuning run 同时存在），
而它们之间**没有任何协调**。单 run 内部的并发问题在这里被乘了一遍。

## 3. 影响效果的关键因素

| 因素 | 为什么关键 | PIANO 现状 |
|---|---|---|
| **哪些工作需要独占** | 决定的本质：测量需独占，构建不需要 | 未区分，全部按 region 开关 |
| **并发度上限** | 无上限 = 争用无上限 | `"unbounded"` |
| **资源声明粒度** | 太粗→该并行的被串行；太细→DSL 复杂化 | 只有 region 级 |
| **排队公平性** | 先到先得会让长任务饿死短任务 | 无队列概念 |
| **死锁风险** | 引入锁/资源声明就可能死锁 | 无 |
| **跨 run 协调** | 未协调的多进程会把单 run 的问题放大 | 无 |
| **测量条件记录** | 无法识别"不可比的测量" | 无（见 `01`-M3） |
| **设备健康** | 锁频/清 L2/热状态影响可比性 | 无（属 harness 职责） |

## 4. 方法总览

| 编号 | 方法 | 落点 | 风险 | 优先级 |
|---|---|---|---|---|
| M1 | DSL 引入"资源/互斥"概念 | `workflow.ts` + 调度器 | 中高（新 DSL 概念） | P2 |
| M2 | measure 互斥（限流），implement 保持并发 | M1 的特例 | 中 | P2 |
| M3 | 动态池 + 优先级（排队而非锁） | 调度器 | 中高 | P3 |
| M4 | **先用现有 serial 臂量化损失** | 无（已有） | **低** | **P0** |
| M5 | 测量条件声明与设备健康检查 | harness + 契约 | 低 | P1 |
| M6 | 跨 run 资源协调 | 进程间机制 | 中 | P3 |

## 5. 方法逐一

### M1 — DSL 引入"资源/互斥"概念

#### Motivation

现状的唯一开关是 region 级 `parallel`，它把两种性质完全不同的工作绑在一起：

| 阶段 | 主要资源 | 能否并发 |
|---|---|---|
| `implement`（写代码、编译） | CPU / 网络 / agent 推理 | 能，且应该（GPU 占用低） |
| `measure`（benchmark） | **GPU 独占** | 不能 |
| `idea`（推理） | agent 推理 | 能（但见 `03`-M6 的重叠机会） |
| `profile` | GPU（低强度） | 需谨慎（会改缓存状态） |

要表达"implement 并发、measure 互斥"，DSL 需要一个**资源**概念。

#### 机制

有两种形态，风险差别很大：

**(a) 命名互斥组（保守）**：stage 声明 `exclusive: true`（或 `resource: "gpu"`），
引擎保证同一资源上同时只有一个 stage 在跑。语义简单、可分析（不会有死锁，
因为 region 内的 stage 拓扑是 DAG 且互斥集是静态的）。

**(b) 资源容量（灵活）**：`resource: { name: "gpu", capacity: 1 }`，
允许多资源、多容量。表达力强但复杂度和死锁分析成本上升。

**建议 (a)**。理由：PIANO 的 DSL 取向是"薄"——
`docs/workflow-trajectory-evaluation-prd.md` §20 明确把 `metrics`/`recorder`/`select`
这类字段列入 **Rejected**（"The voice is implementation-ready"，只保留必要字段）。
一个布尔开关比一个资源系统更贴合这个取向。

另一个关键设计问题：**互斥是"阻塞"还是"排队"？**
- **阻塞**（lane 等锁）：简单，但会让先抢到锁的 lane 决定顺序，先到先得；
- **排队**（按优先级/公平性）：更优，但需要队列概念（见 M3）。

建议先做阻塞（与现有 `Effect.all` 的并发模型一致），把排队留给 M3。

#### 证据

- SpecGen（arXiv:2606.17518）：动态重分配 validation/profiling GPU 池 + 优先级 + 空闲内存复用。
- KernelArc（arXiv:2608.17071）：deterministic benchmark guard——即"不靠独占而靠确定性"的另一条路。
- SOL-ExecBench（arXiv:2603.19173）：沙箱 harness（锁频、清 L2、隔离子进程）——
  这些**都是独占性要求**的具体形态。

#### 风险 / 待裁定

- **新 DSL 概念需要设计评审**（不只是实现）。至少要定：作用域（region 内？整个 run？）、
  与 `parallel` 的关系（是否取代）、跨 region 是否生效、以及失败/中止时的释放语义。
- 与 `parallel: false` 的关系必须明确，否则会出现两个开关打架的情况。
  建议：`exclusive` 是**更细的补充**，`parallel` 保持为 region 级粗开关。

---

### M2 — measure 互斥（限流），implement 保持并发

#### Motivation

这是 M1 的**唯一必需用例**，也是最直接的收益：
`measure` 是唯一必须独占的阶段（它产生的数就是判决依据），
而它也是**唯一被并发污染会直接改变结论**的阶段。

`implement` 阶段的污染不改变判决——它只影响 agent 速度。

#### 机制

`measure` 声明互斥，`implement` 不声明。效果：

```
现状:   [implement A][measure A]
        [implement B][measure B]     ← 三个 measure 重叠
        [implement C][measure C]

目标:   [implement A]──┐
        [implement B]──┼──→ [measure A] [measure B] [measure C]   ← 串行
        [implement C]──┘
```

代价是 wall clock 变长（多出 2 次 measure 的时长），收益是测量可信。
**这个 tradeoff 的具体数值可以用 M4 先测出来。**

#### 证据

同 M1。此外 `docs/WORKLOG-TOURNAMENT-2026-09-04.md` 的现场数据（并发导致 exact tie）
是本方法的直接证据。

#### 风险

- 如果 case 的测量本身很短，串行化的 wall clock 代价可能大于收益。
  **必须先测量**（M4）。

---

### M3 — 动态池 + 优先级（排队而非锁）

#### Motivation

M1/M2 的阻塞式互斥有一个隐含缺陷：**先到先得**。
如果 lane A 的 measure 特别长，lane B/C 会一直等；
而如果 B 的候选明显更有希望（例如 T0 粗筛结果好，见 `04`-M1），
它本不该等最久。

SpecGen 的做法是把这升级成一个**调度问题**：按到达率动态重分配池，
并按优先级服务请求，以降低突发负载下的反馈延迟。

#### 机制

- 引入一个**待测队列**，元素是 (lane, 候选, 优先级)。
- 优先级来源：粗筛结果（`04`-M1）、离散度（`01`-M1）、
  是否已接近 SOL（`04`-M4）、是否为组合候选（`03`-M2）。
- 与 M1 的关系：M1 是"容量为 1 的池"，M3 是"容量可调 + 队列"。

#### 证据

- SpecGen：动态重分配 + 优先级 + 空闲内存复用；端到端时间下降且 profiling 反馈增加。
- KernelBrain（arXiv:2608.02611）：coarse-to-fine 的**自适应资源分配**——
  本质就是"把预算按希望分配给幸存者"。

#### 风险

- **这是引擎级复杂度的一大跳**。调度器逻辑、可观测性、失败恢复都要重建。
  建议：M1/M2 落地并证明收益后，**只有当队列确实成为瓶颈**时才上 M3。

---

### M4 — 先用现有 serial 臂量化损失（P0）

#### Motivation

**这是本模块最该先做的事，而且不需要写任何新代码。**

现在有两种解读，都无法用先验判断谁对：

- 观点 A：并发测量污染严重，真实改进被当 regression 拒掉（`01`-M2），必须串行。
- 观点 B：污染可接受，串行白白拉长 wall clock，得不偿失。

仓库里已经有回答这个问题的**全部工具**：
`gpu-cuda-tuning-tournament.yml` 与 `gpu-cuda-tuning-tournament-serial.yml`
是同一工作流只差 `parallel` 一个开关；`piano evals --parallel` 能跑矩阵。

#### 机制

跑一组对照实验，比较两个臂：

| 指标 | 从哪读 | 期望看到的差异 |
|---|---|---|
| `admitted-not-carried` 占比 | `selection.jsonl` | 串行臂应显著更低（更少假阴性） |
| `no-winner` 占比 | `selection.jsonl` | 串行臂应更低 |
| exact tie 次数 | `selection.jsonl`（metric 相等） | 串行臂应更少 |
| 同一 metric 的跨 lane 离散度 | `result.json` 的 samples | 串行臂应更小 |
| 达到同等加速比的 wall clock | `duration.jsonl` + 最终 metric | 串行的代价 |
| token 消耗 | `token-usage.jsonl` | 两臂的 agent 成本差 |

关键：**如果串行臂的 `admitted-not-carried` 明显更少**，那就证明了
"并发让我们丢掉了真实改进"——`01`-M2 的噪声带就从一个推断变成实测结论，
M1/M2 的优先级也随之从 P2 升到 P1。

#### 证据

- 两个变体工作流与 `--parallel` matrix 选项已存在（见 `README` §6）。
- `docs/WORKLOG-TOURNAMENT-2026-09-04.md` 已经观察到并发下的 exact tie。
- AutoLab（arXiv:2606.05080）：strict wall-clock 预算下比较不同策略——
  即以"同等预算下达到什么"为口径，正是本实验该用的口径。

#### 风险

- **低**。唯一的成本是 GPU 时间。而且需要注意两个臂要**同等条件**比较
  （轮数、模型、case 都一致），否则差异会归因错误。

---

### M5 — 测量条件声明与设备健康检查

#### Motivation

即使做到独占，"测量"仍然依赖一堆没人记录的条件：时钟状态、L2 是否干净、
设备温度、驱动/CUDA 版本、是否有其他用户的进程。

SOL-ExecBench 把这些当作 harness 的一等职责（GPU clock locking、L2 cache clearing、
isolated subprocess execution）。而 PIANO 的 case harness 由 case 提供，
工作流侧只要求"使用 case 固定的 warmup/sample 策略，
never alter the verifier or timing harness"（`recipes/cuda-benchmark-store/agents.md`）——
即**把可比性外包给了 case**。

这本身是合理的分工。缺的是**把条件记录下来**，这样：
(a) 不可比的测量可以被识别；(b) 事后分析能排除环境因素。

#### 机制

- measure 的 result 里记录测量条件（设备、时钟、独占性、samples 策略）→ 与 `01`-M3 是同一字段。
- 可选的**前置健康检查**：在测量前确认设备处于预期状态（能否锁频、是否有邻居）。
  失败时走既有的 `blocked` 语义（`recipes/cuda-profile/agents.md` 已有先例：
  "If the entrypoint cannot verify or time the promoted source, retain the error and mark
  the profile `blocked`; do not guess"）。

#### 证据

- SOL-ExecBench（arXiv:2603.19173）：clock locking + L2 clearing + isolated subprocess + 反作弊静态检查。
- 本方法的思想：**把环境当成需要验证的前提，而不是假设**。

#### 风险

- 低。注意不要让它变成阻塞性 gate（`blocked` 必须是合法结局，不能失败整个 run）。

---

### M6 — 跨 run 资源协调

#### Motivation

`docs/WORKLOG-TOURNAMENT-2026-09-04.md` 记录了一个反复出现的现场：
**3 个 tuning run 同时存在**（并发 `piano evals`），
并且明确写了这导致"测量噪声大"。

同时那条记录里的另一个观察也值得注意：

> The live-progress poller may bind to a concurrent run's progress ...
> 并发 `piano evals`（本次审查期间实测 3 个 tuning run 同时存在）会把别的 case 的
> 阶段进度显示在本 case 标签下

——说明"多 run 并发"在 PIANO 的日常使用里是**常态**，不是异常。

#### 机制

进程间协调的形态可以是：

- **文件锁 / 设备租约**：`~/.piano/` 下一个锁文件声明设备占用，进程启动测量时申请。
  简单，跨进程有效，无需常驻服务。
- **调度守护进程**：更完整但重得多。

建议前者。形态可参考 PIANO 已有的"共享 home 生成区"（`~/.piano/harness/`，
`harness-home.ts` 用 `.tmp` + rename 原子写）——**同一个位置放一把设备锁**，
实现成本低、语义清楚。

#### 证据

- 仓库内的多 run 并发现场（上述 worklog）。
- SpecGen：把评测资源的分配当作系统问题来解决——但注意 SpecGen 是**单系统内**的池化，
  跨进程协调是 PIANO 特有的额外需要。

#### 风险

- 锁的**陈旧检测**（进程崩溃后锁不释放）必须处理，否则会卡死整个 run。
  这与 PIANO 的"resume / 中断"路径有交互，需要注意。
- 与用户预期的冲突：用户可能**故意**想并发跑多个 run 来比较。所以锁应当
  **可退让**（例如默认等待 + 超时后放弃并记录"未获得独占"），而不是硬阻塞。

## 6. 落地顺序与验收

| 步 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| 1 | **M4** 并发 vs 串行的对照实验（**P0，无需新代码**） | 现有 `-serial` 变体 + `--parallel` | 给出量化结论：假阴性与 exact tie 的差异、wall clock 代价 |
| 2 | **M5** 测量条件声明 | `01`-M3 同批 | 一个 run 的 `result.json` 里能读到测量条件 |
| 3 | **M1/M2** 资源互斥（**需先评审 DSL 形态**） | M4 数据支持 | implement 仍并发、measure 串行；`parallel` 语义不冲突 |
| 4 | **M6** 跨 run 设备租约（可选） | 需要陈旧锁处理设计 | 未获得独占时**记录并继续**，不失败 |
| — | **M3** 动态池与队列 | M1/M2 落地且队列成瓶颈 | 需引擎级设计文档 |

## 7. 参考文献

arXiv:2606.17518（SpecGen）、arXiv:2608.17071（KernelArc）、arXiv:2603.19173（SOL-ExecBench）、
arXiv:2608.02611（KernelBrain）、arXiv:2606.05080（AutoLab）

内部依据：`packages/orchestrator/src/workflow.ts`（`WorkflowTournament.parallel` 定义与注释）、
`packages/orchestrator/src/workflow-execution.ts:3591`（`concurrency`）、
`recipes/workflows/gpu-cuda-tuning-tournament.yml` 与 `-serial.yml` 的头部注释、
`docs/WORKLOG-TOURNAMENT-2026-09-04.md`（并发现场与 poller 缺陷）、
`packages/harness/src/harness-home.ts`
