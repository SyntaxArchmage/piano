# GCU400 Code Review Checklist Mapping

本文件由 SKILL.md 在选点时读取，列出 reviewer 清单、启用条件、严重度口径、常见选点组合与固定联动。维护本文件等价于维护"哪些 reviewer 存在、什么时候启用、严重度怎么算"这三件事。target 命中通信算子 / 3rdparty 代码等 description 已声明的不审范围时，主流程应追问而不是套用本表。

## 文档分工

| 关心的事 | 唯一维护位置 |
| :-- | :-- |
| 选点流程、Pass 划分、强制 trace 热区清单、3 段式输出格式 | `SKILL.md` |
| Reviewer 清单、启用条件、严重度口径、常见选点组合、固定联动 | 本文件 `common.md` |
| 单个 reviewer 的具体技术规则、证据要求、误报防护 | `reviewer_<n>_*.md` |
| reviewer 文件的写作模板 | `README.md` |

## 一级分组

| 一级分组 | 目标 |
| :-- | :-- |
| 接口与路径选择 | API 契约、host/kernel 接线、dispatch 选路、被调 helper 接口契约 |
| 资源与执行模型 | 对齐、地址算术、L1 / 栈 / OACC 预算、DTE 生命周期、fence/barrier、mailbox 生命周期 |
| 语义与验证 | optional/tail path、1D 归约数值稳定性、测试语义、输出语义、L0P5 一致性、跨循环 trace |
| 硬件 quirk 与交付 gate | TVSTOA CVT 硬件 bug、交付门禁 |

## 二级 Reviewer 映射

| 编号 | Reviewer 点 | 一级分组 | 典型触发信号 | 文件 |
| :-- | :-- | :-- | :-- | :-- |
| 0 | Host API 接口契约 | 接口与路径选择 | `topsaten_*` 入口、对外头文件、host API 签名 / 兼容性 / 异步语义 | `reviewer_0_host_api.md` |
| 1 | 向量对齐与地址空间约束 | 资源与执行模型 | `__vector*`、`__local__`、`__valigned__`、SDMEM 向量访问、TAR、`reinterpret_cast` 跨地址空间 | `reviewer_1_memory_alignment.md` |
| 2 | host / kernel 一致性 | 接口与路径选择 | host 参数、kernel launch、shape/dtype/stride 透传 | `reviewer_2_host_kernel_consistency.md` |
| 3 | dispatch / planner 一致性 | 接口与路径选择 | dispatch、planner、tiling、shape 阈值、variant 选择、fallback | `reviewer_3_dispatch_planner_consistency.md` |
| 4 | 资源预算（L1 / OACC / 栈） | 资源与执行模型 | `__local__` allocator、`maxnreg`、栈用量、`maxThreadNumInActiveSip` | `reviewer_4_memory_budget.md` |
| 5 | DTE 生命周期 | 资源与执行模型 | `private_dte` / `shared_dte` / `local_dte` / `init` / `config_*` / `trigger` / `wait` / `destroy` / `connect` | `reviewer_5_dte_lifecycle.md` |
| 6 | 同步 fence / barrier | 资源与执行模型 | `__syncthreads` / `__syncsubthreads` / `tops::sync_subthreads` / `tcle::fence<*>` / SCF Mirror | `reviewer_6_fence_barrier.md` |
| 7 | optional / tail path 分支 | 语义与验证 | optional 输入、tail mask、尾块、partial tile、`is_normalize` / `is_first_*` / `is_last_*` 分支 | `reviewer_7_optional_tail_path.md` |
| 8 | 1D 归约数值稳定性 | 语义与验证 | LayerNorm / Softmax / RMSNorm、`vexp` / `rsqrt` / `mul_scl`、stage 归约、tail mask 归约 | `reviewer_8_numerical_stability.md` |
| 9 | 测试语义有效性 | 语义与验证 | `test/`、断言、CPU reference 对比、case 覆盖、dispatch / fallback 路径覆盖 | `reviewer_9_test_semantics.md` |
| 10 | L0P5 cache 一致性 | 语义与验证 | `l0p5_inv` / `mli_gemm` / GEMM 输入 cache / `buffer_id` / 多 sub-thread 共享 | `reviewer_10_l0p5_cache_consistency.md` |
| 11 | DTE 跨循环 event trace | 语义与验证 | 多层嵌套循环、`*_valid`、guarded wait、ping/pong / 三缓冲 stage | `reviewer_11_dte_cross_loop_event_trace.md` |
| 12 | Mailbox 生命周期与计数器 | 资源与执行模型 | `tops_alloc_mailbox` / `task_notify` / `__gcu_wait_*` / SCF Mirror notify / 长循环 notify | `reviewer_12_mailbox_lifecycle.md` |
| 13 | TVSTOA CVT 硬件 bug | 硬件 quirk 与交付 gate | `tcle::tar_cvt_store` / `tcle::internal_tar_cvt_store` / 非满 VL + CVT + 特定 `start_addr & 0x7F` | `reviewer_13_tvstoa_cvt_hw_bug.md` |
| 14 | 被调 helper / Primo++ 算子接口契约 | 接口与路径选择 | `matmul_*_preconfig`、`lnact_*`、`flash_attn_*`、Primo++ `matrix_t::dot` / `tensor_queue` / 仓库内手写 helper | `reviewer_14_callee_contract.md` |
| 15 | 工程门禁与交付判定 | 硬件 quirk 与交付 gate | commit、journal、绑定同步、测试同步、delivery gate | `reviewer_15_engineering_delivery_gate.md` |
| 16 | 地址算术溢出与极端输入 | 资源与执行模型 | L3 / L1 / DSM / workspace / KV cache offset、stride / pitch、`align_up` 乘积、长上下文、大 batch / head、block table 间接索引 | `reviewer_16_address_overflow_extreme_shapes.md` |

## 三级 常见选点组合

| 场景 | 建议启用 reviewer |
| :-- | :-- |
| 公共 API / Host 改动 | `0` + `2` + `3` |
| DTE / buffer / allocator / launch 改动 | `4` + `5` + `6` + `11` + `16` |
| 1D 归约 kernel | `7` + `8` + `1` |
| 2D / GEMM / Primo++ matmul | `4` + `10` + `11` + `14` |
| TAR / 向量访存 / SDMEM | `1` + `13` + `16` |
| Mailbox / 多 sub-thread 通信 / 异构多线程 | `5` + `12` + `11` |
| fallback / 兼容入口改动 | `0` + `3` |
| 测试改动 | `9` |
| perf / refactor patch（wait / fence / buffer 复用 / 三缓冲 / unroll 变更） | `5` + `6` + `11`；命中 optional guard 时加 `7` |
| 地址 / stride / workspace / 长上下文索引改动 | `16` + `2` + `3` |
| kernel 正文改动需要确认对应测试 | `9` |
| target 调用仓库内 helper（`*_preconfig` / `*_calc` / `*_store` / Primo++ `matrix_t::dot`） | 加 `14` |
| 整算子目录 dev review | `0` + `2` + `3` + `4` + `5` + `6` + `7` + `8` + `9` + `10` + `11` + `12` + `13` + `14` + `16` |
| 需要交付判定 | 加 `15` |

## 四级 固定联动

| 主点 | 必看联动点 | 原因 |
| :-- | :-- | :-- |
| `reviewer_1_memory_alignment` | `reviewer_13_tvstoa_cvt_hw_bug` | SDMEM / TAR 静态对齐与 TVSTOA CVT 触发条件常一起出现 |
| `reviewer_3_dispatch_planner_consistency` | `reviewer_2_host_kernel_consistency` | dispatch 改动容易把 host 校验 / kernel 实参对账带漂 |
| `reviewer_4_memory_budget` | `reviewer_5_dte_lifecycle` | L1 预算与 DTE 生命周期常一起失配（host 预算公式按 padded 维度算，但 `private_dte` × `threadDimSize` 决定的实际 buffer 复用粒度未对齐） |
| `reviewer_5_dte_lifecycle` | `reviewer_6_fence_barrier` + `reviewer_11_dte_cross_loop_event_trace` | DTE wait 缺口、fence scope 与跨循环 event 飘逸常并发出现 |
| `reviewer_7_optional_tail_path` | `reviewer_8_numerical_stability` + `reviewer_11_dte_cross_loop_event_trace` | tail / optional 分支常伴随 mask 归约错误与跨循环 drain 漏 |
| `reviewer_10_l0p5_cache_consistency` | `reviewer_11_dte_cross_loop_event_trace` | l0p5_inv 套圈与 GEMM 输入 cache 跨迭代复用常同时存在 |
| `reviewer_12_mailbox_lifecycle` | `reviewer_5_dte_lifecycle` | mailbox 通知模型常承载 DTE 完成事件，跨 sub-thread 传 mailbox id / task 指针的生命周期与 DTE 生命周期共因 |
| `reviewer_13_tvstoa_cvt_hw_bug` | `reviewer_1_memory_alignment` | 触发条件由 VL + dtype + 地址低位组合决定，必须配合静态地址形态判定 |
| `reviewer_14_callee_contract` | `reviewer_3_dispatch_planner_consistency` + `reviewer_4_memory_budget` | callee 对 `M/N/K` / workspace / dtype 的前置条件往往要靠 host 端 dispatch guard 挡住或通过 padding 让预算重算 |
| `reviewer_16_address_overflow_extreme_shapes` | `reviewer_2_host_kernel_consistency` + `reviewer_3_dispatch_planner_consistency` | 地址上界通常由 host guard / planner invariant 给出，kernel 内表达式是否安全需要和入口约束一起对账 |
| target 命中 **DTE 时序高发区**（多层嵌套循环 + `*_valid` flag、同步原语被 optional 条件 guard、双/三缓冲 ping/pong 跨迭代复用） | `reviewer_11_dte_cross_loop_event_trace` + `reviewer_7_optional_tail_path` | event 生命周期 trace（11）与 optional guard 语义（7）要一起对账 |

## 严重度口径

每条 finding 必须给出显式 `severity`，不使用"高危"、"风险提示"、"严重时 hang"、"按 X 处理"这类模糊表述；命中以下口径后直接写 `severity: Blocker|Major|Minor`。

| severity | 语义 | 典型判定 |
| :-- | :-- | :-- |
| `Blocker` | 合入后会触发 hang / Hot Reset / 数值挂 / 数据错乱，且硬规则直接命中 | 命中 `SKILL.md` 的"强制规则锚点"；命中 TVSTOA CVT 硬件 bug 的具体地址组合 |
| `Major` | 会在特定 shape / dtype / 路径下造成错误或明显回退；证据链基本闭合，但需额外条件触发 | host/kernel 对账缺口；perf patch 引入的 correctness 回退；fallback 语义漂移；callee 契约违例；工程交付门禁关键项缺失 |
| `Minor` | 工程规范或可读性瑕疵，不影响正确性 | commit body / journal / python binding / 命名 / 风格 |

附加规则：

- 证据不足但模式高度可疑 → 保留原始 `severity`，置 `confidence: low`，输出阶段会把它划入 `开放问题` 而非 `Findings`
- 各 reviewer 文件中写到"按 Blocker 处理 / 按 Major 处理"时，默认语义与本表一致；不要在 reviewer 文件里自定义第 4 档严重度
