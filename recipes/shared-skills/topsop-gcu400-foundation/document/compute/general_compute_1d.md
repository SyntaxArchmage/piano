# V3 1D 计算流水线模型

> OACC 间接寻址完整三种粒度、mask bypass 五条特例、VL tail 行为分类等指令编码层细节归 `isa4_instruction_ref.md`,本文档不复述。

---

## 1. SIP4.0 流水线分级与 1D 路径定位

SIP4.0 XPU 流水线分四级:

| 级别 | 职责 | 主要资源 |
| :-- | :-- | :-- |
| S1 | 指令取指 | Sub-Thread IPF 调度、L1 ICache、L0 Inst-RD(Inst L0 Buf,Depth=256)、Decode |
| S2 | 标量调度 | PISQ(SR/TAR RFC 读出与 reorder)、RFRD(Inst Buffer / SR-LD Register File / SR Operand Buffer)、SR RFC、TAR RFC、Scalar ALU(SCC RAW、TAR forwarding、SLDST credit) |
| S3 | 向量调度 | PISQ → PreSplit(2D/MSF / VLDA / 1D / VST 各路 PreSplitter)→ Chn_Switch(包含 VA Cache Tag)→ RNME Issue → ROQ(Hazard 管理 L0 VA、L1 Mem)→ PostSplit(Cache Data) |
| S4 | 向量执行 | InstQ0(2D-Compute)、InstQ1(VLDA-L0P5)、InstQ2(VLDA-L0/L1、1D-Compute、VSTA+VLD)→ MAC Path / Long-Move Resp Path / Short-Move Path / SR-based non-RO L1 Load / 1D MAC Path / VSTA Path |

抽象上:S1+S2 是"向量指令产生器"(追求指令吞吐量);S3 做向量指令动态调度,管理 latency 与 outstanding;S4 是向量指令执行单元。S3 是 1D 与 2D 的共享调度阶段,跨 sub-thread 调度主要服务于 2D operand release。

S4 的 VLIW packet 在三个 InstQ 上并行发射:1D 计算与 VSTA+VLD、VLDA-L0/L1 同走 InstQ2;2D 计算独占 InstQ0;VLDA-L0P5 独占 InstQ1。1D 计算与同 InstQ 内其他类落入同一调度通道,需注意排队。

---

## 2. Register File 位置

| 寄存器组 | 物理位置 | 算子要点 |
| :-- | :-- | :-- |
| SR / TAR / VL | S2 | 标量与 VL 写回都在 S2,1D 标量地址计算路径与 VL 设置在同一阶段流转 |
| VA / VM | S4 | 向量数据与 maskbit 真正落到 S4 才生效 |

硬件 move 方向限制:

- 避免 `VA → SR` 的 move——原因:`VA → SR` 跨 S4 → S2 反向,跨级取数昂贵
- `SR → VA` 的 move 可以——原因:同向(S2 → S4)沿流水线推进,无反向回拉

硬件已有的两类 RAW forwarding:

- 标量计算 RAW forwarding(同 SR 在背靠背标量指令间)
- 标量到向量的 scalar RAW forwarding(SR 写出后立即被向量指令的标量操作数消费)

---

## 3. 1D 内存 latency 与带宽

1D 主路径访问参数:

| 访问类型 | Load-to-Use Latency | 带宽 |
| :-- | :-- | :-- |
| SR 访问 SDMEM | 8 cycle | 2 × 8 B/cycle |
| VA 访问 VDMEM | 31 cycle | 256 B Rd + 256 B Wr |
| SR 访问 VDMEM | 51 cycle | 8 B/cycle |
| 访问 SIP 内部寄存器 SCF bus(write) | 34 cycle | — |
| 访问 SIP 内部寄存器 SCF bus(read) | 42 cycle | — |
| 访问 CDTE 寄存器 | 100 ~ 136 cycle | — |
| CF 访问 | — | 连续 128 写 / 连续 32 读 |

算子开发要点:

- 通过 SR 读写 VDMEM 走 `SR ↔ VDMEM` 通道,latency 51 cycle 远高于 VA ↔ VDMEM 的 31 cycle——原因:SR 通道宽度仅 8 B/cycle,且要跨标量与向量域;数据搬运若能直接走 VA 通道就别绕 SR
- 跨 SIP 内部寄存器(走 SCF bus)读写 latency 34 ~ 42 cycle,适合作为低频配置寄存器,不适合放热路径数据

---

## 4. Turn-around Latency 与 unroll

1D 计算循环的 turn-around 由四部分加和:

```
Turn-around Latency = L2U + RAW + WAR + Inst Cycle + 多线程竞争
                    = 31 + 13 + 6 + 32(unroll8 × 2op × 2time) + 竞争 delta
                    = 82 + 竞争 delta
```

- L2U = 31 来自 §3 中 VA 访问 VDMEM 的 load-to-use
- RAW = 13、WAR = 6 是 1D 主路径上 SR/VA 写后读、读后写的硬件 latency
- Inst Cycle 项 32 cycle 以 unroll8 为基准,展开 8 次 / 每次 2 op × 2 time slot
- 多线程竞争 delta 取决于活跃 sub-thread 数,见 §6

> 计算次数很少时,本身被 latency 影响较多。

unroll 决策:

- 加深 unroll 摊薄 L2U + RAW + WAR 的固定项,让循环主体被吞吐量主导而非 latency
- 加深 unroll 增加 OACC 寄存器占用——OACC 在 sub-thread 间通过 VAB 划分,unroll 深度受 `LAUNCH_WRK.THREAD_OACC` 配额上限约束

---

## 5. 2D 指令产生节奏

GEMM 64×64×64 在硬件上的指令产生节奏:每 32 cycle 才能下发一条 GEMM 指令(MLI 编码包很宽,且 LHS/RHS 形状 SPR 配置占用 SALU slot);"多少个 cycle 生产一条 GEMM 指令"是 2D 主导算子能否跑满 2D MAC 的关键瓶颈。

GEMM 形状描述靠以下 SPR 组(在 gcu400-compute SKILL 中作算子层接口列出):

```
LHS_DIM0_STRIDE / LHS_DIM1_STRIDE / RHS_DIM0_STRIDE / RHS_DIM1_STRIDE
LHS_DIM0_REAL / LHS_DIM1_REAL0 / LHS_DIM1_REAL1 / LHS_DIM1_REAL2
RHS_DIM0_REAL0 / RHS_DIM0_REAL1 / RHS_DIM0_REAL2 / RHS_DIM1_REAL
```

完整字段语义见 `sip4_spr_spec.md` §3.7;gemm_mode 与 K×N 形状编码完整表见 `primo_gemm.md`。

---

## 6. 2D-1D 并行与 2D-SFU 串行

**2D-1D 并行约束**:

- 最优化调度受软件空间串行执行制约——原因:S3 PISQ 跨 sub-thread 调度主要为 2D operand release 服务,1D 跨 sub-thread 调度并不带来同等收益
- 多个 sub-thread 均匀调度 1D 会增大 latency——原因:1D 指令从多 sub-thread 进入 S3 RNME 后会在 issue 阶段竞争,turn-around 公式末尾的"竞争 delta"项即由此而来
- 2D 与 1D 在 S3 调度阶段同时存在时会竞争 issue 资源

**2D-SFU 串行约束**:

> SFU 串联在 2D 后执行,会和 2D 相互影响(L1 和 L0 latency)。

- SFU(MSF 系列)与 MLI_GEMM、REDSUM stage 3 共享 2D 计算通路——原因:三类指令都走 S3 → S4 的 2D MAC path,无法在同 cycle 与 2D 并行

---

## 7. VA0 Cache 与 VAB_VPT0 切换约束

S3 含一组 VA0 Cache 用于 hazard 管理,该 cache 无 coherence 机制——所以切换 `VAB_VPT0` 前必须先 flush VA0 Cache,否则旧 cache 行仍按旧 VAB 映射回数据。

---

## 8. ISA4.0 spec 中 1D 相关侧面(摘点)

以下条目仅作侧面提点,完整定义在 spec 转录文档中:

- OACC 是 1D 主路径的输出累加器(每 SIP 768 个,4096 bit / OACC = 128 FP32 lane);1D vector load/store/compute 指令通过 VAB_VPT* 间接寻址 OACC——VAB 划分粒度 32 个 VACC = 4 OACC(`sip4_spr_spec.md` §3.4)。完整三种粒度(10-bit VACC、8-bit OACC、10-bit OACC)的指令族归 `isa4_instruction_ref.md`
- VL 控制 VACC / DACC / QACC / OACC 向量指令 body 与 tail 的分界——硬件 VL 字段 10 bit、编码上限 1023(`sip4_spr_spec.md` §3.6)。tail 各指令族行为(写回保留 / 写 0 / 不写内存等)归 `isa4_instruction_ref.md`
- maskbit 走 VA 寄存器格式,源自 VACC0(`VAB_VPT* + 0`);VM=0 触发的固定编码与五条 set-pattern 特例(FIRST_MB / MIOTA / MSBF / MSIF / MSOF)归 `isa4_instruction_ref.md`

---
