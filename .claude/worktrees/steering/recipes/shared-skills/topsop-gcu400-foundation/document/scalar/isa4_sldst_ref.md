# ISA4.0 SLDST 指令族(标量 load/store + AMO)

## 1. SLDST 族总览

SLDST 在 SR ↔ L1-SDMEM / SR ↔ L1-VDMEM / SR ↔ SPR / Imm → SR 之间搬数据,共 25 条指令分 5 类:

| 类别 | 指令 |
| :-- | :-- |
| Scalar Load(SR ← MEM) | `LD` / `LDX` / `LDRS` |
| Scalar Store(MEM ← SR) | `ST` |
| TAR Load/Store(TAR ↔ MEM) | `TLD` / `TST` |
| Cache Prefetch | `DPREFETCH` |
| Type 转换 / MOV | `MOV`(=ORX 伪指令)/ `UEXT` / `SEXT` |
| SPR 读/写 | `MOVS`(包括 MOVS.Barrier、MOVS.SCC)/ `MOVSR2SPR` |
| Atomic Memory Operation(AMO) | `AMO.CAS` / `AMO.EXCH` / `AMO.ADD` / `AMO.AND` / `AMO.OR` / `AMO.XOR` / `AMO.MAX` / `AMO.MAXNUM` / `AMO.MIN` / `AMO.MINNUM` / `AMO.INC` / `AMO.DEC` |

族内通用属性:

- 全部走 C-slot 或 L-slot(具体 slot 见每节"Slot 表"列)。
- **算子用 `LDX` 不用 `LD`**——LD 只支持 8/16/32-bit 数据,先符号扩展到 32-bit、再零扩展到 64-bit SR,对负数 8/16-bit 输入语义不一致;LDX 支持 8/16/32/64-bit,统一符号扩展到 64-bit,行为更直观。
- 所有 SLDST 指令要求**访问地址按数据宽度对齐**——dwidth 决定对齐粒度(8/16/32/64-bit),否则触发 unalign address exception。
- AMO 系列要求 **per-element 对齐**(同 dwidth);整个原子序列(read-modify-write)硬件保证不可被打断。

## 2. 数据宽度通用语义

`mode` 或 `dwidth` 字段在 SLDST 族内取值 0~3,统一映射:

| 编码 | 数据宽度 |
| :-- | :-- |
| 0 | 8-bit (C_8b) |
| 1 | 16-bit (H_16b) |
| 2 | 32-bit (W_32b) |
| 3 | 64-bit (D_64b)——LDX/ST/TLD/TST/AMO.* 支持;LD/UEXT/SEXT 不支持 |

## 3. Scalar Load:LD / LDX / LDRS

### 3.1 LD(p76)

48-bit C-slot 编码:`Imm7`(31..25)、N/A(24..23)、sub-code、`mode`(22..21)、`Imm5`(20..16)、`Rs1`(15..11)、`Rd`(10..6)、opcode(5..1)、Const_0(0)。

```
datasize = {0:8, 1:16, 2:32}[mode]
Imm12 = {Imm7, Imm5}                     // 12-bit 有符号立即数
result = sign_extend(MEM[SR[Rs1] + S-Imm12][datasize-1:0])    // 32-bit
SR[Rd][63:0] = zero_extend(result)
```

**算子不要用 LD**——LD 的 64-bit 写回路径是"先 sign-ext 到 32-bit、再 zero-ext 到 64-bit",对负数 8/16-bit 输入语义不一致;改用 LDX 直接 sign-ext 到 64-bit。

### 3.2 LDX(p77)

48-bit C-slot,字段同 LD,但 mode 域扩展到 0~3,行为变为:

```
datasize = {0:8, 1:16, 2:32, 3:64}[mode]
SR[Rd][63:0] = sign_extend(MEM[SR[Rs1] + S-Imm12][datasize-1:0])    // 直接到 64-bit
```

### 3.3 LDRS(p77,Load Register Special)

48-bit C-slot,寻址改为 **SPR LD_BASE 寄存器寻址 + Rs1 偏移**:

```
address = SPR[LD_BASE[spr_idx]] + SR[Rs1]    // 64-bit
SR[Rd][63:0] = sign_extend(MEM[address][datasize-1:0])
```

`spr_idx`(3-bit)取 0~7 选择 LD_BASE0 ~ LD_BASE7。SIP4.0 对本指令做了**性能优化**——根据 LD_BASE 保存的基地址作为整体结果的地址属性,据此识别访问的地址空间(L1 / L2 / L3)进行加速。Implicit Use:`LD_BASE0~LD_BASE7`。

## 4. Scalar Store:ST(p79)

48-bit C-slot 编码:`Imm7`(31..25)、N/A(24..23)、sub-code、`mode`(22..21)、`Rs2`(20..16)、`Rs1`(15..11)、`Imm5`(10..6)、opcode(5..1)、Const_0(0)。

```
datasize = {0:8, 1:16, 2:32, 3:64}[mode]
Imm12 = {Imm7, Imm5}
MEM[SR[Rs1] + S-Imm12][datasize-1:0] = SR[Rs2][datasize-1:0]
```

**ESL_ORDER 影响**:发射 ST 指令时,如果 `ESL_ORDER` 域为 1 且访问区域为 L3,则对应 AXI 域上会标记为 `ESL_ORDER` 状态;访问其他区域时 ESL_ORDER 无影响。Implicit Use:`ESL_ORDER`。

## 5. TAR Load/Store:TLD / TST(p79-80)

`TLD TARd, offset(rs1)` / `TST TARs2, offset(rs1)`,目的/源寄存器为 TAR(64-bit),指令固定 64-bit 数据宽度。

```
TLD: TAR[0][TARd][63:0] = zero_extend(MEM[SR[Rs1] + S-Imm12][63:0])
TST: MEM[SR[Rs1] + S-Imm12][63:0] = TAR[0][TARs2][63:0]
```

**仅适用于 TCTL 设置只开启 VPT0 时**——TLD/TST 写 TAR[0] 单 VPT,VPT1 模式下不支持。

## 6. DPREFETCH(p81-82)

特殊的单 byte store——通过 AXI 全 0 strobe 让 cache line 触发 miss fetch,但不写入任何数据。ISA4.0 更新:

- 地址为 **48-bit 虚拟地址**(非物理地址),来源 SR1。
- 写入数据寄存器为 SR[Rs2]。
- 本指令 ASID 来源于 SPR `DPF_ASID`。
- **访问 Global 空间外的地址会触发 unalign address exception**。
- DPREFETCH 与任何其他 LD/ST 之间**不检查 RAW/WAW/WAR hazard**(包括之前发射的 DPREFETCH),由编译器/程序员自行保证。

字段语义:

| 字段 | 取值 | 含义 |
| :-- | :-- | :-- |
| `inst` | 0 | 预取计算数据 |
| `inst` | 1 | 预取的是指令(传递到 Awprot[2]) |
| `replace` | 0 | stream(传递到 Ax_User[26:25]) |
| `replace` | 1 | normal |
| `replace` | 2 | resident |
| `replace` | 3 | Reserved |
| `hw_pf` | 0/1 | hw prefetch hint(传递到 Ax_User[29]) |
| `cache_mode` | — | reserved |

Implicit Use:`DPF_ASID`。

## 7. MOV / UEXT / SEXT

### 7.1 MOV(p83)

ISA4.0 把 MOV 重新定义为 **`ORX Rd, Rs1, SR0` 的伪指令**——编码上等同于 ORX,无独立 opcode。

### 7.2 UEXT / SEXT(p83-84)

48-bit C-slot,把 SR[Rs1] 低 8/16/32-bit 进行无符号(UEXT)/符号(SEXT)扩展到 64-bit 写入 SR[Rd]:

```
UEXT: SR[Rd][63:0] = zero_extend(SR[Rs1][datasize-1:0])
SEXT: SR[Rd][63:0] = sign_extend(SR[Rs1][datasize-1:0])
```

mode 域只取 0/1/2(UEXT/SEXT 不支持 64-bit——本身就是 64-bit 寄存器内操作)。

## 8. MOVS / MOVSR2SPR(SPR 读 / 写)

### 8.1 MOVS:Rd = SPR[SPR_ID](p85)

48-bit C-slot,`SPR_ID = {SR_ext, Rs1}`(8-bit)。SPR_ID 编码列表见 `Libra SIP SPR Spec`。

### 8.2 MOVS.Barrier(SW-thread 内 fence,p85-87)

MOVS 读 Barrier 寄存器被定义为 **per-SW-thread fence**——配合 9-bit `fparam` 决定 fence 类型。每个 fparam bit 对应一种 fence 单位:

| fparam bit | Barrier 类型 |
| :-- | :-- |
| [0] | Fence L1 SDMEM Access |
| [1] | Fence L1 VDMEM Access |
| [2] | Fence L2 Access |
| [3] | Fence L3 Access |
| [4] | Fence Memory(汇总) |
| [5] | Fence IO |
| [6] | Fence Load |
| [7] | Fence Store |
| [8] | Fence L0 Access |

ISA4.0 对该指令的更新:

- **去除对 VCC 的操作**(VCC 在 ISA4.0 整体删除)。
- **MOVS.Barrier 的 Rd 强制为 SR0**——避免不必要的 hazard。
- **去除 fence MEM_L2L3_Load / MEM_L2L3_store / MEM_L2L3 三种场景**——这三种可以用独立的 L2 fence + L3 fence 模拟替代。
- **未定义 L4 Fence 接口**——L4 fence 实际是 ESL_order 的 scalar-store 指令,不走 MOVS.Barrier。
- **新增 L0 Fence 接口**——某 SW-thread 执行 Fence L0,等本 SW-thread 前序对 L0 资源(VACC/SR/TAR/SPR)的访问结束。Fence L0 结束后软件可以安全修改 CSR/SPR。

**唯一合法的 fparam 组合表**(其余组合在 ISA4.0 均为非法):

| Fence 类型 | fparam | 含义 |
| :-- | :-- | :-- |
| Fence L0 | 0x100 | Fence L0,等所有访问 L0 资源的指令完成 |
| Fence All | 0x000 | 等所有前面指令完成 |
| L1_SDMEM | 0xD1 | 等访问 SDMEM 的所有指令完成 |
| L1_VDMEM | 0xD2 | 等访问 VDMEM 的所有指令完成 |
| L2_MEM | 0xD4 | 等访问 DSM 的所有指令完成 |
| L3_MEM | 0xD8 | 等访问 EDF 的所有指令完成 |
| L1_IO | 0xE3 | 等访问 SIP 内 SCF 寄存器的所有指令完成 |
| L2L3_IO | 0xEC | 等访问 ECF 的所有指令完成 |
| L1_SDMEM_LOAD | 0x51 | 等 SDMEM 读指令完成 |
| L1_VDMEM_LOAD | 0x52 | 等 VDMEM 读指令完成 |
| L2_MEM_LOAD | 0x54 | 等 DSM 读指令完成 |
| L3_MEM_LOAD | 0x58 | 等 EDF 读指令完成 |
| L1_IO_LOAD | 0x63 | 等 SCF 读指令完成 |
| L2L3_IO_LOAD | 0x6C | 等 ECF 读指令完成 |
| L1_SDMEM_STORE | 0x91 | 等 SDMEM 写指令完成 |
| L1_VDMEM_STORE | 0x92 | 等 VDMEM 写指令完成 |
| L2_MEM_STORE | 0x94 | 等 DSM 写指令完成 |
| L3_MEM_STORE | 0x98 | 等 EDF 写指令完成 |
| L1_IO_STORE | 0xA3 | 等 SCF 写指令完成 |
| L2L3_IO_STORE | 0xAC | 等 ECF 写指令完成 |

**Stack 区域 fence 选型规则**:

- 命中 stack.local → 属于 L1 SDMEM 区域,用 L1_SDMEM 系列。
- 命中 stack.remote → 用 L3 系列。

**MOVS.Barrier 是 per SW-thread 的**——作用范围仅限当前 SW thread,**无法处理多个 SW thread 之间或 SW thread 与 SDTE 之间的 barrier**(那些场景需要 mailbox 等其他机制)。

### 8.3 MOVS.SCC Format(p87)

如果 MOVS 指定 SCC 相关 index,可读取 SCC value——具体 SCC 编码见 SPR Spec。

### 8.4 MOVSR2SPR:SPR[SPR_ID] = Rs1(p88-91)

48-bit C-slot。**只对下表 SPR 生效,其他 SPR_ID 视为 NOP**(共 ~30 个):

`MODE_WRK` / `HWT_COUNTER` / `SCC` / `VAB_VPT0` / `VAB_VPT1` / `NACCOVR` / `MB_STACK` / `STACK_LOCAL` / `STACK_REMOTE` / `TCTL` / `VL` / `LHS_DIM0_REAL` / `LHS_DIM1_REAL0~2` / `LHS_DIM0_STRIDE` / `LHS_DIM1_STRIDE` / `RHS_DIM0_REAL0~2` / `RHS_DIM1_REAL` / `RHS_DIM0_STRIDE` / `RHS_DIM1_STRIDE` / `LDST_DIM0_REAL` / `LDST_DIM1_REAL` / `LDST_DIM0_STRIDE` / `LDST_DIM1_STRIDE` / `TRAP_RTB` / `INTR_SD0~7` / `DPF_ASID` / `IPF_ADDR` / `IPF_ASID` / `IPF_KSID` / `LD_BASE0~7` / `ESL_DTYPE` / `ESL_ORDER`。

**禁止用 MOVSR2SPR 访问 SPR `HW_STS`**——硬件不支持。

部分 SPR 的更新有额外约束:

- 更新这些寄存器时,**不能有正在执行的依赖于这些寄存器语义的指令**——典型做法是线程启动时配置,或配置前先 L0 Fence。
- 更新后**需要 L0 Fence 保证写穿透**。
- 涉及上述约束的 SPR 名单:`MODE_WRK` / `VAB_VPT0` / `VAB_VPT1` / `MB_STACK` / `STACK_REMOTE` / `STACK_LOCAL` / `TCTL` / `ESL_DTYPE` / `TRAP_RTB`。

VAB 与 MODE_WRK 还有更细约束,见 `Libra SIP SPR Spec` §8。

## 9. Atomic Memory Operation(AMO)系列

ISA4.0 新增,共 12 条标量 AMO + 3 条向量 REDV(向量版本不在本文范围)。所有 AMO 指令对 read-modify-write 序列保证**硬件级原子性,不可被打断**。

### 9.1 AMO 标量指令操作汇总

| 操作 | 指令 | 描述 |
| :-- | :-- | :-- |
| cas | `amo.cas rd, (rs1), rs2, rs3` | 读 MEM[Rs1] 到 Rd;若读出值 == Rs2 则写入 Rs3,否则不修改 |
| exch | `amo.exch rd, (rs1), rs2` | 读 MEM[Rs1] 到 Rd;写入 Rs2 |
| add | `amo.add rd, (rs1), rs2` | 读到 Rd;写入 (读出值 + Rs2) |
| and / or / xor | `amo.{and,or,xor} rd, (rs1), rs2` | 读到 Rd;写入按位运算结果 |
| max / min | `amo.{max,min} rd, (rs1), rs2` | 读到 Rd;写入 max/min |
| maxnum / minnum | `amo.{maxnum,minnum} rd, (rs1), rs2` | 同上,但浮点遇单 NaN 选非 NaN |
| inc | `amo.inc rd, (rs1), rs2` | 读 Old 到 Rd;若 Old ≥ Rs2(Val)则写 0,否则写 Old+1 |
| dec | `amo.dec rd, (rs1), rs2` | 读 Old 到 Rd;若 Old > Val 或 Old==0 则写 Val,否则写 Old-1 |

### 9.2 红动作伪指令(AMO Reduction Aliases)

某些场景下 Rs1 地址保存的旧值不需要写回 Rd,此时把 Rd 指定为 SR0,**编译器可生成 `red.func` 伪指令**,硬件也可针对该情况做优化:

| 伪指令 | 等价 |
| :-- | :-- |
| `red.add (rs1), rs2` | `amo.add sr0, (rs1), rs2` |
| `red.and (rs1), rs2` | `amo.and sr0, (rs1), rs2` |
| `red.or (rs1), rs2` | `amo.or sr0, (rs1), rs2` |
| `red.xor (rs1), rs2` | `amo.xor sr0, (rs1), rs2` |
| `red.max (rs1), rs2` | `amo.max sr0, (rs1), rs2` |
| `red.maxnum (rs1), rs2` | `amo.maxnum sr0, (rs1), rs2` |
| `red.min (rs1), rs2` | `amo.min sr0, (rs1), rs2` |
| `red.minnum (rs1), rs2` | `amo.minnum sr0, (rs1), rs2` |
| `red.inc (rs1)` | `amo.inc sr0, (rs1)` |
| `red.dec (rs1)` | `amo.dec sr0, (rs1)` |

### 9.3 AMO.CAS 编码与 dtype × dwidth(只支持 32/64-bit)

48-bit V-slot 编码:`Rs3`(31..27)、`dwidth`(26..25)、`dtype`(24..23)、`Rd`(20..16)、`Rs1`(15..11)、`Rs2`(10..6)、opcode(5..2)、VCE / CCE(1..0)。

```
address = SR[Rs1]
datasize = {2:32, 3:64}[dwidth]
data = MEM[address]
MEM[address] = (SR[Rs2] == data) ? SR[Rs3] : data    // 原子
SR[Rd] = (dtype == 0) ? zero_extend(data) : sign_extend(data)
```

合法 dtype × dwidth:UINT32(0,2)/INT32(1,2)/UINT64(0,3)/INT64(1,3),其余 Reserved。

### 9.4 AMO.EXCH / AMO.ADD 等(扩展数据格式)

AMO.EXCH / AMO.ADD 起,dwidth 扩展到 16/32/64-bit;dtype 扩展到 4 个值,合法组合(以 AMO.ADD 为例):

| Data type | dtype | dwidth |
| :-- | :-- | :-- |
| UINT16 | 0 | 1 |
| INT16 | 1 | 1 |
| UINT32 | 0 | 2 |
| INT32 | 1 | 2 |
| UINT64 | 0 | 3 |
| INT64 | 1 | 3 |
| FP16 | 2 | 1 |
| FP32 | 2 | 2 |
| BF16 | 3 | 1 |

**算术行为**:

- INT/UINT 溢出 → 保留 LSB,**不做 saturation**。
- FP16 / FP32 / BF16 → subnormal **不做 flush-to-zero**;舍入模式**固定 round-to-nearest-even**。
- AMO.MAX:浮点输入有 NaN → 选 ISA 标准 NaN(详见 NaN Result 章节)。
- AMO.MAXNUM:同 §8.7 REDV.MAXNUM(单 NaN 选非 NaN,双 NaN 选标准 NaN)。

### 9.5 AMO.AND / AMO.OR / AMO.XOR(只支持 32/64-bit)

逻辑运算只支持整型,合法组合:UINT32(0,2)/INT32(1,2)/UINT64(0,3)/INT64(1,3),不支持 16/8-bit、不支持浮点。

### 9.6 AMO 对齐要求

**AMO 系列指令均要求 per-element 对齐**,否则触发 unalign address exception。这一点比普通 LD/ST 严格——普通 LD/ST 失败时硬件会触发 unalign exception 但语义清晰可恢复;AMO 失败语义破坏原子性合约,必须由软件保证对齐。
