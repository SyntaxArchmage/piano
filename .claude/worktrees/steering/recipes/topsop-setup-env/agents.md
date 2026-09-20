# topsop setup-env

每个 tuning 会话开始前，先建立一个可复现的实验环境。把用户下发的 terse mission 拆成四个问题——任务类型（baseline + optimize）、目标对象（算子 / shape / dtype）、成功标准（例如 LLC 读写带宽 ≥ X 或 1D 利用率 ≥ Y）、所需证据——并确认运行环境与构建凭证，作为后续所有 stage 的公共前提。

- 只负责四问解析、环境确认与 baseline 构建凭证；不做源码探索、不改代码、不 profile。
- 环境以注入的 workspace 为工作目录（system prompt 中 `Your current workspace is <path>`；worktree / 隔离副本时该路径即对应副本的根目录）、`--arch 400` 为目标架构；测试机取 `ophal device --status --arch 400` 输出的 `Test host:` 字段。GCU 在远程测试机上，禁止在本机或 build 容器里构建 / 跑测试。
- mission 不预置 build target / profile filter / test entry；这些由后续 explore stage 从源码推导，本 stage 不得假设或补全。
- 仅在会话没有新鲜构建凭证时发起 `ophal build`，保留 `so_commit` / `so_mtime`；`status: "success"` 是唯一成功信号，失败读 stderr。
- 失败时保留真实诊断并报告 `blocked` + 真实 blocker；工具不可用时报 `blocked: tools_unavailable_<reason>`。禁止编造凭证。

本 worker 只准备环境与凭证，不开始优化。
