# Primo++ GEMM 编程模型

> SKILL 主体已承载的"GEMM SPR 字段表 / NACCOVR 行为 / `local_gemm.matmul / store / epilogue_add` 调用契约"不在此重复。

## 1. 概览:GEMM 在 Primo++ 中的位置

Primo++ 是基于 topsC++ 编程语言开发的模板函数库,以头文件形式发布和集成,基于 TTE(TOPS template extension)构建 Global / Shared / Local 各层次的计算和数据搬运功能。算子开发用 Primo++ 写 GEMM 时,核心计算公式:

```
D_mn = A_mk * B_kn + C_mn
```

| 矩阵 | 形状 | 角色 |
| :-- | :-- | :-- |
| A | M × K | 左枝 |
| B | K × N | 右枝 |
| C | M × N | 累加(可选) |
| D | M × N | 结果 |

多 batch 时记 BMNK,无 batch 时记 MNK。

### 1.1 Host / Device 代码结构

| 函数 | 位置 | 功能 |
| :-- | :-- | :-- |
| `main` | Host | 提取 Problem Shape(BMNK)与 Shared Shape(sharedM、sharedN、sharedK),并供开发者设置 local gemm MMA_Op 与 dataflow pattern |
| `do_gemm_test` | Host | 内存分配、初始化矩阵数据、host↔device 搬入搬出;计算后做正确性验证与 cycle 打印 |
| `device_gemm` | Device | GCU 上运行的核心计算接口函数,配置流水线、初始化 local_gemm,启动生产消费者 |
| `shared_dataflow_gemm` | Device | 生产者函数:将 global memory 中的数据按规则切块,通过 pipeline 搬运至 shared memory |
| `shared_compute_gemm` | Device | 消费者函数:将生产者搬运好的 shared memory 数据切片搬运至 local memory,使用预设 local gemm mma 算子做 GEMM,负责 K 维度 accumulate 与 epilogue 运算 |

某些案例中,生产消费者实现已被抽象成接口,只需 `main` / `do_gemm_test` / `device_gemm` 三函数完成 GEMM。

## 2. device_gemm 核心配置

`device_gemm` 依次配置 Global、Shared、Dataflow、Compute 信息,然后分配 subthread 工作,最后启动生产消费者模型。

```cpp
template <class MMA_Op, class Dataflow_Pattern, class ProbShape, class SharedTileShape,
          class LocalTileShape, class ThreadShape, class D_T, class C_T>
MULTITHREAD __global__ void
device_gemm(D_T *D, typename MMA_Op::ValTypeA *A, typename MMA_Op::ValTypeB *B, C_T *C,
            ProbShape prob_shape, SharedTileShape shared_tile_shape,
            LocalTileShape local_tile_shape, ThreadShape thread_shape, int *cycles)
```

| 参数 | 功能 |
| :-- | :-- |
| `MMA_Op` | 计算核心配置(local_gemm),见 §3 |
| `Dataflow_Pattern` | 数据搬运方式,见 §4 |
| `MULTITHREAD` | 一个 SIP 启动的 subthread 数量,GCU400 上为 (3, 2, 1) 共 6 个 |
| `__global__` | Host 调用 / Device 执行 |
| `Prob_Shape` | 计算问题形状,BMNK |
| `Shared_tile_shape` | shared memory 形状,BMNK |
| `Local_tile_shape` | local memory 形状,MNK(单次 `local_gemm.matmul` 计算形状,不涉及 batch) |
| `Thread_shape` | SIP 上的 (x, y, z) 配置;GCU400 上为 (2, 3, 1) |
| `Cycles` | 提取每个 subthread 运行时间,作性能评价 |

### 2.1 Global 配置

```cpp
// global memory in row-major mode.
auto mD = // (M, N)
  make_tensor(make_gmem_ptr(D), select<0, 1, 2>(prob_shape), GenRowMajor{});
auto mA = // (M, K)
  make_tensor(make_gmem_ptr(A), select<0, 1, 3>(prob_shape), GenRowMajor{});
auto mB = // (K, N)
  make_tensor(make_gmem_ptr(B), select<0, 3, 2>(prob_shape), GenRowMajor{});
auto mC = // (M, N)
  make_tensor(make_gmem_ptr(C), select<0, 1, 2>(prob_shape), GenRowMajor{});
```

`select<x, y, z>(prob_shape)` 从 BMNK 中按 index 提取需要的维度;`GenRowMajor{}` 把数据块视为行优先;`make_tensor` 构建出张量。

### 2.2 Shared 配置

```cpp
// shared memory
auto A_shared_layout = make_layout(
  make_shape(get_B_4d(shared_tile_shape), get_M_4d(shared_tile_shape), get_K_4d(shared_tile_shape)),
  GenRowMajor{});
auto B_shared_layout = make_layout(
  make_shape(get_B_4d(shared_tile_shape), get_K_4d(shared_tile_shape), get_N_4d(shared_tile_shape)),
  GenRowMajor{});

extern __shared__ __valigned__ typename MMA_Op::ValTypeA smem_buf[];
auto smem_A = (typename MMA_Op::ValTypeA *)&smem_buf[0];
auto smem_B =
  (typename MMA_Op::ValTypeB *)(smem_A + get<0>(thread_shape) * STAGE *
                                cosize(A_shared_layout));

int shared_A_cons = compute_subthread_count * blockDim.y;
int shared_B_cons = compute_subthread_count * blockDim.x;
```

A 矩阵占 shared memory 前半部分,B 矩阵占后半部分;A_cons / B_cons 是后续 tensor queue 的消费者数量。

### 2.3 Dataflow 配置(异步数据流)

```cpp
using Pipeline = pipeline_t<SharedScope, Int<STAGE>>;
auto local_engine = make_engine(engine_t<LocalScope, Int<STAGE>>);
auto gemm_dataflow = make_gemm_dataflow(Dataflow_Pattern);
auto prod_iter = gemm_dataflow.get_producer_iter(
  prob_shape, A_shared_layout, B_shared_layout, thread_shape);

auto shared_A_queues = make_non_owning_tensor_queue_array(
  get<0>(thread_shape), Pipeline, local_engine, make_smem_ptr(&smem_A[0]),
  A_shared_layout, 1, shared_A_cons);
auto &shared_A_queue = shared_A_queues[threadIdx.x];
auto shared_B_queues = make_non_owning_tensor_queue_array(
  get<1>(thread_shape), Pipeline, local_engine, make_smem_ptr(&smem_B[0]),
  B_shared_layout, 1, shared_B_cons);
auto &shared_B_queue = shared_B_queues[threadIdx.y];
```

| 组件 | 功能 |
| :-- | :-- |
| `Pipeline` | Shared 层级传输管道;**STAGE = 2 即 double buffer / ping-pong** |
| `make_gemm_dataflow` | 按 `Dataflow_Pattern` 构建数据流,见 §4 |
| `Prod_iter` | 生产者迭代器 |
| `make_non_owning_tensor_queue_array` | 用 Pipeline / Engine / shared memory 指针 / shared memory layout 等信息,为每个线程构建一个异步数据传输管道 |
| `get<0>(thread_shape)` / `get<1>(thread_shape)` | 根据线程在 x / y 维度的位置(threadIdx.x、threadIdx.y),确定其 A / B 矩阵的接受管道 |

### 2.4 Compute 配置

```cpp
// for compute, local gemm settings
auto subthread_layout = make_layout(
  make_shape(Int<compute_threadDimx>{}, Int<compute_threadDimy>{}),
  GenColMajor{});

using LocalGemm =
  tte::experimental::LocalGemm<MMA_Op, Int<STAGE>, Int<STAGE>>;
auto local_gemm = tte::experimental::make_local_gemm(LocalGemm);
local_gemm.init(subthread_layout);
```

GCU400 上 `subthread_layout = (2, 2)` 共 4 个;LocalGemm 是 GEMM 计算的核心结构;`local_gemm.init` 用 subthread 的排布方式进行初始化操作。

### 2.5 Subthread 工作分配

GCU400 上一个 SIP 启动 6 个 subthread,其中:

- **4 个用于计算**(`subThreadIdx.x < compute_subthread_count`)
- **1 个用于启动 LHS DTE 数据搬运**
- **1 个用于启动 RHS DTE 数据搬运**(若 parity 选另一枝则该 subthread 闲置)

`subThreadIdx` 只有 x 一个维度,范围为 0~5。判断逻辑:

```cpp
bool is_compute_subthread = subThreadIdx.x < compute_subthread_count;
bool is_lhs_dte_subthread = false;
bool is_rhs_dte_subthread = false;
static_assert(get<2>(thread_shape) == 1, "blockDim.z must be 1.");
static_assert(product(thread_shape) > 0, "Empty thread shape.");
auto parity = compare_parity(threadIdx.x, threadIdx.y);
is_lhs_dte_subthread = (subThreadIdx.x == compute_subthread_count) &&
  !parity && (threadIdx.y < 2);
is_rhs_dte_subthread = (subThreadIdx.x == compute_subthread_count) &&
  parity && (threadIdx.x < 2);
```

`compare_parity(threadIdx.x, threadIdx.y)` 用 threadIdx.x / threadIdx.y 判断要搬取的数据是左枝还是右枝。

### 2.6 生产消费者模型

```cpp
// producer consumer model
if (is_compute_subthread) {
  auto cons_iter = gemm_dataflow.get_consumer_iter(
    A_shared_layout, B_shared_layout, local_tile_shape);
  gemm_dataflow.consumer_loop(local_gemm, mD, shared_A_queue, shared_B_queue,
                              mC, prod_iter, cons_iter, prob_shape,
                              local_tile_shape);
} else if (is_lhs_dte_subthread) {
  gemm_dataflow.producer_loop_lhs(prob_shape, mA, shared_A_queue,
                                  prod_iter);
} else if (is_rhs_dte_subthread) {
  gemm_dataflow.producer_loop_rhs(prob_shape, mB, shared_B_queue,
                                  prod_iter);
} else { /* unused sub thread */ }
```

### 2.7 所需头文件

```cpp
#include <tops.h>
#include <tops/tops_runtime.h>
#include <primo/local/local_gemm.hpp>
#include <primo/local/local_gemm_dataflow.hpp>
#include <tte/core/engine.hpp>
#include <tte/core/pipeline.hpp>
#include <tte/core/tensor.hpp>
#include <tte/core/tensor_queue.hpp>
#include "utils.hpp"
```

## 3. MMA_Op:Compute 上的扩展

Compute 的变种实际上是使用不同的 **MMA_Op**(matrix multiplication accumulate operation,矩阵乘累加操作)。命名约定:

```
<设备代号> _ <local M x local N x local K> _ <D AB 数据类型> _ <A B 数据排布>
```

例:`GCU400_64x128x16_F32F32F32_TT` 代表最内层计算在 GCU400 上,一次 local gemm 大小为 M=64 / N=128 / K=16,左右枝与结果(ABD 矩阵)元素皆为 F32,数据是行优先(TT)。所有可用的 MMA_Op 在 `mma_gcu400.hpp` 文件里查找。

### 3.1 MMA_Op 各部分可选值表

> 本表是 GCU400 一次 local gemm 的全部维度选项,M_slice / KxN 形状回校以此为准。

| 字段 | 可选值 |
| :-- | :-- |
| 设备 | `GCU400` |
| **M** | **8, 16, 32, 64, 128** |
| **N** | **128**(唯一值) |
| **K** | **16, 32, 64** |
| 数据类型 D | F32, S32 |
| 数据类型 AB | F32, F16, BF16, E4M3, E5M2, S8, U8 |
| 数据排布 | TT, TN |

**N 维固定 128**——一次 local gemm 的右枝 N 维只有 128 一个选择。可选 `MxK` 组合即 `{8,16,32,64,128} × {16,32,64}` 共 15 种;`(M,N,K)` 三元组对应 Primo++ 命名 `GCU400_MxNxK_*`。

#### N=128 的硬件根因

OACC 寄存器物理宽度 4096 bit;V3 GEMM accumulator(D)只允许 F32 / S32(均 32 bit),所以一个 OACC 装 4096 / 32 = **128 个 D 元素**。Primo++ MMA_Op 的 N=128 就是**结果矩阵 D 在一个 OACC 上的列宽**——这是物理硬件锚点,不是 Primo++ 抽象选择,N 不能写其他值。

单条 MLI_GEMM 在 MAC 上一次只能覆盖 dtype 决定的小 N tile(SKILL `gcu400-compute` §计算吞吐 表给的 `gemm_mode` 编码 → KxN 形状):

| 输入 dtype | 单条指令 KxN | 拼成 N=128 用的指令条数 |
| :-- | :-- | :-- |
| FP16 / BF16 (`gemm_mode=0x1`) | 32x64 | 2 |
| FP16 / BF16 (`gemm_mode=0x0`) | 64x32 | 4 |
| FP32 (`gemm_mode=0x2`) | 16x32 | 4 |
| INT8 / UINT8 (`gemm_mode=0x3 / 0x4`) | 64x64 | 2 |
| FP8 (`gemm_mode=0x8 / 0x9`) | 64x64 | 2 |

例:`GCU400_64x128x32_F32BF16BF16_TT` 调一次 `local_gemm.matmul` 在 ISA 层会被展开成 2 条 `gemm_mode=0x1`(32x64)的 MLI_GEMM,第 1 条写 OACC[0..63] lane,第 2 条写 OACC[64..127] lane,合起来填满 128 个 FP32 lane。M、K 方向同理由 `kInstrM` / `kInstrK` 通过外层循环切片拼出。

开发者可针对所要计算的问题设置合适的 MMA_Op,在最内层计算上选择适合的切块大小、数据类型、数据排布,以达到最高的计算效率。

> ISA 层的 gemm_mode 编码字段见 `isa4_instruction_ref.md` §MLI_GEMM。

## 4. Dataflow Pattern:Dataflow 上的扩展

整体上可分 4 种:左右枝循环顺序的不同(L/R Cache)、左右枝 K 维度的不同(K_K / Km_K / Kn_K)、StreamK、ParallelBatch。

### 4.1 L/R Cache

| Pattern | 循环顺序 | 行为 |
| :-- | :-- | :-- |
| `Lcache` | BMNK | A 矩阵每加载一块,会与 B 矩阵的多块进行计算 |
| `Rcache` | BNMK | B 矩阵加载一块后,会与 A 矩阵的多块进行计算 |

选择建议:按左右枝数据复用量的相对大小选——M 远大于 N 时 A 复用多,选 `Lcache`;N 远大于 M 时 B 复用多,选 `Rcache`。

### 4.2 K_K / Km_K / Kn_K

Dataflow 也对左右枝的 sharedK 不同频次进行考虑:

- **K_K**:针对 A 及 B 的 sharedK 大小是一样的
- **Km_K**:A 的 sharedK(称为 sharedKm)大小会是 B 的 sharedK(称为 sharedKn)的数倍
- **Kn_K**:B 的 sharedK 大小会是 A 的 sharedK 的数倍

Km_K / Kn_K 让左右枝其中一枝的数据可在寄存器里待更长的时间,得到数据复用收益。例如 sharedKm 是 sharedKn 的两倍时,加载一次 shared B 可与两个 shared A 一起进行计算。

### 4.3 StreamK

把 tile 平均再分到 grid 上的多个 SIP 协同处理,以减少 epilogue 次数。Primo++ 中 tile 分布到所有 SIP,中间结果走 shared memory,先算的是 producer 把部分和写入,后算的是 consumer 取数据叠加,最后由 `Local_gemm.store()` 写回 D 矩阵。

### 4.4 Parallel Batch

可跨 Batch 来进行并行计算,主要用于一些比较极端的 problem shape。这里使用了 `sharedB` 的参数,在这里会大于 1。

## 5. 自定义生产消费者

抛开 Primo++ 里所提供的生产消费者高层次抽象接口,转向自己开发生产消费者模型。实现方式是 `Device_gemm` 里经过计算的配置预处理后调用自己开发的 `shared_dataflow_gemm` / `shared_compute_gemm`。

### 5.1 Tensor Queue Array

不再使用 Primo++ 预制好的 Dataflow Pattern 数据搬运接口,从生产消费者的视角来使用 Primo++ 的数据异步搬运接口。一个 block 里有 6 个 SIP,因此数据搬运到 sharedmemory 之后的数据可以由这 6 个 SIP 共用。要充分发挥算力,则需要每个 SIP 都参与计算,这样一来搬运的 tile 数量就必须是 6 的因数,即 1×6 / 2×3。这个因数对可视为 tile A 和 tile B,同时要确保搬运数量小于 SIP 的数量,因此只能取 (2, 3)。**6 个 SIP 中,2 个负责启动 tensor queue 搬运 tile A,3 个负责搬运 tile B**,这样就刚好可以让 6 个 SIP 都同时进行运算。

`shared_A_queue` 长度 2(`get<0>(thread_shape)`),`shared_B_queue` 长度 3(`get<1>(thread_shape)`)。

```cpp
auto shared_A = make_non_owning_tensor_queue_array(get<0>(thread_shape), ...);
auto shared_B = make_non_owning_tensor_queue_array(get<1>(thread_shape), ...);
```

#### 5.1.1 生产者使用

| API | 功能 |
| :-- | :-- |
| `Tile_async` | 接收三个参数(dst、src、coord),dst 是 shared memory,src 是 global memory。函数内会使用 dst 的 shape 来对 src 进行 tiling,然后使用 coord 选取相应的 tile,通过 `pop_queue_get` 获取位置,`pop_queue_put` 放入 |
| `Push_queue_get` | 生产者加锁 |
| `Push_queue_put` | 生产者释放锁 |

#### 5.1.2 消费者使用

| API | 功能 |
| :-- | :-- |
| `Pop_queue_get` | 消费者加锁,并获取对应的张量 |
| `Pop_queue_put` | 消费者释放锁,轮到生产者来传入数据 |

### 5.2 Local Gemm:Compute 核心 API

| 函数 | 参数 | 功能 |
| :-- | :-- | :-- |
| `init` | Subthread 的 layout | 当前 SIP 会启动的 subthread 的排布方式通过 layout 传入,对 local_gemm 进行初始化操作 |
| `matmul` | local tile A、local tile B、acc_flag(累加 flag,是否要叠加之前的计算结果) | 接收 3 个参数(左枝、右枝、是否与前一次结果叠加)。在最内层循环时,调用 `local_gemm.matmul(A, B)` 来对已经切分成 local tile 的 A 和 B 进行 GEMM 运算 |
| `store` | local tile D | 直接将计算结果写入 local tile D,无视之前在该 local tile 的结果,直接刷新结果。通常用于第一次写入该 local tile 时 |
| `epilogue_add` | local tile D | 将计算好的结果与 local tile D 原有的结果相加再存入对应位置 |

通用 local_gemm 调用逻辑:

```cpp
// core calculation
local_gemm.matmul(A, B, get_K(inner));
if(get_K(inner) == get_K(inner_loop_iter.last())) {
  if(get_K(outer) == 0){
    local_gemm.store(D);
  }
  else{
    local_gemm.epilogue_add(D);
    local_gemm.store(D);
  }
}
```

第一次进入内层循环时通过 `get_K(inner)` 使得不启动 acc_flag,直接刷新结果;之后启动 acc_flag 累加。当来到内层最后一块 tile(`get_K(inner) == get_K(inner_loop_iter.last())`)时,通过 `get_K(outer) == 0` 判断当前是否第一个外层(`store`),否则 `epilogue_add` 加上原有结果再 `store`。

### 5.3 Coord Iterator

为更精简地迭代涉及的每一个 shared tile 和 local tile。Coord Iterator 一般分内外双层:

- **外层循环**(outer loop):主要负责将 global 上的 tensor 取出一小块 shared tile
- **内层循环**(inner loop):负责从这个 shared tile 中再取出一小块 local tile 进行 local_gemm 运算

开发者可根据 Prob shape、shared tile shape、local tile shape 对迭代器进行客制化,达到自己想要的循环效果。一般上,外层循环可在生产者和消费者双方上使用——这是因为生产者提供的 shared tile 也要由相应的消费者接收;内层循环则只用于消费者。

### 5.4 Producer 函数:`shared_dataflow_gemm`

A 和 B 矩阵的搬运:开始有一个 parity,专门判断当前 thread(SIP)要搬运的是 A 还是 B shared tile。获取 `tensor_queue_array` 的相应位置,判断是否越界。若无越界,则调用 `tile_async` 功能函数,切分 global 数据块并传入 `tensor_queue_array` 里。

```cpp
template <class GlobalA, class GlobalB, class ArraySharedA, class ArraySharedB,
          class OuterLoopIter>
TTE_DEVICE void shared_dataflow_gemm(GlobalA &global_A, GlobalB &global_B,
                                     ArraySharedA &shared_A_array,
                                     ArraySharedB &shared_B_array,
                                     OuterLoopIter &outer_loop_iter) {
  for (auto it : outer_loop_iter) {
    auto parity = compare_parity(threadIdx.x, threadIdx.y);
    if (parity) {
      // odd handle B
      if (threadIdx.x > 1) return;
      auto &shared_B = shared_B_array[threadIdx.y];
      auto shared_K = get<0>(shared_B.shape());
      auto shared_N = get<1>(shared_B.shape());
      auto thread_n_idx = get_N(it) * blockDim.y + threadIdx.y;
      auto thread_k_idx = get_K(it);
      if (static_cast<unsigned int>(thread_k_idx * shared_K) <
            static_cast<unsigned int>(K) &&
          static_cast<unsigned int>(thread_n_idx * shared_N) <
            static_cast<unsigned int>(N)) {
        shared_B.tile_async(shared_B, global_B,
                            make_coord(thread_k_idx, thread_n_idx));
      } else {
        shared_B.push_queue_get();
        shared_B.push_queue_put();
      }
    } else {
      // even handle A
      if (threadIdx.y > 1) return;
      auto &shared_A = shared_A_array[threadIdx.x];
      auto shared_M = get<0>(shared_A.shape());
      auto shared_K = get<1>(shared_A.shape());
      auto thread_m_idx = get_M(it) * blockDim.x + threadIdx.x;
      auto thread_k_idx = get_K(it);
      if (static_cast<unsigned int>(thread_m_idx * shared_M) <
            static_cast<unsigned int>(M) &&
          static_cast<unsigned int>(thread_k_idx * shared_K) <
            static_cast<unsigned int>(K)) {
        shared_A.tile_async(shared_A, global_A,
                            make_coord(thread_m_idx, thread_k_idx));
      } else {
        shared_A.push_queue_get();
        shared_A.push_queue_put();
      }
    }
  }
}
```

### 5.5 Consumer 函数:`shared_compute_gemm`

每一个 SIP 的 6 个 subthread 中,4 个 subthread 会用来进行计算工作。外层循环主要用于从 tensor queue array 中获取 shared tile A 和 B:

```cpp
for (auto outer : outer_loop_iter) {
  // calculate index of the current thread with the related shared memory tile
  auto thread_m_idx = get_M(outer) * blockDim.x + threadIdx.x;
  auto thread_n_idx = get_N(outer) * blockDim.y + threadIdx.y;

  // prevent overbound (shared memory tile)
  auto shared_tail_M = slice_size(thread_m_idx, M, shared_M);
  auto shared_tail_N = slice_size(thread_n_idx, N, shared_N);
  auto shared_tail_K = slice_size(get_K(outer), K, shared_K);

  // get the particular shared memory tile from global memory
  auto shared_tile_A_cache = shared_A_queue.pop_queue_get();
  auto shared_tile_B_cache = shared_B_queue.pop_queue_get();
  auto gemm_cache_A = local_gemm.caching_A(shared_tile_A_cache);
  auto gemm_cache_B = local_gemm.caching_B(shared_tile_B_cache);
  ...
}
```

最内层计算核心调用 `local_gemm.matmul / store / epilogue_add`,逻辑见 §5.2。

## 6. 量化输入输出(W4A8 / W4A16 / W8A8 / W8A16)

混合低精度的 gemm 通过量化(Quantization)技术减小内存占用和计算开销。Primo++ 没有直接加入量化功能,因此差别于各别量化的 A 和 B 进行 gemm,则需要在生产消费者模型中自行加入量化功能。

量化过程涉及 4 种数据类型:

| 类型 | 角色 | 典型数据类型 |
| :-- | :-- | :-- |
| Type-A(Activation) | 激活值,gemm 的左枝 | FP16 / BF16 |
| Type-W(Weight) | 权重,gemm 的右枝 | 4bit 整数(INT4) |
| Type-Acc(Accumulate) | 累加器 | 一般为 32bit 浮点数(FP32) |
| Type-C(Output) | 目标矩阵 | 一般为 FP16 |

gemm atom 的 Type-Acc 由 Type-A 与 Type-W 决定。通常来说为了保证精度,Type-C 为 FP16。若 Type-W 精度低于 Type-A,会在 local gemm 之前使用 Scales 和 Zeros 进行量化:

```
B' = B * Scale - Zero
```

若 Type-A 和 Type-W 精度都低于 Type-C,则会在将结果写回 global 前用 Scales-A/W 进行 re-scale。

### 6.1 Local Pointwise

Primo++ 在 local 层级,对 local memory 上的数据做逐元素操作的组件。常用 API:

| API | 功能 |
| :-- | :-- |
| `make_local_pointwise` | 用于构建并初始化这个组件 |
| `map` | 接收一个 lambda 函数 func、output 和 input。对所提供的 local tile 做逐元素的操作。Output 可以是 1 个或多个,Input 也可以是 1 个或多个,可以直接作为 map 的参数,不需要绑定起来。Func 接收 input 作为参数,执行任务后的返回就会到 output |

### 6.2 W4A8

A 的数据类型是 8bit、B 的数据类型是 4bit。可使用接收 A 和 B 为 8bit 的 `GCU400_64x128x64_S32S8S8_TT` 的 MMA 指令进行 gemm,最终得到 32bit 的结果。

**Dataflow**:B 矩阵从 global 到 shared 到 local 都维持着 4bit 的形态没改变,这样做的主要原因是可以减低每一个元素的占用空间,减少带宽压力。

**Compute**:在解量化的过程中需要进行逐元素的乘和减操作(`B*scale - zeros`)。在这之前需要先开辟一个数据类型为 A 的 local memory,称为 `B_dq` 以存放解量化后的 B 矩阵。先使用 `make_tensor`,将 `B_dq` 视为两份,以供解量化时会得到的两个元素定义存放的张量位置。将这两个张量定义为 `B_dq_0` 和 `B_dq_1`。这部分要处理的是一个 input、多个 output 的情况:

```cpp
for (int k = 0; k < local_tail_K / 2; ++k) {
  auto crd = make_coord(k, _);
  local_pw.map(
    [](auto &&b, auto &&s, auto &&z) {
      auto b0 = b & 0xf;
      auto b1 = b >> 4;
      return make_tuple(b0 * s - z, b1 * s - z);
    },
    make_tuple(B_dq_0(crd), B_dq_1(crd)), B_(crd), S_, Z_);
}
```

输入是 localB、localS 和 localZ,输出是 `B_dq_0` 和 `B_dq_1`。Map 中的 lambda 函数对每一个 8bit 的 B 元素取出上 4bit 和下 4bit,然后对它们进行 `s*b0 - z` / `s*b1 - z` 来得到解量化后的结果。

由于 Type-A 和 Type-W 精度都低于 Type-C,在 epilogue 处理还需要多一个 epilogue_mul:

```cpp
// core calculation
local_gemm.matmul(A, B_dq, get_K(inner));
if(get_K(inner) == get_K(inner_loop_iter.last())) {
  if(get_K(outer)){
    local_gemm.epilogue_add(D);
  }
  if(get_K(outer) == get_K(outer_loop_iter.last())){
    experimental::epilogue_mul(local_gemm.mma_atom_,
                              local_gemm.sub_thread_coord_m_,
                              local_gemm.sub_thread_coord_n_, SA, SB);
  }
  local_gemm.store(D);
}
```

### 6.3 W4A16

可使用 `GCU400_64x128x32_F32BF16BF16_TT` 的 MMA 指令。最内层也是需要对 4bit 的 B 矩阵进行解量化,因此同样使用 local pointwise 即可将每一个元素解量化后放到 16bit 的数据类型里。处理好后再对数据调用 `local_gemm.matmul()` 操作完成计算。

### 6.4 W8A8

A 和 B 的数据类型相同,可直接使用 `GCU400_64x128x64_S32S8S8_TT` 的 MMA 指令。Type-A 和 Type-W 精度都低于 Type-C,在 epilogue 处理也需要 `epilogue_mul` 来进行 re-scale。

### 6.5 W8A16

可以使用 `GCU400_64x128x32_F32BF16BF16_TT` 的 MMA 指令,其他部分操作与上面几个大同小异。

## 7. Primo++ Debug 手段

- **调试模式**:编译时加 `-DPPP_ENABLE_DEBUG`,TensorQueue 等异步操作全部变同步,便于定位数据流问题
- **打印工具**:`print_tensor()` 打印张量内容、`print_layout()` 打印 2D 布局表、`print_loop()` 打印循环结构
- **Host Tensor 验证**:`host_make_tensor` 在 host 端创建输入,`copy_from_host` / `copy_to_host` 传输数据,便于单步验证
