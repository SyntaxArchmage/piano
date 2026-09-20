# Primo++ tensor_queue 编程模型

## 0. 概览

tensor queue 是 Primo++ 抽象层中的异步数据搬运容器:本质是一个具有一定深度(depth)的 data queue,在内部集成 pipeline、mem 与 dte 执行引擎,把"多级内存对象 + 异步流水"的常见配置打包成抽象接口。tensor queue 既负责承载用户用到的 mem 存储,也负责通过 dte 执行引擎完成多功能搬运,并通过 push/pop 语义维护多 stage 之间的数据依赖。

工作模式概要:

- **抽象层接口**:`copy/tile/untile/reshape/multi_cast`、`wait/signal/sync`、`layout/shape/stride`、`enqueue/dequeue_tensor`,所有抽象接口最终落到底层 `tops::dte operation`。
- **执行引擎**:engine 类(全量 dte 配置 + 多 vc 调度)与 copy 类(专用 dte 操作 + 增量配置接口)二选一。
- **存储所有权**:owning(tensor queue 内部构造存储 + 创建执行引擎)与 non_owning(tensor queue 管理外部已存在的存储与执行引擎)。
- **数据流模型**:push_queue / pop_queue 异步 producer/consumer 接口 + `*get` / `*put` 完整任务下发对 + 同步/异步双形态。

与 GEMM 的协同:Primo++ GEMM(见 `primo_gemm.md`)的左右支数据搬运、Coord Iterator 驱动的 shared / local 流水线,通常使用 tensor queue 提供异步搬运通道与多 stage mem 的依赖维护——`tile_async` / `copy_async` 等接口正是 GEMM 数据流 pattern 的常用承载。

## 1. 架构设计

### 1.1 执行引擎(engine 类 vs copy 类)

tensor queue 基于两种执行引擎提供对 dte 的操作能力:engine 类与 copy 类。两类执行引擎在抽象层接口上一致(都对外提供 `copy/tile/untile/reshape/multi_cast`、`wait/signal/sync` 等),差异在基础组件层:

| 维度 | engine 类 | copy 类 |
| :-- | :-- | :-- |
| 配置能力 | 全量 dte 配置 | 专用 dte 操作,增量配置接口(`set_addr/shape`) |
| 是否支持 `execute/emit` | 支持 | 不支持 |
| vc 调度 | 多 vc 调度管理 | 不涉及多 vc 调度 |
| 性能开销 | 完整配置成本较高 | 相对 engine 具备较好的性能开销 |

抽象层与基础组件层的对应关系:

- **抽象层**:`copy/tile/untile/reshape/multi_cast`、`wait/signal/sync`、`layout/shape/stride`、`enqueue/dequeue_tensor`。
- **engine 基础组件**:`copy/tile/untile/reshape/multi_cast`、`execute/emit`、`wait/signal/sync`,落到 `tops::dte operation`。
- **copy 基础组件**:`copy/tile/untile/reshape/multi_cast`、`set_addr/shape`、`wait/signal/sync`,落到 `tops::dte operation`。

### 1.2 owning vs non_owning 构造方式

tensor queue 对应的存储空间一般在 tensor queue 构造外声明,但其空间尺寸与 tensor queue 的 depth 关联,用户容易写错。为此 tensor queue 提供对存储空间所有权的直接声明与间接管理两种方式:

| 方式 | 行为 | 典型场景 |
| :-- | :-- | :-- |
| `owning` | tensor queue 内部构造时创建用户需要的存储空间,并创建用户指定的执行引擎 | 用户希望 tensor queue 端到端管理存储 + 执行引擎 |
| `non_owning` | tensor queue 管理外部用户生成的存储空间以及执行引擎 | vc 资源不够时,左右支共享同一个执行引擎 |

> copy 类的执行引擎不支持 owning 方式。

### 1.3 数据流依赖(push_queue / pop_queue / get / put / sync)

tensor queue 内部维护 pipeline 的 status。通常 tensor queue 维护多份的存储空间 mem,需要通过 pipeline 把不同 stage 的 mem 的 producer 与 consumer 串联起来。为此 tensor queue 抽象出 push_queue 与 pop_queue,对应 producer 与 consumer 关系,简化对多级 mem 与 pipeline 的使用。

#### push/pop 类接口

`push_queue*` / `pop_queue*` 建立异步的 producer / consumer 依赖关系。例如一次 tile 任务,src 数据来自上游 tensor queue 某一个 stage 的 mem,用户可用 pop 类接口建立 consumer 的数据依赖;同理 dst 方向用 push 类接口建立 producer 的数据依赖。下面以 tensor queue 作为 src,建立 consumer 数据依赖为例:

```cpp
auto src_tensor = tensor_queue_src.pop_queue_get_async();
tensor_queue.tile_async(dst_tensor, src_tensor, make_coord(0, 1));
tensor_queue_src.pop_queue_put_async();
```

#### `*get` / `*put` 类接口

`*get` / `*put` 完成一次完整任务下发。tensor queue 的执行引擎内部一般管理多个 vc,为保证任务配置与下发落到同一个 dte 任务通道上,`*get` / `*put` 配对完成对一次任务的请求与释放逻辑:

```cpp
push_queue_get();
// tensor queue tile/untile/transpose/...
push_queue_put();
```

#### 同步 / 异步接口

数据流依赖一般使用异步接口;对计算线程往往直接等待数据就绪并开始计算,需要线程同步。以 `pop_queue` 为例:

```cpp
pop_queue_get();              // 线程同步,执行结束后,数据依赖已就绪
pop_queue_get_async();        // 默认使用 local tensor queue 执行引擎
pop_queue_get_async(tensor_queue);  // 使用参数中 tensor queue 的执行引擎
```

## 2. 接口介绍

### 2.1 任务操作接口

tensor queue 提供封装好的 `tile`/`untile`/`copy`/`transpose` 类接口供用户直接调用,接口内部完成对数据流依赖的建立,简化算子实现:

```cpp
auto tensor_queue_lhs = make_owning_tensor_queue(xxxx);
auto tensor_queue_rhs = make_owning_tensor_queue(xxxx);
auto tensor_queue_out = make_owning_tensor_queue(xxxx);

// tile
tensor_queue_lhs.tile_async(tensor_queue_rhs, tensor_queue_lhs, make_coord(0, 0));
// copy
tensor_queue_lhs.copy_async(tensor_queue_rhs, tensor_queue_lhs);
// untile
tensor_queue_out.untile_async(tensor_queue_out, tensor_queue_rhs, make_coord(0, 0));
// tile + transpose
tensor_queue_lhs.tile_async(tensor_queue_rhs, tensor_queue_lhs, make_coord(0, 0), make_tuple(1, 0))
// transpose
tensor_queue_lhs.transpose_async(tensor_queue_rhs, tensor_queue_lhs, make_tuple(1, 0));
// ...
```

tensor queue 还提供 `emit` / `execute` 类接口,供用户直接操作 dte 执行引擎。

> 这类接口不支持 `copy_atom` 作为执行引擎构造的 tensor queue。

```cpp
auto tensor_queue     = make_owning_tensor_queue(xxxx);
auto tensor_queue_lhs = make_owning_tensor_queue(xxxx);
auto tensor_queue_rhs = make_owning_tensor_queue(xxxx);

// transpose_deslice with async
tensor_queue.emit_async(cmd::transpose_deslice{}, tensor_queue_rhs, tensor_queue_lhs, make_coord(0, 0), make_tuple(/* ... */));

auto src_tensor = make_tensor(xxx);
auto dst_tensor = make_tensor(xxx);
// copy sync
tensor_queue.execute(cmd::memcpy{}, dst_tensor, src_tensor);

// ...
```

### 2.2 任务依赖接口

tensor queue 同时提供同步与异步两类数据流接口,供用户定制化配置数据流依赖关系:

- `push_queue_get` / `push_queue_put`
- `pop_queue_get` / `pop_queue_put`
- `push_queue_get_async` / `push_queue_put_async`
- `pop_queue_get_async` / `pop_queue_put_async`
- `sync`(仅用于没有数据流依赖的场景中使用,对执行引擎的任务做强同步)

### 2.3 状态属性接口

获取当前 tensor queue 状态属性,用于调试打印等功能:

- `enqueue_tensor`:获取当前数据流水 stage 的 push queue tensor
- `dequeue_tensor`:获取当前数据流水 stage 的 pop queue tensor
- `layout` / `stride` / `shape`:获取构造 tensor queue 的存储空间信息
- `print`:打印 tensor queue 的属性信息,以及默认存储空间 tensor 信息

## 3. 使用限制

### 3.1 engine 类执行引擎

`engine` 管理多 vc 时,在相同 vc 上面下发任务 → 会触发一次强同步 → 原因:dte 对同一个 vc config 要求 vc 空闲才可以,触发一次强同步可以保证 dte config 发生在该 dte vc 执行结束之后。

### 3.2 copy_atom 类执行引擎

- copy_atom 类执行引擎构造的 tensor queue **必须使用 non_owning 方式**——原因:copy 类执行引擎本身不支持 owning 方式(见 §1.2 末尾原句),copy_atom 作为 copy 类的专用形态继承该限制。
- copy_atom 构造完成后,**只能通过 copy 接口提供的增量方法更新,且只能完成构造时指定的任务类型**——原因:copy_atom 是专用功能的数据操作,一旦完成 copy 构造,接口面已被锁定到指定任务类型;例如 tile 类型的 copy 构造的 tensor queue,后续只能调用 tensor queue 的 `tile` 方法。
- copy_atom 构造的 tensor queue **不支持 `emit` / `execute` 接口**——原因:`emit` / `execute` 直接操作 dte 执行引擎,需要 engine 类的全量 dte 配置能力,copy_atom 没有该能力。

### 3.3 数据流依赖与 sync 互斥

使用 `push_queue` / `pop_queue` 类接口建立数据流依赖的过程中 → **禁止使用 `sync` 类接口同步该 tensor queue** → 原因:`sync` 会破坏原有数据流关系。需要在数据流编排中做同步时,使用数据流接口自身提供的同步形态(`pop_queue_get` / `push_queue_get` 等同步对)来同步 tensor queue。

## 4. 调试选项

数据流架构中出现 hang 或数据 mismatch 较难 debug,调试工具受限于模板编程难以精确定位到具体函数与代码行。tensor queue 提供调试模式,把数据流编程中的异步下发转为同步,便于用户打印流水层级、分析数据流异常的原因。

### 4.1 使用方式

使用编译参数控制调试模式是否使能:

```
-DPPP_ENABLE_DEBUG
```

### 4.2 使用效果

数据流中,任务操作接口 `tile` / `untile` / `transpose` / `copy_async` 等异步任务接口在调试模式下:接口返回时,操作数据已完成。用户可以打印对应 stage 的 data buffer 用于排查异常。
