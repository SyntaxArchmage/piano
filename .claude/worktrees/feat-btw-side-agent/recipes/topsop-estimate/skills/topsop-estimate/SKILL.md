---
name: topsop-estimate
description: "[DEPRECATED COMPATIBILITY] 仅兼容旧 workflow；新流程应分别使用 topsop-theory 或 topsop-profile。"
---

# topsop estimate（deprecated compatibility）

> **兼容边界：** 本 skill 仅服务于仍选择 `topsop-estimate` 的旧 workflow。新 workflow 必须让 theory stage 使用 `topsop-theory`，让 profile stage 使用 `topsop-profile`。兼容期内保留下面两种旧模式及原有报告形状，但不在这里扩展新行为。

两种模式由注入上下文选择：

- **theory 模式**（theory stage）：产出整个 run 的 baseline 与 roofline 理论上限。
- **profile 模式**（loop profile stage）：为单轮 tuning 采集当前 kernel 状态的性能证据。

## 共同采集

`ophal profile --arch 400 --mode kernel --filter <TargetCase>` 取 kernel latency；`--mode metrics` 取 LLC 读写带宽与 1D 利用率；`--mode vpd` 取 VPD 瓶颈标签。保留原始 profile 路径。交叉校验：`(llc_read_bytes + llc_write_bytes) / latency_us * 1e-3 ≈ llc_rw_sum_gbps`（bytes / us = 1e-3 GB/s，单位换算必须一致）。**`llc_read_bytes` / `llc_write_bytes` 必须取整为 int**（tcu 计数器给浮点，如 `209808384.0`，契约要求 int，不取整会被拒绝并 repair 一轮）。

**带宽利用率（LLC 平衡判定式）**：llc_read / llc_write ≤ 3 且 llc_write / llc_read ≤ 3（两者都 > 0）→ 带宽上限 3000 GB/s（双向均衡）；否则 2500 GB/s（单向）。`bandwidth_utilization = llc_rw_sum_gbps / limit`（clamp 到 1）。契约只校验字段结构、类型与取值范围，**不校验该判定式的数值一致性**——按此公式自查是你自己的义务，不允许自行取其他上限。

## 硬件常量引用（ISSUE-015）

分析 VC / VDMEM / L1 预算用注入的硬件常量表（explore `hardware_constants`），直接引用来源路径，**禁止全盘搜索硬件定义**（如 `find /` 找 `GCU_VDMEM_SIZE_PER_THREAD` / `TCLE_MAX_VECTOR_LENGTH`——topscc 注入宏，repo / SDK 头查不到）。已知常量：L1 VDMEM 1.5MB/SIP（`L1_MAX_SIZE = 1572864 - 512`）、SDMEM 128KB/SIP、IMEM 128KB/SIP、L2 64MB/DIE、VC 预算 11/SIP、tier 对齐颗粒 QA 512B / DA 256B / VA 128B。`kMaxDLen` 是 per-operator 常量，从目标算子 kernel 源码推导（如 `kMaxDUnit * kDUnit` / `cc_kernel::AlignDown(...)`），不从手册猜。

## theory 模式

1. **baseline 构建**：先检查注入上下文的 setup-env build 凭证（`so_path` / `so_mtime` / `so_commit`）。so 存在且新鲜（mtime 晚于目标源码最后改动）→ **直接复用，不重建**，保留凭证；缺失或过期 → `ophal build --arch 400 --target <target>`（target 由 explore 推导），构建后记录真实 `so_commit` / `so_mtime`。禁止无条件重编——setup-env 已做过新鲜度判定，重复 build 浪费数分钟且可能因工作区未提交改动产生不一致产物。
2. **正确性**：经 `ophal test` 先跑 target case 再跑完整回归，记录 passed / total 与 diff 证据。
3. **理论上限**：`theory_min_us = (llc_read_bytes + llc_write_bytes) / (limit * 1e3)`（limit 单位 GB/s，除以 1e3 才是微秒）。把 `theory` 字段写进 `topsop-theory-report`：`read_write_balanced` / `bandwidth_limit_gbps` / `theory_min_us` / `bandwidth_utilization`——契约只校验这四项的存在、类型与范围；`limit` 是否按判定式选取、`theory_min_us` / `bandwidth_utilization` 是否由公式算出，须对照实测 profile 自查后再提交。
4. **返回报告**：`status: "ready"`（带 baseline + theory）或 `"blocked"`（带真实 blocker）。

## profile 模式

1. 读注入的迭代上下文（target case、build 凭证、round 状态）。
2. 填 `topsop-profile-report`，只填真实数值，计算 `bandwidth_utilization`。计数器不可用时 `status` 设为 `"timing-only"` 或 `"blocked"` 带 blocker。

## bash 命令必须显式设置 timeout，禁止全盘 find（ISSUE-013）

`ophal build` / `ophal test` / `ophal profile` 等采集命令**必须用 `timeout <N>s` 包裹**（如 `timeout 900s ophal build --arch 400 --target <target>`、`timeout 1200s ophal profile ...`）——pi-sdk 的 bash 工具没有默认超时，失控命令会无限期阻塞整个 run（实测：run `20260901T071737-744d78` implement 的 `find /` 空转 9+ 分钟才被人工 kill；DTE 配置错 / event 死等同样会让命令永久挂起）。文件定位优先用原生 `find` / `grep` / `ls` 工具（glob、cwd 相对、限 1000 条）；bash 里的 `find` 只用于 workspace 之外路径且必须带 `timeout`，从窄范围起搜（`<workspace>/topsop/test/` 或 `<workspace>` 加 `-maxdepth`），**禁止 `find /` 与递归 `$HOME`**（无匹配时 `find / | head` 走完全部文件系统才终止）；找不到按真实 blocker 报 `blocked`，不猜路径、不回退 `find /`。

禁止编造 metric、禁止把 host wall time 当 kernel latency。
