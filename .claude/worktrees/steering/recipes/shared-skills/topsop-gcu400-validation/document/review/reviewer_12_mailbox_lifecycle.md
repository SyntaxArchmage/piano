# Reviewer 12 — Mailbox 生命周期与计数器检查

本 reviewer 负责审查 V3 mailbox 资源（实体 / 虚拟 / GSYNC）的申请、清零、跨 sub-thread 传递、notify / wait 配对、SCF Mirror 通知模式、长循环计数器溢出风险。

加载 `gcu400-dte` skill：mailbox 资源数（176 实体 + 16 虚拟 + 4 GSYNC）、11-bit 计数器（最多 2047 次连续 notify）、生命周期 API（`tops_alloc_mailbox` / `task_init_thread_node` / `task_reset_thread_node` / `task_notify` / `__gcu_wait_vSiSi`）、SCF Mirror Mailbox 通知模式（GEMM 后免 L0 fence）。

## 触发条件

target 出现 `tops_alloc_mailbox` / `tops::task_node_t` / `task_init_thread_node` / `task_reset_thread_node` / `task_notify` / `__gcu_wait_vSiSi` / `notify_mailbox` / SCF Mirror 写时执行。无 mailbox 使用 → `not_applicable`。

## Mailbox 申请 / 清零

- 申请 mailbox（`tops_alloc_mailbox`）后必须调用 `task_init_thread_node` + `task_reset_thread_node` 把计数器初始化为 0——原因：未清零会让首轮 wait 立即返回，错过实际同步语义
- 多个 sub-thread 共享同一 mailbox 时，初始化与清零只能由一个 sub-thread 执行；其他 sub-thread 必须在初始化完成之后才使用

## 跨 sub-thread 传递 mailbox id

惯用模式：sub-thread A 申请 mailbox 后，把 mailbox_id 通过 VDMEM / SDMEM 数组传递给 sub-thread B：

- 一次性通信用 VDMEM 数组传递
- 持续通信常用 SDMEM 上的 task struct 指针 + VDMEM 暴露指针（如 `dte_stack_addr`）

承载对象的生命周期约束：

- sub-thread A 栈上变量（如 `volatile Task<T_out, sub_num> task[2]`）必须在 sub-thread B 的所有可能访问期间存活——原因：栈上对象函数返回后失效，异步消费者读到脏数据
- 持续通信场景下推荐 `__local__` SDMEM / VDMEM 而不是栈上局部变量

## notify / wait 配对

- 每个 `task_notify` 让 mailbox 计数器 +1；每次 `__gcu_wait_vSiSi(mailbox_id, threshold)` 等待计数器超过 threshold 后将其 -1
- notify 与 wait 必须配对：
  - 多消费者一次 wait 各自消费一份 notify → 计数器最终为 0
  - 单消费者多次 notify → 必须有等量 wait
- mailbox 跨多轮迭代复用时，每轮入口的计数器状态必须与本轮 notify 数量匹配；遗留前轮残留 notify 会让本轮 wait 错位

## 11-bit 计数器溢出（命中强制规则锚点）

- 计数器宽度 11-bit，最多连续 2047 次未消费 notify——原因：硬件无溢出保护，wrap-around 后 wait 语义不正确
- 长循环中 notify 必须有消费节奏：要么 wait 周期性 drain 计数器，要么把 notify 频率降到不会累积过 2047
- 触发条件：`for` / `while` 内有 `task_notify` / SCF Mirror 写 mailbox，且消费者节奏明显慢于生产者，或循环上限 > 2047
- 命中即按 `Major` 处理；存在 `for (int i = 0; i < N; i++) { task_notify; }` 且 `N > 2047` 且无中途 drain → 按 `Major`

## SCF Mirror 通知模式

- `notify_mailbox(mailbox_id)` 通过写 SCF Mirror 空间地址（`0x100000600 + 0x80000000`）通知 mailbox
- SCF Mirror 写不会越过之前 GEMM 的读——原因：硬件保证；GEMM 消费完 L0P5 数据后通过 SCF Mirror 写 mailbox 无需额外 `fence<0x100>` L0 fence
- 判定时确认：① 写地址确实落在 SCF Mirror 空间；② 当前路径上不存在跨 GEMM 之外的 outstanding 操作还需要 fence 保证可见

## task_node_t 生命周期

- `task_node_t` 是 mailbox 的本地 handle；在多个 sub-thread 间共享时，task_node 自身的内存位置（栈 / SDMEM / VDMEM）决定可见范围
- 不要把 sub-thread A 栈上的 task_node 指针传给 sub-thread B 长时间使用——原因：sub-thread A 退出后 task_node 失效

## 防误报

- 看到 `for (int i = 0; i < N; i++) task_notify` 不一定就溢出——若 `N` 编译期可证 ≤ 2047，安全；动态 `N` 才需要消费节奏证据
- SCF Mirror 写 mailbox 不一定都能免 L0 fence——只有发生在 GEMM 之后、且 mailbox 写地址落在 SCF Mirror 空间时才适用
- 多消费者 wait 同一 mailbox 时，其中一个消费者不带 dec / clr 操作是合规写法
