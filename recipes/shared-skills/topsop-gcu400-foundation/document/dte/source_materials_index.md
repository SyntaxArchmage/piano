# gcu400-dte 原始资料索引

本索引收录导入到当前 skill 的原始资料：3 份 Markdown，54 张图片。正文保持原资料为主，图片文件已扁平化放在同一 `document/` 目录。

## 阅读规则

- 不确定 API、硬件行为、性能指标或工具用法时，先按关键词在本索引选文档，再定点读原文；不要整本通读超长手册；原因：超长手册会占满上下文并淹没当前任务真正需要的章节。
- 需要确认图形结构、时序、表格或数据布局时，先读 `image_catalog.md` 的介绍，再用视觉能力打开对应图片文件。

## 文档
- `libra_dte_architecture_specification.md` — Libra DTE Architecture Specification
  - 来源: `Doc/Libra DTE Architecture Specification.md`
  - 类型: DTE 架构
  - 关键词: Libra DTE / slice / deslice / padding / CDTE
  - 摘要: - Department: DTE Design Team - Author: Lijun Table 1. Revision History DTE : Data Transformation Engine ODTE : Off-chip DTE CDTE
  - 图片: 24 张
- `hwsync_arch_spec.md` — HwSync Arch Spec
  - 来源: `Doc/HwSync Arch Spec.md`
  - 类型: 同步硬件
  - 关键词: HwSync 架构 / barrier / latch / queue / event
  - 摘要: Libra同步原语通过HwSync(L1/L3)和Master Local Mailbox协同实现。 HwSync存在于两个层级，分别是instance在每个SIP内的L1 HwSync和centralized instance在GMU内的 L3 HwSync
  - 图片: 18 张
- `hwsync_programming_guide.md` — HwSync Programming Guide
  - 来源: `Doc/HwSync Programming Guide.md`
  - 类型: 同步编程
  - 关键词: HwSync 编程 / mailbox / pipeline / interrupt
  - 摘要: VG初始化时，每个VG划分得到一定数量的资源，同时每个VG内会将这部分资源进一步划分为静态资源和动态资源。其中，静态资源由软件负责管理分配，动态资源由硬件负责管理分配。 HwSync同步资源中，Mutex、CNT、ENTRY资源会按照VG划分；同时Mutex和
  - 图片: 12 张
