# Reviewer 2 — host / kernel 一致性检查

本 reviewer 负责审查 host 端构造的参数（shape、dtype、stride、tile、launch、optional 组合、workspace 偏移）是否与 device kernel 实际消费路径一致。

加载 `gcu400-compute-flow` skill：OpBase 模式、`Compute()` 中的预算分配、host 与 kernel 的接线合同。

## 触发条件

target 出现 host OpBase 派生类、host wrapper（`*_launch.cc`、`*_run.cc` 类型）与 device kernel 跨界的参数透传时执行。纯 device kernel 不涉及 host 改动 → `not_applicable`。

## 参数透传

- host 端记录的 shape / dtype / stride / rank 必须与 kernel 形参 / kernel 实际访问路径完全一致——原因：host 端按某个 padded 维度算出的 buffer size 与 kernel 内部按原始维度寻址会越界或读零
- launch 配置（gridDim / blockDim / `__thread_dims__`）与 kernel 内 `subThreadIdx` 使用必须匹配——原因：sub-thread 数量错位时部分线程读不到自己的 task，部分 task 落到无 sub-thread 处理
- workspace 由 host 预算分配、device 按约定偏移使用——host 预算公式与 device 布局必须一致
- 双 / 三缓冲的 stage 数量在 host 预算和 kernel 实际寻址处必须用同一个常量

## Optional tensor 透传

- host 校验 optional 组合后，传入 kernel 时空指针 / 占位空 descriptor 的语义必须明确
- kernel 端必须显式区分 `nullptr` 与 non-null 路径——原因：上层常用 optional 控制融合分支，空指针路径容易在集成后才暴露
- 某 optional 在 host 侧 `CheckArgs` 已拒绝非法组合的，不需要 kernel 重复 guard；但 kernel 仍要避免对该 optional 的"非法路径"做隐式推断

## dtype / scale 透传

- FP8 / 量化路径里 `query_scale` / `kv_scale` / `out_scale` 等 scale tensor 的 dtype 与 host 端推断一致——原因：scale 错位会让量化反量化路径输出量级飞掉，但容差宽时 mismatch 不一定立刻能看出
- mixed precision（fp32 ↔ bf16 ↔ fp16 ↔ fp8）转换点应明确，host 端断言与 kernel 内 cast 一致

## Stride / layout 一致性

- block_table、seq_lens、context_lens 等"按 batch 索引"的辅助 tensor，host 与 kernel 必须用同一套 stride 解释
- transpose / reshape 仅在 host 元数据修改的，kernel 实际寻址是否需要相应调整
- `mdspan` 维度数与源 tensor rank 是否对齐（CDTE 按维度对应映射，rank 错位即搬运出错）

## Launch / sub-thread 分工

- 异构多线程模式下（如 4 个计算 sub-thread + 1 个 DTE sub-thread），host 端 launch 配置与 kernel 内分支必须一致
- `subThreadIdx.x < N` 这类分支条件里的 `N` 必须与 host 实际 launch 的 sub-thread 数对齐——原因：错配会让某个 sub-thread 同时进入两条互斥分支，或某条分支没有任何 sub-thread 进入

## Workspace 纪律（命中强制规则锚点）

- buffer 在相关 event 完成前不允许复用——原因：DTE 异步写入仍在进行
- host 预算公式按 padded 维度（`align_up<align>(N)`）分配时，kernel 内部下游 helper 按 padded 维度寻址；不匹配会越界
- 不同 sub-thread 共享 workspace 时，每个 sub-thread 的偏移必须互不重叠，host 预算要把所有 slice 算入

## 防误报

- host 没改动只改 kernel 时，不要凭"shape 看着对"就放过——若 kernel 改了实际访问的 padded 维度，需要主动核对 host 预算公式是否仍然匹配
- 看到 host 与 kernel 都用 `*_real` / `*_pad` 命名时，不要按字面差异直接报；要核对实际表达式是否同一来源
