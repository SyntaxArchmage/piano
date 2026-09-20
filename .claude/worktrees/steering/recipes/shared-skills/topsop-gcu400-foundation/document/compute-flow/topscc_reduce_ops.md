# TCLE 向量内部元素运算（归约、移位等）

本文档说明 `tcle` 命名空间中面向**向量 lane 内部**的归约、移位、`miota` 以及 GCU400 基数排序相关 API。适用于在 Tops C++（topscc）内核中编写向量化逻辑。

---

## 1. `tcle::miota(MT mask) -> VT`

**架构**：仅 **GCU400**。

### 签名

```cpp
template <typename MT>
auto miota(MT mask) -> VT;  // VT 由 MT 决定，见下表
```

### 说明

对**布尔掩码向量**做“积分”（integral / prefix 计数风格）：将 `true` 视为 1、`false` 视为 0，按 lane 顺序累加，得到整数位置/偏移风格的向量。常用于根据 mask 生成紧凑索引或字节偏移（例如与 `sizeof` 相乘得到地址偏置）。

### 参数

| 参数 | 含义 |
|------|------|
| `mask` | 布尔掩码向量，元素为 `bool` 的向量类型（如 `__vector bool char`） |

### 类型对应表（示例）

掩码宽度与输出整数向量宽度配对：窄 bool 向量展开为更宽的 `int` 向量（`__vector4` / `__vector2` 等表示不同 lane 组织）。

| 掩码类型 `MT` | 结果类型 `VT` |
|---------------|---------------|
| `__vector bool char` | `__vector4 int` |
| `__vector bool short` | `__vector2 int` |
| `__vector bool int` | `__vector int` |
| 其它 `__vector bool *` | 按元素宽度类推为 `__vectorN int`（`N` 与 lane 展开一致） |

### 示例

```cpp
// GCU400：根据 expert mask 生成 int 偏移，再乘元素大小
__vector bool char vExpertMb = /* ... */;
auto offset_val = tcle::miota(vExpertMb) * sizeof(int32_t);
```

---

## 2. `tcle::shift_left(VT vin, unsigned int n)`

**架构**：仅 **GCU400**。

### 签名

```cpp
template <typename VT>
VT shift_left(VT vin, unsigned int n);
```

### 说明

将向量 **lane 内元素向更小下标方向平移**（左移语义：数据朝“前”/低索引流动）。`n` 为平移的步数。适用于非 bool 的所有标准向量元素类型。

### 参数

| 参数 | 含义 |
|------|------|
| `vin` | 输入向量 |
| `n` | 向左（向小下标）移动的 lane 数，非负 |

### 代表性类型支持

| 元素类型族 | 示例 `VT` |
|------------|-----------|
| 8bit 整数 | `__vector char`, `__vector uchar` |
| 16bit 整数 / 半精度 | `__vector short`, `__vector ushort`, `__vector _Float16`, `__vector bfloat` |
| 32bit | `__vector int`, `__vector uint`, `__vector float` |
| 宽向量 | `__vector2` / `__vector4` 与同元素类型组合（与 red 系列一致） |

> **注意**：不支持 `bool` 向量；与 `shift_right` 类型集相同。

### 示例

```cpp
__vector float v = /* ... */;
auto v2 = tcle::shift_left(v, 2u);  // 元素向 index 减小方向移动 2 个位置
```

---

## 3. `tcle::shift_right(VT vin, unsigned int n)`

**架构**：仅 **GCU400**。

### 签名

```cpp
template <typename VT>
VT shift_right(VT vin, unsigned int n);
```

### 说明

与 `shift_left` 对偶：**向更大下标方向平移**（右移语义）。类型支持与 `shift_left` 完全一致，同样**不含 bool**。

### 参数

| 参数 | 含义 |
|------|------|
| `vin` | 输入向量 |
| `n` | 向右（向大下标）移动的 lane 数 |

### 示例

```cpp
__vector int v = /* ... */;
auto v2 = tcle::shift_right(v, 1u);
```

---

## 4. `tcle::redmax<mode, stage>(VT in)`

**架构**：**GCU300 + GCU400**（`stage` 仅 GCU400 有意义）。

### 签名

```cpp
template <int mode, int stage = -1, typename VT>
auto redmax(VT in) -> /* 与 VT 同族的归约结果向量，见下 */;
```

> 模板参数顺序以当前 topscc 头文件为准（头文件为 `<int mode, int stage = -1>`；早期文档写作 VT 在前）。

### 说明

对向量 **lane 间**求**最大值**并按 `mode` 处理 NaN 与广播位，按 `stage` 选择归约粒度（GCU400）。

### 类型支持

- **支持**：`char` / `uchar` / `short` / `ushort` / `int` / `uint` / `fp16` / `bf16` / `float` 的 `__vector` / `__vector2` / `__vector4` 形式。
- **不支持**：`bool`（`long long` 视工具链：GCU400 头文件提供 `__vector long long` 重载，仅 `stage = -1 / 3` 有效，以当前工具链为准）。

### `mode`（NaN 与 bcast）

| mode | 含义 |
|------|------|
| 0 | 有 NaN 则结果 NaN；bcast 位 = 0 |
| 1 | 有 NaN 则结果 NaN；bcast 位 = 1 |
| 2 | 有 NaN 时选非 NaN；bcast 位 = 0 |
| 3 | 有 NaN 时选非 NaN；bcast 位 = 1 |

### `stage`（仅 GCU400）

| stage | 含义 |
|-------|------|
| -1 | 完全归约（默认） |
| 0 | 半宽步进 |
| 1 | 四分之一 |
| 2 | 八分之一 |
| 3 | 八分之一-内部阶段 |

### 完整类型表（`VT`）

| 元素 | `__vector` | `__vector2` | `__vector4` |
|------|------------|-------------|-------------|
| `char` | ✓ | ✓ | ✓ |
| `uchar` | ✓ | ✓ | ✓ |
| `short` | ✓ | ✓ | ✓ |
| `ushort` | ✓ | ✓ | ✓ |
| `int` | ✓ | ✓ | ✓ |
| `uint` | ✓ | ✓ | ✓ |
| `fp16` / `_Float16` | ✓ | ✓ | ✓ |
| `bf16` / `bfloat` | ✓ | ✓ | ✓ |
| `float` | ✓ | ✓ | ✓ |

### 示例

```cpp
__vector float fvalues = /* ... */;
auto vmax = tcle::redmax<0>(fvalues);           // GCU300：常用 mode 0
float lane_max = static_cast<float>(tcle::redmax<0>(fvalues)[0]);

// GCU400 需要分阶段时显式指定 stage
auto vhalf = tcle::redmax<0, 0>(fvalues);
```

---

## 5. `tcle::redmin<mode, stage>(VT in)`

**架构**：与 `redmax` 相同（**GCU300 + GCU400**）。

### 说明

对 lane 求**最小值**。`mode`、`stage` 含义及**类型表**与 `redmax` 完全一致；仅比较方向为 min。

### 示例

```cpp
float m = static_cast<float>(tcle::redmin<0>(vmin_vec)[0]);
```

---

## 6. `tcle::redsum<mode, stage>(VT in)`

**架构**：**GCU300 + GCU400**。

### 说明

对 lane 求**和**（算术加归约）。

### `mode`

| mode | 含义 |
|------|------|
| 0 | bcast 位 = 0 |
| 1 | bcast 位 = 1 |

### 类型支持

与 `redmax` / `redmin` 相同（**无** `long long`、`bool`）。

### 示例

```cpp
__vector float vexp = /* ... */;
auto vsum = tcle::redsum<1>(vexp);
int cnt = tcle::redsum<0>(tcle::vsel(mask, one_vec, zero_vec))[0];
```

---

## 7. `tcle::redmul<mode, stage>(VT in)`

**架构**：**GCU300 + GCU400**。

### 说明

对 lane 求**乘积**归约。`mode`（0/1，bcast0/bcast1）及类型支持与 `redsum` 相同。

### 示例

```cpp
auto prod = tcle::redmul<0>(v);
```

---

## 8. `tcle::redand<ST, VT>(VT in) -> ST`

**架构**：**GCU300 + GCU400**（以工具链文档为准）。

### 签名

```cpp
template <typename ST, typename VT>
ST redand(VT in);
```

### 说明

按位 **AND** 归约：将所有 lane 的元素逐位与在一起，结果为**标量** `ST`。

### 类型支持

- **无符号整数向量** → 对应宽度的**无符号标量**。
- **bool 向量** → 标量 `bool`。

### 类型对应表

| `VT` | `ST` |
|------|------|
| `__vector bool *` | `bool` |
| `__vector uchar` | `unsigned char`（或工具链约定的同宽度无符号标量） |
| `__vector ushort` | `unsigned short` |
| `__vector uint` | `unsigned int` |
| `__vector2` / `__vector4` 无符号整数 | 同理对应无符号标量 |

### 示例

```cpp
__vector uint vchk = /* ... */;
unsigned merged = tcle::redand<unsigned int>(vchk);
```

---

## 9. `tcle::redor<ST, VT>(VT in) -> ST`

### 说明

按位 **OR** 归约，返回标量。类型规则与 `redand` 相同（无符号整数向量 + bool 向量）。

### 示例

```cpp
int32_t flag = tcle::redor(v_check_flag);  // 工程中常见：将多 lane 标志 OR 成单值
```

---

## 10. `tcle::redxor<ST, VT>(VT in) -> ST`

### 说明

按位 **XOR** 归约，返回标量。

### 类型支持

- **仅无符号整数向量**（**不含** bool）。

### 示例

```cpp
unsigned r = tcle::redxor<unsigned int>(v);
```

---

## 11. 基数排序相关 API（GCU400）

以下 API 均针对 **`__vector unsigned int`**（及工具链允许的同族 `unsigned int` 向量别名，如通过 `stvector` 得到的 `DVType`），用于 **OACC / mradix** 硬件路径上的**按位桶计数、前缀和与分散写回**，实现 radix 排序或类似重排。

### 签名（示意）

```cpp
void mradix_w_base(__vector unsigned int v);   // 或 DVType 等 uint32 向量

template <typename VT = __vector unsigned int>
VT mradix_r_base();

void mradix_cntbase(__vector unsigned int v, unsigned shift);

__vector unsigned int mradix_offset(__vector unsigned int v, unsigned shift);

void mradix_stxoa(__vector unsigned int v, unsigned* dst_ptr, unsigned shift);
```

> 实际参数类型以当前 topscc 头文件为准；工程中亦可见与 `DVType` 一致的 `mradix_*` 重载。

| API | 作用简述 |
|-----|----------|
| `mradix_w_base` | 写入 / 重置 **base** 寄存器（基数或前缀和载入 OACC） |
| `mradix_r_base` | 从 **base** 读出向量结果 |
| `mradix_cntbase` | 按给定 `shift` 取 key 的若干位，在 OACC 中做 **桶计数** |
| `mradix_offset` | 根据当前 key 与 **base** 计算该元素的目标 **offset**（分散写入位置） |
| `mradix_stxoa` | 将元素按计算好的 offset **scatter** 回显存（store indexed / radix 重排） |

### 典型用法流程（简述）

1. 用 `mradix_w_base` 清零或写入初始 base。
2. `mradix_cntbase(v_input, SHIFT)`：对当前向量中的无符号 key 在选定 radix 位上计数。
3. `mradix_r_base<__vector unsigned int>()`：读出计数或前缀结构到向量。
4. 在 **SDMEM / 缓冲** 上做前缀和（示例中常用手写循环累加 `buffer_out`）。
5. 再次 `mradix_w_base` 把前缀和写回 base。
6. `mradix_stxoa(v_input, input, SHIFT)`：按新 base 与 key 将数据写回排序缓冲。

### 代码骨架（与仓库中 radix 步一致）

```cpp
auto v_input = tcle::load<__vector unsigned int>(input);
auto v_zero = (__vector unsigned int)(0);

tcle::mradix_w_base(v_zero);
tcle::mradix_cntbase(v_input, SHIFT);
auto v_base = tcle::mradix_r_base<__vector unsigned int>();
tcle::store(v_base, buffer_in);
// ... 前缀和到 buffer_out ...
tcle::mradix_w_base(tcle::load<__vector unsigned int>(buffer_out));
tcle::mradix_stxoa(v_input, input, SHIFT);
```

### `mradix_offset` 用法提示

在需**单独查询每个元素对应写回偏移**时，在已设置好 base 与计数上下文后，对向量调用 `mradix_offset(vsrc, shift)`，将结果写入 `offset[]` 等（见 embedding / compare 等内核中的多 `shift` 分支）。

---

## 通用说明

- **`tcle::set_vl`**：归约、读写向量前需保证 **VL** 与实际问题规模一致；部分示例在归约前将 VL 设为 `TCLE_MAX_VECTOR_LENGTH`（**GCU300 不支持 `set_vl`**）。
- **GCU300 vs GCU400**：`miota`、`shift_*`、基数排序 API 仅 GCU400；`redmax`/`redmin`/`redsum`/`redmul` 及按位归约两类架构均常见，但 **`stage` 模板参数仅 GCU400 使用**。
- 具体类型别名（如 `bfloat`、`fp16`）以当前 topscc 头文件与 `--target` 为准。
