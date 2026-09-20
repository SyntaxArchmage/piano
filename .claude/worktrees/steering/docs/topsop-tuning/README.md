# TopSOP tuning documentation

TopSOP 调优相关文档统一放在本目录，并按 workflow generation 分开维护：

- [`v1/`](v1/README.md)：现有 `topsop-tuning.yml` 及历史多 worker 流程的设计、问题与实测记录。
- [`v2/`](v2/README.md)：`topsop-tuning-v2.yml`、tournament 版本以及 V2 worker/contract 的设计与变更记录。

## 边界

以下内容虽然可能由 TopSOP run 触发，但属于 Piano 通用能力，因此继续保留在原有通用目录：

- `docs/issue-51-loop-context-worklog.md`：通用 loop actor context/compaction。
- `docs/WORKLOG-TOURNAMENT-2026-09-04.md`：CUDA tournament/runtime 试跑。
- `docs/proposals/`：通用 workflow、referee、memory、budget 和 resource scheduling 方案。
- `docs/deep-dive-notes/`：通用 run artifact 与 prompt 分析。

## 新文档约定

1. V1 专属文档放入 `docs/topsop-tuning/v1/`。
2. V2 专属文档放入 `docs/topsop-tuning/v2/`。
3. 跨 workflow 的 Piano 框架设计继续放在 `docs/` 对应通用主题目录，不因证据来自 TopSOP 就归入这里。
4. 实测、缺陷修复或 worker 调整文档使用日期后缀，并记录原因、改动、验证和 implementation commit ID。
