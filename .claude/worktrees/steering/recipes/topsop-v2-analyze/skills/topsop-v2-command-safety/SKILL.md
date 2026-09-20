---
name: topsop-v2-command-safety
description: Topsop V2 的有界命令、路径和重试纪律；防止错误 cwd、无界搜索和无收益重试。
---

# Topsop V2 command safety

1. 所有命令从注入的 topsop workspace 执行；涉及 OPHAL 时先读取该 workspace 的 `ophal_config.json`，不得使用其他 checkout 或用户目录中的配置。
2. 优先使用 handoff 中的精确 source/build/test/evidence 路径。需要发现时，从 workspace 根 CMake、公开 API 或正式测试根开始，限定目录、文件类型、深度和关键词；禁止扫描 `/`、整个 `$HOME`、其他 worktree 或网络 checkout。
3. 可能阻塞的 build/test/profile/asm/device 命令必须由命令级 timeout 包围；timeout 覆盖整个管道或命令组。超时后最多进行一次范围更小的重试。
4. 设备繁忙、网关错误、provider 错误和命令执行器错误不能混为源码失败。单个 actor/tool session 出现 `spawn ... ENOENT`、shell/grep/glob 无法启动时，只做至多两次有界复测；仍失败则返回 `executor_unavailable`。该错误固定为 `failure.kind=internal`、`scope=iteration`、`retryable=true`；在 loop/tournament 内固定 `block_scope=iteration`，不得仅凭当前 session 推断整个 run 或其他 lane 失效。
5. 确定性输入错误、contract 错误、identity mismatch 和 scope violation 不得重复执行同一命令。
6. 禁止通过后台遗留进程绕过 stage 生命周期；长命令要前台运行并保留 exit code、stdout/stderr 和 evidence digest。
