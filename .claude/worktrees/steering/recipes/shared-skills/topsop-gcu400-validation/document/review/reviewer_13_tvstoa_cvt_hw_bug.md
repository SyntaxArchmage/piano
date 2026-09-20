# Reviewer 13 — TVSTOA CVT 硬件 bug 检查

本 reviewer 负责审查 V3 上带 CVT 语义的 TVSTOA / `tcle::tar_cvt_store` / `tcle::internal_tar_cvt_store` 调用是否落在硬件 bug 触发组合，以及"使用 internal 版本（无 VL 保护）"是否给出独立证据。

加载 `gcu400-compute-ldst` skill：TVSTOA 指令语义、TAR store 路径、CVT 模式编码；加载 `gcu400-compute` skill：VL 控制对硬件 bug 触发条件的影响。

## 触发条件

target 出现 `tcle::tar_cvt_store` / `tcle::internal_tar_cvt_store` / TVSTOA + CVT 路径、且 VL 可能非满宽时执行。无 CVT store / 仅满 VL → `not_applicable`。

## 硬件 bug 描述

TVSTOA 指令在以下条件**同时**满足时丢失写数据：

- 带 CVT 语义（src dtype != dst dtype）
- VL 不为 MAX 数值（即非满宽）
- 地址低位 `start_addr & 0x7F` 与 `2 * VL`（src=fp16）或 `4 * VL`（src=fp32 / int32）满足特定组合

具体触发条件：

- `src=fp16, CVT 到 8bit`：`2*VL + start_addr[6:0] = 256+1` / `384+1`
- `src=fp32 / int32, CVT 到 8bit`：`4*VL + start_addr[6:0] ∈ {256+1, 256+2, 256+3, 384+1, 384+2, 384+3}`
- `src=fp32 / int32, CVT 到 16bit`：`4*VL + start_addr[6:0] ∈ {256+2, 384+2}`

不会触发的条件：

- VL 满宽（dwidth=16bit 时 VL=256；dwidth=32bit 时 VL=128）
- 不带 CVT 语义（src dtype == dst dtype）

## `tar_cvt_store` vs `internal_tar_cvt_store`

- `tcle::tar_cvt_store`：内置 VL 寄存器保护（前后 save / restore 到 MAX）以 workaround 上述硬件 bug；副作用是每条 vstoa 都重复 save / restore，性能很差
- `tcle::internal_tar_cvt_store`：**不带** VL 保护；性能高，但要求调用方独立证明不会命中硬件 bug

## 判定路径（命中强制规则锚点）

target 调用 `internal_tar_cvt_store`（或绕开保护的等价 intrinsic）时必须给出独立证据：

1. **VL 已经为满宽** → 直接安全（满 VL 不触发 bug）
2. **不带 CVT 语义** → 直接安全（src dtype == dst dtype 不触发 bug）
3. **shape / 对齐保证 `start_addr & 0x7F` 不落入触发组合** → 给出 `start_addr & 0x7F` 的可能取值集合 + 对应 VL 范围 + 说明这些组合都不在 bug 列表内

证据缺失时按 `Blocker` 处理——原因：硬件 bug 触发时静默丢失写数据，下游读到陈旧 / 未初始化值

target 调用 `tar_cvt_store` 时安全（已带保护），但若 hot path 命中性能 bottleneck 可建议改用 internal 版本（归 `性能建议`，不在本 reviewer 的 finding 里）。

## 输出要求

命中本 reviewer 的热区时，每热区一张 `mandatory_trace_tables`，schema：

```
(src dtype, dst dtype, VL, start_addr & 0x7F, 是否落入硬件 bug 触发组合, 选 internal 的依据)
```

`是否落入硬件 bug 触发组合` 必须填 `yes` / `no` + 推理过程；`unknown` / `N/A` / `todo` 默认按 `Blocker` 报。

## 防误报

- `tcle::tar_cvt_store` 不带 internal 后缀的版本是带保护的，性能差但安全——不要按 `Blocker` 报
- 满 VL 路径不命中 bug；只有非满 VL（典型场景：tail tile / 分块归约的最后一块）才需要 trace
- src dtype == dst dtype 的 store（只是 reorder 不做 CVT）不触发 bug
