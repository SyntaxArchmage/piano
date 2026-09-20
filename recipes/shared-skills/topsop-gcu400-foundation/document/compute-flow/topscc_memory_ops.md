# TCLE 内存操作：`gather` / `scatter` / `load_stride` / `store_stride`

本文档描述 Tops C++（topscc）中 `tcle` 命名空间下与**非连续/跨步访存**相关的内存操作接口，适用于编写 GCU300/GCU400 核函数时查阅签名、类型约束与架构差异。

---

## 1. `tcle::gather()`

### 函数签名

```c++
template <typename VT> VT gather(void* base, OT offset);

template <typename VT, typename MT>
VT gather(void* base, OT offset, VT other, MT cond);
```

> 说明：`OT` 为**偏移向量**的类型（由模板实参推导或显式指定），须为与 `VT` **元素个数相同**的整型向量；`MT` 为与 `VT` 对应的 **bool 掩码向量**类型。

### 功能说明

以 `base` 为基地址、以向量 `offset` 中各元素为**相对基址的偏移**，从多个不连续地址各读取一个标量，聚合成类型为 `VT` 的**一条向量**。等价于按 `base + offset[i]` 做分散读，再组装成 `VT`。

**条件版本**：按 `cond` 逐元素决定：为 `true` 时从内存读取；为 `false` 时结果向量该 lane 取 `other` 的对应元素（不访问或语义上视为不采用该次内存读，以编译器/文档约定为准）。

### 参数说明

| 参数 | 说明 |
|------|------|
| `base` | 基地址指针。 |
| `offset` | 偏移向量；**元素个数必须与输出向量 `VT` 的 lane 数相同**；元素类型为**有符号或无符号整型**（见下文架构与 64 位偏移）。 |
| `other` | （仅条件版）`cond` 为假时采用的默认值向量，类型与 `VT` 一致。 |
| `cond` | （仅条件版）bool 掩码向量，类型为与 `VT` 匹配的 `__vector* bool *`（lane 数与 `VT` 一致）。 |

### 返回值

- 非条件版：类型为 `VT` 的 gather 结果向量。
- 条件版：类型为 `VT`；未从内存读取的 lane 由 `other` 填充。

### 对齐与约束

- 每个有效访存地址 `base + offset[i]` 须按**该元素类型字节宽度**对齐。
- **`VT`**：支持**所有非 `bool` 的向量类型**（含 `__vector` / `__vector2` / `__vector4` 及各类元素类型，不含 bool 向量）。
- **`offset`**：必须为**整型向量**，且 **lane 数与 `VT` 相同**。

### 类型与架构说明

| 项目 | 说明 |
|------|------|
| **GCU300** | 文档说明在 GCU300 及以上支持 gather；偏移一般为 **32 位** 语义（与具体 offset 向量元素类型对应）。 |
| **GCU400** | 引入 **`__vector8`**，**仅**用于 64 位地址的 gather/scatter 中作为 **64 位 offset 向量**类型（如 `__vector8 long long`、`__vector8 unsigned long long`）。`__vector8` **不是**通用数据类型，除 gather/scatter 等指定 API 外勿使用。 |

### 类型支持汇总表（`VT` / `OT` / 架构）

| 输出 `VT` | `offset` (`OT`) 要点 | 条件版 `MT`（`cond`） | 架构 |
|-----------|----------------------|------------------------|------|
| 任意非 bool 向量类型 | 与 `VT` 同 lane 数的 **signed/unsigned 整型向量** | 与 `VT` 对应的 bool 向量（如 `__vector4 int` → `__vector4 bool int`） | GCU300 / GCU400 |
| 同上 | **GCU400**：64 位地址偏移可使用 **`__vector8 long long` / `__vector8 unsigned long long`** | 同上 | **GCU400**（64 位 offset） |

### 代码示例

```c++
// 非条件：从 base + off[i] 各读 1 个元素，聚成 __vector char
__device__ __vector char foo(void* addr, __vector4 int off) {
  return gather<__vector char>(addr, off);
}

// 条件：cond 为真处从内存读，否则取 other
__device__ __vector char foo(void* addr, __vector4 int off,
                             __vector char other, __vector bool char cond) {
  return gather<__vector char>(addr, off, other, cond);
}

// GCU400：64 位偏移向量示例（仅作 API 形态说明，需与硬件/编译器约束一致）
// __device__ __vector float bar(void* base, __vector8 long long off64) {
//   return gather<__vector float>(base, off64);
// }
```

---

## 2. `tcle::scatter()`

### 函数签名

```c++
template <typename VT, typename OT> void scatter(VT src, void* base, OT offset);

template <typename VT, typename OT, typename MT>
void scatter(VT src, void* base, OT offset, MT cond);
```

### 功能说明

以 `base` 为基地址、以 `offset` 各元素为偏移，将 `src` 的**每个 lane** 写入对应地址 `base + offset[i]`，即把一条向量**拆散**写到多个内存位置。与 gather 对 **offset** 的约束一致（同 lane 数、整型 offset；GCU400 下 64 位可用 `__vector8`）。

**条件版**：`cond[i] == true` 时写入该 lane；为 `false` 时**不修改**对应地址的内存。

### 参数说明

| 参数 | 说明 |
|------|------|
| `src` | 待写入的源向量，`VT` 为任意**非 bool**向量类型。 |
| `base` | 基地址指针。 |
| `offset` | 偏移向量；**元素个数与 `src` 相同**；元素为**有符号或无符号整型**（GCU400 64 位见 `__vector8`）。 |
| `cond` | （仅条件版）bool 掩码，类型与 `src` 匹配。 |

### 返回值

- `void`。

### 对齐与约束

- 每个 `base + offset[i]` 须按**元素字节宽度**对齐。
- **`src` / `VT`**：所有**非 bool**向量类型。
- **`offset`**：与 gather **相同约束**（lane 数匹配、整型；GCU400 64 位 offset 见上节）。

### 类型支持汇总表（`VT` / `OT` / 架构）

与 **gather** 一致：`VT` 为非 bool 向量；`OT` 为同 lane 整型向量；GCU400 可用 `__vector8` 表示 64 位 offset；条件版 `MT` 为对应 bool 向量。

| 项目 | 说明 |
|------|------|
| 架构 | GCU300 / GCU400（64 位 offset 仅 GCU400 + `__vector8`） |
| 性能提示 | 随机地址 pattern 吞吐受限；连续 pattern 相对更友好（详见编程指南性能章节）。 |

### 代码示例

```c++
__device__ void foo(__vector char data, void* base, __vector4 int off) {
  scatter(data, base, off);
}

__device__ void foo(__vector char data, void* base, __vector4 int off,
                    __vector bool char cond) {
  scatter(data, base, off, cond);
}
```

---

## 3. `tcle::load_stride()`（仅 GCU400）

### 函数签名

```c++
template <typename VT> VT load_stride(void* base, long long stride);

template <typename VT, typename MT>
VT load_stride(void* base, long long stride, VT other, MT cond);
```

### 功能说明

以 `base` 为起始地址，按 **`stride` 个元素**为间隔，从内存读取多个元素并组成结果向量 `VT`。`stride` 的单位是**元素个数**（不是字节）；各访问地址仍须满足**按元素对齐**。

**条件版**：`cond` 为真的 lane 从内存读取；否则结果该 lane 取 `other`。

### 参数说明

| 参数 | 说明 |
|------|------|
| `base` | 起始地址。 |
| `stride` | 相邻被访问元素之间的间隔，**以元素个数为单位**。 |
| `other` | （条件版）未从内存读取时的默认值。 |
| `cond` | （条件版）bool 掩码向量。 |

### 返回值

- 类型为 `VT` 的向量。

### 架构

- **仅 GCU400**。

---

### 无条件版本：完整类型表（`VT` × `base` × `stride`）

| 返回类型 `VT` | `base` | `stride` | 架构 |
|---------------|--------|----------|------|
| `__vector char` | `void*` | `long long` | GCU400 |
| `__vector unsigned char` | `void*` | `long long` | GCU400 |
| `__vector short` | `void*` | `long long` | GCU400 |
| `__vector unsigned short` | `void*` | `long long` | GCU400 |
| `__vector int` | `void*` | `long long` | GCU400 |
| `__vector unsigned int` | `void*` | `long long` | GCU400 |
| `__vector long long` | `void*` | `long long` | GCU400 |
| `__vector unsigned long long` | `void*` | `long long` | GCU400 |
| `__vector __fp16` | `void*` | `long long` | GCU400 |
| `__vector __bf16` | `void*` | `long long` | GCU400 |
| `__vector float` | `void*` | `long long` | GCU400 |
| `__vector2 char` | `void*` | `long long` | GCU400 |
| `__vector2 unsigned char` | `void*` | `long long` | GCU400 |
| `__vector2 short` | `void*` | `long long` | GCU400 |
| `__vector2 unsigned short` | `void*` | `long long` | GCU400 |
| `__vector2 int` | `void*` | `long long` | GCU400 |
| `__vector2 unsigned int` | `void*` | `long long` | GCU400 |
| `__vector2 long long` | `void*` | `long long` | GCU400 |
| `__vector2 unsigned long long` | `void*` | `long long` | GCU400 |
| `__vector2 __fp16` | `void*` | `long long` | GCU400 |
| `__vector2 __bf16` | `void*` | `long long` | GCU400 |
| `__vector2 float` | `void*` | `long long` | GCU400 |
| `__vector4 char` | `void*` | `long long` | GCU400 |
| `__vector4 unsigned char` | `void*` | `long long` | GCU400 |
| `__vector4 short` | `void*` | `long long` | GCU400 |
| `__vector4 unsigned short` | `void*` | `long long` | GCU400 |
| `__vector4 int` | `void*` | `long long` | GCU400 |
| `__vector4 unsigned int` | `void*` | `long long` | GCU400 |
| `__vector4 long long` | `void*` | `long long` | GCU400 |
| `__vector4 unsigned long long` | `void*` | `long long` | GCU400 |
| `__vector4 __fp16` | `void*` | `long long` | GCU400 |
| `__vector4 __bf16` | `void*` | `long long` | GCU400 |
| `__vector4 float` | `void*` | `long long` | GCU400 |

> 元素类型覆盖：**char / uchar / short / ushort / int / uint / long long / ulong long / fp16(`__fp16`) / bf16(`__bf16`) / float** × **vector / vector2 / vector4**。

---

### 条件版本：完整类型表（`VT`、`other`、`MT`）

| 返回类型 `VT` | `base` | `stride` | `other` | `cond` (`MT`) | 架构 |
|---------------|--------|----------|---------|---------------|------|
| `__vector char` | `void*` | `long long` | `__vector char` | `__vector bool char` | GCU400 |
| `__vector unsigned char` | `void*` | `long long` | `__vector unsigned char` | `__vector bool char` | GCU400 |
| `__vector short` | `void*` | `long long` | `__vector short` | `__vector bool short` | GCU400 |
| `__vector unsigned short` | `void*` | `long long` | `__vector unsigned short` | `__vector bool short` | GCU400 |
| `__vector int` | `void*` | `long long` | `__vector int` | `__vector bool int` | GCU400 |
| `__vector unsigned int` | `void*` | `long long` | `__vector unsigned int` | `__vector bool int` | GCU400 |
| `__vector long long` | `void*` | `long long` | `__vector long long` | `__vector bool long long` | GCU400 |
| `__vector unsigned long long` | `void*` | `long long` | `__vector unsigned long long` | `__vector bool long long` | GCU400 |
| `__vector __fp16` | `void*` | `long long` | `__vector __fp16` | `__vector bool short` | GCU400 |
| `__vector __bf16` | `void*` | `long long` | `__vector __bf16` | `__vector bool short` | GCU400 |
| `__vector float` | `void*` | `long long` | `__vector float` | `__vector bool int` | GCU400 |
| `__vector2 char` | `void*` | `long long` | `__vector2 char` | `__vector2 bool char` | GCU400 |
| `__vector2 unsigned char` | `void*` | `long long` | `__vector2 unsigned char` | `__vector2 bool char` | GCU400 |
| `__vector2 short` | `void*` | `long long` | `__vector2 short` | `__vector2 bool short` | GCU400 |
| `__vector2 unsigned short` | `void*` | `long long` | `__vector2 unsigned short` | `__vector2 bool short` | GCU400 |
| `__vector2 int` | `void*` | `long long` | `__vector2 int` | `__vector2 bool int` | GCU400 |
| `__vector2 unsigned int` | `void*` | `long long` | `__vector2 unsigned int` | `__vector2 bool int` | GCU400 |
| `__vector2 long long` | `void*` | `long long` | `__vector2 long long` | `__vector2 bool long long` | GCU400 |
| `__vector2 unsigned long long` | `void*` | `long long` | `__vector2 unsigned long long` | `__vector2 bool long long` | GCU400 |
| `__vector2 __fp16` | `void*` | `long long` | `__vector2 __fp16` | `__vector2 bool short` | GCU400 |
| `__vector2 __bf16` | `void*` | `long long` | `__vector2 __bf16` | `__vector2 bool short` | GCU400 |
| `__vector2 float` | `void*` | `long long` | `__vector2 float` | `__vector2 bool int` | GCU400 |
| `__vector4 char` | `void*` | `long long` | `__vector4 char` | `__vector4 bool char` | GCU400 |
| `__vector4 unsigned char` | `void*` | `long long` | `__vector4 unsigned char` | `__vector4 bool char` | GCU400 |
| `__vector4 short` | `void*` | `long long` | `__vector4 short` | `__vector4 bool short` | GCU400 |
| `__vector4 unsigned short` | `void*` | `long long` | `__vector4 unsigned short` | `__vector4 bool short` | GCU400 |
| `__vector4 int` | `void*` | `long long` | `__vector4 int` | `__vector4 bool int` | GCU400 |
| `__vector4 unsigned int` | `void*` | `long long` | `__vector4 unsigned int` | `__vector4 bool int` | GCU400 |
| `__vector4 long long` | `void*` | `long long` | `__vector4 long long` | `__vector4 bool long long` | GCU400 |
| `__vector4 unsigned long long` | `void*` | `long long` | `__vector4 unsigned long long` | `__vector4 bool long long` | GCU400 |
| `__vector4 __fp16` | `void*` | `long long` | `__vector4 __fp16` | `__vector4 bool short` | GCU400 |
| `__vector4 __bf16` | `void*` | `long long` | `__vector4 __bf16` | `__vector4 bool short` | GCU400 |
| `__vector4 float` | `void*` | `long long` | `__vector4 float` | `__vector4 bool int` | GCU400 |

### 代码示例

```c++
__device__ __vector2 float foo(char* p, long long stride) {
  return load_stride<__vector2 float>(p, stride);
}

__device__ __vector2 float foo(char* p, long long stride,
                               __vector2 float other, __vector2 bool int cond) {
  return load_stride<__vector2 float>(p, stride, other, cond);
}
```

---

## 4. `tcle::store_stride()`（仅 GCU400）

### 函数签名

```c++
template <typename VT> void store_stride(VT src, void* base, long long stride);

template <typename VT, typename MT>
void store_stride(VT src, void* base, long long stride, MT cond);
```

### 功能说明

以 `base` 为起始地址、以 **`stride` 元素**为间隔，将 `src` 各 lane 写入对应内存位置。`stride` 单位为**元素个数**；地址须按元素对齐。

**重要**：当 **`stride == 0`** 时，**结果不可知**（undefined），应避免使用。

**条件版**：仅当 `cond` 对应 lane 为真时写入；否则该地址内存**保持不变**。

### 参数说明

| 参数 | 说明 |
|------|------|
| `src` | 待写入的源向量。 |
| `base` | 起始地址。 |
| `stride` | 元素间隔（**元素个数**）；**为 0 时行为未定义**。 |
| `cond` | （条件版）bool 掩码。 |

### 返回值

- `void`。

### 架构与 `stride` 注意

- **仅 GCU400**。
- **`stride = 0`**：**未定义行为**，勿依赖。

### 类型支持

与 `load_stride` **相同**：见上节「元素类型 × vector / vector2 / vector4」组合；**fp16 / bf16 / float** 及整数类型均按表中 `__fp16` / `__bf16` / `float` 等书写。

---

### 无条件版本：完整类型表（`src`(`VT`) × `base` × `stride`）

| 返回 | `src` (`VT`) | `base` | `stride` | 架构 |
|------|--------------|--------|----------|------|
| `void` | `__vector char` | `void*` | `long long` | GCU400 |
| `void` | `__vector unsigned char` | `void*` | `long long` | GCU400 |
| `void` | `__vector short` | `void*` | `long long` | GCU400 |
| `void` | `__vector unsigned short` | `void*` | `long long` | GCU400 |
| `void` | `__vector int` | `void*` | `long long` | GCU400 |
| `void` | `__vector unsigned int` | `void*` | `long long` | GCU400 |
| `void` | `__vector long long` | `void*` | `long long` | GCU400 |
| `void` | `__vector unsigned long long` | `void*` | `long long` | GCU400 |
| `void` | `__vector __fp16` | `void*` | `long long` | GCU400 |
| `void` | `__vector __bf16` | `void*` | `long long` | GCU400 |
| `void` | `__vector float` | `void*` | `long long` | GCU400 |
| `void` | `__vector2 char` | `void*` | `long long` | GCU400 |
| `void` | `__vector2 unsigned char` | `void*` | `long long` | GCU400 |
| `void` | `__vector2 short` | `void*` | `long long` | GCU400 |
| `void` | `__vector2 unsigned short` | `void*` | `long long` | GCU400 |
| `void` | `__vector2 int` | `void*` | `long long` | GCU400 |
| `void` | `__vector2 unsigned int` | `void*` | `long long` | GCU400 |
| `void` | `__vector2 long long` | `void*` | `long long` | GCU400 |
| `void` | `__vector2 unsigned long long` | `void*` | `long long` | GCU400 |
| `void` | `__vector2 __fp16` | `void*` | `long long` | GCU400 |
| `void` | `__vector2 __bf16` | `void*` | `long long` | GCU400 |
| `void` | `__vector2 float` | `void*` | `long long` | GCU400 |
| `void` | `__vector4 char` | `void*` | `long long` | GCU400 |
| `void` | `__vector4 unsigned char` | `void*` | `long long` | GCU400 |
| `void` | `__vector4 short` | `void*` | `long long` | GCU400 |
| `void` | `__vector4 unsigned short` | `void*` | `long long` | GCU400 |
| `void` | `__vector4 int` | `void*` | `long long` | GCU400 |
| `void` | `__vector4 unsigned int` | `void*` | `long long` | GCU400 |
| `void` | `__vector4 long long` | `void*` | `long long` | GCU400 |
| `void` | `__vector4 unsigned long long` | `void*` | `long long` | GCU400 |
| `void` | `__vector4 __fp16` | `void*` | `long long` | GCU400 |
| `void` | `__vector4 __bf16` | `void*` | `long long` | GCU400 |
| `void` | `__vector4 float` | `void*` | `long long` | GCU400 |

---

### 条件版本：完整类型表（`src`、`base`、`stride`、`MT`）

| 返回 | `src` | `base` | `stride` | `cond` (`MT`) | 架构 |
|------|-------|--------|----------|---------------|------|
| `void` | `__vector char` | `void*` | `long long` | `__vector bool char` | GCU400 |
| `void` | `__vector unsigned char` | `void*` | `long long` | `__vector bool char` | GCU400 |
| `void` | `__vector short` | `void*` | `long long` | `__vector bool short` | GCU400 |
| `void` | `__vector unsigned short` | `void*` | `long long` | `__vector bool short` | GCU400 |
| `void` | `__vector int` | `void*` | `long long` | `__vector bool int` | GCU400 |
| `void` | `__vector unsigned int` | `void*` | `long long` | `__vector bool int` | GCU400 |
| `void` | `__vector long long` | `void*` | `long long` | `__vector bool long long` | GCU400 |
| `void` | `__vector unsigned long long` | `void*` | `long long` | `__vector bool long long` | GCU400 |
| `void` | `__vector __fp16` | `void*` | `long long` | `__vector bool short` | GCU400 |
| `void` | `__vector __bf16` | `void*` | `long long` | `__vector bool short` | GCU400 |
| `void` | `__vector float` | `void*` | `long long` | `__vector bool int` | GCU400 |
| `void` | `__vector2 char` | `void*` | `long long` | `__vector2 bool char` | GCU400 |
| `void` | `__vector2 unsigned char` | `void*` | `long long` | `__vector2 bool char` | GCU400 |
| `void` | `__vector2 short` | `void*` | `long long` | `__vector2 bool short` | GCU400 |
| `void` | `__vector2 unsigned short` | `void*` | `long long` | `__vector2 bool short` | GCU400 |
| `void` | `__vector2 int` | `void*` | `long long` | `__vector2 bool int` | GCU400 |
| `void` | `__vector2 unsigned int` | `void*` | `long long` | `__vector2 bool int` | GCU400 |
| `void` | `__vector2 long long` | `void*` | `long long` | `__vector2 bool long long` | GCU400 |
| `void` | `__vector2 unsigned long long` | `void*` | `long long` | `__vector2 bool long long` | GCU400 |
| `void` | `__vector2 __fp16` | `void*` | `long long` | `__vector2 bool short` | GCU400 |
| `void` | `__vector2 __bf16` | `void*` | `long long` | `__vector2 bool short` | GCU400 |
| `void` | `__vector2 float` | `void*` | `long long` | `__vector2 bool int` | GCU400 |
| `void` | `__vector4 char` | `void*` | `long long` | `__vector4 bool char` | GCU400 |
| `void` | `__vector4 unsigned char` | `void*` | `long long` | `__vector4 bool char` | GCU400 |
| `void` | `__vector4 short` | `void*` | `long long` | `__vector4 bool short` | GCU400 |
| `void` | `__vector4 unsigned short` | `void*` | `long long` | `__vector4 bool short` | GCU400 |
| `void` | `__vector4 int` | `void*` | `long long` | `__vector4 bool int` | GCU400 |
| `void` | `__vector4 unsigned int` | `void*` | `long long` | `__vector4 bool int` | GCU400 |
| `void` | `__vector4 long long` | `void*` | `long long` | `__vector4 bool long long` | GCU400 |
| `void` | `__vector4 unsigned long long` | `void*` | `long long` | `__vector4 bool long long` | GCU400 |
| `void` | `__vector4 __fp16` | `void*` | `long long` | `__vector4 bool short` | GCU400 |
| `void` | `__vector4 __bf16` | `void*` | `long long` | `__vector4 bool short` | GCU400 |
| `void` | `__vector4 float` | `void*` | `long long` | `__vector4 bool int` | GCU400 |

### 代码示例

```c++
__device__ void foo(__vector __fp16 a, char* p, long long stride) {
  store_stride(a, p, stride);
}

__device__ void foo(__vector __fp16 a, char* p, long long stride,
                    __vector bool short mask) {
  store_stride(a, p, stride, mask);
}
```

---

## 文档来源与一致性

文中 `load_stride` / `store_stride` 的完整类型表与 **Tops C++ Programming Guide** 中 `cpp_language_extension.md` 的内存操作章节一致；`gather` / `scatter` 的语义与 **`__vector8`（GCU400 64 位 offset）** 说明亦来自同一文档。若编译器版本更新导致类型表变化，请以当前版本官方手册为准。
