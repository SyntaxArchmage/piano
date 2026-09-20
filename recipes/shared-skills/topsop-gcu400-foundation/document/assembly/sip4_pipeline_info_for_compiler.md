> Imported material source: `Doc/SIP4.0 Pipleline Info for Compiler.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `SIP4.0 Pipeline Info for Compiler`.

# SIP4.0 Pipeline Info for Compiler

## 1. Revision History

| Version | Date | Note |
|---|---|---|
| v0.1 | 2025/07/02 | 初始版本 |

## 2. Open Item

## 3. Glossary

| Name | Description |
|---|---|
| Bubble | 在同一个线程中前后两个指令之间，由于数据依赖/结构依赖等原因造成前后发射的最少间隔发射。<br>如果前后两个指令之间不存在任何依赖，在流水线上可以自由发射，则定义 Bubble = 0 |
| RAW Latency | 在流水线上，由于前后指令（基于 SR/TAR/SPR/VACC 等寄存器）存在数据依赖而造成的 Bubble + 1。<br>RAW Latency = RAW bubble + 1。<br>注意这是一个用于 Compiler 调度参数，并不完全反应流水线上真实情况。 |
| WAW Latency | 在流水线上，由于前后指令基于寄存器写后写而造成结构依赖的 Bubble + 1。<br>WAW Latency = WAW bubble + 1。<br>注意这是一个用于 Compiler 调度参数，并不完全反应流水线上真实情况。 |
| WAR Latency | 在流水线上，由于前后指令基于寄存器读后写而造成结构依赖的 Bubble + 1。<br>WAR Latency = WAR bubble + 1。<br>注意这是一个用于 Compiler 调度参数，并不完全反应流水线上真实情况。 |

## 4. Scope

本文档用于从架构视角抽象和归纳 SIP4.0 主流水线中指令执行时特性，提供 Compiler 对于 SIP4.0 指令的调度用参数，以及调度优化建议。

本文档包括以下内容：

- 流水线特性简介
- SIP4.0 中对于 Compiler 调度优化场景的要求
- 介绍标量类指令的参数
- 介绍向量和阵类指令的参数

## 5. Introduce Pipeline
SIP4.0的流水线支持最多10个软件线程(sub-thread)的并行工作。它包含4个不同的调度器(scheduler， 下面简称S1，S2，S3和S4/MALU)，用于在不同阶段调度各个软件线程充分使用有限的ALU资源，隐藏各个线程自身的指令发射开销/stall开销。此外，它当中还包含多个内部cache资源，支持线程之间的指令/ 数据复用。

基本特点

- SIP4.0包含多个调度器，每个调度器中包含多个流水级。

- 标量指令和向量/矩阵指令的译码和发射在不同调度器不同流水级中发生

- 不同软件线程之间的标量/向量寄存器数据互相隔离。但是矩阵计算的数据通过CISC语义以及内部 cache可以进行一定程度复用。

- 流水线支持新的多线程模式（最多10个sub-thread，每个sub-thread均为单VPT语义），或者单线程的Legacy模式（只有1个sub-thread，该sub-thread为双VPT语义）

本文档中，对于compiler的指令调度信息，主要集中在单线程视角下。但是对于一些使用同构多线程展开的算子，本文档也会给出多线程展开的一些建议

### 5.1. Scalar指令分类说明
#### 5.1.1. SR相关指令分类
为了描述Scalar调度要求和RAW/WAW/WAR latency信息，首先需要给Scalar指令进行基于微架构的分类。对于访问SR的指令，可以做如下分类

SR_table_1:

|**指令名称**|**SR_Avail_Stage_Index**|
|---|---|
|AUIPC|1|
|JIL|1|
|SETSLICE|1|
|SETSLICE_I|1|
|SETSLICE_M2V|2|
|ADDIX|1|
|SUBIX|1|
|MADD|3|
|ADDI|1|
|SUBI|1|
|ADD|1|
|ADDX|1|
|SUB|1|
|SUBX|1|
|MUL|2|
|MULX|2|
|SLL|1|
|SLLX|1|
|SR|1|
|SRX|1|
|SLLI|1|
|SLLIX|1|
|SRI|1|
|SRIX|1|
|ABS|1|
|ABSX|1|
|ANDX|1|
|ORX|1|
|XORX|1|
|ANDIX|1|
|ORIX|1|
|XORIX|1|
|ADDI_SFT|1|
|ADDIX_SFT|1|
|MAX|1|
|MAXX|1|
|MIN|1|
|MINX|1|
|TRSI2IX|1|
|TRSI2I|1|
|BC.LZ|1|
|BC.LS|1|
|CMOV|1|
|JAL|1|
|LDI_LO|1|
|LDI_HI|1|
|LDI16|1|
|UEXT|1|
|SEXT|1|
|MOVS|读SCC: 1<br>读非SCC的SPR: 3|
|MOVTAR2SR.EXT|1|
|ADD3|1|
|SUB3|1|
|AND2|1|
|OR2|1|
|XOR2|1|
|CEQZ|1|
|CNEZ|1|
|BFI|1|
|BFX|1|


SR_table_2:

|**指令名称**|**SR_Read_Stage_Index**|
|---|---|
|SETSLICE|0|
|SETSLICE_M2V|0|
|ADDIX|0|
|SUBIX|0|
|MADD|0|
|TLD|0|
|TST|0|
|LDX|0|
|ADDI|0|
|SUBI|0|
|ADD|0|
|ADDX|0|
|SUB|0|
|SUBX|0|
|MUL|0|
|MULX|0|
|SLL|0|
|SLLX|0|
|SR|0|
|SRX|0|
|SLLI|0|
|SLLIX|0|
|SRI|0|
|SRIX|0|
|ABS|0|
|ABSX|0|
|ANDX|0|
|ORX|0|
|XORX|0|
|ANDIX|0|
|ORIX|0|
|XORIX|0|
|DIV|0|
|REM|0|
|SLT|0|
|SLTX|0|
|SLTI|0|
|SLTIX|0|
|SEQX|0|
|ADDI_SFT|0|
|ADDIX_SFT|0|
|MAX|0|
|MAXX|0|
|MIN|0|
|MINX|0|
|TRSI2IX|0|
|TRSI2I|0|
|BC.LZ|0|
|BC.LS|0|
|CMOV|0|
|JALR|0|
|LDI_LO|0|
|LDI_HI|0|
|LD|0|
|ST|0|
|UEXT|0|
|SEXT|0|
|ADD3|0|
|SUB3|0|
|AND2|0|
|OR2|0|
|XOR2|0|
|CEQZ|0|
|CNEZ|0|
|BFI|0|
|BFX|0|
|LDRS|0|


#### 5.1.2. TAR相关指令分类
对于所有访问TAR的指令，处理RAW RAW，将指令分为下面的三个表格

TAR_Table_1:

|**A类指令（粗略理解为TAR-Related VLD类）**|**是否读TAR？**|**是否写TAR？**|
|---|---|---|
|VLDI_TAR.T0|N|Y|
|VLDI_TAR.T1|N|Y|
|VLDI_TAR.DUAL|N|Y|
|MOVSR2TAR.EXT|N|Y|
|TVLDOA|Y|Y|
|TVLDOA.reg|Y|N|
|TARADD|Y|Y|
|MOVTAR.T0|Y|Y|
|MOVTAR.T1|Y|Y|
|MOVTAR.DUAL|Y|Y|


TAR_Table_2:

|**B类指令（粗略理解为TAR-Related VST类）**|**是否读TAR？**|**是否写TAR？**|
|---|---|---|
|TVSTOA|Y|Y|
|TVSTOA.reg|Y|N|
|TVSTOA_EXT|Y|Y|
|TVSTOA_EXT.reg|Y|N|


TAR_Table_3:

|**C类指令（其他访问TAR指令）**|**是否读TAR？**|**是否写TAR？**|
|---|---|---|
|TLD|N|Y|
|TST|Y|N|
|MOVTAR2SR.EXT|Y|-|


### 5.2. Vector/Matrix指令分类说明
为了说明Vector/Matrix类指令的调度要求和RAW/WAW/WAR latency信息，首先基于流水线特性介绍这类指令的分类。在流水线中，向量/矩阵指令分为以下4类。每一类指令有独立的流水线通道（channel）

VLD

进一步分类为VLDA-L0/VLDA-L1/NA

VST

Comp 1D

Comp 2D

对于GEMM指令，需要考虑该指令会按照每2行(左支)一条微指令的方式，来计算微指令和其他指令的latency

|**Vector/Matrix Instruction Name**|**Category**|**Sub Category**|
|---|---|---|
|VLDI_LO.OA|VLD|VLDA-L0|
|VLDI_HI.OA|VLD|VLDA-L0|
|VLDI_64p0.OA|VLD|VLDA-L0|
|VLDI_64p1.OA|VLD|VLDA-L0|
|VLDI_64p2.OA|VLD|VLDA-L0|
|VLDI_64p3.OA|VLD|VLDA-L0|
|VLDI_LO.VA|VLD|VLDA-L0|
|VLDI_HI.VA|VLD|VLDA-L0|
|DCACHE_MTN|VST|VST|
|DPREFETCH|VST|VST|
|TVLDOA|VLD|VLDA-L1|
|TVLDOA.reg|VLD|VLDA-L1|
|MOVR2VA.mode1|VLD|VLDA-L0|
|MOVVA|VLD|VLDA-L0|
|VLDOA|VLD|VLDA-L1|
|MOVR2VA.mode2|VLD|VLDA-L0|
|MOVVA2R.mode2|VST|VST|
|POPC_MB|VST|VST|
|AGGR_MB|VST|VST|
|SCHED|2D-Comp|N/A|
|SCHED_I|2D-Comp|N/A|
|REDV.ADD|VST|VST|
|REDV.MAX|VST|VST|
|REDV.MAXNUM|VST|VST|
|TVSTOA|VST|VST|
|TVSTOA.reg|VST|VST|
|VSTOA|VST|VST|
|MB_PUSH|VLD|VLDA-L0|
|MB_POP|VLD|VLDA-L0|
|MOVSFT_VA|VLD|N/A|
|MOVSFTC_VA|VLD|N/A|
|MOVSFTI_VA|VLD|N/A|
|MOP.POPC|1D-Comp|1D-Comp|
|MOP.CLZ|1D-Comp|1D-Comp|
|MOP.CLS|1D-Comp|1D-Comp|
|MOP.BREV|1D-Comp|1D-Comp|
|MOP.SIGN|1D-Comp|1D-Comp|
|MOP.SLROI|1D-Comp|1D-Comp|
|MOP.SRROI|1D-Comp|1D-Comp|
|MOP.MAXNUM|1D-Comp|1D-Comp|
|MOP.MINNUM|1D-Comp|1D-Comp|
|MOP.ABSMAXNUM|1D-Comp|1D-Comp|
|MOP.FIRST_MB|VST|VST|
|MOP.MSBF|VLD|N/A|
|MOP.MSIF|VLD|N/A|
|MOP.MSOF|VLD|N/A|
|MOP.MIOTA|VLD|N/A|
|MOP.XOR_U32MIX|1D-Comp|1D-Comp|
|MOP.MUL_HI|1D-Comp|1D-Comp|
|MOP.WMUL_I64MIX|1D-Comp|1D-Comp|
|MLFSR|1D-Comp|1D-Comp|
|MCASR|1D-Comp|1D-Comp|
|MOP.ADD|1D-Comp|1D-Comp|
|MOP.SUB|1D-Comp|1D-Comp|
|MOP.MUL|1D-Comp|1D-Comp|
|MOP.SQR|1D-Comp|N/A|
|MOP.SLL|1D-Comp|1D-Comp|
|MOP.SRA|1D-Comp|1D-Comp|
|MOP.SRL|1D-Comp|1D-Comp|
|MOP.ABS|1D-Comp|1D-Comp|
|MOP.NEG|1D-Comp|1D-Comp|
|MOP.INV|1D-Comp|1D-Comp|
|MOP.AND|1D-Comp|1D-Comp|
|MOP.OR|1D-Comp|1D-Comp|
|MOP.XOR|1D-Comp|1D-Comp|
|MOP.MIN|1D-Comp|1D-Comp|
|MOP.MAX|1D-Comp|1D-Comp|
|MOP.FUSE|1D-Comp|1D-Comp|
|MOP.GETE|1D-Comp|1D-Comp|
|MOP.GETM|1D-Comp|1D-Comp|
|MOP.ABSMAX|1D-Comp|1D-Comp|
|MOP.CVT|1D-Comp|1D-Comp|
|MOP.SLLI|1D-Comp|1D-Comp|
|MOP.SRLI|1D-Comp|1D-Comp|
|MOP.SRAI|1D-Comp|1D-Comp|
|MOP.CADD|1D-Comp|1D-Comp|
|MOP.CSUB|1D-Comp|1D-Comp|
|MOP.CMUL|1D-Comp|1D-Comp|
|MOP.CSLL|1D-Comp|1D-Comp|
|MOP.CSLLI|1D-Comp|1D-Comp|
|VLDI_MB|VLD|VLDA-L0|
|MOVSR2MB|VLD|VLDA-L0|
|MID|1D-Comp|1D-Comp|
|MSF|2D-Comp|2D-Comp|
|VSET_MB|VLD|VLDA-L0|
|VSETI_MB|VLD|VLDA-L0|
|MOP.MERGE|1D-Comp|1D-Comp|
|MOP.WADD_I32MIX|1D-Comp|1D-Comp|
|MOP.WMULUS_I32MIX|1D-Comp|1D-Comp|
|MOP.WMUL_I32MIX|1D-Comp|1D-Comp|
|MOP.SLRO|1D-Comp|1D-Comp|
|MOP.SRRO|1D-Comp|1D-Comp|
|MOP.MUL_SCL|1D-Comp|1D-Comp|
|MOP.MSEQ|1D-Comp|1D-Comp|
|MOP.MSNE|1D-Comp|1D-Comp|
|MOP.MSLT|1D-Comp|1D-Comp|
|MOP.MSLE|1D-Comp|1D-Comp|
|MOP.MSGE|1D-Comp|1D-Comp|
|MOP.MSGT|1D-Comp|1D-Comp|
|MOP.MAND|1D-Comp|1D-Comp|
|MOP.MOR|1D-Comp|1D-Comp|
|MOP.MXOR|1D-Comp|1D-Comp|
|MOP.MANDN|1D-Comp|1D-Comp|
|MOP.MORN|1D-Comp|1D-Comp|
|MOP.MNAND|1D-Comp|1D-Comp|
|MOP.MNOR|1D-Comp|1D-Comp|
|MOP.MXNOR|1D-Comp|1D-Comp|
|MOVOA|VLD|VLDA-L0|
|REMAPVA|VLD|N/A|
|MOP.MUL_F32MIX|1D-Comp|1D-Comp|
|MOP.MUL_F16MIX|1D-Comp|1D-Comp|
|MOP.MUL_I32MIX|1D-Comp|1D-Comp|
|MOP.ADD_F32MIX|1D-Comp|1D-Comp|
|MOP.ADD_F16MIX|1D-Comp|1D-Comp|
|MOP.ADD_I32MIX|1D-Comp|1D-Comp|
|MOP.MAC|1D-Comp|1D-Comp|
|MOP.MAS|1D-Comp|1D-Comp|
|MOP.IMAS|1D-Comp|1D-Comp|
|MOP.MAC_F32MIX|1D-Comp|1D-Comp|
|MOP.MAS_F32MIX|1D-Comp|1D-Comp|
|MOP.IMAS_F32MIX|1D-Comp|1D-Comp|
|MOP.MAC_F16MIX|1D-Comp|1D-Comp|
|MOP.MAS_F16MIX|1D-Comp|1D-Comp|
|MOP.IMAS_F16MIX|1D-Comp|1D-Comp|
|MOP.FCLASS|1D-Comp|1D-Comp|
|VLDEOA|VLD|N/A|
|VSTEOA|VST|VST|
|MLI_GEMM|2D-Comp|N/A|
|MLI_VLDXOA|VST|N/A|
|MLI_VSTXOA|VST|VST|
|MLI_VLDXI32OA|VST|N/A|
|MLI_VSTXI32OA|VST|VST|
|MOVSR2SPR|2D-Comp|VLDA-L0|
|REDMAX|1D-Comp|1D-Comp|
|REDMIN|1D-Comp|1D-Comp|
|REDSUM|1D-Comp|1D-Comp|
|UISA_WMUL_I64MIX|1D-Comp|1D-Comp|
|TVSTOA_EXT|VST|N/A|
|TVSTOA_EXT.reg|VST|N/A|
|VCLR.OA|VLD|VLDA-L0|
|MRADIX_W_BASE|VST|VST|
|MRADIX_R_BASE|VLD|N/A|
|MRADIX_CNTBASE|VST|N/A|
|MRADIX_OFFSET|VST|N/A|
|MRADIX_STXOA|VST|N/A|
|MMERGE|VLD|1D-Comp|
|MSELECT_256|VLD|VLDA-L0|
|MSELECT_128|VLD|VLDA-L0|
|MSELECT_64|VLD|VLDA-L0|
|MOP.BCAST|VLD|N/A|
|L0P5_INV|2D-Comp|N/A|


### 5.3. 其他流水线特性说明
**TBD：补充下面信息：**

- S2-S3 2D/1D串行调度优化信息

- Self-stall调度信息

- HWC特性

- 在4.0上WAIT指令的并行性

## 6. Guideline for New Sub-Thread on SIP4.0
本章节主要描述各种Compiler对于指令调度的优化要求和场景。这其中会覆盖对于RAW/WAW/WAR latency的处理。但SIP4.0所具有的流水线特性区别于以往SIP1.0/SIP2.0/SIP3.0，需要遵照下面的建议对指令流调度进行优化。

**Note：**这里的Guideline主要是给Compiler使用的

### 6.1. 常规Hazard优化要求
#### 6.1.1. 同一软件线程同类型指令Hazard处理Latency
**规则说明：**

这里的指令类型，指的是Vector/Matrix指令分类说明章节中表格Category列的指令分类

- 对于同一软件线程下同指令类型的 Hazard 处理，需要依照 Vector & Matrix Instruction 章节中的 RAW/WAW/WAR Latency 进行调度。
- 调度优化包括展开 latency 的处理方法。

**场景/原因说明：**
对于通用的L0资源

- 存在RAW/WAR/WAW需要进行优化。此种优化，要遵循硬件指令的执行延迟信息。这些信息详细描述在 Scalar Instruction 和Vector & Matrix Instruction 章节中。

**注意：** 本文中的硬件延迟信息经过抽象和简化，一般比硬件实际 latency 稍大。

- 对于向量计算使用的特殊L0标量资源

   - 设计原则中，对于计算中一些常见的特殊寄存器会做特殊加速，包含TAR、VL、2D指令相关的 SPR等等。对于这些寄存器一般的对于它的常见计算生产和消费pattern有特殊forwarding加速，使得它们的latency可以维持得很小。

   - 这些加速场景一般的pattern是标量生产+向量消费

      - 标量动态计算生产这些特殊L0资源的动态最新值

      - 后续的向量计算使用这些动态最新值

   - 这些加速场景并不一定加速了标量生产+标量消费pattern

编译器在调度中，需要注意到它的特殊短latency forwarding加速，避免为了它提前更早的调度，增加register spill的可能性

### 6.2. Scalar指令优化
#### 6.2.1. 尽可能避免Scalar Load指令访问VDMEM/DSM/Stack Remote/Global
**规则说明：**
- 尽可能避免这些Scalar Load指令访问VDMEM/DSM/Stack Remote/Global空间

- 如果有必要，尽量选用LDRS，而非常规的LD/LDX访问VDMEM/DSM/Stack Remote/Global

**场景/原因说明：**
- SIP可以访问 SDMEM （latency小）、DSM亲和（latency大）、DSM非亲和（latency更大）、 Global/Stack Remote (最大)

- 如果有对这些地址的读操作，并且后续指令和读操作有较多的串行依赖，那么后续操作会被阻塞非常长的时间。

- 硬件为了避免单个线程阻塞其他线程过长时间，又不过分悲观的处理对近存SDMEM的访问，需要能够区分load访问的对象，但是load访问的地址在SR中，在调度的早期无法获得它的地址空间精确值

- LDRS指令让访问对象的地址base空间能够更早的被写入SPR中，从而让硬件能够更早的解析到地址空间，从而可以做针对性的调度

- 编程语言前端，需要提供LDRS的语法支持或者接口，让用户能利用它向硬件传递动态的地址空间信息，并且编译器调度时，需要理解这些指令大概率会访问long latency空间，在调度时要尽量早调度这些指令

### 6.3. Branch优化建议
#### 6.3.1. 充分利用硬件branch预测always taken的策略
**规则说明：**
- 对于用于循环，以及触发概率较高的分支，Compiler应当将该代码的地址作为分支预测指令 (branch)的跳转对象，而非branch顺序执行对象

**场景说明：**

示例 1：循环回跳预测。

```cpp
# 假设下面是一段循环代码
movsr2spr(Set_L_TCTL, 131072, Set_H_TCTL);
movsr2tar_ext(tar_src1_base, src1addr, 1, 0);
movsr2tar_ext(tar_store_base, dstaddr, 1, 0);
movsr2tar_ext(tar_ls_offset0, OACC_BYTE_WIDTH, 1, 0);
setslice(SR0, 128, Set_H_VL, SLICENUM, Set_L_VL);

for (int i = size; i >= UNROLL_TIMES * OACC_ELEM_DATALANE;
     i = i - UNROLL_TIMES * OACC_ELEM_DATALANE) {
  tvldoa(oaccs1[0], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs1[1], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs1[2], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs1[3], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs1[4], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs1[5], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs1[6], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs1[7], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);

  msf(oaccd[0], MSF_GELU, oaccs1[0], FP, UnMasked, DWidth32);
  msf(oaccd[1], MSF_GELU, oaccs1[1], FP, UnMasked, DWidth32);
  msf(oaccd[2], MSF_GELU, oaccs1[2], FP, UnMasked, DWidth32);
  msf(oaccd[3], MSF_GELU, oaccs1[3], FP, UnMasked, DWidth32);
  msf(oaccd[4], MSF_GELU, oaccs1[4], FP, UnMasked, DWidth32);
  msf(oaccd[5], MSF_GELU, oaccs1[5], FP, UnMasked, DWidth32);
  msf(oaccd[6], MSF_GELU, oaccs1[6], FP, UnMasked, DWidth32);
  msf(oaccd[7], MSF_GELU, oaccs1[7], FP, UnMasked, DWidth32);

  tvstoa(oaccd[0], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);
  tvstoa(oaccd[1], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);
  tvstoa(oaccd[2], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);
  tvstoa(oaccd[3], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);
  tvstoa(oaccd[4], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);
  tvstoa(oaccd[5], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);
  tvstoa(oaccd[6], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);
  tvstoa(oaccd[7], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);
}
halt();
return;
```

对应的汇编伪代码示例如下：

```asm
e0:  00 00 00 00 00 00 00 00 00 00 33 19 41 00 01 00    sext    x4, x3
f0:  00 00 00 00 00 00 00 00 00 00 2f 28 20 01 01 00    ldi16   x5, 1024
100: 00 00 00 00 00 00 00 00 00 00 4f 27 85 c0 01 00    blt     x4, x5, 464
110: 00 00 00 00 00 00 00 00 00 00 ef 27 3f 01 01 00    ldi16   x4, 2047
120: 00 00 00 00 00 00 00 00 00 00 65 19 86 05 01 00    and     x5, x3, x6
130: 00 00 00 00 00 00 00 00 00 00 cb 18 00 2c 01 00    addi    x3, x3, -1024
140: 00 00 00 00 00 00 00 00 00 00 b7 07 60 30 01 00    tvldoa  30, 0, 3, 2, 1
150: 00 00 00 00 00 00 00 00 00 00 f7 07 60 30 01 00    tvldoa  31, 0, 3, 2, 1
160: 00 00 00 00 00 00 00 00 00 00 37 08 60 30 01 00    tvldoa  32, 0, 3, 2, 1
170: 00 00 00 00 00 00 00 00 00 00 77 08 60 30 01 00    tvldoa  33, 0, 3, 2, 1
180: 00 00 00 00 00 00 00 00 00 00 b7 08 60 30 01 00    tvldoa  34, 0, 3, 2, 1
190: 00 00 00 00 00 00 00 00 00 00 f7 08 60 30 01 00    tvldoa  35, 0, 3, 2, 1
1a0: 00 00 00 00 00 00 00 00 00 00 37 09 60 30 01 00    tvldoa  36, 0, 3, 2, 1
1b0: 00 00 00 00 00 00 00 00 00 00 77 09 60 30 01 00    tvldoa  37, 0, 3, 2, 1
1c0: 00 00 00 00 90 02 04 78 80 6a 00 00 00 00 01 00    msf     10, 4, 30, 2, 1, 2
1d0: 00 00 00 00 d0 02 04 7c 80 6a 00 00 00 00 01 00    msf     11, 4, 31, 2, 1, 2
1e0: 00 00 00 00 10 03 04 80 80 6a 00 00 00 00 01 00    msf     12, 4, 32, 2, 1, 2
1f0: 00 00 00 00 50 03 04 84 80 6a 00 00 00 00 01 00    msf     13, 4, 33, 2, 1, 2
200: 00 00 00 00 90 03 04 88 80 6a 00 00 00 00 01 00    msf     14, 4, 34, 2, 1, 2
210: 00 00 00 00 d0 03 04 8c 80 6a 00 00 00 00 01 00    msf     15, 4, 35, 2, 1, 2
220: 00 00 00 00 10 04 04 90 80 6a 00 00 00 00 01 00    msf     16, 4, 36, 2, 1, 2
230: 00 00 00 00 50 04 04 94 80 6a 00 00 00 00 01 00    msf     17, 4, 37, 2, 1, 2
240: b8 02 62 30 00 00 00 00 00 00 00 00 00 00 01 00    tvstoa  10, 2, 3, 2, 1
250: f8 02 62 30 00 00 00 00 00 00 00 00 00 00 01 00    tvstoa  11, 2, 3, 2, 1
260: 38 03 62 30 00 00 00 00 00 00 00 00 00 00 01 00    tvstoa  12, 2, 3, 2, 1
270: 78 03 62 30 00 00 00 00 00 00 00 00 00 00 01 00    tvstoa  13, 2, 3, 2, 1
280: b8 03 62 30 00 00 00 00 00 00 00 00 00 00 01 00    tvstoa  14, 2, 3, 2, 1
290: f8 03 62 30 00 00 00 00 00 00 00 00 00 00 01 00    tvstoa  15, 2, 3, 2, 1
2a0: 38 04 62 30 00 00 00 00 00 00 00 00 00 00 01 00    tvstoa  16, 2, 3, 2, 1
2b0: 78 04 62 30 00 00 00 00 00 00 00 00 00 00 01 00    tvstoa  17, 2, 3, 2, 1
2c0: 00 00 00 00 00 00 00 00 00 00 8f 21 65 ff 01 00    bltu    x4, x5, -416
2d0: 00 00 00 00 00 00 00 00 00 00 2d 00 00 01 01 00    halt
2e0: 00 00 00 00 00 00 00 00 00 00 6b 08 00 01 01 00    jmp     x1
```

其中，硬件采取简单预测 `ceiling`，会预测跳转一定发生，所以：

- 在 `PC=0x2C0` 时，循环回跳每次都预测发生，用以降低预测正确时的跳转开销。
- 循环的最后一次，预测会错误。此时多线程会相互覆盖最后一次预测错误的开销。
- 这些预测发生在 `JI/JIL/B.unsigned/BX.unsigned/JAL` 上，不会发生在 `JALR` 上；`JALR` 的跳转地址目前没有预测。
- 在上述代码的 `PC=0x100` 时，也有一次跳转。它逻辑上判断循环是否一次也不用执行，并需要跳转到 `PC=0x2d0` 直接 `halt`。
- 硬件预测 `always jump` 会引入一次预测错误，如果等硬件自己发现预测错误再跳回来，会引入更多开销。
- 编译器可以将进入循环的逻辑替换为 2 条指令：1 条条件判断跳转指令跳入循环，后接 1 条无条件跳转指令跳到 `HALT`。

优化后的汇编伪代码示例如下：

```asm
d0:  00 00 00 00 00 00 00 00 00 00 33 19 41 00 01 00    sext    x4, x3
e0:  00 00 00 00 00 00 00 00 00 00 2f 28 20 01 01 00    ldi16   x5, 1024
f0:  00 00 00 00 00 00 00 00 00 00 4f 27 85 c0 01 00    bge     x4, x5, 32    // enter the loop using branch
100: 00 00 00 00 00 00 00 00 00 00 4f 27 85 c0 01 00    jil     464           // jump to halt
110: 00 00 00 00 00 00 00 00 00 00 ef 27 3f 01 01 00    ldi16   x4, 2047
120: 00 00 00 00 00 00 00 00 00 00 65 19 86 05 01 00    and     x5, x3, x6
130: 00 00 00 00 00 00 00 00 00 00 cb 18 00 2c 01 00    addi    x3, x3, -1024
140: 00 00 00 00 00 00 00 00 00 00 b7 07 60 30 01 00    tvldoa  30, 0, 3, 2, 1
150: 00 00 00 00 00 00 00 00 00 00 f7 07 60 30 01 00    tvldoa  31, 0, 3, 2, 1
160: 00 00 00 00 00 00 00 00 00 00 37 08 60 30 01 00    tvldoa  32, 0, 3, 2, 1
170: 00 00 00 00 00 00 00 00 00 00 77 08 60 30 01 00    tvldoa  33, 0, 3, 2, 1
180: 00 00 00 00 00 00 00 00 00 00 b7 08 60 30 01 00    tvldoa  34, 0, 3, 2, 1
190: 00 00 00 00 00 00 00 00 00 00 f7 08 60 30 01 00    tvldoa  35, 0, 3, 2, 1
1a0: 00 00 00 00 00 00 00 00 00 00 37 09 60 30 01 00    tvldoa  36, 0, 3, 2, 1
1b0: 00 00 00 00 00 00 00 00 00 00 77 09 60 30 01 00    tvldoa  37, 0, 3, 2, 1
1c0: 00 00 00 00 90 02 04 78 80 6a 00 00 00 00 01 00    msf     10, 4, 30, 2, 1, 2
1d0: 00 00 00 00 d0 02 04 7c 80 6a 00 00 00 00 01 00    msf     11, 4, 31, 2, 1, 2
1e0: 00 00 00 00 10 03 04 80 80 6a 00 00 00 00 01 00    msf     12, 4, 32, 2, 1, 2
1f0: 00 00 00 00 50 03 04 84 80 6a 00 00 00 00 01 00    msf     13, 4, 33, 2, 1, 2
200: 00 00 00 00 90 03 04 88 80 6a 00 00 00 00 01 00    msf     14, 4, 34, 2, 1, 2
210: 00 00 00 00 d0 03 04 8c 80 6a 00 00 00 00 01 00    msf     15, 4, 35, 2, 1, 2
220: 00 00 00 00 10 04 04 90 80 6a 00 00 00 00 01 00    msf     16, 4, 36, 2, 1, 2
230: 00 00 00 00 50 04 04 94 80 6a 00 00 00 00 01 00    msf     17, 4, 37, 2, 1, 2
240: b8 02 62 30 00 00 00 00 00 00 00 00 00 00 01 00    tvstoa  10, 2, 3, 2, 1
250: f8 02 62 30 00 00 00 00 00 00 00 00 00 00 01 00    tvstoa  11, 2, 3, 2, 1
260: 38 03 62 30 00 00 00 00 00 00 00 00 00 00 01 00    tvstoa  12, 2, 3, 2, 1
270: 78 03 62 30 00 00 00 00 00 00 00 00 00 00 01 00    tvstoa  13, 2, 3, 2, 1
280: b8 03 62 30 00 00 00 00 00 00 00 00 00 00 01 00    tvstoa  14, 2, 3, 2, 1
290: f8 03 62 30 00 00 00 00 00 00 00 00 00 00 01 00    tvstoa  15, 2, 3, 2, 1
2a0: 38 04 62 30 00 00 00 00 00 00 00 00 00 00 01 00    tvstoa  16, 2, 3, 2, 1
2b0: 78 04 62 30 00 00 00 00 00 00 00 00 00 00 01 00    tvstoa  17, 2, 3, 2, 1
2c0: 00 00 00 00 00 00 00 00 00 00 8f 21 65 ff 01 00    bltu    x4, x5, -416
2d0: 00 00 00 00 00 00 00 00 00 00 2d 00 00 01 01 00    halt
2e0: 00 00 00 00 00 00 00 00 00 00 6b 08 00 01 01 00    jmp     x1
```

示例 2：`if-else branch`。

```cpp
# 此处前提是，block A 和 block B 都有一定大小，不可以通过标量计算指令替换。
# 假设用户通过 pragma（或者默认行为）告诉编译器，block A 是概率高的 branch，block B 是概率低的。
# 此时就用 1 个 branch + 1 个 jump 指令：第一个条件跳转到 block A，第二个无条件跳转到 block B。
# 类似 Example 1 里的 PC=0xF0 和 PC=0x100。
if (a < b) { // pragma - prefer branch
  block A;
} else {
  block B;
}
```

示例 3：`if-only branch with small possibility`。

```cpp
# 此处前提是，block A 和 block B 都有一定大小，不可以通过标量计算指令替换。
# 此时使用 1 个 branch 指令：条件判断失败就跳转到 block B。
if (a < b) { // not preferred branch
  block A;
}
block B;
```

示例 4：`if-only branch with big possibility`。

```cpp
# 此处前提是，block A 和 block B 都有一定大小，不可以通过标量计算指令替换。
# 此时使用 1 个 branch 指令 + 1 个 jump 指令：branch 指令跳转到 block A 入口，jump 指令跳转到 block B 入口。
if (a < b) { // preferred branch
  block A;
}
block B;
```

示例 5：`switch-case` 使用 `JALR` 优化。

```cpp
# 每个分支假设有同样的概率和性能要求，然后让每个分支承受 1 个固定的 penalty。
# 因为 SIP 不支持动态加载数据段，所以不能用 jump table 优化；这个值可以编译在代码里算出来。
switch (sel) {
  case 0:
    block A;
    break;
  case 1:
    block B;
    break;
  case 2:
    block C;
    break;
}

# 可以把代码编译成以下逻辑，其中 jump_offs 用 SCC 计算做加速。
jump_offs = sel == 0 ? offset_A : sel == 1 ? offset_B : offset_C;

# 然后用 1 个 JALR 指令。这样不管走哪一个分支，switch 选择的开销都是一样的。
```

**原因说明：**
- SIP4.0中对于Branch指令采用了Always Taken的预测机制

- 其中，Branch hit的Penalty明显小于Branch miss的Penalty。参见Branch和Jump指令开销章节

#### 6.3.2. 注意L1 ICache和L0 ICache hit和miss不同组合情况下的 penalty
**规则说明：**
- SIP中包含了L1 ICache和L0 ICache这两级Cache

- 当发生Branch时，指令在这两个ICache上各自hit/miss组合情况会导致不同的penalty

   - 请查看Branch和Jump指令开销章节记录

### 6.4. 访存Hazard优化
#### 6.4.1. SDMEM Hazard优化：避免Scalar LD/ST和Vector LD/ST同时访问SDMEM并且有地址Hazard
**规则说明：**
- 在SIP4.0中，SDMEM被映射为Parameter和Stack Local，其主要被Scalar的load/store指令访问， 也可以被vector linear load/store指令访问（例如spill）

- Scalar/Vector指令在访问SDMEM时，应当尽量避免出现地址重叠

**场景/原因说明：**
- SIP可以访问 SDMEM （latency小）、DSM亲和（latency大）、DSM非亲和（latency更大）、 Global/Stack Remote (最大)

- 向量指令覆盖访问远端存储，所以它的指令队列会特别的深。同一个线程的向量load和load、store 和store之间又是保序的，所以如果一个向量指令访问SDMEM，可能会有非常长的访问延迟。

- 如果有一些数据存放于SDMEM，且同时被标量指令和向量指令访问，那么标量指令和向量指令之间可能有RAW/WAR/WAW, 为了维持它们之间的顺序关系，硬件可能会stall标量访存指令较长时间。

- 在此过程中，如果后续继续有同线程的标量访存指令访问SDMEM，可能会造成阻塞较长时间，当内部各种资源队列满的时候，可能进而继续反压前级。

- 常见的向量数据访问SDMEM大概率是压栈、弹栈操作，此时一般的，标量并不会访问其压栈的向量数据，所以这种情况总比例应该不高; 编译器做栈维护时，应该注意到此特点。


![SDMEM Hazard 示意图](sip4_pipeline_info_for_compiler__sdmem_hazard.png)


#### 6.4.2. 编译器需要支持RO/WO的memory属性
**规则说明：**
- 如果算子中读和写的数据块不会重叠，编程者应该选择将这些数据块分配(设置)为RO/WO属性。

**特别的：对于Scatter-Gather指令， 必须尽可能选择访问带有RO/WO属性的memory。**
- 这种情况下，Compiler需要支持RO/WO属性memory

- 在默认情况下，如果Compiler可以决定memory分配，并且其读写用途上不会重叠，则应选择 RO/WO的memory

**场景说明：**
- 在不少的场景中，SIP访存可以使用到RO/WO属性进行加速

- 对于1个kernel的输入输出，如果输入和输出不重叠，且kernel内对输入区域只做读操作，对输出区域只做写操作，那么，对于kernel的输入和输出，可以使用RO/WO属性。

- 对于1个kernel的输入输出，如果输入输出完全重叠，实现in place计算，且对于每个地址，一旦写了以后，就再也不会发起读，那么对于这部分in place计算的区域，可以使用RO/WO属性。

**原因说明：**
SIP4.0流水线中，使用RO/WO属性的memory进行读写访问，可以避开RAW和WAR检查，读和写之间可以更容易进行乱序调度，从而提高性能。

http://jira.enflame.cn/browse/SIPAMODEL-3685

### 6.5. Maskbit优化要求
#### 6.5.1. 对于maskbit，写和读时需要按照OACC角度避开对OACC0的伪RAW Hazard
**规则说明：**
- 当出现场景需要大量maskbit写+读时，预先产生的maskbit不要写回vacc1~vacc7，避免在后期大量的VLD-L0指令搬运maskbit时产生非预期的OACC0 RAW

**场景说明：**

```cpp
# Example1: maskbit 的寄存器编码规则
# mask0 = VACC0
# mask_reg[0] = VACC8
# mask_reg[1] = VACC9
# 下面这个 case 是 FP16 to FP32 精度变窄 case，FP16 对应的一个 OACC 中 256 个元素的 maskbit 保存在 mask_reg[x] 中。
# 后续 FP32 的计算，需要分别从中 select 各 128bit。

x: mop_mslt(mask_reg[0]（VACC8）, oaccs1[0], oacc_const);
y: mop_mslt(mask_reg[1]（VACC9）, oaccs1[1], oacc_const);
...
z: mop_mslt(mask_reg[unroll]（VACC9）, oaccs1[unroll], oacc_const);

a: mselect_128(mask0（dst：VACC0）, mask_reg[0]（VACC8）, 0);
b: mop_merge(oacccvt0[0], oacccvt0[0], oacc_const, 0, DWidth32); # 隐式用 VACC0
c: mselect_128(mask0（dst：VACC0）, mask_reg[0]（VACC8）, 1);      # 使用 VACC8，避免与前一条 VACC0 产生 RAW
d: mop_merge(oacccvt1[0], oacccvt1[0], oacc_const, 0, DWidth32);
e: mselect_128(mask0（dst：VACC0）, mask_reg[1]（VACC9）, 0);
f: mop_merge(oacccvt0[1], oacccvt0[1], oacc_const, 0, DWidth32);
g: mselect_128(mask0（dst：VACC0）, mask_reg[1]（VACC9）, 1);
h: mop_merge(oacccvt1[1], oacccvt1[1], oacc_const, 0, DWidth32);

# 此时对于 c/e/g：如果 mask_reg[0] 或 mask_reg[1] 编码为 {VACC0-VACC7}，则这些指令序列会和前一条 mselect 指令产生 RAW hazard。
# a 和 e 之间，VACC8 和 VACC9 同属于 OACC1，是 RAR Hazard，这个是允许的。
# x 和 y 之间，VACC8 和 VACC9 同属于 OACC1，是 WAW Hazard，这个也是允许的。
```

**原因说明：**
- 这是由于流水线中VACC寄存器的RAW Hazard管理是基于OACC颗粒度的。如果不避开 VACC1~VACC7，则在后面连续的MOVVA to VACC0和使用maskbit过程时，会被流水线检测为非 maskbit情况下OACC0的RAW

#### 6.5.2. 非Unroll情况下1D指令需要逐条产生maskbit给1D指令消耗时，要利用latency=1的特点进行调度
**规则说明：**
- 在一些场景下，需要1D指令产生maskbit给1D指令使用。每次maskbit都不相同，并且不需要做 unroll

- 此时，Compiler应该根据1D指令直接maskbit RAW latency=1的数值，来优化排列1D指令

**场景说明：**

```cpp
# Example2: 使用 mop_mslt + merge 实现 relu 语义
# f(x) = 0; x < 0
# f(x) = x; x >= 0
# mask0 = vacc0
# mop_mslt + mop_merge 构成对 maskbit0 的 RAW，latency = 1

mop_mslt(mask0, oacc_0[0], oaccs1[0], DType, DWidth);
mop_merge(oaccd[0], oaccs1[0], oacc_0[0], 0, DWidth);

mop_mslt(mask0, oacc_0[1], oaccs1[1], DType, DWidth);
mop_merge(oaccd[1], oaccs1[1], oacc_0[1], 0, DWidth);

...

mop_mslt(mask0, oacc_0[2], oaccs1[unroll], DType, DWidth);
mop_merge(oaccd[unroll], oaccs1[unroll], oacc_0[2], 0, DWidth);
```

**原因说明：**
- 对于1D-Comp指令之间的maskbit的RAW latency=1

#### 6.5.3. Unroll情况下1D指令需要逐条产生maskbit给1D指令消耗时，需要使用批量生产maskbit和批量mov的优化方法
**规则说明：**
- 在一些场景下，需要1D指令产生maskbit给1D指令使用。每次maskbit都不相同，并且此时要求做 unroll

- 由于只有VACC0可以作为maskbit读取的源寄存器。因此该场景下直接计算和使用maskbit，不符合要求

- 此时，Compiler 应优化为批量的 1D 指令计算出 maskbit 并写回各个 VACC，再使用 MOVVA 指令将其复制到 VACC0 中，最后执行带有 maskbit 条件依赖的 1D 指令。

**场景说明：**

```cpp
# Example3: 批量产生 maskbit 和批量 mov，产生的 maskbit 后续由多个 consumer 使用。
# if (x < 0) {
#   C = A + B;
#   D = C + E;
# }
# mask0 = vacc0

# 批量产生 maskbit
mop_mslt(mask_reg[0], oacc_0[0], oaccs1[0], DType, DWidth);
mop_mslt(mask_reg[unroll], oacc_0[3], oaccs1[unroll], DType, DWidth);

# 使用时用 movva
movva(mask0, mask_reg[0], 0);
mop_add(oaccd_C[0], oaccA[0], oaccB[0], DType, Masked, DWidth);
movva(mask0, mask_reg[unroll], 0);
mop_add(oaccd_C[unroll], oaccA[unroll], oaccB[unroll], DType, Masked, DWidth);

movva(mask0, mask_reg[0], 0);
mop_add(oaccd_D[0], oaccC[0], oaccE[0], DType, Masked, DWidth);
movva(mask0, mask_reg[unroll], 0);
mop_add(oaccd_D[unroll], oaccC[unroll], oaccE[unroll], DType, Masked, DWidth);
```

**原因说明：**
- 由于ISA定义上，只能使用VACC0作为maskbit输入，在需要进行maskbit展开的场景中很容易遇到调度瓶颈

- 因此SIP提供了批量计算maskbit到批量移动maskbit到VACC0使用的性能优化路线，尤其是在多线程情况下可以用满VLD/VST指令带宽

#### 6.5.4. 1D指令需要逐条产生maskbit给VLD/VST指令使用时，需要使用批量生产maskbit和批量movva的优化方法
**规则说明：**
- 在一些场景下，需要1D指令产生maskbit给VLD或者VST指令使用。并且每次maskbit都不相同

- 由于1D-Comp指令到VLD/VST的RAW Latency = 16，根据Hazard优化要求，这里需要做调度或者循环展开。

- 此时，Compiler应优化为批量的1D指令计算出maskbit写回各个VACC中，然后使用MOVVA指令将其复制到VACC0中，再执行基于maskbit的VLD/VST指令

**场景说明：**

```cpp
# Example4: 批量产生 maskbit 和批量 mov
# if (x < 0) {
#   a[i] = *b;
# }
# mask0 = vacc0
# mop_mslt + TVLDOA 构成对 maskbit0 的 RAW，latency = 16

mop_mslt(mask_reg[0], oacc_0[0], oaccs1[0], DType, DWidth);
mop_mslt(mask_reg[1], oacc_0[1], oaccs1[1], DType, DWidth);
mop_mslt(mask_reg[2], oacc_0[2], oaccs1[2], DType, DWidth);
mop_mslt(mask_reg[unroll], oacc_0[3], oaccs1[unroll], DType, DWidth);

movva(0, mask_reg[0], 0);
tvldoa(oaccs1[0], tar_base, tar_offset, DWidth32, Masked);
movva(0, mask_reg[1], 0);
tvldoa(oaccs1[1], tar_base, tar_offset, DWidth32, Masked);
movva(0, mask_reg[2], 0);
tvldoa(oaccs1[2], tar_base, tar_offset, DWidth32, Masked);
movva(0, mask_reg[unroll], 0);
tvldoa(oaccs1[unroll], tar_base, tar_offset, DWidth32, Masked);
```

**原因说明：**
- 由于ISA定义上，只能使用VACC0作为maskbit输入，在需要进行maskbit展开的场景中很容易遇到调度瓶颈

- 因此SIP提供了批量计算maskbit到批量移动maskbit到VACC0使用的性能优化路线，尤其是在多线程情况下可以用满VLD/VST指令带宽

#### 6.5.5. 在混精运算并且使用maskbit场景时，需要利用VLD-L0指令到和1D指令之间Latency=1的特点进行调度
**规则说明：**
- 在混精运算当中，会遇到在一种数据宽度下计算得到maskbit，经过切分/聚合后用于另一种数据宽度下进行per-lane运算的场景

- 此时，使用属于VLD-L0的mselect/mmerge系列指令对maskbit进行切分/聚合，到使用它们的1D-Comp指令之间，maskbit RAW latency = 1

**场景说明：**

```cpp
# Example5: 使用 mselect 实现带 mask 的精度变宽算法
# if (x < 0) {
#   y = convert_INT16_to_INT32(x);
# } else {
#   y = const;
# }
# mask0 = vacc0

mop_cvt(oacccvt0[0], INT16_2_INT32, 0, oaccs1[0], vm, RNE);
mop_cvt(oacccvt0[1], INT16_2_INT32, 0, oaccs1[1], vm, RNE);
mop_cvt(oacccvt0[2], INT16_2_INT32, 0, oaccs1[2], vm, RNE);
mop_cvt(oacccvt0[unroll], INT16_2_INT32, 0, oaccs1[unroll], vm, RNE);

mop_mslt(mask_reg[0], oaccs1[0], oacc_const[0], SINT, DWidth16);
mop_mslt(mask_reg[1], oaccs1[1], oacc_const[1], SINT, DWidth16);
mop_mslt(mask_reg[2], oaccs1[2], oacc_const[2], SINT, DWidth16);
mop_mslt(mask_reg[unroll], oaccs1[unroll], oacc_const[3], SINT, DWidth16);

mselect_128(mask0, mask_reg[0], 0);
mop_merge(oacccvt0[0], oacccvt0[0], oacc_const[0], 0, DWidth32);
mselect_128(mask0, mask_reg[0], 1);
mop_merge(oacccvt1[0], oacccvt1[0], oacc_const[1], 0, DWidth32);

mselect_128(mask0, mask_reg[1], 0);
mop_merge(oacccvt0[1], oacccvt0[1], oacc_const[2], 0, DWidth32);
mselect_128(mask0, mask_reg[1], 1);
mop_merge(oacccvt1[1], oacccvt1[1], oacc_const[3], 0, DWidth32);

...
```

**原因说明：**
- 由于ISA定义上，只能使用VACC0作为maskbit输入，在需要进行maskbit展开的场景中很容易遇到调度瓶颈

- 因此SIP4.0特意优化了VLD-L0指令（包括MOVVA）写maskbit到1D运算指令指令使用maskbit的路径，这个RAW latency为1

### 6.6. VL的优化要求
#### 6.6.1. 使用VL来支持动态长度，使用maskbit支持per-lane divergency
**规则说明：**
- 对于Vector类的动态形状算子，以及Matrix计算之后相关的Matrix转Vector Store的动态形状中， 应当使用VL来控制Vector的动态长度；而Maskbit应当专用于per-lane divergency的场景。

**原因说明：**
- 使用VL控制vector动态形状，在memory访问时会转换为linear vector load/store；而使用Maskbit 来作为memory访问的动态长度控制，则会转换为Scatter-Gather的访问。前者的处理效率/功耗开销均小于后者

- VL作为专用SPR寄存器，可以避免指令读取VACC0，减少Bank Conflict

#### 6.6.2. 优化基于VL的动态代码，将代码分为MAX段和余数段
**规则说明：**

- 在实现基于VL的Vector算子动态长度时，优化方法应该是分为2段代码，第一段代码将VL设置为该格式下指令中最大值max_size，并用循环计算算子中满足max_size切分的部分；第二段代码则用于计算小于指令max_size的余数段。

- 其中第一段在循环之前只需要计算一次VL。第二段则需要重新计算VL

**场景说明：**

```cpp
# VADD_unroll4_FP32
# UNROLL_TIMES 4
# OACC_ELEM_DATALANE 128

# MAX VL 段
for (i = size; i >= UNROLL_TIMES * OACC_ELEM_DATALANE;
     i = i - UNROLL_TIMES * OACC_ELEM_DATALANE) {
  tvldoa(oaccs1[0], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs2[0], tar_src2_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs1[1], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs2[1], tar_src2_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs1[2], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs2[2], tar_src2_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs1[3], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs2[3], tar_src2_base, tar_ls_offset0, DWidth32, UnMasked);

  mop_add(oaccd[0], oaccs2[0], oaccs1[0], DType, UnMasked, DWidth);
  mop_add(oaccd[1], oaccs2[1], oaccs1[1], DType, UnMasked, DWidth);
  mop_add(oaccd[2], oaccs2[2], oaccs1[2], DType, UnMasked, DWidth);
  mop_add(oaccd[3], oaccs2[3], oaccs1[3], DType, UnMasked, DWidth);

  tvstoa(oaccd[0], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);
  tvstoa(oaccd[1], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);
  tvstoa(oaccd[2], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);
  tvstoa(oaccd[3], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);
}

# 余数 VL 段：不展开写法
remain_size = i;
for (j = 0; j < i; j += OACC_ELEM_DATALANE) {
  slice_size = setslice(SR0, remain_size, Set_H_VL, SLICENUM, Set_L_VL);
  remain_size = remain_size - slice_size;
  tvldoa(oaccs1[0], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs2[0], tar_src2_base, tar_ls_offset0, DWidth32, UnMasked);
  mop_add(oaccd[0], oaccs2[0], oaccs1[0], DType, UnMasked, DWidth);
  tvstoa(oaccd[0], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);
}
```

**原因说明：**
应当避免在循环中，每执行一次就计算/更新一次VL的方法，提高循环的效率

#### 6.6.3. 优化基于VL的动态代码，将两段代码都需要做展开
**规则说明：**
- 在实现基于VL的Vector算子动态长度时，优化方法应该是分为2段代码，第一段代码将VL设置为该格式下指令中最大值max_size，并用循环计算算子中满足max_size切分的部分；第二段代码则用于计算小于指令max_size的余数段。

- 由于第一段代码中，往往采用了N个unroll，所以第二段余数段需要支持1~ (N* max_size-1)的运算量。为了提升性能，第二段也需要进行展开

- 其中余数段展开时，每展开一次需要重新计算一次VL

**场景说明：**

```cpp
# VADD_unroll4_FP32
# UNROLL_TIMES 4
# OACC_ELEM_DATALANE 128

# MAX VL 段
for (i = size; i >= UNROLL_TIMES * OACC_ELEM_DATALANE;
     i = i - UNROLL_TIMES * OACC_ELEM_DATALANE) {
  tvldoa(oaccs1[0], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs2[0], tar_src2_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs1[1], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs2[1], tar_src2_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs1[2], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs2[2], tar_src2_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs1[3], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);
  tvldoa(oaccs2[3], tar_src2_base, tar_ls_offset0, DWidth32, UnMasked);

  mop_add(oaccd[0], oaccs2[0], oaccs1[0], DType, UnMasked, DWidth);
  mop_add(oaccd[1], oaccs2[1], oaccs1[1], DType, UnMasked, DWidth);
  mop_add(oaccd[2], oaccs2[2], oaccs1[2], DType, UnMasked, DWidth);
  mop_add(oaccd[3], oaccs2[3], oaccs1[3], DType, UnMasked, DWidth);

  tvstoa(oaccd[0], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);
  tvstoa(oaccd[1], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);
  tvstoa(oaccd[2], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);
  tvstoa(oaccd[3], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);
}

# 余数 VL 段：展开并更新 VL
remain_size = i;
// for (j = 0; j < i; j += OACC_ELEM_DATALANE) {
slice_size = setslice(SR0, remain_size, Set_H_VL, SLICENUM, Set_L_VL);
remain_size = remain_size - slice_size;
tvldoa(oaccs1[0], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);
tvldoa(oaccs2[0], tar_src2_base, tar_ls_offset0, DWidth32, UnMasked);
mop_add(oaccd[0], oaccs2[0], oaccs1[0], DType, UnMasked, DWidth);
tvstoa(oaccd[0], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);

slice_size = setslice(SR0, remain_size, Set_H_VL, SLICENUM, Set_L_VL);
remain_size = remain_size - slice_size;
tvldoa(oaccs1[1], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);
tvldoa(oaccs2[1], tar_src2_base, tar_ls_offset0, DWidth32, UnMasked);
mop_add(oaccd[1], oaccs2[1], oaccs1[1], DType, UnMasked, DWidth);
tvstoa(oaccd[1], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);

slice_size = setslice(SR0, remain_size, Set_H_VL, SLICENUM, Set_L_VL);
remain_size = remain_size - slice_size;
tvldoa(oaccs1[2], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);
tvldoa(oaccs2[2], tar_src2_base, tar_ls_offset0, DWidth32, UnMasked);
mop_add(oaccd[2], oaccs2[2], oaccs1[2], DType, UnMasked, DWidth);
tvstoa(oaccd[2], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);

slice_size = setslice(SR0, remain_size, Set_H_VL, SLICENUM, Set_L_VL);
remain_size = remain_size - slice_size;
tvldoa(oaccs1[3], tar_src1_base, tar_ls_offset0, DWidth32, UnMasked);
tvldoa(oaccs2[3], tar_src2_base, tar_ls_offset0, DWidth32, UnMasked);
mop_add(oaccd[3], oaccs2[3], oaccs1[3], DType, UnMasked, DWidth);
tvstoa(oaccd[3], tar_store_base, tar_ls_offset0, DWidth32, UnMasked);
// }
```

**原因说明：**
- 通过benchmark，确认MAX段和余数段均需要进行一定展开才能获得较好的性能，尤其时余数段的展开。

### 6.7. L0 Bank conflict优化要求
#### 6.7.1. 共用数据复制到4个连续OACC，以优化Bank Conflict
**规则说明：**
- 在算子中，一种比较常见的运算形式是一个数据和多个独立数据进行运算。例如per-channel的 Bias/Scaling Factor。最常见写法是将共用数据写到一个OACC中，再和多个OACC进行运算

- 这里的调度建议，是将共用数据复制到连续的4个OACC中，并且交替使用4个OACC，和其他OACC 中不同的数据进行运算

- 这4个OACC中，起始的OACC index需要4对齐

**场景说明：**
图示、用例、实测性能变化等信息，请参考以下连接：

http://jira.enflame.cn/browse/SIPAMODEL-3684

**原因说明：**
- 在SIP4.0中，VACC寄存器的bank管理是以OACC为单位的。一共有4个OACC bank

- 如果始终使用一个OACC和其他不同多个OACC进行运算，则会造成某个bank访问的不平衡

- 而index以4对齐的连续4个OACC，必定属于不同的bank。轮流使用这4个OACC，可以平衡bank的访问，减少bank conflict开销

#### 6.7.2. 在出现大量VACC为单位的访问时，需要修改为以OACC间隔进行调度，使得bank访问的均衡
**规则说明：**
- 当指令中出现大量对于连续的VACC颗粒度的读或者写时，需要考虑将VACC的顺序以OACC视角下的interleave进行调整

   - 例如，如果是连续写和读 `{VACC0, VACC1, VACC2, VACC3, VACC4, VACC5, VACC6, VACC7, ...}`，可以调整为 `{VACC0, VACC8, VACC16, VACC24, VACC1, VACC9, VACC17, ...}`。

即对指令中的VACC颗粒度访问，将VACC index转换为OACC，判断OACC视角下是否均衡

**原因说明：**
- 在SIP4.0中，VACC寄存器的RAW Hazard管理以OACC为单位进行的。连续的VACC访问其实意味着连续8个周期访问同一个OACC（同一个bank）。通过这种调度可以使得一段时间内OACC的bank访问更加均衡，减少bank conflict开销

### 6.8. 指令并行调度要求
#### 6.8.1. 可以实现VLD/VST/1D计算/MSF的并行
**规则说明：**
对于复杂的1D算子，SIP4.0支持VLD/VST/1D计算和MSF指令并行执行

- 可以通过多个软件线程间不同指令并行，也可以通过一个软件线程内不同指令槽的并行

**原因说明：**
- SIP4.0流水线中，上述指令拥有各自独立的ALU，并且每个ALU有独立的指令调度通道和保留站。 可以相对独立调度

#### 6.8.2. MSF和1D计算指令并行吞吐率比例适配1:4
**规则说明：**
SIP4.0的MSF指令算力和1D指令算力比例为1:4

**原因说明：**
Libra SIP4.0中，一条MSF指令和一条1D-Comp指令的表达运算量相同。但是实际MSF ALU算力是指令的1/4，而绝大部分1D计算ALU算力和指令表达算力相匹配

### 6.9. 循环优化要求
#### 6.9.1. 编译器可以接受用户指定的Unroll数值
**规则说明：**

- 编译器需要支持一个用户接口，接受用户传递进来的Unroll数值

- 当用户不指定该数值时，单个线程上的默认Unroll数值为16

**场景说明：**
在默认的情况下，`unroll16 x 4 sub-thread` 用以实现常规调度优化，例如：

http://git.enflame.cn/colin.liang/logicsim/-/blob/master/benchmark/1D_Benchmark/vadd-unroll16_FP32.c

- 在特殊情况下，用户可能为了实现算法上的优化，希望主动在多维unroll情况下来控制

   - 比如在 softmax dim0 希望实现 L0 fusion、dim1 希望能够实现并行性的情况下，可能需要实现 dim0 unroll 32 次把 L0 全部装载、dim1 unroll 2 次实现并行。

http://git.enflame.cn/colin.liang/logicsim/-/blob/master/benchmark/1D_Benchmark/softmax-dim0-unroll0-4096-unroll1-2_FP32.c

**原因说明：**
- 在benchmark中，不同类型的算子有不同的最佳unroll数值

- 常见的1D计算算子，unroll 16是一个较为优化的数值，可以广泛使用

#### 6.9.2. 跨循环的WAR优化要求
**规则说明：**
- 在循环中，为了避免第一次循环末尾到第二次循环开始时使用相同L0寄存器导致的WAR，需要考虑使用以下两种方法之一

   - 增大unroll size和循环体尺寸，使用更多的L0寄存器，使其循环末尾到循环开头的OACC寄存器间隔够远，不会形成WAR

目前，新算子下默认 16unroll + 4sub-thread 可以满足这个条件。

   - 将 VLD/1D-Comp/VST 展开为 2 重~3 重循环，使得流水线可以有更多调度空间

**场景说明：**
常见计算的循环，假设以 VLD-Compute-VST 为 pattern，在展开后的循环代码里：

- 单重循环内的延迟可能有 VLD latency + 计算latency + VST latency，里面主要是RAW类型 hazard

- 前后相邻 2 重循环会出现寄存器的重新复用，里面主要是 WAR 类的 hazard。

- 在优化的过程中，要利用足够多的 L0 来进行展开（默认），使得上述三种指令能够并行，并且不要让跨循环的 VLD latency 因为 WAR 的原因串联；要尽量让 VLD 能够 pipeline 实现，有时候还需要跨循环的优化。

**1重循环内优化：**

Load/计算/Store单线程内串行，只在循环内调度优化，跨循环的优化只靠多线程来相互隐藏，线程数要求很多

**跨2重循环优化：**

Load 与 (计算 + VST) 分处2重循环。

- 此时，在计算读取完寄存器后，立刻调度load 发射出去，相对增大了一些WAR的调度空间，因为Load的位置可以被调度

**跨3重循环优化：**

Load /计算/Store分处3重循环。

此时，Load/Store都可以有相对更多的调度空间。

**原因说明：**
- 对于典型VLD+计算+VST的循环，如果第二个循环和第一个循环使用相同的OA_IDX，第二个循环的 VLD指令和第一个循环的VST之前存在WAR hazard。

- 由于 SIP4.0 支持没有 hazard 的指令跨通道乱序发射，SIP4.0 中跨通道的指令发射顺序已经不和静态编译的顺序完全一致。
- 此时如果要判断是否存在 WAR hazard 阻塞第二个循环中的 VLD 指令发射，需要保证第二个循环的第一条 VLD 和第一个循环的第一条 VLD 间的指令包个数大于以下两项之和：
  - LOAD 指令访问 L1 并解除计算指令 RAW hazard 的时间：当前实际硬件 latency 约为 50，推荐按 64 计算。
  - 计算结束并解除 VST 指令 RAW hazard 的时间：当前推荐按 16 计算。

## 7. Guideline for Legacy Sub-Thread on SIP4.0
SIP4.0 上的 Legacy 算子固定为单线程，Vector 指令包含 2 个 VPT。这和新算子的同构多线程编程基本路线存在一些区别。本章节主要描述 Legacy 算子的指令打包优化要求。

### 7.1. 指令打包优化要求
#### 7.1.1. 对Legacy算子继续进行指令打包优化
**规则说明：**

- 在 Legacy 线程中，应该继续使用指令打包，提高指令的发射效率

**原因说明：**

- 通过benchmark发现，采用指令打包，可以在Legacy算子单线程下尽量提升指令槽指令发射效率， 提高性能

TBD

## 8. Scalar Instruction
### 8.1. 标量寄存器分类
本章节主要讨论和标量寄存器相关的指令。其中标量寄存器包括如下：

- SR寄存器

- TAR寄存器

- SPR寄存器

   - SCC寄存器

   - 其他非 SCC 的 SPR 寄存器

其中，许多 SPR 寄存器作为向量指令/矩阵指令的隐式输入。这些向量指令和矩阵指令将在其他章节中进行讨论，本章节主要讨论修改这些SPR到SPR被使用的latency部分。另外SCC作为一个主要用于标量指令的较为特殊的SPR，会单独讨论

另外，本章节还会讨论 Branch/Jump 指令的开销以及其他 Scalar 指令的调度情况

### 8.2. SR的RAW/WAW/WAR
在讨论SR RAW Latency之前，需要对指令进行分类。SR相关指令分类记录在SR相关指令分类章节的两个表格中。它们被标记为SR_table_1和SR_table_2。

#### 8.2.1. SR RAW Latency
SR的RAW Latency计算规则如下：

1. 如果前一个指令∈SR_table_1，后一条指令∈SR_table_2，并且两者之间形成RAW依赖，则两者的 SR_RAW_latency = SR_Avail_Stage_Index - SR_Read_Stage_Index

   1. 其中，当前一个指令时MOVS并且访问SCC时，SR_Avail_Stage_Index取值为1；当前一个指令时MOVS并且访问非SCC时，SR_Avail_Stage_Index取值为3

2. 如果前一个指令∈SR_table_1，但是后一条指令不属于SR_table_2，并且两者之间形成RAW依赖， 则SR_RAW_latency = 8

3. 如果前一条指令为DIV/REM（这两个指令不属于SR_table_1），并且和后一个指令形成RAW依赖， 则SR_RAW_latency = 9

4. 如果上述条件均不成立，则所有剩余的RAW关系中，前一条指令一定为Scalar Load指令/Scalar Atomic指令/VACCtoSR指令三者之一。则它们的RAW latency计算方法为：

   1. 前一条指令为MOVVA2R.mode2/FIRST_MB/AGGR_MB/POPC_MB：SR_RAW_latency大约为 40

   2. 前一条指令为Scalar Load：依赖于访问的memory latency。

      1. 如果访问的地址为SDMEM/Stack Local，则SR_RAW_latency = 9

      2. 如果访问DSM Affinity Local区域，SR_RAW_latency约为30~40

      3. 如果访问DSM Affinity Remote区域或者DSM Non-Affinity区域，SR_RAW_latency约为 150~170

      4. 如果访问Global区域，SR_RAW_latency会非常长，约300+

   3. 前一条指令为Atomic指令：Atomic只能访问Global Space，它的SR_RAW_latency很长，约 300+

#### 8.2.2. SR WAW Latency
SR的WAW Latency计算规则如下：

1. 如果前一个指令∈SR_table_1，后一条指令∈SR_table_1，并且两者之间形成WAW依赖，则 SR_WAW_Latency = 1

2. 如果前一个指令∈SR_table_1，但后一条指令不属于SR_table_1，并且两者之间形成WAW依赖，则 SR_WAW_Latency = 8

3. 如果前后指令均为DIV/REM之一（它们不属于SR_table_1），并且两者之间形成WAW依赖，则 SR_WAW_Latency = 1

4. 如果前一个指令为DIV/REM之一，后一个指令不属于DIV/REM，并且两者之间形成WAW依赖，则 SR_WAW_Latency = 9

5. 如果上述条件均不成立，则所有剩余的WAW关系中，前一条指令一定为Scalar Load指令/Scalar Atomic指令/VACCtoSR指令三者之一。则它们的WAW latency计算方法为：

   1. 前一条指令为MOVVA2R.mode2/FIRST_MB/AGGR_MB/POPC_MB：SR_WAW_latency = 40(TBD)

   2. 前一条指令为Scalar Load：依赖于访问的memory latency。

      1. 如果访问的地址为SDMEM/Stack Local，则SR_WAW_latency = 9

      2. 如果访问memory空间，则SR_WAW_latency很大

   3. 前一条指令为Atomic指令：Atomic只能访问Global Space，它的SR_WAW_latency很长

#### 8.2.3. SR WAR Latency
SR的WAR Latency始终为1

### 8.3. TAR的RAW/WAW/WAR
对于TAR相关指令分类在TAR相关指令分类章节。共分为三个表格：TAR_Table_1，TAR_Table_2和 TAR_Table_3.

#### 8.3.1. TAR RAW Latency
TAR RAW Latency计算的规则如下

1. 当前一条指令∈TAR_Table_1，后一条指令也属于TAR_Table_1，并且两者形成TAR RAW，则 TAR_RAW_Latency = 1

2. 当前一条指令∈TAR_Table_2，后一条指令也属于TAR_Table_2，并且两者形成TAR RAW，则 TAR_RAW_Latency = 1

3. 当上述两个条件均不成立，并且前一条指令不是TLD时，则TAR_RAW_Latency = 6

4. 当上述条件均不成立，并且前一条指令为TLD时，TAR_RAW_Latency依赖于memory访问的latency

   1. 其中访问DSM/Global/Stack remote Space的latency很长

#### 8.3.2. TAR WAW Latency
TAR WAW Latency计算的规则如下

1. 当前一条指令∈TAR_Table_1，后一条指令也属于TAR_Table_1，并且两者形成TAR WAW，则 TAR_WAW_Latency = 1

2. 当前一条指令∈TAR_Table_2，后一条指令也属于TAR_Table_2，并且两者形成TAR WAW，则 TAR_WAW_Latency = 1

3. 当上述两个条件均不成立，并且前一条指令不是TLD时，则TAR_WAW_Latency = 6

4. 当上述条件均不成立，并且前一条指令为TLD时，TAR_WAW_Latency依赖于memory访问的 latency

   1. 其中访问DSM/Global/Stack remote Space的latency很长

#### 8.3.3. TAR WAR Latency
TAR的WAR Latency始终为1

### 8.4. SCC的RAW/WAW/WAR
SCC寄存器可以分为SCC.Compare和SCC.Carry

#### 8.4.1. SCC RAW Latency
SCC.Compare_RAW_Latency = 1

SCC.Carry的RAW Latency计算情况如下：

- 当前一条指令为MUL，后一条指令为MOVS/CMOV，并且两者形成SCC.Carry RAW，则 SCC.Carry_RAW_Latency = 2

- 其余情况，SCC.Carry_RAW_Latency = 1

#### 8.4.2. SCC WAW Latency
SCC.Compare_WAW_Latency = 1

SCC.Carry_WAW_Latency = 1

#### 8.4.3. SCC WAR Latency
SCC.Compare_WAR_Latency = 1

SCC.Carry_WAR_Latency = 1

### 8.5. SPR(不包括SCC)的RAW/WAW/WAR
**对于非 SCC 的 SPR 寄存器，可以再分为两类：**

- 对于SPR_Table_1中的SPR寄存器，对它的修改必须在前后插入Fence L0或者Fence All，来控制它们的RAW/WAR/WAW Hazard。否则流水线不保证它们的正确性

   - 其中对于VAB的修改，需要参考SPR Spec中的编程规则

- 对于不属于SPR_Table_1也不属于SCC的SPR寄存器（记录在SPR_Table_2中），它们的 RAW/WAW/WAR Latency均始终为1

SPR_Table_1：

|**第一类可写SPR**|**是否需要L0 Fence？**|
|---|---|
|MODE_WRK|Y|
|VAB_VPT0|Y|
|VAB_VPT1|Y|
|MB_STACK|Y|
|STACK_REMOTE|Y|
|STACK_LOCAL|Y|
|TCTL|Y|
|ESL_DTYPE|Y|
|TRAP_RTB|Y|


SPR_Table_2：

|**第二类可写SPR**|**是否需要L0 Fence？**|
|---|---|
|HWT_COUNTER|N|
|NACCOVR|N|
|VL|N|
|LHS_DIM0_REAL|N|
|LHS_DIM1_REAL0|N|
|LHS_DIM1_REAL1|N|
|LHS_DIM1_REAL2|N|
|LHS_DIM0_STRIDE|N|
|LHS_DIM1_STRIDE|N|
|RHS_DIM0_REAL0|N|
|RHS_DIM0_REAL1|N|
|RHS_DIM0_REAL2|N|
|RHS_DIM1_REAL|N|
|RHS_DIM0_STRIDE|N|
|RHS_DIM1_STRIDE|N|
|LDST_DIM0_REAL|N|
|LDST_DIM1_REAL|N|
|LDST_DIM0_STRIDE|N|
|LDST_DIM1_STRIDE|N|
|DPF_ASID|N|
|IPF_ADDR|N|
|IPF_ASID|N|
|IPF_KSID|N|
|LD_BASE0|N|
|LD_BASE1|N|
|LD_BASE2|N|
|LD_BASE3|N|
|LD_BASE4|N|
|LD_BASE5|N|
|LD_BASE6|N|
|LD_BASE7|N|
|ESL_ORDER|N|


### 8.6. Branch和Jump指令开销
SIP4.0 Branch指令

   - Branch指令采用静态预测执行的策略。预测方向为always taken

   - 对于单个线程而言，在没有其他hazard情况下（SR available，L0 Inst cache hit），Branch 预测成功时的branch penalty为3

   - 对于单个线程而言，在没有其他hazard情况下（SR available，L0 Inst cache hit），Branch 预测失败时的branch penalty为16

- SIP4.0 JL/JAL指令

   - 对于单个线程而言，在没有其他hazard情况下（SR available，L0 Inst cache hit），执行 JL/JAL指令的branch penalty为3

- SIP4.0 JALR指令

   - 对于单个线程而言，在没有其他hazard情况下（SR available，L0 Inst cache hit），执行 JALR指令的branch penalty为16

- SIP4.0不再支持Loop类指令

- 上述stall发生时，S2可以通过调度其他线程来提高ALU的利用率。但是在 L1 ICache Hit 情况下，单个软件线程的性能不能提升。各个 branch 情况如下：

|**跳转指令类型**|**跳转预测状况**|**L0 ICache状态**|**Penalty**|
|---|---|---|---|
|条件跳转指令|Prediction Success|Hit|3|
|条件跳转指令|Prediction Fail|Hit|16|
|条件跳转指令|Prediction Success|Miss|9|
|条件跳转指令|Prediction Fail|Miss|16|
|非JALR的无条件跳转指令(JL,JIL, JAL)|N/A|Hit|3|
|非JALR的无条件跳转指令(JL,JIL, JAL)|N/A|Miss|16|
|JALR跳转指令|N/A|Hit|16|
|JALR跳转指令|N/A|Miss|16|


如果遇到L0和L1 ICache都miss，则Penalty可以达到数百个cycle

## 9. Vector & Matrix Instruction
### 9.1. 向量/矩阵寄存器
和向量/矩阵指令相关的寄存器，为VACC寄存器。其中VACC0可以作为向量指令的条件输入(vm=0)，因此对于它有特殊的讨论。

对于(vm=0)条件下使用的VACC0数据，称为Maskbit

### 9.2. VACC通用RAW/WAW/WAR
本节描述的为VACC的通用规则，和maskbit使用无关。即这里的规则不包括对VACC0读写的 RAW/WAW/WAR

#### 9.2.1. VACC通用RAW
VACC的RAW通用计算规则如下：

- 对于VACC的RAW依赖，如果前一条指令的写并不来自于VLD中的VLDA-L1，则此时 VACC_RAW_Latency = 16

- 对于VACC的RAW依赖，如果前一条指令的写自于VLD中的VLDA-L1，则Latency取决于memory的访问latency

前一条指令为Scalar Load：依赖于访问的memory latency。

1. 如果访问的地址为SDMEM/Stack Local，则VACC_RAW_latency = 30(TBD)

2. 如果访问DSM Affinity Local区域，VACC_RAW_latency约为30~40

3. 如果访问DSM Affinity Remote区域或者DSM Non-Affinity区域，VACC_RAW_latency约为150~170

4. 如果访问Global区域，VACC_RAW_latency会非常长，约300+

#### 9.2.2. VACC通用WAW
VACC的WAW通用计算规则如下：

- 如果前后指令都属于Comp 1D指令，并且Comp 1D指令之间存在WAW，则此时 VACC_WAW_Latency = 1

- 如果前一条指令的写自于VLDA-L1，则VACC_WAW_Latency取决于memory的访问latency

- 其余情况下，VACC_WAW_Latency = 16

#### 9.2.3. VACC通用WAR
VACC的WAR通用计算规则如下：

- 如果前后指令都属于Comp 1D指令，并且Comp 1D指令之间存在WAR，则此时 VACC_WAR_Latency = 1

- 其余情况下，VACC_WAR_Latency = 16

### 9.3. Maskbit的RAW/WAW/WAR
Maskbit特指对VACC0寄存器的读写访问。其中读访问包括指令中(vm=0)场景，也包括将VACC0作为正常操作数读取

- 部分Vector/Matrix相关指令对于访问VACC0有限制，详见ISA4.0 Spec中VACC 间接寻址编码限制

- 所有的Comp 2D指令均不能写VACC0，也不支持vm=0。因此下面规则中和Comp 2D指令均无关

#### 9.3.1. Maskbit的RAW
- 如果前一条写VACC0的指令为comp 1d指令，后一条读取指令也为comp 1d指令，此时 maskbit_RAW_latency = 1

- 如果前一条写VACC0的指令为VLD中的VLDA-L0指令，后一条读取VACC0的指令为comp 1d/VLD/VST指令，则此时maskbit_RAW_latency = 1

- 如果前一条写VACC0的指令为VLD中的VLDA-L1指令，后一条读取VACC0的指令为comp 1d/VLD/VST指令，则此时maskbit_RAW_latency取决于memory的访问latency

- 如果前一条写VACC0的指令为VST中的MLI_VSTXI32OA/MLI_VSTXOA指令，后一条读取VACC0的指令为comp 1d/VLD/VST指令，则此时maskbit_RAW_latency取决于memory的访问latency

- 其余情况，maskbit_RAW_latency = 16

#### 9.3.2. Maskbit的WAW
- 如果前一条写VACC0的指令为comp 1d指令，后一条写VACC0指令也为comp 1d指令，此时 maskbit_WAW_latency = 1

- 如果前一条写VACC0的指令为VLD中VLDA-L0指令，后一条写VACC0指令也为VLD指令/Comp 1D指令，此时maskbit_WAW_latency = 1

- 如果前一条写VACC0的指令为VLD中VLDA-L1指令，则此时maskbit_WAW_latency取决于memory 的访问latency

- 如果前一条写VACC0的指令为VST中的MLI_VSTXI32OA/MLI_VSTXOA指令，则此时 maskbit_WAW_latency取决于memory的访问latency

- 其余情况，maskbit_WAW_latency = 16

#### 9.3.3. Maskbit的WAR
所有的maskbit_WAR_latency都恒定为1

## 10. 功能要求(TBD)
### 10.1. 封装Pipeline Sync的API，利用CF Mirror
### 10.2. 注意混精时，VL范围值对单一格式指令和混精指令可能存在变化(TBD)
