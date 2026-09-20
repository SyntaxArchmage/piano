# reviewer_*.md 写作模板

每个 `reviewer_<n>_*.md` 是一个具体 reviewer 的领域规则。新增或修改 reviewer 文件时按下列结构组织，让人和 agent 都能快速找到关键信息。

## 推荐结构

```
# Reviewer N — 简短标题

一句话说明本 reviewer 负责什么。

[可选] 加载 `gcu400-xxx` skill：说明该 sibling skill 提供哪类硬规则。

[可选] ## 外部参考
- 仓库内 markdown / `.cursor/rules/*.mdc` / 外部仓库链接
（不要互相引用其它 reviewer_<n>_*.md）

## 触发条件 / 适用范围
什么样的 target 命中本 reviewer，什么时候返回 `not_applicable`。

## 核心规则
按主题分若干小节，每节给具体规则、判定要点、典型反例。

## 防误报（可选但推荐）
描述常见的误判场景和判定口径，避免 reviewer 过度报警。

## 输出要求（可选）
本 reviewer 必须填的特殊字段（例如对账表 schema、`delivery_gate` 取值）。
```

## 写作约定

- **不要**在 reviewer 文件里互相引用其它 `reviewer_<n>_*.md`，规则跨 reviewer 协作由 `common.md` 的"四级固定联动"维护
- 严重度只用 `Blocker` / `Major` / `Minor` 三档，不要在 reviewer 文件里自定义第 4 档
- 写到"按 Blocker 处理 / 按 Major 处理"时，默认与 `common.md` 的严重度口径一致
- 命中强制规则锚点的规则可以在小节标题写明 "（命中强制规则锚点）"，但锚点本身的清单维护在 `SKILL.md` 的"强制规则锚点"小节，不要在 reviewer 文件里复制完整清单
- 具体反例 / 数账例子比抽象口号更有用，能给就给
- 引用 V3 sibling skill 时只写 skill 名（`gcu400-dte` / `gcu400-compute` / `gcu400-debug` 等），不写路径
- 引用 `topsop_400.mdc`（alwaysApply）时用"按 / 见 / 对照"动词，不用"加载 / 进入"
