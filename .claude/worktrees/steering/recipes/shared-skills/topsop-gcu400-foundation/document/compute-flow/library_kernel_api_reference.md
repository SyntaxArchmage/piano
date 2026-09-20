> Imported material source: `Doc/Library Kernel API Reference.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `Library Kernel API Reference`.

# Library Kernel API Reference

## 1. Attribute

### 1.1. BuiltinType

In addition to the basic types, we also support two builtin floating-point type
extensions, including half-precision floating point(tops::half) and bfloat16
floating-point format(tops::bfloat).

This section describes two builtin floating-point types in TopsCC.

#### tops::bfloat

This section describes one of the builtin types tops::bfloat.

```cpp
typedef __ef_bfloat16 bfloat
```

```cpp
typedef __ef_bfloat16 bfloat16
```

```cpp
unsigned short value
```

```cpp
TOPS_FUNC __ef_bfloat16() = default
```

```cpp
inline explicit TOPS_FUNC __ef_bfloat16(const __half f)
```

```cpp
inline TOPS_FUNC __ef_bfloat16(const float f)
```

```cpp
inline TOPS_FUNC __ef_bfloat16(const double f)
```

```cpp
TOPS_FUNC operator float() const
```

```cpp
TOPS_FUNC __ef_bfloat16 &operator=(const float f)
```

```cpp
TOPS_FUNC __ef_bfloat16 &operator=(const double f)
```

```cpp
inline TOPS_FUNC __ef_bfloat16(short val)
```

```cpp
inline TOPS_FUNC __ef_bfloat16(unsigned short val)
```

```cpp
inline TOPS_FUNC __ef_bfloat16(int val)
```

```cpp
inline TOPS_FUNC __ef_bfloat16(unsigned int val)
```

```cpp
inline TOPS_FUNC __ef_bfloat16(const long val)
```

```cpp
inline TOPS_FUNC __ef_bfloat16(const unsigned long val)
```

```cpp
inline TOPS_FUNC __ef_bfloat16(long long val)
```

```cpp
inline TOPS_FUNC __ef_bfloat16(unsigned long long val)
```

```cpp
TOPS_FUNC operator signed char() const
```

```cpp
TOPS_FUNC operator unsigned char() const
```

```cpp
TOPS_FUNC operator char() const
```

```cpp
TOPS_FUNC operator short() const
```

```cpp
TOPS_FUNC operator unsigned short() const
```

```cpp
TOPS_FUNC operator int() const
```

```cpp
TOPS_FUNC operator unsigned int() const
```

```cpp
TOPS_FUNC operator long() const
```

```cpp
TOPS_FUNC operator unsigned long() const
```

```cpp
TOPS_FUNC operator long long() const
```

```cpp
TOPS_FUNC operator unsigned long long() const
```

```cpp
TOPS_FUNC __ef_bfloat16 &operator=(short val)
```

```cpp
TOPS_FUNC __ef_bfloat16 &operator=(unsigned short val)
```

```cpp
TOPS_FUNC __ef_bfloat16 &operator=(int val)
```

```cpp
TOPS_FUNC __ef_bfloat16 &operator=(unsigned int val)
```

```cpp
TOPS_FUNC __ef_bfloat16 &operator=(long long val)
```

```cpp
TOPS_FUNC __ef_bfloat16 &operator=(unsigned long long val)
```

```cpp
inline TOPS_FUNC operator bool() const
```

```cpp
TOPS_FUNC unsigned short __internal_float2bfloat16(const float f, unsigned int &sign, unsigned int &remainder)
```

**Declaration**

The bfloat16 floating-point format is supported in `tops` namespace. You can declare a bfloat16 number on both `host` and `device` side by using `tops::bfloat`.

```
#include <tops/bfloat.h>
tops::bfloat a(12);
```

You can initialize a `tops::bfloat` variable with another type of variable. Type `double`, `float`, `long`, `unsigned long`, `int`, `unsigned int`, `short`, `unsigned short`, `char`, `signed char`, `unsigned char`, and `bool` are supported.

```
#include <tops/bfloat.h>
short a = 12;
tops::bfloat b(a);
tops::bfloat c = (tops::bfloat)a; // explicit convert required
tops::bfloat d{a};
tops::bfloat e(42);
```

**Type Conversion**

The `tops::bfloat` also supports type conversions. You can convert a `tops::bfloat` variable to a certain type. Type `double`, `float`, `long`, `unsigned long`, `int`, `unsigned int`, `short`, `unsigned short`, `char`, `signed char`, `unsigned char`, and `bool` are supported.

```
#include <tops/bfloat.h>
tops::bfloat a(12.5);
float b = a;  // b equals to 12.500
int c = a;    // c equals to 12
short d = a;  // d equals to 12
```

**Compound Assignment Operators**

The `tops::bfloat` also supports Compound Assignment Operators. Operators `+=`, `-=`, `*=` and `/=` are supported.

```
#include <tops/bfloat.h>
tops::bfloat a(12);
tops::bfloat b(4);
a += b;   // a equals to 16.0
a -= b;   // a equals to 12.0
a *= b;   // a equals to 48.0
a /= b;   // a equals to 12.0
```

**Comparison Operators**

The `tops::bfloat` also supports Comparison Operators. Operators `==`, `!=`, `>`, `<`, `>=` and `<=` are supported.

```
#include <tops/bfloat.h>
tops::bfloat a(12);
tops::bfloat b(4);
bool c;
c = (a == b);  // c equals to False
c = (a != b);  // c equals to True
c = (a > b);   // c equals to True
c = (a >= b);  // c equals to True
c = (a < b);   // c equals to False
c = (a <= b);  // c equals to False
```

**Four Arithmetic Operations**

The `tops::bfloat` supports Four Arithmetic Operations. Operators `+`, `-`, `*` and `/` are supported.

```
#include <tops/bfloat.h>
tops::bfloat a(12);
tops::bfloat b(4);
tops::bfloat c;
c = a + b;    // c equals to 16.0
c = a - b;    // c equals to 8.0
c = a * b;    // c equals to 48.0
c = a / b;    // c equals to 3.0
```

```cpp
TOPS_FUNC float __internal_bfloat162float(const unsigned short h)
```

```cpp
TOPS_FUNC float __bfloat162float(const __ef_bfloat16 a)
```

```cpp
TOPS_FUNC int __bfloat162int_rz(const __ef_bfloat16 h)
```

```cpp
TOPS_FUNC signed char __bfloat162char_rz(const __ef_bfloat16 h)
```

```cpp
TOPS_FUNC unsigned char __bfloat162uchar_rz(const __ef_bfloat16 h)
```

```cpp
TOPS_FUNC short int __bfloat162short_rz(const __ef_bfloat16 h)
```

```cpp
TOPS_FUNC unsigned int __bfloat162uint_rz(const __ef_bfloat16 h)
```

```cpp
TOPS_FUNC unsigned short int __bfloat162ushort_rz(const __ef_bfloat16 h)
```

```cpp
TOPS_FUNC unsigned long long int __bfloat162ull_rz(const __ef_bfloat16 h)
```

```cpp
TOPS_FUNC long long int __bfloat162ll_rz(const __ef_bfloat16 h)
```

```cpp
TOPS_FUNC __ef_bfloat16 __float2bfloat16(const float a)
```

```cpp
TOPS_FUNC __ef_bfloat16 __double2bfloat16(const double a)
```

```cpp
TOPS_FUNC __ef_bfloat16 __int2bfloat16_rn(const int i)
```

```cpp
TOPS_FUNC __ef_bfloat16 __short2bfloat16_rn(const short int i)
```

```cpp
TOPS_FUNC __ef_bfloat16 __uint2bfloat16_rn(const unsigned int i)
```

```cpp
TOPS_FUNC __ef_bfloat16 __ushort2bfloat16_rn(const unsigned short int i)
```

```cpp
TOPS_FUNC __ef_bfloat16 __ull2bfloat16_rn(const unsigned long long int i)
```

```cpp
TOPS_FUNC __ef_bfloat16 __ll2bfloat16_rn(const long long int i)
```

```cpp
TOPS_FUNC __ef_bfloat16 __hadd(const __ef_bfloat16 a, const __ef_bfloat16 b)
```

```cpp
TOPS_FUNC __ef_bfloat16 __hsub(const __ef_bfloat16 a, const __ef_bfloat16 b)
```

```cpp
TOPS_FUNC __ef_bfloat16 __hmul(const __ef_bfloat16 a, const __ef_bfloat16 b)
```

```cpp
TOPS_FUNC __ef_bfloat16 __hdiv(const __ef_bfloat16 a, const __ef_bfloat16 b)
```

```cpp
TOPS_FUNC __ef_bfloat16 __hneg(const __ef_bfloat16 a)
```

```cpp
TOPS_FUNC __ef_bfloat16 operator-(const __ef_bfloat16 &h)
```

```cpp
TOPS_FUNC bool __hisnan(const __ef_bfloat16 a)
```

```cpp
TOPS_FUNC bool __heq(const __ef_bfloat16 a, const __ef_bfloat16 b)
```

```cpp
TOPS_FUNC bool __hne(const __ef_bfloat16 a, const __ef_bfloat16 b)
```

```cpp
TOPS_FUNC bool __hle(const __ef_bfloat16 a, const __ef_bfloat16 b)
```

```cpp
TOPS_FUNC bool __hge(const __ef_bfloat16 a, const __ef_bfloat16 b)
```

```cpp
TOPS_FUNC bool __hlt(const __ef_bfloat16 a, const __ef_bfloat16 b)
```

```cpp
TOPS_FUNC bool __hgt(const __ef_bfloat16 a, const __ef_bfloat16 b)
```

```cpp
TOPS_FUNC __ef_bfloat16 operator+(const __ef_bfloat16 &lh, const __ef_bfloat16 &rh)
```

```cpp
template<typename T, typename std::enable_if< std::is_arithmetic< T >::value, bool >::type = true> TOPS_FUNC __ef_bfloat16 operator+(const T &lh, const __ef_bfloat16 &rh)
```

```cpp
template<typename T, typename std::enable_if< std::is_arithmetic< T >::value, bool >::type = true> TOPS_FUNC __ef_bfloat16 operator+(const __ef_bfloat16 &lh, const T &rh)
```

```cpp
TOPS_FUNC __ef_bfloat16 operator-(const __ef_bfloat16 &lh, const __ef_bfloat16 &rh)
```

```cpp
template<typename T, typename std::enable_if< std::is_arithmetic< T >::value, bool >::type = true> TOPS_FUNC __ef_bfloat16 operator-(const T &lh, const __ef_bfloat16 &rh)
```

```cpp
template<typename T, typename std::enable_if< std::is_arithmetic< T >::value, bool >::type = true> TOPS_FUNC __ef_bfloat16 operator-(const __ef_bfloat16 &lh, const T &rh)
```

```cpp
TOPS_FUNC __ef_bfloat16 operator*(const __ef_bfloat16 &lh, const __ef_bfloat16 &rh)
```

```cpp
template<typename T, typename std::enable_if< std::is_arithmetic< T >::value, bool >::type = true> TOPS_FUNC __ef_bfloat16 operator*(const T &lh, const __ef_bfloat16 &rh)
```

```cpp
template<typename T, typename std::enable_if< std::is_arithmetic< T >::value, bool >::type = true> TOPS_FUNC __ef_bfloat16 operator*(const __ef_bfloat16 &lh, const T &rh)
```

```cpp
TOPS_FUNC __ef_bfloat16 operator/(const __ef_bfloat16 &lh, const __ef_bfloat16 &rh)
```

```cpp
template<typename T, typename std::enable_if< std::is_arithmetic< T >::value, bool >::type = true> TOPS_FUNC __ef_bfloat16 operator/(const T &lh, const __ef_bfloat16 &rh)
```

```cpp
template<typename T, typename std::enable_if< std::is_arithmetic< T >::value, bool >::type = true> TOPS_FUNC __ef_bfloat16 operator/(const __ef_bfloat16 &lh, const T &rh)
```

```cpp
TOPS_FUNC __ef_bfloat16 &operator+=(__ef_bfloat16 &lh, const __ef_bfloat16 &rh)
```

```cpp
TOPS_FUNC __ef_bfloat16 &operator-=(__ef_bfloat16 &lh, const __ef_bfloat16 &rh)
```

```cpp
TOPS_FUNC __ef_bfloat16 &operator*=(__ef_bfloat16 &lh, const __ef_bfloat16 &rh)
```

```cpp
TOPS_FUNC __ef_bfloat16 &operator/=(__ef_bfloat16 &lh, const __ef_bfloat16 &rh)
```

```cpp
TOPS_FUNC __ef_bfloat16 &operator++(__ef_bfloat16 &h)
```

```cpp
TOPS_FUNC __ef_bfloat16 &operator--(__ef_bfloat16 &h)
```

```cpp
TOPS_FUNC __ef_bfloat16 operator++(__ef_bfloat16 &h, const int ignored)
```

```cpp
TOPS_FUNC __ef_bfloat16 operator--(__ef_bfloat16 &h, const int ignored)
```

```cpp
TOPS_FUNC bool operator==(const __ef_bfloat16 &lh, const __ef_bfloat16 &rh)
```

```cpp
template<typename T, typename std::enable_if< std::is_arithmetic< T >::value, bool >::type = true> TOPS_FUNC bool operator==(const T &lh, const __ef_bfloat16 &rh)
```

```cpp
template<typename T, typename std::enable_if< std::is_arithmetic< T >::value, bool >::type = true> TOPS_FUNC bool operator==(const __ef_bfloat16 &lh, const T &rh)
```

```cpp
TOPS_FUNC bool operator!=(const __ef_bfloat16 &lh, const __ef_bfloat16 &rh)
```

```cpp
template<typename T, typename std::enable_if< std::is_arithmetic< T >::value, bool >::type = true> TOPS_FUNC bool operator!=(const T &lh, const __ef_bfloat16 &rh)
```

```cpp
template<typename T, typename std::enable_if< std::is_arithmetic< T >::value, bool >::type = true> TOPS_FUNC bool operator!=(const __ef_bfloat16 &lh, const T &rh)
```

```cpp
TOPS_FUNC bool operator>(const __ef_bfloat16 &lh, const __ef_bfloat16 &rh)
```

```cpp
template<typename T, typename std::enable_if< std::is_arithmetic< T >::value, bool >::type = true> TOPS_FUNC bool operator>(const T &lh, const __ef_bfloat16 &rh)
```

```cpp
template<typename T, typename std::enable_if< std::is_arithmetic< T >::value, bool >::type = true> TOPS_FUNC bool operator>(const __ef_bfloat16 &lh, const T &rh)
```

```cpp
TOPS_FUNC bool operator<(const __ef_bfloat16 &lh, const __ef_bfloat16 &rh)
```

```cpp
template<typename T, typename std::enable_if< std::is_arithmetic< T >::value, bool >::type = true> TOPS_FUNC bool operator<(const T &lh, const __ef_bfloat16 &rh)
```

```cpp
template<typename T, typename std::enable_if< std::is_arithmetic< T >::value, bool >::type = true> TOPS_FUNC bool operator<(const __ef_bfloat16 &lh, const T &rh)
```

```cpp
TOPS_FUNC bool operator>=(const __ef_bfloat16 &lh, const __ef_bfloat16 &rh)
```

```cpp
template<typename T, typename std::enable_if< std::is_arithmetic< T >::value, bool >::type = true> TOPS_FUNC bool operator>=(const T &lh, const __ef_bfloat16 &rh)
```

```cpp
template<typename T, typename std::enable_if< std::is_arithmetic< T >::value, bool >::type = true> TOPS_FUNC bool operator>=(const __ef_bfloat16 &lh, const T &rh)
```

```cpp
TOPS_FUNC bool operator<=(const __ef_bfloat16 &lh, const __ef_bfloat16 &rh)
```

```cpp
template<typename T, typename std::enable_if< std::is_arithmetic< T >::value, bool >::type = true> TOPS_FUNC bool operator<=(const T &lh, const __ef_bfloat16 &rh)
```

```cpp
template<typename T, typename std::enable_if< std::is_arithmetic< T >::value, bool >::type = true> TOPS_FUNC bool operator<=(const __ef_bfloat16 &lh, const T &rh)
```

```cpp
template<typename VT>__device__ __forceinline__ VT vbroadcast(const bfloat &e)
```

A `tops::bfloat` can be broadcast to a `vbfloat` vector, which includes 64 elements of `tops::bfloat`.

```cpp
explicit TOPS_FUNC __half(const __ef_bfloat16 f)
```

#### tops::half

This section describes one of the builtin types tops::half.

**Warning:**

doxygengroup: Cannot find group "half" in doxygen xml output for project "cc" from directory: ./6-api/topsccapi/content/source/xml

### 1.2. VectorTypes

This section describes VectorTypes predefined in TopsCC API.

```cpp
vchar
```

vector of chars.

```cpp
vuchar
```

vector of unsigned chars.

```cpp
vshort
```

vector of shorts.

```cpp
vushort
```

vector of unsigned shorts.

```cpp
vint
```

vector of ints.

```cpp
vuint
```

vector of unsigned ints.

```cpp
vhalf
```

vector of halfs.

```cpp
vbfloat
```

vector of bfloats.

```cpp
vfloat
```

vector of floats.

```cpp
vfloatx2
```

vector of floats.

## 2. API Function

### 2.1. Builtins

This section describes builtins of TopsCC API.

```cpp
__TOPS_BUILTIN_VAR __tops_builtin_subThreadIdx_t subThreadIdx
```

```cpp
__TOPS_BUILTIN_VAR __tops_builtin_threadDim_t threadDim
```

```cpp
__TOPS_BUILTIN_VAR __tops_builtin_threadIdx_t threadIdx
```

```cpp
__TOPS_BUILTIN_VAR __tops_builtin_blockIdx_t blockIdx
```

```cpp
__TOPS_BUILTIN_VAR __tops_builtin_blockDim_t blockDim
```

```cpp
__TOPS_BUILTIN_VAR __tops_builtin_gridDim_t gridDim
```

```cpp
__device__ __forceinline__ tops_implicit_params_t *__tops_get_implicit_params_ptr()
```

Get the pointer to the `implicit parameter`.

**Returns:** A pointer to `tops_implicit_params_t`.

```cpp
__device__ __forceinline__ tops_amos_sip_interface_t *__tops_get_amos_sip_params_ptr()
```

Get the pointer to the `amos_sip_interface`.

**Returns:** A pointer to `amos_sip_interface`.

```cpp
__device__ __forceinline__ void *__tops_private_heap_pointer()
```

Get the pointer to the private heap.

**Returns:** A pointer of `void*` to the private heap.

```cpp
__device__ __forceinline__ void *__tops_block_shared_memory_pointer()
```

Get the pointer to the block shared memory.

**Returns:** A pointer of `void*` to the block shared memory.

```cpp
__device__ __forceinline__ void tops_halt()
```

Put SIP run state to be in HALT state.

```cpp
__dtu_movs_md31() &0xFF000000) >> 24)) struct __tops_builtin_subThreadIdx_t
```

```cpp
__constant__
```

The memory space specifier `__constant__` is used to declare a variable that is stored in the constant memory space, making it accessible to all threads within the grid.

```cpp
__private__
```

The memory space specifier `__private__` is used to declare a variable that is stored in the private memory space of a thread and can only be accessed by the thread that owns it.

```cpp
__shared__
```

The memory space specifier `__shared__` is used to declare a variable that is stored in the the shared memory space of a block and can only be accessed by the threads within the block.

```cpp
__local__
```

The memory space specifier `__local__` declares a variable that is allocated in the memory space of a single thread.

```cpp
__local_stack__
```

The memory space specifier `__local_stack__` declares a variable that is allocated in the memory space of a single thread from higher address to lower address.

```cpp
__device__
```

As a memory space specifier, __device__ declares a variable that is stored in global memory space and can be accessed by all the threads within the grid.

As an execution space specifier, __device__ declares specifies a function that can be executed on a device and is callable exclusively from device.

```cpp
__global__
```

The execution space specifier `__global__` declares a function as a kernel, indicating that it will be executed on the device and can be called from the host. This function can be thought of as the entry point for the kernel, serving as the starting point for the computation on the device.

```cpp
__cooperative__
```

The execution space specifier `__cooperative__` is used to declare a `__global__` function to be executed in the cooperative mode. In cooperative mode, all blocks within the grid need to be executed simultaneously.

```cpp
__thread_dims__(...)
```

Specify the thread dimensions.

```cpp
__host__
```

The execution space specifier `__host__` declares a function that is executed on the host and can only be called from the host.

```cpp
__sp__
```

The execution space specifier `__sp__` declares a function to be compiled by sp(riscv) backend. If not compiled with `--tops-sp` flag, `__sp__` just means `__host__`.

```cpp
__shared_dte__
```

`__shared_dte__` is one of the DTE context types and is used to declare a block-level DTE context that is shared by the threads within the block.

```cpp
__private_dte__
```

`__private_dte__` is one of the DTE context types and is used to declare a block-level DTE context that is owned by the thread privately.

```cpp
__scalar_only__
```

`__scalar_only__` declares a function to be executed in a single scalar thread which can not execute vector machine instructions.

```cpp
__mmu_pointer__
```

```cpp
__force_noinline__
```

The function qualifier `__force_noinline__` can be used as a hint for the compiler not to inline the function if possible.

```cpp
__forceinline__
```

The function qualifier `__forceinline__` can be used to force the compiler to inline the function.

```cpp
__valigned__
```

The `__valigned__` indicates that the memory is aligned by the **GCU_ARCH**.

```cpp
__block_tile__
```

The `__block_tile__` indicates that the memory auto tiled.

```cpp
__KRT_ARCH__
```

The `__KRT_ARCH__` macro can be used to differentiate various code paths based on `__GCU_ARCH__`.

```cpp
AS5_TASK_NODE_T_PTR
```

```cpp
AS5_DTE_CTX_T_PTR
```

```cpp
threadIdx
```

The thread index is represented by three dimensions (x, y, and z) within the block, as denoted by `threadIdx.x`, `threadIdx.y`, and `threadIdx.z`.

```cpp
blockIdx
```

The block index is represented by three dimensions (x, y, and z) within the grid, as denoted by `blockIdx.x`, `blockIdx.y`, and `blockIdx.z`.

```cpp
blockDim
```

The block dimensions determine the number of threads within a block, and are specified by three dimensions (x, y, and z), as indicated by `blockDim.x`, `blockDim.y`, and `blockDim.z`.

```cpp
gridDim
```

The grid dimensions determine the number of blocks within a grid, and are specified by three dimensions (x, y, and z), as indicated by `gridDim.x`, `gridDim.y`, and `gridDim.z`.

```cpp
struct __tops_builtin_threadDim_t
```

### 2.2. Event

This section describes the struct of event. An event consists of the status which can be waited and it is usually generated from a dte ctx trigger.

```cpp
__device__ __forceinline__ void wait(event &e)
```

Wait for event to end. This function takes an lvalue reference.

**Parameters:** **e** -- a lvalue reference of tops::event

```cpp
__device__ __forceinline__ void wait(event &&e)
```

Wait for event to end. This function takes an rvalue reference.

**Parameters:** **e** -- a rvalue reference of tops::event

```cpp
struct tops::event
```

*#include <__tops_event.h>*

An `event` consists of the status which can be waited and it is usually generated from the trigger of a DTE context.

#### Public Functions

```cpp
__device__ __forceinline__ void wait()
```

Blocks current thread and waits for the SIP mailbox bound to it.

**Parameters:** **None** --

### 2.3. DTE

This section describes the data structures and functions related to DTE.

```cpp
inline __device__ __forceinline__ dte_scope(tops_dte_ctx_t &dte)
```

To initialize a DTE context.

**Parameters:** **dte** -- a DTE context

```cpp
inline __device__ __forceinline__ ~dte_scope()
```

To destroy a DTE context.

```cpp
__device__ __forceinline__ void wait()
```

Blocks current thread and waits for the SIP mailbox bound to it.

**Parameters:** **None** --

```cpp
__TOPS_ADJUST_ADDR()
```

```cpp
__TOPS_SHARED_CDTE_COUNT
```

```cpp
__TOPS_BLOCK_SHARED_EDTE_COUNT
```

```cpp
__TOPS_LOCAL_EDTE_COUNT
```

```cpp
__TOPS_PRIVATE_EDTE_COUNT
```

```cpp
__TOPS_LOCALSHARED_SDTE_COUNT
```

```cpp
__TOPS_EOF_BLOCK_SHARED_CDTE
```

```cpp
__TOPS_EOF_SHARED_CDTE
```

```cpp
__TOPS_EOF_PRIVATE_CDTE
```

```cpp
__TOPS_EOF_LOCALSHARED_SDTE
```

```cpp
__TOPS_EOF_BLOCK_SHARED_EDTE
```

```cpp
__TOPS_EOF_SHARED_EDTE
```

```cpp
__TOPS_EOF_PRIVATE_EDTE
```

```cpp
__TOPS_GET_CDTE_VC_START(ENGID)
```

```cpp
struct tops_dte_ctx_s : public tops_dte_ctx_base_s
```

*#include <__tops_dte.h>*

The struct for DTE context. It keeps the state of a virtual DMA engine.

First, users should initialize it by invoking `init` or using `dte_scope`.

- `config_*` will configure what operation the current operation is.
- `trigger` will run the current operation and return an event which can be waited until the current operation finishes. A context can only run one operation once. When compiled with `-DTOPS_ENABLE_DTE_CHECK`, the illegal behaviour of DTE will be asserted.

**Note:**

`tops_dte_ctx_t` is an aligned version of `tops_dte_ctx_s`.

#### Public Functions

```cpp
__attribute__((section(".text.__tops_dte_ctx_s_resident_"))) inline __device__ tops_dte_ctx_s()
```

DTE context constructor.

```cpp
inline __device__ ~tops_dte_ctx_s()
```

DTE context destructor.

```cpp
__device__ __attribute__((section(".text.__tops_dte_ctx_init_resident_"))) void init(bool force)
```

Initialize a DTE context.

#### Public Static Functions

```cpp
static inline __device__ void tops_init_block_shared_cdte(tops_dte_ctx_t *ctx, int counter)
```

```cpp
static inline __device__ void tops_init_private_cdte(tops_dte_ctx_t *ctx, int counter)
```

```cpp
static inline __device__ void tops_sdte_init(tops_dte_ctx_t *ctx)
```

```cpp
static inline __device__ void tops_threadshared_sdte_init(tops_dte_ctx_t *ctx, int counter)
```

```cpp
struct tops::dte_scope
```

*#include <__tops_dte.h>*

The struct `dte_scope` is designed to initialize or destroy a DTE context object `tops_dte_ctx_t`.

#### Public Functions

```cpp
inline __device__ __forceinline__ dte_scope(tops_dte_ctx_t &dte)
```

To initialize a DTE context.

**Parameters:** **dte** -- a DTE context

```cpp
inline __device__ __forceinline__ ~dte_scope()
```

To destroy a DTE context.

### 2.4. Math

This section describes the API of math functions, including the API for both scalar and vector.

#### Scalar

This section describes the API for math functions of scalar.

```cpp
__device__ __forceinline__ float sinf(float s)
```

Calculates the sine of a floating-point value.

**Parameters:** **s** -- The value in radians for which sine will be calculated.

**Returns:** The sine of the input value.

```cpp
__device__ __forceinline__ float cosf(float s)
```

Calculates the cosine of a floating-point value.

**Parameters:** **s** -- The value in radians for which cosine will be calculated.

**Returns:** The cosine of the input value.

```cpp
__device__ __forceinline__ float tanf(float s)
```

Calculates the tangent of a floating-point value.

**Parameters:** **s** -- The value in radians for which tangent will be calculated.

**Returns:** The tangent of the input value.

```cpp
__device__ __forceinline__ float asinf(float s)
```

Calculates the arcsine of a floating-point value.

**Parameters:** **s** -- The value for which the arcsine will be calculated.

**Returns:** The arcsine of the input value in radians.

```cpp
__device__ __forceinline__ float acosf(float s)
```

Calculates the arccosine of a floating-point value.

**Parameters:** **s** -- The value for which the arccosine will be calculated.

**Returns:** The arccosine of the input value in radians.

```cpp
__device__ __forceinline__ float atanf(float s)
```

Calculates the arctangent of a floating-point value.

**Parameters:** **s** -- The value for which the arctangent will be calculated.

**Returns:** The arctangent of the input value in radians.

```cpp
__device__ __forceinline__ float atan2f(float lhs, float rhs)
```

Calculates the arctangent of the quotient of two floating-point values.

**Parameters:**

- **lhs** -- The dividend value.
- **rhs** -- The divisor value.

**Returns:** The arctangent of the quotient lhs/rhs in radians.

```cpp
__device__ __forceinline__ float sinhf(float s)
```

Calculates the hyperbolic sine(sinh) of a floating-point value.

**Parameters:** **s** -- The value for which the hyperbolic sine will be calculated.

**Returns:** The hyperbolic sine of the input value.

```cpp
__device__ __forceinline__ float coshf(float s)
```

Calculates the hyperbolic cosine(cosh) of a floating-point value.

**Parameters:** **s** -- The value for which the hyperbolic cosine will be calculated.

**Returns:** The hyperbolic cosine of the input value.

```cpp
__device__ __forceinline__ float tanhf(float s)
```

Calculates the hyperbolic tangent(tanh) of a floating-point value.

**Parameters:** **s** -- The value for which the hyperbolic tangent will be calculated.

**Returns:** The hyperbolic tangent of the input value.

```cpp
__device__ __forceinline__ float asinhf(float s)
```

Calculates the inverse hyperbolic sine(asinh) of a floating-point value.

- `asinhf(±0)` returns `±0`.
- `asinhf(±∞)` returns `±∞`.

**Parameters:** **s** -- The value for which the inverse hyperbolic sine will be calculated.

**Returns:** The inverse hyperbolic sine of the input value.

```cpp
__device__ __forceinline__ float acoshf(float s)
```

Calculates the inverse hyperbolic cosine(acosh) of a floating-point value.

- `acoshf(1)` returns `0`.
- `acoshf(s)` returns NaN for `s < 1`.
- `acoshf(+∞)` returns `+∞`.

**Parameters:** **s** -- The value for which the inverse hyperbolic cosine will be calculated.

**Returns:** The inverse hyperbolic cosine of the input value.

```cpp
__device__ __forceinline__ float atanhf(float s)
```

Calculates the inverse hyperbolic tangent(atanh) of a floating-point value.

- `atanhf(±0)` returns `±0`.
- `atanhf(±1)` returns `±∞`.
- `atanhf(s)` returns NaN for `s` outside interval [-1, 1].

**Parameters:** **s** -- The value for which the inverse hyperbolic tangent will be calculated.

**Returns:** The inverse hyperbolic tangent of the input value.

```cpp
__device__ __forceinline__ float expf(float s)
```

Calculates the exponential function (e^x) of a floating-point value.

**Parameters:** **s** -- The value for which the exponential function will be calculated.

**Returns:** The exponential function of the input value.

```cpp
__device__ __forceinline__ float expm1f(float s)
```

Calculates the exponential function minus one(e^x-1) of a floating-point value.

**Parameters:** **s** -- The value for which the exponential function minus one will be calculated.

**Returns:** the exponential function minus one of the input value.

```cpp
__device__ __forceinline__ float exp2f(float s)
```

Calculates 2 raised to the power of a floating-point value.

**Parameters:** **s** -- The exponent value.

**Returns:** 2 raised to the power of the input value.

```cpp
__device__ __forceinline__ float logf(float s)
```

Calculates the natural logarithm (base e) of a floating-point value.

**Parameters:** **s** -- The value for which the natural logarithm will be calculated.

**Returns:** The natural logarithm of the input value.

```cpp
__device__ __forceinline__ float log1pf(float s)
```

Calculates the natural logarithm (base e) of a floating-point value plus one.

**Parameters:** **s** -- The value for which the natural logarithm plus one will be calculated.

**Returns:** The natural logarithm of the input value plus one.

```cpp
__device__ __forceinline__ float log2f(float s)
```

Calculates the base-2 logarithm of a floating-point value.

**Parameters:** **s** -- The value for which the base-2 logarithm will be calculated.

**Returns:** The base-2 logarithm of the input value.

```cpp
__device__ __forceinline__ float log10f(float s)
```

Calculates the base-10 logarithm of a floating-point value.

**Parameters:** **s** -- The value for which the base-10 logarithm will be calculated.

**Returns:** The base-10 logarithm of the input value.

```cpp
__device__ __forceinline__ float logbf(float s)
```

Calculate the integer part of the base-2 logarithm of the absolute value of a floating-point value.

- `logbf(±0)` returns `-∞`.
- `logbf(±∞)` returns `+∞`.

**Parameters:** **s** -- The input floating-point value.

**Returns:** The value of the integral part of log2(|s|).

```cpp
__device__ __forceinline__ float floorf(float s)
```

Rounds the input value downward to the largest integral value that is not greater than the original value.

**Parameters:** **s** -- The input value.

**Returns:** The largest integral value that is not greater than the original value.

```cpp
__device__ __forceinline__ float ceilf(float s)
```

Rounds the input value upward to the smallest integral value that is not less than the original value.

**Parameters:** **s** -- Value whose ceil is returned.

**Returns:** The smallest integral value that is not less than the original value.

```cpp
__device__ __forceinline__ float roundf(float s)
```

Return the integral value nearest to x rounding halfway cases away from zero, regardless of the current rounding direction.

**Parameters:** **s** -- Value rounded to nearest.

**Returns:** The value of a rounded to the nearest integral.

```cpp
__device__ __forceinline__ float sigmoidf(float s)
```

Compute the sigmoid activation function.

result=1e−s+1\text{result} = \frac{1}{{e^{-s} + 1}}result=e−s+11​

**Parameters:** **s** -- The input value.

**Returns:** The result of sigmoid function.

```cpp
__device__ __forceinline__ float geluf(float s)
```

Compute the gelu activation function.

result=s⋅0.5⋅(1+erf(s2))\text{result} = s \cdot 0.5 \cdot \left(1 + \text{erf}\left(\frac{s} {\sqrt{2}}\right)\right)result=s⋅0.5⋅(1+erf(2​s​))

**Parameters:** **s** -- The input value.

**Returns:** The result of gelu function.

```cpp
__device__ __forceinline__ float softplusf(float s)
```

Compute the softplus activation function.

result=log⁡(1+exp⁡(s))\text{result} = \log(1 + \exp(s))result=log(1+exp(s))

**Parameters:** **s** -- The input value.

**Returns:** The result of softplus function.

```cpp
__device__ __forceinline__ float sqrtf(float s)
```

Computes the square root of a given floating-point number.

**Parameters:** **s** -- The floating-point number for which the square root is to be calculated.

**Returns:** The square root of the input number.

```cpp
__device__ __forceinline__ float rsqrtf(float s)
```

Computes the reciprocal square root of a given floating-point number.

This function calculates the reciprocal square root of the input floating-point number (1 / sqrt(x)) and returns the result.

**Parameters:** **s** -- The floating-point number for which the reciprocal square root is to be calculated.

**Returns:** The reciprocal square root of the input number.

```cpp
__device__ __forceinline__ float cbrtf(float s)
```

Computes the cube root of a given floating-point number.

**Parameters:** **s** -- The floating-point number for which the cube root is to be calculated.

**Returns:** The cube root of the input number.

```cpp
__device__ __forceinline__ float powf(float lhs, float rhs)
```

Computes the power of a given base raised to a given exponent (lhs ^ rhs).

**Parameters:**

- **lhs** -- The base value.
- **rhs** -- The exponent value.

**Returns:** The result of base raised to the power of the exponent.

```cpp
__device__ __forceinline__ float signf(float s)
```

Returns the sign of a given number.

This function determines the sign of the input number and returns: -1 if the number is negative, 0 if the number is zero, 1 if the number is positive.

**Parameters:** **s** -- The number for which the sign is to be determined.

**Returns:** 1 if the number is negative, 0 if the number is zero, 1 if the number is positive.

```cpp
__device__ __forceinline__ float fmaxf(float lhs, float rhs)
```

Returns the maximum of two given floating-point numbers.

**Parameters:**

- **lhs** -- The first floating-point number.
- **rhs** -- The second floating-point number.

**Returns:** The maximum value between the two input numbers.

```cpp
__device__ __forceinline__ float fminf(float lhs, float rhs)
```

Returns the minimum of two given floating-point numbers.

**Parameters:**

- **lhs** -- The first floating-point number.
- **rhs** -- The second floating-point number.

**Returns:** The minimum value between the two input numbers.

```cpp
__device__ __forceinline__ float fabsf(float s)
```

Returns the absolute value of a given floating-point number.

**Parameters:** **s** -- The floating-point number for which the absolute value is to be calculated.

**Returns:** The absolute value of the input number.

```cpp
__device__ __forceinline__ float isfinitef(float s)
```

Checks if a given floating-point number is finite.

This function checks whether the input floating-point number is finite, meaning it is neither infinite nor a NaN (Not-a-Number) value.

**Parameters:** **s** -- The floating-point number to be checked.

**Returns:** return 1 if the number is finite, 0 otherwise.

```cpp
__device__ __forceinline__ float isnanf(float s)
```

Checks if a given floating-point number is NaN (Not-a-Number).

This function checks whether the input floating-point number is NaN, which represents an undefined or unrepresentable value.

**Parameters:** **s** -- The floating-point number to be checked.

**Returns:** return 1 if the number is NaN, 0 otherwise.

```cpp
__device__ __forceinline__ float copysignf(float lhs, float rhs)
```

Copies the sign of one floating-point number onto another.

This function returns a value with the magnitude of the first input number (magnitude of `lhs`) and the sign of the second input number (sign of `rhs`).

**Parameters:**

- **lhs** -- The magnitude value.
- **rhs** -- The sign value.

**Returns:** A value with the magnitude of `lhs` and the sign of `rhs`.

```cpp
__device__ __forceinline__ float remf(float lhs, float rhs)
```

Compute single-precision floating-point remainder.

Compute single-precision floating-point remainder `r` of dividing `lhs` by `rhs` for nonzero `rhs`. Thus `r = lhs - n * rhs`. The value `n` is the integer nearest to `lhs / rhs`. If `|n - lhs / rhs| = 1/2`, the even `n` value is chosen.

- `remf(lhs, ±0)` returns NaN.
- `remf(±∞, rhs)` returns NaN.
- `remf(lhs, ±∞)` returns `lhs` for finite `lhs`.

#### Vector

This section describes the API for math functions of vector.

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

```cpp
template<typename VT>KRT_API int vlength()
```

Returns element number of the specified vector type.

**Note:**

Supports all vector types. Be aware that the return value is the number of unified_scalar.

**Template Parameters:** **VT** -- vector type.

**Returns:** Element number.

```cpp
template<typename VT>KRT_API int vlength(const VT &v)
```

Returns element number of the specified vector type.

**Note:**

Supports all vector types. Be aware that the return value is the number of unified_scalar.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Element number.

```cpp
template<typename VT>KRT_API VT vzero()
```

Returns a vector with all bits set to zero.

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Returns:** A vector with all bits set to zero.

```cpp
template<typename VT>KRT_API VT vload(generic_ptr addr)
```

Loads a vector from the address.

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **addr** -- Memory address.

**Returns:** Vector loaded from the address.

```cpp
template<typename VT>KRT_API VT vload(void *addr)
```

```cpp
template<typename VT>KRT_API void vstore(const VT &v, generic_ptr addr)
```

Stores the vector to the address.

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **v** -- Vector.
- **addr** -- Memory address.

**Returns:** None.

```cpp
template<typename VT>KRT_API void vstore(const VT &v, void *addr)
```

```cpp
template<typename TO_VT, typename FROM_VT>KRT_API TO_VT vbitcast(const FROM_VT &v)
```

Reinterprets the vector to another type.

**Note:**

Two vector types can be bitcast to each other as long as their sizes are the same.

**Template Parameters:**

- **TO_VT** -- Reinterpreted type.
- **FROM_VT** -- Original type.

**Parameters:** **v** -- Vector.

**Returns:** Reinterpreted vector.

```cpp
template<typename TO_VT, typename FROM_VT, RoundingMode mode = RM_DEFAULT>KRT_API TO_VT vcast(const FROM_VT &v)
```

Converts the vector to another type.

**Note:**

Supported vector type conversions: vchar -> vshort, vchar -> vint, vchar -> vhalf, vchar -> vbfloat, vchar -> vfloat, vuchar -> vushort, vuchar -> vuint, vuchar -> vhalf, vuchar -> vbfloat, vuchar -> vfloat, vshort -> vchar, vshort -> vint, vshort -> vhalf, vshort -> vbfloat, vshort -> vfloat, vushort -> vuchar, vushort -> vuint, vushort -> vhalf, vushort -> vbfloat, vushort -> vfloat, vint -> vchar, vint -> vshort, vint -> vhalf, vint -> vbfloat, vint -> vfloat, vuint -> vuchar, vuint -> vushort, vuint -> vhalf, vuint -> vbfloat, vuint -> vfloat, vhalf -> vchar, vhalf -> vshort, vhalf -> vint, vhalf -> vbfloat, vhalf -> vfloat, vbfloat -> vchar, vbfloat -> vshort, vbfloat -> vint, vbfloat -> vhalf, vbfloat -> vfloat, vfloat -> vchar, vfloat -> vshort, vfloat -> vint, vfloat -> vhalf, vfloat -> vbfloat.

**Template Parameters:**

- **TO_VT** -- Cast vector type.
- **FROM_VT** -- Original vector Type.
- **mode** -- Rounding Mode.

**Parameters:** **v** -- Original vector

**Returns:** Cast vector.

```cpp
template<typename TO_VT, typename FROM_VT>KRT_API TO_VT vcastrn(const FROM_VT &v)
```

Casts floating vector to integral vector, floating vector to floating vector, integral vector to floating vector by rounding to nearest even.

**Note:**

Supported vector type conversions: vhalf -> vchar, vhalf -> vshort, vhalf -> vint, vbfloat -> vchar, vbfloat -> vshort, vbfloat -> vint, vfloat -> vchar, vfloat -> vshort, vfloat -> vint. vhalf -> vbfloat vhalf -> vfloat vbfloat -> vhalf vbfloat -> vfloat vfloat -> vhalf vfloat -> vbfloat vchar -> vhalf vchar -> vbfloat vchar -> vfloat vuchar -> vhalf vuchar -> vbfloat vuchar -> vfloat vshort -> vhalf vshort -> vbfloat vshort -> vfloat vushort -> vhalf vushort -> vbfloat vushort -> vfloat vint -> vhalf vint -> vbfloat vint -> vfloat vuint -> vhalf vuint -> vbfloat vuint -> vfloat

**Template Parameters:**

- **TO_VT** -- Cast vector type.
- **FROM_VT** -- Original vector type.

**Parameters:** **v** -- Original vector.

**Returns:** Cast vector.

```cpp
template<typename TO_VT, typename FROM_VT>KRT_API TO_VT vcastrz(const FROM_VT &v)
```

Casts floating vector to integral vector, floating vector to floating vector, integral vector to floating vector by rounding toward zero.

**Note:**

Supported vector type conversions: vhalf -> vchar, vhalf -> vshort, vhalf -> vint, vbfloat -> vchar, vbfloat -> vshort, vbfloat -> vint, vfloat -> vchar, vfloat -> vshort, vfloat -> vint. vhalf -> vbfloat vhalf -> vfloat vbfloat -> vhalf vbfloat -> vfloat vfloat -> vhalf vfloat -> vbfloat vchar -> vhalf vchar -> vbfloat vchar -> vfloat vuchar -> vhalf vuchar -> vbfloat vuchar -> vfloat vshort -> vhalf vshort -> vbfloat vshort -> vfloat vushort -> vhalf vushort -> vbfloat vushort -> vfloat vint -> vhalf vint -> vbfloat vint -> vfloat vuint -> vhalf vuint -> vbfloat vuint -> vfloat

**Template Parameters:**

- **TO_VT** -- Cast vector type.
- **FROM_VT** -- Original vector type.

**Parameters:** **v** -- Original vector.

**Returns:** Cast vector.

```cpp
template<typename VT>KRT_API VT vadd(const VT &lhs, const VT &rhs)
```

Adds two vectors per element: res[i] = lhs[i] + rhs[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Augend vector.
- **rhs** -- Addend vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vsub(const VT &lhs, const VT &rhs)
```

Subtracts two vectors per element: res[i] = lhs[i] - rhs[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Minuend vector.
- **rhs** -- Subtrahend vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vmul(const VT &lhs, const VT &rhs)
```

Multiplies two vectors per element: res[i] = lhs[i] * rhs[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Multiplicand vector.
- **rhs** -- Multiplier vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vdiv(const VT &lhs, const VT &rhs)
```

Divides two vectors per element: res[i] = lhs[i] / rhs[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Dividend vector.
- **rhs** -- Divisor vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vrem(const VT &lhs, const VT &rhs)
```

Computes remainder of two integral vectors divided by each other per element: res[i] = rem(lhs[i], rhs[i]).

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Dividend vector.
- **rhs** -- Divisor vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vmod(const VT &lhs, const VT &rhs)
```

Computes modulus of two integral vectors divided by each other per element: res[i] = mod(lhs[i], rhs[i]).

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Dividend vector.
- **rhs** -- Divisor vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vsign(const VT &v)
```

Returns sign of the vector per element: res[i] = sign(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vmac(const VT &lhs, const VT &rhs, const VT &acc)
```

Computes lhs[i] * rhs[i] + acc[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Multiplicand vector.
- **rhs** -- Multiplier vector.
- **acc** -- Addend vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vmas(const VT &lhs, const VT &rhs, const VT &acc)
```

Computes -lhs[i] * rhs[i] + acc[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Multiplicand vector.
- **rhs** -- Multiplier vector.
- **acc** -- Addend vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vimas(const VT &lhs, const VT &rhs, const VT &acc)
```

Computes lhs[i] * rhs[i] - acc[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Multiplicand vector.
- **rhs** -- Multiplier vector.
- **acc** -- Subtrahend vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vcbrt(const VT &v)
```

Computes cubic root per element: res[i] = cbrt(v[i]).

**Note:**

Implemented by formula: cbrt(x) = exp(log(x) / 3). Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vtan(const VT &v)
```

Computes tangent per element: res[i] = tan(v[i]).

**Note:**

Implemented by formula on gcu200/gcu210: tan(x) = sin(x) / cos(x). Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vatan(const VT &v)
```

Computes arc tangent per element: res[i] = atan(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vatan2(const VT &lhs, const VT &rhs)
```

Computes arc tangent of lhs / rhs per element: res[i] = atan2(lhs[i] / rhs[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Dividend vector.
- **rhs** -- Divisor vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vtanh(const VT &v)
```

Computes hyperbolic tangent per element: res[i] = tanh(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vatanh(const VT &v)
```

Computes inverse hyperbolic tangent per element: res[i] = atanh(v[i]).

**Note:**

Implemented by formula: atanh(x) = (log(1 + x) - log(1 - x)) / 2. Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vsin(const VT &v)
```

Computes sine per element: res[i] = sin(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vasin(const VT &v)
```

Computes arc sine per element: res[i] = asin(v[i]).

**Note:**

Implemented by formula on gcu200/gcu210: PI / 2 - acos(x) Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vsinh(const VT &v)
```

Computes hyperbolic sine per element: res[i] = sinh(v[i]).

**Note:**

Implemented by formula on gcu200/gcu210: sinh(x) = (exp(x) - exp(-x)) / 2. Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vasinh(const VT &v)
```

Computes inverse hyperbolic sine per element: res[i] = asinh(v[i]).

**Note:**

Implemented by formula: asinh(x) = log(x + sqrt(1 + x * x)). Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vcos(const VT &v)
```

Computes cosine per element: res[i] = cos(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vacos(const VT &v)
```

Computes arc cosine per element: res[i] = acos(v[i]).

**Note:**

Implemented by formula on gcu200/gcu210: acos(x) = x >= 0 ? atan(sqrt((1 - x * x) / (x * x))) : PI - atan(sqrt((1 - x * x) / (x * x))). Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vcosh(const VT &v)
```

Computes hyperbolic cosine per element: res[i] = cosh(v[i]).

**Note:**

Implemented by formula on gcu200/gcu210: cosh(x) = (exp(x) + exp(-x)) / 2. Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vacosh(const VT &v)
```

Computes inverse hyperbolic cosine per element: res[i] = acosh(v[i]).

**Note:**

Implemented by formula: `acosh(x) = 2 * log(sqrt((x + 1) / 2) + sqrt((x - 1) / 2))`.

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vabs(const VT &v)
```

Computes absolute value per element: res[i] = abs(v[i]).

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vneg(const VT &v)
```

Changes sign of the vector per element: res[i] = -v[i].

**Note:**

Supported vector types: vchar/vshort/vint/vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vsqrt(const VT &v)
```

Computes square root per element: res[i] = sqrt(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vrsqrt(const VT &v)
```

Computes reciprocal square root per element: res[i] = rsqrt(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vfloor(const VT &v)
```

Rounds the input vector downward to the largest integral value that is not greater than the original value per element: res[i] = floor(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vceil(const VT &v)
```

Rounds the input vector upward to the smallest integral value that is not less than the input vector per element: res[i] = ceil(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vround(const VT &v)
```

Rounds to nearest integral value, with halfway cases rounded away from zero per element: res[i] = round(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vtrunc(const VT &v)
```

Rounds toward zero per element: res[i] = trunc(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vrint(const VT &v)
```

Rounds to nearest even integral value per element: res[i] = rint(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vexp(const VT &v)
```

Computes base-e exponential function per element: res[i] = e ^ v[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vexpm1(const VT &v)
```

Computes base-e exponential minus one per element: res[i] = (e ^ v[i]) - 1.

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vexp2(const VT &v)
```

Computes binary (base-2) exponential function per element: res[i] = 2 ^ v[i].

**Note:**

Implemented by formula: exp2(x) = exp(x * log(2)). Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vlog(const VT &v)
```

Computes natural logarithm per element: res[i] = log(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vlog1p(const VT &v)
```

Computes natural logarithm of one plus the input value per element: res[i] = log(1 + v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vlog2(const VT &v)
```

Computes binary (base-2) logarithm per element: res[i] = log2(v[i]).

**Note:**

Implemented by formula: log2(x) = log(x) / log(2). Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vlog10(const VT &v)
```

Computes common (base-10) logarithm per element: res[i] = log10(v[i]).

**Note:**

Implemented by formula: log10(x) = log(x) / log(10). Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vlogb(const VT &v)
```

Computes the exponent of v per element, which is the integral part of vlog2 |v|: res[i] = logb(v[i]).

**Note:**

Implemented by formula: logb(x) = floor(log(abs(x)) / log(2)). Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename INT_VT, typename VT>KRT_API INT_VT vilogb(const VT &v)
```

Computes the exponent of v per element, which is the integral part of vlog2 |v|, and cast the result to integral type: res[i] = ilogb(v[i]).

**Note:**

Implemented by formula: ilogb(x) = integer(logb(x)). Supported vector types: vhalf/vbfloat -> vshort, vfloat -> vint.

**Template Parameters:**

- **INT_VT** -- Integral vector type.
- **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vpower(const VT &lhs, const VT &rhs)
```

Computes lhs raised to the power rhs per element: res[i] = lhs[i] ^ rhs[i].

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Base vector.
- **rhs** -- Exponent vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vgelu(const VT &v)
```

Computes Gaussian Error Linear Unit (GELU) activation function per element: res[i] = gelu(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vsoftplus(const VT &v)
```

Computes vlog(vexp(v) + 1) per element: res[i] = log((e ^ v[i]) + 1).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vsigmoid(const VT &v)
```

Computes sigmoid activation function per element： res[i] = sigmoid(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vdim(const VT &lhs, const VT &rhs)
```

Computes the positive difference between lhs and rhs per element: res[i] = lhs[i] > rhs[i] ? lhs[i] - rhs[i] : 0.

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector.
- **rhs** -- Another vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vhypot(const VT &lhs, const VT &rhs)
```

Computes hypotenuse of a right-angled triangle whose legs are lhs and rhs per element： res[i] = sqrt((lhs[i] ^ 2) + (rhs[i] ^ 2)).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector.
- **rhs** -- Another vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vcopysign(const VT &lhs, const VT &rhs)
```

Returns a vector with the magnitude of lhs and the sign of rhs per element: res[i] = copysign(lhs[i], rhs[i]).

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Magnitude vector
- **rhs** -- Sign vector.

**Returns:** Result vector.

```cpp
template<typename BOOL_VT, typename VT>KRT_API BOOL_VT visnan(const VT &v)
```

Returns if the vector is NaN (Not-A-Number) per element: res[i] = isnan(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat -> vushort, vfloat -> vuint.

**Template Parameters:**

- **BOOL_VT** -- Bool vector type. Boolean vector is unsigned integral vector, whose element bit width is the same as the input vector. For TRUE value, all bits are set to 1, and for FALSE value, all bits are set to 0.
- **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename BOOL_VT, typename VT>KRT_API BOOL_VT visfinite(const VT &v)
```

Returns if the vector is finite per element: res[i] = isfinite(v[i]).

**Note:**

Supported vector types: vhalf/vbfloat -> vushort, vfloat -> vuint.

**Template Parameters:**

- **BOOL_VT** -- Bool vector type. Boolean vector is unsigned integral vector, whose element bit width is the same as the input vector. For TRUE value, all bits are set to 1, and for FALSE value, all bits are set to 0.
- **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vmax(const VT &lhs, const VT &rhs)
```

Returns the largest of two vectors per element: res[i] = max(lhs[i], rhs[i]).

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector.
- **rhs** -- Another vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vmin(const VT &lhs, const VT &rhs)
```

Returns the smallest of two vectors per element: res[i] = min(lhs[i], rhs[i]).

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vbfloat/vfloat.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector.
- **rhs** -- Another vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vand(const VT &lhs, const VT &rhs)
```

Computes bitwise AND per element: res[i] = lhs[i] & rhs[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector.
- **rhs** -- Another vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vor(const VT &lhs, const VT &rhs)
```

Computes bitwise OR per element: res[i] = lhs[i] | rhs[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector.
- **rhs** -- Another vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vxor(const VT &lhs, const VT &rhs)
```

Computes bitwise XOR per element: res[i] = lhs[i] ^ rhs[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector.
- **rhs** -- Another vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vnot(const VT &v)
```

Computes bitwise NOT per element: res[i] = ~v[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:** **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vshl(const VT &lhs, const VT &rhs)
```

Shifts lhs left per element, by rhs bits per element: res[i] = lhs[i] << rhs[i].

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector to be shifted.
- **rhs** -- Vector of shift bit num.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vshr(const VT &lhs, const VT &rhs)
```

Shifts lhs right per element, by rhs bits per element: res[i] = lhs[i] >> rhs[i]. For signed types, uses arithmetic shift. For unsigned types, uses logical shift.

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector to be shifted.
- **rhs** -- Vector of shift bits.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vshli(const VT &v, int bits)
```

Shifts vector left per element, by rhs bits: res[i] = v[i] << bits.

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **v** -- Vector.
- **bits** -- Shift bit num.

**Returns:** Result vector.

```cpp
template<typename VT>KRT_API VT vshri(const VT &v, int bits)
```

Shifts vector right per element, by rhs bits. res[i] = v[i] >> bits. For signed types, uses arithmetic shift. For unsigned types, uses logical shift.

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint.

**Template Parameters:** **VT** -- Vector type.

**Parameters:**

- **v** -- Vector.
- **bits** -- Shift bit num.

**Returns:** Result vector.

```cpp
template<typename BOOL_VT, typename VT>KRT_API BOOL_VT veq(const VT &lhs, const VT &rhs)
```

Compares if two vectors are equal per element: res[i] = lhs[i] == rhs[i].

**Note:**

Supported vector types: vchar/vuchar -> vuchar, vshort/vushort/vhalf/vbfloat -> vushort, vint/vuint/vfloat -> vuint.

**Template Parameters:**

- **BOOL_VT** -- Bool vector type. Boolean vector is unsigned integral vector, whose element bit width is the same as the input vector. For TRUE value, all bits are set to 1, and for FALSE value, all bits are set to 0.
- **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector.
- **rhs** -- Another vector.

**Returns:** Result vector.

```cpp
template<typename BOOL_VT, typename VT>KRT_API BOOL_VT vne(const VT &lhs, const VT &rhs)
```

Compares if two vectors are not equal per element: res[i] = lhs[i] != rhs[i].

**Note:**

Supported vector types: vchar/vuchar -> vuchar, vshort/vushort/vhalf/vbfloat -> vushort, vint/vuint/vfloat -> vuint.

**Template Parameters:**

- **BOOL_VT** -- Bool vector type. Boolean vector is unsigned integral vector, whose element bit width is the same as the input vector. For TRUE value, all bits are set to 1, and for FALSE value, all bits are set to 0.
- **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector.
- **rhs** -- Another vector.

**Returns:** Result vector.

```cpp
template<typename BOOL_VT, typename VT>KRT_API BOOL_VT vlt(const VT &lhs, const VT &rhs)
```

Compares if lhs is less than rhs per element: res[i] = lhs[i] < rhs[i].

**Note:**

Supported vector types: vchar/vuchar -> vuchar, vshort/vushort/vhalf/vbfloat -> vushort, vint/vuint/vfloat -> vuint.

**Template Parameters:**

- **BOOL_VT** -- Bool vector type. Boolean vector is unsigned integral vector, whose element bit width is the same as the input vector. For TRUE value, all bits are set to 1, and for FALSE value, all bits are set to 0.
- **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector.
- **rhs** -- Another vector.

**Returns:** Result vector.

```cpp
template<typename BOOL_VT, typename VT>KRT_API BOOL_VT vle(const VT &lhs, const VT &rhs)
```

Compares if lhs is less than or equal to rhs per element: res[i] = lhs[i] <= rhs[i].

**Note:**

Supported vector types: vchar/vuchar -> vuchar, vshort/vushort/vhalf/vbfloat -> vushort, vint/vuint/vfloat -> vuint.

**Template Parameters:**

- **BOOL_VT** -- Bool vector type. Boolean vector is unsigned integral vector, whose element bit width is the same as the input vector. For TRUE value, all bits are set to 1, and for FALSE value, all bits are set to 0.
- **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector.
- **rhs** -- Another vector.

**Returns:** Result vector.

```cpp
template<typename BOOL_VT, typename VT>KRT_API BOOL_VT vgt(const VT &lhs, const VT &rhs)
```

Compares if lhs is greater than rhs per element: res[i] = lhs[i] > rhs[i].

**Note:**

Supported vector types: vchar/vuchar -> vuchar, vshort/vushort/vhalf/vbfloat -> vushort, vint/vuint/vfloat -> vuint.

**Template Parameters:**

- **BOOL_VT** -- Bool vector type. Boolean vector is unsigned integral vector, whose element bit width is the same as the input vector. For TRUE value, all bits are set to 1, and for FALSE value, all bits are set to 0.
- **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector.
- **rhs** -- Another vector.

**Returns:** Result vector.

```cpp
template<typename BOOL_VT, typename VT>KRT_API BOOL_VT vge(const VT &lhs, const VT &rhs)
```

Compares if lhs is greater than or equal to rhs per element: res[i] = lhs[i] >= rhs[i].

**Note:**

Supported vector types: vchar/vuchar -> vuchar, vshort/vushort/vhalf/vbfloat -> vushort, vint/vuint/vfloat -> vuint.

**Template Parameters:**

- **BOOL_VT** -- Bool vector type. Boolean vector is unsigned integral vector, whose element bit width is the same as the input vector. For TRUE value, all bits are set to 1, and for FALSE value, all bits are set to 0.
- **VT** -- Vector type.

**Parameters:**

- **lhs** -- Vector.
- **rhs** -- Another vector.

**Returns:** Result vector.

```cpp
template<typename VT, typename BOOL_VT>KRT_API VT vselect(const BOOL_VT &cond, const VT &lhs, const VT &rhs)
```

Select from two vectors by condition per element: res[i] = cond[i] ? lhs[i] : rhs[i].

**Note:**

Supported vector types: <vchar/vuchar, vuchar>, <vshort/vushort/vhalf/vbfloat, vushort>, <vint/vuint/vfloat, vuint>.

**Template Parameters:**

- **VT** -- Vector type.
- **BOOL_VT** -- Bool vector type. Boolean vector is unsigned integral vector, whose element bit width is the same as the input vector. For TRUE value, all bits are set to 1, and for FALSE value, all bits are set to 0.

**Parameters:**

- **cond** -- Condition vector.
- **lhs** -- Candidate vector.
- **rhs** -- Another candidate vector.

**Returns:** Result vector.

```cpp
template<typename VT, typename T>KRT_API VT vbroadcast(const T &val)
```

Returns a vector with all elements set to the specified value: res[i] = val. The scalar type should match the vector element type.

**Note:**

Supported vector types: <vchar, char>, <vuchar, unsigned char>, <vshort, short>, <vushort, unsigned short>, <vint, int>, <vuint, unsigned int>, <vhalf, half>, <vbfloat, bfloat>, <vfloat, float>.

**Template Parameters:**

- **VT** -- Vector type.
- **T** -- Scalar type.

**Parameters:** **val** -- Scalar value.

**Returns:** Result vector.

```cpp
template<typename TO_VT, typename FROM_VT, RoundingMode mode = RM_DEFAULT>KRT_API TO_VT vpack2(const FROM_VT &v1, const FROM_VT &v2)
```

Packs two vectors into one vector. The values will be cast. And the element bit width of the source vector should be 2 times of the element bit width of the target vector.

**Note:**

Supported vector types: vshort -> vchar, vushort -> vuchar, vint -> vshort, vint -> vhalf, vint -> vbfloat, vuint -> vushort, vuint -> vhalf, vuint -> vbfloat, vfloat -> vhalf, vfloat -> vbfloat, vfloat -> vshort, vhalf -> vchar, vbfloat -> vchar.

**Template Parameters:**

- **TO_VT** -- Target vector type.
- **FROM_VT** -- Source vector type.
- **mode** -- Rounding mode.

**Parameters:**

- **v1** -- Source vector.
- **v2** -- Another source vector.

**Returns:** Packed vector.

```cpp
template<typename TO_VT, typename FROM_VT>KRT_API TO_VT vpack2rn(const FROM_VT &v1, const FROM_VT &v2)
```

Packs two floating vectors into one integral vector. The values will be cast by rounding to nearest even. And the element bit width of the source vector should be 2 times of the element bit width of the target vector.

**Note:**

Supported vector types: vfloat -> vshort, vhalf -> vchar, vbfloat -> vchar.

**Template Parameters:**

- **TO_VT** -- Target vector type.
- **FROM_VT** -- Source vector type.

**Parameters:**

- **v1** -- Source vector.
- **v2** -- Another source vector.

**Returns:** Packed vector.

```cpp
template<typename TO_VT, typename FROM_VT>KRT_API TO_VT vpack2rz(const FROM_VT &v1, const FROM_VT &v2)
```

Packs two floating vectors into one integral vector. The values will be cast by rounding toward zero. And the element bit width of the source vector should be 2 times of the element bit width of the target vector.

**Note:**

Supported vector types: vfloat -> vshort, vhalf -> vchar, vbfloat -> vchar.

**Template Parameters:**

- **TO_VT** -- Target vector type.
- **FROM_VT** -- Source vector type.

**Parameters:**

- **v1** -- Source vector.
- **v2** -- Another source vector.

**Returns:** Packed vector.

```cpp
template<typename TO_VT, typename FROM_VT, RoundingMode mode = RM_DEFAULT>KRT_API TO_VT vpack4(const FROM_VT &v1, const FROM_VT &v2, const FROM_VT &v3, const FROM_VT &v4)
```

Packs four vectors into one vector. The values will be cast. And the element bit width of the source vector should be 4 times of the element bit width of the target vector.

**Note:**

Supported vector types: vint -> vchar, vuint -> vuchar, vfloat -> vchar.

**Template Parameters:**

- **TO_VT** -- Target vector type.
- **FROM_VT** -- Source vector type.
- **mode** -- Rounding mode.

**Parameters:**

- **v1** -- Source vector 1.
- **v2** -- Source vector 2.
- **v3** -- Source vector 3.
- **v4** -- Source vector 4.

**Returns:** Packed vector.

```cpp
template<typename TO_VT, typename FROM_VT>KRT_API TO_VT vpack4rn(const FROM_VT &v1, const FROM_VT &v2, const FROM_VT &v3, const FROM_VT &v4)
```

Packs four floating vectors into one integral vector. The values will be cast by rounding to nearest even. And the element bit width of the source vector should be 4 times of the element bit width of the target vector.

**Note:**

Supported vector type: vfloat -> vchar.

**Template Parameters:**

- **TO_VT** -- Target vector type.
- **FROM_VT** -- Source vector type.

**Parameters:**

- **v1** -- Source vector 1.
- **v2** -- Source vector 2.
- **v3** -- Source vector 3.
- **v4** -- Source vector 4.

**Returns:** Packed vector.

```cpp
template<typename TO_VT, typename FROM_VT>KRT_API TO_VT vpack4rz(const FROM_VT &v1, const FROM_VT &v2, const FROM_VT &v3, const FROM_VT &v4)
```

Packs four floating vectors into one integral vector. The values will be cast by rounding toward zero. And the element bit width of the source vector should be 4 times of the element bit width of the target vector.

**Note:**

Supported vector type: vfloat -> vchar.

**Template Parameters:**

- **TO_VT** -- Target vector type.
- **FROM_VT** -- Source vector type.

**Parameters:**

- **v1** -- Source vector 1.
- **v2** -- Source vector 2.
- **v3** -- Source vector 3.
- **v4** -- Source vector 4.

**Returns:** Packed vector.

```cpp
template<typename TO_VT, typename FROM_VT, RoundingMode mode = RM_DEFAULT>KRT_API TO_VT vunpack0(const FROM_VT &v)
```

Unpacks a vector from another vector. The values will be cast. If the element bit width of the target vector is 2 times of the element bit width of the source vector, the first half of the elements will be selected. If the element bit width of the target vector is 4 times of the element bit width of the source vector, the first quarter of the elements will be selected. Other cases are not supported.

**Note:**

Supported vector types: vchar -> vshort, vchar -> vint, vchar -> vhalf, vchar -> vbfloat, vchar -> vfloat, vuchar -> vushort, vuchar -> vuint, vuchar -> vhalf, vuchar -> vbfloat, vuchar -> vfloat, vshort -> vint, vshort -> vfloat, vushort -> vuint, vushort -> vfloat, vhalf -> vint, vhalf -> vfloat, vbfloat -> vint, vbfloat -> vfloat.

**Template Parameters:**

- **TO_VT** -- Target vector type.
- **FROM_VT** -- Source vector type.
- **mode** -- Rounding mode.

**Parameters:** **v** -- Source vector.

**Returns:** Unpacked vector.

```cpp
template<typename TO_VT, typename FROM_VT>KRT_API TO_VT vunpack0rn(const FROM_VT &v)
```

Unpacks an integral vector from a floating vector. The values will be cast by rounding to nearest even. If the element bit width of the target vector is 2 times of the element bit width of the source vector, the first half of the elements will be selected. If the element bit width of the target vector is 4 times of the element bit width of the source vector, the first quarter of the elements will be selected. Other cases are not supported.

**Note:**

Supported vector types: vhalf -> vint, vbfloat -> vint.

**Template Parameters:**

- **TO_VT** -- Target vector type.
- **FROM_VT** -- Source vector type.

**Parameters:** **v** -- Source vector.

**Returns:** Unpacked vector.

```cpp
template<typename TO_VT, typename FROM_VT>KRT_API TO_VT vunpack0rz(const FROM_VT &v)
```

Unpacks an integral vector from a floating vector. The values will be cast by rounding toward zero. If the element bit width of the target vector is 2 times of the element bit width of the source vector, the first half of the elements will be selected. If the element bit width of the target vector is 4 times of the element bit width of the source vector, the first quarter of the elements will be selected. Other cases are not supported.

**Note:**

Supported vector types: vhalf -> vint, vbfloat -> vint.

**Template Parameters:**

- **TO_VT** -- Target vector type.
- **FROM_VT** -- Source vector type.

**Parameters:** **v** -- Source vector.

**Returns:** Unpacked vector.

```cpp
template<typename TO_VT, typename FROM_VT, RoundingMode mode = RM_DEFAULT>KRT_API TO_VT vunpack1(const FROM_VT &v)
```

Unpacks a vector from another vector. The values will be cast. If the element bit width of the target vector is 2 times of the element bit width of the source vector, the second half of the elements will be selected. If the element bit width of the target vector is 4 times of the element bit width of the source vector, the second quarter of the elements will be selected. Other cases are not supported.

**Note:**

Supported vector types: vchar -> vshort, vchar -> vint, vchar -> vhalf, vchar -> vbfloat, vchar -> vfloat, vuchar -> vushort, vuchar -> vuint, vuchar -> vhalf, vuchar -> vbfloat, vuchar -> vfloat, vshort -> vint, vshort -> vfloat, vushort -> vuint, vushort -> vfloat, vhalf -> vint, vhalf -> vfloat, vbfloat -> vint, vbfloat -> vfloat.

**Template Parameters:**

- **TO_VT** -- Target vector type.
- **FROM_VT** -- Source vector type.
- **mode** -- Rounding mode.

**Parameters:** **v** -- Source vector.

**Returns:** Unpacked vector.

```cpp
template<typename TO_VT, typename FROM_VT>KRT_API TO_VT vunpack1rn(const FROM_VT &v)
```

Unpacks an integral vector from a floating vector. The values will be cast by rounding to nearest even. If the element bit width of the target vector is 2 times of the element bit width of the source vector, the second half of the elements will be selected. If the element bit width of the target vector is 4 times of the element bit width of the source vector, the second quarter of the elements will be selected. Other cases are not supported.

**Note:**

Supported vector types: vhalf -> vint, vbfloat -> vint.

**Template Parameters:**

- **TO_VT** -- Target vector type.
- **FROM_VT** -- Source vector type.

**Parameters:** **v** -- Source vector.

**Returns:** Unpacked vector.

```cpp
template<typename TO_VT, typename FROM_VT>KRT_API TO_VT vunpack1rz(const FROM_VT &v)
```

Unpacks an integral vector from a floating vector. The values will be cast by rounding toward zero. If the element bit width of the target vector is 2 times of the element bit width of the source vector, the second half of the elements will be selected. If the element bit width of the target vector is 4 times of the element bit width of the source vector, the second quarter of the elements will be selected. Other cases are not supported.

**Note:**

Supported vector types: vhalf -> vint, vbfloat -> vint.

**Template Parameters:**

- **TO_VT** -- Target vector type.
- **FROM_VT** -- Source vector type.

**Parameters:** **v** -- Source vector.

**Returns:** Unpacked vector.

```cpp
template<typename TO_VT, typename FROM_VT, RoundingMode mode = RM_DEFAULT>KRT_API TO_VT vunpack2(const FROM_VT &v)
```

Unpacks a vector from another vector. The values will be cast. If the element bit width of the target vector is 4 times of the element bit width of the source vector, the third quarter of the elements will be selected. Other cases are not supported.

**Note:**

Supported vector types: vchar -> vint, vchar -> vfloat, vuchar -> vuint, vuchar -> vfloat.

**Template Parameters:**

- **TO_VT** -- Target vector type.
- **FROM_VT** -- Source vector type.
- **mode** -- Rounding mode.

**Parameters:** **v** -- Source vector.

**Returns:** Unpacked vector.

```cpp
template<typename TO_VT, typename FROM_VT, RoundingMode mode = RM_DEFAULT>KRT_API TO_VT vunpack3(const FROM_VT &v)
```

Unpacks a vector from another vector. The values will be cast. If the element bit width of the target vector is 4 times of the element bit width of the source vector, the fourth quarter of the elements will be selected. Other cases are not supported.

**Note:**

Supported vector types: vchar -> vint, vchar -> vfloat, vuchar -> vuint, vuchar -> vfloat.

**Template Parameters:**

- **TO_VT** -- Target vector type.
- **FROM_VT** -- Source vector type.
- **mode** -- Rounding mode.

**Parameters:** **v** -- Source vector.

**Returns:** Unpacked vector.

```cpp
template<int part, typename TO_VT, typename FROM_VT, RoundingMode mode = RM_DEFAULT>KRT_API TO_VT vunpack(const FROM_VT &v)
```

Unpacks a vector from another vector. The values will be cast. Refers to vunpack0/vunpack1/vunpack2/vunpack3 for supported scenarios.

**Template Parameters:**

- **part** -- Which part to unpack.
- **TO_VT** -- Target vector type.
- **FROM_VT** -- Source vector type.
- **mode** -- Rounding mode.

**Parameters:** **v** -- Source vector.

**Returns:** Unpacked vector.

```cpp
template<typename TO_VT, typename FROM_VT>KRT_API TO_VT vget_exponent(const FROM_VT &v)
```

Returns exponent part of the vector per element.

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **TO_VT** -- Target vector type.
- **FROM_VT** -- Source vector type.

**Parameters:** **v** -- Source vector.

**Returns:** Result vector.

```cpp
template<typename TO_VT, typename FROM_VT>KRT_API TO_VT vget_mantissa(const FROM_VT &v)
```

Returns mantissa part of the vector per element.

**Note:**

Supported vector types: vhalf/vbfloat/vfloat.

**Template Parameters:**

- **TO_VT** -- Target vector type.
- **FROM_VT** -- Source vector type.

**Parameters:** **v** -- Source vector.

**Returns:** Result vector.

```cpp
template<typename T, typename VT>KRT_API T vreduce_all(const VT &v)
```

Computes bitwise AND among all vector elements to a scalar.

**Note:**

Supported types: vchar -> char, vuchar -> unsigned char, vshort -> short, vushort -> unsgined short, vint -> int, vuint -> unsigned int.

**Template Parameters:**

- **T** -- Scalar type.
- **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Reduced scalar.

```cpp
template<typename T, typename VT>KRT_API T vreduce_any(const VT &v)
```

Computes bitwise OR among all vector elements to a scalar.

**Note:**

Supported types: vchar -> char, vuchar -> unsigned char, vshort -> short, vushort -> unsgined short, vint -> int, vuint -> unsigned int.

**Template Parameters:**

- **T** -- Scalar type.
- **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Reduced scalar.

```cpp
template<typename T, typename VT>KRT_API T vreduce_sum(const VT &v)
```

Sums all elements of the vector to a scalar.

**Note:**

Supported types: vchar -> int, vuchar -> unsigned int, vshort -> int, vushort -> unsigned int, vint -> int, vuint -> unsigned int, vhalf -> float, vbfloat -> float, vfloat -> float.

**Template Parameters:**

- **T** -- Scalar type.
- **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Reduced scalar.

```cpp
template<typename T, typename VT>KRT_API T vreduce_min(const VT &v)
```

Returns the minimum element of the vector.

**Note:**

Supported types: vchar -> char, vuchar -> unsigned char, vshort -> short, vushort -> unsigned short, vint -> int, vuint -> unsigned int, vhalf -> __fp16, vbfloat -> __bf16, vfloat -> float.

**Template Parameters:**

- **T** -- Scalar type.
- **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Reduced scalar.

```cpp
template<typename T, typename VT>KRT_API T vreduce_max(const VT &v)
```

Returns the maximum element of the vector.

**Note:**

Supported types: vchar -> char, vuchar -> unsigned char, vshort -> short, vushort -> unsigned short, vint -> int, vuint -> unsigned int, vhalf -> __fp16, vbfloat -> __bf16, vfloat -> float.

**Template Parameters:**

- **T** -- Scalar type.
- **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Reduced scalar.

```cpp
template<typename T, typename VT>KRT_API T vreduce_mean(const VT &v)
```

Returns the mean value of all elements of the vector.

**Note:**

Supported types: vchar -> int, vuchar -> unsigned int, vshort -> int, vushort -> unsigned int, vint -> int, vuint -> unsigned int, vhalf -> float, vbfloat -> float, vfloat -> float.

**Template Parameters:**

- **T** -- Scalar type.
- **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Reduced scalar.

```cpp
template<typename VT>KRT_API int vreduce_argmin(const VT &v)
```

Returns the index of the first found minimum element.

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vfloat.

**Template Parameters:**

- **T** -- Scalar type.
- **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Reduced scalar.

```cpp
template<typename VT>KRT_API int vreduce_argmax(const VT &v)
```

Returns the index of the first found maximum element.

**Note:**

Supported vector types: vchar/vuchar/vshort/vushort/vint/vuint/vhalf/vfloat.

**Template Parameters:**

- **T** -- Scalar type.
- **VT** -- Vector type.

**Parameters:** **v** -- Vector.

**Returns:** Reduced scalar.

### 2.5. Synchronization

This section describes functions related to synchronization.

```cpp
__device__ __forceinline__ void __fence_local_memory()
```

Fence local memory.

```cpp
__device__ __forceinline__ void __fence_shared_memory()
```

Fence shared memory.

```cpp
__device__ __forceinline__ void __fence_device_memory()
```

Fence device memory.

```cpp
__device__ __forceinline__ void __fence_global_memory()
```

Fence global memory.

```cpp
__device__ __forceinline__ void __syncsubthreads()
```

Synchronizes all subthreads within a thread.

```cpp
__device__ __forceinline__ void __syncthreads()
```

Synchronizes the threads in the current block.

```cpp
__device__ __forceinline__ void __syncblocks()
```

Synchronizes all threads in the current grid.
