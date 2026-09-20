---
name: topsop-verify
description: "[DEPRECATED COMPATIBILITY] 仅兼容旧 workflow；新流程应分别使用 topsop-verification 或 topsop-summary。"
---

# topsop verify（deprecated compatibility）

> **兼容边界：** 本 skill 仅服务于仍选择 `topsop-verify` 的旧 workflow。新 workflow 必须让 verify stage 使用 `topsop-verification`，让 summary stage 使用 `topsop-summary`。兼容期内保留下面两种旧模式及原有报告形状，但不在这里扩展新行为。

两种模式由注入上下文选择：

- **verify 模式**（loop verify stage）：对已编译候选做正确性验证。
- **summary 模式**（summary stage）：核对最终数值、重跑回归、更新进展记录。

## verify 模式

1. **读注入上下文**：已编译候选、目标 case 名、当前最佳源码路径。
2. **正确性（官方入口）**：经 `ophal test` 跑，禁止本机裸跑——GCU 在远程测试机上，测试机取 `ophal device --status --arch 400` 输出的 `Test host:` 字段。先跑 target case，再全量回归。记录 passed/total 与 diff 证据（gold vs real）。至少覆盖目标 shape 加回归能提供的边界 shape。
3. **修失败**：按 diff 证据做有界、明确的修复；禁止绕过根因、禁止弱化测试。修复后重跑验证。
4. **返回报告**：如实填 `verification-report`——`compile{passed,exit_code}` / `run{passed,exit_code}` / `numeric_check{passed,tolerance,max_error}` 与 `verdict` 必须自洽（契约校验：`exit_code == 0` 时对应 `passed` 必须为 true；compile / run / numeric_check 三项全过 `verdict` 才为 `"pass"`）；否则 `"fail"` 带 `failure_details`。

## summary 模式

1. **读注入上下文**：最终状态、baseline、各轮记录、最后一轮 profile（loop 边界注入）。
2. **核对最终数值**：kernel latency / LLC r+w / 1D eff / `bandwidth_utilization` vs 目标。写明达到 / 未达到；未达到时写原因（例如读路径不随搬运量变化而饱和）与收敛值。
3. **验证最终状态**：最后一轮改了 kernel 就重跑全量回归（sanitizer + 随机压力），否则复用最后一次已验证计数。优化收尾要求全量回归，不只 smoke。
4. **更新进展记录（ISSUE-012）**：测试脚本头部 `Current status` → `stable`（还有更多轮计划则 `optimizing`），追加 `R<n>` 条目带命令 + shape + Avg/Min/Max。按头部进展记录协议每次只追加一条 `R<n>`；若 run 处于 `improved` / `neutral`，这步是契约强制的——`outcome` 为这两个值时 `summary-report` 必须携带 `progress_record`（`file_path` = 实际写到的脚本路径，`current_status` = 写回的头部状态值，`entry` = 新增的 `R<n>` 条目文本），写回不可验证时契约会拒绝。`regressed` / `unmeasured` / `write_only` 轮不强制。
5. **返回报告**：写 `summary-report`（`run_id` + `outcome` + 真实 summary；improved / neutral 带 `progress_record`）。

## 文件搜索优先用原生工具，bash 必须显式 timeout（ISSUE-013）

本 worker 需要定位 test binary / 测试脚本 / report 路径。pi-sdk 的 bash 工具对命令**没有默认超时**——失控命令（如全盘 `find /`）会无限期阻塞整个 run，没有恢复点。实测教训：run `20260831T094849-9f8dea` 中 verify 发 `find .claude/worktrees -name <test>...` 递归遍历 352MB worktree，连续运行 7.5+ 分钟无输出，人工 kill 子进程 run 才恢复（implement 阶段同款事故见 run `20260901T071737-744d78`）。

- **优先用注入路径**：目标 case / test entry / report 路径已由上下文给出，直接用，不要另起搜索。
- **搜索用原生 `find` / `grep` / `ls` 工具**（glob 匹配、cwd 相对、`.gitignore` 感知、结果限 1000 条、输出自动截断）——搜测试目录不要调 `bash find`，原生工具没有 `find /` 全盘逃逸面。`find` 参数：`pattern`（glob）+ 可选 `path`。
- **bash 里的 `find` / `grep -r` 只用于原生工具覆盖不到的路径**（workspace 之外），且必须带 `timeout <N>s`、加 `-maxdepth`、从窄范围起（目标测试目录 `<workspace>/topsop/test/system/torch/<域>/` 或 `<workspace>/topsop/test/unit/<域>/` → `<workspace>/topsop/test/` → `<workspace>` 根加 `-maxdepth`，如 `timeout 60s find <workspace> -maxdepth 4 -name "<test>.cc"`）。**禁止 `find /`、递归 `$HOME`、搜索 worktree / 无关目录、`A; find /` 复合命令**——`find <workspace>/.claude` 等全库递归同样可能远超预期耗时。
- **任何 bash 命令都用 `timeout <N>s` 包裹**（`ophal test` / `ophal profile` / 编译 / grep 同理），timeout 取略大于正常所需时间上限，不依赖"这条命令应该很快返回"的即时判断。
- **超时后缩小范围重试**（限定目录 / 加 `-maxdepth` / 用 `grep` 限定文件类型），不重复发同款全盘命令；仍找不到按真实 blocker 报 `blocked`，不猜路径、不回退 `find /`。

本 worker 不 commit 任何改动：kernel / host / test / 进展记录改动留工作区，由 run 协调层决定提交。不重写历史或数字让 run 看起来更好。
