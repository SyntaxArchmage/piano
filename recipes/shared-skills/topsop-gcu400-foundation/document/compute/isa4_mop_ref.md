# ISA4.0 MOP 指令族(MALU 1D element-wise 算术 / 逻辑 / 比较 / mixed-precision)

> `isa4_msf_ref.md` 已覆盖 MSF / MID / RED 三类 2D 通路指令,本文不复述。

## 1. MOP 族总览

MOP serial 是 MALU-slot 上 element-wise 与 maskbit 类指令的统称,所有 MOP 指令共用同一套 48-bit MALU-slot 编码骨架,通过 `sub-code` × `opcode` 区分具体指令,大量字段(`dwidth` / `vm` / `LCE` / `dtype` / `OACCs1` / `OACCs2` / `OACCd`)语义在族内一致。84 节按功能分 8 组:

| 组别 | 包含指令 |
| :-- | :-- |
| 基础算术 | `MOP.ADD` / `MOP.SUB` / `MOP.MUL` / `MOP.MUL_HI` / `MOP.SQR` / `MOP.ABS` / `MOP.NEG` / `MOP.INV` / `MOP.MIN` / `MOP.MAX` / `MOP.ABSMAX` / `MOP.MINNUM` / `MOP.MAXNUM` / `MOP.ABSMAXNUM` / `MOP.FUSE` / `MOP.GETE` / `MOP.GETM` / `MOP.MUL_SCL` |
| 位移 | `MOP.SLL` / `MOP.SRA` / `MOP.SRL` / `MOP.SLRO` / `MOP.SRRO` / `MOP.SLLI` / `MOP.SRLI` / `MOP.SRAI` / `MOP.SLROI` / `MOP.SRROI` |
| 逻辑 | `MOP.AND` / `MOP.OR` / `MOP.XOR` / `MOP.MERGE` |
| dtype 转换 | `MOP.CVT` |
| Carry 系列 | `MOP.CADD` / `MOP.CSUB` / `MOP.CMUL` / `MOP.CSLL` / `MOP.CSLLI` |
| 比较 → maskbit | `MOP.MSEQ` / `MOP.MSNE` / `MOP.MSLT` / `MOP.MSLE` / `MOP.MSGE` / `MOP.MSGT` |
| Maskbit 自身逻辑 / serial | `MOP.MAND` / `MOP.MOR` / `MOP.MXOR` / `MOP.MANDN` / `MOP.MORN` / `MOP.MNAND` / `MOP.MNOR` / `MOP.MXNOR` / `MOP.MSBF` / `MOP.MSIF` / `MOP.MSOF` / `MOP.MIOTA` |
| Mixed-precision 算术 | `MOP.MUL_F32MIX` / `MOP.MUL_F16MIX` / `MOP.MUL_I32MIX` / `MOP.WMUL_I32MIX` / `MOP.WMUL_I64MIX` / `MOP.ADD_F32MIX` / `MOP.ADD_F16MIX` / `MOP.ADD_I32MIX` / `MOP.WADD_I32MIX` / `MOP.WMULUS_I32MIX` / `MOP.MAC` / `MOP.MAS` / `MOP.IMAS` / `MOP.MAC_F32MIX` / `MOP.MAS_F32MIX` / `MOP.IMAS_F32MIX` / `MOP.MAC_F16MIX` / `MOP.MAS_F16MIX` / `MOP.IMAS_F16MIX` / `MOP.XOR_U32MIX` |
| 杂项 / bit 操作 | `MOP.FCLASS` / `MOP.POPC` / `MOP.CLZ` / `MOP.CLS` / `MOP.BREV` / `MOP.SIGN` / `MOP.BCAST` |

族级特性:

- 全族走 MALU-slot,与 GEMM / MSF / RED 等占用 MLI-slot 的 2D 通路指令分通道。
- 支持 INT8/UINT8、INT16/UINT16、INT32/UINT32、INT64/UINT64(ISA4.0 新增)、FP8 E4M3 / FP8 E5M2(ISA4.0 新增,**仅 `MOP.CVT` 与 `MOP.FCLASS` 支持**)、FP16、BF16、FP32。
- 除部分 maskbit 逻辑指令外,其他指令均支持基于 maskbit 的条件写回(`vm=0`)。
- 寄存器寻址统一为 OACC 颗粒度(10-bit OACC 域)与 VACC 颗粒度(10-bit VACC 域)。

## 2. 编码通用约定(§8.8.3)

### 2.1 48-bit MALU-slot 公共字段骨架

绝大多数 MOP 指令采用同一套 48-bit MALU-slot 字段布局,字段位段固定。以 `MOP.ADD` 为骨架范例(其余指令在此基础上变化 `sub-code` / `opcode` / 个别字段):

| Bit 段 | 字段 | 含义 |
| :-- | :-- | :-- |
| 47..44 | `sub-code` | 子指令编码,与 `opcode` 联合区分具体指令 |
| 43..42 | `dwidth` | element 数据宽度,0=8b / 1=16b / 2=32b / 3=64b |
| 41 | `vm` | 写回模式,0=条件写回 / 1=非条件写回 |
| 40 | `LCE` | MALU-slot 寄存器互锁控制位(参见 §8.1) |
| 39..38 | `dtype` | 数据类型副,与 `dwidth` 联合表达完整 data type |
| 37..36 | N/A | 保留 |
| 35..26 | `OACCs1` | 源操作数 1 的 10-bit OACC 索引 |
| 25..16 | `OACCs2` | 源操作数 2 的 10-bit OACC 索引(单源指令置 N/A) |
| 15..6 | `OACCd` | 目的操作数的 10-bit OACC 索引 |
| 5..2 | `opcode` | 指令操作码 |
| 1 | `Const_0` | 固定 0 |
| 0 | `MCE` | MALU-slot 指令使能位 |

### 2.2 OACC / VACC 寻址公式

- OACC 寻址:`VACC*_index = VAB_VPT* + {OACC* + 3'b0}`,`OACC*_index = VACC*_index >> 3`,即 1 OACC = 8 个连续 VACC。
- VACC(maskbit)寻址:`VACC*_index = VACC* + VAB_VPT*`(maskbit 类指令直接给出 10-bit VACC 索引)。
- VAB_VPT* 由 `VAB_VPT0` / `VAB_VPT1` SPR 在两条 VPT 上分别提供基址。

### 2.3 maskbit 条件写回公式

- 当 `vm = 0` 时,采用 `VACC[0+VAB_VPT*]`(VAB 起始处的 maskbit 寄存器)中前 `64 * 2^(3-dwidth)` 个 bit 作为写回 mask:dwidth=0 → 512 bit;dwidth=1 → 256 bit;dwidth=2 → 128 bit;dwidth=3 → 64 bit。
- mask[i] = 1 时 element 写回,= 0 时 VACCd 对应位置保持原值。
- 当 `vm = 1` 时,非条件写回,完整覆盖目的寄存器。

### 2.4 VL / VPT / TCTL 通用语义

- `VL` 影响:`VL=0` → 整条指令视为 NOP;`VL` 非 0 → 执行包括 vl tail 在内的完整 element。所有 MOP 指令 Implicit Use `VL`。
- `TCTL` 关闭某 VPT 时,该 VPT 上的指令视为 NOP。所有 MOP 指令 Implicit Use `TCTL`。
- 所有 MOP 指令 Implicit Use `VAB_VPT*`(VAB_VPT0 + VAB_VPT1)。

### 2.5 浮点行为(rounding / saturation / clamp / denormal)

- **Rounding**:除 `MOP.CVT` 外,浮点结果舍入由 `MODE_WRK.rounding` 决定,支持 RNE 与 RZ 两种 IEEE754 模式。`MOP.CVT` 由指令自身的 `rnd` 域决定,且浮点 → 整型转换额外支持 IEEE754 向 +∞ 舍入(rounding-up)与向 -∞ 舍入(rounding-down)以支持 ceil / floor。
- **Saturation**:精度不变且结果为整型的 element-wise 指令**不做** saturation,溢出保留 LSB;混精指令始终 saturation;`MOP.CVT` 整型结果始终 saturation。
- **Clamp**:结果为 FP16 / BF16 时,除 `MOP.CVT` 外,受 `MODE_WRK.fp16_ovclp` / `MODE_WRK.bf16_ovclp` 影响——超出可表示数值且非直接 INF 时,clamp 在正负最大可表示数值上,忽略舍入到 INF 的要求;`MOP.CVT` 用指令编码的 `clamp` 域(对 INT8 / FP16 / BF16 / FP8_E4M3 / FP8_E5M2 生效),其中 INT8 clamp 含义为"saturation 边界为 -127~127 而非 -128~127"。
- **Denormal flush**:加 / 减 / 乘 / 平方 / MSF 等浮点算术指令的 input / output 受 `MODE_WRK.denormal_flush` 影响——FP32 / FP16 / BF16 各有 input / output 两个 2-bit 控制域。

### 2.6 OACC / VACC 颗粒度与变宽规则

- 操作位宽为 OACC 颗粒度的指令通过 10-bit OACC 域寻址,VACC 颗粒度的指令通过 10-bit VACC 域寻址。
- 精度变化指令:**变宽** N 倍 → src 1 OACC / dst N OACC;**变窄** N 倍 → src N OACC / dst 1 OACC。
- maskbit 产生指令最大支持到 512 bit,可写回 `VAB_VPT*` 起始的 1024 个 VACC 寄存器范围内任一个;maskbit 逻辑指令对整个 VACC 运算。
- 非混精指令支持 INT64 / UINT64,固定使用 OACC 作为 src / dst。

## 3. 基础算术(§8.8.4 ~ §8.8.21)

### 3.1 主路径:MOP.ADD(§8.8.4)

48-bit 编码字段同 §2.1 公共骨架。

```
MOP.ADD: OACCd[i] = OACCs1[i] + OACCs2[i];
```

整型加法溢出保留 LSB(无 saturation);BF16 / FP16 受 `MODE_WRK.fp16_ovclp` / `bf16_ovclp` clamp;FP32 受 `MODE_WRK.denormal_flush` / `rounding`。

合法 dtype × dwidth 组合(本表称为"完整 11 行 dtype 表",后续指令以此为参考):

| Data type | dtype | dwidth |
| :-- | :-- | :-- |
| UINT8 | 0 | 0 |
| INT8 | 1 | 0 |
| UINT16 | 0 | 1 |
| INT16 | 1 | 1 |
| UINT32 | 0 | 2 |
| INT32 | 1 | 2 |
| UINT64 | 0 | 3 |
| INT64 | 1 | 3 |
| FP16 | 2 | 1 |
| BF16 | 3 | 1 |
| FP32 | 2 | 2 |

Implicit Use:`VAB_VPT*` / `MODE_WRK.denormal_flush` / `MODE_WRK.rounding` / `MODE_WRK.fp16_ovclp` / `MODE_WRK.bf16_ovclp` / `TCTL` / `VL`。

### 3.2 SUB / MUL / SQR / ABS / NEG(§8.8.5 / 8.8.6 / 8.8.8 / 8.8.14 / 8.8.15)

字段布局与 ADD 完全一致;算法与 dtype 限制差异:

| 指令 | 算法 | dtype 限制 vs §3.1 | src 宽度 |
| :-- | :-- | :-- | :-- |
| `MOP.SUB` | `OACCd[i] = OACCs1[i] - OACCs2[i]` | 同 §3.1 完整 11 行 | 双源 |
| `MOP.MUL` | `OACCd[i] = OACCs1[i] * OACCs2[i]` | 同 §3.1 完整 11 行 | 双源 |
| `MOP.SQR` | `OACCd[i] = OACCs1[i]^2` | 同 §3.1 完整 11 行 | **单源**,OACCs2 字段 N/A |
| `MOP.ABS` | `OACCd[i] = ABS(OACCs1[i])` | 同 §3.1 完整 11 行 | **单源**;Implicit Use 无 `rounding` / OVCLP |
| `MOP.NEG` | `OACCd[i] = -OACCs1[i]` | **去掉 UINT 4 行**,只留 INT8/16/32/64 与 FP16/BF16/FP32 | **单源**;Implicit Use 无 `rounding` / OVCLP |

`MOP.ABS`:有符号整型输入按无符号整型处理结果,即 INT8 的 -128 输出 UINT8 的 128(INT16/32/64 同理)。
`MOP.NEG`:仅支持有符号输入;有符号整型绝对值最大的负数取相反数后返回相同数值(INT8 的 -128 → -128)。

### 3.3 MUL_HI(§8.8.7)

```
MOP.MUL_HI: OACCd[i] = HI_HALF(OACCs1[i] * OACCs2[i]);
```

两个 INT32 或两个 UINT32 相乘,取 INT64 / UINT64 结果的高 32 bit。

合法 dtype × dwidth:

| Data type | dtype | dwidth |
| :-- | :-- | :-- |
| INT32 | 1 | 2 |
| UINT32 | 0 | 2 |

源 / 目的不能互相覆盖,`vm=0` 时 OACCd 不能为 0。

### 3.4 MIN / MAX / MINNUM / MAXNUM / ABSMAX / ABSMAXNUM(§8.8.20 / 21 / 23 / 24 / 22 / 25)

dtype × dwidth 全部同 §3.1 完整 11 行;Implicit Use 含 `denormal_flush`,**不含** `rounding` / OVCLP。

| 指令 | 算法 | NaN 行为 |
| :-- | :-- | :-- |
| `MOP.MIN` | `min(OACCs1[i], OACCs2[i])` | 任一输入 NaN → 输出 ISA 规定的标准 NaN(IEEE754-2019) |
| `MOP.MAX` | `max(OACCs1[i], OACCs2[i])` | 同上 |
| `MOP.ABSMAX` | `max(abs(OACCs1[i]), abs(OACCs2[i]))` | 同 MOP.MAX |
| `MOP.MINNUM` | `minnum(...)` | 仅一个 NaN → 选非 NaN 数值;两个均 NaN → 标准 NaN |
| `MOP.MAXNUM` | `maxnum(...)` | 同 MINNUM |
| `MOP.ABSMAXNUM` | `maxnum(abs(...), abs(...))` | 同 MAXNUM |

ABS 过程中,有符号整型按无符号整型处理(INT8 -128 → UINT8 128)。

### 3.5 INV / FUSE / GETE / GETM(§8.8.16 / 8.8.26 / 8.8.27 / 8.8.28)

| 指令 | 算法 | 合法 dtype |
| :-- | :-- | :-- |
| `MOP.INV` | `OACCd[i] = ~OACCs1[i]`(按 bit 取反,**单源**) | UINT8 / 16 / 32 / 64 |
| `MOP.FUSE` | `OACCd[i] = {OACCs2[i].sign, OACCs1[i].exp, OACCs2[i].mantissa}`(取 src1 指数 + src2 符号与尾数) | FP16 / BF16 / FP32 |
| `MOP.GETE` | `OACCd[i] = {0扩展, OACCs1[i].exp}`(取 exponent 0 扩展;FP32 → UINT32,FP16/BF16 → UINT16,**单源**) | FP16 / BF16 / FP32 |
| `MOP.GETM` | `OACCd[i] = {sign, 0扩展, recover_bit, mantissa}`(取 mantissa 0 扩展;FP32/BF16 N=7,FP16 N=4;**单源**) | FP16 / BF16 / FP32 |

`MOP.FUSE` / `MOP.GETE` / `MOP.GETM` 对 NaN 输入不敏感,作正常浮点处理。`MOP.GETM` 中 `recover_bit` 是 IEEE754 隐藏小数位:0 / denormal / INF / NaN 时为 0,其余为 1。

### 3.6 MUL_SCL(§8.8.59)

```
MOP.MUL_SCL: OACCd[i] = OACCs1[i] * SR[Rs1];
```

来自 SR 的浮点标量广播乘 OACC 浮点向量,结果回写 OACC。BF16 / FP16 受 OVCLP clamp。指令带 `Rs1` 域(20..16)定位标量寄存器。

合法 dtype × dwidth:

| Data type | dtype | dwidth | Rs1 取位 |
| :-- | :-- | :-- | :-- |
| FP16 | 2 | 1 | SR[15:0] |
| BF16 | 3 | 1 | SR[15:0] |
| FP32 | 2 | 2 | SR[31:0] |

Implicit Use:`VAB_VPT*` / `MODE_WRK.denormal_flush` / `MODE_WRK.rounding` / `MODE_WRK.fp16_ovclp` / `MODE_WRK.bf16_ovclp` / `TCTL` / `VL`。

## 4. 位移与立即数变体(§8.8.9 ~ §8.8.13、§8.8.30 ~ §8.8.34)

### 4.1 寄存器版(§8.8.9 / 10 / 11 / 12 / 13)

字段布局同 §2.1;移位量取自 `OACCs2[i][dwidth+2:0]`(自动按数据宽度截位)。

| 指令 | 算法 | 合法 dtype |
| :-- | :-- | :-- |
| `MOP.SLL` | `OACCs1[i] << OACCs2[i][dwidth+2:0]`(逻辑左移) | UINT8/16/32/64 |
| `MOP.SRA` | `OACCs1[i] >>> OACCs2[i][dwidth+2:0]`(算术右移) | INT8/16/32/64 |
| `MOP.SRL` | `OACCs1[i] >> OACCs2[i][dwidth+2:0]`(逻辑右移) | UINT8/16/32/64 |
| `MOP.SLRO` | `{OACCd[i], _} = {OACCs1[i], OACCs1[i]} << OACCs2[i][dwidth+2:0]`(循环左移) | UINT8/16/32/64 |
| `MOP.SRRO` | `{_, OACCd[i]} = {OACCs1[i], OACCs1[i]} >> OACCs2[i][dwidth+2:0]`(循环右移) | UINT8/16/32/64 |

### 4.2 立即数版(§8.8.30 / 31 / 32 / 33 / 34)

字段布局变化:`OACCs2`(25..16)被替换为 `Imm6`(21..16)+ 4 个 Const_0 占位(25..22),立即数为 6-bit 无符号,使用方式 `uimm-6[dwidth+2:0]`。

| 指令 | 算法 | 合法 dtype |
| :-- | :-- | :-- |
| `MOP.SLLI` | `OACCs1[i] << uimm6[dwidth+2:0]`(立即数逻辑左移) | UINT8/16/32/64 |
| `MOP.SRLI` | `OACCs1[i] >> uimm6[dwidth+2:0]`(立即数逻辑右移) | UINT8/16/32/64 |
| `MOP.SRAI` | `OACCs1[i] >>> uimm6[dwidth+2:0]`(立即数算术右移) | INT8/16/32/64 |
| `MOP.SLROI` | `{OACCd[i], _} = {OACCs1[i], OACCs1[i]} << uimm6[dwidth+2:0]`(立即数循环左移) | UINT8/16/32/64 |
| `MOP.SRROI` | `{_, OACCd[i]} = {OACCs1[i], OACCs1[i]} >> uimm6[dwidth+2:0]`(立即数循环右移) | UINT8/16/32/64 |

## 5. 逻辑(§8.8.17 / 18 / 19 / 35)

字段布局同 §2.1。

| 指令 | 算法 | 合法 dtype | 备注 |
| :-- | :-- | :-- | :-- |
| `MOP.AND` | `OACCs1[i] & OACCs2[i]` | UINT8/16/32/64 | 按 bit 与 |
| `MOP.OR` | `OACCs1[i] \| OACCs2[i]` | UINT8/16/32/64 | 按 bit 或 |
| `MOP.XOR` | `OACCs1[i] ^ OACCs2[i]` | UINT8/16/32/64 | 按 bit 异或 |
| `MOP.MERGE` | `OACCd[i] = maskbit(i) ? OACCs1[i] : OACCs2[i]` | dwidth 任意(0/1/2/3 表示 8/16/32/64-bit element) | 见下 |

`MOP.MERGE`(§8.8.35)语义特殊:`vm` 必须固定为 0,但**不表示条件写回**,而是把 maskbit 作为输入,选择 src1 或 src2 写入 dst,因此 dst 总是被完整覆盖。maskbit 取 `VACC[0+VAB_VPT*]` 中前 `64 * 2^(3-dwidth)` 个 bit。

## 6. dtype 转换:MOP.CVT(§8.8.29)

48-bit 编码字段差异:

| Bit 段 | 字段 |
| :-- | :-- |
| 47..44 | `sub-code` |
| 43..42 | `rnd`(舍入模式,见下) |
| 41 | `vm` |
| 40 | `LCE` |
| 39..36 | N/A |
| 35..26 | `OACCs1` |
| 25 | N/A |
| 24 | `clamp` |
| 23..16 | `mode`(8-bit cvt 模式编码) |
| 15..6 | `OACCd` |
| 5..2 | `opcode` |
| 1 | `Const_0` |
| 0 | `MCE` |

```
MOP.CVT: OACCd[i] = cvt_mode(OACCs1[i]);
```

### 6.1 mode 全集

| mode | 转换 | 宽度变化 | src/dst OACC |
| :-- | :-- | :-- | :-- |
| 0x0 | FP16 → INT16 | 不变 | 1 / 1 |
| 0x1 | FP32 → INT32 | 不变 | 1 / 1 |
| 0x2 | BF16 → INT16 | 不变 | 1 / 1 |
| 0x3 | FP16 → INT32 | 变宽 2x | 1 / 2 |
| 0x4 | FP32 → INT16 | 变窄 1/2 | 2 / 1 |
| 0x5 | BF16 → INT32 | 变宽 2x | 1 / 2 |
| 0x6 | FP16 → INT8 | 变窄 1/2 | 2 / 1 |
| 0x7 | BF16 → INT8 | 变窄 1/2 | 2 / 1 |
| 0x8 | FP32 → INT8 | 变窄 1/4 | 4 / 1 |
| 0x9 | FP32 → UINT8 | 变窄 1/4 | 4 / 1 |
| 0x10 | UINT8 → FP16 | 变宽 2x | 1 / 2 |
| 0x11 | INT8 → FP16 | 变宽 2x | 1 / 2 |
| 0x12 | UINT8 → BF16 | 变宽 2x | 1 / 2 |
| 0x13 | INT8 → BF16 | 变宽 2x | 1 / 2 |
| 0x14 | UINT16 → FP32 | 变宽 2x | 1 / 2 |
| 0x15 | INT16 → FP32 | 变宽 2x | 1 / 2 |
| 0x16 | UINT32 → FP32 | 不变 | 1 / 1 |
| 0x17 | INT32 → FP32 | 不变 | 1 / 1 |
| 0x18 | UINT16 → FP16 | 不变 | 1 / 1 |
| 0x19 | INT16 → FP16 | 不变 | 1 / 1 |
| 0x1A | UINT16 → BF16 | 不变 | 1 / 1 |
| 0x1B | INT16 → BF16 | 不变 | 1 / 1 |
| 0x1C | UINT8 → FP32 | 变宽 4x | 1 / 4 |
| 0x1D | INT8 → FP32 | 变宽 4x | 1 / 4 |
| 0x20 | FP16 → FP32 | 变宽 2x | 1 / 2 |
| 0x21 | FP32 → FP16 | 变窄 1/2 | 2 / 1 |
| 0x22 | BF16 → FP32 | 变宽 2x | 1 / 2 |
| 0x23 | FP32 → BF16 | 变窄 1/2 | 2 / 1 |
| 0x30 | UINT32 → UINT16 | 变窄 1/2 | 2 / 1 |
| 0x31 | INT32 → INT16 | 变窄 1/2 | 2 / 1 |
| 0x32 | UINT16 → UINT8 | 变窄 1/2 | 2 / 1 |
| 0x33 | INT16 → INT8 | 变窄 1/2 | 2 / 1 |
| 0x34 | UINT16 → UINT32 | 变宽 2x | 1 / 2 |
| 0x35 | INT16 → INT32 | 变宽 2x | 1 / 2 |
| 0x36 | UINT8 → UINT16 | 变宽 2x | 1 / 2 |
| 0x37 | INT8 → INT16 | 变宽 2x | 1 / 2 |
| 0x40 | INT64 → FP32 | 变窄 1/2 | 2 / 1 |
| 0x41 | INT64 → FP16 | 变窄 1/4 | 4 / 1 |
| 0x42 | FP16 → FP8_E4M3 | 变窄 1/2 | 2 / 1 |
| 0x43 | FP16 → FP8_E5M2 | 变窄 1/2 | 2 / 1 |
| 0x44 | FP32 → FP8_E4M3 | 变窄 1/4 | 4 / 1 |
| 0x45 | FP32 → FP8_E5M2 | 变窄 1/4 | 4 / 1 |
| 0x46 | FP8_E4M3 → FP16 | 变宽 2x | 1 / 2 |
| 0x47 | FP8_E5M2 → FP16 | 变宽 2x | 1 / 2 |
| 0x48 | FP8_E4M3 → FP32 | 变宽 4x | 1 / 4 |
| 0x49 | FP8_E5M2 → FP32 | 变宽 4x | 1 / 4 |
| 0x4A | BF16 → FP8_E4M3 | 变窄 1/2 | 2 / 1 |
| 0x4B | BF16 → FP8_E5M2 | 变窄 1/2 | 2 / 1 |
| 0x50 | UINT32 → UINT64 | 变宽 2x | 1 / 2 |
| 0x51 | UINT64 → UINT32 | 变窄 1/2 | 2 / 1 |
| 0x52 | INT32 → INT64 | 变宽 2x | 1 / 2 |
| 0x53 | INT64 → INT32 | 变窄 1/2 | 2 / 1 |

### 6.2 通用规则

- **不支持** UINT 与 SINT 之间转换。
- 浮点 → 整型且超出整型表达范围 → saturation 到最近边界值;负数转无符号 → 0;NaN 输入 → 无符号目标格式输出全 1(0xFF/0xFFFF/0xFFFFFFFF),有符号目标格式输出 0。
- 浮点 → 浮点超出目标范围:输出 INF 还是 max value 由 `rnd` 与指令 `clamp` 域共同决定。
- 浮点 → FP8 的 NaN / Inf 处理:**E4M3** NaN/Inf 都映射为 E4M3 NaN(E4M3 不存 INF);**E5M2** NaN → E5M2 NaN,Inf → E5M2 Inf。
- 浮点 → FP8 超范围:`clamp=1` → 最邻近的最大可表示数;`clamp=0` → E4M3 输出 NaN / E5M2 输出 INF。
- `rnd` 编码:0 = RNE,1 = RZ,2 = rounding-to-positive-infinity(仅 FP→INT/UINT 有效),3 = rounding-to-negative-infinity(仅 FP→INT/UINT 有效)。
- `clamp` 编码:对 INT8 / FP16 / BF16 / FP8_E4M3 / FP8_E5M2 生效,其他 dtype 无效。INT8 时 `clamp=1` → 负数 saturation 到 -127 而非 -128;FP16 / BF16 / FP8 时 `clamp=1` → 超范围数值 clamp 到正负最大可表示数,而不是 ±INF / NaN。
- **OACCs1 与 OACCd 不能互相覆盖**——原因:CVT 的精度变窄 / 变宽指令在 SIP4.0 上按 OACC 颗粒度拆分发射,SRC/DST 重叠会破坏拆分语义。
- **`vm=0` 时 OACCd 不能为 0**——同样的颗粒度拆分约束。

Implicit Use:`VAB_VPT*` / `MODE_WRK.denormal_flush` / `TCTL` / `VL`。

## 7. Carry 系列(§8.8.36 ~ §8.8.40)

字段布局相对 §2.1 的关键差异:**bit 41 由 `vm` 改为 `N/A`**——本族不支持条件写回(下面"通用规则"详细解释);其余字段含义一致。

### 7.1 主路径:MOP.CADD(§8.8.36)

```
MOP.CADD: VACCd[i:i] = carry(OACCs1[i] + OACCs2[i]);
```

加法溢出 flag 作为 maskbit 写入 VACCd。

合法 dtype × dwidth:

| Data type | dtype | dwidth |
| :-- | :-- | :-- |
| UINT8 | 0 | 0 |
| INT8 | 1 | 0 |
| UINT16 | 0 | 1 |
| INT16 | 1 | 1 |
| UINT32 | 0 | 2 |
| INT32 | 1 | 2 |
| UINT64 | 0 | 3 |
| INT64 | 1 | 3 |

OACCs1 / OACCs2 按 OACC 寻址,VACCd 按 VACC 寻址(`VACCd_index = VAB_VPT* + VACCd`)。

### 7.2 CSUB / CMUL / CSLL / CSLLI 差异

| 指令 | 算法 | dtype 限制 |
| :-- | :-- | :-- |
| `MOP.CSUB`(§8.8.37) | `carry(OACCs1[i] - OACCs2[i])` | 同 CADD 8 行 |
| `MOP.CMUL`(§8.8.38) | `carry(OACCs1[i] * OACCs2[i])` | 同 CADD 8 行 |
| `MOP.CSLL`(§8.8.39) | `carry(OACCs1[i] << OACCs2[i][dwidth+2:0])` | UINT8/16/32/64 |
| `MOP.CSLLI`(§8.8.40) | `carry(OACCs1[i] << uimm6[dwidth+2:0])` | UINT8/16/32/64 |

`MOP.CSLLI` 字段布局与立即数移位类似:`OACCs2`(25..16)替换为 `Imm6`(21..16)+ Const_0 占位(25..22)。

### 7.3 Carry 系列通用规则

- 仅支持整型数据。
- 由于指令支持 VL,回写结果可能为 1 ~ 512 bit,VACCd 中剩余 bit 全部写 0(即 vl tail 部分也回写 0)。
- **不支持条件回写**(故 bit 41 不是 `vm`)——原因:输出已经是 maskbit 形式的 carry flag,再叠一层 maskbit 条件无语义意义。
- Implicit Use:`VAB_VPT*` / `TCTL` / `VL`。SCC.Carry SPR 由 SCC 类指令(SALU 域)读取,不在本族 Implicit Use 内。

## 8. 比较 → Maskbit(§8.8.41 ~ §8.8.46)

字段布局同 §7(bit 41 为 N/A);源为 OACC,目的为 VACC(maskbit)。

### 8.1 主路径:MOP.MSEQ(§8.8.41)

```
MOP.MSEQ: VACCd[i:i] = (OACCs1[i] == OACCs2[i]) ? 1 : 0;
```

合法 dtype × dwidth(完整 11 行,与 §3.1 相同):UINT8/16/32/64、INT8/16/32/64、FP16、BF16、FP32。

### 8.2 MSNE / MSLT / MSLE / MSGE / MSGT 差异

| 指令 | 算法 | NaN 行为 |
| :-- | :-- | :-- |
| `MOP.MSEQ` | `==` → 1 / 0 | 浮点任一 NaN → 输出 0 |
| `MOP.MSNE` | `!=` → 1 / 0 | 浮点任一 NaN → 输出 1 |
| `MOP.MSLT` | `<` → 1 / 0 | 浮点任一 NaN → 输出 0 |
| `MOP.MSLE` | `<=` → 1 / 0 | 浮点任一 NaN → 输出 0 |
| `MOP.MSGE` | `>=` → 1 / 0 | 浮点任一 NaN → 输出 0 |
| `MOP.MSGT` | `>` → 1 / 0 | 浮点任一 NaN → 输出 0 |

### 8.3 比较类通用规则

- VACCd 写回宽度受 VL 限制(1 ~ 512 bit),vl tail 部分 VACCd 内剩余 bit 写 0。
- **不支持条件回写**——原因同 §7.3:目的本身是 maskbit。
- INT vs UINT 由 dtype 字段(0=UINT, 1=SINT)区分,比较的有符号 / 无符号语义随之变化。
- Implicit Use:`VAB_VPT*` / `MODE_WRK.denormal_flush` / `TCTL` / `VL`。

## 9. Maskbit 自身逻辑与 serial(§8.8.47 ~ §8.8.58)

### 9.1 二元 maskbit 逻辑(§8.8.47 ~ 53、§8.8.54)

字段布局相对 §2.1 的关键差异:

| Bit 段 | 字段 |
| :-- | :-- |
| 47..44 | `sub-code` |
| 43..41 | N/A |
| 40 | `LCE` |
| 39..36 | N/A |
| 35..26 | `VACCs1` |
| 25..16 | `VACCs2` |
| 15..6 | `VACCd` |
| 5..2 | `opcode` |
| 1..0 | `Const_0` / `MCE` |

源 / 目的全部按 10-bit VACC 域编码,直接对整个 VACC 运算;受 VL 限制,vl tail 写 0。

| 指令 | 算法 |
| :-- | :-- |
| `MOP.MAND` | `VACCs1 & VACCs2` |
| `MOP.MOR` | `VACCs1 \| VACCs2` |
| `MOP.MXOR` | `VACCs1 ^ VACCs2` |
| `MOP.MANDN` | `VACCs1 & ~VACCs2` |
| `MOP.MORN` | `VACCs1 \| ~VACCs2` |
| `MOP.MNAND` | `~(VACCs1 & VACCs2)` |
| `MOP.MNOR` | `~(VACCs1 \| VACCs2)` |
| `MOP.MXNOR` | `~(VACCs1 ^ VACCs2)` |

**所有二元 maskbit 逻辑指令均不支持条件回写**——原因同 §7.3。Implicit Use:`VAB_VPT*` / `TCTL` / `VL`。

### 9.2 Maskbit serial:MSBF / MSIF / MSOF(§8.8.55 / 8.8.56 / 8.8.57)

字段布局相对 §9.1 的关键差异:bit 43..42 改为 `dwidth`、bit 41 改为 `vm`(三条 serial 指令支持条件回写);`VACCs2` 字段 N/A。

dwidth 决定单 OACC 内 maskbit 的 bit 数:dwidth=0(对应 8-bit OACC element)→ 选 maskbit[511:0];dwidth=1 → maskbit[255:0];dwidth=2 → maskbit[127:0];dwidth=3 → maskbit[63:0]。

```
MOP.MSBF VACCd, VACCs1   // set-before-first
MOP.MSIF VACCd, VACCs1   // set-including-first
MOP.MSOF VACCd, VACCs1   // set-only-first
```

三条指令共用算法骨架(以 `MSBF` 为代表):

```
for i = 0 .. VPT_NUM-1 {
    int mask_width = 2^(9 - dwidth);
    int elem_nums  = min(mask_width, VL);
    int index      = mask_width;
    bits(mask_width) mask_src = get_maskbit(VACC[i][VACCs1_index], 0, mask_width-1);
    bits(mask_width) mask_vm  = get_maskbit(VACC[i][0],            0, mask_width-1);
    bits(mask_width) mask_dst = get_maskbit(VACC[i][VACCd_index],  0, mask_width-1);

    // 第一遍:找第一个 mask_src[e]==1 的位置 index
    for (e = 0; e < elem_nums; e++) {
        if (vm == 1 || (vm == 0 && mask_vm[e] == 1)) {
            if (mask_src[e] == 1) { index = e; break; }
        }
    }
    // 第二遍:置位区间(MSBF / MSIF / MSOF 仅此处不同)
    for (e = 0; e < elem_nums; e++) {
        bool in_range;
        // MSBF: e <  index || index == mask_width
        // MSIF: e <= index || index == mask_width
        // MSOF: e == index || index == mask_width
        if (in_range) {
            if (vm == 1 || (vm == 0 && mask_vm[e] == 1)) mask_dst[e] = 1;
        } else {
            if (vm == 1 || (vm == 0 && mask_vm[e] == 1)) mask_dst[e] = 0;
        }
    }
    VACC[i][VACCd_index][elem_nums-1:0] = set_maskbit(mask_dst[elem_nums-1:0]);
    VACC[i][VACCd_index][511:elem_nums] = 0;
}
```

- `MOP.MSBF`:置 1 区间为 `e < index`(找到的最低 1 之前)。若 mask_src 全 0,VACCd 全部置 1。
- `MOP.MSIF`:置 1 区间为 `e <= index`(包含找到的最低 1 自身)。若 mask_src 全 0,VACCd 全部置 1。
- `MOP.MSOF`:置 1 区间仅为 `e == index`(只标记找到的最低 1 自身)。若 mask_src 全 0,VACCd 全部置 1。

源 / 目的不能互相覆盖;`vm=0` 时 OACCd 不能为 0。

### 9.3 MIOTA(§8.8.58)

```
MOP.MIOTA OACCd, VACCs1
```

输入 maskbit 寄存器,输出通用 OACC 寄存器(写回 element 固定为 32-bit 有符号整数)。

```
int elem_nums = min(va_length * va_nums / data_width, VL);   // va_length=512 bit
int sum = 0;
for (i = 0; i < elem_nums; i++) {
    if (vm == 1 || (vm == 0 && maskbit(i) == 1)) {
        VACC[VPT*][VACCd + VAB_VPT*][i] = sum;
        sum += VACC[VPT*][VACCs1 + VAB_VPT*][i];
    }
}
```

dwidth 决定累积粒度与 VACCd 输出尺寸:

| dwidth | 含义 | VACCs maskbit 范围 | VACCd 尺寸 |
| :-- | :-- | :-- | :-- |
| 0 | 1 OACC 中 8-bit element | maskbit[511:0] | 4 OACC |
| 1 | 1 OACC 中 16-bit element | maskbit[255:0] | 2 OACC |
| 2 | 1 OACC 中 32-bit element | maskbit[127:0] | 1 OACC |
| 3 | 1 OACC 中 64-bit element | maskbit[63:0] | 1 QACC(=2 VACC) |

源 / 目的不能互相覆盖;`vm=0` 时 OACCd 不能为 0。

## 10. Mixed-precision 算术(§8.8.60 ~ §8.8.78、§8.8.79)

### 10.1 主路径:MOP.MUL_F32MIX(§8.8.60)

字段布局同 §2.1。

```
MOP.MUL_F32MIX: OACCd[i] = OACCs1[i] * OACCs2[i];   // OACCd 与 OACCs2 均为 FP32
```

非 FP32 数据格式与 FP32 相乘,结果回写 FP32。

合法 dtype × dwidth(主路径用以下 6 行,作为 _F32MIX 系列基准):

| Data type(OACCs1) | dtype | dwidth | OACCs1 / OACCs2(=FP32) / OACCd(=FP32) 宽度 |
| :-- | :-- | :-- | :-- |
| UINT8 | 0 | 0 | 1 OACC / 4 OACC / 4 OACC |
| INT8 | 1 | 0 | 1 OACC / 4 OACC / 4 OACC |
| FP16 | 2 | 1 | 1 OACC / 2 OACC / 2 OACC |
| BF16 | 3 | 1 | 1 OACC / 2 OACC / 2 OACC |
| UINT32 | 0 | 2 | 1 OACC / 1 OACC / 1 OACC |
| INT32 | 1 | 2 | 1 OACC / 1 OACC / 1 OACC |

源 / 目的不能互相覆盖;`vm=0` 时 OACCd 不能为 0。Implicit Use:`VAB_VPT*` / `MODE_WRK.denormal_flush` / `MODE_WRK.rounding` / `TCTL` / `VL`。

### 10.2 _F32MIX 系列差异(§8.8.60 / 8.8.65 / 8.8.73 / 8.8.74 / 8.8.75)

字段布局与 §10.1 相同;dtype × dwidth 6 行同 §10.1;Implicit Use 同 §10.1(MAC/MAS/IMAS_F32MIX 多一个 `NACCOVR`,见 §10.5)。

| 指令 | 算法 |
| :-- | :-- |
| `MOP.MUL_F32MIX` | `OACCd = OACCs1 * OACCs2`(OACCs2/d = FP32) |
| `MOP.ADD_F32MIX` | `OACCd = OACCs1 + OACCs2`(OACCs2/d = FP32) |
| `MOP.MAC_F32MIX` | `OACCd = OACCs1 * OACCs2 + OACCd`(OACCs2/d = FP32) |
| `MOP.MAS_F32MIX` | `OACCd = -OACCs1 * OACCs2 + OACCd`(OACCs2/d = FP32) |
| `MOP.IMAS_F32MIX` | `OACCd = OACCs1 * OACCs2 - OACCd`(OACCs2/d = FP32) |

`MAC/MAS/IMAS` 类指令的 OACCs3/d(15..6 域)同时承担第 3 源(累加项)与目的两个角色。

### 10.3 _F16MIX 系列(§8.8.61 / 8.8.66 / 8.8.76 / 8.8.77 / 8.8.78)

字段布局相对 §2.1 的差异:bit 37..36(原 N/A)改为 `ftype`(1 bit + 1 bit padding):

- `ftype=0` → OACCd / OACCs2 数据类型为 FP16,结果受 `MODE_WRK.fp16_ovclp` clamp;
- `ftype=1` → OACCd / OACCs2 数据类型为 BF16,结果受 `MODE_WRK.bf16_ovclp` clamp。

合法 dtype × dwidth(只有 2 行,因为窄目标限制):

| Data type(OACCs1) | dtype | dwidth | OACCs1 / OACCs2 / OACCd 宽度 |
| :-- | :-- | :-- | :-- |
| UINT8 | 0 | 0 | 1 OACC / 2 OACC / 2 OACC |
| INT8 | 1 | 0 | 1 OACC / 2 OACC / 2 OACC |

| 指令 | 算法 |
| :-- | :-- |
| `MOP.MUL_F16MIX` | `OACCd = OACCs1 * OACCs2`(OACCs2/d = FP16 或 BF16) |
| `MOP.ADD_F16MIX` | `OACCd = OACCs1 + OACCs2` |
| `MOP.MAC_F16MIX` | `OACCd = OACCs1 * OACCs2 + OACCd` |
| `MOP.MAS_F16MIX` | `OACCd = -OACCs1 * OACCs2 + OACCd` |
| `MOP.IMAS_F16MIX` | `OACCd = OACCs1 * OACCs2 - OACCd` |

Implicit Use:`VAB_VPT*` / `MODE_WRK.denormal_flush` / `MODE_WRK.rounding` / `MODE_WRK.fp16_ovclp` / `MODE_WRK.bf16_ovclp` / `TCTL` / `VL`(MAC/MAS/IMAS_F16MIX 额外加 `NACCOVR`)。

### 10.4 _I32MIX / _I64MIX / _U32MIX 系列(§8.8.62 ~ 64、67 ~ 69、79)

字段布局基本同 §2.1。

| 指令 | 算法 | dst dtype | 合法 dtype × dwidth(src1) | OACCs1 / OACCs2 / OACCd 宽度 |
| :-- | :-- | :-- | :-- | :-- |
| `MOP.MUL_I32MIX`(§62) | src1 × INT32 → INT32,结果 saturation | INT32 | UINT8 / INT8 | 1 / 4 / 4 |
| `MOP.WMUL_I32MIX`(§63) | 同格式 src1 × src2 → INT32(无溢出) | INT32 | UINT8 / INT8 | 1 / 1 / 4 |
| `MOP.WMUL_I64MIX`(§64) | 同格式 src1 × src2 → INT64 / UINT64(无溢出) | INT64 / UINT64 | INT32 / **UINT32**(命名上偏离规则,但确实支持 UINT32×UINT32→UINT64) | 1 / 1 / 2 |
| `MOP.ADD_I32MIX`(§67) | src1 + INT32 → INT32,结果 saturation | INT32 | UINT8 / INT8 | 1 / 4 / 4 |
| `MOP.WADD_I32MIX`(§68) | 同格式 src1 + src2 → INT32(无溢出) | INT32 | UINT8 / INT8 | 1 / 1 / 4 |
| `MOP.WMULUS_I32MIX`(§69) | UINT8 × INT8 → INT32(无溢出) | INT32 | UINT8(src1) × INT8(src2) | 1 / 1 / 4 |
| `MOP.XOR_U32MIX`(§79) | UINT64 高/低 32 bit 段 XOR → UINT32,见下 | UINT32 | UINT64 | 2 / 2 / 1 |

`MOP.XOR_U32MIX` 字段布局相对 §2.1 的差异:bit 43 = N/A,bit 42 = `sel_hi`,bit 41 = `vm`,bit 40 = `LCE`;算法:

```
MOP.XOR_U32MIX:
    if (sel_hi) OACCd[i][31:0] = XOR(OACCs1[i][63:32], OACCs2[i][63:32]);
    else        OACCd[i][31:0] = XOR(OACCs1[i][31:0],  OACCs2[i][31:0]);
```

可加速 LFSR 类 uniform RNG 算法;全 0 异或可视为一种 shuffle。

`MUL_I32MIX` / `ADD_I32MIX` 整型结果做 saturation;Implicit Use 不含 `denormal_flush` / `rounding` / OVCLP。

### 10.5 MAC / MAS / IMAS(同精度,§8.8.70 / 71 / 72)

字段布局同 §2.1;OACCs3/d(15..6)同时承担第 3 源(累加项)与目的。

| 指令 | 算法 |
| :-- | :-- |
| `MOP.MAC` | `OACCd = OACCs1 * OACCs2 + OACCd` |
| `MOP.MAS` | `OACCd = -OACCs1 * OACCs2 + OACCd` |
| `MOP.IMAS` | `OACCd = OACCs1 * OACCs2 - OACCd` |

合法 dtype × dwidth(整型结果时 INT32 / FP 结果时 FP32):

| Data type(OACCs1/2) | dtype | dwidth | OACCs1/s2 / OACCd 宽度 | 累加结果 dtype |
| :-- | :-- | :-- | :-- | :-- |
| UINT8 | 0 | 0 | 1 / 4 OACC | INT32 |
| INT8 | 1 | 0 | 1 / 4 OACC | INT32 |
| FP16 | 2 | 1 | 1 / 2 OACC | FP32 |
| BF16 | 3 | 1 | 1 / 2 OACC | FP32 |
| FP32 | 2 | 2 | 1 / 1 OACC | FP32 |

整型结果 saturation。受 SPR `NACCOVR` 影响:`NACCOVR[0]=0` 执行累加,`NACCOVR[0]=1` 不执行累加(即视作 `OACCd = OACCs1 * OACCs2`)。

Implicit Use:`VAB_VPT*` / `MODE_WRK.denormal_flush` / `MODE_WRK.rounding` / `TCTL` / `VL` / `NACCOVR`。

### 10.6 Mixed-precision 通用规则

- **源 / 目的不能互相覆盖**——原因:混精指令在 SIP4.0 上按 OACC 颗粒度拆分发射,SRC/DST 重叠会破坏拆分语义。
- **`vm=0` 时 OACCd 不能为 0**——同上颗粒度拆分约束。
- 所有整型结果的混精指令始终 saturation。

## 11. 杂项与 bit 操作(§8.8.80 ~ §8.8.86)

### 11.1 FCLASS(§8.8.80)

```
MOP.FCLASS: OACCd[i] = fclass(OACCs1[i]);
```

按 one-hot 编码(bit 0 ~ 9)对每个浮点 element 分类:

| bit | 含义 |
| :-- | :-- |
| 0 | 负无穷 -∞ |
| 1 | 负规格化数 |
| 2 | 负非规格化数 |
| 3 | -0 |
| 4 | +0 |
| 5 | 正非规格化数 |
| 6 | 正规格化数 |
| 7 | 正无穷 +∞ |
| 8 | Signaling NaN |
| 9 | Quiet NaN |

合法 dtype × dwidth:

| Data type | dtype | dwidth | src/dst 宽度 |
| :-- | :-- | :-- | :-- |
| FP16 | 2 | 1 | 1 OA / 1 OA(UINT16 输出) |
| BF16 | 3 | 1 | 1 OA / 1 OA(UINT16 输出) |
| FP32 | 2 | 2 | 1 OA / 1 OA(UINT32 输出) |
| FP8_E4M3 | 2 | 0 | 1 OA / 2 OA(UINT16 输出,变宽) |
| FP8_E5M2 | 3 | 0 | 1 OA / 2 OA(UINT16 输出,变宽) |

FP8_E4M3 不符合 IEEE754 扩展浮点编码,无 INF 表达,NaN 仅有 QNaN。源 / 目的不能互相覆盖;`vm=0` 时 OACCd 不能为 0。

### 11.2 POPC / CLZ / CLS / BREV(§8.8.81 ~ §8.8.84)

字段布局与 §2.1 单源指令相同(`OACCs2` 字段 N/A)。

| 指令 | 算法 | 合法 dtype |
| :-- | :-- | :-- |
| `MOP.POPC` | `count_bit_one(OACCs1[i])` | UINT8 / 16 / 32 / 64 |
| `MOP.CLZ` | `count_leading_zero(OACCs1[i])` | UINT8 / 16 / 32 / 64 |
| `MOP.CLS` | `count_leading_sign(OACCs1[i])`(包括符号位) | INT8 / 16 / 32 / 64 |
| `MOP.BREV` | `Reverse_bit_order(OACCs1[i])` | UINT8 / 16 / 32 / 64 |

输入 / 输出 element 格式相同。Implicit Use:`VAB_VPT*` / `TCTL` / `VL`。

### 11.3 SIGN(§8.8.85)

```
MOP.SIGN: OACCd[i] = (OACCs1[i] > 0) ? 1 : (OACCs1[i] == 0) ? 0 : -1;
```

输出固定为同位宽**有符号整型**;浮点 ±0 与 NaN 都返回 0。

合法 dtype × dwidth:INT8/16/32/64、FP16、BF16、FP32(7 行)。

### 11.4 BCAST(§8.8.86)

字段布局相对 §2.1 的关键差异:bit 39..36 = N/A,bit 25..21 = N/A,bit 20..16 = `Rs1`(5-bit SR 索引)。

```
MOP.BCAST: OACCd[i] = OACCs1[SR[Rs1]];
```

把 OACCs1 中第 `SR[Rs1]` 个 datalane 的数据复制到 OACCd 每个 datalane;写入受 VL 与 maskbit 影响。

dwidth 决定 broadcast element 宽度(0=8 / 1=16 / 2=32 / 3=64),**dtype 任意**。

VL 双向影响:① `SR[Rs1] >= VL` → 整条指令不执行;② `0 <= SR[Rs1] < VL` → 仅写回 index 0 ~ VL-1 位置。tcle wrapper `tcle::bcastInternal(oacc, index)` 即 `MOP.BCAST` 的算子层入口,语义为"从 OACC 内取第 index 个 element 做向量内 broadcast",不扩展为 SR scalar broadcast。

## 12. 与同 skill 其他文档的关系

- GEMM / MLI_GEMM ISA 编码、VLIW 包结构、Tensor Vector LDST 见 `isa4_instruction_ref.md`。
- MSF / MID / REDMAX / REDMIN / REDSUM 在 MALU 2D 通路上的编码与 stage 行为见 `isa4_msf_ref.md`。
- VMOV(VA / OA / Maskbit 搬移)与 OACC ↔ SR 交互见 `isa4_vmov_ref.md`。
- SCC.Carry / NACCOVR / VAB_VPT* / MODE_WRK / VL / TCTL / LD_BASE 等 SPR 字段宽度与 reset 值见 `sip4_spr_spec.md`。
