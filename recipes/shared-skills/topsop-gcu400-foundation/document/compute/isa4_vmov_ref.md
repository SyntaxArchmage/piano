# ISA4.0 VMOV 指令族(向量寄存器搬移 / 立即数加载 / VA-OA-Maskbit 通路)

> `isa4_instruction_ref.md` 给出 VLIW 包结构与 OACC 间接寻址通用规则、`isa4_msf_ref.md` 给出 MALU 2D 通路指令编码,本文不复述。

## 1. VMOV 族总览

VMOV 族覆盖 Vector / TAR 寄存器之间的 mov、立即数初始化、VA↔OA-Maskbit 之间的格式转换、VA 内移位、VA 栈操作以及 mask 多路 merge / select。共 35 节,按用途分 8 组:

| 组别 | 节号 | 指令 |
| :-- | :-- | :-- |
| 立即数加载 → VA / OA | 8.6.1~8 | `VLDI_LO.VA` / `VLDI_HI.VA` / `VLDI_LO.OA` / `VLDI_HI.OA` / `VLDI_64p0.OA` / `VLDI_64p1.OA` / `VLDI_64p2.OA` / `VLDI_64p3.OA` |
| VA / OA 之间搬移与 remap | 8.6.9~12 | `VCLR.OA` / `MOVVA` / `MOVOA` / `REMAPVA` |
| Maskbit 加载 / set / 聚合 | 8.6.13~19 | `VLDI_MB` / `MOVSR2MB` / `VSET_MB` / `VSETI_MB` / `AGGR_MB` / `POPC_MB` / `FIRST_MB` |
| SR ↔ VA 互转(单 lane) | 8.6.20~22 | `MOVR2VA.mode1` / `MOVR2VA.mode2` / `MOVVA2R.mode2` |
| TAR 立即数 / SR / TAR 互转 | 8.6.23~26 | `VLDI_TAR.T0/T1/DUAL` / `MOVSR2TAR.EXT` / `MOVTAR2SR.EXT` / `MOVTAR.T0/T1/DUAL` |
| VA 内移位(SR / imm 控制) | 8.6.27~29 | `MOVSFT_VA` / `MOVSFTC_VA` / `MOVSFTI_VA` |
| Maskbit 栈 push/pop | 8.6.30~31 | `MB_PUSH` / `MB_POP` |
| Maskbit merge / select | 8.6.32~35 | `MMERGE` / `MSELECT_256` / `MSELECT_128` / `MSELECT_64` |

族内通用属性:

- 全部以 VLIW 包内 **VMOV slot**(spec 7 类之一)发射;本文统一按 VMOV slot 抽象,不按物理通道展开。spec 各节 "Type" 列为 `VMOV`,字段表中 L / M / V / S0 列对应 VMOV 类型的不同物理通道。
- 受影响于 `TCTL`(VPT0 / VPT1 使能)——任一 VPT 被关闭时,该 VPT 下指令视为 NOP;`vpt_mode=2` 类指令在某 VPT 不使能时,只对该 VPT 视为 NOP,另一 VPT 正常执行。
- 写 VA 的指令(`VLDI_*.VA` / `MOVVA`)**不受 VL 影响**——按 16 个 32-bit element 整 VA 写入;写 OA 的指令(`VLDI_*.OA` / `VCLR.OA` / `MOVOA` / `MOVR2VA.*`)**受 VL 影响**,index ≥ VL 不写回。
- maskbit 类指令(`VLDI_MB` / `VSET_MB` / `VSETI_MB` / `MOVSFT*` / `MMERGE` / `MSELECT_*`)**不受 VL 与 maskbit 影响**——它们本身是设置 maskbit 的指令,VL 截断会导致语义不闭合。`AGGR_MB` / `POPC_MB` / `FIRST_MB` 把 maskbit 读出到 SR,**受 VL 影响**(VL=0 时按 §5 各指令字面回写 0/1/-1)。

## 2. 编码通用约定

VMOV 类指令固定 48-bit 字段宽度,在 VLIW 包内占 VMOV slot;指令 LSB 位 0 通常为 `Const_1` 或 `Const_0`/`MCE` 字段,具体见每节字段表。

**OACC / VACC 间接寻址通用规则**(VAB_VPT* 完整定义见 `isa4_instruction_ref.md` §8.1.1):

```
VACCd_index = VAB_VPT* + {3'b0, VACCd}             // 直接 VACC 寻址(13-bit physical)
VACCd_index = VAB_VPT* + {OACCd, 3'b0}             // OACC 寻址,左移 3 位 = ×8
OACCd_index = VACCd_index >> 3                    // OACC 颗粒度 = 8 个 VACC = 1 个 OACC
```

`VACCs1_hi/VACCs1_lo` 等拆分字段拼接后形成完整 VACC index,与上述同形;`MOVVA` 使用 5+5-bit 拆分编码、其他 VA 类指令多用 10-bit 整段编码。`VAB_VPT*` 在 VPT0 与 VPT1 各有一份(`VAB_VPT0` / `VAB_VPT1`),per-VPT 独立寻址。

**VPT 与 TCTL 的复制行为**(本族通用):

- 不带 `vpt_mode` 字段的指令(如 `VLDI_LO.VA` / `MOVVA` / `MOVOA` / `MOVR2VA.mode1` / 大部分 OA 类):**两个 VPT 同时执行同一动作**,各自从自己的 VAB_VPT* 取 index;TCTL 关闭某 VPT 时该 VPT 下视为 NOP。
- 带 `vpt_mode` 字段的指令(maskbit 系列、`MOVR2VA.mode2` / `MOVVA2R.mode2` / 部分 TAR):`vpt_mode=0/1` 选择单 VPT,`vpt_mode=2` 同时作用两 VPT,`vpt_mode=3`(仅 `VSET_MB` / `VSETI_MB`)合并两 VPT maskbit 当作长序列处理。

**Implicit Use 通用基线**(每条指令至少包含,各节再列额外 SPR):`VAB_VPT*`、`TCTL`;受 VL 影响的指令额外 `VL`;栈类指令额外 `MB_STACK`。SPR 完整定义见 `sip4_spr_spec.md`。

## 3. VLDI 系列:立即数加载到 VA / OA(§8.6.1~8.6.8)

### 3.1 主路径:VLDI_LO.OA(§8.6.3)

48-bit VMOV-slot 编码:`Imm16`(31..16)、sub-code(15..14)、`OACCd`(13..6)、opcode(5..1)、Const_1(0)。

```
for(i=0...VPT_NUM-1) { //loop each thread
    for(j=0...15) { //loop each 32bit element in OACC
        OA[i][OACCd_index][j] = (OA[i][OACCd_index][j] & 0xFFFF0000) | U-imm16;
    }
}
```

行为要点:

- **OACC 内元素视为 32-bit**——指令把 16-bit 无符号立即数 `U-imm16` 写入每个 32-bit element 的低 16 位,高 16 位保持原值。
- 受 VL 影响:`j` 实际上限为 `min(15, VL/per-VPT)`(各 OACC 内 16 elements,VL 截断由硬件统一处理)。
- 双 VPT 同时执行,各自从 `VAB_VPT*` 取 index。

Implicit Use:`VAB_VPT*`、`TCTL`、`VL`。

### 3.2 同族差异说明(§8.6.1/.2/.4/.5/.6/.7/.8)

7 条同构指令,只在"目标寄存器(VA / OA)、立即数写入哪个 16-bit 位段、VL 影响、循环范围"上有差异,字段布局都是"sub-code + Imm16 + 目标 index + opcode":

| 指令 | 目标 | element 视为 | 立即数写入位段 | 受 VL 影响 | 循环 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| VLDI_LO.VA(8.6.1) | VACC | 32-bit | `[15:0]`(每元素低 16) | 否 | 16 elements |
| VLDI_HI.VA(8.6.2) | VACC | 32-bit | `[31:16]`(每元素高 16,左移 16) | 否 | 16 elements |
| VLDI_LO.OA(8.6.3) | OACC | 32-bit | `[15:0]` | 是 | 16 elements / VPT |
| VLDI_HI.OA(8.6.4) | OACC | 32-bit | `[31:16]`(左移 16) | 是 | 128 elements / OACC |
| VLDI_64p0.OA(8.6.5) | OACC | 64-bit | `[15:0]` | 是 | 64 elements |
| VLDI_64p1.OA(8.6.6) | OACC | 64-bit | `[31:16]`(左移 16) | 是 | 64 elements |
| VLDI_64p2.OA(8.6.7) | OACC | 64-bit | `[47:32]`(左移 32) | 是 | 64 elements |
| VLDI_64p3.OA(8.6.8) | OACC | 64-bit | `[63:48]`(左移 48) | 是 | 64 elements |

`.VA` 变体使用 `VACCd`(10-bit,下标按 `VAB_VPT* + {3'b0, VACCd}` 计算);`.OA` 变体使用 `OACCd`(8-bit,下标按 `VAB_VPT* + {OACCd, 3'b0}` 计算)。`p0/p1/p2/p3` 仅区分 64-bit element 内 16-bit 位段位置,逻辑组合 `p0+p1+p2+p3` 可以拼成完整 64-bit 立即数。

## 4. VCLR / MOVVA / MOVOA / REMAPVA(§8.6.9~8.6.12)

### 4.1 VCLR.OA(§8.6.9,updated in 4.0)

48-bit VMOV-slot 编码:N/A(31..27)、sub-code(26..23)、N/A(22..16)、`OACCd`(15..6)、opcode(5..1)、Const_1(0)。

```
for(i=0...VPT_NUM-1) {
    for(j=0...127) {
        OA[i][OACCd_index][j] = 0x0000_0000;
    }
}
```

对 OACCd 指向的整个 OACC 清零(128 个 32-bit element)。**不受 VL 影响**;双 VPT 同时执行。Implicit Use:`TCTL`、`VAB_VPT*`。

### 4.2 MOVVA(§8.6.10,updated in 4.0)

48-bit VMOV-slot 编码:`VACCs1_hi`(31..27)、sub-code(26..23)、N/A(22..21)、`VACCs1_lo`(20..16)、`VACCd`(15..6)、opcode(5..1)、Const_1(0)。

```
for(i=0...VPT_NUM-1) {
    VA[i][VACCd_index] = VA[i][VACCs1_index];
}
```

整 VACC 搬移,**不受 VL 与 maskbit 影响**。`{VACCs1_hi, VACCs1_lo}` 拼接为 10-bit VACCs1。Implicit Use:`VAB_VPT*`、`TCTL`。

### 4.3 MOVOA(§8.6.11)

48-bit VMOV-slot 编码:sub-code(31..30)、`vm`(29)、`dwidth`(28..27)、N/A(26)、`OACCs1`(25..16)、`OACCd`(15..6)、opcode(5..1)、Const_1(0)。

```
for(i=0...VPT_NUM-1) { OA[i][OACCd_index] = OA[i][OACCs1_index]; }
```

支持 4 种数据宽度的搬移与 maskbit 条件写回:

- `dwidth` 0/1/2/3 → 8/16/32/64-bit element,others Reserved。
- `vm=1` 无条件写回;`vm=0` 用 `VACC[0+VAB_VPT*]` 中 maskbit 前 `64*(2^(3-dwidth))` bit 作为写回条件,maskbit=1 写回,=0 保持原值。

Implicit Use:`VAB_VPT*`、`TCTL`、`VL`。

### 4.4 REMAPVA(§8.6.12,updated in 4.0)

48-bit VMOV-slot 编码(MALU 路径):sub-code(47..44)、N/A(43..41)、`LCE`(40)、N/A(39..37)、`dual`(36)、`VACCs1`(35..26)、N/A(25..22)、Const_0(21..20)、`mode`(19..16)、`VACCd`(15..6)、opcode(5..2)、Const_0(1)、`MCE`(0)。

按 `dual` 与 `mode` 在 VACC 内做 8b/16b/32b/64b 元素的 shuffle / unshuffle,典型用途是 8/16/64-bit 数据在 VA 中"交替排列"形态(VACC Data Element Mapping)与"自然 32-bit 排列"形态之间互转,以及 maskbit 与 32-bit 数据互转(用于 cvt 后的精度变窄 / 变宽 maskbit 通路)。

`mode` 取值与 `dual` 约束:

| mode | 转换 | dual 约束 |
| :-- | :-- | :-- |
| 0 | 8bit → 32bit | — |
| 1 | 16bit → 32bit | — |
| 3 | 32bit → 8bit | — |
| 4 | 32bit → 16bit | — |
| 6 | 64bit → 32bit | dual 必须 1 |
| 7 | 32bit → 64bit | dual 必须 1 |
| 10 | maskbit → 32bit | dual 必须 0 |
| 13 | 32bit → maskbit | dual 必须 0 |

`dual=0` 一次处理 1 个 VA(VA index 对齐到 1);`dual=1` 一次处理 2 个 VA(VA index 对齐到 2)。**SRC 与 DST 不能互相覆盖**——OACCs1 与 OACCd 不能重叠,否则 shuffle 中间值被破坏。Implicit Use:`VAB_VPT*`、`TCTL`。

> §8.6.12 给出 8 张 mode 对应的 byte-level remap 示意图(8↔32 / 16↔32 / 64↔32 各双向),展示交替排列 VA 与自然排列 VA 的物理 byte 位置映射;实现细节归 ISA spec,本文不复述。

## 5. Maskbit 系列(§8.6.13~8.6.19)

本组在不修改 VL 字段值的前提下,对 maskbit VACC 寄存器(VACC[VAB_VPT*])做立即数加载、SR 加载、阈值 set、聚合到 SR、计数与首位 1 查找。

### 5.1 立即数 / SR 加载到 maskbit:VLDI_MB / MOVSR2MB(§8.6.13~14)

**VLDI_MB**(updated in 4.0):16-bit 立即数更新一段 16-bit maskbit。

48-bit VMOV-slot 编码:sub-code(47..44)、N/A(43..42)、`mb_idx_hi`(41)、`LCE`(40)、N/A(39..38)、`vpt_mode`(37..36)、`mb_idx`(35..32)、`uimm16[15:10]`(31..26)、`uimm16[9:0]`(25..16)、`VACCs3/d`(15..6)、opcode(5..2)、Const_0(1)、`MCE`(0)。

- `{mb_idx_hi, mb_idx}` ∈ 0~31(5-bit)——512-bit maskbit 用 16-bit 立即数更新需 32 个 index。
- 写入 maskbit 区域:`maskbit[16*mb_idx + 15 : 16*mb_idx]`。
- `vpt_mode` 0/1/2 → 仅 VPT0 / 仅 VPT1 / 双 VPT;TCTL 关闭对应 VPT 时该 VPT 下指令 NOP。
- VACCs3/d 同时作为 src 与 dst:`VACCs3_index = VACCd_index = VAB_VPT* + {3'b0, VACCs3/d}`。

Implicit Use:`VAB_VPT*`、`TCTL`。

**MOVSR2MB**(updated in 4.0):32-bit SR 数据更新一段 32-bit maskbit。

48-bit VMOV-slot 编码与 VLDI_MB 同结构,差异:

- `mb_idx` 有效范围 0~15(4-bit 用作 32-bit 立即数 16 个 index)。
- 写入 maskbit 区域:`maskbit[32*mb_idx + 31 : 32*mb_idx]`。
- 数据来源 `Rs1`(20..16)替换立即数。

Implicit Use:`VAB_VPT*`、`TCTL`。

### 5.2 阈值 set:VSET_MB / VSETI_MB(§8.6.15~16)

按"index < 阈值 → maskbit=1"规则填充整段 maskbit。两条同构,`VSET_MB` 阈值来自 SR、`VSETI_MB` 阈值来自 10-bit 立即数。

48-bit VMOV-slot 编码(VSET_MB):sub-code(47..44)、`dwidth`(43..42)、N/A(41)、`LCE`(40)、N/A(39..38)、`vpt_mode`(37..36)、N/A(35..21)、`Rs1`(20..16)、`VACCd`(15..6)、opcode(5..2)、Const_0(1)、`MCE`(0)。VSETI_MB 把 `Rs1` 段替换为 `uimm10[9:0]`(25..16)、`uimm10` 同段。

```
limit = {0:512, 1:256, 2:128, 3:64}[dwidth]   // dwidth → maskbit 长度
threshold = SR[Rs1]    // 或 uimm10
if(vpt_mode == 0 || vpt_mode == 2)
    for(j=0; j<limit; j++)
        VACC[0][VACCd_index][j] = (j < threshold) ? 1 : 0;
if(vpt_mode == 1 || vpt_mode == 2)
    for(j=0; j<limit; j++)
        VACC[1][VACCd_index][j] = (j < threshold) ? 1 : 0;
if(vpt_mode == 3)   // 两 VPT OACC 合起来当一段长 maskbit
    for(i=0; i<VPT_NUM-1; i++)
        for(j=0; j<limit; j++)
            VACC[i][VACCd_index][j] = ((j + i*limit) < threshold) ? 1 : 0;
```

`dwidth` 与 maskbit 长度:0→512 bit / 1→256 bit / 2→128 bit / 3→64 bit(对应 8/16/32/64-bit OACC 数据宽度)。**阈值超过 limit 时指令仍正常工作**(全 1 填充)。**不受 VL 影响**。Implicit Use:`VAB_VPT*`、`TCTL`。

### 5.3 maskbit 聚合到 SR:AGGR_MB / POPC_MB / FIRST_MB(§8.6.17~19)

读出某个 VPT 下 maskbit 并写回 SR;字段共享 `vpt_mode`(选 VPT0/1)、`dwidth`(选 maskbit 长度,与 §5.2 同)。

| 指令 | 字段 | 输出 | VL=0 行为 |
| :-- | :-- | :-- | :-- |
| AGGR_MB(8.6.17) | `mode`(0/1/2/3 = OR / AND / OR-NOT / AND-NOT) | mode 0/1 → 直接结果;mode 2/3 → 取反 | mode 0/3 → SR[Rd]=0;mode 1/2 → SR[Rd]=1 |
| POPC_MB(8.6.18) | — | maskbit 中 1 的个数(popcount) | SR[Rd]=0 |
| FIRST_MB(8.6.19) | `vm`(0/1) | 首个 maskbit=1 的逻辑 index;无则 -1 | SR[Rd]=-1 |

`AGGR_MB` 取的 maskbit 长度 = `min(2^(6 + va_union - dwidth), VL)`,`va_union=3` 时 dwidth 0/1/2/3 → 512/256/128/64 bit,与 §5.2 limit 一致。`FIRST_MB` 当 `vm=0` 时,maskbit 输入额外与 `VACC[0+VAB_VPT*]` 中 maskbit 的前 `64*(2^(3-dwidth))` bit 做 AND 后再搜索;`vm=1` 直接搜索 `VACCs1`。

48-bit VMOV-slot 编码(以 AGGR_MB 为例,主字段):sub-code(47..32 内子段)、`vpt_mode`(31..30)、`dwidth`(28..27)、`mode`(22..21)、`Rd`(20..16)、`VACCs1`(15..6)、opcode(5..2)、`VCE`(1)、`CCE`(0)。POPC_MB / FIRST_MB 同结构,差异在 `mode` 字段是否存在以及 FIRST_MB 多一位 `vm`(29)。

Implicit Use:`VAB_VPT*`、`TCTL`、`VL`。

## 6. SR ↔ VA 互转(§8.6.20~8.6.22)

### 6.1 MOVR2VA.mode1(§8.6.20):标量广播到整 OACC

48-bit VMOV-slot 编码:N/A(31..29)、`dwidth`(28..27)、sub-code(26..23)、N/A(22..21)、`Rs1`(20..16)、`OACCd`(15..6)、opcode(5..1)、Const_1(0)。

```
if(dwidth == 2) {                       // 32-bit
    for k = 0...7
        for i = 0...VPT_NUM-1
            for j = 0...15
                VA[i][VACCd_index + k].w32_bits[j] = SR[Rs1];
} else if(dwidth == 3) {                // 64-bit
    for i = 0...VPT_NUM-1
        for k = 0...3
            for j = 0...15
                VA[i][VACCd_index+2*k].w32_bits[j] = (SR[Rs1] & 0xFFFF_FFFF);
                VA[i][VACCd_index+2*k+1].w32_bits[j] = (SR[Rs1] >> 32);
}
```

`dwidth` 仅支持 2(32-bit)与 3(64-bit),其他 Reserved。把 SR[Rs1] 复制到 OACCd 全部 datalane;dwidth=3 时把 64-bit SR 拆成低 32 / 高 32 分别写入连续两个 VACC。受 VL 影响。Implicit Use:`VAB_VPT*`、`TCTL`、`VL`。

### 6.2 MOVR2VA.mode2(§8.6.21):标量写入单 lane

48-bit VMOV-slot 编码:`vpt_mode`(31..30)、N/A(29)、`dwidth`(28..27)、Const_1(26)、`Rs1`(25..21)、`Rs2`(20..16)、`OACCd`(15..6)、opcode(5..1)、Const_1(0)。

```
if (SR[Rs1] < (512/2^dwidth) && SR[Rs1] < VL) {
    OACC[vpt_mode][OACCd_index][SR[Rs1]] = SR[Rs2];
}
```

把 SR[Rs2] 的低 `8*(2^dwidth)` bit 写入 OACCd 中由 SR[Rs1] 指定逻辑 index 的元素;`SR[Rs1] >= 2^(9-dwidth)`(超出 8 个 VA 范围)或 `SR[Rs1] >= VL` 时视为 NOP。`dwidth` 0/1/2/3 → 8/16/32/64-bit。`vpt_mode` 0/1 选 VPT,TCTL 关闭对应 VPT 时 NOP。逻辑 / 物理 index 关系参见 VACC Data Element Mapping。Implicit Use:`VAB_VPT*`、`TCTL`、`VL`。

### 6.3 MOVVA2R.mode2(§8.6.22):单 lane 读出到标量

48-bit VMOV-slot 编码:`vpt_mode`(31..30)、N/A(29)、`dwidth`(28..27)、sub-code(26)、`Rs1`(25..21)、`Rd`(20..16)、`OACCs1`(15..6)、opcode(5..2)、`VCE`(1)、`CCE`(0)。

```
SR[rd] = 0;
if (SR[Rs1] < (512/2^dwidth) && SR[Rs1] < VL) {
    SR[rd] = sign_ext(OACC[vpt_mode][OACCs1_index][SR[Rs1]]);
}
```

读出的元素按 `dwidth` 决定 8/16/32/64-bit,**符号扩展**写回 Rd。**当 index ≥ 8 个 VA 范围、index ≥ VL 或 VL=0 时,Rd 写 0**。Implicit Use:`VAB_VPT*`、`TCTL`、`VL`。

## 7. TAR 系列(§8.6.23~8.6.26)

### 7.1 VLDI_TAR.T0 / .T1 / .DUAL(§8.6.23):立即数加载到 TAR

48-bit VMOV-slot 编码:`Imm5(Imm16[15:11])`(31..27)、sub-code(26..23)、`Imm1(Imm16[10])`(22)、`sign_ext`(21)、`Imm5(Imm16[9:5])`(20..16)、`TARd`(15..11)、`Imm5(Imm16[4:0])`(10..6)、opcode(5..1)、Const_0(0)。立即数 16-bit 拆 5+1+5+5 段排布以适配字段空隙。

| 变体 | 行为 |
| :-- | :-- |
| `VLDI_TAR.T0 TARd, Imm16` | TAR[0][TARd] = ext(Imm16);TCTL 关 VPT0 时 NOP |
| `VLDI_TAR.T1 TARd, Imm16` | TAR[1][TARd] = ext(Imm16);TCTL 关 VPT1 时 NOP |
| `VLDI_TAR.DUAL TARd, Imm16` | TAR[0][TARd] = TAR[1][TARd] = ext(Imm16);某 VPT 不使能时该 VPT 下 NOP |

`sign_ext`:1=符号扩展、0=零扩展(填充到 64-bit TAR)。`TARd` 5-bit,可索引任意 TAR(无分组限制)。Implicit Use:`TCTL`。

### 7.2 MOVSR2TAR.EXT(§8.6.24):SR → TAR

48-bit VMOV-slot 编码:N/A(31..29)、`vpt_mode`(28..27)、sub-code(26..23)、`range`(22)、Const_0(21)、`Rs1`(20..16)、`TARd`(15..11)、N/A(10..6)、opcode(5..1)、Const_1(0)。

| `vpt_mode` | 行为 |
| :-- | :-- |
| 0 | TAR[0][TARd] = SR[Rs1];TCTL 关 VPT0 时 NOP |
| 1 | TAR[1][TARd] = SR[Rs1];TCTL 关 VPT1 时 NOP |
| 2 | 双 VPT 同时写;某 VPT 不使能时该 VPT 下 NOP |
| Other | Reserved |

`range`:0 = SR 低 32-bit 符号扩展为 64-bit 写入 TAR;1 = SR 完整 64-bit 写入。Implicit Use:`TCTL`。

### 7.3 MOVTAR2SR.EXT(§8.6.25):TAR → SR

48-bit VMOV-slot 编码同 7.2 镜像:N/A(31..29)、`vpt_mode`(28..27)、sub-code(26..23)、`range`(22)、`Const_1(Const_1_2)`(21)、`TARs1`(20..16)、N/A(15..11)、`Rd`(10..6)、opcode(5..1)、`Const_1(Const_1_1)`(0)。

| `vpt_mode` | 行为 |
| :-- | :-- |
| 0 | SR[Rd] = TAR[0][TARs1];TCTL 关 VPT0 时 NOP |
| 1 | SR[Rd] = TAR[1][TARs1];TCTL 关 VPT1 时 NOP |
| Other | Reserved(不支持双读) |

`range`:0 = 只读 TAR 低 32-bit、高 32-bit 拼 0 写回 SR;1 = 完整 64-bit 写回。Implicit Use:`TCTL`。

### 7.4 MOVTAR.T0 / .T1 / .DUAL(§8.6.26):TAR ↔ TAR

48-bit VMOV-slot 编码:N/A(47..16)、`TARs1`(15..11)、`TARd`(10..6)、opcode(5..1)、Const_0(0)。**所有操作均为 64-bit**。

| 变体 | 行为 |
| :-- | :-- |
| MOVTAR.T0 | 仅 VPT0:TAR[0][TARd] = TAR[0][TARs1];TCTL 关 VPT0 时 NOP |
| MOVTAR.T1 | 仅 VPT1:TAR[1][TARd] = TAR[1][TARs1];TCTL 关 VPT1 时 NOP |
| MOVTAR.DUAL | 双 VPT 同步搬;某 VPT 不使能时该 VPT 下 NOP |

Implicit Use:`TCTL`。

## 8. 移位 / 移位组合(§8.6.27~8.6.29)

整 VACC(512-bit)或两 VACC 拼接(1024-bit)做逻辑左/右移,**不受 VL 与 maskbit 影响**;**SRC 与 DST 不能互相覆盖**——OACCs1 / OACCs2 与 OACCd 不能重叠,否则中间结果会污染源寄存器。

### 8.1 MOVSFT_VA(§8.6.27):单 VACC 移位(SR 控制)

48-bit VMOV-slot 编码:sub-code(47..44)、`sft_mode`(43..42)、`Rs1_hi`(41)、`LCE`(40)、`Rs1_lo`(39..36)、`VACCs1`(35..26)、N/A(25..16)、`VACCd`(15..6)、opcode(5..2)、Const_0(1)、`MCE`(0)。`{Rs1_hi, Rs1_lo}` 拼出 5-bit Rs1 索引,移位数值为 SR[Rs1] 低 4-bit。

| `sft_mode` | 行为 |
| :-- | :-- |
| 0 | byte 单位逻辑左移:`VACC[VACCd] = VACC[VACCs1] << (SR[Rs1][3:0] << 3)` |
| 1 | byte 单位逻辑右移:`VACC[VACCd] = VACC[VACCs1] >> (SR[Rs1][3:0] << 3)` |
| 2 | 16-byte 单位逻辑左移:`<< (SR[Rs1][3:0] << 7)` |
| 3 | 16-byte 单位逻辑右移:`>> (SR[Rs1][3:0] << 7)` |

Implicit Use:`VAB_VPT*`、`TCTL`。

### 8.2 MOVSFTC_VA(§8.6.28):双 VACC 拼接移位(SR 控制)

48-bit VMOV-slot 编码:sub-code(47..44)、`sft_mode`(43..42)、`Rs1_hi`(41)、`LCE`(40)、`Rs1_lo`(39..36)、`VACCs1`(35..26)、`VACCs2`(25..16)、`VACCd`(15..6)、opcode(5..2)、Const_0(1)、`MCE`(0)。

把 `VACCs1` 与 `VACCs2` 拼成 1024-bit 操作数,按 `sft_mode` 的 byte / 16-byte 单位左/右移,然后取上 / 下 512-bit 写入 VACCd:

```
sft_mode 0(byte 左移): {VACC[VACCd], _} = ({VACC[VACCs1], VACC[VACCs2]} << (SR[Rs1][3:0]<<3))   // 取高 512
sft_mode 1(byte 右移): {_, VACC[VACCd]} = ({VACC[VACCs2], VACC[VACCs1]} >> (SR[Rs1][3:0]<<3))   // 取低 512
sft_mode 2(16B 左移): {VACC[VACCd], _} = ({VACC[VACCs1], VACC[VACCs2]} << (SR[Rs1][3:0]<<7))    // 取高 512
sft_mode 3(16B 右移): {_, VACC[VACCd]} = ({VACC[VACCs2], VACC[VACCs1]} >> (SR[Rs1][3:0]<<7))    // 取低 512
```

**SRC 与 DST 不能互相覆盖**:OACCs1 / OACCs2 与 OACCd 三两两都不能重叠。Implicit Use:`VAB_VPT*`、`TCTL`。

### 8.3 MOVSFTI_VA(§8.6.29):立即数移位(可选拼接)

48-bit VMOV-slot 编码:sub-code(47..44)、`sft_mode`(43..42)、`concate`(41)、`LCE`(40)、`imm4`(39..36)、`VACCs1`(35..26)、`VACCs2`(25..16)、`VACCd`(15..6)、opcode(5..2)、Const_0(1)、`MCE`(0)。

`concate` 选 `op2`:0 → op2=0x0(对单 VACC 移位)、1 → op2=VACC[VACCs2](双拼接)。然后按 `sft_mode` 与 MOVSFTC_VA 同语义移位,移位量来自 `Imm4`(取代 SR[Rs1][3:0])。Implicit Use:`VAB_VPT*`、`TCTL`。

## 9. push / pop:Maskbit 栈操作(§8.6.30~8.6.31)

`MB_PUSH` / `MB_POP` 用 SPR `MB_STACK` 作栈顶 index,把当前 maskbit VACC(`VACC[VPT*][VAB_VPT*]`)与栈区 VACC 互相 copy。

### 9.1 MB_PUSH(§8.6.30)

48-bit VMOV-slot 编码:N/A(47..6)、opcode(5..1)、Const_0(0)。

```
VACC[VPT*][SPR[MB_STACK] + VAB_VPT*] = VACC[VPT*][VAB_VPT*];
SPR[MB_STACK] = SPR[MB_STACK] + 1;
```

把 `VAB_VPT*` 指向的当前线程 maskbit VACC 复制到 `SPR[MB_STACK] + VAB_VPT*` 位置的 VACC,然后栈顶 index 自增 1。

### 9.2 MB_POP(§8.6.31)

48-bit VMOV-slot 编码:同 MB_PUSH。

```
SPR[MB_STACK] = SPR[MB_STACK] - 1;
VACC[VPT*][VAB_VPT*] = VACC[VPT*][SPR[MB_STACK] + VAB_VPT*];
```

栈顶 index 自减 1,然后从该位置 VACC 复制回当前线程 maskbit VACC。

**栈越界硬件行为不可知**——VACC index 为负或超过线程分配的 VACC 上限时,硬件不保证语义,需软件自行管理 push / pop 配对。Implicit Use:`VAB_VPT*`、`TCTL`、`MB_STACK`;Implicit Defs:`MB_STACK`。

## 10. merge / select 多路选择(§8.6.32~8.6.35)

把一路或两路源 maskbit 在不同颗粒度上合并 / 选择,用于精度变窄(merge:两段 src maskbit 拼成更长 dst)与精度变宽(select:src 长 maskbit 截一段)的算子。**全部不受 VL 与 maskbit 影响**——它们是 maskbit 重组指令。

### 10.1 MMERGE(§8.6.32):两路 maskbit 拼接

48-bit VMOV-slot 编码:sub-code(47..44)、N/A(43..41)、`LCE`(40)、`vm_merge`(39..36)、`VACCs1`(35..26)、`VACCs2`(25..16)、`VACCd`(15..6)、opcode(5..2)、Const_0(1)、`MCE`(0)。

```
src_mask_width = 2^(9 - vm_merge);    // 每路 src 宽度
dst_mask_width = 2^(10 - vm_merge);   // dst 宽度 = 两路拼接
maskbit[src..0] = get_maskbit(VACCs1, 0, src_mask_width-1);   // 低位放 VACCs1
maskbit[dst..src] = get_maskbit(VACCs2, 0, src_mask_width-1); // 高位放 VACCs2
VACCd[dst..0] = set_maskbit(maskbit);  // 高于 dst 的 bit 写回 0
```

`vm_merge` 决定每路源 maskbit 长度,合法范围 1~3:

| `vm_merge` | 每路 src | dst | 高位填 0 区间 |
| :-- | :-- | :-- | :-- |
| 1 | 256-bit | 512-bit | (无,正好填满)|
| 2 | 128-bit | 256-bit | maskbit[511:256] |
| 3 | 64-bit | 128-bit | maskbit[511:128] |

`vm_merge=0` 与 ≥4 Reserved。Implicit Use:`VAB_VPT*`、`TCTL`。

### 10.2 MSELECT_256 / 128 / 64(§8.6.33~8.6.35):单路 maskbit 截段

48-bit VMOV-slot 编码(三条同结构):sub-code(47..44)、N/A(43..41)、`LCE`(40)、`vm_sel`(39..36)、`VACCs1`(35..26)、N/A(25..16)、`VACCd`(15..6)、opcode(5..2)、Const_0(1)、`MCE`(0)。

把 VACCs1 中 512-bit maskbit 切成若干段,根据 `vm_sel` 选一段写到 VACCd 低位,**高位回写 0**:

| 指令 | 段长 | `vm_sel` 范围 | 切段 | 高位 0 区间 |
| :-- | :-- | :-- | :-- | :-- |
| MSELECT_256(8.6.33) | 256 bit | 0~1 | `[255:0]` / `[511:256]` | maskbit[511:256] |
| MSELECT_128(8.6.34) | 128 bit | 0~3 | `[127:0]` / `[255:128]` / `[383:256]` / `[511:384]` | maskbit[511:128] |
| MSELECT_64(8.6.35) | 64 bit | 0~7 | 8 段 64-bit 片 | maskbit[511:64] |

伪代码以 MSELECT_256 为例(其余同构,只换段长与段数):

```
for i = 0...VPT_NUM-1 {
    VACC[i][VACCd_index] = 0;
    bits(256) maskbit[2];
    maskbit[0][255:0] = get_maskbit(VACC[i][VACCs1_index], 0, 255);
    maskbit[1][255:0] = get_maskbit(VACC[i][VACCs1_index], 256, 511);
    VACC[i][VACCd_index][255:0] = set_maskbit(maskbit[vm_sel][255:0]);
}
```

Implicit Use:`VAB_VPT*`、`TCTL`。

## 11. 与同 skill 其他文档的关系

- VLIW 包结构、VAB_VPT* / OACC / VACC / Maskbit 完整定义、VL SPR 字段(10-bit,编码范围 `[0, 1023]`)见 `isa4_instruction_ref.md` §8.1。
- 1D 计算上下文与 OACC / VACC 间接寻址通用规则见 `general_compute_1d.md`。
- `VAB_VPT*` / `TCTL` / `MB_STACK` / `VL` / `MODE_WRK` 等 SPR 字段见 `sip4_spr_spec.md`。
- MALU 2D 通路族(`MSF` / `MID` / `REDMAX` / `REDMIN` / `REDSUM`)见 `isa4_msf_ref.md`。
