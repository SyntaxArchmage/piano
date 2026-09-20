# Topsop Tuning V2：Implement 长耗时与构建生命周期问题记录

- 日期：2026-09-16
- 状态：已确认问题，冻结实施；等待当前 session 结束
- 证据 session：`/home/wsj/.piano/runs/20260916T025230-e91d7b`
- 观察截止时间：2026-09-16 14:20 CST
- 当前 session 状态：`running`，位于 `tune.implement@tune/iter-2`
- 实现 commit：待 session 结束后补充

## 1. 记录目的

当前 Topsop V2 session 的前两个 implement invocation 累计耗时约两小时。该现象不是单一的模型推理慢，也不是 device gate 阻塞，而是以下因素叠加：

1. 长时间构建命令与 DSH tool wait 上限之间缺少稳定的生命周期协议；
2. 前台命令返回后，底层 `ophal/mule/ninja` 仍可能继续运行并持有 lock；
3. worker 通过 `pgrep`、重复 build 和手工 lock 处理推断外部状态，产生误判和额外等待；
4. 修改公共模板 header 使一个 workload candidate 触发数百个 variant 全量重编译；
5. implement 阶段承担了本应由 analyze 提供的源码定位、实例化方案推导和 build-impact 分析。

本文冻结问题证据、根因和拟议方案。按照运行安全边界，在 session `20260916T025230-e91d7b` 结束前，不修改 Piano framework、V2 worker、contract、workflow 或 DSH runtime patch。

## 2. 运行现场

观察截止时 `progress.json`：

```json
{
  "status": "running",
  "plannedStages": 23,
  "completedStages": 11,
  "acceptedStages": 11,
  "remainingStages": 12,
  "current": {
    "invocationId": "tune.implement@tune/iter-2",
    "stageId": "tune.implement",
    "iteration": 2,
    "status": "running"
  }
}
```

运行进程由以下命令启动：

```text
npm run run --workflow recipes/workflows/topsop-tuning-v2.yml
```

当前 session 的固定预算是 5 轮；工作区中存在用户未提交配置：

```diff
- iterations: 30
+ iterations: 5
```

该修改属于当前实验配置，后续修复不得覆盖或误提交。

## 3. 时间证据

`trajectories/duration.jsonl` 给出的 accepted duration：

| Invocation | 开始/结束区间 | Duration |
|---|---|---:|
| `tune.implement@tune/iter-0` | 11:30:10 → 12:42:50 CST | 4,359,979 ms = 72.67 min |
| `tune.implement@tune/iter-1` | 12:51:56 → 13:39:28 CST | 2,852,838 ms = 47.55 min |
| 合计 | | 120.21 min |

因此，“implement 接近两小时”是前两轮累计值，而不是一个 invocation 持续两小时。尽管如此，两轮都明显超过应有的代码编辑与单候选构建成本。

主要时间和行为证据位于：

```text
/home/wsj/.piano/runs/20260916T025230-e91d7b/trajectories/duration.jsonl
/home/wsj/.piano/runs/20260916T025230-e91d7b/trajectories/tool-calls.jsonl
/home/wsj/.piano/runs/20260916T025230-e91d7b/actors/dsh/tune.implement/root/session/dsh-fa90343a-9d7d-4566-bfb5-7b68da9ba25b.jsonl
/home/wsj/.piano/runs/20260916T025230-e91d7b/prompts/1/invocations/tune.implement/
```

## 4. Iteration 0：异常构建生命周期

### 4.1 Candidate

```text
iter0-dual-buffer-kgroup-rescale
```

该 candidate 修改公共 MatMul kernel header，尝试对 K-group partial result 做双 buffer 和 issue 重排。

### 4.2 观察到的过程

1. 约 16 分钟用于状态校验、源码阅读、Primo 类型搜索和已有 multi-accumulator 模式搜索；
2. worker 前台执行：

   ```text
   timeout 1800 ophal build --arch 400 \
     --target topsaten_linear_quant_topsexts_perf_test
   ```

3. DSH tool 在约 10 分钟后返回，但 `timeout/ophal/mule/ninja` 子进程仍继续运行；
4. worker 将 tool 返回解释为 build 被中断，随后又启动 background build 和 watcher；
5. 原始 build 继续持有 `.mule.lock`，worker 多次查询进程和进度；
6. 自定义等待循环使用 `pgrep`，其匹配表达式命中了等待循环自身，导致空转；
7. 原始 build 在日志 `460/523` 附近被判断为 stall，worker等待、诊断并最终终止相关进程；
8. 清理 lock 后重新构建，Ninja 返回 `no work to do`，说明主要编译工作实际上已经完成；
9. worker 再生成 digest、evidence 和 result。

Transcript 中的关键自述包括：

```text
The 10-minute tool cap interrupted the build mid-way...
The first (tool-killed) build is actually still running in the background.
My wait loop self-matched its own command line and is spinning.
Mule appears stalled near 460/523...
ninja: no work to do.
```

### 4.3 工具使用特征

Iteration 0 共记录：

- 174 个 tool calls；
- 113 个 bash calls；
- 10 个 `job_output`；
- 4 个 `job_kill`。

主要耗时不在普通命令执行本身，而在模型回合、长等待、后台进程状态不明确、重复诊断和构建生命周期恢复。

### 4.4 最终业务结果

后续 evaluate 将该 candidate 判为 correctness rejection：

```text
status: rejected
reason: candidate artifact produces no kernel output
```

Candidate 运行时读回的是预填充但未被 kernel 写入的输出；baseline artifact 的 A/B 测试证明 baseline 会正确写入。因此 iteration 0 的长 implement 最终没有产生可进入性能比较的候选。

这不是长耗时的直接根因，但说明 implement 在投入大规模构建前缺少更便宜的结构/编译/最小 correctness 风险检查。

## 5. Iteration 1：真实的模板全量重编译

### 5.1 Candidate

```text
iter1-deepen-abel-pipeline-stage3
```

修改范围：

```text
topsop/lib/kernel/cc_kernel/gemm/
  matmul_quant_fp8_kernel_l2_general_primo_plus_plus_gcu400/
  matmul_quant_fp8_kernel_l2_general_primo_plus_plus_gcu400.h

topsop/lib/kernel/cc_kernel/gemm/
  matmul_quant_fp8_kernel_host_primo_gcu400.tops
```

### 5.2 时间拆分

大致时间为：

| 工作 | 耗时 |
|---|---:|
| 校验、实例化路径分析、编辑 | 约 15.7 min |
| 524-step build | 约 25.8 min |
| symbol wiring、digest、evidence/result | 约 6 min |
| 总计 | 47.55 min |

### 5.3 Build fan-out

构建日志显示：

```text
[1/524] ...
...
[524/524] Linking CXX executable topsaten_linear_quant_topsexts_perf_test
```

修改公共模板 header 后，构建系统重新编译了大量与目标 workload 不同的实例：

- e4m3/e4m3 与 e5m2/e5m2；
- half 与 bfloat16；
- 多种 thread shape；
- split/bias/L1 组合；
- 多个 kernel shared library；
- 最终测试 executable。

因此，虽然 mission 只要求一个 M/N/K 和 scaling-mode case，一个 candidate 仍触发整个 MatMul FP8 variant family 的重新实例化。

### 5.4 等待行为

Iteration 1 中两个 `job_output(wait=true, timeout_ms=600000)` 分别阻塞约十分钟，合计约二十分钟。这次等待对应真实编译进度，不是纯空转；但它说明 worker 仍依赖人工分段等待，而没有稳定的 build handle 和 completion event。

## 6. 根因分类

### 6.1 Piano/DSH runtime 问题

前台 bash/tool 到达等待上限后，父工具返回，但长命令的整个进程组未必被可靠终止，也没有转换为可继续观察的统一 managed job。调用方无法仅根据 tool 返回判断：

- 命令已完成；
- 命令被终止；
- 命令仍在后台运行；
- 哪个 PID/进程组拥有 lock；
- 最终 exit code 将写到哪里。

该边界不清晰导致 worker 产生重复 build 和 lock 竞争。

### 6.2 Worker 执行协议问题

`topsop-v2-implement` 只要求“构建并保存 build log”，没有规定长构建的唯一执行协议。模型因此自行组合：

- foreground `timeout`；
- DSH background job；
- `job_output` 分段等待；
- `pgrep`/`ps` 轮询；
- `.mule.lock` 删除；
- watchdog shell loop。

这些方案跨轮不稳定，也容易出现 self-match、orphan process 和重复构建。

### 6.3 Build granularity 问题

公共模板 header 是高 fan-out 编译边界。当前 per-operator build target 实际上仍依赖数百个 variant，缺少：

- exact specialization compile target；
- 单 variant smoke compile；
- workload-local specialization TU；
- candidate build fan-out 预算。

这是 Topsop/build graph 层面的成本，不能仅靠 Piano scheduler 消除。

### 6.4 Stage 责任问题

Implement 重新完成了大量应在 analyze 固化的工作：

- template tuple 定位；
- host/device instantiation 路径推导；
- toolchain 类型定义搜索；
- dispatch gate 推导；
- 预期 rebuild 范围判断。

Analyze handoff 虽然给出了 mechanism 和 edit scope，但还不足以让 implement 按精确 recipe 直接落地。

## 7. 拟议改动方案

所有改动均在当前 session 结束后实施。

### P0-A：通用长命令生命周期语义

目标：工具调用结束后，不能留下状态不明的长命令。

需要评估并选择一种通用实现：

1. foreground tool timeout 时终止整个 process group，并明确返回 `timed_out`；或
2. 超过同步等待窗口时，把进程提升为带稳定 id 的 managed job，返回 PID/process-group/log/exit-sentinel；或
3. 为 harness 提供一个统一的 long-running command API，调用方不再手写 shell watchdog。

无论选择哪种，必须满足：

- 同一 build 只有一个 owner；
- completion 有唯一 exit code；
- timeout 不产生 orphan；
- cancellation 终止整个进程组；
- resume 后仍能查询状态；
- log 和 exit sentinel 可审计。

候选代码范围预计位于：

```text
packages/harness/
packages/orchestrator/
```

实际归属需在 session 结束后先检查 DSH job API 和 Piano harness adapter。

### P0-B：Implement worker 的唯一 build protocol

为 `topsop-v2-implement` 增加明确规则：

1. build 只能启动一次；
2. 预期超过同步窗口时，从一开始使用 managed background job；
3. 保存 job id、owner PID/process group、log path、start time 和 exit sentinel；
4. 禁止用宽泛 `pgrep` 判断完成；
5. 禁止在 owner 存活时删除 `.mule.lock`；
6. stall 必须基于日志 mtime/progress 与 owner liveness 的组合证据；
7. 重试前必须证明前一进程组已退出；
8. stage 结束前证明没有遗留 build 子进程和 lock；
9. 不允许在同一 build.log 上混写多个 build，必须保留 attempt 分段证据。

### P0-C：长构建回归测试

增加真实或可控 fake testcase，覆盖：

1. 前台命令超过 tool wait window；
2. timeout 后无 orphan child；
3. background job 可等待并取得真实 exit code；
4. cancel 会终止子孙进程；
5. 同一 job 不会因 resume 重复启动；
6. stale lock 只能在 owner 不存在时处理。

### P1-A：Candidate build-impact contract

Analyze candidate plan 应结构化提供：

- exact source anchors；
- exact template/dispatch tuple；
- expected changed files；
- expected build target；
- expected rebuild fan-out；
- 是否触碰公共 template header；
- 是否存在 narrow compile target；
- build cost/risk 分类。

Implement 只验证这些事实，不重新全仓探索。

是否扩展现有 contract，需等 session 结束后结合最新输出评估，避免为单一 case 增加框架 feature。

### P1-B：窄化 Topsop 构建边界

优先调查：

1. 是否可以直接构建目标 `.so` 而不是完整 test executable；
2. 是否能生成 exact workload specialization TU；
3. stage-3 specialization 是否能放在 workload-local TU，避免修改公共 macro/header；
4. 是否能先做单 variant compile smoke，通过后再做正式 target build；
5. per-operator env 是否能沉淀稳定的 narrow build command。

该部分可能属于 Topsop repo，而非 Piano framework；不能为了隐藏 524-step build 而在 Piano 中加入 operator-specific 分支。

### P1-C：便宜的实现前风险检查

在触发高 fan-out build 前，implement 应完成有限且确定性的检查：

- edit scope 和 template signature；
- brace/macro/preprocessor 基本完整性；
- exact symbol/instantiation 是否可达；
- L1/register/shape hard constraints；
- 若有独立 compute unit test，先运行窄测试。

但 implement 不应重新做完整 analyze，也不应把 correctness/profile 移入本 stage。

## 8. 不采用的方向

### 8.1 给 workflow stage 添加 YAML timeout

不采用。此前已确认 Topsop workflow 不通过 stage timeout 解决长构建；粗暴 timeout 只会中断合法的 25～30 分钟编译，并可能再次制造 orphan/lock。

### 8.2 仅要求模型“耐心等待”

不采用。没有进程所有权和 completion sentinel 时，耐心等待不能解决 orphan、重复 build 或错误 lock 删除。

### 8.3 直接缩短 loop iterations

不采用。Loop 次数影响 candidate 数，不解决单次 implement 的构建生命周期和编译 fan-out。当前 `iterations: 5` 是实验配置，不是本问题修复。

### 8.4 在 Piano 中硬编码 LinearQuant build 命令

不采用。具体 narrow target 应由 Topsop worker/per-operator environment 提供；Piano framework 只负责通用长命令生命周期。

## 9. 验收标准

修改完成后，至少满足：

1. 长 build 不产生 orphan `ophal/mule/ninja`；
2. 同一 invocation 不会重复启动相同 build；
3. 不通过 self-matching `pgrep` 等启发式判断 job 完成；
4. build attempt 的日志、PID、exit code 和耗时可直接审计；
5. foreground timeout 与 background running 在结果中明确区分；
6. 当前 target 的正常 524-step build 可以持续 30 分钟以上而不被误判为 hang；
7. 若构建真实 stall，能基于 progress/mtime/owner 证据终止整个进程组；
8. implement 不重新进行大范围源码探索；
9. 若存在 narrow target，构建对象数显著少于 524；
10. workflow 后续 evaluate/promote 不受 lifecycle 改动破坏。

建议验证顺序：

```text
unit lifecycle test
  -> fake long build test
  -> focused harness/orchestrator tests
  -> typecheck/lint
  -> isolated Topsop narrow-build smoke
  -> 新 V2 end-to-end session
```

## 10. 实施冻结与工作区保护

在 session `20260916T025230-e91d7b` 进入 terminal 状态前：

- 不修改 `packages/harness`、`packages/orchestrator` 的运行实现；
- 不修改 `recipes/topsop-v2-*` worker、skills 或 contracts；
- 不修改 DSH patch/resume runner；
- 不切换分支、不 rebase、不 reset 当前 Piano checkout；
- 不运行会抢占大量 CPU/IO 或真实设备的完整测试；
- 不修改 `/home/wsj/topsop` 中当前 candidate；
- 只允许文档记录和只读调查。

必须保留且排除于后续无关提交：

```text
M  recipes/workflows/topsop-tuning-v2.yml  # 用户 iterations: 5
?? node_modules
```

## 11. 待办与提交记录

- [x] 收集 iter0/iter1 duration、transcript、tool-call 和 build evidence；
- [x] 区分异常 lifecycle 成本与真实 524-step compile 成本；
- [x] 冻结修改边界；
- [ ] 等待 session terminal；
- [ ] 检查 DSH job/process-group API；
- [ ] 确定 framework 与 worker 的最小改动边界；
- [ ] 实施 P0；
- [ ] 添加回归测试；
- [ ] 评估 narrow build 和 build-impact handoff；
- [ ] 更新本文实际改动、验证结果和 commit id。

当前实现 commit：`pending`。
