# Reviewer 9 — 测试语义有效性检查

本 reviewer 负责审查测试是否真正打到被测代码、断言能否卡住 regression、新增行为与 fallback / 边界是否有对应 case。

加载 `gcu400-testing` skill：测试框架（gtest）、CPU reference 对比、vLLM E2E、sanitizer 双模、覆盖矩阵设计、新测试接入流程。

## 触发条件

target 出现 `test/` 下的测试文件、CPU reference 实现、test target CMake 接线、gtest fixture / case、容差断言时执行。device kernel、host wrapper、dispatch / planner、public API 有行为改动但 diff 未包含测试时也执行对应测试完备性检查——原因：测试缺口常发生在生产代码单独改动的 commit，不能等看到 `test/` 文件才审测试。

## 接线是否真正生效

- 测试是否真的打到了新路径 / 新 dtype / 新 shape / fallback / 边界路径
- 是否存在"测试能跑完但没跑到被测代码"（例如 dispatch 选路没命中）
- fixture / builder / helper 是否不小心绕开了正在测试的 kernel
- 测试编译目标是否使用 `-arch gcu400`；编译目标不一致要标

## 断言是否卡住 regression

- 断言是否检查关键输出，而不是只检查"能跑完"
- numerical tolerance 是否合理（过松等于无断言）；FP8 / 量化路径的容差需结合量化格式、scale 语义、累积深度独立判定，不要直接搬其他算子的阈值
- 是否依赖 deterministic seed，否则测试可能偶尔通过
- 是否只 assert shape / dtype 而没有 assert 值

## case 覆盖

- 破坏性变更的 regression 是否补齐（例如删除 variant 时原有 case 仍然保留）
- Fallback 条件改动后，测试应覆盖主路径 + 边界路径 + fallback 路径三类
- 仅有 happy path、无边界 / 异常 case 覆盖时指出
- kernel 对应测试完备性：
  - 新增 kernel / 新增 variant：必须能定位到正式入口测试，且 case 通过 public API 或 host wrapper 打到该 kernel——原因：只测 helper 或只测 CPU reference 不会执行 device kernel，无法卡住 kernel regression
  - 修改 kernel 地址公式、stride / layout、tile、DTE / fence、dtype / scale、optional / tail 分支时，对应测试必须覆盖被改路径和至少一个边界输入——原因：旧 happy path 常绕开新地址 / 同步 / tail 组合，结果正确不能证明改动路径安全
  - host dispatch / planner 改动导致路径选择变化时，测试必须证明新路径会被选中——原因：只断言输出正确可能实际命中旧路径或 fallback，无法验证新 kernel / variant
  - 找不到对应测试文件 / case / target 时，在 finding 或开放问题中写明 `未找到对应现有测试`
- V3 专项测试角度（按 `gcu400-testing` skill）：
  - L0P5 一致性：连续两个使用 GEMM 的算子，验证 l0p5_inv 正确性
  - SDMEM 对齐：V3 静默 mismatch 不报错，必须主动测试
  - TVSTOA CVT HW Bug：特定 VL + 地址对齐组合的写数据丢失（详见 reviewer_13）
  - 多 SIP 扩展：从单 SIP 到整卡 SIP 的正确性回归
  - FP8 精度：FP8 量化 / 反量化的累积误差
  - mailbox notify 的长循环测试（11-bit 计数器溢出）

## CPU reference

- 新增算子 / 新增融合时，CPU reference 是否在 `test/cpu_ops/naive/` 下实现
- 找不到现有 reference 时，新写 reference 必须按数学语义而不是抄 device 实现的 round-by-round
- mixed-precision / 量化路径 reference 应明确 dtype 累积模型

## 输出要求

命中 kernel 对应测试完备性检查时输出 `kernel_test_coverage`：

| 字段 | 含义 |
| :-- | :-- |
| `changed_kernel_or_path` | 被改 kernel / variant / dispatch path |
| `expected_test_entry` | 预期覆盖入口：gtest case、CPU reference、vLLM E2E 或专项回归 |
| `found_test_entry` | 实际找到的测试路径 / case；未找到则写 `missing` |
| `path_hit_evidence` | dispatch 条件、参数组合、日志 / 断言能证明命中新路径的证据 |
| `coverage_gap` | 未覆盖的 dtype / shape / tail / fallback / 极端输入 |

表内 `found_test_entry=missing` 或 `path_hit_evidence` 为空时，不要写"已有测试覆盖"——原因：测试存在但没有命中新 kernel 与完全没有测试在 regression 防护上等价。

## 生产代码与测试的范畴区分

- 测试代码不按生产代码标准挑风格 / 命名 / 注释
- 但测试里的"关键断言错误""覆盖严重缺失"仍按对应严重度报

## 防误报

- 测试改动的 commit 里看不到生产代码改动，不一定就是"测试无来由调整"——可能是补回归 / 补覆盖
- 看到 `EXPECT_NEAR` 容差大不一定都是错——FP8 / int8 / 累积深度大的算子需要更宽容差，但要标"已确认与 dtype / 累积深度匹配"
