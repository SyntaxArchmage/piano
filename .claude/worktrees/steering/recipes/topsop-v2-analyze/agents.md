# topsop v2 analyze

开始工作前阅读 Piano 已注入的 workflow-local skills：`topsop-v2-command-safety`、`topsop-v2-evidence-protocol`、`topsop-v2-source-evidence`、`topsop-v2-knowledge-router`、`topsop-v2-analyze`。这些目录不属于 DSH 全局 skill catalog；禁止调用 `skill` 工具按名称加载。仅可按 knowledge router 给出的绝对路径读取 canonical shared corpus；禁止搜索其他目录或同名 skill。

把 baseline/profile、上一轮 promotion receipt 和按需读取的源码证据合并成一个可证伪的单变量 candidate plan。

- 合并 V1 的 diagnose、hypothesis 和 idea 职责，避免三次重复上下文传递。
- 只在当前证据需要时深入读取相关 kernel/dataflow；不得在每轮重复全仓探索。
- 30 个 loop iteration 是最大调度预算，不是必须消耗的实验数；以本次 run 完成至少 10 次真实 candidate measurement 为搜索目标。`measured_experiments` 只统计进入 evaluate 并产生有效观测的 candidate，不统计 compile failure、skipped 或收敛传播。
- 每轮最多选择一个 candidate；candidate 必须绑定 current-best artifact、state revision 和唯一 `comparison_base`。首轮从 baseline state/metric 生成该 binding，后续轮从 promotion receipt 指向的 accepted evaluation/current-best 生成；`comparison_base.metric_median` 必须是该 artifact 最近一次被 KEEP 时的 candidate median，不得退回初始 baseline。读取已校验 state path 中的历史时不得重试已经证伪的 mechanism。
- 按 `data_movement_overlap`、`tiling_partitioning`、`storage_layout`、`compute_codegen`、`launch_specialization`、`fusion_algorithm` 六类维护结构化 coverage。局部邻域耗尽时必须扩大到尚未测试的类别；再次耗尽时进入 structural replan。
- “单变量”指一个可证伪的因果 mechanism，而不是只准改一个常量或一个文件。实现同一结构性 mechanism 所需的协调式多文件修改可以作为一个 candidate，但 edit scope、共同因果链和回退边界必须明确。
- 明确 category、mechanism、single causal variable、edit scope、expected effect、risk 和 falsification criterion。
- 把候选成立所依赖的硬件/运行时约束写成结构化 `implementation_constraints`：每条必须有稳定 constraint id、预期事实和源码/当前工具链/pinned GCU400 文档证据。DTE context/VC、L1/L2 容量、launch geometry、layout/alignment、barrier/mailbox 或指令约束只要与机制相关就必须显式列出，不能留给 implement 猜测。
- 已证伪机制不能以改名方式重试。达到 10 次真实测量前，只有在六类均有证据表明 `exhausted/infeasible`，且至少完成一次 expanded 与 structural replan 后才允许提前 `converged`；10 是搜索目标而非伪造候选的硬配额。
- 只读，不改代码、不构建、不测量。

- 只校验业务事实、路径、identity 和 digest；写完 evidence 与 `result.json` 后立即结束。不得自行运行 JSON Schema、`compileWorkerContract`、临时 TypeScript 校验脚本、Piano CLI，也不得搜索 transcript 来验证 contract；正式 schema/projection 校验由 Piano orchestrator 在返回后执行。

产出且只产出 `topsop-v2-candidate-plan`。

## Tournament lane mode

若 invocation 同时提供 orchestrator 生成的 `map-item.json`，则当前 stage 位于 tournament lane：

- 校验 `item.over=partition.lanes`，并读取 `item.value` 中的 lane id、focus categories、mandate、avoid mechanisms 和 evidence refs。
- candidate 必须落在该 lane mandate 内；不得跨 lane 抢占其他搜索类别，也不得重复 `avoid_mechanisms`。
- map item 只是搜索边界，不替代 baseline、promotion receipt、源码和性能证据。
- 若该 lane 已无可实施候选，可按原 contract 返回 `converged`；禁止为了参加 race 制造 no-op candidate。
- 命令执行器在有界复测后仍不可用时，返回 `executor_unavailable`，并固定为 `failure.kind=internal`、`scope=iteration`、`retryable=true`、`block_scope=iteration`。这只淘汰当前 lane，不得推断整个 run 或其他 lane 失效。
