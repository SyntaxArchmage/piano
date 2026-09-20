# topsop v2 characterize

开始工作前阅读 Piano 已注入的 workflow-local skills：`topsop-v2-command-safety`、`topsop-v2-evidence-protocol`、`topsop-v2-knowledge-router`、`topsop-v2-characterize`。这些目录不属于 DSH 全局 skill catalog；禁止调用 `skill` 工具按名称加载。仅可按 knowledge router 给出的绝对路径读取 canonical shared corpus；禁止搜索其他目录或同名 skill。

对 `topsop-v2-prepared-workspace` 建立一次 artifact-bound baseline，并给出可复算的性能、正确性、profile 和理论上界。

- **upstream-blocked fast path**：若唯一 prepare result 已验收且 `status=blocked`，只校验 handoff 中的 prepared result ref，原样传播其 `failure` 并写出 blocked baseline result；最多 3 个有界 tool batches。禁止重新检查 Git/state、读取源码或 canonical corpus、构建、申请设备 lease、测试、profile 或估算理论上界。

- 不重新解析 mission，不重新探索整个仓库；以 prepare 的路径和 digest 为唯一入口。
- 在真正执行设备命令前做短时、命令级设备租约检查；设备繁忙属于 `device` failure，不是源码失败。
- 逐 workload 验证 runtime identity；primary 采集性能，guards 只承担 correctness。
- `initialized` 时从当前 HEAD 构建、测量并原子创建 revision 0 state；`continued` 时先复核 prepare 给出的 state path/SHA-256，并复用 recipe-owned `topsop-v2-workspace-identity.py` 核对同一 canonical digest，再从其 current-best source commit 重新构建、重新校验和重新测量，禁止复用历史 timing/profile 或自行实现第二套 digest。
- 将通过 correctness 的 current-best artifact 复制到 state root 下按 revision 和 digest 命名的不可变 snapshot；active build 路径不能作为跨 session 的唯一证据。
- 冻结本 session 的 baseline artifact、raw samples、median/MAD、acceptance threshold 和 theory ceilings。acceptance threshold 使用 `max(0.5%×median, 3×MAD)`：允许显著高于噪声的小幅改进逐轮累积，同时保留 0.5% 相对下限；初始化或刷新同一 current-best 的 artifact snapshot 不算 promotion，不增加 revision，也不丢弃历史。
- 不修改测试、operator 或 kernel，不改变 durable winner 的源码身份。
- 原始 build/test/profile/VPD 输出写 evidence；handoff 只保留指标和引用。
- 直接执行 prepare 提供的 build/test/filter 路径；禁止查看 prepare transcript、Piano 源码/测试、其他 run，或为寻找校验方法调用 `piano --help`。
- 设备阶段压缩为一个 correctness batch、一个 timing batch、一个 metrics/VPD batch；命令格式失败时最多进行一次有证据的缩小重试。

- 只校验业务事实、路径、identity 和 digest；写完 evidence 与 `result.json` 后立即结束。不得自行运行 JSON Schema、`compileWorkerContract`、临时 TypeScript 校验脚本、Piano CLI，也不得搜索 transcript 来验证 contract；正式 schema/projection 校验由 Piano orchestrator 在返回后执行。

产出且只产出 `topsop-v2-baseline-bundle`。
