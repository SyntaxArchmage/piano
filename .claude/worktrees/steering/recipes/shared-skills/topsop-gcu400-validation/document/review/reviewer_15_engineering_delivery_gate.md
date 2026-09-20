# Reviewer 15 — 工程门禁与交付判定

本 reviewer 负责在用户要求交付 / 合入 / delivery gate 时审查工程合规：commit message、journal、Python binding 同步、测试同步、构建产物、CPU reference 接线，以及最终交付判定。

加载 `gcu400-compute-flow` skill：接线步骤（device kernel → host wrapper → OpBase → public API → CMake → test）；加载 `gcu400-testing` skill：测试入口要求、apitrace、sanitizer 双模复验。

## 触发条件

用户显式要求交付判定、合入前检查、delivery gate、commit SHA 级别审查时执行。普通整算子目录 dev review 不默认启用；测试覆盖由 `reviewer_9` 先审，只有需要最终交付结论时才进入本 reviewer。

## 接线完整性

新增或修改算子时，下列五层必须同轮补齐——原因：缺任一层都会让新逻辑不可调用或不可验证：

- device kernel
- host wrapper / launch
- OpBase 派生类（`CheckArgs` / `PreHandle` / `Compute`）
- public API（`topsaten_*`）
- CMake / build target
- 正式入口测试 + CPU reference 对比

## Commit message 与 journal

- commit message 应明确说明：变更对象 / 变更动机 / 主要风险 / 测试范围
- 大算子或长期演进的算子目录应有 journal / 设计文档同步更新
- "perf patch only" / "refactor only" 等仅限词需要与实际 diff 对应；diff 实际改了语义但 commit 标 refactor 时按 `Major` 处理

## Python binding 同步

- 新增 Host API 或修改 dispatch 条件时，Python binding（如有）必须同步更新；缺失会让上层调用方断链
- vLLM 测试入口（`vllm_zx_utils.kernels._custom_ops`）调用的接口若发生签名变化，必须确认上层也同步

## 测试同步

- 新增算子：必须有 `test/` 下的对应 gtest case + CPU reference——原因：没有正式入口测试和独立 reference 时，新 kernel 只能证明可编译，不能证明对外语义正确
- 修改现有算子：受影响的已有测试必须同步更新（命中新 kernel / 新路径 / 边界 / fallback）；找不到现有测试时必须明确写"未找到对应现有测试"并补齐——原因：旧测试若不命中改动路径，回归结果与本次改动无关
- 只改 device kernel 而没有测试 diff 时，也要反查对应正式入口测试是否仍能覆盖该 kernel——原因：kernel 改动常不触发 host 接线变化，但 regression 仍需要由 public API / host wrapper 入口测试兜住
- sanitizer / DTE check 双模复验：DTE / 地址 / 概率性 mismatch 类的改动必须跑过 sanitizer + 正常运行两种模式——原因：sanitizer 能暴露地址 / DTE 协议错误，正常运行能覆盖 sanitizer 改变时序后可能掩盖的概率性 mismatch

## 构建产物

- agent 改动 kernel / Host API 后必须重编对应 ninja target——原因：旧产物会让验证结果和当前源码无关
- 单算子改动只编对应 target，不跑无目标全量编译

## delivery_gate 判定

整算子目录 review 时填写 `delivery_gate`，取值：

| 取值 | 语义 |
| :-- | :-- |
| `ready` | 所有接线完整、commit 合规、测试同步、回归通过、Findings 中无 `Blocker` / `Major` |
| `blocked` | 存在 `Blocker` 或关键接线 / 测试同步缺失 |
| `conditional` | 存在 `Major` 但有明确修复路径，或部分接线 / 测试同步可在合入前补齐 |

block 粒度 / 单文件粒度无 commit 上下文时该字段 `not_applicable`。

## 输出要求

`reviewer_audit_trail.delivery_gate` 必填（block 粒度可 `not_applicable`），同时在 finding 中分别列出：

- 接线完整性缺口
- 测试同步缺口
- commit / journal / binding 合规缺口
- 是否需要 sanitizer / DTE check 复验

## 防误报

- block 粒度 / 单 commit 粒度不带整算子目录时，无法对接线完整性下结论——按 `not_applicable` 处理对应子项
- 测试同步缺失但生产代码改动没改任何对外行为（纯内部 refactor）时，按 `Minor` 而不是 `Major`
