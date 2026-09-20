# TODO — topsop 调优管线已知问题与待办

条目格式：状态 / 根因 / 当前处理 / 候选修复 / 触发条件。已证伪方向记入对应文档的 Dead ends，不在这里累积。

## 条目 1：workspace cwd 漂移 → ophal 配置解析陷阱（结构性修复，未做）

| 字段 | 值 |
|---|---|
| **状态** | `open` —— 行为层 workaround 在位，结构性修复未做 |
| **优先级** | 中（workaround 已防住 2026-08-28 实测路径，不阻塞 tuning） |
| **根因** | workflow stage 的 workspace cwd = CLI 启动目录 `process.cwd()`（`sharedWorkspaceBinding(request.cwd)`），spawn agent 时 `cwd: workspace.cwd` 硬编码（`packages/orchestrator/src/workflow-execution.ts` spawn 处）。从 piano 仓库根启动时 workspace cwd 是 piano 仓库而非 topsop workspace；`ophal` 解析配置按 **显式 config_path > `OPHAL_CONFIG` > cwd 向上查找**，从错误 cwd 跑首个 `ophal device --status` 会落到 kerneldevsuite 内置 xiaomeng.zhao 旧配置（`Test host: root@10.12.115.72` + 该配置 home 路径的权限错误）。 |
| **当前 workaround** | `recipes/topsop-setup-env/skills/topsop-setup-env/SKILL.md` 步骤 2 文本守卫：所有 ophal 命令必须从注入的 workspace 运行（或显式 `OPHAL_CONFIG=<workspace>/ophal_config.json`）。三层验证在位：静态断言（`tests/workflow/setup-env-skill-guard.test.ts`）+ e2e 行为断言（`tests/workflow/setup-env-config-guard.e2e.test.ts`，env 门控）+ 复现文档（`docs/topsop-setup-env-config-guard.md`）。 |
| **workaround 缺陷** | 依赖 agent 记住并遵守规则（rules≠behavior，靠 e2e 兜底）；守卫只覆盖 setup-env 一个 worker，其余 worker（explore / estimate / optimize / implement / verify）的 ophal 命令同样有 cwd 漂移风险——当前只是没显式暴露。 |
| **候选修复** | ① **per-workflow env 注入**（中段）：workflow yml 支持 `env:` 字段，spawn agent 时注入 `OPHAL_CONFIG=<workspace>/ophal_config.json`。env 优先级 > cwd 向上，所有 ophal 调用自动走对配置，**不依赖 agent 记忆规则**。影响面：spawn env 传递链（`workflow-execution.ts` spawn 参数区，目前不传 env），比 workspace 钉死小。② **workspace 钉死**（root fix）：workflow 加 workspace 字段，spawn cwd 用钉死值。影响面：schema + `workflow-execution.ts`（含路径 must stay inside workspace 校验）+ CLI `createSession`。 |
| **触发条件** | 用户要求加固 / 其他 worker 出现同类 ophal 漂移证据时再做。 |
| **关联** | `docs/topsop-setup-env-config-guard.md`；memory [[ophal-build-dir-nfs-contract]]、[[piano-workflow-mechanism-vs-config]] |

## 条目 2：vitest workspace alias 解析缺口（预先存在）

| 字段 | 值 |
|---|---|
| **状态** | `open`（未修，属于"先不管其他 bug"范围） |
| **根因** | `vitest.config.ts` 没有 `resolve.alias` for `@piano/*`，导致 workflow 相关测试套件加载失败（`Failed to load url @piano/logging`） |
| **当前处理** | 新测试文件只 import vitest + node builtins（纯 fs），避开 alias 解析；e2e 测试同样避开 |
| **触发条件** | 需要让 workflow 测试套件全量可跑时再修 |
| **关联** | `docs/workflow-e2e-testing-strategy.md` |
