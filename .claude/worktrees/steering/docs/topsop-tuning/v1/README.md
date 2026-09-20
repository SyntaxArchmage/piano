# TopSOP tuning V1

V1 指 `recipes/workflows/topsop-tuning.yml` 及其 setup-env、explore、theory、profile、idea、implement、verify、measure、summary worker 链。

## 设计和维护状态

- [`TODO.md`](TODO.md)：V1 调优管线遗留问题与候选修复。
- [`contract-refactor-status-2026-09-04.md`](contract-refactor-status-2026-09-04.md)：worker-owned contract 迁移状态和 legacy 边界。
- [`topsop-setup-env-config-guard.md`](topsop-setup-env-config-guard.md)：OPHAL 配置解析/cwd 陷阱及防护。

## 端到端验证记录

- [`tune-loop-2round-verification.md`](tune-loop-2round-verification.md)：双轮 handoff/feedback 验证。
- [`tune-loop-8round-verification.md`](tune-loop-8round-verification.md)：八轮调优、blocked 与提前终止验证。
- [`issue010-verification-run-20260829.md`](issue010-verification-run-20260829.md)：iteration-scoped block 与 convergence 验收。
- [`issue011-012-verification-run-20260829.md`](issue011-012-verification-run-20260829.md)：ASM evidence 与 summary progress 验收。

V1 仍用于兼容已有用户；新的 TopSOP workflow 设计和能力增强应优先记录在 [`../v2/`](../v2/README.md)。
