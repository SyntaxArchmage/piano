# DTE Architecture Reference

> DTE 是 Libra SoC 上专责数据搬运 / 形变(slice / deslice / reshape 等 shape 变换)的 IP,分为 ODTE / CDTE / EDTE 三类,提供基于多维 tensor 描述的 Linear / Sync / Tiling / Combo 四类 operation,内部以 Multi-VC + Multi-Thread + Decoupled Read/Write Pipeline 实现并发执行。

---

## 1. DTE 概览(§4)

DTE 执行的基本单位是 command packet。每条 command packet 通过 CF(Control Fabric)总线下发,落在 DTE 内某一个 VC 中。DTE 内部有多 VC 与多 thread,arbiter 在 VC 间仲裁,选中 VC 中的 command 推到一条 thread 上执行;command 执行完成后,DTE 通过 CF 总线发出 signal,通知对应 engine。

设计上 DTE 围绕三条原则:

1. **Multi thread**——更充分地利用接口带宽。
2. **Multi-stage pipeline**——降低 command 切换的开销,带宽利用率更高。
3. **Read/write decouple**——支持更多操作组合与更高效的读写 pattern。

DTE 在 Libra 中按所处 hierarchy 例化为三类:ODTE、CDTE、EDTE。

### 1.1 三类 DTE 的部署位置与职责(§4.1-4.3)

| 类型 | 部署位置 | thread 数 | R/W port 组数 | 主要职责 | 内置 MMU | 备注 |
|------|----------|-----------|---------------|----------|----------|------|
| ODTE | SOC top,每个 Die 1 个 | 2 | 2 | host ↔ L3 数据传输 | 是(2 路 df path 各 1 个) | data channel0 上挂 xts 模块,做 host → L3 数据解密(隐私计算) |
| CDTE | cluster 级 | 4 | 4 | L3 / DSM 之间数据传输 | 否(在外部和 SIC 复用 MMU) | 每个 thread 绑定一组 R/W port 构成 1 个 Physical Channel;支持 SPMD(单 command 拆分到多 thread 并行执行) |
| EDTE | SOC top,每个 Die 1 个 | 2 | 2 | L3 内部数据传输 | 是(2 路 df path 各 1 个) | — |

### 1.2 ODTE 关键事实

- 由于去 host 的访问 latency 较大,ODTE 的 outstanding 设为 1024,以避免 latency 影响有效带宽。
- 两个 thread 可以并行执行 host → L3 与 L3 → host 两个方向的数据搬运;sw 需要使用每条通路上的 xmc aperture 配置 host mem address range,以便识别 host mem 访问不做 hash。
- ODTE 内两路 df path 分别集成一个 mmu,负责 DVA(device virtual address)→ IPA(intermediate physical address)地址转换。

### 1.3 CDTE 关键事实

- CDTE 可以访问相邻的 SIC DSM,也可以经过 MMU 访问 L3(CDTE 内没有 MMU,在外部与 SIC 复用 MMU)。
- 4 组 R/W port 属性完全相同,每个 thread 绑定一组,构成 1 个 Physical Channel。
- 为了充分合理利用 L3 带宽,CDTE 支持把单条 command split 成多份发到多个 thread 并行执行(SPMD 功能)。

### 1.4 EDTE 关键事实

- 主要完成 L3 内部数据传输;两个 thread + 两组 R/W port,thread 与 port 绑定。
- EDTE 内两路 df path 各集成一个 mmu,负责 DVA → IPA 地址转换。

---

## 2. Multi VC(§7.1)

DTE 提供多 VC 的编程接口。每个 VC 由若干 register 组成一个 register group,作为存储**单条 DTE command** 的基本单位。VC 内的 register 包括 command 配置、依赖 / mailbox 状态、执行进度等;VC 是 DTE 接收上层下发 command 的最小调度单元。

CDTE 与 ODTE / EDTE 的 VC 数量不同,具体可由 DTE 物理地址空间中 VC reg 的占用大小推断(本文不展开 §6 内务部分)。

---

## 3. Multi Thread(§7.2)

每个 DTE 由多个 thread 组成,每个 thread 都可以独立执行一条 DTE command,多 thread 可以并行执行多条 command:

- ODTE / EDTE:2 个独立 thread。
- CDTE:4 个独立 thread。

一个 thread 由 4 条 pipeline 组成:**read request、read response、write request、write response**。

### 3.1 inflight 与最小搬运 size

- 每个 thread 的 R/W pipe 支持 up to 4 个 command inflight;为达到最佳 performance,inflight command 对应的最小 size:ODTE / EDTE / CDTE 均为 32KB。
- 只有 ultra-thread 才能执行 reshape 指令;normal thread 不能。Libra 上增加了 inflight reshape 功能,执行 reshape 的同时 pipeline 可处理其它指令。

### 3.2 read / write 顺序与 ID

- 同一 thread 内多个 command 的 read 按顺序执行,ARID 相同;不同 thread 的 ARID 不同。对同一 thread,read 数据返回顺序是 in-order。
- 同一 thread 内多个 command 的 write 也按顺序执行,AWID per command;返回的 write response 可以是 out-of-order。

### 3.3 write response pipe 与 signal pipe

- write response pipe 负责管理当前 thread 的 write response,inflight = 8 个 command response per thread。
- signal pipe 负责管理所有 thread 内已完成 command 的 signal,独立于单个 thread 之外;同时管理的 inflight command 数 = 8 × thread_number。signal 必须先收完一条 task 的所有 write response,因 write response 是 out-of-order 返回,signal 的执行也是 out-of-order。

---

## 4. VC Arbitration / Port Allocation(§7.3-§7.5)

VC → thread 静态绑定、Round-Robin / order list / qqos 三级仲裁、port 与 thread 一一绑定等仲裁机制由硬件按 QoS 自动决策,算子层不直接控制,本文不展开;对算子可见的两条结论:

- 多个 VC 之间是按 QoS + 配置顺序 + RR 由硬件仲裁,算子不需要也无法手工调度 VC 顺序——`qqos` 字段配置的影响详见 §11.3 Prefetch 节。
- CDTE / EDTE / ODTE 每组 R/W port 与 thread 一一绑定,属性完全相同;给 command 分配 thread 即决定 port。

---

## 5. Decoupled Read/Write Pipeline(§7.6)

DTE 的 read 与 write 部分通过 **DTE internal buffer** 做隔离,完全解耦:

- **Read 路径**:按 source tensor 的 size 与 source 侧操作发起 read request;数据返回时经过 read data processing,把数据**linear** 存入 DTE internal buffer。
- **Write 路径**:source 端是 linear 存于 internal buffer 的数据;write request / data processing 只需按 destination tensor 的 size 与操作做传输,不必关心 source data 是怎样存入 internal buffer 的。

| 阶段 | 输入 layout | 输出 layout | 处理 |
|------|-------------|-------------|------|
| Read | source tensor 形状 | DTE internal buffer 中的 linear storage | read data processing |
| Write | DTE internal buffer 中的 linear storage | destination tensor 形状 | write data processing |

这种解耦使 read 侧与 write 侧的 OP 可以独立组合,从而生成 §10.4 所列的 combo OP。

---

## 6. Data Format(§7.7)

| 属性 | 规格 |
|------|------|
| Bytes Per Element(BPE) | 1(INT8)、2(FP16 / BF16)、4(FP32 / TF32) |
| Tensor 维度 | 5 个 dim(dim0-dim4)定义 tensor 形状,4 个维度(dim0-dim3)有操作数定义 |
| 单 dim size 上限 | 24 bit |
| dim4 行为 | 没有任何操作数,仅做对低 4 个维度操作的纯重复 |

---

## 7. Total size(§7.8)

DTE 支持的最大 size 为 **512GB - 1B**——也就是 linear cp size 以及 tiling 操作的 src、dst tensor size 都不能超过 512GB - 1B。

---

## 8. Operation 模式(§7.9)

DTE 支持的 OP 与各 DTE 类型对应关系如下表(`Y` = 支持,`N` = 不支持):

### 8.1 OP 总表

| OP type | Abbr / op_code | ODTE | EDTE | CDTE | 类别 |
|---------|----------------|------|------|------|------|
| Linear Copy | LNC / 0x01 | Y | Y | Y | Linear |
| Single Sync | SS / 0x02 | Y | Y | Y | Sync |
| Global Sync | GS / 0x03 | Y | Y | Y | Sync |
| Data Shrink | DS / 0x06 | Y | Y | Y | Linear |
| Data Expand | DE / 0x07 | Y | Y | Y | Linear |
| Constant Filling | CF / 0x08 | Y | Y | Y | Linear |
| Padding | PAD / 0x10 | Y | Y | Y | Tiling |
| Reshape | RSHP / 0x12 | N | N | Y | Tiling |
| Broadcasting | BRDCST / 0x13 | N | N | Y | Tiling |
| Slice | SLC / 0x14 | N | N | Y | Tiling |
| De-Slice | DSL / 0x15 | N | N | Y | Tiling |
| Sub-Sample | SSMP / 0x16 | N | N | Y | Tiling |
| Horizontal Mirror | HMIR / 0x17 | N | N | Y | Tiling |
| Vertical Mirror | VMIR / 0x18 | N | N | Y | Tiling |
| Slice + Padding | SLCPAD / 0x30 | N | N | Y | Combo |
| Slice + De-Slice | SLCDSL / 0x31 | N | N | Y | Combo |
| Slice + Data Expand | SLCDE / 0x32 | N | N | Y | Combo |
| Horizontal Mirror + De-Slice | HMIRDSL / 0x33 | N | N | Y | Combo |
| Vertical Mirror + De-Slice | VMIRDSL / 0x34 | N | N | Y | Combo |
| Horizontal Mirror + Padding | HMIRPAD / 0x35 | N | N | Y | Combo |
| Vertical Mirror + Padding | VMIRPAD / 0x36 | N | N | Y | Combo |
| Constant Filling + De-Slice | CFDSL / 0x37 | N | N | Y | Combo |
| Slice + Reshape | SLCRSHP / 0x38 | N | N | Y | Combo |
| Reshape + De-Slice | RSHPDSL / 0x39 | N | N | Y | Combo |
| Data Shrink + De-Slice | DSDSL / 0x3a | N | N | Y | Combo |
| Slice + Broadcasting | SLCBRDCST / 0x3b | N | N | Y | Combo |

可见 Reshape / Slice / De-Slice / Sub-Sample / Mirror / Broadcasting 及全部 Combo 仅在 **CDTE** 上支持;ODTE / EDTE 仅做 Linear / Sync 类与 Padding。

### 8.2 Linear Type(§7.9.1)

| OP | 行为 |
|----|------|
| Linear Copy(LNC) | 将指定 size 的连续数据从 source address copy 到 destination address |
| Data Expand(DE) | 通过填 0 的方式,把 BPE1 / 2 / 3(EF32)的 data expand 到 BPE2 / 4(bpe4 pad0) |
| Data Shrink(DS) | 通过截取的方式,把 BPE2 / 4 的 data shrink 到 BPE3(EF32) / 2 / 1(bpe4 下采样) |
| Constant Filling(CF) | 把预设的常数填到指定的地址空间 |

### 8.3 Sync Type(§7.9.2)

| OP | 行为 |
|----|------|
| Single Sync(SS) | 仅完成 producer / consumer 之间通过 mailbox / signal 方式的 sync 动作,**没有数据传输** |
| Global Sync(GS) | DTE dedicate 的 Gsync command,支持整个系统的 Global Sync 功能 |

GS 进一步拆为两种 sub-command:

- **Gsync Register**:注册到 Global Sync module 的某一个 entry 中;define 对应 entry 信息,sync 条件满足后需要发送 event 的目标地址和数据(某 engine 的某 mailbox)。
- **Gsync info**:向 Global Sync module 的某个 entry 发送 signal。

### 8.4 Tiling Type(§7.9.3)

Tiling 是一组多维 strided / 形变型 OP,仅 CDTE 支持。

#### 8.4.1 Padding(PAD)

在各维度的 head / tail 上将预设的 value pad 到指定长度;除 dim0 以外,还可以在 dim 中间 pad(dim0 不支持 middle pad)。Padding 适用范围覆盖 dim0 / dim1 / dim2 / dim3 四个维度,head / tail / middle 三种位置(dim0 仅 head / tail)。

#### 8.4.2 Reshape(RSHP)

将一个 tensor 的 source 维度按 config mapping 到 destination 的任意维度。例如 NCHW → NHWC 的 mapping 配置:

```
RESHAPE_DIM0_MAP = 2   ; destination dim0 from source dim2 (C)
RESHAPE_DIM1_MAP = 0   ; destination dim1 from source dim0 (W)
RESHAPE_DIM2_MAP = 1   ; destination dim2 from source dim1 (H)
RESHAPE_DIM3_MAP = 3   ; destination dim3 from source dim3 (N)
```

特定 size 下支持 enhanced reshape,以提升带宽:

- 当 source dim0 size 为 4 / 16 / 32(bpe2 only)时,支持 enhanced reshape **read**;
- 当 destination dim0 size 为 4 / 16 / 32(bpe2 only)时,支持 enhanced reshape **write**;
- 针对 dim0 size = 3 时的 transpose(dim0 ↔ dim1),DTE 支持该特定场景的 enhanced reshape。

Reshape 是 ultra OP,仅 ultra-thread 可执行(见 §3.1)。

#### 8.4.3 Broadcasting(BRDCST)

把 size 为 1 的维度扩展到指定 size,形成新的 tensor。例:

```
|7 8 9|  ==> |7 8 9|        |7|  ==> |7 7 7|
              |7 8 9|         |8|       |8 8 8|
              |7 8 9|         |9|       |9 9 9|
```

#### 8.4.4 Slice(SLC)

从一块大的 source tensor 的指定位置开始,切出来一块小 tensor。配置参数包括 src_start_addr 与各维度的 `slice_dimN_start` / `slice_dimN_size` / `SRC_DIMN_SIZE`。

当被切的 tensor 超出 source tensor 的范围时,HW 会对超出的部分做 **auto padding**:

- 默认 padding 在 tail 方向。
- 当配置 `DMA_RPT_SLICE_DIM0_START_DIR = 1` + `DMA_TILE_SLICE_DIM0_START` 时,可以做 head 方向 auto padding(从 0 position 开始)。

#### 8.4.5 De-Slice(DSL)

把一块小的 tensor 填充到另一块大 tensor 的指定位置,是 Slice 的逆操作;配置参数包括 dst_start_addr 与 `dsl_dimN_start` / `DST_DIMN_SIZE`。

类似 slice + auto padding,当 deslice 在 destination tensor 的位置考边、造成有部分在 destination tensor 外面时,HW 会把这部分 **auto strip** 掉。仅支持 tail 方向的 auto strip(与 deslice 其他 combo 操作的限制一致)。

#### 8.4.6 Sub-Sampling(SSMP)

在 source tensor 的 dim1 上下采样产生 destination tensor(取奇数行 / 偶数行等)。

#### 8.4.7 Mirror(HMIR / VMIR)

- **Horizontal Mirror**:在 dim0(水平)方向做镜像。
- **Vertical Mirror**:在 dim1(垂直)方向做镜像。

### 8.5 Combo Type(§7.9.4)

由于 §7 Decoupled Read/Write Pipeline 的设计,DTE 读写控制相对独立——一些只有读控制的 OP 和只有写控制的 OP 可以组合成 combo OP:

| Read process OP | Write process OP | Combo OP |
|-----------------|------------------|----------|
| Slice | Deslice | Slice + Deslice |
| Slice | Padding(any value) | Slice + Padding |
| Slice | Broadcasting | Slice + Broadcasting |
| Slice | Expand | Slice + Expand |
| Shrink | Deslice | Shrink + Deslice |
| Mirror(H / V) | Deslice | Mirror(H / V) + Deslice |
| Mirror(H / V) | Padding | Mirror(H / V) + Padding |
| Constant filling | Deslice | Constant filling + Deslice |

除了上述读写口分开 control 组合产生的 combo OP 之外,还有一些 SW 常用定制的 combo OP:

1. Slice + reshape;
2. Reshape + deslice;
3. slice + auto-padding + reshape;
4. reshape + deslice + auto-strip。

DTE 支持 slice、padding、reshape 三个操作的组合操作:在 slice + reshape 的基础上,在 slice 的时候可以对 tensor 进 auto padding,然后再对切出来的 tensor 进行 reshape——目前仅支持各维度 low / high 方向的 padding,不支持对 interior 做 padding。DTE 也支持 reshape + deslice + auto strip:在 reshape + deslice 的基础上,在 deslice 的时候可对 tensor 进行 auto strip(仅支持 tail 方向,且不能将 source 全部 strip 掉)。

---

## 9. SPMD(§7.11)—— Single Program Multiple Data

CDTE 内多个 thread 并行执行,所有 R/W port 属性完全相同(见 §6)。当下发到 DTE 的 command 数量较少时,为了把 CDTE 的带宽 / thread 资源用满,CDTE 支持把一条 command 拆成多笔小 command,分发到多个 thread 上并行执行——即 SPMD(Single Program Multiple Data)功能。SPMD 仅 CDTE 支持(见 §1.3),ODTE / EDTE 不提供该能力。

下面分别说明三类 split 规则:

### 9.1 Linear Copy Split

对于 Linear Copy command,split 由 user 显式给出 split size,硬件按 split size 不断从 total size 中切出小 task 推送到各 thread:

- HW 每次推送一笔 split task 到 thread,从 total size 中减去 split size,直到 total size 切完。
- 当最后一次配置的 split size 大于剩余 total size 时,最后一次推送的 size 取剩余 size,而不是配置的 split size——也就是说硬件不会越界推送。

### 9.2 Tiling OP Split

对于 Tiling OP,split 次数固定为 source 的 **dim4 size**;每发一次 split task,source address 递增一个 source dim4 pitch、destination address 递增一个 destination dim4 pitch。

也即 Tiling OP 的 SPMD 只在 dim4 维度上展开,各 dim4 切片下发到不同的 thread 并行执行;dim0~dim3 的形状由各 split task 内部独立完成。

### 9.3 Prefetch Task Split

Prefetch command 通过 SPMD 拆成多笔小 task,初始 QoS 低,被 normal task 抢占;若长期未完成或下游开始等待,硬件自动重写 VC QoS 抢回 Physical Channel。"挤出 / 抢回"由 §4 仲裁机制自动完成,**op kernel 不应手工干预 prefetch 优先级**——原因:VC qqos 由硬件按下游依赖动态决定,手工 override 会干扰 prefetch 的延迟摊薄目的。

---

## 10. Cache Hit Ratio Control(§7.16)

Cache hit ratio control 模块位于 mmu 中。DTE thread 发出的 read / write 请求,其 `axuser[26:25]`(allocate priority hint)在 DTE 端固定 tie 为 `2'd3`;经过 mmu 时,由 mmu 根据 cache hit ratio 计算结果 overwrite 对应两位。

含义:DTE 算子开发不需要也无法在 DTE 侧调整 allocate priority hint——DTE 出口固定 tie-off,真正的 priority hint 在 mmu 中按 cache hit ratio 计算后写回。
