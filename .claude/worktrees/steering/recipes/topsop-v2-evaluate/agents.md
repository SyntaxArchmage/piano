# topsop v2 evaluate

开始工作前阅读 Piano 已注入的 workflow-local skills：`topsop-v2-command-safety`、`topsop-v2-evidence-protocol`、`topsop-v2-knowledge-router`、`topsop-v2-validation`、`topsop-v2-evaluate`。这些目录不属于 DSH 全局 skill catalog；禁止调用 `skill` 工具按名称加载。仅可按 knowledge router 给出的绝对路径读取 canonical shared corpus；禁止搜索其他目录或同名 skill。

对一个 candidate artifact 完成 correctness 和性能评估，并输出纯观测结果；不修改代码、不更新 state。

- 合并 V1 verification 与 measure 的观测部分。
- 先验证 candidate artifact/diff，再运行 primary 和全部 guard correctness。
- correctness 未通过时不采纳性能结果；返回 `rejected`。
- correctness 通过后，对 primary 使用与 baseline 相同的 metric、case、采样和统计口径。
- 从 raw samples 重新计算 median。比较值必须取 implement 逐字段传播的 `comparison_base.metric_median`；先验证其 revision/artifact digest/identity 与 candidate base 一致。只有 `minimum_improvement=max(0.5%×初始 median, 3×MAD)` 继续使用 characterize 冻结值；禁止把初始 baseline median 当成后续轮 current-best。这样每个超过噪声门槛的小幅收益都相对于当前 incumbent 判断并可逐轮累积。
- 若未越过门槛，不额外运行目标 profile，`eligible=false`。若越过门槛，必须对同一 candidate artifact/runtime identity 采集 prepare `spec.targets` 中每一个目标指标，逐项记录 target/observed/operator/met 和原始证据；所有声明目标都被观测后才能令 `eligible=true`。没有声明 target 时输出显式的空 target ledger。
- 目标 profile 失败或缺项时最多做一次有界重试；仍不完整则保留真实 timing 但令 `eligible=false`，reason 明确为 `target_metrics_unavailable`，绝不能让候选进入 KEEP。目标是否已达成不替代增量 latency 门槛。
- 不执行 KEEP/DISCARD 的 workspace/state transaction。

- 只校验业务事实、路径、identity 和 digest；写完 evidence 与 `result.json` 后立即结束。不得自行运行 JSON Schema、`compileWorkerContract`、临时 TypeScript 校验脚本、Piano CLI，也不得搜索 transcript 来验证 contract；正式 schema/projection 校验由 Piano orchestrator 在返回后执行。

产出且只产出 `topsop-v2-candidate-evaluation`。

若 implement 返回 `skipped`，直接返回 `skipped`，不申请设备、不运行测试或 profile。

## Tournament referee and consolidation

若 stage id 位于 tournament `race` 内：

- `status=measured` 时必须额外输出 `referee`。它使用 `benchmark.median` 作为唯一值：`samples=[median]`、`best=median`、`median=median`、`runs=1`、`warmup=0`，名称为 `kernel_latency_median_us`、方向为 `lower`。完整真实样本仍保留在 `benchmark`；referee 只是把稳健统计量转换为 tournament 的单值裁判信号。
- `rejected`、`skipped` 或 `blocked` 不得伪造 referee。
- 命令执行器在有界复测后仍不可用时，返回 `executor_unavailable`，并固定为 `failure.kind=internal`、`scope=iteration`、`retryable=true`、`block_scope=iteration`；不得阻断其他 lane 的 referee 选择和 promote。
- 正常 evaluate turn 仍然只读。唯一例外是 orchestrator 发起的 `$consolidate/...` continuation：此时仅把 prompt 指定的冻结 winner delta 精确应用到 tournament parent，禁止额外修改、构建、提交或改写 Git 元数据。
