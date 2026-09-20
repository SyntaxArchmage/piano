# L0P5 Invalidation

L0P5 是 SIP 内 S3 流水段的 GEMM 输入 cache。物理 SRAM 256 KB(SIP Arch SPEC),软件可分配区由 IV(40 KB,按 line 分配)与 SMR(48 KB,按 slice 分配)两块组成,所有 sub-thread 共享。**硬件不维护 L0P5 与 DTE/DMA 写之间的一致性**——DTE 把新数据写到 L1 buffer 之后,如果 L0P5 已经缓存过该 buffer 的旧 cacheline,SIP 计算流水仍会从 L0P5 读到陈旧数据,必须由软件显式 `l0p5_inv` 失效掉对应 buf_id。

---

## 1. 算子可见的 L0P5 行为

L0P5 是 SIP 内 S3 流水段的 GEMM 输入 cache,位于 PreSplit 与 ROQ 之间。算子层面对它的主要观察:

- L0P5 命中时硬件自动跳过 L1 → L0 的搬运,显著降低 GEMM 流水的 L1 带宽消耗;
- L0P5 miss 时 PreSplit 推送的 VMM2 必须等 L1 数据回填完成才能进入 ROQ,造成流水线 stall;
- L0P5 与 DTE / DMA 之间没有硬件 cache coherence——下一节解释为什么必须软件 invalidate。

---

## 2. L0P5 规格

| 属性 | IV | SMR |
| :-- | :-- | :-- |
| Capacity | 320 line × 128 byte = 40 KB,按 line 分配 | 12 slice × 32 × 128 byte = 48 KB,按 slice 分配 |
| Sharing | 所有 sub-thread 共享 | 所有 sub-thread 共享 |

### 带宽

| 路径 | IV | SMR |
| :-- | :-- | :-- |
| L1 → L0P5 | 256 B/cycle | 256 B/cycle |
| DSM 无亲和 → L0P5 | 230~250 B/cycle (IV / SMR 共享通道) | 同左 |
| L0P5 → L0 | IV 2 vector/cycle | SMR 256 B/cycle (18 cycle per matrix) |

### Latency

| 路径 | Latency |
| :-- | :-- |
| L1 → L0P5 | ~20 cycle |
| DSM 无亲和 → L0P5 | 110~150 cycle |

---

## 3. 为什么需要 L0P5 INV:硬件不直接维护一致性

DTE / DMA 把新数据写到 L1 buffer 后,L0P5 cache 中针对该 buffer 的旧 cacheline 不会自动失效——L0P5 与下游访问者之间没有硬件 coherence 协议。SIP 计算流水从 L0P5 读时仍可能拿到陈旧数据,必须由软件按 buf_id 显式 `L0P5_INV` 失效。

---

## 4. Buf-ID 硬件工作方式

### 4.1 MLI_HINT_GEMM 对 Buf-ID 的支持

MLI_HINT_GEMM 的 Rs1 解析:

| Rs1 字段 | 含义 |
| :-- | :-- |
| Rs1[15:0] | `footprint_order`,用于 GEMM FP scheduling |
| Rs1[23:16] | `buf_id` for RHS,如果 RHS 来自 memory 而不是 register |
| Rs1[31:24] | `buf_id` for LHS,如果 RHS 来自 memory 而不是 register |

上述 LHS / RHS 的 `buf_id` 在 LDST-Hint 中也会被使用。

### 4.2 L0P5_INV(buf_id, invcnt)

`L0P5_INV` 指令的两个参数语义:

- **buf_id**:对某个 buf_id 对应的空间做 invalidation。
- **invcnt**:表示 1 个 Kernel 内联合会做的 invalidation 次数;硬件把从这条指令开始的后续 N 次相同参数的 invalidation 当成 1 次 invalidation。相同参数代表 buf_id 和 invcnt 都相同。
  - **A**:Cache 内部一共支持 256 个 `buf_id`,每个 ID 维护着一套 counter 资源。
  - **B**:如果发下来一个 `L0P5_INV(buf_id, 0)`,那么这个指令不做 invalidation,只是把这个 buf_id 对应的 counter 清 0。
  - **C**:如果发下来一个 `L0P5_INV(buf_id, N)`,那代表对这个 buf_id 对应的空间预计做 N 次 invalidation。本条指令是第一次 Invalidation。

### 4.3 L0P5 Counter 状态机(每个 buf_id 维护两组计数器)

L0P5 Cache 里为每一个 `buf_id` 维护 `total_num_cnt` 与 `cur_num_cnt` 两组计数器,行为:

> A. 每次收到这个 `L0P5_INV` 指令,L0P5 Cache 检查这个 `buf_id` 的 `total_num_cnt` 和 `cur_num_cnt` 是否为 0,默认是全为 0。**全为 0 表达这个 buf_id 的 invalidation counter 是无效状态**。
>
> B. 在无效状态下,收到一个 `L0P5_INV` 指令,L0P5 Cache 会开始初始化这个 counter:把 `total_num_cnt` 设置到 `total_num_cnt`(此处 spec 原意:把 counter 字段设到指令上的 invcnt),同时执行一次 invalidation,并把 `cur_num_cnt` 设置为 `total_num_cnt − 1`。
>
> C. 后续 L0P5 Cache 还会收到其他消费者送过来的同一个 ID 的 invalidation 指令,如果 `total_num` 和当前 `total_num_cnt` 一样,后续 L0P5 Cache 就把 `cur_num_cnt` 继续减 1,跳过重复的 invalidation。
>
> D. 如果后续同一个 ID 新的 invalidation 指令的 `total_num` 和当前 `total_num_cnt` 记录得不一样(实际上 0 != `total_num` 也是一种不相等),那么相当于是对这个 ID 进行了新的初始化。L0P5 Cache 同样进行初始化 `total_num_cnt` 和 `cur_num_cnt` 的动作。
>
> E. 在相同 `total_num` 和 `buf_id` 的情况下(正常完整消费),那么最后一个消费者会把 `cur_num_cnt` 减到 0,此时同时把 `total_num_cnt` 也减到 0,表达释放了这个 counter。
>
> F. 在每次执行一个 `buf_id` 的非初始化动作的时候(不是第一次了),Cache 只负责 `cur_num_cnt − 1`,并不做 invalidation 操作。

### 4.4 INV 指令下发时机的硬件约束

> 4. 当 INV 指令下发到硬件时,L0P5 Cache 里的对同一个 space id 指令应该是同轮次和 DTE 搬运数据对应的计算指令,而不是上一轮的计算指令。
>
> A. 上一轮计算如果没有结束,那么 DMA 同步应该没有结束,INV 不应该下发。

换言之:`L0P5_INV` 与之前同 `buf_id` 的 GEMM 必须有同步保护,确保前一轮计算已经从该 buf_id 读完;否则 INV 会把还在被消费的 cacheline 失效,产生错误。

---

## 5. Buf-ID 与 Invalidation 简单方法(算子开发可直接照抄的策略)

### 5.1 buf_id 规划

- 总共 256 个 `buf_id`,分配原则:
  - **id 0 reserved,不允许使用**。
  - **id 1~10 reserved,10 个 sub-thread 每个 reserve 一个 `buf_id`**(由 Primo++ 框架使用)。
  - **id 11~255**,共 245 个 ID 可由软件静态管理。例如使用 128 个 ID,2 个 kernel slot 各使用一半:
    - Kernel slot 0 使用前 64 个;
    - Kernel slot 1 使用后 64 个。
  - 建议 DSM 上分配的不同 buf 使用不同的 `buf_id`。
  - 多 kernel slot 间需要有一个分配算法,使 kernel slot 间的 `buf_id` 不同。
  - 前后 kernel 之间可以重用 `buf_id` 资源。

### 5.2 buf_id 与 ping-pong buffer 挂钩

- LHS 用 3 stage buffer → 3 个 buf_id。
- RHS 用 3 stage buffer → 3 个 buf_id。
- 注意不同的数据生成消费关系,用不同的 ID 隔离:
  - DTE → Buf → SIP
  - SIP Store → Buf → SIP

### 5.3 l0p5_inv 的时机

- **kernel 启动后**,需要对该 kernel 使用的 `buf_id` 做 invalidate,否则上一个 kernel 的数据有可能残留在 L0P5 中。
- **`buf_id` 对应的 buf 数据有更新后**,如 DTE 搬运新的数据覆盖了 buf,**读新数据前**做该 `buf_id` 的 invalidate。

### 5.4 同步后,第一次读前 invalidate,不要每次读都 invalidate

典型 LayerNorm + GEMM kernel 内 buf_id / invalidate 的写法(伪代码,字段名按现仓库 idiom):

```cpp
uint buf_count = thread_dimy * thread_dimx;
uint c_buf_id  = ((lstage_buf_id & 0xff) << 24) | ((rstage_buf_id & 0xff) << 16);

consumer_wait(0, stage_l1_lque, stage_l1_luniq_id, lstage_mbx);   // wait lhs dte copy
l0p5_inv(lstage_buf_id, buf_count);                                // lhs l0p5 inv
consumer_wait(0, stage_l1_rque, stage_l1_run1q_id, rstage_mbx);   // wait rhs dte copy
l0p5_inv(rstage_buf_id, buf_count);                                // rhs l0p5 inv

if (sub_thread_idx == 0 && sub_thread_idy == 0) {
  set_consumer_count(0, sic_id, stage_l1_lque, thread_dimx * thread_dimy);
  set_consumer_count(0, sic_id, stage_l1_rque, thread_dimx * thread_dimy);
}

for (uint k1 = 0, sk_off = 0; sk_off < k_thread_size_real; sk_off += _VMM_DEPTH, k1++) {
  SET_NACCOVR(nacc);
  nacc = 0x0;
  SETSLICE_LHS_DIM0(k1, k_thread_size_real, _RED_SLICE_SIZE);
  SETSLICE_RHS_DIM1(k1, k_thread_size_real, _RED_SLICE_SIZE);
  for (uint lu = 0; lu < _LHS_UNROLL_TIMES; lu++) {
    SETSLICE_LHS_DIM1_REAL1_REAL2(m_slice_idx + lu, M, _LHS_SLICE_SIZE);
    uint sub_lhs_unroll_addr = sub_lhs_row_addr + lu * _LHS_UNROLL_SIZE * lhs_addr_std + sk_off * _BPE;
    for (uint ru = 0; ru < _RHS_UNROLL_TIMES; ru++) {
      uint da_pos = _VMM_WIDTH * ru / 32;
      SETSLICE_RHS_DIM0_REAL1_REAL2(n_slice_idx + ru, N, _RHS_SLICE_SIZE);
      uint sub_rhs_unroll_addr = sub_rhs_col_addr + sk_off * rhs_addr_std + ru * _RHS_UNROLL_SIZE * _BPE;
      uint line_in_oa = LinesInOacc(_DST_STD);
      uint oa_begin = _GEMM_DST_BEGIN +
        (_VMM_WIDTH * ru / 128) * _SM / line_in_oa +
        lu * _LHS_UNROLL_SIZE / line_in_oa;
      MLI_GEMM_STRD(oa_begin, sub_lhs_unroll_addr, sub_rhs_unroll_addr, _ROW_MAX,
                    _LD_MODE /*ld_mode*/, 0 /*nacc*/, _DST_STD /*dst_strd*/, da_pos /*da_pos*/, c_buf_id /*c_rs1*/);
    }
  }
}
```

> 算子要点:
> - `consumer_wait` 与 `l0p5_inv` 配对——在 DTE 搬运完成后、本次 GEMM 第一次读之前,对每个 stage 的 LHS / RHS `buf_id` 各做一次 invalidate。`buf_count = thread_dimy * thread_dimx` 表示该 buf_id 在所有参与 sub-thread 上的总消费次数。
> - 第一个进入的 sub-thread (subThreadIdx 满足 (0, 0))由它来初始化 consumer_count;其余 sub-thread 直接走 `l0p5_inv` 收尾递减 counter。
> - 循环内的 `MLI_GEMM_STRD` 把 `c_buf_id`(LHS / RHS 的 buf_id 编码)透传到 GEMM 指令本身,让硬件查 L0P5 Cache 时按这两个 buf_id 命中各自的缓存空间。

---

## 6. 算子层硬约束

1. **算子开头必须对使用到的 buf_id 执行 `l0p5_inv(buf_id, 0)` 清空**——根据 §4.2 (B),`L0P5_INV(buf_id, 0)` 把 counter 清 0;不清空会让上一个 kernel 的残留 counter 影响本 kernel 的失效逻辑。
2. **多 sub-thread 共享同一 buf_id 时,`invcnt` 必须等于实际参与 sub-thread 数**——根据 §4.3 (E),最后一个消费者把 `cur_num_cnt` 减到 0 才释放 counter;`invcnt` 配错会让 counter 长期处于"已部分消费"状态,后续读到该 buf_id 时 invalidate 行为不可预期。
