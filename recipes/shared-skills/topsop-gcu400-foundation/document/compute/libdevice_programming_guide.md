> Imported material source: `Doc/Libdevice Programming Guide.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `Libdevice Programming Guide`.

# Libdevice Programming Guide

## 2. 前言

### 2.1. 更改历史记录

| Version | Change | Date |
| --- | --- | --- |
| v1.0.1 | 初始化版本 | 2025-04-08 |
| v1.0.2 | 添加 libdevice API 描述 | 2025-06-18 |

### 2.2. 术语和缩写

| 术语 | 说明 |
| --- | --- |
| TCLE | Tops C Language Extensions，Tops C语言扩展 |
| GCU | 燧原通用计算卡 |
| TOPSCC | 燧原通用软件编程模型 |

### 2.3. 使用范围

本指南记录了 libdevice 中可用的函数以及从编译器开发者角度使用该库的基本方法，以便程序员更好地使用 GCU 的硬件资源，实现高效的算子或算法。

### 2.4. 综述

#### 2.4.1. 什么是 GCU libdevice

libdevice 是一个由 GCU 内部硬件指令或 intrinsics 实现的函数组成的库，用于实现 GCU 设备的常用功能，包括数学原语和位操作函数等。

这些函数针对特定架构进行了优化，旨在屏蔽硬件实现差异，对上提供统一的编程接口。

libdevice API主要包括以下几类操作：

| 分类 | 描述 |
| --- | --- |
| 数学函数 | 提供了大量的数学运算函数，如三角函数（__ef_vsin, __ef_vcos）、双曲函数（__ef_vsinh, __ef_vcosh）、指数和对数函数（__ef_vexp, __ef_vlog）、<br>幂函数（__ef_vpow）、误差函数（__ef_verf）等 |
| 浮点数操作 | 支持浮点数的四舍五入（__ef_vrint, __ef_vnearbyint）、取整（__ef_vfloor, __ef_vceil）、绝对值（__ef_vfabs）、<br>比较（__ef_vfmax, __ef_vfmin）等操作 |
| 数据转换 | 支持在整数和浮点数之间的转换，如 __ef_vfloat2int_rn（单精度到整数转换）、__ef_vint_as_float 等 |
| 位操作 | 提供位反转（__ef_vbrev, __ef_vbrevll）、位计数（__ef_vpopc, __ef_vpopcll）、字节排列（__ef_vbyte_perm）等功能 |
| 特殊函数 | 包括贝塞尔函数（__ef_vj0, __ef_vj1）、伽马函数（__ef_vtgamma）、误差函数的逆函数（__ef_verfinv）等 |

#### 2.4.2. 接口描述

GCU libdevice 开发严格参考CUDA官方文档，接口一一对应，官方链接如下：

https://docs.nvidia.com/cuda/libdevice-users-guide/function-desc.html#function-desc

libdevice 总共 319个API， 除 double 相关的接口 GCU 设备不支持外，其余API均已经实现。

#### 2.4.3. 命名规则

##### 2.4.3.1. 数据类型

由标量变成向量如：

| CUDA | GCU |
| --- | --- |
| float | __vector float |
| __fp16 | __vector __fp16 |
| __bf16 | __vector __bf16 |
| int | __vector int |
| unsigned int | __vector unsigned int |
| long long | __vector long long |
| unsigned long long | __vector unsigned long long |

##### 2.4.3.2. API 命名规则

| CUDA | GCU | 举例 |
| --- | --- | --- |
| __nv | __ef_v | float __nv_acosf(float x) -> __vector float __ef_vacosf(__vector float x) |
| __nv_fast | __ef_fast_v | float __nv_fast_expf(float x) -> __vector float __ef_fast_vexpf(__vector float x) |

#### 2.4.4. 基本用法

##### 2.4.4.1. 编译流程

libdevice API 在caps安装时被编译成libdevice.tops.bc,并安装到指定目录。

后续编译用户程序或算子时，编译器会以link-builtin-bitcode的形式去link libdevice.tops.bc ，产生inline后的LLVM IR，再进行后续优化和编译。

##### 2.4.4.2. 安装位置

bc 文件：

/opt/tops/lib/gcu/gculibdevice.gcu400.tops.bc

头文件位置:

/opt/tops/lib/clang/11.0.0/include/gcu_device_functions.h

##### 2.4.4.3. 编译命令

**topscc:**

```
topscc -arch gcu400 -ltops -std=++17 test.cpp -O3 -o test.out
```

**-mlink-builtin-bitcode 选项已默认添加到clang和topscc的默认编译选项中，不需要手动指定。**

**gcu_device_functions.h 默认会被 tcle.h 包含，无需再手动include。**

#### 2.4.5. 使用举例

```
#include "tcle.h"
using namespace tcle;

int main() {
  unsigned in[][2] =  {{0, 5}, {3, 2}, {4, 4}, {5, 0x7fffffff}, {5, 0xffffffff}};
  unsigned out[] = {5, 3, 4, 0x7fffffff, 0xffffffff};
  __vector int res;
  for (int i = 0; i < sizeof(out)/sizeof(unsigned); i++)
  {
    res = __ef_vumax((__vector unsigned)(in[i][0]), (__vector unsigned)(in[i][1]));
    if (res[0] != out[i]) return i + 1;
  }
  return 0;
}
```

```
clang  --target=gcu -mcpu=gcu400 test.cpp -O3 -o test.out
```

##### 2.4.5.1. 注意事项

- Libdevice API 当前在GCU400上已全部实现，GCU300、GCU500暂不支持。
- 由于GCU400 rounding mode只支持rn和rz，默认使用rn。所以部分带rd、ru相关接口均按rn处理（GCU400 CVT 指令 float to int 支持rd、ru）。
- TCLE大部分数学函数是直接调用libdevice api实现的，默认调用fast实现，如果对精度有要求，建议直接调用libdevice API。

## 3. 函数参考

### 3.1. 接口对照

**精度测试方法说明：**

- 该最大ULP误差为 libdevice 库函数返回的结果与更高精度的C++标准库函数返回值经正确舍入模式获得的正确结果之间的 ulp 差异的绝对值， 如float类型数据则需要得到double类型的C++标准库函数返回值，当然涉及到位运算的函数除外。 测试数据由case按指定步进自动产生，由于测试时间太长并未进行全域覆盖，所以并没有涵盖所有情况，因此它们并不是绝对最大误差。
- 用CPU和GCU的结果进行对比计算出 GCU400 libdevice(GCU400) 的最大误差，单位ulp。
- 用CPU和CUDA的结果进行对比计算出 CUDA libdevice (H100) 的最大误差，单位ulp。
- H100的最大误差数据是使用相同的测试方法在H100 机器上实测结果，与NV官方数据基本一致。 https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html#standard-functions
- fast 接口未做精度对比。
- 最大误差'0'表示无误差。

**Warning:**

- 由于硬件和算法差异，部分API精度与GPU存在细微差异，使用时务必先确认精度误差值，确认满足精度需求方可使用;
- 下表中精度标记为 '-' 表示该API未进行精度测试或精度存在问题，高精度场景建议不要使用;
- 当前版本已知精度存在较大差异API如下，高精度场景不能使用： **GCU400:** __ef_vfmodf __ef_vremainderf __ef_vremquof

| 函数名（__nv） | 函数名（__ef） | 最大误差（GCU400） | 最大误差（H100） |
| --- | --- | --- | --- |
| i32 __nv_abs(i32 x) | __vector int __ef_vabs(__vector int x) | 0 | 0 |
| float __nv_acosf(float x) | __vector float __ef_vacosf(__vector float x) | 3 | 1 |
| float __nv_acoshf(float x) | __vector float __ef_vacoshf(__vector float x) | 4 | 2 |
| float __nv_asinf(float x) | __vector float __ef_vasinf(__vector float x) | 3 | 1 |
| float __nv_asinhf(float x) | __vector float __ef_vasinhf(__vector float x) | 3 | 2 |
| float __nv_atan2f(float x, float y) | __vector float __ef_vatan2f(__vector float x, __vector float y) | 2 | 2 |
| float __nv_atanf(float x) | __vector float __ef_vatanf(__vector float x) | 2 | 1 |
| float __nv_atanhf(float x) | __vector float __ef_vatanhf(__vector float x) | 4 | 3 |
| i32 __nv_brev(i32 x) | __vector unsigned int __ef_vbrev(__vector unsigned int x) | 0 | 0 |
| i64 __nv_brevll(i64 x) | __vector unsigned long long __ef_vbrevll<br>(__vector unsigned long long x) | 0 | 0 |
| i32 __nv_byte_perm(i32 x,<br>i32 y, i32 z) | __vector unsigned int __ef_vbyte_perm(__vector unsigned int x,<br>__vector unsigned int y, __vector unsigned int z) | - | - |
| float __nv_cbrtf(float x) | __vector float __ef_vcbrtf(__vector float x) | 1 | 1 |
| float __nv_ceilf(float x) | __vector float __ef_vceilf(__vector float x) | 0 | 0 |
| i32 __nv_clz(i32 x) | __vector unsigned int __ef_vclz(__vector int x) | 0 | 0 |
| i32 __nv_clzll(i64 x) | __vector int __ef_vclzll(__vector long long x) | 0 | 0 |
| float __nv_copysignf<br>(float x, float y) | __vector float __ef_vcopysignf(__vector float x, __vector float y) | 0 | 0 |
| float __nv_cosf(float x) | __vector float __ef_vcosf(__vector float x) | 2 | 1 |
| float __nv_coshf(float x) | __vector float __ef_vcoshf(__vector float x) | 2 | 2 |
| float __nv_cospif(float x) | __vector float __ef_vcospif(__vector float x) | 1 | 1 |
| float __nv_erfcf(float x) | __vector float __ef_verfcf(__vector float x) | 3 | 3 |
| float __nv_erfcinvf(float x) | __vector float __ef_verfcinvf(__vector float x) | 4 | 4 |
| float __nv_erfcxf(float x) | __vector float __ef_verfcxf(__vector float x) | 4 | 3 |
| float __nv_erff(float x) | __vector float __ef_verff(__vector float x) | 1 | 1 |
| float __nv_erfinvf(float x) | __vector float __ef_verfinvf(__vector float x) | 2 | 2 |
| float __nv_exp10f(float x) | __vector float __ef_vexp10f(__vector float x) | 1 | 1 |
| float __nv_exp2f(float x) | __vector float __ef_vexp2f(__vector float x) | 1 | 2 |
| float __nv_expf(float x) | __vector float __ef_vexpf(__vector float x) | 1 | 2 |
| float __nv_expm1f(float x) | __vector float __ef_vexpm1f(__vector float x) | 1 | 1 |
| float __nv_fabsf(float f) | __vector float __ef_vfabsf(__vector float f) | 0 | 0 |
| float __nv_fadd_rd(float x, float y) | __vector float __ef_vfadd_rd(__vector float x, __vector float y) | 1 | 1 |
| float __nv_fadd_rn(float x, float y) | __vector float __ef_vfadd_rn(__vector float x, __vector float y) | 0 | 0 |
| float __nv_fadd_ru(float x, float y) | __vector float __ef_vfadd_ru(__vector float x, __vector float y) | 1 | 1 |
| float __nv_fadd_rz(float x, float y) | __vector float __ef_vfadd_rz(__vector float x, __vector float y) | 1 | 1 |
| float __nv_fast_cosf(float x) | __vector float __ef_fast_vcosf(__vector float x) | - | - |
| float __nv_fast_exp10f(float x) | __vector float __ef_fast_vexp10f(__vector float x) | - | - |
| float __nv_fast_expf(float x) | __vector float __ef_fast_vexpf(__vector float x) | - | - |
| float __nv_fast_fdividef(float x, float y) | __vector float __ef_fast_vfdividef(__vector float x, __vector float y) | - | - |
| float __nv_fast_log10f(float x) | __vector float __ef_fast_vlog10f(__vector float x) | - | - |
| float __nv_fast_log2f(float x) | __vector float __ef_fast_vlog2f(__vector float x) | - | - |
| float __nv_fast_logf(float x) | __vector float __ef_fast_vlogf(__vector float x) | - | - |
| float __nv_fast_powf(float x, float y) | __vector float __ef_fast_vpowf(__vector float x, __vector float y) | - | - |
| void __nv_fast_sincosf(float x, <br>float*sptr, float* cptr) | void __ef_fast_vsincosf<br>(__vector float x, __vector float *sptr, __vector float*cptr); | - | - |
| float __nv_fast_sinf(float x) | __vector float __ef_fast_vsinf(__vector float x) | - | - |
| float __nv_fast_tanf(float x) | __vector float __ef_fast_vtanf(__vector float x) | - | - |
| float __nv_fdimf(float x, float y) | __vector float __ef_vfdimf(__vector float x, __vector float y) | 0 | 0 |
| float __nv_fdiv_rd(float x, float y) | __vector float __ef_vfdiv_rd(__vector float x, __vector float y) | 2 | 1 |
| float __nv_fdiv_rn(float x, float y) | __vector float __ef_vfdiv_rn(__vector float x, __vector float y) | 2 | 0 |
| float __nv_fdiv_ru(float x, float y) | __vector float __ef_vfdiv_ru(__vector float x, __vector float y) | 2 | 1 |
| float __nv_fdiv_rz(float x, float y) | __vector float __ef_vfdiv_rz(__vector float x, __vector float y) | 2 | 1 |
| i32 __nv_ffs(i32 x) | __vector int __ef_vffs(__vector int x) | 0 | 0 |
| i32 __nv_ffsll(i64 x) | __vector unsigned long long __ef_vffsll(__vector long long x) | 0 | 0 |
| i32 __nv_finitef(float x) | __vector int __ef_vfinitef(__vector float x) | 0 | 0 |
| i16 __nv_float2half_rn(float f) | __vector unsigned short __ef_vfloat2half_rn(__vector2 float f) | 0 | 0 |
| i32 __nv_float2int_rd(float in) | __vector int __ef_vfloat2int_rd(__vector float in) | 0 | 0 |
| i32 __nv_float2int_rn(float in) | __vector int __ef_vfloat2int_rn(__vector float in) | 0 | 0 |
| i32 __nv_float2int_ru(float in) | __vector int __ef_vfloat2int_ru(__vector float in) | 0 | 0 |
| i32 __nv_float2int_rz(float in) | __vector int __ef_vfloat2int_rz(__vector float in) | 0 | 0 |
| i64 __nv_float2ll_rd(float f) | __vector2 long long __ef_vfloat2ll_rd(__vector float f) | 0 | 0 |
| i64 __nv_float2ll_rn(float f) | __vector2 long long __ef_vfloat2ll_rn(__vector float f) | 0 | 0 |
| i64 __nv_float2ll_ru(float f) | __vector2 long long __ef_vfloat2ll_ru(__vector float f) | 0 | 0 |
| i64 __nv_float2ll_rz(float f) | __vector2 long long __ef_vfloat2ll_rz(__vector float f) | 0 | 0 |
| i32 __nv_float2uint_rd(float in) | __vector unsigned int __ef_vfloat2uint_rd(__vector float in) | 0 | 0 |
| i32 __nv_float2uint_rn(float in) | __vector unsigned int __ef_vfloat2uint_rn(__vector float in) | 0 | 0 |
| i32 __nv_float2uint_ru(float in) | __vector unsigned int __ef_vfloat2uint_ru(__vector float in) | 0 | 0 |
| i32 __nv_float2uint_rz(float in) | __vector unsigned int __ef_vfloat2uint_rz(__vector float in) | 0 | 0 |
| i64 __nv_float2ull_rd(float f) | __vector2 unsigned long long __ef_vfloat2ull_rd(__vector float f) | 0 | 0 |
| i64 __nv_float2ull_rn(float f) | __vector2 unsigned long long __ef_vfloat2ull_rn(__vector float f) | 0 | 0 |
| i64 __nv_float2ull_ru(float f) | __vector2 unsigned long long __ef_vfloat2ull_ru(__vector float f) | 0 | 0 |
| i64 __nv_float2ull_rz(float f) | __vector2 unsigned long long __ef_vfloat2ull_rz(__vector float f) | 0 | 0 |
| i32 __nv_float_as_int(float x) | __vector int __ef_vfloat_as_int(__vector float x) | 0 | 0 |
| float __nv_floorf(float f) | __vector float __ef_vfloorf(__vector float x) | 0 | 0 |
| float __nv_fmaf(float x, <br>float y, float z) | __vector float __ef_vfmaf(__vector float x, <br>__vector float y, __vector float z) | 0 | 0 |
| float __nv_fmaf_rd(float x, <br>float y, float z) | __vector float __ef_vfmaf_rd(__vector float x, <br>__vector float y, __vector float z) | 0 | 0 |
| float __nv_fmaf_rn(float x, <br>float y, float z) | __vector float __ef_vfmaf_rn(__vector float x, <br>__vector float y, __vector float z) | 0 | 0 |
| float __nv_fmaf_ru(float x, <br>float y, float z) | __vector float __ef_vfmaf_ru(__vector float x, <br>__vector float y, __vector float z) | 0 | 0 |
| float __nv_fmaf_rz(float x, <br>float y, float z) | __vector float __ef_vfmaf_rz(__vector float x, <br>__vector float y, __vector float z) | 0 | 0 |
| float __nv_fmaxf(float x, float y) | __vector float __ef_vfmaxf(__vector float x, __vector float y) | 0 | 0 |
| float __nv_fminf(float x, float y) | __vector float __ef_vfminf(__vector float x, __vector float y) | 0 | 0 |
| float __nv_fmodf(float x, float y) | __vector float __ef_vfmodf(__vector float x, __vector float y) | 3.402823e+38 | 0 |
| float __nv_fmul_rd(float x, float y) | __vector float __ef_vfmul_rd(__vector float x, __vector float y) | 1 | 1 |
| float __nv_fmul_rn(float x, float y) | __vector float __ef_vfmul_rn(__vector float x, __vector float y) | 0 | 0 |
| float __nv_fmul_ru(float x, float y) | __vector float __ef_vfmul_ru(__vector float x, __vector float y) | 1 | 1 |
| float __nv_fmul_rz(float x, float y) | __vector float __ef_vfmul_rz(__vector float x, __vector float y) | 1 | 1 |
| float __nv_frcp_rd(float x) | __vector float __ef_vfrcp_rd(__vector float x) | 1 | 1 |
| float __nv_frcp_rn(float x) | __vector float __ef_vfrcp_rn(__vector float x) | 1 | 1 |
| float __nv_frcp_ru(float x) | __vector float __ef_vfrcp_ru(__vector float x) | 1 | 1 |
| float __nv_frcp_rz(float x) | __vector float __ef_vfrcp_rz(__vector float x) | 1 | 1 |
| float __nv_frexpf(float x, i32* b) | __vector float __ef_vfrexpf(__vector float x, __vector int *b) | 0 | 0 |
| float __nv_frsqrt_rn(float x) | __vector float __ef_vfrsqrt_rn(__vector float x) | 0 | 0 |
| float __nv_fsqrt_rd(float x) | __vector float __ef_vfsqrt_rd(__vector float x) | 3 | 0 |
| float __nv_fsqrt_rn(float x) | __vector float __ef_vfsqrt_rn(__vector float x) | 3 | 0 |
| float __nv_fsqrt_ru(float x) | __vector float __ef_vfsqrt_ru(__vector float x) | 2 | 0 |
| float __nv_fsqrt_rz(float x) | __vector float __ef_vfsqrt_rz(__vector float x) | 3 | 0 |
| float __nv_fsub_rd(float x, float y) | __vector float __ef_vfsub_rd(__vector float x, __vector float y) | 1 | 1 |
| float __nv_fsub_rn(float x, float y) | __vector float __ef_vfsub_rn(__vector float x, __vector float y) | 0 | 0 |
| float __nv_fsub_ru(float x, float y) | __vector float __ef_vfsub_ru(__vector float x, __vector float y) | 1 | 1 |
| float __nv_fsub_rz(float x, float y) | __vector float __ef_vfsub_rz(__vector float x, __vector float y) | 1 | 1 |
| i32 __nv_hadd(i32 x, i32 y) | __vector int __ef_vhadd(__vector int x, __vector int y) | 0 | 0 |
| float __nv_half2float(i16 h) | __vector2 float __ef_vhalf2float(__vector unsigned short h) | 0 | 0 |
| float __nv_hypotf(float x, float y) | __vector float __ef_vhypotf(__vector float x, __vector float y) | 1 | 0 |
| i32 __nv_ilogbf(float x) | __vector int __ef_vilogbf(__vector float x) | 0 | 0 |
| float __nv_int2float_rd(i32 in) | __vector float __ef_vint2float_rd(__vector int in) | 1 | 0 |
| float __nv_int2float_rn(i32 in) | __vector float __ef_vint2float_rn(__vector int in) | 0 | 0 |
| float __nv_int2float_ru(i32 in) | __vector float __ef_vint2float_ru(__vector int in) | 1 | 0 |
| float __nv_int2float_rz(i32 in) | __vector float __ef_vint2float_rz(__vector int in) | 0 | 0 |
| float __nv_int_as_float(i32 x) | __vector float __ef_vint_as_float(__vector int x) | 0 | 0 |
| i32 __nv_isinff(float x) | __vector int __ef_visinff(__vector float x) | 0 | 0 |
| i32 __nv_isnanf(float x) | __vector int __ef_visnanf(__vector float x) | 0 | 0 |
| float __nv_j0f(float x) | __vector float __ef_vj0f(__vector float x) | 3.713700e+04 | 3.692000e+04 |
| float __nv_j1f(float x) | __vector float __ef_vj1f(__vector float x) | 8.589800e+04 | 8.523100e+04 |
| float __nv_jnf(i32 n, float x) | __vector float __ef_vjnf(int n, __vector float x) | - | - |
| float __nv_ldexpf(float x, i32 y) | __vector float __ef_vldexpf(__vector float x, __vector int y) | 0 | 0 |
| float __nv_lgammaf(float x) | __vector float __ef_vlgammaf(__vector float x) | 3.000000e+01 | 1.700000e+01 |
| float __nv_ll2float_rd(i64 l) | __vector float __ef_vll2float_rd(__vector2 long long l) | 0 | 0 |
| float __nv_ll2float_rn(i64 l) | __vector float __ef_vll2float_rn(__vector2 long long l) | 0 | 0 |
| float __nv_ll2float_ru(i64 l) | __vector float __ef_vll2float_ru(__vector2 long long l) | 0 | 0 |
| float __nv_ll2float_rz(i64 l) | __vector float __ef_vll2float_rz(__vector2 long long l) | 0 | 0 |
| i64 __nv_llabs(i64 x) | __vector long long __ef_vllabs(__vector long long x) | 0 | 0 |
| i64 __nv_llmax(i64 x, i64 y) | __vector long long __ef_vllmax(__vector long long x, <br>__vector long long y) | 0 | 0 |
| i64 __nv_llmin(i64 x, i64 y) | __vector long long __ef_vllmin(__vector long long x, <br>__vector long long y) | 0 | 0 |
| i64 __nv_llrintf(float x) | __vector2 long long __ef_vllrintf(__vector float x) | 0 | 0 |
| i64 __nv_llroundf(float x) | __vector2 long long __ef_vllroundf(__vector float x) | 0 | 0 |
| float __nv_log10f(float x) | __vector float __ef_vlog10f(__vector float x) | 2 | 2 |
| float __nv_log1pf(float x) | __vector float __ef_vlog1pf(__vector float x) | 1 | 1 |
| float __nv_log2f(float x) | __vector float __ef_vlog2f(__vector float x) | 1 | 1 |
| float __nv_logbf(float x) | __vector int __ef_vilogbf(__vector float x) | 0 | 0 |
| float __nv_logf(float x) | __vector float __ef_vlogf(__vector float x) | 1 | 1 |
| i32 __nv_max(i32 x, i32 y) | __vector int __ef_vmax(__vector int x, __vector int y) | 0 | 0 |
| i32 __nv_min(i32 x, i32 y) | __vector int __ef_vmin(__vector int x, __vector int y) | 0 | 0 |
| float __nv_modff(float x, float* y) | __vector float __ef_vmodff(__vector float x, __vector float *b) | 0 | 0 |
| i32 __nv_mul24(i32 x, i32 y) | __vector int __ef_vmul24(__vector int x, __vector int y) | 0 | 0 |
| i64 __nv_mul64hi(i64 x, i64 y) | __vector long long __ef_vmul64hi(__vector long long x, <br>__vector long long y) | 0 | 0 |
| i32 __nv_mulhi(i32 x, i32 y) | __vector int __ef_vmulhi(__vector int x, <br>__vector int y) | 0 | 0 |
| float __nv_nanf(i8* tagp) | __vector float __ef_vnanf(const char *tagp) | 0 | 0 |
| float __nv_nearbyintf(float x) | __vector float __ef_vnearbyintf(__vector float x) | 0 | 0 |
| float __nv_nextafterf(float x, float y) | __vector float __ef_vnextafterf(__vector float x, __vector float y) | 0 | 0 |
| float __nv_normcdff(float x) | __vector float __ef_vnormcdff(__vector float x) | 8.200000e+01 | 3 |
| float __nv_normcdfinvf(float x) | __vector float __ef_vnormcdfinvf(__vector float x) | 4 | 4 |
| i32 __nv_popc(i32 x) | __vector unsigned int __ef_vpopc(__vector int x) | 0 | 0 |
| i32 __nv_popcll(i64 x) | __vector unsigned long long __ef_vpopcll(__vector long long x) | 0 | 0 |
| float __nv_powf(float x, float y) | __vector float __ef_vpowf(__vector float x, __vector float y) | 5 | 2 |
| float __nv_powif(float x, i32 y) | __vector float __ef_vpowif(__vector float x, __vector int y) | 0 | 2.097152e+06 |
| float __nv_rcbrtf(float x) | __vector float __ef_vrcbrtf(__vector float x) | 2 | 2 |
| float __nv_remainderf(float x, float y) | __vector float __ef_vremainderf(__vector float x, __vector float y) | 3.402823E+38 | 0 |
| float __nv_remquof(float x, <br>float y, i32* quo) | __vector float __ef_vremquof(__vector float x, <br>__vector float y, __vector int* quo) | 3.402823E+38 | 0 |
| i32 __nv_rhadd(i32 x, i32 y) | __vector unsigned int __ef_vurhadd<br>(__vector unsigned x, __vector unsigned y) | 0 | 0 |
| float __nv_rintf(float x) | __vector float __ef_vrintf(__vector float x) | 0 | 0 |
| float __nv_roundf(float x) | __vector float __ef_vroundf(__vector float x) | 0 | 0 |
| float __nv_rsqrtf(float x) | __vector float __ef_vrsqrtf(__vector float x) | 3 | 3 |
| i32 __nv_sad(i32 x, i32 y, i32 z) | __vector unsigned __ef_vsad(__vector int x, <br>__vector int y, __vector unsigned z) | - | - |
| float __nv_saturatef(float x) | __vector float __ef_vsaturatef(__vector float x) | 0 | 0 |
| float __nv_scalbnf(float x, i32 y) | __vector float __ef_vscalbnf(__vector float x, __vector int y) | 0 | 0 |
| i32 __nv_signbitf(float x) | __vector int __ef_vsignbitf(__vector float x) | 0 | 0 |
| void __nv_sincosf(float x, <br>float*sptr, float* cptr) | void __ef_vsincosf(__vector float x, <br>__vector float *sptr, __vector float*cptr) | 2 | 1 |
| void __nv_sincospif(float x, <br>float*sptr, float* cptr) | void __ef_vsincospif(__vector float x, <br>__vector float *sptr, __vector float*cptr) | 1 | 1 |
| float __nv_sinf(float x) | __vector float __ef_vsinf(__vector float x) | 2 | 1 |
| float __nv_sinhf(float x) | __vector float __ef_vsinhf(__vector float x) | 1 | 1 |
| float __nv_sinpif(float x) | __vector float __ef_vsinpif(__vector float x) | 1 | 1 |
| float __nv_sqrtf(float x) | __vector float __ef_vsqrtf(__vector float x) | 0 | 0 |
| float __nv_tanf(float x) | __vector float __ef_vtanf(__vector float x) | 3 | 2 |
| float __nv_tanhf(float x) | __vector float __ef_vtanhf(__vector float x) | 2 | 2 |
| float __nv_tgammaf(float x) | __vector float __ef_vtgammaf(__vector float x) | 8 | 4 |
| float __nv_truncf(float x) | __vector float __ef_vtruncf(__vector float x) | 0 | 0 |
| i32 __nv_uhadd(i32 x, i32 y) | __vector unsigned __ef_vuhadd(__vector unsigned x, <br>__vector unsigned y) | 0 | 0 |
| float __nv_uint2float_rd(i32 in) | __vector float __ef_vuint2float_rd(__vector unsigned int in) | 1 | 0 |
| float __nv_uint2float_rn(i32 in) | __vector float __ef_vuint2float_rn(__vector unsigned int in) | 0 | 0 |
| float __nv_uint2float_ru(i32 in) | __vector float __ef_vuint2float_ru(__vector unsigned int in) | 1 | 0 |
| float __nv_uint2float_rz(i32 in) | __vector float __ef_vuint2float_rz(__vector unsigned int in) | 0 | 0 |
| float __nv_ull2float_rd(i64 l) | __vector float __ef_vull2float_rd(__vector2 unsigned long long l) | 0 | 0 |
| float __nv_ull2float_rn(i64 l) | __vector float __ef_vull2float_rn(__vector2 unsigned long long l) | 0 | 0 |
| float __nv_ull2float_ru(i64 l) | __vector float __ef_vull2float_ru(__vector2 unsigned long long l) | 0 | 0 |
| float __nv_ull2float_rz(i64 l) | __vector float __ef_vull2float_rz(__vector2 unsigned long long l) | 0 | 0 |
| i64 __nv_ullmax(i64 x, i64 y) | __vector unsigned long long __ef_vullmax<br>(__vector unsigned long long x, __vector unsigned long long y) | 0 | 0 |
| i64 __nv_ullmin(i64 x, i64 y) | __vector unsigned long long __ef_vullmin<br>(__vector unsigned long long x, __vector unsigned long long y) | 0 | 0 |
| i32 __nv_umax(i32 x, i32 y) | __vector unsigned int __ef_vumax<br>(__vector unsigned x, __vector unsigned y) | 0 | 0 |
| i32 __nv_umin(i32 x, i32 y) | __vector unsigned __ef_vumin<br>(__vector unsigned int x, __vector unsigned int y) | 0 | 0 |
| i32 __nv_umul24(i32 x, i32 y) | __vector unsigned int __ef_vumul24<br>(__vector unsigned x, __vector unsigned y) | 0 | 0 |
| i64 __nv_umul64hi(i64 x, i64 y) | __vector unsigned long long __ef_vumul64hi<br>(__vector unsigned long long x, __vector unsigned long long y) | 0 | 0 |
| i32 __nv_umulhi(i32 x, i32 y) | __vector unsigned int __ef_vumulhi(__vector unsigned x, <br>__vector unsigned y) | 0 | 0 |
| i32 __nv_urhadd(i32 x, i32 y) | __vector unsigned int __ef_vurhadd(__vector unsigned x, <br>__vector unsigned y) | 0 | 0 |
| i32 __nv_usad(i32 x, i32 y, i32 z) | __vector unsigned int __ef_vusad(__vector unsigned int x, <br>__vector unsigned int y, __vector unsigned int z) | - | - |
| float __nv_y0f(float x) | __vector float __ef_vy0f(__vector float x) | 2.660562e+06 | 2.856700e+04 |
| float __nv_y1f(float x) | __vector float __ef_vy1f(__vector float x) | 4.467490e+05 | 6.154800e+04 |
| float __nv_ynf(i32 n, float x) | __vector float __ef_vynf(__vector float x) | - | - |

**精度误差分析：**

从上面对比表格可以看到，大部分 API 精度与 CUDA 是保持一致的，但少部分接口精度与 CUDA 存在差异，原因有以下几点：

- 很多API CUDA 直接调硬件指令实现，我们虽然有对应的指令，但是无法与NV做到 bit 级别的 match，所以存在细微差异如：expf、logf、rcpf等接口
- 由于硬件 rounding mode 不支持导致，GCU400 部分接口只支持rn和rz，不支持ru、rd。如：__nv_fsub_ru、__nv_fsub_rd、__nv_fmul_ru、__nv_fmul_rd等接口。
- 部分接口在 cuda 实现里面使用了double进行计算，但是 gcu 上是用 float 代替，会导致精度差异。如：sinf、cosf、tanf、sincosf。

对于 msf 指令以及 rounding mode 导致的差异，在5.0上会得到支持和解决，double导致的误差需要对算法做进一步优化。

### 3.2. 接口描述

#### 3.2.1. __ef_vabs

**原型：**

```
__vector int __ef_vabs(__vector int x)
```

**描述：**

计算 32 位有符号整数 x 的绝对值。

**返回值：**

返回 32 位有符号整数 x 的绝对值。

**支持情况：**

GCU400: Yes

#### 3.2.2. __ef_vacosf

**原型：**

```
__vector float __ef_vacosf(__vector float x)
```

**描述：**

计算输入参数 x 的反余弦值的主值。

**返回值：**

- 返回值将以弧度为单位，当 x 在 [-1, +1] 范围内时，结果位于 [0, π] 区间内。
- __ef_vacosf(1) 返回 +0。
- 当 x 超出 [-1, +1] 范围时，__ef_vacosf(x) 返回 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.3. __ef_vacoshf

**原型：**

```
__vector float __ef_vacoshf(__vector float x)
```

**描述：**

计算输入参数 x 的反双曲余弦值。

**返回值：**

- 返回值将位于 [0, +∞) 区间内。
- __ef_vacoshf(1) 返回 0。
- 当 x 在 (-∞, 1) 区间内时，__ef_vacoshf(x) 返回 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.4. __ef_vasinf

**原型：**

```
__vector float __ef_vasinf(__vector float x)
```

**描述：**

计算输入参数 x 的反正弦值的主值。

**返回值：**

- 返回值将以弧度为单位，当 x 在 [-1, +1] 范围内时，结果位于 [-π/2, +π/2] 区间内。
- __ef_vasinf(0) 返回 +0。
- 当 x 超出 [-1, +1] 范围时，__ef_vasinf(x) 返回 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.5. __ef_vasinhf

**原型：**

```
__vector float __ef_vasinhf(__vector float x)
```

**描述：**

计算输入参数 x 的反双曲正弦值。

**返回值：**

__ef_vasinhf(0) 返回 0。

**支持情况：**

GCU400: Yes

#### 3.2.6. __ef_vatan2f

**原型：**

```
__vector float __ef_vatan2f(__vector float x, __vector float y)
```

**描述：**

计算输入参数 x 和 y 的比值的反正切值的主值。

**返回值：**

返回值将以弧度为单位，结果位于 [-π, +π] 区间内。

__ef_vatan2f(0, 1) 返回 +0。

**支持情况：**

GCU400: Yes

#### 3.2.7. __ef_vatanf

**原型：**

```
__vector float __ef_vatanf(__vector float x)
```

**描述：**

计算输入参数 x 的反正切值的主值。

**返回值：**

- 返回值将以弧度为单位，结果位于 [-π/2, +π/2] 区间内。
- __ef_vatanf(0) 返回 +0。

**支持情况：**

GCU400: Yes

#### 3.2.8. __ef_vatanhf

**原型：**

```
__vector float __ef_vatanhf(__vector float x)
```

**描述：**

计算输入参数 x 的反双曲正切值。

**返回值：**

- __ef_vatanhf(±0) 返回 ±0。
- __ef_vatanhf(±1) 返回 ±∞。
- 当 x 超出 [-1, +1] 范围时，__ef_vatanhf(x) 返回 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.9. __ef_vbrev

**原型：**

```
__vector unsigned int __ef_vbrev(__vector unsigned int x)
```

**描述：**

反转 32 位无符号整数 x 的二进制位顺序。

**返回值：**

返回 x 的二进制位反转后的值。

**支持情况：**

GCU400: Yes

#### 3.2.10. __ef_vbrevll

**原型：**

```
__vector unsigned long long __ef_vbrevll(__vector unsigned long long x)
```

**描述：**

反转 64 位无符号整数 x 的二进制位顺序。

**返回值：**

返回 x 的二进制位反转后的值。

**支持情况：**

GCU400: Yes

#### 3.2.11. __ef_vbyte_perm

**原型：**

```
__vector unsigned int __ef_vbyte_perm(__vector unsigned int x, __vector unsigned int y, __vector unsigned int z)
```

**描述：**

__ef_vbyte_perm(x, y, s) 返回一个由输入整数 x 和 y 的 8 个字节中的 4 个字节组成的 32 位整数，具体选择由选择器 s 决定。

**返回值：**

返回值由选择器 s 指定的字节组成。

**支持情况：**

GCU400: Yes

#### 3.2.12. __ef_vcbrtf

**原型：**

```
__vector float __ef_vcbrtf(__vector float x)
```

**描述：**

计算输入参数 x 的立方根。

**返回值：**

返回 x 的立方根。

**支持情况：**

GCU400: Yes

#### 3.2.13. __ef_vceilf

**原型：**

```
__vector float __ef_vceilf(__vector float x)
```

**描述：**

计算不小于 x 的最小整数值。

**返回值：**

返回不小于 x 的最小整数值。

**支持情况：**

GCU400: Yes

#### 3.2.14. __ef_vclz

**原型：**

```
__vector unsigned int __ef_vclz(__vector unsigned int x)
```

**描述：**

计算 32 位整数 x 中最高位的连续零的数量。

**返回值：**

返回 x 中最高位的连续零的数量。

**支持情况：**

GCU400: Yes

#### 3.2.15. __ef_vclzll

**原型：**

```
__vector unsigned long long __ef_vclzll(__vector unsigned long long x)
```

**描述：**

计算 64 位整数 x 中最高位的连续零的数量。

**返回值：**

返回 x 中最高位的连续零的数量。

**支持情况：**

GCU400: Yes

#### 3.2.16. __ef_vcopysignf

**原型：**

```
__vector float __ef_vcopysignf(__vector float x, __vector float y)
```

**描述：**

创建一个浮点数，其绝对值为 x，符号为 y。

**返回值：**

返回一个绝对值为 x 且符号为 y 的值。

**支持情况：**

GCU400: Yes

#### 3.2.17. __ef_vcosf

**原型：**

```
__vector float __ef_vcosf(__vector float x)
```

**描述：**

计算输入参数 x（以弧度为单位）的余弦值。

**返回值：**

__ef_vcosf(±∞) 返回 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.18. __ef_vcoshf

**原型：**

```
__vector float __ef_vcoshf(__vector float x)
```

**描述：**

计算输入参数 x 的双曲余弦值。

**返回值：**

__ef_vcoshf(0) 返回 1。

__ef_vcoshf(±∞) 返回 +∞。

**支持情况：**

GCU400: Yes

#### 3.2.19. __ef_vcospif

**原型：**

```
__vector float __ef_vcospif(__vector float x)
```

**描述：**

计算输入参数 x（以 π 为单位）的余弦值。

**返回值：**

__ef_vcospif(±∞) 返回 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.20. __ef_verfcf

**原型：**

```
__vector float __ef_verfcf(__vector float x)
```

**描述：**

计算输入参数 x 的互补误差函数值，即 1 - erf(x)。

**返回值：**

- __ef_verfcf(±0) 返回 1。
- __ef_verfcf(±∞) 返回 0。

**支持情况：**

GCU400: Yes

#### 3.2.21. __ef_verfcinvf

**原型：**

```
__vector float __ef_verfcinvf(__vector float x)
```

**描述：**

计算输入参数 y 的逆互补误差函数值，即满足 y = erfc(x) 的 x 值，其中 y 在 [0, 2] 区间内。

**返回值：**

- __ef_verfcinvf(0) 返回 +∞。
- __ef_verfcinvf(2) 返回 -∞。

**支持情况：**

GCU400: Yes

#### 3.2.22. __ef_verfcxf

**原型：**

```
__vector float __ef_verfcxf(__vector float x)
```

**描述：**

计算输入参数 x 的缩放互补误差函数值，即 exp(x^2) * erfc(x)。

**返回值：**

- __ef_verfcxf(±0) 返回 1。
- __ef_verfcxf(±∞) 返回 +0。
- 如果正确计算的结果超出双精度浮点范围，__ef_verfcxf(x) 返回 +∞。

**支持情况：**

GCU400: Yes

#### 3.2.23. __ef_verff

**原型：**

```
__vector float __ef_verff(__vector float x)
```

**描述：**

计算输入参数 x 的误差函数值。

**返回值：**

- __ef_verff(±0) 返回 ±0。
- __ef_verff(±∞) 返回 ±1。

**支持情况：**

GCU400: Yes

#### 3.2.24. __ef_verfinvf

**原型：**

```
__vector float __ef_verfinvf(__vector float x)
```

**描述：**

计算输入参数 y 的逆误差函数值，即满足 y = erf(x) 的 x 值，其中 y 在 [-1, 1] 区间内。

**返回值：**

- __ef_verfinvf(1) 返回 +∞。
- __ef_verfinvf(-1) 返回 -∞。

**支持情况：**

GCU400: Yes

#### 3.2.25. __ef_vexp10f

**原型：**

```
__vector float __ef_vexp10f(__vector float x)
```

**描述：**

计算输入参数 x 的 10 的指数值，即 10^x。

**返回值：**

返回 10^x。

**支持情况：**

GCU400: Yes

#### 3.2.26. __ef_vexp2f

**原型：**

```
__vector float __ef_vexp2f(__vector float x)
```

**描述：**

计算输入参数 x 的 2 的指数值，即 2^x。
**返回值：**

返回 2^x。

**支持情况：**

GCU400: Yes

#### 3.2.27. __ef_vexpf

**原型：**

```
__vector float __ef_vexpf(__vector float x)
```

**描述：**

计算输入参数 x 的指数值，即 e^x。

**返回值：**

返回 e^x。

**支持情况：**

GCU400: Yes

#### 3.2.28. __ef_vexpm1f

**原型：**

```
__vector float __ef_vexpm1f(__vector float x)
```

**描述：**

计算输入参数 x 的指数值减 1，即 e^x - 1。

**返回值：**

返回 e^x - 1。

**支持情况：**

GCU400: Yes

#### 3.2.29. __ef_vfabsf

**原型：**

```
__vector float __ef_vfabsf(__vector float f)
```

**描述：**

计算输入参数 x 的绝对值。

**返回值：**

- 返回输入参数的绝对值。
- __ef_vfabsf(±∞) 返回 +∞。
- __ef_vfabsf(±0) 返回 +0。

**支持情况：**

GCU400: Yes

#### 3.2.30. __ef_vfadd_rd

**原型：**

```
__vector float __ef_vfadd_rd(__vector float x, __vector float y)
```

**描述：**

以向下舍入（向负无穷）模式计算 x 和 y 的和。

**返回值：**

- 返回 x + y。
- 此操作不会合并为单个乘加指令。

**支持情况：**

GCU400: Yes

#### 3.2.31. __ef_vfadd_rn

**原型：**

```
__vector float __ef_vfadd_rn(__vector float x, __vector float y)
```

**描述：**

以舍入到最近偶数模式计算 x 和 y 的和。

**返回值：**

- 返回 x + y。
- 此操作不会合并为单个乘加指令。

**支持情况：**

GCU400: Yes

#### 3.2.32. __ef_vfadd_ru

**原型：**

```
__vector float __ef_vfadd_ru(__vector float x, __vector float y)
```

**描述：**

以向上舍入（向正无穷）模式计算 x 和 y 的和。

**返回值：**

- 返回 x + y。
- 此操作不会合并为单个乘加指令。

**支持情况：**

GCU400: Yes

#### 3.2.33. __ef_vfadd_rz

**原型：**

```
__vector float __ef_vfadd_rz(__vector float x, __vector float y)
```

**描述：**

以向零舍入模式计算 x 和 y 的和。

**返回值：**

- 返回 x + y。
- 此操作不会合并为单个乘加指令。

**支持情况：**

GCU400: Yes

#### 3.2.34. __ef_fast_vcosf

**原型：**

```
__vector float __ef_fast_vcosf(__vector float x)
```

**描述：**

计算输入参数 x（以弧度为单位）的快速近似余弦值。

**返回值：**

- 返回 x 的近似余弦值。
- 输入和输出在非正规范围内将被flushed 到有符号的0.0。

**支持情况：**

GCU400: Yes

#### 3.2.35. __ef_fast_vexp10f

**原型：**

```
__vector float __ef_fast_vexp10f(__vector float x)
```

**描述：**

计算输入参数 x 的 10 的快速近似指数值，即 10^x。

**返回值：**

- 返回 10^x 的近似值。
- 大多数输入和输出值在非正规范围内将被flushed 到有符号的0.0。

**支持情况：**

GCU400: Yes

#### 3.2.36. __ef_fast_vexpf

**原型：**

```
__vector float __ef_fast_vexpf(__vector float x)
```

**描述：**

计算输入参数 x 的快速近似指数值，即 e^x。

**返回值：**

- 返回 e^x 的近似值。
- 大多数输入和输出值在非正规范围内将被flushed 到有符号的0.0。

**支持情况：**

GCU400: Yes

#### 3.2.37. __ef_fast_vfdividef

**原型：**

```
__vector float __ef_fast_vfdividef(__vector float x, __vector float y)
```

**描述：**

计算 x 除以 y 的快速近似值。

**返回值：**

- 返回 x / y。
- __ef_fast_vfdividef(±∞, y) 返回 NaN，如果 y = 0。
- __ef_fast_vfdividef(x, y) 返回 0，如果 x = ±0 且 y = ±0。

**支持情况：**

GCU400: Yes

#### 3.2.38. __ef_fast_vlog10f

**原型：**

```
__vector float __ef_fast_vlog10f(__vector float x)
```

**描述：**

计算输入参数 x 的快速近似以 10 为底的对数值。

**返回值：**

- 返回以 10 为底的 x 的对数的近似值。
- 大多数输入和输出值在非正规范围内将被flushed 到有符号的0.0。

**支持情况：**

GCU400: Yes

#### 3.2.39. __ef_fast_vlog2f

**原型：**

```
__vector float __ef_fast_vlog2f(__vector float x)
```

**描述：**

计算输入参数 x 的快速近似以 2 为底的对数值。

**返回值：**

- 返回以 2 为底的 x 的对数的近似值。
- 输入和输出在非正规范围内将被flushed 到有符号的0.0。

**支持情况：**

GCU400: Yes

#### 3.2.40. __ef_fast_vlogf

**原型：**

```
__vector float __ef_fast_vlogf(__vector float x)
```

**描述：**

计算输入参数 x 的快速近似自然对数值。

**返回值：**

- 返回 x 的自然对数的近似值。
- 大多数输入和输出值在非正规范围内将被flushed 到有符号的0.0。

**支持情况：**

GCU400: Yes

#### 3.2.41. __ef_fast_vpowf

**原型：**

```
__vector float __ef_fast_vpowf(__vector float x, __vector float y)
```

**描述：**

计算输入参数 x 的 y 次幂的快速近似值。

**返回值：**

- 返回 x^y 的近似值。
- 大多数输入和输出值在非正规范围内将被flushed 到有符号的0.0。

**支持情况：**

GCU400: Yes

#### 3.2.42. __ef_fast_vsincosf

**原型：**

```
void __ef_fast_vsincosf(__vector float x, __vector float* sptr, __vector float* cptr)
```

**描述：**

计算输入参数 x（以弧度为单位）的正弦和余弦的快速近似值。正弦和余弦的结果分别写入第二个参数 sptr 和第三个参数 cptr。

**返回值：**

- 无返回值。
- 非正规输入/输出将被flushed 到有符号的0.0。

**支持情况：**

GCU400: Yes

#### 3.2.43. __ef_fast_vsinf

**原型：**

```
__vector float __ef_fast_vsinf(__vector float x)
```

**描述：**

计算输入参数 x（以弧度为单位）的快速近似正弦值。

**返回值：**

- 返回 x 的近似正弦值。
- 输入和输出在非正规范围内将被flushed 到有符号的0.0。

**支持情况：**

GCU400: Yes

#### 3.2.44. __ef_fast_vtanf

**原型：**

```
__vector float __ef_fast_vtanf(__vector float x)
```

**描述：**

计算输入参数 x（以弧度为单位）的快速近似正切值。

**返回值：**

- 返回 x 的近似正切值。
- 计算结果是通过 __ef_fast_vsinf 除以 __ef_fast_vcosf 得到的。非正规输入和输出在每一步计算中都会被flushed 到有符号的0.0。

**支持情况：**

GCU400: Yes

#### 3.2.45. __ef_vfdimf

**原型：**

```
__vector float __ef_vfdimf(__vector float x, __vector float y)
```

**描述：**

计算 x 和 y 的正值差。如果 x > y，则结果为 x - y，否则为 +0。

**返回值：**

- 如果 x > y，返回 x - y。
- 如果 x ≤ y，返回 +0。

**支持情况：**

GCU400: Yes

#### 3.2.46. __ef_vfdiv_rd

**原型：**

```
__vector float __ef_vfdiv_rd(__vector float x, __vector float y)
```

**描述：**

以向下舍入（向负无穷）模式计算 x 除以 y。

**返回值：**

返回 x / y。

**支持情况：**

GCU400: Yes

#### 3.2.47. __ef_vfdiv_rn

**原型：**

```
__vector float __ef_vfdiv_rn(__vector float x, __vector float y)
```

**描述：**

以舍入到最近偶数模式计算 x 除以 y。

**返回值：**

返回 x / y。

**支持情况：**

GCU400: Yes

#### 3.2.48. __ef_vfdiv_ru

**原型：**

```
__vector float __ef_vfdiv_ru(__vector float x, __vector float y)
```

**描述：**

以向上舍入（向正无穷）模式计算 x 除以 y。

**返回值：**

返回 x / y。

**支持情况：**

GCU400: Yes

#### 3.2.49. __ef_vfdiv_rz

**原型：**

```
__vector float __ef_vfdiv_rz(__vector float x, __vector float y)
```

**描述：**

以向零舍入模式计算 x 除以 y。

**返回值：**

返回 x / y。

**支持情况：**

GCU400: Yes

#### 3.2.50. __ef_vffs

**原型：**

```
__vector int __ef_vffs(__vector int x)
```

**描述：**

查找 x 中第一个（最不显著）被设置为 1 的位的位置，最不显著位的位置为 1。

**返回值：**

- 返回一个介于 0 和 32 之间（含）的值，表示第一个被设置为1的位置。
- __ef_vffs(0) 返回 0。

**支持情况：**

GCU400: Yes

#### 3.2.51. __ef_vffsll

**原型：**

```
__vector unsigned long long __ef_vffsll(__vector long long x)
```

**描述：**

查找 x 中第一个（最不显著）被设置为 1 的位的位置，最不显著位的位置为 1。

**返回值：**

- 返回一个介于 0 和 64 之间（含）的值，表示第一个被设置的位的位置。
- __ef_vffsll(0) 返回 0。
- 返回值类型为__vector unsigned long long，这与vector数据宽度有关，而__nv_ffsll 返回i32，这里无法与NV保持一致。

**支持情况：**

GCU400: Yes

#### 3.2.52. __ef_vfinitef

**原型：**

```
__vector int __ef_vfinitef(__vector float x)
```

**描述：**

判断浮点值 x 是否为有限值。

**返回值：**

如果 x 是有限值，则返回非零值。

**支持情况：**

GCU400: Yes

#### 3.2.53. __ef_vfloat2half_rn

**原型：**

```
__vector unsigned short __ef_vfloat2half_rn(__vector2 float f)
```

**描述：**

将单精度浮点值 x 转换为半精度浮点值，表示为无符号短整数格式，采用舍入到最近偶数模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.54. __ef_vfloat2int_rd

**原型：**

```
__vector int __ef_vfloat2int_rd(__vector float in)
```

**描述：**

将单精度浮点值 x 转换为有符号整数，采用向下舍入（向负无穷）模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.55. __ef_vfloat2int_rn

**原型：**

```
__vector int __ef_vfloat2int_rn(__vector float in)
```

**描述：**

将单精度浮点值 x 转换为有符号整数，采用舍入到最近偶数模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.56. __ef_vfloat2int_ru

**原型：**

```
__vector int __ef_vfloat2int_ru(__vector float in)
```

**描述：**

将单精度浮点值 x 转换为有符号整数，采用向上舍入（向正无穷）模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.57. __ef_vfloat2int_rz

**原型：**

```
__vector int __ef_vfloat2int_rz(__vector float in)
```

**描述：**

将单精度浮点值 x 转换为有符号整数，采用向零舍入模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.58. __ef_vfloat2ll_rd

**原型：**

```
__vector2 long long __ef_vfloat2ll_rd(__vector float f)
```

**描述：**

将单精度浮点值 x 转换为 64 位有符号整数，采用向下舍入（向负无穷）模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.59. __ef_vfloat2ll_rn

**原型：**

```
__vector2 long long __ef_vfloat2ll_rn(__vector float f)
```

**描述：**

将单精度浮点值 x 转换为 64 位有符号整数，采用舍入到最近偶数模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.60. __ef_vfloat2ll_ru

**原型：**

```
__vector2 long long __ef_vfloat2ll_ru(__vector float f)
```

**描述：**

将单精度浮点值 x 转换为 64 位有符号整数，采用向上舍入（向正无穷）模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.61. __ef_vfloat2ll_rz

**原型：**

```
__vector2 long long __ef_vfloat2ll_rz(__vector float f)
```

**描述：**

将单精度浮点值 x 转换为 64 位有符号整数，采用向零舍入模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.62. __ef_vfloat2uint_rd

**原型：**

```
__vector unsigned int __ef_vfloat2uint_rd(__vector float in)
```

**描述：**

将单精度浮点值 x 转换为无符号整数，采用向下舍入（向负无穷）模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.63. __ef_vfloat2uint_rn

**原型：**

```
__vector unsigned int __ef_vfloat2uint_rn(__vector float in)
```

**描述：**

将单精度浮点值 x 转换为无符号整数，采用舍入到最近偶数模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.64. __ef_vfloat2uint_ru

**原型：**

```
__vector unsigned int __ef_vfloat2uint_ru(__vector float in)
```

**描述：**

将单精度浮点值 x 转换为无符号整数，采用向上舍入（向正无穷）模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.65. __ef_vfloat2uint_rz

**原型：**

```
__vector unsigned int __ef_vfloat2uint_rz(__vector float in)
```

**描述：**

将单精度浮点值 x 转换为无符号整数，采用向零舍入模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.66. __ef_vfloat2ull_rd

**原型：**

```
__vector2 unsigned long long __ef_vfloat2ull_rd(__vector float f)
```

**描述：**

将单精度浮点值 x 转换为 64 位无符号整数，采用向下舍入（向负无穷）模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.67. __ef_vfloat2ull_rn

**原型：**

```
__vector2 unsigned long long __ef_vfloat2ull_rn(__vector float f)
```

**描述：**

将单精度浮点值 x 转换为 64 位无符号整数，采用舍入到最近偶数模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.68. __ef_vfloat2ull_ru

**原型：**

```
__vector2 unsigned long long __ef_vfloat2ull_ru(__vector float f)
```

**描述：**

将单精度浮点值 x 转换为 64 位无符号整数，采用向上舍入（向正无穷）模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.69. __ef_vfloat2ull_rz

**原型：**

```
__vector2 unsigned long long __ef_vfloat2ull_rz(__vector float f)
```

**描述：**

将单精度浮点值 x 转换为 64 位无符号整数，采用向零舍入模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.70. __ef_vfloat_as_int

**原型：**

```
__vector int __ef_vfloat_as_int(__vector float x)
```

**描述：**

将单精度浮点值 x 的位重新解释为有符号整数。

**返回值：**

返回重新解释后的值。

**支持情况：**

GCU400: Yes

#### 3.2.71. __ef_vfloorf

**原型：**

```
__vector float __ef_vfloorf(__vector float f)
```

**描述：**

计算不大于 x 的最大整数值。

**返回值：**

- 返回不大于 x 的最大整数值。
- __ef_vfloorf(±∞) 返回 ±∞。
- __ef_vfloorf(±0) 返回 ±0。

**支持情况：**

GCU400: Yes

#### 3.2.72. __ef_vfmaf

**原型：**

```
__vector float __ef_vfmaf(__vector float x, __vector float y, __vector float z)
```

**描述：**

计算 x * y + z 的值，作为一个单一的三元操作。计算结果后，值将被舍入一次。

**返回值：**

- 返回 x * y + z 的舍入值。
- __ef_vfmaf(±∞, ±∞, z) 返回 NaN。
- __ef_vfmaf(±∞, ±0, z) 返回 NaN。
- __ef_vfmaf(x, y, ±∞) 返回 NaN，如果 z 是精确的 ±∞。
- __ef_vfmaf(x, y, NaN) 返回 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.73. __ef_vfmaf_rd

**原型：**

```
__vector float __ef_vfmaf_rd(__vector float x, __vector float y, __vector float z)
```

**描述：**

计算 x * y + z 的值，作为一个单一的三元操作，结果以向下舍入（向负无穷）模式舍入一次。

**返回值：**

- 返回 x * y + z 的舍入值。
- __ef_vfmaf_rd(±∞, ±∞, z) 返回 NaN。
- __ef_vfmaf_rd(±∞, ±0, z) 返回 NaN。
- __ef_vfmaf_rd(x, y, ±∞) 返回 NaN，如果 z 是精确的 ±∞。
- __ef_vfmaf_rd(x, y, NaN) 返回 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.74. __ef_vfmaf_rn

**原型：**

```
__vector float __ef_vfmaf_rn(__vector float x, __vector float y, __vector float z)
```

**描述：**

计算 x * y + z 的值，作为一个单一的三元操作，结果以舍入到最近偶数模式舍入一次。

**返回值：**

- 返回 x * y + z 的舍入值。
- __ef_vfmaf_rn(±∞, ±∞, z) 返回 NaN。
- __ef_vfmaf_rn(±∞, ±0, z) 返回 NaN。
- __ef_vfmaf_rn(x, y, ±∞) 返回 NaN，如果 z 是精确的 ±∞。
- __ef_vfmaf_rn(x, y, NaN) 返回 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.75. __ef_vfmaf_ru

**原型：**

```
__vector float __ef_vfmaf_ru(__vector float x, __vector float y, __vector float z)
```

**描述：**

计算 x * y + z 的值，作为一个单一的三元操作，结果以向上舍入（向正无穷）模式舍入一次。

**返回值：**

- 返回 x * y + z 的舍入值。
- __ef_vfmaf_ru(±∞, ±∞, z) 返回 NaN。
- __ef_vfmaf_ru(±∞, ±0, z) 返回 NaN。
- __ef_vfmaf_ru(x, y, ±∞) 返回 NaN，如果 z 是精确的 ±∞。
- __ef_vfmaf_ru(x, y, NaN) 返回 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.76. __ef_vfmaf_rz

**原型：**

```
__vector float __ef_vfmaf_rz(__vector float x, __vector float y, __vector float z)
```

**描述：**

计算 x * y + z 的值，作为一个单一的三元操作，结果以向零舍入模式舍入一次。

**返回值：**

- 返回 x * y + z 的舍入值。
- __ef_vfmaf_rz(±∞, ±∞, z) 返回 NaN。
- __ef_vfmaf_rz(±∞, ±0, z) 返回 NaN
- __ef_vfmaf_rz(x, y, ±∞) 返回 NaN，如果 z 是精确的 ±∞。
- __ef_vfmaf_rz(x, y, NaN) 返回 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.77. __ef_vfmaxf

**原型：**

```
__vector float __ef_vfmaxf(__vector float x, __vector float y)
```

**描述：**

确定两个参数 x 和 y 的最大数值。将 NaN 参数视为缺失数据。如果一个参数是 NaN，而另一个是合法的数值，则选择数值参数。

**返回值：**

- 返回 x 和 y 的最大数值。
- 如果两个参数都是 NaN，返回 NaN。
- 如果一个参数是 NaN，返回另外一个参数。

**支持情况：**

GCU400: Yes

#### 3.2.78. __ef_vfminf

**原型：**

```
__vector float __ef_vfminf(__vector float x, __vector float y)
```

**描述：**

确定两个参数 x 和 y 的最小数值。将 NaN 参数视为缺失数据。如果一个参数是 NaN，而另一个是合法的数值，则选择数值参数。

**返回值：**

- 返回 x 和 y 的最小数值。
- 如果两个参数都是 NaN，返回 NaN。
- 如果一个参数是 NaN，返回另外一个参数。

**支持情况：**

GCU400: Yes

#### 3.2.79. __ef_vfmodf

**原型：**

```
__vector float __ef_vfmodf(__vector float x, __vector float y)
```

**描述：**

计算 x / y 的浮点余数。计算结果的绝对值总是小于 y 的绝对值，并且与 x 具有相同的符号。

**返回值：**

- 返回 x / y 的浮点余数。
- __ef_vfmodf(±∞, y) 返回 NaN，如果 y 不是零。
- __ef_vfmodf(x, y) 返回 NaN 并引发无效浮点异常，如果 x 是 NaN 或 y 是零。
- __ef_vfmodf(x, y) 返回零，如果 y 是零或结果会溢出。
- __ef_vfmodf(x, ±∞) 返回 x，如果 x 是有限值。
- __ef_vfmodf(x, 0) 返回 NaN。

**Warning:**

- 由于 GCU400 rounding mode 不支持动态设置，该算法实现关键位置要求 MAC 运算舍入方式在rz和rn间动态切换，所以导致部分数据存在精度异常。 影响范围: |x| < |y| 或 |x| >= 2^23*|y|

**支持情况：**

GCU400: Yes

#### 3.2.80. __ef_vfmul_rd

**原型：**

```
__vector float __ef_vfmul_rd(__vector float x, __vector float y)
```

**描述：**

以向下舍入（向负无穷）模式计算 x 和 y 的乘积。

**返回值：**

- 返回 x * y。
- 此操作不会合并为单个乘加指令。

**支持情况：**

GCU400: Yes

#### 3.2.81. __ef_vfmul_rn

**原型：**

```
__vector float __ef_vfmul_rn(__vector float x, __vector float y)
```

**描述：**

以舍入到最近偶数模式计算 x 和 y 的乘积。

**返回值：**

- 返回 x * y。
- 此操作不会合并为单个乘加指令。

**支持情况：**

GCU400: Yes

#### 3.2.82. __ef_vfmul_ru

**原型：**

```
__vector float __ef_vfmul_ru(__vector float x, __vector float y)
```

**描述：**

以向上舍入（向正无穷）模式计算 x 和 y 的乘积。

**返回值：**

- 返回 x * y。
- 此操作不会合并为单个乘加指令。

**支持情况：**

GCU400: Yes

#### 3.2.83. __ef_vfmul_rz

**原型：**

```
__vector float __ef_vfmul_rz(__vector float x, __vector float y)
```

**描述：**

以向零舍入模式计算 x 和 y 的乘积。

**返回值：**

- 返回 x * y。
- 此操作不会合并为单个乘加指令。

**支持情况：**

GCU400: Yes

#### 3.2.84. __ef_vfrcp_rd

**原型：**

```
__vector float __ef_vfrcp_rd(__vector float x)
```

**描述：**

以向下舍入（向负无穷）模式计算 x 的倒数。

**返回值：**

返回 x 的倒数。

**支持情况：**

GCU400: Yes

#### 3.2.85. __ef_vfrcp_rn

**原型：**

```
__vector float __ef_vfrcp_rn(__vector float x)
```

**描述：**

以舍入到最近偶数模式计算 x 的倒数。

**返回值：**

返回 x 的倒数。

**支持情况：**

GCU400: Yes

#### 3.2.86. __ef_vfrcp_ru

**原型：**

```
__vector float __ef_vfrcp_ru(__vector float x)
```

**描述：**

以向上舍入（向正无穷）模式计算 x 的倒数。

**返回值：**

返回 x 的倒数。

**支持情况：**

GCU400: Yes

#### 3.2.87. __ef_vfrcp_rz

**原型：**

```
__vector float __ef_vfrcp_rz(__vector float x)
```

**描述：**

以向零舍入模式计算 x 的倒数。

**返回值：**

返回 x 的倒数。

**支持情况：**

GCU400: Yes

#### 3.2.88. __ef_vfrexpf

**原型：**

```
__vector float __ef_vfrexpf(__vector float x, __vector int* b)
```

**描述：**

将浮点值 x 分解为归一化小数部分 m 和指数部分 n。小数部分 m 的绝对值将大于等于 0.5 且小于 1.0，或者等于 0；指数部分 n 将存储在指针 nptr 指向的位置。

**返回值：**

- 返回小数部分 m。
- __ef_vfrexpf(0, nptr) 返回 0，小数部分为 0，整数部分为零。
- __ef_vfrexpf(±∞, nptr) 返回 ±∞，并将零存储在 nptr 指向的位置。
- __ef_vfrexpf(±0, nptr) 返回 ±0，并将零存储在 nptr 指向的位置。
- __ef_vfrexpf(NaN, nptr) 返回 NaN，并在 nptr 指向的位置存储未指定的值。

**支持情况：**

GCU400: Yes

#### 3.2.89. __ef_vfrsqrt_rn

**原型：**

```
__vector float __ef_vfrsqrt_rn(__vector float x)
```

**描述：**

以舍入到最近偶数模式计算 x 的倒数平方根。

**返回值：**

返回 x 的倒数平方根。

**支持情况：**

GCU400: Yes

#### 3.2.90. __ef_vfsqrt_rd

**原型：**

```
__vector float __ef_vfsqrt_rd(__vector float x)
```

**描述：**

以向下舍入（向负无穷）模式计算 x 的平方根。

**返回值：**

返回 x 的平方根。

**支持情况：**

GCU400: Yes

#### 3.2.91. __ef_vfsqrt_rn

**原型：**

```
__vector float __ef_vfsqrt_rn(__vector float x)
```

**描述：**

以舍入到最近偶数模式计算 x 的平方根。

**返回值：**

返回 x 的平方根。

**支持情况：**

GCU400: Yes

#### 3.2.92. __ef_vfsqrt_ru

**原型：**

```
__vector float __ef_vfsqrt_ru(__vector float x)
```

**描述：**

以向上舍入（向正无穷）模式计算 x 的平方根。

**返回值：**

返回 x 的平方根。

**支持情况：**

GCU400: Yes

#### 3.2.93. __ef_vfsqrt_rz

**原型：**

```
__vector float __ef_vfsqrt_rz(__vector float x)
```

**描述：**

以向零舍入模式计算 x 的平方根。

**返回值：**

返回 x 的平方根。

**支持情况：**

GCU400: Yes

#### 3.2.94. __ef_vfsub_rd

**原型：**

```
__vector float __ef_vfsub_rd(__vector float x, __vector float y)
```

**描述：**

以向下舍入（向负无穷）模式计算 x 和 y 的差值。

**返回值：**

- 返回 x - y。
- 此操作不会合并为单个乘加指令。

**支持情况：**

GCU400: Yes

#### 3.2.95. __ef_vfsub_rn

**原型：**

```
__vector float __ef_vfsub_rn(__vector float x, __vector float y)
```

**描述：**

以舍入到最近偶数模式计算 x 和 y 的差值。

**返回值：**

- 返回 x - y。
- 此操作不会合并为单个乘加指令。

**支持情况：**

GCU400: Yes

#### 3.2.96. __ef_vfsub_ru

**原型：**

```
__vector float __ef_vfsub_ru(__vector float x, __vector float y)
```

**描述：**

以向上舍入（向正无穷）模式计算 x 和 y 的差值。

**返回值：**

- 返回 x - y。
- 此操作不会合并为单个乘加指令。

**支持情况：**

GCU400: Yes

#### 3.2.97. __ef_vfsub_rz

**原型：**

```
__vector float __ef_vfsub_rz(__vector float x, __vector float y)
```

**描述：**

以向零舍入模式计算 x 和 y 的差值。

**返回值：**

- x - y。
- 此操作不会合并为单个乘加指令。

**支持情况：**

GCU400: Yes

#### 3.2.98. __ef_vhadd

**原型：**

```
__vector int __ef_vhadd(__vector int x, __vector int y)
```

**描述：**

计算两个有符号输入参数 x 和 y 的平均值，计算公式为 (x + y) >> 1，避免中间和的溢出。

**返回值：**

返回一个有符号整数值，表示两个输入的有符号平均值。

**支持情况：**

GCU400: Yes

#### 3.2.99. __ef_vhalf2float

**原型：**

```
__vector2 float __ef_vhalf2float(__vector unsigned short h)
```

**描述：**

将半精度浮点值 x（以无符号短整数格式表示）转换为单精度浮点值。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.100. __ef_vhypotf

**原型：**

```
__vector float __ef_vhypotf(__vector float x, __vector float y)
```

**描述：**

计算直角三角形的斜边长度，其两条直角边的长度分别为 x 和 y，避免不必要的溢出或下溢。

**返回值：**

- 返回斜边的长度。
- 如果正确值会溢出，返回 +∞。
- 如果正确值会下溢，返回 0。
- 如果其中一个输入参数为 0，返回另一个参数的值。

**支持情况：**

GCU400: Yes

#### 3.2.101. __ef_vilogbf

**原型：**

```
__vector int __ef_vilogbf(__vector float x)
```

**描述：**

计算输入参数 x 的无偏指数。

**返回值：**

- 如果成功，返回 x 的无偏指数。
- __ef_vilogbf(0) 返回 INT_MIN。
- __ef_vilogbf(NaN) 返回 NaN。
- __ef_vilogbf(x) 返回 INT_MAX，如果 x 是 ±∞ 或正确值大于 INT_MAX。
- __ef_vilogbf(x) 返回 INT_MIN，如果正确值小于 INT_MIN。

**支持情况：**

GCU400: Yes

#### 3.2.102. __ef_vint2float_rd

**原型：**

```
__vector float __ef_vint2float_rd(__vector int in)
```

**描述：**

将有符号整数值 x 转换为单精度浮点值，采用向下舍入（向负无穷）模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.103. __ef_vint2float_rn

**原型：**

```
__vector float __ef_vint2float_rn(__vector int in)
```

**描述：**

将有符号整数值 x 转换为单精度浮点值，采用舍入到最近偶数模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.104. __ef_vint2float_ru

**原型：**

```
__vector float __ef_vint2float_ru(__vector int in)
```

**描述：**

将有符号整数值 x 转换为单精度浮点值，采用向上舍入（向正无穷）模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.105. __ef_vint2float_rz

**原型：**

```
__vector float __ef_vint2float_rz(__vector int in)
```

**描述：**

将有符号整数值 x 转换为单精度浮点值，采用向零舍入模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.106. __ef_vint_as_float

**原型：**

```
__vector float __ef_vint_as_float(__vector int x)
```

**描述：**

将有符号整数值 x 的位重新解释为单精度浮点值。

**返回值：**

返回重新解释后的值。

**支持情况：**

GCU400: Yes

#### 3.2.107. __ef_visinff

**原型：**

```
__vector int __ef_visinff(__vector float x)
```

**描述：**

判断浮点值 x 是否为无穷大（正或负）。

**返回值：**

如果 x 是无穷大，则返回非零值。

**支持情况：**

GCU400: Yes

#### 3.2.108. __ef_visnanf

**原型：**

```
__vector int __ef_visnanf(__vector float x)
```

**描述：**

判断浮点值 x 是否为 NaN。

**返回值：**

如果 x 是 NaN，则返回非零值。

**支持情况：**

GCU400: Yes

#### 3.2.109. __ef_vj0f

**原型：**

```
__vector float __ef_vj0f(__vector float x)
```

**描述：**

计算输入参数 x 的第一类零阶贝塞尔函数值。

**返回值：**

- 返回第一类零阶贝塞尔函数的值。
- __ef_vj0f(±∞) 返回 +0。
- __ef_vj0f(NaN) 返回 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.110. __ef_vj1f

**原型：**

```
__vector float __ef_vj1f(__vector float x)
```

**描述：**

计算输入参数 x 的第一类一阶贝塞尔函数值。

**返回值：**

- 返回第一类一阶贝塞尔函数的值。
- __ef_vj1f(±∞) 返回 +0。
- __ef_vj1f(NaN) 返回 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.111. __ef_vjnf

**原型：**

```
__vector float __ef_vjnf(__vector int n, __vector float x)
```

**描述：**

计算输入参数 x 的第一类 n 阶贝塞尔函数值。

**返回值：**

- 返回第一类 n 阶贝塞尔函数的值。
- __ef_vjnf(n, NaN) 返回 NaN。
- __ef_vjnf(n, x) 返回 NaN，如果 n < 0。
- __ef_vjnf(n, ±∞) 返回 +0。

**支持情况：**

GCU400: Yes

#### 3.2.112. __ef_vldexpf

**原型：**

```
__vector float __ef_vldexpf(__vector float x, __vector int y)
```

**描述：**

计算输入参数 x 和 exp 的值，即 x * 2^exp。

**返回值：**

如果正确计算的值超出双精度浮点范围，返回 ±∞。

**支持情况：**

GCU400: Yes

#### 3.2.113. __ef_vlgammaf

**原型：**

```
__vector float __ef_vlgammaf(__vector float x)
```

**描述：**

计算输入参数 x 的伽玛函数绝对值的自然对数。

**返回值：**

- __ef_vlgammaf(1) 返回 +0。
- __ef_vlgammaf(2) 返回 +0。
- __ef_vlgammaf(x) 返回 ±∞，如果正确计算的值超出双精度浮点范围。
- __ef_vlgammaf(x) 返回 ±∞，如果 x < 0。
- __ef_vlgammaf(+infty) 返回 +∞。
- __ef_vlgammaf(NaN) 返回 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.114. __ef_vll2float_rd

**原型：**

```
__vector float __ef_vll2float_rd(__vector2 long long l)
```

**描述：**

将 64 位有符号整数值 x 转换为单精度浮点值，采用向下舍入（向负无穷）模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.115. __ef_vll2float_rn

**原型：**

```
__vector float __ef_vll2float_rn(__vector2 long long l)
```

**描述：**

将 64 位有符号整数值 x 转换为单精度浮点值，采用舍入到最近偶数模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.116. __ef_vll2float_ru

**原型：**

```
__vector float __ef_vll2float_ru(__vector2 long long l)
```

**描述：**

将 64 位有符号整数值 x 转换为单精度浮点值，采用向上舍入（向正无穷）模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.117. __ef_vll2float_rz

**原型：**

```
__vector float __ef_vll2float_rz(__vector2 long long l)
```

**描述：**

将 64 位有符号整数值 x 转换为单精度浮点值，采用向零舍入模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.118. __ef_vllabs

**原型：**

```
__vector long long __ef_vllabs(__vector long long x)
```

**描述：**

计算 64 位有符号整数 x 的绝对值。

**返回值：**

返回 64 位有符号整数 x 的绝对值。

**支持情况：**

GCU400: Yes

#### 3.2.119. __ef_vllmax

**原型：**

```
__vector long long __ef_vllmax(__vector long long x, __vector long long y)
```

**描述：**

确定两个 64 位有符号整数 x 和 y 的最大值。

**返回值：**

返回两个 64 位有符号整数 x 和 y 的最大值。

**支持情况：**

GCU400: Yes

#### 3.2.120. __ef_vllmin

**原型：**

```
__vector long long __ef_vllmin(__vector long long x, __vector long long y)
```

**描述：**

确定两个 64 位有符号整数 x 和 y 的最小值。

**返回值：**

返回两个 64 位有符号整数 x 和 y 的最小值。

**支持情况：**

GCU400: Yes

#### 3.2.121. __ef_vllrintf

**原型：**

```
__vector2 long long __ef_vllrintf(__vector float x)
```

**描述：**

将 x 四舍五入到最近的整数值，中间值向零舍入。如果结果超出返回类型的范围，则结果未定义。

**返回值：**

返回四舍五入后的整数值。

**支持情况：**

GCU400: Yes

#### 3.2.122. __ef_vllroundf

**原型：**

```
__vector2 long long __ef_vllroundf(__vector float x)
```

**描述：**

将 x 四舍五入到最近的整数值，中间值远离零舍入。如果结果超出返回类型的范围，则结果未定义。

**返回值：**

返回四舍五入后的整数值。

**支持情况：**

GCU400: Yes

#### 3.2.123. __ef_vlog10f

**原型：**

```
__vector float __ef_vlog10f(__vector float x)
```

**描述：**

计算输入参数 x 的以 10 为底的对数。

**返回值：**

- __ef_vlog10f(±0) 返回 −∞。
- __ef_vlog10f(1) 返回 +0。
- __ef_vlog10f(x) 返回 NaN，如果 x < 0。
- __ef_vlog10f(+infty) 返回 +∞。

**支持情况：**

GCU400: Yes

#### 3.2.124. __ef_vlog1pf

**原型：**

```
__vector float __ef_vlog1pf(__vector float x)
```

**描述：**

计算 ln(1+x) 的值。

**返回值：**

- __ef_vlog1pf(±0) 返回 ±0。
- __ef_vlog1pf(-1) 返回 −∞。
- __ef_vlog1pf(x) 返回 NaN，如果 x < -1。
- __ef_vlog1pf(+infty) 返回 +∞。

**支持情况：**

GCU400: Yes

#### 3.2.125. __ef_vlog2f

**原型：**

```
__vector float __ef_vlog2f(__vector float x)
```

**描述：**

计算输入参数 x 的以 2 为底的对数。

**返回值：**

- __ef_vlog2f(±0) 返回 −∞。
- __ef_vlog2f(1) 返回 +0。
- __ef_vlog2f(x) 返回 NaN，如果 x < 0。
- __ef_vlog2f(+infty) 返回 +∞。

**支持情况：**

GCU400: Yes

#### 3.2.126. __ef_vlogbf

**原型：**

```
__vector float __ef_vlogbf(__vector float x)
```

**描述：**

计算输入参数 x 的浮点表示的指数。

**返回值：**

- __ef_vlogbf(±0) 返回 −∞。
- __ef_vlogbf(+infty) 返回 +∞。

**支持情况：**

GCU400: Yes

#### 3.2.127. __ef_vlogf

**原型：**

```
__vector float __ef_vlogf(__vector float x)
```

**描述：**

计算输入参数 x 的自然对数。

**返回值：**

- __ef_vlogf(±0) 返回 −∞。
- __ef_vlogf(1) 返回 +0。
- __ef_vlogf(x) 返回 NaN，如果 x < 0。
- __ef_vlogf(+infty) 返回 +∞。

**支持情况：**

GCU400: Yes

#### 3.2.128. __ef_vmax

**原型：**

```
__vector int __ef_vmax(__vector int x, __vector int y)
```

**描述：**

确定两个 32 位有符号整数 x 和 y 的最大值。

**返回值：**

返回两个 32 位有符号整数 x 和 y 的最大值。

**支持情况：**

GCU400: Yes

#### 3.2.129. __ef_vmin

**原型：**

```
__vector int __ef_vmin(__vector int x, __vector int y)
```

**描述：**

确定两个 32 位有符号整数 x 和 y 的最小值。

**返回值：**

返回两个 32 位有符号整数 x 和 y 的最小值。

**支持情况：**

GCU400: Yes

#### 3.2.130. __ef_vmodff

**原型：**

```
__vector float __ef_vmodff(__vector float x, __vector float* b)
```

**描述：**

将输入参数 x 分解为小数部分和整数部分。整数部分存储在指针 iptr 指向的位置。小数部分和整数部分的符号与输入参数 x 相同。

**返回值：**

- 返回小数部分。
- __ef_vmodff(±0, iptr) 返回 ±0。
- __ef_vmodff(±∞, iptr) 返回 ±∞，并将 ±∞ 存储在 iptr 指向的位置。
- __ef_vmodff(NaN, iptr) 返回 NaN，并在 iptr 指向的位置存储 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.131. __ef_vmul24

**原型：**

```
__vector int __ef_vmul24(__vector int x, __vector int y)
```

**描述：**

计算 x 和 y 的最低 24 位的乘积的最低 32 位。x 和 y 的高 8 位被忽略。

**返回值：**

返回 x * y 的最低 32 位。

**支持情况：**

GCU400: Yes

#### 3.2.132. __ef_vmul64hi

**原型：**

```
__vector long long __ef_vmul64hi(__vector long long x, __vector long long y)
```

**描述：**

计算 64 位整数 x 和 y 的 128 位乘积的最高 64 位。

**返回值：**

返回 x * y 的最高 64 位。

**支持情况：**

GCU400: Yes

#### 3.2.133. __ef_vmulhi

**原型：**

```
__vector int __ef_vmulhi(__vector int x, __vector int y)
```

**描述：**

计算 32 位整数 x 和 y 的 64 位乘积的最高 32 位。

**返回值：**

返回 x * y 的最高 32 位。

**支持情况：**

GCU400: Yes

#### 3.2.134. __ef_vnanf

**原型：**

```
__vector float __ef_vnanf(i8* tagp)
```

**描述：**

返回一个安静的 NaN 表示。参数 tagp 选择可能的表示之一。

**返回值：**

返回 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.135. __ef_vnearbyintf

**原型：**

```
__vector float __ef_vnearbyintf(__vector float x)
```

**描述：**

将参数 x 四舍五入到最接近的整数值。

**返回值：**

返回最接近 x 的整数值。

**支持情况：**

GCU400: Yes

#### 3.2.136. __ef_vnextafterf

**原型：**

```
__vector float __ef_vnextafterf(__vector float x, __vector float y)
```

**描述：**

计算 x 在 y 方向上的下一个可表示的单精度浮点数。

**返回值：**

返回 x 在 y 方向上的下一个可表示的单精度浮点数。

**支持情况：**

GCU400: Yes

#### 3.2.137. __ef_vnormcdff

**原型：**

```
__vector float __ef_vnormcdff(__vector float x)
```

**描述：**

计算标准正态分布的累积分布函数值。

**返回值：**

返回标准正态分布的累积分布函数值。

**支持情况：**

GCU400: Yes

#### 3.2.138. __ef_vnormcdfinvf

**原型：**

```
__vector float __ef_vnormcdfinvf(__vector float x)
```

**描述：**

计算标准正态累积分布函数的逆值。

**返回值：**

返回标准正态累积分布函数的逆值。

**支持情况：**

GCU400: Yes

#### 3.2.139. __ef_vpopc

**原型：**

```
__vector unsigned int __ef_vpopc(__vector int x)
```

**描述：**

计算 32 位整数 x 中设置为 1 的位的数量。

**返回值：**

返回 x 中设置为 1 的位的数量。

**支持情况：**

GCU400: Yes

#### 3.2.140. __ef_vpopcll

**原型：**

```
__vector unsigned long long __ef_vpopcll(__vector long long x)
```

**描述：**

计算 64 位整数 x 中设置为 1 的位的数量。

**返回值：**

- 返回 x 中设置为 1 的位的数量。
- 返回值类型为__vector unsigned long long，这与vector数据宽度有关，而__nv_popcll 返回i32，这里无法与NV保持一致。

**支持情况：**

GCU400: Yes

#### 3.2.141. __ef_vpowf

**原型：**

```
__vector float __ef_vpowf(__vector float x, __vector float y)
```

**描述：**

计算 x 的 y 次幂。

**返回值：**

返回 x 的 y 次幂。

**支持情况：**

GCU400: Yes

#### 3.2.142. __ef_vpowif

**原型：**

```
__vector float __ef_vpowif(__vector float x, __vector int y)
```

**描述：**

计算 x 的整数次幂。

**返回值：**

返回 x 的整数次幂。

**支持情况：**

GCU400: Yes

#### 3.2.143. __ef_vrcbrtf

**原型：**

```
__vector float __ef_vrcbrtf(__vector float x)
```

**描述：**

计算 x 的倒数立方根。

**返回值：**

返回 x 的倒数立方根。

**支持情况：**

GCU400: Yes

#### 3.2.144. __ef_vremainderf

**原型：**

```
__vector float __ef_vremainderf(__vector float x, __vector float y)
```

**描述：**

计算 x 除以 y 的浮点余数。

**返回值：**

返回 x 除以 y 的浮点余数。

**Warning:**

- 由于 GCU400 rounding mode 不支持动态设置，该算法实现关键位置要求 MAC 运算舍入方式在rz和rn间动态切换，所以导致部分数据存在精度异常。 影响范围: |x| < |y| 或 |x| >= 2^23*|y|

**支持情况：**

GCU400: Yes

#### 3.2.145. __ef_vremquof

**原型：**

```
__vector float __ef_vremquof(__vector float x, __vector float y, __vector int* quo)
```

**描述：**

计算 x 除以 y 的浮点余数，并将商的一部分存储在指针指向的位置。

**返回值：**

返回 x 除以 y 的浮点余数。

**Warning:**

- 由于 GCU400 rounding mode 不支持动态设置，该算法实现关键位置要求 MAC 运算舍入方式在rz和rn间动态切换，所以导致部分数据存在精度异常。 影响范围: |x| < |y| 或 |x| >= 2^23*|y|

**支持情况：**

GCU400: Yes

#### 3.2.146. __ef_vrhadd

**原型：**

```
__vector int __ef_vrhadd(__vector int x, __vector int y)
```

**描述：**

计算两个有符号整数 x 和 y 的平均值，避免中间和的溢出。

**返回值：**

返回 x 和 y 的有符号平均值。

**支持情况：**

GCU400: Yes

#### 3.2.147. __ef_vrintf

**原型：**

```
__vector float __ef_vrintf(__vector float x)
```

**描述：**

将 x 四舍五入到最接近的整数值，中间值向最近的偶数舍入。

**返回值：**

返回最接近 x 的整数值。

**支持情况：**

GCU400: Yes

#### 3.2.148. __ef_vroundf

**原型：**

```
__vector float __ef_vroundf(__vector float x)
```

**描述：**

将 x 四舍五入到最接近的整数值，中间值远离零舍入。

**返回值：**

返回最接近 x 的整数值。

**支持情况：**

GCU400: Yes

#### 3.2.149. __ef_vrsqrtf

**原型：**

```
__vector float __ef_vrsqrtf(__vector float x)
```

**描述：**

计算 x 的倒数平方根。

**返回值：**

返回 x 的倒数平方根。

**支持情况：**

GCU400: Yes

#### 3.2.150. __ef_vsad

**原型：**

```
__vector unsigned int __ef_vsad(__vector int x, __vector int y, __vector unsigned int z)
```

**描述：**

计算 ∣x−y∣+z，其中 x 和 y 是 32 位有符号整数，z 是 32 位无符号整数。

**返回值：**

返回 ∣x−y∣+z 的结果。

**支持情况：**

GCU400: Yes

#### 3.2.151. __ef_vsaturatef

**原型：**

```
__vector float __ef_vsaturatef(__vector float x)
```

**描述：**

将输入参数 x 限制在区间 [0.0,1.0] 内。

**返回值：**

- 如果 x<0，返回 0。
- 如果 x>1，返回 1。
- 如果 0≤x≤1，返回 x。
- 如果 x 是 NaN，返回 0。

**支持情况：**

GCU400: Yes

#### 3.2.152. __ef_vscalbnf

**原型：**

```
__vector float __ef_vscalbnf(__vector float x, __vector int y)
```

**描述：**

通过高效操作浮点指数来计算 x * 2^n。

**返回值：**

- x * 2^n
- __ef_vscalbnf(±0, n) 返回 ±0。
- __ef_vscalbnf(x, 0) 返回 x。
- __ef_vscalbnf(±infty, n) 返回 ±∞。

**支持情况：**

GCU400: Yes

#### 3.2.153. __ef_vsignbitf

**原型：**

```
__vector int __ef_vsignbitf(__vector float x)
```

**描述：**

判断浮点值 x 是否为负。

**返回值：**

如果 x 为负，返回非零值。对于无穷大、零和 NaN，也会报告符号位。

**支持情况：**

GCU400: Yes

#### 3.2.154. __ef_vsincosf

**原型：**

```
void __ef_vsincosf(__vector float x, __vector float* sptr, __vector float* cptr)
```

**描述：**

计算输入参数 x（以弧度为单位）的正弦和余弦值。正弦和余弦的结果分别写入第二个参数 sptr 和第三个参数 cptr。

**返回值：**

无返回值。

**支持情况：**

GCU400: Yes

#### 3.2.155. __ef_vsincospif

**原型：**

```
void __ef_vsincospif(__vector float x, __vector float* sptr, __vector float* cptr)
```

**描述：**

计算输入参数 x（以 π 为单位）的正弦和余弦值。正弦和余弦的结果分别写入第二个参数 sptr 和第三个参数 cptr。

**返回值：**

无返回值。

**支持情况：**

GCU400: Yes

#### 3.2.156. __ef_vsinf

**原型：**

```
__vector float __ef_vsinf(__vector float x)
```

**描述：**

计算输入参数 x（以弧度为单位）的正弦值。

**返回值：**

__ef_vsinf(±infty) 返回 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.157. __ef_vsinhf

**原型：**

```
__vector float __ef_vsinhf(__vector float x)
```

**描述：**

计算输入参数 x 的双曲正弦值。

**返回值：**

__ef_vsinhf(±infty) 返回 ±∞。

**支持情况：**

GCU400: Yes

#### 3.2.158. __ef_vsinpif

**原型：**

```
__vector float __ef_vsinpif(__vector float x)
```

**描述：**

计算输入参数 x（以 π 为单位）的正弦值。

**返回值：**

__ef_vsinpif(±infty) 返回 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.159. __ef_vsqrtf

**原型：**

```
__vector float __ef_vsqrtf(__vector float x)
```

**描述：**

计算输入参数 x 的非负平方根。

**返回值：**

- __ef_vsqrtf(±0) 返回 ±0。
- __ef_vsqrtf(x) 返回 NaN，如果 x<0。
- __ef_vsqrtf(+infty) 返回 +∞。

**支持情况：**

GCU400: Yes

#### 3.2.160. __ef_vtanf

**原型：**

```
__vector float __ef_vtanf(__vector float x)
```

**描述：**

计算输入参数 x（以弧度为单位）的正切值。

**返回值：**

__ef_vtanf(±infty) 返回 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.161. __ef_vtanhf

**原型：**

```
__vector float __ef_vtanhf(__vector float x)
```

**描述：**

计算输入参数 x 的双曲正切值。

**返回值：**

__ef_vtanhf(±infty) 返回 ±1。

**支持情况：**

GCU400: Yes

#### 3.2.162. __ef_vtgammaf

**原型：**

```
__vector float __ef_vtgammaf(__vector float x)
```

**描述：**

计算输入参数 x 的伽玛函数值。

**返回值：**

- __ef_vtgammaf(±0) 返回 ±∞。
- __ef_vtgammaf(1) 返回 +0。
- __ef_vtgammaf(2) 返回 +0。
- __ef_vtgammaf(x) 返回 NaN，如果 x<0。
- __ef_vtgammaf(±infty) 返回 ±∞。

**支持情况：**

GCU400: Yes

#### 3.2.163. __ef_vtruncf

**原型：**

```
__vector float __ef_vtruncf(__vector float x)
```

**描述：**

将 x 四舍五入到最接近的整数值，但不超过 x 的绝对值。

**返回值：**

返回截断后的整数值。

**支持情况：**

GCU400: Yes

#### 3.2.164. __ef_vuhadd

**原型：**

```
__vector unsigned int __ef_vuhadd(__vector unsigned int x, __vector unsigned int y)
```

**描述：**

计算两个无符号整数 x 和 y 的平均值，计算公式为 (x+y)>>1，避免中间和的溢出。

**返回值：**

返回 x 和 y 的无符号平均值。

**支持情况：**

GCU400: Yes

#### 3.2.165. __ef_vuint2float_rd

**原型：**

```
__vector float __ef_vuint2float_rd(__vector unsigned int in)
```

**描述：**

将无符号整数值 x 转换为单精度浮点值，采用向下舍入（向负无穷）模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.166. __ef_vuint2float_rn

**原型：**

```
__vector float __ef_vuint2float_rn(__vector unsigned int in)
```

**描述：**

将无符号整数值 x 转换为单精度浮点值，采用舍入到最近偶数模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.167. __ef_vuint2float_ru

**原型：**

```
__vector float __ef_vuint2float_ru(__vector unsigned int in)
```

**描述：**

将无符号整数值 x 转换为单精度浮点值，采用向上舍入（向正无穷）模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.168. __ef_vuint2float_rz

**原型：**

```
__vector float __ef_vuint2float_rz(__vector unsigned int in)
```

**描述：**

将无符号整数值 x 转换为单精度浮点值，采用向零舍入模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.169. __ef_vull2float_rd

**原型：**

```
__vector float __ef_vull2float_rd(__vector2 unsigned long long l)
```

**描述：**

将无符号整数值 x 转换为单精度浮点值，采用向下舍入（向负无穷）模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.170. __ef_vull2float_rn

**原型：**

```
__vector float __ef_vull2float_rn(__vector2 unsigned long long l)
```

**描述：**

将无符号整数值 x 转换为单精度浮点值，采用舍入到最近偶数模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.171. __ef_vull2float_ru

**原型：**

```
__vector float __ef_vull2float_ru(__vector2 unsigned long long l)
```

**描述：**

将无符号整数值 x 转换为单精度浮点值，采用向上舍入（向正无穷）模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.172. __ef_vull2float_rz

**原型：**

```
__vector float __ef_vull2float_rz(__vector2 unsigned long long l)
```

**描述：**

将无符号整数值 x 转换为单精度浮点值，采用向零舍入模式。

**返回值：**

返回转换后的值。

**支持情况：**

GCU400: Yes

#### 3.2.173. __ef_vullmax

**原型：**

```
__vector unsigned long long __ef_vullmax(__vector unsigned long long x, __vector unsigned long long y)
```

**描述：**

确定两个 64 位无符号整数 x 和 y 的最大值。

**返回值：**

返回两个 64 位无符号整数 x 和 y 的最大值。

**支持情况：**

GCU400: Yes

#### 3.2.174. __ef_vullmin

**原型：**

```
__vector unsigned long long __ef_vullmin(__vector unsigned long long x, __vector unsigned long long y)
```

**描述：**

确定两个 64 位无符号整数 x 和 y 的最小值。

**返回值：**

返回两个 64 位无符号整数 x 和 y 的最小值。

**支持情况：**

GCU400: Yes

#### 3.2.175. __ef_vumax

**原型：**

```
__vector unsigned int __ef_vumax(__vector unsigned int x, __vector unsigned int y)
```

**描述：**

确定两个 32 位无符号整数 x 和 y 的最大值。

**返回值：**

返回两个 32 位无符号整数 x 和 y 的最大值。

**支持情况：**

GCU400: Yes

#### 3.2.176. __ef_vumin

**原型：**

```
__vector unsigned int __ef_vumin(__vector unsigned int x, __vector unsigned int y)
```

**描述：**

确定两个 32 位无符号整数 x 和 y 的最小值。

**返回值：**

返回两个 32 位无符号整数 x 和 y 的最小值。

**支持情况：**

GCU400: Yes

#### 3.2.177. __ef_vumul24

**原型：**

```
__vector unsigned int __ef_vumul24(__vector unsigned int x, __vector unsigned int y)
```

**描述：**

计算 x 和 y 的最低 24 位的乘积的最低 32 位。忽略 x 和 y 的高 8 位。

**返回值：**

返回 x * y 的最低 32 位。

**支持情况：**

GCU400: Yes

#### 3.2.178. __ef_vumul64hi

**原型：**

```
__vector unsigned long long __ef_vumul64hi(__vector unsigned long long x, __vector unsigned long long y)
```

**描述：**

计算 64 位无符号整数 x 和 y 的 128 位乘积的最高 64 位。

**返回值：**

返回 x * y 的最高 64 位。

**支持情况：**

GCU400: Yes

#### 3.2.179. __ef_vumulhi

**原型：**

```
__vector unsigned int __ef_vumulhi(__vector unsigned int x, __vector unsigned int y)
```

**描述：**

计算 32 位无符号整数 x 和 y 的 64 位乘积的最高 32 位。

**返回值：**

返回 x * y 的最高 32 位。

**支持情况：**

GCU400: Yes

#### 3.2.180. __ef_vurhadd

**原型：**

```
__vector unsigned int __ef_vurhadd(__vector unsigned int x, __vector unsigned int y)
```

**描述：**

计算两个无符号整数 x 和 y 的平均值，计算公式为 (x+y+1)>>1，避免中间和的溢出。

**返回值：**

返回 x 和 y 的无符号平均值。

**支持情况：**

GCU400: Yes

#### 3.2.181. __ef_vusad

**原型：**

```
__vector unsigned int __ef_vusad(__vector unsigned int x, __vector unsigned int y, __vector unsigned int z)
```

**描述：**

计算 ∣x−y∣+z，其中 x、y 和 z 都是 32 位无符号整数。

**返回值：**

返回 ∣x−y∣+z 的结果。

**支持情况：**

GCU400: Yes

#### 3.2.182. __ef_vy0f

**原型：**

```
__vector float __ef_vy0f(__vector float x)
```

**描述：**

计算输入参数 x 的第二类零阶贝塞尔函数值。

**返回值：**

- __ef_vy0f(0) 返回 −∞。
- __ef_vy0f(x) 返回 NaN，如果 x<0。
- __ef_vy0f(+infty) 返回 +0。
- __ef_vy0f(NaN) 返回 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.183. __ef_vy1f

**原型：**

```
__vector float __ef_vy1f(__vector float x)
```

**描述：**

计算输入参数 x 的第二类一阶贝塞尔函数值。

**返回值：**

- __ef_vy1f(0) 返回 −∞。
- __ef_vy1f(x) 返回 NaN，如果 x<0。
- __ef_vy1f(+infty) 返回 +0。
- __ef_vy1f(NaN) 返回 NaN。

**支持情况：**

GCU400: Yes

#### 3.2.184. __ef_vynf

**原型：**

```
__vector float __ef_vynf(__vector int n, __vector float x)
```

**描述：**

计算输入参数 x 的第二类 n 阶贝塞尔函数值。

**返回值：**

- __ef_vynf(n, x) 返回 NaN，如果 n<0。
- __ef_vynf(n, 0) 返回 −∞。
- __ef_vynf(n, x) 返回 NaN，如果 x<0。
- __ef_vynf(n, +infty) 返回 +0。
- __ef_vynf(n, NaN) 返回 NaN。

**支持情况：**

GCU400: Yes
