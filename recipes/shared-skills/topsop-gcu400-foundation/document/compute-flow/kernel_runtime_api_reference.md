> Imported material source: `Doc/Kernel Runtime API Reference.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `Kernel Runtime API Reference`.

# Kernel Runtime API Reference

## 1. Kernel Runtime API

```cpp
struct tops::bf16x2
```

*#include <vector_infra.h>*

BF16 type for unified vector length.

#### Private Members

```cpp
__bf16 placeholder_[2]
```

```cpp
struct tops::charx4
```

*#include <vector_infra.h>*

Char type for unified vector length.

#### Private Members

```cpp
char placeholder_[4]
```

```cpp
struct tops::f16x2
```

*#include <vector_infra.h>*

FP16 type for unified vector length.

#### Private Members

```cpp
__fp16 placeholder_[2]
```

```cpp
template<typename T, int vector_length>struct scalar_to_vector
```

*#include <vector_infra.h>*

Scalar type to vector type inference.

**Template Parameters:**

- **T** -- Scalar type.
- **vector_length** -- Vector length.

```cpp
struct tops::shortx2
```

*#include <vector_infra.h>*

Short type for unified vector length.

#### Private Members

```cpp
short placeholder_[2]
```

```cpp
struct tops::ucharx4
```

*#include <vector_infra.h>*

Unsigned char type for unified vector length.

#### Private Members

```cpp
unsigned char placeholder_[4]
```

```cpp
template<typename T>struct underlying_scalar
```

*#include <vector_infra.h>*

Unified scalar type to underlying scalar type inference.

**Template Parameters:** **T** -- Unified scalar type.

```cpp
template<> struct tops::underlying_scalar<__bf16 >
```

#### Public Types

```cpp
using type = __bf16
```

```cpp
template<> struct tops::underlying_scalar<__fp16 >
```

#### Public Types

```cpp
using type = __fp16
```

```cpp
template<> struct tops::underlying_scalar<bf16x2 >
```

#### Public Types

```cpp
using type = __bf16
```

```cpp
template<> struct tops::underlying_scalar<char >
```

#### Public Types

```cpp
using type = char
```

```cpp
template<> struct tops::underlying_scalar<charx4 >
```

#### Public Types

```cpp
using type = char
```

```cpp
template<> struct tops::underlying_scalar<f16x2 >
```

#### Public Types

```cpp
using type = __fp16
```

```cpp
template<> struct tops::underlying_scalar<float >
```

#### Public Types

```cpp
using type = float
```

```cpp
template<> struct tops::underlying_scalar<int >
```

#### Public Types

```cpp
using type = int
```

```cpp
template<> struct tops::underlying_scalar<short >
```

#### Public Types

```cpp
using type = short
```

```cpp
template<> struct tops::underlying_scalar<shortx2 >
```

#### Public Types

```cpp
using type = short
```

```cpp
template<> struct tops::underlying_scalar<signed char >
```

#### Public Types

```cpp
using type = signed char
```

```cpp
template<> struct tops::underlying_scalar<ucharx4 >
```

#### Public Types

```cpp
using type = unsigned char
```

```cpp
template<> struct tops::underlying_scalar<unsigned char >
```

#### Public Types

```cpp
using type = unsigned char
```

```cpp
template<> struct tops::underlying_scalar<unsigned int >
```

#### Public Types

```cpp
using type = unsigned int
```

```cpp
template<> struct tops::underlying_scalar<unsigned short >
```

#### Public Types

```cpp
using type = unsigned short
```

```cpp
template<> struct tops::underlying_scalar<ushortx2 >
```

#### Public Types

```cpp
using type = unsigned short
```

```cpp
template<typename T>struct unified_scalar
```

*#include <vector_infra.h>*

Underlying scalar type to unified scalar type inference. Unified scalar takes 32 bits width.

**Template Parameters:** **T** -- Underlying scalar type.

```cpp
template<> struct tops::unified_scalar<__bf16 >
```

#### Public Types

```cpp
using type = bf16x2
```

```cpp
template<> struct tops::unified_scalar<__fp16 >
```

#### Public Types

```cpp
using type = f16x2
```

```cpp
template<> struct tops::unified_scalar<char >
```

#### Public Types

```cpp
using type = charx4
```

```cpp
template<> struct tops::unified_scalar<float >
```

#### Public Types

```cpp
using type = float
```

```cpp
template<> struct tops::unified_scalar<int >
```

#### Public Types

```cpp
using type = int
```

```cpp
template<> struct tops::unified_scalar<short >
```

#### Public Types

```cpp
using type = shortx2
```

```cpp
template<> struct tops::unified_scalar<signed char >
```

#### Public Types

```cpp
using type = charx4
```

```cpp
template<> struct tops::unified_scalar<unsigned char >
```

#### Public Types

```cpp
using type = ucharx4
```

```cpp
template<> struct tops::unified_scalar<unsigned int >
```

#### Public Types

```cpp
using type = unsigned int
```

```cpp
template<> struct tops::unified_scalar<unsigned short >
```

#### Public Types

```cpp
using type = ushortx2
```

```cpp
struct tops::ushortx2
```

*#include <vector_infra.h>*

Unsigned short type for unified vector length.

#### Private Members

```cpp
unsigned short placeholder_[2]
```

```cpp
template<typename VT>struct vector_latency
```

*#include <vector_infra.h>*

Provides vector latency.

**Template Parameters:** **VT** -- Vector type.

```cpp
template<typename VT>struct vector_length
```

*#include <vector_infra.h>*

Provides vector length.

**Note:**

The value is the number of unified scalar, not underlying scalar.

**Template Parameters:** **VT** -- Vector type.

```cpp
template<typename VT>struct vector_to_mask
```

*#include <vector_infra.h>*

Vector type to mask type inference.

**Template Parameters:** **VT** -- Vector Type.

```cpp
template<typename VT>struct vector_to_scalar
```

*#include <vector_infra.h>*

Vector type to scalar type inference.

**Note:**

Infers to scalar type.

**Template Parameters:** **VT** -- Vector type.

```cpp
namespace tops
```

#### Typedefs

```cpp
template<typename T>using unified_scalar_t = typename unified_scalar<T >::type
```

Alias of unified_scalar for ease of use.

**Template Parameters:** **T** -- Basic scalar type.

```cpp
template<typename T>using underlying_scalar_t = typename underlying_scalar<T >::type
```

Alias of underlying_scalar for ease of use.

**Template Parameters:** **T** -- Unified scalar type.

```cpp
template<typename T, int vector_length>using stv_t = typename scalar_to_vector<T, vector_length >::type
```

Alias of scalar_to_vector for ease of use.

**Template Parameters:**

- **T** -- Scalar type.
- **vector_length** -- Vector length.

```cpp
template<typename VT>using vts_t = typename vector_to_scalar<VT >::type
```

Alias of vector_to_scalar for ease of use.

**Template Parameters:** **VT** -- Vector type.

```cpp
template<typename VT>using vtm_t = typename vector_to_mask<VT >::type
```

Alias of vector_to_mask for ease of use.

**Template Parameters:** **VT** -- Vector type.

#### Enums

```cpp
enum RoundingMode
```

Rounding mode for type conversion.

**Note:**

RM_RZ: Rounds toward zero. RM_RN: Rounds to nearest even. RM_RZ_CLAMP: Rounds toward zero. For int8 result, clamp to [-127, 127] when overflows. RM_RN_CLAMP: Rounds to nearest even. For int8 result, clamp to [-127, 127] when overflows.

*Values:*

```cpp
enumerator RM_DEFAULT
```

```cpp
enumerator RM_RZ
```

```cpp
enumerator RM_RN
```

```cpp
enumerator RM_RZ_CLAMP
```

```cpp
enumerator RM_RN_CLAMP
```

#### Functions

```cpp
KRT_API int krt_get_sip_id()
```

```cpp
KRT_API int krt_get_cluster_id()
```

```cpp
KRT_API void sync_thread_threads()
```

Syncs all sub threads within a thread.

**Returns:** void.

```cpp
template<typename MT>KRT_API MT mask_and(MT lhs, MT rhs)
```

Returns AND result of two vector masks.

**Template Parameters:** **MT** -- Mask type.

**Parameters:**

- **lhs** -- Vector mask.
- **rhs** -- Another vector mask.

**Returns:** Result vector mask.

```cpp
template<typename MT>KRT_API MT mask_or(MT lhs, MT rhs)
```

Returns OR result of two vector masks.

**Template Parameters:** **MT** -- Mask type.

**Parameters:**

- **lhs** -- Vector mask.
- **rhs** -- Another vector mask.

**Returns:** Result vector mask.

```cpp
template<typename MT>KRT_API MT mask_xor(MT lhs, MT rhs)
```

Returns XOR result of two vector masks.

**Template Parameters:** **MT** -- Mask type.

**Parameters:**

- **lhs** -- Vector mask.
- **rhs** -- Another vector mask.

**Returns:** Result vector mask.

```cpp
template<typename MT>KRT_API MT mask_not(MT m)
```

Returns NOT result of the input vector mask.

**Template Parameters:** **MT** -- Mask type.

**Parameters:** **m** -- Vector mask.

**Returns:** Result vector mask.

```cpp
template<typename MT, typename VT>KRT_API MT veq(const VT &lhs, const VT &rhs)
```

Compares if two vectors are equal per element, and returns the result as a vector mask: mask[i] = lhs[i] == rhs[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vhalf/vbfloat/vint/vuint/vfloat.

**Template Parameters:**

- **MT** -- Mask type.
- **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector.
- **rhs** -- Another vector.

**Returns:** Mask result, representing TRUE/FALSE per element.

```cpp
template<typename MT, typename VT>KRT_API MT vne(const VT &lhs, const VT &rhs)
```

Compares if two vectors are not equal per element, and returns the result as a vector mask: mask[i] = lhs[i] != rhs[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vhalf/vbfloat/vint/vuint/vfloat.

**Template Parameters:**

- **MT** -- Mask type.
- **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector.
- **rhs** -- Another vector.

**Returns:** Mask result, representing TRUE/FALSE per element.

```cpp
template<typename MT, typename VT>KRT_API MT vlt(const VT &lhs, const VT &rhs)
```

Compares if lhs is less than rhs per element, and returns the result as a vector mask: mask[i] = lhs[i] < rhs[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vhalf/vbfloat/vint/vuint/vfloat.

**Template Parameters:**

- **MT** -- Mask type.
- **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector.
- **rhs** -- Another vector.

**Returns:** Mask result, representing TRUE/FALSE per element.

```cpp
template<typename MT, typename VT>KRT_API MT vle(const VT &lhs, const VT &rhs)
```

Compares if lhs is less than or equal to rhs per element, and returns the result as a vector mask: mask[i] = lhs[i] <= rhs[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vhalf/vbfloat/vint/vuint/vfloat.

**Template Parameters:**

- **MT** -- Mask type.
- **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector.
- **rhs** -- Another vector.

**Returns:** Mask result, representing TRUE/FALSE per element.

```cpp
template<typename MT, typename VT>KRT_API MT vgt(const VT &lhs, const VT &rhs)
```

Compares if lhs is greater than rhs per element, and returns the result as a vector mask: mask[i] = lhs[i] > rhs[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vhalf/vbfloat/vint/vuint/vfloat.

**Template Parameters:**

- **MT** -- Mask type.
- **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector.
- **rhs** -- Another vector.

**Returns:** Mask result, representing TRUE/FALSE per element.

```cpp
template<typename MT, typename VT>KRT_API MT vge(const VT &lhs, const VT &rhs)
```

Compares if lhs is greater than or equal to rhs per element, and returns the result as a vector mask: mask[i] = lhs[i] >= rhs[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vhalf/vbfloat/vint/vuint/vfloat.

**Template Parameters:**

- **MT** -- Mask type.
- **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector.
- **rhs** -- Another vector.

**Returns:** Mask result, representing TRUE/FALSE per element.

```cpp
template<typename VT, typename MT>KRT_API VT vzero_t(MT mask, const VT &remain)
```

Set vector to zero on TRUE condition of the mask per element: res[i] = mask[i] ? 0 : remain[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which result elements are set to zero.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vzero_f(MT mask, const VT &remain)
```

Set vector to zero on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : 0.

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which result elements keep the remain value.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vadd_t(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Adds two vectors on TRUE condition of the mask per element: res[i] = mask[i] ? (lhs[i] + rhs[i]) : remain[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will be applied on this API.
- **lhs** -- Augend vector.
- **rhs** -- Addend vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vadd_f(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Adds two vectors on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : (lhs[i] + rhs[i]).

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will not be applied on this API.
- **lhs** -- Augend vector.
- **rhs** -- Addend vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vsub_t(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Subtracts two vectors on TRUE condition of the mask per element: res[i] = mask[i] ? (lhs[i] - rhs[i]) : remain[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will be applied on this API.
- **lhs** -- Minuend vector.
- **rhs** -- Subtrahend vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vsub_f(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Subtracts two vectors on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : (lhs[i] - rhs[i]).

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will not be applied on this API.
- **lhs** -- Minuend vector.
- **rhs** -- Subtrahend vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vmul_t(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Multiplies two vectors on TRUE condition of the mask per element: res[i] = mask[i] ? (lhs[i] * rhs[i]) : remain[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will be applied on this API.
- **lhs** -- Multiplicand vector.
- **rhs** -- Multiplier vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vmul_f(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Multiplies two vectors on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : (lhs[i] * rhs[i]).

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will not be applied on this API.
- **lhs** -- Multiplicand vector.
- **rhs** -- Multiplier vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vdiv_t(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Divides two vectors on TRUE condition of the mask per element: res[i] = mask[i] ? (lhs[i] / rhs[i]) : remain[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will be applied on this API.
- **lhs** -- Dividend vector.
- **rhs** -- Divisor vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vdiv_f(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Divides two vectors on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : (lhs[i] / rhs[i]).

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will not be applied on this API.
- **lhs** -- Dividend vector.
- **rhs** -- Divisor vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vrem_t(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Computes remainder of two integral vectors divided by each other on TRUE condition of the mask per element: res[i] = mask[i] ? rem(lhs[i], rhs[i]) : remain[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will be applied on this API.
- **lhs** -- Dividend vector.
- **rhs** -- Divisor vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vrem_f(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Computes remainder of two integral vectors divided by each other on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : rem(lhs[i], rhs[i]).

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will not be applied on this API.
- **lhs** -- Dividend vector.
- **rhs** -- Divisor vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vmod_t(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Computes modulus of two integral vectors divided by each other on TRUE condition of the mask per element: res[i] = mask[i] ? mod(lhs[i], rhs[i]) : remain[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will be applied on this API.
- **lhs** -- Dividend vector.
- **rhs** -- Divisor vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vmod_f(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Computes modulus of two integral vectors divided by each other on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : mod(lhs[i], rhs[i]).

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will not be applied on this API.
- **lhs** -- Dividend vector.
- **rhs** -- Divisor vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vsign_t(MT mask, const VT &v, const VT &remain)
```

Returns sign of the vector on TRUE condition of the mask per element: res[i] = mask[i] ? sign(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vsign_f(MT mask, const VT &v, const VT &remain)
```

Returns sign of the vector on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : sign(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vcbrt_t(MT mask, const VT &v, const VT &remain)
```

Computes cubic root on TRUE condition of the mask per element: res[i] = mask[i] ? cbrt(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vcbrt_f(MT mask, const VT &v, const VT &remain)
```

Computes cubic root on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : cbrt(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vtan_t(MT mask, const VT &v, const VT &remain)
```

Computes tangent on TRUE condition of the mask per element: res[i] = mask[i] ? tan(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vtan_f(MT mask, const VT &v, const VT &remain)
```

Computes tangent on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : tan(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vatan_t(MT mask, const VT &v, const VT &remain)
```

Computes arc tangent on TRUE condition of the mask per element: res[i] = mask[i] ? atan(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vatan_f(MT mask, const VT &v, const VT &remain)
```

Computes arc tangent on FALSE condition of the mask per element: res[i] = mask[i] ? : remain[i] : atan(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vatan2_t(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Computes arc tangent of lhs / rhs on TRUE condition of the mask per element: res[i] = mask[i] ? atan2(lhs[i] / rhs[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will be applied on this API.
- **lhs** -- Dividend vector.
- **rhs** -- Divisor vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vatan2_f(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Computes arc tangent of lhs / rhs on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : atan2(lhs[i] / rhs[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will not be applied on this API.
- **lhs** -- Dividend vector.
- **rhs** -- Divisor vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vtanh_t(MT mask, const VT &v, const VT &remain)
```

Computes hyperbolic tangent on TRUE condition of the mask per element: res[i] = mask[i] ? tanh(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vtanh_f(MT mask, const VT &v, const VT &remain)
```

Computes hyperbolic tangent on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : tanh(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vatanh_t(MT mask, const VT &v, const VT &remain)
```

Computes inverse hyperbolic tangent on TRUE condition of the mask per element: res[i] = mask[i] ? atanh(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vatanh_f(MT mask, const VT &v, const VT &remain)
```

Computes inverse hyperbolic tangent on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : atanh(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vsin_t(MT mask, const VT &v, const VT &remain)
```

Computes sine on TRUE condition of the mask per element: res[i] = mask[i] ? sin(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vsin_f(MT mask, const VT &v, const VT &remain)
```

Computes sine on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : sin(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vasin_t(MT mask, const VT &v, const VT &remain)
```

Computes arc sine on TRUE condition of the mask per element: res[i] = mask[i] ? asin(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vasin_f(MT mask, const VT &v, const VT &remain)
```

Computes arc sine on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : asin(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vsinh_t(MT mask, const VT &v, const VT &remain)
```

Computes hyperbolic sine on TRUE condition of the mask per element: res[i] = mask[i] ? sinh(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vsinh_f(MT mask, const VT &v, const VT &remain)
```

Computes hyperbolic sine on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : sinh(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vasinh_t(MT mask, const VT &v, const VT &remain)
```

Computes inverse hyperbolic sine on TRUE condition of the mask per element: res[i] = mask[i] ? asinh(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vasinh_f(MT mask, const VT &v, const VT &remain)
```

Computes inverse hyperbolic sine on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : asinh(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vcos_t(MT mask, const VT &v, const VT &remain)
```

Computes cosine on TRUE condition of the mask per element: res[i] = mask[i] ? cos(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vcos_f(MT mask, const VT &v, const VT &remain)
```

Computes cosine on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : cos(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vacos_t(MT mask, const VT &v, const VT &remain)
```

Computes arc cosine on TRUE condition of the mask per element: res[i] = mask[i] ? acos(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vacos_f(MT mask, const VT &v, const VT &remain)
```

Computes arc cosine on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : acos(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vcosh_t(MT mask, const VT &v, const VT &remain)
```

Computes hyperbolic cosine on TRUE condition of the mask per element: res[i] = mask[i] ? cosh(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vcosh_f(MT mask, const VT &v, const VT &remain)
```

Computes hyperbolic cosine on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : cosh(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vacosh_t(MT mask, const VT &v, const VT &remain)
```

Computes inverse hyperbolic cosine on TRUE condition of the mask per element: res[i] = mask[i] ? acosh(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vacosh_f(MT mask, const VT &v, const VT &remain)
```

Computes inverse hyperbolic cosine on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : acosh(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vabs_t(MT mask, const VT &v, const VT &remain)
```

Computes absolute value on TRUE condition of the mask per element: res[i] = mask[i] ? abs(v[i]) : remain[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vabs_f(MT mask, const VT &v, const VT &remain)
```

Computes absolute value on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : abs(v[i]).

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vneg_t(MT mask, const VT &v, const VT &remain)
```

Changes sign of the vector on TRUE condition of the mask per element: res[i] = mask[i] ? -v[i] : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vneg_f(MT mask, const VT &v, const VT &remain)
```

Changes sign of the vector on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : -v[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vsqrt_t(MT mask, const VT &v, const VT &remain)
```

Computes square root on TRUE condition of the mask per element: res[i] = mask[i] ? sqrt(v[i]) : remain[i].

**Note:**

Supported vector types: vchar/vshort/vint/vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vsqrt_f(MT mask, const VT &v, const VT &remain)
```

Computes square root on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : sqrt(v[i]).

**Note:**

Supported vector types: vchar/vshort/vint/vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vrsqrt_t(MT mask, const VT &v, const VT &remain)
```

Computes reciprocal square root on TRUE condition of the mask per element: res[i] = mask[i] ? rsqrt(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vrsqrt_f(MT mask, const VT &v, const VT &remain)
```

Computes reciprocal square root on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : rsqrt(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vfloor_t(MT mask, const VT &v, const VT &remain)
```

Rounds the input vector downward to the largest integral value that is not greater than the original value on TRUE condition of the mask per element: res[i] = mask[i] ? floor(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vfloor_f(MT mask, const VT &v, const VT &remain)
```

Rounds the input vector downward to the largest integral value that is not greater than the original value on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : floor(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vceil_t(MT mask, const VT &v, const VT &remain)
```

Rounds the input vector upward to the smallest integral value that is not less than the input vector on TRUE condition of the mask per element: res[i] = mask[i] ? ceil(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vceil_f(MT mask, const VT &v, const VT &remain)
```

Rounds the input vector upward to the smallest integral value that is not less than the input vector on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : ceil(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vround_t(MT mask, const VT &v, const VT &remain)
```

Rounds to nearest integral value, with halfway cases rounded away from zero on TRUE condition of the mask per element: res[i] = mask[i] ? round(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vround_f(MT mask, const VT &v, const VT &remain)
```

Rounds to nearest integral value, with halfway cases rounded away from zero on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : round(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vtrunc_t(MT mask, const VT &v, const VT &remain)
```

Rounds toward zero on TRUE condition of the mask per element: res[i] = mask[i] ? trunc(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vtrunc_f(MT mask, const VT &v, const VT &remain)
```

Rounds toward zero on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : trunc(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vrint_t(MT mask, const VT &v, const VT &remain)
```

Rounds to nearest even integral value on TRUE condition of the mask per element: res[i] = mask[i] ? rint(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vrint_f(MT mask, const VT &v, const VT &remain)
```

Rounds to nearest even integral value on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : rint(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vexp_t(MT mask, const VT &v, const VT &remain)
```

Computes base-e exponential function on TRUE condition of the mask per element: res[i] = mask[i] ? (e ^ v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vexp_f(MT mask, const VT &v, const VT &remain)
```

Computes base-e exponential function on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : (e ^ v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vexpm1_t(MT mask, const VT &v, const VT &remain)
```

Computes base-e exponential minus one on TRUE condition of the mask per element: res[i] = mask[i] ? ((e ^ v[i]) - 1) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vexpm1_f(MT mask, const VT &v, const VT &remain)
```

Computes base-e exponential minus one on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : ((e ^ v[i]) - 1).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vexp2_t(MT mask, const VT &v, const VT &remain)
```

Computes binary (base-2) exponential function on TRUE condition of the mask per element: res[i] = mask[i] ? (2 ^ v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vexp2_f(MT mask, const VT &v, const VT &remain)
```

Computes binary (base-2) exponential function on FALSE condition of the mask per element: res[i] = mask[i] ? : remain[i] : (2 ^ v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vlog_t(MT mask, const VT &v, const VT &remain)
```

Computes natural logarithm on TRUE condition of the mask per element: res[i] = mask[i] ? log(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vlog_f(MT mask, const VT &v, const VT &remain)
```

Computes natural logarithm on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : log(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vlog1p_t(MT mask, const VT &v, const VT &remain)
```

Computes natural logarithm of one plus the input value on TRUE condition of the mask per element: res[i] = mask[i] ? log(1 + v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vlog1p_f(MT mask, const VT &v, const VT &remain)
```

Computes natural logarithm of one plus the input value on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : log(1 + v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vlog2_t(MT mask, const VT &v, const VT &remain)
```

Computes binary (base-2) logarithm on TRUE condition of the mask per element: res[i] = mask[i] ? log2(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vlog2_f(MT mask, const VT &v, const VT &remain)
```

Computes binary (base-2) logarithm on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : log2(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vlog10_t(MT mask, const VT &v, const VT &remain)
```

Computes common (base-10) logarithm on TRUE condition of the mask per element: res[i] = mask[i] ? log10(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vlog10_f(MT mask, const VT &v, const VT &remain)
```

Computes common (base-10) logarithm on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : log10(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vlogb_t(MT mask, const VT &v, const VT &remain)
```

Computes the exponent of v, which is the integral part of vlog2 |v|, on TRUE condition of the mask per element: res[i] = mask[i] ? logb(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vlogb_f(MT mask, const VT &v, const VT &remain)
```

Computes the exponent of v, which is the integral part of vlog2 |v|, on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : logb(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vpower_t(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Computes lhs raised to the power rhs on TRUE condition of the mask per element: res[i] = mask[i] ? (lhs[i] ^ rhs[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will be applied on this API.
- **lhs** -- Base vector.
- **rhs** -- Exponent vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vpower_f(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Computes lhs raised to the power rhs on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : (lhs[i] ^ rhs[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will not be applied on this API.
- **lhs** -- Base vector.
- **rhs** -- Exponent vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vgelu_t(MT mask, const VT &v, const VT &remain)
```

Computes Gaussian Error Linear Unit (GELU) activation function on TRUE condition of the mask per element: res[i] = mask[i] ? gelu(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vgelu_f(MT mask, const VT &v, const VT &remain)
```

Computes Gaussian Error Linear Unit (GELU) activation function on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : gelu(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vsoftplus_t(MT mask, const VT &v, const VT &remain)
```

Computes vlog(vexp(v) + 1) on TRUE condition of the mask per element: res[i] = mask[i] ? log((e ^ v[i]) + 1) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vsoftplus_f(MT mask, const VT &v, const VT &remain)
```

Computes vlog(vexp(v) + 1) on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : log((e ^ v[i]) + 1).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vsigmoid_t(MT mask, const VT &v, const VT &remain)
```

Computes sigmoid activation function on TRUE condition of the mask per element： res[i] = mask[i] ? sigmoid(v[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vsigmoid_f(MT mask, const VT &v, const VT &remain)
```

Computes sigmoid activation function on FALSE condition of the mask per element： res[i] = mask[i] ? remain[i] : sigmoid(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vdim_t(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Computes the positive difference between lhs and rhs on TRUE condition of the mask per element: res[i] = mask[i] ? (lhs[i] > rhs[i] ? lhs[i] - rhs[i] : 0) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will be applied on this API.
- **lhs** -- Vector.
- **rhs** -- Another vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vdim_f(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Computes the positive difference between lhs and rhs on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : (lhs[i] > rhs[i] ? lhs[i] - rhs[i] : 0).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will not be applied on this API.
- **lhs** -- Vector.
- **rhs** -- Another vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vhypot_t(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Computes hypotenuse of a right-angled triangle whose legs are lhs and rhs on TRUE condition of the mask per element： res[i] = mask[i] ? sqrt((lhs[i] ^ 2) + (rhs[i] ^ 2)) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will be applied on this API.
- **lhs** -- Vector.
- **rhs** -- Another vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vhypot_f(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Computes hypotenuse of a right-angled triangle whose legs are lhs and rhs on FALSE condition of the mask per element： res[i] = mask[i] ? remain[i] : sqrt((lhs[i] ^ 2) + (rhs[i] ^ 2)).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will not be applied on this API.
- **lhs** -- Vector.
- **rhs** -- Another vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vcopysign_t(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Returns a vector with the magnitude of lhs and the sign of rhs on TRUE condition of the mask per element: res[i] = mask[i] ? copysign(lhs[i], rhs[i]) : remain[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will be applied on this API.
- **lhs** -- Magnitude vector
- **rhs** -- Sign vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vcopysign_f(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Returns a vector with the magnitude of lhs and the sign of rhs on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : copysign(lhs[i], rhs[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will not be applied on this API.
- **lhs** -- Magnitude vector
- **rhs** -- Sign vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vmax_t(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Returns the largest of two vectors on TRUE condition of the mask per element: res[i] = mask[i] ? max(lhs[i], rhs[i]) : remain[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will be applied on this API.
- **lhs** -- Vector.
- **rhs** -- Another vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vmax_f(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Returns the largest of two vectors on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : max(lhs[i], rhs[i]).

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will not be applied on this API.
- **lhs** -- Vector.
- **rhs** -- Another vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vmin_t(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Returns the smallest of two vectors on TRUE condition of the mask per element: res[i] = mask[i] ? min(lhs[i], rhs[i]) : remain[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will be applied on this API.
- **lhs** -- Vector.
- **rhs** -- Another vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vmin_f(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Returns the smallest of two vectors on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : min(lhs[i], rhs[i]).

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will not be applied on this API.
- **lhs** -- Vector.
- **rhs** -- Another vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vand_t(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Computes bitwise AND on TRUE condition of the mask per element: res[i] = mask[i] ? (lhs[i] & rhs[i]) : remain[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will be applied on this API.
- **lhs** -- Vector.
- **rhs** -- Another vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vand_f(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Computes bitwise AND on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : (lhs[i] & rhs[i]).

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will not be applied on this API.
- **lhs** -- Vector.
- **rhs** -- Another vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vor_t(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Computes bitwise OR on TRUE condition of the mask per element: res[i] = mask[i] ? (lhs[i] | rhs[i]) : remain[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will be applied on this API.
- **lhs** -- Vector.
- **rhs** -- Another vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vor_f(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Computes bitwise OR on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : (lhs[i] | rhs[i]).

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will not be applied on this API.
- **lhs** -- Vector.
- **rhs** -- Another vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vxor_t(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Computes bitwise XOR on TRUE condition of the mask per element: res[i] = mask[i] ? (lhs[i] ^ rhs[i]) : remain[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will be applied on this API.
- **lhs** -- Vector.
- **rhs** -- Another vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vxor_f(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Computes bitwise XOR on FALSE condition of the mask per element: res[i] = mask[i] ? : remain[i] : (lhs[i] ^ rhs[i]).

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will not be applied on this API.
- **lhs** -- Vector.
- **rhs** -- Another vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vnot_t(MT mask, const VT &v, const VT &remain)
```

Computes bitwise NOT on TRUE condition of the mask per element: res[i] = mask[i] ? ~v[i] : remain[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements will be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vnot_f(MT mask, const VT &v, const VT &remain)
```

Computes bitwise NOT on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : ~v[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements will not be applied on this API.
- **v** -- Vector.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vshl_t(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Shifts lhs left by rhs bits on TRUE condition of the mask per element: res[i] = mask[i] ? (lhs[i] << rhs[i]) : remain[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will be applied on this API.
- **lhs** -- Vector to be shifted.
- **rhs** -- Vector of shift bit num.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vshl_f(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Shifts lhs left by rhs bits on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : (lhs[i] << rhs[i]).

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will not be applied on this API.
- **lhs** -- Vector to be shifted.
- **rhs** -- Vector of shift bit num.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vshr_t(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Shifts lhs right by rhs bits on TRUE condition of the mask per element: res[i] = mask[i] ? (lhs[i] >> rhs[i]) : remain[i]. For signed types, uses arithmetic shift. For unsigned types, uses logical shift.

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will be applied on this API.
- **lhs** -- Vector to be shifted.
- **rhs** -- Vector of shift bits.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vshr_f(MT mask, const VT &lhs, const VT &rhs, const VT &remain)
```

Shifts lhs right by rhs bits on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : (lhs[i] >> rhs[i]). For signed types, uses arithmetic shift. For unsigned types, uses logical shift.

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of lhs will not be applied on this API.
- **lhs** -- Vector to be shifted.
- **rhs** -- Vector of shift bits.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vshli_t(MT mask, const VT &v, int bits, const VT &remain)
```

Shifts v left by rhs bits on TRUE condition of the mask per element: res[i] = mask[i] ? (v[i] << bits) : remain[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **bits** -- Shift bit num.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vshli_f(MT mask, const VT &v, int bits, const VT &remain)
```

Shifts v left by rhs bits on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : (v[i] << bits).

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **bits** -- Shift bit num.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vshri_t(MT mask, const VT &v, int bits, const VT &remain)
```

Shifts v right by rhs bits on TRUE condition of the mask per element: res[i] = mask[i] ? (v[i] >> bits) : remain[i]. For signed types, uses arithmetic shift. For unsigned types, uses logical shift.

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will be applied on this API.
- **v** -- Vector.
- **bits** -- Shift bit num.
- **remain** -- Vector that provides elements for FALSE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vshri_f(MT mask, const VT &v, int bits, const VT &remain)
```

Shifts v right by rhs bits on FALSE condition of the mask per element: res[i] = mask[i] ? remain[i] : (v[i] >> bits). For signed types, uses arithmetic shift. For unsigned types, uses logical shift.

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements of v will not be applied on this API.
- **v** -- Vector.
- **bits** -- Shift bit num.
- **remain** -- Vector that provides elements for TRUE condition of the mask.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vselect_t(MT mask, const VT &lhs, const VT &rhs)
```

Select from lhs on TRUE condition of the mask and select from rhs on FALSE condition on the mask per element: res[i] = mask[i] ? lhs[i] : rhs[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vhalf/vbfloat/vint/vuint/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements to select.
- **lhs** -- Candidate vector.
- **rhs** -- Another candidate vector.

**Returns:** Result vector.

```cpp
template<typename VT, typename MT>KRT_API VT vselect_f(MT mask, const VT &lhs, const VT &rhs)
```

Select from lhs on FALSE condition of the mask and select from rhs on TRUE condition on the mask per element: res[i] = mask[i] ? lhs[i] : rhs[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vhalf/vbfloat/vint/vuint/vfloat.

**Template Parameters:**

- **VT** -- Vector type.
- **MT** -- Mask type.

**Parameters:**

- **mask** -- Vector mask, controls which elements to select.
- **lhs** -- Candidate vector.
- **rhs** -- Another candidate vector.

**Returns:** Result vector.

***file* boot_code.h**: *#include "krt/common.h"*

***file* builtins.h**: *#include "krt/common.h"*

***file* common.h**

#### Defines

```cpp
INLINE_HAL_API
```

```cpp
__DTU_KRT_FUNC
```

```cpp
__DTU_KRT_FUNC_RESIDENT
```

```cpp
__DTU_KRT_AS
```

```cpp
KRT_API
```

#### Typedefs

```cpp
typedef unsigned int mapped_ptr
```

```cpp
typedef unsigned long long generic_ptr
```

#### Enums

```cpp
enum engine_type_t
```

*Values:*

```cpp
enumerator CDTE_TYPE
```

```cpp
enumerator SDTE_TYPE
```

```cpp
enumerator SIP_TYPE
```

```cpp
enumerator LARE_DTE_TYPE
```

```cpp
enumerator PCIE_DTE_TYPE
```

```cpp
enum cache_priority_t
```

*Values:*

```cpp
enumerator STREAMING
```

```cpp
enumerator NORMAL
```

```cpp
enumerator PERSISTING
```

```cpp
enum thread_scope_t
```

*Values:*

```cpp
enumerator THREAD
```

```cpp
enumerator BLOCK
```

***file* dispatch.h**

***file* dte.h**

*#include "krt/common.h"*

*#include "krt/task_node.h"*

***file* io.h**

*#include <>*

*#include "krt/common.h"*

***file* leaptr.h**

*#include "krt/vector_infra.h"*

#### Defines

```cpp
CHECK_LEAPTR_ADDR(api, addr, vec_bytes, align)
```

```cpp
CHECK_LEAPTR_STRIDE(api, stride, align)
```

***file* misc.h**: *#include "krt/common.h"*

***file* mmu.h**: *#include "krt/common.h"*

***file* perfmon.h**: *#include "krt/common.h"*

***file* res_mgmt.h**: *#include "krt/common.h"*

***file* scalar.h**: *#include "krt/common.h"*

***file* scalar_type.h**

***file* synchronization.h**

#### Defines

```cpp
ENABLE_HWSYNC
```

***file* target.h**

***file* task_node.h**: *#include "krt/common.h"*

***file* vector.h**

*#include "krt/vector_infra.h"*

#### Defines

```cpp
__UNARY_SPECIALIZATION(api, type)
```

```cpp
__BINARY_SPECIALIZATION(api, type)
```

```cpp
__TERNARY_SPECIALIZATION(api, type)
```

```cpp
__UNARY_PRED_SPECIALIZATION(api, in_type, out_type)
```

```cpp
__BINARY_PRED_SPECIALIZATION(api, in_type, out_type)
```

```cpp
__SELECT_SPECIALIZATION(api, vec_type, cond_type)
```

```cpp
__SHIFT_IMM_SPECIALIZATION(api, type)
```

```cpp
__UNARY_DIFF_IN_OUT_SPECIALIZATION(api, in_type, out_type)
```

```cpp
__ALL_PRED_TYPE_CONSTRAINTS(api, SPECIALIZATION)
```

```cpp
__MASK_PRED_TYPE_CONSTRAINTS(api, SPECIALIZATION)
```

```cpp
__BOOL_PRED_TYPE_CONSTRAINTS(api, SPECIALIZATION)
```

```cpp
DECLARE_UNARY_FLOATING_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_BINARY_FLOATING_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_TERNARY_FLOATING_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_UNARY_INTEGRAL_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_BINARY_INTEGRAL_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_UNARY_SIGNED_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_UNARY_FLOATING_PRED_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_BINARY_PRED_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_SHIFT_IMM_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_BROADCAST_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_FLOAT_TO_INT_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_BITCAST_TYPE_CONSTRAINTS(api)
```

***file* vector_infra.h**: *#include "krt/common.h"*

***file* vector_mask.h**

*#include "krt/vector_infra.h"*

#### Defines

```cpp
__ZERO_SPECIALIZATION(api, vt)
```

```cpp
__UNARY_SPECIALIZATION(api, vt)
```

```cpp
__BINARY_SPECIALIZATION(api, vt)
```

```cpp
__SHIFT_IMM_SPECIALIZATION(api, vt)
```

```cpp
__SELECT_SPECIALIZATION(api, vt)
```

```cpp
DECLARE_ZERO_ALL_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_UNARY_FLOATING_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_BINARY_FLOATING_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_UNARY_INTEGRAL_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_BINARY_INTEGRAL_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_UNARY_SIGNED_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_UNARY_ALL_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_BINARY_ALL_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_SHIFT_IMM_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_SELECT_TYPE_CONSTRAINTS(api)
```

***group* DTE**

***group* DTE_operation**

***group* Task_node**

***group* Mem**

***group* Synchronization**

***group* Vector**: Defines the Vector API. See the individual sections for more information.

***group* Vector_infra**

#### Typedefs

```cpp
template<typename T>using unified_scalar_t = typename unified_scalar<T >::type
```

Alias of unified_scalar for ease of use.

**Template Parameters:** **T** -- Basic scalar type.

```cpp
template<typename T>using underlying_scalar_t = typename underlying_scalar<T >::type
```

Alias of underlying_scalar for ease of use.

**Template Parameters:** **T** -- Unified scalar type.

```cpp
template<typename T, int vector_length>using stv_t = typename scalar_to_vector<T, vector_length >::type
```

Alias of scalar_to_vector for ease of use.

**Template Parameters:**

- **T** -- Scalar type.
- **vector_length** -- Vector length.

```cpp
template<typename VT>using vts_t = typename vector_to_scalar<VT >::type
```

Alias of vector_to_scalar for ease of use.

**Template Parameters:** **VT** -- Vector type.

```cpp
template<typename VT>using vtm_t = typename vector_to_mask<VT >::type
```

Alias of vector_to_mask for ease of use.

**Template Parameters:** **VT** -- Vector type.

***group* Vector_math**

#### Defines

```cpp
__UNARY_SPECIALIZATION(api, type)
```

```cpp
__BINARY_SPECIALIZATION(api, type)
```

```cpp
__TERNARY_SPECIALIZATION(api, type)
```

```cpp
__UNARY_PRED_SPECIALIZATION(api, in_type, out_type)
```

```cpp
__BINARY_PRED_SPECIALIZATION(api, in_type, out_type)
```

```cpp
__SELECT_SPECIALIZATION(api, vec_type, cond_type)
```

```cpp
__SHIFT_IMM_SPECIALIZATION(api, type)
```

```cpp
__UNARY_DIFF_IN_OUT_SPECIALIZATION(api, in_type, out_type)
```

```cpp
__ALL_PRED_TYPE_CONSTRAINTS(api, SPECIALIZATION)
```

```cpp
__MASK_PRED_TYPE_CONSTRAINTS(api, SPECIALIZATION)
```

```cpp
__BOOL_PRED_TYPE_CONSTRAINTS(api, SPECIALIZATION)
```

```cpp
DECLARE_UNARY_FLOATING_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_BINARY_FLOATING_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_TERNARY_FLOATING_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_UNARY_INTEGRAL_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_BINARY_INTEGRAL_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_UNARY_SIGNED_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_UNARY_FLOATING_PRED_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_BINARY_PRED_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_SHIFT_IMM_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_BROADCAST_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_FLOAT_TO_INT_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_BITCAST_TYPE_CONSTRAINTS(api)
```

#### Enums

```cpp
enum RoundingMode
```

Rounding mode for type conversion.

**Note:**

RM_RZ: Rounds toward zero. RM_RN: Rounds to nearest even. RM_RZ_CLAMP: Rounds toward zero. For int8 result, clamp to [-127, 127] when overflows. RM_RN_CLAMP: Rounds to nearest even. For int8 result, clamp to [-127, 127] when overflows.

*Values:*

```cpp
enumerator RM_DEFAULT
```

```cpp
enumerator RM_RZ
```

```cpp
enumerator RM_RN
```

```cpp
enumerator RM_RZ_CLAMP
```

```cpp
enumerator RM_RN_CLAMP
```

***group* Leaptr**

#### Defines

```cpp
CHECK_LEAPTR_ADDR(api, addr, vec_bytes, align)
```

```cpp
CHECK_LEAPTR_STRIDE(api, stride, align)
```

***group* Vector_mask**

#### Defines

```cpp
__ZERO_SPECIALIZATION(api, vt)
```

```cpp
__UNARY_SPECIALIZATION(api, vt)
```

```cpp
__BINARY_SPECIALIZATION(api, vt)
```

```cpp
__SHIFT_IMM_SPECIALIZATION(api, vt)
```

```cpp
__SELECT_SPECIALIZATION(api, vt)
```

```cpp
DECLARE_ZERO_ALL_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_UNARY_FLOATING_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_BINARY_FLOATING_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_UNARY_INTEGRAL_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_BINARY_INTEGRAL_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_UNARY_SIGNED_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_UNARY_ALL_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_BINARY_ALL_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_SHIFT_IMM_TYPE_CONSTRAINTS(api)
```

```cpp
DECLARE_SELECT_TYPE_CONSTRAINTS(api)
```

***dir* include**

***dir* include/krt**
