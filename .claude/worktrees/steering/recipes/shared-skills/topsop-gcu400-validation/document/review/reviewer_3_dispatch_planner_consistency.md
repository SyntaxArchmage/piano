# Reviewer 3 — dispatch / planner 一致性检查

本 reviewer 负责审查 host 端 dispatch / planner / tiling / variant 选择逻辑是否覆盖 kernel 实际假设的所有路径，且 fallback 行为正确。

加载 `gcu400-compute-flow` skill：dispatch 规范、fallback 是正式行为的语义、`CheckArgs` 与 `Compute` 职责划分。

## 触发条件

target 出现 host OpBase 的 `Compute()`、planner / tiling 函数、variant 选择代码、fallback 分支或 dispatch 表时执行。纯 kernel 内逻辑、纯参数校验返回 `not_applicable`。

## Dispatch 路径覆盖

- 所有 kernel 实际假设的前置条件（dtype 范围、shape 阈值、对齐、optional 组合、launch 形态）都要在 host 侧 dispatch / `CheckArgs` 阶段被 guard 住——原因：kernel 内部缺乏全局视图，依赖 host 把不该进入的路径挡掉
- 新增或修改 dispatch 条件时，旧路径与新路径的覆盖区间必须明确：是包含、互斥还是有重叠？重叠时优先级谁高？
- planner 输出的 tiling 必须与 kernel 内部消费的 tiling 完全一致；planner 算了一份、kernel 内又自算一份会引入两套 truth
- "能不能进入 fusion / fast path"的主决策应该在 host 侧；藏进 kernel 会让 dispatch 失去对路径的控制

## Variant 选择

- 删除 / 替换 variant 时，所有调用入口同步更新，避免老 binding 调用残留 variant
- 添加新 variant 时，所有 dispatch 条件分支都明确处理新 variant（非"默认走 fallback"，否则在边界条件下静默落 fallback）
- variant 名称与 kernel 实际 instantiation 的模板参数对齐——原因：模板参数错位会编译通过但语义偏移

## Fallback 是正式行为

- fallback 语义必须正确——原因：上层会真的走到 fallback 路径，错就是真的错
- fallback 必须有测试覆盖；只测主路径相当于没测 fallback
- 压测大面积落到 fallback 时先检查 dispatch gate 是否过紧——原因：fallback 通常慢路径，被滥用即性能回退
- fallback 内部不允许再次 dispatch 到同一 fast path——原因：会构成隐式递归

## 边界 shape / 极小 / 极大输入

- shape 维度为 0 / 1 / 极大值时 dispatch 是否仍闭合
- `align_up` 前后是否会让 host 预算与 kernel 实际访问错位（详见 reviewer_4）
- 多 SIP launch 与单 SIP launch 的 dispatch 路径是否分开覆盖；只在多 SIP 测过的逻辑直接套到单 SIP 时，可能漏 owner SIP / `shared_dte` 假设

## 兼容入口与历史 variant

- 改动 fallback 时，旧调用方使用的兼容入口是否仍工作
- 改动 dispatch 条件时，是否有 Python binding / gtest 层的 case 同步更新

## 防误报

- "host 没显式校验某条件"不一定就是 dispatch 漏洞——某些条件由更上层（编译器约束、调用方契约、已有 host helper）保证
- 看到 dispatch 表里某个 dtype 没列出不一定就是漏 case——要确认该 dtype 是否在更上层已被拦截
