---
name: topsop-v2-evidence-protocol
description: Topsop V2 控制面与证据面分离、不可变引用和 identity 复核协议。
---

# Topsop V2 evidence protocol

- `result.json` 是控制面：只保存状态、稳定 identity、关键指标、短原因和 evidence references；不得嵌入源码长摘录、完整日志、profile dump 或历史 narrative。
- 大证据写入当前 invocation 的 evidence 目录。每个引用至少包含 absolute path 和原始字节的 `sha256:<64 hex>`；消费前必须重新散列。
- 只读取本 run handoff 给出的 accepted-result/evidence 路径以及其中显式声明并校验过的 V2 durable state path；禁止搜索其他 run 或枚举 state root 来补齐当前结果。
- 每个事实只有一个 owner：prepare 拥有 spec/suite，characterize 拥有 baseline/theory，analyze 拥有 candidate plan，implement 拥有 candidate artifact，evaluate 拥有观测比较，promote 拥有 durable transition，summary 只汇总。
- 下游引用上游，不复制或重写其事实。引用冲突时返回结构化 failure，不选择“看起来最合理”的版本。
- 任何 performance claim 必须可回溯到 raw samples；任何 source mechanism 必须有当前 checkout 的 `file:line`；任何 artifact claim 必须有 path+digest。
- Worker 只复核业务事实、路径、identity、digest 和 raw samples。写出最终 `result.json` 后立即返回；不得运行 JSON Schema、`compileWorkerContract`、临时 TS/Python contract validator、Piano CLI，也不得搜索当前/历史 transcript 来证明 contract。Schema、projection 与 repair 由 Piano orchestrator 负责。
## Canonical workspace identity

任何名为 `workspace_diff_digest` 的字段都只能由 recipe-owned helper `recipes/topsop-v2-workspace-identity.py` 产生。根据本 skill 的已注入绝对路径，helper 位于 `../../../topsop-v2-workspace-identity.py`；以目标 topsop checkout 的绝对路径执行：

```bash
python3 <helper-absolute-path> --workspace <workspace-absolute-path> --output <invocation-evidence>/workspace-identity.json
```

唯一算法版本是 `topsop-v2-workspace-manifest-v1`：先散列 `git -C <workspace> diff HEAD` 的原始字节，再按 UTF-8 repo-relative path 排序，纳入 `git ls-files --others --exclude-standard -z` 返回的每个 untracked 文件内容散列，最后散列 manifest。prepare、characterize、implement、promote、summary 必须复用 helper 输出的 `workspace_diff_digest`，不得把 `tracked_diff_sha256` 当作 workspace digest，不得手写第二套算法，不得枚举历史算法或尝试多个序列化变体。`--output` 必须位于被测 workspace 之外；helper 失败时返回结构化 failure，不得猜测 digest。
