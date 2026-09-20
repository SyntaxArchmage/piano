# 28. Top-K Renorm Probs GCU400

Top-K Renorm Probs 接收一行一行的 FP32 probability，按每行的 `k` 只保留概率最大的集合，其它位置置 0，再把保留概率重新归一化。GCU400 路径没有返回 index，也不维护有序 top-k 列表；它把问题改成阈值搜索：找到一个 pivot，使 `p > pivot` 的元素数量覆盖 top-k 保留集合，然后做 mask、sum、normalize。

这个选择是整篇报告的主线。dense 输出 `[B, C]` 不需要 top-k 顺序时，排序、heap、pair buffer、index buffer 都是额外状态；阈值搜索虽然会多次 scan 大词表 C 维，但每次 scan 都是顺序、向量化、可用 DTE chunking 的 streaming 访问，更适合 sampling 后处理。

## 0.1 API 与参数契约

入口先拒绝 scatter memory，然后走 op 对象的 `CheckArgs -> PreHandle -> Compute -> PostHandle`。这里有一个容易漏掉的语义：如果 `top_k_arr` 存在，op 层只校验它的 rank、shape、dtype，不逐元素检查 `k > 0`；因此 per-row `k` 的正值约束属于调用侧契约。没有 `top_k_arr` 时，标量 `top_k_val` 必须大于 0。

```cpp
topsopStatus_t topsfiTopKRenormProbs(
    topsopTensorHandle_t renormed_prob,
    const topsopTensorHandle_t probs,
    const topsopTensorHandle_t top_k_arr,
    const int64_t top_k_val,
    topsStream_t stream) {
  if (!IsScatterMemoryDisable()) {
    // 该 op 没有 scatter memory 分支；提前返回比进入 kernel 后再处理安全。
    return TOPSOP_STATUS_NOT_SUPPORT;
  }

  OpFlashInferTopKRenormProbs op;
  op.configArgs(reinterpret_cast<topsopTensor*>(probs),
                reinterpret_cast<topsopTensor*>(top_k_arr),
                reinterpret_cast<topsopTensor*>(renormed_prob),
                top_k_val, stream);

  // zero shape 被当作空操作成功返回；其它参数错误交给 CheckArgs。
  if (op.HaveZeroShapes()) {
    return TOPSOP_STATUS_SUCCESS;
  }

  topsopStatus_t status = op.CheckArgs();
  if (status != TOPSOP_STATUS_SUCCESS) return status;

  status = op.PreHandle();
  if (status != TOPSOP_STATUS_SUCCESS) return status;

  status = op.Compute();
  if (status != TOPSOP_STATUS_SUCCESS) return status;

  status = op.PostHandle();
  if (status != TOPSOP_STATUS_SUCCESS) return status;
  return status;
}
```

`CheckArgs()` 只允许二维 FP32 概率输入与二维 FP32 输出，且 shape 完全一致。可选 `top_k_arr` 必须是 `[B]` 的 I32。

```cpp
topsopStatus_t CheckArgs() const override {
  if (!CheckMemoryValid() || !CheckTensorsFormat()) {
    return TOPSOP_STATUS_BAD_PARAM;
  }

  topsopTensor* probs = inputs_[0];
  topsopTensor* top_k_arr = inputs_[1];
  topsopTensor* renormed_prob = outputs_[0];

  if (probs == nullptr || renormed_prob == nullptr) {
    return TOPSOP_STATUS_BAD_PARAM;
  }

  if (!Exist(top_k_arr) && top_k_val_ <= 0) {
    // 只有标量 k 走这里；per-row top_k_arr 的每个元素不在 op 层扫描。
    return TOPSOP_STATUS_BAD_PARAM;
  }

  if (probs->dims[0] == 0 || probs->dims[1] == 0) {
    return TOPSOP_STATUS_BAD_PARAM;
  }
  if (probs->rank != 2 || renormed_prob->rank != 2) {
    return TOPSOP_STATUS_BAD_PARAM;
  }
  for (int i = 0; i < probs->rank; ++i) {
    if (renormed_prob->dims[i] != probs->dims[i]) {
      return TOPSOP_STATUS_BAD_PARAM;
    }
  }

  if (probs->data_type != TOPSOP_DATA_FP32 ||
      renormed_prob->data_type != TOPSOP_DATA_FP32) {
    return TOPSOP_STATUS_NOT_SUPPORT;
  }

  if (Exist(top_k_arr)) {
    if (top_k_arr->rank != 1 || top_k_arr->dims[0] != probs->dims[0]) {
      return TOPSOP_STATUS_BAD_PARAM;
    }
    if (top_k_arr->data_type != TOPSOP_DATA_I32) {
      return TOPSOP_STATUS_NOT_SUPPORT;
    }
  }

  return TOPSOP_STATUS_SUCCESS;
}
```

GCU400 host 分支只实例化 `float + int32_t`。`probs_rows` 仍在签名里传递，但 GCU400 kernel 实际只用 `batch_num` 和 `classes_num` 描述 `[B, C]`。

```cpp
topsopStatus_t Compute() override {
  topsopTensor* probs = inputs_[0];
  topsopTensor* renormed_prob = outputs_[0];

  int64_t batch_num = probs->dims[0];
  int64_t probs_rows = batch_num;
  int64_t classes_num = probs->dims[1];

  int64_t numBlocks = GetDeviceBlockNumber();
  int64_t dimBlocks = GetDeviceThreadNumber();

  if (GetTargetArch() >= 400) {
    if (probs->data_type == TOPSOP_DATA_FP32 &&
        renormed_prob->data_type == TOPSOP_DATA_FP32) {
      TOPSCHECK((top_k_renorm_prob_host_gcu400<float, int32_t>(
          numBlocks, dimBlocks,
          reinterpret_cast<float*>(inputs_handle_[0]),
          reinterpret_cast<float*>(outputs_handle_[0]),
          reinterpret_cast<int32_t*>(inputs_handle_[1]),
          batch_num, probs_rows, classes_num, top_k_val_, stream_)));
    }
  }

  return TOPSOP_STATUS_SUCCESS;
}

template <typename DTypeHost, typename IdTypeHost>
__host__ topsError_t top_k_renorm_prob_host_gcu400(
    int64_t numBlocks, int64_t dimBlocks,
    DTypeHost* probs, DTypeHost* renormed_prob, IdTypeHost* top_k_arr,
    int64_t batch_num, int64_t probs_rows,
    int64_t classes_num, int64_t top_k_val, topsStream_t stream) {
  using DType = typename cc_kernel::UnderlyingType<DTypeHost>::type;
  using IdType = typename cc_kernel::UnderlyingType<IdTypeHost>::type;

  // probs_rows 是兼容签名参数；GCU400 kernel 的行数来自 batch_num。
  top_k_renorm_prob_gcu400<DType, IdType>
      <<<numBlocks, dimBlocks, 0, stream>>>(
          reinterpret_cast<DType*>(probs),
          reinterpret_cast<DType*>(renormed_prob),
          reinterpret_cast<IdType*>(top_k_arr),
          batch_num, classes_num, top_k_val);

  CC_KERNEL_LAUNCH_CHECK();
}
```

## 0.2 Kernel 顶层：行级并行 + 行内 subthread 切 C 维

每个 thread 处理若干 batch 行；同一行的 C 维由 `DEFAULT_SUBTHREAD_NUM` 个 subthread 均分。subthread0 负责 DTE 读入、标量 `k` 和 pivot 元数据写入；所有 subthread 负责扫描自己的 classes slice，再把局部 count/sum/max 写到 L1 shared 区，由 subthread0 汇总。

```cpp
#define TOPK_RENORM_MAX_ITERATIONS 64
#define ALIGN_UP(addr, align) (((addr) + (align) - 1) & ~((align) - 1))
#define ALIGN_DOWN(x, align)  (((x) / (align)) * (align))

#define CALC_MY_RANGE(curr_c, my_start, my_count, subthread_id)              \
  do {                                                                        \
    int base = (curr_c) / DEFAULT_SUBTHREAD_NUM;                              \
    int extra = (curr_c) - base * DEFAULT_SUBTHREAD_NUM;                      \
    if ((subthread_id) < extra) {                                             \
      (my_count) = base + 1;                                                  \
      (my_start) = (subthread_id) * (my_count);                               \
    } else {                                                                  \
      (my_count) = base;                                                      \
      (my_start) = extra * (base + 1) + ((subthread_id) - extra) * base;       \
    }                                                                         \
  } while (0)

struct L1Shared {
  float*  local_sum_0;    // 每个 subthread 的保留概率和
  int*    local_cnt_0;    // count(p > pivot_0)
  int*    local_cnt_1;    // count(p > pivot_1)
  int*    local_cnt_2;    // count(p > pivot_2)
  int*    local_cnt_3;    // count(p > pivot_3)
  float*  local_min_gt;   // 大于 low 的最小离散概率
  float*  local_max_le;   // 不大于 high 的最大离散概率
  float*  local_max;      // 每个 subthread 的局部最大值
  double* low;
  double* high;
  double* pivot_0;
  double* pivot_1;
  double* pivot_2;
  double* pivot_3;
  float*  normalizer;
  int*    k;
  bool*   converged;
};
```

L1 布局先放概率 chunk，再放 shared 统计数组和 scalar。chunk 大小不是硬编码，而是从 `GCU_VDMEM_SIZE_PER_THREAD` 扣除 shared/scalar 开销后反推，并按 `DEFAULT_SUBTHREAD_NUM * vlen` 对齐；这能减少 subthread 切片后的尾部标量处理。

```cpp
template <typename probs_t, typename id_t>
__thread_dims__(DEFAULT_SUBTHREAD_NUM, 1, 1) __global__
void top_k_renorm_prob_gcu400(probs_t* probs, probs_t* renormed_prob,
                              id_t* top_k_arr,
                              int64_t batch_num,
                              int64_t classes_num,
                              int64_t top_k_val) {
  const int thread_num = cc_kernel::GetThreadNum();
  const int thread_id = cc_kernel::GetThreadIdx();
  const int subthread_id = subThreadIdx.x;

  constexpr int bpe = sizeof(probs_t);
  constexpr int vlen = TCLE_MAX_VECTOR_LENGTH / sizeof(probs_t);

  const int64_t N = batch_num;
  const int64_t C = classes_num;

  __local__ __valigned__ char l1_mem[GCU_VDMEM_SIZE_PER_THREAD];

  constexpr int shared_array_bytes =
      ALIGN_UP(8 * DEFAULT_SUBTHREAD_NUM * sizeof(float), 128);
  constexpr int scalar_bytes =
      ALIGN_UP(6 * sizeof(double) + 2 * sizeof(float) +
               sizeof(int) + sizeof(bool), 128);
  constexpr int overhead_bytes = shared_array_bytes + scalar_bytes + 128;
  constexpr int probs_buf_bytes = GCU_VDMEM_SIZE_PER_THREAD - overhead_bytes;
  constexpr int probs_buf_elems_raw = probs_buf_bytes / bpe;
  constexpr int sub_grain = DEFAULT_SUBTHREAD_NUM * vlen;

  constexpr int l1_c_size_full =
      ALIGN_DOWN(probs_buf_elems_raw, sub_grain);
  constexpr int l1_c_size_half =
      ALIGN_DOWN(probs_buf_elems_raw / 2, sub_grain);

  size_t off = 0;
  probs_t* l1_probs = reinterpret_cast<probs_t*>(l1_mem + off);
  off += l1_c_size_full * bpe;
  off = ALIGN_UP(off, 128);

  L1Shared s;
  s.local_sum_0  = reinterpret_cast<float*>(l1_mem + off);
  off += DEFAULT_SUBTHREAD_NUM * sizeof(float);
  s.local_cnt_0  = reinterpret_cast<int*>(l1_mem + off);
  off += DEFAULT_SUBTHREAD_NUM * sizeof(int);
  s.local_cnt_1  = reinterpret_cast<int*>(l1_mem + off);
  off += DEFAULT_SUBTHREAD_NUM * sizeof(int);
  s.local_cnt_2  = reinterpret_cast<int*>(l1_mem + off);
  off += DEFAULT_SUBTHREAD_NUM * sizeof(int);
  s.local_cnt_3  = reinterpret_cast<int*>(l1_mem + off);
  off += DEFAULT_SUBTHREAD_NUM * sizeof(int);
  s.local_min_gt = reinterpret_cast<float*>(l1_mem + off);
  off += DEFAULT_SUBTHREAD_NUM * sizeof(float);
  s.local_max_le = reinterpret_cast<float*>(l1_mem + off);
  off += DEFAULT_SUBTHREAD_NUM * sizeof(float);
  s.local_max    = reinterpret_cast<float*>(l1_mem + off);
  off += DEFAULT_SUBTHREAD_NUM * sizeof(float);

  off = ALIGN_UP(off, 8);
  s.low     = reinterpret_cast<double*>(l1_mem + off); off += sizeof(double);
  s.high    = reinterpret_cast<double*>(l1_mem + off); off += sizeof(double);
  s.pivot_0 = reinterpret_cast<double*>(l1_mem + off); off += sizeof(double);
  s.pivot_1 = reinterpret_cast<double*>(l1_mem + off); off += sizeof(double);
  s.pivot_2 = reinterpret_cast<double*>(l1_mem + off); off += sizeof(double);
  s.pivot_3 = reinterpret_cast<double*>(l1_mem + off); off += sizeof(double);

  off = ALIGN_UP(off, 4);
  s.normalizer = reinterpret_cast<float*>(l1_mem + off); off += sizeof(float);
  s.k          = reinterpret_cast<int*>(l1_mem + off);   off += sizeof(int);
  s.converged  = reinterpret_cast<bool*>(l1_mem + off);  off += sizeof(bool);

  const int l1_c_size = l1_c_size_half;
  const int num_chunks_mc = (static_cast<int>(C) + l1_c_size - 1) / l1_c_size;
  const bool single_chunk = (static_cast<int>(C) <= l1_c_size_full);

  tops::local_dte probs_in_dte;
  if (subthread_id == 0) {
    probs_in_dte.init();
  }
  tops::mdspan in_hbm(tops::Global, probs, N, C);

  for (int n_idx = thread_id; n_idx < N; n_idx += thread_num) {
    if (subthread_id == 0) {
      *s.k = (top_k_arr == nullptr)
                 ? static_cast<int>(top_k_val)
                 : static_cast<int>(top_k_arr[n_idx]);
      *s.converged = false;
    }
    __syncsubthreads();

    int k = *s.k;
    if (k >= C) {
      copy_row_by_chunks(probs_in_dte, in_hbm, l1_probs,
                         renormed_prob, n_idx, C, l1_c_size_full,
                         subthread_id);
      continue;
    }

    if (single_chunk) {
      process_single_chunk(l1_probs, renormed_prob, &s,
                           probs_in_dte, in_hbm,
                           n_idx, static_cast<int>(C), k,
                           l1_c_size_full, subthread_id);
    } else {
      process_multi_chunk(l1_probs,
                          l1_probs + l1_c_size_half,
                          renormed_prob, &s,
                          probs_in_dte, in_hbm,
                          n_idx, C, k,
                          l1_c_size, num_chunks_mc,
                          subthread_id);
    }
  }

  if (subthread_id == 0) {
    probs_in_dte.destroy();
  }
}
```

上面的 `copy_row_by_chunks()` 是 `k >= C` 分支的直观展开：每次由 subthread0 读一个 chunk 到 L1，各 subthread 复制自己的 slice 到输出。这里不重新求和，因为输入语义已经是 probability；全保留时 renorm 后仍等于原行。

```cpp
template <typename probs_t>
__device__ void copy_row_by_chunks(tops::local_dte& dte,
                                   tops::mdspan& in_hbm,
                                   probs_t* l1_probs,
                                   probs_t* out,
                                   int row_idx,
                                   int64_t C,
                                   int chunk_size,
                                   int subthread_id) {
  for (int c_idx = 0; c_idx < C; c_idx += chunk_size) {
    int curr_c = (c_idx + chunk_size <= C)
                     ? chunk_size
                     : static_cast<int>(C - c_idx);

    tops::event ev;
    if (subthread_id == 0) {
      ev = tops::slice_async(dte,
              tops::mdspan(tops::Private, l1_probs, 1, curr_c),
              in_hbm, {row_idx, c_idx});
      ev.wait();
    }
    __syncsubthreads();

    int my_start = 0;
    int my_count = 0;
    CALC_MY_RANGE(curr_c, my_start, my_count, subthread_id);
    if (my_count > 0) {
      copy_vec_single(l1_probs + my_start,
                      out + row_idx * C + c_idx + my_start,
                      my_count);
    }
    __syncsubthreads();
  }
}
```

## 0.3 向量 building blocks

连续 copy 使用 `leaptr` 和 tail mask，主循环没有标量分支。这个 helper 同时服务 `k >= C` 快路径和最终写回。

```cpp
template <typename T>
__device__ __attribute__((noinline, no_mem_alias_in_vldst_tar))
void copy_vec_single(T* src, T* dst, int num) {
  constexpr int vlen = TCLE_MAX_VECTOR_LENGTH / sizeof(T);
  using vtype = typename tcle::altivector<T, vlen>::VT;

  int nvecs = num / vlen;
  int tail = num - nvecs * vlen;

  tcle::leaptr<vtype> src_ptr(src, sizeof(vtype));
  tcle::leaptr<vtype> dst_ptr(dst, sizeof(vtype));

  for (int i = 0; i < nvecs; ++i) {
    vtype v = src_ptr.load();
    dst_ptr.store(v);
  }

  if (tail > 0) {
    using mask_t = typename tcle::altivector_to_mask<vtype>::type;
    auto mb = tcle::vset_mb<mask_t>(tail);
    vtype zero = (vtype)((T)0);
    vtype v = src_ptr.load(zero, mb);
    dst_ptr.store(v, mb);
  }
}
```

`floor_float()` 是正确性细节。pivot 用 double 维护区间，但最终比较在 float 概率上发生；如果 double 转 float 后向上舍入，就可能改变 `p > pivot` 的边界。这里检测到向上舍入时把 float bit 减一格，确保比较阈值不会高于 double pivot。

```cpp
__device__ __attribute__((always_inline))
float floor_float(double d) {
  float f = static_cast<float>(d);
  if (static_cast<double>(f) > d) {
    unsigned int bits;
    __builtin_memcpy(&bits, &f, sizeof(bits));
    if (bits > 0) {
      bits -= 1;
    }
    __builtin_memcpy(&f, &bits, sizeof(f));
  }
  return f;
}
```

局部最大值是第一轮 scan。它按 8 个 vector 一组 load，向量内用 `vsel` 保留较大值，最后 `redmax`，尾部标量补齐。

```cpp
template <typename probs_t>
__device__ __attribute__((noinline))
float find_local_max(probs_t* data, int count) {
  constexpr int fvlen = TCLE_MAX_VECTOR_LENGTH / sizeof(float);
  using fvtype = typename tcle::altivector<float, fvlen>::VT;
  constexpr int G = 8;

  if (count <= 0) {
    return 0.0f;
  }

  int nvecs = count / fvlen;
  int tail = nvecs * fvlen;
  int nmain = nvecs / G;
  int nrem = nvecs - nmain * G;

  fvtype v_max = (fvtype)(0.0f);
  fvtype vin[G];
  tcle::leaptr<fvtype> lp =
      tcle::simple_leaptr<fvtype>(reinterpret_cast<tcle::generic_ptr>(data));

  for (int i = 0; i < nmain; ++i) {
    for (int j = 0; j < G; ++j) {
      vin[j] = lp.load();
    }
    for (int j = 0; j < G; ++j) {
      v_max = tcle::vsel(v_max < vin[j], vin[j], v_max);
    }
  }

  for (int i = 0; i < nrem; ++i) {
    fvtype v = lp.load();
    v_max = tcle::vsel(v_max < v, v, v_max);
  }

  float lm = static_cast<float>(tcle::redmax<0>(v_max)[0]);
  for (int i = tail; i < count; ++i) {
    float p = static_cast<float>(data[i]);
    if (p > lm) {
      lm = p;
    }
  }
  return lm;
}
```

## 0.4 四 pivot 计数：一次 load 同时收集四个阈值的 count

核心扫描 helper 一次读入概率 slice，同时统计 `count(p > p0/p1/p2/p3)`，并记录离散边界 `min_gt` 与 `max_le`。`min_gt/max_le` 的作用是避免在相邻 float 值之间无意义地迭代：当两者相同，说明值域上已经收敛。

```cpp
struct PivotCountResult {
  int cnt0;
  int cnt1;
  int cnt2;
  int cnt3;
  float min_gt;
  float max_le;
};

template <typename probs_t>
__device__ __attribute__((noinline))
PivotCountResult count_pivots_on_slice(probs_t* data, int count,
                                       float p0f, float p1f,
                                       float p2f, float p3f,
                                       float low_f, float high_f) {
  constexpr int fvlen = TCLE_MAX_VECTOR_LENGTH / sizeof(float);
  using fvtype = typename tcle::altivector<float, fvlen>::VT;
  constexpr int G = 8;

  PivotCountResult res{0, 0, 0, 0, high_f, low_f};
  if (count <= 0) {
    return res;
  }

  int nvecs = count / fvlen;
  int tail = nvecs * fvlen;
  int nmain = nvecs / G;
  int nrem = nvecs - nmain * G;

  fvtype zero = (fvtype)(0.0f);
  fvtype one = (fvtype)(1.0f);
  fvtype vc0 = zero;
  fvtype vc1 = zero;
  fvtype vc2 = zero;
  fvtype vc3 = zero;
  fvtype vmg = (fvtype)(3.4e38f);
  fvtype vml = (fvtype)(-3.4e38f);
  fvtype vin[G];

  tcle::leaptr<fvtype> lp =
      tcle::simple_leaptr<fvtype>(reinterpret_cast<tcle::generic_ptr>(data));

  for (int i = 0; i < nmain; ++i) {
    for (int j = 0; j < G; ++j) {
      vin[j] = lp.load();
    }

    fvtype vp0 = (fvtype)(p0f);
    for (int j = 0; j < G; ++j) {
      vc0 = vc0 + tcle::vsel(vin[j] <= vp0, zero, one);
    }

    fvtype vp1 = (fvtype)(p1f);
    for (int j = 0; j < G; ++j) {
      vc1 = vc1 + tcle::vsel(vin[j] <= vp1, zero, one);
    }

    fvtype vp2 = (fvtype)(p2f);
    for (int j = 0; j < G; ++j) {
      vc2 = vc2 + tcle::vsel(vin[j] <= vp2, zero, one);
    }

    fvtype vp3 = (fvtype)(p3f);
    for (int j = 0; j < G; ++j) {
      vc3 = vc3 + tcle::vsel(vin[j] <= vp3, zero, one);
    }

    fvtype v_lo = (fvtype)(low_f);
    fvtype v_big = (fvtype)(3.4e38f);
    for (int j = 0; j < G; ++j) {
      fvtype candidate = tcle::vsel(vin[j] <= v_lo, v_big, vin[j]);
      vmg = tcle::vsel(candidate < vmg, candidate, vmg);
    }

    fvtype v_hi = (fvtype)(high_f);
    fvtype v_neg = (fvtype)(-3.4e38f);
    for (int j = 0; j < G; ++j) {
      fvtype candidate = tcle::vsel(vin[j] > v_hi, v_neg, vin[j]);
      vml = tcle::vsel(vml < candidate, candidate, vml);
    }
  }

  for (int i = 0; i < nrem; ++i) {
    fvtype v = lp.load();
    vc0 = vc0 + tcle::vsel(v <= (fvtype)(p0f), zero, one);
    vc1 = vc1 + tcle::vsel(v <= (fvtype)(p1f), zero, one);
    vc2 = vc2 + tcle::vsel(v <= (fvtype)(p2f), zero, one);
    vc3 = vc3 + tcle::vsel(v <= (fvtype)(p3f), zero, one);
    vmg = tcle::vsel(tcle::vsel(v <= (fvtype)(low_f),
                                (fvtype)(3.4e38f), v) < vmg,
                     tcle::vsel(v <= (fvtype)(low_f),
                                (fvtype)(3.4e38f), v), vmg);
    vml = tcle::vsel(vml < tcle::vsel(v > (fvtype)(high_f),
                                      (fvtype)(-3.4e38f), v),
                     tcle::vsel(v > (fvtype)(high_f),
                                (fvtype)(-3.4e38f), v), vml);
  }

  float c0 = static_cast<float>(tcle::redsum<0>(vc0)[0]);
  float c1 = static_cast<float>(tcle::redsum<0>(vc1)[0]);
  float c2 = static_cast<float>(tcle::redsum<0>(vc2)[0]);
  float c3 = static_cast<float>(tcle::redsum<0>(vc3)[0]);
  float min_gt = static_cast<float>(tcle::redmin<0>(vmg)[0]);
  float max_le = static_cast<float>(tcle::redmax<0>(vml)[0]);

  for (int i = tail; i < count; ++i) {
    float p = static_cast<float>(data[i]);
    if (p > p0f) c0 += 1.0f;
    if (p > p1f) c1 += 1.0f;
    if (p > p2f) c2 += 1.0f;
    if (p > p3f) c3 += 1.0f;
    if (p > low_f && p < min_gt) min_gt = p;
    if (p <= high_f && p > max_le) max_le = p;
  }

  res.cnt0 = static_cast<int>(c0);
  res.cnt1 = static_cast<int>(c1);
  res.cnt2 = static_cast<int>(c2);
  res.cnt3 = static_cast<int>(c3);
  res.min_gt = min_gt;
  res.max_le = max_le;
  return res;
}
```

subthread0 汇总四个 count 后收缩 `[low, high]`。因为 pivot 越高，`count(p > pivot)` 越小，所以先看最高 pivot；如果 `g3 >= k`，阈值还能抬高。否则逐级降到 `g0`，再决定新的 high。

```cpp
__device__ __attribute__((always_inline))
void reduce_pivot_counts(L1Shared* s, float high_f, float low_f, int k) {
  int g0 = 0;
  int g1 = 0;
  int g2 = 0;
  int g3 = 0;
  float gmgt = high_f;
  float gmle = low_f;

  for (int i = 0; i < DEFAULT_SUBTHREAD_NUM; ++i) {
    g0 += s->local_cnt_0[i];
    g1 += s->local_cnt_1[i];
    g2 += s->local_cnt_2[i];
    g3 += s->local_cnt_3[i];
    if (s->local_min_gt[i] < gmgt) gmgt = s->local_min_gt[i];
    if (s->local_max_le[i] > gmle) gmle = s->local_max_le[i];
  }

  double pd0 = *s->pivot_0;
  double pd1 = *s->pivot_1;
  double pd2 = *s->pivot_2;
  double pd3 = *s->pivot_3;
  double max_le = static_cast<double>(gmle);

  if (g3 >= k) {
    *s->low = pd3;
  } else if (g2 >= k) {
    *s->low = pd2;
    *s->high = (pd3 < max_le) ? pd3 : max_le;
  } else if (g1 >= k) {
    *s->low = pd1;
    *s->high = (pd2 < max_le) ? pd2 : max_le;
  } else if (g0 >= k) {
    *s->low = pd0;
    *s->high = (pd1 < max_le) ? pd1 : max_le;
  } else {
    *s->high = (pd0 < max_le) ? pd0 : max_le;
  }

  if (gmgt == gmle) {
    *s->converged = true;
  }
}
```

## 0.5 Mask、sum、normalize

单 chunk 路径可以在 L1 内原地把不保留的概率置 0，同时累加保留概率和；后续 normalize 只乘 normalizer，不需要再读原始概率。

```cpp
template <typename probs_t>
__device__ __attribute__((noinline))
float mask_and_sum_inplace(probs_t* data, int count, float pivot_f) {
  constexpr int fvlen = TCLE_MAX_VECTOR_LENGTH / sizeof(float);
  using fvtype = typename tcle::altivector<float, fvlen>::VT;
  constexpr int G = 8;

  if (count <= 0) {
    return 0.0f;
  }

  int nvecs = count / fvlen;
  int tail = nvecs * fvlen;
  int nmain = nvecs / G;
  int nrem = nvecs - nmain * G;

  fvtype zero = (fvtype)(0.0f);
  fvtype pivot = (fvtype)(pivot_f);
  fvtype vsum = zero;
  fvtype vin[G];
  fvtype masked[G];

  tcle::leaptr<fvtype> ip =
      tcle::simple_leaptr<fvtype>(reinterpret_cast<tcle::generic_ptr>(data));
  tcle::leaptr<fvtype> op =
      tcle::simple_leaptr<fvtype>(reinterpret_cast<tcle::generic_ptr>(data));

  for (int i = 0; i < nmain; ++i) {
    for (int j = 0; j < G; ++j) {
      vin[j] = ip.load();
    }
    for (int j = 0; j < G; ++j) {
      masked[j] = tcle::vsel(vin[j] <= pivot, zero, vin[j]);
    }
    for (int j = 0; j < G; ++j) {
      vsum = vsum + masked[j];
    }
    for (int j = 0; j < G; ++j) {
      op.store(masked[j]);
    }
  }

  for (int i = 0; i < nrem; ++i) {
    fvtype v = ip.load();
    fvtype m = tcle::vsel(v <= pivot, zero, v);
    vsum = vsum + m;
    op.store(m);
  }

  float sum = static_cast<float>(tcle::redsum<0>(vsum)[0]);
  for (int i = tail; i < count; ++i) {
    float p = static_cast<float>(data[i]);
    float m = (p > pivot_f) ? p : 0.0f;
    sum += m;
    data[i] = static_cast<probs_t>(m);
  }
  return sum;
}

template <typename probs_t>
__device__ __attribute__((noinline))
void normalize_inplace(probs_t* data, int count, float normalizer) {
  constexpr int fvlen = TCLE_MAX_VECTOR_LENGTH / sizeof(float);
  using fvtype = typename tcle::altivector<float, fvlen>::VT;
  constexpr int G = 8;

  int nvecs = count / fvlen;
  int tail = nvecs * fvlen;
  int nmain = nvecs / G;
  int nrem = nvecs - nmain * G;

  fvtype vn = (fvtype)(normalizer);
  fvtype vin[G];
  fvtype vout[G];
  tcle::leaptr<fvtype> ip =
      tcle::simple_leaptr<fvtype>(reinterpret_cast<tcle::generic_ptr>(data));
  tcle::leaptr<fvtype> op =
      tcle::simple_leaptr<fvtype>(reinterpret_cast<tcle::generic_ptr>(data));

  for (int i = 0; i < nmain; ++i) {
    for (int j = 0; j < G; ++j) vin[j] = ip.load();
    for (int j = 0; j < G; ++j) vout[j] = vin[j] * vn;
    for (int j = 0; j < G; ++j) op.store(vout[j]);
  }
  for (int i = 0; i < nrem; ++i) {
    fvtype v = ip.load();
    op.store(v * vn);
  }
  for (int i = tail; i < count; ++i) {
    data[i] = static_cast<probs_t>(
        static_cast<float>(data[i]) * normalizer);
  }
}
```

多 chunk 路径不能保存整行 masked 数据，所以先 streaming 求 sum，再重新 streaming 做 mask、normalize、write。这样多读几遍 HBM，但避免了巨大的中间 mask 或 index 状态。

```cpp
template <typename probs_t>
__device__ __attribute__((noinline))
float sum_above_pivot(probs_t* data, int count, float pivot_f) {
  constexpr int fvlen = TCLE_MAX_VECTOR_LENGTH / sizeof(float);
  using fvtype = typename tcle::altivector<float, fvlen>::VT;
  constexpr int G = 8;

  int nvecs = count / fvlen;
  int tail = nvecs * fvlen;
  int nmain = nvecs / G;
  int nrem = nvecs - nmain * G;

  fvtype zero = (fvtype)(0.0f);
  fvtype pivot = (fvtype)(pivot_f);
  fvtype sum = zero;
  fvtype vin[G];
  tcle::leaptr<fvtype> lp =
      tcle::simple_leaptr<fvtype>(reinterpret_cast<tcle::generic_ptr>(data));

  for (int i = 0; i < nmain; ++i) {
    for (int j = 0; j < G; ++j) vin[j] = lp.load();
    for (int j = 0; j < G; ++j) {
      sum = sum + tcle::vsel(vin[j] <= pivot, zero, vin[j]);
    }
  }
  for (int i = 0; i < nrem; ++i) {
    fvtype v = lp.load();
    sum = sum + tcle::vsel(v <= pivot, zero, v);
  }

  float scalar_sum = static_cast<float>(tcle::redsum<0>(sum)[0]);
  for (int i = tail; i < count; ++i) {
    float p = static_cast<float>(data[i]);
    if (p > pivot_f) scalar_sum += p;
  }
  return scalar_sum;
}

template <typename probs_t>
__device__ __attribute__((noinline))
void mask_normalize_write(probs_t* src, probs_t* dst,
                          int count, float pivot_f, float normalizer) {
  constexpr int fvlen = TCLE_MAX_VECTOR_LENGTH / sizeof(float);
  using fvtype = typename tcle::altivector<float, fvlen>::VT;
  constexpr int G = 8;

  int nvecs = count / fvlen;
  int tail = nvecs * fvlen;
  int nmain = nvecs / G;
  int nrem = nvecs - nmain * G;

  fvtype pivot = (fvtype)(pivot_f);
  fvtype vn = (fvtype)(normalizer);
  fvtype zero = (fvtype)(0.0f);
  fvtype vin[G];
  fvtype vout[G];

  tcle::leaptr<fvtype> ip =
      tcle::simple_leaptr<fvtype>(reinterpret_cast<tcle::generic_ptr>(src));
  tcle::leaptr<fvtype> op =
      tcle::simple_leaptr<fvtype>(reinterpret_cast<tcle::generic_ptr>(src));

  for (int i = 0; i < nmain; ++i) {
    for (int j = 0; j < G; ++j) vin[j] = ip.load();
    for (int j = 0; j < G; ++j) {
      vout[j] = tcle::vsel(vin[j] <= pivot, zero, vin[j] * vn);
    }
    for (int j = 0; j < G; ++j) op.store(vout[j]);
  }
  for (int i = 0; i < nrem; ++i) {
    fvtype v = ip.load();
    op.store(tcle::vsel(v <= pivot, zero, v * vn));
  }
  for (int i = tail; i < count; ++i) {
    float p = static_cast<float>(src[i]);
    src[i] = static_cast<probs_t>((p > pivot_f) ? p * normalizer : 0.0f);
  }

  copy_vec_single(src, dst, count);
}
```

## 0.6 单 chunk 路径

当一整行 C 维能放进 L1，kernel 只把这一行读入一次。最大值、pivot 迭代、mask、sum、normalize 全部在 L1 内完成，最后写回输出。这是中小词表最理想的路径。

```cpp
template <typename probs_t>
__device__ __attribute__((noinline))
void process_single_chunk(probs_t* l1_probs,
                          probs_t* renormed_prob,
                          L1Shared* s,
                          tops::local_dte& probs_in_dte,
                          tops::mdspan& in_hbm,
                          int row_idx,
                          int row_elems,
                          int k,
                          int l1_c_size_full,
                          int subthread_id) {
  const int curr_c = row_elems;
  const int64_t C = row_elems;

  tops::event ev_in;
  if (subthread_id == 0) {
    ev_in = tops::slice_async(
        probs_in_dte,
        tops::mdspan(tops::Private, l1_probs, 1, curr_c),
        in_hbm, {row_idx, 0});
    ev_in.wait();
  }
  __syncsubthreads();

  int my_start = 0;
  int my_count = 0;
  CALC_MY_RANGE(curr_c, my_start, my_count, subthread_id);
  probs_t* my_data = l1_probs + my_start;

  s->local_max[subthread_id] = find_local_max(my_data, my_count);
  __syncsubthreads();

  if (subthread_id == 0) {
    float row_max = 0.0f;
    for (int i = 0; i < DEFAULT_SUBTHREAD_NUM; ++i) {
      if (s->local_max[i] > row_max) row_max = s->local_max[i];
    }
    *s->low = 0.0;
    *s->high = static_cast<double>(row_max);
  }
  __syncsubthreads();

  for (int iter = 0; iter < TOPK_RENORM_MAX_ITERATIONS; ++iter) {
    if (*s->converged) {
      break;
    }

    if (subthread_id == 0) {
      double low = *s->low;
      double high = *s->high;
      double span = high - low;
      *s->pivot_0 = low + span * 0.2;
      *s->pivot_1 = low + span * 0.4;
      *s->pivot_2 = low + span * 0.6;
      *s->pivot_3 = low + span * 0.8;
    }
    __syncsubthreads();

    float p0 = floor_float(*s->pivot_0);
    float p1 = floor_float(*s->pivot_1);
    float p2 = floor_float(*s->pivot_2);
    float p3 = floor_float(*s->pivot_3);
    float low_f = floor_float(*s->low);
    float high_f = floor_float(*s->high);

    PivotCountResult cr =
        count_pivots_on_slice(my_data, my_count, p0, p1, p2, p3,
                              low_f, high_f);

    s->local_cnt_0[subthread_id] = cr.cnt0;
    s->local_cnt_1[subthread_id] = cr.cnt1;
    s->local_cnt_2[subthread_id] = cr.cnt2;
    s->local_cnt_3[subthread_id] = cr.cnt3;
    s->local_min_gt[subthread_id] = cr.min_gt;
    s->local_max_le[subthread_id] = cr.max_le;
    __syncsubthreads();

    if (subthread_id == 0) {
      reduce_pivot_counts(s, high_f, low_f, k);
    }
    __syncsubthreads();
  }

  float pivot = floor_float(*s->low);
  s->local_sum_0[subthread_id] =
      mask_and_sum_inplace(my_data, my_count, pivot);
  __syncsubthreads();

  if (subthread_id == 0) {
    float total_sum = 0.0f;
    for (int i = 0; i < DEFAULT_SUBTHREAD_NUM; ++i) {
      total_sum += s->local_sum_0[i];
    }
    *s->normalizer =
        1.0f / ((total_sum > 1e-8f) ? total_sum : 1e-8f);
  }
  __syncsubthreads();

  if (my_count > 0) {
    normalize_inplace(my_data, my_count, *s->normalizer);
    copy_vec_single(my_data,
                    renormed_prob + row_idx * C + my_start,
                    my_count);
  }
  __syncsubthreads();
}
```

## 0.7 多 chunk 路径

当 C 维放不进 L1，kernel 使用两个半行 buffer。每个阶段都从 chunk0 开始：subthread0 先加载当前 chunk；当前 chunk 被所有 subthread 扫描时，subthread0 预取下一 chunk；当前 chunk 结束后等待下一 chunk 事件并翻转 buffer。

多 chunk 路径分四个阶段：

1. streaming scan 求整行最大值。
2. 每轮 pivot 搜索都 streaming scan 全行，累加四个 count 和离散边界。
3. 用最终 pivot streaming scan 全行求保留概率和。
4. 再 streaming scan 全行，mask、normalize、写回输出。

这比保存整行 mask 多读 HBM，但避免了大中间状态，并且每一遍都是顺序向量 scan。

```cpp
template <typename probs_t>
__device__ __attribute__((noinline))
void process_multi_chunk(probs_t* l1_buf0,
                         probs_t* l1_buf1,
                         probs_t* renormed_prob,
                         L1Shared* s,
                         tops::local_dte& probs_in_dte,
                         tops::mdspan& in_hbm,
                         int row_idx,
                         int64_t C,
                         int k,
                         int l1_c_size,
                         int num_chunks,
                         int subthread_id) {
  tops::event ev_in;
  tops::event ev_next;
  probs_t* l1_buf[2] = {l1_buf0, l1_buf1};

  {
    float reg_max = 0.0f;
    int cur = 0;

    if (subthread_id == 0) {
      int cc0 = (l1_c_size <= C) ? l1_c_size : static_cast<int>(C);
      ev_in = tops::slice_async(probs_in_dte,
                tops::mdspan(tops::Private, l1_buf[0], 1, cc0),
                in_hbm, {row_idx, 0});
      ev_in.wait();
    }
    __syncsubthreads();

    for (int ci = 0; ci < num_chunks; ++ci) {
      int c_idx = ci * l1_c_size;
      int curr_c = (c_idx + l1_c_size <= C)
                       ? l1_c_size
                       : static_cast<int>(C - c_idx);
      bool has_next = (ci + 1 < num_chunks);

      if (has_next && subthread_id == 0) {
        int next_idx = (ci + 1) * l1_c_size;
        int next_c = (next_idx + l1_c_size <= C)
                         ? l1_c_size
                         : static_cast<int>(C - next_idx);
        ev_next = tops::slice_async(probs_in_dte,
                    tops::mdspan(tops::Private, l1_buf[1 - cur], 1, next_c),
                    in_hbm, {row_idx, next_idx});
      }

      int my_start = 0;
      int my_count = 0;
      CALC_MY_RANGE(curr_c, my_start, my_count, subthread_id);
      float local_max = find_local_max(l1_buf[cur] + my_start, my_count);
      if (local_max > reg_max) reg_max = local_max;

      if (has_next && subthread_id == 0) {
        ev_next.wait();
      }
      __syncsubthreads();
      cur = 1 - cur;
    }

    s->local_max[subthread_id] = reg_max;
    __syncsubthreads();

    if (subthread_id == 0) {
      float row_max = 0.0f;
      for (int i = 0; i < DEFAULT_SUBTHREAD_NUM; ++i) {
        if (s->local_max[i] > row_max) row_max = s->local_max[i];
      }
      *s->low = 0.0;
      *s->high = static_cast<double>(row_max);
    }
    __syncsubthreads();
  }

  for (int iter = 0; iter < TOPK_RENORM_MAX_ITERATIONS; ++iter) {
    __syncsubthreads();
    if (*s->converged) {
      break;
    }

    if (subthread_id == 0) {
      double low = *s->low;
      double high = *s->high;
      double span = high - low;
      *s->pivot_0 = low + span * 0.2;
      *s->pivot_1 = low + span * 0.4;
      *s->pivot_2 = low + span * 0.6;
      *s->pivot_3 = low + span * 0.8;
    }
    __syncsubthreads();

    float p0 = floor_float(*s->pivot_0);
    float p1 = floor_float(*s->pivot_1);
    float p2 = floor_float(*s->pivot_2);
    float p3 = floor_float(*s->pivot_3);
    float low_f = floor_float(*s->low);
    float high_f = floor_float(*s->high);

    int reg_c0 = 0;
    int reg_c1 = 0;
    int reg_c2 = 0;
    int reg_c3 = 0;
    float reg_min_gt = high_f;
    float reg_max_le = low_f;

    for_each_chunk_with_double_buffer(
        probs_in_dte, in_hbm, l1_buf, row_idx, C, l1_c_size,
        subthread_id,
        [&](probs_t* chunk, int curr_c) {
          int my_start = 0;
          int my_count = 0;
          CALC_MY_RANGE(curr_c, my_start, my_count, subthread_id);
          PivotCountResult cr =
              count_pivots_on_slice(chunk + my_start, my_count,
                                    p0, p1, p2, p3, low_f, high_f);
          reg_c0 += cr.cnt0;
          reg_c1 += cr.cnt1;
          reg_c2 += cr.cnt2;
          reg_c3 += cr.cnt3;
          if (cr.min_gt < reg_min_gt) reg_min_gt = cr.min_gt;
          if (cr.max_le > reg_max_le) reg_max_le = cr.max_le;
        });

    s->local_cnt_0[subthread_id] = reg_c0;
    s->local_cnt_1[subthread_id] = reg_c1;
    s->local_cnt_2[subthread_id] = reg_c2;
    s->local_cnt_3[subthread_id] = reg_c3;
    s->local_min_gt[subthread_id] = reg_min_gt;
    s->local_max_le[subthread_id] = reg_max_le;
    __syncsubthreads();

    if (subthread_id == 0) {
      reduce_pivot_counts(s, high_f, low_f, k);
    }
    __syncsubthreads();
  }

  float pivot = floor_float(*s->low);
  float reg_sum = 0.0f;
  for_each_chunk_with_double_buffer(
      probs_in_dte, in_hbm, l1_buf, row_idx, C, l1_c_size,
      subthread_id,
      [&](probs_t* chunk, int curr_c) {
        int my_start = 0;
        int my_count = 0;
        CALC_MY_RANGE(curr_c, my_start, my_count, subthread_id);
        reg_sum += sum_above_pivot(chunk + my_start, my_count, pivot);
      });

  s->local_sum_0[subthread_id] = reg_sum;
  __syncsubthreads();

  if (subthread_id == 0) {
    float total_sum = 0.0f;
    for (int i = 0; i < DEFAULT_SUBTHREAD_NUM; ++i) {
      total_sum += s->local_sum_0[i];
    }
    *s->normalizer =
        1.0f / ((total_sum > 1e-8f) ? total_sum : 1e-8f);
  }
  __syncsubthreads();

  float normalizer = *s->normalizer;
  for_each_chunk_with_double_buffer(
      probs_in_dte, in_hbm, l1_buf, row_idx, C, l1_c_size,
      subthread_id,
      [&](probs_t* chunk, int curr_c, int c_idx) {
        int my_start = 0;
        int my_count = 0;
        CALC_MY_RANGE(curr_c, my_start, my_count, subthread_id);
        mask_normalize_write(
            chunk + my_start,
            renormed_prob + row_idx * C + c_idx + my_start,
            my_count, pivot, normalizer);
      });
}
```

`for_each_chunk_with_double_buffer()` 上面写成辅助形态，是为了把多 chunk 的重复节拍讲清楚。kernel 中每个阶段都直接展开同一套控制流；关键点是 subthread0 发起下一 chunk 的 `slice_async`，所有 subthread 同步消费当前 chunk。

```cpp
template <typename probs_t, typename Fn>
__device__ void for_each_chunk_with_double_buffer(
    tops::local_dte& dte,
    tops::mdspan& in_hbm,
    probs_t* l1_buf[2],
    int row_idx,
    int64_t C,
    int l1_c_size,
    int subthread_id,
    Fn body) {
  tops::event ev_in;
  tops::event ev_next;
  int num_chunks = (static_cast<int>(C) + l1_c_size - 1) / l1_c_size;
  int cur = 0;

  if (subthread_id == 0) {
    int first_c = (l1_c_size <= C) ? l1_c_size : static_cast<int>(C);
    ev_in = tops::slice_async(dte,
              tops::mdspan(tops::Private, l1_buf[0], 1, first_c),
              in_hbm, {row_idx, 0});
    ev_in.wait();
  }
  __syncsubthreads();

  for (int ci = 0; ci < num_chunks; ++ci) {
    int c_idx = ci * l1_c_size;
    int curr_c = (c_idx + l1_c_size <= C)
                     ? l1_c_size
                     : static_cast<int>(C - c_idx);
    bool has_next = (ci + 1 < num_chunks);

    if (has_next && subthread_id == 0) {
      int next_idx = (ci + 1) * l1_c_size;
      int next_c = (next_idx + l1_c_size <= C)
                       ? l1_c_size
                       : static_cast<int>(C - next_idx);
      ev_next = tops::slice_async(dte,
                  tops::mdspan(tops::Private, l1_buf[1 - cur], 1, next_c),
                  in_hbm, {row_idx, next_idx});
    }

    body(l1_buf[cur], curr_c, c_idx);

    if (has_next && subthread_id == 0) {
      ev_next.wait();
    }
    __syncsubthreads();
    cur = 1 - cur;
  }
}
```

## 0.8 需要修正的旧理解

第一，不能把它写成排序 top-k。当前 GCU400 路径没有 heap、没有排序、没有 index 输出；它使用 `p > pivot` 的值域阈值 mask。这个语义对 dense probability renorm 是合适的，但 tie 行为不是稳定 top-k index 的语义。

第二，不能说 `top_k_arr` 已经在 op 层保证每个元素大于 0。op 层只在没有 `top_k_arr` 时检查 `top_k_val > 0`；有 `top_k_arr` 时只检查 `[B]` 和 I32。GCU400 kernel 也没有像旧架构路径那样把 `k <= 0` clamp 到 1，所以 per-row k 的合法性需要调用侧保证。

第三，`k >= C` 分支是 copy，不是重新归一化。这里依赖输入本来就是 probability；如果调用侧给的是 logits，全保留分支不会把 logits 变成概率。

第四，`probs_rows` 对 GCU400 不是有效的 stride 参数。host 签名保留了它，但 kernel 按连续 `[batch_num, classes_num]` 寻址：`row_idx * C + c_idx`。

第五，`min_gt/max_le` 不是装饰性统计。它们让 pivot 搜索在离散 float 值域上收敛，避免仅靠 double 区间切分在相邻 float 值之间空转。

## 0.9 优化点汇总

1. **阈值搜索替代排序**：dense 输出不需要 indices，值域 pivot 能避免 pair/index 中间状态。
2. **四 pivot 复用一次 load**：同一批 vector 同时统计四个阈值的 count，减少重复读大词表的次数。
3. **离散边界收敛**：`min_gt/max_le` 把连续区间搜索拉回 float 离散值域，减少无效迭代。
4. **`floor_float()` 保护比较边界**：double pivot 转 float 时向下取整，避免 `p > pivot` 的边界被向上舍入改变。
5. **单 chunk 原地处理**：整行能进 L1 时，mask、sum、normalize 都在 L1 内完成，只写最终输出。
6. **多 chunk 顺序 streaming**：整行放不下时，不保存 mask/index，而是用双 buffer 多阶段顺序 scan。
7. **行内 subthread 并行**：C 维按 subthread 均分，局部统计写入 L1 shared，再由 subthread0 做小规模汇总。
8. **`k >= C` 快路径**：全保留时直接 copy，避开 pivot 迭代和 sum。
9. **noinline 控制大型 kernel 压力**：主阶段函数和扫描 helper 保持独立，减少顶层函数体膨胀和变量生命周期交叠。
10. **normalizer 下限**：`1.0f / max(sum, 1e-8f)` 避免空保留集合或极小 sum 产生 Inf。

## 0.10 结论

这篇报告应把 Top-K Renorm Probs 理解成“大词表 dense probability 的阈值 mask renorm”，而不是通用 top-k selection。GCU400 代码的价值在于把算法、L1 容量、DTE chunk、subthread reduction 和 float 边界处理放在同一条路径上：单 chunk 走 L1 原地处理，多 chunk 走双 buffer streaming，所有重活都保持向量化顺序 scan。
