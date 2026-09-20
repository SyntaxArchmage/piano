# TCLE 原子操作（Atomic Operations）

> **适用范围**：以下 API 均为 **GCU400 专用**，且仅作用于 **全局内存（global memory）** 上的原子操作。使用前需确保 `addr` 指向设备全局可寻址、对齐合法的位置。

命名空间：`tcle::`

---

## 一、标量原子操作（读-改-写，返回旧值）

所有标量 API 形式均为：对 `addr` 所指位置执行原子操作，**返回操作前的旧值**。

### 1. `atomic_add`

| 项目 | 说明 |
|------|------|
| **签名** | `template <typename T> T atomic_add(void* addr, T arg);` |
| **语义** | 原子执行 `*addr = *addr + arg`，返回加法前的 `*addr`。 |
| **支持类型 `T`** | `short`, `ushort`, `int`, `uint`, `long long`, `unsigned long long`, `__fp16`, `__bf16`, `float` |

**类型组合表**

| T |
|---|
| `short` |
| `ushort` |
| `int` |
| `uint` |
| `long long` |
| `unsigned long long` |
| `__fp16` |
| `__bf16` |
| `float` |

```cpp
// 示例：对全局 float 做原子加
extern __device__ float g_sum;
float old = tcle::atomic_add(reinterpret_cast<void*>(&g_sum), 1.0f);
```

---

### 2. `atomic_and`

| 项目 | 说明 |
|------|------|
| **签名** | `template <typename T> T atomic_and(void* addr, T arg);` |
| **语义** | 原子执行 `*addr = *addr & arg`，返回按位与前的旧值。 |
| **支持类型 `T`** | `int`, `uint`, `long long`, `unsigned long long` |

**类型组合表**

| T |
|---|
| `int` |
| `uint` |
| `long long` |
| `unsigned long long` |

```cpp
uint* p = /* 全局 uint 地址 */;
uint prev = tcle::atomic_and(reinterpret_cast<void*>(p), 0xFFu);
```

---

### 3. `atomic_or`

| 项目 | 说明 |
|------|------|
| **签名** | `template <typename T> T atomic_or(void* addr, T arg);` |
| **语义** | 原子执行 `*addr = *addr \| arg`，返回按位或前的旧值。 |
| **支持类型 `T`** | 同 `atomic_and` |

**类型组合表**：与 `atomic_and` 相同（`int`, `uint`, `long long`, `unsigned long long`）。

```cpp
unsigned long long* q = /* ... */;
unsigned long long old = tcle::atomic_or(reinterpret_cast<void*>(q), 1ull << 40);
```

---

### 4. `atomic_xor`

| 项目 | 说明 |
|------|------|
| **签名** | `template <typename T> T atomic_xor(void* addr, T arg);` |
| **语义** | 原子执行 `*addr = *addr ^ arg`，返回按位异或前的旧值。 |
| **支持类型 `T`** | 同 `atomic_and` |

**类型组合表**：与 `atomic_and` 相同。

```cpp
int* flag = /* ... */;
int v = tcle::atomic_xor(reinterpret_cast<void*>(flag), 0x12345678);
```

---

### 5. `atomic_max`

| 项目 | 说明 |
|------|------|
| **签名** | `template <typename T> T atomic_max(void* addr, T arg);` |
| **语义** | 原子将 `*addr` 更新为 `max(旧值, arg)`（浮点按 IEEE 比较规则）；**若涉及 NaN，结果为标准 NaN（canonical NaN）语义**。 |
| **支持类型 `T`** | `int`, `uint`, `long long`, `unsigned long long`, `__fp16`, `__bf16`, `float` |

**类型组合表**

| T |
|---|
| `int` |
| `uint` |
| `long long` |
| `unsigned long long` |
| `__fp16` |
| `__bf16` |
| `float` |

```cpp
float* m = /* 全局 float */;
float before = tcle::atomic_max(reinterpret_cast<void*>(m), 3.14f);
```

---

### 6. `atomic_maxnum`

| 项目 | 说明 |
|------|------|
| **签名** | `template <typename T> T atomic_maxnum(void* addr, T arg);` |
| **语义** | 原子取“较大值”；与 `atomic_max` 的区别：**NaN 时选择非 NaN 一侧**（类似 `fmaxnum` 风格）。 |
| **支持类型 `T`** | 同 `atomic_max` |

**类型组合表**：与 `atomic_max` 相同。

```cpp
__fp16* h = /* ... */;
__fp16 old = tcle::atomic_maxnum(reinterpret_cast<void*>(h), (__fp16)1.0f);
```

---

### 7. `atomic_min`

| 项目 | 说明 |
|------|------|
| **签名** | `template <typename T> T atomic_min(void* addr, T arg);` |
| **语义** | 原子将 `*addr` 更新为 `min(旧值, arg)`。 |
| **支持类型 `T`** | `int`, `uint`, `long long`, `unsigned long long`（**不含浮点**） |

**类型组合表**

| T |
|---|
| `int` |
| `uint` |
| `long long` |
| `unsigned long long` |

```cpp
unsigned long long* cnt = /* ... */;
unsigned long long prev = tcle::atomic_min(reinterpret_cast<void*>(cnt), 100ull);
```

---

### 8. `atomic_minnum`

| 项目 | 说明 |
|------|------|
| **签名** | `template <typename T> T atomic_minnum(void* addr, T arg);` |
| **语义** | 原子取较小值；为 `atomic_maxnum` 在整数域上的对偶语义（仅支持整数类型，无浮点 NaN 问题）。 |
| **支持类型 `T`** | 同 `atomic_min` |

**类型组合表**：与 `atomic_min` 相同。

```cpp
int* slot = /* ... */;
int old = tcle::atomic_minnum(reinterpret_cast<void*>(slot), 42);
```

---

### 9. `atomic_inc`

| 项目 | 说明 |
|------|------|
| **签名** | `template <typename T> T atomic_inc(void* addr, T arg);` |
| **语义** | 读旧值 `old`：若 `old >= arg`，则写入 `0`；否则写入 `old + 1`。返回**写入前的旧值**。 |
| **支持类型 `T`** | `ushort`, `uint`, `unsigned long long` |

**类型组合表**

| T |
|---|
| `ushort` |
| `uint` |
| `unsigned long long` |

```cpp
uint* ring = /* 环形计数器基址 */;
uint prev = tcle::atomic_inc(reinterpret_cast<void*>(ring), 1023u);
```

---

### 10. `atomic_dec`

| 项目 | 说明 |
|------|------|
| **签名** | `template <typename T> T atomic_dec(void* addr, T arg);` |
| **语义** | 读旧值 `old`：若 `old >= arg`，则写入 `0`；否则写入 `old - 1`。返回**写入前的旧值**。 |
| **支持类型 `T`** | `uint`, `unsigned long long`（**无 `ushort`**） |

**类型组合表**

| T |
|---|
| `uint` |
| `unsigned long long` |

```cpp
unsigned long long* idx = /* ... */;
unsigned long long v = tcle::atomic_dec(reinterpret_cast<void*>(idx), 16ull);
```

---

### 11. `atomic_exch`

| 项目 | 说明 |
|------|------|
| **签名** | `template <typename T> T atomic_exch(void* addr, T arg);` |
| **语义** | 原子交换：将 `*addr` 设为 `arg`，返回**原来的** `*addr`。 |
| **支持类型 `T`** | `short`, `ushort`, `int`, `uint`, `long long`, `unsigned long long`, `__fp16`, `float`（**不含 `__bf16`**） |

**类型组合表**

| T |
|---|
| `short` |
| `ushort` |
| `int` |
| `uint` |
| `long long` |
| `unsigned long long` |
| `__fp16` |
| `float` |

```cpp
int* ticket = /* ... */;
int was = tcle::atomic_exch(reinterpret_cast<void*>(ticket), 1);
```

---

### 12. `atomic_cas`（Compare-And-Swap）

| 项目 | 说明 |
|------|------|
| **签名** | `template <typename T> T atomic_cas(void* addr, T compare_arg, T exch_arg);` |
| **语义** | 若 `*addr == compare_arg`，则将 `*addr` 置为 `exch_arg`；否则不修改。返回**操作前的旧值** `*addr`。 |
| **支持类型 `T`** | `int`, `uint`, `long long`, `unsigned long long` |

**类型组合表**

| T |
|---|
| `int` |
| `uint` |
| `long long` |
| `unsigned long long` |

```cpp
uint* lock = /* ... */;
uint seen = tcle::atomic_cas(reinterpret_cast<void*>(lock), 0u, 1u);
// seen 为 CAS 前旧值；若 seen==0 则已成功将锁从 0 改为 1
```

---

## 二、无返回值版本（Void）

以下 API **不返回旧值**，仅执行与对应标量原子操作相同的内存更新语义，适用于不需要旧值的场景（可能减少寄存器压力）。

| API | 对应有返回值版本 | 说明 |
|-----|------------------|------|
| `v_atomic_add(void* addr, T arg)` | `atomic_add` | 原子加 |
| `v_atomic_and(void* addr, T arg)` | `atomic_and` | 原子按位与 |
| `v_atomic_or(void* addr, T arg)` | `atomic_or` | 原子按位或 |
| `v_atomic_xor(void* addr, T arg)` | `atomic_xor` | 原子按位异或 |
| `v_atomic_max(void* addr, T arg)` | `atomic_max` | 原子 max（NaN → 标准 NaN） |
| `v_atomic_maxnum(void* addr, T arg)` | `atomic_maxnum` | 原子 maxnum（NaN → 非 NaN） |
| `v_atomic_min(void* addr, T arg)` | `atomic_min` | 原子 min |
| `v_atomic_minnum(void* addr, T arg)` | `atomic_minnum` | 原子 minnum |
| `v_atomic_inc(void* addr, T arg)` | `atomic_inc` | 原子 inc（阈值逻辑同前） |
| `v_atomic_dec(void* addr, T arg)` | `atomic_dec` | 原子 dec（阈值逻辑同前） |

各 `v_atomic_*` 的 **模板参数 `T` 与上表中有返回值版本完全一致**，此处不重复罗列类型表。

```cpp
// 仅需累加，不关心旧值
tcle::v_atomic_add(reinterpret_cast<void*>(&g_sum), 1.0f);
```

---

## 三、向量原子操作（连续内存）

向量版本对 **一段连续的全局内存** 执行原子操作，元素类型为向量 `VT`。可选形参 **`cond`（掩码向量 `MT`）** 用于按元素选择是否执行该次原子更新（具体语义以实现为准：通常为 per-lane 条件执行）。

**共同约定**

- `addr`：指向全局内存中连续区域的起始地址。
- `VT`：向量元素类型见下表。
- `MT`：与 `VT`  lane 数一致的 **bool 向量**，用于 `... (void* addr, VT arg, MT cond)` 重载。

### 13. `v_atomic_vadd` / `v_atomic_vmax`（带条件）

| 项目 | 说明 |
|------|------|
| **签名** | `void v_atomic_vadd(void* addr, VT arg);`<br>`void v_atomic_vadd(void* addr, VT arg, MT cond);` |
| **语义** | 对连续内存中的向量数据做原子加法（逐元素或按向量宽度定义）；带 `cond` 时仅对满足掩码的 lane 生效。 |

**VT / MT 类型组合表**

| VT | MT（条件向量，bool） |
|----|----------------------|
| `__vector int` | 与 `VT` 同 lane 数的 bool 向量 |
| `__vector uint` | 同上 |
| `__vector __fp16` | 同上 |
| `__vector __bf16` | 同上 |
| `__vector float` | 同上 |

```cpp
__vector float vf = /* ... */;
__vector bool vm = /* 掩码 */;
tcle::v_atomic_vadd(reinterpret_cast<void*>(global_ptr), vf);
tcle::v_atomic_vadd(reinterpret_cast<void*>(global_ptr), vf, vm);
```

---

### 14. `v_atomic_vmax` / 带条件

| 项目 | 说明 |
|------|------|
| **签名** | `void v_atomic_vmax(void* addr, VT arg);`<br>`void v_atomic_vmax(void* addr, VT arg, MT cond);` |
| **语义** | 向量原子 max，语义与标量 `atomic_max` 对应（含 NaN 规则与标量一致）。 |

**VT / MT 类型组合表**：与 `v_atomic_vadd` 完全相同。

```cpp
tcle::v_atomic_vmax(reinterpret_cast<void*>(p), vmax_vec);
tcle::v_atomic_vmax(reinterpret_cast<void*>(p), vmax_vec, cond);
```

---

### 15. `v_atomic_vmaxnum` / 带条件

| 项目 | 说明 |
|------|------|
| **签名** | `void v_atomic_vmaxnum(void* addr, VT arg);`<br>`void v_atomic_vmaxnum(void* addr, VT arg, MT cond);` |
| **语义** | 向量原子 maxnum（NaN 取非 NaN），与标量 `atomic_maxnum` 对应。 |

**VT / MT 类型组合表**：与 `v_atomic_vadd` 完全相同。

```cpp
tcle::v_atomic_vmaxnum(reinterpret_cast<void*>(p), vnum);
tcle::v_atomic_vmaxnum(reinterpret_cast<void*>(p), vnum, cond);
```

---

## 四、小结

| 类别 | 要点 |
|------|------|
| 架构 | 仅 **GCU400** |
| 内存 | 仅 **全局内存** |
| 标量 | 读-改-写并返回旧值；`atomic_inc`/`atomic_dec` 的阈值与加减规则见各节 |
| Void | `v_atomic_*` 与对应标量语义一致，无返回值 |
| 向量 | `v_atomic_vadd` / `v_atomic_vmax` / `v_atomic_vmaxnum` 支持 `VT` 与可选 `MT`，类型组合见第三节总表 |

编写 kernel 时请将 `void*` 显式转换为实际全局指针所对应的地址；并保证多线程访问同一 `addr` 时对齐与数据竞争语义符合设备要求。
