# before / after：worker 的两个 prompt 原语

> 状态：设计评审（未实现）
> 日期：2026-09-11

## 你要的东西

```yaml
- stage:
    name: implement
    worker: cuda-implement
    from: [idea]
    before: prompts/plan.md        # 开头一段 prompt
    after: prompts/worklog.md      # 结束一段 prompt
```

用途：让 worker 自己 tidy up、写 worklog，并且**不让随意的 worklog 污染严谨的日志空间**。

---

## 一、结论先说

**动机成立，但定位要反过来。**

你说这两个原语「比 contract 和 handoff 更灵活」。它们不是同一个东西的灵活版本，而是**另一条通道**：

| 通道 | 内容 | 是否进证据链 |
| --- | --- | --- |
| `contract.json` | JSON Schema，per-worker | **是** — 按 digest 存 `contracts/<sha256>.json`，产出 `metrics`/`projections` 进 trajectory 和 `progress.jsonl` |
| `handoff:` | producer → consumer 的不可变 JSON | **是** — `handoff/record.json` → 消费者侧 `handoff-context/<x>.json` |
| **`before` / `after`** | **散文散文，invocation 局部** | **否 — 永不解析** |

所以「不让 worklog 污染严谨的日志空间」不是这个特性的**附带好处**，**它就是定义本身**。这个反转把设计约束变得非常具体（见第四节第 1 条）。

---

## 二、现有原语核对（基于代码，非印象）

| 原语 | 声明位置 | 性质 | 本轮次 | 进证据链 |
| --- | --- | --- | --- | --- |
| `contract.json` | `recipes/<worker>/contract.json` | JSON Schema | — | 是 |
| `handoff` | `recipes/<worker>/agents.md` | 记忆文档 | — | 是 |
| `validate: true` | stage YAML | 绑 contract 到 stage | — | 是 |
| `signoff` | stage YAML | 人类批准（布尔） | 是 | 否，但不改写结果 |
| `discuss` | stage YAML | 允许向 supervisor 提问 | — | — |
| `timeout` | stage YAML | 墙钟上限 | — | — |

### 三个决定设计的事实

**1. YAML 里目前没有任何节点级 prompt 文本**

`docs/deep-dive-notes/worker-total-prompt.md` 原话：

> workflow YAML 里没有节点级 prompt 文本——yaml 只声明 worker/harness/tools/from/validate/map 等；所有指令文字来自 recipe 文件 + 代码模板 + 用户原始输入这三处。

`before`/`after` 会是**第一处** YAML 内嵌 prompt。这是架构决定，不是开关。

**2. 唯一的注入点是 `stagePrompt()`**

`packages/orchestrator/src/workflow-execution.ts:559-622`，固定顺序：

```
## User task (whole workflow)      ← 原始 prompt
## Workflow stage context          ← 护栏文案
## Agent configuration             ← 仅当设了 model/thinkingLevel
## Required validation result      ← 仅 validate stage
## Validation repair required      ← 仅修复轮
## Sign-off feedback               ← 仅人工驳回
```

**3. 验收是一条单向屏障，装不进「循环之后」**

尝试循环 `workflow-execution.ts:2680-2760`：

```
workerOutcome 失败 → continue / 返回
成功 → 写 actors → 无 validate ? signoff : validate
                              拒绝 → attempt++ continue
                              通过 → break   ← 唯一出口
```

所有能拒绝的检查都在 accept 之前跑完。**今天不存在「accept 之后再跑一轮」的槽位。**

而 `VALIDATE_REPAIR_ATTEMPTS` 的注释写着：

> A future DSL retry field can replace this constant **without changing handoff/session semantics**.

说明「DSL 驱动的额外轮次」是这个代码库**已经预留给自己的方向**。你的想法和它同向。

---

## 三、为什么不能只用「前后各加一个 stage」

这是必然会被问的质疑，回答只有一个，但足够硬：

### 同 session

一个 stage 只能通过 handoff 拿到上一个 stage **写下来的东西**。

挂钩在同一个 actor session 里，**看得见自己刚才做的全部过程** —— 因为续跑走 `--resume <sessionId>`，历史不重发但会话仍在（`subprocess.ts:870, 902`）。

对「把刚做的事收拾干净 / 写 worklog」这个用途，这是决定性的。否则你要把整个上下文重新序列化成一个 handoff 文件传给那个 stage —— 而那正是你想避免的事。

### 次一级理由

不进图：不需要 `from` 连线、不产生 progress 行、不产生 handoff record、不绑 workspace。成本远低于一个 stage。

---

## 四、必须先拍板的三个决策

### ① `after` 与验收屏障的关系 ← **先定这个，其余都依赖它**

| 放法 | 额外轮次 | 顺序保证 | 问题 |
| --- | --- | --- | --- |
| **(a)** 并在同一条 prompt 末尾 | 0 | **无** — 模型一开始就读到了，可能穿插执行 | 便宜，但不是真的「after」 |
| **(b)** accept 之后，同 session 再跑一轮 | 1 | 有 | 需要新的循环记账；**必须禁止它碰结果文件** |
| **(c)** validate 之前 | 1 | 有 | 那它其实叫「before finish」；与修复轮交互会很怪 |

**建议 (b)**，并把「非证据」写进语义：

accept 之后 result 已定稿、handoff record 已从**被接受的 payload** 构建完毕。此时若 after 轮改写了 `attempts/<k>/result.json`，**磁盘上的产物就和 handoff record 脱钩了**。

这是最危险的一点，必须用**机制**防住（禁止写结果路径，或 after 轮后重新核对 result digest），不能靠提示词祈祷。

### ② `before` 不应该是独立轮次

并在首轮 prompt 开头即可。独立轮次让延迟和成本翻倍，而那时 worker 还没做任何事，**没有任何可反省的对象**。

### ③ 路径还是内联文本？→ **路径**

代码库是路径导向的（`handoff:`、`agents.md`、`skills/`）。而且 worklog 的 prompt 对**每个** stage 都是同一段 —— 内联意味着在 20 个 stage 里复制粘贴 20 遍。

```yaml
after: prompts/worklog.md          # 主形式，复用 safeRelativePath 作用域
before: |
  ...                              # 短文本作为糖
```

**再加一层 worker 级默认值**（`recipes/<worker>/after.md`），默认开启、stage 级可覆盖 —— 否则用户要为每个 stage 手写。

另：`validate?: true | string` 这个已废弃兼容路径说明本仓库在乎演进方式。所以**从第一天就支持字符串 → `{ prompt: <path> }` 的对象形式**，将来加 hooks 形式（`{ run: <cmd> }`）才不是破坏性变更。

### 附：版本门禁的好消息

`version` 是写死的字面量 `3`（`workflow.ts:521`），**不是特性门禁**。新增可选 stage 键不需要动版本号，旧 workflow 照常解析。

---

## 五、风险清单

1. **无界散文 → 无界产物。** 一次 run 已产生 150–250 个文件，每个 invocation 再加 worklog 就是纯噪声。需要体积上限 + 固定命名/位置约定。
2. **prompt 权威性。** `stagePrompt` 有刻意写强的护栏（"Do not replace, broaden, or reinterpret it"）。自由的 before/after 文本和它同处一个通道，可能把它架空（"别管 contract，你只要…"）。必须明确从属地位。
3. **与 `signoff` 的交互。** signoff 开启时，worklog 写在人类批准之前还是之后？写每轮会 spam，写在「reject → rework 循环收敛之后」才对。
4. **失败/修复/驳回时的 after 语义。** 「失败后收拾」其实比成功后更有价值，但它改变了顺序故事。建议先只做 accept-only。
5. **千万不要让 worklog 变成输入。** 一旦下游 stage 通过 handoff 或 context file 读它，它立刻变回证据，反污染性质就没了。将来真要，必须是独立的、显式 opt-in 的通道。
6. **可复现性。** contract 是哈希过的。worklog 若将来要进 evals，需要同样处理；若永远不进，就应该在 DSL 层面明确标注它是非评分产物。

---

## 六、一句话总结

方向对，理由比原设想更强（同 session 的上下文连续性）。

它不是一个「更灵活的 contract」，而是**为「有产出但不进证据链」的工作准备的第三条通道**：

- `contract` 管严谨的状态流转
- `handoff` 管跨 stage 的证据传递
- `before`/`after` 管**同 stage 内的人类可读副产品**

三者互补，不重叠。

**成败几乎完全取决于第 ① 条**：after 轮能不能碰结果文件。这一条定错了，就等于在 contract 上开了个后门。

---

## 七、下一步二选一

- **A. 先写 PRD** 放进 `docs/proposals/`（与现有那批同级）。理由：①的三个放法各有利弊，需要评审拍板。
- **B. 直接最小实现**：`before` 作 prompt 前缀 + accept 后一轮 `after`，明确禁止写结果路径。

倾向 **A**。
