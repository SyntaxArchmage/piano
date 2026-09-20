> Imported material source: `Meeting/Markdown/LDST.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `LDST`.

# LDST

> Source PDF label: `LDST.pdf`
> 转换说明：本文按 PDF 页内容整理为正式 Markdown。可抽取文字已重排为标题、列表、表格和公式；正文已覆盖的纯文字页不再保留图片；必要的架构图、流程图和图表仅以裁剪图保留。

## 文档概览

本文介绍 SIP4.0 XPU 中 LDST 相关访存路径、Memory Slave/Master、outstanding、hazard、特殊 stride 加速、T0 128-byte 非对齐访问，以及 L3 带宽自我抑制机制。

## 1. XPU 与 Pipeline 背景

### XPU Abstract View

![XPU abstract view](meeting_ldst__figure_02_xpu_abstract.jpg)

### SIP4.0 XPU Pipeline Details

SIP4.0 XPU pipeline 包括：

| Stage | 职责 |
| --- | --- |
| S1 | Inst Fetch |
| S2 | Scalar Scheduling |
| S3 | Vector Scheduling |
| S4 | Vector ALU |

性能规格参考：

- `SIP4.0_Pipeline_Info_for_Compiler.pdf`
- Non-RTO: wiki, Record 1, Record 2
- RTO: wiki, Record-3

![SIP4.0 XPU pipeline overview](meeting_ldst__figure_03_pipeline_overview.jpg)

### 简单抽象

- S1 + S2：向量指令产生器，追求指令吞吐量。
- S3：向量指令动态调度，管理 latency 和 outstanding。
- S4：向量指令执行。

## 2. Memory for 1D

### 2.1 Latency

| 访问路径 | Load-to-use / Latency |
| --- | ---: |
| SR 访问 SDMEM | 8 cycle |
| VA 访问 VDMEM | 31 cycle |
| SR 访问 VDMEM | 51 cycle |
| 访问 SIP 内部寄存器，SCF bus write latency | 34 cycle |
| 访问 SIP 内部寄存器，SCF bus read latency | 42 cycle |
| 访问 CDTE 寄存器 | 100-136 cycle |

### 2.2 Bandwidth

| 访问路径 | 带宽 |
| --- | --- |
| SR 访问 SDMEM | `2 x 8 B/C` |
| VA 访问 VDMEM | `256B Rd + 256B Wr` |
| SR 访问 VDMEM | `8B/C` |
| CF 连续访问能力 | 可连续 128 个写、连续 32 个读 |

### 2.3 Turn-around Latency

```text
Turn-around Latency = L2U + RAW + WAR + Inst Cycle + 多线程竞争
                    = 31 + 13 + 6 + 32(unroll8 x 2op x 2time) + 竞争delta
                    = 82 + 竞争delta
```

如果计算次数很少，性能会更明显地受到 latency 影响。

## 3. Memory Slave

- S0 and S1：
  - Shared by DSM/CDF。
  - Shared by DTE/SIP。
- S0：`128B/C R+W`。
- S1：`128B/C R+W`。
- S2：to SDMEM。

![Memory slave diagram](meeting_ldst__figure_06_memory_slave_diagram.jpg)

## 4. Memory Master

- XPU-to-L1：
  - T0：`256B/C R+W`。
  - T1：`256B/C RO`。
  - T2：`256B/C RO`。
- T0：1D LDST。
- T1：2D LHS。
- T2：2D RHS。

![Memory master diagram](meeting_ldst__figure_07_memory_master_diagram.jpg)

## 5. Memory Outstanding

- M0 and M1 由 T0/T1/T2 共享。
- T1/T2 对 memory 是 read-only，因此理论上可以发出更多 outstanding，total 为 512。
- 特定算子中，可利用 GEMM 操作 `D = A x B`，将 A 或 B 矩阵固定为 E 矩阵，从而实现 `D = A` 或 `D = B` 的矩阵加载，以获得更大的 load 能力。
- 注意：D 矩阵一定是扩展精度，E 矩阵放置在 L1 中重复使用。
- 例子：Index-Add 优化实现 2。

![Memory outstanding diagram](meeting_ldst__figure_08_memory_outstanding_diagram.jpg)

## 6. Memory Hazard

### 6.1 XPU T0 R/W Hazard

- XPU 对单个 sub-thread 做地址 hazard 保护；若读写之间没有关系，可以相互无阻塞乱序发出。
- XPU 对读请求 OOO 发出，对写请求 in-order 发出。
- 若遇到地址访存 RAW，XPU 需要先发出写，再发出读，但不等待 write response；L1 后续会 in-order 处理。
- 一旦遇到读写 hazard，会因为写请求 in-order，导致后续链条阻塞。
- 若存在 GS 请求，XPU 悲观认为总是有 hazard，并采用 in-order 处理。

### 6.2 L1 T0 R/W Hazard to DSM or L3

- RAW / WAR：等待 response 收回后，再发下一个请求。
- T0 Read Coalesce：若有读地址 A inflight，重新读地址 A 时，第二个读不会发到总线上，但会损耗 outstanding。这里的地址 A 指 128-byte 对齐地址。
- T0 Write Pipeline：若存在 `W0` 写地址 A inflight，后续 `W1, W2, W3, W4...` 也 inflight 且都是地址 A，则 `W1-W4` 起初不会 pipeline 发出；等待 `W0` write response 返回后，`W1-W4` 会 pipeline 发出。

### 6.3 RO 优化

- 64-bit 地址指针的 bit59 和 bit60 同时为 1 时，表示 RO 属性。
- 使用该属性后，XPU 和 L1 不再检查读请求地址 hazard，可避免 stall。

![Memory hazard diagram](meeting_ldst__figure_09_memory_hazard_diagram.jpg)

## 7. VLDEOA / VSTEOA 特殊加速

- Vector `stride = 0` load：转换为广播读操作，只读取一个元素并广播到 OACC。
- Vector `stride = 1` load：转换为 linear load。
- Vector `stride = 0` store：结果不可知，软件不应依赖该语义。
- Vector `stride = 1` store：转换为 linear store。
- Vector `stride > 1`：load 转换为 gather，store 转换为 scatter。
- Gather-scatter：
  - 无冲突时为 `32 element/C`。
  - 256 bank；关闭 shifting 时，`stride = 1KB` 没有 conflict。

## 8. T0 128-byte 不对齐访问

### 8.1 机制与影响

- 在 XPU-L1 接口上存在效率损失。
- XPU-L1 linear 访问拆分以 128B/64B 为单位。
- L1-L3 linear 访问拆分仍可受到 read coalesce 保护，但会损失部分 outstanding。

影响路径：

- 访问 L1：仍有带宽损失，但不明显。
- 访问 DSM：损失居中。
- 访问 L3：损失通常比 DSM 更大。
- 具体表现见后续 benchmark 图。

![T0 unaligned access diagram](meeting_ldst__figure_11_unaligned_access_diagram.jpg)

### 8.2 2D Store to L3 对比

该图是在 2D/1D pipeline 已经优化到较好状态下，对比 128-byte aligned 与 64B aligned 的 L3-L3 Dot 2D 利用率。

| Case | 128B align | 64B aligned |
| --- | ---: | ---: |
| fp16, `M1024_N1536_K12288` | 96.81% | 89.57% |
| fp16, `M1024_N6144_K12288` | 91.88% | 86.94% |
| fp8, `M1024_N1536_K12288` | 94.16% | 94.47% |
| fp8, `M1024_N6144_K12288` | 92.95% | 89.05% |
| fp16, `M1024_N3072_K12288` | 93.78% | 86.53% |
| fp16, `M12288_N6144_K128` | 82.25% | 62.05% |
| fp16, `M3072_N6144_K512` | 84.44% | 84.70% |
| fp16, `M3072_N3072_K1024` | 90.30% | 90.39% |
| fp16, `M3072_N1536_K2048` | 94.29% | 92.44% |
| fp16, `M1024_N1536_K6144` | 95.28% | 94.30% |

### 8.3 1D Store to L3

- Store 带宽较高的 case 受 128-byte 不对齐影响更明显。

![1D store to L3 chart](meeting_ldst__figure_13_1d_store_chart.jpg)

## 9. 访问 L3 的硬件带宽自我抑制功能

- 为避免 SIP 之间访问 L3 不均衡，硬件采用访问 L3 的主动带宽抑制机制。
- 针对 L3 访问，XPU 每 3 个 cycle 发一个 `256B` 请求，读写独立，等效带宽约为 `85B/C`。
- 计算关系：

```text
4 x 128 / 6 = 85B/C
```

- 该机制可自适应 DSM 与 L3 的不同带宽需求。
- 可以通过 scratch 关闭该机制。

![L3 bandwidth throttle table](meeting_ldst__figure_14_l3_throttle_table.jpg)
