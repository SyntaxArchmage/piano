# 01 — 裁判与测量保真

## 0. 这个模块是什么

"裁判"是锦标赛的**判决环节**：region 的 exit stage 交出一个 metric，引擎按 `direction` 比大小，
选出一条 lane 的改动 carry 回父 workspace。**测量**是这个判决唯一的事实来源。

在 PIANO 里这两件事耦合得很紧，所以放在同一篇：

- 判决逻辑是纯函数：`packages/orchestrator/src/selection.ts`（`selectWinner` / `admitWinner`，
  Effect-free、不读文件、不驱动执行）。
- 测量由 worker 自己跑：`recipes/cuda-benchmark-store/`（worker prompt + JSON Schema 契约）；
  `measure` 阶段把 benchmark 结果写进 run-owned `result.json`，契约校验通过后成为 metric。

## 1. 它用来干嘛

一个问题：**这一轮的改动，到底是不是真的更快了？**

具体要产出三个结论：

1. **本轮的 winner**——3 条 lane 里谁最快。
2. **是否 carry**——跨轮闸门 `admitWinner` 要求"严格改进同一 metric 身份"，否则
   `admitted-not-carried`（防止拿更差的代码覆盖 incumbent）。
3. **carry 回什么**——winner 的 delta 冻结后交给它自己的 worker 在父 scope 应用。

三个结论都建立在"测量可信"之上。**测量不可信时，这三个结论会系统性地错**，而且错得没有症状：
不会报错，只是把噪声当成果、把真成果当回归。

## 2. 关键洞察

> **PIANO 当前的裁判是无噪声假设的，而测量环境是有噪声的；更糟的是默认并发把噪声源开到了最大。**

拆开看：

**洞察 1：闸门是"严格大于"，不是"显著大于"。**
`admitWinner` 用的是 `betterByDirection(winner.best, incumbent.best, direction)`——纯比较符号。
于是"真改进 1%，测量抖动 ±3%"这种最常见的情况，会在 1/3 的概率下被判成 `regressed`，
**该 carry 的成果被丢掉**（这是假阴性，代价是白跑一整轮）；
反过来抖动也可能让一个其实没改进的候选看起来"赢了"，被 carry 进父仓库（假阳性，代价更大）。

**洞察 2：默认并发就是噪声源。**
`workflow-execution.ts:3591` 的并发度是 `"unbounded"`——3 条 lane 的 `measure` 会**同时**在同一张
GPU 上跑 benchmark。这不是推测，仓库里已有现场记录：`docs/WORKLOG-TOURNAMENT-2026-09-04.md` 记录了
"3 个 tuning run 并发抢 GPU，测量噪声大，iter-9 出现 exact-tie 7.511289 == incumbent 被正确拒绝"。
注意最后那句：**"被正确拒绝"**——拒绝是对的（没有真改进），但这个 case 说明数值已经退化到
完全相同的量级，判决已经贴着噪声底了。

**洞察 3：单次采样无法估计噪声，所以无法补救。**
现在每个 lane 只报一个 `best`/`median`。即便事后想看"这次变化在噪声内吗"，数据里也没有答案——
样本分布根本没被记录。`recipes/cuda-benchmark-store/agents.md` 只要求"用 case 固定的 warmup/sample
策略"并"保留实际采集到的全部样本"，但没有要求**上报**分布特征。

**洞察 4：PIANO 在"归并严谨性"上是领先的，不该为了抗噪而丢掉这一点。**
文献里多数系统用外部脚本合并候选；PIANO 是"引擎只排序 + winner 自己的 worker 归并 + 只读 diff gate +
事务保护 Git 元数据"。本文档的所有改动都必须保留这条边界——**不要**为了好写测试而把归并搬进引擎。

## 3. 影响效果的关键因素

| 因素 | 为什么关键 | PIANO 现状 |
|---|---|---|
| **采样数 K** | 决定噪声标准误；K=1 时无法估计噪声 | K 由 case 固定，未上报分布 |
| **设备独占度** | 邻居进程会同时抬高延迟和方差；这是当前最大的污染源 | lane 全部并发，无互斥（见 `06`） |
| **抖动来源构成** | 热漂移 vs 邻居干扰 vs 时钟抖动，处理方式不同（前者需预热/时间窗，后者需独占） | 未区分，统一被记成"测量" |
| **判据阈值** | 定太松→假阳性 carry；定太紧→假阴性丢成果 | 等价于阈值 = 0（严格大于） |
| **baseline 定义** | 基线选错会让"加速比"整体偏移 | case 提供 harness/reference；库相对效率的讨论见 `05`-M4 |
| **tie-break 语义** | 等值时的裁决会影响"改动量偏好" | 先 fan index，再 `changedFiles`/`changedLoc`：**偏好改动更小的候选** |
| **worker 是否如实上报** | 契约允许 `required: false`，可合法地"无 metric" | 有（`COMPILE_FAIL`/`VERIFY_FAIL` 合法），但缺"测量不可信"这一态 |

## 4. 方法总览

| 编号 | 方法 | 落点 | 风险 | 优先级 |
|---|---|---|---|---|
| M1 | 重复采样 + 上报样本分布 | 契约 + prompt | 低 | **P0** |
| M2 | 噪声带 tie 判据（三态裁决） | `selection.ts` + 契约 | 中（改判决语义，需裁定） | **P0** |
| M3 | 测量隔离与"测量前声明" | `06` 协作 + 契约 | 中 | P1 |
| M4 | 容差策略显式化（沿用已有先例） | 契约校验 | 低 | P1 |
| M5 | 多目标作为**约束**而非第二 metric | 契约 + gate | 中 | P2 |
| M6 | 确定性与位等价的差分验证 | case 契约 + measure | 中 | P2 |

## 5. 方法逐一

### M1 — 重复采样 + 上报样本分布

#### Motivation

单次采样报一个数，等于把"测量"当成"事实"。但 GPU kernel 的 wall time 分布很宽：
首次 launch 有 JIT/缓存冷启动，长跑有热漂移，多进程有邻居干扰。
KernelBrain 明确指出 *"runtime measurements are noisy"* 并把这一点当作设计前提；
SOL-ExecBench 的评测 harness 专门做**锁频、清 L2、隔离子进程**来减少这类噪声。
学界共识是：**先量化噪声，再谈统计意义**。

#### 机制

把"一次测量"升级为"一次带分布的测量"：worker 用 case 固定的 warmup/sample 策略跑 K 轮，
上报 `samples[]`（已有）+ 由样本派生的**离散度**（新增）：中位数、最好值、以及一个相对离散度指标
（如 `(p75-p25)/p50` 或标准差/p50）。

关键点：**离散度是证据，不是判决**。它随 metric 一起进 `result.json`，让下游（下一轮 idea、
`summary`、evals 报表）能看到"这个数有多可信"。契约里已有先例——`best`/`median` 就是从
`samples` 精确重算的派生量（`README` §6 记的 `48d2f15`），本方法只是再加一个派生量。

#### PIANO 落点

- `recipes/cuda-benchmark-store/contract.json`：在 metric 的 `value` 里增加可选 `dispersion` 字段
  （必填还是可选需裁定，建议**必填**：否则又变成"没人填"）。
- `recipes/cuda-benchmark-store/agents.md`：明确"必须上报全部样本与离散度；不得只报最好值"。
- `packages/contract/src/worker-contract.ts`：派生量的重算与容差校验（沿用 M4 的策略）。

#### 证据

- KernelBrain（arXiv:2608.02611）：policy-gated evaluation + 承认测量噪声，收益含"最多省 48% 优化时间"。
- SOL-ExecBench（arXiv:2603.19173）：锁频 / 清 L2 / 隔离子进程 / 反作弊静态检查。
- ForgeStencil（arXiv:2609.06694）：measurement-integrity harness *"把夸大的速度变成系统级错误"*。

#### 风险 / 待裁定

- K 增大直接增加 wall clock。建议**由 case 决定 K 下限**（case 契约里给 `minSamples`），而不是全局调大。
- 若某类 kernel 的离散度天然很大（小型 kernel、亚微秒级），"必填离散度"会变成噪声本身。
  需要一个"样本不足/离散度过大 → 标记测量不可信"的合法出口（与 M2 的三态呼应）。

---

### M2 — 噪声带 tie 判据（三态裁决）

#### Motivation

M1 让噪声**可见**，M2 让判决**用它**。动机来自两个真实代价：

- **假阴性**：真改进落在噪声带内被判 `regressed`，白丢一整轮的探索成果。
  `docs/WORKLOG-TOURNAMENT-2026-09-04.md` 的 exact-tie 案例说明这已经发生在边界上。
- **假阳性**：抖动让未改进的候选"赢"了，被 carry 进父仓库——污染后续所有轮次的搜索起点。

第 2 条代价远大于第 1 条，所以**默认应当保守**：宁可少 carry，不可错 carry。
但保守到"严格大于"是另一个极端，它把噪声当成了信号。

#### 机制

把当前的二态（`admitted` / `regressed`）扩成三态：

| 状态 | 条件 | 行为 |
|---|---|---|
| `admitted` | 改进量 > 噪声带 | carry（今天的行为） |
| **`indeterminate`（新）** | 改进量落在噪声带内 | **不 carry，也不记 regression**；记为"未决"并在下一轮携带该信息（配合 `02`-M1） |
| `regressed` | 明显变差（超过噪声带） | 不 carry，记 regression guard |

噪声带怎么来：由 lane 自己的离散度推出（M1），或由 case 声明一个"最小有意义改进"
（minimum meaningful improvement, MMI，例如 2%）。两者取较大者最稳。
第 2 条对**既有 case** 也友好：不需要先有分布数据就能落地，case 声明 MMI 即可。

#### PIANO 落点

- `packages/orchestrator/src/selection.ts`：`SelectionAdmission` 增加 `indeterminate` 变体；
  `admitWinner` 的严格比较改成"带宽比较"。这是**纯函数**改动，测试面清楚
  （`tests/workflow/selection.test.ts` 已有 4 个用例）。
- `packages/orchestrator/src/workspace.ts`：`WorkflowCarrying` 增加对应 kind
  （现有 `admitted-not-carried` 已是类似语义，可能只需新增 reason 而非新 kind）。
- `packages/trajectory/src/recorders.ts`：`selection.jsonl` 记录新状态（schema 有 `outcome` 字段）。
- 参数从哪来：**建议 case 契约声明 MMI**，离散度作为可选收紧项。理由：参数放契约可被
  contract snapshot + digest 钉住，可复现；放代码就是魔法数。

#### 证据

- KernelArc（arXiv:2608.17071）：**deterministic benchmark guard** 作为多 agent 协作的一等组件。
- μCUTLASS + SOL 引导（arXiv:2603.29010）：用 SOL 估计 headroom 来**引导与预算**搜索，
  并对近 SOL 的问题降低优先级——即"把改进幅度当决策输入"。
- POLCA（arXiv:2603.14769）：形式化"随机反馈下的优化"，用优先队列 + ε-Net 处理随机性。

#### 风险 / 待裁定

- **这是判决语义变更**，需要你明确裁定：
  (a) `indeterminate` 时该轮的 winner 是否仍然把代码 carry 进去？（建议：**不 carry**，
      父 workspace 保持 incumbent，但**保留 lane 产物**供下一轮参考——后者依赖 `03`-M1）
  (b) 阈值参数放契约还是引擎？（建议契约，理由见上）
- 有 `indeterminate` 后，"连续 N 轮未决"本身就是一个有用的停机信号 → 与 `04`-M3 直接耦合。
- 与 tie-break 的交互：等值时现在偏好改动更小的候选。加噪声带后，等值判定变多，
  `changedFiles`/`changedLoc` 这一层会**经常**被用到——它的语义（偏好小改动）需要重新确认是否仍然合理。

---

### M3 — 测量隔离与"测量前声明"

#### Motivation

从 M1/M2 可以推出一个不舒服的结论：**如果噪声来自我们自己开的并发，那么统计修正只是补救，
不是修复**。默认 3 条 lane 同时 benchmark 意味着我们系统性地不公平比较——
先跑的那条 lane 可能独占 GPU，后跑的遭遇邻居。

工程的正确顺序是：先消除**可消除的**噪声（隔离），再对**不可消除的**噪声做统计处理。

#### 机制

两件事：

1. **测量隔离**：measure 阶段要求独占设备 + 固定时钟 + 清缓存 + 独立进程。
   这是评测 harness 的职责（SOL-ExecBench 已给出可抄的清单）。
2. **测量前声明**：measure 的 result 里记下"我测量时的环境"——设备、时钟状态、是否有邻居、
   用的 `samples`/warmup 参数。这使得**不可比的测量可以被识别出来**，而不是只能信任。

第 2 点常被忽略但很关键：PIANO 已经把 case harness/gradar 当不可变基础设施，
缺的只是"把测量条件也当作证据记录下来"。

#### PIANO 落点

- 执行侧要求互斥 → 归 `06`-M1/M2（DSL 资源概念）。
- 记录侧：`recipes/cuda-benchmark-store/contract.json` 的 `verification`/metric 元数据里加
  `measurementConditions`（设备、时钟、独占性、samples 策略）。与 M1 的离散度是同一批字段的自然邻居。

#### 证据

- SOL-ExecBench（arXiv:2603.19173）：沙箱 harness + GPU clock locking + L2 cache clearing +
  isolated subprocess execution。
- SpecGen（arXiv:2606.17518）：动态重分配 validation/profiling GPU 池，按到达率与优先级调度——
  即"把评测资源当调度问题"，见 `06`-M3。

#### 风险

- 隔离与吞吐直接冲突：独占测量 = 放弃 lane 并行。是否值得，**应当用数据回答**，
  而不是先验决定 → 见 `06`-M4（用现成的 serial 臂做 A/B）。

---

### M4 — 容差策略显式化

#### Motivation

这条不是新提案，而是**沿用仓库已有的裁定**，并把它上升为通用原则。

历史：2026-09-05 开发者裁定 worker 契约对派生量的 16-ULP 容差**过严**——worker 把
`benchmark.median=6.085539` 舍入到 6 位小数，触发
`ContractValidationError: median does not match samples`，白烧一轮 repair。
最终 `9cbaa2f` 把校验放宽为 **1e-4 relative** 并对通过值做**规范化**（projected metric 携带
samples 的精确重算值）。同期 `48d2f15` 在 `agents.md` 里明确"best/median 必须由 samples 精确重算"。

洞察：**校验容差不是精确性问题，是工作流成本问题**。容差过严 → 烧 repair 轮；
过松 → 允许编造（`9cbaa2f` 同时加了"超界编造"的负例测试，这一点保留了）。

#### 机制

把"容差 + 规范化"变成契约层的显式策略，而不是散落在各 validator 里的常量：

- 每个派生量声明 `tolerance: relative(1e-4)` 之类的策略。
- 通过校验后，**引擎用重算值覆盖上报值**（规范化），使下游拿到唯一版本。
- 同时保留"超出容差即拒绝"的负例测试（防编造）。

#### PIANO 落点

- `packages/contract/src/worker-contract.ts`：容差已是实现细节，抽成声明式策略。
- `tests`：`packages/contract/test/worker-contract.test.ts` 已有 accept+canonicalize 与
  编造负例，扩展即可。

#### 风险

- 低。唯一风险是把容差做成"每个 worker 自己填"，会重新引入不一致 → **策略应集中定义**，
  契约只引用名字。

---

### M5 — 多目标作为**约束**，而不是第二个 metric

#### Motivation

现实中的调优目标不止"更快"：

- KernelBench-Verified（arXiv:2607.16241）：表现出色的模型生成的 kernel 里 **28% 抬高了峰值显存**——
  也就是"更快但更吃显存"，在真实部署里可能直接不可用。
- KernelPro（arXiv:2606.26453）：第一个把**能耗**当优化目标的 CUDA 编码 agent，
  在同等速度下实测降低 11.6% 能耗。
- 编译时间、确定性（见 M6）同样是"更快但不可接受"的来源。

但 PIANO 有硬约束：**exit 契约声明 2+ metric 直接是 load 期 validate error**
（`validateTournamentExitMetricArity`），因为单裁判是排序可判定的前提。
所以"加一个 speed+memory 双目标"这条路**走不通，也不该走**。

#### 机制

把其余目标表达为**约束（gate），不是排序维度**：

- 排序仍然只用**一个** metric（例如时间）。
- 其他目标在 exit 契约里作为 **required 字段/阈值**存在，由既有的 gate 检查；
  违反即视为该 lane 未通过（等价于 `not-accepted`），而不是"降权"。

这样做的额外好处：约束失败是**硬失败**，与现有 `not-accepted` / `blocked` 语义一致，
`selection.ts` 的 `contenders()` 已经把非 accepted 分支排除在外，引擎几乎不用改。

#### PIANO 落点

- 契约层：exit 契约增加约束字段（如 `memory_peak_mb` 阈值、`wall_clock_max_s`），
  在 `required` 里保证存在，在阈值上由 schema 或 validator 判定。
- 引擎层：**不需要新概念**——约束违反走现有的 accepted/not-accepted 通道。
- 记录层：约束值随 metric 一起落 `benchmark.jsonl`，让报表能区分"更快了但被约束拦下"。

#### 证据

- KernelBench-Verified：显存指标是"常被忽视的 speed-memory 权衡"。
- KernelPro：能耗目标 + 11.6% 实测下降。
- SOL-ExecBench：SOL Score 把"接近硬件上限的程度"作为评分，而非单纯相对软件基线。

#### 风险 / 待裁定

- 约束会把某些 lane 全部拦下，导致一轮**没有 winner**（现在会走 `no-winner` 路径，
  机制上是安全的：不 carry、不报错）。需要确认这是期望行为（建议：是，并在 summary 里显式统计）。
- 哪些约束进默认 case 契约需要你决定——**不要**默认加显存上限，老 case 会集体失败。

---

### M6 — 确定性与位等价的差分验证

#### Motivation

换 tile shape / split-K / 归约顺序会**改变浮点算术**，而这类改动恰恰是调优最常用的手段。
`Taming Bitwise Behavior`（arXiv:2609.11356）给出了一个对 PIANO 特别相关的结论：

- tile shape 一旦选定，算术就定了；**autotuner 无法判断哪些配置是位等价的**；
- 强制固定归约顺序的代价可达 **20% 性能**；
- 作者把位等价检查器集成进 Triton autotuner，把搜索限制在**单一等价类**内。

对 PIANO 的含义：**"更快"有可能是通过改变数值语义换来的**。今天的流程里，
`cuda-implement-verify` 只做数值校验（对 reference 的 allclose 类检查），
这正是 arXiv:2606.20128 批评的对象——固定 shape 的 allclose 会放过真实 bug。

#### 机制

两个层次，按成本递增：

1. **输入扰动校验（便宜）**：除 case 固定 shape 外，用额外 shape/取值跑一遍。
   直接对应 held-out 分布（详见 `05`-M1）。
2. **差分验证（贵）**：对同一 reference 做多次运行，检查**跨运行是否位一致**；
   或在汇编/产物层做差分（AsmEvo 的做法：给定 K0 与优化后的 K1，同 launch 下差分验证，
   ABI 保持）。

对 PIANO 的可落地版本：measure 阶段把"本次结果的位指纹/跨运行一致性"作为证据上报，
**不**作为裁判 metric，而是作为 M5 风格的约束或下一轮的输入。

#### PIANO 落点

- 短期：case 契约增加"确定性要求"字段；measure 上报一致性证据。
- 中期：在 CUDA 锦标赛加入 asm/产物层差分通路（同一句 incentive：
  "边界轮 + 无法归因瓶颈时才触发"，成本可控）。

#### 证据

- Taming Bitwise Behavior（arXiv:2609.11356）：位等价静态检查器（跨 PTX/GCN）。
- AsmEvo（arXiv:2608.20711）：对已编译产物做 ABI 保持 + 同 launch 差分验证，
  MI308X 上 1.35x geomean。
- Argus（arXiv:2604.18616）：data-flow invariants 提供带反例的稠密反馈（见 `03`-M4）。
- Correct but Slow（arXiv:2607.04454）：库相对效率 + roofline 利用率两个轻量筛子互补。

#### 风险

- 差分验证要重跑，成本直接叠加；建议只在**边界轮**或**约束敏感 case** 触发。

## 6. 落地顺序与验收

| 步 | 内容 | 验收 |
|---|---|---|
| 1 | M1：契约加 `samples` 派生离散度，prompt 要求上报 | 单测：派生量重算与容差；一个真 run 的 `result.json` 里有离散度 |
| 2 | M4：容差策略集中声明（低风险，可与 1 同批） | 既有 accept+canonicalize 与编造负例仍绿 |
| 3 | M2：三态裁决（**需你先裁定 (a)(b)**） | `selection.test.ts` 扩用例；一条真 run 的 `selection.jsonl` 出现三态 |
| 4 | M5：约束字段（**需你先定默认约束集**） | 约束失败走 `not-accepted`，不 carry 且不报错 |
| 5 | M3/M6：与 `06`、`05` 协同，按需触发 | 数据驱动，不预设结论 |

## 7. 参考文献

arXiv:2608.17071（KernelArc）、arXiv:2608.02611（KernelBrain）、arXiv:2603.19173（SOL-ExecBench）、
arXiv:2609.06694（ForgeStencil）、arXiv:2603.29010（μCUTLASS+SOL）、arXiv:2603.14769（POLCA）、
arXiv:2606.17518（SpecGen）、arXiv:2607.16241（KernelBench-Verified）、
arXiv:2606.26453（KernelPro）、arXiv:2609.11356（Taming Bitwise Behavior）、
arXiv:2608.20711（AsmEvo）、arXiv:2604.18616（Argus）、arXiv:2607.04454（Correct but Slow）、
arXiv:2606.20128（The Correctness Illusion）
