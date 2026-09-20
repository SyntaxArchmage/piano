> Imported material source: `Doc/Libra SIP CSR SPEC.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `Libra SIP CSR SPEC`.

# Libra SIP CSR SPEC

本文档由 `Libra SIP CSR SPEC.pdf` 转换整理而来，保留原文的章节、寄存器表、字段说明、图片与主要版式结构，并清理 PDF 导出产生的版式噪声。

## 1. Revision History

|Version|Date|Note|
|---|---|---|
|v0.1|2027/07/01|创建初始版本|

## 2. Open & Dropped Item

### 2.1. Open Item

N/A

### 2.2. Dropped Item

**下面寄存器被放弃：**

- L1_DSM_MASK_CFG

该寄存器功能被XPU下的XPU_SCRATCH0替代

- AWP相关的寄存器，由于Address Watchpoint功能被放弃，因此寄存器也被放弃

   - AWP0_PLC_ADDR_LO

   - AWP0_PLC_ADDR_HI

   - AWP0_PLC_MASK

   - AWP0_PLC_CTRL

   - AWP1_PLC_ADDR_LO

   - AWP1_PLC_ADDR_HI

   - AWP1_PLC_MASK

   - AWP1_PLC_CTRL

   - AWP0_L1_ADDR_LO

   - AWP0_L1_ADDR_HI

   - AWP0_L1_MASK

   - AWP0_L1_CTRL

   - AWP1_L1_ADDR_LO

   - AWP1_L1_ADDR_HI

   - AWP1_L1_MASK

   - AWP1_L1_CTRL

- L1_SIP_ID

   - 本寄存器不再被使用

- L1_ELCG_CTRL

   - 本寄存器不再被使用

- THD0_CTH_DST~THD15_CTH_DST

   - 这些寄存器不再被使用

- PMU_CUR_PWR

   - 本寄存器不再被使用

- CLK_CTL的下列域被放弃

   - XPU_SW_CLK_EN

   - XPU_BLCG_DISABLE

- THD10_CTH_MSG_DAT~THD15_CTH_CFG的连续24个寄存器

   - 本寄存器不再被使用

- THD10_RPC_SEND_MSG_LO~THD15_RPC_RCV_MSG_HI的连续48个寄存器

   - 本寄存器不再被使用

### 2.3. P2 Item

XPU_SCRATCH1

## 3. Glossary

|Name|Description|Comment|
|---|---|---|
|CSR|Control & Status Register|在SIP中属于IO寄存器，而非指令直接访问寄存器<br>这一点和RISC-V的CSR概念不同。后者类同于SIP的<br>SPR寄存器|
|SW-Thread|Software thread, A.K.A<br>software context|即软件线程。每个软件线程有一个PC和独立的上下文。<br>为了和Arch Spec统一，本文档使用SW-Thread的专用英文缩写|
|HW-Thread|hardware thread, A.K.A<br>hardware context|即硬件线程。每个硬件线程上有独立的取指和访存单元，可以执行一个或者多个软件线程。<br>为了和Arch Spec统一，本文档使用HW-Thread的专用英文缩写|

## 4. Reference Link

**Libra SIP ISA**

Libra SPR REG SPEC

Libra SIP Arch SPEC

## 5. Overview

本文档用于描述Libra SIP相关的CSR寄存器。在Scorpio SIP中CSR寄存器的描述被放在Arch Spec中。而在SIP4.0中，由于CSR寄存器和Kernel Launch、Exception等架构内容关系更加紧密，而指令集的关系相对松耦合，出于便于阅读的目的编写为Libra SIP Arch SPEC的附属文档，和SIP Arch Spec同步进行 review和发布。

CSR是Control & Status Register的缩写。这类寄存器在Libra SIP中有如下特点：

- 所有寄存器位宽都是32bit

- 只能使用LD/ST/LDX指令访问，并且颗粒度必须为4Byte，地址为4Byte对齐

   - 其他颗粒度访问和地址不对齐访问结果不可预测

- 地址集中在4GB~5GB范围内

   - 这个区域包含了两个die上所有可以访问的IO空间

   - 其中这个地址起始的32KB为单个SIP内的寄存器地址（SCF），32MB~1GB的范围为整个系统的寄存器区域（ECF）

   - 32KB中包含了SIP流水线的CSR寄存器和其他外部设备寄存器，比如SA/HwSync

- 所有的CSR寄存器被所有软件线程可见

   - 考虑到部分物理寄存器实体复用相同地址（比如WRK系列），会对CSR的访问加以约束

- 部分寄存器和SPR寄存器在实际上重合

相比于Scorpio SIP，Libra SIP中的CSR寄存器有如下变化：

- 由于单个SIP内只有一个硬件线程，因此不再有两个CTX的设计，取而代之的是两个Launch通道包括CFG系列和NXT系列

- 部分WRK系列寄存器是per-Kernel存在的，为了节约地址空间进行了复用

   - 从MODE_WRK到PARAM_WRK

   - 使用 WRK_KNL_THD_SEL寄存器的KNL_SEL域，将4组per-Kernel寄存器，显示到WRK寄存器地址上

部分WRK系列寄存器是per-thread存在的，为了节约地址空间进行了复用

   - 从SUB_THD_ID_WRK到AUX_PC

   - 使用 WRK_KNL_THD_SEL寄存器的THD_SEL域，将16组per-thread寄存器，显示到WRK寄存器地址上

- 对于WRK系列寄存器的访问存在使用约束，不希望SW-thread访问，而是希望debugger访问删除了RNG相关的CSR

   - RNG转为指令实现

- 为了配合物理设计，将ralf分为以下几个

CSR Launch

- 该ralf的生成结果也要放到XPU中，并且例化2份

CSR XPU

CSR IMEM

CSR L1

CSR Common

- 在CSR L1区域增加L1_SIP_ID和ELCG_CTRL寄存器，用于支持OAM Harvest

- 在CSR XPU/CSR IMEM中添加SRAMCTRL系列寄存器，对更多的RAM支持RAS属性

- 在CSR IMEM/CSR L1中，添加对DF Bus ECC的支持寄存器

- RPC系列寄存器扩展为16份

- 增加了CTH系列寄存器

- 简化了PMU的寄存器支持

SIP的XPU/ICache/L1/common CSR Register按照以下方式划分逻辑组Grouping

|Register<br>Group|Address|Config-by-Who|RALF File|Comment|
|---|---|---|---|---|
|Launch-<br>Config|0x000-<br>0x0FF<br>0x200-<br>0x2FF|SP|CSR<br>Launch<br>例化两次|SIP launch寄存器，由<br>AMOS配置|
|Launch-<br>Next|0x100-<br>0x1FF<br>0x300-<br>0x3FF|Read Only|CSR<br>Launch<br>例化两次|SIP launch queue pop<br>寄存器|
|APP|0x400-<br>0x5FF|SP|CSR XPU|SIP运行时参数寄存器|
|Mailbox|0x600-<br>0x6FF|SIPs/DTE/SP/etc|CSR XPU||
|Thread-<br>Status|0x700-<br>0x7FF|AMOS/Debugger|CSR XPU|SIP运行时状态寄存器|
|HW-Debug|0x800-<br>0x8FF|Debugger|CSR XPU|HW debugger寄存器<br>用于支持debug tool|
|Boot-XPU|0x900-<br>0xCFF|Driver/Profiler|CSR XPU|整个系统初始化时Driver<br>配置寄存器<br>禁止AMOS或者Kernel<br>配置这组寄存器|
|Boot-IMEM|0xD00-<br>0xDFF|Driver|CSR IMEM|整个系统初始化时Driver<br>配置寄存器<br>禁止AMOS或者Kernel<br>配置这组寄存器|
|Boot-L1|0xE00-<br>0xEFF|Driver|CSR L1|整个系统初始化时Driver<br>配置寄存器<br>禁止AMOS或者Kernel<br>配置这组寄存器|

|Register<br>Group|Address|Config-by-Who|RALF File|Comment|
|---|---|---|---|---|
|RPC-CFG|0xF00-<br>0x10FF|Kernel/RPC-<br>Server|CSR<br>Common||
|CTH-CFG|0x1100-<br>0x11FF|SIP code|CSR<br>Common||
|PMU-CFG|0x1200-<br>0x12FF|SSM/SIP code|CSR<br>Common|PMU控制寄存器，预期<br>由SSM配置|
|OBS-CFG|0x1300-<br>0x13FF|Debugger|CSR<br>Common||

其中0x0~0x1FF和0x200~0x3FF部分为per launch queue的寄存器，在Libra SIP中例化了两次；后面均例化一次

Note: CSR寄存器中，所有没有被声明的bit域，其默认读取数值为0.

## 6. CSR Common Feature

### 6.1. CSR Register Rename

由于历史因素，在SIP2.0/SIP3.0上的CSR部分寄存器名称不符合其用途，容易导致困惑，在SIP4.0的寄存器定义中进行名称更正

- INTBA_CFG/INTBA_NXT/INTBA_WRK -> LCHBA_CFG/LCHBA_NXT/LCHBA_WRK

   - 这里的INT不是指interrupt，而是指Kernel launch。最初在Leo SIP中，将Kernel launch定义为中断触发，但是这个概念逐渐淡化。Libra SIP中将“INT”缩写修改为"LCH"

   - LCHBA_*(LCHBA_*)指的是这个kernel启动时第一条指令的PC

- INTTRIG -> LCHTRIG

   - LCHTRIG(INTTRIG)指启动kernel的寄存器。在SIP3.0/SIP4.0中转换为将配置的寄存器参数 push到launch queue的语义。

EXCP_TRAP -> EXCP_BIT_EN

   - 该寄存器实际上应该起到对每一个exception种类进行使能的作用，因此修改为“bit enable”的缩写。

- EXCP_MASK -> EXCP_STS_GLB

   - 该寄存器实际上是exception global status寄存器，当其为"1"时指示当前处于exception handler当中，并禁止触发下一个exception。故此改名

### 6.2. CSR Address Formula

在SIP4.0 Arch Spec中的Memory Address Mapping章节所给出的CSR寄存器地址映射，是从本SIP的 LD/ST指令视角来看待的。但是如果从不同地址来访问CSR寄存器，地址的计算会不一样。下面分场景解释地址方法

每一个SIP上的CSR寄存器，都有两个视角共四个虚拟地址可以访问

   - 一个是本地视角的地址，所有SIP均使用相同的地址访问本地寄存器。该视角又分为两个地址区间

      - 其一是4GB~4GB+32KB的地址区域

      - 其二是6GB~6GB+32KB的地址区域。该区域预期是和GEMM指令进行同步语义的配合， 只支持写操作

   - 另一个是ECF视角下的地址，每个SIP实体的寄存器地址均不重叠。该视角也分为两个地址区间其一是4GB+32MB之后地址区域

      - 其二是6GB+32MB之后地址区域。该区域预期是和GEMM指令进行同步语义的配合，只支持写操作

   - 注意，对这两个视角下4个区域的地址，即使映射的是同一个寄存器实体，但是它们之间访问是无法保序的

- SIP LD/ST指令访问本地CSR/SA/HwSync等寄存器的地址

   - 地址一：address = 0x1_0000_0000 + register_offset

   - 地址二：address = 0x1_8000_0000 + register_offset

   - 例如，如果访问APP1寄存器，那么LD/ST指令可以配置的地址是 0x1_0000_0000+0x404 = 0x1_0000_0404

SIP LD/ST指令访问ECF上其他SIP的寄存器

- 地址一：address = 0x1_0000_0000 + dev_offset + register_offset

- 地址二：address = 0x1_8000_0000 + dev_offset + register_offset

- 例如，如果访问SIC0上SIP4的APP1寄存器，那么LD/ST指令可以配置的地址是

   - 0x1_0000_0000 + 0x0202_0000 + 0x404 = 0x1_0202_0404

![CSR ECF地址映射示意图](libra_sip_csr_spec__figure_001.png)

对于非SIP的其他master，例如CDTE/HW Sync，则它们看到的整个ECF地址段，并非从4GB开始。 那么它们的基地址需要做相应调整，然后按照加上dev_offset 和 register_offset方式来访问某个特定SIP中的某个CSR寄存器

关于ECF的地址mapping，请见Libra AXI ID Map文档

### 6.3. CSR Per-Kernel-Slot & Per-Sub-Thread-Slot

在和Thread密切相关的working寄存器中，部分寄存器物理实体和Kernel-slot一样多(4组)，另一部分和 Sub-thread-slot一样多(16组)。这些寄存器复用了相同的地址。这两类寄存器分别如下：

Per-Kernel-Slot包括

   - Offset：0x704 IMEM_BASE_LO_WRK ~ 0x7A8 PARAM_WRK

- 这组CSR寄存器地址映射到那组实体，由WRK_KNL_THD_SEL寄存器的KNL_SEL域选择

- Per-Sub-Thread-Slot包括

   - Offset：0x700 MODE_WRK

   - Offset：0x7AC SUB_THD_ID_WRK ~ 0x7D4 AUX_PC

   - 这组CSR寄存器地址映射到那组实体，由WRK_KNL_THD_SEL寄存器的THD_SEL域选择

## 7. Control Status Register List: Per-Launch Queue

|Address|Register Name|Default|
|---|---|---|
|0x0|MODE_CFG|0x3f00|
|0x4|IMEM_BASE_LO_CFG|0x0|
|0x8|IMEM_BASE_HI_CFG|0x0|
|0xC|TRPBA_CFG|0x0|
|0x10|LCHBA_CFG|0x0|
|0x14|LAUNCH_CFG|0x0|
|0x18|PACKAGE_ID_CFG|0x0|
|0x1C|PROCESS_ID_CFG|0x0|
|0x20|MD0_CFG|0x0|
|0x24|MD1_CFG|0x0|
|0x28|MD2_CFG|0x0|
|0x2C|MD3_CFG|0x0|
|0x30|MD4_CFG|0x0|
|0x34|MD5_CFG|0x0|
|0x38|MD6_CFG|0x0|
|0x3C|MD7_CFG|0x0|
|0x40|MD8_CFG|0x0|
|0x44|MD9_CFG|0x0|
|0x48|MD10_CFG|0x0|
|0x4C|MD11_CFG|0x0|
|0x50|MD12_CFG|0x0|
|0x54|MD13_CFG|0x0|
|0x58|MD14_CFG|0x0|
|0x5C|MD15_CFG|0x0|
|0x60|MD16_CFG|0x0|
|0x64|MD17_CFG|0x0|
|0x68|MD18_CFG|0x0|
|0x6C|MD19_CFG|0x0|
|0x70|MD20_CFG|0x0|
|0x74|MD21_CFG|0x0|
|0x78|MD22_CFG|0x0|
|0x7C|MD23_CFG|0x0|
|0x80|MD24_CFG|0x0|
|0x84|MD25_CFG|0x0|
|0x88|MD26_CFG|0x0|
|0x8C|MD27_CFG|0x0|
|0x90|MD28_CFG|0x0|
|0x94|MD29_CFG|0x0|
|0x98|MD30_CFG|0x0|
|0x9C|MD31_CFG|0x0|
|0xA0|ASID_CFG|0x0|
|0xA4|KSID_CFG|0x0|
|0xA8|PARAM_CFG|0x0|
|0xAC|SUB_THD_ID_CFG|0x0|
|0xB0|LCHTRIG|0x0|
|0xB4|CFG_STS|0x4|
|0x100|MODE_NXT|0x3f00|
|0x104|IMEM_BASE_LO_NXT|0x0|
|0x108|IMEM_BASE_HI_NXT|0x0|
|0x10C|TRPBA_NXT|0x0|
|0x110|LCHBA_NXT|0x0|
|0x114|LAUNCH_NXT|0x0|
|0x118|PACKAGE_ID_NXT|0x0|
|0x11C|PROCESS_ID_NXT|0x0|
|0x120|MD0_NXT|0x0|
|0x124|MD1_NXT|0x0|
|0x128|MD2_NXT|0x0|
|0x12C|MD3_NXT|0x0|
|0x130|MD4_NXT|0x0|
|0x134|MD5_NXT|0x0|
|0x138|MD6_NXT|0x0|
|0x13C|MD7_NXT|0x0|
|0x140|MD8_NXT|0x0|
|0x144|MD9_NXT|0x0|
|0x148|MD10_NXT|0x0|
|0x14C|MD11_NXT|0x0|
|0x150|MD12_NXT|0x0|
|0x154|MD13_NXT|0x0|
|0x158|MD14_NXT|0x0|
|0x15C|MD15_NXT|0x0|
|0x160|MD16_NXT|0x0|
|0x164|MD17_NXT|0x0|
|0x168|MD18_NXT|0x0|
|0x16C|MD19_NXT|0x0|
|0x170|MD20_NXT|0x0|
|0x174|MD21_NXT|0x0|
|0x178|MD22_NXT|0x0|
|0x17C|MD23_NXT|0x0|
|0x180|MD24_NXT|0x0|
|0x184|MD25_NXT|0x0|
|0x188|MD26_NXT|0x0|
|0x18C|MD27_NXT|0x0|
|0x190|MD28_NXT|0x0|
|0x194|MD29_NXT|0x0|
|0x198|MD30_NXT|0x0|
|0x19C|MD31_NXT|0x0|
|0x1A0|ASID_NXT|0x0|
|0x1A4|KSID_NXT|0x0|
|0x1A8|PARAM_NXT|0x0|
|0x1AC|SUB_THD_ID_NXT|0x0|
|0x1B0|LCHTRIG_NXT|0x0|
|0x1B4|NXT_POP|0x0|
|0x1B8|STOP_AUTO_LCH|0x0|

## 8. Control Status Register List: XPU

|Address|Register Name|Default|
|---|---|---|
|0x400|APP0|0x0|
|0x404|APP1|0x0|
|0x408|APP2|0x0|
|0x40C|APP3|0x0|
|0x410|APP4|0x0|
|0x414|APP5|0x0|
|0x418|APP6|0x0|
|0x41C|APP7|0x0|
|0x420|APP8|0x0|
|0x424|APP9|0x0|
|0x428|APP10|0x0|
|0x42C|APP11|0x0|
|0x430|APP12|0x0|
|0x434|APP13|0x0|
|0x438|APP14|0x0|
|0x43C|APP15|0x0|
|0x440|APP16|0x0|
|0x444|APP17|0x0|
|0x448|APP18|0x0|
|0x44C|APP19|0x0|
|0x450|APP20|0x0|
|0x454|APP21|0x0|
|0x458|APP22|0x0|
|0x45C|APP23|0x0|
|0x460|APP24|0x0|
|0x464|APP25|0x0|
|0x468|APP26|0x0|
|0x46C|APP27|0x0|
|0x470|APP28|0x0|
|0x474|APP29|0x0|
|0x478|APP30|0x0|
|0x47C|APP31|0x0|
|0x600|MBOX_ID|0x0|
|0x604|MBOX_CONFIG|0x10000|
|0x608|MBOX_GLB_CONFIG|0x0|
|0x60C|MBOX_STATUS_SEL|0x0|
|0x610|MBOX_STATUS_0|0x10000|
|0x614|MBOX_STATUS_1|0x0|
|0x618|MBOX_ERR0_RPT|0x0|
|0x61C|MBOX_ERR0_CODE_0|0x0|
|0x620|MBOX_ERR0_CODE_1|0x0|
|0x624|MBOX_ERR1_RPT|0x0|
|0x628|MBOX_ERR1_CODE_0|0x0|
|0x62C|MBOX_ERR1_CODE_1|0x0|
|0x630|SWR_WAIT_GSYNC0|0x0|
|0x634|SWR_WAIT_GSYNC1|0x0|
|0x638|SWR_WAIT_GSYNC2|0x0|
|0x63C|SWR_WAIT_GSYNC3|0x0|
|0x640|SWR_CFG_GSYNC0|0xffffffff|
|0x644|SWR_CFG_GSYNC1|0xffffffff|
|0x648|SWR_CFG_GSYNC2|0xffffffff|
|0x64C|SWR_CFG_GSYNC3|0xffffffff|
|0x650|MBOX_V128_BIT_EN|0x0|
|0x654|MBOX_V129_BIT_EN|0x0|
|0x658|MBOX_V130_BIT_EN|0x0|
|0x65C|MBOX_V131_BIT_EN|0x0|
|0x660|MBOX_V132_BIT_EN|0x0|
|0x664|MBOX_V133_BIT_EN|0x0|
|0x668|MBOX_V134_BIT_EN|0x0|
|0x66C|MBOX_V135_BIT_EN|0x0|
|0x670|MBOX_V136_BIT_EN|0x0|
|0x674|MBOX_V137_BIT_EN|0x0|
|0x678|MBOX_V138_BIT_EN|0x0|
|0x67C|MBOX_V139_BIT_EN|0x0|
|0x680|MBOX_V140_BIT_EN|0x0|
|0x684|MBOX_V141_BIT_EN|0x0|
|0x688|MBOX_V142_BIT_EN|0x0|
|0x68C|MBOX_V143_BIT_EN|0x0|
|0x690|MBOX_EXTRA_STS|0x0|
|0x6A0|ETA_CTRL0|0x0|
|0x6A4|ETA_CTRL1|0x0|
|0x6A8|ETA_CTRL2|0x0|
|0x6AC|ETA_CTRL3|0x0|
|0x700|MODE_WRK|0x3f00|
|0x704|IMEM_BASE_LO_WRK|0x0|
|0x708|IMEM_BASE_HI_WRK|0x0|
|0x70C|TRPBA_WRK|0x0|
|0x710|LCHBA_WRK|0x0|
|0x714|LAUNCH_WRK|0x0|
|0x718|PACKAGE_ID_WRK|0x0|
|0x71C|PROCESS_ID_WRK|0x0|
|0x720|MD0_WRK|0x0|
|0x724|MD1_WRK|0x0|
|0x728|MD2_WRK|0x0|
|0x72C|MD3_WRK|0x0|
|0x730|MD4_WRK|0x0|
|0x734|MD5_WRK|0x0|
|0x738|MD6_WRK|0x0|
|0x73C|MD7_WRK|0x0|
|0x740|MD8_WRK|0x0|
|0x744|MD9_WRK|0x0|
|0x748|MD10_WRK|0x0|
|0x74C|MD11_WRK|0x0|
|0x750|MD12_WRK|0x0|
|0x754|MD13_WRK|0x0|
|0x758|MD14_WRK|0x0|
|0x75C|MD15_WRK|0x0|
|0x760|MD16_WRK|0x0|
|0x764|MD17_WRK|0x0|
|0x768|MD18_WRK|0x0|
|0x76C|MD19_WRK|0x0|
|0x770|MD20_WRK|0x0|
|0x774|MD21_WRK|0x0|
|0x778|MD22_WRK|0x0|
|0x77C|MD23_WRK|0x0|
|0x780|MD24_WRK|0x0|
|0x784|MD25_WRK|0x0|
|0x788|MD26_WRK|0x0|
|0x78C|MD27_WRK|0x0|
|0x790|MD28_WRK|0x0|
|0x794|MD29_WRK|0x0|
|0x798|MD30_WRK|0x0|
|0x79C|MD31_WRK|0x0|
|0x7A0|ASID_WRK|0x0|
|0x7A4|KSID_WRK|0x0|
|0x7A8|PARAM_WRK|0x0|
|0x7AC|SUB_THD_ID_WRK|0x0|
|0x7B0|PC|0x0|
|0x7B4|HW_STS|0x0|
|0x7B8|EXCP_PC|0x0|
|0x7BC|EXCP_BIT_EN|0x1073f3ff|
|0x7C0|EXCP_STS|0x0|
|0x7C4|EXCP_STS_GLB|0x0|
|0x7C8|EXCP_STS_TH|0x0|
|0x7CC|RAS_REPAIRED_BIT_EN|0x0|
|0x7D0|RAS_REPAIRED_STS|0x0|
|0x7D4|AUX_PC|0x0|
|0x7EC|WRK_KNL_THD_SEL|0x0|
|0x7F0|ALL_THD_STS|0x0|
|0x7F4|KNL_THD_MAP0|0xffff|
|0x7F8|KNL_THD_MAP1|0x0|
|0x800|BRKP0_BASE_LO|0x0|
|0x804|BRKP0_BASE_HI|0x0|
|0x808|BRKP0_PC|0x0|
|0x80C|BRKP0_CTRL|0x0|
|0x810|BRKP1_BASE_LO|0x0|
|0x814|BRKP1_BASE_HI|0x0|
|0x818|BRKP1_PC|0x0|
|0x81C|BRKP1_CTRL|0x0|
|0x820|DBG_BUF0|0x0|
|0x824|DBG_BUF1|0x0|
|0x828|DBG_BUF2|0x0|
|0x82C|DBG_BUF3|0x0|
|0x830|DBG_CMD|0x0|
|0x834|DBG_RDATA0|0x0|
|0x838|DBG_RDATA1|0x0|
|0x840|AWP0_PLC_ADDR_LO|0x0|
|0x844|AWP0_PLC_ADDR_HI|0x0|
|0x848|AWP0_PLC_MASK|0x0|
|0x84C|AWP0_PLC_CTRL|0x0|
|0x850|AWP1_PLC_ADDR_LO|0x0|
|0x854|AWP1_PLC_ADDR_HI|0x0|
|0x858|AWP1_PLC_MASK|0x0|
|0x85C|AWP1_PLC_CTRL|0x0|
|0x880|DBG_MODE_THD0_STS|0x0|
|0x884|DBG_MODE_THD0_PC|0x0|
|0x888|DBG_MODE_THD1_STS|0x0|
|0x88C|DBG_MODE_THD1_PC|0x0|
|0x890|DBG_MODE_THD2_STS|0x0|
|0x894|DBG_MODE_THD2_PC|0x0|
|0x898|DBG_MODE_THD3_STS|0x0|
|0x89C|DBG_MODE_THD3_PC|0x0|
|0x8A0|DBG_MODE_THD4_STS|0x0|
|0x8A4|DBG_MODE_THD4_PC|0x0|
|0x8A8|DBG_MODE_THD5_STS|0x0|
|0x8AC|DBG_MODE_THD5_PC|0x0|
|0x8B0|DBG_MODE_THD6_STS|0x0|
|0x8B4|DBG_MODE_THD6_PC|0x0|
|0x8B8|DBG_MODE_THD7_STS|0x0|
|0x8BC|DBG_MODE_THD7_PC|0x0|
|0x8C0|DBG_MODE_THD8_STS|0x0|
|0x8C4|DBG_MODE_THD8_PC|0x0|
|0x8C8|DBG_MODE_THD9_STS|0x0|
|0x8CC|DBG_MODE_THD9_PC|0x0|
|0x8D0|DBG_MODE_THD10_STS|0x0|
|0x8D4|DBG_MODE_THD10_PC|0x0|
|0x8D8|DBG_MODE_THD11_STS|0x0|
|0x8DC|DBG_MODE_THD11_PC|0x0|
|0x8E0|DBG_MODE_THD12_STS|0x0|
|0x8E4|DBG_MODE_THD12_PC|0x0|
|0x8E8|DBG_MODE_THD13_STS|0x0|
|0x8EC|DBG_MODE_THD13_PC|0x0|
|0x8F0|DBG_MODE_THD14_STS|0x0|
|0x8F4|DBG_MODE_THD14_PC|0x0|
|0x8F8|DBG_MODE_THD15_STS|0x0|
|0x8FC|DBG_MODE_THD15_PC|0x0|
|0x900|SIP_ID|0x0|
|0x904|CLK_CTL|0x2f3f3f|
|0x908|VACC_HASH_MASK0|0x0|
|0x90C|VACC_HASH_MASK1|0x0|
|0x910|VACC_HASH_MASK2|0x0|
|0x914|SDMEM_HASH_MASK0|0x0|
|0x918|SDMEM_HASH_MASK1|0x0|
|0x91C|SDMEM_HASH_MASK2|0x0|
|0x920|SRTAR_HASH_MASK0|0x0|
|0x924|SRTAR_HASH_MASK1|0x0|
|0x928|SRTAR_HASH_MASK2|0x0|
|0x92C|XPU_DSM_BASE|0x4|
|0x930|VASRAM_SRAMCTRL|0x80100000|
|0x934|SDMEM_SRAMCTRL|0x80100000|
|0x938|SRTAR_SRAMCTRL|0x80100000|
|0x93C|IVSMR_SRAMCTRL|0x80100000|
|0x940|S3INST_SRAMCTRL|0x80100000|
|0x944|L0IMEM_SRAMCTRL|0x80100000|
|0x948|XPU_DF2_SLV_RAS_CTRL|0x80000000|
|0x94C|XPU_DF2_SLV_RAS_STS|0x0|
|0x950|XPU_BLCG_CTRL0|0x0|
|0x954|XPU_BLCG_CTRL1|0x0|
|0x958|XPU_BLCG_CTRL2|0x0|
|0x95C|XPU_BLCG_CTRL3|0x0|
|0x970|SIP_MEM_INFO0|0xc000a0|
|0x974|SIP_MEM_INFO1|0x4000180|
|0x978|SCF_PEND_STS|0x7ff|
|0x97C|SCF_AXI_FIELD_CFG|0x0|
|0x980|S2_LL_SCHED_CTRL0|0x0|
|0x984|S2_LL_SCHED_CTRL1|0x0|
|0x988|S2_LL_SCHED_CTRL2|0x0|
|0x98C|S2_STRUC_HZD_ARB0|0x0|
|0x990|S2_STRUC_HZD_ARB1|0x0|
|0x994|S2_STRUC_HZD_ARB2|0x0|
|0x998|S2_STRUC_HZD_ARB3|0x0|
|0x99C|S2_SALU_DIV32_SCHD_CTRL|0x0|
|0x9A0|S2_SALU_DIV64_SCHD_CTRL|0x0|
|0x9A4|S2_LDCF_SRWB_SCHD_CTRL|0x0|
|0x9A8|S2_LDCF_TARWB_SCHD_CTRL|0x0|
|0x9AC|S2_MALU_SRWB_SCHD_CTRL|0x0|
|0x9B0|S2_MALU_TARWB_SCHD_CTRL|0x0|
|0x9C0|S3_SCHD_CTRL|0x0|
|0x9C4|S3_SCHD_FP_TH_EN|0x0|
|0x9C8|S3_SCHD_FP_TH_TOUT|0x0|
|0x9CC|S3_SCHD_FP_TH_CUR_ORDER|0x0|
|0x9D0|XPU_MISC_CTRL0|0x0|
|0x9D4|XPU_MISC_CTRL1|0x0|
|0xA00|SIP_PERF_SEL|0x0|
|0xA04|SIP_PERF_USR|0x0|
|0xA10|XPU_PMC_EVT_CTRL|0x0|
|0xA14|XPU_PMC_EVT0|0x0|
|0xA18|XPU_PMC_EVT1|0x0|
|0xA1C|XPU_PMC_EVT2|0x0|
|0xA20|XPU_PMC_EVT3|0x0|
|0xA24|XPU_PMC_EVT4|0x0|
|0xA28|XPU_PMC_EVT5|0x0|
|0xA2C|XPU_PMC_EVT6|0x0|
|0xA30|XPU_PMC_EVT7|0x0|
|0xA40|XPU_PMC_THREAD_CTRL0|0x0|
|0xA44|XPU_PMC_THREAD_CTRL1|0x0|
|0xA48|XPU_PMC_THREAD_CTRL2|0x0|
|0xA4C|XPU_PMC_THREAD_CTRL3|0x0|
|0xA50|XPU_PMC_THREAD_CTRL4|0x0|
|0xA54|XPU_PMC_THREAD_CTRL5|0x0|
|0xA58|XPU_PMC_THREAD_CTRL6|0x0|
|0xA5C|XPU_PMC_THREAD_CTRL7|0x0|
|0xA60|XPU_PMC_THREAD_CTRL8|0x0|
|0xA64|XPU_PMC_THREAD_CTRL9|0x0|
|0xA68|XPU_PMC_THREAD_CTRL10|0x0|
|0xA6C|XPU_PMC_THREAD_CTRL11|0x0|
|0xA70|XPU_PMC_THREAD_CTRL12|0x0|
|0xA74|XPU_PMC_THREAD_CTRL13|0x0|
|0xA78|XPU_PMC_THREAD_CTRL14|0x0|
|0xA7C|XPU_PMC_THREAD_CTRL15|0x0|
|0xA80|XPU_PMC_THREAD_EVENT0|0x0|
|0xA84|XPU_PMC_THREAD_EVENT1|0x0|
|0xA88|XPU_PMC_THREAD_EVENT2|0x0|
|0xA8C|XPU_PMC_THREAD_EVENT3|0x0|
|0xA90|XPU_PMC_THREAD_EVENT4|0x0|
|0xA94|XPU_PMC_THREAD_EVENT5|0x0|
|0xA98|XPU_PMC_THREAD_EVENT6|0x0|
|0xA9C|XPU_PMC_THREAD_EVENT7|0x0|
|0xAA0|XPU_PMC_THREAD_EVENT8|0x0|
|0xAA4|XPU_PMC_THREAD_EVENT9|0x0|
|0xAA8|XPU_PMC_THREAD_EVENT10|0x0|
|0xAAC|XPU_PMC_THREAD_EVENT11|0x0|
|0xAB0|XPU_PMC_THREAD_EVENT12|0x0|
|0xAB4|XPU_PMC_THREAD_EVENT13|0x0|
|0xAB8|XPU_PMC_THREAD_EVENT14|0x0|
|0xABC|XPU_PMC_THREAD_EVENT15|0x0|
|0xB00|XPU_SCRATCH0|0x0|
|0xB04|XPU_SCRATCH1|0x0|
|0xB08|XPU_SCRATCH2|0x0|
|0xB0C|XPU_SCRATCH3|0x0|
|0xB10|XPU_SCRATCH4|0x0|
|0xB14|XPU_SCRATCH5|0x0|
|0xB18|XPU_SCRATCH6|0x0|
|0xB1C|XPU_SCRATCH7|0x0|
|0xB20|XPU_SCRATCH8|0x0|
|0xB24|XPU_SCRATCH9|0x0|
|0xB28|XPU_SCRATCH10|0x0|
|0xB2C|XPU_SCRATCH11|0x0|
|0xB30|XPU_SCRATCH12|0x0|
|0xB34|XPU_SCRATCH13|0x0|
|0xB38|XPU_SCRATCH14|0x0|
|0xB3C|XPU_SCRATCH15|0x0|
|0xB40|XPU_SCRATCH16|0x0|
|0xB44|XPU_SCRATCH17|0x0|
|0xB48|XPU_SCRATCH18|0x0|
|0xB4C|XPU_SCRATCH19|0x0|
|0xB50|XPU_SCRATCH20|0x0|
|0xB54|XPU_SCRATCH21|0x0|
|0xB58|XPU_SCRATCH22|0x0|
|0xB5C|XPU_SCRATCH23|0x0|
|0xB60|XPU_SCRATCH24|0x0|
|0xB64|XPU_SCRATCH25|0x0|
|0xB68|XPU_SCRATCH26|0x0|
|0xB6C|XPU_SCRATCH27|0x0|
|0xB70|XPU_SCRATCH28|0x0|
|0xB74|XPU_SCRATCH29|0x0|
|0xB78|XPU_SCRATCH30|0x0|
|0xB7C|XPU_SCRATCH31|0x0|
|0xB80|XPU_SCRATCH32|0x0|
|0xB84|XPU_SCRATCH33|0x0|
|0xB88|XPU_SCRATCH34|0x0|
|0xB8C|XPU_SCRATCH35|0x0|
|0xB90|XPU_SCRATCH36|0x0|
|0xB94|XPU_SCRATCH37|0x0|
|0xB98|XPU_SCRATCH38|0x0|
|0xB9C|XPU_SCRATCH39|0x0|
|0xBA0|XPU_SCRATCH40|0x0|
|0xBA4|XPU_SCRATCH41|0x0|
|0xBA8|XPU_SCRATCH42|0x0|
|0xBAC|XPU_SCRATCH43|0x0|
|0xBB0|XPU_SCRATCH44|0x0|
|0xBB4|XPU_SCRATCH45|0x0|
|0xBB8|XPU_SCRATCH46|0x0|
|0xBBC|XPU_SCRATCH47|0x0|
|0xBC0|XPU_SCRATCH48|0x0|
|0xBC4|XPU_SCRATCH49|0x0|
|0xBC8|XPU_SCRATCH50|0x0|
|0xBCC|XPU_SCRATCH51|0x0|
|0xBD0|XPU_SCRATCH52|0x0|
|0xBD4|XPU_SCRATCH53|0x0|
|0xBD8|XPU_SCRATCH54|0x0|
|0xBDC|XPU_SCRATCH55|0x0|
|0xBE0|XPU_SCRATCH56|0x0|
|0xBE4|XPU_SCRATCH57|0x0|
|0xBE8|XPU_SCRATCH58|0x0|
|0xBEC|XPU_SCRATCH59|0x0|
|0xBF0|XPU_SCRATCH60|0x0|
|0xBF4|XPU_SCRATCH61|0x0|
|0xBF8|XPU_SCRATCH62|0x0|
|0xBFC|XPU_SCRATCH63|0x0|

## 9. Control Status Register List: IMEM

|Address|Register Name|Default|
|---|---|---|
|0xD00|IMEM_SRAMCTRL|0x80100000|
|0xD04|IMEM_AXI_FIELD_CFG|0x0|
|0xD08|IMEM_TAG_INVALID|0x0|
|0xD0C|IMEM_TAG_RIDX|0x0|
|0xD10|IMEM_TAG_RDATA0|0x0|
|0xD14|IMEM_TAG_RDATA1|0x0|
|0xD18|IMEM_TAG_RDATA2|0x0|
|0xD1C|IMEM_TAG_RDATA3|0x0|
|0xD40|ICACHE_CTRL|0x0|
|0xD44|ICACHE_CLK_CTL|0x3f|
|0xD4C|IMEM_DF_MST_RAS_CTRL|0x80000000|
|0xD58|IMEM_DF_MST_RAS_STS|0x0|
|0xD80|ICACHE_SCRATCH0|0x0|
|0xD84|ICACHE_SCRATCH1|0x0|
|0xD88|ICACHE_SCRATCH2|0x0|
|0xD8C|ICACHE_SCRATCH3|0x0|

## 10. Control Status Register List: L1

|Address|Register Name|Default|
|---|---|---|
|0xE00|DMEM_BANK_MAPPING|0x4000000|
|0xE04|VDMEM_HASH_MASK0|0x11eb0f59|
|0xE08|VDMEM_HASH_MASK1|0x7ac03d6|
|0xE0C|L1_SIP_ID|0x0|
|0xE10|L1_AXI_FIELD_CFG0|0x0|
|0xE14|L1_AXI_FIELD_CFG1|0x0|
|0xE18|L1_DSM_MASK_CFG|0x0|
|0xE20|VDMEM_SRAMCTRL|0x80100000|
|0xE24|NCBUF_SRAMCTRL|0x80100000|
|0xE28|LDQ_SRAMCTRL|0x80100000|
|0xE2C|STQ_SRAMCTRL|0x80100000|
|0xE30|L1_DF0_MST_RAS_CTRL|0x80000000|
|0xE34|L1_DF0_SLV_RAS_CTRL|0x80000000|
|0xE38|L1_DF1_MST_RAS_CTRL|0x80000000|
|0xE3C|L1_DF1_SLV_RAS_CTRL|0x80000000|
|0xE40|L1_DF0_MST_RAS_STS|0x0|
|0xE44|L1_DF0_SLV_RAS_STS|0x0|
|0xE48|L1_DF1_MST_RAS_STS|0x0|
|0xE4C|L1_DF1_SLV_RAS_STS|0x0|
|0xE50|L1_BLCG_CTRL0|0xf0ffffff|
|0xE54|L1_BLCG_CTRL1|0xffffff|
|0xE58|L1_ELCG_CTRL|0x3f|
|0xE60|L1_AXIM_HASH_MASK0|0xc10b|
|0xE64|L1_AXIM_HASH_MASK1|0x4b97|
|0xE68|L1_AXIM_HASH_MASK2|0x172e|
|0xE6C|L1_AXIM_HASH_MASK3|0xc290a429|
|0xE70|L1_SIC_TILE_MAPPING|0x0|
|0xE78|L1_MISC|0x1|
|0xE7C|L1_DSM_BASE|0x4|
|0xE80|AWP0_L1_ADDR_LO|0x0|
|0xE84|AWP0_L1_ADDR_HI|0x0|
|0xE88|AWP0_L1_MASK|0x0|
|0xE8C|AWP0_L1_CTRL|0x0|
|0xE90|AWP1_L1_ADDR_LO|0x0|
|0xE94|AWP1_L1_ADDR_HI|0x0|
|0xE98|AWP1_L1_MASK|0x0|
|0xE9C|AWP1_L1_CTRL|0x0|
|0xEA0|L1_SCRATCH0|0x0|
|0xEA4|L1_SCRATCH1|0x0|
|0xEA8|L1_SCRATCH2|0x0|
|0xEAC|L1_SCRATCH3|0x0|
|0xEB0|L1_SCRATCH4|0x0|
|0xEB4|L1_SCRATCH5|0x0|
|0xEB8|L1_SCRATCH6|0x0|
|0xEBC|L1_SCRATCH7|0x0|

## 11. Control Status Register List: COMMON_CSR

|Address|Register Name|Default|
|---|---|---|
|0xF00|THD0_RPC_SEND_MSG_LO|0x0|
|0xF04|THD0_RPC_SEND_MSG_HI|0x0|
|0xF08|THD0_RPC_SEND_DST|0x0|
|0xF0C|THD0_RPC_SEND_CFG|0x0|
|0xF10|THD0_RPC_STS|0x0|
|0xF14|THD0_RPC_RCV_MSG_POP|0x0|
|0xF18|THD0_RPC_RCV_MSG_LO|0x0|
|0xF1C|THD0_RPC_RCV_MSG_HI|0x0|
|0xF20|THD1_RPC_SEND_MSG_LO|0x0|
|0xF24|THD1_RPC_SEND_MSG_HI|0x0|
|0xF28|THD1_RPC_SEND_DST|0x0|
|0xF2C|THD1_RPC_SEND_CFG|0x0|
|0xF30|THD1_RPC_STS|0x0|
|0xF34|THD1_RPC_RCV_MSG_POP|0x0|
|0xF38|THD1_RPC_RCV_MSG_LO|0x0|
|0xF3C|THD1_RPC_RCV_MSG_HI|0x0|
|0xF40|THD2_RPC_SEND_MSG_LO|0x0|
|0xF44|THD2_RPC_SEND_MSG_HI|0x0|
|0xF48|THD2_RPC_SEND_DST|0x0|
|0xF4C|THD2_RPC_SEND_CFG|0x0|
|0xF50|THD2_RPC_STS|0x0|
|0xF54|THD2_RPC_RCV_MSG_POP|0x0|
|0xF58|THD2_RPC_RCV_MSG_LO|0x0|
|0xF5C|THD2_RPC_RCV_MSG_HI|0x0|
|0xF60|THD3_RPC_SEND_MSG_LO|0x0|
|0xF64|THD3_RPC_SEND_MSG_HI|0x0|
|0xF68|THD3_RPC_SEND_DST|0x0|
|0xF6C|THD3_RPC_SEND_CFG|0x0|
|0xF70|THD3_RPC_STS|0x0|
|0xF74|THD3_RPC_RCV_MSG_POP|0x0|
|0xF78|THD3_RPC_RCV_MSG_LO|0x0|
|0xF7C|THD3_RPC_RCV_MSG_HI|0x0|
|0xF80|THD4_RPC_SEND_MSG_LO|0x0|
|0xF84|THD4_RPC_SEND_MSG_HI|0x0|
|0xF88|THD4_RPC_SEND_DST|0x0|
|0xF8C|THD4_RPC_SEND_CFG|0x0|
|0xF90|THD4_RPC_STS|0x0|
|0xF94|THD4_RPC_RCV_MSG_POP|0x0|
|0xF98|THD4_RPC_RCV_MSG_LO|0x0|
|0xF9C|THD4_RPC_RCV_MSG_HI|0x0|
|0xFA0|THD5_RPC_SEND_MSG_LO|0x0|
|0xFA4|THD5_RPC_SEND_MSG_HI|0x0|
|0xFA8|THD5_RPC_SEND_DST|0x0|
|0xFAC|THD5_RPC_SEND_CFG|0x0|
|0xFB0|THD5_RPC_STS|0x0|
|0xFB4|THD5_RPC_RCV_MSG_POP|0x0|
|0xFB8|THD5_RPC_RCV_MSG_LO|0x0|
|0xFBC|THD5_RPC_RCV_MSG_HI|0x0|
|0xFC0|THD6_RPC_SEND_MSG_LO|0x0|
|0xFC4|THD6_RPC_SEND_MSG_HI|0x0|
|0xFC8|THD6_RPC_SEND_DST|0x0|
|0xFCC|THD6_RPC_SEND_CFG|0x0|
|0xFD0|THD6_RPC_STS|0x0|
|0xFD4|THD6_RPC_RCV_MSG_POP|0x0|
|0xFD8|THD6_RPC_RCV_MSG_LO|0x0|
|0xFDC|THD6_RPC_RCV_MSG_HI|0x0|
|0xFE0|THD7_RPC_SEND_MSG_LO|0x0|
|0xFE4|THD7_RPC_SEND_MSG_HI|0x0|
|0xFE8|THD7_RPC_SEND_DST|0x0|
|0xFEC|THD7_RPC_SEND_CFG|0x0|
|0xFF0|THD7_RPC_STS|0x0|
|0xFF4|THD7_RPC_RCV_MSG_POP|0x0|
|0xFF8|THD7_RPC_RCV_MSG_LO|0x0|
|0xFFC|THD7_RPC_RCV_MSG_HI|0x0|
|0x1000|THD8_RPC_SEND_MSG_LO|0x0|
|0x1004|THD8_RPC_SEND_MSG_HI|0x0|
|0x1008|THD8_RPC_SEND_DST|0x0|
|0x100C|THD8_RPC_SEND_CFG|0x0|
|0x1010|THD8_RPC_STS|0x0|
|0x1014|THD8_RPC_RCV_MSG_POP|0x0|
|0x1018|THD8_RPC_RCV_MSG_LO|0x0|
|0x101C|THD8_RPC_RCV_MSG_HI|0x0|
|0x1020|THD9_RPC_SEND_MSG_LO|0x0|
|0x1024|THD9_RPC_SEND_MSG_HI|0x0|
|0x1028|THD9_RPC_SEND_DST|0x0|
|0x102C|THD9_RPC_SEND_CFG|0x0|
|0x1030|THD9_RPC_STS|0x0|
|0x1034|THD9_RPC_RCV_MSG_POP|0x0|
|0x1038|THD9_RPC_RCV_MSG_LO|0x0|
|0x103C|THD9_RPC_RCV_MSG_HI|0x0|
|0x1040|THD10_RPC_SEND_MSG_LO|0x0|
|0x1044|THD10_RPC_SEND_MSG_HI|0x0|
|0x1048|THD10_RPC_SEND_DST|0x0|
|0x104C|THD10_RPC_SEND_CFG|0x0|
|0x1050|THD10_RPC_STS|0x0|
|0x1054|THD10_RPC_RCV_MSG_POP|0x0|
|0x1058|THD10_RPC_RCV_MSG_LO|0x0|
|0x105C|THD10_RPC_RCV_MSG_HI|0x0|
|0x1060|THD11_RPC_SEND_MSG_LO|0x0|
|0x1064|THD11_RPC_SEND_MSG_HI|0x0|
|0x1068|THD11_RPC_SEND_DST|0x0|
|0x106C|THD11_RPC_SEND_CFG|0x0|
|0x1070|THD11_RPC_STS|0x0|
|0x1074|THD11_RPC_RCV_MSG_POP|0x0|
|0x1078|THD11_RPC_RCV_MSG_LO|0x0|
|0x107C|THD11_RPC_RCV_MSG_HI|0x0|
|0x1080|THD12_RPC_SEND_MSG_LO|0x0|
|0x1084|THD12_RPC_SEND_MSG_HI|0x0|
|0x1088|THD12_RPC_SEND_DST|0x0|
|0x108C|THD12_RPC_SEND_CFG|0x0|
|0x1090|THD12_RPC_STS|0x0|
|0x1094|THD12_RPC_RCV_MSG_POP|0x0|
|0x1098|THD12_RPC_RCV_MSG_LO|0x0|
|0x109C|THD12_RPC_RCV_MSG_HI|0x0|
|0x10A0|THD13_RPC_SEND_MSG_LO|0x0|
|0x10A4|THD13_RPC_SEND_MSG_HI|0x0|
|0x10A8|THD13_RPC_SEND_DST|0x0|
|0x10AC|THD13_RPC_SEND_CFG|0x0|
|0x10B0|THD13_RPC_STS|0x0|
|0x10B4|THD13_RPC_RCV_MSG_POP|0x0|
|0x10B8|THD13_RPC_RCV_MSG_LO|0x0|
|0x10BC|THD13_RPC_RCV_MSG_HI|0x0|
|0x10C0|THD14_RPC_SEND_MSG_LO|0x0|
|0x10C4|THD14_RPC_SEND_MSG_HI|0x0|
|0x10C8|THD14_RPC_SEND_DST|0x0|
|0x10CC|THD14_RPC_SEND_CFG|0x0|
|0x10D0|THD14_RPC_STS|0x0|
|0x10D4|THD14_RPC_RCV_MSG_POP|0x0|
|0x10D8|THD14_RPC_RCV_MSG_LO|0x0|
|0x10DC|THD14_RPC_RCV_MSG_HI|0x0|
|0x10E0|THD15_RPC_SEND_MSG_LO|0x0|
|0x10E4|THD15_RPC_SEND_MSG_HI|0x0|
|0x10E8|THD15_RPC_SEND_DST|0x0|
|0x10EC|THD15_RPC_SEND_CFG|0x0|
|0x10F0|THD15_RPC_STS|0x0|
|0x10F4|THD15_RPC_RCV_MSG_POP|0x0|
|0x10F8|THD15_RPC_RCV_MSG_LO|0x0|
|0x10FC|THD15_RPC_RCV_MSG_HI|0x0|
|0x1100|THD0_CTH_MSG_DAT|0x0|
|0x1104|THD0_CTH_MSG_IDX|0x0|
|0x1108|THD0_CTH_DST|0x0|
|0x110C|THD0_CTH_CFG|0x0|
|0x1110|THD1_CTH_MSG_DAT|0x0|
|0x1114|THD1_CTH_MSG_IDX|0x0|
|0x1118|THD1_CTH_DST|0x0|
|0x111C|THD1_CTH_CFG|0x0|
|0x1120|THD2_CTH_MSG_DAT|0x0|
|0x1124|THD2_CTH_MSG_IDX|0x0|
|0x1128|THD2_CTH_DST|0x0|
|0x112C|THD2_CTH_CFG|0x0|
|0x1130|THD3_CTH_MSG_DAT|0x0|
|0x1134|THD3_CTH_MSG_IDX|0x0|
|0x1138|THD3_CTH_DST|0x0|
|0x113C|THD3_CTH_CFG|0x0|
|0x1140|THD4_CTH_MSG_DAT|0x0|
|0x1144|THD4_CTH_MSG_IDX|0x0|
|0x1148|THD4_CTH_DST|0x0|
|0x114C|THD4_CTH_CFG|0x0|
|0x1150|THD5_CTH_MSG_DAT|0x0|
|0x1154|THD5_CTH_MSG_IDX|0x0|
|0x1158|THD5_CTH_DST|0x0|
|0x115C|THD5_CTH_CFG|0x0|
|0x1160|THD6_CTH_MSG_DAT|0x0|
|0x1164|THD6_CTH_MSG_IDX|0x0|
|0x1168|THD6_CTH_DST|0x0|
|0x116C|THD6_CTH_CFG|0x0|
|0x1170|THD7_CTH_MSG_DAT|0x0|
|0x1174|THD7_CTH_MSG_IDX|0x0|
|0x1178|THD7_CTH_DST|0x0|
|0x117C|THD7_CTH_CFG|0x0|
|0x1180|THD8_CTH_MSG_DAT|0x0|
|0x1184|THD8_CTH_MSG_IDX|0x0|
|0x1188|THD8_CTH_DST|0x0|
|0x118C|THD8_CTH_CFG|0x0|
|0x1190|THD9_CTH_MSG_DAT|0x0|
|0x1194|THD9_CTH_MSG_IDX|0x0|
|0x1198|THD9_CTH_DST|0x0|
|0x119C|THD9_CTH_CFG|0x0|
|0x11A0|THD10_CTH_MSG_DAT|0x0|
|0x11A4|THD10_CTH_MSG_IDX|0x0|
|0x11A8|THD10_CTH_DST|0x0|
|0x11AC|THD10_CTH_CFG|0x0|
|0x11B0|THD11_CTH_MSG_DAT|0x0|
|0x11B4|THD11_CTH_MSG_IDX|0x0|
|0x11B8|THD11_CTH_DST|0x0|
|0x11BC|THD11_CTH_CFG|0x0|
|0x11C0|THD12_CTH_MSG_DAT|0x0|
|0x11C4|THD12_CTH_MSG_IDX|0x0|
|0x11C8|THD12_CTH_DST|0x0|
|0x11CC|THD12_CTH_CFG|0x0|
|0x11D0|THD13_CTH_MSG_DAT|0x0|
|0x11D4|THD13_CTH_MSG_IDX|0x0|
|0x11D8|THD13_CTH_DST|0x0|
|0x11DC|THD13_CTH_CFG|0x0|
|0x11E0|THD14_CTH_MSG_DAT|0x0|
|0x11E4|THD14_CTH_MSG_IDX|0x0|
|0x11E8|THD14_CTH_DST|0x0|
|0x11EC|THD14_CTH_CFG|0x0|
|0x11F0|THD15_CTH_MSG_DAT|0x0|
|0x11F4|THD15_CTH_MSG_IDX|0x0|
|0x11F8|THD15_CTH_DST|0x0|
|0x11FC|THD15_CTH_CFG|0x0|
|0x1200|PMU_EN|0x0|
|0x1204|PMU_CREDIT_CFG|0xff|
|0x1208|PMU_CREDIT_STALL_CTRL|0x0|
|0x1210|PMU_INSPWR_LOOKUP0|0x0|
|0x1214|PMU_INSPWR_LOOKUP1|0x0|
|0x1218|PMU_INSPWR_LOOKUP2|0x0|
|0x121C|PMU_INSPWR_LOOKUP3|0x0|
|0x1220|PMU_INSPWR_LOOKUP4|0x0|
|0x1224|PMU_INSPWR_LOOKUP5|0x0|
|0x1228|PMU_INSPWR_BASE0|0x0|
|0x122C|PMU_INSPWR_BASE1|0x0|
|0x1230|PMU_INSPWR_BASE2|0x0|
|0x1240|PMU_CUR_PWR|0x0|
|0x1244|PMU_CUR_STS|0x0|
|0x1250|PMU_CREDIT_LUT0|0x80|
|0x1254|PMU_CREDIT_LUT1|0x80|
|0x1258|PMU_CREDIT_LUT2|0x80|
|0x125C|PMU_CREDIT_LUT3|0x80|
|0x1260|PMU_CREDIT_BASE|0x0|
|0x1264|PMU_CREDIT_EXTRA|0x0|
|0x1268|PMU_CREDIT_THRESHOLD|0x0|
|0x1270|PMU_CREDIT_WAIT0|0x0|
|0x1274|PMU_CREDIT_WAIT1|0x0|
|0x1278|PMU_CREDIT_WAIT2|0x0|
|0x1280|PMU_SYS_LDIDT_CFG0|0x0|
|0x1284|PMU_SYS_LDIDT_CFG1|0x0|
|0x1288|PMU_SYS_LDIDT_CFG2|0x0|
|0x128C|PMU_SYS_LDIDT_CFG3|0x0|
|0x1290|PMU_LCL_LDIDT_CFG0|0x0|
|0x1294|PMU_LDIDT_RISK_CFG0|0x0|
|0x1298|PMU_LDIDT_RISK_CFG1|0x0|
|0x12A0|PMU_STOCK_CNT0|0x0|
|0x12A4|PMU_STOCK_CNT1|0x0|
|0x12A8|PMU_STOCK_CNT2|0x0|
|0x12AC|PMU_STOCK_CNT3|0x0|
|0x12C0|PMU_PROFILE_CTRL|0x0|
|0x12C4|PMU_PROFILE_CNT0|0x0|
|0x12C8|PMU_PROFILE_CNT1|0x0|
|0x12CC|PMU_PROFILE_CNT2|0x0|
|0x12D0|PMU_PROFILE_CNT3|0x0|
|0x12FC|PMU_SCRATCH|0x0|
|0x1300|DFD_CFG|0x8000|
|0x1304|DFD_OBS_CORE_SEL0|0x10000|
|0x1308|DFD_OBS_CORE_SEL1|0x30002|
|0x130C|DFD_OBS_CORE_SEL2|0x50004|
|0x1310|DFD_OBS_CORE_SEL3|0x70006|
|0x1314|DFD_OBS_CORE_SEL4|0x90008|
|0x1318|DFD_OBS_CORE_SEL5|0xb000a|

## 12. CSR Details: Per-Launch Queue

### 12.1. MODE_CFG

**Register Name:** `MODE_CFG`

- **Offset Address:** `0x0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BF16_OVCLP|18:18|0|RWHW|If set, an overflowed BF16 result is<br>clamped to +/- MAX_BF16, regardless of<br>round mode, while still preserving true INF<br>values.<br>For floating point, clamp happens at final<br>step and final result, no intermediate<br>result clamping.<br>This field is enabled again in Scorpio/Libra<br>SIP for MOP serial instructions.|
|INT_OVCLP|17:17|0|RWHW|If set, an overflowed Integer result is<br>clamped to +/- MAX, inexact flag will be<br>raised, e.g. TransfF2I<br>Integer keep precision during whole<br>operation, clamp happening at last step for<br>final result.<br>This is not supposed to be used anymore<br>and SW should leave it as 0.<br>INT_OVCLP cannot affect SALU calculation<br>instructions except TRSI2I|
|FP16_OVCLP|16:16|0|RWHW|If set, an overflowed FP16 result is clamped<br>to +/- MAX_FP16, regardless of round<br>mode, while still preserving true INF<br>values.<br>For floating point, clamp happens at final<br>step and final result, no intermediate<br>result clamping.<br>This field is enabled again in Scorpio/Libra<br>SIP for MOP serial instructions.|
|FP_DENORM|15:8|3f|RWHW|[1:0] Half precision handler. [3:2] Single<br>precision handler. [5:4] BF16 handler. [7:6]<br>Reserved.<br>0 = allow input and output denorms.<br>1 = allow input denorms, flush output<br>denorms.<br>2 = flush input denorms, allow output<br>denorms.<br>3 = flush input and output denorms.|
|FP_ROUND|7:0|0|RWHW|[1:0] Half precision round mode. [3:2]<br>Single precision round mode. [5:4] BF16<br>round mode. [7:6] Reserved.<br>0 = nearest even<br>1 = toward zero<br>Others: Reserved|

### 12.2. IMEM_BASE_LO_CFG

**Register Name:** `IMEM_BASE_LO_CFG`

- **Offset Address:** `0x4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|IMEM_BASE_LO|31:0|0|RWHW|{IMEM_BASE_HI, IMEM_BASE_LO &<br>0x1FFF};<br>UVA_Addr_of_Inst = PC + {IMEM_BASE_HI,<br>IMEM_BASE_LO & 0x1FFF}|

### 12.3. IMEM_BASE_HI_CFG

**Register Name:** `IMEM_BASE_HI_CFG`

- **Offset Address:** `0x8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|IMEM_BASE_HI|15:0|0|RWHW|{IMEM_BASE_HI, IMEM_BASE_LO & 0x1FFF};<br>UVA_Addr_of_Inst = PC + {IMEM_BASE_HI,<br>IMEM_BASE_LO & 0x1FFF}|

### 12.4. TRPBA_CFG

**Register Name:** `TRPBA_CFG`

- **Offset Address:** `0xC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TRPBA|31:0|0|RWHW|Trap Base Address config register for trap<br>handler|

### 12.5. LCHBA_CFG

**Register Name:** `LCHBA_CFG`

- **Offset Address:** `0x10`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|LCHBA|31:0|0|RWHW|Kernel Launch Base Address config register,<br>hold point for interrupt handler. Since SIP is 8<br>byte to fetch Ins, so the [2:0] is don't care.|

### 12.6. LAUNCH_CFG

**Register Name:** `LAUNCH_CFG`

- **Offset Address:** `0x14`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_OACC|25:16|0|RWHW|Required OACC number for one<br>VPT of one sub-thread.<br>Range 0~768, should align to 4.|
|SUB_THREAD_NUM|15:12|0|RWHW|SUB-thread number to be launch in<br>this kernel.<br>Real number = SUB_THREAD_NUM<br>+1|
|THREAD_TYPE|9:8|0|RWHW|SW thread type<br>1: ISA4.0 single VPT thread with<br>GEMM or Supervisor<br>3: ISA3.2 dual VPT thread|
|DISABLE_VACC_HASH|4:4|0|RWHW|Reserved. Should always be 0.|
|INVALID_ICACHE|0:0|0|RWHW|Invalid Icache with current KSID &<br>ASID when thread start. Updated in<br>Libra SIP|

### 12.7. PACKAGE_ID_CFG

**Register Name:** `PACKAGE_ID_CFG`

- **Offset Address:** `0x18`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PACKAGE_ID|31:0|0|RWHW|Package ID for performance profiling|

### 12.8. PROCESS_ID_CFG

**Register Name:** `PROCESS_ID_CFG`

- **Offset Address:** `0x1C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PROCESS_ID|31:0|0|RWHW|Package ID for performance profiling|

### 12.9. MD0_CFG

**Register Name:** `MD0_CFG`

- **Offset Address:** `0x20`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Memory Base Address 0. Shadow push<br>registers, updates only take effects when system<br>exit HALT state and goes into RUN state|

### 12.10. MD1_CFG

**Register Name:** `MD1_CFG`

- **Offset Address:** `0x24`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Memory Base Address 1. Shadow push<br>registers, updates only take effects when system<br>exit HALT state and goes into RUN state|

### 12.11. MD2_CFG

**Register Name:** `MD2_CFG`

- **Offset Address:** `0x28`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Memory Base Address 2. Shadow push<br>registers, updates only take effects when system<br>exit HALT state and goes into RUN state|

### 12.12. MD3_CFG

**Register Name:** `MD3_CFG`

- **Offset Address:** `0x2C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Memory Base Address 3. Shadow push<br>registers, updates only take effects when system<br>exit HALT state and goes into RUN state|

### 12.13. MD4_CFG

**Register Name:** `MD4_CFG`

- **Offset Address:** `0x30`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Memory Base Address 4. Shadow push<br>registers, updates only take effects when system<br>exit HALT state and goes into RUN state|

### 12.14. MD5_CFG

**Register Name:** `MD5_CFG`

- **Offset Address:** `0x34`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Memory Base Address 5. Shadow push<br>registers, updates only take effects when system<br>exit HALT state and goes into RUN state|

### 12.15. MD6_CFG

**Register Name:** `MD6_CFG`

- **Offset Address:** `0x38`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Memory Base Address 6. Shadow push<br>registers, updates only take effects when system<br>exit HALT state and goes into RUN state|

### 12.16. MD7_CFG

**Register Name:** `MD7_CFG`

- **Offset Address:** `0x3C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Memory Base Address 7. Shadow push<br>registers, updates only take effects when system<br>exit HALT state and goes into RUN state|

### 12.17. MD8_CFG

**Register Name:** `MD8_CFG`

- **Offset Address:** `0x40`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Memory Base Address 8. Shadow push<br>registers, updates only take effects when system<br>exit HALT state and goes into RUN state|

### 12.18. MD9_CFG

**Register Name:** `MD9_CFG`

- **Offset Address:** `0x44`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.19. MD10_CFG

**Register Name:** `MD10_CFG`

- **Offset Address:** `0x48`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.20. MD11_CFG

**Register Name:** `MD11_CFG`

- **Offset Address:** `0x4C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.21. MD12_CFG

**Register Name:** `MD12_CFG`

- **Offset Address:** `0x50`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.22. MD13_CFG

**Register Name:** `MD13_CFG`

- **Offset Address:** `0x54`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.23. MD14_CFG

**Register Name:** `MD14_CFG`

- **Offset Address:** `0x58`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.24. MD15_CFG

**Register Name:** `MD15_CFG`

- **Offset Address:** `0x5C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.25. MD16_CFG

**Register Name:** `MD16_CFG`

- **Offset Address:** `0x60`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.26. MD17_CFG

**Register Name:** `MD17_CFG`

- **Offset Address:** `0x64`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.27. MD18_CFG

**Register Name:** `MD18_CFG`

- **Offset Address:** `0x68`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.28. MD19_CFG

**Register Name:** `MD19_CFG`

- **Offset Address:** `0x6C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.29. MD20_CFG

**Register Name:** `MD20_CFG`

- **Offset Address:** `0x70`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.30. MD21_CFG

**Register Name:** `MD21_CFG`

- **Offset Address:** `0x74`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.31. MD22_CFG

**Register Name:** `MD22_CFG`

- **Offset Address:** `0x78`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.32. MD23_CFG

**Register Name:** `MD23_CFG`

- **Offset Address:** `0x7C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.33. MD24_CFG

**Register Name:** `MD24_CFG`

- **Offset Address:** `0x80`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.34. MD25_CFG

**Register Name:** `MD25_CFG`

- **Offset Address:** `0x84`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.35. MD26_CFG

**Register Name:** `MD26_CFG`

- **Offset Address:** `0x88`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.36. MD27_CFG

**Register Name:** `MD27_CFG`

- **Offset Address:** `0x8C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.37. MD28_CFG

**Register Name:** `MD28_CFG`

- **Offset Address:** `0x90`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.38. MD29_CFG

**Register Name:** `MD29_CFG`

- **Offset Address:** `0x94`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.39. MD30_CFG

**Register Name:** `MD30_CFG`

- **Offset Address:** `0x98`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.40. MD31_CFG

**Register Name:** `MD31_CFG`

- **Offset Address:** `0x9C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RWHW|Shadow push registers, updates only take<br>effects when system exit HALT state and goes<br>into RUN state|

### 12.41. ASID_CFG

**Register Name:** `ASID_CFG`

- **Offset Address:** `0xA0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ASID|3:0|0|RWHW|The ASID for current thread|

### 12.42. KSID_CFG

**Register Name:** `KSID_CFG`

- **Offset Address:** `0xA4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|KSID|5:0|0|RWHW|The KSID for current thread|

### 12.43. PARAM_CFG

**Register Name:** `PARAM_CFG`

- **Offset Address:** `0xA8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PARAM_ADDR|26:16|0|RWHW|Parameter start address in SDMEM.<br>SDMEM_PHYSICAL_ADDR = PARAM_ADDR<br>* 128B<br>PARAM_VIRTUAL_ADDR = 0x1_4000_0000<br>+ PARAM_ADDR * 128B<br>Valid range: 0-0x3FF|
|PARAM_SIZE|10:0|0|RWHW|Parameter buffer size = PARAM_SIZE *<br>128B<br>Valid range: 0-0x400|

### 12.44. SUB_THD_ID_CFG

**Register Name:** `SUB_THD_ID_CFG`

- **Offset Address:** `0xAC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SUB_THD_ID|31:0|0|RWHW|The first sub-thread id of current kernel.<br>The IDs for following sub-thread will be self-<br>increased by HW.|

### 12.45. LCHTRIG

**Register Name:** `LCHTRIG`

- **Offset Address:** `0xB0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|KNL_SLOT|17:16|0|RWHW|Kernel slot index for this kernel launch<br>Valid Range: 0~1. Other values are<br>reserved|
|THD_SLOT_TRIG|15:0|0|RWHW|Kernel Launch Trigger. Each bit means 1<br>thread-slot.<br>Writing "1" to any bit of [9:0] means<br>Kernel will launch a sub-thread to this<br>thread-slot.<br>Multiple "1" means Kernel will launch<br>multiple sub-threads. Total "1" number<br>should equal to<br>LAUNCH_CFG.SUB_THREAD_NUM+1.<br>Meanwhile Write a non-zero value to this<br>field will push all *._CFG registers into<br>launch queue.<br>Bit[15:10] are reserved|

### 12.46. CFG_STS

**Register Name:** `CFG_STS`

- **Offset Address:** `0xB4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|AVAIL|2:0|4|RO|Indicate how many entries in LCH_CFG queue are<br>avaliable. Valid range 4~0.|

### 12.47. MODE_NXT

**Register Name:** `MODE_NXT`

- **Offset Address:** `0x100`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BF16_OVCLP|18:18|0|RO|If set, an overflowed BF16 result is clamped to<br>+/- MAX_BF16, regardless of round mode,<br>while still preserving true INF values.<br>For floating point, clamp happens at final step<br>and final result, no intermediate result<br>clamping.<br>This field is enabled again in Scorpio/Libra SIP<br>for MOP serial instructions.|
|INT_OVCLP|17:17|0|RO|If set, an overflowed Integer result is clamped<br>to +/- MAX, inexact flag will be raised, e.g.<br>TransfF2I<br>Integer keep precision during whole<br>operation, clamp happening at last step for<br>final result.<br>This is not supposed to be used anymore and<br>SW should leave it as 0.<br>INT_OVCLP cannot affect SALU calculation<br>instructions except TRSI2I|
|FP16_OVCLP|16:16|0|RO|If set, an overflowed FP16 result is clamped to<br>+/- MAX_FP16, regardless of round mode,<br>while still preserving true INF values.<br>For floating point, clamp happens at final step<br>and final result, no intermediate result<br>clamping.<br>This field is enabled again in Scorpio/Libra SIP<br>for MOP serial instructions.|
|FP_DENORM|15:8|3f|RO|[1:0] Half precision handler. [3:2] Single<br>precision handler. [5:4] BF16 handler. [7:6]<br>Reserved.<br>0 = allow input and output denorms.<br>1 = allow input denorms, flush output<br>denorms.<br>2 = flush input denorms, allow output<br>denorms.<br>3 = flush input and output denorms.|
|FP_ROUND|7:0|0|RO|[1:0] Half precision round mode. [3:2] Single<br>precision round mode. [5:4] BF16 round<br>mode. [7:6] Reserved.<br>0 = nearest even<br>1 = toward zero<br>Others: Reserved|

### 12.48. IMEM_BASE_LO_NXT

**Register Name:** `IMEM_BASE_LO_NXT`

- **Offset Address:** `0x104`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|IMEM_BASE_LO|31:0|0|RO|{IMEM_BASE_HI, IMEM_BASE_LO & 0x1FFF};<br>UVA_Addr_of_Inst = PC + {IMEM_BASE_HI,<br>IMEM_BASE_LO & 0x1FFF}|

### 12.49. IMEM_BASE_HI_NXT

**Register Name:** `IMEM_BASE_HI_NXT`

- **Offset Address:** `0x108`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|IMEM_BASE_HI|15:0|0|RO|{IMEM_BASE_HI, IMEM_BASE_LO & 0x1FFF};<br>UVA_Addr_of_Inst = PC + {IMEM_BASE_HI,<br>IMEM_BASE_LO & 0x1FFF}|

### 12.50. TRPBA_NXT

**Register Name:** `TRPBA_NXT`

- **Offset Address:** `0x10C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TRPBA|31:0|0|RO|Trap Base Address config register for trap handler|

### 12.51. LCHBA_NXT

**Register Name:** `LCHBA_NXT`

- **Offset Address:** `0x110`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|LCHBA|31:0|0|RO|Kernel Launch Base Address config register, hold<br>point for interrupt handler. Since SIP is 8 byte to<br>fetch Ins, so the [2:0] is don't care.|

### 12.52. LAUNCH_NXT

**Register Name:** `LAUNCH_NXT`

- **Offset Address:** `0x114`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_OACC|25:16|0|RO|Required OACC number for one VPT of<br>one sub-thread.<br>Range 0~768, should align to 4.|
|SUB_THREAD_NUM|15:12|0|RO|SUB-thread number to be launch in<br>this kernel.<br>Real number = SUB_THREAD_NUM + 1|
|THREAD_TYPE|9:8|0|RO|SW thread type<br>1: ISA4.0 single VPT thread with GEMM<br>or Supervisor<br>3: ISA3.2 dual VPT thread|
|DISABLE_VACC_HASH|4:4|0|RO|Reserved.|
|INVALID_ICACHE|0:0|0|RO|Invalid Icache with current KSID & ASID<br>when thread start. Updated in Libra<br>SIP|

### 12.53. PACKAGE_ID_NXT

**Register Name:** `PACKAGE_ID_NXT`

- **Offset Address:** `0x118`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PACKAGE_ID|31:0|0|RO|Package ID for performance profiling|

### 12.54. PROCESS_ID_NXT

**Register Name:** `PROCESS_ID_NXT`

- **Offset Address:** `0x11C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PROCESS_ID|31:0|0|RO|Package ID for performance profiling|

### 12.55. MD0_NXT

**Register Name:** `MD0_NXT`

- **Offset Address:** `0x120`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Memory Base Address 0. Shadow push registers,<br>updates only take effects when system exit HALT<br>state and goes into RUN state|

### 12.56. MD1_NXT

**Register Name:** `MD1_NXT`

- **Offset Address:** `0x124`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Memory Base Address 1. Shadow push registers,<br>updates only take effects when system exit HALT<br>state and goes into RUN state|

### 12.57. MD2_NXT

**Register Name:** `MD2_NXT`

- **Offset Address:** `0x128`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Memory Base Address 2. Shadow push registers,<br>updates only take effects when system exit HALT<br>state and goes into RUN state|

### 12.58. MD3_NXT

**Register Name:** `MD3_NXT`

- **Offset Address:** `0x12C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Memory Base Address 3. Shadow push registers,<br>updates only take effects when system exit HALT<br>state and goes into RUN state|

### 12.59. MD4_NXT

**Register Name:** `MD4_NXT`

- **Offset Address:** `0x130`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Memory Base Address 4. Shadow push registers,<br>updates only take effects when system exit HALT<br>state and goes into RUN state|

### 12.60. MD5_NXT

**Register Name:** `MD5_NXT`

- **Offset Address:** `0x134`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Memory Base Address 5. Shadow push registers,<br>updates only take effects when system exit HALT<br>state and goes into RUN state|

### 12.61. MD6_NXT

**Register Name:** `MD6_NXT`

- **Offset Address:** `0x138`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Memory Base Address 6. Shadow push registers,<br>updates only take effects when system exit HALT<br>state and goes into RUN state|

### 12.62. MD7_NXT

**Register Name:** `MD7_NXT`

- **Offset Address:** `0x13C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Memory Base Address 7. Shadow push registers,<br>updates only take effects when system exit HALT<br>state and goes into RUN state|

### 12.63. MD8_NXT

**Register Name:** `MD8_NXT`

- **Offset Address:** `0x140`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Memory Base Address 8. Shadow push registers,<br>updates only take effects when system exit HALT<br>state and goes into RUN state|

### 12.64. MD9_NXT

**Register Name:** `MD9_NXT`

- **Offset Address:** `0x144`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.65. MD10_NXT

**Register Name:** `MD10_NXT`

- **Offset Address:** `0x148`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.66. MD11_NXT

**Register Name:** `MD11_NXT`

- **Offset Address:** `0x14C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.67. MD12_NXT

**Register Name:** `MD12_NXT`

- **Offset Address:** `0x150`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.68. MD13_NXT

**Register Name:** `MD13_NXT`

- **Offset Address:** `0x154`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.69. MD14_NXT

**Register Name:** `MD14_NXT`

- **Offset Address:** `0x158`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.70. MD15_NXT

**Register Name:** `MD15_NXT`

- **Offset Address:** `0x15C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.71. MD16_NXT

**Register Name:** `MD16_NXT`

- **Offset Address:** `0x160`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.72. MD17_NXT

**Register Name:** `MD17_NXT`

- **Offset Address:** `0x164`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.73. MD18_NXT

**Register Name:** `MD18_NXT`

- **Offset Address:** `0x168`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.74. MD19_NXT

**Register Name:** `MD19_NXT`

- **Offset Address:** `0x16C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.75. MD20_NXT

**Register Name:** `MD20_NXT`

- **Offset Address:** `0x170`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.76. MD21_NXT

**Register Name:** `MD21_NXT`

- **Offset Address:** `0x174`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.77. MD22_NXT

**Register Name:** `MD22_NXT`

- **Offset Address:** `0x178`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.78. MD23_NXT

**Register Name:** `MD23_NXT`

- **Offset Address:** `0x17C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.79. MD24_NXT

**Register Name:** `MD24_NXT`

- **Offset Address:** `0x180`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.80. MD25_NXT

**Register Name:** `MD25_NXT`

- **Offset Address:** `0x184`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.81. MD26_NXT

**Register Name:** `MD26_NXT`

- **Offset Address:** `0x188`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.82. MD27_NXT

**Register Name:** `MD27_NXT`

- **Offset Address:** `0x18C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.83. MD28_NXT

**Register Name:** `MD28_NXT`

- **Offset Address:** `0x190`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.84. MD29_NXT

**Register Name:** `MD29_NXT`

- **Offset Address:** `0x194`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.85. MD30_NXT

**Register Name:** `MD30_NXT`

- **Offset Address:** `0x198`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.86. MD31_NXT

**Register Name:** `MD31_NXT`

- **Offset Address:** `0x19C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 12.87. ASID_NXT

**Register Name:** `ASID_NXT`

- **Offset Address:** `0x1A0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ASID|3:0|0|RO|The ASID for current thread|

### 12.88. KSID_NXT

**Register Name:** `KSID_NXT`

- **Offset Address:** `0x1A4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|KSID|5:0|0|RO|The KSID for current thread|

### 12.89. PARAM_NXT

**Register Name:** `PARAM_NXT`

- **Offset Address:** `0x1A8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PARAM_ADDR|26:16|0|RO|Parameter start address in SDMEM.<br>SDMEM_PHYSICAL_ADDR = PARAM_ADDR *<br>128B<br>PARAM_VIRTUAL_ADDR = 0x1_4000_0000 +<br>PARAM_ADDR * 128B<br>Valid range: 0-0x3FF|
|PARAM_SIZE|10:0|0|RO|Parameter buffer size = PARAM_SIZE * 128B<br>Valid range: 0-0x400|

### 12.90. SUB_THD_ID_NXT

**Register Name:** `SUB_THD_ID_NXT`

- **Offset Address:** `0x1AC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SUB_THD_ID|31:0|0|RO|The first sub-thread id of current kernel. The<br>IDs for following sub-thread will be self-<br>increased by HW.|

### 12.91. LCHTRIG_NXT

**Register Name:** `LCHTRIG_NXT`

- **Offset Address:** `0x1B0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|KNL_SLOT|17:16|0|RO|Kernel slot index for this kernel launch|
|THD_SLOT_TRIG|15:0|0|RO|Kernel Launch Trigger. Each bit means 1<br>thread-slot.<br>Writing "1" to any bit of [9:0] means Kernel<br>will launch a sub-thread to this thread-slot.<br>Multiple "1" means Kernel will launch<br>multiple sub-threads. Total "1" number<br>should equal to<br>LAUNCH_CFG.SUB_THREAD_NUM+1.<br>Meanwhile Write a non-zero value to this<br>field will push all *._CFG registers into<br>launch queue.<br>Bit[15:10] are reserved|

### 12.92. NXT_POP

**Register Name:** `NXT_POP`

- **Offset Address:** `0x1B4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|POP|1:0|0|WO|Write only register.<br>Write 1 to drop current NEXT GROUP, and<br>CFG_STS.AVAIL+1.<br>Write 2 to pop current NEXT GROUP into CFG of<br>previous CFG GROUP, and CFG_STS.AVAIL+1.<br>The read value is always 0.|

### 12.93. STOP_AUTO_LCH

**Register Name:** `STOP_AUTO_LCH`

- **Offset Address:** `0x1B8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|STOP|0:0|0|RWHW|When set "1", the launch queue will stop auto<br>launch. But update to NXT_POP can still working|


## 13. CSR Details: XPU

### 13.1. APP0

**Register Name:** `APP0`

- **Offset Address:** `0x400`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.2. APP1

**Register Name:** `APP1`

- **Offset Address:** `0x404`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.3. APP2

**Register Name:** `APP2`

- **Offset Address:** `0x408`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.4. APP3

**Register Name:** `APP3`

- **Offset Address:** `0x40C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.5. APP4

**Register Name:** `APP4`

- **Offset Address:** `0x410`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.6. APP5

**Register Name:** `APP5`

- **Offset Address:** `0x414`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.7. APP6

**Register Name:** `APP6`

- **Offset Address:** `0x418`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.8. APP7

**Register Name:** `APP7`

- **Offset Address:** `0x41C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.9. APP8

**Register Name:** `APP8`

- **Offset Address:** `0x420`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.10. APP9

**Register Name:** `APP9`

- **Offset Address:** `0x424`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.11. APP10

**Register Name:** `APP10`

- **Offset Address:** `0x428`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.12. APP11

**Register Name:** `APP11`

- **Offset Address:** `0x42C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.13. APP12

**Register Name:** `APP12`

- **Offset Address:** `0x430`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.14. APP13

**Register Name:** `APP13`

- **Offset Address:** `0x434`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.15. APP14

**Register Name:** `APP14`

- **Offset Address:** `0x438`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.16. APP15

**Register Name:** `APP15`

- **Offset Address:** `0x43C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.17. APP16

**Register Name:** `APP16`

- **Offset Address:** `0x440`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.18. APP17

**Register Name:** `APP17`

- **Offset Address:** `0x444`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.19. APP18

**Register Name:** `APP18`

- **Offset Address:** `0x448`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.20. APP19

**Register Name:** `APP19`

- **Offset Address:** `0x44C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.21. APP20

**Register Name:** `APP20`

- **Offset Address:** `0x450`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.22. APP21

**Register Name:** `APP21`

- **Offset Address:** `0x454`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.23. APP22

**Register Name:** `APP22`

- **Offset Address:** `0x458`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.24. APP23

**Register Name:** `APP23`

- **Offset Address:** `0x45C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.25. APP24

**Register Name:** `APP24`

- **Offset Address:** `0x460`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.26. APP25

**Register Name:** `APP25`

- **Offset Address:** `0x464`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.27. APP26

**Register Name:** `APP26`

- **Offset Address:** `0x468`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.28. APP27

**Register Name:** `APP27`

- **Offset Address:** `0x46C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.29. APP28

**Register Name:** `APP28`

- **Offset Address:** `0x470`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.30. APP29

**Register Name:** `APP29`

- **Offset Address:** `0x474`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.31. APP30

**Register Name:** `APP30`

- **Offset Address:** `0x478`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.32. APP31

**Register Name:** `APP31`

- **Offset Address:** `0x47C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Application common usage register|

### 13.33. MBOX_ID

**Register Name:** `MBOX_ID`

- **Offset Address:** `0x600`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|UNIQ_ID|15:9|0|RWHW|Signaling unique ID. It will be compared with<br>entry saved MAIL_BOX_CONFIG.UNIQ_ID. Error<br>will be reported if they are mismatch.|
|MB_ID|7:0|0|RWHW|Mailbox index, when writes mailbox id is equal<br>with MAIL_CONFIG register MB_ID, which<br>triggers the mbx collector's counter + 1;<br>Total number of physical mailbox is 128 in SIP|

### 13.34. MBOX_CONFIG

**Register Name:** `MBOX_CONFIG`

- **Offset Address:** `0x604`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|UPD_MODE|31:30|0|RWHW|Driver/MCU write mode to determine what<br>mode is the mailbox working at.<br>0: Wait_clear mode (legacy);<br>1: Wait_minus_one;<br>2: Wait_minus_REF.|
|CRE_MODE|29:29|0|RWHW|Credit mode.<br>0: the initial mailbox counter would be set<br>to 0 (legacy);<br>1: the initial mailbox counter would be set<br>to REF|
|TRG_MODE|28:28|0|RWHW|Trigger mode:<br>0: trigger signal is asserted when counter<br>equal or larger than reference number<br>(legacy);<br>1: trigger signal is asserted once counter is<br>larger than 0.|
|INC_MODE|27:27|0|RWHW|Counter increment mode:<br>0: the counter will increment 1 when<br>according entry is signaled.<br>1: the counter will increment REF when<br>according entry is signaled.|
|REF|26:16|1|RWHW|Driver/MCU write ref, the ref value defines<br>the numbers of events the mailbox must<br>wait|
|UNIQ_ID|15:9|0|RWHW|Driver/MCU write uniq_id,the uniq_id value<br>define the unique event ID the mailbox<br>must wait|
|MB_ID|7:0|0|RWHW|Mailbox design decode the MB_ID to the<br>reference mailbox|

### 13.35. MBOX_GLB_CONFIG

**Register Name:** `MBOX_GLB_CONFIG`

- **Offset Address:** `0x608`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|GLB_CONFIG|0:0|0|RWHW|Driver/MCU write this register before setting<br>MBOX_CONFIG. The value determines<br>whether the configuration provided by the<br>MBOX_CONFIG is a global configuration or a<br>single mailbox configuration|

### 13.36. MBOX_STATUS_SEL

**Register Name:** `MBOX_STATUS_SEL`

- **Offset Address:** `0x60C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MB_ID|7:0|0|RWHW|Select the refer mbx. When the mbx is selected,<br>the MBOX_STAUS is able to read the REF and<br>MAIL_COUTER value.|

### 13.37. MBOX_STATUS_0

**Register Name:** `MBOX_STATUS_0`

- **Offset Address:** `0x610`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|REF|31:16|1|RO|Read mail ref value. For every MBOX, there<br>is one default email in MBOX after reset. The<br>REF value is updated after MBOX_CONFIG<br>REF and MB_ID is configured.|
|MAIL_COUNTER|15:0|0|RO|Read mail counter value. It indicates MAIL<br>number of<br>mailbox[MBOX_STATUS_SEL.MB_ID].|

### 13.38. MBOX_STATUS_1

**Register Name:** `MBOX_STATUS_1`

- **Offset Address:** `0x614`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MASTER_ID|21:12|0|RO|Read the last signaled master ID of the<br>selected entry.(Sometimes,if the entry is<br>not signaled after being selected by<br>mbx_status_sel, the master ID will be all<br>1)|
|UNIQ_ID_CFG|11:5|0|RO|Read uniq ID of<br>mailbox[MBOX_STATUS_SEL.MB_ID].|
|UPD_MODE_CONFIG|4:3|0|RO|Read upd_mode of<br>mailbox[MBOX_STATUS_SEL.MB_ID].|
|CRE_MODE_CONFIG|2:2|0|RO|Read cre_mode of<br>mailbox[MBOX_STATUS_SEL.MB_ID].|
|TRG_MODE_CONFIG|1:1|0|RO|Read trg_mode of<br>mailbox[MBOX_STATUS_SEL.MB_ID].|
|INC_MODE_CONFIG|0:0|0|RO|Read inc_mode of<br>mailbox[MBOX_STATUS_SEL.MB_ID].|

### 13.39. MBOX_ERR0_RPT

**Register Name:** `MBOX_ERR0_RPT`

- **Offset Address:** `0x618`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|FLAG|0:0|0|W1C|Error was detected in signaling of<br>mailbox0~mailbox63.|

### 13.40. MBOX_ERR0_CODE_0

**Register Name:** `MBOX_ERR0_CODE_0`

- **Offset Address:** `0x61C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CODE_0|31:0|0|RO|For mailbox0~mailbox63<br>10bit master id, 11bit ref, 11bit counter}<br>{10bit master id, 11bit ref, 11bit counter|

### 13.41. MBOX_ERR0_CODE_1

**Register Name:** `MBOX_ERR0_CODE_1`

- **Offset Address:** `0x620`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CODE_1|31:0|0|RO|For mailbox0~mailbox63<br>2’b00, 2’b0, 2bit upd_mode , 1bit cre_mode, 1bit<br>trg_mode, 1bit inc_mode , 7bit signaling uniq_id,<br>7bit mbx_uniq_id, 9bit mbx_id}<br>{2’b00, 2’b0, 2bit upd_mode , 1bit cre_mode, 1bit<br>trg_mode, 1bit inc_mode , 7bit signaling uniq_id,<br>7bit mbx_uniq_id, 9bit mbx_id|

### 13.42. MBOX_ERR1_RPT

**Register Name:** `MBOX_ERR1_RPT`

- **Offset Address:** `0x624`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|FLAG|0:0|0|W1C|Error was detected in signaling of<br>mailbox64~mailbox127.|

### 13.43. MBOX_ERR1_CODE_0

**Register Name:** `MBOX_ERR1_CODE_0`

- **Offset Address:** `0x628`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CODE_0|31:0|0|RO|For mailbox64~mailbox127<br>10bit master id, 11bit ref, 11bit counter}<br>{10bit master id, 11bit ref, 11bit counter|

### 13.44. MBOX_ERR1_CODE_1

**Register Name:** `MBOX_ERR1_CODE_1`

- **Offset Address:** `0x62C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CODE_1|31:0|0|RO|For mailbox64~mailbox127<br>2’b00, 2’b0, 2bit upd_mode , 1bit cre_mode, 1bit<br>trg_mode, 1bit inc_mode , 7bit signaling uniq_id,<br>7bit mbx_uniq_id, 9bit mbx_id}<br>{2’b00, 2’b0, 2bit upd_mode , 1bit cre_mode, 1bit<br>trg_mode, 1bit inc_mode , 7bit signaling uniq_id,<br>7bit mbx_uniq_id, 9bit mbx_id|

### 13.45. SWR_WAIT_GSYNC0

**Register Name:** `SWR_WAIT_GSYNC0`

- **Offset Address:** `0x630`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SWR_WAIT_GSYNC|31:0|0|RWHW|GSYNC related SIP SW code to write it<br>with same value in SWR_CFG_GSYNC0<br>when need to wait GSYNC signal.<br>GSYNC HW will clear it when waiting<br>condition is satisfied and WAIT/WAITI<br>ins clr field is valid.|

### 13.46. SWR_WAIT_GSYNC1

**Register Name:** `SWR_WAIT_GSYNC1`

- **Offset Address:** `0x634`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SWR_WAIT_GSYNC|31:0|0|RWHW|GSYNC related SIP SW code to write it<br>with same value in SWR_CFG_GSYNC1<br>when need to wait GSYNC signal.<br>GSYNC HW will clear it when waiting<br>condition is satisfied and WAIT/WAITI<br>ins clr field is valid.|

### 13.47. SWR_WAIT_GSYNC2

**Register Name:** `SWR_WAIT_GSYNC2`

- **Offset Address:** `0x638`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SWR_WAIT_GSYNC|31:0|0|RWHW|GSYNC related SIP SW code to write it<br>with same value in SWR_CFG_GSYNC2<br>when need to wait GSYNC signal.<br>GSYNC HW will clear it when waiting<br>condition is satisfied and WAIT/WAITI<br>ins clr field is valid.|

### 13.48. SWR_WAIT_GSYNC3

**Register Name:** `SWR_WAIT_GSYNC3`

- **Offset Address:** `0x63C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SWR_WAIT_GSYNC|31:0|0|RWHW|GSYNC related SIP SW code to write it<br>with same value in SWR_CFG_GSYN3<br>when need to wait GSYNC signal.<br>GSYNC HW will clear it when waiting<br>condition is satisfied and WAIT/WAITI<br>ins clr field is valid.|

### 13.49. SWR_CFG_GSYNC0

**Register Name:** `SWR_CFG_GSYNC0`

- **Offset Address:** `0x640`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SWR_CFG_GSYNC|31:0|ffffffff|RWHW|GSYNC related SIP SW code to write<br>SWR_CFG_GSYNC0 value into CLUSTER<br>CCU GSYNC HW when want to wait<br>GSYNC signal.|

### 13.50. SWR_CFG_GSYNC1

**Register Name:** `SWR_CFG_GSYNC1`

- **Offset Address:** `0x644`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SWR_CFG_GSYNC|31:0|ffffffff|RWHW|GSYNC related SIP SW code to write<br>SWR_CFG_GSYNC1 value into CLUSTER<br>CCU GSYNC HW when want to wait<br>GSYNC signal.|

### 13.51. SWR_CFG_GSYNC2

**Register Name:** `SWR_CFG_GSYNC2`

- **Offset Address:** `0x648`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SWR_CFG_GSYNC|31:0|ffffffff|RWHW|GSYNC related SIP SW code to write<br>SWR_CFG_GSYNC2 value into CLUSTER<br>CCU GSYNC HW when want to wait<br>GSYNC signal.|

### 13.52. SWR_CFG_GSYNC3

**Register Name:** `SWR_CFG_GSYNC3`

- **Offset Address:** `0x64C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SWR_CFG_GSYNC|31:0|ffffffff|RWHW|GSYNC related SIP SW code to write<br>SWR_CFG_GSYNC3 value into CLUSTER<br>CCU GSYNC HW when want to wait<br>GSYNC signal.|

### 13.53. MBOX_V128_BIT_EN

**Register Name:** `MBOX_V128_BIT_EN`

- **Offset Address:** `0x650`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|V128_BIT_EN|31:0|0|RWHW|V128 is a virtual mailbox which is a<br>summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127<br>are used for mailbox V128<br>V128_STS = bit_or(MBOX_V128_BIT_EN &<br>MBOX_EXTRA_STS)|

### 13.54. MBOX_V129_BIT_EN

**Register Name:** `MBOX_V129_BIT_EN`

- **Offset Address:** `0x654`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|V129_BIT_EN|31:0|0|RWHW|V129 is a virtual mailbox which is a<br>summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127<br>are used for mailbox V129<br>V129_STS = bit_or(MBOX_V129_BIT_EN &<br>MBOX_EXTRA_STS)|

### 13.55. MBOX_V130_BIT_EN

**Register Name:** `MBOX_V130_BIT_EN`

- **Offset Address:** `0x658`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|V130_BIT_EN|31:0|0|RWHW|V130 is a virtual mailbox which is a<br>summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127<br>are used for mailbox V130<br>V130_STS = bit_or(MBOX_V130_BIT_EN &<br>MBOX_EXTRA_STS)|

### 13.56. MBOX_V131_BIT_EN

**Register Name:** `MBOX_V131_BIT_EN`

- **Offset Address:** `0x65C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|V131_BIT_EN|31:0|0|RWHW|V131 is a virtual mailbox which is a<br>summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127<br>are used for mailbox V131<br>V131_STS = bit_or(MBOX_V131_BIT_EN &<br>MBOX_EXTRA_STS)|

### 13.57. MBOX_V132_BIT_EN

**Register Name:** `MBOX_V132_BIT_EN`

- **Offset Address:** `0x660`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|V132_BIT_EN|31:0|0|RWHW|V132 is a virtual mailbox which is a<br>summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127<br>are used for mailbox V132<br>V132_STS = bit_or(MBOX_V132_BIT_EN &<br>MBOX_EXTRA_STS)|

### 13.58. MBOX_V133_BIT_EN

**Register Name:** `MBOX_V133_BIT_EN`

- **Offset Address:** `0x664`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|V133_BIT_EN|31:0|0|RWHW|V133 is a virtual mailbox which is a<br>summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127<br>are used for mailbox V133<br>V133_STS = bit_or(MBOX_V133_BIT_EN &<br>MBOX_EXTRA_STS)|

### 13.59. MBOX_V134_BIT_EN

**Register Name:** `MBOX_V134_BIT_EN`

- **Offset Address:** `0x668`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|V134_BIT_EN|31:0|0|RWHW|V134 is a virtual mailbox which is a<br>summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127<br>are used for mailbox V134<br>V134_STS = bit_or(MBOX_V134_BIT_EN &<br>MBOX_EXTRA_STS)|

### 13.60. MBOX_V135_BIT_EN

**Register Name:** `MBOX_V135_BIT_EN`

- **Offset Address:** `0x66C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|V135_BIT_EN|31:0|0|RWHW|V135 is a virtual mailbox which is a<br>summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127<br>are used for mailbox V135<br>V135_STS = bit_or(MBOX_V135_BIT_EN &<br>MBOX_EXTRA_STS)|

### 13.61. MBOX_V136_BIT_EN

**Register Name:** `MBOX_V136_BIT_EN`

- **Offset Address:** `0x670`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|V136_BIT_EN|31:0|0|RWHW|V136 is a virtual mailbox which is a<br>summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127<br>are used for mailbox V136<br>V136_STS = bit_or(MBOX_V136_BIT_EN &<br>MBOX_EXTRA_STS)|

### 13.62. MBOX_V137_BIT_EN

**Register Name:** `MBOX_V137_BIT_EN`

- **Offset Address:** `0x674`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|V137_BIT_EN|31:0|0|RWHW|V137 is a virtual mailbox which is a<br>summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127<br>are used for mailbox V137<br>V137_STS = bit_or(MBOX_V137_BIT_EN &<br>MBOX_EXTRA_STS)|

### 13.63. MBOX_V138_BIT_EN

**Register Name:** `MBOX_V138_BIT_EN`

- **Offset Address:** `0x678`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|V138_BIT_EN|31:0|0|RWHW|V138 is a virtual mailbox which is a<br>summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127<br>are used for mailbox V138<br>V138_STS = bit_or(MBOX_V138_BIT_EN &<br>MBOX_EXTRA_STS)|

### 13.64. MBOX_V139_BIT_EN

**Register Name:** `MBOX_V139_BIT_EN`

- **Offset Address:** `0x67C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|V139_BIT_EN|31:0|0|RWHW|V139 is a virtual mailbox which is a<br>summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127<br>are used for mailbox V139<br>V139_STS = bit_or(MBOX_V139_BIT_EN &<br>MBOX_EXTRA_STS)|

### 13.65. MBOX_V140_BIT_EN

**Register Name:** `MBOX_V140_BIT_EN`

- **Offset Address:** `0x680`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|V140_BIT_EN|31:0|0|RWHW|V140 is a virtual mailbox which is a<br>summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127<br>are used for mailbox V140<br>V140_STS = bit_or(MBOX_V140_BIT_EN &<br>MBOX_EXTRA_STS)|

### 13.66. MBOX_V141_BIT_EN

**Register Name:** `MBOX_V141_BIT_EN`

- **Offset Address:** `0x684`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|V141_BIT_EN|31:0|0|RWHW|V141 is a virtual mailbox which is a<br>summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127<br>are used for mailbox V141<br>V141_STS = bit_or(MBOX_V141_BIT_EN &<br>MBOX_EXTRA_STS)|

### 13.67. MBOX_V142_BIT_EN

**Register Name:** `MBOX_V142_BIT_EN`

- **Offset Address:** `0x688`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|V142_BIT_EN|31:0|0|RWHW|V142 is a virtual mailbox which is a<br>summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127<br>are used for mailbox V142<br>V142_STS = bit_or(MBOX_V142_BIT_EN &<br>MBOX_EXTRA_STS)|

### 13.68. MBOX_V143_BIT_EN

**Register Name:** `MBOX_V143_BIT_EN`

- **Offset Address:** `0x68C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|V143_BIT_EN|31:0|0|RWHW|V143 is a virtual mailbox which is a<br>summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127<br>are used for mailbox V143<br>V143_STS = bit_or(MBOX_V143_BIT_EN &<br>MBOX_EXTRA_STS)|

### 13.69. MBOX_EXTRA_STS

**Register Name:** `MBOX_EXTRA_STS`

- **Offset Address:** `0x690`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|EXTRA_STS|31:0|0|RO|Bit31~bit0 indicate whether MBX96~MBX127 are<br>satisfied or not<br>1: this mailbox is satisfied<br>0: this mailbox is not satisfied|

### 13.70. ETA_CTRL0

**Register Name:** `ETA_CTRL0`

- **Offset Address:** `0x6A0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THD3_ETA_EN|31:24|0|RWHW|Enable control for software thread3<br>event_type0~7 in event trace agent<br>0 means disable; 1 means enable|
|THD2_ETA_EN|23:16|0|RWHW|Enable control for software thread2<br>event_type0~7 in event trace agent<br>0 means disable; 1 means enable|
|THD1_ETA_EN|15:8|0|RWHW|Enable control for software thread1<br>event_type0~7 in event trace agent<br>0 means disable; 1 means enable|
|THD0_ETA_EN|7:0|0|RWHW|Enable control for software thread0<br>event_type0~7 in event trace agent<br>0 means disable; 1 means enable|

### 13.71. ETA_CTRL1

**Register Name:** `ETA_CTRL1`

- **Offset Address:** `0x6A4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THD7_ETA_EN|31:24|0|RWHW|Enable control for software thread7<br>event_type0~7 in event trace agent<br>0 means disable; 1 means enable|
|THD6_ETA_EN|23:16|0|RWHW|Enable control for software thread6<br>event_type0~7 in event trace agent<br>0 means disable; 1 means enable|
|THD5_ETA_EN|15:8|0|RWHW|Enable control for software thread5<br>event_type0~7 in event trace agent<br>0 means disable; 1 means enable|
|THD4_ETA_EN|7:0|0|RWHW|Enable control for software thread4<br>event_type0~7 in event trace agent<br>0 means disable; 1 means enable|

### 13.72. ETA_CTRL2

**Register Name:** `ETA_CTRL2`

- **Offset Address:** `0x6A8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THD11_ETA_EN|31:24|0|RWHW|Reserved|
|THD10_ETA_EN|23:16|0|RWHW|Reserved|
|THD9_ETA_EN|15:8|0|RWHW|Enable control for software thread9<br>event_type0~7 in event trace agent<br>0 means disable; 1 means enable|
|THD8_ETA_EN|7:0|0|RWHW|Enable control for software thread8<br>event_type0~7 in event trace agent<br>0 means disable; 1 means enable|

### 13.73. ETA_CTRL3

**Register Name:** `ETA_CTRL3`

- **Offset Address:** `0x6AC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THD15_ETA_EN|31:24|0|RWHW|Reserved|
|THD14_ETA_EN|23:16|0|RWHW|Reserved|

### 13.74. MODE_WRK

**Register Name:** `MODE_WRK`

- **Offset Address:** `0x700`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BF16_OVCLP|18:18|0|RO|If set, an overflowed BF16 result is clamped to<br>+/- MAX_BF16, regardless of round mode,<br>while still preserving true INF values.<br>For floating point, clamp happens at final step<br>and final result, no intermediate result<br>clamping.<br>This field is enabled again in Scorpio/Libra SIP<br>for MOP serial instructions.|
|INT_OVCLP|17:17|0|RO|If set, an overflowed Integer result is clamped<br>to +/- MAX, inexact flag will be raised, e.g.<br>TransfF2I<br>Integer keep precision during whole<br>operation, clamp happening at last step for<br>final result.<br>This is not supposed to be used anymore and<br>SW should leave it as 0.<br>INT_OVCLP cannot affect SALU calculation<br>instructions except TRSI2I|
|FP16_OVCLP|16:16|0|RO|If set, an overflowed FP16 result is clamped to<br>+/- MAX_FP16, regardless of round mode,<br>while still preserving true INF values.<br>For floating point, clamp happens at final step<br>and final result, no intermediate result<br>clamping.<br>This field is enabled again in Scorpio/Libra SIP<br>for MOP serial instructions.|
|FP_DENORM|15:8|3f|RO|[1:0] Half precision handler. [3:2] Single<br>precision handler. [5:4] BF16 handler. [7:6]<br>Reserved.<br>0 = allow input and output denorms.<br>1 = allow input denorms, flush output<br>denorms.<br>2 = flush input denorms, allow output<br>denorms.<br>3 = flush input and output denorms.|
|FP_ROUND|7:0|0|RO|[1:0] Half precision round mode. [3:2] Single<br>precision round mode. [5:4] BF16 round<br>mode. [7:6] Reserved.<br>0 = nearest even<br>1 = toward zero<br>Others: Reserved|

### 13.75. IMEM_BASE_LO_WRK

**Register Name:** `IMEM_BASE_LO_WRK`

- **Offset Address:** `0x704`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|IMEM_BASE_LO|31:0|0|RO|{IMEM_BASE_HI, IMEM_BASE_LO & 0x1FFF};<br>UVA_Addr_of_Inst = PC + {IMEM_BASE_HI,<br>IMEM_BASE_LO & 0x1FFF}|

### 13.76. IMEM_BASE_HI_WRK

**Register Name:** `IMEM_BASE_HI_WRK`

- **Offset Address:** `0x708`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|IMEM_BASE_HI|15:0|0|RO|{IMEM_BASE_HI, IMEM_BASE_LO & 0x1FFF};<br>UVA_Addr_of_Inst = PC + {IMEM_BASE_HI,<br>IMEM_BASE_LO & 0x1FFF}|

### 13.77. TRPBA_WRK

**Register Name:** `TRPBA_WRK`

- **Offset Address:** `0x70C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TRPBA|31:0|0|RO|Trap Base Address config register for trap handler|

### 13.78. LCHBA_WRK

**Register Name:** `LCHBA_WRK`

- **Offset Address:** `0x710`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|LCHBA|31:0|0|RO|Kernel Launch Base Address config register, hold<br>point for interrupt handler. Since SIP is 8 byte to<br>fetch Ins, so the [2:0] is don't care.|

### 13.79. LAUNCH_WRK

**Register Name:** `LAUNCH_WRK`

- **Offset Address:** `0x714`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_OACC|25:16|0|RO|Required OACC number for one VPT of<br>one sub-thread.<br>Range 0~768, should align to 4.|
|SUB_THREAD_NUM|15:12|0|RO|SUB-thread number to be launch in<br>this kernel.<br>Real number = SUB_THREAD_NUM + 1|
|THREAD_TYPE|9:8|0|RO|SW thread type<br>1: ISA4.0 single VPT thread with GEMM<br>or Supervisor<br>3: ISA3.2 dual VPT thread|
|DISABLE_VACC_HASH|4:4|0|RO|Reserved.|
|INVALID_ICACHE|0:0|0|RO|Invalid Icache with current KSID & ASID<br>when thread start. Updated in Libra<br>SIP|

### 13.80. PACKAGE_ID_WRK

**Register Name:** `PACKAGE_ID_WRK`

- **Offset Address:** `0x718`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PACKAGE_ID|31:0|0|RO|Package ID for performance profiling|

### 13.81. PROCESS_ID_WRK

**Register Name:** `PROCESS_ID_WRK`

- **Offset Address:** `0x71C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PROCESS_ID|31:0|0|RO|Package ID for performance profiling|

### 13.82. MD0_WRK

**Register Name:** `MD0_WRK`

- **Offset Address:** `0x720`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Memory Base Address 0. Shadow push registers,<br>updates only take effects when system exit HALT<br>state and goes into RUN state|

### 13.83. MD1_WRK

**Register Name:** `MD1_WRK`

- **Offset Address:** `0x724`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Memory Base Address 1. Shadow push registers,<br>updates only take effects when system exit HALT<br>state and goes into RUN state|

### 13.84. MD2_WRK

**Register Name:** `MD2_WRK`

- **Offset Address:** `0x728`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Memory Base Address 2. Shadow push registers,<br>updates only take effects when system exit HALT<br>state and goes into RUN state|

### 13.85. MD3_WRK

**Register Name:** `MD3_WRK`

- **Offset Address:** `0x72C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Memory Base Address 3. Shadow push registers,<br>updates only take effects when system exit HALT<br>state and goes into RUN state|

### 13.86. MD4_WRK

**Register Name:** `MD4_WRK`

- **Offset Address:** `0x730`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Memory Base Address 4. Shadow push registers,<br>updates only take effects when system exit HALT<br>state and goes into RUN state|

### 13.87. MD5_WRK

**Register Name:** `MD5_WRK`

- **Offset Address:** `0x734`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Memory Base Address 5. Shadow push registers,<br>updates only take effects when system exit HALT<br>state and goes into RUN state|

### 13.88. MD6_WRK

**Register Name:** `MD6_WRK`

- **Offset Address:** `0x738`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Memory Base Address 6. Shadow push registers,<br>updates only take effects when system exit HALT<br>state and goes into RUN state|

### 13.89. MD7_WRK

**Register Name:** `MD7_WRK`

- **Offset Address:** `0x73C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Memory Base Address 7. Shadow push registers,<br>updates only take effects when system exit HALT<br>state and goes into RUN state|

### 13.90. MD8_WRK

**Register Name:** `MD8_WRK`

- **Offset Address:** `0x740`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Memory Base Address 8. Shadow push registers,<br>updates only take effects when system exit HALT<br>state and goes into RUN state|

### 13.91. MD9_WRK

**Register Name:** `MD9_WRK`

- **Offset Address:** `0x744`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.92. MD10_WRK

**Register Name:** `MD10_WRK`

- **Offset Address:** `0x748`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.93. MD11_WRK

**Register Name:** `MD11_WRK`

- **Offset Address:** `0x74C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.94. MD12_WRK

**Register Name:** `MD12_WRK`

- **Offset Address:** `0x750`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.95. MD13_WRK

**Register Name:** `MD13_WRK`

- **Offset Address:** `0x754`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.96. MD14_WRK

**Register Name:** `MD14_WRK`

- **Offset Address:** `0x758`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.97. MD15_WRK

**Register Name:** `MD15_WRK`

- **Offset Address:** `0x75C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.98. MD16_WRK

**Register Name:** `MD16_WRK`

- **Offset Address:** `0x760`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.99. MD17_WRK

**Register Name:** `MD17_WRK`

- **Offset Address:** `0x764`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.100. MD18_WRK

**Register Name:** `MD18_WRK`

- **Offset Address:** `0x768`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.101. MD19_WRK

**Register Name:** `MD19_WRK`

- **Offset Address:** `0x76C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.102. MD20_WRK

**Register Name:** `MD20_WRK`

- **Offset Address:** `0x770`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.103. MD21_WRK

**Register Name:** `MD21_WRK`

- **Offset Address:** `0x774`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.104. MD22_WRK

**Register Name:** `MD22_WRK`

- **Offset Address:** `0x778`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.105. MD23_WRK

**Register Name:** `MD23_WRK`

- **Offset Address:** `0x77C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.106. MD24_WRK

**Register Name:** `MD24_WRK`

- **Offset Address:** `0x780`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.107. MD25_WRK

**Register Name:** `MD25_WRK`

- **Offset Address:** `0x784`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.108. MD26_WRK

**Register Name:** `MD26_WRK`

- **Offset Address:** `0x788`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.109. MD27_WRK

**Register Name:** `MD27_WRK`

- **Offset Address:** `0x78C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.110. MD28_WRK

**Register Name:** `MD28_WRK`

- **Offset Address:** `0x790`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.111. MD29_WRK

**Register Name:** `MD29_WRK`

- **Offset Address:** `0x794`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.112. MD30_WRK

**Register Name:** `MD30_WRK`

- **Offset Address:** `0x798`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.113. MD31_WRK

**Register Name:** `MD31_WRK`

- **Offset Address:** `0x79C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BA|31:0|0|RO|Shadow push registers, updates only take effects<br>when system exit HALT state and goes into RUN<br>state|

### 13.114. ASID_WRK

**Register Name:** `ASID_WRK`

- **Offset Address:** `0x7A0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ASID|3:0|0|RO|The ASID for current thread|

### 13.115. KSID_WRK

**Register Name:** `KSID_WRK`

- **Offset Address:** `0x7A4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|KSID|5:0|0|RO|The KSID for current thread|

### 13.116. PARAM_WRK

**Register Name:** `PARAM_WRK`

- **Offset Address:** `0x7A8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PARAM_ADDR|26:16|0|RO|Parameter start address in SDMEM.<br>SDMEM_PHYSICAL_ADDR = PARAM_ADDR *<br>128B<br>PARAM_VIRTUAL_ADDR = 0x1_4000_0000 +<br>PARAM_ADDR * 128B<br>Valid range: 0-0x3FF|
|PARAM_SIZE|10:0|0|RO|Parameter buffer size = PARAM_SIZE * 128B<br>Valid range: 0-0x400|

### 13.117. SUB_THD_ID_WRK

**Register Name:** `SUB_THD_ID_WRK`

- **Offset Address:** `0x7AC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SUB_THD_ID|31:0|0|RO|SUB_THD_ID for each sub-thread. Increased<br>from the first ID|

### 13.118. PC

**Register Name:** `PC`

- **Offset Address:** `0x7B0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PC|31:0|0|RO|PC of current inst|

### 13.119. HW_STS

**Register Name:** `HW_STS`

- **Offset Address:** `0x7B4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BRKP_HIT|21:20|0|W1C|Sticky bit. Set as 1 when SIP enter debug<br>mode or trap handler for breakpoint1 hit.<br>Sticky bit. Set as 1 when SIP enter debug<br>mode or trap handler for breakpoint0 hit.|
|WAIT_ID|15:8|0|RO|Indicates mailbox ID.|
|WAIT_GSYNC|5:5|0|RO|Indicates whether it is waiting GSYNC<br>mailbox or not when PLC_FSM=WAIT|
|DBG_MODE|4:4|0|RO|0: Normal mode<br>1: Debug mode.|
|PLC_FSM|3:0|0|RO|0: HALT<br>1: RUN<br>2: WAIT<br>For other value pelase check PLC Spec|

### 13.120. EXCP_PC

**Register Name:** `EXCP_PC`

- **Offset Address:** `0x7B8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|EXCP_PC|31:0|0|RO|Capture Exception PC when corresponding<br>exception is triggered and exception trap is<br>taken.|

### 13.121. EXCP_BIT_EN

**Register Name:** `EXCP_BIT_EN`

- **Offset Address:** `0x7BC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|1073f3ff|RWHW|Per-exception-event enable bit. If a bit is 1 and<br>corresponding exception status bit in EXCP_STS<br>is also 1, then program will transfer control to<br>exception handler.<br>[0] EXCP_IMEM_RAS_ERR<br>[1] EXCP_VDMEM_RAS_ERR<br>[2] EXCP_SDMEM_RAS_ERR<br>[3] EXCP_VARAM_RAS_ERR<br>[4] EXCP_SRTAR_RAS_ERR<br>[5] EXCP_IVSMR_RAS_ERR<br>[6] EXCP_S3INST_RAS_ERR<br>[7] EXCP_L1CTRL_RAS_ERR<br>[8] EXCP_L1DATA_RAS_ERR<br>[9] EXCP_CF_RAS_ERR<br>[10] EXCP_DF_RAS_ERR<br>[12] EXCP_ILL_IS<br>[14] EXCP_ADDR_INVALID<br>[15] EXCP_CF_RESP_ERR<br>[16] EXCP_DF_RESP_ERR<br>[20] EXCP_ICACHE_DF_RAS_ERR<br>[21] EXCP_ICACHE_DF_RESP_ERR<br>[22] EXCP_ICACHE_MISS_VICTIM_ERR<br>other Reserved|

### 13.122. EXCP_STS

**Register Name:** `EXCP_STS`

- **Offset Address:** `0x7C0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|W1C|When exception is occurred and NOT in trap<br>handler process, the exception is captured in this<br>register for each event individually. 1 means<br>corresponding events happened, 0 means not.<br>Once captured as 1, it will be kepted as 1 until SW<br>clearing it.<br>[0] EXCP_IMEM_RAS_ERR<br>[1] EXCP_VDMEM_RAS_ERR<br>[2] EXCP_SDMEM_RAS_ERR<br>[3] EXCP_VARAM_RAS_ERR<br>[4] EXCP_SRTAR_RAS_ERR<br>[5] EXCP_IVSMR_RAS_ERR<br>[6] EXCP_S3INST_RAS_ERR<br>[7] EXCP_L1CTRL_RAS_ERR<br>[8] EXCP_L1DATA_RAS_ERR<br>[9] EXCP_CF_RAS_ERR<br>[10] EXCP_DF_RAS_ERR<br>[12] EXCP_ILL_IS<br>[14] EXCP_ADDR_INVALID<br>[15] EXCP_CF_RESP_ERR<br>[16] EXCP_DF_RESP_ERR<br>[20] EXCP_ICACHE_DF_RAS_ERR<br>[21] EXCP_ICACHE_DF_RESP_ERR<br>[22] EXCP_ICACHE_MISS_VICTIM_ERR<br>other Reserved|

### 13.123. EXCP_STS_GLB

**Register Name:** `EXCP_STS_GLB`

- **Offset Address:** `0x7C4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|0:0|0|W1C|When EXCP_BIT_EN & EXCP_STS !=0, when HW<br>jumping to exception handler, setting 1. Most<br>exceptions lead to halt.<br>The halt caused by exception will stop next launch on<br>this sub-thread-slot. To launch a new thread,<br>EXCP_STS/EXCP_STS_TH/EXCP_STS_GLB should be<br>cleared.|

### 13.124. EXCP_STS_TH

**Register Name:** `EXCP_STS_TH`

- **Offset Address:** `0x7C8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|W1C|This register is used to record the exceptions<br>triggered in trap handler process. 1 means<br>corresponding events happened, 0 means not.<br>Once captured as 1, it will be kepted as 1 until SW<br>clearing it.<br>[0] EXCP_IMEM_RAS_ERR<br>[1] EXCP_VDMEM_RAS_ERR<br>[2] EXCP_SDMEM_RAS_ERR<br>[3] EXCP_VARAM_RAS_ERR<br>[4] EXCP_SRTAR_RAS_ERR<br>[5] EXCP_IVSMR_RAS_ERR<br>[6] EXCP_S3INST_RAS_ERR<br>[7] EXCP_L1CTRL_RAS_ERR<br>[8] EXCP_L1DATA_RAS_ERR<br>[9] EXCP_CF_RAS_ERR<br>[10] EXCP_DF_RAS_ERR<br>[12] EXCP_ILL_IS<br>[14] EXCP_ADDR_INVALID<br>[15] EXCP_CF_RESP_ERR<br>[16] EXCP_DF_RESP_ERR<br>[20] EXCP_ICACHE_DF_RAS_ERR<br>[21] EXCP_ICACHE_DF_RESP_ERR<br>[22] EXCP_ICACHE_MISS_VICTIM_ERR<br>other Reserved|

### 13.125. RAS_REPAIRED_BIT_EN

**Register Name:** `RAS_REPAIRED_BIT_EN`

- **Offset Address:** `0x7CC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Per-exception-event enable bit. If a bit is 1 and<br>corresponding ECC single bit repairing status bit<br>in RAS_REPAIRED_STS is also 1, then program will<br>stop auto-launch after a normal halt.<br>[0] RAS_REPAIRED_IMEM<br>[1] RAS_REPAIRED_SDMEM<br>[2] RAS_REPAIRED_VDMEM<br>[3] RAS_REPAIRED_IVSMR<br>[8] RAS_REPAIRED_DF0_MST<br>[9] RAS_REPAIRED_DF0_SLV<br>[10] RAS_REPAIRED_DF1_MST<br>[12] RAS_REPAIRED_DF1_SLV<br>[13] RAS_REPAIRED_DF2_MST<br>[14] RAS_REPAIRED_DF2_SLV<br>other Reserved|

### 13.126. RAS_REPAIRED_STS

**Register Name:** `RAS_REPAIRED_STS`

- **Offset Address:** `0x7D0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|W1C|When exception is occurred and NOT in trap<br>handler process, the exception is captured in this<br>register for each event individually. 1 means<br>corresponding ECC single bit repairing occured. 0<br>means not.<br>Once captured as 1, it will be kepted as 1 until SW<br>clearing it.<br>[0] RAS_REPAIRED_IMEM<br>[1] RAS_REPAIRED_SDMEM<br>[2] RAS_REPAIRED_VDMEM<br>[3] RAS_REPAIRED_IVSMR<br>[8] RAS_REPAIRED_DF0_MST<br>[9] RAS_REPAIRED_DF0_SLV<br>[10] RAS_REPAIRED_DF1_MST<br>[12] RAS_REPAIRED_DF1_SLV<br>[13] RAS_REPAIRED_DF2_MST<br>[14] RAS_REPAIRED_DF2_SLV<br>other Reserved|

### 13.127. AUX_PC

**Register Name:** `AUX_PC`

- **Offset Address:** `0x7D4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|AUX_PC|31:0|0|RO|Reserved|

### 13.128. WRK_KNL_THD_SEL

**Register Name:** `WRK_KNL_THD_SEL`

- **Offset Address:** `0x7EC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|KNL_SEL|5:4|0|RWHW|Select current kernel slot for working registers<br>whindow<br>Affect from IMEM_BASE_LO_WRK to<br>PARAM_WRK<br>Valid range: 0~1|
|THD_SEL|3:0|0|RWHW|Select current thread slot for working registers<br>whindow<br>Affect from SUB_THREAD_ID_WRK to<br>EXCP_STS_TH and MODE_WRK<br>Valid range: 0~9|

### 13.129. ALL_THD_STS

**Register Name:** `ALL_THD_STS`

- **Offset Address:** `0x7F0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THD_STS|15:0|0|RO|bit9~bit0 indicate if sub-thread9~0 is halt or not<br>0: the thread is halt<br>1: the thread is not halt<br>bit15~bit10 are reserved|

### 13.130. KNL_THD_MAP0

**Register Name:** `KNL_THD_MAP0`

- **Offset Address:** `0x7F4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|KNL1_MAP|31:16|0|RO|Indicate which thread slots are allocated to<br>Kernel-slot-1 in last launch<br>bit9~bit0 indicate each sub-thread-slot.<br>bit15~bit10 are reserved|
|KNL0_MAP|15:0|ffff|RO|Indicate which thread slots are allocated to<br>Kernel-slot-0 in last launch<br>bit9~bit0 indicate each sub-thread-slot.<br>bit15~bit10 are reserved|

### 13.131. KNL_THD_MAP1

**Register Name:** `KNL_THD_MAP1`

- **Offset Address:** `0x7F8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|KNL3_MAP|31:16|0|RO|Indicate which thread slots are allocated to<br>Kernel-slot-3 in last launch<br>bit9~bit0 indicate each sub-thread-slot.<br>bit15~bit10 are reserved|
|KNL2_MAP|15:0|0|RO|Indicate which thread slots are allocated to<br>Kernel-slot-2 in last launch<br>bit9~bit0 indicate each sub-thread-slot.<br>bit15~bit10 are reserved|

### 13.132. BRKP0_BASE_LO

**Register Name:** `BRKP0_BASE_LO`

- **Offset Address:** `0x800`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BASE_LO|31:0|0|RWHW|Low 32bit of 48bit instruction BASE_ADDR for<br>breakpoint0. Bit[11:0] should be all 0|

### 13.133. BRKP0_BASE_HI

**Register Name:** `BRKP0_BASE_HI`

- **Offset Address:** `0x804`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BASE_HI|15:0|0|RWHW|High 16bit of 48bit instruction BASE_ADDR for<br>breakpoint0|

### 13.134. BRKP0_PC

**Register Name:** `BRKP0_PC`

- **Offset Address:** `0x808`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BRKP_PC|31:0|0|RWHW|32bit PC for breakpoint0. Bit[3:0] should be all<br>0|

### 13.135. BRKP0_CTRL

**Register Name:** `BRKP0_CTRL`

- **Offset Address:** `0x80C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ASID|7:4|0|RWHW|ASID for breakpoint|
|EN|0:0|0|RWHW|1: enable breakpoint0, 0: disable breakpoint0|

### 13.136. BRKP1_BASE_LO

**Register Name:** `BRKP1_BASE_LO`

- **Offset Address:** `0x810`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BASE_LO|31:0|0|RWHW|Low 32bit of 48bit instruction BASE_ADDR for<br>breakpoint1. Bit[11:0] should be all 0|

### 13.137. BRKP1_BASE_HI

**Register Name:** `BRKP1_BASE_HI`

- **Offset Address:** `0x814`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BASE_HI|15:0|0|RWHW|High 16bit of 48bit instruction BASE_ADDR for<br>breakpoint1|

### 13.138. BRKP1_PC

**Register Name:** `BRKP1_PC`

- **Offset Address:** `0x818`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BRKP_PC|31:0|0|RWHW|32bit PC for breakpoint1. Bit[3:0] should be all<br>0|

### 13.139. BRKP1_CTRL

**Register Name:** `BRKP1_CTRL`

- **Offset Address:** `0x81C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ASID|7:4|0|RWHW|ASID for breakpoint|
|EN|0:0|0|RWHW|1: enable breakpoint1, 0: disable breakpoint1|

### 13.140. DBG_BUF0

**Register Name:** `DBG_BUF0`

- **Offset Address:** `0x820`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|INS_VAL|31:0|0|RWHW|Instruction buf0 for DBG usage|

### 13.141. DBG_BUF1

**Register Name:** `DBG_BUF1`

- **Offset Address:** `0x824`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|INS_VAL|31:0|0|RWHW|Instruction buf1 for DBG usage|

### 13.142. DBG_BUF2

**Register Name:** `DBG_BUF2`

- **Offset Address:** `0x828`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|INS_VAL|31:0|0|RWHW|Instruction buf2 for DBG usage|

### 13.143. DBG_BUF3

**Register Name:** `DBG_BUF3`

- **Offset Address:** `0x82C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|INS_VAL|31:0|0|RWHW|Instruction buf3 for DBG usage|

### 13.144. DBG_CMD

**Register Name:** `DBG_CMD`

- **Offset Address:** `0x830`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THD_SLOT_BIT_SEL|31:16|0|RWHW|each 1 in bit31-bit16 means the<br>debugging command will be execute<br>on which thread-slot.<br>So one debugging command can<br>triggers 1~16 thread-slots in<br>simultaneously.<br>Note: when excecute STEP_DCMD,<br>this field should select only one<br>thread-slot.|
|WR_ARF|4:4|0|RWHW|1: when executing STEP_DCMD, write<br>the SR result to real architecture<br>resources instead of<br>DBG_RDATA1/DBG_RDATA0,<br>0: when executing STEP_DCMD, write<br>the SR result to<br>DBG_RDATA1/DBG_RDATA0 (based<br>on index) instead of architecture<br>results|
|CMD|2:0|0|RWHW|0: NULL<br>1: STEP_CODE<br>2: STEP_DCMD<br>4: STOP<br>5: RESUME<br>6: FORCE<br>7: STEP_HALT<br>Others: Reserved<br>After writing this field with non-0<br>value, HW will start to handle the<br>command and will clear it to NULL<br>when finished; SW should pull this<br>field until it reaches NULL, then read<br>the result from<br>DBG_RDATA1/DBG_RDATA0.|

### 13.145. DBG_RDATA0

**Register Name:** `DBG_RDATA0`

- **Offset Address:** `0x834`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DATA_LO|31:0|0|RO|Low 32bit of SR write data for DBG usage.|

### 13.146. DBG_RDATA1

**Register Name:** `DBG_RDATA1`

- **Offset Address:** `0x838`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DATA_HI|31:0|0|RO|High 32bit of SR write data for DBG usage.|

### 13.147. AWP0_PLC_ADDR_LO

**Register Name:** `AWP0_PLC_ADDR_LO`

- **Offset Address:** `0x840`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ADDR_LO|31:0|0|RWHW|Reserved. This register is no longer used.|

### 13.148. AWP0_PLC_ADDR_HI

**Register Name:** `AWP0_PLC_ADDR_HI`

- **Offset Address:** `0x844`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ADDR_HI|15:0|0|RWHW|Reserved. This register is no longer used.|

### 13.149. AWP0_PLC_MASK

**Register Name:** `AWP0_PLC_MASK`

- **Offset Address:** `0x848`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CMP_MASK|5:0|0|RWHW|Reserved. This register is no longer used.|

### 13.150. AWP0_PLC_CTRL

**Register Name:** `AWP0_PLC_CTRL`

- **Offset Address:** `0x84C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ASID|7:4|0|RWHW|Reserved. This register is no longer used.|
|CMP_EN|0:0|0|RWHW|Reserved. This register is no longer used.|

### 13.151. AWP1_PLC_ADDR_LO

**Register Name:** `AWP1_PLC_ADDR_LO`

- **Offset Address:** `0x850`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ADDR_LO|31:0|0|RWHW|Reserved. This register is no longer used.|

### 13.152. AWP1_PLC_ADDR_HI

**Register Name:** `AWP1_PLC_ADDR_HI`

- **Offset Address:** `0x854`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ADDR_HI|15:0|0|RWHW|Reserved. This register is no longer used.|

### 13.153. AWP1_PLC_MASK

**Register Name:** `AWP1_PLC_MASK`

- **Offset Address:** `0x858`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CMP_MASK|5:0|0|RWHW|Reserved. This register is no longer used.|

### 13.154. AWP1_PLC_CTRL

**Register Name:** `AWP1_PLC_CTRL`

- **Offset Address:** `0x85C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ASID|7:4|0|RWHW|Reserved. This register is no longer used.|
|CMP_EN|3:3|0|RWHW|Reserved. This register is no longer used.|

### 13.155. DBG_MODE_THD0_STS

**Register Name:** `DBG_MODE_THD0_STS`

- **Offset Address:** `0x880`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DBG_MODE|21:21|0|RO|0: Normal mode<br>1: Debug mode.|
|PLC_FSM|19:16|0|RO|0: HALT<br>1: RUN<br>2: WAIT<br>For of other value pelase check PLC<br>Spec|
|DBG_MODE_AWP_IDX|9:8|0|RO|Indicates which comparator<br>matched for address watchpoint.<br>Each one bit represent one address<br>watchpoint comparator.|
|DBG_MODE_BRKP_IDX|5:4|0|RO|Indicates which comparator<br>matched for HW breakpoint and<br>watchpoint.<br>Each one bit represent one HW<br>breakpoint comparator.|
|DBG_MODE_CAUSE|3:0|0|W1C|Indicates the cause of thread0 PLC<br>entering debug mode.<br>bit 0: HW breakpoint<br>bit 1: Address watchpoint hit on<br>memory write<br>bit 2: TRAP0 instruction<br>bit 3: STOP command<br>Others: Reserved|

### 13.156. DBG_MODE_THD0_PC

**Register Name:** `DBG_MODE_THD0_PC`

- **Offset Address:** `0x884`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PC|31:0|0|RO|Indicates PC of the instruction of thread0 that<br>makes SIP enter debug mode|

### 13.157. DBG_MODE_THD1_STS

**Register Name:** `DBG_MODE_THD1_STS`

- **Offset Address:** `0x888`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DBG_MODE|21:21|0|RO|0: Normal mode<br>1: Debug mode.|
|PLC_FSM|19:16|0|RO|0: HALT<br>1: RUN<br>2: WAIT<br>For of other value pelase check PLC<br>Spec|
|DBG_MODE_AWP_IDX|9:8|0|RO|Indicates which comparator<br>matched for address watchpoint.<br>Each one bit represent one address<br>watchpoint comparator.|
|DBG_MODE_BRKP_IDX|5:4|0|RO|Indicates which comparator<br>matched for HW breakpoint and<br>watchpoint.<br>Each one bit represent one HW<br>breakpoint comparator.|
|DBG_MODE_CAUSE|3:0|0|W1C|Indicates the cause of thread0 PLC<br>entering debug mode.<br>bit 0: HW breakpoint<br>bit 1: Address watchpoint hit on<br>memory write<br>bit 2: TRAP0 instruction<br>bit 3: STOP command<br>Others: Reserved|

### 13.158. DBG_MODE_THD1_PC

**Register Name:** `DBG_MODE_THD1_PC`

- **Offset Address:** `0x88C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PC|31:0|0|RO|Indicates PC of the instruction of thread0 that<br>makes SIP enter debug mode|

### 13.159. DBG_MODE_THD2_STS

**Register Name:** `DBG_MODE_THD2_STS`

- **Offset Address:** `0x890`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DBG_MODE|21:21|0|RO|0: Normal mode<br>1: Debug mode.|
|PLC_FSM|19:16|0|RO|0: HALT<br>1: RUN<br>2: WAIT<br>For of other value pelase check PLC<br>Spec|
|DBG_MODE_AWP_IDX|9:8|0|RO|Indicates which comparator<br>matched for address watchpoint.<br>Each one bit represent one address<br>watchpoint comparator.|
|DBG_MODE_BRKP_IDX|5:4|0|RO|Indicates which comparator<br>matched for HW breakpoint and<br>watchpoint.<br>Each one bit represent one HW<br>breakpoint comparator.|
|DBG_MODE_CAUSE|3:0|0|W1C|Indicates the cause of thread0 PLC<br>entering debug mode.<br>bit 0: HW breakpoint<br>bit 1: Address watchpoint hit on<br>memory write<br>bit 2: TRAP0 instruction<br>bit 3: STOP command<br>Others: Reserved|

### 13.160. DBG_MODE_THD2_PC

**Register Name:** `DBG_MODE_THD2_PC`

- **Offset Address:** `0x894`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PC|31:0|0|RO|Indicates PC of the instruction of thread0 that<br>makes SIP enter debug mode|

### 13.161. DBG_MODE_THD3_STS

**Register Name:** `DBG_MODE_THD3_STS`

- **Offset Address:** `0x898`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DBG_MODE|21:21|0|RO|0: Normal mode<br>1: Debug mode.|
|PLC_FSM|19:16|0|RO|0: HALT<br>1: RUN<br>2: WAIT<br>For of other value pelase check PLC<br>Spec|
|DBG_MODE_AWP_IDX|9:8|0|RO|Indicates which comparator<br>matched for address watchpoint.<br>Each one bit represent one address<br>watchpoint comparator.|
|DBG_MODE_BRKP_IDX|5:4|0|RO|Indicates which comparator<br>matched for HW breakpoint and<br>watchpoint.<br>Each one bit represent one HW<br>breakpoint comparator.|
|DBG_MODE_CAUSE|3:0|0|W1C|Indicates the cause of thread0 PLC<br>entering debug mode.<br>bit 0: HW breakpoint<br>bit 1: Address watchpoint hit on<br>memory write<br>bit 2: TRAP0 instruction<br>bit 3: STOP command<br>Others: Reserved|

### 13.162. DBG_MODE_THD3_PC

**Register Name:** `DBG_MODE_THD3_PC`

- **Offset Address:** `0x89C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PC|31:0|0|RO|Indicates PC of the instruction of thread0 that<br>makes SIP enter debug mode|

### 13.163. DBG_MODE_THD4_STS

**Register Name:** `DBG_MODE_THD4_STS`

- **Offset Address:** `0x8A0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DBG_MODE|21:21|0|RO|0: Normal mode<br>1: Debug mode.|
|PLC_FSM|19:16|0|RO|0: HALT<br>1: RUN<br>2: WAIT<br>For of other value pelase check PLC<br>Spec|
|DBG_MODE_AWP_IDX|9:8|0|RO|Indicates which comparator<br>matched for address watchpoint.<br>Each one bit represent one address<br>watchpoint comparator.|
|DBG_MODE_BRKP_IDX|5:4|0|RO|Indicates which comparator<br>matched for HW breakpoint and<br>watchpoint.<br>Each one bit represent one HW<br>breakpoint comparator.|
|DBG_MODE_CAUSE|3:0|0|W1C|Indicates the cause of thread0 PLC<br>entering debug mode.<br>bit 0: HW breakpoint<br>bit 1: Address watchpoint hit on<br>memory write<br>bit 2: TRAP0 instruction<br>bit 3: STOP command<br>Others: Reserved|

### 13.164. DBG_MODE_THD4_PC

**Register Name:** `DBG_MODE_THD4_PC`

- **Offset Address:** `0x8A4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PC|31:0|0|RO|Indicates PC of the instruction of thread0 that<br>makes SIP enter debug mode|

### 13.165. DBG_MODE_THD5_STS

**Register Name:** `DBG_MODE_THD5_STS`

- **Offset Address:** `0x8A8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DBG_MODE|21:21|0|RO|0: Normal mode<br>1: Debug mode.|
|PLC_FSM|19:16|0|RO|0: HALT<br>1: RUN<br>2: WAIT<br>For of other value pelase check PLC<br>Spec|
|DBG_MODE_AWP_IDX|9:8|0|RO|Indicates which comparator<br>matched for address watchpoint.<br>Each one bit represent one address<br>watchpoint comparator.|
|DBG_MODE_BRKP_IDX|5:4|0|RO|Indicates which comparator<br>matched for HW breakpoint and<br>watchpoint.<br>Each one bit represent one HW<br>breakpoint comparator.|
|DBG_MODE_CAUSE|3:0|0|W1C|Indicates the cause of thread0 PLC<br>entering debug mode.<br>bit 0: HW breakpoint<br>bit 1: Address watchpoint hit on<br>memory write<br>bit 2: TRAP0 instruction<br>bit 3: STOP command<br>Others: Reserved|

### 13.166. DBG_MODE_THD5_PC

**Register Name:** `DBG_MODE_THD5_PC`

- **Offset Address:** `0x8AC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PC|31:0|0|RO|Indicates PC of the instruction of thread0 that<br>makes SIP enter debug mode|

### 13.167. DBG_MODE_THD6_STS

**Register Name:** `DBG_MODE_THD6_STS`

- **Offset Address:** `0x8B0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DBG_MODE|21:21|0|RO|0: Normal mode<br>1: Debug mode.|
|PLC_FSM|19:16|0|RO|0: HALT<br>1: RUN<br>2: WAIT<br>For of other value pelase check PLC<br>Spec|
|DBG_MODE_AWP_IDX|9:8|0|RO|Indicates which comparator<br>matched for address watchpoint.<br>Each one bit represent one address<br>watchpoint comparator.|
|DBG_MODE_BRKP_IDX|5:4|0|RO|Indicates which comparator<br>matched for HW breakpoint and<br>watchpoint.<br>Each one bit represent one HW<br>breakpoint comparator.|
|DBG_MODE_CAUSE|3:0|0|W1C|Indicates the cause of thread0 PLC<br>entering debug mode.<br>bit 0: HW breakpoint<br>bit 1: Address watchpoint hit on<br>memory write<br>bit 2: TRAP0 instruction<br>bit 3: STOP command<br>Others: Reserved|

### 13.168. DBG_MODE_THD6_PC

**Register Name:** `DBG_MODE_THD6_PC`

- **Offset Address:** `0x8B4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PC|31:0|0|RO|Indicates PC of the instruction of thread0 that<br>makes SIP enter debug mode|

### 13.169. DBG_MODE_THD7_STS

**Register Name:** `DBG_MODE_THD7_STS`

- **Offset Address:** `0x8B8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DBG_MODE|21:21|0|RO|0: Normal mode<br>1: Debug mode.|
|PLC_FSM|19:16|0|RO|0: HALT<br>1: RUN<br>2: WAIT<br>For of other value pelase check PLC<br>Spec|
|DBG_MODE_AWP_IDX|9:8|0|RO|Indicates which comparator<br>matched for address watchpoint.<br>Each one bit represent one address<br>watchpoint comparator.|
|DBG_MODE_BRKP_IDX|5:4|0|RO|Indicates which comparator<br>matched for HW breakpoint and<br>watchpoint.<br>Each one bit represent one HW<br>breakpoint comparator.|
|DBG_MODE_CAUSE|3:0|0|W1C|Indicates the cause of thread0 PLC<br>entering debug mode.<br>bit 0: HW breakpoint<br>bit 1: Address watchpoint hit on<br>memory write<br>bit 2: TRAP0 instruction<br>bit 3: STOP command<br>Others: Reserved|

### 13.170. DBG_MODE_THD7_PC

**Register Name:** `DBG_MODE_THD7_PC`

- **Offset Address:** `0x8BC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PC|31:0|0|RO|Indicates PC of the instruction of thread0 that<br>makes SIP enter debug mode|

### 13.171. DBG_MODE_THD8_STS

**Register Name:** `DBG_MODE_THD8_STS`

- **Offset Address:** `0x8C0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DBG_MODE|21:21|0|RO|0: Normal mode<br>1: Debug mode.|
|PLC_FSM|19:16|0|RO|0: HALT<br>1: RUN<br>2: WAIT<br>For of other value pelase check PLC<br>Spec|
|DBG_MODE_AWP_IDX|9:8|0|RO|Indicates which comparator<br>matched for address watchpoint.<br>Each one bit represent one address<br>watchpoint comparator.|
|DBG_MODE_BRKP_IDX|5:4|0|RO|Indicates which comparator<br>matched for HW breakpoint and<br>watchpoint.<br>Each one bit represent one HW<br>breakpoint comparator.|
|DBG_MODE_CAUSE|3:0|0|W1C|Indicates the cause of thread0 PLC<br>entering debug mode.<br>bit 0: HW breakpoint<br>bit 1: Address watchpoint hit on<br>memory write<br>bit 2: TRAP0 instruction<br>bit 3: STOP command<br>Others: Reserved|

### 13.172. DBG_MODE_THD8_PC

**Register Name:** `DBG_MODE_THD8_PC`

- **Offset Address:** `0x8C4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PC|31:0|0|RO|Indicates PC of the instruction of thread0 that<br>makes SIP enter debug mode|

### 13.173. DBG_MODE_THD9_STS

**Register Name:** `DBG_MODE_THD9_STS`

- **Offset Address:** `0x8C8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DBG_MODE|21:21|0|RO|0: Normal mode<br>1: Debug mode.|
|PLC_FSM|19:16|0|RO|0: HALT<br>1: RUN<br>2: WAIT<br>For of other value pelase check PLC<br>Spec|
|DBG_MODE_AWP_IDX|9:8|0|RO|Indicates which comparator<br>matched for address watchpoint.<br>Each one bit represent one address<br>watchpoint comparator.|
|DBG_MODE_BRKP_IDX|5:4|0|RO|Indicates which comparator<br>matched for HW breakpoint and<br>watchpoint.<br>Each one bit represent one HW<br>breakpoint comparator.|
|DBG_MODE_CAUSE|3:0|0|W1C|Indicates the cause of thread0 PLC<br>entering debug mode.<br>bit 0: HW breakpoint<br>bit 1: Address watchpoint hit on<br>memory write<br>bit 2: TRAP0 instruction<br>bit 3: STOP command<br>Others: Reserved|

### 13.174. DBG_MODE_THD9_PC

**Register Name:** `DBG_MODE_THD9_PC`

- **Offset Address:** `0x8CC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PC|31:0|0|RO|Indicates PC of the instruction of thread0 that<br>makes SIP enter debug mode|

### 13.175. DBG_MODE_THD10_STS

**Register Name:** `DBG_MODE_THD10_STS`

- **Offset Address:** `0x8D0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DBG_MODE|21:21|0|RO|Reserved|
|PLC_FSM|19:16|0|RO|Reserved|
|DBG_MODE_AWP_IDX|9:8|0|RO|Reserved|
|DBG_MODE_BRKP_IDX|5:4|0|RO|Reserved|
|DBG_MODE_CAUSE|3:0|0|W1C|Reserved|

### 13.176. DBG_MODE_THD10_PC

**Register Name:** `DBG_MODE_THD10_PC`

- **Offset Address:** `0x8D4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PC|31:0|0|RO|Reserved|

### 13.177. DBG_MODE_THD11_STS

**Register Name:** `DBG_MODE_THD11_STS`

- **Offset Address:** `0x8D8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DBG_MODE|21:21|0|RO|Reserved|
|PLC_FSM|19:16|0|RO|Reserved|
|DBG_MODE_AWP_IDX|9:8|0|RO|Reserved|
|DBG_MODE_BRKP_IDX|5:4|0|RO|Reserved|
|DBG_MODE_CAUSE|3:0|0|W1C|Reserved|

### 13.178. DBG_MODE_THD11_PC

**Register Name:** `DBG_MODE_THD11_PC`

- **Offset Address:** `0x8DC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PC|31:0|0|RO|Reserved|

### 13.179. DBG_MODE_THD12_STS

**Register Name:** `DBG_MODE_THD12_STS`

- **Offset Address:** `0x8E0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DBG_MODE|21:21|0|RO|Reserved|
|PLC_FSM|19:16|0|RO|Reserved|
|DBG_MODE_AWP_IDX|9:8|0|RO|Reserved|
|DBG_MODE_BRKP_IDX|5:4|0|RO|Reserved|
|DBG_MODE_CAUSE|3:0|0|W1C|Reserved|

### 13.180. DBG_MODE_THD12_PC

**Register Name:** `DBG_MODE_THD12_PC`

- **Offset Address:** `0x8E4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PC|31:0|0|RO|Reserved|

### 13.181. DBG_MODE_THD13_STS

**Register Name:** `DBG_MODE_THD13_STS`

- **Offset Address:** `0x8E8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DBG_MODE|21:21|0|RO|Reserved|
|PLC_FSM|19:16|0|RO|Reserved|
|DBG_MODE_AWP_IDX|9:8|0|RO|Reserved|
|DBG_MODE_BRKP_IDX|5:4|0|RO|Reserved|
|DBG_MODE_CAUSE|3:0|0|W1C|Reserved|

### 13.182. DBG_MODE_THD13_PC

**Register Name:** `DBG_MODE_THD13_PC`

- **Offset Address:** `0x8EC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PC|31:0|0|RO|Reserved|

### 13.183. DBG_MODE_THD14_STS

**Register Name:** `DBG_MODE_THD14_STS`

- **Offset Address:** `0x8F0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DBG_MODE|21:21|0|RO|Reserved|
|PLC_FSM|19:16|0|RO|Reserved|
|DBG_MODE_AWP_IDX|9:8|0|RO|Reserved|
|DBG_MODE_BRKP_IDX|5:4|0|RO|Reserved|
|DBG_MODE_CAUSE|3:0|0|W1C|Reserved|

### 13.184. DBG_MODE_THD14_PC

**Register Name:** `DBG_MODE_THD14_PC`

- **Offset Address:** `0x8F4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PC|31:0|0|RO|Reserved|

### 13.185. DBG_MODE_THD15_STS

**Register Name:** `DBG_MODE_THD15_STS`

- **Offset Address:** `0x8F8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DBG_MODE|21:21|0|RO|Reserved|
|PLC_FSM|19:16|0|RO|Reserved|
|DBG_MODE_AWP_IDX|9:8|0|RO|Reserved|
|DBG_MODE_BRKP_IDX|5:4|0|RO|Reserved|
|DBG_MODE_CAUSE|3:0|0|W1C|Reserved|

### 13.186. DBG_MODE_THD15_PC

**Register Name:** `DBG_MODE_THD15_PC`

- **Offset Address:** `0x8FC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PC|31:0|0|RO|Reserved|

### 13.187. SIP_ID

**Register Name:** `SIP_ID`

- **Offset Address:** `0x900`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SIC_ID|7:4|0|RWHW|SIP logic SIC ID. Valid range: 0~7|
|SIP_ID|3:0|0|RWHW|SIP logic ID after harvest. Valid range: 0~7|

### 13.188. CLK_CTL

**Register Name:** `CLK_CTL`

- **Offset Address:** `0x904`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BRG_BLCG_DISABLE|21:21|1|RWHW|1: disable BLCG function for<br>AXI bridge. 0: enable BLCG<br>function for AXI bridge|
|BRG_IDLE_DELAY|19:16|f|RWHW|Clock gating enable delay for<br>AXI bridge. Clock will be<br>shutdown after IDLE_DELAY+1<br>cycles when IP entering idle<br>status.|
|XPU_MALU_SW_CLK_EN|13:13|1|RWHW|Static clock switch for MALUs<br>in XPU. 1: enable clock; 0:<br>disable clock<br>When IP want to shutdown<br>clock of sub_block, set it to<br>1'b0; otherwise it should be<br>1'b1.|
|XPU_MALU_BLCG_DISABLE|12:12|1|RWHW|1: disable BLCG function for<br>MALUs in XPU. 0: enable BLCG<br>function for MALUs in XPU|
|XPU_MALU_IDLE_DELAY|11:8|f|RWHW|Clock gating enable delay for<br>MALUs in XPU. Clock will be<br>shutdown after IDLE_DELAY+1<br>cycles when IP entering idle<br>status.|
|XPU_SW_CLK_EN|5:5|1|RWHW|Reserved|
|XPU_BLCG_DISABLE|4:4|1|RWHW|Reserved|
|XPU_IDLE_DELAY|3:0|f|RWHW|Clock gating enable delay for<br>XPU. Clock will be shutdown<br>after IDLE_DELAY+1 cycles<br>when IP entering idle status.|

### 13.189. VACC_HASH_MASK0

**Register Name:** `VACC_HASH_MASK0`

- **Offset Address:** `0x908`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VACC_MASK0|7:0|0|RWHW|Hash mask for VACC_index[3](A.K.A<br>OACC_index[0])<br>VACC_hashed_index[3] =<br>(^(VACC_inst_index[12:3] &<br>concate(VACC_HASH_MASK2[1:0],<br>VACC_HASH_MASK0[7:0])));|

### 13.190. VACC_HASH_MASK1

**Register Name:** `VACC_HASH_MASK1`

- **Offset Address:** `0x90C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VACC_MASK1|7:0|0|RWHW|Hash mask for VACC_index[4] (A.K.A<br>OACC_index[1])<br>VACC_hashed_index[4] =<br>(^(VACC_inst_index[12:3] &<br>concate(VACC_HASH_MASK2[5:4],<br>VACC_HASH_MASK1[7:0])));|

### 13.191. VACC_HASH_MASK2

**Register Name:** `VACC_HASH_MASK2`

- **Offset Address:** `0x910`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VACC_MASK2|7:0|0|RWHW|Hash mask for VACC_index[4:3] (A.K.A<br>OACC_index[1:0])<br>VACC_hashed_index[3] =<br>(^(VACC_inst_index[12:3] &<br>concate(VACC_HASH_MASK2[1:0],<br>VACC_HASH_MASK0[7:0])));<br>VACC_hashed_index[4] =<br>(^(VACC_inst_index[12:3] &<br>concate(VACC_HASH_MASK2[5:4],<br>VACC_HASH_MASK1[7:0])));|

### 13.192. SDMEM_HASH_MASK0

**Register Name:** `SDMEM_HASH_MASK0`

- **Offset Address:** `0x914`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SDMEM_MASK0|8:0|0|RWHW|Hash mask for SDMEM bank select;<br>SDMEM_bank_select[0] = SDMEM_addr[6]<br>^ (^(SDMEM_addr[17:9] &<br>SDMEM_MASK0[8:0]));|

### 13.193. SDMEM_HASH_MASK1

**Register Name:** `SDMEM_HASH_MASK1`

- **Offset Address:** `0x918`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SDMEM_MASK1|8:0|0|RWHW|Hash mask for SDMEM bank select;<br>SDMEM_bank_select[1] = SDMEM_addr[7]<br>^ (^(SDMEM_addr[17:9] &<br>SDMEM_MASK1[8:0]));|

### 13.194. SDMEM_HASH_MASK2

**Register Name:** `SDMEM_HASH_MASK2`

- **Offset Address:** `0x91C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SDMEM_MASK2|8:0|0|RWHW|Hash mask for SDMEM bank select;<br>SDMEM_bank_select[2] = SDMEM_addr[8]<br>^ (^(SDMEM_addr[17:9] &<br>SDMEM_MASK2[8:0]));|

### 13.195. SRTAR_HASH_MASK0

**Register Name:** `SRTAR_HASH_MASK0`

- **Offset Address:** `0x920`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SRTAR_MASK0|9:0|0|RWHW|Hash mask for SR-TAR bank select;<br>For SR in all mode and TAR in new mode<br>(thread_mode == 0x1) :<br>SR/TAR_bank_select[0] =<br>SR/TAR_row_bank_idx[0] ^<br>(^(concate(sr_tar_type, sub-threaad_idx,<br>reg_index) & SRTAR_MASK0[9:0]));<br>For TAR in legacy mode (thread_mode ==<br>0x3):<br>TAR_bank_select[0] = TAR_row_bank_idx[0]<br>^ (^(concate(sr_tar_type, sub-<br>threaad_idx[3:2], vpt_id, sub_thread_idx[0],<br>tar_index) & SRTAR_MASK0[9:0]));|

### 13.196. SRTAR_HASH_MASK1

**Register Name:** `SRTAR_HASH_MASK1`

- **Offset Address:** `0x924`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SRTAR_MASK1|9:0|0|RWHW|Hash mask for SR/TAR bank select;<br>For SR in all mode and TAR in new mode<br>(thread_mode == 0x1) :<br>SR/TAR_bank_select[1] =<br>SR/TAR_row_bank_idx[1] ^<br>(^(concate(sr_tar_type, sub-threaad_idx,<br>reg_index) & SRTAR_MASK0[9:0]));<br>For TAR in legacy mode (thread_mode ==<br>0x3):<br>TAR_bank_select[1] = TAR_row_bank_idx[1]<br>^ (^(concate(sr_tar_type, sub-<br>threaad_idx[3:2], vpt_id, sub_thread_idx[1],<br>tar_index) & SRTAR_MASK1[9:0]));|

### 13.197. SRTAR_HASH_MASK2

**Register Name:** `SRTAR_HASH_MASK2`

- **Offset Address:** `0x928`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SRTAR_MASK2|9:0|0|RWHW|Hash mask for SR/TAR bank select;<br>For SR in all mode and TAR in new mode<br>(thread_mode == 0x1) :<br>SR/TAR_bank_select[2] =<br>SR/TAR_row_bank_idx[2] ^<br>(^(concate(sr_tar_type, sub-threaad_idx,<br>reg_index) & SRTAR_MASK2[9:0]));<br>For TAR in legacy mode (thread_mode ==<br>0x3):<br>TAR_bank_select[2] = TAR_row_bank_idx[2]<br>^ (^(concate(sr_tar_type, sub-<br>threaad_idx[3:2], vpt_id, sub_thread_idx[1],<br>tar_index) & SRTAR_MASK2[9:0]));|

### 13.198. XPU_DSM_BASE

**Register Name:** `XPU_DSM_BASE`

- **Offset Address:** `0x92C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DSM_BASE|7:0|4|RWHW|DSM_Base_Addr = DSM_BASE *<br>0x100_0000_0000. Valid range: 1~255.|

### 13.199. VASRAM_SRAMCTRL

**Register Name:** `VASRAM_SRAMCTRL`

- **Offset Address:** `0x930`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|80100000|RWHW|SRAM Control reegister for VACC SRAM.<br>[31]: par_gen_en. When "1" enable memory<br>parity generation<br>[30]: par_chk_en. When "1" enable memory<br>parity check<br>[29]: par_err_inject. When "1" enable memory<br>parity error injection<br>[28]: par_err_sel. "0" means injecting errors in<br>parity bits, "1" means injection errors in data<br>lsb bit<br>[20]: ecc_gen_en. When "1" enable ECC code<br>generation<br>[19]: ecc_chk_en. When "1" enable ECC check<br>[18]: ecc_err_inject. When "1" enable ecc error<br>injection<br>[17:16]: "00" means injecting ecc error in<br>ecc_code; "01" means injecting in data LSB.<br>"10" means injecting in both ecc_code and<br>data LSB.<br>[5:3]: ecc_err_cnt<br>[2:0]: par_err_cnt<br>Others: Reserved|

### 13.200. SDMEM_SRAMCTRL

**Register Name:** `SDMEM_SRAMCTRL`

- **Offset Address:** `0x934`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|80100000|RWHW|SRAM Control reegister for SDMEM.<br>[31]: par_gen_en. When "1" enable memory<br>parity generation<br>[30]: par_chk_en. When "1" enable memory<br>parity check<br>[29]: par_err_inject. When "1" enable memory<br>parity error injection<br>[28]: par_err_sel. "0" means injecting errors in<br>parity bits, "1" means injection errors in data<br>lsb bit<br>[20]: ecc_gen_en. When "1" enable ECC code<br>generation<br>[19]: ecc_chk_en. When "1" enable ECC check<br>[18]: ecc_err_inject. When "1" enable ecc error<br>injection<br>[17:16]: "00" means injecting ecc error in<br>ecc_code; "01" means injecting in data LSB.<br>"10" means injecting in both ecc_code and<br>data LSB.<br>[5:3]: ecc_err_cnt<br>[2:0]: par_err_cnt<br>Others: Reserved|

### 13.201. SRTAR_SRAMCTRL

**Register Name:** `SRTAR_SRAMCTRL`

- **Offset Address:** `0x938`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|80100000|RWHW|SRAM Control reegister for SR & TAR SRAM<br>[31]: par_gen_en. When "1" enable memory<br>parity generation<br>[30]: par_chk_en. When "1" enable memory<br>parity check<br>[29]: par_err_inject. When "1" enable memory<br>parity error injection<br>[28]: par_err_sel. "0" means injecting errors in<br>parity bits, "1" means injection errors in data<br>lsb bit<br>[20]: ecc_gen_en. When "1" enable ECC code<br>generation<br>[19]: ecc_chk_en. When "1" enable ECC check<br>[18]: ecc_err_inject. When "1" enable ecc error<br>injection<br>[17:16]: "00" means injecting ecc error in<br>ecc_code; "01" means injecting in data LSB.<br>"10" means injecting in both ecc_code and<br>data LSB.<br>[5:3]: ecc_err_cnt<br>[2:0]: par_err_cnt<br>Others: Reserved|

### 13.202. IVSMR_SRAMCTRL

**Register Name:** `IVSMR_SRAMCTRL`

- **Offset Address:** `0x93C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|80100000|RWHW|SRAM Control reegister for L0.5 Cache<br>[31]: par_gen_en. When "1" enable memory<br>parity generation<br>[30]: par_chk_en. When "1" enable memory<br>parity check<br>[29]: par_err_inject. When "1" enable memory<br>parity error injection<br>[28]: par_err_sel. "0" means injecting errors in<br>parity bits, "1" means injection errors in data<br>lsb bit<br>[20]: ecc_gen_en. When "1" enable ECC code<br>generation<br>[19]: ecc_chk_en. When "1" enable ECC check<br>[18]: ecc_err_inject. When "1" enable ecc error<br>injection<br>[17:16]: "00" means injecting ecc error in<br>ecc_code; "01" means injecting in data LSB.<br>"10" means injecting in both ecc_code and<br>data LSB.<br>[5:3]: ecc_err_cnt<br>[2:0]: par_err_cnt<br>Others: Reserved|

### 13.203. S3INST_SRAMCTRL

**Register Name:** `S3INST_SRAMCTRL`

- **Offset Address:** `0x940`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|80100000|RWHW|SRAM Control reegister for S3 instruction<br>memory<br>[31]: par_gen_en. When "1" enable memory<br>parity generation<br>[30]: par_chk_en. When "1" enable memory<br>parity check<br>[29]: par_err_inject. When "1" enable memory<br>parity error injection<br>[28]: par_err_sel. "0" means injecting errors in<br>parity bits, "1" means injection errors in data<br>lsb bit<br>[20]: ecc_gen_en. When "1" enable ECC code<br>generation<br>[19]: ecc_chk_en. When "1" enable ECC check<br>[18]: ecc_err_inject. When "1" enable ecc error<br>injection<br>[17:16]: "00" means injecting ecc error in<br>ecc_code; "01" means injecting in data LSB.<br>"10" means injecting in both ecc_code and<br>data LSB.<br>[5:3]: ecc_err_cnt<br>[2:0]: par_err_cnt<br>Others: Reserved|

### 13.204. L0IMEM_SRAMCTRL

**Register Name:** `L0IMEM_SRAMCTRL`

- **Offset Address:** `0x944`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|80100000|RWHW|SRAM Control reegister for L0 ICache.<br>[31]: par_gen_en. When "1" enable memory<br>parity generation<br>[30]: par_chk_en. When "1" enable memory<br>parity check<br>[29]: par_err_inject. When "1" enable memory<br>parity error injection<br>[28]: par_err_sel. "0" means injecting errors in<br>parity bits, "1" means injection errors in data<br>lsb bit<br>[20]: ecc_gen_en. When "1" enable ECC code<br>generation<br>[19]: ecc_chk_en. When "1" enable ECC check<br>[18]: ecc_err_inject. When "1" enable ecc error<br>injection<br>[17:16]: "00" means injecting ecc error in<br>ecc_code; "01" means injecting in data LSB.<br>"10" means injecting in both ecc_code and<br>data LSB.<br>[5:3]: ecc_err_cnt<br>[2:0]: par_err_cnt<br>Others: Reserved|

### 13.205. XPU_DF2_SLV_RAS_CTRL

**Register Name:** `XPU_DF2_SLV_RAS_CTRL`

- **Offset Address:** `0x948`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|80000000|RWHW|RAS Control reegister for DF slave2<br>[31]: ECC_GEN_EN. When "1" enable ECC<br>generation<br>[30]: ECC_CHK_EN. When "1" enable ECC check<br>[29:28]: ECC_ERR_INJECT & INJ_ENABLE. When<br>"0x3" enable bus ECC error injection in R/W<br>channel. "0x0" disable ECC error injection<br>[27]: FORCE_TRIGGER. When "1" force trigger<br>ECC multiple error in W channel to report<br>error. P2 feature<br>[24]: ERR_CNT_CLR. When "1" clear all<br>counters of detected error(not error inject) in<br>R/W channel<br>[23]: INJ_ERR_CNT_CLR. When "1" clear all<br>counters of injected error in R/W channel<br>[17]: ECC_ERR_SEL. 0: insert 2bit ecc errors; 1:<br>insert 1bit ecc error<br>[2:0]: ECC_ERR_INJ_CNT. Set the number of<br>errors to be injected in port. Set "0" to inject<br>errors without number limitation<br>Others: Reserved|

### 13.206. XPU_DF2_SLV_RAS_STS

**Register Name:** `XPU_DF2_SLV_RAS_STS`

- **Offset Address:** `0x94C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|4;|31:0|0|RO|RAS Status register for DF slave2<br>[30]: SLV_ERR_GNT. Set to "1" when<br>ECC_ERR_INJ_CNT in RAS_CTRL register is set and<br>clear to "0" when all errors are injected<br>[20:18]: SLV_SINGLE_ERR_CNT. Indicates the number<br>of single errors detected in slave bus<br>[14:12]: SLV_MULTI_ERR_CNT. Indicates the number<br>of multiple errors detected in slave bus<br>[2:0] SLV_ERR_INJECT_CNT.Indicates the number of<br>errors injected in slave bus|

### 13.207. XPU_BLCG_CTRL0

**Register Name:** `XPU_BLCG_CTRL0`

- **Offset Address:** `0x950`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|XPU_BLCG0|31:0|0|RWHW|XPU BLCG control register 0|

### 13.208. XPU_BLCG_CTRL1

**Register Name:** `XPU_BLCG_CTRL1`

- **Offset Address:** `0x954`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|XPU_BLCG1|31:0|0|RWHW|XPU BLCG control register 1|

### 13.209. XPU_BLCG_CTRL2

**Register Name:** `XPU_BLCG_CTRL2`

- **Offset Address:** `0x958`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|XPU_BLCG2|31:0|0|RWHW|XPU BLCG control register 2|

### 13.210. XPU_BLCG_CTRL3

**Register Name:** `XPU_BLCG_CTRL3`

- **Offset Address:** `0x95C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|XPU_BLCG3|31:0|0|RWHW|XPU BLCG control register 3|

### 13.211. SIP_MEM_INFO0

**Register Name:** `SIP_MEM_INFO0`

- **Offset Address:** `0x970`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|IMEM_INFO|31:16|c0|RO|Reserved|
|SDMEM_INFO|15:0|a0|RO|Reserved|

### 13.212. SIP_MEM_INFO1

**Register Name:** `SIP_MEM_INFO1`

- **Offset Address:** `0x974`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VDMEM_INFO|31:16|400|RO|Reserved|
|VAMEM_INFO|15:0|180|RO|Indicates VAMEM size 384 KB.|

### 13.213. SCF_PEND_STS

**Register Name:** `SCF_PEND_STS`

- **Offset Address:** `0x978`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SCF_MST_MC_RD_PEND_STS|10:10|1|RO|1: There is no pending<br>transaction in SIP_SCF<br>axim SA0 MC master. 0:<br>there is pending<br>transaction in SIP_SCF<br>axim SA0 MC master.|
|SCF_MST_MC_WR_PEND_STS|9:9|1|RO|1: There is no pending<br>transaction in SIP_SCF<br>axim SA0 MC master. 0:<br>there is pending<br>transaction in SIP_SCF<br>axim SA0 MC master.|
|SCF_MST_ECF_RD_PEND_STS|8:8|1|RO|1: There is no pending<br>transaction in SIP_SCF<br>axim SA ECF master. 0:<br>there is pending<br>transaction in SIP_SCF<br>axim SA ECF master.|
|SCF_MST_ECF_WR_PEND_STS|7:7|1|RO|1: There is no pending<br>transaction in SIP_SCF<br>axim SA ECF master. 0:<br>there is pending<br>transaction in SIP_SCF<br>axim SA ECF master.|
|SCF_MST_HWSYNC_RD_PEND_STS|6:6|1|RO|1: There is no pending<br>transaction in SIP_SCF<br>axim HwSync master. 0:<br>there is pending<br>transaction in SIP_SCF<br>axim HwSync master.|
|SCF_MST_HWSYNC_WR_PEND_STS|5:5|1|RO|1: There is no pending<br>transaction in SIP_SCF<br>axim HwSync master. 0:<br>there is pending<br>transaction in SIP_SCF<br>axim HwSync master.|
|SCF_MST_LSB_RD_PEND_STS|4:4|1|RO|1: There is no pending<br>transaction in SIP_SCF<br>axim LSB master. 0: there<br>is pending transaction in<br>SIP_SCF axim LSB master.|
|SCF_MST_LSB_WR_PEND_STS|3:3|1|RO|1: There is no pending<br>transaction in SIP_SCF<br>axim LSB master. 0: there<br>is pending transaction in<br>SIP_SCF axim LSB master.|
|SCF_SLV_ECF_PEND_STS|2:2|1|RO|1: There is no pending<br>transaction in SIP_SCF<br>axis ECF slave. 0: there is<br>pending transaction in<br>SIP_SCF axis ECF slave.|
|SCF_SLV_HWSYNC_PEND_STS|1:1|1|RO|1: There is no pending<br>transaction in SIP_SCF<br>axis HwSync slave. 0:<br>there is pending<br>transaction in SIP_SCF<br>axis HwSync slave.|
|SCF_SLV_REG_PEND_STS|0:0|1|RO|1: There is no pending<br>transaction in SIP_SCF<br>axis REG slave. 0: there is<br>pending transaction in<br>SIP_SCF axis REG slave.|

### 13.214. SCF_AXI_FIELD_CFG

**Register Name:** `SCF_AXI_FIELD_CFG`

- **Offset Address:** `0x97C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CF_AW_QOS|7:4|0|RWHW|AWQOS value for SCF/ECF path|
|CF_AR_QOS|3:0|0|RWHW|ARQOS value for SCF/ECF path|

### 13.215. S2_LL_SCHED_CTRL0

**Register Name:** `S2_LL_SCHED_CTRL0`

- **Offset Address:** `0x980`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DIVREM64_SCHED_NUM|31:17|0|RWHW|Cycles to stall after<br>DIV64/REM64 istruction launch|
|DIVREM64_SCHED_EN|16:16|0|RWHW|Enable stall after DIV64/REM64<br>instruction launch|
|DIVREM32_SCHED_NUM|15:1|0|RWHW|Cycles to stall after<br>DIV32/REM32 instruction launch|
|DIVREM32_SCHED_EN|0:0|0|RWHW|Enable stall after DIV32/REM32<br>instruction launch|

### 13.216. S2_LL_SCHED_CTRL1

**Register Name:** `S2_LL_SCHED_CTRL1`

- **Offset Address:** `0x984`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|XCF2SR_SCHED_NUM|31:17|0|RWHW|Cycles to stall after xCF->SR<br>instruction launch|
|XCF2SR_SCHED_EN|16:16|0|RWHW|Enable stall after xCF->SR<br>instruction launch|
|VA2SR_SCHED_NUM|15:1|0|RWHW|Cycles to stall after VA->SR<br>instruction launch|
|VA2SR_SCHED_EN|0:0|0|RWHW|Enable stall after VA->SR<br>instruction launch|

### 13.217. S2_LL_SCHED_CTRL2

**Register Name:** `S2_LL_SCHED_CTRL2`

- **Offset Address:** `0x988`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|LDGLB_SCHED_NUM|15:1|0|RWHW|Cycles to stall after GLB_MEM->SR<br>instruction launch|
|LDGLB_SCHED_EN|0:0|0|RWHW|Enable stall after GLB_MEM->SR<br>instruction launch|

### 13.218. S2_STRUC_HZD_ARB0

**Register Name:** `S2_STRUC_HZD_ARB0`

- **Offset Address:** `0x98C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|S2_ARB0|31:0|0|RWHW|Priority for S2 PISQ structure hazard check|

### 13.219. S2_STRUC_HZD_ARB1

**Register Name:** `S2_STRUC_HZD_ARB1`

- **Offset Address:** `0x990`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|S2_ARB1|31:0|0|RWHW|Priority for S2 RFC_MGR check|

### 13.220. S2_STRUC_HZD_ARB2

**Register Name:** `S2_STRUC_HZD_ARB2`

- **Offset Address:** `0x994`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|S2_ARB2|31:0|0|RWHW|Bank priority for RFRD ROR notify|

### 13.221. S2_STRUC_HZD_ARB3

**Register Name:** `S2_STRUC_HZD_ARB3`

- **Offset Address:** `0x998`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|S2_ARB3|31:0|0|RWHW|Pritority for S2 RFC|

### 13.222. S2_SALU_DIV32_SCHD_CTRL

**Register Name:** `S2_SALU_DIV32_SCHD_CTRL`

- **Offset Address:** `0x99C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CTRL_EN|31:31|0|RWHW|Enable launch control after instruction<br>ongoing cycles hit the threshold|
|ONGOING_TH|29:15|0|RWHW|The threshold of this intruction ongoing<br>cycles|
|SCHED_NUM|14:0|0|RWHW|Once the instruction hit the threshold,<br>piepline will stop launching from this<br>thread for SCHED_NUM cycles.|

### 13.223. S2_SALU_DIV64_SCHD_CTRL

**Register Name:** `S2_SALU_DIV64_SCHD_CTRL`

- **Offset Address:** `0x9A0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CTRL_EN|31:31|0|RWHW|Enable launch control after instruction<br>ongoing cycles hit the threshold|
|ONGOING_TH|29:15|0|RWHW|The threshold of this intruction ongoing<br>cycles|
|SCHED_NUM|14:0|0|RWHW|Once the instruction hit the threshold,<br>piepline will stop launching from this<br>thread for SCHED_NUM cycles.|

### 13.224. S2_LDCF_SRWB_SCHD_CTRL

**Register Name:** `S2_LDCF_SRWB_SCHD_CTRL`

- **Offset Address:** `0x9A4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CTRL_EN|31:31|0|RWHW|Enable launch control after instruction<br>ongoing cycles hit the threshold|
|ONGOING_TH|29:15|0|RWHW|The threshold of this intruction ongoing<br>cycles|
|SCHED_NUM|14:0|0|RWHW|Once the instruction hit the threshold,<br>piepline will stop launching from this<br>thread for SCHED_NUM cycles.|

### 13.225. S2_LDCF_TARWB_SCHD_CTRL

**Register Name:** `S2_LDCF_TARWB_SCHD_CTRL`

- **Offset Address:** `0x9A8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CTRL_EN|31:31|0|RWHW|Enable launch control after instruction<br>ongoing cycles hit the threshold|
|ONGOING_TH|29:15|0|RWHW|The threshold of this intruction ongoing<br>cycles|
|SCHED_NUM|14:0|0|RWHW|Once the instruction hit the threshold,<br>piepline will stop launching from this<br>thread for SCHED_NUM cycles.|

### 13.226. S2_MALU_SRWB_SCHD_CTRL

**Register Name:** `S2_MALU_SRWB_SCHD_CTRL`

- **Offset Address:** `0x9AC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CTRL_EN|31:31|0|RWHW|Enable launch control after instruction<br>ongoing cycles hit the threshold|
|ONGOING_TH|29:15|0|RWHW|The threshold of this intruction ongoing<br>cycles|
|SCHED_NUM|14:0|0|RWHW|Once the instruction hit the threshold,<br>piepline will stop launching from this<br>thread for SCHED_NUM cycles.|

### 13.227. S2_MALU_TARWB_SCHD_CTRL

**Register Name:** `S2_MALU_TARWB_SCHD_CTRL`

- **Offset Address:** `0x9B0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CTRL_EN|31:31|0|RWHW|Enable launch control after instruction<br>ongoing cycles hit the threshold|
|ONGOING_TH|29:15|0|RWHW|The threshold of this intruction ongoing<br>cycles|
|SCHED_NUM|14:0|0|RWHW|Once the instruction hit the threshold,<br>piepline will stop launching from this<br>thread for SCHED_NUM cycles.|

### 13.228. S3_SCHD_CTRL

**Register Name:** `S3_SCHD_CTRL`

- **Offset Address:** `0x9C0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SCHD_CTRL|31:0|0|RO|bit[3:0]: SCHD_MTHD<br>0: Reserved<br>1: Reserved<br>2: Round-Robin<br>3: Footprint<br>Other bits: Reserved|

### 13.229. S3_SCHD_FP_TH_EN

**Register Name:** `S3_SCHD_FP_TH_EN`

- **Offset Address:** `0x9C4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SCHD_FP_TH_EN|31:0|0|RO||

### 13.230. S3_SCHD_FP_TH_TOUT

**Register Name:** `S3_SCHD_FP_TH_TOUT`

- **Offset Address:** `0x9C8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SCHD_FP_TH_TOUT|31:0|0|RO||

### 13.231. S3_SCHD_FP_TH_CUR_ORDER

**Register Name:** `S3_SCHD_FP_TH_CUR_ORDER`

- **Offset Address:** `0x9CC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SCHD_FP_TH_CUR_ORDER|31:0|0|RO||

### 13.232. XPU_MISC_CTRL0

**Register Name:** `XPU_MISC_CTRL0`

- **Offset Address:** `0x9D0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MISC_CTRL0|31:0|0|RWHW||

### 13.233. XPU_MISC_CTRL1

**Register Name:** `XPU_MISC_CTRL1`

- **Offset Address:** `0x9D4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MISC_CTRL1|31:0|0|RWHW||

### 13.234. SIP_PERF_SEL

**Register Name:** `SIP_PERF_SEL`

- **Offset Address:** `0xA00`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|STOP_SEL|23:16|0|RWHW|Select stop siganl from stop group for<br>profiling agent|
|START_SEL|7:0|0|RWHW|Select start siganl from start group for<br>profiling agent|

### 13.235. SIP_PERF_USR

**Register Name:** `SIP_PERF_USR`

- **Offset Address:** `0xA04`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PERF_USR|31:0|0|RWHW|Select event group for profiling agent.|

### 13.236. XPU_PMC_EVT_CTRL

**Register Name:** `XPU_PMC_EVT_CTRL`

- **Offset Address:** `0xA10`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|EVT_CTRL|31:0|0|RWHW|Register of XPU profiling control for thread-<br>sharing feature|

### 13.237. XPU_PMC_EVT0

**Register Name:** `XPU_PMC_EVT0`

- **Offset Address:** `0xA14`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|EVT0|31:0|0|RWHW|XPU thread-sharing feature event register0|

### 13.238. XPU_PMC_EVT1

**Register Name:** `XPU_PMC_EVT1`

- **Offset Address:** `0xA18`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|EVT1|31:0|0|RWHW|XPU thread-sharing feature event register1|

### 13.239. XPU_PMC_EVT2

**Register Name:** `XPU_PMC_EVT2`

- **Offset Address:** `0xA1C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|EVT2|31:0|0|RWHW|XPU thread-sharing feature event register2|

### 13.240. XPU_PMC_EVT3

**Register Name:** `XPU_PMC_EVT3`

- **Offset Address:** `0xA20`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|EVT3|31:0|0|RWHW|XPU thread-sharing feature event register3|

### 13.241. XPU_PMC_EVT4

**Register Name:** `XPU_PMC_EVT4`

- **Offset Address:** `0xA24`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|EVT4|31:0|0|RWHW|XPU thread-sharing feature event register4|

### 13.242. XPU_PMC_EVT5

**Register Name:** `XPU_PMC_EVT5`

- **Offset Address:** `0xA28`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|EVT5|31:0|0|RWHW|XPU thread-sharing feature event register5|

### 13.243. XPU_PMC_EVT6

**Register Name:** `XPU_PMC_EVT6`

- **Offset Address:** `0xA2C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|EVT6|31:0|0|RWHW|XPU thread-sharing feature event register6|

### 13.244. XPU_PMC_EVT7

**Register Name:** `XPU_PMC_EVT7`

- **Offset Address:** `0xA30`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|EVT7|31:0|0|RWHW|XPU thread-sharing feature event register7|

### 13.245. XPU_PMC_THREAD_CTRL0

**Register Name:** `XPU_PMC_THREAD_CTRL0`

- **Offset Address:** `0xA40`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_CTRL0|31:0|0|RWHW|Register of XPU profiling control for per-<br>thread feature in thread-slot 0|

### 13.246. XPU_PMC_THREAD_CTRL1

**Register Name:** `XPU_PMC_THREAD_CTRL1`

- **Offset Address:** `0xA44`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_CTRL1|31:0|0|RWHW|Register of XPU profiling control for per-<br>thread feature in thread-slot 1|

### 13.247. XPU_PMC_THREAD_CTRL2

**Register Name:** `XPU_PMC_THREAD_CTRL2`

- **Offset Address:** `0xA48`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_CTRL2|31:0|0|RWHW|Register of XPU profiling control for per-<br>thread feature in thread-slot 2|

### 13.248. XPU_PMC_THREAD_CTRL3

**Register Name:** `XPU_PMC_THREAD_CTRL3`

- **Offset Address:** `0xA4C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_CTRL3|31:0|0|RWHW|Register of XPU profiling control for per-<br>thread feature in thread-slot 3|

### 13.249. XPU_PMC_THREAD_CTRL4

**Register Name:** `XPU_PMC_THREAD_CTRL4`

- **Offset Address:** `0xA50`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_CTRL4|31:0|0|RWHW|Register of XPU profiling control for per-<br>thread feature in thread-slot 4|

### 13.250. XPU_PMC_THREAD_CTRL5

**Register Name:** `XPU_PMC_THREAD_CTRL5`

- **Offset Address:** `0xA54`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_CTRL5|31:0|0|RWHW|Register of XPU profiling control for per-<br>thread feature in thread-slot 5|

### 13.251. XPU_PMC_THREAD_CTRL6

**Register Name:** `XPU_PMC_THREAD_CTRL6`

- **Offset Address:** `0xA58`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_CTRL6|31:0|0|RWHW|Register of XPU profiling control for per-<br>thread feature in thread-slot 6|

### 13.252. XPU_PMC_THREAD_CTRL7

**Register Name:** `XPU_PMC_THREAD_CTRL7`

- **Offset Address:** `0xA5C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_CTRL7|31:0|0|RWHW|Register of XPU profiling control for per-<br>thread feature in thread-slot 7|

### 13.253. XPU_PMC_THREAD_CTRL8

**Register Name:** `XPU_PMC_THREAD_CTRL8`

- **Offset Address:** `0xA60`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_CTRL8|31:0|0|RWHW|Register of XPU profiling control for per-<br>thread feature in thread-slot 8|

### 13.254. XPU_PMC_THREAD_CTRL9

**Register Name:** `XPU_PMC_THREAD_CTRL9`

- **Offset Address:** `0xA64`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_CTRL9|31:0|0|RWHW|Register of XPU profiling control for per-<br>thread feature in thread-slot 9|

### 13.255. XPU_PMC_THREAD_CTRL10

**Register Name:** `XPU_PMC_THREAD_CTRL10`

- **Offset Address:** `0xA68`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_CTRL10|31:0|0|RWHW|Register of XPU profiling control for per-<br>thread feature in thread-slot 10|

### 13.256. XPU_PMC_THREAD_CTRL11

**Register Name:** `XPU_PMC_THREAD_CTRL11`

- **Offset Address:** `0xA6C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_CTRL11|31:0|0|RWHW|Register of XPU profiling control for per-<br>thread feature in thread-slot 11|

### 13.257. XPU_PMC_THREAD_CTRL12

**Register Name:** `XPU_PMC_THREAD_CTRL12`

- **Offset Address:** `0xA70`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_CTRL12|31:0|0|RWHW|Register of XPU profiling control for per-<br>thread feature in thread-slot 12|

### 13.258. XPU_PMC_THREAD_CTRL13

**Register Name:** `XPU_PMC_THREAD_CTRL13`

- **Offset Address:** `0xA74`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_CTRL13|31:0|0|RWHW|Register of XPU profiling control for per-<br>thread feature in thread-slot 13|

### 13.259. XPU_PMC_THREAD_CTRL14

**Register Name:** `XPU_PMC_THREAD_CTRL14`

- **Offset Address:** `0xA78`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_CTRL14|31:0|0|RWHW|Register of XPU profiling control for per-<br>thread feature in thread-slot 14|

### 13.260. XPU_PMC_THREAD_CTRL15

**Register Name:** `XPU_PMC_THREAD_CTRL15`

- **Offset Address:** `0xA7C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_CTRL15|31:0|0|RWHW|Register of XPU profiling control for per-<br>thread feature in thread-slot 15|

### 13.261. XPU_PMC_THREAD_EVENT0

**Register Name:** `XPU_PMC_THREAD_EVENT0`

- **Offset Address:** `0xA80`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_EVENT0|31:0|0|RWHW|Per-thread profiling event for thread-slot<br>0|

### 13.262. XPU_PMC_THREAD_EVENT1

**Register Name:** `XPU_PMC_THREAD_EVENT1`

- **Offset Address:** `0xA84`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_EVENT1|31:0|0|RWHW|Per-thread profiling event for thread-slot<br>1|

### 13.263. XPU_PMC_THREAD_EVENT2

**Register Name:** `XPU_PMC_THREAD_EVENT2`

- **Offset Address:** `0xA88`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_EVENT2|31:0|0|RWHW|Per-thread profiling event for thread-slot<br>2|

### 13.264. XPU_PMC_THREAD_EVENT3

**Register Name:** `XPU_PMC_THREAD_EVENT3`

- **Offset Address:** `0xA8C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_EVENT3|31:0|0|RWHW|Per-thread profiling event for thread-slot<br>3|

### 13.265. XPU_PMC_THREAD_EVENT4

**Register Name:** `XPU_PMC_THREAD_EVENT4`

- **Offset Address:** `0xA90`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_EVENT4|31:0|0|RWHW|Per-thread profiling event for thread-slot<br>4|

### 13.266. XPU_PMC_THREAD_EVENT5

**Register Name:** `XPU_PMC_THREAD_EVENT5`

- **Offset Address:** `0xA94`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_EVENT5|31:0|0|RWHW|Per-thread profiling event for thread-slot<br>5|

### 13.267. XPU_PMC_THREAD_EVENT6

**Register Name:** `XPU_PMC_THREAD_EVENT6`

- **Offset Address:** `0xA98`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_EVENT6|31:0|0|RWHW|Per-thread profiling event for thread-slot<br>6|

### 13.268. XPU_PMC_THREAD_EVENT7

**Register Name:** `XPU_PMC_THREAD_EVENT7`

- **Offset Address:** `0xA9C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_EVENT7|31:0|0|RWHW|Per-thread profiling event for thread-slot<br>7|

### 13.269. XPU_PMC_THREAD_EVENT8

**Register Name:** `XPU_PMC_THREAD_EVENT8`

- **Offset Address:** `0xAA0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_EVENT8|31:0|0|RWHW|Per-thread profiling event for thread-slot<br>8|

### 13.270. XPU_PMC_THREAD_EVENT9

**Register Name:** `XPU_PMC_THREAD_EVENT9`

- **Offset Address:** `0xAA4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_EVENT9|31:0|0|RWHW|Per-thread profiling event for thread-slot<br>9|

### 13.271. XPU_PMC_THREAD_EVENT10

**Register Name:** `XPU_PMC_THREAD_EVENT10`

- **Offset Address:** `0xAA8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_EVENT10|31:0|0|RWHW|Per-thread profiling event for thread-<br>slot 10|

### 13.272. XPU_PMC_THREAD_EVENT11

**Register Name:** `XPU_PMC_THREAD_EVENT11`

- **Offset Address:** `0xAAC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_EVENT11|31:0|0|RWHW|Per-thread profiling event for thread-<br>slot 11|

### 13.273. XPU_PMC_THREAD_EVENT12

**Register Name:** `XPU_PMC_THREAD_EVENT12`

- **Offset Address:** `0xAB0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_EVENT12|31:0|0|RWHW|Per-thread profiling event for thread-<br>slot 12|

### 13.274. XPU_PMC_THREAD_EVENT13

**Register Name:** `XPU_PMC_THREAD_EVENT13`

- **Offset Address:** `0xAB4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_EVENT13|31:0|0|RWHW|Per-thread profiling event for thread-<br>slot 13|

### 13.275. XPU_PMC_THREAD_EVENT14

**Register Name:** `XPU_PMC_THREAD_EVENT14`

- **Offset Address:** `0xAB8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_EVENT14|31:0|0|RWHW|Per-thread profiling event for thread-<br>slot 14|

### 13.276. XPU_PMC_THREAD_EVENT15

**Register Name:** `XPU_PMC_THREAD_EVENT15`

- **Offset Address:** `0xABC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_EVENT15|31:0|0|RWHW|Per-thread profiling event for thread-<br>slot 15|

### 13.277. XPU_SCRATCH0

**Register Name:** `XPU_SCRATCH0`

- **Offset Address:** `0xB00`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Replace L1_DSM_MASK_CFG function in XPU<br>[10:0]: field PRIVATE_MASK. Any address smaller<br>than (PRIVATE_MASK * 1KB) in private VDMEM<br>will trigger EXCP_ADDR_INVALID exception.<br>[26:16]: field NON_AFFINITY_MASK. Any address<br>bigger or equal than (8 * NON_AFFINITY_MASK *<br>1KB) in Non-affinity shared buffer will trigger<br>EXCP_ADDR_INVALID exception.<br>Valid range for both fields are 0~896. Unit is 1KB<br>[28]: disable DSM_MASK. When "1"<br>PRIVATE_MASK & NON_AFFINITY_MASK will not<br>work. Should be "1" in normal usage.|

### 13.278. XPU_SCRATCH1

**Register Name:** `XPU_SCRATCH1`

- **Offset Address:** `0xB04`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|This register is a RO register. SW should not write<br>this register.<br>bit[17:16]: FSM state of Launch Queue1<br>bit[1:0]: FSM state of Launch Queue0<br>Other bits are reserved.<br>value of state<br>0: CHECK State. In state FSM is not launching any<br>kernel-slot<br>1: INVALIDATE state. In this state FSM is<br>perparing for launch<br>2: LAUNCH state. In this state FSM is launch sub-<br>thread of one kernel<br>3: POP state. In this state FSM is poping the<br>configuration for launched kernel slot from<br>launch queueue.<br>FSM in state 1~3 will not be affected by<br>AUTO_STOP_LAUNCH|

### 13.279. XPU_SCRATCH2

**Register Name:** `XPU_SCRATCH2`

- **Offset Address:** `0xB08`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Bit[0]: Cache prefetch/overfetch issue fix bit.<br>Should be "1" in normal usage<br>Others: Reserved|

### 13.280. XPU_SCRATCH3

**Register Name:** `XPU_SCRATCH3`

- **Offset Address:** `0xB0C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.281. XPU_SCRATCH4

**Register Name:** `XPU_SCRATCH4`

- **Offset Address:** `0xB10`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|For mailbox144~mailbox191<br>10bit master id, 11bit ref, 11bit counter}<br>{10bit master id, 11bit ref, 11bit counter|

### 13.282. XPU_SCRATCH5

**Register Name:** `XPU_SCRATCH5`

- **Offset Address:** `0xB14`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|For mailbox144~mailbox191<br>2’b00, 2’b0, 2bit upd_mode , 1bit cre_mode, 1bit<br>trg_mode, 1bit inc_mode , 7bit signaling uniq_id,<br>7bit mbx_uniq_id, 9bit mbx_id}<br>{2’b00, 2’b0, 2bit upd_mode , 1bit cre_mode, 1bit<br>trg_mode, 1bit inc_mode , 7bit signaling uniq_id,<br>7bit mbx_uniq_id, 9bit mbx_id|

### 13.283. XPU_SCRATCH6

**Register Name:** `XPU_SCRATCH6`

- **Offset Address:** `0xB18`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW||

### 13.284. XPU_SCRATCH7

**Register Name:** `XPU_SCRATCH7`

- **Offset Address:** `0xB1C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Bit[11:0]: OBS bit valid for current SIP<br>Others: reserved|

### 13.285. XPU_SCRATCH8

**Register Name:** `XPU_SCRATCH8`

- **Offset Address:** `0xB20`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.286. XPU_SCRATCH9

**Register Name:** `XPU_SCRATCH9`

- **Offset Address:** `0xB24`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.287. XPU_SCRATCH10

**Register Name:** `XPU_SCRATCH10`

- **Offset Address:** `0xB28`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.288. XPU_SCRATCH11

**Register Name:** `XPU_SCRATCH11`

- **Offset Address:** `0xB2C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.289. XPU_SCRATCH12

**Register Name:** `XPU_SCRATCH12`

- **Offset Address:** `0xB30`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.290. XPU_SCRATCH13

**Register Name:** `XPU_SCRATCH13`

- **Offset Address:** `0xB34`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.291. XPU_SCRATCH14

**Register Name:** `XPU_SCRATCH14`

- **Offset Address:** `0xB38`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.292. XPU_SCRATCH15

**Register Name:** `XPU_SCRATCH15`

- **Offset Address:** `0xB3C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.293. XPU_SCRATCH16

**Register Name:** `XPU_SCRATCH16`

- **Offset Address:** `0xB40`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.294. XPU_SCRATCH17

**Register Name:** `XPU_SCRATCH17`

- **Offset Address:** `0xB44`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.295. XPU_SCRATCH18

**Register Name:** `XPU_SCRATCH18`

- **Offset Address:** `0xB48`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.296. XPU_SCRATCH19

**Register Name:** `XPU_SCRATCH19`

- **Offset Address:** `0xB4C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.297. XPU_SCRATCH20

**Register Name:** `XPU_SCRATCH20`

- **Offset Address:** `0xB50`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.298. XPU_SCRATCH21

**Register Name:** `XPU_SCRATCH21`

- **Offset Address:** `0xB54`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.299. XPU_SCRATCH22

**Register Name:** `XPU_SCRATCH22`

- **Offset Address:** `0xB58`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.300. XPU_SCRATCH23

**Register Name:** `XPU_SCRATCH23`

- **Offset Address:** `0xB5C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.301. XPU_SCRATCH24

**Register Name:** `XPU_SCRATCH24`

- **Offset Address:** `0xB60`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.302. XPU_SCRATCH25

**Register Name:** `XPU_SCRATCH25`

- **Offset Address:** `0xB64`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Bit[31]: VST instruction BF16toE5M2 alignment<br>issue fix bit. Should be "1" in normal usage.<br>Others: Reserved|

### 13.303. XPU_SCRATCH26

**Register Name:** `XPU_SCRATCH26`

- **Offset Address:** `0xB68`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.304. XPU_SCRATCH27

**Register Name:** `XPU_SCRATCH27`

- **Offset Address:** `0xB6C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.305. XPU_SCRATCH28

**Register Name:** `XPU_SCRATCH28`

- **Offset Address:** `0xB70`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.306. XPU_SCRATCH29

**Register Name:** `XPU_SCRATCH29`

- **Offset Address:** `0xB74`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.307. XPU_SCRATCH30

**Register Name:** `XPU_SCRATCH30`

- **Offset Address:** `0xB78`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.308. XPU_SCRATCH31

**Register Name:** `XPU_SCRATCH31`

- **Offset Address:** `0xB7C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.309. XPU_SCRATCH32

**Register Name:** `XPU_SCRATCH32`

- **Offset Address:** `0xB80`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.310. XPU_SCRATCH33

**Register Name:** `XPU_SCRATCH33`

- **Offset Address:** `0xB84`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.311. XPU_SCRATCH34

**Register Name:** `XPU_SCRATCH34`

- **Offset Address:** `0xB88`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.312. XPU_SCRATCH35

**Register Name:** `XPU_SCRATCH35`

- **Offset Address:** `0xB8C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.313. XPU_SCRATCH36

**Register Name:** `XPU_SCRATCH36`

- **Offset Address:** `0xB90`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.314. XPU_SCRATCH37

**Register Name:** `XPU_SCRATCH37`

- **Offset Address:** `0xB94`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.315. XPU_SCRATCH38

**Register Name:** `XPU_SCRATCH38`

- **Offset Address:** `0xB98`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.316. XPU_SCRATCH39

**Register Name:** `XPU_SCRATCH39`

- **Offset Address:** `0xB9C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.317. XPU_SCRATCH40

**Register Name:** `XPU_SCRATCH40`

- **Offset Address:** `0xBA0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.318. XPU_SCRATCH41

**Register Name:** `XPU_SCRATCH41`

- **Offset Address:** `0xBA4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.319. XPU_SCRATCH42

**Register Name:** `XPU_SCRATCH42`

- **Offset Address:** `0xBA8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.320. XPU_SCRATCH43

**Register Name:** `XPU_SCRATCH43`

- **Offset Address:** `0xBAC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.321. XPU_SCRATCH44

**Register Name:** `XPU_SCRATCH44`

- **Offset Address:** `0xBB0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.322. XPU_SCRATCH45

**Register Name:** `XPU_SCRATCH45`

- **Offset Address:** `0xBB4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.323. XPU_SCRATCH46

**Register Name:** `XPU_SCRATCH46`

- **Offset Address:** `0xBB8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.324. XPU_SCRATCH47

**Register Name:** `XPU_SCRATCH47`

- **Offset Address:** `0xBBC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.325. XPU_SCRATCH48

**Register Name:** `XPU_SCRATCH48`

- **Offset Address:** `0xBC0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.326. XPU_SCRATCH49

**Register Name:** `XPU_SCRATCH49`

- **Offset Address:** `0xBC4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.327. XPU_SCRATCH50

**Register Name:** `XPU_SCRATCH50`

- **Offset Address:** `0xBC8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.328. XPU_SCRATCH51

**Register Name:** `XPU_SCRATCH51`

- **Offset Address:** `0xBCC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.329. XPU_SCRATCH52

**Register Name:** `XPU_SCRATCH52`

- **Offset Address:** `0xBD0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.330. XPU_SCRATCH53

**Register Name:** `XPU_SCRATCH53`

- **Offset Address:** `0xBD4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.331. XPU_SCRATCH54

**Register Name:** `XPU_SCRATCH54`

- **Offset Address:** `0xBD8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register|

### 13.332. XPU_SCRATCH55

**Register Name:** `XPU_SCRATCH55`

- **Offset Address:** `0xBDC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Reserved|

### 13.333. XPU_SCRATCH56

**Register Name:** `XPU_SCRATCH56`

- **Offset Address:** `0xBE0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Bit[6]: Cache prefetch/overfetch issue fix bit.<br>Should be "1" in normal usage<br>Others: Reserved|

### 13.334. XPU_SCRATCH57

**Register Name:** `XPU_SCRATCH57`

- **Offset Address:** `0xBE4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Reserved|

### 13.335. XPU_SCRATCH58

**Register Name:** `XPU_SCRATCH58`

- **Offset Address:** `0xBE8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Reserved|

### 13.336. XPU_SCRATCH59

**Register Name:** `XPU_SCRATCH59`

- **Offset Address:** `0xBEC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Reserved|

### 13.337. XPU_SCRATCH60

**Register Name:** `XPU_SCRATCH60`

- **Offset Address:** `0xBF0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Bit[16]: Cache prefetch/overfetch issue fix bit.<br>Should be "1" in normal usage<br>Others: Reserved|

### 13.338. XPU_SCRATCH61

**Register Name:** `XPU_SCRATCH61`

- **Offset Address:** `0xBF4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Reserved|

### 13.339. XPU_SCRATCH62

**Register Name:** `XPU_SCRATCH62`

- **Offset Address:** `0xBF8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Reserved|

### 13.340. XPU_SCRATCH63

**Register Name:** `XPU_SCRATCH63`

- **Offset Address:** `0xBFC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Bit[9:0]: per_sub_thread_l0p5_disable.<br>Set "1" to disable L0P5 Cache in corresponding<br>sub-thread.<br>Other bits are Reserved|


## 14. CSR Details: IMEM

### 14.1. IMEM_SRAMCTRL

**Register Name:** `IMEM_SRAMCTRL`

- **Offset Address:** `0xD00`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|80100000|RWHW|SRAM Control reegister for L1 ICache.<br>[31]: par_gen_en. When "1" enable memory<br>parity generation<br>[30]: par_chk_en. When "1" enable memory<br>parity check<br>[29]: par_err_inject. When "1" enable memory<br>parity error injection<br>[28]: par_err_sel. "0" means injecting errors in<br>parity bits, "1" means injection errors in data<br>lsb bit<br>[20]: ecc_gen_en. When "1" enable ECC code<br>generation<br>[19]: ecc_chk_en. When "1" enable ECC check<br>[18]: ecc_err_inject. When "1" enable ecc error<br>injection<br>[17:16]: "00" means injecting ecc error in<br>ecc_code; "01" means injecting in data LSB.<br>"10" means injecting in both ecc_code and<br>data LSB.<br>[5:3]: ecc_err_cnt<br>[2:0]: par_err_cnt<br>Others: Reserved|

### 14.2. IMEM_AXI_FIELD_CFG

**Register Name:** `IMEM_AXI_FIELD_CFG`

- **Offset Address:** `0xD04`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ICACHE_AR_QOS|3:0|0|RWHW|ARQOS value for ICache path|

### 14.3. IMEM_TAG_INVALID

**Register Name:** `IMEM_TAG_INVALID`

- **Offset Address:** `0xD08`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|INVALID_START|0:0|0|RWHW|Set by SW and clean by HW.<br>Read "0" means no inflight invaldate<br>operation. Read "1" means there is an<br>inflight invalidate operation.<br>Write 1 to this bit to start invalidate all L1<br>and L0 Inst Cache lines.<br>Then SW should poll this field until it turns<br>is "0".|

### 14.4. IMEM_TAG_RIDX

**Register Name:** `IMEM_TAG_RIDX`

- **Offset Address:** `0xD0C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TAG_RIDX_DATA|4:0|0|RWHW|Cacheline index when used to read cache<br>line tag table status (SW can read it<br>anytime). SW should firstly write<br>ICACHE_TAG_RIDX, then read<br>ICACHE_TAG_RDATA|

### 14.5. IMEM_TAG_RDATA0

**Register Name:** `IMEM_TAG_RDATA0`

- **Offset Address:** `0xD10`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|KSID|17:12|0|RO|The KSID of current cacheline|
|ASID|11:8|0|RO|The ASID of current cacheline|
|RESP_ERR|4:4|0|RO|Bus response error when loading this cache line<br>from memory. The cache line is specified by<br>IMEM_TAG_RIDX.|
|RAS_ERR|3:3|0|RO|Bus RAS error or slave RAS error when loading<br>this cache line from memory. The cache line is<br>specified by IMEM_TAG_RIDX.|
|LOCK|2:2|0|RO|LOCK value read from the cache line specified<br>by IMEM_TAG_RIDX.|
|PND|1:1|0|RO|PND value read from the cache line specified by<br>IMEM_TAG_RIDX.|
|VLD|0:0|0|RO|VLD value read from the cache line specified by<br>IMEM_TAG_RIDX.|

### 14.6. IMEM_TAG_RDATA1

**Register Name:** `IMEM_TAG_RDATA1`

- **Offset Address:** `0xD14`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VIRTUAL_TAG|31:0|0|RO|Virtual TAG of current cacheline. The bit[12:0]<br>should be zero|

### 14.7. IMEM_TAG_RDATA2

**Register Name:** `IMEM_TAG_RDATA2`

- **Offset Address:** `0xD18`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|IMEM_BASE_LO|31:0|0|RO|Low 32bit of IMEM_BASE of current cacheline|

### 14.8. IMEM_TAG_RDATA3

**Register Name:** `IMEM_TAG_RDATA3`

- **Offset Address:** `0xD1C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|IMEM_BASE_HI|15:0|0|RO|High 16 of IMEM_BASE of current cacheline|

### 14.9. ICACHE_CTRL

**Register Name:** `ICACHE_CTRL`

- **Offset Address:** `0xD40`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|IMEM_PREFETCH_BLK|19:16|0|RWHW|Only meanningful when<br>IMEM_CACHE_EN=1 &&<br>IMEM_VA_EN=1 &&<br>IMEM_MISS_FETCH_EN=1.<br>If current PC's cacheline block is<br>hit, no exception hit, and current<br>instruction is not an IDMA<br>instruction, while near future<br>cacheline blocks are missing, then<br>HW will automatically issue a DMA<br>request to prefetch the nearest<br>missing block after current PC.<br>The scope of 'near future<br>cacheline blocks's is determined<br>by IMEM_PREFETCH_BLK. If<br>IMEM_PREFETCH_BLK=0, then the<br>prefetch mechanism is disabled. If<br>IMEM_PREFETCH_CLK=1, then HW<br>will check and prefetch for next<br>block. The leagal value is 0~total<br>cacheline block number-1.<br>Caution: currently, SIP 2.1 doesn't<br>not support all comibinations in<br>this register ICACHE_CTRL. Please<br>refer to IP Architecture document<br>for the supported scope.<br>This register could only be written<br>when SIP is in HALT state.|
|IMEM_DMA_INS_EN|3:3|0|RWHW|If IMEM_CACHE_EN=0 or<br>IMEM_DMA_INS_EN=0, IDMA<br>instruction will be treated as NOP;<br>otherwise IDMA instruction will be<br>executed as normal.<br>Caution: currently, SIP 2.1 doesn't<br>not support all comibinations in<br>this register ICACHE_CTRL. Please<br>refer to IP Architecture document<br>for the supported scope.<br>This register could only be written<br>when SIP is in HALT state.|
|IMEM_MISS_FETCH_EN|2:2|0|RWHW|Only meaningful when<br>IMEM_CACHE_EN=1 &&<br>IMEM_VA_EN=1.<br>If IMEM_MISS_FETCH_EN=0, then<br>HW will not fetch a cacheline upon<br>its miss. Instead, HW will enter<br>exception handler and let SW to<br>handle the miss.<br>If IMEM_MISS_FETCH_EN=1, then<br>HW will automatically fetch the<br>missed block upon its miss.<br>Caution: currently, SIP 2.1 doesn't<br>not support all comibinations in<br>this register ICACHE_CTRL. Please<br>refer to IP Architecture document<br>for the supported scope.<br>This register could only be written<br>when SIP is in HALT state.|
|IMEM_VA_EN|1:1|0|RWHW|Only meaningful when<br>IMEM_CACHE_EN=1.<br>If IMEM_VA_EN=0, there is no<br>address translation in tag table<br>and there is no tag miss. There is<br>still VLD/PND status in tag table.<br>Cache is working in physical mode<br>and all cache line blocks are valid<br>after reset. It will be marked as<br>PND when there is a IDMA<br>operation triggered, and become<br>VLD after DMA transaction done.<br>If IMEM_VA_EN=1, tag table has<br>address translation and it is<br>possbile that a virtual address<br>being missed, then all cache lines<br>are invalid after reset.<br>Caution: currently, SIP 2.1 doesn't<br>not support all comibinations in<br>this register ICACHE_CTRL. Please<br>refer to IP Architecture document<br>for the supported scope.<br>This register could only be written<br>when SIP is in HALT state.|
|IMEM_CACHE_EN|0:0|0|RWHW|0: Instruction Cache is disabled.<br>1: Instruction Cache is enabled.<br>Caution: currently, SIP 2.1 doesn't<br>not support all comibinations in<br>this register ICACHE_CTRL. Please<br>refer to IP Architecture document<br>for the supported scope.<br>This register could only be written<br>when SIP is in HALT state.|

### 14.10. ICACHE_CLK_CTL

**Register Name:** `ICACHE_CLK_CTL`

- **Offset Address:** `0xD44`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|IMEM_SW_CLK_EN|5:5|1|RWHW|Static clock switch for L1 ICache. 1:<br>enable clock; 0: disable clock<br>When IP want to shutdown clock of<br>sub_block, set it to 1'b0; otherwise it<br>should be 1'b1.|
|IMEM_BLCG_DISABLE|4:4|1|RWHW|1: disable BLCG function for L1<br>ICache. 0: enable BLCG function for<br>L1 ICache|
|IMEM_IDLE_DELAY|3:0|f|RWHW|Clock gating enable delay for L1<br>ICache. Clock will be shutdown after<br>IDLE_DELAY+1 cycles when IP<br>entering idle status.|

### 14.11. IMEM_DF_MST_RAS_CTRL

**Register Name:** `IMEM_DF_MST_RAS_CTRL`

- **Offset Address:** `0xD4C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|80000000|RWHW|RAS Control reegister for DF master2<br>[31]: ECC_GEN_EN. When "1" enable ECC<br>generation<br>[30]: ECC_CHK_EN. When "1" enable ECC check<br>[29:28]: ECC_ERR_INJECT & INJ_ENABLE. When<br>"0x3" enable bus ECC error injection in R/W<br>channel. "0x0" disable ECC error injection<br>[27]: FORCE_TRIGGER. When "1" force trigger<br>ECC multiple error in W channel to report<br>error. P2 feature<br>[24]: ERR_CNT_CLR. When "1" clear all<br>counters of detected error(not error inject) in<br>R/W channel<br>[23]: INJ_ERR_CNT_CLR. When "1" clear all<br>counters of injected error in R/W channel<br>[17]: ECC_ERR_SEL. 0: insert 2bit ecc errors; 1:<br>insert 1bit ecc error<br>[2:0]: ECC_ERR_INJ_CNT. Set the number of<br>errors to be injected in port. Set "0" to inject<br>errors without number limitation<br>Others: Reserved|

### 14.12. IMEM_DF_MST_RAS_STS

**Register Name:** `IMEM_DF_MST_RAS_STS`

- **Offset Address:** `0xD58`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|STS|31:0|0|RO|RAS Status register for DF master2<br>[31]: MST_ERR_GNT. Set to "1" when<br>ECC_ERR_INJ_CNT in RAS_CTRL register is set and<br>clear to "0" when all errors are injected<br>[23:21]: MST_SINGLE_ERR_CNT. Indicates the number<br>of single errors detected in master bus<br>[17:15]: MST_MULTI_ERR_CNT. Indicates the number<br>of multiple errors detected in master bus<br>[5:3] MST_ERR_INJECT_CNT.Indicates the number of<br>errors injected in master bus|

### 14.13. ICACHE_SCRATCH0

**Register Name:** `ICACHE_SCRATCH0`

- **Offset Address:** `0xD80`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register!!!|

### 14.14. ICACHE_SCRATCH1

**Register Name:** `ICACHE_SCRATCH1`

- **Offset Address:** `0xD84`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register!!!|

### 14.15. ICACHE_SCRATCH2

**Register Name:** `ICACHE_SCRATCH2`

- **Offset Address:** `0xD88`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register!!!|

### 14.16. ICACHE_SCRATCH3

**Register Name:** `ICACHE_SCRATCH3`

- **Offset Address:** `0xD8C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register!!!|


## 15. CSR Details: L1

### 15.1. DMEM_BANK_MAPPING

**Register Name:** `DMEM_BANK_MAPPING`

- **Offset Address:** `0xE00`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BANK_SHIFT_ENABLE|26:26|1|RWHW|Enable bank index shifting inside<br>one bank group of VDMEM.<br>By default is enabled.|

### 15.2. VDMEM_HASH_MASK0

**Register Name:** `VDMEM_HASH_MASK0`

- **Offset Address:** `0xE04`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VDMEM_A7_MASK|28:16|11eb|RWHW|Hash mask for VDMEM_ADDR[7];<br>VDMEM_hashed_addr[7] =<br>VDMEM_raw_addr[7] ^<br>(bit_xor(zero_ext(VDMEM_raw_addr[19:10])<br>& VDMEM_A7_MASK));|
|VDMEM_A6_MASK|12:0|f59|RWHW|Hash mask for VDMEM_ADDR[6];<br>VDMEM_hashed_addr[6] =<br>VDMEM_raw_addr[6] ^<br>(bit_xor(zero_ext(VDMEM_raw_addr[19:10])<br>& VDMEM_A6_MASK));|

### 15.3. VDMEM_HASH_MASK1

**Register Name:** `VDMEM_HASH_MASK1`

- **Offset Address:** `0xE08`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VDMEM_A9_MASK|28:16|7ac|RWHW|Hash mask for VDMEM_ADDR[9];<br>VDMEM_hashed_addr[9] =<br>VDMEM_raw_addr[9] ^<br>(bit_xor(zero_ext(VDMEM_raw_addr[19:10])<br>& VDMEM_A9_MASK));|
|VDMEM_A8_MASK|12:0|3d6|RWHW|Hash mask for VDMEM_ADDR[8];<br>VDMEM_hashed_addr[8] =<br>VDMEM_raw_addr[8] ^<br>(bit_xor(zero_ext(VDMEM_raw_addr[19:10])<br>& VDMEM_A8_MASK));|

### 15.4. L1_SIP_ID

**Register Name:** `L1_SIP_ID`

- **Offset Address:** `0xE0C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SIC_ID|7:4|0|RWHW|Reserved. This register is no longer used.|
|SIP_ID|3:0|0|RWHW|Reserved. This register is no longer used.|

### 15.5. L1_AXI_FIELD_CFG0

**Register Name:** `L1_AXI_FIELD_CFG0`

- **Offset Address:** `0xE10`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DF1_AW_QOS|15:12|0|RWHW|AWQOS value for SDF1/EDF1 path|
|DF1_AR_QOS|11:8|0|RWHW|ARQOS value for SDF1/EDF1 path|
|DF0_AW_QOS|7:4|0|RWHW|AWQOS value for SDF0/EDF0 path|
|DF0_AR_QOS|3:0|0|RWHW|ARQOS value for SDF0/EDF0 path|

### 15.6. L1_AXI_FIELD_CFG1

**Register Name:** `L1_AXI_FIELD_CFG1`

- **Offset Address:** `0xE14`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DF1_RESP_QOS_VLD|29:29|0|RWHW|0: DF1 R/B response use master<br>QOS<br>1: DF1 R/B response use<br>DF1_R_QOS/DF1_B_QOS|
|DF0_RESP_QOS_VLD|28:28|0|RWHW|0: DF0 R/B response use master<br>QOS<br>1: DF0 R/B response use<br>DF0_R_QOS/DF0_B_QOS|
|DF1_B_QOS|15:12|0|RWHW|B response value for SDF1/EDF1<br>path|
|DF1_R_QOS|11:8|0|RWHW|R response value for SDF1/EDF1<br>path|
|DF0_B_QOS|7:4|0|RWHW|B response QOS value for<br>SDF0/EDF0 path|
|DF0_R_QOS|3:0|0|RWHW|R response QOS value for<br>SDF0/EDF0 path|

### 15.7. L1_DSM_MASK_CFG

**Register Name:** `L1_DSM_MASK_CFG`

- **Offset Address:** `0xE18`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|NON_AFFINITY_MASK|26:16|0|RWHW|Space Shared for Non-Affinity<br>Buffer in one VDMEM.<br>Any address bigger or equal than (8<br>* NON_AFFINITY_MASK * 1KB) in<br>Non-affinity shared buffer will<br>trigger EXCP_ADDR_INVALID<br>exception<br>Valid range is 0~1024. Unit is 1KB.|
|PRIVATE_MASK|10:0|0|RWHW|Space Shared for Non-Affinity<br>Buffer in one VDMEM.<br>Any address smaller than<br>(PRIVATE_MASK * 1KB) in private<br>VDMEM will trigger<br>EXCP_ADDR_INVALID exception<br>Valid range is 0~1024. Unit is 1KB.|

### 15.8. VDMEM_SRAMCTRL

**Register Name:** `VDMEM_SRAMCTRL`

- **Offset Address:** `0xE20`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|80100000|RWHW|SRAM Control reegister for VDMEM SRAM.<br>[31]: par_gen_en. When "1" enable memory<br>parity generation<br>[30]: par_chk_en. When "1" enable memory<br>parity check<br>[29]: par_err_inject. When "1" enable memory<br>parity error injection<br>[28]: par_err_sel. "0" means injecting errors in<br>parity bits, "1" means injection errors in data<br>lsb bit<br>[20]: ecc_gen_en. When "1" enable ECC code<br>generation<br>[19]: ecc_chk_en. When "1" enable ECC check<br>[18]: ecc_err_inject. When "1" enable ecc error<br>injection<br>[17:16]: "00" means injecting ecc error in<br>ecc_code; "01" means injecting in data LSB.<br>"10" means injecting in both ecc_code and<br>data LSB.<br>[5:3]: ecc_err_cnt<br>[2:0]: par_err_cnt<br>Others: Reserved|

### 15.9. NCBUF_SRAMCTRL

**Register Name:** `NCBUF_SRAMCTRL`

- **Offset Address:** `0xE24`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|80100000|RWHW|SRAM Control reegister for L1 NCBUF.<br>[31]: par_gen_en. When "1" enable memory<br>parity generation<br>[30]: par_chk_en. When "1" enable memory<br>parity check<br>[29]: par_err_inject. When "1" enable memory<br>parity error injection<br>[28]: par_err_sel. "0" means injecting errors in<br>parity bits, "1" means injection errors in data<br>lsb bit<br>[20]: ecc_gen_en. When "1" enable ECC code<br>generation<br>[19]: ecc_chk_en. When "1" enable ECC check<br>[18]: ecc_err_inject. When "1" enable ecc error<br>injection<br>[17:16]: "00" means injecting ecc error in<br>ecc_code; "01" means injecting in data LSB.<br>"10" means injecting in both ecc_code and<br>data LSB.<br>[5:3]: ecc_err_cnt<br>[2:0]: par_err_cnt<br>Others: Reserved|

### 15.10. LDQ_SRAMCTRL

**Register Name:** `LDQ_SRAMCTRL`

- **Offset Address:** `0xE28`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|80100000|RWHW|SRAM Control reegister for L1 LDQ(LIQ).<br>[31]: par_gen_en. When "1" enable memory<br>parity generation<br>[30]: par_chk_en. When "1" enable memory<br>parity check<br>[29]: par_err_inject. When "1" enable memory<br>parity error injection<br>[28]: par_err_sel. "0" means injecting errors in<br>parity bits, "1" means injection errors in data<br>lsb bit<br>[20]: ecc_gen_en. When "1" enable ECC code<br>generation<br>[19]: ecc_chk_en. When "1" enable ECC check<br>[18]: ecc_err_inject. When "1" enable ecc error<br>injection<br>[17:16]: "00" means injecting ecc error in<br>ecc_code; "01" means injecting in data LSB.<br>"10" means injecting in both ecc_code and<br>data LSB.<br>[5:3]: ecc_err_cnt<br>[2:0]: par_err_cnt<br>Others: Reserved|

### 15.11. STQ_SRAMCTRL

**Register Name:** `STQ_SRAMCTRL`

- **Offset Address:** `0xE2C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|80100000|RWHW|SRAM Control reegister for L1 STQ(SDQ).<br>[31]: par_gen_en. When "1" enable memory<br>parity generation<br>[30]: par_chk_en. When "1" enable memory<br>parity check<br>[29]: par_err_inject. When "1" enable memory<br>parity error injection<br>[28]: par_err_sel. "0" means injecting errors in<br>parity bits, "1" means injection errors in data<br>lsb bit<br>[20]: ecc_gen_en. When "1" enable ECC code<br>generation<br>[19]: ecc_chk_en. When "1" enable ECC check<br>[18]: ecc_err_inject. When "1" enable ecc error<br>injection<br>[17:16]: "00" means injecting ecc error in<br>ecc_code; "01" means injecting in data LSB.<br>"10" means injecting in both ecc_code and<br>data LSB.<br>[5:3]: ecc_err_cnt<br>[2:0]: par_err_cnt<br>Others: Reserved|

### 15.12. L1_DF0_MST_RAS_CTRL

**Register Name:** `L1_DF0_MST_RAS_CTRL`

- **Offset Address:** `0xE30`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|80000000|RWHW|RAS Control reegister for DF master0<br>[31]: ECC_GEN_EN. When "1" enable ECC<br>generation<br>[30]: ECC_CHK_EN. When "1" enable ECC check<br>[29:28]: ECC_ERR_INJECT & INJ_ENABLE. When<br>"0x3" enable bus ECC error injection in R/W<br>channel. "0x0" disable ECC error injection<br>[27]: FORCE_TRIGGER. When "1" force trigger<br>ECC multiple error in W channel to report<br>error. P2 feature<br>[24]: ERR_CNT_CLR. When "1" clear all<br>counters of detected error(not error inject) in<br>R/W channel<br>[23]: INJ_ERR_CNT_CLR. When "1" clear all<br>counters of injected error in R/W channel<br>[17]: ECC_ERR_SEL. 0: insert 2bit ecc errors; 1:<br>insert 1bit ecc error<br>[2:0]: ECC_ERR_INJ_CNT. Set the number of<br>errors to be injected in port. Set "0" to inject<br>errors without number limitation<br>Others: Reserved|

### 15.13. L1_DF0_SLV_RAS_CTRL

**Register Name:** `L1_DF0_SLV_RAS_CTRL`

- **Offset Address:** `0xE34`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|80000000|RWHW|RAS Control reegister for DF slave0<br>[31]: ECC_GEN_EN. When "1" enable ECC<br>generation<br>[30]: ECC_CHK_EN. When "1" enable ECC check<br>[29:28]: ECC_ERR_INJECT & INJ_ENABLE. When<br>"0x3" enable bus ECC error injection in R/W<br>channel. "0x0" disable ECC error injection<br>[27]: FORCE_TRIGGER. When "1" force trigger<br>ECC multiple error in W channel to report<br>error. P2 feature<br>[24]: ERR_CNT_CLR. When "1" clear all<br>counters of detected error(not error inject) in<br>R/W channel<br>[23]: INJ_ERR_CNT_CLR. When "1" clear all<br>counters of injected error in R/W channel<br>[17]: ECC_ERR_SEL. 0: insert 2bit ecc errors; 1:<br>insert 1bit ecc error<br>[2:0]: ECC_ERR_INJ_CNT. Set the number of<br>errors to be injected in port. Set "0" to inject<br>errors without number limitation<br>Others: Reserved|

### 15.14. L1_DF1_MST_RAS_CTRL

**Register Name:** `L1_DF1_MST_RAS_CTRL`

- **Offset Address:** `0xE38`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|80000000|RWHW|RAS Control reegister for DF master1<br>[31]: ECC_GEN_EN. When "1" enable ECC<br>generation<br>[30]: ECC_CHK_EN. When "1" enable ECC check<br>[29:28]: ECC_ERR_INJECT & INJ_ENABLE. When<br>"0x3" enable bus ECC error injection in R/W<br>channel. "0x0" disable ECC error injection<br>[27]: FORCE_TRIGGER. When "1" force trigger<br>ECC multiple error in W channel to report<br>error. P2 feature<br>[24]: ERR_CNT_CLR. When "1" clear all<br>counters of detected error(not error inject) in<br>R/W channel<br>[23]: INJ_ERR_CNT_CLR. When "1" clear all<br>counters of injected error in R/W channel<br>[17]: ECC_ERR_SEL. 0: insert 2bit ecc errors; 1:<br>insert 1bit ecc error<br>[2:0]: ECC_ERR_INJ_CNT. Set the number of<br>errors to be injected in port. Set "0" to inject<br>errors without number limitation<br>Others: Reserved|

### 15.15. L1_DF1_SLV_RAS_CTRL

**Register Name:** `L1_DF1_SLV_RAS_CTRL`

- **Offset Address:** `0xE3C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|80000000|RWHW|RAS Control reegister for DF slave1<br>[31]: ECC_GEN_EN. When "1" enable ECC<br>generation<br>[30]: ECC_CHK_EN. When "1" enable ECC check<br>[29:28]: ECC_ERR_INJECT & INJ_ENABLE. When<br>"0x3" enable bus ECC error injection in R/W<br>channel. "0x0" disable ECC error injection<br>[27]: FORCE_TRIGGER. When "1" force trigger<br>ECC multiple error in W channel to report<br>error. P2 feature<br>[24]: ERR_CNT_CLR. When "1" clear all<br>counters of detected error(not error inject) in<br>R/W channel<br>[23]: INJ_ERR_CNT_CLR. When "1" clear all<br>counters of injected error in R/W channel<br>[17]: ECC_ERR_SEL. 0: insert 2bit ecc errors; 1:<br>insert 1bit ecc error<br>[2:0]: ECC_ERR_INJ_CNT. Set the number of<br>errors to be injected in port. Set "0" to inject<br>errors without number limitation<br>Others: Reserved|

### 15.16. L1_DF0_MST_RAS_STS

**Register Name:** `L1_DF0_MST_RAS_STS`

- **Offset Address:** `0xE40`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|STS|31:0|0|RO|RAS Status register for DF master0<br>[31]: MST_ERR_GNT. Set to "1" when<br>ECC_ERR_INJ_CNT in RAS_CTRL register is set and<br>clear to "0" when all errors are injected<br>[23:21]: MST_SINGLE_ERR_CNT. Indicates the number<br>of single errors detected in master bus<br>[17:15]: MST_MULTI_ERR_CNT. Indicates the number<br>of multiple errors detected in master bus<br>[5:3] MST_ERR_INJECT_CNT.Indicates the number of<br>errors injected in master bus|

### 15.17. L1_DF0_SLV_RAS_STS

**Register Name:** `L1_DF0_SLV_RAS_STS`

- **Offset Address:** `0xE44`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|STS|31:0|0|RO|RAS Status register for DF slave0<br>[30]: SLV_ERR_GNT. Set to "1" when<br>ECC_ERR_INJ_CNT in RAS_CTRL register is set and<br>clear to "0" when all errors are injected<br>[20:18]: SLV_SINGLE_ERR_CNT. Indicates the number<br>of single errors detected in slave bus<br>[14:12]: SLV_MULTI_ERR_CNT. Indicates the number<br>of multiple errors detected in slave bus<br>[2:0] SLV_ERR_INJECT_CNT.Indicates the number of<br>errors injected in slave bus|

### 15.18. L1_DF1_MST_RAS_STS

**Register Name:** `L1_DF1_MST_RAS_STS`

- **Offset Address:** `0xE48`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|STS|31:0|0|RO|RAS Status register for DF master1<br>[31]: MST_ERR_GNT. Set to "1" when<br>ECC_ERR_INJ_CNT in RAS_CTRL register is set and<br>clear to "0" when all errors are injected<br>[23:21]: MST_SINGLE_ERR_CNT. Indicates the number<br>of single errors detected in master bus<br>[17:15]: MST_MULTI_ERR_CNT. Indicates the number<br>of multiple errors detected in master bus<br>[5:3] MST_ERR_INJECT_CNT.Indicates the number of<br>errors injected in master bus|

### 15.19. L1_DF1_SLV_RAS_STS

**Register Name:** `L1_DF1_SLV_RAS_STS`

- **Offset Address:** `0xE4C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|STS|31:0|0|RO|RAS Status register for DF slave1<br>[30]: SLV_ERR_GNT. Set to "1" when<br>ECC_ERR_INJ_CNT in RAS_CTRL register is set and<br>clear to "0" when all errors are injected<br>[20:18]: SLV_SINGLE_ERR_CNT. Indicates the number<br>of single errors detected in slave bus<br>[14:12]: SLV_MULTI_ERR_CNT. Indicates the number<br>of multiple errors detected in slave bus<br>[2:0] SLV_ERR_INJECT_CNT.Indicates the number of<br>errors injected in slave bus|

### 15.20. L1_BLCG_CTRL0

**Register Name:** `L1_BLCG_CTRL0`

- **Offset Address:** `0xE50`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|L1_BLCG_IDLE_DELAY|31:28|f|RWHW|Clock gating enable delay for all L1<br>BLCG units. Clock will be shutdown<br>after IDLE_DELAY+1 cycles when IP<br>entering idle status.|
|L1_BLCG_DISABLE23|23:23|1|RWHW|SIP L1 BLCG unit23 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE22|22:22|1|RWHW|SIP L1 BLCG unit22 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE21|21:21|1|RWHW|SIP L1 BLCG unit21 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE20|20:20|1|RWHW|SIP L1 BLCG unit20 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE19|19:19|1|RWHW|SIP L1 BLCG unit19 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE18|18:18|1|RWHW|SIP L1 BLCG unit18 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE17|17:17|1|RWHW|SIP L1 BLCG unit17 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE16|16:16|1|RWHW|SIP L1 BLCG unit16 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE15|15:15|1|RWHW|SIP L1 BLCG unit15 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE14|14:14|1|RWHW|SIP L1 BLCG unit14 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE13|13:13|1|RWHW|SIP L1 BLCG unit13 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE12|12:12|1|RWHW|SIP L1 BLCG unit12 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE11|11:11|1|RWHW|SIP L1 BLCG unit11 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE10|10:10|1|RWHW|SIP L1 BLCG unit10 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE9|9:9|1|RWHW|SIP L1 BLCG unit9 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE8|8:8|1|RWHW|SIP L1 BLCG unit8 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE7|7:7|1|RWHW|SIP L1 BLCG unit7 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE6|6:6|1|RWHW|SIP L1 BLCG unit6 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE5|5:5|1|RWHW|SIP L1 BLCG unit5 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE4|4:4|1|RWHW|SIP L1 BLCG unit4 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE3|3:3|1|RWHW|SIP L1 BLCG unit3 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE2|2:2|1|RWHW|SIP L1 BLCG unit2 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE1|1:1|1|RWHW|SIP L1 BLCG unit1 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|
|L1_BLCG_DISABLE0|0:0|1|RWHW|SIP L1 BLCG unit0 clock gating<br>disable control. Write 1 to disable<br>BLCG. Write 0 to enable BLCG.|

### 15.21. L1_BLCG_CTRL1

**Register Name:** `L1_BLCG_CTRL1`

- **Offset Address:** `0xE54`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|L1_SW_CLK_ENABLE23|23:23|1|RWHW|SIP L1 BLCG unit23 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE22|22:22|1|RWHW|SIP L1 BLCG unit22 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE21|21:21|1|RWHW|SIP L1 BLCG unit21 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE20|20:20|1|RWHW|SIP L1 BLCG unit20 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE19|19:19|1|RWHW|SIP L1 BLCG unit19 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE18|18:18|1|RWHW|SIP L1 BLCG unit18 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE17|17:17|1|RWHW|SIP L1 BLCG unit17 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE16|16:16|1|RWHW|SIP L1 BLCG unit16 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE15|15:15|1|RWHW|SIP L1 BLCG unit15 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE14|14:14|1|RWHW|SIP L1 BLCG unit14 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE13|13:13|1|RWHW|SIP L1 BLCG unit13 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE12|12:12|1|RWHW|SIP L1 BLCG unit12 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE11|11:11|1|RWHW|SIP L1 BLCG unit11 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE10|10:10|1|RWHW|SIP L1 BLCG unit10 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE9|9:9|1|RWHW|SIP L1 BLCG unit9 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE8|8:8|1|RWHW|SIP L1 BLCG unit8 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE7|7:7|1|RWHW|SIP L1 BLCG unit7 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE6|6:6|1|RWHW|SIP L1 BLCG unit6 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE5|5:5|1|RWHW|SIP L1 BLCG unit5 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE4|4:4|1|RWHW|SIP L1 BLCG unit4 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE3|3:3|1|RWHW|SIP L1 BLCG unit3 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE2|2:2|1|RWHW|SIP L1 BLCG unit2 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE1|1:1|1|RWHW|SIP L1 BLCG unit1 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|
|L1_SW_CLK_ENABLE0|0:0|1|RWHW|SIP L1 BLCG unit0 clock disable<br>control. Write 1 to enable clock in<br>BLCG unit. Write 0 to disable clock<br>in BLCG unit.|

### 15.22. L1_ELCG_CTRL

**Register Name:** `L1_ELCG_CTRL`

- **Offset Address:** `0xE58`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ELCG_CLK_EN|5:5|1|RO|Reserved. This register is no longer<br>used.|
|ELCG_DISABLE|4:4|1|RWHW|Reserved. This register is no longer<br>used.|
|ELCG_IDLE_DELAY|3:0|f|RWHW|Reserved. This register is no longer<br>used.|

### 15.23. L1_AXIM_HASH_MASK0

**Register Name:** `L1_AXIM_HASH_MASK0`

- **Offset Address:** `0xE60`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|AXIM_HASH_MASK0|15:0|c10b|RWHW|Hash mask to calculate dsta SIP ID<br>DST_SIP_ID[0] = bit_xor(VA[22:7] &<br>AXIM_HASH_MASK0).|

### 15.24. L1_AXIM_HASH_MASK1

**Register Name:** `L1_AXIM_HASH_MASK1`

- **Offset Address:** `0xE64`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|AXIM_HASH_MASK1|14:0|4b97|RWHW|Hash mask to calculate dsta SIP ID<br>DST_SIP_ID[1] = bit_xor(VA[22:8] &<br>AXIM_HASH_MASK1).|

### 15.25. L1_AXIM_HASH_MASK2

**Register Name:** `L1_AXIM_HASH_MASK2`

- **Offset Address:** `0xE68`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|AXIM_HASH_MASK2|14:0|172e|RWHW|Hash mask to calculate dsta SIP ID<br>DST_SIP_ID[2] = bit_xor(VA[22:8] &<br>AXIM_HASH_MASK2).|

### 15.26. L1_AXIM_HASH_MASK3

**Register Name:** `L1_AXIM_HASH_MASK3`

- **Offset Address:** `0xE6C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|AXIM_HASH_MASK3|31:0|c290a429|RWHW|Hash mask to select DF0/DF1<br>master port|

### 15.27. L1_SIC_TILE_MAPPING

**Register Name:** `L1_SIC_TILE_MAPPING`

- **Offset Address:** `0xE70`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SIP7_SIC_TILE_ID|31:28|0|RWHW|SIC_TILE_ID of logic SIP7 in current SIC<br>after harvest|
|SIP6_SIC_TILE_ID|27:24|0|RWHW|SIC_TILE_ID of logic SIP6 in current SIC<br>after harvest|
|SIP5_SIC_TILE_ID|23:20|0|RWHW|SIC_TILE_ID of logic SIP5 in current SIC<br>after harvest|
|SIP4_SIC_TILE_ID|19:16|0|RWHW|SIC_TILE_ID of logic SIP4 in current SIC<br>after harvest|
|SIP3_SIC_TILE_ID|15:12|0|RWHW|SIC_TILE_ID of logic SIP3 in current SIC<br>after harvest|
|SIP2_SIC_TILE_ID|11:8|0|RWHW|SIC_TILE_ID of logic SIP2 in current SIC<br>after harvest|
|SIP1_SIC_TILE_ID|7:4|0|RWHW|SIC_TILE_ID of logic SIP1 in current SIC<br>after harvest|
|SIP0_SIC_TILE_ID|3:0|0|RWHW|SIC_TILE_ID of logic SIP0 in current SIC<br>after harvest|

### 15.28. L1_MISC

**Register Name:** `L1_MISC`

- **Offset Address:** `0xE78`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VDMEM_PATH_ABS_SEL|1:1|0|RWHW|Arbitration strategy for VDMEM<br>access<br>0: SDTE > VST&GS > VLD<br>1: Reserved|
|DISP_SCL_TO_GSCH|0:0|1|RWHW|1: Scalar access to VDMEM uses GS<br>channel when L1 is handling vector<br>GS request|

### 15.29. L1_DSM_BASE

**Register Name:** `L1_DSM_BASE`

- **Offset Address:** `0xE7C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DSM_BASE|7:0|4|RWHW|Reserved. This register is no longer used.|

### 15.30. AWP0_L1_ADDR_LO

**Register Name:** `AWP0_L1_ADDR_LO`

- **Offset Address:** `0xE80`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ADDR_LO|31:0|0|RWHW|Reserved. This register is no longer used.|

### 15.31. AWP0_L1_ADDR_HI

**Register Name:** `AWP0_L1_ADDR_HI`

- **Offset Address:** `0xE84`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ADDR_HI|15:0|0|RWHW|Reserved. This register is no longer used.|

### 15.32. AWP0_L1_MASK

**Register Name:** `AWP0_L1_MASK`

- **Offset Address:** `0xE88`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CMP_MASK|5:0|0|RWHW|Reserved. This register is no longer used.|

### 15.33. AWP0_L1_CTRL

**Register Name:** `AWP0_L1_CTRL`

- **Offset Address:** `0xE8C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ASID|7:4|0|RWHW|Reserved. This register is no longer used.|
|CMP_EN|0:0|0|RWHW|Reserved. This register is no longer used.|

### 15.34. AWP1_L1_ADDR_LO

**Register Name:** `AWP1_L1_ADDR_LO`

- **Offset Address:** `0xE90`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ADDR_LO|31:0|0|RWHW|Reserved. This register is no longer used.|

### 15.35. AWP1_L1_ADDR_HI

**Register Name:** `AWP1_L1_ADDR_HI`

- **Offset Address:** `0xE94`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ADDR_HI|15:0|0|RWHW|Reserved. This register is no longer used.|

### 15.36. AWP1_L1_MASK

**Register Name:** `AWP1_L1_MASK`

- **Offset Address:** `0xE98`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CMP_MASK|5:0|0|RWHW|Reserved. This register is no longer used.|

### 15.37. AWP1_L1_CTRL

**Register Name:** `AWP1_L1_CTRL`

- **Offset Address:** `0xE9C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ASID|7:4|0|RWHW|Reserved. This register is no longer used.|
|CMP_EN|3:3|0|RWHW|Reserved. This register is no longer used.|

### 15.38. L1_SCRATCH0

**Register Name:** `L1_SCRATCH0`

- **Offset Address:** `0xEA0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register!!!|

### 15.39. L1_SCRATCH1

**Register Name:** `L1_SCRATCH1`

- **Offset Address:** `0xEA4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|Bit[0]: Cache prefetch/overfetch issue fix bit.<br>Should be "1" in normal usage<br>Others: Reserved|

### 15.40. L1_SCRATCH2

**Register Name:** `L1_SCRATCH2`

- **Offset Address:** `0xEA8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register!!!|

### 15.41. L1_SCRATCH3

**Register Name:** `L1_SCRATCH3`

- **Offset Address:** `0xEAC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register!!!|

### 15.42. L1_SCRATCH4

**Register Name:** `L1_SCRATCH4`

- **Offset Address:** `0xEB0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register!!!|

### 15.43. L1_SCRATCH5

**Register Name:** `L1_SCRATCH5`

- **Offset Address:** `0xEB4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register!!!|

### 15.44. L1_SCRATCH6

**Register Name:** `L1_SCRATCH6`

- **Offset Address:** `0xEB8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register!!!|

### 15.45. L1_SCRATCH7

**Register Name:** `L1_SCRATCH7`

- **Offset Address:** `0xEBC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RWHW|SW Should not write this register!!!|


## 16. CSR Details: Common CSR

### 16.1. THD0_RPC_SEND_MSG_LO

**Register Name:** `THD0_RPC_SEND_MSG_LO`

- **Offset Address:** `0xF00`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_LO|31:0|0|RWHW|RPC_send_message[31:0];|

### 16.2. THD0_RPC_SEND_MSG_HI

**Register Name:** `THD0_RPC_SEND_MSG_HI`

- **Offset Address:** `0xF04`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_HI|31:0|0|RWHW|RPC_send_message[63:32];|

### 16.3. THD0_RPC_SEND_DST

**Register Name:** `THD0_RPC_SEND_DST`

- **Offset Address:** `0xF08`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|31:0|0|RWHW|The RPC server address to where the<br>RPC_send_message send. Use ECF address<br>space.<br>Only [29:0] is valid. The 2 MSBs will be<br>ignored.|

### 16.4. THD0_RPC_SEND_CFG

**Register Name:** `THD0_RPC_SEND_CFG`

- **Offset Address:** `0xF0C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND|0:0|0|RWHW|Set this bit to send the message. SW set and HW<br>clear.<br>If this bit is set, SW should not update<br>RPC_send_message or RPC_send_dst until it is<br>cleared.|

### 16.5. THD0_RPC_STS

**Register Name:** `THD0_RPC_STS`

- **Offset Address:** `0xF10`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_CNT|3:0|0|RO|Indicate how many received messages for this<br>context. Valid range 0~1;<br>Set and cleared both by HW. CNT++ after receives<br>one message and CNT-- when write 1 to<br>RPC_RCV_MSG_POP.|

### 16.6. THD0_RPC_RCV_MSG_POP

**Register Name:** `THD0_RPC_RCV_MSG_POP`

- **Offset Address:** `0xF14`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_POP|0:0|0|RWHW|Write 1 to this field to pop one RPC<br>respence package when RPC_STS.CNT is<br>not 0.|

### 16.7. THD0_RPC_RCV_MSG_LO

**Register Name:** `THD0_RPC_RCV_MSG_LO`

- **Offset Address:** `0xF18`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_LO|31:0|0|RWHW|RPC_receive_message[31:0].|

### 16.8. THD0_RPC_RCV_MSG_HI

**Register Name:** `THD0_RPC_RCV_MSG_HI`

- **Offset Address:** `0xF1C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_HI|31:0|0|RWHW|RPC_receive_message[63:32].|

### 16.9. THD1_RPC_SEND_MSG_LO

**Register Name:** `THD1_RPC_SEND_MSG_LO`

- **Offset Address:** `0xF20`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_LO|31:0|0|RWHW|RPC_send_message[31:0];|

### 16.10. THD1_RPC_SEND_MSG_HI

**Register Name:** `THD1_RPC_SEND_MSG_HI`

- **Offset Address:** `0xF24`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_HI|31:0|0|RWHW|RPC_send_message[63:32];|

### 16.11. THD1_RPC_SEND_DST

**Register Name:** `THD1_RPC_SEND_DST`

- **Offset Address:** `0xF28`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|31:0|0|RWHW|The RPC server address to where the<br>RPC_send_message send. Use ECF address<br>space.<br>Only [29:0] is valid. The 2 MSBs will be<br>ignored.|

### 16.12. THD1_RPC_SEND_CFG

**Register Name:** `THD1_RPC_SEND_CFG`

- **Offset Address:** `0xF2C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND|0:0|0|RWHW|Set this bit to send the message. SW set and HW<br>clear.<br>If this bit is set, SW should not update<br>RPC_send_message or RPC_send_dst until it is<br>cleared.|

### 16.13. THD1_RPC_STS

**Register Name:** `THD1_RPC_STS`

- **Offset Address:** `0xF30`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_CNT|3:0|0|RO|Indicate how many received messages for this<br>context. Valid range 0~1;<br>Set and cleared both by HW. CNT++ after receives<br>one message and CNT-- when write 1 to<br>RPC_RCV_MSG_POP.|

### 16.14. THD1_RPC_RCV_MSG_POP

**Register Name:** `THD1_RPC_RCV_MSG_POP`

- **Offset Address:** `0xF34`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_POP|0:0|0|RWHW|Write 1 to this field to pop one RPC<br>respence package when RPC_STS.CNT is<br>not 0.|

### 16.15. THD1_RPC_RCV_MSG_LO

**Register Name:** `THD1_RPC_RCV_MSG_LO`

- **Offset Address:** `0xF38`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_LO|31:0|0|RWHW|RPC_receive_message[31:0].|

### 16.16. THD1_RPC_RCV_MSG_HI

**Register Name:** `THD1_RPC_RCV_MSG_HI`

- **Offset Address:** `0xF3C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_HI|31:0|0|RWHW|RPC_receive_message[63:32].|

### 16.17. THD2_RPC_SEND_MSG_LO

**Register Name:** `THD2_RPC_SEND_MSG_LO`

- **Offset Address:** `0xF40`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_LO|31:0|0|RWHW|RPC_send_message[31:0];|

### 16.18. THD2_RPC_SEND_MSG_HI

**Register Name:** `THD2_RPC_SEND_MSG_HI`

- **Offset Address:** `0xF44`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_HI|31:0|0|RWHW|RPC_send_message[63:32];|

### 16.19. THD2_RPC_SEND_DST

**Register Name:** `THD2_RPC_SEND_DST`

- **Offset Address:** `0xF48`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|31:0|0|RWHW|The RPC server address to where the<br>RPC_send_message send. Use ECF address<br>space.<br>Only [29:0] is valid. The 2 MSBs will be<br>ignored.|

### 16.20. THD2_RPC_SEND_CFG

**Register Name:** `THD2_RPC_SEND_CFG`

- **Offset Address:** `0xF4C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND|0:0|0|RWHW|Set this bit to send the message. SW set and HW<br>clear.<br>If this bit is set, SW should not update<br>RPC_send_message or RPC_send_dst until it is<br>cleared.|

### 16.21. THD2_RPC_STS

**Register Name:** `THD2_RPC_STS`

- **Offset Address:** `0xF50`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_CNT|3:0|0|RO|Indicate how many received messages for this<br>context. Valid range 0~1;<br>Set and cleared both by HW. CNT++ after receives<br>one message and CNT-- when write 1 to<br>RPC_RCV_MSG_POP.|

### 16.22. THD2_RPC_RCV_MSG_POP

**Register Name:** `THD2_RPC_RCV_MSG_POP`

- **Offset Address:** `0xF54`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_POP|0:0|0|RWHW|Write 1 to this field to pop one RPC<br>respence package when RPC_STS.CNT is<br>not 0.|

### 16.23. THD2_RPC_RCV_MSG_LO

**Register Name:** `THD2_RPC_RCV_MSG_LO`

- **Offset Address:** `0xF58`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_LO|31:0|0|RWHW|RPC_receive_message[31:0].|

### 16.24. THD2_RPC_RCV_MSG_HI

**Register Name:** `THD2_RPC_RCV_MSG_HI`

- **Offset Address:** `0xF5C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_HI|31:0|0|RWHW|RPC_receive_message[63:32].|

### 16.25. THD3_RPC_SEND_MSG_LO

**Register Name:** `THD3_RPC_SEND_MSG_LO`

- **Offset Address:** `0xF60`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_LO|31:0|0|RWHW|RPC_send_message[31:0];|

### 16.26. THD3_RPC_SEND_MSG_HI

**Register Name:** `THD3_RPC_SEND_MSG_HI`

- **Offset Address:** `0xF64`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_HI|31:0|0|RWHW|RPC_send_message[63:32];|

### 16.27. THD3_RPC_SEND_DST

**Register Name:** `THD3_RPC_SEND_DST`

- **Offset Address:** `0xF68`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|31:0|0|RWHW|The RPC server address to where the<br>RPC_send_message send. Use ECF address<br>space.<br>Only [29:0] is valid. The 2 MSBs will be<br>ignored.|

### 16.28. THD3_RPC_SEND_CFG

**Register Name:** `THD3_RPC_SEND_CFG`

- **Offset Address:** `0xF6C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND|0:0|0|RWHW|Set this bit to send the message. SW set and HW<br>clear.<br>If this bit is set, SW should not update<br>RPC_send_message or RPC_send_dst until it is<br>cleared.|

### 16.29. THD3_RPC_STS

**Register Name:** `THD3_RPC_STS`

- **Offset Address:** `0xF70`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_CNT|3:0|0|RO|Indicate how many received messages for this<br>context. Valid range 0~1;<br>Set and cleared both by HW. CNT++ after receives<br>one message and CNT-- when write 1 to<br>RPC_RCV_MSG_POP.|

### 16.30. THD3_RPC_RCV_MSG_POP

**Register Name:** `THD3_RPC_RCV_MSG_POP`

- **Offset Address:** `0xF74`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_POP|0:0|0|RWHW|Write 1 to this field to pop one RPC<br>respence package when RPC_STS.CNT is<br>not 0.|

### 16.31. THD3_RPC_RCV_MSG_LO

**Register Name:** `THD3_RPC_RCV_MSG_LO`

- **Offset Address:** `0xF78`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_LO|31:0|0|RWHW|RPC_receive_message[31:0].|

### 16.32. THD3_RPC_RCV_MSG_HI

**Register Name:** `THD3_RPC_RCV_MSG_HI`

- **Offset Address:** `0xF7C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_HI|31:0|0|RWHW|RPC_receive_message[63:32].|

### 16.33. THD4_RPC_SEND_MSG_LO

**Register Name:** `THD4_RPC_SEND_MSG_LO`

- **Offset Address:** `0xF80`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_LO|31:0|0|RWHW|RPC_send_message[31:0];|

### 16.34. THD4_RPC_SEND_MSG_HI

**Register Name:** `THD4_RPC_SEND_MSG_HI`

- **Offset Address:** `0xF84`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_HI|31:0|0|RWHW|RPC_send_message[63:32];|

### 16.35. THD4_RPC_SEND_DST

**Register Name:** `THD4_RPC_SEND_DST`

- **Offset Address:** `0xF88`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|31:0|0|RWHW|The RPC server address to where the<br>RPC_send_message send. Use ECF address<br>space.<br>Only [29:0] is valid. The 2 MSBs will be<br>ignored.|

### 16.36. THD4_RPC_SEND_CFG

**Register Name:** `THD4_RPC_SEND_CFG`

- **Offset Address:** `0xF8C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND|0:0|0|RWHW|Set this bit to send the message. SW set and HW<br>clear.<br>If this bit is set, SW should not update<br>RPC_send_message or RPC_send_dst until it is<br>cleared.|

### 16.37. THD4_RPC_STS

**Register Name:** `THD4_RPC_STS`

- **Offset Address:** `0xF90`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_CNT|3:0|0|RO|Indicate how many received messages for this<br>context. Valid range 0~1;<br>Set and cleared both by HW. CNT++ after receives<br>one message and CNT-- when write 1 to<br>RPC_RCV_MSG_POP.|

### 16.38. THD4_RPC_RCV_MSG_POP

**Register Name:** `THD4_RPC_RCV_MSG_POP`

- **Offset Address:** `0xF94`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_POP|0:0|0|RWHW|Write 1 to this field to pop one RPC<br>respence package when RPC_STS.CNT is<br>not 0.|

### 16.39. THD4_RPC_RCV_MSG_LO

**Register Name:** `THD4_RPC_RCV_MSG_LO`

- **Offset Address:** `0xF98`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_LO|31:0|0|RWHW|RPC_receive_message[31:0].|

### 16.40. THD4_RPC_RCV_MSG_HI

**Register Name:** `THD4_RPC_RCV_MSG_HI`

- **Offset Address:** `0xF9C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_HI|31:0|0|RWHW|RPC_receive_message[63:32].|

### 16.41. THD5_RPC_SEND_MSG_LO

**Register Name:** `THD5_RPC_SEND_MSG_LO`

- **Offset Address:** `0xFA0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_LO|31:0|0|RWHW|RPC_send_message[31:0];|

### 16.42. THD5_RPC_SEND_MSG_HI

**Register Name:** `THD5_RPC_SEND_MSG_HI`

- **Offset Address:** `0xFA4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_HI|31:0|0|RWHW|RPC_send_message[63:32];|

### 16.43. THD5_RPC_SEND_DST

**Register Name:** `THD5_RPC_SEND_DST`

- **Offset Address:** `0xFA8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|31:0|0|RWHW|The RPC server address to where the<br>RPC_send_message send. Use ECF address<br>space.<br>Only [29:0] is valid. The 2 MSBs will be<br>ignored.|

### 16.44. THD5_RPC_SEND_CFG

**Register Name:** `THD5_RPC_SEND_CFG`

- **Offset Address:** `0xFAC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND|0:0|0|RWHW|Set this bit to send the message. SW set and HW<br>clear.<br>If this bit is set, SW should not update<br>RPC_send_message or RPC_send_dst until it is<br>cleared.|

### 16.45. THD5_RPC_STS

**Register Name:** `THD5_RPC_STS`

- **Offset Address:** `0xFB0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_CNT|3:0|0|RO|Indicate how many received messages for this<br>context. Valid range 0~1;<br>Set and cleared both by HW. CNT++ after receives<br>one message and CNT-- when write 1 to<br>RPC_RCV_MSG_POP.|

### 16.46. THD5_RPC_RCV_MSG_POP

**Register Name:** `THD5_RPC_RCV_MSG_POP`

- **Offset Address:** `0xFB4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_POP|0:0|0|RWHW|Write 1 to this field to pop one RPC<br>respence package when RPC_STS.CNT is<br>not 0.|

### 16.47. THD5_RPC_RCV_MSG_LO

**Register Name:** `THD5_RPC_RCV_MSG_LO`

- **Offset Address:** `0xFB8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_LO|31:0|0|RWHW|RPC_receive_message[31:0].|

### 16.48. THD5_RPC_RCV_MSG_HI

**Register Name:** `THD5_RPC_RCV_MSG_HI`

- **Offset Address:** `0xFBC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_HI|31:0|0|RWHW|RPC_receive_message[63:32].|

### 16.49. THD6_RPC_SEND_MSG_LO

**Register Name:** `THD6_RPC_SEND_MSG_LO`

- **Offset Address:** `0xFC0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_LO|31:0|0|RWHW|RPC_send_message[31:0];|

### 16.50. THD6_RPC_SEND_MSG_HI

**Register Name:** `THD6_RPC_SEND_MSG_HI`

- **Offset Address:** `0xFC4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_HI|31:0|0|RWHW|RPC_send_message[63:32];|

### 16.51. THD6_RPC_SEND_DST

**Register Name:** `THD6_RPC_SEND_DST`

- **Offset Address:** `0xFC8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|31:0|0|RWHW|The RPC server address to where the<br>RPC_send_message send. Use ECF address<br>space.<br>Only [29:0] is valid. The 2 MSBs will be<br>ignored.|

### 16.52. THD6_RPC_SEND_CFG

**Register Name:** `THD6_RPC_SEND_CFG`

- **Offset Address:** `0xFCC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND|0:0|0|RWHW|Set this bit to send the message. SW set and HW<br>clear.<br>If this bit is set, SW should not update<br>RPC_send_message or RPC_send_dst until it is<br>cleared.|

### 16.53. THD6_RPC_STS

**Register Name:** `THD6_RPC_STS`

- **Offset Address:** `0xFD0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_CNT|3:0|0|RO|Indicate how many received messages for this<br>context. Valid range 0~1;<br>Set and cleared both by HW. CNT++ after receives<br>one message and CNT-- when write 1 to<br>RPC_RCV_MSG_POP.|

### 16.54. THD6_RPC_RCV_MSG_POP

**Register Name:** `THD6_RPC_RCV_MSG_POP`

- **Offset Address:** `0xFD4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_POP|0:0|0|RWHW|Write 1 to this field to pop one RPC<br>respence package when RPC_STS.CNT is<br>not 0.|

### 16.55. THD6_RPC_RCV_MSG_LO

**Register Name:** `THD6_RPC_RCV_MSG_LO`

- **Offset Address:** `0xFD8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_LO|31:0|0|RWHW|RPC_receive_message[31:0].|

### 16.56. THD6_RPC_RCV_MSG_HI

**Register Name:** `THD6_RPC_RCV_MSG_HI`

- **Offset Address:** `0xFDC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_HI|31:0|0|RWHW|RPC_receive_message[63:32].|

### 16.57. THD7_RPC_SEND_MSG_LO

**Register Name:** `THD7_RPC_SEND_MSG_LO`

- **Offset Address:** `0xFE0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_LO|31:0|0|RWHW|RPC_send_message[31:0];|

### 16.58. THD7_RPC_SEND_MSG_HI

**Register Name:** `THD7_RPC_SEND_MSG_HI`

- **Offset Address:** `0xFE4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_HI|31:0|0|RWHW|RPC_send_message[63:32];|

### 16.59. THD7_RPC_SEND_DST

**Register Name:** `THD7_RPC_SEND_DST`

- **Offset Address:** `0xFE8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|31:0|0|RWHW|The RPC server address to where the<br>RPC_send_message send. Use ECF address<br>space.<br>Only [29:0] is valid. The 2 MSBs will be<br>ignored.|

### 16.60. THD7_RPC_SEND_CFG

**Register Name:** `THD7_RPC_SEND_CFG`

- **Offset Address:** `0xFEC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND|0:0|0|RWHW|Set this bit to send the message. SW set and HW<br>clear.<br>If this bit is set, SW should not update<br>RPC_send_message or RPC_send_dst until it is<br>cleared.|

### 16.61. THD7_RPC_STS

**Register Name:** `THD7_RPC_STS`

- **Offset Address:** `0xFF0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_CNT|3:0|0|RO|Indicate how many received messages for this<br>context. Valid range 0~1;<br>Set and cleared both by HW. CNT++ after receives<br>one message and CNT-- when write 1 to<br>RPC_RCV_MSG_POP.|

### 16.62. THD7_RPC_RCV_MSG_POP

**Register Name:** `THD7_RPC_RCV_MSG_POP`

- **Offset Address:** `0xFF4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_POP|0:0|0|RWHW|Write 1 to this field to pop one RPC<br>respence package when RPC_STS.CNT is<br>not 0.|

### 16.63. THD7_RPC_RCV_MSG_LO

**Register Name:** `THD7_RPC_RCV_MSG_LO`

- **Offset Address:** `0xFF8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_LO|31:0|0|RWHW|RPC_receive_message[31:0].|

### 16.64. THD7_RPC_RCV_MSG_HI

**Register Name:** `THD7_RPC_RCV_MSG_HI`

- **Offset Address:** `0xFFC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_HI|31:0|0|RWHW|RPC_receive_message[63:32].|

### 16.65. THD8_RPC_SEND_MSG_LO

**Register Name:** `THD8_RPC_SEND_MSG_LO`

- **Offset Address:** `0x1000`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_LO|31:0|0|RWHW|RPC_send_message[31:0];|

### 16.66. THD8_RPC_SEND_MSG_HI

**Register Name:** `THD8_RPC_SEND_MSG_HI`

- **Offset Address:** `0x1004`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_HI|31:0|0|RWHW|RPC_send_message[63:32];|

### 16.67. THD8_RPC_SEND_DST

**Register Name:** `THD8_RPC_SEND_DST`

- **Offset Address:** `0x1008`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|31:0|0|RWHW|The RPC server address to where the<br>RPC_send_message send. Use ECF address<br>space.<br>Only [29:0] is valid. The 2 MSBs will be<br>ignored.|

### 16.68. THD8_RPC_SEND_CFG

**Register Name:** `THD8_RPC_SEND_CFG`

- **Offset Address:** `0x100C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND|0:0|0|RWHW|Set this bit to send the message. SW set and HW<br>clear.<br>If this bit is set, SW should not update<br>RPC_send_message or RPC_send_dst until it is<br>cleared.|

### 16.69. THD8_RPC_STS

**Register Name:** `THD8_RPC_STS`

- **Offset Address:** `0x1010`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_CNT|3:0|0|RO|Indicate how many received messages for this<br>context. Valid range 0~1;<br>Set and cleared both by HW. CNT++ after receives<br>one message and CNT-- when write 1 to<br>RPC_RCV_MSG_POP.|

### 16.70. THD8_RPC_RCV_MSG_POP

**Register Name:** `THD8_RPC_RCV_MSG_POP`

- **Offset Address:** `0x1014`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_POP|0:0|0|RWHW|Write 1 to this field to pop one RPC<br>respence package when RPC_STS.CNT is<br>not 0.|

### 16.71. THD8_RPC_RCV_MSG_LO

**Register Name:** `THD8_RPC_RCV_MSG_LO`

- **Offset Address:** `0x1018`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_LO|31:0|0|RWHW|RPC_receive_message[31:0].|

### 16.72. THD8_RPC_RCV_MSG_HI

**Register Name:** `THD8_RPC_RCV_MSG_HI`

- **Offset Address:** `0x101C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_HI|31:0|0|RWHW|RPC_receive_message[63:32].|

### 16.73. THD9_RPC_SEND_MSG_LO

**Register Name:** `THD9_RPC_SEND_MSG_LO`

- **Offset Address:** `0x1020`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_LO|31:0|0|RWHW|RPC_send_message[31:0];|

### 16.74. THD9_RPC_SEND_MSG_HI

**Register Name:** `THD9_RPC_SEND_MSG_HI`

- **Offset Address:** `0x1024`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_HI|31:0|0|RWHW|RPC_send_message[63:32];|

### 16.75. THD9_RPC_SEND_DST

**Register Name:** `THD9_RPC_SEND_DST`

- **Offset Address:** `0x1028`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|31:0|0|RWHW|The RPC server address to where the<br>RPC_send_message send. Use ECF address<br>space.<br>Only [29:0] is valid. The 2 MSBs will be<br>ignored.|

### 16.76. THD9_RPC_SEND_CFG

**Register Name:** `THD9_RPC_SEND_CFG`

- **Offset Address:** `0x102C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND|0:0|0|RWHW|Set this bit to send the message. SW set and HW<br>clear.<br>If this bit is set, SW should not update<br>RPC_send_message or RPC_send_dst until it is<br>cleared.|

### 16.77. THD9_RPC_STS

**Register Name:** `THD9_RPC_STS`

- **Offset Address:** `0x1030`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_CNT|3:0|0|RO|Indicate how many received messages for this<br>context. Valid range 0~1;<br>Set and cleared both by HW. CNT++ after receives<br>one message and CNT-- when write 1 to<br>RPC_RCV_MSG_POP.|

### 16.78. THD9_RPC_RCV_MSG_POP

**Register Name:** `THD9_RPC_RCV_MSG_POP`

- **Offset Address:** `0x1034`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_POP|0:0|0|RWHW|Write 1 to this field to pop one RPC<br>respence package when RPC_STS.CNT is<br>not 0.|

### 16.79. THD9_RPC_RCV_MSG_LO

**Register Name:** `THD9_RPC_RCV_MSG_LO`

- **Offset Address:** `0x1038`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_LO|31:0|0|RWHW|RPC_receive_message[31:0].|

### 16.80. THD9_RPC_RCV_MSG_HI

**Register Name:** `THD9_RPC_RCV_MSG_HI`

- **Offset Address:** `0x103C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_HI|31:0|0|RWHW|RPC_receive_message[63:32].|

### 16.81. THD10_RPC_SEND_MSG_LO

**Register Name:** `THD10_RPC_SEND_MSG_LO`

- **Offset Address:** `0x1040`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_LO|31:0|0|RWHW|Reserved|

### 16.82. THD10_RPC_SEND_MSG_HI

**Register Name:** `THD10_RPC_SEND_MSG_HI`

- **Offset Address:** `0x1044`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_HI|31:0|0|RWHW|Reserved|

### 16.83. THD10_RPC_SEND_DST

**Register Name:** `THD10_RPC_SEND_DST`

- **Offset Address:** `0x1048`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|31:0|0|RWHW|Reserved|

### 16.84. THD10_RPC_SEND_CFG

**Register Name:** `THD10_RPC_SEND_CFG`

- **Offset Address:** `0x104C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND|0:0|0|RWHW|Reserved|

### 16.85. THD10_RPC_STS

**Register Name:** `THD10_RPC_STS`

- **Offset Address:** `0x1050`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_CNT|3:0|0|RO|Reserved|

### 16.86. THD10_RPC_RCV_MSG_POP

**Register Name:** `THD10_RPC_RCV_MSG_POP`

- **Offset Address:** `0x1054`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_POP|0:0|0|RWHW|Reserved|

### 16.87. THD10_RPC_RCV_MSG_LO

**Register Name:** `THD10_RPC_RCV_MSG_LO`

- **Offset Address:** `0x1058`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_LO|31:0|0|RWHW|Reserved|

### 16.88. THD10_RPC_RCV_MSG_HI

**Register Name:** `THD10_RPC_RCV_MSG_HI`

- **Offset Address:** `0x105C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_HI|31:0|0|RWHW|Reserved|

### 16.89. THD11_RPC_SEND_MSG_LO

**Register Name:** `THD11_RPC_SEND_MSG_LO`

- **Offset Address:** `0x1060`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_LO|31:0|0|RWHW|Reserved|

### 16.90. THD11_RPC_SEND_MSG_HI

**Register Name:** `THD11_RPC_SEND_MSG_HI`

- **Offset Address:** `0x1064`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_HI|31:0|0|RWHW|Reserved|

### 16.91. THD11_RPC_SEND_DST

**Register Name:** `THD11_RPC_SEND_DST`

- **Offset Address:** `0x1068`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|31:0|0|RWHW|Reserved|

### 16.92. THD11_RPC_SEND_CFG

**Register Name:** `THD11_RPC_SEND_CFG`

- **Offset Address:** `0x106C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND|0:0|0|RWHW|Reserved|

### 16.93. THD11_RPC_STS

**Register Name:** `THD11_RPC_STS`

- **Offset Address:** `0x1070`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_CNT|3:0|0|RO|Reserved|

### 16.94. THD11_RPC_RCV_MSG_POP

**Register Name:** `THD11_RPC_RCV_MSG_POP`

- **Offset Address:** `0x1074`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_POP|0:0|0|RWHW|Reserved|

### 16.95. THD11_RPC_RCV_MSG_LO

**Register Name:** `THD11_RPC_RCV_MSG_LO`

- **Offset Address:** `0x1078`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_LO|31:0|0|RWHW|Reserved|

### 16.96. THD11_RPC_RCV_MSG_HI

**Register Name:** `THD11_RPC_RCV_MSG_HI`

- **Offset Address:** `0x107C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_HI|31:0|0|RWHW|Reserved|

### 16.97. THD12_RPC_SEND_MSG_LO

**Register Name:** `THD12_RPC_SEND_MSG_LO`

- **Offset Address:** `0x1080`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_LO|31:0|0|RWHW|Reserved|

### 16.98. THD12_RPC_SEND_MSG_HI

**Register Name:** `THD12_RPC_SEND_MSG_HI`

- **Offset Address:** `0x1084`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_HI|31:0|0|RWHW|Reserved|

### 16.99. THD12_RPC_SEND_DST

**Register Name:** `THD12_RPC_SEND_DST`

- **Offset Address:** `0x1088`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|31:0|0|RWHW|Reserved|

### 16.100. THD12_RPC_SEND_CFG

**Register Name:** `THD12_RPC_SEND_CFG`

- **Offset Address:** `0x108C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND|0:0|0|RWHW|Reserved|

### 16.101. THD12_RPC_STS

**Register Name:** `THD12_RPC_STS`

- **Offset Address:** `0x1090`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_CNT|3:0|0|RO|Reserved|

### 16.102. THD12_RPC_RCV_MSG_POP

**Register Name:** `THD12_RPC_RCV_MSG_POP`

- **Offset Address:** `0x1094`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_POP|0:0|0|RWHW|Reserved|

### 16.103. THD12_RPC_RCV_MSG_LO

**Register Name:** `THD12_RPC_RCV_MSG_LO`

- **Offset Address:** `0x1098`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_LO|31:0|0|RWHW|Reserved|

### 16.104. THD12_RPC_RCV_MSG_HI

**Register Name:** `THD12_RPC_RCV_MSG_HI`

- **Offset Address:** `0x109C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_HI|31:0|0|RWHW|Reserved|

### 16.105. THD13_RPC_SEND_MSG_LO

**Register Name:** `THD13_RPC_SEND_MSG_LO`

- **Offset Address:** `0x10A0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_LO|31:0|0|RWHW|Reserved|

### 16.106. THD13_RPC_SEND_MSG_HI

**Register Name:** `THD13_RPC_SEND_MSG_HI`

- **Offset Address:** `0x10A4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_HI|31:0|0|RWHW|Reserved|

### 16.107. THD13_RPC_SEND_DST

**Register Name:** `THD13_RPC_SEND_DST`

- **Offset Address:** `0x10A8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|31:0|0|RWHW|Reserved|

### 16.108. THD13_RPC_SEND_CFG

**Register Name:** `THD13_RPC_SEND_CFG`

- **Offset Address:** `0x10AC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND|0:0|0|RWHW|Reserved|

### 16.109. THD13_RPC_STS

**Register Name:** `THD13_RPC_STS`

- **Offset Address:** `0x10B0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_CNT|3:0|0|RO|Reserved|

### 16.110. THD13_RPC_RCV_MSG_POP

**Register Name:** `THD13_RPC_RCV_MSG_POP`

- **Offset Address:** `0x10B4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_POP|0:0|0|RWHW|Reserved|

### 16.111. THD13_RPC_RCV_MSG_LO

**Register Name:** `THD13_RPC_RCV_MSG_LO`

- **Offset Address:** `0x10B8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_LO|31:0|0|RWHW|Reserved|

### 16.112. THD13_RPC_RCV_MSG_HI

**Register Name:** `THD13_RPC_RCV_MSG_HI`

- **Offset Address:** `0x10BC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_HI|31:0|0|RWHW|Reserved|

### 16.113. THD14_RPC_SEND_MSG_LO

**Register Name:** `THD14_RPC_SEND_MSG_LO`

- **Offset Address:** `0x10C0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_LO|31:0|0|RWHW|Reserved|

### 16.114. THD14_RPC_SEND_MSG_HI

**Register Name:** `THD14_RPC_SEND_MSG_HI`

- **Offset Address:** `0x10C4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_HI|31:0|0|RWHW|Reserved|

### 16.115. THD14_RPC_SEND_DST

**Register Name:** `THD14_RPC_SEND_DST`

- **Offset Address:** `0x10C8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|31:0|0|RWHW|Reserved|

### 16.116. THD14_RPC_SEND_CFG

**Register Name:** `THD14_RPC_SEND_CFG`

- **Offset Address:** `0x10CC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND|0:0|0|RWHW|Reserved|

### 16.117. THD14_RPC_STS

**Register Name:** `THD14_RPC_STS`

- **Offset Address:** `0x10D0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_CNT|3:0|0|RO|Reserved|

### 16.118. THD14_RPC_RCV_MSG_POP

**Register Name:** `THD14_RPC_RCV_MSG_POP`

- **Offset Address:** `0x10D4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_POP|0:0|0|RWHW|Reserved|

### 16.119. THD14_RPC_RCV_MSG_LO

**Register Name:** `THD14_RPC_RCV_MSG_LO`

- **Offset Address:** `0x10D8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_LO|31:0|0|RWHW|Reserved|

### 16.120. THD14_RPC_RCV_MSG_HI

**Register Name:** `THD14_RPC_RCV_MSG_HI`

- **Offset Address:** `0x10DC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_HI|31:0|0|RWHW|Reserved|

### 16.121. THD15_RPC_SEND_MSG_LO

**Register Name:** `THD15_RPC_SEND_MSG_LO`

- **Offset Address:** `0x10E0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_LO|31:0|0|RWHW|Reserved|

### 16.122. THD15_RPC_SEND_MSG_HI

**Register Name:** `THD15_RPC_SEND_MSG_HI`

- **Offset Address:** `0x10E4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_MSG_HI|31:0|0|RWHW|Reserved|

### 16.123. THD15_RPC_SEND_DST

**Register Name:** `THD15_RPC_SEND_DST`

- **Offset Address:** `0x10E8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|31:0|0|RWHW|Reserved|

### 16.124. THD15_RPC_SEND_CFG

**Register Name:** `THD15_RPC_SEND_CFG`

- **Offset Address:** `0x10EC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND|0:0|0|RWHW|Reserved|

### 16.125. THD15_RPC_STS

**Register Name:** `THD15_RPC_STS`

- **Offset Address:** `0x10F0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_CNT|3:0|0|RO|Reserved|

### 16.126. THD15_RPC_RCV_MSG_POP

**Register Name:** `THD15_RPC_RCV_MSG_POP`

- **Offset Address:** `0x10F4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_POP|0:0|0|RWHW|Reserved|

### 16.127. THD15_RPC_RCV_MSG_LO

**Register Name:** `THD15_RPC_RCV_MSG_LO`

- **Offset Address:** `0x10F8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_LO|31:0|0|RWHW|Reserved|

### 16.128. THD15_RPC_RCV_MSG_HI

**Register Name:** `THD15_RPC_RCV_MSG_HI`

- **Offset Address:** `0x10FC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RCV_MSG_HI|31:0|0|RWHW|Reserved|

### 16.129. THD0_CTH_MSG_DAT

**Register Name:** `THD0_CTH_MSG_DAT`

- **Offset Address:** `0x1100`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_DAT|31:0|0|WO|Data port for thread0 message queue. The index<br>of message queue is THD0_CTH_MSG_IDX<br>Write to this register will put data into entry of<br>THD0_DATA_QUEUE[THD0_CTH_MSG_IDX] and<br>then increase THD0_CTH_MSG_IDX.|

### 16.130. THD0_CTH_MSG_IDX

**Register Name:** `THD0_CTH_MSG_IDX`

- **Offset Address:** `0x1104`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_IDX|3:0|0|RWHW|Index of thread0 message queue. Can be<br>updated by direct write. Will do self increase by<br>writing to THD0_CTH_MSG_DAT.|

### 16.131. THD0_CTH_DST

**Register Name:** `THD0_CTH_DST`

- **Offset Address:** `0x1108`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|29:0|0|RWHW|Reserved. This register is no longer used.|

### 16.132. THD0_CTH_CFG

**Register Name:** `THD0_CTH_CFG`

- **Offset Address:** `0x110C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TYPE_HI|12:8|0|RWHW|CTA event_type[8:4] field.|
|COUNTER|7:4|0|RWHW|4*(COUNTER+1) means how many byte to be<br>sent for this message|
|SEND|0:0|0|RWHW|"0" means this message queue is idle. "1"<br>means this message queue is busy to sending<br>message.<br>When this field is "0", write "1" to start<br>sending a message. And SW cannot write "0"<br>to stop the busy queue<br>Before config a message, SW should poll this<br>field to make sure the queue is idle.|

### 16.133. THD1_CTH_MSG_DAT

**Register Name:** `THD1_CTH_MSG_DAT`

- **Offset Address:** `0x1110`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_DAT|31:0|0|WO|Data port for thread0 message queue. The index<br>of message queue is THD1_CTH_MSG_IDX<br>Write to this register will put data into entry of<br>THD1_DATA_QUEUE[THD1_CTH_MSG_IDX] and<br>then increase THD1_CTH_MSG_IDX.|

### 16.134. THD1_CTH_MSG_IDX

**Register Name:** `THD1_CTH_MSG_IDX`

- **Offset Address:** `0x1114`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_IDX|3:0|0|RWHW|Index of thread0 message queue. Can be<br>updated by direct write. Will do self increase by<br>writing to THD1_CTH_MSG_DAT.|

### 16.135. THD1_CTH_DST

**Register Name:** `THD1_CTH_DST`

- **Offset Address:** `0x1118`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|29:0|0|RWHW|Reserved. This register is no longer used.|

### 16.136. THD1_CTH_CFG

**Register Name:** `THD1_CTH_CFG`

- **Offset Address:** `0x111C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TYPE_HI|12:8|0|RWHW|CTA event_type[8:4] field.|
|COUNTER|7:4|0|RWHW|4*(COUNTER+1) means how many byte to be<br>sent for this message|
|SEND|0:0|0|RWHW|"0" means this message queue is idle. "1"<br>means this message queue is busy to sending<br>message.<br>When this field is "0", write "1" to start<br>sending a message. And SW cannot write "0"<br>to stop the busy queue<br>Before config a message, SW should poll this<br>field to make sure the queue is idle.|

### 16.137. THD2_CTH_MSG_DAT

**Register Name:** `THD2_CTH_MSG_DAT`

- **Offset Address:** `0x1120`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_DAT|31:0|0|WO|Data port for thread0 message queue. The index<br>of message queue is THD2_CTH_MSG_IDX<br>Write to this register will put data into entry of<br>THD2_DATA_QUEUE[THD2_CTH_MSG_IDX] and<br>then increase THD2_CTH_MSG_IDX.|

### 16.138. THD2_CTH_MSG_IDX

**Register Name:** `THD2_CTH_MSG_IDX`

- **Offset Address:** `0x1124`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_IDX|3:0|0|RWHW|Index of thread0 message queue. Can be<br>updated by direct write. Will do self increase by<br>writing to THD2_CTH_MSG_DAT.|

### 16.139. THD2_CTH_DST

**Register Name:** `THD2_CTH_DST`

- **Offset Address:** `0x1128`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|29:0|0|RWHW|Reserved. This register is no longer used.|

### 16.140. THD2_CTH_CFG

**Register Name:** `THD2_CTH_CFG`

- **Offset Address:** `0x112C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TYPE_HI|12:8|0|RWHW|CTA event_type[8:4] field.|
|COUNTER|7:4|0|RWHW|4*(COUNTER+1) means how many byte to be<br>sent for this message|
|SEND|0:0|0|RWHW|"0" means this message queue is idle. "1"<br>means this message queue is busy to sending<br>message.<br>When this field is "0", write "1" to start<br>sending a message. And SW cannot write "0"<br>to stop the busy queue<br>Before config a message, SW should poll this<br>field to make sure the queue is idle.|

### 16.141. THD3_CTH_MSG_DAT

**Register Name:** `THD3_CTH_MSG_DAT`

- **Offset Address:** `0x1130`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_DAT|31:0|0|WO|Data port for thread0 message queue. The index<br>of message queue is THD3_CTH_MSG_IDX<br>Write to this register will put data into entry of<br>THD3_DATA_QUEUE[THD3_CTH_MSG_IDX] and<br>then increase THD3_CTH_MSG_IDX.|

### 16.142. THD3_CTH_MSG_IDX

**Register Name:** `THD3_CTH_MSG_IDX`

- **Offset Address:** `0x1134`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_IDX|3:0|0|RWHW|Index of thread0 message queue. Can be<br>updated by direct write. Will do self increase by<br>writing to THD3_CTH_MSG_DAT.|

### 16.143. THD3_CTH_DST

**Register Name:** `THD3_CTH_DST`

- **Offset Address:** `0x1138`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|29:0|0|RWHW|Reserved. This register is no longer used.|

### 16.144. THD3_CTH_CFG

**Register Name:** `THD3_CTH_CFG`

- **Offset Address:** `0x113C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TYPE_HI|12:8|0|RWHW|CTA event_type[8:4] field.|
|COUNTER|7:4|0|RWHW|4*(COUNTER+1) means how many byte to be<br>sent for this message|
|SEND|0:0|0|RWHW|"0" means this message queue is idle. "1"<br>means this message queue is busy to sending<br>message.<br>When this field is "0", write "1" to start<br>sending a message. And SW cannot write "0"<br>to stop the busy queue<br>Before config a message, SW should poll this<br>field to make sure the queue is idle.|

### 16.145. THD4_CTH_MSG_DAT

**Register Name:** `THD4_CTH_MSG_DAT`

- **Offset Address:** `0x1140`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_DAT|31:0|0|WO|Data port for thread0 message queue. The index<br>of message queue is THD4_CTH_MSG_IDX<br>Write to this register will put data into entry of<br>THD4_DATA_QUEUE[THD4_CTH_MSG_IDX] and<br>then increase THD4_CTH_MSG_IDX.|

### 16.146. THD4_CTH_MSG_IDX

**Register Name:** `THD4_CTH_MSG_IDX`

- **Offset Address:** `0x1144`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_IDX|3:0|0|RWHW|Index of thread0 message queue. Can be<br>updated by direct write. Will do self increase by<br>writing to THD4_CTH_MSG_DAT.|

### 16.147. THD4_CTH_DST

**Register Name:** `THD4_CTH_DST`

- **Offset Address:** `0x1148`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|29:0|0|RWHW|Reserved. This register is no longer used.|

### 16.148. THD4_CTH_CFG

**Register Name:** `THD4_CTH_CFG`

- **Offset Address:** `0x114C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TYPE_HI|12:8|0|RWHW|CTA event_type[8:4] field.|
|COUNTER|7:4|0|RWHW|4*(COUNTER+1) means how many byte to be<br>sent for this message|
|SEND|0:0|0|RWHW|"0" means this message queue is idle. "1"<br>means this message queue is busy to sending<br>message.<br>When this field is "0", write "1" to start<br>sending a message. And SW cannot write "0"<br>to stop the busy queue<br>Before config a message, SW should poll this<br>field to make sure the queue is idle.|

### 16.149. THD5_CTH_MSG_DAT

**Register Name:** `THD5_CTH_MSG_DAT`

- **Offset Address:** `0x1150`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_DAT|31:0|0|WO|Data port for thread0 message queue. The index<br>of message queue is THD5_CTH_MSG_IDX<br>Write to this register will put data into entry of<br>THD5_DATA_QUEUE[THD5_CTH_MSG_IDX] and<br>then increase THD5_CTH_MSG_IDX.|

### 16.150. THD5_CTH_MSG_IDX

**Register Name:** `THD5_CTH_MSG_IDX`

- **Offset Address:** `0x1154`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_IDX|3:0|0|RWHW|Index of thread0 message queue. Can be<br>updated by direct write. Will do self increase by<br>writing to THD5_CTH_MSG_DAT.|

### 16.151. THD5_CTH_DST

**Register Name:** `THD5_CTH_DST`

- **Offset Address:** `0x1158`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|29:0|0|RWHW|Reserved. This register is no longer used.|

### 16.152. THD5_CTH_CFG

**Register Name:** `THD5_CTH_CFG`

- **Offset Address:** `0x115C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TYPE_HI|12:8|0|RWHW|CTA event_type[8:4] field.|
|COUNTER|7:4|0|RWHW|4*(COUNTER+1) means how many byte to be<br>sent for this message|
|SEND|0:0|0|RWHW|"0" means this message queue is idle. "1"<br>means this message queue is busy to sending<br>message.<br>When this field is "0", write "1" to start<br>sending a message. And SW cannot write "0"<br>to stop the busy queue<br>Before config a message, SW should poll this<br>field to make sure the queue is idle.|

### 16.153. THD6_CTH_MSG_DAT

**Register Name:** `THD6_CTH_MSG_DAT`

- **Offset Address:** `0x1160`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_DAT|31:0|0|WO|Data port for thread0 message queue. The index<br>of message queue is THD6_CTH_MSG_IDX<br>Write to this register will put data into entry of<br>THD6_DATA_QUEUE[THD6_CTH_MSG_IDX] and<br>then increase THD6_CTH_MSG_IDX.|

### 16.154. THD6_CTH_MSG_IDX

**Register Name:** `THD6_CTH_MSG_IDX`

- **Offset Address:** `0x1164`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_IDX|3:0|0|RWHW|Index of thread0 message queue. Can be<br>updated by direct write. Will do self increase by<br>writing to THD6_CTH_MSG_DAT.|

### 16.155. THD6_CTH_DST

**Register Name:** `THD6_CTH_DST`

- **Offset Address:** `0x1168`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|29:0|0|RWHW|Reserved. This register is no longer used.|

### 16.156. THD6_CTH_CFG

**Register Name:** `THD6_CTH_CFG`

- **Offset Address:** `0x116C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TYPE_HI|12:8|0|RWHW|CTA event_type[8:4] field.|
|COUNTER|7:4|0|RWHW|4*(COUNTER+1) means how many byte to be<br>sent for this message|
|SEND|0:0|0|RWHW|"0" means this message queue is idle. "1"<br>means this message queue is busy to sending<br>message.<br>When this field is "0", write "1" to start<br>sending a message. And SW cannot write "0"<br>to stop the busy queue<br>Before config a message, SW should poll this<br>field to make sure the queue is idle.|

### 16.157. THD7_CTH_MSG_DAT

**Register Name:** `THD7_CTH_MSG_DAT`

- **Offset Address:** `0x1170`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_DAT|31:0|0|WO|Data port for thread0 message queue. The index<br>of message queue is THD7_CTH_MSG_IDX<br>Write to this register will put data into entry of<br>THD7_DATA_QUEUE[THD7_CTH_MSG_IDX] and<br>then increase THD7_CTH_MSG_IDX.|

### 16.158. THD7_CTH_MSG_IDX

**Register Name:** `THD7_CTH_MSG_IDX`

- **Offset Address:** `0x1174`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_IDX|3:0|0|RWHW|Index of thread0 message queue. Can be<br>updated by direct write. Will do self increase by<br>writing to THD7_CTH_MSG_DAT.|

### 16.159. THD7_CTH_DST

**Register Name:** `THD7_CTH_DST`

- **Offset Address:** `0x1178`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|29:0|0|RWHW|Reserved. This register is no longer used.|

### 16.160. THD7_CTH_CFG

**Register Name:** `THD7_CTH_CFG`

- **Offset Address:** `0x117C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TYPE_HI|12:8|0|RWHW|CTA event_type[8:4] field.|
|COUNTER|7:4|0|RWHW|4*(COUNTER+1) means how many byte to be<br>sent for this message|
|SEND|0:0|0|RWHW|"0" means this message queue is idle. "1"<br>means this message queue is busy to sending<br>message.<br>When this field is "0", write "1" to start<br>sending a message. And SW cannot write "0"<br>to stop the busy queue<br>Before config a message, SW should poll this<br>field to make sure the queue is idle.|

### 16.161. THD8_CTH_MSG_DAT

**Register Name:** `THD8_CTH_MSG_DAT`

- **Offset Address:** `0x1180`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_DAT|31:0|0|WO|Data port for thread0 message queue. The index<br>of message queue is THD8_CTH_MSG_IDX<br>Write to this register will put data into entry of<br>THD8_DATA_QUEUE[THD8_CTH_MSG_IDX] and<br>then increase THD8_CTH_MSG_IDX.|

### 16.162. THD8_CTH_MSG_IDX

**Register Name:** `THD8_CTH_MSG_IDX`

- **Offset Address:** `0x1184`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_IDX|3:0|0|RWHW|Index of thread0 message queue. Can be<br>updated by direct write. Will do self increase by<br>writing to THD8_CTH_MSG_DAT.|

### 16.163. THD8_CTH_DST

**Register Name:** `THD8_CTH_DST`

- **Offset Address:** `0x1188`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|29:0|0|RWHW|Reserved. This register is no longer used.|

### 16.164. THD8_CTH_CFG

**Register Name:** `THD8_CTH_CFG`

- **Offset Address:** `0x118C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TYPE_HI|12:8|0|RWHW|CTA event_type[8:4] field.|
|COUNTER|7:4|0|RWHW|4*(COUNTER+1) means how many byte to be<br>sent for this message|
|SEND|0:0|0|RWHW|"0" means this message queue is idle. "1"<br>means this message queue is busy to sending<br>message.<br>When this field is "0", write "1" to start<br>sending a message. And SW cannot write "0"<br>to stop the busy queue<br>Before config a message, SW should poll this<br>field to make sure the queue is idle.|

### 16.165. THD9_CTH_MSG_DAT

**Register Name:** `THD9_CTH_MSG_DAT`

- **Offset Address:** `0x1190`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_DAT|31:0|0|WO|Data port for thread0 message queue. The index<br>of message queue is THD9_CTH_MSG_IDX<br>Write to this register will put data into entry of<br>THD9_DATA_QUEUE[THD9_CTH_MSG_IDX] and<br>then increase THD9_CTH_MSG_IDX.|

### 16.166. THD9_CTH_MSG_IDX

**Register Name:** `THD9_CTH_MSG_IDX`

- **Offset Address:** `0x1194`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_IDX|3:0|0|RWHW|Index of thread0 message queue. Can be<br>updated by direct write. Will do self increase by<br>writing to THD9_CTH_MSG_DAT.|

### 16.167. THD9_CTH_DST

**Register Name:** `THD9_CTH_DST`

- **Offset Address:** `0x1198`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|29:0|0|RWHW|Reserved. This register is no longer used.|

### 16.168. THD9_CTH_CFG

**Register Name:** `THD9_CTH_CFG`

- **Offset Address:** `0x119C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TYPE_HI|12:8|0|RWHW|CTA event_type[8:4] field.|
|COUNTER|7:4|0|RWHW|4*(COUNTER+1) means how many byte to be<br>sent for this message|
|SEND|0:0|0|RWHW|"0" means this message queue is idle. "1"<br>means this message queue is busy to sending<br>message.<br>When this field is "0", write "1" to start<br>sending a message. And SW cannot write "0"<br>to stop the busy queue<br>Before config a message, SW should poll this<br>field to make sure the queue is idle.|

### 16.169. THD10_CTH_MSG_DAT

**Register Name:** `THD10_CTH_MSG_DAT`

- **Offset Address:** `0x11A0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_DAT|31:0|0|WO|Reserved|

### 16.170. THD10_CTH_MSG_IDX

**Register Name:** `THD10_CTH_MSG_IDX`

- **Offset Address:** `0x11A4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_IDX|3:0|0|RWHW|Reserved|

### 16.171. THD10_CTH_DST

**Register Name:** `THD10_CTH_DST`

- **Offset Address:** `0x11A8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|29:0|0|RWHW|Reserved. This register is no longer used.|

### 16.172. THD10_CTH_CFG

**Register Name:** `THD10_CTH_CFG`

- **Offset Address:** `0x11AC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TYPE_HI|12:8|0|RWHW|Reserved|
|COUNTER|7:4|0|RWHW|Reserved|
|SEND|0:0|0|RWHW|Reserved|

### 16.173. THD11_CTH_MSG_DAT

**Register Name:** `THD11_CTH_MSG_DAT`

- **Offset Address:** `0x11B0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_DAT|31:0|0|WO|Reserved|

### 16.174. THD11_CTH_MSG_IDX

**Register Name:** `THD11_CTH_MSG_IDX`

- **Offset Address:** `0x11B4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_IDX|3:0|0|RWHW|Reserved|

### 16.175. THD11_CTH_DST

**Register Name:** `THD11_CTH_DST`

- **Offset Address:** `0x11B8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|29:0|0|RWHW|Reserved. This register is no longer used.|

### 16.176. THD11_CTH_CFG

**Register Name:** `THD11_CTH_CFG`

- **Offset Address:** `0x11BC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TYPE_HI|12:8|0|RWHW|Reserved|
|COUNTER|7:4|0|RWHW|Reserved|
|SEND|0:0|0|RWHW|Reserved|

### 16.177. THD12_CTH_MSG_DAT

**Register Name:** `THD12_CTH_MSG_DAT`

- **Offset Address:** `0x11C0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_DAT|31:0|0|WO|Reserved|

### 16.178. THD12_CTH_MSG_IDX

**Register Name:** `THD12_CTH_MSG_IDX`

- **Offset Address:** `0x11C4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_IDX|3:0|0|RWHW|Reserved|

### 16.179. THD12_CTH_DST

**Register Name:** `THD12_CTH_DST`

- **Offset Address:** `0x11C8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|29:0|0|RWHW|Reserved. This register is no longer used.|

### 16.180. THD12_CTH_CFG

**Register Name:** `THD12_CTH_CFG`

- **Offset Address:** `0x11CC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TYPE_HI|12:8|0|RWHW|Reserved|
|COUNTER|7:4|0|RWHW|Reserved|
|SEND|0:0|0|RWHW|Reserved|

### 16.181. THD13_CTH_MSG_DAT

**Register Name:** `THD13_CTH_MSG_DAT`

- **Offset Address:** `0x11D0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_DAT|31:0|0|WO|Reserved|

### 16.182. THD13_CTH_MSG_IDX

**Register Name:** `THD13_CTH_MSG_IDX`

- **Offset Address:** `0x11D4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_IDX|3:0|0|RWHW|Reserved|

### 16.183. THD13_CTH_DST

**Register Name:** `THD13_CTH_DST`

- **Offset Address:** `0x11D8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|29:0|0|RWHW|Reserved. This register is no longer used.|

### 16.184. THD13_CTH_CFG

**Register Name:** `THD13_CTH_CFG`

- **Offset Address:** `0x11DC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TYPE_HI|12:8|0|RWHW|Reserved|
|COUNTER|7:4|0|RWHW|Reserved|
|SEND|0:0|0|RWHW|Reserved|

### 16.185. THD14_CTH_MSG_DAT

**Register Name:** `THD14_CTH_MSG_DAT`

- **Offset Address:** `0x11E0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_DAT|31:0|0|WO|Reserved|

### 16.186. THD14_CTH_MSG_IDX

**Register Name:** `THD14_CTH_MSG_IDX`

- **Offset Address:** `0x11E4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_IDX|3:0|0|RWHW|Reserved|

### 16.187. THD14_CTH_DST

**Register Name:** `THD14_CTH_DST`

- **Offset Address:** `0x11E8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|29:0|0|RWHW|Reserved. This register is no longer used.|

### 16.188. THD14_CTH_CFG

**Register Name:** `THD14_CTH_CFG`

- **Offset Address:** `0x11EC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TYPE_HI|12:8|0|RWHW|Reserved|
|COUNTER|7:4|0|RWHW|Reserved|
|SEND|0:0|0|RWHW|Reserved|

### 16.189. THD15_CTH_MSG_DAT

**Register Name:** `THD15_CTH_MSG_DAT`

- **Offset Address:** `0x11F0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_DAT|31:0|0|WO|Reserved|

### 16.190. THD15_CTH_MSG_IDX

**Register Name:** `THD15_CTH_MSG_IDX`

- **Offset Address:** `0x11F4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MSG_IDX|3:0|0|RWHW|Reserved|

### 16.191. THD15_CTH_DST

**Register Name:** `THD15_CTH_DST`

- **Offset Address:** `0x11F8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEND_DST|29:0|0|RWHW|Reserved. This register is no longer used.|

### 16.192. THD15_CTH_CFG

**Register Name:** `THD15_CTH_CFG`

- **Offset Address:** `0x11FC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TYPE_HI|12:8|0|RWHW|Reserved|
|COUNTER|7:4|0|RWHW|Reserved|

### 16.193. PMU_EN

**Register Name:** `PMU_EN`

- **Offset Address:** `0x1200`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PWR_CALC_EN|0:0|0|RWHW|1: enable per-cycle power<br>calculation<br>0: disable per-cycle power<br>calculation|
|PWR_CREDIT_EN|1:1|0|RWHW|1: enable power credit control<br>0: disable power credit control<br>PWR_CREDIT_EN should be<br>enabled along with PWR_CALC_EN<br>== 1.|
|CREDIT_DYNAMIC_EN|2:2|0|RWHW|The enable field for power credit<br>dynamic borrow and return<br>0: disable dynamic borrow and<br>return. 1: enable dynamic borrow<br>and return<br>CREDIT_DYNAMIC_EN should be<br>enabled along with PWR_CALC_EN<br>== 1 && PWR_CREDIT_EN == 1.|
|LDIDT_RISK_EN|4:4|0|RWHW|1: enable LDiDt risk detection<br>0: disable LDiDt risk detection|
|LDIDT_SYS_PROT_EN|5:5|0|RWHW|1: enable subsystem LDiDt<br>protection function<br>0: disable subsystem LDiDt<br>protection function<br>SYS_LDIDT_PROT_EN should be<br>enabled along with LDIDT_RISK_EN<br>= 1.|
|LDIDT_LCL_PROT_EN|6:6|0|RWHW|1: enable local LDiDt protection<br>function<br>0: disable local LDiDt protection<br>function<br>LCL_LDIDT_PROT_EN should be<br>enabled along with LDIDT_RISK_EN<br>== 1 && SYS_LDIDT_PROT_EN == 1.|
|STOCK_EN|12:12|0|RWHW|0: disable power stock feature<br>1: enable power stock feature|

### 16.194. PMU_CREDIT_CFG

**Register Name:** `PMU_CREDIT_CFG`

- **Offset Address:** `0x1204`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CREDIT_PWR_UNIT|7:0|ff|RWHW|Unit value of credit_base_num<br>and credit_extra_num|
|CREDIT_LPF_TAP|9:8|0|RWHW|Tap value n for power credit<br>related low pass filter.<br>0: 4, 1: 5, 2: 6, 3: 7.|
|CREDIT_STALL_LPF_TAP|13:12|0|RWHW|Tap value n for power credit<br>borrow related low pass filter.<br>0: 2, 1: 3, 2: 4, 3:5|
|CREDIT_DELTA_LPF_TAP|17:16|0|RWHW|Tap value n for power credit<br>return related low pass filter.<br>0: 6, 1: 7, 2: 8, 3:9|

### 16.195. PMU_CREDIT_STALL_CTRL

**Register Name:** `PMU_CREDIT_STALL_CTRL`

- **Offset Address:** `0x1208`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CREDIT_STALL_INIT_NUM|11:8|0|RWHW|Initial stall number for<br>power credit in every 16<br>cycles. The following stall<br>number will be updated<br>according to credit value<br>and step LUT|
|CREDIT_STALL_CALC_PERIOD|17:12|0|RWHW|The period of credit stall<br>calculation. Real period<br>cycle is<br>reg_pmu_credit_stall_preiod<br>*16|
|CREDIT_PHASE_RAND_SEED0|23:20|0|RWHW|Rand seed for 2D pipeline<br>power credit stall phase<br>randomization. If seed value<br>is 0, the random mechanism<br>will be disabled.|
|CREDIT_PHASE_RAND_SEED1|27:24|0|RWHW|Rand seed for 1D pipeline<br>power credit stall phase<br>randomization. If seed value<br>is 0, the random mechanism<br>will be disabled.|

### 16.196. PMU_INSPWR_LOOKUP0

**Register Name:** `PMU_INSPWR_LOOKUP0`

- **Offset Address:** `0x1210`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VMMSVMM_FP32_CMD_MUL0_PWR|7:0|0|RWHW|power lookup value<br>for VMM/SVMM<br>instruction when<br>input data mode is<br>FP32|
|VMMSVMM_BF16_CMD_MUL0_PWR|15:8|0|RWHW|power lookup value<br>for VMM/SVMM<br>instruction when<br>input data mode is<br>BF16|
|VMMSVMM_FP16_CMD_MUL0_PWR|23:16|0|RWHW|power lookup value<br>for VMM/SVMM<br>instruction when<br>input data mode is<br>FP16|

### 16.197. PMU_INSPWR_LOOKUP1

**Register Name:** `PMU_INSPWR_LOOKUP1`

- **Offset Address:** `0x1214`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VMMSVMM_INT8_CMD_MUL0_PWR|7:0|0|RWHW|power lookup value<br>for VMM/SVMM<br>instruction when<br>input data mode is<br>int8 and MAC type is<br>FP32/F16|
|VMMSVMM_INT8_CMD_MUL1_PWR|15:8|0|RWHW|power lookup value<br>for VMM/SVMM<br>instruction when<br>input data mode is<br>int8 and MAC type is<br>INT8/FP8|
|VMMSVMM_FP8_CMD_MUL0_PWR|23:16|0|RWHW|power lookup value<br>for VMM/SVMM<br>instruction when<br>input data mode is<br>fp8 and MAC type is<br>FP32/F16|
|VMMSVMM_FP8_CMD_MUL1_PWR|31:24|0|RWHW|power lookup value<br>for VMM/SVMM<br>instruction when<br>input data mode is<br>fp8 and MAC type is<br>INT8/FP8|

### 16.198. PMU_INSPWR_LOOKUP2

**Register Name:** `PMU_INSPWR_LOOKUP2`

- **Offset Address:** `0x1218`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MAC_FP32_CMD_MUL_PWR|7:0|0|RWHW|power lookup value for MAC<br>instruction when input data<br>mode is FP32|
|MAC_BF16_CMD_MUL_PWR|15:8|0|RWHW|power lookup value for MAC<br>instruction when input data<br>mode is BF16|
|MAC_FP16_CMD_MUL_PWR|23:16|0|RWHW|power lookup value for MAC<br>instruction when input data<br>mode is FP16|
|MAC_INT8_CMD_MUL_PWR|31:24|0|RWHW|power lookup value for MAC<br>instruction when input data<br>mode is INT8|

### 16.199. PMU_INSPWR_LOOKUP3

**Register Name:** `PMU_INSPWR_LOOKUP3`

- **Offset Address:** `0x121C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|EWADD_FP32_CMD_MUL_PWR|7:0|0|RWHW|power lookup value for<br>element-wise addition<br>instruction when input<br>data mode is FP32|
|EWMUL_FP32_CMD_MUL_PWR|15:8|0|RWHW|power lookup value for<br>element-wise<br>multiplication instruction<br>when input data mode is<br>FP32|
|EWADD_F16_CMD_MUL_PWR|23:16|0|RWHW|power lookup value for<br>element-wise addition<br>instruction when input<br>data mode is FP16/BF16|
|EWMUL_F16_CMD_MUL_PWR|31:24|0|RWHW|power lookup value for<br>element-wise<br>multiplication instruction<br>when input data mode is<br>FP16/BF16|

### 16.200. PMU_INSPWR_LOOKUP4

**Register Name:** `PMU_INSPWR_LOOKUP4`

- **Offset Address:** `0x1220`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MALU_OTHER_CMD_MUL_PWR|7:0|0|RWHW|power lookup value for<br>logical operation<br>instruction|
|EWADD_INT_CMD_MUL_PWR|15:8|0|RWHW|power lookup value for<br>element-wise addition<br>instruction when input<br>data mode is INT|
|EWMUL_INT_CMD_MUL_PWR|23:16|0|RWHW|power lookup value for<br>element-wise<br>multiplication instruction<br>when input data mode is<br>INT|
|L2L3_BUSY_PWR|31:24|0|RWHW|power lookup value for<br>SDMA when it is busy|

### 16.201. PMU_INSPWR_LOOKUP5

**Register Name:** `PMU_INSPWR_LOOKUP5`

- **Offset Address:** `0x1224`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VDMEM_LD_PWR|7:0|0|RWHW|power lookup value for one VDMEM<br>RAM 32-bit load access|
|VDMEM_ST_PWR|15:8|0|RWHW|power lookup value for one VDMEM<br>RAM 32-bit store access|
|DSM_WR_PWR|23:16|0|RWHW|power lookup value for one DSM port<br>write|
|DSM_RD_PWR|31:24|0|RWHW|power lookup value for one DSM port<br>write|

### 16.202. PMU_INSPWR_BASE0

**Register Name:** `PMU_INSPWR_BASE0`

- **Offset Address:** `0x1228`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MALU_VMMSVMM_BASE0_PWR|7:0|0|RWHW|MALU base power<br>for FP32/FP16/BF16<br>vmm/svmm<br>instruction|
|MALU_VMMSVMM_I8F8_BASE0_PWR|15:8|0|RWHW|MALU base power<br>for INT8/FP8<br>vmm/svmm<br>instruction with<br>FP16 MAC|
|MALU_VMMSVMM_I8F8_BASE1_PWR|23:16|0|RWHW|MALU base power<br>for INT8/FP8<br>vmm/svmm<br>instruction with<br>INT8/FP8 MAC|
|MALU_MAC_BASE_PWR|31:24|0|RWHW|MALU base power<br>for vmac/vmas/imas<br>instructions|

### 16.203. PMU_INSPWR_BASE1

**Register Name:** `PMU_INSPWR_BASE1`

- **Offset Address:** `0x122C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MALU_EWADD_BASE_PWR|7:0|0|RWHW|power base value for element-<br>wise addition insturction<br>power estimation|
|MALU_EWMUL_BASE_PWR|15:8|0|RWHW|power base value for element-<br>wise multiplication insturction<br>power estimation|
|MALU_OTHER_BASE_PWR|23:16|0|RWHW|MALU base power for logical<br>operation instruction power<br>estimation|

### 16.204. PMU_INSPWR_BASE2

**Register Name:** `PMU_INSPWR_BASE2`

- **Offset Address:** `0x1230`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CG_IDLE_PWR|7:0|0|RWHW|SIP core idle power with elcg|
|NCG_IDLE_PWR|15:8|0|RWHW|SIP core idle power without elcg|
|XPU_BASE_PWR|23:16|0|RWHW|XPU base power for<br>IMEM/IFID/PLC/SALU/SLSB/SDMEM/VPE|
|DSM_BASE_PWR|31:24|0|RWHW|DSM NOC base power|

### 16.205. PMU_CUR_PWR

**Register Name:** `PMU_CUR_PWR`

- **Offset Address:** `0x1240`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|INSPWR_OUT|7:0|0|RO|Reserved. This register is no longer used.|
|LPF_CREDIT|15:8|0|RO|Current power value from credit filter. For<br>debug purpose.|

### 16.206. PMU_CUR_STS

**Register Name:** `PMU_CUR_STS`

- **Offset Address:** `0x1244`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CREDIT_2D_STALL_STS|1:0|0|RO|Current credit 2d stall insertion logic<br>state. For debug purpose.|
|CREDIT_1D_STALL_STS|5:4|0|RO|Current credit 1d stall insertion logic<br>state. For debug purpose.|
|DYNAMIC_FSM_STS|10:8|0|RO|Current dynamic credit FSM state<br>state. For debug purpose.|

### 16.207. PMU_CREDIT_LUT0

**Register Name:** `PMU_CREDIT_LUT0`

- **Offset Address:** `0x1250`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CREDIT_STEP_LUT0|31:0|80|RWHW|Power credit step lookup table. Each<br>[i\*4+3:i*4] represents adjustment<br>step of credit stall number in every 16<br>cycles|

### 16.208. PMU_CREDIT_LUT1

**Register Name:** `PMU_CREDIT_LUT1`

- **Offset Address:** `0x1254`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CREDIT_STEP_LUT1|31:0|80|RWHW|Power credit step lookup table. Each<br>[i\*4+3:i*4] represents adjustment<br>step of credit stall number in every 16<br>cycles|

### 16.209. PMU_CREDIT_LUT2

**Register Name:** `PMU_CREDIT_LUT2`

- **Offset Address:** `0x1258`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CREDIT_STEP_LUT2|31:0|80|RWHW|Power credit step lookup table. Each<br>[i\*4+3:i*4] represents adjustment<br>step of credit stall number in every 16<br>cycles|

### 16.210. PMU_CREDIT_LUT3

**Register Name:** `PMU_CREDIT_LUT3`

- **Offset Address:** `0x125C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CREDIT_STEP_LUT3|31:0|80|RWHW|Power credit step lookup table. Each<br>[i\*4+3:i*4] represents adjustment<br>step of credit stall number in every 16<br>cycles|

### 16.211. PMU_CREDIT_BASE

**Register Name:** `PMU_CREDIT_BASE`

- **Offset Address:** `0x1260`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CREDIT_BASE_NUM|3:0|0|RWHW|base power credit number which is set<br>by SW|

### 16.212. PMU_CREDIT_EXTRA

**Register Name:** `PMU_CREDIT_EXTRA`

- **Offset Address:** `0x1264`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CREDIT_EXTRA_NUM|3:0|0|RWHW|extra power credit number which is<br>set by either PMU or SW<br>when credit_dynamic_en = 1, PMU<br>borrows and returns extra credit;<br>when credit_dynamic_en = 0, SW sets<br>extra credit|

### 16.213. PMU_CREDIT_THRESHOLD

**Register Name:** `PMU_CREDIT_THRESHOLD`

- **Offset Address:** `0x1268`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CREDIT_BORROW_TH|7:0|0|RWHW|Threshold for credit borrow|
|CREDIT_RETURN_TH|23:16|0|RWHW|Threshold for credit return|

### 16.214. PMU_CREDIT_WAIT0

**Register Name:** `PMU_CREDIT_WAIT0`

- **Offset Address:** `0x1270`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CREDIT_CTRL_NORMAL_WAIT|19:0|0|RWHW|Wait cycle for PMU credit<br>threshold FSM to check<br>status|

### 16.215. PMU_CREDIT_WAIT1

**Register Name:** `PMU_CREDIT_WAIT1`

- **Offset Address:** `0x1274`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CREDIT_CTRL_BORROW_WAIT|19:0|0|RWHW|Wait cycle for PMU credit<br>threshold FSM after<br>borrowing credit|

### 16.216. PMU_CREDIT_WAIT2

**Register Name:** `PMU_CREDIT_WAIT2`

- **Offset Address:** `0x1278`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CREDIT_CTRL_RETURN_WAIT|19:0|0|RWHW|Wait cycle for PMU credit<br>threshold FSM after<br>returning credit|

### 16.217. PMU_SYS_LDIDT_CFG0

**Register Name:** `PMU_SYS_LDIDT_CFG0`

- **Offset Address:** `0x1280`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SIP_PMU_ID|2:0|0|RWHW|3-bit SIP ID for PMU system LDiDt strategy.|
|SIP0_SB_DLY|7:4|0|RWHW|The delay cycle of SIP0 sideband input|
|SIP1_SB_DLY|11:8|0|RWHW|The delay cycle of SIP1 sideband input|
|SIP2_SB_DLY|15:12|0|RWHW|The delay cycle of SIP2 sideband input|
|SIP3_SB_DLY|19:16|0|RWHW|The delay cycle of SIP3 sideband input|
|SIP4_SB_DLY|23:20|0|RWHW|The delay cycle of SIP4 sideband input|
|SIP5_SB_DLY|27:24|0|RWHW|The delay cycle of SIP5 sideband input|
|SIP6_SB_DLY|31:28|0|RWHW|The delay cycle of SIP6 sideband input|

### 16.218. PMU_SYS_LDIDT_CFG1

**Register Name:** `PMU_SYS_LDIDT_CFG1`

- **Offset Address:** `0x1284`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PAST_LOOKUP|7:0|0|RWHW|Past lookup cycles|
|DLY_LAUN|15:8|0|RWHW|Delay launch cycles|
|PAST_PRI|23:16|0|RWHW|Past priority cycles|
|GLB_VIEW|27:24|0|RWHW|Global view cycles|
|PAST_PRI_EN|31:31|0|RWHW|Past priority counter enable bit|

### 16.219. PMU_SYS_LDIDT_CFG2

**Register Name:** `PMU_SYS_LDIDT_CFG2`

- **Offset Address:** `0x1288`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|CONC_LAUN|7:0|0|RWHW|Concurrent launch delay|

### 16.220. PMU_SYS_LDIDT_CFG3

**Register Name:** `PMU_SYS_LDIDT_CFG3`

- **Offset Address:** `0x128C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RISK_CNT_TH|2:0|0|RWHW|The threshold of other SIP number|
|SYS_H2L_DLY|7:4|0|RWHW|The delay cycle of H2L risk for system LDiDt<br>strategy|

### 16.221. PMU_LCL_LDIDT_CFG0

**Register Name:** `PMU_LCL_LDIDT_CFG0`

- **Offset Address:** `0x1290`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VMM_M|1:0|0|RWHW|VMM_M+1 means the VMM number in one<br>sequence pattern.<br>Valid range 0~1|
|NOP_N|3:2|0|RWHW|NOP_N+1 means the NOP number in one<br>sequence pattern.<br>Valid range 0~1|
|LOOP_K|7:4|0|RWHW|LOOP_K+1 means the loop number of<br>sequence pattern for local LDiDt strategy<br>Valid range 0~1|
|LCL_H2L_DLY|11:8|0|RWHW|The delay cycle of H2L risk for local LDiDt<br>strategy|

### 16.222. PMU_LDIDT_RISK_CFG0

**Register Name:** `PMU_LDIDT_RISK_CFG0`

- **Offset Address:** `0x1294`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|L2H_HP_CNT0_TH|3:0|0|RWHW|The threshold of high power<br>instruction number in L2H risk<br>detection phase 0|
|L2H_WIN0_SIZE|7:4|0|RWHW|The window size of L2H risk detection<br>phase 0|
|H2L_HP_CNT0_TH|11:8|0|RWHW|The threshold of high power<br>instruction number in H2L risk<br>detection phase 0|
|H2L_WIN0_SIZE|15:12|0|RWHW|The window size of H2L risk detection<br>phase 0|
|L2H_HP_CNT1_TH|19:16|0|RWHW|The threshold of high power<br>instruction number in L2H risk<br>detection phase 1|
|L2H_WIN1_SIZE|23:20|0|RWHW|The window size of L2H risk detection<br>phase 1|
|H2L_HP_CNT1_TH|27:24|0|RWHW|The threshold of high power<br>instruction number in H2L risk<br>detection phase 1|
|H2L_WIN1_SIZE|31:28|0|RWHW|The window size of H2L risk detection<br>phase 1|

### 16.223. PMU_LDIDT_RISK_CFG1

**Register Name:** `PMU_LDIDT_RISK_CFG1`

- **Offset Address:** `0x1298`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|L2H_FS_TH|2:0|0|RWHW|The threshold of high power instruction<br>number in future stage for L2H|
|H2L_FS_TH|6:4|0|RWHW|The threshold of high power instruction<br>number in future stage for H2L|

### 16.224. PMU_STOCK_CNT0

**Register Name:** `PMU_STOCK_CNT0`

- **Offset Address:** `0x12A0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|STOCK_CNT0|31:0|0|RO|Power stock counter 0 for XPU busy cycles.|

### 16.225. PMU_STOCK_CNT1

**Register Name:** `PMU_STOCK_CNT1`

- **Offset Address:** `0x12A4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|STOCK_CNT1|31:0|0|RO|Power stock counter 1 for stall inserted in 2D<br>pipeline|

### 16.226. PMU_STOCK_CNT2

**Register Name:** `PMU_STOCK_CNT2`

- **Offset Address:** `0x12A8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|STOCK_CNT2|31:0|0|RO|Power stock counter 2 for stall inserted in 1D<br>pipeline|

### 16.227. PMU_STOCK_CNT3

**Register Name:** `PMU_STOCK_CNT3`

- **Offset Address:** `0x12AC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|STOCK_CNT3|31:0|0|RO|Power stock counter 3 for sip average power|

### 16.228. PMU_PROFILE_CTRL

**Register Name:** `PMU_PROFILE_CTRL`

- **Offset Address:** `0x12C0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PROFILE_EN|0:0|0|RWHW|Power profiling enable field.<br>Write "1" to enable accumulate PMU events<br>within internal counters.<br>Write "0" to stop accumulate and copy the<br>internal counter value into<br>PMU_PROFILE_CNT0~3.|

### 16.229. PMU_PROFILE_CNT0

**Register Name:** `PMU_PROFILE_CNT0`

- **Offset Address:** `0x12C4`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PROFILE_L2H_RISK|31:0|0|RO|PMU L2H event counting result.<br>Sample window is defined when<br>PMU_PROFILE_CTRL.PROFILE_EN is "1".<br>Updated when<br>PMU_PROFILE_CTRL.PROFILE_EN is set<br>from "1" to "0".|

### 16.230. PMU_PROFILE_CNT1

**Register Name:** `PMU_PROFILE_CNT1`

- **Offset Address:** `0x12C8`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PROFILE_L2H_STALL|31:0|0|RO|PMU Ldidt stall for L2H counting result.<br>Sample window is defined when<br>PMU_PROFILE_CTRL.PROFILE_EN is "1".<br>Updated when<br>PMU_PROFILE_CTRL.PROFILE_EN is set<br>from "1" to "0".|

### 16.231. PMU_PROFILE_CNT2

**Register Name:** `PMU_PROFILE_CNT2`

- **Offset Address:** `0x12CC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PROFILE_H2L_RISK|31:0|0|RO|PMU H2L event counting result.<br>Sample window is defined when<br>PMU_PROFILE_CTRL.PROFILE_EN is "1".<br>Updated when<br>PMU_PROFILE_CTRL.PROFILE_EN is set<br>from "1" to "0".|

### 16.232. PMU_PROFILE_CNT3

**Register Name:** `PMU_PROFILE_CNT3`

- **Offset Address:** `0x12D0`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PROFILE_H2L_STALL|31:0|0|RO|PMU Ldidt stall for H2L counting result.<br>Sample window is defined when<br>PMU_PROFILE_CTRL.PROFILE_EN is "1".<br>Updated when<br>PMU_PROFILE_CTRL.PROFILE_EN is set<br>from "1" to "0".|

### 16.233. PMU_SCRATCH

**Register Name:** `PMU_SCRATCH`

- **Offset Address:** `0x12FC`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SCRATCH|31:0|0|RWHW|{NOP_N_HI, NOP_N} provides 4 bits nop_n<br>field.<br>bit[5:4]: NOP_N_HI[1:0].|

### 16.234. DFD_CFG

**Register Name:** `DFD_CFG`

- **Offset Address:** `0x1300`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DFD_SDTE_EN|15:15|1|RWHW|DFD OBS enable for SIP SDTE wrapper,<br>default is disable.|
|DFD_EN|0:0|0|RWHW|DFD OBS enable for SIP core logic, default<br>is disable.|

### 16.235. DFD_OBS_CORE_SEL0

**Register Name:** `DFD_OBS_CORE_SEL0`

- **Offset Address:** `0x1304`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|OBS_CORE_MUX1|24:16|1|RWHW|MUX select for CORE OBS output bit1.|
|OBS_CORE_MUX0|8:0|0|RWHW|MUX select for CORE OBS output bit0.|

### 16.236. DFD_OBS_CORE_SEL1

**Register Name:** `DFD_OBS_CORE_SEL1`

- **Offset Address:** `0x1308`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|OBS_CORE_MUX3|24:16|3|RWHW|MUX select for CORE OBS output bit3.|
|OBS_CORE_MUX2|8:0|2|RWHW|MUX select for CORE OBS output bit2.|

### 16.237. DFD_OBS_CORE_SEL2

**Register Name:** `DFD_OBS_CORE_SEL2`

- **Offset Address:** `0x130C`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|OBS_CORE_MUX5|24:16|5|RWHW|MUX select for CORE OBS output bit5.|
|OBS_CORE_MUX4|8:0|4|RWHW|MUX select for CORE OBS output bit4.|

### 16.238. DFD_OBS_CORE_SEL3

**Register Name:** `DFD_OBS_CORE_SEL3`

- **Offset Address:** `0x1310`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|OBS_CORE_MUX7|24:16|7|RWHW|MUX select for CORE OBS output bit7.|
|OBS_CORE_MUX6|8:0|6|RWHW|MUX select for CORE OBS output bit6.|

### 16.239. DFD_OBS_CORE_SEL4

**Register Name:** `DFD_OBS_CORE_SEL4`

- **Offset Address:** `0x1314`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|OBS_CORE_MUX9|24:16|9|RWHW|MUX select for CORE OBS output bit9.|
|OBS_CORE_MUX8|8:0|8|RWHW|MUX select for CORE OBS output bit8.|

### 16.240. DFD_OBS_CORE_SEL5

**Register Name:** `DFD_OBS_CORE_SEL5`

- **Offset Address:** `0x1318`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|OBS_CORE_MUX11|24:16|b|RWHW|MUX select for CORE OBS output<br>bit11.|
|OBS_CORE_MUX10|8:0|a|RWHW|MUX select for CORE OBS output<br>bit10.|

## 17. CSR Usage

Programming Guideline部分，请参见Libra_SIP_Programming_Guideline。

DF RAS配置部分，尤其是关于DF RAS的Error Injection部分，请参考 Enflame_AXI_Axi_Bus_Master_Ecc_Design_Specification的5.4章节部分

## 18. Scratch Register

在SIP CSR设计中，有相当一部分寄存器是在工程开发早期冗余定义，为工程后期的功能变更提供方便。 这些被称为Scratch寄存器（包括名字中有Scratch字样，和一部分没有Scratch的字样的寄存器）。

在工程实现中，目前所有实际应用的Scratch寄存器记录在Used Scratch Register章节中。这个章节中记录的寄存器/寄存器域之外，其他的Scratch寄存器均不可被软件使用，需要保持为原值。

### 18.1. Scratch Register Range

**下列的寄存器为Scratch寄存器**

|Name|Address Offset|Comment|
|---|---|---|
|XPU_SCRATCH0<br>~ XPU_SCRATCH63|0xB00 ~ 0xBFC|XPU Block的scratch寄存器|
|ICACHE_SCRATCH0<br>~ ICACHE_SCRATCH3|0xD80 ~ 0xD8C|ICache的scratch寄存器|
|L1_SCRATCH0<br>~ L1_SCRATCH7|0xEA0 ~ 0xEBC|L1 Block的scratch寄存器|
|PMU_SCRATCH|0x12FC|PMU模块的scratch寄存器|
|S2_LL_SCHED_CTRL0<br>~ XPU_MISC_CTRL1|0x980 ~ 0x9D4|实质上是XPU的scratch寄存器|
|XPU_PMC_EVT_CTRL<br>~ XPU_PMC_THREAD_EVENT15|0xA10 ~ 0xABC|实质上是XPU的scratch寄存器|

这些Scratch寄存器中，绝大多数都不可以使用。

### 18.2. Used Scratch Register

下列Scratch寄存器是实际使用的

|Register|Offset|Field Name|Function|
|---|---|---|---|
|PMU_SCRATCH[5:4]|0x12FC|NOP_N_HI[1:0]|用于SIP4.0 PMU扩展<br>后的NOP_N域<br>其他域不可配置|
|XPU_SCRATCH0[31:0]|0xB00|bit[10:0]: PRIVATE_MASK<br>bit[26:16]:<br>NON_AFFINITY_MASK<br>bit[28]: Disable Mask|用于替代<br>L1_DSM_MASK_CFG<br>功能<br>在正常使用时，bit28<br>应当设置为1|
|XPU_SCRATCH1[31:0]|0xB04|bit[1:0]: FSM state of launch<br>queue 0<br>bit[17:16]: FSM state of<br>launch queue 1|该寄存器在使用上必<br>须维持只读，用于反<br>应两个launch queue<br>的状态<br>该寄存器用于强杀功<br>能|
|XPU_SCRATCH4[31:0]|0xB10|CODE_0 for<br>mailbox144~mailbox191|新增mailbox对应的<br>MBOX_ERR2_CODE_0<br>软件保证只读访问|
|XPU_SCRATCH5[31:0]|0xB14|CODE_1 for<br>mailbox144~mailbox191|新增mailbox对应的<br>MBOX_ERR2_CODE_1<br>软件保证只读访问|
|XPU_SCRATCH6[31:0]|0xB18|bit[0]: Error_flag for<br>mailbox144~mailbox191|新增mailbox对应的<br>MBOX_ERR2_RPT<br>报告这些mailbox上是<br>否有错误<br>由于是scratch，所以<br>不是W1C。需要软件<br>保证只做清零|
|XPU_SCRATCH7[31:0]|0xB1C|bit[11:0]: OBS valid enable|该寄存器用于控制本<br>SIP OBS输出数据是否<br>有效|
|XPU_SCRATCH36[31:0]|0xB90|bit[9:0]: sub-thread mapping<br>to kernel-slot0|给L0P5使用的寄存<br>器，指示sub-thread<br>mapping关系<br>线程启动后根据自己<br>kernel-slot来设置<br>SCRATCH36 ~<br>SCRATCH39；在结束<br>前清理这些寄存器|
|XPU_SCRATCH37[31:0]|0xB94|bit[9:0]: sub-thread mapping<br>to kernel-slot1|给L0P5使用的寄存<br>器，指示sub-thread<br>mapping关系<br>线程启动后根据自己<br>kernel-slot来设置<br>SCRATCH36 ~<br>SCRATCH39；在结束<br>前清理这些寄存器|
|XPU_SCRATCH38[31:0]|0xB98|bit[9:0]: sub-thread mapping<br>to kernel-slot2|给L0P5使用的寄存<br>器，指示sub-thread<br>mapping关系<br>线程启动后根据自己<br>kernel-slot来设置<br>SCRATCH36 ~<br>SCRATCH39；在结束<br>前清理这些寄存器|
|XPU_SCRATCH39[31:0]|0xB9C|bit[9:0]: sub-thread mapping<br>to kernel-slot3|给L0P5使用的寄存<br>器，指示sub-thread<br>mapping关系<br>线程启动后根据自己<br>kernel-slot来设置<br>SCRATCH36 ~<br>SCRATCH39；在结束<br>前清理这些寄存器|
|XPU_SCRATCH63[15:0]|0xBFC|per_thread_l0p5_disable[15:0]|每个bit对应一个sub-<br>thread。<br>配置为1时关闭该sub-<br>thread的L0P5功能|
