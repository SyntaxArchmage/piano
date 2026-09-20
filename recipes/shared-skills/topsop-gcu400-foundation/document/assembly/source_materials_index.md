# gcu400-compute-assembly 原始资料索引

本索引收录导入到当前 skill 的原始资料：4 份 Markdown，16 张图片。正文保持原资料为主，图片文件已扁平化放在同一 `document/` 目录。

## 阅读规则

- 不确定 API、硬件行为、性能指标或工具用法时，先按关键词在本索引选文档，再定点读原文；不要整本通读超长手册；原因：超长手册会占满上下文并淹没当前任务真正需要的章节。
- 需要确认图形结构、时序、表格或数据布局时，先读 `image_catalog.md` 的介绍，再用视觉能力打开对应图片文件。

## 文档
- `libra_sip_csr_spec.md` — Libra SIP CSR SPEC
  - 来源: `Doc/Libra SIP CSR SPEC.md`
  - 类型: CSR
  - 关键词: Libra SIP CSR / 寄存器地址映射
  - 摘要: 本文档由 Libra SIP CSR SPEC.pdf 转换整理而来，保留原文的章节、寄存器表、字段说明、图片与主要版式结构，并清理 PDF 导出产生的版式噪声。 N/A 下面寄存器被放弃： - L1DSMMASKCFG 该寄存器功能被XPU下的XPUSCRA
  - 图片: 1 张
- `libra_sip_isa.md` — Libra SIP ISA
  - 来源: `Doc/Libra SIP ISA.md`
  - 类型: ISA
  - 关键词: Libra SIP ISA / 指令字段 / 编码
  - 摘要: 本文档由 Libra SIP ISA.pdf 转换整理，保留原始章节、表格、伪代码与图示内容。 - Revision History - Open & Drop Item - Open Item - Ongoing Feature - Glossary - R
  - 图片: 14 张
- `gcu_isa4_assembly_reference.md` — GCU ISA 4.0 Assembly Reference
  - 来源: `Doc/GCU ISA 4.0 Assembly Reference.md`
  - 类型: ISA 与汇编
  - 关键词: GCU ISA 4.0 汇编参考 / 指令语义
  - 摘要: Generate time: 2025-08-13 07:43:27.038264 Get binary release from the latest date of http://swbuild.enflame.cn/llvm(http://swbuild
  - 图片: 0 张
- `sip4_pipeline_info_for_compiler.md` — SIP4.0 Pipeline Info for Compiler
  - 来源: `Doc/SIP4.0 Pipleline Info for Compiler.md`
  - 类型: Pipeline 与编译器
  - 关键词: SIP4.0 pipeline / hazard / compiler scheduling
  - 摘要: 本文档用于从架构视角抽象和归纳 SIP4.0 主流水线中指令执行时特性，提供 Compiler 对于 SIP4.0 指令的调度用参数，以及调度优化建议。 本文档包括以下内容： - 流水线特性简介 - SIP4.0 中对于 Compiler 调度优化场景的要求
  - 图片: 1 张
