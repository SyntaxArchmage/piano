---
name: topsop-explore
description: 只读建立目标算子事实基线：源码调用链、正式测试入口、当前 kernel 架构（pipeline / L1 VDMEM / SIP 分配）、最近参考算子，产出探索报告供理论估算与优化决策使用。
---

# topsop explore

在 setup-env 之后、理论估算之前执行一次。只读，不改代码、不构建、不采集 profile。

## 探索边界（收敛规则）

只读探索，产出报告所需的最少证据即可，**不要无限下钻**——超时多发生在下钻编译器宏与实现变体 diff 上：

- `architecture` 的 L1/SIP 细节从 kernel 源码与 host dispatch 的 buffer / thread 声明直接推断；**不溯源编译器内置宏**（如 `GCU_VDMEM_SIZE_PER_THREAD` 由 topscc 注入，repo / SDK 头查不到，直接按已知值使用）——硬件常量值（L1 三区容量 / VC 预算 / tier 对齐颗粒）按注入上下文与来源路径引用，**禁止全盘搜索硬件定义**（ISSUE-015）
- 读 `profile_results/` / `state/` / `rounds/` 的 JSON 只提取 baseline 数字与 kernel 名，**不重算、不对比实现变体 diff**（diff 变体 / 深挖 `state/current-best` 是 optimize 的活）
- 进展记录与 `op_dev/rule.md` 有结论就直接引用，不重新验证源码事实
- 找不到的路径用 `find` 从 `lib/op/` 域目录起搜，不递归全仓库

## 步骤

1. **锁定需求**：确认 mission 的目标 shape / dtype 与源码 / 测试一致。读源码 manifest：public API（`include/topsaten/*.h`）→ host OpBase（`lib/op/<域>/<op>/`，如 `lib/op/normalize/sgl_add_add_rms_norm/op_sgl_add_add_rms_norm.cc`）→ device kernel（**编译单元与 host 同目录的 `gcu400/` 子目录**：`*_host_*.tops` 是 device host wrapper、`*_kernel_*.tops` / `*_impl.h` 是 kernel；`lib/cc_kernel/cc_host.h` 有 device host extern 声明），用 file:line 锚点把调用链写入 `call_chain`。`build_target` 取该目录 `CMakeLists.txt` 的 `op_add_library(kernel_<target> ...)` 名；`test_entry` 在 `topsop/test/system/torch/` 或 `topsop/test/unit/` 下按 `<op>_test.cc` / `<op>_perf_test.cc` 定位——mission 不预置这些值。

2. **读进展记录与规则**：读测试脚本头部进展记录（`Current status` / `Semantics` / `Architecture` / `Target cases` / `Attempts` / `Dead ends`）与测试目录下 `op_dev/rule.md`。记录既有结论与已证伪方向，本轮不重复已证伪的尝试。

3. **架构 gate**（宏观架构设计，禁止跳过）：显式写出当前 kernel 架构到 `architecture`，四项必填：
   - `pipeline`：pipeline 阶段数与各阶段职责、DTE trigger / wait 顺序
   - `l1_buffers`：L1 VDMEM buffer 布局——buffer 名 / 大小 / 对齐颗粒 / alias / 生命周期，校验不超 896KB/SIP
   - `sip_allocation`：SIP 分配策略（静态均匀 / cost-model / 动态）与负载均衡方式
   - `variant_selected`：host dispatch 选中的主路径 kernel tier（如 dte_load kN=8/kD=2）与选择依据——kMaxDLen 对齐、VDMEM/thread、fallback 未命中的原因

   架构决定性能天花板，微观优化只能在其下打磨——`ready` 时缺 `architecture` 会被契约拒绝。

4. **参考算子**：在 `cc_kernel/` 下按计算模式（归约 / 逐元素 / GEMM / attention）找最相近参考实现，写入 `reference_ops`。

5. **外部机制候选（ISSUE-018）**：显式探索"同类算子的 DTE 搬移策略"维度——gamma / beta / 权重等 optional 张量的搬运方式、驻留方式、block-shared local DTE、SIP 协作拷贝体系外的机制。官方实现 / 参考算子验证过、但当前源码不含的机制，写入 `external_mechanism_candidates: [{mechanism, source, present_in_source}]`。只当可达性参考，不读官方 diff、不复制机制。

6. **返回报告**：产出 `topsop-explore-report`：
   - `status: "ready"`：携带 `call_chain` + `architecture`（均必填）+ `test_entry` / `build_target` / `reference_ops`
   - `hardware_constants`（ISSUE-015）：携带 L1 三区容量（VDMEM 1.5MB/SIP、SDMEM 128KB、IMEM 128KB）、L2 64MB/DIE、VC 预算、tier 对齐颗粒（QA 512B / DA 256B / VA 128B）+ `sources`（来源路径），后续 stage 直接引用，**禁止全盘搜索硬件定义**（如 `find /` 找 `GCU_VDMEM_SIZE_PER_THREAD` / `TCLE_MAX_VECTOR_LENGTH`——topscc 注入宏，repo / SDK 头查不到）
   - `status: "blocked"`：携带真实 `blocker`；工具不可用时报 `blocked: tools_unavailable_<reason>`

探索范围受限：只检查注入的 workspace 目录（system prompt 中 `Your current workspace is <path>`）与固定位置，禁止 `find /`、递归 `$HOME` 或搜索无关文件系统。

## 探索命令必须显式设置 timeout（ISSUE-013）

SDK 的 bash 工具对命令**没有默认超时**——一条失控的探索命令（如全盘 `find /`）会无限期阻塞整个 run，没有恢复点。实测教训：run `20260829T111032-f0088a` 中 explore 发 `find / -name "topscc_types.h" -path "*tops*"`，stdout 15 分钟零增长，21 分钟后人工 kill 子进程才恢复。**禁止依赖自身判断命令"应该很快返回"**：

- **任何 bash 命令都要用 `timeout <N>s <cmd>` 包裹**（如 `timeout 60s find lib/op -name "*.cc"`、`timeout 30s grep -rn ...`）——选择略大于该命令正常所需的时间上限（目录内搜索 30-60s，单文件读取不需要 timeout 包裹但引用同一纪律）
- 找不到路径时从 `lib/op/` 域目录起搜，禁止把 `find` 作用到仓库根、`/` 或 `$HOME`——`find <workspace>` 全库递归同样可能远超预期耗时，一律用 `timeout` 包裹
- 命令超时后**缩小搜索范围重试**（限定目录 / 加 `-maxdepth` / 用 `grep` 限定文件类型），不重复发同款全盘命令
- 若需要多处定位，分多条小命令串行执行，每条都带 timeout，而不是一条大命令一次扫完
