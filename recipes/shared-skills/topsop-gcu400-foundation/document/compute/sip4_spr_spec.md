# Libra SIP4.0 SPR(算子开发视角)

本文档只保留算子开发会接触的字段,debug / trap / supervisor only 的寄存器在尾部"非算子开发关注"段集中点名。

---

## 1. SPR 总体特点(ISA4.0)

- SPR (Special Purpose Register)是 ISA 指令立即数编码可直接访问的寄存器,与 load/store 指令访问的 CSR 寄存器在地址空间上**不同**。
- ISA4.0 中,SPR 地址空间共 256 个 SPR 寄存器编码;**部分地址未定义具体寄存器,读返回全 0,写操作视为 NOP**。
- SPR 位宽 64 bit,部分 SPR 有效位域只有 32 bit,对这些寄存器高 32 bit 始终为 0;**字段有效位域以本文档每条 SPR 的 Bit 列为准**。
- 编程视角下,SPR 是每个软件线程(sub-thread)各自独立的;部分 SPR 由于 SIP Arch 设计约束,在物理层面上可被同一硬件线程上的软件线程共享(详见 §6 List 中 Sharing 列)。

---

## 2. 术语

| 名称 | 含义 |
| :-- | :-- |
| SPR | Special Purpose Register |
| SW-CTX | 即软件线程(software thread / sub-thread)。每个 SW-CTX 有独立 PC 和上下文 |
| HW-CTX | 即硬件线程(hardware thread)。每个 HW-CTX 有独立的取指和访存单元,可以执行一个或多个 SW-CTX |
| Per-SIP / Per-Sub-Thread / Per-Kernel-Slot | SPR 的共享层级,见每条 SPR 的 Sharing 列 |

---

## 3. 算子开发视角的 SPR 分类

### 3.1 Kernel launch 元信息(只读,启动时由硬件填好)

- **SIP_ID**(SPR 0,Per-SIP):高 4 bit 是 SIC ID,低 4 bit 是 Harvest 之后的 SIP logic ID。
- **THD_SLOT_IDX**(SPR 2,Per-Sub-Thread):4 bit。指示当前 sub-thread 占用当前硬件线程的第几个调度资源槽;Libra SIP 中一个硬件线程支持 16 个软件线程调度资源。
- **PROCESS_ID_WRK**(SPR 3,Per-Kernel-Slot):16 bit。当前 sub-thread 对应的进程号。
- **PACKAGE_ID_WRK**(SPR 4,Per-Kernel-Slot):32 bit。Package ID,用于 Event Trace。
- **SUB_THD_ID_WRK**(SPR 5,Per-Sub-Thread):32 bit。Kernel launch 时由软件给一组 sub-thread 一个初始 sub_thread_id,每多发射一个 sub-thread 数值加 1。
- **ASID_WRK**(SPR 6,Per-Kernel-Slot):4 bit。线程发射时配置的 ASID,用于取指和 UVA 空间访问的页表查找。
- **KSID_WRK**(SPR 7,Per-Kernel-Slot):6 bit。线程发射时配置的 KSID,用于取指和 ICache invalid 操作。
- **LAUNCH_WRK**(SPR 8,Per-Kernel-Slot):
  - `THREAD_OACC` [25:16] — 本线程所需的单个 VPT 上的 OACC 数量,范围 0~768,要求 4 对齐。
  - `SUB_THREAD_NUM` [15:12] — 本次 Kernel 发射要展开的 sub-thread 数;实际数值为 `SUB_THREAD_NUM + 1`。
  - `THREAD_TYPE` [9:8] — 是否为 Scorpio 兼容算子线程(具体见 SIP Arch Spec)。
  - `INVALID_ICACHE` [0:0] — launch 时是否根据本次 KSID 对 ICache 进行 invalid。
- **MINFO**(SPR 13,Per-SIP):
  - `VDMEM_SIZE` [27:16] — VDMEM 大小,单位 1 KB(reset value 0x400 = 1024 KB,实际容量以当前 SoC 为准)。
  - `SDMEM_SIZE` [7:0] — SDMEM 大小,单位 1 KB(reset value 0x80 = 128 KB)。
- **PARAM_WRK**(SPR 12,Per-Kernel-Slot):
  - `PARAM_ADDR` [26:16] — Parameter 起始地址,SDMEM(物理地址)= `PARAM_ADDR * 128B`,Param Buffer(虚拟地址)= `0x1_4000_0000 + PARAM_ADDR * 128B`,有效范围 0..0x3FF。
  - `PARAM_SIZE` [10:0] — Parameter buffer 大小 = `PARAM_SIZE * 128B`,有效范围 0..0x400;`PARAM_SIZE == 0` 表示无 Param Buffer。约束:`PARAM_ADDR + PARAM_SIZE` 不得超过 0x400。

### 3.2 Stack 配置(算子写栈分析时直接相关)

- **STACK_LOCAL**(SPR 28,Per-Sub-Thread):
  - `LOCAL_V_BASE` [26:16] — 有效范围 0x0..0x400。
    - `LOCAL_V_BASE == 0x400`:本 sub-thread 没有 STACK_LOCAL,只有 STACK_REMOTE。
    - `LOCAL_V_BASE` 在 `0..0x3FF` 时:
      - 起始虚拟地址 PA:`VA_start = 0x1_50FE_0000 + 0x10_0000 * thread_slot_id + LOCAL_V_BASE * 128`
      - 折算:起始 = 5 GB + `16 MB * thread_slot_id` + `(272 MB - 128 KB)` + `128 B * LOCAL_V_BASE`。
      - 结束虚拟地址 PA:`VA_end = 0x1_5000_0000 + 0x10_0000 * (thread_slot_id + 1) - 1B`,即 5 GB + `16 MB * thread_slot_id` + `272 MB - 1B`。
  - `LOCAL_P_BASE` [10:0] — 有效范围 0x0..0x400。
    - Stack Local 在 SDMEM 上的起始物理地址:`PHY_ST_ADDR = LOCAL_P_BASE * 128B`。
    - Stack Local 在 SDMEM 上的结束物理地址:`PHY_END_ADDR = (LOCAL_P_BASE - LOCAL_V_BASE) * 128B + 128 KB - 1B`。
    - 约束:`LOCAL_P_BASE` 不大于 `LOCAL_V_BASE`,否则虚拟地址空间无法完全映射到 SDMEM 上。
  - 该字段同时决定 stack local / stack remote 分界,以及 stack local 大小。
- **STACK_REMOTE**(SPR 29,Per-Sub-Thread):
  - `STACK_SIZE` [52:48] — 当前 stack 区域有多少 MB 被映射到 UVA 中(最高的一部分可能被 STACK_LOCAL 覆盖)。
    - 有效范围 0..16;0 表示当前 STACK_REMOTE 无效;16 时只有 15.5 MB 被映射(最低 0.5 MB 被屏蔽);其他情况下映射范围 = `STACK_SIZE * 1 MB`。
    - UVA 上映射区间为 `STACK_REMOTE_BASE + (16 - STACK_SIZE) * 1 MB ~ STACK_REMOTE_BASE + 16 MB - 1 B`。
    - VA 映射区间为 `5.25 GB + THD_SLOT_ID * 16 MB + (16 - STACK_SIZE) * 1 MB ~ 5.25 GB + THD_SLOT_ID * 16 MB + 16 MB - 1 B`。
  - `STACK_REMOTE_BASE` [47:0] — 记录当前软件线程 stack 映射到 UVA 上的地址,要求 1 MB 对齐;对于 stack buffer 的 `(THD_SLOT_IDX) * 16 MB ~ (THD_SLOT_IDX + 1) * 16 MB - 1 B` 的地址,会被映射到本地址开始的 16 MB 上,但最高部分地址会被 STACK_LOCAL 二次映射到 SDMEM 中,最低 0.5 MB 会被屏蔽无法访问。

> 算子要点:`StackSize` 接近 10 KB 时实际很可能已经从 SDMEM 上的 STACK_LOCAL 跨入 STACK_REMOTE(L3 上),性能从 8 cycle / 访存恶化到 300+ cycle / 访存。这就是 gcu400-compute-scalar SKILL 中"栈 ≤ 10 KB"约束的硬件来源。

### 3.3 标量寻址 base(LDRS 指令)

- **LD_BASE0..LD_BASE7**(SPR 32..39,Per-Sub-Thread):各 64 bit。`ADDR_BASE*` for LDRS instruction;**高 16 bit 是给 HW & SW 用的 hint**(等价于地址空间高位 hint,如 §3.6 中 `bit59:60 = 11` 的 RO/WO hint)。

### 3.4 计算结果寄存器分区(VAB)

- **VAB_VPT0**(SPR 20,Per-Sub-Thread):`BASE_IDX` [12:0],非兼容模式下所有指令槽和兼容模式下 VPT0 的 VACC index 在物理 VACC 寄存器堆上的起始位置;**[4:0] bits 由硬件强制 mask 为 0**(即 VAB 划分粒度是 32 个 VACC = 4 个 OACC)。
- **VAB_VPT1**(SPR 21,Per-Sub-Thread):`BASE_IDX` [12:0],兼容模式下 VPT1 的 VACC index 在物理 VACC 寄存器堆上的起始位置。**`MOVSR2SPR` 不能在 `LAUNCH_WRK.THREAD_TYPE == 0/1` 的情况下写本寄存器,否则 pipeline 可能 hang。**

> 算子要点:VAB 切换前必须 flush VA0 Cache(无 cache coherence)。`maxnreg` 必须 4 对齐(4 OACC = 32 VACC = 1 VAB 粒度)的硬件根因即在 `BASE_IDX [4:0] = 0`。

### 3.5 累加 override(GEMM / MAC 链)

- **NACCOVR**(SPR 26,Per-Sub-Thread):
  - `MOP_VMAC_NACC` [0:0] — 1 表示禁用 MOP.MAC 系列指令的累加;0 表示沿用指令编码。
  - `GEMM_NACC` [1:1] — 1 表示禁用 MLI_GEMM 系列指令的累加;0 表示沿用指令编码。

> 算子要点:首次 GEMM 设置 NACCOVR 让累加器清零,后续迭代恢复累加,可以消掉循环内分支判断,把 S2 标量带宽留给 GEMM 指令本身。

### 3.6 1D 指令形状(VL / VTYPE)

- **VL**(SPR 70,Per-Sub-Thread):`VL` 字段 9:0 bit,**有效位宽 10 bit**(非 32 bit),reset value 0x200 = 512。指定 VACC / DACC / QACC / OACC vector 中实际更新的元素个数。
- **VTYPE**(SPR 71,Per-Sub-Thread):`VTA` [6:6] = 1 (RO),Vector Tail Agnostic;ISA4.0 中只有这一个域并且固定为 1。

> 算子要点:VL 硬件取低 10 bit。给 1024 时实际是 0,所有元素被跳过;负数按二进制补码截断为意外值。这是 VL 编码上限 1023 的硬件根因;实际生效宽度还受当前向量类型 datalane 上限制约,超出部分按 tail 处理。

### 3.7 GEMM 矩阵形状描述(LHS / RHS / LDST)

| SPR | SPR ID | Bit | 含义 |
| :-- | :-- | :-- | :-- |
| LHS_DIM0_REAL | 72 | DIM0_REAL_SIZE [7:0],reset 0x80 | MLI_GEMM 左操作数水平方向(K)实际元素个数,有效范围 0~128 |
| LHS_DIM1_REAL0 | 73 | DIM1_REAL_SIZE0 [8:0],reset 0x0 | 左操作数垂直方向(M)开始 zero padding 元素数,有效范围 0~256 |
| LHS_DIM1_REAL1 | 74 | DIM1_REAL_SIZE1 [8:0],reset 0x100 | 左操作数垂直方向"开始 zero padding 起包括但不含结尾 zero padding"的实际元素数 |
| LHS_DIM1_REAL2 | 75 | DIM1_REAL_SIZE2 [8:0],reset 0x100 | 左操作数垂直方向包含所有 zero padding 在内的实际元素数 |
| LHS_DIM0_STRIDE | 76 | DIM0_STRIDE [0:0],RO,固定为 1 | 左操作数水平方向相邻两元素在 memory 中的间隔 |
| LHS_DIM1_STRIDE | 77 | DIM1_STRIDE [31:0] | 左操作数垂直方向相邻两元素在 memory 中的间隔,单位元素 |
| RHS_DIM0_REAL0 | 78 | DIM0_REAL_SIZE0 [7:0],reset 0x0 | 右操作数水平方向(N)开头 zero padding 个数 |
| RHS_DIM0_REAL1 | 79 | DIM0_REAL_SIZE1 [7:0],reset 0x80 | 右操作数水平方向"开始 zero padding 但不含结尾 zero padding"的实际元素数 |
| RHS_DIM0_REAL2 | 80 | DIM0_REAL_SIZE_WTP [7:0],reset 0x80 | 右操作数水平方向包含所有 zero padding 的实际元素数 |
| RHS_DIM1_REAL | 81 | DIM1_REAL_SIZE [7:0],reset 0x80 | 右操作数垂直方向(K)实际元素数;**别名为 LHS_DIM0_REAL**,二者同步更新;有效范围 0~128 |
| RHS_DIM0_STRIDE | 82 | DIM0_STRIDE [31:0] | 右操作数水平方向相邻两元素在 memory 中的间隔,单位元素 |
| RHS_DIM1_STRIDE | 83 | DIM1_STRIDE [31:0] | 右操作数垂直方向相邻两元素在 memory 中的间隔,单位元素 |
| LDST_DIM0_REAL | 84 | DIM0_REAL_SIZE [9:0],reset 0x80 | MLI_MLD / MLI_MST 系列指令操作数水平方向实际元素数 |
| LDST_DIM1_REAL | 85 | DIM1_REAL_SIZE [8:0],reset 0x100 | MLI_MLD / MLI_MST 系列指令操作数垂直方向实际元素数,有效范围 0..0x100 |
| LDST_DIM0_STRIDE | 86 | DIM0_STRIDE [31:0] | MLI_MLD / MLI_MST 操作数水平方向相邻两元素在 memory 中的间隔,单位元素 |
| LDST_DIM1_STRIDE | 87 | DIM1_STRIDE [31:0] | MLI_MLD / MLI_MST 操作数垂直方向相邻两元素在 memory 中的间隔,单位元素 |

> 算子要点:
> - `LHS_DIM0_STRIDE` 在 V3 上始终是 1 且 RO,硬件忽略软件写入;`set_spr<LHS_DIM0_STRIDE>(1)` 是冗余指令,白占 SALU slot 发射带宽。
> - `RHS_DIM1_REAL` 与 `LHS_DIM0_REAL` 是别名(二者表达同一个 K 维度),修改其中一个时另一个数值会同步更新。
> - `LHS_DIM1_REAL0/1/2` 三件套用于"开始 padding 行数 / 不含结尾 padding 的有效行数 / 含全部 padding 的总行数",支持 GEMM 同时处理首尾 padding。

### 3.8 浮点行为

- **MODE_WRK**(SPR 9,Per-Sub-Thread,RW):是 MODE_CFG 的 shadow register,ISA4.0 进行调整。
  - `BF16_OVCLP` [18:18]、`INT_OVCLP` [17:17]、`FP16_OVCLP` [16:16] — 各 dtype 的 overflow clip 行为(详见 MODE_CFG)。
  - `FP_DENORM` [15:8],reset 0xff;按 2 bit 一组配置,顺序 [9:8] for FP16 / [11:10] for FP32 / [13:12] for BF16:
    - 0x0 — non-denormal flush;
    - 0x1 — output denormal flush;
    - 0x2 — input denormal flush;
    - 0x3 — input & output denormal flush。
  - `FP_ROUND` [7:0],reset 0x0;按 2 bit 一组配置,顺序 [1:0] for FP16 / [3:2] for FP32 / [5:4] for BF16:
    - 0x0 — round to nearest even (RNE);
    - 0x1 — round to zero (RNZ);
    - 0x2 / 0x3 — reserved。

> 算子要点:把 FP_DENORM 设成 0x3 (input & output denormal flush) 是大多数 LLM kernel 的默认选择,避免 denormal stall。

### 3.9 Trap base / launch base

- **TRPBA_WRK**(SPR 10,Per-Kernel-Slot,RO):32 bit,Trap Base Address config register for trap handler。
- **LCHBA_WRK**(SPR 11,Per-Kernel-Slot,RO):32 bit,Kernel Launch Base Address config register。低 4 bit 必须为 0(SIP 一次取 16 byte 指令)。

### 3.10 Mailbox stack 与 mailbox 状态

- **MB_STACK**(SPR 27,Per-Sub-Thread):`MB_STACK` [9:0],配合 `MB_PUSH` / `MB_POP` 指令;低 10 bit 记录作为 maskbit stack 的 VACC 寄存器,数值是相对当前 VAB 配置的偏移。
- **MBOX_EXTRA_STS**(SPR 14,Per-SIP,RO):`MBOX_EXTRA_STS` [31:0],bit 0..bit 31 分别代表 General mailbox 96..127 的状态,用于支持 virtual mailbox 128..143 的功能。

### 3.11 PC / barrier / counter

- **PC**(SPR 16,Per-Sub-Thread,RO):30 bit Program Counter(以 byte 为单位),应用执行轨迹,但可能与硬件 pipeline 级不完全精确。
- **BARRIER**(SPR 17,Per-SIP,RO):`VAL` [31:0] 始终读 0;当软件用 `MOVS` 读 BARRIER SPR 时,**该读会保证后续指令只在所有先前 memory access 指令都完成、所有 response 收到、且没有 exception 发生后才执行**。这是一种粗粒度 fence。
- **HWT_COUNTER**(SPR 18,Per-SIP,RW):`COUNTER` [63:0],硬件线程计数器,提供 `HAL_clock()` 功能。SIP reset 时清零;整个 SIP 为 halt 状态时保持上次计数结果不变;只要任意一个软件线程不为 halt,计数器每个周期加 1,且不受 clock gating 影响;对该寄存器的任意写都会触发一次清零(建议只由 Supervisor 写)。
- **SCC**(SPR 19,Per-Sub-Thread,RW):2-bit Scalar Condition Code;`Carry` [1:1]、`Compare` [0:0]。

### 3.12 异常状态(算子开发用得不多,但 dmesg 关键字会落到这里)

- **HW_STS**(SPR 48,Per-Sub-Thread):
  - `BRKP_HIT` [21:20] (W1C) — 进入 debug mode 或 breakpoint trap handler 时由硬件置 1。
  - `WAIT_ID` [15:8] (RO) — 当前 wait 的 mailbox ID。
  - `WAIT_GSYNC` [5:5] (RO) — 是否在等 GSYNC mailbox。
  - `DBG_MODE` [4:4] (RO) — 0 = Normal,1 = Debug。
  - `PLC_FSM` [3:0] (RO) — SIP pipeline 状态:0 = HALT,1 = RUN/BUSY,2 = Wait,其他 reserved。
  - **本寄存器不能被 `MOVSR2SPR` 写,否则 pipeline 可能 hang。**
- **EXCP_PC**(SPR 49,Per-Sub-Thread,RO):异常发生且 trap 被触发时捕获 exception PC,32 bit。LSB write AXI bus parity error 与 Write (CF) response error 的 EXCP_PC 是 imprecise PC。
- **EXCP_BIT_EN**(SPR 50,Per-Sub-Thread,RO,reset 0x1073f3ff):每个 exception event 的 enable bit;某 bit 为 1 且 EXCP_STS 同位为 1 时,程序跳到 exception handler。可能的 exception 列表:
  - [0] EXCP_IMEM_RAS_ERR
  - [1] EXCP_VDMEM_RAS_ERR
  - [2] EXCP_SDMEM_RAS_ERR
  - [3] EXCP_VARAM_RAS_ERR (即 dmesg `VARAM PARITY` 关键字)
  - [4] EXCP_SRTAR_RAS_ERR
  - [5] EXCP_IVSMR_RAS_ERR
  - [6] EXCP_S3INST_RAS_ERR
  - [7] EXCP_L1CTRL_RAS_ERR
  - [8] EXCP_L1DATA_RAS_ERR
  - [9] EXCP_CF_RAS_ERR
  - [10] EXCP_DF_RAS_ERR
  - [12] EXCP_ILL_IS
  - [14] EXCP_ADDR_INVALID
  - [15] EXCP_CF_RESP_ERR
  - [16] EXCP_DF_RESP_ERR
  - [20] EXCP_ICACHE_DF_RAS_ERR
  - [21] EXCP_ICACHE_DF_RESP_ERR
  - [22] EXCP_ICACHE_MISS_VICTIM_ERR
  - 其他 reserved。
- **EXCP_STS**(SPR 51,Per-Sub-Thread,RO):异常发生且当前不在 trap handler 时按 bit 置 1;一旦置 1 直到软件清除前一直为 1。各 bit 含义同 EXCP_BIT_EN。
- **EXCP_STS_TH**(SPR 53,Per-Sub-Thread,RO):trap handler 进程中触发的异常按 bit 置 1。各 bit 含义同 EXCP_BIT_EN。

### 3.13 TCTL(基本不用动)

- **TCTL**(SPR 64,Per-Sub-Thread):
  - `SEL_TID` [0:0] (RO) — Reserved。
  - `T0_DIS` [16:16] (RW) — 1 时 thread 0 disabled,所有 vector thread 0 的指令视为 NOP(包括 src 是 thread 0 的 `MOVS.VCC`);**根据 FCR,软件不允许将本字段更新为非 0**。
  - `T1_DIS` [17:17] (RW) — 同上,适用于 thread 1。
- 整体 SPR **不可写**。

---

## 4. 完整 SPR 清单(算子开发关注子集)

以下表格按 SPR ID 升序排列,只列算子开发会接触的 SPR;省略的 31 个 `MD0_WRK..MD31_WRK`(SPR 96..127,均为 MD*_CFG 的 shadow register,Per-Kernel-Slot)由 supervisor / driver 配置,kernel 不直接修改。

| SPR ID | Name | 位宽 | Sharing | 用途 |
| :-- | :-- | :-- | :-- | :-- |
| 0 | SIP_ID | 8 | Per-SIP | SIC ID + SIP logic ID |
| 2 | THD_SLOT_IDX | 4 | Per-Sub-Thread | 当前 sub-thread 占用的硬件调度资源槽编号 |
| 3 | PROCESS_ID_WRK | 16 | Per-Kernel-Slot | 进程号 |
| 4 | PACKAGE_ID_WRK | 32 | Per-Kernel-Slot | Package ID |
| 5 | SUB_THD_ID_WRK | 32 | Per-Sub-Thread | sub-thread id |
| 6 | ASID_WRK | 4 | Per-Kernel-Slot | ASID(取指 / UVA) |
| 7 | KSID_WRK | 6 | Per-Kernel-Slot | KSID(取指 / ICache invalid) |
| 8 | LAUNCH_WRK | 26 | Per-Kernel-Slot | OACC 数 / sub-thread 数 / thread type / icache invalid |
| 9 | MODE_WRK | 19 | Per-Sub-Thread | OVCLP / DENORM / ROUND mode |
| 10 | TRPBA_WRK | 32 | Per-Kernel-Slot | Trap base address |
| 11 | LCHBA_WRK | 32 | Per-Kernel-Slot | Kernel launch base address |
| 12 | PARAM_WRK | 27 | Per-Kernel-Slot | Param buffer 起点 / 大小 |
| 13 | MINFO | 28 | Per-SIP | VDMEM / SDMEM 容量 |
| 14 | MBOX_EXTRA_STS | 32 | Per-SIP | mailbox 96..127 状态 |
| 16 | PC | 30 | Per-Sub-Thread | Program Counter |
| 17 | BARRIER | 0 | Per-SIP | 读触发轻 fence |
| 18 | HWT_COUNTER | 64 | Per-SIP | HAL_clock counter |
| 19 | SCC | 2 | Per-Sub-Thread | Scalar Condition Code |
| 20 | VAB_VPT0 | 13 | Per-Sub-Thread | VAB base for VPT0 |
| 21 | VAB_VPT1 | 13 | Per-Sub-Thread | VAB base for VPT1(兼容模式) |
| 26 | NACCOVR | 2 | Per-Sub-Thread | MAC / GEMM accumulate override |
| 27 | MB_STACK | 10 | Per-Sub-Thread | MB_PUSH / MB_POP 用 |
| 28 | STACK_LOCAL | 27 | Per-Sub-Thread | Stack local base / range |
| 29 | STACK_REMOTE | 53 | Per-Sub-Thread | Stack remote base / size |
| 32~39 | LD_BASE0..LD_BASE7 | 64 | Per-Sub-Thread | LDRS 标量访问 base + 高位 hint |
| 48 | HW_STS | 22 | Per-Sub-Thread | breakpoint / wait / debug / pipeline 状态 |
| 49 | EXCP_PC | 32 | Per-Sub-Thread | exception PC capture |
| 50 | EXCP_BIT_EN | 32 | Per-Sub-Thread | per-exception trap enable |
| 51 | EXCP_STS | 32 | Per-Sub-Thread | exception status(非 trap handler) |
| 53 | EXCP_STS_TH | 32 | Per-Sub-Thread | exception status(trap handler 内) |
| 64 | TCTL | 18 | Per-Sub-Thread | thread 0/1 disable(只读) |
| 70 | VL | 10 | Per-Sub-Thread | 1D 元素长度 |
| 71 | VTYPE | 7 | Per-Sub-Thread | VTA flag |
| 72 | LHS_DIM0_REAL | 8 | Per-Sub-Thread | LHS K 维实际元素数 |
| 73 | LHS_DIM1_REAL0 | 9 | Per-Sub-Thread | LHS M 维 padding 起点 |
| 74 | LHS_DIM1_REAL1 | 9 | Per-Sub-Thread | LHS M 维 padding 至有效尾 |
| 75 | LHS_DIM1_REAL2 | 9 | Per-Sub-Thread | LHS M 维含全部 padding 尾 |
| 76 | LHS_DIM0_STRIDE | 1 | Per-Sub-Thread | LHS DIM0 stride 固定 1(RO) |
| 77 | LHS_DIM1_STRIDE | 32 | Per-Sub-Thread | LHS DIM1 stride |
| 78 | RHS_DIM0_REAL0 | 8 | Per-Sub-Thread | RHS N 维 padding 起点 |
| 79 | RHS_DIM0_REAL1 | 8 | Per-Sub-Thread | RHS N 维实际元素数 |
| 80 | RHS_DIM0_REAL2 | 8 | Per-Sub-Thread | RHS N 维含 padding 尾 |
| 81 | RHS_DIM1_REAL | 8 | Per-Sub-Thread | RHS K 维实际元素数(LHS_DIM0_REAL 别名) |
| 82 | RHS_DIM0_STRIDE | 32 | Per-Sub-Thread | RHS DIM0 stride |
| 83 | RHS_DIM1_STRIDE | 32 | Per-Sub-Thread | RHS DIM1 stride |
| 84 | LDST_DIM0_REAL | 10 | Per-Sub-Thread | MLI_MLD / MLI_MST DIM0 元素数 |
| 85 | LDST_DIM1_REAL | 9 | Per-Sub-Thread | MLI_MLD / MLI_MST DIM1 元素数 |
| 86 | LDST_DIM0_STRIDE | 32 | Per-Sub-Thread | MLI_MLD / MLI_MST DIM0 stride |
| 87 | LDST_DIM1_STRIDE | 32 | Per-Sub-Thread | MLI_MLD / MLI_MST DIM1 stride |

---

## 5. 非算子开发关注的 SPR(集中点名)

下列 SPR 出现在 spec 但算子开发基本不直接读写,知道存在即可:

- **MD0_WRK..MD31_WRK**(SPR 96..127,Per-Kernel-Slot,RO):是 MD0_CFG..MD31_CFG 的 shadow register,32 bit。由 driver / supervisor 在 kernel slot 配置时写入 CSR,kernel 端只能读 shadow,不能写。
- **ESL_DTYPE**(SPR 160,Per-Sub-Thread):指定非 AMO 指令时 awusr 域上数据类型,用于通信路径,不在普通算子范围。
- **ESL_ORDER**(SPR 161,Per-Sub-Thread):标量 ST 指令访问 EDF 时设置 awusr 中的 ESL_ORDER 域,用于通信路径。
- **DPF_ASID**(SPR 193,Per-Sub-Thread):DPF(数据预取)所对应的 ASID;线程启动初始化为 THREAD_ASID,通过修改可进行跨进程数据预取。
- **IPF_ADDR**(SPR 194,Per-Sub-Thread):IDMA / ITAGOP 指令的 IMEM_BASE,起始地址要求 cacheline 对齐,48 bit。
- **IPF_ASID**(SPR 195,Per-Sub-Thread):IPF 所对应的 ASID;用于 IDMA / ITAGOP 指令。
- **IPF_KSID**(SPR 196,Per-Sub-Thread):IPF 所对应的 KSID;用于 IDMA / ITAGOP 指令。
- 其他未列出的 SPR 编码:Reserved,读返回全 0,写视为 NOP。

---

## 6. 算子开发常用 SPR 设置组合(派生)

下列组合不是 spec 原文,而是 spec 字段定义直接推出的常用写法,放在这里方便算子开发查找。

### GEMM 一次完整设置

```cpp
// LHS / RHS 形状(K = K_real, M = M_real, N = N_real)
set_spr<LHS_DIM0_REAL>(K_real);          // 同步更新 RHS_DIM1_REAL
set_spr<LHS_DIM1_REAL0>(0);              // 起始 padding 行数,一般 0
set_spr<LHS_DIM1_REAL1>(M_real);         // 实际有效行
set_spr<LHS_DIM1_REAL2>(M_padded);       // 含 padding 的总行
set_spr<LHS_DIM1_STRIDE>(M_stride_in_elem);

set_spr<RHS_DIM0_REAL0>(0);
set_spr<RHS_DIM0_REAL1>(N_real);
set_spr<RHS_DIM0_REAL2>(N_padded);
set_spr<RHS_DIM0_STRIDE>(N_stride_in_elem);
set_spr<RHS_DIM1_STRIDE>(K_stride_in_elem);

// 累加控制(覆盖 / 累加 切换)
set_spr<NACCOVR>(0b10);  // bit1=GEMM_NACC: 1 = 禁用累加,首次清零
// ... 第一次 GEMM ...
set_spr<NACCOVR>(0b00);  // 后续按指令编码累加
```

### 1D 元素数

```cpp
set_spr<VL>(n);  // n 为编码值,硬件取低 10 bit;实际生效宽度还受 datalane 上限限制。等价于 tcle::set_vl(n)
```

### 浮点行为

```cpp
// FP32 input & output denormal flush + RNE
set_spr<MODE_WRK>(/* FP_DENORM[FP32] = 0x3 << 10 */ (0x3 << 10) | /* FP_ROUND[FP32] = 0 */ 0);
```

---

## 7. 与本仓库其他文档的关系

- `document/general_compute_1d.md` 与 `document/primo_gemm.md` 已经在算子开发抽象层引用 SPR 名;本文是这些 SPR 的硬件原始定义,出现矛盾时**以本文为准并修复 idiom 文档**。
- ISA4.0 指令编码对应见 `document/isa4_instruction_ref.md`。
