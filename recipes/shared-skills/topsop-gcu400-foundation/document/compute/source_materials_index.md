# gcu400-compute 原始资料索引

本索引收录导入到当前 skill 的原始资料：6 份 Markdown，71 张图片。正文保持原资料为主，图片文件已扁平化放在同一 `document/` 目录。

## 阅读规则

- 不确定 API、硬件行为、性能指标或工具用法时，先按关键词在本索引选文档，再定点读原文；不要整本通读超长手册；原因：超长手册会占满上下文并淹没当前任务真正需要的章节。
- 需要确认图形结构、时序、表格或数据布局时，先读 `image_catalog.md` 的介绍，再用视觉能力打开对应图片文件。

## 文档
- `libra_sip_arch_spec.md` — Libra SIP Arch SPEC
  - 来源: `Doc/Libra SIP Arch SPEC.md`
  - 类型: SIP 架构
  - 关键词: Libra SIP 架构 / pipeline / memory / execution units
  - 摘要: 1. Crystal Instruction 4.0 2. ISA 4.0 Spec 3. Libra SIP SPR Spec 4. Libra SIP CSR Spec 5. ISA3.2 Spec 6. DSM Spec 7. Libra SIP Pro
  - 图片: 46 张
- `libra_sip_spr_spec.md` — Libra SIP SPR SPEC
  - 来源: `Doc/Libra SIP SPR SPEC.md`
  - 类型: SPR
  - 关键词: Libra SIP SPR / 特殊寄存器 / maskbit cache line
  - 摘要: 本文档由 Libra SIP SPR SPEC.pdf 转换整理而来，保留原文的章节、寄存器表、字段说明、图片与主要版式结构，并清理 PDF 导出产生的版式噪声。 下面寄存器被放弃： - SPSDIM1STRIDE - SCHEDS1 - SCHEDS2 -
  - 图片: 1 张
- `meeting_general_compute_1d.md` — General Compute 1D
  - 来源: `Meeting/Markdown/General Compute 1D.md`
  - 类型: 会议资料
  - 关键词: General Compute 1D / XPU pipeline / S1-S4
  - 摘要: 来源文件：../General Compute 1D.pdf 转换说明：本文按 PDF 页内容整理为正式 Markdown。可抽取文字已重排为标题、列表、表格和公式；正文已覆盖的纯文字页不再保留图片；必要的架构图、流程图和图表仅以裁剪图保留。 本文介绍 SIP
  - 图片: 6 张
- `meeting_l0p5_invalidation.md` — L0P5 Invalidation
  - 来源: `Meeting/Markdown/L0P5 Invalidation.md`
  - 类型: 会议资料
  - 关键词: L0P5 invalidation / consistency / buf_id
  - 摘要: 来源文件：../L0P5 Invalidation.pdf 转换说明：本文按 PDF 页内容整理为正式 Markdown。可抽取文字已重排为标题、列表、表格和公式；正文已覆盖的纯文字页不再保留图片；必要的架构图、流程图和图表仅以裁剪图保留。 本文介绍 L0P5
  - 图片: 5 张
- `meeting_l0p5_perf_tuning.md` — L0P5 Perf Tuning
  - 来源: `Meeting/Markdown/L0P5 Perf Tuning.md`
  - 类型: 会议资料
  - 关键词: L0P5 performance tuning / SMR / IV cache / footprint order
  - 摘要: 来源文件：../L0P5 Perf Tuning.pdf 转换说明：本文按 PDF 页内容整理为正式 Markdown。可抽取文字已重排为标题、列表、表格和公式；正文已覆盖的纯文字页不再保留图片；必要的架构图、流程图和图表仅以裁剪图保留。 本文聚焦 L0P5
  - 图片: 13 张
- `libdevice_programming_guide.md` — Libdevice Programming Guide
  - 来源: `Doc/Libdevice Programming Guide.md`
  - 类型: 数学库与 device helper
  - 关键词: libdevice / 数学函数 / device helper
  - 摘要: 本指南记录了 libdevice 中可用的函数以及从编译器开发者角度使用该库的基本方法，以便程序员更好地使用 GCU 的硬件资源，实现高效的算子或算法。 libdevice 是一个由 GCU 内部硬件指令或 intrinsics 实现的函数组成的库，用于实现
  - 图片: 0 张
