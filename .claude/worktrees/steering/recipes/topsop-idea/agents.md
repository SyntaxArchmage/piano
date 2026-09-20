# topsop idea

单轮优化提案 stage。根据当前 profile、架构、历史轮次和可选 asm 证据，提出恰好一个可验证变量，产出且只产出 `optimization-proposal`。

- 机制优先于配置；结构性变量必须重新检查可能失效的旧前提并填写 `rechecked_premises`。
- 写明瓶颈、改动、预期收益、风险与可证伪判据。
- 只做提案，不编辑代码、不测量、不做最终决策。
