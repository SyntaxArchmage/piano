# topsop-gcu400-performance document index

Pinned source: kerneldevsuite commit `36c559d465ac7636678e094ccf512cfc5ff61bbe`.

Current workspace source and current tool output override these imported references. Read one primary domain and at most one auxiliary domain. Historical case studies are hypothesis sources, not proof of current implementation or speedup; images and unselected optimization documents remain excluded.

## perf-estimation

Keywords: `roofline`, `bound`, `profile`, `latency`, `bandwidth`, `utilization`.

- [性能诊断模板与常见误判](perf-estimation/diagnosis-templates.md) — derived-reference; `sha256:3ed65f560c3eae2a383e8df43b099cb6aabb05de6fd315445310a4a88bfaca90`
- [融合算子 / LLM 整网 / MoE 性能建模](perf-estimation/fused-op-and-llm-modeling.md) — derived-reference; `sha256:4bda3186d82058805ad981af96003db5233a369a154f627d9c1356c6b3b920cf`
- [Performance Quantitative Analysis](perf-estimation/meeting_performance_quantitative_analysis.md) — internal-report; `sha256:d44e51cd7d5ed1f35b6ee06c61d8bc9ea2107bb1168c36e86fa0162298b7b409`
- [gcu400-perf-estimation 原始资料索引](perf-estimation/source_materials_index.md) — upstream-source-index; `sha256:2b6c04f119afd9a1c030a40d278e1b70e394a5fb2c556e040666abf3a4e20cc7`
- [TCU User Guide](perf-estimation/tcu_user_guide.md) — reference-or-spec; `sha256:e58d0f1a0da1d89be4dabc1ce82d3fc4cd41cb514d20f5020cf29a4f1835a515`
- [TOPSProf User Guide](perf-estimation/topsprof_user_guide.md) — reference-or-spec; `sha256:2325c8e799476947b97c7f8dff3f20d55580a4788e66a79ea767fda1b9f1b24d`
- [TOPSPTI API Reference](perf-estimation/topspti_api_reference.md) — reference-or-spec; `sha256:d2a3e61fbcd6c7f411bc48a5f94b02c9e6848b6c9bcb3dddb39a86f861af6e5e`
- [TOPSTX API Reference](perf-estimation/topstx_api_reference.md) — reference-or-spec; `sha256:5c25f1adef14f5c7cc0a663490a436fa58768df59f9d1d3721f48499c498e2a8`

## optimization

Keywords: `historical-case`, `bottleneck-signature`, `attention`, `gemm`, `reduction`, `moe`, `topk`, `data-movement`.

- [01. FlashAttention Varlen FP8 Prefill 192 Causal GCU400 深度重写报告](optimization/gcu400_deep_dive_01_flash_attn_varlen_fp8_prefill_192_causal.md) — historical-case-study; `sha256:c8f6d5170d70d4c13923866ef225882ffeaa3d30e7e29cb5048bafae2d10ff03`
- [108. index_put GCU400/libra kernel 深度报告](optimization/gcu400_deep_dive_108_index_put_gcu400_manual.md) — historical-case-study; `sha256:1392fc60f9fa7330258df213599d6a3c20af6dd9d846d40122d81303539ab644`
- [14. Matmul Quant FP8 L2 General Pipeline Kernel](optimization/gcu400_deep_dive_14_matmul_quant_fp8_l2_general_pipeline.md) — historical-case-study; `sha256:89eb1397075df0e51f96be45ba6d7f4a1d9377d84cb876638367d3d953eb1c9b`
- [19. moe_align_block_size GCU400 kernel 深度解读](optimization/gcu400_deep_dive_19_moe_align_block_size.md) — historical-case-study; `sha256:b9037959fd7dac250cfa69873c8f74f2a8ab97db70e9e75ece9f8c7ac8190707`
- [25. `fused_add_rms_norm_kernel_impl_fp8_gcu400` 深度解读](optimization/gcu400_deep_dive_25_fused_add_rms_norm_fp8.md) — historical-case-study; `sha256:a75e5039e48de24685be72b16d19860eb31d54d3575cca87d0fa5298354685c2`
- [28. Top-K Renorm Probs GCU400](optimization/gcu400_deep_dive_28_top_k_renorm_probs.md) — historical-case-study; `sha256:fe423d37e14016dee725dde8a14cae3e4af485aa999370d4c64d84b4301dd781`
- [性能瓶颈报告索引](optimization/optimization_report_index.md) — optimization-index; `sha256:2f56e435582ad1b8bfcc7e3c240b91917aede98777c2b633c5cba8ab6ca072e0`

### Bottleneck-signature routing

- `attention` — signatures: `attention`, `mla`, `kv cache`, `softmax`, `causal`, `prefill`; open [01. FlashAttention Varlen FP8 Prefill 192 Causal GCU400 深度重写报告](optimization/gcu400_deep_dive_01_flash_attn_varlen_fp8_prefill_192_causal.md).
- `gemm` — signatures: `gemm`, `matmul`, `fp8`, `l2 pipeline`, `quant`; open [14. Matmul Quant FP8 L2 General Pipeline Kernel](optimization/gcu400_deep_dive_14_matmul_quant_fp8_l2_general_pipeline.md).
- `elementwise-reduction` — signatures: `elementwise`, `reduction`, `rmsnorm`, `norm`, `fused add`; open [25. `fused_add_rms_norm_kernel_impl_fp8_gcu400` 深度解读](optimization/gcu400_deep_dive_25_fused_add_rms_norm_fp8.md).
- `moe-routing` — signatures: `moe`, `expert routing`, `align block`, `token routing`, `histogram`; open [19. moe_align_block_size GCU400 kernel 深度解读](optimization/gcu400_deep_dive_19_moe_align_block_size.md).
- `topk` — signatures: `topk`, `top-k`, `renorm`, `probability`, `selection`; open [28. Top-K Renorm Probs GCU400](optimization/gcu400_deep_dive_28_top_k_renorm_probs.md).
- `data-movement` — signatures: `data movement`, `gather`, `scatter`, `index_put`, `indexed write`; open [108. index_put GCU400/libra kernel 深度报告](optimization/gcu400_deep_dive_108_index_put_gcu400_manual.md).
