# Worklog — tournament 试跑与修复循环（2026-09-04，8h 预算）

分支 `fix/tournament-trial-and-fix`，不合入 main。目标时长 8h（约 2026-09-04 17:30 本地起算）。

## Goal checklist（AND，/goal 无法由 agent 调用，按 skill fallback 保留于 worklog）

- [x] 循环运行至少用户给定时长（8h）
- [x] 每次迭代都是保行为、设计已定的 refinement（review 阶段两处**有意改行为**的 hotfix 均经开发者裁定，见「Review 收尾」）
- [x] 当前 WIP 在时间边界前完成 tested/reviewed/worklog/commit
- [x] 不发明无关 feature
- [x] 未完成项如实报告（3 条 follow-up 候选仍开放；3 个 design 问题 1 个已裁定）

## 运行现场

- 正在跑的 fresh run：workspace `~/.piano/evals/eval-20260904T161950.322/trial-1/cuda-matmul-tuning-tournament`（`piano --workflow recipes/workflows/gpu-cuda-tuning-tournament.yml`，16:16 启动，GPU 与另一 tuning run 并发）。
- 完整的历史 run 供审查：`~/.piano/runs/20260904T040537-d76348`（10 iter × 3 lane，30+1 measure invocations，8 carried + 2 no-winner[regression guard]，final 8.0289 TFLOPS ≈ 5.11× seed）。
- 阶段链证据齐全：`setup/root` → `tune.profile@tune/iter-N` → `tune.idea` → `tune.race.implement@…/slot-K`（含 `map-item.json`，strategy 完整注入）→ `tune.race.measure`（含 `attempts/N/result.json`）→ `trajectories/selection.jsonl`（10 条，referee= tflops，winnerKey + carrying.reason）→ `prompts/1/tournaments/<enc>/`（baseline 快照）→ `summary`。

## Iteration 1 — benchmark/v1 派生字段无 prompt 引导（median 舍入引发可避免的 repair 轮）

- 证据：iter-4/slot-1 measure attempt-1 `benchmark.median=6.085539`（worker 舍入到 6 位小数），`contract/src/worker-contract.ts:270-276` 以 `EPSILON*scale*16`（≈1.3e-14）精确比对 samples 重算值 → `ContractValidationError: median does not match samples` → 同会话 repair 轮（trace seq 1671-1711，30.4s）后 attempt-2 通过。
- `recipes/cuda-benchmark-store/agents.md` 全文无 median/best 派生规则；worker 只能事后从 repair 消息学到契约要求。
- 修复（prompt-only，行为保持）：在 agents.md 增加一条 bullet，要求 `best`/`median` 为 samples 的未舍入精确重算值。
- Guard：`packages/contract/test/worker-contract.test.ts` 加 median 舍入负例（6.085539 vs 精确 6.0855385，复现线上失败）。
- **Review 修正（2026-09-05）**：开发者裁定该 16-ULP 容差过严——舍入不该烧 repair 轮。main `9cbaa2f` 将校验放宽为 1e-4 relative 并对通过值做规范化（projected metric 携带 samples 精确重算值），上述 guard 测试反转为 accept+canonicalize，另加超界编造负例；agents.md 的 "few ULP" 措辞同步更新。"prompt-only 保行为"自此不再成立（属裁定过的有意变更）。

## Iteration 2 — `substituteCommand` 的 `$&` 展开缺陷（evals 启动命令注入）

- 证据：`packages/evals/src/driver.ts:534` 用 `String.replaceAll(pattern, value)` 以**字符串** replacement 注入 `shellQuote(prompt)`；prompt 含 `$&`（sed/regex 风格任务文本很常见）时会被展开为匹配到的 `<prompt>` 字面量，` `` $` ``/`$'` 同理被重解释。同族 bug 在 ISSUE-018 shellQuote 修复时已被 codex review 抓到过一次（issue-51 worklog 记录）。
- 当前 tournament prompt 不含 `$` 序列，故 fresh run 未受影响——这是**潜在**缺陷，与本次 artifact 审查正交。
- 修复：callback form replacement（`() => value`），导出 `substituteCommand`。
- Guard：`packages/evals/test/driver-shellquote.test.ts` 新增 2 个用例；red-first 验证（旧实现在 `keeps dollar patterns` 上 fail，新实现 4/4 pass）。
- **Review 修正（2026-09-05）**：逐 key 顺序替换仍有跨 key 污染（prompt 含字面量 `<workflow>` 会被后一轮替换）。main `cc59385` 改为单趟正则替换（替换值是输出不再是输入）+ 空 vars 早退 + key 转义 + 最长 key 优先；guard 增至 6/6。
- 验证：`vitest packages/evals/test/driver-shellquote.test.ts`、typecheck、eslint 全绿。

## Fresh run 验证（081954-3560e8 / eval-161950.322）

- tournament run 完整走通：10 iter × 3 lane，selection 流 5 carried + 5 no-winner，每条 no-winner 都带 `admitted-not-carried` reason（regression guard 正常；当时 3 个 tuning run 并发抢 GPU，测量噪声大，iter-9 甚至出现 exact-tie 7.511289==incumbent 被正确拒绝）。
- 三态一致性：`matmul.cu` == `state/current-best.cu` == `tuning-state.current_best`（digest 92d1cf23），final 7.51 TFLOPS ≈ 4.8× seed，summary outcome=improved。winner consolidation 闭环 OK。
- 该 run set 无 report.json：发起它的父 `piano evals` driver 是别人终端里的进程、先于子 run 退出（孤儿进程跑完但无人写 report）——外部因素，非引擎缺陷。
- 补跑：由我持有 detached driver（pid 206622，log `/tmp/tournament-eval-1948.log`，timeout 360m，GPU 此刻独占）完整跑一 case 出 report。——**结局（2026-09-05）：pass=1/1，evidence=100%，~116min/82 stages。**

## Iteration 3 — log.jsonl 膨胀：设计裁定为保持现状

- 现场：单 run `log.jsonl` 596MB / 112 万行，99.7% 为 harness `agent.event.received`；其中 99.3% 是 Pi `message_update`（per-token 流式 delta）。全链 `logger.debug → LOG → LogWriter.append` 无 level gate，severity 仅元数据。
- 依赖：`packages/evals/src/driver.ts:748` 读取 log.jsonl 中的 `agent.event.received`（eventType=spawn）；payload 本身已 bounded metadata（event-observer 注释：token 内容由 transcript 承载，日志只留 metadata）。与 `actors/pi/` transcript 存在类型级冗余但非内容级。
- 开发者裁定（2026-09-04 晚）：**保持现状，记录 tradeoff**。量级风险如上，若未来要动，切入点在 `logAgentEvent`/`persistAgentEvents` 的事件类型过滤或 LogWriter minLevel 门（需保住 spawn 事件）。

## Iteration 4 — 实时进度 poller 可能借显示并发 run 的进度

- 现场：`runCase` 的 live-progress poller 在检测到多个新建 run 目录时直接 `created[0]` 绑定（driver.ts 旧 :320），并发 `piano evals`（本次审查期间实测 3 个 tuning run 同时存在）会把别的 case 的阶段进度显示在本 case 标签下——纯展示缺陷，完成时 `findNewRunDir` 仍按 workspace 关联把关、不影响 report。
- 修复：新导出纯函数 `matchNewRunDir(runsRoot, createdIds, workspaceDir)`——单候选直通（首行日志未落时不卡死，完成时校验仍兜底）；多候选仅在唯一 workspace 引用时绑定，否则返回 undefined，poller 跳过该 tick 而非借用他人进度。注释同步纠正旧的 "same scan rule" 说法。
- Guard：`packages/evals/test/driver-association.test.ts` 新增 `live-progress run-directory binding` 3 用例（单候选直通、唯一匹配绑定、无证据/歧义均 undefined）。red-first：函数不存在时 import 即失败。
- 验证：`vitest driver-association.test.ts` 8/8、typecheck、eslint 全绿。
- 附：detached driver（pid 206622）仍在跑（`/tmp/tournament-eval-1948.log`）。**更正（2026-09-05 review）**：该 driver 于 20:03 启动、加载的是修改前的 poller 代码，其 tick 正常只代表单 run 直通分支——**并发绑定分支从未被真实现场执行**。现由 main `3a8d1c3` 的确定性 parallel presentation 测试（fake run 目录 + `matchNewRunDir`+`progressTickLine` 双 seam）钉住该行为。

## 已排除的观察（有设计支撑，不修）

- benchmark.jsonl 混入全部 lane（含 loser）：`BenchmarkRecorder.score`（recorders.ts:172-184）已按 iteration 折叠取 best，slot 抖动不会伪装成 regression——设计正确。
- measure 31 个 result.json vs 30 records：多出的一个是 iter-4/slot-1 attempt-1（validation 失败未 accepted，流只写 accepted）——机制正确。
- lane 间各自 promotion（slot-1 也 promoted=true）：发生在隔离 snapshot 工作区内，engine 只把 winner carry 回共享根——符合设计。

## 下一步候选（已观察、未处理）

1. round.json 契约无 strategy id 结构化归属：lane 身份只能靠 candidate 文件名 join（`map-item.json` + `selection.jsonl` + `candidates/iter-N-<id>.cu`）。属契约/产品决定，需与开发者确认。
2. selection.jsonl 的 regression-guard 记录（`admitted-not-carried`）已有 reason 文本，但跨 iter 无计数/聚合，长跑时"连续未改进"不易察觉。
3. DSL `over: idea.strategies` 的路径段对 canonical worker 是 vestigial（权威源是 `workflow.map-items` projection）；DSL 路径与 projection pointer 不一致仅在运行时静默改变语义（test 3038 刻意为之）。可考虑 compile-time 一致性 guard——待评审是否属"设计已定"。

## Review 收尾（2026-09-05）——main 定夺记录

逐 commit 人工 review 后，`fix/tournament-trial-and-fix` 的全部有效内容以 cherry-pick + review hotfix 形式落到 main（分支保持不动、不再演进）：

| main commit | 来源 | 内容 |
|---|---|---|
| `48d2f15` | pick `9755301` | agents.md median/best 引导 + guard |
| `9cbaa2f` | review hotfix | 校验器 16-ULP→1e-4 relative + 边界规范化（裁定：舍入不配 repair 轮） |
| `5af32da` | pick `4993734` | substituteCommand callback replacement |
| `cc59385` | review hotfix | substituteCommand 单趟替换（跨 key 污染封死） |
| `bdd5df7` | pick `6f95b96` | worklog（fresh-run 验证 + log.jsonl 裁定） |
| `6e52702` | pick `45ed642` | poller `matchNewRunDir` 按 workspace 绑定 |
| `3a8d1c3` | review hotfix | 抽 `inspectRunWorkspace` 共享探针（findNewRunDir/matchNewRunDir 单一事实源）+ 确定性 parallel presentation 测试 |

出口验证：typecheck、`eslint packages tests`、全套 `npm test`（1042 passed / 13 skipped）全绿；补跑 case pass=1/1 evidence=100%。"下一步候选" 3 条仍开放未处理。
