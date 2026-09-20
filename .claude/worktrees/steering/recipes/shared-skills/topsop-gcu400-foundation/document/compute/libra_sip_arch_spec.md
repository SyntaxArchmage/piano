> Imported material source: `Doc/Libra SIP Arch SPEC.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `Libra SIP Arch SPEC`.

# Libra SIP Arch SPEC

## 1. Revision History

|Version|Date|Note|
|---|---|---|
|v0.1|July 01,2025|创建文档|

## 2. Preface

### 2.1. Glossary

|Name|Description|Comment|
|---|---|---|
|POR|Plan of Record||
|VPT|Vector pipeline thread|一条向量/矩阵指令，可以操作复数组独立的向量/矩阵寄存<br>器，得到每组运算结果。<br>每一组独立的向量矩阵/寄存器，都归属于同一个VPT<br>向量/矩阵指令在操作时，每个VPT上的寄存器编号是相同的<br>Note：请注意，ISA3.2中的thread指代的是VPT，而非下面<br>词条中的软件线程或者硬件线程|
|VPT_NUM|Vector pipeline thread number|在ISA3.2和ISA4.0中，VPT_NUM最大为2|
|ISA2.0|Crystal Instruction 3.0|第二代SIP所使用的指令集<br>请注意对应的Crystal Instruction3.0，这里不是笔误|
|ISA2.1|Crystal Instruction 3.1|二代半SIP所使用的指令集<br>请注意对应的Crystal Instruction3.1，这里不是笔误|
|ISA3.2|Crystal Instruction 3.2|第三代SIP所使用的指令集|
|ISA4.0|Crystal Instruction 4.0|第四代SIP所使用的指令集。即本文档介绍的指令集|
|HW-thread|hardware thread, A.K.A hardware<br>context|即硬件线程。每个硬件线程上有独立的取指和访存单元，可<br>以执行一个或者多个软件线程<br>为了和Arch Spec统一，本文档使用HW-thread的专用英文缩<br>写|
|Sub-thread|sub-thread, A.K.A software context|中文表述为软件线程。在SIP4.0中，每个sub-thread有一个<br>PC和独立的上下文(SR/SPR/TAR)<br>为了和Arch Spec统一，本文档使用Sub-thread的专用英文缩<br>写<br>请注意，sub-thread和软件架构中的Thread不是一回事情|
|Sub-thread-<br>Slot|The static pipeline resource for one<br>sub-thread in SIP4.0|这里强调硬件上留给一个sub-thread的资源，不单单是架构<br>寄存器，也包括ALU分配，slot-index等等|
|Kernel|The basic task launch unit in 4.0P|在SIP上，启动一个独立的任务称之为一个Kernel。一个<br>Kernel下可以包含1~9个sub-thread<br>请注意，一个SIP Kernel可以对应软件架构上的一个thread，<br>或者一个block|
|Kernel-slot|The static pipeline resource for one<br>kernel in SIP4.0||
|Computer<br>thread|软件计算线程|在SIP3.0中，一个软件计算线程有独立的硬件线程，并且该硬<br>件线程上只能启动一个软件计算线程<br>在SIP4.0中，软件计算线程和Supervisor共享同一个硬件线程|
|Supervisor<br>thread|软件控制线程|在SIP3.0中，一个Supervisor有独立的硬件线程，并且该硬件<br>线程上只能启动一个Supervisor<br>在SIP4.0中，软件计算线程和Supervisor共享同一个硬件线程<br>请注意，由于FCR，Supervisor被放弃|
|PBMMU|Page Based Memory Management<br>Unit|基于页表的内存管理单元，管理UVA空间的虚拟地址(VA)到软<br>件物理地址(IPA)的转换<br>在Libra上该单元在SIP之外，SIP对于EDF的访存均是出了SIP<br>边界之后，在通过该单元时进行地址转换|
|RBMMU|Region Based Memory Management<br>Unit|基于段式的内存管理单元。用于管理0~8GB中虚拟地址的映<br>射<br>这里的RBMMU指内置在SIP内的单元，部分单元是软件线程<br>独立的<br>其映射的物理地址可以是SIP内部的L1存储，也可以是UVA空<br>间上的虚拟地址|

### 2.2. Reference Link

1. Crystal Instruction 4.0

2. ISA 4.0 Spec

3. Libra SIP SPR Spec

4. Libra SIP CSR Spec

5. ISA3.2 Spec

6. DSM Spec

7. Libra SIP Programming Guideline

8. SIP4.0_Thread_Launch

## 3. Open & Drop Item

### 3.1. Open Feature

### 3.2. Drop Feature

异步中断INTR

EXCP_ADDR_UNALIGN

- 对sdmem等空间的访问，对齐要求发生变化

EXCP_MIX_ATTR

Address Watchpoint

EXCP_ADDR_INVALID规则被简化

ISA4.0指令支持发生变化

简化双VPT线程工作状态。它工作时对于SIP是独占的

放弃TRAP1/EXCP_REAL_SIZE/EXCP_VL

舍弃SIP_MEM_INFO0和SIP_MEM_INFO1两个寄存器

舍弃RAS_REPAIRED*系列Error Interrupt

舍弃ICache的DF2 master接口的ECC 1bit修正上报功能

该接口的单bit ECC错误修正依然存在，但是在RAS_REPAIRED_STS寄存器中不再记录这个信息

### 3.3. P2 Feature

下来功能为P2 Feature，即RTL实现但是不在Sign-off前验证

DSM/CDF NODE借用SIP SA进行错误中断上报

- L2M借用SIP SA进行错误中断上报

## 4. Overview

### 4.1. Feature List

#### 4.1.1. SIP4.0

SIP4.0是燧原科技公司开发的第四代面向云端AI处理和通用计算的处理器核心。其设计目标主要面向云端AI大模型pre-training过程，同时可以支持通用高性能计算领域。SIP4.0支持下面的功能需求：

ISA4.0指令集需求

兼容ISA3.2指令集

基于KRTAPI方式，对SIP3.0进行兼容。详见ISA 4.0 Spec中的Compatibility章节

支持64bit寻址

ISA4.0指令集的SR和TAR寄存器扩展为64bit

ISA4.0指令集支持64bit地址寻址

向量访问时，支持64bit标量+64bit offset的scatter-gather方式寻址

- 同时也支持64bit标量+32bit offset的scatter-gather方式寻址

支持64bit标量运算

ISA4.0中增加了对INT64/UINT64的标量计算指令，用于支持64bit地址

ISA4.0依然保留了32bit scalar指令，保持原32bit系统的兼容性

- 支持Middle Level指令(MLI)

   - ISA4.0中增加了基于矩阵变量的Middle Level指令，包括2D运算指令指令

基于矩阵的MLD/MST指令被Drop

Middle level指令拥有支持动态性，低指令带宽，较小的流水线调度开销，高branch penalty抵抗能力，容易PPA优化等优点

其中2D Middle Level指令是一个CISC风格指令，两个输入操作数来源于memory

ISA4.0中没有定义1D运算的MLI指令

- ISA4.0支持动态性和AOT算子

ISA4.0对于矩阵变量的MLI指令支持基于real size的动态形状

ISA4.0对于向量的load/store/运算指令支持基于VL的动态形状

ISA4.0增加了对于动态形状计算加速的指令

- ISA4.0支持多线程编程，以多线程形式支持动态形状

ISA4.0新编程模式解除了双VPT，降低对动态形状支持的复杂度

ISA4.0去除了之前的predicate寄存器，通过动态性来进行弥补

支持软件多线程编程

这里多线程编程指在一个SIP的Kernel-slot上启动多个sub-thread ISA4.0中主要编程方式为单VPT，便于支持多线程编程

保留了VAB，用于多线程间对于VACC寄存器的划分

指令集算力规格上升

ISA4.0 MLI指令使得算力和指令集语义解绑，可以支持更高算力

支持TOP-K排序加速

在ISA4.0中依然可以用类似ISA3.2的方式对top-K排序进行加速

新增加了基于MIOTA或者基于Mradi系列指令，支持单bit/多bit的基数排序算法

**支持原子指令**

ISA4.0支持标量atomic指令/标量atomic reduce指令/向量atomic reduce指令

其中向量atomic reduce指令支持linear地址模式，用于SIP间tensor的规约操作，不能支持排序加速

- 支持1D permute/shuffle指令

ISA4.0增加了VACC的mofsft类指令

**TAR去除分组约束**

下述指令去除了TAR分组，可以选择32个TAR中任意一个作为base和offset

TARADD/TVLDOA/TVLDOA.reg/TVSTOA/TVSTOA.reg

**支持对BLAS计算加速**

**增加了MOP.MUL_SCL指令，支持scalar变量乘以vector变量**

**增强scalar指令的完备性**

ISA4.0增加了scalar长跳转指令，PC relative跳转指令和PC relative到绝对地址的转换指令

ISA4.0依然支持VACC特定index元素复制到SR寄存器的指令语义

**增加对pipeline cycle数精确统计能力**

在SPR中增加了一个所有sub-thread共用的64bit计数器，支持精确统计指令发射时的数值

**降低向量linear load/store的对齐要求**

新定义的vector linear load/store指令和基于矩阵变量的MLI_MLD/MLI_MST系列指令，地址对齐要求降低到了 element bitwidth对齐

**计算系统需求**

**支持FP8数据格式**

Libra SIP支持FP8 E4M3/E5M2格式的2D运算，包括非结构化稀疏运算和结构化稀疏运算

Libra SIP支持FP32/FP16到FP8的CVT运算，以及FP8的MOP.FCLASS指令

为了提升FP8的整体运算效率，增加了MOP.MUL_SCL/MREDMAX/MLI_MST.cvt2FP8等指令

**提升1D Element-wise计算效率**

支持硬件优化VACC的bank conflict，减少bank conflict 引发的pipeline stall

**提升L0的性能**

增加VACC的bank数量，提高VACC整体读写带宽

提高MEM->SMR的带宽，SMR加载可以使用全部的load带宽

**提升SFU规格**

基于VACC的MSF指令可以和1D指令并行执行

VALU的SFU会被删除

**增强RNG性能**

增加了回写到VACC的RNG指令

单VPT下，RNG性能提升到2VACC/cycle

增加了RNG中间状态读出能力，使得RNG序列可以从中间位置恢复产生 VALU中的RNG单元会被删除

**支持2D/1D并行**

Libra SIP中，2D指令可以和1D指令在流水线上并行执行

其中，SFU指令被视为2D指令，RNG指令被视为1D指令

**加速Transfomer Engine**

增加了MOP.ABSMAX/MOP.ABSMAXNUM/MREDMAX指令，加速FP32结果的最大值统计

增加了MOP.MUL_SCL指令，支持标量寄存器的参数与向量进行乘法，为下一步FP32->FP8做准备流水线系统需求

**支持多线程编程**

Libra SIP的流水线包含单VPT结构，最多支持10个sub-thread并发（均为单VPT模式）

其中10个sub-thread最多只能属于2个不同的进程，其中之一为supervisor，另一个为计算进程同一个SIP上同一计算进程的sub-thread往往为同构多线程

LIbra SIP支持快速发射参数相近的一组sub-thread

   - 可以通过参数整体复制/增量修改的方法快速一组待发射的sub-thread队列

- Libra SIP支持多sub-thread间的资源划分

   - 各个sub-thread拥有独立的SR/SCC/TAR/SPR寄存器

   - 各个sub-thread通过VAB分配4K个VACC寄存器。可以根据发射参数硬件分配VACC寄存器

   - L0P5 Cache支持在多个sub-thread之间的复用GEMM计算的左支/右支数据

   - 支持通过RBMMU对L1 SDMEM和VDMEM的映射。其中VDMEM可以变为cluster内DSM形式的共享

      - 包括无亲和DSM区域和有亲和DSM区域

可以由supervisor进行的sub-thread管理

- 管理计算sub-thread的部分资源分配/启动和消亡

superviosr提供sub-thread间互相操作的API

**多线程调度**

支持per-sub-thread调度指令

支持动态性

**参加上文指令集需求中的动态性支持**

**支持Middle Level指令**

参加上文指令集需求中的MLI指令支持

部分L0寄存器支持超大的load latency

VACC在多sub-thread情况下，依然拥有支持超大latency的能力

单独的Instruction Cache

在流水线内部，存在L0指令cache，可以在sub-thread之间共享指令

**增加异常复位状态保存功能**

增加硬件capture功能，用于异常调试存储系统需求

**支持64bit寻址**

SIP的memory system支持64bit虚拟地址的寻址

有效访问的地址空间为48bit

部分虚拟地址通过RBMMU映射到本地SDMEM，或者本地/cluster内共享的VDMEM上指令区域和Stack remote会通过RBMMU映射到UVA地址空间

SIP的memory system支持64bit地址指针高位的hint属性

**SDMEM虚拟化**

SIP支持使用CSR寄存器配置对SDMEM虚拟化为paramter buffer和Stack local空间该虚拟化支持不同进程的sub-thread看到不同的parameter和stack空间

对于较大的stack需求，支持用CSR寄存器将超出stack local部分映射到UVA地址空间

对Vector Linear访问Stack的加速

通过Stack local，减少vector liner指令对于stack访问的latency

**支持原子指令和原子操作**

Libra SIP的meory system支持接收来自指令流水线的atomic操作和atomic reduce操作，并转发到UVA空间上 Libra SIP的L1存储（包括SDMEM和VDMEM）均不支持atomic操作

支持DSM和2个AXI对外访问接口

**L1存储空间**

VDMEM：896KB

SDMEM：128KB

SIP TOP需求

**DSM架构需求**

SIP4.0支持2个对外的master和2个对外的slave，用于访问DSM或者被SIC内其他SIP访问

SIP4.0支持2个对外的master和2个对外的slave，用于MDF访问或者被MDF master访问

SIP4.0的parameter buffer可以被MDF master直接访问

- SIP4.0内部支持RBMMU（CSR配置），使得SDMEM能够虚拟化

SIP4.0在支持harvest时，不会harvest该SIP对应的VDMEM和DSM网络，依然完整支持DSM

- SIP4.0支持一个独立的ICache接口，使得ICache可以直接访问MDF

- PMU更新

SIP中的PMU逻辑会根据SIP的形态进行调整

Periheral模块更新

SIP4.0中将移除SDTE模块

SIP4.0中不再例化两个SA，而是一个SA加上另一个SA的EDF功能单元。两者共享一个寄存器区域

- SIP4.0中移除了VDCI模块，不再需要支持跨电压域设计

SIP4.0中的mailbox数量将增加

其他SoC Feature需求

#### 4.1.2. SIP Lite

由于面积和DSM的需要，SIP4.0还有一个特殊的SIP Lite的版本。SIP Lite是在SIP4.0基础上进行裁剪，去除了所有流水线和ALU单元，只留下作为DSM Slave和HW Sync功能，以及用于支持这两个功能的完整CF slave通路和局部ELGC功能。

- SIP Lite不支持任何指令执行和运算

SIP Lite的VDMEM依然保存，用于Shared Affinity Data Buffer Remote部分和Shared Non-Affinity Data Buffer

SIP Lite的HW-Sync可以作为L2 HW Sync（SIC-level HW Sync）使用

### 4.2. 总体结构图

**下面是SIP4.0的总体结构图**

![图 001](libra_sip_arch_spec__figure_001.png)

**上图是SIP4.0的逻辑结构图。其中包含8组AXI接口：**

- ecf_m/ecf_s分别为SIP访问ECF的master接口和被ECF访问SIP内部寄存器的slave接口

- sip_axim0/sip_axim1为两组访问DSM和EDF的master接口

- sip_axis0/sip_axis1为两组被dsm和mdf master访问的slave接口

- sip_axis2为被mdf访问SLSB的slave接口

- sip_axim2为ICache进行取指的master接口

下面是SIP Lite的总体结构图。其中灰色部分是SIP Lite相对于SIP4.0裁剪的部分，着色部分则是SIP Lite保留的部分

![图 002](libra_sip_arch_spec__figure_002.png)

**SIP Lite可以使用的4组AXI接口包括：**

- ecf_m/ecf_s分别为SIP Lite HW Sync访问ECF的master接口和被ECF访问SIP Lite HW Sync/L1配置寄存器的slave接口。
- sip_axis0/sip_axis1为两组被dsm和mdf master访问的slave接口。

### 4.3. SIP算力配置

下面是单个SIP4.0的算力配置和资源，以及一个sub-thread所能占有的资源

对于FP32/FP16/BF16/(U)INT8格式，支持1D MAC指令，算力归属于Element-wise的算力

|Features|HW thread|Scorpio兼容sub-<br>thread(2VPT)|新sub-thread|
|---|---|---|---|
|FP32 2D MAC / HW thread|1024|1024|1024|
|EF32-1 2D MAC / HW thread|N/A|N/A|N/A|
|EF32-2 2D MAC / HW thread|4096|4096|4096|
|FP16 2D MAC / HW thread|4096|4096|4096|
|BF16 2D MAC / HW thread|4096|4096|4096|
|INT8 2D MAC / HW thread|8192|8192|8192|
|FP8 2D MAC / HW thread|8192|8192|8192|
|FP64 1D Element-Wise / HW thread|N/A|N/A|N/A|
|FP32 1D Element-Wise / HW thread|128|128|128|
|FP16/BF16 1D Element-Wise / HW thread|256|256|256|
|FP8 1D Element-Wise / HW thread<br>(FCLASS)|256|256|256|
|FP8 1D Element-Wise / HW thread<br>(CVT)|按照输入格式计算|按照输入格式计算|按照输入格式<br>计算|
|||||
|INT64 1D Element-Wise / HW thread|64|64|64|
|INT32 1D Element-Wise / HW thread|64|64|64|
|INT32 1D Element-Wise / HW thread<br>(Other Instruction)|128|128|128|
|INT16 Element-Wise / HW thread|256|256|256|
|INT8 Element-Wise / HW thread<br>(Includ 1D FMA)|512|512|512|
|混精INT32 */+ F32 1D Element-Wise / HW<br>thread|128|128|128|
|混精FP16(BF16) */+ F32 1D Element-Wise / HW<br>thread|128|128|128|
|混精INT8 */+ FP32 1D Element-Wise / HW<br>thread|128|128|128|
|混精INT8 */+ FP16 1D Element-Wise / HW<br>thread|256|256|256|
|混精INT8 + INT8 -> INT32 1D Wise / HW thread|128|128|128|
|混精INT32*INT32->INT64 1D Element-Wise /<br>HW thread|64|64|64|
|||||
|非混精FP32*F32+F32->F32 1D FMA / HW<br>thread|128|128|128|
|混精FP16(BF16) * FP16(BF16) + FP32 -> FP32 1D<br>FMA / HW thread|128|128|128|
|混精FP16(BF16) * F32 + FP32 -> FP32 1D FMA /<br>HW thread|128|128|128|
|混精INT8 * INT8 + INT32 -> INT32 1D FMA /<br>HW thread|128|128|128|
|混精INT8 * FP32 + FP32 -> FP32 1D MAC / HW<br>thread|128|128|128|
|混精INT8 * FP16(BF16) + FP16(BF16) -><br>FP16(BF16) 1D MAC / HW thread|256|256|256|
|||||
|FP32 SFU / HW thread|32|32|32|
|FP16/BF16 SFU / HW thread|N/A|N/A|N/A|
|INT SFU/SIP|N/A|N/A|N/A|
|L0 VA Register File Size / HW thread|6144 x 512bit|最大3072 x 512bit x<br>2VPT|最大6144 x<br>512bit|
|IV & VR Register File Size / HW thread|N/A|N/A|N/A|
|SMR Register File Size / HW thread|N/A|N/A|N/A|
|TAR Register File Size / HW thread|32 x 64bit x 16 SW-<br>thread|32 x 64bit x 2VPT|32 x 64bit|
|Scalar Registers / HW thread|32 x 64bit x 16 SW-<br>thread|32 x 64bit|32 x 64bit|
|SW Context Number|16 SW thread|N/A|N/A|
|L1->IMEM|128B/cycle|128B/cycle|128B/cycle|
|IMEM->IFID|64B/cycle|64B/cycle|64B/cycle|

### 4.4. SIP L1存储和访存能力

对于所有的SW thread而言，L1 Data MEM的带宽和容量是共享的。下面是L1 Data MEM的参数

|Features|SIP4.0|
|---|---|
|L1 Memory Size / SIP|896KB (VDMEM) + 128KB (SDMEM)|
|Private buffer <-> L0 bandwidth (linear)|for 1D: ~256Byte/cycle read + ~256Byte/cycle write<br>for 2D: ~512Byte/cycle read|
|Affinity shared buffer <-> L0 bandwidth<br>(linear)|Local区间：~256Byte/cycle read + ~256Byte/cycle write<br>当一个Cluster中所有SIP发出类似的affinity-remote访问时，每个SIP<br>带宽如下<br>Remote区间：~190B/cycle(dsm_clk/sip_clk = 1)<br>Remote区间：~210B/cycle(dsm_clk/sip_clk = 1.5)|
|Non-affinity shared buffer <-> L0 bandwidth<br>(linear)|当一个Cluster中所有SIP发出类似的non-affinity访问时，每个SIP带宽<br>如下<br>dsm_clk/sip_clk = 1时：约190B/cycle<br>dsm_clk/sip_clk = 1.5时：约210B/cycle|
|SIP <-> LLC/L3 Bandwidth (linear)|~256Byte/cycle, read or write (SIP端带宽，不考虑cluster限制)|

**SIP的memory访问系统，其outstanding能力被所有线程共享。能力如下：**

对于matrix/vector类的load/store指令而言，SIP最大可以发出256个read outstanding和write outstanding

   - SIP的两个DF master接口来发出指令访存，DF0和DF1

   - 两个DF master接口各自最大的write outsanding均为128

   - 两个DF master接口各自最大的read outsanding均为128

   - 每个outstanding数据量最大为128B

   - read和write outstanding各自独立，并不重合

- 对于MLI_GEMM系列指令而言，SIP最大可以发出512个read outstanding

   - SIP的两个DF master接口来发出指令访存，DF0和DF1，各自为GEMM指令最大可以发出256个read outstanding。每个outstanding数据量最大为128B

这个部分的read outstanding和访存指令的outstanding各自独立，互不相干

SIP作为DSM slave时，支持的outstanding数量可以覆盖流水线的latency，确保外部访问不断流

## 5. Interface SPEC

### 5.1. System Interconnection Interface

SIP的3个EDF master接口配置如下

```verilog
parameter EDF_MST_ID_WIDTH      = 11;
parameter EDF_MST_ADDR_WIDTH    = 48;
parameter EDF_MST_DATA_WIDTH    = 1024;
parameter EDF_MST_AR_USER_WIDTH = 36;
parameter EDF_MST_R_USER_WIDTH  = 16;
parameter EDF_MST_AW_USER_WIDTH = 48;
parameter EDF_MST_WSTRB_WIDTH   = 128;
parameter EDF_MST_W_USER_WIDTH  = 12;
parameter EDF_MST_B_USER_WIDTH  = 73;
```

**SIP的3个EDF slave接口配置如下**

```verilog
parameter EDF_SLV_ID_WIDTH = 16;
```

   - 其中11bit为正常AXID，额外5bit为NOC router使用信息

```verilog
parameter EDF_SLV_ADDR_WIDTH = 48;
parameter EDF_SLV_DATA_WIDTH = 1024;
parameter EDF_SLV_AR_USER_WIDTH = 36;
parameter EDF_SLV_R_USER_WIDTH = 20;
```

其中高4bit为DSM网络使用的QOS，低16bit为read response信息和校验位。

```verilog
parameter EDF_SLV_AW_USER_WIDTH = 48;
parameter EDF_SLV_WSTRB_WIDTH = 128;
parameter EDF_SLV_W_USER_WIDTH = 12;
parameter EDF_SLV_B_USER_WIDTH = 77;
```

   - 新增最高4bit为DSM网络使用的QOS

   - 中间[72:4]为atomic指令返回数值使用bit

   - 低4bit为write response信息

**SIP的1个ECF master接口配置如下**

```verilog
parameter ECF_MST_ID_WIDTH = 8;
parameter ECF_MST_ADDR_WIDTH = 30;
parameter ECF_MST_DATA_WIDTH = 32;
parameter ECF_MST_AR_USER_WIDTH = 20;
parameter ECF_MST_R_USER_WIDTH = 8;
parameter ECF_MST_AW_USER_WIDTH = 20;
parameter ECF_MST_WSTRB_WIDTH = 4;
parameter ECF_MST_W_USER_WIDTH = 4;
parameter ECF_MST_B_USER_WIDTH = 4;
```

**SIP的1个ECF slave接口配置如下**

```verilog
parameter ECF_SLV_ID_WIDTH = 12;
```

其中8bit为正常AXID，额外4bit为NOC router使用信息。

```verilog
parameter ECF_SLV_ADDR_WIDTH = 30;
parameter ECF_SLV_DATA_WIDTH = 32;
parameter ECF_SLV_AR_USER_WIDTH = 20;
parameter ECF_SLV_R_USER_WIDTH = 8;
parameter ECF_SLV_AW_USER_WIDTH = 20;
parameter ECF_SLV_WSTRB_WIDTH = 4;
parameter ECF_SLV_W_USER_WIDTH = 4;
parameter ECF_SLV_B_USER_WIDTH = 4;
```

### 5.2. External IO Interface

Scorpio SIP没有external IO。

### 5.3. MISC Interface

#### 5.3.1. Clock & Reset

|分类|信号名|方向|位宽|comment|
|---|---|---|---|---|
|时钟复位|*||||
||i_sip_clk|I|1||
||i_ssm_clk|I|1||
||i_dsm_clk|I|1||
||i_ccf_clk|I|1||
||i_REG_IP_CLK_EN|I|1||
||i_cf_clk_en|I|1||
||i_df_clk_en|I|1||
||i_REG_SIP_RST_N|I|1||
||i_sip_rst_n|I|1||
||i_sip_cold_rst_n|I|1||
||i_sku_type|I|1||
||i_sic_x_harvest_info|I|1||
||ccf_clk_cdf|O|1||
||ccf_clk_dsm|O|1||
||dsm_clk_cdf|O|1||
||dsm_clk_dsm|O|1||
||o_cf_ccf_clk|O|1||
||o_df_dsm_clk|O|1||
||rst_n_ccf|O|1||
||rst_n_dsm|O|1||

#### 5.3.2. PMU Interface

|分类|信号名|方向|位宽|comment|
|---|---|---|---|---|
|PMU:|sip_pmu_*|||SIP PMU和L2M之间接口，用于交互power相关信息，<br>sideband信号，MCP(muti-cycle-path)，<br>单个SIP与L2M的之间的连接独立。<br>总位宽不超过30bit|
||sip_pmu_o_vdrop_l2h_risk|O|1|to adjacent sips' pmu|
||sip_pmu_o_vdrop_h2l_risk|O|1|to adjacent sips' pmu|
||sip_pmu_o_req|O|1|to the sic's l2m|
||sip_pmu_o_req_type|O|1|to the sic's l2m|
||sip_pmu_i_vdrop_l2h_risk_0|I|1|from adjacent sips' pmu|
||sip_pmu_i_vdrop_h2l_risk_0|I|1|from adjacent sips' pmu|
||sip_pmu_i_vdrop_l2h_risk_1|I|1|from adjacent sips' pmu|
||sip_pmu_i_vdrop_h2l_risk_1|I|1|from adjacent sips' pmu|
||sip_pmu_i_vdrop_l2h_risk_2|I|1|from adjacent sips' pmu|
||sip_pmu_i_vdrop_h2l_risk_2|I|1|from adjacent sips' pmu|
||sip_pmu_i_vdrop_l2h_risk_3|I|1|from adjacent sips' pmu|
||sip_pmu_i_vdrop_l2h_risk_3|I|1|from adjacent sips' pmu|
||sip_pmu_i_vdrop_l2h_risk_4|I|1|from adjacent sips' pmu|
||sip_pmu_i_vdrop_h2l_risk_4|I|1|from adjacent sips' pmu|
||sip_pmu_i_vdrop_l2h_risk_5|I|1|from adjacent sips' pmu|
||sip_pmu_i_vdrop_h2l_risk_5|I|1|from adjacent sips' pmu|
||sip_pmu_i_vdrop_l2h_risk_6|I|1|from adjacent sips' pmu|
||sip_pmu_i_vdrop_h2l_risk_6|I|1|from adjacent sips' pmu|
||sip_pmu_i_ack_packet|I|1|from the sic's l2m|
||sip_pmu_i_ack|I|1|from the sic's l2m|

#### 5.3.3. L2M Interface

|分类|信号名|方<br>向|位<br>宽|comment|
|---|---|---|---|---|
|L2M:|l2m_*|||l2m与ssm的交互信息<br>l2m与pmu的交互信息|
||l2m_ssm_req|O|1|to SSM<br>signal to start req|
||l2m_ssm_req_type|O|1|to SSM<br>signal to represent borrow or return 1: borrow credit 0: return<br>credit|
||l2m_ssm_req_packet|O|4|to SSM<br>how many power credit is been borrowed or returned between<br>L2M and SSM CPMU|
||ssm_l2m_ack|I|1|from SSM<br>signal to start ack|
||ssm_l2m_ack_packet|I|4|from SSM<br>how many power credit have been borrowed successfully from SSM<br>CPMU to L2M|
||sip0_l2m_req|I|1|from sip0<br>signal to start req|
||sip1_l2m_req|I|1|from sip1<br>signal to start req|
||sip2_l2m_req|I|1|from sip2<br>signal to start req|
||sip3_l2m_req|I|1|from sip3<br>signal to start req|
||sip4_l2m_req|I|1|from sip4<br>signal to start req|
||sip5_l2m_req|I|1|from sip5<br>signal to start req|
||sip6_l2m_req|I|1|from sip6<br>signal to start req|
||sip7_l2m_req|I|1|from sip7<br>signal to start req|
||sip0_l2m_req_type|I|1|from sip0<br>signal to represent borrow or return<br>1: borrow credit 0: return credit|
||sip1_l2m_req_type|I|1|from sip1<br>signal to represent borrow or return<br>1: borrow credit 0: return credit|
||sip2_l2m_req_type|I|1|from sip2<br>signal to represent borrow or return<br>1: borrow credit 0: return credit|
||sip3_l2m_req_type|I|1|from sip3<br>signal to represent borrow or return<br>1: borrow credit 0: return credit|
||sip4_l2m_req_type|I|1|from sip4<br>signal to represent borrow or return<br>1: borrow credit 0: return credit|
||sip5_l2m_req_type|I|1|from sip5<br>signal to represent borrow or return<br>1: borrow credit 0: return credit|
||sip6_l2m_req_type|I|1|from sip6<br>signal to represent borrow or return<br>1: borrow credit 0: return credit|
||sip7_l2m_req_type|I|1|from sip7<br>signal to represent borrow or return<br>1: borrow credit 0: return credit|
||l2m_sip0_ack|O|1|to sip0<br>signal to start ack|
||l2m_sip1_ack|O|1|to sip1<br>signal to start ack|
||l2m_sip2_ack|O|1|to sip2<br>signal to start ack|
||l2m_sip3_ack|O|1|to sip3<br>signal to start ack|
||l2m_sip4_ack|O|1|to sip4<br>signal to start ack|
||l2m_sip5_ack|O|1|to sip5<br>signal to start ack|
||l2m_sip6_ack|O|1|to sip6<br>signal to start ack|
||l2m_sip7_ack|O|1|to sip7<br>signal to start ack|
||l2m_sip0_ack_packet|O|1|to sip0<br>the number of borrowed credit.<br>1: borrow one credit to PMU successfully; 0: borrow fail;<br>will be ignored in if current request is a return request|
||l2m_sip1_ack_packet|O|1|to sip1<br>the number of borrowed credit.<br>1: borrow one credit to PMU successfully; 0: borrow fail;<br>will be ignored in if current request is a return request|
||l2m_sip2_ack_packet|O|1|to sip2<br>the number of borrowed credit.<br>1: borrow one credit to PMU successfully; 0: borrow fail;<br>will be ignored in if current request is a return request|
||l2m_sip3_ack_packet|O|1|to sip3<br>the number of borrowed credit.<br>1: borrow one credit to PMU successfully; 0: borrow fail;<br>will be ignored in if current request is a return request|
||l2m_sip4_ack_packet|O|1|to sip4<br>the number of borrowed credit.<br>1: borrow one credit to PMU successfully; 0: borrow fail;<br>will be ignored in if current request is a return request|
||l2m_sip5_ack_packet|O|1|to sip5<br>the number of borrowed credit.<br>1: borrow one credit to PMU successfully; 0: borrow fail;<br>will be ignored in if current request is a return request|
||l2m_sip6_ack_packet|O|1|to sip6<br>the number of borrowed credit.<br>1: borrow one credit to PMU successfully; 0: borrow fail;<br>will be ignored in if current request is a return request|
||l2m_sip7_ack_packet|O|1|to sip7<br>the number of borrowed credit.<br>1: borrow one credit to PMU successfully; 0: borrow fail;<br>will be ignored in if current request is a return request|

|分类|信号名|方向|位宽|comment|
|---|---|---|---|---|
|SystemAdapter:CRG||||时钟和门控信号|
|DFT|ENFL_DFT_FUNC_dfd_obs|O|12||

## 6. SIP Function Description

### 6.1. SIP ISA

Libra SIP采用Crystal Instruction 4.0 (简称ISA4.0)的指令定义和指令集说明。两者的链接分别为Libra ISA指令编码和Libra ISA Spec。

### 6.2. SIP Data Memory Subsystem

#### 6.2.1. Memory Address Mapping

##### 6.2.1.1. 设计背景和需求

SIP4.0的地址mapping在定义上需要满足下列软件/SOC使用用法

1. 支持1GB空间内的兼容地址：

   1. VDMEM， Mirror VDMEM，SDMEM，Instruction VA Space

2. ISA的架构指令空间支持64-bit地址空间，系统实际Device Virtual Address (DVA)支持48-bit地址（256TB）

   1. 48~63-bit的地址bits可以用于SIP的其他属性表达

3. 支持系统关于 DVA需求

   1. 背景可以参见02-Libra UVA地址空间SPEC（UVA区间8GB~4TB） - 冷再鲜_Zaixian - enflame wiki

![图 003](libra_sip_arch_spec__figure_003.png)

4. 支持DVA与IPA映射

   1. 背景可以参见02-Libra UVA地址空间SPEC（UVA区间8GB~4TB） - 冷再鲜_Zaixian - enflame wiki

![图 004](libra_sip_arch_spec__figure_004.png)

2.

5. 支持IPA与PA映射

6. 支持DSM 空间映射

   1. 背景可以参见Libra-DSM-Feature-Spec - 冯闯_Chuang - enflame wiki

   2. 需要支持映射DSM的有亲和空间和无亲和空间

   3. 需要支持DTE和SIP访问DSM直接使用IPA，这样DTE不用经过和SIP一样的region based MMU

   4. DTE访问不同SIC的DSM时，不使用SIC的local view，进而SIP访问DSM时也不使用per-SIC的local view（注意这里不是说 per-SIP），软件层面都是用IPA的指针给SIP和DTE使用。

7. 支持根据ASID (Address Space ID)区分不同进程的地址空间。

   1. 背景可以参见05-Libra UVA地址的ASID与PID - 冷再鲜_Zaixian - enflame wiki

   2. SIP里的软件线程可以属于不同的软件进程，也可属于同一个软件进程

   3. Supervisor也占有一个ASID

   4. 不同的软件进程的地址空间是独立的

   5. SIP里的MMU、Cache 需要使用ASID来区分进程地址空间

   6. 不同进程的MMU translation是独立的

   7. 不同进程不通过SIP内的Cache共享数据

8. 支持映射kernel的parameter数据空间给kernel的所有线程

   1. parameter是一个kernel执行的输入参数，它要能够被SIP、SP、DTE能够访问到。

   2. parameter是被SIP上同一个kernel的所有线程共享的。

   3. Kernel Launch的时候，AMOS 把parameter通过SP传递给SIP 。

   4. 为了性能，parameter一般的存在于SIP的SDMEM上，一般一个kernel需要4KB。

   5. 因为要支持AMOS预加载，所以SIP的SDMEM上要能够存下多份parameter。不考虑parameter SDMEM存不下还要扩展到L3的情况。

   6. Parameter 可以依靠SP的DMA写入，可以靠DTE从外部搬入，也可以靠SIP从外部load进入。如果不能提前被AMOS 发 launch请求给supervisor然后合适的搬入，那parameter 加载过程的是在kernel launch的critical path上，而且它的size 还不大，所以还可能造成DTE效率低下。

9. 支持映射每个线程的stack空间

   1. stack是一个kernel执行的运行暂存数据。

   2. SIP每个软件线程有独立stack空间。

   3. 为了加速，它有一小段空间希望被映射到SDMEM上，其他的部分希望通过地址映射扩展到L3上去。

   4. 一般的，kernel launch的时候stack假设是空的。这不是一个硬要求。软件也可以初始化它。

   5. 支持同一个进程的不同软件线程能够相互访问对方的栈空间，直接通过各自的栈传递变量

   6. 可以允许访问stack时有2种指针：访问本stack的local指针和访问所有stack的generic 指针，而且每个thread自己知道如何简化的在这2种指针之间转换。

10. 支持同一个进程的不同软件线程使用统一的数据地址空间地址对DSM和L3中的数据进行数据共享

   1. 此时要求它们要能够使用统一的地址指针来传递，而不是每个线程有个独特的指针

11. SDMEM能够支持同一个进程或者不同进程的多个Kernel的parameter并存

   1. 如果SDMEM容量足够，Supervisor要能够支持给新的kernel做parameter预取

12. SDMEM能够支持每个软件线程拥有1个独立的stack

   1. 如果SDMEM容量足够，Supervisor要能够支持给新的kernel做stack预初始化。比如先初始化好一块数据，然后把这个区域再映射为下一个kernel的一个线程的stack

**Note：下面为SIP3.0的地址分布，而非SIP4.0的地址分布**

![图 005](libra_sip_arch_spec__figure_005.png)

##### 6.2.1.2. Overview

根据Libra的地址空间定义，对于运行在Libra SIP上的软件线程而言而言，有三重视角的地址，分别为：

- DVA(Device Virtual Address)：软件线程视角的SIP虚拟地址

- IPA(Intermedia Physical Address)：软件视角下的物理地址

   - 请注意软件视角下的物理地址和实际SoC中的memory单元的物理地址存在差异

- PA(Physical Address)：实际SoC上物理存储单元的地址

   - 有一部分IPA通过XMC模块，会将连续的IPA地址空间映射到离散分布的存储空间，来获得存储的无亲和性。比如L3地址空间和DSM无亲和地址空间

**本文的主要集中在SIP上的DVA和IPA的地址关系。关于IPA和PA的转换，请参看请见Libra_Address_Map.xlsx**

Libra SIP中，每个SIP上可以运行多个软件线程。这里有如下假定：

- SIP上，所有动态的软件线程总是属于两个进程

   - 一个是用于launch管理等功能的supervisor进程

   - 剩下的SIP软件线程都会属于同一个计算进程

   - 请注意目前硬件上并没有约束只能启动一个计算进程，但是硬件资源上难以满足两个计算进程的需求

- 同属于一个进程的软件线程之间，地址空间相同

- Supervisor和计算功能的软件线程可以通过一些特定的方式对parameter数据进行交换。

- 是否允许SIP跨越SIC访问DSM？

   - 在物理上，4个SIC之间如何保证互访的问题非常复杂。因此SIP4.0中不允许SIP跨越SIC访问DSM，只能访问本地的 DSM。

允许SP和DTE访问local die和peer die上的所有DSM

Libra SIP支持48bit的地址空间和64bit的地址指针。从整个Libra SoC的视角，每个IP（包括SIP/SP/AP/etc.）对于整个48bit的规划是类似的。其中0~8GB用于每个IP本地的地址空间规划，可以各不相同；而8GB~256T的空间则是全局视角的地址映射。

SIP的0~8GB包含了自身的指令空间，私有以及cluster内share的L1数据存储空间，以及IO空间，采用固定映射和RBMMU映射的方式

SIP的8GB~256TB是全局统一的地址映射，采用PBMMU映射和固定映射的方式。

而在单个SIP的物理视角上，每一个SIP有一个896KB的VDMEM和一个128KB的SDMEM。这两个物理存储单元会通过 RBMMU(Region Based MMU)的方式多次映射到不同的地址空间段中。

VDMEM映射的空间，包括Private VDMEM/Private VDMEM mirror/Shared Affinity Buffer/Shared Non-Affinity buffer，可以被所有LDST指令访问，包括

标量LD/ST，除了专门访问IO标量指令，均可访问

- 标量Atomic指令不可访问

- 向量linear addr LD/ST可访问

- 向量stride offset LD/ST可访问

- 向量scatter-gather LD/ST可访问

这里包括MLI的向量scatter-gather指令

向量Atomic指令不可访问

MLI_MLD/MLI_MST/MLI_TMLD/MLI_TMST指令可访问

GEMM/GEMM_SPS/GEMM_LVA/GEMM_RVA指令可访问

SDMEM映射的空间，包括Private SDMEM/Parameter Buffer/Stack Local，其所访问的LD/ST指令有限制，包括

- 标量LD/ST，除了专门访问IO标量指令，均可访问

- 标量的Atomic指令不可访问

- 向量linear addr LD/ST可访问

- 向量stride offset LD/ST不可访问

向量scatter-gather LD/ST不可访问

这里包括MLI的向量scatter-gather指令

向量Atomic指令不可访问

MLI_MLD/MLI_MST/MLI_TMLD/MLI_TMST指令不可访问

GEMM/GEMM_SPS/GEMM_LVA/GEMM_RVA指令不可访问

**除此以外，对于EDF空间的memory，访问限制如下**

对于映射到Stack Remote空间的UVA地址，等同SDMEM映射空间的访问限制，即

- 标量LD/ST，除了专门访问IO标量指令，均可访问

- 标量的Atomic指令不可访问

- 向量linear addr LD/ST可访问

- 向量stride offset LD/ST不可访问

向量scatter-gather LD/ST不可访问

这里包括MLI的向量scatter-gather指令

**向量Atomic指令不可访问**

MLI_MLD/MLI_MST/MLI_TMLD/MLI_TMST指令不可访问

GEMM/GEMM_SPS/GEMM_LVA/GEMM_RVA指令不可访问

对于映射到Global Space I/Global Space II地址空间的存储限制如下

- 标量LD/ST，除了专门访问IO标量指令，均可访问

- 标量Atomic指令可访问

- 向量linear addr LD/ST可访问

向量stride offset LD/ST可访问

- 向量scatter-gather LD/ST可访问

这里包括MLI的向量scatter-gather指令

向量Atomic指令可访问

MLI_MLD/MLI_MST/MLI_TMLD/MLI_TMST指令可访问

GEMM/GEMM_SPS/GEMM_LVA/GEMM_RVA指令可访问

##### 6.2.1.3. SIP Address Space

**下面是单个软件线程视角的地址空间映射**

![图 006](libra_sip_arch_spec__figure_006.png)

|地址空间|访问范围|大小|映射方法|说明|
|---|---|---|---|---|
|Legacy L1 Private<br>Space|SIP私有，所有软件线程共享|256MB|固定映射|VDMEM + SDMEM|
|Instruction Space|SIP内相同进程的软件线程共享|3.75GB|RBMMU<br>每个软件线程之间独<br>立|PC+ Base -> UVA|
|SCF & ECF Space|SCF为SIP内所有软件线程共享<br>ECF空间是SoC内所有软件线程<br>所共享|1GB|固定映射|IO空间|
|SCF & ECF Space<br>mirror|本空间为SCF & ECF Space的<br>镜像映射|1GB|固定映射|IO空间|
|Parameter &<br>Stack Space|SIP内相同进程的软件线程共享|512MB|RBMMU<br>每个软件线程之间独<br>立|这段空间预期映射到和<br>SDMEM和UVA空间上|
|Shared Data<br>Space|Shared空间为同一Cluster内所<br>有SIP上软件线程共享<br>SIP不能访问其他SIC的Shared<br>Data Space|1GB|固定映射|每个SIP有一组mask寄存器<br>来分割|
|Global Space:<br>UVA Space|SoC内拥有相同ASID的软件线<br>程所共享|4TB-<br>8GB|RBMMU<br>RBMMU在EDF上被<br>多个SIP共享|本空间属于Globa Space的<br>一部分|
|Global Space:<br>XMC IPA hole|SoC内所有SIP软件线程所共享|64TB|固定映射|本空间属于Globa Space的<br>一部分|

##### 6.2.1.4. Private L1 Space

Private L1 Space用于向所有软件线程提供固定的local memory映射。它使用的空间兼容SIP3.0上的L1 Space，保留在0~256MB地址范围内。它细分为三个可以被LD/ST指令访问的区域：

|地址空间|线<br>程<br>共<br>享|大小|地址区域|SIP指令<br>访问类型|SIP访问延<br>迟|最大带宽|映射方<br>式|说明|
|---|---|---|---|---|---|---|---|---|
|Private<br>VDMEM|所<br>有<br>软<br>件<br>线<br>程|最大<br>896KB|0x0 ~<br>0xE_0000-1|所有标量<br>和向量<br>LD/ST指<br>令|Scalar：<br>~30 cycle<br>Linear<br>vector：<br>~30 cycle<br>Others：<br>Long|LD:<br>256B/cycle<br>+<br>ST:<br>256B/cycle|固定映<br>射<br>+mask|和Scorpio<br>SIP的<br>VDMEM类<br>似|
|Private<br>VDMEM<br>mirror|所<br>有<br>软<br>件<br>线<br>程|最大<br>896KB|0x20_0000 ~<br>0x2E_0000-1|所有标量<br>和向量<br>LD/ST指<br>令|Scalar：<br>~30 cycle<br>Linear<br>vector：<br>~30 cycle<br>Others：<br>Long|LD:<br>256B/cycle<br>+<br>ST:<br>256B/cycle|固定映<br>射<br>+mask|和Scorpio<br>SIP的<br>VDMEM<br>mirror类<br>似|
|Private<br>SDMEM|所<br>有<br>软<br>件<br>线<br>程|128KB|0x800_0000 ~<br>0x802_0000-1|所有标量<br>LDST指<br>令<br>Linear<br>Vector<br>LD/ST指<br>令(vm=1)|Scalar：<8<br>cycle<br>Vector：<br>~20 cycle|16B/cycle|固定映<br>射|和Scorpio<br>SIP的<br>SDMEM相<br>同|

Private VDMEM & Private VDMEM mirror

**软件线程访问这两段地址空间，完全访问本地的VDMEM，总是能获得较高的带宽和较小的latency**

最大可以达到896KB

Private VDMEM和Private VDMEM mirror完全指向相同的物理存储单元

它们都是local VDMEM的存储单元

对于Mirror空间的访问完全放弃RAW和WAR的检查以换取更高的带宽

这是由于SIP L1的hazard检查资源无法完全满足某些最大带宽场景导致的

对于非mirror空间，可以通过64bit指针高位的RO hint bit来达到相同的效果

详见RO/WO Hint章节

当本地的VDMEM被划分出SIC亲和共享空间和SIC无亲和共享空间时，Private VDMEM/Private VDMEM mirror和前两个空间同时划分896KB的存储单元

从高地址部分开始划分private。即Mask寄存器会屏蔽private VDMEM的起始部分

例如本次软件划分256KB的private VDMEM，那么它的起始地址实际上是640KB。0~640KB地址访问被视为invalid address

Mirror和非Mirror区被屏蔽的空间总是相同

软件需要根据分配策略，计算当前实际Private VDMEM/Private VDMEM mirror的起始地址

这两个地址空间不会被直接暴露给其他SIP/SP/DTE

Private SDMEM地址空间

- 所有线程均可以通过该地址访问完整的128KB SDMEM

- 可以被用来做supervisor和计算线程之间跨进程的paramter地址访问。即计算线程通过它们的Parameter Space进行读写， 而supervisor通过Private SDMEM进行读写。

这一段的地址空间中，priavte术语描述的是VA视角。从IPA和PA角度来看，它们都是直接映射到local的VDMEM存储单元和 SDMEM存储单元上的。

##### 6.2.1.5. Instruction Space

|地址空间|线程共享|大小|地址区域|SIP指令访<br>问类型|SIP访<br>问延<br>迟|映射方式|说明|
|---|---|---|---|---|---|---|---|
|Instruction<br>Space|同一进程<br>的软件线<br>程共享|3.75GB<br>或者<br>4GB|0x1000_0000 ~<br>0x1_0000_0000-1<br>或者0x0 ~<br>0x1_0000_0000-1|禁止<br>LD/ST指<br>令访问|N/A|通过RBMMU<br>映射到UVA空<br>间<br>每个软件线程<br>RBMMU独立|扩大<br>的指<br>令空<br>间|

在Libra SIP中，PC位宽扩展到32bit，PC可访问空间变为0~4GB。因此0~4GB空间保留给PC空间。每个软件线程发射时的第一个PC 可以通过CSR寄存器配置，并不一定从PC=0的指令开始。

- 从支持Scorpio兼容角度，建议兼容算子在发射时起始PC选择 **不小于** 0x1000_0000（256MB）

- 对于Libra新开发的算子，如果需要通过Legacy SDMEM来和Supervisor进行跨进程通信，建议起始PC同样选择为 0x1000_0000

- 对于Libra新开发的算子，如果不存在LD/ST指令访问Legacy L1 Space的需求（0~256MB），并且软件自己保证程序中不存在这个地址的访问，那么起始PC可以选择为0x0

**这段指令空间是通过如下方式映射到物理地址上的：**

- 每一个软件线程都有独立的PC空间映射用RBMMU，该RBMMU包含ASID

- 该RBMMU通过PC + BASE的方式，将0~4GB映射到UVA空间上

- 当该软件线程发出取指请求时，该PC通过第一个RBMMU后，转换为EDF上的访问请求，在通过EDF上的PBMMU，由UVA地址转换为IPA。最后经过XMC映射到PA上，最终路由到存储单元（通常是L3地址空间）

- 属于同一进程的软件线程之间，应该拥有相同的ASID和inst RBMMU的BASE。它们的发射起始PC可以不同。

- ASID和inst RBMMU的offset都是线程发射参数，由硬件发射时自动完成配置，发射后不可修改

##### 6.2.1.6. SCF & ECF Space

Libra SIP的IO地址空间共有两处映射，每处映射均为1GB，分别为SCF & ECF Space和SCF & ECF Space Mirror。

SCF & ECF Space：地址4GB~5GB

SCF & ECF Space Mirror：地址6GB~7GB

这两个地址的映射，其实是对同一个1GB空间的镜像映射。两者除了基地址偏移不同外，对于各个设备的IO寄存器的偏移是一模一样的。在每一段1GB的空间中，均包括SIP内的SCF空间和整个系统的ECF空间。其中

SCF空间为前32KB

ECF空间从32MB开始到1GB结束

这两个地址空间的VA到IPA映射是固定的，不需要RBMMU。

**这两段地址空间的映射区别在于：**

SCF & ECF Space Mirror只能支持IO写操作，不支持IO读操作

用于和其他SIP/CDTE/HW sync的同步操作

SCF & ECF Space Mirror是为了加速2D计算而设置的，它有如下特性：

- 同一个线程对于SCF & ECF Space Mirror的写操作，一定不会越过之前发送的GEMM系列指令对于memory的读操作。 这一点由硬件自动保证

   - 因此一个线程发射所有GEMM指令后，可以直接发送一个Signal mailbox的IO访问，通知DTE本线程对于2D数据消费完成。从而避免GEMM和signal之间添加memory Fence的操作

同一个线程后继的GEMM指令，可以超越对这个区间的CF写操作

该区间内的CF访问顺序，遵循IO Consistency章节中提到的访问模型

对同一寄存器在这两个地址区域的两个不同映射地址，不保证访问顺序的一致性

关于SCF空间的详细划分，请见Libra SIP CSR Spec

##### 6.2.1.7. Parameter & Stack Space

Libra SIP中的Parameter空间和Stack空间合起来在5GB~5.5GB的区间中，为Libra SIP新定义的空间。其中Parameter buffer和 Stack中的local部分会通过RBMMU映射到本地的SDMEM上。对于这两个部分预期软件线程主要通过scalar LDST指令进行访问，以获得小latency的效果。而Stack中被映射到UVA的部分，则是用于满足某些情况下较大stack的需求(大量VACC寄存器spill)

|地址空间|Parameter buffer|Stack Remote|Stack Local|
|---|---|---|---|
|线程共享|同一Kernel的软件线程共享|软件线程独立<br>其他软件线程可访问|软件线程独立<br>其他软件线程可访问|
|Size|所有param buffer之和不超过<br>128KB<br>可分配为0~128KB<br>最小分配颗粒度128B|15.5MB - Stack Local|0~128KB<br>最小分配颗粒度128B|
|地址区域|0x1_4000_0000 ~<br>0x1_4002_0000 -1|Thread0:<br>0x1_5008_0000 ~<br>0x1_5100_0000-1<br>Thread i:上述地址加16MB * i|Thread0:<br>0x1_50FE_0000 ~<br>0x1_5100_0000-1<br>Thread i:上述地址加16MB * i|
|SIP指令访问类<br>型|所有标量LDST指令可访问<br>线性地址的向量LD/ST指令<br>LD/ST<br>其他LDST指令不可访问|所有标量LDST指令可访问<br>线性地址的向量LD/ST指令<br>LD/ST<br>其他LDST指令不可访问|所有标量LDST指令可访问<br>线性地址的向量LD/ST指令<br>LD/ST<br>其他LDST指令不可访问|
|SIP访问延迟|Scalar：< 8 cycle<br>Linear vector：~30 cycle|200 ~ 300 cycle|Scalar：< 8 cycle<br>Linear vector：~30 cycle|
|映射方式|RBMMU<br>相同Kernel线程之间共享|RBMMU<br>每个软件线程之间独立|RBMMU<br>每个软件线程之间独立|
|RBMMU寄存<br>器|CSR: PARAM_WRK<br>SPR: PARAM_WRK|SPR: STACK_REMOTE|SPR: STACK_LOCAL|
|说明|映射到本地的SDMEM上|映射到UVA空间|映射到本地的SDMEM上|

Libra SIP的Parameter地址空间有如下特性

**预期用来存放线程间共享或者私有的启动参数**

Supervisor可以通过Legacy SDMEM接口与这些线程进行通信

同一kernel的软件线程共享同一份Parameter buffer

这个地址空间通过线程独立的RBMMU映射到SDMEM中的物理地址。

总共4份，对应最大4个kernel

**分配的最小颗粒度是128B**

   - 每个Param buffer的尺寸范围为0~128KB

- 不同的Kernel之间，虚拟地址上param buffer的起始地址不同

   - 虚拟地址和SDMEM的物理地址存在固定的对应关系

Kernel_param_virtual_addr = 0x1_4000_0000 + SDMEM_param_physical_addr

**Libra的Stack空间有如下的特性：**

- 主要用来满足软件线程在进行function call时寄存器spill的功能

- 虚拟地址上一共有16段，每一段给各自的软件线程

   - 拥有相同ASID的软件线程(sub-thread)之间可以互访

- 每一段内包含两小段映射：Stack Local和Stack Remote

- Stack Local通过SPR寄存器映射到本地的SDMEM中，满足栈空间使用量较少时小latency的特点

   - 每份映射大小为0~128KB

   - 具体在SDMEM上的位置需要通过SPR寄存器(RBMMU)配置

- Stack Remote映射到UVA空间，满足某些情况下栈空间使用较大的特性

   - SPR寄存器(RBMMU)在映射时使用完整的16MB的描述，但是高地址部分可能被stack local所覆盖，低512KB被mask屏蔽，都并不会真正访问到

![图 007](libra_sip_arch_spec__figure_007.png)

**Parameter和Stack的分配方法如下：**

Libra SIP上Parameter配置由supervisor完成

   - 配置参数作为发射参数(PARAM_CFG)传递给待启动线程，线程在启动之后自动设置(PARAM_WRK)

- Libra SIP的所有Stack Local由Supervisor分配，软件自身完成配置

   - Supervisor通过MD*_WRK寄存器传递总的起始位置

   - 每个线程启动后，根据总的起始地址，和自己的SUB_THREAD_ID，计算出本线程的地址，配置到SPR寄存器中 (STACK_LOCAL)

Libra SIP的所有Stack Remote均由Driver分配和设置，Supervisor传递，软件自身完成配置

- 在所有软件线程启动之前分配

- 每个线程启动后，根据总的起始地址，和自己的SUB_THREAD_ID，计算出本线程的地址，配置到SPR寄存器中 (STACK_REMOTE)

这里要求软件侧在线程结束时，对于Stack中的数据全部放弃，不能延续到下一个线程上

- Paramter和Stack Local的总尺寸，不能超过128KB。这是当前SDMEM的容量

   - 软件约定Param只能使用SDMEM的低64KB

   - Stack Local可以分配到SDMEM的低64KB，但此时该区域不能分配作为PARAM Buffer使用

**由软件自身确保Stack Local和Parameter Buffer在SDMEM上的映射互相不交叠**

对于同一个物理存储的重复映射，硬件不维护一致性

##### 6.2.1.8. Shared Data Space

SIP4.0的Shared Data空间是一个1TB地址空间，主要用于存放用于计算的共享数据，例如卷积计算中的Tensor，矩阵计算中的输入和输出矩阵等。这个地址空间主要通过RBMMU映射到物理的VDMEM存储单元上。和SIP3.0不同，SIP4.0的VDMEM物理空间可以用三个不同的UVA地址进行访问：Local VDMEM，Shared Affinity和Shared Non-Affinity。而后两者可以通过DSM网络，被同一个Cluster中所有SIP所访问，也可以通过EDF被同一个SoC中的CDTE/SP所访问。其中Shared Affinity可以通过UVA地址空间映射被同一系统中的其他EDF master所访问到（包括不同cluster的SIP，peer-die访问和ESL访问等）

Shared Data Space的基地址是可以通过CSR寄存器配置的。其默认基地址是4TB，可能的配置位置还包括192TB等。配置要求是 1TB对齐的。对于这个基地址的选择的需求，是Shared Data Space希望做到VA地址和IPA一致，并且SIP访问的VA和DTE/SP访问的 VA一致，避免任何地址指针转换。

|Register Name: XPU_DSM_BASE|Register Name: XPU_DSM_BASE|Register Name: XPU_DSM_BASE|Register Name: XPU_DSM_BASE|Register Name: XPU_DSM_BASE|
|---|---|---|---|---|
|Offset Address: 0x92C|||||
|Field|Bit|Reset<br>Value|RW|Description|
|DSM_BASE|7:0|4|RWHW|DSM_Base_Addr = DSM_BASE * 0x100_0000_0000. Valid range:<br>1~255.|

在Shared Data Space上，一共存在8段地址划分，分别给SIC0~SIC7的共享数据空间。这种映射为固定映射，但是采用了SoC的绝对地址视角而非单个SIP的相对地址视角。

- 这段VA空间和SoC上的IPA一样

- 对于每个软件线程，通过外部传递的地址来访问自己所在的SIC的Shared Data Space

   - 这样软件线程访问的VA和DTE/SP访问的IPA是完全一致的，避免地址转换的开销

虽然给出了8个SIC的VA，但是软件线程只能访问自己所属的SIC的Shared Data Space

DSM称为Distributed Shared Memory，下文会有详细描述

**每个SIC的共享地址空间如下**

|地址空间|线程共享|大小|地址区域|SIP指令<br>访问类型|访问延迟|Linear Vector最大<br>带宽|
|---|---|---|---|---|---|---|
|Shared<br>Affinity<br>Buffer|本Cluster所<br>有SIP共享<br>可以被EDF其<br>他master访<br>问|16MB|SIC0:<br>0x400_0000_0000 ~<br>0x400_0100_0000-1<br>SIC i:上述地址加128MB<br>* i|所有<br>LDST指<br>令均可访<br>问|local: ~32<br>cycle<br>Remote:<br>~128 cycle|1D LD: ~256B/cycle<br>2D LD: ~512B/cycle<br>ST: ~256B/cycle|
|Shared<br>Non-<br>Affinity<br>Buffer|本Cluster所<br>有SIP共享<br>可以被同SoC<br>的SP/CDTE<br>访问|7MB|SIC0:<br>0x400_0400_0000 ~<br>0x400_0470_0000-1<br>SIC i:上述地址加128MB<br>* i|所有<br>LDST指<br>令均可访<br>问|~128 cycle|~256B/cycle(single<br>max)|

本质上，上面的两段地址空间加上L1 VDMEM Space，都是同一个cluster中8个896KB的VDMEM用三种不同的地址视角来进行访问。它们的地址区域是互相覆盖的。具体特点如下：

- 对于每一个SIP上的软件线程，都可以分别使用这三个VA地址视角，完整的访问到本SIP的896KB VDMEM；而通过共享有 affinity空间和non-affinity空间，均可以完整访问整个cluster中所有的8个VDMEM

   - 默认情况下，需要软件自己来进行地址区域的划分，避免不同地址对同一个物理区域造成交叠访问

SIP提供一个P2 feature，可以使用CSR寄存器强行划分3个区域，使得跨区访问产生Exception。

该feature仅考虑用于软件的debugging过程

无亲和共享空间（Shared Non-Affinity Buffer）

这段地址空间，等效于Cluster中每个SIP贡献一部分自己的VDMEM，组成一个连续地址的共享存储，可以被这个cluster 中所有SIP共同访问。访问时带宽和延迟总是均匀的。

软件或者硬件划分上，这个空间最大可以达到7MB

其中SIP7实质上不是一个完整的SIP，它只有一个DSM memory而没有流水线

这段地址空间的VA和IPA相同。而通过XMC的hash算法，会将每一段连续的IPA均匀而离散的映射到8个VDMEM上

Hash算法的映射颗粒度是128Byte

Hash算法保证每段1024byte（128Byte * 8）可以均匀分布

该空间的起始地址开始划分共享无亲和区域，并且划分的颗粒度必须是1024byte的倍数

即设置RBMMU之后，该空间的起始地址不变，但是指令有效可访问的大小会变短

有亲和共享空间（Shared Affinity Buffer）

这段空间是一段16MB的地址段，但是实际上这里的存储单元是存在address hole，并不连续

每个软件线程根据当前SIP在cluster中的SIP id，可以定位出来其中那一段映射到本地SIP的VDMEM区间，那一段映射到远端的VDMEM区间

这段地址中，每一个连续的片段最大可以达到896KB，但是考虑到non-affinity空间和private VDMEM空间软件/硬件划分，每个连续片段往往会比896KB更小

当访问到本地VDMEM时，该地址会提供类似private buffer这样的高带宽和小延迟。而访问到远端VDMEM时，则带宽和延迟要接近无亲和空间访问。

**Shared Affinity Local Space 图示信息**

|项目|说明|
|---|---|
|Shared Affinity Buffer|整体地址段为 `16MB`，包含各 SIP 的 affinity buffer、private VDMEM、non-affinity 区域以及 reserved 区域。|
|Private VDMEM 区域|图示中包含 `For private VDMEM`、`896KB VDMEM`、`SIPx affinity buffer`、`For non-Affinity` 等连续片段。|
|SIP0~6|正常 SIP，可以启动线程，同时各自提供 `768KB` 空间作为 Shared Data Space。|
|SIP7|特殊 SIP，只用于提供 `896MB` 存储空间作为 Shared Data Space，不能启动任何线程。|
|SP/CDTE 访问区|每个 SIP Shared Affinity Local Space 中 `1.5MB` 开始的 `128KB` 空间，用于 SP 和 CDTE 访问 SDMEM。|
|访问限制|该地址区域只能被 SP 和 CDTE 访问，不能被本 SIP 访问，也不能被同 SIC 的其他 SIP 访问。|
|Reserved 区域|图示中包含 `1152KB`、`640KB`、`384KB` 等 reserved 区域。|

**Shared Affinity Buffer 访问权限**

|地址段|本 SIP 访问|同 cluster 其他 SIP 访问|SP 和 CDTE 访问|
|---|---|---|---|
|0~896KB-1<br>VDMEM|可以访问<br>受本SIP到XPU_SCRATCH0<br>的影响|可以访问<br>不受到本SIP<br>XPU_SCRATCH0影响|可以访问<br>不受到本SIP<br>XPU_SCRATCH0影响|
|896KB ~ 1536KB-<br>1<br>Reserved|不能访问|不能访问|不能访问|
|1536KB ~<br>1664KB-1<br>SDMEM|不能访问|不能访问|可以访问|
|1664KB ~<br>2048KB-1<br>Reserved|不能访问|不能访问|不能访问|

私有空间

请见Private L1 Space

推荐软件按照下面方式，对本地SIP划分为三个区域

建议从0开始的VDMEM物理地址区域，分配给Non-Affinity Buffer。

Non-Affinity buffer不需要调整起始的VA地址

建议从896KB-1开始的物理地址区域，由高到低分配给Private VDMEM/Private VDMEM mirror

Private VDMEM的访问起始地址需要做相应调整

建议VDMEM中间的物理地址区域，分配给Affinity Local

**Affinity Local的访问也需要调整起始地址**

这三个空间的划分最小颗粒度，在一个SIP上应当保持为128B

- 如果打开DSM_MASK功能，硬件会强制按照这三个顺序，把VDMEM物理区域由低到高划分为NonAffinity/Affinity/Private VDMEM

DSM_MASK划分的最小颗粒度也是128B

![图 008](libra_sip_arch_spec__figure_008.png)

其中有亲和地址空间和无亲和地址空间也可以被映射到CDTE和SP的0~8GB空间中。它们的IPA情况如下：

- 每个Cluster占用2个地址段，分别是16MB的有亲和共享空间和7MB的无亲和共享空间

   - 每个cluster会使用两个XMC的aperture进行地址映射

   - 共计8个aperture

- 每个Cluster的有亲和共享空间，间隔了VDMEM和SDMEM

   - 这一点和SIP上软件线程视角的有亲和共享空间映射不同

- 每个Cluster的有亲和共享空间，IPA到PA映射不需要XMC的Hash

- 每个Cluster的无亲和共享空间，IPA到PA映射需要XMC的Hash

   - Hash方法和每个SIP上软件视角的无亲和空间Hash算法一样

- 对于每个SIP而言，从DF slave接口进来的地址，其0~896KB访问VDMEM，1.5MB开始访问SDMEM（128KB）。其余地址为 reserved。

   - 1.5MB开始的地址无法被本SIP访问，也不能被本Cluster的其他SIP访问

##### 6.2.1.9. Global Memory Space

对于8GB~256TB的虚拟地址访问（去除Data Shared Space的1GB），SIP全部转换为对EDF上的访问，并由EDF上的PBMMU和 NOC负责路由。8GB~256TB中有两段可访问的空间

- 8GB~4TB & 5TB ~ 256TB

SIP对于这两段空间的访问，总是将请求发送到EDF上，最终由EDF NOC进行处理

Note：上述这两段Global Memory Space中，可以划分为UVA空间/XMC IPA hole/Reserved空间等。详情请见http://wiki.enflam e.cn/pages/viewpage.action?pageId=145801139

##### 6.2.1.10. MMU

对于单个SIP而言，MMU的情况如下：

|MMU<br>类型|Inst RBMMU|Parameter<br>RBMMU|Stack Remote<br>RBMMU|Stack Local<br>RBMMU|Data Buffer<br>RBMMU|
|---|---|---|---|---|---|
|是否共<br>享|每个Kernel独立|每个Kernel独立|每个线程独立|每个线程独立|SIC内所有线程共<br>享|
|数量|2组|2组|10组|10组|1组|
|对应空<br>间|PC空间|Parameter<br>Buffer|Stack Remote部<br>分|Stack Local部分|Private Buffer<br>Shared Affinity<br>Buffer<br>Shared Non-<br>affinity Buffer|
|需要配<br>置的信<br>息|48bit offset<br>线程自带的ASID|SDMEM start<br>addr & size|48bit offset<br>线程自带的ASID|SDMEM start<br>addr & size|VDMEM上的划分<br>尺寸|
|映射方<br>式|PC -> VA|VA -> SDMEM<br>PA|VA -> VA|VA -> SDMEM<br>PA|VA -> VDMEM PA|
|实现方<br>式|CSR:<br>IMEM_BASE_LO_WRK<br>CSR:<br>IMEM_BASE_HI_WRK<br>SPR:<br>IMEM_BASE_WRK|CSR:<br>PARAM_WRK<br>SPR:<br>PARAM_WRK|SPR:<br>STACK_REMOTE|SPR:<br>STACK_LOCAL|CSR:<br>XPU_SCRATCH0|
|说明|||||本质上是mask寄<br>存器|

#### 6.2.2. DSM Overview

在SIP5.0中引入了Distributed-Share-Memory（DSM）的设计。该特性一部分通过SIP内的存储单元实现，另一部分实现在SoC侧 DSM网络和EDF网络。DSM的SPEC参见DSM Spec。下面将对比DSM网络和SIP3.0上的L1/L2 memory结构。

在SIP3.0 的Memory的组织结构中，L1 和 L2 是分离的。从架构层面看，每个SIP可以访问到一块具有很高的带宽的L1 VDMEM （1.5MB）和一块较大容量的L2空间。其中L1 VDMEM是SIP私有的，其他SIP无法访问。而L2空间则是cluster内乃至整个SoC上SIP 共享访问的。当指令范围空间跨过边界之后，有明显的时延差别。另外L1的容量是静态的，L2的容量在一定程度上可配置。

在4.0的设计里，为了让软件获得更大可能的共享存储的能力，同时提高整个SoC的面积利用率，基于每个SIP的VDMEM设计了 Distributed-Share-Memory（DSM）的L1空间，并且去除掉了L2的概念：多块SIP共享一个超大的L1的空间，该memory层次往下则直接是L3空间（会有last level cache LLC）；DSM网络通过share/private划分出不同权限的地址空间，并且在访问路径上通过 remote/local提供不同访存的时延感知：

private空间：

   - 提供给完全不共享的数据存放，每块SIP私有这一部分区域

   - IPA/PA上，它总是指向local的VDMEM和SDMEM

- shared & non-affinity空间：

   - 提供一块较大的共享的数据空间，各个SIP之间可以共享访问这一块区域，但可能不能享受最高的带宽，并且有较大时延多个软件线程通过这个区域进行数据交换时，需要通过fence来保证consistency

   - IPA/PA上，随地址变化指向local和remote的VDMEM，但是无法通过地址区分

- shared & affinity空间 ：

   - 提供一块较大的共享的数据空间，其中某一部分区域可以落在SIP的local区间来获得较大的带宽和较短的时延其余部分会落在remote区域，带宽较低并且时延较大

   - 该区域的可访问存储并不连续，当中有address hole隔离多段连续小片区域

IPA/PA上，随地址变化指向local和remote的VDMEM，可以通过地址区分

![图 009](libra_sip_arch_spec__figure_009.png)

从物理视角而言，在单SIP的看到如下几块memory区域

- SDMEM（单SIP 128KB）

- VDMEM（单SIP 896KB）

##### 6.2.2.1. DSM网络

###### 6.2.2.1.1. Overview

![图 010](libra_sip_arch_spec__figure_010.png)

**从宏观的角度来看待SIP L1和各个网络通道连接的关系大致如上图所示：**

- 每个SIP有2个L1 AXI slave接口暴露出来，供其他master通过DSM bus或者EDF bus访问其全部VDMEM。每个的宽度是 128B。

   - 这2个接口用于同Cluster其他SIP/CDTE/SP访问该SIP的VDMEM

   - SIP内部设计时，这2个 L1 slave ports是对称的，每个都能访问到当前SIP完整的VDMEM空间。

- 每个SIP有两个L1 AXI master接口连接到DSM网络以及EDF网络进行对外访问。每个宽度是128B

   - 这2个接口，既用于SIP访问DSM，又用于SIP访问EDF网络进行UVA地址空间的访问。

   - 这2个接口，功能上都能访问全地址空间。

- 每个SIP有第三个AXI slave接口(DF2 Slave接口)，用于CDTE/SP访问SIP的SDMEM区域

   - 经过NOC转换后，SIP在该接口上可见的物理地址范围为0~512KB

每个SIP有第三个AXI master接口(DF2 master接口)，用于ICache通过EDF bus访问到global区域进行指令的读取

DSM bus享有四根128B的AXI总线进行数据通信

SIC内部对于无亲和区域访问互访：

   - 1个SIC内部的8个SIP通过4根双向的DSM bus来均匀的访问无亲和区域。

- SIC内部对于有亲和区域访问互访：

   - 1个SIC内部的8个SIP使用4根双向bus访问DSM有亲和空间中remote的部分。

EDF 享有四根128B的AXI总线进行外部空间数据通信

对于无亲和区域访问：

CDTE使用4根双向bus访问DSM无亲和空间。SIC0/SIC1共享这4根通道。

对于有亲和区域访问：

CDTE或者其他EDF master使用2根双向bus访问上边SIP或者下边SIP的VDMEM有亲和空间(local区域)

CDTE或者其他EDF master使用2根双向bus访问上边SIP或者下边SIP的SDMEM

###### 6.2.2.1.2. SIP slave ports for VDMEM

每个SIP有两个AXI slave接口(DF0 slave & DF1 slave)暴露给DSM网络，每一个接口支持AXI协议，每个的宽度是128B。作为 slave，这两个接口可以用于SIC内部其余SIP通过DSM访问该SIP的VDMEM空间，也可以用于CDTE对于该SIP的VDMEM数据搬运。 作为同一个DSM网络内部的slave，由于有相同的随机映射规则，所以相同地址相同AXI ID会被分配到同一个slave ports（假设 1），SIP需要对于这个slave ports接受到的同ID的请求做保序处理，并且按序返回。SIP天然无需保证两个slave ports之间的顺序问题。

此外，每个SIP还有第三个AXI slave接口(DF2 slave)暴露给DSM，位宽为128B，用于CDTE/SP对该SIP SDMEM的空间访问。

slave ports收到的请求需要以更高的优先级来访问SIP 内部的MEM资源，已达到较好的性能。

###### 6.2.2.1.3. SIP Master Ports for data

与SIP slave port类似的，每个SIP有两个AXI master接口连接到DSM网络（访问同SIC内部）和EDF master端口（访问SIC外部）。 每个接口支持AXI协议，每个的宽度是128B。SIP的AXI master接口只支持发出burst size = 1的请求。从时序的角度考虑，SIP master口支持固定的AXI ID分配，格式为{master_id，axi_id}

两个SIP master如何连接到四根DSM BUS以及EDF BUS，可以采用直连或者均匀分配。

此外SIP的第三个maste port(DF2 master)为ICache直接访问EDF使用。

###### 6.2.2.1.4. DSM BUS/EDF BUS

DSM/EDF BUS使用AXI接口协议，有一致的user field定义（具体位域说明参考Arch Spec AXI field章节）。

在吞吐量上，DSM和EDF BUS都支持四根总线，每根128B，并且都只支持Burst Length 1。CDTE或者其他EDF master访问进入 SIC前，都由SIC Local NOC转换为burst 1。在连接关系上，由于每个SIP只有两个AXI slave给予DSM BUS、EDF BUS访问 VDMEM，只从中选择一个slave接口，允许CDTE通过EDF BUS访问SIP的私有SDMEM区域。所以在实际访问上：

- SIC内部4根DSM BUS访问DSM有亲和空间，受到SIP slave ports口数量限制，实际两根BUS访问。

- CDTE/SP使用2根双向EDF BUS访问SIP的VDMEM有亲和空间，受到SIP slave ports口数量限制，实际两根BUS访问。 CDTE/SP使用2根双向bus访问上边SIP的SDMEM有亲和空间，受到SIP slave ports口数量限制，实际一根BUS访问。

由于DSM网络不是一个环装结构，所以DSM bus不同节点仲裁时非常依赖QOS机制，总线支持按照qos做优先级竞争仲裁，使得远端获得较好的性能。并且通过EDF master输入的请求优先级总是高于SIC内部访问的优先级，来减少网络上的负载。

注意DSM bus网络会使用更高频率能够提升SIP访问DSM获得更高的带宽。所以SIP与DSM网络会处于两个时钟域范围。

##### 6.2.2.2. memory类型与访问通路

###### 6.2.2.2.1. SDMEM

SDMEM（标量数据存储）共有128KB。为每一个SIP所私有。并且一定落在SIP的local区域。

SDMEM分为8个bank，每个bank宽度是512bit。从memory侧来看，标量访问的throughput可以达到每周期1个交易；向量访问需要多个周期完成。

SDMEM支持两条访问通路

SIP local指令访问：

SDMEM对于scalar指令的访问延迟不超过8个cycle，对于Vector指令访问，延迟会增加到大概20~30cycle，是访问要求的数据量而定。

对于vector LD/ST指令，该区域只允许linear地址并且不使能maskbit的vector指令进行访问，目的是读写parameter， 以及做寄存器的spill

**CDTE访问**

CDTE可以通过EDF BUS访问SIP私有的SDMEM区域做数据搬运，DTE行为可以与load、store请求并行，但需要软件保证一致性问题

在没有bank冲突的情况下，每拍可以同时完成两笔ldst请求，与一笔CDTE请求

SDMEM会通过RBMMU划分为参数空间和软件线程的栈空间和共享参数空间。

###### 6.2.2.2.2. VDMEM

VDMEM（向量数据存储）共有896KB单SIP，其中可以根据软件划分为Private区域和Shared区域

VDMEM共分为16个bank group，每个bank group组成一个宽度为64B的虚拟bank。这些bank group最大可以支持16个64B的 read/write访问。

VDMEM private区域逻辑上只能通过指令访问：

- 不超过两个linear load请求（每个请求128B）和一个linear store（每个请求128B）；或者不超过一个gather-scatter请求 （每个请求32个元素）。

- 当标量访问VDMEM的时候，会合并到linear load或linear store请求通路。此时，会因为标量指令与向量指令的竞争引入延迟。local的VDMEM将采用bank hash的方式来缓解这个问题

VDMEM不能同时处理gather-scatter请求和linear请求。因此，当前一个指令包中使用gather-scatter指令；后一个指令包中使用linear指令时，会引入bubble。反之亦然。

linear指令访问VDMEM的访问延迟为32个cycle左右，gs请求的访问延时在15~70个cycle，取决于元素的地址冲突情况

VDMEM的Shared区域可以通过指令访问，也可以通过CDTE/SP访问。

- 当SIP访问自己的Affinity-local区域时，其特性与自己的lPrivatge区域的访问特性一致

- 如果SIP需要访问其余SIP划分出来的share的memory区域时，就需要通过DSM网络来进行互访

   - DSM网络之间通过总线进行交互，相对于local vdmem区域的访问，有带宽限制，带宽会有下降

   - 由于访问路径的延长，访问的latency会有比较明显的改变

SP/CDTE通过共享亲和区域访问，实际上可以覆盖到VDMEM private的部分

#### 6.2.3. Memory Consistency & Coherence

本章节介绍SIP视角下的访问一致性和数据一致性模型，以及对应的fence

##### 6.2.3.1. Cache Coherence  & CMO

Libra SIP内的Cache情况如下：

ICache。详见SIP Instruction Cache章节。

- L0 RO Cache 。该Cache是IV/VR/SMR寄存器的Cache化复用，为微架构上的单元，通过硬件机制/特定指令和地址hint来维护一致性，详见Pipeline Spec。

不包含传统意义上的L1 Data Cache

由于没有传统意义上的L1 Data Cache，因此不需要常见的Invalidate/Clean/Flush操作。也不存在通常意义上由于Cache导致的 Cohernece问题。

整个Libra系统中，SIP可见的是L3的Last Level Cache(LLC)。SIP并没有对应的硬件机制来维护LLC cache的Coherence，但是提供了可以操作LLC的维护指令。这些维护指令主要目的是性能调优。

关于LLC的维护指令，详见下文中Special Load/Store章节。

##### 6.2.3.2. Memroy Consistency

访存的Consistency问题由硬件进行管理。SIP的访存单元负责保证对于同一个地址访问的RAW、WAR以及WAW满足松散的一致性模型。这里的写指令包括non-atomic write和atomic write。VDMEM Mirror空间是一个特例，它只维护WAW hazard。

从指令的角度，SIP的松散一致性模型情况如下：

1. 任意两个sub-thread之间不保证地址consistency。

2. 同一个sub-thread中，VPT0和VPT1的向量load/store之间不保证地址consistency。

3. 同一个sub-thread中，不同的memory区域之间不保证地址consistency

4. 同一个sub-thread中，同一memory区域下不同memory地址之间的load/non-atomic store/atomic store不保证consistency

5. 同一个sub-thread中，如果地址相同，则scalar指令分别和vector指令的VPT0部分以及VPT1部分各自维护consistency

6. 同一个指令包当中的load/store和store/store之间，即使出现地址重叠，也不维护consistency

7. 同一个指令中，如果多个元素的store之间出现地址重叠，也不维护consistency

8. 满足下列条件时，硬件自动维护一致性

   1. RAW/WAR：在同一个sub-thread中，前后指令包之间读写地址出现重叠，并且地址出现在同一个VPT内部或者scalar和 VPT之间，并且不是对RO区域进行访问，则硬件需要自动维护访问一致性

**从L1/L3 memory的角度：**

对于同一sub-thread同一个地址的连续load请求可以连续发送，对同一个地址的连续store请求可以连续发送；

- 同一sub-thread同地址下，store请求必须等到load请求返回之后才能发送；

   - 这一点由硬件中负责load/store的单元保证

- 同一sub-thread同地址下，load请求必须等到store请求返回之后才能发送；

   - 这一点由硬件中负责load/store的单元保证

- 同一sub-thread同地址下，non-atomic store和atomic store之间，分配相同的AWID，由总线维护访问一致性

**特别的，对于Host Memory空间(PCIE)中同一地址atomic和non-atomic的访问，SIP不保证一致性**

- 这里是由于对于PCIe的访问，即使ID一样，也会因为pcie TLP ordering的问题引入乱序

- 软件确认对于PCIe中，同一地址的前序atomic OP+后续non-atomic op，还需要保证顺序的场景很少，如果存在需要软件进行fence操作

不同地址的load/non-atomic store/atomic store可以乱序，不需要遵循指令顺序。如有保序要求，需要额外增加同步指令

- 对于带有RO hint的访问，是不保证RAW和WAR hazard的。如有需要，需通过fence对齐

   - 这里的RO区域，包括VDMEM mirror空间，也包括访存地址高位包含RO hint的情况。见RO/WO Hint章节

**从总线的视角，**

对于同一sub-thread同一个地址的连续load请求可以连续发送；

- 同一sub-thread同地址下，store请求必须等到load请求返回之后才能发送；

   - 这一点由硬件中负责load/store的单元保证

- 同一sub-thread同地址下，load请求必须等到store请求返回之后才能发送；

   - 这一点由硬件中负责load/store的单元保证

- 同一sub-thread同地址下，atomic指令被视作略微特殊的store指令，并且和正常的store指令维护consistency

   - 即相同地址的normal store和atomic store指令，使用相同的AWID，由总线进行保续

- 同一sub-thread同地址下，同地址的store请求之间会通过相同的AXI索引而不通过前一笔store的response返回来增加性能； 这一点由硬件中负责load/store的单元保证

不同地址的load/non-atomic store/atomic store可以乱序，不一定遵循指令顺序。

###### 6.2.3.2.1. RAW/WAR Check Bypass

- 在SIP编程中，通过64bit地址指针，可以传递 RO hint，从而绕开RAW/WAR检查。有如下方式传递这个信息：

   - 访问Private VDMEM Mirror的地址区域

特定的指令编码，例如GEMM指令总是用RO视角看待memory中的矩阵变量

通过64bit地址指针中RO hint来指示

**详见RO/WO Hint**

即使带有hint，对这些地址依然可以执行写指令，只是会绕开RAW/WAR，而保留WAW检查。

实际上，Libra SIP中可以利用这个地址段的主要是使用512bit颗粒度的linear vector load指令访问本地的VDMEM。它所能接受的最大的vector load数量要多于RAW/WAR检查单元的数量。因此避免RAW/WAR检查可以有效提升该颗粒度的读取带宽。对于 Remote VDMEM、SDMEM和Global访问并不会有性能提升。

###### 6.2.3.2.2. Memory Consistency Maintenance

Libra 系统中常见的Memory Consistency问题往往来自于SIP上不同sub-thread对于相同数据地址进行访问。

当sub-thread（无论是同SIP还是跨SIP）之间需要共享数据的时候，软件需要利用Fence和Hw Sync保证数据同步。如下图所示， sub-threadA是数据生产者，sub-threadB是数据消费者。由于硬件不能保证共享数据的coherence，软件需要保证在整个SoC中， sub-threadA和sub-threadB不会同时对相同的地址进行访问。因此，sub-threadA向sub-threadB发送信号之前，需要用fence指令保证之前的load/store指令已经对L1内share的mem数据进行了实质操作。

- 对于SIP的Supervisor进程通过特殊的SDMEM口写入数据和其余同SIP的sub-thread之间共享，同样需要用fence和HW-sync做数据同步

![图 011](libra_sip_arch_spec__figure_011.png)

**在一个SIP内部，要求不能出现利用不同的地址访问存储单元的情况。但是存在几处特例：**

1. Private VDMEM和Private VDMEM mirror空间。这两段地址空间共享IPA和PA

   1. 对于VDMEM mirror读写之后，通过fence可以在VDMEM空间可见。反之亦然。软件对于VDMEM mirror空间进行访问时，必须自己做好coherence的处理；

   2. 对于同一个物理存储单元的两个Private VDMEM/Private VDMEM mirror地址，硬件不会保证它们之间的 RAW/WAR/WAW。需要软件自己利用fence和sync进行保序

2. Private SDMEM与Parameter/Stack local

   1. 同VDMEM一样，不同地址域指向同一物理单元的地址之间不保证RAW/WAW/WAR，需要通过fence和sync保证数据传递

   2. 希望软件上约束只有Supervisor访问Private SDMEM

3. SIP内的一部分RBMMU会通过VA offset方式映射到UVA空间上。这里包括Instruction RBMMU和Stack remote RBMMU。如果这些虚拟地址出现了重叠，或者指向了相同的物理地址，SIP硬件不做检查。需要软件规避其中的不合理情况

##### 6.2.3.3. IO Consistency

对IO空间访问的consistency问题，同样由硬件进行管理。SIP访存单元的访问模型如下：

- 两个sub-thread之间不保证地址consistency

- 同一个sub-thread，对于不同的slave IP所包含的IO区域，不保证consistency

- 同一个sub-thread，对于相同“IO Path”所包含的IO区域，一定保证对寄存器的访问，访问顺序和指令顺序相同

   - 这里"IO Path"是本Spec定义的一个术语，

   - 即使访问同一个Path中不同寄存器地址，也会保证所有读和写操作的顺序一致性

- 对于SCF & ECF Space和SCF & ECF Space Mirror两个地址段之间的访问，均不保证访问顺序的一致性

   - 即使是同一个线程，通过两个地址段访问同一个物理寄存器，也不保证顺序一致性

- IO Path包含的IO区域，请参照下面章节

**SIP IO Path**

- 对于一个具体IP的IO区域，如果同时存在SCF和ECF的地址映射，则这两个地址区域之间的访问，不保证consistency 即一个IP的SCF映射和ECF映射一定不属于同一个IO Path

无论是否为同一个sub-thread，IO访问和Memory访问之间，不维护consistency

###### 6.2.3.3.1. IO Consistency Example

这里记录两个Debug中发现的IO consistency例子：

1. 在Scorpio上通过SIP对本地的SDTE进行配置。期间混合使用了本地SCF映射的寄存器地址和在ECF上映射的寄存器地址，结果两种映射的地址之间无法自然保序，运行出错

   1. 编程者需要小心，避免在一次功能操作中出现地址混用。比如开发代码中进行了函数调用，而两个部分编写代码的寄存器视角不同导致混用。

2. 在Scorpio上先进行ECF的访问，再配置mailbox，最后执行wait指令等待这个mailbox。结果配置mailbox指令由于ECF访问而积累在store buffer后发射，Wait指令先执行，运行出错

   1. 这里其实存在对mailbox这个外设的RAW hazard，但是写操作是ST指令，读操作是CTRL指令，流水线无法识别两者的依赖

   2. 这种情况需要编程者显示在wait指令前插入Fence L1_IO（或者Libra上的Fence L1_IO_WR），强制保证两者的顺序。

##### 6.2.3.4. RBMMU Consistency

SIP内部的Range base的MMU（RBMMU）通过CSR或者SPR配置。

Inst RBMMU在sub-thread发射时硬件自动配置，sub-thread发射后不可修改

Parameter RBMMU和Stack Local RBMMU为SPR寄存器，由每个线程发射后自行配置

Data Buffer RBMMU为CSR，由驱动在整个Cluster初始化时配置，也可以动态配置

对于Parameter RBMMU和Stack Remote RBMMU，为了维护MMU的访问一致性，建议如下的流程：

![图 012](libra_sip_arch_spec__figure_012.png)

对于Data Buffer Mask (P2 Feature)，默认情况下是关闭的。如果软件在打开它的情况下要做修改，必须确保本SIP上所有subthread的DSM访问全部结束(L2 fence)，然后才能由1个sub-thread或者外部master进行修改。修改完成需要确保写透之后，才能发出新的访问请求。

##### 6.2.3.5. RO/WO Hint

在SIP4.0中，64bit地址指针的bit59和bit60同时为1时，表示RO/WO属性。

当同时设置这2个bit时，SIP4.0会对访问的memory地址去除RAW和WAR的hazard检查，以提高带宽

- 这种场景对于GEMM指令的运算是有利的，尤其是访问的Private VDMEM和DSM affinity local区域。（这两个区域的访问都是对应L1 fence）

- 该对于其他区域的访问(L3/DSM non-affinity)，目前是没有性能改善的。但是软件依然可以使用该hint。之后的SIP系列可能会用该hint作用于更大的memory范围

该属性依然保持WAW hazard上的检查以及保序操作

对于同一个地址，带有该属性和不带该属性的写操作之间不会维护WAW

- 对于VDMEM mirror空间的访问，相当于地址自带RO/WO属性。效果同上。

|Address Bit|Hint For SW|Comment|
|---|---|---|
|Bit 59|ReadOnly or<br>WriteOnly|由编译器决定<br>需要和bit60同时为1时影响硬件行为，停止RAW/WAR检查<br>SIP4.0中作用于Private VDMEM/DSM.affinity local|
|Bit 60|Restrict|由编译器决定<br>需要和bit59同时为1时影响硬件行为，停止RAW/WAR检查<br>SIP4.0中作用于Private VDMEM/DSM.affinity local|

#### 6.2.4. Memory Access Instruction

##### 6.2.4.1. Load/Store Instruction

这里简要概述load/store指令的访问范围和内存寻址方法。指令的详细介绍请参考ISA spec。

###### 6.2.4.1.1. Scalar Normal Load/Store

ISA4.0中支持的通用标量load/store指令如下：

|指令名称|寻址模式|可访问空间|ISA版本|说明|
|---|---|---|---|---|
|LD|SR base + Imm-12 offset|所有数据空间+<br>SCF & ECF Space<br>(不支持SCF & ECF Space Mirror)|ISA2.0|读数据符号扩展到32bit<br>高32bit保持为0|
|ST|SR base + Imm-12 offset|所有数据空间+所有IO空间|ISA2.0||
|LDX|SR base + Imm-12 offset|所有数据空间+<br>SCF & ECF Space<br>(不支持SCF & ECF Space Mirror)|ISA4.0|读数据符号扩展到64bit|
|LDRS|SPR base + SR offset|所有数据空间+<br>SCF & ECF Space<br>(不支持SCF & ECF Space Mirror)|ISA4.0|读数据符号扩展到64bit<br>该指令可以提升性能|
|TLD|SR base + Imm-12 offset|所有数据空间|ISA4.0|固定8Byte数据<br>写回TAR|
|TST|SR base + Imm-12 offset|所有数据空间|ISA4.0|固定8Byte数据<br>读取TAR|

**这些通用标量访存指令还有如下几个特点：**

- CLW/CSW/CLD/CSD不能访问所有的SR寄存器，只能使用SR8~SR15

- LD/ST/LDX指令带有flush域，设置flush域会在指令执行之前和之后都带有fence all语义

- TLD/TST是对TAR寄存器进行spill的指令，固定为8byte

###### 6.2.4.1.2. Vector Linear Load/Store

|指令名称|寻址模式|Max<br>Size|对齐要<br>求|可访问空间|Inst<br>Slot|ISA版<br>本|
|---|---|---|---|---|---|---|
|VLDOA|SR base|512B|Element<br>Or OA|Parameter & Stack Space<br>Private VDMEM & Shared<br>Data Space<br>Global Space<|L/M|4.0|
|VSTOA|SR base|512B|Element<br>Or OA|Parameter & Stack Space<br>Private VDMEM & Shared<br>Data Space<br>Global Space|V|4.0|
|TVLDOA|TAR base<br>TAR base post-<br>inc|512B|Element<br>Or OA|Parameter & Stack Space<br>Private VDMEM & Shared<br>Data Space<br>Global Space|L/M|4.0|
|TVSTOA|TAR base<br>TAR base post-<br>inc|512B|Element<br>Or OA|Parameter & Stack Space<br>Private VDMEM & Shared<br>Data Space<br>Global Space|V|4.0|
|TVLDOA.reg|TAR base + TAR<br>offset|512B|Element<br>Or OA|Parameter & Stack Space<br>Private VDMEM & Shared<br>Data Space<br>Global Space|L/M|4.0|
|TVSTOA.reg|TAR base + TAR<br>offset|512B|Element<br>Or OA|Parameter & Stack Space<br>Private VDMEM & Shared<br>Data Space<br>Global Space|V|4.0|
|TVSTOA_EXT|TAR base|512B|Element<br>Or OA|Parameter & Stack Space<br>Private VDMEM & Shared<br>Data Space<br>Global Space|V|4.0|
|TVSTOA_EXT.reg|TAR base + TAR<br>offset|512B|Element<br>Or OA|Parameter & Stack Space<br>Private VDMEM & Shared<br>Data Space<br>Global Space|V|4.0|

ISA4.0中使用linear地址的vector load/store指令分别有如下特点：

全部为ISA4.0加入的指令，不支持ISA2.0/ISA2.1/ISA3.2的指令

   - 仅支持OACC颗粒度

- ISA4.0加入的SR为基地址的VLD/VST类指令

   - 支持element-wise的地址对齐

   - 在兼容模式下支持双VPT，非兼容模式下只支持单VPT

   - 地址对齐要求放宽到元素对齐

   - 支持动态形状VL和maskbit

- ISA4.0加入的TAR为基地址的TVLD/TVST类指令

   - 放宽了TAR分组，可以使用任意TAR

   - 支持element-wise的地址对

   - 在兼容模式下支持双VPT，非兼容模式下只支持单VPT

   - 地址对齐要求放宽到元素对齐，并且可能触发unalign exception

支持动态形状VL和maskbit

- 所有Vector linear load/store可以访问的空间

   - Parameter & Stack Space

Private VDMEM & Shared Data Space

- Global Space

关于地址对齐详情，请见EXCP_ADDR_UNALIGN章节

- 关于地址区域访问详情，请见EXCP_ADDR_VALID章节

###### 6.2.4.1.3. Vector Stride/Scatter-Gather Load/Store

|指令名称|寻址模式|Max<br>Size|对齐要<br>求|可访问空间|Inst<br>Slot|ISA版<br>本|
|---|---|---|---|---|---|---|
|VLDEOA|SR base + SR offset|512B|Element<br>Or OA|Private VDMEM & Shared<br>Data Space<br>Global Space<br>不能跨区域访问|M|4.0|
|VSTEOA|SR base + SR offset|512B|Element<br>Or OA|Private VDMEM & Shared<br>Data Space<br>Global Space<br>不能跨区域访问|M|4.0|
|MLI_VLDXOA|SR base + 64bit<br>VACC offset|512B|Element<br>Or OA|Private VDMEM & Shared<br>Data Space<br>Global Space<br>不能跨区域访问|MLI|4.0|
|MLI_VSTXOA|SR base + 64bit<br>VACC offset|512B|Element<br>Or OA|Private VDMEM & Shared<br>Data Space<br>Global Space<br>不能跨区域访问|MLI|4.0|
|MLI_VLDXI32OA|SR base + 32bit<br>VACC offset|512B|Element<br>Or OA|Private VDMEM & Shared<br>Data Space<br>Global Space<br>不能跨区域访问|MLI|4.0|
|MLI_VSTXI32OA|SR base + 32bit<br>VACC offset|512B|Element<br>Or OA|Private VDMEM & Shared<br>Data Space<br>Global Space<br>不能跨区域访问|MLI|4.0|
|MRADIX_STXOA|SR base + 32bit<br>VACC offset|512B|Element<br>Or OA|Private VDMEM & Shared<br>Data Space<br>Global Space<br>不能跨区域访问|M|4.0|

ISA4.0在使用新定义的OACC的向量stride和scatter-gather load/store指令。它们有如下特性：

- 都支持OACC的数据语义

都支持maskbit

**都支持动态形状VL**

不能访问parameter和stack空间

ISA4.0延续ISA3.2特点，原因是栈空间主要用来存放栈，参数空间用来存放SIP启动的参数，这两块区域的主要访问形式应该是标量和linear向量，stride和/gather-scatter没有访问它们的需求

在访问Shared Affinity Space时，不能跨越其中的local和remote的边界

- 即对于亲和区域，要么全部元素访问落在本地SIP的VDMEM上，要么全部落在同SIC远端的一个或者多个VDMEM上可访问区域包括

Private VDMEM

- Private VDMEM mirror

Shared Affinity Buffer: Local & Remote

- Shared Non-Affinity Buffer

Global Space

关于地址对齐详情，请见EXCP_ADDR_UNALIGN章节

**关于地址区域访问详情，请见EXCP_ADDR_VALID章节**

###### 6.2.4.1.4. AMO

ISA4.0新增原子性存储操作指令（Atomic Memory Operation），简称AMO指令。AMO系列指令对存储器的一系列读写操作，以 element为颗粒度，必须是原子性的，即不能被打断以保证结果的正确性。

Libra SIP的L1 memory不支持atomic语义，如果有atomic指令发送到这些区域会触发exception。而对于L3的atomic语义实际上是在LLC的相关单元上完成运算的。SIP通路只负责发出对应的AXI总线交易。因此AMO指令对于Libra SIP而言是一类较为特殊的store 指令

- L1 memory包括Private VDMEM/Private SDMEM/Shared Data Buffer/Parameter/Stack

- AMO系列指令只能访问Global Memory地址，并且不能访问DSM地址

| 指令名称        | 类型                | 寻址模式    | 可访问空间        | 运算类型  | 是否寄存器写回 |
| ----------- | ----------------- | ------- | ------------ | ----- | ------- |
| AMO.CAS     | 标量                | SR base | Global Space | 比较后交换 | 总是写回    |
| AMO.EXCH    | 标量                | SR base | Global Space | 交换    | 总是写回    |
| AMO.ADD     | 标量                | SR base | Global Space | 加法操作  | 两种皆有    |
| AMO.AND     | 标量                | SR base | Global Space | 与操作   | 两种皆有    |
| AMO.OR      | 标量                | SR base | Global Space | 或操作   | 两种皆有    |
| AMO.XOR     | 标量                | SR base | Global Space | 异或操作  | 两种皆有    |
| AMO.MAX     | 标量                | SR base | Global Space | 取较大值  | 两种皆有    |
| AMO.MAXNUM  | 标量                | SR base | Global Space | 取较大值  | 两种皆有    |
| AMO.MIN     | 标量                | SR base | Global Space | 取较小值  | 两种皆有    |
| AMO.MINNUM  | 标量                | SR base | Global Space | 取较小值  | 两种皆有    |
| AMO.INC     | 标量                | SR base | Global Space | 递增操作  | 两种皆有    |
| AMO.DEC     | 标量                | SR base | Global Space | 递减操作  | 两种皆有    |
| REDV.ADD    | 向量<br>linear addr | SR base | Global Space | 加法操作  | 总是不写回   |
| REDV.MAX    | 向量<br>linear addr | SR base | Global Space | 取较大值  | 总是不写回   |
| REDV.MAXNUM | 向量<br>linear addr | SR base | Global Space | 取较大值  | 总是不写回   |

**AMO系列指令还包含有如下特点：**

**包含有标量和向量，用于不同场景**

   - 标量AMO指令，可以用于reduce算子，也可以用于同步操作

   - 向量AMO指令，总是用于Tensor颗粒度的reduce算子。该指令不能支持scatter-gather reduce场景，例如radix排序

- 部分标量的AMO指令，可以不要求数据写回寄存器，通过伪指令实现

   - 这种场景预期适用于reduce算子

   - 由于不要求写回SR，可以获得性能提升

- 向量AMO指令，支持动态形状

   - 使用VL寄存器用于动态形状

   - 同时支持maskbit

- 向量AMO指令，只支持单VPT模式

   - 双VPT下会报告exception

这些指令所支持的数据格式如下

![图 013](libra_sip_arch_spec__figure_013.png)

###### 6.2.4.1.5. Matrix Load/Store

基于矩阵变量的Load/Store指令均为ISA4.0中新定义的，并且都为Middle Level Instruction（MLI）。这系列指令包含如下特性：

这系列指令，预期在流水线中被拆解为数十乃至数百条Low Level Instrution （LLI）的Load/Store指令。

   - 其中GEMM系列指令还会拆解出一些LLI的计算指令

- 它们读或写的操作对象为矩阵变量

- 它们对于矩阵变量均支持动态形状

   - 专用的SPR寄存器定义了矩阵在memory中的排列形式和实际尺寸

   - 如果动态形状为0，则该指令会被视为一条NOP指令

- 只能工作在单VPT下工作

   - 双VPT下会触发exception

- 关于地址对齐详情，请见EXCP_ADDR_UNALIGN章节

关于地址区域访问详情，请见EXCP_ADDR_VALID章节

包含的指令包括如下：

|指令名称|寻址模式|可访问空间|ISA版<br>本|说明|
|---|---|---|---|---|
|MLI_MLD|SR base + SPR<br>stride|Private VDMEM & Shared Data<br>Space<br>Global Space<br>不能跨区域访问|ISA4.0|读数据符号扩展到<br>32bit<br>高32bit保持为0|
|MLI_TMLD|SR base + SPR<br>stride|Private VDMEM & Shared Data<br>Space<br>Global Space<br>不能跨区域访问|ISA4.0||
|MLI_MST|SR base + SPR<br>stride|Private VDMEM & Shared Data<br>Space<br>Global Space<br>不能跨区域访问|ISA4.0|读数据符号扩展到<br>64bit|
|MLI_TMST|SR base + SPR<br>stride|Private VDMEM & Shared Data<br>Space<br>Global Space<br>不能跨区域访问|ISA4.0|固定8Byte数据<br>写回TAR|
|MLI_GEMM|SR base + SPR<br>stride|Private VDMEM & Shared Data<br>Space<br>Global Space<br>不能跨区域访问|ISA4.0|固定8Byte数据<br>读取TAR|
|MLI_GEMM_LVA|SR base + SPR<br>stride|Private VDMEM & Shared Data<br>Space<br>Global Space<br>不能跨区域访问|ISA4.0|固定4Byte数据<br>C-slot弹栈操作<br>高32bit保持为0|
|MLI_GEMM_RVA|SR base + SPR<br>stride|Private VDMEM & Shared Data<br>Space<br>Global Space<br>不能跨区域访问|ISA4.0|固定4Byte数据<br>C-slot压栈操作|
|MLI_GEMM_SPS|SR base + SPR<br>stride|Private VDMEM & Shared Data<br>Space<br>Global Space<br>不能跨区域访问|ISA4.0|固定8Byte数据<br>C-slot弹栈操作|

###### 6.2.4.1.6. Special Load/Store

ISA4.0中，支持如下几条特殊的load/store指令，以及hint指令

DPREFETCH

DCACHE_MTN

MLI_HINT

DPREFETCH指令是用于SIP对LLC进行预取操作的指令。从语义上来说，这条指令是一个相对特殊的单字节scalar store指令，特点是向特定的地址对应的Cache line发射SR[Rs1]的末尾byte的写操作，但是通过AXI的全0 strobe使得其并不真正写入任何数据，只是迫使Cache line进行一次miss fetch。另外注意4.0不支持实体上的L1C/L2C概念，只有LLC

**本指令有如下特点：**

Dprefecth指令使用SR的48bit虚拟地址

   - 这一点从ISA3.2上有所修改，不再使用SPR地址

- 在指向有效地址时，该指令和任何其他Load/Store指令都不检查RAW/WAW/WAR hazard，包括之前发射的DPREFETCH指令对访问SIP外部的Cache和Memory时，写数据的控制bit（AXI的write strobe）为全0，并且预期总线返回write response

- 软件可以在指令域的replace位域上增加hint描述修改cache的replace priority，这部分hint信息会通过AXUSER位域传递给LLC 当访问了Global空间之外的地址时，会触发unalign address exception

   - 这一点和SIP3.0不相同

关于触发方法，请见EXCP_ADDR_INVALID章节

如果访问AXI response error，触发EXCP_DF_STORE_ERR异常

DCACHE_MTN是ISA4.0添加的对LLC Cache的特殊操作指令。语义上，这条指令是一个相对特殊的8字节scalar store指令，特点是向特定的地址对应的Cache line发射SR[Rs1]中64bit数据的写操作，但是通过axusr[30]bit指示是一个DCache的维护指令，迫使LLC 单元根据写入的数据进行特殊操作。

**本指令有如下特点：**

- 本指令使用SR的48bit虚拟地址

- 在指向有效地址时，该指令需要和其他Load/Store指令检查RAW/WAW/WAR hazard（不包括DPREFETCH指令） 该指令的地址总是要对齐到128B

- 对访问SIP外部的Cache和Memory时，写数据的write strobe和正常8Byte store指令一样，并且预期总线返回write response 当访问了Global空间之外的地址时，会触发unalign address exceptio

   - 这一点和SIP3.0不相同

关于触发方法，请见EXCP_ADDR_INVALID章节

- 如果访问AXI response error，触发EXCP_DF_STORE_ERR异常

- 对于Cache的操作，由8Byte数据给定。请参见LLC Spec

MLI_HINT是ISA4.0添加的对MLI的load/store的辅助指令。语义上，该条指令只会对同一个指令包中的load/store指令起作用（包括MLI_GEMM系列）。

**本指令有如下特点：**

MLI_HINT只和MLI的load/store指令打包。如果MLI指令没有load/store语义则不起HINT的作用

   - MLI_HINT_GEMM和GEMM系列指令打包

- 如果一起打包的load/store指令不访问global space，则该指令被视为NOP

- 如果一起打包的load/store指令访问global space，则通过这两个指令传递下列AXI总线上的信息

   - load prefetch

   - load priority

   - store miss allocation

store priority

##### 6.2.4.2. Main Package Rule for Load/Store

Libra SIP对于Load/Store指令的基本规则如下：

MLI的load/store只能和C-slot的MLI_HINT单独打包

- 这里包括带有CISC语义的GEMM系列指令

MLI_HINT可以支持cache hint语义

一个指令包中，最多包含一个VACC的load指令和一个VACC的store指令

VACC的load指令常见于L-slot和M-slot

VACC的store指令常见于V-slot

一个指令包中，最多包含一个scalar的load或者store指令

Open：

对于Scatter-gather/stride offset/linear+maskbit的情况，是否禁止和纯linear指令打包？

**预期在Libra SIP算子中的主要指令打包情况：**

- C-slot的MLI_HINT + MLI的load/store

   - 包括MLI_MLD/MLI_MST系列，MLI_VLDXOA/MLI_VSTXOA系列和MLI_GEMM系列

- Scatter-Gather指令和Stride地址指令，只能和scalar LD/ST指令打包，不能和Linear地址的vector LD/ST指令打包

- C-slot的DCACHE_MTN+ L-slot的OACC load + M-slot的OACC 1D运算+V-slot的OACC store

- Legacy指令打包不再推荐

   - 1个scalar load/store + 2个512bit/VPT的vector load+1个512bit/VPT的vector store

   - 1个scalar load/store + 2个1024bit/VPT的vector load+1个1024bit/VPT的vector store

   - 1个scalar load/store + 1个2048bit QACC load + 1个1024bit DACC store

**下面的组合虽然允许，但是会引入性能损失：**

连续的指令包中，同时出现标量load/store和向量load/store，且都访问Parameter & Stacke空间

**关于指令打包规则的详细部分，尤其时非法打包部分，请参考ISA 4.0 Spec的附录B**

##### 6.2.4.3. LD/ST Exception

**对于Load/Store指令，包含如下异常：**

address unalign

address invalid

atomic对于非L3地址的访问也归纳到这个exception下

mixed address attributes

- memory parity error

是否考虑拆为load parity error和store pairty error，方便实现？

Load error

Store error

如果单个指令包含多重exception，则允许流水线一次只报告其中之一，其余的被丢弃。

###### 6.2.4.3.1. EXCP_ADDR_UNALIGN

**根据FCR，EXCP_ADDR_UNALIGN被放弃**

当Load/Store指令的地址没有对齐情况下，SIP4.0的流水线会将地址向下取整到对齐再发射。因此对于编程者，需要注意这个特性。

另外，不同的地址区域，对于指令的对齐要求发生了一些变化：

Scalar指令

地址对齐要求元素宽度对齐

Linear Address Vector指令

对于vector类型memomry的访问，需要元素宽度对齐

- 这类的memory包括

Private VDMEM/Private VDMEM mirror

Shared Data Space（包括Affinity/Non-Affinity）

Global Space

   - 对于带有格式转换语义的Store指令，以格式转换以后的元素作为地址位宽对齐的单位

      - 包括MLI_MST/MLI_TMST/TVSTOA_EXT/TVSTOA_EXT.REG

- 对于scalar类型的memory访问，要求和指令的最大宽度对齐

   - 例如，对于VLDOA，需要地址对齐到512B

   - 这类memory包括

      - Private SDMEM

      - Parameter buffer

Stack Local & Stack Remote

Scatter-Gather指令/Strided Vector指令/MLI_MLD系列/MLI_MST系列/GEMM系列

- 对于vector memomry的访问，需要元素宽度对齐

它们不能访问scalar类型的memory

~~如果load/store指令的地址没有对齐。标量load/store和gather-scatter指令都要求按照数据宽度进行对齐；linear vector load/store指令需要对齐为也修改为按照数据宽度进行对齐。 异常行为：~~

~~对于scalar load，整个指令会被视为无效。~~

- ~~对于scalar store，整个指令会被视为无效。~~

- ~~对于linear vector load，整个指令会被视为无效。返回数据为0xdeadbeef重复。~~

   - ~~对于512bit的load，返回数据为{8{32'hdeadbeef}}~~

   - ~~对于1024bit的load，返回数据为{16{32'hdeadbeef}}~~

~~对于2048bit的load，返回数据为{32{32'hdeadbeef}}~~

~~对于4096bit的load，返回数据为{64{64'hdeadbeef}}~~

~~对于linear vector/matrix vecotr store，整个指令会被视为无效。~~

**~~其中部分数据可能写入memory~~**

~~对于linear vector/matrix vecotr store，整个指令会被视为无效。~~

~~对于stride/gather load，只要有一个元素无效，则整个指令会视为无效。全部或者部分数据数据返回为0x5F 部分数据可能会返回正常数值，这是由于的scatter-gather无法一拍完成导致的~~

~~对于stride/scatter store，只要有一个元素无效，则整个指令会视为无效。~~

~~部分数据可能会正常写入memory，这是由于的scatter-gather无法一拍完成导致的。~~

###### 6.2.4.3.2. EXCP_ADDR_INVALID

**根据FCR，EXCP_ADDR_INVALID功能被简化**

如果load/store指令的地址访问了无效的地址。比如访问的地址Reserved空间，这个地址不是一个有效地址。

对于scalar和vector的atomic指令，如果访问L3之外的地址区域，也归属于这种exception

异常行为：

- 对于scalar load，整个指令会被视为无效。

- 对于scalar store，整个指令会被视为无效。

- 对于linear vector/matrix load，整个指令会被视为无效。

   - ~~对于512bit的load，返回数据为{8{32'hdeadbeef}}~~

   - ~~对于1024bit的load，返回数据为{16{32'hdeadbeef}}~~

   - ~~对于2048bit的load，返回数据为{32{32'hdeadbeef}}~~

   - ~~对于4096bit的load，返回数据为{64{64'hdeadbeef}}~~

- 对于linear vector/matrix store，整个指令会被视为无效。数据不会写入memory

   - 如果linear store中部分地址落在有效地址范围，则该部分会正常写入

- 对于stride/gather load，只要有一个元素无效，则整个指令会视为无效。

   - 可能部分数据会返回正常数值。是由于的scatter-gather无法一拍完成导致的

- 对于stride/scatter store，只要有一个元素无效，则整个指令会视为无效。

   - 可能部分数值会正常写入memory，部分不会。是由于的scatter-gather无法一拍完成导致的

- 对于atomic类指令，整个指令会被视为无效。

**Causion：Libra SIP对于EXCP_ADDR_INVALID检测做了如下的简化**

对于一部分Load/Store指令，它们的地址有效性是基于精确地址进行检查的。包括

- 除了LDRS之外的scalar load/store指令

对于使用TAR_baselinear地址vectorload/store指令（不包括MLI_TMLD/MLI_TMST）

- TVLDOA

- TVSTOA

- TVLDOA.reg

- TVSTOA.reg

- TVSTOA_EXT

TVSTOA_EXT.reg

对于另一部分Load/Store指令，它们的地址有效性是基于Base地址进行检查的，包括

- LDRS指令，使用SPR base进行检查

- 所有基于SR base的线性地址vectorload/store指令（linear address）

- 所有Scatter-Gather和Strided地址的vector load/store指令

   - 包括MLI_VLDXOA/MLI_VSTXOA/MLI_VLDXI32OA/MLI_VSTXI32OA

MLI_MLD/MLI_MST/MLI_TMLD/MLI_TMST和GEMM系列指令

使用Base地址进行EXCP_ADDR_INVALID检测，会引入下列的情况：

如果Base为无效地址，即使Base+Offset为有效地址，也会报告EXCP_ADDR_INVALID

- 例如MLI_VLDXOA指令，它的base指向IO区域，而base加上每个offset之后都指向了DSM区域。那么这条指令其实会报告EXCP_ADDR_INVALID。即出现fault positive的情况

- 对于maskbit的vector类指令，如果Base无效而maskbit屏蔽了无效地址部分，SIP依然会报告EXCP_ADDR_INVALID，属于本类场景

如果Base为有效地址，即使Base+Offset为无效地址，也不会报告EXCP_ADDR_INVALID，并且结果不可知

- 例如MLI_VLDXOA指令，它的base指向DSM区域，但是base加上每个offset之后都指向了DSM和Global之间的reserved 区域。那么这条指令不会报告EXCP_ADDR_INVALID。并且访问的数据不正确。即出现fault negative的情况

- 如果linear address vector类指令，它的尾部部分超过有效地址区域，只要它的base部分也不会报告 EXCP_ADDR_INVALID，属于本类场景

Scatter-Gather/Strided的vector指令也属同理

MLI_MLD/MLI_MST系列指令和GEMM指令也属同理

- 如果Base为A地址空间的有效地址，而Base+Offset为B地址空间的有效地址，则不会报告EXCP_ADDR_INVALID， **并且结果不可知**

流水线会把指令访问发送到错误的路径上，返回接口不可预知，可能会导致系统Hang

**因此对于编程者建议如下：**

- 对于使用Base类的指令，Base本身必须指向一个有效地址空间

- 对于使用Base类的指令，它的Base地址必须为所有元素所在的地址空间

- 由使用者自身保证一个指令访问的所有元素都在同一个地址空间中

   - **由于EXCP_ADDR_MIX_ATTR被放弃，SIP自身无法检测这种情况**

###### 6.2.4.3.3. EXCP_MIX_ATTR

**根据FCR，EXCP_ADDR_MIX_ATTR被放弃**

~~Libra SIP中，Memory区域可以划分如下：~~

- ~~Legacy VDMEM~~

- ~~Legacy VDMEM mirror~~

- ~~Legacy SDMEM~~

~~Parameter buffer~~

~~Stack~~

~~Private Data Buffer~~

~~Shared Affinity Buffer remote part~~

- ~~Shared Affinity Buffer local part~~

- ~~Shared Non-Affinity Buffer~~

- ~~Global~~

~~任意一条指令的访问中，所有元素只能从属于上述区域之一，任何出现访问了多个地址的linear/stride/scatter-gather load/store，都被视为无效~~

###### 6.2.4.3.4. RAS Exception

Load/Store指令对于Memory或者CF/DF的访问，如果发现parity/ECC error，会触发RAS exception。其中包括如下：

- EXCP_VDMEM_RAS_ERR

- EXCP_SDMEM_RAS_ERR

- EXCP_L1DATA_RAS_ERR

EXCP_CF_RAS_ERR

EXCP_DF_RAS_ERR

如果load数据校验发生错误，则指令标记对应的exception。在发生错误的时候，指令已经完成了load操作，并会写回寄存器

###### 6.2.4.3.5. BUS Exception

Load/Store指令访问IO或者Memory，出现AXI总线的response error（非RAS Error），则触发这类异常。

异常包括

EXCP_CF_RESP_ERR

EXCP_DF_RESP_ERR

**异常行为：**

对于scalar load，整个指令会被视为无效。

- 对于linear vector/matrix load，整个指令会被视为无效。指令不会发起总线请求。

- 对于stride/gather load，只要有一个元素无效，则整个指令会视为无效。

   - 可能部分数据会返回正常数值。是由于的scatter-gather无法一拍完成导致的

- 对于scalar store，整个指令会被视为无效。结果可能写回memory。

- 对于linear store，整个指令会被视为无效。结果可能写回memory。

- 对于scatter store，只要有一个元素无效，则整个指令会视为无效。

   - 可能部分或者所有数据都写回memory

##### 6.2.4.4. Fence

Fence指令的语义是，阻塞Fence之后的指令直至其之前的特定指令完成。Fence指令只对其所在的sub-thread有效，并不对其他 sub-thread有效。如果需要多个sub-thread做同一SIP上的fence操作，则需要实现利用HW Sync 同步。

**Libra SIP的ISA中提供下述的Fence**

|指令|语义|
|---|---|
|`MOVS.Barrier ALL;`|Fence 所有指令|
|`MOVS.Barrier L0;`|Fence 所有对 L0 寄存器的写操作。对于 Store 类指令（对 L0 读操作），L0 Fence 只覆盖其发送到总线上的过程。|
|`MOVS.Barrier L1_SDMEM;`|Fence 访问 private SDMEM/Stack Local/Parameter buffer 的访存指令|
|`MOVS.Barrier L1_VDMEM;`|Fence 访问 private VDMEM/DSM.affinity.local 的访存指令|
|`MOVS.Barrier L1_MEM;`|Fence 访问 private SDMEM/Stack Local/Parameter buffer/private VDMEM/DSM.affinity.local 的访存指令|
|`MOVS.Barrier L2_MEM;`|Fence 访问 DSM.affinity.remote 和 DSM.non-affinity 的访存指令|
|`MOVS.Barrier L3_MEM;`|Fence 访问 Stack Remote/Global memory 的访存指令|
|`MOVS.Barrier L1_SDMEM_RD;`|Fence 访问 private SDMEM/Stack Local/Parameter buffer 的读访存指令|
|`MOVS.Barrier L1_SDMEM_WR;`|Fence 访问 private SDMEM/Stack Local/Parameter buffer 的写访存指令|
|`MOVS.Barrier L1_VDMEM_RD;`|Fence 访问 private VDMEM/DSM.affinity.local 的读访存指令|
|`MOVS.Barrier L1_VDMEM_WR;`|Fence 访问 private VDMEM/DSM.affinity.local 的写访存指令|
|`MOVS.Barrier L1_MEM_RD;`|Fence 访问 private SDMEM/Stack Local/Parameter buffer/private VDMEM/DSM.affinity.local 的读访存指令|
|`MOVS.Barrier L1_MEM_WR;`|Fence 访问 private SDMEM/Stack Local/Parameter buffer/private VDMEM/DSM.affinity.local 的写访存指令|
|`MOVS.Barrier L2_MEM_RD;`|Fence 访问 DSM.affinity.remote 和 DSM.non-affinity 的读访存指令|
|`MOVS.Barrier L2_MEM_WR;`|Fence 访问 DSM.affinity.remote 和 DSM.non-affinity 的写访存指令|
|`MOVS.Barrier L3_MEM_RD;`|Fence 访问 Stack Remote/Global memory 的读访存指令|
|`MOVS.Barrier L3_MEM_WR;`|Fence 访问 Stack Remote/Global memory 的写访存指令|
|`MOVS.Barrier L1_IO;`|Fence 访问 local CSR 和集成 IP 寄存器的指令|
|`MOVS.Barrier L2L3_IO;`|Fence 访问 ECF 的指令|
|`MOVS.Barrier L1_IO_RD;`|Fence 访问 local CSR 和集成 IP 寄存器的读指令|
|`MOVS.Barrier L1_IO_WR;`|Fence 访问 local CSR 和集成 IP 寄存器的写指令|
|`MOVS.Barrier L2L3_IO_RD;`|Fence 访问 ECF 的读指令|
|`MOVS.Barrier L2L3_IO_WR;`|Fence 访问 ECF 的写指令|

**需要说明的是：**

1. 对于load指令，完成的含义是数据回写目标寄存器。

2. 对于store指令，完成的含义与store的目的地址范围有关：

   1. 访问L1的store指令，完成的含义是数据写入memory单元。

   2. 访问L3地址空间和IO空间的store指令，完成的含义是AXI总线回复对应的响应。

3. 对于Stack区域的访问，如果命中stack.local则属于L1区域；命中stack.remote则属于global区域

#### 6.2.5. AXI Interface Fields

Libra SIP ECF master/slave和EDF master/slave接口采用的Enflame在Libra SoC上的AXI4扩展协议协议。其中除了基础length、 size、burst等field外，其余部分field的含义如下面章节所示。

本文的内容均与Libra AXI User Description文档保持一致。

##### 6.2.5.1. AxUser (Updated in 4.0)

Libra NOC通过AxUser实现了各个IP的unit ID区分，以及对于EDF空间Cache访问时Cache hint的信息传递。这里AxUser指代AXI总线上的Ar_user和Aw_user域。他们的规则如下

- ECF上的Ar_user和Aw_user域均为20bit；EDF的Aw_user域为48bit，Ar_user域为36bit

   - ECF/EDF的Ax_user[19:0]的定义相同

   - EDF Aw_user[47:36]为额外扩展部分，为了支持atomic相关指令；Ax_user[35:20]为EDF扩展部分，这部分AW/AR有相同定义

AxUser每一段的Field初步如下：

|Bit range|Field|Function|Source|Comment|
|---|---|---|---|---|
|Ar_user[9:0]/Aw_user[9:0]|Master ID|记录发出<br>Request的SIP<br>ID和子模块|SSM配置SA0得到并会<br>被内部部分覆盖|SIP master ID和其<br>他IP定义存在区别<br>数值含义见下表|
|Ar_user[10]/Aw_user[10]|Die ID|区分Die0还是<br>Die1|SSM配置SA0得到|0: master die<br>1: slave die|
|Ar_user[11]/Aw_user[11]|Context Host|标记request是<br>否是从host<br>inboud进来的|SSM配置SA0得到|0:当前请求是来自<br>device内部<br>1:当前请求是来自<br>host inboud<br>对于SIP应该始终<br>配置为0|
|Ar_user[15:12]/Aw_user[15:12]|VF ID|单die内的VF ID|当HwSync发射signal<br>时，该域来源于注册时<br>携带的信息<br>当HwSync发射中断<br>时，该域来源内部寄存<br>器<br>SIP core该域通过SSM<br>配置SA0得到|数值含义见下表|
|DF通路<br>Ar_user[19:16]/Aw_user[19:16]|ASID|表征线程虚拟地<br>址和物理地址对<br>应关系|对于软件线程LDST和<br>ICache的miss<br>fetch/HW prefetch，<br>来源于启动配置<br>SW prefetch，来源于<br>IDMA指令对应的SPR寄<br>存器|1个VF最多包含16<br>个ASID，数值为<br>0~15<br>而PF只包含1个<br>ASID， 固定为0<br>(SRIOV)<br>用于EDF接口|

|Bit range|Field|Function||Source|Comment|
|---|---|---|---|---|---|
|CF通路<br>Ar_user[19:16]/Aw_user[19:16]|MISC|表征多种信息||~~对于SA0，来源于SA0寄~~<br>~~存器的配置~~<br>~~当HwSync发射signal~~<br>~~时，该域来源于注册时~~<br>~~携带的信息~~<br>~~当HwSync发射中断~~<br>~~时，该域来源内部寄存~~<br>~~器~~<br>对于SIP core，表征<br>Thread-slot-ID<br>SA和HwSync请参照各<br>自Arch Spec|SIP core在访问<br>MIH时指示<br>thread-slot<br>SA和HwSync请参<br>照各自Arch Spec|
|Ar_user[20]/Aw_user[20]|N/A|指示走Origin<br>path还是<br>another path||SA XMC|由SA XMC产生，<br>DSM network消耗|
|Ar_user[24:21]/Aw_user[24:21]|N/A|Reserved||Reserved|保持为全0|
|Ar_user[26:25]/Aw_user[26:25]|LLC hint|allocate<br>priority hint||Load/Store指令访问<br>LLC时对于cacheline的<br>hint|0x0: stream数据<br>只在LLC做中转<br>0x1: normal常规<br>的LLC访问<br>0x2: residency建<br>议在LLC中长期驻<br>留<br>0x3: default指令<br>无hint，由MMU<br>决定<br>EDF only|
|Ar_user[28:27]/Aw_user[28:27]|N/A|Reserved||Reserved|保持为全0|
|Ar_user[29]/Aw_user[29]|LLC hint|Load指令自带<br>Prefetch hint||Load/Store指令访问<br>LLC时，是否对之后<br>cacheline做预取|0x0: LLC不需要做<br>prefetch<br>0x1: LLC需要做<br>prefetch<br>DCathe_MTN指令<br>不支持<br>EDF only|
|Ar_user[30]/Aw_user[30]|LLC hint|对LLC的维护操<br>作||指示这是一个对LLC做<br>clean/flush操作的指令<br>具体数值命令包含在<br>8byte的写数据中|命令编码详见LLC|
|Ar_user[34:31]/Aw_user[34:31]|Reserved|Reserved||Reserved|保持为全0|
|Ar_user[35]/Aw_user[35]|ESL order<br>control|ELS访问保序||指示这一笔访问如果到<br>达ESL，需要和之前访<br>问在远端强制保序|用于L4/ESL的保序|
|Aw_user[39:36]|Atomic data<br>type|Atomic指令操<br>作的数据类型||Atomic指令编码给定|数值含义见下表|
|Aw_user[40]|Atomic CAS|CAS专用Flag||Atomic指令编码给定|0:写元素地址是双<br>element对齐的<br>1:写元素地址不是<br>双element对齐的|
|Aw_user[41]|Atomic<br>Scalar/Vector|指示是否为<br>vector||Atomic指令编码给定|0: Scalar指令<br>1: Vector指令|

|Bit range|Field|Function|Source|Comment|
|---|---|---|---|---|
|Aw_user[47:42]|Atomic<br>awatop|指示atomic操<br>作(包括CAS)<br>其中47bit代表<br>是否需要返回值|Atomic指令编码给定|数值含义见下表|

**Master ID的数值含义如下**

对于Libra SIP core中的多个软件线程，不使用Master ID进行区分，而是采用其他方式进行区分这里要求配置到SA中的master ID必须4对齐

|Bit range|Function|Source|Value|
|---|---|---|---|
|Ax_user[1:0]|区分单个SIP内部的<br>Sub Unit的ID|固定分配<br>内部tie-off，不使用SA0<br>寄存器连线|0: SA0 request<br>1: SIP thread request<br>2: HwSync request<br>Others: Reserved|
|Ax_user[4:2]|区分SIP和其他总线<br>上IP|SSM初始化SA0<br>SA0寄存器连线传递SIP<br>core/HwSync<br>SIP Core prefetch会<br>override|对于SIP Core，当发送ICache/L0P5 Cache prefetch请<br>求，数值会override为0x6，即此时ax_user[4:0] =<br>0x19<br>其余情况下，SIP Core正常方法，以及对于HW Sync，<br>这个域会使用SA0传递的信号|
|Ax_user[9:5]|区分SIP和其他总线<br>上IP|SSM初始化SA0<br>SA0寄存器连线传递SIP<br>core/HwSync||

**VF ID的数值含义如下：**

|Ax_user[15:12]|含义|
|---|---|
|0x0|VF0|
|0x1|VF1|
|0x2|VF2|
|0x3|VF3|
|0xF|PF|
|Others|Reserved|

对于Ar_user[26:25]/Aw_user[26:25]，正常LD/ST指令访问Global空间时，分两个步骤决定

**指令端输出**

对于MLI_GEMM，使用给出的MLI_GEMM_HINT编码中的数值（范围为0x0~0x3）

对于其他的scalar和vector load/store指令，固定使用0x3

DPREFETCH指令访问Global空间时，该域由指令上的replace域指定

DCache_MTN指令该域始终为0x0

当请求进入EDF总线时，PBMMU检查是否为0x3；如果是，则根据页表规则把0x3替换为0x0~0x2。否则延续保留原来的值。

对于Ar_user[19:16]/Aw_user[19:16]域

如果为EDF访问，则该域传递ASID，用于虚实地址转换

如果SIP软件线程访问ECF的MIH（下列两种情况），则传递软件线程槽的index

通过SA的RPC传输

通过SA的interrupt传输

SIP软件线程访问ECF的其他情况则传递本线程槽的ASID

对于Ar_user[29]/Aw_user[29]的决定过程

正常LD指令访问Global空间，该域决定权方法如下

如果同指令包中的C-slot hint指令给出了prefetch hint，则使用0x1，否则使用0x0。

如果没有C-slot hint打包，也是使用0x0

请求到达EDF的PBMMU后，不做修改直接透传

- DPREFETCH指令访问Global空间，该域由指令上的hw_pf域指定

同样会被MMU替代

DCache_MTN指令的该域始终为0

对于Ar_user[30]/Aw_user[30]的决定过程

对于DCache_MTN指令，强制设置Aw_user[30]域

Ar_user[30]域始终为0

对于Ar_user[35]/Aw_user[35]的决定过程

- 对于设置了ESL_ORDER SPR寄存器情况下的所有store指令，如果其访问EDF，则强制设置Aw_user[35]域

- 该指令如果到达ESL，则会对之前所有到达ESL并且访问相同远端地址区域的store产生一次fence操作

- Ar_user[35]域始终为0

对于Aw_user[40]的决定过程

- 对于CAS操作，如果进行操作的地址，是2倍元素位宽对齐的，则为0，否则设置为1

- 非atomic CAS操作指令该域始终为0

Atomic data type域的数据含义表达

- 无论是否atomic指令，该域始终需要设置。非Atomic指令情况下，是服务于ESL slave模式下的NNC压缩的。

   - ESL slave模式下，NNC压缩feature是需要知道精确的数据格式才能获得良好的压缩效率。否则压缩效率不高

   - 通过SPR方式来实现非Atomic指令的格式标定，是由于这里对于ESL slave模式使用有编程假设：SIP是在专门的 ECCL kernel中使用ESL的slave模式利用NNC压缩来提高向远端卡的数据传输效率。因此在ECCL kernel中，向某个固定远端区域传输的数据格式是相对固定的，可以半静态的设置。这里要求软件在kernel的一开始通过一个API来设置SPR寄存器。

**该域的设置规则如下**

- 在atomic指令情况下由Atomic指令语义决定。

- 在非atomic指令并且指定了数据位宽的store指令情况下，由SPR寄存器ESL_DTYPE中对应位宽的类型设定指定

- 在非atomic指令并且没有指定数据位宽的store指令情况下，由SPR寄存器ESL_DTYPE中32bit位宽的类型设定指定

|Aw_user[39:36]|Data type|说明|
|---|---|---|
|0x0|INT8|Libra SIP AMO不支持该格式|
|0x1|UINT8|Libra SIP AMO不支持该格式|
|0x2|INT16||
|0x3|UINT16||
|0x4|INT32||
|0x5|UINT32||
|0x6|INT64||
|0x7|UINT64||
|0x8|FP8 (Reserved)|Libra SIP AMO不支持该格式|
|0x9|FP16||
|0xA|BF16||
|0xB|TF16 (Reserved)|Libra SIP AMO不支持该格式|
|0xC|FP32||
|0xD|TF32 (Reserved)|Libra SIP AMO不支持该格式|
|0xE|FP64|Libra SIP AMO不支持该格式|
|0xF|Reserved|Reserved|

Atomic awatop位域的数值含义定义如下

|Aw_user[47:42]|Data type|说明|
|---|---|---|
|0x0|Default|非atomic操作|
|0x10|Reduce ADD|vector或Scalar指令|
|0x13|Reduce INC||
|0x14|Reduce XOR||
|0x15|Reduce DEC||
|0x16|Reduce OR||
|0x17|Reduce AND||
|0x1C|Reduce MAX|vector或Scalar指令|
|0x1D|Reduce MAXNUM|vector或Scalar指令|
|0x1E|Reduce MIN|vector或Scalar指令<br>SIP4.0不支持这种类型指令|
|0x1F|Reduce MINNUM|vector或Scalar指令<br>SIP4.0不支持这种类型指令|
|0x20|Add||
|0x23|INC||
|0x24|XOR||
|0x25|DEC||
|0x26|OR||
|0x27|AND||
|0x2C|MAX||
|0x2D|MAXNUM||
|0x2E|MIN||
|0x2F|MINNUM||
|0x30|CAS|同时设置Aw_user[40]|
|0x32|Exch||

其余Reseved区域全部为0

上述这些域的配置参考来源为：Libra_AXI_User_Description

##### 6.2.5.2. R_user (Updated in 4.0)

EDF/ECF上的R_user规则如下

- SIP常见AXI接口的R_user的域分为两段，其中低段用于放置bus parity/ECC信息；高段用于放置slave read response信息，包括远端slave的RAS检查信息。因此read response可能同时包含两种RAS error，两者并不矛盾

- SIP4.0 DF salve接口的R_User还有额外的第三段。其他的CF接口/DF master接口均没有第三段

- R_user[width-1:0]为per byte的bus parity bit(CF)或者是ECC校验位(DF)

SIP EDF接口的width为12

SIP ECF接口的width为4

- SIP的SCF通路上各个slave被访问时，产生的默认R_user[Width-1:0]必须时全0 (这是为了兼容下一条规则)，在read response穿过SIP ECF接口时，由SA0产生parity bit。SIP内部各个master不产生parity bit。

- SIP_SCF通路上各个master访问ECF通路时，返回的数据parity由SA0检查，如果检查出错，则将R_user[width-1:0]改写为全1，否则改写为全0。

各个master根据R_user[width-1:0]判断parity检查pass或者fail，然后上报bus ras interrupt

- SIP的VDMEM/SDMEM被EDF master访问，read数据在到达Read response接口时，由专门的ECC generator产生ECC 校验数据，放到R_user上随着read data一起返回外部master

- SIP的load指令访问外部EDF slave(DSM/L3)时，read response到达SIP接口时，由专门的ECC checker检查R_user[11:0] 上的ECC校验位和read data

如果发现单bit错误并且矫正，则不触发Exception但是上报Error Interrupt

- 如果发现无法矫正的多bit错误，则触发DF相关的RAS_ERR，并且上报Error Interrupt

详见Bus Related Exception章节和RAS章节

- R_user[width+3:width]为read response的信息位

   - SIP内部master在接收到R response报错，以及非全0的R_user[width+3:width]，进行错误区分，然后上报远端salve RAS interrupt或者远端slave的error interrupt

      - R_user[width+3:width]的数值1表示slave的RAM RAS error，和R_user[width-1:0]全1表示的bus parity error并不矛盾。例如CDTE读取VDMEM，其R_user[15:0]为全0，但是R_user[19:16]可以是数值1，指示RAM ECC error。

      - SIP内部master对于各种错误，需要区分RAS error和其他error，分别上报。

         - 即如果收到0x1的错误，报告给总线相关的RAS_ERR；其他错误报告给RESP_ERR。两者均要上报Error Interrupt

SIP的CF slave通路，r_user[width+3:width]支持下图中两种类型

- 0x0：Everything is OK

- 0x2：Address unalign or address hole

SIP的SCF寄存器被访问时，如果访问到address hold，或者adddress unalign时，处理方法如下

- ~~返回0x2的错误。否则返回0x0~~

- Feature降级：对于访问CF通路上Address hole部分产生的dec error，可以要求只设置RRESP，而不设置R_user

- SIP的SCF address hole，为SCF中local地址区间[32KB, 32MB)的区域，由SIP SCF返回error。

- SIP内部寄存器地址小于32KB区域的address hole由各个slave自行定义

   - SIP core的CSR寄存器段本身没有address hole。对于未定义寄存器，对其读操作返回全0，写操作则丢弃但不报告错误

**SIP的DF slave通路，支持下图中三种类型**

- 0x0：Everything is OK

- 0x1：Parity/ECC check fail

0x2：Address unalign or address hole

   - SIP的SDMEM/VDMEM被作为Slave访问时，如果发现RAM parity/ECC error，r_user高位返回0x1，指示RAM RAS Error SIP的SCF寄存器作为slave被访问时，由于没有ram parity保护，因此r_user不会返回0x1

   - 除了0x0、0x1和0x2外，SIP的SCF和L1 memory作为slave被访问不会在R_user[width+3:width]返回其他的数值

   - 如果SCF/SIP DF上的slave没有发现问题，就返回0x0，即response正确。同时Read response本身也返回正常。

- R_user[width+7:width+4]为QOS段

仅在EDF Slave接口上存在

供cluster内部网络对AXI响应的QOS控制。SIP本身不使用。

![图 014](libra_sip_arch_spec__figure_014.png)

上述这些域的配置参考来源为：Libra_AXI_User_Description。

##### 6.2.5.3. W_user

EDF/ECF上的W_user规则如下

- W_user[width-1:0]为Parity/ECC校验bit

SIP EDF接口的width为12bit的ECC校验位

SIP ECF接口的width为4bit的parity校验位

- 当SIP的SCF寄存器被ECF master写入时，SA0检查W_user的parity，如果发现错误，则改写该域为全1，否则为全0。

   - 然后每个slave内部各自检查W_user，发现数值为全1，并且没有其他访问问题(比如address unalign或者address hole)+时，产生相应的bresp以及b_user

- 当SIP的SDMEM/VDMEM被EDF master写入时，由专门的ECC checker检查write data和ECC校验位

   - 如果发现单bit错误并且纠正，则bresp和busr上报一切正常

如果发现无法纠正的多bit错误，则bresp和busr返回RAS Error信息

- SIP的Load/Store写ECF slave时，SIP_SCF通路上的W_user必须为全0，然后在传到ECF接口上时，由W_user的parity由SA0产生。

即SIP内部的SCF通路本身没有parity保护，但是到ECF上的总线请求有parity保护

- SIP的Load/Store写EDF slave(DSM/L3)时，在总线接口处由专门的ECC generator产生ECC校验位，放到W_user上，随着写数据一起发送

对于Write Strobe bit为0所对应的wdata byte，其数值必须为0，以方便ECC校验位的产生

**上述这些域的配置参考来源为：Libra_AXI_User_Description。**

##### 6.2.5.4. W_data (New in 4.0)

当SIP作为master向EDF slave写数据时，需要遵循下列逻辑

- 如果当前的写是一个partial写（包括AMO操作和正常的写操作），write strobe bit为0对应的数据byte必须为数值0

   - 这是为了配合DF总线上的ECC校验位产生

   - 对于DPREFETCH指令，可以不遵守这个规则。它的write strobe为全0，但是w_data不为全0。ECC校验码以实际写出去的数据来计算。

##### 6.2.5.5. B_user (Updated in 4.0)

EDF/ECF上的B_user规则如下

- B_user在ECF是4bit，表示写入的response。而在EDF master上是73bit，扩展了AMO resp。在EDF slave上是77bit，额外扩展了DSM的QOS域

   - EDF的B_user是为了支持AMO做了扩展。这一点和Scorpio SIP不同

- B_user[3:0]在SIP CF slave通路上支持下图中三种response的产生

   - 当SIP的SCF寄存器被ECF master写入时，每个slave各自检查write request，并产生相应的B_user。

      - 如果address unaligen，产生0x2的B_user

~~如果访问了address hole，产生0x2的B_user~~

- Feature降级：对于访问CF通路上Address hole部分产生的dec error，可以要求只设置BRESP，而不设置B_user对应部分

如果没有address hole或者address unalign，并且W_user是全1，则产生0x1的B_user

代表SA上的parity检测是否通过

其余情况，产生0x0的B_user

换而言之，访问address unalign或者address hole的error优先级高于parity error

**SIP作为Slave时不记录异常状态，但是进行Error Interrupt上报，详见Bus Related Exception章节和RAS章节**

B_user[3:0]在SIP DF slave通路上支持下图中三种response的产生

当SIP的MEM/SDMEM被EDF master写入时，每个slave各自检查write request，并产生相应的B_user。

如果访问了address hole或者address unalign，产生0x2的B_user

如果没有address hole或者address unalign，并且ECC checker检查wdata和w_user[11:0]发现无法纠正的多bit错误，则产生0x1的B_user

其余情况，产生0x0的B_user

![图 015](libra_sip_arch_spec__figure_015.png)

换而言之，访问address unalign或者address hole的error优先级高于parity error

SIP作为Slave时不记录异常状态，但是进行Error Interrupt上报，详见Bus Related Exception章节和RAS章节

SIP的Store指令写ECF/EDF slave，在通过Bresp和B_user接收到Error response时，应该将其区分为RAS Error和其他 Response Error两类错误异常，分别记录到对应的RAS_ERR或者RESP_ERR异常状态上，并进行Error Interrupt B_user[72:4]在EDF

B_user[72]指示Atomic response

对于正常的write的response，b_user[72] == 0；对于atomic指令的response（无论是否为reduce atomic）， b_user==1

B_user[71:8]为Scalar AMO指令返回的数值

对于不需要返回数值的AMO指令，L1 memory系统应当忽略之

- 对于8bit/16bit/32bit的atomic返回数，它所在位置为该指令真实写地址在64bit对齐情况下的相对位置。例如16bit 写地址是12B时，返回数值为B_user[51:36]

这里要求SIP master在发出需要response的atomic指令时，记录操作的数据位宽和真实地址的[2:0]域，从64bit中获得正确的response数据

B_user[7:4]指示Scalar AMO指令返回数值在128B地址对齐中相对的哪个64bit数据

![图 016](libra_sip_arch_spec__figure_016.png)

对于SIP4.0的DF slave，B_user[76:73]为DSM网络使用的QOS域。SIP本身不使用。

上述这些域的配置参考来源为：Libra_AXI_User_Description。

##### 6.2.5.6. AxCache (Updated in 4.0)

AxCache包括Ar_Cache和Aw_Cache两个域段。在Libra NoC中均为4bit。这两个域的定义请见Memory Address Mapping中的表格。

AXI4中对于这个域的编码定义如下：

![图 017](libra_sip_arch_spec__figure_017.png)

**在SIP中，其使用情况如下：**

- SIP各个master，访问SCF/ECF地址空间时，AxCache数值始终为4‘b0000

   - 即Device Non-bufferable

   - 包括LD/ST指令对于CSR/HwSync/SDTE/SAs的访问，HwSync对于SIP mailbox的访问等等

- SIP内部LD/ST指令，访问Global地址空间时，AxCache数值由C-slot的hint和EDF上的PBMMU共同决定对于load指令，SIP Core输出的ArCache数值恒定为0x0

      - 该ArCache数值可以通过MMU或SIP SA的xmc override，不影响LLC cache行为

   - 对于store指令，如果C-slot给出了hint，则选择如下；否则输出到EDF的AwCache始终为4‘b0000

      - 如果hint为write miss non-allocate，则AwCache编码为4‘b0010

      - 如果hint为write miss allocate，则AwCache编码为4‘b1010

   - 当store请求到达PBMMU之后，PBMMU按照如下规则进行替换

      - 对于AwCache，如果不为0，则进行低3bit的替换

   - DCache_MTN指令遵守本规则

- ICache访问EDF取指时，ArCache数值保持为0x0

   - 和Load指令行为一致

   - 该ArCache数值可以通过MMU或SIP SA的xmc override，不影响LLC cache行为

- DPREFETCH指令访问Global空间时，awcache数值始终为4’b1111

   - 即Write-back Write-allocate

   - 该指令为store指令，没有arcache域

上述这些域的配置参考来源为：Libra_AXI_User_Description。

##### 6.2.5.7. AxPROT

SIP会通过指令和SDTE向EDF空间访问数据和指令。而AXI4协议对于指令和数据访问通过AxPROT进行区分：

![图 018](libra_sip_arch_spec__figure_018.png)

因此SIP的EDF接口PROT域有如下的要求：

ICache进行ICache miss fetch、ICache SW prefetch和ICache HW prefetch时，需要将Ar_prot域设置为3‘b110

   - 即Instruction access，Non-Secure access，Unprivileged access

- DPREFETCH指令执行LLC区域的指令段预取时，需要设置指令中的inst域，然后SIP的L1 memory system需要将对于的 Aw_prot域设置为3’b110

- DPREFETCH指令执行LLC区域的数据预取时，不能设置指令中的inst域，然后SIP的L1 memory system需要将对于的Aw_prot 域设置为3’b010

对于SIP其他Load/Store指令访问Global空间时，Ar_prot和Aw_prot域必须为3'b010

- 而SIP内部LD/ST单元访问SCF/ECF接口时，AxPROT域总是为3‘b010。

##### 6.2.5.8. AxLock

SIP内部master访问SCF/ECF/EDF时，AxLock域始终为0

##### 6.2.5.9. AxQos

SIP LD/ST指令的QoS，通过L1_AXI_FIELD_CFG寄存器定义。SIP内部其他master的QoS为寄存器配置。

##### 6.2.5.10. AxRegion

SIP4.0接口中不包含Ar_region/Aw_region域。如果与外部的总线接口连接，则对这个域总是输出为0。

##### 6.2.5.11. R_resp/B_resp (Updated in 4.0)

R_resp/B_resp的为Slave端返回的read response状态和write response状态。为AXI4协议规定的必须接口。SIP内部这两个接口的规则如下：

- 当SIP内部的单元作为master访问其他slave，收到R_resp/B_resp时

   - 如果访问正常结束，收到的resp和r_user/b_user[3:0]都应当为0

   - 如果收到非0的resp或者非0的r_user/b_user[3:0]，都视为访问出错。 **出错的原因应当参考r_user/b_user数值，而非通过resp数值来确认错误类型**

本条修改是为了避免AXI4扩展协议在其他的slave上实现不完整而进行的修改

- 当SIP内部单元被作为slave进行访问（例如VDMEM/SDMEM被SDTE访问，CSR寄存器被SCF/ECF上的master访问），返回 R_resp/B_resp时

如果访问正常结束，应当发出数值为0x0的resp

- 如果出现parity类型的错误，应该返回0x2的resp

   - 即AXI协议上的SLVERR

如果出现无效地址访问，应该返回0x3的resp

- 即AXI协议上的DECERR

- 此条主要应用于memory mapping上的Reserved地址空间。对于CSR定义中未充满分配地址段的部分，不需要视作地址空洞

本规则是为了实现对AXI4协议的兼容性。SIP中的slave依然预期各个SCF/ECF/EDF上的master通过R_user/B_user而非 R_resp/B_resp来确定访问错误的原因

##### 6.2.5.12. AMO指令的AXI Field行为

AMO指令访问Global区域时，需要设置Aw_user[47:39]以及write srobe

Scalar Atomic CAS操作

aw_user[39:36]指定操作数据格式

aw_user[40]

如果操作地址是2倍数据位宽对齐，则设置为0 否则设置为1

aw_user[41] == 0

aw_user[47:42]指定操作类型

其中aw_user[47]必定为1

wdata通道的wstrobe指示待操作的数据位置

wstrobe为2倍数据位宽

永远保持swap数据在高，compare数据在低

Write Address：

保持128Byte对齐，不发射narrow burst

![图 019](libra_sip_arch_spec__figure_019.png)

Scalar Atomic 操作(非reduce，非CAS)

aw_user[39:36]指定操作数据格式

aw_user[40] == 0

aw_user[41] == 0

aw_user[47:42]指定操作类型

其中aw_user[47]必定为1

wdata通道的wstrobe指示待操作的数据位置

需要和数据位宽对齐

返回的B_user[72:4]送给SR

Scalar Atomic指令(reduce，非CAS)

- `aw_user[39:36]` 指定操作数据格式。

- `aw_user[40] == 0`

- `aw_user[41] == 0`

- `aw_user[47:42]` 指定操作类型，其中 `aw_user[47]` 必定为 0。

wdata通道的wstrobe指示待操作的数据位置

需要和数据位宽对齐

忽略返回的B_user[72:4]

Vector Atomic Reduce

- `aw_user[39:36]` 指定操作数据格式。

- `aw_user[40] == 0`

- `aw_user[41] == 1`

- `aw_user[47:42]` 指定操作类型，其中 `aw_user[47]` 必定为 0。

wdata通道的wstrobe覆盖被选中的元素，需要和数据位宽对齐。

忽略返回的B_user[72:4]

#### 6.2.6. SIP Data Fabric Port

每个SIP 4.0都包含了3个DF master port和3个DF Slave port。这6个Port的总结如下

|Port Name|功能单元从属|位宽|访问范围|
|---|---|---|---|
|DF0 Master Port|SIP指令访存通路master接口|128B|Shared Affinity Space Remote<br>Shared Non-Affinity Space<br>Global Space|
|DF1 Master Port|SIP指令访存通路master接口|128B|Shared Affinity Space Remote<br>Shared Non-Affinity Space<br>Global Space|
|DF2 Master Port|SIP ICache取指通路接口|128B|Global Space|
|DF0 Slave Port|DSM Slave Port0|128B|提供以下空间<br>Shared Affinity Space<br>Shared Non-Affinity Space|
|DF1 Slave Port|DSM Slave Port1|128B|提供以下空间<br>Shared Affinity Space<br>Shared Non-Affinity Space|
|DF2 Slave Port|DSM Slave Port2|128B|只向CDTE/SP提供以下空间<br>SDMEM|

其中DF0~DF2 master port的特性总结如下：

DF0/DF1为SIP的load/store指令访问DSM和Global空间的通路接口，支持读请求和写请求

DF2为ICache从Global取指的接口

三个接口都是128B的AXI接口

三个接口都只发送Size = 128B，Burst Length = 1的AXI请求

DF0/DF1支持发送atomic请求，以及wrtie strobe并不为全0的写请求

甚至支持write strobe全部为0请求

DF2只发送读请求

而DF0~DF2 slave port的特性总结如下：

- DF0/DF1/DF2为SIP作为DSM salve向外界提供的Slave接口

- DF0/DF1向SIP/SP/CDTE这些master提供Shared Data Space空间的访问

   - DF0/DF1提供的访问全部是mapping到VDMEM上的

- DF2只向SP/CDTE提供SDMEM的访问

   - SIP不能通过这个接口提供本地或者其他SIP的SDMEM

- DF0/DF1接口的接收的地址范围，为0~1.5MB

   - 其中超过896KB的地址访问会返回dec_err

   - 其他地址段的范围需要外部NOC来屏蔽

- DF2接口接收的地址范围，为0~512KB

   - 其中超过128KB的地址访问会返回dec_err

   - 其他地址段的范围需要外部NOC来屏蔽

- 这三个接口，均支持128B的single burst访问不支持burst length > 1的访问

这三个接口，均支持narrow transaction

#### 6.2.7. SIP IO Path

##### 6.2.7.1. Requirement

SIP4.0中，sub-thread对于IO寄存器访问有如下的功能和性能需求：

功能上，需要满足以下限制

- 遵循IO Consistency章节中提到的访问模型

- 单个软件线程对于一个IP映射到同一个地址区域的寄存器区间的访问，需要硬件严格遵守读写顺序一致性 （RAR/RAW/WAW/WAR保序）

   - 例如，对于CDTE0映射到ECF上的地址空间，任意一个SIP的某个线程对它进行读写，必须保证这一片的寄存器（而非单个寄存器）均严格保证所有读/写操作的按序完成，哪怕是两个相邻的寄存器。这是因为IO寄存器在设计时，会从slave端假设这些寄存器的配置和读写顺序是按序完成的，以满足其内在的功能。此时SIP的scalar load/store unit和SCF/ECF NOC必须负责避免从指令发射端(load/store buffer)到IP slave端这段延迟可能导致的 RAR/RAW/WAW/WAR hazard。这一点和memory的访问一致性模型是不同的。

对于同一个寄存器区间的多段映射之间，编程系统并不保证两者之间的读写顺序一致性。

- 同一寄存器的多端映射往往是为了满足不同视角下的编程需求。但是单个视角下不应该追求混用

- 例如，Libra SIP中所有SCF/ECF空间在4GB~5GB地址空间有一个映射，而在6GB~7GB之间还有一个镜像映射。那么对于任一IP的IO寄存器区间，如果交错使用两个地址空间上的地址进行读写访问，则硬件不会自动维护它们之间的读/写一致性

- 在同一个地址空间上的多段映射也属于同理，比如每个SIP中HW Sync在SCF和ECF上各有一个映射。这两个映射之间也不保序。

**性能上，需要满足下列的要求**

**不同sub-thread之间的访问不能互相阻塞**

- 不同thread的IO访问应当视作互相独立，架构和微架构设计需要避免引入sub-thread之间的访问阻塞，从而影响性能

同一个sub-thread对于同一个IP的访问应当支持复数的write outstanding和read outstanding

- 对于Libra系统中算子性能核心相关的IO寄存器区域，支持和其他的IO寄存器区域之间乱序访问

   - 例如CDTE/HW Sync等IO寄存器区域，对它们的访问不应该被其他寄存器区域访问所阻塞

- 对于没有性能需求的寄存器区域，或者并不预期由SIP访问的寄存器区域，出于简化设计目的，允许存在额外的阻塞导致性能下降

##### 6.2.7.2. IO Path and AXI ID

为了满足上述需求，Libra SIP对不同寄存器地址段分配不同AXI ID。由于AXI协议中同ID的读与读/写与写保序，不同ID之间不保序，因此可以提升IO访问的性能。具体设计方案如下设计方案：

SIP的IO单元中包含64个IP Path单元，每个单元准静态绑定一个AXI ID，以及一个或者若干个连续的寄存器区域

总共有64个AXI ID

- 一个SIP上所有sub-thread访问一段IO寄存器其余，均通过对映的IO Path，使用对应的AXI ID

读和写之间使用相同的AXI ID

- 单个IO Path+SCF/ECF NoC，对于来源于同一个sub-thread的访问，维护读和写顺序一致性

   - 由于AXI总线特性，RAW/WAR的一致性是由SIP内部的IO Path unit来维护的

即读请求response返回之后再发送写请求，反之亦然。

**RAR/WAW的一致性由CF NOC基于AXI总线协议进行维护**

例如某一段CF NOC发现来源于同一master的两个相同AXI ID写请求会发往向两个不同方向的下游通路，则会block 第二个写请求，直到对于的写response返回本节点，才会放行第二个写请求。读请求也是一样

单个IO Path，对于不同来源的sub-thread访问，不维护RAW/WAR的一致性

RAR/WAW一致性是由NOC基于相同AXI ID来维护的，SIP无法改变这一点

- 单个IO Path能够支持read outstanding和write outstanding

   - 对于访问相同IO寄存器区域的读访问或者写访问，由于SCF/ECF路径相同，自然支持单独读操作序列或者单独写操作序列的outstanding，能够提高对于单一IP编程的性能

   - 64个IO Path共享32 reading outstanding和256 write outstanding

      - 所有sub-thread之间也是共享outstanding的

目前SCF的read outstanding+write outstanding总数为128，单个IO Path的outstanding实际上会超过SCF的能力。即整体SCF通路上的write outstanding最大是128个

所有的IO Path请求，都会经过仲裁后在SCF入口上，转换为串行的AXI读序列和写序列

采用Round-Robin的仲裁策略

##### 6.2.7.3. AXI ID Mapping Policy

由于AXI ID和不同的地址段绑定会对性能有明显影响，因此采用如下分配原则：

- 对于4GB~5GB和6GB~7GB，各自分配32个AXI ID(和独立的IO Path)

   - 4GB~5GB使用0~31，6GB~7GB使用32~63

- 对于有高性能需求的IO寄存器区间，分配独立的AXI ID

   - 部分高访问IO寄存器区间可以和不预期使用的IO寄存器空间合并

- 由于SIP对于同Cluster的SIP/CDTE有高性能需求，而对非相同Cluster的SIP没有访问需求，因此需要准静态映射

   - 使用XPU的SIP_ID寄存器，识别所属Cluster，实现不同的分配情况

- 对于低性能需求的IO寄存器区间，合并使用相同的AXI ID

**对于AXI ID的分配情况如下：**

**为4GB~5GB上的分布，6GB~7GB上的映射则需要在AXI ID上增加32**

|ECF地址段|AXI ID|说明|
|---|---|---|
|SIP SCF空间(0~32MB)<br>(不包括mailbox和L1 HW Sync)|0|SIP local视角的区间使用相同ID<br>这是从Legacy角度出发的选择|
|SIP mailbox|12|SIP本地的mailbox有高访问性能需求|
|SIP L1 HW Sync|13|SIP本地的HW Sync有高访问性能需求|
|同Cluster的SIP0|1|SIP0的HW Sync可以用作L2 HW Sync<br>高访问性能需求<br>通过XPU的SIP_ID寄存器来判定|
|同Cluster的SIP1|2|高访问性能需求<br>通过XPU的SIP_ID寄存器来判定|
|同Cluster的SIP2|3|高访问性能需求<br>通过XPU的SIP_ID寄存器来判定|
|同Cluster的SIP3|4|高访问性能需求<br>通过XPU的SIP_ID寄存器来判定|
|同Cluster的SIP4|5|高访问性能需求<br>通过XPU的SIP_ID寄存器来判定|
|同Cluster的SIP5|6|高访问性能需求<br>通过XPU的SIP_ID寄存器来判定|
|同Cluster的SIP6|7|高访问性能需求<br>通过XPU的SIP_ID寄存器来判定|
|同Cluster的SIP7|8|高访问性能需求<br>通过XPU的SIP_ID寄存器来判定|
|同Cluster的CDTE|9|高访问性能需求<br>通过XPU的SIP_ID寄存器来判定|
|SP ECF Space|11|高访问性能需求：Supervisor|
|EDTE ECF Space|14|高访问性能需求：ECCL相关算子|
|DPF ECF Space|15|高访问性能需求：L3 HW sync|
|ecf_esl0_local_axi(两段)|16|高访问性能需求：ECCL相关算子<br>预期主要使用其中一段地址，避免性能下降|
|ecf_esl1_local_axi(两段)|17|高访问性能需求：ECCL相关算子<br>预期主要使用其中一段地址，避免性能下降|
|ecf_esl2_local_axi(两段)|18|高访问性能需求：ECCL相关算子<br>预期主要使用其中一段地址，避免性能下降|
|ecf_esl3_local_axi(两段)|19|高访问性能需求：ECCL相关算子<br>预期主要使用其中一段地址，避免性能下降|
|ecf_esl4_local_axi(两段)|20|高访问性能需求：ECCL相关算子<br>预期主要使用其中一段地址，避免性能下降|
|ecf_esl5_local_axi(两段)|21|高访问性能需求：ECCL相关算子<br>预期主要使用其中一段地址，避免性能下降|
|ecf_esl6_local_axi(两段)|22|高访问性能需求：ECCL相关算子<br>预期主要使用其中一段地址，避免性能下降|
|ecf_esl7_local_axi(两段)|23|高访问性能需求：ECCL相关算子<br>预期主要使用其中一段地址，避免性能下降|
|ecf_esl8_local_axi(两段)|24|高访问性能需求：ECCL相关算子<br>预期主要使用其中一段地址，避免性能下降|
|ecf_esl9_local_axi(两段)|25|高访问性能需求：ECCL相关算子<br>预期主要使用其中一段地址，避免性能下降|
|ecf_esl10_local_axi(两段)|26|高访问性能需求：ECCL相关算子<br>预期主要使用其中一段地址，避免性能下降|
|ecf_esl11_local_axi(两段)|27|高访问性能需求：ECCL相关算子<br>预期主要使用其中一段地址，避免性能下降|
|ecf_esl12_local_axi(两段)|28|高访问性能需求：ECCL相关算子<br>预期主要使用其中一段地址，避免性能下降|
|ecf_esl13_local_axi(两段)|29|高访问性能需求：ECCL相关算子<br>预期主要使用其中一段地址，避免性能下降|
|ecf_esl14_local_axi(两段)|30|高访问性能需求：ECCL相关算子<br>预期主要使用其中一段地址，避免性能下降|
|ecf_esl15_local_axi(两段)|31|高访问性能需求：ECCL相关算子<br>预期主要使用其中一段地址，避免性能下降|
|其他地址段|10|无高性能需求，使用相同ID，会互相阻塞|

为4GB~5GB上的分布，6GB~7GB上的映射则需要在AXI ID上增加32

![图 020](libra_sip_arch_spec__figure_020.png)

![图 021](libra_sip_arch_spec__figure_021.png)

##### 6.2.7.4. Programming Guide

使用6GB~7GB的IO映射区域，对2D的数据加载进行加速

- 对这个区域的IO写操作，一定会在之前所有GEMM系列指令（注意不支持1D指令）对memory的读操作完成之后，才会发射。因此使用这个地址区间的写mailbox/HW_Sync操作，可以按照指令顺序完成GEMM->signal mailbox，而不需要 4GB~5GB上操作IO时，使用GEMM->L0 fence->Signal mailbox的顺序

该区域只支持写操作，并且只对GEMM指令的读和IO写做特定保序

对于ESL的IO操作，建议只使用PCIe bar invisible或者PCIe bar visible一个区间

如果混用会带来性能问题

对于所有ID标识为10的IO访问，不要有好的性能预期

对于配置IO寄存器的操作，遵循先连续配置参数最后进行使能，并且避免中间插入读寄存器的操作

### 6.3. SIP Multi-thread

**Note：根据FCR，Kernel-slot减少到2个，sub-thread-slot减少到10个**

#### 6.3.1. Pipeline and Multi-Threads

Libra SIP与以往的SIP有一个重要的变化，是在同一个硬件流水线上实现多个线程(指sub-thread，下同)的并行执行和切换。这种多 sub-thread切换并不是传统CPU上基于save & restore的线程切换，而是类似于GPU上的多线程取指译码，复用少量ALU单元，利用每个sub-thread程序流的hazard stall快速切换到另一个sub-thread的方法，提高流水线利用率。一种逻辑示意图如下：

![图 022](libra_sip_arch_spec__figure_022.png)

- 和Pavo/Dorado/Scorpio SIP相比，Libra SIP的多线程情况如下：

|SIP version|硬件线<br>程数量|单硬件线程上软件线<br>程数量<br>（sub_thread)|软件线程<br>最大总数|Kernel-<br>slto|Comment|
|---|---|---|---|---|---|
|SIP2.0/SIP2.1|1|1|1|1|计算sub-thread，2VPT模式|
|SIP3.0|2|1|2|2|一个固定为supervisor，纯scalar的<br>sub-thread<br>另一个为计算sub-thread，2VPT模<br>式|
|SIP4.0|1|10 (max)|10|2|需要全部单VPT模式才能达到最大的<br>sub-thread使用数量|

在SIP4.0上，每一个sub-thread都归属于到任意一个Kernel-slot上。这里约束了SIP上可以同时并发的Kernel-slot总数为2个，其中部分硬件资源会基于此做优化。AMOS必须保证正在发射执行的Kernel-slot总数不超过这个数值。

在逻辑上，每个软件线程槽（sub-thread-slot，下同）会有自己独立的working状态寄存器。但是实际上这些寄存器会映射到 Kernel-slot的寄存器组上。即SIP中，对于除了SUB_THD_ID_WRK寄存器外的其他Working寄存器组，实际上只有2份；通过配置 LCHTRIG寄存器，硬件在发射Kernel时会将若干sub-thread-slot关联到这组Kernel-slot上。可以通过KNL_THD_MAP0来查看subthread-slot和kernel-slot的关联关系。

**Note** : 本文档中描述的Kernel-slot，指代SIP上启动一个任务的基础单元。它可以对应一个软件架构下的thread，或者一个软件架构下的block，而非软件的kernel概念。**Libra上多sub-thread支持有如下特点：**

**支持多种sub-thread类型**

Scorpio兼容算子，新算子等

每个sub-thread之间有独立的L0寄存器

包括SR/TAR/SPR等寄存器，互相之间独立

- 需要AMOS进行资源分配和配置

VACC

KSID

Param buffer

- 支持multi-sub-thread launch

硬件自动将一个Launch配置(1个kernel-slot)拆解为多个sub-thread-slot的启动发射

#### 6.3.2. Sub-Thread Type

**Libra SIP支持的sub-thread类型包括如下：**

|sub-thread类型|VPT个数|是否使用GEMM|sub-thread个数限制|Comment|
|---|---|---|---|---|
|Type1|1|可以使用|1~10个|类型包括<br>1. Libra基于GEMM的2D算子<br>2. Libra的1D算子<br>3. Supervisor|
|Type3|2|可以使用|启动1个|类型包括<br>1. Scorpio上Legacy 1D算子|

**上述算子类型说明如下：**

- Type1/Type3算子为软件显式区分并且保证它们的指令使用情况，AMOS在launch时传递参数给硬件CSR寄存器，然后启动时硬件自动进行约束

**禁止跨越Type类型function call，硬件无法支持不同Type的函数混用**

Type3为SIP3.0 Legacy算子的sub-thread，它的特点包括

只有这种算子在Libra SIP上可以使用2VPT的配置

该算子sub-thread的ISA指令方面有如下约束：

- 完全不受到VL的影响

对于1D指令，按照2个VPT执行

TCTL打开两个VPT，不可关闭任意一个VPT

该类型sub-thread，在寄存器资源上相当于Type1的2倍

包括物理上的TAR/VACC，都需要映射到该sub-thread的2个VPT语义上

- 该类型的sub-thread，在每个SIP上运行期间时排他性的，独占整个SIP的

   - 在SIP上，双VPT的sub-thread只能启动一个，不能启动2个或者2个以上

在双VPT的sub-thread在工作时，不能和任何其他sub-thread类型并行工作，包括Type1的sub-thread

- 在发射时，需要显示占用所有sub-thread槽资源，但是实际上只有第一个sub-thread槽在工作

   - 由于上一条的排他性要求，需要显示占用所有sub-thread

实际上该sub-thead需要占用两个type=1的sub-thread的TAR资源

双VPT线程的sub-thread-slot选择约束，请见Launch Thread Slot Selection章节

Type1特点如下：

- 单VPT语义。启动时该sub-thread时忽略TCTL寄存器，对于vector指令永远操作VPT0

该类型sub-thread，主要用于Libra新算子

这里将sub-thread进行严格区分的原因，在于SIP流水线设计，为了达到性能兼容性和编程模型的迁移，SIP3.0兼容算子和SIP4.0新算子下，TAR/VACC寄存器使用方式这些方面大相径庭。不做显示的标注，单凭pipeline是无法正确运行和管理这些不同的subthread，反而会导致SIP运行错误。通过显示标注这些sub-thread，才能通过软件或者硬件方式来约束它们在SIP上的执行，防止冲突的sub-thread并行执行。

**最大可能的sub-thread并行场景如下**

- 启动2个Kernel-slot，均为type1，sub-thread总数不超过10

- 启动1个type1的Kernel-slot，sub-thread总数不超过10

- 启动1个type3的Kernel-slot

**常见的可能sub-thread组合情况如下：**

启动2个Kernel-slot，均为type1，每个kernel的sub-thread数为4

- 启动1个type1的Kernel-slot，sub-thread总数不超过8

- 启动1个type3的Kernel-slot

#### 6.3.3. Thread Launch

##### 6.3.3.1. Launch Requirement

~~SIP4.0需要支持Supverisor发射和计算kernel发射~~

- SIP4.0需要支持一个Kernel中包含多个sub-thread的发射

   - 考虑使用batch发射

- SIP4.0需要利用AMOS，来支持对kernel实现shadow launch

一个可能极端情况是，前一个运算的kernel尚未执行完成，后一个AOT的kernel预先发射，用低优先级计算AOT所需的参数。两个kernel的VACC数量之和会超过SIP VACC的总数（supervisor重复分配）。但是AOT kernel会通过wait signal的方式，避免进入后面实际使用VACC的步骤。直到前一个kernel全部完成释放VACC，AOT的kernel才会解除wait，正式开始使用VACC。

http://wiki.enflame.cn/display/~chuang.feng/Libra-Dot-Cost

##### 6.3.3.2. SIP Launch Flow

SIP上运行的sub-thread总是以Kernel-slot为单位发射的，而每个Kernel-slot可以分拆为1个乃至多个sub-thread。从功能角度，这些sub-thread可以分为两大类：

- Supervisor，这是一个常驻SIP的管理sub-thread。该sub-thread归属于一个独立的进程，作用是和AMOS配合，完成其他 Kernel的资源管理/分配和发射，并且尽可能提高发射性能，隐藏其他Kernel-slot发射所需的时间开销

- 计算sub-thread。这是SIP上有效的计算负载。通常以Kernel方式从AMOS传递给Supervisor发射。一个Kernel-slot可以在SIP 上分拆为多个sub-thread，占用多个sub-thread-slot

   - 一个SIP上可能有多个kernel-slot并发

上述两类sub-thread，都是在同一个SIP的流水线上并发工作的。

为了支持上述两种sub-thread，Libra SIP提供了两个寄存器Launch通路，可以分别实现计算Kernel-slot通路和Supervior通路。这两组通路的结构几乎完全相同，各自有一组CFG寄存器接口和一个深度为4的Launch queue。其中Queue的出口被映射为各自的 NXT寄存器组。如下图所示。区别在于Launch 1通路只能支持单sub-thread的kernel发射，并且固定发射到sub-thread-slot-9上； 而Launch 0通路支持多sub-thread的kernel发射，并且可以指定任意的sub-thread-slot。

Launch 1固定发射到sub-thread-slot 9为了给supervisor服务的

![图 023](libra_sip_arch_spec__figure_023.png)

**预期的Supervisor发射流程如下：**

- AMOS通过CF访问，将supervisor的配置信息写到LCH1 CFG上，并且写LCHTRIG寄存器

   - 这组寄存器地址连续，并且LCHTRIG在寄存器组的末尾，所以可以通过DMA来配置。

   - 这组配置必须是单sub-thread的。

   - 这组配置必须在写LCHTRIG时选择sub-thread-slot9

- 硬件自动将LCH1_CFG的所有配置参数复制到LCH1待启动队列(queue)

   - LCH1的待启动队列深度为4

   - 队列最开头的那组配置可以被NXT寄存器组访问

- 当配置到达队列头部时，硬件自动检查sub-thread-slot9是否为idle。如果为Idle，则将NXT的配置Pop到slot9的WRK寄存器组，启动流水线

- Supervisor启动之后，进行必要的初始化工作

包括VAB和stack remote

Supervisor接受从AMOS传递的kernel信息

Supervisor应当早于计算sub-threadKernel启动

**预期的计算sub-thread发射流程如下：**

如果使用supervisor，则AMOS通过以下方式，将计算sub-threadKernel的参数传递给Supervisor

- Option1：将计算sub-thread的配置传写入到LCH1的待启动队列。该配置也是选择sub-thread-slot9，会因为当前subthread-slot9有superviosr而被阻塞在NXT口上

Option2：将计算sub-thread的配置参数写入SDMEM，Supervisor可以从param buffer或者private SDMEM中读取到。

- AMOS在获知Kernel信息之后，进行一系列的复杂的准备工作。其中包括如下步骤：

   - 给新的Kernel分配Kernel-slot

   - 给新的Kernel分配KSID

   - 分配VACC寄存器起始位置

   - 分配Parameter buffer

分配Stack Local

选择该kernel需要选择的sub-thread-slot

在合适的时间，使用新分配的KSID对Kernel进行ICache invalidate和ICache prefetch

对新Kernel所需要的共享和私有参数，提前搬运到分配的parameter buffer中

当AMOS认为新kernel可以发射时，将CFG参数写入LCH0的CFG中，并且写LCHTRIG寄存器

如果使用supervisor，则

对于AMOS option1，Supervisor可以向LCH1的POP_NXT写入数值2来将LCH1的NXT POP到LCH0的CFG上，并重新写入LCH0的LCHTRIG

新写入的LCHTRIG中包含supervisor分配的kernel-slot和sub-thread-slot

对于AMOS option2，Supervisor是通过CF store逐一向LCH0的CFG寄存器写入配置，再写入LCH0的LCHTRIG

如果不使用supervisor，则

LCH0的队列允许一组Kernel配置包含总数不超过10个sub-thread

LCHTRIG写入数值为sub-thread需要运行的sub-thread-slot

- 当Kernel配置到达LCH0的NXT时，sub-thread-slot和kernel-slot不冲突时，并且STOP_AUTO_LCH为0状态，硬件将Kernel配置拆分为sub-thread并送到sub-thread-slot的WRK寄存器中

所谓sub-thread-slot不冲突，指选中的sub-thread-slot全部在idle状态，并且没有exception或者RAS Repaire状态残留

- 所谓Exception状态残留，是指该sub-thread-slot的EXCP_STS和EXCP_BIT_EN寄存器上存在对应位置bit均为"1"的情况

- 所谓Repaired状态残留，是指该sub-thread-slot的RAS_REPAIRED_STS和RAS_REPAIRED_BIT_EN寄存器上存在对应位置bit均为"1"的情况

所谓kernel-slot不冲突，指kernel-slot上原先运行的thread全部idle或者关联到新的kernel上

对应NXT寄存器的STOP_AUTO_LCH.STOP域为0

上述三个条件都必须满足，才能进行发射

在硬件启动这个Kernel时，硬件会执行以下步骤：

对于Type1的sub-thread处理如下

硬件使用LCHTRIG_NXT中的配置选择发射的sub-thread数量和对应的sub-thread-slot

对于SUB_THD_ID寄存器，对于[0...i]个sub-thread，写入的数值为SUB_THD_ID_NXT + i。即每个sub-thread依次加1

除了SUB_THD_ID寄存器之外，其余寄存器会直接配置进入WRK寄存器并生效

包括PRAM_WRK寄存器、LCHBA_WRK寄存器等

除此以外，硬件还会做下列工作

   - 将ASID_WRK复制到SPR的DPF_ASID和IPF_ASID

   - 将KSID_WRK复制到SPR的IPF_KSID

   - 将{IMEM_BASE_HI_WRK, IMEM_BASE_LO_WRK}复制到SPR的IPF_ADDR中

- 对于Type3的sub-thread处理如下

硬件使用LCHTRIG_NXT中的配置选择发射的sub-thread数量和对应的sub-thread-slot

- 其中，对于第一个被选中的sub-thread-slot，同Type0/type1的sub-thread发送一模一样，并且记录该sub-threadslot的index

- 对于第二个乃至更多个被选中的sub-thread-slot，硬件并不向它们发射启动信号。而是在内部将第一个sub-threadslot的状态映射给这些sub-thread，通过ALL_THD_STS状态寄存器输出出去

Type3约束需要在Launch上显示占用了所有计算任务会用到sub-thread-slot(0~7)，因此可以安全使用非第一个sub-thread-slot的TAR寄存器

**每个sub-thread启动之后，需要做一些初始化工作：**

- 根据MD*_WRK寄存器传递的Kernel VACC base，SUB_THD_ID和LAUNCH_WRK.THEAD_VACC域，计算本sub-thread 的VACC起始为止，并配置到VAB中

- 根据MD*_WRK寄存器传递的UVA stack地址以及SUB_THD_ID，计算出本sub-thread的remote stack地址，配置到SPR 的STACK_REMOTE寄存器中

关于Sub-thread Launch的细节，请见SIP4.0_Thread_Launch文档。

##### 6.3.3.3. Launch Register Interface

两组Launch Reigister有如下特性：

每一组CFG寄存器有45个寄存器（包括LCHTRIG），以及一个CFG_STS寄存器，指示queue当中还有多少空余entry

   - 每个queue深度为4，和Scorpio一样

- 当LCHTRIG写入为1之后，硬件自动将这组配置复制到launch queue的队尾entry，将CFG_STS的avail数值减去1，并把 LCHTRIG清0

**其余配置参数依然遗留在CFG寄存器上**

Launch queue由硬件管理，类似于一个FIFO，其中队列头部的entry被映射为NXT寄存器组

NXT寄存器组可以下列方式来POP

- 方式一：如果SIP流水线上的空余sub-thread-slot满足当前配置的sub-thread数量，则硬件自动启动流水线sub-threadslot之后，从NXT POP

对于LCH0，是从sub-thread-slot0开始搜索一段连续的sub-thread-slot（不能折回）

对于LCH1，则是固定选择sub-thread-slot9，并且只支持数量1的sub_thread

**方式二：写NXT_POP寄存器**

- 对于LCH1，对NXT_POP写数值1，则直接丢弃NXT寄存器；对NXT_POP写数值2，则将NXT寄存器配置复制到LCH0 的CFG寄存器组后再丢弃

对于LCH0，无论对NXT_POP写数值1或者数值2，都是直接丢弃

##### 6.3.3.4. Launch Thread Slot Selection

本章节是对于Kernel Launch编程者的约束.

- ~~对于Type0的Kernel，必须选择sub-thread-slot-9~~

- 对于Type1的Kernel，如果是启动多个sub-thread，那么推荐选择连续的sub-thread槽，例如

   - Type1 Kernel启动4个sub-thread，可以选择0~3，4~7等等

   - Type1 Kernel启动8个sub-thread，可以选择0~7，

   - 连续的sub-thread可以将这个Kernel的指令调度和计算均匀分配到SIP内部的物理资源上，方便获得高性能

- 对于Type3的Kernel（双VPT Legacy Kernel）必须选择2个sub-thread-slot，并且必须选0~7这8个个sub-thread： Type3允许的sub-thread槽组合

sub-thread-slot：0~7全部配置

- Type3虽然在寄存器配置时选择8个sub-thread-slot，但是实际上硬件只会启动第一个sub-thread-slot的硬件调度器；后继sub-thread-slot在硬件内部是idle的。并且idle的sub-thread-slot中，有一个sub-thread-slot的TAR寄存器会被第一个 sub-thread-slot所使用。此时，软件使用ALL_THD_STS看到的状态则是8个sub-thread槽都进入busy状态，一起工作最后一起halt（实际上后继所有sub-thread-slot复制了第一个sub-thread-slot的状态并且记录到ALL_THD_STS上）。这样可以实现双VPT sub-thread在SIP上的独占所有计算资源。

Supervisor的launch单独占用kernel-slot-2和sub-thread-slot-9，并不和Type3的Kernel重复，因此可以和它并行

关于Sub-thread Launch的细节，请见SIP4.0_Thread_Launch文档。

#### 6.3.4. Thread Resources

在SIP上启动sub-thread前后，每个sub-thread所需要部分资源配置方式如下：

|资源类型|物理数量|配置方式|分配管理|寄存器|
|---|---|---|---|---|
|Thread-Slot|1|Supervisor选择要发射的sub-<br>thread-slot<br>硬件执行完成后自动变成idle|Supervisor<br>or AMOS|CSR: LCHTRIG寄存器的<br>THD_SLOT_TRIG域|
|VPT数量|1 or 2|算子开发时确定sub-<br>threadType<br>使用专用CSR_CFG寄存器传<br>递||CSR: LACUNCH_CFG的<br>THEAD_TYPE域<br>硬件根据该数值决定TAR/VACC的<br>映射|
|KSID|1|AMOS确定是否需要新的KSID<br>Supervisor管理<br>使用专用CSR_CFG寄存器传<br>递|Supervisor<br>or AMOS|CSR: KSID_CFG寄存器|
|Kernel-slot|1|Supervisor管理<br>使用专用CSR_CFG寄存器传<br>递|Supervisor<br>or AMOS|CSR: LCHTRIG寄存器的KNL_SLOT<br>域|
||||||
|Kernel代码|0~4GB|算子开发确定程序段<br>软件在发射前确定其在UVA空<br>间位置<br>使用专用CSR_CFG寄存器传<br>递<br>启动时硬件自动设置并从PC<br>位置启动||CSR: LCHBA_CFG<br>CSR: IMEM_BASE_LO_CFG<br>CSR: IMEM_BASE_HI_CFG|
|Private VDMEM|0~896KB|Driver划分，SIP Halt时配置<br>CSR||CSR: XPU_SCRATCH0<br>分配颗粒度1KB|
|Shared Non-<br>Affinity Buffer|0~7MB|Driver划分，SIP Halt时配置<br>CSR||CSR: XPU_SCRATCH0<br>分配颗粒度1KB|
|Shared Affinity<br>Buffer|0~7MB|Driver划分，SIP Halt时配置<br>CSR||CSR: XPU_SCRATCH0<br>分配颗粒度1KB|
|Parameter Buffer|0~128KB|算子开发时确定需求<br>Supervisor动态分配<br>使用专用CSR_CFG寄存器传<br>递<br>启动时硬件自动设置|Supervisor<br>or AMOS|CSR: PARAM_CFG寄存器|
|Stack Local|0~128KB|算子开发时确定需求<br>Supervisor动态分配<br>使用通用参数寄存器传递<br>sub-thread启动后自行设置<br>SPR寄存器||SPR: STACK_LOCAL<br>每个sub-thread自行配置|
|Stack Remote|max<br>15.5MB|软件预先在UVA上分配好<br>使用通用参数寄存器传递<br>sub-thread启动后自行设置<br>SPR寄存器||SPR: STACK_REMOTE<br>每个sub-thread自行配置|
|Global|N/A|软件预先分配ASID<br>使用专用CSR_CFG寄存器传<br>递<br>启动时硬件自动设置ASID寄<br>存器||CSR: ASID_CFG寄存器|
|SR寄存器|32|和Thread-slot固定关联<br>Launch时自动分配|||
|SPR寄存器|256|和Thread-slot固定关联<br>Launch时自动分配|||
|TAR寄存器|32 or 64|单VPT时和Thread-slot固定关<br>联<br>双VPT时使用间隔为2的两个<br>sub-thread-slot的TAR|||
|VACC寄存器|单VPT:<br>0~6144|算子开发时确定需求<br>Supervisor以kernel为单位计<br>算并分配VAB<br>并且通过通用的MD_CFG寄存<br>器传递|Supervisor<br>or AMOS|最小分配颗粒度4 OACCC<br>sub_thread自行计算具体sub-<br>thread的VAB并配置|

#### 6.3.5. Thread Halt & SIP Halt

每个启动的sub-threadHalt的原因包括如下：

- 执行了Halt指令

   - 此时只有该sub-thread的资源被释放（slot & VACC），其他sub-thread不受到影响

- 触发了Error Exception

自动halt，并且通过SA上报Error Interrupt，同时释放L0寄存器资源

- 被Debugger执行STEP_HALT命令中止

只有所有sub-thread都进入Halt状态，整个SIP才进入Halt状态

#### 6.3.6. SPR Constraints in Mult-Thread Programming

请见Libra SIP SPR Spec的第8章节SPR Usage Constraint部分

#### 6.3.7. Process Force Quit for Sub-Thread

这里的Process Force Quite，指的是SIP4.0中增加的“强杀”功能。该功能指用户在4.0的集群上运行，利用Ctrl+C或者类似的方法， 中止一个特定进程的过程。这是以个软硬件复合的feature。软件需要解决例如强杀之后释放被这个进程占用的资源（例如 L3/L1/mailbox）等一系列的问题。而SIP硬件侧需要利用Multi-thread的Launch状态机，以及HW Debugger的相关功能，作为该功能的硬件基础。

##### 6.3.7.1. Force Quit Flow

SIP侧的sub-thread强制停止功能，预期由AMOS来完成。它需要使用下列的步骤进行：

1. 在Supervisor启用情况下，AMOS通知Supervior，使得supervisor中止当前正在进行的Kernel-slot的配置

   1. 如果当前正在配置的Kernel-Slot符合被强制停止的进程ID，则之后supervisor会放弃掉这次的发射

2. 停止SIP 两个Launch Queue的自动发射功能

   1. 向两个AUTO_STOP_LAUNCH寄存器写1，并轮询XPU_SCRATCH寄存器，直到两个状态机全部进入check状态

3. 使用HW Debugger功能，暂停sub-thread-slot0~9，并且选择杀灭其中吻合进程ID的sub-thread

   1. 先使用STOP命令使得sub-thread进入debug mode，然后用Force+STEP_DCMD+STEP_HALT强制停止符合进程ID的那些sub-thread，并恢复所有0~9 sub-thread-slot到正常状态

   2. 其中的原理步骤，可参加Programming Guide for HW Debugger章节

4. 依次处理两个Launch Queue，将每个launch queue当中待发射任务中吻合进程ID的任务给去除

   1. 读取一个queue的CFG系列寄存器并记录

   2. 使用读取CSR和NXT_POP功能，将该launch queue内的任务配置依次从queue中读取到本地

   3. 判断这些任务配置，将不属于强制停止范围的任务，再次通过CFG系列寄存器，按照原顺序依次送入到launch queue当中

   4. 最后恢复初始的CFG配置。但是如果原始CFG配置是一个有效的任务配置（LCHTRIG.THD_SLOT_TRIG不为0），并且它也属于被强制停止范围内的任务，则不配置LCHTRIG寄存器

5. 重新使能两个Launch Queue的自动发射功能

   1. 向两个AUTO_STOP_LAUNCH寄存器写0

6. 杀灭完成后，AMOS需要确保被强制停止的sub-thread的下述资源得到释放

   1. Mailbox

   2. Stack Local/Parameter/OACC，都是由分配着释放

      1. 如果由supervisor分配，则需要supervisor释放

   3. Stack Remote

   4. HW sync

   5. DTE VC

上述流程的2~5的相关寄存器和伪代码，请见Libra_SIP_Programming_Guideline相应章节

### 6.4. SIP Thread Launch Detail

请见SIP4.0_Thread_Launch文档

### 6.5. SIP Instruction Cache

#### 6.5.1. 版本历史

|Version|Date|Author|Note|
|---|---|---|---|
|v0.1|Jun. 3rd, 2023|Devin Zhu<br>Yuanzhi Hua|由Scorpio ICache方案生成Libra ICache方案|
|v0.2|Jul. 10th, 2023|Yuanzhi Hua|根据Review反馈更新ICache设计|
|v0.3|Aug. 1st, 2023|Yuanzhi Hua|根据Exception要求修改ICache TAG域描述|
|v0.4|Apr. 1, 2024|Yuanzhi Hua|根据FCR defeature，L1 ICache减少到160KB|

#### 6.5.2. 背景和设计原则

##### 6.5.2.1. 背景需求

1. 指令Cache能够支持同一个进程或者不同进程的多个Kernel的指令并存

   1. 支持软件能够方便快速的invalidate过去某个kernel在指令Cache里的残余代码

   2. 支持AMOS 能够方便快速的invalidate整个L1 instruction Cache里的非supervisor部分和supervisor部分

   3. 单个Kernel对其依赖的库不用支持动态链接库调用方式，仍然假设单个kernel在编译期已经将其所需要的库静态链接完整。

   4. 单个Kernel链接和加载时，其指令Text段和其他数据段（包括rodata段）是分割独立加载的。并且不静态假设其Text段和数据段的相对位置。

   5. 单个Kernel reference其data variable时，使用类似GOT的机制，而其类似GOT 数据结构本身也在data section里，被 Kernel的input parameter中的参数指定其位置（或者静态约定）。

   6. 基于上述假设，单个Kernel的instruction 部分单独放一个address space也是OK的。同时需求上需要注意，目前假设 instruction cache不支持cache一致性。

   7. 需要支持驱动可以把该kernel代码放置在该软件进程能够访问到的L3的地址，然后被多次调用。这里有2个选项

      1. 选项1：单个Kernel编译时，仍然是编译为位置无关代码。这样每次 launch的PC就是最终这段代码被load到L3的位置。

      2. 选项2：单个Kernel编译时，编译link到一个静态PC代码，然后因为Text段和其他所有段的地址空间都是独立的，所以，此时launch的PC就是link时选定的PC地址，launch的时候给定一个L3的instruction base地址。

      3. 我们选用选项2，所以软件栈可以不支持PIC里的PLT。

2. Libra SIP中，由于面积原因不再包含Page Based MMU。VA到IPA的转换统一由EDF上的PBMMU进行。因此ICache无法像 Scorpio这样支持IPA的访存，只能支持VA访存。

   1. 此时ICache需要和memory subsystem一样，支持ASID来索引PTE

3. Libra SIP中，由于面积原因不再包含独立的SDTE进行fetch/prefetch操作，因此ICache需要独立进行miss fetch和prefetch操作

4. 为了满足性能需求，ICache依然需要支持SW prefetch和HW prefetch，包括跨进程的prefetch

##### 6.5.2.2. ICache特性

对于上述需求，Libra SIP采用下述的ICache解决方案。

32bit的指令地址域

对于每个sub-thread，使用32bit的PC

- 新的Cache容量和Cache line容量

总容量160KB

总共20个Cache line，单个Cache line为8KB

每个Cache line存放512个指令包

全相联cache line

采用虚拟地址mapping

VA = PC + IMEM_BASE

VA预期映射到UVA空间或者Direct IPA Region空间

详见Linear PC-to-VA mapping

VIVT

- 每个Cache line都保存了一个ASID（用于区分不同的进程）、KSID（用于区分在同一地址空间执行不同任务的 kernal）、IMEM_BASE和虚拟virtual_tag段

地址比较时，同时比较ASID、KSID、IMEM_BASE和virtual tag，只有四者同时匹配时视为cache hit

IMEM_BASE和virtual tag各自比较，是出于优化微架构timing的考虑

**支持Invalidate操作**

- 场景一：Supervisor对于待发射Kernel，对它可能miss hit的cache line使用ITAGOP指令进行基于KSID+ASID的 invalidate操作

该操作是为了支持后继的IDMA prefetch操作，是场景二基于性能需求的延伸

场景二：Kernel Launch时基于KSID+ASID的Invalidate操作

- 该Invalidate操作是launch时硬件自动执行

该操作是为了支持不同Kernel之间代码动态加载的功能，以及ASID重绑定的场景

- 场景三：在SIP Idle或者DBG mode(所有sub-thread都STOP)情况下的使用CSR进行Invalidate操作

该操作是为了支持HW Debugger动态修改指令

**支持预取**

**支持软件预取指令IDMA**

**跨进程预取通过IDMA指令语义调整实现**

**支持硬件预取机制**

**支持基于指令的条件invalidate操作**

基于ITAGOP指令的invalidate操作，KSID+ASID作为匹配条件

   - 支持跨kernel和跨进程进行invalidate操作

- 支持基于sub-thread启动时的条件Invalidate操作

   - 基于Launch的硬件自动invalidate，KSID+ASID作为匹配条件

为了支持不同Kernel之间代码动态加载的功能

支持Cache line的lock/unlock操作

可以使用ITAGOP进行lock/unlock操作，也可以使用CSR进行lock/unlock操作

- 支持基于CSR的Invalidate操作

- 支持独立AXI接口的EDF访问能力

   - 支持512 Outstanding

   - 支持乱序返回

- 放弃SDTE主动写入ICache的功能

   - 由于ICache较为成熟，并且不再有SDTE，因此放弃对这个功能的支持

#### 6.5.3. Linear PC-to-VA  mapping

如下图所示，预期中SIP Code作为一个大的image 一起编译链接，整体连续的存储在L3。SIP新增2个SPR定义对SIP而言基于 Region-Based-MMU映射的Virtual Address。 SIP指令PC表达的是SIP 自己的程序虚拟地址空间，其映射关系就是

```text
IMEM_BASE = {IMEM_BASE_HI, IMEM_BASE_LO} & 0xFFFF_FFFF_E000;
RBMMU VA = PC + IMEM_BASE;
IPA = PBMMU(ASID, VA);
```

此处的 `VA` 送入 `Region-Based-MMU` 映射的 `VA` 地址，它至少时是 `8KB` 对齐的。

此处的地址对齐，需要由软件进行保证。

即通过一个段偏移寄存器，将0~4GB的PC区域映射到大于8GB的空间。而这个段偏移寄存器又被称为Inst RBMMU。Inst RBMMU 为SIP上每个sub-thread都独立的资源，在sub-thread发射时配置IMEM_BASE_HI_CFG和IMEM_BASE_LO_CFG获得。

对于计算kernel，预期映射到8GB~4TB的IPA空间

- 对于supervisor，由于它并不和CPU上的进程关联，所以预期映射到Direct IPA Region

Note: AMOS必须保证这段偏移地址映射到大于8GB的地址，否则ICache会运行错误，结果不可知

注意，上述描述中的VA、PC都是SIP自己的地址空间角度而言的，与host 看DTU target的地址空间映射没有关系

![图 024](libra_sip_arch_spec__figure_024.png)

#### 6.5.4. VIVT L1 cache

##### 6.5.4.1. 基本结构

Libra ICache包含24个cache block 或者cache line，每个block 8KB（支持512条指令）。由于block较少，所以可以采用全相联结构。

每个Cache block中，采用了VIVT的形式。其中TAG部分包含如下信息：

4bit ASID

每个sub-thread所对应的进程会记录一个4bit的ASID。

该ID由Driver分配，并通过AMOS作为kernel launch参数（透过supervisor）间接传递给启动的CFG寄存器

- 6bit KSID (Kernel SIP ID)

   - 分配到SIP上的每一个Kernel，都会关联一个Kernel SIP ID。它并不是kernel本身的index，而是这个Kernel在当前SIP上有效时关联的一个ID

SIP引入该Kernel，是为了解决同一进程不同Kernel之间由于算子库动态更新而引入的一致性问题

- 该ID由supervisor完成分配和释放。AMOS负责提供信息决定当前Kernel是否可以和之前的Kernel复用指令代码，然后 supervisor负责决定是否分配一个新的KSID并进行相应的invalid操作

   - 如果指令代码没有动态更新，则superviosr可以对新kernel分配和上一个kernel相同的KSID，减少指令的fetch动作。

**如果需要选择一个新的KSID，supervisor必须选择一个当前正在工作sub-thread都没有使用的KSID，并根据情况做指令的invalidate+prefetch，或者Kernel Launch invalidate**

关于这里的invalid操作，详见下文。

29bit Virtual TAG

该域即该sub-thread取指时的PC[31:13]

VLD域

1bit valid，表征当前的cache line是否有效

PND域

1bit pending，表征当前cache line已经被分配，但是传输尚未完成

当pend域为1时，valid域应该始终为0

LOCK域

1bit lock域，表征当前cache line不能被替换

只有valid域为1时有效。valid==0时被忽略

RAS_ERR域

1bit RAS error域，表征当前的cache line取回时，是否存在总线的RAS Error

RESP_ERR域

1bit RESP error域，表征当前的cache line取回时，是否存在总线的Response Error

当sub-thread取指，或者软件/硬件预取执行检查当前cache line时，下面的情况被视为命中(hit)而不需要触发总线上的取指过程：

Cache line的VLD域为1，或者PEND域为1

- ASID域一致

- KSID域一致

- IMEM_BASE一致

VTAG域(和PC)一致

**Note** ：基于背景需求的假设，实际上会由多个Kernel单独编译链接，最后顺序存放在一个进程的代码段中。这些Kernel的BASE不同，但是共享ASID和KSID，并且PC都是从0开始（或者相同位置开始）。如果没有IMEM_BASE也作为Cache查询条件，可能会造成 fake hit的功能问题

在ICache出现取指失效，或者触发软件指令预取或者硬件指令预取时，会按照LRU算法(或PLRU算法)挑选一个victim block。这个 victim block不会是一个被lock的cache block。然后记录所有的TAG域，并根据地址发起一组AXI读请求。数据传输过程中，该 block属于pending状态。传输完成后，该block被设置为valid状态，并且根据总线传输情况记录ERR域。

Tag Table

![图 025](libra_sip_arch_spec__figure_025.png)

##### 6.5.4.2. SW Prefetch

为了提升kernel执行性能，减少取指失效带来的额外开销，Libra SIP ICache支持基于指令触发的SW prefetch，并且该perfetch支持跨进程和跨Kernel执行。

- 实际上，Libra SIP预期由Supervisor来执行SW prefetch，并且需要通过一定的同步机制获得当前sub-thread的进度，用来确定触发prefetch的合适时间，避免ICache颠簸

Libra SIP是通过ISA4.0的IDMA指令来实现的。ISA4.0 IDMA指令和ISA3.2类似，其行为如下：

- 如果是使用新的KSID的Kernel，预取之前先通过ITAGOP做invalidate的操作

- 通过指令Rs1域，获取需要预取的32bit PC地址SR[Rs1][31:0]

- 通过IPF_BASE，获得被预取指令的base address

   - 由于需要支持跨进程预取，因此IDMA指令的BASE不是自身的IMEM_BASE，而是SPR寄存器IPF_BASE

   - IPF_BASE在sub-thread发射的时候，被硬件逻辑复制为当前sub-thread的IMEM_BASE，并可以通过MOVSR2SPR修改

- 通过IPF_ASID，获得被预取指令的PTE关系

   - IPF_ASID在sub-thread发射的时候，被硬件逻辑复制为当前sub-thread的ASID，并可以通过MOVSR2SPR修改

- 通过IPF_KSID，获得被预取指令所对应kernel的KSID

IPF_KSID在sub-thread发射的时候，被硬件逻辑复制为当前sub-thread的KSID，并可以通过MOVSR2SPR修改

请注意，IDMA指令是一个用于性能提升的投机性指令，可能由于一些原因而放弃执行，此时ICache不会报告问题。例如

- 所有block都处于lock状态

##### 6.5.4.3. HW Prefetch

为了提升kernel执行性能，减少取指失效带来的额外开销，Libra SIP ICache支持基于取指行为触发的HW prefetch。该功能和 Scorpio SIP一致。其中HW prefetch仅支持当前sub-thread，不支持跨kernel或者跨进程预取

ICache开启HW prefetch功能后，每个sub-thread在取指时，都会在命中Cache line时，检查从本Cache line之后的若干个Cache line是否命中。如果没有，则触发对应的prefetch。其中检查的范围可以设置为1~3。

HW prefetch是一个投机行为，有可能prefetch失败。由于它没有软件perfetch这样的强语义，因此不会带来额外的exception类型

##### 6.5.4.4. Invalidate Operation

Libra SIP ICache支持三种形式的Invalidate操作。所有的Invalidate操作对于L1 ICache和可能存在的L0 ICache同时有效。

第一种Invalidate操作为sub-thread在发射时的Invalid操作，主要服务于进程切换或者同一进程不同kernel时的算子库动态加载。

在sub-thread启动时，invalidate当前Cache line中，和当前正在启动sub-thread的ASID/KSID同时匹配的cache line

**其原理如下：**

- 假设通一个进程下有1000个kernel会被分配到相同/不相同的SIP中，它们的BASE总是相同，并且它们之间存在算子库动态加载的情况

Supervisor在接收到AMOS的信息之后，反复分配64个KSID

   - 如果前后kernel之间指令可以复用，那么使用相同的KSID。否则选择一个当前活跃sub-thread都没有使用的KSID

- 由于一开始的64个不能复用指令的Kernel拥有不同的KSID，因此它们的cache line不会复用。

- 当最初的kernel 0执行完成，SIP launch新的kernel 0时，需要设置LAUNCH_CFG寄存器中的INVALID_ICACHE域

   - 该域在SIP3.0上就存在，Libra SIP中被定义为只invalid相同KSID的cache line

   - 实际上，最开始的KSID0~63的kernel在launch时，也设置这个域。

sub-thread必须在invalid操作完成后才能启动。

通过这个方法，保证了sub-thread启动后能够重新读取被动态加载的指令

**软件必须保证，在替换动态算子库时，之前使用旧算子库的kernel已经执行完成，避免一致性问题**

第二种Invalidate操作为Supervisor通过ITAGOP指令的Invalid操作，同样是服务于进程切换或者同一进程不同kernel时的算子库动态加载

- ITAGOP指令使用当前的IPF_ASID和IPF_KSID域，对所有对应cache line进行invalidate操作，包括被Lock的cache line。发射指令后阻塞执行这条指令的sub-thread，直到操作完成

**执行这个操作的sub-thread(例如Supervisor)必须保证，进行Invalidate操作的KSID并不属于任何一个当前正在执行的subthread**

其原理上上述的Launch Invalidate相同，在supervisor分配新KSID之后，进行ICache prefetch之前，需要增加这个操作

第三种Invalidate操作为通过CSR寄存器进行的Invalidate操作。有如下特性：

**只能在整个SIP为halt，或者SIP上所有sub-thread都处于debug mode情况下操作**

对于debug mode操作，invalidate无法消除当前已经处于decode stage的指令

只针对所有的Cache line，包括可能存在的L0 Cache line

Note：对于出于Pending或者Lock状态的Cache line，上述的三种Invalid操作均能起效。所以在Debug mode下如果选择invalid所有cache line，那么需要在恢复到正常模式前重新锁定之前锁定过的cache line（比如supervisor的cache line），避免性能出现问题

##### 6.5.4.5. Lock/Unlock Operation

Libra SIP ICache只支持基于ITAGOP指令的lock/unlock操作。该指令支持基于虚拟地址VA的lock/unlock

- 该指令使用ITAGOP指令的Rs1传递PC地址，使用imm-7传递操作类型

- 该指令复用IPF_BASE/IPF_ASID/IPF_KSID进行Cache line查找

##### 6.5.4.6. ITAGOP指令

该指令是ICache操作指令，用于对Cache line做lock/unlock/invalidate操作。特性包括：

- 支持虚拟地址寻找cache line

- 支持cache line lock/unlock操作

   - 注意：ITAGOP无法对跨kernel预取获得的cache line，用基于虚拟地址的方式做lock/unlock操作

- Invalidate操作基于当前sub-thread的IPF_ASID、IPF_KSID和IPF_ADDR寄存器

详细情况请见Libra ISA的ITAGOP指令说明

#### 6.5.5. ICache Access EDF

由于Libra SIP中SDTE被移除，因此无论是取指失效还是各种指令预取，均是通过ICache新增总线访问单元通过一个独立的AXI读总线来访问EDF进行取指操作。

ICache的总线访问单元有如下特性：

- 以cache line的颗粒度接收ICache单元的请求，并转换为一系列128B颗粒度的AXI读请求

- 最大可以接受24个cache line的读请求，并且将其中8个转换后发射到总线上

- 最大支持512个outstanding

对于所有发射的128B AXI请求，始终分配不同的arid，并支持out-of-order返回

- 返回时利用ICache本身作为reorder buffer

自动检测read response的error以及返回数据的parity，并将检查结果记录到cache line的ERR域

   - 并不立即报告exception

- 发射AXI请求时，对应的AXI field如下：

   - Ar_usr[15:0]：来源于SA0和低位tie-off的配置

   - Ar_usr[19:16]：该ASID等同于最终写入Cache line的ASID

   - Ar_usr[26:25]：0x1

   - Ar_usr[29]：0x0

   - Ar_usr[30]：0x0

   - ArCache：0x0

   - ArProt：0x6

   - ArLock：0x0

   - ArQos：来源于CSR寄存器

   - ArRegin：0x0

#### 6.5.6. CSR 对Feature的控制

|Register Name: ICACHE_CTRL|Register Name: ICACHE_CTRL|Register Name: ICACHE_CTRL|Register Name: ICACHE_CTRL|Register Name: ICACHE_CTRL|
|---|---|---|---|---|
|Offset Address: 0xD40|||||
|Field|Bit|Reset<br>Value|RW|Description|
|IMEM_PREFETCH_BLK|19:16|0|RWHW|Only meanningful when IMEM_CACHE_EN=1 &&<br>IMEM_VA_EN=1 && IMEM_MISS_FETCH_EN=1.<br>If current PC's cacheline block is hit, no exception hit, and<br>current instruction is not an IDMA instruction, while near<br>future cacheline blocks are missing, then HW will<br>automatically issue a DMA request to prefetch the nearest<br>missing block after current PC. The scope of 'near future<br>cacheline blocks's is determined by IMEM_PREFETCH_BLK.<br>If IMEM_PREFETCH_BLK=0, then the prefetch mechanism is<br>disabled. If IMEM_PREFETCH_CLK=1, then HW will check<br>and prefetch for next block. The leagal value is 0~total<br>cacheline block number-1.<br>Caution: currently, SIP 2.1 doesn't not support all<br>comibinations in this register ICACHE_CTRL. Please refer to<br>IP Architecture document for the supported scope.<br>This register could only be written when SIP is in HALT<br>state.|
|IMEM_DMA_INS_EN|3:3|0|RWHW|If IMEM_CACHE_EN=0 or IMEM_DMA_INS_EN=0, IDMA<br>instruction will be treated as NOP; otherwise IDMA<br>instruction will be executed as normal.<br>Caution: currently, SIP 2.1 doesn't not support all<br>comibinations in this register ICACHE_CTRL. Please refer to<br>IP Architecture document for the supported scope.<br>This register could only be written when SIP is in HALT<br>state.|
|IMEM_MISS_FETCH_EN|2:2|0|RWHW|Only meaningful when IMEM_CACHE_EN=1 &&<br>IMEM_VA_EN=1.<br>If IMEM_MISS_FETCH_EN=0, then HW will not fetch a<br>cacheline upon its miss. Instead, HW will enter exception<br>handler and let SW to handle the miss.<br>If IMEM_MISS_FETCH_EN=1, then HW will automatically<br>fetch the missed block upon its miss.<br>Caution: currently, SIP 2.1 doesn't not support all<br>comibinations in this register ICACHE_CTRL. Please refer to<br>IP Architecture document for the supported scope.<br>This register could only be written when SIP is in HALT<br>state.|
|IMEM_VA_EN|1:1|0|RWHW|Only meaningful when IMEM_CACHE_EN=1.<br>If IMEM_VA_EN=0, there is no address translation in tag<br>table and there is no tag miss. There is still VLD/PND status<br>in tag table.<br>Cache is working in physical mode and all cache line blocks<br>are valid after reset. It will be marked as PND when there<br>is a IDMA operation triggered, and become VLD after DMA<br>transaction done.<br>If IMEM_VA_EN=1, tag table has address translation and it<br>is possbile that a virtual address being missed, then all<br>cache lines are invalid after reset.<br>Caution: currently, SIP 2.1 doesn't not support all<br>comibinations in this register ICACHE_CTRL. Please refer to<br>IP Architecture document for the supported scope.<br>This register could only be written when SIP is in HALT<br>state.|
|IMEM_CACHE_EN|0:0|0|RWHW|0: Instruction Cache is disabled.<br>1: Instruction Cache is enabled.<br>Caution: currently, SIP 2.1 doesn't not support all<br>comibinations in this register ICACHE_CTRL. Please refer to<br>IP Architecture document for the supported scope.<br>This register could only be written when SIP is in HALT<br>state.|

**使用模式的可能性**

1. IMEM_CACHE_EN=0：legacy 模式，软件无法实现指令加载和数据的pipeline；IMEM 也不支持ping-pong buffer模式。

2. IMEM_CACHE_EN=1 && IMEM_VA_EN=0 && IMEM_MISS_FETCH_EN=0： instruction 地址空间限制为IMEM 大小，软件用 overlay方式link所有程序，软件自己管理指令block。

3. IMEM_CACHE_EN=1 && IMEM_VA_EN=1 && IMEM_MISS_FETCH_EN=0： instruction有大的地址空间，但是HW prefetch 被disable，如果miss 了只会起exception （精确异常）。对应于软件自己管理代码加载，软件可以使用IDMA指令提前加载， 也可以在exception handler里面miss了再加载。

4. IMEM_CACHE_EN=1 && IMEM_VA_EN=1 && IMEM_MISS_FETCH_EN=1 && IMEM_PREFETCH_BLK=0：HW只有miss了才取值，没有预取。

5. IMEM_CACHE_EN=1 && IMEM_VA_EN=1 && IMEM_MISS_FETCH_EN=1 && IMEM_PREFETCH_BLK!=0：硬件预取功能开启，cache功能全开启。

Libra SIP预期sign-off的ICache使用模式

模式5，IMEM_CACHE_EN=1 && IMEM_VA_EN=1 && IMEM_MISS_FETCH_EN=1 && IMEM_PREFETCH_BLK!=0 && IMEM_DMA_INS_EN=1。即开启ICache所有功能，包括软件预取和硬件预取

#### 6.5.7. ICache Exception Type

在IMEM_CACHE_EN=1时，指令block 的status随着指令一起被检测，其中会有下列新的精确异常。如果IMEM_CACHE_EN=0，这些异常会被忽略。

block error （总是被检测）

当前PC的block有error + 该异常是disabled ，那么忽略该error

当前PC的block有error + 该异常是enable，那么进入异常handler

instruction miss /victim error

- IMEM_VA_EN=1， 当前PC的block 是miss + IMEM_VA_EN=1 + IMEM_MISS_FETCH_EN=0，进入异常handler （该异常不能被disable）

- IMEM_VA_EN=1， 当前PC的block 是miss + IMEM_VA_EN=1 + IMEM_MISS_FETCH_EN=1 + 所有block都被lock住（没有空余的victim block），进入异常handler（该异常不能被disable）

- IMEM_VA_EN=1， 当前PC是个IDMA指令取1个block，软件要求硬件选victim，但是所有block都已经被lock住 ，或者软件要求选victim但是它选的cache line block是lock的，进入异常handler（该异常不能被disable）

- IMEM_VA_EN=1， 当前PC是个IDMA指令取1个block，软件要求软件选victim且该victim就是IDMA指令所在的block，不进入异常handler，不flush流水线，正常的执行该IDMA指令。流水线里可能已经取进来同一个block的其他指令，此时仍然视之为有效指令（基于指令只读且软件没有显示INVALIDATE）。

- IMEM_VA_EN=0， 当前PC是个IDMA指令取1个block，软件要求软件选victim且该victim就是IDMA指令所在的block，进入异常handler（该异常不能被disable）。

下面的情况不会视为异常，操作会被视为NOP，用以避免因为系统运行时不稳定的时序造成同一段代码不稳定的遇到异常。

- 如果1个Virtual address block在tag-table里面已经是pending或者vld，但是软件依然发出了IDMA指令或者依然遇到了HW预取请求，那么该DMA request会被视为NOP，不会发给DMA

软件用ITAGOP对一个tag-table里不存在的block （VLD=0 and PND=0)进行lock/unlock/invalidate操作

- 软件用ITAGOP对一个已经lock的block 进行再次lock

- 软件用ITAGOP对一个已经unlock的block 进行再次unlock

#### 6.5.8. Register

##### 6.5.8.1. ICACHE_CTRL

This register should not be written when SIP is running, also changing this register means SW may need to re-initializing the tag table.

|Register Name: ICACHE_CTRL|Register Name: ICACHE_CTRL|Register Name: ICACHE_CTRL|Register Name: ICACHE_CTRL|Register Name: ICACHE_CTRL|
|---|---|---|---|---|
|Offset Address: 0xD40|||||
|Field|Bit|Reset<br>Value|RW|Description|
|IMEM_PREFETCH_BLK|19:16|0|RWHW|Only meanningful when IMEM_CACHE_EN=1 &&<br>IMEM_VA_EN=1 && IMEM_MISS_FETCH_EN=1.<br>If current PC's cacheline block is hit, no exception hit, and<br>current instruction is not an IDMA instruction, while near<br>future cacheline blocks are missing, then HW will<br>automatically issue a DMA request to prefetch the nearest<br>missing block after current PC. The scope of 'near future<br>cacheline blocks's is determined by IMEM_PREFETCH_BLK.<br>If IMEM_PREFETCH_BLK=0, then the prefetch mechanism is<br>disabled. If IMEM_PREFETCH_CLK=1, then HW will check<br>and prefetch for next block. The leagal value is 0~total<br>cacheline block number-1.<br>Caution: currently, SIP 2.1 doesn't not support all<br>comibinations in this register ICACHE_CTRL. Please refer to<br>IP Architecture document for the supported scope.<br>This register could only be written when SIP is in HALT<br>state.|
|IMEM_DMA_INS_EN|3:3|0|RWHW|If IMEM_CACHE_EN=0 or IMEM_DMA_INS_EN=0, IDMA<br>instruction will be treated as NOP; otherwise IDMA<br>instruction will be executed as normal.<br>Caution: currently, SIP 2.1 doesn't not support all<br>comibinations in this register ICACHE_CTRL. Please refer to<br>IP Architecture document for the supported scope.<br>This register could only be written when SIP is in HALT<br>state.|
|IMEM_MISS_FETCH_EN|2:2|0|RWHW|Only meaningful when IMEM_CACHE_EN=1 &&<br>IMEM_VA_EN=1.<br>If IMEM_MISS_FETCH_EN=0, then HW will not fetch a<br>cacheline upon its miss. Instead, HW will enter exception<br>handler and let SW to handle the miss.<br>If IMEM_MISS_FETCH_EN=1, then HW will automatically<br>fetch the missed block upon its miss.<br>Caution: currently, SIP 2.1 doesn't not support all<br>comibinations in this register ICACHE_CTRL. Please refer to<br>IP Architecture document for the supported scope.<br>This register could only be written when SIP is in HALT<br>state.|
|IMEM_VA_EN|1:1|0|RWHW|Only meaningful when IMEM_CACHE_EN=1.<br>If IMEM_VA_EN=0, there is no address translation in tag<br>table and there is no tag miss. There is still VLD/PND status<br>in tag table.<br>Cache is working in physical mode and all cache line blocks<br>are valid after reset. It will be marked as PND when there<br>is a IDMA operation triggered, and become VLD after DMA<br>transaction done.<br>If IMEM_VA_EN=1, tag table has address translation and it<br>is possbile that a virtual address being missed, then all<br>cache lines are invalid after reset.<br>Caution: currently, SIP 2.1 doesn't not support all<br>comibinations in this register ICACHE_CTRL. Please refer to<br>IP Architecture document for the supported scope.<br>This register could only be written when SIP is in HALT<br>state.|
|IMEM_CACHE_EN|0:0|0|RWHW|0: Instruction Cache is disabled.<br>1: Instruction Cache is enabled.<br>Caution: currently, SIP 2.1 doesn't not support all<br>comibinations in this register ICACHE_CTRL. Please refer to<br>IP Architecture document for the supported scope.<br>This register could only be written when SIP is in HALT<br>state.|

**Note** : Libra SIP ICache只支持如下几种配置：**打开ICache并且打开硬件预取**

- IMEM_CACHE_EN == 1

- IMEM_VA_EN == 1

- IMEM_MISS_FETCH_EN == 1

- IMEM_DMA_INS_EN == 1

- IMEM_PREFETCH_BLK > 0

##### 6.5.8.2. IMEM_TAG_INVALID

|Register Name: IMEM_TAG_INVALID|Register Name: IMEM_TAG_INVALID|Register Name: IMEM_TAG_INVALID|Register Name: IMEM_TAG_INVALID|Register Name: IMEM_TAG_INVALID|
|---|---|---|---|---|
|Offset Address: 0xD08|||||
|Field|Bit|Reset<br>Value|RW|Description|
|INVALID_START|0:0|0|RWHW|Set by SW and clean by HW.<br>Read "0" means no inflight invaldate operation. Read "1" means<br>there is an inflight invalidate operation.<br>Write 1 to this bit to start invalidate all L1 and L0 Inst Cache lines.<br>Then SW should poll this field until it turns is "0".|

在Invalid所有的cache line时，需要遵循下述步骤：

- 向INVALID_START域写1

写完之后INVALID_START会变成1

持续polling这个寄存器，直到INVALID_START变成0

##### 6.5.8.3. IMEM_TAG_RIDX

|Register Name: IMEM_TAG_RIDX|Register Name: IMEM_TAG_RIDX|Register Name: IMEM_TAG_RIDX|Register Name: IMEM_TAG_RIDX|Register Name: IMEM_TAG_RIDX|
|---|---|---|---|---|
|Offset Address: 0xD0C|||||
|Field|Bit|Reset<br>Value|RW|Description|
|TAG_RIDX_DATA|4:0|0|RWHW|Cacheline index when used to read cache line tag table status (SW<br>can read it anytime). SW should firstly write ICACHE_TAG_RIDX,<br>then read ICACHE_TAG_RDATA|

##### 6.5.8.4. IMEM_TAG_RDATA0~3

|Register Name: IMEM_TAG_RDATA0|Register Name: IMEM_TAG_RDATA0|Register Name: IMEM_TAG_RDATA0|Register Name: IMEM_TAG_RDATA0|Register Name: IMEM_TAG_RDATA0|
|---|---|---|---|---|
|Offset Address: 0xD10|||||
|Field|Bit|Reset<br>Value|RW|Description|
|KSID|17:12|0|RO|The KSID of current cacheline|
|ASID|11:8|0|RO|The ASID of current cacheline|
|RESP_ERR|4:4|0|RO|Bus response error when loading this cache line from memory. The<br>cache line is specified by IMEM_TAG_RIDX.|
|RAS_ERR|3:3|0|RO|Bus RAS error or slave RAS error when loading this cache line from<br>memory. The cache line is specified by IMEM_TAG_RIDX.|
|LOCK|2:2|0|RO|LOCK value read from the cache line specified by IMEM_TAG_RIDX.|
|PND|1:1|0|RO|PND value read from the cache line specified by IMEM_TAG_RIDX.|
|VLD|0:0|0|RO|VLD value read from the cache line specified by IMEM_TAG_RIDX.|

|Register Name: IMEM_TAG_RDATA1|Register Name: IMEM_TAG_RDATA1|Register Name: IMEM_TAG_RDATA1|Register Name: IMEM_TAG_RDATA1|Register Name: IMEM_TAG_RDATA1|
|---|---|---|---|---|
|Offset Address: 0xD14|||||
|Field|Bit|Reset<br>Value|RW|Description|
|VIRTUAL_TAG|31:0|0|RO|Virtual TAG of current cacheline. The bit[12:0] should be zero|

**Register Name: IMEM_TAG_RDATA2 Offset Address: 0xD18**

|Field|Bit|Reset<br>Value|RW|Description|
|---|---|---|---|---|
|IMEM_BASE_LO|31:0|0|RO|Low 32bit of IMEM_BASE of current cacheline|

|Register Name: IMEM_TAG_RDATA3|Register Name: IMEM_TAG_RDATA3|Register Name: IMEM_TAG_RDATA3|Register Name: IMEM_TAG_RDATA3|Register Name: IMEM_TAG_RDATA3|
|---|---|---|---|---|
|Offset Address: 0xD1C|||||
|Field|Bit|Reset<br>Value|RW|Description|
|IMEM_BASE_HI|15:0|0|RO|High 16 of IMEM_BASE of current cacheline|

##### 6.5.8.5. MODE_CFG and its MODE_WRK

|Register Name: MODE_CFG|Register Name: MODE_CFG|Register Name: MODE_CFG|Register Name: MODE_CFG|Register Name: MODE_CFG|
|---|---|---|---|---|
|Offset Address: 0x0|||||
|Field|Bit|Reset<br>Value|RW|Description|
|BF16_OVCLP|18:18|0|RWHW|If set, an overflowed BF16 result is clamped to +/- MAX_BF16,<br>regardless of round mode, while still preserving true INF values.<br>For floating point, clamp happens at final step and final result, no<br>intermediate result clamping.<br>This field is enabled again in Scorpio/Libra SIP for MOP serial<br>instructions.|
|INT_OVCLP|17:17|0|RWHW|If set, an overflowed Integer result is clamped to +/- MAX, inexact<br>flag will be raised, e.g. TransfF2I<br>Integer keep precision during whole operation, clamp happening<br>at last step for final result.<br>This is not supposed to be used anymore and SW should leave it as<br>0.<br>INT_OVCLP cannot affect SALU calculation instructions except<br>TRSI2I|
|FP16_OVCLP|16:16|0|RWHW|If set, an overflowed FP16 result is clamped to +/- MAX_FP16,<br>regardless of round mode, while still preserving true INF values.<br>For floating point, clamp happens at final step and final result, no<br>intermediate result clamping.<br>This field is enabled again in Scorpio/Libra SIP for MOP serial<br>instructions.|
|FP_DENORM|15:8|3f|RWHW|[1:0] Half precision handler. [3:2] Single precision handler. [5:4]<br>BF16 handler. [7:6] Reserved.<br>0 = allow input and output denorms.<br>1 = allow input denorms, flush output denorms.<br>2 = flush input denorms, allow output denorms.<br>3 = flush input and output denorms.|
|FP_ROUND|7:0|0|RWHW|[1:0] Half precision round mode. [3:2] Single precision round mode. [5:4]<br>BF16 round mode. [7:6] Reserved.<br>0 = nearest even<br>1 = toward zero<br>Others: Reserved|

##### 6.5.8.6. ICACHE_SCRATCH0

|Register Name: ICACHE_SCRATCH0|Register Name: ICACHE_SCRATCH0|Register Name: ICACHE_SCRATCH0|Register Name: ICACHE_SCRATCH0|Register Name: ICACHE_SCRATCH0|
|---|---|---|---|---|
|Offset Address: 0xD80|||||
|Field|Bit|Reset<br>Value|RW|Description|
|VAL|31:0|0|RWHW|SW Should not write this register!!!|

### 6.6. Interrupt & Exception

#### 6.6.1. Precise and Imprecise Exception

**Causion: 在SIP3.0中异步中断被舍弃。SIP4.0中异步中断依然被舍弃**

**Causion: SIP4.0中EXCP_ADDR_UNALIGN，EXCP_MIX_ATTR，EXCP_PC_ERR被舍弃，EXCP_ADDR_INVALID简化**

**Causion: SIP4.0中EXCP_REAL_SIZE，EXCP_VL，EXCP_VACC_INVALID，EXCP_TRAP_INS被舍弃**

**Causion: SIP4.0中RAS_REPAIRED系列中断上报被舍弃**

在SIP中，会打断当前软件线程程序流的机制是异常(Exception)。其中中断也被归属为异常的范畴内。异常大致分为下面几类：

- 非精确异常

- 精确异常

- 软中断

SIP4.0非精确异常指的是当异常发生时，保留在SIP各种寄存器中和/或Memory中的内容是非精确的。这些异常都是错误异常(Error Exception)。其非精确包含如下方面

**GPRs/SPRs非精确**

- SIP4.0的指令latency有1个~500个周期的巨大波动范围。而出于实现代价的考虑SIP4.0不会实现一个能够覆盖数百周期 latency的ROB。因此SIP4.0采用按序发射，乱序执行，乱序提交的执行模型。对于Load/Store类的可变周期的指令，其异常被记录时，可能存在后继发射的指令将结果已经回写到SR/VR/IV/VACC等GPRs以及SPR寄存器中。 对于这类异常，现场的GPRs/SPRs并非保留异常指令(包)提交前的精确状态

**异常顺序非精确**

- 对于非精确异常，SIP4.0会优先记录在执行时间上第一个触发的非精确异常，而非按照指令发射顺序上先发射指令的异常。例如有两个访存指令，第一条指令访问L3触发parity error，第二条指令访问L1触发地址非对齐异常。由于latency的缘故第一条指令的异常信息会远远晚于第二条指令返回给流水线。那么SIP4.0会先记录第二条指令的错误并触发相应异常，并抛弃第一条指令的异常信息。

对于这类异常，可能指令序列上有先发射的指令触发了相同或不同的异常而没有被记录

- PC地址非精确

   - 部分的异常虽然是由SIP4.0流水线触发，但是很难关联到一个具体的PC上，或者是由于实现代价而无法记录一个准确的 PC。此时异常触发时记录的PC可能是非精确的。

对于这类指令，EXCP_PC记录的可能不是触发这个exception的指令的PC，或者exception本身没有对应的PC。

SIP4.0也包含有一些精确异常。这些异常包括错误异常(Error Exception)和正常异常(比如break point)。这些异常类型在GPRs、 Memory、Exception状态寄存器中的内容都是精确的。这一类异常主要是在流水线前期，指令发射阶段之前可以检测的异常。

~~软中断特指trap1指令。这条指令也被归类在exception范围内，但是其本质是通用CPU中的软中断指令。在执行软中断时，流水线会自动将trap1指令PC+16保存到特定SPR寄存器中，自动关闭异步中断使能，进入到软中断的入口(同样由SPR寄存器指定)。在软中断执行完成后由ret指令回到之前保存的PC+16的程序流中并恢复中断使能状态。常见的通用CPU在执行软中断时，往往伴随权限切换。但是SIP4.0没有定义多种权限态，因此没有这个过程。在未来的SIP架构中可能会定义多权限态以及软中断对于权限切换的过程。~~

SIP4.0软中断被舍弃。

所有的异常都是和软件线程行为触发，并且和具体软件线程绑定的。异常处理和上报都是每个软件线程各自独立的。如果出现了非软件线程触发的错误，例如SIP外部master写SIP内部寄存器时有parity error，则不由SIP自身记录和上报异常，而是通过总线机制返回错误记录，由发出请求的master记录和上报。

#### 6.6.2. Exception Type

SIP4.0包括下述类型的异常event。这些异常event记录在每个软件线程中EXCP_STS/EXCP_BIT_EN寄存器中。

|Bit|Exception Name|GPRs/SPRs|Exception<br>Order|EXCP_PC<br>Captured|Exception<br>Instruction<br>commit or<br>not|Description|
|---|---|---|---|---|---|---|
|0|EXCP_IMEM_RAS_ERR|Imprecise|Imprecise|Imprecise|不提交|L1/L0 ICache读取<br>entry时发现<br>ECC/Parity error<br>L1 ICache从Memory<br>取指时的Bus<br>ECC/Parity Error不在<br>本条|
|1|EXCP_VDMEM_RAS_ERR|Imprecise|Imprecise|Imprecise|提交|VDMEM ECC/Parity<br>error|
|2|EXCP_SDMEM_RAS_ERR|Imprecise|Imprecise|Imprecise|提交|SDMEM ECC/Parity<br>error，包括<br>stack.local和<br>parameter buffer空<br>间|
|3|EXCP_VARAM_RAS_ERR|Imprecise|Imprecise|Imprecise|提交|VACC寄存器parity<br>error|
|4|EXCP_SRTAR_RAS_ERR|Imprecise|Imprecise|Imprecise|提交|SR/TAR寄存器RAM的<br>parity error|
|5|EXCP_IVSMR_RAS_ERR|Imprecise|Imprecise|Imprecise|提交|IV/SMR的L0.5 Cache<br>的parity error|
|6|EXCP_S3INST_RAS_ERR|Imprecise|Imprecise|Imprecise|提交|SIP流水线S3的指令<br>RAM的parity error|
|7|EXCP_L1CTRL_RAS_ERR|Imprecise|Imprecise|Imprecise|N/A|SIP中L1的控制类<br>SRAM parity error<br>包括LIQ/SDQ|

|Bit|Exception Name|GPRs/SPRs|Exception<br>Order|EXCP_PC<br>Captured|Exception<br>Instruction<br>commit or<br>not|Description|
|---|---|---|---|---|---|---|
|8|EXCP_L1DATA_RAS_ERR|Imprecise|Imprecise|Imprecise|提交|SIP中L1的数据类<br>SRAM parity error<br>包括NC buffer|
|9|EXCP_CF_RAS_ERR|Imprecise|Imprecise|Imprecise|提交|LD/ST指令访问L2/L3<br>IO时，出现AXI总线<br>parity error|
|10|EXCP_DF_RAS_ERR|Imprecise|Imprecise|Imprecise|提交|LD/ST指令访问L2/L3<br>MEM时，出现AXI总<br>线ECC/parity error<br>L1 ICache从MEM取<br>指时的总线/远端<br>slave的RAS error，<br>不在这里上报|
|12|EXCP_ILL_IS|Imprecise|Imprecise|Precise|不提交|JUMP地址非对齐错误<br>*|
|~~13~~|~~EXCP_ADDR_UNALIGN~~|~~Imprecise~~|~~Imprecise~~|~~Imprecise~~|~~scatter-~~<br>~~gather可能~~<br>~~提交~~<br>~~其余指令不~~<br>~~提交~~|~~LD/ST地址非对齐，~~<br>~~包括~~<br>~~1. scalar LD/ST~~<br>~~2. Vector~~<br>~~linear/Stride/scatter-~~<br>~~gather的LD/ST~~|
|14|EXCP_ADDR_INVALID|Imprecise|Imprecise|Imprecise|scatter-<br>gather可能<br>提交<br>其余指令不<br>提交|1. Load/Store指令访<br>问到未定义的地址段<br>2. Load/Store指令访<br>问到本指令不允许访<br>问的地址段<br>SIP4.0中，所有除了<br>L3 MEM外未定义地<br>址段都会触发本<br>exception。|
|15|EXCP_CF_RESP_ERR|Imprecise|Imprecise|Imprecise|提交|Load/Store指令访问<br>L2/L3 IO，出现AXI总<br>线response error|
|16|EXCP_DF_RESP_ERR|Imprecise|Imprecise|Imprecise|提交|Load/Store指令访问<br>L2/L3 MEM，出现<br>AXI总线response<br>error<br>L1 ICache从MEM取<br>指时的总线/远端<br>slave的RAS error，<br>不在这里上报|
|~~17~~|~~EXCP_MIX_ATTR~~|~~Imprecise~~|~~Imprecise~~|~~Imprecise~~|~~提交~~|~~一条scatter/gather指~~<br>~~令同时访问VDMEM~~<br>~~和VDMEM以外空间~~<br>~~(L2~~<br>~~&#124;~~<br>~~L3) ~~|
|~~18~~|~~EXCP_VACC_INVALID~~|~~Imprecise~~|~~Imprecise~~|~~Imprecise~~|~~不提交~~|~~指令中的VACC~~<br>~~src/dst超过了6143~~|
|~~19~~|~~EXCP_PC_ERR~~|~~Imprecise~~|~~Imprecise~~|~~Imprecise~~|~~不提交~~|~~指令流顺序执行或者~~<br>~~跳转时，PC大于等于~~<br>~~4GB~~|
|20|EXCP_ICACHE_DF_RAS_ERR|Imprecise|Imprecise|Imprecise|不提交|ICache使能时，当前<br>Cacheline访问DF时<br>有RAS error|
|21|EXCP_ICACHE_DF_RESP_ERR|Imprecise|Imprecise|Imprecise|不提交|ICache使能时，当前<br>Cacheline访问DF时<br>有非RAS的response<br>error|
|22|EXCP_ICACHE_MISS_VICTIM_ERR|Imprecise|Imprecise|Imprecise|不提交|ICache使能时，<br>Cache miss或者替换<br>时error，包括<br>1. Cache miss并且所<br>有cacheline被block<br>2.软件预取时，所有<br>cacheline被block<br>详见Instruction<br>memory章节|
|~~23~~|~~EXCP_REAL_SIZE~~|~~Imprecise~~|~~Imprecise~~|~~Imprecise~~|~~提交~~|~~SIP4.0新增异常~~<br>~~用于报告ISA4.0新增~~<br>~~MLI指令中出现real~~<br>~~size大于max size的~~<br>~~场景~~<br>~~该异常的BIT_EN默认~~<br>~~关闭~~|
|~~24~~|~~EXCP_VL~~|~~mprecise~~|~~Imprecise~~|~~Imprecise~~|~~提交~~|~~SIP4.0新增异常~~<br>~~用于报告ISA4.0中1D~~<br>~~指令出现VL大于max~~<br>~~size的场景~~<br>~~该异常异常的BIT_EN~~<br>~~默认关闭~~|
|~~28~~|~~EXCP_TRAP_INS~~|~~Precise~~|~~Precise~~|~~Precise~~|~~提交~~|~~TRAP1指令被执行~~|
|Other|Reserved|N/A|N/A|N/A|N/A|Reserved|

- *：对于JUMP/Branch指令地址非对齐触发EXCP_ILL_IS，指的是JUMP指令直接获取SR数据，而非低位处理后的SR数据

相比于SIP3.0，SIP4.0的异常有如下变化

所有异常中的GPRs/SPRs和异常顺序，全部是非精确的

**去掉了下列异常**

- EXCP_STS[19]：EXCP_MMU_ERR

该异常和SIP3.0中包含内置MMU有关。SIP4.0中移除了PBMMU因此不需要该exception

EXCP_STS[31]：EXCP_ASYNC_INTR

异步中断被舍弃

增加了下列异常

~~EXCP_REAL_SIZE~~

**~~指GEMM指令的real_size大于指令给定的max_size~~**

**~~该异常默认关闭~~**

~~EXCP_VL~~

~~指1D指令在非Legacy算子模式下，VL数值大于指令给定的max_size~~

~~该异常默认关闭~~

EXCP_SRTAR_RAS_ERR

EXCP_IVSMR_RAS_ERR

EXCP_S3INST_RAS_ERR

- 将RAS类异常名称中增加RAS字样

- 将EXCP_INNER_RAM_ERR拆分为下面两个异常

   - EXCP_L1CTRL_RAS_ERR

EXCP_L1DATA_RAS_ERR

- 将ICache取指数据异常拆分为下面两个

   - EXCP_ICACHE_DF_RAS_ERR

   - EXCP_ICACHE_DF_RESP_ERR

- 将BUS parity异常拆分为CF和DF两个

   - EXCP_CF_RAS_ERR

   - EXCP_DF_RAS_ERR

- 将LOAD/STORE异常调整为CF/DF的异常

   - EXCP_CF_RESP_ERR

EXCP_DF_RESP_ERR

- 将EXCP_ICACHE_BLOCK_ERR调整为两个异常

   - EXCP_ICACHE_BUS_RAS_ERR

EXCP_ICACHE_BUS_RESP_ERR

调整了异常号

**FCR调整舍弃以下异常**

- EXCP_ADDR_UNALIGN

- EXCP_MIX_ATTR

- EXCP_PC_ERR

- EXCP_REAL_SIZE

- EXCP_VL

- EXCP_TRAP_INS

对于以上异常的处理，请见LD/ST Exception章节

- 简化了EXCP_ILL_IS

##### 6.6.2.1. Bus Related Exception

**对于总线相关异常的说明：**

所有总线的异常，包括RAS异常和RESP异常，都是针对LD/ST指令或者ICache主动取指行为中异常行为的报告。SIP core的 memory和寄存器作为slave被外部master设备访问时，如果出现任何异常状况（比如RAS Error，Invalid Address），都不通过本章节所记录的异常状态进行记录和报告，而是通过Response向外部master设备反馈异常情况，由该master设备进行报告 SIP作为master访问总线时异常的检查和异常状态对应如下

|访问类型|异常情况|异常指示方式|异常类型|Comment|
|---|---|---|---|---|
|CF master<br>read|远端slave RAS<br>Error|CF的R_user[7:4]和<br>rresp|EXCP_CF_RAS_ERR|可以和bus RAS Error<br>同时出现|
|CF master<br>read|总线RAS Error|CF的data和R_user[3:0]<br>校验检查|EXCP_CF_RAS_ERR|可以和slave RAS<br>Error同时出现|
|CF master<br>read|远端slave<br>Response Error|CF的R_user[7:4]和<br>rresp|EXCP_CF_RESP_ERR|可以和bus RAS Error<br>同时出现|
|CF master<br>write|远端slave RAS<br>Error<br>或者总线RAS<br>Error|CF的B_user和bresp|EXCP_CF_RAS_ERR|和Write Response<br>Error互斥|
|CF master<br>write|远端slave<br>Response Error|CF的B_user和bresp|EXCP_CF_RESP_ERR|和Write Response<br>Error互斥|
|DF master0<br>read<br>DF master1<br>read|远端slave RAS<br>Error|DF的R_user[15:12]和<br>rresp|EXCP_DF_RAS_ERR|可以和bus RAS Error<br>同时出现|
|DF master0<br>read<br>DF master1<br>read|总线RAS Error|DF的data和<br>R_user[11:0]校验检查|EXCP_DF_RAS_ERR|可以和slave RAS<br>Error同时出现|
|DF master0<br>read<br>DF master1<br>read|远端slave<br>Response Error|DF的R_user[15:12]和<br>rresp|EXCP_DF_RESP_ERR|可以和bus RAS Error<br>同时出现|
|DF master0<br>write<br>DF master1<br>write|远端slave RAS<br>Error<br>或者总线RAS<br>Error|DF的B_user和bresp|EXCP_DF_RAS_ERR|和Write Response<br>Error互斥|
|DF master0<br>write<br>DF master1<br>write|远端slave<br>Response Error|DF的B_user和bresp|EXCP_DF_RESP_ERR|和Write Response<br>Error互斥|
|DF master2<br>read|远端slave RAS<br>Error|DF的R_user[15:12]和<br>rresp|EXCP_ICACHE_DF_RAS_ERR|可以和bus RAS Error<br>同时出现|
|DF master2<br>read|总线RAS Error|DF的data和<br>R_user[11:0]校验检查|EXCP_ICACHE_DF_RAS_ERR|可以和slave RAS<br>Error同时出现|
|DF master2<br>read|远端slave<br>Response Error|DF的R_user[15:12]和<br>rresp|EXCP_ICACHE_DF_RESP_ERR|可以和bus RAS Error<br>同时出现|

之所以将DF master0/1的异常类型和DF master2的异常类型拆开，是因为DF master2服务于ICache取指，一旦出现错误会导致流水线无法继续，属于Fatal error。它在Error Interrupt上报到Host/SP时，Cause ID和DF master0/1的Cause ID不同，所以不能合并

#### 6.6.3. Exception Related Registers

**和Exception相关的SPR寄存器包括如下：**

EXCP_BIT_EN由SIP3.0上的EXCP_TRAP改名而来

EXCP_STS_GLB由SIP3.0上的EXCP_MASK改名而来

**Register Name: TRPBA_WRK**

**SPR ID: 010**

|Field|Bit|Reset<br>Value|RW|Description|
|---|---|---|---|---|
|TRPBA|31:0|0|RO|Trap Base Address config register for trap handler|

|Register Name: EXCP_PC|Register Name: EXCP_PC|Register Name: EXCP_PC|Register Name: EXCP_PC|Register Name: EXCP_PC|
|---|---|---|---|---|
|SPR ID: 049|||||
|Field|Bit|Reset<br>Value|RW|Description|
|EXCP_PC|31:0|0|RO|Capture Exception PC when corresponding exception is triggered and<br>exception trap is taken. If the exception is LSB write AXI bus parity error<br>exception or Write (CF) response error exception, the EXCP_PC is<br>imprecise PC.|

|Register Name: EXCP_BIT_EN|Register Name: EXCP_BIT_EN|Register Name: EXCP_BIT_EN|Register Name: EXCP_BIT_EN|Register Name: EXCP_BIT_EN||
|---|---|---|---|---|---|
|SPR ID: 050||||||
|Field|Bit|Reset<br>Value|RW||Description|
|VAL|31:0|0x1073f3ff|RO||Per-exception-event enable bit. If a bit is 1 and corresponding exception<br>status bit in EXCP_STS is also 1, then program will transfer control to<br>exception handler.<br>[0] EXCP_IMEM_RAS_ERR<br>[1] EXCP_VDMEM_RAS_ERR<br>[2] EXCP_SDMEM_RAS_ERR<br>[3] EXCP_VARAM_RAS_ERR<br>[4] EXCP_SRTAR_RAS_ERR<br>[5] EXCP_IVSMR_RAS_ERR<br>[6] EXCP_S3INST_RAS_ERR<br>[7] EXCP_L1CTRL_RAS_ERR<br>[8] EXCP_L1DATA_RAS_ERR<br>[9] EXCP_CF_RAS_ERR<br>[10] EXCP_DF_RAS_ERR<br>[12] EXCP_ILL_IS<br>~~[13] EXCP_ADDR_UNALIGN~~<br>[14] EXCP_ADDR_INVALID<br>[15] EXCP_CF_RESP_ERR<br>[16] EXCP_DF_RESP_ERR<br>~~[17] EXCP_MIX_ATTR~~<br>~~[18] EXCP_VACC_INVALID~~<br>~~[19] EXCP_PC_ERR~~<br>[20] EXCP_ICACHE_DF_RAS_ERR<br>[21] EXCP_ICACHE_DF_RESP_ERR<br>[22] EXCP_ICACHE_MISS_VICTIM_ERR<br>~~[23] EXCP_REAL_SIZE~~<br>~~[24] EXCP_VL~~<br>~~[28] EXCP_TRAP_INS~~<br>other : Reserved|

|Register Name: EXCP_STS|Register Name: EXCP_STS|Register Name: EXCP_STS|Register Name: EXCP_STS|Register Name: EXCP_STS||
|---|---|---|---|---|---|
|SPR ID: 051||||||
|Field|Bit|Reset<br>Value|RW||Description|
|VAL|31:0|0|RO||When exception is occurred and NOT in trap handler process, the<br>exception is captured in this register for each event individually. 1 means<br>corresponding events happened, 0 means not.<br>Once captured as 1, it will be kepted as 1 until SW clearing it.<br>[0] EXCP_IMEM_RAS_ERR<br>[1] EXCP_VDMEM_RAS_ERR<br>[2] EXCP_SDMEM_RAS_ERR<br>[3] EXCP_VARAM_RAS_ERR<br>[4] EXCP_SRTAR_RAS_ERR<br>[5] EXCP_IVSMR_RAS_ERR<br>[6] EXCP_S3INST_RAS_ERR<br>[7] EXCP_L1CTRL_RAS_ERR<br>[8] EXCP_L1DATA_RAS_ERR<br>[9] EXCP_CF_RAS_ERR<br>[10] EXCP_DF_RAS_ERR<br>[12] EXCP_ILL_IS<br>~~[13] EXCP_ADDR_UNALIGN~~<br>[14] EXCP_ADDR_INVALID<br>[15] EXCP_CF_RESP_ERR<br>[16] EXCP_DF_RESP_ERR<br>~~[17] EXCP_MIX_ATTR~~<br>~~[18] EXCP_VACC_INVALID~~<br>~~[19] EXCP_PC_ERR~~<br>[20] EXCP_ICACHE_DF_RAS_ERR<br>[21] EXCP_ICACHE_DF_RESP_ERR<br>[22] EXCP_ICACHE_MISS_VICTIM_ERR<br>~~[23] EXCP_REAL_SIZE~~<br>~~[24] EXCP_VL~~<br>~~[28] EXCP_TRAP_INS~~<br>Other : Reserved|

|Register Name: EXCP_STS_GLB|Register Name: EXCP_STS_GLB|Register Name: EXCP_STS_GLB|Register Name: EXCP_STS_GLB|Register Name: EXCP_STS_GLB|
|---|---|---|---|---|
|SPR ID: 052|||||
|Field|Bit|Reset<br>Value|RW|Description|
|VAL|0:0|0|RO|When EXCP_BIT_EN & EXCP_STS !=0, when HW jumping to exception<br>handler, setting 1;<br>In exception handler, before exit trap handler. SW should clear this<br>register to 0, for clear EXCP_STS_GLB, SW should first to clear EXCP_STS<br>and EXCP_STS_TH, then clear EXCP_STS_GLB and EXCP_PC, otherwise the<br>EXCP_STS will set the EXCP_STS_GLB again.<br>由于TRAP1和ERET指令被放弃，该寄存器不再被使用|

|Register Name: EXCP_STS_TH|Register Name: EXCP_STS_TH|Register Name: EXCP_STS_TH|Register Name: EXCP_STS_TH|Register Name: EXCP_STS_TH||
|---|---|---|---|---|---|
|SPR ID: 053||||||
|Field|Bit|Reset<br>Value|RW||Description|
|VAL|31:0|0|RO||This register is used to record the exceptions triggered in trap handler<br>process. 1 means corresponding events happened, 0 means not.<br>Once captured as 1, it will be kepted as 1 until SW clearing it.<br>[0] EXCP_IMEM_RAS_ERR<br>[1] EXCP_VDMEM_RAS_ERR<br>[2] EXCP_SDMEM_RAS_ERR<br>[3] EXCP_VARAM_RAS_ERR<br>[4] EXCP_SRTAR_RAS_ERR<br>[5] EXCP_IVSMR_RAS_ERR<br>[6] EXCP_S3INST_RAS_ERR<br>[7] EXCP_L1CTRL_RAS_ERR<br>[8] EXCP_L1DATA_RAS_ERR<br>[9] EXCP_CF_RAS_ERR<br>[10] EXCP_DF_RAS_ERR<br>[12] EXCP_ILL_IS<br>~~[13] EXCP_ADDR_UNALIGN~~<br>[14] EXCP_ADDR_INVALID<br>[15] EXCP_CF_RESP_ERR<br>[16] EXCP_DF_RESP_ERR<br>~~[17] EXCP_MIX_ATTR~~<br>~~[18] EXCP_VACC_INVALID~~<br>~~[19] EXCP_PC_ERR~~<br>[20] EXCP_ICACHE_DF_RAS_ERR<br>[21] EXCP_ICACHE_DF_RESP_ERR<br>[22] EXCP_ICACHE_MISS_VICTIM_ERR<br>~~[23] EXCP_REAL_SIZE~~<br>~~[24] EXCP_VL~~<br>~~[28] EXCP_TRAP_INS~~<br>other Reserved|

#### 6.6.4. Exception Handling

##### 6.6.4.1. General Flow

在Exception Type章节中提到的每一种exception类型，都在EXCP_BIT_EN寄存器中都有一个对应的bit。当这个bit为0时，对应的 exception无法触发后继的处理流程，仅仅记录在EXCP_STS (EXCP_STS_GLB=0时)或者EXCP_STS_TH(EXCP_STS_GLB=1时)中。

当软件线程处于非exception handler状态(EXCP_STS_GLB = 0)，EXCP_BIT_EN的对应bit被设置为1，并且出现了该exception，所在的软件线程就会触发Exception处理流程。目前的处理流程有两类：

Error exception

软件线程进入Halt，并向SA0发送error interrupt

- ~~Trap1指令~~

~~软件线程进入Exception handler~~

在Exception handler中，SIP4.0禁止Trap/异步中断的嵌套。这是通过EXCP_STS_GLB=1来保证的。但是Exception handler中允许发生Error exception。

从通用角度而言，SIP4.0的Exception是可以被关闭的。通过将EXCP_BIT_EN对应bit设置为0，是可以跳过异常处理，使得流水线继续往下执行（但是EXCP_STS依然会有记录）。细节请见Error Exception章节的描述。

由于下列的Error exception出现时，代表出现SIP再无法维护指令流和流水线的正常执行。因此这里强制要求软件在使用时，永远将这些Error exception的EXCP_BIT_EN常置为1。这些异常也称为non-maskable exception。

|Error Exception Type|Version|Comment|
|---|---|---|
|EXCP_IMEM_RAS_ERR|SIP2.0/SIP2.1/SIP3.0/SIP4.0|RAS error，流水线无法维持。Relaunch前需要复位|
|EXCP_L1CTRL_RAS_ERR|SIP3.0/SIP4.0|RAS error，流水线无法维持。Relaunch前需要复位|
|EXCP_S3INST_RAS_ERR|SIP4.0|RAS error，流水线无法维持。Relaunch前需要复位|
|EXCP_ILL_IS|SIP2.0/SIP2.1/SIP3.0/SIP4.0|流水线无法维持。Relaunch前需要复位|
|EXCP_ICACHE_DF_RAS_ERR|SIP2.1/SIP3.0/SIP4.0|流水线无法维持。Relaunch前需要复位|
|EXCP_ICACHE_DF_RESP_ERR|SIP2.1/SIP3.0/SIP4.0|流水线无法维持。Relaunch前需要复位|
|EXCP_ICACHE_MISS_VICTIM_ERR|SIP2.1/SIP3.0/SIP4.0|流水线无法维持。Relaunch前需要复位|
|~~EXCP_PC_ERR~~|~~SIP2.0/SIP2.1/SIP3.0/SIP4.0~~|~~流水线无法维持。Relaunch前需要复位~~|

对于其他的Error exception部分，包括RAS Error，在对于的EXCP_BIT_EN bit关闭情况下，流水线会使用错误数据继续往下执行， 不会直接halt或者hang。SIP上的L1/数据ram等部分需要在触发这些Error情况下提供一个default的数据来维持流水线基本逻辑的正确性。

##### 6.6.4.2. Breakpoint

对于Breakpoint，SIP context触发之后，会进入到debugging模式，流水线停止自动发射指令，指令发射执行受到外部debugger 的控制执行。

##### 6.6.4.3. Error Exception

LIbra SIP对于Error Exception的处理流程进行了简化。当EXCP_STS_GLB=0时触发Error Exception之后，硬件会更新如下的状态寄存器：

- EXCP_STS_GLB保持不变 //这是由于SIP触发Error Exception时不进入exception handler而是直接进入halt EXCP_STS记录对应的异常状态

- EXCP_PC更新为出现异常时，正待发射的指令PC

如果不是Debug模式，该PC往往不是触发异常的指令的PC

同时软件线程进入Halt状态，并向SA0发送对应的Error interrupt报告。

如果当前EXCP_STS_GLB=1（由TRAP1指令触发进入Exception Handler），然后又触发了Error Exception，并且对应的 EXCP_BIT_EN bit为1，那么更新EXCP_STS_TH寄存器，然后软件线程强制进入Halt，并且向SA0发送Error interrupt。

如果当前EXCP_STS_GLB=1（由TRAP1指令触发进入Exception Handler），然后又触发了Error Exception，但是对应的 EXCP_BIT_EN bit为0，那么只更新EXCP_STS_TH寄存器，不做额外处理。在Exception hander返回时，将EXCP_STS_TH返回到 EXCP_STS中。

Note：这段描述是指Error Exception是可以被屏蔽的。但是存在一部分不允许屏蔽的Error Exception，请见General Flow章节。

SIP是以指令包为单位来记录错误异常的。一个指令包可能有多种错误异常，但是可能只会记录其中的一部分。例如同时包含有指令打包异常和LD/ST指令非对齐异常时，只会记录前者。但是如果一个指令包中异常类型全部是在发射之后检测的，并且该指令包最早触发了异常，那么硬件会记录该指令包中所有的异常。

在软件线程由于Error Exception进入Halt状态之后，即使Next寄存器组仍然有下一个等待中的task，也不会Launch。需要通过整个SIP的复位来解除这种状态。

SA0接受到error exception之后，会自动通过SCF->ECF通路，向SP和PCIE发送error exception信息。

除了上述的异常之外，SIP4.0中支持ECC的RAM/Bus请求，在出现单bit ECC矫正之后，会被记录在RAS_FIXED_STS寄存器中。这些单bit ECC矫正并不影响流水线执行。但是如果对应的RAS_FIXED_BIT_EN对应bit使能， ~~那么这些特殊状态也会使得线程向SP/Host 上报Error Interrupt，在~~ 线程自然结束后，阻止下一个Kernel自动发射到本线程槽上

##### 6.6.4.4. Trap1

**Causion: TRAP1指令(软中断)被舍弃**

~~Trap1即软中断。当Trap1触发时，硬件自动进行下列原子操作：~~

~~TRAP_RTB = PC+16~~

~~EXCP_STS |= 0x1000_0000~~

~~EXCP_STS_GLB = 0x1~~

~~PC = TRPBA_WRK~~

~~**Note:** Trap1指令是不能在Loop循环中执行的，否则会触发EXCP_ILL_IS异常。此处保存LOOP状态是为了使得RET指令在软中断和异步中断返回时执行相同的行为。~~**~~在进入trap_hander之后，需要如下步骤处理软中断~~**

1. ~~保存现场~~

   1. ~~可以使用INTR_SD0~INTR_SD3这4个SPR寄存器，作为SR的shadow寄存器~~

2. ~~读取EXCP_STS，确认当前触发的是软中断，并进入软中断的处理分支~~

3. ~~根据触发软中断时的参数，进行处理~~

4. ~~处理完之后，恢复现场~~

5. ~~执行RET指令~~

~~从TRAP handler返回应当调用RET指令，该指令执行下述原子操作：~~

~~PC = TRAP_RTB~~

~~EXCP_STS &= 0xEFFF_FFFF~~

~~EXCP_STS_GLB = 0x0~~

##### 6.6.4.5. 异常优先级

上述提到的各种异常类型，它们的优先级排序如下：

错误异常（Error Exception）

Break point

~~Trap1~~

优先级体现在上述的error exceptioin/break point/trap1在同时触发时的处理优先级。而这里的“同时”并不是指令顺序上的。由于 SIP的exception基本为非精确异常，因此这里同时是指流水线实现上同时检测到的错误异常、Break point、Trap1指令等。这个检测的时间顺序可以和指令发射顺序不同。

在同时触发时，即使按照优先级部分exception无法被处理，它们也依然会被记录到EXCP_STS中。这一点和前后exception中将时间上的后者抛弃的做法不同。

在任何Break point和Trap1处理中，如果之前的指令或者当前的指令包含错误异常，则进入到错误异常，不执行后两者。

当Break point和trap1同时出现在同一个指令包时，先执行Break point，然后执行trap1。

#### 6.6.5. Error Interrupt Report

SIP4.0通过硬件自动通过SA进行error上报。关于上报的方法详见SA相关章节。其中上报的基本原则时当SIP出现错误，需要进入 Halt（请注意，这里是需要而非已经进入halt）时，进行error interrupt上报。根据这个原则。Error Interrupt上报的特性包括如下：

当软件线程不在exception handler中的时候，如果触发了Error exception，并且其对应的EXCP_BIT_EN的域是打开的，那么就需要通过SA进行Error interrupt上报，同时SIP进入halt状态

   - 当流水线带着EXCP_STS强制进入halt之后，EXCP_STS[n]==1 && EXCP_BIT_EN[n] == 1条件 **阻塞** 该thread-slot的下一个软件软件线程发射

- 当软件线程不在exception handler中的时候，如果触发了Error exception，并且其对应的EXCP_BIT_EN的域是没有打开，那么SIP会记录对应的EXCP_STS，但是流水线依然正常执行不进入halt状态，并且不进行Error Interrupt上报

   - 当流水线带着EXCP_STS正常进入halt之后，EXCP_STS[n]==1 && EXCP_BIT_EN[n] == 0条件 **不阻塞** 该thread-slot的下一个软件软件线程发射，并且发射不清理EXCP_STS。

对于部分RAS Error和特殊Error，强制要求对应EXCP_BIT_EN为1。见Exception Handling章节的第一个表格

~~当软件线程由于trap指令处于exception handler中的时候，SIP目前并不允许exception handler嵌套。此时如果触发了Error exception，并且其对应的EXCP_BIT_EN的域是打开的，那么需要进行Error Interrupt的上报，同时SIP进入halt状态。~~

~~当软件线程由于trap指令t处于exception handler中，并且触发了Error exception，但是其EXCP_BIT_EN被关闭，则 exception会被记录在EXCP_STS_TH中。当从exception handler返回之后，状态被写回EXCP_STS，如果对应的EXCP_BIT_EN 中bit被打开，那么状况同第一条，触发Error Interrupt上报~~

- 由于当前多个Error exception和interrupt同时出现的时候，EXCP_STS只会优先处理1个，所以这里要求error exception的优先级高于break point和trap，因为按照原则，终究是要上报并让外部来处理

- 由于EXCP_L1CTRL_RAM_ERR等对应的ram中包含控制信息，会影响流水线的正常执行，即使触发了exception也未必能让软件线程进入halt状态（有可能pipeline hang）。此时只要硬件能够完成error interrupt的自动上报，依然可以接受。

如果exception处理机制前后出现多个error exception源头需要处理，而pipeline根据exception处理规则会优先处理第一个丢弃后面的那些error exception，那么对于Error Interrupt上报，也同样和pipeline处理的exception一致，即只上报pipeline要处理的那个error，而后继被pipeline丢弃的error不必上报（不必让SA接口可见）

除此之外，SIP4.0的Error Interrupt还包含如下情况

对于ECC单bit纠错成功的场景，SIP会通过同样记录下来在本线程中发生过，不当作Exception处理

- 在线程自然进入halt后，RAS_REPAIRED_BIT_EN和RAS_REPAIRED_STS上相同位置都有bit为1，则阻止该线程槽的再次启动。即这种情况下，RAS_REPAIRED_STS状态没有清理干净，需要软件感知并清理状态bit

- ~~当触发RAS_REPAIRED_STS中某个域，并且对应的RAS_REPAIRED_BIT_EN的bit为1时，需要通过SA上报Error Interrupt。详见Message Collector第一个小节。~~

无论Memory还是DF接口的单bit的RAS Repaired中断上报功能被舍弃，但是状态记录功能依然保留

|Bit|RAS Repair Name|Description|
|---|---|---|
|0|RAS_REPAIRED_IMEM|L1 ICache上发现ECC单bit错误，并且得到纠正|
|1|RAS_REPAIRED_VDMEM|L1 VDMEM上发现ECC单bit错误，并且得到纠正|
|2|RAS_REPAIRED_SDMEM|L1 SDMEM上发现ECC单bit错误，并且得到纠正|
|3|RAS_REPAIRED_DF|DF总线上发现ECC单bit错误，并且得到纠正|

- 对于SIP三个DF slave接口，如果出现多bit Error（不可恢复Error），它们不会触发任何Exception，但是需要通过SA上报 Error Interrupt。详见Message Collector第一个小节

该Error Interrupt上报没有CSR上的enable bit

#### 6.6.6. Normal Interrupt

SIP4.0增加了通过SA自动上报normal interrupt的功能。注意这里的interrupt并非指SIP流水线自身的中断，而是SIP流水线中某个线程触发了某种状态之后的，给PCIE上报一个中断信息。允许上报的类型包括：

执行TRAP0指令

~~执行TRAP1指令~~

~~触发Watchpoint~~

- 触发Breakpoint

TRAP1和Watchpoint功能被舍弃

SIP一共最多有10个线程，这些线程相同的interrupt源会先进行仲裁再传输到SA上。由于采用valid-only接口，这里存在中断源在仲裁时丢失的可能（仲裁不能反压流水线）。

### 6.7. HW Debugger

#### 6.7.1. History

|SIP Version|Doc Version|Date|Description|Author|
|---|---|---|---|---|
|4.0|v0.1|2023/7/20|Create initial version from Libra||
|4.0|v0.5.1|2023/11/06|根据Design更新Command部分||
|4.0|v0.5.2|2023/11/08|删除RUN命令<br>简化群发功能||
|4.0|v0.5.3|2024/4/18|Drop TRAP1||

#### 6.7.2. Glossary

|Abbreviation|Description|
|---|---|
|PLC|Pipeline Controller|
|AWP|Address Watchpoint|
|Debug模式|当某个线程进入Debug模式时，流水线停止取指和发射，由CSR的Debugger接口操作下一步动作|

#### 6.7.3. Requirement

对于SIP4.0的HW Debugger的功能需求如下：

- SIP4.0的流水线支持多个Kernel多个sub-thread并行的模式，因此HW Debugger需要面向Kernel设置Debug模式即在设置Breakpoint/Watch point/Debug command时，能够面向Kernel设置

- SIP4.0 HW Debugger支持采用下述方式进入到Debug模式

   - Breakpoint

   - TRAP0指令

   - Debug Server发出的STOP命令

   - ~~Address Watchpoint~~

**根据FCR，Address Watchpoint功能被放弃**

SIP4.0 HW Debug在通过下列事件触发Debug模式时，需要通过SoC的中断系统上报Host

- Breakpoint

- ~~Address Watchpoint~~

- Trap0指令

- ~~Trap1指令~~

~~Trap1指令虽然无法触发Debug模式，但是依然需要上报中断~~

**根据FCR，Trap1功能被放弃**

当某个软件线程通过下列方式触发Debug模式后，需要基于硬件机制将同Kernel的其他软件线程进入Debug模式

Breakpoint

~~Address Watchpoint~~

Trap0指令

- 在debug模式下，支持通过debug command接口执行以下功能

   - 支持从ICache取指的单步执行(STEP_CODE)

支持通过Debugger接口给与的指令的单步执行(STEP_DCMD)

   - 执行STEP_DCMD时，支持将SR写回数据放到DBG_RDATA而非架构的SR寄存器

- 支持从Debug模式回复到正常执行模式(RESUME)

支持在单步执行WAIT命令时，强制退出或者回复(FORCE & STEP_CODE)

需要改进对wait指令的FORCE和RESUME逻辑，避免WAIT指令被跳过的情况

#### 6.7.4. Introduction

SIP HW debugger是在SIP侧用来对接Host侧的debug程序，完成常规软件debugging需求的功能部分。该部分的工作方式如下图所示。其中Debug client和Debug server软件可以有以下几种形态：

Debug client在远程，Debug Server部署在Host端

Debug client和Debug Server都部署在Host端

Debug client部署在远程或者Host端，Debug Server部署在芯片上。

![图 026](libra_sip_arch_spec__figure_026.png)

Debug Client和Debug Server之间使用高层次的debug协议进行连接(例如基于TCP/IP的GDB RSP)。而Debug Server则使用硬件接口访问芯片上的每一个SIP（例如使用PCIE或者JTAG接口）。如下图所示

![图 027](libra_sip_arch_spec__figure_027.png)

而在SIP内部，从PCIE/JTAG过来的debug命令则是通过ECF总线接口，访问到一个SIP内部SCF的寄存器（包括HW Debug寄存器），来控制debug行为，并且获取Debug相关的信息的。

![图 028](libra_sip_arch_spec__figure_028.png)

##### 6.7.4.1. Feature List

SIP4.0的HW Debugger支持下面的功能特性：

![图 029](libra_sip_arch_spec__figure_029.png)

对于线程触发Breakpoint/ ~~AWP~~ /Trap0/ ~~Trap1~~ 时，会向Host上报中断

通过SA0的Normal Interrupt Agent（group2）上报

当某个线程触发Breakpoint/ ~~AWP~~ /Trap0时，基于硬件机制会自动向同Kernel的其他线程，发送stop command

- 通过SA0的Group9实现

可以通过配置SA的Group9关闭这个工

对于原始指令流中的wait/wait_i指令，无论怎么使用debug命令，均不会自动跳过

#### 6.7.5. Functionality

##### 6.7.5.1. Pipeline FSM

在SIP4.0中，单个线程流水线的状态机和状态定义如下：

![图 030](libra_sip_arch_spec__figure_030.png)

**流水线的分为模式(Mode)和FSM状态(State)两个部分：**

模式Mode

分为run mode（正常运行）和debug mode（单步执行）

参加HW_STS寄存器/DBG_MODE_THD*_STS系列寄存器的DBG_MODE域

状态state

**分为三个状态**

run state（正在执行非wait指令的状态）

也称为busy state

halt state（执行Halt之后停止状态）

wait state（正在执行wait/wait_i指令）。该状态下如果指令执行完成则自动进入到run state

参加HW_STS寄存器/DBG_MODE_THD*_STS系列寄存器的PLC_FSM域

**模式和状态为正交**

其中WAIT STATE记录的是执行原生指令流中的状态，而非使用STEP_DCMD执行WAIT/WAIT_I指令的状态

可以使用STEP_HALT在debug mode下迫使一个软件线程进入halt状态

##### 6.7.5.2. Debug Command Interface

DBG_CMD系列寄存器提供了Debug的命令接口。

- 当某个线程已经进入到了Debug mode时，可以通过DBG_CMD下发各种Debug command

- 如果需要调试的线程没有进入Debug mode，则可以先通过DBG_CMD下发STOP命令，然后再执行Debug command

- 发送DBG_CMD之后，需要轮循该寄存器直到CMD域为NULL，才能继续后面的步骤

   - STEP_DCMD不能发射WAIT/WAIT_I指令

- STOP和RESUME命令可以面向所有线程群发。其余命令每次只能面向一个线程发射。

   - 发射命令时，DBG_CMD的THD_SLOT_BIT_SEL必须至少有一个bit为1，否则本次的DBG_CMD执行结果不可知

- 对于STEP_DCMD，使用的指令为(DBG_BUF3, DBG_BUF2, DBG_BUF1, DBG_BUF0)中记录的指令包

   - 可以选择将STEP_DCMD中写回SR寄存器的数据写回到(DBG_RDATA1, DBG_RDATA0)中

- 对于进入debug mode并且没有触发exception的软件线程，使用STEP_HALT执行halt指令，其线程状态应当等效于正常执行 halt指令的线程，可以接受下一次kernel launch

   - 即使是进入Debug mode触发在一条Wait指令上，可以使用FORCE命令进入Debug mode+Run state，然后再用 STEP_HALT将流水线切入halt状态

- STEP_DCMD不能执行Halt指令。需要通过STEP_HALT来执行，否则SIP状态不可预测

- STEP_DCMD不能执行WAIT/WAIT_I指令。否则SIP状态不可预测

|Register Name: DBG_CMD|Register Name: DBG_CMD|Register Name: DBG_CMD|Register Name: DBG_CMD|Register Name: DBG_CMD|
|---|---|---|---|---|
|Offset Address: 0x830|||||
|Field|Bit|Reset<br>Value|RW|Description|
|THD_SLOT_BIT_SEL|31:16|0|RWHW|each 1 in bit31-bit16 means the debugging command will be<br>execute on which thread-slot.<br>So one debugging command can triggers 1~16 thread-slots in<br>simultaneously.<br>Note: when excecute STEP_DCMD, this field should select only<br>one thread-slot.|
|WR_ARF|4:4|0|RWHW|1: when executing STEP_DCMD, write the SR result to real<br>architecture resources instead of DBG_RDATA1/DBG_RDATA0,<br>0: when executing STEP_DCMD, write the SR result to<br>DBG_RDATA1/DBG_RDATA0 (based on index) instead of<br>architecture results|
|CMD|2:0|0|RWHW|0: NULL<br>1: STEP_CODE<br>2: STEP_DCMD<br>4: STOP<br>5: RESUME<br>6: FORCE<br>7: STEP_HALT<br>Others: Reserved<br>After writing this field with non-0 value, HW will start to handle<br>the command and will clear it to NULL when finished; SW<br>should pull this field until it reaches NULL, then read the result<br>from DBG_RDATA1/DBG_RDATA0.|

**Register Name: DBG_BUF0**

|Offset Address: 0x820|Offset Address: 0x820|Offset Address: 0x820|Offset Address: 0x820|Offset Address: 0x820|
|---|---|---|---|---|
|Field|Bit|Reset<br>Value|RW|Description|
|INS_VAL|31:0|0|RWHW|Instruction buf0 for DBG usage|

|Register Name: DBG_BUF1|Register Name: DBG_BUF1|Register Name: DBG_BUF1|Register Name: DBG_BUF1|Register Name: DBG_BUF1|
|---|---|---|---|---|
|Offset Address: 0x824|||||
|Field|Bit|Reset<br>Value|RW|Description|
|INS_VAL|31:0|0|RWHW|Instruction buf1 for DBG usage|

|Register Name: DBG_BUF2|Register Name: DBG_BUF2|Register Name: DBG_BUF2|Register Name: DBG_BUF2|Register Name: DBG_BUF2|
|---|---|---|---|---|
|Offset Address: 0x828|||||
|Field|Bit|Reset<br>Value|RW|Description|
|INS_VAL|31:0|0|RWHW|Instruction buf2 for DBG usage|

|Register Name: DBG_BUF3|Register Name: DBG_BUF3|Register Name: DBG_BUF3|Register Name: DBG_BUF3|Register Name: DBG_BUF3|
|---|---|---|---|---|
|Offset Address: 0x82C|||||
|Field|Bit|Reset<br>Value|RW|Description|
|INS_VAL|31:0|0|RWHW|Instruction buf3 for DBG usage|

|Register Name: DBG_RDATA0|Register Name: DBG_RDATA0|Register Name: DBG_RDATA0|Register Name: DBG_RDATA0|Register Name: DBG_RDATA0|
|---|---|---|---|---|
|Offset Address: 0x834|||||
|Field|Bit|Reset<br>Value|RW|Description|
|DATA_LO|31:0|0|RO|Low 32bit of SR write data for DBG usage.|

|Register Name: DBG_RDATA1|Register Name: DBG_RDATA1|Register Name: DBG_RDATA1|Register Name: DBG_RDATA1|Register Name: DBG_RDATA1|
|---|---|---|---|---|
|Offset Address: 0x838|||||
|Field|Bit|Reset<br>Value|RW|Description|
|DATA_HI|31:0|0|RO|High 32bit of SR write data for DBG usage.|

###### 6.7.5.2.1. Debug Command Usage

Debug command接口支持下列的Debug命令字

- STOP

- FORCE

- STEP_CODE

- STEP_DCMP

- STEP_HALT

RESUME

|Debug Command|是否可能改变Mode?|是否可能改变State?|在哪种模式|
|---|---|---|---|
|STOP|Yes<br>进入Debug mode|No|Run mode|
|RESUME|Yes<br>进入RUN mode|No|Debug mode|
|FORCE|No|Yes|Debug mode|
|STEP_CODE|No|Yes|Debug mode|
|STEP_DCMP|No|No|Debug mode|
|STEP_HALT|No|Yes|Debug mode|

###### 6.7.5.2.2. STOP

STOP命令用于将选中线程槽的线程由run mode进入debug mode.

- 该命令不会改变PLC_FSM的状态

- 如果当前线程槽处于run state，接到该命令后会进入Debug mode + Run state

- 如果当前线程槽处于wait state并且mailbox条件不满足，接到该命令后进入Debug mode + Wait state

- 如果当前线程槽处于halt状态，接到该命令后会进入Debug mode + Halt state

- 在Debug模式下执行这个命令，会被流水线忽略

请注意，除了STOP命令，Breakpoint/Address Watchpoint/TRAP0等等也能起到同样效果。它们和STOP命令一起统称为“Debug ” 事件触发 。

###### 6.7.5.2.3. RESUME

在Debug模式下，RESUME命令可以将某个或者某几个软件线程从Debug 模式退出，回到正常run模式。但是不改变状态 （RUN/WAIT/HALT)。

###### 6.7.5.2.4. FORCE

在Debug模式下，FORCE命令用于强制退出WAIT/WAIT_I指令的执行情况

- 如果由于“Debug事件触发”或者STEP_CODE让流水线进入了Debug mode+Wait state，并且Wait State迟迟无法退出，那么可以用FORCE命令让流水线进入到Debug mode+Run state。该行为不会跳过未执行完成的原生wait/wait_i指令。如果接下来执行step_code/resume会依然执行这条wait/wait_i指令

- 如果在Debug mode+Wait state下执行Force，并且此时该软件线程恰好满足wait条件，则流水线视为该指令执行完成并进入 run state。之后执行step_code/resume不会重复执行该指令

在Debug mode+Halt state或者在Debug mode+Run state执行FORCE命令，会被流水线忽略

###### 6.7.5.2.5. STEP_CODE

在Debug模式下，执行STEP_CODE命令会使得的一个或者多个软件线程根据PC从流水线中获取下一个指令包，并各自执行。执行后，如果是Halt指令则进入Halt state，如果是wait/wait_i指令则进入到Wait state

- 寄存器结果总是回写到架构寄存器中

- 在线程没有触发Exception的情况下，如果执行的是HALT指令，则线程能够正常退出进入Halt状态，并且允许下一个线程正常 launch

- 如果执行的指令触发了Error Exception，则该线程会进入halt状态。Exception类型将记录到EXCP_STS_TH

- 如果当前为Halt state，则自动执行halt指令之后的下一个指令包，并且更新流水线进入对应的状态

如果当前为Wait state，则STEP_CODE会被忽略

###### 6.7.5.2.6. STEP_DCMD

在Debug模式下，执行STEP_DCMD命令会令软件线程会执行一个来自(DBG_BUF3, DBG_BUF2, DBG_BUF1, DBG_BUF0)的指令包

- 该命令只能对一个线程执行，不支持多线程执行

- 对于本该回写到SR的结果，可以通过WR_ARF域选择回写到(DBG_DATA1, DBG_DATA0)而不是架构寄存器上

   - Debugger Server应当保证只有一个SR回写。

   - 在Legacy模式下，只有VPT0可以回写DBG_DATA寄存器。

- STEP_DCMD不会触发任何Exception

   - Debugger Server需要保证输入指令包的正确性

- STEP_DCMD不可执行HALT指令

如果需要线程在DBG模式下执行Halt，请使用STEP_HALT指令

STEP_DCMD不可执行WAIT/WAIT_I指令

- STEP_DCMD不可执行条件跳转指令

   - STEP_DCMD执行条件跳转指令会改变PC。如果该指令的条件并不满足，则PC被修改后无法恢复。因此禁止此事项

   - 如果有需要，那么可以用STEP_DCMD执行无条件跳转指令

- 除了执行无条件跳转指令，STEP_DCMD不会改变当前线程中的PC

- 除了MLI_HINT/MLI_HINT_GEMM和MLI系列指令打包外，STEP_DCMD不支持其他指令打包

   - 这里MLI_HINT系列被视作MLI指令扩展编码，所以广义上STEP_DCMD只支持单指令运行，不支持不同语义的指令打包执行

###### 6.7.5.2.7. STEP_HALT

在Debug mode + run state下，执行STEP_HALT命令会强制让软件线程由其他的状态进入到halt状态。相当于强制停止选中的软件线程

该命令替换了原来的"STEP_DCMD + HALT"的命令

- 该命令不需要填充DBG_BUF

- 该命令不能在Debug mode + wait state下执行

如果debugger需要将一个wait state下的线程执行halt，应当先执行一个FORCE命令，然后再执行STEP_HALT

##### 6.7.5.3. Address Watchpoint

**根据FCR，Address Watchpoint功能被放弃**

~~Libra SIP流水线提供了两组独立的Address watchpoint，它们有如下特性~~

~~支持Scalar/Vector/Matrix store指令的address watchpoint~~

~~包括Vector的scatter-store和stride-store指令~~

**~~不包括DPREFETCH/DCACHE_MTN~~**

~~需要设置特定的ASID~~

~~通过ASID指向特定的软件线程，总是需要ASID匹配才能触发~~

~~检查的地址，为指令语义上的虚拟地址，而非经过RBMMU转换后的地址~~

~~例如对Stack remote区域的访问，Address watchpoint检查的是stack remote本身的地址，而经过转换后的UVA地址支持对某个区域地址的检查~~

~~通过配置watchpoint上的mask域，可以忽略低若干bit的比较~~

~~在设置AWP使之生效时，建议将所有的线程都停下来(STOP)，设置成功后再恢复执行(RESUME)~~

~~Host需要以多次写或者写完再读的方式确认写透~~

~~为了AWP命中之后的精确现场，AWP使能之后，流水线将会以低速执行~~

~~这些线程在一个指令包执行完成之前，不会执行下一个指令包~~

~~由于硬件结构的原因，每个AWP，在流水线上和L1上各有一份镜像寄存器~~

~~对于同一个AWP的两份寄存器，每次都需要配置，并且必须配置相同~~

~~如果AWP命中，则该线程会hold在该指令包发射之前，并且进入到debug mode，并进行中断上报~~

~~在进入debug mode的同时，流水线会利用debugger的硬件机制，通过SA0的group9自动向本kernel所在的所有软件线程， 发送STOP命令~~

~~请见下文详述~~

##### 6.7.5.4. HW Breakpoint

SIP4.0支持两个独立的HW Breakpoint。它的工作流程如下：

在需要设置断点的kernel发射之前，设置该kernel的指令BASE_ADDR

- BRKP0/1_BASE_LO和BRKP0/1_BASE_HI

设置需要断点的PC

BRKP0/1_PC

设置BRKP0/1_CTRL的ASID域和EN域，使能断点

发射对应的Kernel

流水线在取指时，会和断点寄存器进行比对

BASE_ADDR、PC、ASID各自比对

   - 由于不同Kernel的Base address会不相同，因此可以确保命中的是需要断点的kernel而非其他kernel（这里Kernel指的是算子层面，而非Kernel-slot）

- 如果HW Breakpoint命中，则该线程会hold在该指令包发射之前，并且进入到debug mode，并进行中断上报

在进入debug mode的同时，流水线会利用debugger mode的硬件机制，通过SA0的group9自动向本kernel所在的所有软件线程，发送STOP命令

请见下文详述

**下面是断点0的设置寄存器：**

|Register Name: BRKP0_BASE_LO|Register Name: BRKP0_BASE_LO|Register Name: BRKP0_BASE_LO|Register Name: BRKP0_BASE_LO|Register Name: BRKP0_BASE_LO|
|---|---|---|---|---|
|Offset Address: 0x800|||||
|Field|Bit|Reset<br>Value|RW|Description|
|BASE_LO|31:0|0|RWHW|Low 32bit of 48bit instruction BASE_ADDR for breakpoint0. Bit[11:0]<br>should be all 0|

|Register Name: BRKP0_BASE_HI|Register Name: BRKP0_BASE_HI|Register Name: BRKP0_BASE_HI|Register Name: BRKP0_BASE_HI|Register Name: BRKP0_BASE_HI|
|---|---|---|---|---|
|Offset Address: 0x804|||||
|Field|Bit|Reset<br>Value|RW|Description|
|BASE_HI|15:0|0|RWHW|High 16bit of 48bit instruction BASE_ADDR for breakpoint0|

|Register Name: BRKP0_PC|Register Name: BRKP0_PC|Register Name: BRKP0_PC|Register Name: BRKP0_PC|Register Name: BRKP0_PC|
|---|---|---|---|---|
|Offset Address: 0x808|||||
|Field|Bit|Reset<br>Value|RW|Description|
|BRKP_PC|31:0|0|RWHW|32bit PC for breakpoint0. Bit[3:0] should be all 0|

|Register Name: BRKP0_CTRL|Register Name: BRKP0_CTRL|Register Name: BRKP0_CTRL|Register Name: BRKP0_CTRL|Register Name: BRKP0_CTRL|
|---|---|---|---|---|
|Offset Address: 0x80C|||||
|Field|Bit|Reset<br>Value|RW|Description|
|ASID|7:4|0|RWHW|ASID for breakpoint|
|EN|0:0|0|RWHW|1: enable breakpoint0, 0: disable breakpoint0|

##### 6.7.5.5. TRAP0 Instruction

在SIP4.0中，软件线程执行了TRAP0指令，会由如下动作：

- 本线程进入到debug mode状态，则该线程会hold在该指令的PC本身

- 进行中断上报

- 在进入debug mode的同时，流水线会利用debugger mode的硬件机制，通过SA0的group9自动向本kernel所在的所有软件线程，发送STOP命令

##### 6.7.5.6. SW Breakpoint

在SIP4.0中，软断点可以使用TRAP0指令实现。相对于硬件断点，软断点设置是硬件无关的，并且没有数量限制。Debugger程序可以使用下列方法来设置软断点：

**如果在软件线程发射之前设置软断点**

   - 将需要触发断点位置的指令包替换为TRAP0指令，并将对应的指令包保存到Debugger自行维护的列表中发射软件线程

   - 当软件线程执行到某个TRAP0指令时，自动进入debug mode并且上报中断并发送本kernel的STOP命令

   - Debugger根据中断介入操作，根据停止的PC位置，使用STEP_DCMD指令执行原来的指令包执行完原来的指令包之后，使用STEP_CODE继续进行单步执行

   - 后继也可以使用RESUME来退出Debug模式，直到遇到下一个断点

- 如果在软件线程发射之后设置软断点

**Debugger需要在设置断点位置之前停下软件线程**

   - 例如设置一个位置靠前的HW Breakpoint

- 停止所有的软件线程，并通过ICache的CSR寄存器，对整个cacheline执行invalidate操作

   - 这是因为CSR Invalidate操作的要求，必须停止所有软件线程，包括不相干的kernel

- 在L3上，将需要触发断点位置的指令包替换为TRAP0指令，并将对应的指令包保存到Debugger自行维护的列表中

- 恢复所有软件线程运行

- 设置软断点的软件线程执行TRAP0之后，自动进入debug mode并且上报中断并发送本kernel的STOP命令

- 之后Debugger的步骤和“在软件线程发射之前设置软断点”的处理步骤相同

##### 6.7.5.7. Interrupt Report

在SIP4.0中，对于HW breakpoint ~~/Address watchpoint/~~ TRAP0进入Debug模式的时候，硬件同时会以线程颗粒度，向Host发送 normal interrupt。 ~~此外，TRAP1指令执行也会上报normal interrupt。~~

- 该interrupt是通过valid-only接口，连接到SA0的group2上

- Interrupt的目的地址和casuse-id，预先配置在SA0上

- 该功能为新增功能

详细的接口说明，请见System Adapter章节

##### 6.7.5.8. Auto-Kernel-Stop

在SIP4.0中，对于HW breakpoint ~~/Address watchpoint/~~ TRAP0进入Debug模式的时候，硬件同时会通过SA0向本线程的Kernel下所有软件线程，发送STOP命令

- 该功能在SIP3.0上也有，但是当时只是两个硬件线程互发STOP command。而SIP4.0则是本流水线发给自己。

- 流水线固定连接了SA group9通路，其中部分接口是固定数值

   - ip_communi_grp9_awid0：0x0

   - ip_communi_grp9_ctxid0：SA0输出axusr的VF域

   - ip_communi_grp9_mstid0：SA0输出axusr的master ID域

   - ip_communi_grp9_asid0：0x0

   - ip_communi_grp9_pri：0x0

   - ip_communi_grp9_adr：0x830 (DBG_CMD寄存器)

   - ip_communi_grp9_len0：0x0

- 接口的写数据，则是根据触发的软件线程thread-slot-id，经过一系列计算得到

   - CMD域固定为STOP

   - THD_SLOT_BIT_SEL通过计算得到

硬件上，根据触发的thread-slot-id，查询 KNL_THD_MAP0和 KNL_THD_MAP1中的四个KNL*_MAP域

   - 如果发现sub-thread-slot-id命中某个KNL*_MAP域，则使用这个KNL*_MAP填充到THD_SLOT_BIT_SEL域之中

- 在执行Auto-Kernel-Stop过程中，有可能在同一个kernel-slot中存在其他的sub-thread触发breakpoint/TRAP0并发出中断。 但是最终该sub-thread的DBG_MOD_THD_STS寄存器中，总是记录进入debug mode原因为STOP_CMD。只有第一个触发该功能的sub-thread会被记录真实触发原因

- 必要时，可以通过配置SA来关闭group9

详细的接口说明，请见System Adapter章节

#### 6.7.6. Programming Guide for HW Debugger

通常情况下，如何停止一组sub-thread？

- 如果是强制停止（强杀）一类的场景，需要先向两个STOP_AUTO_POP寄存器写1，停止自动发射

- 通过DBG_CMD接口，发送STOP命令，并且设置THD_SLOT_BIT_SEL中对应sub-thread的bit

- 查询DBG_CMD接口，确认命令发送完成

- 查询对应sub-thread的DBG_MODE_THD*_STS寄存器，确认是否有sub-thread停留在了Debug mode+Wait state上

- 对于停留在Debug mode+Wait state上的sub-thread，可以对它们逐一补充一个FORCE命令，使得这些sub-thread退出 wait状态（但是不会跳过这条指令），使得所有STOP的软件线程均可以执行STEP_DCMD命令

然后使用STEP_HALT，使得这些要强制停止的sub-thread进入Debug mode + Halt state

可以在之前加一个STEP_DCMD(Barrier.All)指令，使得被强制停止的sub-thread之前所有指令都已经完成。

- 最后使用RESUME命令，使得这些被强制停止的sub-thread进入Normal mode + Halt State

对于强制停止（强杀）一类的场景，在恢复之后记得向两个STOP_AUTO_POP寄存器写0，允许自动发射。

- 对于STEP_DCMD的使用建议？

   - 对于STEP_DCMD，我们建议debugging模块这边总是用来读取寄存器数值，例如MOV指令来读取SR数值，而不要执行功能计算的功能

STEP_DCMD不能执行HATL和WAIT指令

如果需要一个软件线程HATL，请使用STEP_HALT

如何设置/恢复单个64bit的SR寄存器？

- 由于架构变化，SR寄存器扩展为64bit。此时如果只想修改一个SR 64bit完整数值而不影响其他的任何架构寄存器，不能再用原来的LDI_LO/LDI_HI指令

- 建议使用下面的几条指令的组合序列（假设修改SRn)

   - L.ORIX SRn, R0, imm 8 //用立即数和R0做或操作，初始化第一段8bit （原数值bit[63:56]）

   - L.SLLIX SRn, SRn, #8 //立即数左移8bit

   - L.ORIX SRn, SRn, imm8 //用立即数再次初始化第二段8bit（原数值bit[55:48]）

   - L.SLLIX SRn, SRn, #8 //再次立即数左移8bit

   - L.ORIX SRn, SRn, imm8 //用立即数再次初始化第三段8bit（原数值bit[47:40]）

   - L.SLLIX SRn, SRn, #8 //立即数左移8bit

   - L.ORIX SRn, SRn, imm8 //用立即数再次初始化第四段8bit（原数值bit[39:32]）

   - L.SLLIX SRn, SRn, #8 //立即数左移8bit

   - L.ORIX SRn, SRn, imm8 //用立即数再次初始化第五段8bit（原数值bit[31:24]）

   - L.SLLIX SRn, SRn, #8 //立即数左移8bit

   - L.ORIX SRn, SRn, imm8 //用立即数再次初始化第六段8bit（原数值bit[23:16]）

   - L.SLLIX SRn, SRn, #8 //立即数左移8bit

   - L.ORIX SRn, SRn, imm8 //用立即数再次初始化第七段8bit（原数值bit[15:8]）

   - L.SLLIX SRn, SRn, #8 //立即数左移8bit

   - L.ORIX SRn, SRn, imm8 //用立即数再次初始化最后8bit（原数值bit[7:0]）

如果要初始化的数值高32bit是全0，那么也可以用原来的LDI_LO/LDI_HI指令

### 6.8. Performance Monitor

#### 6.8.1. Overview

SIP4.0中的Perforamnce Monitor依然采用SA message collection上Profile Agent(group3)的来进行performance统计。它功能特性如下：

SA使用PMC来实现profiling agent功能

支持8个独立的48bit counter

SIP core提供56bit的event输入，和1bit start event+1bit stop event输入

- Profiling signal使用可编程选择的start和stop信号

   - SIP core提供了硬件触发的start/stop信号组

   - 通过SIP_PERF_SEL寄存器，从start/stop信号组中各选一个，作为所有counter的start和stop控制

   - 支持选择当前56bit evt中任意4个bit，作为start/stop信号组中各自额外的2bit start源/stop源

   - SA中每个counter可以选择输入的start/stop信号控制计数窗口，也可以通过Core Lite SA内部寄存器配置控制计数窗口

- SIP core 流水线包含2组56bit的evt，通过寄存器配置选择后送入profiling agent

   - 通过SIP_PERF_USR开启该功能并进行group选择，送入到SA接口

   - SA则在单个group基础上，选择不超过8个信号进行计数

**分布在两个group上的信号，无法在SA上同时并行计数**

SIP Core同时继续支持使用SA的Event Trace Agent，并新增了Customized Trace Agent

- 关于这两个部分，详见Event Trace和Customized Trace章节

Profile Agent在SIP core内的信号通路如下

![图 031](libra_sip_arch_spec__figure_031.png)

#### 6.8.2. Profiling Start/Stop Event Group

**Start Event如下**

Event54和Event55分别由SIP_PERF_USR[5:0]和SIP_PERF_USR[11:6]选择

- 56个Start Event Signal选择1个作为start输出的过程由SIP_PERF_SEL[5:0]选择

|Start Event ID|Description|Pulse or Level?|
|---|---|---|
|start_event_0|THD0_Halt_to_Run|Pulse|
|start_event_1|THD1_Halt_to_Run|Pulse|
|start_event_2|THD2_Halt_to_Run|Pulse|
|start_event_3|THD3_Halt_to_Run|Pulse|
|start_event_4|THD4_Halt_to_Run|Pulse|
|start_event_5|THD5_Halt_to_Run|Pulse|
|start_event_6|THD6_Halt_to_Run|Pulse|
|start_event_7|THD7_Halt_to_Run|Pulse|
|start_event_8|THD8_Halt_to_Run|Pulse|
|start_event_9|THD9_Halt_to_Run|Pulse|
|start_event_10|Reserved|N/A|
|start_event_11|Reserved|N/A|
|start_event_12|Reserved|N/A|
|start_event_13|Reserved|N/A|
|start_event_14|Reserved|N/A|
|start_event_15|Reserved|N/A|
|start_event_16|THD0_hit_breakpoint0|Pulse|
|start_event_17|THD1_hit_breakpoint0|Pulse|
|start_event_18|THD2_hit_breakpoint0|Pulse|
|start_event_19|THD3_hit_breakpoint0|Pulse|
|start_event_20|THD4_hit_breakpoint0|Pulse|
|start_event_21|THD5_hit_breakpoint0|Pulse|
|start_event_22|THD6_hit_breakpoint0|Pulse|
|start_event_23|THD7_hit_breakpoint0|Pulse|
|start_event_24|THD8_hit_breakpoint0|Pulse|
|start_event_25|THD9_hit_breakpoint0|Pulse|
|start_event_26|Reserved|N/A|
|start_event_27|Reserved|N/A|
|start_event_28|Reserved|N/A|
|start_event_29|Reserved|N/A|
|start_event_30|Reserved|N/A|
|start_event_31|Reserved|N/A|
|start_event_32|THD0_hit_breakpoint1|Pulse|
|start_event_33|THD1_hit_breakpoint1|Pulse|
|start_event_34|THD2_hit_breakpoint1|Pulse|
|start_event_35|THD3_hit_breakpoint1|Pulse|
|start_event_36|THD4_hit_breakpoint1|Pulse|
|start_event_37|THD5_hit_breakpoint1|Pulse|
|start_event_38|THD6_hit_breakpoint1|Pulse|
|start_event_39|THD7_hit_breakpoint1|Pulse|
|start_event_40|THD8_hit_breakpoint1|Pulse|
|start_event_41|THD9_hit_breakpoint1|Pulse|

|Start Event ID|Description|Pulse or Level?|
|---|---|---|
|start_event_42|Reserved|N/A|
|start_event_43|Reserved|N/A|
|start_event_44|Reserved|N/A|
|start_event_45|Reserved|N/A|
|start_event_46|Reserved|N/A|
|start_event_47|Reserved|N/A|
|start_event_48|Kernel_slot0_launch|Pulse|
|start_event_49|Kernel_slot1_launch|Pulse|
|~~start_event_50~~|~~Kernel_slot2_launch~~|~~Pulse~~|
|~~start_event_51~~|~~Kernel_slot3_launch~~|~~Pulse~~|
|start_event_52|THD0_THD9_any_launch|Pulse|
|start_event_53|THD0_THD8_any_launch|Pulse|
|start_event_54|Current_Group_Event_0<br>由SIP_PERF_USR[5:0]从当前的Profiling Event Group中选择|依赖选择的信号|
|start_event_55|Current_Group_Event_1<br>由SIP_PERF_USR[11:6]从当前的Profiling Event Group中选择|依赖选择的信号|

**Stop Event如下**

Event48和Event49分别由SIP_PERF_USR[17:12]和SIP_PERF_USR[23:18]选择

**50个Stop Event Signal选择1个作为Stop输出的过程由SIP_PERF_SEL[21:16]选择**

|Stop Event ID|Description|Pulse or Level?|
|---|---|---|
|stop_event_0|THD0_Run_to_Halt|Pulse|
|stop_event_1|THD1_Run_to_Halt|Pulse|
|stop_event_2|THD2_Run_to_Halt|Pulse|
|stop_event_3|THD3_Run_to_Halt|Pulse|
|stop_event_4|THD4_Run_to_Halt|Pulse|
|stop_event_5|THD5_Run_to_Halt|Pulse|
|stop_event_6|THD6_Run_to_Halt|Pulse|
|stop_event_7|THD7_Run_to_Halt|Pulse|
|stop_event_8|THD8_Run_to_Halt|Pulse|
|stop_event_9|THD9_Run_to_Halt|Pulse|
|stop_event_10|Reserved|N/A|
|stop_event_11|Reserved|N/A|
|stop_event_12|Reserved|N/A|
|stop_event_13|Reserved|N/A|
|stop_event_14|Reserved|N/A|
|stop_event_15|Reserved|N/A|
|stop_event_16|THD0_hit_breakpoint0|Pulse|
|stop_event_17|THD1_hit_breakpoint0|Pulse|
|stop_event_18|THD2_hit_breakpoint0|Pulse|
|stop_event_19|THD3_hit_breakpoint0|Pulse|
|stop_event_20|THD4_hit_breakpoint0|Pulse|
|stop_event_21|THD5_hit_breakpoint0|Pulse|
|stop_event_22|THD6_hit_breakpoint0|Pulse|
|stop_event_23|THD7_hit_breakpoint0|Pulse|
|stop_event_24|THD8_hit_breakpoint0|Pulse|
|stop_event_25|THD9_hit_breakpoint0|Pulse|
|stop_event_26|Reserved|N/A|
|stop_event_27|Reserved|N/A|
|stop_event_28|Reserved|N/A|
|stop_event_29|Reserved|N/A|
|stop_event_30|Reserved|N/A|
|stop_event_31|Reserved|N/A|
|stop_event_32|THD0_hit_breakpoint1|Pulse|
|stop_event_33|THD1_hit_breakpoint1|Pulse|
|stop_event_34|THD2_hit_breakpoint1|Pulse|
|stop_event_35|THD3_hit_breakpoint1|Pulse|
|stop_event_36|THD4_hit_breakpoint1|Pulse|
|stop_event_37|THD5_hit_breakpoint1|Pulse|
|stop_event_38|THD6_hit_breakpoint1|Pulse|
|stop_event_39|THD7_hit_breakpoint1|Pulse|
|stop_event_40|THD8_hit_breakpoint1|Pulse|
|stop_event_41|THD9_hit_breakpoint1|Pulse|
|stop_event_42|Reserved|N/A|
|stop_event_43|Reserved|N/A|
|stop_event_44|Reserved|N/A|
|stop_event_45|Reserved|N/A|
|stop_event_46|Reserved|N/A|
|stop_event_47|Reserved|N/A|
|stop_event_48|Current_Group_Event_0<br>由SIP_PERF_USR[17:12]从当前的Profiling Event Group中选择|依赖选择的信号|
|stop_event_49|Current_Group_Event_1<br>由SIP_PERF_USR[23:18]从当前的Profiling Event Group中选择|依赖选择的信号|

#### 6.8.3. Profiling Event Group

由寄存器SIP_PERF_USR[24]从SIP core侧的2组event group中选取一组，并经过SIP_PERF_USR[28]使能之后，作为SA Group2的输入，同时作为Start/Stop Event额外信号源之一。

Event Group对于profiling的影响在于，同一个组的56bit信号可以任选8个作为8个counter的输入，同时计数；但是不同组的信号永远无法在同一时刻被counter同时计数。

|Group 0 Event：<br>SIP_PERF_USR[24]==0|Description|Event<br>Unit|Comment|Priority|
|---|---|---|---|---|
|Event_0|1|Cycle|恒定为1|P0|
|Event_1|L1ICache_miss_fetch|Event|L1 ICache触发一次miss fetch|P0|
|Event_2|L1ICache_HW_prefetch|Event|L1 ICache触发一次HW prefetch|P0|
|Event_3|L1ICache_SW_prefetch|Event|L1 ICache触发一次SW prefetch|P2|
|Event_4|s2_scalar0_salu_issue|Event|S2 Scalar0 SALU指令发射不包含<br>SLDST，amo，movsr2spr.vab不包含<br>ctru和bru执行的指令可能被flush|P1|
|Event_5|s2_scalar1_salu_issue|Event|S2 Scalar1 SALU指令发射不包含<br>SLDST，amo，movsr2spr.vab不包含<br>ctru和bru执行的指令可能被flush|P1|
|Event_6|s2_scalar0_sldst_issue|Event|S2 Scalar0 SLDST指令发射不包含amo<br>可能被flush|P1|
|Event_7|s2_scalar1_sldst_issue|Event|S2 Scalar1 SLDST指令发射不包含amo<br>可能被flush|P1|
|Event_8|s2_vld_issue|Event|S2 VLD指令发射可能被flush|P0|
|Event_9|s2_vst_issue|Event|S2 VLD指令发射可能被flush|P0|
|Event_10|s2_1d_issue|Event|S2 VST指令发射可能被flush|P0|
|Event_11|s2_2d_gemm_issue|Event|S2 GEMM指令发射可能被flush|P0|
|Event_12|s2_2d_msf_issue|Event|S2 MSF指令发射可能被flush|P0|
|Event_13|s2_cf0_issue|Event|S2 LSE CF0通道发送请求|P2|
|Event_14|s2_cf1_issue|Event|S2 LSE CF1通道发送请求|P2|
|Event_15|s3_uisa_vld_iv_issue|Event|S3 VLD_IV微指令发射|P2|
|Event_16|s3_uisa_vld_smr_issue|Event|S3 VLD_SMR微指令发射|P2|
|Event_17|s3_uisa_mov_srm_issue|Event|S3 MOVSMR微指令发射|P2|
|Event_18|s3_uisa_2d_gemm_issue|Event|S3 vmm微指令发射|P0|
|Event_19|s3_uisa_2d_msf_issue|Event|S3 MSF微指令发射|P0|
|Event_20|s3_uisa_1d_issue|Event|S3 1D微指令发射|P0|
|Event_21|s3_uisa_vlda_l0p5_issue|Event|S3 VLDA L0P5微指令发射|P2|
|Event_22|s3_uisa_vlda_l0_issue|Event|S3 VLDA L0微指令发射|P1|
|Event_23|s3_uisa_vlda_l1_issue|Event|S3 VLDA L1微指令发射|P0|
|Event_24|s3_uisa_vsta_l0_issue|Event|S3 VSTA L0微指令发射|P1|
|Event_25|s3_uisa_vsta_l1_issue|Event|S3 VSTA L1微指令发射|P0|
|Event_26|L1_T0_vld_req0_issue|Event|XPU->L1模块T0 linear vld第一个请求发<br>射|P0|
|Event_27|L1_T0_vld_req1_issue|Event|XPU->L1模块T0 linear vld第二个请求发<br>射|P0|
|Event_28|L1_T0_vld_req2_issue|Event|XPU->L1模块T0 linear vld第三个请求发<br>射|P0|
|Event_29|L1_T0_vld_req3_issue|Event|XPU->L1模块T0 linear vld第四个请求发<br>射|P0|
|Event_30|L1_T0_vst_req0_issue|Event|XPU->L1模块T0 linear vst第一个请求发<br>射|P0|
|Event_31|L1_T0_vst_req1_issue|Event|XPU->L1模块T0 linear vst第二个请求发<br>射|P0|
|Event_32|L1_T0_vst_req2_issue|Event|XPU->L1模块T0 linear vst第三个请求发<br>射|P0|
|Event_33|L1_T0_vst_req3_issue|Event|XPU->L1模块T0 linear vst第四个请求发<br>射|P0|
|Event_34|L1_T0_gather_req_issue|Event|XPU->L1模块T0 gather load请求发射|P0|
|Event_35|L1_T0_scatter_req_issue|Event|XPU->L1模块T0 scatter store请求发射|P0|
|Event_36|L1_T0_resp0_taken|Event|XPU->L1模块T0第一个读数据返回|P0|
|Event_37|L1_T0_resp1_taken|Event|XPU->L1模块T0第二个读数据返回|P0|
|Event_38|L1_T0_resp2_taken|Event|XPU->L1模块T0第三个读数据返回|P0|
|Event_39|L1_T0_resp3_taken|Event|XPU->L1模块T0第四个读数据返回|P0|
|Event_40|L1_T1_vld_req0_issue|Event|XPU->L1模块T1 linear vld第一个请求发<br>射|P0|
|Event_41|L1_T1_vld_req1_issue|Event|XPU->L1模块T1 linear vld第二个请求发<br>射|P0|
|Event_42|L1_T1_vld_req2_issue|Event|XPU->L1模块T1 linear vld第三个请求发<br>射|P0|
|Event_43|L1_T1_vld_req3_issue|Event|XPU->L1模块T1 linear vld第四个请求发<br>射|P0|
|Event_44|L1_T2_vld_req0_issue|Event|XPU->L1模块T2 linear vld第一个请求发<br>射|P0|
|Event_45|L1_T2_vld_req1_issue|Event|XPU->L1模块T2 linear vld第二个请求发<br>射|P0|
|Event_46|L1_T2_vld_req2_issue|Event|XPU->L1模块T2 linear vld第三个请求发<br>射|P0|
|Event_47|L1_T2_vld_req3_issue|Event|XPU->L1模块T2 linear vld第四个请求发<br>射|P0|
|Event_48|L1_T1_vld_resp0_taken|Event|XPU->L1模块T1第一个读数据返回|P0|
|Event_49|L1_T1_vld_resp1_taken|Event|XPU->L1模块T1第二个读数据返回|P0|
|Event_50|L1_T1_vld_resp2_taken|Event|XPU->L1模块T1第三个读数据返回|P0|
|Event_51|L1_T1_vld_resp3_taken|Event|XPU->L1模块T1第四个读数据返回|P0|
|Event_52|L1_T2_vld_resp0_taken|Event|XPU->L1模块T2第一个读数据返回|P0|
|Event_53|L1_T2_vld_resp1_taken|Event|XPU->L1模块T2第二个读数据返回|P0|
|Event_54|L1_T2_vld_resp2_taken|Event|XPU->L1模块T2第三个读数据返回|P0|
|Event_55|L1_T2_vld_resp3_taken|Event|XPU->L1模块T2第四个读数据返回|P0|

|Group 1 Event<br>SIP_PERF_USR[24]==1|Description|Event<br>Unit|Comment|Priority|
|---|---|---|---|---|
|Event_0|1|Cycle|恒定为1|P0|
|Event_1|s2_scalar0_data_hazad_all_stall|Cycle|S2 RS中Scalar0通道有<br>指令有效并且所有有效<br>指令因为data hazard不<br>能调度|P2|
|Event_2|s2_scalar1_data_hazad_all_stall|Cycle|S2 RS中Scalar1通道有<br>指令有效并且所有有效<br>指令因为data hazard不<br>能调度|P2|
|Event_3|s2_vld_data_hazad_all_stall|Cycle|S2 RS中VLD通道有指令<br>有效并且所有有效指令<br>因为data hazard不能调<br>度|P2|
|Event_4|s2_vst_data_hazad_all_stall|Cycle|S2 RS中VST通道有指令<br>有效并且所有有效指令<br>因为data hazard不能调<br>度|P2|
|Event_5|s2_1d_data_hazad_all_stall|Cycle|S2 RS中1D计算通道有指<br>令有效并且所有有效指<br>令因为data hazard不能<br>调度|P2|
|Event_6|s2_2d_data_hazad_all_stall|Cycle|S2 RS中2D计算通道有指<br>令有效并且所有有效指<br>令因为data hazard不能<br>调度|P2|
|Event_7|s2_sdmem_credit_zero|Cycle|S2 LSE中SDMEM<br>queue的credit为0|P2|
|Event_8|s2_cf_credit_zero|Cycle|S2 LSE中CF queue的<br>credit为0|P2|
|Event_9|s3_uisa_mov_srm_data_hazard_all_stall|Cycle|S3 ROQ中MOV_SMR通<br>道有微指令有效并且所<br>有有效微指令因为data<br>hazard不能调度|P2|
|Event_10|s3_uisa_2d_data_hazard_all_stall|Cycle|S3 ROQ中2D计算通道<br>有微指令有效并且所有<br>有效微指令因为data<br>hazard不能调度|P2|
|Event_11|s3_uisa_1d_data_hazard_all_stall|Cycle|S3 ROQ中1D计算通道<br>有微指令有效并且所有<br>有效微指令因为data<br>hazard不能调度|P2|
|Event_12|s3_uisa_vlda_data_hazard_all_stall|Cycle|S3 ROQ中VLDA通道有<br>微指令有效并且所有有<br>效微指令因为data<br>hazard不能调度|P2|
|Event_13|s3_uisa_vst_data_hazard_all_stall|Cycle|S3 ROQ中VSTA通道有<br>微指令有效并且所有有<br>效微指令因为data<br>hazard不能调度|P2|
|Event_14|thd0_wait|Cycle|sub_thread0处于wait<br>mailbox/gsync mailbox<br>状态|P1|
|Event_15|thd1_wait|Cycle|sub_thread1处于wait<br>mailbox/gsync mailbox<br>状态|P1|
|Event_16|thd2_wait|Cycle|sub_thread2处于wait<br>mailbox/gsync mailbox<br>状态|P1|
|Event_17|thd3_wait|Cycle|sub_thread3处于wait<br>mailbox/gsync mailbox<br>状态|P1|
|Event_18|thd4_wait|Cycle|sub_thread4处于wait<br>mailbox/gsync mailbox<br>状态|P1|
|Event_19|thd5_wait|Cycle|sub_thread5处于wait<br>mailbox/gsync mailbox<br>状态|P1|
|Event_20|thd6_wait|Cycle|sub_thread6处于wait<br>mailbox/gsync mailbox<br>状态|P1|
|Event_21|thd7_wait|Cycle|sub_thread7处于wait<br>mailbox/gsync mailbox<br>状态|P1|
|Event_22|thd8_wait|Cycle|sub_thread8处于wait<br>mailbox/gsync mailbox<br>状态|P1|
|Event_23|thd9_wait|Cycle|sub_thread9处于wait<br>mailbox/gsync mailbox<br>状态|P1|
|Event_24|Reserved|N/A|N/A|N/A|
|Event_25|Reserved|N/A|N/A|N/A|
|Event_26|Reserved|N/A|N/A|N/A|
|Event_27|Reserved|N/A|N/A|N/A|
|Event_28|Reserved|N/A|N/A|N/A|
|Event_29|Reserved|N/A|N/A|N/A|
|Event_30|th0_branch_flush|Event|sub_thread0由于<br>branch预测失败而触发<br>一次flush|P2|
|Event_31|th1_branch_flush|Event|sub_thread1由于<br>branch预测失败而触发<br>一次flush|P2|
|Event_32|th2_branch_flush|Event|sub_thread2由于<br>branch预测失败而触发<br>一次flush|P2|
|Event_33|th3_branch_flush|Event|sub_thread3由于<br>branch预测失败而触发<br>一次flush|P2|
|Event_34|th4_branch_flush|Event|sub_thread4由于<br>branch预测失败而触发<br>一次flush|P2|
|Event_35|th5_branch_flush|Event|sub_thread5由于<br>branch预测失败而触发<br>一次flush|P2|
|Event_36|th6_branch_flush|Event|sub_thread6由于<br>branch预测失败而触发<br>一次flush|P2|
|Event_37|th7_branch_flush|Event|sub_thread7由于<br>branch预测失败而触发<br>一次flush|P2|
|Event_38|th8_branch_flush|Event|sub_thread8由于<br>branch预测失败而触发<br>一次flush|P2|
|Event_39|th9_branch_flush|Event|sub_thread9由于<br>branch预测失败而触发<br>一次flush|P2|
|Event_40|Reserved|N/A|N/A|N/A|
|Event_41|Reserved|N/A|N/A|N/A|
|Event_42|Reserved|N/A|N/A|N/A|
|Event_43|Reserved|N/A|N/A|N/A|
|Event_44|Reserved|N/A|N/A|N/A|
|Event_45|Reserved|N/A|N/A|N/A|
|Event_46|thd0_thd8_all_wait_or_halt|Event|sub_thread0~8全部处<br>于halt或者wait mailbox<br>状态|P0|
|Event_47|thd0_thd9_all_wait_or_halt|Event|sub_thread0~9全部处<br>于halt或者wait mailbox<br>状态|P0|
|Event_48|L0ICache_req0_issue|Event|L0 ICache向L1 ICache<br>发送第一个读请求|N/A|
|Event_49|L0ICache_req1_issue|Event|L0 ICache向L1 ICache<br>发送第二个读请求|N/A|
|Event_50|L0ICache_req2_issue|Event|L0 ICache向L1 ICache<br>发送第三个读请求|N/A|
|Event_51|L0ICache_req3_issue|Event|L0 ICache向L1 ICache<br>发送第四个读请求|N/A|
|Event_52|L0ICache_resp_taken|Event|L1 ICache向L0 ICache<br>返回指令包|N/A|
|Event_53|Reseved|Reseved|Reseved|N/A|
|Event_54|Reseved|Reseved|Reseved|N/A|
|Event_55|Reseved|Reseved|Reseved|N/A|

#### 6.8.4. Registers

Peformance Monitor在SIP Core 侧的寄存器定义如下：

|Register Name: SIP_PERF_SEL|Register Name: SIP_PERF_SEL|Register Name: SIP_PERF_SEL|Register Name: SIP_PERF_SEL|Register Name: SIP_PERF_SEL|
|---|---|---|---|---|
|Offset Address: 0xA00|||||
|Field|Bit|Reset<br>Value|RW|Description|
|STOP_SEL|23:16|0|RWHW|Select stop siganl from stop group for profiling agent|
|START_SEL|7:0|0|RWHW|Select start siganl from start group for profiling agent|

|Register Name: SIP_PERF_USR|Register Name: SIP_PERF_USR|Register Name: SIP_PERF_USR|Register Name: SIP_PERF_USR|Register Name: SIP_PERF_USR|
|---|---|---|---|---|
|Offset Address: 0xA04|||||
|Field|Bit|Reset<br>Value|RW|Description|
|PERF_USR|31:0|0|RWHW|Select event group for profiling agent.|

#### 6.8.5. Profiling Scenario for OPs

下面是对算子关心的具体场景的PMC使用说明

|指标|颗粒度|选择的Event|选择的Start/Stop|说明|
|---|---|---|---|---|
|1D利用率|整个sip|Group0<br>Event_0<br>Event_20<br>Event_22<br>Event_25|使用AMOS信息进行软件触发<br>Start/Stop||
|MSF利用率|整个sip|Group0<br>Event_0<br>Event_18<br>Event_19|使用AMOS信息进行软件触发<br>Start/Stop||
|2D利用率|整个sip|Group0<br>Event_0<br>Event_18<br>Event_19|使用AMOS信息进行软件触发<br>Start/Stop||
|标量单元利用率|整个sip|Group0<br>Event_0<br>Event_4<br>Event_5<br>Event_6<br>Event_7|使用AMOS信息进行软件触发<br>Start/Stop|这几个Event可能被<br>Flush掉|
|vld带宽|整个sip|Group0<br>Event_0<br>Event_26<br>Event_27<br>Event_28<br>Event_29|使用AMOS信息进行软件触发<br>Start/Stop|固定颗粒度128B/cycle<br>实际每个req可能小于<br>128B|
|vst带宽|整个sip|Group0<br>Event_0<br>Event_30<br>Event_31<br>Event_32<br>Event_33|使用AMOS信息进行软件触发<br>Start/Stop|固定颗粒度128B/cycle<br>实际每个req可能小于<br>128B|
|gather带宽|整个sip|Group0<br>Event_0<br>Event_34|使用AMOS信息进行软件触发<br>Start/Stop|每一笔最大颗粒度为<br>128B/cycle|
|scatter带宽|整个sip|Group0<br>Event_0<br>Event_35|使用AMOS信息进行软件触发<br>Start/Stop|每一笔最大颗粒度为<br>128B/cycle|
|ldsmr带宽|整个sip|Group0<br>Event_0<br>Event_44<br>Event_45<br>Event_46<br>Event_47|使用AMOS信息进行软件触发<br>Start/Stop|固定颗粒度128B/cycle|
|Sip busy|整个sip|Group0<br>Event_0|使用AMOS信息进行软件触发<br>Start/Stop||
|thread busy|per<br>thread|Group0<br>Event_0|使用AMOS信息进行软件触发<br>Start/Stop||
|thread wait|per<br>thread|Group1<br>Event_0<br>Event_14~23|使用AMOS信息进行软件触发<br>Start/Stop||
|ICache HW<br>prefetch次数|整个sip|Group0<br>Event_0<br>Event_2|使用AMOS信息进行软件触发<br>Start/Stop||
|ICache miss次数|整个sip|Group0<br>Event_0<br>Event_1|使用AMOS信息进行软件触发<br>Start/Stop||
|L1→L0 ICache的利<br>用率|整个sip|Group1<br>Event_0<br>Event_48~Event_52|使用AMOS信息进行软件触发<br>Start/Stop|P2 feature|
|指令data hazard<br>stall统计|整个sip|Group1<br>Event_0<br>Event_1~Event_6<br>或者<br>Event_9~Event13|使用AMOS信息进行软件触发<br>Start/Stop|P2 feature|


## 7. SoC Function Description
### 7.1. Peripheral Module

在SIP4.0中，除了SIP XPU core和L1 subsystem之外，SIP顶层还集成了下述模块

|Module|SIP 4.0 Instance<br>Number|SIP Lite Instance<br>Number|Comment|
|---|---|---|---|
|SIP CRG|1|1|Clock & Reset Generator|
|SA0/SA0.ext|1|只包含了SA0，不包含<br>SA0.ext|SIP SA，由于功能关系物理上分为2个moudle<br>逻辑上视为一个module|
|SIP_SCF|1|1|SIP内部CF NOC，通过SA0.ext连接外部ECF通<br>路|
|AXI Bridge|1|1|从SIP SCF接收请求，访问RPC/PMU/OCS/SA0<br>等模块|
|RPC|1|N/A|RPC的通道数量增加到16个|
|Mailbox|1|N/A|mailbox单元中通道数据增加到192个|
|HwSync|1|1|HwSync会直连SIP_SCF|
|Common<br>CSR<br>ICache CSR<br>L1 CSR<br>XPU CSR|1|N/A|集成包括部分CSR寄存器/Profiling select等功能<br>的模块<br>由于物理需求，拆分为多个CSR文件片段|
|BPM|2|N/A|Bus Performance Monitor，从SA中分离出来<br>Libra SIP使用2个|
|OBS|1|N/A||
|L2M|1|1|由于SoC布局的原因，每个SIP4.0/SIP Lite集成<br>一个L2M|

和SIP4.0相比，SIP4.0变化如下

由于面积因素，去除了SDTE、SDTE Lite SA

由于不再使用双电压域设计，去除了VDCI，SCF1，SDTE OBS，同时TOP SA和Lite SA合并为一个SA0

- 2to1 SDF/1to2 SDF被移除，L1和网络互联被整合到L1 system/DSM network中

- BPM模块被从SA中分离出来，并且例化了两份

- 保留原有的PMU、OCS、HwSync、AXI bridge、Mailbox、RPC、SIP_SCF、OBS等模型，并根据Libra的流水线/顶层设计而做调整

CSR模块出于物理需要分为多路

由于SoC布局的原有，增加了L2M模块

而SIP Lite相对于SIP4.0的变化如下：

- 只保留了CRG/SIP_SCF/AXI Bridge/HwSync/L2M

- SIP Lite的基本功能只保留了HW Sync功能通路，以及外界配置L1 CSR寄存器的通路

### 7.2. Harvest

SIP4.0所支持的Harvest被称为OAM SKU Harvest，使用外部输入的i_sic_x_harvest_info来完成。其中i_sic_x_harvest_info对时钟进行clock gating，固定Reset信号，同事对逻辑输出进行钳位。

SIP被harvest之后，XPU/KG等模块被disable，但保留了sip_l1_top模块工作，给整个SIC提供完整的DSM空间。此时sip_l1_top所需要使用的时钟和复位需要保持在正常工作的状态。

在Harvest之后，下列模块必须保证功能正常，处于可使用状态

- 整个L1 block中的逻辑，包括

   - L1 memory subsystem & L1 CSR

   - 2个BPM (功能必须正常，但是不会被使用)

   - L2M (功能必须正常，但是不一定被使用)

   - SA0 ext

- XPU block中的部分逻辑，包括

   - SA0 bas

   - SIP SCF

   - SIP AXI Bridge

   - ELCG控制逻辑

其余的逻辑，包括4个KG block，XPU block中PMU/RPC等等逻辑，都会被挡在Harvest逻辑之外，它们的输出信号会通过SA的 clamp信号被钳制为固定值

![图 032](libra_sip_arch_spec__figure_032.png)

ELCG的控制单元在SA中。在Harvest之后，SIP的ELCG需要依然作用于AXI bridge/SIP_SCF/L1 subsystem/BPM等moudle。

另外，在Harvest之后，SIP的逻辑ID会按照需要重排列，与SIP的物理ID不符。而SIP L1需要知道在Harvest之后的SIC ID和SIP ID， 来计算DSM Affinity Shared Buffer中Local和Remote的地址区间。因此SIP在L1 CSR上额外提供一个关于SIP逻辑ID的寄存器，需要在Harvest时配置，以满足L1模块的地址区域匹配要求。

SIP被Harvest之后，被clamp掉的那部分逻辑，其CF通路上的寄存器会通过SA bas中的RF阻挡，使得对这些寄存器的访问会固定返回response error。而对于SDMEM的访问则会被CDF NOC所阻挡，返回response error。

当SIP被Harvest之后，作为CF slave，需要被访问的地址段和被屏蔽的地址段包括：

|Module|Address Range|Accessable after Harvest?|
|---|---|---|
|L1 block|0xE00~0xEFF|Yes<br>需要配置L1的BLCG/RAS等寄存器|
|SIP SA|0x2000~0x4FFF|Yes|
|CDFNOC/DSMNOC|0x5800~0x5FFF|Yes|
||||
|Masked range 1|0x0~0xDFF|No|
|Masked range 2|0xF00~0x1FFF|No|
|Masked range 3|0x500~0x57FF|No|
|Masked range 4|0x6000~0x7FFF|No|

### 7.3. RPC Handler

#### 7.3.1. What is RPC

RPC是Scorpio中新定义的一种基于ECF NOC的软件通信协议。下面部分文字引用自AMOS Arch Spec.

RPC(Remote Process Call)的主要功能是构建Host和DTU环境下的分布式应用环境，在提供强大的远程调用能力的同时不损失本地调用的语义简洁性，即让调用者在做RPC时，感觉是本地调用一样。

RPC调用可以分为两种：

1. 双向调用 - 客户等待调用执行完成并返回结果

2. 单向调用 - 客户方调用后不用等待执行结果返回，但依然可以通过回调通知等方式获取返回结果。如果客户不关心调用返回结果，则变成单向异步调用，单向调用不用返回结果。

所以，单向调用和双向调用的区别在于是否等待服务端执行完成并返回结果。

一个完整的RPC调用系统，需要包括如下组件：

1. RPC Server - RPC服务提供方，它是远程服务方法的具体实现方，服务方法就是最普通的业务相关代码，它本身不止给RPC服务。

2. RPC Client - RPC服务的调用方。理想情况下，RPCClient完全不知道这是一个RPC的调用，实际情况是Client或多或少的都需要指定RPC的一些细节

3. RPC Proxy - RPC代理方，存在于客户端，因为要实现客户端对RPC空间“透明”调用，那么客户端不可能自行去管理消息格式、 不可能自己区里消息传输协议，也不可能自己去判断调用过程是否有异常。这一切工作在客户端都是交给RPC框架中的“代理”层来处理的。

4. Message Protocol - RPC Client和Server两端约定的消息格式的协议，RPC消息管理层负责对传输中的消息进行编码和解码操作

5. RPCChannel - RPC请求数据传递通道，用于Client和Server端的消息传递。在Scorpio中可以基于MIH或者SQ/CQ来传输消息。

6. Processor - 存在于RPC服务端，负责RPC服务端中客户端的识别、访问控制等。

![图 033](libra_sip_arch_spec__figure_033.png)

作为一种通用机制，RPC的基本结构如上图；根据具体应用，RPC Server可能实现在不同的地方。比如，作为Heap管理的RPC实现，RPC Server可能实现在SP或者AP上。

RPC架构是一个公用的架构，它可以实现任意的功能。目前看到的需要作为RPC实现的场景是：

1. 基于Heap的malloc/free

2. Host Callback

在SIP当中，主要实现对Heap的malloc/free的RPC通信机制。

1. 向Server端发送malloc请求，并接受Server端返回的malloc response信息。

2. 也可以向server端发送free请求，free请求属于单向调用不用返回结果。

**SIP的malloc Request格式定义如下：**

|Field|Width|Description|
|---|---|---|
|Type|[63:60]|RPC类型：1 - malloc|
|tag|[59:56]|[59:56]为reserved域，配置为全0|
|reserved|[55:32]||
|size|[31:0]|byte为单位的长度|

SIP的malloc Response格式定义如下：

|Field|Width|Description|
|---|---|---|
|Type|[63:60]|RPC状态for Response：<br>0 - Success<br>other value - Failed，detailed fail info may be encoding for different request|
|tag|[59:56]|Tag信息，Request中的tag会作为Response返回，Request方根据tag来区分对应请求order|
|reserved|[55:48]||
|address|[47:0]|malloc分配的地址|

**SIP的free Request格式定义如下：**

|Field|Width|Description|
|---|---|---|
|Type|[63:60]|RPC类型：2 - free|
|tag|[59:56]|[59:56]为reserved域，配置为全0|
|reserved|[55:48]||
|address|[47:0]|需要free的地址|

Free request是没有response的。

上面的Request和Response信息，都是基于ECF上的完整的AXI访问来实现的。Request由Client端发起，Response由Server端发起。AXI的访问形式为32bit 2burst Request。

**详细请见SP Arch Spec**

#### 7.3.2. SIP RPC

**Note：SIP4.0的RPC原本是按照per-sub-thead设计的。由于FCR，SIP上sub-thread-slot数量减少到10个。**

Libra SIP上设置了16组RPC接口，满足每个sub-thread进行独立RPC通信。RPC模块支持如下特性：

- 10个相互独立的的RPC编程接口和发送模块

   - 支持配置64bit请求数据和32bit请求地址

   - 对于目标地址HW自动做地址的SIP IO space-> ECF space的地址转换

- 利用Lite SA发送请求包

   - 请求仲裁之后

   - 利用message converter将64bit请求转换为32bit 2burst的AXI transaction

- 10个相互独立的RPC Receive FIFO

   - 每个编程接口使用2个固定的32bit CSR寄存器地址空间作为FIFO的入口和出口

      - RPC Server的response package就写入该地址空间

   - 每个FIFO最大支持接收1个RPC Client的response package，每个64bit

   - 当FIFO有package，通过LD指令读取package，然后通过写MSG_POP寄存器来弹出一个response package

- 通过polling方式获得通知

- 由于Libra SIP中放弃异步中断，因此如果sub-thread期望有RPC response，应当使用寄存器polling方式来获得状态

- 和SIP4.0相比，SIP4.0 RPC的变化如下：

![图 034](libra_sip_arch_spec__figure_034.png)

- 由原来两个独立的send/recive通路，扩展为10个通路

- 10个send通路到SA0 group7通路的仲裁算法依然为固定优先级，其中通路0优先级最高，通路9最低

- 通过SA0 group7通路的ASID接口传输thread-slot-ID，使得RPC-Server能够计算出正确的response地址

- 取消了中断通知机制，始终使用进行Polling的机制

   - 这是由于整个异步中断在Libra SIP上没有恢复

![图 035](libra_sip_arch_spec__figure_035.png)

以sub-thread-0的RPC的工作流程为例：

1. sub-thread-0读取发送启动寄存器，确认可以发送。阻塞当前发送的原因：

   1. 当前发送信息缓冲满了

2. sub-thread-0要发送melloc信息，配置发送寄存器，包括发送目的地址，发送message 高32bit，发送message 低32bit。

3. sub-thread-0配置发送启动寄存器，步骤1中的malloc信息进入发送信息缓存，发送信息缓存为深度为2的buffer。Buffer中存放发送信息，地址等内容。

   1. 每个sub-thread允许发出一个free 信息，再发出一个malloc信息，所以每个context的RPC的发送缓存有存储2个 masseage的能力。server端要为每个SIP提供接受4个message的缓存能力。

4. sub-thread-0发送缓存中的message经过仲裁（轮换优先级）后，组成一个Burst2的AXI写操作，通过SIP_SCF发给server端。

   1. 借助SA0的message collector来完成AXI请求转换功能。RPC发送控制把64bit的sideband接口呈现的内容转换为burst lens=2的cf写请求，通过SA0发送

   2. 当AXI写操作的response（注意不是RPC Response Package!)返回时，通过axi bridge反馈到RPC模块。

5. Server端查询到对应SIP的请求后，处理malloc request，可以从AX_user域区分出哪个SIP的哪个sub-thread发送malloc请求。并发送 malloc response信息，目的地址为对应SIP sub-thread的RPC Receive FIFO地址。通过SCF写入CSR中。

6. sub-thread-0轮循RPC通道0的Receive FIFO，直到处理模块在接受到response

7. sub-thread-0从RPC Receive FIFO中读取malloc response信息。

8. 读取完毕后，向对应的RPC_RCV_MSG_POP写1，将数据pop掉。

9. Sub-thread-0想要释放malloc的内存空间时，直接按照步骤1~4的流程向server端发送free信息。free信息属于单向调用模式。

10. Sub-thread-0发送完free信息，可以再次申请malloc空间，可参见步骤1~8。

#### 7.3.3. RPC Register Define

RPC模块在CSR上有10组寄存器，每组寄存器都由8个组成，功能类似。下面以sub-thread-0的寄存器为例进行说明：

|寄存器|说明|
|---|---|
|THD0_RPC_SEND_MSG_LO|sub-thread-0 RPC发送massage低32位|
|THD0_RPC_SEND_MSG_HI|sub-thread-0 RPC发送massage高32位|
|THD0_RPC_SEND_DST|sub-thread-0 RPC发送massage目的地址|
|THD0_RPC_SEND_CFG|sub-thread-0 RPC控制寄存器，启动发送<br>在发射前需要先读取该寄存器，确认是否可以发射|
|THD0_RPC_STS|sub-thread-0 RPC状态寄存器，当前收到的数据包个数|
|THD0_RPC_RCV_MSG_POP|sub-thread-0 RPC接收数据FIFO pop寄存器|
|THD0_RPC_RCV_MSG_LO|sub-thread-0 RPC收到massage低32位|
|THD0_RPC_RCV_MSG_HI|sub-thread-0 RPC收到massage高32位|

### 7.4. Customized Trace Handler

#### 7.4.1. Overview

在Libra SIP中，对于profiling功能新增加了一种接口：customized event。这种接口允许sub-thread在某个时间点向CF总线上传一个自定义的message。它和Event trace有些类似，但是message信息可以自定义，长度在4B~64B之间可变（颗粒度为4B）。这个信息先送入SIP common CSR中的customized trace handler(CTH)中，然后连接到SA0的customized event agent (CTA)上，以CF 总线上的多burst方式传递给目的地。在发送过程中，SA0会自动给message加上46bit的timestamp（来源于SSM timer）。

Libra SIP的CTH向SIP上的每一个sub-thread提供了一个发送Customized Trace Message的CSR通道。而CTH将这个message转换为SA0上CTA的接口，连接到CTA group上

#### 7.4.2. 基本结构

**Note：SIP4.0的CTH原本是按照per-sub-thead设计的。由于FCR，SIP上sub-thread-slot数量减少到10个。**

CTH的基本结构如下：

- 10个宽度为4B，深度为16的Message buffer

   - 每个Message buffer可以给每个thread-slot **一个** customized trace massage的缓冲

   - 每个Message buffer可以通过独立的CSR寄存器访问每个entry

- 每个Message buffer的CSR寄存器接口

   - CTH_MSG_DAT

   - CTH_MSG_IDX

   - CTH_CFG

- 每个Buffer的输出接口如下：

   - req和bsy信号

   - event_head/event_tail，分别用来标识第一个有效传输和最后一笔有效传输

   - counter信号，指示本次messag有多少比有效数据

   - context ID信号，来源于SA0的axusr

master ID信号，来源于SA0的axusr，末尾2bit tie-off为2'b01

   - process ID信号，来源于线程所对应的PROCESS_ID_WRK寄存器

   - custom_type信号，其中[8:4]来源于CSR寄存器

- 10个Message buffer，每4个一组聚合仲裁，输出到3个channel

   - Buffer0~Buffer3仲裁，Buffer4~Buffer7仲裁，Buffer8/Buffer9仲裁

**仲裁采用固定优先级**

在仲裁之后，如果当前message buffer内包含有效数据并且出于发射状态，则保持仲裁选择，直到该Message buffer成功发射

仲裁必须保持一个完整的Message传输

![图 036](libra_sip_arch_spec__figure_036.png)

#### 7.4.3. 工作流程

每个sub-thread通过CTH和SA的CTA传输message的流程如下：

1. 每个sub-thread通过自身的thread-slot-id找到对应Message Buffer的CSR入口

2. 按照下一章节的编程方法，写入需要传输的message，并且设置发送

   1. 对CTH_CFG的SEND域写1

3. 该Message Buffer出于发射状态，和相邻的Message Buffer竞争同一个CTA的channel

4. 在获得仲裁之后，该Message Buffer连接到CTA channel，采用req-bsy接口进行发送

   1. 仲裁一旦选定一个Message Buffer后，必须维持到该Buffer发送完毕，期间不能切换

5. 一旦握手通过，Message Buffer依次多拍传输Message数据

   1. 每次4个Byte，期间不会有反压

6. 传输结束之后，该channel会重新仲裁。而Message Buffer也会清SEND域，做好下一次Message发送准备

#### 7.4.4. 寄存器编程接口

CTH上有10组寄存器，每组寄存器都由3个寄存器组成，功能类似。下面以sub-thread-0的寄存器为例进行说明：

|寄存器|说明|
|---|---|
|THD0_CTH_MSG_DAT|sub-thread-0 Message Buffer的数据读写接口|
|THD0_CTH_MSG_IDX|sub-thread-0 Message Buffer的数据读写index<br>可以直接读写，也可以通过写THD0_CTH_MSG_DAT对本寄存器进行自增|
|THD0_CTH_CFG|sub-thread-0 Message的传输控制寄存器<br>TYPE_HI域用于指定custom_type信号的高5bit<br>COUNTER域用于指定counter信号，即有效传输周期数-1<br>SEND域兼做发射控制信号以及发射状态指示|

|Register Name: THD0_CTH_MSG_DAT|Register Name: THD0_CTH_MSG_DAT|Register Name: THD0_CTH_MSG_DAT|Register Name: THD0_CTH_MSG_DAT|Register Name: THD0_CTH_MSG_DAT|
|---|---|---|---|---|
|Offset Address: 0x1100|||||
|Field|Bit|Reset<br>Value|RW|Description|
|MSG_DAT|31:0|0|WO|Data port for thread0 message queue. The index of message queue is<br>THD0_CTH_MSG_IDX<br>Write to this register will put data into entry of<br>THD0_DATA_QUEUE[THD0_CTH_MSG_IDX] and then increase<br>THD0_CTH_MSG_IDX.|

|Register Name: THD0_CTH_MSG_IDX|Register Name: THD0_CTH_MSG_IDX|Register Name: THD0_CTH_MSG_IDX|Register Name: THD0_CTH_MSG_IDX|Register Name: THD0_CTH_MSG_IDX|
|---|---|---|---|---|
|Offset Address: 0x1104|||||
|Field|Bit|Reset<br>Value|RW|Description|
|MSG_IDX|3:0|0|RWHW|Index of thread0 message queue. Can be updated by direct write. Will<br>do self increase by writing to THD0_CTH_MSG_DAT.|

|Register Name: THD0_CTH_CFG|Register Name: THD0_CTH_CFG|Register Name: THD0_CTH_CFG|Register Name: THD0_CTH_CFG|Register Name: THD0_CTH_CFG|
|---|---|---|---|---|
|Offset Address: 0x110C|||||
|Field|Bit|Reset<br>Value|RW|Description|
|TYPE_HI|12:8|0|RWHW|CTA event_type[8:4] field.|
|COUNTER|7:4|0|RWHW|4*(COUNTER+1) means how many byte to be sent for this message|
|SEND|0:0|0|RWHW|"0" means this message queue is idle. "1" means this message<br>queue is busy to sending message.<br>When this field is "0", write "1" to start sending a message. And SW<br>cannot write "0" to stop the busy queue<br>Before config a message, SW should poll this field to make sure the<br>queue is idle.|

**编程流程如下：**

- 每个sub-thread，根据自己的sub-thread-slot-id (注意不是sub_thread_id)，找到对应自己的4个CTH寄存器反复读取THD*_CTH_CFG，直到确认SEND域为0

   - 此时SEND域作为发射pending状态指示作用

- 配合使用THD*_CTH_MSG_DAT和THD*_CTH_MSG_IDX，向buffer写入要传输的数据

   - 最简单的方法是，将THD*_CTH_MSG_IDX设置为0，然后顺序向THD*_CTH_MSG_DAT连续写入message的数据段 THD*_CTH_MSG_IDX会随着写THD*_CTH_MSG_DAT而自增

   - 如果要改写当中某个entry，必须遵循先修改THD*_CTH_MSG_IDX再写入THD*_CTH_MSG_DAT的规则

- 准备好TYPE_HI域和COUNTER域，并将SEND域设置为1，写入THD*_CTH_CFG

   - 当SEND域写1，则触发该message buffer进入到发射状态。该域直到发射完成才会由硬件清0，不能通过写0来清0 在SEND域为1期间，禁止对其他三个寄存器进行写操作

#### 7.4.5. 与CTA的接口

**与CTA的接口信号如下：**

|Interface|Direction|Connection|Comment|
|---|---|---|---|
|ip_cta_grp5_event_buff_freesize<%g%><br><%c%>|output|Dangle||
|ip_cta_grp5_event_bsy<%g%><%c%>|output|Common CSR<br>CTH|和CTH模块的握手信号：bsy|
|ip_cta_grp5_event_req<%g%><%c%>|input|Common CSR<br>CTH|和CTH模块的握手信号：req|
|ip_cta_grp5_event_head<%g%><%c%>|input|Common CSR<br>CTH|传输辅助信号，第一笔传输拉高|
|ip_cta_grp5_event_tail<%g%><%c%>|input|Common CSR<br>CTH|传输辅助信号，最后一笔传输拉高|
|ip_cta_grp5_counter<%g%><%c%>|input|SIP SA context<br>ID|CTH仲裁后输出的Message的数据量|
|ip_cta_grp5_ctxid<%g%><%c%>|input|Common CSR<br>CTH|SA0输出axusr的ctxid域|
|ip_cta_grp5_mstid<%g%><%c%>|input|Common CSR<br>CTH|SA0输出axusr的master ID域<br>最低2bit tie-off为2‘b01|
|ip_cta_grp5_processid<%g%><%c%>|input|Common CSR<br>CTH|Message Thread的PROCESS_ID寄存<br>器|
|ip_cta_grp5_custom_type<%g%><%c%>|input|Common CSR<br>CTH|{THD*_CHT_STS.TYPE_HI,<br>THD_SLOT_ID}|
|ip_cta_grp5_content<%g%><%c%>|input|Common CSR<br>CTH|Message数据接口，传输时每周期变<br>化|

**在传输过程中，遵循以下标准：**

**遵循req-bsy协议**

**valid-ready协议的变形**

- 只有第一个周期的传输会有握手行为。第一个周期握手成功后，message传输期间CTH保证REQ始终拉高，CTA保证BSY 始终拉低，直到整个message完成传输

每个周期最多传输4B有效数据

**对于第一个周期，需要给出其他信息**

   - event_head，指示第一个数据包。valid第一次拉高时就拉高，直到第一笔传输完成拉低

   - counter，指示有多少个传输周期（周期数为counter+1），整个传输周期维持不变

   - ctxid，该域来源于SA0 axusr寄存器的[15:12]，整个传输周期维持不变

   - masterid，该域来源于SA0 axusr寄存器的[9:0]，整个传输周期维持不变

   - processid，该域来源于对应线程(thread-slot-id)的PROCESS_ID_WRK寄存器，，整个传输周期维持不变

   - custom_type，低4bit为thread-slot-id，高5bit来源于该线程的的THD*_CHT_STS寄存器的TYPE_HI域

- 传输过程中，content接口为message的数据，由message buffer低到高，依次输出

- 对于最后一个周期，需要拉高event_tail一个周期

如果只有一个entry有效，则event_tail会和event_head同时拉高和拉低。

![图 037](libra_sip_arch_spec__figure_037.png)

### 7.5. System Adapter
#### 7.5.1. Overview

System Adapter模块是一个通用接口模块，负责多项功能，和各个IP core合并起来作为整体使用。在实例化过程中，可以根据IP需要对SA模块内进行增减。在SIP4.0中，例化了SA0。由于XPU和L1的tile划分，SA也被分为两个部分，其中和AXI Bridge相连的部分放到XPU的tile上，而和AXI master0/master1相连的部分放到L1的tile上。但是逻辑上仍然视为同一个moudle

和SIP3.0相比，SIP4.0 SA0不再分为top SA和core Lite SA两个实例，但是SA0依然继承了原来top SA和Lite SA两者的功能，并且增加了多线程情况下对Message Collector的支持，以及增加了Normal Interrupt和Customized Trace的支持。

SA模块的文档请见System Adapter Arch Spec和Message Collector Arch Spec.

SIP4.0对于SA0的定制请见SA ERB Config

#### 7.5.2. Clock, Reset & ELCG

SIP4.0中，SA0不在负责SIP的clock管理和Reset管理。这部分功能被挪动到CRG中。因此SA0的clock只有输入，clock输出均为 dangle。而ELCG功能中的每个unit（SIP CORE，AXI bridge，HwSync，etc）的idle信号通过ELCG_CTRL汇聚到SA0，并最终输出 ELCG控制信号汇聚，送到CRG中。这是由于SA0连接了外部的ECF/EDF maste接口，可以在必要时唤醒ELCG

**接口信号连接如下：**

|Interface|Direction|Connection|Comment|
|---|---|---|---|
|i_ssm_clk|input|o_ssm_clk|CRG模块输出|
|i_ssm_free_clk|input|o_ssm_free_clk|CRG模块输出|
|i_df_clk|input|o_sip_harv_sku_clk_0(SA base)<br>o_sip_harv_sku_clk_1(SA ext)|CRG模块输出|
|i_cf_clk|input|o_sip_harv_sku_clk_0(SA base)<br>o_sip_harv_sku_clk_1(SA ext)|CRG模块输出|
|i_ip_clk<%i>|input|o_sip_harv_sku_clk_0(SA base)<br>o_sip_harv_sku_clk_1(SA ext)|CRG模块输出|
|o_ip_cf_clk_elcg_en|output|dangle||
|o_ip_df_clk_elcg_en|output|dangle||
|o_ip_clk_elcg_en<%i>|output|SIP_CRG||
|||||
|i_ssm_cold_rst_n|input|o_cold_sku_harv_rst_n_ssm_clk|CRG模块输出|
|i_cf_cold_rst_n|input|o_sku_harv_rst_n_sip_clk|CRG模块输出|
|i_df_cold_rst_n|input|o_sku_harv_rst_n_sip_clk|CRG模块输出|
|i_ip_cold_rst_n|input|o_sku_harv_rst_n_sip_clk|CRG模块输出|
|i_ip_rst_n|input|o_sku_harv_rst_n_sip_clk|CRG模块输出|
|i_cf_rst_n|input|o_sku_harv_rst_n_sip_clk|CRG模块输出|
|i_df_rst_n|input|o_sku_harv_rst_n_sip_clk|CRG模块输出|
|i_ssm_rst_n|input|o_sku_harv_rst_n_ssm_clk|CRG模块输出|
|||||
|i_ip_bsy|input|ELCG_CTRL|SIP Core/AXI Bridge/HwSync/Mailbox<br>等模块的idle汇聚|

#### 7.5.3. Harvest

SIP4.0被Harvest时，是通过SA的clamp寄存器来提供clamp信号的。

#### 7.5.4. CF & DF interface

SIP4.0和ECF交互的master接口/salve接口，以及和DSM/EDF交互的三个master接口，都穿过了SA0。而外部ECF master和 DSM/EDF master访问SIP内部时，也可以通过SA0来唤醒ELCG。

SIP的3个EDF slave接口不经过SA0

|Interface|Direction|Connection|Comment|
|---|---|---|---|
|sa_cf_m0_*|AXI master|SIP ECF master interface|SIP到ECF NOC上的master接口<br>为SIP_SCF mster接口穿透SA的输出|
|cf_ip_sa_s0_*|AXI slave|SIP_SCF|SIP_SCF mster连接到SIP SA slave接口|
|||||
|cf_sa_s0_*|AXI slave|SIP ECF slave interface|SIP上的slave接口，连接到ECF NOC的master|
|cf_sa_ip_m0_*|AXI master|SIP_SCF|SIP SA连接到SIP_SCF的master接口<br>为ECF mster接口穿透SA的输出|
|||||
|mc_sa_cf_m0_*|AXI master|SIP_SCF|连接SIPCF1的SIP SA MC slave接口<br>所有Message的输出均通过这个接口|
|||||
|sa_df_m0_*|AXI master|SIP EDF master interface|SIP连接到EDF NOC上的master0接口|
|sa_df_m1_*|AXI master|SIP EDF master interface|SIP连接到EDF NOC上的master1接口|
|sa_df_m2_*|AXI master|SIP EDF master interface|SIP连接到EDF NOC上的master2接口<br>为ICache访存接口|
|df_ip_sa_s0_*|AXI slave|SIP L1 module|SIP L1连接到SA上的master通路<br>穿透SA后为sa_df_m0_*|
|df_ip_sa_s1_*|AXI slave|SIP L1 module|SIP L1连接到SA上的master通路<br>穿透SA后为sa_df_m1_*|
|df_ip_sa_s2_*|AXI slave|ICache|SIP ICache连接到SA上的master通路<br>穿透SA后为sa_df_m2_*|

##### 7.5.4.1. ECMO

SIP4.0不再使用SA0的ECMO进行AXI交易保护。这是由整个BLR被设置为SIC层次，由专门的ECMO在SIC和EDF边界上进行保护。而本次SIP所使用的SA0中也不包含ECMO逻辑。

##### 7.5.4.2. BPM

SIP4.0不再利用SA0的BPM进行总线性能统计，而是在SIP的master0和master1上外接两个专用的BPM模块进行统计

##### 7.5.4.3. Bus Parity Check

SA0提供了ECF总线中的parity的产生和检查功能

目前EDF接口上不使用SA0的parity功能，而由L1来完成操作

Open：对于EDF接口，可能会视情况替换为ECC

|接口|Bus parity产生|Bus parity检查|
|---|---|---|
|SIP SCF master -> ECF slave接口，<br>Write data|SA0在w_user上添加bus<br>parity bit||
|SIP SCF master -> ECF slave接口，<br>Read response||SA0负责检查bus parity，并修改r_user<br>SIP内部逻辑根据检查结果，决定是否上报Error<br>Interrupt|
|ECF master -> SIP SCF slave接口，<br>Write data||SA0负责检查bus parity，并修改w_user<br>SIP内部逻辑根据修改后的w_user，决定b_usr信<br>息|
|ECF master -> SIP SCF slave接口，<br>Read response|SA0在r_user上添加bus<br>parity bit||
|SIP DF master -> EDF slave接口，<br>Write data|SIP L1逻辑自行产生parity<br>信息||
|SIP DF master -> EDF slave接口，<br>Read response||SIP L1逻辑自行检查parity正确与否并决定是否上<br>报Error Interrupt|
|EDF master -> SIP DF slave接口，<br>Write data||SIP L1逻辑自行检查parity正确与否并决定b_usr信<br>息|
|EDF master -> SIP DF slave接口，<br>Read response|SIP L1逻辑自行产生parity<br>信息||

详情请见RAS章节

##### 7.5.4.4. SA XMC

SIP采用如下方式使用XMC：

- SIP4.0中，利用了XMC对SIP master接口到EDF的读/写请求的地址重映射

   - SIP 3条DF master通路上各有一个XMC instance，均为1024bit数据位宽，但是没有burst拆分和ID重映射单元

      - SIP4.0不会使用SA XMC中的burst拆分和AXID重分配功能

对于乱序返回的数据，Reorder总是由SIP内部的模块自己完成，包括L1和ICache

对于master0/master1接口访问DSM的Shared Affinity Buffer和Shared Non-Affinity Buffer，XMC各自进行映射

对于Shared Non-Affinity Buffer，XMC需要做Hash功能

SIP的CF master通路有一个XMC instance，数据位宽为32bit

32个aperture用于支持VG/VF功能

支持4bit VF ID

支持VF ID overwrite

所有输入VF ID被overwrite成一个相同数值

支持30bit地址remapping

16个aperture用于支持SIP harvest的remapping

支持30bit地址remapping

##### 7.5.4.5. CSR Access Security

SIP SA提供SIP CSR寄存器访问的security机制

- 在CF slave通路上，SIP SA提供了16个可编程的address group，按group配置访问权限，最小地址颗粒度是4B

   - 基于Init ID进行保护，和XMC的机制不同

   - 对于SIP使用address group保护的寄存器段，规则如下：

      - 由Debugger或者SSM配置的寄存器，即不允许外部kernel代码修改的寄存器。

没有落入16 group的寄存器地址空间，都落入default group，即不受保护的寄存器

SA自己会占用8组寄存器权限控制的address group，给SIP留出8组

SIP CSR占用另外5组address group，对这些寄存器访问提供权限保护

这些address group不会对自身的SIP core进行权限限制

另外XMC提供了基于Context ID隔离的SIP访问ECF的security机制。

有SIP线程和L1 HwSync发出的本地访问，不受SA的serurity保护限制

|Type|Who-Config|SA Address Group Number|
|---|---|---|
|LCH0_CFG|SP/Supervisor||
|LCH0_NXT|RO||
|LCH1_CFG|SP/Supervisor||
|LCH1_NXT|RO||
|APP|SP/Supervisor||
|Mailbox-CFG|SP/CDTE/SIP thread||
|Thread-Status|RO/Debugger/Supervisor||
|HW-Debugger|Debugger|1 group|
|Boot-XPU|SSM/Driver|Boot系列共用一个group|
|Boot-IMEM|SSM/Driver|Boot系列共用一个group|
|Boot-L1|SSM/Driver|Boot系列共用一个group|
|RPC-CFG|SIP code||
|CTH-CFG|SIP code||
|PMU-CFG|SSM/SIP code|1 group|
|OBS-CFG|Debugger||
|SA0|SSM|SA0自身的address group保护|
|L2M|SSM|1 group|
|BPM0|Profiler||
|BPM1|Profiler||
|HW sync|SIP thread/SDTE||

#### 7.5.5. Message Collector

SIP4.0对于SA0中Message Collector的使用延续了SIP3.0对于Core Lite SA的用法。下面为详细介绍具体的功能和连接。

##### 7.5.5.1. Error Interrupt

**Causion: SIP4.0中EXCP_ADDR_UNALIGN，EXCP_MIX_ATTR，EXCP_PC_ERR，EXCP_VACC_INVALID，EXCP_REAL_SIZE， EXCP_VL被舍弃**

这里的Error Interrupt指SIP4.0的流水线触发了Error exception之后，通过SA0的Error Interrupt Agent上报到SP/PCIE。SA0提供了两组Error Interrupt Agent，即Group0和Group1。其中Group0会被配置为固定向SP上报，Group1被固定配置为向PCIE上报。 因此所有的Error Interrupt信号都会连接到两个Group上。每个Group均提供了24组channel。由于SIP包含多个sub-thread，每个线程上的Error信号经过仲裁之后再送到两个Group上。如下图所示：

![图 038](libra_sip_arch_spec__figure_038.png)

这里的MUX采用的是固定优先级。其中Thread0优先级最高，Thread15优先级最低。

对于Error Exception，由于采用的是valid only的接口，当多个Thread同时触发了同一种类型的Error Exception，经过仲裁后会产生Exception丢失。由于SIP任意一个sub-thread触发了Error Exception之后，都会使得流水线进入Halt状态（某些Exception有可能导致hang），因此这里后发生的exception可能会丢失。

每种Error Exception和channel的连接关系，以及Exception Vector请见8.15.3的SIP Error Interrupt章节

对于源自SIP自身的Error Interrupt，在经过仲裁之后，流水线输出信号和Error Exception的信号连接关系如下：

无论Error Interrupt还是Normal Interrupt，ASID域用于传输Thread-slot-ID

|Interface|Direction|Connection|Comment|
|---|---|---|---|
|ip_err_int_grp0_req<%c%><br>ip_err_int_grp1_req<%c%>|input|Exception valid signal||
|ip_err_int_grp0_ctxid<%c%><br>ip_err_int_grp1_ctxid<%c%>|input|SA0 Context ID|SA0输出axusr的VF域|
|ip_err_int_grp0_mstid<%c%><br>ip_err_int_grp1_mstid<%c%>|input|当前SIP的master ID|SA0输出axusr的master ID域<br>最低2bit tie-off为2‘b01|
|ip_err_int_grp0_asid<%c%><br>ip_err_int_grp1_asid<%c%>|input|THD_SLOT_ID|经过仲裁后的线程槽ID|

而对于channel==8/12的DSM NOC/CDF NOC错误上报，则采用如下连接：

|Interface|Direction|Connection|Comment|
|---|---|---|---|
|ip_err_int_grp0_req<%c%><br>ip_err_int_grp1_req<%c%>|input|Exception valid signal||
|ip_err_int_grp0_ctxid<%c%><br>ip_err_int_grp1_ctxid<%c%>|input|SA0 Context ID|SA0输出axusr的VF域|
|ip_err_int_grp0_mstid<%c%><br>ip_err_int_grp1_mstid<%c%>|input|当前SIP的master ID|SA0输出axusr的master ID域<br>最低2bit tie-off为2‘b01|
|ip_err_int_grp0_asid<%c%><br>ip_err_int_grp1_asid<%c%>|input|0|固定连接为0|

##### 7.5.5.2. Normal Interrupt

**Causion: SIP4.0中TRAP1指令被舍弃**

SIP4.0利用Message Collector的Normal Interrupt Agent（Group2）上传SIP线程执行过程中的一些特殊状态。这些特殊状态包括如下：

- 执行TRAP0指令

- ~~执行TRAP1指令~~

- ~~触发Watchpoint~~

- 触发Breakpoint

SIP4.0多个sub-thread上报normal interrupt的机制和Error Interrupt类似，即每一种中断类型先在多个sub-thread之中进行仲裁，然后通过Group2的一个channel进行上传。

![图 039](libra_sip_arch_spec__figure_039.png)

Normal Interrupt的仲裁方法依然是固定优先级。 **由于该中断上报是不能反压流水线的，因此Normal Interrupt会比Error Interrupt出现更加明显的Event丢失问题。**

每种Error Exception和channel的连接关系，以及Exception Vector见下表：

|Interrupt Type|Channel|Exception Vector|Comment|
|---|---|---|---|
|INTR_TRAP0|0|0x40|自定义vector|
|~~INTR_TRAP1~~|~~1~~|~~0x41~~|~~自定义vector~~|
|~~INTR_WATCHPOINT~~|~~2~~|~~0x42~~|~~自定义vector~~|
|INTR_BREAKPOINT|3|0x43|自定义vector|

**在经过仲裁之后，流水线输出信号连接关系如下：**

无论Error Interrupt还是Normal Interrupt，ASID域用于传输sub-thread-slot-ID

|Interface|Direction|Connection|Comment|
|---|---|---|---|
|ip_normal_int_grp2_req<%c%>|input|Exception valid signal||
|ip_normal_int_grp2_ctxid<%c%>|input|SA Context ID|SA0输出axusr的VF域|
|ip_normal_int_grp2_mstid<%c%>|input|当前SIP的master ID|SA0输出axusr的master ID域<br>最低2bit tie-off为2‘b01|
|ip_normal_int_grp2_asid<%c%>|input|THD_SLOT_ID|经过仲裁后的线程槽ID|

##### 7.5.5.3. Profile Agent

IP Core使用Message Collector中的Profile Agent（即group3），实现signal profiling的行为

- Profile Agent提供了56个channel，但是SIP core有三组56bit信号需要进行profiling。当中会有些转换逻辑详见Performance Monitor

**信号连接如下：**

|Interface|Direction|Connection|Comment|
|---|---|---|---|
|ip_profile_grp_grp3_pmc_evt|input|common CSR|XPU CSR将流水线信号处理后的输入|
|ip_profile_grp_grp3_pmc_vec|input|Tie-off|SIP流水线不使用|
|ip_profile_grp_grp3_pmc_event_start|input|common CSR|XPU CSR对start group选择之后的start<br>event|
|ip_profile_grp_grp3_pmc_event_stop|input|common CSR|XPU CSR对stop group选择之后的stop<br>event|
|ip_profile_grp_grp3_ctxid|input|SA Context ID|SA0输出axusr的VF域|
|ip_profile_grp_grp3_mstid|input|当前SIP的master<br>ID|SA0输出axusr的master ID域<br>最低2bit tie-off为2‘b01|

##### 7.5.5.4. Event Trace

SIP4.0利用SA中的2个Event Trace Agent来上报下列8种线程的特殊场景

- Type0：Thread由halt进入run状态

- Type1：Thread由non-halt进入halt状态

- Type2：Thread由non-run进入run状态

- Type3：Thread由run进入non-run状态 Type4：Thread由非wait进入到wait mailbox

- Type5：Thread由wait mailbox退出

Type6：Thread由非wait进入到wait gsync

Type7：Thread由wait gsync退出

由于SIP4.0一共有10个sub-thread可以并行执行，因此一共有80个Event类型（10 thread * 8event）。但是2个Event Trace Agent 只能提供最多64个Event Channel。因此SIP4.0采用如下策略复用Event channel，尽可能避免Event信息的丢失。

每个sub-thread，占用2个Event Trace的channel。

Event Trace Agent 0的32个channel依次给Thread0~7使用，每个thread单独占用4个

Event Trace Agent 1的8个channel依次给Thread8~9使用，每个thread单独占用4个

- 每个sub-thread中，下列event复用同一个channel

   - Type0，Type3复用同一个线程的第一个event channel

   - Type1，Type2复用同一个线程的第二个event channel

   - Type4，Type6复用同一个线程的第三个event channel

   - Type5，Type7复用同一个线程的第四个event channel

   - 这些复用考虑了流水线的情况。实际上同一个channel的type并不会同一个cycle同时出现

   - 每个sub-thread的每个Event，都可以由ETA_CTRL系列寄存器控制开启和关闭

- 在SIP流水线侧，对于每个channel，采用固定优先级仲裁两种event，并且存储到一个内部的发射队列上，对接到Event Trace Agent（ETA）的接口上

   - 发射队列的深度可以使用参数配置。默认为1

   - 该发射队列虽然采用类似valid-ready的接口和ETA相连，但是并不预期反压

      - SA的ETA通路必须为允许丢包的模式。这样如果出现丢包，会记录在SA中。流水线看不到丢包的情况

- 在Event的发射队列和ETA的接口上，使用9bit Event Type接口区分thread和Event

   - event_type[3:0]携带SIP的thread-slot-id

   - event_type[6:4]携带type类型

event_type[8:7]tie-off为0

**信号连接如下：**

|Interface|Direction|Connection|Comment|
|---|---|---|---|
|ip_eta_grp4_event_bsy<%g%><%c%>|output|流水线Event Trace接口|和流水线的握手信号：bsy|
|ip_eta_grp4_event_req<%g%><%c%>|input|流水线Event Trace接口|和流水线的握手信号：req|
|ip_eta_grp4_packet_info<%g%><%c%>|input|流水线Event Trace接口|每个Thread的PACKAGE_ID寄存器|
|ip_eta_grp4_ctxid<%g%><%c%>|input|流水线Event Trace接口|SA0输出axusr的VF域|
|ip_eta_grp4_mstid<%g%><%c%>|input|流水线Event Trace接口|SA0输出axusr的master ID域<br>最低2bit tie-off为2‘b01|
|ip_eta_grp4_processid<%g%><%c%>|input|流水线Event Trace接口|每个Thread的PROCESS_ID寄存器|
|ip_eta_grp4_event_type<%g%><%c%>|input|流水线Event Trace接口|详见上面描述|

**Note1 ：以req为例，两组ETA接口的名称规则如下：**

第一个ETA的接口为ip_eta_grp4_event_req00~ip_eta_grp4_event_req031

   - 最高位数字恒定为0

   - 最低的1~2位数值为0~31变化

- 第二个ETA的接口为ip_eta_grp4_event_req10~ip_eta_grp4_event_req131

   - 最高位数字恒定为1

最低的1~2位数值为0~31变化

**Note2** ：PACKAGE_ID和PROCESS_ID为launch寄存器传递。需要注意event在halt进入run状态，和进入halt状态时传递正确的数值。

- 当Kernel Launch时，PACKAGE_ID和PROCESS_ID为正在launch的新thread的配置，而非上一个thread遗留的配置

Thread Halt时，PACKAGE_ID和PROCESS_ID为刚刚进入halt状态的上一个thread的配置，而非下一个launch的thread的配置

##### 7.5.5.5. Customized Trace

SIP流水线新增了一个Customized Trace handler（CTH），对接SA0 Message Collector中的Customized Trace Agent（即 group5），为每个sub-thread提供一个传递4B~64B自定义信息的功能，主要用于功能profiling。

- 16个CTH通道在CTH模块中，通过每4个一组仲裁方式，合并输出4个接口。对接到group5的4个channel上。

   - 采用固定优先级仲裁

由于FCR，实际真正使用的为0~9个CTH通道

该传输采用类似Valid-ready的握手协议，并且在CTH接口上采用软件约束的方式，避免丢包

每组的数据长度可变，并通过group5转换为CSR上的可变burst write reqeust

- 一个完整的message包含4~64B，CTH在每个channel上每次传输4byte，因此需要1~16周期完成一个完整message的传输

- 如果CTH有有效message时，拉高req，并准备好辅助信号。当某一周期req=1并且bsy=0，则开始该message的第一笔数据传输

   - 在传输第第一笔数据时，需要准备好的辅助信号包括event_req，event_head，ctxid，counter，mstid， processid，custom_type

在第一笔传输完成后，bsy信号会持续拉低直到所有数据传输完成。

   - 在传输最后一笔数据时，event_tail拉高。对于只有一笔数据的message，event_tail和event_head都在第一拍拉高

- 传输过程中，content不停变化数据，直到传输完成。除了event_head/event_tail之外的辅助信号保持不变

   - event_head只在第一笔数据传输时有效，之后拉低

   - event_tail只在传输最后一笔数据时有效

   - 如果只有一笔数据，则event_head和event_tail同时拉高

- 在Event的的接口上，使用9bit Event Type接口区分thread和Event

   - event_type[3:0]携带SIP的thread-slot-id

event_type[8:4]为sub-thread配置CTH寄存器

**这组接口信号连接如下：**

|Interface|Direction|Connection|Comment|
|---|---|---|---|
|ip_cta_grp5_event_buff_freesize<%g%><br><%c%>|output|Dangle||
|ip_cta_grp5_event_bsy<%g%><%c%>|output|Common CSR<br>CTH|和CTH模块的握手信号：bsy|
|ip_cta_grp5_event_req<%g%><%c%>|input|Common CSR<br>CTH|和CTH模块的握手信号：req|
|ip_cta_grp5_event_head<%g%><%c%>|input|Common CSR<br>CTH|传输辅助信号，第一笔传输拉高|
|ip_cta_grp5_event_tail<%g%><%c%>|input|Common CSR<br>CTH|传输辅助信号，最后一笔传输拉高|
|ip_cta_grp5_counter<%g%><%c%>|input|SIP SA context ID|CTH仲裁后输出的Message的数据<br>量|
|ip_cta_grp5_ctxid<%g%><%c%>|input|Common CSR<br>CTH|SA0输出axusr的VF域|
|ip_cta_grp5_mstid<%g%><%c%>|input|Common CSR<br>CTH|SA0输出axusr的master ID域<br>最低2bit tie-off为2‘b01|
|ip_cta_grp5_processid<%g%><%c%>|input|Common CSR<br>CTH|Message Thread的PROCESS_ID寄<br>存器|
|ip_cta_grp5_custom_type<%g%><%c%>|input|Common CSR<br>CTH|详见上面描述|
|ip_cta_grp5_content<%g%><%c%>|input|Common CSR<br>CTH|Message数据接口，传输时每周期<br>变化|

![图 040](libra_sip_arch_spec__figure_040.png)

关于CTH模块的详细描述，请见CTH Handler章节。

##### 7.5.5.6. Log Buffer

SIP Core使用Message Collector中的Log Buffer，即group6，起到debug print的功能。这一点和SIP3.0上保持一致。 SIP4.0的SA中，对于Log buffer在编程上新增了一个Process ID的寄存器。

另外，多个sub-thread在使用SA0的Log buffer时，必须先用锁机制竞争log buffer资源。否则会出现资源冲突的问题。

##### 7.5.5.7. Communication Agent

SIP 流水线将Message Collector中的第一个communication agent（即group7）连接RPC模块输出，实现RPC协议

- SIP Common CSR中的RPC模块经过10个RPC通道仲裁后，得到一个RPC输出，送入group7中，负责向RPC server发送RPC请求

   - 由于SIP4.0中sub-thread扩展为10个4bit，因此复用ASID域传递Thread-Slot-ID域。

   - RPC Server需要解析ASID域，向SIP RPC中对应该thread的CSR地址返回Response。

- 由于RPC的传输是不可以被丢弃的，RPC和Communication Agent的连接是类似Valid-ready的握手协议

- 这里固定为64bit数据输入，经过group7转换为32bit的2burst AXI write request

**关于RPC模块的描述，请见RPC Handler章节**

|Interface|Direction|Connection|Comment|
|---|---|---|---|
|ip_communi_grp7_bsy0|output|Common CSR RPC|和RPC模块的握手信号：busy|
|ip_communi_grp7_req0|input|Common CSR RPC|和RPC模块的握手信号：req|
|ip_communi_grp7_awid0|input|6‘b0|固定awid|
|ip_communi_grp7_ctxid0|input|SIP SA context ID|SA0输出axusr的VF域|
|ip_communi_grp7_mstid0|input|Common CSR RPC|SA0输出axusr的master ID域<br>最低2bit tie-off为2‘b01|
|ip_communi_grp7_asid0|input|Common CSR RPC|RPC进行仲裁之后的Thread-slot-ID|
|ip_communi_grp7_pri0|input|4‘b0|固定priority|
|ip_communi_grp7_adr0|input|Common CSR RPC||
|ip_communi_grp7_dat0|input|Common CSR RPC||
|ip_communi_grp7_len0|input|4‘b1|固定2 burst|

SIP 流水线不使用Message Collector中的第二个communication agent。它的输入信号被tie-off，输出信号dangle

SIP 流水线将Message Collector中的第二个communication agent（即group9）连接流水线的HwDebugger输出逻辑，实现HW Breakpoint/Address Watchpoint/Trap0触发debug mode时，被触发sub-thread对于相同Kernel其他sub-thread的STOP命令。

- 流水线的HW debugger逻辑，对16个thread-slot进行仲裁之后，输出一个有效的传输请求

   - 采用固定优先级仲裁

   - 由于HW Breakpoint/Address Watchpoint/Trap0触发不频繁，并且Debug mode的STOP command不能被丢弃，因此需要一个深度为16的buffer用于缓冲所有可能的命令

- 该传输请求目的，是向触发debug mode的sub-thread的同Kernel其他线程，发射STOP命令

   - 传输请求固定指向本地SIP的DBG_CMD寄存器，并且命令格式为一个~多个线程的STOP

   - 其中操作的线程对象，是根据触发Debug mode的sub-thread的thread-slot id，现在KNL_MAP系列寄存器的KNL_MAP 域中查询；如果在4个KNL_MAP域中命中了触发debug mode的线程槽，则直接将这个KNL_MAP域作为这个写命令的 THD_SLOT_BIT_SEL域

|Interface|Direction|Connection|Comment|
|---|---|---|---|
|ip_communi_grp9_bsy0|output|流水线HW debugger<br>逻辑|和流水线HW debugger逻辑的握手信号：busy|
|ip_communi_grp9_req0|input|流水线HW debugger<br>逻辑|和流水线HW debugger逻辑的握手信号：req|
|ip_communi_grp9_awid0|input|6‘b0|固定awid|
|ip_communi_grp9_ctxid0|input|SIP SA context ID|SA0输出axusr的VF域|
|ip_communi_grp9_mstid0|input|流水线HW debugger<br>逻辑|SA0输出axusr的master ID域<br>最低2bit tie-off为2‘b01|
|ip_communi_grp9_asid0|input|4'b0|固定为0<br>由于流水线发给自己的CSR，所以并不重要|
|ip_communi_grp9_pri0|input|4‘b0|固定priority|
|ip_communi_grp9_adr0|input|0x830|固定地址，为DBG_CMD寄存器地址|
|ip_communi_grp9_dat0|input|流水线HW debugger<br>逻辑|bit[3:0]固定为4，即STOP<br>bit[31:16]为根据触发debug mode的sub-thread选<br>择的KNL_MAP域|
|ip_communi_grp9_len0|input|4‘b0|固定单burst|

#### 7.5.6. Other Feature

##### 7.5.6.1. Host Interface

SA0通过Host interface与AXI Bridge相连，通过该接口接受寄存器的配置

|Interface|Direction|Connection|Comment|
|---|---|---|---|
|i_reg_*|input|AXI bridge|Host interface输入接口|
|o_reg_hst_*|output|AXI bridge|Host interface输出接口|

##### 7.5.6.2. Harvest 和Pin Strap功能

SIP4.0不使用SA0的Harvest功能，也不再使用SA的clamp信号对PMU输出信号进行Harvest Clamp。Harvest由CRG来完成。

Driver在初始化SIP的时候，需要配置SA0的axuser寄存器和sa_srammisc寄存器。这两个寄存器会输出给SIP流水线、L1 moudle、 HwSync等多个单元

SIP core内部各个SRAM的parity generation/check/error injection功能，是由SIP core的SRAMCTRL系列寄存器控制

|Interface|Direction|Connection|Comment|
|---|---|---|---|
|sa_srammisc|output|SRAM in SIP Core|连接SIP Core中的SRAM|
|sa_harvest|output|Dangle|不使用|
|o_sa_axuser_out|output|SIP Core|提供给SIP Core、HwSync使用|

##### 7.5.6.3. DFX Feature

SA0提供了SA_DFx功能

- 支持TDR override控制SRAMMISC功能

- 支持DFT对于clock和reset的控制

- 支持对于DFX模块的访问安全隔离

**SA0的DFX接口在RTL设计前端不做连接，直接tie-off**

|Interface|Direction|Connection|Comment|
|---|---|---|---|
|ijtag_*|Jtag slave|Tie-off & Dangle|DFx相关信号，前端RTL中不做连接|
|aeb_level|output|Dangle|DFx相关信号，前端RTL中不做连接|

### 7.6. HwSync

HwSync是在SIP3.0中引入的硬件同步模块，而SIP4.0/SIP Lite依旧保留。利用这个模块+mailbox可以实现高层次语义的同步语义。 下面引用HwSync中的L1 sync部分。

SoC编程中的同步原语通过HwSync(L1/L3)和Local Mailbox协同实现。其中，HwSync实现Mutex/Barrier/Event/Latch/Queue同步模型机理，以及Master的notification等功能；Master Local Mailbox负责wakeup thread。

HwSync区分SIP内的L1 HwSync和centralized的L3 HwSync。其中，L1 HwSync可实现SIP内的线程同步；同时，对于某些场景， 为减小通过L3 HwSync同步的时延，也可通过L1 HwSync实现不同SIP之间的线程同步，例如物理位置较近的局部SIP之间进行同步。而SIP Lite的HwSync则可以起到 L2 HwSync的作用，用于同一个SIC内不同SIP4.0之间的同步。

![图 041](libra_sip_arch_spec__figure_041.png)

在SIP4.0/SIP Lite中例化的HwSync是L1 HwSync版本，它包含如下的特性：

**支持多种软件同步语义**

- 支持Mutex同步语义；

- 支持NtoN的Barrier同步语义；

- 支持1toN的Event同步语义；

- 支持NtoM的Latch同步语义；

- 支持1to1的深度为N的Queue同步语义；

支持AtomicInc Count(Self-Inc Memory)

**支持同步资源的重用**

- 支持Barrier重用。目标不变时，可以不再重新注册entry；目标变化时（有任意目标变化），必须重新注册所有entry； 支持Event重用。重用时需要重新注册Entry。

   - 为P2 feature

- 不支持Latch重用；

- 支持Queue重用；

**部分同步资源支持动态追加**

- Barrier不支持动态追加consumer；

- Event支持动态追加consumer；

为P2 feature

**Latch支持动态追加consumer；**

支持Latch try_wait模式（软件通过Polling方式查看Latch同步条件是否满足）；

**支持VF虚拟化**

- HwSync会保存记录Master IP注册HwSync时所使用的Context ID，并在发起notify时，在AXI CF Master interface上携带相应的Context ID信息。这里不涉及到Ax_User上Unit ID、Init ID和Die ID的变化

HwSync内部的notify地址查找表中，表项内容（notify address）可以是逻辑地址，也可以是物理地址

**支持HwSync同步资源划分为静态或动态资源使用；**

   - 支持同步资源的静态分配方式或动态分配方式

- 支持一组AXI CF slave和一组AXI CF master；

- 支持AXI CF master的outstanding可编程

- 支持同一个notified master使用同一个AXI ID，AXI ID软件可编程；

- 支持寄存器安全分级（分为Secure/Non-Secure/Mixed）；

- 支持HwSync记录资源IDLE的状态（对于L1 HwSync，记录全部资源的IDLE状态）；

- 支持动态分配的资源可以使用绝对地址（静态方式）访问；

- 支持HwSync CNT资源Uniq ID configuration and check；

- 支持Debug feature

   - 支持HwSync CNT资源Unique ID配置和检查

   - 不支持Mutex的lock和unlock thread check debug

   - 不支持Barrier producer check debug，需要软件保证一个producer仅signal一次

   - 同步操作传入ID无效或者是未分配的ID，支持HwSync Hang住（可配置），同时支持HwSync上报支持动态分配的资源可以使用静态地址访问

占用6KB的Local IO地址空间

SIP4.0/SIP Lite中例化的L1 HwSync规格包含资源如下：

- 256个mutex

- 64个CNT

- 256个Entry

- 32个Atomic INC

该数量比SIP3.0 HwSync中atomic有所增加

L1 HwSync支持记录全部资源的IDLE状态

在连接关系上，HwSync有一个CF maste接口和一个CF slave接口，都连接到SIP_SCF上

L1 HwSync的接口包括如下：

|Interface|Direction|Connection|Comment|
|---|---|---|---|
|hwsync_clk|input|ELCG clock|CRG输出的带有ELCG的时钟|
|hwsync_rst_n|input|SIP reset|CRG输出的复位信号|
|hwsync_axuser|input|SA0 ax_user[15:0]<br>低2bit tie-off为<br>2‘b10|为SA0的AxUsr进行变形。请见<br>AXI Interface Fields|
|hwsync_idle|output|ELCG_CTRL|和其他Idle信号一起输入到ELCG_CTRL|
|hwsync_cf_axi_*|master<br>interface|SIP_SCF|HwSync AXI master inteface，连接到SCF的slave接口<br>上|
|cf_hwsync_axi_*|slave interface|SIP_SCF|HwSync AXI slave inteface，连接到SCF的master接口<br>上|

详细内容请见HwSync Arch Spec

### 7.7. Mailbox

SIP中的mailbox是Enflame自行开发的通用模块。它的主要功能是经过配置后，从ECF总线上接收写mailbox的信息，并且在条件满足后设置mailbox event，被SIP context中的Wait/Wait_I指令捕捉，从而实现基本的同步功能。

和其他模块有所不同，Mailbox的寄存器定义是在SIP的ralf中完成的。寄存器定义参照了mailbox MAS，并将对应的寄存器连接到例化的enflame_mbx模块接口上。

SIP4.0中Mailbox部分和SIP3.0不同在于：

SIP4.0的mailbox实体数量增加到176个

MBX0-MBX127

MBX144-MBX191

SIP4.0增加了16个虚拟mailbox

VMBX128-VMBX143

- 每个虚拟mailbox可以汇聚MBX96-MBX127中的一个或者多个状态，实现通过等待一个虚拟mailbox来相应多个独立任务队列的功能

虚拟mailbox不支持自动清除(clr)和自动减少(dec)的wait模式

对于虚拟mailbox的feature如下：

MBX128-MBX143并不是实体的mailbox，而是MBX96-MBX127中某个或者数个实体mailbox的状态集合

MBX128-MBX143可以保证每个软件线程分配到一个虚拟mailbox

以sub-thread-0使用MBX128为例，使用方法如下

- 假设有4个独立的任务队列会从wait状态唤醒sub-thread-0进行处理，因此sub-thread-0预先分配MBX124-MBX127来分别记录这4个任务队列，并使用MBX128这个虚拟mailbox来统一记录管理它们

- 在整个任务开始前，需要配置MBOX_V128_BIT_EN为0xF000_0000，使得MBX128关联到MBX124-MBX127

启动sub-thread-0，处理完init之后，，wait MBX128并进入wait状态

必须使用非clr和非dec的模式

外部事件源分别更新MBX124-MBX127

- MBX128汇聚了MBX124-MBX127的satisfy状态，其中任意一个满足就使得MBX128满足，并让sub-thread-0退出wait状态

- sub-thread-0通过读取额外的MBOX_EXTRA_STS，判断MBX124-MBX127中哪个或者哪几个得到了mailbox的写操作， 并根据优先级处理一个事件

一个事件处理完成之后，Supevisor需要用Wait+clr或者Wait+dec模式清除MBX124-MBX127对应的状态

sub-thread-0继续检查MBOX_EXTRA_STS并处理event，直到MBX124-MBX127所有事件被清理完成

sub-thread-0重复第一个步骤，wait MBX128并进入wait状态

**General Mailbox的寄存器定义如下**

|Register Name: MBOX_ID|Register Name: MBOX_ID|Register Name: MBOX_ID|Register Name: MBOX_ID|Register Name: MBOX_ID|
|---|---|---|---|---|
|Offset Address: 0x600|||||
|Field|Bit|Reset<br>Value|RW|Description|
|UNIQ_ID|15:9|0|RWHW|Signaling unique ID. It will be compared with entry saved<br>MAIL_BOX_CONFIG.UNIQ_ID. Error will be reported if they are<br>mismatch.|
|MB_ID|7:0|0|RWHW|Mailbox index, when writes mailbox id is equal with MAIL_CONFIG<br>regiter MB_ID, which triggers the mbx collector's counter + 1;<br>Total number of physical mailbox is 128 in SIP|

**Register Name: MBOX_CONFIG**

|Offset Address: 0x604|Offset Address: 0x604|Offset Address: 0x604|Offset Address: 0x604|Offset Address: 0x604|
|---|---|---|---|---|
|Field|Bit|Reset<br>Value|RW|Description|
|UPD_MODE|31:30|0|RWHW|Driver/MCU write mode to determine what mode is the mailbox<br>working at.<br>0: Wait_clear mode (legacy);<br>1: Wait_minus_one;<br>2: Wait_minus_REF.|
|CRE_MODE|29:29|0|RWHW|Credit mode.<br>0: the initial mailbox counter would be set to 0 (legacy);<br>1: the initial mailbox counter would be set to REF|
|TRG_MODE|28:28|0|RWHW|Trigger mode:<br>0: trigger signal is asserted when counter equal or larger than<br>reference number (legacy);<br>1: trigger signal is asserted once counter is larger than 0.|
|INC_MODE|27:27|0|RWHW|Counter increment mode:<br>0: the counter will increment 1 when according entry is signaled.<br>1: the counter will increment REF when according entry is signaled.|
|REF|26:16|1|RWHW|Driver/MCU write ref,the ref value define the numbers of events<br>the mailbox must wait|
|UNIQ_ID|15:9|0|RWHW|Driver/MCU write uniq_id,the uniq_id value define the unique event<br>ID the mailbox must wait|
|MB_ID|7:0|0|RWHW|Mailbox design decode the MB_ID to the reference mailbox|

|Register Name: MBOX_GLB_CONFIG|Register Name: MBOX_GLB_CONFIG|Register Name: MBOX_GLB_CONFIG|Register Name: MBOX_GLB_CONFIG|Register Name: MBOX_GLB_CONFIG|
|---|---|---|---|---|
|Offset Address: 0x608|||||
|Field|Bit|Reset<br>Value|RW|Description|
|GLB_CONFIG|0:0|0|RWHW|Driver/MCU write this register before setting MBOX_CONFIG. The<br>value determines whether the configuration provided by the<br>MBOX_CONFIG is a global configuration or a single mailbox<br>configuration|

|Register Name: MBOX_STATUS_SEL|Register Name: MBOX_STATUS_SEL|Register Name: MBOX_STATUS_SEL|Register Name: MBOX_STATUS_SEL|Register Name: MBOX_STATUS_SEL|
|---|---|---|---|---|
|Offset Address: 0x60C|||||
|Field|Bit|Reset<br>Value|RW|Description|
|MB_ID|7:0|0|RWHW|Select the refer mbx. When the mbx is selected, the MBOX_STAUS is<br>able to read the REF and MAIL_COUTER value.|

|Register Name: MBOX_STATUS_0|Register Name: MBOX_STATUS_0|Register Name: MBOX_STATUS_0|Register Name: MBOX_STATUS_0|Register Name: MBOX_STATUS_0|
|---|---|---|---|---|
|Offset Address: 0x610|||||
|Field|Bit|Reset<br>Value|RW|Description|
|REF|31:16|1|RO|Read mail ref value. For every MBOX, there is one default email in<br>MBOX after reset. The REF value is updated after MBOX_CONFIG REF<br>and MB_ID is configured.|
|MAIL_COUNTER|15:0|0|RO|Read mail counter value. It indicates MAIL number of<br>mailbox[MBOX_STATUS_SEL.MB_ID].|

|Register Name: MBOX_STATUS_1|Register Name: MBOX_STATUS_1|Register Name: MBOX_STATUS_1|Register Name: MBOX_STATUS_1|Register Name: MBOX_STATUS_1|
|---|---|---|---|---|
|Offset Address: 0x614|||||
|Field|Bit|Reset<br>Value|RW|Description|
|MASTER_ID|21:12|0|RO|Read the last signaled master ID of the selected entry.<br>(Sometimes,if the entry is not signaled after being selected by<br>mbx_status_sel, the master ID will be all 1)|
|UNIQ_ID_CFG|11:5|0|RO|Read uniq ID of mailbox[MBOX_STATUS_SEL.MB_ID].|
|UPD_MODE_CONFIG|4:3|0|RO|Read upd_mode of mailbox[MBOX_STATUS_SEL.MB_ID].|
|CRE_MODE_CONFIG|2:2|0|RO|Read cre_mode of mailbox[MBOX_STATUS_SEL.MB_ID].|
|TRG_MODE_CONFIG|1:1|0|RO|Read trg_mode of mailbox[MBOX_STATUS_SEL.MB_ID].|
|INC_MODE_CONFIG|0:0|0|RO|Read inc_mode of mailbox[MBOX_STATUS_SEL.MB_ID].|

|Register Name: MBOX_V128_BIT_EN|Register Name: MBOX_V128_BIT_EN|Register Name: MBOX_V128_BIT_EN|Register Name: MBOX_V128_BIT_EN|Register Name: MBOX_V128_BIT_EN|
|---|---|---|---|---|
|Offset Address: 0x650|||||
|Field|Bit|Reset<br>Value|RW|Description|
|V128_BIT_EN|31:0|0|RWHW|V128 is a virtual mailbox which is a summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127 are used for mailbox<br>V128<br>V128_STS = bit_or(MBOX_V128_BIT_EN & MBOX_EXTRA_STS)|

|Register Name: MBOX_V129_BIT_EN|Register Name: MBOX_V129_BIT_EN|Register Name: MBOX_V129_BIT_EN|Register Name: MBOX_V129_BIT_EN|Register Name: MBOX_V129_BIT_EN|
|---|---|---|---|---|
|Offset Address: 0x654|||||
|Field|Bit|Reset<br>Value|RW|Description|
|V129_BIT_EN|31:0|0|RWHW|V129 is a virtual mailbox which is a summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127 are used for mailbox<br>V129<br>V129_STS = bit_or(MBOX_V129_BIT_EN & MBOX_EXTRA_STS)|

|Register Name: MBOX_V130_BIT_EN|Register Name: MBOX_V130_BIT_EN|Register Name: MBOX_V130_BIT_EN|Register Name: MBOX_V130_BIT_EN|Register Name: MBOX_V130_BIT_EN|
|---|---|---|---|---|
|Offset Address: 0x658|||||
|Field|Bit|Reset<br>Value|RW|Description|
|V130_BIT_EN|31:0|0|RWHW|V130 is a virtual mailbox which is a summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127 are used for mailbox<br>V130<br>V130_STS = bit_or(MBOX_V130_BIT_EN & MBOX_EXTRA_STS)|

**Register Name: MBOX_V131_BIT_EN Offset Address: 0x65C**

|Field|Bit|Reset<br>Value|RW|Description|
|---|---|---|---|---|
|V131_BIT_EN|31:0|0|RWHW|V131 is a virtual mailbox which is a summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127 are used for mailbox<br>V131<br>V131_STS = bit_or(MBOX_V131_BIT_EN & MBOX_EXTRA_STS)|

|Register Name: MBOX_V132_BIT_EN|Register Name: MBOX_V132_BIT_EN|Register Name: MBOX_V132_BIT_EN|Register Name: MBOX_V132_BIT_EN|Register Name: MBOX_V132_BIT_EN|
|---|---|---|---|---|
|Offset Address: 0x660|||||
|Field|Bit|Reset<br>Value|RW|Description|
|V132_BIT_EN|31:0|0|RWHW|V132 is a virtual mailbox which is a summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127 are used for mailbox<br>V132<br>V132_STS = bit_or(MBOX_V132_BIT_EN & MBOX_EXTRA_STS)|

|Register Name: MBOX_V133_BIT_EN|Register Name: MBOX_V133_BIT_EN|Register Name: MBOX_V133_BIT_EN|Register Name: MBOX_V133_BIT_EN|Register Name: MBOX_V133_BIT_EN|
|---|---|---|---|---|
|Offset Address: 0x664|||||
|Field|Bit|Reset<br>Value|RW|Description|
|V133_BIT_EN|31:0|0|RWHW|V133 is a virtual mailbox which is a summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127 are used for mailbox<br>V133<br>V133_STS = bit_or(MBOX_V133_BIT_EN & MBOX_EXTRA_STS)|

|Register Name: MBOX_V134_BIT_EN|Register Name: MBOX_V134_BIT_EN|Register Name: MBOX_V134_BIT_EN|Register Name: MBOX_V134_BIT_EN|Register Name: MBOX_V134_BIT_EN|
|---|---|---|---|---|
|Offset Address: 0x668|||||
|Field|Bit|Reset<br>Value|RW|Description|
|V134_BIT_EN|31:0|0|RWHW|V134 is a virtual mailbox which is a summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127 are used for mailbox<br>V134<br>V134_STS = bit_or(MBOX_V134_BIT_EN & MBOX_EXTRA_STS)|

**Register Name: MBOX_V135_BIT_EN**

|Offset Address: 0x66C|Offset Address: 0x66C|Offset Address: 0x66C|Offset Address: 0x66C|Offset Address: 0x66C|
|---|---|---|---|---|
|Field|Bit|Reset<br>Value|RW|Description|
|V135_BIT_EN|31:0|0|RWHW|V135 is a virtual mailbox which is a summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127 are used for mailbox<br>V135<br>V135_STS = bit_or(MBOX_V135_BIT_EN & MBOX_EXTRA_STS)|

|Register Name: MBOX_V136_BIT_EN|Register Name: MBOX_V136_BIT_EN|Register Name: MBOX_V136_BIT_EN|Register Name: MBOX_V136_BIT_EN|Register Name: MBOX_V136_BIT_EN|
|---|---|---|---|---|
|Offset Address: 0x670|||||
|Field|Bit|Reset<br>Value|RW|Description|
|V136_BIT_EN|31:0|0|RWHW|V136 is a virtual mailbox which is a summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127 are used for mailbox<br>V136<br>V136_STS = bit_or(MBOX_V136_BIT_EN & MBOX_EXTRA_STS)|

|Register Name: MBOX_V137_BIT_EN|Register Name: MBOX_V137_BIT_EN|Register Name: MBOX_V137_BIT_EN|Register Name: MBOX_V137_BIT_EN|Register Name: MBOX_V137_BIT_EN|
|---|---|---|---|---|
|Offset Address: 0x674|||||
|Field|Bit|Reset<br>Value|RW|Description|
|V137_BIT_EN|31:0|0|RWHW|V137 is a virtual mailbox which is a summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127 are used for mailbox<br>V137<br>V137_STS = bit_or(MBOX_V137_BIT_EN & MBOX_EXTRA_STS)|

|Register Name: MBOX_V138_BIT_EN|Register Name: MBOX_V138_BIT_EN|Register Name: MBOX_V138_BIT_EN|Register Name: MBOX_V138_BIT_EN|Register Name: MBOX_V138_BIT_EN|
|---|---|---|---|---|
|Offset Address: 0x678|||||
|Field|Bit|Reset<br>Value|RW|Description|
|V138_BIT_EN|31:0|0|RWHW|V138 is a virtual mailbox which is a summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127 are used for mailbox<br>V138<br>V138_STS = bit_or(MBOX_V138_BIT_EN & MBOX_EXTRA_STS)|

|Register Name: MBOX_V139_BIT_EN|Register Name: MBOX_V139_BIT_EN|Register Name: MBOX_V139_BIT_EN|Register Name: MBOX_V139_BIT_EN|Register Name: MBOX_V139_BIT_EN|
|---|---|---|---|---|
|Offset Address: 0x67C|||||
|Field|Bit|Reset<br>Value|RW|Description|
|V139_BIT_EN|31:0|0|RWHW|V139 is a virtual mailbox which is a summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127 are used for mailbox<br>V139<br>V139_STS = bit_or(MBOX_V139_BIT_EN & MBOX_EXTRA_STS)|

|Register Name: MBOX_V140_BIT_EN|Register Name: MBOX_V140_BIT_EN|Register Name: MBOX_V140_BIT_EN|Register Name: MBOX_V140_BIT_EN|Register Name: MBOX_V140_BIT_EN|
|---|---|---|---|---|
|Offset Address: 0x680|||||
|Field|Bit|Reset<br>Value|RW|Description|
|V140_BIT_EN|31:0|0|RWHW|V140 is a virtual mailbox which is a summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127 are used for mailbox<br>V140<br>V140_STS = bit_or(MBOX_V140_BIT_EN & MBOX_EXTRA_STS)|

|Register Name: MBOX_V141_BIT_EN|Register Name: MBOX_V141_BIT_EN|Register Name: MBOX_V141_BIT_EN|Register Name: MBOX_V141_BIT_EN|Register Name: MBOX_V141_BIT_EN|
|---|---|---|---|---|
|Offset Address: 0x684|||||
|Field|Bit|Reset<br>Value|RW|Description|
|V141_BIT_EN|31:0|0|RWHW|V141 is a virtual mailbox which is a summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127 are used for mailbox<br>V141<br>V141_STS = bit_or(MBOX_V141_BIT_EN & MBOX_EXTRA_STS)|

|Register Name: MBOX_V142_BIT_EN|Register Name: MBOX_V142_BIT_EN|Register Name: MBOX_V142_BIT_EN|Register Name: MBOX_V142_BIT_EN|Register Name: MBOX_V142_BIT_EN|
|---|---|---|---|---|
|Offset Address: 0x688|||||
|Field|Bit|Reset<br>Value|RW|Description|
|V142_BIT_EN|31:0|0|RWHW|V142 is a virtual mailbox which is a summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127 are used for mailbox<br>V142<br>V142_STS = bit_or(MBOX_V142_BIT_EN & MBOX_EXTRA_STS)|

|Register Name: MBOX_V143_BIT_EN|Register Name: MBOX_V143_BIT_EN|Register Name: MBOX_V143_BIT_EN|Register Name: MBOX_V143_BIT_EN|Register Name: MBOX_V143_BIT_EN|
|---|---|---|---|---|
|Offset Address: 0x68C|||||
|Field|Bit|Reset<br>Value|RW|Description|
|V143_BIT_EN|31:0|0|RWHW|V143 is a virtual mailbox which is a summary of one or some of<br>mailbox96~mailbox127<br>Bit31-bit0 indicate whether mailbox96~127 are used for mailbox<br>V143<br>V143_STS = bit_or(MBOX_V143_BIT_EN & MBOX_EXTRA_STS)|

|Register Name: MBOX_EXTRA_STS|Register Name: MBOX_EXTRA_STS|Register Name: MBOX_EXTRA_STS|Register Name: MBOX_EXTRA_STS|Register Name: MBOX_EXTRA_STS|
|---|---|---|---|---|
|Offset Address: 0x690|||||
|Field|Bit|Reset<br>Value|RW|Description|
|EXTRA_STS|31:0|0|RO|Bit31~bit0 indicate whether MBX96~MBX127 are satisfied or not<br>1: this mailbox is satisfied<br>0: this mailbox is not satisfied|

另外，Mailbox ID的0~3还可以额外支持GSYNC机制。这个机制并不使用enflame_mbx模块中的功能。相反它的功能和寄存器完全实现在SIP的CSR中。GSYNC指基于global ID同步机制，支持mailbox的动态分配。SIP4.0的GSYNC机制和SIP3.0上的一致。

对应的寄存器如下

|Register Name: SWR_WAIT_GSYNC0|Register Name: SWR_WAIT_GSYNC0|Register Name: SWR_WAIT_GSYNC0|Register Name: SWR_WAIT_GSYNC0|Register Name: SWR_WAIT_GSYNC0|
|---|---|---|---|---|
|Offset Address: 0x630|||||
|Field|Bit|Reset<br>Value|RW|Description|
|SWR_WAIT_GSYNC|31:0|0|RWHW|GSYNC related SIP SW code to write it with same value in<br>SWR_CFG_GSYNC0 when need to wait GSYNC signal. GSYNC<br>HW will clear it when waiting condition is satisfied and<br>WAIT/WAITI ins clr field is valid.|

|Register Name: SWR_WAIT_GSYNC1|Register Name: SWR_WAIT_GSYNC1|Register Name: SWR_WAIT_GSYNC1|Register Name: SWR_WAIT_GSYNC1|Register Name: SWR_WAIT_GSYNC1|
|---|---|---|---|---|
|Offset Address: 0x634|||||
|Field|Bit|Reset<br>Value|RW|Description|
|SWR_WAIT_GSYNC|31:0|0|RWHW|GSYNC related SIP SW code to write it with same value in<br>SWR_CFG_GSYNC1 when need to wait GSYNC signal. GSYNC<br>HW will clear it when waiting condition is satisfied and<br>WAIT/WAITI ins clr field is valid.|

|Register Name: SWR_WAIT_GSYNC2|Register Name: SWR_WAIT_GSYNC2|Register Name: SWR_WAIT_GSYNC2|Register Name: SWR_WAIT_GSYNC2|Register Name: SWR_WAIT_GSYNC2|
|---|---|---|---|---|
|Offset Address: 0x638|||||
|Field|Bit|Reset<br>Value|RW|Description|
|SWR_WAIT_GSYNC|31:0|0|RWHW|GSYNC related SIP SW code to write it with same value in<br>SWR_CFG_GSYNC2 when need to wait GSYNC signal. GSYNC<br>HW will clear it when waiting condition is satisfied and<br>WAIT/WAITI ins clr field is valid.|

|Register Name: SWR_WAIT_GSYNC3|Register Name: SWR_WAIT_GSYNC3|Register Name: SWR_WAIT_GSYNC3|Register Name: SWR_WAIT_GSYNC3|Register Name: SWR_WAIT_GSYNC3|
|---|---|---|---|---|
|Offset Address: 0x63C|||||
|Field|Bit|Reset<br>Value|RW|Description|
|SWR_WAIT_GSYNC|31:0|0|RWHW|GSYNC related SIP SW code to write it with same value in<br>SWR_CFG_GSYN3 when need to wait GSYNC signal. GSYNC HW<br>will clear it when waiting condition is satisfied and WAIT/WAITI<br>ins clr field is valid.|

|Register Name: SWR_CFG_GSYNC0|Register Name: SWR_CFG_GSYNC0|Register Name: SWR_CFG_GSYNC0|Register Name: SWR_CFG_GSYNC0|Register Name: SWR_CFG_GSYNC0|
|---|---|---|---|---|
|Offset Address: 0x640|||||
|Field|Bit|Reset<br>Value|RW|Description|
|SWR_CFG_GSYNC|31:0|ffffffff|RWHW|GSYNC related SIP SW code to write SWR_CFG_GSYNC0 value<br>into CLUSTER CCU GSYNC HW when want to wait GSYNC signal.|

|Register Name: SWR_CFG_GSYNC1|Register Name: SWR_CFG_GSYNC1|Register Name: SWR_CFG_GSYNC1|Register Name: SWR_CFG_GSYNC1|Register Name: SWR_CFG_GSYNC1|
|---|---|---|---|---|
|Offset Address: 0x644|||||
|Field|Bit|Reset<br>Value|RW|Description|
|SWR_CFG_GSYNC|31:0|ffffffff|RWHW|GSYNC related SIP SW code to write SWR_CFG_GSYNC1 value<br>into CLUSTER CCU GSYNC HW when want to wait GSYNC signal.|

|Register Name: SWR_CFG_GSYNC2|Register Name: SWR_CFG_GSYNC2|Register Name: SWR_CFG_GSYNC2|Register Name: SWR_CFG_GSYNC2|Register Name: SWR_CFG_GSYNC2|
|---|---|---|---|---|
|Offset Address: 0x648|||||
|Field|Bit|Reset<br>Value|RW|Description|
|SWR_CFG_GSYNC|31:0|ffffffff|RWHW|GSYNC related SIP SW code to write SWR_CFG_GSYNC2 value<br>into CLUSTER CCU GSYNC HW when want to wait GSYNC signal.|

|Register Name: SWR_CFG_GSYNC3|Register Name: SWR_CFG_GSYNC3|Register Name: SWR_CFG_GSYNC3|Register Name: SWR_CFG_GSYNC3|Register Name: SWR_CFG_GSYNC3|
|---|---|---|---|---|
|Offset Address: 0x64C|||||
|Field|Bit|Reset<br>Value|RW|Description|
|SWR_CFG_GSYNC|31:0|ffffffff|RWHW|GSYNC related SIP SW code to write SWR_CFG_GSYNC3 value<br>into CLUSTER CCU GSYNC HW when want to wait GSYNC signal.|

另外XPU_SCRATCH4~XPU_SCRATCH7作为MBX144-MBX191的debug信息接口

**SIP4.0支持多线程wait，约束条件为：**

- 对于Normal mailbox和虚拟mailbox的wait数量之和不超过16

- 对于GSYNC的wait数量不超过4

**Mailbox的接口如下**

|Interface|Direction|Connection|Comment|
|---|---|---|---|
|clk|input|o_ip_clk1_elcg|带有ELCG的IP clock，SIP SA输出穿过VDCI后的信号|
|rst_n|input|reset|IP reset，SIP SA输出穿过VDCI后的信号|
|||||
|mbx_id_wr|input|CSR|MBOX_ID寄存器写信号|
|mbx_id|input|CSR|MBOX_ID寄存器MB_ID域|
|uniq_id|input|CSR|MBOX_ID寄存器UNIQ_ID域|
|master_id|input|AXI Bridge|这里连接axi_bridge的reghst_out_user<br>用于记录写mailbox的总线请求的ax_user[9:0]域<br>只有在mbx_id_wr有效时使用|
|||||
|mbx_config_id_wr|input|CSR|MBOX_CONFIG寄存器写信号|
|mbx_config_id|input|CSR|MBOX_CONFIG寄存器MB_ID域|
|mbx_config_uniq_id|input|CSR|MBOX_CONFIG寄存器UNIQ_ID域|
|mbx_config_ref|input|CSR|MBOX_CONFIG寄存器REF域|
|mbx_config_inc_mode|input|CSR|MBOX_CONFIG寄存器INC_MODE域|
|mbx_config_trg_mode|input|CSR|MBOX_CONFIG寄存器TRG_MODE域|
|mbx_config_cre_mode|input|CSR|MBOX_CONFIG寄存器CRE_MODE域|
|mbx_config_upd_mode|input|CSR|MBOX_CONFIG寄存器UPD_MODE域|
|mbx_glb_config|input|CSR|MBOX_GLB_CONFIG寄存器GLB_CONFIG域|
|||||
|mbx_status_sel_wr|input|CSR|MBOX_STATUS_SEL寄存器写信号|
|mbx_status_sel|input|CSR|MBOX_STATUS_SEL寄存器MB_ID域|
|||||
|clean_mbx_counter|input|XPU PLC|Pipeline清除mailbox counter的控制信号<br>需要16个SW thread的信号merge到一起|
|clean_mbx_ref|input|XPU PLC|Pipeline清除mailbox reference value的控制信号<br>需要16个SW thread的信号merge到一起|
|mbx_ip_triger|output|XPU PLC|Mailbox计数到达ref。需要分开给16个SW thread|
|||||
|err_gnt|input|CSR|MBOX_ERR_RPT的写信号<br>用于W1C清理MBOX_ERR_RPT的flag|
|err_req|output|CSR|MBOX_ERR_RPT输出<br>用于设置MBOX_ERR_RPT的flag|
|mbx_status_0|output|CSR|输出到MBOX_STATUS_0。受到STATUS_SEL的选择|
|mbx_status_1|output|CSR|输出到MBOX_STATUS_1。受到STATUS_SEL的选择|
|err_code_0|output|CSR|输出到MBOX_ERR_CODE_0|
|err_code_1|output|CSR|输出到MBOX_ERR_CODE_1|
|||||
|i_flush|input|1'b0|Tie-off。SIP不用flush功能。|

### 7.8. OCS

OCS模块在SIP4.0中被移除

### 7.9. SIP_SCF

SIP_SCF是SIP内部CF通路的NOC。它主要用于路由来自于SIP core/HW sync的寄存器访问到SIP内部各个集成IP和ECF通路上，以及将ECF/SDTE的请求路由到SIP的内部寄存器上。SIP4.0的SIP_SCF和SIP3.0的SCF0配置类似。

SIP_SCF的基本特性包括：

- 包含4个slave接口，连接4个AXI master

   - SCF master：来源于ECF的总线请求

   - L1 master：来源于SIP core的scalar LD/ST，用于访问SCF/ECF上的寄存器

   - HW sync master：用于L1 HW sync根据同步语义发送mailbox操作

   - SA master：用于SA向SoC发送信息，例如错误Exception信息

- 包含3个master接口，连接3个AXI slave

   - SCF salve：ECF上的slave接口

   - AXI bridge slave：向CSR/PMU/SA0发送控制请求

   - HW sync slave：向HW sync发送寄存器配置

- 支持读/写各自outstanding

   - 读outstnading为32个

   - 写outstanding为128个

**支持各个master的AXI ID动态映射**

8 bit AXI ID

**支持64个不同的动态AXI ID**

**SCF接口的连接使用如下：**

|Interface|Direction|Connection|Comment|
|---|---|---|---|
|clk_scf|input|o_ip_clk1|不带ELCG的IP clock，SIP SA输出穿<br>过VDCI后的信号|
|RstN_scf|input|SIP core reset|IP reset，SIP SA输出穿过VDCI后的<br>信号|
|||||
|Obs_scf_m_ext_NoRdPending|output|CSR/OBS|ECF master接口是否有未完成读交易|
|Obs_scf_m_ext_NoWrPending|output|CSR/OBS|ECF master接口是否有未完成写交易|
|Obs_scf_m_hwsync_NoRdPending|output|CSR/OBS|HwSync master接口是否有未完成读<br>交易|
|Obs_scf_m_hwsync_NoWrPending|output|CSR/OBS|HwSync master接口是否有未完成写<br>交易|
|Obs_scf_m_sa_NoRdPending|output|CSR/OBS|SA上报master接口是否有未完成读<br>交易|
|Obs_scf_m_sa_NoWrPending|output|CSR/OBS|SA上报master接口是否有未完成写<br>交易|
|Obs_scf_m_sipslsb_NoRdPending|output|CSR/OBS|SIP core LD/ST master接口是否有未<br>完成读交易|
|Obs_scf_m_sipslsb_NoWrPending|output|CSR/OBS|SIP core LD/ST master接口是否有未<br>完成写交易|
|Obs_scf_s_axibridge_NoPending|output|CSR/OBS|AXI Bridge slave接口是否有未完成<br>交易|
|Obs_scf_s_ext_NoPending|output|CSR/OBS|ECF slave接口是否有未完成交易|
|Obs_scf_s_hwsync_NoPending|output|CSR/OBS|HwSync slave接口是否有未完成交易|
|||||
|scf_m_ext_*|AXI slave<br>interface|SCF master<br>interface|ECF->SCF在SCF处的AXI slave接口|
|scf_m_hwsync_*|AXI slave<br>interface|HwSync master<br>interface|HwSync->SCF在SCF处的AXI slave接<br>口|
|scf_m_sa_*|AXI slave<br>interface|Core Lite SA master|SA->SCF在SCF处的AXI slave接口|
|scf_m_sipslsb_*|AXI slave<br>interface|LD/SD master<br>interface|SIP core LD/SD->SCF在SCF处的AXI<br>slave接口|
|scf_s_axibridge_*|AXI master<br>interface|AXI bridge|SCF->AXI_bridge在SCF处的AXI<br>master接口|
|scf_s_ext_*|AXI master<br>interface|SCF1 slave interface|SCF->SCF1在SCF处的AXI master接<br>口|
|scf_s_hwsync_*|AXI master<br>interface|HwSync slave<br>interface|SCF->HwSync在SCF处的AXI master<br>接口|
|||||
|TestMode_en|input|Tie-off|DFx相关信号，前端RTL中不做连接|

SCF对接的各个外面AXI slave，所对应的地址如下：

|Interface|Connection|Start Address|End Address|Range|
|---|---|---|---|---|
|scf_s_axibridge_*|AXI bridge slave interface|0x0|0x6800-1|26KB|
|scf_s_hwsync_|HwSync slave interface|0x6800|0x8000-1|6KB|
|Reserved|N/A|0x8000|0x200_0000-1|32MB-32KB|
|scf_s_ext_*|ECF slave interface|0x200_0000|0x4000_0000-1|1GB-32MB|

地址mapping如下

![图 042](libra_sip_arch_spec__figure_042.png)

### 7.10. AXI Bridge

AXI Reg Bridge是 SIP4.0例化的又一个通用模块。该模块作为slave，连接到SCF的master接口上，将AXI访问协议转换为host接口协议，用于读写挂在axi bridge上的寄存器。

SIP4.0的AXI bridge包含如feature和使用方式：

- 32bit数据位宽，只支持4byte对齐的word访问

   - 对于写操作，必须strobe为4’b1111

   - 对于byte/half-word操作，或者地址不是4byte对齐，结果不可知

- 30bit地址位宽

**包含四条分支**

- 分别为XPU/ICache/L1/CommonCSR

- 每个分支上包含2个port，对映两片不同的地址

访问每个分支的Port0都是相等latency的，但是访问Port 1的latency可能不同

- 去除parity功能

   - 在SIP内部，不再需要bus parity功能

- 支持axuser输出

在协议转换后，访问各个模块的host接口上引入了axuser的接口，支持各个slave记录访问请求的axuser域。

axi_brdige以及host interface 的访问路径如下图所示。其中红色模块为每个分支的Port0

![图 043](libra_sip_arch_spec__figure_043.png)

在SIP4.0上，AXI bridge挂载了如下的模块

|Port|Module/CSR configuration|Address range|Size|
|---|---|---|---|
|XPU Port0|LCH0_CFG, LCH0_NXT<br>LCH1_CFG, LCH1_NXT<br>APP<br>Mailbox & PROFILE_CFG<br>Thread_WRK<br>BOOT-XPU|0x0-0xCFF|3.25KB|
|ICACHE Port0|BOOT-IMEM|0xD00-0xDFF|256B|
|L1 Port0|BOOT-L1|0xE00-0xEFF|256B|
|CommonCSR Port0|RPC<br>CTH<br>PMU<br>OBS|0xF00-0x1FFF|4.25KB|
|CACHE Port1|SIP SA|0x2000-0x4FFF|12KB|
|XPU Port1|CDF_NODE_CFG|0x5800-0x5BFF|1KB|
|L1 Port1|DSM_NODE_CFG<br>L2M<br>BPM0<br>BPM1|0x5C00-0x67FF|3KB|

地址mapping如下

![图 044](libra_sip_arch_spec__figure_044.png)

### 7.11. BPM

BPM(Bus Performance Monitor)是一个用于负责统计总线相关Perf信息的模块。它可以用来统计下列内容

- 统计总线带宽使用情况

- 单笔读写的平均latency

- 第一个读或者写请求的 latency

etc

在SIP3.0上，使用SIP SA自带的BPM统计DF master的性能。而在SIP4.0中，由于主要关心SIP DF master0和master1的性能，因此使用了2个BPM。并且BPM为单独instance，而不是和SA合在一起的版本

SIP4.0上，两个BPM是AXI Bridge上的salve。Profiler通过CSR寄存器配置BPM。BPM根据配置统计master0/master1的总线数据，记录在CSR寄存器中。然后Profiler读取BPM寄存器，通过计算得到总线的相关性能信息。

**BPM模块的信号连接如下：**

|Interface|Direction|Connection|Comment|
|---|---|---|---|
|bpmclk|input|o_sip_harv_sku_elcg_clk_1|CRG的时钟输出|
|bpmclk_rst|input|o_sku_harv_rst_n_sip_clk_1|CRG的复位输出|
|||||
|reg_hst_*|input|AXI bridge|Host interface输入接口|
|||||
|axi_*|input|SIP EDF master0/master1|AXI总线接口输入|
|||||
|per_eventv0~7|input|tie-off|SIP不使用BPM bypass模式|
|per_eventb|input|tie-off|SIP不使用BPM bypass模式|
|run_enable_event_start|input|tie-off|SIP不使用BPM bypass模式|
|run_enable_event_stop|input|tie-off|SIP不使用BPM bypass模式|
|ex_pscw_start|input|tie-off|SIP不使用BPM bypass模式|
|ex_pscw_stop|input|tie-off|SIP不使用BPM bypass模式|
|||||
|pmon_counter_int|output|dangle||
|pmon_counter_off_int|output|dangle||
|bpm_rdy_int|output|dangle||

### 7.12. OBS

OBS模块用于将SIP内部debugging相关的信号通过选择，连接到芯片pad上，用于silicon debugging辅助的模块。整体上SIP有一个12bit的obs输出信号，该信号通过内部多组12bit信号组，通过DFD相关CSR寄存器选择后输出。

和Scorpio设计相比，Libra SIP只保留了SIP core OBS模块并重新命名：

SIP OBS

- 例化一个DFD_OBS_MUX单元

- 共有32组，每组12bit的输入信号，连接到DFD_OBS_MUX单元。包括如下信号

   - PMU输出给OBS的信号

   - SIP_SCF上各个master和slave口的pending信号

   - SIP_SCF上AXI接口相关信号

   - 其他SIP designer自己定义的内部信号

DFD_OBS_MUX输出12bit信号，直接输出到OBS接口上

SIP common CSR提供了1bit的enable信号，控制所有32组每组12bit信号输入是否有效

   - 来源于DFD_CFG寄存器

- SIP common CSR提供12个9bit的select信号，用于DFD_OBS_MUX输入到输出的选择

   - 来源于DFD_OBS_CORE_SEL0~DFD_OBS_CORE_SEL5

   - 每个select信号，对应一个output的bit

   - 每个select信号的高5bit，用于选择一个输入信号组

   - 每个select信号的低4bit，用于从被选中的输入信号组中，选择一个bit，映射到select对应的output bit上

   - 因此，所有32组12bit共352个输入信号，可以选择任意12bit信号以任意顺序映射到输出接口上

- 使用XPU_SCRATCH7寄存器低12bit，提供了本SIP OBS输出是否有效的控制信号

- SIP CORE OBS的时钟

   - OBS中没有时钟

SIP-Lite虽然例化了OBS，但是不支持任何OBS输出

![图 045](libra_sip_arch_spec__figure_045.png)

**OBS的32组信号输入情况如下：**

|Group Index|连接情况|
|---|---|
|Group0|低6bit为{pmu_obs_conc_risk_cnt[2:0],pmu_obs_past_risk_cnt[2:0]}<br>高6bit dangle|
|Group1|低11bit为SIP_SCF上的11个NoPending信号<br>最高bit dangle|
|Group2|HW Sync master port AXI signals|
|Group3|SIP SA master port AXI siganls|
|Group4|SIP SA MC master port AXI signals|
|Group5|SIP SLSB master port AXI signals|
|Group6|AXI Bridge slave port AXI signals|
|Group7|HW Sync slave port AXI signals|
|Group8|SIP SA slave port AXI signals|
|Group9~Group31|Dangle|

其中，Group2 ~ Group8当中，AXI signal连接方式都是一致的：

```
assignOBS_group_n={rlast, wlast, wready, wvalid, rready, rvalid, bready, bvalid, awready, awvalid,
arready, arvalid};
```


**Causion: SIP4.0中EXCP_REAL_SIZE，EXCP_VL，EXCP_TRAP_INS中断被舍弃**

### 7.13. Reliability, Availability and Serviceability
#### 7.13.1. RAS for RAM

SIP4.0对下面的RAM支持ECC/Parity的检查和错误插入功能：

下面的总容量指受到校验保护的数据容量，不包括校验位本身的容量

|RAM类型|校验颗粒度|数据总容量<br>(不包含校验位)|处理方法|Exception类型|
|---|---|---|---|---|
|L1 ICache|512bit|160KB|ECC|EXCP_IMEM_RAS_ERR|
|L0 ICache|128bit|2.5KB|Parity|EXCP_IMEM_RAS_ERR|
|S3 PISQ 2D SRAM|32bit|2.3KB|Parity|EXCP_S3INST_RAS_ERR|
|S3 PISQ 1D SRAM|32bit|0.96KB|Parity|EXCP_S3INST_RAS_ERR|
|S3 PISQ VLD SRAM|32bit|1.54KB|Parity|EXCP_S3INST_RAS_ERR|
|S3 PISQ VST SRAM|32bit|1.73KB|Parity|EXCP_S3INST_RAS_ERR|
|S3 ROQ Inst. 1D|32bit|4.75KB|Parity|EXCP_S3INST_RAS_ERR|
|S3 ROQ Inst. 2D|32bit|5.06KB|Parity|EXCP_S3INST_RAS_ERR|
|S3 ROQ Inst. VLD|32bit|3.66KB|Parity|EXCP_S3INST_RAS_ERR|
|S3 ROQ Inst. VST|32bit|4.17KB|Parity|EXCP_S3INST_RAS_ERR|
|S3 ROQ Inst. MOVSMR|32bit|0.29KB|Parity|EXCP_S3INST_RAS_ERR|
|SR/TAR SRAM|32bit|8KB|Parity|EXCP_SRTAR_RAS_ERR|
|SPR SRAM|32bit|1KB|Parity|EXCP_SRTAR_RAS_ERR|
|L0P5 SRAM|512bit|256KB|ECC|EXCP_IVSMR_RAS_ERR|
|VA SRAM|8bit|384KB|Parity|EXCP_VARAM_RAS_ERR|
|SDMEM|ECC: 64bit<br>Parity: 8bit|128KB|ECC+Parity|EXCP_SDMEM_RAS_ERR|
|VDMEM|ECC: 512bit<br>Parity: 8bit|896KB|ECC+Parity|EXCP_VDMEM_RAS_ERR|
|L2L3 NCBUF|32bit|32KB|Parity|EXCP_L1DATA_RAS_ERR|
|L2L3 LIQ V0|32bit|6.3KB|Parity|EXCP_L1CTRL_RAS_ERR|
|L2L3 LIQ V1|32bit|14KB|Parity|EXCP_L1CTRL_RAS_ERR|
|L2L3 LIQ V2|24bit|3KB|Parity|EXCP_L1CTRL_RAS_ERR|
|L2L3 SDQ|32bit|18KB|Parity|EXCP_L1CTRL_RAS_ERR|

**SIP对于这些RAM的RAS支持如下：**

在写入时产生ECC/Parity，在读出时检查ECC/Parity

- 对于同时存在ECC/Parity的RAM，则按照以下规则处理

   - 如果存在局部写入（颗粒度小于ECC校验宽度的写入），则只产生parity bit并记录ECC无效。

      - 无论是整体读出还是部分读出读出时只检查parity

   - 如果是整体写入（颗粒度等于ECC校验宽度的写入），则同时产生Parity bit和ECC校验码，并记录ECC有效。 此时整体读出时只检查ECC

      - 如果部分读出则检查parity

![图 046](libra_sip_arch_spec__figure_046.png)

这里的整体读写和部分读写是指对RAM体的访问，而非指令层面的整体/部分读写

如果SIPSIP流水线读RAM，并检测到ECC多bit错误/Parity错误，则记录RAS异常并且上报Error Interrupt

   - 上报到各自RAM的RAS_ERR Exception

- 如果SIP流水线读RAM，并检测到ECC单bit错误纠正，不触发异常但记录到RAS_REPAIRED_STS寄存器中 ~~，并进行Error Interrupt上报~~

RAS_REPAIRED的Error Interrupt上报已经被Drop

- 如果外部master读VDMEM/SDMEM，并检测到ECC多bit错误/Parity错误，则通过response返回memory RAS Error信息。 SIP流水线不做任何异常记录，但是进行Error Interrupt上报

上报到RAS_DF_SLAVE_ERR Interrupt

- 如果外部master读VDMEM/SDMEM，并检测到ECC单bit错误纠正，不触发异常但记录到RAS_REPAIRED_STS寄存器中 ~~，并进行Error Interrupt上报~~

RAS_REPAIRED的Error Interrupt上报已经被Drop

SIP4.0的RAM不支持”非持续错误注入“这个RAS feature

#### 7.13.2. RAS for Bus

**SIP4.0可以同时支持下列4种总线角色**

CF master

Load/Store指令访问SCF/ECF上的寄存器

- CF slave

SIP内的寄存器作为slave被ECF master访问

DF master

Load/Store指令访问DSM/L3

DF slave

SP/CDTE访问VDMEM/SDMEM

**此外还可以分读写，一共八种情况。无论哪种总线角色，都需要提供RAS的支持。**

**SIP对于RAS的支持原则包含如下：**

SIP作为master时，检查到RAS Error(或其他Error)，则设置对应的异常状态，并进行Error Interrupt上报

- SIP作为slave时，检查到RAS Error(或其他Error)，则不设置异常，通过Response通知对应的master

   - 根据SoC RAS需求，追加了Error Interrupt，但是不通过异常系统处理

- 对于CF总线上的访问，提供Parity保护

对于Read/Write data的Parity校验位产生和检查，均有SA来提供

对于DF总线上的访问，提供ECC保护

   - ECC检查和校验位产生均有专门的ECC checker和ECC generator来完成

- 对于CF/DF总线上的访问，可能同时存在Slave RAS Error和Bus RAS Error并存的情况

   - SIP作为master时，对于一类总线上的Slave RAS Error和Bus RAS Error，合并记录到同一个总线的RAS_ERR状态中，并进行Error Interrupt上报

   - SIP作为CF slave时，只提供Bus Parity校验位的保护

   - SIP作为DF slave时，可以提供RAM Parity/ECC Error的response信息，以及Bus ECC校验位的保护

- SIP的总线ECC校验中，对于单bit错误纠正的，记录到RAS_REPAIRED_STS寄存器中，并额外设置独立的Error Interrupt上报 ICache对应的DF2总线的RAS_REPAIRED记录和上报功能被舍弃。

##### 7.13.2.1. RAS for CF Bus

SIP4.0对于CF BUS的RAS处理如下：

- 对于SIP和ECF的master接口和Slave接口，采用SA的ABMP来支持per-byte的parity功能。

   - 支持读写数据的parity校验产生和错误检查

   - 支持parity错误插入

   - 支持Error response记录和上报

   - 详细处理方法采用下面表格中说明

   - 对于SIP4.0发出的CF总线请求，由发出请求的master自行上报Error Interrupt（SIP流水线，HwSync，etc）

   - 对于外部访问SIP4.0 CF出现的bus parity错误，则通过response返回，但不会上报Error Interrupt

- 对于SIP内部SCF上的master/slave的交互，不使用RAS保护

|接口|SA0|SIP LD/ST单元|
|---|---|---|
|SIP SCF master -> ECF slave接<br>口，Write data|SA0在w_user上添加bus<br>parity bit|SIP LD/ST单元检查bresp的b_user信息，如果有bus<br>parity error进行处理<br>SIP LD/ST单元通过SA0上报write bus的parity error<br>和其他error<br>HwSync自行上报write bus的parity error和其他<br>error<br>SA0自行上报write bus的parity error和其他error|
|SIP SCF master -> ECF slave接<br>口，Read response|SA0负责检查bus parity，并<br>修改r_user<br>如果parity结果正确，<br>r_user[3:0] = 4'h0<br>如果parity结果不正确，<br>r_user[3:0] = 4'hF|SIP LD/ST单元检查r_user域parity部分的信息，根据<br>是否全0确认bus parity error<br>SIP LD/ST单元通过SA0上报read bus的parity error<br>和其他error<br>HwSync/SA0不会产生读请求|
|ECF master -> SIP SCF slave接<br>口，Write data|SA0负责检查bus parity，并<br>修改w_user<br>如果parity结果正确，<br>w_user[3:0] = 4'h0<br>如果parity结果不正确，<br>w_user[3:0] = 4'hF|SIP LD/ST单元检查w_user。<br>如果存在bus parity error，那么会通过<br>bresp/b_user告之是bus error。<br>但是流水线自身不通过SA0报告这个parity error|
|ECF master -> SIP SCF slave接<br>口，Read response|SA0在r_user上添加parity bit|SIP LD/ST单元不产生parity bit，r_user低部分数值<br>为全0|

关于AXI信号细节，详见AXI Interface Fields章节。对于总线上的异常详细对应，请见Bus Related Exception章节。

##### 7.13.2.2. RAS for DF Bus

SIP4.0对于DF BUS的RAS处理如下：

- SIP的DF master/slave通路，不使用SA0的parity gen/parity check，而是使用另外例化的1024bit的ECC gen/ECC check功能。这里支持

   - 在整个SIC通路内，DSM/CDF网络都使用ECC机制，只在EDF和CDF接口上，进行ECC校验/Parity校验的协议转换，以支持EDF通路上的parity功能

这是为了节省DSM网络的面积

支持读写数据的ECC校验产生，单bit错误纠正和多bit错误检查

- 支持单bit和多bit的错误插入

- 支持Error response记录和上报

   - 注意：DF2 master接口的ECC 单bit修正上报功能被舍弃。该接口对于单bit错误修正功能依然存在，但是在对应的 CSR中不会再有修正的记录

- 详细处理方法采用下面表格中说明

- 对于SIP4.0发出的DF总线请求，由发出请求的master自行上报Error Interrupt

- 对于外部访问SIP4.0 DF出现的ECC错误，则通过response返回，但不会上报Error Interrupt

- SIP4.0的DF BUS支持”非持续错误注入“这个RAS feature

|接口|SIP DF总线ECC逻辑|SIP LD/ST单元|
|---|---|---|
|SIP DF master -> CDF slave接<br>口，Write data|ECC产生逻辑在w_user上添加ECC<br>校验数据|SIP LD/ST单元检查bresp的b_user信息，如果有<br>bus RAS error则进行相应处理<br>SIP LD/ST单元通过SA0上报DF总线写操作的RAS<br>error和其他error|
|SIP DF master -> CDF slave接<br>口，Read response|ECC检查逻辑负责检查bus的ECC<br>并报告给L1/ICache<br>如果单bit错误，则输出纠正后数<br>据以及单bit错误报告<br>如果多bit错误，则输出错误数据<br>以及多bit错误报告|SIP的master根据ECC单元检查结果和<br>bresp/b_user判断response是否有问题<br>SIP LD/ST单元通过SA0上报DF总线读操作的RAS<br>error和其他error<br>HwSync/SA0不会产生读请求|
|CDF master -> SIP DF slave接<br>口，Write data|ECC检查逻辑负责检查bus的ECC<br>并报告给L1/ICache<br>如果单bit错误，则输出纠正后数<br>据以及单bit错误报告<br>如果多bit错误，则输出错误数据<br>以及多bit错误报告|SIP的SDMEM/L1逻辑根据ECC检查结果进行处理<br>对于单bit错误纠正，则正常执行写入并返回正常<br>的write response<br>对于多bit错误报告，依然执行写入但是返回error<br>response|
|CDF master -> SIP DF slave接<br>口，Read response|ECC产生逻辑在r_user上添加ECC<br>校验数据|SIP LD/ST单元的r_user低部分数值为全0|

关于AXI信号细节，详见AXI Interface Fields章节。对于总线上的异常详细对应，请见Bus Related Exception章节。

#### 7.13.3. SIP Error Interrupt

对于所有的RAS Exception，以及ECC单bit fix的记录，都通过SIP SA的error interrupt通道（group0/group1）上报给SP和Host。 详情请见System Adapter章节

|Error Type|SA Error<br>Interrupt<br>Channel ID|Exception<br>Vector|Comment|
|---|---|---|---|
|EXCP_IMEM_RAS_ERR|0|0x88|ICache Error, Fatal Error|
|EXCP_VDMEM_RAS_ERR<br>EXCP_SDMEM_RAS_ERR|1|0x81|L1数据Memory RAS Error|
|EXCP_VARAM_RAS_ERR<br>EXCP_SRTAR_RAS_ERR<br>EXCP_IVSMR_RAS_ERR<br>EXCP_L1DATA_RAS_ERR|2|0x81|L0数据RAM RAS Error|
|EXCP_S3INST_RAS_ERR|3|0x88|SIP流水线内部RAM Error<br>Fatal Error|
|EXCP_L1CTRL_RAS_ERR|4|0x88|L1流水线控制RAM Error<br>Fatal Error|
|EXCP_CF_RAS_ERR|5|0x82|CF总线RAS Error|
|EXCP_DF_RAS_ERR|6|0x83|DF总线RAS Error|
|EXCP_ILL_IS|7|0xC0|自定义vector|
|DSM_NODE_INTR|8|0xC1|该中断是DSM借用SIP SA进行自己的上报<br>P2 Feature|
|EXCP_ADDR_INVALID|9|0xC2|自定义vector|
|EXCP_CF_RESP_ERR|10|0x84|CF总线Response Error|
|EXCP_DF_RESP_ERR|11|0x85|DF总线Response Error|
|CDF_NODE_INTR|12|0xC4|该中断是CDF借用SIP SA进行自己的上报<br>P2 Feature|
|EXCP_ICACHE_DF_RAS_ERR|13|0x88|ICache取指时DF总线RAS Error<br>Fatal Error|
|EXCP_ICACHE_DF_RESP_ERR|14|0x88|ICache取指时DF总线Response Error<br>Fatal Error|
|EXCP_ICACHE_MISS_VICTIM_ERR|15|0xC6|自定义vector|
|~~RAS_REPAIRED_IMEM~~<br>~~RAS_REPAIRED_VDMEM~~<br>~~RAS_REPAIRED_SDMEM~~<br>~~RAS_REPAIRED_IVSMR~~|~~19~~|~~0x89~~|~~ICache/SDMEM/VDMEM ECC单bit修正~~|
|~~RAS_REPAIRED_DF~~|~~20~~|~~0x8A~~|~~DF总线ECC单bit修正~~<br>~~包括所有DF0/1/2的master和DF0/1的~~<br>~~slave接口~~|
|RAS_DF_SLAVE_ERR|21|0x83|DF总线Slave端发现的ECC多bit的Error|
|L2M_SIP_REQ_INT|22|0xC9|该中断是L2M借用SIP SA进行自己的上报<br>P2 Feature|
|L2M_SSM_ACK_INT|23|0xCA|该中断是L2M借用SIP SA进行自己的上报<br>P2 Feature|

其中，19~21并非Error Exception，即它们不会导致SIP进行异常状态，但是依然可以通过SA发送Error Interrupt。8和12这两组是 DSM/CDF NODE借用SIP SA进行错误上报。22~23这两组是L2M借用SIP SA进行错误上报。

#### 7.13.4. Memory Initialize for RAS

在SIP4.0设计中，下列三种memory需要在整个SoC复位结束之后，RAS Check使能之前（即GRS之前），进行初始化操作。否则会出现不必要的RAS报错。

初始化时间，为SoC上电并且复位结束之后。

只需要上电后执行一次，不需要每次复位之后都执行

初始化必须在复位之后，GRS设置寄存器之前进行

初始化的对象，包括SDMEM，VDMEM和VACC

初始化的数值，可以为任意确定数值

例如，将初始化对象全部写0

初始化过程之前不需要特意使能RAS产生。SIP中RAM的ECC/Parity校验位产生功能默认是打开的

- 对于SDMEM/VDMEM初始化，建议使用SSM配置CDTE来操作

默认情况下，CDTE可以通过DSM亲和空间访问到所有SDMEM，通过DSM亲和或者非亲和空间访问到所有VDMEM。

如果使用SIP自身初始化，会依赖GRS寄存器配置，反而导致流程冲突

- 对于VACC的初始化，有两种方式

   - SIP启动mini kernel进行初始化

SSM通过SIP的HW Debugger接口，通过STEP_DCMD下发指令让SIP流水线执行，进行初始化

### 7.14. Virtualization Features

**Libra SIP采用下列方式来支持**

SIP通过SA0寄存器，允许配置VF域（原来的CTXID域）

由Driver来配置

SIP作为VF-Only的IP，不会出现多个VF并发的情况

SIP通过ASID的方式，动态关联不同的PTE，支持不同的Host进程

- SIP的不同Kernel可以支持不同的ASID

- 在进行ASID切换时，之前使用该ASID的线程必须执行完成

通过上述方法，SIP执行单元不需要感知具体的进程，只需要在AMOS发射时传递参数即可。

## 8. Register SPEC

关于SPR寄存器的说明，请见SIP4.0 SPR Spec。

关于CSR寄存器的说明，请见SIP4.0 CSR Spec。

## 9. Programming Guideline

请见Libra_SIP_Programming_Guideline。

## 10. Design for X

N/A

## 11. PD Guideline

N/A

## 12. Emulation/Silicon Validation Guideline

N/A

## 13. Errata

本章节已经单独移出，并放置到该目录下。

## 14. Appendix A: Revision Description
