---
name: topsop-v2-prepare
description: Topsop tuning V2 的准备入口；规范化 mission、建立独立 state、发现最小源码路径并准备精确 benchmark suite。
---

# Topsop V2 prepare

## 固定不变量

1. `protocol_version` 必须为 2，`architecture` 必须为 `GCU400`。
2. workload fingerprint 只由会影响 dispatch/measurement 的规范字段组成；使用排序键稳定的紧凑 JSON，再计算 SHA-256。
3. V2 state root 必须位于 `~/.piano/state/topsop-v2/`，绝不导入 V1 `topsop-*` state；默认启动策略是严格 `continue`。
4. workspace 中已有用户改动必须记录并保留。
5. 测试物化只能修改 `test/`、`tests/`、`topsop/test/` 或 `topsaten/test/`。
6. 每个 workload 都有独立 case 和 expected runtime identity；不能用 `84|4800` 这种聚合 shape 冒充一次真实运行。

## Durable state 文档

`state.json` 使用固定通用结构：`state_schema_version=1`、`protocol_version=2`、`namespace=topsop-v2`、`architecture`、`workload_fingerprint`、`workspace_root`、`revision`、`current_best{path,sha256,identity,source_commit,workspace_diff_digest}` 和 `history[]`。`history` 的条目只记录 candidate id、mechanism、decision、resulting revision 和 evidence reference；不得写入 operator-specific 字段。缺少这些身份字段的旧 V2 state 不兼容。

## 有界流程

1. 先做最小 mission 规范化：只取得 architecture、operator 和定位唯一 V2 state path 所需的 workload identity；不要先做源码发现。
2. 立即从已注入 `topsop-v2-evidence-protocol` skill 的绝对目录定位 `../../../topsop-v2-workspace-identity.py`，只调用一次 helper，把 JSON 写入当前 invocation evidence。只使用其 `algorithm=topsop-v2-workspace-manifest-v1`、`head` 和 `workspace_diff_digest`；`tracked_diff_sha256` 只是 manifest 的一个分量，绝不能直接与 state 比较。然后读取唯一 state 文件并比较 cheap identity：state schema version、protocol、namespace、architecture、workspace root、`source_commit == HEAD`（其中 HEAD 必须等于 helper `head`）、canonical workspace diff digest。任一不匹配时在最多 4 个有界 tool batches 内返回 run-scope `blocked`，固定使用 `failure.code=durable_state_incompatible`；不得尝试其他序列化或历史算法。
3. durable-state blocked 快路径不得读取 API/dispatch/kernel/test/CMake、不得物化 benchmark、不得 build、不得打开 knowledge routing manifest 或 canonical shared corpus；写完最小 failure evidence 与 `result.json` 后立即结束。
4. 只有 state 不存在或 cheap identity 严格兼容后，才完成影响 dispatch/measurement 的全部 mission 字段、稳定 fingerprint，并在现有 state 上继续校验 fingerprint。state 不存在则返回 `state_startup.mode=initialized`、`revision=0`；state 全部兼容则返回 `continued` 和原 revision/state SHA-256。
5. 从 workspace 根 CMake、公开 API 和正式测试树做有界发现；不要全盘 `find`。正常 ready 路径默认不超过 12 个 tool batches，已取得 API/dispatch/kernel/test/CMake 锚点后立即停止。
6. 不读取 Piano 实现仓库、Piano tests/docs、V1 recipes、其他 run、历史 mission、其他 worker 资源或 Git 全分支历史；这些都不是当前 workspace provenance。
7. state 损坏、旧格式或任一身份不匹配时不得自动删除、迁移、checkout、合并或降级为 fresh。
8. prepare 不写 durable state。若现有 case 精确匹配则复用；若只是 seed，则仅在通过 state gate 后、在测试边界内物化目标 case。
