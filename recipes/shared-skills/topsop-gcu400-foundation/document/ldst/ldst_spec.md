# LDST 规格(SIP4.0 XPU 访存子系统)

> SKILL 主体已承载的对齐底线 / Memory Specifier / TAR 结构 / VL 编码不在此重复。

## 1. XPU 流水线在访存路径上的分级

| 阶段 | 角色 |
| :-- | :-- |
| S1 | Inst Fetch |
| S2 | Scalar Scheduling |
| S3 | Vector Scheduling(动态调度,管理 latency 与 outstanding) |
| S4 (MALU) | Vector ALU 执行 |

简化抽象:**S1+S2 是向量指令产生器,追求指令吞吐;S3 负责动态调度与 outstanding 管理;S4 执行**。LDST 走到 L1 / L3 的请求路径在 S2 出标量 ALU 后由 S3 落到 S2-LSU 与 S4-VST/VLD 通路上,再经 master / slave 端口出 XPU。

## 2. XPU-to-L1 主端口(Master)

XPU 通过三个 master 端口出 L1:

| 端口 | 带宽 | 方向 | 主要用途 |
| :-- | :-- | :-- | :-- |
| **T0** | 256B/C | R+W | 1D LDST(load + store) |
| **T1** | 256B/C | RO | 2D 计算的 LHS load |
| **T2** | 256B/C | RO | 2D 计算的 RHS load |

T1 / T2 是 Read-Only,理论上可发更多 outstanding;特定算子中,**利用 GEMM 操作 D = A × B,把 A 或 B 矩阵固定为 E 矩阵实现 D = A 或 D = B 的矩阵加载**(D 是扩展精度,E 矩阵放置 L1 重复使用),从而获得更大的 load 能力。典型用法见 Index-Add 优化实现 2(参考 SKILL `gcu400-compute` GEMM 段)。

## 3. L1 Slave 端口

L1 侧三个 slave 端口供 XPU、DSM、CDF、DTE 共享:

| 端口 | 带宽 | 共享方 |
| :-- | :-- | :-- |
| S0 | 128B/C R+W | DSM/CDF;DTE/SIP |
| S1 | 128B/C R+W | DSM/CDF;DTE/SIP |
| S2 | — | 通向 SDMEM |

## 4. 1D Memory Access:Latency 与带宽

### 4.1 Load-to-use latency(参考值)

| 路径 | latency |
| :-- | :-- |
| SR 访问 SDMEM | 8 cycle |
| VA 访问 VDMEM | 31 cycle |
| SR 访问 VDMEM | 51 cycle |
| 访问 SIP 内部寄存器(SCF bus write) | 34 cycle |
| 访问 SIP 内部寄存器(SCF bus read) | 42 cycle |
| 访问 CDTE 寄存器 | 100~136 cycle |

**CF 访问可以连续 128 个写、连续 32 个读**——指 CF NoC 上的 burst 能力,与 SCF read latency 共同决定 CDTE 寄存器频繁配置时的等待行为。

### 4.2 1D 访存带宽

| 路径 | 带宽 |
| :-- | :-- |
| SR 访问 SDMEM | 2×8 B/C |
| VA 访问 VDMEM | 256B Rd + 256B Wr |
| SR 访问 VDMEM | 8 B/C |

### 4.3 Turn-around Latency(1D pipeline stall 估算)

```
Turn-around Latency = L2U + RAW + WAR + Inst Cycle + 多线程竞争 delta
                    = 31 + 13 + 6 + 32 (unroll8 × 2op × 2time) + 竞争 delta
                    = 82 + 竞争 delta
```

如果计算次数很少,本身被 latency 影响较多——这是 1D 算子 unroll 8 的硬件根因(让计算 cycle 把 turn-around 摊掉)。

## 5. Memory Outstanding

### 5.1 配额

- M0 与 M1 由 T0 / T1 / T2 共享。
- T1 / T2 对 Mem 是 RO,理论上能发出更多 outstanding,**总 512**。
- 每个 master port:**1 个 RO 通道 + 1 个 RW 通道**。
- 每个 master port 的读 outstanding:**128 × 3**;每个 master port 的写 outstanding:**128**。
- AXI master 出口侧:M0 / M1 各为 R384 / W128。

### 5.2 L0 → L2/L3 读写

- 每 SIP 有两个对外的标准 AXI master 接口,每个 128B,**共享 128B/C 带宽**。
- 该接口同时用于 L2 与 L3 地址空间。
- SIP 内部对两个 port 的选择采用**地址哈希映射**,期望两 port 使用均匀;同一地址只可能被映射到同一 port,所以每 port 的访问前后顺序可保证。
- SIP 访问 L2/L3 的延迟分为两段:从 L1 接收到请求,到请求出现在 AXI ports 口预期在 8~13 cycle 出 SIP 之后:
  - 预期访问 **L2 大致 150 cycle**
  - 预期访问 **L3 大致 500 cycle**
- SIP 访问 DSM 网络的带宽理想情况(无 DSM 网络内部竞争):
  - 单 SIP,2 个 port 并行读整个 SIC 的 DSM:128 B/C × 2
  - 单 SIP,2 个 port 并行写整个 SIC 的 DSM:128 B/C × 2
  - 单 SIP,2 个 port 并行读 + 写整个 SIC 的 DSM:128 B/C × 4

## 6. Memory Hazard

### 6.1 XPU T0 R/W Hazard(同 sub-thread 内)

- XPU 对单 sub-thread 内的地址 hazard 做保护,**没有关系的读和写可以乱序发出**(互不阻塞)。
- XPU 对**读**是 OOO 发出,对**写**是 in-order 发出。
- 遇到同地址 RAW:XPU 把写发出后再发读,但**不等 write response**,后续由 L1 in-order 处理。
- 一旦遇到读写 hazard,会因为写的 in-order 造成后续链条被阻塞。
- 如果有 GS(Gather/Scatter)请求,XPU 悲观认为总是有 hazard,按 in-order 处理。

### 6.2 L1 T0 R/W Hazard 到 DSM 或 L3

- **RAW / WAR**:等待 response 收回,再发下一个请求。
- **T0 Read Coalesce**:如果有 read 地址 A inflight,重新读地址 A 的第二个 read 不会发到总线上,但会损耗 outstanding——**此处的地址 A 是 128 byte 对齐的地址**。
- **T0 Write Pipeline**:如果有 W0 write 地址 A inflight,后续还有 W1、W2、W3、W4… 都 inflight 且都是地址 A,那么 W1~W4 一开始并不会 pipeline 发出,等到 W0 write resp 回来以后,W1~W4 会 pipeline 发出。

### 6.3 RO 优化

- 64-bit 地址指针的 **bit59 和 bit60 同时为 1 时,表示 RO 属性**。
- 使用该属性后,XPU 和 L1 不再检查读请求地址 hazard,**避免 stall**。
- SKILL 主体已经把"必须确保无真实 hazard"的硬规则写在 RO/WO Hint 段;此处只保留硬件机制描述。

## 7. VLDEOA / VSTEOA 特殊加速

向量按 stride 走 OACC 间接寻址(VLDEOA / VSTEOA)时,硬件按 stride 值做不同处理:

| 情况 | 硬件行为 |
| :-- | :-- |
| Vector stride = 0 load | 转换为广播读操作,一个 QA 只读一次 |
| Vector stride = 1 load | 转换为 linear load |
| Vector stride = 0 store | scatter 访问,多重冲突 |
| Vector stride = 1 store | 转换为 linear store |
| Vector stride > 1 | 转换为 gather/store |

### 7.1 Gather / Scatter 性能

- 无 bank conflict 时 **32 element / cycle**。
- 共 256 bank;**关掉 shifting 的情况下,stride = 1 KB 没有 conflict**。

## 8. T0 128B 不对齐访问

非 128B 对齐的 T0 访问在 XPU-L1 接口上有效率损失。

### 8.1 拆分粒度

- **XPU-L1 Linear 访问的拆分**:以 128B / 64B 为单位。
- **L1-L3 Linear 访问的拆分**:仍能收到 read coalesce 保护,损失部分 outstanding。

### 8.2 影响层级

| 访问目标 | 损失程度 |
| :-- | :-- |
| L1 | 仍有,但不明显 |
| DSM | 居中 |
| L3 | 比 DSM 更大 |

### 8.3 BM 数据(摘点,留作 roofline 校准)

2D store 与 1D store 到 L3 的 BM 对比柱状图给出:

- 2D store to L3 在已经把 2D/1D pipeline 优化到非常好的 case 下,**128B aligned 与 64B aligned 的 L3-L3 Dot 2D 利用率差距集中在 5%~20%**(具体形状从 fp16 到 fp8 不等)。
- 1D store to L3:在多算子(clipped-relu / elu / gelu / relu / mish / swish / softmax / layernorm-nosync-load 等)上 align 64B 相对 align 128B 通常掉到 50%~95%,极端形状(fp32 swish / clipped-relu / elu / gelu / relu)掉到 ~50%。
- 真要比对当前算子的 store 路径效率时,**优先按 SKILL 主体"128B 对齐与性能"段的硬规则评估**;本节数字仅作"非对齐有多痛"的量级参考。

## 9. 访问 L3 的硬件带宽自抑制

为避免 SIP 之间访问 L3 的带宽不均衡,硬件在 L3 路径加了**主动带宽抑制**:

- 针对 L3 的访问,**XPU 每 3 cycle 发一个 256 B/C(读写独立),约等于 85 B/C**;计算式 `4 × 128 / 6 = 85`。
- 同时,它能**自适应 DSM 与 L3 不同的带宽需求**——访问 DSM 时不抑制,访问 L3 时按 85 B/C 抑制。
- **可以用 scratch 把它关掉**;关掉后由调用方自己保证 SIP 间 L3 访问均衡。

V3LD1ST / vadd-unroll16_FP32_size40960 的 BM 数据:`sip6_thread4_VDMEM_L3` 与 `sip6_thread4_L2_L3` 路径下,Total_AVG_RdBW 在 1.3 TB/s ~ 1.5 TB/s 量级,Total_AVG_WrBW 在 444 GB/s ~ 506 GB/s 量级;同 size 的 `VDMEM_VDMEM` 路径 RdBW 与 WrBW 都翻倍——这是 L3 自抑制存在与否的差异参考。

## 10. TVSTOA + CVT 硬件丢写 errata

TVSTOA 带 CVT 语义时存在硬件丢写 errata,与本文 §6 / §8 / §9 都正交。**完整触发组合与硬规则见 SKILL 主体 §"tar_cvt_store 与 internal_tar_cvt_store"**,本节只点名 errata 的存在并指出与 LDST 路径的关系。

简言之:TVSTOA 是 §2 中 T0 端口上的 store 路径;**带 CVT 语义、VL 非 MAX、地址低位 `addr & 0x7F` 与 `2*VL`(src=fp16)/`4*VL`(src=fp32 / int32)落入特定组合时**写数据静默丢失。`tar_cvt_store` intrinsic 通过前后 VL save/restore 到 MAX 来 workaround;`internal_tar_cvt_store` 跳过保护换性能,要求调用方自证 VL 满 / 无 CVT / 地址组合不命中。

具体触发组合不在本文复述——SKILL 主体已是权威态,document 层重复会与 SKILL 漂移。
