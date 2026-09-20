# 一次完整 run 产生的序列化文件

文件分布在 **4 个磁盘区域**。"种"是固定的（约 25 种），"个数"随 run 形状变化，每种的计数公式标在表里。

```
~/.piano/
├── agent.config.json                    (读，用户配置)
├── prompt-history                       ① TUI 提交历史，≤100行，整文件重写
├── harness/                             ← 共享生成区（harness-home.ts:41,157-192）
│   ├── pi/auth.json                     ② {}占位，防SDK找不到config-dir
│   ├── pi/models.json                   ③ 由Piano配置生成的模型注册表
│   ├── dsh/settings.yaml                ④ dsh原生settings（凭据只留env引用）
│   ├── dsh/patches/<model>.patch.yml    ⑤ 每模型一个，dsh --patch 用
│   ├── dsh/sessions/<key>/<id>/*.jsonl(.zstd)  ⑥ dsh CLI 自己写，Piano 只读回
│   └── claude/                          ⑦ CLAUDE_CONFIG_DIR（claude自己的会话在此）
├── evals/<caseId>/history.jsonl|baseline.json  ⑧ 仅 piano evals 时写
└── runs/<runId>/                        ← 每次 run 的目录（session.ts:26-28,63-64）
    │    runId = <UTC时间戳>-<hex6>
    ├── log.jsonl            ⑨  结构化日志，逐行append；含agent.event调试行
    ├── trace.jsonl          ⑩  span enter/exit/error，逐行append（trace.ts:180）
    ├── trajectory.json      ⑪  压缩事件账本，读-改-写全量重写；run命名也写这里
    ├── progress.jsonl       ⑫  【不可变证据流】只记accepted stage，append
    ├── progress.json        ⑬  【最新快照】给watch/TUI，原子重写
    ├── resume.json          ⑭  actors的sessionId/transcriptPath/turns/continuation
    ├── contracts/<sha256>.json  ⑮ 每个用到的contract.json按digest存一份原文
    ├── workspaces/slots/<key>/**   ⑯ 每actor一条git worktree/目录快照
    ├── workspace-records/<key>/record.json  ⑰ 绑定记录(key,cwd,gitRoot,fork点)
    ├── trajectories/        ← @piano/trajectory recorder流（recorders.ts）
    │   ├── benchmark.jsonl      ⑱ stage_accepted 时的metrics
    │   ├── duration.jsonl       ⑲ attempt起止耗时
    │   ├── token-usage.jsonl    ⑳ token累计
    │   ├── tool-calls.jsonl     ㉑ 工具调用起止
    │   ├── selection.jsonl      ㉒ tournament/selection 裁决记录
    │   └── index.json           ㉓ 关闭时的汇总（未close则status=running）
    ├── actors/<harness>/<stageId>/<root|lane>/session/<id>.jsonl  ㉔
    │       每个actor一个【原始stdout转录】：claude stream-json/pi帧/dsh输出
    │       逐行原样存；续跑以append方式写同一文件（subprocess.ts:1133-1186）
    └── prompts/<n>/invocations/<stageId>/<iter-i|slot-k>/
        ├── attempts/<k>/result.json   ㉕ agent亲手写的契约结果，每attempt一个
        ├── handoff/record.json        ㉖ producer证据: text,sessionId,transcriptPath,
        │                                 resultPath,resultPayload,projections,contract
        ├── handoff-context/<x>.json   ㉗ 消费者视角 {consumer, inputs:[producers]}
        ├── map-item.json              ㉘ {item:{over,index,value}} 每map slot一个
        └── tournaments/<region>/
            ├── target-before/**       ㉙ tournament冻结的父workspace全量内容
            └── winner-change/**       ㉚ 只冻结winner的delta文件
```

## 各文件的角色与写入者

| 类别 | 文件 | 写入者 | 时机 | 用途 |
|---|---|---|---|---|
| 观测三件套 ⑨⑩⑪ | logging包（session.ts:81-83） | CLI创建session时开、全程写 | TUI面板、`piano logs` |
| 进度 ⑫⑬ | progress.ts:133-142,267+ | 每accepted stage append jsonl；snapshot在init/start/accept时重写 | watch/监控；**jsonl是证据源，json只是投影** |
| 恢复 ⑭ | resume-state.ts:22-35 | 每轮prompt后重写 | `piano resume`：靠sessionId+transcriptPath续内层harness会话 |
| 契约溯源 ⑮ | contract-snapshot.ts | worker启动前写一次 | evals回读时重算sha256验证 |
| 会话转录 ㉔ | harness subprocess adapter | 子进程每行stdout原样落盘 | 唯一的"全量原始对话"存档；解析后的事件不另存文件 |
| stage产物 ㉕ | **agent自己**（Write/Bash） | 提示词指定路径 | orchestrator退出后读回校验；GPU流校验通过后orchestrator会**用materialized payload重写它**（workflow-execution.ts:2093,870,894） |
| handoff链 ㉖㉗㉘ | handoff.ts:88-162 | stage验收后/消费者启动前 | 跨stage传证据的不可变JSON |
| 轨迹流 ⑱-㉓ | @piano/trajectory recorders | 观测事件驱动，append | evals评分优先读这里，缺index.json才回退读⑫⑨⑪（legacy-run-adapter） |
| workspace ⑯⑰㉙㉚ | workspace.ts | slot创建/record原子写；tournament边界冻结 | 恢复/回滚/合并winner |
| 共享home ②-⑤ | harness-home `writeGenerated`（.tmp+rename） | **每次run都会再生成覆盖** | 非run私有，不属runDir |

## "多少个"——以 canonical topsop-tuning.yml（10轮、单lane、validate:true）粗算

固定 6 个（⑨⑩⑪⑬⑭㉓）＋ ⑫≈accepted stage数（setup+explore+每轮(idea+implement+verify+measure)+summary ≈ 45+行）＋ ⑮=用到的distinct contract数（~8）＋ ㉔=actor数（stage×lane，续跑复用同一文件）＋ ㉕=attempt总数（含被拒重跑）＋ ㉖=accepted producer数，㉗㉘≈stage依赖数（每轮若干）＋ ⑯⑰=slot数。约 **150–250 个文件**，其中每轮真正"新"的是 result.json、handoff 记录、progress 行和各 jsonl 的追加行。

## 几个容易误解的点

- **stream-json 解析结果不落独立文件**：claude 的每行 JSON 只原样进 ㉔；归一化后走内存事件 → ⑪/⑨/⑱-㉒。
- **⑫ progress.jsonl 是 append-only 证据源**，⑬ progress.json 可随意替换——注释明说（progress.ts:137-139）。
- **agent 生成的非代码文件**（workspace 内，recipe 规定）：`state/tuning-state.json`、`rounds/iter-NNN.json`、`profiles/iter-NNN/kernel.json`、`reports/verify.json`、`bench/iter-NNN.txt`、`asm/iter-NNN/current-best.s`——topsop 流由 agent 写；**GPU 流的 rounds/state 由 orchestrator 写**（`materializeGpuPromotion`，workflow-execution.ts:870,894），agent 被告知不许碰。另外 winner 自动 commit 进的是 workspace 的 git 历史，不是 run 文件。
- **evals 的分数不在 runDir 里**：run 内只有轨迹，评分发生在读取侧，只有 `~/.piano/evals/<case>/history.jsonl`、`baseline.json` 和 `report.json`（cli/src/evals.ts:180-181）落盘。
