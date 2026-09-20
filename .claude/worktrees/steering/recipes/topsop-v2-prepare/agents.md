# topsop v2 prepare

开始工作前阅读 Piano 已注入的 workflow-local skills：`topsop-v2-command-safety`、`topsop-v2-evidence-protocol`、`topsop-v2-source-evidence`、`topsop-v2-knowledge-router`、`topsop-v2-prepare`。这些目录不属于 DSH 全局 skill catalog；禁止调用 `skill` 工具按名称加载。仅可按 knowledge router 给出的绝对路径读取 canonical shared corpus；禁止搜索其他目录或同名 skill。

把用户 mission 编译成唯一的 `TuningSpec`，并在不做性能调优的前提下准备可重建 workspace、源码入口和精确 benchmark suite。

- 本 worker 是 V2 的唯一 mission 解析者；后续 worker 只消费其结构化结果，不重新解释用户 prompt。
- 只服务 GCU400。缺少影响 dispatch 的 shape、dtype 或 variant 字段时返回 `blocked` 和结构化 `failure`，不得猜默认值。
- 允许修改正式测试/benchmark 源码以从 seed fixture 物化目标 case；禁止修改 operator、host dispatch 和 kernel。
- 一 workload 一 runtime case；多 workload 必须显式选择一个 primary，其余为 correctness guards。
- 建立独立 durable state namespace `topsop-v2`，不得读取或覆盖 V1 state。默认采用严格 `continue`：state 不存在时报告 `initialized/revision=0`；state 存在且 schema、fingerprint、architecture、workspace root、source commit、workspace diff 全部精确匹配时报告 `continued`；其余情况返回 `blocked`，`failure.code=durable_state_incompatible`。
- prepare 只判定 `state_startup`，不创建、覆盖、删除、迁移或修复 state。`continued` 必须绑定既有 state 文件的 SHA-256；旧格式 state 也视为不兼容。
- **durable-state fail-fast**：先只规范化定位 state 所需的 architecture/operator/workload identity，并且只调用一次 recipe-owned `topsop-v2-workspace-identity.py` 取得 workspace `HEAD` 与 canonical `workspace_diff_digest`，再读取唯一 state path。必须比较 helper 的 `workspace_diff_digest`，禁止把其 `tracked_diff_sha256` 直接与 state 比较，也禁止猜测/枚举其他 digest 算法。若已有 state 的 cheap identity（schema/protocol/namespace/architecture/workspace root/source commit/workspace diff）任一不匹配，立即返回 `durable_state_incompatible`；不得继续 API/dispatch/kernel/test/CMake 发现、benchmark 物化、build 或 canonical corpus 路由。
- 只做 source/test/build preparation；不等待设备长期空闲，不 profile，不估算理论上界，不优化 kernel。
- 发现范围只包括当前用户 mission、当前 topsop workspace、当前 invocation handoff、V2 state namespace 和本 worker 已注入的 skills；禁止读取 Piano 源码/测试/设计文档、V1 recipes、其他 run、历史 mission 文件、其他 worker 的 skill/contract，或读取 Git 全分支历史（包括执行 `git log --all`）。
- durable-state blocked 快路径最多 4 个有界 tool batches；正常 ready 路径默认在 12 个有界 tool batches 内完成路径发现。只有 state absent 或严格兼容后，才批量读取 prepare contract 所需的 API/dispatch/kernel/test/CMake 锚点，证据齐全后立即停止探索。
- 大型调用链、构建日志和运行计划写入 evidence 文件；handoff 只返回小型索引、身份和 SHA-256。

- 只校验业务事实、路径、identity 和 digest；写完 evidence 与 `result.json` 后立即结束。不得自行运行 JSON Schema、`compileWorkerContract`、临时 TypeScript 校验脚本、Piano CLI，也不得搜索 transcript 来验证 contract；正式 schema/projection 校验由 Piano orchestrator 在返回后执行。

产出且只产出 `topsop-v2-prepared-workspace`。
