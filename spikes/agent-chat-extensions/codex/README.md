# Codex spike：官方 TUI 主 transcript 扩展与两条替代路径

日期：2026-10-27
宿主：`codex-cli 0.155.0`（npm 全局包 `@openai/codex`，native binary 同版本）
环境：Linux 6.8.0-79-generic x86_64，Node v22.23.2
隔离：所有运行都使用临时 `CODEX_HOME`（下文 `$TMP/codex-home`），没有读写 `~/.codex`。
模型：没有可用凭据，因此用本地 mock Responses API（`mock-model-server.mjs`）跑真实
app-server/TUI 协议。测试的是宿主与协议行为，不是模型质量。

## 结论速览

| 路径 | 结果 | 说明 |
|---|---|---|
| 官方 TUI 主文本扩展 | **FAIL（无此扩展）** | 没有官方入口可以向主 transcript 写 assistant 文本 |
| MCP `notifications/progress` / `notifications/message` | **FAIL** | 12 秒 tool 发出 12 条 progress + 13 条 logging（12 条逐秒 + 1 条启动）；TUI 只显示 tool card，主 transcript 没有文本；`codex exec --json` 同样 0 条 |
| `thread/inject_items` | **仅模型历史** | 0 条 client notification，不出现在 `thread/read`，下一轮模型输入里能看到注入的 assistant item |
| 自定义 `codex app-server` 客户端 | **PASS（但不是官方 TUI）** | 手写 JSON-RPC 客户端把 `item/agentMessage/delta` 渲染为 `assistant>`，同时把心跳子进程 NDJSON 渲染为 `piano>` |
| app-server 代理：只注入 delta | **PARTIAL** | TUI 在 turn 进行中确实把它显示为 assistant 风格文本；`turn/completed` 后整段消失 |
| app-server 代理：注入 delta + 改写 `turn/completed` | **PASS（实验性，不建议发布）** | 把合成 `agentMessage` item 追加进 `turn/completed` 通知的 `turn.items` 后，TUI 在本次会话内保留该文本；服务端历史与模型上下文仍不知道它 |

**可发布性：没有默认路径。** 自定义客户端可以作为“另一个 UI”发布，但不是官方 TUI
的主 transcript 扩展；代理只能作为实验，不能作为默认产品路径。

## 文件

```
spikes/agent-chat-extensions/codex/
├── README.md                  # 本文件
├── heartbeat-child.mjs        # Piano NDJSON 替身：每 500ms 输出一行
├── mcp-progress-server.mjs    # 最小 MCP stdio server：slow_echo + progress/logging
├── mock-model-server.mjs      # 本地 OpenAI Responses API mock（离线跑真实 turn）
├── app-server-client.mjs      # 手写 codex app-server JSON-RPC 客户端
└── app-server-proxy.mjs       # TUI --remote 与真实 app-server 之间的实验代理
```

代理使用仓库已有的 `ws`（root `node_modules`），没有新增依赖。其余脚本是零依赖 MJS。

## 临时环境

```bash
TMP=/home/albert/.claude/jobs/81a6a04a/tmp/agent-chat-extensions/codex
REPO=/home/albert/workspace/piano-dev-branch
mkdir -p "$TMP/codex-home"
```

`$TMP/codex-home/config.toml`（临时文件，绝不指向真实 `~/.codex`）：

```toml
model = "mock-model"
model_provider = "mock"
approval_policy = "never"
sandbox_mode = "read-only"
project_doc_max_bytes = 0
check_for_update_on_startup = false

[analytics]
enabled = false

[model_providers.mock]
name = "Mock"
base_url = "http://127.0.0.1:18080/v1"
wire_api = "responses"
env_key = "MOCK_API_KEY"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
stream_idle_timeout_ms = 120000

[mcp_servers.pianospike]
command = "node"
args = ["/absolute/path/to/spikes/agent-chat-extensions/codex/mcp-progress-server.mjs"]
default_tools_approval_mode = "approve"

[mcp_servers.pianospike.env]
MCP_SPIKE_LOG = "/absolute/path/to/$TMP/mcp-progress.log"
```

MCP server 也可以用 `codex mcp add` 注册（本次就是这么做的），然后手工补
`default_tools_approval_mode = "approve"`，否则 `approval_policy = "never"` 时 tool call 会以
`MCP tool call requires approval, but approval policy is never` 失败：

```bash
CODEX_HOME="$TMP/codex-home" codex mcp add pianospike \
  --env MCP_SPIKE_LOG="$TMP/mcp-progress.log" \
  -- node "$REPO/spikes/agent-chat-extensions/codex/mcp-progress-server.mjs"
CODEX_HOME="$TMP/codex-home" codex mcp list --json
```

启动 mock 模型：

```bash
cd "$REPO"
MOCK_MODEL_PORT=18080 MOCK_MODEL_LOG="$TMP/mock-model-requests.jsonl" \
  node spikes/agent-chat-extensions/codex/mock-model-server.mjs
```

mock 的行为：

- 用户输入里出现 `slow echo` 时，流式返回一个 namespace function call
  `mcp__pianospike.slow_echo`，让 Codex 真正调用 MCP tool；
- 收到 tool output 后返回最终 assistant 文本；
- 其它请求直接返回 assistant 文本，并在输入含 `PIANO-INJECT-MARKER` 时明确回显。

## 实验 1：官方 TUI 负例

### 1a. `codex exec --json`：MCP progress/logging 不进主 transcript

```bash
cd "$REPO"
MOCK_API_KEY=dummy MCP_SPIKE_SECONDS=10 CODEX_HOME="$TMP/codex-home" \
  timeout 90 codex exec --json --skip-git-repo-check \
  "Run the slow echo tool so we can observe progress." < /dev/null \
  > "$TMP/exec-mcp4.jsonl" 2> "$TMP/exec-mcp4.err"
```

MCP server 在 12.1 秒内实际发出了 12 条 `notifications/progress` 和 13 条
`notifications/message`（12 条逐秒 + 1 条启动）（见 `$TMP/mcp-progress.log`）。`exec-mcp4.jsonl` 里：

- `item.started:mcp_tool_call` / `item.completed:mcp_tool_call` 正常出现；
- `PIANO-PROGRESS-LINE` / `PIANO-LOG-LINE` 出现 **0 次**；
- tool 最终只返回一段普通 tool output 文本。

### 1b. 官方 TUI：MCP progress/logging 不渲染

```bash
tmux -L piano-spike -f /dev/null new-session -d -s tui -x 120 -y 40 \
  "env MOCK_API_KEY=dummy MCP_SPIKE_SECONDS=12 CODEX_HOME=$TMP/codex-home \
   TERM=xterm-256color codex -C $REPO"
# 首次进入会问是否信任该目录；按 Enter 接受（只写入临时 CODEX_HOME）
tmux -L piano-spike send-keys -t tui Enter
tmux -L piano-spike send-keys -t tui -l "Run the slow echo tool so we can observe progress."
tmux -L piano-spike send-keys -t tui Enter
# 若 TUI 的 paste-burst 把 Enter 当成换行，再按一次 Enter
tmux -L piano-spike capture-pane -p -t tui > "$TMP/tui-during.txt"
tmux -L piano-spike capture-pane -p -S -200 -t tui > "$TMP/tui-scrollback.txt"
```

实际屏幕（`$TMP/tui-after-enter2.txt`，tool 运行到 2 秒时）：

```
• Calling pianospike.slow_echo({"message":"piano-spike","seconds":12})
• Working (2s • esc to interrupt)
```

tool 完成后（`$TMP/tui-after-tool.txt`）只有：

```
• Called pianospike.slow_echo({"message":"piano-spike","seconds":12})
  └ slow_echo finished after 12.1s. ...
• Mock model: the slow MCP tool finished. No progress text was rendered by the host.
```

捕获的 TUI 屏幕与 scrollback 中 `PIANO-PROGRESS-LINE` / `PIANO-LOG-LINE` 均为 0 次。

补充协议观察：用带 `experimentalApi: true` 的自定义客户端触发同一个 MCP tool，
app-server 流里也没有出现 `item/mcpToolCall/progress`（trace 中 0 条）。也就是说，
0.155.0 下原始 MCP progress 连 app-server 客户端都未必转发；无论丢在 app-server 还是
TUI，主 transcript 都没有文本。

### 1c. `thread/inject_items`：只进模型历史

见实验 2。自定义客户端在 turn 之间调用：

```json
{"method":"thread/inject_items","params":{"threadId":"<id>","items":[
  {"type":"message","role":"assistant","id":"msg_piano_inject_1",
   "content":[{"type":"output_text","text":"PIANO-INJECT-MARKER: ..."}]}
]}}
```

结果：

- `thread/inject_items` 返回 `{}`；
- 注入后 1 秒内 client 收到 **0 条 notification**；
- `thread/read`（`includeTurns: true`）里看不到 `msg_piano_inject_1`；
- 下一轮 turn 的 mock 模型请求里出现了该 assistant item，模型明确回显
  “Mock model sees the injected PIANO-INJECT-MARKER in its input history.”

结论：`thread/inject_items` 是模型历史注入，不是 transcript 注入。

## 实验 2：自定义 app-server 客户端

```bash
cd "$REPO"
MOCK_API_KEY=dummy CODEX_HOME="$TMP/codex-home" \
  SPIKE_TRACE="$TMP/app-server-client-trace.jsonl" \
  timeout 120 node spikes/agent-chat-extensions/codex/app-server-client.mjs
```

行为：

1. `initialize`（`capabilities.experimentalApi = true`）；
2. `thread/start`（`model: mock-model`，`approvalPolicy: never`，`sandbox: read-only`）；
3. `turn/start`；
4. 逐条读取 `item/agentMessage/delta`，以 `assistant>` 前缀流式输出；
5. 同时启动 `heartbeat-child.mjs`，把它的 NDJSON 逐行输出为 `piano> ...`；
6. 调用 `thread/inject_items` 并检查 notification / `thread/read` / 下一轮模型输入。

关键输出（`$TMP/final-client.out`）：

```
[turn 1] ... assistant follows:
assistant> Mock model reply to: ...
piano> PIANO-HEARTBEAT 1/8
...
[inject] notifications emitted for injection: 0 (none)
[inject] injected item id visible in thread/read(includeTurns): false
[inject] marker reached model on turn 2: true
[inject] injected item id visible in thread/read after turn 2: false
```

结论：自定义客户端可以稳定显示 assistant 主流式文本，也可以把外部 NDJSON 渲染在
旁边；但这是**另一个 UI**，不是官方 TUI。`codex app-server` 是官方 client-facing
协议，比代理方案更稳，但需要自己实现完整客户端。

备注：0.155.0 的 `thread/items/list` 返回
`thread/items/list is not supported yet`，所以改用 `thread/read includeTurns`。

## 实验 3：app-server 代理（实验性）

拓扑：

```
codex --remote ws://127.0.0.1:18902  ->  app-server-proxy  ->  codex app-server (ws://127.0.0.1:18901)
```

代理启动真实 app-server，本身监听 18902；它逐帧转发 JSON-RPC，并在收到
`turn/started` 后向 TUI 连接注入 8 条 `item/agentMessage/delta`（每 1 秒一条）：

```bash
cd "$REPO"
MOCK_API_KEY=dummy CODEX_HOME="$TMP/codex-home" \
  PROXY_TRACE="$TMP/proxy-trace3.jsonl" \
  node spikes/agent-chat-extensions/codex/app-server-proxy.mjs

tmux -L piano-spike -f /dev/null new-session -d -s tui -x 120 -y 40 \
  "env CODEX_HOME=$TMP/codex-home TERM=xterm-256color codex --remote ws://127.0.0.1:18902"
tmux -L piano-spike send-keys -t tui -l "Run the slow echo tool so we can observe progress."
tmux -L piano-spike send-keys -t tui Enter
tmux -L piano-spike capture-pane -p -S -200 -t tui > "$TMP/proxy3-tui-after-scrollback.txt"
```

使用 12 秒的 `slow_echo` 作为活动 turn 窗口。结果：

- turn 进行中，TUI 主 transcript 出现：

  ```
  • PIANO-PROXY 1/8: progress injected by app-server proxy
    PIANO-PROXY 2/8: ...
  ```

  与 assistant 消息使用同样的 `•` 行，而不是 tool card 或 progress UI。
- 第一条注入在 `turn/started` 后约 0.93 秒出现（`turn/started` 05:47:34.584Z，
  第一条 inject 05:47:35.510Z）。
- **关键失败模式**：只注入 delta 时，`turn/completed` 一到，TUI 用服务端的
  authoritative turn payload（`itemsView: "summary"`，只有真实 agentMessage）重绘，
  注入文本整段消失。`PROXY_REWRITE_COMPLETED=0` 复现：进行中 3 行可见，完成后
  scrollback 中 0 行。
- **改写后成功**：代理把合成 item 追加到 `turn/completed` 的
  `params.turn.items`，并设 `itemsView: "full"`：

  ```json
  {
    "id": "piano_proxy_<turnId>",
    "type": "agentMessage",
    "text": "PIANO-PROXY 1/8...",
    "phase": null, "memoryCitation": null, "delivery": null, "questions": null
  }
  ```

  这样 TUI 在本次会话内保留该消息，turn 完成后 scrollback 仍能看到 8 行。

### 代理的脆弱性与安全

- **版本耦合**：`turn/completed` item 形状、`itemsView` 语义、`item/agentMessage/delta`
  都是 0.155.0 的协议细节；只在 `codex-cli 0.155.0` 验证。
- **只在 TUI 本地状态可见**：代理只把合成 item 发给 TUI，从未发给真实 app-server。
  因此服务端历史、模型上下文、rollout 里都没有它；重新连接/重新加载/恢复会话不会
  重现。0.155.0 的 `--remote` 主线程还带 `ephemeral: true`（`historyMode: legacy`），
  resume 本身也不可用。
- **不是官方扩展**：代理占住 app-server 角色，等于 MITM；任何协议变更都可能导致
  TUI 不显示、报错或崩溃。
- **安全**：代理能看到全部 JSON-RPC（`account/read`、config、prompt、tool call）。
  本次只绑定 `127.0.0.1`、没有 token/TLS；Codex 对非 loopback WS 有
  capability-token / signed-bearer 选项，代理没有实现。代理可以伪造 assistant 文本，
  TUI 无法区分“模型说的”和“代理注入的”。不能带真实凭据使用，也不能暴露到网络。
- **延迟**：本次注入节奏 1 秒，首行约 turn 开始后 0.93 秒；TUI 在 3 秒截图里已显示
  3 行。没有测更高速率或大量文本。

## 证据路径（全部在临时目录，未入库）

`$TMP=/home/albert/.claude/jobs/81a6a04a/tmp/agent-chat-extensions/codex`

| 文件 | 内容 |
|---|---|
| `$TMP/schema/` | `codex app-server generate-json-schema --experimental` 生成的协议 schema |
| `$TMP/mcp-progress.log` | MCP 原始收发；含 108 条 progress 通知和 117 条 logging 通知（截稿时；多次运行累计） |
| `$TMP/exec-mcp4.jsonl` | `codex exec --json` 调用 slow_echo；0 条 PIANO 文本 |
| `$TMP/tui-after-enter2.txt` | 官方 TUI 在 12s tool 运行到 2s 时的屏幕；只有 tool card |
| `$TMP/tui-after-tool.txt` | 官方 TUI tool 完成后的屏幕；无 progress/log 文本 |
| `$TMP/final-client.out` | 自定义 app-server 客户端最终输出 |
| `$TMP/final-client-trace.jsonl` | 自定义客户端完整 JSON-RPC trace |
| `$TMP/app-server-client-mcp-trace2.jsonl` | 自定义客户端调用 MCP tool；无 `item/mcpToolCall/progress` |
| `$TMP/mock-model-requests*.jsonl` | mock 模型收到的请求；可看到注入 marker 进入模型输入 |
| `$TMP/proxy3.log` / `$TMP/proxy-trace3.jsonl` | 代理（改写模式）日志与协议 trace；含 8 条 inject + 2 条 rewritten |
| `$TMP/proxy3-tui-during.txt` | 代理注入在 TUI 进行中的屏幕 |
| `$TMP/proxy3-tui-after-scrollback.txt` | 改写后 turn 完成仍保留 8 行 PIANO-PROXY |
| `$TMP/proxy4.log` / `$TMP/proxy-trace4.jsonl` | 代理（不改写）trace；8 条 inject，0 条 rewritten |
| `$TMP/proxy4-tui-during.txt` | 不改写时进行中可见 3 行 |
| `$TMP/proxy4-tui-after-scrollback.txt` | 不改写时完成后 0 行（被 TUI 丢弃） |

## 复现代理的两种模式

```bash
# 默认：改写 turn/completed，文本在本次会话内保留
node spikes/agent-chat-extensions/codex/app-server-proxy.mjs

# 负例：只注入 delta，turn 完成后文本消失
PROXY_REWRITE_COMPLETED=0 node spikes/agent-chat-extensions/codex/app-server-proxy.mjs
```

## 限制

- 没有真实 OpenAI 凭据；模型侧使用本地 mock Responses API。它足够驱动真实
  app-server、真实 TUI、真实 MCP tool call，但不能验证真实模型下的流式时序。
- 代理只测了单 TUI 客户端、loopback、`ws://`；没有测 TLS、token、daemon 模式。
- 未验证真实 `piano -p --json` 的累计 `message_update` 是否会被 TUI 截断；本 spike
  的心跳 NDJSON 每行很短。
- 官方 TUI 没有任何受支持的主文本注入入口；本 README 的代理结果不改变这一点。
