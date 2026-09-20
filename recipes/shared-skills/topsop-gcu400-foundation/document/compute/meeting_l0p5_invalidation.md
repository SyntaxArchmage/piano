> Imported material source: `Meeting/Markdown/L0P5 Invalidation.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `L0P5 Invalidation`.

# L0P5 Invalidation

> Source PDF label: `L0P5 Invalidation.pdf`
> 转换说明：本文按 PDF 页内容整理为正式 Markdown。可抽取文字已重排为标题、列表、表格和公式；正文已覆盖的纯文字页不再保留图片；必要的架构图、流程图和图表仅以裁剪图保留。

## 文档概览

本文介绍 L0P5 cache 的 invalidation 需求、规格、workflow、Buf-ID 机制以及使用建议。核心结论是：硬件不直接维护 L0P5 与外部数据源之间的一致性，因此软件需要通过 Buf-ID 规划和同步后的 invalidation 策略保证正确性。

## 1. 抽象视图

XPU 抽象视图与 S3 抽象视图用于说明 L0P5 cache 位于向量调度与执行链路中的位置。相关图示保留如下。

![XPU abstract view](meeting_l0p5_invalidation__figure_02_xpu_abstract.jpg)

![S3 abstract view](meeting_l0p5_invalidation__figure_03_s3_abstract.jpg)

## 2. L0P5 Workflow

下图描述 S4 使用 L0P5 Cache 和 L0 RFC 的工作流程。整理后的步骤如下：

1. S2 将 CISC GEMM 指令发送到 S3，进入 PreSplit Unit。
2. PreSplit Unit 将 CISC GEMM MLI 拆解为 CISC VMM，并发送到 Cache Tag 查询。
3. Cache Tag 判断 SMR 和 IV 是否已存在：
   - 若 SMR 不在 L0 RFC，也不在 L0P5 Cache Tag 中，则分配 cacheline，并将 VLD-SMR 请求发送到后级 ROQ。
   - 若 IV 不在 L0P5 Cache Tag 中，则分配 cacheline，并将 VLD-IV 请求发送到后级 ROQ。
4. VLD-SMR 与 VLD-IV 请求在 ROQ 中满足发射条件后，由 ROQ 发送到 Cache Data，再发送到 XPU-L1 请求接口。
5. L1 返回读数据后，数据写入 L0P5 Cache Data 存储空间。
6. ROQ 发送 MOVSMR 操作，将 SMR 数据从 L0P5 Cache Data 搬运到 L0 SMR RFC 中；该通路复用原先从 L1 直接 load 回 S4 SMR 的接口。
7. ROQ 发送完 MOVSMR 后，继续发送 VMM 指令到后级。
8. VMM 指令从 L0P5 Cache Data 中读出 IV，完成必要的数据整形，并把算法所需的 IV 数据作为 VMM 指令的一部分发往 S4 执行。对 S4 来说，SMR 和 IV 数据来源可以是 L0P5 Cache，也可以是 L1 直接灌入。

后续来自 S2 的 CISC 指令会走类似流程。若后续查询 L0P5 Cache Tag 和 L0 SMR RFC Tag 时发现 cache hit，则可省略重复搬运，节省带宽。

![L0P5 workflow diagram](meeting_l0p5_invalidation__figure_04_workflow.jpg)

## 3. L0P5 规格

### 3.1 Capacity

| 组件 | 容量 | 分配粒度 |
| --- | ---: | --- |
| IV | `320 line x 128byte = 40KB` | 按 line 分配 |
| SMR | `52 slice x 32 x 128byte = 208KB` | 按 slice 分配 |

补充说明：容量由所有 sub-threads 共享。

### 3.2 Bandwidth

| 方向 | 带宽 |
| --- | --- |
| L1 -> L0P5 | IV `256B/C`，SMR `256B/C` |
| DSM 无亲和 -> L0P5 | `230B/C-250B/C`，IV/SMR 共享 |
| L0P5 -> L0 | IV `2 vector/C`，SMR `256B/C`，约 `18 cycle per matrix` |

### 3.3 Latency

| 方向 | Latency |
| --- | ---: |
| L1 -> L0P5 | `~20 cycle` |
| DSM 无亲和 -> L0P5 | `110-150 cycle` |

## 4. Invalidation 需求：硬件不直接维护一致性

L0P5 cache 的一致性需要软件显式管理。页面中的 operator code 说明了以下约束：

- 数据流上，指令流与 DMA 需要同步；DMA 将数据从 HBM 搬运到 core 外存储。
- Core 同步后，core 外的 slice 数据进入私有 cache。
- DMA 与 core 需要正确使用 buffer 与 slice 切片；数据交互带宽较高。
- 图中红色路径代表进入数据流的关键路径。
- 每次同步通常代表可能有新的数据切片进入 core 外存储的 pipeline buffer，core 内 cache 中相关内容需要根据数据生产/消费关系进行 invalidation。
- 在 L2 缓存与 NoC 不支持一致性的场景下，需要由计算与 cache maintenance 机制共同保证一致性；关键是定义数据生产方、消费方以及数据复用优先级，避免 cache 不一致。

![L0P5 consistency management flow](meeting_l0p5_invalidation__figure_06_consistency_flow.jpg)

## 5. Buf-ID 的硬件工作方式

### 5.1 `MLI_HINT_GEMM` 对 Buf-ID 的支持

`MLI_HINT_GEMM` 的 `Rs1` 字段用于表达 footprint order 和 LHS/RHS 的 Buf-ID：

| 字段 | 含义 |
| --- | --- |
| `Rs1[15:0]` | `footprint_order`，用于 GEMM FP scheduling |
| `Rs1[23:16]` | RHS 来自 memory 而非 register 时使用的 `buf_id` |
| `Rs1[31:24]` | LHS 来自 memory 而非 register 时使用的 `buf_id` |

上述 LHS/RHS 的 `buf_id` 会在 LDST-Hint 中被使用。

### 5.2 `L0P5_INV`

指令形式：

```text
L0P5_INV(buf_id, invcnt)
```

参数语义：

- `buf_id`：对某个 `buf_id` 对应的空间执行 invalidation。
- `invcnt`：表示一个 kernel 内同一 `buf_id` 预计联合/独立执行 invalidation 的次数。对连续 `count` 条相同 `buf_id/count` 的 `L0P5_INV`，硬件只在初始化 counter 的那一条真实执行 invalidation，其余相同参数指令只递减 counter。

`invcnt` 规则：

- Cache 内每一块支持 256 个 `buf_id`，每个 ID 维护一个 counter 资源。
- 若发出 `L0P5_INV(buf_id, 0)`，该指令不执行 invalidation，仅清零该 `buf_id` 对应的 counter。
- 若发出 `L0P5_INV(buf_id, N)`，表示该 `buf_id` 对应空间预计需要执行 `N` 次 invalidation；这条指令即为第一次 invalidation。

L0P5 Cache 为每个 `buf_id` 维护两个 counter：

- `total_num_cnt`
- `cur_num_cnt`

典型行为：

1. 每次收到 `L0P5_INV`，L0P5 Cache 检查该 `buf_id` 的两个 counter 是否为 0；默认均为 0 时表示该 `buf_id` 的 invalidation counter 无效。
2. 在无效状态下收到 `L0P5_INV` 时，L0P5 Cache 初始化 counter，设置 `total_num_cnt`，执行一次 invalidation，并将 `cur_num_cnt` 设置为 `total_num - 1`。
3. 后续收到来自其他消费者的相同 `buf_id/count` invalidation 指令时，若 `count` 与当前 `total_num_cnt` 一致，则递减 `cur_num_cnt`，跳过重复 invalidation。
4. 若后续相同 `buf_id` 的 `count` 与当前记录不一致，则视为对该 ID 的重新初始化，同时初始化 `total_num_cnt` 与 `cur_num_cnt`。
5. 当 `cur_num_cnt` 减到 0，且 `total_num_cnt` 也归零时，counter 被释放。
6. 在每次执行一个 `buf_id` 的非初始化动作后，不需要再次清零；Cache 只需针对 invalidation 执行操作。

### 5.3 下发时机

当 INV 指令下发到硬件时，L0P5 Cache 中相同 `buf_id` 的指令应是同一轮次、与 DTE 搬运数据对应的计算指令，而不是下一轮计算指令。若上一轮计算尚未结束，DMA 同步不应结束，INV 也不应下发。

## 6. Buf-ID 与 Invalidation 的简单使用方法

### 6.1 ID 规划

- `id11-id255` 可用，共 245 个 ID。
- 示例：使用 128 个 ID，并由 2 个 kernel slot 各使用一半。
  - Kernel slot 0 使用前 64 个。
  - Kernel slot 1 使用后 64 个。
- Buf-ID 可直接与 ping-pong buffer 绑定。
  - LHS：3-stage buffer 使用 3 个 Buf-ID。
  - RHS：3-stage buffer 使用 3 个 Buf-ID。
- 不同的数据生产/消费关系应使用不同 ID 隔离。
  - `DTE -> Buf -> SIP`
  - `SIP Store -> Buf -> SIP`

### 6.2 同步后的 invalidation 原则

核心原则：同步后，第一次读前 invalidate，不要每次读都 invalidate。

Buf-ID 分配建议：

- `id0` reserved，不允许使用。
- `id1-id10` reserved；10 个 subthread 每个 reserve 一个 `buf_id`。
- 建议 DSM 上分配的不同 buffer 使用不同 `buf_id`。
- 多 kernel slot 间需要一个分配算法，保证 kernel slot 间 `buf_id` 不同。
- 前后 kernel 之间可以复用 `buf_id` 资源。

`L0P5_INV` 时机建议：

- Kernel 启动后，需要对该 kernel 使用的 `buf_id` 做 invalidation，否则上一个 kernel 的数据可能残留在 L0P5 中。
- `buf_id` 对应的 buffer 数据更新后，例如 DTE 搬运新数据覆盖了 buffer，应在读取新数据前对该 `buf_id` 执行 invalidation。

![L0P5 invalidation code example](meeting_l0p5_invalidation__figure_09_code.jpg)
