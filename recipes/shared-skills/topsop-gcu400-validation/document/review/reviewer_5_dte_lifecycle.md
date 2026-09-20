# Reviewer 5 — DTE 生命周期检查

本 reviewer 负责审查 V3 上 `tops::private_dte` / `tops::shared_dte` / `tops::local_dte` 的 init / config / trigger / wait / destroy / connect 时序、event 单次消费、ownership 与 buffer 复用是否正确。

加载 `gcu400-dte` skill：DTE 生命周期硬规则（`wait → reconfig → trigger` 顺序、event 单次消费、`shared_dte` 单 owner、`local_dte` 必须由 init 的 sub-thread destroy、operations 优先级、connect 链 wait 末端 event 即可）统一在此维护。

## 触发条件

target 出现 `tops::private_dte` / `tops::shared_dte` / `tops::local_dte` / `init()` / `config_*()` / `trigger()` / `wait()` / `destroy()` / `connect()` / `set_total_size` 时执行。纯计算 kernel 不涉及 DTE 时返回 `not_applicable`。

## 接口选择默认值

新写 kernel 用 `tops::private_dte` / `tops::shared_dte` / `tops::local_dte`：

- 公共数据广播 / 跨 SIP 搬运 → `shared_dte`
- 私有 tile / 每 SIP 独立路径 → `private_dte` / `local_dte`
- 各 sub-thread 独立搬运 → `private_dte`

## 生命周期闭合

```
init() → config_*() → trigger() → [计算重叠] → wait() → [可重新 config] → ... → destroy()
```

强制约束：

- 旧 event 完成后才可重新 config（命中强制规则锚点）——原因：config 覆写描述符寄存器，进行中搬运读到新描述符产生错误搬运
- 同一 `trigger()` 产出的 event 只能 wait 一次——原因：event 状态在首次 wait 后清除，二次 wait 行为未定义
- buffer 在 event 完成前绝不复用——原因：DTE 异步写入进行中，SIP 侧读写构成 RAW/WAR
- DTE wait 之后才能 SIP load 对应 buffer——原因：DTE 写 L1 未完成时 SIP load 读到旧/不完整数据
- kernel 结束时自带 fence all，不需要在末尾再加 fence

## init / destroy 约束（命中强制规则锚点）

- `local_dte` 必须由执行 `init()` 的 sub-thread 执行 `destroy()`——原因：VC 归属绑定到 init 线程的硬件上下文，跨线程 destroy 不会正确释放 VC；漏 destroy 导致 VC 泄漏，后续 DTE 初始化异常或整卡异常
- `shared_dte` 一个 block 内只能由一个 SIP 初始化——原因：shared VC 是 block 级资源，多 SIP 竞争 init 会 VC 冲突
- 异构多线程 + 分离初始化模式下，sub-thread A 用栈上 `private_dte` 但把指针交给 sub-thread B 使用时，sub-thread A 栈上对象的生命周期必须覆盖 sub-thread B 的最后一次访问

## trigger / wait 对账

审查 trigger / wait 时给出最小对账表：

- 哪个 context 触发了哪个 event
- 哪个 buffer 受该 event 保护
- 哪个 wait 消费了这个 event

生产者、消费者和受保护资源都能对上时，才把问题写成已证实竞态 / 漏 wait。只看到局部片段时优先写 `needs_context`。

## connect 链

- `ctx1.connect(ctx2)` 链起来后，硬件按顺序执行；通常只 wait 最后一个 event
- 链路有分叉（前序 event 还有其他消费者）时保留中间 wait
- 仅在链路纯串联时把"只 wait 最后一个"作为建议

## config_slice / config_deslice / config_broadcast / config_memcpy

- `deslice` 写回范围限制在目标 SIP 自己的区域，写到别的 SIP 区域会破坏其他 SIP 数据（offset 用当前 SIP 起始位置，size 用当前 SIP 负责的逻辑尾位置）
- `slice` 对超出部分 pad 0；不需要 padding 时优先用 `deslice`——原因：deslice 不执行 padding 写，硬件路径更短
- `slice_transpose` 不会自动给 dst 不足部分 pad；尾部需显式处理
- `config_broadcast` 最低维过短时性能严重下降；硬件只对 slice / deslice / slice-deslice 自动合并最低维，broadcast / memcpy 形态需手工把连续维合并到 dim0

## set_total_size 字节 vs 元素

- `set_total_size` 接收的是字节数，不是元素数；传元素数会让 DTE 搬运量偏小
- 配合 shape / dtype / stride 推导 byte count 时注意 padded 维度和 `sizeof(dtype)`

## Buffer 复用时序

- 每轮复用 buffer 前确保上一轮关联的 event 已 `wait`；漏 wait 会让下轮覆盖未完成的搬运
- 复用粒度（per-row / per-tile / per-batch / per-stage）与 event 触发粒度一致；不一致会让 wait 保护不住实际数据
- 边界轮次（首轮 / 尾轮）通常需要额外处理：首轮没有上一轮 event，不要误 wait 未初始化 event

## DTE 与 SIP load 时序竞争（命中强制规则锚点）

- DTE 写 L1 完成前 SIP load 同一地址会读到旧 / 不完整数据，必须 DTE wait 后才能 SIP load
- 双 / 三缓冲下，相邻 stage 的 wait → load 顺序必须明确

## 防误报

- 单看一行 `wait()` 不确定生产者 / 消费者时优先写 `needs_context`
- DTE 链表 connect 后只 wait 末端是合规写法，不要按"少了中间 wait"机械报
- `tops::private_dte` / `tops::private_cdte` / `tops::private_edte` 没有显式 `.init()` / `.destroy()` **不要按生命周期不闭合报**——topsop 默认编译开 `-DTOPSCC_PRIVATE_DTE_AUTO_INIT`，构造函数自动 `init_comm()`、析构自动 `destroy_comm()`，显式 `init()` / `destroy()` 退化为 no-op。判定路径见 `gcu400-dte` skill §3 "TOPSCC_PRIVATE_DTE_AUTO_INIT 编译开关"。仅当 target 文件自身或其包含的头 `#undef TOPSCC_PRIVATE_DTE_AUTO_INIT` 时，才回到"必须显式 init/destroy"语义；此时省 init/destroy 才按生命周期不闭合报
- `tops::shared_dte` / `tops::local_dte` 不受 auto-init 宏影响，仍按 §init/destroy 约束 一节判定，看到声明却没 `.init()` / `.destroy()` 是真 bug
