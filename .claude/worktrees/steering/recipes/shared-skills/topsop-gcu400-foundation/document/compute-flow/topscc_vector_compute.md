# TCLE 向量计算 API 参考

本文档整理 Tops C++（topscc）中 **TCLE（Tensor Core Logic Engine）** 向量类型、`tcle::` 命名空间下的访存与类型转换 API，以及编译器可融合的向量运算模式。架构以 **GCU300** 与 **GCU400** 为主。

---

## 1. 向量类型 `__vector` / `__vector2` / `__vector4` 与尺寸

### 1.1 向量寄存器宽度（总 bit / 总字节）

`__vector` 对应**一个**标准向量寄存器宽度；`__vector2` 为两个；`__vector4` 为四个。

| 关键字 | GCU300 | GCU400 |
|--------|--------|--------|
| `__vector` | 1024 bit（128 B） | 4096 bit（512 B） |
| `__vector2` | 2048 bit（256 B） | 8192 bit（1024 B） |
| `__vector4` | 4096 bit（512 B） | 16384 bit（2048 B） |

### 1.2 与「vector4 中 32bit 元素个数」相关的硬件常量（文档常用表述）

| 架构 | 典型含义（文档表述） |
|------|----------------------|
| GCU300 | `vector4` 中含 **128** 个 32bit 元素（4096 bit / 32） |
| GCU400 | `vector4` 中含 **512** 个 32bit 元素；或 `__vector` 中含 **512** 个 8bit 元素（即单向量字节数 512） |

### 1.3 元素个数示例

**GCU300：**

```cpp
__device__ void foo_gcu300() {
  __vector char a;     // 128 个 char（128 B）
  __vector2 short b;   // 128 个 short（256 B）
  __vector4 int c;     // 128 个 int（512 B）
}
```

**GCU400：**

```cpp
__device__ void foo_gcu400() {
  __vector char a;          // 512 个 char（512 B）
  __vector2 short b;        // 512 个 short（1024 B）
  __vector4 int c;          // 512 个 int（2048 B）
  __vector long long d;     // 64 个 long long（512 B），仅 GCU400 起
}
```

### 1.4 可搭配向量的标量基础类型

可与 `__vector` / `__vector2` / `__vector4` 组合的标量类型包括：`char`、`unsigned char`、`short`、`unsigned short`、`int`、`unsigned int`、`long long`、`unsigned long long`（`long long` 系仅 **GCU400+**）、`__fp16`、`__bf16`、`float`。  
**FP8（`f8_e4m3` / `f8_e5m2`）** 可作为向量元素类型出现在 **GCU400** 等场景中，但 **8 位浮点主要在 `tcle::cvt` 等 API 中使用**，并非与所有运算符通用。

### 1.5 使用建议（寄存器宽度）

| 架构 | 建议 |
|------|------|
| GCU400 | 基础向量为 **512 B**，优先使用 `__vector` |
| GCU300 | 基础寄存器块常按 **4× 标准向量（512 B）** 组织，优先使用 `__vector4` |

### 1.6 宏 `TCLE_SINGLE_VEC_BYTES`

| 宏 | GCU300 | GCU400 |
|----|--------|--------|
| `TCLE_SINGLE_VEC_BYTES` | 128 | 512 |

用于按「单标准向量字节数」推导元素个数（配合 `altivector` 等）。

---

## 2. Bool 向量类型与数据向量对应关系

### 2.1 语法

由 `__vector bool` / `__vector2 bool` / `__vector4 bool` 与标量 `char`、`short`、`int`、`long long`（`long long` 仅 **GCU400+**）组合。**`bool` 向量的「标量位置类型」决定与何种数据向量配对。**

### 2.2 各 `bool` 关键字宽度下的有效 bool 个数

| 关键字 | GCU300 | GCU400 |
|--------|--------|--------|
| `__vector bool char` | 128 | 512 |
| `__vector2 bool char` | 256 | 1024 |
| `__vector4 bool char` | 512 | 2048 |
| `__vector bool short` | 64 | 256 |
| `__vector2 bool short` | 128 | 512 |
| `__vector4 bool short` | 256 | 1024 |
| `__vector bool int` | 32 | 128 |
| `__vector2 bool int` | 64 | 256 |
| `__vector4 bool int` | 128 | 512 |
| `__vector bool long long` | N/A | 64 |
| `__vector2 bool long long` | N/A | 128 |
| `__vector4 bool long long` | N/A | 256 |

### 2.3 数据向量 VT → 掩码向量 VBT（节选）

| 数据向量类型 VT | 对应 bool 向量 VBT | GCU300 | GCU400 |
|-----------------|-------------------|--------|--------|
| `__vector char` / `unsigned char` | `__vector bool char` | ✓ | ✓ |
| `__vector short` / `unsigned short` / `__fp16` / `__bf16` | `__vector bool short` | ✓ | ✓ |
| `__vector int` / `unsigned int` / `float` | `__vector bool int` | ✓ | ✓ |
| `__vector long long` / `unsigned long long` | `__vector bool long long` | — | ✓ |
| `__vector f8_e4m3` / `f8_e5m2` | `__vector bool char` | — | ✓ |
| `__vector2` / `__vector4` 类推（元素类型规则同上） | 同结构 `bool` | 依元素类型 | 依元素类型 |

完整对齐与配对表见《Tops C++ Programming Guide》向量章节；**GCU300 上访问未对齐向量结果未定义，GCU400 上未对齐仍可能正确但性能非最优**，定义时推荐使用 `__valigned__`（GCU300：128B；GCU400：512B）。

---

## 3. 向量初始化：广播与初始化列表

### 3.1 说明

- **广播**：单标量转为同型向量，所有元素相同。  
- **初始化列表**：按索引依次写入，**不足部分补零**。

### 3.2 广播示例

```cpp
__device__ void demo_broadcast() {
  __vector int vi1 = (__vector int)(1);
  __vector int vi2 = (__vector int)1;
  int a = 3;
  __vector int vi3 = (__vector int)(a);

  __vector bool int vb1 = (__vector bool int)(true);
  __vector bool short vb2 = (__vector bool short)(1);
  __vector bool short vb3 = (__vector bool short)(0);
}
```

### 3.3 初始化列表示例

```cpp
__device__ void demo_list() {
  __vector int vi2 = {1};
  __vector int vi4 = {1, 2};
  __vector bool int vb = (__vector bool int){true, false, true};

  unsigned int a = 2, b = 1;
  __vector unsigned int v1 = (__vector unsigned int){1, a, 10, b};

  bool c = true;
  __vector bool int v2 = (__vector bool int){true, c, false};
}
```

`vector bool` 可用 `true`/`false` 或 `0`/`1`；**不可用其它整数做逐位插值**（否则可能编译错误）。

---

## 4. 辅助模板：`altivector`、`simple_altivector`、`vec_step`、`altivector_to_scalar`、`altivector_to_mask`

### 4.1 `tcle::altivector<T, elem_num>::VT`

**含义**：由元素类型 `T` 与元素个数 `elem_num` 确定向量类型，需满足  
`elem_num * sizeof(T) = 单段向量总字节数 × vector 倍数`（与目标 `__vector`/`__vector2`/`__vector4` 一致）。

**签名（概念）**：

```cpp
namespace tcle {
template <typename T, int elem_num>
struct altivector {
  using VT = /* 由 T、elem_num 与架构推导的 __vector* T */;
};
}
```

**示例**：

```cpp
__device__ void demo_altivector() {
  tcle::altivector<char, TCLE_SINGLE_VEC_BYTES>::VT a;
  tcle::altivector<short, TCLE_SINGLE_VEC_BYTES / sizeof(short)>::VT b;
  tcle::altivector<__fp16, TCLE_SINGLE_VEC_BYTES * 2 / sizeof(__fp16)>::VT c;
  tcle::altivector<long long, TCLE_SINGLE_VEC_BYTES * 4 / sizeof(long long)>::VT d;
}
```

| 项目 | GCU300 | GCU400 |
|------|--------|--------|
| 典型用途 | 按 128B 基向量拼出 `__vector`/`__vector2`/`__vector4` | 按 512B 基向量拼出对应类型 |
| `long long` 向量 | 依编译与架构支持 | 常见可用 |

### 4.2 `tcle::simple_altivector<T>::VT`

**含义**：按架构选择「推荐单向量宽度」的向量类型——**GCU400 上一般为 `__vector T`，GCU300 兼容模式下一般为 `__vector4 T`**。

```cpp
__device__ void demo_simple() {
  tcle::simple_altivector<char>::VT a;
  tcle::simple_altivector<int>::VT b;
}
```

| 架构 | 典型映射 |
|------|----------|
| GCU400 | `__vector T` |
| GCU300（及兼容） | `__vector4 T` |

### 4.3 `vec_step`

**含义**：一元运算符，返回向量**元素个数**（等价于 `sizeof(向量) / sizeof(元素类型)`）。

```cpp
__device__ void demo_vec_step(__vector float v1, __vector2 short v2) {
  int cnt1 = vec_step(v1);
  int cnt2 = vec_step(v2);
}
```

| 操作数 | 结果 | GCU300 | GCU400 |
|--------|------|--------|--------|
| 任意非 bool 数据向量 | 元素个数 | ✓ | ✓ |

### 4.4 `tcle::altivector_to_scalar<T>::type`

**含义**：从数据向量类型 `T` 提取**元素标量类型**。

```cpp
using ST1 = tcle::altivector_to_scalar<tcle::altivector<char, TCLE_SINGLE_VEC_BYTES>::VT>::type;
// ST1 为 char
```

### 4.5 `tcle::altivector_to_mask<T>::type`

**含义**：从数据向量类型 `T` 推导**对应的 bool 掩码向量类型**。

```cpp
using MT1 = tcle::altivector_to_mask<tcle::altivector<char, TCLE_SINGLE_VEC_BYTES>::VT>::type;
// MT1 为 __vector bool char
```

---

## 5. 运算符支持

以下均针对**非 bool 数据向量**（bool 向量仅逻辑/位运算部分适用），**bool 向量不可用于 `*`、`/`、`%` 等**。

| 类别 | 运算符 | 说明 |
|------|--------|------|
| 算术 | `+` `-` `*` `/` `%` `++` `--` | 逐元素；整型溢出截断，不饱和 |
| 比较 | `==` `!=` `<` `>` `<=` `>=` | 结果为对应 **bool 向量** |
| 逻辑 | `&&` `\|\|` `!` | 仅 **bool 向量** |
| 位运算 | `&` `\|` `^` `~` `<<` `>>` | 整型与 bool 向量 |
| 赋值 | `=` `+=` `-=` `*=` `/=` `%=` `<<=` `>>=` `&=` `\|=` `^=` | 与算术/位规则一致 |
| 其它 | `sizeof`、取址 `&`、解引用 `*`、`[]` 下标 | 见语言扩展章节；**不支持向量 `?:` 三元运算符** |

**类型组合**：要求参与运算的向量**宽度一致**、元素类型符合 C/C++ 常规提升规则；**不同宽度向量之间不能隐式转换**。

```cpp
__vector4 float add_demo(__vector4 float x, __vector4 float y) {
  return x + y;
}

__vector bool int cmp_demo(__vector int a, __vector int b) {
  return a > b;
}
```

---

## 6. `tcle::load()` / `tcle::store()`（带掩码）

### 6.1 `tcle::load`

**签名**：

```cpp
namespace tcle {
template <typename VT, typename MT>
VT load(void *addr, VT other, MT mask);
}
```

**说明**：掩码为真时从 `addr` 读对应元素；否则取 `other` 中对应元素。  
**不支持** `VT` 为 bool 向量类型。

| 项目 | GCU300 | GCU400 |
|------|--------|--------|
| 掩码加载 | ✓ | ✓ |

```cpp
__device__ __vector __fp16 load_demo(
    void *addr, __vector __fp16 other, __vector bool short mask) {
  return tcle::load(addr, other, mask);
}
```

### 6.2 `tcle::store`

**签名**：

```cpp
namespace tcle {
template <typename VT, typename MT>
void store(VT src, void *addr, MT mask);
}
```

**说明**：掩码为真处写入 `src`；为假处**内存保持不变**（非读改写整向量）。  
**不支持** `VT` 为 bool 向量类型。

| 项目 | GCU300 | GCU400 |
|------|--------|--------|
| 掩码存储 | ✓ | ✓ |

```cpp
__device__ void store_demo(
    __vector __fp16 src, char *addr, __vector bool short mask) {
  tcle::store(src, addr, mask);
}
```

> **注**：无掩码的整块加载/存储常通过指针解引用或工程内 `tcle::load<VT>(addr)` 等封装完成，以所用 topscc 版本文档为准。

---

## 7. `tcle::vsel()` 条件选择

**签名**：

```cpp
namespace tcle {
template <typename MT, typename VT>
VT vsel(MT cond, VT vec1, VT vec2);
}
```

**说明**：`cond` 为真取下标来自 `vec1`，否则取 `vec2`。支持**各类向量类型**（含 bool 向量作为被选结果）。  
Tops C++ 一般不直接提供「带掩码的运算符」，而是 **表达式 + `vsel`** 由编译器合成条件向量指令。

| 项目 | GCU300 | GCU400 |
|------|--------|--------|
| `vsel` | ✓ | ✓ |

```cpp
__device__ __vector __fp16 vsel_demo(
    __vector char a, __vector char b, __vector char c, __vector char d,
    __vector __fp16 x, __vector __fp16 y) {
  return tcle::vsel((a > b) && (c <= d), x + y, x - y);
}

__device__ __vector bool char vsel_bool_demo(
    __vector bool char cond, __vector char v1, __vector char v2) {
  return tcle::vsel(cond, v1 > v2, v1 == v2);
}
```

---

## 8. `tcle::cvt()` 显式值转换（含 MODE 与 FP8）

### 8.1 签名

语言扩展文档中常见两种写法（**以所用 topscc 版本头文件/手册为准**；`FROM` 通常由实参推导）：

```cpp
namespace tcle {
// 写法 A：显式 MODE，第二模板实参为 MODE（如 FP8 场景）
template <typename TO, int MODE = cvt_default_mode<TO>::get(), typename FROM>
TO cvt(FROM in);

// 写法 B：FROM 出现在模板参数列表中
template <typename TO, typename FROM, int MODE = cvt_default_mode<TO>::get()>
TO cvt(FROM in);
}
```

**说明**：**按数值语义**转换，bit 模式可变；输入输出**元素个数必须一致**。  
不可用 C 风格 `(__vector float)x` 或 `static_cast` 替代。

**默认 MODE**（由 `cvt_default_mode<TO>::get()`）：  
- 目标为**整数**：默认 **`RND_ZERO`**（向零舍入）  
- 目标为**浮点**：默认 **`RND_EVEN`**（就近偶数舍入）

### 8.2 MODE 标志（可组合）

| MODE | 含义 | GCU300 | GCU400 |
|------|------|--------|--------|
| `RND_EVEN` | 就近舍入（偶数） | 浮点目标常用默认 | ✓ |
| `RND_ZERO` | 向零舍入 | 可显式指定 | 整型目标常用默认 |
| `RND_PINF` | 向 +∞ 舍入 | — | 浮点→整型 |
| `RND_NINF` | 向 −∞ 舍入 | — | 浮点→整型 |
| `CLAMP` | 饱和/范围限制（见下） | ✓ | ✓ |
| `VM_SEL0` … `VM_SEL3` | 与条件写回/子掩码选择相关（3.0 场景多） | 见官方说明 | 部分场景 |

**CLAMP 要点**（结果类型为 **int8（非 uint8）**、**FP16**、**BF16**、**FP8_E4M3**、**FP8_E5M2** 等时有效）：  
- int8：`clamp` 决定负数饱和到 **-127** 还是 **-128**  
- BF16/FP16：非 Inf 超范围时可钳到**有限最大/最小**而非 ±Inf  
- FP8：非 Inf 超范围时可钳到**有限极值**而非 NaN（E5M2 类似 BF16 描述）

### 8.3 FP8（GCU400）

向量元素用 **`__vector char`** 配合模式 **`F8E4M3` / `F8E5M2`** 表示 FP8 存储格式（非通用算术类型）。

```cpp
// __vector2 __fp16 -> __vector char（按 FP8 E4M3 语义打包；第二模板实参为 MODE）
__device__ __vector char to_f8e4m3(__vector2 __fp16 a) {
  return tcle::cvt<__vector char, F8E4M3>(a);
}

// __vector2 __fp16 -> __vector char（FP8 E5M2）
__device__ __vector char to_f8e5m2(__vector2 __fp16 a) {
  return tcle::cvt<__vector char, F8E5M2>(a);
}
```

### 8.4 类型组合（cvt）

| 规则 | GCU300 | GCU400 |
|------|--------|--------|
| 任意两**非 bool**向量类型，**元素个数相同** | ✓ | ✓ |
| 含 `long long` / FP8 等 | 依版本 | 更全 |

```cpp
__device__ void cvt_demo(__vector4 float a) {
  __vector char vc = tcle::cvt<__vector char>(a);
  __vector2 __fp16 vh = tcle::cvt<__vector2 __fp16, CLAMP | RND_ZERO>(a);
  __vector4 bool int vm = tcle::cvt<__vector4 bool int>(a);
}
```

---

## 9. `tcle::bit_cast()` 位级重解释

**签名**：

```cpp
namespace tcle {
template <typename TO, typename FROM>
TO bit_cast(FROM from);
}
```

**说明**：**总 bit 数不变**，仅重解释各元素位型；**非数值转换**（例如 int 的 bit 模式当 float 解释）。

| 约束 | GCU300 | GCU400 |
|------|--------|--------|
| `sizeof(TO) == sizeof(FROM)`，且一般为非 bool 向量间 | ✓ | ✓ |

```cpp
__device__ __vector __fp16 bitcast_demo(__vector int a) {
  return tcle::bit_cast<__vector __fp16>(a);
}
```

需要**数值相等**的语义转换时用 **`tcle::cvt`**，不要用 `bit_cast`。

---

## 10. `tcle::extract()` / `tcle::concat()` 子向量

### 10.1 `tcle::extract`

**签名**：

```cpp
namespace tcle {
template <typename SUBT, int sub_idx, typename VT>
SUBT extract(VT in);
}
```

**说明**：从 `VT` 中取第 `sub_idx` 段 **`SUBT` 子向量**（元素类型一致）。  
- `__vector4` → `__vector`：索引 **0～3**  
- `__vector4` → `__vector2`：索引 **0～1**  
- `__vector2` → `__vector`：索引 **0～1**

| 项目 | GCU300 | GCU400 |
|------|--------|--------|
| `extract` | ✓ | ✓ |

```cpp
__device__ __vector int extract_demo(__vector4 int a, __vector int b) {
  return tcle::extract<__vector int, 1>(a) + b;
}
```

### 10.2 `tcle::concat`

**签名**：

```cpp
namespace tcle {
template <typename VT, typename SUBT>
VT concat(SUBT a, SUBT b);

template <typename VT, typename SUBT>
VT concat(SUBT a, SUBT b, SUBT c, SUBT d);
}
```

**说明**：将多个较短向量拼成较长向量；**第一个参数 `a` 位于最低位**，依次向高位为 `b, c, d`（文档表述：拼接结果从高位到低位依次为 `d, c, b, a` 的位序关系，与硬件拼接约定一致）。

| 项目 | GCU300 | GCU400 |
|------|--------|--------|
| 二参 / 四参 `concat` | ✓ | ✓ |

```cpp
__device__ __vector4 char concat4(__vector char a, __vector char b,
                                  __vector char c, __vector char d, __vector4 char e) {
  return tcle::concat<__vector4 char>(a, b, c, d) + e;
}

__device__ __vector2 char concat2(__vector char a, __vector char b, __vector2 char e) {
  return tcle::concat<__vector2 char>(a, b) + e;
}
```

---

## 11. `tcle::leaptr` 与 `tcle::simple_leaptr`

### 11.1 类模板概览

```cpp
namespace tcle {
template <typename VT, int stride_num = 1>
class leaptr {
 public:
  leaptr(void *addr, int stride);
  leaptr(void *t0_addr, int t0_stride, void *t1_addr, int t1_stride);
  leaptr(void *addr, int loadstore_stride, int vpt_stride);

  template <int stride_idx = 0> void set_stride(int stride_val);
  template <int stride_idx = 0> void set_stride(int t0_stride, int t1_stride);

  void set_address(void *addr);
  void set_address(void *t0_addr, void *t1_addr);

  template <int stride_idx = 0> VT load();
  template <int stride_idx = 0> VT load(const VT &other, MT mask);  // GCU400：条件读

  template <int stride_idx = 0> void store(const VT &data);
  template <int stride_idx = 0> void store(const VT &data, MT mask);  // GCU400：条件写

  template <int vpt = 0> void *get_address();  // GCU400

  template <typename TD, int stride_idx = 0> TD load_cvt();  // 仅 GCU300 表见下

  template <typename TS, int stride_idx = 0, int mode = cvt_default_mode<VT>::get()>
  void cvt_store(TS &v);

  template <typename TS, int stride_idx = 0, int __p3 = cvt_default_mode<VT>::get()>
  void trunc_store(TS &v);  // 仅 GCU300
};
}
```

### 11.2 `load` / `store` / 掩码（`leaptr` 成员）

| 成员 | 说明 | GCU300 | GCU400 |
|------|------|--------|--------|
| `load()` | 读 `VT` 并按 stride 更新基址 | ✓ | ✓ |
| `load(other, mask)` | 条件读 | — | ✓ |
| `store(data)` | 写后更新基址 | ✓ | ✓ |
| `store(data, mask)` | 条件写 | — | ✓ |
| `get_address()` | 调试取当前 vpt 地址 | — | ✓ |

### 11.3 `load_cvt`（仅 GCU300 支持该成员；GCU400 文档标注不支持）

| VT | TD |
|----|-----|
| `__vector __fp16` | `__vector2 float` |
| `__vector __bf16` | `__vector2 float` |
| `__vector char` | `__vector4 int` |
| `__vector unsigned char` | `__vector4 int` |

### 11.4 `cvt_store` 类型组合

**GCU300：**

| VT | TS |
|----|-----|
| `__vector __fp16` | `__vector2 float` |
| `__vector __bf16` | `__vector2 float` |
| `__vector char` | `__vector4 int` |
| `__vector unsigned char` | `__vector4 int` |

**GCU400（节选）：**

| VT | TS |
|----|-----|
| `__vector __fp16` / `__vector __bf16` | `__vector float` |
| `<__vector char, F8E4M3>` / `<__vector char, F8E5M2>` | `__vector float` |
| `__vector char` / `__vector unsigned char` | `__vector int` |
| `<__vector char, F8E4M3>` / `<__vector char, F8E5M2>` | `__vector __fp16` / `__vector __bf16` |

`mode` 可含 `RND_EVEN`、`RND_ZERO`、`CLAMP`、`TAR_RELU` 等（详见官方 leaptr 小节）。

### 11.5 `trunc_store`（仅 GCU300）

| TS | VT | 说明 |
|----|-----|------|
| `__vector4 int` | `__vector unsigned char` | 每元素低 8 bit |
| `__vector2 int` | `__vector unsigned short` | 每元素低 16 bit |
| `__vector int` | `__vector int` | 原 32 bit |

GCU400：**不支持** `trunc_store`（文档）。

### 11.6 `tcle::simple_leaptr`

**含义**：`simple_leaptr<VT>(p)` 等价于 `leaptr<VT>(p, sizeof(VT))`，stride 默认等于向量字节数。

```cpp
void leaptr_add_demo(char *lhs, char *rhs, char *dst) {
  using vtype = __vector char;
  auto lhsp = tcle::simple_leaptr<vtype>(lhs);
  auto rhsp = tcle::simple_leaptr<vtype>(rhs);
  auto dstp = tcle::simple_leaptr<vtype>(dst);
  dstp.store(lhsp.load() + rhsp.load());
}
```

---

## 12. 硬件加速：融合布尔运算

下列 **bool 向量**表达式可被融合为单类指令（**GCU300 / GCU400 均支持**）：

| 形式 | 说明 |
|------|------|
| `(x & ~y)` | 与 + 非 |
| `(x \| ~y)` | 或 + 非 |
| `~(x & y)` | 与非 |
| `~(x \| y)` | 或非 |
| `~(x ^ y)` | 同或非 |
| `(x & !y)`、`(x \| !y)` | 与/或 + 逻辑非 |
| `!(x & y)`、`!(x \| y)`、`!(x ^ y)` | 德摩根形式 |

```cpp
__vector bool int z = (x & ~y);
```

---

## 13. 融合 MAC / MAS / IMAS（同精度乘加族）

以下形式由编译器合成 **MAC（a\*b+c）**、**MAS（c−a\*b）**、**IMAS（a\*b−c）** 指令（**GCU300 / GCU400** 均支持表中组合）。

### 13.1 MAC：`a * b + c`

| 返回类型 | a | b | c |
|----------|---|---|---|
| `__vector4 int` | `__vector unsigned char` | `__vector unsigned char` | `__vector4 int` |
| `__vector4 int` | `__vector char` | `__vector char` | `__vector4 int` |
| `__vector2 float` | `__vector __fp16` | `__vector __fp16` | `__vector2 float` |
| `__vector2 float` | `__vector __bf16` | `__vector __bf16` | `__vector2 float` |
| `__vector float` | `__vector float` | `__vector float` | `__vector float` |
| `__vector4 float` | `__vector2 __fp16` | `__vector2 __fp16` | `__vector4 float` |
| `__vector4 float` | `__vector2 __bf16` | `__vector2 __bf16` | `__vector4 float` |
| `__vector2 float` | `__vector2 float` | `__vector2 float` | `__vector2 float` |
| `__vector4 float` | `__vector4 float` | `__vector4 float` | `__vector4 float` |

### 13.2 MAS：`c - a * b`

（类型组合与上表 **完全相同**。）

### 13.3 IMAS：`a * b - c`

（类型组合与上表 **完全相同**。）

```cpp
__vector4 float mac_demo(__vector4 float a, __vector4 float b, __vector4 float c) {
  return a * b + c;
}
```

---

## 14. 类型转换与运算的融合 + 混合精度 MAC / MAS / IMAS

### 14.1 转换与加减乘的融合

编译器可将 **显式宽化/提升 + 运算** 融合；原则：**整数与浮点相乘结果为浮点；低精度与高精度相乘结果为高精度**。

**示例**：

```cpp
__vector float fuse_demo(__vector unsigned int u, __vector float f) {
  __vector float vres = (__vector float)u + f;
  vres = (__vector float)u * vres;
  return vres;
}
```

**可融合类型组合（节选；列为「结果类型、左操作数、右操作数」）**：

| 结果类型 | 左操作数 | 右操作数 | GCU300 | GCU400 |
|----------|----------|----------|--------|--------|
| `__vector float` | `__vector int` | `__vector float` | ✓ | ✓ |
| `__vector float` | `__vector unsigned int` | `__vector float` | ✓ | ✓ |
| `__vector2 float` | `__vector __fp16` | `__vector2 float` | ✓ | ✓ |
| `__vector2 float` | `__vector2 int` | `__vector2 float` | ✓ | ✓ |
| `__vector2 float` | `__vector2 unsigned int` | `__vector2 float` | ✓ | ✓ |
| `__vector2 __fp16` | `__vector char` | `__vector2 __fp16` | ✓ | ✓ |
| `__vector2 __fp16` | `__vector unsigned char` | `__vector2 __fp16` | ✓ | ✓ |
| `__vector4 float` | `__vector2 __fp16` | `__vector4 float` | ✓ | ✓ |
| `__vector4 float` | `__vector char` | `__vector4 float` | ✓ | ✓ |
| `__vector4 float` | `__vector4 int` | `__vector4 float` | ✓ | ✓ |
| `__vector4 float` | `__vector unsigned char` | `__vector4 float` | ✓ | ✓ |
| `__vector4 float` | `__vector4 unsigned int` | `__vector4 float` | ✓ | ✓ |
| `__vector4 __fp16` | `__vector2 char` | `__vector4 __fp16` | ✓ | ✓ |
| `__vector4 __fp16` | `__vector2 unsigned char` | `__vector4 __fp16` | ✓ | ✓ |
| `__vector4 int` | `__vector unsigned char` | `__vector4 int` | ✓ | ✓ |
| `__vector4 int` | `__vector char` | `__vector4 int` | ✓ | ✓ |
| `__vector2 __bf16` | `__vector char` | `__vector2 __bf16` | — | ✓ |
| `__vector2 __bf16` | `__vector unsigned char` | `__vector2 __bf16` | — | ✓ |
| `__vector4 __bf16` | `__vector2 char` | `__vector4 __bf16` | — | ✓ |
| `__vector4 __bf16` | `__vector2 unsigned char` | `__vector4 __bf16` | — | ✓ |

左值与右值满足加法交换律时可对调。

### 14.2 混合精度 MAC / MAS / IMAS

记返回值为 **R**，乘加形式 **`a * b + c`**（以及等价重排 **`-a*b+c`、`c-a*b`、`a*b-c`、`-c+a*b`** 等，见官方「混精运算支持的写法」表）。

| R（返回/累加） | a（左） | b（右） | c（累加） | GCU300 | GCU400 |
|----------------|---------|---------|-----------|--------|--------|
| `__vector4 float` | `__vector unsigned char` | `__vector4 float` | `__vector4 float` | ✓ | ✓ |
| `__vector4 float` | `__vector char` | `__vector4 float` | `__vector4 float` | ✓ | ✓ |
| `__vector2 float` | `__vector __fp16` | `__vector2 float` | `__vector2 float` | ✓ | ✓ |
| `__vector4 float` | `__vector2 __fp16` | `__vector4 float` | `__vector4 float` | ✓ | ✓ |
| `__vector2 __fp16` | `__vector unsigned char` | `__vector2 __fp16` | `__vector2 __fp16` | ✓ | ✓ |
| `__vector2 __fp16` | `__vector char` | `__vector2 __fp16` | `__vector2 __fp16` | ✓ | ✓ |
| `__vector4 __fp16` | `__vector2 unsigned char` | `__vector4 __fp16` | `__vector4 __fp16` | ✓ | ✓ |
| `__vector4 __fp16` | `__vector2 char` | `__vector4 __fp16` | `__vector4 __fp16` | ✓ | ✓ |
| `__vector2 __bf16` | `__vector unsigned char` | `__vector2 __bf16` | `__vector2 __bf16` | — | ✓ |
| `__vector2 __bf16` | `__vector char` | `__vector2 __bf16` | `__vector2 __bf16` | — | ✓ |
| `__vector4 __bf16` | `__vector2 unsigned char` | `__vector4 __bf16` | `__vector4 __bf16` | — | ✓ |
| `__vector4 __bf16` | `__vector2 char` | `__vector4 __bf16` | `__vector4 __bf16` | — | ✓ |

**等价写法（官方）**：

| MAC | MAS | IMAS |
|-----|-----|------|
| `a * b + c` | `-a * b + c` | `a * b - c` |
| `b * a + c` | `-b * a + c` | `b * a - c` |
| `c + a * b` | `c - a * b` | `-c + a * b` |
| `c + b * a` | `c - b * a` | `-c + b * a` |

```cpp
__vector4 float mix_mac(__vector4 float acc, __vector char u8) {
  return acc * u8 + acc;
}

// 与官方「混精」示例一致：char×char 与 __vector int 累加（以实际 topscc 融合规则为准）
__vector4 int mix_mac_int(__vector char a, __vector char b, __vector int c) {
  return a * b + c;
}
```

---

## 参考来源

- 完整语言扩展见 `document/tops_cpp_programming_guide.md`「9. C++语言扩展」章节

（具体 MODE 位、VM_SEL 与 `va_union` 组合以所用 **topscc 版本** 发布说明为准。）
