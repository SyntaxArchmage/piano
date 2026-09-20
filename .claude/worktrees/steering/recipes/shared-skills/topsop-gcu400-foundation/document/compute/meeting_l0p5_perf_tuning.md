> Imported material source: `Meeting/Markdown/L0P5 Perf Tuning.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `L0P5 Perf Tuning`.

# L0P5 Perf Tuning

> Source PDF label: `L0P5 Perf Tuning.pdf`
> 转换说明：本文按 PDF 页内容整理为正式 Markdown。可抽取文字已重排为标题、列表、表格和公式；正文已覆盖的纯文字页不再保留图片；必要的架构图、流程图和图表仅以裁剪图保留。

## 文档概览

本文聚焦 L0P5 cache 对性能调优的影响，涵盖向量 scheduling pipeline、SMR/IV cache structure、cache miss sequence、cache 复用、footprint 粒度分析，以及标量指令带宽控制策略。

## 1. 抽象视图

XPU 抽象视图与 S3 抽象视图用于给出 L0P5 所在的微架构上下文。

![XPU abstract view](meeting_l0p5_perf_tuning__figure_02_xpu_abstract.jpg)

![S3 abstract view](meeting_l0p5_perf_tuning__figure_03_s3_abstract.jpg)

## 2. Vector Scheduling Pipeline More Details

- GEMM 指令从 S2 以多 sub-thread 方式发送给 S3 PISQ。
- GEMM 指令被拆解为连续多条 VMM2，从 RNME 到 ROQ 以 in-order 方式执行。
- 每条 VMM2 的 RHS SMR 相同，因此在第一条 VMM2 时形成 LDSMR 的 MLI，并在 Post-Split 被拆为 LLI。
- 每条 VMM2 的 LHS 可能不同，因此会串行生成 `LD_IV` 的 LLI。
- 每条 VMM2 更新 tag table 后，后续指令都会查询到新的结果。

![Vector scheduling pipeline diagram](meeting_l0p5_perf_tuning__figure_04_scheduling_pipeline.jpg)

## 3. SMR Cache Structure

SMR Cache 采用 52 个 slice，并按照 L1 的 layout 组织。

### 3.1 Slice Based Tag Management

在 FP16 格式的 `32 x 64` 矩阵，且 128B 对齐访存的场景下，输入原始数据在内存中可能为起始地址对齐、stride 对齐，并且相邻矩阵没有 overlap。此时 L0P5 Cache 的作用是将内存中有间隔的多片 tensor 数据聚合到 L0P5 data 中，实现“一次分配、一次查找”，并以矩阵或 slice 为单位管理。

基于矩阵或 slice 的数据复用管理，可以用较低 PPA 成本支持非对称 VMM 计算中的 caching。

![SMR slice based tag management diagram](meeting_l0p5_perf_tuning__figure_05_smr_slice_tag.jpg)

### 3.2 Decouple Matrix Size with Bus Width

在 INT8/FP8 格式的矩阵且仅支持 64B 对齐时，矩阵访问以 64B 为单位，而总线宽度为 128B。L0P5 Cache 可以把总线接口上取回的、未来要使用的数据保存起来，避免每次浪费 50% 带宽。

![SMR bus width decoupling diagram](meeting_l0p5_perf_tuning__figure_06_smr_bus_width.jpg)

### 3.3 Per Row Dynamic Addressing Based Slice Cache

当访问数据的起始地址不对齐时，L0P5 仍可用类似矩阵 slice 的视角进行行地址计算和选择性加载，将尽可能紧凑的矩阵存储地址空间缓存起来，同时在行方向提升复用度。

多行尺寸延伸同样长度，可以保持并扩展 slice 视角。

![SMR dynamic addressing diagram](meeting_l0p5_perf_tuning__figure_07_smr_dynamic_addressing.jpg)

### 3.4 Dynamic Matrix Storage Allocation Size with Pure Address-based Tagging

该策略不仅考虑单次 MLI_GEMM 内的数据复用，也考虑原始矩阵每一行在行方向上的延伸。通过基于纯粹地址的 tagging，可让多个 MLI_GEMM 之间共享全部或部分数据。

例如，当多个矩阵在水平方向有 overlap 但不是完全相同地址区域时，可以像传统地址 cache 一样，在多条指令之间按较松散的 overlap 关系复用矩阵寻址空间，而不是只有矩阵参数完全相等时才进行精确复用。

![SMR address based tagging diagram](meeting_l0p5_perf_tuning__figure_08_smr_address_tagging.jpg)

### 3.5 Adaptive Storage Format Selection for Small Matrix

当矩阵行间距很小，甚至小于行长，直接采用 slice 视角可能造成较大重复浪费。此时可以直接采用大块连续存储，以减少 cacheline 使用与重复缓存。

![SMR small matrix storage format diagram](meeting_l0p5_perf_tuning__figure_09_smr_small_matrix.jpg)

## 4. IV Cache Structure

IV Cache 的组织为：

```text
128 byte line x 16 set x 20 way
```

关键规则：

- IV Cache 可被管理为 `16 set x N way` 的 cache；具体 way 数取决于 storage region 中定义多少行属于 IV。
- 为了让一个 set 内分配最多 4 个 line，1 个 32-way set 被划分为 4 个 subset。
- 分配 cacheline 时，1 个 cycle 只能在 1 个 subset 中最多找 1 个 cacheline；4 个 subset 最多找 4 个 line。
- subset 不改变存储 set/way 的组相连映射；在一个 set 中，所有 way 做 tag 查询时仍是组相连，但 cache 分配按 sub-set 进行。
- 每个 subset 中，各 way 按 LRU 排队算法选择 victim。
- 每个 cycle 最多分配 4 个 cacheline 给 2D，1 个 cacheline 给 1D。
- 1D cacheline 只会在没有 2D cacheline hit 的 set 中分配。

![IV cache layout diagram](meeting_l0p5_perf_tuning__figure_10_iv_cache_layout.jpg)

## 5. Cache Miss Sequence

- Cache miss sequence 以 VMM2 为单位处理，因此可能出现一支 hit、一支 miss 的情况。
- 微指令不会跨 GEMM 发出。
- 在不引起 cache 颠簸的前提下，应尽早 trigger cache miss，从而尽早 trigger cache refill。

![Cache miss sequence diagram](meeting_l0p5_perf_tuning__figure_11_cache_miss_sequence.jpg)

## 6. Cache 复用

- IV 的单位是 `128 x 1`。
- SMR slice 的单位是 `128 x 32`。

![Cache reuse diagram](meeting_l0p5_perf_tuning__figure_12_cache_reuse.jpg)

## 7. Footprint：以更大颗粒度看待数据

以下以 FP8、K-major 为例。

| Case | 计算时间 | IV Cache 支持 | SMR Cache 支持 |
| --- | ---: | --- | --- |
| `64 x 128 x 128` | 128 cycle | 5 个 LHS `[64, 128]` | 3 个 RHS `[128, 128]` |
| `64 x 64 x 128` | 64 cycle | 5 个 LHS `[64, 128]` | 6 个 RHS `[64, 128]` |
| `64 x 64 x 64` | 32 cycle | 10 个 LHS `[64, 64]` | 12 个 RHS `[64, 64]` |

控制手段：

- 控制手段 1：类似 primo++，使用 Mailbox。
- 控制手段 2：Footprint Order。
  - 余数 skip 的部分可以利用 real size 的特点发出一个空计算给 S3，使 order 生成算法不受余数影响。

![Footprint order sketch](meeting_l0p5_perf_tuning__figure_13_footprint_sketch.jpg)

## 8. 控制标量指令带宽

同样以 FP8、K-major 为例：

| Case | 计算时间 | IV Cache 支持 | SMR Cache 支持 |
| --- | ---: | --- | --- |
| `64 x 128 x 128` | 128 cycle | 5 个 LHS `[64, 128]` | 3 个 RHS `[128, 128]` |
| `64 x 64 x 128` | 64 cycle | 5 个 LHS `[64, 128]` | 6 个 RHS `[64, 128]` |
| `64 x 64 x 64` | 32 cycle | 10 个 LHS `[64, 64]` | 12 个 RHS `[64, 64]` |

关键问题与建议：

- 底层计算指令为 `64 x 64 x 64`，计算时间为 32 cycle。
- 需要关注标量多少个 cycle 生成一条 2D 指令。
- 应避免重复设定 SPR 的 real-size、buf-id 等字段，尤其是在没有动态性需求时。

![Scalar bandwidth footprint sketch](meeting_l0p5_perf_tuning__figure_14_scalar_bandwidth_sketch.jpg)
