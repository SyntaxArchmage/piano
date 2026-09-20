# 108. index_put GCU400/libra kernel 深度报告

## 结论先行

`index_put` 的难点不是单纯 scatter，而是索引语义、广播、重复 index、负 index、累加确定性和后缀连续维搬运同时出现。GCU400 这组实现把问题切成几类：无累加快路径做 scatter copy，非确定性累加快路径做 atomic scatter add，确定性累加先把目标行预处理并排序，再让同一个目标行的所有更新落到同一个 worker，通用累加路径则按 self 前缀 tile 扫描 index 流。

旧报告把整体设计说得偏乐观，需要补上三个关键事实：

1. 无累加快路径没有“最后写入获胜”的顺序保证。重复 index 时多个 worker 并发写同一目标行，结果由实际写入时序决定。
2. 非确定性累加快路径对 I64 index 的处理不完整：它把 I64 index 当成两个 int32 搬运后只取低 32 位，没有做 int64 到 int32 的范围断言。无累加快路径和确定性预处理做了这个校验，非确定性快路径没有。
3. `accumulate=true` 的 GCU400 通用累加 kernel 在 `indices_continous == false` 时没有执行更新逻辑。入口层会把一些复杂 accumulate 形态送到这条路径，所以这是正确性风险，不只是性能 fallback 不够快。

报告里不要把这组 kernel 写成“完整覆盖所有高级索引语义的 GCU400 优化实现”。更准确的描述是：快路径覆盖“一维首维索引、value 不需要广播、大后缀连续 row、数据类型为 FP16/BF16/I64”的热点形态；通用累加覆盖更多 dtype 和广播，但它对非连续 index 布局存在空分支。

## 语义模型

快路径处理的核心形态可以理解为：

```cpp
// self:  [self_dim0, dim1]
// value: [value_dim0, dim1]
// index: [value_dim0]
//
// dim1 是被索引首维之后所有后缀维度的乘积。

for (int i = 0; i < value_dim0; ++i) {
  int row = normalize_index(index[i], self_dim0);

  if (!accumulate) {
    for (int k = 0; k < dim1; ++k) {
      self[row * self_stride0 + k] = value[i * dim1 + k];
    }
  } else {
    for (int k = 0; k < dim1; ++k) {
      self[row * dim1 + k] += value[i * dim1 + k];
    }
  }
}
```

通用累加路径会把多个 index tensor 合成一个 self 前缀线性位置：

```cpp
int make_self_front_index(
    int* normalized_indices,
    int* self_stride,
    int valid_indices_num) {
  int front = 0;
  for (int d = 0; d < valid_indices_num; ++d) {
    front += normalized_indices[d] * self_stride[d];
  }
  return front;
}
```

这两种模型的差别很大：

- 快路径按 value row 分配 worker，直接写目标 row。
- 通用累加按 self 前缀 tile 分配 worker，扫描全部 index 流，命中当前 tile 时才把 value 加到 L1 中的 self tile。

## 控制参数

`INDEX_PUT_OP_PARAS` 是 host 和 device 的控制面。可以把它简化为下面几组字段：

```cpp
struct IndexPutParams {
  int indices_data_type;
  int data_type;
  int accumulate;

  void* indices_mem_handle[kMaxRank];
  int indices_num;

  int self_dims[kMaxRank];
  int value_dims[kMaxRank];
  int indices_dims[kMaxRank][kMaxRank];
  int self_rank;
  int value_rank;
  int indices_rank[kMaxRank];

  int valid_indices_num;
  int indices_brd_rank;
  int indices_brd_dims[kMaxRank];

  int value_update_rank;
  int value_update_dims[kMaxRank];

  void* indices_brd_space[kMaxRank][kMaxRank];
  void* value_update_space[kMaxRank];
  int indices_brd_space_num[kMaxRank];
  int value_update_space_num;

  bool indices_continous;
  int self_strides[kMaxRank];
  bool choose_brd_special;
};
```

这些字段里最关键的是：

- `valid_indices_num`：真正参与 self 前缀寻址的 index tensor 数量。
- `indices_brd_dims`：多个 index tensor 广播后的共同形状。
- `value_update_dims`：value 广播后应当匹配的更新形状。
- `indices_continous`：非空 index tensor 是否在 index 列表中连续出现。
- `self_strides[0]`：快路径写回目标 row 时使用的 self 首维 stride。

device 端不重新推导完整高级索引语义，而是依赖这些字段。字段一旦与真实 tensor 语义不一致，后续地址计算会直接错。

## 入口分流

入口层先推导广播形状和 value 更新形状，然后按 `accumulate` 与快路径条件分流。核心逻辑可以写成：

```cpp
bool one_index_hot_shape =
    self_rank == value_rank &&
    self_rank >= 2 &&
    indices_num == 1 &&
    indices_rank[0] == 1 &&
    indices_dims[0][0] == value_dims[0] &&
    (indices_dtype == I32 || indices_dtype == I64) &&
    (data_dtype == BF16 || data_dtype == FP16 || data_dtype == I64);

int dim1 = 1;
for (int d = 1; d < self_rank; ++d) {
  dim1 *= self_dims[d];
}

bool no_value_broadcast =
    value_rank == value_update_rank &&
    same_shape(value_dims, value_update_dims, value_rank);

bool use_fast_path =
    one_index_hot_shape &&
    dim1 >= 128 &&
    no_value_broadcast;

if (!accumulate) {
  if (use_fast_path) {
    start_no_accumulate_fast_path();
  } else {
    start_generic_no_accumulate_path();
  }
} else {
  if (use_fast_path) {
    if (deterministic_enabled()) {
      preprocess_index_to_u32();
      sort_preprocessed_index_and_row_id();
      start_deterministic_accumulate_path();
    } else {
      start_nondeterministic_atomic_path();
    }
  } else {
    start_gcu400_general_accumulate_path();
  }
}
```

这个分流说明：

- `accumulate=false` 的非热点形态会走非 GCU400 专用的通用 no-accumulate 路径。
- `accumulate=true` 的非热点形态会走 GCU400 通用累加路径。
- 确定性只在热点形态上生效，且依赖预处理和排序。
- 快路径只覆盖 BF16、FP16、I64 三种 data dtype；FP32 accumulate 可以走 GCU400 通用累加，但不走快路径。

## 预处理：范围检查与负索引归一化

确定性路径会先把 index 预处理成 `uint32_t` 目标行。非 I64 index 的预处理是向量化的：

```cpp
void preprocess_i32_index(
    int* dst,
    int* src,
    int count,
    int self_dim0) {
  for (int base = 0; base < count; base += vector_len_i32()) {
    Vec<int> raw = load_i32(src + base);

    Mask too_large = raw >= splat(self_dim0);
    Mask too_small = raw < splat(-self_dim0);
    assert_no_lane(too_large || too_small);

    Vec<int> normalized = (raw + splat(self_dim0)) % splat(self_dim0);
    store_i32(dst + base, normalized);
  }
}
```

I64 index 的预处理先用 DTE 把一段 int64 搬到 L1，再在 L1 上做检查、归一化和窄化：

```cpp
void preprocess_i64_chunk(
    uint32_t* dst,
    int64_t* src,
    int count,
    int self_dim0) {
  int64_t bound = static_cast<int64_t>(self_dim0);

  for (int i = 0; i < count; ++i) {
    int64_t v = src[i];
    bool invalid = (v >= bound) || (v < -bound);
    assert(!invalid);

    int64_t normalized = (v + bound) % bound;
    dst[i] = static_cast<uint32_t>(normalized);
  }
}
```

预处理使用的是广播后的 index buffer：如果某个 index tensor 已经被广播到中间空间，预处理读取最后一级广播结果；否则读取原始 index。这样确定性路径排序的是实际参与更新的 index 序列，而不是未广播的短 index。

## 无累加快路径

无累加快路径的目标是 scatter copy：

```cpp
self[index[i], :] = value[i, :]
```

每个 subthread 负责一段 value row。L1 被分成 value staging 和 index staging：

```cpp
template <typename T>
void no_accumulate_fast_path(
    T* self,
    T* value,
    void* raw_index,
    Params p) {
  constexpr int subthreads_per_thread = 4;
  constexpr int dte_bytes = 64 * 1024;
  constexpr int value_capacity = dte_bytes / sizeof(T);
  constexpr int index_capacity = 2048;

  int worker_count = thread_count() * subthreads_per_thread;
  int worker_id = thread_id() * subthreads_per_thread + subthread_id();

  int dim1 = product(p.self_dims, 1, p.self_rank);
  int value_dim0 = p.value_dims[0];

  Local<T> value_l1 = local_value_slice<T>(subthread_id(), value_capacity);
  Local<int> index_l1 = local_index_slice(subthread_id(), index_capacity);

  if (dim1 <= value_capacity) {
    int rows_per_worker = min(
        ceil_div(value_dim0, worker_count),
        value_capacity / dim1);

    for (int row0 = worker_id * rows_per_worker;
         row0 < value_dim0;
         row0 += rows_per_worker * worker_count) {
      int rows = min(rows_per_worker, value_dim0 - row0);

      copy_global_to_l1(value_l1, value + row0 * dim1, rows * dim1);
      load_and_check_index(index_l1, raw_index, row0, rows, p.self_dims[0]);

      for (int r = 0; r < rows; ++r) {
        int dst_row = normalize_index(index_l1[r], p.self_dims[0]);
        copy_row_unrolled(
            self + dst_row * p.self_strides[0],
            value_l1 + r * dim1,
            dim1);
      }
    }
  } else {
    int rows_per_worker = ceil_div(value_dim0, worker_count);

    for (int row0 = worker_id * rows_per_worker;
         row0 < value_dim0;
         row0 += rows_per_worker * worker_count) {
      int rows = min(rows_per_worker, value_dim0 - row0);
      load_and_check_index(index_l1, raw_index, row0, rows, p.self_dims[0]);

      for (int r = 0; r < rows; ++r) {
        int dst_row = normalize_index(index_l1[r], p.self_dims[0]);
        copy_global_row_to_global_row(
            self + dst_row * p.self_strides[0],
            value + (row0 + r) * dim1,
            dim1);
      }
    }
  }
}
```

两个 dim1 分支的物理含义不同：

- `dim1 <= L1 value 容量`：先把多个 value row 搬到 L1，再循环写回 self。
- `dim1 > L1 value 容量`：单行太大，不适合整体 staging，改用 DTE 直接把 value row 搬到目标 self row。

对 I64 data，快路径把 self/value 当作 int32 字节流搬运，`dim1` 和 stride 都乘以二：

```cpp
int32_t* self_i32 = reinterpret_cast<int32_t*>(self_i64);
int32_t* value_i32 = reinterpret_cast<int32_t*>(value_i64);

int dim1_i32 = dim1 * 2;
int self_stride0_i32 = self_stride0 * 2;

copy_row_unrolled<int32_t>(
    self_i32 + dst_row * self_stride0_i32,
    value_i32 + src_row * dim1_i32,
    dim1_i32);
```

这个写法把 I64 搬运转成连续 int32 搬运，避免为 int64 单独写一套复杂 DTE row copy。只要偏移、长度和 stride 都同步乘以二，字节语义是正确的。

无累加快路径对 I64 index 做了范围检查：

```cpp
int64_t raw = index_i64_l1[i];
assert(raw >= INT32_MIN && raw <= INT32_MAX);
index_i32_l1[i] = static_cast<int32_t>(raw);
```

随后 `check_indices` 再检查是否在 `[-self_dim0, self_dim0)` 范围内。这个双重检查比非确定性累加快路径更稳。

## 非确定性累加快路径

非确定性快路径的语义是：

```cpp
self[index[i], :] += value[i, :]
```

它用 vector atomic add 处理重复 index：

```cpp
template <typename T>
void accumulate_unrolled(
    T* self,
    T* value_l1,
    int* index_l1,
    int rows,
    int dim1,
    int self_dim0) {
  for (int r = 0; r < rows; ++r) {
    int dst_row = normalize_index(index_l1[r], self_dim0);

    for (int k = 0; k < dim1; k += vector_len<T>()) {
      Vec<T> v = load_vec(value_l1 + r * dim1 + k);
      atomic_add_vec(self + dst_row * dim1 + k, v);
    }
  }
}
```

这条路径性能好，但浮点累加顺序不固定。重复 index 会被 atomic 累加，结果通常接近数学加法，但不同运行或不同调度下的舍入顺序可能不同。

dim1 分支也分两类：

```cpp
if (dim1 <= value_l1_capacity) {
  // 一次搬多个 value row 到 L1，再对目标 self row 做 atomic add。
  load_value_rows_to_l1();
  load_indices_to_l1();
  check_indices();
  accumulate_unrolled();
} else {
  // 每个 worker 只处理一个 value row，并按 dim1 切片搬运。
  load_one_index_to_l1();
  check_one_index();

  for (int k = 0; k < dim1; k += value_l1_capacity) {
    load_value_slice_to_l1();
    atomic_add_value_slice_to_self();
  }
}
```

这里要特别指出 I64 index 风险。非确定性快路径读取 I64 index 时只搬两个 int32，然后取低 32 位：

```cpp
int32_t* raw_i32 = reinterpret_cast<int32_t*>(raw_i64_index);

// 实际只使用 raw_i32[2 * i]，没有读取并校验完整 int64 值。
int low32 = raw_i32[2 * i];
index_i32_l1[i] = low32;

check_indices(index_i32_l1, rows, self_dim0);
```

这和无累加快路径不同。无累加快路径会先恢复 int64，再断言它能放进 int32；确定性预处理也按 int64 检查范围。非确定性路径如果收到超出 int32 范围的 I64 index，低 32 位可能碰巧落在合法范围内，`check_indices` 也无法发现原始值已经错了。建议补成与无累加一致：

```cpp
int64_t raw = index_i64_l1[i];
assert(raw >= INT32_MIN && raw <= INT32_MAX);
index_i32_l1[i] = static_cast<int32_t>(raw);
check_indices(index_i32_l1 + i, 1, self_dim0);
```

## 确定性累加路径

确定性路径先把原始 index 归一化成目标 row，再排序得到两个数组：

```cpp
// target_row[i] 是归一化后的 self 行号。
// value_row_id[i] 是原 value 的行号。
sort_by_target_row(
    out_target_row = indices_val,
    out_value_row_id = indices_idx,
    input_target_row = preprocessed_index);
```

device kernel 按 `indices_val` 切分 worker 范围。切分时要避免同一个 target row 被两个 worker 同时处理：

```cpp
int start = worker_id * ceil_div(count, worker_count);
int end = min(count, start + ceil_div(count, worker_count));

if (start > 0) {
  uint32_t previous = indices_val[start - 1];

  // 如果 start 落在同一 target row 的中间，向后跳过整组。
  while (start < count && indices_val[start] == previous) {
    ++start;
  }
}

if (end > 0) {
  uint32_t last = indices_val[end - 1];

  // 如果 end 切断了同一 target row，向后扩展到整组结束。
  while (end < count && indices_val[end] == last) {
    ++end;
  }
}
```

这样相同 `indices_val` 的连续段只会由一个 worker 处理。段内再按 `(target_row, value_row_id)` 执行加法：

```cpp
for (int i = start; i < end; ++i) {
  int dst_row = indices_val[i];
  int src_row = indices_idx[i];

  for (int k = 0; k < dim1; k += vector_len<T>()) {
    Vec<T> v = load_vec(value + src_row * dim1 + k);
    atomic_add_vec(self + dst_row * dim1 + k, v);
  }
}
```

注意这条路径仍然使用 atomic add helper。它的确定性来自“同一 target row 不跨 worker 分裂”和排序后的稳定处理序列，而不是完全改成普通 scalar 加法。对 FP16/BF16，它还对 `dim1 == 512` 和 `dim1 == 2048` 做了专门展开；I64 deterministic 路径只走 I64 专用的通用加法 helper。

## GCU400 通用累加路径

通用累加路径是 cooperative kernel。它先由一个 thread 执行 value 和 indices 的广播，再全局同步：

```cpp
if (thread_id == 0) {
  if (value_needs_broadcast) {
    if (value_is_scalar) {
      broadcast_scalar_value();
    } else {
      broadcast_value_tensor();
    }
  }

  for (int i = 0; i < indices_num; ++i) {
    if (index_needs_broadcast(i)) {
      broadcast_index_tensor(i);
    }
  }
}

sync_all_blocks();
```

随后 L1 被分成三块：

```cpp
char sip_mem[vdmem_size];

T* self_tile = reinterpret_cast<T*>(sip_mem);
T* value_tile = reinterpret_cast<T*>(sip_mem + one_block_bytes);
char* index_tile = sip_mem + 2 * one_block_bytes;
```

核心循环不是“按 value row 直接 scatter”，而是“按 self 前缀 tile 扫描所有 index”：

```cpp
for (int back_start = 0; back_start < back_num; back_start += self_tile_width) {
  int back_len = min(self_tile_width, back_num - back_start);

  for (int front_start = my_front_begin;
       front_start < my_front_end;
       front_start += fronts_per_tile) {
    int front_len = min(fronts_per_tile, my_front_end - front_start);

    // 先把一块 self 搬进 L1。
    copy_global_to_l1(
        self_tile,
        self + front_start * back_num + back_start,
        front_len,
        back_len);

    for (int index_base = 0;
         index_base < indices_elem_num;
         index_base += indices_chunk) {
      load_index_chunk_to_l1(index_tile, index_base, indices_chunk);

      for (int i = 0; i < indices_chunk; ++i) {
        int front = make_front_index_from_all_indices(i);

        if (front >= front_start && front < front_start + front_len) {
          copy_value_row_to_l1(value_tile, index_base + i, back_start, back_len);

          T* dst = self_tile + (front - front_start) * aligned_back_len;
          add_or_logical_or(dst, value_tile, aligned_back_len);
        }
      }
    }

    copy_l1_to_global(
        self + front_start * back_num + back_start,
        self_tile,
        front_len,
        back_len);
  }
}
```

这条路径的好处是避免多个 worker 同时写同一块 self tile。重复 index 会在同一个 tile 的 L1 中累加，再一次性写回。它适合复杂广播、多 index tensor 和更多 dtype。

但它有一个必须写清楚的空分支：

```cpp
if (!indices_continous) {
  // 当前没有更新逻辑。
} else if (first_index_is_not_null) {
  run_contiguous_index_accumulate();
}
```

也就是说，`accumulate=true` 且 index tensor 在 index 列表中不是连续非空时，这条 GCU400 通用路径可能不更新 self。入口层会把某些复杂 accumulate 形态送到这条路径，因此这不是一个无关分支。修复方向是：要么在入口层把 `indices_continous == false` 的 accumulate 形态转到可处理的通用路径，要么补齐 GCU400 kernel 的非连续 index 语义。

## 类型处理

这组 kernel 的类型处理有四类技巧。

第一，data dtype 和 index dtype 分开：

```cpp
template <typename DataT, typename IndexT>
void general_accumulate(DataT* self, DataT* value, Params p);
```

device 内部还会用 `p.indices_data_type` 决定是否按 I64 index 搬运和广播。

第二，PRED 累加不是数值加法，而是逻辑或：

```cpp
if (data_dtype == PRED) {
  dst = logical_or(dst, value);
} else {
  dst = dst + value;
}
```

第三，I64 data 经常用 int32 视图搬运：

```cpp
int32_t* self_i32 = reinterpret_cast<int32_t*>(self_i64);
int32_t* value_i32 = reinterpret_cast<int32_t*>(value_i64);

int element_count_i32 = element_count_i64 * 2;
copy_bytes_as_i32(self_i32, value_i32, element_count_i32);
```

第四，I64 index 在不同路径中的处理并不一致：

- 确定性预处理：读取完整 int64，检查范围，归一化到 uint32。
- 无累加快路径：读取完整 int64，检查 int32 范围，再转 int32 并检查 self 范围。
- 非确定性快路径：只取低 32 位，再检查 self 范围。
- 通用累加路径：I64 分支读取完整 int64 并做 self 维度范围检查。

这就是为什么 I64 index 的修复优先级应放在非确定性快路径。

## 已确认问题与优化点

### 1. 非确定性快路径 I64 index 截断

当前非确定性快路径对 I64 index 只取低 32 位。应改成与无累加快路径一致的流程：

```cpp
for (int i = 0; i < rows; ++i) {
  int64_t raw = index_i64_l1[i];

  assert(raw >= INT32_MIN && raw <= INT32_MAX);

  int narrowed = static_cast<int>(raw);
  assert(narrowed < self_dim0);
  assert(narrowed >= -self_dim0);

  index_i32_l1[i] = narrowed;
}
```

如果要支持超过 int32 的 self 首维索引，就不能在快路径里窄化到 int32，需要把地址计算扩展到 int64。

### 2. 通用累加的非连续 index 空分支

`indices_continous == false` 目前没有更新逻辑。建议入口层先加保护：

```cpp
if (accumulate && !indices_continous) {
  return fallback_to_non_gcu400_or_report_not_support();
}
```

更完整的修复是实现非连续 index 的 self 维度重排和 value_update 对齐，但这会影响高级索引语义，不能只在 kernel 内补一个地址公式。

### 3. 无累加重复 index 没有顺序语义

如果 `accumulate=false` 且 index 有重复，快路径是并发 scatter write：

```cpp
// 多个 worker 可能同时写 self[row, :]。
self[row * stride + k] = value[i * dim1 + k];
```

报告不应写成“最后写入获胜”。如果上层 API 要求严格顺序，需要另走排序或串行化路径；如果语义允许未定义或非确定结果，则当前快路径是合理性能取舍。

### 4. `nzero_cnt_dev` 在 GCU400 快路径里没有实际参与

host 仍把 `nzero_cnt_dev` 传入无累加和非确定性快路径，但这些 kernel 的核心逻辑没有使用它。可以保留兼容签名，但报告不应把它写成实际控制输出数量的参数。若后续清理接口，`nzero_cnt_dev` 是可疑冗余项。

### 5. 大 dim1 分支的优化方向

当 `dim1 > L1 value 容量` 时，无累加改为 global row copy，非确定性累加改为按 dim1 切片 atomic add。这是正确方向，但仍有两类可优化空间：

- 对无累加，如果重复 index 很多，后写覆盖早写，提前压缩 index/value 对可以减少无效 row copy。
- 对累加，如果同一 index 连续出现，先在 L1 合并多个 value row，再对 self 做一次 atomic add，可以减少 atomic 次数。

这两类优化都需要 index 分布信息，不能无条件启用。

## 可迁移经验

这份实现的高价值经验有三条。

第一，scatter 类算子要先把“不规则维”和“连续后缀维”拆开。`dim1` 是后缀连续长度，决定是 L1 staging、global row copy、还是按后缀切片处理。

第二，确定性不是简单关掉并行。通过预处理、排序和分区边界修正，可以让相同目标行落到同一个 worker，保留大部分并行度。

第三，类型 trick 必须逐路径审计。I64 data 用 int32 视图搬运是字节级优化；I64 index 窄化则是语义级转换。前者只要长度和偏移一致就安全，后者必须有范围检查，否则会把合法性问题藏进低 32 位截断里。
