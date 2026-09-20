# 2D 矩阵接口（matrix_t / matrix_ldst_t）

> `matrix_t` / `matrix_ldst_t` 是 TCLE 层 2D 矩阵接口（工具链随编译器发布），Primo++ 模板库的 MMA 实现基于此接口。本文件是其签名参考。

---

## 1. `matrix_t<N, M, T, dtype, attr>`

`matrix_t` 描述参与 MLI GEMM 类运算的二维矩阵视图，配合 `dot` / `dot_scaled`、`load` / `store` 以及 `setslice`、步长设置等完成整块矩阵乘与访存。

### 1.1 构造函数

| 形式 | 说明 |
|------|------|
| **构造函数一** | `matrix_t(char* &ptr, long long l0p5 = 0, long long sched = 0)` — **GCU400 + GCU410**。`ptr` 为左支或右支起始地址；`l0p5` 为该支的 L0P5 buffer id；`sched` 为该支调度信息。 |
| **构造函数二** | `matrix_t(matrix_t<...>::ty &val, ...)` — **仅 GCU410**，且**只能用于右支**。 |
| **构造函数三** | `matrix_t(char* &ptr, char* &scale_ptr, ...)` — **仅 GCU410**，scale 模式（矩阵与 scale 来自 memory 时须同地址空间等约束见编程指南）。 |
| **构造函数四** | `matrix_t(matrix_t<...>::ty &val, __vector char scale, ...)` — **仅 GCU410**，scale 模式下右支为寄存器侧 2D 变量配合 scale 向量。 |

典型指针构造（矩阵数据为指针）：

```c
matrix_t<M, K, T> m_a(ptr);
matrix_t<K, N, T> m_b(ptr);
```

### 1.2 模板参数

- **N**：行数（dim1）
- **M**：列数（dim0）
- **T**：元素类型 — `char`、`unsigned char`、`__fp16`、`__bf16`、`float` 直接使用；FP8 / EF32 通过 **dtype** 指定。
- **dtype**：辅助类型 — `0`（默认）、`DT_E4M3`、`DT_E5M2`、`DT_EF32` 等。
- **attr**：矩阵行为属性，可组合使用，例如：
  - **LD_COL**：右矩阵来自 memory 时按列加载（对应 MLI GEMM 的 rhs_ldmode）
  - **POST_SCALE** / **BLOCK_SCALE**：缩放模式（**仅 GCU410**；block/group 等语义以编程指南为准）
  - **PRI_STREAM** / **PRI_NORMAL** / **PRI_RESIDENCY** / **PRI_DEFAULT**：优先级提示（MLI_HINT_GEMM）
  - **PREFETCH**：预取相关

示例：

```c
matrix_t<M, N, char, DT_E4M3> m_a(ptr);
matrix_t<M, N, __fp16> m_a(ptr, LD_COL | PRI_STREAM | PREFETCH);
```

矩阵对应的矢量结果类型写为：`matrix_t<M, N, float>::ty`。

### 1.3 `dot` / `dot_scaled` 计算

```c
auto c = m_a.dot(m_b);       // 只乘不累加
c += m_a.dot(m_b);           // MAC（乘加）
c -= m_a.dot(m_b);           // MAS（乘被减）
c = m_a.dot(m_b) - c;        // IMAS（乘减）

// dot_scaled：带 scale 的对应形式（用法与 dot 类似）
c = m_a.dot_scaled(m_b);
c += m_a.dot_scaled(m_b);
c -= m_a.dot_scaled(m_b);
c = m_a.dot_scaled(m_b) - c;
```

还支持稀疏放置模板：`m_a.dot<wid_power, wid_pos>(m_b)`，其中 `wid_power` 表示稀疏存放步长，`wid_pos` 表示结果矩阵起始偏移（用于在 OACC 上更紧凑地排布结果）。

### 1.4 维度 × 类型组合（MxKxN）

**M**（左矩阵行维）可取：**8 / 16 / 32 / 64 / 128 / 256**。

**左右均为构造函数一**，或**左为构造函数一、右为构造函数二**时，**K×N** 与数据类型组合如下：

| K×N | 数据类型组合（左, 右, result） |
|-----|--------------------------------|
| 64×32 | (fp16, fp16, float) |
| 32×64 | (fp16, fp16, float)、(bf16, bf16, float)、(ef32, ef32, float) |
| 16×32 | (float, float, float) |
| 64×64 | (char, char, int)、(uchar, uchar, int)、(uchar, char, int)、(e4m3, e4m3, float)、(e5m2, e5m2, float)、(e4m3, e5m2, float)、(e5m2, e4m3, float) |

**左右均为构造函数三**，或**左为三、右为四**（带 scale）时，**K×N = 64×64** 支持 fp8 类型组合（e4m3/e5m2 与 float 结果等），详见编程指南「scale 模式」表格。

### 1.5 `load`

```c
auto c = m_a.load();
```

从矩阵描述的地址读出数据到矢量变量；**memory 元素类型须与返回值元素类型一致**。不同元素类型下合法的 **N×M** 组合较多（char/uchar/fp8、fp16/bf16、int/float 等各有对应表），编写时请以 Tops C++ Programming Guide 原文「load」小节的维度表为准。

### 1.6 `store`

```c
m_a.store(c);   // c 与 m_a 元素类型可不同，store 可完成一次类型转换
```

可通过矩阵声明附加 **store** 侧属性：**ST_RND**、**ST_RELU**、**ST_CLAMP**、**ST_MISS_NONALLOC**、**ST_MISS_ALLOC**、**ST_DEFAULT**。

### 1.7 `setslice` / 步长辅助

切片与步长用于描述真实参与运算的子块及内存步幅，常见包括：

- `setslice(SLICE_LHS_DIM0_REAL, ...)`、`setslice(SLICE_LHS_DIM1_REAL0, ...)`、`setslice(SLICE_LHS_DIM1_REAL1_REAL2, ...)`
- `setslice(SLICE_RHS_DIM1_REAL, ...)`、`setslice(SLICE_RHS_DIM0_REAL0, ...)`、`setslice(SLICE_RHS_DIM0_REAL1_REAL2, ...)`
- `setslice(SLICE_LDST_DIM0_REAL, ...)`、`setslice(SLICE_LDST_DIM1_REAL, ...)`
- `set_stride_lhs_dim1()`
- `set_stride_rhs_dim0()`、`set_stride_rhs_dim1()`
- `set_stride_ldst_dim0()`、`set_stride_ldst_dim1()`

具体枚举名（如 `SLICE_64`）与 SPR 配置以工程内头文件及编程指南为准。

### 1.8 示例：64×64 `char` GEMM（结果 `int`）

```c
void gemm(char *lhs, char *rhs, char *out) {
  matrix_t<64, 64, char> m_a(lhs);
  matrix_t<64, 64, char> m_b(rhs);
  matrix_t<64, 64, int> m_c(out);
  setslice(SLICE_LHS_DIM0_REAL, 0, 64, SLICE_64);
  setslice(SLICE_LHS_DIM1_REAL0, 0, 0, SLICE_64);
  setslice(SLICE_LHS_DIM1_REAL1_REAL2, 0, 64, SLICE_64);
  setslice(SLICE_RHS_DIM1_REAL, 0, 64, SLICE_64);
  setslice(SLICE_RHS_DIM0_REAL0, 0, 0, SLICE_64);
  setslice(SLICE_RHS_DIM0_REAL1_REAL2, 0, 64, SLICE_64);
  set_stride_lhs_dim1(64);
  set_stride_rhs_dim0(1);
  set_stride_rhs_dim1(64);
  auto res = m_a.dot(m_b);
  setslice(SLICE_LDST_DIM0_REAL, 0, 64, SLICE_64);
  setslice(SLICE_LDST_DIM1_REAL, 0, 64, SLICE_64);
  set_stride_ldst_dim0(1);
  set_stride_ldst_dim1(64);
  m_c.store<int>(res);
}
```

---

## 2. `matrix_ldst_t<MemT, dtype, attr>`

编程指南中说明：**GCU410** 具备矩阵存取单元，通过 `matrix_ldst_t` 在存储与寄存器之间做二维块搬运；与 `matrix_t` 的 `dot` 结果配合时，可将累加结果按二维块写回 memory。

### 2.1 构造函数

```c
matrix_ldst_t(char* &ptr, int dim1, int dim0, int stride0 = 1);
```

完整模板形式为：

```c
matrix_ldst_t<typename MemT, int dtype = 0, int attr = ST_DEFAULT>(
    char* &ptr, int dim1, int dim0, int stride0 = 1);
```

- **MemT**：memory 侧元素类型（`char`、`unsigned char`、`int`、`unsigned int`、`__fp16`、`__bf16`、`float`；FP8 为 `MemT = char` 且 `dtype = DT_E4M3` / `DT_E5M2`）。
- **dtype**：FP8 等辅助类型标志。
- **attr**：**ST_MISS_NONALLOC**、**ST_MISS_ALLOC**、**ST_DEFAULT**。
- **ptr**：memory 起始地址；**dim1 / dim0** 为存储中完整二维块的高/低维（元素个数）；**stride0** 为低维步进（元素个数）。

### 2.2 `load`

```c
matrix_t<...>::ty load<val_dim1, val_dim0>(real_dim1 = val_dim1, real_dim0 = val_dim0);
```

- **val_dim1** 可取 **8 / 16 / 32 / 64 / 128 / 256**；**val_dim0** 为 2 的幂。
- 约束：**512B ≤ val_dim1 × val_dim0 × bpe ≤ 64KiB**。
- **real_dim1 / real_dim0**：实际搬运的高/低维尺寸（元素个数）。

### 2.3 `store`

```c
void store<val_dim1, val_dim0, ValT, cvt_mode>(
    matrix_t<...>::ty &from,
    real_dim1 = val_dim1,
    real_dim0 = val_dim0);
```

- **val_dim1 / val_dim0** 与 **load** 相同规则；**ValT** 可与 **MemT** 不同以在 store 时做类型转换。
- 合法转换示例：**fp16→fp8**、**bf16→fp8**、**int→char**、**float→fp16/bf16/fp8** 等（完整表见编程指南）。
- **cvt_mode**：**RND_ZERO**、**RND_EVEN**、**CLAMP**、**TAR_RELU** 等。

### 2.4 示例：`dot` 结果经 `matrix_ldst_t` 写回

```c
void foo(char *LHSAddr, char *RHSAddr, char *MemAddr, int MemDim1, int MemDim0) {
  matrix_t<64, 64, char> m_a(LHSAddr);
  matrix_t<64, 64, char> m_b(RHSAddr);
  auto Val = m_a.dot(m_b);
  matrix_ldst_t<int> m_c(MemAddr, MemDim1, MemDim0);
  m_c.store<64, 64, int>(Val);
}
```

---

## 延伸阅读

- 完整语法、图示与更多类型组合表见 `document/tops_cpp_programming_guide.md`「9.13. 2D矩阵接口」「matrix_ldst_t」章节。
