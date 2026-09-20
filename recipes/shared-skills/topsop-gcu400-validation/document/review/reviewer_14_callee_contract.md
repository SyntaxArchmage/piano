# Reviewer 14 — 被调 helper / Primo++ 接口契约检查

本 reviewer 负责审查 target 内部调用的仓库内 helper（`matmul_*_preconfig` / `lnact_*` / `flash_attn_*` / `softmax_*`）以及 Primo++ 模板（`tcle::matrix_t::dot` / `tcle::tensor_queue` / `tcle::pipeline` 等）的形式约束（shape / workspace / dtype / 对齐 / launch）是否被调用方满足。

加载下列 skill：

- `gcu400-compute-flow` skill：被调 helper 接口契约判定方法、host dispatch 与 callee 前置条件的对账
- `gcu400-compute` skill：Primo++ `matrix_t` 的 GEMM 编码（M/K/N 颗粒、`MATRIX_MODE`、acc_mode）

## 触发条件

target 内部出现下列任意一种调用时执行：

- `*_preconfig` / `*_calc` / `*_store` / `*_post` 等 helper 命名
- `matmul_*` / `lnact_*` / `flash_attn_*` / `softmax_*` / `rank_mixer_*` 等仓库内手写 helper
- Primo++ `tcle::matrix_t<M,K,...>::dot` / `tcle::tensor_queue` / `tcle::pipeline` / `tcle::engine`
- 自定义 device function 跨 `.cc` 复用；本 reviewer 同时检查 helper 前置条件与跨 TU 符号可见性

## 审查协议

对每个调用点完成三步：

1. **枚举 callee**：在 target 内列出所有仓库内定义的被调 helper / Primo++ 模板
2. **抠形式约束**：读 callee 的定义文件，至少抠出一条形式约束（如 `K % 64 == 0` / `M >= 16` / `workspace_size >= bytes_for_gemm` / `lhs_dtype == rhs_dtype` / `__local__ __valigned__`）
3. **代入对账**：在调用点把具体 shape / dtype / workspace / 对齐代入约束，得到 `satisfied: yes/no/unknown`

## 常见前置条件类别

- **跨 TU helper 可见性**：跨 `.cc` 复用且不在 `.h` 中的 device helper 应加 `static` 或改为头文件内联定义——原因：两个 TU 内同名 helper 行为不一致时，链接器可能选到错误版本，表现为编译通过但运行时调用错实现
- **shape 对齐**：M / K / N 必须是 `kInstrM` / `kInstrK` / `kInstrN` 的整数倍；不齐时 GEMM 输出尾块未定义
- **dtype 一致**：左右支 dtype 必须一致或落在 `gemm_mode` 编码允许的组合
- **`MATRIX_MODE`**：matrix_t 的 mode 参数（如 mode17 / mode18 / mode64）决定 GEMM 编码与 K 颗粒；与 callee 假设不一致会编码错误
- **`MatrixType`**：lhs / rhs 的元素类型必须与 callee 模板参数一致
- **workspace size**：host 侧分配的 workspace 必须 ≥ callee 在 worst case 下的需求
- **对齐**：承载 DTE 目标且后续会被向量 / 矩阵访问的 L1 base buffer 要满足 callee 对 `__local__ __valigned__` base allocation 的契约；callee 内部 DTE 子 slice / 子偏移地址不是 512B 对齐时不直接判成 caller 违约，除非 callee / SDK 明确要求该子地址对齐。原因：base allocation 512B 是给后续最大向量宽度 / 矩阵访问保留对齐前提；DTE 子地址的常见约束是 128B 满带宽条件，不是已知 512B correctness 约束
- **launch 形态**：某些 callee 假设单 SIP / 单 sub-thread；多 sub-thread 调用时需检查每个 sub-thread 的状态独立性
- **buf_id 编码**：GEMM helper 内部依赖 `v_lhs_buf_id + sub_id` / `v_rhs_buf_id + sub_id` 的编码方式时，caller 必须传入对应的 buf_id

## 命中强制规则锚点

被调 helper 的 shape / workspace / dtype 前置条件未被调用方满足（例如 `matmul_*_preconfig` 要求 `K % 64 == 0` / `N % 64 == 0` 而 target 传入未对齐实参）→ `Blocker`。

跨 TU 复用且不在 `.h` 中的 device helper 缺 `static`，且能找到其他 TU 中同名 helper 或同名风险时，按 `Major` 处理。

证据要求：

- callee 文件路径 + 形式约束的具体条款
- caller 调用点的实参表达式
- 推理：实参表达式在合法 shape 范围内是否一定满足约束

## Primo++ matrix_t 专项

- `tcle::matrix_t<kInstrM, kInstrK, MatrixType, MATRIX_MODE>` 的尺寸参数与 SPR 配置（`LHS_DIM0_REAL` / `LHS_DIM1_REAL*` / `RHS_DIM0_REAL*` / `RHS_DIM1_REAL`）必须一致
- `LHS_DIM0_STRIDE` 在 V3 上始终是 1，硬件忽略写入；多余的 `set_spr<LHS_DIM0_STRIDE>(1)` 是冗余代码（性能 noise，按 `Optimization` 归 `性能建议`）
- 不同 `gemm_mode` / `lhs_row_max` / `acc_mode` 组合下，左右支的 padded 维度不同；caller 的 buffer size 必须匹配
- `nacc = 1` 时禁止使用 `acc_mode = 0` 或 `1` 之外的组合；INT8 / UINT8 只支持 `acc_mode = 0`

## 输出要求

每个 callee 在 `reviewer_audit_trail.anti_fp_check_note` 至少留一条：已枚举的 helper 列表 + 已抠出的形式约束 + 调用点 `satisfied: yes/no/unknown` 的具体推理。

`unknown` 必须附"为什么不能直接判定"的解释；`no` 直接成 finding。

## 防误报

- 看到 `K % 64 != 0` 不一定就违规——caller 可能在 host 侧已用 `align_up<64>(K)` 把 padded 维度作为实参；要核对实参表达式是否经过 padding
- 看到 `set_spr<LHS_DIM0_STRIDE>(1)` 不要按 `Major` 报——只是性能 noise，按 `Optimization` 归 `性能建议`
- callee 是 V3 SDK 头文件中的 `tops::*` 接口（不是仓库内手写 helper）时不在本 reviewer 范围
- 同一 `.cc` 内私有 helper 缺 `static` 不算 correctness 风险；只有跨 TU 复用或存在同名解析风险时才报
