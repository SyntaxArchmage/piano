# ISA4.0 CTRL 指令族(分支 / 跳转 / 同步 / 调度提示 / 缓存 invalidation)

> CTRL 控制类指令用于修改 PC、实现指令流跳转或切换运行状态(WAIT / HALT / TRAP)。除 NOP16(S0-slot / S1-slot 16-bit)与 CNOP(C-slot 16-bit)外,21 条指令均在 VLIW 包内走 C-slot 48-bit 编码。Branch / Jump 的 Penalty cycle 表见 `sip4_pipeline.md` §10;footprint_order 与 MLI_HINT_GEMM Rs1 字段表见 §5.1。

## 1. CTRL 族总览

CTRL 共 21 条指令分 9 类(NOP16 / CNOP 算同一类):

| 类别 | 指令 |
| :-- | :-- |
| 长跳转(PC-relative,新增) | `JI` / `JIL` / `AUIPC` |
| 条件分支 | `B.unsigned` / `B.signed` / `BX.unsigned` / `BX.signed` |
| 短跳转 | `JAL` / `JALR` |
| 运行状态 | `WAIT` / `WAIT_I` / `HALT` / `TRAP0` |
| 调度 hint(与 MLI 固定打包) | `MLI_HINT` / `MLI_HINT_GEMM` |
| 多线程调度 | `SCHED` |
| ICache 操作 | `IDMA` / `ITAGOP` |
| L0P5 一致性 | `L0P5_INV` |
| NOP | `NOP16`(S0/S1 slot)/ `CNOP`(C-slot) |

族内通用属性:

- **CTRL 指令几乎都只能与 NOP 打包**——`IDMA` / `ITAGOP` / `MLI_HINT*` / `TRAP0` 等"只能和 NOP 打包,否则视为非法指令";其余指令视具体编码定。`MLI_HINT` / `MLI_HINT_GEMM` 是反向例外:它们必须与 MLI slot 的 4 条 `MLI_VLDXOA / MLI_VSTXOA / MLI_VLDXI32OA / MLI_VSTXI32OA` 或 `MLI_GEMM` 配对,不能单独打包。
- **VLIW 包对 C-slot 内容敏感**——C-slot 是 `MLI_HINT` / `MLI_HINT_GEMM` 时整个包按 MLI 格式解码(C+Reserved+MLI+Reserved),不再是 5-issue 格式。
- **PC 偏移粒度统一为 16 字节**——所有 PC-relative 指令(JI / JIL / AUIPC / B.* / BX.* / JAL)的立即数都左移 4 位与 PC 相加,因为 SIP 的 VLIW 包尺寸是 16 字节(128-bit)。`JALR` 取 `Rs1 & 0xffff_fff0` 后再加偏移,等价语义。
- **PC 与 Next PC 计算按 32-bit**——所有 link 类指令(JIL / JAL / JALR)写入 `PC + 16` 时,Next PC 视为 32-bit 计算;高 32 bit 写 0(JIL)。

## 2. 编码通用约定

CTRL 指令均为 48-bit 编码并放在 C-slot。共享字段约定:

- **bit 0**:CTRL 指令的最低 bit 固定为 `1`(区分于 `Const_0 = 0` 的 NOP16 / CNOP 编码)。
- **opcode**:bit `5..1`。
- **PC-relative Imm 字段**:JI / JIL 用 26-bit `Imm26`(范围 ±2^29 字节);AUIPC 用 16-bit `Imm16`(左移 16 位与 PC 加);B.* / BX.* 用 13-bit 拼接立即数 `S-Imm13 = {Imm6, Imm2, Imm5}`;JAL 用 16-bit `S-Imm16 = {Imm5, Imm7, Imm4}`;JALR 用 12-bit `S-Imm12 = {Imm5, Imm7}`。
- **mode 域(B.* / BX.* 共用)**:2-bit,编码 `EQ / NEQ / GE / LT` 4 种比较关系。
- **gsync / clr / dec(WAIT / WAIT_I 共用)**:1 bit 各一;`gsync=0` 走 general mailbox(SIP4.0 共 128 + 16 个虚拟 mailbox),`gsync=1` 走 global sync mailbox(共 4 个)。

## 3. 条件分支:B.unsigned / B.signed / BX.unsigned / BX.signed

四条指令只在比较位宽与有 / 无符号上不同:`B.*` 比较 32-bit(`SR[Rs][31:0]`);`BX.*` 比较 64-bit(`SR[Rs][63:0]`)。`unsigned` 走无符号比较,`signed` 走有符号比较。

48-bit C-slot 编码字段(4 条共享):

| 字段 | 位段 |
| :-- | :-- |
| sub-code | 23 |
| `mode` | 31..30 |
| `Imm6` | 29..24 |
| `Imm2` | 22..21 |
| `Rs2` | 20..16 |
| `Rs1` | 15..11 |
| `Imm5` | 10..6 |
| opcode | 5..1 |
| Const_1 | 0 |

伪代码(以 BX.signed 为例,B.signed 把 `datasize` 改成 32):

```
datasize = 64;        // B.signed = 32; B.unsigned = 32; BX.unsigned = 64
bits(datasize) operand1 = SR[Rs1][datasize-1:0];
bits(datasize) operand2 = SR[Rs2][datasize-1:0];
bit jumpflag = 0;
if (mode == 0) jumpflag = signed_cmp(operand1, '=', operand2);
if (mode == 1) jumpflag = signed_cmp(operand1, '!=', operand2);
if (mode == 2) jumpflag = signed_cmp(operand1, '>=', operand2);
if (mode == 3) jumpflag = signed_cmp(operand1, '<', operand2);
if (jumpflag) {
    bits(32) BranchTargetAddress = PC + (sign_ext(Imm13) << 4);
}
```

`mode` 编码:`0` = EQ、`1` = NEQ、`2` = GE、`3` = LT。

**S-Imm13 范围 = ±2^16 字节(即 ±64 KB)**——原因:13-bit 有符号拼成 13-bit Imm 后再左移 4 位,得到 17-bit 有符号字节偏移。超过该范围时编译器走 JI / JIL 长跳转。

**B.* 不是 link 类指令,不写回 SR**——条件不满足时整条指令视为 NOP(继续执行 PC+16);条件满足时跳转到 `PC + (sign_ext(Imm13)<<4)`。

## 4. 跳转

### 4.1 JI(PC-relative Long Jump,§8.3.1)

48-bit C-slot 编码:`Imm26`(31..6)、opcode(5..1)、Const_1(0)。

```
bits(32) BranchTargetAddress = PC + (sign_ext(Imm26) << 4)
```

ISA4.0 新增 PC-relative Long Jump,相比 `JAL r0, offset` 立即数范围扩到 26-bit。**不写回任何 SR**——非 link 跳转,语义等价于 `JAL r0`。

### 4.2 JIL(PC-relative Long Call,§8.3.2)

48-bit C-slot 编码:`Imm26`(31..6)、opcode(5..1)、Const_1(0)。

```
SR[SR3][31:0] = PC + 16;
SR[SR3][63:32] = 0;
bits(32) BranchTargetAddress = PC + (sign_ext(Imm26) << 4);
```

**JIL 隐式定义 SR3 为返回地址寄存器**——原因:ISA4.0 把长 call 的 link 寄存器钉死在 SR3,免得 26-bit 立即数还要再挤出 5-bit Rd 字段;调用方需保证 SR3 在 call 前不被使用。

### 4.3 JAL(Short Jump-and-Link,§8.3.9)

48-bit C-slot 编码:N/A(31..30)、`Imm5`(29..25)、sub-code(24..23)、`Imm7`(22..16)、N/A(15)、`Imm4`(14..11)、`Rd`(10..6)、opcode(5..1)、Const_1(0)。`S-Imm16 = {Imm5, Imm7, Imm4}`。

```
SR[Rd] = PC + 16;        // Next PC 按 32-bit 算
bits(32) BranchTargetAddress = PC + (sign_ext(Imm16) << 4);
```

**JAL 范围 ±2^19 字节(±512 KB)**——16-bit 有符号 << 4。超过该范围用 JI / JIL。

### 4.4 JALR(Indirect Jump-and-Link,§8.3.8)

48-bit C-slot 编码:sub-code(24..23)、`Imm5`(29..25)、`Imm7`(22..16)、`Rs1`(15..11)、`Rd`(10..6)、opcode(5..1)、Const_1(0)。`S-Imm12 = {Imm5, Imm7}`。

```
target = (SR[Rs1] & 0xffff_fff0) + (sign_ext(S-Imm12) << 4);
SR[Rd] = PC + 16;
PC = target;
```

**`SR[Rs1]` 末 4 bit 不为 0 时触发 EXCP_ILL_IS 异常**——原因:JALR 强制目标 PC 16 字节对齐,因为 VLIW 包按 16 字节为单位;非对齐目标无法被 fetch 单元正确切分。Compiler 必须保证 `SR[Rs1]` 已经是 16-byte aligned 才能用 JALR。

### 4.5 AUIPC(Add Upper Immediate to PC,§8.3.3)

48-bit C-slot 编码:`Imm16`(31..16)、N/A(15..11)、`Rd`(10..6)、opcode(5..1)、Const_1(0)。

```
SR[Rd][31:0] = PC + (sign_ext(Imm16) << 16);
SR[Rd][63:32] = 0;
```

AUIPC 不修改 PC,只生成 PC-relative 32-bit 地址,典型用法:配合 `LD` / `ST` 寻址 PC 附近常量池,或者配合 JALR 组成 32-bit 范围的间接跳转。

## 5. 运行状态:WAIT / WAIT_I / HALT / TRAP0

### 5.1 WAIT / WAIT_I(§8.3.10)

48-bit C-slot 编码(共享字段位段):sub-code(25..23)、`clr`(22)、`dec`(21)、`gsync`(20)、N/A(19..16 或 19)、mailbox 来源(`Rs1` 在 15..11 或 `Imm8` 在 18..11)、N/A、opcode(5..1)、Const_1(0)。两条指令唯一差别:**mailbox_id 来自 SR[Rs1][7:0](WAIT)还是 8-bit 立即数 Imm8(WAIT_I)**。WAIT_I 适用于 mailbox_id 编译期已知的场景。

WAIT / WAIT_I 行为:若指定 mailbox condition 已为 true,直接通过不进入 WAIT 状态;若为 false,SIP 进入 WAIT 状态停止执行,直到 mailbox condition 变 true 后恢复 RUN 状态。

字段语义:

- `clr=0/1`:退出 WAIT 时 **不清 / 清** 对应 mailbox(simple mode)。
- `dec=0`:不消耗 mailbox。`dec=1`:按 mailbox 定义消耗一次,支持 6 种 mode(`Wait_clear` / `Wait_minus_one` / `Wait_minus_ref` / `Credit and non-empty` / `Non-empty` / `ProduceN`)。
- `gsync=0`:等 general mailbox(共 128 + 16 virtual);`mailbox_id ≥ 144` 时 condition 永远 false,SIP 永远 hang。`gsync=1`:等 global sync mailbox(共 4 个);`mailbox_id ≥ 4` 时同样 hang;此时 `dec` 字段 dont-care(global sync mailbox 只支持 simple mode)。
- 16 个 virtual mailbox 是 mailbox 96~127 子集的 status summary,**只支持 `clr=0 && dec=0`**——硬件实现限制。

**指令给的 mailbox_id 未实现时 WAIT 永久 hang**——原因:硬件直接把未实现 ID 的 condition 视为 always false。Compiler / runtime 必须确认目标平台的 mailbox 数量。

### 5.2 HALT(§8.3.11)

48-bit C-slot 编码:N/A(31..26)、sub-code(25..23)、N/A(22..6)、opcode(5..1)、Const_1(0)。

```
RunState = HALT;
```

**HALT 不保证前序 IO / L1 / L2 / L3 写访问完成,HALT 之前必须显式插入 FENCE**——原因:HALT 只是切换 sub-thread 的 run state,不带任何 fence 语义;若不在 HALT 前 FENCE,该 sub-thread 被复用时前一轮残留的写访问会在新使用者的执行窗口内完成,产生不可预期结果。具体 fence 语义见 SLDST 的 `MOVS.Barrier`。

### 5.3 TRAP0(§8.3.13)

48-bit C-slot 编码:N/A(31..26)、sub-code(25..23)、N/A(22..6)、opcode(5..1)、Const_1(0)。`sub-code = 0x0` 表示 TRAP0,其他值 reserved。

行为:

- TRAP0 用于让软件在执行后进入 debug mode。
- TRAP0 指令的 PC 会被捕获到 `DBG_MODE_PC`(实现需提供该寄存器);进入 debug mode 后 current PC 指向 TRAP0 PC。
- **TRAP0 不是 exception**——`EXCP_PC` / `EXCP_STS` 不会因进入 debug mode 而更新。
- 已在 debug mode 时,TRAP0 等价 NOP。
- TRAP0 可被 exception handler 使用,与 `EXCP_STS_GLB` 值无关。
- TRAP 指令为 precise instruction:实现支持 pipelined execution 且 inflight 指令命中 enabled exception 时,**靠后的 TRAP0 不会先于该 exception 执行**——靠后的 TRAP0 不会让 CPU 进入 debug mode。

Implicit Defs(CSR):`DBG_CMD` / `DBG_MODE_THD0_STS ~ DBG_MODE_THD15_STS` / `DBG_MODE_THD0_PC ~ DBG_MODE_THD15_PC`。

**TRAP0 只能与 NOP 打包,否则触发 illegal exception**——原因:TRAP 切换运行状态,与同包其他指令的副作用次序无定义。

### 5.4 NOP16(§8.3.12)/ CNOP(§8.3.21)

| 指令 | Slot | 编码 |
| :-- | :-- | :-- |
| `S1.NOP16` | S1-slot | 16-bit:N/A(15..6)、opcode(5..1)、Const_0(0)|
| `S0.NOP16` | S0-slot | 16-bit:N/A(15..6)、opcode(5..1)、Const_0(0)|
| `C.NOP`(CNOP)| C-slot | 16-bit:funct3(15..13)、Const_0(12..2)、op(1..0)|

均为 No operation。CNOP 占 C-slot 的 16-bit 短编码位段;NOP16 用于在 S0 / S1 slot 填充。这两条与 48-bit 长编码 CTRL 指令在 bit 0 上区分:NOP16 / CNOP 的最低 bit 是 `Const_0 = 0`,其他 CTRL 指令是 `Const_1 = 1`。

## 6. SCHED 与 Footprint Order(§8.3.18 / §8.3.19)

### 6.1 SCHED 指令(§8.3.19)

48-bit C-slot 编码:N/A(31..27)、sub-code(26..23)、N/A(22..16)、`Rs1`(15..11)、N/A(10..6)、opcode(5..1)、Const_1(0)。

`SCHED` 是 ISA4.0 新增多线程调度指令,**只影响性能不影响功能**。通过 `SR[Rs1]` 传 64-bit 调度信息。Defeature 之后只支持设置 Footprint Order,字段:

| Rs1 位段 | 语义 |
| :-- | :-- |
| `Rs1[31:28]` | 目标硬件调度单元;`3` = S3 footprint order 调度策略,其他 reserved |
| `Rs1[27:24]` | 目标策略;`3` = 设置 `sched_fporder_en[tid]` + `sched_fporder_tout_threshold[9:0]` |
| `Rs1[23]` | `0` = 当前线程(tid 自动取),其他 reserved |
| `Rs1[21]` | `order_schd_master`(主线程标志)|
| `Rs1[20]` | `sched_fporder_en[tid]` 期望值 |
| `Rs1[15:0]` | `sched_fporder_tout_threshold[9:0]` 设置值,**高位抛弃** |

**`sched_fporder_tout_threshold` 字段宽 10-bit,推荐值为 L0 miss penalty 的一半,且最大不超过 1024**——原因:超过 1024 会让 PISQ 长时间不发指令,可能死锁。

### 6.2 Footprint Order 算法(§8.3.18 总览)

S3-PISQ 缓存上一级流水送来的 CISC GEMM 指令,L0P5 Cache 缓存左右支输入操作数并被多线程共享。S3 收到的 GEMM 顺序不一定是最佳计算扫描顺序,导致 L0P5 容量利用率低。`SCHED` + `MLI_HINT_GEMM.Rs1[15:0]` 让程序员把最优扫描顺序作为 `footprint_order` 传给硬件。

S3 维护:

- per-thread 使能 bit `sched_fporder_en[tid]`
- 共享当前 order 值 `cur_order`
- 共享超时阈值 `cur_time_threshold`(由 master 线程的 `tout_threshold` 设置)

S3-PISQ 出口选择策略(伪代码):

```
for each thread:
    if (sched_fporder_en[tid] == 0 && exists CISC_GEMM(tid) in PISQ):
        pop_first(CISC_GEMM(tid));                      // 不参与算法的线程优先弹
    else if (sched_fporder_en[tid] == 1
             && exists CISC_GEMM(tid) with footprint_order <= cur_order):
        pop(matching CISC_GEMM); cur_order++;            // 命中最佳顺序
    else if (sched_fporder_en[tid] == 1
             && exists CISC_GEMM(tid) with footprint_order > cur_order):
        tout_value++;                                    // 等待
        if (tout_value >= cur_time_threshold
            || S3-PISQ 2D queue full):
            pop_any(CISC_GEMM); tout_value = 0;          // 超时或队列满则任意发射
```

**每弹出一条 CISC_GEMM,`cur_order++`**;成功命中或超时弹出后 `tout_value` 清 0。

典型使用模式:多线程并行 thread_for 分块 → 每个线程在 master 线程上 `SCHED` 使能算法 → 各线程通过 `MLI_HINT_GEMM.Rs1[15:0]` 把每条 GEMM 的 `footprint_order` 传给 S3 → 算子结尾再 `SCHED` 关闭算法。

> 示例片段:`schd_value.tout_threshold = 256/2; schd_value.sched_fporder_en = 1; schd_value.order_schd_master = 1;` —— 该 256/2 是示例工程参数,不是硬件常量。

## 7. MLI_HINT / MLI_HINT_GEMM(§8.3.16 / §8.3.17)

### 7.1 MLI_HINT(§8.3.16)

48-bit C-slot 编码:`funct3`(15..13)、N/A(12)、`ST_ALLOC`(11..10)、N/A(9..5)、`LD_PF0`(4)、`PRI0`(3..2)、op(1..0)。

**MLI_HINT 只能与 `MLI_VLDXOA` / `MLI_VSTXOA` / `MLI_VLDXI32OA` / `MLI_VSTXI32OA` 中的一条打包,不能单独打包,也不能与其他指令一起打包**——原因:这 4 条 MLI 指令固定走 MLI 格式 VLIW 包,C-slot 必须是 MLI_HINT;decoder 看到非 MLI_HINT 的 C-slot 就会按 5-issue 格式解码,与 MLI 物理位段冲突。

**MLI_HINT 的所有域均没有实际功效**——纯占位指令。

### 7.2 MLI_HINT_GEMM(§8.3.17)

48-bit C-slot 编码:`funct3`(15..13)、`LD_PF1`(12)、`Rs1`(11..7)、`PRI1`(6..5)、`LD_PF0`(4)、`PRI0`(3..2)、op(1..0)。

**MLI_HINT_GEMM 只能与 `MLI_GEMM` 打包,不能单独打包,也不能与其他指令打包**——同 MLI_HINT 的解码路径约束。

字段语义:

| 字段 | 适用对象 | 语义 |
| :-- | :-- | :-- |
| `PRI0` | MLI_GEMM 右支读 | AXI 写请求的 Cache Priority,直接写 `Ar_user[26:25]/Aw_user[26:25]`;`0x0=stream / 0x1=normal / 0x2=residency / 0x3=default(被 PBMMU 替换)` |
| `LD_PF0` | MLI_GEMM 右支读 | 是否触发 prefetch,直接写 `Ar_user[29]`;粒度由 LLC 寄存器设置 |
| `PRI1` | MLI_GEMM 左支读 | 同 PRI0 编码 |
| `LD_PF1` | MLI_GEMM 左支读 | 同 LD_PF0 编码 |

`Rs1` 寄存器内容(由 `MLI_HINT_GEMM` 整体 packing 时注入,**不是 48-bit 编码内的 5-bit Rs1 索引**)分三段:

| Rs1 位段 | 语义 |
| :-- | :-- |
| `Rs1[31:24]` | `lhs_buf_id`,与 L0P5_INV 的 buf_id 含义一致 |
| `Rs1[23:16]` | `rhs_buf_id`,同上 |
| `Rs1[15:0]` | `footprint_order`(无符号立即数),用于 S3 footprint order 调度 |

## 8. ICache 操作:IDMA / ITAGOP

### 8.1 IDMA(§8.3.14)

48-bit C-slot 编码:`Imm7`(31..25)、N/A(24)、sub-code(23)、`mbx`(22)、`swvctm`(21)、`Rs2`(20..16)、`Rs1`(15..11)、N/A(10..6)、opcode(5..1)、Const_1(0)。

行为:**ICache 软件预取**——把指令选定的虚拟地址段从 L2 / L3 加载到 ICache,每次预取一个 cacheline。

关键约束:

- **预取地址来自 SPR `IPF_ADDR` / `IPF_ASID` / `IPF_KSID`**(SPR 194 / 195 / 196,Per-Sub-Thread)——`Rs1[31:0]` 给 IDMA 预取的 PC 地址。
- **IDMA 是非阻塞操作**。
- **IDMA 只能与 NOP 打包,否则视为非法指令**——原因:与同包其他指令的副作用次序无定义。
- `swvctm` / `Rs2` / `mbx` / `Imm7` 字段 **Reserved**。

Implicit Use:`IPF_ADDR` / `IPF_ASID` / `IPF_KSID`。

### 8.2 ITAGOP(§8.3.15)

48-bit C-slot 编码:`Imm7`(31..25)、N/A(24..23)、sub-code(22..21 之外的 N/A 段)、`addr`(21)、N/A(20..16)、`Rs1`(15..11)、N/A(10..6)、opcode(5..1)、Const_1(0)。

行为:对 ICache 的 cacheline 做 lock / unlock / invalidate 操作。

`Imm7` 编码操作类型:

| Imm7 | 操作 | 说明 |
| :-- | :-- | :-- |
| 0 | Unlock | cacheline 已 invalid 或已 unlock 时视为 NOP |
| 1 | Lock | cacheline 已 invalid 或已 lock 时视为 NOP |
| 2 | Invalidate by KSID/ASID | Invalidate 所有 KSID + ASID 与 IPF_KSID + IPF_ASID 相同的 cache line;**忽略 Rs1**;**阻塞式操作,不需要额外 fence** |
| 其他 | Reserved | |

`addr` 字段:

- `1` = 软件按 virtual address block 操作,VA 来自 `Rs1[31:0]`(VA 为 PC 地址);
- 其他 = Reserved。

Implicit Use:

- Lock / Unlock 用 `IPF_ADDR` / `IPF_KSID` / `IPF_ASID`;
- Invalidate 用 `IPF_KSID` / `IPF_ASID`(忽略 `IPF_ADDR`)。

**ITAGOP 只能与 NOP 打包,否则视为非法指令**——同 IDMA。

**软件用 ITAGOP 对 pending block 做 INVALIDATE 时,硬件会先等 pending 搬完再 invalidate**——原因:在途取指与 invalidate 不能并发处理同一 cacheline,硬件强制串行。

## 9. L0P5_INV(§8.3.20)

48-bit C-slot 编码:sub-code(43..40)、N/A(39..31)、`LCE`(40 子段)、N/A(30..26)、`Rs2`(25..21)、N/A(20..16)、`Rs1`(15..11)、N/A(10..6)、opcode(5..2)、Const_0(1)、MCE(0)。

> ISA Slot 表把 L0P5_INV 标在 "M Slot" 列下,但 Type 列归 CTRL 族,48-bit 编码物理位段在 MALU slot 物理位段范围内。本节按 Type 列把它纳入 CTRL 族讨论。

ISA 层操作数(从 SR 取):

```
bits(8) buf_id = SR[Rs1][7:0];
bits(8) count  = SR[Rs2][7:0];
```

`buf_id` 指定要 invalidate 的 L0P5 Cache 区间;`count` 表示一个 Kernel 内联合执行 invalidation 的次数,硬件据此决定是否真实执行 invalidation。

计数器更新逻辑(每个 `buf_id` 对应一对线程间共享的 `total_num_cnt` / `cur_num_cnt`):

```
if (count == 0) {
    buf_id.total_num_cnt = 0;
    buf_id.cur_num_cnt   = 0;
    return;
}
if (count != 0) {
    if (count != buf_id.total_num_cnt) {
        buf_id.total_num_cnt = count;
        buf_id.cur_num_cnt   = count - 1;
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

ISA 层关键事实:

- **`total_num_cnt` / `cur_num_cnt` 在所有 sub-thread 之间共享**——同一 `buf_id` 多线程联合 INV,只有第一条把 `total_num_cnt` 从 0 → count 的 L0P5_INV 真正发起 invalidation。共享数据的线程 group 必须使用同一 `buf_id`。
- **CSR `XPU_SCRATCH63 = 1` 关闭某线程的 L0P5 查找,L0P5_INV 在该线程视为 NOP**——本指令没有写回 SR 副作用。
- **`MLI_HINT_GEMM.Rs1[31:24] = lhs_buf_id`、`Rs1[23:16] = rhs_buf_id`**——`MLI_HINT_GEMM` 与 `L0P5_INV` 共享 buf_id 编号空间。
