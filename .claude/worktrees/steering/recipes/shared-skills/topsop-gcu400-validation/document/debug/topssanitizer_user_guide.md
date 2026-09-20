> Imported material source: `Doc/TopsSanitizer User Guide.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `TopsSanitizer User Guide`.

# TopsSanitizer User Guide

## 3. TopsSanitizer

### 3.1. 概述

TopsSanitizer 是 TopsPlatform 的开发工具中提供的一套功能正确性检测工具集。该套件包含多个子工具，支持对 GCU kernel 程序执行多种类型的检测。

目前已实现对 Memcheck、SyncCheck 工具的支持，可用于精确检测和定位 GCU kernel 程序中的内存访问越界和线程同步错误等问题。

### 3.2. 设计初衷

Enflame GCU 为开发者提供了强大的并行计算能力，支持通过 GCU kernel 程序实现高效的问题求解。然而，GCU kernel 应用通常并行运行数千个线程，程序中稍有不慎便可能引发内存访问错误或线程间执行顺序问题。

此类错误往往隐蔽难查，排查和调试过程十分耗时，且在线程数量极多的情况下，错误风险可能呈指数级增长。TopsSanitizer 正是为了解决这些问题而设计，帮助开发者及时发现并修复 GCU kernel 程序中的潜在缺陷。

### 3.3. 安装说明

TopsSanitizer 工具集随 TopsPlatform 安装包一同发布并安装。

### 3.4. 工具组件概览

TopsSanitizer 提供多个子工具，以支持不同类型的问题检测。目前已支持的工具包括：

- Memcheck：用于检测内存访问越界、非法访问及内存泄漏等问题，详见 Memcheck 工具。
- SyncCheck：用于检测线程间同步错误，详见 SyncCheck 工具。

### 3.5. 使用方法

可通过运行 `tops-sanitizer` 可执行文件来调用 TopsSanitizer 工具集，其基本命令格式如下：

```
tops-sanitizer [options] <app_name> [app options]
```

如需查看 `tops-sanitizer` 支持的所有命令行选项及其默认值，请参见 命令行选项。

#### 命令行选项

用户可以通过为 `tops-sanitizer` 指定命令行选项来自定义工具行为：

- 对于带参数的选项，用户可通过 `--option value` （或 `--option=value`） 的形式传递参数值。
- 对于无参数的选项，用户只需 `--option` 使能该选项即可。
- 通过指定 `--` 可显式终止选项列表，其后所有内容将被视为待运行的应用程序及其参数。

下表详细列出了 `tops-sanitizer` 支持的命令行选项：

- 第一列是传递给 `tops-sanitizer` 的选项名称。部分选项设有单字符简写形式（括号中标出），这类选项可通过单连字符调用，例如帮助选项可简写为 `-h` 。具有简写形式的选项无需赋值。
- 第二列列出了选项允许的取值。若值为用户自定义值，将以 `{}` 形式标注。接受任意数值的选项表示为 `{number}`。
- 第三列显示选项的默认值。某些选项的默认值可能因平台架构不同而有所差异。
- 第四列是对选项功能的简要说明。选项的详细描述请参见后续章节。

| 选项 | 可选值 | 默认值 | 描述 |
| --- | --- | --- | --- |
| `--help (-h)` | N/A | N/A | 显示帮助信息 |
| `--tool (-t)` | memcheck,<br>synccheck | memcheck | 指定使用的检测工具类型 |
| `--version` | N/A | N/A | 显示版本信息 |

| 选项 | 可选值 | 默认值/默认行为 | 描述 |
| --- | --- | --- | --- |
| `--asan-mode` | abort, debug | 仅输出必要的错误信息，不中断 GCU kernel 的执行 | 控制 Memcheck 的运行模式<br>- abort: 检测到问题后立即中断 GCU kernel 的执行<br>- debug: 输出额外的调试信息 |
| `--report-api-errors` | N/A | 禁用 | 启用对 Tops Runtime API 错误的检测与报告 |

## 4. Memcheck 工具

### 4.1. 概述

Memcheck 是 TopsSanitizer 提供的核心工具之一，主要用于检测和报告 GCU kernel 程序中的内存访问越界等问题。通过使用 Memcheck，开发者可以快速定位并修复潜在的内存错误，从而显著提升程序的稳定性和可靠性。

### 4.2. 支持检测的错误类型

下表总结了 Memcheck 工具当前支持的内存错误检测类型：

| 错误类型 | 支持的 device | memory 位置 | topscc 编译选项 | 参见（说明、建议、限制） |
| --- | --- | --- | --- | --- |
| SDTE/CDTE 访问越界 | GCU300<br>GCU400 | global/shared/local | `-fgcu-sanitize=[dte\|address]` | DTE检测 |
| vector load/store 指令越界 | GCU300<br>GCU400 | global/shared/local | `-fgcu-sanitize=[address]` | 向量IO指令检测 |
| MMU map/unmap 配对问题 | GCU300 | global | `-fgcu-sanitize=[dte\|address]` | MMU map/unmap 检测 |
| 内存泄漏 | GCU300<br>GCU400 | global/shared/local | N/A | 内存泄漏检测 |

**使用限制:**

1. 目前对于 global memory 的检测最多支持 100000 项的 memory range，对于 L1 和 L2 一共最多支持 32 项 memory range。
2. Memcheck 会占用少量 kernel 的 rodata 数据，可能会因 rodata 空间不够导致 tops-sanitizer 启动失败。
3. Memcheck 与 profiler 或 Synccheck 无法同时使用（Memcheck 运行期间不能有任何其它进程使用 profiler ）。

### 4.3. 使用方法

使用 Memcheck 工具进行内存检测，包括以下几个步骤：

1. 编译。

   使用 topscc 编译 GCU Kernel 程序时，需添加编译选项 `-fgcu-sanitize=[dte|address]` 以启用对应的内存检测功能。各选项的具体说明详见 Memcheck 功能。

   示例：
   ```
   topscc -ltops -arch gcu300 -O3 test.cpp -o test -fgcu-sanitize=dte
   ```

2. 运行。

   使用 tops-sanitizer 运行程序时，通过 `--tool memcheck` 显式启用 Memcheck 工具（默认已启用），可附加其他选项控制检测行为。完整的命令行选项详见 Memcheck 命令行选项。

   基本命令格式：
   ```
   tops-sanitizer --tool memcheck [sanitizer_options] app_name [app_options]
   ```

   示例：
   ```
   # 默认启用 Memcheck
   tops-sanitizer ./test

   # 显式启用 Memcheck 并设置 abort 模式
   tops-sanitizer --tool memcheck --asan-mode abort ./test
   ```

**Tip:**

建议配合 TopsGDB 使用，提升定位效率：

1. topscc 编译时除了添加 `-fgcu-sanitize=dte` 选项外，还需添加 `-g -fno-omit-frame-pointer` 选项以保留调试信息以及帧指针信息。

   示例：
   ```
   topscc -ltops -arch gcu300 -O3 test.cpp -o test -fgcu-sanitize=dte -g -fno-omit-frame-pointer
   ```

2. 使用 topsgdb 启动程序，并设置 Memcheck 命令行选项 `--asan-mode abort`。

   注意，在 `run` 程序前需设置 `set follow-fork-mode child`，以确保 topsgdb 跟踪子进程。Memcheck 检测到问题后，topsgdb 可自动捕获异常并中断 GCU kernel 的执行，开发者可通过 `bt` 命令查看调用栈信息及对应代码位置。更进一步的调试功能可参考 TopsGDB 用户手册。

   示例：
   ```
   $ topsgdb --args tops-sanitizer --tool memcheck --asan-mode abort ./test
   (gdb) set follow-fork-mode child
   (gdb) run
   ......
   ......
   [Switching to GCU thread device:0 sip:(0,0,0) coord:(0,0,0)]
   Received GCU signal SIGABRT, Kernel Aborted.
   abort () at <topscc-source>/topscc/kernel_rt/src/scorpio/builtins_impl.h:19
   19        int kernel_amos_tag = __gcu_movs_md24() >> 12 & 0xFF;
   (gdb) bt
   #0  abort () at <topscc-source>/topscc/kernel_rt/src/scorpio/builtins_impl.h:19
   #1  0x0000002a7d2641d0 in __asan_kernel_bound_check () from memory://1914#offset=0xd93e60&size=1949424
   #2  0x0000002a7d2756d0 in tops::dte_check_config_linear_copy(void*, void*, int, unsigned long long) ()
   from memory://1914#offset=0xd93e60&size=1949424
   #3  0x0000002a7d2f5b00 in tops::dte_check_full(tops::dte_ctx AS5*) ()
   from memory://1914#offset=0xd93e60&size=1949424
   #4  0x0000002a7d24cc90 in tops::dte_trigger(tops::dte_ctx AS5*) (dte_ctx=0x50000000000000)
   at /opt/tops/lib/clang/11.0.0/include/tops/__tops_dte_ext.h:1568
   #5  tops_dte_ctx_base_s::trigger (this=0x801c9ec00000008)
   at /opt/tops/lib/clang/11.0.0/include/tops/__tops_dte_ext.h:602
   #6  tops_dte_ctx_base_s::trigger_and_wait (this=0x801c9ec00000008)
   at /opt/tops/lib/clang/11.0.0/include/tops/__tops_dte_ext.h:612
   #7  tops::memcpy (ctx=..., dst=..., src=...)
   at /opt/tops/lib/clang/11.0.0/include/tops/__tops_dte_ext.h:1568
   #8  foo (from=<optimized out>, N=6) at test.cpp:12
   #9  0x0000002a7d249300 in __boot__ ()
   at <topscc-source>/topscc/kernel_rt/src/scorpio/boot_code_impl.h:1158
   (gdb)
   ```

### 4.4. 使用示例

#### DTE 检测

用于检测各类 DTE OP 在访问 L1/L2/L3 memory 时是否存在越界访问行为（不包括 stack memory）。

可通过添加 topscc 编译选项 `-fgcu-sanitize=dte` 或 `-fgcu-sanitize=address` 以启用此检查。

**Attention:**

对于 L2 上多块连续申请的 memory，Memcheck 检测时不会逐块区分，而是将其视为一个连续内存块统一进行检测。

例如，下面的代码申请了两块 128 字节的 memory，但在 Memcheck 检测过程中会将其视为连续的 256 字节的 memory。

```
__shared__ char a[128];
__shared__ char b[128];
```

下面的示例展示了一个典型的 DTE 访问越界的场景：

代码 4.4.1

DTE 检测示例代码——memcpy.cpp

```
#include <tcle.h>
#include <tops/tops_runtime.h>

__global__ void foo(char* from, unsigned N) {
    tops_dte_ctx_t ctx;
    tops::dte_scope s(ctx);
    __local__ char local_buffer[128];

    tops::mdspan src(tops::Global, from, N);
    tops::mdspan dst(tops::Local, local_buffer, N);

    // 这里会发生访问越界，因为 N 是 144，local_buffer 是 128
    tops::memcpy(ctx, dst, src);
}

int main() {
    char * in1;
    topsMalloc(&in1, 128);

    foo<<<1, 1>>>(in1, 144);

    topsFree(in1);
    return 0;
}
```

在这个例子中，local_buffer 的大小是 128 字节，但函数 foo 被调用时参数 N 传入的是 144，这意味着 dst 指向了 144 字节的 local memory，但实际只分配了 128 字节，因此会触发对 L1 memory 的访问越界。

代码 4.4.2

DTE 检测示例——编译运行

```
$ topscc -ltops -arch gcu300 -O3 memcpy.cpp -o memcpy -fgcu-sanitize=dte
$ tops-sanitizer --tool memcheck ./memcpy
[0, 0] [K-ASAN] runtime gcu sanitizer is enabled.
[0, 0] [K-ASAN]
===== ERROR: DTE LOAD Memory out of bound
======    required LOAD range is [0x2a7ddf4000, 0x2a7ddf4090) 144 bytes
======    not in allocated range (L3) [0x2a7ddf4000, 0x2a7ddf4080)
======    at code _Z3fooPcj: 0x2cfc0

[0, 0] [K-ASAN]
===== ERROR: DTE STORE Memory out of bound
======    required STORE range is [0x200, 0x290) 144 bytes
======    not in allocated range (L1) [0x200, 0x280)
======    at code _Z3fooPcj: 0x2da40

[0, 0] [K-ASAN] =============   asan report   =============
[0, 0] Totally 2 out-of-bounds memory accesses were found.
[0, 0] Legal Address Ranges:
[0, 0] L1 (1): [0x200, 0x280)
[0, 0] REG_MAPPED (1): [0x40000000, 0x80000000)
[0, 0] L3 (1): [0x2a7ddf4000, 0x2a7ddf4080)
[0, 0] [K-ASAN] ============= asan report end =============

[0, 0] [K-ASAN] Totally 1 mmu slots not unmap were found.
[0, 0] [K-ASAN] Problem Slot Ids and Address Ranges:
[0, 0] [K-ASAN] mmu slot 0 (mapped addr: [0x80000000 : 0x90000000], physical addr: [0x2a7dd00000 : 0x2a7de00000]).
```

Memcheck 报告了两处 DTE 访问越界的错误，分别为对 L1 memory 的 DTE STORE 和对 L3 memory 的 DTE LOAD 操作。并在最后对所有的越界访问进行了汇总，指出了所有合法的内存范围。

以其中一处 DTE LOAD 错误为例：

```
[0, 0] [K-ASAN]
===== ERROR: DTE LOAD Memory out of bound
======    required LOAD range is [0x2a7ddf4000, 0x2a7ddf4090) 144 bytes
======    not in allocated range (L3) [0x2a7ddf4000, 0x2a7ddf4080)
======    at code _Z3fooPcj: 0x2cfc0
```

报告中首先指出这是一个 DTE LOAD 的错误，接着指出了所需的 LOAD 范围是 [0x2a7ddf4000, 0x2a7ddf4090)，大小为 144 字节，但实际分配的范围是 [0x2a7ddf4000, 0x2a7ddf4080)，因此发生了越界访问。最后还给出了导致越界的指令位置，以便快速定位问题。

#### 向量IO指令检测

用于检测向量 Load/Store 指令在访问内存时是否发生越界。

可通过添加 topscc 编译选项 `-fgcu-sanitize=address` 以启用此检查。

**Attention:**

在 GCU300 上如果使用了 MMU （例如调用 `tops::map_mem` ），建议启用此检查；在 GCU400 上建议默认启用该检查。

下面的示例展示了一个典型的向量 IO 越界访问的场景：

代码 4.4.3

向量IO检测示例代码——vld_st.cpp

```
#include <tops/tops_runtime.h>
#include <tcle.h>

__global__ void foo() {
  auto *from = reinterpret_cast<__vector int*>(128);
  auto *to = reinterpret_cast<__vector int*>(1024);
  *to = *from + 1;
}

int main() {
  foo<<<1, 1>>>();
  return 0;
}
```

本示例中 `*to = *from + 1;` 使用的是向量寄存器间的 Load/Store 操作， `from` 和 `to` 指针分别设置在地址 128 和 1024。由于这两个地址不属于合法的内存范围，因此属于非法裸地址访问。

代码 4.4.4

向量IO检测示例——编译运行

```
$ topscc -ltops -arch gcu300 -O3 vld_st.cpp -o vld_st -fgcu-sanitize=address
$ tops-sanitizer --tool memcheck ./vld_st
[0, 0] [K-ASAN] runtime gcu sanitizer is enabled.
[0, 0] [K-ASAN]
===== ERROR: LD/ST LOAD Memory out of bound
======    required LOAD range is [0x80, 0x100) 128 bytes
======    not in any allocated ranges
======    at code _Z3foov: 0x3c90

[0, 0] =============   Legal Address Ranges   =============
[0, 0] REG_MAPPED (1): [0x40000000, 0x80000000)
[0, 0] ====================================================

[0, 0] [K-ASAN]
===== ERROR: LD/ST STORE Memory out of bound
======    required STORE range is [0x400, 0x480) 128 bytes
======    not in any allocated ranges
======    at code _Z3foov: 0x3d50

[0, 0] =============   Legal Address Ranges   =============
[0, 0] REG_MAPPED (1): [0x40000000, 0x80000000)
[0, 0] ====================================================

[0, 0] [K-ASAN] =============   asan report   =============
[0, 0] Totally 2 out-of-bounds memory accesses were found.
[0, 0] Legal Address Ranges:
[0, 0] REG_MAPPED (1): [0x40000000, 0x80000000)
[0, 0] [K-ASAN] ============= asan report end =============
```

Memcheck 报告了两处 LD/ST LOAD 和 STORE 越界访问的错误，分别为对 L1 memory 的 LD/ST LOAD 和对 L3 memory 的 LD/ST STORE 操作，指出越界的原因在于所需的 LOAD 和 STORE 范围不在任何已分配的范围内。并在最后对所有的越界访问进行了汇总，指出了所有合法的内存范围。

#### MMU map/unmap 检测

用于检测 sip MMU 在一个算子逻辑中是否配对使用，即确保对同一个 MMU slot 的使用顺序正确，例如应遵循 `map → unmap`，或 `map → remap... → unmap` 的逻辑时序。

可通过添加 topscc 编译选项 `-fgcu-sanitize=dte` 或 `-fgcu-sanitize=address` 以启用此检查。

下面的示例是一个典型的 map 后未 unmap 的场景：

代码 4.4.5

map/unmap 检测示例代码——test_map.cpp

```
#include <tcle.h>
#include <tops/tops_runtime.h>
#include <krt/mmu.h>

__global__ void foo(char* from) {
  unsigned int map_from = tops::map_mem(
              reinterpret_cast<generic_ptr>(from), 4 * sizeof(int));
  printf("from : 0x%llx\n", from);
  printf("map_from : 0x%x\n", map_from);
  // 算子结束前没有做 unmap，Memcheck 检测报错
}

int main() {
  char * in;
  topsMalloc(&in, 128);

  foo<<<1, 1>>>(in);

  topsFree(in);
  return 0;
}
```

在 foo 函数中使用 tops::map_mem 映射了一个内存区域，但没有对应的 unmap 操作，因此属于未配对使用 map/unmap 的问题。

代码 4.4.6

map/unmap 检测示例——编译运行

```
$ topscc -ltops -arch gcu300 -O3 test_map.cpp -o test_map -fgcu-sanitize=address
$ tops-sanitizer --tool memcheck ./test_map
[0, 0] [K-ASAN] runtime gcu sanitizer is enabled.
[0, 0] from : 0x2a7ddf4000
[0, 0] map_from : 0x800f4000
[0, 0] [K-ASAN] Totally 1 mmu slots not unmap were found.
[0, 0] [K-ASAN] Problem Slot Ids and Address Ranges:
[0, 0] [K-ASAN] mmu slot 0 (mapped addr: [0x80000000 : 0x90000000], physical addr: [0x2a7dd00000 : 0x2a7de00000]).
```

Memcheck 报告了一个 MMU slot 映射后未 unmap 的错误，并指出了未 unmap 的 slot ID 以及对应的物理地址范围。

#### 内存泄漏检测

用于检测 GCU kernel 程序中是否存在内存泄漏问题。

该功能无需添加 topscc 编译选项，此检查默认启用。

下面的示例是一个典型的内存泄漏的场景：

代码 4.4.7

内存泄漏检测示例代码——leak.cpp

```
#include <tcle.h>
#include <tops/tops_runtime.h>

__global__ void foo(char* from, unsigned N) {
  tops_dte_ctx_t ctx;
  tops::dte_scope s(ctx);
  __local__ char local_buffer[128];

  tops::mdspan src(tops::Global, from, N);
  tops::mdspan dst(tops::Local, local_buffer, N);

  tops::memcpy(ctx, dst, src);
}

int main() {
  char * in1;
  topsMalloc(&in1, 128);

  foo<<<1, 1>>>(in1, 128);

  // 返回前未释放内存，Memcheck 检测到内存泄漏
  return 0;
}
```

在这个例子中，`topsMalloc` 分配了 128 字节的内存，但在程序结束前并没有调用 `topsFree` 来释放这块内存，因此会导致内存泄漏。

代码 4.4.8

内存泄漏检测示例——编译运行

```
$ topscc -ltops --cuda-gpu-arch=gcu300 -o mem_leak mem_leak.cpp  //内存泄漏默认启用，无需添加编译选项
$ tops-sanitizer --tool memcheck ./mem_leak
[R-ASAN]
===== ERROR: detected device memory leak on device 0
======    1 device memory not released
leaked device memory [0x2a7ddf4000, 0x2a7ddf4080) allocated here:
Stack trace (most recent call last):
#0 /opt/tops/lib/libtopsrt.so.1  [0x7f4ac2137b2e]
#1 /opt/tops/lib/libtopsrt.so.1  [0x7f4abe62883e]
#2 /opt/tops/lib/libtopsrt.so.1  [0x7f4abe77b795]
#3 /opt/tops/lib/libtopsrt.so.1 topsMalloc [0x7f4abe77c74f]
#4 ./mem_leak  [0x401223]
#5 /lib/x86_64-linux-gnu/libc.so.6 __libc_start_main [0x7f4abc6bec87]
#6 ./mem_leak  [0x4010da]

[R-ASAN] ================ asan report ====================
total leaked device memory: 128 bytes
Leaked device memory ranges:
device 0 L3 (1): [0x2a7ddf4000, 0x2a7ddf4080)
[R-ASAN] ============== asan report end ==================
```

## 5. Synccheck 工具

### 5.1. 概述

Synccheck 是 TopsSanitizer 中用于检测 GCU kernel 程序中线程同步相关错误的工具，
可以检测在使用 `__syncthreads()`、 `__syncblocks()`、 `tops::sync_block_threads()`、 `tops::sync_grid_threads()` 及 `tops_barrier_t` 等同步原语时
是否存在非法或不一致的同步问题。

若检测出同步问题，Synccheck 会终止执行避免死锁导致程序 hang 住，并提供线程出错文件名和行号信息，以帮助开发者快速定位问题。

### 5.2. 支持检测的错误类型

Synccheck 工具当前支持检测的线程同步错误类型如下：

| 错误类型 | 支持的 device | topscc 编译选项 | 示例 |
| --- | --- | --- | --- |
| 仅部分线程调用同步 | GCU300 | `-fgcu-sanitize=sync` | 仅部分线程调用同步 |
| 同步原语不一致 | GCU300 | `-fgcu-sanitize=sync` | 同步原语不一致 |

**使用限制:**

1. Synccheck 会占用少量 kernel 的 rodata 数据，可能会因 rodata 空间不够导致 SyncCheck 启动失败。
2. Synccheck 无法与 profiler 或 Memcheck 同时使用（SyncCheck 运行期间不能有任何其它进程使用 profiler）。
3. Memcheck 运行后立刻运行 Synccheck 会出现问题，建议 efsmi -r 后重试。

| 错误类型 | 检测范围 | 支持的 device | topscc 编译选项 | 示例 |
| --- | --- | --- | --- | --- |
| 仅部分线程调用同步 | `__syncthreads()`<br>`__syncblocks()`<br>`tops::sync_block_threads()`<br>`tops::sync_grid_threads()`<br>`tops_barrier_t` | GCU300 | `-fgcu-sanitize=sync` | 仅部分线程调用同步 |
| 同步原语不一致 | `__syncthreads()`<br>`__syncblocks()`<br>`tops::sync_block_threads()`<br>`tops::sync_grid_threads()`<br>`tops_barrier_t` | GCU300 | `-fgcu-sanitize=sync` | 同步原语不一致 |

### 5.3. 使用方法

1. 编译。

   使用 topscc 编译 GCU Kernel 程序时，需添加编译选项 `-fgcu-sanitize=sync` 以启用线程同步检测。此外，建议添加 `-g` 选项以保留调试信息，用于显示同步错误的线程所在文件名与行号信息。

   示例：
   ```
   topscc -ltops -arch gcu300 -O3 synctest.cpp -o synctest -fgcu-sanitize=sync -g
   ```

2. 运行。

   使用 tops-sanitizer 运行程序时，通过 `--tool synccheck` 显式启用 Synccheck 工具。

   基本命令格式：
   ```
   tops-sanitizer --tool synccheck [sanitizer_options] app_name [app_options]
   ```

   示例：
   ```
   tops-sanitizer --tool synccheck ./synctest
   ```

### 5.4. 使用示例

#### 仅部分线程调用同步

由于编程过程中的疏忽，可能会将同步调用写在分支条件语句中，导致部分线程越过同步函数。
这种情况下部分线程会一直 wait 在 barrier 而导致程序 hang 住。

示例如下：

```
#include "tops/__tops_builtins.h"
#include <cstdio>
#include <krt/mmu.h>
#include <tcle.h>
#include <tops/__tops_sync.h>
#include <tops/tops_runtime.h>
__global__ __cooperative__ void myKernel(int* data) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx % 2 == 0) {
        int *data_ptr = reinterpret_cast<int *>(tops::map_mem(data, 24 * sizeof(int)));
        data_ptr[idx] = idx * 2;
        tops::unmap_mem(reinterpret_cast<uintptr_t>(data_ptr));
        __syncthreads(); // 部分线程在此处同步
    } else {
        int *data_ptr = reinterpret_cast<int *>(tops::map_mem(data, 24 * sizeof(int)));
        data_ptr[idx] = idx * 3;
        tops::unmap_mem(reinterpret_cast<uintptr_t>(data_ptr));
    }
}

int main() {
    topsInit(0);
    topsError_t err = topsSuccess;
    const int N = 2 * 12;
    int *h_data = reinterpret_cast<int *>(malloc(N * sizeof(int)));
    int *golden_data = reinterpret_cast<int *>(malloc(N * sizeof(int)));
    int* d_data = NULL;
    topsMalloc(reinterpret_cast<void **>(&d_data), N * sizeof(int));
    for (int i = 0; i < 2; i++) {
        for (int j = 0; j < 12; j++) {
            int idx = i * 12 + j;
            if (idx % 2 == 0) {
                golden_data[idx] = idx * 2;
            } else {
                golden_data[idx] = idx * 3;
            }
        }
    }
    myKernel<<<2, 12>>>(d_data);
    err = topsGetLastError();
    if (err != topsSuccess) {
        printf("Execute wrong!\n");
        exit(EXIT_FAILURE);
    }
    topsStreamSynchronize(0);
    topsMemcpy(h_data, d_data, N * sizeof(int), topsMemcpyDeviceToHost);
    for (int i = 0; i < N; ++i) {
        if (h_data[i] != golden_data[i]) {
        printf("Golden compare wrong!\n");
            exit(EXIT_FAILURE);
        }
    }
    topsFree(d_data);
    free(h_data);
    free(golden_data);
    return 0;
}
```

此示例中，我们 launch 了一个 blockDim 为 2，threadDim 为 12 的 kernel,
kernel 内部根据线程索引的奇偶性，分别执行不同的内存映射和写入操作。
偶数线程在写入后调用 __syncthreads() 进行同步，而奇数线程完全跳过同步操作，因此会导致仅部分线程调用同步的问题。

编译并使用 Synccheck 运行该程序:

代码 5.4.1

Synccheck 使用示例——编译运行

```
$ topscc -ltops -arch gcu300 -O3 divergence.cpp -o divergence -fgcu-sanitize=sync -g
$ tops-sanitizer --tool synccheck ./divergence
[0, 0] runtime gcu sync is enabled.
[1, 6] Sync error happened sync_check/divergence.cpp:13:9
[1, 2] Sync error happened sync_check/divergence.cpp:13:9
[1, 4] Sync error happened sync_check/divergence.cpp:13:9
[1, 8] Sync error happened sync_check/divergence.cpp:13:9
[1, 0] Sync error happened sync_check/divergence.cpp:13:9
[0, 2] Sync error happened sync_check/divergence.cpp:13:9
[0, 4] Sync error happened sync_check/divergence.cpp:13:9
[0, 0] Sync error happened sync_check/divergence.cpp:13:9
[0, 6] Sync error happened sync_check/divergence.cpp:13:9
[0, 10] Sync error happened sync_check/divergence.cpp:13:9
[0, 8] Sync error happened sync_check/divergence.cpp:13:9
[1, 10] Sync error happened sync_check/divergence.cpp:13:9
WW: [tid:0x7f7598525700] caps/runtime/efrt/src/driver/gcu_context_obj.cc:1179:submit_sip_assertion_task receive sip assertion!
EE: [tid:0x7f7598525700] caps/runtime/efrt/src/driver/gcu_context_obj.cc:1188:submit_sip_assertion_task ##abort as Detected SIP assert###
data: 0x00226000
terminate called after throwing an instance of 'std::runtime_error'
  what():  Detected SIP assert!!!
```

Synccheck 检测到同步错误并 abort 了程序的执行，明确定位到所有偶数线程在 `__syncthreads()` 处的同步失败，同时提供了源代码位置信息。
检查源码后发现是由于 `__syncthreads()` 位于条件语句内部，导致奇数线程未调用同步原语。

#### 同步原语不一致

跨分支混合使用不同 barrier （如 `__syncthreads()` 和 `__syncblocks()`）会引发同步原语的不一致。
该问题也会导致部分线程会一直 wait 在 barrier 而导致程序 hang 住。

示例如下：

```
#include "tops/__tops_builtins.h"
#include <cstdio>
#include <krt/mmu.h>
#include <tcle.h>
#include <tops/__tops_sync.h>
#include <tops/tops_runtime.h>
__global__ __cooperative__ void myKernel(int* data) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx % 2 == 0) {
        int *data_ptr = reinterpret_cast<int *>(tops::map_mem(data, 24 * sizeof(int)));
        data_ptr[idx] = idx * 2;
        tops::unmap_mem(reinterpret_cast<uintptr_t>(data_ptr));
        __syncthreads(); // 偶数线程调用 __syncthreads()
    } else {
        int *data_ptr = reinterpret_cast<int *>(tops::map_mem(data, 24 * sizeof(int)));
        data_ptr[idx] = idx * 3;
        tops::unmap_mem(reinterpret_cast<uintptr_t>(data_ptr));
        __syncblocks(); // 奇数线程调用 __syncblocks()
    }
}

int main() {
    topsInit(0);
    topsError_t err = topsSuccess;
    const int N = 2 * 12;
    int *h_data = reinterpret_cast<int *>(malloc(N * sizeof(int)));
    int *golden_data = reinterpret_cast<int *>(malloc(N * sizeof(int)));
    int* d_data = NULL;
    topsMalloc(reinterpret_cast<void **>(&d_data), N * sizeof(int));
    for (int i = 0; i < 2; i++) {
        for (int j = 0; j < 12; j++) {
            int idx = i * 12 + j;
            if (idx % 2 == 0) {
                golden_data[idx] = idx * 2;
            } else {
                golden_data[idx] = idx * 3;
            }
        }
    }
    myKernel<<<2, 12>>>(d_data);
    err = topsGetLastError();
    if (err != topsSuccess) {
        printf("Execute wrong!\n");
        exit(EXIT_FAILURE);
    }
    topsStreamSynchronize(0);
    topsMemcpy(h_data, d_data, N * sizeof(int), topsMemcpyDeviceToHost);
    for (int i = 0; i < N; ++i) {
        if (h_data[i] != golden_data[i]) {
        printf("Golden compare wrong!\n");
            exit(EXIT_FAILURE);
        }
    }
    topsFree(d_data);
    free(h_data);
    free(golden_data);
    return 0;
}
```

此示例中，偶数线程调用了 `__syncthreads()` ，而奇数线程调用了 `__syncblocks()` 。

编译并使用 Synccheck 运行该程序:

代码 5.4.2

Synccheck 使用示例——编译运行

```
$ topscc -ltops -arch gcu300 -O3 inconsistent.cpp -o inconsistent -fgcu-sanitize=sync -g
$ tops-sanitizer --tool synccheck ./inconsistent
[0, 0] runtime gcu sync is enabled.
[1, 2] Sync error happened sync_check/inconsistent.cpp:13:9
[1, 10] Sync error happened sync_check/inconsistent.cpp:13:9
[1, 6] Sync error happened sync_check/inconsistent.cpp:13:9
[0, 2] Sync error happened sync_check/inconsistent.cpp:13:9
[0, 4] Sync error happened sync_check/inconsistent.cpp:13:9
[0, 10] Sync error happened sync_check/inconsistent.cpp:13:9
[0, 0] Sync error happened sync_check/inconsistent.cpp:13:9
[1, 8] Sync error happened sync_check/inconsistent.cpp:13:9
[1, 0] Sync error happened sync_check/inconsistent.cpp:13:9
[0, 8] Sync error happened sync_check/inconsistent.cpp:13:9
[1, 4] Sync error happened sync_check/inconsistent.cpp:13:9
[0, 6] Sync error happened sync_check/inconsistent.cpp:13:9
WW: [tid:0x7fc467914700] caps/runtime/efrt/src/driver/gcu_context_obj.cc:1179:submit_sip_assertion_task receive sip assertion!
EE: [tid:0x7fc467914700] caps/runtime/efrt/src/driver/gcu_context_obj.cc:1188:submit_sip_assertion_task ##abort as Detected SIP assert###
data: 0x00222000
terminate called after throwing an instance of 'std::runtime_error'
  what():  Detected SIP assert!!!
```

Synccheck 检测到同步错误并 abort 了程序的执行，明确定位到所有偶数线程在 `__syncthreads()` 处同步失败，同时提供了源代码位置信息。
检查源码后发现是由于不同分支调用了不同的同步函数导致同步错误。
