---
name: topsop-operator-evidence
description: topsop 算子级稳定命令、case、baseline、历史尝试和进展记录的按需证据入口；用于跨 stage 复用当前 workspace 中已验证的 operator-local 事实，不替代源码、当前工具输出或 stage 权限边界。
---

# topsop operator evidence

先读 [`document/INDEX.md`](document/INDEX.md)，只打开与本 stage 所需证据类型对应的文档。

- 优先使用 handoff 已给出的精确路径；否则从正式测试入口邻近位置查找测试脚本头部记录、`op_dev/rule.md` 和 `op_dev/cli`，禁止跨 workspace 或递归 `$HOME` 搜索。
- 当前源码、当前构建/测试/profile 输出高于历史 rule、progress entry 和旧 state；冲突必须记录，不得用历史数字覆盖当前证据。
- 复用记录时保留 command、case、shape/dtype、artifact digest、metric identity、source anchor 和结果状态；缺失字段不得猜测。
- V2 durable `state.json` 由 characterize 初始化、promote 事务更新；其他 stage 只读取 handoff 明确给出的 path+digest，不枚举 state root。
- summary 只有在 mission 或 accepted handoff 明确给出 progress 文件、写入格式和权限时才可追加一条记录；V2 不假定存在 `progress_record` contract 字段，也不自行创建第二套 memory 文件。
- 历史成功只证明曾经可行，历史失败只排除相同身份与控制变量下的尝试；都不能证明当前 kernel 状态。
- 本 capability 不扩大 worker 权限：只读 stage 不得写回，任何写入都必须位于当前 worker contract 和工具权限允许的范围内。
