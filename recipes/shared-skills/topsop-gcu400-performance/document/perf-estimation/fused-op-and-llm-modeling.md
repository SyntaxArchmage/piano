# 融合算子 / LLM 整网 / MoE 性能建模

主 SKILL.md 给出单算子建模与诊断流程；本 reference 覆盖融合算子（MLA Dense / Sparse、GQA）、LLM 整网 Decode 延迟分解、W4A8 量化影响、MoE PD 分离评估与 Leading/Tail 明细拆分方法。

## 通用融合算子评估框架

```python
def fused_op_perf(compute_items, io_items, efficiency_factors,
                  leading_us, tail_us, sip_num=24, sip_freq_ghz=1.6):
    cycle_per_us = sip_num * sip_freq_ghz * 1000
    total_cycles = sum(ops / ops_per_cycle for _, ops, ops_per_cycle in compute_items)
    raw_time = total_cycles / cycle_per_us
    total_eff = 1.0
    for e in efficiency_factors:
        total_eff *= e
    calc_time = raw_time / total_eff
    bandwidth_time = sum(b / bw * 1e6 for _, b, bw in io_items)
    return max(calc_time, bandwidth_time) + leading_us + tail_us
```

## 融合算子评估关键决策点

1. **哪些计算互斥？** SFU 与 GEMM 互斥（占用 2D 执行单元），应累加到 2D 时间中
2. **哪些计算可并行？** 1D（非 SFU）与 2D 可并行，用 `efficiency_parallel` 折扣
3. **Leading 明细拆分**：kernel launch + DTE init + 首 tile 搬运等待
4. **Tail 明细拆分**：负载不均衡 + merge/reduce + 写回
5. **数据量考虑 MLA 特性**：KV cache 所有 head 共享（不乘 head_num）
6. **Sparse vs Dense**：稀疏注意力改变等效 kv_len 和 L3 带宽模式

## 效率参数体系

效率参数必须来自当前 kernel 或同类 kernel 的 profiling，不在 skill 中固定拍值：

- `efficiency_2d`：2D 计算单元利用率。
- `efficiency_parallel`：1D 与 2D 并行执行效率。
- `efficiency_query`：小 query 下 GEMM M 维利用率。
- `total_eff`：上述参数相乘，用于把理论纯计算时间折算成当前实现的计算时间。

## MLA Dense 融合算子评估

总体模型：`all_time = max(calc_time, bandwidth_time) + leading + tail`

计算项：

- QK matmul: `batch * seq_len_q * head_num * qk_head_dim * kv_len / fp8_mac_2d`
- PV matmul: `batch * seq_len_q * head_num * kv_len * v_head_dim / fp8_mac_2d`
- SFU (online-softmax): `batch * seq_len_q * head_num * kv_len / fp32_sfu_2d`
- REDSUM: `batch * seq_len_q * head_num * kv_block_num`

带宽项：

- KV cache: `batch * kv_len * qk_head_dim * 1` (FP8, MLA 共享)
- Query: `batch * seq_len_q * head_num * qk_head_dim * 2` (FP16)

MLA Dense 是否计算 bound 取决于目标 `kv_len`、head 配置、online-softmax 实现和 L3 访问模式；用上面的计算项与带宽项比较，不写固定结论。

## MLA Sparse 融合算子评估

与 Dense 的关键差异：

- Dense 访问更接近连续结构化搬运。
- Sparse 会改变等效 `kv_len` 和 L3 访问局部性。
- Leading / tail 要按当前实现拆分，不复用旧 case 数字。
- Sparse 是否带宽 bound 由有效 `kv_len`、随机访问比例和 tcu 实测 L3 档位共同决定。

## GQA 评估核心公式

```python
calc_time = time_2d / (efficiency_2d * efficiency_parallel * efficiency_M(M_eff))
kv_bytes = batch * kv_len * num_kv_heads * head_dim * kv_bpe * 2  # K+V, GQA 共享
bandwidth_time = (kv_bytes + q_bytes + o_bytes) / l3_bw_paged * 1e6
all_time = max(calc_time, bandwidth_time) + leading + tail
```

GQA decode 常见瓶颈是 KV cache 带宽，但不能跳过计算项。FP8 / BF16 的理论差异先按数据量和 MAC 模型估算，再用目标模型实测校准 dequant 与 pipeline 开销。

## LLM 整网性能评估

### DeepSeek V3/R1 单层 Decode 延迟分解

```
1. RMSNorm (1D) → 通常被 2D 掩盖
2. MLA Attention (融合算子)
3. RMSNorm (1D)
4. MoE FFN: Router → Expert matmul × (top_k + shared) → All-to-All
5. 残差连接 (1D)
```

### 关键度量

- **Token 生成速率**: `tokens_per_second = batch / total_decode_time`
- **算力利用率 (MFU)**: `actual_flops / peak_flops`
- **带宽利用率 (MBU)**: `actual_bandwidth / peak_bandwidth`

### W4A8 量化影响

- 显存节省按权重元素数、bitwidth 和副本数重新计算。
- 带宽收益只在 Decode 确认 memory-bound 时成立；dequant、scale 读取和额外 1D 计算要进入模型。
- QPM 需要整网实测，不从单算子带宽收益直接外推。

## MoE PD 分离评估

### DP+SP+TP+EP 四维并行

```
SP = TP
EP = DP x TP
推理组卡数 = EP
Decode: batch 维度等价 seq 维度, SP 按 batch 切分
```

### Prefill TTFT (ChunkedPrefill + M/D/1 排队)

```python
S = avg_input / chunk_size * chunk_step_time + kv_transfer
rho = sys_rps / p_rps
TTFT = S * (2 - rho) / (2 * (1 - rho))
```

## Leading/Tail 明细拆分方法

不要拍笼统数字，逐项拆分：

- Leading：kernel launch / SIP skew、DTE 初始化、负载均衡计算、首 tile DTE 搬运等待。
- Tail：负载不均衡、merge / reduce、输出写回。
- 每项都用当前 profiling 或屏蔽实验填值；没有数据时只写"未测"，不要沿用历史 case。
