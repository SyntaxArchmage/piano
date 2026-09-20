# 多子线程通信协议

多子线程通信把一个 SIP 内的 sub-thread 分成不同角色，用共享 L1 / SDMEM 承载数据，用 sync / barrier / pipeline / mailbox 表达等待关系，用 fence 表达访存可见性。三者分开设计，才能既避免竞态，又保留 DTE、1D、2D 之间的 overlap。

## 原语选择

- 只需要所有 sub-thread 对齐到同一 phase：用 `tops::sync_subthreads()`。
- 同步点还需要全层级内存序：才用 `__syncsubthreads()`；热路径不要把它当默认同步。隐式宽 fence 会阻塞不相关访存，破坏流水重叠。
- 固定小组内部对齐：用每组独立 `mbarrier` / barrier，`init(count)` 按真实参与者设置。count 过小会提前放行，count 过大会永久等待。
- 规则生产者 / 消费者 staged buffer：用 pipeline / queue。
- 点对点、ring、多角色 handoff：用 mailbox。
- 只需要让本 sub-thread 的写入或读取完成排序：用最小 scope fence，不要升级成 barrier。barrier 会让无关 sub-thread 互等。

## Fence 与等待分离

Fence 只约束当前 sub-thread 的访存顺序；sync、barrier、pipeline、mailbox 才表达“谁等谁”。SIP load/store 发布数据前先 fence，释放 slot 前也要确认读取退休：

```cpp
// producer
write_l1_slot(slot);
tcle::fence<FenceType::L1_VDMEM_STORE>();
notify_mailbox(slot_ready);

// consumer
wait_mailbox(slot_ready);
read_l1_slot(slot);
tcle::fence<FenceType::L1_VDMEM_LOAD>();
notify_mailbox(slot_free);
```

不要只发 mailbox 而不做必要 fence。token 到达只说明控制信号已到，不能证明 L1 数据已经对消费者可见或消费者的读已经退休。

DTE 路径用对应 event / `wait()` 做边界。`wait()` 返回表示这次 DTE 读写已经完成，可以发布 ready 或 free；不要为了同一次 DTE 读写再补一个 L1 fence：

```cpp
wait_mailbox(slot_free);
auto evt = dte.trigger();
evt.wait();
notify_mailbox(slot_ready);
```

## L1 / SDMEM 承载

大块 tile、中间结果和 pipeline stage buffer 放 L1 VDMEM：

```cpp
__local__ __valigned__ char tile_buf[STAGE_NUM][TILE_BYTES];
```

小型控制数据优先放 SDMEM / Parameter / stack local，适合传 mailbox id、DTE 指针和调度状态。承载对象必须活到所有消费者结束；跨 sub-thread 只传地址或 id，生产者提前退出作用域会让消费者继续访问失效对象。

一次性启动发布可用 `tops::sync_subthreads()`：

```cpp
if (sub_id == 0) {
  mailbox[kReady] = alloc_mailbox();
  mailbox[kFree] = alloc_mailbox();
}
tops::sync_subthreads();

int ready = mailbox[kReady];
int free = mailbox[kFree];
```

若控制数据写在 L1 VDMEM 中，发布同步前按写入类型加 store fence。`tops::sync_subthreads()` 只保证到达顺序，不保证这类写入已按目标内存域可见。

## Mailbox Ready / Free 协议

Mailbox 表达 token，而不是表达数据本身。每个可复用 slot 至少需要“ready”和“free”两类状态；ring buffer 初始化时先投放 free token，否则 producer 会在第一轮等待空 slot 时死锁。

```cpp
// producer owns a free slot
wait_mailbox(slot_free);
fill_slot(slot);
tcle::fence<FenceType::L1_VDMEM_STORE>();
notify_mailbox(slot_ready);

// consumer owns a ready slot
wait_mailbox(slot_ready);
consume_slot(slot);
tcle::fence<FenceType::L1_VDMEM_LOAD>();
notify_mailbox(slot_free);
```

若 `fill_slot()` 或 `consume_slot()` 是 DTE 操作，发 token 前等待对应 DTE event；DTE wait 已经证明该 DTE 操作完成。

Token 记账必须和控制流一一对应。漏 notify 会让对端永久等待，多 notify 会让对端提前获得并不真正空闲或就绪的 slot。

同一 mailbox 不要混用多个逻辑含义。token 只有计数语义，无法区分“数据就绪”“slot 空闲”“任务结束”等不同事件。

## Pipeline / Queue 协议

Pipeline 适合规则 staged buffer；每个 stage 的 producer 和 consumer 必须成对操作：

```cpp
pipe.producer_acquire();
fill_stage_buffer();
tcle::fence<FenceType::L1_VDMEM_STORE>();
pipe.producer_commit();

pipe.consumer_wait();
consume_stage_buffer();
tcle::fence<FenceType::L1_VDMEM_LOAD>();
pipe.consumer_release();
```

stage 由 DTE 填充或回写时，`producer_commit()` / `consumer_release()` 前先等对应 DTE event；DTE wait 返回后再转移 stage ownership。

不要在 acquire 前写 stage，也不要在 wait 前读 stage。stage ownership 尚未转移，读写会和上一任 owner 形成 RAW / WAR。

不要漏掉 commit / release。pipeline 的内部计数依赖配对操作，少一次会耗尽 stage，多一次会提前复用 stage。

## 多消费者 Slot 释放

一个 slot 被多个 consumer 读取时，free token 必须等所有 consumer 完成后才能发出：

```cpp
// small group: producer waits every consumer release
notify_mailbox(consumer0_ready);
notify_mailbox(consumer1_ready);
wait_mailbox(consumer0_done);
wait_mailbox(consumer1_done);
notify_mailbox(slot_free);
```

消费者数量少时用点对点 mailbox；消费者数量多时用组内 barrier 后由代表 sub-thread 发 free。不要用单个 consumer 的 done token 代表全组完成；其他 consumer 的 L1 load 可能还没退休，producer 覆写会造成静默数据损坏。

## Barrier 与 Phase

Barrier 用于固定参与者集合的 phase 同步。`arrive()` / `wait()` 分离时必须维护 phase 编号；等待旧 phase 或跳过新 phase 都会让后续参与者与 barrier 状态错位。

`arrive_and_drop()` 只用于之后不再参与同一 barrier 的 sub-thread。drop 会改变后续 phase 的参与者集合，误用会让 count 与真实参与者不一致。

## Hang 排查

同步相关 hang 先按 token 和参与者记账排查：

- 每个 wait 是否有唯一可达的 notify。
- 每个 reusable slot 是否有初始 free token。
- producer ready 前是否已经完成必要 store fence。
- consumer free 前是否已经完成必要 load fence。
- barrier count 是否等于真实参与者，早退路径是否仍会释放 token 或 drop barrier。
- mailbox id / task 指针是否已经发布，承载对象是否仍然存活。
