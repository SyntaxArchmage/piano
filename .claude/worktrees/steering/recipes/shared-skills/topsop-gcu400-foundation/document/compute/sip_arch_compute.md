# SIP4.0 算力配置 Reference

> 本文只保留算子估算 cycle 上界用得到的算力锚点表,SIP 顶层模块 / AXI 接口 / SIP Lite / ISA4.0 feature 总览等架构面叙述不在本文范围。

## 1. 算力配置表

> 对于 FP32/FP16/BF16/(U)INT8 格式,支持 1D MAC 指令,算力归属于 Element-Wise 的算力。

下表给出单 SIP4.0 算力配置和单个 sub-thread 所能占有的资源,所有数值单位为 ops/cycle(除 RF Size 外)。

| Features | HW thread | Scorpio 兼容 sub-thread(2VPT) | 新 sub-thread |
|---|---|---|---|
| FP32 2D MAC / HW thread | 1024 | 1024 | 1024 |
| EF32-2 2D MAC / HW thread | 4096 | 4096 | 4096 |
| FP16 2D MAC / HW thread | 4096 | 4096 | 4096 |
| BF16 2D MAC / HW thread | 4096 | 4096 | 4096 |
| INT8 2D MAC / HW thread | 8192 | 8192 | 8192 |
| FP8 2D MAC / HW thread | 8192 | 8192 | 8192 |
| FP32 1D Element-Wise / HW thread | 128 | 128 | 128 |
| FP16/BF16 1D Element-Wise / HW thread | 256 | 256 | 256 |
| FP8 1D Element-Wise (FCLASS) / HW thread | 256 | 256 | 256 |
| FP8 1D Element-Wise (CVT) / HW thread | 按照输入格式计算 | 按照输入格式计算 | 按照输入格式计算 |
| INT64 1D Element-Wise / HW thread | 64 | 64 | 64 |
| INT32 1D Element-Wise / HW thread | 64 | 64 | 64 |
| INT32 1D Element-Wise (Other Instruction) / HW thread | 128 | 128 | 128 |
| INT16 Element-Wise / HW thread | 256 | 256 | 256 |
| INT8 Element-Wise (Includ 1D FMA) / HW thread | 512 | 512 | 512 |
| 混精 INT32 \*/+ F32 1D Element-Wise / HW thread | 128 | 128 | 128 |
| 混精 FP16(BF16) \*/+ F32 1D Element-Wise / HW thread | 128 | 128 | 128 |
| 混精 INT8 \*/+ FP32 1D Element-Wise / HW thread | 128 | 128 | 128 |
| 混精 INT8 \*/+ FP16 1D Element-Wise / HW thread | 256 | 256 | 256 |
| 混精 INT8 + INT8 -> INT32 1D Wise / HW thread | 128 | 128 | 128 |
| 混精 INT32\*INT32 -> INT64 1D Element-Wise / HW thread | 64 | 64 | 64 |
| 非混精 FP32\*F32+F32 -> F32 1D FMA / HW thread | 128 | 128 | 128 |
| 混精 FP16(BF16) \* FP16(BF16) + FP32 -> FP32 1D FMA / HW thread | 128 | 128 | 128 |
| 混精 FP16(BF16) \* F32 + FP32 -> FP32 1D FMA / HW thread | 128 | 128 | 128 |
| 混精 INT8 \* INT8 + INT32 -> INT32 1D FMA / HW thread | 128 | 128 | 128 |
| 混精 INT8 \* FP32 + FP32 -> FP32 1D MAC / HW thread | 128 | 128 | 128 |
| 混精 INT8 \* FP16(BF16) + FP16(BF16) -> FP16(BF16) 1D MAC / HW thread | 256 | 256 | 256 |
| FP32 SFU / HW thread | 32 | 32 | 32 |
| L0 VA Register File Size / HW thread | 6144 x 512bit | 最大 3072 x 512bit x 2VPT | 最大 6144 x 512bit |

## 2. 算子开发关键算力锚点

按 1 个 HW thread 折算的常用算力,数据均来自上表字面,供算子估算 cycle 上界使用。

- **FP32 1D Element-Wise** = 128 ops/cycle
- **FP16/BF16 1D Element-Wise** = 256 ops/cycle
- **FP32 SFU** = 32 ops/cycle(SFU 与 1D 计算吞吐字面比为 1:4)
- **FP32 2D MAC** = 1024 ops/cycle
- **FP16/BF16 2D MAC** = 4096 ops/cycle
- **FP8 / INT8 2D MAC** = 8192 ops/cycle
- **L0 VA Register File** = 6144 × 512bit / sub-thread
