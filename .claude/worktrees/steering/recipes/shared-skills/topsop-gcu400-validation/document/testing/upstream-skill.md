---
name: gcu400-testing
description: GCU400 在 topsop 中的测试框架、CPU 参考对比、vLLM 端到端测试、sanitizer 工具链和系统化测试设计方法。用于新增测试、补回归 case、验证算子正确性、评估测试覆盖或排查设备占用问题时。
---

# gcu400-testing

topsop 的测试体系由四层组成：gtest 单元测试（kernel / API 粒度）、CPU reference 对比（数值正确性）、vLLM 端到端测试（业务级回归）和 sanitizer（内存 / DTE 异常捕获）。覆盖设计需要在每层组合目标 shape、边界 shape、dtype、optional tensor、dispatch 分支与非法输入，让 V3 特有的 SDMEM 静默 mismatch、L0P5 inv 一致性和已知 HW quirk 都进入回归路径。

## 测试框架

### 单元测试 (Google Test)

topsop 使用 gtest 框架。测试文件命名: `*_test.c` / `*_test.cpp` / `*_api_test.cpp`

### 目录结构

- `test/op_base/`：基础设施测试。
- `test/cpu_ops/`：CPU 参考实现；`test/cpu_ops/naive/` 放逐元素验证。
- `test/flame/`：TopsFlame 算子测试。
- `test/lm_cache/`：LM Cache 相关测试。
- `test/vision/`：视觉算子测试。

### 查找 testcase 名称

- GCU400：查 `topsop/test/unit/vdk_zebu_ctest.cmake` 与 `topsaten/test/unit/vdk_zebu_ctest.cmake`（`*_vdk` / `*_zebu` 均在此注册）；GCU300 对应为 `ctest.cmake`；共用定义在 `topsop/test/unit/CMakeLists.txt`（`topsaten` 侧同构）。
- 命名约定：`*_zebu` = 较大 shape，`*_vdk` = 较小 shape——与运行平台（asic/vdk/zebu/gcusim）无关。

### 编译与运行

```bash
# 在 topsop 同级 build dir 配置
cmake -S ../topsop -G Ninja --preset=opdev -B . -DBUILD_TEST=ON

# 构建单个测试目标；目标名以当前仓库 CMake 为准
ninja <test_target_name>

# 使用 ctest 运行
ctest -R <test_name>     # 按名称
ctest -N                 # 列出全部

# 直接运行 + gtest 过滤
./build/<test_binary> --gtest_filter="TestSuite.TestCase*"
```

测试命令以当前 checkout 的 preset、build dir 和 CI 入口为准；不要在 testing skill 中另立一套和 `gcu400-compute-flow` 冲突的 build 目录。

## 正确性验证方法

### 1. CPU Reference 对比

在 `test/cpu_ops/naive/` 中实现 CPU 版本，逐元素对比 GCU 输出：

```cpp
void cpu_reference(float* output, const float* input, int n) {
    for (int i = 0; i < n; i++) {
        output[i] = /* 计算逻辑 */;
    }
}

TEST(OpTest, Correctness) {
    auto input = createTensor(shape, dtype);
    auto output_gcu = createTensor(shape, dtype);
    auto output_cpu = createTensor(shape, dtype);

    op_function(output_gcu, input, ...);
    cpu_reference(output_cpu, input, ...);

    EXPECT_TRUE(allclose(output_gcu, output_cpu, atol, rtol));
}
```

### 精度容差参考

容差按算子的 CPU reference、现有测试约定和 dtype 累积路径确定。FP8 / 量化路径需单独说明量化格式、scale 语义和累积深度；不要把其他算子的阈值直接搬到当前算子。

### 2. vLLM 端到端测试

```python
import vllm_zx_utils.kernels._custom_ops as ops
import torch_zx
import torch

o = torch.load("o_gcu_0.pt").to('cuda:0')
q = torch.load("q_gcu_0.pt").to('cuda:0')
kv_cache = torch.load("kv_gcu_0.pt").to('cuda:0')
seq_lens = torch.load("seq_lens_tensor_gcu_0.pt").to('cuda:0')
block_tables = torch.load("block_tables_gcu_0.pt").to('cuda:0')
q_scale = torch.load("q_scale_gcu_0.pt").to('cuda:0')

ops.paged_attention_v1(o, q, kv_cache, ...)
```

### 3. Sanitizer 工具

#### 编译时开启

```bash
-DTOPS_ENABLE_DTE_CHECK -fgcu-sanitize=address -g -fno-omit-frame-pointer
```

#### 运行时

```bash
export GCU_ASAN=abort
export GCU_RSAN=abort
```

Sanitizer 能检测：

- DTE 配置非法
- 地址越界
- 内存对齐错误
- 部分竞态和生命周期错误

### 4. 性能指标采集

```bash
ophal profile --mode metrics --arch 400 --binary ./test_binary --metrics sip/busy,sip/1d_efficiency,sip/2d_efficiency
```

```bash
export OPLIB_LOG_MOD='TopsFlame_API,TopsFlame' && export OPLIB_LOGINFO_DBG=1
```

局部 cycle 统计：

```cpp
tops::clock64();
```

## 测试设计方法论

### 极端与边界用例设计

设计能暴露潜在问题的 case，不使用兜底策略掩盖问题：

- **上下界**：shape 维度为 0, 1, 最大值
- **对齐边界**：128B 对齐与非对齐、512B 边界
- **VL 边界**：VL=0、VL=1、VL=对应向量类型 datalane 上限（FP32 时 128、FP16 时 256）、VL=1023（硬件 10 bit 编码上限）
- **OACC 边界**：接近 768 上限的 sub-thread 分配
- **DTE 边界**：11 VC 上限、16 shared_dte 上限
- **Stack 边界**：接近 10KB 的调用链深度
- **Dtype 全覆盖**：FP32, FP16, BF16, FP8, INT8

### Host API 逻辑验证

- 全面分析 host API 的输入输出逻辑
- 验证返回值、错误码和路径分发
- 覆盖 optional tensor 的各种组合（nullptr vs non-null）
- 验证 dispatch 条件和 fallback 行为

### 覆盖度分析

分析维度：

1. **逻辑分支覆盖**：所有 dispatch 路径
2. **内存操作覆盖**:L1(Private / DSM 跨 SIP 视图) / L3 各层访问模式
3. **时序竞争覆盖**：单 SIP / 多 SIP、sync / async
4. **错误处理覆盖**：非法输入、超限参数

### V3 专项测试角度

针对 V3 特有风险的测试覆盖：

- **L0P5 一致性**：连续两个使用 GEMM 的算子，验证 l0p5_inv 正确性
- **SDMEM 对齐**：V3 静默 mismatch 不报错，必须主动测试
- **TVSTOA CVT HW Bug**：特定 VL + 地址对齐组合的写数据丢失
- **多 SIP 扩展**：从单 SIP 到 24 SIP 的正确性回归
- **FP8 精度**：FP8 量化/反量化的累积误差

### 业务专项测试

业务专项测试矩阵应绑定具体 Host API、线上 shape 和已有 benchmark。LLM / Attention 类算子需额外覆盖 cache layout、block table、sequence length、量化 scale 和稀疏路径；普通算子不要继承无关业务矩阵。

## 全覆盖补充计划

当覆盖率不足时的补齐流程：

### 建议新增的测试集合

按类别列出：

- **边界 case**：极值 shape、对齐边界、VL/OACC 边界
- **非法输入**：空指针、非法 dtype、维度为零
- **Optional 组合**：各 optional tensor 的有/无排列
- **Fused / fallback**：两条路径都有独立测试
- **Dtype 组合**：所有支持的输入/输出 dtype 交叉

### 补齐计划模板

- 预计新增用例数量
- 每类用例的目标
- 可能的执行成本
- 优先级排序

### 失败诊断要求

每个测试 case 的失败信息需包含：

- 失败原因（mismatch / crash / hang / timeout）
- 触发失败的输入 shape、dtype 和 meta
- max diff、first mismatch position
- 最终失败汇总格式

## 测试入口要求

新增或修改普通算子后至少覆盖：

- 正式 Host API 路径：`topsaten_*`、dispatch、wrapper 接线可达。
- CPU reference 对比：数学语义和 dtype 转换正确。
- dispatch / fallback 分支：fast path gate 和 fallback 语义正确。
- optional tensor 组合：`nullptr` 与 non-null 路径都正确。
- asan profile：涉及 DTE、地址、buffer 生命周期或概率性 mismatch 时复验。

涉及性能结论时必须采集 device-side 指标；具体 `topsprof` / `tcu` 命令按当前环境执行，避免复制环境相关参数。

### apitrace 输出

借助 apitrace 可以获取算子输入输出的 shape 与标量信息：

```bash
# 打印 log
export OPLIB_LOG_MOD='TopsFlame_API,TopsFlame' && export OPLIB_LOGINFO_DBG=1

# 关闭 log
unset OPLIB_LOG_MOD; unset OPLIB_LOGINFO_DBG
```

### 设备占用问题

测试启动阶段报 `device_connect` / context create 失败时，先换空闲设备或设置 `TOPS_VISIBLE_DEVICES`——原因：不要把设备占用误判成 kernel bug。看到同 seed 同参数偶发 mismatch、加 printf 后结果改变、地址相关 dmesg 或概率性 hang 时，优先补 sanitizer / DTE check 复验。

## 新测试接入流程

1. 在 `test/` 下创建测试文件
2. 实现 CPU reference（如果不存在）
3. 编写 gtest case，覆盖正常路径和边界
4. 添加到 CMake 构建目标 (`add_test`)
5. 编译: `ninja <test_target_name>`
6. 运行并验证通过
7. 如有 FP8/量化相关，额外验证精度容差

## 额外要求

- 不要只生成 happy path
- 对 optional tensor、dtype 和预算边界必须单独列出覆盖方案
- 性能测试优先贴近真实线上场景
