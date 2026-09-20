# ISA4.0 MSF / RED 指令族(MALU 2D 通路上的标量函数 / 序列生成 / 规约)

> `isa4_instruction_ref.md` 已给出 MSF / RED 在 1D 部分的英文摘要,本文件给出对应 ISA bit 编码视角的中文展开。RNG 系列(MLFSR / MCASR / MOP.XOR_U32MIX / Uniform RNG Architecture)与算子开发关联弱,本文不展开。

## 1. 族定位:2D 通路上的非 GEMM 用户

**MSF / REDSUM(stage=3) / REDMAX(stage=3) / REDMIN(stage=3) / MLI_GEMM 共享 SIP4.0 的 2D 计算通路**。三个直接后果:

- 三类指令**互斥串行**:同一 cycle 不能既发 MLI_GEMM 又发 MSF;不能既发 MLI_GEMM 又发 REDSUM stage=3。性能评估时 MSF / RED stage=3 占用的 cycle 与 GEMM 竞争 2D MAC 资源。
- **目的寄存器与源寄存器都不能是 VACC0 / OACC0**——为减少 2D 通道与其他 ALU 之间 maskbits hazard 管理。MSF / MLI_GEMM / REDSUM(stage=3) 三类同列。
- **输入与输出寄存器不能互相覆盖**——这些指令在 SIP4.0 上按 OACC 颗粒度拆分发射,SRC/DST 重叠会破坏拆分语义。MSF / REDMAX(stage=3) / REDMIN(stage=3) / REDSUM(stage=3) / MLI_GEMM 同列。

REDSUM/REDMAX/REDMIN 的 stage=0/1/2 不走 2D 通路,走 1D MOP 路径,与上述限制无关。

## 2. MID:序列生成(VPT-aware index)

48-bit M-slot 编码:sub-code(43..42)、`dwidth`(43..42 的 sub-code 内子段)、`vm`(41)、`LCE`(40)、`dtype`(39..38)、`mid_mode`(35..32)、`Rs1`(20..16)、`OACCd`(15..6)、opcode(5..2)、Const_0(1)、MCE(0)。

```
limit = {0:512, 1:256, 2:128, 3:64}[dwidth]   // 单 OACC 内的 element 数
for i = 0 .. VPT_NUM-1:
    for j = 0 .. limit-1:
        if mid_mode == 0:   # 两 VPT 上产生连续 index
            OACC[i][OACCd_index][j] = SR[Rs1] + j + limit*i
        else:               # 两 VPT 上 duplicate
            OACC[i][OACCd_index][j] = SR[Rs1] + j
```

**核心特性**:

- 产生**连续无符号整型序列**到目标 OACC,序列起始值 = `SR[Rs1]`,步长 = 1,溢出**不做 saturation**。
- 指令位宽固定为 OACC,通过 10-bit OACC 域寻址;受 VL 影响,支持 UINT64 与 OACC 写回。
- `mid_mode=0` 双 VPT 产生连续 index(VPT0:Rs1 ~ Rs1+limit-1;VPT1:Rs1+limit ~ Rs1+2*limit-1);`mid_mode=1` 两 VPT 各自从 SR[Rs1] 起 duplicate。
- `vm=0` 时按 `VACC[0+VAB_VPT*]` maskbit 前 `64*(2^(3-dwidth))` 个 bit 作为写回条件;maskbit=1 写回,=0 保持原值。
- TCTL 关闭某 VPT 时,该 VPT 下指令视为 NOP。

合法 dtype × dwidth(只支持 UINT,不支持 SINT / 浮点):

| Data type | dtype | dwidth |
| :-- | :-- | :-- |
| UINT8 | 0 | 0 |
| UINT16 | 0 | 1 |
| UINT32 | 0 | 2 |
| UINT64 | 0 | 3 |

Implicit Use:`TCTL` / `VAB_VPT*` / `VL`。

## 3. MSF:超越函数(Math Special Function)

48-bit M-slot 编码:sub-code(43..42)、`dwidth`(43..42 子段)、`vm`(41)、`LCE`(40)、`dtype`(39..38)、`OACCs1`(35..26)、`subop`(20..16)、`OACCd`(15..6)、opcode(5..2)、Const_0(1)、MCE(0)。

```
OACCd[i] = subop(OACCs1[i])    // per-element FP32 超越函数
```

### 3.1 subop 全集(11 个)

| subop 编码 | 函数 | 备注 |
| :-- | :-- | :-- |
| 0x0 | `exp(x)` | |
| 0x1 | `softplus(x)` | log(1+e^x) |
| 0x2 | `tanh(x)` | |
| 0x3 | `sigmoid(x)` | 1/(1+e^-x) |
| 0x4 | `gelu(x)` | |
| 0x5 | `ln(x)` | **需要配合预处理**——典型路径是先做 abs / clamp 把负数与 0 处理掉再走 MSF |
| 0x6 | `rec(x)` | 1/x |
| 0x7 | `rsqrt(x)` | 1/sqrt(x) |
| 0x8 | `sin(x)` | 单位弧度,**有效输入范围 (-π, π) ≈ (-3.15625, 3.15625)**;超出范围输出 NaN(不是周期延拓) |
| 0x10 | Normal distribution RNG | 正态分布随机数 |

### 3.2 dtype × dwidth 与 src/dst 操作数

| Data type | dtype | dwidth | src1 | dst | 适用 subop |
| :-- | :-- | :-- | :-- | :-- | :-- |
| FP32 | 2 | 2 | 1 OA | 1 OA | 所有非 RNG subop(0x0~0x8) |
| UINT64 | 0 | 3 | 2 OA | 1 OA | 仅 RNG subop(0x10) |
| Other | — | — | — | — | Reserved |

**关键约束**:

- **`vm` 固定 1**——MSF 不支持条件写回,总是非条件写回。
- **OACCs1 / OACCd 不能为 0**(见 §1)。
- **OACCs1 与 OACCd 不能互相覆盖**(见 §1)。
- 输入输出仅支持 FP32(除 RNG 外)——MSF 不直接接受 FP16 / BF16,如需 FP16 输入需上游先 cvt 到 FP32。

Implicit Use:`TCTL` / `VAB_VPT*` / `MODE_WRK.denormal_flush` / `MODE_WRK.rounding` / `VL`。

## 4. REDMAX / REDMIN(stage 控制的规约)

48-bit M-slot 编码:sub-code(43..42)、`dwidth`(43..42 子段)、`nan_mode`(41)、`LCE`(40)、`dtype`(39..38)、`stage`(37..36)、`OACCs1`(35..26)、`bcast`(17 ~ 16)、`OACCd`(15..6)、opcode(5..2)、Const_0(1)、MCE(0)。

REDMAX / REDMIN 同构,只是 reduce 函数不同(取 max / 取 min)。本节按 REDMAX 描述,REDMIN 同步替换。

### 4.1 OACC 区间命名

REDMAX/REDMIN/REDSUM 共用以下命名(stage=0/1/2 在不同区间做 pairwise reduce):

- `QACCs1` = `VACC[VPT][VACCs1_index]` 至 `VACC[VPT][VACCs1_index+3]`,`QACCs2` = `VACC[VPT][VACCs1_index+4]` 至 `VACC[VPT][VACCs1_index+7]`。
- `DACCs1` = `VACC[VPT][VACCs1_index]` 至 `VACC[VPT][VACCs1_index+1]`,`DACCs2` = `VACC[VPT][VACCs1_index+2]` 至 `VACC[VPT][VACCs1_index+3]`。
- `VACCs1` = `VACC[VPT][VACCs1_index]`,`VACCs2` = `VACC[VPT][VACCs1_index+1]`。
- `QACCd1` / `QACCd2` / `DACCd1` / `DACCd2` / `VACCd1` / `VACCd2` 同构,把 s1/s2 替换为 d1/d2。

也即 1 个 OACC = 8 VA = 4096-bit;QACC = 4 VA = 2048-bit;DACC = 2 VA = 1024-bit;VACC = 1 VA = 512-bit。

### 4.2 stage 行为(4 级)

```
if stage == 0:
    QACCd1[2047:0] = reduce_max(QACCs1, QACCs2, 2048, vm=1)   # QACCd2 保持原值
if stage == 1:
    DACCd1[1023:0] = reduce_max(DACCs1, DACCs2, 1024, vm=1)   # DACCd2 保持原值
if stage == 2:
    VACCd1[511:0]  = reduce_max(VACCs1, VACCs2, 512,  vm=1)   # VACCd2 保持原值
if stage == 3:
    if bcast == 0:
        OACCd[2^(3+dwidth):0] = reduce_max_scalar(VACCs1, 512, vm=1)
    else:
        for e in 0..(4096/data_width)-1:
            OACCd[e] = reduce_max_scalar(VACCs1, 512, vm=1)
```

stage=0~2:**pairwise(对偶)reduce**——把 OACC/QACC/DACC 的两半逐 element 做 max/min,结果回写到 d1 子区域,d2 区域保持原值。stage=3:**真正的 scalar reduction**——把 VACCs1 的 512-bit 内所有 element 规约成一个标量。

### 4.3 bcast(只在 stage=3 有效)

- `bcast=0`:把规约结果写回 OACCd 的最低 element 位,**其余 datalane 回写为 0**。
- `bcast=1`:把规约结果写回 OACCd 的所有 datalane(广播到整个 4096-bit 输出)。

bcast=1 的典型用途是给后续 1D 计算提供 max/min 标量(softmax 的 max-subtract 阶段需要标量广播)。

### 4.4 nan_mode(浮点 NaN 处理)

stage ≠ 3:

- `nan_mode=0`:相比较两个浮点元素中**有 NaN** → 结果选 ISA 标准 NaN(详见 NaN Result 章节)。
- `nan_mode=1`:浮点元素**只有一个 NaN** → 选非 NaN 数值;两个都是 NaN → 选标准 NaN。

stage = 3:同构,只是比较对象从"两 element"变成"VACCs1 内全部 element",规则相同。

`nan_mode=0` 对应严格 IEEE754 max/min(`maximum`/`minimum`),`nan_mode=1` 对应 IEEE754 maxnum/minnum——选择哪种由算子语义决定。

### 4.5 stage=3 额外约束

stage=3 时**OACCs1 与 OACCd 不能互相覆盖**——见 §1。

### 4.6 合法 dtype × dwidth(REDMAX / REDMIN)

| Data type | dtype | dwidth |
| :-- | :-- | :-- |
| UINT8 | 0 | 0 |
| INT8 | 1 | 0 |
| UINT16 | 0 | 1 |
| INT16 | 1 | 1 |
| UINT32 | 0 | 2 |
| INT32 | 1 | 2 |
| FP16 | 2 | 1 |
| BF16 | 3 | 1 |
| FP32 | 2 | 2 |
| Other | — | Reserved |

REDMAX/REDMIN **不支持 VL**——`vm` 固定为 1。

Implicit Use:`TCTL` / `VAB_VPT*` / `MODE_WRK.denormal_flush`。

## 5. REDSUM(规约求和)

48-bit M-slot 编码与 REDMAX 同构,但去掉 `nan_mode` 字段(改为 N/A)。stage / bcast / OACC 命名与 §4 完全一致。

### 5.1 算术行为

- 整型加法**溢出保留 LSB,不做 saturation**(同 REDV.ADD)。
- BF16 / FP16 结果**会根据 `MODE_WRK.FP16_OVCLP` / `MODE_WRK.BF16_OVCLP` 进行 clamp**——溢出 clamp 到正负最大可表数值,而非 INF。
- **正 0 与负 0 都写回成正 0**——避免对下游 1D 浮点比较产生 ±0 二义。

### 5.2 SIP4.0 实现限制

stage ≠ 3 时**复用 1D 计算单元**;stage = 3 时**复用 2D 计算单元**。在此背景下 ISA4.0 限制:

- **只支持 2D 计算指令支持的数据类型**——INT8 / UINT8 / FP16 / FP32 / BF16,不支持 INT16 / UINT16 / INT32 / UINT32。
- **不支持 VL**——`vm` 固定为 1。

合法 dtype × dwidth(REDSUM 比 REDMAX/REDMIN 少了 4 个整型条目):

| Data type | dtype | dwidth |
| :-- | :-- | :-- |
| UINT8 | 0 | 0 |
| INT8 | 1 | 0 |
| FP16 | 2 | 1 |
| BF16 | 3 | 1 |
| FP32 | 2 | 2 |
| Other | — | Reserved |

stage=3 时**OACCs1/OACCd 不能为 0,且不能互相覆盖**(见 §1)。

Implicit Use:`TCTL` / `VAB_VPT*` / `MODE_WRK.denormal_flush` / `MODE_WRK.rounding` / `MODE_WRK.fp16_ovclp` / `MODE_WRK.bf16_ovclp`。
