#  工作流 E2E 测试与评估策略

本文说明  系统如何验证工作流（workflow）端到端正确性，从纯函数到真实 CLI 冒烟，逐层说明**每一层测什么、为什么测、以及为什么这样分层**。不是一份 README 式清单，而是对「为什么我们这么做」的析因。

## 核心判断：可替换的 SDK 边界，是分层能成立的前提

 工作流执行的调用链是：

```
main.ts → runSession → executeWorkflow → executeWorker → executeAgent → PiSdkModule
```

在这条链上，只有**一个真正的不可替换边界**：`executeAgent` 对 Pi SDK 的调用（建模、会话、资源加载、prompt 发送）。SDK 之外的一切——加载 workflow 文件、编译 stage、解析 `dependsOn`/`from`、按 DAG 调度、fan-out、validate、写日志/轨迹——都是纯 Effect 逻辑，不依赖任何外部进程或 API。

于是测试分层本质上回答一个问题：**把「测 SDK」和「测你自己的编排逻辑」这两件事，在哪个边界上切开。**

 的选择是一个可注入的 `AgentRunner`：

```ts
type AgentRunner = (request, options) => Effect<...>
// 真实实现：executeAgent(request, { ...options, sdk })
// 测试实现：executeAgent(request, { ...options, sdk: fakeSdk() })
```

`fakeAgentRunner(fakeSdk())` 这个 seam 让我们在 **SDK 之上、编排逻辑之下** 的整条链路都能跑，而 CI 里根本不需要一个真实的模型后端。这是下面所有「fake SDK」层的先决条件。

## 分层模型（由快至慢、由单元到真实）

| 层 | 位置 | 替掉的部分 | 保持真实的部分 | 回答的问题 |
|---|---|---|---|---|
| L1 纯逻辑 | `tests/format`、`logging`、`cli/headless-json` | 一切 IO | 纯函数 | 单点变换对不对 |
| L2 fake-SDK 单元 | `tests/harness`、`worker` | 真实 SDK | 工作流编排 + 日志/轨迹 | 编排逻辑对不对 |
| L3 注入 runner 集成 | `tests/workflow`、`tui` | 真实 SDK（注入 fake runner） | 完整 multi-stage 执行循环、文件证据与 handoff | 链路边界对不对 |
| L4 真实对等 e2e | `tests/workflow/basic-workflow-parity.e2e.test.ts` | 无（走真实 CLI + 真实 PTY） | 一切 | 与真实产物/字面一致 |
| L4 真实进程守卫（确定性） | `tests/workflow/tournament-real-cli.e2e.test.ts`、`tests/tui/tournament-workflow.pty.test.ts` | 真实模型（`piCli.bin` 指向 `tests/fixtures/tournament-real-run/fake-agent.mjs`） | 真实 CLI/TUI 进程、引擎、子进程协议、合并/清理 | multi-stage tournament 区域退出语义在真实进程栈下成立 |
| L5 evals（case 绑定） | `packages/evals` + `evals/**` | 按 case 例化 runner | workflow 文件 + case.yaml 读出 | 给定 workload 的 metrics/text 质检 |

下面逐层展开。

## L1 — 纯逻辑

格式化、JSON 事件行映射（`headless-json.ts`）、YAML 解析、状态转换、错误映射。

- **为什么这一层独立**：这些函数没有任何 Effect 依赖，输入输出是纯值。它们错误一旦混进上层测试，要么被 fake SDK 掩盖、要么被真实 CLI 的 stdout 淹没。
- **示例**：`agentEventLine(event, runId)` 输出 `{event:"agent_event", run_id, type, data}` 的外壳结构，用纯断言逐字段校验，不启动任何 Effect。

## L2 — fake-SDK 单元（harness / worker）

用 `fakeSdk()` 伪造 `PiSdkModule`（`ModelRuntime`/`SessionManager`/`SettingsManager`/`DefaultResourceLoader`/`createAgentSession`），跑真实的 `executeAgent`。这是 973 行 `pi-sdk.test.ts` 的层次。

- **为什么它是单元而非集成**：它验证的是 harness 对 SDK 契约的**消费方式**——模型解析、错误映射（`model-not-found` 这类 `AgentError`）、会话生命周期。SDK 的真实行为永远无法轻量复现，但我们对它**怎么被调用**的预期是稳定的。
- **关键点**：这一层只替换边界**以下**，边界以上的调用签名、错误类型、事件流都是真实的。

## L3 — 注入 runner 集成（workflow / tui）

这里不伪造 `PiSdkModule`，而是注入一个 `agentRunner`——可以是 `fakeAgentRunner(fakeSdk())`，也可以是一个完全手写的 `Effect.sync(...)`。`workflow-execution.test.ts` 的工作流执行用例全在此层。

- **为什么注入 runner 而不是注入 SDK**：multi-stage 的 DAG 调度、fan-out 并发、上游 handoff 记录/上下文文件、validate 的失败/形状校验，这些是**编排器**的行为，跟 SDK 无关。注入 runner 让我们精确控制每个 stage 的耗时、返回值、报错，从而断言：
  - `stages.map(s => s.id)` 的 DAG 顺序（`["first","second"]`、`["left","right","joined"]`）
  - fan-out 两个独立 stage 确实并发（用 `gate`/`bothStarted` 强制对表）
  - join stage 的 handoff 上下文按声明顺序包含 `left` 与 `right` 的输出，而 prompt 不拼接上游文本
  - `loadWorkflow → compileWorkflow → scheduleWorkflow → executeWorker → executeAgent` 的完整 trace 生命周期
- **为什么用临时目录 + 真文件**：`executeWorkflow` 依赖 `FileSystem`，写临时 workflow.（实际是 `writeFile` 到 `mkdtemp`）让 `loadWorkflow` 走真实的文件读取路径，而不是 mock `readFile`。这保留了「文件加载失败」这类问题的可见性。

## L4 — 真实对等 e2e（basic-workflow-parity.e2e.test.ts）

这是**唯一**走真实 CLI 的层：`piano -p`（headless）和 PTY TUI（经 `script` + `@xterm/headless`）各跑一次同一 basic workflow，对比两者结果，并校验 `trajectory.json`/token 的 parity。

- **为什么需要真实 e2e**：L2/L3 都是 fake SDK，任何真实模型/真实 SDK 的集成缺陷——真实事件流的形状、真实 transcript 的落盘、真实 PTY 的 ANSI 输出——都会被 fake 掩盖。真实 e2e 是最终「没见过的问题」的防线。
- **为什么用 parity 而不是逐字段断言**：模型输出非确定，逐字断言必然脆。parity 校验的是**两种前端（headless 文本 vs TUI）在同一工作流上产生等价结果**——结果文本、trajectory 结构、token 计数在合理误差（≤2x）内一致。这测的是「前端是否忠实呈现同一后端」，而非「模型答得对不对」。
- **数量克制**：它贵（要起真实 SDK/模型/PTY）。只保留 5 个本地 task、每个 3 次（共 15 对 TUI/headless trial）对基本路径的 parity，不做全量 case 覆盖——那是 L5 evals 的职责。

## L5 — evals（case 绑定的 TS 代码）

`evals` 的每个 workload 目录带一个 `case.yaml`，声明 `compileCommand`/`verifyCommand`，并可用完整的 `metric`/`baselineCommand`/`benchmarkCommand`/`metricPattern` 能力组合启用 performance readout，不再使用 write/tuning 类型标签。`artifact-evaluator.ts` 按配置执行 compile→verify→benchmark；`WorkflowEvaluator` 优先读取 `trajectories/index.json` 及各 recorder JSONL，并只通过 `LegacyRunAdapter` 兼容旧 `trajectory.json`/`progress.jsonl`。`scorer.ts` 对统一的 workflow case 做加权合成。

- **为什么 evals 是 TS 代码而非 workflow**：这是设计上一个关键区别，也是人类强调的一点——**evals 评分不是编排流程，它是绑定在每个 case 上的固定评分逻辑**（不同 case 有不同 metrics 收集与打分规则）。所以它合法地是 TS 代码，而不是「该迁移到 workflow 的编排」。
- **它测什么**：给定 workload 的产出是否满足判分标准——不是「工作流跑通了吗」，而是「这个 case 的解法质量是否达标」。这是 benchmark 层，不是 correctness 层。

## 为什么 multi-stage 还没有完整真实 E2E 覆盖

`executeWorkflow` 已执行完整 DAG，并递归展开 loop/map、保存 invocation 级证据、传递 handoff 记录和返回 `stages[]`。这些语义由 L3 的注入 runner 用例覆盖：它们能精确控制每个 stage 的耗时、结果与失败，而不依赖真实模型。

L4 的 parity e2e 目前仍只对 basic 单 stage 对表。multi-stage 的真实进程栈守卫已经建立:`tournament-real-cli`/`tournament-workflow.pty` 用真实 CLI/TUI 子进程跑 loop 套 tournament 的 fixture(`piCli.bin` 替换为确定性 fake agent,免凭据、CI 常开),守住区域退出定胜负与逐轮合并的时序;真实模型侧由门控的 `real-consolidation.e2e.test.ts` loop 嵌套用例(每轮一次真实 `$consolidate` turn)覆盖。剩余「真实模型下的多阶段 parity」(两前端对同一 multi-stage 工作流的等价性)仍是后续工作。

## 分层策略的收益与代价

**收益**
- CI 无真实模型后端即可全绿（L1–L3），只有 L4/L5 需要网络/密钥/`script`。
- SDK 的脆弱点（版本升级、契约变化）被隔离在单一 seam 之后，修复面最小。
- 编排缺陷（并发、DAG、依赖注入）在快层即可定位，不拖到真实 e2e。

**代价**
- 维护 fake SDK 与真实 SDK 的契约一致，需随 SDK 演进补 fake。
- L4 parity 依赖非确定输出，需精心校准误差阈值，过松会漏检、过紧会误报。
- 分层带来的「同一路径多份测试」有冗余，需自觉控制各层只测边界处、不重复 L1 的纯断言。

## 结论

 的测试策略是一棵**以 SDK 边界为单一缝合点**的分层树：纯逻辑靠纯断言，编排靠注入 runner，SDK 契约靠 fake，真实一致性靠少量 parity e2e，解法质量靠 case 绑定的 evals。这个结构之所以成立，是因为「可注入 `AgentRunner`」把一个无法在 CI 轻量复现的外部依赖，变成了可以完全替换的种子——其余各层各自只测自己边界内的行为。
