> Imported material source: `Meeting/Markdown/Performance Quantitative Analysis.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `Performance Quantitative Analysis`.

# Performance Quantitative Analysis

> Source PDF label: `Performance Quantitative Analysis.pdf`
> 转换说明：本文按 PDF 页内容整理为正式 Markdown。可抽取文字已重排为标题、列表、表格和公式；正文已覆盖的纯文字页不再保留图片；必要的架构图、流程图和图表仅以裁剪图保留。

## 文档概览

本文围绕 SIP4.0 性能定量分析展开，包括 DSM/Cluster 介绍、数据延迟、数据带宽、GEMM/Conv 带宽模型，以及实际性能估计中的 leading/tailing 与控制开销。

## 1. Overview

- DSM/Cluster 介绍。
- Perf Analysis：
  - Data Latency。
  - Data Bandwidth。
  - Op Cost Model。

## 2. Cluster

参考链接：

- <http://git.enflame.cn/arch4.0/arch4.0/-/blob/master/soc/Compute/Libra-DTU-Compute.pub.md>

## 3. Data Latency

### 3.1 基础延迟与带宽

| 访问路径 | Load-to-use / Latency | 带宽 |
| --- | ---: | --- |
| SR 访问 SDMEM | 8 cycle | `2 x 8 B/C` |
| VA 访问 VDMEM | 31 cycle | `256B Rd + 256B Wr` |
| SR 访问 VDMEM | 51 cycle | `8B/C` |
| 访问 SIP 内部寄存器，SCF bus write latency | 34 cycle | - |
| 访问 SIP 内部寄存器，SCF bus read latency | 42 cycle | - |
| 访问 CDTE 寄存器 | 100-136 cycle | - |
| CF 访问 | - | 可连续 128 个写、连续 32 个读 |

### 3.2 Turn-around Latency

```text
Turn-around Latency = L2U + RAW + WAR + Inst Cycle + 多线程竞争
                    = 31 + 13 + 6 + 32(unroll8 x 2op x 2time) + 竞争delta
                    = 82 + 竞争delta
```

如果计算次数很少，性能会更明显地受 latency 影响。

![Data latency timeline diagram](meeting_performance_quantitative_analysis__figure_05_latency_timeline.jpg)

## 4. Data Bandwidth - 2D

### 4.1 GEMM 带宽模型

定义：

```text
计算时间 = M * N * K / MAC
Input Feature size = M * K * BPE
Output Feature size = M * N * BPE
Input Weight size = N * K * BPE
```

推导：

```text
Feature 输入带宽 = Input Feature size / 计算时间 = MAC * BPE / N
Weight 输入带宽  = Input Weight size / 计算时间  = MAC * BPE / M
Feature 输出带宽 = Output Feature size / 计算时间 = MAC * BPE / K
```

### 4.2 Conv 带宽模型

定义：

```text
计算时间 = N * H * W * Ci * Co * R * S / MAC
Input Feature size = N * H * Stride_Y * W * Stride_X * Ci * BPE
Output Feature size = N * H * W * Co * BPE
Input Weight size = Ci * Co * R * S * BPE
```

推导：

```text
Feature 输入带宽 = MAC * BPE * (Stride_X * Stride_Y) / (Co * R * S)
Feature 输出带宽 = MAC * BPE / (Ci * R * S)
Weight 输入带宽  = MAC * BPE / (N * H * W)
```

## 5. GEMM 带宽实例

在示例页中，GEMM 带宽模型进一步写为：

```text
Feature 输入带宽 = MAC * BPE / N = 8192 / N
Weight 输入带宽  = MAC * BPE / M = 8192 / M
Feature 输出带宽 = MAC * BPE / K = 8192 / K * 4
```

实例：`M = 32, N = 128`。

| 指标 | 计算 | 结论 |
| --- | --- | --- |
| Feature_BW | `8192 / 128 = 64B/C` | 小于 DSM 规格 `230-250B/C`，Feature 带宽不是瓶颈 |
| Weight_BW | `8192 / 32 = 256B/C` | 大于 DSM 规格 `230-250B/C`，Weight 带宽是瓶颈 |
| F + W 总带宽 | `320B/C` | `230 / 320 = 71%`，仅从带宽规格看，输入在 DSM 时利用率不会超过 71% |

访存 leading 与 tailing 会进一步降低部分效率，但多重循环应能隐藏一部分开销。

## 6. 实际性能估计

- 4C skew：可按 `1us` 估计。
- SIP-Skew + Kernel boot：由 supervisor hide。
- Kernel Start：由算子控制。
- DTE leading time：受 DTE task 切分、数据流调度影响。
- L1/DSM leading、tailing：受硬件 latency 与 IV/SMR 计算 size 影响。
- 核心循环中无法统一优化的部分需要 case-by-case 分析。

![Performance estimation timeline diagram](meeting_performance_quantitative_analysis__figure_08_performance_timeline.jpg)
