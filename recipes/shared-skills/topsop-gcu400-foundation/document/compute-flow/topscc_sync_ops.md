# Tops C++ 同步机制与管道流水线（Synchronization & Pipeline）

> 本文概述 Tops C++ 中与线程同步、计数屏障、GCU400 管道流水线、内存屏障及设备断言相关的概念与用法。具体以当前编译器/运行时文档为准。

---

## 1. 线程间同步

### `__syncthreads()`

- **作用**：对**当前线程块（CTA）内**所有线程执行一次同步点；块内线程必须全部到达该调用后，才能继续执行后续指令。
- **典型用途**：共享内存上的协作计算、块内归约前后的对齐等。

### `__syncblocks()`

- **作用**：在**整个线程网格（grid）**范围内同步多个线程块。
- **前提**：核函数需以协作启动方式声明（需 `__cooperative__` 等协作模型支持），否则行为未定义或不可用。具体以官方核函数属性与启动 API 要求为准。

### `__syncsubthreads()`

- **作用**：**单一线程内部**对**子线程（sub-thread）**做同步（GCU400 引入的子线程粒度）。
- **适用场景**：在支持子线程划分的执行模型下，同一 warp/线程内的子执行单元需要阶段性对齐时使用。

---

## 2. 计数同步（Barrier）

计数屏障用于「固定数量参与者」的到达-等待语义，比单纯 `__syncthreads()` 更灵活（可多次 `arrive`/`wait` 组合，视 API 语义而定）。

### 类型概览

| 类型 | 共享范围 | 说明 |
|------|----------|------|
| `tops::shared_barrier` | 线程块内 | 同一块内线程共享的屏障对象。 |
| `tops::local_barrier` | 线程内子线程 | GCU400：子线程之间共享。 |
| `tops::global_barrier` | 线程网格 | 需协作启动（`__cooperative__`），跨块共享。 |

### 成员方法（典型语义）

| 方法 | 说明 |
|------|------|
| `barrier.init(count)` | 初始化参与者数量为 `count`（需在使用前正确设置）。 |
| `barrier.arrive_and_wait()` | 当前参与者「到达」并**阻塞**直到本阶段所有参与者到达。 |
| `barrier.arrive()` | 仅「到达」计数，**不阻塞**（常与 `wait()` 配合使用）。 |
| `barrier.wait()` | **阻塞等待**直到屏障条件满足（与 `arrive()` 分工时使用）。 |

> 具体对象是否支持 `arrive`/`wait` 分拆、是否可重复进入下一阶段，以类型与文档为准；表中为常见计数屏障接口形态。

### GCU300：`shared_barrier` 使用示例

以下示例展示在块内用 `tops::shared_barrier` 协调多线程：先在共享内存中放置屏障对象，初始化参与者数量后，各线程在关键点 `arrive_and_wait()` 对齐。

```cpp
#include <tops/tops_barrier.h>

__shared__ tops::shared_barrier bar;

__global__ void example_shared_barrier(int n_threads) {
  if (threadIdx.x == 0) {
    bar.init(n_threads);
  }
  __syncthreads();

  // 阶段 1：各线程完成局部工作 …
  bar.arrive_and_wait();

  // 阶段 2：依赖阶段 1 全部完成的协作逻辑 …
  bar.arrive_and_wait();
}
```

---

## 3. 管道流水线同步（Pipeline）— GCU400

管道（`pipeline`）在**多阶段（stage）**之间用**令牌/阶段计数**协调生产者与消费者，常与 DTE 搬运、多缓冲配合，实现流水化重叠。

### 定义方式

```cpp
tops::shared_pipeline<StagesCount, ProducerCount, ConsumerCount, InnerBarrier> pipe;
tops::local_pipeline<StagesCount, ProducerCount, ConsumerCount, InnerBarrier> pipe;
```

| 模板参数 | 类型 / 含义 |
|----------|-------------|
| `StagesCount` | `uint8_t`，流水线阶段数。 |
| `ProducerCount` | `uint32_t`，生产者数量。 |
| `ConsumerCount` | `uint32_t`，消费者数量。 |
| `InnerBarrier` | `bool`，**默认 `true`**：是否在管道内部使用屏障处理阶段切换与套圈安全；`false` 时需自行在阶段边界插入屏障同步。 |

- **`shared_pipeline`**：与线程块内多线程协作的典型场景相关（共享语义由实现定义）。
- **`local_pipeline`**：与 **GCU400 子线程/本地执行域** 上的流水协作相关。

### 成员方法

| 方法 | 说明 |
|------|------|
| `pipe.init()` | 初始化管道状态（必须在生产/消费前调用）。 |
| `pipe.producer_acquire()` | 生产者获取当前可写入的阶段/缓冲区（与实现中的令牌对应）。 |
| `pipe.producer_commit(skip_dte = false)` | 生产者提交本阶段；`skip_dte` 为 `true` 时可跳过与 DTE 相关的隐式步骤（若本阶段无搬运需求）。 |
| `pipe.consumer_wait()` | 消费者等待对应阶段数据就绪。 |
| `pipe.consumer_release(skip_dte = false)` | 消费者释放本阶段；`skip_dte` 含义同 `producer_commit`。 |

### 交互流程（逻辑顺序）

1. **`init()`** 一次。
2. **循环**：`producer_acquire` → 生产/填数据 → `producer_commit` → `consumer_wait` → 消费 → `consumer_release`，按实际并行度在多个生产者/消费者间交错执行（单生产者多消费者时，消费者侧通常按实现约定与 `ConsumerCount` 对齐）。

### 资源限制（实现约束，以官方文档为准）

| 约束项 | 上限（典型） |
|--------|----------------|
| 单个核函数内**同步屏障总数** | ≤ **2** |
| **`local_pipeline` 阶段总数** | ≤ **24** |
| **`shared_pipeline` 阶段总数** | ≤ **22** |

设计时需合并或减少屏障使用，并控制 `StagesCount`。

### 套圈问题（Phase / Token）与屏障

在环形多缓冲或有限阶段数的管道上，**生产与消费索引会「套圈」**：若仅用简单计数而不区分「第几轮」，可能出现**新旧数据混淆**（phase/token 问题）。

- **`InnerBarrier = true`（默认）**：管道内部通过**内联屏障**在阶段切换时自动保证**同一逻辑阶段内**生产者与消费者视图一致，**自动缓解套圈导致的错误排序**。
- **`InnerBarrier = false`**：内部不再代劳；开发者必须在**阶段边界**自行插入 **`__syncthreads()`、`shared_barrier` 或其它约定同步**，否则易出现套圈读写竞态。

### 示例 1：单生产者、多消费者，默认内联屏障

```cpp
// StagesCount=4, ProducerCount=1, ConsumerCount=2, InnerBarrier=true（默认）
tops::shared_pipeline<4, 1, 2, true> pipe;

__device__ void pipeline_body() {
  pipe.init();

  for (int iter = 0; iter < NUM_ITERS; ++iter) {
    // 生产者
    pipe.producer_acquire();
    // … 写入当前阶段缓冲区 …
    pipe.producer_commit(/* skip_dte = */ false);

    // 消费者 0 / 1（按 threadIdx 或角色划分）
    pipe.consumer_wait();
    // … 从就绪阶段读取 …
    pipe.consumer_release(/* skip_dte = */ false);
  }
}
```

> 实际核函数中需根据块内线程划分决定由哪些线程执行 `producer_*` 与 `consumer_*`，并保证 `ConsumerCount` 与参与 `consumer_wait/release` 的线程数语义一致。

---

## 4. 内存屏障（Memory Fence）

Tops C++ 中上述**同步接口**（如 `__syncthreads`、`__syncblocks`、`barrier` 的 `arrive`/`wait`、`pipeline` 的 `acquire`/`commit`/`wait`/`release` 等）在达到同步点的同时，通常带有**隐式内存屏障语义**：保证同步点之前的内存访问对同步点之后的参与者**可见顺序**符合模型要求。

若需与**非托管的原子或手写访存**混用，仍建议查阅官方内存模型说明，必要时使用显式 fence API（若编译器提供）。

---

## 5. 断言：`assert`

- **`assert(bool)`** 用于在**设备代码**中进行条件检查（工具链提供设备端 assert 支持头）；需先启用 **`TOPS_ENABLE_ASSERT`** 宏（默认关闭，未启用时断言不生效）。
- 失败时行为依赖运行时/编译选项（如是否终止线程、是否打印信息等）；**发布路径**上常通过宏关闭以避免开销。
- 仅作调试与防御性编程辅助，**不能**替代正确的同步与越界检查逻辑。

---

## 参考小结

| 主题 | 要点 |
|------|------|
| 线程同步 | 块内 `__syncthreads`；网格 `__syncblocks`（需协作）；子线程 `__syncsubthreads`（GCU400）。 |
| Barrier | `shared_barrier` / `local_barrier` / `global_barrier` + `init` / `arrive` / `wait` / `arrive_and_wait`。 |
| Pipeline（GCU400） | `shared_pipeline` / `local_pipeline`；注意屏障数量与阶段上限；套圈用默认 `InnerBarrier=true` 或手动屏障。 |
| 内存 | 同步 API 多含隐式内存序；复杂场景对照官方内存模型。 |
| 断言 | 设备端 `assert` 需 `TOPS_ENABLE_ASSERT` 宏启用（默认关闭）；勿依赖为唯一安全检查。 |
