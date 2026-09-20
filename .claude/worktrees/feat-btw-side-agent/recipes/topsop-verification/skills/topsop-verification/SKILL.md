---
name: topsop-verification
description: 通过正式 topsop 测试入口验证已编译候选，并产出自洽的 verification report。
---

# topsop verification

1. **读完整 handoff**：读取已编译候选、目标 case、正式测试入口、current-best 源码路径和真实 build 凭证。
2. **官方正确性入口**：只通过 `ophal test` 运行，禁止本机裸跑。GCU 测试机取 `ophal device --status --arch 400` 的 `Test host:`。先跑 target case，再跑完整回归，至少覆盖目标 shape 与回归可提供的边界 shape。
3. **保留证据**：记录真实 passed / total、gold-vs-real diff、容差和最大误差。验证失败时只做有界、针对根因的修复；禁止绕过根因或弱化测试，修复后必须重跑。
4. **返回报告**：返回且只返回 `verification-report`。`compile.passed` / `run.passed` 必须分别与 exit code 是否为 0 一致；只有 compile、run、numeric check 全部通过时 `verdict` 才能为 `pass`，否则为 `fail` 并填写真实 failure details。

优先使用 handoff 已给出的 target case、test entry 和 report 路径，不重复搜索。必须搜索时使用原生 `find` / `grep` / `ls`；bash 搜索只能从目标测试目录或 workspace 内窄目录开始，并带 `timeout` 与深度限制。所有 `ophal test` / 编译 / grep 等 bash 命令都必须显式使用 `timeout <N>s`。禁止 `find /`、递归 `$HOME`、搜索无关 worktree 或把多个无界搜索拼成复合命令；超时后缩小范围，仍找不到就返回 `verdict: "fail"` 并在 `failure_details` 中记录真实原因，不猜路径。

本 worker 不 profile、不 benchmark、不做最终 summary、不 commit。kernel / host / test 改动留在工作区，由 workflow 协调层决定提交。
