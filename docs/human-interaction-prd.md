# 人机交互（signoff / discuss / `/btw`）与调优可见性 — PRD

- Status: **设计稿 v2 — 方向已按 2026-09-11 讨论修正；未改任何代码**
- Date: 2026-09-11
- Scope baseline: `1c88587`（main，MR !25 合并后）
- Primary areas: `packages/cli`、`packages/harness`、`packages/orchestrator`
- 相关文档：
  - `docs/steering-messages-prd.md` — steering（**本 PRD 已将其移出范围**，理由见 §1.3）
  - `docs/harness-headless-interaction-capabilities.md` — harness 提问能力；**本文 §3.2 用实测修正了它的一个结论**
  - `docs/proposals/worker-before-after-primitives.md` + 分支 `feat/stage-before-after-prompts`（`65ad3ed`）— 已实现的 `before`/`after`，与新 signoff 设计相邻

## v1 → v2 的方向修正

| 项 | v1（本文档初稿） | v2（现行） |
|---|---|---|
| signoff | 描述现状 + 补轮次上限/语义分级 | **重新定位**：非侵入、Piano 内置、在**阶段流转**时弹对话框，动作为"带 prompt 继续 / 带 prompt 重做" |
| discuss | 记为"pi-only 是一个缺口" | **升级为唯一的 agent 主动对话通道，pi-only 成为阻塞项**，需真实覆盖 |
| steering | P2 建议为其补齐 dsh/pi-cli | **移出范围**（优先级低、机制仍有问题、不适合挂机工作流） |
| `/btw` | 一段现状描述 | **下一步重点**，需单独对齐 UX |

---

## 1. 目标形态

### 1.1 signoff — 非侵入的 Piano 内置阶段闸门

- **不侵入 agent**：不注册工具、不在 worker 指令里留痕、不把"你被人类驳回了"写进 prompt。
- **Piano 内置**：agent 干完活后，由 Piano 在**阶段流转**处弹对话框。
- **两个动作，都带用户输入**：`continue to next worker with prompt 【用户输入】` 或 `retry on this worker with prompt 【用户输入】`。

### 1.2 discuss — agent 主动对话

- agent 主动调用一个**内置工具**，拉起 Piano 的对话框。
- 与 signoff 相反：入口**必须**在 agent 侧可见（这是它的定义），但**不应该**要求 workflow 作者去改 worker 的 `agents.md`。

### 1.3 steering — 暂缓（移出本 PRD）

优先级不高、机制仍有问题，且它语义上就是"影响一个正在跑的 turn"，与挂机工作流天然不匹配。v1 中"为 dsh/pi-cli 实现 steering"的 P2 建议**已从本文档移除**；§6.5 / §6.6 仅作为历史记录保留。

### 1.4 `/btw` — 下一步重点

需与开发者对齐 UX，待决问题见 §8.2。

### 1.5 现状一眼（核对用）

四个能力的**成熟度差异极大**，而 UI 并没有把这层差异告诉用户：

| 能力 | 定位 | 形态 | 真实可用范围 |
|---|---|---|---|
| **signoff** | 事后验收闸门 | 引擎阻塞 → Piano 自有 UI 提问 | 所有 harness（Piano 拥有终端，不依赖 harness） |
| **discuss** | 运行中向 supervisor 提问 | pi 的**自定义工具** | **仅 pi**；claude / dsh / pi-cli 静默无效 |
| **steering** | 向正在跑的 turn 注入消息 | harness 侧绑定 live session | **仅 pi、claude**；dsh / pi-cli 退化为"下一轮 prompt"（已出范围） |
| **`/btw`** | 侧边 agent | TUI 内直接跑一次 pi agent 调用 | 仅 pi（由 `executeAgent` 决定），不参与 mission |

两个仍然成立的结论：

1. **能力是"harness 相关"的，但用户看到的是同一套 UI。** 同一个 `discuss: true`，在 pi 上能问，在 claude 上什么都不发生，且**不报错、不告警**。
2. **已交付的 recipe 里存在与事实不符的配置。** `recipes/workflows/coding-team.yml:27` 给 `harness: claude` 的 architect stage 打开 `discuss: true`，注释写着"interactive TUI runs can still ask"——这个 harness 上问不出来；`evals/workloads/coding-team-questions-claude-gpt-5.6-luna-max/case.yaml` 整个 case 的题面前提就是这个能力。

---

## 2. 四个功能的现状（核对基线）

### 2.1 signoff — 事后人工验收闸门

**契约**：`WorkflowStage.signoff?: boolean`（`packages/orchestrator/src/workflow.ts:39-41`）。引擎在**一次 attempt 被接受之后**弹出闸门，阻塞直到人做决定；reject 会带着反馈重开**同一个 actor session**。

> **注意触发点是"attempt 被接受"，不是"阶段流转"** —— 详见 §2.5 的三层侵入分析。

**引擎侧**（`packages/orchestrator/src/workflow-execution.ts`）：

- 预检：workflow 里有 `signoff: true` 的 stage 而 run 没给 signoff 通道 → 启动即失败（`:2188`）。
- `requestSignoff`（`:2480-2538`）：只在 stage 声明了 signoff 时才问；用一个 `signoffSemaphore`（`:2267`）串行化，避免并发 map lane 同时弹面板。
- 请求体（`:188-208`）：`stageId / invocationId / stage / worker / harness / round / resultPath? / transcriptPath / excerpt(≤600 字符)`。
- 决定：`{ type: "approve" }` 或 `{ type: "reject", feedback }`。
- **reject 后**：`signoffFeedback = decision.feedback; attempt += 1; continue;`（`:2780-2785` 与 `:2827-2832` 两处，分别对应"无 validate"和"validate 通过"两条路径）。反馈被拼进下一次 stage prompt 的 `## Sign-off feedback` 段（`:612-619`）。轨迹记一条 `stage_attempt_finished / outcome: "signoff_rejected"`（`:2526-2534`）。

**TUI 侧**（`packages/cli/src/signoff.ts`）：

- `signoffSpec`（`:14-45`）：标题 `Sign off <stageId>[ (round N)]?`，details 带 result 摘录 / validated result 路径 / transcript 路径；两个选项 `approve` / `reject`。
- reject 会走第二步 `signoffFeedbackSpec`（`:49-55`）自由文本；空文本也构造一个 reject，保证"actor 总会知道发生了什么"（`:88-92`）。
- **取消 = 失败**：`signoffCancelled`（`:59-66`）→ `WorkflowError{ phase: "schedule", path: stageId, message: "sign-off review was cancelled" }`。注释明确说这是刻意的："A cancelled review must never silently approve"。
- `signoffDecisionText`（`:106-113`）在 TUI 里被回显成一条**用户消息**（`tui.ts:936-950` 的 `Effect.tap`），所以"决定 + 用户打的理由"留在 transcript 里，不随面板消失。
- **headless 自动放行**：`headlessSignoffChannel`（`:115-`）对每一次请求返回 approve。`piano -p` 因此永远不会停在闸门（`session-run.ts:200, 205`）。

**测试**（覆盖扎实，且都有反向验证）：

- `tests/cli/headless-signoff.test.ts`（31 行）：自动 approve、round 3 也 approve。
- `tests/tui/signoff-panel.test.ts`（269 行）：面板挂为 chat 最后一个 block、approve 关闭、reject→第二步自由文本、Esc 取消；`SignoffBlock` 的边框/配色/键盘行为。
- `tests/tui/signoff.pty.test.ts`（136 行）：真 pty。
- `tests/workflow/esc-pauses-run.test.ts:283` —"a rejected sign-off keeps the turn's session durable the moment it lands"：验证 reject→rework 期间 `resume.json` 已经落了 actor session。
- `tests/workflow/workflow-execution.test.ts`、`tests/cli/session-reject-resume.test.ts`、`tests/tui/prompt-queue.test.ts`。

**缺口**：见 §6.1（reject 无上限）、§6.2（取消语义与全局 Esc 冲突）、§6.4（**没有任何 shipped recipe 开这个开关**——`grep -rn signoff recipes/` 结果 0 行，只在 `docs/proposals/` 与 `docs/uml-ascii-diagrams.txt` 里出现）。

---

### 2.2 discuss — 运行中向 supervisor 提问

**契约**：`WorkflowStage.discuss?: boolean`（`workflow.ts:42-43`，注释："Allow the worker to ask the supervisor for guidance during its turn"）。

**引擎侧**：预检同样只检查"有没有通道"（`:2195-2200`）；stage 声明 discuss 且通道存在时，把回调塞进 worker 请求（`:2640-2654`），`round` 传的是当前 `attempt`。

**harness 侧**：**这是 pi 独有的自定义工具**。

- `packages/harness/src/tool-names.ts:11`：`PI_CUSTOM_TOOL_NAMES = ["web_fetch", "discuss"]`。
- `packages/harness/src/pi.ts:787-812`：只有 pi 适配器用 `buildCustomTools(request.tools, request.discuss)` 把 `discuss` 挂成一个 tool，`tool-result` 就是 supervisor 的原文。
- `packages/harness/src/subprocess.ts` 里 **`discuss` 出现 0 次**——claude / dsh / pi-cli 三个子进程 harness 完全不知道这个字段存在，`AgentRequest.discuss`（`pi.ts:71-72` 声明）被静默丢弃。

**TUI 侧**（`packages/cli/src/discuss.ts`，仅 37 行）：`discussSpec` 是自由文本，标题 `Discuss with <worker> (<stageId>)`；**复用 signoff 的同一个面板**（`tui.ts:954-955`）；取消 → `WorkflowError{ phase:"schedule", message:"discussion was cancelled" }`。与 signoff 不同，**discuss 没有把问答回显成用户消息**。headless 返回固定字符串 `"please make decision by yourself, i am not here"`（`:35-37`），刻意不把"没人"当成隐式批准。

**测试**：`tests/workflow/discuss-primitive.test.ts`（72 行，4 条）：DSL 默认 false / 显式 true / 坏值拒绝；**挂载测试只用了 `harness: "pi"`**；headless 替身回答测试虽然构造了 `harness: "claude"`，但只调用 channel，不经过 harness，所以**不可能发现 claude 上无效**。

**缺口**：见 §6.3（shipped recipe + eval case 依赖一个在 claude 上不存在的能力）。与目标形态的差距见 §2.5 与 §3.2。

---

### 2.3 steering — 向正在运行的 turn 注入消息

> **本 PRD 已将其移出范围（§1.3）。** 以下记录保留作为历史与参考，不再作为改进项。

**契约**（`packages/harness/src/steering.ts`，68 行，设计得很干净）：

- `SteerDelivery = "delivered" | "no-active-turn"`；promise reject 是第三种答案（live session 拒绝），不能吞。
- `SteeringChannel.steer(text)`：能力查询 + 投递。
- `SteeringChannel.bind(target | undefined)`：返回 unbind，**generation token 保证 last-write-wins**，过期 unbind 不会偷走新 session 的绑定（`:57-68`）。
- 设计原则写得很清楚：**调用方永远不按 harness 名分支**，只问通道。

**绑定点（只有两处）**：

- `packages/harness/src/pi.ts:1348-1354`：`session.session.steer === undefined ? undefined : {...}` —— 能力探测，不是名字判断。
- `packages/harness/src/subprocess.ts:1920-1926`：只有 `harness === "claude"` 才有 `stdinBridge`，`onControl` 里 `bind({ steer: (text) => control.writeFrame(text) })`。

**dsh / pi-cli 从不绑定**，源码注释也承认这一点（`subprocess.ts:1915-1918`、`steering.ts:16-18`："their dedicated implementations are follow-up work"）。

**线程路径**：`session-run.ts:200-213` 每个 prompt 建一个通道，写进 `activeSteering`；`tui.ts:517-519` 通过 `steerActive` 暴露给 TUI；`worker.ts:38-40, 103` 透传到 `AgentRequest`。

**TUI 语义**（`tui.ts:1013-1063`）——这里的设计其实很讲究：

```
promptRunning ─┬─ steerActive 缺失/返回 no-active-turn ─┬─ promptRunning 仍为 true → pendingPrompt（"queued — runs as the next prompt when this workflow finishes"）
               │                                        └─ 期间 run 结束了 → submitPrompt(text)（不丢输入）
               ├─ 返回 delivered → "⚑ steered — <text>"
               └─ promise reject → "queued — steering refused"
```

**测试**：`tests/harness/steering.test.ts`（66 行，7 条：未绑定 / 转发 / 解绑 / 能力探测 / 过期 unbind / 空白输入 / 拒绝上抛）+ 两个**真模型 e2e**（`real-pi-steering.e2e.test.ts`、`real-claude-steering.e2e.test.ts`，断言 steer 的标记出现在**同一个 turn**里，排队语义会失败）。TUI 侧只有 `tests/tui/prompt-queue.test.ts:273` 断言 `"steering refused"` 文案。

**缺口**：见 §6.5（能力差异不可见）、§6.6（steering 完全不可发现）。

---

### 2.4 `/btw` — 侧边 agent

**契约**（`packages/cli/src/side-agent.ts`，60 行）：

- `SIDE_AGENT_TOOLS`（`:9-18`）：`read / bash / edit / write / find / grep / ls / web_search` —— **故意带写和执行能力**，注释说明"这是 `/btw` 的全部意义"。
- `SIDE_AGENT_DIR = "side-agent"`（`:25`）：`executions/` 的**兄弟目录而非子目录**，避免侧边 agent 的 transcript 被读成某个 stage 的证据。
- `sideAgentRequest`（`:49-59`）：不带 workflow / execution / stage；`model / provider / thinkingLevel` 全部留空，让 pi 自己的配置决定。
- **它总是跑在 pi 上**：`session-run.ts:329-370` 调的是 `executeAgent`（`packages/harness/src/pi.ts:955`，in-process pi SDK 适配器）。mission 跑 claude/dsh 时，`/btw` 仍然是一个 pi agent。
- `sideContinuation` 串联多次 `/btw`，所以它是**一个连续对话**而不是一串陌生人（`session-run.ts:329` 附近的 `let sideContinuation`；`tests/cli/side-agent-session.test.ts` 有对应断言）。

**TUI 侧**：`toggleSideAgent`（`tui.ts:984-1011`）在跑 prompt 时拒绝切换（同一个 TUI 只有一条活跃 turn，保证 trajectory 面板 / footer 计数 / 中断键不歧义）；`showChat`（`:963-976`）把 mission 的 chat **放到后面而不是销毁**，footer 加一条 `⌥ side agent · edit + bash in <cwd> · /btw returns to the run` 提示。`/btw` 复用同一条 prompt 路径，因此 steering / 排队 / Esc / 轨迹面板行为完全一致。

**测试**：`tests/cli/side-agent.test.ts`（54 行，请求构造 6 条）、`tests/cli/side-agent-session.test.ts`（259 行，7 条含"不写 trajectory 与 execution 树"、"接管的 run 里开新侧边会话"）、`tests/tui/real-btw-side-agent.e2e.test.ts`（152 行，真模型）。

**缺口**：见 §6.7（结论无法回灌 mission）。待决 UX 问题见 §8.2。

---

### 2.5 三层"侵入"：signoff 只占最重的一层

| 侵入类型 | signoff | discuss |
|---|---|---|
| **worker 指令文件**（`agents.md`） | **0 命中** — `grep -rn "signoff" recipes/ --include=*.md` 为空 | **2 处** — `recipes/coding-architect/agents.md:3`、`recipes/architect/agents.md:44-45` 直接写给 agent 看："This stage has `discuss: true`. Use the supervisor discussion channel…" |
| **prompt 文本** | `## Sign-off feedback`（`workflow-execution.ts:612-619`），**仅驳回后**注入；措辞 `A human reviewer rejected your previous result for this stage.` 是一条**评价性指令**，会改变 agent 下一轮的行为框架 | 无 prompt 注入，但把 `discuss` 注册成一个 tool（`tool-names.ts:11` + `pi.ts:787-812`） |
| **控制流** | ✅ **真问题**：reject 被实现为 `attempt += 1; continue;`（`:2780-2785` / `:2827-2832`），寄生在 attempt 循环 + validation-repair 机制上 | 无 |

控制流侵入比表面更重：一次 reject 会让 `attempt += 1`，于是产生**新的 resultPath**（`validationResultPath(runDir, invocation, attempt)`）和新的 `stage_attempt_started` 轨迹观测。**今天的 signoff reject 实际上是"重跑整个 stage"，而不是"让 agent 再做一轮"。**

**结论**：需要改的是**控制流**（以及那句评价性措辞）。而 discuss 的"指令 + 工具"双重注册是它作为主动通道的**本质**，不该当作侵入消除，该当作能力补齐（§3.2）。

### 2.6 目标形态 vs 现状：一张对照表

| 维度 | signoff 现状 | signoff 目标 | discuss 现状 | discuss 目标 |
|---|---|---|---|---|
| 触发 | attempt 被接受（stage 内部） | **阶段流转**（stage 边界） | agent 调工具 | 同（不变） |
| 动作 | approve / reject+feedback | **continue+prompt / retry+prompt** | 单次自由文本 | 同（不变） |
| 控制流 | reject = 新 attempt（新 resultPath、重新 validate） | **待定**（见 §8.1 Q4） | 无 | 无 |
| 对 agent 的可见性 | 驳回后 prompt 里出现"人类驳回了你" | **完全不可见** | 工具 + `agents.md` 提及 | 工具可见，**`agents.md` 提及应移除** |
| harness 覆盖 | 全部（Piano 拥有终端） | 全部 | **仅 pi** | **待定**（见 §3.2 / §8.1 Q5） |
| headless | 恒 approve | 待定（今天闸门形同不存在） | 固定替身文本 | 同（不变） |
| 轮次上限 | **无**（§6.1） | 取决于 Q4 | n/a | n/a |

---

## 3. 覆盖矩阵与 discuss 实测

### 3.1 覆盖矩阵（真正可用性）

| 能力 | pi | claude | dsh | pi-cli | headless `piano -p` |
|---|---|---|---|---|---|
| signoff 闸门 | ✅ | ✅ | ✅ | ✅ | ❌ 恒 approve |
| discuss 提问 | ✅ | ❌ **静默无效** | ❌ **静默无效** | ❌ **静默无效** | ⚠️ 固定替身文本 |
| steering 注入 | — | — | — | — | **已出范围（§1.3）** |
| `/btw` | ✅（固定 pi） | n/a（不受 mission harness 影响） | n/a | n/a | ❌ |

一句话：**signoff 是 harness 无关的（因为终端在 Piano 手里）；discuss 是 harness 相关的，而它把"不可用"表达成了沉默。**

`docs/harness-headless-interaction-capabilities.md` 的推论——"那几种 harness 的原生提问工具在 headless/子进程模式下都不可回答，所以 Piano 才自己拥有 signoff/discuss 的 UI"——方向是对的；而"自己拥有 UI"只在 pi 上等于"能被 worker 调用"。下面用实测把这条结论钉死，并修正其中一处描述。

### 3.2 discuss 的 harness 覆盖：实测（新证据）

那份文档 §4 说 claude 的提问 "visible but not answerable in one-shot `-p`"，并归因于"Piano 的 single-shot 调用既没有 streaming-input 也没有 callback"。**这个归因已经过期** —— 为了让 steering 工作，claude 适配器现在跑的就是 streaming-input（`subprocess.ts:1365`），而且已经有可写的 stdin 帧通道（`ChildStdinControl.writeFrame`，`:1694-1717`）。所以做了真实探针重测，结果不是"不可回答"，而是更靠前的一步：

| 探针 | 参数 | 模型报告的可用工具 | `AskUserQuestion` 在列表里 | `control_request` 帧数 |
|---|---|---|---|---|
| v1 | `--bare` + `--allowed-tools AskUserQuestion Bash` | `Bash, Edit, Read` | **否** | 0 |
| v2 | `--bare`，无 `--allowed-tools` | `Bash, Edit, Read` | **否** | 0 |
| v3 | **无 `--bare`**，无 `--allowed-tools` | `Agent, Bash, CronCreate/Delete/List, DesignSync, Edit, EnterWorktree, ExitWorktree, ListAgents, NotebookEdit, Read, ReportFindings, ScheduleWakeup, SendMessage, Skill, Task*, WebFetch, WebSearch, Workflow, Write`（25 个） | **否** | 0 |

三次运行的共同点：**没有任何 `control_request` 帧**、**没有任何 `AskUserQuestion` 的 `tool_use`**、**没有任何 error tool_result**。

**结论（修正文档）**：在 `--print` 模式下，Claude Code 把 `AskUserQuestion` **从工具清单里直接摘掉**，而不是"提供但 auto-deny"。

- 这比原文档的描述更彻底：既然工具从未被提供，就不会有 tool call、不会有 error tool result，也**没有任何东西可以被"回答"**。
- **不能通过 allow-listing 加回来**（v1 证明：`--allowed-tools AskUserQuestion` 之后，模型仍只看到 `Bash, Edit, Read`）。
- **顺带发现的文档不一致**：`packages/harness/src/tool-names.ts:24` 把 `AskUserQuestion` 列为合法的 claude stage 工具名，`docs/harness-headless-interaction-capabilities.md` §2 也有它的映射行 ⇒ 一个 stage 可以写 `tools: [AskUserQuestion]` 并通过校验，**但那个工具永远不会出现**。这属于"声明了不存在的能力"，应至少加注释或从目录移除。
- 环境备注：本机 claude 走网关（由 `resolveHarnessConfig("claude")` 解析），且 save-token 代理会在结果前注入一行状态横幅；探针的判定只依赖工具清单与帧类型，不受横幅影响。

### 3.3 三条实现路径

| harness | 路径 | 成本 | 依据 |
|---|---|---|---|
| **pi** | 已实现 | 0 | `tool-names.ts:11`、`pi.ts:787-812` |
| **claude** | **Piano 自建 MCP server**，把一个 `discuss`/`ask_supervisor` 工具经 `--mcp-config` 注入，工具内部转 Piano 的 discuss 通道 | 中（新组件） | `claude --help` 确认支持 `--mcp-config <configs...>` 与 `--strict-mcp-config`。原生 `AskUserQuestion` 路线已由 §3.2 排除 |
| **dsh** | `--patch` overlay plugin 注册 `userQuestions` provider，把 `ask()` 转发到 Piano 通道 | 中低（**范式已验证**） | `dsh-user-questions/lib/index.js` 暴露 `registerProvider`；`dsh-tool-ask-user/lib/index.js:12,97`：`inject = ["tools","userQuestions"]`、`ctx.userQuestions.ask({...})`。而 dsh resume-runner 就是一个 `--patch` overlay plugin，已在真实 launcher 上跑通 |
| pi-cli | 未探测 | ? | 需单独确认它是否支持 MCP 或自定义工具 |

**建议**：若 MCP server 可行，它对 claude 与 pi-cli **是同一个组件**，比"每个 harness 各写一套"便宜。dsh 走 overlay plugin，与已有 resume-runner 共享范式。这两条都要单独立项（§7 P2），不塞进本次改动。

---

## 4. 调优视角：可见性

### 4.1 今天能看到什么（做了的）

| 观测点 | 载体 | 刷新 | 证据 |
|---|---|---|---|
| 整个 DAG + 每 stage 状态 | footer WORKFLOW 列（pulse 闪烁） | 500 ms 轮询 `progress.json` | `tui.ts:1077-1085`；`workflow-graph.ts:128, 348-350` |
| 每 stage 累计耗时 | DAG 节点 | 同上 | `workflow-graph.ts:626-640`（`nodeTimeMs`） |
| 当前 stage / worker / model | chat 的 `↳ <stage> <worker>` spawn 行 + 稳定配色 | 事件驱动 | `chat-render.ts:32-47, 391-414` |
| 工具调用 / 结果 / 消息 / 错误 / 重试 | chat + trajectory ledger（9 种 kind） | 事件驱动 | `trajectory.ts:12-23, 127-245` |
| tokens / tools / stages / 状态 | footer USAGE 列（4 行） | 事件驱动 | `run-stats.ts:190-200` |
| 上一次 run 的完整对话 | `/resume` 回放全部 turn 到 chat | 手动 | `tui.ts:796-800` |

### 4.2 今天看不到什么（缺口）

| # | 缺口 | 根因 / 证据 |
|---|---|---|
| **V1** | **多 prompt 调优会话里，用量每次提交归零** | `tui.ts:1072` 每次 `submitPrompt` 执行 `stats = emptyRunStats()`；`tui.ts:828` 接管 run 时同样归零。而 `run-stats.ts:1-8` 的注释自称"ONE running total per run … so the footer can always report the whole run's consumption"——**两处意图互相矛盾**。调优 = 一个 run 多次 prompt，用户最想看的恰是 run 级累计 |
| **V2** | 没有 per-stage token 归属 | footer 只有全局 `tokens ↑↓`；DAG 有 per-stage 耗时但无 per-stage token。`usage` 事件在 `trajectory.ts:231` 只作为一条 ledger 行，不做 stage 归集。**"哪个 stage 烧了钱"无法回答** |
| **V3** | 完全没有成本（金额）会计 | 全仓无 cost/price 计算 |
| **V4** | **stage prompt 不可见** | `stagePrompt`（`workflow-execution.ts:556-621`）会内联 handoff 上下文、validation guidance、repair 原因、signoff feedback，但 chat 只回显用户原始输入（`tui.ts:1070` 的 `renderUserMessage(prompt)`）。想确认"模型到底被告知了什么"必须去读 harness transcript 文件 |
| **V5** | `/resume` 后 trajectory 面板只剩最后一个 turn | `tui.ts:806-816` 注释："The trajectory panel is per-prompt, so it carries the last turn only"。chat 是全量回放，但 ledger 不是 |
| **V6** | discuss 的问答没有专门呈现 | signoff 用 `signoffDecisionText` 回显成用户消息（`tui.ts:936-950`），discuss 没有等价物（`tui.ts:954-955`），只在 ledger 里和任意一个 tool_call 长得一样 |
| **V7** | 没有 `/status` 汇总视图 | 当前 stage / attempt / round / 剩余 stage / 已耗时 / 已花 token 只能从 footer DAG + 上滚 chat 里拼 |
| ~~V8~~ | ~~steering 的投递结果信息量不足~~ | **出范围（§1.3）**。`⚑ steered — <text>` / `queued — …`（`tui.ts:1030, 1039`）不区分"该后端无 steering 实现"与"此刻无活跃 turn" |
| **V9** | 因取消而失败时，chat 不说原因 | `signoffCancelled` / `"discussion was cancelled"` 都变成一次 stage 失败；面板已关，用户只看到 run 失败 |
| **V10** | 没有 run 级摘要产物 | 除 `progress.json` 外没有可对比两次调优的 summary；横向对比只能靠 evals |

---

## 5. 调优视角：掌控度

### 5.1 今天能影响什么

| 杠杆 | 作用面 | 时点 | 证据 |
|---|---|---|---|
| 运行中直接打字（steering，已出范围） | 一个**正在跑的 turn** 的文本（pi/claude）；否则变成下一次 prompt | 立即 | `tui.ts:1013-1063` |
| `Esc` | 中断当前 prompt（run 最终记为 `paused`，**可续**） | 立即 | `tests/workflow/esc-pauses-run.test.ts` |
| signoff 面板 approve/reject | 一个 stage 的**接受与否**，reject 带反馈重开同一 actor | stage 之后 | `workflow-execution.ts:2480-2538` |
| discuss 面板 | 一个**正在跑的 turn** 的下一步动作（仅 pi） | stage 之内 | `pi.ts:787-812` |
| `/btw` | 同一个 workspace 的文件与命令（pi，8 种工具） | 无 prompt 在跑时 | `side-agent.ts:9-18`、`tui.ts:984-1011` |
| `/workflow`、`/workspace` | 下一次 prompt 的图与工作目录 | 下一次 prompt | `session-run.ts:484-500` |
| `/resume` | 换一个 run 接管当前 TUI | 无 prompt 在跑时 | `tui.ts:1205-1215` |

### 5.2 今天不能影响什么（缺口）

| # | 缺口 | 根因 / 证据 |
|---|---|---|
| ~~C1~~ | ~~dsh / pi-cli 上无法真正 steering~~ | **出范围（§1.3）**。`subprocess.ts:1920-1926` 只有 claude 有 `stdinBridge` |
| **C2** | claude / dsh / pi-cli 上 `discuss: true` 静默无效 | `tool-names.ts:11`、`pi.ts:787-812`；`subprocess.ts` 0 命中 |
| **C3** | **signoff reject 没有轮次上限** | `workflow-execution.ts:2780-2785`、`:2827-2832` 都是 `attempt += 1; continue;`，无任何预算检查；对比 validation repair 有 `VALIDATE_REPAIR_ATTEMPTS = 1`（`:325`、`:2877`）。**用户可以在面板上无限 reject，每轮烧一整次 agent turn，UI 不提示、不封顶** |
| **C4** | **面板里的 Esc 会硬失败整个 stage/run，与全局 Esc = 可恢复暂停冲突** | `signoff.ts:59-66`；discuss 同理（`discuss.ts:25`）。想"先把面板关掉"的用户没有第三选项 |
| **C5** | 闸门只在 stage **之后**（post-hoc），无法"先看计划再放行" | `signoff` 语义 = 验收；没有 pre-stage 放行 |
| **C6** | 没有单 stage 操作：`/retry <stage>`、`/skip <stage>`、`/stop-after <stage>` 都不存在 | `tui-commands.ts:4-12` 全部命令：`exit / btw / rename / resume / side / workspace / workflow` |
| **C7** | run 中途不能改 stage 配置（合理），但 UI 只说"workflow: X"，不说明影响面是同一个 runDir 的后续 stage | `session-run.ts:484-500` 的 `loadedWorkflow = loaded` |
| **C8** | `/btw` 的结论无法回灌 mission | 两个 runner 共享 steering/queue 机制但 `sideContinuation` 是独立变量（`session-run.ts:329`），没有把侧边结论送进 mission 的通道 |
| **C9** | worker 若用 harness 原生提问（Claude `AskUserQuestion` / dsh `ask_user_question`），等于白问 | `docs/harness-headless-interaction-capabilities.md` §3：两种都在 headless 下退化为一个干净的工具报错 |
| **C10** | headless 下没有闸门中间态 | `headlessSignoffChannel` 恒 approve（`signoff.ts:115-`）；`piano -p` 跑带 signoff 的 workflow 时闸门形同不存在，没有 `--signoff=reject` 之类的开关 |
| **C11** | 停止粒度太粗：只有"立即中断"，没有"暂停在下一个 stage 边界" | Esc 语义见 `tui.ts`；无 stage boundary breakpoint |
| **C12** | discuss 的取消同样硬失败 | `discuss.ts:25` |

---

## 6. 已确认的缺陷与风险（按严重度）

### 6.1 signoff reject 无上限（新发现，未记录在任何 issue/文档）

- 证据：`workflow-execution.ts:2780-2785`（无 validate 分支）与 `:2827-2832`（validate 通过分支）均为 `signoffFeedback = decision.feedback; attempt += 1; continue;`。
- 对照：validation repair 有明确上限 `VALIDATE_REPAIR_ATTEMPTS = 1`（`:325`，检查在 `:2877`），超限即 `Effect.fail(acceptCheck.left)`。
- 影响：一个在面板上反复 reject 的用户会让 run 无限重跑同一个 stage；`round` 只增不减，没有"已达上限"的提示。疲劳操作或面板误按都会放大成本。
- 建议：引入 `SIGNOFF_MAX_ROUNDS`（或缺省复用 1），超限 fail 并给出明确消息；面板标题里显示 `round N / max`。
- **是否保留取决于 §8.1 Q4**：如果新设计让 retry 之后不再重复弹面板，本项自动消解；否则必须保留（且要防止"用户疲劳导致无限重跑"）。

### 6.2 面板内 Esc 与全局 Esc 语义冲突

- 证据：`signoff.ts:59-66`（Esc → `WorkflowError` → stage/run 失败）vs 全局 Esc（中断 prompt，`progress.json` 最终记 `paused`，**可续**，见 `tests/workflow/esc-pauses-run.test.ts:146, 202`）。
- 影响：同一个键，在面板聚焦时是"把 run 弄失败"，在别处是"暂停并能继续"。前者不可续（stage 失败会终止本次 executeWorkflow）。
- 建议：区分三个动作 —— `Defer`（暂停 run，保留闸门）/ `Reject`（带反馈重开 actor）/ `Abort`（显式放弃并说明）。

### 6.3 `discuss: true` 在 claude 上是静默 no-op，且被 shipped recipe 与 eval case 依赖

- 事实链：
  - `discuss` 只在 pi 适配器里被挂成工具（`tool-names.ts:11`、`pi.ts:787-812`）；
  - `subprocess.ts`（claude / dsh / pi-cli）对 `discuss` 零引用；
  - `recipes/workflows/coding-team.yml:20-33` 的 architect stage：`harness: claude` + `discuss: true`，注释写 "keep the primitive enabled so interactive TUI runs can still ask"；
  - `evals/workloads/coding-team-questions-claude-gpt-5.6-luna-max/case.yaml:10-13` 要求 "Resolve both supervisor questions through the architect discuss primitive"。
- 影响：① recipe 注释与事实不符；② 该 eval case 的题面前提在当前 harness 下不可满足，而它的 readout 是 `programmatic`（typecheck + `npm test`），**不会**检测 discuss 是否真的被调用，因此这个 case 会给出一个"看似通过但没验证题面"的结果。
- 建议（分成"立即"与"专项"两步，依据 §3.2 的实测）：
  1. **立即**：让 `discuss: true` + 不支持该能力的 harness 在**启动预检**就失败（与 signoff 缺通道同款处理，`workflow-execution.ts:2188`），消除静默 no-op。
  2. **立即**：修正 `recipes/workflows/coding-team.yml:27` 与其注释；修正或加固 `evals/workloads/coding-team-questions-claude-gpt-5.6-luna-max/case.yaml`（给它一条能观测 discuss 被调用的断言）。
  3. **专项**：按 §3.3 给 claude/pi-cli 补 MCP server、给 dsh 补 `userQuestions` provider，让 discuss 真正覆盖多 harness（§7 P2）。

### 6.4 signoff 没有任何 shipped recipe 在用

- 证据：`grep -rn "signoff" recipes/` → 0 命中；只在 `docs/proposals/07-prompt-skill-evolution.md`、`docs/proposals/worker-before-after-primitives.md`、`docs/uml-ascii-diagrams.txt` 里提到。
- 影响：这是一个**实现完整、测试完整、但对用户不可达**的能力；调优用户想用必须自己写 YAML。
- 建议：至少在一个调优类 workflow 里示范（例如 cuda 调优的关键 stage 或 coding-team 的 review stage），或在 PRD/README 里给出明确的"如何开启"。

### 6.5 steering 能力差异不可见（已出范围）

> §1.3 已将其移出范围；本节仅作历史记录。

- 证据：`subprocess.ts:1920-1926` 只有 claude 绑定；`tui.ts:1030-1041` 只区分 `delivered` / 排队 / refusal，不告诉用户原因是"该后端无 steering 实现"还是"此刻没有活跃 turn"。
- 影响：dsh 用户以为自己 steering 了，实际是排队；且他在 UI 上无法发现这一点（除非注意到文案是 "queued" 而不是 "⚑ steered"，而 footer 的 SHORTCUTS 列里根本没有 steering 这一行）。
- 建议：`SteerDelivery` 细分（或通道暴露 `capability()`），TUI 分文案：`⚑ steered` / `⏸ no live session on this backend — queued` / `⏸ no active turn — queued`。

### 6.6 steering 完全不可发现（已出范围）

> §1.3 已将其移出范围；本节仅作历史记录。

- 证据：footer SHORTCUTS 列（`status-panel.ts:95-111`）只有 `Esc interrupt / Ctrl+C exit / Enter submit / Ctrl+Home/End jump / Alt+C copy mode`；COMMANDS 列只有 7 个 slash 命令（`tui-commands.ts:4-12`）。**没有任何地方告诉用户可以"运行中直接打字"**。
- 影响：这是今天唯一能在 turn 内部施加影响的手段（pi/claude），却是靠口口相传的。
- 建议：加一行 `type while running  steer / queue`，或在第一次进入 `promptRunning` 时在 chat 里给一次一次性提示。

### 6.7 用量归零与文档意图矛盾

- 证据：`run-stats.ts:1-8` 声称"ONE running total per run … report the whole run's consumption"，但 `tui.ts:1072`（每次 prompt）与 `:828`（每次接管 run）都 `stats = emptyRunStats()`。
- 影响：多 prompt 调优会话里，footer 的 tokens/tools/stages 只反映**当前这一条 prompt**；"这一轮调优一共花了多少"没有答案。
- 建议：明确"本轮 / 本 run"两级，footer 同时给出或可切换；至少把 run 级累计落进 `progress.json`。

### 6.8 `AskUserQuestion` 被声明为合法工具名，但在 print 模式下永远不会出现

- 证据：`tool-names.ts:24` 把 `AskUserQuestion` 列入 claude 工具目录；`docs/harness-headless-interaction-capabilities.md` §2 也有映射行。而 §3.2 的实测表明它**根本不在模型的工具清单里**（去掉 `--bare` 也一样，allow-list 也无法加回）。
- 影响：一个 stage 可以写 `tools: [AskUserQuestion]` 并通过 parse/compile 校验，**但那个工具永远不会出现**。这是"声明了不存在的能力"，会误导 recipe 作者（与 §6.3 的 recipe 注释问题同源）。
- 建议：从目录移除，或就地加注释说明"print 模式不可用；如需提问请用 discuss"，并对应修正参考文档 §2 的映射行。

---

## 7. 改进建议（分级）

### P0 — signoff 重构 + discuss 一致性（应当先做）

1. **signoff 重新定位为阶段流转闸门**（§2.5、§2.6）
   - dialog 移出 attempt 循环，落在 stage 边界
   - 动作改为 `continue with prompt` / `retry with prompt`
   - 移除 `## Sign-off feedback` 的评价性措辞（`workflow-execution.ts:612-619`）
   - 复用 `after` 的两个正确细节：`decorateEvent` 事件归属、`continuation` 续同 session（分支 `feat/stage-before-after-prompts`）
   - 新增"用户文本 → 下一个 stage"的通道（§2.3；契约见 §8.1 Q3）
   - 测试：`tests/workflow/workflow-execution.test.ts`、`tests/workflow/stage-before-after.test.ts`
2. **discuss 的能力与 harness 对齐**（§6.3、§6.8、§3.2）
   - `discuss: true` + 不支持该能力的 harness → **启动预检即失败**（沿用 `:2188` 的 signoff 同款处理），消息指明 stage / harness / "discuss 当前仅 pi 支持"
   - 修正 `recipes/workflows/coding-team.yml:27` 与其注释
   - 修正或加固 `evals/workloads/coding-team-questions-claude-gpt-5.6-luna-max/case.yaml`
   - 处理 `tool-names.ts:24` 的 `AskUserQuestion`（§6.8）
   - 测试：`tests/workflow/discuss-primitive.test.ts` 增加 harness 维度的断言（现有 4 条没有）
3. **signoff 取消语义分级**（§6.2）
   - 面板内 Esc = Defer（暂停 run、闸门保留）/ Reject / Abort 三者分开；至少在 chat 里明确写出"因为你取消了 sign-off，run 在该 stage 失败"（V9）
   - 测试：扩展 `tests/tui/signoff-panel.test.ts` 的 Esc 用例

### P1 — 可见性（中等改动，调优收益最大）

4. **两级用量**（V1）：footer USAGE 增加 run 级累计行；`stats` 在 prompt 之间不再清零（本轮重置，run 累加）。
5. **per-stage token/成本归属**（V2、V3）：把 `usage` 快照按当前 stage 归集进 `progress.json`，DAG 节点第二行显示 stage token（模型名已有位置可借用）。
6. **`/status`**（V7）：当前 stage / invocation / attempt / round、已耗时、token、剩余 stage 数、最近一次 signoff/discuss 记录 —— 数据已全在 `progress.json` + trajectory 里。
7. **discuss 问答回显**（V6）：与 signoff 对齐，把"问 + 答"作为用户消息留在 chat 里。
8. **可直接查看 stage prompt**（V4）：`/prompt <stage>` 或 spawn 行的可展开视图（数据在 `trajectory.json` 的 `context` 事件与 harness transcript 里）。
9. **`/resume` 的 ledger 视图**（V5）：至少提供把全部 turn 折叠进 trajectory 面板的选项。
10. **run 级摘要产物**（V10）：除 `progress.json` 外增加可对比两次调优的 summary。

### P2 — discuss 的 harness 覆盖（需单独立项）

11. **claude / pi-cli：Piano 自建 MCP server + `--mcp-config`**（§3.3）：模块化一个 `discuss`/`ask_supervisor` 工具，内部转 Piano 的 discuss 通道。
12. **dsh：`userQuestions` provider overlay plugin**（§3.3）：复用 resume-runner 的 `--patch` overlay 范式（`inject` + `Config` + `apply`）。

### P3 — 掌控度（较大改动）

13. **闸门前置**（C5）：`signoff` 的"先看计划再放行"。
14. **单 stage 控制**（C6）：`/retry <stage>`、`/skip <stage>`、`/stop-after <stage>`（stage 边界自动暂停）。
15. **headless 闸门中间态**（C10）：`--signoff=approve|reject|ask`。
16. **`/btw` 结论回灌**（C8）：待 UX 对齐（§8.2）。

**已移除**：v1 的"为 dsh/pi-cli 实现 steering"（§1.3）。

---

## 8. 待决策项

### 8.1 阻塞 PRD 定稿的五个问题

| # | 问题 | 我的建议 | 影响面 |
|---|---|---|---|
| Q1 | "侵入"最终确认指哪一层？ | 控制流（§2.5）—— 另两层里，指令级其实在 discuss 身上 | 决定改控制流还是只改措辞 |
| Q2 | dialog 触发粒度：workflow 级每 stage 都弹，还是沿用 stage 级开关？ | workflow 级开关 + 可选 stage 级覆盖 | 决定 UI 与 DSL |
| Q3 | `continue` 的用户文本作用域：只给紧邻下一个 stage / 此后所有 stage / 写进 handoff？ | 只给紧邻的下一个 stage，用完即弃（最小惊讶，且与 `before` 的"invocation 局部"语义一致） | 决定 `stagePrompt` 契约 |
| Q4 | `retry` 是否产生新 attempt（新 resultPath、重新 validate）？retry 之后是否再弹？ | 产生新 attempt（否则无法改结果，见 §2.4，`after` 不能复用）；**必须设轮次上限**，否则 §6.1 保留 | 决定 §6.1 是否保留 |
| Q5 | discuss 覆盖目标：桥接全部 harness，还是只保 pi + 其余预检显式失败？ | 分两步：先做"显式失败"（P0-2，立即消除静默 no-op），再把桥接立为 P2 | 决定是否现在写 MCP server |

### 8.2 `/btw` 的 UX 待对齐点

- **回灌 mission**：今天不能（`sideContinuation` 独立，`session-run.ts:329`）。要不要给一条显式通道（如 `/btw --send-to-run <text>`）？
- **进入时机**：今天 `promptRunning` 时拒绝切换（`tui.ts:984-1011`，理由是同一条活跃 turn 保证 trajectory / 计数 / 中断键不歧义）。要保持，还是允许并行？
- **harness**：`/btw` 恒跑 pi（`executeAgent`），与 mission harness 无关。用户是否需要知道 / 是否需要可选？
- **权限面**：`SIDE_AGENT_TOOLS` 含 write + bash（`side-agent.ts:9-18`），改的是同一个 workspace。要不要 diff 展示或确认？
- **会话数**：今天只有一条侧边会话（`sideAgentChat` 建一次就保留）。要不要多条？
- **产物落点**：要不要一个像 WORKLOG 那样的专属落点？（注意"永不输入"的边界，参照 `docs/proposals/worker-before-after-primitives.md` 对非证据产物的约束）

---

## 9. 非目标

- **不引入 Claude `AskUserQuestion` 的原生适配** —— §3.2 已用实测排除（它在 print 模式下根本不存在，allow-list 也无法加回）。
- **不做 steering**（§1.3）。
- 不支持在同一 TUI 里并行跑两个 workflow —— 这是 `/btw` 被设计成"侧边 agent，不是第二个 run"的前提。
- 不改动 `signoff` / `discuss` DSL 字段名（只考虑新增）。旧 `signoff: true` 是替换还是双模式并存，需在实施前明确（AGENTS.md 第 8 条：迁移边界要显式）。
- 不重写 steering 通道的契约设计（与本文档范围无关，且其测试完备，值得原样保留）。

---

## 10. 验证方式（每条建议对应的测试层）

| 层级 | 对应建议 | 现有可扩展的测试 |
|---|---|---|
| unit（spec / channel 语义） | 2、3、7 | `tests/cli/headless-signoff.test.ts`、`tests/workflow/discuss-primitive.test.ts` |
| TUI（面板、回显、footer 文案） | 3、4、6、7、8 | `tests/tui/signoff-panel.test.ts`、`tests/tui/prompt-queue.test.ts`、`tests/cli/run-stats.test.ts` |
| workflow（引擎闸门、轮次上限、prompt 组装） | 1、2、13、14 | `tests/workflow/workflow-execution.test.ts`、`tests/workflow/esc-pauses-run.test.ts`、`tests/workflow/next-prompt-continues-run.test.ts`、`tests/workflow/stage-before-after.test.ts`（`feat/stage-before-after-prompts` 分支） |
| harness（MCP server / overlay plugin） | 11、12 | 新测试；dsh 可仿 `tests/harness/dsh-resume-runner.test.ts` 的两层（stub 模块树 + 真实 launcher） |
| 回归门 | 全部 | `npm run typecheck` && `npm run lint` && `npm test` |

---

## 11. 证据索引（file:line，基线 `1c88587`）

| 主题 | 位置 |
|---|---|
| signoff DSL 字段 | `packages/orchestrator/src/workflow.ts:39-41` |
| discuss DSL 字段 | `packages/orchestrator/src/workflow.ts:42-43` |
| signoff / discuss 预检 | `packages/orchestrator/src/workflow-execution.ts:2188`、`:2195-2200` |
| signoff 请求体 | `packages/orchestrator/src/workflow-execution.ts:188-208` |
| `requestSignoff` | `packages/orchestrator/src/workflow-execution.ts:2480-2538` |
| signoff reject → 无上限重试 | `packages/orchestrator/src/workflow-execution.ts:2780-2785`、`:2827-2832` |
| validation repair 上限 | `packages/orchestrator/src/workflow-execution.ts:325`、`:2877` |
| signoff 反馈进 prompt | `packages/orchestrator/src/workflow-execution.ts:612-619` |
| discuss 回调注入 | `packages/orchestrator/src/workflow-execution.ts:2640-2654` |
| stage prompt 组装 | `packages/orchestrator/src/workflow-execution.ts:556-621` |
| signoff 面板 spec / 取消 / 回显文案 | `packages/cli/src/signoff.ts:14-45, 49-55, 59-66, 106-113, 115-` |
| discuss spec / 取消 / headless 替身 | `packages/cli/src/discuss.ts:5-14, 16-27, 35-37` |
| steering 契约 | `packages/harness/src/steering.ts:32-52, 57-68` |
| pi steering 绑定 | `packages/harness/src/pi.ts:1348-1354` |
| claude steering 绑定 | `packages/harness/src/subprocess.ts:1920-1926` |
| claude 已是 streaming-input + 可写 stdin 控制通道（§3.2 的前提） | `packages/harness/src/subprocess.ts:1365`、`:1606-1617`、`:1694-1717` |
| claude `--mcp-config` 支持（§3.3 路径） | `claude --help`（本机 v2.1，已核实） |
| dsh `userQuestions` provider seam（§3.3 路径） | `dsh-user-questions/lib/index.js`（`registerProvider`）、`dsh-tool-ask-user/lib/index.js:12,97` |
| dsh overlay plugin 范式（可直接复用） | `packages/harness/src/dsh-resume-runner.mjs` + `tests/harness/dsh-resume-runner.test.ts` |
| discuss 仅 pi | `packages/harness/src/tool-names.ts:11`、`packages/harness/src/pi.ts:787-812, 1306` |
| `AskUserQuestion` 被列为合法工具名（但 print 模式不提供） | `packages/harness/src/tool-names.ts:24` |
| side agent 请求构造 | `packages/cli/src/side-agent.ts:9-18, 25, 49-59` |
| side agent 走 pi | `packages/harness/src/pi.ts:955`（`executeAgent`） |
| 通道接线 | `packages/cli/src/session-run.ts:200-213, 329-370, 484-500, 517-519` |
| TUI 面板 | `packages/cli/src/tui.ts:885-949` |
| signoff / discuss 通道 | `packages/cli/src/tui.ts:936-955` |
| steering / 排队路径 | `packages/cli/src/tui.ts:1013-1063` |
| footer 刷新与用量归零 | `packages/cli/src/tui.ts:1072, 1077-1085`；`:828`（接管） |
| 接管回放范围 | `packages/cli/src/tui.ts:796-834` |
| footer 列与快捷键 | `packages/cli/src/status-panel.ts:78-140` |
| 用量行 | `packages/cli/src/run-stats.ts:1-8, 190-200` |
| trajectory ledger | `packages/cli/src/trajectory.ts:12-23, 127-245` |
| chat 渲染 | `packages/cli/src/chat-render.ts:32-47, 391-414` |
| DAG 状态与耗时 | `packages/cli/src/workflow-graph.ts:128, 348-350, 626-640` |
| 命令清单 | `packages/cli/src/tui-commands.ts:4-12` |
| 被依赖但不可用的 recipe 配置 | `recipes/workflows/coding-team.yml:20-33`（尤其 `:27`） |
| 被依赖但不可用的 eval case | `evals/workloads/coding-team-questions-claude-gpt-5.6-luna-max/case.yaml:10-13` |
| `before`/`after` 已实现（新 signoff 的邻居） | 分支 `feat/stage-before-after-prompts`，`65ad3ed`；其中 `after` 的“不能改结果”语义见 commit message |
| worker 指令提及 discuss（建议移除） | `recipes/coding-architect/agents.md:3`、`recipes/architect/agents.md:44-45` |
