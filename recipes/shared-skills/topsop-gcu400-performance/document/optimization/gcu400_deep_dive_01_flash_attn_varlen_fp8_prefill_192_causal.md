[TOC]

# 01. FlashAttention Varlen FP8 Prefill 192 Causal GCU400 深度重写报告

## 算子语义与性能矛盾

本篇分析的 GCU400/libra kernel 是一条专用 FlashAttention forward 路径：

`flash_attn_varlen_fwd_blktb_prefill_fp8_e4m3_192_causal_kernel_gcu400`

这不是一份普通 FlashAttention forward。它把许多条件同时固定下来：varlen prefill、block-table KV cache、causal mask、FP8 E4M3 Q/K/V 主路径、QK head size 192、V head size 128、GCU400/libra、`__thread_dims__(6,1,1)`。这些条件让它成为一条非常窄的高性能路径，也让实现能使用大量常量化、手写流水线和低层 TCLE/TTE 技巧。

逻辑语义仍然是标准 causal attention：

```text
scores = Q @ K^T
scores = scores * q_scale * k_descale * softmax_scale
scores = causal_mask(scores)
P      = softmax(scores)
O      = P @ V
O      = O * v_descale
LSE    = logsumexp(scores)
```

但这个公式在本实现里不按“先完整 scores、再完整 softmax、再完整 output”的朴素形态执行。kernel 按 96 行 Q 和最多 384 行 KV 的 tile 流式执行；每个 compute subthread 只负责 32 行 Q；Q/K/V 由不同 DTE subthread 供应；scores 只作为 tile 级临时 OACC/VDMEM 存在；softmax 使用 online max/sum 跨 KV tile 累积；中间概率 P 被转换成 FP8 后立即喂给 PV；最终只保留 output 和 `softmax_lse`。

等价的高层参考可以写成：

```python
def reference(q_fp8, k_cache_fp8, v_cache_fp8, block_table,
              cu_q, cu_k, q_scale, k_descale, v_descale,
              softmax_scale):
    for bid in active_prefill_batches:
        q_begin, q_end = cu_q[bid], cu_q[bid + 1]
        k_begin, k_end = cu_k[bid], cu_k[bid + 1]
        q_len = q_end - q_begin
        k_len = k_end - k_begin
        causal_offset = q_len - k_len

        for hid in range(q_num_heads):
            kv_hid = hid // (q_num_heads // kv_num_heads)
            for q_block in blocks_of_96_rows(q_len):
                for q_sub in range(3):
                    q_rows = rows_32(q_block, q_sub)
                    running_max = -inf
                    running_sum = 0
                    out_acc = 0

                    for kv_tile in reversed(blocks_of_384_rows(k_len_visible(q_rows))):
                        k = gather_by_block_table(k_cache_fp8, block_table[bid], kv_tile, kv_hid)
                        v = gather_by_block_table(v_cache_fp8, block_table[bid], kv_tile, kv_hid)
                        scores = matmul(q_fp8[q_rows, hid], k.T)
                        scores = apply_scale_and_causal(scores)
                        running_max, running_sum, out_acc = online_softmax_pv(
                            scores, v, running_max, running_sum, out_acc)

                    output[q_rows, hid] = out_acc / running_sum * v_descale
                    softmax_lse[hid, q_rows] = log(running_sum) + running_max
```

真正的性能矛盾集中在五个地方。

第一，varlen prefill 的工作量不均匀。每个 batch 的 Q/K 长度不同，causal prefill 又让早期 Q 行能看到的 KV 少、后期 Q 行能看到的 KV 多。静态按 batch 或按 head 分配会出现严重尾部不均衡。实现不能只依赖 grid 均匀分片，而要使用 L3 `dynamic_task_id` 让 SIP 动态领取 `(batch, head, q_block)` 任务。

第二，KV cache 通过 block table 间接访问。逻辑上是连续 KV 序列，物理上可能跨多个 cache block。若每个 KV tile 都按 block table 逐项解释，DTE 配置开销和 block_table 读取会成为固定成本。实现用 `bt_stack[128]` 本地化一段 block table，并检测物理 block 是否连续，从而把很多两段 DTE 合并成一段连续搬运。

第三，QK/PV 是 2D compute，Q/K/V 搬运是 DTE，二者速度和等待点不同。若使用粗粒度 `sync_subthreads`，DTE 快慢和 compute 快慢会彼此拖住。实现把 6 个 subthread 分成 3 个 compute、1 个 Q DTE、1 个 K DTE、1 个 V DTE，并用 mailbox 建立细粒度 ready/free 协议。

第四，FP8 路径的 scale 很容易把 hot loop 变慢。Q scale 是 per-row/per-head，K/V descale 可能是 per-batch/per-kv-head，softmax scale 固定。若每个 KV tile 都重新加载这些参数并做多次标量乘法，scale 会污染 OACC live range 和 scalar load 通道。实现把 `fp8_q_scale * k_descale * softmax_scale * log2(e)` 提前写入 L1 stack，hot loop 只读 `fuse_scale`。

第五，FlashAttention 的数学依赖是跨 KV tile 的。每个 Q row 的 softmax denominator 必须覆盖所有可见 KV。直接保存完整 scores 不现实；重复扫描 KV 又浪费 DTE 和 QK。实现用 online softmax，在每个 KV tile 更新 `running_max`、`row_sum_acc` 和 `out`，把跨 tile 依赖压缩成 32 行的 OACC 状态。

这份实现的阅读重点不是“每一行做了什么”，而是看它如何把这些矛盾转化为硬件可执行的队列、buffer、mailbox、L0P5 id、DTE context 和 OACC 状态。

## 关键实现片段

下面片段保留真实变量名、关键控制流和资源分配。重复的矩阵指令展开、同构的 K/V 分支和部分错误字符串被压缩为注释；这些压缩点都在片段内解释协议语义，读者不需要再依赖外部实现。

### 1. Host 入口：动态 task counter 与 scale 常量在 launch 前固定

```c++
void flash_attn_varlen_fwd_blktb_prefill_fp8_e4m3_192_causal_kernel_gcu400(
    /* output/query/key/value/metadata 省略 */,
    void* task_ws, float* fp8_q_scale, float* k_descale, float* v_descale,
    VARLEN_ATTN_FWD_OP_PARAS params) {
  using T = tops::float_e4m3;

  // 每次 launch 临时分配 4-byte L3 counter。
  // 所有 SIP 都对它 atomic_add，领取 96Q x 1 head 的动态任务。
  int* dynamic_task_id = nullptr;
  ops::topsopMallocAsync(reinterpret_cast<void**>(&dynamic_task_id),
                         sizeof(int), stream, 0);
  topsMemsetAsync(dynamic_task_id, 0, sizeof(int), stream);

  // FpKvCb 按值传入 device kernel。每个 SIP 得到自己的 SDMEM 控制块，
  // Q DTE 写 task metadata，K/V DTE 和 compute 读同一个 ring slot。
  FpKvCb cb{};

  constexpr float kDefaultPScaleLog2 = 8.0f;       // log2(256)
  constexpr float kDefaultPScaleLn = 5.54517744f;  // ln(256)

  fa_varlen_fwd_blktb_prefill_fp8_e4m3_192_causal_kernel_gcu400
      <<<numBlocks, dimBlocks, sharedSize, stream>>>(
          reinterpret_cast<T*>(output), softmax_lse,
          reinterpret_cast<T*>(query), reinterpret_cast<T*>(key),
          reinterpret_cast<T*>(value), cu_seqlens_q, cu_seqlens_k, seqused_k,
          block_table, task_ws, fp8_q_scale, k_descale, v_descale,
          dynamic_task_id,
          params.total_q, params.q_num_heads, params.qk_head_size,
          params.q_num_heads, params.kv_num_heads,
          params.kds_stride0, params.kds_stride1,
          params.vds_stride0, params.vds_stride1,
          // device 侧用 exp2，host 先把 softmax_scale 变成 log2 域。
          params.qk_head_size, params.softmax_scale * 1.44269504f,
          kDefaultPScaleLog2, kDefaultPScaleLn,
          params.o_heads, params.data_type,
          static_cast<long long>(params.k_stride0), params.num_blocks,
          static_cast<long long>(params.v_stride0),
          params.block_size, params.kvcache_layout,
          static_cast<long long>(params.bt_stride),
          params.total_k, params.v_head_size,
          cb);

  // free 与 launch 在同一 stream 上排队，counter 生命周期只覆盖一次 launch。
  ops::topsopFreeAsync(dynamic_task_id, stream);
}
```

这个入口说明两件事。第一，动态调度不是 host 预先生成 task list，而是 device SIP 自己抢全局 counter。第二，`softmax_scale`、P 的放大系数、控制块初始化都被提前固定，让 device hot loop 只面对固定协议。

### 2. Device 主体：6 个 subthread 被拆成 3 compute + Q/K/V DTE

```c++
#define SUB_THREAD_NUM 6
#define COMP_SUBTHD_NUM 3
#define Q_DTE_SUBTHD_IDX COMP_SUBTHD_NUM

// 248 OACC per compute subthread；3 个 compute 共 744，留出剩余 OACC 给 DTE/控制路径。
constexpr int kFp8kvComputeOaccAlloc = 248;
static_assert(kFp8kvComputeOaccAlloc % 4 == 0,
              "compute OACC allocation must be 4-aligned");

static constexpr int kCbSlots = 3;
struct __attribute__((aligned(64))) FpKvCb {
  volatile int ts_id[kCbSlots];
  volatile int ts_bid[kCbSlots];
  volatile int ts_hid[kCbSlots];
  volatile int ts_qboff[kCbSlots];
};

__thread_dims__(SUB_THREAD_NUM, 1, 1) __global__
void fa_varlen_fwd_blktb_prefill_fp8_e4m3_192_causal_kernel_gcu400(
    tops::float_e4m3* output, float* softmax_lse,
    tops::float_e4m3* query, tops::float_e4m3* key, tops::float_e4m3* value,
    int* cu_seqlens_q, int* cu_seqlens_k, int* seqused_k, int* block_table,
    void* task_ws, float* fp8_q_scale, float* k_descale, float* v_descale,
    int* dynamic_task_id,
    /* shape/stride 参数省略 */,
    FpKvCb cb) {
  using T = tops::float_e4m3;

  auto prefill_batchn_l3_buf = reinterpret_cast<int*>(task_ws);
  int prefill_batchn = *prefill_batchn_l3_buf;
  if (prefill_batchn == 0) return;

  constexpr int kComputeSubthdNum = COMP_SUBTHD_NUM;
  constexpr int kQKHeadSizeAlign = FAConfig<192>::kQKHeadSizeAlign;
  constexpr int kVHeadSize = FAConfig<192>::kVHeadSize;
  constexpr int kQBlkSize = FAConfig<192>::kQBlkSize;      // 32
  constexpr int kKVBlkSize = FAConfig<192>::kKVBlkSize;    // 384
  constexpr int kStageQ = 3;
  constexpr int kStageKV = 3;
  constexpr int kQRowBlkSize = kQBlkSize * kComputeSubthdNum;  // 96

  // 每个 SIP 各自构造一份 batch metadata。上限保护的是 local SDMEM footprint，
  // 不是 attention 算法本身的数学限制。
  constexpr int kMaxBatch = 256;
  __local__ __valigned__ int q_seqlen_buf[kMaxBatch];
  __local__ __valigned__ int k_seqlen_buf[kMaxBatch];
  __local__ __valigned__ int q_pos_buf[kMaxBatch];
  __local__ __valigned__ int batch_idx[kMaxBatch];
  __local__ __valigned__ int batch_q_blocks_buf[kMaxBatch];
  __local__ __valigned__ int cu_task_per_batch_buf[kMaxBatch + 1];

  op_assert((prefill_batchn <= kMaxBatch),
            "prefill_batchn must be <= kMaxBatch");

  if (subThreadIdx.x == Q_DTE_SUBTHD_IDX) {
    int* prefill_batch_l3_buf = prefill_batchn_l3_buf + 1;
    cu_task_per_batch_buf[0] = 0;

    for (int i = 0; i < prefill_batchn; i++) {
      int bid = prefill_batch_l3_buf[i];
      int q_batch_start = cu_seqlens_q[bid];
      int q_batch_end = cu_seqlens_q[bid + 1];
      q_seqlen_buf[i] = q_batch_end - q_batch_start;

      k_seqlen_buf[i] = seqused_k
          ? seqused_k[bid]
          : cu_seqlens_k[bid + 1] - cu_seqlens_k[bid];
      q_pos_buf[i] = q_batch_start;
      batch_idx[i] = bid;
    }

    int cu_num = 0;
    for (int i = 0; i < prefill_batchn; i++) {
      int batch_q_blocks = CEIL_DIV(q_seqlen_buf[i], kQRowBlkSize);
      batch_q_blocks_buf[i] = batch_q_blocks;
      cu_num += batch_q_blocks * q_num_heads;
      cu_task_per_batch_buf[i + 1] = cu_num;
    }
    tcle::fence<FenceType::L1_VDMEM_STORE>();
  }

  // Q DTE 写完本 SIP metadata 后，其他 subthread 才能读 local 数组。
  tops::sync_subthreads();

  clearL0p5Ids(11, 18);
  __local__ __valigned__ T q[kStageQ * kComputeSubthdNum * kQBlkSize * kQKHeadSizeAlign];
  __local__ __valigned__ float q_scale_l1[kStageQ * kQRowBlkSize];
  __local__ __valigned__ T k[kStageKV * kKVBlkSize * kQKHeadSizeAlign];
  __local__ __valigned__ T v[kStageKV * kKVBlkSize * kVHeadSize];
  __local__ __valigned__ T s[kComputeSubthdNum * kQBlkSize * kKVBlkSize];
  __local__ __valigned__ float redsum_stg2[kComputeSubthdNum * 128];
  __local__ __valigned__ float max_stg2[kComputeSubthdNum * 128];

  // 25 个 mailbox 分摊给 Q/K/V DTE subthread。
  // 每个 ready/consumed 都是 per-compute-subthread counter，避免一个慢 consumer
  // 被另一个快 consumer 的下一轮信号覆盖。
  constexpr int kMbCount = 7 * kComputeSubthdNum + 4;
  volatile __local__ int mb_ids[kMbCount];
  /* mailbox 分配、prologue credits 与 mb_ids 切片省略，语义见下：
     v_ready/v_consumed/k_ready/k_consumed/q_ready/q_consumed 都有 3 个；
     task_pub_kdte/task_pub_vdte 由 Q DTE 发布；
     task_done_kdte/task_done_vdte/task_done_compute 保护 cb ring 复用。 */

  int total_tasks = cu_task_per_batch_buf[prefill_batchn];
  if (total_tasks > 0) {
    BatchMeta bm{q_seqlen_buf, k_seqlen_buf, q_pos_buf,
                 batch_idx, batch_q_blocks_buf, cu_task_per_batch_buf};

    if (subThreadIdx.x < kComputeSubthdNum) {
      do_compute_loop<T, kQBlkSize, kKVBlkSize, kQRowBlkSize>(/* QK + softmax + PV */);
    } else if (subThreadIdx.x == Q_DTE_SUBTHD_IDX) {
      do_q_dte_loop<T, kComputeSubthdNum, kQBlkSize,
                    kQKHeadSizeAlign, kStageQ, kQRowBlkSize>(/* task + Q DTE */);
    } else if (subThreadIdx.x == (SUB_THREAD_NUM - 2)) {
      do_k_dte_loop<T, kKVBlkSize, kQKHeadSizeAlign,
                    kStageKV, kQRowBlkSize>(/* K DTE */);
    } else {
      do_v_dte_loop<T, kKVBlkSize, kVHeadSize,
                    kStageKV, kQRowBlkSize>(/* V DTE */);
    }
  }

  // q_len > k_len 的 causal overflow 区间没有合法 KV：output 置 0，LSE 置 -inf。
  if (subThreadIdx.x == Q_DTE_SUBTHD_IDX) {
    for (int bid = GetThreadIdx(); bid < prefill_batchn; bid += GetThreadNum()) {
      int causal_offset = q_seqlen_buf[bid] - k_seqlen_buf[bid];
      if (causal_offset <= 0) continue;
      /* output memset_async(0) 省略 */
      constexpr float kInf = std::numeric_limits<float>::infinity();
      float inf_val = -kInf;
      for (int hid = 0; hid < q_num_heads; ++hid) {
        tops::mdspan global_lse(tops::Global,
            softmax_lse + hid * total_q + q_pos_buf[bid], causal_offset);
        tops::memset_async(q_ctx, global_lse, inf_val).wait();
      }
    }
    q_ctx.destroy();
  }
}
```

这个主干已经能解释整条路径的资源形态：task 粒度是 `96 Q rows x 1 query head`；每个 SIP 的 6 个 subthread 不是同构工作者，而是 3 个 compute、1 个 Q DTE、1 个 K DTE、1 个 V DTE；跨 SIP 只共享 `dynamic_task_id`，SIP 内才使用 `FpKvCb`、mailbox、L1 ring buffer 和 L0P5 id。

### 3. Q DTE：task claim、Q 搬运、scale 融合和下一 task 预取叠在一起

```c++
template <typename T, int kComputeSubthdNum, int kQBlkSize,
          int kQKHeadSizeAlign, int kStageQ, int kQRowBlkSize>
__device__ static __attribute__((always_inline)) void do_q_dte_loop(
    T* query, T* q_l1,
    float* fp8_q_scale, float* q_scale_l1,
    tops::local_dte& q_ctx,
    volatile int* q_ready_mb, volatile int* q_consumed_mb,
    int task_pub_kdte_mb, int task_pub_vdte_mb,
    int task_done_kdte_mb, int task_done_vdte_mb,
    volatile int* task_done_compute_mb,
    int* dynamic_task_id, int total_tasks, int prefill_batchn,
    FpKvCb& cb, BatchMeta const& bm,
    int total_q, int q_heads_l3, int q_head_dim_l3,
    int kv_num_heads, int kds_stride0, int kds_stride1,
    float softmax_scale_log2e, float* k_descale) {
  int q_pp_flag = 0;
  int cur_idx = 0;
  int last_bid = -1;
  int batch_q_len = 0, batch_kv_len = 0, batch_q_pos = 0, batch_q_row_off = 0;
  int num_queries_per_kv = q_heads_l3 / kv_num_heads;
  bool single_kv_head = (kv_num_heads == 1);
  bool q_head_128 = (q_head_dim_l3 == 128);
  int q_l1_stride = q_head_128 ? 128 : kQKHeadSizeAlign;

  // k_descale * softmax_scale_log2e 是 batch/kv-head 级不变量；
  // Q DTE 缓存它，避免 compute 每个 KV tile 重复从 L3 读 descale。
  int last_qk_scale_bid = -1, last_qk_scale_kv_head = -1;
  __vector float qk_scale_cache = (__vector float)softmax_scale_log2e;

  // Prologue：先领取第一个 task，写 cb[0]，再发布给 K/V DTE。
  wait_mailbox(task_done_kdte_mb);
  wait_mailbox(task_done_vdte_mb);
  wait_mailbox(task_done_compute_mb[0]);
  wait_mailbox(task_done_compute_mb[1]);
  wait_mailbox(task_done_compute_mb[2]);
  int tid = tcle::atomic_add(dynamic_task_id, 1);
  cb.ts_id[0] = tid;
  if (tid < total_tasks) {
    int lo = 0, hi = prefill_batchn - 1;
    while (lo < hi) {
      int mid = lo + ((hi - lo + 1) >> 1);
      if (bm.cu_task_per_batch_buf[mid] <= tid) lo = mid;
      else hi = mid - 1;
    }
    int b = lo;
    int qbb = bm.batch_q_blocks_buf[b];
    int local = tid - bm.cu_task_per_batch_buf[b];
    int hid = local / qbb;
    cb.ts_bid[0] = b;
    cb.ts_hid[0] = hid;
    cb.ts_qboff[0] = local - hid * qbb;
  }
  tcle::fence<FenceType::L1_SDMEM_STORE>();
  notify_mailbox(task_pub_kdte_mb);
  notify_mailbox(task_pub_vdte_mb);

  while (true) {
    int task_id = cb.ts_id[cur_idx];
    if (task_id >= total_tasks) {
      notify_mailbox(q_ready_mb[0]);
      notify_mailbox(q_ready_mb[1]);
      notify_mailbox(q_ready_mb[2]);
      break;
    }

    int bid = cb.ts_bid[cur_idx];
    int hid = cb.ts_hid[cur_idx];
    int q_block_off = cb.ts_qboff[cur_idx];

    if (bid != last_bid) {
      batch_q_len = bm.q_seqlen_buf[bid];
      batch_kv_len = bm.k_seqlen_buf[bid];
      batch_q_pos = bm.q_pos_buf[bid];
      batch_q_row_off = tcle::max(0, batch_q_len - batch_kv_len);
      last_bid = bid;
    }

    int local_q_start = q_block_off * kQRowBlkSize + batch_q_row_off;
    int local_q_end =
        tcle::min(tcle::min(local_q_start + kQRowBlkSize,
                            batch_q_len + batch_q_row_off),
                  batch_q_len);
    bool active = (local_q_start < local_q_end);

    tops::event q_evt;
    if (active) {
      wait_mailbox(q_consumed_mb[0]);
      wait_mailbox(q_consumed_mb[1]);
      wait_mailbox(q_consumed_mb[2]);

      int real_q_blk_size = local_q_end - local_q_start;
      float* q_scale_dst = q_scale_l1 + q_pp_flag * kQRowBlkSize;
      T* q_dst = q_l1 + q_pp_flag * kComputeSubthdNum * kQBlkSize * q_l1_stride;
      tops::mdspan l3_q(tops::Global, query, total_q, q_heads_l3, q_head_dim_l3);
      tops::mdspan l1_q(tops::Private, q_dst, real_q_blk_size, 1, q_l1_stride);
      q_ctx.config_slice(l1_q, l3_q, {batch_q_pos + local_q_start, hid, 0});
      q_evt = q_ctx.trigger();

      int kv_head_idx = single_kv_head ? 0 : hid / num_queries_per_kv;
      if (bid != last_qk_scale_bid ||
          (!single_kv_head && kv_head_idx != last_qk_scale_kv_head)) {
        int real_batch_idx = bm.batch_idx[bid];
        qk_scale_cache = k_descale == nullptr
            ? (__vector float)softmax_scale_log2e
            : tcle::loadeoa<__vector float>(
                  &k_descale[real_batch_idx * kds_stride0 +
                              kv_head_idx * kds_stride1], 0) *
                  softmax_scale_log2e;
        last_qk_scale_bid = bid;
        last_qk_scale_kv_head = kv_head_idx;
      }

      // 写入 row 级 fuse scale：fp8_q_scale * k_descale * softmax_scale_log2e。
      load_q_scale_tile_to_l1(fp8_q_scale, q_scale_dst,
                              batch_q_pos + local_q_start, hid,
                              q_heads_l3, real_q_blk_size, qk_scale_cache);
    }

    // 当前 Q DTE 在飞时，抢下一 task 并写 cb[next_idx]，隐藏 L3 atomic 往返。
    wait_mailbox(task_done_kdte_mb);
    wait_mailbox(task_done_vdte_mb);
    wait_mailbox(task_done_compute_mb[0]);
    wait_mailbox(task_done_compute_mb[1]);
    wait_mailbox(task_done_compute_mb[2]);
    int next_idx = (cur_idx + 1) % kCbSlots;
    int tid_next = tcle::atomic_add(dynamic_task_id, 1);
    cb.ts_id[next_idx] = tid_next;
    if (tid_next < total_tasks) {
      /* 与 prologue 相同的 upper-bound 解码，写 ts_bid/ts_hid/ts_qboff。 */
    }
    tcle::fence<FenceType::L1_SDMEM_STORE>();
    notify_mailbox(task_pub_kdte_mb);
    notify_mailbox(task_pub_vdte_mb);

    if (active) {
      q_evt.wait();
      tcle::fence<FenceType::L1_VDMEM_STORE>();
      notify_mailbox(q_ready_mb[0]);
      notify_mailbox(q_ready_mb[1]);
      notify_mailbox(q_ready_mb[2]);
      q_pp_flag = (q_pp_flag + 1) % kStageQ;
    } else {
      // inactive 也发布 q_ready，让 compute 读到 cb 后走 skip 分支并归还 credit。
      notify_mailbox(q_ready_mb[0]);
      notify_mailbox(q_ready_mb[1]);
      notify_mailbox(q_ready_mb[2]);
    }

    cur_idx = next_idx;
  }
}
```

Q DTE 不是单纯搬 Q。它把 task 领取、`FpKvCb` 发布、Q DTE、Q scale 预处理和下一 task 的 metadata 生成合在一起。这样 task 边界的 L3 atomic、二分查找和 K/V DTE task 发布都被 Q 搬运覆盖。

### 4. K/V DTE：block table cache、连续 fast path 与双 stage event pipeline

```c++
template <typename T, int kKVBlkSize, int kQKHeadSizeAlign,
          int kStageKV, int kQRowBlkSize>
__device__ static __attribute__((always_inline, no_mem_alias_in_vldst))
void do_k_dte_loop(
    T* key, T* k_l1, int* block_table, int total_tasks,
    FpKvCb& cb, BatchMeta const& bm,
    volatile int* k_consumed_mb, volatile int* k_ready_mb,
    int task_pub_kdte_mb, int task_done_kdte_mb,
    long long l3_k_block_stride, int num_blocks, int kv_num_heads,
    int qk_head_size, int block_size, int kvcache_layout, long long bt_stride,
    int num_queries_per_kv) {
  bool layout1 = (kvcache_layout == 1);
  long long compact_k_block_stride =
      static_cast<long long>(block_size) * kv_num_heads * qk_head_size;
  bool kv_contig_in_l3 =
      (kv_num_heads == 1) && (l3_k_block_stride == compact_k_block_stride);
  int qk_l1_stride = (qk_head_size == 128) ? 128 : kQKHeadSizeAlign;

  tops::local_dte k_ctx[4];       // stage 0/1 x 最多 2 段 physical block
  bool k_ctx_inited[4] = {false, false, false, false};
  for (int i = 0; i < 4; ++i) k_ctx[i].init();

  __valigned__ int bt_stack[kBtSegSize];
  constexpr int kBtSegInvalid = -kBtSegSize;
  int bt_seg_start = kBtSegInvalid;

  bool k_dte_preconfigured = false;
  bool k_pub_pre_consumed = false;
  tops::event k_evt[2][2];
  int k_blk_num[2] = {0, 0};
  int kv_pp_flag = 0;
  int cur_idx = 0;

  while (true) {
    if (!k_pub_pre_consumed) wait_mailbox(task_pub_kdte_mb);
    else k_pub_pre_consumed = false;

    int task_id = cb.ts_id[cur_idx];
    if (task_id >= total_tasks) break;
    int bid = cb.ts_bid[cur_idx];
    int hid = cb.ts_hid[cur_idx];
    int q_block_off = cb.ts_qboff[cur_idx];
    int kv_head_idx = kv_contig_in_l3 ? 0 : hid / num_queries_per_kv;

    int batch_q_len = bm.q_seqlen_buf[bid];
    int batch_kv_len = bm.k_seqlen_buf[bid];
    int causal_offset = batch_q_len - batch_kv_len;
    int batch_q_row_off = tcle::max(0, causal_offset);
    int local_q_start = q_block_off * kQRowBlkSize + batch_q_row_off;
    int real_kv_seqlen =
        tcle::min(local_q_start + kQRowBlkSize - causal_offset, batch_kv_len);
    if (real_kv_seqlen <= 0) {
      notify_mailbox(task_done_kdte_mb);
      cur_idx = (cur_idx + 1) % kCbSlots;
      continue;
    }

    int batch_bt_block_num = CEIL_DIV(batch_kv_len, block_size);
    int* batch_bt = block_table + bm.batch_idx[bid] * bt_stride;
    int batch_bt_phys_base = 0;
    int batch_bt_phys_contig = kv_contig_in_l3
        ? detect_phys_contig_bt(batch_bt, batch_bt_block_num, &batch_bt_phys_base)
        : 0;

    int num_tiles = CEIL_DIV(real_kv_seqlen, kKVBlkSize);
    int stage = 0;

    // 配置 tile 的核心逻辑：连续路径直接线性地址；非连续路径缓存 block_table 段。
    auto config_k_tile = [&](int stage, int kv_pp, int kv_row, int kv_blk_size) {
      T* cur_k = k_l1 + kv_pp * kKVBlkSize * qk_l1_stride;
      int row_off = kv_row % block_size;
      int blk_off = kv_row / block_size;

      if (batch_bt_phys_contig) {
        k_blk_num[stage] = 1;
        int blk_phys = batch_bt_phys_base + blk_off;
        T* src = key + blk_phys * l3_k_block_stride + row_off * qk_head_size;
        auto& ctx = k_ctx[stage * 2 + 0];
        if (k_ctx_inited[stage * 2 + 0]) {
          ctx.set_src_addr(src);
          ctx.set_dst_addr(cur_k);
          ctx.set_src_dim_size(0, kv_blk_size);
          ctx.set_dst_dim_size(0, kv_blk_size);
        } else {
          tops::mdspan l3(tops::Global, src, kv_blk_size, qk_head_size);
          tops::mdspan l1(tops::Local, cur_k, kv_blk_size, qk_l1_stride);
          ctx.config_deslice(l1, l3, {0, 0});
          k_ctx_inited[stage * 2 + 0] = true;
        }
        return;
      }

      int blk_num_l = CEIL_DIV(kv_blk_size + row_off, block_size);
      int blk0_size = tcle::min(kv_blk_size, block_size - row_off);
      int blk_sizes[2] = {blk0_size, kv_blk_size - blk0_size};
      T* blk_dsts[2] = {cur_k, cur_k + blk0_size * qk_l1_stride};

      // 两个 logical block 若物理连续，可以合并成一次 DTE。
      if (kv_contig_in_l3 && blk_num_l == 2) {
        int blk0_table_idx = blk_off;
        if (blk0_table_idx < bt_seg_start ||
            blk0_table_idx >= bt_seg_start + kBtSegSize) {
          int new_seg_start = (blk0_table_idx / kBtSegSize) * kBtSegSize;
          int new_cnt = tcle::min(batch_bt_block_num - new_seg_start, kBtSegSize);
          tcle::set_vl(new_cnt);
          asm volatile(
              "%{\n    l.vldoa.w oacc766, %[src]\n%}\n"
              "%{\n    v.vstoa.w oacc766, %[dst]\n%}\n"
              : : [src] "r"(batch_bt + new_seg_start), [dst] "r"(&bt_stack[0])
              : "memory");
          tcle::set_vl(TCLE_MAX_VECTOR_LENGTH);
          bt_seg_start = new_seg_start;
        }
        int blk0_phys = bt_stack[blk0_table_idx - bt_seg_start];
        int blk1_phys = bt_stack[blk0_table_idx + 1 - bt_seg_start];
        if (blk1_phys == blk0_phys + 1) {
          blk_num_l = 1;
          blk_sizes[0] = kv_blk_size;
        }
      }

      k_blk_num[stage] = blk_num_l;
      for (int blk = 0; blk < blk_num_l; ++blk) {
        int blk_table_idx = blk_off + blk;
        if (blk_table_idx < bt_seg_start ||
            blk_table_idx >= bt_seg_start + kBtSegSize) {
          int new_seg_start = (blk_table_idx / kBtSegSize) * kBtSegSize;
          int new_cnt = tcle::min(batch_bt_block_num - new_seg_start, kBtSegSize);
          tcle::set_vl(new_cnt);
          asm volatile(
              "%{\n    l.vldoa.w oacc766, %[src]\n%}\n"
              "%{\n    v.vstoa.w oacc766, %[dst]\n%}\n"
              : : [src] "r"(batch_bt + new_seg_start), [dst] "r"(&bt_stack[0])
              : "memory");
          tcle::set_vl(TCLE_MAX_VECTOR_LENGTH);
          bt_seg_start = new_seg_start;
        }
        int blk_phys = bt_stack[blk_table_idx - bt_seg_start];
        T* dst = blk_dsts[blk];
        /* 根据 kv_contig_in_l3/layout1 选择 config_deslice 或 config_slice。 */
      }
    };

    int kv_row0 = (num_tiles - 1) * kKVBlkSize;
    int kv_blk0 = real_kv_seqlen - kv_row0;
    if (!k_dte_preconfigured) {
      config_k_tile(stage, kv_pp_flag, kv_row0, kv_blk0);
      wait_mailbox(k_consumed_mb[0]);
      wait_mailbox(k_consumed_mb[1]);
      wait_mailbox(k_consumed_mb[2]);
      k_evt[stage][0] = k_ctx[stage * 2 + 0].trigger();
      if (k_blk_num[stage] == 2) k_evt[stage][1] = k_ctx[stage * 2 + 1].trigger();
    } else {
      k_dte_preconfigured = false;
    }

    for (int i = 0; i < num_tiles; ++i) {
      bool has_next = (i + 1 < num_tiles);
      int next_stage = stage ^ 1;
      if (has_next) {
        int next_kv_row = (num_tiles - 2 - i) * kKVBlkSize;
        int next_kv_pp = (kv_pp_flag + 1) % kStageKV;
        config_k_tile(next_stage, next_kv_pp, next_kv_row, kKVBlkSize);
      }

      if (k_blk_num[stage] == 2) {
        k_evt[stage][0].wait();
        k_evt[stage][1].wait();
      } else {
        k_evt[stage][0].wait();
      }
      notify_mailbox(k_ready_mb[0]);
      notify_mailbox(k_ready_mb[1]);
      notify_mailbox(k_ready_mb[2]);
      kv_pp_flag = (kv_pp_flag + 1) % kStageKV;

      if (has_next) {
        wait_mailbox(k_consumed_mb[0]);
        wait_mailbox(k_consumed_mb[1]);
        wait_mailbox(k_consumed_mb[2]);
        k_evt[next_stage][0] = k_ctx[next_stage * 2 + 0].trigger();
        if (k_blk_num[next_stage] == 2)
          k_evt[next_stage][1] = k_ctx[next_stage * 2 + 1].trigger();
      }
      stage = next_stage;
    }

    // 当前 task 完成后可以预触发下一 task 的第一个 K tile。
    // 若这里提前 wait 了 task_pub_kdte_mb，下一轮必须用 k_pub_pre_consumed 跳过重复 wait。
    /* cross-task pre-trigger 省略；它维护 k_dte_preconfigured/k_pub_pre_consumed。 */
    notify_mailbox(task_done_kdte_mb);
    cur_idx = (cur_idx + 1) % kCbSlots;
  }
}
```

V DTE 使用相同的 task/ring/mailbox 结构，但 contiguous fast path 更偏 `config_memcpy`，因为 V 的 L1 布局是 `[kv, 128]` 连续块；K DTE 更强调 `config_deslice/config_slice`，因为 QK RHS 需要按 qk head stride 组织。K 和 V 都用 4 个 `local_dte` context 覆盖“stage x 最多两段 physical block”，并把下一 tile 的 descriptor 配置放到当前 event wait 之前。

### 5. Compute：32 行 Q 的完整 QK、online softmax、PV 和输出

```c++
FP8KV_MAXNREG(kFp8kvComputeOaccAlloc)
template <typename T, int kQBlkSize, int kKVBlkSize, int kQRowBlkSize>
__device__ static __attribute__((noinline, no_mem_alias_in_vldst_tar,
                                 aligned(16384)))
void do_compute_loop(
    T* output, float* softmax_lse,
    T* q_l1, T* k_l1, T* v_l1,
    float* q_scale_l1,
    T* s, float* redsum_stg2_buf, float* max_stg2_buf,
    volatile int* q_ready_mb, volatile int* q_consumed_mb,
    volatile int* v_ready_mb, volatile int* v_consumed_mb,
    volatile int* k_ready_mb, volatile int* k_consumed_mb,
    volatile int* task_done_compute_mb,
    FpKvCb& cb, BatchMeta const& bm,
    int total_tasks, int q_num_heads, int kv_num_heads,
    int vds_stride0, int vds_stride1,
    int qk_head_size, float p_scale_log2, float p_scale_ln,
    int o_heads, int data_type, int total_q, float* v_descale) {
  int subthd_idx = subThreadIdx.x;       // 0/1/2，各负责 32 行 Q
  int q_pp_flag = 0, kv_pp_flag = 0;
  int cur_idx = 0;
  int num_queries_per_kv = q_num_heads / kv_num_heads;
  bool single_kv_head = (kv_num_heads == 1);
  bool has_v_descale = (v_descale != nullptr);

  constexpr int kStageKV = 3;
  constexpr int kStageQ = 3;
  constexpr int kKBufIdBase = 11;
  constexpr int kVBufIdBase = kKBufIdBase + kStageKV;  // 14
  constexpr int kQBufIdBase = kVBufIdBase + kStageKV;  // 17
  constexpr int kPBufIdBase = kQBufIdBase + kStageQ;   // 20
  int p_buf_id_base = kPBufIdBase + subthd_idx * kStageKV;

  int my_q_ready_mb = q_ready_mb[subthd_idx];
  int my_q_consumed_mb = q_consumed_mb[subthd_idx];
  int my_k_ready_mb = k_ready_mb[subthd_idx];
  int my_k_consumed_mb = k_consumed_mb[subthd_idx];
  int my_v_ready_mb = v_ready_mb[subthd_idx];
  int my_v_consumed_mb = v_consumed_mb[subthd_idx];
  int my_task_done_compute_mb = task_done_compute_mb[subthd_idx];

  while (true) {
    wait_mailbox(my_q_ready_mb);
    int task_id = cb.ts_id[cur_idx];
    if (task_id >= total_tasks) break;

    int bid = cb.ts_bid[cur_idx];
    int hid = cb.ts_hid[cur_idx];
    int q_block_off = cb.ts_qboff[cur_idx];
    int batch_q_len = bm.q_seqlen_buf[bid];
    int batch_kv_len = bm.k_seqlen_buf[bid];
    int batch_q_pos = bm.q_pos_buf[bid];
    int batch_q_row_off = tcle::max(0, batch_q_len - batch_kv_len);

    int local_q_start = q_block_off * kQRowBlkSize + batch_q_row_off;
    int local_q_row = local_q_start + kQBlkSize * subthd_idx;
    int real_q_blk_size = tcle::min(kQBlkSize, batch_q_len - local_q_row);
    bool is_active = local_q_row < batch_q_len;
    if (!is_active) {
      notify_mailbox(my_task_done_compute_mb);
      cur_idx = (cur_idx + 1) % kCbSlots;
      continue;
    }

    int causal_offset = batch_q_len - batch_kv_len;
    int real_kv_seqlen =
        tcle::min(local_q_start + kQRowBlkSize - causal_offset, batch_kv_len);
    int subthd_kv_end =
        tcle::min(tcle::max(local_q_row + real_q_blk_size - causal_offset, 0),
                  real_kv_seqlen);

    using FLOAT_VT = typename stvector<float, 1>::VT;
    auto zero = FLOAT_VT(0.0);
    auto init_max = FLOAT_VT(-std::numeric_limits<float>::max());
    FLOAT_VT out[kQBlkSize];
    FLOAT_VT row_sum_acc[kQBlkSize];
    FLOAT_VT running_max[kQBlkSize];
    FLOAT_VT pre_max = init_max;
    for (int r = 0; r < kQBlkSize; r++) {
      out[r] = zero;
      row_sum_acc[r] = zero;
      running_max[r] = init_max;
    }

    __valigned__ float fp8_q_scale_stack[128];
    if (real_q_blk_size == kQBlkSize) {
      tcle::set_vl(kQBlkSize);
      auto q_scale_v = tcle::load<FLOAT_VT>(
          q_scale_l1 + q_pp_flag * kQRowBlkSize + subthd_idx * kQBlkSize);
      tcle::store(q_scale_v, fp8_q_scale_stack);
      tcle::set_vl(TCLE_MAX_VECTOR_LENGTH);
    }

    int num_tiles = CEIL_DIV(real_kv_seqlen, kKVBlkSize);
    int local_kv_row = (num_tiles - 1) * kKVBlkSize;
    int real_kv_blk_size = real_kv_seqlen - local_kv_row;
    int mask_len_r0 = local_q_row - local_kv_row + 1 - causal_offset;

    for (int tile_idx = 0; tile_idx < num_tiles; ++tile_idx) {
      int k_buf_id = kKBufIdBase + kv_pp_flag;
      int v_buf_id = kVBufIdBase + kv_pp_flag;
      int p_buf_id = p_buf_id_base + kv_pp_flag;
      bool need_kv = local_kv_row < subthd_kv_end;

      if (need_kv) {
        T* cur_k = k_l1 + kv_pp_flag * kKVBlkSize *
                         ((qk_head_size == 128) ? 128 : FAConfig<192>::kQKHeadSizeAlign);

        // QK：Q(32 x head) @ K^T(head x 384) -> S(32 x 384)。
        // 实现按 3 个 128-column block 展开，每个 block 又用两个 64-column RHS。
        FLOAT_VT s_qk[kQBlkSize * (kKVBlkSize / tcle::altivector_step<FLOAT_VT>())];
        wait_mailbox(my_k_ready_mb);
        l0p5_inv(k_buf_id, COMP_SUBTHD_NUM);
        /* matrix_t dot 展开省略：结果写入 s_qk，形状为 32 x 384。 */
        notify_mailbox<true>(my_k_consumed_mb);

        // causal mask：按 3 个 128 列段把不可见 lane 置为 -inf。
        if (mask_len_r0 < kKVBlkSize) {
          for (int r = 0, mb_len = mask_len_r0; r < kQBlkSize; ++r, ++mb_len) {
            auto mask = tcle::vset_mb<typename tcle::altivector_to_mask<FLOAT_VT>::type>(
                tcle::max(mb_len, 0));
            s_qk[r] = vsel(mask, s_qk[r], FLOAT_VT(-std::numeric_limits<float>::infinity()));
          }
          /* 跨第 2/3 个 128 列段的同构 mask 分支省略。 */
        }

        // row-wise scale 已经由 Q DTE 融合到 fp8_q_scale_stack。
        for (int r = 0; r < kQBlkSize; ++r) {
          float fuse_scale = fp8_q_scale_stack[r];
          s_qk[r] = __gcu_mul_scl_VfVff(s_qk[r], fuse_scale);
          s_qk[r + kQBlkSize] = __gcu_mul_scl_VfVff(s_qk[r + kQBlkSize], fuse_scale);
          s_qk[r + 2 * kQBlkSize] =
              __gcu_mul_scl_VfVff(s_qk[r + 2 * kQBlkSize], fuse_scale);
        }

        for (int r = 0; r < kQBlkSize; ++r) {
          running_max[r] = tcle::max(running_max[r], s_qk[r]);
          running_max[r] = tcle::max(running_max[r], s_qk[r + kQBlkSize]);
          running_max[r] = tcle::max(running_max[r], s_qk[r + 2 * kQBlkSize]);
        }

        // running_max 做行归约，得到当前 tile 后的 cur_max。
        for (int r = 0; r < kQBlkSize; ++r) {
          running_max[r] = redmax<1>(running_max[r]);
          max_stg2_buf[r] = running_max[r];
        }
        tcle::set_vl(kQBlkSize);
        FLOAT_VT cur_max = tcle::load<FLOAT_VT>(max_stg2_buf);
        tcle::set_vl(TCLE_MAX_VECTOR_LENGTH);

        // P = exp2(score - cur_max - log2(256))，再转 FP8 写回 s_subthd。
        pre_max = exp2(pre_max - cur_max);
        /* internal_tar_cvt_store<F8E4M3 | CLAMP> 省略：P tile 写成 FP8。 */

        // 历史 out/sum 按 max 差重缩放；PAIR 宏用同一组 scalar 同时缩放两组 OACC。
        __valigned__ float diff_exp_stack[128];
        tcle::store(pre_max, diff_exp_stack);
        FP8KV_MUL_SCL_32_PAIR(out, row_sum_acc, diff_exp_stack);

        for (int r = 0; r < kQBlkSize; ++r) {
          row_sum_acc[r] = row_sum_acc[r] + s_qk[r];  // s_qk 此时代表 P 的行和分量
        }

        // V wait 被推迟到 PV 前；QK/softmax 已经覆盖了 V DTE 的尾部。
        wait_mailbox(my_v_ready_mb);
        l0p5_inv(v_buf_id, COMP_SUBTHD_NUM);
        T* cur_v = v_l1 + kv_pp_flag * kKVBlkSize * FAConfig<192>::kVHeadSize;
        /* PV matrix_t dot 省略：out += P(32 x K) @ V(K x 128)。 */
        notify_mailbox<true>(my_v_consumed_mb);

        pre_max = cur_max;
      } else {
        // 当前 compute subthread 对这个 tile 没有可见 KV，也必须消费 ready credit。
        wait_mailbox(my_k_ready_mb);
        notify_mailbox<true>(my_k_consumed_mb);
        wait_mailbox(my_v_ready_mb);
        notify_mailbox<true>(my_v_consumed_mb);
      }

      kv_pp_flag = (kv_pp_flag + 1) % kStageKV;
      local_kv_row -= kKVBlkSize;
      real_kv_blk_size = kKVBlkSize;
      mask_len_r0 += kKVBlkSize;
    }

    // KV loop 结束后才做 row_sum reduction，避免每个 tile 尾部多一个分支。
    for (int r = 0; r < kQBlkSize; ++r) {
      redsum_stg2_buf[r] = redsum<1>(row_sum_acc[r]);
    }
    tcle::set_vl(kQBlkSize);
    FLOAT_VT row_sum = tcle::load<FLOAT_VT>(redsum_stg2_buf);
    tcle::set_vl(TCLE_MAX_VECTOR_LENGTH);

    notify_mailbox<true>(my_q_consumed_mb);

    // 最终输出：out * (1 / row_sum) * v_descale，再按 fp16/bf16 写回。
    __vector float fp8_v_ds_cache = (__vector float)1.0f;
    if (has_v_descale) {
      int real_batch_idx = bm.batch_idx[bid];
      int kv_head_idx = single_kv_head ? 0 : hid / num_queries_per_kv;
      fp8_v_ds_cache = tcle::loadeoa<__vector float>(
          &v_descale[real_batch_idx * vds_stride0 + kv_head_idx * vds_stride1], 0);
    }
    FLOAT_VT normalizer = tcle::msf<6>(row_sum) * fp8_v_ds_cache;
    for (int r = 0; r < kQBlkSize; ++r) {
      out[r] = out[r] * tcle::bcastInternal(normalizer, r);
    }
    /* tar_cvt_store<FP16_VT/BF16_VT> 写 output 省略。 */

    constexpr float kLn2 = 0.69314718f;
    int total_q_row = batch_q_pos + local_q_row;
    int lse_offset = hid * total_q + total_q_row;
    row_sum = ln(row_sum);
    row_sum = row_sum + pre_max * kLn2 - p_scale_ln;
    auto lse_cond =
        tcle::vset_mb<typename tcle::altivector_to_mask<FLOAT_VT>::type>(real_q_blk_size);
    tcle::store(row_sum, softmax_lse + lse_offset, lse_cond);

    q_pp_flag = (q_pp_flag + 1) % kStageQ;
    notify_mailbox(my_task_done_compute_mb);
    cur_idx = (cur_idx + 1) % kCbSlots;
  }
}
```

这段 compute 片段有四个重点：每个 compute subthread 独立维护 32 行的 `running_max/row_sum_acc/out`；K ready 只保护 QK，V ready 延后到 PV 前；P tile 在 L1 中转成 FP8 后立即给 PV 使用；最终写回把 reciprocal(row_sum)、`v_descale` 和 fp16/bf16 conversion 合并。

## 优化点 1：把 varlen prefill 切成 96Q × head 的动态 task

varlen prefill 的第一个问题是工作量不可预测。一个 batch 的 Q 长度可能很短，另一个 batch 很长；同一个 batch 内，causal mask 还会让不同 Q block 对应的 visible KV 长度不同。如果按 `(batch, head)` 静态切给 SIP，长序列会拖尾。如果按固定矩阵块静态切，task 到 batch 的映射又需要复杂 metadata。

实现选择的 task 粒度是：

```text
task = (bid, hid, q_block_off)
q_block_off 每次覆盖 96 行 Q
hid 覆盖一个 query head
```

`Q_DTE` subthread 在本 SIP 内先把 batch metadata 展开到 local：

```text
q_seqlen_buf[i]
k_seqlen_buf[i]
q_pos_buf[i]
batch_idx[i]
batch_q_blocks_buf[i]    = ceil(q_len / 96)
cu_task_per_batch_buf[i] = prefix_sum(batch_q_blocks * q_num_heads)
```

当前实现把这些数组的本地上限定成 `kMaxBatch = 256`，并在 device 侧用 `op_assert(prefill_batchn <= kMaxBatch)` 保护。这个数字不是调度算法的数学属性，而是每个 SIP 复制一份 batch metadata 到 local SDMEM 后的资源契约：6 组 `int[256]` 加一个 prefix 数组足够覆盖目标 prefill batch，同时把 Q DTE 的 metadata 构造留在 SIP 内，不把每个 task 的 batch 查找都变成 L3 小随机读。如果后续要放宽 batch 上限，不能只改 host scheduler；还要同步评估这里的 local metadata footprint 和 `cu_task_per_batch_buf` 的二分边界。

然后所有 SIP 通过：

```c++
int tid = tcle::atomic_add(dynamic_task_id, 1);
```

动态领取 task。领取到 `tid` 后，实现用 upper-bound 风格二分在 `cu_task_per_batch_buf` 中找到 batch，再把局部 task id 分解成 head 和 q block：

```text
b     = upper_bound(cu_task_per_batch_buf, tid) - 1
local = tid - cu_task_per_batch_buf[b]
hid   = local / batch_q_blocks_buf[b]
qboff = local - hid * batch_q_blocks_buf[b]
```

这个设计的优化价值有三层。

第一，动态调度只在 task 边界发生。一个 task 内仍然是规整的 96Q × up to 384KV tile 计算，不会让 atomic 出现在每个 KV tile 或每行 Q 的 hot loop 中。

第二，task 仍然保留 batch/head 语义。K/V DTE 可以按 batch 复用 block table cache；compute 可以按 head 推导 kv head；Q DTE 可以按 batch 判断 q/k length 和 causal offset。若 task 切得过碎，例如每 32 行 Q 一个 task，DTE metadata 和 mailbox 开销会更高；若切得过粗，例如整个 batch/head 一个 task，尾部不均衡更严重。96Q 正好和 3 个 compute subthread 的 32Q 分工一致。

第三，task id 到 batch 的映射不使用除法假设。varlen batch 每个 batch 的 `ceil(q_len/96) * q_num_heads` 不同，无法通过简单除法定位 batch。二分虽然有几次分支，但只在 task 领取时做，并且实现使用 `lo + ((hi - lo + 1) >> 1)` 的上偏写法，避免三路比较和 break，分支形态稳定。

可借鉴的原则是：当输入 shape 导致 workload 非均匀时，不要急着把每个元素都动态化。高性能 kernel 更常见的做法是选一个“内部仍规整、外部可抢占”的 task 粒度。这里的 96Q 不是数学常量，而是由 `3 * 32` 的 subthread 分工、Q DTE 搬运粒度、mailbox 成本和 causal 不均衡共同决定的工程粒度。

## 优化点 2：用六个 subthread 构建异构流水线

这份 kernel 最重要的结构选择，是 `SUB_THREAD_NUM=6` 但只让 3 个 subthread 做 compute。剩下三个 subthread 分别服务 Q、K、V 数据面。

直觉上，attention 是重计算算子，似乎应该让所有 subthread 都做 QK/PV。但实现没有这么做，原因是 FP8 block-table prefill 的数据供应并不便宜：

- Q 要按 varlen `q_pos + local_q_start` 从 compact tensor 中搬入 L1，还要同步搬 `fp8_q_scale`。
- K 要按 block table 解释 physical block，支持 contiguous fast path、layout1、two-block split、cross-task pretrigger。
- V 同样要按 block table 搬运，但搬运形态更偏 contiguous memcpy，和 K 的 deslice/slice 不完全一样。
- compute 侧 QK/PV 会持续读取 L1 K/V，如果 DTE 覆盖得太早，必须用 mirror-space notify 保护 2D read 边界。

如果所有 subthread 都既做 DTE 又做 compute，代码会退化为 tile 级串行：

```text
所有 subthread 搬 Q
sync
所有 subthread 搬 K/V
sync
所有 subthread QK/PV
sync
下一 tile
```

这种形态看起来并行，实际上每个阶段都在等待最慢者。实现选择异构分工后，Q DTE 可以在 compute 处理当前 task 时预取下一 task 的 Q；K/V DTE 可以在 compute 消费当前 tile 时配置或触发下一 tile；compute 只在真正需要 K/V 时等待 mailbox。

三类 subthread 的职责边界非常清楚：

```text
sub 0/1/2:
  只处理自己的 32 Q rows
  保存 running_max / row_sum_acc / out
  负责 QK、mask、scale、softmax、P FP8、PV、输出

sub 3:
  构造本 SIP batch metadata
  通过 atomic_add 抢 task
  写 FpKvCb task ring
  搬 Q 和 q_scale
  发布 q_ready

sub 4:
  读取 task ring
  搬 K
  发布 k_ready
  处理 K DTE cross-task pretrigger

sub 5:
  读取 task ring
  搬 V
  发布 v_ready
  处理 V DTE cross-task pretrigger
```

这个设计的代价是 mailbox 数量和协议复杂。主 kernel 一共分配：

```text
kMbCount = 7 * COMP_SUBTHD_NUM + 4 = 25
```

这些 mailbox 被分摊给 Q/K/V DTE subthread，避免单个 subthread 超过 mailbox 资源限制。复杂性来自真实硬件约束：每个生产者要知道每个 compute consumer 是否已经释放对应 ring slot，每个 consumer 又要独立等待自己的 ready。若用单个计数器表示“所有 compute 都消费完”，很容易产生 lap conflict：某个 consumer 慢一拍，生产者却看到下一轮 counter 误以为当前 slot 可复用。

可借鉴的原则是：subthread 不一定要同构。对 GCU400/libra 的复杂 kernel，subthread 可以承担 pipeline stage，而不是仅仅承担数据切片。判断是否值得这么做，要看 DTE 配置、数据搬运、2D compute、tail 处理是否能重叠。如果数据供应足够复杂，牺牲部分 compute subthread 换持续供数，整体吞吐反而更好。

## 优化点 3：`FpKvCb` 与 mailbox 把控制面从数据面中剥离

`FpKvCb` 看起来只是一个小结构：

```c++
static constexpr int kCbSlots = 3;
struct __attribute__((aligned(64))) FpKvCb {
  volatile int ts_id[kCbSlots];
  volatile int ts_bid[kCbSlots];
  volatile int ts_hid[kCbSlots];
  volatile int ts_qboff[kCbSlots];
};
```

但它是整条流水线的控制中心。Q DTE 抢到 task 后，把 `task_id/bid/hid/q_block_off` 写进 `cb.ts_*[slot]`；K DTE、V DTE 和 compute subthread 在自己的循环里读取同一个 slot。`kCbSlots=3` 让 Q DTE 可以领先消费者最多两个 task，但不会无限抢占。

为什么不用普通 `__local__` 大 buffer 传 metadata？实现注释给出了关键线索：`FpKvCb` 作为 by-value kernel 参数进入 SIP parameter buffer / SDMEM，跨 subthread scalar 访问延迟低于 `__local__` VDMEM。metadata 是少量 int，不适合放进 VDMEM 数据面。把控制面放 SDMEM，把 Q/K/V/P 数据放 L1 VDMEM，是这份实现的一个重要分层。

控制面可见性靠 fence 和 mailbox 一起保证。Q DTE 写完 `cb.ts_*` 后执行：

```c++
tcle::fence<FenceType::L1_SDMEM_STORE>();
notify_mailbox(task_pub_kdte_mb);
notify_mailbox(task_pub_vdte_mb);
```

这个顺序不能反过来。mailbox 只告诉消费者“事件到了”，不自动保证 SDMEM store 已经按消费者需要的顺序可见。实现显式用 `L1_SDMEM_STORE` fence 建立边界，再 notify K/V DTE。compute 侧则通过 `q_ready_mb[i]` 等待，因为 Q DTE 只有在 task metadata 写好、Q DTE event 完成、Q scale 写好后才发布 Q ready。

mailbox 组的语义可以分成三类：

| 类别 | mailbox | 方向 | 保护对象 |
|---|---|---|---|
| task 发布 | `task_pub_kdte_mb`, `task_pub_vdte_mb` | Q DTE -> K/V DTE | `cb.ts_*` 可见 |
| Q ring | `q_ready_mb[i]`, `q_consumed_mb[i]` | Q DTE <-> compute i | Q L1 slot 和 q_scale slot |
| K/V ring | `k_ready/consumed`, `v_ready/consumed` | K/V DTE <-> compute i | K/V L1 slot |
| cb 复用 | `task_done_kdte/vdte/compute[i]` | consumers -> Q DTE | `cb` ring slot 可复写 |

其中最值得学习的是 `notify_mailbox<true>`。compute 在 QK/PV 的 2D dot 之后释放 K/V/Q buffer 时，实现常用：

```c++
notify_mailbox<true>(my_k_consumed_mb);
notify_mailbox<true>(my_v_consumed_mb);
notify_mailbox<true>(my_q_consumed_mb);
```

`mirror_space=true` 的含义不是“更强的普通同步”，而是让 arrive 排在前序 2D L1 read pipeline 之后。对 QK/PV 来说，C++ 代码执行到 notify 不代表 2D RHS/LHS 的硬件读取已经完全 drain。如果 DTE 生产者太早复用同一个 L1 slot，可能覆盖仍被 2D 单元读取的数据。mirror-space notify 保护的是消费者读完，而普通 ready fence 保护的是生产者写完。

这就是 `FlashMLA.md` 中反复强调的同步思想：mailbox 是进度事件，不是数据可见性的万能替代品。每个 ready/free 事件都必须问清楚：它保护的是 SDMEM metadata、VDMEM DTE 写入、还是 2D RHS/LHS 读取完成？这份实现把三类边界分别用 `L1_SDMEM_STORE`、DTE event wait、`L1_VDMEM_STORE` fence 和 mirror-space notify 表达，值得直接借鉴。

## 优化点 4：Q DTE 把 task claim、Q 搬运和下一 task 预取叠在一起

`do_q_dte_loop` 不是简单的 Q loader。它同时承担三个角色：

```text
1. 任务调度者：atomic_add 领取下一个 task
2. 元数据发布者：写 FpKvCb 并通知 K/V DTE
3. Q 数据生产者：DTE 搬 Q，搬 q_scale，发布 q_ready
```

关键优化是重叠 L3 atomic 和 Q DTE。实现在触发当前 Q tile 的 DTE 后，没有立刻等待，而是去领取下一 task、做二分映射、写下一 slot 的 `cb.ts_*`：

```text
trigger current Q DTE
atomic_add claim next task
decode next task metadata
write cb[next_idx]
fence + publish task to K/V DTE
wait current Q DTE
publish q_ready
possibly pretrigger next Q DTE
```

这样 `atomic_add` 的 L3 往返、二分查找和部分 metadata 写入，都被当前 Q DTE 搬运时间覆盖。对 prefill 这种大量 task 的 kernel，task 边界如果每次都串行做 `atomic -> metadata -> DTE -> wait`，吞吐会在短 Q block 或短 KV 场景下明显下降。

Q DTE 还缓存了 K descale 与 softmax scale 的组合：

```text
qk_scale_cache = k_descale[real_batch, kv_head] * softmax_scale_log2e
```

如果当前 task 的 batch 和 kv head 没变，就不重新从 L3 读取 `k_descale`。这在 GQA/MQA 场景尤其重要：多个 query head 可能映射到同一个 kv head。实现通过 `last_qk_scale_bid` 和 `last_qk_scale_kv_head` 判断是否复用。

`load_q_scale_tile_to_l1` 再把 per-row `fp8_q_scale` 与 `qk_scale_cache` 相乘，写到 `q_scale_l1`：

```text
q_scale_l1[row] = fp8_q_scale[global_q_row, hid] * k_descale * softmax_scale_log2e
```

compute hot loop 只需要把这 32 个 fuse scale 搬到 `fp8_q_scale_stack`，然后对 QK scores 做逐行 scale。这样 scale 的多源组合被前移到 Q DTE 阶段，而不是污染每个 KV tile 的 QK/PV hot path。

这里有两个可借鉴点。

第一，DTE subthread 不只是搬数据，也可以做轻量 metadata 和参数预处理。只要这些预处理与 compute 的主 OACC 工作集不冲突，就应该放到 DTE stage 去覆盖数据搬运等待。

第二，scale 融合要按“不变量层级”做。`softmax_scale_log2e` 是全 kernel 不变量，`k_descale` 是 batch/kv-head 级不变量，`fp8_q_scale` 是 row/head 级变量。实现把三者组合到 row 级 L1 stack，使 KV tile 级 hot loop 不再关心前两层不变量。

## 优化点 5：K/V DTE 用 block-table 本地化、连续检测和双 context 隐藏配置成本

K/V cache 的逻辑序列由 block table 指向物理 block。每个 KV tile 最多 384 行，可能跨 block 边界。朴素做法是每个 tile 都从 global block_table 读 block id，然后逐块配置 DTE。实现做了四层优化。

第一层是 block_table 本地化。`kBtSegSize=128`，一次用 `l.vldoa.w oacc766/767` 把 128 个 block table entry 搬到 `bt_stack`。后续如果 `blk_table_idx` 落在 `[bt_seg_start, bt_seg_start+128)`，就直接从 local stack 读。只有 miss 时才重新加载一个对齐段。

第二层是连续检测。对于 `kv_num_heads == 1` 的常见 MQA/单 KV head 场景，实现调用 `detect_phys_contig_bt` 判断 block table 是否物理连续。如果连续，就可以把逻辑 block table 访问折叠成：

```text
physical_block = batch_bt_phys_base + blk_off
```

这样 DTE 源地址计算变成线性地址，不需要频繁查 `bt_stack`。即使 tile 跨两个 logical block，若两个 physical block 连续，实现也会把 `blk_num_l` 从 2 改成 1，让 DTE 搬运合并成一段。

第三层是 K/V 各自选择合适 DTE 形态。K 的 L1 layout 需要 `qk_l1_stride`，对 QK 右操作数更友好；V 的 L1 layout 是连续 `[kv, 128]`，用于 PV。K 路径更多使用 `config_deslice` 或 `config_slice` 保持 head/row layout；V 在 contiguous path 下可以退化成 `config_memcpy`，因为 V head size 固定 128 且 PV RHS 读取更直接。

第四层是 4-context ping-pong。K DTE 有 `tops::local_dte k_ctx[4]`，V DTE 有 `v_ctx[4]`。stage 0 使用 ctx 0/1，stage 1 使用 ctx 2/3；每个 stage 最多处理跨两个 physical block 的两段 DTE。稳定状态下，实现在等待当前 DTE event 之前配置下一 tile：

```text
config next tile
wait current tile event
notify ready
wait consumed credit
trigger next tile
```

这把 DTE descriptor 配置成本放进当前 tile event wait 的覆盖窗口。这个成本对小 tile 或跨 block tile 很敏感；如果配置与等待串行，短序列和跨 block 场景会先暴露固定开销。

更激进的是 cross-task pre-trigger。K/V DTE 在当前 task 的最后一个 tile 发布 ready 后，会读取 `cb[next_idx]`，如果下一 task active，就预配置并触发下一 task 的 tile 0。下一轮 task 进入时，`k_dte_preconfigured` 或 `v_dte_preconfigured` 让 prologue 跳过配置和触发，直接使用已经在飞的 event。

这个优化很容易写错，因为它跨 task 读取 `cb[next_idx]`。实现用 `task_pub_kdte_mb` / `task_pub_vdte_mb` gate 住 cb 可见性，并用 `k_pub_pre_consumed` / `v_pub_pre_consumed` 记录“下一 task 的 task_pub credit 已经被提前消费”。如果下一轮 loop 顶部再 wait 同一个 credit，就会死锁。这个 bool 是典型的流水线边界状态：不是为了业务语义，而是为了维护 mailbox credit 守恒。

可借鉴的原则是：间接访存 kernel 不要只优化最终 load。block_table 解释、DTE descriptor 配置、跨 block split、连续性判断、task 边界第一 tile 触发，都会成为真实成本。高质量实现会把这些控制开销也放入 pipeline，而不是只优化数据搬运带宽。

## 优化点 6：L0P5 buf id 明确分区，避免 cache tag 复用污染

实现在主 kernel 中清理并规划 L0P5 id：

```text
K: 11..13
V: 14..16
Q: 17..19
P: 20..28
```

其中 K/V/Q 都是 3-stage ring，因此各有 3 个 id。P 比较特殊：每个 compute subthread 都有自己的 P buffer，并且 P 也随 `kv_pp_flag` 旋转，所以 3 个 compute subthread × 3 个 KV stage = 9 个 id。

这个设计不是装饰性 metadata，而是服务于 GCU400 的 L0P5 缓存一致性。Q/K/V/P 都会被 2D matrix 指令作为 LHS/RHS 读取。若不同逻辑 buffer 复用同一个 buf id，硬件可能把旧 tile 的 cache line 当成新 tile 使用，或者 invalidation 范围过大导致不必要的 cache 失效。

compute 中每个 task 会：

```c++
int q_buf_id = kQBufIdBase + q_pp_flag;
l0p5_inv(q_buf_id, 1);

int k_buf_id = kKBufIdBase + kv_pp_flag;
l0p5_inv(k_buf_id, kComputeSubthdNum);

int v_buf_id = kVBufIdBase + kv_pp_flag;
l0p5_inv(v_buf_id, kComputeSubthdNum);

int p_buf_id = p_buf_id_base + kv_pp_flag;
l0p5_inv(p_buf_id, 1);
```

这里的 `p_buf_id_base = kPBufIdBase + subthd_idx * kStageKV` 非常关键。P 是每个 compute subthread 私有的 softmax tile。如果三个 compute subthread 共用同一组 P id，就会把不同 Q row block 的 P staging 混在同一个 L0P5 tag 域里。实现让 P 的 id 同时区分 subthread 和 stage，保证 P 的 cache tag 不与 K/V/Q 也不与其他 compute subthread 冲突。

这份实现还体现出一个重要边界：buffer ready/free mailbox 只保证生产消费顺序，不能替代 L0P5 invalidation。DTE 写 L1 后，2D 指令通过 buf id 读取 L1/L0P5 视图；如果不 invalidate 对应 id，2D 可能看到旧缓存。反过来，盲目使用全局 invalidation 会扩大同步成本。实现对每类资源使用独立 id，让 invalidation 范围尽量贴近实际 buffer。

可借鉴的原则是：当 kernel 使用 2D matrix path 时，L1 地址不是唯一的 buffer 身份，buf id 也是数据正确性和性能的一部分。ring buffer 的 stage 数、subthread 私有性、P/K/V 的生命周期，都应该反映到 buf id 规划中。

## 优化点 7：QK 按 3 个 128-column tile 组织，匹配 384 KV block

每个 compute subthread 处理 32 行 Q。对于一个 KV tile，QK 形状是：

```text
Q: 32 x qk_head_size
K: 384 x qk_head_size
S: 32 x 384
```

实现把 384 列分成 3 个 128-column block，每个 128 又通过两个 64-column matrix operand 完成：

```c++
constexpr int kInstrM = 32;
constexpr int kInstrN = 64;
constexpr int kInstrK = 64;

char* lhs_tile = q_l1_tile + k_inner * 32 * sizeof(char);
char* rhs_tile_0 = k_l1_tile + blk * 128 * sizeof(char) + k_inner * 64 * sizeof(char);
char* rhs_tile_1 = rhs_tile_0 + 64 * sizeof(char);

matrix_t<32, 64, char, kFp8DT> m_a(lhs_tile, q_buf_id);
matrix_t<64, 64, char, kFp8DT, LD_COL | PRI_DEFAULT> m_b_0(rhs_tile_0, k_buf_id);
matrix_t<64, 64, char, kFp8DT, LD_COL | PRI_DEFAULT> m_b_1(rhs_tile_1, k_buf_id);
*res_mat[blk] += m_a.template dot<1, 0>(m_b_0);
*res_mat[blk] += m_a.template dot<1, 2>(m_b_1);
```

`res_mat[0..2]` 对应 3 个 128-column score block。这个布局解释了为什么 `kKVBlkSize=384` 是自然值：它正好是 3 个 128 列 QK/PV 段，和 causal mask、P staging、row-wise max/sum 都能对齐。

对 qk_head_size=128 和 192，实现有两条路径。128 路径可以把 stride 和 slice 都变成固定常量：

```text
LHS_DIM1_STRIDE = 128
RHS_DIM0_STRIDE = 128
RHS_DIM1_STRIDE = 1
SLICE_RHS_DIM1_REAL = 128
```

192 路径则使用 `qk_head_size_align=256`，真实 K 维仍然是 qk_head_size，但 L1 stride 是 256。这是典型的“真实数学维度”和“硬件布局 stride”分离。多出来的 padding 不是浪费，而是换来更规整的 2D matrix 读取和更少的地址计算。

实现还通过 `rhs_base_blk += kBlkStride` 避免在内层循环里从 stack 数组加载每个 block 的 RHS 地址。`rhs_base_blk` 是 SR scalar 累加，`rhs_tile_0` 和 `rhs_tile_1` 都是 base 加 immediate offset。这类写法很小，但在完全展开的 QK hot loop 里，少一次 stack load 就能减少 SLDST 压力和寄存器依赖。

QK 结束后，compute 立即 `notify_mailbox<true>(my_k_consumed_mb)`。这不是等整个 KV tile 的 PV 做完才释放 K，因为 K 只服务 QK。K 与 V 的生命周期被拆开：QK 读完 K 后 K ring slot 可以提前还给 K DTE；PV 读完 V 后 V slot 再释放给 V DTE。这个拆分减少 K DTE 的等待时间，是数据流解耦的一部分。

可借鉴的原则是：tile size 应该从 matrix 指令形状反推，而不是只从 L1 容量反推。这里 384KV 的意义在于同时匹配 3×128 scores、64-column matrix 指令、causal mask 分段和 P staging。

## 优化点 8：causal mask 变成 128 列段内的 vector mask

Causal prefill 的 mask 不是简单的下三角矩阵，因为 Q/K 长度可能不同，实现使用：

```c++
int causal_offset = batch_q_len - batch_kv_len;
int mask_len_r0 = local_q_row - local_kv_row + 1 - causal_offset;
```

`mask_len_r0` 表示当前 compute subthread 第 0 行 Q 在当前 KV tile 中可见多少列。第 r 行可见长度是 `mask_len_r0 + r`。如果这个长度小于 384，说明当前 score tile 需要 mask。

实现没有构造二维 mask，也没有在每个元素上做 if。它利用 score 被拆成 3 个 128-column 段的事实，把 mask 分成五类：

```text
只在第 1 个 128 段内
跨第 1/2 段
只在第 2 段内
跨第 2/3 段
只在第 3 段内
```

每类都用 `vset_mb` 构造一维 mask，把非法 lane 置为 `-inf`：

```c++
auto mask = tcle::vset_mb<FLOAT_MVT>(mb_len);
s[col_block][row] = vsel(mask, s[col_block][row], minus_inf);
```

这段代码看起来分支多，但它的优化点是把复杂二维 causal 关系降成少量 128 列段内的一维 vector mask。每一行 Q 的可见长度线性增加，正好可以在展开的 32 行循环里递增 `mb_len`。如果写成通用 `if (kv_col <= q_col)`，会在 hot loop 内引入更多整数计算和 lane 条件。

它还有一个数值正确性细节：mask 发生在 scale 之前。对于被 mask 的 lane，值是 `-inf`；后续乘 fuse scale 仍然保持不可见语义，`exp2(-inf)` 为 0。这样在线 softmax 的 max/sum 逻辑无需额外识别 mask lane。

可借鉴的原则是：mask 的性能不只取决于分支数量，也取决于是否能贴合数据 tile 的自然分段。这里 128 列分段不是为了 mask 单独设计，但 mask 借用了这个分段，从而避免生成大 mask tensor。

## 优化点 9：scale 融合与 base-2 softmax 减少 hot loop 成本

FP8 attention 的 score scale 来自多项：

```text
score = Q_fp8 @ K_fp8^T
score = score * fp8_q_scale[row] * k_descale[batch, kv_head] * softmax_scale
```

实现实际使用 `exp2`，所以 host launch wrapper 把 `softmax_scale` 预乘 `log2(e)`：

```c++
params.softmax_scale * 1.44269504f
```

再由 Q DTE 把它与 K descale、Q scale 融合到 `q_scale_l1`。compute 侧只需要：

```c++
float fuse_scale = fp8_q_scale_stack[r];
s[r] = __gcu_mul_scl_VfVff(s[r], fuse_scale);
```

为什么要用 base-2？因为后续 online softmax 里所有指数都用 `exp2`：

```text
P_tile = exp2(score_log2 - running_max_log2)
alpha  = exp2(prev_max_log2 - cur_max_log2)
```

这样 `running_max`、`pre_max` 和 `cur_max` 都在 log2 scale 下维护。最后写 `softmax_lse` 时，再用：

```text
lse = ln(row_sum) + pre_max * ln(2) - p_scale_ln
```

把结果转换回自然对数语义。

这个设计的收益是指数函数和 scale 语义一致。若 QK 后使用自然指数 `exp`，每个 score 可能需要更多数学转换；若在每个 tile 内才乘 `log2(e)`，又会增加 hot loop 乘法。实现把固定 scale 提前到 host，把 batch/head scale 前移到 Q DTE，把 row scale 存入 L1 stack，hot loop 只保留一次按行乘法。

实现顶部的大量 `FP8KV_MUL_SCL_*` 宏也服务于这个方向。`FP8KV_MUL_SCL_32_PAIR(out, row_sum_acc, diff_exp_stack)` 用同一组从 stack 读取的 scalar 同时缩放 `out` 和 `row_sum_acc`。注释明确说它把两次顺序调用的 64 次 scalar load 降到 32 次，`mul_scl` 次数不变，但减少 SLDST slot。这里优化的是指令下发和标量 load 压力，而不是数学运算次数。

可借鉴的原则是：scale 融合不能只看乘法数量。标量 load、OACC live range、hot loop 中的参数地址计算、指数函数的底数选择，都会影响性能。高质量实现会把 scale 按生命周期分层前移，并让 hot loop 的 scale 指令模板固定。

## 优化点 10：online softmax 把跨 KV 依赖压缩成 OACC 状态

FlashAttention 的核心是 online softmax。本实现每个 compute subthread 对 32 行 Q 维护：

```text
running_max[32]
row_sum_acc[32]
out[32]
```

每个 KV tile 的处理顺序是：

```text
QK 得到 s[32 x 384]
causal mask
scale 到 log2 域
更新 running_max
计算 cur_max
score 减去 cur_max 和 p_scale_log2
exp2 得到 P tile
pre_max = exp2(pre_max - cur_max)
out *= pre_max
row_sum_acc *= pre_max
P tile @ V 累加到 out
row_sum_acc += sum(P tile)
pre_max = cur_max
```

实现中 `running_max` 先对三个 128-column score 段做逐行 max，再通过 `redmax<1>` 写到 `max_stg2_buf`，之后一次 vector load 得到 32 行 `cur_max`。这一步看似绕，但它把 32 个 row 的 horizontal reduction 组织成 TCLE 擅长的 vector reduction，再用 L1 scratch 形成行向量。

P tile 不是以 FP32 保存到大 buffer，而是立即：

```c++
auto p_vec = s[col_block][row] * p_scale_log2;
auto p_base = movsr2tar(s_subthd + col_block * 128 + row * kKVBlkSize);
auto p_stride = movsr2tar(kKVBlkSize * sizeof(char));
internal_tar_cvt_store<__vector char, FLOAT_VT, F8E4M3 | CLAMP>(
    p_vec, p_base, p_stride);
```

写入 `s_subthd`。后续 PV 把这个 `s_subthd` 当成 FP8 P 矩阵的 LHS。这样 QK 输出 FP32，softmax 计算 FP32，PV 输入 FP8。收益是 P staging 只占 FP8 大小，PV 可继续使用 FP8xFP8 的 2D path。代价是 P 精度下降，所以必须通过 `p_scale_log2=log2(256)` 对 P 做放大，再在最终 LSE/normalization 中抵消。

`row_sum_acc` 的更新也有一个小但重要的 hot path 优化。实现不在每个 KV tile 末尾判断是否最后一 tile 并做最终 redsum，而是把 `row_sum_acc` 一直保持为 OACC 向量，KV loop 结束后统一做：

```c++
redsum<1>(row_sum_acc[r])
```

注释说这是为了把一个 branch 和一次地址计算从每个 KV iter 的 hot path 移出去。这个优化体现了实现质量：不仅做大结构优化，也消除 tile loop 中的小控制开销。

可借鉴的原则是：online softmax 的重点不是“公式会写”，而是状态放在哪里、什么时候 reduction、什么时候量化中间 P、什么时候释放 K/V buffer。把跨 tile 数学依赖压缩为少量 OACC 状态，是 FlashAttention 类 kernel 的核心。

## 优化点 11：PV 等待 V ready 的位置尽量靠后

QK 只依赖 K，不依赖 V。PV 才需要 V。实现在每个 KV tile 中先等待 K ready，完成 QK、mask、scale、softmax、P FP8 conversion、row_sum_acc 更新之后，才等待 V ready：

```text
wait K ready
QK + softmax + P staging
wait V ready
PV
notify V consumed
```

注释直接指出：`K-ready is decoupled from V-ready; wait as late as possible so QK and softmax cover the V DTE tail before PV reads V from L1.`

这就是生产消费关系中非常具体的优化点。如果 compute 在 tile 开始时同时等待 K 和 V，那么 V DTE 的尾部延迟会直接阻塞 QK。实际上 QK 阶段可以先跑，只要 PV 前 V ready 即可。K/V ready 分离让 compute 充分利用 QK 和 softmax 的时间覆盖 V 搬运。

PV 的矩阵形状是：

```text
P: 32 x real_kv_blk_size
V: real_kv_blk_size x 128
O: 32 x 128
```

对 full 384 tile，PV 按 `kInstrK=64` 循环 6 次。每次用两个 64-column RHS tile 覆盖 V head 的 128 列：

```c++
matrix_t<32, 64, char, kFp8DT> m_a(lhs_ptr, p_buf_id);
matrix_t<64, 64, char, kFp8DT> m_b_0(rhs_ptr_0, v_buf_id);
matrix_t<64, 64, char, kFp8DT> m_b_1(rhs_ptr_1, v_buf_id);
*out_mat += m_a.template dot<1, 0>(m_b_0);
*out_mat += m_a.template dot<1, 2>(m_b_1);
```

PV 前还会用 `FP8KV_MUL_SCL_32_PAIR` 同时重缩放 `out` 和 `row_sum_acc`。这是 online softmax 的历史状态校正：

```text
old_out *= exp2(prev_max - cur_max)
old_sum *= exp2(prev_max - cur_max)
```

然后当前 P tile 的 `P @ V` 累加到 `out`，当前 P tile 的 sum 累加到 `row_sum_acc`。这样所有 KV tile 结束后，`out / row_sum` 就是完整 softmax output。

可借鉴的原则是：不要把一个 tile 的所有输入 ready 条件放在同一个 barrier 上。若某个阶段只依赖 K，另一个阶段才依赖 V，就应该让 K/V 的 ready mailbox 分离，并把 V wait 后移到真正消费点。

## 优化点 12：最终输出把 normalization、v_descale 和 dtype conversion 合并

KV loop 结束后，compute 先把 `row_sum_acc` 做行内 redsum 得到 `row_sum`。最终 normalization 是：

```text
output = out * (1 / row_sum) * v_descale
```

实现中：

```c++
FLOAT_VT diff_exp = tcle::msf<6>(row_sum) * fp8_v_ds_cache;
out[r] = out[r] * bcast(diff_exp, r);
```

这里 `msf<6>(row_sum)` 可以理解为 reciprocal 类数学函数，用于求 `1/row_sum`。它与 `v_descale` 相乘，形成最终每行的 scale。这样 output 阶段每个元素只需要一次乘法，而不是先除以 row_sum、再乘 v_descale。

写 output 时，实现按 output dtype 分 fp16/bf16：

```c++
tar_cvt_store<FP16_VT, FLOAT_VT>(out[r], out_base, out_stride_tar);
tar_cvt_store<BF16_VT, FLOAT_VT>(out[r], out_base, out_stride_tar);
```

这里 output 指针类型仍是 FP8 kernel 的 `T*`，但注释说明 FP8 output 实际是 fp16/bf16 两字节输出，所以 output offset 乘以 2。这种写法容易误读：`T` 在 kernel 参数上是 `tops::float_e4m3*`，但 output buffer 的真实 dtype 由 `data_type` 控制。实现通过 byte offset 和 TAR store 保证写回正确。

`softmax_lse` 的写法也值得学习。它没有逐行 `bcastInternal + setslice`，而是在 `softmax_lse[hid * total_q + total_q_row]` 这条 q-row 连续维上做一次 masked vector store：

```text
row_sum = ln(row_sum) + pre_max * ln2 - p_scale_ln
store(row_sum, softmax_lse + lse_offset, mask(real_q_blk_size))
```

这是利用 varlen output layout 的连续性。output 的 head dimension 是 128，需要 TAR stride store；LSE 沿 q row 连续，可以 vector store。不同输出使用不同写回策略，说明实现不是机械复用同一种 store。

可借鉴的原则是：最终写回阶段也要融合数学和布局。normalization、descale、dtype conversion、TAR stride、masked vector store 都应该根据输出 layout 分开优化。

## 优化点 13：host launch wrapper 把运行时复杂性提前固定

device kernel 能写得这么特化，是因为 host wrapper 已经筛选了路径。launch wrapper 名称里就固定：

```text
fp8 e4m3 / qk=192 / v=128 / causal / varlen / block-table / use_fuse
```

host wrapper 还做三件重要事情。

第一，分配并清零 `dynamic_task_id`：

```c++
ops::topsopMallocAsync(&dynamic_task_id, sizeof(int), stream, 0);
topsMemsetAsync(dynamic_task_id, 0, sizeof(int), stream);
// device kernel 读取 dynamic_task_id，并用 atomic_add 抢占下一个 task。
// 这个指针只在本次 launch 的生命周期内有效。
ops::topsopFreeAsync(dynamic_task_id, stream);
```

这说明动态 task queue 是 per-launch 临时资源，不是由 op 层永久维护。kernel 内所有 SIP 用它 atomic_add 抢任务。

第二，把 `softmax_scale` 乘 `log2(e)` 传入 device，把 `p_scale_log2=8`、`p_scale_ln=ln(256)` 固定。device hot loop 不需要再知道这些常量的来源。

第三，把 `FpKvCb cb{}` 作为 by-value kernel 参数传入。每个 SIP 获得自己的 SDMEM-resident copy，用作 subthread 间控制块。这种用 kernel 参数承载控制面结构的写法值得关注：它既不是 global workspace，也不是普通 local VDMEM 大数组，而是利用参数空间适合小标量共享的特性。

可借鉴的原则是：高性能特化 kernel 的 host wrapper 不是简单转发参数。它应该把路径选择、临时资源、常量变换、控制结构初始化都前移，让 device hot path 尽可能面对固定形状和固定协议。

## 数据流细节

这份 kernel 的数据流可以分为 Q、K、V、P、统计量和输出六条线。

Q 数据流：

```text
L3 query[total_q, q_heads, q_head_dim]
  -> Q DTE subthread local_dte slice
  -> L1 q[kStageQ][3 compute][32 rows][stride 128/256]
  -> compute subthread matrix_t LHS
```

同时 Q scale 数据流：

```text
L3 fp8_q_scale[total_q, q_heads]
L3 k_descale[batch, kv_head]
host softmax_scale_log2e
  -> Q DTE 融合
  -> L1 q_scale_l1[kStageQ][96 rows]
  -> compute fp8_q_scale_stack[32]
  -> QK scores row-wise mul_scl
```

K 数据流：

```text
L3 block_table[batch, block_id]
  -> K DTE bt_stack[128] 或 contiguous base
L3 key physical blocks
  -> K DTE config_deslice/config_slice
  -> L1 k[kStageKV][384 rows][stride 128/256]
  -> compute QK RHS matrix_t
```

V 数据流：

```text
L3 block_table
  -> V DTE bt_stack[128] 或 contiguous base
L3 value physical blocks
  -> V DTE config_memcpy/config_slice
  -> L1 v[kStageKV][384 rows][128]
  -> compute PV RHS matrix_t
```

P 数据流：

```text
QK scores in OACC/FLOAT_VT
  -> mask + scale + exp2
  -> internal_tar_cvt_store FP8 E4M3
  -> L1 s[compute_subthread][32 rows][384 cols]
  -> PV LHS matrix_t
```

统计量数据流：

```text
running_max[32] in OACC
row_sum_acc[32] in OACC
max_stg2_buf[128] L1 scratch for redmax
redsum_stg2_buf[128] L1 scratch for redsum
  -> row_sum vector
  -> output normalization
  -> softmax_lse store
```

输出数据流：

```text
out[32][128] OACC FP32 accumulator
  -> multiply reciprocal(row_sum) * v_descale
  -> tar_cvt_store to fp16/bf16 output
row_sum/pre_max
  -> ln + ln2 correction - p_scale_ln
  -> vector store softmax_lse
```

这六条线的关键关系是：Q/K/V 是生产者 DTE 供应的数据；P 是 compute 内部产生并立即消费的中间数据；统计量跨 KV tile 驻留；output 只在 task 尾部写一次。理解这些生命周期后，实现里的 ring stage、mailbox、L0P5 id、scratch buffer 和 mirror-space notify 才有清晰解释。

## 计算流细节

每个 compute subthread 的计算流是：

```text
等待 Q ready
读取 task metadata
确定 local_q_row 和 visible KV 上界
初始化 out/row_sum/running_max
for each KV tile from tail to head:
  等 K ready
  QK: FP8 Q x FP8 K -> FP32 scores
  释放 K consumed
  causal mask
  row-wise scale 到 log2 域
  running max update
  exp2(scores - max - p_scale_log2)
  P FP8 store
  old out/sum 按 exp2(prev_max - cur_max) 重缩放
  P row sum 累加到 row_sum_acc
  等 V ready
  PV: FP8 P x FP8 V -> FP32 out
  释放 V consumed
redsum row_sum_acc
释放 Q consumed
normalize out and store output
store softmax_lse
发布 task_done_compute
```

这里最重要的是顺序依赖和可并行部分的分离。`running_max` 和 `row_sum_acc` 必须按 KV tile 顺序更新，不能乱序；但 K DTE、V DTE、Q DTE 与 compute 可以异步推进。实现通过 mailbox 把“数学顺序”保持在每个 compute subthread 内，把“数据准备顺序”交给生产者 subthread 维护。

QK 和 PV 的 compute 都使用 2D matrix path。QK 是 `32xK` 乘 `Kx384`，PV 是 `32x384` 乘 `384x128`。两个阶段中间没有把 scores 写到 global，也没有把 P 写成 FP32。中间 P 写到 L1 FP8 是计算流与数据流的交界点：它既是 softmax 的输出，也是 PV 的输入。

compute 流里有两个“延后等待”：

- V ready 延后到 PV 前。
- row_sum redsum 延后到所有 KV tile 后。

这两处都是为了减少 hot loop 中不必要等待或分支。可借鉴的是：在写复杂 kernel 时，不仅要问“这个数据什么时候产生”，还要问“消费者最晚什么时候必须等待它”。等待点越靠近真实消费点，流水线越容易隐藏前序延迟。

## block、thread、subthread 任务划分

GCU400 launch 的 grid/block 细节由 host 上层传入，但 device 内的主要划分可以概括为三层。

block/SIP 层：

```text
每个 SIP 独立运行 6 个 subthread
所有 SIP 通过 dynamic_task_id 抢全局 task
task 粒度是 96 Q rows × 1 query head × 1 batch
```

SIP 之间没有共享 K/V/P buffer，也不需要同步。负载均衡依赖 `atomic_add`，任务完成顺序不影响 output 正确性，因为每个 task 写不同 `(batch, head, q rows)`。

thread/subthread 层：

```text
subthread 0: compute rows 0..31 of a 96Q task
subthread 1: compute rows 32..63
subthread 2: compute rows 64..95
subthread 3: Q DTE + scheduler
subthread 4: K DTE
subthread 5: V DTE
```

compute subthread 之间不协作同一 row，也不需要归约。每个 compute subthread 的 softmax 是自己 32 行独立完成。这避免了跨 subthread 合并 running max/sum 的复杂性。三者共享 K/V tile，但通过 per-consumer mailbox 分别释放。

tile 层：

```text
Q tile: 每 task 96 rows，内部每 compute subthread 32 rows
KV tile: 每轮最多 384 rows
QK score tile: 每 compute subthread 32 x 384
P/PV tile: P 32 x 384，V 384 x 128，O 32 x 128
```

K/V DTE 的 tile 顺序从可见 KV 的尾部向前：

```text
local_kv_row = (num_tiles - 1) * 384
每轮 local_kv_row -= 384
```

这个反向遍历适配 causal prefill 的尾部 tile。最后一段可见 KV 可能不是 384，它先处理 partial tile，然后后续都按 full 384 处理。mask_len 也随 `local_kv_row` 更新。

可借鉴的划分原则是：对 attention 这类 row-wise softmax，最好让一个 row 的完整 softmax 状态留在同一个 compute worker 内。跨 worker 切 KV 需要合并 max/sum/out，复杂度会显著提高。本实现选择让更多 SIP 抢更多 96Q task 来获得并行度，而不是在一个 row 内跨 subthread 并行归约。

## C++、TCLE 与 ISA 写法技巧

这份实现值得学习的 C++/TCLE 技巧很多，下面按用途归类。

第一类是编译期特化。

`FAConfig<192>` 把 Q block、KV block、L1 align 和 V head 固定。`FP8MatrixMode<T>` 把 `tops::float_e4m3` 映射到 `MatrixMode::DT_E4M3`。`InstrSlice<M>` 把 32/64 映射到 slice 常量。这样 hot loop 中大量 shape 变成 constexpr，matrix_t 和 setslice 能生成更固定的指令模板。

第二类是分支预测与 hot/cold 路径。

实现大量使用 `LIKELY/UNLIKELY`。例如 full Q block、single kv head、block table contiguous、full KV tile 都是 likely；inactive task、cross batch、partial tile、non-contiguous block table 是 unlikely。对 GCU kernel 来说，这不只是 CPU 风格提示，也有助于编译器安排 hot path 的代码布局和寄存器使用。

第三类是 mailbox id hoist。

compute loop 开头把 `my_q_ready_mb`、`my_k_ready_mb`、`my_v_ready_mb` 等读入 SR 局部变量。注释说明 `wait_mailbox` 带 memory clobber，如果每次循环都从 `mb_ids` 读 mailbox id，会引入额外 SDMEM load 和 alias 保守性。hoist 后 hot loop 使用标量寄存器中的 mailbox id。

第四类是手写 inline asm。

`FP8KV_MUL_SCL_32` 和 `FP8KV_MUL_SCL_32_PAIR` 通过固定 r30..r22 作为 scalar load 寄存器，把 stack 中 32 个 scale 与 OACC vector 的乘法打包。PAIR 版本让同一个 scale 同时作用于 `out` 和 `row_sum_acc`，减少一半 scalar load。它不是为了可读性，而是为了明确控制 SLDST 与 MALU 指令交错。

第五类是 local DTE context 复用。

K/V DTE 中 `ctx_inited` 为 true 时，只更新 src/dst 地址和 dim size；首次才 `config_*`。这比每个 tile 重建 mdspan 和完整 config 更轻。对于 block_table 连续 fast path，很多 tile 都能复用同一类 DTE descriptor。

第六类是 scratch buffer 的向量化 reduction。

`max_stg2_buf` 和 `redsum_stg2_buf` 是每个 compute subthread 私有的 L1 scratch。实现用 `redmax<1>` / `redsum<1>` 把每行向量归约成标量，再通过 vector load 形成 32 行向量。这避免了 32 次标量散读散写。

第七类是 `noinline`、`aligned(16384)` 和 `no_mem_alias_in_vldst_tar`。

`do_compute_loop` 被标记为 noinline 且 16KB 对齐，注释说是为了 ICache locality；`no_mem_alias_in_vldst_tar` 避免 VLDST/TAR alias 分析过度保守；`FP8KV_MAXNREG` 控制 OACC 分配，避免 spill。高性能 kernel 的函数属性不是装饰，它直接影响代码布局、寄存器预算和 load/store 调度。

第八类是 sentinel 和 credit 状态。

`bt_seg_start = -kBtSegSize` 作为 block table cache miss sentinel，任何非负 block index 都会 miss，从而触发首次加载。`k_pub_pre_consumed`、`v_pub_pre_consumed` 记录提前消费的 task_pub credit，避免下一轮重复 wait。`q_prefetched` 记录下一 Q DTE event 是否已经触发。它们都是流水线正确性状态，少一个就可能死锁或读旧 metadata。

这些技巧的共同点是：C++ 抽象没有脱离硬件。模板、宏、函数属性、volatile、fence、TAR、OACC、DTE context 都服务于同一个目标，即让 hot loop 的指令序列固定、数据依赖可控、buffer 生命周期清楚。

## 边界处理与正确性细节

第一，inactive task 也必须推进协议。若 `local_q_start >= local_q_end`，Q DTE 不搬 Q，但仍然 notify `q_ready_mb_*`；compute 读到 task 后跳过并 notify `task_done_compute_mb`。K/V DTE 也会在 inactive 分支 notify task_done。这样 cb ring 的 credit 不会因为空 task 断裂。

第二，KV visible length 可能为 0。K/V DTE 和 compute 都有 `real_kv_seqlen <= 0` 的 skip 逻辑。compute 对没有 KV 的任务不会进入 QK/PV；最终 direct-output fallback 还处理 causal overflow 区域，把 output 置 0，把 LSE 固定置为 `-inf`。这里不能套用第 02/03 篇里部分通用路径的 `k_seqlen == 0 -> +inf` sentinel；当前专用 FP8 E4M3 192 causal 文件的 fallback 代码直接写 `float inf_val = -kInf`。

第三，block table 跨 batch pretrigger 必须重置或强制重载。K/V DTE 在 cross-task pretrigger 中如果发现 next task 跨 batch，并且不是 physical contiguous path，就会重新加载下一 batch 的 block table segment。否则当前 batch 的 `bt_stack` 可能在相同 table index 范围内命中，但内容属于旧 batch，这是非常隐蔽的错误。

第四，partial Q block 和 partial KV tile 都有 mask。Q scale load 对 `real_q_blk_size < 32` 使用 masked load/store；LSE store 使用 `real_q_blk_size` mask；causal mask 对 partial visible columns 用 `vset_mb`。这些 tail 没有交给全局 padding 假设。

第五，output dtype 与 kernel T 类型不同。kernel 名称是 FP8 E4M3，`T` 是 `tops::float_e4m3`，但 output 实际写 fp16 或 bf16。实现用 `data_type` 选择 `tar_cvt_store<FP16_VT>` 或 `tar_cvt_store<BF16_VT>`，并在地址计算中按 2 字节输出修正 offset。读这段不能只看指针类型。

第六，mailbox credit 必须守恒。所有 producer ring 初始都会预置 `kStageQ` 或 `kStageKV` 个 consumed credit；task_done mailbox 预置 `kCbSlots` 个 credit。每个 active/inactive/sentinel iteration 都要成对消费和归还。cross-task pretrigger 提前消费 task_pub 后，必须用 bool 在下一轮跳过 wait。

第七，L0P5 invalidation 与 mailbox 是两套边界。ready mailbox 表示 L1 数据已经由 DTE 写好，但 2D path 是否看到新数据还需要对应 buf id 的 invalidation。consumed mailbox 表示 slot 可复用，但如果前序 2D read 未 drain，则必须 mirror-space notify。

这些边界处理说明实现不是只为常规长序列写的。真正高质量的 kernel 必须让空行、短行、跨 batch、partial tile、layout1、single/multi kv head、contiguous/non-contiguous block table、fp16/bf16 output 都能落在同一协议闭环里。

## 优化思路借鉴

这份实现最值得借鉴的不是某个单独 API，而是一组设计方法。

第一，把性能矛盾先分类。这里的矛盾包括 varlen 负载不均、block_table 间接访存、DTE/compute 速率不同、FP8 scale 多层级、online softmax 跨 tile 依赖。实现的优化点都能回到这些矛盾，而不是零散 trick。

第二，选对 task 粒度。96Q × head 让 task 内部规整、task 间可抢占。类似 kernel 在设计 task 时，也应该找一个内部可用固定 tile 执行、外部足够细以均衡 workload 的粒度。

第三，subthread 可以异构化。不要默认所有 subthread 做相同事情。只要数据供应、metadata 和 compute 可以重叠，异构 pipeline 往往比同构切片更强。

第四，控制面和数据面分离。小 metadata 放 SDMEM parameter buffer 或 local scalar-friendly 区域，大数据放 L1 VDMEM；mailbox 只表达进度，fence/event/mirror-space 表达内存顺序。

第五，DTE 优化不止是带宽。descriptor config、block_table cache、contiguous detection、ctx reuse、cross-task pretrigger 都会影响端到端速度。

第六，L0P5 buf id 是资源规划的一部分。K/V/Q/P 的 stage 和 subthread 私有性都要反映到 id 分配，否则 cache tag 复用会带来 correctness 或 performance 问题。

第七，scale 和 normalization 要按生命周期融合。host 级常量、batch/head 级 descale、row 级 q scale、tile 级 max/sum，应放在各自最合适的阶段处理。

第八，online softmax 的实现要围绕状态生命周期。`running_max`、`row_sum_acc`、`out` 必须跨 KV tile 驻留；P tile 应该尽快消费；row_sum reduction 应该从 tile hot loop 移出。

第九，等待点要推迟到真实消费点。V ready 不需要阻塞 QK；K consumed 不需要等 PV；Q consumed 要等 2D read drain。这种细分比单个大 barrier 更重要。

第十，复杂流水线一定要显式维护 credit 状态。`q_prefetched`、`k_pub_pre_consumed`、`v_pub_pre_consumed`、`ctx_inited`、`bt_seg_start` 这些状态看似琐碎，但它们是 pipeline 正确性的账本。

## 可验证点与测试建议

如果要验证这份 kernel，不能只测一个普通长序列。至少要覆盖以下场景。

第一，varlen 任务映射。构造多个 batch，q_len 分别小于 96、等于 96、略大于 96、多倍 96，确认 dynamic task 输出与 reference 一致。

第二，causal offset。覆盖 `q_len == k_len`、`q_len > k_len`、`q_len < k_len`。尤其是 `q_len > k_len` 时 direct-output fallback 的 output zero 和 LSE `-inf` 语义。若框架侧希望空 KV 使用 `+inf` sentinel，需要回到当前实现确认这条专用路径是否也应该改；报告不能把其它 kernel 的 sentinel 约定搬过来。

第三，block table 形态。覆盖 physical contiguous、跨两个连续 physical block、跨两个不连续 physical block、跨 batch pretrigger 后 block table index 范围相同但内容不同。

第四，kv head 映射。覆盖 `kv_num_heads == 1` 和 `q_num_heads > kv_num_heads` 的 GQA 场景，确认 k/v descale cache 在 batch/head 切换时不会复用错误。

第五，tail。覆盖最后 Q block 不满 32/96，最后 KV tile 不满 384，causal mask 只落在第一段、跨第一二段、只落第二段、跨第二三段、只落第三段。

第六，dtype。覆盖 fp16 output 和 bf16 output，确认地址 offset 的 2 字节修正和 TAR conversion 正确。

第七，压力场景。构造大量短 task，观察 dynamic_task_id atomic 和 Q DTE prefetch 是否成为瓶颈；构造少量超长 task，观察 K/V DTE 与 compute 的 overlap 是否有效。

第八，同步边界。用 sanitizer 或调试版本观察去掉 mirror-space notify、去掉 L0P5 invalidation、去掉 SDMEM fence 时是否出现随机错误。这类测试能证明同步不是冗余代码。

## 总结

`flash_attn_varlen_fwd_blktb_prefill_fp8_e4m3_192_causal_kernel_gcu400` 是一份高质量 GCU400/libra 特化 kernel。它的核心价值不在于把 FlashAttention 公式搬到设备上，而在于把 varlen prefill、paged KV、FP8 scale、causal mask、online softmax、DTE 和 2D matrix path 组织成一条可持续供数的 SIP 内异构流水线。

这份实现最重要的优化思路可以概括为：

```text
动态 task 解决跨 SIP 负载均衡
异构 subthread 解决 SIP 内 DTE/compute 重叠
FpKvCb + mailbox 解决控制面协议
block_table cache + DTE ctx reuse 解决 paged KV 搬运开销
L0P5 id 分区解决 2D buffer 身份和 invalidation
scale 前移与 base-2 softmax 解决 FP8 hot loop 成本
online softmax + P FP8 staging 解决 scores 存储爆炸
延后 V wait 与 mirror-space release 解决生产消费边界
```

如果把旧式报告写成“某段实现出现了哪些关键词”，读者只能得到流水账。真正应该学习的是：每个结构为什么存在，解决了哪个瓶颈，付出了什么复杂性，哪些原则能迁移到其他 GCU400 kernel。按这个标准看，本篇可以作为后续重写 110 篇报告的模板之一：先抓性能矛盾，再给报告内实现片段，再讲数据流和计算流，最后总结可借鉴的写法和正确性边界。
