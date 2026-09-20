---
name: topsop-v2-knowledge-router
description: Topsop V2 prepare stage 对固定 GCU400 与算子证据文档库的有界、渐进披露路由。
---

# Topsop V2 knowledge router: prepare

本 router 只允许读取 Piano 仓库内的 canonical corpus，不把整套文档复制进 prompt。它不是 DSH 全局 skill，也不要求 Piano shared-capability loader。

## Durable-state fast path

若 prepare 在最小 mission 规范化后发现唯一 V2 state 已存在且 cheap identity 不兼容，本 router 立即停用：不得读取 routing manifest、catalog、import manifest、hardware metadata 或任何 canonical domain。由 prepare 直接输出 `durable_state_incompatible`。只有 state absent 或严格兼容后才进入下述路由。

## 定位与权威顺序

1. 从本次 prompt 的 DSH 资源标题（其他 harness 为 `<workflow_skill path=".../recipes/topsop-v2-prepare/skills/topsop-v2-knowledge-router">`）取得本 skill 的**已注入绝对路径**并定位本目录；从本目录使用 `../../../shared-skills` 得到 canonical root。不得从当前 topsop cwd 猜路径，不得扫描 `$HOME`、其他 checkout 或其他 worker。
2. 先读取本目录相对路径 `../../../topsop-v2-knowledge-routing.json`（即 `recipes/topsop-v2-knowledge-routing.json`），并确认 stage=`prepare`、architecture=`GCU400`、source commit=`36c559d465ac7636678e094ccf512cfc5ff61bbe`。
3. 路由 manifest、catalog、import manifest 和 `topsop-gcu400-foundation/hardware/gcu400-v1.json` 是允许按需读取的 metadata，不占用 domain 配额；除具体架构/resource claim 外不要展开硬件文档。
4. 权威顺序固定为：当前 workspace 源码/CMake/dispatch → 当前 toolchain/device/benchmark/profile 输出 → pinned shared reference → operator-local historical evidence。文档冲突时以前两者为准并记录 knowledge gap。
5. 需要文档时只选 **1 个 primary domain**；确有跨域 claim 时最多再选 **1 个 auxiliary domain**。先读对应 capability 的 `SKILL.md` 和 `document/INDEX.md`，再打开支持 claim 所需的具体文件/章节。禁止递归读取、批量拼接、全文扫描整个 corpus。
6. 输出必须记录所用 repo-relative 文档路径、章节或 claim、pinned commit；文档只能解释机制，不能证明当前 kernel 已实现、当前性能已经提升或候选应 KEEP。

## 本 stage 路由

用途：用 compute-flow 核对 API、runtime、dispatch 与测试入口；仅在需要读取算子本地 rule/历史命令线索时使用 operator evidence。

允许的 primary domains：
- `topsop-gcu400-foundation/compute-flow`
- `topsop-operator-evidence/operator-local`

允许的 auxiliary domains：
- `topsop-gcu400-foundation/compute-flow`
- `topsop-operator-evidence/operator-local`

历史优化案例规则：operator-local evidence may provide bounded path/command/dead-end clues only; optimization case studies are forbidden。

## Canonical capability roots

- `topsop-gcu400-foundation/`：runtime/API、compute-flow、compute、dataflow、scalar、DTE、LDST、assembly/ISA，以及 `hardware/gcu400-v1.json`。
- `topsop-gcu400-performance/`：perf-estimation 与经过筛选的 optimization case studies。
- `topsop-gcu400-validation/`：testing、debug 与 reviewer checklists。
- `topsop-operator-evidence/`：算子本地证据、历史线索和记录协议。

不得读取未在本 stage allowlist 中出现的 domain；不得引用 GCU300、communication-only、图片资产或未导入案例。
