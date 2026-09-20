> Imported material source: `Doc/Libra DTE Architecture Specification.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `Libra DTE Architecture Specification`.

# Libra DTE Architecture Specification

- **Department:** DTE Design Team
- **Author:** Lijun

## 1. Revision History

|**Revision**|**Date**|**Description**|**Author**|
|---|---|---|---|
|**v0.1.0**|2023/3/7|Initial<br>version,<br>porting<br>from<br>scorpio|KevinQ|
|**V0.5**|2023/6/6|For lmb|KevinQ|
|**V0.7**|2023/8/16|For lmc|KevinQ|
|**V0.9**|2024/3/6|For lmd|KevinQ|

**Table 1. Revision History**

## 2. Preface

### 2.1. Glossary

**DTE** : Data Transformation Engine

**ODTE** : Off-chip DTE

**CDTE** : Cluster DTE

**EDTE** : ECCL DTE

**SA** : System Adapter

**VC** : Virtual Channel

**RR** : Round-Robin

**QoS** : Quality of Service

**CF** : Control Fabric

**DF** : Data Fabric

**IFB** : Infinite Buffer Mode

**Ultra OP：** operation that needs exclusively use DTE internal buffer, like reshape **Ultra Thread:** Thread that can execute ultra OP

**SPMD** : Single Program Multiple Data

**VF** : Virtual Function

**MMU** : memory management unit

**DSM** ：Distributed Share Memory

## 3. Plan of Record

本章节需从v0.1.x 开始就具备。 此章节描述所有FCR/ECR 的链接、标题、文档入口地址。下表是一个例子。

**FCR Link FCR Summary Doc Section**

## 4. Overview

DTE 是一个用来做数据的传输和变形的IP。其基本的功能是完成数据的传输，并且在传输过程 中做slice，deslice，reshape 等数据形状的改变，提供计算引擎所需形状的数据。

DTE 执行的基本单位是一个command packet，每个command packet 通过CF 发送并存储到DTE 的一个VC 中。每个DTE 中有多个VC 和多个thread，通过arbitration 来选择某个 VC 中的command 被一个thread 执行。当某个command 被执行完之后，根据该 command 的配置，DTE 会发起一笔signal 到CF 总线上，通知对应的engine 该笔 command 已经完成。

#### DTE 结构说明

1. Multi thread - 更充分的使用接口带宽

2. Multi-stage pipeline - 减少command switch 的cost，更高效的带宽利用率

3. Read/write decouple - 更多的操作组合和更高效的读写pattern。

![Libra_DTE_Architecture_Specification.pdf-0012-05.png](libra_dte_architecture_specification__libra_dte_architecture_specification_pdf_0012_05.png)

**Figure 1. DTE Overview**

DTE 会在不同的hierarchy 被例化成不同类型的DTE:

### 4.1. ODTE

ODTE 被instance 在整个SOC top 上面，每个Die 有一个ODTE。ODTE 主要被用来完成 host 和L3 之间的数据传输。ODTE 有两个并行的thread 和两组read/write port，thread 和 read/write port 绑定。由于去host 的访问latency 比较大，为了不影响效率，ODTE outstanding 增加到1024。ODTE 中两个thread 可以并行执行host to L3 和L3 to host 的 数据搬运，sw 需要使用每条通路上xmc aperture，配置host mem address range，从而识别host mem 的访问不做hash。ODTE 内两路df path 分别集成一个mmu，负责将从 DVA（device virtual address）到 IPA（intermediate physical address）的地址转换。ODTE 的data channel0 上有一个 xts 模块，用于 host 到 L3 数据解密功能：

![Libra_DTE_Architecture_Specification.pdf-0013-03.png](libra_dte_architecture_specification__libra_dte_architecture_specification_pdf_0013_03.png)

**Figure 2. ODTE Overview**

### 4.2. CDTE

CDTE 主要负责L3/DSM 之间的数据传输。CDTE 可以访问相邻的SIC DSM，也可以经过 MMU 访问L3（CDTE 内没有MMU，在外部和SIC 复用MMU）。CDTE 有4 个并行的 thread 和4 组read/write port，CDTE 的4 组port 的属性都是完全一样的，每个thread 绑 定一组read/write port 构成了一个Physical Channel。为了充分合理的利用L3 的带宽， CDTE 还支持将一个command split 成多份，发送到多个thread 并行执行的 function（SPMD）。

![Libra_DTE_Architecture_Specification.pdf-0014-01.png](libra_dte_architecture_specification__libra_dte_architecture_specification_pdf_0014_01.png)

**Figure 3. CDTE Overview**

### 4.3. EDTE

EDTE 被instance 在整个SOC top 上面，每个Die 有一个EDTE。EDTE 主要被用来完成L3 内部的数据传输。EDTE 有两个并行的thread 和两组read/write port，thread 和read/write port 绑定。EDTE 内两路df path 分别集成一个mmu，负责将从 DVA（device virtual address）到 IPA（intermediate physical address）的地址转换：

![Libra_DTE_Architecture_Specification.pdf-0014-05.png](libra_dte_architecture_specification__libra_dte_architecture_specification_pdf_0014_05.png)

**Figure 4. EDTE Overview**

## 5. Interface Spec

### 5.1. CLK&RESET

|SOC interface<br>signal|SA interface signal|Direction|Description|
|---|---|---|---|
|ssm_clk|i_ssm_clk|Input ssm clock from<br>SSM(ODTE/CDTE/EDTE).|Input ssm clock|
|dte_clk|i_ip_clk0|input DTE engine clock<br>from<br>SSM(ODTE/CDTE/EDTE).|Input DTE engine<br>clock|
||i_df_clk|ODTE/CDTE/EDTE||
||i_cf_clk|ODTE/CDTE/EDTE||
|dte_clk_en|i_ip_clk_en|DTE engine clock enable<br>from SSM|ODTE/CDTE/EDTE|
|cf_clk_en|i_cf_clk_en|CF clock enable from SSM|ODTE/CDTE/EDTE|
|df_clk_en|i_df_clk_en|DF clock enable from SSM|ODTE/CDTE/EDTE|
|dte_cfclk_exf|o_cf_ip_clk0|output ip_clk to NOC|ODTE/CDTE/EDTE|
||o_ip_clk0|output ip clock to DTE<br>before ELCG|Drive IP level free<br>run logic, such as<br>axi_reg_bridge|
||o_ip_clk0_elcg|output ip clock to DTE<br>after ELCG|Drive logic only<br>active when DTE<br>is busy.|
||o_ip_clk0_elcg_sub|output ip clock to DTE sub<br>PD block after ELCG|Drive logic only<br>active when DTE<br>is busy.|
|ssm_soc_cold_rst_n|i_ip_cold_rst_n|Input from SSM|cold reset from<br>SSM|
|dte_clk_reset_n|i_ip_rst_n|Input from SSM|IP reset from SSM|
||o_ip_rst_n_clk0|Output to DTE|DTE IP internal<br>async reset|
|i_FLR_REG_RST_N|i_ip_rst_n|input from SSM|only in CDTE，for<br>flr|

**Table 2. Clock & Reset**

### 5.2. DF Master AXI Interface

|**Port**<br>**Direction**|**Port**<br>**Direction**|**Width**|**Description**|
|---|---|---|---|
|**DTE to DF bus AXI write address channel**||||
|**dte_df_portN_axi_awid**|output|9<br>for<br>odte&edte<br>11<br>for<br>cdte|N=0,1 for odte and edte;<br>N=0,1,2,3 for cdte.<br>DTE发出的AWID，和当前<br>执行的VC ID相同，i.e.同一<br>个thread 可以发出不同的<br>AWID|
|**dte_df_portN_axi_awaddr**|output|48||
|**dte_df_portN_axi_awlen**|output|4||
|**dte_df_portN_axi_awsize**|output|3||
|**dte_df_portN_axi_awburst**|output|2|Tie 2'b01|
|**dte_df_portN_axi_awlock**|output|1|Tie 0|
|**dte_df_portN_axi_awcache**|output|4|Drive<br>by<br>DTE<br>internal<br>register|
|**dte_df_portN_axi_awprot**|output|2|Drive<br>by<br>DTE<br>internal<br>register|
|**dte_df_portN_axi_awqos**|output|4|Drive<br>by<br>DTE<br>internal<br>function|
|**dte_df_portN_axi_awuser**|output|48||
|**dte_df_portN_axi_awvalid**|output|1||
|**dte_df_portN_axi_awready**|input|1||
|**DTE to DF bus AXI write data channel**||||
|**dte_df_portN_axi_wdata**|output|1024||
|**dte_df_portN_axi_wstrb**|output|128||
|**dte_df_portN_axi_wlast**|output|1||
|**dte_df_portN_axi_wuser**|output|128|Wdata parity|
|**dte_df_portN_axi_wvalid**|output|1||
|**dte_df_portN_axi_wready**|input|1||
|**DTE to DF bus AXI write response channel**||||
|**dte_df_portN_axi_bid**|input|9<br>for<br>odte&edte<br>11<br>for<br>cdte||
|**dte_df_portN_axi_bresp**|input|2||
|**dte_df_portN_axi_buser**|Input|73||
|**dte_df_portN_axi_bvalid**|Input|1||
|**dte_df_portN_axi_bready**|output|1||
|**DTE to DF bus AXI read address channel**||||
|**dte_df_portN_axi_arid**|output|9<br>for<br>odte&edte<br>11<br>for<br>cdte|DTE 同一个thread发出的<br>read request，ARID[7:0]都<br>是一样的，和<br>thread<br>number相同|
|**dte_df_portN_axi_araddr**|output|48||
|**dte_df_portN_axi_arlen**|output|4||
|**dte_df_portN_axi_arsize**|output|3||
|**dte_df_portN_axi_arburst**|output|2|Tie 2'b01|
|**dte_df_portN_axi_arlock**|output|1|Tie 0|
|**dte_df_portN_axi_arcache**|output|4|Drive<br>by<br>DTE<br>internal<br>register|
|**dte_df_portN_axi_arprot**|output|2|Drive<br>by<br>DTE<br>internal<br>register|
|**dte_df_portN_axi_arqos**|output|4|Drive<br>by<br>DTE<br>internal<br>function|
|**dte_df_portN_axi_aruser**|output|36||
|**dte_df_portN_axi_arvalid**|output|1||
|**dte_df_portN_axi_ardeady**|input|1||
|**DTE to DF bus AXI read response channel**||||
|**dte_df_portN_axi_rid**|input|9<br>for<br>odte&edte<br>11<br>for<br>cdte||
|**dte_df_portN_axi_rdata**|input|1024||
|**dte_df_portN_axi_rresp**|input|2||
|**dte_df_portN_axi_rlast**|input|1||
|**dte_df_portN_axi_ruser**|input|132||
|**dte_df_portN_axi_rvalid**|input|1||
|**dte_df_portN_axi_rready**|output|1||

**Table 3. DF Master AXI Interface**

#### 5.2.1. DF AXUSER Define

（odte 或edte mmu 自发req，axuser 值由mmu 驱动）

|Field|Description|驱动|
|---|---|---|
|Axuser[4:0]|Unit ID|连接SA输出的o_sa_axuser_out[4:0]；<br>mmu自发request，由mmu驱动|
|Axuser[9:5]|Initial ID|连接SA输出的o_sa_axuser_out[9:5]|
|Axuser[10]|Die ID|连接SA输出的o_sa_axuser_out[10]|
|Axuser[11]|Context_Host|DTE内部tie 0|
|Axuser[15:12]|Context ID|来自DTE内部寄存器context_ID，odte<br>mmu可以overwrite|
|Axuser[19:16]|ASID|来自DTE内部寄存器|
|Axuser[20]|Cache last use invalidate|tie 0|
|Axuser[24:21]|Cache prefetch boundary|tie 0|
|Axuser[26:25]|Allocate priority hint|dte_core tie 2'd3，odte、edte mmu内<br>hit_ratio module可以overwrite|
|Axuser[28:27]|evict priority hint|tie 0|
|Axuser[29]|hardware prefetch hint|来自DTE内部寄存器|
|Axuser[30]|LLC maintenance|DTE内部tie 0|
|Axuser[34:31]|Reserved|DTE内部tie 0|
|Axuser[35]|ESL order control|来自DTE内部寄存器|
|Awuser[47:36]|Atomic|来自DTE内部寄存器|

**Table 4. DF AXUSER Define**

### 5.3. CF Slave AXI Interface

|**Port**<br>**Direction**|**Port**<br>**Direction**|**Width**|**Description**|
|---|---|---|---|
|**CF bus to DTE axi write address channel**||||
|**cf_dte_axi_awid**|input|6||
|**cf_dte_axi_awaddr**|input|30||
|**cf_dte_axi_awlen**|input|4||
|**cf_dte_axi_awsize**|input|3||
|**cf_dte_axi_awburst**|input|2||
|**cf_dte_axi_awlock**|input|1||
|**cf_dte_axi_awcache**|input|4||
|**cf_dte_axi_awprot**|input|3||
|**cf_dte_axi_awqos**|input|4||
|**cf_dte_axi_awuser**|input|20||
|**cf_dte_axi_awvalid**|input|1||
|**cf_dte_axi_awready**|output|1||
|**CF bus to DTE AXI write data channel**||||
|**cf_dte_axi_wdata**|input|32||
|**cf_dte_axi_wstrb**|input|4||
|**cf_dte_axi_wlast**|input|1||
|**cf_dte_axi_wuser**|input|4||
|**cf_dte_axi_wvalid**|input|1||
|**cf_dte_axi_wready**|output|1||
|**CF bus to DTE AXI write response channel**||||
|**cf_dte_axi_bid**|output|6||
|**cf_dte_axi_bresp**|output|2||
|**cf_dte_axi_buser**|output|4|0：Everything is okay<br>1：Parity check fail on<br>W_Data and W_User<br>2：Address unaligned error or<br>address hole|
|**cf_dte_axi_bvalid**|output|1||
|**cf_dte_axi_bready**|input|1||
|**CF bus to DTE AXI read address channel**||||
|**cf_dte_axi_arid**|input|6||
|**cf_dte_axi_araddr**|input|30||
|**cf_dte_axi_arlen**|input|4||
|**cf_dte_axi_arsize**|input|3||
|**cf_dte_axi_arburst**|input|2||
|**cf_dte_axi_arlock**|input|1||
|**cf_dte_axi_arcache**|input|4||
|**cf_dte_axi_arprot**|input|3||
|**cf_dte_axi_arqos**|input|4||
|**cf_dte_axi_aruser**|input|20||
|**cf_dte_axi_arvalid**|input|1||
|**cf_dte_axi_ardeady**|output|1||
|**CF bus to DTE AXI read response channel**||||
|**cf_dte_axi_rid**|output|6||
|**cf_dte_axi_rdata**|output|32||
|**cf_dte_axi_rresp**|output|2||
|**cf_dte_axi_rlast**|output|1||
|**cf_dte_axi_ruser**|output|8|Ruser[7:4]=0:Everything is<br>okay;<br>Ruser[7:4]=1:Parity check<br>fail on fan-in R_Data|
|**cf_dte_axi_rvalid**|output|1||
|**cf_dte_axi_rready**|input|1||

**Table 5. CF Slave AXI Interface**

### 5.4. CF Master AXI Interface

|**Port**<br>**Direction**|**Port**<br>**Direction**|**Width**|**Description**|
|---|---|---|---|
|**DTE to CF bus AXI write address channel**||||
|**dte_cf_axi_awid**|output|6|其中0~55，为DTE发出的id<br>范围<br>56~63，为SA发出的id范围|
||||所有error interrupt从CF发<br>出，发出的awid由sa分配，<br>发给SP的error interrupt统一<br>为'd56，发给PCIE的error<br>interrupt统一为'd57;<br>Event trace for dpf发出的<br>awid为'd59;|
|**dte_cf_axi_awaddr**|output|30||
|**dte_cf_axi_awlen**|output|4||
|**dte_cf_axi_awsize**|output|3||
|**dte_cf_axi_awburst**|output|2||
|**dte_cf_axi_awlock**|output|1||
|**dte_cf_axi_awcache**|output|4|Drive by SA|
|**dte_cf_axi_awprot**|output|3|Drive by SA|
|**dte_cf_axi_awqos**|output|4|Drive by SA|
|**dte_cf_axi_awuser**|output|20||
|**dte_cf_axi_awvalid**|output|1||
|**dte_cf_axi_awready**|input|1||
|**DTE to CF bus AXI write data channel**||||
|**dte_cf_axi_wdata**|output|32||
|**dte_cf_axi_wstrb**|output|4||
|**dte_cf_axi_wlast**|output|1||
|**dte_cf_axi_wuser**|output|4|Wdata parity|
|**dte_cf_axi_wvalid**|output|1||
|**dte_cf_axi_wready**|input|1||
|**DTE to CF bus AXI write response channel**||||
|**dte_cf_axi_bid**|input|6||
|**dte_cf_axi_bresp**|input|2||
|**dte_cf_axi_buser**|input|4||
|**dte_cf_axi_bvalid**|input|1||
|**dte_cf_axi_bready**|output|1||

**Table 6. CF Master AXI Interface**

#### 5.4.1. CF AXUSER Define

|Field|Description|驱动|
|---|---|---|
|Axuser[4:0]|Unit ID|连接SA输出的o_sa_axuser_out[4:0]；<br>odte mmu trans由mmu驱动|
|Axuser[9:5]|Initial ID|连接SA输出的o_sa_axuser_out[9:5]|
|Axuser[10]|Die ID|连接SA输出的o_sa_axuser_out[10]|
|Axuser[11]|Context_Host|sa cfg|
|Axuser[15:12]|Context ID|来自DTE内部寄存器context_ID，mmu<br>trans由mmu驱动|
|Axuser[19:16]|ASID|来自DTE内部寄存器，mmu trans由mmu<br>驱动|
|Axuser[20]|Cache last use invalidate|sa cfg|
|Axuser[24:21]|Cache prefetch boundary|sa cfg|
|Axuser[26:25]|Allocate priority hint|sa cfg|
|Axuser[28:27]|evict priority hint|sa cfg|
|Axuser[29]|hardware prefetch hint|sa cfg|
|Axuser[30]|LLC maintenance|sa cfg|
|Axuser[34:31]|Reserved|sa cfg|
|Axuser[35]|ESL order control|sa cfg|

**Table 7. CF AXUSER Define**

### 5.5. Misc

|Signal name|Width|Direction|Description|
|---|---|---|---|
|cf_clk_en|1|input|cf bus clock<br>enable|
|df_clk_en|1|input|df bus clock<br>enable|
|o/e/cdte_cfclk_exf|1|output|Output cf gating<br>clock to NOC|
|dte_clk_en|1|input|Clock enable|
|ENFL_DFT_FUNC_dfd_obs|12|output|Output debug bus|
|dte_spare_bus_in|32|input|Spare bus|
|dte_spare_bus_out|32|output|Spare bus|

**Table 8. MISC Signal Interface**

## 6. SOC Function Description

### 6.1. Clock

DTE 本身是single clock domain 的IP，由于集成了SA，引入了ssm_clk for Global timer， 这部分的CDC 在SA 内部处理，不会引入到DTE core design 里面。

#### 6.1.1. Clock Switch Sequence

DTE 只有一个clock，clock switch 对DTE 是不可见的，clock switch sequence 对DTE 是透

明的。

#### 6.1.2. Clock Structure and Clock Gating

整个DTE 的clock gating 有3 层控制：

1. SSM control IP 的 clock 是否打开，在 SSM 侧控制；

2. Engine level clock gating，由 DTE 给出 idle 信号在 SA 里面控制；

3. Block level clock gating，在 DTE 内部由各个 block 的状态控制；

![Libra_DTE_Architecture_Specification.pdf-0022-09.png](libra_dte_architecture_specification__libra_dte_architecture_specification_pdf_0022_09.png)

**Figure 5. DTE Top Clock Sturcture**

![Libra_DTE_Architecture_Specification.pdf-0023-02.png](libra_dte_architecture_specification__libra_dte_architecture_specification_pdf_0023_02.png)

**Table 9. DTE BLCG**

### 6.2. Reset

DTE IP 的reset 是异步复位，异步释放，reset 的sequence 需要外部控制reset 和clock 之

间的关系。

### 6.3. Power

### 6.4. Control Fabric

DTE 内部没有control fabric。DTE 本身作为外部CF 的slave 来接收configuration 和

signal，同时作为外部CF 的master，发出signal 和interrupt。

### 6.5. Data Fabric

DTE 内部没有data fabric。DTE 本身作为外部DF 的master，发出read 和write

transaction 来完成数据搬运。

### 6.6. Address Mapping

address space:

||SA|common reg|mmu reg|VC reg|Total|
|---|---|---|---|---|---|
|ODTE|0x4000|0x2000|0x2000(4KB*2)|0x200*32=0x4000|48KB|
|EDTE|0x4000|0x2000|0x2000(4KB*2)|0x200*32=0x4000|48KB|
|CDTE|0x4000|0x2000|（空出range）|0x200 * 96=0xC000|80KB|

### 6.7. Reliability, Availability, Serviceability Features

#### 6.7.1. Function Interrupt

DTE 在遇到异常状况或者检测到错误发生时，会记录现场信息，并且发出带有部分异常信息的 interrupt。下面表格中记录了异常中断发生的条件、记录的信息和发出的interrupt vector 所包含的信息：

|Interrupt 种类|Interrupt 发生条件|记录的现场信息|
|---|---|---|
|Illegal Programming|Refer to sect 14.2.2||
|timeout|当wr thread 内一条指令从开始执行到bresp 全部收<br>回的时间超过阈值|thread id，vc id|
|Overwrite<br>working<br>VC<br>（<br>illegal<br>vc<br>config）|当vc trigger 有效后，表明当前vc cmd 已配置完成，<br>如果再更改vc 配置时会报此interrupt（为配合vc<br>invalidate 功能，reg START_TRIGGER 不在检查范围<br>内）|Master id，register<br>addr，vc id|
|Data buffer SRAM<br>parity error|thread里data buffer SRAM在读时出现parity error|sram type/addr ，<br>bank index，thread<br>id|
|CMD buffer SRAM<br>parity error|Command buffer SRAM在读时出现parity error|sram addr ，bank<br>index|
|Mailbox error|Mailbox报错|参考mailbox spec|
|Trace message loss|当custom trace message包产生速度大于sa发送速<br>度时，packet会出现丢失|Process id，vc id和<br>context id|
|Read data response<br>error|当read data 的出现response error，由sa 发出<br>error interrupt，dte_core只负责记录error log|Thread id，context<br>id，vc id，ruser 和<br>rresp|
|Read<br>data<br>parity<br>error|当read data 出现parity error，由sa 发出error<br>interrupt，dte_core只负责记录error log|Thread id，context<br>id，vc id，ruser 和<br>rresp|
|mmu0 ce error|only in odte&edte, mmu0 error|参考mmu spec|
|mmu0 ue error|only in odte&edte, mmu0 error|参考mmu spec|
|mmu0 dfparityerr|only in odte&edte, mmu0 error|参考mmu spec|
|mmu0 error|only in odte&edte, mmu0 error|参考mmu spec|
|mmu1 ce error|only in odte&edte, mmu1 error|参考mmu spec|
|mmu1 ue error|only in odte&edte, mmu1 error|参考mmu spec|
|mmu1 dfparityerr|only in odte&edte, mmu1 error|参考mmu spec|
|mmu1 error|only in odte&edte, mmu1 error|参考mmu spec|
|sm4 xts error|only in odte，xts error|参考sm4_xts spec|

**Table 10. Interrupt Type**

#### 6.7.2. Force trigger Interrupt

4.0 为了满足chip 上sw 对各个function error interrupt coverage，新增force trigger interrupt 功能。在DTE idle 状态，sw 可以配置相应interrupt trigger 信号，DTE 会发出对 应的一笔interrupt，支持的interrupt 包括：timeout，data sram parity error，register sram parity error，illegal programming，mailbox error，Overwrite working VC（或者 叫illegal vc cfg）。

### 6.8. HW Sync

DTE 主要通过mailbox 和signal 来与它的producer 和consumer 来进行HW sync。

如下图所示，DTE 需要和其数据的producer 和consumer 进行sync，DTE 的producer 准 备好数据之后，会signal DTE 中对应的mailbox，告诉DTE source 数据已经准备好，同样 DTE 的consumer 准备好接收数据的空间之后，会signal DTE 中对应的mailbox，告诉DTE source 接收数据的空间已经准备好。当数据和其接收空间都准备好之后，DTE 可以开始当前 数据传输，同时更新DTE 内部对应的mailbox 状态，消耗数据和接收空间的credit。当数据 传输完成之后，DTE 会signal 其producer 和consumer，让他们也更新其内部所对应的 mailbox 的状态。下图所示红色虚线框内，DTE 对其producer 而言，是consumer；绿色虚 线框内，DTE 对其consumer 而言，是producer。

除了与DTE 当前task 的producer 和consumer 来进行sync 之外，DTE 还可以同时在一个 task 里面通知这个task 的manager（比如AP/SP）当前task 完成。

1. Assume HW sync 暴露的接口和mailbox 时一样的，

2. SP 的sync 由consumer 和task manager signal interface 完成；

![Libra_DTE_Architecture_Specification.pdf-0027-03.png](libra_dte_architecture_specification__libra_dte_architecture_specification_pdf_0027_03.png)

**Figure 6. HW sync - mailbox/signal**

### 6.9. Debugger

Refer to DTE_Programming_Guide，section 4 Programming for Debug and Profiling，

包括RAS，debug info，DTE stop

### 6.10. Atomic store transaction

DTE 支持 atomic store transaction，由软件配置 atomic awatop，atomic mode，atomic scalar/vector selection，atomic CAS flag 和 data type 参数，DTE 在发送写 burst 时，会将这 些参数由 awuser[47:36]发送出去。

### 6.11. MMU

odte/edte 内两路 df path 上会分别集成 mmu，负责将从 DVA（device virtual address）到

IPA（intermediate physical address）的地址转换，

cdte 内没有集成 mmu，cdte request 的地址转换会在 soc 上 sic_mmu_pd_wrap block 里完

成。

### 6.12. Privacy Computing

odte 内例化一个隐私计算模块，用于 host mem 数据搬运时解密工作。出于数据安全性的考 虑，当从 host mem 搬运数据到内部 mem 时，host mem 的数据是经过加密的，在搬运过程 中需要解密后放入内部 mem。隐私模块，或叫 sm4_xts 模块，会放在 odte 内 thread0 和 mmu0 之间，对 mmu0 返回给 thread 的 read data 先进行解密后再返回给 thread0 使用。

### 6.13. Dynamic Queue Ctrl

4.0 上新增dynamic queue ctrl feature，每个vc 会伴随一个queue id，相同queue id 的 vc 作为一组。在enable dynamic queue 功能后，arbiter 会先选择queue，对于胜出的 queue，通过vc priority 选出vc 给予grant。

## 7. DTE Function Description

### 7.1. Multi VC

DTE 提供了多个VC 的编程接口。每个VC 是由多个register 组成的一个register group，作 为存储单个DTE command 的基本单位。

### 7.2. Multi Thread

在DTE 4.0 中，每个DTE 由多个thread 组成。每个thread 都可以独立执行一个DTE 的

command。多个thread 可以并行执行多个command。ODTE 和EDTE 分别有两个独立的 thread，CDTE 有4 个独立的thread。

![Libra_DTE_Architecture_Specification.pdf-0029-04.png](libra_dte_architecture_specification__libra_dte_architecture_specification_pdf_0029_04.png)

**Figure 7. Multi Thread**

如上图所示，在一个DTE 中，read request，read response，write request 和write

response 4 个pipeline 组成了一个独立的thread：

1. 每个thread 的read/write pipe 支持up to 4 个command inflight；inflight command

要满足最佳performance，对应的最小size，ODTE/EDTE/CDTE 32KB。

2. 只有ultra-thread 可以执行reshape 的指令，normal thread 不能执行上述指令。libra 上 增加了inflight reshape 功能，所以，执行reshape 的时候可以pipeline 的同时处理其他指

令；

3. 每个thread 里面各个command 的read 按顺序执行，ARID 相同，不同的thread ARID 不一样。对同一个thread 而言read 数据返回的顺序是in-order 的；

4. 每个thread 里面各个command 的write 也是按顺序执行，AWID per command，返回 的write response 可以是out-of-order 的；

5. write response pipe 负责管理当前thread 的write response。它同时能管理8 个inflight command 的response；

6. signal pipe 负责管理所有thread 内已完成command 的signal，独立于单个thread 之外。 它同时能管理的inflight command 的个数等于8 * thread number。先收完所有write response 的task，对应的signal 动作先发生。因write response 是out-of-order 的返回的， 所以signal 的执行也会是out-of-order 的。

### 7.3. Thread Allocation for VC

在多个VF 使用同一个DTE 的情况下，可能需要对硬件资源做静态的划分。DTE 可以对每一个 VC 配置其执行的thread，比如CDTE 中有4 个thread，可以set VC0 只能在thread 0，1， 中执行；VC32 只在thread 2，3，中执行。

### 7.4. VC Arbitration

当DTE 中有多个VC pending 的时候，硬件会通过多次arbitration，每次从这些VC 中选择1 个VC, push 到某一个available 的thread 中，具体的arbitration scheme 如下：

1. Thread select。对于每个 thread，如果其中的每级 pipe 都没有 full，那么认为这个 thread 对 arbitration 是 available 的。对 available 的 thread 采用 Round-Robin 的方式做选择。

2. VC filter。对于 pending 的 VC，根据以下情况进行过滤，满足下面所有条件的 VC 才能参与仲裁：

   - Configuration 完成。
   - Dependency/mailbox 满足。
   - Dynamic queue：4.0 新增 dynamic queue feature。打开 dynamic queue 功能后，每个 VC 会伴随一个 queue id，相同 queue id 的 VC 作为一组。每个 qid 都有一个对应的 qqos。在选择 VC 之前，要先选择 queue；queue 的选择采取 qqos + RR 的原则，优先选择 qqos 大的 queue，在具有相同 qqos 的 queue 之间，采取 round robin 的方式来选择出胜出的 qid。选中 qid 之后（qid=M），只有 qid 的值为 M 的 VC 才能参与下一步仲裁。

3. Arbitration 优先级：

   - Round-Robin。
   - QOS。
   - Order list：先被配置到 DTE 里面的 VC 比后配置到 DTE 里面的 VC 有更高的优先级。

以上列出各项优先级的计算是相互独立的。最终仲裁的优先级判断，从高到低依次为：QOS > order list > Round-Robin。Order list 优先级生成可以由 register 控制是否打开。

### 7.5. Port Allocation

对于CDTE，EDTE 和ODTE，每组port 和thread 绑定，每组port 的属性相同，为 command 分配thread 的时候也就指定了对应的port。

### 7.6. Decoupled Read/Write Pipeline

如下图所示，4.0 中，DTE 的read 和write 部分是通过DTE internal buffer 做隔离，完全解

耦的。Read 按照source tensor 的size 和对source command 的操作发起read request，

在数据返回时候，经过read data processing，把数据linear 的存入DTE internal buffer； 这样从write 这边看，它的source 是linear 存在DTE internal buffer 里面的数据，write

request/data processing 只需要按照destination tensor 的size 和操作来传输数据，而不需

要管source data 是怎么样存入internal buffer 的。

![Libra_DTE_Architecture_Specification.pdf-0032-07.png](libra_dte_architecture_specification__libra_dte_architecture_specification_pdf_0032_07.png)

**Figure 8. Read/Write Decouple**

### 7.7. Data Format

DTE support 1 Byte Per Element（INT8）, 2 Byte Per Element(FP16/BF16)，4 Byte Per Element(FP32/TF32)。

对于tensor data，DTE 支持5 个维度的size 描述，4 个维度的操作数定义，即每个tensor 有dim0~dim4 5 个dim size 来define tensor 的大小，每个dim size 最多支持24 bit；在

最高维度dim4 上，没有任何的操作数，只是单纯的重复完成对低4 个维度的操作。

### 7.8. Total size

DTE 支持的最大size 为512GB-1B，也就是linear cp size 以及tiling 操作的src、dst tensor size 不能超过512GB-1B。

### 7.9. Operation

各种DTE 支持下列的数据搬运/变换指令：

|OP type|Abbreviation/op_code|ODTE|EDTE|CDTE|
|---|---|---|---|---|
|Linear Copy|LNC/0x01|Y|Y|Y|
|Single Sync|SS/0x02|Y|Y|Y|
|Global Sync|GS/0x03|Y|Y|Y|
|Data Shrink|DS/0x06|Y|Y|Y|
|Data Expand|DE/0x07|Y|Y|Y|
|Constant Filling|CF/0x08|Y|Y|Y|
|Padding|PAD/0x10|Y|Y|Y|
|Reshape|RSHP/0x12|N|N|Y|
|Broadcasting|BRDCST/0x13|N|N|Y|
|Slice|SLC/0x14|N|N|Y|
|De-Slice|DSL/0x15|N|N|Y|
|Sub-Sample|SSMP/0x16|N|N|Y|
|Horizontal Mirror|HMIR/0x17|N|N|Y|
|Vertical Mirror|VMIR/0x18|N|N|Y|
|Slice + Padding|SLCPAD/0x30|N|N|Y|
|Slice + De-Slice|SLCDSL/0x31|N|N|Y|
|Slice + Data Expand|SLCDE/0x32|N|N|Y|
|Horizontal Mirror + De-Slice|HMIRDSL/0x33|N|N|Y|
|Vertical Mirror + De-Slice|VMIRDSL/0x34|N|N|Y|
|Horizontal Mirror + Padding|HMIRPAD/0x35|N|N|Y|
|Vertical Mirror + Padding|VMIRPAD/0x36|N|N|Y|
|Constant Filling + De-Slice|CFDSL/0x37|N|N|Y|
|Slice + Reshape|SLCRSHP/0x38|N|N|Y|
|Reshape + De-Slice|RSHPDSL/0x39|N|N|Y|
|Data Shrink + De-Slice|DSDSL/0x3a|N|N|Y|
|Slice + Broadcasting|SLCBRDCST/0x3b|N|N|Y|

**Table 11. DTE and Supported OP**

#### 7.9.1. Linear Type

1. Linear Copy

将指定 size 的连续数据从 source address copy 到 destination address。

2. Data Expand

通过填 0 的方式，把 BPE1,2,3（EF32）的 data expand 到 BPE2,4 (bpe4 pad0)

3. Data Shrink

通过截取的方式，把 BPE2,4 的 data shrink 到 BPE3(EF32),2,1(bpe4 下采样)

4. Constant filling

把预设的常数填到指定的地址空间。

#### 7.9.2. Sync Type

1. Single Sync

该指令只完成 producer/consumer 之间通过 mailbox/signal 方式的 sync 动作，没有数

据传输。

2. Global Sync

DTE 有 dedicate 的 Gsync command 来 support 整个系统的 Global Sync 的 function。

Gsync command 分为 Gsync Register 和 Gsync info 两种：

1. Gsync Register，注册到 Global Sync module 的某一个 entry 中；define 对应的

entry 信息，sync 条件满足后需要发送 event 的地址和数据（某个 engine 的某个

mailbox）；

2. Gsync info，向 Global Sync module 的某个 entry 发送 signal；

#### 7.9.3. Tiling Type

##### 1. Padding

在各个维度的 head/tail 上将预设的 value pad 到指定的长度，除了 dim0 以外，还可以

在 dim 中间 pad。如下图所示：

![Libra_DTE_Architecture_Specification.pdf-0036-01.png](libra_dte_architecture_specification__libra_dte_architecture_specification_pdf_0036_01.png)

**Figure 9. Padding at dim0/1**

![Figure 10 Padding at dim2](libra_dte_architecture_specification__figure_010_padding_dim2.png)

**Figure 10. Padding at dim2**

![Figure 11 Padding at dim3](libra_dte_architecture_specification__figure_011_padding_dim3.png)

**Figure 11. Padding at dim3**

##### 2. Reshape

将一个tensor 的source 维度按照config mapping 到destination 的任意维度。下面是一个

NCHW 到NHWC 的例子：

RESHAPE_DIM0_MAP = 2 (destination dim0 from source dim2 C);

RESHAPE_DIM1_MAP = 0 (destination dim1 from source dim0 W);

RESHAPE_DIM2_MAP = 1 (destination dim2 from source dim1 H);

RESHAPE_DIM3_MAP = 3 (destination dim3 from source dim2 N);

![Libra_DTE_Architecture_Specification.pdf-0038-02.png](libra_dte_architecture_specification__libra_dte_architecture_specification_pdf_0038_02.png)

**Figure 12. NCHW Reshape to NHWC**

当source dim0 size 为4，16，32(bpe2 only)时，支持enhanced reshape read;

当destination dim0 size 为4，16，32(bpe2 only)时，支持enhanced reshape write;

另外针对dim0 size=3 时的transpose(dim0<->dim1)，DTE 支持这种特定场景的enhance reshape

##### 3. Broadcasting

把 size 为 1 的维度扩展到指定的 size，形成新的 tensor:

```
|789|  ==>  |789|      |7|  ==>  |777|
              |789|      |8|       |888|
              |789|      |9|       |999|
```

##### 4. Slice

从一块大的 source tensor 的指定位置开始，切出来一块小的 tensor。

![Libra_DTE_Architecture_Specification.pdf-0039-05.png](libra_dte_architecture_specification__libra_dte_architecture_specification_pdf_0039_05.png)

**Figure 13. Slice OP**

当需要被切的tensor 超出source tensor 的时候，HW 会在超出的部分做auto padding，如

下图所示：

![Figure 14 Auto Padding at Tail](libra_dte_architecture_specification__figure_014_auto_padding_tail.png)

**Figure 14. Auto Padding at Tail**

![Figure 15 Auto Padding at Head](libra_dte_architecture_specification__figure_015_auto_padding_head.png)

**Figure 15. Auto Padding at Head**

##### 5. De-Slice

把一块小的 tensor 填充到另一块大 tensor 的指定位置，该操作为 slice 的逆操作：

![Figure 16 De-Slice OP](libra_dte_architecture_specification__figure_016_de_slice_op.png)

**Figure 16. De-Slice OP**

跟slice+auto padding 类似，当deslice 在destination tensor 的位置靠边，造成有部分在destination tensor 外面时，HW 会把这部分auto strip，如下图蓝色部分：

![Figure 17 Auto Strip + Deslice](libra_dte_architecture_specification__figure_017_auto_strip_deslice.png)

**Figure 17. Auto Strip + Deslice**

##### 6. Sub-Sampling

   - 在 source tensor dim1 上下采样产生 destination tensor:

![Libra_DTE_Architecture_Specification.pdf-0041-03.png](libra_dte_architecture_specification__libra_dte_architecture_specification_pdf_0041_03.png)

**Figure 18. Sub-Sampling**

##### 7. Mirror left/right (Horizontal Mirror) and Mirror top/bottom (Vertical Mirror)

在水平(dim0)/垂直(dim1)方向上做镜像操作。

![Libra_DTE_Architecture_Specification.pdf-0041-07.png](libra_dte_architecture_specification__libra_dte_architecture_specification_pdf_0041_07.png)

![Libra_DTE_Architecture_Specification.pdf-0041-08.png](libra_dte_architecture_specification__libra_dte_architecture_specification_pdf_0041_08.png)

**Figure 19. Mirror**

#### 7.9.4. Combo Type

如section“Decoupled Read/Write Pipeline”描述的，DTE 读写控制相对独立，一些只有

读控制的OP 和只有写控制的OP 可以组合成combo 的OP，如下表所示

|Read process OP|Write process OP|Combo OP|
|---|---|---|
|Slice|Deslice|Slice + deslice|
|Slice|Padding|Slice<br>+<br>padding(**any**<br>**value**)|
|Slice|Broadcasting|Slice + Broadcasting|
|Slice|Expand|Slice + expand|
|Shrink|Deslice|Shrink+deslice|
|Mirror(Horizontal/Vertical)|Deslice|Mirror(H/V) + deslice|
|Mirror(Horizontal/Vertical)|Padding|Mirror(H/V) + Padding|

**Table 12. Combo OP**

![Libra_DTE_Architecture_Specification.pdf-0042-39.png](libra_dte_architecture_specification__libra_dte_architecture_specification_pdf_0042_39.png)

**Figure 20. Slice + Deslice**

除了以上的读写口分开control 组合产生的combo OP 之外，还有一些SW 常用定制的

combo OP:

1. Slice + reshape

2. Reshape + deslice

4.0 上增加了slice+auto-padding+reshape 和reshape+deslice+auto-strip 组合。 DTE 支持 slice padding reshape 三个操作的组合操作。在 slice reshape 的基础上，在 slice 的时候可以对 tensor 进 auto padding 操作，然后再对切出来的 tensor 进行 reshape 操作。 目前仅仅支持在各个维度的 low 和 high 方向做 padding ，不支持对 interior 做 padding

DTE 支持 reshape deslice auto strip 操作。在 reshape deslice 的基础上，在 deslice 的时候 可以对 tensor 进行 auto strip 操作，和 deslice 其它的 comb 组合操作一样，仅支持尾巴方 向的 auto strip ，并且不能将 source 全部 strip 掉。

### 7.10. Infinite Buffer Mode

DTE 在Infinite Buffer Mode 下，发出的read request 可以超过当前internal buffer 可以接 收的数据量，从而提升inflight 的read request 的个数，cover 更大的read latency。在这种 mode 下，当internal buffer 因为write path 被反压而满的时候，DTE 会反压read data return path。4.0 上，新增了reshape ifb mode，控制寄存器为common register， reshape 同样可以支持ifb mode，并为reshape 新加了独立的data buffer。4.0 上，cdte 的 normal data buffer 为128x128bytes，reshape data buffer 为384x128bytes，提升了 reshape 执行时read request 个数。

#### 7.10.1. Watermark Control

为了减少由于write path 被反压造成的反压read data return bus 的情况，DTE 在使用IFB mode 的时候还可以通过watermark 来判断是否停发read request，来减少data buffer 中 积累的数据量，从而减小data buffer full 造成read return bus 被反压的概率。具体的实现就

是在enable watermark control 的情况下，DTE 会比较当前data buffer 里面所存储的数据量和set 的watermark 的值，如果数据量hit 了watermark，那么停止发送read request，否则就继续发送read request。reshape ifb mode 不支持watermark control。

#### 7.10.2. Port throttle

DTE 中为每组读写port 都例化了一个HW 的 bandwidth/outstanding throttle。Port throttle 可以控制从对应的read/write port 口发出的outstanding number 和实际使用的 bandwidth，当outstanding number 或者单位窗口内的bandwidth 达到了设定的阈值的时 候，throttle 会反压上游outbound 的request，达到控制流量的目的。4.0 上 throttle 在 outstanding 控制上新增功能，在 read channel 上的 outstanding 控制，可以选择 axi address channel 上 burst 数目的控制或者 axi data channel 上 data 数目的控制。

### 7.11. SPMD

CDTE 里面有多个可以并行执行的thread 并且所有的port 属性都是一样的。在只有少量 command 被执行的情况下，为了充分利用CDTE 的带宽/thread 资源，CDTE 支持将一笔 command 拆分成多笔小的command，分发到多个thread 上并行执行的功能（Single Program Multiple Data）。

#### 7.11.1. Linear Copy Split

对于linear copy 的command，如果需要被split，那么需要user 给出split 的size，HW 每 次推送split 的task 到thread 上面都从total size 里面减去split 的size，直到最后剪完total

size；如果最后一次split 的size，大于剩余的total size，则最后一次的size 为剩余size。

#### 7.11.2. Tiling OP Split

对于tiling OP，split 的次数为dim 4 的size，每次split source address 和destination address 都递增source dim4 pitch 和destination dim4 pitch。

#### 7.11.3. Prefetch Task Split

![Libra_DTE_Architecture_Specification.pdf-0045-05.png](libra_dte_architecture_specification__libra_dte_architecture_specification_pdf_0045_05.png)

**Figure 21. Prefetch Task Split**

- 如上图左上所示，初始状态为 DTE 只有一个大 size 的 prefetch command，被 split 成多份（假设每一份的 size 是 32KB）。prefetch command 的初始 QOS 配置为低；由于此时没有其他 VC 的 command 与其抢占资源，split 之后的 prefetch command 会占满所有 Physical Channel。

- 当 normal task 开始被下发到之前 empty 的 VC 时，由于 normal task 的 QOS 较高，这些 task 会第一时间抢占 Physical Channel，如图中左下所示。

- 当 normal task 被大量下发到各个 VC 时，高 QOS 的 task 会逐渐占据所有 Physical Channel。此时 low QOS 的 prefetch task 抢占不到 Physical Channel 资源，会被逐渐“挤出”各个 Physical Channel。

- 当 prefetch command 的管理者长时间没有收到 prefetch 完成通知，或者有 dependency 的其他任务开始等待 prefetch 时，会通过重写 prefetch command 所在 VC 的 QOS 来提高剩余 prefetch command 的优先级。此时，prefetch command 被 split 之后的 task 又会逐渐抢占之前由 normal task 抢占的各个 Physical Channel。

### 7.12. HW Command Optimizer

考虑到Dynamic shape 的情况下，下发给DTE 的command 由于compiler 无法根据tensor 的size 做最佳的指令优化。DTE 内部的HW command optimizer 可以根据一些简单的rule， 将下发到DTE 的slice/deslice 指令做优化，然后执行：

#### 7.12.1. Tiling to Linear

|OP type|Change to Linear condition|New linear<br>configuration|Benefit|
|---|---|---|---|
|Padding|No padding at any dimensions|Same position/size<br>for src/dst|写侧带宽从BL1 到<br>linear<br>performance|
|Slice|1.<br>Src dim N size no less than dst dim N size;<br>and<br>2.<br>Src dim N-1 to 0 size equal to dst dim N-1<br>to 0 size; and<br>3.<br>Src/dst dim N+1 to 4 =1|Same<br>dst<br>start<br>address<br>Src start address =<br>slice start position<br>Transfer size = dst<br>size|读侧带宽达到linear<br>performance|
|Deslice|1.<br>Dst dim N size no less than src dim N size;<br>and<br>2.<br>Src dim N-1 to 0 size equal to dst dim N-1<br>to 0 size; and<br>3.<br>Src/dst dim N+1 to 4 =1|Same<br>src<br>start<br>address<br>dst start address =<br>deslice<br>start<br>position<br>Transfer size = src<br>size|写侧带宽达到linear<br>performance|
|Slice+Deslice|根据上面单个slice/deslice 的优化条件，如果满足一个，则将combo command 转化为单个<br>slice/deslice command；如果两个条件都满足，则转化为linear copy。||读/ 写侧带宽达到linear<br>performance|

**Table 13. Tiling to Linear Cases**

#### 7.12.2. Merge Low Dimension

|OP type|Merge low dimension condition|New configuration|Benefit|
|---|---|---|---|
|Slice|Src dim0 size == dst dim0 size(slice dim0<br>size)<br>最低维度全部slice，等同于把dim1 和dim0<br>merge 成新的dim0，然后在新的dim0 上做<br>slice.|Src dim0 size new =<br>Src dim0 size * src<br>dim1 size;<br>Src dim1 size new =<br>1;<br>dst dim0 size new =<br>dst dim0 size * dst<br>dim1 size;<br>dst dim1 size new =<br>1;|增加了最低维度的<br>每次写数数据的<br>size，|
|Deslice|dst dim0 size(deslice dim0 size) == dst dim0<br>size<br>最低维度全部deslice，等同于把dim1 和dim0<br>merge 成新的dim0，然后在新的dim0 上做<br>deslice.|Src dim0 size new =<br>Src dim0 size * src<br>dim1 size;<br>Src dim1 size new =<br>1;<br>dst dim0 size new =<br>dst dim0 size * dst<br>dim1 size;<br>dst dim1 size new =<br>1;|增加了最低维度的<br>每次读数据的<br>size，|
|Slice+Deslice|Src dim0 size ==slice/deslice dim0 size==<br>dst dim0 size<br>最低维度全部move，等同于把dim1 和dim0<br>merge 成新的dim0，然后在新的dim0 上做<br>slice + deslice.|Src dim0 size new =<br>Src dim0 size * src<br>dim1 size;<br>Src dim1 size new =<br>1;<br>dst dim0 size new =<br>dst dim0 size * dst<br>dim1 size;<br>dst dim1 size new =<br>1;|增加了最低维度的<br>每次读写数据的<br>size，|

**Table 14. Merge Low Dimension Cases**

### 7.13. Write combine

由于DTE 内部的属性，在某些配置下，可能会造成发往write bus 的一笔transaction 中，有

效数据比较少，出现partial write ，或者burst length 比较少的情况。为了提高 performance，降低partial write 的次数和概率，增加长burst 的概率，DTE 在写接口上支持 write combine 的功能，即把连续写往同一段地址的多个小的write request，merge 成一笔 长的write request 的功能。Write combine 之后的burst length，最大为burst 4。当 input 的burst length 大于等于4 时，会被bypass，直接发送给downstream。4.0 上新增 在指定地址范围内，hw 自动disable write combine 功能，这个功能用于PSE 在chip 上用 cdte 对host mem 做数据搬运时disable write combine，防止PCIE hang 出现。

### 7.14. DTE Stop and Invalidate

DTE 支持在特殊场景下stop 的功能：

1. 当 task 处理过程中出现异常的时候，比如出现总线的 error，DTE 可以根据配置，在当前 task 结束之后，停止处理新的 task；

2. 当 user 需要 debug 的时候，可以主动的 set DTE stop，来观测现场和调试；

3. 当需要做 BLR 的时候，需要先 set DTE stop，然后等待 DTE idle，最后在做 BLR。在等待 idle 的过程中，DTE 还支持 VC invalidate 的功能--向 pending VC 的 start_trigger bit 写 0，invalidate 还没有执行的 VC，从而加速等待 idle 的过程。如果发生 invalidate，那 么可以选择让 HW 来自动 clean 被 invalidate 的 VC 所对应的 mailbox。

### 7.15. Dynamic Clock Gating

整个DTE 的clock gating 分为多层，如下图所示：

Input clock 受控于input 给DTE 的clock enable，在SA 中做整个DTE 的clock gating。经

过root gater 之后的clock 再分别由各个thread block 的状态做进一步的clock gating

control。

![Libra_DTE_Architecture_Specification.pdf-0049-02.png](libra_dte_architecture_specification__libra_dte_architecture_specification_pdf_0049_02.png)

**Figure 22. DTE Dynamic Clock Gating**

#### 7.15.1. Thread Dynamic Clock Gating

Top 上对每一个thread，根据thread empty 和arbitration 做thread 的clock gating。当 arbitration 开始的时候，就打开thread clock, 当thread idle(not busy)的时候，关闭 thread clock。

#### 7.15.2. Dynamic Clock Gating Inside Thread

Thread 里面，根据当前操作的 OP type 做 clock gating，目前支持以下四种类型：

1. Reshape OP type，包括 reshape、slice+reshape 和 reshape+deslice。

2. Padding OP type，包括 padding、slice+padding 和 h/v mirror+padding。

3. Deslice OP type，包括 deslice、slice+deslice、h/v mirror+deslice 和 data_shrink+deslice。

4. Broadcast OP type，包括 broadcast 和 slice+broadcast。

#### 7.15.3. Other Clock Gating

CF 使用DTE busy 做clock gating。

CRC，可以根据其是否enable，来做clock gating

### 7.16. Cache Hit Ratio Control

Cache hit ratio 模块放在mmu 里，dte thread 在axuser[26:25] allocate priority hint tie

**2'd3** , 当经过mmu，由mmu 计算后overwrite 对应bit

## 8. Feature Flags and Configuration

DTE 的feature 可以使用feature flag 来静态的config 成多种不同的instance，在当前的

project 中，各个feature flag 和config 如下表所示：

|Feature|Feature Flag|ODTE|EDTE|CDTE|
|---|---|---|---|---|
|Multi thread|THD_NUM|2|2|4|
|Multi ultra-thread|UTHD_NUM|0|0|4|
|Normal thread data buffer<br>depth|NTHD_DBUF_DPTH|1024|512|-|
|Normal thread data buffer<br>width|NTHD_DBUF_WIDTH|1024|1024|-|
|Ultra-thread<br>data<br>buffer<br>depth|UTHD_DBUF_DPTH|-|-|128|
|Ultra-thread data buffer width|UTHD_DBUF_WIDTH|-|-|1024|
|Ultra-thread rshp data buffer<br>depth|UTHD_RSHP_DBUF_DPTH|-|-|384|
|Ultra-thread rshp data buffer<br>width|UTHD_RSHP_DBUF_WIDTH|-|-|1024|
|TrackingFIFO depth|TRCK_FIFO_DPTH|256|256|768|
|Multi VC|VC_NUM|32|32|96|
|Multi readports|RD_PORT_NUM|2|2|4|
|Multi writeports|WR_PORT_NUM|2|2|4|
|Mailbox|MBX_NUM|64|64|256|
|Read response pipe queue<br>depth|RRSP_PIPE_QDPTH|4|4|4|
|Write request pipe queue<br>depth|WREQ_PIPE_QDPTH|4|4|4|
|Write response pipe queue<br>depth|WRSP_PIPE_QDPTH|8|8|8|
|Register buffer depth|REG_BUF_DPTH|32|32|96|
|Register buffer width|REG_BUF_WIDTH|1280|1280|1280|
|Signal queue depth|SIG_QDPTH|16|16|32|
|L2 Loss present|L2LOSS_PRSNT|0|0|0|
|CRC present|CRC_PRSNT|1|1|1|
|Data Shrink OP present|SHK_PRSNT|1|1|1|
|Data Expand OP present|EXP_PRSNT|1|1|1|
|Constant filling OP present|CSTF_PRSNT|1|1|1|
|Single Sync OP present|SYNC_PRSNT|1|1|1|
|Global Sync OP present|GSYNC_PRSNT|1|1|1|
|Padding OP present|PAD_PRSNT|1|1|1|
|Reshape OP present|RSHP_PRSNT|0|0|1|
|Broadcasting OP present|BRDCST_PRSNT|0|0|1|
|Slice OP present|SLC_PRSNT|0|0|1|
|De-Slice OP present|DSL_PRSNT|0|0|1|
|Sub-sample OP present|SSMP_PRSNT|0|0|1|
|Horizontal Mirror OP present|HMIR_PRSNT|0|0|1|
|Vertical Mirror OP present|VMIR_PRSNT|0|0|1|
|HSDC present|HSDC_PRSNT|0|0|0|
|Slice + padding OP present|SLCPAD_PRSNT|0|0|1|
|Slice + deslice OP present|SLCDSL_PRSNT|0|0|1|
|Slice<br>+<br>data<br>expand<br>OP<br>present|SLCDE_PRSNT|0|0|1|
|H-Mirror<br>+<br>deslice<br>OP<br>present|HMIRDSL_PRSNT|0|0|1|
|V-Mirror + deslice OP present|VMIRDSL_PRSNT|0|0|1|
|H-Mirror<br>+<br>padding<br>OP<br>present|HMIRPAD_PRSNT|0|0|1|
|V-Mirror<br>+<br>padding<br>OP<br>present|VMIRPAD_PRSNT|0|0|1|
|Constant filling + deslice OP present|CFDSL_PRSNT|0|0|1|
|Slice + reshape OP present|SLCRSHP_PRSNT|0|0|1|
|Reshape + deslice OP present|DSLRSHP_PRSNT|0|0|1|
|Data Shrink + deslice OP present|DSDSL_PRSNT|0|0|1|
|Slice + broadcast OP present|SLCBRDCST_PRSNT|0|0|1|
|SIP prefetch VC present|SIP_PF_PRSNT|0|0|0|
|DVFS event present|DVFS_PMC_PRSNT|0|0|0|
|Partial write encoding present|PARTIAL_WR_PRSNT|0|0|0|
|Write combine|WR_COMB_PRSNT|0|0|1|
|Hit ratio|HIT_RATIO|0|0|0|

**Table 15. Feature Flag**

## 9. Programming Guideline

Refer to DTE_Programming_Guide

### 9.1. Cold Boot Config Sequence

Refer to DTE_Programming_Guide, section 3.1 DTE Initial setting

### 9.2. Task Launch Sequence

Refer to DTE_Programming_Guide , section 3.2 VC Programming

#### 9.2.1. Bus Consistency Description

DTE HW 看到的task 级别的sequence 和dependency，需要DTE 的user 显式的建立起各

个task 的数据依赖。

### 9.3. Error Recovery Sequence

NA

### 9.4. Error Detection Sequence

#### 9.4.1. DTE Internal Error

对于DTE 内部的error，refer to 6.7.1 function interrupt

#### 9.4.2. BUS Error

dte bus error 由sa 检测并发出error interrupt，ruser 和buser 会记录更多信息

ruser 高4bit define in SOC。

|R_User[7:4] value in ECF / R_User[131:128] value in EDF|Description|Mandatory in Libra|
|---|---|---|
|0|Everything is okay|Yes|
|1|Parity check fail on fan-in R_Data|Optional for memory|
|2|Address unaligned error or address hole|No|

**Table 16. Ruser Description**

|B_User[3:0] value|Description|Mandatory in Libra for AXI slave?|
|---|---|---|
|0|Everything is okay|Yes|
|1|Parity check fail on W_Data and W_User|Yes|
|2|Address unaligned error or address hole|No|

**Table 17. Buser Description**

##### 9.4.2.1. DF Bus Error

DTE 作为DF bus 的master，会向总线发起读和写request。对于ODTE, EDTE 和CDTE：

|Outbound<br>Transaction<br>type|DTE core action|SA action|Slave action|
|---|---|---|---|
|write|DTE 会根据SA 送出的<br>bresp 判断是否出错，<br>如果有ERR resp, 则根<br>据配置选择是否进入<br>stop 状态|Generate parity bit in wuser[127:0]和<br>error injection<br>Check bresp 是否为error，如果是<br>error，可以根据配置发送interrupt，并<br>log bid/buser/bresp，同时送出bresp 到<br>DTE core|Slave 如果根据wuser 和<br>wdata check parity 出<br>错，会返回SLVERR；如<br>果地址不对，会返回<br>DECERR（parity error<br>优先级高）|
|read|DTE 会根据SA 送出的<br>rresp 和ruser[127:0]判<br>断是否出错，如果有<br>ERR resp 或者<br>ruser[127:0]不为0, 则<br>根据配置选择是否进入<br>stop 状态|Check parity bit in ruser[127:0]和<br>rresp，如果发生parity check fail 或者<br>error response，可以根据配置发送<br>interrupt，并log rid/ruser/rresp，同<br>时，如果SA check parity fail，会将<br>ruser[127:0]改写成全1，并将改写后的<br>ruser 和原始的input rresp/rdata 返回<br>DTE|根据rdata 产生parity 放<br>在ruser[127:0]<br>如果read 地址不对，返<br>回DECERR；如果slave<br>发生读内部sram parity<br>错误，需要按照table14<br>的描述，将对应的ruser<br>bit 至1，并返回<br>SLVERR。|

**Table 18. ODTE/EDTE/CDTE DF RAS as Master**

##### 9.4.2.2. CF Slave Bus Error

ODTE/EDTE/CDTE

|Inbound<br>Transaction<br>type|DTE core action|SA action|Master action|
|---|---|---|---|
|write|DTE core check<br>wuser[3:0]，如果不是全<br>0，则产生SLVERR 的<br>response，并按照table 18<br>产生buser。<br>DTE check 地址，如果<br>access hole，则返回<br>DECERR，并按照table 18<br>产生buser。SLVERR 的优<br>先级高于DECERR|Check parity bit in wuser[3:0]，如果发<br>生parity 错误，可以根据配置发送<br>interrupt，并log<br>awaddr/awid/awuser，并改写<br>wuser[3:0]为全1.|Master generate parity<br>放到wuser[3:0]<br>Master 端SA 收到<br>Error Response 后发送<br>中断<br>Master 根据自身特性对<br>Error Response 做出响<br>应|
|read|DTE 在读reg buffer 的时候<br>check sram parity，如果发<br>生错误，则返回SLVERR，<br>按照table14 的描述，将对<br>应的ruser bit 至1<br>DTE 不check read address<br>decode error，如果读到了<br>hole，则返回全0.|Generate parity bit in ruser[3:0]|Master 端SA 做Parity<br>检查，若发现错误发送<br>中断<br>Master 端SA 根据配<br>置，传递Parity Code<br>或用Parity Check<br>Result 覆盖RUser<br>(RUser=0 表示Pass，<br>否则为Fail)<br>Master 端IP 收到返回<br>后，若发现Parity 错<br>误，根据自身特性做出<br>响应|

**Table 19. ODTE/EDTE/CDTE RAS as CF Slave**

##### 9.4.2.3. CF Master Bus Error

DTE 作为CF master 时，只会发出write transaction：

ODTE/EDTE/CDTE:

|Outbound<br>Transaction<br>type|DTE<br>core<br>action|SA action|Slave action|
|---|---|---|---|
|write|No extra<br>action|Generate parity bit in wuser[3:0]和error<br>injection<br>Check bresp 是否为error，如果是error，可<br>以根据配置发送interrupt，并log<br>bid/buser/bresp，不返回resp to DTE core|Slave 根据wuser 和wdata<br>check parity 出错，会返回<br>SLVERR；如果地址不对，会返回<br>DECERR|

**Table 20. ODTE/EDTE/CDTE as CF Master**

## 10. Design For X

### 10.1. Design For Test

#### 10.1.1. CRC

在DTE write port 上面加上CRC 的logic，通过CRC 来校验data path 上的logic 功能是否正常。DTE 中只有一个CRC 的模块，可以选择某一个write port 的数据作为计算数据的输入，并且可以在输入的数据流中只选择某个VC 的数据做CRC 的计算。

### 10.2. Design For Debug

#### 10.2.1. Debug Registers

DTE 会记录下面的硬件status 到register 中：

1. Status for each VC。包括当前VC 是否被占用，是否已经进入执行状态。对于CDTE，还包括对enable 了task split 的VC，有多少个split 的task 已经被执行。

2. Status for each thread/pipe。包括thread 里面的每个pipe 当前正在执行command 的 VC_ID，每级pipe context queue 的状态。

#### 10.2.2. Illegal Programming Detect

1. Per OP 的illegal programming。对于每个OP，其配置参数都有合法的取值范围，在 DTE_Programming_Guide 中会定义这些取值范围，其中有一些参数如果设错，会触发 HW interrupt，如下表所示：

|Illegal programming type|Ill_prog type value|description|
|---|---|---|
|unsupported_op|4'd1|Programming ODTE<br>/EDTE unsupported tiling<br>OP|
|total_size_err|4'd2|OP LNC/DS/DE/CF操作的<br>source total size被config<br>成0.|
|tile_src_size_err|4'd3|Tiling OP的source dim0~4<br>size有任意一个被config成<br>0|
|tile_dst_size_err|4'd4|Deslice相关的OP，<br>destination dim0~3 size有<br>任意一个被config 成0|
|tile_slc_size_err|4'd5|slice相关的OP，slice<br>dim0~3 size有任意一个被<br>config 成0|
|slc_no_src|4'd12|No data is sliced from<br>source tensor in slice OP|
|odte_decrypt error|4'd13|illegal VC_THD_MASK cfg<br>for decrypt|
|odte_decrypt error|4'd14|Illegal op for decrypt|

**Table 21. Illegal Programming Definition**

2. Programming Working VC。对于一个正在工作的VC，如果中途更改其配置，会导致不可预知的后果。HW 会detect 上述事件，并发出interrupt，同时记录发起这笔transaction 的master ID。

#### 10.2.3. Error Stop

当DTE 检测到任何error 情况时，可以通过寄存器的设定选择stop 整个DTE：

DTE 只将正在执行的command 完成，pending 在queue/VC 里面的command 都不再执行，也不发signal。整个DTE 把当前正在执行的command 执行完之后，就不再有新的动作，直到对DTE 进行reset。

### 10.3. Design For Manufacture

NA for DTE

### 10.4. Design For Profiling

#### 10.4.1. Command Trace Event

对每一个thread，DTE 会发送以下的event 到SA:

1. Command start event，表示一个 command 被 arbiter grant，表示一个command 将要开

始执行；

2. Command end event，表示一个 command 执行完开始发送 signal；

上面的每个event，都可以由register 控制是否要发给SA。并且每一个event 发送的时候，

也附带上对应command 的packet_id，process id，vc_id，master id 和context_id 送到

SA。

#### 10.4.2. Command Profiling Event

利用sa 里的pmc 统计每个port 读写端口的数据量。

#### 10.4.3. Customized Trace message

对每一个 thread，每执行一笔 cmd 会发送 Customized trace message 给 SA，message 为 434bit 。 Customized trace message 为 per command 的向 SA 发送，由 dpf_message_event_en 控制是否发送。
