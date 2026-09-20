# topsop-gcu400-foundation document index

Pinned source: kerneldevsuite commit `36c559d465ac7636678e094ccf512cfc5ff61bbe`.

Current workspace source and current tool output override these imported references. Read one primary domain and at most one auxiliary domain. Historical case studies are hypothesis sources, not proof of current implementation or speedup; images and unselected optimization documents remain excluded.

## compute-flow

Keywords: `host-api`, `runtime`, `dispatch`, `topscc`, `execution-model`.

- [EFVM IR Specification](compute-flow/efvm_ir_specification.md) — reference-or-spec; `sha256:f73b64c5804c1ec2b0b0250fb895c8c4927c7adde6c3fd3055972b19df2f2e6e`
- [Host Runtime API Reference](compute-flow/host_runtime_api_reference.md) — reference-or-spec; `sha256:85c600573bc6301ea705396396d45acefbaefc8f495c1871aa778b33d4b61477`
- [Kernel Runtime API Reference](compute-flow/kernel_runtime_api_reference.md) — reference-or-spec; `sha256:4c48d9a439da1fcc7b51307c2568f1123ba4a67a3208e8544f48f43655c6cf19`
- [Library Kernel API Reference](compute-flow/library_kernel_api_reference.md) — reference-or-spec; `sha256:78d77140859d433a81fe8e06ade33ee4d778f643fa94bd3d564fb5c92ac482ec`
- [V3 Operator Programming Guide](compute-flow/op_dev_intro.md) — derived-reference; `sha256:1d762914a50422b66184d0707a7a4041e73e035bb314a2ee2a60f3492aa899cc`
- [gcu400-compute-flow 原始资料索引](compute-flow/source_materials_index.md) — upstream-source-index; `sha256:972a67c89ce77cb37f11adbc4fac53d763cfa7d63a00079dede9b5e696009fff`
- [TOPS C++ Programming Guide](compute-flow/tops_cpp_programming_guide.md) — reference-or-spec; `sha256:86ed5514d2636ba4b830dcaa56ae32502451fcc0e3b5bb193e4d399e7afdf3d5`
- [Tops C++ 编程指南核心速查](compute-flow/tops_cpp_quickref.md) — derived-reference; `sha256:a6909badc2f4711a18ae3b94830e80578fc547a89840d9a21f77b234d2f0c728`
- [TopsAten Operator Development Guide on Libra](compute-flow/topsaten_dev_guide.md) — reference-or-spec; `sha256:7a1f75bd7aa20158db7f5de9d277647a289471123973664ca3913866dcc0cf43`
- [TCLE 原子操作（Atomic Operations）](compute-flow/topscc_atomic_ops.md) — derived-reference; `sha256:5a52cac74fe5bf7f2a53becbf8d89a3344c138810922908b18d101a9d9255337`
- [DTE（Data Transformation Engine）API 概要](compute-flow/topscc_dte_ops.md) — derived-reference; `sha256:a0617f8cd48e9fa060b3ed80691ff6b290578e616fc0c60687ec43c661be02f6`
- [TCLE 数学函数与超越函数参考](compute-flow/topscc_math_functions.md) — derived-reference; `sha256:e5d7b1e95063ded9d73778b449f66e4e227bd177c9989fc6a0e2d318fff0f152`
- [2D 矩阵接口（matrix_t / matrix_ldst_t）](compute-flow/topscc_matrix_2d.md) — derived-reference; `sha256:388fb3aa3efd9de118e35033023b569e31f2ea8e1244d292ef9e3cf1a5a6338c`
- [TCLE 内存操作：`gather` / `scatter` / `load_stride` / `store_stride`](compute-flow/topscc_memory_ops.md) — derived-reference; `sha256:d101c97734167727abddd84df7eec50b8f4329c14f658b469c061350b6e04825`
- [TCLE 向量内部元素运算（归约、移位等）](compute-flow/topscc_reduce_ops.md) — derived-reference; `sha256:88a8b0d1905fefdf309616d2d2d690a3207dc661ad007a2273a64c7f620fc4a9`
- [Tops C++ 同步机制与管道流水线（Synchronization & Pipeline）](compute-flow/topscc_sync_ops.md) — derived-reference; `sha256:c82c6fb11a723a97f3f1e9a71bb83ba4b2f8fdb20e56b380c080133869b3945e`
- [TCLE 向量计算 API 参考](compute-flow/topscc_vector_compute.md) — derived-reference; `sha256:e56aa6a27ff616ef695fbaf098d9a3feb9a34d3635da96b3fbffcb25790d6f7b`

## compute

Keywords: `1d`, `2d`, `oacc`, `gemm`, `l0p5`, `vector`.

- [V3 1D 计算流水线模型](compute/general_compute_1d.md) — derived-reference; `sha256:7c639b0ac10f3b2c3861cc9e57aab508b275634646bfaf78e0c98fe38f84c258`
- [ISA4.0 Instruction Reference (Compute-Focused)](compute/isa4_instruction_ref.md) — reference-or-spec; `sha256:577e733ebcc1fd310955af64c3732f922c4740eb525e146f70dfa071afac35fc`
- [ISA4.0 MOP 指令族(MALU 1D element-wise 算术 / 逻辑 / 比较 / mixed-precision)](compute/isa4_mop_ref.md) — reference-or-spec; `sha256:9c6952e36cb7b7e04ba30d48aa9607244c38894554b7a991b4bf5b266240a326`
- [ISA4.0 MSF / RED 指令族(MALU 2D 通路上的标量函数 / 序列生成 / 规约)](compute/isa4_msf_ref.md) — reference-or-spec; `sha256:4dbb76e3a03867e2744dfa988ddf62784a52544c3753ae1d66e3c055febf338c`
- [ISA4.0 VMOV 指令族(向量寄存器搬移 / 立即数加载 / VA-OA-Maskbit 通路)](compute/isa4_vmov_ref.md) — reference-or-spec; `sha256:9bbd73a88f9e346f0c05964dda70737f2d3067f50f49797c0cdb66d413638b70`
- [L0P5 Invalidation](compute/l0p5_invalidation.md) — derived-reference; `sha256:86f8762df7435e36a1f59be6a5ace942dbc9adb56a8c94efba17949e238a048a`
- [L0P5 Perf Tuning](compute/l0p5_perf_tuning.md) — derived-reference; `sha256:4c63fcee92259db502202e3d8e4103ffedfc540eab14892a622a58a2614bb8bd`
- [Libdevice Programming Guide](compute/libdevice_programming_guide.md) — reference-or-spec; `sha256:fef46557946ff587320ba3a658e1d9060feda9d0f61eb04fff0035e56aff22c5`
- [Libra SIP Arch SPEC](compute/libra_sip_arch_spec.md) — reference-or-spec; `sha256:aff15b5aa7bd686fceb769254a42d15dd872188b97a2965ba257608850ebefd0`
- [Libra SIP SPR SPEC](compute/libra_sip_spr_spec.md) — reference-or-spec; `sha256:77e5045691f3972231b6611bbc06efc3049a0c3a88767bca8cc53ac4bfb3fc59`
- [General Compute 1D](compute/meeting_general_compute_1d.md) — internal-report; `sha256:91ba1fc8045f76f570ab86aa9f005e89124bcb39f3d175d11d8ba43471088077`
- [L0P5 Invalidation](compute/meeting_l0p5_invalidation.md) — internal-report; `sha256:81e9021d5c06c3c4b05652ff4f4b452e40e9787652634712107a39ec0892bfcd`
- [L0P5 Perf Tuning](compute/meeting_l0p5_perf_tuning.md) — internal-report; `sha256:24ca46848a80e2e2f9dc5f2dca7a81be2f9451a39d1d8ab54ecd37129b41d737`
- [Primo++ GEMM 编程模型](compute/primo_gemm.md) — derived-reference; `sha256:d1c2481453228cdc017126f9e2ac34b699c46358613bd94aa1c23ff92ac88079`
- [Primo++ tensor_queue 编程模型](compute/primo_tensor_queue.md) — derived-reference; `sha256:e61080b1772f5b5bb99e3d3471fb473ec66bb8e88b749da7cb7346fed22d798d`
- [SIP4.0 算力配置 Reference](compute/sip_arch_compute.md) — derived-reference; `sha256:55c3a9a87d4a5d304fda10bf71512517dc81a54e8d2896598b7d1a482205b725`
- [Libra SIP4.0 SPR(算子开发视角)](compute/sip4_spr_spec.md) — reference-or-spec; `sha256:19b2ee83e8d82f9a770d5073fb8a09c8b04f23c07eadac29440c4d9803a4e452`
- [gcu400-compute 原始资料索引](compute/source_materials_index.md) — upstream-source-index; `sha256:7f57ea129df14b044781002930f9f81bd340cfa97f643ebf5101874476917aa7`

## dataflow

Keywords: `pipeline`, `sub-thread`, `buffering`, `mailbox`, `fusion`, `resource-budget`.

- [SIP4.0 Memory Subsystem Reference](dataflow/sip_arch_memory.md) — derived-reference; `sha256:dcd07dee226a570d51870be990725ed685dd4f893a258aecf3292df4497ac58d`
- [多子线程通信协议](dataflow/subthread_communication.md) — derived-reference; `sha256:e2f12ab21c2964179348946b9651b9fbb8cb8891d724c34021bf4458990df4e3`
- [gcu400-dataflow](dataflow/upstream-skill.md) — upstream-skill; `sha256:f288324b76e5091baabb2fbe7cdd47822e39ca70e0d770aaef982e6f942cb351`

## scalar

Keywords: `salu`, `sldst`, `branch`, `stack`, `sdmem`, `scalar`.

- [ISA4.0 SLDST 指令族(标量 load/store + AMO)](scalar/isa4_sldst_ref.md) — reference-or-spec; `sha256:96209ae4b2928252b1cadbda81fc9639b5c45848dbb07e76f85efa033886fcc6`
- [gcu400-compute-scalar](scalar/upstream-skill.md) — upstream-skill; `sha256:25f5129871d7996dc1796a3d41dccd0fb09b93331a8d0e59907dc9d16cadf022`

## dte

Keywords: `dte`, `hwsync`, `fence`, `mailbox`, `address-space`.

- [DTE Architecture Reference](dte/dte_arch_spec.md) — reference-or-spec; `sha256:22dee82a8027b0154a270d065aa7fc2abe24cc5a603982f51281be07ad522977`
- [HwSync Arch Spec](dte/hwsync_arch_spec.md) — reference-or-spec; `sha256:f6f7ab92a6a2636a35dd81c8193e650b885b3d66ca5b205163caa243762efa19`
- [HwSync Programming Guide](dte/hwsync_programming_guide.md) — reference-or-spec; `sha256:6e9516b0c160bbdf6dba28f3f85ab68a0152c458936e130e07cb49bcfc6406b9`
- [Libra DTE Architecture Specification](dte/libra_dte_architecture_specification.md) — reference-or-spec; `sha256:72f341427d961ea19a132eac94f71b30e292ddd4cde4e463e53c4fb65a83001d`
- [gcu400-dte 原始资料索引](dte/source_materials_index.md) — upstream-source-index; `sha256:6cf73a4ee4a67c641910463cb2337947eeb6cc56840ad023a2b6ed48b2527013`

## ldst

Keywords: `load-store`, `alignment`, `specifier`, `tar`, `vdmem`.

- [ISA4.0 VLDST 指令族(向量/矩阵 load/store)](ldst/isa4_vldst_ref.md) — reference-or-spec; `sha256:2fd060ffef4ea9d3360e9d14c369a1faed10468c3075ed82fb9406d32f3ee14d`
- [LDST 规格(SIP4.0 XPU 访存子系统)](ldst/ldst_spec.md) — reference-or-spec; `sha256:986f871e3b77d61aca9ad9abb0f4421b03e8e4142e20ca5230cf49c42dadc724`
- [LDST](ldst/meeting_ldst.md) — internal-report; `sha256:3534cb65777bf6cbcfa6e60d86c6af0a66825b7904e7eb97ca033204a84864f2`
- [gcu400-compute-ldst 原始资料索引](ldst/source_materials_index.md) — upstream-source-index; `sha256:f1636c7eb33cf978e7be8ca60d65e2f6ccd4771d608bdbf46a72a4d201aa69cb`

## assembly

Keywords: `isa4`, `vliw`, `csr`, `pipeline`, `codegen`.

- [GCU ISA 4.0 Assembly Reference](assembly/gcu_isa4_assembly_reference.md) — reference-or-spec; `sha256:9413f7e252d370b8b4d8fdf114735cfd1af6bef15f433781a857f1085632d372`
- [ISA4.0 CTRL 指令族(分支 / 跳转 / 同步 / 调度提示 / 缓存 invalidation)](assembly/isa4_ctrl_ref.md) — reference-or-spec; `sha256:e605dbed79fd011b3c2982cb60d5cf1e9969ad914b1a2aca0c7592477b9e0a07`
- [ISA4.0 VLIW Packet Format & Encoding](assembly/isa4_vliw_encoding.md) — derived-reference; `sha256:75aecb6e4d72293df88c74eb1e120eb54126b911536f572035eb9bf7a695a3e2`
- [Libra SIP CSR SPEC](assembly/libra_sip_csr_spec.md) — reference-or-spec; `sha256:1a9ba36ea2692dc3c2a1186784e0d1591589445100b4281b36e422fc23f4d27c`
- [Libra SIP ISA](assembly/libra_sip_isa.md) — derived-reference; `sha256:95815502e167ebcb2f3be2d7f6194def0b6a3bb5c2a5bcf76922c194be9077e2`
- [SIP4.0 Pipeline Info for Compiler](assembly/sip4_pipeline_info_for_compiler.md) — derived-reference; `sha256:c45c63781b4d2fea4ac95f71ad2758d4cd70bc47df632ce825d24c0ddfb2ce1f`
- [SIP4.0 流水线信息(Pipeline Info for Compiler)](assembly/sip4_pipeline.md) — derived-reference; `sha256:0093c3477f39fccf1b3446f8d95825b7dbcb7356aeacb087c71bfe9ac4329d4e`
- [gcu400-compute-assembly 原始资料索引](assembly/source_materials_index.md) — upstream-source-index; `sha256:e6f446af8466b487a1ee0fcddc8e896d2de798e4504328fc5dc94a21ed9e978d`
