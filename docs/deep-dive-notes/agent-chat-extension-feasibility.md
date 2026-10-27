# Coding agent 主 transcript 扩展可行性

日期: 2026-10-27
范围: Claude Code 2.1.311、dsh 0.1.5-rc.2、Codex 0.155.0
结论: **没有跨宿主扩展 API**。Claude 有官方、可 ship 的主 transcript 进度路径；dsh 能实时渲染 custom Chat node，但冷启动回放被 dsh 的封闭事件词表挡住；Codex 官方 TUI 没有主文本扩展，只能做独立客户端或实验性代理。

这里的“主 transcript 行”按用户定义：进入主聊天 transcript 的行就算，不要求是 assistant prose。

## 矩阵

| 宿主 | 官方主 transcript 扩展 | 实时 Piano 进度 | assistant 文本 | 能否现在 ship |
|---|---|---|---|---|
| Claude Code | in-process **mod**: `$.ui.log`、`turn.step`、pane/band/status/toast | **PASS**（`$.ui.log`，首行 0.58s） | `turn.step` prepend 可以，但会污染历史/延迟；interleave 丢 chunk | **可以**：用 `$.ui.log` 做进度行，不用 `turn.step` |
| dsh | 原生插件 + client UI 的 custom Chat node | **PASS**（534ms 首次出现，每秒更新） | 否，custom node 不是 assistant/message | **不可以**：冷启动回放需要 dsh 词表 API |
| Codex | 无官方 TUI 扩展 | 官方 TUI 无 | 否 | **不可以**：只能自定义 app-server 客户端或实验代理 |

## Claude Code

证据与代码: `spikes/agent-chat-extensions/claude/README.md`；原始 PTY/会话捕获在
`/home/albert/.claude/jobs/81a6a04a/tmp/agent-chat-extensions/claude/captures/`。

- `$.ui.log` + 10 秒心跳：PASS。首行 0.58s 出现，child 运行 0.58–10.62s，20 条 tick 全部在 child 结束前可见；模型后续追问时明确回答没有见过这些行。session transcript 里是 `type:"system", subtype:"informational", level:"notice"`，不在 user/assistant message 中。
- `$.ui.log` + 真实 `piano -p --json`：PASS。`run.started` 0.86s、`text:"OK"` 2.85s、`run.completed` 2.87s，进度行在模型 turn 期间实时到达。
- `turn.step` prepend：PASS with caveats。child 必须在 `next(e)` 前读完，会延迟请求；文本渲染为独立 assistant message，后续模型把它当成外部注入，不是自己说的。
- `turn.step` interleave：FAIL。第 3 行实时显示但在写 transcript 时丢失，不能 ship。
- 外部 MCP/channel/hook 都不能写 assistant 主文本。channel 只注入 user-role 行，assistant 回复只到外部 UI；MCP progress 只在 tool card；`sampling` 不支持。

要 ship 的 Claude 插件：
1. `plugin.json` + `hooks/hooks.json` + 导出 `register(on, options)` 的 hooks module；用 `--plugin-dir` 或 marketplace 分发。
2. 由 slash command 或 `prompt.submit` 触发，spawn `piano -p --json --workflow <path> "<prompt>"`，按行读 NDJSON；只消费 `assistantMessageEvent` 的 delta，不转发累计的 `message_update`。
3. 进度用 `$.ui.log`（每条永久一行）或 `$.ui.status`（当前行原地更新）；按 stage 合并/节流，避免 500ms 一条刷屏。
4. 版本绑定：mod API 是 early access，升级后要重新 `claude plugin validate` 和生成 `.d.ts`。

## dsh

证据与代码: `spikes/agent-chat-extensions/dsh/README.md`；原始证据在
`/home/albert/.claude/jobs/81a6a04a/tmp/agent-chat-extensions/dsh/evidence/run3/`
（`observations.json`、`10-node-first-seen.png`、`11-node-progress-*.png`、`12-node-completed.png`、`session.jsonl`、`piano-node.html`）。

- live append：PASS。自定义节点进入主 transcript，`data-chat-flow-kind="piano-spike"`；运行中显示 `Running`，每秒更新 `heartbeat 1/10`…`10/10`，12.96s 变 `Completed`，final text `OK`。
- 模型可见性：工具结果只有 `[{"type":"text","text":"OK"}]`；进度事件是 log-only，不进入模型历史。
- client plugin 自动发现：boot graph 含 `dsh-piano-spike`，浏览器加载 `/plugins/??...dsh-piano-spike/client.js`，无 pageerror。
- 完成后节点被 dsh 的 compact-turn 折叠进 “1 tool call”，展开后仍在；运行中直接可见。这是 dsh 现有行为。
- **主要阻塞**：`piano-spike/*` 是插件自定义事件；live append 可以，但 cold load 报 `unknown event type ... not marked ignorable` 并拒绝整个 session。`Session.append()` 不能设置 envelope 的 `ignorable: true`，`KNOWN_SESSION_EVENT_TYPES` 是封闭集合；shipped `tool-workflow/*` 能工作只是因为被硬编码。spike 用了明确标注 unsupported 的 workaround（内部 `KNOWN_SESSION_EVENT_TYPES.add(...)`），A/B 证明这是回放成功/失败的分界。
- 要真正 ship，需要 dsh 提供 first-party 事件词表注册 API，或 append 级 `ignorable` 选项；否则不能做成正常 package。
- `ConversationNodeDefinition`、`conversation.chat.node`、lazy-CJS bundle 都是 0.1.5-rc.2 内部面，无兼容承诺，需要版本绑定和回归测试。

## Codex

证据与代码: `spikes/agent-chat-extensions/codex/README.md`；原始证据在
`/home/albert/.claude/jobs/81a6a04a/tmp/agent-chat-extensions/codex/`。

- 官方 TUI：FAIL（无此扩展）。MCP `notifications/progress` / `notifications/message` 发出 12+13 条，TUI 只显示 tool card；`codex exec --json` 也没有主文本。`thread/inject_items` 只进模型历史，不出现在 `thread/read`，不渲染。
- 自定义 `codex app-server` 客户端：PASS，但它是另一个 UI。手写 JSON-RPC，把 `item/agentMessage/delta` 渲染为 `assistant>`，同时把心跳 NDJSON 渲染为 `piano>`。
- app-server 代理：实验性 PARTIAL/PASS。只注入 delta 时，turn 进行中 TUI 显示 assistant 文本，`turn/completed` 后整段消失；改写 `turn/completed.turn.items` 追加合成 `agentMessage` 后，本次会话 scrollback 保留 8 行。但合成 item 从未发给真实 app-server，服务端历史/模型上下文/rollout 都没有它；重连/恢复不会重现。代理是 app-server 角色的 MITM，能看到全部 JSON-RPC，本次只绑 loopback、无 token/TLS；TUI 无法区分伪造的 assistant 文本。**不能作为默认路径。**
- 可发布性：官方 TUI 不可注入；自定义客户端可以作为独立 UI 发布；代理只能作为版本锁定、认证/TLS、显式 opt-in 的实验提案。

## Piano NDJSON 的消费注意

- `piano -p --json` 逐行输出；`message_update` 带累计全文 + delta，必须只消费 `delta`，否则长输出会平方增长。
- final text 只取 `run.completed.text`；进度行按 stage 合并/节流；dsh spike 里约 5 次 append/s、240 字符 tail，33 行中丢了 10 行，说明需要节流和 tail 截断。
- `status.json` 是权威状态；`system-log/*.jsonl` 是审计证据。

## 已实现的落地面

| 能力 | 状态 | 证据 |
|---|---|---|
| `piano install-mcp`：Claude / Codex 走各自 `mcp add`，dsh 生成 `~/.piano/dsh/piano-mcp.yml` | 已实现 | 临时 home 里三者都成功登记；重复执行幂等 |
| `piano install-skill`：只在已存在的 agent home 写 `skills/piano/SKILL.md`，不覆盖既有条目 | 已实现 | 临时 `CLAUDE_CONFIG_DIR` / `DSH_HOME` 各写入一份 |
| `piano install-plugin [--native]`：Claude Code 2.1.311+ | 已实现 | 临时 home：`plugin install` + `plugin configure`；真实会话里 6 条 `ui.log` 和 tool 结果 |
| MCP fallback 在真实 Claude Code 2.1.311 上调用 | PASS | `mcp__piano__piano_run` 返回 `Piano …: completed · 1/1 stages` + `OK`，耗时 7.1s，run `20261027T094127-ee1460` |
| MCP fallback 在真实 dsh 0.1.5-rc.2 headless profile 上调用 | PASS | 工具名 `mcp__piano__piano_run`；`tool/result` 文本为 summary + `OK`，run `20261027T095024-8ba13c` |
| MCP fallback 在 Codex 0.155.0 上调用 | 未验证 | `codex mcp add` 已登记且 `enabled`；本机 `codex login status` 未登录，无法发起真实 turn |

## 推荐

1. **Claude 插件已落地**：MCP fallback 是跨宿主默认；Claude Code 2.1.311+ 再由 `install-plugin --native` 提供 native `piano_run` 和实时 transcript 进度。第一版不做 `turn.step`。
2. **dsh 暂缓到 dsh 提供词表 API**：custom Chat node 已证明可行，但 cold replay 阻塞使其不能作为正常 package；保留 spike，向 dsh 提 first-party event vocabulary / `ignorable` 需求。当前 dsh 走 MCP fallback。
3. **Codex 只做 skill/agent 转述**：官方 TUI 无扩展；自定义 app-server 客户端是另一个 UI，代理是实验性，不混进主线。
4. **`/piano` skill + 自动安装已落地**：`install-skill` 与 `install-mcp` 覆盖 Claude、Codex、dsh，`setup.sh` 默认执行且可分别关闭。

## 证据路径

- Claude: `spikes/agent-chat-extensions/claude/README.md`；captures `log-interactive3.*`、`piano-interactive2.*`、`step-interactive3.*`、`step-interleave.*`。
- dsh: `spikes/agent-chat-extensions/dsh/README.md`；`evidence/run3/`、`evidence/15-node-cold-replay.*`、`evidence/16-cold-replay-unpatched.*`。
- Codex: `spikes/agent-chat-extensions/codex/README.md`；`exec-mcp4.jsonl`、`tui-after-*.txt`、`final-client.out`、`proxy*-tui-*.txt`、`proxy-trace*.jsonl`。
- 所有 spike 都使用临时 HOME/config，未改 `~/.claude`、`~/.dsh`、`~/.codex`；Codex/dsh 的模型使用本地 mock，未消耗真实凭据。
