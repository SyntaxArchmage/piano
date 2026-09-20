# Reviewer 4 — 资源预算检查（L1 / OACC / 栈）

本 reviewer 负责审查 V3 上 L1 VDMEM、OACC 物理寄存器、sub-thread 栈等硬件资源预算是否自洽，能否证实超限或 host guard 与 kernel 分配不一致。

DTE VC 配额（`local_dte` / `private_dte` 11/SIP、`shared_dte` 16/SIC）与 cooperative launch DTE Pool 公式由 topscc 编译期检查，超出直接编译报错，不在本 reviewer 范围。

加载下列 skill：

- `gcu400-dataflow` skill：sub-thread 分工、L1 / 栈预算、双/三缓冲深度
- `gcu400-compute-scalar` skill：栈 ≤10KB、`-res-usage` 字段
- `gcu400-compute` skill：OACC 物理上限 768、`maxnreg` 按 4 对齐

## 触发条件

target 出现 `__local__` allocator、显式 budget 函数、`maxnreg`、`__thread_dims__` 时执行。纯 host 接口或纯标量算子返回 `not_applicable`。

## L1 VDMEM 预算（每 SIP 896KB）

- 每个 SIP 的 L1 VDMEM 总量按 `gcu400-dataflow` skill 当前正文为准；分配方式包括显式 `__local__` 声明的 buffer
- 报告 L1 预算超限前先确认对象的地址空间归属——原因：未标注 `__local__` 的普通局部数组默认归 SDMEM / 栈 / parameter buffer，不计入 L1 VDMEM 预算
- L1 VDMEM 与 SDMEM 是物理分离的；VDMEM 用满不会挤压 SDMEM 栈空间
- `__local__ __valigned__ char buffer[L1_SIZE]` 这种模式按 `L1_SIZE` 占用 L1 VDMEM；多个 sub-thread 共享同一 buffer 时只算一份，否则按 sub-thread 数累加

## OACC 物理寄存器（命中强制规则锚点）

- OACC 物理编号必须 ≤ 767——原因：超出后访问非法物理 VARAM，触发 SIP VARAM PARITY 硬件错误
- `maxnreg` 按 4 个 OACC 为最小划分粒度，编译器会向上取整到 4 的倍数——做 VAB / sub-thread OACC 预算时按向上取整后的数量相加，否则总和"看着"够用但实际越界或重叠
- 多 sub-thread 各自的 OACC 分配相加 ≤ 768；多个 sub-thread 共享同一 VAB 是常见错位
- `OACCSpillCount > 0`（`-res-usage` 输出）表示 OACC 溢出到 memory，性能严重下降；本 reviewer 在 finding 中按 correctness 不报（性能问题归 `性能建议`）

## 栈预算（每 sub-thread ≤ 10KB）

- 单个 sub-thread 栈 > 10KB 会切到 remote stack（UVA 映射，每次访存 200~300 cycle，远高于 SDMEM 8 cycle），按 `Major` 处理（性能严重退化属于可观察后果）
- `-res-usage` 输出的 `StackSize` 仅是 global function 的栈，不含调用链上其它 device 函数的栈；实际栈 = boot code + global function + device function 0 + ...
- global function 的 `StackSize` 已接近 10KB 时几乎可以确定调用链总和会超限

## Buffer size 按 padded 维度分配

- 调用 Primo++ `matrix_t::dot` / `mli_gemm` / 仓库内 `*_preconfig` helper 且 helper 有 `K % 64 == 0` / `N % 64 == 0` / `M % 32 == 0` 类对齐要求时：
  - 承接 helper 输出的 L1 buffer 按 `align_up<align>(N)` 等 padded 维度分配
  - 作为 helper 输入的 L1 buffer 按 `align_up<align>(K)` 等 padded 维度分配
  - host 预算公式使用同一套 padded 维度，避免 host guard 与 kernel 实际 allocator 失同步
- 即便 kernel 内部声明是 `[B_TILE, D]`，只要下游 GEMM / matmul 按 `D_pad` 步进寻址，buffer 就要按 `B_TILE * D_pad * sizeof(dtype)` 申请，否则差额部分会越界

## 防误报

- 看到大数组 / 大 buffer 不一定就超 L1 预算——先判定地址空间归属
- 普通栈数组 > 10KB 才是栈风险；`__local__` buffer 大不影响栈
- `-res-usage` 的 `StackSize` 偏小不代表栈安全——需要把 device function 调用链算上
