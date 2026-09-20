---
name: gcu400-dataflow
description: GCU400 (GCU400) 数据流模式与流水线设计。覆盖异构多线程组织（DTE sub-thread + compute sub-thread）、sub-thread 分配策略、DTE 分离初始化、双缓冲/三缓冲/深度 pipeline、子线程间通信（VDMEM/SDMEM/mailbox）、1D/2D 并行执行策略、L1 内存预算、生产者-消费者套圈防护和融合设计判据。用于设计新算子数据流架构、选择 sub-thread 分工方案、规划 pipeline buffer 深度或排查流水线气泡时。
---

# gcu400-dataflow

GCU400 的数据流架构建立在**异构多线程**之上：每个 SIP 上硬件 sub-thread slot 总数为 10，软件编程模型经 `__thread_dims__` 最多声明 8 个；硬件通过 S3 动态调度将来自不同 sub-thread 的指令分发到三类独立执行单元（T0 load/store、T1+T2 2D engine、VALU 1D），实现搬运与计算的同时执行。算子按"指令类型 → sub-thread 归属"原则组织数据流，通过 mailbox 同步和共享 L1 buffer 在 sub-thread 间传递数据。

## 异构多线程模式

S1+S2 每个 sub-thread 顺序产生指令。要同时喂饱三类执行单元，必须用多个 sub-thread 各自独立产生不同类型的指令——DTE sub-thread 产生标量配置 + T0 触发，compute sub-thread 产生 2D/1D 计算指令。

最基本的写法——1 个 DTE sub-thread + N 个 compute sub-thread：

```cpp
__thread_dims__(5, 1, 1)  // 5 sub-threads: 4 compute + 1 DTE
__global__ void kernel(...) {
    __local__ __valigned__ char shared_buf[BUFFER_SIZE];

    if (subThreadIdx.x < 4) {
        // compute sub-threads: 产生 2D + 1D 指令
        compute_branch(shared_buf, subThreadIdx.x);
    } else {
        // DTE sub-thread: 产生标量配置 + trigger 指令
        dte_branch(shared_buf);
    }
}
```

所有 sub-thread 共享同一 SIP 的 L1 VDMEM（896KB）和 L0P5（256KB）：sub-thread 不是独立核，是同一 SIP 内的指令流分片，物理资源不隔离。

## Sub-thread 分配策略

分配依据是各类指令的产生速率与执行单元的消费速率匹配关系：

### 典型分配方案

- **1+4**（1 DTE + 4 compute）：通用方案。compute sub-thread 竞争 VALU 和 2D engine，4 个 sub-thread 可轮流填充 S3 队列掩盖 latency。
- **1+7**（1 DTE + 7 compute）：极端计算密集、1D 后处理沉重的场景。更多 compute sub-thread 竞争 VALU 会增大 turn-around latency，需确认收益大于竞争代价。
- **2+6**（2 DTE + 6 compute）：搬运量大到单 DTE sub-thread 的标量配置吞吐不足以喂满 CDTE 带宽时。两个 DTE sub-thread 交替配置不同 VC，避免单 sub-thread S2 带宽瓶颈。
- **1+1+N**（Fetch + Load + compute）：调度逻辑包含链表遍历、L3 atomic 等纯标量密集操作时，从 DTE sub-thread 分离 Fetch sub-thread。标量密集操作消耗 S2 带宽，若与 DTE 配置在同一 sub-thread 中会阻塞 T0 指令产生。

### 选择判据

不要为"更多并行"盲目增加 sub-thread 数。多个 sub-thread 竞争同一执行单元会增大 turn-around latency（Load-to-Use + RAW + WAR + 竞争 delta），当竞争代价超过 overlap 收益时总延迟反而上升。

选择步骤：

1. 识别算子的指令类型组成（搬运 / 2D / 1D / 标量调度）
2. 估算各类指令的产生速率是否匹配执行单元的消费速率
3. 将产生速率不足的指令类型分配更多 sub-thread，已饱和的不加

## DTE 分离初始化

多个 `private_dte` 串行初始化（每个约 100-136 cycles 的寄存器配置）会产生显著 leading overhead。优化：让 compute sub-thread 在进入计算循环前帮 DTE sub-thread 初始化 DTE，通过 SDMEM stack 传递指针，再用 `__syncsubthreads()` 同步。

```cpp
__thread_dims__(5, 1, 1)
__global__ void kernel(/* params */) {
    __local__ __valigned__ char buf_a[TILE_BYTES * STAGE_NUM];
    __local__ __valigned__ char buf_b[TILE_BYTES * STAGE_NUM];

    if (subThreadIdx.x < 4) {
        // ---- compute sub-thread 帮忙初始化 DTE ----
        tops::private_dte dte_a, dte_b;
        // 配置 slice（仅做初始化，不 trigger）
        dte_a.config_slice(src_a_mdspan, dst_a_mdspan);
        dte_b.config_slice(src_b_mdspan, dst_b_mdspan);

        // 通过 stack（SDMEM）传递 DTE 句柄的内部指针
        __local__ __valigned__ tops::private_dte* dte_ptrs[2];
        dte_ptrs[0] = &dte_a;
        dte_ptrs[1] = &dte_b;

        __syncsubthreads();  // 确保 DTE sub-thread 能安全读取指针

        // ---- 进入计算循环 ----
        compute_loop(buf_a, buf_b, subThreadIdx.x);
    } else {
        __syncsubthreads();  // 等待 compute sub-thread 完成 DTE 初始化

        // ---- DTE sub-thread 读取已初始化的句柄 ----
        // 通过 SDMEM 获取 compute 侧传过来的 DTE 指针
        // 直接使用已配置好的 VC 进行 trigger/wait
        dte_loop(buf_a, buf_b);
    }
}
```

关键约束：

- `init()` / `destroy()` 生命周期必须在同一个 sub-thread 内闭合(local_dte)
- `__syncsubthreads()` 放在传递点而非循环内；循环内的全局 barrier 会打断 pipeline overlap。

## 子线程间通信

多 sub-thread 通信由三部分组成：数据承载、等待关系、可见性边界。fence 只约束当前 sub-thread 的访存顺序，不会让其他 sub-thread 到达同一执行点，所以不能当等待原语使用。

常用通信方式：

- **`tops::sync_subthreads()` / `__syncsubthreads()`**：做 SIP 内全员 phase 对齐。默认用 `tops::sync_subthreads()`；只有同步点同时需要全层级内存序时才用 `__syncsubthreads()`，否则会打断 DTE / compute overlap。
- **Mailbox**：做点对点 ready/free、ring handoff、DTE ↔ compute 或 1D ↔ 2D 通知。每个 wait 对应唯一可达的 notify；ring buffer 第一轮前先投放初始 free token。
- **Pipeline / queue**：做规则 staged buffer 的生产者-消费者切换。producer acquire/commit 与 consumer wait/release 成对出现，计数错位会耗尽 stage 或提前复用 stage。
- **Barrier / mbarrier**：做固定小组内部同步。每组使用独立 barrier，`init(count)` 等于本组真实参与者。

可见性边界按数据路径选：SIP load/store 路径在发 ready 前加 store fence、发 free 前加 load fence；DTE 路径用对应 event / `wait()` 作为边界，`wait()` 返回表示这次 DTE 读写已经完成，可以发 ready/free token。

接口速查：

- **Mailbox**：`tops_alloc_mailbox()` / `tops_free_mailbox(id)` 管理 mailbox id；`tte::task_t::init(id)` 初始化并绑定；`task.init_(id)` 绑定已有 id；`task.arrive()` 或 `task.arrive<mirror_space>()` 发送 token；`task.wait()` 等待并消费 token。GEMM 后通知优先用 mirror-space wrapper，避免额外 L0 fence。
- **Pipeline / queue**：`Pipeline<DEPTH, PRODUCER_COUNT, CONSUMER_COUNT>` 声明深度和参与者数量；`initQueue()` / `init()` 初始化；`producerAcquire()` / `producer_acquire()` 等空闲 stage；`producerCommit()` / `producer_commit()` 发布 ready stage；`consumerWait()` / `consumer_wait()` 等 ready stage；`consumerRelease()` / `consumer_release()` 释放 stage。DTE 填充或回写 stage 时，commit / release 前先等对应 DTE event。
- **Barrier / mbarrier**：`tte::mbarrier_t<tte::LocalScope>` 用于 SIP 内小组；`tops::shared_barrier` / `tops::global_barrier` 用于 block / grid 层级；`barrier.init(count)` 设置参与者数量；`arrive_and_wait()` 到达并等待；`arrive()` / `wait(phase)` 分离到达和等待；`arrive_and_drop()` 只给后续不再参与的 sub-thread 使用。

`PRODUCER_COUNT` / `CONSUMER_COUNT`、barrier `count` 和 mailbox token 数都要和真实参与者匹配；这些计数是同步协议本身，错位会死锁或提前释放仍在使用的 slot。

更完整的协议模板见 `document/subthread_communication.md`。

## Pipeline Stage 决策

按算子的指令类型组合选择 stage 数。Stage 划分先于 buffer 深度——stage 决定有几个独立产生指令的 sub-thread 角色，buffer 深度只决定每个角色之间的 slot 数。

| 算子形态 | Stage 划分 | 为什么这样划 |
| :-- | :-- | :-- |
| 纯 element-wise | 2-stage：DTE + Compute | 只有搬运和计算两类指令，无需再拆 |
| GEMM + 1D 后处理 | 3-stage：Load / 2D / 1D 后处理 | 2D 串行，需要独立 sub-thread 喂饱 T0、2D engine、VALU 三个执行单元 |
| GEMM + 复杂调度 | 4-stage：Fetch / Load / 2D / 1D | 调度逻辑（链表遍历、L3 atomic 等）的标量指令会抢 S2 带宽，必须独立成 Fetch sub-thread 保护 2D 利用率 |

3-stage 升 4-stage 的判据：调度路径出现链表 / page-table / atomic / 大量分支时，把 Fetch 拆出去。Fetch 的标量密集流与 DTE 的 T0 配置共享 S2 带宽，挤在一个 sub-thread 时 T0 指令产生速率跟不上 DTE 消费速率，CDTE 带宽利用率下降。

## Pipeline 缓冲设计

### 双缓冲

最简形式：2 个 buffer slot 交替使用，DTE 写 slot A 时 compute 读 slot B。

局限：若 L3 latency > compute time，DTE wait 会暴露为气泡（compute 空等数据）。

### 三缓冲

通过调整 DTE 的 wait/trigger 顺序消除气泡：

```text
稳态时序：
  DTE:     trigger[i+2] → wait[i] → config[i+2]
  Compute: wait[i] → compute[i] → notify[i]
```

三缓冲没有固定实现模板——根据具体 DTE wait/trigger 的顺序调整。核心是让 DTE 在 wait 返回前已经 trigger 了下一笔搬运。

### 深度 Pipeline

当 L3 latency 远大于单 tile 计算时间时，buffer 深度公式：

```text
stage_num >= ceil(max_L3_latency / compute_time_per_tile) + pipeline_depth
```

实现方式：

```cpp
constexpr int stage_num = STAGE_NUM;
__local__ __valigned__ char data_buf[stage_num][TILE_BYTES];

// 每个 sub-thread 通过 cnt++ % stage_num 索引当前 buffer slot
int slot = cnt % stage_num;
```

### 多生产者/多消费者套圈防护

当多个 compute sub-thread 消费同一 buffer slot 时，必须确保**所有**消费者都完成后 DTE 才能覆写该 slot。

```cpp
// 错误：单 notify 只能确认一个消费者完成
// DTE 收到 notify 后覆写 → 另一个消费者还在读 → 数据损坏

// 正确：添加 barrier 等待所有消费者
// 方案 1：消费者侧 barrier 同步后由一个代表 notify DTE
// 方案 2：DTE 分别等待每个消费者的 notify（mailbox 点对点）
```

选择取决于消费者数量和 barrier 开销。消费者数量少（2-3）时点对点 notify 更轻量；消费者多时用 barrier + 代表。

## 1D/2D 并行执行策略

2D 指令（GEMM、MSF）和 1D 指令（MOP、REDSUM stage 0-2、VMOV）在 S4 使用不同执行单元，可以流水并行。设计含义：

- 一个 compute sub-thread 做 GEMM 时，另一个 compute sub-thread 的 1D 后处理（scale、add、cvt）可以同时执行
- 将前一 tile 的 1D 后处理与当前 tile 的 2D 计算分配到不同 sub-thread，实现 2D/1D 交叉流水

### PP（Pipeline Parallel）模式

将一个大计算任务拆成两个阶段分配到不同 sub-thread：

- sub-thread A：QK matmul + online-softmax 前半
- sub-thread B：PV matmul + online-softmax 后半

收益：每个 sub-thread 的 matmul M 维从 16 变为 32（因为 OACC 预算在两个 sub-thread 间分摊），2D 利用率提升。

约束：两个阶段之间有数据依赖时，通过 mailbox + 共享 VDMEM buffer 传递中间结果。

## SIP 间任务分配

跨 SIP 的工作量分配必须均匀，禁止简单 `total / num_sip` floor 除法。余数全部堆到最后一个 SIP 时，尾部 SIP 计算时间远长于其他 SIP，整算子会被尾部拉长。

均匀分配公式（任务量同质时）：

```cpp
// num_sip 个 SIP 处理 total 个任务
int base = total / num_sip;
int extra = total % num_sip;
int my_count = base + (sip_id < extra ? 1 : 0);
int my_start = sip_id * base + min(sip_id, extra);
```

任务量差异大（按 shape / dtype / sparse 度走不同路径）时，静态均匀分配仍会拉尾——改用 cost-model 贪心：估算每个任务的 cycle / byte 代价，按代价排序后贪心填到 num_sip 个桶里。

任务数 < SIP 数时，多余 SIP 空闲不可避免，考虑动态调度让先完成的 SIP 抢下一批任务，而不是固定 sip_id 分配。

## 内存预算

单 SIP 片上有四类容量独立的物理资源，算子分别在各自上限内规划：DSM 分布式内存（数据 buffer 主池）、SDMEM（栈 + 参数）、OACC（1D/2D 运算寄存器）、L0P5（GEMM 操作数 cache）。

### DSM 合计 7MiB

DSM（Distributed Shared Memory）把计算集群内 8 块 896KiB VDMEM 整合成同一物理池，并映射到两类可分配地址空间：

- **本地内存（亲和，per-SIP）**：每个 SIP 一份，由该 SIP 上全部线程及其 sub-thread 使用，是流水设计的主预算；访问本 SIP 亲和段，带宽较高、延迟较低，适合 SIP 内私有流水 buffer 与中间结果
- **共享内存（非亲和，cluster-wide）**：一份 cluster-wide 空间，由计算集群内全部线程块共享，仅在需要跨 SIP 共享数据时分配；数据共享范围更大，但带宽较低、延迟较高

本地内存的典型占用：pipeline buffer（双/三/深度，占主体）+ 中间结果暂存（fusion 场景）等。共享内存会挤占同一 DSM 物理池；只在数据确实需要跨 SIP 共享时申请，否则优先把 buffer 留在本地内存。

host 侧分配约束：

```text
local_per_thread = align_up(local_per_thread, 4KiB)
local_per_sip    = local_per_thread * thread_count_per_sip
shared           = align_up(shared, 32KiB)

128KiB <= local_per_sip <= 896KiB     // 单 SIP 本地内存范围
所有 SIP 的 local_per_sip 相同          // DSM 划分按 cluster 统一生效
shared <= 6MiB                        // cluster 共享内存上限
local_per_sip * 8 + shared <= 7MiB    // 本地与共享共用 8 * 896KiB 物理池
```

只用本地内存时 `local_per_sip` 可达 896KiB；共享内存拉满 6MiB 时，`local_per_sip` 只能保留到 128KiB 下限。本地超预算时减小 tile size、减少 stage_num、减少独立 buffer 数，或拆分多次 launch；不同 local/shared 组合对 DSM 物理池的有效使用率不同。

### SDMEM：128KB / SIP

- Stack（每 sub-thread ≤ 10KB）
- Parameter buffer + Stack Local 总尺寸 ≤ 128KB（SDMEM 容量上限）

### OACC：768 个 / SIP

通过 `maxnreg` 在 sub-thread 间分配（最小粒度 4 OACC）。GEMM 输出驻留在 OACC 中直到被消费（store 或后续 accumulate），OACC 是"伪 L0"角色。

OACC 预算紧张的信号：编译器产生 spill（OACC → VDMEM → OACC），严重影响性能。

### L0P5：256KB / SIP

由 GEMM 的 LHS/RHS 自动使用，所有 sub-thread 共享；算子侧通过 footprint order 控制驻留策略（LHS 驻留 vs RHS 驻留），不直接管理容量。内部 cache 划分（IV / SMR 等）在算子层不可见。

## 融合设计判据

融合的收益是中间结果留在片上（OACC 或 L1），避免写回 L3 再读回的带宽开销。

### 融合前检查

1. **中间结果能否驻留**：输出留在 OACC 中被下一阶段直接消费（最优），或暂存 L1 被同一 kernel 内其他 stage 消费。若中间结果超出 OACC + L1 预算 → 不融合。
2. **1D/2D 配平**：融合后的算子是否能利用 1D/2D 并行？若融合使得所有计算串行挤在一类执行单元上 → 融合收益有限。
3. **pipeline 是否仍能建立**：融合后的单 tile 计算时间是否足以掩盖搬运延迟？若 tile 变大使 stage_num 需要增加但 L1 容不下 → 不融合。
4. **fallback 语义一致**：融合路径必须有非融合 fallback，且两者数学语义一致。

### 典型可融合模式

- GEMM + scale + activation（输出留 OACC → 1D 后处理 → store）
- GEMM + quant（OACC → cvt → store，减少一次 L3 round-trip）
- LayerNorm + 前置 elementwise（前置结果暂存 L1，reduce 在同一 kernel 完成）

### 不要融合的信号

- 中间结果的 shape 使 OACC 或 L1 预算爆炸
- 融合后 tile size 被迫缩小到 2D 利用率显著下降
- 两个操作的最优 tile 划分方向不一致（一个沿 M 切、一个沿 N 切）

## 流水线设计步骤总结

设计一个新算子的数据流架构时，按以下顺序决策：

1. 识别指令类型组成 → 确定 sub-thread 数量和分工
2. 确定 tile size → 受 OACC 预算、L1 预算、2D 利用率三方约束
3. 确定 pipeline 深度 → 受 L3 latency / compute_time 比值决定
4. 规划 L1 layout → pipeline buffer + intermediate + stack 总和 ≤ 896KB
5. 确定同步方案 → mailbox 点对点 vs barrier，最小化同步开销
6. 验证 1D/2D overlap → 确认不同 sub-thread 的指令类型不竞争同一执行单元

## 参考资料

需要查 V3 内存层次、地址空间或 sub-thread 资源时按主题选读:

- `document/sip_arch_memory.md` — Memory Subsystem 总览、DSM / Private / Shared 视角、MMU、Memory Consistency、LD/ST 指令族
- `document/subthread_communication.md` — 多子线程 VDMEM / SDMEM / mailbox / pipeline / barrier 通信协议
