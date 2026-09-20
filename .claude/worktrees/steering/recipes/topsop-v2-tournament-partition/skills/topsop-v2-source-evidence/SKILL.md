---
name: topsop-v2-source-evidence
description: 从当前 topsop checkout 建立 API、dispatch、kernel、test 和 build provenance 的有界方法。
---

# Topsop V2 source evidence

1. 权威顺序：当前 workspace 源码/CMake → 当前 toolchain 输出 → V2 knowledge snapshot → 历史 state/report。
2. 从 workspace 根 CMake、公开 API 和正式测试入口逐段追踪 public API → host dispatch/OpBase → device compilation unit → selected kernel variant；不得假定历史目录布局。
3. 每项关键事实使用当前 checkout 的 repo-relative `file:line`，至少覆盖 API、dispatch、kernel、test registration 和 build target。
4. 历史 report、stash、旧 binary 字符串和其他分支只能作为线索，不能成为当前 rebuildable provenance。
5. benchmark case 必须在当前 source 中可重建；seed mismatch 可由 prepare 在正式测试树中物化，但不能把 stale binary 当成基线。
6. operator-local `rule.md` 或进展记录只提供历史 dead-end/命令线索；与当前源码冲突时以当前源码为准。
