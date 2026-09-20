# ISA4.0 VLDST 指令族(向量/矩阵 load/store)

> XPU 主端口 / 从端口拓扑、L1 / DSM / L3 路径 latency / Memory Hazard / VLDEOA-VSTEOA Gather/Scatter 加速规则等 datapath 视角见 `ldst_spec.md`,两份文档互补。

## 1. VLDST 族总览

VLDST 共 18 条指令,分 3 类:

| 类别 | 指令 |
| :-- | :-- |
| TAR 计算 | `TARADD` |
| 1D Linear LDST | `TVLDOA` / `TVLDOA.reg` / `TVSTOA` / `TVSTOA.reg` / `TVSTOA_EXT` / `TVSTOA_EXT.reg` / `VLDOA` / `VSTOA` |
| 1D Strided LDST | `VLDEOA` / `VSTEOA` |
| 1D Gather/Scatter | `MLI_VLDXOA` / `MLI_VSTXOA` / `MLI_VLDXI32OA` / `MLI_VSTXI32OA` |
| 1D Vector AMO | `REDV.ADD` / `REDV.MAX` / `REDV.MAXNUM` |

族内通用属性:

- 受 VL 与 maskbit 影响——index ≥ VL 的元素或 vm=0 且 maskbit=0 的元素**严格不触发 exception**;Load 指令对这些元素目标寄存器**保持不变**;Store 指令对这些元素**严格不回写 memory**。
- 基于 TAR 的后增寻址指令(`TVLDOA` / `TVSTOA` / `TVSTOA_EXT`):**TAR 自增回写不受 VL=0 影响**——即使 VL=0 整条指令实际不读不写,TAR 仍按 TARs2 偏移自增。
- 除 1D Vector AMO 外,均支持访存 8/16/32/64-bit 数据。
- 全部支持双 VPT 模式(VPT0 + VPT1),指令编码中使用 10-bit OACC 域间接访问 VACC 寄存器。
- TAR-base 1D VLDST 使用 5-bit TAR 寻址(放宽 ISA3.0 的分组限制),允许任意 TAR 既作 base 又作 offset,且 TAR 计算时**不需要进行移位**(地址计算直接用 TAR 数值)。
- 全部指令支持 **Per-Element 对齐**:地址对齐放宽到 dwidth 规定的 element 宽度(8b/16b/32b/64b),不再要求 64B / 128B 整体对齐;访问不同地址区域(L1 / L3 / DSM)时,具体对齐要求以 Arch Spec 为准。

## 2. dwidth 通用语义

`dwidth` 字段在 VLDST 族内取值 0~3,所有 Load 指令的 element remap 行为如下(Store 同构,方向相反):

| dwidth | 数据宽度 | 行为 |
| :-- | :-- | :-- |
| 0 | 8-bit | 按 VA 8-bit 排列要求自动 remap |
| 1 | 16-bit | 按 VA 16-bit 排列要求自动 remap |
| 2 | 32-bit | 不需要 remap(自然排列) |
| 3 | 64-bit | 按 VA 64-bit 排列要求自动 remap |

`dwidth=0/1/3` 的 remap 与 VACC Data Element Mapping 配套——load 时 memory 线性 → VACC 交替排列,store 时反向。

## 3. OACC 间接寻址通用规则

VLDST 族大部分指令通过 10-bit `OACC*` 域间接寻址 VACC,规则统一为:

```
VACC*_index = VAB_VPT* + {OACC*, 3'b0}
OACC*_index = VACC*_index >> 3
```

也即 OACC 编号通过 VAB_VPT* 加上左移 3 位(等价 ×8)的 OACC 域得到 VACC 起始 index,实际操作以 8 个 VACC(=1 个 OACC)为粒度。

`vm` 字段:vm=0 时使用 `VACC[0+VAB_VPT*]` 中的 maskbit 作为写回条件;vm=1 时非条件写回。**vm=0 时,VACCd 不能为 `VACC[0+VAB_VPT*]`**——避免输出与 maskbit 来源 OACC 重叠造成竞争。

## 4. TARADD(TAR 累加)

48-bit M-slot 编码:`TARs1d`(15..11)、`TARs2`(10..6)、opcode(5..1)、Const_0(0)。

```
for i = 0...VPT_NUM-1:
    TAR[i][TARs1d] += TAR[i][TARs2]    // 64-bit per-VPT 独立累加
```

操作数:任意两个 TAR(无分组限制)。Implicit Use:`TCTL`。

## 5. Linear Load/Store(基于 TAR 的后增寻址)

### 5.1 TVLDOA(后增寻址 Load)

48-bit M-slot 编码:sub-code(31..30)、`vm`(29)、`dwidth`(28..27)、Const_0(26)、`TARs2`(25..21)、`TARs1d`(20..16)、`OACCd`(15..6)、opcode(5..1)。

```
for i = 0...VPT_NUM-1:
    addr[i] = TAR[i][TARs1d]
    OA[i][OACCd_index] = MEM[addr[i]]
    TAR[i][TARs1d] += TAR[i][TARs2]    // 后增,不受 VL=0 影响
```

每 VPT 一次读 1 个 OACC(8 个 VA = 512B)的数据。Implicit Use:`VAB_VPT*` / `TCTL` / `VL`。

### 5.2 TVSTOA(后增寻址 Store)

48-bit V-slot 编码:同 TVLDOA 但目标方向反转(`OACCs1` 替换 `OACCd`),最末两位为 VCE(VPT0 condition execution)/CCE(VPT1 CE)。Store 行为同样按 VACC Data Element Mapping 自动从 VACC 交替排列转换为 memory 线性排列。Implicit Use 比 Load 多一项 `ESL_DTYPE`(影响 L3 ESL_ORDER 标记)。

### 5.3 TVLDOA.reg / TVSTOA.reg(寄存器寻址,无后增)

寻址改为 `addr = TAR[i][TARs1] + TAR[i][TARs2]`,**不修改 TAR**。指令字段编码与 TVLDOA / TVSTOA 同构,只是把 base 域从"TARs1d(后增写回)"改为"TARs1(只读)"。

### 5.4 TVSTOA_EXT / TVSTOA_EXT.reg(带 cvt / clamp / relu 的扩展 Store)

48-bit M-slot,新增 4 个字段:`cvt_mode`(38..36)、`clamp`(39)、`LCE`(40)、`relu`(15)、`rnd`(14)。相比 TVSTOA 多支持三种 store-side 后处理:

**`cvt_mode`(根据 dwidth 切换不同转换表)**:

| dwidth | cvt_mode 值与转换 |
| :-- | :-- |
| 2(32-bit 输入) | 0=No convert / 1=FP32→FP16 / 2=FP32→BF16 / 3=FP32→FP8E4M3 / 4=FP32→FP8E5M2 / 5=INT32→UINT8 / 6=INT32→INT8 |
| 1(16-bit 输入) | 0=No convert / 1=FP16→FP8E4M3 / 2=FP16→FP8E5M2 / 3=BF16→FP8E4M3 / 4=BF16→FP8E5M2 |
| 0 / 3 | Reserved |

cvt 使能时:

- 向整型转换且超出表达范围 → 总是 saturation 到最近可表数值(负数转无符号 → 0;转 INT8 还受 clamp 域影响)。
- 向浮点转换且超出表达范围 → 结果是 INF/NaN 还是 max value 由 `rnd` 与 `clamp` 共同决定。
- **cvt_mode 使能时,回写起始地址必须对齐到 4Byte**——这是 cvt 通路的硬约束。

**`rnd`**(只在 dwidth=2 或 dwidth=1 且 cvt_mode≠0 时有效):0=round-to-nearest-even / 1=round-to-zero。

**`clamp`**(同 rnd 适用条件):

- INT8 结果且 clamp=1 → 负数 saturation 上限改为 -127(否则为 -128)。
- BF16 / FP16 结果且 clamp=1,原始(非 INF)超出可表范围 → clamp 到正负最大可表数值,而非 ±INF。
- FP8_E4M3 同上但目标格式上限是 NaN(clamp=1 改为最大可表值)。
- FP8_E5M2 同 BF16/FP16 行为(clamp=1 改为最大可表值,非 ±INF)。
- 其他数据格式:clamp 域无效。

**`relu`**(同 rnd 适用条件):0=不 relu / 1=对 cvt 后结果做 relu。

`TVSTOA_EXT.reg` 的差异同 §5.3——base 域改为只读 `TARs1`,不做后增。Implicit Use:`VAB_VPT*` / `TCTL` / `VL` / `MODE_WRK.denormal_flush` / `ESL_DTYPE`。

## 6. Linear Load/Store(SR 寻址,VLDOA / VSTOA)

### 6.1 VLDOA(SR-base 双 VPT load)

48-bit L-slot 编码:`vm`(29)、`dwidth`(28..27)、sub-code(26..23)、`copy`(21)、`Rs1`(20..16)、`OACCd`(15..6)、opcode(5..1)。

```
for i = 0...VPT_NUM-1:
    if copy == 0:
        addr[i] = SR[Rs1] + 512*i        // 双 VPT 各读一段 512B
    else if copy == 1:
        addr[i] = SR[Rs1]                // 双 VPT 共享同一 512B
    OA[i][OACCd_index] = MEM[addr[i]]
```

`copy` 字段是 VLDOA 独有:copy=0 → 两 VPT 读连续不同地址(VPT0 = base、VPT1 = base+512);copy=1 → 两 VPT 读相同地址(典型用于 broadcast)。Implicit Use:`VAB_VPT*` / `TCTL` / `VL`。

### 6.2 VSTOA(SR-base 双 VPT store)

48-bit V-slot 编码同构。VSTOA **没有 copy 字段**——store 总是 `addr = SR[Rs1] + 512*i`,VPT0 写 base 起 512B,VPT1 写 base+512 起 512B。Implicit Use 比 VLDOA 多 `ESL_DTYPE`。

## 7. Strided Load/Store(VLDEOA / VSTEOA)

48-bit M-slot,新增 `Rs2`(30..26)字段保存以 element 间隔为单位的有符号 stride。

```
base_address = SR[Rs1]
stride = SR[Rs2]
data_width = 8 * 2^dwidth     // {8,16,32,64}
elem_nums = 512 * 8 / data_width = 4096 / data_width

# 计算两个 VPT 共 2*elem_nums 个元素地址
address_array[0] = base_address
for e = 1 .. 2*elem_nums - 1:
    address_array[e] = address_array[e-1] + stride * 2^dwidth

for i = 0..VPT_NUM-1:
    for e = 0..elem_nums-1:
        addr = address_array[e + i * elem_nums]
        # Load:OACC[i][OACCd][e] = MEM[addr]
        # Store:MEM[addr] = OACC[i][OACCs2][e]
```

地址计算硬约束:**虚拟地址只取 SR 低 48-bit**——`SR[Rs1][47:0] + (i * SR[Rs2][47:0])` 的低 48 位作为虚拟地址,`SR[Rs1][63:48]` 作为寻址 hint **不参与加法**,直接传给每个元素。

**VLDEOA / VSTEOA 不保证每个独立 memory 访问之间的顺序**——VSTEOA 在 stride=0 时**结果不可知**(并发对同一地址的写不定序)。

## 8. Gather / Scatter Load/Store(MLI_VLDXOA 系列)

MLI_VLDXOA / MLI_VSTXOA / MLI_VLDXI32OA / MLI_VSTXI32OA 共 4 条指令,**固定与 C-slot 的 `MLI_HINT` 一起打包,不能与其他任何指令打包**(见 isa4_instruction_ref.md §MLI 在 VLIW 包中的位置)。

### 8.1 MLI_VLDXOA / MLI_VSTXOA(64-bit offset)

每个 element 的 offset 来源于 OACCs1 起的若干个 OACC,每个 offset 64-bit。`SR[Rs1]` 作为 base 共享给两 VPT,offset 各 VPT 独立。

```
base_address = SR[Rs1]
data_width = 8 * 2^dwidth
elem_nums = 4096 / data_width
vaccs1_nums = 64 * va_nums / data_width      // va_nums=8 in MLI_VLDXOA

# 从 OACCs1 起的若干 VA 拼出每个 element 的 64-bit offset(高低各 32-bit)
offset_array[e] = VA[i][vaccs1_idx + j][k] + (VA[i][vaccs1_idx + j+1][k] << 32)

for e in 0..elem_nums-1:
    addr = base_address + offset_array[e]
    # Load:OACCd[i][e] = MEM[addr][data_width-1:0]
    # Store:MEM[addr][data_width-1:0] = OACCs2[i][e]
```

**OACCs1 / OACCd / OACCs2 对齐表**(64-bit offset 版):

| dwidth | OACCd / OACCs2 | OACCs1 跨度 | OACCd 对齐 | OACCs1 对齐 |
| :-- | :-- | :-- | :-- | :-- |
| 0(8-bit) | 1 个 OACC | 8 个 OACC(`OACCs1` 至 `OACCs1+7`) | 8VA 对齐 | 8VA 对齐 |
| 1(16-bit) | 1 个 OACC | 4 个 OACC | 8VA 对齐 | 8VA 对齐 |
| 2(32-bit) | 1 个 OACC | 2 个 OACC | 8VA 对齐 | 8VA 对齐 |
| 3(64-bit) | 1 个 OACC | 1 个 OACC | 8VA 对齐 | 8VA 对齐 |

**OACCs1 与 OACCd 不能互相覆盖**——offset 来源 OACC 与目标 OACC 必须不同。

### 8.2 MLI_VLDXI32OA / MLI_VSTXI32OA(32-bit offset)

与 §8.1 同构,差异:每个 offset **32-bit**,只取 `VACCs1[i][31:0]`,所需 OACC 跨度减半:

| dwidth | OACCd / OACCs2 | OACCs1 跨度 | OACCs1 对齐 |
| :-- | :-- | :-- | :-- |
| 0(8-bit) | 1 个 OACC | 4 个 OACC | 8VA 对齐 |
| 1(16-bit) | 1 个 OACC | 2 个 OACC | 8VA 对齐 |
| 2(32-bit) | 1 个 OACC | 1 个 OACC | 8VA 对齐 |
| 3(64-bit) | 1 个 OACC | 1 个 OACC(`QACCs1` 即 4VA) | 4VA 对齐 |

OACCs1 与目标 OACC 不能互相覆盖。Implicit Use:`VAB_VPT*` / `TCTL` / `VL`(+ Store 多 `ESL_DTYPE`)。

## 9. 1D Vector AMO(REDV.ADD / REDV.MAX / REDV.MAXNUM)

V-slot 48-bit 编码:`vm`(29)、sub-code2(28..27)、`dwidth`(26..25)、`dtype`(24..23)、`Rs1`(20..16)、`OACCs1`(15..6)、opcode(5..2)、VCE / CCE(1..0)。

每条 REDV.* 把 OACCs1(8 个 VA)与从 `SR[Rs1]+512*i`(双 VPT 各偏移 512B)起的连续 memory 数据**逐 element 做原子操作**,结果写回 memory 原地址(不写回 OACC)。每个 element 操作内部走 AMO 通路保证原子性,但**整条向量指令本身不保证元素间顺序的原子性**(由 §8.7 总则规定)。

**dtype × dwidth 合法组合**(三条 REDV 一致):

| Data type | dtype | dwidth |
| :-- | :-- | :-- |
| UINT32 | 0 | 2 |
| INT32 | 1 | 2 |
| FP16 | 2 | 1 |
| FP32 | 2 | 2 |
| BF16 | 3 | 1 |
| Other | — | Reserved |

**算术行为**:

- INT/UINT 溢出 → 保留 LSB,**不做 saturation**。
- FP16 / FP32 / BF16 → subnormal **不做 flush-to-zero**,舍入模式**固定 round-to-nearest-even**(不受 MODE_WRK 影响)。
- REDV.MAX:浮点输入有 NaN → 结果为 ISA 标准 NaN(见 NaN Result 章节)。
- REDV.MAXNUM:浮点只有一个 NaN → 选非 NaN 数值;两个都是 NaN → 选标准 NaN。
- 64-bit 数据(dwidth=3)**暂不支持**——指令视为 NOP。

VL/maskbit 与族通用规则一致(index ≥ VL 或 maskbit=0 严格不回写)。Implicit Use:`VAB_VPT*` / `VL` / `TCTL`。
