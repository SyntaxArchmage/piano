# topsop-gcu400-validation document index

Pinned source: kerneldevsuite commit `36c559d465ac7636678e094ccf512cfc5ff61bbe`.

Current workspace source and current tool output override these imported references. Read one primary domain and at most one auxiliary domain. Historical case studies are hypothesis sources, not proof of current implementation or speedup; images and unselected optimization documents remain excluded.

## debug

Keywords: `mismatch`, `hang`, `reset`, `sanitizer`, `driver`, `probe`.

- [EFSMI User Guide](debug/efsmi_user_guide.md) — reference-or-spec; `sha256:1b0b9e8a65e20c9942e4122500a6c584ed3b9df7d47ffc1b642ef9285dabb3c9`
- [Enflame Driver User Guide](debug/enflame_driver_user_guide.md) — reference-or-spec; `sha256:5d383055e56a14e4876dabf2e344b6d506d8be89bda8e3f4aba8e7c4ee16f2f3`
- [gcu400-debug 原始资料索引](debug/source_materials_index.md) — upstream-source-index; `sha256:d40820d5a62b063d46e9084d29bb482e7673ef5b99a83ab59c9ccbb248fee98a`
- [Stack Size Analysis on Libra](debug/stacksize_analysis.md) — derived-reference; `sha256:a56bdaafead33c59a7417883fb84a681b2a22966f5872c46ea847999846849ab`
- [TopsGDB User Manual](debug/topsgdb_user_manual.md) — derived-reference; `sha256:b601262f91e82596f19230504ce27519ba9fa63e3bd36354b63ee3bed883db5d`
- [TopsSanitizer User Guide](debug/topssanitizer_user_guide.md) — reference-or-spec; `sha256:5a6269d70049dfb0d5259e02870fcfec0f0ea5f1c785e2fa221fb750a64dc5ea`

## testing

Keywords: `correctness`, `boundary`, `dtype`, `dispatch`, `sanitizer`, `regression`.

- [gcu400-testing](testing/upstream-skill.md) — upstream-skill; `sha256:7cfa3df9e169b5e9cbe6beef66ec6247e322992f03cce4f2e94dceb165f292b8`

## review

Keywords: `review`, `host-device`, `alignment`, `budget`, `dte-lifecycle`, `synchronization`, `numeric`.

- [GCU400 Code Review Checklist Mapping](review/common.md) — review-checklist; `sha256:8ca836064a20db383f7b5e28346e21b6520818e228b7f4af5cfbf05ca1fb7e9b`
- [reviewer_*.md 写作模板](review/readme.md) — review-checklist; `sha256:ab48eb5ef2a84f66d3628fd0e9b3a25fa3bbcf5048c1ce7837ec46230ccd92f9`
- [Reviewer 0 — Host API 接口契约检查](review/reviewer_0_host_api.md) — review-checklist; `sha256:ecc6fce2a9abcfbcfe98dd054fecc60b8a0cb6bbece96b2dccfd7b0586bc389e`
- [Reviewer 1 — 向量对齐与地址空间约束检查](review/reviewer_1_memory_alignment.md) — review-checklist; `sha256:8fd2287c43dd847b83993cfae10bca5e3b2546de52f8fa3c9800bf0e3406bc82`
- [Reviewer 10 — L0P5 cache 一致性检查](review/reviewer_10_l0p5_cache_consistency.md) — review-checklist; `sha256:b5e68b1524578afdb2c9f9142adb01cb60b706a9c54f18cb52691f31696a694e`
- [Reviewer 11 — DTE 跨循环 event trace](review/reviewer_11_dte_cross_loop_event_trace.md) — review-checklist; `sha256:ef31b9b7574421145bdcbf0d07f048a1c912ad7f44d1204bf52fde4a6a0bed94`
- [Reviewer 12 — Mailbox 生命周期与计数器检查](review/reviewer_12_mailbox_lifecycle.md) — review-checklist; `sha256:1eeaa92400e4887657c01985bed4fe16526dbc96bdfa306d09360a2c859dc3ce`
- [Reviewer 13 — TVSTOA CVT 硬件 bug 检查](review/reviewer_13_tvstoa_cvt_hw_bug.md) — review-checklist; `sha256:85c143573563bef7017118e42f3afbf5d0796607a7e2a29d40bcdca90001df6d`
- [Reviewer 14 — 被调 helper / Primo++ 接口契约检查](review/reviewer_14_callee_contract.md) — review-checklist; `sha256:a1a329621e505569d95c959bcde40a0e101e3063e8c19d910fc1322314ce2162`
- [Reviewer 15 — 工程门禁与交付判定](review/reviewer_15_engineering_delivery_gate.md) — review-checklist; `sha256:3c4c35189c22792fcad9bc602b643b41ad4ddf31562d4a00b9c26f5f7b9d6561`
- [Reviewer 16 — 地址算术溢出与极端输入检查](review/reviewer_16_address_overflow_extreme_shapes.md) — review-checklist; `sha256:7869be9d13d00d13a377afd53922ffd3659acd11a97c4f86e2b8f9c5dc5c056d`
- [Reviewer 2 — host / kernel 一致性检查](review/reviewer_2_host_kernel_consistency.md) — review-checklist; `sha256:16e092318ebb7bdea304e807eae7d86cfdb96eff60a493121fa817616d7b88ea`
- [Reviewer 3 — dispatch / planner 一致性检查](review/reviewer_3_dispatch_planner_consistency.md) — review-checklist; `sha256:33b5e43b5c7a553fd90c0603f4c008ddb226c94bc27500a66fece61ced4b3936`
- [Reviewer 4 — 资源预算检查（L1 / OACC / 栈）](review/reviewer_4_memory_budget.md) — review-checklist; `sha256:9816a7d24ed5567b70283908182ff915e5f3bdf53f25581bd5cc71e419beb2f6`
- [Reviewer 5 — DTE 生命周期检查](review/reviewer_5_dte_lifecycle.md) — review-checklist; `sha256:b84dd4eb9631ebcaa80a58726e02128050553b81e87f930d7818e93fe3b13492`
- [Reviewer 6 — 同步 fence / barrier 检查](review/reviewer_6_fence_barrier.md) — review-checklist; `sha256:dffd15177b149e4bcc7f0b7c5f0dd05e590395c8f5417ed5fd53907032020564`
- [Reviewer 7 — optional / tail path 分支检查](review/reviewer_7_optional_tail_path.md) — review-checklist; `sha256:de5c2029139342ae5803d83a56e0aa7a3a2c4f1fa107236074cb2ebc1fb5bd44`
- [Reviewer 8 — 1D 归约数值稳定性检查](review/reviewer_8_numerical_stability.md) — review-checklist; `sha256:86210e751b1ea1d0587eafb26f4a03e01b80a9759b35e7ebc25b680d01c899ac`
- [Reviewer 9 — 测试语义有效性检查](review/reviewer_9_test_semantics.md) — review-checklist; `sha256:b10a042ed89c8ef129f57b25e9cb392946b7745e42bc5a9b5f3f6d9942b17c54`
