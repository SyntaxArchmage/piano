# Topsop Tuning V2：Pre-loop Blocked Fast Path

- 日期：2026-09-16
- 状态：已实施
- 证据 session：`/home/wsj/.piano/runs/20260916T080802-6bbc51`
- 修改边界：仅 V2 worker instructions、workflow fixture 与文档；不修改 Piano framework

## 1. 问题

该 session 在 `prepare` 发现旧 durable state 与当前 workspace identity 不兼容：

- state `current_best.source_commit`：`37a069def169c68e880cb2047777068d8a6b6912`
- 当前 workspace `HEAD`：`9c1d4fd896f3ce2d7d8b025e75fe4f14aa31f332`
- state workspace diff：`sha256:a80715dbb151a72fa6a414368e125d56298e4af64be03f0dd43d9d50da5f062a`
- 当前 tracked diff：空 diff `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

严格 `continue` 返回 `durable_state_incompatible` 是正确行为，但一次无需 build、device 或 tuning loop 的阻塞流程仍耗时约 45 分钟：

| Stage | Duration | Unique tool calls |
|---|---:|---:|
| prepare | 12m 48s | 29 |
| characterize | 18m 37s | 29 |
| summary | 14m 02s | 17 |

主要浪费来自：prepare 在 state gate 前进行源码发现；characterize 重新检查 Git/state 根因；summary 再次复核同一身份事实，并在写出结果后继续工作。

## 2. 设计原则

1. 保留严格 `continue`，不自动删除、迁移、覆盖或降级为 fresh。
2. state incompatibility 只由 prepare 判定；下游不得重新调查同一根因。
3. accepted upstream failure 是 characterize/summary 的权威输入。
4. blocked path 不需要 GCU400 canonical knowledge、源码、build、device 或 profile。
5. 只通过 worker instructions 和现有 contract/projection 表达该行为，不增加 Piano package API。

## 3. Worker 调整

### topsop-v2-prepare

理由：旧流程先探索 API、dispatch、kernel、test 和 CMake，最后才检查 state，导致已知不兼容时仍完成大量无效工作。

改动：

- 先最小规范化 architecture/operator/workload identity；
- 只调用 recipe-owned `topsop-v2-workspace-identity.py` 计算 workspace `HEAD`、canonical tracked+untracked manifest digest 和唯一 state path；
- 优先比较 schema/protocol/namespace/architecture/workspace root/source commit/workspace diff；禁止把 helper 的 `tracked_diff_sha256` 当作最终 workspace digest，也禁止枚举算法变体；
- 任一 cheap identity 不匹配时，在最多 4 个 tool batches 内返回 `durable_state_incompatible`；
- blocked 路径禁止源码发现、benchmark 物化、build 和 canonical corpus 路由；
- 只有 state absent 或严格兼容后才进入正常的 12-batch source discovery。

### topsop-v2-characterize

理由：prepare 已经拥有 state 判定权，characterize 重查 commit ancestry、workspace digest 和 state 内容既重复又扩大延迟。

改动：

- accepted prepare result 为 blocked 时启用最多 3-batch fast path；
- 仅使用 handoff 中的 accepted-result ref 和结构化 failure；
- 原样传播 `kind/scope/retryable/code/message/next_action`；
- 禁止读取 prepare transcript、Git/state/source、routing manifest、canonical corpus；
- 禁止 build、device lease、correctness、timing、profile 和理论估算；
- `result.json` 写完后立即返回。

### topsop-v2-summary

理由：没有进入 loop 时，summary 不需要重新证明 prepare/characterize 已验收的 blocker，也不需要验证不存在的 baseline/artifact/promotion。

改动：

- characterize blocked 且不存在 tune receipt 时启用最多 4-batch fast path；
- round 计数全部为零，保留 `target_measured=10`；
- 原样继承 upstream failure；
- 只处理当前 execution 明确拥有的 lease/cleanup；
- 禁止重新检查 Git、workspace digest、state、artifact、source 或 canonical corpus；
- `result.json` 必须是最后一次写操作。

## 4. 回归覆盖

新增 workflow fixture 覆盖：

```text
prepare(blocked: durable_state_incompatible)
  -> characterize(blocked, same failure)
  -> skip tune loop
  -> summary(completed, outcome=blocked, zero rounds)
```

断言仅调度 `prepare`、`characterize`、`summary`，没有任何 `tune.*` invocation；同时增加静态 guard，固定三个 worker 和对应 knowledge router 的 fast-path 预算与禁止行为。

## 5. 非目标

- 不改变 strict continue 的身份字段；
- 不增加自动 reset/fresh 模式；
- 不修改 Piano orchestrator、loop 或 projection 逻辑；
- 不承诺仅靠 prompt 可以形成硬 wall-clock timeout，tool-batch 上限仍由 worker 遵循；
- 不验证正常 tuning loop 的知识路由效果，需在 state 清理后的下一次端到端 session 中验证。
