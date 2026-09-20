# gcu400-compute-flow 原始资料索引

本索引收录导入到当前 skill 的原始资料：5 份 Markdown，53 张图片。正文保持原资料为主，图片文件已扁平化放在同一 `document/` 目录。

## 阅读规则

- 不确定 API、硬件行为、性能指标或工具用法时，先按关键词在本索引选文档，再定点读原文；不要整本通读超长手册；原因：超长手册会占满上下文并淹没当前任务真正需要的章节。
- 需要确认图形结构、时序、表格或数据布局时，先读 `image_catalog.md` 的介绍，再用视觉能力打开对应图片文件。

## 文档
- `host_runtime_api_reference.md` — Host Runtime API Reference
  - 来源: `Doc/Host Runtime API Reference.md`
  - 类型: Host Runtime
  - 关键词: Runtime API / stream / event / memory / graph
  - 摘要: This section describes Global enum and defines of TOPS runtime API. Values: Peak clock frequency in kilohertz. Major compute capab
  - 图片: 0 张
- `kernel_runtime_api_reference.md` — Kernel Runtime API Reference
  - 来源: `Doc/Kernel Runtime API Reference.md`
  - 类型: Kernel Runtime
  - 关键词: kernel runtime API / device 侧 runtime
  - 摘要: include <vectorinfra.h BF16 type for unified vector length. include <vectorinfra.h Char type for unified vector length. include <v
  - 图片: 0 张
- `library_kernel_api_reference.md` — Library Kernel API Reference
  - 来源: `Doc/Library Kernel API Reference.md`
  - 类型: Library Kernel API
  - 关键词: library kernel API / kernel wrapper 接口
  - 摘要: In addition to the basic types, we also support two builtin floating-point type extensions, including half-precision floating poin
  - 图片: 0 张
- `tops_cpp_programming_guide.md` — TOPS C++ Programming Guide
  - 来源: `Doc/TOPS C++ Programming Guide.md`
  - 类型: TOPS C++ 编程
  - 关键词: TOPS C++ / execution model / memory / graph / pipeline
  - 摘要: 本文由 TOPS C++ 离线 HTML 文档合并转换而成。 - 3. 简介 - 4. 硬件架构 - 5. 执行模型 - 6. 线程模型 - 7. 内存模型 - 8. 编程接口 - 9. C++语言扩展 - 10. C++语言支持 - 11. 数学函数 - 1
  - 图片: 53 张
- `efvm_ir_specification.md` — EFVM IR Specification
  - 来源: `Doc/EFVM IR Specification.md`
  - 类型: 编译与 IR
  - 关键词: EFVM IR / 编译链路语义
  - 摘要: EFVM IR 是基于 LLVM IR 的编译器 IR（中间表示）。EFVM IR 旨在表示 GCU 计算内核（例如 TOPSCC Kernel）。高级语言前端（例如 TOPSCC 编译器前端）可以生成 EFVM IR。TOPSCC 编译器（基于 LLVM）从
  - 图片: 0 张
