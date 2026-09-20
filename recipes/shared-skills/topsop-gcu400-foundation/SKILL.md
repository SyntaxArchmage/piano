---
name: topsop-gcu400-foundation
description: GCU400 runtime/API、执行与内存模型、dataflow、scalar、compute、DTE、LDST 和 ISA/codegen 的按需参考入口；用于需要硬件或编程语义依据的 topsop 分析与实现，不用于 GCU300 或通信协议。
---

# topsop GCU400 foundation

这是一个渐进披露的 GCU400 知识入口，不是当前 workspace 的事实替代品。

1. 先读取当前源码、CMake、dispatch 和工具输出；它们高于本快照。
2. 涉及容量、地址空间或资源预算时先读 [`hardware/gcu400-v1.json`](hardware/gcu400-v1.json)，再从 [`document/INDEX.md`](document/INDEX.md) 选择一个主 domain；问题确实跨域时最多再选一个辅助 domain。
3. 只打开支持当前 claim 所需的文档和章节，不批量读取整个目录。
4. 在输出中记录文档路径、章节、适用 claim 和 pinned source commit；冲突或无法确认时记录 knowledge gap。
5. 禁止引用 GCU300 参数或把历史/通用文档描述成当前 kernel 已实现的事实。GCU400 的 896 KiB VDMEM 是物理容量；1.5 MiB 是所引地址图中的 SDMEM base offset，不是 VDMEM capacity。kernel 可分配预算必须由当前源码或 toolchain 按 owner/scope 解析。

路由：仓库/API/dispatch 读 `compute-flow`；sub-thread 分工、pipeline 深度、buffer 套圈、融合与跨线程通信读 `dataflow`；SALU/SLDST、SDMEM/stack、branch/CMOV 和标量热点读 `scalar`；1D/2D/OACC/GEMM/L0P5 读 `compute`；DTE/fence/mailbox 读 `dte`；对齐/TAR/向量访存读 `ldst`；ISA4/VLIW/CSR/codegen 读 `assembly`。
