---
name: topsop-idea
description: 根据 topsop 实测瓶颈和历史证据提出恰好一个可证伪的优化变量。
---

# topsop idea

1. **读完整 handoff**：读取当前 profile（LLC r+w、latency、1D/2D efficiency、VPD、`bandwidth_utilization`）、current-best 状态、上一轮 decision / variable / `variable_type`、可选 `asm_report`，以及 explore 注入的硬件常量和 `external_mechanism_candidates`。
2. **前提失效检查（ISSUE-014）**：上一轮或本 run 内出现 structural 变量（buffer 数、流水线深度、搬运机制、fusion chain）时，列出该结构可能推翻的旧判别，例如“某路径是硬上限”“计算非瓶颈”“读速率饱和”“tier 对齐不可降”，并以最小判别实验或当前 profile 逐项重检。本轮提案是 structural 时，`rechecked_premises` 必须非空，每项填写 premise / invalidated / evidence；同时写 `strategies[].variable_type`。
3. **定位实测瓶颈**：只基于证据在 load balance、DTE 搬运效率、compute pipeline、FP8 online quantization、VC/context、buffer 深度或 codegen（VLIW slot、bank conflict、register pressure、stall）中选择目标，优先级为 load balance > DTE 搬运效率 > compute pipeline > FP8 online quantization。存在 `asm_report` 时先用它归因，不能忽略后继续盲调参数。
4. **恰好一个变量**：只提出一个可测试变量，明确 bottleneck、technique、rationale、predicted speedup、risk level 和可证伪判据。把判据写入 `falsification_criterion`，把是否复现机制本身写入 `mechanism_over_config`，把 structural / config 写入 `variable_type`，不能只埋在自由文本中。
5. **保持变量多样性**：连续多轮只改 macro/config 后，优先选择 pipeline 深度、buffer 数、DTE 搬运 shape 等结构变量，不重复参数扫描。
6. **机制优先于配置（ISSUE-018）**：检查 tuning/progress 记录和 `external_mechanism_candidates`。若历史记录或外部实现证明某机制可达，而当前源码 `present_in_source: false`，本轮优先提案实现该结构本身；只调 config 不能复现机制收益。外部实现只作可达性证据，不读取或复制其 diff。
7. **重新判断天花板**：记录中的 CONVERGED / 硬件天花板只有在归因机制确实存在于当前源码时才有效；机制缺失时旧结论失效。只有当前证据确实指向天花板且对应机制已存在，才能建议下一轮 measure 判 CONVERGED。
8. **纯发现**：mission 指名已知最优 anchor commit 时，只把它当可达性和目标数值参考，不读取其 diff、不复制其实现机制。
9. **硬件常量纪律（ISSUE-015）**：VC / VDMEM / L1 预算只使用 explore 注入的常量及来源；`kMaxDLen` 从目标 kernel 源码推导，不从手册猜，不全盘搜索硬件定义。
10. **返回报告**：返回且只返回 `optimization-proposal`。

所有 bash 命令必须显式使用 `timeout <N>s`。文件定位优先使用原生 `find` / `grep` / `ls`；bash 搜索只能从 workspace 内窄目录开始并限制深度，禁止 `find /`、递归 `$HOME` 或无界搜索。本 worker 不编辑代码、不 profile、不做 KEEP/DISCARD 或最终决策。
