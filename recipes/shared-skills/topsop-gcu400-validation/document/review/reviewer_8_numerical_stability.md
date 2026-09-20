# Reviewer 8 — 1D 归约数值稳定性检查

本 reviewer 负责审查 V3 上沿最后一维做归约的计算流（LayerNorm / Softmax / RMSNorm / GroupNorm 等）在数值硬规则与结构性规则上是否正确。

加载 `gcu400-compute` skill：V3 上的 1D 计算指令（`vexp` / `mul_scl` / `bcastInternal` / RED 指令 stage 0~3）、OACC × scalar 直接走 `mul_scl`、VL 控制、SFU 指令语义。

## 触发条件

变更涉及沿最后一维做归约的计算流（LayerNorm / Softmax / RMSNorm / GroupNorm / online-softmax 等，或包含 `tcle::vexp` / `msf_*` / `REDSUM` / `REDMAX` / `REDMIN` 的 kernel）时执行。其他情况返回 `not_applicable` 并附判定依据。

## 数值正确性硬规则

- tail mask 参与归约输入：`sum` / `square_sum` / `find-max` 的归约输入里要先应用 mask（LayerNorm / RMSNorm 无效位通常置 `0`，Softmax find-max 无效位置 `-INF`）。只在最终 store 前套 mask 不够，无效 lane 会污染归约结果
- 自然指数走 `tops::vexp` 或先乘 `log2(e)`——原因：硬件 SFU 算的是 `2^x`；直接当 `e^x` 用会数值大错（Softmax 直接挂）
- `rsqrt(variance)` 前做非负保护：`variance = E[x²] - mean²` 在 fp32 下可能得到负小值，`rsqrt` 负数结果未定义。`vmax(var, eps)` 是默认写法；缺保护或只写 `vmax(var, 0) + eps` 要标注
- LayerNorm 与 RMSNorm 的 row_cache 语义不同：LayerNorm 在中心化（减 mean）之后更新 row_cache，RMSNorm 没有 `mean_arr` / `vsub(mean)` / `beta` 路径；把 LayerNorm 的 row_cache 模板直接搬进 RMSNorm 会引入虚假中心化
- `mul_scl`：OACC 与标量直接用 `*` 触发 `mul_scl` 指令，不要再用已 deprecated 的 `tcle::mul_scl`——原因：deprecated 接口会在编译期警告，多套一次中间步骤
- add / max / min 等运算不支持向量-标量混合指令；这类操作要先把已写入某个 OACC lane 的标量值用 `bcastInternal` 在向量内广播成完整向量,再做 OACC × OACC 计算
- VL 影响 `MOVVA2R.mode2`：从 OACC 抽标量（`int sr = oacc[index]`）时，`index >= VL` 时取出值固定为 0；抽前必须确认 VL 覆盖该 index
- VL 编码不能超过 1023 也不能为负——原因：VL SPR 只取低 10 bit 有效位，配置 1024 会被截断为 0,负数按二进制补码截断为意外值；同时实际生效宽度受当前向量类型 datalane 上限制约,超过时 tail lane 不写回（命中强制规则锚点）
- VA0 Cache 一致性：切换 `VAB_VPT0` 前必须主动 flush VA0 cache——原因：VA0 cache 不维护跨 VAB 切换的 coherence，旧 cache 行仍对应旧 VAB 映射，不 flush 会让对 VACC0 的写丢失，下一轮归约读到陈旧值。带 mask 1D 路径（`mask = vset_mb`、`mop_merge` 之类）出现切 VAB_VPT0 时按本条检查

## RED 指令 stage 时序

- `REDSUM` / `REDMAX` / `REDMIN` 由 4 个 stage 完成（stage 0 / 1 / 2 / 3），各 stage 之间有 RAW latency
- stage 0~2 使用 1D 计算单元，stage 3 使用 2D 计算单元，与 GEMM / SFU 共享同一 2D 通路、互斥串行——热路径中慎用，避免替代显式 unroll reduce
- 跨 stage 读写时要保留依赖正确的写法

## 结构性规则

- `unroll(full)` 使用边界：trip count 编译期已知 + 循环体量适中。状态多的外层循环用 `unroll(disable)`，内层再试 `2 / 4 / 8`。把状态多的外层循环改成 `unroll(full)` 且 trip count 非编译期常量会导致寄存器 spill / 性能严重回退、严重时 hang
- `#pragma clang loop unroll(disable)` 不是保守噪声，它可能在保护 TAR / row_cache 协议；diff 里"顺手"删掉 `unroll(disable)` 或改成 `unroll(full)` 时按"可能破坏 row_cache 协议"写开放问题
- 标量循环迭代次数较小且循环体本身简单时，可用 `#pragma clang loop unroll(disable)` 抑制编译器额外展开开销

## OACC × scalar / `bcastInternal` 选择

- OACC 与标量之间的乘法 → 直接用 `*` 让编译器选 `mul_scl`
- 非乘法（add / max / min）的向量-标量混合 → 标量值需先写入某个 OACC lane,然后用 `tcle::bcastInternal(oacc, index)` 在向量内 broadcast 成完整向量,再做 OACC × OACC 计算
- `bcastInternal` 同时也是把 OACC 当 L1 / cacheline 用、避免 L3 标量访问的路径

## 防误报

- 看到 `vexp` 不一定算错——`tops::vexp` 是 `e^x` 的封装；只有直接调 `__dtu_m_msf_exp_*` 这类底层 intrinsic 才需要乘 `log2(e)`
- 看到 `vmax(var, 0)` 后接 `+ eps` 不要直接判错——某些场景里 variance 不可能为负（如 dtype 累积保证），但仍按惯例标"建议改为 `vmax(var, eps)`"
