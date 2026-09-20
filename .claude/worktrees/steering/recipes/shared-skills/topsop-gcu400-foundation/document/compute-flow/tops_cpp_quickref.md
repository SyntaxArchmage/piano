# Tops C++ 编程指南核心速查

> 从《Tops C++ 编程指南》提炼的编程模型速查(正文全文见 `tops_cpp_programming_guide.md`)。写 kernel 前先过一遍本节,细节查全文或 `topscc_*` 签名字典。数值以官方文档为准,标注"以当前工具链/运行时为准"的项随版本可能变化。

## 1. GCU 架构代际差异

| 特性 | GCU300 | GCU400 | GCU500 |
|---|---|---|---|
| SIC 数量 | 2 | 4 | 16 |
| SIP / SIC | 12 | 6 | 4 |
| SIP 多线程 | 不支持 | 2 线程/SIP, 8 子线程/SIP | 支持 |
| 默认向量宽度 | 128B (`__vector`) | 512B (`__vector`) | 512B (`__vector`) |
| DSM | 无(GCU400 起新增) | 7 MiB / SIC(共享内存限 6 MiB) | 移至 SIP 层 |
| 全局内存直接指针访问 | 支持(对齐要求高) | 支持 | 支持 |

## 2. 函数指示符

| 指示符 | 执行位置 | 调用位置 | 说明 |
|---|---|---|---|
| `__global__` | 设备 | 主机 | 入口核函数，必须 void 返回 |
| `__device__` | 设备 | 设备 | 设备端函数 |
| `__host__` | 主机 | 主机 | 默认（不写等同于 __host__） |
| `__host__ __device__` | 两侧 | 两侧 | 用 `__AGCU_ARCH__` 宏区分 |
| `__cooperative__` | 设备 | 主机 | 配合 `__global__`，可用 `__syncblocks()` |
| `__thread_dims__(N)` | 设备 | 主机 | 配合 `__global__`，指定子线程数 (GCU300+) |
| `__forceinline__` | 设备 | — | 强制内联 |

## 3. 变量内存空间指示符

| 指示符 | 内存空间 | 可见范围 | 生命期 |
|---|---|---|---|
| 无 (自动变量) | 私有内存(寄存器) | subthread 独享 | 线程生命期 |
| `__local__` | 本地内存 | thread 共享 | 线程生命期 |
| `__shared__` | 共享内存 | block 共享 | 线程块生命期 |
| `__device__` | 全局内存 | 全局 | 设备上下文 |
| `__constant__` | 常量内存 | 全局(只读) | 设备上下文 |

关键规则：
- `__valigned__` 保证向量对齐（GCU300: 128B，GCU400: 512B）
- 本地内存用于存放参与计算的向量和张量数据
- 动态共享内存 `extern __shared__` 需在启动时指定大小
- 指针宽度：通用/全局 = 64-bit，共享/本地/私有/常量 = 32-bit

## 4. 向量类型

| 关键字 | GCU300 | GCU400 |
|---|---|---|
| `__vector` | 128 bytes | 512 bytes |
| `__vector2` | 256 bytes | 1024 bytes |
| `__vector4` | 512 bytes | 2048 bytes |

**推荐**: GCU400 用 `__vector`，GCU300 用 `__vector4`。

辅助工具：
- `tcle::simple_altivector<T>::VT` — 自动选择推荐向量类型
- `tcle::altivector<T, N>::VT` — 按元素个数 N 指定向量类型
- `tcle::altivector_to_mask<VT>::type` — 获取对应 bool 向量类型
- `tcle::altivector_to_scalar<VT>::type` — 获取对应标量类型
- `TCLE_SINGLE_VEC_BYTES` — 标准向量字节数 (GCU300: 128, GCU400: 512)

## 5. 线程模型

**层级**: Grid → Block → Thread → Subthread (GCU400+)

**内置变量**: `gridDim`, `blockIdx`, `blockDim`, `threadIdx`, `threadDim`, `subThreadIdx`

**TOPS vs CUDA 对应**:

| GCU/TOPS | GPU/CUDA | 差异 |
|---|---|---|
| SIMD lane | thread | TOPS 无等价概念 |
| subthread | warp | 向量宽度不同 |
| thread | block | 几乎等价 |
| block | cluster | TOPS block 有共享内存 |
| grid | grid | 等价 |

**同步接口**:

| TOPS | CUDA | 范围 |
|---|---|---|
| `__syncsubthreads()` | `__syncthreads()` | thread 内 subthread 同步 |
| `__syncthreads()` | `cluster.sync()` | block 内 thread 同步 |
| `__syncblocks()` | `grid.sync()` | grid 全局同步 (需 cooperative) |

## 6. DTE 数据变换引擎

**DTE 类型** (GCU400/AGCU400):
- `tops::shared_dte` — block 共享，全局↔共享内存
- `tops::local_dte` — thread 本地，全局↔本地内存
- `tops::private_dte` — subthread 私有，全局↔本地内存

**核心操作**:
- `tops::memcpy(dte, dst, src)` / `tops::memcpy_async(...)` — 拷贝
- `tops::slice(dte, dst, src, offset)` — 切片
- `tops::deslice(dte, dst, src, offset)` — 反切片
- `tops::transpose(dte, dst, src, layout)` — 转置
- `tops::broadcast(dte, dst, src)` — 广播
- `tops::pad(dte, dst, src, ...)` — 填充
- 以及 `slice_transpose`, `transpose_deslice`, `slice_pad`, `slice_deslice` 等组合接口

**异步启动**: `tops::event ev = tops::memcpy_async(dte, dst, src);` → `ev.wait();`

**DTE 资源限制**:
- GCU300: 私有 DTE ≤ 6;不启动标量线程时共享+本地+私有总数 ≤ 16,否则 ≤ 8
- GCU400: 共享+本地+私有总数 ≤ 16;AGCU300 兼容构建下本地+私有 ≤ 12;本地 DTE 另有单独上限(以当前工具链为准)

## 7. 同步机制 (GCU400 增强)

**计数同步 (Barrier)**:
- `tops::shared_barrier` — block 级
- `tops::local_barrier` — thread 级 (GCU400 新增)
- `tops::global_barrier` — grid 级 (需 `__cooperative__`)
- 接口: `init(count)`, `arrive_and_wait()`, `arrive()`, `wait()`

**管道流水线 (Pipeline)** (GCU400+):
- `tops::shared_pipeline<Stages, Producers, Consumers>` / `tops::local_pipeline<...>`
- 生产者-消费者模型：`producer_acquire()` → 异步操作 → `producer_commit()` → `consumer_wait()` → 计算 → `consumer_release()`
- 管道阶段限制：本地 ≤ 24，共享 ≤ 22

## 8. 核函数调用约定与资源限制

**核函数描述符**关键字段：代码段大小、静态共享/本地内存大小、栈大小、线程维度、DTE 数量、同步资源数量、寄存器数量。

**GCU400 资源限制**:
- 栈大小 ≤ 1MiB + 10KiB（前 10KiB 为 L1 高速访存，其余 L3 低速）
- 静态本地内存 ≤ 896KiB
- 静态共享内存 ≤ 6MiB (AGCU400 模式) 或 64MiB (兼容模式)
- 全局+共享+本地 BARRIER 总数 ≤ 2
- 常量数据段 ≤ 8KiB（AGCU 技术参数表口径）
- 参数 ≤ 4KiB

**GCU400 技术参数**:
- 单 SIP 最大 2 线程、8 子线程
- 单 SIP 寄存器: 768 VACC
- 单 SIP 本地内存: 896KiB
- 单 SIC 共享内存: 6MiB
- 单 SIC 线程数: 12

## 9. 性能优化四大方向

1. **最大化利用率** — 多流并行、合理 Grid/Block 维度、子线程占用率
2. **最大化内存吞吐量** — DTE 双缓冲(Ping-Pong)、数据复用、对齐访问
3. **最大化指令吞吐量** — 减少低吞吐指令(标量64bit)、减少分支、精确同步
4. **最小化内存颠簸** — 优化设备内存分配策略

**数据流写法选择** (GCU400):

| 写法 | 适用场景 | 特点 |
|---|---|---|
| SIP 直接访存 | 计算瓶颈、gather/scatter | 不使用 DTE |
| DTE 软件流水(Ping-Pong) | GCU210+ 兼容 | 单线程手动双缓冲 |
| Private DTE 同构多线程 | **GCU400 1D 推荐** | 各子线程独立搬运+计算 |
| Local DTE 同构多线程 | 需共享搬运结果 | 其中一个或几个子线程搬运 |
| DTE 异构多线程 | 2D 算子 | 搬运子线程+计算子线程分离 |

**瓶颈分析**: 算术密度 = Flops/Byte，与设备算力带宽比对比判断计算/带宽瓶颈。

**子线程占用率**: `O = N_resident / N_max × 100%`

**编译优化**:
- `-res-usage` 查看资源使用
- `#pragma unroll` 循环展开
- 软流水默认开启，`#pragma clang loop pipeline(disable)` 可禁止
- `-mllvm -topscc-resid-opt=true` 寄存器优化

## 10. 编程接口关键 API

**内存管理**: `topsMalloc`, `topsFree`, `topsMemcpy`, `topsMemcpyToSymbol`, `topsHostMalloc`

**执行流**: `topsStreamCreate`, `topsStreamSynchronize`, `topsMemcpyAsync`

**事件**: `topsEventCreate`, `topsEventRecord`, `topsEventSynchronize`, `topsEventElapsedTime`

**异步分配**: `topsMallocAsync`, `topsFreeAsync`, `topsMemPoolCreate`

**核函数启动**: `kernel<<<gridDim, blockDim, sharedMem, stream>>>(...)` 或 `topsLaunchKernel`

**错误处理**: `topsGetLastError()`, `topsPeekAtLastError()`

## 11. 预定义宏

| 宏 | 用途 |
|---|---|
| `__AGCU_ARCH__` | 抽象架构版本 (200/300/400) |
| `__GCU_ARCH__` | 真实架构版本 (210/300/400/500，取值以当前编译器为准) |
| `__TOPSCC__` | 判断是否 TOPSCC 编译 |

## 12. 环境变量

| 环境变量 | 说明 |
|---|---|
| `TOPS_VISIBLE_DEVICES` | 控制可见 GCU 设备 |
| `CAPS_LOG_LEVEL` | 运行时日志级别 (0-8，默认值以当前运行时为准) |
| `TOPS_ENABLE_DEFERRED_LOADING` | 延迟加载（默认值以当前运行时为准） |
