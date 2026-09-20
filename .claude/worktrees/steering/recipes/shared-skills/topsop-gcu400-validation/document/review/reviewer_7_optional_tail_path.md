# Reviewer 7 — optional / tail path 分支检查

本 reviewer 负责审查 V3 上 optional 输入 / 输出、tail path、partial tile、`is_first_*` / `is_last_*` / `is_normalize` / `params.is_*` 等条件分支语义是否正确，且 fast / fallback 两条路径都闭合。

加载 `gcu400-compute-flow` skill：optional tensor 是一等公民、kernel 显式区分 `nullptr` 与 non-null 路径。

## 触发条件

target 出现 optional 输入 / 输出、tail mask、`T_tail` / `tail_rows` / `chunk_tail` / `optional` / `has_residual` / `is_normalize` / `is_first_*` / `is_last_*` / `params.is_*` 分支时执行。

## Optional tensor 路径

- kernel 内部对 optional 输入必须显式区分 `nullptr` 与 non-null 路径——原因：上层用 optional 控制融合分支，空指针路径容易在集成后才暴露
- 两条路径都要闭合：dispatch、host 校验、kernel 实际访问、tail 处理、归约结果回写
- optional 输出（如 residual / pre-norm intermediate）不被消费时是否会写到非法地址 / 越界写
- 只测"所有 optional 都存在"的 case 不算覆盖；reviewer_9 会检查测试覆盖

## Tail path / partial tile

- tail mask 必须正确参与归约——原因：无效 lane 不应污染 sum / max / find-max（详细数值规则见 reviewer_8）
- tail block 与 main block 的 buffer 复用关系是否一致：tail 轮单独申请 buffer 时 host 预算是否覆盖；tail 轮复用 main buffer 时 wait / drain 是否正确
- tail 路径分支条件下 `*_valid` flag 的初始状态和退出状态要明确（见 reviewer_11 的对账要求）

## 条件分支与跨循环 drain

- `if (is_first_*)` / `if (is_last_*)` / `if (is_normalize)` 等条件 guard 内的 wait / drain 必须证明：guard 不进入时对应 `*_valid` flag 已为 0（否则 inflight event 会带到下一轮）
- "看起来合理" / "测试覆盖到此路径" / "opposite ping/pong 隔离" 不能替代证明
- 证明缺失时按命中强制规则锚点处理：下一轮写入是 SIP 直接 store + DTE 未 wait → `Blocker`，其他 → `Major`

## 首轮 / 尾轮 / normalize 轮

- 首轮 `is_first_*` 通常没有上一轮 event；不要误 wait 未初始化 event
- 尾轮 `is_last_*` 通常需要把所有 inflight event drain 完；遗漏 drain 会让 destroy / 后续 kernel 看到泄漏 VC
- `is_normalize` 这种语义分支（如 LayerNorm / RMSNorm 的归一化轮）在非 normalize 轮的 fast path 里如果跳过了某些 wait，要确认 fast path 入口已经 drain

## Fused / fallback 路径

- fused 与 fallback 两条路径都需要独立的分支闭合证明——原因：fallback 是正式行为
- fused 路径里的 tail / optional 分支不要回退到 fallback 内的语义；fallback 内如有更复杂的 tail 处理，fused 路径需独立实现一份正确的

## 防误报

- 看到 `if (is_*)` 内部 wait 不一定就需要 fast path 也 wait——只要能证明 fast path 入口时 flag 已为 0
- 看到 tail mask 在 store 前才设置不一定就漏归约——要看实际归约操作中 mask 是否参与
