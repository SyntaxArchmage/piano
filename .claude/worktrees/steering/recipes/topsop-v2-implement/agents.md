# topsop v2 implement

开始工作前阅读 Piano 已注入的 workflow-local skills：`topsop-v2-command-safety`、`topsop-v2-evidence-protocol`、`topsop-v2-source-evidence`、`topsop-v2-knowledge-router`、`topsop-v2-validation`、`topsop-v2-implement`。这些目录不属于 DSH 全局 skill catalog；禁止调用 `skill` 工具按名称加载。仅可按 knowledge router 给出的绝对路径读取 canonical shared corpus；禁止搜索其他目录或同名 skill。

严格按照一个 `topsop-v2-candidate-plan` 修改实现、构建候选 artifact，并记录可恢复的 workspace transition。

- 只实现 candidate 声明的单一变量；禁止顺手重构或同时尝试第二种机制。
- prepared benchmark suite 已冻结，禁止修改 testcase identity。
- 编辑前通过 baseline/上一轮 promotion 给出的 state path 与 SHA-256 验证 current-best immutable snapshot、source commit、state revision，并只用 recipe-owned `topsop-v2-workspace-identity.py` 验证 canonical workspace diff；冲突时停止，禁止自行实现或猜测 digest 算法。
- 编辑前把 candidate 的 id、base artifact/revision、`comparison_base`、single variable、mechanism、edit scope 和每条 `implementation_constraints` 固化为 conformance ledger。`comparison_base` 的 revision/artifact 必须与 candidate base 完全一致；built result 必须逐字段原样传播该 binding。
- 修改完成后、构建前逐条核对 diff 与实现事实；所有约束都必须由当前源码/工具链或已允许的 pinned GCU400 证据证明。DTE context/VC、L1/L2 容量、launch geometry、layout/alignment、barrier/mailbox 和指令约束若与本候选相关，必须给出可复核的 expected/observed 账目。
- 修改范围必须落在 candidate `edit_scope`，且仍然只实现声明的 mechanism。任一 constraint 不匹配时先做一次有界纠正；仍不匹配则恢复本候选改动并返回 iteration-scope `candidate_plan_mismatch`，禁止构建一个偏离计划的候选。
- 只有 `plan_conformance` 全部为真后才运行正式 build；构建失败返回 `compile_failed`，不得伪造 artifact。
- 保存 changed files、diff digest、plan-conformance evidence、build log、candidate artifact digest 和 restore point。
- 不运行完整 correctness/profile，不做 KEEP/DISCARD，不 commit。

- 只校验业务事实、路径、identity 和 digest；写完 evidence 与 `result.json` 后立即结束。不得自行运行 JSON Schema、`compileWorkerContract`、临时 TypeScript 校验脚本、Piano CLI，也不得搜索 transcript 来验证 contract；正式 schema/projection 校验由 Piano orchestrator 在返回后执行。

产出且只产出 `topsop-v2-candidate-artifact`。

若 analyze 返回 `converged`，不得制造 candidate；直接返回 `skipped`，且不执行编辑或构建。

## Tournament slot mode

若 handoff 的 `consumer.workspace.kind` 为 `map-slot`，当前工作目录就是唯一允许修改的源码根：

- 将任何记录中的绝对源码路径重定位到 `consumer.workspace.cwd`，禁止修改 tournament parent、其他 slot 或原始 checkout。
- 使用 lane-private build root，或提供不会读写共享构建产物的等价隔离证明；不得把共享 `/home/wsj/build` 作为可变输出目录。
- 将 evaluate 实际使用的候选 artifact 固化到 invocation-owned evidence 路径并记录 digest，保证其他 lane 构建和 slot cleanup 不会覆盖它。
- 命令执行器在有界复测后仍不可用时，返回 `executor_unavailable`，并固定为 `failure.kind=internal`、`scope=iteration`、`retryable=true`、`block_scope=iteration`。不得用单 lane 的 tool-session 故障阻断整个 tournament。
