> Imported material source: `Doc/HwSync Programming Guide.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `HwSync Programming Guide`.

# HwSync Programming Guide

## 1. Overview

VG初始化时，每个VG划分得到一定数量的资源，同时每个VG内会将这部分资源进一步划分为静态资源和动态资源。其中，静态资源由软件负责管理分配，动态资源由硬件负责管理分配。

HwSync同步资源中，Mutex、CNT、ENTRY资源会按照VG划分；同时Mutex和CNT资源会划分静态和动态。所以，软件需要管理的是每个VG内的静态Mutex资源和静态CNT资源。

静态CNT资源在使用前需要软件进行资源分配（分配CNT用于哪种同步类型）。

资源分配 （静态和动态）的统一原则：对于每个VG，分配的同步资源ID 都是全局的。

动态资源分配时，硬件在VG对应资源区间内进行分配，保证alloc_id是全局的。

静态资源分配时，软件也需要在VG对应资源区间内进行分配。每个VG的资源区间计算方式如下：

![VG resource range formula](hwsync_programming_guide__hwsync_programming_guide_pdf_0002_03.png)

> **【注意】Libra不涉及多VG，VG_NUM=1。**

### 1.1. Mutex resources configuration

mutex锁资源占用一段连续的地址空间，每个mutex锁资源对应一个配置地址。mutex_id和 mutex_resource_id是一一对应的。

下图示意了不同VG的Mutex资源划分。

![Mutex resource partition by VG](hwsync_programming_guide__hwsync_programming_guide_pdf_0002_08.png)

#### configuration address offset

使用Mutex资源时需要根据mutex_id(mutex_res_id)映射到对应mutex资源的配置地址。其在HwSync内的偏移地址计算方式如下：

cfg_mutex_offset_addr = MUTEX_BASE_ADDR + mutex_id * 'h4

_Note_： _MUTEX_BASE_ADDR_ 表示 _mutex0_ 资源在 _HwSync_ 内的偏移地址

### 1.2. CNT resources static allocation

CNT资源占用一段连续的地址空间，每个CNT资源对应一个配置地址。

软件仅分配CNT资源；ENTRY资源全部由硬件进行动态管理，在动态注册时通过register_alloc_id关联 CNT和ENTRY。

**CNT资源分配** （静态和动态）的 **原则**：

- alloc_id与CNT资源序号（cnt_res_id）一一对应

- 不同VG划分的资源范围（序号）是相对于全局资源的

以上保证了在所有VG中，每一个同步语义所分配的id是独一的。

下图示意了不同VG内的静态资源分配方式。

#### Note: queue 语义的生产者和消费者各分配一个 ID，要求 queue producer id 和 queue consumer id 数值连续，且 producer id 在前

![CNT static resource allocation by VG](hwsync_programming_guide__hwsync_programming_guide_pdf_0003_10.png)

#### configuration address offset

静态CNT资源分配时，对应cnt_id的配置地址计算方式同上：

cfg_cnt_offset_addr = CNT_BASE_ADDR + cnt_id* 'h4

### 1.3. 注册Entry

#### Background

注册Entry写数据包含两方面信息。一方面是notification时发出的32bit写数据；另一方面是用于HwSync 内部功能实现信息，包括：

1）register_alloc_id（分配的cnt_alloc_id），用于关联对应id的CNT

2）LUT_ID，用于查表master notify address

所以，注册一次Entry至少需要两笔写数据。由于不能保证所有master以burst形式访问HwSync，所以还需要附加信息register_entry_uniq_id用于绑定两笔写数据。

基于以上原因，要保证两笔写数据完成一次注册，register_alloc_id需要通过不同的配置地址区分。 Register配置地址共有256(L3)/64(L1)个。

【Note】：每个CNT会关联多个Entry，每个Entry代表一个thread，不同Thread分配的id是独一的。图示说明：

![CNT and ENTRY registration relationship](hwsync_programming_guide__hwsync_programming_guide_pdf_0004_09.png)

#### 注册写数据格式

一次Entry的注册需要两笔写操作完成。同一Entry的两笔写操作完成之后，Entry VLD才会有效。两次写操作的数据格式如下：

第一笔写数据 entry uniq id

![First register write data format](hwsync_programming_guide__hwsync_programming_guide_pdf_0004_13.png)

第二笔写数据

![Second register write data format](hwsync_programming_guide__hwsync_programming_guide_pdf_0004_15.png)

HwSync CF Master发出的notification写数据格式会直接将两部分数据进行拼接后直接发出，即

Notify_wdata={REGISTER_DATA_H, REGISTER_DATA_L}

**Libra新增内容：**

第二笔注册写数据bit[11]表征对应Entry的释放模式

- 1'b0，表征HW-unregister mode：Entry 发起notify后，HW自动回收Entry资源

1'b1，表征SW-unregister mode：Entry资源回收由SW发起unregister API触发


#### 所有可能的待唤醒目标的 notification wdata format 如下：

1. Mailbox

![Mailbox notification write data format](hwsync_programming_guide__hwsync_programming_guide_pdf_0005_04.png)

2. HwSync

![HwSync notification write data format](hwsync_programming_guide__hwsync_programming_guide_pdf_0005_06.png)

_Note: signal_uniq_id only for debug, same as mailbox unique id_

3. GSYNC

![GSYNC notification write data format](hwsync_programming_guide__hwsync_programming_guide_pdf_0005_09.png)

#### Unregister

unregister是释放分配到的Entry资源。

- register与unregister操作是对称的（成对出现）。

- in Libra，如果采用HW-unregister mode，则无需unregister操作。

- unregister只有一个配置地址。

- unregister携带的register_alloc_id、register_entry_uniq_id与register时的信息相同。

## 2. Initialization

### 2.1. API

|**硬件API**|**发**<br>**起**<br>**方**|**被请求**<br>**方**|**描述**|
|---|---|---|---|
|init_vg_mutex_res_num(level, vg_id,<br>total_num, sta_num)|SP|HwSync|初始化每个VG划分到的Mutex资源总数，以及静态资源的数量。<br>L1 HwSync无VG划分|
|init_vg_cnt_res_num(level, vg_id,<br>total_num, sta_num)|SP|HwSync|初始化每个VG划分到的Cnt资源<br>总数，以及静态资源的数量。L1<br>HwSync无VG划分|
|init_vg_entry_res_num(level, vg_id,<br>total_num)|SP|HwSync|初始化每个VG划分到的Entry资源总数。L1 HwSync无VG划分|
|init_ctx_vg_map(ctx_id, vg_id)|SP|HwSync|初始化Context_id和VG_id的映射<br>关系。L1 HwSync无VG划分|
|init_lut_notify_addr(level, lut_id,<br>notify_addr)|SP|HwSync|初始化HwSync查找表中master<br>notify address信息|
|init_lut_axi_id(level, lut_id, axi_id)|SP|HwSync|初始化HwSync查找表中master<br>对应的AXI ID信息|
|init_static_alloc(level, res_id,<br>static_alloc_id, sync_type)|SP|HwSync|静态Cnt资源分配|

### 2.2. Programming Sequence

按照以下步骤完成HwSync初始化。

#### Step1：VG初始化

- 1）（L3 HwSync）初始化每个VG划分的资源数量，包括Mutex、CNT、ENTRY资源；

- 2）（L1/L3 HwSync）初始化VG内的静态和动态资源数量，包括Mutex和CNT资源

**例：** 假设有2048个Mutex资源，256个CNT资源，1024个Entry资源。共2个VG，VG划分资源数目相同， VG内静态/动态资源数目相同：

- Write `VG_MUTEX_RES_INIT_0` register

- Write_data[11:0].vg_sta_mutex_res_num_init_0 = 512

- Write_data[27:16].vg_mutex_res_num_init_0 = 1024

- Write `VG_MUTEX_RES_INIT_1` register

- Write_data[11:0].vg_sta_mutex_res_num_init_1 = 512

- Write_data[27:16].vg_mutex_res_num_init_1 = 1024

- Write `VG_CNT_RES_INIT_0` register

- Write_data[8:0].vg_sta_cnt_res_num_init_0 = 64

- Write_data[23:16].vg_cnt_res_num_init_0 = 128

- Write `VG_CNT_RES_INIT_1` register

- Write_data[8:0].vg_sta_cnt_res_num_init_1 = 64

- Write_data[23:16].vg_cnt_res_num_init_1 = 128

- Write `VG_ENTRY_RES_INIT_0` register

- Write_data[10:0].vg_entry_res_num_init_0 = 512

- Write `VG_ENTRY_RES_INIT_1` register

- Write_data[10:0].vg_entry_res_num_init_1 = 512

- 【 _Note_ 】 _: L1 HwSync_ 无 _VG_ 划分；但 _Mutex_、 _CNT_ 需初始化静态资源数量

**Step2：CTX_ID与VG_ID映射关系初始化**

Context_id范围0~15，VG_id范围0~7（双Die）。

**例：** 假设共2个VG，VG0对应的CTX_ID为8，VG1对应的CTX_ID为9

Write `CTX_VG_MAP_INIT_8` register

- Write_data[3:0].ctx_vf_map_init=0

Write `CTX_VG_MAP_INIT_9` register

- Write_data[3:0].ctx_vf_map_init=1

_note:_ 默认 _CTX_ 与 _VG_ 映射关系为无效 _(default value F)_。硬件会 _check CTX_ 的 _y_ 有效性

- 【 _Note_ 】 _: L1 HwSync_ 无需此步骤

#### Step3：LUT初始化

初始化每个LUT表项值，包括master notify address和AXI ID。

- Write `LUT_MST_ADDR_INIT_x` register

_Note: CF_ 地址位宽 _30bit_。配置数据低 _30bit_ 有效

- Write `LUT_AXI_ID_INIT_x` register

- Write_data[5:0].lut_axi_id_init_x = ?

- 【注】LUT初始化由AMOS FW完成。

#### Step4：静态CNT资源分配

- 1）初始化每个CNT用于同步语义类型

- 2）初始化每个CNT分配的id值（与CNT资源序号一一对应）

- **例：** 假设256CNT资源划分给两个VG，每个VG各划分128个资源，VG0静态资源1个，VG1静态资源2个

- VG0静态CNT资源分配初始化

Write `CNT_STATIC_ALLOC_0` register

- Write_data[2:0].cnt_sync_type = 0 （used for barrier）

- Write_data[10:3].cnt_alloc_id = **0**

- VG1静态CNT资源分配初始化

Write `CNT_STATIC_ALLOC_128` register

- Write_data[2:0].cnt_sync_type = 3 （used for Queue）

- Write_data[10:3].cnt_alloc_id = **128**

Write `CNT_STATIC_ALLOC_129` register

- Write_data[2:0].cnt_sync_type = 4 （used for Queue）

- Write_data[10:3].cnt_alloc_id = **129**

#### Note：静态分配的范围不能超过划分的静态资源的边界

## 3. Mutex

### 3.1. API

|用户接口API|硬件接口API|
|---|---|
|Mutex alloc_mutex(void)|id=alloc_mutex(level)|
|void free_mutex(Mutex* mutex)|dealloc_mutex(level, id)|
|void lock_mutex(Mutex* mutex)|基于 try_lock_mutex(level, id) 由软件循环封装|
|bool try_lock(Mutex* mutex)|try_lock_mutex(level, id)|
|void unlock_mutex(Mutex* mutex)|unlock_mutex(level, id)|

HwSync硬件底层提供try_lock mutex，lock_mutex需要由软件借用try_lock_mutex进行封装。

### 3.2. Programming Sequence

无论是动态分配的mutex资源还是静态分配的mutex资源，使用时都需要通过不同配置地址显示地区分 mutex资源，即每个mutex资源都有各自的配置接口。

静态和动态mutex资源的差异体现在：对于动态资源，软件需要先申请资源，然后根据返回的mutex id，配置对应mutex资源。

**例：**

_**alloc_mutex:**_ Read `ALLOC_MUTEX` register（eg. 1 = alloc_mutex()）

_Note: only for dynamic allocation, static allocation skip this step_

**try_lock_mutex(id):** Read `MUTEX_1` register

_true=(rdata[0] == 0);_

_false=(rdata[0] == 1);_

_Note: if it is static allocation, cnt_alloc_id_ 为软件分配的 _id;_ 本示例以动态 _alloc_ 进行说明

**unlock_mutex(id):** Write `MUTEX_1` register

- Write_data[31:0]=0

_**dealloc_mutex(id):**_ Write `DEALLOC_MUTEX` register

- Write_data[10:0].dealloc_mutex_id= **1**

_Note: only for dynamic allocation, static allocation skip this step_

## 4. Barrier

### 4.1. API

|用户接口API|硬件接口API / 操作|
|---|---|
|Barrier alloc_barrier(void)|barrier_id=alloc_barrier(level)|
|void free_barrier(Barrier* barrier)|dealloc_barrier(level, id)|
|void init_barrier(Barrier* barrier, uint32_t count)|set_barrier_count(level, barrier_id, count, uniq_id)|
|ArrivalToken arrive_barrier(Barrier* barrier)|notify_id=alloc_barrier_mailbox(); register_barrier_wait(level, barrier_id, last, uniq_id, notify_info); arrive_barrier(level, barrier_id, uniq_id)|
|void wait_barrier(ArrivalToken* token)|wait_barrier(notify_id, barrier_id); unregister_barrier_wait(level, barrier_id, uniq_id)|
|void arrive_and_wait_barrier(Barrier* barrier)|arrive_barrier(level, barrier_id, uniq_id); wait_barrier(notify_id, barrier_id)|
|void arrive_and_drop_barrier(Barrier* barrier)|arrive_and_drop_barrier(level, barrier_id, uniq_id)|
|硬件通知等待者|notify_barrier_waiter(barrier_id, notify_id)|

1. HwSync硬件底层提供分离的arrive_barrier()、wait_barrier()同步方式，arrive_and_wait_barrier() 这种组合式的同步方式由软件借用arrive_barrier()、wait_barrier()进行封装。

2. 用户接口API中的arrive_barrier()由软件封装为register_barrier_wait() + arrive_barrier()，对应硬件的注册entry和signal cnt行为，由两笔写操作配置。

3. 用户接口API中arrive_barrier()有ArrivalToken返回值，用于保证wait和arrival匹配，由软件进行处理，硬件不感知，即配置arrive_barrier时，硬件无返回值。

4. 用户接口API中arrive_and_drop_barrier()由软件将其封装为arrive_barrier()，即仅对应硬件的 signal cnt行为。硬件支持‘drop’行为，即next同步phase的barrier_counter阈值减1。

### 4.2. Programming Sequence

以2to2 Barrier为例（使用1CNT+2ENTRY）

**例1：**

**alloc_barrier:** Read `ALLOC_BARRIER` register（eg. **8** =alloc_barrier()）

_Note: only for dynamic allocation, static allocation skip this step_

**set_barrier_count:** Write `CNT_INIT` register.

- Write_data[7:0].cnt_init_alloc_id= **8**

- Write_data[17:8].cnt_init_threshold= **2**

- Write_data[24:18].cnt_init_config_uniq_id=6 (just for example)

_Note: if it is static allocation, cnt_alloc_id_ 为软件分配的 _id;_ 本示例以动态 _alloc_ 进行说明

**register_barrier_wait: (thread0, part0)** Write `REGISTER_8` register.

- Write_data.notify_info[8:0]=0 (mailbox for example, mbx_id)

- Write_data.notify_info[15:9]=0 (mailbox for example, mbx_uniq_id)

- Write_data.notify_info[20:16]=0 (reserved, mailbox for example)

- Write_data.register_entry_uniq_id= **0** (just for example)

- Write_data.register_last= **0**

- **register_barrier_wait:** (thread0, **part1** ) Write `REGISTER_8` register.

- Write_data.notify_info[12:0]=0 (reserved, mailbox for example)

- Write_data.notify_info[20:13]=1 (lut_id, mailbox for example)

- Write_data.register_entry_uniq_id=0 (just for example)

- Write_data.register_last= **1**

- **register_barrier_wait: (thread1, part0)** Write `REGISTER_8` register.

- Write_data.notify_info[8:0]=1 (mailbox for example, mbx_id)

- Write_data.notify_info[15:9]=1 (mailbox for example, mbx_uniq_id)

- Write_data.notify_info[20:16]=0 (reserved, mailbox for example)

- Write_data.register_entry_uniq_id= **1** (just for example)

- Write_data.register_last= **0**

- **register_barrier_wait:** (thread1, part1) Write `REGISTER_8` register.

- Write_data.notify_info[12:0]=0 (reserved, mailbox for example)

- Write_data.notify_info[20:13]=3 (lut_id, mailbox for example)

- Write_data.register_entry_uniq_id=1 (just for example)

- Write_data.register_last= **1**

**arrive_barrier: (thread0)** Write `SIGNAL` register.

- Write_data[7:0].signal_alloc_id= **8** (barrier_id)

- Write_data[10:8].signal_sync_type=0 (arrive_barrier)

- Write_data[20:11].signal_value=1

- Write_data[27:21].signal_uniq_id=6

- **arrive_barrier: (thread1)** Write `SIGNAL` register.

- Write_data[7:0].signal_alloc_id= **8** (barrier_id)

- Write_data[10:8].signal_sync_type=0 (arrive_barrier)

- Write_data[20:11].signal_value=1

- Write_data[27:21].signal_uniq_id=6

**unregister_barrier_wait (thread0):** Write `UNREGISTER` register

- Write_data[7:0].unregister_alloc_id= **8**

- Write_data[17:8].unregister_uniq_id= **0**

- Write_data[20:18].unregister_sync_type=0

- **unregister_barrier_wait** (thread1): Write `UNREGISTER` register

- Write_data[7:0].unregister_alloc_id= **8**

- Write_data[17:8].unregister_uniq_id= **1**

- Write_data[20:18].unregister_sync_type=0

- **dealloc_barrier:** Write `DEALLOC` register.

- Write_data[7:0].dealloc_id = **8** (barrier_id)

- Write_data[18:16].dealloc_type =0

_Note: only for dynamic allocation, static allocation skip this step_

**例2：** (arrive_and_drop_barrier)

**alloc_barrier:** Read `ALLOC_BARRIER` register（eg. **8** =alloc_barrier()）

_Note: only for dynamic allocation, static allocation skip this step_

- **set_barrier_count(init_barrier):** Write `CNT_INIT` register.

- Write_data[7:0].cnt_init_alloc_id= **8**

- Write_data[17:8].cnt_init_threshold= **2**

- Write_data[24:18].cnt_init_config_uniq_id=6 (just for example)

_Note: if it is static allocation, cnt_alloc_id_ 为软件分配的 _id;_ 本示例以动态 _alloc_ 进行说明

**register_barrier_wait: (thread0, part0)** Write `REGISTER_8` register.

- Write_data.notify_info[8:0]=0 (mailbox for example, mbx_id)

- Write_data.notify_info[15:9]=0 (mailbox for example, mbx_uniq_id)

- Write_data.notify_info[20:16]=0 (reserved, mailbox for example)

- Write_data.register_entry_uniq_id= **0** (just for example)

- Write_data.register_last= **0**

**register_barrier_wait:** (thread0, **part1** ) Write `REGISTER_8` register.

- Write_data.notify_info[12:0]=0 (reserved, mailbox for example)

- Write_data.notify_info[20:13]=1 (lut_id, mailbox for example)

- Write_data.register_entry_uniq_id=0 (just for example)

- Write_data.register_last= **1**

**arrive_barrier: (thread0)** Write `SIGNAL` register.

- Write_data[7:0].signal_alloc_id= **8** (barrier_id)

- Write_data[10:8]. **signal_sync_type=0** (arrive_barrier)

- Write_data[20:11].signal_value=1

- Write_data[27:21].signal_uniq_id=6

arriveanddropbarrier: (thread1) Write `SIGNAL` register.

- Write_data[7:0].signal_alloc_id= **8**

- Write_data[10:8]. **signal_sync_type=1** (arrive_and_drop_barrier)

- Write_data[20:11].signal_value=1

- Write_data[27:21].signal_uniq_id=6

**unregister_barrier_wait(thread0):** Write `UNREGISTER` register

- Write_data[7:0].unregister_alloc_id= **8**

- Write_data[17:8].unregister_uniq_id=0

- Write_data[20:18].unregister_sync_type=0

**dealloc_barrier:** Write `DEALLOC` register.

- Write_data[10:0].dealloc_id = **8** (barrier_id)

- Write_data[18:16].dealloc_type =0

_Note: only for dynamic allocation, static allocation skip this step_

#### Note

1. 不同thread的arrive(signal)配置内容相同；

2. arrive和arrive_and_drop配置的type不同，其它内容相同；

3. unregister和arrive(signal)配置寄存器中的type含义不同；

4. 不同thread的unregister配置的entry_uniq_id不同；

5. unregister在arrive_and_drop 或wait后调用；

## 5. Event

Event主要用于Condition Variable的封装。

Condition Variable目前暂不在软件开发计划中。

### 5.1. API

|用户接口API|driver接口API / 操作|
|---|---|
|ConditionVar alloc_cv(void)|event_id = alloc_event(level)|
|void free_cv(ConditionVar* cv)|dealloc_event(level, id)|
|void notify_cv(ConditionVar* cv)|init_event(level, event_id, uniq_id); signal_event(event_id, uniq_id)|
|void wait_cv(ConditionVar* cv, Mutex* mutex, uint32_t* value_addr)|notify_id=alloc_event_mailbox(); register_event_wait(level, event_id, last, uniq_id, notify_info); wait_event(notify_id, event_id); unregister_event_wait(level, event_id, uniq_id)|
|硬件通知等待者|notify_event_waiter(event_id, notify_id)|

### 5.2. Programming Sequence

以1to2 Event为例

- **alloc_event:** Read `ALLOC_EVENT` register（假设alloc_id= **10**）

_Note: only for dynamic allocation, static allocation skip this step_

**init_event** : Write `CNT_INIT` register (only for uniq_id initialization)

- Write_data[7:0].cnt_alloc_id= **10**

- Write_data[17:8]. **cnt_threshold=1**

- Write_data[24:18].cnt_config_uniq_id=6 (just for example)

_Note: if it is static allocation, cnt_alloc_id_ 为软件分配的 _id;_ 本示例以动态 _alloc_ 进行说明

- **register_event_wait: (thread0, part0)** Write `REGISTER_10` register.

- Write_data.notify_info[8:0]=0 (mailbox for example, mbx_id)

- Write_data.notify_info[15:9]=0 (mailbox for example, mbx_uniq_id)

- Write_data.notify_info[20:16]=0 (reserved, mailbox for example)

- Write_data.register_entry_uniq_id= **0** (just for example)

- Write_data.register_last= **0**

- **register_event_wait:** (thread0, **part1** ) Write `REGISTER_10` register.

- Write_data.notify_info[12:0]=0 (reserved, mailbox for example)

- Write_data.notify_info[20:13]=1 (lut_id, mailbox for example)

- Write_data.register_entry_uniq_id=0 (just for example)

- Write_data.register_last= **1**

- **register_event_wait: (thread1, part0)** Write `REGISTER_10` register.

- Write_data.notify_info[8:0]=0 (mailbox for example, mbx_id)

- Write_data.notify_info[15:9]=0 (mailbox for example, mbx_uniq_id)

- Write_data.notify_info[20:16]=0 (reserved, mailbox for example)

- Write_data.register_entry_uniq_id= **1** (just for example)

- Write_data.register_last= **0**

- **register_event_wait:** (thread1, **part1** ) Write `REGISTER_10` register.

- Write_data.notify_info[12:0]=0 (reserved, mailbox for example)

- Write_data.notify_info[20:13]=2 (lut_id, mailbox for example)

- Write_data.register_entry_uniq_id=1 (just for example)

- Write_data.register_last= **1**

- **signal_event:** Write `SIGNAL` register.

- Write_data[7:0].signal_alloc_id= **10** (event_id)

- Write_data[10:8].signal_sync_type=2 (signal_event)

- Write_data[20:11].signal_value=1

- Write_data[27:21].signal_uniq_id=6

- **unregister_event_wait** (thread0): Write `UNREGISTER` register

- Write_data[7:0].unregister_alloc_id= **10**

- Write_data[17:8].unregister_uniq_id= **0**

- Write_data[20:18].unregister_sync_type=1 (event synchronization)

- **unregister_event_wait** (thread1): Write `UNREGISTER` register

- Write_data[7:0].unregister_alloc_id=10

- Write_data[17:8].unregister_uniq_id= **1**

- Write_data[20:18].unregister_sync_type=1 (event synchronization)

- **dealloc_event:** Write `DEALLOC` register.

- Write_data[7:0].dealloc_id = **10** (event_id)

- Write_data[18:16].dealloc_type =1

_Note: only for dynamic allocation, static allocation skip this step_

#### Note

1. 不同thread的arrive(signal)配置内容相同；

2. unregister和arrive(signal)配置寄存器中的type含义不同；

3. 不同thread的unregister配置的uniq_id不同；

4. unregister在wait后调用；

## 6. Latch

### 6.1. API

|用户接口API|driver接口API / 操作|
|---|---|
|Latch alloc_latch(void)|latch_id=alloc_latch(level)|
|void free_latch(Latch* latch)|dealloc_latch(level, latch_id)|
|void init_latch(Latch* latch, uint32_t count)|set_latch_count(level, latch_id, count, uniq_id)|
|void count_down_latch(Latch* latch, uint32_t count)|arrive_latch(level, latch_id, count, uniq_id)|
|bool try_wait_latch(Latch* latch)|try_wait_latch(latch_id)|
|void wait_latch(Latch* latch)|notify_id=alloc_latch_mailbox(); register_latch_wait(level, latch_id, last, uniq_id, notify_info); wait_latch(notify_id, latch_id); unregister_latch_wait(level, latch_id, uniq_id)|
|void arrive_and_wait_latch(Latch* latch, uint32_t count)|arrive_latch(level, latch_id, count, uniq_id); wait_latch(notify_id, latch_id)|
|硬件通知等待者|notify_latch_waiter(latch_id, notify_id)|

HwSync硬件底层提供分离的count_down_latch()、wait_latch()同步方式，arrive_and_wait_latch()这种组合式的同步方式由软件借用count_down_latch()、wait_latch()进行封装。

### 6.2. Programming Sequence

以2to2 Latch为例

**alloc_latch:** Read `ALLOC_LATCH` register（假设alloc_id= **9**）

_Note: only for dynamic allocation, static allocation skip this step_

- **set_latch_count(init_latch):** Write `CNT_INIT` register.

- Write_data[7:0].cnt_alloc_id= **9**

- Write_data[17:8].cnt_threshold= **2**

- Write_data[24:18].cnt_config_uniq_id=6 (just for example)

_Note: if it is static allocation, cnt_alloc_id_ 为软件分配的 _id;_ 本示例以动态 _alloc_ 进行说明

**register_latch_wait:** (dst-thrd0, part0) Write `REGISTER_9` register.

- Write_data.notify_info[8:0]=0 (mailbox for example, mbx_id)

- Write_data.notify_info[15:9]=0 (mailbox for example, mbx_uniq_id)

- Write_data.notify_info[20:16]=0 (reserved, mailbox for example)

- Write_data.register_entry_uniq_id= **0** (just for example)

- Write_data.register_last= **0**

- **register_latch_wait:** (dst-thrd0, part1) Write `REGISTER_9` register.

- Write_data.notify_info[12:0]=0 (reserved, mailbox for example)

- Write_data.notify_info[20:13]=1 (lut_id, mailbox for example)

- Write_data.register_entry_uniq_id=0 (just for example)

- Write_data.register_last= **1**

- **register_latch_wait:** (dst-thrd1, part0) Write `REGISTER_9` register.

- Write_data.notify_info[8:0]=0 (mailbox for example, mbx_id)

- Write_data.notify_info[15:9]=2 (mailbox for example, mbx_uniq_id)

- Write_data.notify_info[20:16]=0 (reserved, mailbox for example)

- Write_data.register_entry_uniq_id= **1** (just for example)

- Write_data.register_last= **0**

- **register_latch_wait:** (dst-thrd1, part1) Write `REGISTER_9` register.

- Write_data.notify_info[12:0]=0 (reserved, mailbox for example)

- Write_data.notify_info[20:13]=2 (lut_id, mailbox for example)

- Write_data.register_entry_uniq_id=1 (just for example)

- Write_data.register_last= **1**

- **arrive_latch:** (src-thrd) Write `SIGNAL` register.

- Write_data[7:0].signal_alloc_id= **9** (latch_id)

- Write_data[10:8].signal_sync_type=3 (latch count down)

- Write_data[20:11]. **signal_value=2**

- Write_data[27:21].signal_uniq_id=6

- **unregister_latch_wait** (thread0): Write `UNREGISTER` register

- Write_data[7:0].unregister_alloc_id= **9**

- Write_data[17:8].unregister_uniq_id= **0**

- Write_data[20:18].unregister_sync_type=2

- **unregister_latch_wait** (thread1): Write `UNREGISTER` register

- Write_data[7:0].unregister_alloc_id= **9**

- Write_data[17:8].unregister_uniq_id= **1**

- Write_data[20:18].unregister_sync_type=2

- **dealloc_latch(free latch):** Write `DEALLOC` register.

- Write_data[7:0].dealloc_id = **9** (latch_id)

- Write_data[18:16].dealloc_type =2

_Note: only for dynamic allocation, static allocation skip this step_

#### Note

1. 不同thread的arrive配置内容仅有signal_value可能不相同；

2. 不同thread的arrive配置signal_value>=1；

3. register和arrive配置先后顺序无要求；

4. unregister在wait后调用；

#### try_wait_latch

try_wait_latch()对应软件Polling CNTx寄存器行为。

软件直接通过alloc_id读取对应地址offset的CNT获取latch_counter的value（alloc_id与cnt_res_id是一一对应的关系）。

latch_arrive为CNT+行为，判断latch_release的条件是latch_counter_value=counter_threshold。

**例: latch_id=2**

- Read `CNT_STATIC_ALLOC_2` register

latch_realease = (Read_data.cnt_value[31:22] == cnt_threshold)

## 7. Queue

软件通过Queue语义、Mailbox封装Pipeline语义。

### 7.1. API

#### Pipeline API

|**Function Definition**|**Description**|
|---|---|
|Pipeline alloc_pipeline(uint32_t level, uint32_t<br>stage_count)|分配一个pipeline|
|void free_pipeline(Pipeline* pipe)|释放指定的pipeline|
|void pipeline_producer_acquire(Pipeline* pipe)|阻塞当前Thread，直到指定的pipeline空闲出一块buffer|
|void pipeline_producer_commit(Pipeline* pipe)|指定的pipeline的生产者完成生产|
|void pipeline_consumer_wait(Pipeline* pipe)|阻塞当前Thread，直到指定的pipeline上<br>生产了一个可用的数据|
|void pipeline_consumer_release(Pipeline* pipe)|指定的pipeline的消费者完成了消费|

pipeline实现示意图：

![Pipeline implementation diagram](hwsync_programming_guide__hwsync_programming_guide_pdf_0018_00.png)

#### Queue API

|操作|发起方|被请求方|描述|
|---|---|---|---|
|queue_id=alloc_queue(level)|Allocator|HwSync|类似mutex资源管理的方式，做资源申请。|
|dealloc_queue(level, queue_producer_id)|Allocator|HwSync|类似mutex资源管理的方式，做资源释放。|
|notify_id=alloc_queue_mailbox()|生产者thread / 消费者thread|本地 mailbox 管理者|生产者和消费者分别向本地资源管理模块申请被通知的 mailbox。|
|set_queue_producer_count(level, queue_producer_id, count, uniq_id)|Allocator/User|HwSync|设置生产动作数量。|
|set_queue_consumer_count(level, queue_consumer_id, count, uniq_id)|Allocator/User|HwSync|设置消费动作数量。|
|register_queue_producer(level, queue_consumer_id, last, uniq_id, notify_info)|生产者thread|HwSync|生产者将本地 mailbox 注册到 queue 资源，使 queue 在有消费者信息更新时通知生产者。|
|register_queue_consumer(level, queue_producer_id, last, uniq_id, notify_info)|消费者thread|HwSync|消费者将本地 mailbox 注册到 queue 资源，使 queue 在有生产者信息更新时通知消费者。|
|advance_write_local(level, queue_id)|生产者thread|本地 mailbox|生产者告知本地 mailbox 已生成一块数据。|
|advance_write_far(level, queue_producer_id, uniq_id)|生产者thread|HwSync|生产者告知 queue 管理模块已生成一块数据。|
|advance_read_local(level, queue_id)|消费者thread|本地 mailbox|消费者告知本地 mailbox 已消费一块数据。|
|advance_read_far(level, queue_consumer_id, uniq_id)|消费者thread|HwSync|消费者告知 queue 管理模块已消费一块数据。|
|unregister_queue_producer(level, queue_consumer_id, uniq_id)|生产者thread|HwSync|生产者解注册，释放对应 entry 资源。|
|unregister_queue_consumer(level, queue_producer_id, uniq_id)|消费者thread|HwSync|消费者解注册，释放对应 entry 资源。|
|notify_queue_producer(notify_id)|HwSync|生产者thread|queue 管理者通知生产者：消费者已经消费了一个数据。|
|notify_queue_consumer(notify_id)|HwSync|消费者thread|queue 管理者通知消费者：生产者已经生产了一个数据。|
|get_read_buffer(notify_id)|消费者thread|本地 mailbox|消费者等待本地 mailbox 新的数据就绪。|
|get_write_buffer(notify_id)|生产者thread|本地 mailbox|生产者等待本地 mailbox 新的 buffer 空位就绪。|

### 7.2. Programming Sequence

以生产动作数量和消费动作数量均为1的Queue为例。（Queue_producer: 1 CNT + 1 ENTRY； Queue_consumer: 1 CNT + 1 ENTRY）

_Note_： _alloc_queue()_ 时，硬件通过一笔读数据返回两个 _id_，低 _16bit_ 和高 _16bit_ 分别对应 _producer_cnt_alloc_id_ 和 _consumer_cnt_alloc_id_

- （_rdata={consumer_cnt_alloc_id, producer_cnt_alloc_id}_）

- **alloc_queue:** Read `ALLOC_QUEUE` register（假设consumer_cnt_alloc_id=3, producer_cnt_alloc_id=2）

_Note: only for dynamic allocation, static allocation skip this step_

**set_queue_producer_count:** Write `CNT_INIT` register

- Write_data[7:0].cnt_init_alloc_id= **2**

- Write_data[17:8].cnt_init_threshold= **0** (commit之前，多少个生产动作是不确定的, only for uniq_id configuration)

- Write_data[24:18].cnt_init_config_uniq_id=6 (just for example)

_Note: if it is static allocation, cnt_init_alloc_id_ 为软件分配的 _id;_ 本示例以动态 _alloc_ 进行说明

**set_queue_consumer_count:** Write `CNT_INIT` register

- Write_data[7:0].cnt_init_alloc_id= **3**

- Write_data[17:8].cnt_init_threshold= **0** (release之前，多少个消费动作是不确定的, only for uniq_id configuration)

- Write_data[24:18].cnt_init_config_uniq_id=8 (just for example)

_Note: if it is static allocation, cnt_init_alloc_id_ 为软件分配的 _id;_ 本示例以动态 _alloc_ 进行说明

**register_queue_producer: (part0)** Write `REGISTER_3` register.

- Write_data.notify_info[8:0]=0 (mailbox for example, mbx_id)

- Write_data.notify_info[15:9]=0 (mailbox for example, mbx_uniq_id)

- Write_data.notify_info[20:16]=0 (reserved, mailbox for example)

- Write_data.register_entry_uniq_id= **0** (just for example)

- Write_data.register_last= **0**

- **register_queue_producer:** (part1) Write `REGISTER_3` register.

- Write_data.notify_info[12:0]=0 (reserved, mailbox for example)

- Write_data.notify_info[20:13]=1 (lut_id, mailbox for example)

- Write_data.register_entry_uniq_id=0 (just for example)

- Write_data.register_last= **1**

- **register_queue_consumer: (part0)** Write `REGISTER_2` register.

- Write_data.notify_info[8:0]=0 (mailbox for example, mbx_id)

- Write_data.notify_info[15:9]=0 (mailbox for example, mbx_uniq_id)

- Write_data.notify_info[20:16]=0 (reserved, mailbox for example)

- Write_data.register_entry_uniq_id= **0** (just for example)

- Write_data.register_last= **0**

- **register_queue_consumer:** (part1) Write `REGISTER_2` register.

- Write_data.notify_info[12:0]=0 (reserved, mailbox for example)

- Write_data.notify_info[20:13]=2 (lut_id, mailbox for example)

- Write_data.register_entry_uniq_id=0 (just for example)

- Write_data.register_last= **1**

**set_queue_producer_count:** Write `CNT_INIT` register

- Write_data[7:0].cnt_init_alloc_id= **2**

- Write_data[17:8].cnt_init_threshold= **1** (commit之后，重新配置生产动作数量)

- Write_data[24:18].cnt_init_config_uniq_id=6 (just for example)

**set_queue_consumer_count:** Write `CNT_INIT` register

- Write_data[7:0].cnt_init_alloc_id= **3**

- Write_data[17:8].cnt_init_threshold= **1** (release之后，重新配置消费动作数量)

- Write_data[24:18].cnt_init_config_uniq_id=8 (just for example)

- **advance_write_far:** Write `SIGNAL` register.

- Write_data[9:0].signal_alloc_id= **2** (producer_cnt_alloc_id)

- Write_data[12:10]. **signal_sync_type=4**

- Write_data[22:13].signal_value=1

- Write_data[29:23].signal_uniq_id=6

- **advance_read_far:** Write `SIGNAL` register.

- Write_data[9:0].signal_alloc_id= **3** (consumer_cnt_alloc_id)

- Write_data[12:10]. **signal_sync_type=5**

- Write_data[22:13].signal_value=1

- Write_data[29:23].signal_uniq_id=8

- **unregister_queue_producer** : Write `UNREGISTER` register

- Write_data[7:0].unregister_alloc_id= **3** （consumer_cnt_alloc_id）

- Write_data[17:8].unregister_uniq_id= **0**

- Write_data[20:18].unregister_sync_type=3

**unregister_queue_consumer** : Write `UNREGISTER` register

- Write_data[7:0].unregister_alloc_id= **2** （producer_cnt_alloc_id）

- Write_data[17:8].unregister_uniq_id= **0**

- Write_data[20:18].unregister_sync_type=3

**dealloc_queue:** Write `DEALLOC` register.

- Write_data[7:0].dealloc_id = **2** (producer_cnt_alloc_id)

- Write_data[18:16].dealloc_type =3 (queue synchronization)

_Note: only for dynamic allocation, static allocation skip this step_

#### Note

1. set_queue_producer_count/set_queue_producer_count在commit/release先后配置一次；第一次配置值为0，第二次配置real value；

2. register_queue_producer与consumer CNT关联，故配置的register_alloc_id值为 consumer_cnt_alloc_id

3. register_queue_consumer与producer CNT关联，故配置的register_alloc_id值为 producer_cnt_alloc_id

4. dealloc_queue时配置的dealloc_id值为producer_cnt_alloc_id值；

5. 每次生产动作的数目和消费动作的数目可能是完全动态的

## 8. AtomicInc

仅支持自加 1 的操作，不参与 _VG_ 划分，不支持动态分配。

### 8.1. API

|用户接口API|硬件接口API|
|---|---|
|void atomic_alloc_u32(AtomicUInt32* au32, uint32_t level)|静态分配，无动态硬件申请接口|
|void atomic_free_u32(AtomicUInt32* au32)|静态分配，无动态硬件释放接口|
|uint32_t atomic_read_u32(AtomicUInt32* au32)|val = read_self_incr_mem(level, id)|
|void atomic_inc_u32(AtomicUInt32* au32)|inc_self_incr_mem(level, id)|

硬件仅提供atomic_inc()和atomic_read()功能。

### 8.2. Programming Sequence

以AtomicInc_3（即id=3）为例：

**inc_self_incr_mem:** Write `ATOMICInc_3` register

- Write_data[31:0]=1

**read_self_incr_mem:** Read `ATOMICInc_3` register

rdata为当前计数数值

## 9. Interrupt

中断配置寄存器包括：

- 中断写地址（SP/HOST各自独立）
- 中断写数据（每个中断各自独立）
- 中断MASK（每个中断源各自独立，分别对应1bit；SP/HOST各自独立）

![Interrupt configuration registers](hwsync_programming_guide__hwsync_programming_guide_pdf_0022_18.png)

_Note:_ 中断默认打开，如需关闭，配置SP_INT_MASK、 HOST_INT_MASK 寄存器为 _0xFFFF_。

中断状态及中断LOG寄存器：

![Interrupt status and log registers](hwsync_programming_guide__hwsync_programming_guide_pdf_0023_00.png)

## 10. Debug

1. 异常时，支持HwSync hang住，保护现场。默认出现异常时HwSync不会hang住。配置方式：Write `ERROR_HANG_ENABLE` register。

2. 查询mutex锁状态。每个 `MUTEX_STATUS_x` 寄存器表示连续的32个mutex资源状态。以mutex_33为例：Read `MUTEX_STATUS_1` register，`rdata[1]` 表示mutex_33锁状态；0表示未加锁，1表示已加锁。

3. 查询当前CNT计数值、Uniq_id、当前CNT用于哪种同步语义。Read `CNT_STATIC_ALLOC_x` register：

   - `rdata[31:22]` 表示CNT计数值。
   - `rdata[21:15]` 表示Uniq_id。
   - `rdata[2:0]` 表示同步类型。

4. 查询Context IDLE状态。Read `CTX_IDLE` register，共计16bit，bit[0]~bit[15]分别表示context0-15的IDLE状态。注意，只有有效的（enable）context其IDLE结果是有意义的，对于无效的（未enable的）context，其IDLE结果默认为0。

5. 查询ENTRY资源分配状态。Read `ENTRY_ALLOC_STATUS` register，1表示资源已经被分配。

6. 查询ENTRY的info信息。Write `DEBUG_INDEX` register（该寄存器表示entry_id），2 @ECF_clk后，Read `DEBUG_ENTRY_DATA1` register。

7. 支持Mutex资源的Force Clear（clear Mutex状态；对于动态Mutex资源，不会触发Mutex释放资源）。Write `MUTEX_FORCE_CLEAR_*` register，每个bit对应1个资源。

8. 支持CNT资源的Force Clear（clear CNT计数；对于动态CNT资源，不会触发CNT释放资源）。Write `CNT_FORCE_CLEAR_*` register，每个bit对应1个资源。

## 11. Configuration Constraints

1. VG初始化时，必须按照VG0~VG7顺序依次完成初始化配置

2. 注册Entry的两笔写操作，必须要先写第一笔注册信息（register_last=0），再写第二笔注册信息 （register_last=1）

3. Queue的dealloc传入的id值必须为producer_cnt_id值

## 12. Special R/W Property Registers

以下寄存器为动态配置寄存器，考虑到节省硬件面积，这部分寄存器读返回结果固定为0。

- DEALLOC_MUTEX

- DEALLOC

- CNT_INIT

- SIGNAL

- REGISTER_0~REGISTER_255（L1: 63）

- UNREGISTER

以下寄存器为特殊的读/写寄存器，对它们的读/写访问并不是简单的读/写寄存器行为，而是对应特殊的 command行为。

**MUTEX**

- 读，try lock command，获取mutex锁，返回值表示是否成功。返回结果可能为0/1，与写数据无关

- 写，unlock command，释放mutex锁，写访问不会产生写寄存器行为

**ATOMIC_CNT**

- 写访问对应ATOMIC_CNT自加1 command

**ATOMIC_CNT_CLR**

- 实际为写1清信号，读不到写入结果
