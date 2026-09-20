# SIP4.0 Memory Subsystem Reference

## 1. 概览

SIP4.0 Memory Subsystem 描述单个 SIP 上软件线程(sub-thread)所看到的存储视图:

- 三重地址视角(DVA / IPA / PA)
- 248bit DVA 空间(0 ~ 256TB)分段映射到 Private L1 / Instruction / SCF & ECF / Parameter & Stack / Shared Data / Global 空间
- 单 SIP 物理上提供 896KB VDMEM + 128KB SDMEM,通过 RBMMU 多次映射到 VA 不同段
- SIC 层面 8 个 SIP 通过 DSM(Distributed-Share-Memory)网络互联,在 SIC 内部直接共享 VDMEM,无 L2
- Cluster 之外通过 EDF master / NoC 访问 LLC / 全局空间
- Memory Consistency 由硬件维护松散一致性模型,跨 sub-thread 的数据共享靠软件 fence + HW Sync
- Load/Store 指令分为 Scalar Normal / Vector Linear / Vector Stride / Scatter-Gather / AMO / Matrix / Special 七大类
- SIP 通过 6 个 Data Fabric Port(3 master + 3 slave)接入 DSM / EDF 网络

## 2. 地址空间(§6.2.1)

### 2.1 三重地址视角

- DVA(Device Virtual Address):软件线程视角的 SIP 虚地址,256TB(48bit)
- IPA(Intermedia Physical Address):软件视角下的物理地址
- PA(Physical Address):SoC 上真实存储单元的地址。一部分 IPA 通过 XMC 把连续 IPA 映射到离散物理空间(典型:L3 与 DSM 无亲和地址空间)

每个 SIP 0~8GB 是本 IP 自有规划(各 IP 可不同),8GB ~ 256TB 是全局统一映射(PBMMU + 固定映射)。SIP 不允许跨 SIC 访问 DSM,只能访问本 SIC;SP 与 DTE 可访问 local die / peer die 上所有 DSM。

### 2.2 SIP Virtual Address Mapping

| 地址空间 | 范围 | 大小 | 共享层级 | 映射 | 说明 |
| --- | --- | --- | --- | --- | --- |
| L1 Private Space | 0 ~ 256MB-1 | 256MB | SIP 私有,全 sw thread | 固定 + mask | Private VDMEM(64MB 段)+ Private VDMEM mirror(64MB)+ Private SDMEM(128MB 段) |
| Instruction Space | 256MB ~ 4GB-1 | 3.75GB | 同进程线程 | RBMMU,每线程独立 | PC + Base → UVA;禁止 LD/ST |
| SCF & ECF Space | 4GB ~ 5GB-1 | 1GB | SCF=SIP 内共享,ECF=SoC 内共享 | 固定 | 前 32KB SCF + 32MB 起 ECF |
| Parameter & Stack Space | 5GB ~ 5.5GB-1 | 512MB | 同进程线程 | RBMMU,每线程独立 | 预期映射到 SDMEM 与 UVA |
| Reserved | 5.5GB ~ 6GB-1 | 512MB | — | — | Rsvd-Deadbeef |
| SCF & ECF Space mirror | 6GB ~ 7GB-1 | 1GB | 同 SCF/ECF | 固定 | 镜像,只支持 IO 写 |
| Reserved | 7GB ~ 8GB-1 | 1GB | — | — | — |
| Global Space I | 8GB ~ 4TB-1 | ~4TB | SoC 内同 ASID | RBMMU on EDF + 固定 | 含 UVA Space + XMC IPA hole(64TB)+ Reserved |
| Shared Data Space | 4TB(默认) ~ 5TB-1 | 1GB | 同 Cluster 内 SIP | 固定 | 基址由 XPU_DSM_BASE 配置(1TB 对齐) |
| Global Space II | 5TB ~ 256TB-1 | ~251TB | SoC 全局 | PBMMU | — |

### 2.3 Private L1 Space(§6.2.1.4)

| 段 | 大小 | 地址区域 | 访问类型 | 延迟 | 最大带宽 |
| --- | --- | --- | --- | --- | --- |
| Private VDMEM | ≤896KB | 0x0 ~ 0xE_0000-1 | 所有标量与向量 LDST | Scalar / Linear vector ~30 cycle / Others Long | LD 256B/cycle + ST 256B/cycle |
| Private VDMEM mirror | ≤896KB | 0x20_0000 ~ 0x2E_0000-1 | 同上 | 同上 | 同上 |
| Private SDMEM | 128KB | 0x800_0000 ~ 0x802_0000-1 | 所有标量 LDST + Linear Vector(vm=1) | Scalar < 8 cycle / Vector ~20 cycle | 16B/cycle |

特性:

- Private VDMEM 与 Mirror 完全指向相同物理存储单元(local VDMEM)
- Mirror 区域完全放弃 RAW / WAR 检查以换取更高带宽——硬件 hazard 检查资源不足以覆盖某些大带宽场景;非 mirror 空间通过 64bit 指针高位 RO/WO hint 达到等效效果(详见 §4.7)
- 软件需根据当前 Private VDMEM / Mirror 起始地址计算访问位置:从高地址开始划分 private,Mask 寄存器屏蔽 private VDMEM 起始;Mirror 与非 Mirror 屏蔽空间总相同
- Private SDMEM 可用作 supervisor 与计算线程之间跨进程的 paramter 地址访问;计算线程通过它们的 Parameter Space 进行读写,supervisor 通过 Private SDMEM 进行读写
- 这两个 VDMEM 地址空间不暴露给其他 SIP / SP / DTE
- VA 视角下 priavte 描述,IPA 与 PA 视角直接映射到 local VDMEM 与 SDMEM 物理单元

### 2.4 Instruction Space(§6.2.1.5)

PC 位宽扩展到 32bit,可访问空间 0~4GB,留给 PC 空间。每软件线程发射时第一个 PC 通过 CSR 寄存器配置(不一定 PC=0):

- 兼容算子建议起始 PC ≥ 0x1000_0000(256MB)
- 新算子若需通过 Legacy SDMEM 与 Supervisor 跨进程通信,起始 PC 同样建议 ≥ 0x1000_0000
- 若不需访问 Legacy L1 Space(0~256MB),且软件保证不存在 0 地址访问,起始 PC 可选 0x0

映射方式:

- 每软件线程独立的 PC 空间扩展用 RBMMU,该 RBMMU 包含 ASID
- 通过 PC + BASE 方式将 0~4GB 映射到 UVA 空间;经 EDF 上 PBMMU 由 UVA 转 IPA,经 XMC 路由到存储单元(通常 L3 地址)
- 同进程的线程拥有相同 ASID 与 inst RBMMU BASE,起始 PC 可不同
- ASID 与 inst RBMMU offset 都是线程发射参数,硬件发射时自动配置,发射后不可修改

### 2.5 SCF & ECF Space(§6.2.1.6)

两段 1GB 镜像映射:SCF & ECF Space(4GB~5GB)与 SCF & ECF Space Mirror(6GB~7GB)。每段中 SCF 占前 32KB,ECF 从 32MB 开始到 1GB 结束。VA 到 IPA 固定映射,无需 RBMMU。

两段差异:

- Mirror 段只支持 IO 写,不支持 IO 读;用于和其他 SIP / CDTE / HW sync 的同步操作
- Mirror 设置以加速 2D 计算:同一线程对 Mirror 的写,一定不会越过之前发送的 GEMM 系列指令对 memory 的读操作(硬件自动保证)——线程发完 GEMM 后,可直接发送 Signal mailbox IO 访问通知 DTE 2D 数据消费完成,无需 GEMM 与 Signal 之间添加 memory Fence
- Mirror 段后继的 GEMM 指令可超越对此区间的 CF 写
- 区间内的 CF 访问顺序遵循 §4.5 IO Consistency 模型
- 同一寄存器在两个地址区域两个不同映射地址,不保证访问顺序一致性

### 2.6 Parameter & Stack Space(§6.2.1.7)

| 字段 | Parameter buffer | Stack Remote | Stack Local |
| --- | --- | --- | --- |
| 线程共享 | 同 Kernel 线程共享 | 软件线程独立 | 软件线程独立 |
| Size | 所有 buffer 之和 ≤128KB,可分 0~128KB,最小颗粒度 128B | 15.5MB - Stack Local | 0~128KB |
| 地址区域 | 0x1_4000_0000 ~ 0x1_4002_0000-1 | Thread0:0x1_5008_0000 ~ 0x1_5100_0000-1;Thread i:上述加 16MB×i | Thread0:0x1_50FE_0000 ~ 0x1_5100_0000-1;Thread i:上述加 16MB×i |
| 访问类型 | 所有标量 LDST + 线性向量 LD/ST,其他 LDST 不可 | 同左 | 同左 |
| 延迟 | Scalar < 8 cycle / Linear vector ~30 cycle | 200~300 cycle | Scalar < 8 cycle / Linear vector ~30 cycle |
| 映射 | RBMMU,相同 Kernel 线程间共享;映射到本地 SDMEM | RBMMU,每线程独立;映射到 UVA | RBMMU,每线程独立;映射到本地 SDMEM |
| RBMMU 寄存器 | CSR/SPR: PARAM_WRK | SPR: STACK_REMOTE | SPR: STACK_LOCAL |

Parameter 特性:

- 不同 Kernel 的 Param buffer 起始虚地址不同,虚地址与 SDMEM 物理地址固定对应:`Kernel_param_virtual_addr = 0x1_4000_0000 + SDMEM_param_physical_addr`
- 总共 4 份,对应最大 4 个 kernel
- 同 kernel 线程共享同一份 Parameter buffer

Stack 特性:

- 主要满足 function call 时寄存器 spill;虚地址上 16 段,每段给各线程
- 拥有相同 ASID 的线程之间可互访
- Stack Local 通过 SPR 映射到本地 SDMEM(满足栈用量小时小 latency);具体在 SDMEM 上的位置通过 SPR 寄存器(RBMMU)配置
- Stack Remote 映射到 UVA,满足栈空间使用较大的需求;SPR 映射时使用完整 16MB 描述,但是高地址部分可能被 stack local 覆盖,低 512KB 被 mask 屏蔽,都不会真正访问到

分配:

- Parameter 由 supervisor 配置,作为发射参数(PARAM_CFG)传递,线程启动后自动设置(PARAM_WRK)
- Stack Local 由 Supervisor 分配,软件自身完成配置(MD*_WRK 传递总起始位置,各线程根据 SUB_THREAD_ID 计算并配置 SPR STACK_LOCAL)
- Stack Remote 由 Driver 分配,Supervisor 传递,软件自身完成配置

约束(场景 → 动作 → 原因):

- 线程结束时 Stack 数据全部放弃,不能延续到下一个线程——下一线程的 SUB_THREAD_ID 决定其物理 Stack 位置可能已被复用
- Paramter 与 Stack Local 总尺寸 ≤128KB(SDMEM 容量);软件约定 Param 只能用 SDMEM 低 64KB,Stack Local 低 64KB 可分配但此时不能再作为 PARAM Buffer
- **软件自身确保 Stack Local 与 Parameter Buffer 在 SDMEM 上的映射互相不交叠——原因:同一物理存储重复映射,硬件不维护一致性**

### 2.7 Shared Data Space(§6.2.1.8)

1TB 地址空间,主要存放计算共享数据(卷积 Tensor、矩阵输入输出)。通过 RBMMU 映射到物理 VDMEM 存储单元;VDMEM 可同时通过三种 UVA 地址访问:Local VDMEM / Shared Affinity / Shared Non-Affinity。后两者可被同 Cluster 所有 SIP 访问,也可通过 EDF 被同 SoC 中的 CDTE / SP 访问。其中 Shared Affinity 可通过 UVA 被同系统其他 EDF master 访问到(包括其他 cluster 的 SIP、peer-die 与 ESL 等)。

基地址通过 CSR `XPU_DSM_BASE`(Offset 0x92C, Field DSM_BASE [7:0], reset 4)配置:`DSM_Base_Addr = DSM_BASE × 0x100_0000_0000`,有效范围 1~255。默认 4TB,可选 192TB 等;1TB 对齐。

8 段地址划分给 SIC0~SIC7。固定映射,采用 SoC 绝对地址视角而非 SIP 相对地址视角:VA 与 SoC IPA 一致,避免地址转换;8 个 SIC 的 VA 都给出但软件线程只能访问自己所属 SIC 的 Shared Data Space。

| 区段 | 共享 | 大小 | 地址区域 | 访问类型 | 延迟 | Linear Vector 最大带宽 |
| --- | --- | --- | --- | --- | --- | --- |
| Shared Affinity Buffer | 本 Cluster 所有 SIP + 同 SoC 其他 master | 16MB | SIC0:0x400_0000_0000 ~ 0x400_0100_0000-1;SIC i:+128MB×i | 所有 LDST | local ~32 cycle / Remote ~128 cycle | 1D LD ~256B/cycle / 2D LD ~512B/cycle / ST ~256B/cycle |
| Shared Non-Affinity Buffer | 本 Cluster 所有 SIP + 同 SoC SP/CDTE | 7MB | SIC0:0x400_0400_0000 ~ 0x400_0470_0000-1;SIC i:+128MB×i | 所有 LDST | ~128 cycle | ~256B/cycle (single max) |

L1 VDMEM Space 加上述两段,本质是同一 cluster 中 8 个 896KB VDMEM 用三种 VA 视角访问,地址区域相互覆盖。

无亲和共享空间(Shared Non-Affinity Buffer):

- 等效于 Cluster 内每 SIP 贡献部分 VDMEM 组成连续共享存储,被 cluster 所有 SIP 共同访问;访问带宽与延迟均匀
- 软件 / 硬件最大 7MB(SIP7 实质上不是完整 SIP,只有 DSM memory 而没有计算流水线)
- VA 与 IPA 相同;通过 XMC hash 把连续 IPA 均匀离散映射到 8 个 VDMEM 上(颗粒度 128B,每段 1024B = 128B × 8 均匀分布)
- 起始地址必须 1024B 倍数对齐

有亲和共享空间(Shared Affinity Buffer):

- 16MB 地址段实际只有 7MB 存储单元(地址 hole 隔离多段连续小片区)
- 每线程根据 SIP id 定位本地 SIP VDMEM 区间与远端 VDMEM 区间
- 单段连续片区最大 896KB,但考虑 non-affinity / private VDMEM 划分,通常 < 896KB
- 访问本地 VDMEM 时提供类似 private buffer 的高带宽小延迟;访问远端 VDMEM 接近无亲和访问

每个 SIP Shared Affinity Local Space 中 1.5MB 起 128KB 用于 SP / CDTE 访问 SDMEM——只能被 SP 与 CDTE 访问,不能被本 SIP 或同 SIC 其他 SIP 访问:

| Shared Affinity Buffer 区段 | 本 SIP | 同 cluster 其他 SIP | SP 与 CDTE |
| --- | --- | --- | --- |
| 0 ~ 896KB-1 VDMEM | 可访问(受 XPU_SCRATCH0 影响) | 可访问(不受影响) | 可访问(不受影响) |
| 896KB ~ 1536KB-1 Reserved | 不能访问 | 不能访问 | 不能访问 |
| 1536KB ~ 1664KB-1 SDMEM | 不能访问 | 不能访问 | 可访问 |
| 1664KB ~ 2048KB-1 Reserved | 不能访问 | 不能访问 | 不能访问 |

SIP 角色:

- SIP7 特殊,只用于提供 896KB 存储空间作为 Shared Data Space,不能启动任何线程
- SIP0~6 正常,可启动线程,各自提供 768KB 空间作为 Shared Data Space

软件推荐对本地 SIP 划分顺序(从 VDMEM 物理低地址到高地址):Non-Affinity Buffer → Affinity Local → Private VDMEM / Mirror。三空间最小颗粒度在一个 SIP 上 128B。打开 DSM_MASK 后硬件强制按 Non-Affinity / Affinity / Private VDMEM 顺序划分,DSM_MASK 颗粒度同样 128B。

每个 Cluster 占 2 个 IPA 段(16MB Affinity + 7MB Non-Affinity);每 cluster 用 2 个 XMC aperture 进行地址映射,共 8 个 aperture。亲和空间 IPA→PA 不需 XMC Hash;无亲和空间需要,Hash 与每 SIP 软件线程视角的无亲和空间 Hash 一致。

### 2.8 Global Memory Space(§6.2.1.9)

8GB ~ 256TB(去除 Shared Data Space 的 1GB),SIP 全部转换为对 EDF 上的访问,由 EDF 上 PBMMU 与 NOC 路由。两段:8GB ~ 4TB-1 与 5TB ~ 256TB-1。可划分为 UVA 空间 / XMC IPA hole / Reserved。

### 2.9 MMU 配置(§6.2.1.10)

| MMU 类型 | Inst RBMMU | Parameter RBMMU | Stack Remote RBMMU | Stack Local RBMMU | Data Buffer RBMMU |
| --- | --- | --- | --- | --- | --- |
| 共享层级 | 每 Kernel 独立 | 每 Kernel 独立 | 每线程独立 | 每线程独立 | SIC 内所有线程共享 |
| 数量 | 2 组 | 2 组 | 10 组 | 10 组 | 1 组 |
| 对应空间 | PC 空间 | Parameter Buffer | Stack Remote 部分 | Stack Local 部分 | Private Buffer + Shared Affinity Buffer + Shared Non-affinity Buffer |
| 配置信息 | 48bit offset / 线程自带 ASID | SDMEM start addr & size | 48bit offset / 线程自带 ASID | SDMEM start addr & size | VDMEM 上的划分尺寸 |
| 映射方式 | PC → VA | VA → SDMEM PA | VA → VA | VA → SDMEM PA | VA → VDMEM PA |
| 实现 | CSR: IMEM_BASE_LO_WRK / IMEM_BASE_HI_WRK;SPR: IMEM_BASE_WRK | CSR/SPR: PARAM_WRK | SPR: STACK_REMOTE | SPR: STACK_LOCAL | CSR: XPU_SCRATCH0(本质是 mask 寄存器) |

## 3. DSM 网络与 memory 类型(§6.2.2)

DSM 网络拓扑、AXI master/slave 端口数与 bus 仲裁规则属 SoC 集成层,本文不展开;算子相关结论:跨 SIC 不能访问 DSM,只能访问本 SIC 内 8 个 SIP 共享的 VDMEM(SP / DTE 例外)。

### 3.1 SDMEM(§6.2.2.2.1)

SDMEM(标量数据存储)共 128KB / SIP,落在 local。**8 个 bank,每 bank 宽度 512bit**。memory 侧标量访问可达 1 交易 / cycle,向量访问需多周期完成。

两条访问通路:

- SIP local 指令访问
  - Scalar 延迟 ≤8 cycle;Vector 访问延迟约 20~30 cycle,与数据量相关
  - 对 vector LD/ST 指令,只允许 linear 地址且使能 maskbit 的 vector 指令,目的是读写 parameter 与寄存器 spill
- CDTE 访问
  - 通过 EDF BUS 访问 SIP 私有 SDMEM 区域做数据搬运;DTE 行为可与 load/store 请求并行,但需软件保证一致性
  - 无 bank 冲突时,每拍可同时完成两笔 ldst 请求与一笔 CDTE 请求

SDMEM 通过 RBMMU 划分为参数空间、栈空间、共享参数空间。

### 3.2 VDMEM(§6.2.2.2.2)

VDMEM(向量数据存储)共 896KB / SIP。**16 个 bank group,每 bank group 64B 虚拟 bank,最多支持 16 个 64B R/W**。

VDMEM private 区域只能通过指令访问:

- 不超过两个 linear load 请求(每 128B)+ 一个 linear store(每 128B);或一个 gather-scatter 请求(每 32 个元素)
- 标量访问 VDMEM 时合并到 linear load 或 linear store 通路;此时会因为标量与向量竞争引入延迟,local VDMEM 用 bank hash 缓解
- VDMEM 不能同时处理 gather-scatter 与 linear 请求(场景 → 动作 → 原因:gather-scatter 与 linear 紧邻指令包 → 流水线引入 bubble → VDMEM 访问通路只能容纳其中一种模式)
- linear 访问延迟约 32 cycle;gs 请求延迟 15~70 cycle,取决于元素地址冲突

VDMEM Shared 区域:

- SIP 访问自己 Affinity-local 区域,特性与 Private 区域一致
- SIP 访问其他 SIP share memory 需通过 DSM 网络互访;总线交互引入带宽限制与 latency 增加
- SP / CDTE 通过共享亲和访问可覆盖 VDMEM private 部分

## 4. Memory Consistency & Coherence(§6.2.3)

### 4.1 Cache Coherence(§6.2.3.1)

SIP 内 Cache 状况:

- ICache:见 SIP Instruction Cache 章节
- L0 RO Cache:IV / VR / SMR 寄存器的 Cache 化复用,微架构单元;通过硬件机制 / 特定指令和地址 hint 维护一致性,详见 Pipeline Spec
- 不包含传统意义上的 L1 Data Cache——因此不需要 Invalidate / Clean / Flush 操作,也不存在通常意义上 Cache 导致的 Coherence 问题

SIP 可见的 LLC 是 L3 的 Last Level Cache。SIP 没有对应硬件机制维护 LLC Coherence,但提供可操作 LLC 的维护指令(主要用于性能调优,详见 §5.6)。

### 4.2 Memory Consistency 模型(§6.2.3.2)

访存 Consistency 由硬件管理。SIP 访存单元负责保证同一地址访问的 RAW、WAR、WAW 满足松散一致性。**写指令包括 non-atomic write 和 atomic write。VDMEM Mirror 空间是一个特例,只维护 WAW**。

指令角度松散一致性 8 条:

1. 任意两个 sub-thread 之间不保证地址 consistency
2. 同 sub-thread,VPT0 与 VPT1 的向量 LD/ST 之间不保证
3. 同 sub-thread,不同 memory 区域之间不保证
4. 同 sub-thread,同 memory 区域下不同 memory 地址之间的 load / non-atomic store / atomic store 不保证
5. 同 sub-thread,如果地址相同,scalar 指令与 vector 指令的 VPT0 / VPT1 部分各自维护 consistency
6. 同一指令包当中的 load/store 与 store/store 之间,即使地址重叠也不维护
7. 同一指令中,多元素 store 之间出现地址重叠也不维护
8. 满足下列条件硬件自动维护:同 sub-thread 中前后指令包之间读写地址重叠,且地址出现在同一 VPT 内或 scalar 与 VPT 之间,且不是对 RO 区域访问 → 硬件自动维护 RAW/WAR

L1 / L3 memory 角度:

- 同 sub-thread 同地址连续 load 可连续发送,连续 store 可连续发送
- 同 sub-thread 同地址,store 必须等到 load 返回之后才能发送(硬件 load/store 单元保证)
- 同 sub-thread 同地址,load 必须等到 store 返回之后才能发送(硬件保证)
- 同 sub-thread 同地址,non-atomic store 与 atomic store 之间分配相同 AWID,由总线维护一致性
  - **特别:对 Host Memory 空间(PCIE)中同一地址 atomic 与 non-atomic 访问,SIP 不保证一致性**——PCIe 即使 ID 一样也会因为 pcie TLP ordering 引入乱序;软件需自行 fence
- 不同地址的 load / non-atomic store / atomic store 可乱序;如需保序需额外同步指令
- 对带 RO hint 的访问不保证 RAW / WAR hazard;如需对齐用 fence(RO 区域包括 VDMEM mirror、地址高位含 RO hint 的访问)

总线视角下:

- 同 sub-thread 同地址连续 load 可连续发送
- 同 sub-thread 同地址下 store 等待 load 返回才发送、load 等待 store 返回才发送(硬件保证)
- 同 sub-thread 同地址,atomic 视为略特殊 store 并和正常 store 维护 consistency——相同地址 normal store 与 atomic store 使用相同 AWID,由总线保序
- 同 sub-thread 同地址,同地址 store 之间会通过相同 AXI 索引,而不通过前一笔 store 的 response 返回来增加性能
- 不同地址 load / non-atomic store / atomic store 可乱序

### 4.3 RAW/WAR Check Bypass(§6.2.3.2.1)

通过 64bit 地址指针传 RO hint 绕开 RAW / WAR 检查,方式:

- 访问 Private VDMEM Mirror 区域
- 特定指令编码,如 GEMM 总是用 RO 视角看待 memory 中的矩阵变量
- 64bit 地址指针中 RO hint(详见 §4.7)

带 hint 时这些地址依然可执行写,只是绕开 RAW / WAR,保留 WAW。实际场景:Libra SIP 主要用 512bit 颗粒度的 linear vector load 访问本地 VDMEM,接受的最大 vector load 数量多于 RAW/WAR 检查单元数量,绕开后能有效提升带宽。Remote VDMEM / SDMEM / Global 访问不会因此提升。

### 4.4 Memory Consistency Maintenance(§6.2.3.2.2)

Libra 系统中 Memory Consistency 问题主要来自 SIP 上不同 sub-thread 对同一数据地址访问。需共享数据时(无论同 SIP 或跨 SIP),软件用 Fence + HW Sync 保证同步:

- 通用流程:sub-threadA(producer)store 数据 → fence → 发送信号;sub-threadB(consumer)等待信号 → load 数据 → fence → 发送信号;sub-threadA 等待信号 → store 数据 → fence → 发送信号
- SIP 内部要求不能用不同地址访问相同物理存储单元,但有几处特例:
  - Private VDMEM 与 Private VDMEM mirror(共享 IPA / PA):VDMEM mirror 读写后通过 fence 可在 VDMEM 空间可见,反之亦然;软件访问 VDMEM mirror 时必须自己做 coherence;同一物理存储的两个 Private VDMEM / Mirror 地址硬件不保 RAW/WAR/WAW,需软件自身 fence + sync
  - Private SDMEM 与 Parameter / Stack local:不同 VDMEM 地址指向同一物理单元的地址之间不保证 RAW/WAW/WAR,需 fence + sync 保证数据传递;希望软件上约束只有 Supervisor 访问 Private SDMEM
  - SIP 内部一部分 RBMMU 通过 VA offset 方式映射到 UVA 空间(包括 Instruction RBMMU 和 Stack remote RBMMU);若虚拟地址出现重叠或指向相同物理地址,SIP 硬件不做检查,需软件规避

### 4.5 IO Consistency(§6.2.3.3)

SIP 访存单元的 IO 访问模型:

- 两个 sub-thread 之间不保证 consistency
- 同 sub-thread,不同 slave IP 包含的 IO 区域不保证
- 同 sub-thread,相同 "IO Path" 包含的 IO 区域,一定保证寄存器访问顺序与指令顺序相同(即使访问同一 Path 中不同寄存器地址也保所有读 / 写顺序一致)
- 对 SCF & ECF Space 与 SCF & ECF Space Mirror 两区之间访问均不保顺序(即使同线程通过两段访问同一物理寄存器也不保)
- 一个具体 IP 的 IO 区域,若同时存在 SCF 和 ECF 映射,这两区之间不保 consistency(同 IP 的 SCF 与 ECF 映射不一定属于同一 IO Path)
- 无论是否同 sub-thread,IO 访问与 Memory 访问之间不维护 consistency

IO Consistency 例子(Debug 中发现):

- Scorpio 上 SIP 对本地 SDTE 配置时,期间混用本地 SCF 映射的寄存器地址与 ECF 上映射的寄存器地址,两种映射的地址之间无法自然保序而出错——编程时避免一次功能操作中地址混用
- Scorpio 上先进行 ECF 访问,再配置 mailbox,最后 wait 这个 mailbox。结果 mailbox 配置指令由于 ECF 访问积累在 store buffer 后发射,Wait 指令先执行,出错。这其实是对 mailbox 这外设的 RAW hazard,但写是 ST 读是 CTRL,流水线无法识别两者依赖。**这种情况需编程者显示在 wait 前插入 Fence L1_IO(或 Libra 上 Fence L1_IO_WR)强制保序**

### 4.6 RBMMU Consistency(§6.2.3.4)

- Inst RBMMU 在 sub-thread 发射时硬件自动配置,sub-thread 发射后不可修改
- Parameter RBMMU 与 Stack Local RBMMU 为 SPR,每线程发射后自行配置
- Data Buffer RBMMU 为 CSR,由驱动在整个 Cluster 初始化时配置,也可动态配置

Parameter RBMMU 与 Stack Remote RBMMU 修改建议流程:正常指令访问 → `Fence L1_MEM`(保证对没有 L1 的访存) → `MOVSR2SPR` 修改 RBMMU → load/store 访问 L3 地址范围。

Data Buffer Mask(P2 Feature):默认关闭。打开时修改必须确保本 SIP 所有 sub-thread 的 DSM 访问全部结束(L2 fence),然后才能由 1 个 sub-thread 或外部 master 修改;修改完成后确保写透才能发出新访问请求。

### 4.7 RO/WO Hint(§6.2.3.5)

64bit 地址指针 bit59 与 bit60 同时为 1 时,表示 RO/WO 属性:

- 同时设置时,SIP4.0 对访问的 memory 地址去除 RAW / WAR hazard 检查以提高带宽
- 对 GEMM 运算有利,尤其访问 Private VDMEM 与 DSM affinity local(这两区都是 L1 fence)
- 对其他区域(L3 / DSM non-affinity)目前无性能改善,但软件依然可使用此 hint
- 该属性依然保持 WAW hazard 检查与保序操作
- 对同一地址,带此属性与不带此属性的写之间不维护 WAW
- 对 VDMEM mirror 空间的访问相当于该地址自带 RO/WO 属性,效果同上

| Address Bit | Hint For SW | Comment |
| --- | --- | --- |
| Bit 59 | ReadOnly or WriteOnly | 由编译器决定;需要和 bit60 同时为 1 时影响硬件行为(停 RAW / WAR);SIP4.0 中作用于 Private VDMEM / DSM.affinity local |
| Bit 60 | Restrict | 同上 |

## 5. Memory Access Instruction(§6.2.4)

### 5.1 Scalar Normal LD/ST(§6.2.4.1.1)

| 指令 | 寻址 | 可访问空间 | 说明 |
| --- | --- | --- | --- |
| LD | SR base + Imm-12 offset | 所有数据空间 + SCF & ECF Space(不支持 Mirror) | 读数据符号扩展到 32bit,高 32bit 保持 0 |
| ST | SR base + Imm-12 offset | 所有数据空间 + 所有 IO 空间 | |
| LDX | SR base + Imm-12 offset | 同 LD | 读数据符号扩展到 64bit |
| LDRS | SPR base + SR offset | 同 LD | 读数据符号扩展到 64bit;可提升性能 |
| TLD | SR base + Imm-12 offset | 所有数据空间 | 固定 8B 数据,写回 TAR |
| TST | SR base + Imm-12 offset | 所有数据空间 | 固定 8B 数据,读取 TAR |

特点:

- CLW / CSW / CLD / CSD 不能访问所有 SR,只能用 SR8~SR15
- LD / ST / LDX 带 flush 域,设置 flush 会在指令执行前后都带 fence all 语义
- TLD / TST 是对 TAR 寄存器 spill 的指令,固定 8B

### 5.2 Vector Linear LD/ST(§6.2.4.1.2)

| 指令 | 寻址 | Max | 对齐 | Slot |
| --- | --- | --- | --- | --- |
| VLDOA | SR base | 512B | Element 或 OA | L/M |
| VSTOA | SR base | 512B | 同上 | V |
| TVLDOA | TAR base / TAR base post-inc | 512B | 同上 | L/M |
| TVSTOA | TAR base / TAR base post-inc | 512B | 同上 | V |
| TVLDOA.reg | TAR base + TAR offset | 512B | 同上 | L/M |
| TVSTOA.reg | TAR base + TAR offset | 512B | 同上 | V |
| TVSTOA_EXT | TAR base | 512B | 同上 | V |
| TVSTOA_EXT.reg | TAR base + TAR offset | 512B | 同上 | V |

可访问空间(全部):Parameter & Stack Space / Private VDMEM & Shared Data Space / Global Space。特性:

- 仅支持 OACC 颗粒度
- SR-base VLD/VST:支持 element-wise 地址对齐;兼容模式支持双 VPT,非兼容模式只支持单 VPT;支持动态形状 VL 与 maskbit
- TAR-base TVLD/TVST:放宽 TAR 分组,可使用任意 TAR;支持 element-wise 对齐,可能触发 unalign exception
- 详见 §5.8 EXCP_ADDR_UNALIGN / EXCP_ADDR_INVALID

### 5.3 Vector Stride / Scatter-Gather LD/ST(§6.2.4.1.3)

| 指令 | 寻址 | Max | 对齐 | Slot |
| --- | --- | --- | --- | --- |
| VLDEOA | SR base + SR offset | 512B | Element 或 OA | M |
| VSTEOA | SR base + SR offset | 512B | 同上 | M |
| MLI_VLDXOA | SR base + 64bit VACC offset | 512B | 同上 | MLI |
| MLI_VSTXOA | SR base + 64bit VACC offset | 512B | 同上 | MLI |
| MLI_VLDXI32OA | SR base + 32bit VACC offset | 512B | 同上 | MLI |
| MLI_VSTXI32OA | SR base + 32bit VACC offset | 512B | 同上 | MLI |
| MRADIX_STXOA | SR base + 32bit VACC offset | 512B | 同上 | M |

可访问空间:Private VDMEM & Shared Data Space / Global Space(不能跨区域访问)。特性:

- 都支持 OACC 数据语义、maskbit、动态形状 VL
- 不能访问 parameter 与 stack 空间(主要访问形式应是 scalar 与 linear,无 stride / gather-scatter 需求)
- 访问 Shared Affinity Space 时不能跨越其中 local 与 remote 边界(要么全部元素落在本地 SIP VDMEM,要么全部落在同 SIC 远端的一个或多个 VDMEM)
- 可访问区域:Private VDMEM / Private VDMEM mirror / Shared Affinity Buffer Local & Remote / Shared Non-Affinity Buffer / Global Space

### 5.4 AMO(§6.2.4.1.4)

标量 12 条:`AMO.{CAS, EXCH, ADD, AND, OR, XOR, MAX, MAXNUM, MIN, MINNUM, INC, DEC}`,寻址 SR base,可访问 Global Space;CAS / EXCH 总是写回,其余两种皆有(可写回也可不写回)。

向量 3 条:`REDV.{ADD, MAX, MAXNUM}`,linear addr,寻址 SR base,可访问 Global Space,总是不写回。

特性:

- 标量 AMO 用于 reduce 算子或同步操作;向量 AMO 总是用于 Tensor 颗粒度 reduce(不能支持 scatter-gather reduce 场景如 radix 排序)
- 部分标量 AMO 可不要求数据写回寄存器(通过伪指令);用于 reduce 算子,获得性能提升
- 向量 AMO 支持动态形状(VL 寄存器)与 maskbit
- 向量 AMO 只支持单 VPT 模式;双 VPT 报告 exception

数据格式表见 §6.1 Atomic data type(覆盖 INT8/UINT8/INT16/UINT16/INT32/UINT32/INT64/UINT64/FP8/FP16/BF16/TF16/FP32/TF32/FP64;Libra SIP AMO 不支持 INT8/UINT8/FP8/TF16/TF32/FP64)。

约束(场景 → 动作 → 原因):

- **AMO 系列只能访问 Global Memory 地址,且不能访问 DSM 地址**——L1 memory 不支持 atomic 语义,L3 atomic 实际是在 LLC 相关单元上完成运算;AMO 落到 L1 区域会触发 exception
- L1 memory 范围:Private VDMEM / Private SDMEM / Shared Data Buffer / Parameter / Stack

### 5.5 Matrix LD/ST(§6.2.4.1.5)

基于矩阵变量的 Load/Store 均为 Middle Level Instruction(MLI),共同特性:

- 流水线中拆解为数十至数百条 LLI Load/Store 指令(GEMM 系列还会拆出一些 LLI 计算指令)
- 读 / 写操作对象为矩阵变量
- 支持动态形状(专用 SPR 定义矩阵在 memory 中的排列形式与实际尺寸;形状 0 视为 NOP)
- 只能工作在单 VPT(双 VPT 触发 exception)

| 指令 | 寻址 | 可访问空间 | 说明 |
| --- | --- | --- | --- |
| MLI_MLD | SR base + SPR stride | Private VDMEM & Shared Data Space / Global Space(不能跨区域) | 读数据符号扩展到 32bit,高 32bit 保持 0 |
| MLI_TMLD | SR base + SPR stride | 同上 | |
| MLI_MST | SR base + SPR stride | 同上 | 读数据符号扩展到 64bit |
| MLI_TMST | SR base + SPR stride | 同上 | 固定 8B,写回 TAR |
| MLI_GEMM | SR base + SPR stride | 同上 | 固定 8B,读取 TAR |
| MLI_GEMM_LVA | SR base + SPR stride | 同上 | 固定 4B,C-slot 弹栈;高 32bit 保 0 |
| MLI_GEMM_RVA | SR base + SPR stride | 同上 | 固定 4B,C-slot 压栈 |
| MLI_GEMM_SPS | SR base + SPR stride | 同上 | 固定 8B,C-slot 弹栈 |

### 5.6 Special LD/ST(§6.2.4.1.6)

支持三条特殊指令:DPREFETCH / DCACHE_MTN / MLI_HINT。

DPREFETCH 是 SIP 对 LLC 的预取指令。语义上是相对特殊的单字节 scalar store——向特定地址对应 Cache line 发射 SR[Rs1] 末尾 byte 的写,但通过 AXI 全 0 strobe 使其并不真正写入数据,只迫使 Cache line 进行一次 miss fetch(SIP4.0 不支持实体 L1C/L2C,只有 LLC)。特点:

- 使用 SR 的 48bit 虚地址
- 在指向有效地址时,该指令和其他 Load/Store 指令都不检查 RAW/WAW/WAR(包括之前的 DPREFETCH)
- 对 SIP 外部 Cache 与 Memory 访问时,写数据控制 bit(write strobe)为全 0,预期总线返回 write response
- 软件可在指令域 replace 位域上增加 hint 描述修改 cache replace priority,通过 AXUSER 传递给 LLC
- 访问 Global 之外地址会触发 unalign address exception(详见 §5.8.2);AXI response error 触发 EXCP_DF_STORE_ERR

DCACHE_MTN 是对 LLC Cache 的特殊操作。语义上是 8 字节 scalar store——向特定地址对应 Cache line 发射 SR[Rs1] 中 64bit 数据的写,但通过 axusr[30] bit 指示是 DCache 维护指令,迫使 LLC 单元根据写入数据进行特殊操作。特点:

- 使用 SR 的 48bit 虚地址
- 有效地址时该指令需要和其他 Load/Store(不包括 DPREFETCH)检查 RAW/WAW/WAR
- 地址必须 128B 对齐
- 对 SIP 外部 Cache 与 Memory 访问时,write strobe 与正常 8 Byte store 相同,预期总线返回 write response
- 访问 Global 之外地址触发 unalign exception;AXI response error 触发 EXCP_DF_STORE_ERR
- 对 Cache 的操作由 8B 数据给定,详见 LLC Spec

MLI_HINT 是 MLI load/store 的辅助指令,只对同一指令包中 load/store 起作用(包括 MLI_GEMM 系列):

- MLI_HINT 只和 MLI 的 load/store 打包(无 load/store 语义则不起 HINT 作用);MLI_HINT_GEMM 与 GEMM 系列打包
- 一起打包的 load/store 不访问 global space → 该指令视为 NOP
- 一起打包的访问 global space → 通过这两个指令传递 AXI 上的 load prefetch / load priority / store miss allocation / store priority 信息

### 5.7 Main Package Rule(§6.2.4.2)

- MLI 的 load/store 只能和 C-slot 的 MLI_HINT 单独打包(包括 CISC 语义的 GEMM 系列;MLI_HINT 可支持 cache hint 语义)
- **一个指令包中,最多包含一个 VACC load 与一个 VACC store**;VACC load 常见于 L-slot 与 M-slot,VACC store 常见于 V-slot
- 一个指令包中最多 1 个 scalar load 或 store

主要打包情况:

- C-slot 的 MLI_HINT + MLI 的 load/store(MLI_MLD/MLI_MST 系列、MLI_VLDXOA/MLI_VSTXOA 系列、MLI_GEMM 系列)
- Scatter-Gather 与 Stride 地址指令只和 scalar LD/ST 打包,不和 Linear 地址 vector LD/ST 打包
- C-slot 的 DCACHE_MTN + L-slot OACC load + M-slot OACC 1D 运算 + V-slot OACC store

允许但有性能损失的组合(场景 → 动作 → 原因:连续指令包同时出现标量与向量 LD/ST 且都访问 Parameter & Stack → 引入流水线 bubble → SDMEM 访问通路被竞争)。

### 5.8 LD/ST Exception(§6.2.4.3)

异常类型:address unalign / address invalid / mixed address attributes / memory parity error / Load error / Store error。如果单个指令包多重 exception,允许流水线一次只报告其中之一,其余丢弃。

#### 5.8.1 EXCP_ADDR_UNALIGN(根据 FCR 被放弃)

地址未对齐时,SIP4.0 流水线会将地址向下取整到对齐再发射,编程者需注意。

不同区域的对齐要求:

- Scalar 指令:元素宽度对齐
- Linear Address Vector 指令:
  - 对 vector memory(Private VDMEM / Private VDMEM mirror / Shared Data Space / Global Space)需元素宽度对齐;带格式转换语义的 Store(MLI_MST / MLI_TMST / TVSTOA_EXT / TVSTOA_EXT.REG)以转换后的元素作为对齐单位
  - 对 scalar memory(Private SDMEM / Parameter buffer / Stack Local & Stack Remote)要求和指令最大宽度对齐(例如 VLDOA 需 512B 对齐)
- Scatter-Gather / Strided Vector / MLI_MLD / MLI_MST / GEMM 系列:对 vector memory 需元素宽度对齐;不能访问 scalar 类型 memory

#### 5.8.2 EXCP_ADDR_INVALID(根据 FCR 功能被简化)

load/store 访问无效地址(如 Reserved 空间)。对 scalar 与 vector atomic 指令,访问 L3 之外地址区域也归入这种 exception。异常行为:

- Scalar load/store / linear vector & matrix load/store / atomic 指令:整个指令视为无效;linear store 中部分地址在有效范围则正常写入;linear/matrix store 数据不写入 memory
- Stride / gather load:只要一个元素无效则整个指令无效;部分数据可能返回正常值(scatter-gather 无法一拍完成所致)
- Stride / scatter store:一个元素无效则整个指令无效;部分数据可能正常写入

Caution——SIP 检测简化:

- 一部分指令地址有效性基于精确地址检查:
  - 除 LDRS 之外的 scalar load/store
  - 使用 TAR_base 线性地址 vector load/store(不包括 MLI_TMLD / MLI_TMST):TVLDOA / TVSTOA / TVLDOA.reg / TVSTOA.reg / TVSTOA_EXT / TVSTOA_EXT.reg
- 另一部分基于 Base 地址检查:
  - LDRS 用 SPR base 检查
  - 所有基于 SR base 的线性地址 vector load/store
  - 所有 Scatter-Gather / Strided 地址 vector load/store(MLI_VLDXOA / MLI_VSTXOA / MLI_VLDXI32OA / MLI_VSTXI32OA)
  - MLI_MLD / MLI_MST / MLI_TMLD / MLI_TMST / GEMM 系列

Base 检测引入情况:

- Base 无效但 Base+Offset 有效 → 仍报 EXCP_ADDR_INVALID(fault positive)
- 对 maskbit vector 指令,Base 无效但 maskbit 屏蔽掉无效部分,仍报 EXCP_ADDR_INVALID
- Base 有效但 Base+Offset 无效 → 不报 EXCP_ADDR_INVALID,**结果不可知**
  - 例:MLI_VLDXOA Base 指 DSM,Base+offset 指向 DSM 与 Global 之间的 Reserved → 不报但数据不正确(fault negative)
  - linear vector 尾部超过有效地址,只要 Base 部分仍有效就不报
- **Base 是 A 空间有效地址而 Base+Offset 是 B 空间有效地址 → 不报,结果不可知**——流水线把指令访问发到错误路径,返回接口不可预知,可能导致系统 Hang

编程建议:

- Base 类指令 Base 必须指向有效地址空间
- Base 类指令 Base 地址必须为所有元素都在的地址空间中
- 使用者保证一个指令访问的所有元素都在同一地址空间中(由于 EXCP_ADDR_MIX_ATTR 被放弃,SIP 自身无法检测这种情况)

#### 5.8.3 EXCP_MIX_ATTR(根据 FCR 被放弃)

#### 5.8.4 BUS Exception

Load/Store 访问 IO 或 Memory,出现 AXI 总线 response error(非 RAS Error)触发:`EXCP_CF_RESP_ERR / EXCP_DF_RESP_ERR`。异常行为:

- Scalar load / linear vector & matrix load:整个指令无效(linear vector / matrix load 不发起总线请求)
- Stride / gather load:一个元素无效则整个指令无效;部分数据可能正常返回
- Scalar / linear store:整个指令无效,结果可能写回 memory
- Scatter store:一个元素无效则整个指令无效,部分或所有数据可能写回 memory

### 5.9 Fence(§6.2.4.4)

**Fence 只对所在 sub-thread 有效,并不对其他 sub-thread 有效**——多 sub-thread 在同一 SIP 上 fence 需用 HW Sync。

| 指令 | 说明 |
| --- | --- |
| `MOVS.Barrier ALL` | Fence 所有指令 |
| `MOVS.Barrier L0` | Fence 所有对 L0 寄存器的写;对 Store(L0 读),L0 Fence 只覆盖发送到总线上的过程 |
| `MOVS.Barrier L1_SDMEM[_RD/_WR]` | Fence 访问 private SDMEM / Stack Local / Parameter buffer 的指令 |
| `MOVS.Barrier L1_VDMEM[_RD/_WR]` | Fence 访问 private VDMEM / DSM.affinity.local 的指令 |
| `MOVS.Barrier L1_MEM[_RD/_WR]` | Fence 访问 L1_SDMEM 区 + L1_VDMEM 区的指令 |
| `MOVS.Barrier L2_MEM[_RD/_WR]` | Fence 访问 DSM.affnity.remote 与 DSM.non-affinity 的访存指令 |
| `MOVS.Barrier L3_MEM[_RD/_WR]` | Fence 访问 Stack Remote / Global memory 的访存指令 |
| `MOVS.Barrier L1_IO[_RD/_WR]` | Fence 访问 local CSR 与集成 IP 寄存器的指令 |
| `MOVS.Barrier L2L3_IO[_RD/_WR]` | Fence 访问 ECF 的指令 |

完成语义:

- load:数据回写目标寄存器
- store 访问 L1:数据写入 memory 单元
- store 访问 L3 / IO:AXI 总线回复对应响应
- Stack 访问命中 stack.local 属 L1 区域;命中 stack.remote 属 global 区域

## 6. AXI Interface Fields / Data Fabric Port / IO Path

AXI AxUser / R_user / W_user / B_user / AxCache / AxPROT / AxLock / AxQos 字段、SIP Data Fabric Port(DF0~DF2 master/slave)、IO Path 与 64 个 AXI ID 分配等内容属 SoC 集成层,本文不展开;算子相关结论已在前述章节落点:

- AMO 仲裁路径与数据格式编码:见 §5.4 Atomic Memory Operation 段(本文);
- IO 写后等待 mailbox 时插 `Fence L1_IO_WR` 强制保序的硬件根因:见 §4.5 IO Consistency 与 §2.5 SCF & ECF Mirror;
- Mirror 段 IO 写不会越过前序 GEMM 读、写 mailbox 不需 fence:见 §2.5 SCF & ECF Mirror。
