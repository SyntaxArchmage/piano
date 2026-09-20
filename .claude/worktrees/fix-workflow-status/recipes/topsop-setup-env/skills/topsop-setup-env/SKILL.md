---
name: topsop-setup-env
description: 把 terse mission 解析为四个路由问题（任务类型 / 目标对象 / 成功标准 / 所需证据），确认运行环境（工作目录 / 架构 / 远程测试机），记录 baseline 构建凭证，作为 tuning 会话的公共前提。
---

# topsop setup-env

每个 tuning 会话的入口 stage，在探索与优化之前执行一次。只做四问解析、环境确认与构建凭证记录；不探索源码、不修改代码、不采集 profile。

## 步骤

1. **四问路由**：读取用户下发的 terse mission（objective + target + anchor，不含预补充上下文）。动手前先把 mission 拆成四个问题并显式写出来：
   - 任务类型：本流程固定为 baseline + optimize
   - 目标对象：算子名、shape、dtype
   - 成功标准：由 mission 给出（例如 LLC 读写带宽 ≥ X 或 1D 利用率 ≥ Y）
   - 所需证据：构建、固定 case、device 侧指标
   
   mission 不预置 build target / profile filter / test entry——这些由后续 explore stage 从源码推导，本 stage 不得假设或补全。

2. **环境确认**：确认工作目录为注入的 workspace 路径（system prompt 中 `Your current workspace is <path>`）、目标架构（`--arch 400`）、测试机。**所有 ophal 命令必须从注入的 workspace 目录运行**（如 `cd <workspace> && ophal ...`，或显式 `OPHAL_CONFIG=<workspace>/ophal_config.json`）——ophal 解析配置优先级是 显式 config_path > OPHAL_CONFIG > cwd 向上查找；从其他目录（如 piano 仓库根）跑会落到 `~/.ophal`（kerneldevsuite）内置的 xiaomeng.zhao 旧配置，`Test host:` 错成 `root@10.12.115.72` 并因该配置自带的 home 路径权限报错（2026-08-27 solo run 实测）。worktree / 隔离副本场景下 workspace 不是主仓库 checkout，必须用注入路径，否则读错配置、污染主仓库。测试机取正确配置下 `ophal device --status --arch 400` 输出的 `Test host:` 字段（如 `wsj@10.12.115.153`），写入 `device.test_host`。GCU 在远程测试机上，禁止在本机或 build 容器里构建 / 跑测试。

3. **构建凭证**：从**注入 workspace 的** `ophal_config.json` 的 `build_dir` 字段确认真实 build 目录（读 `<workspace>/ophal_config.json`，不要读主仓库 checkout 的 `ophal_config.json`——worktree / 隔离副本的 build_dir 指向独立目录，如专用 build export 下的 `<name>` 目录），检查 `$build_dir/lib/libkernel_<op>.so`（绝对路径）的存在性与新鲜度：
   - 存在且新鲜 → 记录 `so_path`（绝对路径）/ `so_mtime` / `so_commit`（`so_commit` 取 topsop 仓库当前 HEAD），不重新构建
   - 缺失或过期 → 本 stage 不构建（build target 要等 explore 推导后才可知），报告**省略 `build` 字段**（build 字段可选，无凭证时不携带），由首个需要构建的阶段执行 `ophal build --arch 400 --target <target>`
   
   `status: "success"` 是构建成功的唯一成功信号，失败读 stderr 或 log 最后 50 行。禁止编造凭证——`so_mtime` / `so_commit` 必须是真实检查到的值。

4. **返回报告**：产出 `topsop-env-report`：
   - `status: "ready"`：携带 `target`（operator / shape / dtype）、`device`、`toolchain`、`build`（so_path + 真实凭证）、`state_path`
   - `status: "blocked"`：携带真实 `blocker`；工具不可用时报 `blocked: tools_unavailable_<reason>`

## bash 命令必须显式设置 timeout，禁止全盘 find（ISSUE-013）

`ophal device --status` / 配置与 build 产物检查等命令**必须用 `timeout <N>s` 包裹**（如 `timeout 60s ophal device --status --arch 400`）——pi-sdk 的 bash 工具没有默认超时，失控命令会无限期阻塞整个 run（实测：run `20260901T071737-744d78` implement 的 `find /` 空转 9+ 分钟才被人工 kill）。检查配置 / `.so` 只读注入 workspace 下的已知路径；需要定位时优先用原生 `find` / `grep` / `ls` 工具（glob、cwd 相对、限 1000 条），bash 里的 `find` 只用于 workspace 之外路径且必须带 `timeout`，从 `<workspace>` 窄范围起搜（加 `-maxdepth`），**禁止 `find /` 与递归 `$HOME`**；找不到按真实 blocker 报 `blocked`，不猜路径。

本 stage 只准备环境与凭证，不开始探索或优化。
