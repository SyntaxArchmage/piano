---
name: topsop-implement
description: 把 optimization-proposal 中恰好一个变量落到 kernel / host dispatch 源码并证明编译通过（sanitizer 先行再 normal），如实报告构建凭证。
---

# topsop implement

落地一个 proposal 中的单一变量并证明它编译通过。正确性由独立 verify stage 负责。

1. **读注入输入**：唯一待应用变量、当前最佳源码路径、目标 case 名。
2. **应用单一改动**：只把该变量改到指定 kernel / host dispatch 源码。一次只改一个变量，绝不 bundle。首版架构必须正确，不写 naive 实现"以后再优化"。
3. **编译**：`ophal build --arch 400 --target <target>`。代码改动先编译 sanitizer 变体（`--sanitizer address`），再 normal。保留 `so_commit` / `so_mtime`。`status: "success"` 是唯一成功信号，失败读 stderr 或 log 最后 50 行。
4. **修编译失败**：按编译器输出的实际错误做有界、明确的修复；禁止绕过根因、禁止弱化测试。
5. **返回报告**：如实填 `topsop-implementation-report`——只有构建成功才 `status: "compiled"`（带 `variable` / `diff_summary` / `changed_files` / `compile{passed,target,so_commit,so_mtime,diagnostics_path}`）；否则 `compile_failed` 且 `compile.passed: false`，或 `blocked` 带真实 blocker。`blocked` 时必须分类 `block_scope`：前置条件失效（设备 / 工具链不可用、无法构建）→ `global`，loop 会终止；本假设（变量）不可实现（如违反硬件契约、与已存在路径冲突）→ `iteration`，loop 会吸收本轮继续跑下一变量。不确定一律 `global`。
6. **`changed_files` 必填**：`status: "compiled"` 时必须列出本轮实际新增 / 修改的源码文件（kernel / host / test），全部是相对 workspace 根（topsop 仓库）的相对路径，禁止绝对路径与 `..` 逃逸。协调层按每轮 KEEP 用这份清单做自动 commit（ISSUE-017），漏报会让该轮 winner 无法提交。

## 文件搜索优先用原生工具，bash 必须显式 timeout（ISSUE-013）

本 stage 需要定位 / 读取 kernel 源码。pi-sdk 的 bash 工具对命令**没有默认超时**——一条失控命令（如全盘 `find /`）会无限期阻塞整个 run，没有恢复点。实测教训：run `20260901T071737-744d78` 中 implement 为定位 `matmul_quant_fp8_kernel_l2_general_primo_plus_plus_gcu400.h` 发 `find / -name "..." 2>/dev/null | head`，该文件不存在时 `find / | head` 会走完整棵文件系统才终止，连续运行 9+ 分钟无输出、状态 D（磁盘 IO），人工 kill 子进程 run 才恢复（explore 阶段同款事故见 run `20260829T111032-f0088a`）。

- **优先用注入路径，不重新搜索**：proposal / implementation-inputs 已给出目标源码路径（`current_best.path` 等），直接用。仅当注入路径失效（文件不存在 / 编译报找不到该文件）才搜索定位——漏文件的风险靠这个"路径失效才搜"兜住，不靠全盘扫。
- **搜索用原生 `find` / `grep` / `ls` 工具**（glob 匹配、cwd 相对、`.gitignore` 感知、结果限 1000 条、输出自动截断）——搜仓库内文件不要调 `bash find`，原生工具没有 `find /` 全盘逃逸面。`find` 参数：`pattern`（glob）+ 可选 `path`。
- **bash 里的 `find` / `grep -r` 只用于原生工具覆盖不到的路径**（workspace 之外的 build 输出目录（`ophal_config.json` 的 `$build_dir`）、工具链目录等），且必须带 `timeout <N>s`、加 `-maxdepth`、从窄范围起（如 `timeout 60s find "$build_dir" -maxdepth 3 -name "*.o"`）。**禁止 `find /`、递归 `$HOME`、`A; find /` 复合命令**——无匹配时 `find / | head` 走完全部文件系统才终止，时间不可控。
- **仍找不到时报真实 blocker，不静默降级**：逐级放宽后仍定位不到目标文件，在报告里如实写 `blocked`（`block_scope` 按 §5 分类）并说明缺哪个路径——不要为了"显得找到了"去猜路径改文件，也不要退回 `find /` 全盘扫。
- **任何 bash 命令都用 `timeout <N>s` 包裹**（编译、拷贝、`grep -r` 同理），timeout 取略大于正常所需时间上限，不依赖"这条命令应该很快返回"的即时判断。
- **超时后缩小范围重试**：限定目录 / 加 `-maxdepth` / 用 `grep` 限定文件类型，不重复发同款全盘命令。

本 stage 不 benchmark、不验证正确性、不碰 grader / reference。
