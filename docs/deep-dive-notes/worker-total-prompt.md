# Worker 总 prompt 的构成

一个 worker（= 一个 stage 执行）发给内层 coding agent 的总 prompt 由**两个平面**拼成：

1. **系统平面（appendix）**——由 recipe 资源文件组成，经 harness adapter 注入到内层 agent 的系统提示区；
2. **用户平面（task）**——由 orchestrator 代码模板 `stagePrompt()` 拼装，原始用户 prompt 嵌在其中。

数据流总图：

```
 recipes/<worker>/ 目录                代码模板                     运行时产物
┌────────────────────────┐   ┌─────────────────────────┐   ┌──────────────────────┐
│ system-prompt.md (可选) │   │ stagePrompt()            │   │ contract snapshot    │
│ agents.md               │   │  workflow-execution.ts   │   │  (validate:true 时)   │
│ agents.<harness>.md     │   │   :454-517               │   │ handoff-context.json │
│ skills/<n>/SKILL.md     │   │ 原始用户 prompt           │   │  (上游 producer 证据) │
│ contract.json           │   │  (TUI / --prompt 透传)    │   │ map-item.json        │
└───────────┬────────────┘   └───────────┬─────────────┘   └──────────┬─────────┘
            │ resolveWorkerResources     │                            │
            │ workflow-file.ts:242-320   │                            │
            ▼                            ▼                            ▼
   ┌──────────────────────┐    ┌──────────────────────────┐  并入 contextFilePaths
   │ 系统平面 appendix     │    │ 用户平面 = task 消息      │  workflow-execution.ts
   │ = system-prompt.md   │    │ (见下面的结构图)          │      :1709-1714
   │ + "# <path>"+agents  │    └────────────┬─────────────┘
   │ + "# <path>"+skills   │                │
   └───────────┬──────────┘                │
               │        executeWorker (workers/src/worker.ts:64-126, 纯透传)
               ▼                           ▼
      ┌─────────────────────────────────────────────┐
      │        Harness adapter 路由 (按 stage.harness)│
      ├─────────────────────────────────────────────┤
      │ claude 子进程   subprocess.ts:893-914        │
      │   --append-system-prompt <appendix(含skills)>│
      │   -- <用户平面task>                           │
      │ pi-cli 子进程   subprocess.ts:858-883        │
      │   --append-system-prompt <system+agents>     │
      │   --skill <dir>(每个skill一个flag)            │
      │   <task作为最后一个位置参数>                   │
      │ dsh 子进程      subprocess.ts:926-939        │
      │   (没有 append flag → 全部内联成一个串)         │
      │   <appendix>\n\n## Task\n<task>              │
      │ pi 内嵌SDK      pi.ts:966-985                │
      │   system-prompt.md → 系统提示本体             │
      │   skills → <workflow_skill path=...>块追加    │
      │   agents(context files) → agentsFilesOverride │
      │   task → 用户消息                             │
      └─────────────────────────────────────────────┘
                        ▼
              内层 coding agent 的"总 prompt"
```

## 用户平面 `stagePrompt()` 的确切结构

`workflow-execution.ts:454-517`，`lines.join("\n")`，顺序固定：

```
## User task (whole workflow)          ← 原始用户 prompt 原样嵌入 (:450-452)
<raw prompt>

## Workflow stage context              ← 固定护栏文案 (:468-477)
 · "用户任务是整个workflow的完整任务，本stage只能推进它，不得替换/扩大/重新解释"
 · "仓库指令文件只约束执行方式，不替代任务"
 · You are executing workflow stage `<stageId>` (<runtimeInvocationId>)
 · Your current workspace is `<workspace.cwd>`   ← 唯一注入的环境信息
 · "该目录是唯一可写任务空间，不得改 Piano 源码树"
 · The orchestrator injected the following context files; read them:
     - recipes/<worker>/agents.md
     - recipes/<worker>/agents.<harness>.md      (若存在)
     - <runDir>/contracts/<digest>.json          (contract snapshot, validate:true)
     - <invocation>/handoff-context/<name>.json  (上游 handoff / winner 证据)
     - <invocation>/.../map-item.json            (map over 的当前迭代项)

## Reviewer guidance                  ← 仅当上游 stage 被 continue 且留了 note (:629-638)
 · 人类审阅者放行上游 stage 时写的话，只递给**直接消费该 stage 的那些 stage**
 · 逐条格式：`- after \`<stageId>\`: <note>`；无 note 时整段不出现
## Agent configuration                 ← 仅当设了 model/thinkingLevel (:642-648)
## Required validation result          ← 仅 validate stage (:649-660)
 · contract id、resultPath、workerContractGuidance() 生成的 JSON 形状示例
## Validation repair required          ← 仅结果被拒重跑 (:661-669)
## Sign-off retry                      ← 仅人工要求重跑该 worker (:670-681)
 · note 存在时给 `Reviewer note: …`；未写 note 时给“未给细节，请重新审视”的说明
```

## 系统平面 appendix 的拼法

`resourceAppendix()`（`subprocess.ts:885-891`）：`[system-prompt.md, ...contextFiles, ...skills]`，每个文件冠以 `# <绝对路径>` 头，`\n\n` 连接。注意两点：

- 这些 context 文件**同时**出现在两处：内联进 appendix（对 claude/dsh/pi-cli），又在用户平面的 "read them before acting" 列表里点名——即模型既直接看到内容，也被指示去读文件。
- `agents.md` 永远在前、`agents.<harness>.md` 紧随其后，per-harness 规则是**扩展**而非替换（`workflow-file.ts:286-293` 的注释）。

## 值得注意的边界

- **节点级 prompt 文本只有两个来源**：`stage.prologue` / `stage.epilogue`（见下），以及 recipe 目录的 system-prompt/agents/skills/contract。除此之外 yaml 只声明 worker/harness/tools/from/validate/map 等结构性字段。
- **`prologue` 与 `epilogue` 是一对「非证据」原语**：`prologue` 追加在首轮 `stagePrompt()` 末尾（`## Prologue`），`epilogue` 则在 stage **accept 之后**作为一次续跑 turn 发出（prompt 就是 `epilogue` 原文，不是 stagePrompt）。两者都是纯提示词，从不被解析或校验，也不进入 result/handoff —— 这正是它们能承载随意散文（worklog、收尾）而不污染严谨证据链的原因。`epilogue` 的失败不影响已验收的 stage。
- **续跑不重发历史**：同一 actor 的后续 turn 通过 `--resume <sessionId>` / `--session <transcriptPath>` 恢复内层 harness 自己的会话（`subprocess.ts:902, 870`），上一轮内容不重新拼进 prompt。`epilogue` 依靠的就是这一点 —— 它看得见自己刚才做了什么。
- **"上一轮 winner 摘要"** 不是一个文本段，而是 `writeHandoffContext` 写出的不可变 JSON（含 producer 的 accepted text、resultPayload、contract projections 等，`handoff.ts:116-140`），走上面 contextFilePaths 通道进入 prompt；tournament 后还有一个单独的一次性 consolidation prompt（`workflow-execution.ts:1297-1310`）指示 winner 把自己 workspace 的改动应用到父目录。
- **CLI 侧的帧边界**：`packages/cli/src/session-resume.ts:92-95` 用 `"\n\n## Workflow stage context"` 这个 marker 把编排注入的脚手架从用户原文中剥掉，供历史展示/回放。

一句话总结：**总 prompt = 用户原始任务（被 stagePrompt 包上 stage/contract/handoff 护栏 + 可能的人类审阅指引）+ recipe 目录里的 system-prompt/agents/skills/contract 快照经 `# <path>` 内联成的系统附录**，路由方式随 harness（claude/pi-cli/dsh/pi-SDK）而异但内容集合一致。

## signoff 的两个决定如何进入 prompt

闸门有两条出路，各自的文本去向不同（`workflow-execution.ts`）：

| 决定 | 对 stage 结果的影响 | 用户输入去哪里 |
| --- | --- | --- |
| `continue` | 发布本次 attempt（写 handoff、progress） | 存在 `InternalStageResult.reviewNote` 上，只进入**直接消费者**的 `## Reviewer guidance` |
| `retry` | `attempt += 1; continue`，重开同一 actor session | 进入该 stage **下一次 attempt** 的 `## Sign-off retry` |

两个边界是刻意的：

- **note 不进 handoff 记录**。handoff 是 worker 的不可变证据，而 prompt 自己就写着 “Handoff files are immutable upstream evidence”；把人类的口头指示混进证据链会污染下游的判断。
- **note 只走一条边**。消费者判定与投递判定都取自编译后的 `dependsOn`（而非 stage 自己的 `from:`，因为 compile 会把 region 的 `from:` 折进其 entry leaf）。同一张表既生成对话框里“note goes to: …”的提示，也决定谁真的读到它，两者不可能不一致。
