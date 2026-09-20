> Imported material source: `Meeting/Markdown/General Compute 1D.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `General Compute 1D`.

# General Compute 1D

> Source PDF label: `General Compute 1D.pdf`
> 转换说明：本文按 PDF 页内容整理为正式 Markdown。可抽取文字已重排为标题、列表、表格和公式；正文已覆盖的纯文字页不再保留图片；必要的架构图、流程图和图表仅以裁剪图保留。

## 文档概览

本文介绍 SIP4.0 XPU 的 1D general compute 相关微架构视图，重点包括 XPU pipeline、S1-S4 各级职责、寄存器文件位置、1D 访存延迟与带宽，以及 2D-1D/SFU 调度关系。

## 1. XPU 抽象视图

XPU 抽象图展示了 XPU 与 CF NoC、Common CSR、L1、外部 CSR 以及内部 SLSB、SCF、SDMEM、S1-S4 等模块之间的连接关系。图中同时标出了若干请求/响应通路，例如 `xpu_df`、`xpu_cf`、`xpu_l1_ldro_*`、`xpu_l1_ldst_*`、VLD/VST/SLD/SST 相关接口等。

![XPU abstract view](meeting_general_compute_1d__figure_02_xpu_abstract.jpg)

## 2. SIP4.0 XPU Pipeline

SIP4.0 XPU pipeline 由以下阶段组成：

| Stage | 职责 |
| --- | --- |
| S1 | Inst Fetch |
| S2 | Scalar Scheduling |
| S3 | Vector Scheduling |
| S4 | Vector ALU |

相关性能规格参考：

- `SIP4.0_Pipeline_Info_for_Compiler.pdf`
- Non-RTO: wiki, Record 1, Record 2
- RTO: wiki, Record-3

![SIP4.0 XPU pipeline overview](meeting_general_compute_1d__figure_03_pipeline_overview.jpg)

## 3. S1-S4 分级视图

### S1 - Instruction Fetch

S1 负责指令获取与 L1 instruction cache 相关请求，图中展示了 S1-IPF、S1-L0-INST-RD、Inst L0 Tag、Inst L0 Buf、Decode，以及 L1 Inst Cache miss/request/response 等通路。

![S1 focused pipeline view](meeting_general_compute_1d__figure_04_s1_focus.jpg)

### S2 - Scalar Scheduling

S2 负责标量调度与标量相关寄存器访问，图中涉及 S2-PISQ、S2-RFRD、S2-RFC-RD、S2-ALUG、S2-RFC-WR、S2-LSE、SLSB 等模块。

![S2 focused pipeline view](meeting_general_compute_1d__figure_05_s2_focus.jpg)

### S3 - Vector Scheduling

S3 负责向量指令动态调度，图中涉及 PISQ、PreSplit、RNME、ROQ、PostSplit、Cache Tag、Cache Data，以及 VA/L0/L1 hazard 管理。

![S3 focused pipeline view](meeting_general_compute_1d__figure_06_s3_focus.jpg)

### S4 - Vector ALU

S4 负责向量指令执行，图中体现 VLIW packet、2D compute、1D compute、VLD/VST、2D MAC Path、1D MAC Path、Long-Move/Short-Move Path、VSTA Path，以及 XPU-L1-LDST 请求/响应接口。

![S4 focused pipeline view](meeting_general_compute_1d__figure_07_s4_focus.jpg)

## 4. Pipeline 简单抽象

- S1 + S2：向量指令产生器，目标是提升指令吞吐量。
- S3：向量指令动态调度层，负责管理 latency 和 outstanding。
- S4：向量指令执行层。

## 5. Register File 位置

| Register File / Register | 位置 |
| --- | --- |
| SR | S2 |
| TAR | S2 |
| VL | S2 |
| VA | S4 |
| VM | S4 |

关键建议与硬件优化点：

- 避免 `VA -> SR` 的 move；如有可能，优先使用 `SR -> VA` 的 move。
- 硬件优化覆盖：
  - 标量计算的 RAW。
  - Scalar-to-vector 的标量 RAW。

## 6. Memory for 1D

### 6.1 Latency

| 访问路径 | Load-to-use / Latency |
| --- | ---: |
| SR 访问 SDMEM | 8 cycle |
| VA 访问 VDMEM | 31 cycle |
| SR 访问 VDMEM | 51 cycle |
| 访问 SIP 内部寄存器，SCF bus write latency | 34 cycle |
| 访问 SIP 内部寄存器，SCF bus read latency | 42 cycle |
| 访问 CDTE 寄存器 | 100-136 cycle |

### 6.2 Bandwidth

| 访问路径 | 带宽 |
| --- | --- |
| SR 访问 SDMEM | `2 x 8 B/C` |
| VA 访问 VDMEM | `256B Rd + 256B Wr` |
| SR 访问 VDMEM | `8B/C` |
| CF 连续访问能力 | 可连续 128 个写、连续 32 个读 |

### 6.3 Turn-around Latency

```text
Turn-around Latency = L2U + RAW + WAR + Inst Cycle + 多线程竞争
                    = 31 + 13 + 6 + 32(unroll8 x 2op x 2time) + 竞争delta
                    = 82 + 竞争delta
```

如果计算次数很少，整体性能会更明显地受 latency 影响。

## 7. M 与 2D 标量占比、带宽关系

- 对于 GEMM `64 x 64 x 64`，每 32 个 cycle 产生一条 GEMM 指令。
- 因此，“多少个 cycle 生产一条 GEMM 指令”是关键性能问题。

## 8. 2D-1D 并行

- 最优化调度需要受软件空间的串行执行约束。
- 多个 sub-thread 均匀调度 1D 会增大 latency。
- Turn-around Latency 公式：

```text
Turn-around Latency = L2U + RAW + WAR + Inst Cycle + 多线程竞争
```

## 9. 2D-SFU 串行

- SFU 串联在 2D 之后执行，会与 2D 相互影响，主要体现在 L1 和 L0 latency 上。
- 这是下一代硬件应考虑优化的方向。
- 参考链接：
  - <http://wiki.enflame.cn/display/~chuang.feng/MLA-NoTranspose-Decode>
  - <http://wiki.enflame.cn/display/~chuang.feng/MLA-Transpose-Decode>
