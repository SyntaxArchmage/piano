# ISA4.0 Instruction Reference (Compute-Focused)

Libra SIP ISA4.0 (Crystal Instruction 4.0) instruction encoding, operand constraints, and semantics for 1D/2D compute and atomic operations.

## ISA4.0 Overview

ISA4.0 is the fourth-generation SIP instruction set with key properties:
- Multi-sub-thread programming (multi-SW-thread) support
- VLIW packaging: 4-issue (C+L+M+V) or 5-issue (C+S1+S0+M+V) format, 128-bit package
- MLI format: C-slot MLI_HINT + MLI slot (for GEMM/2D instructions)
- VPT (Vector Pipeline Thread): up to 2 VPTs, configurable via TCTL
- VA register count: 6144 VACC entries (512-bit per entry)

## Instruction Slot Assignment

| Slot | Major Usage | Encoding Bits |
|------|-------------|---------------|
| C | Integer scalar ALU (excl. multiply), scalar LD/ST, program control, vector store | inst_p[127:112] |
| S0 | Integer scalar ALU, vector load/store | inst_p[95:80] |
| S1 | Integer scalar ALU, vector load | inst_p[111:96] |
| L | Integer scalar ALU (incl. multiply), program control, scalar and vector LD/ST | inst_p[111:80] |
| M | MALU and some vector load/store instructions | inst_p[79:32] |
| V | Some vector load/store instructions | inst_p[31:0] |
| MLI | CISC 2D instructions / Matrix LDST / 64-bit SG LDST | inst_p[79:32] |

## Common MALU Data Type Encoding

| dtype value | Type category |
|-------------|--------------|
| 0 | UINT |
| 1 | SINT |
| 2 | FP / FP8_E4M3 |
| 3 | BF / FP8_E5M2 |

| dwidth value | Bit width |
|--------------|-----------|
| 0 | 8-bit |
| 1 | 16-bit |
| 2 | 32-bit |
| 3 | 64-bit |

Combined encoding:

| Data Type | dtype | dwidth |
|-----------|-------|--------|
| UINT8 | 0 | 0 |
| INT8 | 1 | 0 |
| FP8_E4M3 | 2 | 0 |
| FP8_E5M2 | 3 | 0 |
| UINT16 | 0 | 1 |
| INT16 | 1 | 1 |
| FP16 | 2 | 1 |
| BF16 | 3 | 1 |
| UINT32 | 0 | 2 |
| INT32 | 1 | 2 |
| FP32 | 2 | 2 |
| UINT64 | 0 | 3 |
| INT64 | 1 | 3 |
| FP64 | 2 | 3 |

## 1D Instructions: MOP Series

MOP (Matrix-slot Operations for 1D) execute element-wise vector compute on VACC/OACC registers.

### Arithmetic MOP Instructions

| Instruction | Operation | Denormal Flush (in/out) |
|-------------|-----------|------------------------|
| MOP.ADD | VACCd = VACCs1 + VACCs2 | Yes/Yes |
| MOP.SUB | VACCd = VACCs1 - VACCs2 | Yes/Yes |
| MOP.MUL | VACCd = VACCs1 * VACCs2 | Yes/Yes |
| MOP.SQR | VACCd = VACCs1^2 | Yes/Yes |
| MOP.ABS | VACCd = abs(VACCs1) | Yes/Yes |
| MOP.NEG | VACCd = -VACCs1 | Yes/Yes |
| MOP.MIN | VACCd = min(s1, s2) | Yes/Yes |
| MOP.MAX | VACCd = max(s1, s2) | Yes/Yes |
| MOP.ABSMAX | VACCd = max(abs(s1), abs(s2)) | Yes/Yes |
| MOP.MINNUM | IEEE754 minnum | Yes/Yes |
| MOP.MAXNUM | IEEE754 maxnum | Yes/Yes |
| MOP.ABSMAXNUM | IEEE754 abs-maxnum | Yes/Yes |
| MOP.CVT | Type conversion | Yes/Yes |

Comparison instructions (output maskbit):

| Instruction | Operation |
|-------------|-----------|
| MOP.MSEQ | maskbit = (s1 == s2) |
| MOP.MSNE | maskbit = (s1 != s2) |
| MOP.MSLT | maskbit = (s1 < s2) |
| MOP.MSLE | maskbit = (s1 <= s2) |
| MOP.MSGE | maskbit = (s1 >= s2) |
| MOP.MSGT | maskbit = (s1 > s2) |

Mixed-precision variants (F32MIX, F16MIX, I32MIX, I64MIX): perform computation in higher precision with lower-precision inputs.

| Instruction | Operation | Notes |
|-------------|-----------|-------|
| MOP.MUL_F32MIX | FP16 inputs -> FP32 multiply | dst cannot be OACC0 |
| MOP.MUL_F16MIX | FP8 inputs -> FP16 multiply | dst cannot be OACC0 |
| MOP.ADD_F32MIX | FP16 inputs -> FP32 add | dst cannot be OACC0 |
| MOP.ADD_F16MIX | FP8 inputs -> FP16 add | dst cannot be OACC0 |
| MOP.MAC | Multiply-accumulate | dst cannot be OACC0 |
| MOP.MAS | Multiply-add-saturate | dst cannot be OACC0 |
| MOP.IMAS | Integer multiply-add-saturate | dst cannot be OACC0 |

### MOP.MUL_SCL (Scalar-Vector Multiply)

Multiplies each element of a vector by a scalar value:
- Operand: one VACC source, one scalar immediate or SR
- Result written to VACC/OACC
- Useful for scaling operations in normalization kernels
- Denormal flush: Yes/Yes

### Reduction Instructions (4-stage)

| Instruction | Operation | Stages | Constraint |
|-------------|-----------|--------|-----------|
| REDSUM | Sum reduction across vector | stage=3 (execute on 2D path) | dst/src cannot be VACC0 or OACC0 |
| REDMAX | Max reduction across vector | stage=3 | Same as REDSUM |
| REDMIN | Min reduction across vector | stage=3 | Same as REDSUM |
| REDV.ADD | Reduction with VACC output | - | New in ISA4.0 |
| REDV.MAX | Reduction max with VACC output | - | New in ISA4.0 |
| REDV.MAXNUM | Reduction maxnum with VACC output | - | New in ISA4.0 |

REDSUM/REDMAX/REDMIN execute on the 2D compute path (S3->S4 2D MAC Path), serializing with GEMM and SFU instructions. Denormal flush: Yes/Yes.

### MSF (Special Function) Instructions

| Instruction | Function | Precision | Execution Path |
|-------------|----------|-----------|----------------|
| MSF.EXP | Exponential (e^x) | FP16/FP32 | 2D path (serializes with GEMM) |
| MSF.LN | Natural logarithm | FP16/FP32 | 2D path |
| MSF.TANH | Hyperbolic tangent | FP16/FP32 | 2D path |
| MSF.SIGMOID | Sigmoid function | FP16/FP32 | 2D path |
| MSF.GELU | GELU activation | FP16/FP32 | 2D path |
| MSF.RSQRT | Reciprocal square root | FP16/FP32 | 2D path |
| MSF.REC | Reciprocal | FP16/FP32 | 2D path |
| MSF.SIN | Sine | FP16/FP32 | 2D path |

MSF instructions can write back to OACC (new in ISA4.0). All MSF share the 2D execution path and serialize with MLI_GEMM. Denormal flush: Yes/Yes.

## 2D 指令族:MLI

MLI(Middle Level Instruction)是 ISA4.0 新增的 CISC 风格指令族,固定与 C-slot 的 `MLI_HINT` 或 `MLI_HINT_GEMM` 一同打包,不能与任何其他类型指令打包。MLI 族包含两类:① CISC 2D 矩阵运算 `MLI_GEMM`;② Matrix LDST + 64-bit offset Scatter-Gather LDST(`MLI_VLDXOA` / `MLI_VSTXOA` / `MLI_VLDXI32OA` / `MLI_VSTXI32OA` 等)。

### MLI 在 VLIW 包中的位置

128-bit VLIW 包按 C-slot 内容选三种格式:

- C-slot 为 `MLI_HINT` 或 `MLI_HINT_GEMM` 时,包为 **MLI 格式**:`C(16-bit) + Reserved(32-bit) + MLI(48-bit) + Reserved(32-bit)`,只能装一条 MLI 指令。
- C-slot 不是 MLI_HINT 且 `inst_p[80] = 0` 时为 **5-issue 格式**:`C(16) + S1(16) + S0(16) + M(48) + V(32)`。
- 否则为 **4-issue 格式**:`C(16) + L(32) + M(48) + V(32)`。

ISA4.0 7 个 slot 定义:

| Slot | 主要用途 | 编码位段 |
| :-- | :-- | :-- |
| C | CTRL / 不含乘法的 SALU / SLDST / 程序控制 / vector store | inst_p[127:112] |
| S0 | SALU / VLDST(load 或 store) | inst_p[95:80] |
| S1 | SALU / VLDST(load 通路) | inst_p[111:96] |
| L | 含乘法的 SALU / 程序控制 / SLDST / VLDST | inst_p[111:80] |
| M | MALU / 部分 VLDST | inst_p[79:32] |
| V | 部分 VLDST | inst_p[31:0] |
| MLI | CISC 2D / Matrix LDST / 64-bit offset SG LDST | inst_p[79:32] |

> MLI 与 M 共用物理位段 inst_p[79:32];包格式由 C-slot 决定走哪条解码路径,不存在"同一包既有 M 又有 MLI"的合法编码。

### MLI_GEMM 概览

MLI_GEMM 在 2D MAC 通路上执行 `D = A · B (+ C)`,左右输入矩阵一定来源于 memory(LHS 也可来源于 VACC),累加 / 输出矩阵均位于 VACC。指令本身预期在流水线上执行数十~数百个 cycle,需通过 SPR 寄存器静态描述左右矩阵在 memory 中的实际尺寸(real)与最大尺寸(max),由硬件自动完成 zero padding / real size clamp / NOP 转换。

输入数据格式由 `gemm_mode` + `dtype` 联合决定;输出累加格式由 `gemm_mode` 决定:

- 输入为浮点(FP16 / BF16 / FP32 / EF32 / FP8_E4M3 / FP8_E5M2),累加和输出固定 FP32(EF32 在 GEMM 内部转 FP20 计算后写回 FP32)。
- 输入为整型(INT8 / UINT8 / 8bus 混合带符号),累加和输出固定 INT32 且 **总是做 saturation**。

MLI_GEMM 输入 / 输出受 `MODE_WRK.denormal_flush` 影响(对 FP32 / FP16 / BF16 各有 2-bit input/output 控制);输出受 `MODE_WRK.OVCLP` 影响(对 FP16 / BF16 起 clamp,但不对 INF 直接生效)。

### MLI_GEMM 编码字段(单条 48-bit MLI slot)

MLI_GEMM 编码位段(bit 47 是 MLI slot 的最高位,bit 0 是最低位):

| 位段 | 字段 | 取值与含义 |
| :-- | :-- | :-- |
| 47..46 | `dacc_pos` | 回写 OACC 时的 VACC index 偏移,语义随 gemm_mode 变化(见下) |
| 45..44 | `dst_stride` | 累加矩阵 dim1_stride 编码:0=2*VACC、1=4*VACC、2=8*VACC、3=Reserved |
| 43..42 | `acc_mode` | 与 nacc 联合决定 `D = ±A·B (± C)` 的符号组合,3 取值有效 |
| 41 | `nacc` | 0=正常累加(OACC 旧值参与运算)、1=不累加(直接覆盖,旧值不参与) |
| 40 | `rhs_ldmode` | 0=按行加载(RHS_DIM0_STRIDE 必须=1)、1=按列加载(RHS_DIM1_STRIDE 必须=1) |
| 39..38 | `dtype` | UINT(0)/SINT(1)/FP-or-FP8E4M3(2)/BF-or-FP8E5M2(3),配合 gemm_mode 唯一确定数据格式 |
| 37..34 | (N/A) | 保留 |
| 33..31 | `gemm_mode` | 8 个合法编码,见下表;其余编码 Reserved |
| 30..26 | `lhs_row_max` | LHS dim1_max 编码:`lhs_dim1_max = 8 * (2^lhs_row_max)`,合法 0~4 → 8/16/32/64/128 |
| 25..21 | Rs2 | 5-bit SR 编号,提供 RHS 起始地址 |
| 20..16 | (N/A) | 保留 |
| 15..6 | `OACCs3/d` | 10-bit,回写目标 OACC 编号(见下 OACC 间接寻址) |
| 5..0 | opcode | MLI_GEMM 操作码 |

(LHS 起始地址来自 Rs1 SR,在 MLI_HINT_GEMM 一同的 C-slot 编码中给出;`OACCs3/d` 与 dacc_pos 共同决定写回的 VACC index。)

### gemm_mode 全集表(8 个合法值 + dtype 联合)

| `gemm_mode` | 编码 | 输入 dtype | LHS dim0/dim1_max | RHS dim0_max | 输出格式 | 说明 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `gemm.16b.rhs64x32` | `0x0` | FP16(dtype=2)或 BF16(dtype=3) | 64 | 32 | FP32 | 16-bit 模式,LHS 64x{动态行}、RHS 64x32 |
| `gemm.16b.rhs32x64` | `0x1` | FP16(dtype=2)或 BF16(dtype=3) | 32 | 64 | FP32 | 16-bit 模式,LHS 32x{动态行}、RHS 32x64 |
| `gemm.32b.rhs16x32` | `0x2` | FP32(dtype 固定=2) | 16 | 32 | FP32 | 32-bit 模式,RHS 16x32 |
| `gemm.8b.rhs64x64` | `0x3` | UINT8(dtype=0)或 INT8(dtype=1) | 64 | 64 | INT32 | 8-bit 同符号模式 |
| `gemm.8bus.rhs64x64` | `0x4` | LHS=UINT8、RHS=INT8(dtype 固定=0,左右支符号在 mode 内固化) | 64 | 64 | INT32 | 8-bit 异符号模式 |
| `gemm.ef32vm.rhs32x64` | `0x7` | EF32(dtype 固定=2,内部转 FP20 计算) | 32 | 64 | FP32 | EF32 是特殊浮点格式(详见 §8.8.1.7) |
| `gemm.fp8b.rhs64x64` | `0x8` | 左右支同 FP8 格式:dtype=2 → 双 E4M3、dtype=3 → 双 E5M2 | 64 | 64 | FP32 | FP8 同格式 |
| `gemm.fp8bx.rhs64x64` | `0x9` | 左右支异 FP8 格式:dtype=2 → 左 E4M3 / 右 E5M2、dtype=3 → 左 E5M2 / 右 E4M3 | 64 | 64 | FP32 | FP8 异格式 |

> `gemm_sps` 系列(GEMM Sparsity)是另一种 mode 取值(LHS dim0/dim1_max=128),属于稀疏 2D 指令变体,不在 MLI_GEMM 普通算子开发主路径,本文件不展开。

### acc_mode + nacc 行为表

| `nacc` | `acc_mode` | 行为 |
| :-- | :-- | :-- |
| 0 | 0 | `output_matrix = output_matrix + input_matrix * input_matrix` |
| 0 | 1 | `output_matrix = output_matrix - input_matrix * input_matrix`(类似 VMAS) |
| 0 | 2 | `output_matrix = -output_matrix + input_matrix * input_matrix`(类似 IMAS) |
| 1 | 0 | `output_matrix = input_matrix * input_matrix`(直接覆盖) |
| 1 | 1 | `output_matrix = -input_matrix * input_matrix` |
| 1 | 2 | `output_matrix = input_matrix * input_matrix`(与 nacc=1 / acc_mode=0 同效) |

- 浮点模式:`acc_mode` 取值 0 / 1 / 2 全部合法。
- INT8 / UINT8 模式:`acc_mode` 只能取 0(saturation 语义不允许减法形式)。
- `nacc` 与 `NACCOVR` SPR 的关系:SPR `NACCOVR` 永远把 GEMM 的"累加"行为改写为"非累加",且只对 `nacc=0` 的指令生效;`nacc=1` 不会被 NACCOVR 改写。

### lhs_row_max + dim0_max 派生

| `lhs_row_max` | `lhs_dim1_max`(LHS 行数最大) |
| :-- | :-- |
| 0 | 8 |
| 1 | 16 |
| 2 | 32 |
| 3 | 64 |
| 4 | 128 |

`lhs_dim0_max` 与 RHS 的 `dim1_max` 相同,由 `gemm_mode` 直接决定,与 `lhs_row_max` 无关。

### Matrix Description(Memory 端 LHS / RHS)

LHS / RHS / ACC&DST 三类矩阵的参数表如下,首先是 Memory 端的 LHS:

| 参数 | 是否静态(指令编码)/ 动态(SPR) | 来源 | 说明 |
| :-- | :-- | :-- | :-- |
| `format` | 静态 | `gemm_mode` + `dtype` | 自动推断 |
| `addr` | 动态 | SR(Rs1) | 矩阵 [0,0] 起始地址 |
| `dim0_max` | 静态 | `gemm_mode` | 单位 element |
| `dim1_max` | 静态 | `lhs_row_max` | `8 * 2^lhs_row_max` |
| `dim0_real` | 动态 | SPR `LHS_DIM0_REAL` | 单位 element |
| `dim1_real` | 动态 | SPR `LHS_DIM1_REAL0` / `_REAL1` / `_REAL2` | 三个 real size,见 Zero Padding |
| `dim0_stride` | 动态 | SPR `LHS_DIM0_STRIDE` | ISA4.0 中只读、固定为 1 |
| `dim1_stride` | 动态 | SPR `LHS_DIM1_STRIDE` | 单位 element |

RHS 与 LHS 大体对称,唯一差异:RHS 用三个 real size `RHS_DIM0_REAL{0,1,2}`(LHS 的对应字段是 `LHS_DIM1_REAL{0,1,2}`)+ `RHS_DIM1_REAL`(等于 `LHS_DIM0_REAL` 的别名);`RHS_DIM0_STRIDE` 在 `rhs_ldmode=0`(按行加载)时必须=1,`RHS_DIM1_STRIDE` 在 `rhs_ldmode=1`(按列加载)时必须=1。

### Matrix Description(VACC 端 ACC & DST)

| 参数 | 是否静态 / 动态 | 来源 | 说明 |
| :-- | :-- | :-- | :-- |
| `format` | 静态 | `gemm_mode` + `dtype` | 输出固定 FP32 或 INT32 |
| `addr` | 动态 | 指令 `OACCs3/d` 域 + VAB | VACC index = VAB_VPT* + {OACCs3/d, 3'b0} + dacc_pos*2 |
| `dim0_max` | 静态 | `gemm_mode` | 单位 element |
| `dim1_max` | 静态 | `lhs_row_max` | 与 LHS dim1_max 一致 |
| `dim0_real` | 动态 | SPR `RHS_DIM0_REAL2` | 单位 element |
| `dim1_real` | 动态 | SPR `LHS_DIM1_REAL2` | 单位 element |
| `dim0_stride` | 静态 | 指令编码 | ISA4.0 固定为 1 |
| `dim1_stride` | 静态 | 指令 `dst_stride` 域 | 编码 0/1/2 → 2*VACC / 4*VACC / 8*VACC |

`dacc_pos` 在不同 gemm_mode 下的有效集:

| `dacc_pos` | 适用条件 |
| :-- | :-- |
| 0 | 所有 `gemm_mode` |
| 1 | 仅 `rhs_dim0_max=32` 的 mode(0x1 / 0x2 / 0x7) |
| 2 | `rhs_dim0_max=32 或 64` 的 mode |
| 3 | 仅 `rhs_dim0_max=32` 的 mode |

`dst_stride` 与 `gemm_mode` 的合法组合:`rhs_dim0_max=64` 的 mode 可选 4VACC 或 8VACC;`rhs_dim0_max=32` 的 mode 可选 2VACC / 4VACC / 8VACC。VISA / C++ 编程层只需要提供 `dst_stride` 期望值,compiler 在向 ISA 层降级时会按需要拆出多条 MLI_GEMM(例如 `gemm.32b.rhs16x32` 用 `dst_stride=4VACC`,compiler 拆成 2 条 MLI_GEMM,第二条覆盖 dim0_max 后半,效果等价 `dim0_max=64`)。

### Real Size Process(SPR 输入处理 4 步)

GEMM real size SPR 的处理顺序如下,**这是硬件自动完成、不需要软件干预**,但理解它有助于看懂 GEMM 异常行为。

1. **Step 1: Read SPR Real_Size**——按指令读对应的 SPR(LHS 4 个、RHS 3 个),`rhs_ldmode=0` 时 `RHS_DIM0_REAL0` 自动处理为 0。
2. **Step 2: Clamp to MAX**——`output = min(SPR_value, *_MAX)`,即 real size 超过 max 时被钳住。`EXCP_REAL_SIZE` 异常在 ISA4.0 已经 deFeature。
3. **Step 3: Exception Check**——如果 `step1_output > *_MAX` 且对应异常 enable bit 打开,触发异常(本步与 Step 2 不串联,异常忽略时直接走 Step 4)。
4. **Step 4: Convert to NOP**——满足以下任一条件,指令转为 NOP:
   - `LHS_DIM0_REAL.step1_output == 0`(LHS 列宽=0)
   - `LHS_DIM1_REAL{0,1,2}.step1_output == 0`(LHS 三段全空)
   - `RHS_DIM0_REAL{0,1,2}.step1_output == 0`(RHS 三段全空)
   - LHS / RHS 的三个 real size 出现"head padding > 0 但 real 段=0"等不构成有效计算的边界场景(七条具体条件本文不展开)
5. **Step 5: 双支 Padding 处理**——通过所有检查后,如果 LHS 与 RHS 同时有合法 zero padding 场景,**指令只按 LHS Padding 处理,RHS Padding 被忽略**(参见 §Zero Padding 假设的最后一条)。

### Zero Padding(三段 real size 的 head + body + tail)

GEMM 系列指令在设计上支持卷积 feature 的 zero padding,关键假设:

- 卷积 feature 作为 GEMM 左支时,LHS dim0 一定是 Ci(N) 方向 → 不存在 zero padding;**只 dim1 可能有**。
- 卷积 feature 作为 GEMM 右支时,RHS dim1 一定是 Ci(N) 方向 → 不存在 zero padding;**只 dim0 可能有**。
- Zero padding 只在硬件加载 zero 数据时按 `vector` 整粒度生成,不是从 memory 读出。
- 右支 zero padding 只在按列加载(`rhs_ldmode=1`)模式下有效;按行加载时忽略。
- VACC 来源的 LHS / RHS、结构化系数 RHS 都不支持 zero padding;LHS / RHS 同时存在 zero padding 也不支持(见 Step 5)。

LHS 三个 real size 寄存器的语义(以 LHS dim1 方向为例):

```
row_idx < LHS_DIM1_REAL0                            → head padding 行(填零)
LHS_DIM1_REAL0 ≤ row_idx < LHS_DIM1_REAL1           → real 数据行(从 memory 加载)
LHS_DIM1_REAL1 ≤ row_idx < LHS_DIM1_REAL2           → tail padding 行(填零)
LHS_DIM1_REAL2 ≤ row_idx                            → 不分配 IV(超出 dim1_max 边界)
```

`setslice` 系列指令在 ISA4.0 中可同步更新三个 real size,使其满足"无 padding 时 `LHS_DIM1_REAL0 == 0 && LHS_DIM1_REAL1 == LHS_DIM1_REAL2`"的约束。

不需要 zero padding 时:`LHS_DIM1_REAL0 = 0`、`LHS_DIM1_REAL1 = LHS_DIM1_REAL2`。RHS 三个 real size 同理。

### Pipeline Unrolling

MLI_GEMM 指令在流水线上预期展开为 **LL (Lower Level) 指令** 序列,典型展开是 `lhs_dim1_size` 条 vmm 指令,每条覆盖 LHS 的一行 × RHS 全部列;由硬件 IV / DIV / DVR 寄存器自动暂存中间数据,软件不可见。

### Convert FP32 to EF32(`gemm.ef32vm.rhs32x64` 专用)

`gemm_mode=0x7` 在指令内部把 FP32 输入转成 EF32(1 sign + 8 exponent + 12 mantissa,FP20 等效),GEMM 累加按 FP32 输出:

- `FP32 NaN` → 固定 EF32 NaN(sign=0、exponent + mantissa 全 1)
- `FP32 INF` → EF32 INF
- 规格化数超过 EF32 表达范围 → clamp 到 EF32 最大规格化数(2^127 - 2^115),保符号
- 规格化数在表达范围内 → RNE 舍入

### dst_stride 的拆分语义

`gemm.32b.rhs16x32`(`gemm_mode=0x2`)在 `dst_stride=4VACC` 模式下,VISA / C++ 编程层只看到一条逻辑 MLI_GEMM,compiler 在降级到 ISA 层时会拆成 2 条 MLI_GEMM:第一条按 `dim0_max=32` 写第一段、第二条写第二段,效果等同 `dim0_max=64`。这一过程完全由 compiler 完成,**算子代码层看到的是无差别的 32x32x32 模板**。

### Implicit Use(隐式读取的 SPR)

MLI_GEMM 指令编码不显式给出但运行时必然读取的 SPR:

`NACCOVR`、`MODE_WRK.denormal_flush`、`MODE_WRK.rounding`、`VAB_VPT0`、`LHS_DIM0_REAL`、`LHS_DIM1_REAL{0,1,2}`、`LHS_DIM0_STRIDE`、`LHS_DIM1_STRIDE`、`RHS_DIM0_REAL{0,1,2}`、`RHS_DIM1_REAL`、`RHS_DIM0_STRIDE`、`RHS_DIM1_STRIDE`。

### MLI_GEMM 硬约束

- 必须与 C-slot 的 `MLI_HINT_GEMM` 一同打包,**不能与任何其他指令打包**——原因:MLI 与 M 共用 inst_p[79:32] 物理位段,decoder 按 C-slot HINT 决定走 MLI 还是 M 解码路径,不存在合法的"M + MLI 同包"编码。
- Memory 访问始终视为 RO,不与本指令地址 / store 之间维护 RAW / WAR hazard——原因:CISC 风格指令在流水线内部隐式分配 IV / VR / SMR 寄存器作为左操作数寄存器、SMR 作为右操作数寄存器,流水线会自动释放这些寄存器,软件层无显式同步需求。
- **指令所在算子,禁止使用 IV / VR / SMR 寄存器** ——原因:存在结构化冒险(structural hazard),软件线程从开始执行到 halt 全程不能再用带 IV / VR / SMR 资源的其他指令(因此 ISA4.0 已删除所有 IV / VR / SMR 相关 1D 指令,见 §8.7 / §8.8)。
- `rhs_ldmode` 必须与 `RHS_DIM0_STRIDE` / `RHS_DIM1_STRIDE` 对齐——原因:违反则按列读但按行 stride 寻址,执行结果不可测。
- Memory 地址需对齐到左右输入操作数的字节宽度——原因:违反则触发 unaligned address exception。
- Memory 访问遵守 VLD 类指令的 address alignment 与访问区域限制规则。
- **MLI_GEMM 仅在单 VPT(VPT0)下执行**——原因:CISC 流水线复用 IV / VR / SMR 物理资源,双 VPT 编程模型下无法独占。
- MLI_GEMM 不支持 maskbit。
- MLI_GEMM 支持 `denormal flush`(input + output)。

### Tensor Vector LDST(MLI 族中的 LDST 指令)

固定与 C-slot `MLI_HINT`(注意是 HINT,不是 HINT_GEMM)打包的 MLI 指令:`MLI_VLDXOA` / `MLI_VSTXOA` / `MLI_VLDXI32OA` / `MLI_VSTXI32OA`(64-bit offset Scatter-Gather LDST)。这些指令本文件不展开,只在此点名"它们打包格式与 MLI_GEMM 相同,但 C-slot HINT 不同"。

### MLI_GEMM 与 GEMM Operation 编程要点

- 打包方式由 compiler / 汇编工具自动选择 MLI 格式;算子代码层用 `tcle::matrix_t` 模板调用,看不到 MLI_HINT_GEMM 显式编码。
- `lhs_row_max` 编码 0~4 → M ∈ {8,16,32,64,128} 是 ISA 字面;Primo++ MMA_Op 算子层暴露的 `M` 取值与 ISA 一致(见 `primo_gemm.md` §3.1)。
- 单条 MLI_GEMM 指令 tile 由 `gemm_mode` 唯一决定:K(LHS dim0_max)与 N(RHS dim0_max)不可改写。SKILL.md `计算吞吐` 段的 KxN 表(64x32 / 32x64 / 16x32 / 64x64)就是这张 mode 表的算子层投影。
- 通过 `tcle::matrix_t<M, K, Type, Mode>` 选择 mode → 间接选择 ISA 层 `gemm_mode` 编码。Primo++ 与 SKILL 主体的"算子层 N=128"是若干条 MLI_GEMM 沿 N 方向在 OACC 上列拼接累加得到(详见 `primo_gemm.md` §3.1 N=128 硬件根因子节)。

### MLI_GEMM 的 zero padding 编程要点

- 算子代码层通过 `setslice` 或 `set_spr<LHS_DIM1_REAL{0,1,2}>` 设置三段 real size,Hardware 自动按 head / body / tail 处理,不需要手动写 zero。
- ISA4.0 之前 zero padding 由 SDTE 完成;ISA4.0 中每个 SIP 不再有 SDTE,改由 GEMM 指令本体在加载时按 IV vector 粒度生成。算子层不需要感知,但被 zero padding 的方向(LHS dim1 / RHS dim0)必须与 feature 的 H/W 维度一致,Ci(N)方向不允许有 zero padding。

### Instruction Packaging Constraint

MLI 族打包硬约束:

- **固定打包**(§12.1):`MLI_VLDXOA` / `MLI_VSTXOA` / `MLI_VLDXI32OA` / `MLI_VSTXI32OA` 必须与 C-slot 的 `MLI_HINT` 打包;`MLI_GEMM` 必须与 C-slot 的 `MLI_HINT_GEMM` 打包。
- **单独打包**(§12.2):`L0P5_INV` / `MOVS.BARRIER` / `IDMA` / `ITAGOP` / `TRAP0/1` / `ERET` / `SCHED/SCHED_I` / `HALT` / `WAIT/WAIT_I` / `MOVSR2SPR MODE_WRK` / 所有跳转指令 只能与 NOP 打包(注:跳转指令"能少用就少用",单 sub-thread 执行标量操作发挥不出完整性能)。
- **Register Hazard**(§12.3):VLIW 包内不允许同时读 + 写或多写同一个 SR / TAR / OACC;访问 OACC 的最小粒度是 OACC,但部分指令(如混精指令、GEMM)操作数粒度大于 1 OACC,此时按它们的实际占用 OACC 集合检查 hazard。VL SPR 有特例:`L.MOVSR2SPR SPR_VL` + 同包中位于 M slot 或 V slot 且使用 VL 的指令,允许"先读后写"。
- **Memory Hazard**(§12.4):VLIW 包内不允许跨 slot 出现 R/W 或 W/W 地址重叠(包括 RO / WO 属性的指令);单条指令内允许 Load Element 间相同地址,但 Scatter Store(`MLI_VSTXOA` / `MLI_VSTXI32OA` / `MRADIX_STXOA` / `VSTEOA`)不允许有效 Store Element 之间相同地址。
- **违反后果**(§12.5):执行结果不可测,可能导致流水线无响应。

### 与同 skill 其他文档的关系

- `../SKILL.md` §"2D 计算 / 计算吞吐 / gemm_mode 编码表" — 算子层用什么 mode、KxN tile 是多少、N=128 怎么拼、SPR 怎么写。本文件 §gemm_mode 全集表是 SKILL 主体那张表的 ISA 层完整版,SKILL 主体与本表保持 mode + KxN 一致,不重复展开 dtype 联合 / dacc_pos / dst_stride 等指令编码细节。
- `primo_gemm.md` §3.1 — Primo++ MMA_Op 算子层全集表(M、N=128、K)+ N=128 OACC 4096 bit 根因 + worked example。本文件保持 ISA 字面 M={8,16,32,64,128}(编码 lhs_row_max ∈ [0,4])与 primo_gemm 一致。
- `sip4_spr_spec.md` — SPR `LHS_DIM*_REAL` / `RHS_DIM*_REAL` / `LHS_DIM*_STRIDE` / `RHS_DIM*_STRIDE` / `NACCOVR` 的字段位宽、reset value、Sharing 层级。本文件 §Implicit Use 列出 GEMM 隐式读取的 SPR,不重复 SPR 字段语义。
- `l0p5_invalidation.md` / `l0p5_perf_tuning.md` — `L0P5_INV` 单独打包约束在本文件 §Packaging Constraint 点名,完整 buf_id 状态机与 INV 时机由 L0P5 文档负责。

## AMO (Atomic Memory Operations)

### Scalar Atomic Instructions

Two categories:
- With return value: atomic operation returns previous memory value
- Without return value: atomic reduce (fire-and-forget)

### Vector Atomic Instructions

Vector atomics operate on L3 memory only (not L1/L2):
- Used for reduce operations and multi-thread synchronization
- Support both returned and non-returned variants

| Instruction | Operation | Constraint |
|-------------|-----------|-----------|
| AMOADD | Atomic add | L3 only |
| AMOMAX | Atomic max | L3 only |
| AMOMIN | Atomic min | L3 only |
| AMOMAXU | Atomic unsigned max | L3 only |
| AMOMINU | Atomic unsigned min | L3 only |
| AMOAND | Atomic AND | L3 only |
| AMOOR | Atomic OR | L3 only |
| AMOXOR | Atomic XOR | L3 only |
| AMOSWAP | Atomic swap | L3 only |

All vector atomic instructions must target L3 addresses. Issuing to L1/L2 results in undefined behavior.

## V-slot: Vector Load/Store Basics

| Instruction | Function | Slot |
|-------------|----------|------|
| VLD | Vector load from memory to VACC | V-slot |
| VST | Vector store from VACC to memory | V-slot |
| VLDOA | Vector load with OACC addressing | V-slot |
| VSTOA | Vector store with OACC addressing | V-slot |
| TVLDOA | Tensor vector load with OA addressing + transpose | V-slot (or M-slot) |
| TVSTOA | Tensor vector store with OA addressing + transpose | V-slot |

### VLDST Address Alignment

All VLDST instructions require start address aligned to element width:
- For 8-bit data: byte-aligned
- For 16-bit data: 2-byte aligned
- For 32-bit data: 4-byte aligned
- For 64-bit data: 8-byte aligned

### VL (Vector Length) Interaction

All vector LD/ST instructions support VL dynamic control:
- Elements with index < VL are in "body" (normal operation)
- Elements with index >= VL are in "tail" (load: retain original value; store: not written)

### TVLDOA/TVSTOA

Support 8bit/16bit/64bit data format conversion between linear and interleaved VACC layout:
- TVLDOA: load from memory to VACC with automatic data rearrangement
- TVSTOA: store from VACC to memory with transpose
- Conversion between linear排列 and interleaved VACC排列 is transparent to software

## VACC Indirect Addressing (OACC)

VACC access uses indirect addressing via SPR VAB registers:
- VACC_index = VAB_VPT* + {instruction VACC field}
- Two VAB SPRs track VAB for VPT0 and VPT1 respectively
- DACC = 2 VACC, QACC = 4 VACC, OACC = 8 VACC

### OACC0 Restrictions

Certain instructions cannot have destination register as VACC0/OACC0:
- Background: some instructions with mixed-precision exceed 1 OACC granularity, split across OACC boundaries for execution; if destination is OACC0, source/destination overlap causes incorrect results
- Affected: MOP.XOR_U32MIX, MOP.MUL_HI, MOP.WMUL_I64MIX, MOP.CVT, MOP.WADD_I32MIX, MOP.WMULUS_I32MIX, MOP.WMUL_I32MIX, MOP.MUL_F32MIX, MOP.MUL_F16MIX, MOP.MUL_I32MIX, MOP.ADD_F32MIX, MOP.ADD_F16MIX, MOP.ADD_I32MIX, MOP.MAC, MOP.MAS, MOP.IMAS (and F32MIX/F16MIX variants), MOP.FCLASS, MSF, MOP.BCAST, MRADIX_OFFSET, REDSUM(stage=3), REDMAX(stage=3), REDMIN(stage=3)

### Source/Destination Overlap Restriction

For the same set of instructions above, input and output VACC registers must not overlap at the smallest OACC granularity level.

## Floatpoint Support

### Rounding Mode (SPR MODE_WRK)

| Bits | Controls | Values |
|------|----------|--------|
| MODE_WRK[1:0] | FP16 rounding | 0=RNE, 1=RTZ, 2-3=Reserved |
| MODE_WRK[3:2] | FP32 rounding | 0=RNE, 1=RTZ, 2-3=Reserved |
| MODE_WRK[5:4] | BF16 rounding | 0=RNE, 1=RTZ, 2-3=Reserved |

MOP.CVT has its own rounding mode encoded in the instruction (not affected by MODE_WRK).

### Denormal Flush (SPR MODE_WRK)

| Bits | Controls | Values |
|------|----------|--------|
| MODE_WRK[9:8] | FP16 denormal flush | 0=none, 1=output only, 2=input only, 3=both |
| MODE_WRK[11:10] | FP32 denormal flush | Same |
| MODE_WRK[13:12] | BF16 denormal flush | Same |

### NaN Result Convention

All MALU instructions outputting floating-point (except specific instructions below) produce canonical NaN:
- FP32: 0x7FFFFFFF
- FP16: 0x7FFF
- BF16: 0x7FFF
- FP8 E4M3: 0x7F
- FP8 E5M2: 0x7F

Exceptions (define their own NaN): MOP.GETM, MOP.GETE, MOP.FUSE

## Register Resources Summary

| Register | Count | Width | Per-VPT? |
|----------|-------|-------|----------|
| SR (Scalar Register) | 32 | 64-bit | N (shared across VPTs) |
| SCC (Condition Code) | 1 set | 2 bits (carry+compare) | N (shared) |
| SPR (Special Purpose) | 256 | 64-bit | N (shared, but some per-HW-thread) |
| TAR (Thread Address) | 32 * VPT_NUM | 64-bit | Y (per-VPT) |
| VACC (Accumulation) | 6144 | 512-bit per entry | Y (per-VPT) |

VA resource: VA_NUM=6144, VA_INT_W=32, VA_INT_LANE_NUM=16, VA_MAX_LANE_NUM=64 lanes, VA_WIDTH=512-bit per entry.
