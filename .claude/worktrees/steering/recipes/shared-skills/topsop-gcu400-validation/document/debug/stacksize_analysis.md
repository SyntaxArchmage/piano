# Stack Size Analysis on Libra

## Problem Statement

SDP operator performance can be significantly affected by stack size. Excessive stack size increases cycle count substantially (observed: stack optimization reducing cycles from 183w to 156w).

## Factors Contributing to Large Stack Size

### 1. Local Array Variables Blocking Register Optimization

When loop iteration count or array index is a variable, the compiler cannot optimize the array into registers. The array spills to stack.

**Fix**: Change loop count to a compile-time constant:

```cpp
// BAD: variable loop bound prevents optimization
for (int32_t u = 0; u < true_N_per; u++) {
    vdst[u] = tcle::cvt<dst_vt>(vacc[u]);
}

// GOOD: constant loop bound allows register allocation
constexpr int N_per = 8;  // compile-time constant
for (int32_t u = 0; u < N_per; u++) {
    vdst[u] = tcle::cvt<dst_vt>(vacc[u]);
}
```

Also use `alignas(512)` for local arrays to avoid extra alignment padding waste:
```cpp
alignas(512) float s_max[kQBlkSize];
alignas(512) float s_sum[kQBlkSize];
```

### 2. OACC Variable Lifetime Crossing Function Calls

`int64_t` locals with function calls (which become hardware instructions) cause cross-lifetime spills to stack.

**Fix**: Minimize live range of `int64_t` variables across function boundaries. Restructure code to compute and consume values without intervening calls.

### 3. DTE Variable Usage Blocking Struct-to-Register Optimization

Some DTE usage patterns prevent the compiler from optimizing struct fields into registers.

**Note**: DTE optimization features are being integrated into topsop. Current primo++ programming with data flow does not fully support this optimization.

### 4. Register Spill from Exceeding Register Count Limits

Each subthread has a limited number of scalar registers (GRegs = 32 per subthread). When operators use more live scalar variables than available registers, spill occurs.

**Fix**: Reduce simultaneously live variables through code restructuring, or reduce the number of local variables in hot paths.

### 5. Incorrect User Code Patterns Causing GReg Spill

Requesting arrays with size that requires `alignas(512)` but only needs 256 bytes causes extra 512 bytes of stack alignment waste.

```cpp
// Example: size is only 256 bytes but alignas(512) wastes stack
alignas(512) float s_max[kQBlkSize];  // if kQBlkSize * 4 < 512, alignment padding wastes stack
```

### 6. Reuse of Same Operator with Different cfunc Scenarios

When using `forceinline` across multiple cfunc calls (e.g., window op, pooling op), all cfuncs expand into the same kernel, causing variable count to exceed limits and spill to stack.

**Fix**: For multi-scene scenarios, use template parameters. Dynamically select different cfuncs at runtime, isolating each cfunc's logic to reduce per-kernel stack usage.

## Determining Current Resource Usage

### Using `-res-usage` Flag

Add `-res-usage` to the topscc command. After compilation, it outputs per-global-function resource statistics:

```
Function: _Z33gcu_flash_attention_kernel_gcu400IDhLi128EEvPT_PfS1_S1_S1_25ATTENTION_OP_PARAS_GCU400
    OaccCount: 175       Function中Oacc寄存器使用数量
    StackSize: 17920     Function的StackSize, 单位Byte
    SizeForSpill: 11088  Spill slot占用的Size, 单位Byte
    SizeForVariables: 5936  栈上其他类型的size和: 局部变量、参数传递大小等, 单位Byte
    OACCSpillCount: 0    OACC寄存器 spill指令数量
    VMSpillCount: 4      MaskBit寄存器 spill指令数量
    GRegSpillCount: 1064 标量寄存器spill指令数量
```

Key fields:
- **StackSize**: total stack usage in bytes (primary metric)
- **SizeForSpill**: bytes consumed by register spill slots
- **SizeForVariables**: bytes for local variables, parameters, etc.
- **GRegSpillCount**: number of scalar register spill instructions (indicates register pressure)
- **OACCSpillCount**: OACC register spills
- **VMSpillCount**: MaskBit register spills

## Analysis Method

1. Compile with `-res-usage` to get baseline numbers
2. Identify largest contributors (SizeForSpill vs SizeForVariables)
3. If GRegSpillCount is high: reduce live scalar variables, restructure code
4. If SizeForVariables is high: check for unnecessary local arrays, alignment waste
5. Apply fixes incrementally and re-measure with `-res-usage`
6. Target: stacksize should fit within the boot-code-allocated stack region without triggering remote stack access

## Remote Stack Triggers

When stack size exceeds the locally allocated stack region, the runtime falls back to remote stack access via L3/HBM, which has dramatically higher latency. This is the primary reason stack size directly impacts cycle count. Keep stack size minimal to avoid remote stack access entirely.
