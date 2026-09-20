> Imported material source: `Doc/HwSync Arch Spec.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `HwSync Arch Spec`.

# HwSync Arch Spec

## 1. Glossary

|**Glossary**|**Definitions**|
|---|---|
|HwSync|Hardware Synchronizer|
|GSYNC|Global Synchronizer|
|ECF|Enflame Control fabric|
|SA|System Adapter|
|VG|Virtual Resource Group|
|CTX_ID|Context ID, index for one dedicated Virtual Resource Group in DTU|
|XMC|Address Map/Hash Client for CF/DF address|

## 2. Overview

Libra同步原语通过HwSync(L1/L3)和Master Local Mailbox协同实现。

HwSync存在于两个层级，分别是instance在每个SIP内的L1 HwSync和centralized instance在GMU内的 L3 HwSync。其中，L1 HwSync可实现SIP内的线程同步；同时，对于某些场景，为减小通过L3 HwSync 同步的latency，也可通过L1 HwSync实现不同SIP之间的线程同步，例如物理位置较近的局部SIP之间进行同步。

HwSync的访问者可以是SIP/xDTE/SP/AP/HwSync/GSYNC等master。下图简要示例了L1 HwSync、L3 HwSync、LocalMailbox的连接关系，包括使用L1 HwSync进行多线程同步以及使用L3 HwSync进行多线程同步的方式。

![L1 HwSync, L3 HwSync and Local Mailbox connection overview](hwsync_arch_spec__hwsync_arch_spec_pdf_0003_06.png)

### 2.1. Feature list

#### Note: Event 为 P2 feature （要求： HW design in； DV 不 signoff）

- 支持不同层级的HwSync(L1/L3)

- 支持Mutex同步语义

- 支持NtoN的Barrier同步语义

- 支持1toN的Event同步语义( **P2** )

- 支持NtoM的Latch同步语义

- 支持1to1的深度为1的Queue同步语义

- 支持AtomicInc Count(Self-Inc Memory)

- 支持Barrier重用

- 支持Event重用( **P2** )

- 不支持Latch重用

- 支持Queue重用

- Barrier不支持动态追加consumer

- Event支持动态追加consumer( **P2** )

- Latch支持动态追加consumer

- 支持同步资源的静态分配方式

- 支持同步资源的动态分配方式

- 支持HwSync同步资源划分为静态或动态资源使用

- L3 HwSync支持2048个Mutex、256个CNT、1024个ENTRY、64个AtomicInc资源

- L1 HwSync支持256个Mutex、64个CNT、256个ENTRY、 ~~8个AtomicInc资源~~ 32个AtomicInc资源

- L3 HwSync支持虚拟化

- L3 HwSync支持VG独立的Software reset配置

- L3 HwSync支持VG内同步资源IDLE状态的记录(for virtualization)

- L1 HwSync记录全部资源的IDLE状态

- 支持一组AXI CF slave

- 支持一组AXI CF master

- 支持同一个notified master使用同一个AXI ID，AXI ID软件可编程，

- 支持AXI CF master的outstanding可编程

- 支持HwSync CNT资源Unique ID configuration and check（for debug）

- 不支持Mutex的lock和unlock thread check debug

- 不支持Barrier producer check debug（软件保证一个producer仅signal一次）

- HwSync发生异常时会上报中断，同时支持HwSync Hang住（寄存器可配置，for debug）

- 支持动态分配的资源可以使用绝对地址（静态方式）访问（for debug）

### 2.2. L1/L3 Differences

#### 1. 同步资源数量不同

|**Synchronization Resource**|**L3 HwSync**|**L1 HwSync**|
|---|---|---|
|MUTEX|2048|256|
|CNT|256|64|
|ENTRY|1024|256|
|AtomicInc|64|~~8~~<br> 32|

L1 HwSync不支持VG资源划分

## 3. Interface Spec

HwSync(L1/L3) interface包含一组AXI CF Slave接口和一组AXI CF Master接口，每组接口包含读、写通道。

### 3.1. AXI4 Interface

|**Interface Bundle**|**Address Width**|**Data Width**|**ID Width**|**Description**|
|---|---|---|---|---|
|cf_hwsync_axi|30|32|6|CF Slave interface|
|hwsync_cf_axi|30|32|6|CF Master interface|

### 3.2. Clock and Reset

|**Signal**|**Direction**|**Width**|**Description**|
|---|---|---|---|
|hwsync_clk|Input|1|HwSync clock signal|
|hwsync_rst_n|Input|1|HwSync reset signal|
|hwsync_idle|Output|1|HwSync IDLE status, for clock gating|

### 3.3. Others

|**Signal**|**Direction**|**Width**|**Description**|
|---|---|---|---|
|hwsync_axuser|Input|~~16~~<br> 20|HwSync AxUser signal.|

## 4. SOC Function Description

### 4.1. Clock

HwSync为single clock domain，L3HwSync与ECF同频，L1HwSync与SIP同频。

#### 4.1.1. Clock Switch Sequence

#### 4.1.2. Clock Gating

HwSync会输出用于clock gating的idle信号。BLCG/ELCG等控制都在GMU/SIP中完成。是否支持 BLCG/ELCG由UserIP自行决定。

HwSync内部无clock gating。

### 4.2. Reset

1. 支持BLR（不支持单独复位，是UserIP粒度的复位；BLR 实现在GMU/SIP）

2. 支持FLR：L3HwSync支持VG粒度的soft reset

#### 4.2.1. Reset Sequence

### 4.3. Power

### 4.4. Control Fabric

- (L1/L3)HwSync包含一组CF Master和一组CF Slave。

CF Slave无outstanding buffer；CF Master支持最大256 outstanding（寄存器可配置）。

### 4.5. Data Fabric

- (L1/L3)HwSync无DF。

### 4.6. Address Mapping

HwSync内部Address Mapping详见章节11 Register Spec

- **L1** HwSync Space Size： **6KB**

- **L3** HwSync Space Size： **32KB**

- 【Note】：访问HwSync的register hole时，HwSync不会返回RESP Error。

- Write：BRESP=0

- Read：RDATA=0，RRESP=0

### 4.7. Reliability, Availability, Serviceability Features

L3 HwSync RAS全部由GMU.SA handle。

L1 HwSync在SIP SCF0 path不做parity处理。

Note：L1 HwSync在用于SIP间同步时，RAS由SIP.SA handle。

#### 4.7.1. Bus Parity

##### 4.7.1.1. AXI Write from Internal to External

HwSync不会根据Write Data gen parity bit，WUSER tie 0

- HwSync不会检查返回的BUSER

- HwSync会检查返回的BRESP，有错误（非Okay，即BRESP[1]非0）则：

- 发送消息中断给PCIE/SP MIH

- Log错误response：BID/BRESP/BUSER

##### 4.7.1.2. AXI Read from Internal to External

NA

##### 4.7.1.3. AXI Write from External to Internal

HwSync不会根据Write Data gen parity bit and check

- HwSync会根据错误类型返回BRESP和BUSER到Master端

- 以上由AXI Regbridge完成处理：检查WUSER是否非0，非0则为parity error，则返回 BRESP=1

- BUSER=1

##### 4.7.1.4. AXI Read from External to Internal

根据HwSync返回的Read Data gen parity bit，RUSER tie 0

#### 4.7.2. SRAM Parity/ECC

NA

### 4.8. Security Features

### 4.9. Virtualization Features

L3 HwSync支持虚拟化。

1. 支持将HwSync内的Mutex/CNT/ENTRY同步资源划分给不同的VG，单Die最多支持划分给8个VG 每个VG划分的资源数目独立可配置；

- 不同类型(Mutex/CNT/ENTRY)的资源划分是独立的；

- VG和Context ID一一映射，映射关系在初始化配置。

2. HwSync会保存记录Master IP注册HwSync时所使用的Context ID 及ASID，并在发起notify时，在 AXI CF Master interface上携带相应的Context ID及ASID信息

3. HwSync内部的notify地址查找表中，表项内容（notify address）可以是逻辑地址，也可以是物理地址

如果是逻辑地址，XMC基于Context ID进行地址映射

如果是物理地址，无需XMC映射

4. 支持VG粒度的复位，即对HwSync内隶属于某个VG的同步资源进行重置

- 静态资源分配关系重置为无效态

- 以CTX_ID为单位对所有资源（静态和动态）进行重置

### 4.10. Interrupt Handling

HwSync中断全部为exception interrupt，主要目的是检测一些配置异常，方便软硬件debug。

所有中断通过HwSync的CF Master发出，支持中断同时发往SP和Host的MIH。

- 中断对应的CONTEXT、ASID和Master ID信息来源于接口信号HWSYNC_AXUSER

- 中断写数据来源于寄存器配置

- 中断写地址来源于寄存器配置（SP/HOST各自独立）

- 支持中断MASK，且SP/HOST各自独立控制。默认中断是打开的

### 4.11. HW Sync

### 4.12. Debugger

### 4.13. Profiler

## 5. IP Function Description

### 5.1. Overview

HwSync硬件实现架构如下图所示。

![HwSync hardware architecture overview](hwsync_arch_spec__hwsync_arch_spec_pdf_0008_19.png)

HwSync同步资源由若干个Mutex同步资源和若干个CNT+ENTRY同步资源组成。其中，Mutex资源用于实现互斥锁；CNT+ENTRY资源用于实现Barrier/Event/Latch/Queue同步原语。以上资源全部以共享资源池的形式进行管理和调度。支持资源的静态分配和动态分配。同时，HwSync提供若干个 AtomicInc(Self-inc Memory)资源，主要用于对称性检测。

HwSync内部包含一个160项深的LUT，用于存放master notify address和AXI ID，表项值是软件可编程的，初始化时配置。

被请求方为HwSync的同步原语的API触发的是通过AXI CF Slave接口对HwSync寄存器的访问；HwSync 对Master IP的通知通过AXI CF Master发出。

### 5.2. Synchronization

#### 5.2.1. Mutex

用于支持std::mutex 语义

Mutex（互斥锁）用于保护共享数据不被多个线程同时访问。互斥锁具有独占性和排他性。

1. 调用线程从它成功调用lock或try_lock开始，到它调用unlock结束，这期间线程一直占有mutex

2. 当一个线程占有mutex时，所有其它调用了lock的线程将会block在这个mutex上，或调用了 try_lock的线程将会收到一个false返回值

3. 只有拥有mutex所有权（加锁）的线程才能发起对该mutex的释放（解锁的线程必须是加锁的线程）

_Note_：考虑硬件开销，硬件不做 _check_

##### 5.2.1.1. 软件API

|**Function Definition**|**Parameters**|**Return**<br>**Value**|**Comment**|
|---|---|---|---|
|Mutex<br>alloc_mutex(uint32_t<br>level)|level：enum<br>ThreadScope，只支持<br>thread_scope_block和<br>thread_scope_thread|Mutex|分配一个mutex，如果动<br>态分配失败，当前thread<br>会不停的重试<br>typedef struct Mutex<br>{uint32_t mutex_id;}|
|void<br>free_mutex(Mutex*<br>mutex)|mutex：Mutex结构体指<br>针|void|释放指定的mutex，如果<br>传入的mutex指针无效，<br>则当前thread会继续执<br>行，而HwSync会hang住|
|void<br>lock_mutex(Mutex*<br>mutex)|mutex：Mutex结构体指<br>针|void|锁定指定的mutex，如果<br>没有竞争到锁，则一直等<br>待如果传入的mutex指针<br>无效，则当前thread会<br>hang住|
|bool try_lock(Mutex*<br>mutex)|mutex：Mutex结构体指<br>针|是否锁<br>住<br>mutex|尝试锁定指定的mutex，<br>如果锁住则返回true，否<br>则返回false；如果传入<br>的mutex指针无效，则当<br>前thread会hang住|
|void<br>unlock_mutex(Mutex*<br>mutex)|mutex：Mutex结构体指<br>针|void|释放之前锁定的mutex，<br>如果传入的mutex指针无<br>效，则当前thread会继续<br>执行，而HwSync会hang<br>住；如果解锁的thread不<br>是加锁的thread，虽然是<br>错误，但并不会检测出<br>来，需要使用者小心使用|

##### 5.2.1.2. 硬件API

|硬件设计API|发起方|被请求方|语义|
|---|---|---|---|
|id = alloc_mutex(level)|Allocator|HwSync|向Mutex资源管理器申请一把锁，返回值是这把锁的ID；如果返回值为0xbadbeef，表示未申请到资源。|
|dealloc_mutex(level, id)|Allocator|HwSync|向锁资源管理器释放一把锁，输入参数是这把锁的ID。|
|id = try_lock_mutex(level, id)|User|HwSync|针对一个id尝试加锁；返回0表示加锁成功，返回1表示加锁失败。对于未分配的锁，不能lock成功。|
|unlock_mutex(level, id)|User|HwSync|针对一个mutex id进行解锁。|

##### 5.2.1.3. Hardware Implement

HwSync硬件底层提供try_lock_mutex功能，lock_mutex需要由软件借用try_lock_mutex进行封装。

Mutex资源占用一段连续的CF地址空间。每个Mutex资源对应一个CF地址偏移，可通过offset区分不同的Mutex资源。

- try_lock_mutex通过CF读操作下发，返回值由rdata承载，0表示加锁成功，1表示加锁失败。 unlock_mutex通过CF写操作下发。

每个mutex资源会维护1bit的锁状态信息。try_lock时，mutex锁状态会置1，表示处于加锁状态； unlock时，锁状态清0，表示处于free状态。

#### 5.2.2. Barrier

用于支持std::barrier语义

Barrier使期待数量的线程阻塞在同步点，直至期待数量的线程全部到达该屏障。

1. Barrier支持N-to-N的同步；

2. Barrier Signal和Notify的对象都是线程自身；

3. Barrier需要区分是哪个thread Signal的，由软件负责保证一个thread仅Signal一次，硬件不做区分，只需计总数；

4. Barrier的目标使用者总数在一开始就知道，不支持动态追加consumer；

5. Barrier支持硬件重用，一旦屏障阻塞解除，即可重用同一屏障；

6. Barrier支持线程提前退出（barrier_arrive_and_drop）；

##### 5.2.2.1. 软件API

|**Function Definition**|**Parameters**|**Return**<br>**Value**|**Comment**|
|---|---|---|---|
|void alloc_barrier(Barrier*<br>barrier, uint32_t level)|barrier：Barrier结构体<br>指针level：enum<br>ThreadScope，只支持<br>thread_scope_block和<br>thread_scope_thread|Barrier|分配一个barrier，如果动态分配失败，当前<br>thread会不停的重试<br>struct Barrier { uint32_t barrier_id;<br>uint32_t wait_mbx_id; bool arrived;}|
|void free_barrier(Barrier*<br>barrier)|barrier：Barrier结构体<br>指针|void|释放指定的barrier。如果传入的barrier指针无<br>效，则当前thread会继续执行，而HwSync<br>会hang住|
|void init_barrier(Barrier* barrier,<br>uint32_t count)|barrier：Barrier结构体<br>指针count：预期数量|void|初始化barrier的预期数量，该数量一般等于<br>使用该barrier的thread数量；如果传入的<br>barrier指针无效，则当前thread会继续执<br>行，而HwSync会hang住；如果传入的<br>count数量大于255，则Debug模式下会产生<br>assert，Release模式下HwSync会hang住|
|ArrivalToken<br>arrive_barrier(Barrier* barrier)|barrier：Barrier结构体<br>指针|ArrivalToken|到达指定的barrier处，获得一个arrival<br>token，该token在后续wait的时候使用；如<br>果传入的barrier指针无效，则当前thread会<br>继续执行，而HwSync会hang住<br>struct ArrivalToken { uint32_t<br>wait_mbx_id;}|
|void wait_barrier(ArrivalToken*<br>token)|token：ArrivalToken指<br>针|void|等待指定的arrival token，如果barrier<br>count没有达到，则当前thread会一直等<br>待；如果传入的arrival token无效，则当前<br>thread会hang住|
|void<br>arrive_and_wait_barrier(Barrier*<br>barrier)|barrier：Barrier结构体<br>指针|void|到达指定的barrier，并立刻开始等待其他<br>thread也到达；如果传入的barrier指针无<br>效，则当前thread会继续执行，而HwSync<br>会hang住；本接口等价于<br>wait_barrier(arrive_barrier(barrier_id));|
|void<br>arrive_and_drop_barrier(Barrier*<br>barrier)|barrier：Barrier结构体<br>指针|void|到达指定的barrier，并继续执行，不会等<br>待；且会将之前初始化时候设置的count减<br>一，当前thread不再会使用该barrier；该函<br>数一般用于某个thread因为余数原因提早退<br>出最后一次循环；如果传入的barrier指针无<br>效，则当前thread会继续执行，而HwSync<br>会hang住|

##### 5.2.2.2. 硬件API

|操作|发起方|被请求方|描述|
|---|---|---|---|
|barrier_id=alloc_barrier(level)|Allocator|HwSync|向Barrier资源管理器申请一个barrier资源。|
|dealloc_barrier(level, id)|Allocator|HwSync|向Barrier资源管理器释放一个barrier资源，输入参数是barrier的ID。|
|set_barrier_count(level, barrier_id, count, uniq_id)|Allocator/User|HwSync|对已经申请好的barrier资源注册需要counter的arrival数量。注册counter非0后不可再次注册；当实际counter>=注册counter且注册counter!=0时，认为达到barrier条件。|
|notify_id=alloc_barrier_mailbox()|User|本地 mailbox 管理者|等待唤醒事件的thread在发送wait前申请本地barrier_mailbox。|
|register_barrier_wait(level, barrier_id, uniq_id, notify_id)|User|HwSync|将本地通知的Mailbox ID注册到HwSync Entry资源中，以便未来获得通知。|
|arrive_barrier(level, barrier_id, uniq_id)|User|HwSync|线程通知barrier资源管理者自己到达当前barrier位置。|
|arrive_and_drop_barrier(level, barrier_id, uniq_id)|User|HwSync|线程通知barrier资源管理者自己到达当前barrier位置，并退出当前barrier；同时将初始化时设置的count减一。|
|wait_barrier(notify_id, barrier_id)|User|本地 mailbox|当前线程等待所有相关线程到达当前barrier位置。|
|unregister_barrier_wait(level, barrier_id, uniq_id)|User|HwSync|解注册，释放对应entry资源。调用unregister时，表明线程已经获得通知。|
|notify_barrier_waiter(barrier_id, notify_id)|HwSync|User|barrier管理者通知等待该barrier的线程。Barrier资源可被重用，但N-to-N数值不变，并且master源应保持不变。|

##### Workflow

1. 申请一个barrier资源（alloc_barrier）

2. 初始化barrier（init_barrier）

3. thread申请一个本地mailbox（alloc_mailbox）

4. thread注册mailbox id到HwSync ENTRY（register）

5. thread arrival（arrive_barrier）

6. thread wait mailbox（wait_barrier）

7. thread解注册（注销）HwSync ENTRY（unregister）

8. 释放barrier资源（dealloc_barrier）

Note: barrier在循环中使用时（属于重用场景），那么此时映射到硬件行为是step4~step7循环配置。

##### 5.2.2.3. Hardware Implement

1. HwSync硬件底层提供分离的arrive_barrier()、wait_barrier()同步接口，arrive_and_wait_barrier() 同步接口由软件借用arrive_barrier()、wait_barrier()进行封装。

2. 软件API中的arrive_barrier()映射硬件API register_barrier_wait() + arrive_barrier()，对应硬件的注册entry和signal cnt行为，由两笔写操作配置。

3. 软件API中的arrive_barrier()有ArrivalToken返回值，用于保证wait和arrival匹配，由软件进行处理，硬件不感知，即配置arrive_barrier时，硬件无返回值。

4. 软件API中的arrive_and_drop_barrier()映射硬件API arrive_and_drop_barrier()，即仅对应硬件的 signal cnt行为。

硬件采用1个CNT和N个ENTRY实现Barrier语义。

每个线程到达同步点后，barrier CNT计数自加1，当所有线程到达同步点，即CNT计数达到阈值时， barrier CNT会trigger与之关联的ENTRY发出notify请求，同时barrier CNT清0。

arrive_and_drop：每一次arrive_and_drop使CNT计数加1；同时使next_phase_threshold减1，硬件维护next_phase_threshold，并且在trigger时update threshold，做为下一次同步的期待线程数量，当前同步phase阈值不变。

重用：Barrier重用时，需要重新注册entry。硬件在CNT trigger时自清ENTRY vld，但ENTRY资源释放由 unregister触发。（考虑到arrive_and_drop的thread可能在next phase被触发notify，所以硬件会自清 ENTRY vld）

![Barrier CNT and ENTRY implementation](hwsync_arch_spec__hwsync_arch_spec_pdf_0015_10.png)

#### 5.2.3. Latch

用于支持std::latch 语义。

Latch是一次性的barrier。Latch同步条件满足后将一直保持trigger有效，直至资源释放。

1. Latch支持NtoM的同步；

2. Latch不需要区分是哪个thread Signal贡献的Counter，只需计总数；

3. Latch不支持硬件重用，使用完待释放后Latch无效；

4. 支持try_wait模式（使用者主动Polling的方式查看Latch同步条件是否满足）；

5. Latch有历史信息，有Counter。所以后续动态添加的消费者也依然可以看到；

6. Latch支持动态追加consumer。即便Latch已经处于trigger状态，仍然可以调用 register_latch_wait来注册latch wait，新注册wait的thread会立刻获得通知；

7. latch和barrier区别

- barrier可以重用，可以用于多轮N-to-N的同步过程；latch不可以重用，使用完释放后latch无效

barrier arrive和wait的对象都是自身；latch可以不同

latch一次arrival可以贡献多个计数

##### 5.2.3.1. 软件API

|**Function Definition**|**Parameters**|**Return**<br>**Value**|**Comment**|
|---|---|---|---|
|void alloc_latch(Latch* latch,<br>uint32_t level)|latch：Latch结构体指针<br>level：enum<br>ThreadScope，只支持<br>thread_scope_block和<br>thread_scope_thread|Latch结<br>构体|分配一个latch，如<br>果动态分配失败，<br>当前thread会不停<br>的重试,|
|void free_latch(Latch* latch)|latch：Latch结构体指针|void|释放指定的latch；<br>如果传入的latch指<br>针无效，则当前<br>thread会继续执<br>行，而HwSync会<br>hang住|
|void init_latch(Latch* latch,<br>uint32_t count)|latch：Latch结构体指针<br>count：计数器初始数值|void|初始化latch的数<br>值，该数量一般等<br>于使用该latch的<br>thread数量；如果<br>传入的latch指针无<br>效，则当前thread<br>会继续执行，而<br>HwSync会hang<br>住；如果传入的<br>count数量大于<br>XXX，则Debug模<br>式下会产生<br>assert，Release模<br>式下HwSync会<br>hang住|
|void<br>count_down_latch(Latch*<br>latch, uint32_t count)|latch：Latch结构体指针<br>count：计数器减少的数<br>值|void|latch内部的计数器<br>减少指定数值<br>count；如果减去指<br>定的count之后内部<br>计数器小于0，则<br>HwSync会hang<br>住；如果传入的<br>latch指针无效，则<br>当前thread会继续<br>执行，而HwSync<br>会hang住|
|bool try_wait_latch(Latch*<br>latch)|latch：Latch结构体指针|是否等<br>待到<br>Latch|尝试等待指定的<br>latch的内部计数器<br>等于0，如果计数器<br>等于零，则返回<br>true，否则立刻返<br>回false；如果传入<br>的latch指针无效，<br>则当前thread会继<br>续执行，而<br>HwSync会hang住|
|void wait_latch(Latch* latch)|latch：Latch结构体指针|void|等待指定的latch的<br>内部计数器等于0，<br>如果计数器大于<br>零，则会一直等待<br>下去；如果传入的<br>latch指针无效，则<br>当前thread会继续<br>执行，而HwSync<br>会hang住|
|void<br>arrive_and_wait_latch(Latch*<br>latch, uint32_t count)|latch：Latch结构体指针<br>count：计数器减少的数<br>值|void|latch的内部计数器<br>减少指定数值<br>count，并一直等待<br>到计数器被减少到<br>0；如果减去指定的<br>count之后内部计数<br>器小于0，则<br>HwSync会hang<br>住；如果传入的<br>latch指针无效，则<br>当前thread会继续<br>执行，而HwSync<br>会hang住|

##### 5.2.3.2. 硬件API

|操作|发起方|被请求方|描述|
|---|---|---|---|
|latch_id=alloc_latch(level)|Allocator|HwSync|向Latch资源管理器申请一个latch资源。|
|dealloc_latch(level, latch_id)|Allocator|HwSync|向Latch资源管理器释放一个latch资源，输入参数是latch的id。|
|set_latch_count(level, latch_id, count, uniq_id)|Allocator/User|HwSync|对已经申请好的latch资源注册需要counter的arrival数量。|
|notify_id=alloc_latch_mailbox()|User|本地 mailbox 管理者|等待唤醒事件的thread在发送wait之前申请一个被通知的latch_mailbox。|
|register_latch_wait(level, latch_id, uniq_id, notify_id)|User|HwSync|将本地通知的Mailbox ID注册到HwSync Entry资源中，以便未来获得通知。|
|arrive_latch(level, latch_id, count, uniq_id)|User|HwSync|线程通知Latch资源管理者自己到达当前Latch位置。|
|wait_latch(notify_id, latch_id)|User|本地 mailbox|当前线程等待所有相关线程到达当前latch位置。|
|unregister_latch_wait(level, latch_id, uniq_id)|User|HwSync|解注册，释放对应entry资源。调用unregister时，表明线程已经获得通知。|
|notify_latch_waiter(latch_id, notify_id)|HwSync|User|Latch管理者通知等待该latch的线程。|
|try_wait_latch(level, latch_id)|User|HW-<br>Sync|查询指定的latch的内部计<br>数结果。|

##### Workflow

1. 申请一个latch资源（alloc_latch）

2. 初始化latch（init_latch）

3. thread申请一个本地mailbox（alloc_mailbox）

4. thread注册mailbox id到HwSync ENTRY（register）

5. thread arrival（arrive_latch）

6. thread wait mailbox（wait_latch）

7. thread解注册（注销）HwSync ENTRY（unregister）

8. 释放latch资源（dealloc_latch）

##### 5.2.3.3. Hardware Implement

HwSync硬件底层提供分离的count_down_latch()、wait_latch()同步接口，arrive_and_wait_latch()同步接口由软件借用count_down_latch()、wait_latch()进行封装。

Latch采用1个CNT和N个ENTRY实现。

一个线程到达latch后，会signal一次CNT，使计数器+N，当计数达到阈值时，latch将一直处于trigger状态，直至释放这个latch。latch CNT会trigger与之关联的ENTRY发出notify请求。

![Latch CNT and ENTRY implementation](hwsync_arch_spec__hwsync_arch_spec_pdf_0019_14.png)

##### try_wait_latch

try_wait_latch()对应软件Polling CNTx寄存器行为。

软件直接通过alloc_id读取对应地址offset的CNT获取latch_counter的value（alloc_id与cnt_res_id是一一对应的关系）。

_Note: arrive_latch_ （_count_down_latch_）为 _CNT+_ 行为，判断 _latch_release_ 的条件是 _latch_counter_value=latch_counter_threshold_。

#### 5.2.4. Queue

Queue是典型的生产者-消费者模型。软件利用Queue语义+Local Mailbox构造Pipeline同步语义。

1. Queue起到FIFO 同步作用，先进先出，先写的Buffer先读；

2. Queue没有buffer的概念，它只表示了数据依赖关系；

3. 允许多Producer与多Consumer直接的Queue同步，即多个生产者写一块数据到一个Buffer，多个消费者再都去各自消费数据块;

4. Producer和Consumer通过local的mailbox + central的queue 来实现关联关系。Queue隔离的了生产者和消费者，可以支持更好的动态资源使用方式；

5. 每次循环中，生产动作的数目和消费动作的数目可能是完全动态的，并且一开始并不能确定有多少生产动作或消费动作，只有在commit/release时才能知道这个数量；

6. Producer端和Consumer端信息不能一开始就确定，需要注册，且两边信息的确立有可能会有时间差。这是和过去的mailbox的设计的区别；

7. 每个Pipeline可以有多个stage， 每个stage对应一个Queue。

##### 5.2.4.1. 软件API

软件利用Queue语义+Local Mailbox构造Pipeline同步语义。以下是Pipeline API。

|**Function Definition**|**Parameters**|**Return**<br>**Value**|**Comment**|
|---|---|---|---|
|void alloc_pipeline(Pipeline* pipe,<br>uint32_t level, uint32_t stage_count)|pipe：Pipeline指针<br>level：enum<br>ThreadScope，只支持<br>thread_scope_block和<br>thread_scope_thread|Pipeline<br>结构体|分配一个<br>pipeline，如<br>果动态分配<br>失败，当前<br>thread会不<br>停的重试|
|void free_pipeline(Pipeline* pipe)|pipe：Pipeline指针|void|释放指定的<br>pipeline如果<br>传入的pipe<br>指针无效，<br>则当前<br>thread会继<br>续执行，而<br>HwSync会<br>hang住|
|void<br>pipeline_producer_acquire(Pipeline*<br>pipe)|pipe：Pipeline指针|void|阻塞当前<br>Thread，直<br>到指定的<br>pipeline的空<br>闲了一块<br>buffer|
|void<br>pipeline_producer_commit(Pipeline*<br>pipe)|pipe：Pipeline指针|void|指定的<br>pipeline的生<br>产者完成生<br>产|
|void<br>pipeline_consumer_wait(Pipeline*<br>pipe)|pipe：Pipeline指针|void|阻塞当前<br>Thread，直<br>到指定的<br>pipeline上生<br>产了一个可<br>用的数据|
|void<br>pipeline_consumer_release(Pipeline*<br>pipe)|pipe：Pipeline指针|void|指定的<br>pipeline的消<br>费者完成了<br>消费|

##### 5.2.4.2. 硬件API

|操作|发起方|被请求方|描述|
|---|---|---|---|
|queue_id=alloc_queue(level)|Allocator|HwSync|类似mutex资源管理的方式，做资源申请。|
|dealloc_queue(level, queue_producer_id)|Allocator|HwSync|类似mutex资源管理的方式，做资源释放。|
|notify_id=alloc_queue_mailbox()|生产者thread / 消费者thread|本地 mailbox 管理者|生产者和消费者分别向本地资源管理模块申请被通知的 mailbox。|
|set_queue_producer_count(level, queue_producer_id, count, uniq_id)|Allocator/User|HwSync|设置生产动作数量。|
|set_queue_consumer_count(level, queue_consumer_id, count, uniq_id)|Allocator/User|HwSync|设置消费动作数量。|
|register_queue_producer(level, queue_consumer_id, uniq_id, notify_info)|生产者thread|HwSync|生产者将本地 mailbox 注册到 queue 资源，使 queue 在有消费者信息更新时通知生产者。|
|register_queue_consumer(level, queue_producer_id, uniq_id, notify_info)|消费者thread|HwSync|消费者将本地 mailbox 注册到 queue 资源，使 queue 在有生产者信息更新时通知消费者。|
|advance_write_local(level, notify_id)|生产者thread|本地 mailbox|生产者告知本地 mailbox 已生成一块数据。|
|advance_write_far(level, queue_producer_id, uniq_id)|生产者thread|HwSync|生产者告知 queue 管理模块已生成一块数据。|
|advance_read_local(level, notify_id)|消费者thread|本地 mailbox|消费者告知本地 mailbox 已消费一块数据。|
|advance_read_far(level, queue_consumer_id, uniq_id)|消费者thread|HwSync|消费者告知 queue 管理模块已消费一块数据。|
|unregister_queue_producer(level, queue_consumer_id, uniq_id)|生产者thread|HwSync|解注册，释放对应entry资源。|
|unregister_queue_consumer(level, queue_producer_id, uniq_id)|消费者thread|HwSync|解注册，释放对应entry资源。|
|notify_queue_producer(notify_id)|HwSync|生产者thread|queue管理者通知生产者：消费者已经消费了一个数据。|
|notify_queue_consumer(notify_id)|HwSync|消费者thread|queue管理者通知消费者：生产者已经生产了一个数据。|
|get_read_buffer(notify_id)|消费者thread|本地 mailbox|消费者等待本地mailbox新的数据就绪。|
|get_write_buffer(notify_id)|生产者thread|本地 mailbox|生产者等待本地mailbox新的buffer空位就绪。|

##### Workflow

1. 申请一个queue资源（alloc_queue）

2. 生产者/消费者各在本地申请一个mailbox（alloc_mailbox）

3. 初始化queue CNT threshold为0，for uniq id configuration（只有在loop0时需要此步骤，这一步骤是为了uniq_id的初始化配置）

4. 生产者/消费者注册mailbox id到HwSync ENTRY（register）

5. 生产者等待空buffer，wait mailbox（get_write_buffer），wait成功后，clear mailbox （advance_write_local）

6. 生产者完成生产后通知HwSync（advance_write_far）

7. 所有生产数量确定后，初始化queue producer CNT（set_queue_producer_count）

8. 消费者等待数据就绪，wait mailbox（get_read_buffer），wait成功后，clear mailbox （advance_read_local）

9. 消费者完成消费后通知HwSync（advance_read_far）

10. 消费数量确定后，初始化queue consumer CNT（set_queue_consumer_count）

11. 生产者/消费者解注册HwSync ENTRY（unregister）

12. 释放queue资源（dealloc_queue）

##### Note：

1. 如果Queue在循环内，并且每次循环内的生产/消费动作数量不同，那么此时映射到硬件行为是 step4~step11循环配置。

2. step4~step11只是示意说明所需流程，这里并不表示它们之间是严格的顺序执行关系。例如，生产和消费的注册行为并不依赖对端的signal（advance_xxx_far）是否完成；生产和消费的signal （advance_xxx_far）不依赖set_queue_xxx_count是否完成。

##### 5.2.4.3. Hardware Implement

Queue由两组CNT+ENTRY的组合实现，分别对应生产端和消费端，两端完全独立。

- 生产端(1Cnt + N Entry)：CNT(P)，统计生产动作的完成；ENTRY(C)，通知消费者（mbx）允许消费

- 消费端(1Cnt + M Entry)：CNT(C)：统计消费动作的完成；ENTRY(P)，通知生产者（mbx）允许生产

- CNT(P)和CNT(C)的阈值可能是不同的；并且在不同循环次数中支持改配

![Queue CNT and ENTRY implementation](hwsync_arch_spec__hwsync_arch_spec_pdf_0023_19.png)

**Pipeline硬件实现**

pipeline一个stage对应深度为1的queue，映射到硬件是1个HwSync queue资源和(N+M)个Local Mailbox。

pipeline的每个stage都有各自的mailbox。并且必须是按照stage的顺序wait对应的mailbox（先进先出）。

local mailbox：mailbox reference value表征stage的深度

- 生产者mailbox初始态为"empty"状态

- Note：生产者一开始就有空buffer可以生产，但初始条件下空buffer不能直接从mailbox获取，而是需要先注册HwSync entry，等待HwSync signal mailbox，mailbox trigger后才能获取到空buffer

- 消费者mailbox初始态为”empty“状态，即一开始是没有数据可以消费的

- wait mailbox（即producer_acquire/consumer_wait）成功后，要clear mailbox（对应 advance_write_local/advance_read_local）

_Note:_ 一个 _stage_ 的深度（_mbx_ref_）只能为 _1_。因为生产可能是异步的，所以当第一次（_ping_）的生产操作配置完成之后，就可以进行第二次（_pong_）的生产操作配置；可能 _pong_ 的生产完成较快， _Queue_ 会通知消费者进行消费，此时消费者 _ping_ 可能消费的是 _pong_ 的数据，违背了 _pipeline_ 的 _fifo_ 处理原则

![Queue sample diagram part 1](hwsync_arch_spec__hwsync_arch_spec_pdf_0024_09.png)

**Sample** : DMA & Compute PingPong Pipeline in Single Thread

![Queue sample diagram part 2](hwsync_arch_spec__hwsync_arch_spec_pdf_0024_11.png)

![Queue sample timeline continuation](hwsync_arch_spec__hwsync_arch_spec_pdf_0025_00.png)

#### 5.2.5. AtomicInc

AtomicInc(Self-Incr memory) 是一种支持共享变量计算操作的存储。主要用于alloc/free、 register/unregister等对称性检测（debug）。

1. 该存储在分配的时候，初始值是0

2. 后续每次被user写一次，它就加1

3. 它的当前值可以被读。

**例：以多对多的生产者消费者模型为例**

那么需要给每个生产者和消费者各申请一个AtomicInc Count，分别用于生产和消费次数的计数。如果出现异常时，HwSync会Hang住，那么可能存在生产者和消费者对应的AtomicInc Count计数结果不同，这样可以通过AtomicInc Count辅助debug是由谁导致Hang住的。

##### 5.2.5.1. 软件API

|**Function Definition**|**Parameters**|**Return**<br>**Value**|**Comment**|
|---|---|---|---|
|void<br>atomic_alloc_u32(AtomicUInt32*<br>au32, uint32_t level)|au32：AtomicUInt32<br>结构体指针level：<br>enum ThreadScope，<br>只支持<br>thread_scope_block和<br>thread_scope_thread|void|分配一个<br>AtomicUInt32|
|void<br>atomic_free_u32(AtomicUInt32*<br>au32)|au32：AtomicUInt32<br>结构体指针|void|释放指定的<br>AtomicUInt32；如<br>果传入的<br>AtomicUInt32指针<br>无效，则在debug<br>版下会检测并<br>assert异常值，<br>release版本下无任<br>何动作|
|uint32_t<br>atomic_read_u32(AtomicUInt32*<br>au32)|au32：AtomicUInt32<br>结构体指针|uint32<br>value|读取指定的<br>AtomicUInt32值，<br>返回读取到的<br>uint32值；如果传<br>入的AtomicUInt32<br>指针无效，则在<br>debug版下会检测<br>并assert异常值，<br>release版本下无任<br>何动作|
|void<br>atomic_inc_u32(AtomicUInt32*<br>au32)|au32：AtomicUInt32<br>结构体指针|void|指定的<br>AtomicUInt32变量<br>自增一；如果传入<br>的AtomicUInt32指<br>针无效，则在<br>debug版下会检测<br>并assert异常值，<br>release版本下无任<br>何动作|

##### 5.2.5.2. 硬件API

|**操作**|**发起方**|**被请求方**|**描述**|
|---|---|---|---|
|val = read_self_incr_mem(level,id);|User|HW-Sync|读取当前值|
|inc_self_incr_mem(level, id);|User|HW-Sync|当前值加1|

##### 5.2.5.3. Hardware Implement

AtomicInc资源不参与VG划分；不支持动态分配。

每个AtomicInc Count资源各对应一个配置地址。

每次写访问AtomicInc Count，计数器自增1；读访问时返回当前计数值。

每个AtomicInc Count提供clear配置寄存器。

#### 5.2.6. Event(P2)

_Event_ 用于 _Condition Variable_ 的封装。目前暂无明确的使用场景，暂不在软件开发计划中。

线程可以等待在event上，直到有其他线程signal那个event。

Event支持1-to-N的同步；

- Event支持动态追加Consumer；

- Event无历史信息，没有Counter；

- 先wait后signal属于可以正常进行的工作模式；

- 先signal后wait会出现等不到的情形，会miss掉这一次的signal，下一次signal到来时仍然会触发这次Event；（如果等不到 _Signal_ 会发生死锁，软件使用时需要保证）

- Event的signal和register_event_wait操作前需要使用mutex防止发生Event重用时的竞争。

- _Note_： _Event_ 在事件重叠时有丢失风险，软件保证不出现连续 _Event signal_ （可用 _Mutex_ 来保证）；当前回合未完成之前，不会再来新的 _signal_，但是允许下一回合的 _register_event_wait_ 提前到来

##### 5.2.6.1. 软件API

Condition Variable。

##### 5.2.6.2. 硬件API

|操作|发起方|被请求方|描述|
|---|---|---|---|
|event_id = alloc_event(level)|Allocator|HwSync|向Event资源管理器申请一个event资源。|
|dealloc_event(level, id)|Allocator|HwSync|向Event资源管理器释放一个event资源，输入参数是event的ID。|
|init_event(level, event_id, uniq_id)|Allocator|HwSync|对已经申请好的event资源配置uniq id。|
|notify_id=alloc_event_mailbox()|User|本地 mailbox 管理者|等待唤醒事件的thread在发送wait之前申请一个被通知的event_mailbox。|
|register_event_wait(event_id, uniq_id, notify_id)|User|HwSync|将本地通知的Mailbox ID注册到HwSync Entry资源中，以便未来获得通知。|
|wait_event(notify_id, event_id)|User|本地 mailbox|thread在master内部等待一个event被signal。|
|signal_event(event_id, uniq_id)|User|HwSync|thread signal一个event。|
|unregister_event_wait(level, event_id, uniq_id)|User|HwSync|解注册，释放对应entry资源。调用unregister时，表明线程已经获得通知。|
|notify_event_waiter(event_id, notify_id)|HwSync|User|event管理者通知等待该event的线程。|

##### Workflow

1. 申请一个event资源（alloc_event）

2. thread申请一个本地mailbox（alloc_mailbox）

3. thread注册mailbox id到HwSync ENTRY（register）

4. thread signal（signal_event）

5. thread wait mailbox（wait_event）

6. thread解注册（注销）HwSync ENTRY（unregister）

7. 释放event资源（dealloc_event）

##### 5.2.6.3. Hardware Implement

Event采用1个CNT和N个ENTRY实现。

一个线程Signal一次event后，event CNT将会产生一次trigger脉冲，trigger脉冲会自清CNT，同时event CNT会trigger与之关联的ENTRY发出notify请求。

重用：Event重用时，需要重新注册entry。硬件在CNT trigger时自清ENTRY vld，但ENTRY资源释放由 unregister触发。

![Event CNT and ENTRY implementation](hwsync_arch_spec__hwsync_arch_spec_pdf_0028_13.png)

### 5.3. Resource Schedule

VG初始化时，每个VG划分得到一定数量的资源，同时每个VG内会将这部分资源进一步划分为静态资源和动态资源。其中，静态资源由软件负责管理分配，动态资源由硬件负责管理分配。

HwSync同步资源中，Mutex、CNT、ENTRY资源会按照VG划分；同时Mutex和CNT资源会划分静态和动态，所以，软件需要管理的是每个VG内的静态Mutex资源和静态CNT资源。ENTRY资源全部由硬件动态分配，软件无法向指定ENTRY注册数据。

VG初始化做为HwSync的初始化操作由SP完成配置。每个VG都有独立的资源(Mutex/CNT/ENTRY)总数和静态资源数量配置接口。

_Note:_ 正常情况下， _VG_ 初始化完成后，不应动态重置 _VG/Sta&Dyn_ 资源数量。

#### 5.3.1. Resource Allocation Principles

静态和动态资源分配的统一原则：对于所有VG，分配的 **同步资源ID** 都是 **全局** 的。

动态资源分配时，硬件在VG对应资源区间内进行分配，保证alloc_id是全局的。

静态资源分配时，软件也需要在VG对应资源区间内进行分配。每个VG的资源区间计算方式如下：

![VG resource range formula](hwsync_arch_spec__hwsync_arch_spec_pdf_0029_04.png)

#### 5.3.2. Static Resource Allocation

静态资源分配做为HwSync的初始化操作由SP完成配置。

##### 5.3.2.1. Mutex Static Allocation

Mutex静态资源分配在VG初始化时完成，无需其它配置。

Mutex资源占用一段连续的地址空间，每个mutex锁资源对应一个配置地址。mutex_id和 mutex_resource_id是一一对应的。

下图举例示意了不同VG的Mutex资源划分。

（假设有128个mutex资源，共2个VG，每个VG各划分64个资源；VG0内划分16个资源做为static，余下的48个做为dynamic；VG1内划分56个资源做为static，余下的8个做为dynamic）

_Note_：静态资源总是从 _VG_ 内序号最小的资源开始划分，且是一段连续的资源

![Mutex static allocation by VG](hwsync_arch_spec__hwsync_arch_spec_pdf_0030_00.png)

##### 5.3.2.2. CNT Static Allocation

静态编译阶段软件会对CNT资源进行静态分配（分配CNT用于哪种同步类型）。

CNT资源占用一段连续的地址空间，每个CNT资源对应一个配置地址。

**CNT资源分配** （静态和动态）的 **原则**：

alloc_id与CNT资源序号（cnt_res_id）一一对应

不同VG划分的资源范围（序号）是相对于全局资源的

以上保证了在所有VG中，每一个同步语义所分配的id是独一的。

下图举例示意了不同VG内的静态资源分配方式。

（假设有128个CNT资源，共2个VG，每个VG各划分64个资源；VG0内划分16个资源做为static，余下的 48个做为dynamic；VG1内划分16个资源做为static，但仅使用了10个资源）

_Note_：静态资源总是从 _VG_ 内序号最小的资源开始划分，且是一段连续的资源

![CNT static allocation by VG](hwsync_arch_spec__hwsync_arch_spec_pdf_0031_00.png)

_**Note: queue**_ **语义的生产者和消费者各分配一个** _**ID**_ **，要求** _**queue producer id**_ **和** _**queue consumer id**_ **数值连续，且** _**producer id**_ **在前**

#### 5.3.3. Dynamic Resource Allocation

硬件需要管理和分配MUTEX、CNT资源、ENTRY资源。

其中MUTEX、CNT资源由软硬件共同管理和分配，软件负责管理静态资源，硬件负责管理动态资源； ENTRY资源不区分静态和动态，全部由硬件管理和动态分配。

硬件资源调度器实现的功能包括：

- VG间的资源隔离

- VG内静态资源和动态资源的隔离

- 资源动态调度

不同VG的资源申请和释放通过CTX_ID区分，每个VG映射唯一的CTX_ID。CTX_ID来源于 AxUser(bit[15:12])。

以上三种资源调度全部通过动态循环队列的方式实现，并且各自独立，没有依赖。

- 资源申请成功时，返回分配的资源ID；资源申请失败时（资源不够），返回0xbadbeef；

- 支持per cycle最多申请两个资源；

- 支持per cycle最多释放两个资源；

![Dynamic resource allocation flow](hwsync_arch_spec__hwsync_arch_spec_pdf_0032_00.png)

#### 资源申请和释放的配置方式如下：

|**Type**|**Alloc/Free Max**<br>**Num**|**Alloc**|**Back**<br>**Pressure**|**Free**|**Back**<br>**Pressure**|
|---|---|---|---|---|---|
|Mutex|1/1|read<br>access|N|write<br>access|N|
|CNT|2/2|read<br>access|N|write<br>access|N|
|ENTRY|1/1|write<br>access|N|write<br>access|N|

_Note_：

1. _alloc_queue()_ 时，硬件通过一笔读数据返回两个 _id_，低 _16bit_ 和高 _16bit_ 分别对应 _producer_cnt_alloc_id_ 和 _consumer_cnt_alloc_id_

- （_rdata={consumer_cnt_alloc_id, producer_cnt_alloc_id}_）

2. 两个 _id_ 数值未必是连续的

#### 5.3.4. L2/L3 Resource Allocation

从软件逻辑层面看，会区分L2和L3两个层级的同步资源，这两个level的同步资源可以通过L3 HwSync进行统一管理，L2/L3的资源划分同样是在VG资源初始化时完成。

对于L3的同步资源不能支持动态分配，只能以静态方式使用（可由SP完成分配）。

#### Note：

1. 上仅限于Mutex和CNT资源；Entry资源全部以动态形式分配

2. 如果需要L3资源，需要给L3资源单独映射到一个VG，因为Entry资源是动态分配的，需要VG指定资源其对应的资源区间

L2和L3的资源划分通过以下示例进行说明：

假设单Die内有256各CNT资源，划分给2个VG。每个VG各划分100个资源（L2），余下的56个资源会做为global的同步资源提供给VG0和VG1使用（L3）。

![L2 and L3 resource allocation example](hwsync_arch_spec__hwsync_arch_spec_pdf_0032_15.png)

### 5.4. Master Address Lookup Table

LUT存储master的notify address和master在HwSync AXI CF Master承载的axi id。

LUT表项信息在初始化时完成。每个表项对应一个配置地址。注册时由写数据承载lut_id。

#### Notify Address

Notify address是master的mailbox配置地址或HwSync的Signal CNT地址或GSYNC的CNT地址。

#### AXI ID

每个Master尽量分配不同的AXI ID，以保证CF带宽。

Note：GMU中，HwSync、Gsync、L2M、SA会share 64个AXI ID，所以对于L3 HwSync，可配置的AXI ID数值是有限制的，下限值为0，上限值在GMU中是寄存器可配置的，超出预期上限值会导致GMU硬件异常。具体可参阅GMU Programming Guide文档。

### 5.5. Signal

signal操作对应CNT+行为。可能对HwSync发起Signal操作的Master包括：SIP/xDTE/SP/AP。

#### signal操作的写数据格式如下：

![Signal write data format](hwsync_arch_spec__hwsync_arch_spec_pdf_0033_11.png)

### 5.6. Register and Unregister

#### 5.6.1. Register

注册ENTRY通过两笔写操作完成。动态注册时通过携带的alloc_id实现与CNT的关联。

第一笔注册写时，首先硬件会先动态分配一个entry资源，然后再将数据写入对应entry。如果申请entry 资源失败，则第一笔写entry无效，同时硬件会上报中断。软件收到中断后，可能会先尝试若干次retry再处理（hang住或reset）

注册Entry写数据包含两方面信息。一方面是notification时发出的32bit写数据；另一方面是用于HwSync 内部功能实现信息，包括：

- 1）register_alloc_id（分配的cnt_alloc_id），用于关联对应id的CNT

- 2）LUT_ID，用于查表master notify address

- 3）register_entry_uniq_id，用于绑定两笔写数据（原因是不能保证所有master以burst形式访问 HwSync），以及unregister的点对点释放

所有可能被HwSync通知的目标共有3类，其 **notification wdata format** 如下：

1. Mailbox

![Mailbox notification write data format](hwsync_arch_spec__hwsync_arch_spec_pdf_0034_02.png)

_Note_：目标 _Master_ 可能是 _SIP/xDTE/SP/AP_

2. HwSync

![HwSync notification write data format](hwsync_arch_spec__hwsync_arch_spec_pdf_0034_05.png)

_Note: signal_uniq_id only for debug, same as mailbox unique id_

3. GSYNC

![GSYNC notification write data format](hwsync_arch_spec__hwsync_arch_spec_pdf_0034_08.png)

**Libra新增内容：**

第二笔注册写数据bit[11]表征对应Entry的释放模式

- 1'b0，表征HW-unregister mode：Entry 发起notify后，HW自动回收Entry资源

- 1'b1，表征SW-unregister mode：Entry资源回收由SW发起unregister API触发

#### 5.6.2. unregister

1. unregister是释放分配到的Entry资源。

2. register与unregister操作是对称的（成对出现）。

in Libra，如果采用HW-unregister mode，则无需unregister操作。

### 5.7. Master Local Mailbox

同HwSync交互的Master local mailbox与软件传统方式所使用的mailbox是相互独立的，它们可以共享 mailbox资源池，且仅有一个CF地址可以访问(config/signal/debug) mailbox。

Mailbox需要支持动态allocate。 **HwSync不提供Mailbox的动态分配**，由Master各自handle，或者由其它IP handle。

对于每一个等待被notify的thread，在发送register和wait之前，需要向自己所在master申请一个被通知的mailbox。register时，需要将mailbox ID注册到对应的HwSync Entry资源中，以便未来获得通知。

#### 5.7.1. Mailbox Work-mode

以下是各同步语义下的Local Mailbox Work-mode的使用建议，但未必只限于以下option，以最终软件方案为准。

|**Synchronization**<br>**Type**|**Local Mailbox Work-**<br>**mode**|**Configure**<br>**REF**|**Operation**|
|---|---|---|---|
|Barrier|Wait-clear mode|1|wait成功后clean<br>mailbox counter|
|Event|Wait-clear mode|1|wait成功后clean<br>mailbox counter|
|Latch|Wait-clear mode|1|wait成功后clean<br>mailbox counter|
|Queue|Producer User: Wait-<br>clear mode<br>Consumer User: Wait-<br>clear mode|1|wait成功后clean<br>mailbox counter|

### 5.8. Interrupt

HwSync内部中断全部为exception interrupt，主要目的是检测一些配置异常，方便软硬件debug。

所有中断都是通过HwSync CF Master发出，中断可同时发往SP和Host端。每个中断源有独立的 （SP/HOST）MASK控制、中断写数据以及LOG信息。

#### HwSync中断表如下所示：

|**No.**|**Interrupt**|**Description**|**Note**|**INT_STATUS**|**INT_Log**|
|---|---|---|---|---|---|
|0|register_error|动态注册时，硬件无<br>entry资源可分配|硬件支持重发注册。但软件不支持|INT_STATUS[0]|{register_cnt_id[CNT_RES_WTH-1:0],<br>axi_axuser[19:0]}|
|1|cf_master_bresp_error|CF Master BRESP<br>Error|CF Master返回的bresp编码<br>为'b10或'b11|INT_STATUS[1]|{axi_bid, // 6bit<br>axi_bresp, // 2bit<br>axi_buser};// 4bit|
|2|unlock_free_mutex_error|unlock一个未加锁的<br>mutex资源|/|INT_STATUS[2]|{axi_awaddr[15:0], // get mutex id<br>axi_axuser[15:0]};|
|3|dealloc_locked_mutex_error|释放（归还）一个还<br>处于加锁状态的<br>mutex资源|/|INT_STATUS[3]|{dealloc_mutex_id,<br>axi_axuser[19:0]};|
|4*|res_alloc_mutex_error|mutex资源申请配置<br>异常|申请的VG没有分配过资源|INT_STATUS[4]||
|5*|res_alloc_cnt_error|cnt资源申请配置异<br>常|同上|INT_STATUS[5]||
|6|res_dealloc_mutex_error|mutex资源释放配置<br>异常|释放一个未分配的资源|INT_STATUS[6]|{dealloc_mutex_id,<br>dealloc_mutex_err_type[2:0],<br>axi_axuser[15:0]};|
|7|res_dealloc_cnt_error|cnt资源释放配置异<br>常|同上|INT_STATUS[7]|{dealloc_cnt_id,<br>dealloc_cnt_err_type[2:0],<br>axi_axuser[19:0]};|
|8|init_unavail_cnt_error|cnt init配置异常|init的cnt为无效态（type=7）|INT_STATUS[8]||
|9|signal_uid_mismatch_error|signal uniqid<br>mismatch|signal时携带的unique id与init时<br>的unique_id不匹配|INT_STATUS[9]|{signal_alloc_id[CNT_RES_WTH-1:0],<br>signal_uniq_id[6:0],<br>axi_axuser[10:0]};|
|10|signal_type_error|signal type配置异常|signal时携带的cnt_type=7|INT_STATUS[10]||
|11|signal_value_error|signal value配置异<br>常|signal_value不符合预期（除了<br>latch，其它预期signal_value必须<br>为1）|INT_STATUS[11]||
|13*|register_vg_nores_error|注册的VG没有分配<br>资源|static_vg_res_num[vg_id]=0|INT_STATUS[13]||
|15|register_unavail_cnt_error|注册对应cnt为无效<br>态|register对应cnt的type=7|INT_STATUS[15]||
|16|register_mismatch_error|register<br>alloc_id/uniq_id配置<br>异常|第二笔注册时对应的<br>alloc_id/unique_id与第一笔注册<br>时的信息不匹配|INT_STATUS[16]|{register_cnt_id[CNT_RES_WTH-1:0],<br>register_entry_uniq_id[ENTRY_RES_WTH-<br>1:0],<br>axi_axuser[10:0]};|
|17|register_lutid_overflow_error|register LUT ID配置<br>异常|LUT_ID>最大表项数（160）|INT_STATUS[17]||
|22|lut_axid_ovfl_error|LUT初始化对应的<br>axid超出寄存器设定<br>max value|lut_axid > cfg_lut_axid_max|INT_STATUS[22]||
|23|context_error|context配置异常|/|INT_STATUS[23]||

> **【注1】Int4/5/13仅在L3HwSync有效；**

- 【注2】以上高亮条目会增加至RAS Table，KMD会感知；

【注3】以上中断不支持force trigger。

## 6. Performance Description

## 7. Power Description

## 8. Register Spec

参见chip ralf。

## 9. Programming Guideline

参见独立文档。

## 10. Design For X

### 10.1. Design For Test

### 10.2. Design For Debug

1. 发生异常时，HwSync会上报异常中断，同时支持HwSync hang住，保留现场。

**Libra新增内容：**

Libra对以下debug feature进行signoff。

|**No.**|**Description**|**Register Name**|**Usage**|**Note**|
|---|---|---|---|---|
|1|可读取ENTRY资源<br>分配状态|ENTRY_ALLOC_STATUS_*|RO寄存器，直接读取|1表示已分配；0表示未分配|
|2|可读取任意ENTRY<br>的info信息|DEBUG_INDEX<br>DEBUG_ENTRY_DATA1|Step1：写DEBUG_INDEX<br>寄存器（该寄存器表示<br>entry_id）<br>Step2：2 @ECF_clk后，读<br>取DEBUG_ENTRY_DATA1|DEBUG_ENTRY_DATA各field信息详<br>见【注1】|
|3|可读取任意CNT的<br>info信息（info包括<br>uniq_id、<br>cnt_type、<br>cnt_value计数等）|CNT_STATIC_ALLOC_*|RO寄存器，直接读取|CNT_STATIC_ALLOC各field信息详见<br>【注2】|
|4|支持Mutex资源的<br>Force Clear。<br>（clear Mutex状<br>态；对于动态Mutex<br>资源，不会触发<br>Mutex释放资源）|MUTEX_FORCE_CLEAR_*|写1（无需再写0）|MUTEX_FORCE_CLEAR_0[31:0]:<br>bit0~bit31分别对应<br>mutex_0~mutex_31<br>MUTEX_FORCE_CLEAR_1[31:0]:<br>bit0~bit31分别对应<br>mutex_32~mutex_63<br>依此类推|
|5|支持CNT资源的<br>Force Clear。<br>（clear CNT计数；<br>对于动态CNT资源，<br>不会触发CNT释放资<br>源）|CNT_FORCE_CLEAR_*|写1（无需再写0）|CNT_FORCE_CLEAR_0[31:0]:<br>bit0~bit31分别对应cnt_0~cnt_31<br>CNT_FORCE_CLEAR_1[31:0]:<br>bit0~bit31分别对应cnt_32~cnt_63<br>依此类推|

**【注1】** DEBUG_ENTRY_DATA各field信息如下：（L3和L1各field信息相同，但位宽有差异）

**DEBUG_ENTRY_DATA1**： **（L3）**

bit[31:24]: cnt_id bit[23:14]: entry_uniq_id bit[13]: notify_request状态 bit[12:9]: ctx_id bit[8:1]: lut_id

bit[0]: entry_vld状态. 1表示完成了两笔注册；0表示未完成两笔注册

**DEBUG_ENTRY_DATA1**： **（L1）**

bit[31:22]: cnt_id bit[21:14]: entry_uniq_id bit[13]: notify_request状态 bit[12:9]: ctx_id bit[8:1]: lut_id

bit[0]: entry_vld状态. 1表示完成了两笔注册；0表示未完成两笔注册

**【注2】** CNT_STATIC_ALLOC各field信息如下：

bit[31:22]: cnt_value

bit[21:15]: cnt_uniq_id bit[10:3]: cnt_alloc_id bit[2:0]: cnt_sync_type

### 10.3. Design For Manufacture

### 10.4. Design For Profiling

## 11. 强杀支持

硬件实现：利用Scorpio.HwSync的debug功能（P2），配合SP FW实现强杀。

### 11.1. 需求背景及解决方案（Flow）

【注】：因强杀需求是Libra项目尾段时AMOS提出的需求（Scorpio无此Feature，Libra HwSync FeatureList也不包含该Feature），最终Arch决策采用折中的方式，通过AMOS利用Scorpio HwSync开发的Debug功能（Scorpio P2）间接实现强杀。需要注意的是，这些Debug Feature在Scorpio实现时， 并不依托任何需求实现的，而是DE自行开发，以便于DE debug。 **所以，通过多个Debug手段配合实现强杀的方式，硬件并不能保证这些Debug Feature的配合使用可在任何强杀场景下（100%）都能成功。**

### 11.2. Overview

1. 因为Scorpio版本中，软件未使用CNT动态资源模式，即CNT资源全部为静态模式，由Amos完成分配。所以，对于CNT资源，Amos可以精准知道哪些CNT资源需要清理回收。在配置 CNT_Force_Clear之后，Amos可以重新使用。

2. 而对于ENTRY资源，是由硬件完成动态分配的，需要Amos代理SIP完成未发出的 register/unregister配置，以使HwSync完成ENTRY资源的回收。

3. Scorpio vs Libra强杀流程有差异，此差异由新增的HW-unregister功能引起。

4. 以上Flow涉及到的接口包括

- CNT_STATIC_ALLOC_*

- ENTRY_ALLOC_STATUS_*

- DEBUG_INDEX、DEBUG_ENTRY_DATA1

- CNT_FORCE_CLEAR_*

### 11.3. 强杀流程

#### 11.3.1. 说明

若强杀过程中，出现中断（hwsync），需要升级reset

对于barrier语义，可以保证强杀成功。（成功表示资源释放回资源池）

对于queue语义，配置复杂，不一定保证100%成功。此时采用折中办法，丢弃这个entry资源，其它已归还资源可以正常使用。

#### 11.3.2. For Libra

注：Libra新增支持HW-self_unregister功能(notify后auto-unreg)。这里存在依赖链路： entry_self_unregister ==deps==> cnt_trigger ==deps==> signal number=cnt_threshold

所以，如果CNT signal未全部发出，需要补足signal。

注意，需要先补entry register，最后再补cnt signal。

1. 逐一扫描所有CNT（CNT_STATIC_ALLOC），记录所有需要做强杀CNT的type、uniq_id

2. 对需要做强杀的CNT做force_clear（CNT_FORCE_CLEAR）

- （Note: for只注册一笔的ENTRY的unregister）

3. 逐一扫描所有ENTRY。执行以下步骤：

- 查看对应的ENTRY_ALLOC_STATUS，确定Entry是否已经发起过注册。如果没有注册，结束； 否则进入下一步（已注册过一笔）

- 针对已经注册的HwSync Entry

- 先写DEBUG_INDEX = entry_id

- IO_FENCE()

- 读取DEBUG_ENTRY_DATA1，查看Entry的CNT_RES_ID和ENTRY_UNIQUE ID、以及 notify_req状态。

- 判断对应的CNT是否在强杀范围内，如果不在此范畴，结束，否则进入下一步

- 查看已注册Entry的valid(avail) bit（表示是否完成两笔注册）

- 如果为0，说明只写了2笔注册其中的一笔，执行以下步骤

- SP FW 根据CNT_RES_ID和ENTRY_UNIQUE id，补充一笔注册

- （register_wdata[11]=1，即SW-unreg mode），让Entry变得valid(SP FW使用查询的方式，直到entry变成valid或者timeout)

- 根据CNT_ID, UNIQUE_ID, CNT TYPE, 写入UNREGISTER寄存器

- 如果为1，说明完成了两笔注册，暂不做其它处理

- （notify_req为0，可能cnt未trigger，此时entry_vld还有效；可能已经完成了notify，说明为SW-unreg mode，此时entry_vld无效）

- （notify_req为1，说明cnt已trigger，此时entry_vld无效）

4. 根据uniq_id和cnt_type，对需要做强杀的CNT重新init、signal，其中init_threshold=1，signal只发起一次

5. 再次逐一扫描所有ENTRY。执行以下步骤：

- 查看对应的ENTRY_ALLOC_STATUS，确定Entry是否已经发起过注册。如果没有注册，结束； 否则进入下一步（已注册过一笔）

- 针对已经注册的HwSync Entry

- 先写DEBUG_INDEX = entry_id

- IO_FENCE()

- 读取DEBUG_ENTRY_DATA1，查看Entry的CNT_RES_ID和ENTRY_UNIQUE ID、以及 notify_req状态。

- 判断对应的CNT是否在强杀范围内，如果不在此范畴，结束，否则进入下一步

- 查看Entry的valid(avail) bit以及notify_req bit（此时用于判断是否自动释放）

- 如果notify_req为1，需要polling，直至notify_req为0后，执行以下步骤：

- 查看valid状态，如果为1，则根据CNT_ID, UNIQUE_ID, CNT TYPE, 写入 UNREGISTER寄存器（valid为0，无任何处理）

6. 再次对需要做强杀的CNT做force_clear（CNT_FORCE_CLEAR）
