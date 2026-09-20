# SIP4.0 流水线信息(Pipeline Info for Compiler)

## 1. 流水线总览

SIP4.0 流水线最多支持 **10 个 sub-thread** 并行;Legacy 模式固定为单 sub-thread 但每条向量指令打两个 VPT。流水线由 4 个调度器(scheduler)组成:**S1 / S2 / S3 / S4(MALU)**,在不同阶段调度各 sub-thread,以充分利用有限的 ALU 资源,并隐藏单个 sub-thread 自身的指令发射 / stall 开销。流水线还含多个内部 cache,支持 sub-thread 间的指令 / 数据复用。

基本特点:
- 每个调度器内部含多个流水级。
- **标量指令** 与 **向量 / 矩阵指令** 在不同调度器、不同流水级解码 + 发射。
- 不同 sub-thread 的标量 / 向量寄存器数据互相隔离;矩阵计算数据可通过 CISC 语义和内部 cache(L0P5)在 sub-thread 间复用。
- 多 sub-thread 模式:最多 10 个 sub-thread,每个 sub-thread 单 VPT 语义。
- Legacy 模式:1 个 sub-thread,该 sub-thread 双 VPT。

---

## 2. Latency 定义

| 名称 | 定义 |
| :-- | :-- |
| **Bubble** | 同一 sub-thread 中前后两条指令之间,因数据依赖 / 结构依赖等原因造成的最少间隔发射拍数。无依赖时 Bubble = 0(可自由发射)。 |
| **RAW Latency** | 流水线上前后指令(基于 SR / TAR / SPR / VACC 等寄存器)存在数据依赖造成的 Bubble + 1。**这是给 Compiler 调度用的参数,不完全反映流水线真实情况**。 |
| **WAW Latency** | 前后指令基于寄存器写后写形成结构依赖造成的 Bubble + 1。同样是 Compiler 调度参数。 |
| **WAR Latency** | 前后指令基于寄存器读后写形成结构依赖造成的 Bubble + 1。同样是 Compiler 调度参数。 |

**注意**:Compiler 看到的 latency 是经过抽象 / 简化的,**通常比硬件实际 latency 略大**——这是设计裕度,确保调度结果正确。

---

## 3. Scalar 指令分类

为说明 Scalar 调度要求和 RAW / WAW / WAR latency 信息,先按微架构对访问 SR 的指令做分类。两个表:
- **SR_table_1** 给出 `SR_Avail_Stage_Index`(结果 SR 可被消费的最早 stage)。
- **SR_table_2** 给出 `SR_Read_Stage_Index`(源 SR 被指令读取的 stage)。

### 3.1 SR_Avail_Stage_Index(SR_table_1)

| Stage | 指令 |
| :-- | :-- |
| **1** | AUIPC、JIL、SETSLICE、SETSLICE_I、ADDIX、SUBIX、ADDI、SUBI、ADD、ADDX、SUB、SUBX、SLL、SLLX、SR、SRX、SLLI、SLLIX、SRI、SRIX、ABS、ABSX、ANDX、ORX、XORX、ANDIX、ORIX、XORIX、ADDI_SFT、ADDIX_SFT、MAX、MAXX、MIN、MINX、TRSI2IX、TRSI2I、BC.LZ、BC.LS、CMOV、JAL、LDI_LO、LDI_HI、LDI16、UEXT、SEXT、MOVTAR2SR.EXT、ADD3、SUB3、AND2、OR2、XOR2、CEQZ、CNEZ、BFI、BFX |
| **2** | SETSLICE_M2V、MUL、MULX |
| **3** | MADD |
| **特例** | MOVS:读 SCC = Stage 1;读非 SCC 的 SPR = Stage 3 |

### 3.2 SR_Read_Stage_Index(SR_table_2)

`SR_table_2` 中所有指令的 `SR_Read_Stage_Index` 均为 **0**(在 decode/issue 阶段读取源 SR)。覆盖范围与 SR_table_1 基本相同,另含 LD / LDX / TLD / TST / DIV / REM / SLT / SLTX / SLTI / SLTIX / SEQX / LDRS 等 LD/ST + 比较类指令。

**关键差异**:`SR_table_1` 描述"能写 SR 的指令"在哪个 stage 拿到结果;`SR_table_2` 描述"会读 SR 的指令"在哪个 stage 拿走源。两表交集决定 SR RAW latency。

---

## 4. TAR 相关指令分类

针对所有访问 TAR 的指令,按 RAW 处理需求分三个表:

### TAR_Table_1(A 类:粗略理解为 TAR-Related VLD)

| 指令 | 读 TAR | 写 TAR |
| :-- | :-- | :-- |
| VLDI_TAR.T0 / VLDI_TAR.T1 / VLDI_TAR.DUAL | N | Y |
| MOVSR2TAR.EXT | N | Y |
| TVLDOA | Y | Y |
| TVLDOA.reg | Y | N |
| TARADD | Y | Y |
| MOVTAR.T0 / MOVTAR.T1 / MOVTAR.DUAL | Y | Y |

### TAR_Table_2(B 类:粗略理解为 TAR-Related VST)

| 指令 | 读 TAR | 写 TAR |
| :-- | :-- | :-- |
| TVSTOA | Y | Y |
| TVSTOA.reg | Y | N |
| TVSTOA_EXT | Y | Y |
| TVSTOA_EXT.reg | Y | N |

### TAR_Table_3(C 类:其他访问 TAR 指令)

| 指令 | 读 TAR | 写 TAR |
| :-- | :-- | :-- |
| TLD | N | Y |
| TST | Y | N |
| MOVTAR2SR.EXT | Y | — |

---

## 5. Vector / Matrix 指令分类(4 个流水通道)

向量 / 矩阵指令分为 4 类,**每一类指令有独立的流水线通道(channel)**——不同类指令可同时发射、不构成结构冲突:

- **VLD**(向量 load):再分为 `VLDA-L0` / `VLDA-L1` / `N/A` 三个 sub-category
- **VST**(向量 store)
- **Comp 1D**(逐元素计算)
- **Comp 2D**(矩阵计算)——GEMM 指令在 MAC 上按 **每 2 行(左支)一条微指令** 的方式展开计算 latency

### 5.1 关键 Category 映射(节选)

完整指令 → category 映射很长,本节列出常用 / 关键映射:

| Category | 指令(节选) |
| :-- | :-- |
| **VLD / VLDA-L0** | VLDI_LO / HI / 64p0~3 (.OA / .VA)、VLDI_MB、MOVSR2MB、MOVR2VA.mode1、MOVVA、MB_PUSH、MB_POP、VSET_MB / VSETI_MB、VLDI_TAR.*、VCLR.OA、MOVOA、MSELECT_64/128/256 |
| **VLD / VLDA-L1** | TVLDOA、TVLDOA.reg、VLDOA、MOVR2VA.mode2 |
| **VLD / N/A** | MOVSFT_VA / MOVSFTC_VA / MOVSFTI_VA、MOP.MSBF / MSIF / MSOF / MIOTA、REMAPVA、MOP.BCAST、VLDEOA、MRADIX_R_BASE、MRADIX_OFFSET、MMERGE 部分变体 |
| **VST / VST** | DCACHE_MTN、DPREFETCH、TVSTOA / .reg、VSTOA、TVSTOA_EXT / .reg、MOVVA2R.mode2、POPC_MB、AGGR_MB、MOP.FIRST_MB、REDV.ADD / REDV.MAX / REDV.MAXNUM、VSTEOA、MRADIX_W_BASE / MRADIX_CNTBASE / MRADIX_STXOA、MLI_VLDXOA / MLI_VLDXI32OA / MLI_VSTXOA / MLI_VSTXI32OA |
| **Comp 1D / 1D-Comp** | MOP.* 大部分元素级指令(POPC、CLZ、CLS、BREV、SIGN、SLROI、SRROI、MAXNUM、MINNUM、ABSMAXNUM、XOR_U32MIX、MUL_HI、WMUL_I64MIX、ADD / SUB / MUL / SQR / SLL / SRA / SRL / ABS / NEG / INV、AND / OR / XOR / MIN / MAX / FUSE / GETE / GETM、ABSMAX、CVT、SLLI / SRLI、MUL_SCL、SRAI、CADD / CSUB / CMUL / CSLL / CSLLI、MERGE、WADD/WMULUS/WMUL_I32MIX、SLRO / SRRO、MSEQ/MSNE/MSLT/MSLE/MSGE/MSGT、MAND/MOR/MXOR/MANDN/MORN/MNAND/MNOR/MXNOR、MUL_F32MIX / F16MIX / I32MIX、ADD_F32MIX / F16MIX / I32MIX、MAC / MAS / IMAS、MAC_F32MIX / MAS_F32MIX / IMAS_F32MIX、MAC_F16MIX / MAS_F16MIX / IMAS_F16MIX、FCLASS、MID、REDMAX、REDMIN、REDSUM、UISA_WMUL_I64MIX)、MLFSR、MCASR |
| **Comp 2D / N/A** | SCHED、SCHED_I、**MSF**、L0P5_INV、MLI_GEMM(走 MLI slot,但在 latency 模型上属 2D-Comp;MOVSR2SPR 标 2D-Comp / VLDA-L0 复合) |

**重要**(R6 闭环关键):MSF 在 Vector/Matrix 分类表里属 **2D-Comp** category;同表内 1D-Comp 的所有 MOP.* 元素级指令是 1D-Comp category——这是 §6.8.2 "MSF / 1D 计算指令吞吐比 1:4"机制的字面源头。

---

## 6. SR Latency 计算规则(§8.2)

### 6.1 SR RAW Latency

| 场景 | SR_RAW_latency |
| :-- | :-- |
| 前 ∈ SR_table_1、后 ∈ SR_table_2、形成 RAW | `= SR_Avail_Stage_Index − SR_Read_Stage_Index`(MOVS 读 SCC: Stage 1;读非 SCC SPR: Stage 3) |
| 前 ∈ SR_table_1、后 **不属** SR_table_2,形成 RAW | **8** |
| 前为 DIV / REM(不属 SR_table_1),与后形成 RAW | **9** |
| 上述均不成立 → 前一定是 Scalar Load / Scalar Atomic / VACCtoSR 之一 | 见下表 |

#### 前为 Scalar Load / Atomic / VACCtoSR 时 SR_RAW_latency

| 前一条指令 | SR_RAW_latency |
| :-- | :-- |
| MOVVA2R.mode2 / FIRST_MB / AGGR_MB / POPC_MB | **大约 40** |
| Scalar Load → SDMEM / Stack Local | **9** |
| Scalar Load → DSM Affinity Local | **约 30~40** |
| Scalar Load → DSM Affinity Remote / DSM Non-Affinity | **约 150~170** |
| Scalar Load → Global | **非常长,约 300+** |
| Atomic(只能访 Global Space) | **约 300+** |

### 6.2 SR WAW Latency

| 场景 | SR_WAW_Latency |
| :-- | :-- |
| 前 ∈ SR_table_1、后 ∈ SR_table_1,形成 WAW | **1** |
| 前 ∈ SR_table_1、后不属 SR_table_1,形成 WAW | **8** |
| 前后均为 DIV / REM,形成 WAW | **1** |
| 前为 DIV / REM、后不属 DIV / REM,形成 WAW | **9** |
| 上述均不成立 → 前一定是 Scalar Load / Atomic / VACCtoSR | 见下 |

#### Scalar Load / Atomic / VACCtoSR 的 WAW

- MOVVA2R.mode2 / FIRST_MB / AGGR_MB / POPC_MB:`SR_WAW_latency = 40`(TBD)
- Scalar Load → SDMEM / Stack Local:`SR_WAW_latency = 9`
- Scalar Load → 其他 memory 空间:很大
- Atomic(只能访 Global Space):很长

### 6.3 SR WAR Latency

`SR_WAR_Latency = 1`(始终)。

---

## 7. TAR Latency 计算规则(§8.3)

### 7.1 TAR RAW

| 场景 | TAR_RAW_Latency |
| :-- | :-- |
| 前 ∈ TAR_Table_1、后 ∈ TAR_Table_1,形成 TAR RAW | **1** |
| 前 ∈ TAR_Table_2、后 ∈ TAR_Table_2,形成 TAR RAW | **1** |
| 上述均不成立、前不是 TLD | **6** |
| 前为 TLD | **依赖访问的 memory latency**(访 DSM / Global / Stack Remote 时很长) |

### 7.2 TAR WAW

| 场景 | TAR_WAW_Latency |
| :-- | :-- |
| 前 ∈ TAR_Table_1、后 ∈ TAR_Table_1,形成 TAR WAW | **1** |
| 前 ∈ TAR_Table_2、后 ∈ TAR_Table_2,形成 TAR WAW | **1** |
| 上述均不成立、前不是 TLD | **6** |
| 前为 TLD | **依赖访问的 memory latency** |

### 7.3 TAR WAR

`TAR_WAR_Latency = 1`(始终)。

---

## 8. SCC Latency(§8.4)

SCC 寄存器分两类:`SCC.Compare` 与 `SCC.Carry`。

| Latency 类别 | 规则 |
| :-- | :-- |
| **SCC.Compare RAW** | = 1 |
| **SCC.Carry RAW** | 前为 MUL、后为 MOVS / CMOV 且形成 SCC.Carry RAW = **2**;其余 = 1 |
| **SCC.* WAW** | 均为 1 |
| **SCC.* WAR** | 均为 1 |

---

## 9. SPR(不含 SCC)Latency(§8.5)

非 SCC 的 SPR 分两类:

### 9.1 SPR_Table_1:写入需要 L0 Fence 才能保证后续读到新值

修改这些 SPR **必须** 在前后插入 **Fence L0** 或 **Fence All** 控制 RAW / WAR / WAW;否则流水线不保证正确性:

| SPR | 是否需 L0 Fence |
| :-- | :-- |
| MODE_WRK、VAB_VPT0、VAB_VPT1、MB_STACK、STACK_REMOTE、STACK_LOCAL、TCTL、ESL_DTYPE、TRAP_RTB | **Y** |

VAB 修改的编程规则参考 SPR Spec。

### 9.2 SPR_Table_2:无需 Fence,RAW / WAW / WAR Latency 始终为 1

| SPR(均不需 L0 Fence) |
| :-- |
| HWT_COUNTER、NACCOVR、VL、LHS_DIM0_REAL、LHS_DIM1_REAL0/1/2、LHS_DIM0_STRIDE、LHS_DIM1_STRIDE、RHS_DIM0_REAL0/1/2、RHS_DIM1_REAL、RHS_DIM0_STRIDE、RHS_DIM1_STRIDE、LDST_DIM0_REAL、LDST_DIM1_REAL、LDST_DIM0_STRIDE、LDST_DIM1_STRIDE、DPF_ASID、IPF_ADDR、IPF_ASID、IPF_KSID、LD_BASE0~7、ESL_ORDER |

---

## 10. Branch / Jump 指令开销(§8.6)

SIP4.0 Branch 指令采用 **静态 Always Taken** 预测;Branch hit 的 Penalty 明显小于 Branch miss。

| 指令类型 | 预测状况 | L0 ICache | Penalty(cycle) |
| :-- | :-- | :-- | :-- |
| 条件跳转 | Prediction Success | Hit | **3** |
| 条件跳转 | Prediction Fail | Hit | **16** |
| 条件跳转 | Prediction Success | Miss | **9** |
| 条件跳转 | Prediction Fail | Miss | **16** |
| 非 JALR 无条件跳转(JL / JIL / JAL) | N/A | Hit | **3** |
| 非 JALR 无条件跳转(JL / JIL / JAL) | N/A | Miss | **16** |
| JALR | N/A | Hit | **16** |
| JALR | N/A | Miss | **16** |

L0 + L1 ICache 都 miss 时 Penalty 可达数百 cycle。**SIP4.0 不再支持 Loop 类指令**。Stall 发生时,S2 调度器可通过其他 sub-thread 提高 ALU 利用率,但单 sub-thread 性能不能提升。

---

## 11. VACC 通用 Latency(§9.2,与 maskbit 无关)

下表 RAW / WAW / WAR 的"通用规则"指 **不包括对 VACC0 读写**(VACC0 作为 maskbit 在 §12 单独处理)。

### 11.1 VACC 通用 RAW

| 场景 | VACC_RAW_Latency |
| :-- | :-- |
| 前一条指令的写**不**来自 VLD 中的 VLDA-L1 | **16** |
| 前一条指令的写**来自** VLD 中的 VLDA-L1 | **依赖访问 memory 的 latency** |
| 前为 Scalar Load → SDMEM / Stack Local | **30**(TBD) |
| 前为 Scalar Load → DSM Affinity Local | 约 **30~40** |
| 前为 Scalar Load → DSM Affinity Remote / Non-Affinity | 约 **150~170** |
| 前为 Scalar Load → Global | 约 **300+** |

### 11.2 VACC 通用 WAW

| 场景 | VACC_WAW_Latency |
| :-- | :-- |
| 前后均为 Comp 1D 指令、形成 WAW | **1** |
| 前为 VLDA-L1 写入 | 依赖访问 memory 的 latency |
| 其余情况 | **16** |

### 11.3 VACC 通用 WAR

| 场景 | VACC_WAR_Latency |
| :-- | :-- |
| 前后均为 Comp 1D 指令、形成 WAR | **1** |
| 其余情况 | **16** |

---

## 12. Maskbit Latency(§9.3,VACC0 专用)

Maskbit 指对 VACC0 寄存器的读写(`vm=0` 隐式读 / 写)。部分 Vector/Matrix 指令对访问 VACC0 有限制(详见 ISA4.0 Spec 中 VACC 间接寻址编码限制),所有 Comp 2D 指令均不能写 VACC0,也不支持 `vm=0`。

### 12.1 Maskbit RAW

| 场景 | maskbit_RAW_latency |
| :-- | :-- |
| 前为 Comp 1D 写 VACC0、后为 Comp 1D 读取 VACC0 | **1** |
| 前为 VLD 中 VLDA-L0 写 VACC0、后为 Comp 1D / VLD / VST 读 VACC0 | **1** |
| 前为 VLD 中 VLDA-L1 写 VACC0、后为 Comp 1D / VLD / VST 读 VACC0 | **依赖访问 memory 的 latency** |
| 前为 VST 中 MLI_VSTXI32OA / MLI_VSTXOA 写 VACC0、后为 Comp 1D / VLD / VST 读 VACC0 | **依赖访问 memory 的 latency** |
| 其余情况 | **16** |

### 12.2 Maskbit WAW

| 场景 | maskbit_WAW_latency |
| :-- | :-- |
| 前后均为 Comp 1D 写 VACC0 | **1** |
| 前为 VLDA-L0 写 VACC0、后为 VLD 或 Comp 1D 写 VACC0 | **1** |
| 前为 VLDA-L1 写 VACC0 | 依赖访问 memory 的 latency |
| 前为 MLI_VSTXI32OA / MLI_VSTXOA 写 VACC0 | 依赖访问 memory 的 latency |
| 其余情况 | **16** |

### 12.3 Maskbit WAR

`maskbit_WAR_latency` 始终 **1**。

---

## 13. Compiler 调度优化要求(§6,精简列出)

§6 给出 9 节调度优化场景。本节按"硬约束 / 强烈推荐 / Compiler 调度参数"分组列出核心规则。

### 13.1 同 sub-thread 同类指令 Hazard(§6.1.1)

- 指令类型按 §5 Vector/Matrix 分类(Category 列)。
- 同类型指令间存在 RAW / WAW / WAR 时必须按 §11 / §12 + ISA Spec 中各类指令的 RAW/WAW/WAR Latency 调度。
- 调度优化包括展开(unroll)latency 的处理方法。
- **特殊 L0 标量资源**(VL、TAR、SPR for 2D)有特殊 forwarding 加速:**标量动态计算生产 + 后续向量计算消费** 这类 pattern 的 latency 比硬件文档中的通用 latency 更小;但 forwarding 不一定加速 **标量生产 + 标量消费** pattern。**Compiler 不要把它们提前调度太早,避免徒增 register spill**——原因:这些资源数量有限,过早调度会让 spill 路径变冗长。

### 13.2 Scalar Load 优化(§6.2.1)

**避免 Scalar Load 访问 VDMEM / DSM / Stack Remote / Global**,因为这些空间 latency 很大(参考 §6.1)。如必要,**优先用 LDRS** 而不是常规 LD / LDX——原因:LDRS 让访问对象的地址 base 空间能更早写入 SPR,硬件能更早解析到地址空间,从而对 Long latency 空间做提前调度。

### 13.3 Branch 优化(§6.3)

- **充分利用硬件 always-taken 预测**——对循环回跳和触发概率高的分支,Compiler 应将该代码地址作为 branch 跳转目标,而非顺序执行目标。
- L1 ICache miss 与 L0 ICache miss 的不同组合会导致不同 penalty,详见 §10。

### 13.4 SDMEM Hazard 优化(§6.4.1)

**避免 Scalar LD/ST 与 Vector LD/ST 同时访问 SDMEM 且地址重叠**——原因:向量指令访问远端存储的指令队列特别深,同 sub-thread 的向量 load + load、store + store 之间又是保序的,所以一旦向量指令访问 SDMEM,标量访问会被硬件 stall 较长时间。栈维护时尤其要注意:压 / 弹栈是常见向量 SDMEM 访问 pattern。

### 13.5 RO / WO Memory 属性(§6.4.2)

- 如果数据块的读写不会重叠,应分配 RO / WO 属性。
- **特别**:Scatter-Gather 指令必须尽可能选择带 RO / WO 属性的 memory——原因:RO / WO 让流水线避开 RAW / WAR 检查,读写之间更容易乱序调度,提高性能。
- Compiler 默认在确定可分配且读写用途不重叠时选择 RO / WO。

### 13.6 Maskbit 优化(§6.5)

- **§6.5.1**:大量 maskbit 写 + 读时,预先产生的 maskbit **不要写回 vacc1~vacc7**,避免后期大量 VLD-L0 指令搬运 maskbit 时产生非预期的 OACC0 RAW——原因:VACC 寄存器的 RAW Hazard 管理是基于 OACC 颗粒度,不避开 VACC1~VACC7 会让流水线检测为非 maskbit 情况下 OACC0 的 RAW。
- **§6.5.2**:非 unroll 时 1D 指令 maskbit RAW latency = 1,Compiler 应据此优化排列。
- **§6.5.3 / §6.5.4**:Unroll 场景下 1D 指令产生 maskbit 给 1D / VLD / VST 消费时,**1D-Comp → VLD / VST 的 maskbit RAW latency = 16**。Compiler 应优化为批量计算 maskbit 写回各 VACC,再用 MOVVA 批量复制到 VACC0,然后执行带 maskbit 条件依赖的 VLD / VST。
- **§6.5.5**:混精运算用 maskbit 时,VLD-L0 → 1D 之间 maskbit RAW latency = 1,这一特点应被利用。

### 13.7 VL 优化(§6.6)

- **VL 控制 Vector 动态长度**——访存时转换为 linear vector load/store。
- **Maskbit 控制 per-lane divergency**——访存时转换为 Scatter-Gather 访问。前者处理效率 / 功耗均优于后者。
- VL 是专用 SPR 寄存器,使用 VL 可避免指令读取 VACC0,减少 Bank Conflict。
- 基于 VL 的动态代码应分为 **MAX 段** 和 **余数段**:第一段把 VL 设为该格式下指令中最大值 max_size 并循环;第二段用于计算小于指令 max_size 的余数(§6.6.2)。
- **两段都需要做展开**——原因:实际 benchmark 验证 MAX 段和余数段都展开后性能更好(§6.6.3)。

### 13.8 L0 Bank Conflict 优化(§6.7)

- **共用数据复制到 4 个连续 OACC**——原因:VACC 寄存器的 bank 管理以 OACC 为单位、共有 **4 个 OACC bank**;index 4 对齐的连续 4 个 OACC 必定属不同 bank,轮流使用可平衡 bank 访问、减少 bank conflict(§6.7.1)。
- **大量以 VACC 为单位的访问应改为以 OACC 间隔调度**——例如把 `{VACC0, VACC1, ..., VACC7, ...}` 改为 `{VACC0, VACC8, VACC16, VACC24, VACC1, VACC9, VACC17, ...}`,即 VACC index 转 OACC 视角后判断 OACC 视角是否均衡(§6.7.2)。原因:VACC RAW Hazard 管理以 OACC 为单位,连续 VACC 访问其实意味着连续 8 个周期访问同一 OACC(同一 bank)。

### 13.9 指令并行调度(§6.8)

- **VLD / VST / 1D 计算 / MSF 可并行**——SIP4.0 流水线中四类指令拥有各自独立的 ALU 和指令调度通道 / 保留站,可相对独立调度;通过多 sub-thread 间不同指令并行,或一个 sub-thread 内不同指令槽并行实现(§6.8.1)。
- **MSF 与 1D 计算并行吞吐率适配 1:4**——原因:Libra SIP4.0 中,**一条 MSF 指令和一条 1D-Comp 指令的表达运算量相同;但实际 MSF ALU 算力是指令的 1/4**,而绝大部分 1D 计算 ALU 算力与指令表达算力相匹配(§6.8.2)。这是 SKILL 主体"SFU 算力 = 1D-Comp 算力 / 4"叙述的字面权威源。

### 13.10 循环优化(§6.9)

- **Compiler 接受用户指定 Unroll 数值**——用户不指定时单线程默认 Unroll = **16**(§6.9.1)。常见 1D 计算算子 unroll 16 是较优值。
- **跨循环 WAR 优化**——为避免第一次循环末尾到第二次循环开始时使用相同 L0 寄存器导致的 WAR,需:
  - 增大 unroll size 和循环体尺寸,使循环末尾到循环开头的 OACC 寄存器间隔够远;新算子下默认 16-unroll + 4-sub-thread 可满足该条件。
  - 将 VLD / 1D-Comp / VST 展开为 2 重 ~ 3 重循环。
- **由于 SIP4.0 不支持没有 hazard 的指令跨通道乱序发射,SIP4.0 中跨通道指令发射顺序已和静态编译的顺序完全一致**(§6.9.2)。判断是否存在 WAR hazard 阻塞第二循环 VLD 指令发射时,需保证第二循环第一条 VLD 和第一循环第一条 VLD 间的指令包个数 > **LOAD 指令访问 L1 解除计算指令 RAW hazard 的时间(今天推荐按 64 计)** + **计算结束解除 VST 指令 RAW hazard 的时间(今天推荐按 16 计)**。

---

## 14. Legacy Sub-Thread 指引(§7)

SIP4.0 上 Legacy 算子固定为 1 个 sub-thread,Vector 指令包含 2 个 VPT。与新算子的同构多线程编程基本路线存在区别。

- **指令打包优化** 应继续使用,以提高指令槽指令发射效率(§7.1.1)——经 benchmark 确认,采用指令打包可在 Legacy 算子单线程下尽量提升指令槽发射效率。

---
