# topsop v2 summary

开始工作前阅读 Piano 已注入的 workflow-local skills：`topsop-v2-command-safety`、`topsop-v2-evidence-protocol`、`topsop-v2-knowledge-router`、`topsop-v2-summary`。这些目录不属于 DSH 全局 skill catalog；禁止调用 `skill` 工具按名称加载。仅可按 knowledge router 给出的绝对路径读取 canonical shared corpus；禁止搜索其他目录或同名 skill。

无论 workflow 成功、无提升、上游阻塞或用户中断，都尽可能生成一个真实终态并释放 V2 资源。

- **pre-loop blocked fast path**：若 characterize 已验收为 `status=blocked` 且没有任何 tune receipt，直接继承其 `failure`，将全部 round 计数置零，并只处理当前 run 明确拥有的 lease/cleanup；最多 4 个有界 tool batches。禁止重新检查 Git ancestry、workspace digest、durable state、artifact、源码或 canonical corpus，也不得重新解释根因。

- 以 baseline bundle 和最后一个 promotion receipt 为唯一性能/状态来源，并明确报告本次 durable startup 是 `initialized` 还是 `continued`。若 outcome 为 improved，从最终 KEEP 引用的 accepted evaluation 原样汇总 `final_target_validation`，逐项报告 observed 与 met；禁止仅凭自然语言宣称目标达成。
- 分开统计 scheduled loop rounds、attempted candidates、真实 measured candidates、replan 次数和 10 次 measurement 目标；compile failure、skipped/convergence round 不得计为 measured。
- 不重新执行优化，不重新解释失败，不把缺少提升当成 global blocker。
- 核对 final artifact、state revision、workspace 和 commit；正常终态的 workspace identity 只使用 recipe-owned `topsop-v2-workspace-identity.py`，不得自行计算或猜测 digest；必要时只做安全恢复。
- 更新进展记录时写一条结构化 V2 记录，不重写历史。
- 释放 workspace lease；无法释放时仍返回 completed，但在 cleanup 中标明失败。
- 不依赖 V1 durable state，不修改 V1 workflow/worker 文件。

- 只校验业务事实、路径、identity 和 digest；`result.json` 必须是最后一次写操作，写完后立即结束，禁止继续读取、散列或执行验证命令。不得自行运行 JSON Schema、`compileWorkerContract`、临时 TypeScript 校验脚本、Piano CLI，也不得搜索 transcript 来验证 contract；正式 schema/projection 校验由 Piano orchestrator 在返回后执行。

产出且只产出 `topsop-v2-final-summary`。

## Tournament summary mode

若本次 run 包含 `tune.race` invocations，从已验收的 evaluation result JSON 汇总各轮所有 lane，分别报告 planned、built、correctness-passed、measured、winner、KEEP/DISCARD 和 failure 数；不得只统计 winner，也不得扫描 transcript。
