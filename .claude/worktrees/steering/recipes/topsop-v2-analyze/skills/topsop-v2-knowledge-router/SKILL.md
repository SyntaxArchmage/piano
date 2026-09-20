---
name: topsop-v2-knowledge-router
description: Topsop V2 analyze stage 对固定 GCU400 与算子证据文档库的有界、渐进披露路由。
---

# Topsop V2 knowledge router: analyze

本 router 只允许读取 Piano 仓库内的 canonical corpus，不把整套文档复制进 prompt。它不是 DSH 全局 skill，也不要求 Piano shared-capability loader。

## 定位与权威顺序

1. 从本次 prompt 的 DSH 资源标题（其他 harness 为 `<workflow_skill path=".../recipes/topsop-v2-analyze/skills/topsop-v2-knowledge-router">`）取得本 skill 的**已注入绝对路径**并定位本目录；从本目录使用 `../../../shared-skills` 得到 canonical root。不得从当前 topsop cwd 猜路径，不得扫描 `$HOME`、其他 checkout 或其他 worker。
2. 先读取本目录相对路径 `../../../topsop-v2-knowledge-routing.json`（即 `recipes/topsop-v2-knowledge-routing.json`），并确认 stage=`analyze`、architecture=`GCU400`、source commit=`36c559d465ac7636678e094ccf512cfc5ff61bbe`。
3. 路由 manifest、catalog、import manifest 和 `topsop-gcu400-foundation/hardware/gcu400-v1.json` 是允许按需读取的 metadata，不占用 domain 配额；除具体架构/resource claim 外不要展开硬件文档。
4. 权威顺序固定为：当前 workspace 源码/CMake/dispatch → 当前 toolchain/device/benchmark/profile 输出 → pinned shared reference → operator-local historical evidence。文档冲突时以前两者为准并记录 knowledge gap。
5. 需要文档时只选 **1 个 primary domain**；确有跨域 claim 时最多再选 **1 个 auxiliary domain**。先读对应 capability 的 `SKILL.md` 和 `document/INDEX.md`，再打开支持 claim 所需的具体文件/章节。禁止递归读取、批量拼接、全文扫描整个 corpus。
6. 输出必须记录所用 repo-relative 文档路径、章节或 claim、pinned commit；文档只能解释机制，不能证明当前 kernel 已实现、当前性能已经提升或候选应 KEEP。

## 本 stage 路由

用途：根据当前源码、baseline/profile 与 bottleneck 选择一个主 domain；确有必要时最多增加一个跨域或 signature-matched 历史案例。

允许的 primary domains：
- `topsop-gcu400-foundation/compute-flow`
- `topsop-gcu400-foundation/compute`
- `topsop-gcu400-foundation/dataflow`
- `topsop-gcu400-foundation/scalar`
- `topsop-gcu400-foundation/dte`
- `topsop-gcu400-foundation/ldst`
- `topsop-gcu400-foundation/assembly`
- `topsop-gcu400-performance/perf-estimation`

允许的 auxiliary domains：
- `topsop-gcu400-foundation/compute-flow`
- `topsop-gcu400-foundation/compute`
- `topsop-gcu400-foundation/dataflow`
- `topsop-gcu400-foundation/scalar`
- `topsop-gcu400-foundation/dte`
- `topsop-gcu400-foundation/ldst`
- `topsop-gcu400-foundation/assembly`
- `topsop-gcu400-performance/perf-estimation`
- `topsop-gcu400-performance/optimization`
- `topsop-operator-evidence/operator-local`

历史优化案例规则：at most one signature-matched optimization case may be the auxiliary domain and is hypothesis-only。

## Canonical capability roots

- `topsop-gcu400-foundation/`：runtime/API、compute-flow、compute、dataflow、scalar、DTE、LDST、assembly/ISA，以及 `hardware/gcu400-v1.json`。
- `topsop-gcu400-performance/`：perf-estimation 与经过筛选的 optimization case studies。
- `topsop-gcu400-validation/`：testing、debug 与 reviewer checklists。
- `topsop-operator-evidence/`：算子本地证据、历史线索和记录协议。

不得读取未在本 stage allowlist 中出现的 domain；不得引用 GCU300、communication-only、图片资产或未导入案例。
