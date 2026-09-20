---
name: gcu400-compute-scalar
description: GCU400 标量计算能力、双标量流水线、SDMEM bank 结构、栈限制、分支优化和标量相关 ISA 指令。用于写标量密集代码、优化分支结构、排查栈溢出或标量寄存器 spill 时。
---

# gcu400-compute-scalar

标量计算由 SALU / SLDST / CTRL 三类 slot 承载——SALU 负责 32-bit / 64-bit 标量算术与 mov、CMOV 等,SLDST 负责标量 load/store,CTRL 负责程序流程控制(branch / JL / JI / JAL);硬件配备两条独立标量流水线可并行执行 SALU 操作。标量数据存放在 SDMEM(8 bank × 512 bit),每 sub-thread 栈空间上限 10KB,超限后切换到 remote stack(UVA 映射)导致性能骤降。ISA4.0 新增 MADD(乘加)和 CMOV(条件移动)减少指令数和分支 penalty。

## 标量流水线

- 两条标量流水线,可并行执行独立 SALU 操作
- SALU / SLDST / CTRL 在 VLIW 包中与 MALU / VMOV / VLDST / MLI 等其他 slot 完全并行

利用双流水线的方法：将无数据依赖的标量运算交错排列，让编译器调度到两条流水线。

## SDMEM 的算子开发意义

SDMEM 访问延迟 8 cycle,远低于 L1 VDMEM 31 cycle 与 L3 300+ cycle——把热路径的标量数据、循环计数、小型查找表放在 SDMEM 比放 VDMEM / L3 显著省 latency。标量代码若把 SDMEM 地址交给向量访存路径,必须先满足该向量访问的对齐要求(V3 上向量访问 SDMEM 不 512B 对齐表现为静默 mismatch)。

## 栈空间限制

每 sub-thread 栈不超过 10KB——原因：超过后 runtime 切换到 remote stack（UVA 映射），每次栈访存 latency 从 8 cycle 变为 200~300 cycle，性能骤降且表现为性能异常而非功能错误。

诊断方法：
- 编译加 `-res-usage` 查看 `StackSize`
- `StackSize` 只是 global function 自身的栈，不含调用链叠加
- 实际栈 = boot code + global function + 所有 device 调用链深度叠加

减栈手段：
- 减少栈上大数组（改用 L1 VDMEM buffer）
- 精简调用链深度
- 避免深层递归或大型 struct 按值传递

## MADD（乘加指令）

标量乘加指令，一条指令完成 `a * b + c`：
- 减少标量指令数
- 减少中间结果的寄存器占用

编译器自动识别 `a * b + c` 模式生成 MADD；在汇编中确认生成了 MADD 而非拆成 SMUL + SADD。

## CMOV（条件移动指令）

消除短分支的条件跳转 penalty：

```cpp
// 编译器可将短 if-else 优化为 CMOV
int result = condition ? value_a : value_b;
```

优势：避免条件跳转的 penalty(取决于预测是否命中和 ICache 状态)。

适用场景：
- 两个分支都是简单赋值
- 分支体内无副作用（无 store / 无函数调用）

## INT64 除法

不支持硬件 INT64 除法——原因：ISA4.0 没有 64-bit 除法指令，编译器生成软件模拟序列，开销显著(BKM 表述"比较慢";INT32 版仅一条指令)。

规避方法：
- 能用移位替代时用移位（除以 2 的幂）
- 能用 INT32 时降宽度
- 无法避免时接受性能代价，不要在热循环中使用

## 分支优化

### 静态预测策略

ISA4.0 分支默认 **Always Taken**（静态预测）。优化原则：

- 用 LIKELY/UNLIKELY 让跳转方向与预测一致：

```cpp
#define LIKELY(x)   __builtin_expect(!!(x), 1)
#define UNLIKELY(x) __builtin_expect(!!(x), 0)

if (LIKELY(common_case)) {
    // 热路径 - 不跳转（fall-through 被预测为 taken 分支的目标）
} else {
    // 冷路径
}
```

### CMOV 替代短分支

对只做赋值的 if-else，用三元运算符引导编译器生成 CMOV：
- 消除分支 penalty
- 消除 ICache miss 风险

### 小循环展开禁止

禁止对极小标量循环做手动展开——原因：小循环体在 L0 ICache（2.5KB / 160 条指令）内保持热状态，展开后指令膨胀溢出 L0 ICache 反而增加 miss penalty。

让编译器自行决定是否展开；如果需要强制禁止展开：

```cpp
#pragma clang loop unroll(disable)
for (int i = 0; i < small_n; i++) {
    // 短标量循环体
}
```

## VL 在标量代码中的写入

标量代码通过 `tcle::set_vl(n)` 设置 VL,会影响后续**所有**向量指令直到下次 set_vl;在标量分支内修改 VL 后忘记复位,会让分支外的向量代码用错位宽。

```cpp
tcle::set_vl(n);
```

## 参考资料

- `document/isa4_sldst_ref.md` — SLDST 指令族(LD / LDX / LDRS / ST / TLD / TST / MOV / MOVS / MOVSR2SPR / AMO 等)的 ISA 字段与 dtype × dwidth 合法组合、MOVS.Barrier fence 类型表
