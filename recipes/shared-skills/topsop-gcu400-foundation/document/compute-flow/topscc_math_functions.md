# TCLE 数学函数与超越函数参考

本文档汇总 **TCLE（Tops C++ Language Extension）** 中与标量/向量数学相关的接口，供编写 GCU300 / GCU400 算子 kernel 时查阅。函数在源码中可能以全局内置形式出现，本文档统一写作 **`tcle::`** 命名空间风格以便检索。

---

## 类型缩写说明

| 缩写 | 含义 |
|------|------|
| **FP** | 所有浮点标量；以及浮点向量类型：`__vector` / `__vector2` / `__vector4` × `float` / `__fp16` / `__bf16` |
| **INT** | 所有整型标量；以及整型向量类型（含 GCU400 上的 `long long` / `unsigned long long` 等向量） |
| **BOOL** | `bool` 标量；以及各宽度 **mask / bool 向量**（如 `__vector bool char` … `__vector bool long long`） |
| **不支持** | 该架构不提供该重载或该指令 |

**注意**

- 向量除法优先使用 `tcle::div` 等形式（`+ - * / %` 均为受支持的向量运算符，但 64 位除法编译为函数调用，热路径避免直接使用）。
- 下文 **`*_accurate`** 系列为 **GCU400 专用** 的高精度路径；GCU300 **不提供** 这些重载。
- 个别接口在官方 PDF/HTML 中使用略有不同的拼写（如 `popc` / `brev` / `cls`），语义与下表 `tcle::popcount` / `tcle::bit_reverse` / `tcle::countl_sign` 对应时，以随编译器发布的 **topscc 文档** 为准。

---

# Part 1：超越函数（Transcendental Functions）

超越函数通常为逐元素 SIMD 指令封装，操作数与返回值类型一致（二元函数两操作数同型）。

### 类型总注

- **所有浮点向量类型** = `__vector` / `__vector2` / `__vector4` × `float` / `__fp16` / `__bf16`，并含同类型浮点**标量**。
- **所有整型向量类型** = 各宽度有符号/无符号整型向量（GCU400 含 `long long` 向量等）。

### 全表

| 函数名 | 简要说明 | GCU300 支持类型 | GCU400 支持类型 |
|--------|----------|-----------------|-----------------|
| `acos` | 反余弦 arccos(x) | FP | FP |
| `asin` | 反正弦 arcsin(x) | FP | FP |
| `atan` | 反正切 arctan(x) | FP | FP |
| `atan2` | 四象限反正切 atan2(y, x) | FP（二元） | FP（二元） |
| `ceil` | 向上取整 | FP | FP |
| `cos` | 余弦 | FP | FP |
| `cos_accurate` | 高精度余弦 | **不支持** | FP（仅高精度路径） |
| `cosh` | 双曲余弦 | FP | FP |
| `div` | 除法（替代 `/`） | FP / INT 向量 | FP / INT 向量 |
| `div_accurate` | 高精度除法 | **不支持** | FP（二元，高精度） |
| `exp` | e^x | FP（注：部分文档对 `exp` 的向量种类列举略窄，以编译器为准） | FP |
| `exp_accurate` | 高精度 e^x | **不支持** | FP |
| `expm1` | e^x−1 | FP | FP |
| `floor` | 向下取整 | FP | FP |
| `gelu` | GELU 激活 | FP | FP |
| `isfinite` | 是否有限值（逐元） | FP | FP |
| `ln` | 自然对数 ln(x) | FP | FP |
| `ln_accurate` | 高精度自然对数 | **不支持** | FP |
| `log1p` | ln(1+x) | FP | FP |
| `mod` | 取模（仅整型向量） | INT | INT |
| `power` | x^y | FP（二元） | FP（二元） |
| `power_accurate` | 高精度 x^y | **不支持** | FP（二元） |
| `rem` | 余数（仅整型向量） | INT | INT |
| `round` | 就近取整（舍入模式以 ISA 为准） | FP | FP |
| `sigmoid` | Sigmoid 激活 | FP | FP |
| `sign` | 浮点符号/符号相关信息（与 §2.20 位级 `sign` 区分） | FP（见 topscc：含标量/浮点向量） | FP；另支持更广向量种类（除 maskbit 外，见官方表） |
| `sin` | 正弦 | FP | FP |
| `sin_accurate` | 高精度正弦 | **不支持** | FP |
| `sinh` | 双曲正弦 | FP | FP |
| `softplus` | Softplus 激活 | FP | FP |
| `sqrt` | 平方根 | FP | FP |
| `tan` | 正切 | FP | FP |
| `tanh` | 双曲正切 | FP | FP |
| `rsqrt` | 平方根倒数 1/√x | FP | FP |
| `rcp_accurate` | 高精度倒数 1/x | **不支持** | FP |

---

# Part 2：数学函数（Mathematical / Bitwise Utilities）

以下为常用 **数学/位操作** API；均标注 **GCU300 / GCU400** 差异。

---

## 1. `tcle::abs`

**签名**

```cpp
T tcle::abs(T in);
```

**说明**  
逐元素绝对值。对无符号类型为恒等或按 ISA 定义；对浮点/有符号整型取非负。

**类型**

| | GCU300 | GCU400 |
|---|--------|--------|
| 标量 | 整型 / 浮点标量 | 同左 |
| 向量 | 除部分 mask 外的常用向量类型 | 同左，整型/浮点向量 |

**示例**

```cpp
__vector4 float a = ...;
__vector4 float b = tcle::abs(a);
```

---

## 2. `tcle::min`

**签名**

```cpp
T tcle::min(T a, T b);
```

**说明**  
逐元素最小值。若涉及 **NaN**，行为为 **NaN 传播**（与 `minnum` 不同）。

**类型**

| | GCU300 | GCU400 |
|---|--------|--------|
| 支持 | 标量；除 maskbit 外的向量 | 同左 |

**示例**

```cpp
__vector4 float c = tcle::min(a, b);
```

---

## 3. `tcle::minnum`（GCU400）

**签名**

```cpp
T tcle::minnum(T a, T b);
```

**说明**  
逐元素最小值；若一端为 NaN，**选取非 NaN**；双方均为 NaN 时结果为标准 NaN（与 `atomic_minnum` 语义同族）。

**类型**

| | GCU300 | GCU400 |
|---|--------|--------|
| | **不支持** | 所有标量/向量类型（浮点与整型） |

**示例**

```cpp
__vector float c = tcle::minnum(va, vb);
```

---

## 4. `tcle::max`

**签名**

```cpp
T tcle::max(T a, T b);
```

**说明**  
逐元素最大值，**NaN 传播**。

**类型**  
同 `min`。

**示例**

```cpp
__vector4 int c = tcle::max(ia, ib);
```

---

## 5. `tcle::maxnum`（GCU400）

**签名**

```cpp
T tcle::maxnum(T a, T b);
```

**说明**  
逐元素最大值；**优先非 NaN**（与 `max` 的 NaN 规则不同）。

**类型**  
同 `minnum`。

**示例**

```cpp
__vector float c = tcle::maxnum(va, vb);
```

---

## 6. `tcle::fuse`

**签名**

```cpp
VT tcle::fuse(VT a, VT b);
```

**说明**  
取 **a 的指数** 与 **b 的符号 + 尾数**（逐元），用于快速符号翻转、缩放等。

**类型**

| | GCU300 | GCU400 |
|---|--------|--------|
| VT | 浮点向量 | 浮点向量 |

**示例**

```cpp
__vector4 float r = tcle::fuse(sign_src, value_src);
```

---

## 7. `tcle::gete`

**签名**

```cpp
ET tcle::gete(VT num);
```

**说明**  
逐元提取浮点 **指数域**（零扩展为整数）。

**类型表（输出 ET）**

| VT（输入） | ET（输出，逐元） |
|------------|------------------|
| `__fp16` / `__vector`×`__fp16` / `__vector2` / `__vector4` | `unsigned short` 或同宽度无符号向量 |
| `__bf16` | 同上 |
| `float` / `__vector` / `__vector2` / `__vector4` | `unsigned int` 或同宽度无符号向量 |

| | GCU300 | GCU400 |
|---|--------|--------|
| | 支持上述浮点向量 | 支持上述浮点向量 |

**示例**

```cpp
__vector4 unsigned int e = tcle::gete(x);  // x: __vector4 float
```

---

## 8. `tcle::getm`

**签名**

```cpp
MT tcle::getm(VT num);
```

**说明**  
逐元提取浮点 **尾数域**（零扩展），**类型对应关系与 `gete` 相同**（上表把“指数”换为“尾数”语义）。

**类型**  
同 §7 表。

**示例**

```cpp
__vector4 unsigned int m = tcle::getm(x);
```

---

## 9. `tcle::isnan`

**签名**

```cpp
MT tcle::isnan(VT num);   // 常见：返回 bool mask 向量
bool tcle::isnan(float x); // 标量重载（若提供）
```

**说明**  
逐元判断是否为 NaN。

**类型**

| 输入 VT | 输出 MT |
|-----------|---------|
| 浮点向量 | 对应 `__vector bool *` |
| 浮点标量 | `bool` |

| | GCU300 | GCU400 |
|---|--------|--------|
| | 浮点向量 | 浮点向量 |

**示例**

```cpp
auto mask = tcle::isnan(vf);
```

---

## 10. `tcle::countl_zero`

**签名**

```cpp
unsigned tcle::countl_zero(unsigned scalar);           // 标量
VT tcle::countl_zero(VT num);                          // GCU400 向量无符号
```

**说明**  
前导零个数（leading zeros）。**GCU300 多为无符号标量**；**GCU400** 文档中对应向量版本常以 **`clz`** 名称出现，语义相同。

**类型**

| | GCU300 | GCU400 |
|---|--------|--------|
| | 无符号整型 **标量** | 无符号整型 **标量**；以及 `__vector unsigned {char,short,int,long long}` 等 |

**示例**

```cpp
unsigned z = tcle::countl_zero((unsigned)x);
```

---

## 11. `tcle::countl_sign`

**签名**

```cpp
VT tcle::countl_sign(VT num);
```

**说明**  
前导 **符号位** 个数（对负数补码即为 leading ones 计数的一种；与无符号 `countl_zero` 相对）。官方文档中 GCU400 常记为 **`cls`**。

**类型**

| | GCU300 | GCU400 |
|---|--------|--------|
| | 视工具链：多为标量或有限支持 | 有符号整型向量：`__vector char` … `__vector long long` |

**示例**

```cpp
__vector int c = tcle::countl_sign(v);
```

---

## 12. `tcle::vset_mb`

**签名**

```cpp
template <typename VBT>
VBT tcle::vset_mb(int limit);
```

**说明**  
由标量 `limit` 生成 **maskbit 向量**：索引小于 `limit` 的位置为 true，否则为 false（语义见 topscc）。

**类型**  
`VBT` 为任意 **maskbit / bool 向量** 类型。

| | GCU300 | GCU400 |
|---|--------|--------|
| | 支持 | 支持 |

**示例**

```cpp
auto mb = tcle::vset_mb<__vector4 bool int>(4);
```

---

## 13. `tcle::fpclassify`

**签名**

```cpp
UT tcle::fpclassify(VT num);
```

**说明**  
逐元返回浮点类别 **编码 0–9**（见下表）。

**编码表**

| 编码 | 含义 |
|------|------|
| 0 | 负无穷 |
| 1 | 负规格化数 |
| 2 | 负非规格化数 |
| 3 | −0 |
| 4 | +0 |
| 5 | 正非规格化数 |
| 6 | 正规格化数 |
| 7 | 正无穷 |
| 8 | signaling NaN |
| 9 | quiet NaN |

**类型**  
输出为与元素位宽匹配的无符号整数向量（如 `__vector2 float` → `__vector2 unsigned int`；`__vector2 __fp16` → `__vector2 unsigned short`）。

| | GCU300 | GCU400 |
|---|--------|--------|
| | 支持 | 支持 |

**示例**

```cpp
__vector2 unsigned int k = tcle::fpclassify(a);  // a: __vector2 float
```

---

## 14. `tcle::mid`

**签名**

```cpp
template <typename OT, int mode = 0>
OT tcle::mid(unsigned int start);
```

**说明**  
对选定向量（多为 **`__vector4` 无符号整型**）生成 **连续无符号序列**：元素 i 为 **`start + i`**（精确语义与 `mode` 以 topscc 为准）。

**类型**  
`VT` 为无符号整型向量，如 `__vector4 unsigned int`。

| | GCU300 | GCU400 |
|---|--------|--------|
| | 支持 | 支持 |

**示例**

```cpp
__vector4 unsigned int idx = tcle::mid<__vector4 unsigned int, 0>(base);
```

---

## 15. `tcle::mul_high`

**签名**

```cpp
VT tcle::mul_high(VT a, VT b);
```

**说明**  
两个 **32 位整数** 相乘得到 64 位积，**取高 32 位**。

**类型**

| VT | GCU300 | GCU400 |
|----|--------|--------|
| `__vector int` / `__vector unsigned int` | 支持 | 支持 |
| `__vector2 int` / `__vector2 unsigned int` | 支持 | 支持 |
| `__vector4 int` / `__vector4 unsigned int` | 支持 | 支持 |

**示例**

```cpp
__vector int hi = tcle::mul_high(a, b);
```

---

## 16. `tcle::cadd`

**签名**

```cpp
MT tcle::cadd(VT a, VT b);
```

**说明**  
逐元 **加法进位**（carry-out）：返回加法溢出/进位位（常用于宽整数运算）。

**类型**  
无符号整型向量为主；**以当前 topscc 发布说明为准**。

| | GCU300 | GCU400 |
|---|--------|--------|
| | 依工具链 | 依工具链 |

**示例**

```cpp
auto carry = tcle::cadd(a, b);  // 返回 bool 向量
```

---

## 17. `tcle::csub`

**签名**

```cpp
MT tcle::csub(VT a, VT b);
```

**说明**  
逐元 **减法借位**（borrow）。

**类型 / 架构**  
同 `cadd`。

**示例**

```cpp
auto borrow = tcle::csub(a, b);  // 返回 bool 向量
```

---

## 18. `tcle::cmul`

**签名**

```cpp
MT tcle::cmul(VT a, VT b);
```

**说明**  
逐元乘法 **进位/高位部分**（与 `mul_high` 等配合实现宽乘）。

**类型 / 架构**  
同 `cadd`。

**示例**

```cpp
auto ch = tcle::cmul(a, b);  // 返回 bool 向量
```

---

## 19. `tcle::csll`

**签名**

```cpp
MT tcle::csll(VT a, VT b);
```

**说明**  
逐元左移的 **进位/溢出位**。

**类型 / 架构**  
同 `cadd`。

**示例**

```cpp
auto c = tcle::csll(a, shift);
```

---

## 20. `tcle::sign`（位级，GCU400）

**签名**

```cpp
VT tcle::sign(VT in);
```

**说明**  
提取 **符号位**（与 Part 1 中浮点“符号函数”区分：此处为 **位运算/符号位提取** 语义，见 topscc）。

**类型**

| | GCU300 | GCU400 |
|---|--------|--------|
| | 主要为 FP 标量/向量 | 除 maskbit 外更广向量类型 |

**示例**

```cpp
__vector4 float s = tcle::sign(x);
```

---

## 21. `tcle::rotl`（GCU400）

**签名**

```cpp
VT tcle::rotl(VT in, VT shift);
VT tcle::rotl(VT in, int imm6);   // 立即数形式，若支持
```

**说明**  
逐元 **循环左移**；移位量可为向量或 **6 bit 立即数**。

**类型**  
`VT`：`__vector unsigned {char, short, int, long long}`。

| | GCU300 | GCU400 |
|---|--------|--------|
| | **不支持** | 支持 |

**示例**

```cpp
__vector unsigned int r = tcle::rotl(a, 3);
```

---

## 22. `tcle::rotr`（GCU400）

**签名**

```cpp
VT tcle::rotr(VT in, VT shift);
VT tcle::rotr(VT in, int imm6);
```

**说明**  
逐元 **循环右移**。

**类型**  
同 `rotl`。

| | GCU300 | GCU400 |
|---|--------|--------|
| | **不支持** | 支持 |

**示例**

```cpp
__vector unsigned int r = tcle::rotr(a, b);
```

---

## 23. `tcle::popcount`（GCU400）

**签名**

```cpp
IT tcle::popcount(VT in);           // 无符号整型向量 → 同形状计数向量
int tcle::popcount(MT in);          // bool 向量 → 标量个数（若重载存在）
```

**说明**  
逐元统计二进制中 **1 的个数**。官方文档常写作 **`popc`**；`bool` mask 上可能配合 **`popc_mb`** 等。

**类型（典型）**

| VT | 输出 |
|----|------|
| `__vector unsigned char` … `__vector unsigned long long` | 同宽度无符号计数向量 |

| | GCU300 | GCU400 |
|---|--------|--------|
| | **不支持** | 支持 |

**示例**

```cpp
__vector unsigned int c = tcle::popcount(v);
```

---

## 24. `tcle::bit_reverse`（GCU400）

**签名**

```cpp
VT tcle::bit_reverse(VT in);
```

**说明**  
逐元 **位反转**。官方文档常写作 **`brev`**。

**类型**  
无符号整型向量。

| | GCU300 | GCU400 |
|---|--------|--------|
| | **不支持** | 支持 |

**示例**

```cpp
__vector unsigned int r = tcle::bit_reverse(v);
```

---

## 25. `tcle::first_mb`（GCU400）

**签名**

```cpp
template <int vpt_mode>
int tcle::first_mb(MT in);

template <int vpt_mode>
int tcle::first_mb(MT in, MT cond);   // 条件首真（若编译器提供）
```

**说明**  
在 **bool / maskbit 向量** 中查找 **第一个 true 的索引**；无 true 则返回 −1。第二形式仅在 **cond** 为 true 的位置中查找（语义以工具链为准）。

**类型**  
`MT`：`__vector bool char` … `__vector bool long long`。

| | GCU300 | GCU400 |
|---|--------|--------|
| | **不支持** | 支持 |

**示例**

```cpp
int k = tcle::first_mb<0>(mask);
```

---

## 参考与延伸阅读

- 完整语言扩展见 `document/tops_cpp_programming_guide.md`「9. C++语言扩展」章节
- 精度与 ULP 见 `document/tops_cpp_programming_guide.md`「11. 数学函数」章节
