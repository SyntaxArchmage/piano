> Imported material source: `Doc/EFVM IR Specification.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `EFVM IR Specification`.

# EFVM IR Specification

## 2. Introduction

EFVM IR 是基于 LLVM IR 的编译器 IR（中间表示）。EFVM IR 旨在表示 GCU 计算内核（例如 TOPSCC Kernel）。高级语言前端（例如 TOPSCC 编译器前端）可以生成 EFVM IR。TOPSCC 编译器（基于 LLVM）从 EFVM IR 生成汇编代码。

EFVM IR 采用二进制格式，基于 LLVM IR 位码格式的子集。本文档仅使用人类可读的形式来描述 EFVM IR。

从技术角度来看，EFVM IR 是 LLVM IR，并添加了一组规则、限制和约定，以及一组支持的Intrinsic functions。EFVM IR 中指定的程序始终是合法的 LLVM 程序。合法的 LLVM 程序可能不是合法的 EFVM 程序。

## 3. Identifiers

命名全局标识符的名称必须具有以下形式：

```
@[a-zA-Z$_][a-zA-Z$_0-9]*
```

请注意，它不能包含 . 字符。

`[@%]llvm.efvm.*`和`[@%]efvm.*`是保留字。

## 4. EFVM Specific Intrinsic Functions

### 4.1. barrier

barrier 用于执行屏障同步和通信。一个barrier对象的数据格式如下：

| 功能 | 编码宽度 | 描述 |
| --- | --- | --- |
| phase | 1bit | barrier 的状态计数器，用于标识屏障的同步周期 |
| expect_cnt | 15bits | 表示预期到达屏障的线程事务总数 |
| lock | 1bit | mbarrier 的访问控制标志, 用于实现排他性访问，防止多线程同时修改屏障状态 |
| pending_cnt | 15bits | 表示尚未到达屏障的预期线程事务数 |

```
declare <return_type> @llvm.efvm.builtin.barrier.<barrier_scope>.<barrier_mode>([i32 count])
```

- return_type : {i32, void}. 当 barrier_mode 为 arrive.return 时，或者 barrier_mode 为 arrive 且 barrier_scope 为 thread 时，返回类型为 i32，其他情况为 void。
- barrier_scope : {thread, block}
- barrier_mode : {arrive, arrive.return, init, invalid, drop}。其中 arrive 表示做 arrive without return data from remote target 操作；arrive.return 表示做 arrive with return data from remote target 操作；init 表示做 init 操作；invalid 表示做 invalidate 操作；drop 表示做 drop 操作。
- count : 仅当 barrier_mode 为 arrive、arrive.return 或 init 时存在 count 参数。barrier_mode 为 init 时，count 参数用于初始化 expect_cnt 和 pending_cnt；mode 为 arrive 或 arrive.return 时，count 参数用于减少 pending_cnt 的数值。

```
declare i32 @llvm.efvm.builtin.barrier.<barrier_scope>.wait(i32 phase)
```

- barrier_scope : {thread, block}
- phase : the previous return phase

以上是built-in barrier，由硬件管理barrier地址，无需提供barrier地址参数。

```
declare <return_type> @llvm.efvm.barrier.<barrier_scope>.<barrier_mode> (i8 addrspace(<n>)* bar [，i32 count])
```

- return_type : {i32, void} 当barrier_mode为arrive.return时，或者barrier_mode为arrive且barrier_scope为thread时，返回类型为i32，其他情况为void。
- barrier_scope : {thread, block}
- barrier_mode : {arrive, arrive.return, init, invalid, drop}。其中arrive表示做arrive without return data from remote target操作。arrive.return表示做arrive with return data from remote target操作。init表示做init操作。invalid表示做invalidate操作。drop表示做drop操作。
- n : {3, 9}. 与barrier_scope对应，如果barrier_scope为block，则n为3表示shared地址空间，barrier_scope为thread则n为9表示local地址空间
- bar : barrier 地址
- count : 仅当barrier_mode为arrive或arrive.return或init的时候存在count参数。barrier mode为init时，count参数用于初始化expect_cnt和pending_cnt，mode为arrive或arrive.return时，count参数用于减少pending_cnt的数值。

```
declare i32 @llvm.efvm.barrier.<barrier_scope>.wait(i8 addrspace(n)* bar, i32 phase)
```

- barrier_scope : {thread, block}
- n : {3, 9}. 与barrier_scope对应，如果barrier_scope为block，则n为3表示shared地址空间，barrier_scope为thread则n为9表示local地址空间
- bar : barrier 地址
- phase : the previous return phase

以上是非built-in barrier，由软件管理barrier地址，因此多一个barrier地址参数。

### 4.2. memory barrier

memory barrier是一种同步机制，用于确保内存操作的顺序性和可见性。
一个mbarrier对象的数据格式如下：

| it63 | it62 | it61 | it 60:41 | it 40:21 | it 20:0 |
| --- | --- | --- | --- | --- | --- |
| phase | 1'b0 | lock | pending_cnt | expect_cnt | tx_cnt |

- phase : mbarrier 的状态计数器，用于标识屏障的同步周期
- expect_cnt : 表示预期到达屏障的线程事务总数
- lock : mbarrier 的访问控制标志, 用于实现排他性访问，防止多线程同时修改屏障状态
- pending_cnt: 表示尚未到达屏障的预期线程事务数
- tx_cnt : 记录已经到达屏障并完成提交的线程事务数量

```
declare void @llvm.efvm.mbarrier.init<scope>(i8 addrspace(<n>)* mbar, i32 count)
```

"llvm.efvm.mbarrier.init*" 用于初始化mbarrier对象。

- scope : {"", .local, .shared}. 其中 ""表示未限制scope，".local"表示mbarrier的scope为local,".shared"表示mbarrier的scope为shared
- n : {0, 3, 9}. 与scope对应，当scope为“”时n为0表示可以为任意地址空间，当scope为.shared时n为3表示shared地址空间，当scope为.local时n为9表示local地址空间
- mbar : mbarrier 地址
- count : 用于初始化expect_cnt和pending_cnt, 有效范围为[0, 2^20 - 1]

```
declare void @llvm.efvm.mbarrier.inval<scope>(i8 addrspace(<n>)* mbar>)
```

"llvm.efvm.mbarrier.inval*" 用于使mbarrier对象无效。

- scope : {"", .local, .shared}. 其中 ""表示未限制scope，".local"表示mbarrier的scope为local,".shared"表示mbarrier的scope为shared
- n : {0, 3, 9}. 与scope对应，当scope为“”时n为0表示可以为任意地址空间，当scope为.shared时n为3表示shared地址空间，当scope为.local时n为9表示local地址空间
- mbar : mbarrier 地址

```
declare void @llvm.efvm.mbarrier.expect.tx<scope>(i8 addrspace(<n>)* mbar, i32 count)
```

"llvm.efvm.mbarrier.expect.tx*" 用于对mbarrier对象执行expect-tx操作。

- scope : {"", .local, .shared}. 其中 ""表示未限制scope，".local"表示mbarrier的scope为local,".shared"表示mbarrier的scope为shared
- n : {0, 3, 9}. 与scope对应，当scope为“”时n为0表示可以为任意地址空间，当scope为.shared时n为3表示shared地址空间，当scope为.local时n为9表示local地址空间
- mbar : mbarrier 地址
- count : 用于增加tx_cnt的数值, 有效范围为[0, 2^20 - 1]

```
declare void @llvm.efvm.mbarrier.complete.tx<scope>(i8 addrspace(<n>)* mbar, i32 count)
```

"llvm.efvm.mbarrier.complete.tx*" 用于对mbarrier对象执行complete-tx操作。

- scope : {"", .local, .shared}. 其中 ""表示未限制scope，".local"表示mbarrier的scope为local,".shared"表示mbarrier的scope为shared
- n : {0, 3, 9}. 与scope对应，当scope为“”时n为0表示可以为任意地址空间，当scope为.shared时n为3表示shared地址空间，当scope为.local时n为9表示local地址空间
- mbar : mbarrier 地址
- count : 用于减少tx_cnt的数值, 有效范围为[0, 2^20 - 1]

```
declare i64 @llvm.efvm.mbarrier.arrive<scope>(i8 addrspace(<n>)* mbar, i32 count)
```

"llvm.efvm.mbarrier.arrive*" 用于对mbarrier对象执行arrive-on操作。

- scope : {"", .local, .shared}. 其中 ""表示未限制scope，".local"表示mbarrier的scope为local,".shared"表示mbarrier的scope为shared
- n : {0, 3, 9}. 与scope对应，当scope为“”时n为0表示可以为任意地址空间，当scope为.shared时n为3表示shared地址空间，当scope为.local时n为9表示local地址空间
- mbar : mbarrier 地址
- count : 用于减少pending_cnt的数值, 有效范围为[0, 2^20 - 1]

```
declare i64 @llvm.efvm.mbarrier.arrive.expect.tx<scope>(i8 addrspace(<n>)* mbar, i32 txCount)
```

带有.expect.tx限定符的mbarrier.arrier在arrive-on操作执行之前执行expect_tx操作，txCount指定expect_tx操作的参数。同时对mbarrier object的pending_cnt的运算变更为减去1。

- scope : {"", .local, .shared}. 其中 ""表示未限制scope，".local"表示mbarrier的scope为local,".shared"表示mbarrier的scope为shared
- n : {0, 3, 9}. 与scope对应，当scope为“”时n为0表示可以为任意地址空间，当scope为.shared时n为3表示shared地址空间，当scope为.local时n为9表示local地址空间
- mbar : mbarrier 地址
- txCount : 用于增加tx_cnt的数值, 有效范围为[0, 2^20 - 1]

```
declare i64 @llvm.efvm.mbarrier.arrive.noComplete<scope>(i8 addrspace(<n>)* mbar, i32 count)
```

带有.noComplete限定符的mbarrier.arrier在arrive-on操作执行后，当前phase要求不能结束，否则将导致不可预期的结果。

- scope : {"", .local, .shared}. 其中 ""表示未限制scope，".local"表示mbarrier的scope为local,".shared"表示mbarrier的scope为shared
- n : {0, 3, 9}. 与scope对应，当scope为“”时n为0表示可以为任意地址空间，当scope为.shared时n为3表示shared地址空间，当scope为.local时n为9表示local地址空间
- mbar : mbarrier 地址
- count : 用于减少pending_cnt的数值, 有效范围为[0, 2^20 - 1]

```
declare i64 @llvm.efvm.mbarrier.arrive.drop<scope>(i8 addrspace(<n>)* mbar, i32 count)
```

带有.drop限定符的mbarrier.arrier表示线程在arrive-on操作后立即退出mbarrier的同步组。

- scope : {"", .local, .shared}. 其中 ""表示未限制scope，".local"表示mbarrier的scope为local,".shared"表示mbarrier的scope为shared
- n : {0, 3, 9}. 与scope对应，当scope为“”时n为0表示可以为任意地址空间，当scope为.shared时n为3表示shared地址空间，当scope为.local时n为9表示local地址空间
- mbar : mbarrier 地址
- count : 用于减少expect_cnt的数值, 有效范围为[0, 2^20 - 1]

```
declare i64 @llvm.efvm.mbarrier.arrive.drop.expect.tx(i8 addrspace(<n>)* mbar, i32 txCount)
```

带有.drop.expect.tx限定符的mbarrier.arrive表示线程在arrive-on操作后立即退出mbarrier的同步组。同时对mbarrier object的expect_cnt的运算变更为减去1。

- scope : {"", .local, .shared}. 其中 ""表示未限制scope，".local"表示mbarrier的scope为local,".shared"表示mbarrier的scope为shared
- n : {0, 3, 9}. 与scope对应，当scope为“”时n为0表示可以为任意地址空间，当scope为.shared时n为3表示shared地址空间，当scope为.local时n为9表示local地址空间
- mbar : mbarrier 地址
- txCount: 用于增加tx_cnt的数值, 有效范围为[0, 2^20 - 1]

```
declare i64 @llvm.efvm.mbarrier.arrive.drop.noComplete(i8 addrspace(<n>)* mbar, i32 count)
```

带有.drop.noComplete限定符的mbarrier.arrive操作不得导致mbarrier完成其当前phase，且线程在arrive-on操作后立即退出mbarrier的同步组。

- scope : {"", .local, .shared}. 其中 ""表示未限制scope，".local"表示mbarrier的scope为local,".shared"表示mbarrier的scope为shared
- n : {0, 3, 9}. 与scope对应，当scope为“”时n为0表示可以为任意地址空间，当scope为.shared时n为3表示shared地址空间，当scope为.local时n为9表示local地址空间
- mbar : mbarrier 地址
- count : 用于减少pending_cnt的数值, 有效范围为[0, 2^20 - 1]

```
declare i32 @llvm.efvm.mbarrier.pending.count(i64 state)
```

"llvm.efvm.mbarrier.pending.count" 从mbarrier 状态信息查询待处理的到达计数。

- state: mbarrier 状态信息

```
declare i32 @llvm.efvm.mbarrier.test.wait<scope>(i8 addrspace(<n>)* mbar, i64 state)
```

"llvm.efvm.mbarrier.test.wait*" 等待mbarrier对象完成其当前phase，输入参数是state。

- scope : {"", .local, .shared}. 其中 ""表示未限制scope，".local"表示mbarrier的scope为local,".shared"表示mbarrier的scope为shared
- n : {0, 3, 9}. 与scope对应，当scope为“”时n为0表示可以为任意地址空间，当scope为.shared时n为3表示shared地址空间，当scope为.local时n为9表示local地址空间
- mbar : mbarrier 地址
- state : mbarrier 状态信息，来自于前序arrive操作返回结果。

```
declare i32 @llvm.efvm.mbarrier.test.wait<scope>.parity(i8 addrspace(<n>)* mbar, i32 phaseParity)
```

与"llvm.efvm.mbarrier.test.wait*.parity" 等待mbarrier对象完成其当前phase，输入参数是phaseParity。

- scope : {"", .local, .shared}. 其中 ""表示未限制scope，".local"表示mbarrier的scope为local,".shared"表示mbarrier的scope为shared
- n : {0, 3, 9}. 与scope对应，当scope为“”时n为0表示可以为任意地址空间，当scope为.shared时n为3表示shared地址空间，当scope为.local时n为9表示local地址空间
- mbar : mbarrier 地址
- phaseParity : 表征为当前phase的极性，有效值是0或者1，表示当前phase属于奇数还是偶数。

### 4.3. Data Movement

```
declare void @llvm.efvm.cp.async.g2l.<dst_size>（i8 addrspace(3)* dstMem, i8 addrspace(1)* srcMem, i32 mode, ...)
```

"llvm.efvm.cp.async.g2l*" 支持将数据从全局内存复制到本地内存，总共128组数据复制。

- dst_size : {4, 8, 16, 32}. 每组复制的目的size, 可以为4/8/16/32字节
- dstMem : 其bits[47:0]为目的地址, bits[52:48]为swizzle_mode
- srcMem : 其bits[47:0]为源地址
- mode : 32bit掩码，用于设置可配置域：llc_alo_pri, hw_pf，cop_ld，ignore_src
- ... ： 可变参数，可以有0~2个额外参数： src_size：{4，8，16，32}. src_size必须小于等于dst_size，如果不指定src_size则src_size等于dst_size mask : 条件复制掩码，类型为<128 x i1>。如果未指定则为无条件复制 当src_size和mask同时存在时，有先后顺序，src_size在mask的前面

```
declare void @llvm.efvm.cp.async.stride.g2l.<dst_size>（i8 addrspace(3)* dstMem, i8 addrspace(1)* srcMem, i32 dst_stride, i32 src_stride, i32 mode, ...)
```

"llvm.efvm.cp.async.stride.g2l*" 与"llvm.efvm.cp.async.g2l.*" 相似，区别是 "llvm.efvm.cp.async.stride.g2l*"多两个参数dst_stride和str_stride，执行stride内存复制操作。

- dst_size : {4, 8, 16, 32}. 每组复制的目的size, 可以为4/8/16/32字节
- dstMem : 其bits[47:0]为目的地址, bits[52:48]为swizzle_mode
- srcMem : 其bits[47:0]为源地址
- dst_stride : 目的数据元素之间的间隔
- src_stride : 源数据元素之间的间隔
- mode : 32bit掩码，用于设置可配置域：llc_alo_pri, hw_pf，cop_ld，ignore_src
- ... ： 可变参数，可以有0~2个额外参数： src_size: {4，8，16，32}. src_size 必须小于等于dst_size，如果不指定src_size则src_size等于dst_size mask : 条件复制掩码，类型为<128 x i1>。如果未指定则为无条件复制 当src_size和mask同时存在时，有先后顺序，src_size在mask的前面

```
declare void @llvm.efvm.cp.async.gs.g2l.<dst_size>（i8 addrspace(3)* dstMem, i8 addrspace(1)* srcMem, <128 x i64> dst_stride, <128 x i64> src_stride, i32 mode, ...)
```

"llvm.efvm.cp.async.gs.g2l*" 与 "llvm.efvm.cp.async.stride.g2l.*" 相似，区别是 "llvm.efvm.cp.async.gs.g2l*"的dst_stride 和 src_stride 参数类型都是 <128 x i64>, 并且可变参数src_size 类型是 <128 x i32>。

- dst_size : {4, 8, 16, 32}. 每组复制的目的size, 可以为4/8/16/32字节
- dstMem : 其bits[47:0]为目的地址, bits[52:48]为swizzle_mode
- srcMem : 其bits[47:0]为源地址
- dst_stride : 目的数据元素之间的间隔
- src_stride : 源数据元素之间的间隔
- mode : 32bit掩码，用于设置可配置域：llc_alo_pri, hw_pf，cop_ld，ignore_src
- ... ： 可变参数，可以有0~2个额外参数： src_size : 类型为<128 x i32>, src_size每个元素都必须小于等于dst_size，如果不指定src_size则src_size等于dst_size mask : 条件复制掩码，类型为<128 x i1>。如果未指定则为无条件复制 当src_size和mask同时存在时，有先后顺序，src_size在mask的前面

```
declare void @llvm.efvm.cp.async.gs32.g2l.<dst_size>（i8 addrspace(3)* dstMem, i8 addrspace(1)* srcMem, <128 x i32> dst_stride, <128 x i32> src_stride, i32 mode, ...)
```

"llvm.efvm.cp.async.gs32.g2l*" 与 "llvm.efvm.cp.async.gs.g2l.*"相似，区别是 "llvm.efvm.cp.async.gs32.g2l*" 的dst_stride 和 src_stride 参数类型都是 <128 x i32>。

- dst_size : {4, 8, 16, 32}. 每组复制的目的size, 可以为4/8/16/32字节
- dstMem : 其bits[47:0]为目的地址, bits[52:48]为swizzle_mode
- srcMem : 其bits[47:0]为源地址
- dst_stride : 目的数据元素之间的间隔
- src_stride : 源数据元素之间的间隔
- mode : 32bit掩码，用于设置可配置域：llc_alo_pri, hw_pf，cop_ld，ignore_src
- ... ： 可变参数，可以有0~2个额外参数： src_size : 类型为<128 x i32>, src_size每个元素都必须小于等于dst_size，如果不指定src_size则src_size等于dst_size mask : 条件复制掩码，类型为<128 x i1>。如果未指定则为无条件复制 当src_size和mask同时存在时，有先后顺序，src_size在mask的前面

```
declare void @llvm.efvm.cp.async.bulk.<dir_type><notify>（i8 addrspace(<m>)* dstMem, i8 addrspace(<n>)* srcMem, i32 size, i32 mode [，i8 addrspace(<m>)* mbar, i32 complete_tx_count, i32 multicast_mask, i32 multicast_en]）
```

"llvm.efvm.cp.async.bulk*" 启动从源地址操作数srcMem指定的位置到目标地址操作数dstMem指定位置的异步批量复制操作。

- dir_type: {g2l, l2g, l2s, l2l, s2l, g2s}
- notify : {"", .mbarrier-hwcnt, .mbarrier-swcnt}
- n和m：分别修饰source和dest地址空间，与dir_type对应，dir_type为g2l则{n:m}为{1:9}, dir_type为l2g则{n:m}为{9:1}, dir_type为l2s则{n:m}为{9:3}, dir_type为l2l则{n:m}为 {9:9} , dir_type为s2l则{n:m}为 {3:9}, dir_type为g2s则{n:m}为 {1:3}. 1表示global地址空间，3表示shared地址空间，9表示local地址空间。
- dstMem : 其bits[47:0]为目的地址, bits[52:48]为dst swizzle_mode
- srcMem : 其bits[47:0]为源地址, bits[52:48]为src swizzle_mode
- size : 复制的bytes数，最大size为2^24 - 1
- mode : 32bit掩码，用于设置可配置域 : llc_alo_pri, hw_pf，esl_order, cop_st，cop_ld
- mbar : mbarrier地址，只有当notify不为""时存在该参数
- complete_tx_count : 只有当notify为.mbarrier-swcnt时存在该参数
- multicast_mask : 只有当dir_type为g2s时存在该参数。支持multicast到同一个block内多个thread的local memory的同样的local memory。 每个位对应于同一块中的一个线程。位值1表示将对相应线程执行广播写入。如果多播向量全为零，则默认情况下只写入当前线程，不执行广播。如果广播使能，且notify机制为mbarrier，那么被广播的所有thread的相同thread local memory offset的mbarrier也会被广播更新
- multicast_en : {0, 1, 2, 3}. 只有当dir_type为g2s时存在该参数, 用于配置data_multicast_en和mbar_multicast_en, multicast_en为0表示data_multicast_en和mbar_multicast_en都为0, multicast_en为3表示data_multicast_en和mbar_multicast_en都为1, multicast_en为1表示mbar_multicast_en为1而data_multicast_en为0, multicast_en为2表示mbar_multicast_en为0而data_multicast_en为1.

```
declare void @llvm.efvm.memset.<dir_type><notify>（i8 addrspace(<n>)* dstMem, srcValue, i32 size, i32 mode [，i8 addrspace(<n>)* mbar, i32 complete_tx_count, i32 multicast_mask, i32 multicast_en]）
```

"llvm.efvm.memset*" 将源操作数srcValue写入到目标地址操作数dstMem指定的位置。

- dir_type: {2g, 2l, 2s}
- notify : {"", .mbarrier-hwcnt, .mbarrier-swcnt}
- n：{1, 3, 9}. 修饰dest地址空间， dir_type为2g时n为1表示global地址空间，dir_type为2s时n为3表示shared地址空间，dir_type为2l时n为9表示local地址空间。
- dstMem : 其bits[47:0]为目的地址, bits[52:48]为dst swizzle_mode
- srcValue : 源数据
- size : 写入的bytes数，最大size为2^24 - 1
- mode : 32bit掩码，用于设置可配置域 : llc_alo_pri, esl_order, cop_st
- mbar : mbarrier地址，只有当notify不为""时存在该参数
- complete_tx_count : 只有当notify为.mbarrier-swcnt时存在该参数
- multicast_mask : 只有当dir_type为g2s时存在该参数。支持multicast到同一个block内多个thread的local memory的同样的local memory。 每个位对应于同一块中的一个线程。位值1表示将对相应线程执行广播写入。如果多播向量全为零，则默认情况下只写入当前线程，不执行广播。如果广播使能，且notify机制为mbarrier，那么被广播的所有thread的相同thread local memory offset的mbarrier也会被广播更新
- multicast_en : {0, 1, 2, 3}. 只有当dir_type为g2s时存在该参数, 用于配置data_multicast_en和mbar_multicast_en, multicast_en为0表示data_multicast_en和mbar_multicast_en都为0, multicast_en为3表示data_multicast_en和mbar_multicast_en都为1, multicast_en为1表示mbar_multicast_en为1而data_multicast_en为0, multicast_en为2表示mbar_multicast_en为0而data_multicast_en为1.

```
declare void @llvm.efvm.cp.async.bulk.<dir_type><notify>.reduce.<redOp>.<type> (i8 addrspace(<m>)* dstMem, i8 addrspace(<n>)* srcMem, i32 size, i32 mode [，i8 addrspace(<m>)* mbar, i32 complete_tx_count, i32 multicast_mask, i32 multicast_en]）
```

"llvm.efvm.cp.async.bulk.*.reduce*" 对目标地址操作数dstMem指定的内存位置数组和源地址操作数srcMem指定位置的源数组发起异步reduce操作。源数组和目标数组的大小必须相同，并且由操作数大小指定。

- dir_type : {g2l, l2g, l2s, l2l, s2l, g2s}
- notify : {"", .mbarrier-hwcnt, .mbarrier-swcnt}.
- redOp & type: {{add: "s16", "u16", "s32", "u32","s64", "u64", "f16", "bf16", "f32"}, {and: "s32", "u32","s64", "u64"}, {or: "s32", "u32","s64", "u64"}, {xor: "s32", "u32","s64", "u64"}, {max: "s32", "u32","s64", "u64", "f16", "bf16", "f32"}, {maxnum: "s32", "u32","s64", "u64", "f16", "bf16", "f32"}, {min: "s32", "u32","s64", "u64"}, {inc: "u32", "u64"}, {dec: "u32", "u64"}}
- n和m：分别修饰source和dest地址空间，与dir_type对应，dir_type为g2l则{n:m}为{1:9}, dir_type为l2g则{n:m}为{9:1}, dir_type为l2s则{n:m}为{9:3}, dir_type为l2l则{n:m}为 {9:9} , dir_type为s2l则{n:m}为 {3:9}, dir_type为g2s则{n:m}为 {1:3}. 1表示global地址空间，3表示shared地址空间，9表示local地址空间。
- dstMem : 其bits[47:0]为目的地址, bits[52:48]为dst swizzle_mode
- srcMem : 其bits[47:0]为源地址, bits[52:48]为src swizzle_mode
- size : 复制的bytes数，最大size为2^24 - 1
- mode : 32bit掩码，用于设置可配置域 : llc_alo_pri, satfinite, esl_order, cop_st，cop_ld。satfinite只有在redOp为add操作时使能且仅对浮点类型有效
- mbar : mbarrier地址，只有当notify不为""时存在该参数
- complete_tx_count : 只有当notify为.mbarrier-swcnt时存在该参数
- multicast_mask : 只有当dir_type为g2s时存在该参数。支持multicast到同一个block内多个thread的local memory的同样的local memory。 每个位对应于同一块中的一个线程。位值1表示将对相应线程执行广播写入。如果多播向量全为零，则默认情况下只写入当前线程，不执行广播。如果广播使能，且notify机制为mbarrier，那么被广播的所有thread的相同thread local memory offset的mbarrier也会被广播更新
- multicast_en : {0, 1, 2, 3}. 只有当dir_type为g2s时存在该参数, 用于配置data_multicast_en和mbar_multicast_en, multicast_en为0表示data_multicast_en和mbar_multicast_en都为0, multicast_en为3表示data_multicast_en和mbar_multicast_en都为1, multicast_en为1表示mbar_multicast_en为1而data_multicast_en为0, multicast_en为2表示mbar_multicast_en为0而data_multicast_en为1.

```
declare void @llvm.efvm.cp.async.bulk.tensor.<dir_type><notify>.<dim>(i8 addrspace(<n>)* tile_addr, i8 addrspace(0)* tensormap, i32 mode, i32 d0~di [，i8 addrspace(<m>)* mbar, i32 complete_tx_count, i32 multicast_mask, i32 multicast_en]）
```

"llvm.efvm.cp.async.bulk.tensor*" 启动从一个space到另一个space的异步复制张量数据操作。

- dir_type: {g2l, l2g, l2l, g2s}
- notify : {"", .mbarrier-hwcnt, .mbarrier-swcnt}
- dim : {1d, 2d, 3d, 4d, 5d}
- n ：tile_addr的地址空间。与dir_type对应，当dir_type为g2l, l2g, l2l时，n为9表示local地址空间，当dir_type为g2s时，n为3表示shared地址空间。
- tile_addr: the tile address
- tensormap: the generic address of the tensormap object
- mode : 32bit掩码，用于设置可配置域 : llc_alo_pri, hw_pf, src_tens_sel, esl_order, cop_st，cop_ld。src_tens_sel只有在dir_type为l2l时使能
- d0~di: 根据dim的值，如果是1d，则为"i32 d0"。如果是2d则为"i32 d0，i32 d1"。如果是3d，则为"i32 d0，i32 d1，i32 d2"。如果是4d则为"i32 d0，i32 d1，i32 d2，i32 d3"。如果是5d则为"i32 d0，i32 d1，i32 d2，i32 d3，i32 d4"。
- m: mbar的地址空间。当dir_type为g2l, l2l时，m为9表示local地址空间。当dir_type为g2s时，m为3表示shared地址空间。当dir_type为l2g时，m为1表示global地址空间。
- mbar : mbarrier地址，只有当notify不为""时存在该参数
- complete_tx_count : 只有当notify为.mbarrier-swcnt时存在该参数
- multicast_mask : 只有当dir_type为g2s时存在该参数。支持multicast到同一个block内多个thread的local memory的同样的local memory。 每个位对应于同一块中的一个线程。位值1表示将对相应线程执行广播写入。如果多播向量全为零，则默认情况下只写入当前线程，不执行广播。如果广播使能，且notify机制为mbarrier，那么被广播的所有thread的相同thread local memory offset的mbarrier也会被广播更新
- multicast_en : {0, 1, 2, 3}. 只有当dir_type为g2s时存在该参数, 用于配置data_multicast_en和mbar_multicast_en, multicast_en为0表示data_multicast_en和mbar_multicast_en都为0, multicast_en为3表示data_multicast_en和mbar_multicast_en都为1, multicast_en为1表示mbar_multicast_en为1而data_multicast_en为0, multicast_en为2表示mbar_multicast_en为0而data_multicast_en为1.

```
llvm.efvm.cp.async.bulk.tensor.<dir_type><notify>.reduce.<redOp>.<dim>(i8 addrspace(<n>)* tile_addr, i8 addrspace(0)* tensormap, i32 size, i32 mode, i32 d0~di [，i8 addrspace(<m>)* mbar, i32 complete_tx_count, i32 multicast_mask, i32 multicast_en]）
```

"llvm.efvm.cp.async.bulk.tensor.*.reduce*" 启动张量数据的异步reduce操作。

- dir_type: {g2l, l2g, l2l, g2s}
- notify : {"", .mbarrier-hwcnt, .mbarrier-swcnt}
- redOp : {add, and, or, xor, max, maxnum, min, inc, dec}
- dim : {1d, 2d, 3d, 4d, 5d}
- n ：tile_addr的地址空间。与dir_type对应，当dir_type为g2l, l2g, l2l时，n为9表示local地址空间，当dir_type为g2s时，n为3表示shared地址空间。
- tile_addr: the tile address
- tensormap: the generic address of the tensormap object
- mode : 32bit掩码，用于设置可配置域 : llc_alo_pri, hw_pf, satfinite, src_tens_sel, esl_order, cop_st，cop_ld. src_tens_sel只有在dir_type为l2l时使能。satfinite只有在redOp为add操作时使能且仅对浮点类型有效
- d0~di: 根据dim的值，如果是1d，则为"i32 d0"。如果是2d则为"i32 d0，i32 d1"。如果是3d，则为"i32 d0，i32 d1，i32 d2"。如果是4d则为"i32 d0，i32 d1，i32 d2，i32 d3"。如果是5d则为"i32 d0，i32 d1，i32 d2，i32 d3，i32 d4"。
- m: mbar的地址空间。当dir_type为g2l, l2l时，m为9表示local地址空间。当dir_type为g2s时，m为3表示shared地址空间。当dir_type为l2g时，m为1表示global地址空间。
- mbar : mbarrier地址，只有当notify不为""时存在该参数
- complete_tx_count : 只有当notify为.mbarrier-swcnt时存在该参数
- multicast_mask : 只有当dir_type为g2s时存在该参数。支持multicast到同一个block内多个thread的local memory的同样的local memory。 每个位对应于同一块中的一个线程。位值1表示将对相应线程执行广播写入。如果多播向量全为零，则默认情况下只写入当前线程，不执行广播。如果广播使能，且notify机制为mbarrier，那么被广播的所有thread的相同thread local memory offset的mbarrier也会被广播更新
- multicast_en : {0, 1, 2, 3}. 只有当dir_type为g2s时存在该参数, 用于配置data_multicast_en和mbar_multicast_en, multicast_en为0表示data_multicast_en和mbar_multicast_en都为0, multicast_en为3表示data_multicast_en和mbar_multicast_en都为1, multicast_en为1表示mbar_multicast_en为1而data_multicast_en为0, multicast_en为2表示mbar_multicast_en为0而data_multicast_en为1.

```
declare void @llvm.efvm.dte.mbarrier.arrive<drop><scope>(i8 addrspace(<n>)* mbar, i32 count[, i32 multicast_mask])
```

"llvm.efvm.cp.async.mbarrier.arrive*"用于异步的检査并等待当前GCU sub-thread所有前序DTE类型指令是否已经完成，如果完成，则结束等待，并向指定的位置上的mbarrier对象发送mbarrier arrive-on操作。

- drop : {"", .drop}. ：如果是.drop, 对mbarrier object的count of expected arrivals字段，减去参数count
- scope : {"", .local, .shared}. 其中 ""表示未限制scope，".local"表示mbarrier的scope为local,".shared"表示mbarrier的scope为shared
- n : {0, 3, 9}. 与scope对应，当scope为“”时n为0表示可以为任意地址空间，当scope为.shared时n为3表示shared地址空间，当scope为.local时n为9表示local地址空间
- mbar : mbarrier 地址
- count : 用于减少pending_cnt的数值, 有效范围为[0, 2^20 - 1]
- multicast_mask : 当scope为.shared时才有该参数，定义了multicast vector mask, 用于对block内的thread做multicast arrive操作

```
declare void @llvm.efvm.<async_instype>.commit.group()
```

"llvm.efvm.*.commit.group"用于创建新的async group，并将所有前序未分组指令，统一归类到该group。针对不同类型的异步指令，需要由async_instype域来指定选择对应的group。例如如果该域指定是cp.async类型，则将把所有的前序未分组cp.async类型指令归类到cp.async async-group。

- async_instype : {cp.async, cp.async.bulk, wgmma}

```
declare void @llvm.efvm.<async_instype>.wait.group(i32 n)
```

"llvm.efvm.*.wait.group"用于等待先前异步操作的完成。针对不同类型的异步指令，需要由指令async_instype域来指定选择对应的group。例如如果该域指定是cp.async类型，则将把所有的前序未分组cp.async类型指令归类到cp.async async-group。

- async_instype : {cp.async, cp.async.bulk, wgmma}
- n : 表示将等待前序第n个以及更老的所有group内所有指令执行完成。当n=0时, 则代表所有group均需等待。

```
declare void @llvm.efvm.cp.async.wait.all()
```

cp.async.wait_all 等效于:

cp.async.commit_group() 和cp.async.wait_group(0)

### 4.4. MALU

特殊说明：

1. MALU 指令的ftz_output和ftz_input可配置域，只提供一个ftz参数来配置，用户通过接口配置的ftz_output和ftz_input是相同的，不提供独立配置ftz_output和ftz_input的接口。
2. 没有直接暴露接口的域有几下几个：lane_mode、stage、path_mode，vm/vm_idx。lane_mode、stage，path_mode由于用户不感知无需暴露接口，vm/vm_idx域不单独提供接口，用户可以结合vsel intrinsic function api来配置vm/vm_idx域。
3. 需要暴露可配置域的指令，其封装的intrinsic function都提供了32 bits 掩码参数给用户设置可配置域，该参数不是可变参数，需要用户显示传参。
4. 如果intrinsic function未明确说明指令的哪些域没有在接口中暴露出来，则表明指令除了第2点提到的不暴露的域，其他所有可配置域全部通过接口暴露给用户了。
5. 如果intrinsic function未明确说明设计有动态开销，则表明无动态开销。

#### Type Conversion

特殊Type conversion：MOP.CVT.F32toI32_SP指令专用于lane_coord计算，用内建变量（类似于threadIdx.{x,y,z}）的方式提供访问接口，不对外暴露它的intrinsic function API。

```
declare <dstty> @llvm.efvm.cvt.<cvt_sign>(<srcty> src, int mode)
```

"llvm.efvm.cvt*"用于对向量数据做类型转换。

- dstty: {<512 x i8>, <256 x i16>, <128 x i32>, <64 x i64>, <256 x half>, <256 x bfloat>, <128 x float>, <512 x f8e4m3>, <512 x f8e5m2>, <512 x ue8m0>, <512 x f6e2m3>, <1024 x fp4e2m1>, <1024 x i4>, <1024 x i8>, <512 x i16>, <256 x i32>, <128 x i64>, <512 x half>, <512 x bfloat>, <256 x float>, <1024 x f8e4m3>, <1024 x f8e5m2>, <1024 x ue8m0>, <1024 x f6e2m3>, <2048 x fp4e2m1>, <2048 x i4>, <2048 x i8>, <1024 x i16>, <512 x i32>, <256 x i64>, <1024 x half>, <1024 x bfloat>, <512 x float>, <2048 x f8e4m3>, <2048 x f8e5m2>, <2048 x ue8m0>, <2048 x f6e2m3>, <4096 x fp4e2m1>, <4096 x i4>, <4096 x i8>, <2048 x i16>, <1024 x i32>, <512 x i64>, <2048 x half>, <2048 x bfloat>, <1024 x float>, <4096 x f8e4m3>, <4096 x f8e5m2>, <4096 x ue8m0>, <4096 x f6e2m3>, <4096 x i16>, <2048 x i32>, <1024 x i64>, <4096 x half>, <4096 x bfloat>, <2048 x float>, <4096 x i32>, <2048 x i64>, <4096 x float}。srcty和dstty的element个数一样。
- cvt_sign : {ss, su, us, uu, sf, fs, ff, uf, fu}，其中s表示signed, u表示unsigned, f表示floating-point。ss表示signed to signed, su表示signed to unsigned, us表示unsigned to signed, uu表示unsigned to unsigned, sf表示signed to float, fs表示float to signed, ff表示float to float，uf表示unsigned to float，fu表示float to unsigned。
- srcty: {<512 x i8>, <256 x i16>, <128 x i32>, <64 x i64>, <256 x half>, <256 x bfloat>, <128 x float>, <512 x f8e4m3>, <512 x f8e5m2>, <512 x ue8m0>, <512 x f6e2m3>, <1024 x fp4e2m1>, <1024 x i4>, <1024 x i8>, <512 x i16>, <256 x i32>, <128 x i64>, <512 x half>, <512 x bfloat>, <256 x float>, <1024 x f8e4m3>, <1024 x f8e5m2>, <1024 x ue8m0>, <1024 x f6e2m3>, <2048 x fp4e2m1>, <2048 x i4>, <2048 x i8>, <1024 x i16>, <512 x i32>, <256 x i64>, <1024 x half>, <1024 x bfloat>, <512 x float>, <2048 x f8e4m3>, <2048 x f8e5m2>, <2048 x ue8m0>, <2048 x f6e2m3>, <4096 x fp4e2m1>, <4096 x i4>, <4096 x i8>, <2048 x i16>, <1024 x i32>, <512 x i64>, <2048 x half>, <2048 x bfloat>, <1024 x float>, <4096 x f8e4m3>, <4096 x f8e5m2>, <4096 x ue8m0>, <4096 x f6e2m3>, <4096 x i16>, <2048 x i32>, <1024 x i64>, <4096 x half>, <4096 x bfloat>, <2048 x float>, <4096 x i32>, <2048 x i64>, <4096 x float}。srcty和dstty的element个数一样。
- mode: 32bit掩码，用于设置可配置域：relu, round, ftz, sat, satfinite, rhau, clamp_int8。 其中当dstty的element为i8且cvt_sign为ss、us或者fs时（即目的值为signed 8bits整型），可配置的域有：clamp_int8、sat、ftz和round。 当dstty element为整型且非signed 8bits整型时，可配置的域有：sat、ftz、round。 当dstty的element {f16|bf16|f32}时，可配置的域有：relu、satfinite、sat、ftz、round。 当dstty的element为{f8e4m3|f8e5m2|ue8m0|f6e2m3|f4e2m1}时，可配置的域有：relu、satfinite、ftz、round、rhau。

```
      |     名称    |                         取值                               |
      |------------ |----------------------------------------------------       |
      | `relu`      | TAR_RELU(1 << 3)                                          |
      | `round`     | RND_EVEN(0)   RND_ZERO(1)  RND_PINF(2)  RND_NINF(3)       |
      | `ftz`       | FTZ(1 << 6)                                               |
      | `sat`       | SAT(1 << 8)                                               |
      | `satfinite` | SATFINITE(1 << 9)                                         |
      | `rhau`      | RHAU(1 << 10)                                              |
      | `clamp_int8`| CLAMP_INT8(1 << 11)                                       |
```

#### ADD

```
declare <type> @llvm.efvm.add.<sign>(<type> src1, <srcty2> src2, int mode)
```

"llvm.efvm.add*"用于对两个源操作数做加法运算。
type为返回值和src1的类型，与src2的类型srcty2对应关系如下：

| type | srcty2 |
| --- | --- |
| 512 x i8 | 512 x i8 |
| 256 x i16 | 256 x i16 |
| 256 x i16 | i32 |
| 128 x i32 | 128 x i32 |
| 128 x i32 | i32 |
| 64 x i64 | 64 x i64 |
| 64 x i64 | i64 |
| 256 x half | 256 x half |
| 256 x half | half |
| 256 x bfloat | 256 x bfloat |
| 256 x bfloat | float |
| 128 x float | 128 x float |
| 128 x float | float |

- sign: {s, u, f}, 其中s表示signed, u表示unsigned, f表示floating-point
- src1: 第1个源操作数，类型为对应的type，只能为向量类型
- src2: 第2个源操作数，类型为对应的srcty2。
- mode: 32bit掩码，用于设置可配置域：round, ftz, sat

```
      |     名称   |                         取值                               |
      |------------|----------------------------------------------------       |
      | `round`    | RND_EVEN(0)   RND_ZERO(1)  RND_PINF(1<<1)  RND_NINF(1<<3) |
      | `ftz`      | FTZ(1 << 6)                                               |
      | `sat`      | SAT(1 << 8)                                               |
```

#### SUB

```
declare <dstty> @llvm.efvm.sub.<sign>(<srcty1> src1, <srcty2> src2, int mode)
```

"llvm.efvm.sub*"用于对两个源操作数做减法运算。
dstty、srcty1和srcty2对应关系如下：

| dstty | srcty1 | srcty2 |
| --- | --- | --- |
| 512 x i8 | 512 x i8 | 512 x i8 |
| 256 x i16 | 256 x i16 | 256 x i16 |
| 256 x i16 | i32 | 256 x i16 |
| 256 x i16 | 256 x i16 | i32 |
| 128 x i32 | 128 x i32 | 128 x i32 |
| 128 x i32 | i32 | 128 x i32 |
| 128 x i32 | 128 x i32 | i32 |
| 64 x i64 | 64 x i64 | 64 x i64 |
| 64 x i64 | i64 | 64 x i64 |
| 64 x i64 | 64 x i64 | i64 |
| 256 x half | 256 x half | 256 x half |
| 256 x half | half | 256 x half |
| 256 x half | 256 x half | half |
| 256 x bfloat | 256 x bfloat | 256 x bfloat |
| 256 x bfloat | float | 256 x bfloat |
| 256 x bfloat | 256 x bfloat | float |
| 128 x float | 128 x float | 128 x float |
| 128 x float | float | 128 x float |
| 128 x float | 128 x float | float |

- sign: {s, u, f}, 其中s表示signed, u表示unsigned, f表示floating-point
- src1: 第1个源操作数，类型为对应的srcty1。
- src2: 第2个源操作数，类型为对应的srcty2。
- mode: 32bit掩码，用于设置可配置域：round, ftz, sat

```
      |     名称   |                         取值                               |
      |------------|----------------------------------------------------       |
      | `round`    | RND_EVEN(0)   RND_ZERO(1)  RND_PINF(1<<1)  RND_NINF(1<<3) |
      | `ftz`      | FTZ(1 << 6)                                               |
      | `sat`      | SAT(1 << 8)                                               |
```

#### MUL

```
declare <type> @llvm.efvm.mul.<sign>(<type> src1, <srcty2> src2, int mode)
```

"llvm.efvm.mul*"用于对两个源操作数做乘法运算。
type为返回值和src1的类型，与src2的类型srcty2对应关系如下：

| type | srcty2 |
| --- | --- |
| 512 x i8 | 512 x i8 |
| 256 x i16 | 256 x i16 |
| 256 x i16 | i32 |
| 128 x i32 | 128 x i32 |
| 128 x i32 | i32 |
| 64 x i64 | 64 x i64 |
| 64 x i64 | i64 |
| 256 x half | 256 x half |
| 256 x half | half |
| 256 x bfloat | 256 x bfloat |
| 256 x bfloat | float |
| 128 x float | 128 x float |
| 128 x float | float |

- sign: {s, u, f}, 其中s表示signed, u表示unsigned, f表示floating-point
- src1: 第1个源操作数，类型为对应的type。*
- src2: 第2个源操作数，类型为对应的srcty2。
- mode: 32bit掩码，用于设置可配置域：round, ftz, sat

```
      |     名称   |                         取值                               |
      |------------|----------------------------------------------------       |
      | `round`    | RND_EVEN(0)   RND_ZERO(1)  RND_PINF(1<<1)  RND_NINF(1<<3) |
      | `ftz`      | FTZ(1 << 6)                                               |
      | `sat`      | SAT(1 << 8)                                               |
```

#### CADD

```
declare <dstty> @llvm.efvm.cadd.<sign>(<srcty1> src1, <srcty2> src2)
```

"llvm.efvm.cadd*"用于对两个源操作数做加法运算，产生溢出flag并作为结果。
dstty、srcty1和srcty2对应关系如下：

| dstty | srcty1 | srcty2 |
| --- | --- | --- |
| 512 x i1 | 512 x i8 | 256 x i8 |
| 256 x i1 | 256 x i16 | 256 x i16 |
| 256 x i1 | 256 x i16 | i32 |
| 128 x i1 | 128 x i32 | 128 x i32 |
| 128 x i1 | 128 x i32 | i32 |
| 64 x i1 | 64 x i64 | 64 x i64 |
| 64 x i1 | 64 x i64 | i64 |

- sign: {s, u}, 其中s表示signed, u表示unsigned
- src1: 第1个源操作数，类型为对应的srcty1
- src2: 第2个源操作数，类型为对应的srcty2

#### CSUB

```
declare <dstty> @llvm.efvm.csub.<sign>(<srcty1> src1, <srcty2> src2)
```

"llvm.efvm.csub*"用于对两个源操作数做减法运算，产生溢出flag并作为结果。
dstty、srcty1和srcty2对应关系如下：

| dstty | srcty1 | srcty2 |
| --- | --- | --- |
| 512 x i1 | 512 x i8 | 256 x i8 |
| 256 x i1 | 256 x i16 | 256 x i16 |
| 256 x i1 | i32 | 256 x i16 |
| 256 x i1 | 256 x i16 | i32 |
| 128 x i1 | 128 x i32 | 128 x i32 |
| 128 x i1 | i32 | 128 x i32 |
| 128 x i1 | 128 x i32 | i32 |
| 64 x i1 | 64 x i64 | 64 x i64 |
| 64 x i1 | i64 | 64 x i64 |
| 64 x i1 | 64 x i64 | i64 |

- sign: {s, u}, 其中s表示signed, u表示unsigned
- src1: 第1个源操作数，类型为对应的srcty1。
- src2: 第2个源操作数，类型为对应的srcty2。

#### CMUL

```
declare <dstty> @llvm.efvm.cmul.<sign>(<srcty> src1, <srcty> src2)
```

"llvm.efvm.cmul*"用于对两个源操作数做乘法运算，产生溢出flag并作为结果。
dstty、srcty对应关系如下：

| dstty | srcty |
| --- | --- |
| 512 x i1 | 512 x i8 |
| 256 x i1 | 256 x i16 |
| 128 x i1 | 128 x i32 |
| 64 x i1 | 64 x i64 |

- sign: {s, u}, 其中s表示signed, u表示unsigned
- src1: 第1个源操作数，类型为对应的srcty。
- src2: 第2个源操作数，类型为对应的srcty。

#### CSLL/CSLLI

```
declare <dstty> @llvm.efvm.csll(<srcty1> src1, <srcty2> src2)
```

"llvm.efvm.csll*"对源操作数做逻辑左移，产生溢出flag并作为结果。
dstty、srcty1和srcty2对应关系如下：

| dstty | srcty1 | srcty2 |
| --- | --- | --- |
| 512 x i1 | 512 x i8 | 256 x i8 |
| 256 x i1 | 256 x i16 | 256 x i16 |
| 256 x i1 | 256 x i16 | i32 |
| 128 x i1 | 128 x i32 | 128 x i32 |
| 128 x i1 | 128 x i32 | i32 |
| 64 x i1 | 64 x i64 | 64 x i64 |
| 64 x i1 | 64 x i64 | i64 |

- src1: 第1个源操作数，类型为srcty1
- src2: 第2个源操作数，类型为srcty2

#### WADD

```
declare <512 x i32> @llvm.efvm.add.wide.<sign>(<512 x i8> src1, <srcty2> src2)
```

"llvm.efvm.add.wide*"用于两个相同格式的向量元素为8bits的源操作数相加，得到向量元素为32bits的结果。

- sign: {s, u}, 其中s表示signed, u表示unsigned
- srcty2: {<512 x i8>，i32}
- src1: 第1个源操作数，类型为<512 x i8>
- src2: 第2个源操作数，类型为对应的srcty2，可以为标量也可为向量，当为向量时与src1类型相同，当为标量时为i32。

#### WMUL

```
declare <512 x i32> @llvm.efvm.mul.wide.<sign>(<512 x i8> src1, <srcty2> src2)
```

- "llvm.efvm.mul.wide*"用于两个相同格式的向量元素为8bits的源操作数相乘，得到向量元素为32bits的结果。
- sign: {s, u}, 其中s表示signed, u表示unsigned
- srcty2: {<512 x i8>，i32}
- src1: 第1个源操作数，类型为<512 x i8>
- src2: 第2个源操作数，类型为对应的srcty2，可以为标量也可为向量，当为向量时与src1类型相同，当为标量时为i32。
-

#### WMULUS

```
declare <512 x i32> @llvm.efvm.wmulus.wide(<srcty1> src1, <srcty2> src2)
```

- "llvm.efvm.wmulus.wide*"用于两个符号相反的向量元素为8bits的源操作数相乘，得到向量元素为32bits的结果。
- srcty1 : {<512 x i8>，i32}, 可以为向量或者标量，不能与srcty2同为标量。
- src1: 第1个源操作数，类型为srcty1
- srcty2 : {<512 x i8>，i32}，可以为向量或者标量，不能与srcty1同为标量。
- src2: 第2个源操作数，类型为srcty2

#### MAD

```
declare <dstty> @llvm.efvm.mad.wide.<sign>(<srcty1> src1, <srcty2> src2, <srcty3> src3, int mode)
```

- "llvm.efvm.mad.wide*"用于对src1和src2相乘且累加src3的运算，运算结果数据元素的宽度是源数据元素宽度的2倍。 dstty、srcty1、srcty2和srcty3对应关系如下：
  | dstty | srcty1 | srcty2 | srcty3 |
  | --- | --- | --- | --- |
  | 256 x i32 | 256 x i16 | 256 x i16 | 256 x i16 |
  | 256 x i32 | i32 | 256 x i16 | 256 x i16 |
  | 256 x i32 | 256 x i16 | 256 x i16 | i32 |
  | 128 x i64 | 128 x i32 | 128 x i32 | 128 x i64 |
  | 128 x i64 | i32 | 128 x i32 | 128 x i64 |
  | 128 x i64 | 128 x i32 | 128 x i32 | i64 |
- sign: {s, u}, 其中s表示signed, u表示unsigned
- src1: 第1个源操作数
- src2: 第2个源操作数
- src3: 第3个源操作数
- mode: 32bit掩码，用于设置可配置域sat

```
      |     名称   |                         取值                                |
      |------------|----------------------------------------------------        |
      | `sat`      | SAT(1 << 8)                                                |
```

`declare <dstty> @llvm.efvm.mad.lo.<sign>(<srcty1> src1, <srcty2> src2, <srcty3> src3, int mode)`
* "llvm.efvm.mad.lo*"用于对src1和src2相乘，将乘法得到的低半部分与src3相加运算。
* dstty、srcty1、srcty2和srcty3对应关系如下：
| dstty | srcty1 | srcty2 | srcty3 |
|------------ |------------- |------------- |------------- |
|<256 x i16> |<256 x i16> |<256 x i16> |<256 x i16> |
|<256 x i16> | i32 |<256 x i16> |<256 x i16> |
|<256 x i16> |<256 x i16> |<256 x i16> | i32 |
|<128 x i32> |<128 x i32> |<128 x i32> |<128 x i32> |
|<128 x i32> | i32 |<128 x i32> |<128 x i32> |
|<128 x i32> |<128 x i32> |<128 x i32> | i32 |
* sign: {s, u}, 其中s表示signed, u表示unsigned
* src1: 第1个源操作数
* src2: 第2个源操作数
* src3: 第3个源操作数
* mode: 32bit掩码，用于设置可配置域sat

```
      |     名称   |                         取值                               |
      |------------|----------------------------------------------------        |
      | `sat`      | SAT(1 << 8)                                                |
```

`declare <dstty> @llvm.efvm.mad.hi.<sign>(<srcty1> src1, <srcty2> src2, <srcty3> src3, int mode)`
* "llvm.efvm.mad.hi*"用于对src1和src2相乘，将乘法得到的高半部分与src3相加运算。
* dstty、srcty1、srcty2和srcty3对应关系如下：
| dstty | srcty1 | srcty2 | srcty3 |
|------------ |------------- |------------- |------------- |
|<256 x i16> |<256 x i16> |<256 x i16> |<256 x i16> |
|<256 x i16> | i32 |<256 x i16> |<256 x i16> |
|<256 x i16> |<256 x i16> |<256 x i16> | i32 |
|<128 x i32> |<128 x i32> |<128 x i32> |<128 x i32> |
|<128 x i32> | i32 |<128 x i32> |<128 x i32> |
|<128 x i32> |<128 x i32> |<128 x i32> | i32 |
* sign: {s, u}, 其中s表示signed, u表示unsigned
* src1: 第1个源操作数
* src2: 第2个源操作数
* src3: 第3个源操作数
* mode: 32bit掩码，用于设置可配置域sat

```
      |     名称   |                         取值                               |
      |------------|----------------------------------------------------        |
      | `sat`      | SAT(1 << 8)                                                |
```

#### MAC

特殊MAC：MOP.MAC_SP指令是专用于lane_coord计算，用内建变量（类似于threadIdx.{x,y,z}）的方式提供访问接口，不对外暴露它的intrinsic function API。

override域：不暴露给用户，编译器内部根据src1, src2的值，去优化设置override域。

```
declare <dstty> @llvm.efvm.<acc_mode>.<sign>(<srcty1> src1, <srcty2> src2, <srcty3> src3, int rnd, int mode)
```

MAC类运算intrinsic function，支持三种计算形式：src1 * src2 + src3， -src1 * src2 + src3， src1 * src2- src3。src2只能为向量，src1可以是标量也可是向量。返回值类型是向量，src3可以为标量也可以为向量。

dstty、srcty1、srcty2和srcty3对应类型如下：

| dstty | srcty1 | srcty2 | srcty3 |
| --- | --- | --- | --- |
| 256 x float | 256 x half | 256 x half | 256 x float |
| 256 x float | half | 256 x half | 256 x float |
| 256 x float | 256 x half | 256 x half | float |
| 256 x float | 256 x bfloat | 256 x bfloat | 256 x float |
| 256 x float | float | 256 x bfloat | 256 x float |
| 256 x float | 256 x bfloat | 256 x bfloat | float |
| 512 x i32 | 512 x i8 | 512 x i8 | 512 x i32 |
| 512 x i32 | i32 | 512 x i8 | 512 x i32 |
| 512 x i32 | 512 x i8 | 512 x i8 | i32 |

- acc_mode: {"mac", "mas", "imas"}。为"mac"时表示"src1 * src2 + src3"， 为"mas"时表示"-src1 * src2 + src3"， 为"imas"时表示"src1 * src2- src3"。
- sign: {s, u, f}, 其中s表示signed, u表示unsigned, f表示floating-point
- src1: 第1个源操作数，类型为srcty1
- src2: 第2个源操作数，类型为srcty2
- src3: 累加操作数，类型srcty3
- rnd: 32bit掩码，用于设置可配置域round
- mode: 32bit掩码，用于设置可配置域sat，ftz

```
      |     名称      |                         取值                              |
      |------------   |----------------------------------------------------       |
      | `round`       | RND_EVEN(0)   RND_ZERO(1)  RND_PINF(2)  RND_NINF(3)       |
      | `ftz`         | FTZ(1 << 6)                                               |
      | `sat`         | SAT(1 << 8)                                               |
```

`declare <dstty> @llvm.efvm.<acc_mode>.mix.<cvt_mode_mac>.<sign>(<srcty1> src1, <srcty2> src2, <srcty3> src3，int rnd, int mode)`
MAC MIX类运算intrinsic function，支持三种计算形式：src1 * src2 + src3， -src1 * src2 + src3， src1 * src2- src3。
dstty、srcty1、srcty2和srcty3对应类型如下：
| dstty | srcty1 | srcty2 | srcty3 |
|------------ |----------------|----------- |------------- |
|<512 x float> |<512 x i8> |<512 x float> |<512 x float> |
|<512 x float> | i32 |<512 x float> |<512 x float> |
|<512 x float> |<512 x i8> | float |<512 x float> |
|<512 x float> |<512 x i8> |<512 x float> | float |
|<256 x float> |<256 x half> |<256 x float> |<256 x float> |
|<256 x float> | half |<256 x float> |<256 x float> |
|<256 x float> |<256 x half> | float |<256 x float> |
|<256 x float> |<256 x half> |<256 x float> | float |
|<256 x float> |<256 x bfloat> |<256 x float> |<256 x float> |
|<256 x float> | bfloat |<256 x float> |<256 x float> |
|<256 x float> |<256 x bfloat> | float> |<256 x float> |
|<256 x float> |<256 x bfloat> |<256 x float> | float> |
|<128 x float> |<128 x float> |<128 x float> |<128 x float> |
|<128 x float> | float |<128 x float> |<128 x float> |
|<128 x float> |<128 x float> | float> |<128 x float> |
|<128 x float> |<128 x float> |<128 x float> | float> |
|<128 x float> |<128 x i32> |<128 x float> |<128 x float> |
|<128 x float> | i32 |<128 x float> |<128 x float> |
|<128 x float> |<128 x i32> | float |<128 x float> |
|<128 x float> |<128 x i32> |<128 x float> | float |
|<512 x float> |<512 x f8e5m2> |<512 x float> |<512 x float> |
|<512 x float> | f8e5m2 |<512 x float> |<512 x float> |
|<512 x float> |<512 x f8e5m2> | float |<512 x float> |
|<512 x float> |<512 x f8e5m2> |<512 x float> | float |
|<512 x float> |<512 x f8e4m3> |<512 x float> |<512 x float> |
|<512 x float> | f8e4m3 |<512 x float> |<512 x float> |
|<512 x float> |<512 x f8e4m3> | float |<512 x float> |
|<512 x float> |<512 x f8e4m3> |<512 x float> | float |
|<512 x half> |<512 x i8> |<512 x half> |<512 x half> |
|<512 x half> | i32 |<512 x half> |<512 x half> |
|<512 x half> |<512 x i8> | half |<512 x half> |
|<512 x half> |<512 x i8> |<512 x half> | half |
|<256 x half> |<256 x half> |<256 x half> |<256 x half> |
|<256 x half> | half |<256 x half> |<256 x half> |
|<256 x half> |<256 x half> | half |<256 x half> |
|<256 x half> |<256 x half> |<256 x half> | half |
|<512 x half> |<512 x f8e5m2> |<512 x half> |<512 x half> |
|<512 x half> | f8e5m2 |<512 x half> |<512 x half> |
|<512 x half> |<512 x f8e5m2> | half |<512 x half> |
|<512 x half> |<512 x f8e5m2> |<512 x half> | half |
|<512 x half> |<512 x f8e4m3> |<512 x half> |<512 x half> |
|<512 x half> | f8e4m3 |<512 x half> |<512 x half> |
|<512 x half> |<512 x f8e4m3> | half |<512 x half> |
|<512 x half> |<512 x f8e4m3> |<512 x half> | half |
|<1024 x half> |<1024 x i4> |<1024 x half> |<1024 x half> |
|<1024 x half> | i32 |<1024 x half> |<1024 x half> |
|<1024 x half> |<1024 x i4> | half |<1024 x half> |
|<1024 x half> |<1024 x i4> |<1024 x half> | half |
|<1024 x half> |<1024 x fp4e2m1>|<1024 x half> |<1024 x half> |
|<1024 x half> | fp4e2m1 |<1024 x half> |<1024 x half> |
|<1024 x half> |<1024 x fp4e2m1>| half |<1024 x half> |
|<1024 x half> |<1024 x fp4e2m1>|<1024 x half> | half |
|<512 x bfloat> |<512 x i8> |<512 x bfloat> |<512 x bfloat> |
|<512 x bfloat> | i32 |<512 x bfloat> |<512 x bfloat> |
|<512 x bfloat> |<512 x i8> | bfloat |<512 x bfloat> |
|<512 x bfloat> |<512 x i8> |<512 x bfloat> | bfloat |
|<256 x bfloat> |<256 x bfloat> |<256 x bfloat> |<256 x bfloat> |
|<256 x bfloat> | bfloat |<256 x bfloat> |<256 x bfloat> |
|<256 x bfloat> |<256 x bfloat> | bfloat |<256 x bfloat> |
|<256 x bfloat> |<256 x bfloat> |<256 x bfloat> | bfloat |
|<512 x bfloat> |<512 x f8e5m2> |<512 x bfloat> |<512 x bfloat> |
|<512 x bfloat> | f8e5m2 |<512 x bfloat> |<512 x bfloat> |
|<512 x bfloat> |<512 x f8e5m2> | bfloat |<512 x bfloat> |
|<512 x bfloat> |<512 x f8e5m2> |<512 x bfloat> | bfloat |
|<512 x bfloat> |<512 x f8e4m3> |<512 x bfloat> |<512 x bfloat> |
|<512 x bfloat> | f8e4m3 |<512 x bfloat> |<512 x bfloat> |
|<512 x bfloat> |<512 x f8e4m3> | bfloat |<512 x bfloat> |
|<512 x bfloat> |<512 x f8e4m3> |<512 x bfloat> | bfloat |
|<1024 x bfloat>|<1024 x i4> |<1024 x bfloat>|<1024 x bfloat>|
|<1024 x bfloat>| i32 |<1024 x bfloat>|<1024 x bfloat>|
|<1024 x bfloat>|<1024 x i4> | bfloat |<1024 x bfloat>|
|<1024 x bfloat>|<1024 x i4> |<1024 x bfloat>| bfloat |
|<1024 x bfloat>|<1024 x fp4e2m1>|<1024 x bfloat>|<1024 x bfloat>|
|<1024 x bfloat>| fp4e2m1 |<1024 x bfloat>|<1024 x bfloat>|
|<1024 x bfloat>|<1024 x fp4e2m1>| bfloat |<1024 x bfloat>|
|<1024 x bfloat>|<1024 x fp4e2m1>|<1024 x bfloat>| bfloat |

- acc_mode: {"mac", "mas", "imas"}。为"mac"时表示"src1 * src2 + src3"， 为"mas"时表示"-src1 * src2 + src3"， 为"imas"时表示"src1 * src2- src3"。
- cvt_mode_mac: {cvt_to_fp4e2m1, cvt_to_fp6e2m3, cvt_to_fp8e4m3, cvt_to_fp8e5m2, cvt_to_fp16, cvt_to_bf16} 当dstty的element为float时，cvt_mode_mac可以取值{cvt_to_fp4e2m1, cvt_to_fp6e2m3, cvt_to_fp8e4m3, cvt_to_fp8e5m2, cvt_to_fp16, cvt_to_bf16}，而当dstty的element为half或者bfloat时，cvt_mode_mac可以取值{cvt_to_fp4e2m1 , cvt_to_fp6e2m3, cvt_to_fp8e4m3, cvt_to_fp8e5m2}。
- sign: {s, u, f, s8, u8}, 其中s表示signed, u表示unsigned, f表示floating-point, s8表示signed且数据位宽为8bits，u8表示unsigned且数据位宽为8bits。
- src1: 第1个源操作数，类型为srcty1。可以为标量也可也为向量，src1, src2和src3中最多只能有一个为标量。
- src2: 第2个源操作数，类型为srcty2。可以为标量也可也为向量，src1, src2和src3中最多只能有一个为标量。
- src3: 累加操作数，类型srcty3。可以为标量也可为向量，src1, src2和src3中最多只能有一个为标量。
- rnd: 32bit掩码，用于设置可配置域round
- mode: 32bit掩码，用于设置可配置 satfinite, sat，ftz, rhau。satfinite仅当srcty1为浮点时有效。rhau仅在FP->FP4/FP6情况下有效。仅在FP->FP4 /FP6情况下合法。

```
      |     名称      |                         取值                               |
      |------------   |----------------------------------------------------       |
      | `round`       | RND_EVEN(0)   RND_ZERO(1)  RND_PINF(2)  RND_NINF(3)       |
      | `ftz`         | FTZ(1 << 6)                                               |
      | `sat`         | SAT(1 << 8)                                               |
      | `satfinite`   | SATFINITE(1 << 9)                                         |
      | `rhau`        | RHAU(1 << 10)                                              |
      | `cvt_mode_mac`| CVT_TO_FP4E2M1(1 << 14), CVT_TO_FP6E2M3(1 << 15),         |
      |               | CVT_TO_FP8E4M3(1 << 16)，CVT_TO_FP8E5M2（1 << 17），        |
      |               | CVT_TO_FP16(1 << 18）， CVT_TO_BF16（1 << 19）            |
```

### 4.5. 矩阵操作

EFVM提供2d指令，完成矩阵数据从L0到L1的加载，存储，矩阵乘加, OCP-MX等2d操作

```
D = A * B + D
或者
D = (A * B) ⊙ (Ascale * Bscale) + D
```

其中，A是M*K形状矩阵，B是K*N形状矩阵，D是M*N形状矩阵，D也被称为累加矩阵。
矩阵操作章节中，参数名中出现的a，b，d以及相关前缀，对应运算中的矩阵A，矩阵B，矩阵D；GEMM Intrinsics中，m，n对应矩阵A的dim1_size和矩阵B的dim0_size，MLD，MST，MSHF Intrinsics中，m，n代表唯一的矩阵操作数的dim1_size和dim0_size0。

#### 矩阵元素数据类型

**非OCP-MX GEMM**

| A | B | D | note |
| --- | --- | --- | --- |
| gemm_kind::f8f6f4 |  |  |  |
| FP4 E2M1 | FP6 E2M3 | FP32 | FP4,FP6仅能来自于memory |
| FP4 E2M1 | FP8 E4M3 | FP32 | FP4仅能来自于memory |
| FP4 E2M1 | FP8 E5M2 | FP32 | FP4仅能来自于memory |
| FP6 E2M3 | FP4 E2M1 | FP32 | FP4,FP6仅能来自于memory |
| FP6 E2M3 | FP6 E2M3 | FP32 | FP6仅能来自于memory |
| FP6 E2M3 | FP8 E4M3 | FP32 | FP6仅能来自于memory |
| FP6 E2M3 | FP8 E5M2 | FP32 | FP6仅能来自于memory |
| FP8 E4M3 | FP4 E2M1 | FP32 | FP4仅能来自于memory |
| FP8 E4M3 | FP6 E2M3 | FP32 | FP6仅能来自于memory |
| FP8 E4M3 | FP8 E4M3 | FP32 |  |
| FP8 E4M3 | FP8 E5M2 | FP32 |  |
| FP8 E5M2 | FP4 E2M1 | FP32 | FP4仅能来自于memory |
| FP8 E5M2 | FP6 E2M3 | FP32 | FP6仅能来自于memory |
| FP8 E5M2 | FP8 E4M3 | FP32 |  |
| FP8 E5M2 | FP8 E4M3 | FP32 |  |
| gemm_kind::i8 |  |  |  |
| U8 | U8 | SINT32 |  |
| S8 | S8 | SINT32 |  |
| U8 | S8 | SINT32 |  |
| S8 | U8 | SINT32 |  |
| gemm_kind::f16 |  |  |  |
| FP16 | FP16 | FP32 |  |
| BF16 | BF16 | FP32 |  |
| BF16 | BF16 | FP32 |  |
| FP16 | FP16 | FP32 |  |
| gemm_kind::f32 |  |  |  |
| FP4 E2M1 | FP4 E2M1 | FP32 |  |

**OCP-MX GEMM**

| A | B | Scale Type for both Ascale/Bscale | D | note |
| --- | --- | --- | --- | --- |
| gemm_kind::mxf8f6f4 |  |  |  |  |
| FP4 E2M1 | FP6 E2M3 | UE8M0 | FP32 | FP4,FP6仅能来自于memory |
| FP4 E2M1 | FP8 E4M3 | UE8M0 | FP32 | FP4仅能来自于memory |
| FP4 E2M1 | FP8 E5M2 | UE8M0 | FP32 | FP4仅能来自于memory |
| FP6 E2M3 | FP4 E2M1 | UE8M0 | FP32 | FP4,FP6仅能来自于memory |
| FP6 E2M3 | FP6 E2M3 | UE8M0 | FP32 | FP6仅能来自于memory |
| FP6 E2M3 | FP8 E4M3 | UE8M0 | FP32 | FP6仅能来自于memory |
| FP6 E2M3 | FP8 E5M2 | UE8M0 | FP32 | FP6仅能来自于memory |
| FP8 E4M3 | FP4 E2M1 | UE8M0 | FP32 | FP4仅能来自于memory |
| FP8 E4M3 | FP6 E2M3 | UE8M0 | FP32 | FP6仅能来自于memory |
| FP8 E4M3 | FP8 E4M3 | UE8M0 | FP32 |  |
| FP8 E4M3 | FP8 E5M2 | UE8M0 | FP32 |  |
| FP8 E5M2 | FP4 E2M1 | UE8M0 | FP32 | FP4仅能来自于memory |
| FP8 E5M2 | FP6 E2M3 | UE8M0 | FP32 | FP6仅能来自于memory |
| FP8 E5M2 | FP8 E4M3 | UE8M0 | FP32 |  |
| FP8 E5M2 | FP8 E4M3 | UE8M0 | FP32 |  |
| gemm_kind::mxf4 |  |  |  |  |
| FP4 E2M1 | FP4 E2M1 | UE8M0/UE4M3 |  |  |

#### 矩阵形状M*N*K

一次矩阵计算涉及到有M, N, K三个维度，其中M, N的合法取值成组出现:

```
{m, n}: {8, 16}, {16, 8}, {16, 16}, {16, 32}, {16, 64}, {16, 128}, {16, 256}, {32, 16}, {32, 32}, {64, 16}, {64, 64}, {128, 16}, {256, 16}
```

K的取值范围与矩阵A, B的元素类型有关
矩阵A, B元素类型为f8, f6, f4且不同时为f4:

k = 32 * n, n = 1~8

矩阵A, B元素类型为__fp16, __bf16:

k = 16 * n, n = 1~8

矩阵A, B元素类型同时为f4:

k = 64 * n, n = 1~8

矩阵A, B元素类型为i8：

k = 32 * n, n = 1~8

总结：K维度的max_size = 32Byte * n, n = 1~8

#### 描述符

为了表达2d运算中矩阵所需要的静态信息和动态信息，2d计算中需要64位整数作为intrinsic函数参数

- mem_descriptor
- inst_descriptor
- padding_descriptor
- mldst_descriptor0
- mldst_descriptor1
- mldst_descriptor2

descriptor所描述的信息参见：SIP5.0_Arch_Spec_2D_Compute中GEMM的矩阵描述符，MLDST矩阵描述符章节

#### Gemm Intrinsic

下列的Intrinsic完成一次矩阵乘加（或者矩阵乘）运算

##### 矩阵形状与向量参数类型

参与运算的向量类型矩阵参数，其向量类型与矩阵的形状，stride共同决定。例如，为了计算16*32形状的矩阵D，通过两次16*16的GEMM运算完成，通过dim1_stride和inst_descriptor，指定GEMM运算结果对应矩阵D中位置。如下图：

```
#
+-------------------+    +-------------------+
|    16×16 GEMM     |    |    16×16 GEMM     |
|  dim1_stride:32   |    |  dim1_stride:32   |
|    oaccd_pos:0    |    |    oaccd_pos:1    |
+-------------------+    +-------------------+
|------------------MatrixD-------------------|
|------------------vlen:512------------------|
```

类似的使用向量类型表示矩阵参数时，vlen为矩阵大小的倍数，具体值与stride与pos等参数有关，
详细介绍见SIP5.0_Arch_Spec_2D_Compute中inst_descriptor章节与gemm_mem中dst_stride_mul, dst_stride_frac位域说明

##### 'llvm.efvm.gemm.mem.*' intrinsics

```
declare <ret_type> @llvm.efvm.gemm.mem.<synchronism>.<atype.btype.dtype>(i64 a_descriptor, i64 b_descriptor, <ret_type> d, i64 inst_descriptor, i64 padding_descriptor, i8 a_scope, i8 b_scope, i32 m, i32 n, i32 k, i8 dst_stride_mul, i8 dst_stride_frac, i8 dyn)
```

必须为编译期常量的函数参数：
a_scope, b_scope, m, n, k, dst_stride_mul, dst_stride_frac, dyn

###### 概述

使用descriptor描述操作数矩阵A、B，完成一次GEMM操作

###### 函数名修饰符：

.synchronism = {.async, .sync}

.atype.btype.dtype 参见矩阵元素数据类型章节“非OCP-MX GEMM”表格

###### 返回值类型：

ret_type = 向量类型 vlen * dtype, 其中vlen必须是m * n的倍数

###### 参数：

a_descriptor: 矩阵A的mem_descriptor

b_descriptor: 矩阵B的mem_descriptor

d: 累加矩阵D

inst_descriptor: 本次GEMM运算使用的inst_descriptor

padding_descriptor: 本次GEMM运算使用的padding_descriptor

a_scope: 矩阵A的地址空间信息 0：local， 1：shared

b_scope: 矩阵B的地址空间信息 0：local， 1：shared

m: 矩阵A的dim1 size

n: 矩阵B的dim0 size

k：矩阵A的dim0 size

m, n, k的合法组合，参见章节 "矩阵形状M*N*K"

dst_stride_mul, dst_stride_frac: 描述结果矩阵的dim1_stride信息，详细取值参见SIP5.0_Arch_Spec_2D_Compute中D矩阵格式章节

dyn:

- 0:表示矩阵计算过程中采用静态形状计算，忽略padding_descriptor的内容
- 1:表示矩阵计算过程中采用动态形状计算，受到padding_descriptor的内容

```
declare <ret_type> @llvm.efvm.gemm.mem.block_scale.<synchronism>.<atype.btype.scale_type.dtype>(i64 a_descriptor, i64 b_descriptor, i64 a_scale_descriptor, i64 b_scale_descriptor, <ret_type> d, i64 inst_descriptor, i64 padding_descriptor, i8 a_scope, i8 b_scope, i32 m, i32 n, i32 k, i8 dst_stride_mul, i8 dst_stride_frac, i8 dyn)
```

###### 概述

OCP-MX 2D计算，使用a_scale_descriptor、b_scale_descriptor，描述Ascale、Bscale矩阵

**未列出部分与上述一致**

###### 函数名修饰符

.atype.btype.scale_type.dtype 参见矩阵元素数据类型章节“OCP-MX GEMM”表格

###### 参数

a_scale_descriptor: 矩阵Ascale的mem_descriptor

b_scale_descriptor: 矩阵Bscale的mem_descriptor

```
declare <ret_type> @llvm.efvm.gemm.mem.cgemm.<synchronism>.<atype.btype.dtype>(i64 a_descriptor, i64 b_descriptor, i64 a_scale_descriptor, i64 b_scale_descriptor, <ret_type> d, i64 inst_descriptor, i64 padding_descriptor, i8 a_scope, i8 b_scope, i32 m, i32 n, i32 k, i8 dst_stride_mul, i8 dst_stride_frac, i8 dyn, i8 sel_ab, i8 pattern)
```

###### 概述

cgemm版本，支持多sub-thread广播的GEMM操作

**未列出部分与上述一致**

###### 参数

sel_ab: 表达用于配合pattern来选择broadcast的subthread范围

- 0: 表达协同加载的是A矩阵，选择A广播相关的pattern
- 1：表达协同加载的是B矩阵，选择B广播

pattern: 表达协同加载的广播模式

- 0： 1*4
- 1： 2*2 （reserved）
- 2： 1*8
- 3： 2*2*2 （reserved）

```
declare <ret_type> @llvm.efvm.gemm.mem.block_scale.cgemm.<synchronism>.<atype.btype.scale_type.dtype>(i64 a_descriptor, i64 b_descriptor, i64 a_scale_descriptor, i64 b_scale_descriptor, <ret_type> d, i64 inst_descriptor, i64 padding_descriptor, i8 a_scope, i8 b_scope, i32 m, i32 n, i32 k, i8 dst_stride_mul, i8 dst_stride_frac, i8 dyn, i8 sel_ab, i8 pattern)
```

###### 概述

OCP-MX 2D计算的cgemm版本

**未列出部分与上述一致**

##### 'llvm.efvm.gemm.bva.*' intrinsics

```
declare <ret_type> @llvm.efvm.gemm.bva.<synchronism>.<atype.btype.dtype>(<a_type> a, <b_type> b, <ret_type> d, i64 inst_descriptor, i64 padding_descriptor, i32 m, i32 n, i32 k, i8 dst_stride_mul, i8 dst_stride_frac, i8 dyn)
```

必须为编译期常量的函数参数：
m, n, k, dst_stride_mul, dst_stride_frac, sync

###### 概述

使用向量类型描述输入矩阵A、B，完成一次GEMM操作

###### 函数名修饰符：

.synchronism = {.async, .sync}

.atype.btype.dtype 参见矩阵元素数据类型章节

###### 返回值类型：

ret_type = 向量类型 vlen * dtype, vlen必须是m * n的倍数

###### 参数：

a_type: 向量类型vlen * atype, vlen必须是m * k的倍数

b_type: 向量类型vlen * btype, vlen必须是k * n的倍数

d: 累加矩阵D

inst_descriptor: 本次GEMM运算使用的inst_descriptor

padding_descriptor: 本次GEMM运算使用的padding_descriptor

m: 矩阵A的dim1 size

n: 矩阵B的dim0 size

k：矩阵A的dim0 size

m, n, k的合法组合，参见章节 "矩阵形状M*N*K"

dst_stride_mul, dst_stride_frac: 描述结果矩阵的dim1_stride信息，详细取值参见SIP5.0_Arch_Spec_2D_Compute中D矩阵格式章节

dyn: 0:表示矩阵计算过程中采用静态形状计算，忽略padding_descriptor的内容；1:表示矩阵计算过程中采用动态形状计算，受到padding_descriptor的内容

```
declare <ret_type> @llvm.efvm.gemm.bva.block_scale.<synchronism>.<atype.btype.scale_type.dtype>(<a_type> a, <b_type> b, <a_scale_type> ascale, <b_scale_type> bscale, <ret_type> d, i64 inst_descriptor, i64 padding_descriptor, i32 m, i32 n, i32 k, i8 dst_stride_mul, i8 dst_stride_frac, i8 dyn)
```

必须为编译期常量的函数参数：
a_scope, b_scope, m, n, k, dst_stride_mul, dst_stride_frac, sync

**未列出部分与非scale版本相同**

###### 函数名修饰符

.atype.btype.scale_type.dtype 参见矩阵元素数据类型章节“OCP-MX GEMM”表格

###### 参数

a_scale_type: 向量类型vlen * scale_type, vlen必须是m * k / block_size的倍数，其中block_size的取值参考SIP5.0_Arch_Spec_2D_Compute中“SIP支持的OCP-MX 2D计算”章节

b_scale_type: 向量类型vlen * scale_type, vlen必须是k * n / block_size的倍数，其中block_size的取值参考SIP5.0_Arch_Spec_2D_Compute中“SIP支持的OCP-MX 2D计算”章节

```
declare <ret_type> @llvm.efvm.gemm.bva.cgemm.<synchronism>.<atype.btype.dtype>(<a_type> a, <b_type> b, <ret_type> d, i64 inst_descriptor, i64 padding_descriptor, i32 m, i32 n, i32 k, i8 dst_stride_mul, i8 dst_stride_frac, i8 dyn, i8 sel_ab, i8 pattern)
```

###### 概述

cgemm版本，支持多sub-thread广播的GEMM操作

**未列出部分与上述一致**

###### 参数

sel_ab: 表达用于配合pattern来选择broadcast的subthread范围

- 0: 表达协同加载的是A矩阵，选择A广播相关的pattern
- 1：表达协同加载的是B矩阵，选择B广播

pattern: 表达协同加载的广播模式

- 0： 1*4
- 1： 2*2 （reserved）
- 2： 1*8
- 3： 2*2*2 （reserved）

```
declare <ret_type> @llvm.efvm.gemm.bva.block_scale.cgemm.<synchronism>.<atype.btype.scale_type.dtype>(<a_type> a, <b_type> b, <a_scale_type> ascale, <b_scale_type> bscale, <ret_type> d, i64 inst_descriptor, i64 padding_descriptor, i32 m, i32 n, i32 k, i8 dst_stride_mul, i8 dst_stride_frac, i8 dyn)
```

###### 概述

OCP-MX 2D计算的cgemm版本

**未列出部分与上述一致**

##### 'llvm.efvm.gemm.lva.*' intrinsics

```
declare <ret_type> @llvm.efvm.gemm.lva.<synchronism>.<atype.btype.dtype>(<a_type> a, i64 b_descriptor, <ret_type> d, i64 inst_descriptor, i64 padding_descriptor, i8 b_scope, i32 m, i32 n, i32 k, i8 dst_stride_mul, i8 dst_stride_frac, i8 dyn)
```

必须为编译期常量的函数参数：
b_scope, m, n, k, dst_stride_mul, dst_stride_frac, sync

###### 函数名修饰符：

.synchronism = {.async, .sync}

.atype.btype.dtype 参见矩阵元素数据类型章节

###### 返回值类型：

ret_type = 向量类型 vlen * dtype, vlen必须是m * n的倍数

###### 参数：

a_type: 向量类型vlen * atype, vlen必须是m * k的倍数

b_descriptor: 矩阵B的mem_descriptor

d: 累加矩阵D

inst_descriptor: 本次GEMM运算使用的inst_descriptor

padding_descriptor: 本次GEMM运算使用的padding_descriptor

b_scope: 矩阵B的地址空间信息 0：local， 1：shared

m: 矩阵A的dim1 size

n: 矩阵B的dim0 size

k：矩阵A的dim0 size

m, n, k的合法组合，参见章节 "矩阵形状M*N*K"

dst_stride_mul, dst_stride_frac: 描述结果矩阵的dim1_stride信息，详细取值参见SIP5.0_Arch_Spec_2D_Compute中D矩阵格式章节

dyn: 0:表示矩阵计算过程中采用静态形状计算，忽略padding_descriptor的内容；1:表示矩阵计算过程中采用动态形状计算，受到padding_descriptor的内容

```
declare <ret_type> @llvm.efvm.gemm.lva.block_scale.<synchronism>.<atype.btype.scale_type.dtype>(<a_type> a, i64 b_descriptor, <a_scale_type> ascale, i64 b_scale_descriptor, <ret_type> d, i64 inst_descriptor, i64 padding_descriptor, i8 b_scope, i32 m, i32 n, i32 k, i8 dst_stride_mul, i8 dst_stride_frac, i8 dyn)
```

必须为编译期常量的函数参数：
b_scope, m, n, k, dst_stride_mul, dst_stride_frac, sync

**未列出部分与非scale版本相同**

###### 函数名修饰符

.atype.btype.scale_type.dtype 参见矩阵元素数据类型章节“OCP-MX GEMM”表格

###### 参数

a_scale_type: 向量类型vlen * scale_type, vlen必须是m * k / block_size的倍数，其中block_size的取值参考SIP5.0_Arch_Spec_2D_Compute中“SIP支持的OCP-MX 2D计算”章节

```
declare <ret_type> @llvm.efvm.gemm.lva.cgemm.<synchronism>.<atype.btype.dtype>(<a_type> a, i64 b_descriptor, <ret_type> d, i64 inst_descriptor, i64 padding_descriptor, i8 b_scope, i32 m, i32 n, i32 k, i8 dst_stride_mul, i8 dst_stride_frac, i8 dyn)
```

###### 概述

cgemm版本，支持多sub-thread广播的GEMM操作

**未列出部分与上述一致**

###### 参数

sel_ab: 表达用于配合pattern来选择broadcast的subthread范围

- 0: 表达协同加载的是A矩阵，选择A广播相关的pattern
- 1：表达协同加载的是B矩阵，选择B广播

pattern: 表达协同加载的广播模式

- 0： 1*4
- 1： 2*2 （reserved）
- 2： 1*8
- 3： 2*2*2 （reserved）

```
declare <ret_type> @llvm.efvm.gemm.lva.block_scale.cgemm.<synchronism>.<atype.btype.scale_type.dtype>(<a_type> a, i64 b_descriptor, <a_scale_type> ascale, i64 b_scale_descriptor, <ret_type> d, i64 inst_descriptor, i64 padding_descriptor, i8 b_scope, i32 m, i32 n, i32 k, i8 dst_stride_mul, i8 dst_stride_frac, i8 dyn, i8 sel_ab, i8 pattern)
```

###### 概述

OCP-MX 2D计算的cgemm版本

**未列出部分与上述一致**

##### 'llvm.efvm.gemm.rva.*' intrinsics

```
declare <ret_type> @llvm.efvm.gemm.rva.<synchronism>.<atype.btype.dtype>(i64 a_descriptor, <b_type> b, <ret_type> d, i64 inst_descriptor, i64 padding_descriptor, i8 a_scope, i32 m, i32 n, i32 k, i8 dst_stride_mul, i8 dst_stride_frac, i8 dyn, i8 sel_ab, i8 pattern)
```

必须为编译期常量的函数参数：
a_scope, m, n, k, dst_stride_mul, dst_stride_frac, sync

###### 函数名修饰符：

.synchronism = {.async, .sync}

.atype.btype.dtype 参见矩阵元素数据类型章节

###### 返回值类型：

ret_type = 向量类型 vlen * dtype, vlen必须是m * n的倍数

###### 参数：

a_type: 向量类型vlen * atype, vlen必须是m * k的倍数

b_descriptor: 矩阵B的mem_descriptor

d: 累加矩阵D

inst_descriptor: 本次GEMM运算使用的inst_descriptor

padding_descriptor: 本次GEMM运算使用的padding_descriptor

a_scope: 矩阵A的地址空间信息 0：local， 1：shared

m: 矩阵A的dim1 size

n: 矩阵B的dim0 size

k：矩阵A的dim0 size

m, n, k的合法组合，参见章节 "矩阵形状M*N*K"

dst_stride_mul, dst_stride_frac: 描述结果矩阵的dim1_stride信息，详细取值参见SIP5.0_Arch_Spec_2D_Compute中D矩阵格式章节

dyn: 0:表示矩阵计算过程中采用静态形状计算，忽略padding_descriptor的内容；1:表示矩阵计算过程中采用动态形状计算，受到padding_descriptor的内容

```
declare <ret_type> @llvm.efvm.gemm.rva.block_scale.<synchronism>.<atype.btype.scale_type.dtype>(<a_type> a, i64 b_descriptor, i64 a_scale_descriptor, <b_scale_type> bscale, <ret_type> d, i64 inst_descriptor, i64 padding_descriptor, i8 a_scope, i32 m, i32 n, i32 k, i8 dst_stride_mul, i8 dst_stride_frac, i8 dyn)
```

必须为编译期常量的函数参数：
a_scope, m, n, k, dst_stride_mul, dst_stride_frac, sync

**未列出部分与非scale版本相同**

###### 函数名修饰符

.atype.btype.scale_type.dtype 参见矩阵元素数据类型章节“OCP-MX GEMM”表格

###### 参数

b_scale_type: 向量类型vlen * scale_type, vlen必须是k * n / block_size的倍数，其中block_size的取值参考SIP5.0_Arch_Spec_2D_Compute中“SIP支持的OCP-MX 2D计算”章节

```
declare <ret_type> @llvm.efvm.gemm.rva.cgemm.<synchronism>.<atype.btype.dtype>(i64 a_descriptor, <b_type> b, <ret_type> d, i64 inst_descriptor, i64 padding_descriptor, i8 a_scope, i32 m, i32 n, i32 k, i8 dst_stride_mul, i8 dst_stride_frac, i8 dyn, i8 sel_ab, i8 pattern, i8 sel_ab, i8 pattern)
```

###### 概述

cgemm版本，支持多sub-thread广播的GEMM操作

**未列出部分与上述一致**

###### 参数

sel_ab: 表达用于配合pattern来选择broadcast的subthread范围

- 0: 表达协同加载的是A矩阵，选择A广播相关的pattern
- 1：表达协同加载的是B矩阵，选择B广播

pattern: 表达协同加载的广播模式

- 0： 1*4
- 1： 2*2 （reserved）
- 2： 1*8
- 3： 2*2*2 （reserved）

```
declare <ret_type> @llvm.efvm.gemm.rva.block_scale.cgemm.<synchronism>.<atype.btype.scale_type.dtype>(<a_type> a, i64 b_descriptor, i64 a_scale_descriptor, <b_scale_type> bscale, <ret_type> d, i64 inst_descriptor, i64 padding_descriptor, i8 a_scope, i32 m, i32 n, i32 k, i8 dst_stride_mul, i8 dst_stride_frac, i8 dyn)
```

必须为编译期常量的函数参数：
a_scope, m, n, k, dst_stride_mul, dst_stride_frac, sync

**未列出部分与非scale版本相同**

### 4.6. MLDST Intrinsics

#### 'llvm.efvm.mld.*' intrinsics

```
declare <ret_type> @llvm.efvm.mld.<dwidth>(i64 mld_desc0, i64 mld_desc1, i64 mld_desc2, i8 oaccd_pos, i8 dyn, i8 mld_type, i8 scope, i8 m, i8 n, i8 sext, i32 cache_policy)
```

##### 函数名修饰符

.dwidth = {.4b, .8b, .16b, .32b}： 代表一个矩阵元素在L0时所占bit数

##### 返回值类型

ret_type: 向量类型vlen * dtype

- dtype对应宽度需要与dwidth保持一致, {i8: .8b}, {f16, bf16: .16b}, {i32, f32: .32b}, {fp4e2m1: .4b，.8b}（与dwidth修饰符相关）, {fp6e2m3: .8b}
- vlen为m*n的倍数

##### 参数

mld_desc0, mld_desc1, mld_desc2: 对应mldst_descriptor0, mldst_descriptor1, mldst_descriptor2

oaccd_pos: 加载的矩阵在返回类型中的偏移，单位是64Byte

dyn:

- 0:表示矩阵计算过程中采用静态形状计算，忽略mld_desc2的内容
- 1:表示矩阵计算过程中采用动态形状计算，受到mld_desc2的影响

mld_type:

- 0 MLD_TYPE::load-and-extend
- 1 (reserved)
- 2 MLD_TYPE::load-exact-elements 数值对应信息参见SIP5.0_Arch_Spec_2D_Compute中的“矩阵Memory存储格式和访问类型”章节

scope: 被加载矩阵地址所属地址空间

- 0: generic
- 1: local
- 2: shared
- 3: global
- 4: constant

m: 被加载矩阵的dim1 size

n: 被加载矩阵的dim0 size

sext: 当mld_type = 2 (MLD_TYPE::load-exact-element)时生效

- 0: 矩阵加载上来后到L0会做高位0拓展
- 1：矩阵加载上来后到L0会做高位符号拓展

cache_policy ：32bit掩码，用于指定缓存与预取行为，支持{0, 1, 4, 5}

| 位段 | 名称 | 描述 |
| --- | --- | --- |
| `[1:0]` | `llc_alo_pri` | llc allocation priority |
| `[2]` | `hw_pf` | hardware prefetch 使能位 |
| `[5:3]` | `cop_ld` | cache policy |
| 其他位 | - | 保留，必须为 0 |

#### 'llvm.efvm.cmld.*' intrinsics

```
declare <ret_type> @llvm.efvm.cmld.<dwidth>(i64 mld_desc0, i64 mld_desc1, i64 mld_desc2, i8 oaccd_pos, i8 dyn, i8 mld_type, i8 scope, i8 m, i8 n, i8 sext, i32 cache_policy, i8 pattern, i8 bcast_bar)
```

##### 函数名修饰符

.dwidth = {.4b, .8b, .16b, .32b}： 代表一个矩阵元素在L0时所占bit数

##### 返回值类型

ret_type: 向量类型vlen * dtype

- dtype对应宽度需要与dwidth保持一致, {i8: .8b}, {f16, bf16: .16b}, {i32, f32: .32b}, {fp4e2m1: .4b，.8b}（与dwidth修饰符相关）, {fp6e2m3: .8b}
- vlen为m*n的倍数

##### 参数

*相比mld intrinsic，cmld intrinsic增加了pattern，bcast_bar两个参数*

mld_desc0, mld_desc1, mld_desc2: 对应mldst_descriptor0, mldst_descriptor1, mldst_descriptor2

oaccd_pos: 加载的矩阵在返回类型中的偏移，单位是64Byte

dyn:

- 0:表示矩阵计算过程中采用静态形状计算，忽略mld_desc2的内容
- 1:表示矩阵计算过程中采用动态形状计算，受到mld_desc2的影响

mld_type:

- 0 MLD_TYPE::load-and-extend
- 1 (reserved)
- 2 MLD_TYPE::load-exact-elements 数值对应信息参见SIP5.0_Arch_Spec_2D_Compute中的“矩阵Memory存储格式和访问类型”章节

scope: 被加载矩阵地址所属地址空间

- 0: generic
- 1: local
- 2: shared

m: 被加载矩阵的dim1 size

n: 被加载矩阵的dim0 size

sext: 当mld_type = 2 (MLD_TYPE::load-exact-element)时生效

- 0: 矩阵加载上来后到L0会做高位0拓展
- 1：矩阵加载上来后到L0会做高位符号拓展

cache_policy ：32bit掩码，用于指定缓存与预取行为，支持{0, 1, 4, 5}

| 位段 | 名称 | 描述 |
| --- | --- | --- |
| `[1:0]` | `llc_alo_pri` | llc allocation priority |
| `[2]` | `hw_pf` | hardware prefetch 使能位 |
| `[5:3]` | `cop_ld` | cache policy |
| 其他位 | - | 保留，必须为 0 |

pattern: 表达协同加载的广播模式

- 0： 1*4
- 1： 2*2 （reserved）
- 2： 1*8
- 3： 2*2*2 （reserved）

bcast_bar: 表达广播destination关联的2D bcast operand barrier

#### 'llvm.efvm.mst.*' intrinsics

```
declare void @llvm.efvm.mst.<dwidth>(<mst_type> matrix, i64 mld_desc0, i64 mld_desc1, i64 mld_desc2, i64 notify_bar_addr, i8 oaccs1_pos, i8 dyn, i8 sync, i8 notify, i8 scope, i8 m, i8 n, i32 cache_policy)
```

##### 函数名修饰符

.dwidth = {.4b, .8b, .16b, .32b}：代表一个矩阵元素在store回内存时所占的bit数，与矩阵元素类型有关
{i8: .8b}, {f16, bf16: .16b}, {i32, f32: .32b}, {fp4e2m1: .4b, 8b}, {fp6e2m3: .8b}

##### 返回值类型

void

##### 参数

mst_type: 向量类型vlen * dtype, 其中，dtype对应宽度需要与dwidth保持一致，vlen为m*n的倍数

matrix: 被存储的矩阵变量

mld_desc0, mld_desc1, mld_desc2: 对应mldst_descriptor0, mldst_descriptor1, mldst_descriptor2

oaccs1_pos: 被存储的矩阵在返回类型中的偏移，单位是64Byte

dyn:

- 0:表示矩阵计算过程中采用静态形状计算，忽略mld_desc2的内容
- 1:表示矩阵计算过程中采用动态形状计算，受到mld_desc2的影响

sync:

- 0: 表示async_en异步操作
- 1：表示async_dis非异步操作

notify:
当sync = 0时有效

- 0：None
- 1：mbarrier-hwcnt
- 2: mbarrier-swcnt

notify_bar_addr:
当notify = 1（mbarrier-hwcnt）时，notify_bar_addr[47:0]对应的是执行complete_tx操作的mbarrier地址

当notify = 2（mbarrier-swcnt）时，notify_bar_addr[47:0]对应的是执行complete_tx操作的mbarrier地址, notify_bar_addr[63:56]代
表软件配置值用于做complete-tx操作

scope: 被加载矩阵地址所属地址空间

- 0: generic
- 1: local
- 2: shared
- 3: global
- 4: constant

m: 被存储矩阵的dim1 size

n: 被存储矩阵的dim0 size

cache_policy ：32bit掩码，用于指定缓存与预取行为，支持{0, 1, 4, 5}

| 位段 | 名称 | 描述 |
| --- | --- | --- |
| `[1:0]` | `llc_alo_pri` | llc allocation priority |
| `[2]` | `hw_pf` | hardware prefetch 使能位 |
| `[5:3]` | `cop_ld` | cache policy |
| 其他位 | - | 保留，必须为 0 |

### 4.7. MSHF Intrinsic

#### "llvm.efvm.matrix.slice*" intrinsics

```
declare <vector_type> llvm.efvm.matrix.shuffle(<vector_type> src, i8 slice_dim0_strip_stride, i8 dim0_strip_num, i8 dim0_strip_size, i8 dim1_stride, i8 dim1_size, i8 src_offset, i8 oaccd_pos, i8 trans_mode)
```

##### 概述

*llvm.efvm.matrix.shuffle*函数将一个一维向量形式的矩阵，按照指定的起始位置，条带大小，条带间隔，总行数，分割出一个子矩阵，或是从代表多个连续存放小矩阵的一维向量中拼凑出一个大矩阵，按照指定偏移存放到指定向量中位置示意图如下：

```
            |slice_src_offset|slice_dim0_strip_stride|
OACC start  |                |-----slice_dim0_|      |-----slice_dim0_|
            |                |     strip_size |      |     strip_size |
    --------|---------------------------------------------------------|
      |     |                |-----strip0-----|      |-----strip1-----|
  slice_dim1_---------------------------------------------------------|
strip_stride                                                          |
      |     |                                                         |
    --------|---------------------------------------------------------|
            |                |-----strip0-----|      |-----strip1-----|
            |---------------------------------------------------------|
                             |------slice_dim0_strip_num=2------------|
```

##### 返回值类型

vector_type: 向量类型vlen * dtype * n

- vlen：要分割出的矩阵形状（dim1_size, dim0_size), vlen = dim1_size * dim0_size
- dtype：矩阵元素类型，与源矩阵元素类型相同
- 因oaccd_pos存在，返回值的向量类型是矩阵大小的整数倍

##### 参数

src：输出操作数矩阵

slice_dim0_strip_stride_in_bytes：表示实际slice出来的矩阵的条带间隔，slice_dim0_strip_stride_in_bytes = 1 << (n + 3)， n = 0~127，且slice_dim0_strip_stride_in_bytes是slice_dim0_strip_size_in_bytes的2的幂次方倍

slice_dim0_strip_num：表示实际slice出来的矩阵的条带数量，取值2，4，16，256

slice_dim0_strip_size_in_bytes：表示实际slice出来的矩阵的条带大小，slice_dim0_strip_size_in_bytes = 1 << (n + 3)，n = 0~31

slice_dim1_stride_in_bytes：表示实际slice出来的矩阵在源操作数上的行间隔，slice_dim1_stride_in_bytes = 1 << (n + 3), n = 0~31

slice_dim1_size_in_bytes: 表示实际结果矩阵的行数，slice_dim1_size_in_bytes = 1 << n, n = 0~255

src_offset_in_bytes: 表示从slice前的源矩阵的一个偏移量开始取操作数的位置

oaccd_pos: 以矩阵大小output_matrix_size_in_bytes（output_matrix_size_in_bytes = slice_dim1_size * slice_dim0_strip_num * slice_dim0_strip_size_in_bytes)为单位，表示目的地数据偏移

trans_mode: 表示以128byte（DACC）为单位的小矩阵，内部transpose的方式，以下矩阵表达是M*N*BPE的格式

- 0 reshape 32*4*1 -> 4*32*1
- 1 reshape 16*8*1 -> 8*16*1
- 2 reshape 8*16*1 -> 16*8*1
- 3 reshape 4*32*1 -> 32*4*1
- 4 reshape 32*2*2 -> 32*2*2
- 5 reshape 16*4*2 -> 4*16*2
- 6 reshape 8*8*2 -> 8*8*2
- 7 reshape 4*16*2 -> 16*4*2
- 8 reshape 2*32*2 -> 32*2*2
- 9 reshape 32*1*4 -> 1*32*4
- 10 reshape 16*2*4 -> 2*16*4
- 11 reshape 8*4*4 -> 4*8*4
- 12 reshape 4*8*4 -> 8*4*4
- 13 reshape 2*16*4 -> 16*2*4
- 14 reshape 1*32*4 -> 32*1*4
- 15 No Transpose

### 4.8. Load

```
declare <type> @llvm.efvm.load.<type>.p<n><type>(type addrspace(<n>)* addr, ...)
```

load指令用于从指定memory位置，加载指定类型的数据。

#### Scalar Load

- type : 被加载的数据类型，支持{i64, i32, i8, f32, f16, bf16}
- n : 指针所在的地址空间编号(区别于硬件编码数值)，用来指定加载的内存区域，支持{0(generic), 1(global), 3(shared), 4(constant), 5(stack), 9(local)}
- addr ： 待加载数据地址，类型和type一致
- ... : 可变参数 cache_policy ：32bit掩码，用于指定缓存与预取行为，支持{0, 1, 4, 5}
  | 位段 | 名称 | 描述 |
  | --- | --- | --- |
  | `[1:0]` | `llc_alo_pri` | LLC allocation priority |
  | `[2]` | `hw_pf` | hardware prefetch 使能位 |
  | `[5:3]` | `cop_ld` | cache policy |
  | 其他位 | - | 保留，必须为 0 |

#### Vector Load (SIMD)

- type : 被加载的数据类型，支持{v128i64, v128i32, v128f32，v256i16, v512i8, v256f16, v256bf16}
- n : 指针所在的地址空间编号，用来指定加载的内存区域，支持{0(generic), 1(global), 3(shared), 4(constant), 5(stack), 9(local)}
- addr ： 待加载数据地址，类型和type一致
- ... : 可变参数 mask : 作为元素为单位的条件执行标志位，类型为v<元素个数>i1 cache_policy ：32bit掩码，用于指定缓存与预取行为，支持{0, 1, 4, 5}
  | 位段 | 名称 | 描述 |
  | --- | --- | --- |
  | `[1:0]` | `llc_alo_pri` | LLC allocation priority |
  | `[2]` | `hw_pf` | hardware prefetch 使能位 |
  | `[5:3]` | `cop_ld` | cache policy |
  | 其他位 | - | 保留，必须为 0 |

#### Load (SIMT)

- type : 被加载的数据类型，支持{i64, i32, i16, i8, f32, f16, bf16, v2i16, v4i8, v2f16, v2bf16}
- n : 指针所在的地址空间编号，用来指定加载的内存区域，支持{0(generic), 1(global), 3(shared), 4(constant), 5(stack), 9(local)}
- addr ： 待加载数据地址，类型和type一致
- ... : 可变参数 cache_policy ：32bit掩码，用于指定缓存与预取行为，支持{0, 1, 4, 5}
  | 位段 | 名称 | 描述 |
  | --- | --- | --- |
  | `[1:0]` | `llc_alo_pri` | LLC allocation priority |
  | `[2]` | `hw_pf` | hardware prefetch 使能位 |
  | `[5:3]` | `cop_ld` | cache policy |
  | 其他位 | - | 保留，必须为 0 |

### 4.9. Store

```
declare @llvm.efvm.store.<type>.p<n><type>(<type> val, <type> addrspace(<n>)* addr, ...)
```

store指令用于向指定memory位置，写入指定类型的数据。

#### Scalar Store

- type : 待存储的数据类型，支持{i64, i32, i8, f32, f16, bf16}
- n : 指针所在的地址空间编号，用来指定待存储的内存区域，支持{0(generic), 1(global), 3(shared), 5(stack), 9(local)}
- addr ： 待存储数据地址，类型和type一致
- ... : 可变参数 cache_policy ：32bit掩码，用于指定缓存与预取行为，支持{0, 1, 5}
  | 位段 | 名称 | 描述 |
  | --- | --- | --- |
  | `[1:0]` | `llc_alo_pri` | LLC allocation priority |
  | `[2]` | `cop_st` | cache policy |
  | `[4:3]` | `esl_order` | hardware prefetch 使能位, 在访问L3时有效 |
  | 其他位 | - | 保留，必须为 0 |

#### Vector Store (SIMD)

- type : 被加载的数据类型，支持{v128i64, v128i32, v128f32，v256i16, v512i8, v256f16, v256bf16}
- n : 指针所在的地址空间编号，用来指定加载的内存区域，支持{0(generic), 1(global), 3(shared), 5(stack), 9(local)}
- addr ： 待存储数据地址，类型和type一致
- ... : 可变参数 mask : 作为元素为单位的条件执行标志位，类型为v<元素个数>i1 cache_policy ：32bit掩码，用于指定缓存与预取行为，支持{0, 1, 5}
  | 位段 | 名称 | 描述 |
  | --- | --- | --- |
  | `[1:0]` | `llc_alo_pri` | LLC allocation priority |
  | `[2]` | `cop_st` | cache policy |
  | `[4:3]` | `esl_order` | hardware prefetch 使能位, 在访问L3时有效 |
  | 其他位 | - | 保留，必须为 0 |

#### Store (SIMT)

- type : 待存储的数据类型，支持{i64, i32, i16, i8, f32, f16, bf16, v2i16, v4i8, v2f16, v2bf16}
- n : 指针所在的地址空间编号，用来指定待存储来源的内存区域，支持{0(generic), 1(global), 3(shared), 5(stack), 9(local)}
- addr ： 待存储数据地址，类型和type一致
- ... : 可变参数 cache_policy ：32bit掩码，用于指定缓存与预取行为，支持{0, 1, 5}
  | 位段 | 名称 | 描述 |
  | --- | --- | --- |
  | `[1:0]` | `llc_alo_pri` | LLC allocation priority |
  | `[2]` | `cop_st` | cache policy |
  | `[4:3]` | `esl_order` | UVA超节点的Fence控制位, 在访问L3时有效 |
  | 其他位 | - | 保留，必须为 0 |

### 4.10. Atomic

**AMO Scalar：**

- 标量带返回值(AMO.Op) ： cas、exch、add、and、or、xor、max、maxnum、min、inc、dec
- 标量不带返回值(RED.Op) ：add、or、xor、max、maxnum、min、inc、dec

**AMO vector：**

- Linear寻址模式的不带返回值的向量原子操作指令（REDV.Op）：add、max、maxnum
- Gather-Scatter寻址模式的带返回值的向量原子操作指令（AMOVXIi32.Op 和 AMOVXIi64.Op）：acs、exch、add、and、or、xor、max、maxnum、min、inc、dec
- Gather-Scatter寻址模式的不带返回值的向量原子操作指令（REDVXIi32.Op 和 REDVXIi64.Op）： add、and、or、xor、max、maxnum、min、inc、dec、pop.inc

**对应的EFVM IR也分如下5类：**

- llvm.efvm.atomic.op
- llvm.efvm.atomic.void.op
- llvm.efvm.atomic.gs.op
- llvm.efvm.atomic.gs.void.op
- llvm.efvm.atomic.void.op （参数个数相同，且均无返回值所以与标量使用相同的EFVMIR）

#### Scalar Atomic

**标量带返回值：**

```
declare <type> @llvm.efvm.atomic.op.<sign>(<ptype> addrspace(<n>)* addr, <type> val[, i32 mode])
```

**标量不带返回值：**

```
declare void @llvm.efvm.atomic.void.op.<sign>(<ptype> addrspace(<n>)* addr, <type> val[, i32 mode])
```

原子地将addr指向内存的数据读出和val数值进行相应操作, 结果写回addr指向内存, 带返回值时需将原值存入返回值。

- type : 被加载的数据类型，该类型与val 参数的类型保持一致。
- sign : 操作数据类型对应的符号标识。由于LLVMIR 无法区分 sign 和 unsigned，所以需要通过名称来区分,后缀与type的对应关系如下：
  | 后缀 | type |
  | --- | --- |
  | s | int32 int64 |
  | u | uint32 uint64 |
  | s16 | int16 |
  | u16 | uint16 |
  | f | fp16 bf16 fp32 |
  |  |  |
- ptype: addr 地址类型，如i8
- addrspace: 指针所在的地址空间编号，用来指定处理的内存区域，支持{0(generic), 1(global), 3(shared), 9(local)}
- addr ：读写数据的地址
- val ： 操作数
- mode : 可变参数，表示可配置域，将llc_alo_pri、cop_st、esl_order域统一打包到mode参数，默认为0.
  - llc_alo_pri： LLC allocation priority 0：stream 1：normal 2：residency 3：reserved
  - cop_st： cache policy， 0：wbmr: 1：wb
  - esl_order： UVA超节点的Fence控制位, 在访问L3时有效，0：null 1：baseline_fence
  - satfinite： 只有add 运算有sat控制位， 仅对浮点类型（FP16、BF16、FP8E4M3、FP8E5M2）计算结果有效。

**Intrinsics list**

**带返回值**

| OP | Intrinsic function | support type | support addrspace |
| --- | --- | --- | --- |
| add | llvm.efvm.atomic.add.s<br>llvm.efvm.atomic.add.u<br>llvm.efvm.atomic.add.f<br>llvm.efvm.atomic.add.u16<br>llvm.efvm.atomic.add.s16 | uint16 int16 uint32 int32<br>uint64 int64 fp16 bf16 fp32 | generic global<br>shared local |
| and | llvm.efvm.atomic.and.s<br>llvm.efvm.atomic.and.u | uint32 int32 uint64 int64 | 同上 |
| o | llvm.efvm.atomic.or.s<br>llvm.efvm.atomic.or.u | uint32 int32 uint64 int64 | 同上 |
| xo | llvm.efvm.atomic.xor.s<br>llvm.efvm.atomic.xor.u | uint32 int32 uint64 int64 | 同上 |
| min | llvm.efvm.atomic.min.s<br>llvm.efvm.atomic.min.u | uint32 int32 uint64 int64 | 同上 |
| max | llvm.efvm.atomic.max.s<br>llvm.efvm.atomic.max.u<br>llvm.efvm.atomic.max.f | uint32 int32 uint64 int64<br>fp16 bf16 fp32 | 同上 |
| maxnum | llvm.efvm.atomic.maxnum.s<br>llvm.efvm.atomic.maxnum.u<br>llvm.efvm.atomic.maxnum.f | uint32 int32 uint64 int64<br>fp16 bf16 fp32 | 同上 |
| inc | llvm.efvm.atomic.inc.u | uint32 uint64 | 同上 |
| dec | llvm.efvm.atomic.dec.u | uint32 uint64 | 同上 |
| exch | llvm.efvm.atomic.exch.s<br>llvm.efvm.atomic.exch.u | uint32 int32 uint64 int64 | 同上 |
| cas | llvm.efvm.atomic.cas.s<br>llvm.efvm.atomic.cas.u<br>llvm.efvm.atomic.cas.s16<br>llvm.efvm.atomic.cas.u16 | uint16 int16 uint32 int32<br>uint64 int64 int16 uint16 | 同上 |
|  |  |  |  |

**无返回值**

| OP | Intrinsic function | support type | support addrspace |
| --- | --- | --- | --- |
| add | llvm.efvm.atomic.void.add.s<br>llvm.efvm.atomic.void.add.u<br>llvm.efvm.atomic.void.add.f<br>llvm.efvm.atomic.void.add.u16<br>llvm.efvm.atomic.void.add.s16 | uint16 int16 uint32 int32<br>uint64 int64 fp16 bf16 fp32 | generic global<br>shared local |
| and | llvm.efvm.atomic.void.and.s<br>llvm.efvm.atomic.void.and.u | uint32 int32 uint64 int64 | 同上 |
| o | llvm.efvm.atomic.void.or.s<br>llvm.efvm.atomic.void.or.u | uint32 int32 uint64 int64 | 同上 |
| xo | llvm.efvm.atomic.void.xor.s<br>llvm.efvm.atomic.void.xor.u | uint32 int32 uint64 int64 | 同上 |
| min | llvm.efvm.atomic.void.min.s<br>llvm.efvm.atomic.void.min.u | uint32 int32 uint64 int64 | 同上 |
| max | llvm.efvm.atomic.void.max.s<br>llvm.efvm.atomic.void.max.u<br>llvm.efvm.atomic.void.max.f | uint32 int32 uint64 int64<br>fp16 bf16 fp32 | 同上 |
| maxnum | llvm.efvm.atomic.void.maxnum.s<br>llvm.efvm.atomic.void.maxnum.u<br>llvm.efvm.atomic.void.maxnum.f | uint32 int32 uint64 int64<br>fp16 bf16 fp32 | 同上 |
| inc | llvm.efvm.atomic.void.inc.u | uint32 uint64 | 同上 |
| dec | llvm.efvm.atomic.void.dec.u | uint32 uint64 | 同上 |
|  |  |  |  |

**IR举例**
IR 上会自动添加签名，调用时直接使用efvm.atomic.add.s 或 llvm.efvm.atomic.add.f 即可

```
  %24 = tail call i32 (i8*, i32, ...) @llvm.efvm.atomic.add.s.i32.p0i8.i32(i8* %0, i32 %6)
  %25 = tail call i32 (i8 addrspace(9)*, i32, ...) @llvm.efvm.atomic.add.s.i32.p9i8.i32(i8 addrspace(9)* %3, i32 %6)
  %26 = tail call i32 (i8 addrspace(3)*, i32, ...) @llvm.efvm.atomic.add.s.i32.p3i8.i32(i8 addrspace(3)* %2, i32 %6)
  %27 = tail call i32 (i8 addrspace(1)*, i32, ...) @llvm.efvm.atomic.add.s.i32.p1i8.i32(i8 addrspace(1)* %1, i32 %6)
  %44 = tail call float (i8*, float, ...) @llvm.efvm.atomic.add.f.f32.p0i8.f32(i8* %0, float %12)

  tail call void (i8*, i32, ...) @llvm.efvm.atomic.void.add.u.p0i8.i32(i8* %0, i32 %7)
  tail call void (i8 addrspace(9)*, i32, ...) @llvm.efvm.atomic.void.add.u.p9i8.i32(i8 addrspace(9)* %3, i32 %7)
  tail call void (i8 addrspace(3)*, i32, ...) @llvm.efvm.atomic.void.add.u.p3i8.i32(i8 addrspace(3)* %2, i32 %7)
  tail call void (i8 addrspace(1)*, i32, ...) @llvm.efvm.atomic.void.add.u.p1i8.i32(i8 addrspace(1)* %1, i32 %7)
```

#### Vector Atomic

**向量Gather-Scatter寻址模式的带返回值：**

```
declare <type> @llvm.efvm.atomic.gs.op.<sign>(<ptype> addrspace(<n>)* addr, <off_type> offset, <type> val0[, mt mask])
```

原子地将基地址addr加上offset(i32 或 i64)指向内存的数据和val进行相应操作, 结果写回addr指向内存, 原值存入返回值。

- type : 被加载的数据类型，该类型与val 参数的类型保持一致
- sign : 操作数据类型对应的符号标识。s: char、short、s32、s64 u:uchar、ushort、u32、u64 f:bf16、fp16、f32
- ptype: addr 地址类型，如i8
- n : 指针所在的地址空间编号，用来指定处理的内存区域，gs 支持{0(generic), 9(local)}
- addr ： 读写数据的基地址
- off_type : 数据元素在Memory中相对于基地址的偏移，类型为v<元素个数>i32 或 v<元素个数>i64， 后端根据 off_type 选择使用 amovxi32 或 amovxi64 指令
- offset ： 读写数据相对于基地址的偏移
- val : 操作数
- ... : 可选参数
  - mask : 作为元素为单位的条件执行标志位，类型为mt: v<元素个数>i1
- sat： 只对 add 操作有效，参数不变，只是在接口名称上加了sat关键字。仅对浮点类型（FP16、BF16、FP8E4M3、FP8E5M2）计算结果有效。
  ```
  declare <type> @llvm.efvm.atomic.gs.add.sat.<sign>(<ptype> addrspace(<n>)* addr, <off_type> offset, <type> val0[, mt mask])
  ```

**Intrinsics list**

| OP | Intrinsic function | support type | support addrspace |
| --- | --- | --- | --- |
| add | llvm.efvm.atomic.gs.add.s<br>llvm.efvm.atomic.gs.add.u<br>llvm.efvm.atomic.gs.add.f<br>llvm.efvm.atomic.gs.add.sat.f | uint16 int16 uint32 int32<br>uint64 int64 fp16 bf16 fp32 | generic<br>local |
| and | llvm.efvm.atomic.gs.and.s<br>llvm.efvm.atomic.gs.and.u | uint32 int32 uint64 int64 | 同上 |
| or | llvm.efvm.atomic.gs.or.s<br>llvm.efvm.atomic.gs.or.u | uint32 int32 uint64 int64 | 同上 |
| xor | llvm.efvm.atomic.gs.xor.s<br>llvm.efvm.atomic.gs.xor.u | uint32 int32 uint64 int64 | 同上 |
| min | llvm.efvm.atomic.gs.min.s<br>llvm.efvm.atomic.gs.min.u | uint32 int32 uint64 int64 | 同上 |
| max | llvm.efvm.atomic.gs.max.s<br>llvm.efvm.atomic.gs.max.u<br>llvm.efvm.atomic.gs.max.f | uint32 int32 uint64 int64<br>fp16 bf16 fp32 | 同上 |
| maxnum | llvm.efvm.atomic.gs.maxnum.s<br>llvm.efvm.atomic.gs.maxnum.u<br>llvm.efvm.atomic.gs.maxnum.f | uint32 int32 uint64 int64<br>fp16 bf16 fp32 | 同上 |
| inc | llvm.efvm.atomic.gs.inc.u | uint32 uint64 | 同上 |
| dec | llvm.efvm.atomic.gs.dec.u | uint32 uint64 | 同上 |
| exch | llvm.efvm.atomic.gs.exch.s<br>llvm.efvm.atomic.gs.exch.u | uint32 int32 uint64 int64 | 同上 |
| cas | llvm.efvm.atomic.gs.cas.s<br>llvm.efvm.atomic.gs.cas.u | uint16 int16 uint32 int32<br>uint64 int64 int16 uint16 | 同上 |
|  |  |  |  |

**IR举例**

```
  %51 = tail call <128 x i32> (i8*, <128 x i32>, <128 x i32>, ...) @llvm.efvm.atomic.gs.add.s.v128i32.p0i8.v128i32.v128i32(i8* %0, <128 x i32> %8, <128 x i32> %5, <128 x i1> %4)
  %52 = tail call <128 x i32> (i8 addrspace(9)*, <128 x i32>, <128 x i32>, ...) @llvm.efvm.atomic.gs.add.s.v128i32.p9i8.v128i32.v128i32(i8 addrspace(9)* %3, <128 x i32> %8, <128 x i32> %5, <128 x i1> %4)
  %43 = tail call <256 x bfloat> (i8*, <256 x i32>, <256 x bfloat>, ...) @llvm.efvm.atomic.gs.add.sat.f.v256bf16.p0i8.v256i32.v256bf16(i8* %0, <256 x i32> undef, <256 x bfloat> undef, <256 x i1> %12)
```

**向量Gather-Scatter寻址模式的无返回值：**

```
declare void @llvm.efvm.atomic.gs.void.<notify>.op.<sign>(<ptype> addrspace(<n>)* addr, <off_type> offset, <type> val[, void* mbar, char count, mt mask, i32 mode])
```

原子地将基地址addr加上offset(i32 或 i64)指向内存的数据和val进行相应操作, 结果写回addr指向内存, 不需要返回原值。
REDVX 系列指令包含多个可配置域，所以需要额外提供mode和mbar参数用于可配置域设置。

- notify : {"", async.mbar.swcnt, async.mbar.hwcnt}, 当notify为 hwcnt时参数mbar对应的是执行complete_tx操作的mbarrier地址， 当为swcnt时，参数mbar对应的是执行complete_tx操作的mbarrier地址, 参数count代表软件配置值用于做complete-tx操作。
- sign : 操作数据类型对应的符号标识。s: char、short、s32、s64 u:uchar、ushort、u32、u64 f:bf16、fp16、f32
- ptype: addr 地址类型，如i8
- n : 指针所在的地址空间编号，用来指定处理的内存区域，支持{0(generic), 1(global), 3(shared), 9(local)}
- addr ： 读写数据的基地址
- off_type : 数据元素在Memory中相对于基地址的偏移，类型为v<元素个数>i32 或 v<元素个数>i64， 后端根据 off_type 选择使用 redvxi32 或 redvxi64 指令
- offset ： 读写数据相对于基地址的偏移
- type : 被加载的数据类型，该类型与val 参数的类型保持一致
- val : 操作数
- ... : 可选参数
  - mbar : notify域有效时用于指定同步机制；mbar 表示notify_bar_addr。
  - count：notify域为async.mbar.swcnt时 用于表示做complete-tx操作的值。
  - mask : 作为元素为单位的条件执行标志位，类型为mt: <元素个数 x i1>。如果未指定则为无条件执行。
  - mode ：用户可配置域，用于修改当前指令可配置域。将 llc_alo_pri、cop_st、esl_order 域统一打包到 mode 参数，默认为 0。
    - llc_alo_pri：LLC allocation priority。0：stream；1：normal；2：residency；3：reserved。
    - cop_st：cache policy。0：wbmr；1：wb。
    - esl_order：UVA 超节点的 Fence 控制位，在访问 L3 时有效。0：null；1：baseline_fence。cas 指令不支持 esl 域。
    - satfinite：只有 add 运算有 sat 控制位，仅对浮点类型（FP16、BF16、FP8E4M3、FP8E5M2）计算结果有效。

**Intrinsics list**

| OP | Intrinsic function | support type | support addrspace |
| --- | --- | --- | --- |
| add | llvm.efvm.atomic.gs.void.add.s<br>llvm.efvm.atomic.gs.void.add.u<br>llvm.efvm.atomic.gs.void.add.f | uint16 int16 uint32 int32<br>uint64 int64 fp16 bf16 fp32 | generic global<br>shared local |
| and | llvm.efvm.atomic.gs.void.and.s<br>llvm.efvm.atomic.gs.void.and.u | uint32 int32 uint64 int64 | 同上 |
| or | llvm.efvm.atomic.gs.void.or.s<br>llvm.efvm.atomic.gs.void.or.u | uint32 int32 uint64 int64 | 同上 |
| xor | llvm.efvm.atomic.gs.void.xor.s<br>llvm.efvm.atomic.gs.void.xor.u | uint32 int32 uint64 int64 | 同上 |
| min | llvm.efvm.atomic.gs.void.min.s<br>llvm.efvm.atomic.gs.void.min.u | uint32 int32 uint64 int64 | 同上 |
| max | llvm.efvm.atomic.gs.void.max.s<br>llvm.efvm.atomic.gs.void.max.u<br>llvm.efvm.atomic.gs.void.max.f | uint32 int32 uint64 int64<br>fp16 bf16 fp32 | 同上 |
| maxnum | llvm.efvm.atomic.gs.void.maxnum.s<br>llvm.efvm.atomic.gs.void.maxnum.u<br>llvm.efvm.atomic.gs.void.maxnum.f | uint32 int32 uint64 int64<br>fp16 bf16 fp32 | 同上 |
| inc | llvm.efvm.atomic.gs.void.inc.u | uint32 uint64 | 同上 |
| dec | llvm.efvm.atomic.gs.void.dec.u | uint32 uint64 | 同上 |
| popc.inc | llvm.efvm.atomic.gs.void.popc.inc.u | uint32 | global local |
|  |  |  |  |

**async hwcnt**

| OP | Intrinsic function | support type | support addrspace |
| --- | --- | --- | --- |
| add | llvm.efvm.atomic.gs.void.async.mbar.hwcnt.add.s<br>llvm.efvm.atomic.gs.void.async.mbar.hwcnt.add.u<br>llvm.efvm.atomic.gs.void.async.mbar.hwcnt.add.f | uint16 int16 uint32 int32<br>uint64 int64 fp16 bf16 fp32 | shared local |
| and | llvm.efvm.atomic.gs.void.async.mbar.hwcnt.and.s<br>llvm.efvm.atomic.gs.void.async.mbar.hwcnt.and.u | uint32 int32 uint64 int64 | 同上 |
| o | llvm.efvm.atomic.gs.void.async.mbar.hwcnt.or.s<br>llvm.efvm.atomic.gs.void.async.mbar.hwcnt.or.u | uint32 int32 uint64 int64 | 同上 |
| xo | llvm.efvm.atomic.gs.void.async.mbar.hwcnt.xor.s<br>llvm.efvm.atomic.gs.void.async.mbar.hwcnt.xor.u | uint32 int32 uint64 int64 | 同上 |
| min | llvm.efvm.atomic.gs.void.async.mbar.hwcnt.min.s<br>llvm.efvm.atomic.gs.void.async.mbar.hwcnt.min.u | uint32 int32 uint64 int64 | 同上 |
| max | llvm.efvm.atomic.gs.void.async.mbar.hwcnt.max.s<br>llvm.efvm.atomic.gs.void.async.mbar.hwcnt.max.u<br>llvm.efvm.atomic.gs.void.async.mbar.hwcnt.max.f | uint32 int32 uint64 int64<br>fp16 bf16 fp32 | 同上 |
| maxnum | llvm.efvm.atomic.gs.void.async.mbar.hwcnt.maxnum.s<br>llvm.efvm.atomic.gs.void.async.mbar.hwcnt.maxnum.u<br>llvm.efvm.atomic.gs.void.async.mbar.hwcnt.maxnum.f | uint32 int32 uint64 int64<br>fp16 bf16 fp32 | 同上 |
| inc | llvm.efvm.atomic.gs.void.async.mbar.hwcnt.inc.u | uint32 uint64 | 同上 |
| dec | llvm.efvm.atomic.gs.void.async.mbar.hwcnt.dec.u | uint32 uint64 | 同上 |
| popc.inc | llvm.efvm.atomic.gs.void.async.mbar.hwcnt.popc.inc.u | uint32 | local |
|  |  |  |  |

**async swcnt**

| OP | Intrinsic function | support type | support addrspace |
| --- | --- | --- | --- |
| add | llvm.efvm.atomic.gs.void.async.mbar.swcnt.add.s<br>llvm.efvm.atomic.gs.void.async.mbar.swcnt.add.u<br>llvm.efvm.atomic.gs.void.async.mbar.swcnt.add.f | uint16 int16 uint32 int32<br>uint64 int64 fp16 bf16 fp32 | shared local |
| and | llvm.efvm.atomic.gs.void.async.mbar.swcnt.and.s<br>llvm.efvm.atomic.gs.void.async.mbar.swcnt.and.u | uint32 int32 uint64 int64 | 同上 |
| o | llvm.efvm.atomic.gs.void.async.mbar.swcnt.or.s<br>llvm.efvm.atomic.gs.void.async.mbar.swcnt.or.u | uint32 int32 uint64 int64 | 同上 |
| xo | llvm.efvm.atomic.gs.void.async.mbar.swcnt.xor.s<br>llvm.efvm.atomic.gs.void.async.mbar.swcnt.xor.u | uint32 int32 uint64 int64 | 同上 |
| min | llvm.efvm.atomic.gs.void.async.mbar.swcnt.min.s<br>llvm.efvm.atomic.gs.void.async.mbar.swcnt.min.u | uint32 int32 uint64 int64 | 同上 |
| max | llvm.efvm.atomic.gs.void.async.mbar.swcnt.max.s<br>llvm.efvm.atomic.gs.void.async.mbar.swcnt.max.u<br>llvm.efvm.atomic.gs.void.async.mbar.swcnt.max.f | uint32 int32 uint64 int64<br>fp16 bf16 fp32 | 同上 |
| maxnum | llvm.efvm.atomic.gs.void.async.mbar.swcnt.maxnum.s<br>llvm.efvm.atomic.gs.void.async.mbar.swcnt.maxnum.u<br>llvm.efvm.atomic.gs.void.async.mbar.swcnt.maxnum.f | uint32 int32 uint64 int64<br>fp16 bf16 fp32 | 同上 |
| inc | llvm.efvm.atomic.gs.void.async.mbar.swcnt.inc.u | uint32 uint64 | 同上 |
| dec | llvm.efvm.atomic.gs.void.async.mbar.swcnt.dec.u | uint32 uint64 | 同上 |
| popc.inc | llvm.efvm.atomic.gs.void.async.mbar.swcnt.popc.inc.u | uint32 | local |
|  |  |  |  |

**IR举例**

```
  call void (i8*, <128 x i32>, <128 x i32>, ...) @llvm.efvm.atomic.gs.void.add.u.p0i8.v128i32.v128i32(i8* %0, <128 x i32> %7, <128 x i32> %9)
  call void (i8*, <128 x i32>, <128 x i32>, ...) @llvm.efvm.atomic.gs.void.add.u.p0i8.v128i32.v128i32(i8* %0, <128 x i32> %7, <128 x i32> %9, i32 1)
  call void (i8*, <128 x i32>, <128 x i32>, ...) @llvm.efvm.atomic.gs.void.add.u.p0i8.v128i32.v128i32(i8* %0, <128 x i32> %7, <128 x i32> %9, <128 x i1> %5)
  call void (i8*, <128 x i32>, <128 x i32>, ...) @llvm.efvm.atomic.gs.void.add.u.p0i8.v128i32.v128i32(i8* %0, <128 x i32> %7, <128 x i32> %9, <128 x i1> %5, i32 2)

  call void (i8*, <128 x i32>, <128 x i32>, i8*, ...) @llvm.efvm.atomic.gs.void.async.mbar.hwcnt.add.u.p0i8.v128i32.v128i32.p0i8(i8* %0, <128 x i32> %7, <128 x i32> %9, i8* %6)
  call void (i8*, <128 x i32>, <128 x i32>, i8*, ...) @llvm.efvm.atomic.gs.void.async.mbar.hwcnt.add.u.p0i8.v128i32.v128i32.p0i8(i8* %0, <128 x i32> %7, <128 x i32> %9, i8* %6, i32 1)
  call void (i8*, <128 x i32>, <128 x i32>, i8*, ...) @llvm.efvm.atomic.gs.void.async.mbar.hwcnt.add.u.p0i8.v128i32.v128i32.p0i8(i8* %0, <128 x i32> %7, <128 x i32> %9, i8* %6, <128 x i1> %5)
  call void (i8*, <128 x i32>, <128 x i32>, i8*, ...) @llvm.efvm.atomic.gs.void.async.mbar.hwcnt.add.u.p0i8.v128i32.v128i32.p0i8(i8* %0, <128 x i32> %7, <128 x i32> %9, i8* %6, <128 x i1> %5, i32 2)

  call void (i8*, <128 x i32>, <128 x i32>, i8*, i32, ...) @llvm.efvm.atomic.gs.void.async.mbar.swcnt.add.u.p0i8.v128i32.v128i32.p0i8.i32(i8* %0, <128 x i32> %7, <128 x i32> %9, i8* %6, i32 %13)
  call void (i8*, <128 x i32>, <128 x i32>, i8*, i32, ...) @llvm.efvm.atomic.gs.void.async.mbar.swcnt.add.u.p0i8.v128i32.v128i32.p0i8.i32(i8* %0, <128 x i32> %7, <128 x i32> %9, i8* %6, i32 %13, i32 1)
  call void (i8*, <128 x i32>, <128 x i32>, i8*, i32, ...) @llvm.efvm.atomic.gs.void.async.mbar.swcnt.add.u.p0i8.v128i32.v128i32.p0i8.i32(i8* %0, <128 x i32> %7, <128 x i32> %9, i8* %6, i32 %13, <128 x i1> %5)
  call void (i8*, <128 x i32>, <128 x i32>, i8*, i32, ...) @llvm.efvm.atomic.gs.void.async.mbar.swcnt.add.u.p0i8.v128i32.v128i32.p0i8.i32(i8* %0, <128 x i32> %7, <128 x i32> %9, i8* %6, i32 %13, <128 x i1> %5, i32 2)
```

**linear寻址模式的不带返回值的向量原子操作指令（REDV.Op）**

```
declare void @llvm.efvm.atomic.void.<notify>.op[.mask.mode.]<sign>(<ptype> addrspace(<n>)* addr, <type> val[, void* mbar, mt mask, i32 mode])
```

与 redvx 类指令类似，区别是不带offset参数。
原子地将基地址addr指向内存的数据和val进行相应操作, 结果写回addr指向内存, 不需要返回原值。
REDV 系列指令包含多个可配置域，所以需要额外提供mode和mbar参数用于可配置域设置。

- notify : {"", .mbarrier_hwcnt, .mbarrier_swcnt}, 当notify 不为空时需要提供参数 mbar。
- sign : 操作数据类型对应的符号标识。s: char、short、s32、s64 u:uchar、ushort、u32、u64 f:bf16、fp16、f32
- ptype: addr 地址类型，如i8
- n : 指针所在的地址空间编号，用来指定处理的内存区域，支持{0(generic), 1(global), 3(shared), 9(local)}
- addr ： 读写数据的基地址
- off_type : 数据元素在Memory中相对于基地址的偏移，类型为v<元素个数>i32 或 v<元素个数>i64， 后端根据 off_type 选择使用 redvxi32 或 redvxi64 指令
- offset ： 读写数据相对于基地址的偏移
- type : 被加载的数据类型，该类型与val 参数的类型保持一致
- val : 操作数
- ... : 可选参数
  - mask : 作为元素为单位的条件执行标志位，类型为mt: <元素个数 x i1>。如果未指定则为无条件执行。
  - mbar : notify域有效用于指定同步机制；mbar 表示notify_bar_addr。
  - mode ：用户可配置域，将 llc_alo_pri、cop_st、esl_order 域统一打包到 mode 参数，默认为 0。
    - llc_alo_pri：LLC allocation priority。0：stream；1：normal；2：residency；3：reserved。
    - cop_st：cache policy。0：wbmr；1：wb。
    - esl_order：UVA 超节点的 Fence 控制位，在访问 L3 时有效。0：null；1：baseline_fence。
    - satfinite：只有 add 运算有 sat 控制位，仅对浮点类型（FP16、BF16、FP8E4M3、FP8E5M2）计算结果有效。

**Intrinsics list**

| OP | Intrinsic function | support type | support addrspace |
| --- | --- | --- | --- |
| add | llvm.efvm.atomic.void.add.s<br>llvm.efvm.atomic.void.add.u<br>llvm.efvm.atomic.void.add.f | uint16 int16 uint32 int32<br>uint64 int64 fp16 bf16 fp32 | generic<br>global<br>shared<br>local |
| max | llvm.efvm.atomic.void.max.s<br>llvm.efvm.atomic.void.max.u<br>llvm.efvm.atomic.void.max.f | uint32 int32 uint64 int64<br>fp16 bf16 fp32 | 同上 |
| maxnum | llvm.efvm.atomic.void.maxnum.s<br>llvm.efvm.atomic.void.maxnum.u<br>llvm.efvm.atomic.void.maxnum.f | uint32 int32 uint64 int64<br>fp16 bf16 fp32 | 同上 |
|  |  |  |  |

**async hwcnt**

| OP | Intrinsic function | support type | support addrspace |
| --- | --- | --- | --- |
| add | llvm.efvm.atomic.void.async.mbar.hwcnt.add.s<br>llvm.efvm.atomic.void.async.mbar.hwcnt.add.u<br>llvm.efvm.atomic.void.async.mbar.hwcnt.add.f | uint16 int16 uint32 int32<br>uint64 int64 fp16 bf16 fp32 | shared local |
| max | llvm.efvm.atomic.void.async.mbar.hwcnt.max.s<br>llvm.efvm.atomic.void.async.mbar.hwcnt.max.u<br>llvm.efvm.atomic.void.async.mbar.hwcnt.max.mask.f | uint32 int32 uint64 int64<br>fp16 bf16 fp32 | 同上 |
| maxnum | llvm.efvm.atomic.void.async.mbar.hwcnt.maxnum.s<br>llvm.efvm.atomic.void.async.mbar.hwcnt.maxnum.u<br>llvm.efvm.atomic.void.async.mbar.hwcnt.maxnum.f | uint32 int32 uint64 int64<br>fp16 bf16 fp32 | 同上 |
|  |  |  |  |

**async swcnt**

| OP | Intrinsic function | support type | support addrspace |
| --- | --- | --- | --- |
| add | llvm.efvm.atomic.void.async.mbar.swcnt.add.s<br>llvm.efvm.atomic.void.async.mbar.swcnt.add.u<br>llvm.efvm.atomic.void.async.mbar.swcnt.add.f | uint16 int16 uint32 int32<br>uint64 int64 fp16 bf16 fp32 | shared local |
| max | llvm.efvm.atomic.void.async.mbar.swcnt.max.s<br>llvm.efvm.atomic.void.async.mbar.swcnt.max.u<br>llvm.efvm.atomic.void.async.mbar.swcnt.max.f | uint32 int32 uint64 int64<br>fp16 bf16 fp32 | 同上 |
| maxnum | llvm.efvm.atomic.void.async.mbar.swcnt.maxnum.s<br>llvm.efvm.atomic.void.async.mbar.swcnt.maxnum.u<br>llvm.efvm.atomic.void.async.mbar.swcnt.maxnum.f | uint32 int32 uint64 int64<br>fp16 bf16 fp32 | 同上 |
|  |  |  |  |

**IR举例**

```
  call void (i8*, <128 x float>, ...) @llvm.efvm.atomic.void.add.f.p0i8.v128f32(i8* %0, <128 x float> undef, <128 x i1> %5, i32 2)
  call void (i8*, <128 x float>, i8*, i32, ...) @llvm.efvm.atomic.void.async.mbar.swcnt.add.f.p0i8.v128f32.p0i8.i32(i8* %0, <128 x float> undef, i8* %6, i32 %9)
  call void (i8*, <128 x float>, i8*, i32, ...) @llvm.efvm.atomic.void.async.mbar.swcnt.add.f.p0i8.v128f32.p0i8.i32(i8* %0, <128 x float> undef, i8* %6, i32 %9, i32 1)
  call void (i8*, <128 x float>, i8*, i32, ...) @llvm.efvm.atomic.void.async.mbar.swcnt.add.f.p0i8.v128f32.p0i8.i32(i8* %0, <128 x float> undef, i8* %6, i32 %9, <128 x i1> %5)
  call void (i8*, <128 x float>, i8*, i32, ...) @llvm.efvm.atomic.void.async.mbar.swcnt.add.f.p0i8.v128f32.p0i8.i32(i8* %0, <128 x float> undef, i8* %6, i32 %9, <128 x i1> %5, i32 2)
  call void (i8*, <128 x float>, i8*, ...) @llvm.efvm.atomic.void.async.mbar.hwcnt.add.f.p0i8.v128f32.p0i8(i8* %0, <128 x float> undef, i8* %6, <128 x i1> %5, i32 2)
  call void (i8 addrspace(9)*, <128 x float>, i8*, ...) @llvm.efvm.atomic.void.async.mbar.hwcnt.add.f.p9i8.v128f32.p0i8(i8 addrspace(9)* %3, <128 x float> undef, i8* %6, <128 x i1> %5, i32 2)
```

### 4.11. FMA

```
declare <acc_type> @llvm.efvm.fma.<round_mode>.<type_class>.<type>(<acc_type> acc, <type> a, <type> b, ...)
```

对向量元素执行 acc + (a × b) 融合乘加操作。

- round_mode : FMA 的舍入模式，支持 {rn, rz, rp, rm}
  - rn : round to nearest (四舍五入)
  - rz : round towards zero (向零舍入)
  - rp : round towards positive infinity (向上舍入)
  - rm : round towards minus infinity (向下舍入)

#### FMA (SIMD)

- typeclass : 操作类型类别，用于区分浮点与整数操作，支持 {f, i, u}
  - f : floating-point type class，对应 type 支持 {v128f32, v256f16, v256bf16, v512i8}
  - i : integer type class，对应 type 支持 {v512i8}
  - u : unsigned integer type class，对应 type 支持 {v512i8}
- type : {v128f32, v256f16, v256bf16, v512i8}
- acc_type : 累加类型，必须与type对应，支持 {v128f32, v256f32, v512i32}
  | type | acc_type |
  | --- | --- |
  | v128f32 | v128f32 |
  | v256f16 | v256f32 |
  | v256bf16 | v256f32 |
  | v512i8 | v512i32 |
- ... : 可变参数 mask : 作为元素为单位的条件执行标志位，类型为v<元素个数>i1 mode ：32bit掩码，用于计算控制
  | 位段 | 名称 | 描述 |
  | --- | --- | --- |
  | `[0]` | `ftz` | 处理denoramal数 |
  | `[1]` | `sat` | 溢出控制在类型可表示范围 |
  | 其他位 | - | 保留，必须为 0 |

#### FMA (SIMT)

- typeclass : 操作类型类别，用于区分浮点与整数操作，支持 {f, i, u}
  - f : floating-point type class，对应 type 支持 {f32, f16, bf16, f16x2, bf16x2}
  - i : integer type class，对应 type 支持 {i8, i8x4}
  - u : unsigned integer type class，对应 type 支持 {i8, i8x4}
- type : FMA 操作的输入数据类型，支持 {f32, f16, bf16, f16x2, bf16x2, i8, i8x4}
- acc_type : 累加数据类型（FMA 输出类型），必须与 type 对应, 支持 {f32, i32, v2f32, v4i32}
  | type | acc_type |
  | --- | --- |
  | f32 | f32 |
  | f16 | f32 |
  | f16 | f32 |
  | i8 | i32 |
  | f16x2 | v2f32 |
  | f16x2 | v2f32 |
  | i8x4 | v4i32 |
- ... : 可变参数 mode ：32bit掩码，用于计算控制
  | 位段 | 名称 | 描述 |
  | --- | --- | --- |
  | `[0]` | `ftz` | 处理denoramal数 |
  | `[1]` | `sat` | 溢出控制在类型可表示范围 |
  | 其他位 | - | 保留，必须为 0 |

---

### 4.12. 文档版本

- Version: 0.1.3
- Date: 2025-11-18

### 4.13. Changelog

- **0.1.0 (2025-08-19)**
  - 初始版本，新增Barrier Marrier CP DTE相关EFVM IR
- **0.1.1 (2025-08-22)**
  - 增加部分Gemm相关EFVM IR
  - 增加部分Load/Store/ATOMIC/FMA相关EFVM IR
- **0.1.2 (2025-10-13)**
  - 增加部分address spaces的说明
  - 增加builtin barrier相关的barrier_mode的说明
  - 增加mbarrier.arrive.expect.tx, mbarrier.arrive.drop.expect.tx, mbarrier.test.wait.parity EFVM IR
  - 增加dte.mbarrier.arrive EFVM IR
- **0.1.3 (2025-11-19)**
  - 部分Data Movement intrinsic functions增加multicast_en参数
  - 修改MALU intrinsic functions的名字, 参数类型说明, 合并mac.f16mix, mac.bf16mix, mac.f32mix 为mac.mix
  - 删除MALU AND, XOR的intrinsic functions
