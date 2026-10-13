# 07 — Prompt / Skill 自演化与知识沉淀

## 0. 这个模块是什么

这个模块管的是 **worker 的"知识"从哪来、会不会自己长**。

在 PIANO 里，worker 的行为完全由 `recipes/<worker>/` 目录决定：

| 文件 | 作用 | 注入方式 |
|---|---|---|
| `agents.md` | worker 的行为守则 | 系统平面 appendix（`# <path>` 内联）+ 用户平面点名 |
| `agents.<harness>.md` | 按 harness 扩展的规则（**扩展而非替换**） | 同上，紧随 `agents.md` |
| `skills/<n>/SKILL.md` | 单项技能的详细步骤 | 同上（pi-cli 走 `--skill <dir>`；pi SDK 走 `<workflow_skill>` 块） |
| `contract.json` | 输出契约（JSON Schema + projections） | 契约快照按 digest |

关键性质：**这些是静态的、人工编写的、不随使用变化**。

（数据流细节见 `docs/deep-dive-notes/worker-total-prompt.md`，
它把"总 prompt = 用户平面 task + 系统平面 appendix"讲得很清楚。）

## 1. 它用来干嘛

回答一个问题：**同一个 worker 跑了 50 次之后，它比第 1 次更聪明了吗？**

今天的答案是：**没有**。每次 run 都是同样的 `agents.md`、同样的 `SKILL.md`。
经验只存在于（a）人类事后读 run 目录然后手改 recipe，或（b）根本不存在。

而这个模块的杠杆可能比想象的更大——文献里有一个反直觉的结论，见洞察 1。

## 2. 关键洞察

> **文献里最稳的收益不是"让 agent 自己进化"，而是"给人写的专家知识一个位置"。
> 前者收益大但脆弱，后者收益稳但需要人写。**

**洞察 1：Agent-Assisted 稳定优于 Full-Agent。**

Harness Engineering（arXiv:2607.17979）是 MLSys 2026 FlashInfer AI Kernel Generation Contest
的扩展技术报告，它做了一件很有价值的事：**对比 Agent-Assisted 与 Full-Agent 两种模式**，
结论是"**Agent-Assisted kernels outperform the Full-Agent artifacts across the evaluated
definitions**"，并给出原因：

> expert-provided optimization directions, high-quality references, and workload context
> remain critical for reliable AI-driven kernel optimization.

同时它的系统设计是**把 evaluation harness 与 profile-backed optimization controller 分开**：
harness 强制编译、正确性、官方对齐的计时与产物归档；controller 把 profiler 与 workload
证据转成**有界的**候选生成决策；而 human-authored skills 捕捉算子约束、reference、
profiling 流程与晋升规则。

**注意：这个形状与 PIANO 高度相似**（case harness 不可变 + worker 有界提案 + recipe 存专家知识）。
这说明 PIANO 的架构取向是对的，**差距在"reference 与 workload context 的供给"上**，
而不在架构上。

**洞察 2：静态规则 ≠ 行为（rules ≠ behavior），这是本模块最重要的内部依据。**

PIANO 自己踩过这个坑，教训有两条：

> 静态断言只证明"守卫在"，不能证明"agent 遵守"（**rules≠behavior**）；
> 行为证明只有 e2e 能给出，但它重，所以做成特殊用例而非默认测试。

> 依赖 agent 记住并遵守规则（rules≠behavior，靠 e2e 兜底）本身就是一种脆弱的 workaround。

这对本模块有两个含义：
(a) **往 prompt 里加规则是最弱的一种干预**——需要行为层验证才成立；
(b) SkillEvolver 提出的"**silent bypass**"（skill 内容看起来有效，但运行时**从不被调用**）
在 PIANO 里有真实对应物——**skill 写了但 agent 没读**。

**洞察 3：技能的"入库"需要门槛，否则经验库会变成噪声。**

daVinci-kernel（arXiv:2606.16497）的做法很克制：
三个 agent 共享一个 LLM backbone（技能选择 / 策略生成 / 技能总结），
而**候选技能只有在"执行验证确认可复现加速"之后才被加入技能库**。

这条门槛值得抄。对照 PIANO：如果允许 worker 在每轮结束时"写一条经验"，
10 轮 × 3 lane = 30 条/run，很快就会变成无法分辨的噪声。

**洞察 4：跨任务收益是概率性的，文献自己承认了这一点。**

- EvoMem（arXiv:2608.10795）：在几何优化、多跳 QA、GPU kernel 优化等任务上
  "**most** evaluated settings" 有正向改进，同时"**revealing variability across tasks**"。
- EFT（arXiv:2606.29082）：跨任务泛化确实存在（held-out 22 任务平均 +10.22%），
  但需要 156K 轨迹 / 10 域 / 371 任务规模的训练数据。

所以本模块的定位应当是：**长期投资，不是短期收益**。
而洞察 1 的"给人写的知识一个位置"是**短期、稳定**的收益——两者优先级不同。

## 3. 影响效果的关键因素

| 因素 | 为什么关键 | PIANO 现状 |
|---|---|---|
| **知识来源**（人 vs 自动） | 人写的稳但慢；自动的快但会灌水 | 纯人工，静态 |
| **reference 质量** | Agent-Assisted 优于 Full-Agent 的直接原因 | 取决于 case；recipe 没有 reference 位置 |
| **注入预算** | 规则越多，模型越可能忽略关键规则 | 无记忆，尚无此问题 |
| **是否可验证被调用** | 防 silent bypass | 无机制（正是 rules≠behavior 的根源） |
| **行为验证成本** | 每条规则都上 e2e 不可行 | PIANO 已有先例：静态断言 + env 门控 e2e |
| **知识的作用域** | 跨 case 复用的收益与污染风险同增 | 无作用域概念 |
| **人类介入位置** | 论文强调"humans remain strictly in an orchestration role" | PIANO 有 `signoff` / `discuss` 两个 stage 字段 |

## 4. 方法总览

| 编号 | 方法 | 落点 | 收益稳定性 | 优先级 |
|---|---|---|---|---|
| M1 | **reference / knowledge base 位置** | recipe + case | 高（有直接证据） | **P1** |
| M2 | meta-prompt 共进化 | 离线流程 | 中 | P3 |
| M3 | 在线 skill 学习 + 审计 | recipe + 流程 | 中（需防 silent bypass） | P4 |
| M4 | 轨迹 → 训练信号 | 离线训练 | 中（需规模） | P4 |
| M5 | 两阶段专家分解写进 prompt 结构 | recipe | 中高 | P2 |

## 5. 方法逐一

### M1 — 给 reference / knowledge base 一个位置

#### Motivation

Harness Engineering 的对比实验说明：**给 agent 专家方向 + 高质量 reference +
workload context，比让它自己发挥更好**。而 PIANO 的 recipe 体系里**没有"reference"这个位置**：

- `agents.md` 是行为守则（"never use cuBLAS"、"report only actual counts"）；
- `SKILL.md` 是流程步骤（"先读什么、再跑什么"）；
- `contract.json` 是输出格式；
- **没有"这个算子的已知最优技术清单 / 参考实现 / 常见陷阱"这一类知识文件**。

而这项在文献里被反复确认为高杠杆：

- Atrex-Kernel-Agent（arXiv:2607.14541）：**298 个 reference kernel 文件 +
  244 篇优化知识文档**，加上外部上游项目做 API/ISA 查询；
  它在受控案例研究中"把零 FlyDSL 回落转成真正的 kernel，达到或超过手工调优的生产基线"。
- EGG（arXiv:2606.26758）：把专家工作流分解为**两阶段**——
  algorithmic structure design（建立高质量计算结构基础）+
  hardware-specific tuning（并行映射、tensor tiling、内存优化）。
  它把这个分解作为**显式优化目标**，用 stage-aware 的多 agent 协作管理上下文，
  结果在 KernelBench 与真实 workload 上平均 2.13x，**优于已有的 agent-based 与 RL-based 方法**。
- Xe-Forge（arXiv:2605.26118）：用**精选知识库**编码 Intel GPU 约束
  （power-of-two warp counts、GRF modes、SLM sizing），这些约束"absent from LLM training data"，
  目的是把模型**保持在架构上有效的范围内**。

第三条对 PIANO 的含义最直接：**有些知识模型就是不知道**（例如某个架构的特定约束、
某个库的别名、某个编译器的怪癖），而这恰好是"写成规则"最有效的地方。

#### 机制

在 recipe 里加一类新文件，并让它在"需要时"注入：

```
recipes/<worker>/
  agents.md               ← 行为守则（不变）
  agents.<harness>.md     ← harness 扩展（不变）
  skills/<n>/SKILL.md     ← 流程步骤（不变）
  reference/              ← 新增：知识层
    <topic>.md            ← 例如 "geometric-shapes.md"、"known-traps.md"
```

设计要点三个：

1. **按需注入，不是全量注入**。reference 会很长，全量塞进 system appendix 会挤掉任务。
   `docs/deep-dive-notes/worker-total-prompt.md` 已经记录了当前注入方式的实现，
   加一层"按条件选取"是可控的改动。
2. **知识来源必须可溯源**。每条知识应标注来源（哪篇论文、哪个 kernel、哪次 run 的哪条证据），
   与 PIANO 已有的"契约快照按 digest"的溯源取向一致。
3. **`bottleneck` 是天然的索引键**。`recipes/cuda-idea-tournament/contract.json`
   已经要求每条策略声明 `bottleneck`，可以据此选取对应的 reference 片段。

#### 证据

- Harness Engineering（arXiv:2607.17979）：Agent-Assisted > Full-Agent；
  "expert-provided optimization directions, high-quality references, and workload context
  remain critical"。
- Atrex-Kernel-Agent（arXiv:2607.14541）：298 reference kernel 文件 + 244 知识文档。
- EGG（arXiv:2606.26758）：两阶段专家分解，2.13x 平均加速，优于 agent-based 与 RL-based。
- Xe-Forge（arXiv:2605.26118）：精选知识库编码训练数据中缺失的架构约束。
- KernelPro（arXiv:2606.26453）：专家启发式编码成可插拔工具，
  把原始硬件指标转成可执行的自然语言指导（消融 p < 0.0001）。
- Agentic Kernel Optimization / Houmao（arXiv:2608.14560）：
  "humans remain strictly in an orchestration role: defining the workflow, enforcing
  correctness and anti-hacking constraints, **supplying key references**, and redirecting
  the search when progress stalls"——把"提供参考"列为人类的核心职责之一。

#### 风险 / 待裁定

- **谁来写、写多少**？这是人力投入。建议**从最小的一页开始**：
  只写"已知陷阱"（known traps），因为它对失败的削减最直接，且篇幅最短。
- 注入预算与优先级：需要定"reference 与当前任务证据冲突时谁赢"。
  建议 reference 是**建议**、case 证据是**事实**，并在文本里写明这一点。
- 与 `03`-M5 第 3 维（实现空间）的关系：如果将来允许库/CuTe 实现，
  reference 层会变成它的前置；今天的禁令下，reference 只描述自定义 kernel 技术。

---

### M2 — meta-prompt 共进化

#### Motivation

M1 的知识是**人写的**。meta-prompt 共进化是让**prompt 自己随搜索进展变化**。

KernelFoundry（arXiv:2603.12440，ICML'26）明确把
"**meta-prompt evolution that co-evolves prompts with kernels to uncover
task-specific optimization strategies**" 列为三大机制之一
（另两条是 MAP-Elites 质量多样性搜索，见 `03`-M3；以及模板化参数优化）。

注意它的动机："uncover **task-specific** optimization strategies"——
即通用的 prompt 无法捕捉任务特定的策略，需要让 prompt 跟着任务演化。

#### 机制

把 `idea` 阶段的"提示"本身当作可演化的对象：

- 维护多个 prompt 变体（例如强调不同瓶颈族的提问方式）；
- 用它们的**下游结果**（`selection.jsonl` 的 outcome、`benchmark.jsonl` 的 metric）
  作为适应度；
- 保留表现好的变体，淘汰差的。

PIANO 落点：`recipes/cuda-idea-tournament/agents.md` 与 SKILL 是文本，
变体可以放在 `reference/` 或单独的变体目录，由外层选择注入哪个（与 `03`-M7 的
"变体选择在外层"取向一致）。

#### 证据

- KernelFoundry（arXiv:2603.12440）：meta-prompt 与 kernel 共进化；
  配合 MAP-Elites 与模板参数优化；SYCL KernelBench 平均 2.3x。
- Kernel-Smith（arXiv:2603.28342）：把长时程演化轨迹转成 step-centric 监督与 RL 信号，
  "使模型成为演化循环里的强局部改进者，而不是一次性生成器"——
  这是同一思想的训练侧版本（见 M4）。

#### 风险

- **过拟合到特定 case**：prompt 变体可能学到的是 case 特定技巧而非通用策略。
  需要 held-out（`05`-M1）来评估。
- 变体管理会引入新的 artifact 种类与版本问题。建议先在一个 worker 上做实验。

---

### M3 — 在线 skill 学习 + 审计

#### Motivation

M1 是人写、M2 是 prompt 演化，M3 是**skill 文件本身在使用中改进**。

SkillEvolver（arXiv:2605.10500）的设计有一条特别值得注意的机制差异：

> Unlike trace-distillation, the meta-skill refines only **after deploying** the learnt skill,
> such that the learning signal comes from **failures another agent encounters while using it**
> — not from exploratory traces alone.

也就是说：学习信号来自**别的 agent 实际使用这个 skill 时遇到的失败**，
而不是来自"生成这个 skill 时的探索轨迹"。这个区别很重要，
因为它把反馈从"我认为这有用"变成"它真的有用/没用"。

它还引入了一个必须抄的机制：**fresh-agent overfit audit**，
用来捕捉两类问题：
- **泄漏**（skill 里混进了只对特定 case 有效的知识）；
- **silent bypass**——**"a skill appears valid in content but is never invoked at runtime"**。

最后这一条与 PIANO 的内部教训完全对应（洞察 2 引的"rules≠behavior"）。
**skill 写了但从不被调用**，在 PIANO 里是一个**尚未被检测**的失效模式：
今天没有任何机制能回答"这条 SKILL.md 里的步骤，agent 这轮到底读了没有"。

#### 机制

分两个可独立落地的一半：

**(a) 可观测性（先做这一半）**：让"skill 是否被使用"可观测。
PIANO 的基础设施其实已经够用——`docs/deep-dive-notes/worker-total-prompt.md` 说明了
pi-cli 走 `--skill <dir>`、pi SDK 走 `<workflow_skill path=...>` 块注入。
如果这些注入在 transcript 里有痕迹，就可以做**静态审计**：
"这个 run 里，注入的 skill 被引用/被执行了吗？"
这与洞察 2 的"静态断言 + 行为 e2e"两层沉淀是同一种思路。

**(b) 学习循环（后做）**：按 SkillEvolver 的形态——
"先部署，再从失败中提炼"——需要一个**跨 run 的失败收集器**（依赖 `02`-M5），
以及一个**修订流程**与**审计门槛**。

#### 证据

- SkillEvolver（arXiv:2605.10500）：83 个 SkillsBench 任务 / 15+ 领域，
  56.8% accuracy vs 人工策展 skill 的 43.6% vs 无 skill 基线 29.9%；
  KernelBench 三个 GPU kernel 任务上把平均加速比从 1.16 提到 1.51；
  并显式定义了 overfit audit（含 silent bypass）。
- daVinci-kernel（arXiv:2606.16497）：技能只在"执行验证确认可复现加速"后入库；
  技能选择 agent 用 BM25 + LLM reranking 检索。

#### 风险

- **自动改 recipe 的风险很高**：recipe 是行为守则，改错会影响所有 run。
  建议：自动生成的候选 skill **先进入待审状态**，由人（或 M2 的审计门）批准后才生效。
  这与 PIANO 现有的 `signoff` 机制在精神上一致。
- **审计必须独立于生成者**：SkillEvolver 用的是 fresh agent。
  如果用同一个上下文自我审计，会确认自己的偏差。

---

### M4 — 轨迹 → 训练信号

#### Motivation

EFT（Evolution Fine-Tuning，arXiv:2606.29082）指出了一个被浪费的资源：

> prior work applied search scaffolds to one target task at a time, so every new problem is
> approached from scratch and the experience accumulated during search is discarded once the
> model finishes its attempt. This leaves the capability of iteratively evolving a solution
> entirely in the scaffold rather than in the model itself.

它把演化搜索轨迹转成监督信号：构建 Finch Collection（156K 轨迹 / 10 域 / 371 优化任务），
微调 2B-9B 开源模型。结果：held-out 22 任务上平均超过 base 10.22%；
配合 test-time RL 在两个 circle-packing 任务上达到 SOTA。

对 PIANO 的含义：**我们每天在产生高质量的搜索轨迹**（`actors/` 下的原始 transcript、
`trajectory.json`、`progress.jsonl`、各种 jsonl 记录器），
这些正是训练数据的原料。

#### 机制

三层，从便宜到贵：

1. **轨迹导出格式**（便宜）：定义一种稳定的导出格式，让轨迹可被外部工具消费。
   PIANO 已经有一半——`docs/workflow-trajectory-evaluation-prd.md` 定义的 recorder 体系
   就是"结构化、可跨 run 读取"的记录；缺的是"按任务/成功性打标签的导出"。
2. **离线偏好数据**（中）：把"同一轮里 winner vs loser"作为偏好对。
   这个信号 PIANO 天然具备（`selection.jsonl` 有 winnerKey 与 referee metric）。
3. **微调 / RL**（贵）：需要规模（EFT 用了 371 任务）与训练基础设施。

#### 证据

- EFT（arXiv:2606.29082）：Finch Collection 156K 轨迹；held-out +10.22%；
  test-time RL 后在两个 circle-packing 任务上 SOTA、在 Erdős minimum-overlap 上超过 base。
- Kernel-Smith（arXiv:2603.28342）：把轨迹转成 step-centric 监督与 RL，
  "retaining correctness-preserving, high-gain revisions"——
  这条筛选规则（保留"保正确性且高增益"的修改）值得直接抄进第 2 层。
- DRTriton（arXiv:2603.21465）：CSP-DAG 保证算子空间全覆盖与无偏均匀采样 + 课程 RL，
  7B 模型在 KernelBench L2 上 92% 任务超过 PyTorch（对比 GPT-5.2 的 23%）。
- KernelSmith 的落地证据：同一工作流产出对 SGLang、LMDeploy 的上游贡献，
  说明"benchmark → 生产"的迁移是可行的。

#### 风险

- **P4，不要现在做**。依赖：(a) 轨迹导出格式；(b) `02`-M5 的存储与治理；
  (c) 训练资源。
- 合规与授权：轨迹是用户 run 的产物，导出训练需明确边界。

---

### M5 — 两阶段专家分解写进 prompt 结构

#### Motivation

EGG（arXiv:2606.26758）的核心主张是：**分解本身比提示技巧更重要**。
它把 kernel 生成分成**两个层级分明的阶段**：

1. **algorithmic structure design**——建立高质量的计算结构基础；
2. **hardware-specific tuning**——通过并行映射、tensor tiling、内存优化做定向调整。

并明确说这一定义了**显式的优化目标**、**结构化了设计空间**、实现了**渐进式精化**；
配合 stage-aware 的多 agent 协作做阶段间/阶段内的上下文管理，**确保稳定的优化轨迹**。

回看 PIANO：`recipes/cuda-idea-tournament/agents.md` 已经在请求多样性
（"mix memory movement, tiling/layout, pipeline depth, occupancy/register pressure,
or launch topology rather than parameter sweeps of one knob"）——
**这些正是 EGG 的"hardware-specific tuning"那一层**。
但缺的是**第一层**：没有人先决定"这个算子的算法结构应该是什么"。

证据链条还有一条侧证：Correct but Slow（arXiv:2607.04454）的归因说
归一化/归约类的减速主要是**可修复的编写缺陷**（顺序归约、不必要的 dtype 转换），
而卷积与大型 GEMM 的残余差距来自**代码生成与 autotuning 覆盖度**——
这暗示"结构选择"和"实现细节"确实是可以分开归因的两类问题。

#### 机制

把"两阶段"写进 prompt 结构，而不是只写进"要求多样性"这句话：

- **`profile` 阶段**（已有）：从瓶颈证据出发，先决定本轮的**结构方向**
  （例如"这轮打 memory，用 tiling+layout 家族"），而不是直接列技术。
- **`idea` 阶段**：在结构方向下提出**具体技术**，每条都要写明它如何服务于该结构方向。

这与 `03`-M4 的 `mutation_scope`（local/structural）是同一族改动，可以合并设计。

#### 证据

- EGG（arXiv:2606.26758）：两阶段分解 + stage-aware 多 agent 协作；
  2.13x 平均加速，优于 agent-based 与 RL-based 方法。
- Correct but Slow（arXiv:2607.04454）：结构性差距与可修复编写缺陷的归因分离。
- CuTeGen（arXiv:2604.01489）：**delayed profiling schedule**——
  等高层结构稳定后再给低层性能反馈，是"结构优先"的另一种表达；
  KernelBench L1-L2 平均 1.71x，显著优于 CudaForge（0.89x）。

#### 风险

- 增加 `profile` 阶段的产出结构与校验（契约变更）。
- 若结构方向判断错误，整轮的 3 条 lane 都会打偏。
  缓解：允许一轮内**混合**（2 条遵守结构方向 + 1 条自由探索），这也是 `03`-M7 宽度自适应的一个输入。

## 6. 落地顺序与验收

| 步 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| 1 | **M1 最小版**：`reference/known-traps.md` 一页 + 按 `bottleneck` 注入 | 无 | 下一轮 idea 的 context 里出现该文件，且该 run 的失败类型有下降（需对照组） |
| 2 | **M5** 两阶段结构（与 `03`-M4 的 `mutation_scope` 合并设计） | 契约变更 | 一轮 run 里能看到"结构方向 → 具体技术"的层级 |
| 3 | **M3(a)** skill 使用可观测性审计 | 无 | 能回答"这个 run 里注入的 skill 是否被引用" |
| 4 | **M2** prompt 变体共进化（实验） | 需要 held-out 评估（`05`-M1） | 变体优劣可归因，不是过拟合 |
| — | M3(b) / M4 | `02`-M5 + 存储治理 | 长期项 |

## 7. 参考文献

arXiv:2607.17979（Harness Engineering）、arXiv:2607.14541（Atrex-Bench / AKA）、
arXiv:2606.26758（EGG）、arXiv:2605.26118（Xe-Forge）、arXiv:2606.26453（KernelPro）、
arXiv:2608.14560（Houmao）、arXiv:2603.12440（KernelFoundry）、arXiv:2603.28342（Kernel-Smith）、
arXiv:2605.10500（SkillEvolver）、arXiv:2606.16497（daVinci-kernel）、
arXiv:2606.29082（EFT）、arXiv:2603.21465（DRTriton）、arXiv:2607.04454（Correct but Slow）、
arXiv:2604.01489（CuTeGen）、arXiv:2605.16819（AgentKernelArena）

内部依据：`docs/deep-dive-notes/worker-total-prompt.md`、
`recipes/cuda-idea-tournament/agents.md` 与 `contract.json`、
`recipes/cuda-profile/agents.md`、`recipes/cuda-summary/agents.md`、
`docs/workflow-trajectory-evaluation-prd.md`（recorder 体系）
