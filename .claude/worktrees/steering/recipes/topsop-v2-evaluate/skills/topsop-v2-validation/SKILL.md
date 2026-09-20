---
name: topsop-v2-validation
description: Topsop V2 的构建、runtime identity、correctness、sanitizer 和候选安全验证闭环。
---

# Topsop V2 validation

1. 验证顺序固定为：candidate-plan conformance → 构建 → gtest listing → primary target → guard targets → 完整回归 → 按策略 sanitizer → latency performance → 仅对 latency-eligible 候选执行声明目标 profile。
2. 每个运行进程从 stdout 提取 runtime identity；expected/observed canonical JSON 和 SHA-256 必须完全一致，源码、case 名或 listing 不能代替 runtime evidence。
3. correctness 记录 passed/total、容差、最大误差、exit code、artifact digest 和 raw log。任何 guard 失败都拒绝候选。
4. 禁止通过放宽容差、删除 case、改变输入规模、屏蔽 sanitizer 或修改 benchmark 定义来使候选通过。
5. sanitizer exclusion 只能来自当前 repository 的正式配置；手写 ASM 已知排除项不能被临时强制插桩。
6. hang、illegal address、DTE programming error、alignment、mailbox/barrier、tail 和容量问题必须按真实症状分类，不凭猜测改 kernel。
7. target profile 必须覆盖 prepare 声明的全部目标，并与 candidate artifact digest、primary runtime identity 绑定；缺项不能进入 KEEP。
8. 只对与 candidate artifact digest 完全一致的测试和 profile 结果做结论。
