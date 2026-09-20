> Imported material source: `Doc/Libra SIP ISA.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `Libra SIP ISA`.

# Libra SIP ISA

> 本文档由 `Libra SIP ISA.pdf` 转换整理，保留原始章节、表格、伪代码与图示内容。

## 目录

- Revision History
- Open & Drop Item
  - Open Item
  - Ongoing Feature
- Glossary
- Reference Link
- Overview
  - Update of ISA4.0
- Register & Architecture State
  - L0 Register File
    - General Registers
    - Scalar Register File(SR)
    - Thread Address Register File(TAR)
    - Accumulation Register File(VACC)
    - Special Purpose Registers(SPR)
  - Control Status Register(CSR)
  - Multiple Vector Pipeline Threads(VPT)
  - Register & Architecture Develop via ISA Versions
- Instruction Slot and Package
  - Instruction Type
  - Instruction Slot
  - Data Flow Processing Pipeline
  - Instruction Slot Assignment
  - Instruction Packaging Constraint
- Instruction Description
  - Common Convention
    - VACC Indirect Addressing
      - VACC 间接寻址规则
      - VACC 间接寻址编码限制
    - Predicate Register Based Condition Execution
    - Condition Code Based Condition Execution
      - Condition Code
      - Condition Code Predefined Scenarios
        - Condition A
        - Condition B
        - Condition C
        - Condition D
      - Condition Code Update Rule
    - MALU Maskbit
    - VL (new in 4.0)
    - Matrix Description (new in 4.0)
    - Common MALU Data Type
    - Element Wise Operation in VACC
    - Floatpoint Support
      - General Support
      - FP8 E4M3 & E5M2 (new in 4.0)
        - E4M3
        - E5M2
      - Denormal Flush (updated in 4.0)
        - Denormal Flush for MALU instructin
        - Denormal Flush for VLDST instructin
      - Rounding Mode
        - Rounding Mode for MALU Floatpoint
      - NaN Result
      - Floatpoint Exception
        - Exception for MALU Floatpoint
    - 64-bit Address Pointer
  - SALU Type Instruction
    - ABS
    - ABSX (new in 4.0)
    - ADD
    - ADDX (new in 4.0)
    - ADD3
    - ADDI
    - ADDIX (new in 4.0)
    - SUBI
    - SUBIX (new in 4.0)
    - ADDI_SFT
    - ADDIX_SFT (new in 4.0)
    - SUB
    - SUBX (new in 4.0)
    - SUB3
    - MADD (new in 4.0)
    - MUL
    - MULX (new in 4.0)
    - DIV
    - DIVX (Dropped)
    - REM
    - REMX(Dropped)
    - ANDX (new in 4.0)
    - AND2
    - ORX (new in 4.0)
    - OR2
    - XORX (new in 4.0)
    - XOR2
    - MAX
    - ANDIX (new in 4.0)
    - XORIX (new in 4.0)
    - ORIX (new in 4.0)
    - MAXX (new in 4.0)
    - MIN
    - MINX (updated in 4.0)
    - SLL
    - SLLX (new in 4.0)
    - SLLI
    - SLLIX (new in 4.0)
    - SR
    - SRX (new in 4.0)
    - SRI
    - SRIX (new in 4.0)
    - SLT
    - SLTX (new in 4.0)
    - SLTI
    - SLTIX (new in 4.0)
    - SEQX (new in 4.0)
    - CMOV (new in 4.0)
    - SETSLICE (new in 4.0)
    - SETSLICE_I (new in 4.0)
    - SETSLICE_M2V (new in 4.0)
    - TRSI2I
    - TRSI2IX (new in 4.0)
    - BC.LZ (updated in 4.0)
    - BC.LS (updated in 4.0)
    - LDI_LO, LDI_HI, LDI16 (updated in 4.0)
    - CEQZ, CNEZ
    - BFI (new in 4.0)
    - BFX (new in 4.0)
  - CTRL Type Instruction
    - JI (new in 4.0)
    - JIL (new in 4.0)
    - AUIPC (new in 4.0)
    - B.unsigned
    - BX.unsigned (new in 4.0)
    - B.signed
    - BX.signed (new in 4.0)
    - JALR (updated in 4.0)
    - JAL
    - WAIT, WAIT_I (updated in 4.0)
    - HALT (updated in 4.0)
    - NOP16
    - TRAP Instruction(updated in 4.0)
      - Instruction Encoding Format
        - Instruction Packing Constraint
        - Implicit Defines and Implicit Uses
      - Instruction Definition
    - IDMA (updated in 4.0)
    - ITAGOP (updated in 4.0)
    - MLI_HINT (new in 4.0)
    - MLI_HINT_GEMM (new in 4.0)
    - SCHED Serial & Footprint Order
    - SCHED (new in 4.0)
      - 说明
    - L0P5_INV (new in 4.0)
    - CNOP
  - SLDST Type Instruction
    - LD (updated in 4.0)
    - LDX (new in 4.0)
    - LDRS (new in 4.0)
    - ST (updated in 4.0)
    - TLD (new in 4.0)
    - TST (new in 4.0)
    - DPREFETCH (updated in 4.0)
    - MOV (updated in 4.0)
    - UEXT (new in 4.0)
    - SEXT (new in 4.0)
    - MOVS
      - MOVS.Barrier (updated in 4.0)
      - MOVS.SCC Format
    - MOVSR2SPR (updated in 4.0)
    - AMO serial (new in 4.0)
    - AMO.CAS (new in 4.0)
    - AMO.EXCH (new in 4.0)
    - AMO.ADD (new in 4.0)
    - AMO.AND (new in 4.0)
    - AMO.OR (new in 4.0)
    - AMO.XOR (new in 4.0)
    - AMO.MAX (new in 4.0)
    - AMO.MAXNUM (new in 4.0)
    - AMO.MIN (new in 4.0)
    - AMO.MINNUM (new in 4.0)
    - AMO.INC (new in 4.0)
    - AMO.DEC (new in 4.0)
  - VALU Type Instruction (Updated in 4.0)
    - NOP
  - VMOV Type Instruction
    - VLDI_LO.VA
    - VLDI_HI.VA
    - VLDI_LO.OA (new in 4.0)
    - VLDI_HI.OA (new in 4.0)
    - VLDI_64p0.OA (new in 4.0)
    - VLDI_64p1.OA (new in 4.0)
    - VLDI_64p2.OA (new in 4.0)
    - VLDI_64p3.OA (new in 4.0)
    - VCLR.OA (updated in 4.0)
    - MOVVA (updated in 4.0)
    - MOVOA (new in 4.0)
    - REMAPVA (updated in 4.0)
    - VLDI_MB (updated in 4.0)
    - MOVSR2MB (updated in 4.0)
    - VSET_MB (updated in 4.0)
    - VSETI_MB (updated in 4.0)
    - AGGR_MB (update in 4.0)
    - POPC_MB (new in 4.0)
    - FIRST_MB (new in 4.0)
    - MOVR2VA.mode1 (updated in 4.0)
    - MOVR2VA.mode2 (updated in 4.0)
    - MOVVA2R.mode2 (updated in 4.0)
    - VLDI_TAR.T0, VLDI_TAR.T1, VLDI_TAR.DUAL (updated in 4.0)
    - MOVSR2TAR.EXT (updated in 4.0)
    - MOVTAR2SR.EXT (updated in 4.0)
    - MOVTAR.T0, MOVTAR.T1, MOVTAR.DUAL
    - MOVSFT_VA (new in 4.0)
    - MOVSFTC_VA (new in 4.0)
    - MOVSFTI_VA (new in 4.0)
    - MB_PUSH (new in 4.0)
    - MB_POP (new in 4.0)
    - MMERGE (new in 4.0)
    - MSELECT_256 (new in 4.0)
    - MSELECT_128 (new in 4.0)
    - MSELECT_64 (new in 4.0)
  - VLDST Type Instruction
    - TARADD (update in 4.0)
    - TVLDOA (new in 4.0)
    - TVSTOA (new in 4.0)
    - TVLDOA.reg (new in 4.0)
    - TVSTOA.reg (new in 4.0)
    - TVSTOA_EXT (new in 4.0)
    - TVSTOA_EXT.reg (new in 4.0)
    - VLDOA (new in 4.0)
    - VSTOA (new in 4.0)
    - VLDEOA (new in 4.0)
    - VSTEOA (new in 4.0)
    - REDV.ADD (new in 4.0)
    - REDV.MAX (new in 4.0)
    - REDV.MAXNUM (new in 4.0)
    - MLI_VLDXOA (new in 4.0)
    - MLI_VSTXOA (new in 4.0)
    - MLI_VLDXI32OA (new in 4.0)
    - MLI_VSTXI32OA (new in 4.0)
  - MALU Type Instruction
    - GEMM Operation (new in 4.0)
      - Matrix Description
      - gemm_mode & dtype
      - lhs_row_max
      - Zero Padding
      - dst_stride
      - Pipeline Unrolling
      - Convert FP32 to EF32
      - Real Size Process
        - Step1: Read SPR Real_Size
        - Step2: Clamp to MAX Value
        - Step3: Exception Check
        - Step4: Convert to NOP
        - Step4: Deal with LHS/RHS both Padding
    - MLI_GEMM (new in 4.0)
    - MOP serial (updated in 4.0)
    - MOP.ADD (updated in 4.0)
    - MOP.SUB (updated in 4.0)
    - MOP.MUL (updated in 4.0)
    - MOP.MUL_HI (new in 4.0)
    - MOP.SQR (updated in 4.0)
    - MOP.SLL (updated in 4.0)
    - MOP.SRA (updated in 4.0)
    - MOP.SRL (updated in 4.0)
    - MOP.SLRO (new in 4.0)
    - MOP.SRRO (new in 4.0)
    - MOP.ABS (updated in 4.0)
    - MOP.NEG (updated in 4.0)
    - MOP.INV (updated in 4.0)
    - MOP.AND (updated in 4.0)
    - MOP.OR (updated in 4.0)
    - MOP.XOR (updated in 4.0)
    - MOP.MIN (updated in 4.0)
    - MOP.MAX (updated in 4.0)
    - MOP.ABSMAX (new in 4.0)
    - MOP.MINNUM (updated in 4.0)
    - MOP.MAXNUM (updated in 4.0)
    - MOP.ABSMAXNUM (new in 4.0)
    - MOP.FUSE (updated in 4.0)
    - MOP.GETE (updated in 4.0)
    - MOP.GETM (updated in 4.0)
    - MOP.CVT (updated in 4.0 )
    - MOP.SLLI (updated in 4.0)
    - MOP.SRLI (updated in 4.0)
    - MOP.SRAI (updated in 4.0)
    - MOP.SLROI (new in 4.0)
    - MOP.SRROI (new in 4.0)
    - MOP.MERGE (updated in 4.0)
    - MOP.CADD (updated in 4.0)
    - MOP.CSUB (updated in 4.0)
    - MOP.CMUL (updated in 4.0)
    - MOP.CSLL (updated in 4.0)
    - MOP.CSLLI (updated in 4.0)
    - MOP.MSEQ (updated in 4.0)
    - MOP.MSNE (updated in 4.0)
    - MOP.MSLT (updated in 4.0)
    - MOP.MSLE (updated in 4.0)
    - MOP.MSGE (updated in 4.0)
    - MOP.MSGT (updated in 4.0)
    - MOP.MAND (updated in 4.0)
    - MOP.MOR (updated in 4.0)
    - MOP.MXOR (updated in 4.0)
    - MOP.MANDN (updated in 4.0)
    - MOP.MORN (updated in 4.0)
    - MOP.MNAND (updated in 4.0)
    - MOP.MNOR (updated in 4.0)
    - MOP.MXNOR (updated in 4.0)
    - MOP.MSBF (new in 4.0)
    - MOP.MSIF (new in 4.0)
    - MOP.MSOF (new in 4.0)
    - MOP.MIOTA (new in 4.0)
    - MOP.MUL_SCL (new in 4.0)
    - MOP.MUL_F32MIX (updated in 4.0)
    - MOP.MUL_F16MIX (updated in 4.0)
    - MOP.MUL_I32MIX (updated in 4.0)
    - MOP.WMUL_I32MIX (updated in 4.0)
    - MOP.WMUL_I64MIX (new in 4.0)
    - MOP.ADD_F32MIX (updated in 4.0)
    - MOP.ADD_F16MIX (updated in 4.0)
    - MOP.ADD_I32MIX (updated in 4.0)
    - MOP.WADD_I32MIX (updated in 4.0)
    - MOP.WMULUS_I32MIX (updated in 4.0)
    - MOP.MAC (updated in 4.0)
    - MOP.MAS (updated in 4.0)
    - MOP.IMAS (updated in 4.0)
    - MOP.MAC_F32MIX (updated in 4.0)
    - MOP.MAS_F32MIX (updated in 4.0)
    - MOP.IMAS_F32MIX (updated in 4.0)
    - MOP.MAC_F16MIX (updated in 4.0)
    - MOP.MAS_F16MIX (updated in 4.0)
    - MOP.IMAS_F16MIX (updated in 4.0)
    - MOP.XOR_U32MIX (new in 4.0)
    - MOP.FCLASS (updated in 4.0)
    - MOP.POPC (new in 4.0)
    - MOP.CLZ (new in 4.0)
    - MOP.CLS (new in 4.0)
    - MOP.BREV (new in 4.0)
    - MOP.SIGN (new in 4.0)
    - MOP.BCAST (new in 4.0)
    - MSF (updated in 4.0)
    - MID (updated in 4.0)
    - Uniform RNG Architecture
      - LFSR算法
      - Philox4x32-10算法
    - MLFSR (new in 4.0)
    - MCASR (new in 4.0)
    - REDMAX (new in 4.0)
    - REDMIN (new in 4.0)
    - REDSUM (new in 4.0)
    - NOP48
    - Sorting Architecture
      - 基数排序（Radix Sort）
        - 单bit基数排序
          - 单bit基数排序在SIP4.0的实现
        - 多bit基数排序算法介绍
          - 大规模数据量全排序算法—多SIP并行排序
          - 小规模数据量全排序算法—单SIP独立排序
        - 多bit基数排序硬件加速单元（DSA）
        - 如何基于DSA实现多SIP并行的多bit基数排序
          - 数据预处理 & 恢复处理
          - 排序轮数计算
          - 基于ISA的具体实现
    - MRADIX_W_BASE (new in 4.0)
    - MRADIX_R_BASE (new in 4.0)
    - MRADIX_CNTBASE (new in 4.0)
    - MRADIX_OFFSET (new in 4.0)
    - MRADIX_STXOA (new in 4.0)
- Memory Model
  - Memroy Consistency
  - IO Consistency
- Exception & Interrupt
- Instruction Encoding
  - Pseudo Instruction Encoding
  - Immediate Number Encoding
- Appendix B: Instruction Packaging Constraint
  - 固定打包限制
  - 单独打包限制
  - 关于Register Hazard的打包限制
    - 关于SR/TAR/OACC Hazard的打包限制
    - 关于SPR Hazard的打包限制
  - 关于Memory Hazard 的打包限制
  - 违反指令打包限制的后果
- Appendix C: ISA4.0 Compatibility
  - Overview
  - Compatibility of Registers
    - SR Bitwidth Compatibility
    - 基于KRT_API的Scorpio到Libra 1D算子兼容性方案
  - Compatibility of Instructions
    - Instruction Removal
    - Instruction Encoding Update
    - Limitation of Usage
  - Compatibility of Instruction Package
  - Compatibility of Accuracy
  - Compatibility of Instruction Latency
- Appendix D: GEMM Programming Example

---

# 1. Revision History

| SIP Version | Version | Date | Author | Note |
| --- | --- | --- | --- | --- |
| 4.0 | v1.0 | Jun 21, 2025 | Echo Gou Yuanzhi Hua | Create initial version |

# 2. Open & Drop Item

## 2.1. Open Item

N/A

## 2.2. Ongoing Feature

N/A

# 3. Glossary

| Name | Description | Comment |
| --- | --- | --- |
| POR | Plan of Record |  |
| Ins | Abbreviation of Instruction |  |
| VALU | Vector ALU | 所有 VALU 指令在 ISA4.0 中都被删除，它们的功能被 MALU 替代 |
| MALU | Matrix ALU |  |
| SFU | Special Function Unit | 所有 SFU 相关指令在 ISA4.0 中都被删除，它们的功能被 MALU 的 MSF 指令替代 |
| RNG | Random Number Generation | ISA4.0 中，基于 VR 的 RNG 指令被删除，它的功能被基于 VA 的 RNG 指令替代 |
| 1D operation | Element-wise operation, or vector operation | 指代除了 VMM 系列之外的 vector/matrix 运算指令 |
| 2D operation | Matrix operation | 指代 VMM 系列指令 |
| L0 | A.K.A. level 0 memory, i.e., register file or storage defined in ISA |  |
| L1 | A.K.A. level 1 memory, i.e., instruction memory, data memory |  |
| VPT | Vector pipeline thread | 一条向量/矩阵指令可以操作复数组独立的向量/矩阵寄存器，得到每组运算结果。<br>每一组独立的向量/矩阵寄存器都归属于同一个 VPT。<br>向量/矩阵指令在操作时，每个 VPT 上的寄存器编号相同。<br>Note：ISA3.2 中的 thread 指代 VPT，而非软件线程或者硬件线程。 |
| VPT_NUM | Vector pipeline thread number | 在 ISA3.2 和 ISA4.0 中，VPT_NUM 最大为 2 |
| ISA3.2 | Crystal Instruction 3.2 | 第三代 SIP 所使用的指令集 |
| ISA4.0 | Crystal Instruction 4.0 | 第四代 SIP 所使用的指令集，即本文档介绍的指令集 |
| HW-thread | Hardware thread, A.K.A hardware context | 即硬件线程。每个硬件线程上有独立的取指和访存单元，可以执行一个或者多个软件线程。<br>为了和 Arch Spec 统一，本文档使用 HW-thread 的专用英文缩写。 |
| SW-thread | Software thread, A.K.A software context | 即软件线程。每个软件线程有一个 PC 和独立的上下文。<br>为了和 Arch Spec 统一，本文档使用 SW-thread 的专用英文缩写。 |
| Multi-HW-thread | Multiple hardware thread, A.K.A Multiple hardware context | 硬件多线程。为了和 Arch Spec 统一，本文档使用 Multi-HW-thread 的专用英文缩写。 |
| Multi-SW-thread | Multiple software thread, A.K.A multiple software context | 软件多线程。为了和 Arch Spec 统一，本文档使用 Multi-SW-thread 的专用英文缩写。 |

# 4. Reference Link

- Libra SIP Arch Spec
- Libra SIP SPR Spec
- Libra SIP CSR Spec
[1]: [2]: [3]: [4]: [5]:

# 5. Overview

Crystal Instruction为面向高性能NN运算和泛化HPC的系列指令集(Instruction Set Architecture)，它被燧原科技公司自主开发的计算核SIP 所使用。其中Crystal Instruction 4.0（以下简称为ISA4.0）为第四代SIP所使用的指令集。ISA4.0的基本特性如下：

- 继承自上一代的Crystal Instruction 3.2（以下简称为ISA3.2），与ISA3.2有良好的兼容性
  - 关于ISA4.0和ISA3.2的兼容性，请见ISA4.0 Compatibility章节
- 支持软件多线程编程(multi-sub-thread)
  - 在不进行指令打包情况下，同构多线程拥有良好的性能
  - 出于兼容性角度考虑，在ISA4.0保留了VLIW打包的能力。
  - 支持打包时，每个指令包中包含4个或者5个指令槽。
- 每个指令槽所支持的指令类型有所不同，用于更好支持流水线的数据处理
- 支持下列的指令类型

| Instruction Type | Description |
| --- | --- |
| CTRL | 程序流控制指令 |
| SALU | 标量计算指令和 MOV 类指令，包括 32bit 整型运算、64bit 整型运算 |
| SLDST | 64bit/32bit/16bit/8bit 标量的 load/store 指令 |
| MALU | Matrix ALU 数据运算指令。支持的数据格式包括：<br>整型：UINT8/INT8/UINT16/INT16/UINT32/INT32/UINT64/INT64<br>浮点：FP8/BF16/FP16/FP32 |
| VMOV | 向量/矩阵寄存器之间的 mov 类指令，标量和向量/矩阵寄存器之间的 mov 指令，以及立即数初始化向量/矩阵寄存器的指令 |
| VLDST | 向量/矩阵寄存器的 load/store 类指令 |
| MLI | Middle Level 指令，固定和 MLI_HINT 或 MLI_HINT_GEMM 打包，不能和其他指令打包 |

- MALU/VMOV/VLDST系列指令，最多可以支持2个VPT的操作语义
  - 即几乎每个向量/矩阵指令，一条指令可以在硬件上驱动两组互相独立的向量/矩阵寄存器，获得两个向量/矩阵操作结果
  - 请注意，VPT>1不等同于软件多线程（multi-SW-thread），也不等同于硬件多线程（mult-HW-thread）
- MALU/VMOV/VLDST系列指令，支持可配置的VPT数量
  - 通过TCTL寄存器，指令流可以动态切换所支持的VPT个数。允许出现0个VPT/1个VPT(固定为VPT0)/2个VPT三种情况。
- Scalar寄存器和scalar指令运行结果，根据语义可以被所有VPT共享。
- 支持基于mailbox的同步机制

## 5.1. Update of ISA4.0

ISA4.0相比于ISA3.2，主要有如下变化：

- 更好支持在同一个SIP或者同一硬件线程上的软件多线程编程
  - 对于TCTL配置为单个VPT时，相较于VPT=2情况下，更易于软件多线程编程
  - 对于TCTL配置为0个VPT时，主要用于Supervisor等纯标量软件线程
  - 增加同一SIP内和同一硬件线程内的软件线程同步指令
  - 增加线程调度指令
    - `SCHED`
    - `SCHED_I`
  - 增加2D相关指令对于多线程编程的支持特性和指令
  - 相当一部分新增属性只能在单VPT0情况下执行。详见Multiple Vector Pipeline Threads章节
- 支持64bit的地址
  - PC地址扩展为32bit
  - 数据地址扩展为64bit
  - SR和TAR均扩展为64bit
  - 在兼容ISA3.2的32bit整形标量指令基础上，扩展了对应的64bit整形标量运算指令
  - 扩展下列三条指令语义
    - `VLDI_TAR.T0`
    - `VLDI_TART1`
    - `VLDI_TAR.dual`
  - 扩展64bit的scalar load/store指令
  - VLDST系列指令语义全部扩展为64bit地址
  - 对SR->VACC和VACC->SR的MOV指令增加了64bit数据的模式
  - 对SR->maskbit和maskbit->SR类型的指令增加了64bit数据格式的支持
- 增加1D指令对于INT64/UINT64的支持
  - 所有非混精指令
- 增加1D指令对于OACC的支持
- 支持FP8数据格式的2D运算
  - 增加FP8的vmm mode和gemm mode
  - 扩展dtype和dwith对于FP8的数据格式定义
  - 提供有限的FP8 1D运算指令
- 增强的向量load/store指令语义
  - 新增以OACC为单位的的linear LDST，strided VLDST和scatter-gather VLDST
  - 上述LDST均以64bit作为地址单位，包括scatter-gather的offset
  - 上述linear LDST包括SR base、TAR post-incremental和TAR pre-incremental寻址方式
  - 上述LDST均支持maskbit
  - 上述LDST均支持VL动态性
  - 上述LDST指令均放宽地址对齐要求，起始地址对齐到访问的元素的宽度
- 增加基于矩阵变量的2D运算指令
  - 均为MLI的指令
  - 支持OACC的stride
- 增加指令的动态性
  - 对基于vector类型的load/store和运算指令，增加VL这个SPR寄存器，来控制单个指令的向量长度
    - VL借鉴自于[RISC-V V扩展][3]
  - 增加切片指令
- 增加标量原子指令
  - 标量原子指令可以服务于多线程同步和reduce算子
  - 包括两类
    - 一类是有返回数的atomic指令
    - 一类是没有返回值的atomic reduce指令
- 增加向量的原子指令
  - 向量的原子指令用于reduce算子
  - 向量的原子指令均不支持返回值
- 增加控制类指令
  - 增加了PC相关长立即数跳转指令
    - `JI`
  - 增加了PC相关长立即数跳转并保存下一个PC的指令
    - `JIL`
  - 增加了PC高位加立即数的指令
    - `AUIPC`
- 增加对数据Cache的支持
- 向量/矩阵相关部分寄存器变化
  - SIP4.0单线程物理资源最多支持的VA数量为6144个VACC
  - 删除IV/VR/SMR寄存器
- 精简部分ISA3.2指令和语义
  - 详见Appendix C: ISA4.0 Compatibility
- 其他的指令增强
  - 支持操作数为立即数的标量逻辑运算指令
    - `ANDIX`
    - `ORIX`
    - `XORIX`
  - 加速scalar地址计算的指令
    - `MADD`
  - 支持浮点vector absmax指令
    - `MOP.ABSMAX`
    - `MOP.ABSMAXNUM`
  - 由于IEEE754对于max/min语义的调整，修改下述指令的部分语义
    - `MOP.MAX`
    - `MOP.MIN`
  - 由于IEEE754对于max/min语义的调整，添加下述两个指令进行补充
    - `MOP.MAXNUM`
    - `MOP.MINNUM`
  - 支持scalar-vector乘法运算指令
    - `MOP.MUL_SCL`
  - 支持vector内每个元素循环移位指令
    - `MOP.SLRO`
    - `MOP.SRRO`
    - `MOP.SLROI`
    - `MOP.SRROI`
  - 支持vector内每个元素的bit1计数指令
    - `MOP.POPC`
  - 支持vector内每个元素的前导0和前导符号位计数指令
    - `MOP.CLZ`
    - `MOP.CLS`
  - 支持vector内每个元素bit颠倒指令
    - `MOP.BREV`
  - 支持vector内每个元素检测符号位指令
    - `MOP.SIGN`
  - 支持maskbit的1计数指令
    - `POPC_MB`
  - 支持寻找maskbit首1的指令
    - `FIRST_MB`
  - 支持Set Maskbit系列指令
    - `MOP.MIOTA`
    - `MOP.MSBF`
    - `MOP.MSIF`
    - `MOP.MSOF`
  - 支持基于VACC的MOVSFT指令
    - `MOVSFT_VA`
    - `MOVSFTC_VA`
    - `MOVSFTI_VA`
  - 增加了REMAPVA的支持
    - 增加64bit<->32bit的转换
  - 增强了MSF指令的写回范围
    - 可以支持OACC回写
  - 支持向量内的Reduction操作指令
    - `REDMAX`
    - `REDMIN`
    - `REDSUM`
  - 支持BroadCast操作指令
    - `MOP.BCAST`
  - 支持基于硬件加速的多bit基数排序指令
    - `MRADIX_W_BASE`
    - `MRADIX_R_BASE`
    - `MRADIX_CNTBASE`
    - `MRADIX_OFFSET`
    - `MRADIX_STXOA`
  - 支持maskbit MERGE和SELECT操作指令，用于加速混精运算
    - `MMERGE`
    - `MSELECT_256`
    - `MSELECT_128`
    - `MSELECT_64`
  - 支持标量Bit操作指令
    - `BFI`
    - `BFX`

# 6. Register & Architecture State

ISA4.0对于寄存器访问范围相关的架构特性定义如下

# 1. L0寄存器，对于每一个软件线程都是独立的

# 1. 每一个软件线程中，两个VPT所属的L0向量/矩阵寄存器互相独立，但是L0标量寄存器被所有VPT所共享

# 2. SPR寄存器，绝大部分对于软件线程独立，但是部分SPR寄存器以硬件线程粒度共享

# 3. CSR寄存器均可被所有软件线程访问

由于ISA4.0的指令语义，本架构支持multi-VPT。请见Multiple Vector Pipeline Threads Support章节描述

## 6.1. L0 Register File

下面是L0寄存器资源.

| Name | Short Abbr. | VPT Independent? | Size/Per-VPT |
| --- | --- | --- | --- |
| Scalar Register File | SR | N | 64-bit x 32 entries = 256B |
| Scalar Condition Code | SCC | N | 2 bits |
| Special Purpose Registers | SPR | N | 64-bit x 256 entries = 2KB |
| Thread Address Register File | TAR | Y | 64-bit x 32 entries = 256B |

| Name | Short Abbr. | VPT Independent? | Size/Per-VPT |
| --- | --- | --- | --- |
| Accumulation Register File | VACC | Y | 512-bit x 6144 entries = 384KB |

和ISA3.2相比，ISA4.0的L0寄存器发生了如下变化

- ISA4.0指令可索引的VA寄存器数量为1024OACC即8192个VACC，SIP4.0单线程物理资源最多支持的VA数量为6144个VACC
- 去除了所有VCC寄存器。这一点是由于去除了所有VALU相关指令
- 去除了所有IV/VR/SRM寄存器。

### 6.1.1. General Registers

下面为所有L0通用寄存器的伪代码表达

```text
#ifndef_SIP_ARCH_H_
#define_SIP_ARCH_H_
// constant macro
#define DONT_CARE_VALUE 1
// resource definition
#define SR_INT64_W      64
#define SR_NUM          32
#define SR_WIDTH        SR_INT64_W
#define VPT_NUM         2                               //vector thread pipe number: 2
#define VA_INT_W        32
#define VA_NUM          6144
#define VA_INT_LANE_NUM 16
#define VA_MAX_LANE_NUM (VA_INT_LANE_NUM*VA_INT_W/8)    //64 lanes
#define VA_WIDTH        (VA_INT_W*VA_INT_LANE_NUM)      //512-bit per VA entry
#define DA_INT64_W      64
#define DA_NUM          3072
#define DA_INT64_LANE_NUM   16
#define DA_MAX_LANE_NUM (DA_INT64_LANE_NUM*DA_INT64_W/8)    //128 lanes
#define DA_WIDTH        (DA_INT64_W*DA_INT64_LANE_NUM)      //1024-bit per DA entry
#define QA_INT64_W      64
#define QA_NUM          1536
#define QA_INT64_LANE_NUM   32
#define QA_MAX_LANE_NUM (QA_INT64_LANE_NUM*QA_INT64_W/8)    //256 lanes
#define QA_WIDTH        (QA_INT64_W*QA_INT64_LANE_NUM)      //2048-bit per QA entry
#define OA_INT64_W      64
#define OA_NUM          768
#define OA_INT64_LANE_NUM   64
#define OA_MAX_LANE_NUM (OA_INT64_LANE_NUM*OA_INT64_W/8)    //512 lanes
#define OA_WIDTH        (OA_INT64_W*OA_INT64_LANE_NUM)      //4096-bit per OA entry
#define TAR_NUM         32
#define TAR_WIDTH       SR_INT64_W
typedef unsigned char       uint8_t;
typedef signed char         int8_t;
typedef unsigned short      uint16_t;
typedef signed short        int16_t;
typedef unsigned int        uint32_t;
typedef signed int          int32_t;
typedef unsigned long int   uint64_t;
typedef signed long int     int64_t;
typedef enum DATA_MODE {SINT8=0, UINT8, SINT16, UINT16, SINT32, UINT32, SINT64, UINT64, FP32, FP16, BF16,
FP64, FP8E4M3, FP8E5M2} dmode_t;
#define BITS_OF_DATA_MODE(a) ((a==SINT8 || a==UNIT8 || a==FP8E4M3 || a==FP8E5M2) ? 8 : (a==SINT16 || a==UINT16
|| a==FP16 || a==BF16) ? 16 : (a==FP64) ? 64: 32)
typedef enum DATA_LANE_W {LW8=0, LW16, LW32, LW64} lane_t;
typedef union fp8_e4m3_t
{
    uint8_t bits;
    struct
    {
        uint8_t Man  : 3;
        uint8_t Exp  : 4;
        uint8_t Sign : 1;
    } field;
} fp8_e4m3_t;
typedef union fp8_e5m2_t
{
    uint8_t bits;
    struct
    {
        uint8_t Man  : 2;
        uint8_t Exp  : 5;
        uint8_t Sign : 1;
    } field;
} fp8_e5m2_t;
typedef union fp16_t
{
    uint16_t bits;
    struct
    {
        uint16_t Man  : 10;
        uint16_t Exp  : 5;
        uint16_t Sign : 1;
    } field;
} fp16_t;
typedef union bf16_t
{
    uint16_t bits;
    struct
    {
        uint16_t Man  : 7;
        uint16_t Exp  : 8;
        uint16_t Sign : 1;
    } field;
} bf16_t;
typedef union fp32_t
{
    uint32_t bits;
    struct
    {
        uint32_t Man  : 23;
        uint32_t Exp  : 8;
        uint32_t Sign : 1;
    } field;
    float data;
} fp32_t;
typedef union ef32_t
{
    uint32_t bits;
    struct
    {
        uint32_t Zero : 12;
        uint32_t Man  : 11;
        uint32_t Exp  : 8;
        uint32_t Sign : 1;
    } field;
}
typedef union fp64_t
{
    uint64_t bits;
    struct
    {
        uint32_t Man  : 52;
        uint32_t Exp  : 11;
        uint32_t Sign : 1;
    } field;
    float data;
} fp64_t;
typedef union sr_t {
    int8_t      s8[SR_WIDTH/sizeof(int8_t)];
    uint8_t     u8[SR_WIDTH/sizeof(uint8_t)];
    int16_t     s16[SR_WIDTH/sizeof(int16_t)];
    uint16_t    u16[SR_WIDTH/sizeof(uint16_t)];
    int32_t     s32[SR_WIDTH/sizeof(int32_t)];
    uint32_t    u32[SR_WIDTH/sizeof(uint32_t)];
    int64_t     s64[SR_WIDTH/sizeof(int64_t)];
    uint64_t    u64[SR_WIDTH/sizeof(uint64_t)];
    uint8_t     w8_bits[SR_WIDTH/sizeof(uint8_t)];
    uint16_t    w16_bits[SR_WIDTH/sizeof(uint16_t)];
    uint32_t    w32_bits[SR_WIDTH/sizeof(uint32_t)];
} sr_t;
typedef union sr_t {
    fp32_t      fp32[SR_WIDTH/sizeof(fp32_t)];
    fp64_t      fp64[SR_WIDTH/sizeof(fp64_t)];
} sr_t;
typedef struct maskbit
{
    uint8_t mask    : 1;
} maskbit_t;
typedef union oa_t {
    int8_t      s8[OA_WIDTH/sizeof(int8_t)];
    uint8_t     u8[OA_WIDTH/sizeof(uint8_t)];
    int16_t     s16[OA_WIDTH/sizeof(int16_t)];
    uint16_t    u16[OA_WIDTH/sizeof(uint16_t)];
    int32_t     s32[OA_WIDTH/sizeof(int32_t)];
    uint32_t    u32[OA_WIDTH/sizeof(uint32_t)];
    fp64_t      fp64[OA_WIDTH/sizeof(fp32_t)];
    fp32_t      fp32[OA_WIDTH/sizeof(fp32_t)];
    fp16_t      fp16[OA_WIDTH/sizeof(fp16_t)];
    bf16_t      bf16[OA_WIDTH/sizeof(bf16_t)];
    fp8_e4m3_t  fp8e4m3[OA_WIDTH/sizeof(fp8_e4m3_t)];
    fp8_e5m2_t  fp8e4m3[OA_WIDTH/sizeof(fp8_e5m2_t)];
    uint8_t     w8_bits[OA_WIDTH/sizeof(uint8_t)];
    uint16_t    w16_bits[OA_WIDTH/sizeof(uint16_t)];
    uint32_t    w32_bits[OA_WIDTH/sizeof(uint32_t)];
    maskbit_t   mask[VA_WIDTH];
} oa_t;
typedef struct cc
{
    uint8_t carry      : 1;
    uint8_t compare    : 1;
} cc_t;
typedef int32_t tar_t;
// architecture resource
cc_t    scc;
sr_t    sr[SR_NUM];                             //sr[32]
oa_t    oa[VPT_NUM][OA_NUM];                    //oa[2][768]
tar_t   tar[VPT_NUM][TAR_NUM];                  //tar[2][32]
#endif
```

### 6.1.2. Scalar Register File(SR)

ISA4.0中，每个软件线程支持32个SR寄存器。其中SR0始终为0，所有对SR0的写操作都会被丢弃，并且不会触发任何exception。

和ISA3.2中不同的一点是，ISA4.0的SR被扩展为64bit，用于支持64bit的地址寻址。而原有的32bit标量运算指令依然被保留，用于保持对 ISA3.2兼容性。

- 数量：32
- 位宽：64bit

### 6.1.3. Thread Address Register File(TAR)

- ISA4.0中，每个软件线程中，单个VPT均支持32个TAR，用于VPT的向量load/store指令。和ISA3.2不同的是，ISA4.0的TAR寄存器为 64bit。TAR寄存器的特性包含如下：
  - 数量：32 * VPT_NUM
  - 位宽：64bit
- 在ISA4.0中，对访问TAR的指令均去除分组限制，每个TAR寄存器使用5bit寻址，指令包括如下
  - `TARADD`
  - `TVLDOA.reg`
  - `TVLDOA`
  - `TVSTOA.reg`
  - `TVSTOA`
  - `TVSTOA_EXT.reg`
  - `TVSTOA_EXT`
  - `VLDI_TAR.T0`
  - `VLDI_TAR.T1`
  - `VLDI_TAR.dual`
  - MOVTAR.T0, MOVTAR.T1, MOVTAR.DUAL
  - MOVSR2TAR.EXT / MOVTAR2SR.EXT
  - TST/TLD (只使用VPT0的TAR资源)

```text
typedef int64_t tar_t;
tar_t   tar[VPT_NUM][TAR_NUM];         //tar[2][32]
```

### 6.1.4. Accumulation Register File(VACC)

VACC寄存器是ISA4.0上的主要1D向量寄存器。它支持作为1D的MOP系列指令的输入操作数和输出操作数，以及GEMM系列算指令的输入操作数和输出操作数。

ISA4.0中，VACC的寄存器编码规则和寻址方式详见VACC Indirect Addressing章节。

- 注意：本ISA Spec中会使用关于DACC/QACC/OACC的简称，其中DACC表示连续两个VACC；QACC表示连续4个VACC，OACC表示连续 8个VACC。
为了便于微架构支持高吞吐率的混精运算和maskbit的运算，VACC寄存器中32bit元素按照线性排列，而8bit、16bit和64bit元素则不按照线性顺序排列。VACC中的数据排列规则如下：

![Figure 1](libra_sip_isa__figure_001.png)

- 对于INT32/UINT32/FP32而言，数据在512bit的VACC中顺序排列
- 对于8bit和16bit的数据而言，数据在VACC中总是交替排列
- 对于64bit的数据而言，无论src还是dst最低寄存器位宽为DACC，而非VACC
- 在使用下述指令读/写VACC时，指令中会要求申明数据位宽，并自动对8bit和16bit的数据进行线性排列和交替排列的排列转换，使得软件使用无感
  - `MOVR2VA.mode2`
  - `MOVVA2R.mode2`
- ISA4.0中添加了下述指令，支持对8bit/16bit/64bit的数据进行线性排列和交替排列的排列转换，使得软件使用无感
  - `VLDOA`
  - `VSTOA`
  - `TVLDOA`
  - `TVSTOA`
  - `TVLDOA.reg`
  - `TVSTOA.reg`
  - `TVSTOA_EXT.reg`
  - `TVSTOA_EXT`
  - VLDEOA VSTEOA
  - `MLI_VLDXOA`
  - `MLI_VSTXOA`
  - `MLI_VLDXI32OA`
  - `MLI_VSTXI32OA`
  - `REDV.ADD`
  - `REDV.MAX`
  - `REDV.MAXNUM`
- 在位宽不变的Element-wise运算过程中，不同VACC/OACC中相同逻辑索引的元素两两运算。因此不需要为交替排列付出额外的操作
- 在变宽运算操作，比如位宽不同的格式转换，以及混合精度指令中，硬件会自动根据输入和输入操作数的宽度，从正确位置获取逻辑索引相同的元素进行操作，然后根据结果位宽写回VACC中对应的位置。不需要额外的操作来维护交替排列
- 对VACC寄存器做save & restore (register spill)时，建议均使用int32模式下的VSTOA和VLDOA
  - 其实register spill的时候，选择8bit、16bit、32bit还是64bit数据宽度是无所谓的，只要保证store和load的时候，指令指定的数据宽度一致就可以了
  - ISA4.0中新定义了VSTOA指令，和VLDOA指令配合进行VACC spill操作
- 如果要进行强制位宽转换的运算（bitcast），比如int8格式下elemnt0~3按照little-endian作为一个int32使用，那么必须使用M-slot的 REMAPVA指令，进行格式转换
- 对于新添加的VACC完整寄存器移位类指令，需要将8bit/16bit/64bit使用REMAPVA指令将数据统一到32bit数据，再执行对应的移位
和其他非32bit的数据格式类似，maskbit在VA中并非linear排列。其mapping如下图所示：

![Figure 2](libra_sip_isa__figure_002.png)

在上图中，橙色部分为64bit结果回写使用的bit；橙色+绿色部分为32bit结果回写时所使用的bit，橙色+绿色+蓝色为16bit结果回写时所用 bit；橙+蓝+绿+淡紫为8bit结果回写时所用的bit。

由于实际使用中，单个指令可用/可产生的maskbit可能不满足512bit。在ISA4.0中，产生maskbit的结果总是回写VACC寄存器，而非ISA3.2 中的QACC寄存器中的i的一个VACC寄存器。如果回写的maskbit不满足512bit，则剩余bit全部填0。

在正常运算时，无论时maskbit产生指令还是条件写回指令，硬件都保障用正确的maskbit对应相同index src/dst数据。因此正常情况下软件使用无感。但是如果要做bitcast操作，同样需要对maskbit的VA使用REMAPVA指令操作，才能将maskbit的bit index变换为 8bit/16bit/32bit/64bit数据的存放方式。

### 6.1.5. Special Purpose Registers(SPR)

关于ISA4.0相关的SPR寄存器，详见Libra SIP SPR Spec

## 6.2. Control Status Register(CSR)

Control Status Register(CSR)在Crystal Instruction系列指令集中，是一类IO地址空间寄存器，需要通过load/store指令进行访问。这与 RISC-V的CSR不同。因此CSR不被归类为L0寄存器。

CSR寄存器主要服务于SIP的处理器状态，launch控制以及外围相关模块的控制。和ISA没有直接关联。

关于CSR的详细定义，请见Libra SIP CSR Spec

## 6.3. Multiple Vector Pipeline Threads(VPT)

ISA4.0从ISA3.2继承了支持多个VPT的结构。该架构特点在ISA4.0中特性如下：

- 所有的L1 memory和标量寄存器均被所有VPT所共享
- 所有的向量相关的寄存器都是每个VPT独立的
  - 每个VPT均包含独立的TAR/VACC寄存器
  - 向量寄存器的最基本单位是512bit
    - VACC寄存器宽度为512bit
    - 对于8bit/16bit/32bit操作数，单个VPT的VACC支持64/32/16个datalane
    - 对于64bit操作数，不支持VACC的存储。必须使用DACC/QACC/OACC存储。单个VPT中OACC可以支持64个64bit的datalane
- M-slot/V-slot上的向量/运算指令，以及VLDST类指令，均是一条指令驱动所有VPT上的寄存器进行运算，获得每个VPT上的运算结果
  - 所有VLDST/MALU指令都是基于单个VPT视角看的。并且对应的操作均为单个或者若干个512bit向量
    - 因此，除了显示声明，本文档均为单个VPT的视角进行指令定义
    - VLDST类型的指令会声明每个VPT上的地址计算规则
  - 每个VPT均只能操作自己独立的向量/矩阵操作寄存器来完成向量相关指令
  - 每个VPT可以拥有自己独立的TAR寄存器，可以使用TAR来进行memory的向量和矩阵的load/store操作。
  - 每个VPT也可以使用共享的SR寄存器作为地址进行向量和矩阵的load/store操作
    - 此时多个VPT之间，地址存在一定的规律
  - 每个VPT的地址访问，类似于软件线程独立。硬件不保证同一个软件线程下不同VPT之间的memory读写顺序。
- SR/SCC/SPR均被所有的VPT所共享
- 任意VPT之间，均没有之间的数据交换的指令或者通路。VPT之间的数据交换，必须使用共享的memory空间或者SR寄存器。
ISA4.0中对于新增指令/特性对于VPT的影响如下：

- 双VPT是一个引发复杂度的特性。目前只考虑为ISA4.0对ISA3.2的兼容作用。预期双VPT在下一代ISA中被舍弃。
  - 建议ISA4.0上新开发的算子不要使用双VPT场景
- SIP4.0 Arch Spec定义三种Software Thread Type：Type0/Type1/Type3为软件显式区分并且保证它们的指令使用情况。只有Type3支持配置VPT数量为2。此部分请参考Arch Spec对应描述。
Libra ISA中指令支持VPT情况：

- 情况一：指令不支持双VPT语义
  - case A：
    - 指令不涉及Per VPT的TAR和VACC资源，天然不支持双VPT语义，不受TCTL的影响。
    - 这类指令包括：
      - SALU全部指令
      - CTRL全部指令
      - 除TLD/TST外的SLDST指令
  - case B：
    - 指令中存在VACC/TAR资源，但由于指令语义、指令实现、兼容性问题等因素，不支持多VPT语义，不受TCTL影响，在任何 Software Thread Type下都固定执行且固定使用VPT0的资源。
    - 这类指令包括：
      - MRADIX_W_BASE /MRADIX_R_BASE/ MSORT_CNTBASE/MSORT_OFFSET/MSORT_STXOA
      - `TLD/TST`
- 情况二：支持双VPT语义，通过TCTL以及指令域静态选择执行哪个VPT
  - 多为TAR/VACC与SR交互的指令，详见具体指令描述
- 情况三：支持双VPT语义，通过TCTL控制执行哪个VPT

```text
情况             Encoding Excel BU列标记  Instructions
不支持双VPT语义  N                        SALU全部指令 SLDST全部指令 CTRL全部指令 MLI_GEMM系列指令：MLI_GEMM Sorting相关指令：MRADIX_W_BASE /MRADIX_R_BASE/MSORT_CNTBASE/MSORT_OFFSET/MSORT_STXOA
```

```text
情况                                  Encoding Excel BU列标记  Instructions
支持双VPT语义通过TCTL以及指令域静态选择执行哪个VPT  Y-ISA                    VLDI_TAR.T0 VLDI_TAR.T1 VLDI_TAR.DUAL MOVSR2TAR.EXT MOVTAR2SR.EXT MOVR2VA.mode2 MOVVA2R.mode2 VLDI_MB MOVSR2MB VSET_MB // 也支持通过TCTL以及Rs1动态选择执行哪个VPT VSETI_MB MOVTAR.T0 MOVTAR.T1 MOVTAR.DUAL POPC_MB AGGR_MB FIRST_MB
支持双VPT语义通过TCTL控制执行哪个 VPT  Y-TCTL                   除上述指令外的VMOV/VLDST/MALU指令
```

L0 register对于VPT的共享和独立寄存器定义如下

```text
cc_t    scc;
sr_t    sr[SR_NUM];
va_t    va[VPT_NUM][VA_NUM];
tar_t   tar[VPT_NUM][TAR_NUM];
```

## 6.4. Register & Architecture Develop via ISA Versions

从ISA3.2，到ISA4.0，以及到将来可能的ISA5.0，上述寄存器和架构概念预期的演进路线如下：

- SR寄存器
  - 扩展为64bit之后，数量可能保持32个或者增长为64个。另外预期支持标量浮点运算
- TAR寄存器
  - 希望TAR能够被compiler作为向量/矩阵变量load/store的基地址寄存器和offset寄存器，缓解SR寄存器数量和SALU的相对不足
  - 未来TAR寄存器可能作为常见SALU指令的目的寄存器（但是不作为SALU的源寄存器），某种程度上作为SR32~SR63使用
- VACC寄存器
  - VACC寄存器将作为所有vector和matrix相关指令的源寄存器和目标寄存器
  - VACC寄存器数量预期从ISA4.0开始保持一定程度的数量稳定，并且所有VACC寄存器都将采用基于VAB的相对寻址，以实现单个硬件线程上多软件线程编程
- SPR寄存器
  - SPR寄存器数量将会保持256个不变
  - SPR寄存器中一部分将随着架构演进而变化功能/语义
- `VPT`
  - 向量/矩阵指令的2个VPT概念将会逐渐弃用
  - ISA4.0中将作为2VPT->1VPT的概念过渡版本。预期ISA5.0中不再使用2VPT，均保持为单个VPT或者无VPT
  - 预期Libra SIP新开发算子中，运算线程均保持单个VPT，而supervisor或者纯标量线程使用无VPT设置

# 7. Instruction Slot and Package

## 7.1. Instruction Type

ISA4.0支持下列类型的指令：

```text
Instruction Type  Description
CTRL              Program control instructions
SALU              32-bit Scalar integer ALU instructions
VALU              Only v.nop remained
MALU              Matrix ALU operation for data format UINT8/INT8/UINT16/INT16/UINT32/INT32/BF16/FP16/FP32
SLDST             32-bit/16-bit/8-bit Scalar load/store instruction
VLDST             Vector load/store instructions
VMOV              Instruction to switch values between scalar registers<->vector registers, vector registers<->vector registers,or imm->vector registers
```

## 7.2. Instruction Slot

Crystal Instruction VLIW package uses 128-bit instruction package, presented as inst_p[127:0] in below description. Besides, it has MLI instruction added in ISA4.0

- If C-slot is MLI_HINT, instruction package is in MLI format: one MLI-slot
  - MLI instructions are always and only packages with C-slot MLI_HINT or MLI_HINT_GEMM Vice versa
- Else if inst_p[80]=0, instruction package is in 5-issue format: C + S1 + S0 + M + V
- Otherwise it is in 4-issue format: C + L + M + V

```text
128-bit
16-bit
16-bit
16-bit
48-bit
32-bit
```

| C slot | L slot |  | M slot | V slot |
| --- | --- | --- | --- | --- |
| C slot | S1 slot | S0 slot | M slot | V slot |
| MLI_HINT | Reserved |  | MLI slot | Reserved |

Each instruction slot supports instructions selectively from different types to facilitate construction of data processing pipeline. Detailed instruction assignment for each slot is defined in instruction description section.

```text
Slot  Major Instruction Usage               Instruction bits
C     integer scalar ALU (not including multiplication), scalar load/store, program control, vector store  inst_p[127:112]
S0    integer scalar ALU, vector load/store  inst_p[95:80]
S1    integer scalar ALU, vector load       inst_p[111:96]
L     integer scalar ALU (including multiplication), program control, scalar and vector load/store  inst_p[111:80]
M     MALU and some vector load/store instructions  inst_p[79:32]
V     Some vector load/store instructions   inst_p[31:0]
MLI   CISC 2D instructions/Matrix LDST instructions/64-bit offset Scatter-Gather LDST instructions  inst_p[79:32]
```

## 7.3. Data Flow Processing Pipeline

This is an informative section, do not refer this section as spec.

SIP VLIW instruction slots and package are designed to support common AI data flow processing pipeline. Below is 5 example use case types.

```text
VLDOA
MOP serial
VSTOA
```

ISA4.0

| Use case | Pipeline sketch | Notes |
| --- | --- | --- |
| MEM -> 1D -> MEM | L1/L2/L3 -> `VLDOA` -> `MOP serial`/MALU -> `VSTOA` -> L1/L2/L3 | Typical 1D data path. |
| MEM -> 2D -> MEM | LHS Cache/RHS Cache -> `GEMM`/MLI 2D path -> VA/VACC -> memory | Typical 2D data path. |
| MEM -> 2D -> 1D -> MEM | LHS Cache/RHS Cache -> `GEMM` -> MALU/MOP serial -> `VSTOA` -> memory | 2D and 1D stages can work in parallel. |

So the typical use case of instruction slots is as below

          - 128- bit
        - `16-bit`
          - 16-bit 16-bit 48-bit 32-bit

| C | L | M | V |
| --- | --- | --- | --- |
| MLI_HINT | Reserved | MLI GEMM | Reserved |
| Scalar Control | VLD OA | MOP serial instruction | VST OA |
| Scalar Control | SALU | VLD OA | VST OA |

  - `ISA4.0`
- MALU 2D
  - `ISA4.0`
- MALU 1D
  - `ISA4.0`
- `VALD/ST+SALU`
ISA4.0中2D运算方法，是直接使用一个MLI指令进行运算，除了C-slot的MLI_HINT/MLI_HINT_GEMM外不和其他指令进行打包。这和ISA3.2 的运算方法不同。

ISA4.0的1D预期运算场景，是L-slot执行一个OACC的load，M-slot执行一个MOP系列的运算指令，然后V-slot执行一个OACC的store指令。 或者是L-slot执行一个SALU指令进行地址计算，M-slot和V-slot各执行一个VLDOA和VSTOA的指令进行内存访问。

```text
{//ISA4.0指令包，GEMM运算模式
    C.MOVSR2SPR MFL_NEXT, SR0
    S0.TVLDD VR0, TAR_pos[0][1]
    MLI_GEMM OACC
}
{//ISA4.0指令包，OA读，OA运算和OA写回
    C.MOVSR2SPR MFL_NEXT, SR0
    L.VLDOA.imm1 OACC1, [SR1]
    M.MOP.ADD.fp32.qa.vm OACC4, OACC3, OACC2
    V.VSTOA.imm1 OACC10, [SR2]
}
{//ISA4.0指令包，地址计算，QA读和DA写回
    C.MOVSR2SPR MFL_NEXT, SR0
    L.ADDI_SFT SR1, SR1, 10
    M.VLDQA.imm1 OACC1, [SR1]
    V.VSTQA.imm1 OACC10, [SR2]
}
```

## 7.4. Instruction Slot Assignment

Detailed instruction list and per instruction's slot assignment is as below. Some instructions can be placed in more than 1 slot.

Please check [Crystal Instruction 4.0][2]

## 7.5. Instruction Packaging Constraint

As an VLIW architecture, unless specifically described and allowed for a resource, SW and tool chain needs to avoid certain hazards between different instruction slots inside same instruction package.

Please refer to Appendix B: Instruction Packaging Constraint for details.

# 8. Instruction Description

## 8.1. Common Convention

本ISA指令定义中，对于大部分指令有一些通用的设计规则。本章节将逐一介绍这些通用规则。

### 8.1.1. VACC Indirect Addressing

#### 8.1.1.1. VACC 间接寻址规则

ISA4.0中，指令对于VACC寄存器访问均为间接访问。寻址方式为：由指令编码中的VACC域累加一个来自于SPR的VAB寄存器，然后将加法结果的低13bit作为实际物理线程中VACC寄存器的index。这个加法操作是一个unsigned加法操作。

一共有2个SPR用于记录VAB的寄存器，分别为VAB_VPT0、VAB_VPT1。指令描述中VACC寄存器地址1/2/4/8VACC对齐关系的要求，是对于间接访问指令中VACC index加法结果而言的，而非单独VA index或者VAB部分的要求。

VAB在ISA4.0中有两种用途：

- 更好管理和使用VACC/OACC寄存器
- 在一个硬件线程上，划分物理VACC寄存器给多个软件线程
编程模型和架构设计需要保证VAB的修改不会出现跨软件线程错误访问物理上VACC寄存器的状态。

指令槽与VAB_VPT0的对应关系：

- 仅支持单VPT语义的指令，以及非兼容算子所用指令，所有指令槽都使用VAB_VPT0
- 兼容模式下，VAB_VPT0, VAB_VPT1分别给两个VPT下的所有指令槽使用
目前VACC寄存器访问的情况包括如下三种：

# 1. 指令中包括10bit VACC域，间接访问VACC寄存器

  - VACC的index计算如下：
    - VACC_index = VAB_VPT* + {3'b0, VACC[9:0]}。
  - 可以访问的VACC：
    - 以VAB起始的1K个VACC区间
    - 当索引的VACC index超过物理VACC资源时，硬件行为Undefine。
  - 所有这类指令列表：
    - `VLDI_LO.VA`
    - `VLDI_HI.VA`
    - `MOVSFT_VA`
    - `MOVSFTC_VA`
    - `MOVSFTI_VA`
    - `MOVVA`
    - `REMAPVA`
    - 指令任意操作数为Maskbit寄存器的指令
      - VSET_MB / VSETI_MB
      - `MOP.MIOTA`
        - 输入maskbit寄存器为VACC索引，输出寄存器为OACC索引
      - MOP.CADD / MOP.CSUB / MOP.CMUL / MOP.CSLL / MOP.CSLLI / MOP.MSEQ / MOP.MSNE / MOP.MSLT / MOP.MSLE / MOP.MSGE / MOP.MSGT
        - 这类指令输出maskbit寄存器为VACC索引，输入寄存器是10bitOACC索引
      - MOP.MSBF / MOP.MSIF / MOP.MSOF / MOP.MAND / MOP.MOR / MOP.MXOR / MOP.MANDN / MOP.MORN / MOP.MNAND / MOP.MNOR / MOP.MXNOR
      - POPC_MB / AGGR_MB / FIRST_MB
      - VLDI_MB/ MOVSR2MB
      - MMERGE/MSELECT_256/MSELECT_128/MSELECT_64

# 2. 指令中包括8bit OACC域，间接访问VACC寄存器

  - VACC的index计算如下：
    - VACC_index = VAB_VPT* + {OACC[7:0], 3'b0}
    - OACC_index = VACC_index >> 3
  - 可以访问的VACC：
    - 以VAB起始的2K个VACC区间
    - 当索引的VACC index超过物理VACC资源时，硬件行为Undefine。
  - 所有这类指令列表：
    - `VLDI_LO.OA`
    - `VLDI_HI.OA`
    - `VLDI_64p0.OA`
    - `VLDI_64p1.OA`
    - `VLDI_64p2.OA`
    - `VLDI_64p3.OA`

# 3. 指令中包含10bit OACC域，间接访问VACC寄存器

  - VACC的index计算如下：
    - VACC_index = VAB_VPT* + {OACC[9:0], 3'b0}
    - OACC_index = VACC_index >> 3
  - 可以访问的VACC：
    - 以VAB起始的8K个VACC区间
    - 当索引的VACC index超过物理VACC资源时，硬件行为Undefine。
  - 所有这类指令列表：
    - 除了上述指令外其他的VA访问指令

#### 8.1.1.2. VACC 间接寻址编码限制

- 限制一：部分指令寄存器不能为VACC0(OACC0)
  - 背景一：SIP4.0架构上，部分指令使用的操作数会超过1个OACC的限制，而架构上预期的执行颗粒度在输入/输出操作数上都各不超过1个OACC。所以这些指令会被拆分为OACC颗粒度进行发射和执行。在使用VACC0作为maskbit进行条件执行时，若目的寄存器同为VACC0或者OACC0，则在该指令在拆分执行时，会覆盖掉作为输入的VACC0。因此这类指令，在vm=0条件下要求目的寄存器不能为VACC0或OACC0（关于maskbit的描述请见后文）
  - 背景二：MLI_GEMM、MSF、REDSUM（Stage=3）这几条指令在计算实现通路上同属于2D类指令。为减少2D通道和其他ALU之间maskbits hazard管理，也要求目的寄存器和源寄存器均不能为VACC0或OACC0
  - 这类指令包括：
    - 以下指令VM域为0时，禁止目的寄存器为VACC0或者OACC0
      - `MOP.XOR_U32MIX`
      - `MOP.MUL_HI`
      - `MOP.WMUL_I64MIX`
      - `MOP.CVT`
      - `MOP.WADD_I32MIX`
      - `MOP.WMULUS_I32MIX`
      - `MOP.WMUL_I32MIX`
      - `MOP.MUL_F32MIX`
      - `MOP.MUL_F16MIX`
      - `MOP.MUL_I32MIX`
      - `MOP.ADD_F32MIX`
      - `MOP.ADD_F16MIX`
      - `MOP.ADD_I32MIX`
      - `MOP.MAC`
      - `MOP.MAS`
      - `MOP.IMAS`
      - `MOP.MAC_F32MIX`
      - `MOP.MAS_F32MIX`
      - `MOP.IMAS_F32MIX`
      - `MOP.MAC_F16MIX`
      - `MOP.MAS_F16MIX`
      - `MOP.IMAS_F16MIX`
      - MOP.FCLASS TVLDOA
      - `TVLDOA.reg`
      - `VLDOA`
      - `VLDEOA`
      - `MLI_VLDXOA`
      - `MLI_VLDXI32OA`
      - `MOP.BCAST`
      - `MRADIX_OFFSET`
      - `MOP.MSBF`
      - `MOP.MSOF`
      - `MOP.MSIF`
      - `MOP.MIOTA`
    - 以下指令禁止目的寄存器和源寄存器都不能为VACC0或者OACC0
      - REDSUM（stage=3）
      - `MSF`
      - `MLI_GEMM`
- 限制二：部分指令的输入寄存器和输出寄存器不能重叠

```text
背景三：SIP4.0架构上，部分指令（例如混精运算指令）使用的操作数会超过1个OACC的限制，而架构上预期的执行颗粒度在输入/输出操作数上都各不超过1个OACC。所以这些指令会被拆分为OACC颗粒度进行发射和执行。如果这些颗粒度之间存在 SRC/DST重叠，执行结果会和一开始的编程期望不一致。因此执行的指令要求输入寄存器和输出寄存器禁止重叠。说明：  架构上，部分指令（例如混精运算指令）使用的操作数会超过1个OACC的限制，而架构上预期的执行颗粒度在输
说明：
```

    - 对于受该限制影响的精度变化类指令，某一操作数会超过1个OACC的限制，要求输入输出操作寄存器完全不能互相覆盖，而非只是限制编码不能相同。
    - MAC类指令的OACCs3d编码属于dst操作数。
    - 如果是src/dst显示定义的操作数，那么需要对齐到OACC来考虑重叠。
      - 输入寄存器和输出寄存器不能重叠的最小颗粒度是OACC而非VACC，因此对于受该限制影响的，且输入或输出寄存器显示编码为VACC index的指令，需要对齐到OACC来考虑重叠。此类指令包括： MOVSFT*/MOP.MS*F/MOP.MIOTA/REMAPVA
    - 如果是按照vm=0读取maskbit，那么写回的时候如果是VACC（并且不是VACC0）的话是合法的，此时可以不用按照OACC考虑
      - 比如 MOP.MSBF这条指令，在vm=0的情况下：VACCs1 是VACC8，VACCd是VACC1 这样是允许的。
  - 受该限制影响的指令如下：
    - `MOP.XOR_U32MIX`
    - `MOP.MUL_HI`
    - `MOP.WMUL_I64MIX`
    - `MOP.CVT`
    - `MOP.WADD_I32MIX`
    - `MOP.WMULUS_I32MIX`
    - `MOP.WMUL_I32MIX`
    - `MOP.MUL_F32MIX`
    - `MOP.MUL_F16MIX`
    - `MOP.MUL_I32MIX`
    - `MOP.ADD_F32MIX`
    - `MOP.ADD_F16MIX`
    - `MOP.ADD_I32MIX`
    - `MOP.MAC`
    - `MOP.MAS`
    - `MOP.IMAS`
    - `MOP.MAC_F32MIX`
    - `MOP.MAS_F32MIX`
    - `MOP.IMAS_F32MIX`
    - `MOP.MAC_F16MIX`
    - `MOP.MAS_F16MIX`
    - MOP.IMAS_F16MIX MLI_VLDXOA
    - `MLI_VLDXI32OA`
    - `MOP.FCLASS`
    - `MSF`
    - `MOP.BCAST`
    - REDMAX (stage=3)
    - REDMIN (stage=3)
    - REDSUM (stage=3)
    - `MRADIX_OFFSET`
    - `MOVSFTC_VA`
    - `MOVSFT_VA`
    - `MOVSFTI_VA`
    - `MOP.MSBF`
    - `MOP.MSOF`
    - `MOP.MSIF`
    - `MOP.MIOTA`
    - `REMAPVA`

### 8.1.2. Predicate Register Based Condition Execution

ISA4.0 将Predicate Register进行简化，指令域中CCE, VCE, MCE, LCE均视作0，即指令不根据Predicate Register状态执行。

### 8.1.3. Condition Code Based Condition Execution

#### 8.1.3.1. Condition Code

Scalar Condition Code registers are written by some SALU type instructions and may impact following SALU type instructions' execution if the latter ones are conditional execution instructions. One set of condition code in SIP includes below 2 bits:

# 1. Carry bit: set by integer algorithm operations

# 2. Compare bit: set by data comparison instructions

# 3. Carry bit and Compare bit are updated independently

# 4. If an instruction is a conditional execution instruction and had been canceled due to the condition code, this instruction

- becomes a no-op instruction and its write to condition code (if it has) will also become a no-op
SIP totally support below condition code sets:

- Scalar Condition Code (SCC), one set for all SALU related instructions, Only C and L slot SALU instructions will update SCC.

| Instruction Type | Flag Type |
| --- | --- |
| SALU | SCC.Carry |
| SALU | SCC.Compare |

How carry and compare bits are written is defined in Instruction Result Flag.

#### 8.1.3.2. Condition Code Predefined Scenarios

CC flags are written in ALU related instructions. Below conditions are commonly used in integer instruction’s flag calculation, thus firstly define them as condition A and condition B, then it will be referenced in flag setting condition definition.

##### 8.1.3.2.1. Condition A

For operation with unsigned integer result (including TRSI2I), if any of below case is true

- For sub operation A-B, A<B
- For non-sub operation, if the precision-unbounded result exceeds the data format range which the destination format can represent

##### 8.1.3.2.2. Condition B

For operation with signed integer result (including TRSI2I),

- If the precision-unbounded result exceeds the data format range which the destination format can represent

##### 8.1.3.2.3. Condition C

For VTRSF2I or (VTRSI2I && Clamp==FALSE)

- If source data exceeds the data format range which the destination format can represent

##### 8.1.3.2.4. Condition D

For operation with unsigned integer result, if below case is true

- For SLL or SLLI, during shifting, if there is any bit of 1s being shifting out from MSB

#### 8.1.3.3. Condition Code Update Rule

| FU | Flag Type | Setting Condition |
| --- | --- | --- |
| SALU | SCC.Carry | (Condition A \|\| Condition B) && Clamp is FALSE \|\| Condition_D |
| SALU | SCC.Compare | Follow instruction definition: indicate whether opr0==opr1 or opr0 < opr1 |

### 8.1.4. MALU Maskbit

为了增强M-slot中高throughput的element-wise指令的功能完备性，在VA寄存器中引入了maskbit这种数据格式。该数据格式的编码和使用参考了RISC-V Vector Extension。

- Maskbit作为输入时：
  - 作为条件回写的输入时，maskbit总是来源于寄存器VACC0，对应使用VAB_VPT* + 0。因此条件写回指令中无需该寄存器的编码，只要VM为0就固定输入。
  - 对于支持条件写回运算的指令，最大的单个指令输出8个VA的结果，最小输出1个VA。而运算的结果包括8bit/16bit/32bit/64bit四种。因此单个指令中使用16~512个maskbit。无论条件写回指令使用多少个maskbit或者src寄存器的index数值如何变化，总是从 maskbit0开始使用。
    - 即vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64*(2^(3-dwidth)))个bit作为写回条件。
  - 大部分Element-Wise操作的指令，比如1D VLDST指令、大部分MALU指令、以及VMOV中MOVOA指令支持Maskbit作为输入影响条件回写。当这些指令中的VM域为0时，每个写回VA寄存器的元素都需要参考VA0寄存器中对应的maskbit。如果该maskbit为 0，则不写回；否则元素写回。当VM域为1时，这些指令的结果总是写回。即这些指令中，结果element[i]的写回条件为 (vm == 1 || (vm==0 && maskbit(i) == 1))。
  - 特别的，以下五条指令并非Element-wise操作指令，也存在vm域，支持maskbit作为输入。
    - FIRST_MB、MOP.MIOTA、MOP.MSBF、MOP.MSIF、MOP.MSOF
- Maskbit作为输出时：：
  - 在ISA4.0中，产生maskbit的指令可以写回任意一个VACC寄存器，而非ISA3.2中必须写回index作为4对齐的VACC寄存器。这是为了避免ISA4.0中指令内编码的VACC空间减少而导致的寄存器空间浪费。
  - Maskbit的产生是由M-slot/L-slot专用指令生成，并且包括以下六类：
    - 第一、二种指令类型是基于8bit/16bit/32bit/64bit元素运算产生Maskbit；
    - 第三种指令类型是两个maskbit之间的bit逻辑运算，包括与、或、异或等8种产生Maskbit。
    - 第四种指令类型是利用SR或者立即数产生maskbit。
    - 第五种指令类型是根据Src Maskbit寄存器设置Dst Maskbit寄存器。
    - 第六种指令类型是Maskbit Merge和Select类指令。
  - 注意：除第五种Maskbit设置指令（MOP.MSBF、MOP.MSIF、MOP.MSOF）之外，其他产生maskbit的指令均不支持条件写回。
    - MOP.MSBF、MOP.MSIF、MOP.MSOF指令支持根据VACC[0+VAB_VPT*]中maskbit的前(64*(2^(3-dwidth)))个bit条件回写，注意这三条指令回写VACCd时，[(64*(2^(3-dwidth))):511]bit位回写为0。
  - 由于maskbit产生指令的bit数在部分情况下会小于一个VA。出于简化设计考虑，VA中超过本次运算结果写回bit的部分，全部填 0。例如一个MOP.MSEQ指令比较了一个OA的128个32bit数据，并写回DST，那么超过maskbit128的位全部回写为0。

| 指令类型 | 指令槽 | dst index约束 | src index约束 |
| --- | --- | --- | --- |
| 运算进位/溢出，例如MOP.CADD | M-slot | VACC | 无 |

```text
指令类型                              指令槽         dst index约束  src index约束
比较指令，例如MOP.MSEQ                M-slot         VACC           无
Maskbit专用逻辑运算，例如MOP.MAND     M-slot         VACC           VACC
Maskbit初始化指令，例如VSET_MB        M-slot/L-slot  VACC           无
Maskbit设置指令，包括MOP.MSBF、MOP.MSIF、MOP.MSOF  M-slot         VACC           VACC
Maskbit Merge Select指令，包括MMERGE、MSELECT_256、MSELECT_128、MSELECT_64  M-slot         VACC           VACC
```

对于Maskbit专用逻辑运算，满足maskbit产生16种不同二进制输出的真值表

![Figure 3](libra_sip_isa__figure_003.png)

### 8.1.5. VL (new in 4.0)

在ISA4.0中，还额外引入了VL寄存器，用于更好的支持VACC/DACC/QACC寄存器相关的动态性。VL借鉴自RISC-V Vector Extension(RVV)中的VL，是一个SPR寄存器。它的功能表述为：

- 当一个VACC/DACC/QACC相关的vector load/vector store/malu calc指令在执行时，根据VL数值将结果划分为body部分和tail部分
  - 其中datalane index小于VL数值的元素属于body部分，datalane index大于等于VL数值的元素属于tail部分
- 只有body部分的datalane结果可以正常写回dst
- 对tail部分的处理如下：
  - 对于tail部分的结果，软件应当保持“不关心”，避免对其有数据依赖。
  - 对于受VL影响的vector store指令：tail部分不写回memory
  - 对于受VL影响的vector load指令：回写VACC寄存器时，tail部分对应的datalane保持原值
  - 产生maskbit类的指令，tail部分做agnostic处理。
    - 以下指令tail部分回写0：
      - MOP.CADD、MOP.CSUB、MOP.CMUL、MOP.CSLL、MOP.CSLLI
      - MOP.MSEQ、MOP.MSNE、MOP.MSLT、MOP.MAND、MOP.MOR、MOP.MXOR、MOP.MANDN、MOP.MORN、 MOP.MNAND、MOP.MNOR、MOP.MXNOR、MOP.MSLE、MOP.MSGE、MOP.MSGT
      - MOP.MSIF / MOP.MSBF / MOP.MSOF
  - 除上述指令外对于受VL影响的其他指令：
    - 回写VACC寄存器时，tail对应datalane位置保持原值
    - 部分指令需要回写SR，tail部分对应的datalane不参与运算。
      - `AGGR_MB`
      - `POPC_MB`
      - `FIRST_MB`
      - `MOVVA2R.mode2`
- 如果VL数值大于等于当前指令所有datalane的数值，默认情况下对应的EXCP_VL异常被关闭，按照指令的最大datalane数量执行
  - 如果EXCP_VL异常被打开，则会触发一个exception
  - 注意：EXCP_VL异常在ISA4.0中已经DeFeature
- 和RVV不同，VL并没有引入vstart。因此指令总是从向量寄存器的element0开始执行
- 关于VL寄存器的更新，它只能通过VSETVL系列指令更新
- 除以下场景外，当vl=0的时候，指令不修改Dst寄存器：
  - 对于Load/Store指令中地址自增写回SR/TAR寄存器的指令，VL=0不影响其写回
  - 对于受到VL影响且写回SR的指令，VL=0不影响SR的写回，指令包括：
    - `MOVVA2R.mode2`
    - `POPC_MB`
    - `AGGR_MB`
    - `FIRST_MB`
- 对于ISA3.2兼容模式下的算子（包括双VPT以及一开始双VPT后来动态修改为单VPT情况），VL不起作用。指令的元素格式按照指令语义的最大个数执行。

### 8.1.6. Matrix Description (new in 4.0)

ISA4.0在引入VL寄存器基础上，还引入了matrix description相关的寄存器，主要增加对MLI指令运算指令的动态形状。其中矩阵可以分为两大类：

- 在memory中的矩阵
- 在VACC中的矩阵
对于一个memory中的矩阵，需要下列参数：

```text
Memory矩阵参数名称  含义                           存放位置        有效位宽  补充说明
addr                矩阵第一个元素起始地址         SR              64bit
dim0_max            矩阵水平方向最大数值           指令立即数表达            作为操作数的矩阵水平最大数值
dim1_max            矩阵垂直方向最大数值                                     作为操作数的矩阵垂直最大数值
dim0_real           矩阵实际运算宽度               SPR                       如果这个维度为0，则整个指令不执行如果这个维度不超过dim0_max，则按照dim0_real的数值进行操作，其余元素不操作或者写回0 如果这个维度超过指令在这个维度的最大数值，则按照最大数值执行
dim1_real           矩阵实际运算高度               SPR                       如果这个维度为0，则整个指令不执行如果这个维度不超过dim1_max，则按照dim1_real的数值进行操作，其余元素不操作或者写回0 如果这个维度超过指令在这个维度的最大数值，则按照最大数值执行
dim0_stride         矩阵元素水平间隔，单位element  SPR             32bit     对于GEMM的左支，必须始终为1 对于GEMM的右支，在按行读取时必须为1
dim1_stride         矩阵元素垂直间隔，单位element  SPR             32bit     对于GEMM的右支，在按列读取时必须为1
data type           矩阵元素的数据类型             指令立即数表达
```

对于一个VACC中的矩阵，需要下列参数：

```text
VACC矩阵参数名称  含义                            存放位置        有效位宽  补充说明
addr              矩阵第一个元素起始地址          指令立即数表达  10bit     实际上就是VACC编码
dim0_max          矩阵水平方向最大数值            指令立即数表达            作为操作数的矩阵水平最大数值
dim1_max          矩阵垂直方向最大数值            指令立即数表达            作为操作数的矩阵垂直最大数值
dim0_real         矩阵实际运算宽度                SPR                       如果这个维度为0，则整个指令不执行如果这个维度超过指令在这个维度的最大数值，则按照最大数值执行
dim1_real         矩阵实际运算高度                SPR                       如果这个维度为0，则整个指令不执行如果这个维度超过指令在这个维度的最大数值，则按照最大数值执行
dim0_stride       矩阵元素水平间隔，单位 element  N/A             N/A       VACC矩阵恒定为1
dim1_stride       矩阵元素垂直间隔，单位 VACC     指令立即数表达  2bit      垂直的间隔，总是满足2VA/4VA/8VA其中之一
data type         矩阵元素的数据类型              指令立即数表达
```

规律总结：

- 矩阵的水平尺寸和垂直尺寸，各自分为max size和real size两套
  - max size是指令编码用立即数指定的，用于确定这条指令静态的寄存器分配，以及确定最大运算量
  - real size是SPR指定，用于支持动态形状。它们不应当超过max size。如果一旦超过max size，则按照max size进行操作
- 关于水平和垂直的stride
  - memory矩阵的水平/垂直stride使用SPR指定，单位为element
    - 其中GEMM相关矩阵，stride有限定
  - VACC中的矩阵，水平stride恒定1element，垂直stride则用指令编码指定，等效为2VA/4VA/8VA其中之一
对于指令编码指定的dim0_max/dim1_max/VACC dim1_stride，请见具体的MLI_GEMM系列指令描述，本章节不再赘述。

ISA4.0的SPR中，定义了两组专用寄存器，分别用于MLI_GEMM系列指令左支、MLI_GEMM系列指令右支写回src/dst。这三组寄存器和指令一一对应。

- MLI_GEMM系列指令LHS
- MLI_GEMM系列指令RHS
这些寄存器全部用于描述矩阵在memory中的排布。每组寄存器包含如下：

```text
参数名称     说明                            存放位置  说明
dim0_real    矩阵实际运算宽度                SPR       如果这个维度为0，则整个指令不执行如果这个维度超过指令在这个维度的最大数值，则按照最大数值执行
dim1_real    矩阵实际运算高度                SPR       如果这个维度为0，则整个指令不执行如果这个维度超过指令在这个维度的最大数值，则按照最大数值执行
dim0_stride  矩阵元素水平间隔，单位 element  SPR       对于GEMM的左支，必须始终为1 对于GEMM的右支，在按行读取时必须为1
dim1_stride  矩阵元素垂直间隔，单位 element  SPR       对于GEMM的右支，在按列读取时必须为1
```

对于MLI_GEMM系列指令运算，左支和右支矩阵超过dim_real部分，则指令自动填充为0；对于2D结果回写超过RHS.dim0_real部分，寄存器结果保持不变；对于2D结果回写超过LHS.dim1_real的部分，寄存器结果保持不变。

支持Matrtix Description的指令在ISA4.0中不会同时支持maskbit。 注意：EXCP_REAL_SIZE异常在ISA4.0中已经DeFeature

### 8.1.7. Common MALU Data Type

MALU type instructions can operate in data lanes with many data types. Those types are specified by dwidth and dtype fields in instruction which follows below type definition.

If any instruction's data type uses these 2 fields and follows below data type definition, then its instruction section will specify that dwidth and dtype field specifies data type in the operation which is defined in Common MALU Data Type" or something similar; otherwise that instruction would explicitly specify its own data type definition.

The combination of dwidth and dtype can cover many data types. It is also possible that one instruction follows below type definition while only supports its subset, then its description section will explicitly point out.

| dtype | UINT |
| --- | --- |
| 0 | UINT |
| 1 | SINT |
| 2 | FP/FP8 E4M3 |
| 3 | BF/FP8 E5M2 |

| dwidth | dtype |
| --- | --- |
| 0 | 8-bit |
| 1 | 16-bit |
| 2 | 32-bit |
| 3 | 64-bit |

Legal Input

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| FP8_E4M3 | dtype == 2 && dwidth == 0 |
| FP8_E5M2 | dtype == 3 && dwidth == 0 |
| FP64 | dtype == 2 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

The maskbit data type is not indicated by dtype or dwidth. It is indicated by instruction operation itself.

FP64/FP8 E4M3/ FP8 E5M2/UINT64/INT64 为ISA4.0新增数据格式。

### 8.1.8. Element Wise Operation in VACC

There are element-wise operation instructions in MALU types and data source/destination are in VACC.

In case of VACC, total element number in that operation is specified by instruction (can be 16/32/64 for a thread) while the data element width is always 32-bit.

As data elements in element-wise operation are independent, so if not explicitly specified, the ALU operation applies to every data lane in that VACC operand, below is an example

- VACCd += VACCs1 * VACCs2; // element basis multiplication then accumulation
- VACCd = VACCs1 * VACCs2; // element basis multiplication
- VACCd += VACCs1 * VACCs2; // element basis multiplication then accumulation
对于VACC中的数据运算，包括MAC类指令、混精乘法/加法指令和MOP.CVT指令，均会存在源操作数/目标操作数位宽不同而导致的跨越 datalane的场景。VACC对于8bit/16bit/64bit数据格式存在交替排列（请见VACC Data Element Mapping），而跨datalane的运算指令会自动将运算元素按照逻辑index对齐，并放入到VACC mapping的对应位置。

VACC指令中执行MOVSFT类指令时，需要通过REMAPVA指令将格式强制转换为32bit的数据排列，进行shifting，然后再反变换回去

### 8.1.9. Floatpoint Support

#### 8.1.9.1. General Support

ISA4.0中，对于浮点运算，vector MALU指令支持BF16/FP16/FP32/FP64的浮点格式，以及少量FP8的格式转换运算；2D浮点运算支持 FP8/BF16/FP16/FP32/EF32输入格式（但是2D运算的输出始终为FP32格式）。

ISA4.0浮点vector运算，对于FP64/FP32/FP16/BF16的运算规则，兼容IEEE754-2019标准以及其规则外延。下列章节中将描述对于非标的 FP8格式和运算规则、标准浮点指令的舍入模式支持、denormalflush支持、浮点异常处理和NaN处理

#### 8.1.9.2. FP8 E4M3 & E5M2 (new in 4.0)

ISA4.0支持的FP8数据格式分为两类：E4M3和E5M2。

##### 8.1.9.2.1. E4M3

由于编码空间的限制，E4M3为非IEEE754的扩展编码表达。其中

- sign bit：bit7，共1bit
- exponent bit：bit6-bit3，共4bit
  - normal value时，其bias为7
- mantissa bit：bit2-bit0，共3bit
其数据表达如下如下：

| Exponent | Mantissa | Value |
| --- | --- | --- |
| 0x0 | 0x0 | +0 or -0 |
| 0x0 | 0x1~0x7 | (-1)^(sign_bit) x 2^-6 x (0.mantissa) |
| 0x1~0xE | 0x0~0x7 | (-1)^(sign_bit) x 2^(exponent-7) x (1.mantissa) |
| 0xF | 0x0~0x6 | (-1)^(sign_bit) x 2^(exponent-7) x (1.mantissa) |
| 0xF | 0x7 | NaN |

和其他格式不同，E4M3没有INF编码，NaN编码也只有1个(在ISA4.0中视作QNaN)。对于结果为FP8的运算，一旦舍入后数值超过其表达范围，则根据指令中的clamp模式，选择保留最大可表达数值或者变成NaN。请见MOP.CVT指令具体描述。

E4M3数值表达范围：

- 最大正常数值：abs(S.1111.110) = 448
- 最小正常数值：abs(S.0001.000) = 2^-6
- 最大denormal数值：abs(S.0000.111) = 0.875 x 2^-6
- 最小denormal数值：abs(S.0000.001) = 2^-9
在dwidth+dtype表达中，FP8 E4M3的表达为

- dwidth=0 dtype=2

##### 8.1.9.2.2. E5M2

E5M2为IEEE754的扩展编码表达。其中

- sign bit：bit7，共1bit
- exponent bit：bit6-bit2，共5bit
  - normal value时，其bias为15
- mantissa bit：bit1-bit0，共2bit
其数据表达如下如下：

| Exponent | Mantissa | Value |
| --- | --- | --- |
| 0x0 | 0x0 | +0 or -0 |
| 0x0 | 0x1~0x3 | (-1)^(sign_bit) x 2^-14 x (0.mantissa) |
| 0x1~0x1E | 0x0~0x3 | (-1)^(sign_bit) x 2^(exponent-15) x (1.mantissa) |
| 0x1F | 0x0 | +INF or -INF |
| 0x1F | 0x1~0x3 | NaN |

E5M2有INF和NaN编码表示。它的运算规则符合IEEE754的扩展

E5M2数值表达范围：

- 最大正常数值：abs(S.11110.11) = 57344
- 最小正常数值：abs(S.00001.00) = 2^-14
- 最大denormal数值：abs(S.00000.11) = 0.75 x 2^-14
- 最小denormal数值：abs(S.00000.01) = 2^-16
在dwidth+dtype表达中，FP8 E5M2的表达为

- dwidth=0
- dtype=3

#### 8.1.9.3. Denormal Flush (updated in 4.0)

Denormal flush是指MALU中，对于输入/输出的浮点数值格式，检查是否为非规格化浮点数，并根据SPR MODE_WRK寄存器配置情况需求将数值转换为0。Denormal flush分为input denormal flush和output denormal flush两种，而根据FP32/FP16/BF16四种数据格式，一共可以分为6种不同的情况。不同的指令根据需求支持input flush/output flush其中一种或者同时支持两种。

Denormal flush由SPR MODE_WRK寄存器的denormal域控制。请注意，Scalar浮点指令不受MODE_WRK的denormal域影响。

- MODE_WRK[9:8]控制FP16的denormal flush
  - 数值0：不做denormal flush
  - 数值1：只对output做denormal flush
  - 数值2：只对input做denormal flush
  - 数值3：对input和output均做denormal flush
- MODD_WRK[11:10]控制FP32的denormal flush
  - 数值0：不做denormal flush
  - 数值1：只对output做denormal flush
  - 数值2：只对input做denormal flush
  - 数值3：对input和output均做denormal flush
- MODE_WRK[13:12]控制BF16的denormal flush
  - 数值0：不做denormal flush
  - 数值1：只对output做denormal flush
  - 数值2：只对input做denormal flush
  - 数值3：对input和output均做denormal flush
Denormal flush在ISA3.2上就在VALU/MALU/VLDST指令中存在；但是在ISA4.0中删除了VALU指令，并添加了MOP系列指令对于FP64的支持，因此进行更新

##### 8.1.9.3.1. Denormal Flush for MALU instructin

受到Denormal Flush的影响的MALU指令如下：

| Instruction | input denormal flush support | output denormal flush support |
| --- | --- | --- |
| MOP.ADD | Yes | Yes |
| MOP.SUB | Yes | Yes |
| MOP.MUL | Yes | Yes |
| MOP.SQR | Yes | Yes |
| MOP.ABS | Yes | Yes |
| MOP.NEG | Yes | Yes |
| MOP.MIN | Yes | Yes |
| MOP.MAX | Yes | Yes |
| MOP.ABSMAX | Yes | Yes |
| MOP.MINNUM | Yes | Yes |
| MOP.MAXNUM | Yes | Yes |
| MOP.ABSMAXNUM | Yes | Yes |
| MOP.CVT | Yes | Yes |
| MOP.MSEQ | Yes | No |
| MOP.MSNE | Yes | No |
| MOP.MSLT | Yes | No |
| MOP.MSLE | Yes | No |
| MOP.MSGE | Yes | No |
| MOP.MSGT | Yes | No |
| MOP.MUL_SCL | Yes | Yes |
| MOP.MUL_F32MIX | Yes | Yes |
| MOP.MUL_F16MIX | Yes | Yes |
| MOP.ADD_F32MIX | Yes | Yes |
| MOP.ADD_F16MIX | Yes | Yes |
| MOP.MAC | Yes | Yes |
| MOP.MAS | Yes | Yes |
| MOP.IMAS | Yes | Yes |
| MOP.MAC_F32MIX | Yes | Yes |
| MOP.MAS_F32MIX | Yes | Yes |
| MOP.IMAS_F32MIX | Yes | Yes |
| MOP.MAC_F16MIX | Yes | Yes |
| MOP.MAS_F16MIX | Yes | Yes |
| MOP.IMAS_F16MIX | Yes | Yes |
| MSF | Yes | Yes |
| REDMAX | Yes | Yes |
| REDMIN | Yes | Yes |

| Instruction | input denormal flush support | output denormal flush support |
| --- | --- | --- |
| REDSUM | Yes | Yes |
| MLI_GEMM | Yes | Yes |

##### 8.1.9.3.2. Denormal Flush for VLDST instructin

受到Denormal Flush的影响的VLDST指令如下：

| Instruction | input denormal flush support | output denormal flush support |
| --- | --- | --- |
| TVSTOA_EXT | Yes | Yes |
| TVSTOA_EXT.reg | Yes | Yes |

#### 8.1.9.4. Rounding Mode

##### 8.1.9.4.1. Rounding Mode for MALU Floatpoint

在MALU浮点相关指令（除了MOP.CVT），以及带有运算的VLDST指令，它们的浮点运算的rounding mode受到SPR MODE_WRK寄存器配置的影响。其中FP32/FP16/BF16数据格式各自受到控制。MOP.CVT指令单独通过指令中的编码控制舍入模式。请注意，Scalar浮点指令不受MODE_WRK的rounding域影响。

- MODE_WRK[1:0]控制FP16的rounding mode
  - 数值0：rounding-to-nearest-even(RNE)
  - 数值1：roudning-to-zero(RTZ)
  - 数值2和数值3：Reserved
- MODD_WRK[3:2]控制FP32的rounding mode
  - 数值0：rounding-to-nearest-even(RNE)
  - 数值1：roudning-to-zero(RTZ)
  - 数值2和数值3：Reserved
- MODE_WRK[5:4]控制BF16的rounding mode
  - 数值0：rounding-to-nearest-even(RNE)
  - 数值1：roudning-to-zero(RTZ)
  - 数值2和数值3：Reserved

#### 8.1.9.5. NaN Result

ISA4.0的MALU指令中，所有计算输出为浮点格式的指令(包括TVSTOA_EXT/TVSTOA_EXT.reg)，除了特别说明的指令外，计算结果为NaN 时，固定输出下面的NaN数据：

- FP32：使用0x7FFFFFFF作为统一的NaN输出
- FP16：使用0x7FFF作为统一的NaN输出
- BF16：使用0x7FFF作为统一的NaN输出
- FP8 E4M3：使用0x7F作为统一的NaN输出
- FP8 E5M2：使用0x7F作为统一的NaN输出
对于下述指令，其输出的NaN由指令自身定义，而非上述的固定NaN

- `MOP.GETM`
- `MOP.GETE`
- `MOP.FUSE`

#### 8.1.9.6. Floatpoint Exception

##### 8.1.9.6.1. Exception for MALU Floatpoint

所有MALU浮点运算都不会记录任何异常

### 8.1.10. 64-bit Address Pointer

在ISA4.0中引入了64bit地址指针，其中memory system有效的virtual address地址是bit47~bit0，而bit63~bit48则保留作为寻址的hint使用。高16bit和hint的对应关系如下：

```text
Bit                       63                        62                         61-59                                 58-51                        50-48     47-0
Definition                Constant                  Cachable                   Func Param Qualifier                  Legacy Executable Attribute  Reserved  Real Address
Value(Default Value = 0)  0=NoneContant 1=Constant  0=NoneCachable 1=Cachable  0 = None 1 = ReadOnly 2 = Restrict 4 = Reserved
```

- 其中：[61:59] bits为func param qualifier，当59bit = 1 且60bit = 1时，表明对当前buffer操作是RO的，可以满足语义“不保证RAW和 WAR，只保证WAW”
由于虚拟地址48bit位宽小于地址指针位宽的原因，为了简化设计，目前对于采用任何[Base+Offset]的寻址指令，在计算地址时，只对base 的低48bit和(扩展后)offset低48bit进行加法操作，如果有进位不会传递到高16bit。而base的高16bit hint始终视作最终地址的hint保持有效。该规则不影响类似TVLD这种地址后增写回寄存器时的加法操作。

遵守上述规则的指令包括：

Base+Offset寻址指令

L.TLD

L.TST

L.LDX

L.LD

L.ST

L.LDRS

M.VLDEOA

M.VSTEOA

MLI.MLI_VLDXOA

MLI.MLI_VSTXOA

## 8.2. SALU Type Instruction

SALU系列包括一系列标量整型计算指令，并将结果回写SR或者SCC中。

由于ISA4.0中SR的位宽由32bit扩展为64bit，因此原ISA3.2中的32bit SR和现有的64bit SR在语义兼容是需要考虑的。具体的兼容思路和方法请见SR Bitwidth Compatibility章节

为了兼容性考虑，绝大部分ISA3.0中的操作32bit数据的SALU指令将保留原始语义

- 保留原始语义的指令，均读取SR中低32bit作为src，计算结果保留低32bit，并在写回dst时做零扩展。这些指令对SCC的更新以32bit运算结果为准。
新增以下指令支持对64bit数据的操作：

- `ADDIX`
- `SUBIX`
- ADDX SUBX
- `MULX/DIVX/REMX`
- `SLLX/SLLIX`
- `SRX/SRIX`
- `ABX/MAXX/MINX`
- `SLTX/SLTIX`
- `ADDIX_SFT`
- MADD (主要用于地址计算加速)
下列32bit运算指令由于可以被64bit运算完全替代，并且符合兼容性结果

- `AND`
- `OR`
- `XOR`
- `SEQ`

### 8.2.1. ABS

```text
Name  Combo Name  47--32  31--27  26         25--23    22--16  15--11  10--6  5--1    0
ABS   L.ABS               N/A     sub-code2  sub-code  N/A     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
ABS   L.ABS       SALU                            1
```

**ABS:** get absolute value, Rd= ABS(Rs1)

```text
datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) result = ABS(operand1);
SR[Rd][63:0] = zero_ext(result);
```

### 8.2.2. ABSX (new in 4.0)

```text
Name  Combo Name  47--32  31--27  26         25--23    22--16  15--11  10--6  5--1    0
ABSX  L.ABSX              N/A     sub-code2  sub-code  N/A     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
ABSX  L.ABSX      SALU                            1
```

**ABSX:** get absolute value, Rd= ABS(Rs1)

```text
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) result = ABS(operand1);
SR[Rd][63:0] = result;
```

### 8.2.3. ADD

```text
Name  Combo Name  47--32  31--30  29--27  26         25--23    22--21  20--16  15--11  10--6  5--1    0
ADD   L.ADD               N/A     mode    sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
ADD   L.ADD       SALU                            1
```

**ADD:** Rd= Rs1+Rs2

```text
bits(N) Add(bits(N) operand1, bits(N) operand2, bit mode) {
    SCC.Carry = 0;
    if (mode == 0) {        //执行无符号加法
        integer unsigned_sum = Uint(operand1) + Uint(operand2);
        bits(N) result = unsigned_sum<N-1:0>;
        bit overflow = check_unsign_overflow(unsigned_sum, result, N);
    } else if (mode == 1) { //执行有符号加法
        integer signed_sum = Sint(operand1) + Sint(operand2);
        bits(N) result = signed_sum<N-1:0>;
        bit overflow = check_sign_overflow(signed_sum, result, N);
    }
    SCC.Carry = overflow;
    return result;
}
datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
bits(datasize) result = Add(operand1, operand2, mode);
SR[Rd][63:0] = zero_ext(result);
```

**Field description:**

- `mode`
  - 0: unsigned_mode
  - 1: signed_mode
  - others: ignore

**Implicit Defs:**

- `SCC`

### 8.2.4. ADDX (new in 4.0)

```text
Name  Combo Name  47--32  31--30  29--27  26         25--23    22--21  20--16  15--11  10--6  5--1    0
ADDX  L.ADDX              N/A     mode    sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
ADDX  L.ADDX      SALU                            1
```

**ADDX:** Rd= Rs1+Rs2

```text
bits(N) Add(bits(N) operand1, bits(N) operand2, bit mode) {
    SCC.Carry = 0;
    if (mode == 0) {        //执行无符号加法
        integer unsigned_sum = Uint(operand1) + Uint(operand2);
        bits(N) result = unsigned_sum<N-1:0>;
        bit overflow = check_unsign_overflow(unsigned_sum, result, N);
    } else if (mode == 1) { //执行有符号加法
        integer signed_sum = Sint(operand1) + Sint(operand2);
        bits(N) result = signed_sum<N-1:0>;
        bit overflow = check_sign_overflow(signed_sum, result, N);
    }
    SCC.Carry = overflow;
    return result;
}
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
bits(datasize) result = Add(operand1, operand2, mode);
SR[Rd][63:0] = result;
```

**Field description:**

- `mode`
  - 0: unsigned_mode
  - 1: signed_mode
  - others: ignore

**Implicit Defs:**

- `SCC`

### 8.2.5. ADD3

```text
Name  Combo Name  47--16  15--11  10--6   5--1    0
ADD3  S1.ADD3             Rs1     Rs2/Rd  opcode  0
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
ADD3  S1.ADD3     SALU          1
```

**ADD3:** Rd= Rd+Rs1,always signed

```text
datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
integer signed_sum = Sint(operand1) + Sint(operand2);
bits(datasize) result = signed_sum<N-1:0>;
SR[Rd][63:0] = zero_ext(result);
```

### 8.2.6. ADDI

```text
Name  Combo Name  47--32  31--30  29    28        27--16  15--11  10--6  5--1    0
ADDI  L.ADDI              N/A     mode  sub-code  Imm12   Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
ADDI  L.ADDI      SALU                            1
```

**ADDI:** Rd= Rs1+Imm12

```text
bits(N) Add(bits(N) operand1, bits(N) operand2, bit mode) {
    SCC.Carry = 0;
    if (mode == 0) {        //执行无符号加法
        integer unsigned_sum = Uint(operand1) + Uint(operand2);
        bits(N) result = unsigned_sum<N-1:0>;
        bit overflow = check_unsign_overflow(unsigned_sum, result, N);
    } else if (mode == 1) { //执行有符号加法
        integer signed_sum = Sint(operand1) + Sint(operand2);
        bits(N) result = signed_sum<N-1:0>;
        bit overflow = check_sign_overflow(signed_sum, result, N);
    }
    SCC.Carry = overflow;
    return result;
}
datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
if(mode == 0) bits(datasize) operand2 = zero_ext(imm12)；
if(mode == 1) bits(datasize) operand2 = sign_ext(imm12)；
bits(datasize) result = Add(operand1, operand2, mode);
SR[Rd][63:0] = zero_ext(result);
```

**Field description:**

- `mode`
  - 0: unsigned_mode. The IMM value is zero-extended to 32bit
  - 1:signed_mode. The IMM value is sign-extended to 32bit

**Implicit Defs:**

- `SCC`

### 8.2.7. ADDIX (new in 4.0)

```text
Name   Combo Name  47--32  31--30  29    28        27--16  15--11  10--6  5--1    0
ADDIX  L.ADDIX             N/A     mode  sub-code  Imm12   Rs1     Rd     opcode  1
```

```text
Name   Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
ADDIX  L.ADDIX     SALU                            1
```

**ADDIX:** Rd= Rs1+Imm12

```text
bits(N) Add(bits(N) operand1, bits(N) operand2, bit mode) {
    SCC.Carry = 0;
    if (mode == 0) {        //执行无符号加法
        integer unsigned_sum = Uint(operand1) + Uint(operand2);
        bits(N) result = unsigned_sum<N-1:0>;
        bit overflow = check_unsign_overflow(unsigned_sum, result, N);
    } else if (mode == 1) { //执行有符号加法
        integer signed_sum = Sint(operand1) + Sint(operand2);
        bits(N) result = signed_sum<N-1:0>;
        bit overflow = check_sign_overflow(signed_sum, result, N);
    }
    SCC.Carry = overflow;
    return result;
}
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
if(mode == 0) bits(datasize) operand2 = zero_ext(imm12)；
if(mode == 1) bits(datasize) operand2 = sign_ext(imm12)；
bits(datasize) result = Add(operand1, operand2, mode);
SR[Rd][63:0] = result;  // 特别的，如果imm12 == 0, 可以看做Rs1到Rd的寄存器mov操作
```

**Field description:**

- `mode`
  - 0: unsigned_mode. The IMM value is zero-extended to 64bit.
  - 1:signed_mode. The IMM value is sign-extended to 64bit.

**Implicit Defs:**

- `SCC`

### 8.2.8. SUBI

```text
Name  Combo Name  47--32  31--30  29    28        27--16  15--11  10--6  5--1    0
SUBI  L.SUBI              N/A     mode  sub-code  Imm12   Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SUBI  L.SUBI      SALU                            1
```

**SUBI:** Rd= Rs1- Imm12

```text
bits(N) Sub(bits(N) operand1, bits(N) operand2, bit mode) {
    SCC.Carry = 0;
    if (mode == 0) {        //执行无符号减法
        integer unsigned_value = Uint(operand1) - Uint(operand2);
        bits(N) result = unsigned_sum<N-1:0>;
        bit overflow = check_unsign_overflow(unsigned_value, result, N);
    } else if (mode == 1) { //执行有符号减法
        integer signed_value = Sint(operand1) - Sint(operand2);
        bits(N) result = signed_sum<N-1:0>;
        bit overflow = check_sign_overflow(signed_value, result, N);
    }
    SCC.Carry = overflow;
    return result;
}
datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
if(mode == 0) bits(datasize) operand2 = zero_ext(imm12)；
if(mode == 1) bits(datasize) operand2 = sign_ext(imm12)；
bits(datasize) result = Sub(operand1, operand2, mode);
SR[Rd][63:0] = zero_ext(result);
```

**Field description:**

- `mode`
  - 0: unsigned_mode. The IMM value is zero-extended to 32bit
  - 1:signed_mode. The IMM value is sign-extended to 32bit

**Implicit Defs:**

- `SCC`

### 8.2.9. SUBIX (new in 4.0)

```text
Name   Combo Name  47--32  31--30  29    28        27--16  15--11  10--6  5--1    0
SUBIX  L.SUBIX             N/A     mode  sub-code  Imm12   Rs1     Rd     opcode  1
```

```text
Name   Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SUBIX  L.SUBIX     SALU                            1
```

**SUBIX:** Rd= Rs1- Imm12

```text
bits(N) Sub(bits(N) operand1, bits(N) operand2, bit mode) {
    SCC.Carry = 0;
    if (mode == 0) {        //执行无符号减法
        integer unsigned_value = Uint(operand1) - Uint(operand2);
        bits(N) result = unsigned_sum<N-1:0>;
        bit overflow = check_unsign_overflow(unsigned_value, result, N);
    } else if (mode == 1) { //执行有符号减法
        integer signed_value = Sint(operand1) - Sint(operand2);
        bits(N) result = signed_sum<N-1:0>;
        bit overflow = check_sign_overflow(signed_value, result, N);
    }
    SCC.Carry = overflow;
    return result;
}
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
if(mode == 0) bits(datasize) operand2 = zero_ext(imm12)；
if(mode == 1) bits(datasize) operand2 = sign_ext(imm12)；
bits(datasize) result = Sub(operand1, operand2, mode);
SR[Rd][63:0] = result;
```

**Field description:**

- `mode`
  - 0: unsigned_mode. The IMM value is zero-extended to 64bit.
  - 1:signed_mode. The IMM value is sign-extended to 64bit.

**Implicit Defs:**

- `SCC`

### 8.2.10. ADDI_SFT

```text
Name      Combo Name  47--32  31--30  29--28  27    26         25--23    22--16  15--11  10--6  5--1    0
ADDI_SFT  L.ADDI_SFT          N/A     sft     mode  sub-code2  sub-code  Imm7    Rs1     Rd     opcode  1
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
ADDI_SFT  L.ADDI_SFT  SALU                            1
```

**ADDI_SFT:** SR[Rd]= SR[Rs1]+ (ext(Imm7) << (6+sft)) ISA3.2新增指令，将立即数左移若干位之后，根据mode进行零扩展或者符号扩展，再

与Rs1进行32bit加法，结果写回Rd中。如果加法溢出，不做饱和操作，并且不改写SCC.Carry位。

```text
datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
if(mode == 0) bits(datasize) operand2 = zero_ext(imm7) << (6 + sft)；
if(mode == 1) bits(datasize) operand2 = sign_ext(imm7) << (6 + sft)；
integer signed_sum = Sint(operand1) + Sint(operand2);
bits(datasize) result = signed_sum<datasize-1:0>; // same as unsigned_sum<datasize-1:0>
                                                  // which unsigned_sum = Uint(operand1) + Uint(operand2)
SR[Rd][63:0] = zero_ext(result);
```

**Field description:**

- `mode`
  - 0: unsigned_mode. The IMM value is zero-extended to 32bit.
  - 1:signed_mode. The IMM value is sign-extended to 32bit
- sft：
  - sft的数值加上6即为立即数左移位数。有效范围0~3

### 8.2.11. ADDIX_SFT (new in 4.0)

```text
Name       Combo Name   47--32  31--30  29--28  27    26         25--23    22--16  15--11  10--6  5--1    0
ADDIX_SFT  L.ADDIX_SFT          N/A     sft     mode  sub-code2  sub-code  Imm7    Rs1     Rd     opcode  1
```

```text
Name       Combo Name   Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
ADDIX_SFT  L.ADDIX_SFT  SALU                            1
```

**ADDIX_SFT:** SR[Rd]= SR[Rs1]+ (ext(Imm7) << (6+sft)) ISA4.0新增指令，将立即数左移若干位之后，根据mode进行零扩展或者符号扩展，

再与Rs1进行64bit加法，结果写回Rd中。如果加法溢出，不做饱和操作，并且不改写SCC.Carry位。

```text
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
if(mode == 0) bits(datasize) operand2 = zero_ext(imm7) << (6 + sft)；
if(mode == 1) bits(datasize) operand2 = sign_ext(imm7) << (6 + sft)；
integer signed_sum = Sint(operand1) + Sint(operand2);
bits(datasize) result = signed_sum<datasize-1:0>; // same ad unsigned_sum<N-1:0> which unsigned_sum =
Uint(operand1) + Uint(operand2)
SR[Rd][63:0] = result;
```

**Field description:**

- `mode`
  - 0: unsigned_mode. The IMM value is zero-extended to 64bit.
  - 1:signed_mode. The IMM value is sign-extended to 64bit
- sft：
  - sft的数值加上6即为立即数左移位数。有效范围0~3

### 8.2.12. SUB

```text
Name  Combo Name  47--32  31--30  29--27  26         25--23    22--21  20--16  15--11  10--6  5--1    0
SUB   L.SUB               N/A     mode    sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SUB   L.SUB       SALU                            1
```

**SUB:** Rd= Rs1-Rs2

```text
bits(N) Sub(bits(N) operand1, bits(N) operand2, bit mode) {
    SCC.Carry = 0;
    if (mode == 0) {        //执行无符号减法
        integer unsigned_value = Uint(operand1) - Uint(operand2);
        bits(N) result = unsigned_sum<N-1:0>;
        bit overflow = check_unsign_overflow(unsigned_value, result, N);
    } else if (mode == 1) { //执行有符号减法
        integer signed_value = Sint(operand1) - Sint(operand2);
        bits(N) result = signed_sum<N-1:0>;
        bit overflow = check_sign_overflow(signed_value, result, N);
    }
    SCC.Carry = overflow;
    return result;
}
datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand1 = SR[Rs2][datasize-1:0];
bits(datasize) result = Sub(operand1, operand2, mode);
SR[Rd][63:0] = zero_ext(result);
```

**Field description:**

- `mode`
  - 0: unsigned_mode
  - 1: signed_mode
  - others: ignore

**Implicit Defs:**

- `SCC`

### 8.2.13. SUBX (new in 4.0)

```text
Name  Combo Name  47--32  31--30  29--27  26         25--23    22--21  20--16  15--11  10--6  5--1    0
SUBX  L.SUBX              N/A     mode    sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SUBX  L.SUBX      SALU                            1
```

**SUBX:** Rd= Rs1- Rs2

```text
bits(N) Sub(bits(N) operand1, bits(N) operand2, bit mode) {
    SCC.Carry = 0;
    if (mode == 0) {        //执行无符号减法
        integer unsigned_value = Uint(operand1) - Uint(operand2);
        bits(N) result = unsigned_sum<N-1:0>;
        bit overflow = check_unsign_overflow(unsigned_value, result, N);
    } else if (mode == 1) { //执行有符号减法
        integer signed_value = Sint(operand1) - Sint(operand2);
        bits(N) result = signed_sum<N-1:0>;
        bit overflow = check_sign_overflow(signed_value, result, N);
    }
    SCC.Carry = overflow;
    return result;
}
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand1 = SR[Rs2][datasize-1:0];
bits(datasize) result = Sub(operand1, operand2, mode);
SR[Rd][63:0] = result;
```

**Field description:**

- `mode`
  - 0: unsigned_mode
  - 1: signed_mode
  - others: ignore

**Implicit Defs:**

- `SCC`

### 8.2.14. SUB3

```text
Name  Combo Name  47--16  15--11  10--6   5--1    0
SUB3  S1.SUB3             Rs1     Rs2/Rd  opcode  0
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SUB3  S1.SUB3     SALU          1
```

**SUB3:** Rd= Rd-Rs1,always signed

```text
datasize = 32;
bits(datasize) operand1 = SR[Rd][datasize-1:0];
bits(datasize) operand2 = SR[Rs1][datasize-1:0];
integer signed_sum = Sint(operand1) - Sint(operand2);
bits(datasize) result = signed_sum<datasize-1:0>;
SR[Rd][63:0] = zero_ext(result);
```

### 8.2.15. MADD (new in 4.0)

ISA4.0 新增指令，执行Rd = Rs1 * Rs2 + Rs3操作，其中所有Rs和Rd均为INT64或UINT64。本指令不修改SCC

```text
Name  Combo Name  47--32  31--27  26    25--23    22--21  20--16  15--11  10--6  5--1    0
MADD  L.MADD              Rs3     mode  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MADD  L.MADD      SALU                            1
```

**MADD:** Rd= Rs1*Rs2 + Rs3

```text
bits(N) Add(bits(N) operand1, bits(N) operand2, bit mode) {
    if (mode == 0) {        //执行无符号加法
        integer unsigned_sum = Uint(operand1) + Uint(operand2);
        bits(N) result = unsigned_sum<N-1:0>;
        bit overflow = check_unsign_overflow(unsigned_sum, result, N);
    } else if (mode == 1) { //执行有符号加法
        integer signed_sum = Sint(operand1) + Sint(operand2);
        bits(N) result = signed_sum<N-1:0>;
        bit overflow = check_sign_overflow(unsigned_sum, result, N);
    }
    return result;
}
sum_datasize = 64;
mul_datasize = 64;
bits(mul_datasize) operand1 = SR[Rs1][mul_datasize-1:0];
bits(mul_datasize) operand2 = SR[Rs2][mul_datasize-1:0];
bits(sum_datasize) product = operand1 * operand2;
bits(sum_datasize) operand3 = SR[Rs3][sum_datasize-1:0];
bits(sum_datasize) result = Add(operand3, product, mode));
SR[Rd][63:0] = result;
```

Field description

- `mode`
  - 0: unsigned_mode
  - 1: signed_mode

### 8.2.16. MUL

```text
Name  Combo Name  47--32  31--30  29--27  26         25--23    22--21  20--16  15--11  10--6  5--1    0
MUL   L.MUL               N/A     mode    sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MUL   L.MUL       SALU                            1
```

**MUL:** Rd= Rs1*Rs2

```text
datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
bits(datasize) result = Mul(operand1, operand2, mode); // set SCC = 1 if overflow otherwise set SCC = 0
SR[Rd][63:0] = zero_ext(result);
```

**Field description:**

- `mode`
  - 0: unsigned_mode
  - 1: signed_mode
  - others: ignore

**Implicit Defs:**

- `SCC`

### 8.2.17. MULX (new in 4.0)

```text
Name  Combo Name  47--32  31--30  29--27  26         25--23    22--21  20--16  15--11  10--6  5--1    0
MULX  L.MULX              N/A     mode    sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MULX  L.MULX      SALU                            1
```

**MULX:** Rd= Rs1*Rs2

```text
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
bits(datasize) result = Mul(operand1, operand2, mode); // set SCC = 1 if overflow otherwise set SCC = 0
SR[Rd][63:0] = result;
```

**Field description:**

- `mode`
  - 0: unsigned_mode
  - 1: signed_mode
  - others: ignore

**Implicit Defs:**

- `SCC`

### 8.2.18. DIV

```text
Name  Combo Name  47--32  31--30  29--27  26         25--23    22--21  20--16  15--11  10--6  5--1    0
DIV   L.DIV               N/A     mode    sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
DIV   L.DIV       SALU                            1
```

**DIV:** Rd= Rs1/Rs2

整型除法指令，根据mode将Rs1和Rs2视为无符号数或者有符号数，将商写回Rd

总是使用Rounding-to-Zero的舍入方法.

无论是UINT32和SINT32，如果Rs2为0，则除法结果一定为0xFFFFFFFF

当有符号数除法(mode == 1)，并且Rs1为0x80000000，Rs2为0xFFFFFFFF时，除法上溢，结果取0x80000000

```text
datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
bits(datasize) result = Div(operand1, operand2, mode);
SR[Rd][63:0] = zero_ext(result);
```

**Field description:**

- `mode`
  - 0: unsigned_mode
  - 1: signed_mode
  - others: ignore

### 8.2.19. DIVX (Dropped)

```text
Name  Combo Name  47--32  31--30  29--27  26         25--23    22--21  20--16  15--11  10--6  5--1    0
DIVX  L.DIVX              N/A     mode    sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
DIVX  L.DIVX      SALU                            1
```

DIVX指令在ISA4.0中已经DeFeature

**DIVX:** Rd= Rs1/Rs2

整型除法指令，根据mode将Rs1和Rs2视为无符号数或者有符号数，将商写回Rd

总是使用Rounding-to-Zero的舍入方法。

无论是UINT64和SINT64，如果Rs2为0，则除法结果一定为0xFFFFFFFFFFFFFFFF

当有符号数除法(mode == 1)，并且Rs1为0x8000000000000000，Rs2为0xFFFFFFFFFFFFFFFF时，除法上溢，结果取 0x8000000000000000

```text
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
bits(datasize) result = Div(operand1, operand2, mode);
SR[Rd][63:0] = result;
```

**Field description:**

- `mode`
  - 0: unsigned_mode
  - 1: signed_mode
  - others: ignore

### 8.2.20. REM

```text
Name  Combo Name  47--32  31--30  29--27  26         25--23    22--21  20--16  15--11  10--6  5--1    0
REM   L.REM               N/A     mode    sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
REM   L.REM       SALU                            1
```

**REM:** Rd= Rs1 % Rs2

整型取余指令，根据mode将Rs1和Rs2视为无符号数或者有符号数，将余数写回Rd

总是使用Rounding-to-Zero的舍入方法，其运算结果始终保证余数为0或者和被除数符号位相同。

无论是UINT32和SINT32，如果Rs2为0，则结果保留为Rs1

当有符号数除法(mode == 1)，并且Rs1为0x80000000，Rs2为0xFFFFFFFF时，REM结果取0x0

```text
datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
bits(datasize) result = REM(operand1, operand2, mode);
SR[Rd][63:0] = zero_ext(result);
```

**Field description:**

- `mode`
  - 0: unsigned_mode
  - 1: signed_mode
  - others: ignore

### 8.2.21. REMX(Dropped)

```text
Name  Combo Name  47--32  31--30  29--27  26         25--23    22--21  20--16  15--11  10--6  5--1    0
REMX  L.REMX              N/A     mode    sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
REMX  L.REMX      SALU                            1
```

REMX指令在ISA4.0中已经DeFeature

**REMX:** Rd= Rs1 % Rs2

整型取余指令，根据mode将Rs1和Rs2视为无符号数或者有符号数，将余数写回Rd

总是使用Rounding-to-Zero的舍入方法，其运算结果始终保证余数为0或者和被除数符号位相同。

无论是UINT64和SIN64，如果Rs2为0，则结果保留为Rs1

当有符号数除法(mode == 1)，并且Rs1为0x8000000000000000，Rs2为0xFFFFFFFFFFFFFFFF时，REM结果取0x0

```text
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
bits(datasize) result = REM(operand1, operand2, mode);
SR[Rd][63:0] = result;
```

**Field description:**

- `mode`
  - 0: unsigned_mode
  - 1: signed_mode
  - others: ignore

### 8.2.22. ANDX (new in 4.0)

```text
Name  Combo Name  47--32  31--27  26         25--23    22--21  20--16  15--11  10--6  5--1    0
ANDX  L.ANDX              N/A     sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
ANDX  L.ANDX      SALU                            1
```

**ANDX:** Rd= Rs1&Rs2

```text
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
bits(datasize) result = operand1 & operand2；
SR[Rd][63:0] = result;
```

### 8.2.23. AND2

```text
Name  Combo Name  47--16  15--11  10--6  5--1    0
AND2  S1.AND2             Rs1     Rd     opcode  0
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
AND2  S1.AND2     SALU          1
```

**AND2:** Rd[0:63]= zero_ext(&Rs1[31:0])

对寄存器中低32bit依次进行与操作

### 8.2.24. ORX (new in 4.0)

```text
Name  Combo Name  47--32  31--27  26         25--23    22--21  20--16  15--11  10--6  5--1    0
ORX   L.ORX               N/A     sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
ORX   L.ORX       SALU                            1
```

**ORX:** Rd= Rs1 | Rs2

```text
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
bits(datasize) result = operand1 | operand2；
SR[Rd][63:0] = result;
```

### 8.2.25. OR2

```text
Name  Combo Name  47--16  15--11  10--6  5--1    0
OR2   S1.OR2              Rs1     Rd     opcode  0
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
OR2   S1.OR2      SALU          1
```

**OR2:** Rd[0:63]= zero_ext(|Rs1[31:0]);

对寄存器中低32bit依次进行或操作

### 8.2.26. XORX (new in 4.0)

```text
Name  Combo Name  47--32  31--27  26         25--23    22--21  20--16  15--11  10--6  5--1    0
XORX  L.XORX              N/A     sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
XORX  L.XORX      SALU                            1
```

**XORX:** Rd= Rs1 ^ Rs2

```text
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
bits(datasize) result = operand1 ^ operand2；
SR[Rd][63:0] = result;
```

### 8.2.27. XOR2

```text
Name  Combo Name  47--16  15--11  10--6  5--1    0
XOR2  S1.XOR2             Rs1     Rd     opcode  0
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
XOR2  S1.XOR2     SALU          1
```

**XOR2:** Rd[0:63]= zero_ext(^Rs1[31:0])

对寄存器中低32bit依次进行异或操作

### 8.2.28. MAX

```text
Name  Combo Name  47--32  31--28  27    26         25--23    22--21  20--16  15--11  10--6  5--1    0
MAX   L.MAX               N/A     mode  sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MAX   L.MAX       SALU                            1
```

**MAX:** Rd=max(Rs1,Rs2)

```text
datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
if (mode == 0) bits(datasize) result = unsigned_max(operand1,operand2);
if (mode == 1) bits(datasize) result = signed_max(operand1,operand2);
SR[Rd][63:0] = zero_ext(result);
```

**Field description:**

- `mode`
  - 0: unsigned_mode,
  - 1: signed_mode,

### 8.2.29. ANDIX (new in 4.0)

```text
Name   Combo Name  47--32  31--27            26         25--23    22--21  20--16            15--11  10--6  5--1    0
ANDIX  L.ANDIX             Imm5(Imm10[9:5])  sub-code2  sub-code  N/A     Imm5(Imm10[4:0])  Rs1     Rd     opcode  1
```

```text
Name   Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
ANDIX  L.ANDIX     SALU                            1
```

**ANDIX:** Rd= Rs1& Imm10

```text
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = sign_ext(imm10);
bits(datasize) result = operand1 & operand2；
SR[Rd][63:0] = result;
```

### 8.2.30. XORIX (new in 4.0)

```text
Name   Combo Name  47--32  31--27            26         25--23    22--21  20--16            15--11  10--6  5--1    0
XORIX  L.XORIX             Imm5(Imm10[9:5])  sub-code2  sub-code  N/A     Imm5(Imm10[4:0])  Rs1     Rd     opcode  1
```

```text
Name   Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
XORIX  L.XORIX     SALU                            1
```

**XORIX:** Rd= Rs1^Imm10

```text
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = sign_ext(imm10);
bits(datasize) result = operand1 ^ operand2；
SR[Rd][63:0] = result;
```

### 8.2.31. ORIX (new in 4.0)

```text
Name  Combo Name  47--32  31--27            26         25--23    22--21  20--16            15--11  10--6  5--1    0
ORIX  L.ORIX              Imm5(Imm10[9:5])  sub-code2  sub-code  N/A     Imm5(Imm10[4:0])  Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
ORIX  L.ORIX      SALU                            1
```

**ORIX:** Rd= Rs1|Imm10

```text
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = sign_ext(imm10);
bits(datasize) result = operand1 | operand2；
SR[Rd][63:0] = result;
```

### 8.2.32. MAXX (new in 4.0)

```text
Name  Combo Name  47--32  31--28  27    26         25--23    22--21  20--16  15--11  10--6  5--1    0
MAXX  L.MAXX              N/A     mode  sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MAXX  L.MAXX      SALU                            1
```

**MAXX:** Rd=max(Rs1,Rs2)

```text
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
if (mode == 0) bits(datasize) result = unsigned_max(operand1,operand2);
if (mode == 1) bits(datasize) result = signed_max(operand1,operand2);
SR[Rd][63:0] = result;
```

**Field description:**

- `mode`
  - 0: unsigned_mode,
  - 1: signed_mode,

### 8.2.33. MIN

```text
Name  Combo Name  47--32  31--28  27    26         25--23    22--21  20--16  15--11  10--6  5--1    0
MIN   L.MIN               N/A     mode  sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MIN   L.MIN       SALU                            1
```

**MIN:** Rd=min(Rs1,Rs2)

```text
datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
if (mode == 0) bits(datasize) result = unsigned_min(operand1,operand2);
if (mode == 1) bits(datasize) result = signed_min(operand1,operand2);
SR[Rd][63:0] = zero_ext(result);
```

**Field description:**

- `mode`
  - 0: unsigned_mode,
  - 1: signed_mode,

### 8.2.34. MINX (updated in 4.0)

```text
Name  Combo Name  47--32  31--28  27    26         25--23    22--21  20--16  15--11  10--6  5--1    0
MINX  L.MINX              N/A     mode  sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MINX  L.MINX      SALU                            1
```

**MINX:** Rd=min(Rs1,Rs2)

```text
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
if (mode == 0) bits(datasize) result = unsigned_min(operand1,operand2);
if (mode == 1) bits(datasize) result = signed_min(operand1,operand2);
SR[Rd][63:0] = result;
```

**Field description:**

- `mode`
  - 0: unsigned_mode,
  - 1: signed_mode,

### 8.2.35. SLL

```text
Name  Combo Name  47--32  31--27  26         25--23    22--21  20--16  15--11  10--6  5--1    0
SLL   L.SLL               N/A     sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SLL   L.SLL       SALU                            1
```

**SLL:** Rd= Rs1<<Rs2[4:0]

```text
datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][4:0];
bits(datasize) result = operand1 << operand2;   // set SCC if overflow
SR[rd][63:0] = zext(result);
```

**Implicit Defs:**

- `SCC`

### 8.2.36. SLLX (new in 4.0)

```text
Name  Combo Name  47--32  31--27  26         25--23    22--21  20--16  15--11  10--6  5--1    0
SLLX  L.SLLX              N/A     sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SLLX  L.SLLX      SALU                            1
```

**SLLX:** Rd= Rs1<<Rs2[5:0]

```text
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][5:0];
bits(datasize) result = operand1 << operand2;  // set SCC if overflow
SR[rd][63:0] = result;
```

**Implicit Defs:**

- `SCC`

### 8.2.37. SLLI

```text
Name  Combo Name  47--32  31--27  26         25--23    22--21  20--16  15--11  10--6  5--1    0
SLLI  L.SLLI              N/A     sub-code2  sub-code  N/A     Imm5    Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SLLI  L.SLLI      SALU                            1
```

**SLLI:** Rd= Rs1<<Imm5[4:0]

```text
datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = Imm5[4:0];
bits(datasize) result = operand1 << operand2; // set SCC if overflow
SR[rd][63:0] = zext(result);
```

**Implicit Defs:**

- `SCC`

### 8.2.38. SLLIX (new in 4.0)

```text
Name   Combo Name  47--32  31    30--27  26         25--23    22--21  20--16  15--11  10--6  5--1    0
SLLIX  L.SLLIX             Imm1  N/A     sub-code2  sub-code  N/A     Imm5    Rs1     Rd     opcode  1
```

```text
Name   Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SLLIX  L.SLLIX     SALU                            1
```

**SLLIX:** Rd= Rs1<<Imm6[5:0]

```text
datasize = 64;
Imm6[5] = Imm1
Imm6[4:0] = Imm5[4:0]
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = Imm6[5:0];
bits(datasize) result = operand1 << operand2; // set SCC if overflow
SR[rd][63:0] = result;
```

**Implicit Defs:**

- `SCC`

### 8.2.39. SR

```text
Name  Combo Name  47--32  31--28  27    26         25--23    22--21  20--16  15--11  10--6  5--1    0
SR    L.SR                N/A     mode  sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SR    L.SR        SALU                            1
```

**SR:** Rd= Rs1>>Rs2[4:0]

```text
datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][4:0];
bits(datasize - operand2) value = operand1 >> operand2;
if (mode == 0) {
    bits(datasize) result = zero_ext(value);
} else if (mode == 1) {
    bits(datasize) result = sign_ext(value);
}
SR[rd][63:0] = zext(result);
```

**Field description:**

- `mode`
  - mode==0: logic right shift, filling 0 at MSB
  - mode==1: arithmetic right shift, filling sign bit at MSB

### 8.2.40. SRX (new in 4.0)

```text
Name  Combo Name  47--32  31--28  27    26         25--23    22--21  20--16  15--11  10--6  5--1    0
SRX   L.SRX               N/A     mode  sub-code2  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SRX   L.SRX       SALU                            1
```

**SRX:** Rd= Rs1>>Rs2[5:0]

```text
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][5:0];
bits(datasize - operand2) result = operand1 >> operand2;
if (mode == 0) {
    SR[Rd][63:0] = zero_ext(result);
} else if (mode == 1) {
    SR[Rd][63:0] = sign_ext(result);
}
```

**Field description:**

- `mode`
  - mode==0: logic right shift, filling 0 at MSB
  - mode==1: arithmetic right shift, filling sign bit at MSB

### 8.2.41. SRI

```text
Name  Combo Name  47--32  31--28  27    26         25--23    22--21  20--16  15--11  10--6  5--1    0
SRI   L.SRI               N/A     mode  sub-code2  sub-code  N/A     Imm5    Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SRI   L.SRI       SALU                            1
```

**SRI:** Rd= Rs1>>Imm5[4:0]

```text
datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = Imm5[4:0];
bits(datasize - operand2) value = operand1 >> operand2;
if (mode == 0) {
    bits(datasize) result = zero_ext(value);
} else if (mode == 1) {
    bits(datasize) result = sign_ext(value);
}
SR[rd][63:0] = zext(result);
```

**Field description:**

- `mode`
  - mode==0: logic right shift, filling 0 at MSB
  - mode==1: arithmetic right shift, filling sign bit at MSB

### 8.2.42. SRIX (new in 4.0)

```text
Name  Combo Name  47--32  31    30--28  27    26         25--23    22--21  20--16  15--11  10--6  5--1    0
SRIX  L.SRIX              Imm1  N/A     mode  sub-code2  sub-code  N/A     Imm5    Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SRIX  L.SRIX      SALU                            1
```

**SRIX:** Rd= Rs1>>Imm6[5:0]

```text
datasize = 64;
Imm6[5] = Imm1
Imm6[4:0] = Imm5[4:0]
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = Imm[5:0];
bits(datasize - operand2) result = operand1 >> operand2;
if (mode == 0) {
    SR[Rd][63:0] = zero_ext(result);
} else if (mode == 1) {
    SR[Rd][63:0] = sign_ext(result);
}
```

**Field description:**

- `mode`
  - mode==0: logic right shift, filling 0 at MSB
  - mode==1: arithmetic right shift, filling sign bit at MSB

### 8.2.43. SLT

```text
Name  Combo Name  47--32  31--28  27    26         25--23    22--21  20--16  15--11  10--6  5--1    0
SLT   L.SLT               N/A     mode  sub-code2  sub-code  N/A     Rs2     Rs1     N/A    opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SLT   L.SLT       SALU                            1
```

**SLT:** SCC.Compare = if(Rs1<Rs2)

```text
datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
if (mode == 0) SCC.Compare = unsigned_cmp(operand1, operand2，'<');
if (mode == 1) SCC.Compare = signed_cmp(operand1, operand2，'<');
```

**Field description:**

- `mode`
  - mode==0: unsigned mode
  - mode==1: signed mode

**Implicit Defs:**

- `SCC`

### 8.2.44. SLTX (new in 4.0)

```text
Name  Combo Name  47--32  31--28  27    26         25--23    22--21  20--16  15--11  10--6  5--1    0
SLTX  L.SLTX              N/A     mode  sub-code2  sub-code  N/A     Rs2     Rs1     N/A    opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SLTX  L.SLTX      SALU                            1
```

**SLTX:** SCC.Compare = if(Rs1<Rs2)

```text
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
if (mode == 0) SCC.Compare = unsigned_cmp(operand1, operand2，'<');
if (mode == 1) SCC.Compare = signed_cmp(operand1, operand2，'<');
```

**Field description:**

- `mode`
  - mode==0: unsigned mode
  - mode==1: signed mode

**Implicit Defs:**

- `SCC`

### 8.2.45. SLTI

```text
Name  Combo Name  47--32  31--28  27    26         25--23    22--16  15--11  10--6  5--1    0
SLTI  L.SLTI              N/A     mode  sub-code2  sub-code  Imm7    Rs1     Imm5   opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SLTI  L.SLTI      SALU                            1
```

**SLTI:** SCC.Compare=if(Rs1<Imm12)

```text
datasize = 32;
Imm12[11:5] = Imm7[6:0]
Imm12[4:0] = Imm5[4:0]
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
if(mode == 0) bits(datasize) operand2 = zero_ext(Imm12[11:0])；
if(mode == 1) bits(datasize) operand2 = sign_ext(Imm12[11:0])；
if (mode == 0) SCC.Compare = unsigned_cmp(operand1, operand2，'<');
if (mode == 1) SCC.Compare = signed_cmp(operand1, operand2，'<');
```

**Field description:**

- `mode`
  - mode==0: unsigned mode (Imm12 is a unsigned value)
  - mode==1: signed mode (Imm12 is a signed value)

**Implicit Defs:**

- `SCC`

### 8.2.46. SLTIX (new in 4.0)

```text
Name   Combo Name  47--32  31--28  27    26         25--23    22--16  15--11  10--6  5--1    0
SLTIX  L.SLTIX             N/A     mode  sub-code2  sub-code  Imm7    Rs1     Imm5   opcode  1
```

```text
Name   Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SLTIX  L.SLTIX     SALU                            1
```

**SLTIX:** SCC.Compare=if(Rs1<Imm12)

```text
datasize = 64;
Imm12[11:5] = Imm7[6:0]
Imm12[4:0] = Imm5[4:0]
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
if(mode == 0) bits(datasize) operand2 = zero_ext(Imm12[11:5])；
if(mode == 1) bits(datasize) operand2 = sign_ext(Imm12[11:5])；
if (mode == 0) SCC.Compare = unsigned_cmp(operand1, operand2，'<');
if (mode == 1) SCC.Compare = signed_cmp(operand1, operand2，'<');
```

**Field description:**

- `mode`
  - mode==0: unsigned mode (Imm12 is a unsigned value)
  - mode==1: signed mode (Imm12 is a signed value)

**Implicit Defs:**

- `SCC`

### 8.2.47. SEQX (new in 4.0)

```text
Name  Combo Name  47--32  31--28  27    26         25--23    22--21  20--16  15--11  10--6  5--1    0
SEQX  L.SEQX              N/A     mode  sub-code2  sub-code  N/A     Rs2     Rs1     N/A    opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SEQX  L.SEQX      SALU                            1
```

**SEQX:** SCC.Compare=if(Rs1==Rs2)

```text
datasize = 64;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
if (mode == 0) SCC.Compare = unsigned_cmp(operand1, operand2，'=');
if (mode == 1) SCC.Compare = signed_cmp(operand1, operand2，'=');
```

**Field description:**

- `mode`
  - mode==0: unsigned mode
  - mode==1: signed mode

**Implicit Defs:**

- `SCC`

### 8.2.48. CMOV (new in 4.0)

```text
Name  Combo Name  47--32  31--30  29--27  26   25--23    22--21  20--16  15--11  10--6  5--1    0
CMOV  L.CMOV              N/A     mode    N/A  sub-code  N/A     Rs2     Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
CMOV  L.CMOV      SALU                            1
```

CMOV Rd,Rs1,Rs2

ISA4.0新增指令，为Conditional MOV指令，该指令根据SCC状态，选择将Rs1或Rs2写入Rd寄存器。

**Field description:**

- `mode`
  - mode == 0 ： SCC.Compare state == 0时，Rd[63:0] = Rs1[63:0]，反之Rd[63:0] = Rs2[63:0]
  - mode == 1 ： SCC.Compare state == 1时，Rd[63:0] = Rs1[63:0]，反之Rd[63:0] = Rs2[63:0]
  - mode == 2 ： SCC.CARRY state == 0时，Rd[63:0] = Rs1[63:0]，反之Rd[63:0] = Rs2[63:0]
  - mode == 3 ： SCC.CARRY state == 1时，Rd[63:0] = Rs1[63:0]，反之Rd[63:0] = Rs2[63:0]

**Implicit Use:**

- `SCC`

### 8.2.49. SETSLICE (new in 4.0)

```text
Name      Combo Name  47--32  31--29   28--25      24--23    22          21   20--16  15--11  10--6  5--1    0
SETSLICE  L.SETSLICE          spr_dst  slice_size  sub-code  spr_dst_hi  N/A  Rs2     Rs1     Rd     opcode  1
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SETSLICE  L.SETSLICE  SALU                            1
```

本指令为ISA4.0新增指令，主要功能是快速分段切片运算。其行为类似于RISC-V Vector Extension中的vsetvl系列指令，计算得到当前vector 运算或者matrix运算某个维度上的实际尺寸，在回写Rd的同时回写VL或者三组Matrix Description SPR寄存器中的DIM_REAL系列寄存器。

指令中，Rs2记录被切片的总尺寸，Rs1记录切片次数(从0开始)，slice_size用于指示每次切片的尺寸。Rd和对应的SPR记录本次切片得到的实际尺寸。其中Rs1和Rs2寄存器读取低32bit作为UINT32数值。Rd则作为UINT64写回。

如果本指令中Rs1选择为SR0，则相当于使用Rs2的数值初始化VL/DIM_REAL寄存器。但是初始化过程依然会使用slice_num来保护这些寄存器的数值不超界。

**SETSLICE:**

```text
uint32_t slice_num = 8 * (2^slice_size); //slice_num是根据slice_size域计算出来的一个数值
uint32_t spr_dst_idx = {spr_dst_hi << 3 | spr_dst};
SPR_idx = (spr_dst_idx == 1) ? VL :
          (spr_dst_idx == 2) ? LHS_DIM0_REAL :
          (spr_dst_idx == 3) ? LHS_DIM1_REAL0 :
          (spr_dst_idx == 4) ? LHS_DIM1_REAL1 :
          (spr_dst_idx == 5) ? LHS_DIM1_REAL2 :
          (spr_dst_idx == 6) ? LHS_DIM1_REAL1 & LHS_DIM1_REAL2 :
          (spr_dst_idx == 7) ? RHS_DIM0_REAL0 :
          (spr_dst_idx == 8) ? RHS_DIM0_REAL1 :
          (spr_dst_idx == 9) ? RHS_DIM0_REAL2 :
          (spr_dst_idx == 10) ? RHS_DIM0_REAL1 & RHS_DIM0_REAL2 :
          (spr_dst_idx == 11) ? RHS_DIM1_REAL :
          (spr_dst_idx == 12) ? LDST_DIM0_REAL :
          (spr_dst_idx == 13) ? LDST_DIM1_REAL :
          NONE;
uint32_t total_size = SR[Rs2][31:0];
uint32_t slice_idx = SR[Rs1][31:0];
uint32_t real_size;
real_size = (total_size < (slice_idx) * slice_num) ?  0 :
            (total_size < (slice_idx+1) * slice_num)  ? (total_size - (slice_idx * slice_num)) :
            slice_num;
SR[Rd]= unsigned_extension(real_size, 64bit);
if(spr_dst_idx != 0 && spr_dst_idx <= 13) {
    SRP[SPR_idx] = SR[Rd];
}
// 注：slice_idx * slice_num 和 (slice_idx+1) * slice_num的溢出情况是中间状态；输入total_size为uint32数据类型；
// 若slice_idx * slice_num溢出，表明 total_size < (slice_idx) * slice_num) 此时real_size取值为0；
// 若slice_idx * slice_num没有溢出，但是slice_idx + 1 * slice_num溢出，此时real_size取值为total_size - slice_idx *
slice_num。
```

**Field description:**

- `slice_size`
  - 0：8
  - 1：16
  - 2：32
  - 3：64
  - 4：128
  - 5：256
  - 6：512
  - Other：reserved
- {spr_idx_hi, spr_idx}
  - 同步回写的SPR寄存器
  - 0：不会写SPR寄存器
  - 1：回写VL
  - 2：回写LHS_DIM0_REAL
  - 3：回写LHS_DIM1_REAL0
  - 4：回写LHS_DIM1_REAL1
  - 5：回写LHS_DIM1_REAL2
  - 6：同时回写LHS_DIM1_REAL1和LHS_DIM1_REAL2
  - 7：回写RHS_DIM0_REAL0
  - 8：回写RHS_DIM0_REAL1
  - 9：回写RHS_DIM0_REAL2
  - 10：同时回写RHS_DIM0_REAL1和RHS_DIM0_REAL2
  - 11 : 回写RHS_DIM1_REAL
  - 12：回写LDST_DIM0_REAL
  - 13：回写LDST_DIM1_REAL
  - Others：Reserved
下面是slice_和spr_idx的非法组合。这些组合在逻辑上会使得SPR寄存器数值超界。因此避免指令出现下列组合，否则结果不可预测

- slice_size > 3 && spr_idx = LHS_DIM0_REAL
- slice_size > 5 && (spr_idx = LHS_DIM1_REAL0 || spr_idx = LHS_DIM1_REAL1 || spr_idx = LHS_DIM1_REAL2)
- slice_size > 4 && (spr_idx = RHS_DIM0_REAL0 || spr_idx = RHS_DIM0_REAL1 || spr_idx = RHS_DIM0_REAL2)
- slice_size > 3 && spr_idx = RHS_DIM1_REAL
- slice_size > 5 && spr_idx = LDST_DIM1_REAL

**Implicit Defs:**

- `VL`
- `LHS_DIM0_REAL`
- `LHS_DIM1_REAL0`
- `LHS_DIM1_REAL1`
- `LHS_DIM1_REAL2`
- RHS_DIM0_REAL0 RHS_DIM0_REAL1
- `RHS_DIM0_REAL2`
- `RHS_DIM1_REAL`
- `LDST_DIM0_REAL`
- `LDST_DIM1_REAL`

### 8.2.50. SETSLICE_I (new in 4.0)

```text
Name        Combo Name    47--32  31--29   28--25      24--23    22          21--11  10--6  5--1    0
SETSLICE_I  L.SETSLICE_I          spr_dst  slice_size  sub-code  spr_dst_hi  Imm11   Rd     opcode  1
```

```text
Name        Combo Name    Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SETSLICE_I  L.SETSLICE_I  SALU                            1
```

本指令为ISA4.0新增指令，主要功能是快速分段切片运算。其行为类似于RISC-V Vector Extension中的vsetvl系列指令，计算得到当前vector 运算或者matrix运算某个维度上的实际尺寸，在回写Rd的同时回写VL或者三组Matrix Description SPR寄存器中的DIM_REAL系列寄存器。 本指令的总尺寸来源于立即数而非寄存器

指令中，Imm11是总尺寸(无符号扩展为32bit)，slice index由于指令编码缘故固定为0，slice_size用于指示每次切片的尺寸。Rd和对应的 SPR记录本次切片得到的实际尺寸。其中Rs2寄存器读取低32bit作为UINT32数值。Rd则作为UINT64写回。

本指令大多数情况下相当于使用Imm11的数值初始化VL/DIM_REAL寄存器。但是初始化过程依然会使用slice_size来保护这些寄存器的数值不超界。

**SETSLICE_I:**

```text
uint32_t slice_num = 8 * (2^slice_size); //slice_num是根据slice_size域计算出来的一个数值
uint32_t spr_dst_idx = {spr_dst_hi << 3 | spr_dst};
SPR_idx = (spr_dst_idx == 1) ? VL :
          (spr_dst_idx == 2) ? LHS_DIM0_REAL :
          (spr_dst_idx == 3) ? LHS_DIM1_REAL0 :
          (spr_dst_idx == 4) ? LHS_DIM1_REAL1 :
          (spr_dst_idx == 5) ? LHS_DIM1_REAL2 :
          (spr_dst_idx == 6) ? LHS_DIM1_REAL1 & LHS_DIM1_REAL2 :
          (spr_dst_idx == 7) ? RHS_DIM0_REAL0 :
          (spr_dst_idx == 8) ? RHS_DIM0_REAL1 :
          (spr_dst_idx == 9) ? RHS_DIM0_REAL2 :
          (spr_dst_idx == 10) ? RHS_DIM0_REAL1 & RHS_DIM0_REAL2 :
          (spr_dst_idx == 11) ? RHS_DIM1_REAL :
          (spr_dst_idx == 12) ? LDST_DIM0_REAL :
          (spr_dst_idx == 13) ? LDST_DIM1_REAL :
          NONE;
uint32_t total_size = unsigned_extension(Imm11, 32bit);
uint32_t slice_idx = 0;
uint32_t real_size;
real_size = (total_size < (slice_idx) * slice_num) ?  0 :
            (total_size < (slice_idx+1) * slice_num)  ? (total_size - (slice_idx * slice_num)) :
            slice_num;
SR[Rd]= unsigned_extension(real_size, 64bit);
if(spr_dst_idx != 0 && spr_dst_idx <= 13) {
    SRP[SPR_idx] = SR[Rd];
}
// 注：slice_idx * slice_num 和 (slice_idx+1) * slice_num的溢出情况是中间状态；输入total_size为uint32数据类型；
// 若slice_idx * slice_num溢出，表明 total_size < (slice_idx) * slice_num) 此时real_size取值为0；
// 若slice_idx * slice_num没有溢出，但是slice_idx + 1 * slice_num溢出，此时real_size取值为total_size - slice_idx *
slice_num。
```

**Field description:**

- `slice_size`
  - 0：8
  - 1：16
  - 2：32
  - 3：64 4：128
  - 5：256
  - 6：512
  - Other：reserved
- {spr_idx_hi, spr_idx}
  - 同步回写的SPR寄存器
  - 0：不会写SPR寄存器
  - 1：回写VL
  - 2：回写LHS_DIM0_REAL
  - 3：回写LHS_DIM1_REAL0
  - 4：回写LHS_DIM1_REAL1
  - 5：回写LHS_DIM1_REAL2
  - 6：同时回写LHS_DIM1_REAL1和LHS_DIM1_REAL2
  - 7：回写RHS_DIM0_REAL0
  - 8：回写RHS_DIM0_REAL1
  - 9：回写RHS_DIM0_REAL2
  - 10：同时回写RHS_DIM0_REAL1和RHS_DIM0_REAL2
  - 11 : 回写RHS_DIM1_REAL
  - 12：回写LDST_DIM0_REAL
  - 13：回写LDST_DIM1_REAL
  - Others：Reserved
下面是slice_size和spr_idx的非法组合。这些组合在逻辑上会使得SPR寄存器数值超界。因此避免指令出现下列组合，否则结果不可预测

- slice_size > 3 && spr_idx = LHS_DIM0_REAL
- slice_size > 5 && (spr_idx = LHS_DIM1_REAL0 || spr_idx = LHS_DIM1_REAL1 || spr_idx = LHS_DIM1_REAL2)
- slice_size > 4 && (spr_idx = RHS_DIM0_REAL0 || spr_idx = RHS_DIM0_REAL1 || spr_idx = RHS_DIM0_REAL2)
- slice_size > 3 && spr_idx = RHS_DIM1_REAL
- slice_size > 5 && spr_idx = LDST_DIM1_REAL

**Implicit Defs:**

- `VL`
- `LHS_DIM0_REAL`
- `LHS_DIM1_REAL0`
- `LHS_DIM1_REAL1`
- `LHS_DIM1_REAL2`
- `RHS_DIM0_REAL0`
- `RHS_DIM0_REAL1`
- `RHS_DIM0_REAL2`
- `RHS_DIM1_REAL`
- `LDST_DIM0_REAL`
- `LDST_DIM1_REAL`

### 8.2.51. SETSLICE_M2V (new in 4.0)

```text
Name          Combo Name      47--32  31--29      28--27  26      25   24--23    22--16  15--11  10--6  5--1    0
SETSLICE_M2V  L.SETSLICE_M2V          matrix_src  N/A     vl_dst  roc  sub-code  N/A     Rs1     Rd     opcode  1
```

```text
Name          Combo Name      Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SETSLICE_M2V  L.SETSLICE_M2V  SALU                            1
```

本指令为ISA4.0新增指令，主要功能是将三组Matrix Description所描述的矩阵的real size，转换为多个vector的VL。即相当于将一个矩阵按照行或者列切分为多个vector，便于vector指令进行计算或者读写memory。

**SETSLICE_M2V:**

```text
uint32_t index = SR[Rs1][31:0];
uint32_t real_size;
uint32_t spr_dst = vl_dst;
SPR_idx = (spr_dst == 1) ? VL : NONE;
if(roc == 1) {  //按列拆解vector
    if(matrix_src == 0) {   //选择一组Matrix Description的dim_real
        SPR_src1 = LHS_DIM0_REAL;
        SPR_src2 = LHS_DIM1_REAL0;
    } else if(matrix_src == 1) {
        SPR_src1 = LHS_DIM0_REAL;
        SPR_src2 = LHS_DIM1_REAL1;
    } else if(matrix_src == 2) {
        SPR_src1 = LHS_DIM0_REAL;
        SPR_src2 = LHS_DIM1_REAL2;
    } else if(matrix_src == 3) {
        SPR_src1 = RHS_DIM0_REAL0;
        SPR_src2 = RHS_DIM1_REAL;
    } else if(matrix_src == 4) {
        SPR_src1 = RHS_DIM0_REAL1;
        SPR_src2 = RHS_DIM1_REAL;
    } else if(matrix_src == 5) {
        SPR_src1 = RHS_DIM0_REAL2;
        SPR_src2 = RHS_DIM1_REAL;
    } else {
        SPR_src1 = LDST_DIM0_REAL;
        SPR_src2 = LDST_DIM1_REAL;
    }
} else {    //按行拆解vector
    if(matrix_src == 0) {   //选择一组Matrix Description的dim_real
        SPR_src1 = LHS_DIM1_REAL0;
        SPR_src2 = LHS_DIM0_REAL;
    } else if(matrix_src == 1) {
        SPR_src1 = LHS_DIM1_REAL1;
        SPR_src2 = LHS_DIM0_REAL;
    } else if(matrix_src == 2) {
        SPR_src1 = LHS_DIM1_REAL2;
        SPR_src2 = LHS_DIM0_REAL;
    } else if(matrix_src == 3) {
        SPR_src1 = RHS_DIM1_REAL;
        SPR_src2 = RHS_DIM0_REAL0;
    } else if(matrix_src == 4) {
        SPR_src1 = RHS_DIM1_REAL;
        SPR_src2 = RHS_DIM0_REAL1;
    } else if(matrix_src == 5) {
        SPR_src1 = RHS_DIM1_REAL;
        SPR_src2 = RHS_DIM0_REAL2;
    } else {
        SPR_src1 = LDST_DIM1_REAL;
        SPR_src2 = LDST_DIM0_REAL;
    }
}
real_size = (index < SPR_src1) ? SPR_src2 : 0;
SR[Rd] = unsigned_extension(real_size, 64bit);
if(spr_dst == 1) {
    SRP[SPR_idx] = SR[Rd];
}
```

**Field description:**

- `matrix_src`
  - 0: 选择LHS_DIM0_REAL && LHS_DIM1_REAL0
  - 1: 选择LHS_DIM0_REAL && LHS_DIM1_REAL1
  - 2: 选择LHS_DIM0_REAL && LHS_DIM1_REAL2 3: 选择RHS_DIM0_REAL0 && RHS_DIM1_REAL
  - 4: 选择RHS_DIM0_REAL1 && RHS_DIM1_REAL
  - 5: 选择RHS_DIM0_REAL2 && RHS_DIM1_REAL
  - 6: 选择LDST_DIM0_REAL && LDST_DIM1_REAL
  - Other: Reserved
- `roc`
  - Row or column。数值为1时按列来拆解vector，否则按行来拆解vector
- `vl_dst`
  - 0: 不会写SPR寄存器
  - 1: 回写VL

**Implicit Defs:**

- `VL`

**Implicit Use:**

- `LHS_DIM0_REAL`
- `LHS_DIM1_REAL0`
- `LHS_DIM1_REAL1`
- `LHS_DIM1_REAL2`
- `RHS_DIM0_REAL0`
- `RHS_DIM0_REAL1`
- `RHS_DIM0_REAL2`
- `RHS_DIM1_REAL`
- `LDST_DIM0_REAL`
- `LDST_DIM1_REAL`

### 8.2.52. TRSI2I

```text
Name    Combo Name  47--32  31--30  29--27  26   25--23    22--19  18--16     15--11  10--6  5--1    0
TRSI2I  L.TRSI2I            N/A     mode    N/A  sub-code  N/A     sub-code2  Rs1     Rd     opcode  1
```

```text
Name    Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
TRSI2I  L.TRSI2I    SALU                            1
```

整数转换指令，根据指令mode域，将SR[Rs1]保存的源数据转换至目标数据保存到SR[Rd]中，指令有如下特点：

- 对于任何mode，该指令写回Rd时，Rd的高32bit均为0。
  - SR[Rd][63:32] = 0
- 如果源数据位超出源数据格式，则忽略源数据格式范围之外的位
  - mode = 0-1 ： Source Value = SR[Rs1][31:0]
  - mode = 2-5 ： Source Value = SR[Rs1][15:0]
  - mode = 6-7 ： Source Value = SR[Rs1][7:0]
- 本指令固定Clamp=0，即当源数据超过目标数据的数据范围时，丢弃超过目标格式范围的MSB位，若目标数据是有符号数，则符号位扩展至32bit。若目标数据是无符号数，则零扩展至32bit。
  - mode = 0/2/4/6: SR[Rd][31:0] = zero_ext(transfer(Source Value))
  - mode = 1/3/5/7: SR[Rd][31:0] = sign_ext(transfer(Source Value))
- `mode`
  - 0: u32_to_u16,
  - 1: s32_to_s16,
  - 2: u16_to_u8, 3: s16_to_s8,
  - 4: u16_to_u32,
  - 5: s16_to_s32,
  - 6: u8_to_u16,
  - 7: s8_to_s16,

**Implicit Defs:**

- `SCC`

### 8.2.53. TRSI2IX (new in 4.0)

```text
Name     Combo Name  47--32  31--27  26   25--23    22--19  18--16     15--11  10--6  5--1    0
TRSI2IX  L.TRSI2IX           mode    N/A  sub-code  N/A     sub-code2  Rs1     Rd     opcode  1
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
TRSI2IX  L.TRSI2IX   SALU                            1
```

整数转换指令，根据指令mode域，将SR[Rs1]保存的源数据转换至目标数据保存到SR[Rd]中，指令有如下特点：

- 相比TRSI2I指令，新增四种mode用于支持u64/s64与u32/s32之间的转换。
- 如果源数据位超出源数据格式，则忽略源数据格式范围之外的位
  - mode = 0-1/10-11 ： Source Value = SR[Rs1][31:0]
  - mode = 2-5 ： Source Value = SR[Rs1][15:0]
  - mode = 6-7 ： Source Value = SR[Rs1][7:0]
  - mode = 8-9 : Source Value = SR[Rs1][63:0]
- 本指令固定Clamp=0，即当源数据超过目标数据的数据范围时，丢弃超过目标格式范围的MSB位，若目标数据是有符号数，则符号位扩展至64bit。若目标数据是无符号数，则零扩展至64bit。
  - mode = 0/2/4/6/8/10: SR[Rd][63:0] = zero_ext(transfer(Source Value))
  - mode = 1/3/5/7/9/11: SR[Rd][63:0] = sign_ext(transfer(Source Value))
- `mode`
  - 0: u32_to_u16,
  - 1: s32_to_s16,
  - 2: u16_to_u8,
  - 3: s16_to_s8,
  - 4: u16_to_u32,
  - 5: s16_to_s32,
  - 6: u8_to_u16,
  - 7: s8_to_s16,
  - 8:u64_to_u32,
  - 9:s64_to_s32,
  - 10:u32_to_u64,
  - 11:s32_to_s64

**Implicit Defs:**

- `SCC`

### 8.2.54. BC.LZ (updated in 4.0)

```text
Name   Combo Name  47--32  31--30  29--27  26   25--23    22--19  18--16     15--11  10--6  5--1    0
BC.LZ  L.BC.LZ             N/A     mode    N/A  sub-code  N/A     sub-code2  Rs1     Rd     opcode  1
```

```text
Name   Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
BC.LZ  L.BC.LZ     SALU                            1
```

**BC.LZ:** 统计SR[Rs1][datasize-1:0]的前导零的个数，并将结果保存在SR[Rd]中。ISA4.0 新增2种mode0-mode1，用以支持UINT64/INT64数

据类型。

- `mode`
  - 0：UINT64
  - 1：INT64
  - 2: UINT32
  - 3: INT32
  - 4: UINT16
  - 5: INT16
  - 6: UINT8
  - 7: INT8
  - Others: Reserved
- BC.LZ 从每个Data Format的 MSB 开始计数零位。 如果输入值为 0，BC.LZ 的结果将为Data Format的bit数

| Data mode | Start bit | valid output |
| --- | --- | --- |
| UINT64 | bit 63 | 0~64 |
| INT64 | bit 63 | 0~64 |
| UINT32 | bit 31 | 0~32 |
| INT32 | bit 31 | 0~32 |
| UINT16 | bit 15 | 0~16 |
| INT16 | bit 15 | 0~16 |
| UINT8 | bit 7 | 0~8 |
| INT8 | bit 7 | 0~8 |

### 8.2.55. BC.LS (updated in 4.0)

```text
Name   Combo Name  47--32  31--30  29--27  26   25--23    22--19  18--16     15--11  10--6  5--1    0
BC.LS  L.BC.LS             N/A     mode    N/A  sub-code  N/A     sub-code2  Rs1     Rd     opcode  1
```

```text
Name   Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
BC.LS  L.BC.LS     SALU                            1
```

**BC.LS:** 统计SR[Rs1][datasize-1:0]的前导符号位的个数，并将结果保存在SR[Rd]中。前导符号位是指在最高位之后且与最高位相同的那些连

续位（包括符号位）。ISA4.0 新增mode1，用以支持INT64数据类型。

- `mode`
  - 1: INT64
  - 3: INT32
  - 5: INT16
  - 7: INT8
  - Others: Reserved
BC.LS 从每个Data Format的 MSB 开始计算符号位。 如果输入值的位均为 0 或 1，BC.LS 的结果将为Data Format的bit数

| Data mode | Start bit | valid output |
| --- | --- | --- |
| INT64 | bit 63 | 1~64 |
| INT32 | bit 31 | 1~32 |

| Data mode | Start bit | valid output |
| --- | --- | --- |
| INT16 | bit 15 | 1~16 |
| INT8 | bit 7 | 1~8 |

### 8.2.56. LDI_LO, LDI_HI, LDI16 (updated in 4.0)

```text
Name    Combo Name  47--32  31--29  28--25  24--23    22--16  15--11  10--6  5--1    0
LDI_LO  L.LDI_LO            N/A     Imm4    sub-code  Imm7    Rs1/Rd  Imm5   opcode  1
```

```text
Name    Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
LDI_LO  L.LDI_LO    SALU                            1
```

```text
Name    Combo Name  47--32  31--30  29    28--25  24--23    22--16  15--11  10--6  5--1    0
LDI_HI  L.LDI_HI            N/A     mode  Imm4    sub-code  Imm7    Rs1/Rd  Imm5   opcode  1
```

```text
Name    Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
LDI_HI  L.LDI_HI    SALU                            1
```

```text
Name   Combo Name  47--32  31--30  29    28--25  24--23    22--16  15--11  10--6  5--1    0
LDI16  L.LDI16             N/A     mode  Imm4    sub-code  Imm7    Rd      Imm5   opcode  1
```

```text
Name   Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
LDI16  L.LDI16     SALU                            1
```

相比ISA3.0，ISA4.0更新指令对于高32bit操作的描述：

- 高32bit均做零扩展。

| Instruction | Description |
| --- | --- |
| LDI_LO | Rd[31:0] = (Rd & 0xFFFF0000) \| imm16; Rd[63:32] = 0 |
| LDI_HI | if mode == 0, Rd[31:0] = (Rd & 0x0000FFFF) \| (imm16 << 16); else Rd[31:0] = (imm16 << 16); Rd[63:32] = 0 |
| LDI16 | if mode == 0, Rd[31:0] = {16'h0, imm16}; else Rd[31:0] = {16{sign_imm16}, imm16}; Rd[63:32] = 0 |

### 8.2.57. CEQZ, CNEZ

```text
Name  Combo Name  47--16  15--11  10--6  5--1    0
CEQZ  S1.CEQZ             Rs1     Rd     opcode  0
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
CEQZ  S1.CEQZ     SALU          1
```

```text
Name  Combo Name  47--16  15--11  10--6  5--1    0
CNEZ  S1.CNEZ             Rs1     Rd     opcode  0
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
CNEZ  S1.CNEZ     SALU          1
```

**CEQZ:** SR[Rd] = (SR[Rs1][31:0] == 0) ? 1 : 0;

**CNEZ:** SR[Rd] = (SR[Rs1][31:0] != 0) ? 1 : 0;

```text
datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
if (op == 'CEQZ') {
    bits(datasize) result = (operand1 == 0 ? 1 : 0);
}
if (op == 'CNEZ') {
    bits(datasize) result = (operand1 != 0 ? 1 : 0);
}
SR[Rd][63:0] = zero(result);
```

其中CNEZ指令和OR2指令运算语义相同。

### 8.2.58. BFI (new in 4.0)

```text
Name  Combo Name  47--32  31--26  25--23    22       21--16  15--11  10--6   5--1    0
BFI   L.BFI               pos     sub-code  Const_0  length  Rs2     Rs1/Rd  opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
BFI   L.BFI       SALU                            1
```

BFI rd, rs2, pos, length

BFI (Bitfield Insert) 将SR[Rs2]最低有效位起始的length + 1宽度的bit域，复制到SR[Rd]中pos位置起始的length + 1宽度bit域上，Rd中其他 bit域保持不变。特别的，当Rs2为SR0时，表示对Rd的特定bit域进行清零操作。

```text
high_pos = min(63, pos + length);
SR[Rd][high_pos:pos] = SR[Rs2][high_pos-pos:0];
```

### 例：对R1的高16bit进行赋值

### LDI_LO r2,r2,#imm16

### BFI r1,r2,48,15

**Field description:**

- `length`
  - 无符号立即数
- `pos`
  - 无符号立即数

### 8.2.59. BFX (new in 4.0)

```text
Name  Combo Name  47--32  31--26  25--23    22                  21--16  15--11  10--6  5--1    0
BFX   L.BFX               pos     sub-code  Const_1(Const_1_2)  length  Rs1     Rd     opcode  Const_1(Const_1_1)
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
BFX   L.BFX       SALU                            1
```

BFX rd, rs1, pos, length

BFX (Bitfield Extract) 将SR[Rs1]中以pos位置起始的length + 1宽度bit域复制到，SR[Rd]最低有效位起始的length + 1宽度的bit域中，Rd中其他bit域写0。

```text
SR[Rd] = 0
high_pos = min(63, pos + length);
SR[Rd][high_pos - pos:0] = SR[Rs1][high_pos:pos];
```

**Field description:**

- `length`
  - 无符号立即数
- `pos`
  - 无符号立即数

## 8.3. CTRL Type Instruction

控制类指令用于修改PC，实现指令流的跳转或者执行特殊状态等。

### 8.3.1. JI (new in 4.0)

```text
Name  Combo Name  47--32  31--6  5--1    0
JI    L.JI                Imm26  opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
JI    L.JI        CTRL                            1
```

ISA4.0 新增PC-Relative Long Jump指令，相比于JAL r0, offset指令，立即数范围扩大至26bit。

JI Imm26

```text
bits(32) BranchTargetAddress = PC + (sign_ext(Imm26) << 4)
```

### 8.3.2. JIL (new in 4.0)

```text
Name  Combo Name  47--32  31--6  5--1    0
JIL   L.JIL               Imm26  opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
JIL   L.JIL       CTRL                            1
```

ISA4.0 新增PC-Relative Long Call指令，相比于JAL rs, offset指令，立即数范围扩大至26bit，隐式定义SR3为目的寄存器，将PC + 16保存在 SR3寄存器中。

JIL Imm26

```text
SR[SR3][31:0] = PC + 16;
SR[SR3][63:32] = 0;
bits(32) BranchTargetAddress = PC + (sign_ext(Imm26) << 4);
```

### 8.3.3. AUIPC (new in 4.0)

```text
Name   Combo Name  47--32  31--16  15--11  10--6  5--1    0
AUIPC  L.AUIPC             Imm16   N/A     Rd     opcode  1
```

```text
Name   Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
AUIPC  L.AUIPC     CTRL                            1
```

ISA4.0 新增指令，把符号位扩展的16bit立即数左移16位与PC相加，结果写入Rd寄存器

AUIPC rd, Imm16

```text
SR[rd][31:0] = PC + (sign_ext(Imm16) << 16);
SR[rd][63:32] = 0;
```

### 8.3.4. B.unsigned

```text
Name        Combo Name    47--32  31--30  29--24  23        22--21  20--16  15--11  10--6  5--1    0
B.unsigned  L.B.unsigned          mode    Imm6    sub-code  Imm2    Rs2     Rs1     Imm5   opcode  1
```

```text
Name        Combo Name    Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
B.unsigned  L.B.unsigned  CTRL                            1
```

**B.unsigned:** 无符号条件跳转指令，跳转目的地址为PC+ (S-Imm13<<4)。待比较的数据分别保存在SR[Rs1][31:0]和SR[Rs2][31:0]中，视为

无符号数。

```text
datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
bit jumpflag = 0;
if (mode == 0) jumpflag = unsigned_cmp(operand1，'=', operand2);
if (mode == 1) jumpflag = unsigned_cmp(operand1，'!=', operand2);
if (mode == 2) jumpflag = unsigned_cmp(operand1，'>=', operand2);
if (mode == 3) jumpflag = unsigned_cmp(operand1，'<', operand2);
if (jumpflag) {
    bits(32) BranchTargetAddress = PC + (sign_ext(Imm13) << 4);
}
```

Field description

- `mode`
  - mode=0: Rs1 EQ Rs2
  - mode=1: Rs1 NEQ Rs2
  - mode=2: Rs1 GE Rs2
  - mode=3: Rs1 LT Rs2
- `S-Imm13`
  - S-Imm13 = {Imm6, Imm2, Imm5}

### 8.3.5. BX.unsigned (new in 4.0)

```text
Name         Combo Name     47--32  31--30  29--24  23        22--21  20--16  15--11  10--6  5--1    0
BX.unsigned  L.BX.unsigned          mode    Imm6    sub-code  Imm2    Rs2     Rs1     Imm5   opcode  1
```

```text
Name         Combo Name     Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
BX.unsigned  L.BX.unsigned  CTRL                            1
```

**BX.unsigned:** 无符号条件跳转指令，跳转目的地址为PC+ (S-Imm13<<4)。待比较的数据分别保存在SR[Rs1][63:0]和SR[Rs2][63:0]中，视为

无符号数。

```text
datasize = 64; // different with B.unsigned
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
bit jumpflag = 0;
if (mode == 0) jumpflag = unsigned_cmp(operand1，'=', operand2);
if (mode == 1) jumpflag = unsigned_cmp(operand1，'!=', operand2);
if (mode == 2) jumpflag = unsigned_cmp(operand1，'>=', operand2);
if (mode == 3) jumpflag = unsigned_cmp(operand1，'<', operand2);
if (jumpflag) {
    bits(32) BranchTargetAddress = PC + (sign_ext(Imm13) << 4);
}
```

Field description

- `mode`
  - mode=0: Rs1 EQ Rs2
  - mode=1: Rs1 NEQ Rs2
  - mode=2: Rs1 GE Rs2
  - mode=3: Rs1 LT Rs2
- `S-Imm13`
  - S-Imm13 = {Imm6, Imm2, Imm5}

### 8.3.6. B.signed

```text
Name      Combo Name  47--32  31--30  29--24  23        22--21  20--16  15--11  10--6  5--1    0
B.signed  L.B.signed          mode    Imm6    sub-code  Imm2    Rs2     Rs1     Imm5   opcode  1
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
B.signed  L.B.signed  CTRL                            1
```

**B.signed：有符号条件跳转指令，跳转目的地址为PC+ (S-Imm13<<4)。待比较的数据分别保存在SR[Rs1][31:** 0]和SR[Rs2][31:0]中，视为有

符号数。

```text
datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
bit jumpflag = 0;
if (mode == 0) jumpflag = signed_cmp(operand1, '=', operand2);
if (mode == 1) jumpflag = signed_cmp(operand1，'!=', operand2);
if (mode == 2) jumpflag = signed_cmp(operand1，'>=', operand2);
if (mode == 3) jumpflag = signed_cmp(operand1，'<', operand2);
if (jumpflag) {
    bits(32) BranchTargetAddress = PC + (sign_ext(Imm13) << 4);
}
```

Field description

- `mode`
  - mode=0: Rs1 EQ Rs2
  - mode=1: Rs1 NEQ Rs2
  - mode=2: Rs1 GE Rs2
  - mode=3: Rs1 LT Rs2
- `S-Imm13`
  - S-Imm13 = {Imm6, Imm2, Imm5}

### 8.3.7. BX.signed (new in 4.0)

```text
Name       Combo Name   47--32  31--30  29--24  23        22--21  20--16  15--11  10--6  5--1    0
BX.signed  L.BX.signed          mode    Imm6    sub-code  Imm2    Rs2     Rs1     Imm5   opcode  1
```

```text
Name       Combo Name   Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
BX.signed  L.BX.signed  CTRL                            1
```

**BX.signed:** 有符号条件跳转指令，跳转目的地址为PC+ (S-Imm13 <<4)。待比较的数据分别保存在SR[Rs1][63:0]和SR[Rs2][63:0]中，视为有

符号数。

```text
datasize = 64;   // different with B.signed
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
bit jumpflag = 0;
if (mode == 0) jumpflag = signed_cmp(operand1, '=', operand2);
if (mode == 1) jumpflag = signed_cmp(operand1，'!=', operand2);
if (mode == 2) jumpflag = signed_cmp(operand1，'>=', operand2);
if (mode == 3) jumpflag = signed_cmp(operand1，'<', operand2);
if (jumpflag) {
    bits(32) BranchTargetAddress = PC + (sign_ext(Imm13) << 4);
}
```

Field description

- `mode`
  - mode=0: Rs1 EQ Rs2
  - mode=1: Rs1 NEQ Rs2
  - mode=2: Rs1 GE Rs2
  - mode=3: Rs1 LT Rs2
- `S-Imm13`
  - S-Imm13 = {Imm6, Imm2, Imm5}

### 8.3.8. JALR (updated in 4.0)

```text
Name  Combo Name  47--32  31--30  29--25  24--23    22--16  15--11  10--6  5--1    0
JALR  L.JALR              N/A     Imm5    sub-code  Imm7    Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
JALR  L.JALR      CTRL                            1
```

**JALR:** Jump to Rs1 & 0xffff_fff0 + (S-Imm12<<4),and save next PC(PC+16) to Rd. Next PC is considered as 32-bit when being

calculated in PC + 16.

If Rs1 value does not align to 16 (e.g. the 4 LSBs of Rs1 value is not all 0), the JALR will trigger EXCP_ILL_IS exception due to PC address unaligned.

Field description

- `S-Imm12`
  - S-Imm12 = {Imm5, Imm7}

### 8.3.9. JAL

```text
Name  Combo Name  47--32  31--30  29--25  24--23    22--16  15   14--11  10--6  5--1    0
JAL   L.JAL               N/A     Imm5    sub-code  Imm7    N/A  Imm4    Rd     opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
JAL   L.JAL       CTRL                            1
```

**JAL:** Jump to PC+ (S-Imm16<<4),and save next PC(PC+16) to Rd. Next PC is considered as 32-bit when being calculated in PC + 16.

Field description

- `S-Imm16`
  - S-Imm16 = {Imm5, Imm7, Imm4}

### 8.3.10. WAIT, WAIT_I (updated in 4.0)

```text
Name  Combo Name  47--32  31--26  25--23    22   21   20     19--16  15--11  10--6  5--1    0
WAIT  L.WAIT              N/A     sub-code  clr  dec  gsync  N/A     Rs1     N/A    opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
WAIT  L.WAIT      CTRL                            1
```

```text
Name    Combo Name  47--32  31--26  25--23    22   21   20     19   18--11  10--6  5--1    0
WAIT_I  L.WAIT_I            N/A     sub-code  clr  dec  gsync  N/A  Imm8    N/A    opcode  1
```

```text
Name    Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
WAIT_I  L.WAIT_I    CTRL                            1
```

SIP has 4 run states defined in Run State, while WAIT, WAIT_I and HALT instruction can change SIP's run state. Please firstly refer to Run State for full background.

**WAIT and WAIT_I:** If the specified input mailbox condition is already true, WAIT instructions will not let SIP entering WAIT state; If

the specified input mailbox condition is false, WAIT and WAIT_I instructions can let SIP stop executing instructions and entering WAIT state. It will resume to RUN state when the corresponding input mailbox condition is true. See detailed in mailbox spec.

If the mailbox index given by instruction is not implemented yet, the WAIT/WAIT_I would hang.

Field description

- clr=0, means not clearing corresponding mailbox (supposed to be simple mode) when quit waiting
- clr=1, means clearing corresponding mailbox (supposed to be simple mode) when quit waiting
  - All mailbox valid modes (1 mode when dec=0 and 6 modes when dec=1) support clr=1
- dec=0, means not consuming corresponding mailbox for once (consumption value defined in mailbox) when quit waiting
- dec=1, means consuming corresponding mailbox for once (consumption value defined in mailbox) when quit waiting
  - Support mode:
    - `Wait_clear`
      - Note: Wait_clear is one mode when dec=1.
    - `Wait_minus_one`
    - `Wait_minus_ref`
    - Credit and non-empty mode
    - Non-empty mode
    - ProduceN mode
- mailbox ID is specified as below
  - mailbox ID in WAIT: Rs1[7:0]
  - mailbox ID in WAIT_I : Imm8
- SIP has both global sync mailboxes and general mailboxes input condition. Mailbox ID for them are encoded independently.
- gsync=0, means currently it is waiting general mailboxes
  - In SIP4.0, number of general mailbox increases to 128.
  - Besides, SIP4.0 also add 16 extra virtual mailboxs
    - Each virtual mailbox is status summary of one or some of mailbox96~mailbox127
    - Virtual mailbox only support (clr = 0 && dec = 0) mode
  - If the mailbox ID is no less than 144, then the corresponding mailbox condition is considered as always false thus SIP will enter WAIT state and never quit WAIT state
- gsync=1, means currently it is waiting global sync mailbox
  - SIP HW supports 4 general mailboxes now, if the mailbox ID is no less than 4, then the corresponding mailbox condition is considered as always false thus SIP will enter WAIT state and never quit WAIT state
  - when gsync=1, dec field is dont-care as gsync mailbox only support simple mode. clr field is supported for gsync mailbox.

### 8.3.11. HALT (updated in 4.0)

```text
Name  Combo Name  47--32  31--26  25--23    22--6  5--1    0
HALT  L.HALT              N/A     sub-code  N/A    opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
HALT  L.HALT      CTRL                            1
```

**HALT:** put SIP run state to be in HALT state.

Halt指令并不保证前序IO写访问或者L1/L2/L3写访问操作完成。为避免该线程释放被重新使用时，前面使用线程返回状态导致出现一些不在预期内的结果，软件需要在HALT指令前添加相应FENCE指令；

### 8.3.12. NOP16

```text
Name   Combo Name  47--16  15--6  5--1    0
NOP16  S1.NOP16            N/A    opcode  0
```

```text
Name   Combo Name  47--16  15--6  5--1    0
NOP16  S0.NOP16            N/A    opcode  0
```

```text
Name   Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
NOP16  S1.NOP16    CTRL          1
NOP16  S0.NOP16    CTRL                   1
```

No operation.

### 8.3.13. TRAP Instruction(updated in 4.0)

#### 8.3.13.1. Instruction Encoding Format

```text
Name   Combo Name  47--32  31--27  26--23    22--6  5--1    0
TRAP0  L.TRAP0             N/A     sub-code  N/A    opcode  1
```

```text
Name   Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
TRAP0  L.TRAP0     CTRL                            1
```

- sub-code is used to indicate TRAP type.
  - 0x0 is TRAP0.
  - Other values are reserved for future usage.

##### 8.3.13.1.1. Instruction Packing Constraint

TRAP instruction could only be packed with NOP. Otherwise, an illegal exception will be raised.

##### 8.3.13.1.2. Implicit Defines and Implicit Uses

For trap0 instruction, the implicit defs and use are:

**Implicit Defs:**

- DBG_CMD (CSR)
- DBG_MODE_THD0_STS ~ DBG_MODE_THD15_STS (CSR)
- DBG_MODE_THD0_PC ~ DBG_MODE_THD15_PC (CSR)

#### 8.3.13.2. Instruction Definition

- TRAP0 is used to let SW enter debug mode after TRAP0 execution.
  - The PC of TRAP0 instruction will be captured in DBG_MODE_PC (implementation should support this register);
  - Current PC will point to TRAP0 PC after entering debug mode
  - TRAP0 is not an exception, so neither EXCP_PC nor EXCP_STS will be updated solely by the event of entering debug mode from TRAP0
  - If SIP is already in debug mode, the execution of TRAP0 will be the same as NOP.
  - TRAP0 can also be used by exception handler, regardless of EXCP_STS_GLB value
- TRAP instruction is precise
  - If implementation supports pipelined execution and there is inflight instruction hits enabled exception, then
    - later TRAP0 instruction will not cause CPU enter debug mode as it will not be executed before the elder exception

### 8.3.14. IDMA (updated in 4.0)

```text
Name  Combo Name  47--32  31--25  24   23        22   21      20--16  15--11  10--6  5--1    0
IDMA  L.IDMA              Imm7    N/A  sub-code  mbx  swvctm  Rs2     Rs1     N/A    opcode  1
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
IDMA  L.IDMA      CTRL                            1
```

本指令是ICache操作指令，用于对ICache 进行软件预取，将指令选择的虚拟地址段的指令从L2或者L3上加载到ICache上。每次预取的都是一个ICache的cacheline。

ISA4.0中，该指令预取的地址来源于SPR寄存器IPF_ADDR，IPF_ASID和IPF_KSID。

IDMA指令为非阻塞式操作。IDMA只能和NOP指令打包在一起，否则视为非法指令。

- Rs1:
  - 低32bit为IDMA 指令预取指令时的PC地址。
- `swvctm/Rs2/mbx/Imm7`
  - `Reserved`

**Implicit Use:**

- `IPF_ADDR`
- `IPF_ASID`
- `IPF_KSID`

### 8.3.15. ITAGOP (updated in 4.0)

```text
Name    Combo Name  47--32  31--25  24   23        22   21    20--16  15--11  10--6  5--1    0
ITAGOP  L.ITAGOP            Imm7    N/A  sub-code  N/A  addr  N/A     Rs1     N/A    opcode  1
```

```text
Name    Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
ITAGOP  L.ITAGOP    CTRL                            1
```

该指令是ICache操作指令，用于对Cacheline做lock/unlock操作，以及Invalidate操作。在ISA4.0中Invalidate操作的语义发生变化

ITAGOP只能和NOP指令打包在一起，否则视为非法指令。

ITAGOP指令用于对一个block做lock、unlock操作

在ITAGEOP指令中，对于SPR有如下依赖：Lock/Unlock需要IPF_ADDR/IPF_KSID/IPF_ASID；Invalidate需要IPF_KSID/IPF_ASID

- addr:
  - 1--软件对一个virtual address block来操作，virtual address用Rs1指令表示，只有 Rs1[31:0]有效。此时的virtual address表示的是一个PC地址。
  - Others：Reserved
- Imm7：操作的类型
  - 0--把这个block设置为unlock
    - 如果Cache line是invalid或者unlock状态，则本操作视为NOP
  - 1--把这个block设置为lock
    - 果Cache line是invalid或者lock状态，则本操作视为NOP
  - 2--将ICache中所有KSID和ASID和IPF_KSID/IPF_ASID相同的cache line进行Invalidate操作
    - 此时忽略Rs1的输入
    - 该操作为阻塞式操作，不需要特别的fence指令等待它完成
    - 特别的，软件用ITAGOP 对一个pending的block 做INVALIDATE操作，硬件会等它pending先搬完，然后再invalidate。

**Implicit Use:**

- `IPF_KSID`
- `IPF_ASID`
- `IPF_ADDR`

### 8.3.16. MLI_HINT (new in 4.0)

```text
Name      Combo Name  47--16  15--13  12   11--10    9--5  4       3--2  1--0
MLI_HINT  C.MLI_HINT          funct3  N/A  ST_ALLOC  N/A   LD_PF0  PRI0  op
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MLI_HINT  C.MLI_HINT  CTRL  1
```

本指令为ISA4.0新定义指令，专门用于和MLI_VLDXOA、MLI_VSTXOA、MLI_VLDXI32OA、MLI_VSTXI32OA系列指令进行固定打包。

- 本指令只能和以下指令一起打包，不能单独打包也不能和其他指令一起打包
  - MLI_VLDXOA、MLI_VSTXOA、MLI_VLDXI32OA、MLI_VSTXI32OA
- 本指令的所有域，均没有实际功效

### 8.3.17. MLI_HINT_GEMM (new in 4.0)

```text
Name           Combo Name       47--16  15--13  12      11--7  6--5  4       3--2  1--0
MLI_HINT_GEMM  C.MLI_HINT_GEMM          funct3  LD_PF1  Rs1    PRI1  LD_PF0  PRI0  op
```

```text
Name           Combo Name       Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MLI_HINT_GEMM  C.MLI_HINT_GEMM  CTRL  1
```

本指令为ISA4.0新定义指令，用于和MLI_GEMM指令打包，指示MLI指令包。另外还为MLI_GEMM的Load操作提供AXI Hint，同时通过Rs1 提供MLI_GEMM指令调度Hint以及L0P5_INV指令的buf_id。

- 本指令只能和以下指令一起打包，不能单独打包也不能和其他指令一起打包
  - `MLI_GEMM`
部分指令域说明：

- `PRI0`
  - 用于下列指令访问Global区域时，设置AXI总线写请求的Cache Priority。即直接写Ar_user[26:25]/Aw_user[26:25]域
    - MLI_GEMM右支读操作
  - 0x0：stream
  - 0x1：normal
  - 0x2：residency
  - 0x3：default，会被PBMMU表项替换
- `LD_PF0`
  - 设置下列指令读操作是否触发prefetch，即直接写Ar_user[29]域
    - MLI_GEMM右支读操作
  - 0：no-prefetch
  - 1：prefetch
  - Prefetch的粒度由LLC的寄存器设置
- `PRI1`
  - 用于下列指令访问Global区域时，设置AXI总线写请求的Cache Priority。即直接写Ar_user[26:25]/Aw_user[26:25]域
    - MLI_GEMM左支读操作
  - 0x0：stream
  - 0x1：normal
  - 0x2：residency
  - 0x3：default，会被PBMMU表项替换
- `LD_PF1`
  - 设置下列指令读操作是否触发prefetch，即直接写Ar_user[29]域
    - MLI_GEMM左支读操作
  - 0：no-prefetch 1：prefetch
  - Prefetch的粒度由LLC的寄存器设置
- `Rs1`
  - Rs1[31:24]域和Rs1[23:16]域分别保存lhs_buf_id和rhs_buf_id，用于指定L0P5_INV指令的buf_id，详细参见L0P5_INV指令。
    - Rs1[31:24]域保存lhs_buf_id
    - Rs1[23:16]域保存rhs_buf_id
  - Rs1[15:0]保存无符号立即数用于传递MLI_GEMM指令调度信息
    - 该信息用于指定 S3 footprint order算法中当前GEMM指令的footprint_order，详细参见 SCHED指令。

### 8.3.18. SCHED Serial & Footprint Order

SIP流水线的中Vector流水级S3-PISQ 存储着上一级流水线发送过来的CISC GEMM指令，而L0P5 Cache缓存CISC GEMM左右支输入操作数并被多个线程共享。多个线程常常会对GEMM操作进行任务分割。多线程之间的输入数据在任务分割时很多时候具有数据复用度，能够提升 L1->L0的带宽。 PISQ收到的CISC GEMM的顺序不一定总是是最佳的计算扫描顺序，从而不能总是有效利用L0P5 Cache的容量。

为了提高数据复用度，多个线程之间可以使用MLI_HINT_GEMM传入一个调度hint： footprint order，来帮助硬件做利于性能的调度。

![Figure 4](libra_sip_isa__figure_004.png)

```text
// 背景1：切分调度顺序对输入数据读取顺序的影响
// 如上图所示，在做一个矩阵乘操作时，多线程之间一般按照输出数据来切块。输出切块的扫描顺序，就代表着对输入数据的读取和使用顺序。
// S3支持左右操作数的IV 和 SMR Cache来缓存输入数据。
// 和用通用向量并行编程做GEMM计算时优先外积扫描类似， 程序员在对GEMM算子进行设计时，要考虑总体最佳的扫描顺序。比如，如果计算按照绿
色输出区域所标定的标号作为计算扫描顺序，那么能够在左右2个操作数都得到复用，它对应的左右操作数顺序是 （以{左输入，右输入}表达：
//  {L0, R0}, {L0, R1}
//  {L1, R0}, {L1, R1}
//  {L2, R0}, {L2, R1}
//  {L3, R0}, {L3, R1}
//  {L4, R0}, {L4, R1}
//  {L5, R0}, {L5, R1}
//  {L0, R2}, {L0, R3}
//  {L1, R2}, {L1, R3}
//  {L2, R2}, {L2, R3}
// 表达输入 M[6], N[4]
// 表达输出 A[24]
// 假设编程人员希望在最内层用4个线程并行，并且希望获得最小L0 footprint占用情况，来提升性能。那么编程人员可以替换一个循环表达方式
// 表达输入 M[3,2], N[2,2]
// 表达输出 A[6,4]
// 编程人员利用这些输入声明方式，以及下面的循环顺序，来表达我们期待的最佳计算顺序
for n in (0, 1)             //每个thread自己扫描的输入顺序
    for m in (0, 2)         //每个thread自己扫描的输入顺序
        for y in (0,1)      //希望未来在thread上并行
            for x in (0,1)  //希望未来在thread上并行
            {
                A[n*12+m*4][y*2+x] += CISC_GEMM(M[m][y] , N[n][x]); //这个可以最终会归结为调用CISC_GEMM指令
            }
// 这是一个理想的表达形式，但是因为线程调用时的实时运行情况不同，CISC_GEMM发送到S3的指令顺序不一定是符合最佳的扫描计算顺序。
// 硬件并不知道最佳顺序是什么，硬件根据一些非常局部的信息去做调度，也不容易调度优化。但是程序员是严格知道最优解，而且程序员就是往最
优解方向去写代码的。
// 所以，想象一种方式让程序员把最优顺序传递下来给硬件，让硬件尽量按照该顺序去调度。
footprint_order = 0;
for n in (0, 1)             //每个thread自己扫描的输入顺序
    for m in (0, 2)         //每个thread自己扫描的输入顺序
        for y in (0,1)      //希望未来在thread上并行
            for x in (0,1)  //希望未来在thread上并行
            {
                footprint_order++; //实际上，n*12+m*4+y*2+x
                A[n*12+m*4][y*2+x] += CISC_GEMM(M[m][y] , N[n][x], footprint_order); // 程序员把footprint_order传递给硬件
            }
// 由于是需要在4个thread上并行，调整循环顺序，改写为多线程的写法
// 此时，希望扫描顺序不变，每个thread依据同样的算法独立做order生成
thread_for y in (0,1)       //在thread上并行
    thread_for x in (0,1)   //在thread上并行
    {
        for n in (0, 1)             //每个thread自己扫描的输入顺序
            for m in (0, 2)         //每个thread自己扫描的输入顺序
            {
                footprint_order = n*12+m*4 + y*2+x;
                {
                    A[n*12+m*4][y*2+x] += CISC_GEMM(M[m][y] , N[n][x], footprint_order); // 这个最终会归结为调用CISC_GEMM指令
                }
            }
    }
// 背景2：DSM带宽要求
// DSM.share能够提供的带宽小于256B/C，目前的假设是大约等于200B/C左右。
// 假设2个操作数都来自于DSM.share （remote path），SIP内提供资源需要满足带宽需求。 设计上，IV/SMR都可以扩大容量，如果项目PPA
面积约束，此时不能任意扩充。
// IV目前定义为支持 [128 row, 128B]  x 2 做左矩阵，此时体现为512个IV，或者256x128B。
// SMR目前定义为支持 [128 B, 64列] x 4做右矩阵，此时体现为4个SMR，或者128Bx256。
// 理论上IV/SMR的容量提供给单个线程也能够有足够的复用度来降低带宽需求。 但是，ISA限制定义了每个线程VA的容量 1K VA vector（主要
是1D指令编码受限于指令宽度都使用了vacc，而不是qacc），最大支持128x128的结果矩阵，但是考虑后续可能还做少许1D计算，实际只能计算
128x64或者64x128的结果矩阵。这个复用度在DSM.share的带宽容量下的最大值。
// 如果2个操作数都在DSM.private，L1提供的带宽对于单线程做64x64的矩阵乘也是足够的。
// 如果要支持2个操作数都在DSM.share，尽量会让2D算子使用多线程+L0 IV/SMR数据复用来实现稳定最优性能。
// 这些会让ConvGen的实现和单线程的ConvGen实现不一样，ConvGen主要需要优化多线程的实现，一般的需要基于2~4个线程的实现。
// 此时需要ConvGen使用footprint order机制来优化L0的访存顺序，需要ConvGen的Benchmark结果确定使用了footprint order机制以后
当前L0的规格OK。
```

为了更好的利用L0P5 Cache的复用度，采取下面方法争取footprint order算法

1. 该算法不影响任何功能，只用于加强性能。

2. S3维护以下状态：

   - per-thread 使能bit：sched_fporder_en

   - cur_order value：参与footprint-order算法共享的当前order值

   - cur_time_threshold：表达算法中的time-out阈值

3. 在开始计算之前，计算线程同步。

4. 每个线程通过SCHD指令，初始化footprint order算法，其中使用传入SR寄存器作为参数，其中包含以下域：

   - SRs1.tout_threshold：软件传入数值，推荐设置为L0 miss penalty的一半。为避免死锁，该阈值最大不超过1024。

   - SRs1.sched_fporder_en：用于表达该线程是否参与算法调度。1表示参与，0表示不参与。所有线程的初始状态都是不参与算法调度。

   - SRs1.order_schd_master：用于表达本线程是footprint-order的master线程。只有master线程的tout_threshold才会被设置到cur_time_threshold。

5. 此SCHD指令会从2D计算指令通道从S2一直流入S3，进入S3-PISQ相关的硬件。

6. 该算法的Master线程调用SCHD指令使能footprint-order算法以后，cur_order被初始化为0，算法开始工作。

   - cur_order = 0

7. 计算线程再次同步。

8. 计算线程的CISC_MLI开始从S2发送进入S3，同时算子程序通过SR参数，将每个线程最新的footprint_order告诉S3-PISQ。

9. S3-PISQ在出口检查每个线程最新的CISC_MLI所携带的footprint-order，并将其和自身维护的cur_order做比较。

   - 如果一个线程的 sched_fporder_en == 0，且该线程存在CISC_GEMM指令在S3-PISQ里，那么该指令可以优先被弹出发出。

   - 否则，如果一个线程的sched_fporder_en == 1，且其存在于队列里CISC_GEMM指令的footprint-order <= cur_order，那么该指令优先被发射。

   - 否则，如果一个线程的sched_fporder_en == 1，且其有CISC_GEMM存在于S3-PISQ里，但footprint-order > cur_order，那么S3-PISQ的tout_value开始计数。

     - 如果tout_value到达tout_threshold value，还没有一个CISC_GEMM指令的footprint-order <= cur_order，那么S3-PISQ就任意优先选一个CISC_GEMM指令弹出发射，并且把tout_value清0。

   - 如果在tout_value到达tout_threshold value之前，还没有一个CISC_GEMM指令的footprint-order <= cur_order，且S3-PISQ的2D计算通道queue已经写满，那么S3-PISQ就任意优先选一个CISC_GEMM指令弹出发射，并且把tout_value清0。

   - 如果在tout_value到达tout_threshold value之前，有一个CISC_GEMM指令的footprint-order <= cur_order，说明等到最佳调度顺序的CISC_GEMM指令，此时选中它发射，把tout_value清0，并且cur_order++。

   - 否则，tout_value++，不弹射任意一条指令。

   - 每次弹出一个CISC_GEMM指令，cur_order++。

![Figure 5](libra_sip_isa__figure_005.png)

```text
thread_for y in (0,1)       //在thread上并行展开
    thread_for x in (0,1)   //在thread上并行展开
    {
        int schd_value;
        schd_value.tout_threshold = 256/2;
        schd_value.sched_fporder_en  = 1;
        schd_value.order_schd_master = 1; // 实际上，重复写入也OK
        sync_thread();      //
        SCHD(thread_id, scheduler=S3, policy=footprint-order, schd_value);  //使能调度该算法
        sync_thread();      //
        //开始2D计算
       footprint_order = y*2+x;
        for n in (0, 1)             //每个thread自己扫描的输入顺序
        {
            footprint_order += 12； // 用加法代替MAC，加速footprint计算，避免data-hazard
            for m in (0, 2)         //每个thread自己扫描的输入顺序
            {
                footprint_order += 4；// 用加法代替MAC，加速footprint计算，避免data-hazard
                {
                    A[n*12+m*4][y*2+x] += CISC_GEMM(M[m][y] , N[n][x], footprint_order); //这个可以最终会归结为调
用CISC_GEMM指令
                }
            }
        }
        schd_value.sched_fporder_en  = 0;
        SCHD(thread_id, scheduler=S3, policy=footprint-order, schd_value);  //关闭调度该算法
    }
```

### 8.3.19. SCHED (new in 4.0)

```text
Name   Combo Name  47--32  31--27  26--23    22--16  15--11  10--6  5--1    0
SCHED  L.SCHED             N/A     sub-code  N/A     Rs1     N/A    opcode  1
```

```text
Name   Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SCHED  L.SCHED     CTRL                            1
```

- 本指令为ISA4.0新定义指令，用于多线程调度。本指令只影响性能，不影响功能。
- 本指令通过Rs1用于向流水线传递一个64bit调度信息，用于线程优先级调度。
  - 用于设置Footprint Order

#### 8.3.19.1. 说明

- SCHED指令通过操作数会修改以下硬件内部寄存器，从而实现Footprint Order策略
  - per thread sched_fporder_en[tid]
  - shared sched_fporder_tout_threshold[9:0]
- SCHED指令在Defeature之后，只支持设置Footprint Order。其指令域defeature之后的数值范围如下：
  - Rs1[31:28]
    - 代表要设置的硬件调度单元
    - 3: 设置策略给S3 footprint order调度策略
    - Others: Reserved
  - Rs1[27:24]
    - 代表要设置的硬件调度单元的目标调度策略
    - 3: 代表设置sched_fporder_en[tid] 以及 sched_fporder_tout_threshold[9:0]
    - Others: Reserved
  - Rs1[23]
    - 0：代表是给当前线程设置，线程号从当前线程tid自动获取
    - Others: Reserved
  - Rs1[21]
    - 如果当前是要设置S3 FP order调度策略，该bit表示算法里的order_schd_master的值
  - Rs1[20]
    - 如果当前是要设置S3 FP order调度策略，该bit表示算法里期望设置的sched_fporder_en[tid]
  - Rs1[15:0]
    - 设置sched_fporder_tout_threshold[9:0]的值。设置的过程高位做抛弃处理。

### 8.3.20. L0P5_INV (new in 4.0)

```text
Name      Combo Name  47--44    43--41  40   39--31  30--26  25--21  20--16  15--6  5--2    1        0
L0P5_INV  M.L0P5_INV  sub-code  N/A     LCE  N/A     Rs2     N/A     Rs1     N/A    opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
L0P5_INV  M.L0P5_INV  CTRL                                    1
```

指令引入背景：对于2D输入数据，算法上存在多线程或多次计算间对这些数据进行复用的场景。需要引入L0P5_INV指令解决一致性问题； 为避免频繁引入Invalidation操作引起的性能损失，L0P5_INV指令同时支持有条件的执行Invalidation的语义，即实现只执行第一次 Invalidation请求，减少后续相同参数的 Invalidation操作。 L0P5_INV指令为ISA4.0新定义指令，对L0P5 Cache某区间有条件的执行Invalidation操作。指令包含两个操作数，其中Rs1[7:0]保存8-bit无符号整数表示buf_id。Rs2[7:0]保存8-bit无符号整数表示count。buf_id用于指示需要执行Invalidation操作的L0P5 Cache的某空间。count 值表示一个Kernel内，对buf_id对应的L0P5空间联合/独立执行Invalidation的次数，硬件根据该值决定是否真实的执行Invalidation操作。

```text
bits(8) buf_id = SR[Rs1][7:0];
bits(8) count  = SR[Rs2][7:0];
```

### 硬件为每个buf_id维护两个内部寄存器为：total_num_cnt和cur_num_cnt

### 内部寄存器：total_num_cnt和cur_num_cnt多线程之间共享

```text
if (count == 0) {
    buf_id.total_num_cnt = 0;
    buf_id.cur_num_cnt = 0;
    return;
}
if (count != 0) {
    if (count != buf_id.total_num_cnt) {
        buf_id.total_num_cnt = count;
        buf_id.cur_num_cnt = count - 1;
        Invalidate_L0P5_Cache(buf_id);
    } else if (count == buf_id.total_num_cnt) {
        buf_id.cur_num_cnt = buf_id.cur_num_cnt - 1;
    }
    if (buf_id.cur_num_cnt == 0) {
        buf_id.total_num_cnt = 0;
    }
    return;
}
```

- 指令域说明
  - Rs1[7:0]：buf_id
    - 指定Invalidate操作L0P5 Cache的地址空间范围：某个buf_id 对应的L0P5 Cache空间
    - MLI_HINT_GEMM指令的Rs1域保存此次计算的矩阵所属buf_id，含义与L0P5_INV中的buf_id一致。
      - MLI_HINT_GEMM指令的Rs1[31:24]域保存左矩阵的buf_id：lhs_buf_id
      - MLI_HINT_GEMM指令的Rs1[23:16]域保存右矩阵的buf_id：rhs_buf_id
  - Rs2[7:0]：count
    - 用于判断L0P5_INV指令是否需要真实执行Invalidation操作。
- 指令行为描述
  - 硬件维护若干组内部计数器，每个buf_id对应一个total_num_cnt和一个cur_num_cnt，初始值均为0，此状态为无效状态。注意：内部寄存器total_num_cnt和cur_num_cnt均是线程间共享的寄存器。
  - 硬件（任意线程）执行的某buf_id对应的L0P5_INV指令时，若指令携带的count值为0：
    - 则表示对某buf_id对应的内部计数器设置为无效状态，不进行Invalidation操作。

```text
硬件（任意线程）执行的某buf_id对应的L0P5_INV指令时，若指令携带的count值不为0，且count值与硬件内部记录的该buf_id 对应的total_num_cnt值不相等：  ，且count值与硬件内部记录的该buf_id
对应的total_num_cnt值不相等：
```

    - 则可以对内部计数器进行初始化，初始化的方式为该buf_id对应total_num_cnt赋值为count，该buf_id对应cur_num_cnt赋值为count-1。此时对buf_id对应的L0P5执行Invalidation操作。
    - 注：当count值为1时，相当于执行一次Invalidation操作，同时，将内部计数器再次设置为无效状态。
  - 硬件（任意线程）执行的某buf_id对应的L0P5_INV指令时，若指令携带的count值不为0，且count值与硬件内部记录的该buf_id 对应的total_num_cnt值相等：
    - 则对该buf_id对应cur_num_cnt执行自减1，若该buf_id对应cur_num_cnt被减至0，则将该buf_id对应total_num_cnt也赋值为0。不进行Invalidation操作。
- 内部寄存器total_num_cnt和cur_num_cnt均是线程间共享的寄存器。因此，不同线程执行的L0P5_INV指令，若buf_id相同，则表示多线程联合执行Invalidation操作，只有执行初始化的某线程的L0P5_INV指令，真正执行Invalidation操作。
- L0P5_INV执行invalidate操作时，只根据buf_id进行Invalidata操作
  - 编程者需要确保只有共享相同数据的软件线程才能使用相同的buf_id
- L0P5 可以通过设置CSR寄存器XPU_SCRATCH63为1,来关闭一个线程L0P5 Cache的查找功能。此时，本线程的L0P5_INV指令视作 NOP。
- 指令使用说明
- L0P5_INV指令支持不同的软件Invalidation策略，参考如下：
  - Policy_0: Per_Instruction_Reuse：

```text
数据只能在一条指令中复用。此时不需要插入L0P5_INV指令。通过修改设置XPU_SCRATCH63为1来Disable某线程的L0P5（此设置只需要执行一次）。该线程在L0P5 Cache查找数据时，始终视作Cache Miss。  指令。通过修改设置XPU_SCRATCH63为1来Disable某线程的L0P5
（此设置只需要执行一次）。该线程在
```

  - Policy_1: Per_SubThread_Reuse：
    - 支持数据在某一个线程内复用的场景，需要在该线程内进行Invalidation操作。此时L0P5_INV对应的buf_id应为该线程独享的buf_id；
    - 该线程需要在内部计数器是无效状态下，执行L0P5_INV(buf_id, count = 1)的指令，保持数据一致性。线程内后续访问buf_id 对应的L0P5 Cache地址空间的指令可以实现数据复用。
  - Policy_2: All_Invalidate_and_compete：
    - 支持数据在多个线程间的复用，即此时buf_id可以不再是线程独享。
    - 每个线程各自均需要在内部计数器是无效状态下，执行L0P5_INV(buf_id, count = 1)指令，用来保证本线程L0P5 Cache的一致性。线程之间L0P5_INV执行顺序不确定，各线程执行L0P5_INV时，都会使buf_id对应的L0P5 Cache失效， 可能会造成其他线程已经预取过的数据再次失效。
  - Policy_3: All_Invalidate_and_barrier
    - 支持数据在多个线程间的复用，即此时buf_id可以不再是线程独享。
    - 每个线程各自均需要在内部计数器是无效状态下，执行L0P5_INV(buf_id, count = 1)指令，然后通过Barrier和Wait操作执行线程同步。避免各线程错时对同一buf_id对应的L0P5 Cache数据的Invalidation操作。
  - Policy_5: HW_Acceleration
    - 支持数据在多个线程间的复用，即此时buf_id可以不再是线程独享。
    - 使用L0P5_INV实现条件执行Invalidation操作的语义。
    - 每个线程均执行L0P5_INV(buf_id, count = N)指令，其中N表示消费者计数（即所有线程中buf_id对应的L0P5_INV动态执行次数）。硬件根据内部计数器状态决定，只有可以初始化的某线程的L0P5_INV指令，真正执行Invalidation操作。其他联合执行Invalidation操作的同buf_id对应的L0P5_INV指令并不真正执行Invalidation操作。

### 8.3.21. CNOP

```text
Name  Combo Name  47--16  15--13  12--2    1--0
CNOP  C.NOP               funct3  Const_0  op
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
CNOP  C.NOP       CTRL  1
```

No operation.

## 8.4. SLDST Type Instruction

SLDST type instructions conduct 64-bit/32-bit/16-bit/8-bit Scalar load/store operations to move data between

- SR <--> L1-SDMEM
- SR <--> L1-VDMEM
- SR <--> SPR
- Imm -> SR

### 8.4.1. LD (updated in 4.0)

```text
Name  Combo Name  47--32  31--25  24   23        22--21  20--16  15--11  10--6  5--1    0
LD    L.LD                Imm7    N/A  sub-code  mode    Imm5    Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
LD    L.LD        SLDST                            1
```

LD 标量存储器访问指令，要求访问地址按照访问数据的位宽对齐，否则会触发异常。如果访问数据的位宽为8-bit或16bit，结果先通过符号位扩展到32bit。然后零扩展到64bitSR寄存器中。 特别说明：该指令用于保证兼容性，仅限于ISA4.0存在。未来请以LDX指令为主。

```text
if (mode == 0) datasize = 8;
if (mode == 1) datasize = 16;
if (mode == 2) datasize = 32;
Imm12[11:5] = Imm7
Imm12[4:0] = Imm5
bits(32) result = sign_ext(Mem[SR[Rs1] + S-Imm12][datasize-1:0]); //保持兼容性
SR[SR][63:0] = zero_ext(result);
```

Field description

- mode field indicates its request size
  - 0: C_8b,
  - 1: H_16b,
  - 2: W_32b,

### 8.4.2. LDX (new in 4.0)

```text
Name  Combo Name  47--32  31--25  24   23        22--21  20--16  15--11  10--6  5--1    0
LDX   L.LDX               Imm7    N/A  sub-code  mode    Imm5    Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
LDX   L.LDX       SLDST                            1
```

LDX 标量存储器访问指令，要求访问地址按照访问数据的位宽对齐，否则会触发异常。如果访问数据的位宽非64bit，结果通过符号位扩展到64bit后写入Rd寄存器。

```text
if (mode == 0) datasize = 8;
if (mode == 1) datasize = 16;
if (mode == 2) datasize = 32;
if (mode == 3) datasize = 64;
Imm12[11:5] = Imm7
Imm12[4:0] = Imm5
bits(64) result = sign_ext(Mem[SR[Rs1] + S-Imm12][datasize-1:0]); //保持兼容性
SR[SR][63:0] = result;
```

Field description

- mode field indicates its request size
  - 0: C_8b,
  - 1: H_16b,
  - 2: W_32b,
  - 3: D_64b

### 8.4.3. LDRS (new in 4.0)

```text
Name  Combo Name  47--32  31--30  29--27   26--23    22--21  20--19  18--16     15--11  10--6  5--1    0
LDRS  L.LDRS              N/A     spr_idx  sub-code  mode    N/A     sub-code2  Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
LDRS  L.LDRS      SLDST                            1
```

LDRS (Load Register Special) 标量存储器访问指令。指令寻址模式为寄存器寻址方式，指令域中的spr_idx域用来索引SPR LD_BASE寄存器，LD_BASE*保存基地址，Rs1保存的有符号数据作为地址偏移。指令要求访问地址按照访问数据的位宽对齐，否则会触发异常。

SIP4.0对本指令进行了性能优化，方式是根据SRP LD_BASE保存的基地址作为整体结果的地址属性，根据该地址属性确认访问的地址空间， 从而进行加速。

```text
if (mode == 0) datasize = 8;
if (mode == 1) datasize = 16;
if (mode == 2) datasize = 32;
if (mode == 3) datasize = 64;
bits(64)     address = SPR[LD_BASE[spr_idx]] + SR[Rs1];
bits(datasize) value = Mem[address][datasize-1:0];
bits(64)      result = sign_ext(value);
SR[Rd][63:0] = result;
```

Field description

- mode field indicates its request size
  - 0: C_8b,
  - 1: H_16b,
  - 2: W_32b,
  - 3: D_64b
- `spr_idx`
  - 0 : LD_BASE0
  - 1 : LD_BASE1
  - 2 : LD_BASE2
  - 3 : LD_BASE3
  - 4 : LD_BASE4
  - 5 : LD_BASE5
  - 6 : LD_BASE6
  - 7 : LD_BASE7

**Implicit Use:**

- LD_BASE0 - LD_BASE7

### 8.4.4. ST (updated in 4.0)

```text
Name  Combo Name  47--32  31--25  24   23        22--21  20--16  15--11  10--6  5--1    0
ST    L.ST                Imm7    N/A  sub-code  mode    Rs2     Rs1     Imm5   opcode  1
```

```text
Name  Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
ST    L.ST        SLDST                            1
```

**ST:** 标量存储器存储指令，要求访问地址按照访问数据的位宽对齐，否则会触发异常。。

在ISA4.0中额外受到ESL_ORDER域的影响。如果在发射该指令时，ESL_ORDER域为1，并且访问区域为L3，则对应的AXI域上会标记为 ESL_ORDER状态。对于其他区域的访问ESL_ORDER没有额外影响。

```text
if (mode == 0) datasize = 8;
if (mode == 1) datasize = 16;
if (mode == 2) datasize = 32;
if (mode == 3) datasize = 64;
Imm12[11:5] = Imm7
Imm12[4:0] = Imm5
Mem[SR[Rs1] + S-Imm12][datasize-1:0] = SR[Rs2][datasize-1:0];
```

Field description

- mode field indicates its request size
  - 0: C_8b,
  - 1: H_16b,
  - 2: W_32b,
  - 3: D_64b

**Implicit Use:**

- `ESL_ORDER`

### 8.4.5. TLD (new in 4.0)

```text
Name  Combo Name  47--32  31--25  24   23        22--21  20--16  15--11  10--6  5--1    0
TLD   L.TLD               Imm7    N/A  sub-code  N/A     Imm5    Rs1     TARd   opcode  1
```

```text
Name  Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
TLD   L.TLD       SLDST                            1
```

TLD TARd, offset(rs1)

目的寄存器为TAR寄存器的标量存储器访问指令，只支持访问数据的位宽为64bit。指令要求访问地址按照访问数据的位宽对齐，否则会触发异常。

该指令仅适用于TCTL设置只开启VPT0。

```text
datasize = 64;
Imm12[11:5] = Imm7
Imm12[4:0] = Imm5
TAR[0][TARd][63:0] = zero_ext(Mem[SR[Rs1] + S-Imm12][datasize-1:0]);
```

### 8.4.6. TST (new in 4.0)

```text
Name  Combo Name  47--32  31--25  24   23        22--21  20--16  15--11  10--6  5--1    0
TST   L.TST               Imm7    N/A  sub-code  N/A     TARs2   Rs1     Imm5   opcode  1
```

```text
Name  Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
TST   L.TST       SLDST                            1
```

**TST:** TARs2, offset(rs1)

保存数据的寄存器为TAR寄存器的标量存储器存储指令，只支持访问数据的位宽为64bit。指令要求访问地址按照访问数据的位宽对齐，否则会触发异常。

该指令仅适用于TCTL设置只开启VPT0。

```text
datasize = 64;
Imm12[11:5] = Imm7
Imm12[4:0] = Imm5
Mem[SR[Rs1] + S-Imm12][datasize-1:0] = TAR[0][TARs2][datasize-1:0];
```

### 8.4.7. DPREFETCH (updated in 4.0)

```text
Name       Combo Name   47--32  31--30  29     28--27   26          25--23    22    21   20--16  15--11  10--6  5--1    0
DPREFETCH  L.DPREFETCH          N/A     hw_pf  replace  cache_mode  sub-code  Inst  N/A  Rs2     Rs1     N/A    opcode  1
```

```text
Name       Combo Name   Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
DPREFETCH  L.DPREFETCH  SLDST                            1
```

**DPREFETCH:** prefetch(Mem[Rs1])

本指令为Data Cache prefetch指令。其实质是一种特殊的单个byte store指令，其特点是向特定的地址对应的Cache line发射SR[Rs2]的末尾 byte的写操作，但是通过AXI的全0 strobe使得其并不真正写入任何数据，只是迫使Cache line进行一次miss fetch。

ISA4.0中更新如下：

- 地址为48bit虚拟地址而非物理地址，来源于SR1
- 写入数据寄存器位SR[Rs2]
- 本指令所用ASID来源于SPR寄存器DPF_ASID
本指令有如下特点：

- 本指令使用48bit虚拟地址
  - 当访问了Global空间之外的地址时，会触发unalign address exception
- 在指向有效地址时，该指令域任何其他Load/Store指令都不检查RAW/WAW/WAR hazard，包括之前发射的DPREFETCH指令
- 对访问SIP外部的Cache和Memory时，写数据的控制bit（AXI的write strobe）为全0，并且预期write response
- 该指令的异常处理请参考ArchSpec
部分指令域说明：

- `inst`
  - 1: 表示在Cache上预取的是指令而非计算数据。
  - 0: 表示在Cache上预取的是计算数据而非指令。
  - 这个域会被传递到Awprot[2]上
- `cache_mode`
  - `reserved`
- `replace`
  - 对访问cache的replace priority的hint
  - 该域会被传递到Ax_User[26:25]上
  - 有效范围0~2
    - 0: stream
    - 1: normal
    - 2: resident
    - 3: Reserved
- `hw_pf`
  - hw prefetch hint
  - 该域会被传递到Ax_User[29]上

**Implicit Use:**

- `DPF_ASID`

### 8.4.8. MOV (updated in 4.0)

**MOV:** Rd=Rs.

ISA4.0新增定义 MOV指令为ORX的伪指令，即在编码上等同于ORX Rd, Rs1, SR0

### 8.4.9. UEXT (new in 4.0)

```text
Name  Combo Name  47--32  31--27  26--23    22--21  20--19  18--16     15--11  10--6  5--1    0
UEXT  L.UEXT              N/A     sub-code  mode    N/A     sub-code2  Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
UEXT  L.UEXT      SLDST                            1
```

**UEXT:** Rd, Rs1

用于将Rs1中低8-bit/低16-bit/低32-bit进行无符号扩展至64-bit，保存在Rd中。

```text
if (mode == 0) datasize = 8;
if (mode == 1) datasize = 16;
if (mode == 2) datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
SR[Rd][63:0] = zero_ext(result);
```

mode

- 0: C_8b,
- 1: H_16b,
- 2: W_32b

### 8.4.10. SEXT (new in 4.0)

```text
Name  Combo Name  47--32  31--27  26--23    22--21  20--19  18--16     15--11  10--6  5--1    0
SEXT  L.SEXT              N/A     sub-code  mode    N/A     sub-code2  Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
SEXT  L.SEXT      SLDST                            1
```

**SEXT:** Rd, Rs1

用于将Rs1中低8-bit/低16-bit/低32-bit进行符号位扩展至64-bit，保存在Rd中。

```text
if (mode == 0) datasize = 8;
if (mode == 1) datasize = 16;
if (mode == 2) datasize = 32;
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
SR[Rd][63:0] = sign_ext(result);
```

mode

- 0: C_8b,
- 1: H_16b,
- 2: W_32b

### 8.4.11. MOVS

```text
Name  Combo Name  47--32  31--27       26--23    22--19       18--16  15--11  10--6  5--1    0
MOVS  L.MOVS              fparam[8:4]  sub-code  fparam[3:0]  SR_ext  Rs1     Rd     opcode  1
```

```text
Name  Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOVS  L.MOVS      SLDST                            1
```

**MOVS:** Rd=SPR (SPR_ID), SPR_ID={SR_ext, Rs} // 8-bit

SPR_ID is specified in Libra SIP SPR Spec.

#### 8.4.11.1. MOVS.Barrier (updated in 4.0)

特别的，MOVS去读取Barrier寄存器被定义为SW 线程内的barrier操作

在执行MOVS Barrier时，需要配合fparam来确定语义。fparam在ISA3.2中扩展到9bit，每个bit对应一种fence类型。但是在执行fence操作时，只有有限种类的fence类型组合时合法的。

ISA4.0对该指令的更新：

- 去除了对VCC的操作。
- MOVS barrier中Rd寄存器的指令编码强制要求为SR0，避免不必要的Hazard。
- 对指令加以简化，去除fence MEM_L2L3_Load/fence MEM_L2L3_store/fence MEM_L2L3这三种场景，这三种场景对应可以使用独立的L2 fence+L3fence模拟替代。
- MOVS.Barrier并未定义L4 Fence接口，对于L4的fence，L4 fence是ESL_order的scalar-store指令。
- 新增L0 Fence接口，某SW-thread执行Fence L0操作，Fence L0结束的标志是该SW-thread前序指令对L0资源访问结束。Fence L0指令结束后，软件可以安全的修改CSR/SPR。

**Note:** MOVS.Barrier是per SW-thread的，作用范围仅在每个SW thread范围内，无法处理多个SW thread之间以及thread与SDTE之间的

barrier。

| fparam bit | Barrier type |
| --- | --- |
| fparam[0] | Fence L1 SDMEM Access |
| fparam[1] | Fence L1 VDMEM Access |
| fparam[2] | Fence L2 Access |
| fparam[3] | Fence L3 Access |
| fparam[4] | Fence Memory |
| fparam[5] | Fence IO |
| fparam[6] | Fence Load |

| fparam bit | Barrier type |
| --- | --- |
| fparam[7] | Fence Store |
| fparam[8] | Fence L0 Access |

- 本指令支持同时对多个fparam bit置位，达到不同层级的Fence效果，例如：内存层级（fparam[0]/[1]/[2]/[3]）+ Memory/IO （fparam[4]/[5]）+ LD/ST Operation（fparam[6]/[7]）。Fence L0支持独自使能。详情请见下表：
注意：下列为合法的MOVS.barrer参数组合。其余的fparam bit组合在ISA4.0的movs.barrer指令中均为非法

```text
Fence type                   fparam value   Comment
MOVS.barrier L0              fparam =0x100  Fence L0。等所有前面的访问L0资源的指令执行完成后撤销fence
MOVS.barrier ALL             fparam = 0x0   Fence All。等所有前面指令执行完成后撤销fence fparam=0x0的数值和ISA3.2中fence all的fparam数值兼容
MOVS.barrier L1_SDMEM        fparam =0xD1   Fence L1 SDMEM memory access。等所有前面的访问SDMEM的指令执行完成后撤销fence
MOVS.barrier L1_VDMEM        fparam =0xD2   Fence L1 VDMEM memory access。等所有前面的访问VDMEM的指令执行完成后撤销fence
MOVS.barrier L2_MEM          fparam =0xD4   Fence L2 memory access。等所有前面访问DSM的指令执行完成之后撤销 fence
MOVS.barrier L3_MEM          fparam =0xD8   Fence L3 memory access。等所有前面访问EDF的指令执行完成之后撤销 fence
MOVS.barrier L1_IO           fparam =0xE3   Fence L1 IO access。等所有前面的访问SIP内SCF寄存器的指令执行完成后撤销fence
MOVS.barrier L2L3_IO         fparam =0xEC   Fence L2 & L3 IO access。等所有前面的访问ECF的指令执行完成后撤销fence
MOVS.barrier L1_SDMEM_LOAD   fparam =0x51   Fence L1 memory read access。等所有前面的访问SDMEM的读指令执行完成后撤销fence
MOVS.barrier L1_VDMEM_LOAD   fparam =0x52   Fence L1 memory read access。等所有前面的访问VDMEM的读指令执行完成后撤销fence
MOVS.barrier L2_MEM_LOAD     fparam =0x54   Fence L2 memory read access。等所有前面的访问DSM的读指令执行完成后撤销fence
MOVS.barrier L3_MEM_LOAD     fparam =0x58   Fence L3 memory read access。等所有前面的访问EDF的读指令执行完成后撤销fence
MOVS.barrier L1_IO_LOAD      fparam =0x63   Fence L1 IO read access。等所有前面的访问SIP内SCF寄存器的读指令执行完成后撤销fence
MOVS.barrier L2L3_IO_LOAD    fparam =0x6C   Fence L2 & L3 IO read access。等所有前面的访问ECF的读指令执行完成后撤销fence
MOVS.barrier L1_SDMEM_STORE  fparam =0x91   Fence L1 memory write access。等所有前面的访问SDMEM的写指令执行完成后撤销fence
MOVS.barrier L1_VDMEM_STORE  fparam =0x92   Fence L1 memory write access。等所有前面的访问VDMEM的写指令执行完成后撤销fence
MOVS.barrier L2_MEM_STORE    fparam =0x94   Fence L2 memory write access。等所有前面访问DSM的写指令执行完成之后撤销fence
MOVS.barrier L3_MEM_STORE    fparam =0x98   Fence L3 memory write access。等所有前面访问EDF的写指令执行完成之后撤销fence
MOVS.barrier L1_IO_STORE     fparam =0xA3   Fence L1 IO write access。等所有前面的访问SIP内SCF寄存器的写指令执行完成后撤销fence
MOVS.barrier L2L3_IO_STORE   fparam =0xAC   Fence L2 & L3 IO write access。等所有前面的访问ECF的写指令执行完成后撤销fence
```

Note：

- 对于Stack区域的访问，如果命中stack.local则属于L1 SDMEM区域，需要使用L1_SDMEM有关的Fence 类型。如果命中 stack.remote，需要使用L3有关的Fence类型。

#### 8.4.11.2. MOVS.SCC Format

MOVS instruction can return SCC value if given SCC related index.

### 8.4.12. MOVSR2SPR (updated in 4.0)

```text
Name       Combo Name   47--32  31--27  26--23    22--19  18--16  15--11  10--6  5--1    0
MOVSR2SPR  L.MOVSR2SPR          N/A     sub-code  N/A     SR_ext  Rs1     Rd     opcode  1
```

```text
Name       Combo Name   Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOVSR2SPR  L.MOVSR2SPR  SLDST                            1
```

SPR(SPR_ID) = Rs1. SPR_ID = {SR_ext, SRd} // 8-bit.

This is only for below SPR. If SPR_ID selected other SPR, then it is effectively an NOP.

- `MODE_WRK`
- `HWT_COUNTER`
- `SCC`
- `VAB_VPT0`
- `VAB_VPT1`
- `NACCOVR`
- `MB_STACK`
- `STACK_LOCAL`
- `STACK_REMOTE`
- `TCTL`
- `VL`
- `LHS_DIM0_REAL`
- `LHS_DIM1_REAL0`
- `LHS_DIM1_REAL1`
- `LHS_DIM1_REAL2`
- `LHS_DIM0_STRIDE`
- `LHS_DIM1_STRIDE`
- `RHS_DIM0_REAL0`
- `RHS_DIM0_REAL1`
- `RHS_DIM0_REAL2`
- `RHS_DIM1_REAL`
- `RHS_DIM0_STRIDE`
- `RHS_DIM1_STRIDE`
- `LDST_DIM0_REAL`
- `LDST_DIM1_REAL`
- `LDST_DIM0_STRIDE`
- `LDST_DIM1_STRIDE`
- `TRAP_RTB`
- INTR_SD0~INTR_SD7
- `DPF_ASID`
- `IPF_ADDR`
- `IPF_ASID`
- `IPF_KSID`
- LD_BASE0 ~ LD_BASE7 ESL_DTYPE
- `ESL_ORDER`

**Note:**

- 不允许使用MOVSR2SPR去访问SPR HW_STS.
- 使用MOVSR2SPR更新一部分SPR寄存器时有如下约束
  - 更新这些寄存器时，没有正在执行的依赖于这些寄存器语义的指令。例如在线程启动时配置，或者在配置前使用L0 Fence
  - 更新这些寄存器之后，需要使用L0 Fence 保证这些寄存器被写透
  - 这些寄存器包括
    - `MODE_WRK`
    - `VAB_VPT0`
    - `VAB_VPT1`
    - `MB_STACK`
    - `STACK_REMOTE`
    - `STACK_LOCAL`
    - `TCTL`
    - `ESL_DTYPE`
    - `TRAP_RTB`
- MOVSR2SPR指令修改某些SPR时需要满足一定约束（例如VAB和MODE_WRK），具体约束请参考SPR Spec的第8章节

### 8.4.13. AMO serial (new in 4.0)

- ISA4.0新增原子性存储操作指令（Atomic Memory Operation），简称AMO指令。AMO系列指令对存储器的一系列读写操作必须是原子性的，即不能被打断以保证结果的正确性。
- AMO系列指令语义为：从存储器中读取一个数据，存放在目的寄存器中，并且将读出的数据域源寄存器的值进行计算，并将计算后的结果写回存储器，存储器写回地址和读出地址相同。对读出的数据进行的计算操作类型依赖于具体的指令类型。
- AMO系列指令包括12条标量指令和3条向量类型指令，用以支持不同的应用场景。
- 对于AMO标量指令：
  - 支持的操作类型如下表所示

```text
操作    指令                        描述
cas     amo.cas rd, (rs1),rs2, rs3  从Rs1保存的内存地址中读取数据，存放至Rd寄存器中，若读出的数据与Rs2寄存器的值相等，则将Rs3寄存器的值写回到Rs1保存的内存地址中，反之，对Rs1保存的内存地址的数据不做任何修改。
exch    amo.exch rd, (rs1),rs2      从Rs1保存的内存地址中读取数据，存放至Rd寄存器中，并且将Rs2寄存器的值进行写回到Rs1保存的内存地址中。
add     amo.add rd, (rs1),rs2       从Rs1保存的内存地址中读取数据，存放至Rd寄存器中，并且将读出的数据与Rs2寄存器的值进行相加计算，再将计算后的结果写回到Rs1保存的内存地址中。
and     amo.and rd, (rs1),rs2       从Rs1保存的内存地址中读取数据，存放至Rd寄存器中，并且将读出的数据与Rs2寄存器的值进行逻辑与计算，再将计算后的结果写回到Rs1保存的内存地址中。
or      amo.or rd, (rs1),rs2        从Rs1保存的内存地址中读取数据，存放至Rd寄存器中，并且将读出的数据与Rs2寄存器的值进行逻辑或计算，再将计算后的结果写回到Rs1保存的内存地址中。
xor     amo.xor rd, (rs1),rs2       从Rs1保存的内存地址中读取数据，存放至Rd寄存器中，并且将读出的数据与Rs2寄存器的值进行逻辑异或计算，再将计算后的结果写回到Rs1保存的内存地址中。
max     amo.max rd, (rs1),rs2       从Rs1保存的内存地址中读取数据，存放至Rd寄存器中，并且将读出的数据与Rs2寄存器的值进行取最大值计算，再将计算后的结果写回到Rs1保存的内存地址中。
maxnum  amo.maxnum rd,(rs1), rs2    从Rs1保存的内存地址中读取数据，存放至Rd寄存器中，并且将读出的数据与Rs2寄存器的值进行取最大值计算，再将计算后的结果写回到Rs1保存的内存地址中。
min     amo.min rd, (rs1),rs2       从Rs1保存的内存地址中读取数据，存放至Rd寄存器中，并且将读出的数据与Rs2寄存器的值进行取最小值计算，再将计算后的结果写回到Rs1保存的内存地址中。
minnum  amo.minnum rd,(rs1), rs2    从Rs1保存的内存地址中读取数据，存放至Rd寄存器中，并且将读出的数据与Rs2寄存器的值进行取最小值计算，再将计算后的结果写回到Rs1保存的内存地址中。
```

```text
操作  指令                   描述
inc   amo.inc rd, (rs1),rs2  从Rs1保存的内存地址中读取数据，存放至Rd寄存器中，并且将读出的数据Old与Rs2 寄存器保存的数据Val进行比较，如果Old大于等于Val，则将0写回到Rs1保存的内存地址中，反之，写回的数值为Old自增1。
dec   amo.dec rd, (rs1),rs2  从Rs1保存的内存地址中读取数据，存放至Rd寄存器中，并且将读出的数据Old与Rs2 寄存器保存的数据Val进行比较，如果Old大于Val或Old等于0，则将Val写回到Rs1保存的内存地址中，反之，写回的数值为Old自减1。
```

  - 某些场景下，以上操作不需要将Rs1地址保存的数据写回到Rd寄存器中，此时可将上述AMO指令的Rd寄存器指定为SR0，硬件也可针对该情况做相应的优化。
  - 特别的：当以下AMO指令目的寄存器为SR0时，编译器可生成伪指令，写作为red.func。

| 伪指令 | 指令 |
| --- | --- |
| red.add (rs1), rs2 | amo.add sr0, (rs1), rs2 |
| red.and (rs1), rs2 | amo.and sr0, (rs1), rs2 |
| red.or (rs1), rs2 | amo.or sr0, (rs1), rs2 |
| red.xor (rs1), rs2 | amo.xor sr0, (rs1), rs2 |
| red.max (rs1), rs2 | amo.max sr0, (rs1), rs2 |
| red.maxnum (rs1), rs2 | amo.maxnum sr0, (rs1), rs2 |
| red.min (rs1), rs2 | amo.min sr0, (rs1), rs2 |
| red.minnum (rs1), rs2 | amo.minnum sr0, (rs1), rs2 |
| red.inc (rs1) | amo.inc sr0, (rs1) |
| red.dec (rs1) | amo.dec sr0, (rs1) |

- 对于AMO向量指令：
  - 支持的操作如下表所示：

```text
操作    指令                     描述
add     redv.add (rs1), vaccs    根据VACCs寄存器保存的数据类型，将以Rs1保存的内存地址开始的连续内存空间上的数据，分别与VACCs各元素进行累加，结果保留在对应地址
max     redv.max (rs1),vaccs     将以Rs1保存的内存地址开始的连续内存空间上的数据，分别与VACCs各元素进行求最大值操作，将最大值存储在在对应地址
maxnum  redv.maxnum (rs1),vaccs  将以Rs1保存的内存地址开始的连续内存空间上的数据，分别与VACCs各元素进行求最大值操作，将最大值存储在在对应地址
```

  - 对于Vector Type的AMO操作，只保证向量操作中每个独立的Scalar Access的原子性，不保证整个向量指令的原子性。
- AMO系列指令均要求Per-element对齐，否则会触发非对齐异常。

### 8.4.14. AMO.CAS (new in 4.0)

```text
Name     Combo Name  47--32  31--27  26--25  24--23  22--21  20--16  15--11  10--6  5--2    1    0
AMO.CAS  V.AMO.CAS           Rs3     dwidth  dtype   N/A     Rd      Rs1     Rs2    opcode  VCE  CCE
```

```text
Name     Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
AMO.CAS  V.AMO.CAS   SLDST                                            1
```

AMO.CAS rd, (rs1), rs2, rs3

原子性比较和交换指令，根据dwidth域和dtype域，从Rs1保存的内存地址中读取32bit/64bit数据，存放至Rd寄存器中，若读出的数据与Rs2 寄存器的值相等，则将Rs3寄存器的值写回到Rs1保存的内存地址中，反之，对Rs1保存的内存地址的数据不做任何修改。

```text
/*-------以下操作保持原子性，不被打断-------*/
bits(64) address = SR[Rs1];
if (dwidth == 2) datasize = 32;
if (dwidth == 3) datasize = 64;
bits(datasize) comparevalue = SR[Rs2];
bits(datasize) newvalue = SR[Rs3];
bits(datasize) data = MEM[address];
MEM[address] = (comparevalue == data) ? newvalue ： data;
if(dtype == 0) {
    SR[Rd][63:0] = zero_extend(data);
} else if (dtype == 1) {
    SR[Rd][63:0] = sign_extend(data);
}
/*-------以上操作保持原子性，不被打断-------*/
```

部分功能位域说明：

- dwidth & dtype
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

### 8.4.15. AMO.EXCH (new in 4.0)

```text
Name      Combo Name  47--32  31--28     27   26--25  24--23  22--21  20--16  15--11  10--6  5--2    1    0
AMO.EXCH  V.AMO.EXCH          sub-code2  N/A  dwidth  dtype   N/A     Rd      Rs1     Rs2    opcode  VCE  CCE
```

```text
Name      Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
AMO.EXCH  V.AMO.EXCH  SLDST                                            1
```

AMO.EXCH rd, (rs1), rs2

原子性交换指令，根据dwidth域和dtype域，从Rs1保存的内存地址中读取32bit/64bit数据，存放至Rd寄存器中，将Rs2寄存器的值进行写回到Rs1保存的内存地址中。

```text
/*-------以下操作保持原子性，不被打断-------*/
bits(64) address = SR[Rs1];
if (dwidth == 1) datasize = 16;
if (dwidth == 2) datasize = 32;
if (dwidth == 3) datasize = 64;
bits(datasize) exchangevalue = SR[Rs2];
bits(datasize) data = MEM[address];
MEM[address] = exchangevalue;
if(dtype == 1) {
    SR[Rd][63:0] = sign_extend(data);
} else {
    SR[Rd][63:0] = zero_extend(data);
}
/*-------以上操作保持原子性，不被打断-------*/
```

部分功能位域说明：

- dwidth & dtype
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

### 8.4.16. AMO.ADD (new in 4.0)

```text
Name     Combo Name  47--32  31--28     27   26--25  24--23  22--21  20--16  15--11  10--6  5--2    1    0
AMO.ADD  V.AMO.ADD           sub-code2  N/A  dwidth  dtype   N/A     Rd      Rs1     Rs2    opcode  VCE  CCE
```

```text
Name     Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
AMO.ADD  V.AMO.ADD   SLDST                                            1
```

AMO.ADD rd, (rs1), rs2

原子性加法指令，根据dwidth域和dtype域，从Rs1保存的内存地址中读取32bit/64bit数据，存放至Rd寄存器中，并且将读出的数据与Rs2寄存器的值进行相加计算，再将计算后的结果写回到Rs1保存的内存地址中。

```text
/*-------以下操作保持原子性，不被打断-------*/
bits(64) address = SR[Rs1];
if (dwidth == 1) datasize = 16;
if (dwidth == 2) datasize = 32;
if (dwidth == 3) datasize = 64;
bits(datasize) addvalue = SR[Rs2];
bits(datasize) data = MEM[address];
MEM[address] = addvalue + data；
if(dtype == 1) {
    SR[Rd][63:0] = sign_extend(data);
} else {
    SR[Rd][63:0] = zero_extend(data);
}
/*-------以上操作保持原子性，不被打断-------*/
```

部分功能位域说明：

- dwidth & dtype
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| BF16 | dtype == 3 && dwidth == 1 |
| Other: Reserved | Other: Reserved |

- 当操作数类型为UINT/INT时，如果发生溢出，则保留LSB部分，不做saturation。
- 当操作数类型为FP16/FP32/BF16时：
  - subnormal输入输出不做flush to zero操作。
  - 舍入模式固定为Rounds to nearest even。

### 8.4.17. AMO.AND (new in 4.0)

```text
Name     Combo Name  47--32  31--28     27   26--25  24--23  22--21  20--16  15--11  10--6  5--2    1    0
AMO.AND  V.AMO.AND           sub-code2  N/A  dwidth  dtype   N/A     Rd      Rs1     Rs2    opcode  VCE  CCE
```

```text
Name     Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
AMO.AND  V.AMO.AND   SLDST                                            1
```

AMO.AND rd, (rs1), rs2

原子性逻辑与指令，根据dwidth域和dtype域，从Rs1保存的内存地址中读取32bit/64bit数据，存放至Rd寄存器中，并且将读出的数据与Rs2 寄存器的值进行按位与计算，再将计算后的结果写回到Rs1保存的内存地址中。

```text
/*-------以下操作保持原子性，不被打断-------*/
bits(64) address = SR[Rs1];
if (dwidth == 1) datasize = 16;
if (dwidth == 2) datasize = 32;
if (dwidth == 3) datasize = 64;
bits(datasize) value = SR[Rs2];
bits(datasize) data = MEM[address];
MEM[address] = value & data;
if(dtype == 0) {
    SR[Rd][63:0] = zero_extend(data);
} else if (dtype == 1) {
    SR[Rd][63:0] = sign_extend(data);
}
/*-------以上操作保持原子性，不被打断-------*/
```

部分功能位域说明：

- dwidth & dtype
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

### 8.4.18. AMO.OR (new in 4.0)

```text
Name    Combo Name  47--32  31--28     27   26--25  24--23  22--21  20--16  15--11  10--6  5--2    1    0
AMO.OR  V.AMO.OR            sub-code2  N/A  dwidth  dtype   N/A     Rd      Rs1     Rs2    opcode  VCE  CCE
```

```text
Name    Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
AMO.OR  V.AMO.OR    SLDST                                            1
```

AMO.OR rd, (rs1), rs2

原子性逻辑或指令，根据dwidth域和dtype域，从Rs1保存的内存地址中读取32bit/64bit数据，存放至Rd寄存器中，并且将读出的数据与Rs2 寄存器的值进行按位或计算，再将计算后的结果写回到Rs1保存的内存地址中。

```text
/*-------以下操作保持原子性，不被打断-------*/
bits(64) address = SR[Rs1];
if (dwidth == 2) datasize = 32;
if (dwidth == 3) datasize = 64;
bits(datasize) value = SR[Rs2];
bits(datasize) data = MEM[address];
MEM[address] = value | data;
if(dtype == 0) {
    SR[Rd][63:0] = zero_extend(data);
} else if (dtype == 1) {
    SR[Rd][63:0] = sign_extend(data);
}
/*-------以上操作保持原子性，不被打断-------*/
```

部分功能位域说明：

- dwidth & dtype
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

### 8.4.19. AMO.XOR (new in 4.0)

```text
Name     Combo Name  47--32  31--28     27   26--25  24--23  22--21  20--16  15--11  10--6  5--2    1    0
AMO.XOR  V.AMO.XOR           sub-code2  N/A  dwidth  dtype   N/A     Rd      Rs1     Rs2    opcode  VCE  CCE
```

```text
Name     Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
AMO.XOR  V.AMO.XOR   SLDST                                            1
```

AMO.XOR rd, (rs1), rs2

原子性逻辑异或指令，根据dwidth域和dtype域，从Rs1保存的内存地址中读取32bit/64bit数据，存放至Rd寄存器中，并且将读出的数据与 Rs2寄存器的值进行按位异或计算，再将计算后的结果写回到Rs1保存的内存地址中。

```text
/*-------以下操作保持原子性，不被打断-------*/
bits(64) address = SR[Rs1];
if (dwidth == 2) datasize = 32;
if (dwidth == 3) datasize = 64;
bits(datasize) value = SR[Rs2];
bits(datasize) data = MEM[address];
MEM[address] = value ^ data;
if(dtype == 0) {
    SR[Rd][63:0] = zero_extend(data);
} else if (dtype == 1) {
    SR[Rd][63:0] = sign_extend(data);
}
/*-------以上操作保持原子性，不被打断-------*/
```

部分功能位域说明：

- dwidth & dtype
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

### 8.4.20. AMO.MAX (new in 4.0)

```text
Name     Combo Name  47--32  31--28     27   26--25  24--23  22--21  20--16  15--11  10--6  5--2    1    0
AMO.MAX  V.AMO.MAX           sub-code2  N/A  dwidth  dtype   N/A     Rd      Rs1     Rs2    opcode  VCE  CCE
```

```text
Name     Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
AMO.MAX  V.AMO.MAX   SLDST                                            1
```

AMO.MAX rd, (rs1), rs2 原子性求最大值指令，根据dwidth域和dtype域，从Rs1保存的内存地址中读取32bit/64bit数据，存放至Rd寄存器中，并且将读出的数据与 Rs2寄存器的值进行取最大值计算，再将计算后的结果写回到Rs1保存的内存地址中。如果是浮点格式并且输入操作数中有NaN，则结果选择本ISA规定的标准NaN输出。请见NaN Result章节。

```text
/*-------以下操作保持原子性，不被打断-------*/
bits(64) address = SR[Rs1];
if (dwidth == 1) datasize = 16;
if (dwidth == 2) datasize = 32;
if (dwidth == 3) datasize = 64;
bits(datasize) value = SR[Rs2];
bits(datasize) data = MEM[address];
MEM[address] = max(value，data);
if(dtype == 1) {
    SR[Rd][63:0] = sign_extend(data);
} else {
    SR[Rd][63:0] = zero_extend(data);
}
/*-------以上操作保持原子性，不被打断-------*/
```

部分功能位域说明：

- dwidth & dtype
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| BF16 | dtype == 3 && dwidth == 1 |
| Other: Reserved | Other: Reserved |

### 8.4.21. AMO.MAXNUM (new in 4.0)

```text
Name        Combo Name    47--32  31--28     27   26--25  24--23  22--21  20--16  15--11  10--6  5--2    1    0
AMO.MAXNUM  V.AMO.MAXNUM          sub-code2  N/A  dwidth  dtype   N/A     Rd      Rs1     Rs2    opcode  VCE  CCE
```

```text
Name        Combo Name    Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
AMO.MAXNUM  V.AMO.MAXNUM  SLDST                                            1
```

AMO.MAXNUM rd, (rs1), rs2

原子性求最大值指令，根据dwidth域和dtype域，从Rs1保存的内存地址中读取32bit/64bit数据，存放至Rd寄存器中，并且将读出的数据与 Rs2寄存器的值进行取最大值计算，再将计算后的结果写回到Rs1保存的内存地址中。如果输入为浮点格式并且操作数只有一个NaN，则结果选择非NaN数值。如果浮点格式并且两个都是NaN，则结果选择本ISA规定的标准NaN输出。请见NaN Result章节。

```text
/*-------以下操作保持原子性，不被打断-------*/
bits(64) address = SR[Rs1];
if (dwidth == 1) datasize = 16;
if (dwidth == 2) datasize = 32;
if (dwidth == 3) datasize = 64;
bits(datasize) value = SR[Rs2];
bits(datasize) data = MEM[address];
MEM[address] = max(value，data);
if(dtype == 1) {
    SR[Rd][63:0] = sign_extend(data);
} else {
    SR[Rd][63:0] = zero_extend(data);
}
/*-------以上操作保持原子性，不被打断-------*/
```

部分功能位域说明：

- dwidth & dtype
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| BF16 | dtype == 3 && dwidth == 1 |
| Other: Reserved | Other: Reserved |

### 8.4.22. AMO.MIN (new in 4.0)

```text
Name     Combo Name  47--32  31--28     27   26--25  24--23  22--21  20--16  15--11  10--6  5--2    1    0
AMO.MIN  V.AMO.MIN           sub-code2  N/A  dwidth  dtype   N/A     Rd      Rs1     Rs2    opcode  VCE  CCE
```

```text
Name     Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
AMO.MIN  V.AMO.MIN   SLDST                                            1
```

AMO.MIN rd, (rs1), rs2

原子性求最小值指令，根据dwidth域和dtype域，从Rs1保存的内存地址中读取32bit/64bit数据，存放至Rd寄存器中，并且将读出的数据与 Rs2寄存器的值进行取最小值计算，再将计算后的结果写回到Rs1保存的内存地址中。如果是浮点格式并且输入操作数中有NaN，则结果选择本ISA规定的标准NaN输出。请见NaN Result章节。

```text
/*-------以下操作保持原子性，不被打断-------*/
bits(64) address = SR[Rs1];
if (dwidth == 2) datasize = 32;
if (dwidth == 3) datasize = 64;
bits(datasize) value = SR[Rs2];
bits(datasize) data = MEM[address];
MEM[address] = min(value，data);
if(dtype == 0) {
    SR[Rd][63:0] = zero_extend(data);
} else if (dtype == 1) {
    SR[Rd][63:0] = sign_extend(data);
}
/*-------以上操作保持原子性，不被打断-------*/
```

部分功能位域说明：

- dwidth & dtype
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

### 8.4.23. AMO.MINNUM (new in 4.0)

```text
Name        Combo Name    47--32  31--28     27   26--25  24--23  22--21  20--16  15--11  10--6  5--2    1    0
AMO.MINNUM  V.AMO.MINNUM          sub-code2  N/A  dwidth  dtype   N/A     Rd      Rs1     Rs2    opcode  VCE  CCE
```

```text
Name        Combo Name    Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
AMO.MINNUM  V.AMO.MINNUM  SLDST                                            1
```

AMO.MINNUM rd, (rs1), rs2

原子性求最小值指令，根据dwidth域和dtype域，从Rs1保存的内存地址中读取32bit/64bit数据，存放至Rd寄存器中，并且将读出的数据与 Rs2寄存器的值进行取最小值计算，再将计算后的结果写回到Rs1保存的内存地址中。如果输入为浮点格式并且操作数只有一个NaN，则结果选择非NaN数值。如果浮点格式并且两个都是NaN，则结果选择本ISA规定的标准NaN输出。请见NaN Result章节。

注：SIP4.0 AMO.MINNUM和AMO.MIN指令暂不支持浮点格式，AMO.MINNUM和AMO.MIN指令行为一致。

```text
/*-------以下操作保持原子性，不被打断-------*/
bits(64) address = SR[Rs1];
if (dwidth == 2) datasize = 32;
if (dwidth == 3) datasize = 64;
bits(datasize) value = SR[Rs2];
bits(datasize) data = MEM[address];
MEM[address] = min(value，data);
if(dtype == 0) {
    SR[Rd][63:0] = zero_extend(data);
} else if (dtype == 1) {
    SR[Rd][63:0] = sign_extend(data);
}
/*-------以上操作保持原子性，不被打断-------*/
```

部分功能位域说明：

- dwidth & dtype
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

### 8.4.24. AMO.INC (new in 4.0)

```text
Name     Combo Name  47--32  31--28     27   26--25  24--23  22--21  20--16  15--11  10--6  5--2    1    0
AMO.INC  V.AMO.INC           sub-code2  N/A  dwidth  dtype   N/A     Rd      Rs1     Rs2    opcode  VCE  CCE
```

```text
Name     Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
AMO.INC  V.AMO.INC   SLDST                                            1
```

AMO.INC rd, (rs1), rs2

原子性自增指令，根据dwidth域和dtype域，从Rs1保存的内存地址中读取32bit/64bit数据，存放至Rd寄存器中，并且将读出的数据Old与 Rs2寄存器保存的数据Val进行比较，如果Old大于等于Val，则将0写回到Rs1保存的内存地址中，反之，写回的数值为Old自增1。

```text
/*-------以下操作保持原子性，不被打断-------*/
bits(64) address = SR[Rs1];
if (dwidth == 1) datasize = 16;
if (dwidth == 2) datasize = 32;
if (dwidth == 3) datasize = 64;
bits(datasize) old = MEM[address];
bits(datasize) val = SR[RS2];
if (old >= val) {
    MEM[address] = 0;
} else {
    MEM[address] = old + 1;
}
if(dtype == 0) {
    SR[Rd][63:0] = zero_extend(old);
} else if (dtype == 1) {
    SR[Rd][63:0] = sign_extend(old);
}
/*-------以上操作保持原子性，不被打断-------*/
```

部分功能位域说明：

- dwidth & dtype
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT16 | dtype == 0 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- 如果发生溢出，则保留LSB部分，不做saturation。

### 8.4.25. AMO.DEC (new in 4.0)

```text
Name     Combo Name  47--32  31--28     27   26--25  24--23  22--21  20--16  15--11  10--6  5--2    1    0
AMO.DEC  V.AMO.DEC           sub-code2  N/A  dwidth  dtype   N/A     Rd      Rs1     Rs2    opcode  VCE  CCE
```

```text
Name     Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
AMO.DEC  V.AMO.DEC   SLDST                                            1
```

AMO.DEC rd, (rs1), rs2

原子性自减指令，根据dwidth域和dtype域，从Rs1保存的内存地址中读取32bit/64bit数据，存放至Rd寄存器中，并且将读出的数据Old与 Rs2寄存器保存的数据Val进行比较，如果Old大于Val或Old等于0，则将Val写回到Rs1保存的内存地址中，反之，写回的数值为Old自减1。

```text
/*-------以下操作保持原子性，不被打断-------*/
bits(64) address = SR[Rs1];
if (dwidth == 2) datasize = 32;
if (dwidth == 3) datasize = 64;
bits(datasize) old = MEM[address];
bits(datasize) val = SR[RS2];
if ((old == 0) || (old > val)) {
    MEM[address] = val;
} else {
    MEM[address] = old - 1;
}
if(dtype == 0) {
    SR[Rd][63:0] = zero_extend(data);
} else if (dtype == 1) {
    SR[Rd][63:0] = sign_extend(data);
}
/*-------以上操作保持原子性，不被打断-------*/
```

部分功能位域说明：

- dwidth & dtype
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT32 | dtype == 0 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- 如果发生溢出，则保留LSB部分，不做saturation。

## 8.5. VALU Type Instruction (Updated in 4.0)

在ISA4.0中，所有VALU指令(均为V-slot指令)都被删除，仅保留NOP指令

### 8.5.1. NOP

No operation.

```text
Name  Combo Name  47--32  31--27  26--23    22--6  5--2    1    0
NOP   V.NOP               N/A     sub-code  N/A    opcode  VCE  CCE
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
NOP   V.NOP       VALU                                            1
```

## 8.6. VMOV Type Instruction

本章节用于记录所有涉及到所有Vector/TAR寄存器的MOV操作指令，以及立即数初始化Vector/TAR寄存器的操作指令。这部分指令在ISA3.2 中归属VLDST类型指令。在本代ISA中归类为VMOV类指令

### 8.6.1. VLDI_LO.VA

```text
Name        Combo Name    47--32  31--16  15--6  5--1    0
VLDI_LO.VA  L.VLDI_LO.VA          Imm16   VACCd  opcode  1
```

```text
Name        Combo Name    Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
VLDI_LO.VA  L.VLDI_LO.VA  VMOV                            1
```

VLDI_LO.VA VACCd, Imm16

初始化VACC指令，VACC中保存的元素宽度视为32bit，指令通过16-bit立即数赋值给VACC中各元素的低16bit，其他域保持不变。指令不受 VL影响。

```text
for(i=0...VPT_NUM-1) { //loop each thread
    for(j=0...15) { //loop each 32bit element in VACC
        VA[i][VACCd_index][j] = (VA[i][VACCd_index][j] & 0xFFFF0000) | U-imm16;// on 32-bit basis for all 32-
bit data element
    }
}
```

**Field description:**

- `VACCd`
  - VACCd_index = VAB_VPT* + {3'b0, VACCd};

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`

### 8.6.2. VLDI_HI.VA

```text
Name        Combo Name    47--32  31--16  15--6  5--1    0
VLDI_HI.VA  L.VLDI_HI.VA          Imm16   VACCd  opcode  1
```

```text
Name        Combo Name    Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
VLDI_HI.VA  L.VLDI_HI.VA  VMOV                            1
```

VLDI_HI.VA VACCd, Imm16

初始化VACC指令，VACC中保存的元素宽度视为32bit，指令通过16-bit立即数赋值给VACC中各元素的高16bit，其他域保持不变。指令不受 VL影响。

```text
for(i=0...VPT_NUM-1) { //loop each thread
    for(j=0...15) { //loop each 32bit element in VACC
        VA[i][VACCd_index][j] = (VA[i][VACCd_index][j] & 0x0000FFFF) | (U-imm16<<16);// on 32-bit basis for
all 32-bit data element
    }
}
```

**Field description:**

- `VACCd`
  - VACCd_index = VAB_VPT* + {3'b0, VACCd};

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`

### 8.6.3. VLDI_LO.OA (new in 4.0)

```text
Name        Combo Name    47--32  31--16  15--14    13--6  5--1    0
VLDI_LO.OA  L.VLDI_LO.OA          Imm16   sub-code  OACCd  opcode  1
```

```text
Name        Combo Name    Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
VLDI_LO.OA  L.VLDI_LO.OA  VMOV                            1
```

VLDI_LO.OA OACCd, Imm16

初始化OACC指令，OACC中保存的元素宽度视为32bit，指令通过16-bit立即数赋值给OACC中各元素的低16bit，其他域保持不变。

```text
for(i=0...VPT_NUM-1) { //loop each thread
    for(j=0...15) { //loop each 32bit element in OACC
        OA[i][OACCd_index][j] = (OA[i][OACCd_index][j] & 0xFFFF0000) | U-imm16;// on 32-bit basis for all 32-
bit data element
    }
}
```

**Field description:**

- `OACCd`
  - VACCd_index = VAB_VPT* + {OACCd, 3'b0}
  - OACCd_index = VACCd_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.6.4. VLDI_HI.OA (new in 4.0)

```text
Name        Combo Name    47--32  31--16  15--14    13--6  5--1    0
VLDI_HI.OA  L.VLDI_HI.OA          Imm16   sub-code  OACCd  opcode  1
```

```text
Name        Combo Name    Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
VLDI_HI.OA  L.VLDI_HI.OA  VMOV                            1
```

VLDI_HI.OA OACCd, Imm16

初始化OACC指令，OACC中保存的元素宽度视为32bit，指令通过16-bit立即数赋值给OACC中各元素的高16bit，其他域保持不变。

```text
for(i=0...VPT_NUM-1) { //loop each thread
    for(j=0...127) { //loop each 32bit element in OACC
        OA[i][OACCd_index][j] = (OA[i][OACCd_index][j] & 0x0000FFFF) | (U-imm16<<16);// on 32-bit basis for
all 32-bit data element
    }
}
```

- `OACCd`
  - VACCd_index = VAB_VPT* + {OACCd, 3'b0}
  - OACCd_index = VACCd_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.6.5. VLDI_64p0.OA (new in 4.0)

```text
Name          Combo Name      47--32  31--16  15--14    13--6  5--1    0
VLDI_64p0.OA  L.VLDI_64p0.OA          Imm16   sub-code  OACCd  opcode  1
```

```text
Name          Combo Name      Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
VLDI_64p0.OA  L.VLDI_64p0.OA  VMOV                            1
```

VLDI_64p0.OA OACCd, Imm16

初始化OACC指令，OACC中保存的元素宽度视为64bit，指令通过16-bit立即数赋值给OACC中各元素最低16bit，其他域保持不变。

```text
for(i=0...VPT_NUM-1) { //loop each thread
    for(j=0...64) { //loop each 64bit element in OACC. Here is 64bit logic index， not VACC physical index
        OA[i][OACCd_index][j] = (OA[i][OACCd_index][j] & 0xFFFF_FFFF_FFFF_0000) | U-imm16;// on 64-bit basis
for all 64-bit data element
    }
}
```

**Field description:**

- `OACCd`
  - VACCd_index = VAB_VPT* + {OACCd, 3'b0}
  - OACCd_index = VACCd_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.6.6. VLDI_64p1.OA (new in 4.0)

```text
Name          Combo Name      47--32  31--16  15--14    13--6  5--1    0
VLDI_64p1.OA  L.VLDI_64p1.OA          Imm16   sub-code  OACCd  opcode  1
```

```text
Name          Combo Name      Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
VLDI_64p1.OA  L.VLDI_64p1.OA  VMOV                            1
```

VLDI_64p1.OA OACCd, Imm16

初始化OACC指令，OACC中保存的元素宽度视为64bit，指令通过16-bit立即数赋值给OACC中各元素的31~16bit，其他域保持不变。

```text
for(i=0...VPT_NUM-1) { //loop each thread
    for(j=0...64) { //loop each 64bit element in OACC. Here is 64bit logic index， not VACC physical index
        OA[i][OACCd_index][j] = (OA[i][OACCd_index][j] & 0xFFFF_FFFF_0000_FFFF) | (U-imm16 << 16);// on 64-bit
basis for all 64-bit data element
    }
}
```

**Field description:**

- `OACCd`
  - VACCd_index = VAB_VPT* + {OACCd, 3'b0}
  - OACCd_index = VACCd_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.6.7. VLDI_64p2.OA (new in 4.0)

```text
Name          Combo Name      47--32  31--16  15--14    13--6  5--1    0
VLDI_64p2.OA  L.VLDI_64p2.OA          Imm16   sub-code  OACCd  opcode  1
```

```text
Name          Combo Name      Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
VLDI_64p2.OA  L.VLDI_64p2.OA  VMOV                            1
```

VLDI_64p2.OA OACCd, Imm16

初始化OACC指令，OACC中保存的元素宽度视为64bit，指令通过16-bit立即数赋值给OACC中各元素的47~32bit，其他域保持不变。

```text
for(i=0...VPT_NUM-1) { //loop each thread
    for(j=0...64) { //loop each 64bit element in OACC. Here is 64bit logic index， not VACC physical index
        OA[i][OACCd_index][j] = (OA[i][OACCd_index][j] & 0xFFFF_0000_FFFF_FFFF) | (U-imm16 << 32);// on 64-bit
basis for all 64-bit data element
    }
}
```

**Field description:**

- `OACCd`
  - VACCd_index = VAB_VPT* + {OACCd, 3'b0}
  - OACCd_index = VACCd_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.6.8. VLDI_64p3.OA (new in 4.0)

```text
Name          Combo Name      47--32  31--16  15--14    13--6  5--1    0
VLDI_64p3.OA  L.VLDI_64p3.OA          Imm16   sub-code  OACCd  opcode  1
```

```text
Name          Combo Name      Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
VLDI_64p3.OA  L.VLDI_64p3.OA  VMOV                            1
```

VLDI_64p3.OA OACCd, Imm16

初始化OACC指令，OACC中保存的元素宽度视为64bit，指令通过16-bit立即数赋值给OACC中各元素的高16bit，其他域保持不变。

```text
for(i=0...VPT_NUM-1) { //loop each thread
    for(j=0...64) { //loop each 64bit element in OACC. Here is 64bit logic index， not VACC physical index
        OA[i][OACCd_index][j] = (OA[i][OACCd_index][j] & 0x0000_FFFF_FFFF_FFFF) | (U-imm16 << 48);// on 64-bit
basis for all 64-bit data element
    }
}
```

**Field description:**

- `OACCd`
  - VACCd_index = VAB_VPT* + {OACCd, 3'b0}
  - OACCd_index = VACCd_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.6.9. VCLR.OA (updated in 4.0)

```text
Name     Combo Name  47--32  31--27  26--23    22--16  15--6  5--1    0
VCLR.OA  L.VCLR.OA           N/A     sub-code  N/A     OACCd  opcode  1
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
VCLR.OA  L.VCLR.OA   VMOV                            1
```

VCLR.OA OACCd

执行对OACC进行清零操作。本指令不受VL影响。

```text
for(i=0...VPT_NUM-1) { //loop each thread
    for(j=0...127) { //loop each 32bit element in OACC
        OA[i][OACCd_index][j] = 0x0000_0000;
    }
}
```

**Field description:**

- `OACCd`
  - VACCd_index = VAB_VPT* + {OACCd, 3'b0}
  - OACCd_index = VACCd_index >> 3

**Implicit Use:**

- `TCTL`
- `VAB_VPT*`

### 8.6.10. MOVVA (updated in 4.0)

```text
Name   Combo Name  47--32  31--27     26--23    22--21  20--16     15--6  5--1    0
MOVVA  L.MOVVA             VACCs1_hi  sub-code  N/A     VACCs1_lo  VACCd  opcode  1
```

```text
Name   Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOVVA  L.MOVVA     VMOV                            1
```

MOVVA VACCd, VACCs1

MOVVA 执行对VACC寄存器的MOV操作。指令不受VL影响。

```text
for(i=0...VPT_NUM-1) { //loop each thread
    VA[i][VACCd_index] = VA[i][VACCs1_index];
}
```

**Field description:**

- {VACCs1_hi, VACCs1_lo}
  - VACCs1_index = VAB_VPT* + {3'b0, VACCs1_hi, VACCs1_lo};
- `VACCd`
  - VACCd_index = VAB_VPT* + {3'b0, VACCd};

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`

### 8.6.11. MOVOA (new in 4.0)

```text
Name   Combo Name  47--32  31--30    29  28--27  26   25--16  15--6  5--1    0
MOVOA  L.MOVOA             sub-code  vm  dwidth  N/A  OACCs1  OACCd  opcode  1
```

```text
Name   Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOVOA  L.MOVOA     VMOV                            1
```

MOVOA OACCd, OACCs1

MOVOA执行对OACC的MOV操作，并且支持按元素的条件写回(vm=0)。

```text
for(i=0...VPT_NUM-1) { //loop each thread
    OA[i][OACCd_index] = OA[i][OACCs1_index];
}
```

**Field description:**

- `OACCs1`
  - VACCs1_index = VAB_VPT* + {OACCs1, 3'b0}
  - OACCs1_index = VACCs1_index >> 3
- `OACCd`
  - VACCd_index = VAB_VPT* + {OACCd, 3'b0}
  - OACCd_index = VACCd_index >> 3
- `dwidth`
  - 0：移动的是8bit数据
  - 1：移动的是16bit数据
  - 2：移动的是32bit数据
  - 3：移动的是64bit数据
  - Other：Reserved
- `vm`
  - 0：每个元素按条件写回。所用的VA0的maskbit数由dwidth决定，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个 bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - 1：无条件写回。

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.6.12. REMAPVA (updated in 4.0)

```text
Name     Combo Name  47--44    43--41  40   39--37  36    35--26  25--22  21            20            19--16  15--6  5--2    1                   0
REMAPVA  M.REMAPVA   sub-code  N/A     LCE  N/A     dual  VACCs1  N/A     0(Const_0_3)  0(Const_0_2)  mode    VACCd  opcode  Const_0(Const_0_1)  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
REMAPVA  M.REMAPVA   VMOV                                    1
```

REMAPVA VACCd, VACCs1

支持将1VA/2VA根据数据进行交替/反交替自动排列。用于处理由8bit/16bit/64bit数据在VA中交替排列而形成的shuffle需求，而在必要时满足bitcast运算的remap操作。

ISA4.0中VACCs1域和VACCd域由12bit变更为10bit，并且新增了64bit<->32bit互相转换的模式

**Field description:**

- `dual`
  - 0：一次处理1个VA，VA index对齐到1
  - 1：一次处理2个VA，VA index对齐到2
    - 当数据格式之一为64bit时，必须选择dual域为1
  - 该域合法范围受到mode影响
- `mode`
  - 数据重排列规则
  - 0/1/3/4/6/7：8bit/16bit/64bit与32bit之间互相转换
  - 10/13：maskbit和8bit/16bit/32bit数据之间的转换。此时dual必须为0

| mode value | 格式转换 | 说明 |
| --- | --- | --- |
| 0 | 8bit->32bit |  |
| 1 | 16bit->32bit |  |
| 3 | 32bit->8bit |  |
| 4 | 32bit->16bit |  |
| 6 | 64bit->32bit | dual必须为1 |
| 7 | 32bit->64bit | dual必须为1 |
| 10 | maskbit->32bit | dual必须为0 |
| 13 | 32bit->maskbit | dual必须为0 |

- `VACCd`
  - VACCd_index = VAB_VPT* + {3'b0, VACCd}
- `VACCs1`
  - VACCs1_index =VAB_VPT* + {3'b0, VACCs1}
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
Remap示意图：

```text
634731        1562  46  30  14  61  45  29  13  60  44  28  12  59  43  27  11  58  42  26  10  57  41  25  9   56  40  24  8   55  39  23  7   54  38  22  6   53  37  21  5   52  36  20  4   51  35  19  3   50  34  18  2  4933  171  48  32  160
............
636261        6059  58  57  56  55  54  53  52  51  50  49  48  47  46  45  44  43  42  41  40  39  38  37  36  35  34  33  32  31  30  29  28  27  26  25  24  23  22  21  20  19  18  17  16  15  14  13  12  11  10  9   8  76    54   3   2   10
```

```text
0
REMAP:
mode: 8bit->32bit
Unit: byte
0
```

```text
636261        6059  58  57  56  55  54  53  52  51  50  49  48  47  46  45  44  43  42  41  40  39  38  37  36  35  34  33  32  31  30  29  28  27  26  25  24  23  22  21  20  19  18  17  16  15  14  13  12  11  10  9   8  76    54   3   2   10
............
634731        1562  46  30  14  61  45  29  13  60  44  28  12  59  43  27  11  58  42  26  10  57  41  25  9   56  40  24  8   55  39  23  7   54  38  22  6   53  37  21  5   52  36  20  4   51  35  19  3   50  34  18  2  4933  171  48  32  160
```

```text
0
REMAP:
mode: 32bit->8bit
Unit: byte
0
```

```text
634731  1562          46  30  14  61  45  29  13  60  44  28  12  59  43  27  11  58  42  26  10  57  41  25  9   56  40  24  8   55  39  23  7   54  38  22  6   53  37  21  5   52  36  20  4  51  35  19  3  50  34  18  2  4933  171  48  32  160
        ............
636231  3061          60  29  28  59  58  27  26  57  56  25  24  55  54  23  22  53  52  21  20  51  50  19  18  49  48  17  16  47  46  15  14  45  44  13  12  43  42  11  10  41  40  9   8  39  38  7   6  37  36  5   4  3534  32   33  32  10
```

```text
0
REMAP:
mode: 8bit->16bit
Unit: byte
0
```

```text
636231  3061          60  29  28  59  58  27  26  57  56  25  24  55  54  23  22  53  52  21  20  51  50  19  18  49  48  17  16  47  46  15  14  45  44  13  12  43  42  11  10  41  40  9   8  39  38  7   6  37  36  5   4  3534    32   33  32  10
        ............
634731  1562          46  30  14  61  45  29  13  60  44  28  12  59  43  27  11  58  42  26  10  57  41  25  9   56  40  24  8   55  39  23  7   54  38  22  6   53  37  21  5   52  36  20  4  51  35  19  3  50  34  18  2  493333  171  48  32  160
```

```text
0
REMAP:
mode: 16bit->8bit
Unit: byte
0
```

```text
3115          1530  14  29  13  28  12  27  11  26  10  25  9   24  8   23  7   22  6   21  5   20  4  19  3  18  2  17  1  16  0
............
3130          3029  28  27  26  25  24  23  22  21  20  19  18  17  16  15  14  13  12  11  10  9   8  7   6  5   4  3   2  1   0
```

```text
REMAP:
mode: 16bit->32bit
Unit: half word
```

```text
3130          3029  28  27  26  25  24  23  22  21  20  19  18  17  16  15  14  13  12  11  10  9   8  7   6  5   4  3   2  1   0
............
3115          1530  14  29  13  28  12  27  11  26  10  25  9   24  8   23  7   22  6   21  5   20  4  19  3  18  2  17  1  16  0
```

```text
REMAP:
mode: 32bit->16bit
Unit: half word
```

```text
E15_HiE14_Hi  E14_HiE13_Hi  E12_Hi  E11_Hi  E10_Hi  E9_Hi   E8_Hi   E7_Hi   E6_Hi   E5_Hi   E4_Hi   E3_Hi  E2_Hi  E1_Hi  E0_Hi  E15_Lo  E14_Lo  E13_Lo  E12_Lo  E11_Lo  E10_Lo  E9_Lo  E8_Lo  E7_Lo  E6_Lo  E5_Lo  E4_Lo  E3_Lo  E2_Lo  E1_Lo  E0_Lo

E15_HiE15_Lo  E15_LoE14_Hi  E14_Lo  E13_Hi  E13_Lo  E12_Hi  E12_Lo  E11_Hi  E11_Lo  E10_Hi  E10_Lo  E9_Hi  E9_Lo  E8_Hi  E8_Lo  E7_Hi   E7_Lo   E6_Hi   E6_Lo   E5_Hi   E5_Lo   E4_Hi  E4_Lo  E3_Hi  E3_Lo  E2_Hi  E2_Lo  E1_Hi  E1_Lo  E0_Hi  E0_Lo
```

```text
REMAP:
mode: 64bit->32bit
Unit: 4Byte
DACC to DACC
```

```text
E15_HiE15_Lo  E15_LoE14_Hi  E14_Lo  E13_Hi  E13_Lo  E12_Hi  E12_Lo  E11_Hi  E11_Lo  E10_Hi  E10_Lo  E9_Hi  E9_Lo  E8_Hi  E8_Lo  E7_Hi   E7_Lo   E6_Hi   E6_Lo   E5_Hi   E5_Lo   E4_Hi  E4_Lo  E3_Hi  E3_Lo  E2_Hi  E2_Lo  E1_Hi  E1_Lo  E0_Hi  E0_Lo

E15_HiE14_Hi  E14_HiE13_Hi  E12_Hi  E11_Hi  E10_Hi  E9_Hi   E8_Hi   E7_Hi   E6_Hi   E5_Hi   E4_Hi   E3_Hi  E2_Hi  E1_Hi  E0_Hi  E15_Lo  E14_Lo  E13_Lo  E12_Lo  E11_Lo  E10_Lo  E9_Lo  E8_Lo  E7_Lo  E6_Lo  E5_Lo  E4_Lo  E3_Lo  E2_Lo  E1_Lo  E0_Lo
```

```text
REMAP:
mode: 32bit->64bit
Unit: 4Byte
DACC to DACC
```

### 8.6.13. VLDI_MB (updated in 4.0)

```text
Name     Combo Name  47--44    43--42  41         40   39--38  37--36    35--32  31--26         25--16       15--6     5--2    1        0
VLDI_MB  M.VLDI_MB   sub-code  N/A     mb_idx_hi  LCE  N/A     vpt_mode  mb_idx  uimm16[15:10]  uimm16[9:0]  VACCs3/d  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
VLDI_MB  M.VLDI_MB   VMOV                                    1
```

VLDI_MB VACCs3/d, Imm16, mb_idx

利用16bit立即数更新数据格式为maskbit的VACC寄存器。这条指令会根据Accumulation Register File中规定的maskbit的数据排列格式，自动将逻辑上的16bit位放置到VACC存储的物理位置上，做到软件使用时无感。

在ISA4.0中，本指令得到如下变化：

- QACCs3/d被更新为VACCs3/d域
- 扩展mb_idx为5bit，支持更新512bit的maskbit

**Field description:**

- `VACCs3/d`
  - VACCs3_index = VAB_VPT* + {3'b0, VACCs3/d}
  - VACCd_index = VAB_VPT* + {3'b0, VACCs3/d}
- {mb_idx_hi, mb_idx}
  - 在本指令中有效范围0~31
    - maskbit有效范围最大是512bit，因此用16bit立即数更新maskbit需要32个index
  - 输入的uimm-16，修改maskbit[16*mb_idx + 15: 16*mb_idx]区域
- `vpt_mode`
  - 0：只更新VPT0的VACCs3/d；当TCTL设置不使能VPT0时，此时指令视为NOP
  - 1：只更新VPT1的VACCs3/d；当TCTL设置不使能VPT1时，此时指令视为NOP
  - 2：同时更新VPT0和VPT1的VACCs3/d；如果TCTL设置某VPT不使能，则该VPT下，指令视为NOP

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`

### 8.6.14. MOVSR2MB (updated in 4.0)

```text
Name      Combo Name  47--44    43--42  41         40   39--38  37--36    35--32  31--21  20--16  15--6     5--2    1        0
MOVSR2MB  M.MOVSR2MB  sub-code  N/A     mb_idx_hi  LCE  N/A     vpt_mode  mb_idx  N/A     Rs1     VACCs3/d  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOVSR2MB  M.MOVSR2MB  VMOV                                    1
```

MOVSR2MB VACCs3/d, Rs1, mb_idx

利用SR中的32bit数据更新maskbit的QACC寄存器。这条指令会根据Accumulation Register File中规定的maskbit的数据排列格式，自动将逻辑上的32bit位放置到QACC存储的物理位置上，做到软件使用时无感。

在ISA4.0中，本指令得到如下变化：

- QACCs3/d被更新为VACCs3/d域
- 扩展mb_idx为5bit

**Field description:**

- `VACCs3/d`
  - VACCs3_index = VAB_VPT* + {3'b0, VACCs3/d}
  - VACCd_index = VAB_VPT* + {3'b0, VACCs3/d}
- {mb_idx_hi, mb_idx}
  - 在本指令中有效范围0~15，其余数值为reserved
    - maskbit有效范围最大是512bit，因此用32bit立即数更新maskbit需要16个index
  - 输入SR数值，修改maskbit[32*mb_idx + 31: 32*mb_idx]区域
- `vpt_mode`
  - 0：只更新VPT0的VACCs3/d；当TCTL设置不使能VPT0时，此时指令视为NOP
  - 1：只更新VPT1的VACCs3/d；当TCTL设置不使能VPT1时，此时指令视为NOP
  - 2：同时更新VPT0和VPT1的VACCs3/d；如果TCTL设置某VPT不使能，则该VPT下，指令视为NOP

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`

### 8.6.15. VSET_MB (updated in 4.0)

```text
Name     Combo Name  47--44    43--42  41   40   39--38  37--36    35--21  20--16  15--6  5--2    1        0
VSET_MB  M.VSET_MB   sub-code  dwidth  N/A  LCE  N/A     vpt_mode  N/A     Rs1     VACCd  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
VSET_MB  M.VSET_MB   VMOV                                    1
```

VSET_MB VACCs3/d, Rs1

本指令用SR中的数值设置maskbit的VACC寄存器。对于不同数据格式下，当maskbit的index小于SR数值时，maskbit设置为1，否则设置为 0。不同数据格式下，每一个VACC中的maskbit有最大数量限制。其中8bit为512，16bit为256，32bit为128，64bit为64。因此总的 maskbit限制为512/256/128/64bit。如果SR数值超过限制，此时该指令依然可以正常工作。

在ISA4.0中，本指令获得以下更新：

- QACCs3/d被更新为VACCs3/d域
- 支持64bit数据格式
- 增加了vpt_mode，用于选择对不同VPT的maskbti更新情况。
- 本指令不受VL影响；

```text
if(dwidth == 0)
    limit = 512;
else if(dwidth == 1)
    limit = 256;
else if(dwidth == 2)
    limit = 128;
else
    limit = 64;
if(vpt_mode == 0 || vpt_mode == 2)
    for(j = 0; j < limit; j ++) {
        VACC[0][VACCd_index][j] = (j < SR[Rs1]) ? 1 : 0;
    }
}
if(vpt_mode == 1 || vpt_mode == 2)
    for(j = 0; j < limit; j ++) {
        VACC[1][VACCd_index][j] = (j < SR[Rs1]) ? 1 : 0;
    }
}
if(vpt_mode == 3) { //对2个VPT OACC合起来做操作
    for(i = 0; i < VPT_NUM - 1; i ++) {
        for(j = 0; j < limit; j ++) {
            VACC[i][VACCd_index][j] = ((j + i * limit) < SR[Rs1]) ? 1 : 0;
        }
    }
}
```

**Field description:**

- `VACCs3/d`
  - VACCs3_index = VAB_VPT* + {3'b0, VACCs3/d}
  - VACCd_index = VAB_VPT* + {3'b0, VACCs3/d}
- `dwidth`
  - 0：更新8bit数据的maskbit，maskbit范围0~511bit
  - 1：更新16bit数据的maskbit，maskbit范围0~255bit
  - 2：更新32bit数据的maskbit，maskbit范围0~127bit
  - 3：更新64bit数据的maskbit，maskbit范围0~63bit
- `vpt_mode`
  - 0：只更新VPT0的VACCs3/d；当TCTL设置不使能VPT0时，此时指令视为NOP
  - 1：只更新VPT1的VACCs3/d；当TCTL设置不使能VPT1时，此时指令视为NOP
  - 2：同时更新VPT0和VPT1的VACCs3/d；如果TCTL设置某VPT不使能，则该VPT下，指令视为NOP
  - 3 ：根据SR的数值，决定更新VPT0和VPT1的VACCs3/d情况；如果TCTL设置某VPT不使能，则该VPT下，指令视为NOP

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`

### 8.6.16. VSETI_MB (updated in 4.0)

```text
Name      Combo Name  47--44    43--42  41   40   39--38  37--36    35--26  25--16       15--6  5--2    1        0
VSETI_MB  M.VSETI_MB  sub-code  dwidth  N/A  LCE  N/A     vpt_mode  N/A     uimm10[9:0]  VACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
VSETI_MB  M.VSETI_MB  VMOV                                    1
```

VSETI_MB VACCs3/d, Imm10

ISA3.2新增指令，并在ISA4.0中语义得到升级。本指令用立即数设置maskbit的VACC寄存器。对于不同数据格式下，当maskbit的index小于立即数数值时，maskbit设置为1，否则设置为0。本指令是VSET_MB的立即数版本。

不同数据格式下，每一个VACC中的maskbit有最大数量限制。其中8bit为512，16bit为256，32bit为128，64bit为64。因此总的maskbit限制为512/256/128/64bit。如果SR数值超过限制，此时该指令依然可以正常工作。

在ISA4.0中，本指令获得以下更新：

- QACCs3/d被更新为VACCs3/d域
- 支持64bit数据格式
- 增加了vpt_mode，用于选择对不同VPT的maskbti更新情况。
- 本指令不受VL影响；

```text
if(dwidth == 0)
    limit = 512;
else if(dwidth == 1)
    limit = 256;
else if(dwidth == 2)
    limit = 128;
else
    limit = 64;
if(vpt_mode == 0 || vpt_mode == 2)
    for(j = 0; j < limit; j ++) {
        VACC[0][VACCd_index][j] = (j < uimm10) ? 1 : 0;
    }
}
if(vpt_mode == 1 || vpt_mode == 2)
    for(j = 0; j < limit; j ++) {
        VACC[1][VACCd_index][j] = (j < uimm10) ? 1 : 0;
    }
}
if(vpt_mode == 3) { //对2个VPT OACC合起来做操作
    for(i = 0; i < VPT_NUM - 1; i ++) {
        for(j = 0; j < limit; j ++) {
            VACC[i][VACCd_index][j] = ((j + i * limit) < uimm10) ? 1 : 0;
        }
    }
}
```

**Field description:**

- `VACCs3/d`
  - VACCs3_index = VAB_VPT* + {3'b0, VACCs3/d}
  - VACCd_index = VAB_VPT* + {3'b0, VACCs3/d}
- `dwidth`
  - 0：更新8bit数据的maskbit，maskbit范围0~511bit
  - 1：更新16bit数据的maskbit，maskbit范围0~255bit
  - 2：更新32bit数据的maskbit，maskbit范围0~127bit
  - 3：更新64bit数据的maskbit，maskbit范围0~63bit
- `vpt_mode`
  - 0：只更新VPT0的VACCs3/d；当TCTL设置不使能VPT0时，此时指令视为NOP
  - 1：只更新VPT1的VACCs3/d；当TCTL设置不使能VPT1时，此时指令视为NOP
  - 2：同时更新VPT0和VPT1的VACCs3/d；如果TCTL设置某VPT不使能，则该VPT下，指令视为NOP
  - 3 ：根据uimm10的数值，决定更新VPT0和VPT1的VACCs3/d情况；如果TCTL设置某VPT不使能，则该VPT下，指令视为NOP

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`

### 8.6.17. AGGR_MB (update in 4.0)

```text
Name     Combo Name  47--32  31--30    29   28--27  26--23    22--21  20--16  15--6   5--2    1    0
AGGR_MB  V.AGGR_MB           vpt_mode  N/A  dwidth  sub-code  mode    Rd      VACCs1  opcode  VCE  CCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
AGGR_MB  V.AGGR_MB   VMOV                                            1
```

AGGR_MB Rd, VACCs1

指令每次从两个VPT其中之一VACC中读出maskbit，做逻辑操作之后写回到SR寄存器中。

在ISA4.0中，本指令得到如下变化

- QACCs1被更新为VACCs1域
- 增加64bit数据格式的支持
- 增加VL支持
  - 注意：对于index大于等于VL部分的maskbit，不能参与运算
  - 当VL=0时：
    - mode == 0时回写Rd为0
    - mode == 1 时回写Rd为1
    - mode == 2时回写Rd为1
    - mode == 3时回写Rd为0

```text
###define va_union 3
int maskbit;
////从VACC中，maskbit逻辑0开始，获取长度为2^(6+va_union-dwidth)的bit长度，这里都是逻辑bit
maskbit = get_maskbit(VACC[vpt_mode][VACCs1_index], 0, (2^(6 + va_union - dwidth)));
int tmp_value
if(mode == 0 || mode == 2) {
    tmp_value = 0;
} else {
    tmp_value = 1;
}
for(int i = 0; i < min((2^(6 + va_union - dwidth)), VL); i ++) {
    if(mode == 0 || mode == 2) {
        tmp_value = |maskbit[0];//mode=0按位或，mode=2按位或后取反
    } else{
        tmp_value = &maskbit[0];//mode=0按位与，mode=2按位与后取反
    maskbit = maskbit >> 1;
}
if(mode == 0 || mode == 1){
    SR[Rd] = tmp_value;
} else {
    SR[Rd] = ~tmp_value;
}
```

**Field description:**

- `VACCs1`
  - VACCs1_index = VAB_VPT* + {3'b0, VACCs1}
- `vpt_mode`
  - 0：选择VPT0的maskbit；当TCTL设置不使能VPT0时，此时指令视为NOP
  - 1：选择VPT1的maskbit；当TCTL设置不使能VPT1时，此时指令视为NOP
- `dwidth`
  - 根据数据位宽选择VACC中maskbit的bit数。请注意这里是maskbit的逻辑bit位置
  - dwidth=0 ：8bit格式OACC对应的maskbit，选择maskbit[511:0]
  - dwidth=1 ：16bit格式OACC对应的maskbit，选择maskbit[255:0]
  - dwidth=2 ：32bit格式OACC对应的maskbit，选择maskbit[127:0] dwidth=3 ：64bit格式OACC对应的maskbit，选择maskbit[63:0]
- `mode`
  - 0：按位或
  - 1：按位与
  - 2：按位或之后取反
  - 3：按位与之后取反

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.6.18. POPC_MB (new in 4.0)

```text
Name     Combo Name  47--32  31--30    29   28--27  26--23    22--21  20--16  15--6   5--2    1    0
POPC_MB  V.POPC_MB           vpt_mode  N/A  dwidth  sub-code  N/A     Rd      VACCs1  opcode  VCE  CCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
POPC_MB  V.POPC_MB   VMOV                                            1
```

POPC_MB Rd, VACCs1

ISA4.0新增指令，每次从两个VPT其中之一VACC中读出maskbit，累加其中bit1的个数之后写回到SR寄存器中。支持VL。

- 注意：对于index大于等于VL部分的maskbit，不能参与运算
- 当VL=0时：回写Rd为0

```text
###define va_union 3
int maskbit;
////从VACC中，maskbit逻辑0开始，获取长度为2^(6+va_union-dwidth)的bit长度，这里都是逻辑bit
maskbit = get_maskbit(VACC[vpt_mode][VACCs1_index], 0, (2^(6 + va_union - dwidth)));
int tmp_value = 0;
for(int i = 0; i < min((2^(6 + va_union - dwidth)), VL); i ++) {
    tmp_value += (maskbit & 0x1);
    maskbit = maskbit >> 1;
}
SR[Rd] = tmp_value;
```

**Field description:**

- `VACCs1`
  - VACCs1_index = VAB_VPT* + {3'b0, VACCs1}
- `dwidth`
  - 根据数据位宽选择VACC中maskbit的bit数。请注意这里是maskbit的逻辑bit位置
  - dwidth=0 ：8bit格式OACC对应的maskbit，选择maskbit[511:0]
  - dwidth=1 ：16bit格式OACC对应的maskbit，选择maskbit[255:0]
  - dwidth=2 ：32bit格式OACC对应的maskbit，选择maskbit[127:0]
  - dwidth=3 ：64bit格式OACC对应的maskbit，选择maskbit[63:0]
- `vpt_mode`
  - 0：选择VPT0的maskbit；当TCTL设置不使能VPT0时，此时指令视为NOP
  - 1：选择VPT1的maskbit；当TCTL设置不使能VPT1时，此时指令视为NOP

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.6.19. FIRST_MB (new in 4.0)

```text
Name      Combo Name  47--32  31--30    29  28--27  26--23    22--21  20--16  15--6   5--2    1    0
FIRST_MB  V.FIRST_MB          vpt_mode  vm  dwidth  sub-code  N/A     Rd      VACCs1  opcode  VCE  CCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
FIRST_MB  V.FIRST_MB  VMOV                                            1
```

FIRST_MB Rd, VACCs1

ISA4.0新增指令。指令输入寄存器VACCs1为Maskbit寄存器，输出为标量寄存器Rd，同时指令支持条件回写，即受到隐式寄存器vm的影响。指令操作向量寄存器位宽固定为VACC，指令编码中通过10bitVACC域寻址。

当vm=1时：指令从逻辑Index最低位开始搜索maskbit寄存器VACCs1中，找到第一个VACCs1[i]==1的元素，将Index i写回Rd寄存器。如果没有VACCs1[i]==1的元素，则向Rd中写入-1。

当vm=0时:指令从逻辑Index最低位开始搜索maskbit寄存器VACCs1中，找到第一个VACCs1[i]==1 且 mask[i] == 1的元素，将Index i写回Rd 寄存器。如果没有VACCs1[i]==1 且 mask[i] == 1 的元素，则向Rd中写入-1。

指令支持VL，当VL=0时：回写Rd为-1

**Field description:**

- `VACCs1`
  - VACC1_index = VACC1 + VAB_VPT*;
- `vm`
  - vm = 0时，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为maskbit输入。
  - vm = 1时
- `dwidth`
  - 根据数据位宽选择VACC中maskbit的bit数。请注意这里是maskbit的逻辑bit位置
  - dwidth=0 ：8bit格式OACC对应的maskbit，选择maskbit[511:0]
  - dwidth=1 ：16bit格式OACC对应的maskbit，选择maskbit[255:0]
  - dwidth=2 ：32bit格式OACC对应的maskbit，选择maskbit[127:0]
  - dwidth=3 ：64bit格式OACC对应的maskbit，选择maskbit[63:0]
- `vpt_mode`
  - 0：选择VPT0的maskbit；当TCTL设置不使能VPT0时，此时指令视为NOP
  - 1：选择VPT1的maskbit；当TCTL设置不使能VPT1时，此时指令视为NOP

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.6.20. MOVR2VA.mode1 (updated in 4.0)

```text
Name           Combo Name       47--32  31--29  28--27  26--23    22--21  20--16  15--6  5--1    0
MOVR2VA.mode1  L.MOVR2VA.mode1          N/A     dwidth  sub-code  N/A     Rs1     OACCd  opcode  1
```

```text
Name           Combo Name       Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOVR2VA.mode1  L.MOVR2VA.mode1  VMOV                            1
```

MOVR2VA.mode1 OACCd, Rs1 MOVR2VA.mode1 将一个32bit或者64bit数值复制到OACC的所有datalane上。

在ISA4.0中，本指令有如下变化

- 10bitOACC域
- 增加了对64bit元素的支持
- 增加了对OACC的支持
- 增加对VL的支持

```text
VACCd += VAB_VPT*;
if(dwidth == 2) {
    for k = 0...7
        for i = 0...VPT_NUM-1 //loop each thread
            for j = 0...15
                VA[i][VACCd_index + k].w32_bits[j] = SR[Rs1];
} else if(dwidth == 3) {
    for i = 0...VPT_NUM-1
        for k = 0...3
            for j = 0...15
                VA[i][VACCd_index+2*k].w32_bits[j] = (SR[Rs1] & 0xFFFF_FFFF);
                VA[i][VACCd_index+2*k+1].w32_bits[j] = (SR[Rs1] >> 32);
}
```

**Field description:**

- `dwidth`
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth为
  - 0x2：32bit数据
  - 0x3：64bit数据
- `OACCd`
  - VACCd_index = VAB_VPT* + {OACCd, 3'b0}

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.6.21. MOVR2VA.mode2 (updated in 4.0)

```text
Name           Combo Name       47--32  31--30    29   28--27  26                  25--21  20--16  15--6  5--1    0
MOVR2VA.mode2  L.MOVR2VA.mode2          vpt_mode  N/A  dwidth  Const_1(Const_1_2)  Rs1     Rs2     OACCd  opcode  1(Const_1_1)
```

```text
Name           Combo Name       Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOVR2VA.mode2  L.MOVR2VA.mode2  VMOV                            1
```

MOVR2VA.mode2 OACCd, Rs2, Rs1

MOVR2VA.mode2 为ISA3.2新增指令。在ISA4.0中本指令语义扩展如下：

通过vpt_mode域指定VPT，用SR[Rs1]的数值作为index，表示写入该VPT对应OACCd中某个元素位置。写入的元素根据数值格式为SR[Rs2] 中的低8bit，16bit，32bit或者是64bit。如果index超过了8个VA的范围，则等效为NOP操作。

```text
if (SR[Rs1] < (512/2^dwidth) && SR[Rs1] < VL) {
    OACC[vpt_mode][OACCd_index][SR[Rs1]] = SR[Rs2];
}
```

**Field description:**

- `dwidth`
  - 0：向dst寄存器写入8bit数据
  - 1：向dst寄存器写入16bit数据 2：向dst寄存器写入32bit数据
  - 3：向dst寄存器写入64bit数据
- `Rs1`
  - 写入元素的在OACC中的逻辑index
    - SR[Rs1]的数值大于等于2^(9-dwidth)时，视为NOP
  - 关于逻辑index和物理index的关系，请见VACC Data Element Mapping
- `vpt_mode`
  - 0：使能VPT0；当TCTL设置不使能VPT0时，此时指令视为NOP
  - 1：使能VPT1；当TCTL设置不使能VPT1时，此时指令视为NOP
- `OACCd`
  - VACCd_index = VAB_VPT* + {OACCd, 3'b0}
  - OACCd_index = VACCd_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.6.22. MOVVA2R.mode2 (updated in 4.0)

```text
Name           Combo Name       47--32  31--30    29   28--27  26        25--21  20--16  15--6   5--2    1    0
MOVVA2R.mode2  V.MOVVA2R.mode2          vpt_mode  N/A  dwidth  sub-code  Rs1     Rd      OACCs1  opcode  VCE  CCE
```

```text
Name           Combo Name       Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOVVA2R.mode2  V.MOVVA2R.mode2  VMOV                                            1
```

MOVVA2R.mode2 Rd, OACCs1, Rs1

MOVVA2R.mode2 为ISA3.2新增指令。在ISA4.0中本指令语义扩展如下：

通过vpt_mode域指定VPT，用SR[Rs1]的无符号整数作为index，将该VPT对应OACCs1中该位置的元素读出，并进行符号扩展后写入Rd。读出的元素根据数值格式为8bit，16bit，32bit或者是64bit。

当出现以下情况时，回写Rd为0：

- index超过了8个VA的范围
- index的值大于等于vl的值
- vl = 0

```text
SR[rd] = 0
if (SR[Rs1] < (512/2^dwidth) && SR[Rs1] < VL) {
    SR[rd] = sign_ext(OACC[vpt_mode][OACCs1_index][SR[Rs1]])
}
```

**Field description:**

- `dwidth`
  - 0：从OACC读出8bit数据
  - 1：从OACC读出16bit数据
  - 2：从OACC读出32bit数据
  - 3：从OACC读出64bit数据
- `Rs1`
  - 读出元素在OACC中的逻辑index
    - SR[Rs1]的数值大于等于2^(9-dwidth)时，视为NOP
  - 关于逻辑index和物理index的关系，请见VACC Data Element Mapping
- `OACCs1`
  - VACCs1_index = VAB_VPT* + {QACCs1, 3'b0}; OACCs1_index = VACCs1_index >> 3
- `vpt_mode`
  - 0：使能VPT0；当TCTL设置不使能VPT0时，此时指令视为NOP
  - 1：使能VPT1；当TCTL设置不使能VPT1时，此时指令视为NOP

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.6.23. VLDI_TAR.T0, VLDI_TAR.T1, VLDI_TAR.DUAL (updated in 4.0)

```text
Name         Combo Name     47--32  31--27              26--23    22               21        20--16            15--11  10--6             5--1
VLDI_TAR.T0  L.VLDI_TAR.T0          Imm5(Imm16[15:11])  sub-code  Imm1(Imm16[10])  sign_ext  Imm5(Imm16[9:5])  TARd    Imm5(Imm16[4:0])  opcode
```

```text
Name         Combo Name     Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
VLDI_TAR.T0  L.VLDI_TAR.T0  VMOV                            1
```

```text
Name         Combo Name     47--32  31--27              26--23    22               21        20--16            15--11  10--6             5--1
VLDI_TAR.T1  L.VLDI_TAR.T1          Imm5(Imm16[15:11])  sub-code  Imm1(Imm16[10])  sign_ext  Imm5(Imm16[9:5])  TARd    Imm5(Imm16[4:0])  opcode
```

```text
Name         Combo Name     Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
VLDI_TAR.T1  L.VLDI_TAR.T1  VMOV                            1
```

```text
Name           Combo Name       47--32  31--27              26--23    22               21        20--16            15--11  10--6             5--1
VLDI_TAR.DUAL  L.VLDI_TAR.DUAL          Imm5(Imm16[15:11])  sub-code  Imm1(Imm16[10])  sign_ext  Imm5(Imm16[9:5])  TARd    Imm5(Imm16[4:0])  opcode
```

```text
Name           Combo Name       Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
VLDI_TAR.DUAL  L.VLDI_TAR.DUAL  VMOV                            1
```

VLDI_TAR.T0 TARd Imm16

- TARd[0][TARd] = ext(Imm-16):将立即数进行扩展后写入VPT0的TAR寄存器中；当TCTL设置不使能VPT0时，此时指令视为NOP
VLDI_TAR.T1 TARd Imm16

- TARd[1][TARd] = ext(Imm-16):将立即数进行扩展后写入VPT1的TAR寄存器中；当TCTL设置不使能VPT1时，此时指令视为NOP
VLDI_TAR.DUAL TARd Imm16

- TARd[0][TARd] = TARd[1][TARd] = ext(Imm-16) :将立即数进行扩展后写入两个VPT相同index的TAR寄存器中；如果TCTL设置某VPT不使能，则该VPT下，指令视为NOP
这三条指令都是使用立即数改写TAR寄存器。在ISA4.0中修改了如下：

- bit域修改为5bit的TARd，取代了原先的3bit TAR_pos + 2bit TARd
- 增加了sign_ext域，扩展了语义

**Field description:**

- `sign_ext`
  - 1：数据进行符号位扩展
  - 0：数据进行0扩展

**Implicit Use:**

- `TCTL`

### 8.6.24. MOVSR2TAR.EXT (updated in 4.0)

```text
Name           Combo Name       47--32  31--29  28--27    26--23    22     21       20--16  15--11  10--6  5--1    0
MOVSR2TAR.EXT  L.MOVSR2TAR.EXT          N/A     vpt_mode  sub-code  range  Const_0  Rs1     TARd    N/A    opcode  1
```

```text
Name           Combo Name       Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOVSR2TAR.EXT  L.MOVSR2TAR.EXT  VMOV                            1
```

MOVSR2TAR.EXT TARd, Rs1

ISA3.2新增指令，根据模式不同将SR中32bit或者64数据分别送到VPT0/VPT1的TAR中，或者同时送给VPT0和VPT1

ISA4.0中增加了range域。这是为了实现64bit SR/TAR对ISA3.2中32bit SR/TAR的支持，bit域修改为5bit的TARd，取代了原先的3bit TAR_pos + 2bit TARd

**Field description:**

- `vpt_mode`
  - mode == 0: TAR[0][TARd] = SR[Rs1]; 即只写VPT0的TAR；当TCTL设置不使能VPT0时，此时指令视为NOP
  - mode == 1: TAR[1][TARd] = SR[Rs1]; 即只写VPT1的TAR；当TCTL设置不使能VPT1时，此时指令视为NOP
  - mode == 2: TAR[0][TARd] = TAR[1][TARd] = SR[Rs1]; 同时写VPT0和VPT1的TAR；如果TCTL设置某VPT不使能，则该VPT下，指令视为NOP
  - Other：Reserved
- range：
  - 0：写入TAR寄存器的数值为SR的低32bit做符号位扩展后的结果
  - 1：写入TAR寄存器的数值为SR中完整的64bit

**Implicit Use:**

- `TCTL`

### 8.6.25. MOVTAR2SR.EXT (updated in 4.0)

```text
Name           Combo Name       47--32  31--29  28--27    26--23    22     21                  20--16  15--11  10--6  5--1    0
MOVTAR2SR.EXT  L.MOVTAR2SR.EXT          N/A     vpt_mode  sub-code  range  Const_1(Const_1_2)  TARs1   N/A     Rd     opcode  1(Const_1_1)
```

```text
Name           Combo Name       Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOVTAR2SR.EXT  L.MOVTAR2SR.EXT  VMOV                            1
```

MOVTAR2SR.EXT Rd, TARs1

ISA3.2新增指令，根据模式不同VPT0/VPT1中的32bit或者64bit写入SR中

ISA4.0中增加了range域。ISA4.0中增加了range域。这是为了实现64bit SR/TAR对ISA3.2中32bit SR/TAR的支持，bit域修改为5bit的 TARs1，取代了原先的3bit TAR_pos + 2bit TARs1

**Field description:**

- `vpt_mode`
  - mode == 0: SR[Rd] = TAR[0][TARs]; 即只读取VPT0的TAR;当TCTL设置不使能VPT0时，此时指令视为NOP
  - mode == 1: SR[Rd] = TAR[1][TARs]; 即只读取VPT1的TAR;当TCTL设置不使能VPT1时，此时指令视为NOP
  - Other：Reserved
- range：
  - 0：只读取TAR寄存器的低32bit，高32bit拼接全0，然后写回SR
  - 1：读取TAR寄存器完整的64bit，写回SR

**Implicit Use:**

- `TCTL`

### 8.6.26. MOVTAR.T0, MOVTAR.T1, MOVTAR.DUAL

```text
Name       Combo Name    47--16  15--11  10--6  5--1    0
MOVTAR.T0  S0.MOVTAR.T0          TARs1   TARd   opcode  0
```

```text
Name       Combo Name    Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOVTAR.T0  S0.MOVTAR.T0  VMOV                   1
```

```text
Name       Combo Name    47--16  15--11  10--6  5--1    0
MOVTAR.T1  S0.MOVTAR.T1          TARs1   TARd   opcode  0
```

```text
Name       Combo Name    Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOVTAR.T1  S0.MOVTAR.T1  VMOV                   1
```

```text
Name         Combo Name      47--16  15--11  10--6  5--1    0
MOVTAR.DUAL  S0.MOVTAR.DUAL          TARs1   TARd   opcode  0
```

```text
Name         Combo Name      Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOVTAR.DUAL  S0.MOVTAR.DUAL  VMOV                   1
```

这三条指令都是在各自VPT中对TAR做MOV操作，即TAR[TARd] = TAR[TARs1]。所有操作均为64bit操作

MOVTAR.T0 TARd, TARs1

- 只移动VPT0的TAR；当TCTL设置不使能VPT0时，此时指令视为NOP
MOVTAR.T1 TARd, TARs1

- 只移动VPT1的TAR；当TCTL设置不使能VPT1时，此时指令视为NOP
MOVTAR.DUAL TARd, TARs1

- 同时移动VPT0和VPT1的TAR；如果TCTL设置某VPT不使能，则该VPT下，指令视为NOP

**Implicit Use:**

- `TCTL`

### 8.6.27. MOVSFT_VA (new in 4.0)

```text
Name       Combo Name   47--44    43--42    41      40   39--36  35--26  25--16  15--6  5--2    1        0
MOVSFT_VA  M.MOVSFT_VA  sub-code  sft_mode  Rs1_hi  LCE  Rs1_lo  VACCs1  N/A     VACCd  opcode  Const_0  MCE
```

```text
Name       Combo Name   Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOVSFT_VA  M.MOVSFT_VA  VMOV                                    1
```

MOVSFT_VA VACCd, VACCs1, Rs1

本指令将一个VACC寄存器当作一个完整的512bit操作数，按照byte或者16byte为单位进行逻辑左移或者逻辑右移。本指令不受到VL和 maskbit的影响，并且输入操作数和输出操作数不能重叠。

**Field description:**

- {Rs1_hi, Rs1_lo}
  - SR输入操作数，移位数值为该寄存器的低4bit
- `sft_mode`
  - 0：以byte为单位逻辑左移， VACC[VACCd_index] = (VACC[VACCs1_index]<<(SR[Rs1][3:0]<<3))
  - 1：以byte为单位逻辑右移， VACC[VACCd_index] = (VACC[VACCs1_index]>>(SR[Rs1][3:0]<<3))
  - 2：以16byte为单位逻辑左移，VACC[VACCd_index] = (VACC[VACCs1_index]<<(SR[Rs1][3:0]<<7))
  - 3：以16byte为单位逻辑右移，VACC[VACCd_index] = (VACC[VACCs1_index]>>(SR[Rs1][3:0]<<7))
- `VACCs1/VACCd`
  - VACCs1_index = VAB_VPT* + {3'b0, VACCs1}
  - VACCd_index = VAB_VPT* + {3'b0, VACCd}
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`

### 8.6.28. MOVSFTC_VA (new in 4.0)

```text
Name        Combo Name    47--44    43--42    41      40   39--36  35--26  25--16  15--6  5--2    1        0
MOVSFTC_VA  M.MOVSFTC_VA  sub-code  sft_mode  Rs1_hi  LCE  Rs1_lo  VACCs1  VACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name        Combo Name    Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOVSFTC_VA  M.MOVSFTC_VA  VMOV                                    1
```

MOVSFTC_VA VACCd, VACCs1, VACCs2, Rs1

本指令将两个VACC寄存器拼接起来当作一个完整的1024bit操作数，按照byte或者16byte为单位进行逻辑左移或者逻辑右移，然后根据 sft_mode取高512bit或者低512bit。本指令不受到VL和maskbit的影响，并且输入操作数和输出操作数不能重叠。

**Field description:**

- {Rs1_hi, Rs1_lo}
  - SR输入操作数，移位数值为该寄存器的低4bit
- `sft_mode`
  - 0：以byte为单位逻辑左移， {VACC[VACCd_index], useless_512bit} = ({VACC[VACCs1_index], VACC[VACCs2_index]} <<(SR[Rs1][3:0]<<3)); //结果取高512bit
  - 1：以byte为单位逻辑右移， {useless_512bit, VACC[VACCd_index]} = ({VACC[VACCs2_index], VACC[VACCs1_index]}>> (SR[Rs1][3:0]<<3)); //结果取低512bit
  - 2：以16byte为单位逻辑左移，{VACC[VACCd_index], useless_512bit} = ({VACC[VACCs1_index], VACC[VACCs2_index]} <<(SR[Rs1][3:0]<<7)); //结果取高512bit
  - 3：以16byte为单位逻辑右移，{useless_512bit, VACC[VACCd_index]} = ({VACC[VACCs2_index], VACC[VACCs1_index]}>> (SR[Rs1][3:0]<<7)); //结果取低512bit
- `VACCs1/VACCs2/VACCd`
  - VACCs1_index = VAB_VPT* + {3'b0, VACCs1}
  - VACCs2_index = VAB_VPT* + {3'b0, VACCs2}
  - VACCd_index = VAB_VPT* + {3'b0, VACCd}
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
    - OACCs2和OACCd不能互相覆盖

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`

### 8.6.29. MOVSFTI_VA (new in 4.0)

```text
Name        Combo Name    47--44    43--42    41       40   39--36  35--26  25--16  15--6  5--2    1        0
MOVSFTI_VA  M.MOVSFTI_VA  sub-code  sft_mode  concate  LCE  imm4    VACCs1  VACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name        Combo Name    Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOVSFTI_VA  M.MOVSFTI_VA  VMOV                                    1
```

MOVSFTI_VA VACCd, VACCs1, VACCs2, Imm4

本指令根据concate的不同，选择一个VACC作为一个512bit操作数，或者选择将两个VACC寄存器拼接起来当作一个完整的1024bit操作数， 按照byte或者16byte为单位进行逻辑左移或者逻辑右移，然后根据sft_mode取高512bit或者低512bit。本指令不受到VL和maskbit的影响， 并且输入操作数和输出操作数不能重叠。和MOVSFT_VA以及MOVSFTI_VA不同，本指令的移位数值来源于立即数。

- `concat`
  - 选择512bit操作数作为op2
  - 0：op2 = 0x0
  - 1：op2 = VACC[VACCs2_index]
- `sft_mode`
  - 0：以byte为单位逻辑左移， {VACC[VACCd_index], useless_512bit} = ({VACC[VACCs1_index], op2}<<(Imm4<<3)); //结果取高 512bit
  - 1：以byte为单位逻辑右移， {useless_512bit, VACC[VACCd_index]} = (op2, VACC[VACCs1_index]}>>(Imm4<<3)); //结果取低 512bit
  - 2：以16byte为单位逻辑左移，{VACC[VACCd_index], useless_512bit} = ({VACC[VACCs1_index], op2}<<(Imm4<<7)); //结果取高512bit
  - 3：以16byte为单位逻辑右移，{useless_512bit, VACC[VACCd_index]} = (op2, VACC[VACCs1_index]}>>(Imm4<<7)); //结果取低 512bit
- `VACCs1/VACCs2/VACCd`
  - VACCs1_index = VAB_VPT* + {3'b0, VACCs1}
  - VACCs2_index = VAB_VPT* + {3'b0, VACCs2}
  - VACCd_index = VAB_VPT* + {3'b0, VACCd}
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
    - OACCs2和OACCd不能互相覆盖

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`

### 8.6.30. MB_PUSH (new in 4.0)

```text
Name     Combo Name  47--16  15--6  5--1    0
MB_PUSH  S0.MB_PUSH          N/A    opcode  0
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MB_PUSH  S0.MB_PUSH  VMOV                   1
```

MB_PUSH

ISA4.0新增指令，将VAB_VPT*指向的VACC寄存器（当前线程maskbit寄存器）进行压栈操作，其复制到SPR MB_STACK索引的VACC寄存器中；同时将SPR寄存器MB_STACK中保存的无符号整型数据自增1后写回到MB_STACK中。

当访问的VACC越界时（VACC Index为负值或者超过线程分配的VACC上限），硬件行为不可知。

```text
VACC[VPT*][SPR[MB_STACK] + VAB_VPT*] = VACC[VPT*][VAB_VPT*];
SPR[MB_STACK] = SPR[MB_STACK] + 1;
```

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `MB_STACK`

**Implicit defs:**

- `MB_STACK`

### 8.6.31. MB_POP (new in 4.0)

```text
Name    Combo Name  47--16  15--6  5--1    0
MB_POP  S0.MB_POP           N/A    opcode  0
```

```text
Name    Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MB_POP  S0.MB_POP   VMOV                   1
```

MB_POP

ISA4.0新增指令，将SPR寄存器MB_STACK中保存的无符号整型数据自减1后写回到MB_STACK中；同时SPR MB_STACK索引的VACC寄存器复制到VAB_VPT*指向的VACC寄存器（当前线程maskbit寄存器）中。

当访问的VACC越界时（VACC Index为负值或者超过线程分配的VACC上限），硬件行为不可知。

```text
SPR[MB_STACK] = SPR[MB_STACK] - 1;
VACC[VPT*][VAB_VPT*] = VACC[VPT*][SPR[MB_STACK] + VAB_VPT*];
```

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `MB_STACK`

**Implicit defs:**

- `MB_STACK`

### 8.6.32. MMERGE (new in 4.0)

```text
Name    Combo Name  47--44    43--41  40   39--36    35--26  25--16  15--6  5--2    1        0
MMERGE  M.MMERGE    sub-code  N/A     LCE  vm_merge  VACCs1  VACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name    Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MMERGE  M.MMERGE    VMOV                                    1
```

**MMERGE:** VACCd[i:i] = merge (VACCs1[i:i] , VACCs2[i:i]);

MMERGE (Mask Merge ) 对两个源VACC寄存器中保存的mask做merge操作产生新的maskbit，回写到VACCd寄存器中，用于精度变窄算子。源VACC中maskbit的bit数由指令vm_merge域指定；本指令不受到VL和maskbit的影响。

- vm_merge == 1 时：
  - 将两个256bit的maskbit组合成一个512bit的maskbit保存在VACCd对应的maskbit[511:0]中。
- vm_merge == 2 时：
  - 将两个128bit的maskbit组合成一个256bit的maskbit保存在VACCd对应的maskbit[255:0]中，maskbit[511:256]回写为0。
- vm_merge == 3 时：
  - 将两个64bit的maskbit组合成一个128bit的maskbit保存在VACCd对应的maskbit[127:0]中，maskbit[511:128]回写为0。

```text
for i = 0...VPT_NUM-1 {
    VACC[i][VACCd_index] = 0;
    int src_mask_width = 2^(9 - vm_merge);
    int dst_mask_width = 2^(10 - vm_merge);
    bits(src_mask_width) maskbit1, maskbit2;
    bits(dst_mask_width) maskbit;
    //从VACC中，maskbit逻辑0开始，获取长度为2^(9-dwidth)的bit长度
    //get_maskbit 与 set_maskbit用于表示maskbit在VACC中的物理排布与逻辑index的转换
    maskbit1[src_mask_width-1:0] = get_maskbit(VACC[i][VACCs1_index], 0, src_mask_width-1);
    maskbit2[src_mask_width-1:0] = get_maskbit(VACC[i][VACCs2_index], 0, src_mask_width-1);
    maskbit[src_mask_width-1:0] = maskbit1[src_mask_width-1:0];
    maskbit[dst_mask_width-1:src_mask_width] = maskbit2[src_mask_width-1:0];
    //set_maskbit用于表示映射成maskbit在VACC的物理排布
    VACC[i][VACCd_index][dst_mask_width-1:0] = set_maskbit(maskbit[dst_mask_width-1:0]);
}
```

**Field description:**

- `VACCs1/VACCs2`
  - VACC*_index = VACC* + VAB_VPT*;
- `VACCd`
  - VACCd_index = VACCd + VAB_VPT*;
- `vm_merge`
  - 操作VACCs1/VACCs2中maskbit的bit数。请注意这里是maskbit的逻辑bit位置
  - vm_merge=1 ：16bit格式OACC对应的maskbit[255:0]
  - vm_merge=2 ：32bit格式OACC对应的maskbit[127:0]
  - vm_merge=3 ：64bit格式OACC对应的maskbit[63:0]
  - vm_merge为其他取值：Reserved

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`

### 8.6.33. MSELECT_256 (new in 4.0)

```text
Name         Combo Name     47--44    43--41  40   39--36  35--26  25--16  15--6  5--2    1        0
MSELECT_256  M.MSELECT_256  sub-code  N/A     LCE  vm_sel  VACCs1  N/A     VACCd  opcode  Const_0  MCE
```

```text
Name         Combo Name     Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MSELECT_256  M.MSELECT_256  VMOV                                    1
```

**MSELECT_256:** VACCd[i:i] = select (VACCs1[i:i]);

MSELECT_256 (Mask Select ) 用于选择VACCs1中保存的maskbit中的某段256bit maskbit保存在VACCd对应的maskbit[255:0]中，

**maskbit[511:** 256]回写为0，用于精度变宽算子中。本指令不受到VL和maskbit的影响。

```text
for i = 0...VPT_NUM-1 {
    VACC[i][VACCd_index] = 0;
    bits(256) maskbit[vm_sel];
    //get_maskbit 与 set_maskbit用于表示maskbit在VACC中的物理排布与逻辑index的转换
    maskbit[0][255:0] = get_maskbit(VACC[i][VACCs1_index], 0, 255);
    maskbit[1][255:0] = get_maskbit(VACC[i][VACCs1_index], 256, 511);
    VACC[i][VACCd_index][255:0] = set_maskbit(maskbit[vm_sel][255:0]);
}
```

**Field description:**

- `VACCs1/VACCs2`
  - VACC*_index = VACC* + VAB_VPT*;
- `VACCd`
  - VACCd_index = VACCd + VAB_VPT*;
- `vm_sel`
  - 有效范围为0~1，用于选择512bit maskbit中哪一段的256bit作为新的maskbit

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`

### 8.6.34. MSELECT_128 (new in 4.0)

```text
Name         Combo Name     47--44    43--41  40   39--36  35--26  25--16  15--6  5--2    1        0
MSELECT_128  M.MSELECT_128  sub-code  N/A     LCE  vm_sel  VACCs1  N/A     VACCd  opcode  Const_0  MCE
```

```text
Name         Combo Name     Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MSELECT_128  M.MSELECT_128  VMOV                                    1
```

**MSELECT_128:** VACCd[i:i] = select (VACCs1[i:i]);

MSELECT_128 (Mask Select ) 用于选择VACCs1中保存的maskbit中的某段128bit maskbit保存在VACCd对应的maskbit[127:0]中，

**maskbit[511:** 128]回写为0，用于精度变宽算子中。本指令不受到VL和maskbit的影响。

```text
for i = 0...VPT_NUM-1 {
    VACC[i][VACCd_index] = 0;
    bits(128) maskbit[vm_sel];
    //get_maskbit 与 set_maskbit用于表示maskbit在VACC中的物理排布与逻辑index的转换
    maskbit[0][127:0] = get_maskbit(VACC[i][VACCs1_index], 0, 127);
    maskbit[1][127:0] = get_maskbit(VACC[i][VACCs1_index], 128, 255);
    maskbit[2][127:0] = get_maskbit(VACC[i][VACCs1_index], 256, 283);
    maskbit[3][127:0] = get_maskbit(VACC[i][VACCs1_index], 384, 511);
    VACC[i][VACCd_index][127:0] = set_maskbit(maskbit[vm_sel][127:0]);
}
```

**Field description:**

- `VACCs1/VACCs2`
  - VACC*_index = VACC* + VAB_VPT*;
- `VACCd`
  - VACCd_index = VACCd + VAB_VPT*;
- `vm_sel`
  - 有效范围为0~3，用于选择512bit maskbit中哪一段的128bit作为新的maskbit

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`

### 8.6.35. MSELECT_64 (new in 4.0)

```text
Name        Combo Name    47--44    43--41  40   39--36  35--26  25--16  15--6  5--2    1        0
MSELECT_64  M.MSELECT_64  sub-code  N/A     LCE  vm_sel  VACCs1  N/A     VACCd  opcode  Const_0  MCE
```

```text
Name        Combo Name    Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MSELECT_64  M.MSELECT_64  VMOV                                    1
```

**MSELECT_64:** VACCd[i:i] = select (VACCs1[i:i]);

MSELECT_64(Mask Select ) 用于选择VACCs1中保存的maskbit中的某段64bit maskbit保存在VACCd对应的maskbit[63:0]中，

**maskbit[511:** 64]回写为0，用于精度变宽算子中。本指令不受到VL和maskbit的影响。

```text
for i = 0...VPT_NUM-1 {
    VACC[i][VACCd_index] = 0;
    bits(64) maskbit[vm_sel];
    //get_maskbit 与 set_maskbit用于表示maskbit在VACC中的物理排布与逻辑index的转换
    maskbit[0][63:0] = get_maskbit(VACC[i][VACCs1_index], 0, 63);
    maskbit[1][63:0] = get_maskbit(VACC[i][VACCs1_index], 64, 127);
    maskbit[2][63:0] = get_maskbit(VACC[i][VACCs1_index], 128, 191);
    maskbit[3][63:0] = get_maskbit(VACC[i][VACCs1_index], 192, 255);
    maskbit[4][63:0] = get_maskbit(VACC[i][VACCs1_index], 256, 319);
    maskbit[5][63:0] = get_maskbit(VACC[i][VACCs1_index], 320, 383);
    maskbit[6][63:0] = get_maskbit(VACC[i][VACCs1_index], 384, 447);
    maskbit[7][63:0] = get_maskbit(VACC[i][VACCs1_index], 448, 511);
    VACC[i][VACCd_index][63:0] = set_maskbit(maskbit[vm_sel][63:0]);
}
```

**Field description:**

- `VACCs1/VACCs2`
  - VACC*_index = VACC* + VAB_VPT*;
- `VACCd`
  - VACCd_index = VACCd + VAB_VPT*;
- `vm_sel`
  - 有效范围为0~7，用于选择512bit maskbit中哪一段的64bit作为新的maskbit

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`

## 8.7. VLDST Type Instruction

VLDST 包括如下指令

- `TARADD`
  - 该指令实质上是一条TAR寄存器的计算指令，但是由于TAR寄存器主要保存地址，TARADD与地址计算相关，仍然归类到VLDST中
- 1D VLDST指令
  - 1D Liner Load/Store指令
    - `TVLDOA/TVLDOA.reg`
    - TVSTOA/TVSTOA.reg/TVSTOA_EXT/TVSTOA_EXT.reg
    - `VLDOA/VSTOA`
  - 1D Strided Load/Store指令
    - `VLDEOA/VSTEOA`
  - 1D Gather Scatter Load/Store指令
    - MLI_VLDXOA/MLI_VLDXI32OA/MLI_VSTXOA/MLI_VSTXI32OA/
  - 1D Vector AMO 指令
    - `REDV.ADD/REDV.MAX/REDV.MAXNUM`
  - 上述指令Common Feature如下：
    - 指令受到VL和maskbit的影响
      - 对于index大于等于VL部分的元素，以及在vm=0情况下maskbit=0的元素，均严格不导致exception
      - 对于Load 操作指令：TVLDOA/TVLDOA.reg/VLDOA/VLDEOA/MLI_VLDXOA/MLI_VLDXI32OA
        - 对于index大于等于VL部分的元素，目标寄存器数值保持不变
        - 在vm=0情况下maskbit=0的元素并且非VL tail的元素，目标寄存器数值保持不变
      - 对于基于TAR的后增寻址指令：TVLDOA/TVSTOA/TVSTOA_EXT
        - 无论VL是否为0，地址自增回写始终执行，即TAR的自增不受VL=0的影响。
    - 除1D Vector AMO 指令外，指令均支持访存64-bit数据。
    - 指令均支持双VPT模式
    - 指令支持Per Element对齐，即地址对齐放宽到dwidth规定的element宽度
      - 访问不同地址区域，指令对齐要求不同，此部分以Arch Spec为准
    - 指令中使用10bit OACC域，间接访问VACC寄存器
    - 基于TAR的1D VLDST指令：TVLDOA/TVLDOA.reg/TVSTOA/TVSTOA.reg/TVSTOA_EXT/TVSTOA_EXT.reg
      - 支持5bit分别寻址的TAR base和TAR offset寄存器
        - 相比ISA3.0，放宽了TAR分组限制，允许任意一个TAR成为base或者offset
      - 地址计算时TAR不需要进行移位
    - 指令异常行为请参考Arch Spec对应章节

### 8.7.1. TARADD (update in 4.0)

```text
Name    Combo Name  47--16  15--11  10--6  5--1    0
TARADD  S0.TARADD           TARs1d  TARs2  opcode  0
```

```text
Name    Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
TARADD  S0.TARADD   VLDST                   1
```

TARADD TARs1d, TARs2

- ISA3.2新增指令。ISA4.0中，扩展为任意两个TAR操作数，操作数2累加上操作数1
- for i = 0...VPT_NUM-1 //两个线程各自处理
  - TAR[i][TARs1d] += tar[i][TARs2] //64bit操作

**Implicit Use:**

- `TCTL`

### 8.7.2. TVLDOA (new in 4.0)

```text
Name    Combo Name  47--32  31--30    29  28--27  26       25--21  20--16  15--6  5--1    0
TVLDOA  L.TVLDOA            sub-code  vm  dwidth  Const_0  TARs2   TARs1d  OACCd  opcode  1
```

```text
Name    Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
TVLDOA  L.TVLDOA    VLDST                            1
```

TVLDOA OACCd, TARs1d, TARs2

本指令为ISA4.0新增指令，利用TAR作为基址寄存器的后变址寻址模式指令，将MEM数据读取到每个VPT的OACC中。本指令支持读取 8bit/16bit/32bit/64bit数据存放到OA中，并根据数据宽度自动按照Accumulation Register File进行数据位置的排列。指令支持Per Element 对齐，即地址对齐放宽到dwidth规定的element宽度。

- 本指令受到VL和maskbit的影响
  - 对于index大于等于VL部分的元素，以及在vm=0情况下maskbit=0的元素，均严格不导致exception
  - 对于index大于等于VL部分的元素，目标寄存器数值保持不变
  - 在vm=0情况下maskbit=0的元素并且非VL tail的元素，目标寄存器数值保持不变
  - 无论VL是否为0，地址自增回写始终执行

```text
for i = 0...VPT_NUM-1 {
    addr[i] = tar[i][TARs1d];
    OA[i][OACCd_index] = MEM[addr[i]];
    tar[i][TARs1d] = tar[i][TARs1d] + tar[i][TARs2];
}
```

**Field description:**

- `TARs1d`
  - 保存基地址
- `TARs2`
  - 保存后增加地址偏移
- `dwidth`
  - 0: 读入8bit数据，按照VA 8bit排列要求自动进行交替(remap)
  - 1: 读入16bit数据，按照VA 16bit排列要求自动进行交替(remap)
  - 2: 读入32bit数据，不需要进行交替排列
  - 3: 读入64bit数据，按照VA 64bit排列要求自动进行交替(remap)
- `OACCd`
  - VACCd_index = VAB_VPT* + {OACCd, 3'b0} OACCd_index = VACCd_index >> 3
- `vm`
  - vm=0，使用VACC[0+VAB_VPT*]中maskbit作为写回条件。
  - vm=1，非条件写回
  - 如果vm=0，则VACCd不能为VACC[0+VAB_VPT*]

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.7.3. TVSTOA (new in 4.0)

```text
Name    Combo Name  47--32  31--30  29  28--27  26        25--21  20--16  15--6   5--2    1    0
TVSTOA  V.TVSTOA            N/A     vm  dwidth  sub-code  TARs2   TARs1d  OACCs1  opcode  VCE  CCE
```

```text
Name    Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
TVSTOA  V.TVSTOA    VLDST                                            1
```

TVSTOA OACCs1, TARs1d, TARs2

本指令为ISA4.0新增指令，利用TAR作为基址寄存器的后变址寻址模式指令，每个VPT读取一个OACC的数据并写入MEM。本指令支持存储数据宽度为8bit/16bit/32bit/64bit，同时按照VACC Data Element Mapping中的数据格式自动将OACC中的交替排列转换为memory中的线性排列。指令支持Per Element对齐，即地址对齐放宽到dwidth规定的element宽度。

- 本指令受到VL和maskbit的影响
  - 对于index大于等于VL部分的元素，以及在vm=0情况下maskbit=0的元素，严格不能回写memory或导致exception
  - 无论VL是否为0，地址自增回写始终执行

```text
for i = 0...VPT_NUM-1 {
    addr[i] = tar[i][TARs1d]
    MEM[addr[i]] = OA[i][OACCs1_index];
    tar[i][TARs1d] = tar[i][TARs1d] + tar[i][TARs2]
}
```

**Field description:**

- `TARs1d`
  - 保存基地址
- `TARs2`
  - 保存后增加地址偏移
- `dwidth`
  - 0: 写入8bit数据，按照VA 8bit排列要求自动进行交替(remap)
  - 1: 写入16bit数据，按照VA 16bit排列要求自动进行交替(remap)
  - 2: 写入32bit数据，不需要进行交替排列
  - 3: 写入64bit数据，按照VA 64bit排列要求自动进行交替(remap)
- `OACCs1`
  - VACCs1_index = VAB_VPT* + {OACCs1, 3'b0};
  - OACCs1_index = VACCs1_index >> 3;
- `vm`
  - vm=0，使用VACC[0+VAB_VPT*]中maskbit作为写回条件。
  - vm=1，非条件写回

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- VL ESL_DTYPE

### 8.7.4. TVLDOA.reg (new in 4.0)

```text
Name        Combo Name    47--32  31--30    29  28--27  26       25--21  20--16  15--6  5--1    0
TVLDOA.reg  L.TVLDOA.reg          sub-code  vm  dwidth  Const_0  TARs2   TARs1   OACCd  opcode  1
```

```text
Name        Combo Name    Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
TVLDOA.reg  L.TVLDOA.reg  VLDST                            1
```

TVLDOA.reg TARs1, TARs2

本指令为ISA4.0新增指令，利用TAR作为基址寄存器的寄存器寻址模式指令，将MEM数据读取到每个VPT的8VA中。本指令支持读取 8bit/16bit/32bit/64bit数据存放到VA中，并根据数据宽度自动按照Accumulation Register File进行数据位置的排列。指令支持Per Element 对齐，即地址对齐放宽到dwidth规定的element宽度。相比于TVLDOA指令，寻址模式有所不同。

- 本指令受到VL和maskbit的影响
  - 对于index大于等于VL部分的元素，以及在vm=0情况下maskbit=0的元素，均严格不导致exception
  - 对于index大于等于VL部分的元素，目标寄存器数值保持不变
  - 在vm=0情况下maskbit=0的元素并且非VL tail的元素，目标寄存器数值保持不变

```text
for i = 0...VPT_NUM-1 {
    addr[i] = tar[i][TARs1] + tar[i][TARs2]
    OA[i][OACCd_index] = MEM[addr[i]];
}
```

**Field description:**

- `TARs1`
  - 保存基地址
- `TARs2`
  - 保存地址偏移
- `dwidth`
  - 0: 读入8bit数据，按照VA 8bit排列要求自动进行交替(remap)
  - 1: 读入16bit数据，按照VA 16bit排列要求自动进行交替(remap)
  - 2: 读入32bit数据，不需要进行交替排列
  - 3: 读入64bit数据，按照VA 64bit排列要求自动进行交替(remap)
- `OACCd`
  - VACCd_index = VAB_VPT* + {OACCd, 3'b0}
  - OACCd_index = VACCd_index >> 3
- `vm`
  - vm=0，使用VACC[0+VAB_VPT*]中maskbit作为写回条件。
  - vm=1，非条件写回
  - 如果vm=0，则VACCd不能为VACC[0+VAB_VPT*]

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.7.5. TVSTOA.reg (new in 4.0)

```text
Name        Combo Name    47--32  31--30  29  28--27  26        25--21  20--16  15--6   5--2    1    0
TVSTOA.reg  V.TVSTOA.reg          N/A     vm  dwidth  sub-code  TARs2   TARs1   OACCs1  opcode  VCE  CCE
```

```text
Name        Combo Name    Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
TVSTOA.reg  V.TVSTOA.reg  VLDST                                            1
```

TVSTOA.reg OACCs1, TARs1, TARs2

本指令为ISA4.0新增指令，利用TAR作为基址寄存器的寄存器寻址模式指令，每个VPT读取OACC中的数据并写入MEM。本指令支持存储数据宽度为8bit/16bit/32bit/64bit，同时按照VACC Data Element Mapping中的数据格式自动将OACC中的交替排列转换为memory中的线性排列。指令支持Per Element对齐，即地址对齐放宽到dwidth规定的element宽度。相比于TVSTOA指令，寻址模式有所不同。

- 本指令受到VL和maskbit的影响
  - 对于index大于等于VL部分的元素，以及在vm=0情况下maskbit=0的元素，严格不能回写memory或导致exception

```text
for i = 0...VPT_NUM-1 {
    addr[i] = tar[i][TARs1] + tar[i][TARs2]
    MEM[addr[i]] = OA[i][OACCs1_index];
}
```

**Field description:**

- `TARs1`
  - 保存基地址
- `TARs2`
  - 保存地址偏移
- `dwidth`
  - 0: 写入8bit数据，按照VA 8bit排列要求自动进行交替(remap)
  - 1: 写入16bit数据，按照VA 16bit排列要求自动进行交替(remap)
  - 2: 写入32bit数据，不需要进行交替排列
  - 3: 写入64bit数据，按照VA 64bit排列要求自动进行交替(remap)
- `OACCs1`
  - VACCs1_index = VAB_VPT* + {OACCs1, 3'b0}
  - OACCs1_index = VACCs1_index >> 3
- `vm`
  - vm=0，使用VACC[0+VAB_VPT*]中maskbit作为写回条件。
  - vm=1，非条件写回

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`
- `ESL_DTYPE`

### 8.7.6. TVSTOA_EXT (new in 4.0)

```text
Name        Combo Name    47--44    43--42  41  40   39     38--36    35--26  25--21  20--16  15    14   13--6  5--2    1        0
TVSTOA_EXT  M.TVSTOA_EXT  sub-code  dwidth  vm  LCE  clamp  cvt_mode  OACCs1  TARs2   TARs1d  relu  rnd  N/A    opcode  Const_0  MCE
```

```text
Name        Combo Name    Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
TVSTOA_EXT  M.TVSTOA_EXT  VLDST                                    1
```

TVSTOA_EXT OACCs1, TARs1d, TARs2

本指令为ISA4.0新增指令，利用TAR作为基址寄存器的后变址寻址模式指令，每个VPT读取8VA数据并写入MEM。本指令支持存储数据宽度为8bit/16bit/32bit/64bit，同时按照VACC Data Element Mapping中的数据格式自动将OACC中的交替排列转换为memory中的线性排列。 指令支持Per Element对齐，即地址对齐放宽到dwidth规定的element宽度。

- 本指令受到VL和maskbit的影响
  - 对于index大于等于VL部分的元素，以及在vm=0情况下maskbit=0的元素，严格不能回写memory或导致exception
  - 无论VL是否为0，地址自增回写始终执行
- 相比TVSTOA，支持cvt、clamp、relu语义
  - Note：当cvt使能时，回写起始地址必须对齐到4Byte

```text
for i = 0...VPT_NUM-1 {
    addr[i] = tar[i][TARs1d]
    MEM[addr[i]] = OA[i][OACCs1_index];
    tar[i][TARs1d] = tar[i][TARs1d] + tar[i][TARs2]
}
```

**Field description:**

- `TARs1d`
  - 保存基地址
- `TARs2`
  - 保存后增加地址偏移
- `dwidth`
  - 0: 写入8bit数据，按照VA 8bit排列要求自动进行交替(remap)
  - 1: 写入16bit数据，按照VA 16bit排列要求自动进行交替(remap)
  - 2: 写入32bit数据，不需要进行交替排列
  - 3: 写入64bit数据，按照VA 64bit排列要求自动进行交替(remap)
- `OACCs1`
  - VACCs1_index = VAB_VPT* + {OACCs1, 3'b0}
  - OACCs1_index = VACCs1_index >> 3
- `vm`
  - vm=0，使用VACC[0+VAB_VPT*]中maskbit作为写回条件。
  - vm=1，非条件写回
- `cvt_mode`
  - if dwidth == 2：
    - 0：No convert
    - 1：FP32cvt2FP16
    - 2：FP32cvt2BF16
    - 3：FP32cvt2FP8E4M3
    - 4：FP32cvt2FP8E5M2
    - 5：INT32cvt2UINT8
    - 6：INT32cvt2INT8
  - if dwidth == 1：
    - 0：No convert
    - 1：FP16cvt2FP8E4M3
    - 2：FP16cvt2FP8E5M2
    - 3：BF16cvt2FP8E4M3
    - 4：BF16cvt2FP8E5M2
  - if dwidth = 0 || dwidth = 3：Reserved
  - cvt_mode使能时：
    - 对于向整型格式转换，并且转换前数值超出了整型表达范围，则总是做saturation到最临近数值
      - 例如对于负数转无符号整型，其结果应当是0
      - 对于转向INT8的结果，还受到clamp域影响
    - 对于向浮点格式转换，并且转换前数值超出了结果格式的表达范围，则结果为INF/NaN还是max value由rnd和clamp影响
  - Note：当cvt_mode使能时，回写的起始地址必须对齐到4Byte
- `rnd`
  - 只有dwidth=0x2 或 dwidth=0x1 并且cvt_mode不为0时使用。其余状态忽略
  - 0：rounding-to-nearest even
  - 1：rounding-to-zero
- `clamp`
  - 只有dwidth=0x2 或 dwidth=0x1 并且cvt_mode不为0时使用。其余状态忽略
  - 当CVT结果为int8(不包括uint8)、FP16、BF16、FP8_E4M3、FP8_E5M2时有效
  - 当CVT结果格式为int8，并且clamp==1，则负数的saturation为-127；否则负数的saturation为-128 当CVT结果为BF16/FP16，clamp==1，并且原始数据(非INF)超出它们可表达范围时，clamp到正负最大可表达数值上，而非±INF
  - 当CVT结果为FP8_E4M3，clamp==1，并且原始数据(非INF)超出它们可表达范围时，clamp到正负最大可表达数值上，而非NaN
  - 当CVT结果为FP8_E5M2，clamp==1，并且原始数据(非INF)超出它们可表达范围时，clamp到正负最大可表达数值上，而非±INF
  - 任何其他数据格式下均无效
- `relu`
  - 只有dwidth=0x2 或 dwidth=0x1 并且cvt_mode不为0时使用。其余状态忽略
  - 0：不对输出进行relu操作
  - 1：根据CVT结果进行relu操作

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`
- `MODE_WRK.denormal_flush`
- `ESL_DTYPE`

### 8.7.7. TVSTOA_EXT.reg (new in 4.0)

```text
Name            Combo Name        47--44    43--42  41  40   39     38--36    35--26  25--21  20--16  15    14   13--6  5--2    1        0
TVSTOA_EXT.reg  M.TVSTOA_EXT.reg  sub-code  dwidth  vm  LCE  clamp  cvt_mode  OACCs1  TARs2   TARs1   relu  rnd  N/A    opcode  Const_0  MCE
```

```text
Name            Combo Name        Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
TVSTOA_EXT.reg  M.TVSTOA_EXT.reg  VLDST                                    1
```

TVSTOA_EXT OACCs1, TARs1, TARs2

本指令为ISA4.0新增指令，利用TAR作为基址寄存器的寄存器寻址模式指令，每个VPT读取8VA数据并写入MEM。本指令支持存储数据宽度为8bit/16bit/32bit/64bit，同时按照VACC Data Element Mapping中的数据格式自动将OACC中的交替排列转换为memory中的线性排列。 指令支持Per Element对齐，即地址对齐放宽到dwidth规定的element宽度。

- 本指令受到VL和maskbit的影响
  - 对于index大于等于VL部分的元素，以及在vm=0情况下maskbit=0的元素，严格不能回写memory或导致exception
- 相比TVSTOA.reg支持cvt、clamp、relu语义
  - Note：当cvt使能时，回写的起始地址必须对齐到4Byte

```text
for i = 0...VPT_NUM-1 {
    addr[i] = tar[i][TARs1] + tar[i][TARs2]
    MEM[addr[i]] = OA[i][OACCs1_index];
}
```

**Field description:**

- `TARs1`
  - 保存基地址
- `TARs2`
  - 保存地址偏移
- `dwidth`
  - 0: 写入8bit数据，按照VA 8bit排列要求自动进行交替(remap)
  - 1: 写入16bit数据，按照VA 16bit排列要求自动进行交替(remap)
  - 2: 写入32bit数据，不需要进行交替排列
  - 3: 写入64bit数据，按照VA 64bit排列要求自动进行交替(remap)
- `OACCs1`
  - VACCs1_index = VAB_VPT* + {OACCs1, 3'b0}
  - OACCs1_index = VACCs1_index >> 3
- `vm`
  - vm=0，使用VACC[0+VAB_VPT*]中maskbit作为写回条件。
  - vm=1，非条件写回
- `cvt_mode`
  - if dwidth == 2：
    - 0：No convert
    - 1：FP32cvt2FP16
    - 2：FP32cvt2BF16
    - 3：FP32cvt2FP8E4M3
    - 4：FP32cvt2FP8E5M2
    - 5：INT32cvt2UINT8
    - 6：INT32cvt2INT8
  - if dwidth == 1：
    - 0：No convert
    - 1：FP16cvt2FP8E4M3
    - 2：FP16cvt2FP8E5M2
    - 3：BF16cvt2FP8E4M3
    - 4：BF16cvt2FP8E5M2
  - if dwidth = 0 || dwidth = 3：Reserved
  - cvt_mode使能时：
    - 对于向整型格式转换，并且转换前数值超出了整型表达范围，则总是做saturation到最临近数值
      - 例如对于负数转无符号整型，其结果应当是0
      - 对于转向INT8的结果，还受到clamp域影响
    - 对于向浮点格式转换，并且转换前数值超出了结果格式的表达范围，则结果为INF/NaN还是max value由rnd和clamp影响
  - Note：当cvt_mode使能时，回写的起始地址必须对齐到4Byte
- `rnd`
  - 只有dwidth=0x2 或 dwidth=0x1 并且cvt_mode不为0时使用。其余状态忽略
  - 0：rounding-to-nearest even
  - 1：rounding-to-zero
- `clamp`
  - 只有dwidth=0x2 或 dwidth=0x1 并且cvt_mode不为0时使用。其余状态忽略
  - 当CVT结果为int8(不包括uint8)、FP16、BF16、FP8_E4M3、FP8_E5M2时有效
  - 当CVT结果格式为int8，并且clamp==1，则负数的saturation为-127；否则负数的saturation为-128
  - 当CVT结果为BF16/FP16，clamp==1，并且原始数据(非INF)超出它们可表达范围时，clamp到正负最大可表达数值上，而非±INF
  - 当CVT结果为FP8_E4M3，clamp==1，并且原始数据(非INF)超出它们可表达范围时，clamp到正负最大可表达数值上，而非NaN
  - 当CVT结果为FP8_E5M2，clamp==1，并且原始数据(非INF)超出它们可表达范围时，clamp到正负最大可表达数值上，而非±INF
  - 任何其他数据格式下均无效
- `relu`
  - 只有dwidth=0x2 或 dwidth=0x1 并且cvt_mode不为0时使用。其余状态忽略
  - 0：不对输出进行relu操作
  - 1：根据CVT结果进行relu操作

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`
- `MODE_WRK.denormal_flush`
- `ESL_DTYPE`

### 8.7.8. VLDOA (new in 4.0)

```text
Name   Combo Name  47--32  31--30  29  28--27  26--23    22   21    20--16  15--6  5--1    0
VLDOA  L.VLDOA             N/A     vm  dwidth  sub-code  N/A  copy  Rs1     OACCd  opcode  1
```

```text
Name   Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
VLDOA  L.VLDOA     VLDST                            1
```

VLDOA OACCd, Rs1

ISA4.0新增指令，每个VPT读取512Byte数据写入OACC。本指令支持读取8bit/16bit/32bit/64bit数据存放到VA中，并根据数据宽度自动按照 Accumulation Register File进行数据位置的排列。指令支持Per Element对齐，即地址对齐放宽到dwidth规定的element宽度。

本指令受到VL和maskbit的影响

- 对于index大于等于VL部分的元素，以及在vm=0情况下maskbit=0的元素，均严格不导致exception
- 对于index大于等于VL部分的元素，目标寄存器数值保持不变
- 在vm=0情况下maskbit=0的元素并且非VL tail的元素，目标寄存器数值保持不变

```text
for i = 0...VPT_NUM-1 {
    if(copy == 0) {
        addr[i] = SR[Rs1] + 512*i;
        OA[i][OACCd_index] = MEM[addr[i]];
    } else if(copy == 1) {
        addr[i] = SR[Rs1];
        OA[i][OACCd_index] = MEM[addr[i]];
    }
}
```

**Field description:**

- `dwidth`
  - 0: 读入8bit数据，按照VA 8bit排列要求自动进行交替(remap)
  - 1: 读入16bit数据，按照VA 16bit排列要求自动进行交替(remap)
  - 2: 读入32bit数据，不需要进行交替排列
  - 3: 读入64bit数据，按照VA 64bit排列要求自动进行交替(remap)
  - Others: Reserved
- `OACCd`
  - VACCd_index = VAB_VPT* + {OACCd, 3'b0}
  - OACCd_index = VACCd_index >> 3
- `copy`
  - 当copy==0时，两个VPT读取连续地址上的不同数据放入OACC
  - 当copy==1时，两个VPT读取相同地址的相同数据，放入OACC
- `vm`
  - vm=0，使用VACC[0+VAB_VPT*]中maskbit作为写回条件。
  - vm=1，非条件写回
  - 如果vm=0，则VACCd不能为VACC[0+VAB_VPT*]

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.7.9. VSTOA (new in 4.0)

```text
Name   Combo Name  47--32  31--30  29  28--27  26--23    22--21  20--16  15--6   5--2    1    0
VSTOA  V.VSTOA             N/A     vm  dwidth  sub-code  N/A     Rs1     OACCs1  opcode  VCE  CCE
```

```text
Name   Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
VSTOA  V.VSTOA     VLDST                                            1
```

VSTOA OACCs1, Rs1

ISA4.0新增指令，每个VPT读取8VA数据并写入MEM。本指令支持存储8bit/16bit/32bit/64bit位宽的数据。本指令支持存储数据宽度为 8bit/16bit/32bit/64bit，同时按照VACC Data Element Mapping中的数据格式自动将OACC中的交替排列转换为memory中的线性排列。指令支持Per Element对齐，即地址对齐放宽到dwidth规定的element宽度。

本指令受到VL和maskbit的影响

- 对于index大于等于VL部分的元素，以及在vm=0情况下maskbit=0的元素，严格不能回写memory或导致exception
指令支持双VPT语义，VPT0的起始地址为Rs1，VPT1的起始地址为Rs1 + 512Byte。

```text
for i = 0...VPT_NUM-1 {
    addr[i] = SR[Rs1] + 512*i
    MEM[addr[i]] = OA[i][OACCs1_index];
}
```

**Field description:**

- `dwidth`
  - 0: 写入8bit数据，按照VA 8bit排列要求自动进行交替(remap)
  - 1: 写入16bit数据，按照VA 16bit排列要求自动进行交替(remap)
  - 2: 写入32bit数据，不需要进行交替排列
  - 3: 写入64bit数据，按照VA 64bit排列要求自动进行交替(remap)
- `OACCs1`
  - VACCs1_index = VAB_VPT* + {OACCs1, 3'b0};
  - OACCs1_index = VACCs1_index >> 3
- `vm`
  - vm=0，使用VACC[0+VAB_VPT*]中maskbit作为写回条件。
  - vm=1，非条件写回

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`
- `ESL_DTYPE`

### 8.7.10. VLDEOA (new in 4.0)

```text
Name    Combo Name  47--44    43--42  41  40   39--31  30--26  25--21  20--16  15--6  5--2    1        0
VLDEOA  M.VLDEOA    sub-code  dwidth  vm  LCE  N/A     Rs2     N/A     Rs1     OACCd  opcode  Const_0  MCE
```

```text
Name    Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
VLDEOA  M.VLDEOA    VLDST                                    1
```

VLDEOA OACCd, Rs1, Rs2 ISA4.0新增指令。VLDEOA指令中，Rs1作为基址寄存器保存起始地址 ，Rs2保存以元素间隔为单位的有符号立即数，作为地址间隔stride， VLDEOA从内存中向量化访问多个元素，保存到每个VPT的一个OACC中，访问的第一个元素地址为Rs1保存的起始地址，访问后续元素的地址依次累加Rs2保存的地址间隔。VLDEOA支持读取数据宽度为8bit/16bit/32bit/64bit,并根据数据宽度自动按照Accumulation Register File 进行数据位置的排列。VLDEOA指令并不保证每个单独的内存访问之间的顺序。指令支持Per Element对齐，即地址对齐放宽到dwidth规定的element宽度。

每个元素地址计算时，使用SR[Rs1][47:0]+(i * SR[Rs2][47:0])结果的低48bit作为虚拟地址。SR[Rs1][63:48]作为寻址的hint不受到加法影响，直接传递给每个元素

本指令受到VL和maskbit的影响

- 对于index大于等于VL部分的元素，以及在vm=0情况下maskbit=0的元素，均严格不导致exception
- 对于index大于等于VL部分的元素，目标寄存器数值保持不变
- 在vm=0情况下maskbit=0的元素并且非VL tail的元素，目标寄存器数值保持不变

```text
bits(64) base_address;
bits(64) stride;
base_address = SR[Rs1];
stride = SR[Rs2];
bits(64) va_length;  // 512-bit
bits(64) data_width = 8 * 2^dwidth; // data_width in {8,16,32,64}
bits(64) va_nums = 8;   // 8 in MLI_VLDXOA
bits(64) elem_nums = va_length * va_nums / data_width;
bits(64) address_array[];
address_array[0] = base_address
for (e = 1; e < 2*elem_nums; e++) {    //计算两个VPT每个元素对应内存地址
    address_array[e] = address_array[e - 1] + stride * 2^dwidth;
}
for i = 0...VPT_NUM-1 {
    for (e = 0 ; e < elem_nums; e++) {
        bits(64) addr = address_array[e + i * elem_nums];
        OACC[i][OACCd_index][e] = MEM[addr][data_width-1:0];   //是否写入受到VL和maskbit影响。
    }
}
```

**Field description:**

- `dwidth`
  - 0: 读入8bit数据，按照VA 8bit排列要求自动进行交替(remap)
  - 1: 读入16bit数据，按照VA 16bit排列要求自动进行交替(remap)
  - 2: 读入32bit数据，不需要进行交替排列
  - 3: 读入64bit数据，按照VA 64bit排列要求自动进行交替(remap)
- `OACCd`
  - VACCd_index = VAB_VPT* + {OACCd, 3'b0}
  - OACCd_index = VACCd_index >> 3
- `vm`
  - vm=0，使用VACC[0+VAB_VPT*]中maskbit作为写回条件。
  - vm=1，非条件写回
  - 如果vm=0，则VACCd不能为VACC[0+VAB_VPT*]

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.7.11. VSTEOA (new in 4.0)

```text
Name    Combo Name  47--32  31--30  29  28--27  26        25--21  20--16  15--6   5--2    1    0
VSTEOA  V.VSTEOA            N/A     vm  dwidth  sub-code  Rs2     Rs1     OACCs2  opcode  VCE  CCE
```

```text
Name    Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
VSTEOA  V.VSTEOA    VLDST                                            1
```

VSTEOA OACCs2, Rs1, Rs2

VSTEOA指令中，Rs1作为基址寄存器保存起始地址 ，Rs2保存以元素间隔为单位的有符号立即数，作为地址间隔stride。VSTEOA将每个VPT 的一个OACC中的数据向量化存储到内存中。存储的第一个元素地址为Rs1保存的起始地址，访问后续元素的地址依次累加Rs2保存的地址间隔。VSTEOA支持存储数据宽度为8bit/16bit/32bit/64bit，同时按照VACC Data Element Mapping中的数据格式自动将OACC中的交替排列转换为memory中的线性排列。VSTEOA指令并不保证每个单独的内存访问之间的顺序，因此当stride=0时，结果不可知。指令支持Per Element对齐，即地址对齐放宽到dwidth规定的element宽度。

每个元素地址计算时，使用SR[Rs1][47:0]+(i * SR[Rs2][47:0])结果的低48bit作为虚拟地址。SR[Rs1][63:48]作为寻址的hint不受到加法影响，直接传递给每个元素.

本指令受到VL和maskbit的影响

- 对于index大于等于VL部分的元素，以及在vm=0情况下maskbit=0的元素，严格不能回写memory或导致exception

```text
bits(64) base_address;
bits(64) stride;
base_address = SR[Rs1];
stride = SR[Rs2];
bits(64) va_length;  // 512-bit
bits(64) data_width = 8 * 2^dwidth; // data_width in {8,16,32,64}
bits(64) va_nums = 8;   // 8 in MLI_VLDXOA
bits(64) elem_nums = va_length * va_nums / data_width;
bits(64) address_array[];
address_array[0] = base_address
for (e = 1; e < 2*elem_nums; e++) {    //计算两个VPT每个元素对应内存地址
    address_array[e] = address_array[e - 1] + stride * 2^dwidth;
}
for i = 0...VPT_NUM-1 {
    for (e = 0; e < elem_nums; e++) {
        bits(64) addr = address_array[e + i * elem_nums];
        MEM[addr][data_width - 1:0] = OACC[i][OACCs2_index][e];   //是否写入受到VL和maskbit影响。
    }
}
```

**Field description:**

- `dwidth`
  - 0: 写入8bit数据，按照VA 8bit排列要求自动进行交替(remap)
  - 1: 写入16bit数据，按照VA 16bit排列要求自动进行交替(remap)
  - 2: 写入32bit数据，不需要进行交替排列
  - 3: 写入64bit数据，按照VA 64bit排列要求自动进行交替(remap)
- `OACCs2`
  - VACCs1_index = VAB_VPT* + {OACCs2, 3'b0};
  - OACCs2_index = VACCs2_index >> 3
- `vm`
  - vm=0，使用VACC[0+VAB_VPT*]中maskbit作为写回条件。
  - vm=1，非条件写回

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`
- `ESL_DTYPE`

### 8.7.12. REDV.ADD (new in 4.0)

```text
Name      Combo Name  47--32  31--30  29  28--27     26--25  24--23  22--21  20--16  15--6   5--2    1    0
REDV.ADD  V.REDV.ADD          N/A     vm  sub-code2  dwidth  dtype   N/A     Rs1     OACCs1  opcode  VCE  CCE
```

```text
Name      Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
REDV.ADD  V.REDV.ADD  VLDST                                            1
```

REDV.ADD OACCs1, Rs1

向量化原子性加法指令，根据OACCs1寄存器保存的数据类型，将以Rs1保存的内存地址开始的连续内存空间上的数据，与OACCs1各元素进行累加，结果保留在原地址。指令支持Per Element对齐，即地址对齐放宽到dwidth规定的element宽度。

本指令受到VL和maskbit的影响

- 对于index大于等于VL部分的元素，以及在vm=0情况下maskbit=0的元素，严格不能回写memory或导致exception
本指令执行加法操作时有如下特点：

- 当操作数类型为UINT/INT时，如果发生溢出，则保留LSB部分，不做saturation。
- 当操作数类型为FP16/FP32/BF16时：
- subnormal输入输出不做flush to zero操作。
- 舍入模式固定为Rounds to nearest even。

```text
bits(64) address;
address = SR[Rs1];
bits(64) va_length;
bits(64) data_width;
bits(64) elem_per_va;
bits(64) va_nums = 8;
bits(64) vacc_idx;
if(dwidth == 0) {data_width = 8;}
if(dwidth == 1) {data_width = 16;}
if(dwidth == 2) {data_width = 32;}
if(dwidth == 3) {data_width = 64;}
for i = 0...VPT_NUM-1 {
    address = SR[Rs1] + 512*i;
    if (data_width != 64) {
        elem_per_va = va_length / data_width; // elem_per_va in {64,32,16}
        for(k = 0; k < va_nums; k++){
            vacc_idx = VACCs1_index + k;
            for(j = 0; j < elem_per_va; j++) {
                /*-------以下操作保持原子性，不被打断-------*/
                amo.add(SR0，address,VA[VPT0][vacc_idx][j])；
                /*-------以上操作保持原子性，不被打断-------*/
                address = address + data_width/8;
            }
        }
    } else {
        return NOP；//暂不支持对64bit数据操作
    }
}
amo.add(Rd,address,value) {
    if (dwidth == 1) datasize = 16;
    if (dwidth == 2) datasize = 32;
    bits(datasize) addvalue = value;
    bits(datasize) data = MEM[address];
    MEM[address] = addvalue + data；
    if(dtype == 1) {
        SR[Rd][63:0] = sign_extend(data);
    } else {
        SR[Rd][63:0] = zero_extend(data);
    }
}
```

**Field description:**

- dwidth & dtype
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| FP16 | dtype == 2 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| BF16 | dtype == 3 && dwidth == 1 |
| Other: Reserved | Other: Reserved |

- `OACCs1`
  - VACCs1_index = VAB_VPT* + {OACCs1, 3'b0};
- `dwidth`
  - 0: 写入8bit数据，按照VA 8bit排列要求自动进行交替(remap)
  - 1: 写入16bit数据，按照VA 16bit排列要求自动进行交替(remap)
  - 2: 写入32bit数据，不需要进行交替排列
  - 3: 写入64bit数据，按照VA 64bit排列要求自动进行交替(remap)
- `vm`
  - vm=0，使用VACC[0+VAB_VPT*]中maskbit作为写回条件。
  - vm=1，非条件写回

**Implicit Use:**

- `VAB_VPT*`
- `VL`
- `TCTL`

### 8.7.13. REDV.MAX (new in 4.0)

```text
Name      Combo Name  47--32  31--30  29  28--27     26--25  24--23  22--21  20--16  15--6   5--2    1    0
REDV.MAX  V.REDV.MAX          N/A     vm  sub-code2  dwidth  dtype   N/A     Rs1     OACCs1  opcode  VCE  CCE
```

```text
Name      Combo Name  Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
REDV.MAX  V.REDV.MAX  VLDST                                            1
```

REDV.MAX OACCs1, Rs1

向量化原子性求最大值指令，根据OACCs1寄存器保存的数据类型，将以Rs1保存的内存地址开始的连续内存空间上的数据，与OACCs1各元素进行求最大值，结果保留在原地址。如果是浮点格式并且输入操作数中有NaN，则结果选择本ISA规定的标准NaN输出。请见NaN Result 章节。指令支持Per Element对齐，即地址对齐放宽到dwidth规定的element宽度。

本指令受到VL和maskbit的影响

- 对于index大于等于VL部分的元素，以及在vm=0情况下maskbit=0的元素，严格不能回写memory或导致exception
关于原子性指令的介绍，请见AMO serial

```text
bits(64) address;
address = SR[Rs1];
bits(64) va_length;
bits(64) data_width;
bits(64) elem_per_va;
bits(64) va_nums = 8;
bits(64) vacc_idx;
if(dwidth == 0) {data_width = 8;}
if(dwidth == 1) {data_width = 16;}
if(dwidth == 2) {data_width = 32;}
if(dwidth == 3) {data_width = 64;}
for i = 0...VPT_NUM-1 {
    if (data_width != 64) {
        address = SR[Rs1] + 512*i;
        elem_per_va = va_length / data_width; // elem_per_va in {64,32,16}
        for(k = 0; k < va_nums; k++){
            vacc_idx = VACCs1_index + k;
            for(j = 0; j < elem_per_va; j++) {
                /*-------以下操作保持原子性，不被打断-------*/
                amo.max(SR0，address,VA[VPT0][vacc_idx][j])；
                /*-------以上操作保持原子性，不被打断-------*/
                address = address + data_width/8;
            }
        }
    } else {
        return NOP；//暂不支持对64bit数据操作
    }
}
amo.max(Rd,address,value) {
    if (dwidth == 1) datasize = 16;
    if (dwidth == 2) datasize = 32;
    bits(datasize) data = MEM[address];
    MEM[address] = max(value，data);
    if(dtype == 1) {
        SR[Rd][63:0] = sign_extend(data);
    } else {
        SR[Rd][63:0] = zero_extend(data);
    }
}
```

**Field description:**

- dwidth & dtype
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| FP16 | dtype == 2 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| BF16 | dtype == 3 && dwidth == 1 |
| Other: Reserved | Other: Reserved |

- `OACCs1`
  - VACCs1_index = VAB_VPT* + {OACCs1, 3'b0};
- `dwidth`
  - 0: 写入8bit数据，按照VA 8bit排列要求自动进行交替(remap)
  - 1: 写入16bit数据，按照VA 16bit排列要求自动进行交替(remap)
  - 2: 写入32bit数据，不需要进行交替排列
  - 3: 写入64bit数据，按照VA 64bit排列要求自动进行交替(remap)
- `vm`
  - vm=0，使用VACC[0+VAB_VPT*]中maskbit作为写回条件。 vm=1，非条件写回

**Implicit Use:**

- `VAB_VPT*`
- `VL`
- `TCTL`

### 8.7.14. REDV.MAXNUM (new in 4.0)

```text
Name         Combo Name     47--32  31--30  29  28--27     26--25  24--23  22--21  20--16  15--6   5--2    1    0
REDV.MAXNUM  V.REDV.MAXNUM          N/A     vm  sub-code2  dwidth  dtype   N/A     Rs1     OACCs1  opcode  VCE  CCE
```

```text
Name         Combo Name     Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
REDV.MAXNUM  V.REDV.MAXNUM  VLDST                                            1
```

REDV.MAXNUM OACCs1, Rs1

向量化原子性求最大值指令，根据OACCs1寄存器保存的数据类型，将以Rs1保存的内存地址开始的连续内存空间上的数据，与OACCs1各元素进行求最大值，结果保留在原地址。如果输入为浮点格式并且操作数只有一个NaN，则结果选择非NaN数值。如果浮点格式并且两个都是 NaN，则结果选择本ISA规定的标准NaN输出。请见NaN Result章节。指令支持Per Element对齐，即地址对齐放宽到dwidth规定的element 宽度。

本指令受到VL和maskbit的影响

- 对于index大于等于VL部分的元素，以及在vm=0情况下maskbit=0的元素，严格不能回写memory或导致exception
关于原子性指令的介绍，请见AMO serial

```text
bits(64) address;
address = SR[Rs1];
bits(64) va_length;
bits(64) data_width;
bits(64) elem_per_va;
bits(64) va_nums = 8;
bits(64) vacc_idx;
if(dwidth == 0) {data_width = 8;}
if(dwidth == 1) {data_width = 16;}
if(dwidth == 2) {data_width = 32;}
if(dwidth == 3) {data_width = 64;}
for i = 0...VPT_NUM-1 {
    if (data_width != 64) {
        address = SR[Rs1] + 512*i;
        elem_per_va = va_length / data_width; // elem_per_va in {64,32,16}
        for(k = 0; k < va_nums; k++){
            vacc_idx = VACCs1_index + k;
            for(j = 0; j < elem_per_va; j++) {
                /*-------以下操作保持原子性，不被打断-------*/
                amo.max(SR0，address,VA[VPT0][vacc_idx][j])；
                /*-------以上操作保持原子性，不被打断-------*/
                address = address + data_width/8;
            }
        }
    } else {
        return NOP；//暂不支持对64bit数据操作
    }
}
amo.max(Rd,address,value) {
    if (dwidth == 1) datasize = 16;
    if (dwidth == 2) datasize = 32;
    bits(datasize) data = MEM[address];
    MEM[address] = max(value，data);
    if(dtype == 1) {
        SR[Rd][63:0] = sign_extend(data);
    } else {
        SR[Rd][63:0] = zero_extend(data);
    }
}
```

**Field description:**

- dwidth & dtype
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| FP16 | dtype == 2 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| BF16 | dtype == 3 && dwidth == 1 |
| Other: Reserved | Other: Reserved |

- `OACCs1`
  - VACCs1_index = VAB_VPT* + {OACCs1, 3'b0};
- `dwidth`
  - 0: 写入8bit数据，按照VA 8bit排列要求自动进行交替(remap)
  - 1: 写入16bit数据，按照VA 16bit排列要求自动进行交替(remap)
  - 2: 写入32bit数据，不需要进行交替排列
  - 3: 写入64bit数据，按照VA 64bit排列要求自动进行交替(remap)
- `vm`
  - vm=0，使用VACC[0+VAB_VPT*]中maskbit作为写回条件。
  - vm=1，非条件写回

**Implicit Use:**

- `VAB_VPT*`
- `VL`
- `TCTL`

### 8.7.15. MLI_VLDXOA (new in 4.0)

```text
Name        Combo Name      47--44    43--42  41  40   39--31  30--26  25--16  15--6  5--0
MLI_VLDXOA  MLI.MLI_VLDXOA  sub-code  dwidth  vm  LCE  N/A     Rs1     OACCs1  OACCd  opcode
```

```text
Name        Combo Name      Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MLI_VLDXOA  MLI.MLI_VLDXOA  VLDST                                                    1
```

MLI_VLDXOA OACCd, Rs1, OACCs1

ISA4.0新增向量化访存指令，支持访存的数据宽度包括8bit/16bit/32bit/64bit，MLI_VLDXOA从内存地址中访问数据保存到OACCd中。Rs1 作为基址寄存器保存起始地址 ，以OACCs1为起始的8/4/2/1个OACC保存以字节为单位的有符号立即数，作为对应每个元素的地址偏移，位宽为64bit。保存数据的OACCd按照访问的数据宽度根据Accumulation Register File规则自动进行数据位置的排列。保存地址偏移的 OACCs1按照64bit数据宽度根据Accumulation Register File规则自动进行数据位置的排列。MLI_VLDXOA指令并不保证每个单独的内存访问之间的顺序。指令支持Per Element对齐，即地址对齐放宽到dwidth规定的element宽度。

每个元素地址计算时，使用(SR[Rs1][47:0]+VACCs1[i][47:0])结果的低48bit作为虚拟地址。SR[Rs1][63:48]作为寻址的hint不受到加法影响， 直接传递给每个元素

本指令受到VL和maskbit的影响

- 对于index大于等于VL部分的元素，以及在vm=0情况下maskbit=0的元素，均严格不导致exception
- 对于index大于等于VL部分的元素，目标寄存器数值保持不变
- 在vm=0情况下maskbit=0的元素并且非VL tail的元素，目标寄存器数值保持不变
本指令的约束条件：

- 本指令固定和C-slot的MLI_HINT一起打包，不能和其他任何指令打包。
- 本指令支持双VPT，SR[Rs1]数值作为共享的基地址，共享给两个VPT。保存offset的向量寄存器各VPT独立。

```text
bits(64) base_address;
base_address = SR[Rs1];
bits(64) va_length;  // 512-bit
bits(64) data_width;
bits(64) va_nums = 8;   // 8 in MLI_VLDXOA
bits(64) vaccs1_nums = 64 * va_nums/data_width;
bits(64) elem_nums = va_length * va_nums / data_width;
bits(64) offset_array[];
for i = 0...VPT_NUM-1 {
    e = 0;
    vaccs1_idx = VACCs1_index;
    for(j = 0; j < vaccs1_nums; j=j+2)
        for(k = 0; k < 16; k++) {
            offset_array[e] = VA[i][vaccs1_idx + j][k] + VA[i][vaccs1_idx + j + 1][k] << 32;
            e++;
        }
    }
    for (e = 0; e < elem_nums; e++) {
        bits(64) addr = base_address + offset_array[e];
        OACCd[i][OACCd_index][e] = MEM[addr][data_width-1:0];   //是否写入受到VL和maskbit影响。
    }
}
```

**Field description:**

- `dwidth`
  - 0: 读入8bit数据，按照VA 8bit排列要求自动进行交替(remap)
  - 1: 读入16bit数据，按照VA 16bit排列要求自动进行交替(remap)
  - 2: 读入32bit数据，不需要进行交替排列
  - 3: 读入64bit数据，按照VA 64bit排列要求自动进行交替(remap)
- `OACCd`
  - VACCd_index = VAB_VPT* + {OACCd, 3'b0}
  - OACCd_index = VACCd_index >> 3
- `OACCs1`
  - VACCs1_index = VAB_VPT* + {OACCs1, 3'b0};
  - OACCs1_index = VACCs1_index >> 3

| dwidth | OACCd | OACCs1 | OACCd对齐说明 | OACCs1对齐说明 |
| --- | --- | --- | --- | --- |
| 0 | OACCd | OACCs1 至 OACCs1 + 7 | OACCd必须8VA对齐 | OACCs1必须8VA对齐 |
| 1 | OACCd | OACCs1 至 OACCs1 + 3 | OACCd必须8VA对齐 | OACCs1必须8VA对齐 |
| 2 | OACCd | OACCs1 至 OACCs1 + 1 | OACCd必须8VA对齐 | OACCs1必须8VA对齐 |
| 3 | OACCd | OACCs1 | OACCd必须8VA对齐 | OACCs1必须8VA对齐 |

- `vm`
  - vm=0，使用VACC[0+VAB_VPT*]中maskbit作为写回条件。
  - vm=1，非条件写回
  - 如果vm=0，则VACCd不能为VACC[0+VAB_VPT*]
- 源操作数和目的操作数不能互相覆盖
  - OACCs1和OACCd不能互相覆盖

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.7.16. MLI_VSTXOA (new in 4.0)

```text
Name        Combo Name      47--44    43--42  41  40   39--31  30--26  25--16  15--6   5--0
MLI_VSTXOA  MLI.MLI_VSTXOA  sub-code  dwidth  vm  LCE  N/A     Rs1     OACCs1  OACCs2  opcode
```

```text
Name        Combo Name      Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MLI_VSTXOA  MLI.MLI_VSTXOA  VLDST                                                    1
```

MLI_VSTXOA oaccs2 (rs1) oaccs1

ISA4.0新增向量化访存指令，支持访存的数据宽度包括8bit/16bit/32bit/64bit，MLI_VSTXOA将OACCs2的数据保存在内存中。Rs1作为基址寄存器保存起始地址 ，以OACCs1为起始的8/4/2/1个OACC保存以字节为单位的有符号立即数，作为对应QACCs2每个元素的地址偏移。保存数据的OACCs2按照访问的数据宽度根据Accumulation Register File规则自动进行数据位置的排列。保存地址偏移的OACCs1按照64bit数据宽度根据Accumulation Register File规则自动进行数据位置的排列。MLI_VSTXOA指令并不保证每个单独的内存访问之间的顺序。

每个元素地址计算时，使用(SR[Rs1][47:0]+VACCs1[i][47:0])结果的低48bit作为虚拟地址。SR[Rs1][63:48]作为寻址的hint不受到加法影响， 直接传递给每个元素

本指令受到VL和maskbit的影响

- 对于index大于等于VL部分的元素，以及在vm=0情况下maskbit=0的元素，严格不能回写memory或导致exception
本指令的约束条件：

- 本指令固定和C-slot的MLI_HINT一起打包，不能和其他任何指令打包。
- 本指令支持双VPT，SR[Rs1]数值作为共享的基地址，共享给两个VPT

```text
bits(64) base_address;
base_address = SR[Rs1];
bits(64) va_length;  // 512-bit
bits(64) data_width;
bits(64) va_nums;   // 4 in MLI_VLDXQA
bits(64) vaccs1_nums = 64 * va_nums/data_width;
bits(64) elem_nums = va_length * va_nums / data_width;
bits(64) offset_array[];
for i = 0...VPT_NUM-1 {
    e = 0;
    vaccs1_idx = VACCs1_index;
    for(j = 0; j < vaccs1_nums; j=j+2)
        for(k = 0; k < 16; k++) {
            offset_array[e] = VA[i][vaccs1_idx + j][k] + VA[i][vaccs1_idx + j + 1][k] << 32;
            e++;
        }
    }
    for (e = 0; e < elem_nums; e++) {
        bits(64) addr = base_address + offset_array[e];
        MEM[addr][data_width-1:0] = OACC[i][OACCs2_index][e];   //是否写入受到VL和maskbit影响。
    }
}
```

**Field description:**

- `dwidth`
  - 0: 写入8bit数据，按照VA 8bit排列要求自动进行交替(remap)
  - 1: 写入16bit数据，按照VA 16bit排列要求自动进行交替(remap)
  - 2: 写入32bit数据，不需要进行交替排列
  - 3: 写入64bit数据，按照VA 64bit排列要求自动进行交替(remap)
- `OACCs1`
  - VACCs1_index = VAB_VPT* + {OACCs1, 3'b0};
  - OACCs1_index = VACCs1_index >> 3;
- `OACCs2`
  - VACCs2_index = VAB_VPT* + {OACCs2, 3'b0};
  - OACCs2_index = VACCs2_index >> 3;

| dwidth | OACCs2 | OACCs1 | OACCs2对齐说明 | OACCs1对齐说明 |
| --- | --- | --- | --- | --- |
| 0 | OACCs2 | OACCs1 至 OACCs1 + 7 | OACCs2必须8VA对齐 | OACCs1必须8对齐 |
| 1 | OACCs2 | OACCs1 至 OACCs1 + 3 | OACCs2必须8VA对齐 | OACCs1必须8VA对齐 |
| 2 | OACCs2 | OACCs1 至 OACCs1 + 1 | OACCs2必须8VA对齐 | OACCs1必须8VA对齐 |
| 3 | OACCs2 | OACCs1 至 OACCs1 | OACCs2必须8VA对齐 | OACCs1必须8VA对齐 |

- `vm`
  - vm=0，使用VACC[0+VAB_VPT*]中maskbit作为写回条件。
  - vm=1，非条件写回

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`
- `ESL_DTYPE`

### 8.7.17. MLI_VLDXI32OA (new in 4.0)

```text
Name           Combo Name         47--44    43--42  41  40   39--31  30--26  25--16  15--6  5--0
MLI_VLDXI32OA  MLI.MLI_VLDXI32OA  sub-code  dwidth  vm  LCE  N/A     Rs1     OACCs1  OACCd  opcode
```

```text
Name           Combo Name         Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MLI_VLDXI32OA  MLI.MLI_VLDXI32OA  VLDST                                                    1
```

MLI_VLDXI32OA oaccd (rs1) oaccs1

ISA4.0新增向量化访存指令，支持访存的数据宽度包括8bit/16bit/32bit/64bit，MLI_VLDXOA从内存地址中访问数据保存到OACCd中。Rs1 作为基址寄存器保存起始地址 ，以OACCs1为起始的4/2/1个OACC保存以字节为单位的有符号立即数，作为对应每个元素的地址偏移，位宽为32bit。保存数据的OACCd按照访问的数据宽度根据Accumulation Register File规则自动进行数据位置的排列。保存地址偏移的OACCs1 按照32bit数据宽度根据Accumulation Register File规则自动进行数据位置的排列。MLI_VLDXI32OA指令并不保证每个单独的内存访问之间的顺序。指令支持Per Element对齐，即地址对齐放宽到dwidth规定的element宽度。

每个元素地址计算时，使用(SR[Rs1][47:0]+VACCs1[i][31:0])结果的低48bit作为虚拟地址。SR[Rs1][63:48]作为寻址的hint不受到加法影响， 直接传递给每个元素

本指令受到VL和maskbit的影响

- 对于index大于等于VL部分的元素，以及在vm=0情况下maskbit=0的元素，均严格不导致exception
- 对于index大于等于VL部分的元素，目标寄存器数值保持不变
- 在vm=0情况下maskbit=0的元素并且非VL tail的元素，目标寄存器数值保持不变
本指令的约束条件：

- 本指令固定和C-slot的MLI_HINT一起打包，不能和其他任何指令打包。
- 本指令支持双VPT，SR[Rs1]数值作为共享的基地址，共享给两个VPT

```text
bits(64) base_address;
base_address = SR[Rs1];
bits(64) va_length;  // 512-bit
bits(64) data_width; //  in {8,16,32,64}
bits(64) va_nums;   // in{1，2，4，8}
bits(64) vaccs1_nums = 32 * va_nums/data_width;
bits(64) elem_nums = va_length * va_nums / data_width;
bits(64) offset_array[];
for i = 0...VPT_NUM-1 {
    e = 0;
    vaccs1_idx = VACCs1_index;
    for(j = 0; j < vaccs1_nums; j++)
        for(k = 0; k < 16; k++) {
            offset_array[e] = VA[i][vaccs1_idx + j][k]；
            e++;
        }
    }
    for (e = 0; e < elem_nums; e++) {
        bits(64) addr = base_address + offset_array[e];
        OACCd[i][OACCd_index][e] = MEM[addr][data_width-1:0];   //是否写入受到VL和maskbit影响。
    }
}
```

**Field description:**

- `dwidth`
  - 0: 读入8bit数据，按照VA 8bit排列要求自动进行交替(remap)
  - 1: 读入16bit数据，按照VA 16bit排列要求自动进行交替(remap)
  - 2: 读入32bit数据，不需要进行交替排列
  - 3: 读入64bit数据，按照VA 64bit排列要求自动进行交替(remap)
- `OACCd`
  - VACCd_index = VAB_VPT* + {OACCd, 3'b0}
  - OACCd_index = VACCd_index >> 3
- `OACCs1`
  - VACCs1_index = VAB_VPT* + {OACCs1, 3'b0};
  - OACCs1_index = VACCs1_index >> 3

| dwidth | OACCd | OACCs1 | OACCd对齐说明 | OACCs1对齐说明 |
| --- | --- | --- | --- | --- |
| 0 | OACCd | OACCs1 至 OACCs1 + 3 | OACCd必须8VA对齐 | OACCs1必须8VA对齐 |
| 1 | OACCd | OACCs1 至 OACCs1 + 1 | OACCd必须8VA对齐 | OACCs1必须8VA对齐 |
| 2 | OACCd | OACCs1 | OACCd必须8VA对齐 | OACCs1必须8VA对齐 |
| 3 | OACCd | QACCs1 | OACCd必须8VA对齐 | OACCs1必须4VA对齐 |

- `vm`
  - vm=0，使用VACC[0+VAB_VPT*]中maskbit作为写回条件。
  - vm=1，非条件写回
  - 如果vm=0，则VACCd不能为VACC[0+VAB_VPT*]
- 源操作数和目的操作数不能互相覆盖
  - OACCs1和OACCd不能互相覆盖

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.7.18. MLI_VSTXI32OA (new in 4.0)

```text
Name           Combo Name         47--44    43--42  41  40   39--31  30--26  25--16  15--6   5--0
MLI_VSTXI32OA  MLI.MLI_VSTXI32OA  sub-code  dwidth  vm  LCE  N/A     Rs1     OACCs1  OACCs2  opcode
```

```text
Name           Combo Name         Type   C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MLI_VSTXI32OA  MLI.MLI_VSTXI32OA  VLDST                                                    1
```

MLI_VSTXI32OA oaccs2 (rs1) oaccs1

ISA4.0新增向量化访存指令，支持访存的数据宽度包括8bit/16bit/32bit/64bit，MLI_VSTXOA将OACCs2的数据保存在内存中。Rs1作为基址寄存器保存起始地址 ，以OACCs1为起始的4/2/1个OACC保存以字节为单位的有符号立即数，作为对应QACCs2每个元素的地址偏移，位宽为32bit。保存数据的OACCs2按照访问的数据宽度根据Accumulation Register File规则自动进行数据位置的排列。保存地址偏移的OACCs1 按照32bit数据宽度根据Accumulation Register File规则自动进行数据位置的排列。MLI_VSTXOA指令并不保证每个单独的内存访问之间的顺序。指令支持Per Element对齐，即地址对齐放宽到dwidth规定的element宽度。

每个元素地址计算时，使用(SR[Rs1][47:0]+VACCs1[i][31:0])结果的低48bit作为虚拟地址。SR[Rs1][63:48]作为寻址的hint不受到加法影响， 直接传递给每个元素

本指令受到VL和maskbit的影响

- 对于index大于等于VL部分的元素，以及在vm=0情况下maskbit=0的元素，严格不能回写memory或导致exception
本指令的约束条件：

- 本指令固定和C-slot的MLI_HINT一起打包，不能和其他任何指令打包。
- 本指令支持双VPT，SR[Rs1]数值作为共享的基地址，共享给两个VPT

```text
bits(64) base_address;
base_address = SR[Rs1];
bits(64) va_length;  // 512-bit
bits(64) data_width; //  in {8,16,32,64}
bits(64) va_nums;   // in {1,2,4,8}
bits(64) vaccs1_nums = 32 * va_nums/data_width;  // data_width==8 需要32个保存offset的vaccs1
bits(64) elem_nums = va_length * va_nums / data_width;
bits(64) offset_array[];
for i = 0...VPT_NUM-1 {
    e = 0;
    vaccs1_idx = VACCs1_index;
    for(j = 0; j < vaccs1_nums; j++)
        for(k = 0; k < 16; k++) {
            offset_array[e] = VA[i][vaccs1_idx + j][k]；
            e++;
        }
    }
    for (e = 0; e < elem_nums; e++) {
        bits(64) addr = base_address + offset_array[e];
        MEM[addr][data_width-1:0] = OACC[i][OACCs2_index][e];   //是否写入受到VL和maskbit影响。
    }
}
```

**Field description:**

- `dwidth`
  - 0: 写入8bit数据，按照VA 8bit排列要求自动进行交替(remap)
  - 1: 写入16bit数据，按照VA 16bit排列要求自动进行交替(remap)
  - 2: 写入32bit数据，不需要进行交替排列
  - 3: 写入64bit数据，按照VA 64bit排列要求自动进行交替(remap)
- `OACCs1`
  - VACCs1_index = VAB_VPT* + {OACCs1, 3'b0};
  - OACCs1_index = VACCs1_index >> 3
- `OACCs2`
  - VACCs2_index = VAB_VPT* + {OACCs2, 3'b0};
  - OACCs2_index = VACCs1_index >> 3

| dwidth | OACCs2 | OACCs1 | OACCs2对齐说明 | OACCs1对齐说明 |
| --- | --- | --- | --- | --- |
| 0 | OACCs2 | OACCs1 至 OACCs1 + 3 | OACCs2必须8VA对齐 | OACCs1必须8对齐 |
| 1 | OACCs2 | OACCs1 至 OACCs1 + 1 | OACCs2必须8VA对齐 | OACCs1必须8VA对齐 |
| 2 | OACCs2 | OACCs1 至 OACCs1 | OACCs2必须8VA对齐 | OACCs1必须8VA对齐 |
| 3 | OACCs2 | QACCs1 | OACCs2必须8VA对齐 | OACCs1必须4VA对齐 |

- `vm`
  - vm=0，使用VACC[0+VAB_VPT*]中maskbit作为写回条件。
  - vm=1，非条件写回

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`
- `ESL_DTYPE`

## 8.8. MALU Type Instruction

MALU type instructions supports matrix ALU operation for below data format

- UINT8 & INT8
- UINT16 & INT16
- UINT32 & INT32
- UINT64 & INT64
- FP8 E4M3 & FP8 E5M2
- `BF16`
- `FP16`
- `FP32`

### 8.8.1. GEMM Operation (new in 4.0)

GEMM是General Matrix to Matrix Multiplication的缩写，即矩阵和矩阵进行乘法的2D运算类指令。本系列指令某种程度上可以视为对 VMM系列指令的一种扩展。该指令有三个输入操作数和一个输出操作数，，即左矩阵输入操作数、右矩阵输入操作数、累加矩阵输入操作数和输出矩阵操作数。其中累加矩阵和输出矩阵是同一个操作数，即C = C + A * B。指令执行时，左矩阵的每一行会被广播到右矩阵的每一个列向量上，两两向量之间做dot运算，然后和累加矩阵中对应位置的元素做一个加法类操作(根据运算类型确定加法或者减法)，最后结果放到输出矩阵的对应元素位置上。其中左矩阵中每行的长度（列数）和右矩中每列的高度（行数）相同；右矩阵的宽度（列数）和累加矩阵/输出矩阵的宽度相同；左矩阵的高度（行数）和累加矩阵/输出矩阵的高度相同。下图是一个示例

          - LHS Matrix RHS Matrix
LHS Matrix Row

- `FP16`
          - `X`
        - dot-32 vector dot product
          - Sum in FP32 = X dot-32 LHS rows dot RHS columns individually
          - =
RHS Matrix Column

- `FP16`
          - Output Matrix each point is a dot-product output
和VMM系列指令类似的，MLI_GEMM系列指令左右矩阵运算的结果可以根据指令或者NACCOVR寄存器的设置，选择是否与来源于VACC的累加操作数进行累加操作。而最终结果则是存回VACC寄存器中。MLI_GEMM系列指令同样支持FP32/FP16/BF16/ EF32/INT8/UINT8/FP8_E4M3/FP8_E5M2等格式，而无论哪种格式，累加操作数和最终结果都是相同格式，并且是32bit的数据格式。如果输入数据格式是浮点格式，则累加和结果操作数都是FP32；如果输入数据格式是INT8/UINT8，则累加和结果操作数是INT32，并且INT32总是支持saturation。

MLI_GEMM系列指令和VMM系列指令不同点包含：

- Middle Level Instruction (MLI)
  - 这类指令在ISA4.0固定和C-slot的MLI_HINT一起打包，不能和其他任何指令打包
  - 这类指令预期在流水线上执行数十乃至数百个周期
- CISC风格指令
  - MLI_GEMM系列指令的左右矩阵之一来源于一定来源于memory
    - 另一个矩阵可以来源于VACC寄存器或者memory
  - MLI_GEMM系列指令的累加矩阵来源于VACC寄存器，并且输出矩阵写回同一套VACC寄存器
- 支持动态形状
  - 专用的SPR寄存器定义了左右矩阵在memory中的排列形式和实际尺寸
- 和SMR寄存器/IV寄存器/VR寄存器互斥

```text
MLI_GEMM指令使用了CISC风格，预期流水线隐式动态分配IV/VR寄存器作为左操作数寄存器，SMR作为右操作数寄存器。并且预期流水线可以自动释放这些寄存器  指令使用了CISC风格，预期流水线隐式动态分配IV/VR寄存器作为左操作数寄存器，SMR作为右操作数寄存器。并且预
期流水线可以自动释放这些寄存器
```

  - 由于存在潜在的结构冒险（structural hazard）。因此使用MLI_GEMM指令的软件线程，从开始执行到halt的过程中，不能使用带有IV/VR/SMR资源的指令!
特别的，GEMM系列指令输入/输出受到MODE_WRK寄存器的denormal flush的影响

- denormal fllush，指将输入的denormal数值和/或输出的denormal数值变为0。
- 对于FP32/FP16/BF16，各自有两个2bit，分别控制input denormal flush和output denormal flush

#### 8.8.1.1. Matrix Description

MLI_GEMM矩阵描述中，有3种矩阵，分别为

- LHS Matrix
- RHS Matrix
- ACC & DST Matrix
要描述任何一个矩阵，需要下列的操作数

- 数据格式 format
- 起始地址 addr
- 水平最大尺寸 dim0_max
- 垂直最大尺寸 dim1_max
- 水平实际尺寸 dim0_real
- 垂直实际尺寸 dim1_real
- 水平相邻两个元素存储间隔 dim0_stride 垂直相邻两个元素存储间隔 dim1_stride
其中，在水平方向和垂直方向定义了最大尺寸和实际尺寸dim_max/dim_real的原因在于支持矩阵动态形状。dim0_max和dim1_max是指令静态表述的，用于确定寄存器资源开销的上限和运算的上限；dim0_real和dim1_real则是本次运算中这个矩阵的实际大小，使用寄存器动态表述。它们的规则如下

- 如果dim0_real/dim1_real中任意一个数值为全0，则对应的这条指令被视为NOP。
- 如果dim0_real/dim1_real均不为0，并且dim0_real大于dim0_max，或者dim1_real大于dim1_max时，会报告异常
  - 如果该异常被忽略，则指令实际参与运算的矩阵在某个维度上的尺寸，是real和max两个数值中较小的那一个。
  - dim0_size = min(dim0_real, dim0_max)
  - dim1_size = min(dim1_real, dim1_max)
在MLI_GEMM中，右矩阵如果来源于memory，它的参数表述方式如下：

```text
Memory RHS参数  是否静态表述    数值来源                              说明
format          指令静态表述    指令gemm_mode域和dtype域              根据编码域推断
addr            寄存器动态表述  SR寄存器                              矩阵[0, 0]位置元素起始地址
dim0_max        指令静态表述    指令gemm_mode域                       单位element
dim1_max        指令静态表述    指令gemm_mode域                       单位element
dim0_real       寄存器动态表述  RHS_DIM0_REAL0 RHS_DIM0_REAL1 RHS_DIM0_REAL2  单位element 3个real size是给zero padding使用
dim1_real       寄存器动态表述  RHS_DIM1_REAL                         单位element 该寄存器实际为LHS_DIM0_REAL的别名
dim0_stride     寄存器动态表述  RHS_DIM0_STRIDE                       单位element 当指令为rhs_ldmode为0时，数值必须为1
dim1_stride     寄存器动态表述  RHS_DIM1_STRIDE                       单位element 当指令为rhs_ldmode为1时，数值必须为1*
```

Note: 对于Memory中RHS的dim0_stride/dim1_stride的约束，本质是要求右矩阵加载到隐式分配的SMR寄存器时，选择按行加载时列方向的元素在memory中紧密排列；选择按列加载时列方向的元素在memory中紧密排列

如果左矩阵来源于Memory，它的参数表述方式如下：

```text
Memory LHS参数  是否静态表述    数值来源                              说明
format          指令静态表述    指令gemm_mode域和dtype域              根据编码域推断
addr            寄存器动态表述  SR寄存器                              矩阵[0, 0]位置元素起始地址
dim0_max        指令静态表述    指令gemm_mode域                       单位element
dim1_max        指令静态表述    指令lhs_row_max域                     单位element
dim0_real       寄存器动态表述  LHS_DIM0_REAL                         单位element
dim1_real       寄存器动态表述  LHS_DIM1_REAL0 LHS_DIM1_REAL1 LHS_DIM1_REAL2  单位element 3个real size是给zero padding使用
dim0_stride     寄存器动态表述  LHS_DIM0_STRIDE                       在ISA4.0中，该寄存器为只读寄存器，数值恒定为1
dim1_stride     寄存器动态表述  LHS_DIM1_STRIDE                       单位element
```

对于累加/输出矩阵，它的参数表述方式如下

```text
VACC DST参数  是否静态表述    数值来源                  说明
format        指令静态表述    指令gemm_mode域和dtype域  根据编码域推断
addr          寄存器动态表述  指令VACCs3/d域            矩阵[0, 0]位置元素起始地址
dim0_max      指令静态表述    指令gemm_mode域           单位element
dim1_max      指令静态表述    指令lhs_row_max域         单位element
dim0_real     寄存器动态表述  RHS_DIM0_REAL2            单位element
dim1_real     寄存器动态表述  LHS_DIM1_REAL2            单位element
dim0_stride   指令静态表述    恒定为1                   在ISA4.0中，该寄存器为只读寄存器，数值恒定为1
dim1_stride   指令静态表述    指令dst_stride域          单位VACC个数数值计算为vacc_stride = 2^(1+dst_stride)
```

#### 8.8.1.2. gemm_mode & dtype

GEMM Mode时描述运算时数据格式和右矩阵最大尺寸的指令域。它借鉴自VMM的vmm_mode。所有MLI_GEMM系列指令都需要显示声明 gemm_mode。

这个指令域的数值编码和vmm_mode的关系为：

- gemm_mode变换自一部分编码大于0x11并且结尾为v1m1的vmm_mode
所有的gemm mode和gemm_sps mode编码如下

```text
gemm_mode             数值  输入数据格式                          lhs_dim0_max rhs_dim1_max  rhs_dim0_max dst_dim0_max  输出数据格式  支持的指令  说明
gemm.16b.rhs64x32     0x0   左右均为FP16                          64                         32                         格式 FP32     MLI_GEMM    类似 vmm.16b.v64.m64x32.v1m1
gemm.16b.rhs32x64     0x1   左右均为FP16 或者 BF16 需要配合dtype 确定  32                         64                         格式 FP32     MLI_GEMM    类似 vmm.16b.v32.m32x64.v1m1
gemm.32b.rhs16x32     0x2   左右均为FP32                          16                         32                         格式 FP32     MLI_GEMM    类似 vmm.32b.v16.m16x32.v1m1
gemm.8b.rhs64x64      0x3   左右均为INT8 或者 UINT8 需要配合dtype 确定  64                         64                         格式 INT32    MLI_GEMM    类似vmm.8b.v64.m64x64.v1m
gemm.8bus.rhs64x64    0x4   左支为 UINT8，右支为 INT8             64                         64                         格式 INT32    MLI_GEMM    类似 vmm.8bus.v64.m64x64.v1m1
gemm.ef32vm.rhs32x64  0x7   左右均为EF32                          32                         64                         格式 FP32     MLI_GEMM    类似 vmm.ef32vm.v32.m32x64.v1m
gemm.fp8b.rhs64x64    0x8   左右均为FP8 E4M3或者E5M2 需要配合dtype 确定  64                         64                         格式 FP32     MLI_GEMM    类似 vmm.fp8b.v64.m64x64.v1m1
```

```text
gemm_mode            数值  输入数据格式                          lhs_dim0_max rhs_dim1_max  rhs_dim0_max dst_dim0_max  输出数据格式  支持的指令  说明
gemm.fp8bx.rhs64x64  0x9   左支为 FP8 E4M3，右支为 FP8 E5M2 或者左支为FP8 E5M2，右支为 FP8 E4M3 需要配合dtype 确定  64                         64                         格式 FP32     MLI_GEMM    类似 vmm.fp8bx.v64.m64x64.v1m1
```

gemm_mode支持下述的数据格式

- `FP32`
  - 运算结果累加输出为FP32，结果不受MODE_WRK的浮点OVCLP影响
- BF16 & FP16
  - 运算结果累加输出为FP32，结果不受MODE_WRK的浮点OVCLP影响
- INT8 & UINT8
  - 支持INT8*INT8，UINT8*INT8和UINT8*UINT8的VMM模式
  - 运算结果累加输出为INT32格式，总是进行饱和操作
- `EF32`
  - EF32指代特殊的数据格式，它们存储时作为FP32存放，而运算时被转换为FP20运算
    - 转换规则详见Convert FP32 to EF32章节
  - FP32转换为FP20时采用rounding to nearest even的舍入模式
  - 运算结果累加输出为FP32，结果不受MODE_WRK的浮点OVCLP影响
- FP8_E4M3 & FP8_E5M2
  - 运算结果累加输出为FP32，结果不受MODE_WRK的浮点OVCLP影响
下列为gemm_mode和dtype的对于左右支操作数的所有合法表达组合

| gemm_mode & dtype | 左矩阵数据格式 | 右矩阵数据格式 | 输出数据格式 |
| --- | --- | --- | --- |
| gemm_mode = gemm.16b.rhs64x32 dtype == FP (0x2) | FP16 | FP16 | FP32 |
| gemm_mode = gemm.16b.rhs32x64 dtype == FP (0x2) | FP16 | FP16 | FP32 |
| gemm_mode = gemm.16b.rhs32x64 dtype == BF (0x3) | BF16 | BF16 | FP32 |
| gemm_mode = gemm.32b.rhs16x32 dtype == FP (0x2) | FP32 | FP32 | FP32 |
| gemm_mode = gemm.8b.rhs64x64 dtype == UINT (0x0) | UINT8 | UINT8 | INT32 |
| gemm_mode = gemm.8b.rhs64x64 dtype == INT (0x1) | INT8 | INT8 | INT32 |
| gemm_mode = gemm.8bus.rhs64x64 dtype == UINT (0x0) | UINT8 | INT8 | INT32 |
| gemm_mode = gemm.ef32vm.rhs32x64 dtype == FP (0x2) | EF32 | EF32 | FP32 |

| gemm_mode & dtype | 左矩阵数据格式 | 右矩阵数据格式 | 输出数据格式 |
| --- | --- | --- | --- |
| gemm_mode = gemm_sps.16b.rhs64x64 dtype == FP (0x2) | FP16 | FP16 | FP32 |
| gemm_mode = gemm_sps.16b.rhs64x64 dtype == BF (0x3) | BF16 | BF16 | FP32 |
| gemm_mode = gemm_sps.8b.rhs128x64 dtype == UINT (0x0) | UINT8 | UINT8 | INT32 |
| gemm_mode = gemm_sps.8b.rhs128x64 dtype == INT (0x1) | INT8 | INT8 | INT32 |
| gemm_mode = gemm_sps.8bus.rhs128x64 dtype == UINT (0x0) | UINT8 | INT8 | INT32 |
| gemm_mode = gemm.fp8b.rhs64x64 dtype == FP (0x2) | FP8 E4M3 | FP8 E4M3 | FP32 |
| gemm_mode = gemm.fp8b.rhs64x64 dtype == BF (0x3) | FP8 E5M2 | FP8 E5M2 | FP32 |
| gemm_mode = gemm.fp8bx.rhs64x64 dtype == FP (0x2) | FP8 E4M3 | FP8 E5M2 | FP32 |
| gemm_mode = gemm.fp8bx.rhs64x64 dtype == BF (0x3) | FP8 E5M2 | FP8 E4M3 | FP32 |

上表格概括

- dtype永远代表左支的格式
- gemm_mode中的32b代表FP32，ef32vm代表EF32，它们使用的dtype是固定的
- gemm_mode中的16b需要通过dtype来区别FP16和BF16。这类gemm_mode的左右支格式相同
- gemm_mode中的8b需要通过dtype来区别INT8和UINT8。这类gemm_mode的左右支格式相同
- gemm_mode中的8bus左支为UINT8，右支为INT8，它使用的dtype是固定的
- gemm_mode中的fp8b需要通过dtype来区别FP8 E4M3和FP8 E5M2。这类gemm_mode的左右支格式相同
- gemm_mode中的fp8bx需要通过dtype来确定左支是FP8 E4M3还是FP8 E5M2。这类gemm_mode的左右支格式相反

#### 8.8.1.3. lhs_row_max

lhs_row_max是用来描述GEMM系列指令左支dim1_max的指令域。它的合法范围为0~5，分别表达左支lhs_dim1_max为8 * (2^lhs_row_max)。而左支的dim0_max则是和右支的dim1_max相同，由gemm_mode来决定。

#### 8.8.1.4. Zero Padding

在卷积运算过程中，会要求input feature在运算时在Win和Hin各自的两个方向上增加一圈padding，称之为zero padding。Zero padding 中增加的0元素，对于卷积运算而言是必须的，不能跳过。在ISA4.0之前，zero padding是通过SDTE来完成。但是在SIP4.0中，每个SIP不再有SDTE，主要数据搬运依赖CDTE。这意味着进行计算时，在memory中的feature数据，本身是没有zero padding的。但是在计算过程中， 需要“无中生有”产生出zero padding的数据来，真实加入GEMM的运算过程中。因此GEMM通过增加了real size的寄存器来支持zero padding。

**Note:** 请注意区别unaligned padding和zero padding。前者是在支持动态形状时，如果加载的元素个数不满足于一个分拆出来的

SMR/IV/VR/VA寄存器时，为了简化流水线Hazard管理，避免parity写而自动添加的元素0。其用意只是用于填满单个寄存器而非用于计算。 Zero padding不同，它要求强制分配寄存器，填充为0并且必须用于计算。以GEMM为例，如果一个左矩阵其高度MAX_SIZE = 64， dim0_real1_size=6，dim0_real2_size=6，那么流水线只会拆出6行的VMM运算；但是如果其左矩阵其高度MAX_SIZE = 64， dim0_real1_size=6，dim0_real2_size=8，那么流水线会实际上拆出8行有效的VMM运算，其中最后2行为padding元素0的行。

![Figure 6](libra_sip_isa__figure_006.png)

GEMM系列指令在设计支持zero padding时，有如下假设：

- 当卷积feature作为GEMM的左支时，左矩阵dim0方向一定为Ci方向(或者BPK中的N方向)，不存在zero padding。左矩阵只有dim1维度可能存在zero padding。
- 当卷积feature作为GEMM的右支时，右矩阵dim1方向一定为Ci方向(或者BPK中的N方向)，不存在zero padding。右矩阵只有dim0维度可能存在zero padding。
- 流水线在加载zero padding的数据时，是从无到有凭空产生出的数据而非load的数据，并且永远是按整个vector加载的
  - 对于右矩阵，只有列模式才能使用zero padding，行加载模式忽略zero padding
- 对于源自于VACC的左矩阵和右矩阵，不支持zero padding
- 结构化系数的右矩阵同样不支持zero padding
- 不支持左右两支矩阵同时存在zero padding
基于上述假设，以左矩阵为例，GEMM指令支持zero padding的方法如下：

- 将dim1的real size寄存器扩展为3个，LHS_DIM1_REAL0/LHS_DIM1_REAL1/LHS_DIM1_REAL2
- 流水线按行拆解dim1的real size时，将三个real size寄存器当作阈值，分别进行padding/取数/padding的操作
- 这三个SPR的更新方法，和LHS_DIM0_REAL一模一样，都是使用setslice系列指令
  - 它们都可以使用total_size按照第i次切片的原理进行计算
- 对于不需要zero padding时，应当保证LHS_DIM1_REAL0 == 0，并且LHS_DIM1_REAL1 == LHS_DIM1_REAL2
  - setslice系列指令中，增加了一种模式，可以同步更新LHS_DIM1_REAL1/LHS_DIM1_REAL2，使得它们保持相同
- Note：某些场景下指令直接忽视zero padding。
  - 此时LHS_DIM1_REAL0无论实际数值为何，都被视作0
  - 此时LHS_DIM1_REAL2无论实际数值为何，都被视作和LHS_DIM1_REAL1相同
- 右支的RHS_DIM0_REAL0/RHS_DIM0_REAL1/RHS_DIM0_REAL2也是同样原理
    - `LHS_DIM1_REAL2`
        - `LHS_DIM1_REAL1`
          - `LHS_DIM1_REAL0`

```text
Zero Padding
```

          - row_idx < LHS_DIM1_REAL0 head padding行
          - LHS_DIM1_REAL0 <= row_idx &&

```text
Real Feature Data
```

          - row_idx < LHS_DIM1_REAL1 实际需要取数的行
          - LHS_DIM1_REAL1 <= row_idx && row_idx < LHS_DIM1_REAL2

```text
Zero Padding
```

          - Tail padding行
以左矩阵为例，具体使用GEMM支持zero padding的方法如下：

- 将feature tensor的一个[Win, Ci]矩阵视作一个大的输入矩阵，并根据当前的右支weight的S坐标算dim1方向上的三个参数（total number）
  - total number0：大输入矩阵开头的zero padding行数
  - total number1：大输入矩阵包含开头的zero padding但是不包含尾部zero padding的行数
  - total number2：大输入矩阵包含所有zero padding在内的总行数
  - [Hin, Ci]矩阵也可以做上述情况
- 使用setslice指令，根据当前切片的index，分别更新dim0和dim1的所有real size。其中对于dim1的real size更新关系为：
  - total number0切片 -》LHS_DIM1_REAL0
  - total number1切片 -》LHS_DIM1_REAL1
  - total number2切片 -》LHS_DIM1_REAL2
- 左支开始地址，无论是否有padding，始终是第一个Memory中实际有效元素的地址
- 执行GEMM指令，流水线根据3个LHS_DIM1_REAL*寄存器按行展开读数
  - 对于row_index < LHS_DIM1_REAL0的行，分配IV寄存器，但是并不真正发射读取指令，而是将IV寄存器全部填0（即head padding）
  - 对于RHS_DIM1_REAL0 <= row_index < LHS_DIM1_REAL1的行，分配IV寄存器并且发射真正的读取指令，将数据读回并且回写IV
  - 对于RHS_DIM1_REAL1 <= row_index < LHS_DIM1_REAL2的行，分配IV寄存器，但是并不真正发射读取指令，而是将IV寄存器全部填0（即tail padding）
  - 对于RHS_DIM1_REAL2<= row_index的行，不分配IV寄存器
  - 所有被分配的IV寄存器都要参与GEMM运算
- 对于流水线按行展开而言，只需要根据三个real size的阈值判断即可。如下图所示：
下图时实际可能出现的带有zero padding切片的情况：

          - Conv切片场景1
          - 第一次切片
Head Padding

```text
Zero Padding
Zero Padding
```

并不存在Memory中

          - LHS_DIM1_REAL0 = head_padding LHS_DIM1_REAL1 = DIM1_MAX_NUM

```text
Real Feature Data
```

          - LHS_DIM1_REAL2 = LHS_DIM1_REAL1
实际数据

```text
Real Feature Data
```

真实存在Memory中

          - 第N次切片

```text
Real Feature Data
```

          - LHS_DIM1_REAL0 = 0
Tail Padding

          - LHS_DIM1_REAL1 = (head_padding + real_lines) mod DIM1_MAX_NUM

```text
Zero Padding
Zero Padding
```

并不存在Memory中

          - LHS_DIM1_REAL2 = LHS_DIM1_REAL1 + tail_padding
        - Conv切片场景2
Head Padding

```text
Zero Padding
Zero Padding
```

并不存在Memory中

          - 第一次切片 LHS_DIM1_REAL0 = head_padding
实际数据

          - LHS_DIM1_REAL1 = (head_padding + real_lines) mod DIM1_MAX_NUM

```text
Real Feature Data
Real Feature Data
```

真实存在Memory中

          - LHS_DIM1_REAL2 = DIM1_MAX_NUM
Tail Padding

```text
Zero Padding
```

          - 第二次切片
并不存在Memory中

```text
Zero Padding
```

          - LHS_DIM1_REAL0 = 0

```text
Zero Padding
```

          - LHS_DIM1_REAL1 = 0 LHS_DIM1_REAL2 = (head_padding + real_lines + tail_padding) mod DIM1_MAX_NUM
当Feature放到右支进行运算时，预期右支使用按列加载的方式，其zero padding的原理和上面的左支切分方法一样。

下面是对于三个REAL SIZE的使用限制：

- 正常情况下要保证下列的大小关系。如果违反本条，请见Real Size Process章节。
  - LHS_DIM1_REAL0 <= LHS_DIM1_REAL1 <= LHS_DIM1_REAL2
  - RHS_DIM0_REAL0 <= RHS_DIM0_REAL1 <= RHS_DIM0_REAL2
- 不支持左右两支矩阵同时存在zero padding，因此需要保证以下两个条件至少有一个成立。如果违反本条，请见Real Size Process章节。
  - LHS_DIM1_REAL0 == 0 且 LHS_DIM1_REAL1 == LHS_DIM1_REAL2
  - RHS_DIM0_REAL0== 0 且 RHS_DIM0_REAL1 == RHS_DIM0_REAL2
- 下列情况下GEMM右支不使用RHS_DIM0_REAL0和RHS_DIM0_REAL2
  - GEMM指令并且roc == 0（即按行加载右支）
  - 此时RHS_DIM0_REAL0自动视为0，RHS_DIM0_REAL2自动视为和RHS_DIM0_REAL1相等

#### 8.8.1.5. dst_stride

对于INT8/FP8/FP16/EF32格式的GEMM运算，输出矩阵的dim0_max是32或者64。考虑到MLI_GEMM指令的回写结果都是32bit，因此这些 gemm_mode后继都可以做QACC或者OACC 1D指令的fusion操作。但是gemm.32b.rhs16x32输出矩阵的dim0_max是32，因此此时FP32 输入情况下会和其他格式的MLI_GEMM编程不一样。因此这里引入了dst_stride来处理这个问题。

在所有非gemm.32b.rhs16x32模式下，dst_stride可以选择数值为4VACC或者8VACC。而在使用gemm.32b.rhs.16x32模式时，可以选择 dst_stride为2VACC或者4VACC或者8VACC。在选择4VACC的情况下，使用两个MLI_GEMM指令可以gemm.32b.rhs.16x32模式结果形成 dim0_max为64的效果。如下图所示。这样所有MLI_GEMM的场景都可以使用相同的1D fusion编程。

|场景|`dst_stride` 选择|单条指令输出形状|VACC 覆盖关系|
|---|---|---|---|
|非 `gemm.32b.rhs16x32` 模式|`4VACC` 或 `8VACC`|`dst_dim0_max = 64`，`dst_dim1_max = 16`|一条 `MLI_GEMM` 覆盖完整的 `VACC0` ~ `VACC63` 输出区域。|
|`gemm.32b.rhs16x32` 模式，单条指令|`2VACC`、`4VACC` 或 `8VACC`|`dst_dim0_max = 32`，`dst_dim1_max = 16`|单条 `MLI_GEMM` 覆盖半宽输出区域。|
|`gemm.32b.rhs16x32` 模式，两条指令组合|通常选择 `4VACC`|两条 `MLI_GEMM` 合成 `dst_dim0_max = 64` 的效果|第一条和第二条 `MLI_GEMM` 分别写入相邻的半宽输出区域，从而对齐其他 GEMM 场景的 1D fusion 编程模型。|

Note：dst_stride是预期VISA或者C++编程层面上，无论输入格式如何，选择的GEMM计算形状都是一样的，然后在VISA->ISA层面转换时， 由compiler拆解为更多的MLI_GEMM指令，适配ISA指令中的形状。这一段自动deslice的过程预期compiler完成，VISA或者C++编程层面可以不看到这个问题。

#### 8.8.1.6. Pipeline Unrolling

对于MLI_GEMM指令而言，该指令预期在流水线上展开为LLI指令。

下面为一个INT8左右支输入，按照左右支均来源于memory，并且右支矩阵按照行方式读取的语义展开形式。请注意这里为语义展开形式， 并不代表流水线的实际实现

```text
//GEMM展开
int i;
int rhs_dim0_size = min(rhs_dim0_max, rhs_dim0_real);
int rhs_dim1_size = min(rhs_dim1_max, rhs_dim1_real);
int lhs_dim0_size = min(lhs_dim0_max, lhs_dim0_real);
int lhs_dim1_size = min(lhs_dim1_max, lhs_dim1_real2);
int tmp_lhs_vl = lhs_dim0_size; // IV/VR/DIV/DVR专用内部vl,指令不可访问
int tmp_lhs_addr = lhs_addr;
for(i = 0; i < lhs_dim1_size; i ++) {   //这个例子使用来源于memory的左输入矩阵
    if(i < lhs_dim1_real0) {
        tmp_IV[i] = 0x0; //head padding
    } else if(i < lhs_dim1_real1) {}
        tmp_IV[i] = vld_padding(tmp_lhs_addr, tmp_lhs_vl);//该load指令，回写寄存器可能为IV/VR/DIV/DVR,具体index为流
水线自动分配
        //当IV/VR/DIV/DVR宽度大于tmp_lhs_vl的时候，tail部分需要清零
        tmp_lhs_addr += lhs_dim1_stride * sizeof(int8); //只有此时更新地址
    } else {
        tmp_IV[i] = 0x0; //tail padding
    }
}
int tmp_rhs_vl = rhs_dim0_size;
int tmp_rhs_addr = rhs_addr;
tmp_SMR[0] = clrm();    //为流水线自动分配的SMR寄存器，指令不可见
for(i = 0; i < rhs_dim1_size; i ++) {
    tmp_SMR[0].row[i] = vld_padding(rhs_addr, tmp_rhs_vl); //当SMR一行宽度大于tmp_rhs_vl的时候，tail部分需要清零
    tmp_rhs_addr += rhs_dim1_stride * sizeof(int8);
    //按行加载时没有zero padding
}
int tmp_vacc_stride = (dst_dim1_stride) ? 4 : 2;
for(i = 0; i < lhs_dim1_size; i ++) {
    VACC[vaccs3d+i*tmp_vacc_stride] += vmm(vmm.8b.v64.m64x64.v1m1, tmp_IV[i], tmp_SMR[0]);
}
```

#### 8.8.1.7. Convert FP32 to EF32

在MLI_GEMM指令使用下面的gemm_mode时候，会在内部将FP32数据格式转换为EF32数据格式，作为GEMM的左操作数或者右操作数

- `gemm.ef32vm.rhs32x64`
在ISA4.0中，EF32等效于FP20，即1bit sign，8bit exponent，和12bit有效的mantissa。上述情况将FP32转换为EF32的过程规则如下：

- 当FP32为NaN时，转换后的EF32为固定NaN
  - 转换后EF32的sign为0，exponenent和mantissa为全1
- 当FP32为INF时，转换后的EF32为INF
- 当FP32为规格化数( canonicalized number)时，并且绝对值超出EF32规格化数( canonicalized number)最大可表示范围，则转换后 EF32结果绝对值为其规格化数最大可表示范围，并且保持相同符号
  - 即FP32->EF32过程有clamp操作
  - EF32最大规格化数值为(2^127 - 2^115)
- 当FP32为规格化数( canonicalized number)时，并且没有超过EF32规格化数( canonicalized number)最大可表示范围时，采用 rounding-to-nearest-even的舍入方式转换为EF32.

#### 8.8.1.8. Real Size Process

对于MLI_GEMM系列指令，左右输入操作数均定义了Real Size的SPR。由于是寄存器输入，容易出现各种非法场景的组合。对于各种场景， 预期的MLI_GEMM系列指令按照下列Step1~Step4顺序进行进行处理。

##### 8.8.1.8.1. Step1: Read SPR Real_Size

首先进行的是SPR寄存器的读取和预处理。对于左操作数，各个MLI_GEMM系列指令对于各个real size的读取方法如下：

- 本步骤的处理，是说明每个GEMM指令会读取哪些SPR寄存器

| step1输出的LHS real数值 | MLI_GEMM |
| --- | --- |
| LHS_DIM0_REAL输出(RHS_DIM1_REAL) | LHS_DIM0_REAL |
| LHS_DIM1_REAL0输出 | LHS_DIM1_REAL0 |
| LHS_DIM1_REAL1输出 | LHS_DIM1_REAL1 |
| LHS_DIM1_REAL2输出 | LHS_DIM1_REAL2 |

对于右操作数，如果是按行填充时（rhs_ldmode== 0)，各个GEMM指令对于各个real size的处理方法如下：

| step1输出的RHS real数值(按行) | MLI_GEMM |
| --- | --- |
| RHS_DIM0_REAL0输出 | 自动处理为0 |
| RHS_DIM0_REAL1输出 | RHS_DIM0_REAL1 |
| RHS_DIM0_REAL2输出 | RHS_DIM0_REAL1 |

对于右操作数，如果是按列填充时（rhs_ldmode == 1)，各个GEMM指令对于各个real size的处理方法如下：

| step1输出的RHS real数值(按列) | MLI_GEMM |
| --- | --- |
| RHS_DIM0_REAL0输出 | RHS_DIM0_REAL0 |
| RHS_DIM0_REAL1输出 | RHS_DIM0_REAL1 |
| RHS_DIM0_REAL2输出 | RHS_DIM0_REAL2 |

##### 8.8.1.8.2. Step2: Clamp to MAX Value

在本步骤中，对Step1的输出结果进行Clamp操作。在本Step中，我们定义LHS_DIM0_MAX，LHS_DIM1_MAX，RHS_DIM0_MAX， RHS_DIM1_MAX为该GEMM_MODE定义下的左右支水平和垂直方向的最大尺寸（单位为element）。

- 本步骤为确保即使异常没有触发，对于real size超过了GEMM MODE最大允许尺寸情况下，GEMM指令也可以获得执行

| step2输出的real数值 | MLI_GEMM |
| --- | --- |
| LHS_DIM0_REAL输出(RHS_DIM1_REAL) | min(LHS_DIM0_MAX, step1_output) |
| LHS_DIM1_REAL0输出 | min(LHS_DIM1_MAX, step1_output) |
| LHS_DIM1_REAL1输出 | min(LHS_DIM1_MAX, step1_output) |
| LHS_DIM1_REAL2输出 | min(LHS_DIM1_MAX, step1_output) |
| RHS_DIM0_REAL0输出 | min(RHS_DIM0_MAX, step1_output) |
| RHS_DIM0_REAL1输出 | min(RHS_DIM0_MAX, step1_output) |
| RHS_DIM0_REAL2输出 | min(RHS_DIM0_MAX, step1_output) |

##### 8.8.1.8.3. Step3: Exception Check

在本Step中，对Step1的输出进行检查，如果满足下列行中任一的条件（并且异常的enable bit打开）情况下即可触发异常。

注意：EXCP_REAL_SIZE 异常在ISA4.0中已经DeFeature

- 本步骤目的为明确real size触发异常的具体规则

| step3的异常检查 | GEMM |
| --- | --- |
| LHS_DIM0_REAL异常(RHS_DIM1_REAL) | step1_output > LHS_DIM0_MAX |
| LHS_DIM1_REAL0异常 | step1_output > LHS_DIM1_MAX |
| LHS_DIM1_REAL1异常 | step1_output > LHS_DIM1_MAX |
| LHS_DIM1_REAL2异常 | step1_output > LHS_DIM1_MAX |
| RHS_DIM0_REAL0异常 | step1_output > RHS_DIM0_MAX |
| RHS_DIM0_REAL1异常 | step1_output > RHS_DIM0_MAX |
| RHS_DIM0_REAL2异常 | step1_output > RHS_DIM0_MAX |

##### 8.8.1.8.4. Step4: Convert to NOP

在本Step中，对Step1的输出进行检查，如果满足下列行中任一条件即可转换为NOP

- 请注意，本步骤和Step3没有直接关联，而是处理各种未被定义为Exception的Real Size非法情况。指令转换为NOP和指令触发 Exception是正交的，有些场景可以同时并存Exception/转换为NOP，也可以只存在一种情况。
- 基本原则要求是REAL0 <= REAL1，REAL1 <= REAL2
- 注意：下面六种场景是合法的，不包含在下列表格当中
  - LHS_DIM1_REAL0.step1_output == LHS_DIM1_REAL1.step1_output == LHS_DIM1_REAL2.step1_output >0
    - 即左支操作数只有左padding的场景
  - LHS_DIM1_REAL0.step1_output == LHS_DIM1_REAL1.step1_output == 0， LHS_DIM1_REAL2.step1_output >0
    - 即左支操作数只有右padding的场景
  - LHS_DIM1_REAL0.step1_output == LHS_DIM1_REAL1.step1_output > 0， LHS_DIM1_REAL2.step1_output >LHS_DIM1_REAL1.step1_output
    - 即左支操作数同时有左右padding，但是不存在中间real部分的计算
  - RHS_DIM0_REAL0.step1_output == RHS_DIM0_REAL1.step1_output == RHS_DIM0_REAL2.step1_output > 0
    - 即右支操作数只有前padding的场景
  - RHS_DIM0_REAL0.step1_output == RHS_DIM0_REAL1.step1_output == 0， RHS_DIM0_REAL2.step1_output > 0
    - 即右支操作数只有后padding的场景
  - RHS_DIM0_REAL0.step1_output == RHS_DIM0_REAL1.step1_output > 0， RHS_DIM0_REAL2.step1_output > RHS_DIM0_REAL1.step1_output
    - 即右支操作数同时有前后padding，但是不存在中间real部分的计算

```text
step4 NOP检查  GEMM
条件一         LHS_DIM0_REAL.step1_output == 0
条件二         LHS_DIM1_REAL0.step1_output == 0 && LHS_DIM1_REAL1.step1_output == 0 &&LHS_DIM1_REAL2.step1_output == 0
条件三         RHS_DIM0_REAL0.step1_output == 0 && RHS_DIM0_REAL1.step1_output == 0 &&RHS_DIM0_REAL2.step1_output == 0
条件四         LHS_DIM1_REAL0.step1_output > LHS_DIM1_REAL1.step1_output
条件五         LHS_DIM1_REAL1.step1_output > LHS_DIM1_REAL2.step1_output
条件六         RHS_DIM0_REAL0.step1_output > RHS_DIM0_REAL1.step1_output
条件七         RHS_DIM0_REAL1.step1_output > RHS_DIM0_REAL2.step1_output
```

##### 8.8.1.8.5. Step4: Deal with LHS/RHS both Padding

如果real size操作数通过上面的所有检查，并且没有触发NOP条件，并且同时左操作数和右操作数均包含各自合法的Zero Padding场景，则指令只按照左操作数有Padding的场景处理，右操作数的Zero Padding被忽略。

### 8.8.2. MLI_GEMM (new in 4.0)

```text
Name      Combo Name    47--46    45--44      43--42    41    40          39--38  37--34     33--31       30--26  25--21  20--16  15--6     5--0
MLI_GEMM  MLI.MLI_GEMM  dacc_pos  dst_stride  acc_mode  nacc  rhs_ldmode  dtype   gemm_mode  lhs_row_max  Rs2     N/A     Rs1     OACCs3/d  opcode
```

```text
Name      Combo Name    Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MLI_GEMM  MLI.MLI_GEMM  MALU                                                    1
```

本指令是ISA4.0新增指令，为CISC指令，用于执行左右输入矩阵相乘并累加结果矩阵写回VACC。本指令的左右输入矩阵均源自memory。指令的主要功能详见GEMM Operation。对于INT32运算结果总是进行saturation。如果结果矩阵的dim0_real小于dim0_max，则水平的tail部分写回0。如果结果矩阵的dim1_real小于dim1_max，则这部分结果寄存器保持不变。

本指令的约束条件：

- 本指令固定和C-slot的MLI_HINT_GEMM一起打包，不能和其他任何指令打包
- 本指令对memory的访问，始终视为RO访问，即不坚持本指令地址和store指令之间的RAW/WAR hazard
- 本指令所在算子，禁止使用IV/VR/SMR寄存器。
  - 违反本条规则，执行结果不可测
- 本指令的rhs_ldmode域，必须和RHS_DIM0_STRIDE/RHS_DIM1_STRIDE对应
  - 违反本条规则，执行结果不可测
- 本指令的memory地址，需要和左右输入操作数的字节宽度对齐
  - 违反本条规则，出现地址非对齐exception
- 本指令的memory访问，遵守一般VLD类指令的address alignment和访问区域限制规则
  - 违反本条规则，出现相应的exception
- 本指令预期在单VPT下执行
- 对于Real Size SPR的处理，请见Real Size Process章节
部分域功能说明：

- `OACCs3/d`
  - VACCs3/d_index = VAB_VPT*+ {OACCs3/d + 3'b0} + dacc_pos * 2
  - OACCs3/d不能为0
- `dacc_pos`
  - 表示回写OACCs3/d时的VACC index偏移
  - 0 ： 对所有gemm mode有效
  - 1 ： 仅对rhs_dim0_max为32的gemm mode有效
  - 2 ： 仅对rhs_dim0_max为32或64的gemm mode有效 3 ： 仅对rhs_dim0_max为32的gemm mode有效
- `Rs1`
  - 作为GEMM运算左矩阵的起始地址
- `Rs2`
  - 作为GEMM运算右矩阵的起始地址
- `nacc`
  - 0：GEMM运算正常累加
  - 1：GEMM运算不累加，直接写回结果寄存器

```text
该寄存器数值会受到SPR寄存器NACCOVR的影响，并且永远是由累加操作被改写为非累加操作，即当NACC=0的时候，可能被 NACCOVR改写，但是NACC=1的时候，不会被改写。  NACC=0的时候，可能被
NACCOVR改写，但是NACC=1的时候，不会被改写。
```

- `gemm_mode`
  - 0x0：gemm.16b.rhs64x32
  - 0x1：gemm.16b.rhs32x64
  - 0x2：gemm.32b.rhs16x32
  - 0x3：gemm.8b.rhs64x64
  - 0x4：gemm.8bus.rhs64x64
  - 0x7：gemm.ef32vm.rhs32x64
  - 0x8：gemm.fp8b.rhs64x64
  - 0x9：gemm.fp8bx.rhs64x64
  - Others：Reserved
- `dtype`
  - 含义请见Common MALU Data Type
  - 0：UINT8，可用于所有8b模式
    - 对于8b.*模式，意味着左右操作数均为uint8
    - 对于8bus.*模式，意味着左操作数为uint8
  - 1：INT8，只用于gemm.8b.rhs64x64模式
    - 意味着左右操作数均为int8
  - 2：FP16/FP32/FP8 E4M3
    - 对于16b/32b/ef32vm的VMM模式，代表操作数为FP16/FP32/EF32
    - 对于fp8b.*模式，意味着左右操作数均为FP8_E4M3
    - 对于fp8bx.*模式，意味着左操作数为FP8_E4M3，右操作数为FP8_E5M2
  - 3：BF16/FP8 E5M2
    - 对于16b的VMM模式，代表操作数为BF16
    - 对于fp8b.*模式，意味着左右操作数均为FP8_E5M2
    - 对于fp8bx.*模式，意味着左操作数为FP8_E5M2，右操作数为FP8_E4M3
- `acc_mode`
  - nacc = 0
    - 0: output_matrix = output_matrix + input_matrix * input_matrix
    - 1: output_matrix = output_matrix - input_matrix * input_matrix，类似于VMAS
    - 2: output_matrix = - output_matrix + input_matrix * input_matrix，类似于IMAS
  - nacc = 1
    - 0: output_matrix = input_matrix * input_matrix
    - 1: output_matrix = - input_matrix * input_matrix
    - 2: output_matrix = input_matrix * input_matrix
  - 浮点格式支持acc_mode取值0/1/2；INT8/UINT8数据格式acc_mode只能选择0
- `lhs_row_max`
  - lhs_dim1_max=8 * (2^lhs_row_max);
  - 0: lhs_dim1_max = 8;
  - 1: lhs_dim1_max = 16;
  - 2: lhs_dim1_max = 32;
  - 3: lhs_dim1_max = 64;
  - 4: lhs_dim1_max = 128; 5: lhs_dim1_max = 256;
  - Others: Reserved
- `rhs_ldmode`
  - 0x0：输入右矩阵按行加载。此时RHS_DIM0_STRIDE必须为1
  - 0x1：输入右矩阵按列加载。此时RHS_DIM1_STRIDE必须为1
- `dst_stride`
  - 结果矩阵VACC的dim1_stride。
    - rhs_dim0_max为64的gemm mode可以选择4VACC或者8VACC
    - rhs_dim0_max为32的gemm mode可以选择2VACC或者4VACC或者8VACC
  - 0：dst_dim1_stride = 2 * VACC
  - 1：dst_dim1_stride = 4 * VACC
  - 2：dst_dim1_stride = 8 * VACC
  - Other：Reserved
Implicit Uses

- `NACCOVR`
- `MODE_WRK.denormal_flush`
- `MODE_WRK.rounding`
- `VAB_VPT0`
- `LHS_DIM0_REAL`
- `LHS_DIM1_REAL0`
- `LHS_DIM1_REAL1`
- `LHS_DIM1_REAL2`
- `LHS_DIM0_STRIDE`
- `LHS_DIM1_STRIDE`
- `RHS_DIM0_REAL0`
- `RHS_DIM0_REAL1`
- `RHS_DIM0_REAL2`
- `RHS_DIM1_REAL`
- `RHS_DIM0_STRIDE`
- `RHS_DIM1_STRIDE`

### 8.8.3. MOP serial (updated in 4.0)

ISA4.0的MOP系列指令，包含如下特性：

- MOP系列指令能够执行所有原来ISA3.2的MOP系列指令
- MOP系列指令包含对如下数据类型的支持：
  - `INT8/UINT8`
  - `INT16/UINT16`
  - `INT32/UINT32`
  - INT64/UINT64（ISA4.0新增数据类型）
  - FP8 E4M3/FP8 E5M2 (ISA4.0新增数据类型，仅MOP.CVT和MOP.FCLASS支持)
  - `FP16`
  - `BF16`
  - `FP32`
- 支持混精运算指令，包括混精乘法、混精加法和混精MAC指令
- 除了部分maskbit逻辑运算指令外，其他的运算指令均支持基于maskbit的条件写回
  - 强化maskbit产生指令和逻辑操作指令
- 指令中使用10bit OACC编码和10bitVACC编码
- 对于MOP系列指令，rounding规则如下：
  - 除了MOP.CVT外，其他浮点支持两种IEEE754舍入模式：rounding-to-nearest-even(RNE)和rounding-to-zero(RZ)
  - MOP.CVT所有模式均支持RNE和RZ
    - MOP.CVT浮点到整型的模式，额外支持IEEE754的向正无穷舍入和向负无穷舍入两种模式相当于浮点到整型支持IEEE754所有舍入模式
    - 额外支持两种舍入模式，是为了支持ceil和floor算子
  - 除了MOP.CVT外，其他浮点运算结果为MODE_WRK的rounding域决定舍入模式。
  - MOP.CVT指令使用自带的rounding域决定舍入模式
- 对于MOP系列指令，saturation规则如下
  - 对于精度不变并且结果为整型的element-wise指令，不做saturation
  - 所有整型结果的混精指令，始终做saturation
  - MOP.CVT指令对于整型结果始终做saturation
- 对于MOP系列指令，clamp规则如下
  - 所有运算结果为FP16/BF16的MOP系列指令，除了MOP.CVT外，其结果受到MODE_WRK中BF16_OVCLP和FP16_OVCLP影响
    - 对于浮点运算，OVCLP指运算结果超出最大可表示数值，而又不是直接的INF，那么结果就保持在正负最大可表示数值上， 忽略舍入模式将其舍入到INF的要求。这是推理场景下的FP16的需求
  - MOP.CVT指令使用指令编码对INT8/BF16/FP16进行clamp操作
    - INT8的clamp指在做saturation时，边界为-127—127，而非通常情况下的-128—127
- 对于MOP系列指令，加法/减法/乘法/平方/MSF等浮点算术运算指令的输入/输出受到MODE_WRK寄存器的denormal flush的影响
  - denormal fllush，指将输入的denormal数值和/或输出的denormal数值变为0。
  - 对于FP32/FP16/BF16，在MODE_WRK寄存器中各自有两个2bit，分别控制input denormal flush和output denormal flush
- 受到VL寄存器的影响
  - 如果VL不为0，则完整执行(包括tail部分)
  - 如果VL为0，则视为NOP指令
ISA4.0中MOP系列指令和ISA3.2相比的变化如下：

- 操作位宽为OACC粒度的指令，对应寄存器通过10bitOACC寻址，操作位宽为VACC粒度的指令，对应VACC寄存器通过10bitVACC索引。
- 对于精度变化指令：
  - 对于精度变宽指令：指令操作输入寄存器宽度为1个OACC，指令操作输出寄存器宽度为N个OACC，N取决于精度变化倍数。
  - 对于精度变窄指令：指令操作输入寄存器宽度为N个OACC，指令操作输出寄存器宽度为1个OACC，N取决于精度变化比例。
- 支持OACC颗粒度
  - OACC颗粒度的MOP系列指令。
- maskbit产生调整
  - 由于运算指令支持OACC颗粒度，maskbit最大支持到512bit
  - maskbit产生指令可以回写到VAB_VPT*起始的1K个VACC寄存器，而非ISA3.2中固定为4对齐的VACC寄存器
  - maskbit逻辑运算指令对整个VACC进行运算操作，而非ISA3.2中固定对256bit运算。
- 增加对VL的支持
  - 如果VL为全0，则指令转换为NOP。否则正常执行
- 所有非混精指令，增加了对INT64/UINT64的支持
  - INT64/UINT64总是使用OACC作为src或者dst
  - MOP.CVT指令增加了对UINT64/INT64<->UINT32/INT32支持
- 增加对FP8的支持
  - MOP.FCLASS指令增加支持FP8 E4M3和FP8 E5M2
  - MOP.CVT指令增加下列模式
    - FP32 <-> FP8 E4M3
    - FP32 <-> FP8 E5M2
    - FP16 <-> FP8 E4M3
    - FP16 <-> FP8 E5M2
    - BF16 -> FP8 E4M3
    - BF16 -> FP8 E5M2
- MOP.CVT加回对dst为整形的Rounding-up/Roudning-Down支持
- 调整了MOP.MAX/MOP.MIN指令语义
  - 在对浮点格式处理时，对于一个输入操作数为NaN另一个为非NaN时，输出调整为NaN
    - 这是由于IEEE754-2019标准对IEEE754-2008标准调整导致的。
    - 上述语义会在新增的MOP.MAXNUM/MOP.MINNUM中保留
- 增加下列MOP系列指令
  - MOP.ABSMAX，取绝对值后获得最大值指令
  - MOP.ABSMAXNUM，指令语义和MOP.ABSMAX类似，但是在一个输入操作数为NaN另一个输入操作数为非NaN时，输出和 MOP.ABSMAX不同
  - MOP.MAXNUM，指令语义和MOP.MAX类似，但是在一个输入操作数为NaN另一个输入操作数为非NaN时，输出和MOP.MAX不同
  - MOP.MINNUM，指令语义和MOP.MIN类似，但是在一个输入操作数为NaN另一个输入操作数为非NaN时，输出和MOP.MIN不同
  - MOP.SLRO，向量中每个元素向左循环移位指令，移位数值来自VA
  - MOP.SRRO，向量中每个元素向右循环移位指令，移位数值来自VA
  - MOP.SLROI，向量中每个元素向左循环移位指令，移位数值来自于立即数
  - MOP.SRROI，向量中每个元素向右循环移位指令，移位数值来自于立即数
  - MOP.MUL_SCL，一个标量浮点数广播并和向量中每个浮点数相乘
  - MOP.POPC，计算向量中每个元素的bit1的个数
  - MOP.CLZ，计算向量中每个元素的前导0个数
  - MOP.CLS，计算向量中每个元素的前导符号位个数
  - MOP.BREV，向量中每个元素的按bit位顺序颠倒排列
  - MOP.XOR_U32MIX，将64bit中取出32bit元素进行异或的混精指令
  - MOP.MUL_I64MIX，两个INT32相乘得到INT64；两个UINT32相乘得到UINT64
  - MOP.MUL_HI，两个INT32相乘得到INT64的高32bit；两个UINT32相乘得到UINT64的高32bit
  - MOP.BCAST，将OACCs1中某个datalane的数据复制到OACCd每个datalane中
  - MOP.SIGN，提取输入数据中的符号位指令
- 增加了下列maskbit操作指令
  - `MOP.MIOTA`
  - `MOP.SBF`
  - `MOP.SIF`
  - `MOP.SOF`

### 8.8.4. MOP.ADD (updated in 4.0)

```text
Name     Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.ADD  M.MOP.ADD   sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.ADD  M.MOP.ADD   MALU                                    1
```

**MOP.ADD:** OACCd[i] = OACCs1[i] + OACCs2[i];

指令功能为进行数据格式不变的加法操作。对于整型加法，如果发生溢出，则保留LSB部分，不做saturation。但是对于BF16/FP16结果，会根据MODE_WRK的FP16_OVCLP和BF16_OVCLP域进行clamp操作。

ISA4.0中针对该指令新增UINT64/INT64数据类型。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |

| Data type | dtype & dwidth input |
| --- | --- |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `MODE_WRK.rounding`
- `MODE_WRK.fp16_ovclp`
- `MODE_WRK.bf16_ovclp`
- `TCTL`
- `VL`

### 8.8.5. MOP.SUB (updated in 4.0)

```text
Name     Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.SUB  M.MOP.SUB   sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.SUB  M.MOP.SUB   MALU                                    1
```

**MOP.SUB:** OACCd[i] = OACCs1[i] - OACCs2[i];

指令功能为进行数据格式不变的减法操作。对于整型减法，如果发生溢出，则保留LSB部分，不做saturation。但是对于BF16/FP16结果，会根据MODE_WRK的FP16_OVCLP和BF16_OVCLP域进行clamp操作。

ISA4.0中针对该指令新增UINT64/INT64数据类型。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |

| Data type | dtype & dwidth input |
| --- | --- |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `MODE_WRK.rounding`
- `MODE_WRK.fp16_ovclp`
- `MODE_WRK.bf16_ovclp`
- `TCTL`
- `VL`

### 8.8.6. MOP.MUL (updated in 4.0)

```text
Name     Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.MUL  M.MOP.MUL   sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MUL  M.MOP.MUL   MALU                                    1
```

**MOP.MUL:** OACCd[i] = OACCs1[i] x OACCs2[i];

指令功能为进行数据格式不变的乘法操作。对于整型乘法，如果发生溢出，则保留LSB部分，不做saturation。但是对于BF16/FP16结果，会根据MODE_WRK的FP16_OVCLP和BF16_OVCLP域进行clamp操作。

ISA4.0中针对该指令新增UINT64/INT64数据类型。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |

| Data type | dtype & dwidth input |
| --- | --- |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `MODE_WRK.rounding`
- `MODE_WRK.fp16_ovclp`
- `MODE_WRK.bf16_ovclp`
- `TCTL`
- `VL`

### 8.8.7. MOP.MUL_HI (new in 4.0)

```text
Name        Combo Name    47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.MUL_HI  M.MOP.MUL_HI  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name        Combo Name    Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MUL_HI  M.MOP.MUL_HI  MALU                                    1
```

**MOP.MUL_HI:** OACCd[i] = HI_HALF(OACCs1[i] x OACCs2[i]);

ISA4.0新增指令，将两个整形数相乘，得到最终结果的高半部分。当Data type为INT32时，执行有符号乘法运算，输出为INT64结果的高 32bit；当Data type为UINT32时，执行无符号乘法运算，输出为UINT64结果的高32bit。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT32 | dtype == 0 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
    - OACCs2和OACCd不能相互覆盖
  - 如果vm=0，则OACCd不能为0

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.8. MOP.SQR (updated in 4.0)

```text
Name     Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.SQR  M.MOP.SQR   sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  N/A     OACCd  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.SQR  M.MOP.SQR   MALU                                    1
```

**MOP.SQR:** OACCd[i] = OACCs1[i]^2;

指令功能为进行数据格式不变的平方操作。对于整型平方运算，如果发生溢出，则保留LSB部分，不做saturation。但是对于BF16/FP16结果，会根据MODE_WRK的FP16_OVCLP和BF16_OVCLP域进行clamp操作。

ISA4.0中针对该指令新增UINT64/INT64数据类型。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |

| Data type | dtype & dwidth input |
| --- | --- |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `MODE_WRK.rounding`
- `MODE_WRK.fp16_ovclp`
- `MODE_WRK.bf16_ovclp`
- `TCTL`
- `VL`

### 8.8.9. MOP.SLL (updated in 4.0)

```text
Name     Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.SLL  M.MOP.SLL   sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.SLL  M.MOP.SLL   MALU                                    1
```

**MOP.SLL:** OACCd[i] = OACCs1[i] << OACCs2[i][dwidth+2:0];

ISA3.2新增指令，对OACC中的每个元素做逻辑左移。

ISA4.0中针对该指令新增OACC颗粒度支持以及UINT64数据类型。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.10. MOP.SRA (updated in 4.0)

```text
Name     Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.SRA  M.MOP.SRA   sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.SRA  M.MOP.SRA   MALU                                    1
```

**MOP.SRA:** OACCd[i] = OACCs1[i] >>> OACCs2[i][dwidth+2:0];

ISA3.2新增指令，对OACC中的每个元素做算术右移。

ISA4.0中针对该指令新增OACC颗粒度支持以及INT64数据类型。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| INT8 | dtype == 1 && dwidth == 0 |
| INT16 | dtype == 1 && dwidth == 1 |
| INT32 | dtype == 1 && dwidth == 2 |
| INT64 | dtype == 1 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.11. MOP.SRL (updated in 4.0)

```text
Name     Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.SRL  M.MOP.SRL   sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.SRL  M.MOP.SRL   MALU                                    1
```

**MOP.SRL:** OACCd[i] = OACCs1[i] >> OACCs2[i][dwidth+2:0];

ISA3.2新增指令，对OACC中的每个元素做逻辑右移。

ISA4.0中针对该指令新增UINT64数据类型。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.12. MOP.SLRO (new in 4.0)

```text
Name      Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.SLRO  M.MOP.SLRO  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.SLRO  M.MOP.SLRO  MALU                                    1
```

**MOP.SLRO:** {OACCd[i], useless} = {OACCs1[i], OACCs1[i]} << OACCs2[i][dwidth+2:0];

ISA4.0新增指令，对OACC中的每个元素做循环左移。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.13. MOP.SRRO (new in 4.0)

```text
Name      Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.SRRO  M.MOP.SRRO  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.SRRO  M.MOP.SRRO  MALU                                    1
```

**MOP.SRRO:** {useless, OACCd[i]} = {OACCs1[i], OACCs1[i]} >> OACCs2[i][dwidth+2:0];

ISA4.0新增指令，对OACC中的每个元素做循环右移。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变 vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.14. MOP.ABS (updated in 4.0)

```text
Name     Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.ABS  M.MOP.ABS   sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  N/A     OACCd  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.ABS  M.MOP.ABS   MALU                                    1
```

**MOP.ABS:** OACCd[i] = ABS(OACCs1[i]);

对输入数据取绝对值。对于有符号整型输入，本指令的处理结果视作无符号整型。因此对于INT8数值为-128的输入，结果是UINT8的128。 INT16、INT32、INT64依次类推。

ISA4.0中针对该指令新增UINT64/INT64数据类型。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0} OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `TCTL`
- `VL`

### 8.8.15. MOP.NEG (updated in 4.0)

```text
Name     Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.NEG  M.MOP.NEG   sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  N/A     OACCd  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.NEG  M.MOP.NEG   MALU                                    1
```

**MOP.NEG:** OACCd[i] = -OACCs1[i];

ISA3.2新增指令，对输入数值取相反数。只支持有符号输入。如果输入的是有符号整型绝对值最大的负数，返回相同数值。因此对于INT8数值为-128的输入，结果依然是-128。INT16、INT32依次类推。

ISA4.0中针对该指令新增INT64数据类型。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| INT8 | dtype == 1 && dwidth == 0 |
| INT16 | dtype == 1 && dwidth == 1 |
| INT32 | dtype == 1 && dwidth == 2 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `TCTL`
- `VL`

### 8.8.16. MOP.INV (updated in 4.0)

```text
Name     Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.INV  M.MOP.INV   sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  N/A     OACCd  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.INV  M.MOP.INV   MALU                                    1
```

**MOP.INV:** OACCd[i] = ~OACCs1[i];

对输入数据按bit取反。

ISA4.0中针对该指令新增UINT64数据类型。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.17. MOP.AND (updated in 4.0)

```text
Name     Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.AND  M.MOP.AND   sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.AND  M.MOP.AND   MALU                                    1
```

**MOP.AND:** OACCd[i] = (OACCs1[i] & OACCs2[i]);

对输入数据进行按位与操作。

ISA4.0中针对该指令新增UINT64数据类型。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.18. MOP.OR (updated in 4.0)

```text
Name    Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.OR  M.MOP.OR    sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name    Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.OR  M.MOP.OR    MALU                                    1
```

**MOP.OR:** OACCd[i] = (OACCs1[i] | OACCs2[i]);

对输入数据进行按位或操作。

ISA4.0中针对该指令新增UINT64数据类型。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.19. MOP.XOR (updated in 4.0)

```text
Name     Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.XOR  M.MOP.XOR   sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.XOR  M.MOP.XOR   MALU                                    1
```

**MOP.XOR:** OACCd[i] = (OACCs1[i] ^ OACCs2[i]);

对输入数据进行按位异或操作。

ISA4.0中针对该指令新增UINT64数据类型。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.20. MOP.MIN (updated in 4.0)

```text
Name     Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.MIN  M.MOP.MIN   sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MIN  M.MOP.MIN   MALU                                    1
```

**MOP.MIN:** OACCd[i] = min(OACCs1[i], OACCs2[i]);

取两个输入操作数的较小值。如果是浮点格式并且输入操作数中有NaN，则结果选择本ISA规定的标准NaN输出。请见NaN Result章节。

ISA4.0中针对该指令新增UINT64/INT64数据类型。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。另外对于有 NaN输入操作数时的输出做了调整。这一点是根据IEEE754-2019标准进行设置的。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `TCTL`
- `VL`

### 8.8.21. MOP.MAX (updated in 4.0)

```text
Name     Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.MAX  M.MOP.MAX   sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MAX  M.MOP.MAX   MALU                                    1
```

**MOP.MAX:** OACCd[i] = max(OACCs1[i], OACCs2[i]);

ISA3.2新增指令，取两个输入操作数的较大值。如果是浮点格式并且输入操作数中有NaN，则结果选择本ISA规定的标准NaN输出。请见NaN Result章节。

ISA4.0中针对该指令新增UINT64/INT64数据类型。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。另外对于有 NaN输入操作数时的输出做了调整。这一点是根据IEEE754-2019标准进行设置的。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `TCTL`
- `VL`

### 8.8.22. MOP.ABSMAX (new in 4.0)

```text
Name        Combo Name    47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.ABSMAX  M.MOP.ABSMAX  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name        Combo Name    Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.ABSMAX  M.MOP.ABSMAX  MALU                                    1
```

**MOP.ABSMAX:** OACCd[i] = max(abs(OACCs1[i]), abs(OACCs2[i]);

ISA4.0新增指令，对输入数先求绝对值，然后取两个输入操作数的较大值。如果是浮点格式并且输入操作数中有NaN，则结果选择本ISA规定的标准NaN输出。请见NaN Result章节。对于有符号整型输入，本指令ABS过程的处理结果视作无符号整型。因此对于INT8数值为-128的输入，其ABS的结果是UINT8的128。INT16、INT32、INT64依次类推。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `TCTL`
- `VL`

### 8.8.23. MOP.MINNUM (updated in 4.0)

```text
Name        Combo Name    47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.MINNUM  M.MOP.MINNUM  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name        Combo Name    Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MINNUM  M.MOP.MINNUM  MALU                                    1
```

**MOP.MINNUM:** OACCd[i] = minnum(OACCs1[i], OACCs2[i]);

ISA4.0新增指令。取两个输入操作数的较小值。如果输入为浮点格式并且操作数只有一个NaN，则结果选择非NaN数值。如果浮点格式并且两个都是NaN，则结果选择本ISA规定的标准NaN输出。请见NaN Result章节。本指令和MOP.MIN的区别在于输入操作数中只有一个NaN时的输出。这一点是根据IEEE754-2019标准进行设置的。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `TCTL`
- `VL`

### 8.8.24. MOP.MAXNUM (updated in 4.0)

```text
Name        Combo Name    47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.MAXNUM  M.MOP.MAXNUM  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name        Combo Name    Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MAXNUM  M.MOP.MAXNUM  MALU                                    1
```

**MOP.MAXNUM:** OACCd[i] = maxnum(OACCs1[i], OACCs2[i]);

ISA4.0新增指令。取两个输入操作数的较大值。如果输入为浮点格式并且操作数只有一个NaN，则结果选择非NaN数值。如果浮点格式并且

```text
两个都是NaN，则结果选择本ISA规定的标准NaN输出。请见NaN Result章节。本指令和MOP.MAX的区别在于输入操作数中只有一个NaN时的输出。这一点是根据IEEE754-2019标准进行设置的。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。  章节。本指令和MOP.MAX的区别在于输入操作数中只有一个NaN时

```

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `TCTL`
- `VL`

### 8.8.25. MOP.ABSMAXNUM (new in 4.0)

```text
Name           Combo Name       47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.ABSMAXNUM  M.MOP.ABSMAXNUM  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name           Combo Name       Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.ABSMAXNUM  M.MOP.ABSMAXNUM  MALU                                    1
```

**MOP.ABSMAXNUM:** OACCd[i] = maxnum(abs(OACCs1[i]), abs(OACCs2[i]);

ISA4.0新增指令，对输入先求绝对值，然后取两个输入操作数的较大值。如果是浮点格式并且只有有一个NaN，则结果选择非NaN数值。如果浮点格式并且两个都是NaN，则结果选择本ISA规定的标准NaN输出。请见NaN Result章节。

对于有符号整型输入，本指令ABS过程的处理结果视作无符号整型。因此对于INT8数值为-128的输入，其ABS的结果是UINT8的128。 INT16、INT32、INT64依次类推。

输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

本指令和MOP.ABSMAX的区别在于输入操作数中只有一个NaN时的输出。这一点是根据IEEE754-2019标准进行设置的。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `TCTL`
- `VL`

### 8.8.26. MOP.FUSE (updated in 4.0)

```text
Name      Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.FUSE  M.MOP.FUSE  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.FUSE  M.MOP.FUSE  MALU                                    1
```

**MOP.FUSE:** OACCd[i] = {OACCs2[i].sign, OACCs1[i].exp, OACCs2[i].mantissa);

输入浮点格式，取操作数1的exponent，和操作数2的sign以及mantissa，产生新的浮点数。本指令对于NaN输入不敏感，当作正常浮点数进行操作。

ISA4.0中指令操作位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.27. MOP.GETE (updated in 4.0)

```text
Name      Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.GETE  M.MOP.GETE  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  N/A     OACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.GETE  M.MOP.GETE  MALU                                    1
```

**MOP.GETE:** OACCd[i] = {‘b0, OACCs1[i].exp);

取输入的浮点数的exponent，做0扩展后写入目的操作数。对于FP32输入，写回数据格式为UINT32；对于FP16/BF16输入，写回数据格式为UINT16。本指令对于NaN输入不敏感，当作正常浮点数进行操作。

ISA4.0中输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.28. MOP.GETM (updated in 4.0)

```text
Name      Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.GETM  M.MOP.GETM  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  N/A     OACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.GETM  M.MOP.GETM  MALU                                    1
```

**MOP.GETM:** OACCd[i] = {OACCs1[i].sign, N'b0, OACCs1[1].recover_bit, OACCs1[i].mantissa);

取输入的浮点数的mantissa，做0扩展后写入目的操作数。对于FP32输入，写回数据格式为UINT32；对于FP16/BF16输入，写回数据格式为 UINT16。本指令对于NaN输入不敏感，当作正常浮点数进行操作。

ISA4.0中输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

- 对于FP32和BF16， N=7；
- 对于FP16，N=4
- Recover bit为隐藏的小数。对于0、denormal value、INF和NaN，recover bit为0。其余情况为1

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.29. MOP.CVT (updated in 4.0 )

```text
Name     Combo Name  47--44    43--42  41  40   39--36  35--26  25   24     23--16  15--6  5--2    1        0
MOP.CVT  M.MOP.CVT   sub-code  rnd     vm  LCE  N/A     OACCs1  N/A  clamp  mode    OACCd  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.CVT  M.MOP.CVT   MALU                                    1
```

**MOP.CVT:** OACCd[i] = cvt_mode(OACCs1[i]);

ISA3.2中新增指令。对整型、浮点等数据格式进行互相转换。本指令包含如下的特性：

- 支持浮点<->浮点、整型<->浮点的数据格式转换
- 不支持无符号整型和有符号整型之间的转换
- 对于位宽变化的格式转换，src/dst之间宽度比例包括1/4、1/2、宽度不变、宽度扩展2倍和宽度扩展4倍这几种
- 对于位宽变化的格式转换，支持自动在VA按照mapping要求进行交替/反交替
- 对于向整型格式转换，并且转换前数值超出了整型表达范围，则总是做saturation到最临近数值
  - 例如对于负数转无符号整型，其结果应当是0
  - 对于转向INT8的结果，还受到int8_clamp域影响
- 对于向浮点格式转换，并且转换前数值超出了结果格式的表达范围，则结果为INF还是max value由舍入方式和指令中的clamp域影响
- 对于浮点向整形格式转换，遇到NaN输入时，进行如下处理：
  - 如果目标格式为无符号整形，则结果的所有bit位都位1。即UINT8结果为0xFF，UINT16为0xFFFF，UINT32为0xFFFFFFFF
  - 如果目标格式为有符号整形，则结果为0。即INT8/INT16/INT32的结果都为0x0
ISA4.0新增OACC数据颗粒度支持以及新数据类型FP8/INT64/UINT64，针对上述数据类型，有以下特性：

- 操作位宽为OACC粒度，寄存器通过10bitOACC寻址
  - 对于精度变化指令：
    - 对于精度变宽指令：指令操作输入寄存器宽度为1个OACC，指令操作输出寄存器宽度为N个OACC，N取决于精度变化倍数。
    - 对于精度变窄指令：指令操作输入寄存器宽度为N个OACC，指令操作输出寄存器宽度为1个OACC，N取决于精度变化比例。
- 对于FP32/FP16/BF16向FP8格式转换，遇到NaN/Inf输入时有如下处理：
  - 如果目标格式为FP8_E4M3：当输入为NaN或Inf时，转换为FP8_E4M3的NaN值；
  - 如果目标格式为FP8_E5M2：当输入为NaN时，转换为FP8_E5M2的NaN值；当输入为Inf时，转换为FP8_E5M2的Inf值；
- 对于FP32/FP16/BF16向FP8格式转换，遇到数据范围超出FP8最大可表示数值时：
  - 如果目标格式为FP8_E4M3：当指令clamp域为1时，转换为最邻近的最大可表示数值；clamp域为0时，转换为NaN
  - 如果目标格式为FP8_E5M2：当指令clamp域为1时，转换为最邻近的最大可表示数值；clamp域为0时，转换对应的INF

**Field description:**

- `mode`
  - 指定进行CVT运算操作的类型

| mode | operation | 宽度变化 | 允许的src/dst VA数量 |
| --- | --- | --- | --- |
| 0x0 | FP16 to INT16 | 不变 | src: 1OA; dst: 1OA |
| 0x1 | FP32 to INT32 | 不变 | src: 1OA; dst: 1OA |
| 0x2 | BF16 to INT16 | 不变 | src: 1OA; dst: 1OA |
| 0x3 | FP16 to INT32 | 变宽2倍 | src: 1OA; dst:2OA |
| 0x4 | FP32 to INT16 | 变窄1/2 | src: 2OA; dst:1OA |
| 0x5 | BF16 to INT32 | 变宽2倍 | src: 1OA; dst:2OA |
| 0x6 | FP16 to INT8 | 变窄1/2 | src: 2OA; dst:1OA |
| 0x7 | BF16 to INT8 | 变窄1/2 | src: 2OA; dst:1OA |
| 0x8 | FP32 to INT8 | 变窄1/4 | src: 4OA; dst: 1OA |
| 0x9 | FP32 to UINT8 | 变窄1/4 | src: 4OA; dst: 1OA |
| 0x10 | UINT8 to FP16 | 变宽2倍 | src: 1OA; dst:2OA |
| 0x11 | INT8 to FP16 | 变宽2倍 | src: 1OA; dst:2OA |
| 0x12 | UINT8 to BF16 | 变宽2倍 | src: 1OA; dst:2OA |
| 0x13 | INT8 to BF16 | 变宽2倍 | src: 1OA; dst:2OA |
| 0x14 | UINT16 to FP32 | 变宽2倍 | src: 1OA; dst:2OA |
| 0x15 | INT16 to FP32 | 变宽2倍 | src: 1OA; dst:2OA |
| 0x16 | UINT32 to FP32 | 不变 | src: 1OA; dst: 1OA |
| 0x17 | INT32 to FP32 | 不变 | src: 1OA; dst: 1OA |
| 0x18 | UINT16 to FP16 | 不变 | src: 1OA; dst: 1OA |
| 0x19 | INT16 to FP16 | 不变 | src: 1OA; dst: 1OA |
| 0x1A | UINT16 to BF16 | 不变 | src: 1OA; dst: 1OA |
| 0x1B | INT16 to BF16 | 不变 | src: 1OA; dst: 1OA |
| 0x1C | UINT8 to FP32 | 变宽4倍 | src: 1OA; dst:4OA |
| 0x1D | INT8 to FP32 | 变宽4倍 | src: 1OA; dst:4OA |
| 0x20 | FP16 to FP32 | 变宽2倍 | src: 1OA; dst:2OA |
| 0x21 | FP32 to FP16 | 变窄1/2 | src: 2OA; dst:1OA |
| 0x22 | BF16 to FP32 | 变宽2倍 | src: 1OA; dst:2OA |
| 0x23 | FP32 to BF16 | 变窄1/2 | src: 2OA; dst:1OA |
| 0x30 | UINT32 to UINT16 | 变窄1/2 | src: 2OA; dst:1OA |
| 0x31 | INT32 to INT16 | 变窄1/2 | src: 2OA; dst:1OA |
| 0x32 | UINT16 to UINT8 | 变窄1/2 | src: 2OA; dst:1OA |
| 0x33 | INT16 to INT8 | 变窄1/2 | src: 2OA; dst:1OA |
| 0x34 | UINT16 to UINT32 | 变宽2倍 | src: 1OA; dst:2OA |
| 0x35 | INT16 to INT32 | 变宽2倍 | src: 1OA; dst:2OA |
| 0x36 | UINT8 to UINT16 | 变宽2倍 | src: 1OA; dst:2OA |
| 0x37 | INT8 to INT16 | 变宽2倍 | src: 1OA; dst:2OA |
| 0x40 | INT64 to FP32 | 变窄1/2 | src: 2OA; dst:1OA |
| 0x41 | INT64 to FP16 | 变窄1/4 | src: 4OA; dst: 1OA |
| 0x42 | FP16 to FP8_E4M3 | 变窄1/2 | src: 2OA; dst:1OA |
| 0x43 | FP16 to FP8_E5M2 | 变窄1/2 | src: 2OA; dst:1OA |
| 0x44 | FP32 to FP8_E4M3 | 变窄1/4 | src: 4OA; dst: 1OA |

| mode | operation | 宽度变化 | 允许的src/dst VA数量 |
| --- | --- | --- | --- |
| 0x45 | FP32 to FP8_E5M2 | 变窄1/4 | src: 4OA; dst: 1OA |
| 0x46 | FP8_E4M3 to FP16 | 变宽2倍 | src: 1OA; dst:2OA |
| 0x47 | FP8_E5M2 to FP16 | 变宽2倍 | src: 1OA; dst:2OA |
| 0x48 | FP8_E4M3 to FP32 | 变宽4倍 | src: 1OA; dst:4OA |
| 0x49 | FP8_E5M2 to FP32 | 变宽4倍 | src: 1OA; dst:4OA |
| 0x4A | BF16 to FP8_E4M3 | 变窄1/2 | src: 2OA; dst:1OA |
| 0x4B | BF16 to FP8_E5M2 | 变窄1/2 | src: 2OA; dst:1OA |
| 0x50 | UINT32 to UINT64 | 变宽2倍 | src: 1OA; dst:2OA |
| 0x51 | UINT64 to UINT32 | 变窄1/2 | src: 2OA; dst:1OA |
| 0x52 | INT32 to INT64 | 变宽2倍 | src: 1OA; dst:2OA |
| 0x53 | INT64 to INT32 | 变窄1/2 | src: 2OA; dst:1OA |
| Other | Reserved | N/A | N/A |

- `clamp`
  - 当CVT结果为int8(不包括uint8)、FP16、BF16、FP8_E4M3、FP8_E5M2时有效
  - 当CVT结果格式为int8，若clamp==1，则负数的saturation为-127；否则负数的saturation为-128
  - 当CVT结果为BF16/FP16，若clamp==1，并且原始数据(非INF)超出它们可表达范围时，clamp到正负最大可表达数值上，而非 ±INF
  - 当CVT结果为FP8_E4M3，若clamp==1，并且原始数据(非INF)超出它们可表达范围时，clamp到正负最大可表达数值上，而非 NaN
  - 当CVT结果为FP8_E5M2，若clamp==1，并且原始数据(非INF)超出它们可表达范围时，clamp到正负最大可表达数值上，而非 ±INF
  - 任何其他数据格式下均无效
- `vm`
  - vm = 0时，元素按条件写回。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- rnd:
  - 0: rounding-to-nearest even
  - 1: rounding-to-zero
  - 2: rounding-to-postive-infinity, A.K.A rounding-up, only for CVT FP-to-INT/FP-to-UINT
  - 3: rounding-to-negative-infinity, A.K.A rounding-down, only for CVT FP-to-INT/FP-to-UINT
  - 特别说明，模式2和模式3只有在浮点转整型时有效，其余转换格式下无效
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
  - 如果vm=0，则OACCd不能为0

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `TCTL`
- `VL`

### 8.8.30. MOP.SLLI (updated in 4.0)

```text
Name      Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25            24            23            22            21--16  15--6  5--2    1                   0
MOP.SLLI  M.MOP.SLLI  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  0(Const_0_5)  0(Const_0_4)  0(Const_0_3)  0(Const_0_2)  Imm6    OACCd  opcode  Const_0(Const_0_1)  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.SLLI  M.MOP.SLLI  MALU                                    1
```

**MOP.SLLI:** OACCd[i] = OACCs1[i] << uimm-6[dwidth+2:0];

对OACC中的每个元素做立即数逻辑左移。

ISA4.0中针对该指令新增UINT64数据类型。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.31. MOP.SRLI (updated in 4.0)

```text
Name      Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25            24            23            22            21--16  15--6  5--2    1                   0
MOP.SRLI  M.MOP.SRLI  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  0(Const_0_5)  0(Const_0_4)  0(Const_0_3)  0(Const_0_2)  Imm6    OACCd  opcode  Const_0(Const_0_1)  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.SRLI  M.MOP.SRLI  MALU                                    1
```

**MOP.SRLI:** OACCd[i] = OACCs1[i] >> uimm-6[dwidth+2:0];

对OACC中的每个元素做立即数逻辑右移。

ISA4.0中针对该指令新增UINT64数据类型。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.32. MOP.SRAI (updated in 4.0)

```text
Name      Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25            24            23            22            21--16  15--6  5--2    1                   0
MOP.SRAI  M.MOP.SRAI  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  0(Const_0_5)  0(Const_0_4)  0(Const_0_3)  0(Const_0_2)  Imm6    OACCd  opcode  Const_0(Const_0_1)  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.SRAI  M.MOP.SRAI  MALU                                    1
```

**MOP.SRAI:** OACCd[i] = OACCs1[i] >>> uimm-6[dwidth+2:0];

ISA3.2新增指令，对OACC中的每个元素做立即数算术右移。

ISA4.0中针对该指令新增UINT64数据类型。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| INT8 | dtype == 1 && dwidth == 0 |
| INT16 | dtype == 1 && dwidth == 1 |
| INT32 | dtype == 1 && dwidth == 2 |
| INT64 | dtype == 1 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.33. MOP.SLROI (new in 4.0)

```text
Name       Combo Name   47--44    43--42  41  40   39--38  37--36  35--26  25            24            23            22            21--16  15--6  5--2    1                   0
MOP.SLROI  M.MOP.SLROI  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  0(Const_0_5)  0(Const_0_4)  0(Const_0_3)  0(Const_0_2)  Imm6    OACCd  opcode  Const_0(Const_0_1)  MCE
```

```text
Name       Combo Name   Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.SLROI  M.MOP.SLROI  MALU                                    1
```

**MOP.SLROI:** {OACCd[i], useless} = {OACCs1[i], OACCs1[i]} << uimm-6[dwidth+2:0];

ISA4.0新增指令，对OACC中的每个元素做循环左移，移位参数来源于立即数。指令操作位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.34. MOP.SRROI (new in 4.0)

```text
Name       Combo Name   47--44    43--42  41  40   39--38  37--36  35--26  25            24            23            22            21--16  15--6  5--2    1                   0
MOP.SRROI  M.MOP.SRROI  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  0(Const_0_5)  0(Const_0_4)  0(Const_0_3)  0(Const_0_2)  Imm6    OACCd  opcode  Const_0(Const_0_1)  MCE
```

```text
Name       Combo Name   Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.SRROI  M.MOP.SRROI  MALU                                    1
```

**MOP.SRROI:** {useless, OACCd[i]} = {OACCs1[i], OACCs1[i]} >> uimm-6[dwidth+2:0];

ISA4.0新增指令，对OACC中的每个元素做循环右移，移位参数来源于立即数。指令操作位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.35. MOP.MERGE (updated in 4.0)

```text
Name       Combo Name   47--44    43--42  41  40   39--36  35--26  25--16  15--6  5--2    1        0
MOP.MERGE  M.MOP.MERGE  sub-code  dwidth  vm  LCE  N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name       Combo Name   Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MERGE  M.MOP.MERGE  MALU                                    1
```

**MOP.MERGE:** OACCd[i] = maskbit(i) ? OACCs1[i] : OACCs2[i];

ISA3.2新增指令，dst根据maskbit的条件选择src1或者src2。请注意本指令的vm必须始终为0，并且vm并不表示条件回写，而是作为src1、 src2选择用的输入。因此本指令总是完整回写OACC。

ISA4.0中指令新增64bit数据类型。输入输出向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- `dwidth`
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth组合为

| Data type | dwidth input |
| --- | --- |
| 8bit 数据 | dwidth == 0 |
| 16bit 数据 | dwidth == 1 |
| 32bit 数据 | dwidth == 2 |
| 64bit数据 | dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - 本指令域的vm必须为0，但是并不代表条件写回，而是代表maskbit作为输入用于选择src1/src2到dst去。
  - maskbit取值来自VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit。
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.36. MOP.CADD (updated in 4.0)

```text
Name      Combo Name  47--44    43--42  41   40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.CADD  M.MOP.CADD  sub-code  dwidth  N/A  LCE  dtype   N/A     OACCs1  OACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.CADD  M.MOP.CADD  MALU                                    1
```

**MOP.CADD:** VACCd[i:i] = carry(OACCs1[i] + OACCs2[i]);

对OACC的源操作数尝试加法，产生溢出flag并作为maskbit回写目的操作数。仅支持整型数据。由于指令支持VL，回写结果可能为 1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写0）。本指令不支持条件回写。

ISA4.0中针对该指令新增UINT64/INT64数据类型。指令输入寄存器位宽为OACC，输出maskbit寄存器位宽为VACC。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `OACCs1/OACCs2`
  - VACC*_index =VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
- `VACCd`
  - VACCd_index = VAB_VPT* + VACCd

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.37. MOP.CSUB (updated in 4.0)

```text
Name      Combo Name  47--44    43--42  41   40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.CSUB  M.MOP.CSUB  sub-code  dwidth  N/A  LCE  dtype   N/A     OACCs1  OACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.CSUB  M.MOP.CSUB  MALU                                    1
```

**MOP.CSUB:** VACCd[i:i] = carry(OACCs1[i] - OACCs2[i]);

对OACC的源操作数尝试减法，产生溢出flag并作为maskbit回写目的操作数。仅支持整型数据。由于指令支持VL，回写结果可能为 1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写0）。本指令不支持条件回写。

ISA4.0中针对该指令新增UINT64/INT64数据类型。指令输入寄存器位宽为OACC，输出maskbit寄存器位宽为VACC。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `OACCs1/OACCs2`
  - VACC*_index =VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
- `VACCd`
  - VACCd_index = VAB_VPT* + VACCd

**Implicit Use:**

- `VAB_VPT*`
- TCTL VL

### 8.8.38. MOP.CMUL (updated in 4.0)

```text
Name      Combo Name  47--44    43--42  41   40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.CMUL  M.MOP.CMUL  sub-code  dwidth  N/A  LCE  dtype   N/A     OACCs1  OACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.CMUL  M.MOP.CMUL  MALU                                    1
```

**MOP.CMUL:** VACCd[i:i] = carry(OACCs1[i] * OACCs2[i]);

对OACC的源操作数尝试乘法，产生溢出flag并作为maskbit回写目的操作数。仅支持整型数据。由于指令支持VL，回写结果可能为 1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写0）。本指令不支持条件回写。

ISA4.0中针对该指令新增UINT64/INT64数据类型。指令输入寄存器位宽为OACC，输出maskbit寄存器位宽为VACC。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `OACCs1/OACCs2`
  - VACC*_index =VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
- `VACCd`
  - VACCd_index = VAB_VPT* + VACCd

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.39. MOP.CSLL (updated in 4.0)

```text
Name      Combo Name  47--44    43--42  41   40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.CSLL  M.MOP.CSLL  sub-code  dwidth  N/A  LCE  dtype   N/A     OACCs1  OACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.CSLL  M.MOP.CSLL  MALU                                    1
```

**MOP.CSLL:** VACCd[i:i] = carry(OACCs1[i] << OACCs2[i][dwidth+2:0]);

对OACC的源操作数尝试逻辑左移，产生溢出flag并作为maskbit回写目的操作数。仅支持整型数据。由于指令支持VL，回写结果可能为 1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写0）。本指令不支持条件回写。

ISA4.0中针对该指令新增UINT64/INT64数据类型。指令输入寄存器位宽为OACC，输出maskbit寄存器位宽为VACC。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `OACCs1/OACCs2`
  - VACC*_index =VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
- `VACCd`
  - VACCd_index = VAB_VPT* + VACCd

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.40. MOP.CSLLI (updated in 4.0)

```text
Name       Combo Name   47--44    43--42  41   40   39--38  37--36  35--26  25            24            23            22            21--16  15--6  5--2    1                   0
MOP.CSLLI  M.MOP.CSLLI  sub-code  dwidth  N/A  LCE  dtype   N/A     OACCs1  0(Const_0_5)  0(Const_0_4)  0(Const_0_3)  0(Const_0_2)  Imm6    VACCd  opcode  Const_0(Const_0_1)  MCE
```

```text
Name       Combo Name   Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.CSLLI  M.MOP.CSLLI  MALU                                    1
```

**MOP.CSLLI:** VACCd[i:i] = carry(OACCs1[i] << uimm-6[dwidth+2:0]);

对OACC的源操作数尝试立即数逻辑左移，产生溢出flag并作为maskbit回写目的操作数。仅支持整型数据。由于指令支持VL，回写结果可能为1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写0）。本指令不支持条件回写。

ISA4.0中针对该指令新增UINT64/INT64数据类型。指令输入寄存器位宽为OACC，输出maskbit寄存器位宽为VACC。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |

| Data type | dtype & dwidth input |
| --- | --- |
| UINT16 | dtype == 0 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `OACCs1`
  - VACC*_index =VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
- `VACCd`
  - VACCd_index = VAB_VPT* + VACCd

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.41. MOP.MSEQ (updated in 4.0)

```text
Name      Combo Name  47--44    43--42  41   40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.MSEQ  M.MOP.MSEQ  sub-code  dwidth  N/A  LCE  dtype   N/A     OACCs1  OACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MSEQ  M.MOP.MSEQ  MALU                                    1
```

**MOP.MSEQ:** VACCd[i:i] = (OACCs1[i] == OACCs2[i]) ? 1:0

对OACC的源操作数根据条件进行比较。如果比较结果两个源操作数相等，则flag设“1”，否则设“0”；将flag作为maskbit写回VACCd。由于指令支持VL，回写结果可能为1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写0）。如果数据格式为浮点，并且源操作数存在 NaN，则结果总是为“0”。本指令不支持条件回写。

ISA4.0中针对该指令新增UINT64/INT64数据类型。指令输入寄存器位宽为OACC，输出maskbit寄存器位宽为VACC。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |

| Data type | dtype & dwidth input |
| --- | --- |
| Other: Reserved | Other: Reserved |

- `OACCs1/OACCs2`
  - VACC*_index =VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
- `VACCd`
  - VACCd_index = VAB_VPT* + VACCd

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `TCTL`
- `VL`

### 8.8.42. MOP.MSNE (updated in 4.0)

```text
Name      Combo Name  47--44    43--42  41   40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.MSNE  M.MOP.MSNE  sub-code  dwidth  N/A  LCE  dtype   N/A     OACCs1  OACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MSNE  M.MOP.MSNE  MALU                                    1
```

**MOP.MSNE:** VACCd[i:i] = (OACCs1[i] != OACCs2[i]) ? 1:0

ISA3.2新增指令，对OACC的源操作数根据条件进行比较。如果比较结果两个源操作数不相等，则flag设“1”，否则设“0”；将flag作为maskbit 写回VACCd。由于指令支持VL，回写结果可能为1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写0）。本指令不支持条件回写。

ISA4.0中针对该指令新增UINT64/INT64数据类型。指令输入寄存器位宽为OACC，输出maskbit寄存器位宽为VACC。如果数据格式为浮点， 并且源操作数存在NaN，则结果为“1”。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `OACCs1/OACCs2`
  - VACC*_index =VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
- `VACCd`
  - VACCd_index = VAB_VPT* + VACCd

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `TCTL`
- `VL`

### 8.8.43. MOP.MSLT (updated in 4.0)

```text
Name      Combo Name  47--44    43--42  41   40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.MSLT  M.MOP.MSLT  sub-code  dwidth  N/A  LCE  dtype   N/A     OACCs1  OACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MSLT  M.MOP.MSLT  MALU                                    1
```

**MOP.MSLT:** VACCd[i:i] = (OACCs1[i] < OACCs2[i]) ? 1:0

ISA3.2新增指令，对OACC的源操作数根据条件进行比较。如果比较结果为源操作数1小于源操作数2，则flag设“1”，否则设“0”；将flag作为 maskbit写回VACCd。由于指令支持VL，回写结果可能为1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写0）。如果数据格式为浮点，并且源操作数存在NaN，则结果总是为“0”。本指令不支持条件回写。

ISA4.0中针对该指令新增UINT64/INT64数据类型。指令输入寄存器位宽为OACC，输出maskbit寄存器位宽为VACC。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `OACCs1/OACCs2`
  - VACC*_index =VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
- `VACCd`
  - VACCd_index = VAB_VPT* + VACCd

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `TCTL`
- `VL`

### 8.8.44. MOP.MSLE (updated in 4.0)

```text
Name      Combo Name  47--44    43--42  41   40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.MSLE  M.MOP.MSLE  sub-code  dwidth  N/A  LCE  dtype   N/A     OACCs1  OACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MSLE  M.MOP.MSLE  MALU                                    1
```

**MOP.MSLE:** VACCd[i:i] = (OACCs1[i] <= OACCs2[i]) ? 1:0

ISA3.2新增指令，对OACC的源操作数根据条件进行比较。如果比较结果为源操作数1小于等于源操作数2，则flag设“1”，否则设“0”；将flag 作为maskbit写回VACCd。由于指令支持VL，回写结果可能为1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写0）。如果数据格式为浮点，并且源操作数存在NaN，则结果总是为“0”。

ISA4.0中针对该指令新增UINT64/INT64数据类型。指令输入寄存器位宽为OACC，输出maskbit寄存器位宽为VACC。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `OACCs1/OACCs2`
  - VACC*_index =VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
- `VACCd`
  - VACCd_index = VAB_VPT* + VACCd

**Implicit Use:**

- `VAB_VPT*`
- MODE_WRK.denormal_flush TCTL
- `VL`

### 8.8.45. MOP.MSGE (updated in 4.0)

```text
Name      Combo Name  47--44    43--42  41   40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.MSGE  M.MOP.MSGE  sub-code  dwidth  N/A  LCE  dtype   N/A     OACCs1  OACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MSGE  M.MOP.MSGE  MALU                                    1
```

**MOP.MSGE:** VACCd[i:i] = (OACCs1[i] >= OACCs2[i]) ? 1:0

ISA3.2新增指令，对OACC的源操作数根据条件进行比较。如果比较结果为源操作数1大于等于源操作数2，则flag设“1”，否则设“0”；将flag 作为maskbit写回VACCd。由于指令支持VL，回写结果可能为1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写0）。本指令仅支持浮点格式。如果源操作数存在NaN，则结果总是为“0”。

ISA4.0中针对该指令修改为10bit VACC域编码，新增OACC颗粒度支持。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `OACCs1/OACCs2`
  - VACC*_index =VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
- `VACCd`
  - VACCd_index = VAB_VPT* + VACCd

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `TCTL`
- `VL`

### 8.8.46. MOP.MSGT (updated in 4.0)

```text
Name      Combo Name  47--44    43--42  41   40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.MSGT  M.MOP.MSGT  sub-code  dwidth  N/A  LCE  dtype   N/A     OACCs1  OACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MSGT  M.MOP.MSGT  MALU                                    1
```

**MOP.MSGT:** VACCd[i:i] = (OACCs1[i] > OACCs2[i]) ? 1:0

ISA3.2新增指令，对OACC的源操作数根据条件进行比较。如果比较结果为源操作数1大于源操作数2，则flag设“1”，否则设“0”；将flag作为 maskbit写回VACCd。由于指令支持VL，回写结果可能为1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写0）。如果数据格式为浮点，并且源操作数存在NaN，则结果总是为“0”。

ISA4.0中针对该指令修改为10bit VACC域编码，新增OACC颗粒度支持。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `OACCs1/OACCs2`
  - VACC*_index =VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
- `VACCd`
  - VACCd_index = VAB_VPT* + VACCd

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `TCTL`
- `VL`

### 8.8.47. MOP.MAND (updated in 4.0)

```text
Name      Combo Name  47--44    43--41  40   39--36  35--26  25--16  15--6  5--2    1        0
MOP.MAND  M.MOP.MAND  sub-code  N/A     LCE  N/A     VACCs1  VACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MAND  M.MOP.MAND  MALU                                    1
```

**MOP.MAND:** VACCd[i:i] = (VACCs1[i:i] & VACCs2[i:i]);

maskbit逻辑运算指令。由于指令支持VL，回写结果可能为1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写0）。ISA4.0中针对该指令修改为10bit VACC域编码，并且固定运算整个VACC。

**Field description:**

- `VACCs1/VACCs2`
  - VACC*_index = VACC* + VAB_VPT*;
- `VACCd`
  - VACCd_index = VACCd + VAB_VPT*;

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.48. MOP.MOR (updated in 4.0)

```text
Name     Combo Name  47--44    43--41  40   39--36  35--26  25--16  15--6  5--2    1        0
MOP.MOR  M.MOP.MOR   sub-code  N/A     LCE  N/A     VACCs1  VACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MOR  M.MOP.MOR   MALU                                    1
```

**MOP.MOR:** VACCd[i:i] = (VACCs1[i:i] | VACCs2[i:i]);

ISA3.2新增指令。maskbit逻辑运算指令。由于指令支持VL，回写结果可能为1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写 0）。ISA4.0中针对该指令修改为10bit VACC域编码，并且固定运算整个VACC。

**Field description:**

- `VACCs1/VACCs2`
  - VACC*_index = VACC* + VAB_VPT*;
- `VACCd`
  - VACCd_index = VACCd + VAB_VPT*;

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.49. MOP.MXOR (updated in 4.0)

```text
Name      Combo Name  47--44    43--41  40   39--36  35--26  25--16  15--6  5--2    1        0
MOP.MXOR  M.MOP.MXOR  sub-code  N/A     LCE  N/A     VACCs1  VACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MXOR  M.MOP.MXOR  MALU                                    1
```

**MOP.MXOR:** VACCd[i:i] = (VACCs1[i:i] ^ VACCs2[i:i]);

ISA3.2新增指令。maskbit逻辑运算指令。由于指令支持VL，回写结果可能为1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写 0）。ISA4.0中针对该指令修改为10bit VACC域编码，并且固定运算整个VACC。

**Field description:**

- `VACCs1/VACCs2`
  - VACC*_index = VACC* + VAB_VPT*;
- `VACCd`
  - VACCd_index = VACCd + VAB_VPT*;

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.50. MOP.MANDN (updated in 4.0)

```text
Name       Combo Name   47--44    43--41  40   39--36  35--26  25--16  15--6  5--2    1        0
MOP.MANDN  M.MOP.MANDN  sub-code  N/A     LCE  N/A     VACCs1  VACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name       Combo Name   Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MANDN  M.MOP.MANDN  MALU                                    1
```

**MOP.MANDN:** VACCd[i:i] = (VACCs1[i:i] & ~VACCs2[i:i]);

ISA3.2新增指令。maskbit逻辑运算指令。由于指令支持VL，回写结果可能为1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写 0）。ISA4.0中针对该指令修改为10bit VACC域编码，并且固定运算整个VACC。

**Field description:**

- `VACCs1/VACCs2`
  - VACC*_index = VACC* + VAB_VPT*;
- `VACCd`
  - VACCd_index = VACCd + VAB_VPT*;

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.51. MOP.MORN (updated in 4.0)

```text
Name      Combo Name  47--44    43--41  40   39--36  35--26  25--16  15--6  5--2    1        0
MOP.MORN  M.MOP.MORN  sub-code  N/A     LCE  N/A     VACCs1  VACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MORN  M.MOP.MORN  MALU                                    1
```

**MOP.MORN:** VACCd[i:i] = (VACCs1[i:i] | ~VACCs2[i:i]);

ISA3.2新增指令。maskbit逻辑运算指令。由于指令支持VL，回写结果可能为1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写 0）。ISA4.0中针对该指令修改为10bit VACC域编码，并且固定运算整个VACC。

**Field description:**

- `VACCs1/VACCs2`
  - VACC*_index = VACC* + VAB_VPT*;
- `VACCd`
  - VACCd_index = VACCd + VAB_VPT*;

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.52. MOP.MNAND (updated in 4.0)

```text
Name       Combo Name   47--44    43--41  40   39--36  35--26  25--16  15--6  5--2    1        0
MOP.MNAND  M.MOP.MNAND  sub-code  N/A     LCE  N/A     VACCs1  VACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name       Combo Name   Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MNAND  M.MOP.MNAND  MALU                                    1
```

**MOP.MNAND:** VACCd[i:i] = ~(VACCs1[i:i] & VACCs2[i:i]);

ISA3.2新增指令。maskbit逻辑运算指令。由于指令支持VL，回写结果可能为1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写 0）。ISA4.0中针对该指令修改为10bit VACC域编码，并且固定运算整个VACC。

**Field description:**

- `VACCs1/VACCs2`
  - VACC*_index = VACC* + VAB_VPT*;
- `VACCd`
  - VACCd_index = VACCd + VAB_VPT*;

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.53. MOP.MNOR (updated in 4.0)

```text
Name      Combo Name  47--44    43--41  40   39--36  35--26  25--16  15--6  5--2    1        0
MOP.MNOR  M.MOP.MNOR  sub-code  N/A     LCE  N/A     VACCs1  VACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MNOR  M.MOP.MNOR  MALU                                    1
```

**MOP.MNOR:** VACCd[i:i] = ~(VACCs1[i:i] | VACCs2[i:i]);

ISA3.2新增指令。maskbit逻辑运算指令。由于指令支持VL，回写结果可能为1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写 0）。ISA4.0中针对该指令修改为10bit VACC域编码，并且固定运算整个VACC。

**Field description:**

- `VACCs1/VACCs2`
  - VACC*_index = VACC* + VAB_VPT*;
- `VACCd`
  - VACCd_index = VACCd + VAB_VPT*;

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.54. MOP.MXNOR (updated in 4.0)

```text
Name       Combo Name   47--44    43--41  40   39--36  35--26  25--16  15--6  5--2    1        0
MOP.MXNOR  M.MOP.MXNOR  sub-code  N/A     LCE  N/A     VACCs1  VACCs2  VACCd  opcode  Const_0  MCE
```

```text
Name       Combo Name   Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MXNOR  M.MOP.MXNOR  MALU                                    1
```

**MOP.MXNOR:** VACCd[i:i] = ~(VACCs1[i:i] ^ VACCs2[i:i]);

maskbit逻辑运算指令。由于指令支持VL，回写结果可能为1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写0）。ISA4.0中针对该指令修改为10bit VACC域编码，并且固定运算整个VACC。

**Field description:**

- `VACCs1/VACCs2`
  - VACC*_index = VACC* + VAB_VPT*;
- `VACCd`
  - VACCd_index = VACCd + VAB_VPT*;

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.55. MOP.MSBF (new in 4.0)

```text
Name      Combo Name  47--44    43--42  41  40   39--36  35--26  25--16  15--6  5--2    1        0
MOP.MSBF  M.MOP.MSBF  sub-code  dwidth  vm  LCE  N/A     VACCs1  N/A     VACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MSBF  M.MOP.MSBF  MALU                                    1
```

MOP.MSBF VACCd, VACCs1

ISA4.0新增指令。指令输入寄存器VACCs1为Maskbit寄存器，输出寄存器VACCd也为Maskbit寄存器，同时指令支持条件回写，即受到隐式寄存器vm的影响。指令操作向量寄存器位宽固定为VACC，指令编码中通过10bitVACC域寻址。由于指令支持VL，回写结果可能为 1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写0）。

当vm=1时：指令从逻辑Index最低位开始搜索maskbit寄存器VACCs1中，找到第一个VACCs1[i]==1的元素，将VACCd中逻辑Index小于i位置的元素置为1，逻辑Index大于等于i位置的元素置为0。如果没有VACCs1[i]==1的元素，则将VACCd中各元素均置1。

当vm=0时:指令从逻辑Index最低位开始搜索maskbit寄存器VACCs1中，找到第一个VACCs1[i] == 1 且 mask[i] == 1的元素，则将mask[i] == 1对应的VACCd[i]各元素进行回写：逻辑Index小于i位置的元素置为1，逻辑Index大于等于i位置的元素置为0。如果没有VACCs1[i] == 1 且 mask[i] == 1的元素，则将mask[i] == 1对应的VACCd[i]各元素置1。

```text
for i = 0...VPT_NUM-1 {
    VACC[i][VACCd_index] = 0;
    int mask_width = 2^(9 - dwidth);
    int elem_nums = min(mask_width,VL);
    int index = mask_width;
    bits(mask_width) mask_src;
    bits(mask_width) mask_vm;
    bits(mask_width) mask_dst;
    //从VACC中，maskbit逻辑0开始，获取长度为2^(9-dwidth)的bit长度
    //get_maskbit 与 set_maskbit用于表示maskbit在VACC中的物理排布与逻辑index的转换
    mask_src[mask_width-1:0] = get_maskbit(VACC[i][VACCs1_index], 0, mask_width-1);
    mask_vm[mask_width-1:0] = get_maskbit(VACC[i][0], 0, mask_width-1);
    mask_dst[mask_width-1:0] = get_maskbit(VACC[i][VACCd_index], 0, mask_width-1);
    for (int e = 0; e < elem_nums; e++) {
        if (vm == 1 || (vm == 0 && mask_vm[e] == 1)) {
            if (mask_src[e] == 1){
                index = e;
                break;
            }
        }
    }
    for (int e = 0; e < elem_nums; e++) {
        if (e < index || index == mask_width) {
            if (vm == 1 || (vm == 0 && mask_vm[e] == 1)) {
                mask_dst[e] = 1;
            }
        } else {
            if (vm == 1 || (vm == 0 && mask_vm[e] == 1)) {
                mask_dst[e] = 0;
            }
        }
    }
    //set_maskbit用于表示映射成maskbit在VACC的物理排布
    VACC[i][VACCd_index][elem_nums-1:0] = set_maskbit(mask_dst[elem_nums-1:0]);
    VACC[i][VACCd_index][511:elem_nums] = 0;
}
```

**Field description:**

- `VACCs1/VACCd`
  - VACCs1_index = VACCs1 + VAB_VPT*;
  - VACCd_index = VACCd + VAB_VPT*;
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
  - 如果vm=0，则OACCd不能为0
- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件：当mask[i] = 1时写回，否则VACCd对应位置保持不变。VACCd中[(64* (2^(3-dwidth))):511]bit位回写为0。
  - vm = 1时，非条件写回
- `dwidth`
  - 根据数据位宽选择VACC中maskbit的bit数。请注意这里是maskbit的逻辑bit位置
  - dwidth=0 ：8bit格式OACC对应的maskbit，选择maskbit[511:0]
  - dwidth=1 ：16bit格式OACC对应的maskbit，选择maskbit[255:0]
  - dwidth=2 ：32bit格式OACC对应的maskbit，选择maskbit[127:0]
  - dwidth=3 ：64bit格式OACC对应的maskbit，选择maskbit[64:0]

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.56. MOP.MSIF (new in 4.0)

```text
Name      Combo Name  47--44    43--42  41  40   39--36  35--26  25--16  15--6  5--2    1        0
MOP.MSIF  M.MOP.MSIF  sub-code  dwidth  vm  LCE  N/A     VACCs1  N/A     VACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MSIF  M.MOP.MSIF  MALU                                    1
```

MOP.MSIF VACCd, VACCs1

ISA4.0新增指令。指令输入寄存器VACCs1为Maskbit寄存器，输出寄存器VACCd也为Maskbit寄存器，同时指令支持条件回写，即受到隐式寄存器vm的影响。指令操作向量寄存器位宽固定为VACC，指令编码中通过10bitVACC域寻址。由于指令支持VL，回写结果可能为 1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写0）。

当vm=1时：指令从逻辑Index最低位开始搜索maskbit寄存器VACCs1中，找到第一个VACCs1[i]==1的元素，将VACCd中逻辑Index小于等于i 位置的元素置为1，逻辑Index大于i位置的元素置为0。如果没有VACCs1[i]==1的元素，则将VACCd中各元素均置1。

当vm=0时:指令从逻辑Index最低位开始搜索maskbit寄存器VACCs1中，找到第一个VACCs1[i] == 1 且 mask[i] == 1的元素，则将mask[i] == 1对应的VACCd[i]各元素进行回写：逻辑Index小于等于i位置的元素置为1，逻辑Index大于i位置的元素置为0。如果没有VACCs1[i] == 1 且 mask[i] == 1的元素，则将mask[i] == 1对应的VACCd[i]各元素置1。

```text
for i = 0...VPT_NUM-1 {
    VACC[i][VACCd_index] = 0;
    int mask_width = 2^(9 - dwidth);
    int elem_nums = min(mask_width,VL);
    int index = mask_width;
    bits(mask_width) mask_src;
    bits(mask_width) mask_vm;
    bits(mask_width) mask_dst;
    //从VACC中，maskbit逻辑0开始，获取长度为2^(9-dwidth)的bit长度
    //get_maskbit 与 set_maskbit用于表示maskbit在VACC中的物理排布与逻辑index的转换
    mask_src[mask_width-1:0] = get_maskbit(VACC[i][VACCs1_index], 0, mask_width-1);
    mask_vm[mask_width-1:0] = get_maskbit(VACC[i][0], 0, mask_width-1);
    mask_dst[mask_width-1:0] = get_maskbit(VACC[i][VACCd_index], 0, mask_width-1);
    for (int e = 0; e < elem_nums; e++) {
        if (vm == 1 || (vm == 0 && mask_vm[e] == 1)) {
            if (mask_src[e] == 1){
                index = e;
                break;
            }
        }
    }
    for (int e = 0; e < elem_nums; e++) {
        if (e <= index || index == mask_width) {
            if (vm == 1 || (vm == 0 && mask_vm[e] == 1)) {
                mask_dst[e] = 1;
            }
        } else {
            if (vm == 1 || (vm == 0 && mask_vm[e] == 1)) {
                mask_dst[e] = 0;
            }
        }
    }
    //set_maskbit用于表示映射成maskbit在VACC的物理排布
    VACC[i][VACCd_index][elem_nums-1:0] = set_maskbit(mask_dst[elem_nums-1:0]);
    VACC[i][VACCd_index][511:elem_nums] = 0;
}
```

**Field description:**

- `VACCs1/VACCd`
  - VACCs1_index = VACCs1 + VAB_VPT*; VACCd_index = VACCd + VAB_VPT*;
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
  - 如果vm=0，则OACCd不能为0
- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件：当mask[i] = 1时写回，否则VACCd对应位置保持不变。VACCd中[(64* (2^(3-dwidth))):511]bit位回写为0。
  - vm = 1时，非条件写回
- `dwidth`
  - 根据数据位宽选择VACC中maskbit的bit数。请注意这里是maskbit的逻辑bit位置
  - dwidth=0 ：8bit格式OACC对应的maskbit，选择maskbit[511:0]
  - dwidth=1 ：16bit格式OACC对应的maskbit，选择maskbit[255:0]
  - dwidth=2 ：32bit格式OACC对应的maskbit，选择maskbit[127:0]
  - dwidth=3 ：64bit格式OACC对应的maskbit，选择maskbit[64:0]

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.57. MOP.MSOF (new in 4.0)

```text
Name      Combo Name  47--44    43--42  41  40   39--36  35--26  25--16  15--6  5--2    1        0
MOP.MSOF  M.MOP.MSOF  sub-code  dwidth  vm  LCE  N/A     VACCs1  N/A     VACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MSOF  M.MOP.MSOF  MALU                                    1
```

MOP.MSOF VACCd, VACCs1

ISA4.0新增指令。指令输入寄存器VACCs1为Maskbit寄存器，输出寄存器VACCd也为Maskbit寄存器，同时指令支持条件回写，即受到隐式寄存器vm的影响。指令操作向量寄存器位宽固定为VACC，指令编码中通过10bitVACC域寻址。由于指令支持VL，回写结果可能为 1~512bit，而VACCd中剩下的bit全部写0（即vl tail部分也回写0）。

当vm=1时：指令从逻辑Index最低位开始搜索maskbit寄存器VACCs1中，找到第一个VACCs1[i]==1的元素，将VACCd中逻辑Index等于i位置的元素置为1，逻辑Index大于或小于i位置的元素置为0。如果没有VACCs1[i]==1的元素，则将VACCd中各元素均置1。

当vm=0时:指令从逻辑Index最低位开始搜索maskbit寄存器VACCs1中，找到第一个VACCs1[i] == 1 且 mask[i] == 1的元素，则将mask[i] == 1对应的VACCd[i]各元素进行回写：逻辑Index等于i位置的元素置为1，逻辑Index大于或小于i位置的元素置为0。如果没有VACCs1[i] == 1 且 mask[i] == 1的元素，则将mask[i] == 1对应的VACCd[i]各元素置1。

```text
for i = 0...VPT_NUM-1 {
    VACC[i][VACCd_index] = 0;
    int mask_width = 2^(9 - dwidth);
    int elem_nums = min(mask_width,VL);
    int index = mask_width;
    bits(mask_width) mask_src;
    bits(mask_width) mask_vm;
    bits(mask_width) mask_dst;
    //从VACC中，maskbit逻辑0开始，获取长度为2^(9-dwidth)的bit长度
    //get_maskbit 与 set_maskbit用于表示maskbit在VACC中的物理排布与逻辑index的转换
    mask_src[mask_width-1:0] = get_maskbit(VACC[i][VACCs1_index], 0, mask_width-1);
    mask_vm[mask_width-1:0] = get_maskbit(VACC[i][0], 0, mask_width-1);
    mask_dst[mask_width-1:0] = get_maskbit(VACC[i][VACCd_index], 0, mask_width-1);
    for (int e = 0; e < elem_nums; e++) {
        if (vm == 1 || (vm == 0 && mask_vm[e] == 1)) {
            if (mask_src[e] == 1){
                index = e;
                break;
            }
        }
    }
    for (int e = 0; e < elem_nums; e++) {
        if (e == index || index == mask_width) {
            if (vm == 1 || (vm == 0 && mask_vm[e] == 1)) {
                mask_dst[e] = 1;
            }
        } else {
            if (vm == 1 || (vm == 0 && mask_vm[e] == 1)) {
                mask_dst[e] = 0;
            }
        }
    }
    //set_maskbit用于表示映射成maskbit在VACC的物理排布
    VACC[i][VACCd_index][elem_nums-1:0] = set_maskbit(mask_dst[elem_nums-1:0]);
    VACC[i][VACCd_index][511:elem_nums] = 0;
}
```

**Field description:**

- `VACCs1/VACCd`
  - VACCs1_index = VACCs1 + VAB_VPT*;
  - VACCd_index = VACCd + VAB_VPT*;
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
  - 如果vm=0，则OACCd不能为0
- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件：当mask[i] = 1时写回，否则VACCd对应位置保持不变。VACCd中[(64* (2^(3-dwidth))):511]bit位回写为0。
  - vm = 1时，非条件写回
- `dwidth`
  - 根据数据位宽选择VACC中maskbit的bit数。请注意这里是maskbit的逻辑bit位置
  - dwidth=0 ：8bit格式OACC对应的maskbit，选择maskbit[511:0]
  - dwidth=1 ：16bit格式OACC对应的maskbit，选择maskbit[255:0]
  - dwidth=2 ：32bit格式OACC对应的maskbit，选择maskbit[127:0]
  - dwidth=3 ：64bit格式OACC对应的maskbit，选择maskbit[64:0]

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.58. MOP.MIOTA (new in 4.0)

```text
Name       Combo Name   47--44    43--42  41  40   39--36  35--26  25--16  15--6  5--2    1        0
MOP.MIOTA  M.MOP.MIOTA  sub-code  dwidth  vm  LCE  N/A     VACCs1  N/A     OACCd  opcode  Const_0  MCE
```

```text
Name       Combo Name   Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MIOTA  M.MOP.MIOTA  MALU                                    1
```

MOP.MIOTA OACCd, VACCs1

ISA4.0新增指令。指令输入寄存器VACCs1为Maskbit寄存器，输出寄存器OACCd为通用寄存器，同时指令支持条件回写，即受到隐式寄存器 vm的影响。

当vm=1时：指令从逻辑Index最低位开始遍历maskbit寄存器VACCs1中，对VACCd[i]各元素进行回写，回写值为VACCs1中，逻辑index小于 i的元素之和，回写值为32bit有符号整数（根据指令语义，回写值是正整数），即回写OACCd的元素宽度为32bit。

当vm=0时：指令从逻辑Index最低位开始搜索maskbit寄存器VACCs1中，对mask[i] == 1对应的VACCd[i]各元素进行回写，回写值为 VACCs1中，逻辑index小于i且mask[i] == 1的元素之和，回写值为32bit有符号整数（根据指令语义，回写值是正整数），即回写OACCd的元素宽度为32bit。

```text
int va_length;  // 512-bit
int data_width;  // in {8,16,32,64}
int va_nums;   //  in {1,2,4,8}
int elem_nums = min(va_length * va_nums / data_width,VL);
int sum = 0;
for (int i = 0; i < elem_nums; i++) {
    if (vm == 1 || (vm == 0 && maskbit(i) == 1)) {
        VACC[VPT*][VACCd + VAB_VPT*][i] = sum;
        sum = sum + VACC[VPT*][VACCs1 + VAB_VPT*][i];
    }
}
```

**Field description:**

- `VACCs1`
  - VACCs1_index = VACCs1 + VAB_VPT*;
- `OACCd`
  - VACCd_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACCd_index = VACCd_index >> 3
    - 源操作数和目的操作数不能互相覆盖
      - OACCs1和OACCd不能互相覆盖
    - 如果vm=0，则OACCd不能为0
- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `dwidth`
  - 合法配置如下

| dwidth | Mean | VACCs bit | VACCd 尺寸 |
| --- | --- | --- | --- |
| dwidth = 0x0 | 积分1个OACC中8bit元素的maskbit | maskbit[511:0] | 4OACC |
| dwidth = 0x1 | 积分1个OACC中16bit元素的maskbit | maskbit[255:0] | 2OACC |
| dwidth = 0x2 | 积分1个OACC中32bit元素的maskbit | maskbit[127:0] | 1OACC |
| dwidth = 0x3 | 积分1个OACC中64bit元素的maskbit | maskbit[63:0] | QACC |

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.59. MOP.MUL_SCL (new in 4.0)

```text
Name         Combo Name     47--44    43--42  41  40   39--38  37--36  35--26  25--21  20--16  15--6  5--2    1        0
MOP.MUL_SCL  M.MOP.MUL_SCL  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  N/A     Rs1     OACCd  opcode  Const_0  MCE
```

```text
Name         Combo Name     Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MUL_SCL  M.MOP.MUL_SCL  MALU                                    1
```

**MOP.MUL_SCL:** OACCd[i] = (OACCs1[i] * SR[FRs1]);

ISA4.0新增指令。一个来自Scalar寄存器的数值被视作浮点数，然后乘以OACC寄存器的浮点数。对于BF16/FP16结果，会根据MODE_WRK 的FP16_OVCLP和BF16_OVCLP域进行clamp操作。指令操作向量寄存器位宽固定为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | Rs1输入操作数 |
| --- | --- | --- |
| FP16 | dtype == 2 && dwidth == 1 | SR[15:0] |
| BF16 | dtype == 3 && dwidth == 1 | SR[15:0] |
| FP32 | dtype == 2 && dwidth == 2 | SR[31:0] |
| Other: Reserved | Other: Reserved |  |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `MODE_WRK.rounding`
- `MODE_WRK.fp16_ovclp`
- `MODE_WRK.bf16_ovclp`
- `TCTL`
- `VL`

### 8.8.60. MOP.MUL_F32MIX (updated in 4.0)

```text
Name            Combo Name        47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.MUL_F32MIX  M.MOP.MUL_F32MIX  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name            Combo Name        Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MUL_F32MIX  M.MOP.MUL_F32MIX  MALU                                    1
```

**MOP.MUL_F32MIX:** OACCd[i] = (OACCs1[i] * OACCs2[i]); //Both OACCd and OACCs2 are of FP32

混精运算指令，非FP32数据格式乘以FP32数据，结果回写为FP32。 ISA4.0中针对该指令修改为10bit OACC域编码，新增OACC颗粒度支持。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src1/src2/dst VA数量 |
| --- | --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 | src1: 1OA; src2/dst: 4OA |
| INT8 | dtype == 1 && dwidth == 0 | src1: 1OA; src2/dst: 4OA |
| FP16 | dtype == 2 && dwidth == 1 | src1: 1OA; src2/dst: 2OA |
| BF16 | dtype == 3 && dwidth == 1 | src1: 1OA; src2/dst: 2OA |
| UINT32 | dtype == 0 && dwidth == 2 | src1: 1OA; src2/dst: 1OA |
| INT32 | dtype == 1 && dwidth == 2 | src1: 1OA; src2/dst: 1OA |
| Other: Reserved | Other: Reserved | N/A |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
    - OACCs2和OACCd不能相互覆盖
  - 如果vm=0，则OACCd不能为0

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `MODE_WRK.rounding`
- `TCTL`
- `VL`

### 8.8.61. MOP.MUL_F16MIX (updated in 4.0)

```text
Name            Combo Name        47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.MUL_F16MIX  M.MOP.MUL_F16MIX  sub-code  dwidth  vm  LCE  dtype   ftype   OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name            Combo Name        Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MUL_F16MIX  M.MOP.MUL_F16MIX  MALU                                    1
```

**MOP.MUL_F16MIX:** OACCd[i] = (OACCs1[i] * OACCs2[i]); //Both OACCd and OACCs2 are of FP16(BF16)

混精运算指令

当ftype为0时：非FP16数据格式乘以FP16数据，结果回写为FP16，并受到MODE_WRK.FP16_OVCLP影响进行clamp操作。

当ftype为1时：非BF16数据格式乘以BF16数据，结果回写为BF16，并受到MODE_WRK.BF16_OVCLP影响进行clamp操作。

ISA4.0中针对该指令修改为10bit OACC域编码，新增OACC颗粒度支持，通过增加ftype域新增对BF16数据格式的支持。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src1/src2/dst VA数量 |
| --- | --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 | src1: 1OA; src2/dst: 2OA |
| INT8 | dtype == 1 && dwidth == 0 | src1: 1OA; src2/dst: 2OA |
| Other: Reserved | Other: Reserved | N/A |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
    - OACCs2和OACCd不能相互覆盖
  - 如果vm=0，则OACCd不能为0
- `ftype`
  - 0：OACCd和OACCs2保存的数据类型为FP16
  - 1：OACCd和OACCs2保存的数据类型为BF16

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `MODE_WRK.fp16_ovclp`
- `MODE_WRK.bf16_ovclp`
- `MODE_WRK.rounding`
- `TCTL`
- `VL`

### 8.8.62. MOP.MUL_I32MIX (updated in 4.0)

```text
Name            Combo Name        47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.MUL_I32MIX  M.MOP.MUL_I32MIX  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name            Combo Name        Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MUL_I32MIX  M.MOP.MUL_I32MIX  MALU                                    1
```

**MOP.MUL_I32MIX:** OACCd[i] = (OACCs1[i] * OACCs2[i]); //Both OACCd and OACCs2 are of INT32

混精运算指令，非INT32数据格式乘以INT32数据，结果回写为INT32。如果运算精确结果超出INT32范围，则进行saturation。

ISA4.0中针对该指令修改为10bit OACC域编码，新增OACC颗粒度支持。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src1/src2/dst VA数量 |
| --- | --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 | src1: 1OA; src2/dst: 4OA |
| INT8 | dtype == 1 && dwidth == 0 | src1: 1OA; src2/dst: 4OA |
| Other: Reserved | Other: Reserved | N/A |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
    - OACCs2和OACCd不能相互覆盖
  - 如果vm=0，则OACCd不能为0

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.63. MOP.WMUL_I32MIX (updated in 4.0)

```text
Name             Combo Name         47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.WMUL_I32MIX  M.MOP.WMUL_I32MIX  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name             Combo Name         Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.WMUL_I32MIX  M.MOP.WMUL_I32MIX  MALU                                    1
```

**MOP.WMUL_I32MIX:** OACCd[i] = OACCs1[i] * OACCs2[i]; //OACCs1 & OACCs2 are of same data format. OACCd is INT32

混精运算指令，两个相同格式的非INT32整型数值相乘，结果回写为INT32。本指令不会出现溢出情况。

ISA4.0中针对该指令修改为10bit OACC域编码，新增OACC颗粒度支持。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src1/src2/dst VA数量 |
| --- | --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 | src1/src2: 1OA; dst: 4OA |
| INT8 | dtype == 1 && dwidth == 0 | src1/src2: 1OA; dst: 4OA |
| Other: Reserved | Other: Reserved | N/A |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0} OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
    - OACCs2和OACCd不能相互覆盖
  - 如果vm=0，则OACCd不能为0

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.64. MOP.WMUL_I64MIX (new in 4.0)

```text
Name             Combo Name         47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.WMUL_I64MIX  M.MOP.WMUL_I64MIX  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name             Combo Name         Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.WMUL_I64MIX  M.MOP.WMUL_I64MIX  MALU                                    1
```

**MOP.WMUL_I64MIX:** OACCd[i] = OACCs1[i] * OACCs2[i]; //OACCs1 & OACCs2 are of same data format. OACCd is INT64 or UINT64

ISA4.0新增指令。混精运算指令，当Data type为INT32时，表示两个INT32整型数值相乘，结果回写为INT64；当Data type为UINT32时，表示两个UINT32整型数值相乘，结果回写为UINT64。本指令不会出现溢出情况。

- 注意，本指令支持UINT32数据类型，表示计算UINT32*UINT32 = UINT64；与ISA 4.0中混精指令命名规则稍有不符。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src1/src2/dst VA数量 |
| --- | --- | --- |
| INT32 | dtype == 1 && dwidth == 2 | src1/src2: 1OA; dst: 2OA |
| UINT32 | dtype == 0 && dwidth == 2 | src1/src2: 1OA; dst: 2OA |
| Other: Reserved | Other: Reserved | N/A |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
    - OACCs2和OACCd不能相互覆盖
  - 如果vm=0，则OACCd不能为0

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.65. MOP.ADD_F32MIX (updated in 4.0)

```text
Name            Combo Name        47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.ADD_F32MIX  M.MOP.ADD_F32MIX  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name            Combo Name        Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.ADD_F32MIX  M.MOP.ADD_F32MIX  MALU                                    1
```

**MOP.ADD_F32MIX:** OACCd[i] = (OACCs1[i] + OACCs2[i]); //Both OACCd and OACCs2 are of FP32

混精运算指令，非FP32数据格式加上FP32数据，结果回写为FP32

ISA4.0中针对该指令修改为10bit OACC域编码，新增OACC颗粒度支持。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src1/src2/dst VA数量 |
| --- | --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 | src1: 1OA; src2/dst: 4OA |
| INT8 | dtype == 1 && dwidth == 0 | src1: 1OA; src2/dst: 4OA |
| FP16 | dtype == 2 && dwidth == 1 | src1: 1OA; src2/dst: 2OA |
| BF16 | dtype == 3 && dwidth == 1 | src1: 1OA; src2/dst: 2OA |
| UINT32 | dtype == 0 && dwidth == 2 | src1: 1OA; src2/dst: 1OA |
| INT32 | dtype == 1 && dwidth == 2 | src1: 1OA; src2/dst: 1OA |
| Other: Reserved | Other: Reserved | N/A |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
    - OACCs2和OACCd不能相互覆盖
  - 如果vm=0，则OACCd不能为0

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `MODE_WRK.roudning`
- `TCTL`
- `VL`

### 8.8.66. MOP.ADD_F16MIX (updated in 4.0)

```text
Name            Combo Name        47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.ADD_F16MIX  M.MOP.ADD_F16MIX  sub-code  dwidth  vm  LCE  dtype   ftype   OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name            Combo Name        Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.ADD_F16MIX  M.MOP.ADD_F16MIX  MALU                                    1
```

**MOP.ADD_F16MIX:** OACCd[i] = (OACCs1[i] + OACCs2[i]); //Both OACCd and OACCs2 are of FP16(BF16)

混精运算指令

当ftype为0时：非FP16数据格式加上FP16数据，结果回写为FP16，并受到MODE_WRK.FP16_OVCLP影响进行clamp操作。

当ftype为1时：非BF16数据格式加上BF16数据，结果回写为BF16，并受到MODE_WRK.BF16_OVCLP影响进行clamp操作。

ISA4.0中针对该指令修改为10bit OACC域编码，新增OACC颗粒度支持，通过增加ftype域新增对BF16数据格式的支持。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src1/src2/dst VA数量 |
| --- | --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 | src1: OA; src2/dst: 2OA |
| INT8 | dtype == 1 && dwidth == 0 | src1: OA; src2/dst: 2OA |
| Other: Reserved | Other: Reserved | N/A |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
    - OACCs2和OACCd不能相互覆盖
  - 如果vm=0，则OACCd不能为0
- `ftype`
  - 0：OACCd和OACCs2保存的数据类型为FP16
  - 1：OACCd和OACCs2保存的数据类型为BF16

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `MODE_WRK.roudning`
- `MODE_WRK.fp16_ovclp`
- `MODE_WRK.bf16_ovclp`
- `TCTL`
- `VL`

### 8.8.67. MOP.ADD_I32MIX (updated in 4.0)

```text
Name            Combo Name        47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.ADD_I32MIX  M.MOP.ADD_I32MIX  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name            Combo Name        Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.ADD_I32MIX  M.MOP.ADD_I32MIX  MALU                                    1
```

**MOP.ADD_I32MIX:** OACCd[i] = (OACCs1[i] + OACCs2[i]); //Both OACCd and OACCs2 are of INT32

混精运算指令，非INT32数据格式加上INT32数据，结果回写为INT32。如果运算精确结果超出INT32范围，则进行saturation。

ISA4.0中针对该指令修改为10bit OACC域编码，新增OACC颗粒度支持。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src1/src2/dst VA数量 |
| --- | --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 | src1: OA; src2/dst: 4OA |
| INT8 | dtype == 1 && dwidth == 0 | src1: OA; src2/dst: 4OA |
| Other: Reserved | Other: Reserved | N/A |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
    - OACCs2和OACCd不能相互覆盖
  - 如果vm=0，则OACCd不能为0

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.68. MOP.WADD_I32MIX (updated in 4.0)

```text
Name             Combo Name         47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.WADD_I32MIX  M.MOP.WADD_I32MIX  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name             Combo Name         Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.WADD_I32MIX  M.MOP.WADD_I32MIX  MALU                                    1
```

**MOP.WADD_I32MIX:** OACCd[i] = OACCs1[i] + OACCs2[i]; //OACCs1 & OACCs2 are of same data format. OACCd is INT32

混精运算指令，两个相同格式的非INT32整型数值相加，结果回写为INT32。本指令不会出现溢出情况。

ISA4.0中针对该指令修改为10bit OACC域编码，新增OACC颗粒度支持。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src1/src2/dst VA数量 |
| --- | --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 | src1/src2: OA; dst: 4OA |
| INT8 | dtype == 1 && dwidth == 0 | src1/src2: OA; dst: 4OA |
| Other: Reserved | Other: Reserved | N/A |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
    - OACCs2和OACCd不能相互覆盖
  - 如果vm=0，则OACCd不能为0

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.69. MOP.WMULUS_I32MIX (updated in 4.0)

```text
Name               Combo Name           47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.WMULUS_I32MIX  M.MOP.WMULUS_I32MIX  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name               Combo Name           Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.WMULUS_I32MIX  M.MOP.WMULUS_I32MIX  MALU                                    1
```

**MOP.WMULUS_I32MIX:** OACCd[i] = OACCs1[i] * OACCs2[i]; //OACCs1 is UINT8 and OACCs2 is INT8. OACCd is INT32

混精运算指令，一个UINT8和一个INT8相乘，结果回写为INT32。本指令不会出现溢出情况。

ISA4.0中针对该指令修改为10bit OACC域编码，新增OACC颗粒度支持。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src1/src2/dst VA数量 |
| --- | --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 | src1/src2: OA; dst: 4OA |
| Other: Reserved | Other: Reserved | N/A |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0} OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
    - OACCs2和OACCd不能相互覆盖
  - 如果vm=0，则OACCd不能为0

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.70. MOP.MAC (updated in 4.0)

```text
Name     Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6     5--2    1        0
MOP.MAC  M.MOP.MAC   sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCs3/d  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MAC  M.MOP.MAC   MALU                                    1
```

**MOP.MAC:** OACCd[i] = OACCs1[i] * OACCs2[i] + OACCd[i];

混精MAC运算指令，相同格式两个源操作数相乘，累加上INT32或者FP32并回写OACC寄存器。如果源操作数为整型，则累加和目的操作数为INT32；如果源操作数为浮点，则累加和目的操作数为FP32。对于INT32运算结果进行saturation。指令受到SPR NACCOVR的影响， NACCOVR[0]为0表示执行累加操作，NACCOVR[0]为1表示不执行累加操作。

ISA4.0中针对该指令修改为10bit OACC域编码，新增OACC颗粒度支持。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src/dst VA数量 |
| --- | --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 | src1/src2: 1OA; dst: 4OA |
| INT8 | dtype == 1 && dwidth == 0 | src1/src2: 1OA; dst: 4OA |
| FP16 | dtype == 2 && dwidth == 1 | src1/src2: 1OA; dst: 2OA |
| BF16 | dtype == 3 && dwidth == 1 | src1/src2: 1OA; dst: 2OA |
| FP32 | dtype == 2 && dwidth == 2 | src1/src2: 1OA; dst: 1OA |
| Other: Reserved | Other: Reserved | N/A |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCS3d`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCs3d不能互相覆盖
    - OACCs2和OACCs3d不能相互覆盖
  - 如果vm=0，则OACCs3d不能为0

**Implicit Use:**

- VAB_VPT* MODE_WRK.denormal_flush
- `MODE_WRK.roudning`
- `TCTL`
- `VL`
- `NACCOVR`

### 8.8.71. MOP.MAS (updated in 4.0)

```text
Name     Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6     5--2    1        0
MOP.MAS  M.MOP.MAS   sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCs3/d  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MAS  M.MOP.MAS   MALU                                    1
```

**MOP.MAS:** OACCd[i] = - OACCs1[i] * OACCs2[i] + OACCd[i];

混精MAC运算指令，相同格式两个源操作数相乘并取反，累加上INT32或者FP32并回写OACC寄存器。如果源操作数为整型，则累加和目的操作数为INT32；如果源操作数为浮点，则累加和目的操作数为FP32。对于INT32运算结果进行saturation。指令受到SPR NACCOVR的影响，NACCOVR[0]为0表示执行累加操作，NACCOVR[0]为1表示不执行累加操作。

ISA4.0中针对该指令修改为10bit OACC域编码，新增OACC颗粒度支持。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src/dst VA数量 |
| --- | --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 | src1/src2: 1OA; dst: 4OA |
| INT8 | dtype == 1 && dwidth == 0 | src1/src2: 1OA; dst: 4OA |
| FP16 | dtype == 2 && dwidth == 1 | src1/src2: 1OA; dst: 2OA |
| BF16 | dtype == 3 && dwidth == 1 | src1/src2: 1OA; dst: 2OA |
| FP32 | dtype == 2 && dwidth == 2 | src1/src2: 1OA; dst: 1OA |
| Other: Reserved | Other: Reserved | N/A |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCS3d`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCs3d不能互相覆盖
    - OACCs2和OACCs3d不能相互覆盖
  - 如果vm=0，则OACCs3d不能为0

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `MODE_WRK.roudning`
- `TCTL`
- VL NACCOVR

### 8.8.72. MOP.IMAS (updated in 4.0)

```text
Name      Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6     5--2    1        0
MOP.IMAS  M.MOP.IMAS  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCs3/d  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.IMAS  M.MOP.IMAS  MALU                                    1
```

**MOP.IMAS:** OACCd[i] = OACCs1[i] * OACCs2[i] - OACCd[i];

混精MAC运算指令，相同格式两个源操作数相乘，减去累加数INT32或者FP32并回写OACC寄存器。如果源操作数为整型，则累加和目的操作数为INT32；如果源操作数为浮点，则累加和目的操作数为FP32。对于INT32运算结果进行saturation。指令受到SPR NACCOVR的影响， NACCOVR[0]为0表示执行累加操作，NACCOVR[0]为1表示不执行累加操作。

ISA4.0中针对该指令修改为10bit OACC域编码，新增OACC颗粒度支持。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src/dst VA数量 |
| --- | --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 | src1/src2: 1OA; dst: 4OA |
| INT8 | dtype == 1 && dwidth == 0 | src1/src2: 1OA; dst: 4OA |
| FP16 | dtype == 2 && dwidth == 1 | src1/src2: 1OA; dst: 2OA |
| BF16 | dtype == 3 && dwidth == 1 | src1/src2: 1OA; dst: 2OA |
| FP32 | dtype == 2 && dwidth == 2 | src1/src2: 1OA; dst: 1OA |
| Other: Reserved | Other: Reserved | N/A |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCS3d`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCs3d不能互相覆盖
    - OACCs2和OACCs3d不能相互覆盖
  - 如果vm=0，则OACCs3d不能为0

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `MODE_WRK.roudning`
- `TCTL`
- `VL`
- `NACCOVR`

### 8.8.73. MOP.MAC_F32MIX (updated in 4.0)

```text
Name            Combo Name        47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6     5--2    1        0
MOP.MAC_F32MIX  M.MOP.MAC_F32MIX  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCs3/d  opcode  Const_0  MCE
```

```text
Name            Combo Name        Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MAC_F32MIX  M.MOP.MAC_F32MIX  MALU                                    1
```

**MOP.MAC_F32MIX:** OACCd[i] = OACCs1[i] * OACCs2[i] + OACCd[i]; //OACCs2 & OACCd are both FP32

混精MAC运算指令，数据操作数1乘以输入操作数2(FP32)，累加上FP32并回写OACC寄存器。

ISA4.0中针对该指令修改为10bit OACC域编码，新增OACC颗粒度支持。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src1/src2/dst VA数量 |
| --- | --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 | src1: 1OA; src2/dst: 4OA |
| INT8 | dtype == 1 && dwidth == 0 | src1: 1OA; src2/dst: 4OA |
| FP16 | dtype == 2 && dwidth == 1 | src1: 1OA; src2/dst: 2OA |
| BF16 | dtype == 3 && dwidth == 1 | src1: 1OA; src2/dst: 2OA |
| Other: Reserved | Other: Reserved | N/A |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCS3d`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCs3d不能互相覆盖
    - OACCs2和OACCs3d不能相互覆盖
  - 如果vm=0，则OACCs3d不能为0

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `MODE_WRK.roudning`
- `TCTL`
- `VL`

### 8.8.74. MOP.MAS_F32MIX (updated in 4.0)

```text
Name            Combo Name        47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6     5--2    1        0
MOP.MAS_F32MIX  M.MOP.MAS_F32MIX  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCs3/d  opcode  Const_0  MCE
```

```text
Name            Combo Name        Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MAS_F32MIX  M.MOP.MAS_F32MIX  MALU                                    1
```

**MOP.MAS_F32MIX:** OACCd[i] = - OACCs1[i] * OACCs2[i] + OACCd[i]; //OACCs2 & OACCd are both FP32

混精MAC运算指令，数据操作数1乘以输入操作数2(FP32)并取反，累加上FP32并回写OACC寄存器。

ISA4.0中针对该指令修改为10bit OACC域编码，新增OACC颗粒度支持。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src1/src2/dst VA数量 |
| --- | --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 | src1: 1OA; src2/dst: 4OA |
| INT8 | dtype == 1 && dwidth == 0 | src1: 1OA; src2/dst: 4OA |
| FP16 | dtype == 2 && dwidth == 1 | src1: 1OA; src2/dst: 2OA |
| BF16 | dtype == 3 && dwidth == 1 | src1: 1OA; src2/dst: 2OA |
| Other: Reserved | Other: Reserved | N/A |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCS3d`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCs3d不能互相覆盖
    - OACCs2和OACCs3d不能相互覆盖
  - 如果vm=0，则OACCs3d不能为0

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `MODE_WRK.roudning`
- `TCTL`
- `VL`

### 8.8.75. MOP.IMAS_F32MIX (updated in 4.0)

```text
Name             Combo Name         47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6     5--2    1        0
MOP.IMAS_F32MIX  M.MOP.IMAS_F32MIX  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCs3/d  opcode  Const_0  MCE
```

```text
Name             Combo Name         Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.IMAS_F32MIX  M.MOP.IMAS_F32MIX  MALU                                    1
```

**MOP.IMAS_F32MIX:** OACCd[i] = OACCs1[i] * OACCs2[i] - OACCd[i]; //OACCs2 & OACCd are both FP32

混精MAC运算指令，数据操作数1乘以输入操作数2(FP32)，减去累加操作数(FP32)并回写OACC寄存器。

ISA4.0中针对该指令修改为10bit OACC域编码，新增OACC颗粒度支持。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src1/src2/dst VA数量 |
| --- | --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 | src1: 1OA; src2/dst: 4OA |
| INT8 | dtype == 1 && dwidth == 0 | src1: 1OA; src2/dst: 4OA |
| FP16 | dtype == 2 && dwidth == 1 | src1: 1OA; src2/dst: 2OA |
| BF16 | dtype == 3 && dwidth == 1 | src1: 1OA; src2/dst: 2OA |
| Other: Reserved | Other: Reserved | N/A |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCS3d`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCs3d不能互相覆盖
    - OACCs2和OACCs3d不能相互覆盖
  - 如果vm=0，则OACCs3d不能为0

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `MODE_WRK.roudning`
- `TCTL`
- `VL`

### 8.8.76. MOP.MAC_F16MIX (updated in 4.0)

```text
Name            Combo Name        47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6     5--2    1        0
MOP.MAC_F16MIX  M.MOP.MAC_F16MIX  sub-code  dwidth  vm  LCE  dtype   ftype   OACCs1  OACCs2  OACCs3/d  opcode  Const_0  MCE
```

```text
Name            Combo Name        Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MAC_F16MIX  M.MOP.MAC_F16MIX  MALU                                    1
```

**MOP.MAC_F16MIX:** OACCd[i] = OACCs1[i] * OACCs2[i] + OACCd[i]; //OACCs2 & OACCd are both FP16(BF16)

混精运算指令

当ftype为0时：数据操作数1乘以输入操作数2(FP16)，累加上FP16并回写OACC寄存器。结果受到MODE_WRK.FP16_OVCLP影响进行clamp 操作。

当ftype为1时：数据操作数1乘以输入操作数2(BF16)，累加上BF16并回写OACC寄存器。结果受到MODE_WRK.BF16_OVCLP影响进行clamp 操作。

ISA4.0中针对该指令修改为10bit OACC域编码，新增OACC颗粒度支持，通过增加ftype域新增对BF16数据格式的支持。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src1/src2/dst VA数量 |
| --- | --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 | src1: 1OA; src2/dst: 2OA |
| INT8 | dtype == 1 && dwidth == 0 | src1: 1OA; src2/dst: 2OA |
| Other: Reserved | Other: Reserved | N/A |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCS3d`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCs3d不能互相覆盖
    - OACCs2和OACCs3d不能相互覆盖
  - 如果vm=0，则OACCs3d不能为0
- `ftype`
  - 0：OACCd和OACCs2保存的数据类型为FP16
  - 1：OACCd和OACCs2保存的数据类型为BF16

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `MODE_WRK.roudning`
- `MODE_WRK.fp16_ovclp`
- `MODE_WRK.bf16_ovclp`
- `TCTL`
- `VL`

### 8.8.77. MOP.MAS_F16MIX (updated in 4.0)

```text
Name            Combo Name        47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6     5--2    1        0
MOP.MAS_F16MIX  M.MOP.MAS_F16MIX  sub-code  dwidth  vm  LCE  dtype   ftype   OACCs1  OACCs2  OACCs3/d  opcode  Const_0  MCE
```

```text
Name            Combo Name        Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.MAS_F16MIX  M.MOP.MAS_F16MIX  MALU                                    1
```

**MOP.MAS_F16MIX:** OACCd[i] = - OACCs1[i] * OACCs2[i] + OACCd[i]; //OACCs2 & OACCd are both FP16(BF16)

混精运算指令

当ftype为0时：数据操作数1乘以输入操作数2(FP16)并取反，累加上FP16并回写OACC寄存器。结果受到MODE_WRK.FP16_OVCLP影响进行clamp操作。

当ftype为1时：数据操作数1乘以输入操作数2(BF16)并取反，累加上BF16并回写OACC寄存器。结果受到MODE_WRK.BF16_OVCLP影响进行clamp操作。

ISA4.0中针对该指令修改为10bit OACC域编码，新增OACC颗粒度支持，通过增加ftype域新增对BF16数据格式的支持。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src1/src2/dst VA数量 |
| --- | --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 | src1: 1OA; src2/dst: 2OA |
| INT8 | dtype == 1 && dwidth == 0 | src1: 1OA; src2/dst: 2OA |
| Other: Reserved | Other: Reserved | N/A |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCS3d`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCs3d不能互相覆盖
    - OACCs2和OACCs3d不能相互覆盖
  - 如果vm=0，则OACCs3d不能为0
- `ftype`
  - 0：OACCd和OACCs2保存的数据类型为FP16
  - 1：OACCd和OACCs2保存的数据类型为BF16

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `MODE_WRK.roudning`
- `MODE_WRK.fp16_ovclp`
- `MODE_WRK.bf16_ovclp`
- `TCTL`
- `VL`

### 8.8.78. MOP.IMAS_F16MIX (updated in 4.0)

```text
Name             Combo Name         47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6     5--2    1        0
MOP.IMAS_F16MIX  M.MOP.IMAS_F16MIX  sub-code  dwidth  vm  LCE  dtype   ftype   OACCs1  OACCs2  OACCs3/d  opcode  Const_0  MCE
```

```text
Name             Combo Name         Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.IMAS_F16MIX  M.MOP.IMAS_F16MIX  MALU                                    1
```

**MOP.IMAS_F16MIX:** OACCd[i] = OACCs1[i] * OACCs2[i] - OACCd[i]; //OACCs2 & OACCd are both FP16(BF16)

混精运算指令

当ftype为0时：数据操作数1乘以输入操作数2(FP16)，减去累加操作数(FP16)并回写OACC寄存器。结果受到MODE_WRK.FP16_OVCLP影响进行clamp操作。

当ftype为1时：数据操作数1乘以输入操作数2(BF16)，减去累加操作数(BF16)并回写OACC寄存器。结果受到MODE_WRK.BF16_OVCLP影响进行clamp操作。

ISA4.0中针对该指令修改为10bit OACC域编码，新增OACC颗粒度支持，通过增加ftype域新增对BF16数据格式的支持。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src1/src2/dst VA数量 |
| --- | --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 | src1: 1OA; src2/dst: 2OA |
| INT8 | dtype == 1 && dwidth == 0 | src1: 1OA; src2/dst: 2OA |
| Other: Reserved | Other: Reserved | N/A |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCS3d`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCs3d不能互相覆盖
    - OACCs2和OACCs3d不能相互覆盖
  - 如果vm=0，则OACCs3d不能为0
- `ftype`
  - 0：OACCd和OACCs2保存的数据类型为FP16
  - 1：OACCd和OACCs2保存的数据类型为BF16

**Implicit Use:**

- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `MODE_WRK.roudning`
- `MODE_WRK.fp16_ovclp`
- `MODE_WRK.bf16_ovclp`
- `TCTL`
- `VL`

### 8.8.79. MOP.XOR_U32MIX (new in 4.0)

```text
Name            Combo Name        47--44    43   42      41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.XOR_U32MIX  M.MOP.XOR_U32MIX  sub-code  N/A  sel_hi  vm  LCE  dtype   N/A     OACCs1  OACCs2  OACCd  opcode  Const_0  MCE
```

```text
Name            Combo Name        Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.XOR_U32MIX  M.MOP.XOR_U32MIX  MALU                                    1
```

**MOP.XOR_U32MIX:** if(sel_hi) OACCd[i] [31:0] = XOR(OACCs1[i] [63:32], OACCs2[i] [63:32]); else OACCd[i] = XOR(OACCs1[i] [31:0],

OACCs2[i] [31:0])

ISA4.0新增混精指令，对输入的UINT64数据的低32位或者高32位进行异或操作，结果写回OACCd，数据类型为UINT32,。可以用于加速基于LFSR的uniform RNG算法。

本指令是混精变窄指令，全0进行异或可以看作一种特别的Shuffle操作

**Field description:**

- `dtype`
  - 请见Common MALU Data Type
  - 对于本指令，合法的dtype为

| Data type | dtype & dwidth input | 允许的src1/src2/dst数量 |
| --- | --- | --- |
| UINT64 | dtype == 0 | src1/src2: 2OA; dst: 1OA |
| Other: Reserved | Other: Reserved |  |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCs2/OACCS3d`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCS3d不能互相覆盖
    - OACCs2和OACCS3d不能相互覆盖
  - 如果vm=0，则OACCS3d不能为0
- `sel_hi`
  - sel_hi == 1 : 对输入64bit数据的高32位进行异或操作
  - sel_hi == 0 : 对输入64bit数据的低32位进行异或操作

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.80. MOP.FCLASS (updated in 4.0)

```text
Name        Combo Name    47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.FCLASS  M.MOP.FCLASS  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  N/A     OACCd  opcode  Const_0  MCE
```

```text
Name        Combo Name    Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.FCLASS  M.MOP.FCLASS  MALU                                    1
```

**MOP.FCLASS:** OACCd[i] = fclass(OACCs1[i]);

ISA3.2新增指令。源自RV-32F和RVV扩展。根据数据格式，判断浮点数据格式，设置目标操作数[11:0]某个bit，即one-hot编码。目标操作数其他位为0。对于FP16/BF16输入操作数，输出为UINT16；对于FP32输入操作数，输出为UINT32；对于FP8输入操作数，输出为UINT16， 此时该指令为元素位宽变宽类指令，输入寄存器数量为OACC，输出寄存器数量为2OACC。

ISA4.0中针对该指令修改为10bit OACC域编码，新增OACC颗粒度支持以及对数据格式FP8 E4M3和FP8 E5M2的支持。

- 对于FP8 E5M2格式，由于其符合IEEE754标准的扩展浮点编码，因此其输出和其他浮点格式相同
- 对于FP8 E4M3格式，其格式不符合IEEE54标准的扩展浮点编码。对于该数值类型的表达请参考FP8 E4M3 & E5M2章节。该数据类型没有INF表达，并且NaN也只有QNaN表达。
One-hot编码为：

| bit | 含义 |
| --- | --- |
| 0 | OACCs1[i]为负无穷 -∞ |
| 1 | OACCs1[i]为负规格化数 Negative normal value |
| 2 | OACCs1[i]为负非规格化数 Negative subnormal value |
| 3 | OACCs1[i]为- 0 |
| 4 | OACCs1[i]为+0 |
| 5 | OACCs1[i]为正非规格化数 Positive subnormal value |
| 6 | OACCs1[i]为正规格化数 Positive normal value |
| 7 | OACCs1[i]为正无穷 +∞ |

| bit | 含义 |
| --- | --- |
| 8 | OACCs1[i]为Signaling NaN |
| 9 | OACCs1[i]为quiet NaN |

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src1/src2/dst VA数量 |
| --- | --- | --- |
| FP16 | dtype == 2 && dwidth == 1 | src1: 1OA; src2/dst: 1OA |
| BF16 | dtype == 3 && dwidth == 1 | src1: 1OA; src2/dst: 1OA |
| FP32 | dtype == 2 && dwidth == 2 | src1: 1OA; src2/dst: 1OA |
| FP8_E4M3 | dtype == 2 && dwidth == 0 | src1: 1OA; src2/dst: 2OA |
| FP8_E5M2 | dtype == 3 && dwidth == 0 | src1: 1OA; src2/dst: 2OA |
| Other: Reserved | Other: Reserved |  |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
  - 如果vm=0，则OACCd不能为0

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.81. MOP.POPC (new in 4.0)

```text
Name      Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.POPC  M.MOP.POPC  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  N/A     OACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.POPC  M.MOP.POPC  MALU                                    1
```

**MOP.POPC:** OACCd[i] = count_bit_one(OACCs1[i]);

ISA4.0新增指令。根据数据格式，计算源操作数每个元素中bit1个数，并写回到目标操作数中。其中输入输出的操作数元素格式保持一致。 只支持UINT的数据格式。输入输出向量寄存器位宽为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.82. MOP.CLZ (new in 4.0)

```text
Name     Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.CLZ  M.MOP.CLZ   sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  N/A     OACCd  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.CLZ  M.MOP.CLZ   MALU                                    1
```

**MOP.CLZ:** OACCd[i] = count_leading_zero(OACCs1[i]);

ISA4.0新增指令。根据数据格式，计算源操作数中每个元素的前导0个数，并写回到目标操作数中。其中输入输出的操作数元素格式保持一致。只支持UINT的数据格式。输入输出向量寄存器位宽为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0} OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.83. MOP.CLS (new in 4.0)

```text
Name     Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.CLS  M.MOP.CLS   sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  N/A     OACCd  opcode  Const_0  MCE
```

```text
Name     Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.CLS  M.MOP.CLS   MALU                                    1
```

**MOP.CLS:** OACCd[i] = count_leading_sign(OACCs1[i]);

ISA4.0新增指令。根据数据格式，计算源操作数中每个元素的前导符号位的个数（包括符号位），并写回到目标操作数中。其中输入输出的操作数元素格式保持一致。只支持INT的数据格式。输入输出向量寄存器位宽为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| INT8 | dtype == 1 && dwidth == 0 |
| INT16 | dtype == 1 && dwidth == 1 |
| INT32 | dtype == 1 && dwidth == 2 |
| INT64 | dtype == 1 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.84. MOP.BREV (new in 4.0)

```text
Name      Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.BREV  M.MOP.BREV  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  N/A     OACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.BREV  M.MOP.BREV  MALU                                    1
```

**MOP.BREV:** OACCd[i] = Reverse_the_bit_order_of_unsigned_integer(OACCs1[i]);

ISA4.0新增指令。根据数据格式，将输入操作数的bit位完全反转。其中输入输出的操作数元素格式保持一致。只支持UINT的数据格式。输入输出向量寄存器位宽为OACC，指令编码中通过10bitOACC域寻址。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.85. MOP.SIGN (new in 4.0)

```text
Name      Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--16  15--6  5--2    1        0
MOP.SIGN  M.MOP.SIGN  sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  N/A     OACCd  opcode  Const_0  MCE
```

```text
Name      Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.SIGN  M.MOP.SIGN  MALU                                    1
```

**MOP.SIGN:** OACCd[i] = OACCs1[i] > 0 ? 1 : OACCs1[i] == 0 ? 0 : -1;

ISA4.0新增指令。输入为浮点数或者有符号整形数，输出固定为相同位宽的有符号整形数。当输入数为正数时，返回1；输入数是负数时，返回-1；输入数是0时（包括浮点的±0）或者是浮点的NaN时，返回0。输入输出向量寄存器位宽为OACC，指令编码中通过10bitOACC域寻址。

本指令时参照PTX相应指令增加的。

**Field description:**

- dwidth & dtype
  - 请见Common MALU Data Type
  - 本指令这两个域用于指示OACCs1
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| INT8 | dtype == 1 && dwidth == 0 |
| INT16 | dtype == 1 && dwidth == 1 |
| INT32 | dtype == 1 && dwidth == 2 |
| INT64 | dtype == 1 && dwidth == 3 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.86. MOP.BCAST (new in 4.0)

```text
Name       Combo Name   47--44    43--42  41  40   39--36  35--26  25--21  20--16  15--6  5--2    1        0
MOP.BCAST  M.MOP.BCAST  sub-code  dwidth  vm  LCE  N/A     OACCs1  N/A     Rs1     OACCd  opcode  Const_0  MCE
```

```text
Name       Combo Name   Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MOP.BCAST  M.MOP.BCAST  MALU                                    1
```

**MOP.BCAST:** OACCd[i] = OACCs1[SR[Rs1]];

ISA4.0新增指令。用于支持向量寄存器内的Broadcast操作。指令用SR[Rs1]的数值作为index，表示OACCs1中需要被复制的元素位置，指令执行如下操作：将OACCs1中datalane[index]的数据复制到OACCd每个datalane中，元素写入OACCd时受到VL和maskbit的影响。

Note：本指令中，VL作用于两个方向，SRC选择和结果写回。如果SR1的数值大于等于VL，本指令不会执行；而当0<= SR1 < VL时，只写回index为0~(VL-1)的元素位置上

**Field description:**

- `dwidth`
  - 本指令支持任意dtype。根据dwidth决定复制的元素宽度
dwidth input

dwidth == 0 broadcast元素宽度为8

dwidth == 1 broadcast元素宽度为16

dwidth == 2 broadcast元素宽度为32

dwidth == 3 broadcast元素宽度为64

- `Rs1`
  - OACCs1中需要被复制的元素位置
  - SR[Rs1]的数值大于等于2^(9-dwidth)时，指令视为NOP
- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
  - 如果vm=0，则OACCd不能为0

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.87. MSF (updated in 4.0)

```text
Name  Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--21  20--16  15--6  5--2    1        0
MSF   M.MSF       sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  N/A     subop   OACCd  opcode  Const_0  MCE
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MSF   M.MSF       MALU                                    1
```

**MOP.MSF:** OACCd[i] = subop(OACCs1[i]);

除RNG-subop外：对输入的FP32数值进行超越函数运算。输入输出仅支持FP32格式。

对于RNG-subop：对输入的UINT数值进行超越函数运算。输入仅支持UINT64格式，输出为FP32格式。

ISA4.0中修改内容包括

- 指令操作位宽固定为OACC，指令编码中通过10bitOACC域寻址。
- 增加了VL对本指令的影响
部分功能位域说明：

- `subop`
  - 指定进行VSF运算操作的类型
    - 0x0：exp(x)
    - 0x1：softplus(x)
    - 0x2：tanh(x)
    - 0x3：sigmoid(x)
    - 0x4：gelu(x)
    - 0x5：ln(x)，需要配合预处理
    - 0x6：rec(x)，1/x
    - 0x7：rsqrt(x)，1/sqrt(x)
    - 0x8：sin(x)，单位弧度
      - Note: 该函数的有效输入范围为 (-π，π) ，数值范围大致为(-3.15625,3.15625)，而非(-INF,INF)。如果超出有效输入范围，则输出NAN
    - 0x10：Normal distribution RNG 正态分布随机数
- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input | 允许的src/dst数量 | comment |
| --- | --- | --- | --- |
| FP32 | dtype == 2 && dwidth == 2 | src1: 1OA; dst: 1OA | 支持所有非RNG subop |
| UINT64 | dtype == 0 && dwidth == 3 | src1: 2OA; dst: 1OA | 仅支持RNG subop |
| Other: Reserved | Other: Reserved |  |  |

- `vm`
  - 本指令vm = 1固定为1，即非条件写回
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT* + {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - OACCs1/OACCd不能为0
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖

**Implicit Use:**

- `TCTL`
- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `MODE_WRK.rounding`
- `VL`

### 8.8.88. MID (updated in 4.0)

```text
Name  Combo Name  47--44    43--42  41  40   39--38  37--36  35--32    31--21  20--16  15--6  5--2    1        0
MID   M.MID       sub-code  dwidth  vm  LCE  dtype   N/A     mid_mode  N/A     Rs1     OACCd  opcode  Const_0  MCE
```

```text
Name  Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MID   M.MID       MALU                                    1
```

对选中的OACC寄存器产生连续的无符号整型序列。本指令的目标寄存器只能是OACC。无符号整型序列数值为元素index + Rs1。如果数值超过表达范围不进行saturation

ISA4.0中本指令有如下特点：

- 指令操作位宽固定为OACC，指令编码中通过10bitOACC域寻址。
- 增加了VL对本指令的影响
- 增加了对UINT64的支持
- 增加了对OACC的支持
指令算法描述：

```text
for(int i = 0; i < VPT_NUM-1; i ++) {
    if(dwidth == 0) {
        limit = 512;
    } else if(dwidth == 1) {
        limit = 256;
    } else if dwidth == 2 {
        limit = 128;
    } else {
        limit = 64;
    }
    if(mid_mode == 0) {
        for(int j = 0; j < limit; j ++) {
            OACC[i][OACCd_index][j] = SR[Rs1] + j + limit * i;
        }
    } else {
        for(int j = 0; j < limit; j ++) {
            OACC[i][OACCd_index][j] = SR[Rs1] + j;
        }
    }
}
```

部分功能位域说明：

- `Rs1`
  - index排列起始数值
- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `mid_mode`
  - 0：在两个VPT上产生连续index
  - 1：在两个VPT上duplicate
  - Other：Reserved
  - 如果TCTL设置某VPT不使能，则该VPT下，指令视为NOP
- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCd`
  - VACCd_index = VAB_VPT* + {OACCd + 3'b0}
  - OACCd_index = VACCd_index >> 3

**Implicit Use:**

- `TCTL`
- `VAB_VPT*`
- `VL`

### 8.8.89. Uniform RNG Architecture

#### 8.8.89.1. LFSR算法

ISA4.0新增MLFSR、MCASR、MOP.XOR_U32MIX指令用于替代ISA3.2中通过MSF产生Uniform RNG的操作。算法和ISA3.2一致，只是将指令做更细粒度的拆分。

计算序列：

```text
MLFSR.rot OACC1, OACC0  //OACC0是第一组LFSR的mask选择；结果写回OACC1
MLFSR.rot OACC3, OACC2  //OACC2是第二个LFSR的mask选择；结果写回OACC2
MCASR.head36.pad OACC5, OACC4   //head == 36为ISA3.2中RNG产生器选择的CASR位宽
MOP.XOR OACC6, OACC3, OACC1 //第一次异或
MOP.XOR_U32MIX QACC14, OACC6, OACC5 //第二次异或
```

和ISA3.2相比

- 计算速度
  - ISA4.0：64 element/5cycles
  - ISA3.2：32 element/9cycles

#### 8.8.89.2. Philox4x32-10算法

算法介绍：

![Figure 7](libra_sip_isa__figure_007.png)

### 8.8.90. MLFSR (new in 4.0)

```text
Name   Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--22  21--16  15--6     5--2    1        0
MLFSR  M.MLFSR     sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  N/A     rot     OACCs3/d  opcode  Const_0  MCE
```

```text
Name   Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MLFSR  M.MLFSR     MALU                                    1
```

MLFSR OACCs3/d, OACCs1

ISA4.0新增指令，指令基于指令域中rotate_times, 以及OACCs1,OACCs3/d中保存的64-bit位宽的无符号整数，产生UINT64结果，并回写到 OACCs3/d寄存器。RNG结果为OACCs3/d寄存器各64-bit位宽元素的低32-bit数据。

```text
unsigned int LFSR_ROT = rot;
unsigned long temp1 = bit_xor(OACC[VPT0][OACCs3/d_index][63:0] & OACC[VPT0][OACCs1_index][63:0]) << LFSR_ROT;
unsigned long temp2 = (1'b0, OACC[VPT0][OACCs3/d_index][62:0]) << (LFSR_ROT + 1);
unsigned long temp3 = (1'b0, OACC[VPT0][OACCs3/d_index][62:0]) >> (63 - LFSR_ROT)；
unsigned long dst = tmp1 | tmp2 | tmp3;
OACC[VPT0][OACCs3/d_index][63:0] = dst;
```

#### bits(64) value

#### bit_xor(value) = value(bit[0]) ^ value(bit[1]) ^ ... ^ value(bit[63])

部分功能位域说明：

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1`
  - VACCs1_index = VAB_VPT* + {OACCs1 + 3'b0}
  - OACCs1_index = VACCs1_index >> 3
- `OACCs3d`
  - VACCs3/d_index = VAB_VPT* + {OACCs3/d + 3'b0}
  - OACCs3/d_index = VACCs3/d_index >> 3
- `rot`
  - `rotate_times`
  - 0~63

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.91. MCASR (new in 4.0)

```text
Name   Combo Name  47--44    43--42  41  40   39--38  37--36  35--26  25--22  21   20--16  15--6     5--2    1        0
MCASR  M.MCASR     sub-code  dwidth  vm  LCE  dtype   N/A     OACCs1  N/A     pad  head    OACCs3/d  opcode  Const_0  MCE
```

```text
Name   Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MCASR  M.MCASR     MALU                                    1
```

MCASR OACCs3/d, OACCs1

ISA4.0新增指令，指令基于指令域中pad_cfg_enable, pad_cfg,以及OACCs1,OACCs3/d中保存的64-bit位宽的无符号整数，产生UINT64结果，并回写到OACCs3/d寄存器。RNG结果为OACCs3/d寄存器各64-bit位宽元素的低32-bit数据。

```text
unsigned int HEAD = casr_head + 32;
unsigned int CASR_PAD = pad;
unsigned long tmp1 = zero_ext_64(rotate_left_shift_1bit(OACC[VPT0][OACCs3/d_index][HEAD:0])) &
(0xFFFF_FFFF_FFFF_FFFE | CASR_PAD);
unsigned long tmp2 = zero_ext_64(rotate_right_shift_1bit(OACC[VPT0][OACCs3/d_index][HEAD:0])) & ((~(0x1 <<
HEAD) | (CASR_PAD<< HEAD));
unsigned long tmp3 = zero_ext_64(OACC[VPT0][OACCs3/d_index][HEAD:0] & OACC[VPT0][OACCs1_index][HEAD:0]);
unsigned long dst = zero_ext_64(0x0, XOR(tmp1, tmp2, tmp3));
OACC[VPT0][OACCs3/d_index][63:0] = dst;
```

部分功能位域说明：

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT64 | dtype == 0 && dwidth == 3 |
| Other: Reserved | Other: Reserved |

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT*]中maskbit的前(64* (2^(3-dwidth)))个bit作为写回条件。当mask[i] = 1时写回；否则VACCd对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1`
  - VACCs1_index = VAB_VPT* + {OACCs1 + 3'b0}
  - OACCs1_index = VACCs1_index >> 3
- `OACCs3d`
  - VACCs3/d_index = VAB_VPT* + {OACCs3/d + 3'b0}
  - OACCs3/d_index = VACCs3/d_index >> 3
- `pad`
  - CASR运算时最低位和最高位进行与操作的bit
- `casr_head`
  - CASR运算的最高位。范围32~63
  - HEAD = casr_head + 32
  - 当casr_head = 4时，该算法与ISA3.2 uniform RNG中的CASR计算步骤是一致的

**Implicit Use:**

- `VAB_VPT*`
- `TCTL`
- `VL`

### 8.8.92. REDMAX (new in 4.0)

```text
Name    Combo Name  47--44    43--42  41        40   39--38  37--36  35--26  25--17  16     15--6  5--2    1        0
REDMAX  M.REDMAX    sub-code  dwidth  nan_mode  LCE  dtype   stage   OACCs1  N/A     bcast  OACCd  opcode  Const_0  MCE
```

```text
Name    Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
REDMAX  M.REDMAX    MALU                                    1
```

REDMAX OACCd, OACCs1

ISA4.0新增指令，通过stage域控制将OACCs1中的不同区间的元素做Reduce Max操作。指令不支持VL。

ISA4.0中，该指令暂不支持根据条件参与运算，表示为固定vm=1。

```text
###define vm 1
for i = 0...VPT_NUM-1 {
    if(stage = 0) {
        QACCs1_lo = OACC[i][VACCs1_index][2047:0];
        QACCs1_hi = OACC[i][VACCs1_index][4095:2048];
        OACCd[i][VACCd_index][2047:0] = reduce_max(QACCs1_lo, QACCs1_hi, 2048, vm);
    }
    if(stage = 1) {
        DACCs1_lo = OACC[i][VACCs1_index][1023:0];
        DACCs1_hi = OACC[i][VACCs1_index][2047:1024];
        OACCd[i][VACCd_index][1023:0] = reduce_max(DACCs1_lo, DACCs1_hi, 1024, vm);
    }
    if(stage = 2) {
        VACCs1_lo = OACC[i][VACCs1_index][511:0];
        VACCs1_hi = OACC[i][VACCs1_index][1023:512];
        OACCd[i][VACCd_index][511:0] = reduce_max(VACCs1_lo, VACCs1_hi, 512, vm);
    }
    if(stage = 3) {
        VACCs1_lo = OACC[i][VACCs1_index][511:0];
        if (bcast == 0) {
            OACCd[i][VACCd_index][2^(3+dwidth):0] = reduce_max_scalar(VACCs1_lo, 512, vm);
        } else {
            int elem_nums = 4096 / data_width;
            for (int e = 0; e < elem_nums; e++) {
                OACCd[i][VACCd_index][e] = reduce_max_scalar(VACCs1_lo, 512, vm);
            }
        }
    }
}
VACC reduce_max(VACC operand1, VACC operand2, int N, bool vm) {
    int elem_nums = N / data_width;
    VACC result;
    for (int e = 0; e < elem_nums; e++) {
        result[e] = max(operand1[e], operand2[e]);
    }
    return result
}
VACC reduce_max_scalar(VACC operand1, int N, bool vm) {
    int elem_nums = N / data_width;
    bits(2^(3+dwidth)) result;
    for (int e = 0; e < elem_nums; e++) {
        result = max(operand1[e], result);
    }
    return result
}
```

部分指令域说明：

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT* + {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 将VACC[VPT] [VACCs1_index]至 VACC[VPT] [VACCs1_index + 3] 的元素记作QACCs1；VACC[VPT] [VACCs1_index + 4] 至 VACC[VPT] [VACCs1_index + 7] 记作QACCs2；
  - 将VACC[VPT] [VACCs1_index]至 VACC[VPT] [VACCs1_index + 1] 的元素记作DACCs1；VACC[VPT] [VACCs1_index + 2] 至 VACC[VPT] [VACCs1_index + 3] 记作DACCs2
  - 将VACC[VPT] [VACCs1_index]的元素记作VACCs1；VACC[VPT] [VACCs1_index + 1] 记作VACCs2
  - 将VACC[VPT] [VACCd_index]至 VACC[VPT] [VACCd_index + 3] 的元素记作QACCd1；VACC[VPT] [VACCd_index + 4] 至 VACC[VPT] [VACCd_index + 7] 记作QACCd2
  - 将VACC[VPT] [VACCd_index]至 VACC[VPT] [VACCd_index + 1] 的元素记作DACCd1；VACC[VPT] [VACCd_index + 2] 至 VACC[VPT] [VACCd_index + 3] 记作DACCd2
  - 将VACC[VPT] [VACCd_index]的元素记作VACCd1；VACC[VPT] [VACCs1_index + 1] 记作VACCd2
- `stage`
  - 0 ： 将QACCs1 的元素分别与QACCs2的元素进行求max操作，结果回写至QACCd1中，QACCd2保持原值
  - 1 ： 将DACCs1 的元素分别与DACCs2的元素进行求max操作，结果回写至DACCd1中，DACCd2保持原值
  - 2 ： 将VACCs1 的元素分别与VACCs2的元素进行求max操作，结果回写至VACCd1中，VACCd2保持原值
  - 3： 将VACCs1 的元素做Reduction Max操作，根据bcast域对结果进行回写。
  - 当stage == 3时：源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
- `bcast`
  - 0 ：在stage==3时，将结果回写至OACCd最低元素位，其余datalane回写为0
  - 1 ：在stage==3时，将结果回写至OACCd所有datalane中
- `nan_mode`
  - stage != 3:
    - 当nan_mode为0时：如果相比较的两个操作数为浮点格式，且待比较元素中有NaN，则结果选择本ISA规定的标准NaN输出。请见NaN Result章节。
    - 当nan_mode为1时：如果相比较的两个操作数为浮点格式，且待比较元素只有一个NaN，则结果选择非NaN数值。如果两个都是NaN，则结果选择本ISA规定的标准NaN输出。
  - stage == 3：
    - 当nan_mode为0时：如果VACCs1元素为浮点格式，且待比较元素中有NaN，则结果选择本ISA规定的标准NaN输出。请见 NaN Result章节。
    - 当nan_mode为1时：如果VACCs1元素为浮点格式，元素并不全是NaN，则结果选择非NaN数值的比较结果。如果待比较元素全都是NaN，则结果选择本ISA规定的标准NaN输出。

**Implicit Use:**

- `TCTL`
- `VAB_VPT*`
- `MODE_WRK.denormal_flush`

### 8.8.93. REDMIN (new in 4.0)

```text
Name    Combo Name  47--44    43--42  41        40   39--38  37--36  35--26  25--17  16     15--6  5--2    1        0
REDMIN  M.REDMIN    sub-code  dwidth  nan_mode  LCE  dtype   stage   OACCs1  N/A     bcast  OACCd  opcode  Const_0  MCE
```

```text
Name    Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
REDMIN  M.REDMIN    MALU                                    1
```

REDMIN OACCd, OACCs1

ISA4.0新增指令，通过stage域控制将OACCs1中的不同区间的元素做Reduce Max操作。指令不支持VL。

ISA4.0中，该指令暂不支持根据条件参与运算，表示为固定vm=1。

```text
###define vm 1
for i = 0...VPT_NUM-1 {
    if(stage = 0) {
        QACCs1_lo = OACC[i][VACCs1_index][2047:0];
        QACCs1_hi = OACC[i][VACCs1_index][4095:2048];
        OACCd[i][VACCd_index][2047:0] = reduce_min(QACCs1_lo, QACCs1_hi,2048, vm);
    }
    if(stage = 1) {
        DACCs1_lo = OACC[i][VACCs1_index][1023:0];
        DACCs1_hi = OACC[i][VACCs1_index][2047:1024];
        OACCd[i][VACCd_index][1023:0] = reduce_min(DACCs1_lo, DACCs1_hi,1024, vm);
    }
    if(stage = 2) {
        VACCs1_lo = OACC[i][VACCs1_index][511:0];
        VACCs1_hi = OACC[i][VACCs1_index][1023:512];
        OACCd[i][VACCd_index][511:0] = reduce_max(VACCs1_lo, VACCs1_hi, 512, vm);
    }
    if(stage = 3) {
        VACCs1_lo = OACC[i][VACCs1_index][511:0];
        if (bcast == 0) {
            OACCd[i][VACCd_index][2^(3+dwidth):0] = reduce_min_scalar(VACCs1_lo, 512, vm);
        } else {
            int elem_nums = 4096 / data_width;
            for (int e = 0; e < elem_nums; e++) {
                OACCd[i][VACCd_index][e] = reduce_min_scalar(VACCs1_lo, 512, vm);
            }
        }
    }
}
VACC reduce_min(VACC operand1, VACC operand2, int N, bool vm) {
    int elem_nums = N / data_width;
    VACC result;
    for (int e = 0; e < elem_nums; e++) {
        result[e] = min(operand1[e], operand2[e]);
    }
    return result
}
VACC reduce_min_scalar(VACC operand1, int N, bool vm) {
    int elem_nums = N / data_width;
    bits(2^(3+dwidth)) result;
    for (int e = 0; e < elem_nums; e++) {
        result = min(operand1[e], result);
    }
    return result
}
```

部分指令域说明：

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| UINT16 | dtype == 0 && dwidth == 1 |
| INT16 | dtype == 1 && dwidth == 1 |
| UINT32 | dtype == 0 && dwidth == 2 |
| INT32 | dtype == 1 && dwidth == 2 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT* + {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 将VACC[VPT] [VACCs1_index]至 VACC[VPT] [VACCs1_index + 3] 的元素记作QACCs1；VACC[VPT] [VACCs1_index + 4] 至 VACC[VPT] [VACCs1_index + 7] 记作QACCs2；
  - 将VACC[VPT] [VACCs1_index]至 VACC[VPT] [VACCs1_index + 1] 的元素记作DACCs1；VACC[VPT] [VACCs1_index + 2] 至 VACC[VPT] [VACCs1_index + 3] 记作DACCs2
  - 将VACC[VPT] [VACCs1_index]的元素记作VACCs1；VACC[VPT] [VACCs1_index + 1] 记作VACCs2
  - 将VACC[VPT] [VACCd_index]至 VACC[VPT] [VACCd_index + 3] 的元素记作QACCd1；VACC[VPT] [VACCd_index + 4] 至 VACC[VPT] [VACCd_index + 7] 记作QACCd2
  - 将VACC[VPT] [VACCd_index]至 VACC[VPT] [VACCd_index + 1] 的元素记作DACCd1；VACC[VPT] [VACCd_index + 2] 至 VACC[VPT] [VACCd_index + 3] 记作DACCd2
  - 将VACC[VPT] [VACCd_index]的元素记作VACCd1；VACC[VPT] [VACCs1_index + 1] 记作VACCd2
- `stage`
  - 0 ： 将QACCs1 的元素分别与QACCs2的元素进行求min操作，结果回写至QACCd1中，QACCd2保持原值
  - 1 ： 将DACCs1 的元素分别与DACCs2的元素进行求min操作，结果回写至DACCd1中，DACCd2保持原值
  - 2 ： 将VACCs1 的元素分别与VACCs2的元素进行求min操作，结果回写至VACCd1中，VACCd2保持原值
  - 3： 将VACCs1 的元素做Reduction Max操作，根据bcast域对结果进行回写。
  - 当stage == 3时：源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
- `bcast`
  - 0 ：在stage==3时，将结果回写至OACCd最低元素位，其余datalane回写为0
  - 1 ：在stage==3时，将结果回写至OACCd所有datalane中
- `nan_mode`
  - stage != 3:
    - 当nan_mode为0时：如果相比较的两个操作数为浮点格式，且待比较元素中有NaN，则结果选择本ISA规定的标准NaN输出。请见NaN Result章节。
    - 当nan_mode为1时：如果相比较的两个操作数为浮点格式，且待比较元素只有一个NaN，则结果选择非NaN数值。如果两个都是NaN，则结果选择本ISA规定的标准NaN输出。
  - stage == 3：
    - 当nan_mode为0时：如果VACCs1元素为浮点格式，且待比较元素中有NaN，则结果选择本ISA规定的标准NaN输出。请见 NaN Result章节。
    - 当nan_mode为1时：如果VACCs1元素为浮点格式，元素并不全是NaN，则结果选择非NaN数值的比较结果。如果待比较元素全都是NaN，则结果选择本ISA规定的标准NaN输出。

**Implicit Use:**

- `TCTL`
- `VAB_VPT*`
- `MODE_WRK.denormal_flush`

### 8.8.94. REDSUM (new in 4.0)

```text
Name    Combo Name  47--44    43--42  41   40   39--38  37--36  35--26  25--17  16     15--6  5--2    1        0
REDSUM  M.REDSUM    sub-code  dwidth  N/A  LCE  dtype   stage   OACCs1  N/A     bcast  OACCd  opcode  Const_0  MCE
```

```text
Name    Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
REDSUM  M.REDSUM    MALU                                    1
```

REDSUM OACCd, OACCs1

ISA4.0新增指令，通过stage域控制将OACCs1中的不同区间的元素做Reduce Sum操作。指令不支持VL。对于整型加法，如果发生溢出，则保留LSB部分，不做saturation。但是对于BF16/FP16结果，会根据MODE_WRK的FP16_OVCLP和BF16_OVCLP域进行clamp操作。

SIP4.0实现该指令的方式为:stage不为3时，复用1D计算单元。stage为3时复用2D计算单元。在此背景下，ISA4.0支持该指令有如下限制：

- 只支持2D计算指令支持的数据类型包括：INT8、UINT8、FP16、FP32、BF16数据格式；
- 计算结果若为正0或负0，都写回成正0
ISA4.0中，该指令暂不支持根据条件参与运算，表示为固定vm=1。

```text
vm = 1; //ISA4.0中，该指令暂不支持根据条件参与运算，表示为固定vm=1。
for i = 0...VPT_NUM-1 {
    if(stage = 0) {
        QACCs1_lo = OACC[i][VACCs1_index][2047:0];
        QACCs1_hi = OACC[i][VACCs1_index][4095:2048];
        OACCd[i][VACCd_index][2047:0] = reduce_sum(QACCs1_lo, QACCs1_hi,2048, vm);
    }
    if(stage = 1) {
        DACCs1_lo = OACC[i][VACCs1_index][1023:0];
        DACCs1_hi = OACC[i][VACCs1_index][2047:1024];
        OACCd[i][VACCd_index][1023:0] = reduce_sum(DACCs1_lo, DACCs1_hi,1024, vm);
    }
    if(stage = 2) {
        VACCs1_lo = OACC[i][VACCs1_index][511:0];
        VACCs1_hi = OACC[i][VACCs1_index][1023:512];
        OACCd[i][VACCd_index][511:0] = reduce_sum(VACCs1_lo, VACCs1_hi, 512, vm);
    }
    if(stage = 3) {
        VACCs1_lo = OACC[i][VACCs1_index][511:0];
        if (bcast == 0) {
            OACCd[i][VACCd_index][2^(3+dwidth):0] = reduce_sum_scalar(VACCs1_lo, 512, vm);
        } else {
            int elem_nums = 4096 / data_width;
            for (int e = 0; e < elem_nums; e++) {
                OACCd[i][VACCd_index][e] = reduce_sum_scalar(VACCs1_lo, 512, vm);
            }
        }
    }
}
VACC reduce_sum(VACC operand1, VACC operand2, int N, bool vm) {
    int elem_nums = N / data_width;
    VACC result;
    for (int e = 0; e < elem_nums; e++) {
        result[e] = operand1[e] + operand2[e];
    }
    return result
}
VACC reduce_sum_scalar(VACC operand1, int N, bool vm) {
    int elem_nums = N / data_width;
    bits(2^(3+dwidth)) result;
    for (int e = 0; e < elem_nums; e++) {
        result = operand1[e] + result;
    }
    return result
}
```

部分指令域说明：

- dwidth & dtype
  - 请见Common MALU Data Type
  - 对于本指令，合法的dwidth & dtype组合为

| Data type | dtype & dwidth input |
| --- | --- |
| UINT8 | dtype == 0 && dwidth == 0 |
| INT8 | dtype == 1 && dwidth == 0 |
| FP16 | dtype == 2 && dwidth == 1 |
| BF16 | dtype == 3 && dwidth == 1 |
| FP32 | dtype == 2 && dwidth == 2 |
| Other: Reserved | Other: Reserved |

- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT* + {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3 将VACC[VPT] [VACCs1_index]至 VACC[VPT] [VACCs1_index + 3] 的元素记作QACCs1；VACC[VPT] [VACCs1_index + 4] 至 VACC[VPT] [VACCs1_index + 7] 记作QACCs2；
  - 将VACC[VPT] [VACCs1_index]至 VACC[VPT] [VACCs1_index + 1] 的元素记作DACCs1；VACC[VPT] [VACCs1_index + 2] 至 VACC[VPT] [VACCs1_index + 3] 记作DACCs2
  - 将VACC[VPT] [VACCs1_index]的元素记作VACCs1；VACC[VPT] [VACCs1_index + 1] 记作VACCs2
  - 将VACC[VPT] [VACCd_index]至 VACC[VPT] [VACCd_index + 3] 的元素记作QACCd1；VACC[VPT] [VACCd_index + 4] 至 VACC[VPT] [VACCd_index + 7] 记作QACCd2
  - 将VACC[VPT] [VACCd_index]至 VACC[VPT] [VACCd_index + 1] 的元素记作DACCd1；VACC[VPT] [VACCd_index + 2] 至 VACC[VPT] [VACCd_index + 3] 记作DACCd2
  - 将VACC[VPT] [VACCd_index]的元素记作VACCd1；VACC[VPT] [VACCs1_index + 1] 记作VACCd2
- `stage`
  - 0 ： 将QACCs1 的元素分别与QACCs2的元素进行求和操作，结果回写至QACCd1中，QACCd2保持原值
  - 1 ： 将DACCs1 的元素分别与DACCs2的元素进行求和操作，结果回写至DACCd1中，DACCd2保持原值
  - 2 ： 将VACCs1 的元素分别与VACCs2的元素进行求和操作，结果回写至VACCd1中，VACCd2保持原值
  - 3： 将VACCs1 的元素做Reduction Sum操作，根据bcast域对结果进行回写。
  - 当stage == 3时：源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
    - OACCs1/OACCd不能为0
- `bcast`
  - 0 ：在stage==3时，将结果回写至OACCd最低元素位，其余datalane回写为0
  - 1 ：在stage==3时，将结果回写至OACCd所有datalane中

**Implicit Use:**

- `TCTL`
- `VAB_VPT*`
- `MODE_WRK.denormal_flush`
- `MODE_WRK.rounding`
- `MODE_WRK.fp16_ovclp`
- `MODE_WRK.bf16_ovclp`

### 8.8.95. NOP48

```text
Name   Combo Name  47--41  40   39--6  5--2    1        0
NOP48  M.NOP48     N/A     LCE  N/A    opcode  Const_0  MCE
```

```text
Name   Combo Name  Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
NOP48  M.NOP48     MALU                                    1
```

No operation.

### 8.8.96. Sorting Architecture

- 从Pavo/Dorado到Scorpio，SIP的全排序能力相比目标有数量级的差别。经调研业界正在使用基于多bit基数排序的算法。
- 基于性能需求，LibraISA新增对基数排序的支持，同时简化掉VCMPAC指令。
  - 单bit基数排序：使用MOP.MIOTA 、POPC_MB、MLI_VSTXOA等指令支持。
  - 多bit基数排序：基于硬件加速的多bit基数排序，新增专用硬件加速单元及相应指令，以期望实现接近或者达到目标性能。

#### 8.8.96.1. 基数排序（Radix Sort）

基数排序(Radix Sort)，是一种非比较型排序算法。主要思想是，对数据的每一位分别进行排序。基数排序是稳定排序。

- 单bit基数排序：主要思想为按照从高位到低位或者低位到高位的顺序对数据的每一bit进行排序，每一轮把为0的数据排在一起，为1的数据的排在一起。算法复杂度为O(wn)，n为待排序数组长度，w为数组中数据的最大位宽。
- 多bit基数排序：相比单bit基数排序，每轮排序bit数为x，x>1。算法复杂度为O( (w/x) * n)。

![Figure 8](libra_sip_isa__figure_008.png)

##### 8.8.96.1.1. 单bit基数排序

###### 8.8.96.1.1.1. 单bit基数排序在SIP4.0的实现

- LibraISA中，可以通过MOP.MIOTA 、POPC_MB、MLI_VSTXOA等指令实现单bit基数排序。

##### 8.8.96.1.2. 多bit基数排序算法介绍

###### 8.8.96.1.2.1. 大规模数据量全排序算法—多SIP并行排序

- 当待排序数据规模较大时，可以利用多SIP并行的方式，对待排序数据进行排序。
  - 待排序数据总量为：E
  - 待排序数据类型位宽为：W
  - SIP个数为：S
  - 每个SIP处理的数据量为n = E/S
  - 每次排序位宽：M
  - 排序基数个数：2^M
  - 注：后续图示中取值为：【E=20】【W=4】【S=5】【n=20/5=4】【M=2】【2^M=4】

###### 基于多SIP并行的多bit基数排序基本流程

- 根据待排序数据位宽W，以及每次排序位宽M，确认排序轮次数 K = W/M。每一轮排序流程如下：

**STAGE1：**

- 各SIP对本SIP内n个待排数据的进行基数直方图统计，n个待排数据每个元素只读取M位作为输入，统计n个待排数据2^M个基数的分布。

![Figure 9](libra_sip_isa__figure_009.png)

![Figure 10](libra_sip_isa__figure_010.png)

  - 图示a表示：第一轮排序时，每个sip对本sip内待排元素的低2bit进行排序（图示用例每轮排序位宽为2bit，需要排序两轮）
  - 图示b表示：由于每次排序位宽M=2, 所以基数个数为4个，分别是[00,01,10,11]；各SIP统计待排序元素低2bit对应的基数个数。

**STAGE2：**

- 同步各SIP所有待排数据的基数直方图，计算每个SIP各基数的起始偏移

![Figure 11](libra_sip_isa__figure_011.png)

  - 图示c表示：将图示b中各sip统计的基数在L3进行汇总记为BlockSum
  - 图示d表示：对BlockSum进行前序和统计得到PreFix-BlockSum
  - 图示e表示：根据PreFix-BlockSum，计算每个SIP对应的NewBase，含义如下
    - 从base00的视角来看
      - sip1的new base00为0；表示sip1中基数为00的元素对应的偏移是0
      - sip2的new base00为1；表示sip2中基数为00的元素对应的偏移是1，因为sip1中基数为00的元素有1个
      - sip3的new base00为3；表示sip3中基数为00的元素对应的偏移是3，因为sip2中基数为00的元素有2个
      - sip4的new base00为3；表示sip4中基数为00的元素对应的偏移是3，因为sip3中基数为00的元素有0个
      - sip5的new base00为4；表示sip5中基数为00的元素对应的偏移是3，因为sip4中基数为00的元素有1个
    - 从基数为01的视角来看，五个SIP中数据基数为00的共有6个，所以sip1的base01对应的偏移为6，其他情况依次类推。
    - 由此可理解，NewBase表示各个sip中每个基数对应的第一个元素在所有sip的待排序总序列中的偏移。

**STAGE3：**

- 每个SIP根据各待排序列元素，以及newbase，计算每个元素新的位置，即在内存中偏移。并按照新的位置保存至内存中，完成一轮数据排序。

![Figure 12](libra_sip_isa__figure_012.png)

![Figure 13](libra_sip_isa__figure_013.png)

  - 图示f表示：根据待排序列a和newbase，每个sip独立计算各sip内待排数据在内存中新的offset
  - 图示g表示：根据新的offset，每个sip将各sip内元素，Scatter Store至L3中。完成一轮数据排序。

**STAGE4：**

- 重复STAGE1-STAGE3的操作，进行下一轮排序。

![Figure 14](libra_sip_isa__figure_014.png)

###### 8.8.96.1.2.2. 小规模数据量全排序算法—单SIP独立排序

- 当待排序数据规模较小时，比如L1能存储所有待排数据及Index的情况下。可以在单SIP内完成排序。排序流程与大规模数据量全排序的方式类似。差别是STAGE2不需要在多SIP之间进行同步。

##### 8.8.96.1.3. 多bit基数排序硬件加速单元（DSA）

- 为了支持多SIP并行的多bit基数排序算法，SIP4.0引入了基于硬件加速的多bit基数排序，包括专用硬件加速单元：特点为：
  - 每周期固定处理32个32bit UINT元素
  - 该算法每一轮排序的bit数为5bit
  - 不支持多个VPT
  - 只能在单线程编程模型下执行
- 多bit硬件加速单元基本结构和参数
  - N = 5：每一轮排序的bit数为5bit
    - 基数个数M = 2^N = 32
  - 排序元素的位宽：固定认为UINT32
- 加速器的基本结构包括：
  - BASE寄存器：位宽32bit，数量与基数个数有关，即为M=32个。

```text
#define M 32
int BASE[M]
```

- 加速器的接口包括：
  - 32 x 32bit的vector运算数据输入接口
    - BASE寄存器初始化复用这个接口
      - MRADIX_W_BASE OACCs1
    - 输入数据并运算
      - MRADIX_CNTBASE OACCs1, shift
      - MRADIX_OFFSET OACCd, OACCs1, shift
      - MRADIX_STXOA Rs1, OACCs1,shift
  - shift输入接口
    - 只有运算时起作用
    - shift为3bit
  - Store接口
    - MRADIX_STXOA Rs1, OACCs1,shift
  - BASE寄存器输出接口
    - MRADIX_R_BASE OACCd
  - 其他必要控制信号

##### 8.8.96.1.4. 如何基于DSA实现多SIP并行的多bit基数排序

###### 8.8.96.1.4.1. 数据预处理 & 恢复处理

多bit基数排序硬件加速单元支持处理的数据类型为UINT32。对于其他数据类型，需要在算法层面进行一些预处理，处理思路如下：

- 多bit基数排序硬件加速单元暂时不支持对64-bit数据类型的数据进行排序。
- 步骤一：数据预处理
  - FP8 : bitcast(FP8) ------> UINT8 ------> zero_ext(UINT8)------> UINT32 ------>作为DSA的输入
  - INT8 : bitcast(INT8) ------> UINT8 ------> zero_ext(UINT8)------> UINT32 ------>作为DSA的输入 FP16 : bitcast(FP16) ------> UINT16 ------> zero_ext(UINT16)------> UINT32 ------>作为DSA的输入
  - BF16 : bitcast(BF16) ------> UINT16 ------> zero_ext(UINT16)------> UINT32 ------>作为DSA的输入
  - INT16 : bitcast(INT16) ------> UINT16 ------> zero_ext(UINT16)------> UINT32 ------>作为DSA的输入
  - FP32: bitcast(FP32) ------> UINT32 ------>作为DSA的输入
  - INT32: bitcast(INT32) ------> UINT32 ------>作为DSA的输入
- 步骤二：DSA排序
- 步骤三：数据恢复处理
  - FP8 : truncate(高24位为0,低8位有效的UINT32) ------> UINT8 ------> bitcast(UINT8) ------> FP8 ------>最终排序结果
  - INT8 : truncate(高24位为0,低8位有效的UINT32) ------> UINT8 ------> bitcast(UINT8) ------> INT8 ------>最终排序结果
  - FP16 : truncate(高16位为0,低16位有效的UINT32) ------> UINT8 ------> bitcast(UINT8) ------> FP16 ------>最终排序结果
  - BF16 : truncate(高16位为0,低16位有效的UINT32) ------> UINT8 ------> bitcast(UINT8) ------> BF16 ------>最终排序结果
  - INT16 : truncate(高16位为0,低16位有效的UINT32) ------> UINT8 ------> bitcast(UINT8) ------> INT16------>最终排序结果
  - FP32: bitcast(UINT32) ------> FP32 ------>最终排序结果
  - INT32: bitcast(UINT32) ------> INT32 ------>最终排序结果

###### 8.8.96.1.4.2. 排序轮数计算

对于N个数据的全排序，对于UINT32数据类型，单bit基数排序算法需要排序32轮。多bit基数排序硬件加速单元支持基数的位数是5bit。

- 对于32bit数据类型的排序，需要排序7轮。处理最后一轮，待排序的有效数据为2-bit，DSA会将高3-bit固定为0进行处理。
- 对于非32bit数据类型的排序，高位在数据预处理阶段会做0扩展，因此对于非32bit可以在编程层面减少排序轮数。
  - 对于8-bit位宽数据类型：需要排序2轮
  - 对于16-bit位宽数据类型：需要排序4轮

###### 8.8.96.1.4.3. 基于ISA的具体实现

对于#基于多SIP并行的多bit基数排序基本流程，多bit基数排序硬件加速单元实现方式如下：

- STAGE1：各SIP进行基数直方图统计
  - 通过DTE，将一个大的待排序数组分拆为若干份，送入每个SIP的L1中。
  - 每个SIP通过MRADIX_W_BASE指令对DSA中BASE寄存器进行初始化，初始值为0。
  - 每个SIP扫描自己分到的序列，依次使用vector load指令加载到OACC中，通过MRADIX_CNTBASE指令送入加速单元，同时进行基数直方图统计
    - 直方图统计结果在BASE寄存器中进行累加
  - 扫描结束，每个SIP通过MRADIX_R_BASE指令，从BASE中读取前需扫描结果到OACC中，再使用atomicAdd指令写入L3。
- STAGE2：多SIP基数直方图同步
  - 所有SIP同步各自BASE寄存器，求取基数前缀和
  - 所有SIP读取各SIP BASE前缀和结果，通过MRADIX_W_BASE指令回写到各加速单元的BASE寄存器中。
- STAGE3：各SIP计算待排序数据新位置偏移 + 回写memory
  - 各SIP再次从L1读取分到的待排序序列，使用vector load指令加载到OACC中，通过MRADIX_OFFSET指令送入加速单元，计算当前每个元素的回写L3的地址偏移，输出到OACC‘中。
  - 执行scatter-store指令，利用OACC‘作为scatterstore指令的offset，回写到内存中。
  - 上述两个过程可以通过MRADIX_STXOA指令加速：即使用vector load指令加载到OACC中，通过MRADIX_STXOA指令送入加速单元，计算当前每个元素的回写L3的地址偏移，直接回到写内存中。
- STAGE4：根据排序轮次数，决定是否完成排序
- 补充说明
  - `use-case`
    - 每个原始待排序数据会对应1个或n个Index，对数据进行排序的同时，数据与Index的一一对应关系不能发生变化。这种情况下，在STAGE3，需要通过MRADIX_OFFSET指令计算每个元素写回L3的地址偏移，后需要执行多条scatter-store指令，将待排序数据按照地址偏移回写到内存的同时，还要将Index按照同样的地址偏移回写到内存。这种情况不能使用 MRADIX_STXOA指令加速。
  - 性能优化
    - 在STAGE3，若使用MRADIX_OFFSET + scatter-store指令，从性能角度考虑，建议计算多个OFFSET之后，再使用多条 scatter-store指令进行回写，即做循环展开处理。

### 8.8.97. MRADIX_W_BASE (new in 4.0)

```text
Name           Combo Name       47--44    43--41  40   39--36  35--26  25--6  5--2    1        0
MRADIX_W_BASE  M.MRADIX_W_BASE  sub-code  N/A     LCE  N/A     OACCs1  N/A    opcode  Const_0  MCE
```

```text
Name           Combo Name       Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MRADIX_W_BASE  M.MRADIX_W_BASE  MALU                                    1
```

MRADIX_W_BASE OACCs1

ISA4.0新增指令，将OACC寄存器中低M个32bit元素MOV至Sorting加速器的M个BASE寄存器中。指令不受到VL影响

```text
for (int m = 0; m < M; m++) {
    BASE[m] = OACCs1[0][OACCs1_index][m];
}
```

部分功能位域说明：

- `OACCs1`
  - VACCs1_index = VAB_VPT* + {OACCs1 + 3'b0}
  - OACCs1_index = VACCs1_index >> 3

**Implicit Use:**

- `VAB_VPT0`

### 8.8.98. MRADIX_R_BASE (new in 4.0)

```text
Name           Combo Name       47--44    43--41  40   39--16  15--6  5--2    1        0
MRADIX_R_BASE  M.MRADIX_R_BASE  sub-code  N/A     LCE  N/A     OACCd  opcode  Const_0  MCE
```

```text
Name           Combo Name       Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MRADIX_R_BASE  M.MRADIX_R_BASE  MALU                                    1
```

MRADIX_R_BASE OACCd

ISA4.0新增指令，将Sorting加速器的M个BASE寄存器的值保存至OACC寄存器中低M个32bit位宽的datalane中；

```text
for (int m = 0; m < M; m++) {
    VACC[0][OACCd_index][m] = BASE[m];
}
```

部分功能位域说明：

- `OACCd`
  - VACCd_index = VAB_VPT0 + {OACC* + 3'b0}
  - OACCd_index = VACCd_index >> 3

**Implicit Use:**

- `VAB_VPT0`

### 8.8.99. MRADIX_CNTBASE (new in 4.0)

```text
Name            Combo Name        47--44    43--42  41  40   39--36  35--26  25--6  5--2    1        0
MRADIX_CNTBASE  M.MRADIX_CNTBASE  sub-code  N/A     vm  LCE  shift   OACCs1  N/A    opcode  Const_0  MCE
```

```text
Name            Combo Name        Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MRADIX_CNTBASE  M.MRADIX_CNTBASE  MALU                                    1
```

MRADIX_CNTBASE OACCs1, shift

ISA4.0新增指令，OACCs1寄存器中32bit位宽元素作为输入，根据指令中的shift域以及硬件支持的基数bit的位数N，每个元素只读取 [N*shift+N-1 : N*shift]部分数据作为基数。计数每个基数对应的元素个数，累加至至加速器中每个基数对应的BASE寄存器中。指令支持VL 语义。

```text
###define N 5
###define M 32
int shift;
int base[M];
int tmp_value[128];
for(int i = 0; i < 128 && i < VL; i ++) {
    tmp_value[i] = (OACC[VPT0][OACCs1_index][i] >> (shift * N)) & (0xFFFFFFFF >> (32-N));
    //取出value[N*shift+N-1 : N*shift]
    if(vm == 1 || mask[i] == 1) {
        base[tmp_value[i]] ++; //根据取出的段对base做加一操作
    }
}
```

部分功能位域说明：

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT0]中maskbit的前128个bit作为写回条件。当mask[i] = 1时写回；否则VACCd 对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1`
  - VACCs1_index = VAB_VPT0 + {OACC* + 3'b0}
  - OACCs1_index = VACCs1_index >> 3
- `shift`
  - 有效范围为：0-6

**Implicit Use:**

- `VAB_VPT0`
- `VL`

### 8.8.100. MRADIX_OFFSET (new in 4.0)

```text
Name           Combo Name       47--44    43--42  41  40   39--36  35--26  25--16  15--6  5--2    1        0
MRADIX_OFFSET  M.MRADIX_OFFSET  sub-code  N/A     vm  LCE  shift   OACCs1  N/A     OACCd  opcode  Const_0  MCE
```

```text
Name           Combo Name       Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MRADIX_OFFSET  M.MRADIX_OFFSET  MALU                                    1
```

MRADIX_OFFSET OACCd, OACCs1, shift

ISA4.0新增指令，OACCs1寄存器中保存UINT32类型元素，根据指令中的shift域以及硬件支持的基数bit的位数N，每个元素只读取 [N*shift+N-1 : N*shift]部分数据作为基数。计数每个基数对应的元素个数，累加至至加速器中每个基数对应的BASE寄存器中。同时计算每个元素写回内存中的32bit有符号整数作为偏移结果保存在OACCd中。指令支持VL语义。

```text
###define N 5
###define M 32
int shift;
int base[M];
int bias[128];
int tmp_value[128];
for(int i = 0; i < 128 && i < VL; i ++) {
    tmp_value[i] = (OACC[VPT0][OACCs1_index][i] >> (shift * N)) & (0xFFFFFFFF >> (32-N));
    //取出value[N*shift+N-1 : N*shift]
}
for(int i = 0; i < 128 && i < VL; i++) {
    bias[i] = 0;
    if(i == 0) continue;
    for(int j = 0; j < i; j ++) {
        if(tmp_value[j] == tmp_value[i] && (vm == 1 || mask[j] == 1)) {
            bias[i]++; //按照相同的数值做累加操作
        }
    }
}
for(int i = 0; i < 128 && i < VL; i ++) {
    if (vm == 1 || mask[i] == 1) {
        OACC[VPT0][OACCd_index][i] =  4 * (base[tmp_value[i]] + bias[i]); //4表示32bit数据在内存空间中占4byte
    }
}
for(int i = 0; i < 128 && i < VL; i ++) {
    if (vm == 1 || mask[i] == 1) {
        base[tmp_value[i]] ++; //根据取出的段对base做加一操作
    }
}
```

部分功能位域说明：

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT0]中maskbit的前128个bit作为写回条件。当mask[i] = 1时写回；否则VACCd 对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1/OACCd`
  - VACC*_index = VAB_VPT*+ {OACC* + 3'b0}
  - OACC*_index = VACC*_index >> 3
  - 源操作数和目的操作数不能互相覆盖
    - OACCs1和OACCd不能互相覆盖
  - 如果vm=0，则OACCd不能为0
- `shift`
  - 有效范围为：0-6

**Implicit Use:**

- `VAB_VPT0`
- `VL`

### 8.8.101. MRADIX_STXOA (new in 4.0)

```text
Name          Combo Name      47--44    43--42  41  40   39--36  35--26  25--21  20--16  15--6  5--2    1        0
MRADIX_STXOA  M.MRADIX_STXOA  sub-code  N/A     vm  LCE  shift   OACCs1  N/A     Rs1     N/A    opcode  Const_0  MCE
```

```text
Name          Combo Name      Type  C Slot  S1 Slot  S0 Slot  L Slot  M Slot  V Slot  MLI Slot
MRADIX_STXOA  M.MRADIX_STXOA  MALU                                    1
```

MRADIX_STXOA Rs1, OACCs1,shift

ISA4.0新增指令，OACCs1寄存器中保存UINT32类型元素，根据指令中的shift域以及硬件支持的基数bit的位数N，每个元素只读取 [N*shift+N-1 : N*shift]部分数据作为基数。计数每个基数对应的元素个数，累加至加速器中每个基数对应的BASE寄存器中。同时计算每个元素写回内存中的32bit有符号偏移，结合Rs1指定的起始地址，回写至memory中。指令支持VL语义。

```text
###define N 5
###define M 32
int shift;
int base[M];
int bias[128];
int tmp_value[128];
int offset[128];
for(int i = 0; i < 128 && i < VL; i ++) {
    tmp_value[i] = (OACC[VPT0][OACCs1_index][i] >> (shift * N)) & (0xFFFFFFFF >> (32-N));
    //取出value[N*shift+N-1 : N*shift]
}
for(int i = 0; i < 128 && i < VL; i++) {
    bias[i] = 0;
    if(i == 0) continue;
    for(int j = 0; j < i; j ++) {
        if(tmp_value[j] == tmp_value[i] && (vm == 1 || mask[j] == 1)) {
            bias[i]++; //按照相同的数值做累加操作
        }
    }
}
for(int i = 0; i < 128 && i < VL; i ++) {
    offset[i] =  4 * (base[tmp_value[i]] + bias[i]); //4表示32bit数据在内存空间中占4byte
}
for(int i = 0; i < 128 && i < VL; i ++) {
    if (vm == 1 || mask[i] == 1) {
        base[tmp_value[i]] ++; //根据取出的段对base做加一操作
    }
}
for (int i = 0; i < 128 && i < VL; i++) {
    vector_scatter_store(address, offset[i], OACCs1, vm);
}
```

部分功能位域说明：

- `vm`
  - vm = 0时，元素按条件写回，采用VACC[0+VAB_VPT0]中maskbit的前128个bit作为写回条件。当mask[i] = 1时写回；否则VACCd 对应位置保持不变
  - vm = 1时，非条件写回
- `OACCs1`
  - VACCs1_index = VAB_VPT* + {OACCs1 + 3'b0}
  - OACCs1_index = VACCs1_index >> 3

**Implicit Use:**

- `VAB_VPT0`
- `VL`
- `ESL_DTYPE`

# 9. Memory Model

此处引用LIbra SIP Arch Spec的Memory Consistency模型

## 9.1. Memroy Consistency

访存的Consistency问题由硬件进行管理。SIP的访存单元负责保证对于同一个地址访问的RAW、WAR以及WAW不会乱序。这里的W包括 non-atomic write和atomic write。VDMEM Mirror空间是一个特例，它只维护WAW hazard。

从指令的角度：

# 1. 任意两个SW-thread之间不保证地址consistency。

# 2. 同一个SW-thread中，VPT0和VPT1的向量load/store之间不保证地址consistency。

# 3. 同一个SW-thread中，不同的memory属性之间不保证地址consistency

# 4. 同一个SW-thread中，同一memory属性下不同memory地址之间的load/non-atomic store/atomic store不保证consistency

# 5. 同一个SW-thread中，如果地址相同，则scalar指令分别和vector指令的VPT0部分以及VPT1部分各自维护consistency

# 6. 同一个指令包当中的load/store和store/store之间，即使出现地址重叠，也不维护consistency

# 7. 同一个指令中，如果多个元素的store之间出现地址重叠，也补维护consistency

从L1/L2/L3 memory的角度：

- 对于同一软件线程同一个地址的连续load请求可以连续发送，对同一个地址的连续store请求可以连续发送；
- 同一软件线程同地址下，store请求必须等到load请求返回之后才能发送；
  - 这一点由硬件中负责load/store的单元保证
- 同一软件线程同地址下，load请求必须等到store请求返回之后才能发送；
  - 这一点由硬件中负责load/store的单元保证
- 同一软件线程同地址下，non-atomic store和atomic store之间，必须等到指令顺序在前访问的response返回之后才能发送
  - 这一点由硬件中负责load/store的单元保证
- 不同地址的load/non-atomic store/atomic store可以乱序，不需要遵循指令顺序。
- 对于L1 memory的RO & WO区域的访问，是不保证RAW和WAR hazard的。需要通过fence对齐
从总线的视角，

- 对于同一软件线程同一个地址的连续load请求可以连续发送；
- 同一软件线程同地址下，store请求必须等到load请求返回之后才能发送；
  - 这一点由硬件中负责load/store的单元保证
- 同一软件线程同地址下，load请求必须等到store请求返回之后才能发送；
  - 这一点由硬件中负责load/store的单元保证
- 同一软件线程同地址下，atomic指令被视作略微特殊的store指令，并且和正常的store指令维护consistency
  - 即相同地址的normal store和atomic store指令，使用相同的AWID，由总线进行保续
- 同一软件线程同地址下，store请求同样需要等待store请求返回之后才能发送，因为store会被赋予不同的AXI索引，NoC不能保证其顺序。
  - 这一点由硬件中负责load/store的单元保证
- 不同地址的load/non-atomic store/atomic store可以乱序，不一定遵循指令顺序。

## 9.2. IO Consistency

对IO空间访问的consistency问题，同样由硬件进行管理。SIP访存单元的访问模型如下：

- 两个SW-thread之间不保证地址consistency
- 同一个SW-thread，对于不同的slave IP所包含的IO区域，不保证consistency
- 同一个SW-thread，对于相同slave IP所包含的IO区域，一定保证对寄存器的访问，访问顺序和指令顺序相同
  - 即使访问同一个slave IP中不同寄存器地址，也会保证所有读和写操作的顺序一致性
- Slave IP包含的IO区域，请参加Arch Spec中的相关章节无论是否为同一个SW-thread，IO访问和Memory访问之间，不维护consistency

# 10. Exception & Interrupt

关于异常和中断，请见Libra SIP Arch Spec的对应章节。

# 11. Instruction Encoding

Each slot's instruction encoding is independent from each other. See detailed encoding in ISA table [Crystal Instruction 4.0][2].

Please see detailed per instruction description.

## 11.1. Pseudo Instruction Encoding

下列为伪指令，采用其他指令的特定编码方式实现

```text
Pesudo Instruction       Base Instruction                  Instruction Type  Meaning
L.MOV Rd, Rs1            L.ORX Rd, Rs1,sr0                 SLDST             SR数值复制指令
V.RED.add (rs1), rs2     V.AMO.add sr0, (rs1), rs2         SLDST             Memory原子操作指令，对MEM(Rs1)累加Rs2 数值
V.RED.and (rs1), rs2     V.AMO.and sr0, (rs1), rs2         SLDST             Memory原子操作指令，对MEM(Rs1)和Rs2数值进行与操作
V.RED.or (rs1), rs2      V.AMO.or sr0, (rs1), rs2          SLDST             Memory原子操作指令，对MEM(Rs1)和Rs2数值进行与操作
V.RED.xor (rs1), rs2     V.AMO.xor sr0, (rs1), rs2         SLDST             Memory原子操作指令，对MEM(Rs1)和Rs2数值进行与操作
V.RED.max (rs1), rs2     V.AMO.max sr0, (rs1), rs2         SLDST             Memory原子操作指令，对MEM(Rs1)和Rs2数值取最大值并写回MEM(Rs1)
V.RED.min (rs1), rs2     V.AMO.min sr0, (rs1), rs2         SLDST             Memory原子操作指令，对MEM(Rs1)和Rs2数值取最小值并写回MEM(Rs1)
V.RED.inc (rs1)          V.AMO.inc sr0, (rs1)              SLDST             Memory原子操作指令，对MEM(Rs1)累加立即数1
V.RED.dec (rs1)          V.AMO.dec sr0, (rs1)              SLDST             Memory原子操作指令，对MEM(Rs1)减去立即数1
M.MOP.MCLR VACCd         M.M.MOP.MXOR VACCd,VACCd, VACCd   MALU              Maskbit全部清0指令
M.MOP.MSET VACCd         M.MOP.MXNOR VACCd,VACCd, VACCd    MALU              Maskbit全部设1指令
M.MOP.MMOV VACCd,VACCs1  M.MOP.MAND VACCd,VACCs1, VACCs1   MALU              Maskbit复制指令
M.MOP.MNOT VACCd,VACCs1  M.MOP.MNAND VACCd,VACCs1, VACCs1  MALU              Maskbit取反复制指令
```

## 11.2. Immediate Number Encoding

部分指令编码中，需要用多段较短的Imm立即数域拼接成一个较长的逻辑立即数。该拼接遵循如下规则：

- 对于非C-slot的指令，拼接方法遵循“在指令编码中位置较高的立即数域被拼接到逻辑立即数较高的位置”这一规则
- 如果是C-slot指令，请仔细阅读对应指令的具体说明

# 12. Appendix B: Instruction Packaging Constraint

## 12.1. 固定打包限制

- MLI Type指令必须总是与C-slot的MLI_HINT或MLI_HINT_GEMM指令一同打包。
- 以下MLI指令必须与C.MLI_HINT固定打包:
  - `MLI_VLDXOA`
  - `MLI_VSTXOA`
  - `MLI_VLDXI32OA`
  - `MLI_VSTXI32OA`
- 以下MLI指令必须与C.MLI_HINT_GEMM固定打包:
  - `MLI_GEMM`

## 12.2. 单独打包限制

- 以下指令只能和NOP指令打包
  - `IDMA`
  - `ITAGOP`
  - `TRAP0`
  - `TRAP1`
  - `ERET`
  - `SCHED/SCHED_I`
  - `HALT`
  - `WAIT/WAIT_I`
  - `MOVS.BARRIER`
  - `L0P5_INV`
  - MOVSR2SPR MODE_WRK
    - 这是从ISA3.2上传递下来的情况
  - 所有跳转指令
    - `BX.unsigned`
    - `BX.signed`
          - 跳转指令能少用就少用
    - `B.unsigned`
    - `B.signed`
          - 单个subthread执行标量操作的话，发挥不出完整的性能
    - `JIL`
    - `JI`
    - `JALR`
    - `JAL`

## 12.3. 关于Register Hazard的打包限制

### 12.3.1. 关于SR/TAR/OACC Hazard的打包限制

- VLIW指令打包中禁止除了特例之外的寄存器WAR/WAW/RAW打包:
  - WAR/RAW指一个指令包中有不同的指令同时写和读同一个/组寄存器（即禁止WAR/RAW）
  - WAW指一个指令包中有大于一条指令同时写同一个/组寄存器（即禁止WAW）
  - 同一条指令对一个寄存器即读又写不包含在该约束内
- 寄存器包括SR/TAR/OACC
  - 遵从上述规则的向量寄存器最小粒度为OACC。禁止同一个指令包中两个不同slot的指令访问同一个OACC的不同VACC部分。
  - 部分指令访问的OACC寄存器可能不止一个OACC，比如一些混精指令输入是4个OACC；比如GEMM系列指令操作更多OACC。此时指令访问的每个OACC寄存器都应该保持上述约束。
- 指令包中对于VACC寄存器的RAW/WAW/WAR Hazard检查颗粒度需要转换为OACC为单位来检查
  - 例如，L.MOVVA VACC2, VACC1 + M.MOVSFT VACC4, VACC5，这两条指令之间也被视为互相有RAW/WAW hazard存在，因为这些寄存器都属于OACC0
- 指令打包在静态编译期，不应该考虑动态行为，例如：
  - 比如一个混精指令，输入一个OACC0，输出OACC1和OACC2。比如VL控制只使能写回OACC1。此时其他slot指令也不能访问 OACC2。因为编译器不感知VL在运行中的取值。
  - 这里要特别注意MB_PUSH和MB_POP指令，这两条指令访问的VACC Index由SPR MB_STACK决定，是动态值。因此该指令不能和访问VACC或OACC的任何指令打包。
- OACC允许WAR打包特例：maskbit
  - 允许M-slot/V-slot的将VA0作为maskbit条件执行的指令以及L-slot的MOVVA指令写VA0指令一同打包
    - 例如L.MOVVA VA0, VA3 + M.VLDOA.vm OACC4, [SR1]
    - 允许的指令打包形式如下：
      - L.MOVVA (VACCd=0) + M Slot指令 (vm=0)；
      - L.MOVVA (VACCd=0) + V Slot指令 (vm=0)；
  - 上述特例，在一个指令包中对同一个寄存器的访问为先读后写

### 12.3.2. 关于SPR Hazard的打包限制

- VLIW指令打包中，除了上述VL特例之外，禁止读写SPR寄存器的指令打包限制如下:
  - 禁止一个指令包中有不同的指令同时写和读同一个SPR寄存器（即禁止WAR/RAW）
  - 禁止一个指令包中有大于一条指令同时写同一个SPR寄存器（即禁止WAW）
  - 同一条指令对一个寄存器即读又写不包含在内
- 请注意：某些SPR寄存器，并不是通过前后指令序列可以来保证RAW/WAW/WAR的，而是依赖L0 fence。参见MOVSR2SPR描述
- SPR允许的WAR打包特例：VL寄存器
  - 允许MOVSR2SPR修改VL寄存器，与受到VL影响的指令一同打包
    - 例如L.MOVSR2SPR SPR_VL, SR1 + M.MOP.ADD OACC3, OACC2, OACC1
  - 允许的指令打包形式如下：
    - L.MOVSR2SPR (SPRd=VL) + M Slot使用VL的指令；
    - L.MOVSR2SPR (SPRd=VL) + V Slot使用VL的指令；
    - L.SETSLICE (SPRd=VL) + M Slot使用VL的指令；
    - L.SETSLICE (SPRd=VL) + V Slot使用VL的指令；
    - L.SETSLICE_I (SPRd=VL) + M Slot使用VL的指令；
    - L.SETSLICE_I (SPRd=VL) + V Slot使用VL的指令；
    - L.SETSLICE_M2V (SPRd=VL) + M Slot使用VL的指令；
    - L.SETSLICE_M2V (SPRd=VL) + V Slot使用VL的指令；
- 上述特例，在一个指令包中对同一个寄存器的访问为先读后写

## 12.4. 关于Memory Hazard 的打包限制

- VLIW指令打包中禁止对某内存地址的Hazard情况:
  - 若一个指令包中同时存在不同Slot的Load指令和Store指令，则禁止不同Slot的Load/Store指令，读/写的内存地址有重叠(即禁止 WAR RAW)
    - 即使两条指令其中之一，或者都带有RO/WO属性，也不允许这样的打包
  - 若一个指令包中同时存在不同Slot的多条Store指令（大于一条），则禁止多条Store指令写地址有重叠(即禁止WAW)
    - 即使两条指令其中之一，或者都带有RO/WO属性，也不允许这样的打包
  - 单指令内Memory Hazard限制：
    - 单指令对一个地址即读又写不包含在上述打包限制内
      - 例如AMO系列指令
    - 对于Gather-Scatter & Strided LDST类指令，每一个有效Element的地址均需要参与Memory Hazard检查
      - 对于Scatter Store 和 Strided Store 指令：
        - 包括：MLI_VSTXOA、MLI_VSTXI32OA、MRADIX_STXOA、VSTEOA
        - 多个有效的Store Element之间，不允许访问相同地址
        - 即对于Strided Store类指令不允许Stride参数为0
        - 即对于Scatter Store类指令不允许有效元素的Offset参数相同
      - 对于Gather Load 和 Strided Load指令：
        - 包括：MLI_VLDXOA、MLI_VLDXI32OA、VLDEOA 多个有效的Load Element之间，允许访问相同地址

## 12.5. 违反指令打包限制的后果

凡是违反了上述指令打包约束的指令包，其执行结果都不可知（可能导致流水线无响应）

# 13. Appendix C: ISA4.0 Compatibility

## 13.1. Overview

ISA4.0是在ISA3.2指令集定义的基础上，通过扩大原指令语义并增加了部分新指令而形成指令集定义。与此同时，ISA4.0也精简了部分ISA3.2 中的指令和寄存器。

## 13.2. Compatibility of Registers

在可编程寄存器上，ISA4.0会对兼容性产生影响的变化包括

```text
寄存器类型  特性变化                              是否对兼容性存在影响
SR          全部扩展为64bit 原ISA3.2中32bit运算指令全部保存  没有影响
SCC         没有变化                              没有影响
VCC         全部删除                              有影响
TAR         全部扩展为64bit 原有指令的语义全部保留  没有影响
IV & VR     没有变化                              没有影响
SMR         指令可访问数量减少到2个               有影响
VACC        指令可访问数量减少到1024个            有影响
SPR         SPR变化较为复杂，请见Libra SIP SPR Spec 下面会对SPR中对兼容性有影响的部分进行描述
CPR         删除                                  有影响
TCTL        TCTL只允许三种配置数值：0x0 0x20000 0x30000  有影响
```

### 13.2.1. SR Bitwidth Compatibility

由于ISA4.0中SR由原来的32bit扩展为64bit，因此原ISA3.2上的32bit程序，如何在ISA4.0上保持语义兼容是一个需要谨慎对待的事情。出于保守考虑，ISA4.0参考了ARM由32bit系统到64bit系统的兼容路线

- ARM指令集在升级为64bit之后，依然保留了32bit的指令，并且32bit指令在写回SR时只保留低32bit，高32bit固定为全0。本ISA选择这条路线
- Risc-V指令集在定义之初就有32bit和64bit两种scalar指令，它们可以在同一个64bit系统中共存。其中32bit指令在写回SR时高32bit固定做符号位扩展。出于谨慎考虑本ISA并不选择这条路线。
作为一个32bit到64bit SR的兼容性设计标准和可验证的判决规则，本ISA将32bit到64bit的兼容性，定义如下：

- 对于任意一段兼容ISA3.2和ISA4.0的程序，在初始条件为"ISA4.0的SR寄存器数值等于ISA3.0的SR寄存器数值高位拼接32bit全0，并且 SCC相等"的情况下，分别在两个ISA系统上执行（忽略它们memory系统的差异），最终执行结果，依然保持"ISA4.0的SR寄存器数值等于ISA3.0的SR寄存器数值高位拼接32bit全0，并且SCC相等"

```text
INIT：
for(int i = 0; i < 32; i ++) {
    SR64[i] = bit_combine(0x0000_0000, SR32[i]);
    SCC64 = SCC32;
}
compatible_foo(SR64);
compatible_foo(SR32);
int check_flag = 0;
for(int i = 0; i < 32; i ++) {
    if(SR64[i] != bit_combine(0x0000_0000, SR32[i])) check_flag ++;
}
if(SCC64 != SCC32) check_flag ++;
if(check_flag == 0) {
    printf("SR64 system is compatible with SR32 system\n");
} else {
    printf("SR64 system is not compatible with SR32 system\n");
}
```

这是一个相对保守和严苛的兼容性判断标准。根据这一标准，对于相关的指令影响如下：

- L-slot的SALU指令，对于会修改SCC的指令以及结果做符号位扩展的指令，需要添加64bit的版本；原始32bit版本的指令予以保留并且回写时高32bit恒定为0
  - 目前只有4个运算指令可以不保留32bit版本，分别为ANDX/ORX/XORX/SEQX
  - 上述4个指令在初始条件满足"ISA4.0的SR寄存器数值等于ISA3.0的SR寄存器数值高位拼接32bit全0，并且SCC相等"，执行结果依然符合这个条件
- S1-slot的SALU指令，由于编码空间的限制，暂未添加64bit的版本。这些指令均保持读取src寄存器低32bit运算，并在写回时强制高 32bit为0的语义
  - 新的Libra算子将很难再利用这些SALU指令
- 对于写回SR的LD/ST指令和MOV类指令，需要考虑在ISA4.0上保证可以实现符号只写回32bit，高32bit强制为0。这些指令包括
  - `MOVVA2R.mode2`
    - 数据回写到SR时，符号为扩展至64bit。
    - 需要高32bit强制为0时，需要配合UZXT指令
  - `LD`
    - 添加了支持符号扩展到64bit的LDX
    - LD只支持符号扩展到32bit，高32bit总是为0
  - `MOVVR2R`
    - 该指令总是保持高32bit为0
  - `MOVTAR2SR.EXT`
    - 添加了range域
  - `MOVS`
    - 该指令语义可以直接扩展到64bit
  - `MOV`
    - 该指令语义可以直接扩展到64bit
  - `LDI16`
    - 该指令结果的高32bit始终保持为0

### 13.2.2. 基于KRT_API的Scorpio到Libra 1D算子兼容性方案

TBD

## 13.3. Compatibility of Instructions

### 13.3.1. Instruction Removal

| Instruction Name | Type | 删除原因 | Review结果 |
| --- | --- | --- | --- |
| V.VADD | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VSUB | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VMUL | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VSLL | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VSR | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VSLLI | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VSRI | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VABS | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VNEG | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VINV | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VAND | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VOR | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VXOR | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VCCINV | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VCCAND | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VCCOR | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VCCXOR | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VSLT | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VSEQ | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VMAX | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VMIN | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VMRGF | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VGETE | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VGETM | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VTRSI2F | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VTRSF2I | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VTRSF2F | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VTRSI2I | VALU | VALU指令，VALU单元移除 | Reviewed |
| V.VSF | VALU | VALU指令，VALU单元移除 RNG功能由新定义M-slot指令替代 |  |
|  |  |  |  |
| L.VLDA | VLDST | VA直接寻址指令，Scorpio时已经约束不使用 | Reviewed |
| L.VLDLA | VLDST | VA直接寻址指令，Scorpio时已经约束不使用 | Reviewed |
| L.VSTA | VLDST | VA直接寻址指令，Scorpio时已经约束不使用 | Reviewed |
| L.VSTLA | VLDST | VA直接寻址指令，Scorpio时已经约束不使用 | Reviewed |
| V.VSTLA | VLDST | VA直接寻址指令，Scorpio时已经约束不使用 | Reviewed |
| V.VSTA | VLDST | VA直接寻址指令，Scorpio时已经约束不使用 | Reviewed |
|  |  |  |  |
|  |  |  |  |
| S1.TIVLD_ISR.tapos0 | VLDST | TAR寻址+SR offset，推测使用机率较小 | Reviewed |
| S1.TIVLD_ISR.tapos1 | VLDST | TAR寻址+SR offset，推测使用机率较小 | Reviewed |
| S1.TVLD_ISR.tapos0 | VLDST | TAR寻址+SR offset，推测使用机率较小 | Reviewed |
| S1.TVLD_ISR.tapos1 | VLDST | TAR寻址+SR offset，推测使用机率较小 | Reviewed |
| S0.TIVLD_ISR.tapos0 | VLDST | TAR寻址+SR offset，推测使用机率较小 | Reviewed |
| S0.TIVLD_ISR.tapos1 | VLDST | TAR寻址+SR offset，推测使用机率较小 | Reviewed |

```text
Instruction Name                      Type   删除原因                              Review结果
S0.TVLD_ISR.tapos0                    VLDST  TAR寻址+SR offset，推测使用机率较小   Reviewed
S0.TVLD_ISR.tapos1                    VLDST  TAR寻址+SR offset，推测使用机率较小   Reviewed
S0.TVST_ISR.tapos0                    VLDST  TAR寻址+SR offset，推测使用机率较小   Reviewed
S0.TVST_ISR.tapos1                    VLDST  TAR寻址+SR offset，推测使用机率较小   Reviewed
V.TVLD_ISR.tapos0                     VLDST  TAR寻址+SR offset，推测使用机率较小   Reviewed
V.TVLD_ISR.tapos1                     VLDST  TAR寻址+SR offset，推测使用机率较小   Reviewed
V.TVST_ISR.tapos0                     VLDST  TAR寻址+SR offset，推测使用机率较小   Reviewed
V.TVST_ISR.tapos1                     VLDST  TAR寻址+SR offset，推测使用机率较小   Reviewed
M.TVST_ISR.tapos0                     VLDST  TAR寻址+SR offset，推测使用机率较小   Reviewed
M.TVST_ISR.tapos1                     VLDST  TAR寻址+SR offset，推测使用机率较小


M.SVMM_LD                             MALU   Legacy VMM指令，推测在Scorpio上使用机率较小预期同步削减2.0的VMM模式  Reviewed
M.VMM_LD                              MALU   Legacy VMM指令，推测在Scorpio上使用机率较小预期同步削减2.0的VMM模式  Reviewed
M.SVMM                                MALU   Legacy VMM指令，推测在Scorpio上使用机率较小预期同步削减2.0的VMM模式  Reviewed
M.VMM                                 MALU   Legacy VMM指令，推测在Scorpio上使用机率较小预期同步削减2.0的VMM模式  Reviewed
M.LDSMR                               MALU   Legacy VMM指令，推测在Scorpio上使用机率较小预期同步削减2.0的VMM模式单独定义一个V-slot的clrm指令  Reviewed
V.LDSMR_V                             MALU   Legacy VMM指令，推测在Scorpio上使用机率较小预期同步削减2.0的VMM模式  Reviewed
V.LDSMR2_MEM_V中所有低算力模式        MALU   削减低算力的VMM模式                   Reviewed

M.REMAPVA中maskbit和其他数据格式互转的模式  VMOV   推测在Scorpio上使用机率较小           Reviewed

C.VST.imm0                            VLDST  Legacy的C-slot VR store指令，推测在Scorpio上使用机率较小  Reviewed
C.VST.imm1                            VLDST  Legacy的C-slot VR store指令，推测在Scorpio上使用机率较小  Reviewed
C.TVST_ITAR                           VLDST  Legacy的C-slot VR store指令，推测在Scorpio上使用机率较小  Reviewed
C.TVST_ISR.tapos0                     VLDST  Legacy的C-slot VR store指令，推测在Scorpio上使用机率较小  Reviewed
C.TVST_ISR.tapos1                     VLDST  Legacy的C-slot VR store指令，推测在Scorpio上使用机率较小  Reviewed

L.TVLDA.dual                          VLDST  dual模式下，由2个TAR寄存器变更为1个TAR寄存器加两段 offset 或者舍弃dual模式  Reviewed

V.VLD_SMR                             VLDST  指令在ISA3.2没有实现，不存在兼容性问题。ISA4.0倾向使用GEMM系列指令管理SMR  Reviewed
V.VST_SMR           VLDST  指令在ISA3.2没有实现，不存在兼容性问题。ISA4.0倾向使用GEMM系列指令管理SMR  Reviewed

LOOP0               CTRL   4.0通过微架构分支预测机制替代实现     Reviewed
LOOP1               CTRL   4.0通过微架构分支预测机制替代实现     Reviewed

L.VLDL              VLDST  IV/VR/SMR指令                         Reviewed
L.VSTL              VLDST  IV/VR/SMR指令                         Reviewed
V.VLDL              VLDST  IV/VR/SMR指令                         Reviewed
M.VSTL              VLDST  IV/VR/SMR指令                         Reviewed
S1.VLD.imm0         VLDST  IV/VR/SMR指令                         Reviewed
S1.VLD.imm1         VLDST  IV/VR/SMR指令                         Reviewed
S0.VLD.imm0         VLDST  IV/VR/SMR指令                         Reviewed
S0.VLD.imm1         VLDST  IV/VR/SMR指令                         Reviewed
S0.VST.imm0         VLDST  IV/VR/SMR指令                         Reviewed
S0.VST.imm1         VLDST  IV/VR/SMR指令                         Reviewed
M.VST.imm0          VLDST  IV/VR/SMR指令                         Reviewed
M.VST.imm1          VLDST  IV/VR/SMR指令                         Reviewed
S0.VLD.imm0.ldcopy  VLDST  IV/VR/SMR指令                         Reviewed
S0.VLD.imm1.ldcopy  VLDST  IV/VR/SMR指令                         Reviewed
S1.VLD.imm0.ldcopy  VLDST  IV/VR/SMR指令                         Reviewed
S1.VLD.imm1.ldcopy  VLDST  IV/VR/SMR指令                         Reviewed

S1.TVLD_ITAR        VLDST  IV/VR/SMR指令                         Reviewed
S0.TVLD_ITAR        VLDST  IV/VR/SMR指令                         Reviewed
V.TVLD_ITAR         VLDST  IV/VR/SMR指令                         Reviewed
S1.TIVLD_ITAR       VLDST  IV/VR/SMR指令                         Reviewed
S0.TIVLD_ITAR       VLDST  IV/VR/SMR指令                         Reviewed
S0.TVLDD_ITAR       VLDST  IV/VR/SMR指令                         Reviewed
S1.TIVLDD_ITAR      VLDST  IV/VR/SMR指令                         Reviewed
S0.TIVLDD_ITAR      VLDST  IV/VR/SMR指令                         Reviewed
S0.TVLDD2_ITAR      VLDST  IV/VR/SMR指令                         Reviewed
S1.TIVLDD2_ITAR     VLDST  IV/VR/SMR指令                         Reviewed
S0.TVST_ITAR        VLDST  IV/VR/SMR指令                         Reviewed
V.TVST_ITAR         VLDST  IV/VR/SMR指令                         Reviewed
M.TVST_ITAR         VLDST  IV/VR/SMR指令                         Reviewed

L.MOVSFTC           VMOV   IV/VR/SMR指令                         Reviewed
L.MOVSFTI           VMOV   IV/VR/SMR指令                         Reviewed
L.MOVSFT            VMOV   IV/VR/SMR指令                         Reviewed
V.MOVSFTI           VMOV   IV/VR/SMR指令                         Reviewed
```

| Instruction Name | Type | 删除原因 | Review结果 |
| --- | --- | --- | --- |
| V.MOVSFT | VMOV | IV/VR/SMR指令 | Reviewed |
| V.MOVSFTC | VMOV | IV/VR/SMR指令 | Reviewed |
| L.MOVIVR2VR | VMOV | IV/VR/SMR指令 | Reviewed |
| V.MOVIVR2VR | VMOV | IV/VR/SMR指令 | Reviewed |
| L.MOVVR2IVR | VMOV | IV/VR/SMR指令 | Reviewed |
| V.MOVVR2IVR | VMOV | IV/VR/SMR指令 | Reviewed |
| L.MOVVA2VR | VMOV | IV/VR/SMR指令 | Reviewed |
| V.MOVVA2VR | VMOV | IV/VR/SMR指令 | Reviewed |
| V.MOVDA2VR | VMOV | IV/VR/SMR指令 | Reviewed |
| L.MOVVR2DA | VMOV | IV/VR/SMR指令 | Reviewed |
| L.MOVIV2DA | VMOV | IV/VR/SMR指令 | Reviewed |
| L.MOVVR2VA | VMOV | IV/VR/SMR指令 | Reviewed |
| S0.MOVR2VR.mode0 | VMOV | IV/VR/SMR指令 | Reviewed |
| V.MOVR2VR.mode0 | VMOV | IV/VR/SMR指令 | Reviewed |
| S0.MOVR2VR.mode1 | VMOV | IV/VR/SMR指令 | Reviewed |
| V.MOVR2VR.mode1 | VMOV | IV/VR/SMR指令 | Reviewed |
| S0.MOVVR2R | VMOV | IV/VR/SMR指令 | Reviewed |
| S0.MOVVR2TAR | VMOV | IV/VR/SMR指令 | Reviewed |
| C.MOVVR2TAR | VMOV | IV/VR/SMR指令 | Reviewed |
| S0.MOVTAR2VR | VMOV | IV/VR/SMR指令 | Reviewed |
| S0.MOVVR | VMOV | IV/VR/SMR指令 | Reviewed |
| V.MOVVR | VMOV | IV/VR/SMR指令 | Reviewed |
|  |  |  |  |
| L.VLDI_LO.VR | VMOV | IV/VR/SMR指令 | Reviewed |
| V.VLDI_LO.VR | VMOV | IV/VR/SMR指令 | Reviewed |
| L.VLDI_HI.VR | VMOV | IV/VR/SMR指令 | Reviewed |
| V.VLDI_HI.VR | VMOV | IV/VR/SMR指令 | Reviewed |
| L.IVLDI_LO | VMOV | IV/VR/SMR指令 | Reviewed |
| L.IVLDI_HI | VMOV | IV/VR/SMR指令 | Reviewed |
| S1.VCLR.VR | VMOV | IV/VR/SMR指令 | Reviewed |
| S0.VCLR.VR | VMOV | IV/VR/SMR指令 | Reviewed |
| V.VCLR.VR | VMOV | IV/VR/SMR指令 | Reviewed |
|  |  |  |  |
| V.LDSMR2_V | MALU | IV/VR/SMR指令 | Reviewed |
| V.LDSMR2_MEM_V | MALU | IV/VR/SMR指令 | Reviewed |
| M.VMM2 | MALU | IV/VR/SMR指令 | Reviewed |
| M.SVMM2 | MALU | IV/VR/SMR指令 | Reviewed |
| M.VMM2_SPS | MALU | IV/VR/SMR指令 | Reviewed |
| M.LDSMR2 | MALU | IV/VR/SMR指令 | Reviewed |
| M.VDM.col | MALU | IV/VR/SMR指令 | Reviewed |
| M.VDM.row | MALU | IV/VR/SMR指令 | Reviewed |
| M.VAM.col | MALU | IV/VR/SMR指令 | Reviewed |
| M.VSM.col | MALU | IV/VR/SMR指令 | Reviewed |
| M.VMAC | MALU | IV/VR/SMR指令 | Reviewed |
| M.VMAS | MALU | IV/VR/SMR指令 | Reviewed |
| M.IMAS | MALU | IV/VR/SMR指令 | Reviewed |
| V.SWAP.SMR | MALU | IV/VR/SMR指令 | Reviewed |
|  |  |  |  |
| L.VLDI_LO.QA | VMOV | Legacy非OACC的VA load/store指令 | Reviewed |
| L.VLDI_HI.QA | VMOV | Legacy非OACC的VA load/store指令 | Reviewed |
| L.TVSTA | VLDST | Legacy非OACC的VA load/store指令 | Reviewed |
| V.TVSTA | VLDST | Legacy非OACC的VA load/store指令 | Reviewed |
| L.TVLDA | VLDST | Legacy非OACC的VA load/store指令 | Reviewed |
| L.TVLDQA | VLDST | Legacy非OACC的VA load/store指令 | Reviewed |
| L.VLDQA | VLDST | Legacy非OACC的VA load/store指令 | Reviewed |
| L.VLDQA.imm1 | VLDST | Legacy非OACC的VA load/store指令 | Reviewed |
| M.VLDQA.imm1 | VLDST | Legacy非OACC的VA load/store指令 | Reviewed |
| V.TVSTDA | VLDST | Legacy非OACC的VA load/store指令 | Reviewed |
| V.TVSTDA2 | VLDST | Legacy非OACC的VA load/store指令 | Reviewed |
| V.VSTDA | VLDST | Legacy非OACC的VA load/store指令 | Reviewed |
| V.VSTDA.imm1 | VLDST | Legacy非OACC的VA load/store指令 | Reviewed |
| M.TVLDQA | VLDST | Legacy非OACC的VA load/store指令 | Reviewed |
| M.VLDQA | VLDST | Legacy非OACC的VA load/store指令 | Reviewed |
| M.VLDXDA | VLDST | Legacy非OACC的VA load/store指令 | Reviewed |
| M.VSTXDA | VLDST | Legacy非OACC的VA load/store指令 | Reviewed |
|  |  |  |  |
| M.VLDOA.imm1 | VLDST | 简化微架构实现复杂度，SR后增操作通过标量指令替代 | Reviewed |
| L.VLDOA.imm1 | VLDST | 简化微架构实现复杂度，SR后增操作通过标量指令替代 | Reviewed |
| V.VSTOA.imm1 | VLDST | 简化微架构实现复杂度，SR后增操作通过标量指令替代 | Reviewed |
|  |  |  |  |
| M.TVLDOA | VLDST | 减少不同slot有相同语义的指令，用L.TVLDOA替代 | FCRReviewed |
| M.TVLDOA.reg | VLDST | 减少不同slot有相同语义的指令，用L.TVLDOA.reg替代 | FCRReviewed |
| M.VLDOA | VLDST | 减少不同slot有相同语义的指令，用L.VLDOA替代 | FCRReviewed |
| V.TARADD | VLDST | 减少不同slot有相同语义的指令，用S0.TARADD替代 | FCRReviewed |
| L.MOVVA2R.mode2 | VMOV | 移动slot变更为V.MOVVA2R.mode2 | FCRReviewed |
| L.AGGR_MB | VMOV | 移动slot变更为V.AGGR_MB | FCRReviewed |
| C.MOVTAR.T0 | VMOV | 移动slot变更为S0.MOVTAR.T0 | FCRReviewed |
| C.MOVTAR.T1 | VMOV | 移动slot变更为S0.MOVTAR.T1 | FCRReviewed |
| C.MOVTAR.DUAL | VMOV | 移动slot变更为S0.MOVTAR.DUAL | FCRReviewed |
| CLWSP | SLDST | 指令删除，使用L.LD替代 | FCRReviewed |
| CSWSP | SLDST | 指令删除，使用L.ST替代 | FCRReviewed |
| CLDSP | SLDST | 指令删除，使用L.LDX替代 | FCRReviewed |
| CSDSP | SLDST | 指令删除，使用L.ST替代 | FCRReviewed |
| CLW | SLDST | 指令删除，使用L.LD替代 | FCRReviewed |
| CSW | SLDST | 指令删除，使用L.ST替代 | FCRReviewed |
| CLD | SLDST | 指令删除，使用L.LDX替代 | FCRReviewed |
| CST | SLDST | 指令删除，使用L.ST替代 | FCRReviewed |
| CADDI | SALU | 指令删除，使用L.ADDI替代 | FCRReviewed |
| CADDI16SP | SALU | 指令删除，使用L.ADDI替代 | FCRReviewed |
| CADDI4SPN | SALU | 指令删除，使用L.ADDI替代 | FCRReviewed |
| CSLLI | SALU | 指令删除，使用L.SLLI替代 | FCRReviewed |
| CSRLI | SALU | 指令删除，使用L.SRLI替代 | FCRReviewed |
| CSRAI | SALU | 指令删除，使用L.SRAI替代 | FCRReviewed |
| CANDI | SALU | 指令删除，使用L.ANDI替代 | FCRReviewed |
| CADD | SALU | 指令删除，使用L.ADD替代 | FCRReviewed |
| CAND | SALU | 指令删除，使用L.AND替代 | FCRReviewed |
| COR | SALU | 指令删除，使用L.OR替代 | FCRReviewed |
| CXOR | SALU | 指令删除，使用L.XOR替代 | FCRReviewed |
| CSUB | SALU | 指令删除，使用L.SUB替代 | FCRReviewed |
| CJ | CTRL | 指令删除，使用L.JAL替代 | FCRReviewed |
| CJAL | CTRL | 指令删除，使用L.JAL替代 | FCRReviewed |
| CJALR | CTRL | 指令删除，使用L.JALR替代 | FCRReviewed |
| CJR | CTRL | 指令删除，使用L.JALR替代 | FCRReviewed |
| CLI | SALU | 指令删除，使用L.ADDI替代 | FCRReviewed |
| CLUI | SALU | 指令删除，使用L.LDI_LO/L.LDI_HI替代 | FCRReviewed |
| CNOP | CTRL | 指令删除，使用L.NOP替代 | FCRReviewed |
| CMV | SLDST | 指令删除，使用L.MOV替代 | FCRReviewed |
| C.MOVSR2SPR | SLDST | 指令删除，使用L.MOVSR2SPR替代 | FCRReviewed |
| C.MOVSR2SPR.EXT | SLDST | 指令删除，使用L.MOVSR2SPR替代 | FCRReviewed |
| C.MOVS.EXT | SLDST | 指令删除，使用L.MOVS替代 | FCRReviewed |
| C.CEQZ | SALU | 指令删除，使用S1.CEQZ替代 | FCRReviewed |
| C.CNEZ | SALU | 指令删除，使用S1.CNEZ替代 | FCRReviewed |
| C.BEQZ | CTRL | 指令删除，使用L.B.cond替代 | FCRReviewed |
| C.BNEZ | CTRL | 指令删除，使用L.B.cond替代 | FCRReviewed |

### 13.3.2. Instruction Encoding Update

下列指令中的语义被后者完全所替代：

| Instruction Name | Replacement | Type | Comment |
| --- | --- | --- | --- |
| L.AND | L.ANDX | SALU | 该指令为32bit运算指令，语义可以被L.ANDX指令所替代完成兼容要求 |
| L.OR | L.ORX | SALU | 该指令为32bit运算指令，语义可以被L.ORX指令所替代完成兼容要求 |
| L.XOR | L.XORX | SALU | 该指令为32bit运算指令，语义可以被L.XORX指令所替代完成兼容要求 |
| L.SEQ | L.SEQX | SALU | 该指令为32bit运算指令，语义可以被L.SEQX指令所替代完成兼容要求 |
| M.MOVQA | M.MOVOA | VMOV | 该指令语义可以被M.MOVOA指令所替代完成兼容要求 |

```text
Instruction Name  Replacement   Type  Comment
M.MOP.MAX         M.MOP.MAXNUM  MALU  该指令语义完全被M.MOP.MAXNUM所替代而ISA4.0的M.MOP.MAX指令语义和原ISA3.2上的语义存在差异
M.MOP.MIN         M.MOP.MINNUM  MALU  该指令语义完全被M.MOP.MINNUM所替代而ISA4.0的M.MOP.MIN指令语义和原ISA3.2上的语义存在差异
```

### 13.3.3. Limitation of Usage

IV/VR/SMR寄存器将会逐渐被MLI_GEMM系列指令所隐藏，建议在Libra新开发算子中禁止使用。

Note: 生命周期只限于ISA4.0的指令

## 13.4. Compatibility of Instruction Package

N/A

## 13.5. Compatibility of Accuracy

N/A

## 13.6. Compatibility of Instruction Latency

N/A

# 14. Appendix D: GEMM Programming Example

Please see Libra SIP Programming Guideline
