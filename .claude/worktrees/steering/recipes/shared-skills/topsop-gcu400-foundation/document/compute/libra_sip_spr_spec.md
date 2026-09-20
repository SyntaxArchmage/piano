> Imported material source: `Doc/Libra SIP SPR SPEC.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `Libra SIP SPR SPEC`.

# Libra SIP SPR SPEC

本文档由 `Libra SIP SPR SPEC.pdf` 转换整理而来，保留原文的章节、寄存器表、字段说明、图片与主要版式结构，并清理 PDF 导出产生的版式噪声。

## 1. Revision History

|SIP Version|Version|Date|Note|
|---|---|---|---|
|4.0|v0.1|2025/07/01|创建初始版本|

## 2. Open & Dropped Item

### 2.1. Open Item

### 2.2. Dropped Item

**下面寄存器被放弃：**

- SPS_DIM1_STRIDE

- SCHED_S1

- SCHED_S2

- SCHED_S2

- TRAP_RTB

- INTR_SD0~INTR_SD7

**下列使用场景被放弃**

- 使用MOVSR2SPR更新HW_STS

- 在 LAUNCH_WRK.THREAD_TYPE为0/1情况下，使用MOVSR2SPR更新VAB_VPT1

- 将TCTL寄存器更新为非0数值

## 3. Glossary

|Name|Description|Comment|
|---|---|---|
|SPR|Special Purpose Register||
|SW-<br>CTX|Software context, A.K.A<br>software thread|即软件线程。每个软件线程有一个PC和独立的上下<br>文<br>为了和Arch Spec统一，本文档使用SW-CTX的专用<br>英文缩写|
|HW-<br>CTX|hardware context, A.K.A<br>hardware thread|即硬件线程。每个硬件线程上有独立的取指和访存单<br>元，可以执行一个或者多个软件线程<br>为了和Arch Spec统一，本文档使用HW-CTX的专用<br>英文缩写|

## 4. Reference Link

**Libra SIP ISA**

## 5. Overview

本文档用于描述ISA4.0相关的SPR寄存器。在ISA3.2中SPR寄存器的描述被放在Arch Spec中。而在ISA4.0 中，由于SPR寄存器和ISA关系紧密，而和SIP整体架构的关系相对松耦合，因此从Arch Spec中分离出来，并且出于便于阅读的目的编写为ISA4.0指令集描述文档的附属文档，和ISA4.0同步进行review和发布。

SPR是Special Purpose Register的缩写。这类寄存器在ISA4.0中有如下特点：

使用ISA指令中立即数编码进行直接访问的寄存器

和使用load/store指令访问的CSR寄存器在地址空间上不同

- ISA4.0中，SPR地址空间共包含256个SPR寄存器地址编码

   - 其中有一部分地址并未定义具体寄存器。对这些寄存器读返回全0，写操作会被视为NOP

- ISA4.0中，SPR寄存器的位宽扩展为64bit

   - 有相当部分SPR寄存器的有效位域只有32bit（和ISA3.2保持一致）。对这些寄存器，高32bit 始终为0

**请仔细确认每个寄存器的有效位域**

- 对于编程视角，SPR寄存器是每个软件线程各自独立的

   - 有部分SPR寄存器由于SIP Arch设计约束，在物理层面上可以被同一个硬件线程上的软件线程所共享

相比于ISA3.2，ISA4.0中的SPR寄存器有如下变化：

**所有寄存器都扩展为64bit**

有效位宽可以小于64bit

**删除了下列寄存器**

**删除了所有VCC寄存器**

这是由于VALU指令和VCC从ISA4.0中被移除

**删除了MFL系列寄存器**

ISA4.0中引入了矩阵描述相关寄存器，可以替代MFL的功能并且效果更好

**删除了AOT系列寄存器**

ISA4.0中引入了VL寄存器和矩阵描述相关寄存器，可以提供更好的动态形状支持

删除了ISA3.2中被舍弃指令相关的寄存器

包括EXCP_STS_EXT，VMM_RAW，O2M_VPT1_OFFSET

删除了AUX_PC

这是由于这一代去掉了EXCP_PC的Error Exception类型

删除IPF_ADDR

DPREFETCH指令可以直接从SR中读取虚拟地址

**删除了异步中断相关寄存器**

INTR_MASK

- INTR_MASK_SD

- INTR_STS

INTR_CLR

**删除了LOOP相关寄存器**

**这是由于取消了LOOP指令**

包括LOOP_STS，LOOP_LSP，LOOP_LEP，EXCP_LOOP_STS，EXCP_LOOP_LSP， EXCP_LOOP_LEP

**删除VMM相关寄存器**

**由于兼容语义调整，去掉所有IV/VR/SMR可见的指令**

包括VMM_VSEL_OVR，SVMM_SPR0，SMR_RENAME_MAP

删除了RSVD_SPR0~RSVD_SPR7

增加了HWT_COUNTER寄存器

用于提供HAL_clock()功能

**增加了VL寄存器和VTYPE寄存器**

用于VACC相关1D指令的形状动态性。借鉴自RISC-V Vector Extension

ISA4.0中VTYPE寄存器只有一个域vta，并且固定为1

增加了LHS_DIM*、RHS_DIM*、LDST_DIM*系列寄存器组

这些寄存器分别用于MLI_GEMM和MLI_MST指令中的memory矩阵形状描述。请参见ISA4.0中 MLI_GEMM和MLI_MLD/MLI_MST系列指令的描述

对于所有和PC相关的寄存器，有效位宽扩展为32bit

PC

EXCP_PC

TRPBA_WRK

INTBA_WRK

TRAP_RTB

将SIP_INFO修改为SIP_ID

该寄存器提供了SIP在Harvest之后的

对于物理地址相关的寄存器，标识为*_LO的寄存器改名去掉后缀，扩展为48bit，并且允许使用

***_HI的寄存器来读写它们的高半部分**

IPF_ADDR_LO -> IPF_ADDR

**修改NACCOVR寄存器**

支持对MLI_GEMM系列指令的override

支持对MOP.MAC/MOP.MAS/MOP.IMAS系列指令自增语义的override

去除被删除指令的override语义

**增加了多线程发射以及状态寄存器**

增加了SIP_HW_ID寄存器，即SA的AXUSR[15:0]寄存器

**包括master ID，die ID和VF ID**

增加了THD_SLOT_IDX寄存器，指示当前软件线程位于那个硬件调度slot上

增加了PROCESS_ID_WRK寄存器

IID_WRK改名为PACKAGE_ID_WRK寄存器

增加了SUB_THD_ID_WRK

该寄存器为kernel launch时由软件给予初值，并且在展开为每个sub-thread时逐渐加1

增加了ASID_WRK寄存器，表示本线程的ASID

增加了KSID_WRK寄存器，表示本线程的KSID

增加了LAUNCH_WRK寄存器

记录了本次kernel launch展开的sub-thread数量，线程类型，所需要VACC数量等

- 增加了PARAM_WRK寄存器，记录本线程的Param buffer在SDMEM上的位置

增加了STACK_REMOTE和STACK_LOCAL，用于支持本线程的remote stack区域和local stack 区域

增加了MBOX_EXTRA_STS寄存器

增加对预取的ASID和KSID的支持

增加了DPF_ASID和IPF_ASID，用于数据预取

增加了IPF_ASID，用于指令预取

简化VAB系列寄存器，并将位宽扩展为13bit

简化为VAB_VPT0/VAB_VPT1两个

**其中非兼容模式所有指令槽都使用VAB_VPT0**

兼容模式下，这两个寄存器分别给两个VPT下的所有指令槽使用

**扩展位宽的原因为VACC个数扩展为6144个**

增加了MB_STACK寄存器，用于支持MB_PUSH和MB_POP

- 增加了MBOX_EXTRA_STS

用于支持新加的virtual mailbox功能

**为了避免歧义，下列三个寄存器做名称变化：**

INTBA_WRK -> LCHBA_WRK

EXCP_TRAP -> EXCP_BIT_EN

EXCP_MASK -> EXCP_STS_GLB

- 为LD_PARAM增加LD_BASE0~LD_BASE7寄存器

~~增加了per-thread的调度寄存器~~

~~SCHED_S1~~

~~SCHED_S2~~

~~SCHED_S3~~

放弃TRAP_RTB和INTR_SD0~INTR_SD7寄存器

由于放弃了指令TRAP1和ERET指令，这9个寄存器被放弃

## 6. Special Purpose Register List

|Register Name|SPR<br>ID|Description|Version|Sharing|
|---|---|---|---|---|
|SIP_ID|0|SIC ID & SIP ID after Harvest|3.2|Per-SIP|
|THD_SLOT_IDX|2|ISA4.0新增寄存器，用于记录本线<br>程运行时占用的线程槽|4.0|Per-Sub-<br>Thread|
|PROCESS_ID_WRK|3|ISA4.0新增寄存器，本软件线程对<br>应的进程ID|4.0|Per-<br>Kernel-<br>Slot|
|PACKAGE_ID_WRK|4|Shadow register of PACKAGE_ID.<br>Previous name is IID|3.2|Per-<br>Kernel-<br>Slot|
|SUB_THD_ID_WRK|5|ISA4.0新增寄存器，本软件线程对<br>应sub_thread ID，由<br>SUB_THD_CFG在发射时累加得到|4.0|Per-Sub-<br>Thread|
|ASID_WRK|6|ISA4.0新增寄存器，用于记录本线<br>程运行时的ASID。所有指令段和数<br>据段都使用该ASID来查找对应的页<br>表|4.0|Per-<br>Kernel-<br>Slot|
|KSID_WRK|7|ISA4.0新增寄存器，用于记录本线<br>程运行时的KSID。所有指令段使用<br>该ASID来查找对应的页表|4.0|Per-<br>Kernel-<br>Slot|
|LAUNCH_WRK|8|ISA4.0新增寄存器，包含申请单个<br>VPT上的VACC个数，线程类型等信<br>息|4.0|Per-<br>Kernel-<br>Slot|
|MODE_WRK|9|Shadow register of MODE_CFG<br>ISA4.0进行调整|4.0|Per-Sub-<br>Thread|
|TRPBA_WRK|10|Shadow register of TRPBA_CFG<br>ISA4.0中扩展到32 bit|4.0|Per-<br>Kernel-<br>Slot|
|LCHBA_WRK|11|Shadow register of LCHBA_CFG<br>ISA4.0中扩展到32 bit.原名称为<br>INTBA_WRK|4.0|Per-<br>Kernel-<br>Slot|
|PARAM_WRK|12|ISA4.0新增寄存器，用于记录当前<br>的配置的Param地址空间|4.0|Per-<br>Kernel-<br>Slot|
|MINFO|13|Memory Information Register<br>Libra上进行了修正|4.0|Per-SIP|

|Register Name|SPR<br>ID|Description|Version|Sharing|
|---|---|---|---|---|
|MBOX_EXTRA_STS|14|ISA4.0新增寄存器，<br>MBX96~MBX127状态汇聚|4.0|Per-SIP|
|PC|16|Program Counter<br>ISA4.0中扩展到32 bit|4.0|Per-Sub-<br>Thread|
|BARRIER|17|MOVS special register, use for<br>barrier operation.|2.0|Per-SIP|
|HWT_COUNTER|18|ISA4.0新增寄存器，硬件线程计数<br>器，只要有任意软件线程运行就不<br>停计数。所有软件线程halt之后自<br>动清零|4.0|Per-SIP|
|SCC|19|2-bit scalar condition code|2.0|Per-Sub-<br>Thread|
|VAB_VPT0|20|ISA4.0新增寄存器，非兼容模式下<br>(以及兼容模式下VPT0)VACC index<br>在物理VACC寄存器堆上的起始位<br>置<br>所有指令槽共用该寄存器|4.0|Per-Sub-<br>Thread|
|VAB_VPT1|21|ISA4.0新增寄存器，兼容模式下<br>VPT1的VACC index在物理VACC寄<br>存器堆上的起始位置<br>所有指令槽共用该寄存器|4.0|Per-Sub-<br>Thread|
|NACCOVR|26|nacc field override register<br>ISA4.0增加对MLI_GEMM系列指令<br>和MOP.VMAC系列指令的override<br>功能|4.0|Per-Sub-<br>Thread|
|MB_STACK|27|ISA4.0新增寄存器，<br>MB_PUSH/MB_POP的基地址。15<br>bit|4.0|Per-Sub-<br>Thread|
|STACK_LOCAL|28|ISA4.0新增寄存器，配置当前软件<br>线程中STACK Local在SDMEM上<br>的基地址|4.0|Per-Sub-<br>Thread|
|STACK_REMOTE|29|ISA4.0新增寄存器，配置当前软件<br>线程中STACK REMOTE在UVA上的<br>基地址|4.0|Per-Sub-<br>Thread|
|LD_BASE0|32|ISA4.0新增寄存器，配合LDRS指<br>令进行标量访问|4.0|Per-Sub-<br>Thread|
|LD_BASE1|33|ISA4.0新增寄存器，配合LDRS指<br>令进行标量访问|4.0|Per-Sub-<br>Thread|

|Register Name|SPR<br>ID|Description|Version|Sharing|
|---|---|---|---|---|
|LD_BASE2|34|ISA4.0新增寄存器，配合LDRS指<br>令进行标量访问|4.0|Per-Sub-<br>Thread|
|LD_BASE3|35|ISA4.0新增寄存器，配合LDRS指<br>令进行标量访问|4.0|Per-Sub-<br>Thread|
|LD_BASE4|36|ISA4.0新增寄存器，配合LDRS指<br>令进行标量访问|4.0|Per-Sub-<br>Thread|
|LD_BASE5|37|ISA4.0新增寄存器，配合LDRS指<br>令进行标量访问|4.0|Per-Sub-<br>Thread|
|LD_BASE6|38|ISA4.0新增寄存器，配合LDRS指<br>令进行标量访问|4.0|Per-Sub-<br>Thread|
|LD_BASE7|39|ISA4.0新增寄存器，配合LDRS指<br>令进行标量访问|4.0|Per-Sub-<br>Thread|
|HW_STS|48|SIP HW status register|2.0|Per-Sub-<br>Thread|
|EXCP_PC|49|Exception PC when any<br>exception status is set<br>ISA4.0中扩展到32 bit|4.0|Per-Sub-<br>Thread|
|EXCP_BIT_EN|50|Per-exception cause trap enable<br>register. Pervious name is<br>"EXCP_TRAP"|2.0|Per-Sub-<br>Thread|
|EXCP_STS|51|Exception status when<br>EXCP_STS_GLB=0|3.2|Per-Sub-<br>Thread|
|EXCP_STS_GLB|52|Exception global mask register.<br>Pervious name is "EXCP_MASK"<br>由于TRAP1和ERET指令被放弃，而<br>Error Exception不进入Exception<br>Handler，因此该寄存器不再被使<br>用|2.0|Per-Sub-<br>Thread|
|EXCP_STS_TH|53|Exception status in trap handler<br>(when EXCP_STS_GLB=1).|3.2|Per-Sub-<br>Thread|
|TCTL|64|Thread Control Register<br>ISA4.0中由于defeature而不可写|2.0|Per-Sub-<br>Thread|
|VL|70|ISA4.0新增寄存器，用于给定<br>VACC相关指令中实际回写的元素<br>个数|4.0|Per-Sub-<br>Thread|
|VTYPE|71|ISA4.0新增寄存器，给出固定的<br>VTA|4.0|Per-Sub-<br>Thread|

|Register Name|SPR<br>ID|Description|Version|Sharing|
|---|---|---|---|---|
|LHS_DIM0_REAL|72|ISA4.0新增寄存器，MLI_GEMM左<br>支操作数水平方向实际元素个数|4.0|Per-Sub-<br>Thread|
|LHS_DIM1_REAL0|73|ISA4.0新增寄存器，MLI_GEMM左<br>支操作数开始的zero padding行数|4.0|Per-Sub-<br>Thread|
|LHS_DIM1_REAL1|74|ISA4.0新增寄存器，MLI_GEMM左<br>支操作数包含开始zero padding但<br>是不包含结尾zero padding的实际<br>行数|4.0|Per-Sub-<br>Thread|
|LHS_DIM1_REAL2|75|ISA4.0新增寄存器，MLI_GEMM左<br>支操作数包含所有zero padding的<br>实际行数|4.0|Per-Sub-<br>Thread|
|LHS_DIM0_STRIDE|76|ISA4.0新增寄存器，MLI_GEMM左<br>支操作数水平方向相邻两个元素在<br>memory中的间隔，单位为元素|4.0|Per-Sub-<br>Thread|
|LHS_DIM1_STRIDE|77|ISA4.0新增寄存器，MLI_GEMM左<br>支操作数垂直方向相邻两个元素在<br>memory中的间隔，单位为元素|4.0|Per-Sub-<br>Thread|
|RHS_DIM0_REAL0|78|ISA4.0新增寄存器，MLI_GEMM右<br>支操作数水平方向开头的zero<br>padding个数|4.0|Per-Sub-<br>Thread|
|RHS_DIM0_REAL1|79|ISA4.0新增寄存器，MLI_GEMM右<br>支操作数水平方向包含开始zero<br>padding但是不包含结尾zero<br>padding的实际元素个数|4.0|Per-Sub-<br>Thread|
|RHS_DIM0_REAL2|80|ISA4.0新增寄存器，MLI_GEMM右<br>支操作数水平方向包含所有zero<br>padding的实际元素个数|4.0|Per-Sub-<br>Thread|
|RHS_DIM1_REAL|81|ISA4.0新增寄存器，MLI_GEMM右<br>支操作数垂直方向实际元素个数<br>本寄存器为LHS_DIM0_REAL的别<br>名|4.0|Per-Sub-<br>Thread|
|RHS_DIM0_STRIDE|82|ISA4.0新增寄存器，MLI_GEMM右<br>支操作数水平方向相邻两个元素在<br>memory中的间隔，单位为元素|4.0|Per-Sub-<br>Thread|
|RHS_DIM1_STRIDE|83|ISA4.0新增寄存器，MLI_GEMM右<br>支操作数垂直方向相邻两个元素在<br>memory中的间隔，单位为元素|4.0|Per-Sub-<br>Thread|

|Register Name|SPR<br>ID|Description|Version|Sharing|
|---|---|---|---|---|
|LDST_DIM0_REAL|84|ISA4.0新增寄存器，<br>MLI_MLD/MLI_MST系列指令操作<br>数水平方向实际元素个数|4.0|Per-Sub-<br>Thread|
|LDST_DIM1_REAL|85|ISA4.0新增寄存器，<br>MLI_MLD/MLI_MST系列指令操作<br>数垂直方向实际元素个数|4.0|Per-Sub-<br>Thread|
|LDST_DIM0_STRIDE|86|ISA4.0新增寄存器，<br>MLI_MLD/MLI_MST系列指令操作<br>数水平方向相邻两个元素在<br>memory中的间隔，单位为元素|4.0|Per-Sub-<br>Thread|
|LDST_DIM1_STRIDE|87|ISA4.0新增寄存器，<br>MLI_MLD/MLI_MST系列指令操作<br>数垂直方向相邻两个元素在<br>memory中的间隔，单位为元素|4.0|Per-Sub-<br>Thread|
|MD0_WRK|96|Shadow register of MD0_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD1_WRK|97|Shadow register of MD1_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD2_WRK|98|Shadow register of MD2_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD3_WRK|99|Shadow register of MD3_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD4_WRK|100|Shadow register of MD4_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD5_WRK|101|Shadow register of MD5_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD6_WRK|102|Shadow register of MD6_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD7_WRK|103|Shadow register of MD7_CFG|2.0|Per-<br>Kernel-<br>Slot|

|Register Name|SPR<br>ID|Description|Version|Sharing|
|---|---|---|---|---|
|MD8_WRK|104|Shadow register of MD8_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD9_WRK|105|Shadow register of MD9_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD10_WRK|106|Shadow register of MD10_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD11_WRK|107|Shadow register of MD11_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD12_WRK|108|Shadow register of MD12_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD13_WRK|109|Shadow register of MD13_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD14_WRK|110|Shadow register of MD14_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD15_WRK|111|Shadow register of MD15_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD16_WRK|112|Shadow register of MD16_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD17_WRK|113|Shadow register of MD17_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD18_WRK|114|Shadow register of MD18_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD19_WRK|115|Shadow register of MD19_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD20_WRK|116|Shadow register of MD20_CFG|2.0|Per-<br>Kernel-<br>Slot|

|Register Name|SPR<br>ID|Description|Version|Sharing|
|---|---|---|---|---|
|MD21_WRK|117|Shadow register of MD21_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD22_WRK|118|Shadow register of MD22_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD23_WRK|119|Shadow register of MD23_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD24_WRK|120|Shadow register of MD24_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD25_WRK|121|Shadow register of MD25_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD26_WRK|122|Shadow register of MD26_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD27_WRK|123|Shadow register of MD27_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD28_WRK|124|Shadow register of MD28_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD29_WRK|125|Shadow register of MD29_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD30_WRK|126|Shadow register of MD30_CFG|2.0|Per-<br>Kernel-<br>Slot|
|MD31_WRK|127|Shadow register of MD31_CFG|2.0|Per-<br>Kernel-<br>Slot|

|Register Name|SPR<br>ID|Description|Version|Sharing|
|---|---|---|---|---|
|TRAP_RTB|132|ISA3.2新增寄存器<br>当软中断指令Trap1指令执行时，<br>将TRAP1指令的PC+16存放到该寄<br>存器中<br>并且执行ERET指令时自动将该寄<br>存器的地址写入PC中<br>ISA4.0中扩展到32 bit。<br>由于TRAP1和ERET指令被放弃，该<br>寄存器不再被使用|3.2|Per-Sub-<br>Thread|
|INTR_SD0|133|ISA3.2新增寄存器，预留用于软件<br>保存软中断/异步中断时的GPRs现<br>场/compiler register spill<br>ISA4.0扩展为64bit<br>由于TRAP1和ERET指令被放弃，该<br>寄存器不再被使用|4.0|Per-Sub-<br>Thread|
|INTR_SD1|134|ISA3.2新增寄存器，预留用于<br>compiler中断时保存现场/寄存器<br>spill<br>ISA4.0扩展为64bit<br>由于TRAP1和ERET指令被放弃，该<br>寄存器不再被使用|4.0|Per-Sub-<br>Thread|
|INTR_SD2|135|ISA3.2新增寄存器，预留用于<br>compiler中断时保存现场/寄存器<br>spill<br>ISA4.0扩展为64bit<br>由于TRAP1和ERET指令被放弃，该<br>寄存器不再被使用|4.0|Per-Sub-<br>Thread|
|INTR_SD3|136|ISA3.2新增寄存器，预留用于<br>compiler中断时保存现场/寄存器<br>spill<br>ISA4.0扩展为64bit<br>由于TRAP1和ERET指令被放弃，该<br>寄存器不再被使用|4.0|Per-Sub-<br>Thread|
|INTR_SD4|137|ISA3.2新增寄存器，预留用于<br>compiler中断时保存现场/寄存器<br>spill<br>ISA4.0扩展为64bit<br>由于TRAP1和ERET指令被放弃，该<br>寄存器不再被使用|4.0|Per-Sub-<br>Thread|

|Register Name|SPR<br>ID|Description|Version|Sharing|
|---|---|---|---|---|
|INTR_SD5|138|ISA3.2新增寄存器，预留用于<br>compiler中断时保存现场/寄存器<br>spill<br>ISA4.0扩展为64bit<br>由于TRAP1和ERET指令被放弃，该<br>寄存器不再被使用|4.0|Per-Sub-<br>Thread|
|INTR_SD6|139|ISA3.2新增寄存器，预留用于<br>compiler中断时保存现场/寄存器<br>spill<br>ISA4.0扩展为64bit<br>由于TRAP1和ERET指令被放弃，该<br>寄存器不再被使用|4.0|Per-Sub-<br>Thread|
|INTR_SD7|140|ISA3.2新增寄存器，预留用于<br>compiler中断时保存现场/寄存器<br>spill<br>ISA4.0扩展为64bit<br>由于TRAP1和ERET指令被放弃，该<br>寄存器不再被使用|4.0|Per-Sub-<br>Thread|
|ESL_DTYPE|160|ISA4.0新增寄存器，用于指定非<br>AMO指令时awusr域上数据类型|4.0|Per-Sub-<br>Thread|
|ESL_ORDER|161|ISA4.0新增寄存器，设置后标量ST<br>指令在访问EDF时设置awusr中的<br>ESL_ORDER域|4.0|Per-Sub-<br>Thread|
|DPF_ASID|193|DPF所对应的ASID。线程启动时初<br>始化为THREAD_ASID。可以通过<br>修改该ASID进行跨进程数据的预取|4.0|Per-Sub-<br>Thread|
|IPF_ADDR|194|ISA3.2新增寄存器，<br>IDMA/ITAGOP指令的<br>IMEM_BASE。起始地址地址要求<br>cacheline对齐<br>ISA4.0中扩展为48bit|4.0|Per-Sub-<br>Thread|
|IPF_ASID|195|IPF所对应的ASID。线程启动时初<br>始化为ASID_WRK，可修改。用于<br>IDMA/ITAGOP指令|4.0|Per-Sub-<br>Thread|
|IPF_KSID|196|IPF所对应的KSID。线程启动时初<br>始化为KSID_WRK，可修改。用于<br>IDMA/ITAGOP指令|4.0|Per-Sub-<br>Thread|
|Reserved|others|Reserved for future. Read value<br>all 0s|||

## 7. SPR Details

### 7.1. SIP_ID

**Register Name:** `SIP_ID`

- **SPR ID:** `000`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SIC_ID|7:4|0|RO|The SIC which current SIP belongs to. Set by CSR<br>SIP_ID.SIC_ID field|
|SIP_ID|3:0|0|RO|SIP logic ID after harvest.Set by CSR SIP_ID.SIP_ID<br>field|

### 7.2. THD_SLOT_IDX

**Register Name:** `THD_SLOT_IDX`

- **SPR ID:** `002`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SLOT_IDX|3:0|0|RO|指示当前软件线程占用当前硬件线程中的第几个线程<br>调度资源。<br>Libra SIP中一个硬件线程支持16个软件线程调度资<br>源|

### 7.3. PROCESS_ID_WRK

**Register Name:** `PROCESS_ID_WRK`

- **SPR ID:** `003`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PROCESS_ID|15:0|0|RO|ISA4.0新增寄存器，记录当前软件线程的进程号|

### 7.4. PACKAGE_ID_WRK

**Register Name:** `PACKAGE_ID_WRK`

- **SPR ID:** `004`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PACKAGE_ID|31:0|0|RO|PACKAGE ID. Used for Event Trace|

### 7.5. SUB_THD_ID_WRK

**Register Name:** `SUB_THD_ID_WRK`

- **SPR ID:** `005`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SUB_THD_ID|31:0|0|RO|ISA4.0新增寄存器，在Kernel发射一组sub thread<br>时，软件给初始的sub_thread_id，每发射一个<br>sub thread该数值就加1|

### 7.6. ASID_WRK

**Register Name:** `ASID_WRK`

- **SPR ID:** `006`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ASID|3:0|0|RO|ISA4.0新增寄存器，线程发射时配置的ASID，用于取指<br>和UVA空间访问|

### 7.7. KSID_WRK

**Register Name:** `KSID_WRK`

- **SPR ID:** `007`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|KSID|5:0|0|RO|ISA4.0新增寄存器，线程发射时配置的KSID，用于取指<br>以及发射时ICache Invalid操作|

### 7.8. LAUNCH_WRK

**Register Name:** `LAUNCH_WRK`

- **SPR ID:** `008`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|THREAD_OACC|25:16|0|RO|本线程所需要的单个VPT上的OACC数<br>量。范围0~768，需要4对齐|
|SUB_THREAD_NUM|15:12|0|RO|指示本次Kernel发射时要展开的sub<br>thread数据。具体数值为<br>SUB_THREAD_NUM+1|
|THREAD_TYPE|9:8|0|RO|指示本线程是否为Scorpio兼容算子线<br>程。具体定义请见SIP Arch Spec|
|DISABLE_VACC_HASH|4:4|0|RO|Reserved|
|INVALID_ICACHE|0:0|0|RO|在launch时，是否根据本次KSID来对<br>ICache的cacheline进行invalid操作|

### 7.9. MODE_WRK

**Register Name:** `MODE_WRK`

- **SPR ID:** `009`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BF16_OVCLP|18:18|0|RW|Working Register copy. See<br>MODE_CFG.BF16_OVCLP|
|INT_OVCLP|17:17|0|RW|Working Register copy. See<br>MODE_CFG.INT_OVCLP|
|FP16_OVCLP|16:16|0|RW|Working Register copy. See<br>MODE_CFG.FP16_OVCLP|
|FP_DENORM|15:8|ff|RW|Working Register copy.<br>[9:8] for FP16, [11:10] for FP32, [13:12] for<br>BF16<br>for each 2-bit field:<br>0x0: non-denormal flush<br>0x1: output denormal flush<br>0x2: input denormal flush<br>0x3: input & output denormal flush|
|FP_ROUND|7:0|0|RW|Working Register copy.<br>[1:0] for FP16, [3:2] for FP32, [5:4] for BF16<br>for each 2-bit field:<br>0x0: rounding-to-nearest-even(RNE)<br>0x1: rounding-to-zero(RNZ)<br>0x2 & 0x3: reserved|

### 7.10. TRPBA_WRK

**Register Name:** `TRPBA_WRK`

- **SPR ID:** `010`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TRPBA|31:0|0|RO|Trap Base Address config register for trap handler|

### 7.11. LCHBA_WRK

**Register Name:** `LCHBA_WRK`

- **SPR ID:** `011`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|LCHBA|31:0|0|RO|Kernel Launch Base Address config register, hold<br>point for interrupt handler. Since SIP is 16 byte to<br>fetch Ins, SW should make sure that [3:0] are all<br>0s.|

### 7.12. PARAM_WRK

**Register Name:** `PARAM_WRK`

- **SPR ID:** `012`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PARAM_ADDR|26:16|0x0|RO|Parameter start address in SDMEM(PA) and<br>Param buffer(VA).<br>SDMEM_PHYSICAL_ADDR = PARAM_ADDR *<br>128B<br>PARAM_VIRTUAL_ADDR = 0x1_4000_0000 +<br>PARAM_ADDR * 128B<br>Valid range: 0-0x3FF|
|PARAM_SIZE|10:0|0x0|RO|Parameter buffer size = PARAM_SIZE * 128B<br>Valid range: 0-0x400.<br>PARAM_SIZE==0 means NO Param Buffer<br>Note: PARAM_ADDR + PARAM_SIZE should no<br>more than 0x400|

### 7.13. MINFO

**Register Name:** `MINFO`

- **SPR ID:** `013`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VDMEM_SIZE|27:16|0x400|RO|VDMEM_SIZE in unit of 1KB|
|SDMEM_SIZE|7:0|0x80|RO|SDMEM_SIZE in unit of 1KB|

### 7.14. MBOX_EXTRA_STS

**Register Name:** `MBOX_EXTRA_STS`

- **SPR ID:** `014`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MBOX_EXTRA_STS|31:0|0x0|RO|Bit0~Bit31分别代表了General<br>mailbox96~127的状态。用于支持virtual<br>mailbox 128~143的功能应用|

### 7.15. PC

**Register Name:** `PC`

- **SPR ID:** `016`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|PC|31:0|0|RO|With the unit of byte, 30-bit PC is needed, this PC is app executed track, but it may be not exact as HW pipeline level.|

### 7.16. BARRIER

**Register Name:** `BARRIER`

- **SPR ID:** `017`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RO|Empty, always read 0. When SW using MOVS to<br>read BARRIER SPR, this instruction will ensure<br>following instruction will only get executed when all<br>previous memory access instructions are all done,<br>responses are all received and no exception<br>happened.|

### 7.17. HWT_COUNTER

**Register Name:** `HWT_COUNTER`

- **SPR ID:** `018`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|COUNTER|63:0|0|RW|ISA4.0新增计数器。SIP复位时清零，整个SIP为halt<br>状态时保持上次计数结果不变<br>当有任意一个软件线程不为halt时，计数器每个周<br>期加1，并且不受到clock gating的影响<br>对该寄存器的任意写都会触发一次清零，建议只由<br>Supervisor对该寄存器进行写操作<br>预期用于提供给软件作为HAL_clock()的功能|

### 7.18. SCC

**Register Name:** `SCC`

- **SPR ID:** `019`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|Carry|1:1|0|RW|SCC.Carry|
|Compare|0:0|0|RW|SCC.Compare|

### 7.19. VAB_VPT0

**Register Name:** `VAB_VPT0`

- **SPR ID:** `020`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BASE_IDX|12:0|0|RW|VACC src register index base (unsigned) for VPT0<br>in Legacy Instruction mode and New mode. The<br>[4:0] bits are masked to 0 by HW.|

### 7.20. VAB_VPT1

**Register Name:** `VAB_VPT1`

- **SPR ID:** `021`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BASE_IDX|12:0|0|RW|VACC src register index base (unsigned) for VPT1<br>in Legacy Instruction mode. The [4:0] bits are<br>masked to 0 by HW.<br>Note: This register cannot be written by<br>MOVSR2SPR when LAUNCH_WRK.THREAD_TYPE<br>== 0/1. Ohterwise the pipeline might be hang.|

### 7.21. NACCOVR

**Register Name:** `NACCOVR`

- **SPR ID:** `026`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MOP_VMAC_NACC|0:0|0|RW|1 menas disabling accumulation in<br>MOP.MAC serial instruction; 0 means<br>following instruction encode.|
|GEMM_NACC|1:1|0|RW|1 menas disable accmulation in MLI_GEMM serial instructions; 0 means following instruction encode.|

### 7.22. MB_STACK

**Register Name:** `MB_STACK`

- **SPR ID:** `027`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|MB_STACK|9:0|0x0|RW|ISA4.0新增寄存器，用于支持MB_PUSH和MB_POP<br>指令<br>MB_STACK[9:0]域用于记录作为maskbit stack的那<br>个VACC寄存器，该寄存器地址为相对当前VAB配置<br>的数值。|

### 7.23. STACK_LOCAL

- **SPR ID:** `028`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|LOCAL_V_BASE|26:16|0x0|RW|有效范围0x0-0x400<br>当LOCAL_V_BASE=0x400时，该Stack不存在<br>STACK_LOCAL，只有STACK_REMOTE<br>当LOCAL_V_BASE=0~0x3FF时，该Stack起始虚<br>拟地址和结束虚拟地址如下:<br>起始地址(PA):VA_start = 0x1_50FE_0000 +<br>(0x10_0000 * thread_slot_id) +<br>(LOCAL_V_BASE * 128)<br>即起始地址为5GB + (16MB * thread_slot_id) +<br>(272MB-128KB) + (128B * LOCAL_V_BASE)<br>结束地址(PA):VA_end = 0x1_5000_0000 +<br>(0x10_0000 * (thread_slot_id+1)) - 1B<br>即结束地址为5GB + (16MB * thread_slot_id) +<br>272MB - 1B<br>注意：本域同时决定了Stack local/Stack<br>remote分界，以及stack local的大小|

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|LOCAL_P_BASE|10:0|0x0|RW|有效范围0x0-0x400<br>Stack Local在SDMEM上的起始地址为<br>PHY_ST_ADDR = LOCAL_P_BASE * 128B<br>Stack Local在SDMEM上的起始地址为<br>PHY_END_ADDR = (LOCAL_P_BASE -<br>LOCAL_V_BASE) * 128B + 128KB - 1B<br>注意：必须保证LOCAL_P_BASE不大于<br>LOCAL_V_BASE，否则虚拟地址上的空间无法完<br>全映射到SDMEM上|

### 7.24. STACK_REMOTE

**Register Name:** `STACK_REMOTE`

- **SPR ID:** `029`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|STACK_SIZE|52:48|0x0|RW|指示当前Stack区域有多少MB被映射到<br>UVA中(最高的一部分可能被<br>STACK_LOCAL覆盖)<br>有效范围0~16。0表示当前<br>STACK_REMOTE无效。16时只有<br>15.5MB会被映射(最低0.5MB被屏蔽)<br>其他情况下映射范围即为STACK_SIZE *<br>1MB<br>注意，UVA上映射区间为<br>STACK_REMOTE_BASE+(16-<br>STACK_SIZE)*1MB ~<br>STACK_REMOTE_BASE+16MB-1B<br>VA映射区间为5.25GB+<br>(THD_SLOT_ID)*16MB+(16-<br>STACK_SIZE)*1MB ~ 5.25GB+<br>(THD_SLOT_ID)*16MB+16MB-1B|
|STACK_REMOTE_BASE|47:0|0x0|RW|ISA4.0新增寄存器，用于记录当前软件线<br>程stack映射到UVA上的地址。<br>对于stack buffer的<br>(THD_SLOT_IDX)*16MB ~<br>(THD_SLOT_IDX+1)*16MB-1B的地址，<br>会被映射到本地址开始的16MB上<br>但是最高部分地址会被STACK_LOCAL二<br>次映射到SDMEM中，而最低的0.5MB会<br>被屏蔽无法访问<br>STACK_REMOTE_BASE要求1MB对齐|

### 7.25. LD_BASE0

**Register Name:** `LD_BASE0`

- **SPR ID:** `032`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BASE0|63:0|0|RW|ADDR_BASE0 for LDRS instruction. High 16-bits are<br>hint for both HW & SW|

### 7.26. LD_BASE1

**Register Name:** `LD_BASE1`

- **SPR ID:** `033`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BASE1|63:0|0|RW|ADDR_BASE1 for LDRS instruction. High 16-bits are<br>hint for both HW & SW|

### 7.27. LD_BASE2

**Register Name:** `LD_BASE2`

- **SPR ID:** `034`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BASE2|63:0|0|RW|ADDR_BASE2 for LDRS instruction. High 16-bits are<br>hint for both HW & SW|

### 7.28. LD_BASE3

**Register Name:** `LD_BASE3`

- **SPR ID:** `035`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BASE3|63:0|0|RW|ADDR_BASE3 for LDRS instruction. High 16-bits are<br>hint for both HW & SW|

### 7.29. LD_BASE4

**Register Name:** `LD_BASE4`

- **SPR ID:** `036`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BASE4|63:0|0|RW|ADDR_BASE4 for LDRS instruction. High 16-bits are<br>hint for both HW & SW|

### 7.30. LD_BASE5

**Register Name:** `LD_BASE5`

- **SPR ID:** `037`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BASE5|63:0|0|RW|ADDR_BASE5 for LDRS instruction. High 16-bits are<br>hint for both HW & SW|

### 7.31. LD_BASE6

**Register Name:** `LD_BASE6`

- **SPR ID:** `038`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BASE6|63:0|0|RW|ADDR_BASE6 for LDRS instruction. High 16-bits are<br>hint for both HW & SW|

### 7.32. LD_BASE7

**Register Name:** `LD_BASE7`

- **SPR ID:** `039`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BASE7|63:0|0|RW|ADDR_BASE7 for LDRS instruction. High 16-bits are<br>hint for both HW & SW|

### 7.33. HW_STS

**Register Name:** `HW_STS`

- **SPR ID:** `048`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|BRKP_HIT|21:20|0|W1C|Sticky bit. Set as 1 when SIP enter debug<br>mode or trap handler for breakpoint1 hit.<br>Sticky bit. Set as 1 when SIP enter debug<br>mode or trap handler for breakpoint0 hit.<br>Note: This register cannot be written by<br>MOVSR2SPR. Ohterwise pipeline may<br>hang|
|WAIT_ID|15:8|0|RO|Indicates mailbox ID.|
|WAIT_GSYNC|5:5|0|RO|Indicates whether it is waiting GSYNC<br>mailbox or not.|
|DBG_MODE|4:4|0|RO|Indicate SIP pipeline is whether in debug<br>mode or not<br>0: Normal mode.<br>1: Debug mode.|
|PLC_FSM|3:0|0|RO|Indicate SIP pipeline state<br>0: HALT<br>1: RUN(a.k.a BUSY)<br>2: Wait<br>Others: Reserved|

### 7.34. EXCP_PC

**Register Name:** `EXCP_PC`

- **SPR ID:** `049`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|EXCP_PC|31:0|0|RO|Capture Exception PC when corresponding<br>exception is triggered and exception trap is<br>taken. If the exception is LSB write AXI bus parity<br>error exception or Write (CF) response error<br>exception, the EXCP_PC is imprecise PC.|

### 7.35. EXCP_BIT_EN

**Register Name:** `EXCP_BIT_EN`

- **SPR ID:** `050`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0x1073f3ff|RO|Per-exception-event enable bit. If a bit is 1 and<br>corresponding exception status bit in EXCP_STS is<br>also 1, then program will transfer control to<br>exception handler.<br>[0] EXCP_IMEM_RAS_ERR<br>[1] EXCP_VDMEM_RAS_ERR<br>[2] EXCP_SDMEM_RAS_ERR<br>[3] EXCP_VARAM_RAS_ERR<br>[4] EXCP_SRTAR_RAS_ERR<br>[5] EXCP_IVSMR_RAS_ERR<br>[6] EXCP_S3INST_RAS_ERR<br>[7] EXCP_L1CTRL_RAS_ERR<br>[8] EXCP_L1DATA_RAS_ERR<br>[9] EXCP_CF_RAS_ERR<br>[10] EXCP_DF_RAS_ERR<br>[12] EXCP_ILL_IS<br>~~[13] EXCP_ADDR_UNALIGN~~<br>[14] EXCP_ADDR_INVALID<br>[15] EXCP_CF_RESP_ERR<br>[16] EXCP_DF_RESP_ERR<br>~~[17] EXCP_MIX_ATTR~~<br>~~[18] EXCP_VACC_INVALID~~<br>~~[19] EXCP_PC_ERR~~<br>[20] EXCP_ICACHE_DF_RAS_ERR<br>[21] EXCP_ICACHE_DF_RESP_ERR<br>[22] EXCP_ICACHE_MISS_VICTIM_ERR<br>~~[23] EXCP_REAL_SIZE~~<br>~~[24] EXCP_VL~~<br>~~[28] EXCP_TRAP_INS~~<br>other : Reserved|
### 7.36. EXCP_STS
**Register Name:** `EXCP_STS`

- **SPR ID:** `051`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RO|When exception is occurred and NOT in trap handler<br>process, the exception is captured in this register for<br>each event individually. 1 means corresponding<br>events happened, 0 means not.<br>Once captured as 1, it will be kepted as 1 until SW<br>clearing it.<br>[0] EXCP_IMEM_RAS_ERR<br>[1] EXCP_VDMEM_RAS_ERR<br>[2] EXCP_SDMEM_RAS_ERR<br>[3] EXCP_VARAM_RAS_ERR<br>[4] EXCP_SRTAR_RAS_ERR<br>[5] EXCP_IVSMR_RAS_ERR<br>[6] EXCP_S3INST_RAS_ERR<br>[7] EXCP_L1CTRL_RAS_ERR<br>[8] EXCP_L1DATA_RAS_ERR<br>[9] EXCP_CF_RAS_ERR<br>[10] EXCP_DF_RAS_ERR<br>[12] EXCP_ILL_IS<br>~~[13] EXCP_ADDR_UNALIGN~~<br>[14] EXCP_ADDR_INVALID<br>[15] EXCP_CF_RESP_ERR<br>[16] EXCP_DF_RESP_ERR<br>~~[17] EXCP_MIX_ATTR~~<br>~~[18] EXCP_VACC_INVALID~~<br>~~[19] EXCP_PC_ERR~~<br>[20] EXCP_ICACHE_DF_RAS_ERR<br>[21] EXCP_ICACHE_DF_RESP_ERR<br>[22] EXCP_ICACHE_MISS_VICTIM_ERR<br>~~[23] EXCP_REAL_SIZE~~<br>~~[24] EXCP_VL~~<br>~~[28] EXCP_TRAP_INS~~<br>Other : Reserved|

### 7.37. EXCP_STS_GLB

**Register Name:** `EXCP_STS_GLB`

- **SPR ID:** `052`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|0:0|0|RO|When EXCP_BIT_EN & EXCP_STS !=0, when HW<br>jumping to exception handler, setting 1;<br>In exception handler, before exit trap handler. SW<br>should clear this register to 0, for clear<br>EXCP_STS_GLB, SW should first to clear EXCP_STS<br>and EXCP_STS_TH, then clear EXCP_STS_GLB and<br>EXCP_PC, otherwise the EXCP_STS will set the<br>EXCP_STS_GLB again.<br>由于TRAP1和ERET指令被放弃，该寄存器不再被使用|

### 7.38. EXCP_STS_TH

**Register Name:** `EXCP_STS_TH`

- **SPR ID:** `053`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VAL|31:0|0|RO|This register is used to record the exceptions<br>triggered in trap handler process. 1 means<br>corresponding events happened, 0 means not.<br>Once captured as 1, it will be kepted as 1 until SW<br>clearing it.<br>[0] EXCP_IMEM_RAS_ERR<br>[1] EXCP_VDMEM_RAS_ERR<br>[2] EXCP_SDMEM_RAS_ERR<br>[3] EXCP_VARAM_RAS_ERR<br>[4] EXCP_SRTAR_RAS_ERR<br>[5] EXCP_IVSMR_RAS_ERR<br>[6] EXCP_S3INST_RAS_ERR<br>[7] EXCP_L1CTRL_RAS_ERR<br>[8] EXCP_L1DATA_RAS_ERR<br>[9] EXCP_CF_RAS_ERR<br>[10] EXCP_DF_RAS_ERR<br>[12] EXCP_ILL_IS<br>~~[13] EXCP_ADDR_UNALIGN~~<br>[14] EXCP_ADDR_INVALID<br>[15] EXCP_CF_RESP_ERR<br>[16] EXCP_DF_RESP_ERR<br>~~[17] EXCP_MIX_ATTR~~<br>~~[18] EXCP_VACC_INVALID~~<br>~~[19] EXCP_PC_ERR~~<br>[20] EXCP_ICACHE_DF_RAS_ERR<br>[21] EXCP_ICACHE_DF_RESP_ERR<br>[22] EXCP_ICACHE_MISS_VICTIM_ERR<br>~~[23] EXCP_REAL_SIZE~~<br>~~[24] EXCP_VL~~<br>~~[28] EXCP_TRAP_INS~~<br>other Reserved|

### 7.39. TCTL

**Register Name:** `TCTL`

- **SPR ID:** `064`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SEL_TID|0:0|0|RO|Reserved|
|T0_DIS|16:16|0|RW|if it is 1, thread 0 is disabled, all instructions for<br>vector thread 0 will be considered as NOP,<br>including MOVS.VCC whose src is in thread 0;<br>otherwise it will be parsed normally<br>根据FCR，软件不允许将本域更新为非0数值|
|T1_DIS|17:17|0|RW|if it is 1, thread 1 is disabled, all instructions for<br>vector thread 1 will be considered as NOP,<br>including MOVS.VCC whose src is in thread 1;<br>otherwise it will be parsed normally<br>根据FCR，软件不允许将本域更新为非0数值|

### 7.40. VL

**Register Name:** `VL`

- **SPR ID:** `070`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VL|9:0|0x200|RW|unsigned integer specifying the number of elements<br>to be updated with results from a<br>VACC/DACC/QACC/OACC vector|

### 7.41. VTYPE

**Register Name:** `VTYPE`

- **SPR ID:** `071`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|VTA|6:6|1|RO|Vector tail agnostic|

### 7.42. LHS_DIM0_REAL

**Register Name:** `LHS_DIM0_REAL`

- **SPR ID:** `072`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DIM0_REAL_SIZE|7:0|0x80|RW|MLI_GEMM指令左输入操作数的水平方向实际<br>元素个数<br>单位为元素<br>有效范围：0~128|

### 7.43. LHS_DIM1_REAL0

**Register Name:** `LHS_DIM1_REAL0`

- **SPR ID:** `073`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DIM1_REAL_SIZE0|8:0|0x0|RW|MLI_GEMM指令左输入操作数中垂直方向开始<br>zero padding元素个数<br>单位为元素<br>有效范围：0~256|

### 7.44. LHS_DIM1_REAL1

**Register Name:** `LHS_DIM1_REAL1`

- **SPR ID:** `074`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DIM1_REAL_SIZE1|8:0|0x100|RW|MLI_GEMM指令左输入操作数中垂直方向上包<br>含开始zero padding但是不包含结尾zero<br>padding的实际元素个数<br>单位为元素<br>有效范围：0~256|

### 7.45. LHS_DIM1_REAL2

**Register Name:** `LHS_DIM1_REAL2`

- **SPR ID:** `075`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DIM1_REAL_SIZE2|8:0|0x100|RW|MLI_GEMM指令左输入操作数中垂直方向上包<br>含所有zero padding在内的实际元素个数<br>单位为元素<br>有效范围：0~256|

### 7.46. LHS_DIM0_STRIDE

**Register Name:** `LHS_DIM0_STRIDE`

- **SPR ID:** `076`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DIM0_STRIDE|0:0|0x1|RO|MLI_GEMM指令左输入操作数的水平方向相邻两<br>个元素在memory中的间隔<br>单位为元素。本寄存器数值始终为1|

### 7.47. LHS_DIM1_STRIDE

**Register Name:** `LHS_DIM1_STRIDE`

- **SPR ID:** `077`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DIM1_STRIDE|31:0|0x0|RW|MLI_GEMM指令左输入操作数的垂直方向相邻两<br>个元素在memory中的间隔<br>单位为元素|

### 7.48. RHS_DIM0_REAL0

**Register Name:** `RHS_DIM0_REAL0`

- **SPR ID:** `078`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DIM0_REAL_SIZE0|7:0|0x0|RW|MLI_GEMM指令右输入操作数的水平方向开头<br>的zero padding个数<br>单位为元素|

### 7.49. RHS_DIM0_REAL1

**Register Name:** `RHS_DIM0_REAL1`

- **SPR ID:** `079`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DIM0_REAL_SIZE1|7:0|0x80|RW|MLI_GEMM指令右输入操作数的水平方向包含开始zero padding但是不包含结尾zero padding的实际元素个数<br>单位为元素|

### 7.50. RHS_DIM0_REAL2

**Register Name:** `RHS_DIM0_REAL2`

- **SPR ID:** `080`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DIM0_REAL_SIZE_WTP|7:0|0x80|RW|MLI_GEMM指令右输入操作数的水平方向<br>包含所有zero padding的实际元素个数<br>单位为元素|

### 7.51. RHS_DIM1_REAL

**Register Name:** `RHS_DIM1_REAL`

- **SPR ID:** `081`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DIM1_REAL_SIZE|7:0|0x80|RW|MLI_GEMM指令右输入操作数的垂直方向实际<br>元素个数<br>单位为元素<br>本寄存器为LHS_DIM0_REAL的别名。修改<br>LHS_DIM0_REAL之后本寄存器数值同步更新。<br>反之依然<br>有效范围：0~128|

### 7.52. RHS_DIM0_STRIDE

**Register Name:** `RHS_DIM0_STRIDE`

- **SPR ID:** `082`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DIM0_STRIDE|31:0|0x0|RW|MLI_GEMM指令右输入操作数的水平方向相邻两个元素在memory中的间隔<br>单位为元素|

### 7.53. RHS_DIM1_STRIDE

**Register Name:** `RHS_DIM1_STRIDE`

- **SPR ID:** `083`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DIM1_STRIDE|31:0|0x0|RW|MLI_GEMM指令右输入操作数的垂直方向相邻两<br>个元素在memory中的间隔<br>单位为元素|

### 7.54. LDST_DIM0_REAL

**Register Name:** `LDST_DIM0_REAL`

- **SPR ID:** `084`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DIM0_REAL_SIZE|9:0|0x80|RW|MLI_MLD/MLI_MST系列指令操作数的水平方向<br>实际元素个数<br>单位为元素|

### 7.55. LDST_DIM1_REAL

**Register Name:** `LDST_DIM1_REAL`

- **SPR ID:** `085`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DIM1_REAL_SIZE|8:0|0x100|RW|MLI_MLD/MLI_MST系列指令操作数的垂直方向<br>实际元素个数<br>单位为元素<br>有效范围0~0x100|

### 7.56. LDST_DIM0_STRIDE

**Register Name:** `LDST_DIM0_STRIDE`

- **SPR ID:** `086`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DIM0_STRIDE|31:0|0x0|RW|MLI_MLD/MLI_MST系列指令操作数的水平方向相<br>邻两个元素在memory中的间隔<br>单位为元素|

### 7.57. LDST_DIM1_STRIDE

**Register Name:** `LDST_DIM1_STRIDE`

- **SPR ID:** `087`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DIM1_STRIDE|31:0|0x0|RW|MLI_MLD/MLI_MST系列指令操作数的垂直方向相<br>邻两个元素在memory中的间隔<br>单位为元素|

### 7.58. MD0_WRK

**Register Name:** `MD0_WRK`

- **SPR ID:** `096`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD0_WRK|

### 7.59. MD1_WRK

**Register Name:** `MD1_WRK`

- **SPR ID:** `097`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD1_WRK|

### 7.60. MD2_WRK

**Register Name:** `MD2_WRK`

- **SPR ID:** `098`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD2_WRK|

### 7.61. MD3_WRK

**Register Name:** `MD3_WRK`

- **SPR ID:** `099`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD3_WRK|

### 7.62. MD4_WRK

**Register Name:** `MD4_WRK`

- **SPR ID:** `100`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD4_WRK|

### 7.63. MD5_WRK

**Register Name:** `MD5_WRK`

- **SPR ID:** `101`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD5_WRK|

### 7.64. MD6_WRK

**Register Name:** `MD6_WRK`

- **SPR ID:** `102`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD6_WRK|

### 7.65. MD7_WRK

**Register Name:** `MD7_WRK`

- **SPR ID:** `103`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD7_WRK|

### 7.66. MD8_WRK

**Register Name:** `MD8_WRK`

- **SPR ID:** `104`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD8_WRK|

### 7.67. MD9_WRK

**Register Name:** `MD9_WRK`

- **SPR ID:** `105`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD9_WRK|

### 7.68. MD10_WRK

**Register Name:** `MD10_WRK`

- **SPR ID:** `106`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD10_WRK|

### 7.69. MD11_WRK

**Register Name:** `MD11_WRK`

- **SPR ID:** `107`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD11_WRK|

### 7.70. MD12_WRK

**Register Name:** `MD12_WRK`

- **SPR ID:** `108`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD12_WRK|

### 7.71. MD13_WRK

**Register Name:** `MD13_WRK`

- **SPR ID:** `109`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD13_WRK|

### 7.72. MD14_WRK

**Register Name:** `MD14_WRK`

- **SPR ID:** `110`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD14_WRK|

### 7.73. MD15_WRK

**Register Name:** `MD15_WRK`

- **SPR ID:** `111`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD15_WRK|

### 7.74. MD16_WRK

**Register Name:** `MD16_WRK`

- **SPR ID:** `112`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD16_WRK|

### 7.75. MD17_WRK

**Register Name:** `MD17_WRK`

- **SPR ID:** `113`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD17_WRK|

### 7.76. MD18_WRK

**Register Name:** `MD18_WRK`

- **SPR ID:** `114`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD18_WRK|

### 7.77. MD19_WRK

**Register Name:** `MD19_WRK`

- **SPR ID:** `115`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD19_WRK|

### 7.78. MD20_WRK

**Register Name:** `MD20_WRK`

- **SPR ID:** `116`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD20_WRK|

### 7.79. MD21_WRK

**Register Name:** `MD21_WRK`

- **SPR ID:** `117`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD21_WRK|

### 7.80. MD22_WRK

**Register Name:** `MD22_WRK`

- **SPR ID:** `118`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD22_WRK|

### 7.81. MD23_WRK

**Register Name:** `MD23_WRK`

- **SPR ID:** `119`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD23_WRK|

### 7.82. MD24_WRK

**Register Name:** `MD24_WRK`

- **SPR ID:** `120`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD24_WRK|

### 7.83. MD25_WRK

**Register Name:** `MD25_WRK`

- **SPR ID:** `121`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD25_WRK|

### 7.84. MD26_WRK

**Register Name:** `MD26_WRK`

- **SPR ID:** `122`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD26_WRK|

### 7.85. MD27_WRK

**Register Name:** `MD27_WRK`

- **SPR ID:** `123`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD27_WRK|

### 7.86. MD28_WRK

**Register Name:** `MD28_WRK`

- **SPR ID:** `124`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD28_WRK|

### 7.87. MD29_WRK

**Register Name:** `MD29_WRK`

- **SPR ID:** `125`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD29_WRK|

### 7.88. MD30_WRK

**Register Name:** `MD30_WRK`

- **SPR ID:** `126`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD30_WRK|

### 7.89. MD31_WRK

**Register Name:** `MD31_WRK`

- **SPR ID:** `127`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|31:0|0x0|RO|Shadow register of CSR MD31_WRK|

### 7.90. TRAP_RTB

**Register Name:** `TRAP_RTB`

- **SPR ID:** `132`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|RTB|31:0|0|RW|The return address of TRAP1 instruction and async<br>interrupt.<br>由于TRAP1和ERET指令被放弃，该寄存器不再被使用|

### 7.91. INTR_SD0

**Register Name:** `INTR_SD0`

- **SPR ID:** `133`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|63:0|N/A|RW|Interrupt shadow register 0.<br>Reserved to save context in trap1/interrupt<br>由于TRAP1和ERET指令被放弃，该寄存器不再被使用|

### 7.92. INTR_SD1

**Register Name:** `INTR_SD1`

- **SPR ID:** `134`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|63:0|N/A|RW|Interrupt shadow register 1.<br>Reserved to save context in trap1/interrupt<br>由于TRAP1和ERET指令被放弃，该寄存器不再被使用|

### 7.93. INTR_SD2

**Register Name:** `INTR_SD2`

- **SPR ID:** `135`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|63:0|N/A|RW|Interrupt shadow register 2.<br>Reserved to save context in trap1/interrupt<br>由于TRAP1和ERET指令被放弃，该寄存器不再被使用|

### 7.94. INTR_SD3

**Register Name:** `INTR_SD3`

- **SPR ID:** `136`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|63:0|N/A|RW|Interrupt shadow register 3.<br>Reserved to save context in trap1/interrupt<br>由于TRAP1和ERET指令被放弃，该寄存器不再被使用|

### 7.95. INTR_SD4

**Register Name:** `INTR_SD4`

- **SPR ID:** `137`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|63:0|N/A|RW|Interrupt shadow register 4.<br>Reserved to save context in trap1/interrupt<br>由于TRAP1和ERET指令被放弃，该寄存器不再被使用|

### 7.96. INTR_SD5

**Register Name:** `INTR_SD5`

- **SPR ID:** `138`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD5|63:0|N/A|RW|Interrupt shadow register 5.<br>Reserved to save context in trap1/interrupt<br>由于TRAP1和ERET指令被放弃，该寄存器不再被使用|

### 7.97. INTR_SD6

**Register Name:** `INTR_SD6`

- **SPR ID:** `139`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|63:0|N/A|RW|Interrupt shadow register 6.<br>Reserved to save context in trap1/interrupt<br>由于TRAP1和ERET指令被放弃，该寄存器不再被使用|

### 7.98. INTR_SD7

**Register Name:** `INTR_SD7`

- **SPR ID:** `140`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|SD|63:0|N/A|RW|Interrupt shadow register 7.<br>Reserved to save context in trap1/interrupt<br>由于TRAP1和ERET指令被放弃，该寄存器不再被使用|

### 7.99. ESL_DTYPE

**Register Name:** `ESL_DTYPE`

- **SPR ID:** `160`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|TYPE_64BIT|15:12|6|RW|非AMO写指令输出64bit数据位宽时，AWUSR域<br>给出的数据类型，为支持ESL NNC功能所添加<br>0x6: INT64, 0x7: UINT64, 0xE: FP64|
|TYPE_32BIT|11:8|4|RW|非AMO写指令输出32bit数据位宽或无数据位时，<br>AWUSR域给出的数据类型，为支持ESL NNC功能<br>所添加<br>0x4: INT32, 0x5: UINT32, 0xC: FP32, 0xD: TF32|
|TYPE_16BIT|7:4|2|RW|非AMO写指令输出16bit数据位宽时，AWUSR域<br>给出的数据类型，为支持ESL NNC功能所添加<br>0x2: INT16, 0x3: UINT16, 0x9: FP16, 0xA: BF16,<br>0xB: TF16|
|TYPE_8BIT|3:0|0|RW|非AMO写指令输出8bit数据位宽时，AWUSR域给出的数据类型，为支持ESL NNC功能所添加<br>0x0: INT8, 0x1: UINT8, 0x8: FP8|

### 7.100. ESL_ORDER

**Register Name:** `ESL_ORDER`

- **SPR ID:** `161`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ORDER|0:0|0|RW|为支持ESL NNC所添加的SPR寄存器<br>当设置为1时，对于访问EDF总线的L-slot标量ST指令<br>(非TST/C-slot标量指令)，设置AWUSR域中的<br>ESL_ORDER域为1，使得该访问如果目的地是ESL时触<br>发强制保序行为|

### 7.101. DPF_ASID

**Register Name:** `DPF_ASID`

- **SPR ID:** `193`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|DPF_ASID|3:0|0x0|RW|做数据预取时的ASID，用于实现本进程或者跨进程的<br>数据预取<br>在kernel launch的时候被初始化为THREAD_ASID。|

### 7.102. IPF_ADDR

**Register Name:** `IPF_ADDR`

- **SPR ID:** `194`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|ADDR|47:0|0x0|RW|IDMA/ITAGOP指令的IMEM_BASE，用于支持软件指令<br>预取或者Cacheline操作<br>Kernel Launch时被初始化为{IMEM_BASE_HI_WRK,<br>IMEM_BASE_LO_WRK}<br>ISA4.0中扩展为48bit，其中高16bit可以使用<br>IPF_ADDR_HI读取和修改|

### 7.103. IPF_ASID

**Register Name:** `IPF_ASID`

- **SPR ID:** `195`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|IPF_ASID|3:0|0x0|RW|做指令预取/ICache操作时的ASID，用于支持<br>IDMA/ITAGOP指令<br>在kernel launch的时候被初始化为THREAD_ASID。|

### 7.104. IPF_KSID

**Register Name:** `IPF_KSID`

- **SPR ID:** `196`

|Field|Bit|Reset Value|RW|Description|
|---|---|---|---|---|
|IPF_KSID|5:0|0x0|RW|做指令预取/ICache操作时的KSID，用于<br>IDMA/ITAGOP指令的支持<br>在kernel launch的时候被初始化为KSID_WRK。|

## 8. SPR Usage Constraint

由于从SIP3.0到SIP4.0，编程视角由单线程转换为多线程；此外还有一些微架构实现细节上的选择，对于 SPR上的配置存在一些约束。本节将分别说明这些约束，以及对于软件的使用假设。

### 8.1. Illegal Scenario

软件必须保证不出现下列场景。否则SIP出现的情况不可知。

- 使用MOVSR2SPR修改HW_STS

   - 该寄存器在SPR下预期是作为RO使用的。对SPR HW_STS的修改没有任何意义。如果要更新这个寄存器，则通过CSR的HW_STS进行

- 在单VPT的thread_type下（thread_type = 0/1），使用MOVSR2SPR修改VAB_VPT1

   - 在单VPT模式下，VAB_VPT1是根本用不到的。所以不存在任何实际使用场景，要求 thread_type = 0/1情况下对这个寄存器进行修改

- 使用MOVSR2SPR修改TCTL寄存器

**该寄存器目前只读，不能修改**

### 8.2. Update MODE_WRK

MODE_WRK寄存器是一个在线程启动（kernel launch）时，通过CSR配置，并且在线程启动之后，通过MOVSR2SPR来修改的一个特殊SPR寄存器。该寄存器延续自更早的ISA/SPR版本；由于SIP4.0已经变成多线程编程，因此对该寄存器的更新存在如下约束：

- 该寄存器的更新，需要同一个kernel-slot下所有线程同步更新，并且更新为相同数值。
- 该寄存器的更新，需要前后使用L0 fence加以约束。
- 该寄存器的INT_OVCLP域必须保持为0，禁止更新。
  - 这是一个历史遗留问题。ISA2.0/ISA3.2上的MODE_WRK的INT_OVCLP也禁止更新。
- 建议算子不要在软件线程中更新该寄存器，而是总是使用在线程启动时设置的数值。

```cpp
{
    // Code to update MODE_WRK
    sync_barrier_kernel(); // 本次kernel-slot launch的所有sub-thread都需要同步
    l0_fence();            // 更新MODE_WRK前的fence

    int new_mode_wrk_value =
        (bf16_ovclp << 18) | (fp16_ovclp << 16) | (fp_denorm << 8) | fp_round;

    MOVSR2SPR(MODE_WRK, new_mode_wrk_value);
    l0_fence();            // 更新MODE_WRK后的fence
}
```

### 8.3. Update VAB

在SIP4.0中，使用MOVSR2SPR修改VAB时，有严格的使用约束和预期。这和部分微架构的设计方案有关。

#### 8.3.1. Detail of Maskbit and VAB

在ISA4.0定义中，每个软件线程（sub-thread）Context中的VACC0是一个特殊寄存器：它主要用于1D运算指令的maskbit输入。为了加速类似“第一条指令计算maskbit，第二条指令使用VACC0 maskbit作为condition输入”的场景，使得这两个指令可以顺序发射而没有Stall，因此微架构上采用了一个特殊的Cache方案。由于软件线程context中的VACC0并不是物理VACC regfile上的VACC0，而是当前这个软件线程VAB寄存器指向的VACC index，因此这个Cacheline和VAB强相关。

- 在thread-type == 0/1单VPT下，每一个软件线程都有一个独立的Cacheline，大小为一个VACC，用于存储VACC0；在thread-type == 3双VPT情况下，线程有两个Cacheline，分别给VPT0和VPT1。
  - 该Cacheline的虚拟地址恒定为VACC0，物理地址为VAB寄存器指向的VACC regfile index。
- 该Cache为writeback Cache，所有对VACC0的读操作均源于该Cacheline，所有对VACC0的写回都更新到该Cacheline。
- 对于1D指令使用maskbit输入的场景，该Cacheline提供forwarding加速。
- 该Cacheline的invalidate/miss/refill/flush行为和通常的cache模型不同。
  - 该Cacheline不存在invalidate/miss操作。
  - 该Cacheline的flush和refill，由配置VAB操作触发；配置VAB时需要加L0 fence来保证RAW/WAR。

![Maskbit cache line示意图](libra_sip_spr_spec__figure_001.png)

目前，对于Cacheline的flush和refill操作选择如下：

|Operation|Instruction|Comment|
|---|---|---|
|Flush该VPT下的Cacheline|`MOVSR2SPR(VAB_VPT*, 0x1FE0)`|`0x1FE0`为特殊数值，并非一个合法的VACC regfile地址|
|Refill该VPT下的Cacheline|`MOVSR2SPR(VAB_VPT*, new_base)`|`new_base`为合法数值，需要在0~6143之间，并且对齐到32。Cacheline会填充这个`new_base`中指向VACC寄存器的数值|

根据上述原理，可以推导得到：

- 在线程启动时，需要refill一次Cacheline。
  - 无论线程是否依赖之前遗留的VACC0数值，都是有必要的。
- 如果线程计算过程中切换VAB，则必须先做flush，再refill新VAB地址的数据。
- 如果需要跨线程基于VACC进行数据传递，则source线程需要先做flush。

#### 8.3.2. Constraint for SW

根据上一个章节中介绍的原理，结合ISA4.0设计时和软件对齐的架构规则，软件需要满足如下要求：

- 算子开发时，对于使用单VPT模式（thread_type == 0/1）的算子，应该不可见VAB。
- Compiler需要对修改VAB的过程进行封装。封装对应的适用场景如下。

场景一：在每组软件线程发射之后，bootcode必须配置一次VAB。此时配置VAB的封装接口如下：

```cpp
// thread_type == 0/1时调用
void bootup_set_vab_single_vpt(int base0) {
    l0_fence(); // 如果是bootcode中设置并且之前没有访问VACC的指令，可以省略这个L0_fence
    MOVSR2SPR(VAB_VPT0, base0); // base0中为本线程所分配的VACC起始地址
    l0_fence();
}

// thread_type == 3时调用
void bootup_set_vab_dual_vpt(int base0, int base1) {
    l0_fence(); // 如果是bootcode中设置并且之前没有访问VACC的指令，可以省略这个L0_fence
    MOVSR2SPR(VAB_VPT0, base0); // base0中为本线程VPT0所分配的VACC起始地址
    MOVSR2SPR(VAB_VPT1, base1); // base1中为本线程VPT1所分配的VACC起始地址
    l0_fence();
}
```

场景二：在软件线程计算途中，需要修改VAB。

这种场景只预期出现在SIP3.0 Legacy算子向SIP4.0算子迁移中出现。例如使用GEMM计算两个VPT，中间需要做两次VAB_VPT0的切换。

```cpp
// 只修改VPT0时调用，对于thread_type == 0/1/3均可以使用
void update_vab_vpt0(int base0) {
    l0_fence();
    MOVSR2SPR(VAB_VPT0, 0x1FE0); // 强制Cacheline写回
    l0_fence();
    MOVSR2SPR(VAB_VPT0, base0); // base0中为本线程VPT0所分配的VACC起始地址
    l0_fence();
}

// 只修改VPT1时调用，只对thread_type == 3调用
void update_vab_vpt1(int base1) {
    l0_fence();
    MOVSR2SPR(VAB_VPT1, 0x1FE0); // 强制Cacheline写回
    l0_fence();
    MOVSR2SPR(VAB_VPT1, base1); // base1中为本线程VPT1所分配的VACC起始地址
    l0_fence();
}

// 同时修改两个VAB，只对thread_type == 3调用
void update_vab_dual_vpt(int base0, int base1) {
    l0_fence(); // 如果是bootcode中设置并且之前没有访问VACC的指令，可以省略这个L0_fence
    MOVSR2SPR(VAB_VPT0, 0x1FE0); // 强制Cacheline写回
    MOVSR2SPR(VAB_VPT1, 0x1FE0); // 强制Cacheline写回
    l0_fence();
    MOVSR2SPR(VAB_VPT0, base0); // base0中为本线程VPT0所分配的VACC起始地址
    MOVSR2SPR(VAB_VPT1, base1); // base1中为本线程VPT1所分配的VACC起始地址
    l0_fence();
}
```

场景三：如果存在通过VACC寄存器进行跨越线程的数据传递，那么SRC线程在写完数据后，必须执行下面的特殊fence。如果没有跨线程VACC传递则不需要该fence。

```cpp
// 如果fence后本线程不再进行VACC访问则调用本接口，对于thread_type == 0/1可以使用
void special_fence_single_vpt() {
    l0_fence();
    MOVSR2SPR(VAB_VPT0, 0x1FE0); // 强制Cacheline写回
    l0_fence();
}

// 如果fence后本线程不再进行VACC访问则调用本接口，对于thread_type == 3使用
void special_fence_dual_vpt() {
    l0_fence(); // 如果是bootcode中设置并且之前没有访问VACC的指令，可以省略这个L0_fence
    MOVSR2SPR(VAB_VPT0, 0x1FE0); // 强制Cacheline写回
    MOVSR2SPR(VAB_VPT1, 0x1FE0); // 强制Cacheline写回
    l0_fence();
}

// 如果fence后本线程还需要用新VAB计算，则调用本接口，对于thread_type == 0/1可以使用
// 本接口其实和场景二中update_vab_vpt0接口一模一样
void special_fence_with_new_vab_single_vpt(int base0) {
    l0_fence();
    MOVSR2SPR(VAB_VPT0, 0x1FE0); // 强制Cacheline写回
    l0_fence();
    MOVSR2SPR(VAB_VPT0, base0); // base0中为本线程VPT0所分配的VACC起始地址
    l0_fence();
}

// 如果fence后本线程还需要用新VAB计算，则调用本接口，对于thread_type == 0/1可以使用
// 本接口其实和场景二中update_vab_dual_vpt接口一模一样
void special_fence_with_new_vab_dual_vpt(int base0, int base1) {
    l0_fence(); // 如果是bootcode中设置并且之前没有访问VACC的指令，可以省略这个L0_fence
    MOVSR2SPR(VAB_VPT0, 0x1FE0); // 强制Cacheline写回
    MOVSR2SPR(VAB_VPT1, 0x1FE0); // 强制Cacheline写回
    l0_fence();
    MOVSR2SPR(VAB_VPT0, base0); // base0中为本线程VPT0所分配的VACC起始地址
    MOVSR2SPR(VAB_VPT1, base1); // base1中为本线程VPT1所分配的VACC起始地址
    l0_fence();
}
```

### 8.4. HWT_COUNTER

HWT_COUNTER是ISA4.0中新增的SPR寄存器，用于记录指令发射时间，用于性能分析。

该寄存器可读可写。写操作用于清零，读操作则读到一个不停歇的64bit计数器。

建议对该寄存器的访问封装为如下形式：

```cpp
// 清零HWT_COUNTER。建议只由supervisor在启动时调用一次
void clr_hwt_counter() {
    MOVSR2SPR(HWT_COUNTER, 0x0);
}

// 读取HWT_COUNTER。可以被所有线程调用
void hal_clock(int64_t * clock) {
    return MOVS(HWT_COUNTER);
}
```
