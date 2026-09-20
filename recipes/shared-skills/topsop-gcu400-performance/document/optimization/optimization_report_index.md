# 性能瓶颈报告索引

GCU400 算子性能优化遇到常规四层方法论无法解释的瓶颈时，先用本索引按瓶颈词定位历史报告，再回到实测数据做单变量实验。

## 使用时机

- 理论建模、baseline、bound 判定已经完成，但 bottleneck 仍缺少可执行优化假设。
- 连续两轮同类微调无收益，需要换一个结构性方向。
- profile 指向 L0P5、LDST、1D pipeline、convolution、cost model、padding、sync、footprint order、attention、GEMM、MoE、TopK、norm、sort 或 gather/scatter 等历史报告覆盖的主题。

## GCU400 Kernel Deep-Dive 语料

- `gcu400_kernel_deep_dive_index.md` — `topsop/docs/gcu400-kernel-deep-dives` 导入的 111 份编号 kernel 深度报告和 3 份支撑文档
  - 关键词: attention / MLA / KV cache / GEMM / FP8 / MoE / TopK / 1D pipeline / norm / loss / conv / indexing / sort
  - 用法: 按当前瓶颈词选择少量相近报告，提取可迁移优化假设后回到实测数据做单变量验证。

## 本 skill 内报告
- `libra_sip_programming_guideline.md` — Libra SIP Programming Guideline
  - 关键词: SIP 编程 guideline / GEMM / L0P5 / sync / dataflow
  - 用法: 围绕这些关键词形成新的优化假设；涉及图片时查 `image_catalog.md`。
- `report_2025_06_17_l0p5_buf_id_invalidation.md` — 2025-06-17 L0P5 Buf-id and invalidation 管理
  - 关键词: L0P5 buf_id / invalidation / cache 一致性
  - 用法: 围绕这些关键词形成新的优化假设；涉及图片时查 `image_catalog.md`。
- `report_2025_06_24_l0p5_cache_perf_notes.md` — 2025-06-24 L0P5 Cache 访存特点和优化注意
  - 关键词: L0P5 cache 访存特点 / footprint / SMR
  - 用法: 围绕这些关键词形成新的优化假设；涉及图片时查 `image_catalog.md`。
- `report_2025_07_01_xpu_1d_pipeline_optimization.md` — 2025-07-01 XPU 1D 流水线介绍和优化手段
  - 关键词: XPU 1D pipeline / S1-S4 / latency / 优化手段
  - 用法: 围绕这些关键词形成新的优化假设；涉及图片时查 `image_catalog.md`。
- `report_2025_07_09_ldst.md` — 2025-07-09 LDST
  - 关键词: LDST / T0 / outstanding / hazard / bandwidth throttle
  - 用法: 围绕这些关键词形成新的优化假设；涉及图片时查 `image_catalog.md`。
- `report_2025_07_22_cluster_op_cost_model.md` — 2025-07-22 Cluster and Op Cost Model
  - 关键词: cluster / op cost model / 调度估算
  - 用法: 围绕这些关键词形成新的优化假设；涉及图片时查 `image_catalog.md`。
- `report_2025_07_30_convolution_optimization_questions.md` — 2025-07-30 卷积优化讨论 Opt-Question-List 问题1 + 3
  - 关键词: convolution / stride / dilation / padding / GEMM dataflow
  - 用法: 围绕这些关键词形成新的优化假设；涉及图片时查 `image_catalog.md`。

## 按瓶颈追加加载的 skill

- 1D / 2D / OACC / L0P5：加载 `gcu400-compute`，再按该 skill 正文的原始资料入口查索引。
- LDST / TAR / unaligned / outstanding / throttle：加载 `gcu400-compute-ldst`，再按该 skill 正文的原始资料入口查索引。
- DTE / slice / deslice / HwSync / mailbox：加载 `gcu400-dte`，再按该 skill 正文的原始资料入口查索引。
- ISA / VLIW / CSR / pipeline hazard：加载 `gcu400-compute-assembly`，再按该 skill 正文的原始资料入口查索引。
- profiling 工具、TOPSProf、TCU、TOPSPTI、性能定量分析：加载 `gcu400-perf-estimation`，再按该 skill 正文的原始资料入口查索引。
- driver、sanitizer、gdb、设备状态异常：加载 `gcu400-debug`，再按该 skill 正文的原始资料入口查索引。

## 图片入口

- 本 skill 当前导入图片 18 张，逐图说明见 `image_catalog.md`。
- 当报告索引只给出抽象结论、但需要确认时序图、数据流图或表格细节时，打开对应图片做视觉检查；不要把图片当 OCR 文本来源，原因：该入口的目标是让 agent 选择需要视觉检查的图示，而不是从截图中抽取正文。
