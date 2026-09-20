# gcu400-debug 原始资料索引

本索引收录导入到当前 skill 的原始资料：4 份 Markdown，8 张图片。正文保持原资料为主，图片文件已扁平化放在同一 `document/` 目录。

## 阅读规则

- 不确定 API、硬件行为、性能指标或工具用法时，先按关键词在本索引选文档，再定点读原文；不要整本通读超长手册；原因：超长手册会占满上下文并淹没当前任务真正需要的章节。
- 需要确认图形结构、时序、表格或数据布局时，先读 `image_catalog.md` 的介绍，再用视觉能力打开对应图片文件。

## 文档
- `topssanitizer_user_guide.md` — TopsSanitizer User Guide
  - 来源: `Doc/TopsSanitizer User Guide.md`
  - 类型: Sanitizer
  - 关键词: TopsSanitizer / memory / race / lifecycle
  - 摘要: TopsSanitizer 是 TopsPlatform 的开发工具中提供的一套功能正确性检测工具集。该套件包含多个子工具，支持对 GCU kernel 程序执行多种类型的检测。 目前已实现对 Memcheck、SyncCheck 工具的支持，可用于精确检测和
  - 图片: 0 张
- `efsmi_user_guide.md` — EFSMI User Guide
  - 来源: `Doc/EFSMI User Guide.md`
  - 类型: 工具与调试
  - 关键词: efsm i / 设备状态 / 运维命令
  - 摘要: EFSMI (Enflame System Management Interface)是用于管理 GCU 设备的Linux命令行工具。 可以实时查询各种 GCU 设备信息：包含温度、功耗、时钟频率等。 有关EFSMI命令的详细用法，请参考 EFSMI 命令。
  - 图片: 0 张
- `topsgdb_user_manual.md` — TopsGDB User Manual
  - 来源: `Doc/TopsGDB User Manual.md`
  - 类型: 调试工具
  - 关键词: TopsGDB / device debug / 调试命令
  - 摘要: TopsGDB基于GDB版本13.2，所以使用方式与GDB相同，下面介绍一些常用命令以及与GDB不同的地方。 TopsGDB支持的GCU设备包括：gcu300， gcu400 使用TopsCC编译，增加编译选项 -g -fno-omit-frame-point
  - 图片: 0 张
- `enflame_driver_user_guide.md` — Enflame Driver User Guide
  - 来源: `Doc/Enflame Driver User Guide.md`
  - 类型: 驱动与设备排障
  - 关键词: KMD / VF / dmesg / 驱动安装与错误信息
  - 摘要: KMD是燧原硬件产品的Linux内核态驱动。本文档主要介绍KMD的安装和使用方法。 燧原KMD只支持64位系统，且需要在 BIOS 中打开如下设置（不同BIOS的描述可能有所不同）。 驱动安装包有以下几个。 - enflame-xxx.run: GCU的基础驱动模
  - 图片: 8 张
