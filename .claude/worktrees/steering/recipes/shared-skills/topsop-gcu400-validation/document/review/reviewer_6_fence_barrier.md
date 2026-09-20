# Reviewer 6 — 同步 fence / barrier 检查

本 reviewer 负责审查 V3 上 `__syncthreads()` / `__syncsubthreads()` / `tops::sync_subthreads()` / `tcle::fence<*>` / SCF Mirror 通知等同步语义是否正确，以及 fence scope 是否最小化。

加载下列 skill：

- `gcu400-dte` skill：fence scope 完整编码表（0xD1 / 0xD2 / 0xD4 / 0xD8 / 0xE3 / 0xEC / load / store 变体 / 0x100 L0 / 0x00 ALL）、SCF Mirror Mailbox 通知模式、`__syncthreads` / `__syncsubthreads` / `tops::sync_subthreads` 区别、DTE 与 SIP load 时序
- `gcu400-debug` skill：共享 DSM race / hang / illegal address 等症状分流
- `gcu400-dataflow` skill：sub-thread 同步原语 formal 语义

## 触发条件

target 出现 `__syncthreads()` / `__syncsubthreads()` / `tops::sync_subthreads()` / `tcle::fence<*>()` / `notify_mailbox` / SCF Mirror 写、共享 DSM 访问、跨 SIP 通信路径时执行。

## 核心口径

- `__syncthreads()` 对参与该 barrier 的线程提供 block 内同步，并隐含 fence all。barrier 前任一 SIP 已 `wait` 完成的 DTE 写都会被挤入全局可见状态，barrier 之后对所有 SIP 可见
- 由此得到 DTE 路径的判定规则：read-set 里每一块 DSM，对应 event 只要已被其 owner SIP 在 barrier 前 `wait`，就是安全的；`private_dte` 与 `shared_dte` 一视同仁，消费 SIP 不需要自己再 `wait` 一次
- 直接访存路径（vector store / `tcle::leaptr` 写、SDMEM 标志位等）与 DTE 路径不混谈，按 fence / barrier 的 formal 语义单独判定

## review 顺序

### 1. 判定数据是不是真的共享

- 先分清是"共享同一块 DSM"还是"每 SIP / 每 sub-thread 拥有独立分片"
- 多 SIP 对同一块共享 DSM 做"写后读 / 写后写"依赖：通常需要同步
- 多 SIP 只读同一块只读数据，且上游写入已完成：不必机械要求每一步都补 `__syncthreads()`
- 每 SIP 访问独立分片：重点看地址划分是否正确

### 2. 判定生产者是"直接访存"还是"DTE / event"

- DTE 路径 → 按 step 3 read-set / write-set 对账
- 直接访存路径 → 按 step 4 看 fence / barrier 的 formal 语义

### 3. 每个 `__syncthreads()` 做 read-set / write-set 对账

diff 里出现或改动 `__syncthreads()` 时，对 barrier 前后产出结构化对账，每个 `__syncthreads()` 填四栏：

1. barrier 前的 DSM write-set：每个 SIP 写了哪些 DSM 区域、由哪个 context trigger、event 名是什么
2. barrier 后的 DSM read-set：每个 SIP 要读哪些 DSM 区域
3. 跨 SIP 覆盖核对：read-set 里每一块 DSM 对应 event 是否已被其 owner SIP 在 barrier 前显式 `wait`
4. 结论：`已证实安全` / `依赖未证实的硬件语义` / `已证实缺同步`

不做对账就直接断言"同步 OK"是常见 reviewer 自身错误，建议先填表再下结论。

### 4. 直接访存后是否缺 fence（命中强制规则锚点）

- 直接指令访问 L3 或 DSM 跨 SIP 之后，如果有后续读方，通常需要配对 fence；除非能证明该路径完全由 DTE 保证
- vector store / `leaptr` 写 / SDMEM 标志位写之后紧跟消费该区域的读，缺 fence 按竞态处理

## fence 编码与最小 scope

- 完整编码表见 `gcu400-dte` skill §7；本节不复制
- 选择最小满足需求的 scope——原因：过宽 fence 阻塞不相关层级的 outstanding 请求
- 热路径中应避免：
  - `fence<0x00>`（ALL）——按 `Optimization` 建议改最小 scope；只在跨多类资源的边界条件下保留
  - `__syncsubthreads()`——自带 fence all；热路径中应替换为 `tops::sync_subthreads()` + 精确 fence
- DTE 搬运完成不需要 fence——原因：用 DTE wait / mailbox 表达完成关系
- L1 VDMEM store 可见性：`fence<0x92>`
- L2_MEM / DSM store 可见性：`fence<0x94>`
- L3 store 可见性：`fence<0x98>`
- GEMM 数据消费完成：优先 SCF Mirror store 通知 mailbox（避免 L0 fence）；没有 mirror 保序时才用 `fence<0x100>`
- kernel 结束自带 fence all，不需要在末尾再加 fence

## SCF Mirror 通知模式

- SCF Mirror 保证写操作不越过之前 GEMM 的读；GEMM 消费完 L0P5 数据后，通过 SCF Mirror 写 mailbox 无需额外 L0 fence
- 这是热路径中替代显式 L0 fence 的首选方案；判定时确认 mailbox 写地址是否落在 SCF Mirror 空间（具体地址范围按 `gcu400-dte` skill）

## benign 安全组合

下列场景默认安全，单独看到时不必报：

- canonical A — `shared_dte` 初始化发布：owner SIP `shared_dte.wait()` 后紧接 `__syncthreads()`，其他 SIP 随后读该 shared_dte 搬入 DSM 的块
- canonical B — `private_dte` 分片写 + 跨 SIP 合并读：每个生产 SIP 各自 `wait` 完自己写的那片，紧接 `__syncthreads()`，之后任何 SIP 读完整 DSM 块
- 每 SIP 只读自己写的那片 DSM（纯独立分片）
- 只读 rodata / 常量段 / host 预先注入的不变数据

## 死循环风险

- 检查 `while`、`for(;;)`、自旋等待或依赖外部状态退出的循环，确认退出条件可达且依赖的状态会被正确更新
- 重点关注：退出条件依赖未初始化变量、依赖永不更新的共享状态、缺少超时 / fallback 的忙等
- 死循环会导致 kernel hang

## 防误报

- 看到 `tcle::fence<0x00>()` 不一定就违规——某些跨多类资源的边界条件下确实需要 ALL
- 看到 vector store 后紧接 `__syncthreads()` 就机械要求补 fence、没有先走"直接访存 vs DTE"的区分，属于自身误报；回到 review 顺序 step 2 重判
