# Reviewer 10 — L0P5 cache 一致性检查

本 reviewer 负责审查 V3 GEMM 输入 L0P5 cache 的入口清空（`l0p5_inv`）是否覆盖当前 kernel 数据来源、共享 sub-thread 数量是否一致、跨算子 / 跨 sub-thread 套圈是否得到同步保护。

加载下列 skill：

- `gcu400-compute` skill：L0P5 cache 256KB 总量、`l0p5_inv(buf_id, count)` 语义、buf_id 8bit 编码、连续 count 条 inv 中只第一条触发 invalidate
- `gcu400-debug` skill：L0P5 套圈现象、L0P5 脏数据残留与多 sub-thread 同步保护

## 触发条件

target 出现 `mli_gemm` / `l0p5_inv` / `set_spr<*BUF_ID*>` / `tcle::matrix_t::dot` / `set_spr<LHS_*>` / `set_spr<RHS_*>` 时执行。纯 1D 算子返回 `not_applicable`。

## L0P5 入口清空（命中强制规则锚点）

- 算子开头必须对本算子使用到的所有 GEMM `buffer_id` 做 `l0p5_inv(buffer_id, 0)` 入口清空——原因：硬件不维护 L0P5 与 memory 的一致性，前算子如有相同 buffer_id 但 inv 调用次数不全，会让本算子读到脏数据
- 入口清空的语义类似"算子开始前清空 SPR / 累加寄存器"
- 缺失入口清空时按 `Blocker` 处理

## L0P5 invalidation count 与共享 sub-thread

- `l0p5_inv(buf_id, count)` 的 `count` 必须与实际共享该 buf_id 的 sub-thread 数量一致
- 同 buf_id 下连续 count 条 `l0p5_inv` 中，**只第一条**触发实际 invalidate；count 与实际共享数不一致时不会出现计算错误，但会导致数据反复 cache miss / 性能严重下降，且更容易暴露下面的"套圈"问题
- 共享 sub-thread 数量在 launch 配置 / `__thread_dims__` 改动时同步更新

## L0P5 invalidation 套圈（跨循环 / 跨算子）

跨循环或跨算子的 l0p5_inv 套圈会导致**概率性部分输出随机 mismatch**：

- 某个 sub-thread 执行过快，在其他 sub-thread 还没完成本轮 `l0p5_inv` 时就提前进入下一轮 `l0p5_inv`——会让下一轮的 inv 没有实际生效
- 跨 sub-thread 的 l0p5_inv 必须有同步保护（barrier / `__syncthreads()` / `tops::sync_subthreads()` + 精确 fence）
- 跨算子复用同一 buf_id 时，前算子结束 → 后算子开始之间必须保证所有参与 sub-thread 都完成各自的 inv

## buf_id 编码

- `buf_id` 是 L0.5 cacheline tag 的一部分（8bit），GEMM 指令 C slot 标量寄存器同时携带左枝 buf_id 和右枝 buf_id（各 8bit）
- 不同 sub-thread 在同一 GEMM 上下文中应使用对应的 buf_id 编码方案；惯用写法是 `v_lhs_buf_id + sub_id` / `v_rhs_buf_id + sub_id`
- 同 buf_id 跨用途（既存 query 又存 key）会让 invalidate 错乱

## L0P5 容量与驻留方向

- L0P5 cache 总容量 256KB，专用于 mli_gemm 左右支输入数据
- cache 驻留策略应与当前 GEMM 数据复用方向匹配：左支被多次复用时让左支驻留、右支多次复用时让右支驻留
- 驻留方向错配是性能问题（cache miss 风暴），按 `Optimization` 建议归 `性能建议`，不在本 reviewer 的 finding 里报

## footprint order

- GCU400 通过 footprint order（C slot 标量寄存器携带 16bit 执行次序 ID）控制跨 sub-thread GEMM 执行次序；如果 target 使用此机制，order ID 必须严格递增、跨 sub-thread 一致
- order ID 错位会让某些 sub-thread 长时间排队等待，进而 1D 指令被饿死——属于性能问题，归 `性能建议`

## 防误报

- 看到 kernel 头部已有 `l0p5_inv(buf_id, 0)` 不一定 count 就对——需要核对 launch 实际参与 sub-thread 数
- 连续多个 `l0p5_inv` 调用不一定都生效——只第一条触发实际 invalidate
- 看到 `set_spr<*BUF_ID*>` 不在 kernel 入口不一定就漏入口清空——可能 入口清空在外层 helper 里
