# setup-env OPHAL config-resolution guard — 复现与验证

2026-08-28 发现并修复的 setup-env worker 陷阱，及其三层沉淀。本文档用于事后复现、回归确认、以及向新环境说明"为什么 SKILL.md 里有一句 OPHAL_CONFIG 守卫"。

## 1. 背景：陷阱与修复

- **陷阱**：setup-env stage 的共享 workspace cwd = piano CLI 启动目录（`process.cwd()` 注入 `request.cwd`）。从 piano 仓库根跑时 cwd 是 `$HOME/orch/piano`，不是 `$HOME/topsop`。`ophal` 解析配置的优先级是 **显式 config_path > `OPHAL_CONFIG` 环境变量 > cwd 向上查找 `ophal_config.json`**。从错误 cwd 跑首个 `ophal device --status` 会落到 `~/.ophal`（kerneldevsuite）内置的 xiaomeng.zhao 旧配置：`Test host: root@10.12.115.72` + 该配置 home 路径的权限报错。
- **修复**：`recipes/topsop-setup-env/skills/topsop-setup-env/SKILL.md` 步骤 2 加守卫——所有 ophal 命令必须从 `$HOME/topsop` 运行（或显式 `OPHAL_CONFIG=$HOME/topsop/ophal_config.json`），并写明解析链与错误 test_host 的实测证据。验证点：**首个 ophal device 调用就直接走对**，不靠 agent 临场恢复。

## 2. 三层沉淀

| 层 | 文件 | 证明力 | 成本 |
|---|---|---|---|
| 静态断言 | `tests/workflow/setup-env-skill-guard.test.ts` | SKILL 文本守卫仍在（防删） | ≈0，进默认套件 |
| 行为 e2e（特殊用例） | `tests/workflow/setup-env-config-guard.e2e.test.ts` | agent 实际遵守（首个 ophal 调用带 `cd $HOME/topsop`，device 输出 `wsj@10.12.115.153`，无旧 host） | 真实 API + SSH 设备，**env 门控默认跳过** |
| 复现文档 | 本文 | 手动重跑命令与步骤 | 0 |

静态断言只证明"守卫在"，不能证明"agent 遵守"（rules≠behavior）；行为证明只有 e2e 能给出，但它重，所以做成特殊用例而非默认测试。

## 3. 复现命令

### 3.1 手动重跑 solo workflow（原始证据形态）

```bash
cd $HOME/orch/piano
npm run run -- --workflow recipes/workflows/topsop-setup-env-solo.yml \
  --json -p "$(cat $HOME/orch/mission-topssgl-addaddrmsnorm.txt)"
```

产出 `~/.piano/runs/<run_id>/`。验证步骤：

```bash
# 1) run 完成且 result 校验通过
grep -o '"event":"run.started"[^}]*' <run>/progress.jsonl
# 2) 首个 ophal device bash 命令（transcript 里 toolCall.arguments.command）应带 cd $HOME/topsop
# 3) 该命令的 toolResult（含 [OPHAL device]）应含 Test host: wsj@10.12.115.153
# 4) 任何 ophal toolResult 不得出现 root@10.12.115.72 / xiaomeng
```

复现证据：手动重跑 `20260828T061323-78c9ae` 首个 ophal 调用即 `cd $HOME/topsop && ophal device --status --arch 400` → `Test host: wsj@10.12.115.153`。

### 3.2 e2e 特殊用例（自动化断言，推荐）

```bash
cd $HOME/orch/piano
PIANO_SETUP_ENV_E2E=1 npx vitest run tests/workflow/setup-env-config-guard.e2e.test.ts
```

前置条件：本机有真实 `~/.piano/agent.config.json` + `~/.pi/agent/models.json`、可达 `$HOME/topsop`（含其 `ophal_config.json`）、测试机 `wsj@10.12.115.153` 可 SSH。不设 `PIANO_SETUP_ENV_E2E` 时默认 skip（不进常规 CI）。

验证通过示例（2026-08-28）：

```
✓ tests/workflow/setup-env-config-guard.e2e.test.ts (1 test) 26455ms
```

### 3.3 静态断言（默认套件）

```bash
cd $HOME/orch/piano
npx vitest run tests/workflow/setup-env-skill-guard.test.ts
```

## 4. 行为断言要点（维护时别改坏）

e2e 断言 agent **行为**，有几处易踩的坑：

- toolCall 用 `arguments.command`（不是 `input`）。
- SKILL.md 文本本身含 `root@10.12.115.72`（守卫证据），agent 注入上下文和 read SKILL 的 toolResult 都会有它——所以断言**不能查全 transcript**，要精确到运行 ophal 的 toolResult（含 `[OPHAL device]` 的输出）。
- spawn cwd 必须是 piano 仓库根（tsx 从 cwd 向上找 tsconfig 解析 `@piano/*`），临时目录会 `ERR_MODULE_NOT_FOUND`。workspace cwd = piano 根正是陷阱条件，守卫要求 agent 主动 `cd $HOME/topsop`。
- `it(...)` 需要显式超时（vitest 默认 5s，headless 要 1-2 分钟）。

## 5. 关联

- SKILL 守卫文本：[`recipes/topsop-setup-env/skills/topsop-setup-env/SKILL.md`](../recipes/topsop-setup-env/skills/topsop-setup-env/SKILL.md) 步骤 2
- ophal 配置解析链：`kerneldevsuite/ophal/lib/config.py`（显式 config_path > OPHAL_CONFIG > cwd 向上）
- 相关 memory：`ophal-build-dir-nfs-contract`（NFS/ssh 远程执行链）、`piano-workflow-mechanism-vs-config`（OPHAL_CONFIG 陷阱的另一处记录）
