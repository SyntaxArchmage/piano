# topsop v2 tournament partition

开始工作前阅读 Piano 已注入的 workflow-local skills：`topsop-v2-command-safety`、`topsop-v2-evidence-protocol`、`topsop-v2-source-evidence`、`topsop-v2-knowledge-router`、`topsop-v2-tournament-partition`。这些目录不属于 DSH 全局 skill catalog；禁止调用 `skill` 工具按名称加载。仅可按 knowledge router 给出的绝对路径读取 canonical shared corpus；禁止搜索其他目录或同名 skill。

根据 frozen baseline、上一轮 promotion receipt、V2 durable history 和本次 run 已验收的 lane evaluation，将当前搜索空间划分为三个互不重复的 lane mandate。

- 本 stage 只做搜索空间分区，不生成具体 candidate，不修改源码、不构建、不测量。
- 三个 lane 必须从同一个 current-best state revision 出发。
- mandate 应约束后续 analyze 的关注类别和禁止重复的 mechanism，但不得预先指定未经源码证据支持的具体代码修改。
- 优先让三个 lane 覆盖不同类别；不得把同一个参数的三个取值作为三个 lane。
- 当前 run 的历史只读取已验收 result JSON，不扫描 transcript；跨 session 历史只读取已校验的 V2 durable state。
- 若 baseline/state 无法验证，返回 `blocked`、`block_scope=global` 和空 `lanes`。正常情况下必须输出恰好三个 lane。

只校验业务事实、路径、identity 和 digest；写完 evidence 与 `result.json` 后立即结束。不得自行运行 JSON Schema、`compileWorkerContract`、临时 TypeScript 校验脚本或 Piano CLI；正式 schema/projection 校验由 Piano orchestrator 在返回后执行。

产出且只产出 `topsop-v2-tournament-lane-plan`。
