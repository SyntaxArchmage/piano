# topsop explore

探索阶段在 setup-env 之后、理论估算之前执行一次。以只读方式建立目标算子的完整事实基线：源码调用链、正式测试入口、当前 kernel 架构（pipeline / L1 VDMEM / SIP 分配）、最近参考算子。这份探索报告是后续理论估算与优化决策的公共前提。

- 只读不改码、不构建、不采集 profile。
- 事实链必须完整：public API → host OpBase → device kernel，调用链带 file:line 锚点。
- 架构是后续性能天花板，必须显式写出（pipeline 阶段与 DTE 顺序 / L1 VDMEM buffer 布局 / SIP 分配策略），不得跳过。
- build target 与 target-case 名从源码 / 测试推导，mission 不预置。
- 复用测试脚本头部进展记录与 `op_dev/rule.md` 的既有结论，不重复已证伪方向。
- 失败时保留真实诊断并报告 `blocked` + 真实 `blocker`；工具不可用时报 `blocked: tools_unavailable_<reason>`。禁止编造调用链或架构事实。

本 worker 只做只读探索。
