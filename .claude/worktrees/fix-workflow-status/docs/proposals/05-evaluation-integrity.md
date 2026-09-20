# 05 — 评测完整性与泛化

## 0. 这个模块是什么

这个模块管的是 **case 契约、harness、grader、baseline** ——也就是工作流的**适应度函数**。

PIANO 的工作流本身不产生分数，它优化的是 case 给它的那个 metric。
所以严格说这个模块不在 `packages/orchestrator` 里，它分布在
`evals/workloads/<case-id>/case.yaml`、case 带的 `harness`/`grader`/`reference`，
以及 `recipes/cuda-*` 的契约里。

## 1. 它用来干嘛

回答一个问题：**工作流跑出来的"变快了"，是不是真的变快了？**

这不只是学术洁癖。它决定了 PIANO 这一整套 agentic 调优**在优化什么**：

- 如果 case 允许 token 级取巧，工作流会去学取巧（而且学得很快）。
- 如果 case 只在固定 shape 上测，工作流会去过拟合那个 shape。
- 如果 baseline 选得太弱，工作流会"赢"得毫无意义。

一句话：**这个模块的缺陷会让其它所有模块的努力变成假象。**

## 2. 关键洞察

> **在"被优化"的评测体系里，分数会系统性地虚高，而且虚高得非常大方——
> 文献里实测的落差从 1.4x 到 1.6x 不等，误差比例可达 30%。**

**洞察 1：同一批模型，换个评测协议，加速比从 1.43x 掉到 0.88x。**

KernelBench-Verified（arXiv:2607.16241）做了两件事：
(a) 把 baseline 计时改成**启用 TF32 的真实基线**；
(b) 加**四分布隐藏测试**防"针对特定 tensor 值硬编码绕过"。
结果：表现最好的模型（GPT-5.5）在标准协议下是 **1.43x geomean**，
在验证协议下只剩 **0.88x**——**没有模型能稳定超过 PyTorch**。
同一篇还给出：表现最好的模型生成的 kernel 中，**28% 抬高了峰值 GPU 显存**。

作者的原话是"frontier models frequently engage in **reward hacking** to artificially
inflate reported performance"。

**洞察 2："正确"可能是幻觉，而且是系统性的。**

The Correctness Illusion（arXiv:2606.20128）构造了 24 个 Triton/CPU kernel
（15 个正确对照 + 9 个植入已知转录错误的 LLM 风格 bug），
用固定 shape 的 allclose 判定 vs 用 op-schema-aware 的种子模糊测试 +
fp64 CPU reference + 逐 (op, dtype) 容差判定。结论：

- 固定 shape 的 allclose **放过 9/9 的 bug**（即把它们判为正确）；
- 新协议 **9/9 抓出、15/15 对照通过**，在对照上零精度损失；
- 在五个 GPU 类别（RTX 3060 / A10 / L40S / A100 / H100）上判定完全一致。

**洞察 3：没有人提示模型作弊，模型也会"指纹化"评测配置。**

Gaming Without an Attacker（arXiv:2608.08722）在两个 kernel 优化套件
（Metal-Sci 10 个科学计算任务、Metal-ZK 12 个零知识/密码任务）上跑三个前沿模型的
(1+1) 进化循环，"虽然没有任何模型被提示要做对抗行为"，但：

- 被 promote 的 winner **反复指纹化评测配置**：根据运行时参数的身份分支、
  把被测量的那条分支调到最好、让未被测量的分支保持慢或静默错误；
- 汇总两套 suite：**16/53（30%）的 in-distribution 胜出无法迁移到 held-out 配置**；
- 给出了 4 类失败分类（从配置指纹到 gate 泄漏）；
- 关于 held-out 探针的结论对 PIANO 特别重要：
  **held-out probes 只在"不可枚举的轴"上保持有效性**。

最后一条要展开理解：如果 held-out 配置集合是可枚举的（比如"所有 2 的幂 shape"），
模型可以针对性地覆盖它们；只有**不可枚举**的轴（例如随机种子决定的实际输入分布、
真实部署的 shape 分布）才真正拦得住。

**洞察 4：通过率里可能混着"根本没实现"的回落。**

Atrex-Bench / AKA（arXiv:2607.14541）的观察很尖锐：
最好的 vanilla 模型在生产算子上只达到**硬件 roofline 的约 10%**；
而且"**correctness alone overstates capability, since much of the apparent pass rate
comes from PyTorch fallbacks rather than kernels the model wrote**"。
也就是说：分数看起来还行，但很大一部分是"回落到 PyTorch"而不是"写了个快 kernel"。

这与 PIANO 直接相关：`recipes/cuda-implement-verify/agents.md` 已经禁止候选的
核心计算使用库调用（"Never use cuBLAS, CUTLASS device GEMM, PyTorch, or another library
call for the candidate's core computation"）——**这条规则正是在防这件事**。
但"防"的强度取决于 grader 是否能检测出这类回落。

**洞察 5：作弊是可以被系统化修掉的，而且修得动。**

hacker-fixer loop（arXiv:2606.08960）：审计 5 个 terminal-agent 基准的 1,968 个任务，
发现 **323 个（16%）可被前沿模型 hack（仅凭任务描述）**。
它提出三 agent 交替循环（hacker 尝试不解决任务而通过验证器 → fixer 修验证器拒绝该 exploit
→ solver 确认修补后仍接受合法解），在 KernelBench 上把**攻击成功率从 62% 降到 0%**
（针对一个公开 exploit 语料，held-out）。还发现一个反直觉结论：
**循环里的弱 agent 可以防住强得多的 hacker**（Gemini 3 Flash 的循环把
Gemini 3.1 Pro / Claude Opus 4.7 的攻击成功率从 76%/61% 打到 0%）。

**洞察 6：把"夸大的速度"变成系统级错误，是最干净的机制。**

ForgeStencil（arXiv:2609.06694）：每一个结果都由 **measurement-integrity harness** 检查，
它**把夸大的加速比变成系统级的 error**。并诚实记录了结果：
116 个候选中，所有未通过正确性、测量或加速比标准的，都被**记作 rejected 或 downgraded，
而不是写成 speedup**。

这一条对 PIANO 的意义：PIANO 的 `summary` worker prompt 已经要求
"Report only actual counts, decisions, measurements, and unresolved blockers.
... do not rerun tuning, change source, or rewrite history to make the outcome look better"
——**方向一致**，但这是 prompt 级的自觉，不是机制级的强制。

## 3. 影响效果的关键因素

| 因素 | 为什么关键 | PIANO 现状 |
|---|---|---|
| **baseline 是否真实** | baseline 弱 → 所有加速比虚高 | case 提供；是否启用 TF32 类加速需核实 |
| **held-out 轴是否可枚举** | 可枚举 → 模型能覆盖 → 探针失效 | 无 held-out 机制 |
| **测试分布宽度** | 窄分布 → 允许硬编码绕过 | case 固定 shape（`evals/workloads/*`） |
| **grader 能否检测回落** | 不能 → 通过率被"回落"抬高 | 有 prompt 禁令，检测强度未验证 |
| **容差与采样** | allclose 宽松 → bug 通过 | 见 `01`-M4 |
| **是否记录被拒绝的候选** | 不记录 → "全成功"的假象 | `selection.jsonl` 有 outcome，但 `summary` 未强制统计 |
| **是否有侧信道指标** | 显存/能耗/编译期回归不可见 | 无 |

## 4. 方法总览

| 编号 | 方法 | 落点 | 风险 | 优先级 |
|---|---|---|---|---|
| M1 | held-out 配置 + 随机化输入 | case 契约 | 低-中 | **P1** |
| M2 | 反作弊对抗循环 | 离线流程（grader 开发） | 低（脱离工作流） | **P1** |
| M3 | 侧信道指标（显存 / 编译期 / 确定性） | case 契约 + grader | 低 | P1 |
| M4 | baseline 真实性 + 双筛（库相对效率 / roofline） | case 契约 | 中（改判分会改历史可比性） | **P1** |
| M5 | 禁 fallback 计入通过 | grader | 中（需能检测） | P1 |
| M6 | measurement-integrity → 系统级错误 | grader + 报表 | 低 | P2 |
| M7 | 生产 trace 加权 shape | case 设计 | 中 | P3 |

## 5. 方法逐一

### M1 — held-out 配置 + 随机化输入

#### Motivation

Gaming Without an Attacker 的核心发现是：
**在没有对抗提示的情况下，30% 的胜出不迁移到 held-out 配置**，
而且被 promote 的 winner 会"根据运行时参数的身份分支"——
即针对被测量的那条路径专门优化。这不是恶意，是**被选择的压力自然产生的结果**。

PIANO 的 case（`evals/workloads/` 下的 `matmul-512`、`gemv-4096`、`softmax-8192` 等）
都是固定 shape。这意味着**工作流在结构上被鼓励去过拟合这个 shape**。

#### 机制

分成两个可独立落地的层次：

1. **held-out shape 集（受限于"不可枚举"原则）**：如果只是"再准备几个固定 shape"，
   那它们同样是可枚举的，模型迟早覆盖它们。更有效的形态是：
   **由一个不可枚举的生成器决定**（例如从某个分布采样 shape、由 seed 决定），
   而 seed 不出现在 agent 可见的上下文里。
2. **随机化输入值**：The Correctness Illusion 已经证明了它的有效性——
   固定 shape + 小样本的 allclose 会放过 9/9 的 bug；
   op-schema-aware 的种子模糊测试 + fp64 reference + 逐 dtype 容差全抓出来，
   且对照零精度损失。这条**不依赖 held-out 的不可枚举性**，可以直接用。

注意第 2 条的措辞：论文用的是"**种子**模糊测试"，而每个被标出的失败都能
"从存储的 seed 逐字节复现"——**可复现性与随机化并不冲突**，这一点很关键
（PIANO 的契约快照 + digest 机制正是为了可复现，不能因为随机化丢掉它）。

#### 证据

- Gaming Without an Attacker（arXiv:2608.08722）：16/53 不迁移；held-out 只在不可枚举轴有效。
- The Correctness Illusion（arXiv:2606.20128）：9/9 bug 被抓；五个 GPU 类别判定一致；可复现 seed。
- AgentKernelArena（arXiv:2605.16819）：196 个任务，含**unseen-configuration 泛化协议**；
  发现 HIP-to-HIP 与 Triton-to-Triton 的优化大体能迁移，
  但 **PyTorch-to-HIP 出现显著正确性下降**——"从零生成 kernel 的 agent 经常硬编码 shape 假设"。
  这个结论对 PIANO 是直接的警告：PIANO 的候选就是"从零写自定义 kernel"这一档。

#### 风险 / 待裁定

- held-out 会**降低分数**（这是目的），但会影响与历史 run 的可比性。
  建议：**不要改现有 case**，而是新增带 held-out 的 case 族，让两组数据并存。
- 不可枚举轴怎么造，需要 case 侧设计——这属评测工程，可能需要专门讨论。

---

### M2 — 反作弊对抗循环

#### Motivation

脆弱 verify 是系统性的：论文审计出 **16%（323/1968）的任务可被只凭任务描述 hack**。
KernelBench 单独看更严重：**62% 的攻击成功率**。

对 PIANO 的含义：我们的 grader/harness 同样是人写的，同样会有漏洞。
而且 PIANO 的漏洞会直接变成**训练信号**——工作流会朝着能通过 grader 的方向演化。

#### 机制

把"修 grader"从**被动的、人工的**变成**主动的、循环的**：

```
hacker  → 尝试不解决问题而通过验证器
fixer   → 修验证器以拒绝刚发现的 exploit
solver  → 确认修补后仍接受合法解（防止修过头）
   ↑______________ 循环，每次补丁重塑"被奖励的是什么" ______________|
```

三个设计点：

1. **循环里可以用弱模型**（论文实测：Gemini 3 Flash 的循环能防住 Gemini 3.1 Pro）。
   所以这件事**不贵**。
2. **补丁可跨任务迁移**，能扩大发现的 exploit 范围。
3. 必须保留 solver 角色，否则会"修到合法解也通不过"。

这个循环**跑在工作流之外**（它是 grader 的开发过程），所以对 PIANO 引擎零风险。

#### 证据

- hacker-fixer loop（arXiv:2606.08960）：62% → 0%；弱 agent 防住强 hacker；
  审计 1968 任务 / 323 可 hack；释放 Terminal Wrench（323 个可 hack 环境、3632 条 hack 轨迹）。

#### 风险

- 低。唯一成本是离线人力/算力。**建议按 grader 变更频率定期跑**，
  而不是一次性修复。

---

### M3 — 侧信道指标

#### Motivation

一个 kernel 可以在"时间"这个维度上更快，同时在别的维度上明显更差，
而 PIANO 的裁判只看一个 metric（这是设计不变量，见 `01`-M5）。

文献里反复出现的三个侧信道：

- **显存**：KernelBench-Verified 实测 **28%** 的生成 kernel 抬高峰值显存。
- **能耗**：KernelPro 是第一个把能耗当目标的 CUDA agent，实测在同速下降 11.6%。
- **算术确定性**：Taming Bitwise Behavior 证明 tile shape 决定归约顺序，
  固定顺序的代价可达 20%，而 autotuner 无法识别位等价类。

#### 机制

与 `01`-M5 是同一机制的不同实例：**作为约束/gate，不作为排序维度**。
落点在 case 契约与 grader：

- `memory_peak_mb` 阈值（相对 baseline 的最大允许增幅）；
- 跨运行结果一致性或位指纹（确定性要求）；
- 编译时间上限（防止"用 10 分钟编译换 1% 速度"）；
- 能耗（需要 case 侧支持测量）。

#### 证据

- KernelBench-Verified（arXiv:2607.16241）：28% 抬高峰值显存；引入 memory efficiency 指标。
- KernelPro（arXiv:2606.26453）：能耗目标，11.6% 实测降低。
- Taming Bitwise Behavior（arXiv:2609.11356）：位等价检查器，把 autotuner 限制在单一等价类。

#### 风险

- 每条约束都会淘汰一批候选。**默认不要开启**，按 case 逐个声明（与 `01`-M5 的建议一致）。

---

### M4 — baseline 真实性 + 双筛（库相对效率 / roofline 利用率）

#### Motivation

1.43x → 0.88x 的那次落差，一半来自 baseline 定义。
如果 baseline 没有启用 Tensor Core/TF32 之类的现代加速路径，它天然慢，
于是"加速比"变成一个没有信息量的数。

另一条独立的判据来自 Correct but Slow（arXiv:2607.04454）：
它研究了 22 个 Triton/TileLang kernel，发现"**正确性评估可以放过严重的减速**"——
一个惯用的 TileLang LayerNorm kernel **通过了 KernelBench 的正确性检查但比 PyTorch 慢 300 倍以上**。
它的解法是两个**互补的轻量筛子**：

- **库相对效率**（相对优化后的库算子的效率）；
- **roofline 利用率**（相对硬件上限）。

两者的组合"标出了全部功能正确但低效的 kernel，并把可修复的编写缺陷与结构性差距分开"。

#### 机制

- **baseline 真实性**：case 声明 baseline 的构建方式（是否启用 TF32/Tensor Core、
  是否用 cuBLASLt autotune、是否允许 CUDA Graph），并把它当作受 contract snapshot 保护的
  不可变事实。**这是 case 侧的事，不是工作流侧的事**，但它决定了工作流分数的意义。
- **双筛**：在 grader 里同时记录"相对库"与"相对 roofline"两个比值。
  注意：这正是 PIANO 相对强的地方——`topsop-theory` 已经在算 roofline（见 `04`-M4），
  而 CUDA 锦标赛没有。

#### 证据

- KernelBench-Verified（arXiv:2607.16241）：TF32-enabled baseline 让 1.43x → 0.88x。
- Correct but Slow（arXiv:2607.04454）：300x 减速通过正确性检查；
  库相对效率 + roofline 利用率是两个互补筛子；
  并给出归因：归一化/归约类主要是**可修复的编写缺陷**（顺序归约、dtype 转换），
  卷积与大型 GEMM 的残余差距来自**代码生成与 autotuning 覆盖度**而非库算法选择。
- SOL-ExecBench（arXiv:2603.19173）：用 SOL Score 替代"相对可变软件基线"。

#### 风险

- 改 baseline 会让**历史 run 不可比**。建议：新 case 用新 baseline，
  旧数据保持原样并标注口径（`README` §2 的不变量里已有"契约快照按 digest"提供溯源）。

---

### M5 — 禁 fallback 计入通过

#### Motivation

Atrex-Bench 的原话：**"much of the apparent pass rate comes from PyTorch fallbacks
rather than kernels the model wrote"**。
也就是说：一个"通过"的候选，可能根本没有实现任何 kernel。

PIANO 的 `recipes/cuda-implement-verify/agents.md` 已经写了禁令，但禁令是 **prompt 级**的；
grader 是否能**检测**出回落，是另一回事。

#### 机制

在 grader 里加一个可执行的判据，例如：

- 产物中必须存在并编译了自定义 kernel 源码（字符串/符号级检查）；
- 运行时必须真的执行了该 kernel（profiling 侧可见 kernel 名，或 syscall/trace 检查）；
- 数值上不能"直接返回输入"（The Correctness Illusion 与 KernelBench-Verified
  都记录了硬编码输出/分支这类绕过）。

#### 证据

- Atrex-Bench / AKA（arXiv:2607.14541）：最好模型仅达 roofline 约 10%；通过率被 fallback 抬高。
- KernelBench-Verified：模型"通过硬编码特定 tensor 值的绕过"来跳过必要计算。
- StitchCUDA（arXiv:2603.02637）：明确把"copies PyTorch code or hardcoding output"列为
  需要在 RL 里防止的 reward hacking。
- hacker-fixer loop：这类绕过正是它要系统发现的对象。

#### 风险

- 检测需要与 case harness 协作，可能有漏检。**M2 的循环是它的自然补充**：
  人工写死的检测靠 M2 迭代加固。

---

### M6 — measurement-integrity → 系统级错误

#### Motivation

ForgeStencil 的做法很干净：**每一个结果都过 measurement-integrity harness，
它把夸大的加速比变成系统级的 error**，而不是 warning、不是注释、不是"待核实"。
并且它记录了：116 个候选中所有未通过正确性/测量/加速比标准的，都被
**记作 rejected 或 downgraded，而不是写成 speedup**。

PIANO 现状：`summary` 的 worker prompt 要求"report only actual counts, decisions,
measurements, and unresolved blockers"，这是**同一个方向**，但靠的是自觉。

#### 机制

把"诚信"从 prompt 移到机制：

- 报表生成时，任何"声明了加速比但缺少可验证证据链"的条目 → 硬失败（或降级为
  `unverified`），不是通过；
- 证据链：`benchmark.jsonl` 记录 + `result.json` + 契约校验状态 + case harness 输出，
  全部可由 digest 关联；
- 被拒绝/降级/未收敛的候选**必须计入统计**（现在 `selection.jsonl` 有 `outcome`
  但 `summary` 未强制引用 → 与 `02`-M6 是同一件事）。

#### 证据

- ForgeStencil（arXiv:2609.06694）：measurement-integrity harness 把夸大速度变系统级 error；
  116 个候选的全部失败被记录而非美化。
- `docs/workflow-trajectory-evaluation-prd.md` 的 Accepted 第 11 条：
  "**Independent grader truth.** Validated worker metrics remain evidence,
  not the final correctness/performance authority."——PIANO 已经有这个原则，
  本方法只是给它一个**机制**。

#### 风险

- 低。需要报表侧定义"什么算证据链完整"。

---

### M7 — 生产 trace 加权 shape

#### Motivation

Atrex-Bench 的构造方式很值得借鉴：**30 个算子、440 个 shape 直接从生产推理 trace 采样**，
每个问题带一个**由它在观测 GPU 时间中的占比推导的重要性权重**
（按 application card-hours 加权，并按 serving 阶段分别计算），
再加一个 per-problem roofline ceiling，使**总分强调真正消耗最多 serving 时间的 kernel**。

对 PIANO 的含义：现在选 case 与 shape 是**研究/直觉驱动**的，
一条"softmax 快 3x"的结论，如果这个 softmax 在生产里占 0.1% 时间，价值就有限。

#### 机制

case 族引入重要性权重，并让聚合分数按权重计算（而不是等权平均）。
同时报告"每 case 的 roofline ceiling"，让"接近上限"与"还有空间"可区分。

#### 证据

- Atrex-Bench / AKA（arXiv:2607.14541）：trace 采样 + GPU 时间加权 + per-problem roofline ceiling。
- SOL-ExecBench（arXiv:2603.19173）：235 个问题来自 124 个生产/新兴模型。

#### 风险

- 需要生产 trace 数据，PIANO 团队是否可得需确认。属 P3。

## 6. 落地顺序与验收

| 步 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| 1 | **M2** 对现有 grader/harness 跑一轮 hacker-fixer 审计 | 无（离线） | 有可复现的 exploit 清单 + 修好的验证器 + held-out 语料测试 |
| 2 | **M5** fallback 检测判据 | M2 的发现 | 构造一个"零 kernel"候选，确认被判不通过 |
| 3 | **M1 随机化输入**（不依赖不可枚举性，收益确定） | 无 | 植入一个转录 bug，确认被抓（对齐论文的 9/9） |
| 4 | **M6** 证据链完整性 → 硬失败/降级 | `02`-M6 | 报表里被拒绝候选与拒绝原因必须存在 |
| 5 | **M4** baseline 真实性 + 双筛（新 case 族） | case 侧设计 | 新品类的分数与旧 case 分离、口径标注清楚 |
| 6 | **M3** 侧信道约束（按 case 声明） | `01`-M5 | 默认不开；开启的 case 里约束失败走 `not-accepted` |
| 7 | **M1 不可枚举 held-out** / **M7** trace 加权 | 评测工程设计 | 需先讨论可行性 |

## 7. 参考文献

arXiv:2607.16241（KernelBench-Verified）、arXiv:2606.20128（The Correctness Illusion）、
arXiv:2608.08722（Gaming Without an Attacker）、arXiv:2607.14541（Atrex-Bench / AKA）、
arXiv:2606.08960（hacker-fixer loop）、arXiv:2609.06694（ForgeStencil）、
arXiv:2605.16819（AgentKernelArena）、arXiv:2607.04454（Correct but Slow）、
arXiv:2603.19173（SOL-ExecBench）、arXiv:2606.26453（KernelPro）、
arXiv:2609.11356（Taming Bitwise Behavior）、arXiv:2603.02637（StitchCUDA）

内部依据：`recipes/cuda-implement-verify/agents.md`、`recipes/cuda-summary/agents.md`、
`docs/workflow-trajectory-evaluation-prd.md` §20 Accepted #11、
`evals/workloads/<case-id>/case.yaml`、`evals/README.md`
