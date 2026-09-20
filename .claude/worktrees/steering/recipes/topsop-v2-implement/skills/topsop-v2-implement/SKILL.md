---
name: topsop-v2-implement
description: 实现一个已准入的单变量候选并生成可恢复、可追踪的 candidate artifact。
---

# Topsop V2 implement

1. 校验 candidate plan/result path/digest，并通过 baseline 或上一轮 promotion 的 state path/SHA-256 确认 base artifact 等于当前 V2 current-best immutable snapshot、source commit 和 revision；同时核对 candidate `comparison_base` 的 revision/artifact digest/identity 与该 base 完全一致。workspace identity 只接受 `topsop-v2-workspace-identity.py` 的 canonical 输出。
2. 记录编辑前 HEAD、diff digest、artifact digest 和 preexisting dirty files。
3. 从 candidate 提取 id、base revision/artifact、single variable、mechanism、edit scope 和完整 `implementation_constraints`，在编辑前建立 conformance ledger。
4. 只修改 `edit_scope` 中声明的 operator/kernel 文件；测试和 benchmark case 已被冻结。
5. 编辑后先核对 diff 是否仍为单一 mechanism，并逐条计算/检查 candidate constraint。资源型方案必须写出真实账目，例如 DTE context 与 VC 数、L1/L2 bytes、launch geometry、layout/alignment 或同步/指令约束；不能用“应当可行”代替 observed fact。
6. 任一约束不匹配时只允许一次有界纠正；仍不匹配则恢复到 `diff_before`，返回 `blocked`、`block_scope=iteration`、failure code `candidate_plan_mismatch`，不运行 build。
7. 全部约束匹配后写出 `plan-conformance.json` 及 digest，再运行正式 build target。
8. 构建成功后重新散列 artifact，要求与 base artifact 不同；记录完整 build log，并把已验证的 `comparison_base` 逐字段原样传播到 built result。
9. 校验 changed files 没有越界，生成 restore point；不提交、不更新 durable state。
10. 编译失败返回 `compile_failed` 和真实日志引用；workspace 必须保持可由 promote 阶段恢复。

若输入 plan 为 `converged`，返回 `status=skipped` 和真实 `skip_reason`，不读取大证据、不修改 workspace、不构建。

## Tournament slot isolation

当 `consumer.workspace.kind=map-slot` 时，以 `consumer.workspace.cwd` 为源码根，并为该 lane 使用独立 build root 和 invocation-owned artifact snapshot。命令执行器经有界复测仍不可用时只淘汰当前 lane：返回 iteration-scoped、retryable 的 `executor_unavailable`，禁止声明 global block。所有绝对源码路径必须重定位；无法证明 build/artifact 隔离时返回 `blocked`，不得使用共享可变产物继续测量。
