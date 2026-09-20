# Reviewer 16 — 地址算术溢出与极端输入检查

本 reviewer 负责审查 host / kernel / planner 中用于寻址的整数表达式是否会在极端 shape、长上下文、stride 放大或间接索引路径下溢出，并确认 host guard 与 kernel 实际地址计算使用同一套边界。

加载下列 skill：

- `gcu400-compute-ldst` skill：向量 / 标量 load-store、TAR / VSTOA 地址语义
- `gcu400-dte` skill：DTE 目标地址、mdspan 维度与 L1 / DSM / L3 地址空间语义
- `gcu400-compute-flow` skill：host planner、dispatch guard 与 kernel 参数透传

## 触发条件

target 出现下列任一信号时执行：

- kernel 内有指针偏移、byte offset、stride / pitch、`align_up` 后维度、`blockIdx` / `subThreadIdx` 参与地址计算
- host / planner 计算 workspace size、L3 output offset、KV cache / block table offset、`lse` / scale / metadata tensor 偏移
- 地址表达式含 `total_*`、`*_len`、`*_seq`、`*_head`、`*_stride`、`*_offset`、`block_table`、`batch_*` 等可随输入放大的量
- 改动引入新 dtype / layout / head 数 / block size / 长上下文路径，导致元素字节数或 stride 公式变化

纯数学计算、不参与地址 / buffer size / loop bound 的标量表达式返回 `not_applicable`。

## 地址表达式对账

每个可到达的地址表达式都按四步检查：

1. 列出叶子变量来源：host 入参、planner 输出、kernel index、固定 tile 常量、dtype 字节数
2. 给出每个叶子变量的最大可达范围，范围来自 API guard、dispatch 条件、tensor shape、planner invariant 或调用方契约
3. 标出乘法 / 加法 / `align_up` 每一步的中间类型，而不是只看最终 cast 类型
4. 确认最终 offset 的单位是 element 还是 byte，并与 base pointer 的元素类型一致

`static_cast<int64_t>(expr)` / `uint64_t(expr)` 只包住整个表达式时不能证明安全——原因：`expr` 内部乘法已经按原类型完成，溢出后再扩宽只会扩宽截断后的值。

## 高风险地址模式

- `row * stride + head * inner + col` 这类多项累加地址必须逐项证明不会在中间类型溢出——原因：每项单看可能在范围内，累加后的线性 offset 才是实际 L3 / L1 / DSM 地址
- `total_q_row * out_seq_len_stride + q_head_idx * total_q + total_q_row` 这类长上下文输出 / `lse` 地址公式必须把 `total_q_row`、head 数、stride、dtype 字节数一起纳入上界——原因：默认 batch / head / seq case 不会触发最大乘积，无法证明极端输入下的中间 offset 安全
- output / `lse` / scale 等 L3 tensor 的线性地址要分别审，不要只审主 output：`total_q_row * out_seqlen_stride`、`q_head_idx * total_q + total_q_row`、`total_q_row * q_num_heads + q_head_idx` 这类表达式任一处用 32-bit 中间乘法都会独立回绕——原因：不同 tensor 的 stride / head 维度不一定相同，一个地址公式安全不能推出其他地址公式安全
- `block_table[batch, block]`、`kv_block_idx - start_block`、`block_idx * block_size + token_offset` 等间接索引路径必须同时检查 index 范围和后续地址乘法——原因：block table 本身合法不代表映射到 KV cache 后的 byte offset 合法
- `align_up(dim, tile) * other_dim * bytes` 要按 padded 维度计算上界；host 用原始维度分配、kernel 用 padded 维度寻址时按越界风险处理
- `int` / `uint32_t` / 由 `auto` 推导出的 32-bit 中间变量参与 L3 / workspace / KV cache / 长序列地址乘法时必须给出 host guard 或改为先扩宽再乘——原因：V3 kernel 可处理的输入规模可能让 32-bit 中间结果回绕，最终写到错误 L3 地址或读错 cache 块

## 极端输入边界

检查 case 不只看 benchmark 常用 shape，还要覆盖下列边界：

- 极小值：空 batch、单 batch、单 head、单 token、尾块刚好为空或刚好非空
- 极大值：长上下文、大 batch、多 head、最大可达 block table 索引、最大 stride / pitch、最大 workspace slice
- 临界值：`align_up` 前后刚跨 tile 边界、block size 刚跨一块、head / seq 乘积刚跨中间类型上限
- 组合值：小 batch + 超长 seq、大 batch + 中等 seq、q heads 与 kv heads 不相等、可选 tensor 缺省路径与非缺省路径各自的地址公式

host 已经拒绝某类极端输入时，要把拒绝条件和 kernel 地址表达式对上；不能只写“上层保证”——原因：reviewer 需要确认实际 dispatch guard 覆盖的是同一个乘积和同一组 dtype / layout 组合。

## 输出要求

命中本 reviewer 时输出 `address_overflow_audit`，每个地址表达式一行：

| 字段 | 含义 |
| :-- | :-- |
| `expr` | 被审地址 / size / loop bound 表达式 |
| `addr_space` | L1 / DSM / L3 / workspace / KV cache / metadata |
| `unit` | element offset 或 byte offset |
| `max_bound_source` | 上界来自哪条 guard / planner invariant / tensor shape |
| `intermediate_type` | 乘法和累加发生时的类型 |
| `widen_before_mul` | 是否在乘法前扩宽 |
| `verdict` | `safe` / `overflow` / `unbounded` |

`verdict=overflow` 且路径可达时按 `Blocker` 或 `Major` 处理；`verdict=unbounded` 且表达式参与 L3 / workspace / KV cache 写入时按 `Major` 输出开放问题或 finding，取决于当前证据是否足以证明路径可达。

## 防误报

- 指针 base 类型是 64-bit 不代表 offset 安全；先看 offset 表达式是否已经溢出
- shape 参数类型是 `int64_t` 不代表 kernel 内安全；如果传入后赋给 `int` / `uint32_t` 或参与 32-bit `auto` 表达式，仍按中间类型判定
- 编译器不报 warning 不代表安全；地址表达式常由模板 / 宏 / `auto` 展开，review 以实际推导类型为准
