> Imported material source: `Doc/TopsGDB User Manual.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `TopsGDB User Manual`.

# TopsGDB User Manual

## 3. 用户使用说明

TopsGDB基于GDB版本13.2，所以使用方式与GDB相同，下面介绍一些常用命令以及与GDB不同的地方。

### 3.1. 支持的GCU设备

TopsGDB支持的GCU设备包括：gcu300， gcu400

### 3.2. 编译debug版本的程序

使用TopsCC编译，增加编译选项 `-g -fno-omit-frame-pointer`, 通常情况下你可能需要降低编译时的优化等级来提高调试体验。编译时添加 `-O0` 选项。

### 3.3. 运行你的应用程序

假设你已经编译好了你的应用程序vadd，并放在当前目录下。
你可以通过下面方式来启动调试。

```
-> % topsgdb ./vadd
Enflame Tops Debugger 1.5.0 release
GNU gdb (GDB) 13.2
Copyright (C) 2022 Free Software Foundation, Inc.
License GPLv3+: GNU GPL version 3 or later <http://gnu.org/licenses/gpl.html>
This is free software: you are free to change and redistribute it.
There is NO WARRANTY, to the extent permitted by law.
Type "show copying" and "show warranty" for details.
This GDB was configured as "x86_64-pc-linux-gnu".
Type "show configuration" for configuration details.
For bug reporting instructions, please see:
<https://www.gnu.org/software/gdb/bugs/>.
Find the GDB manual and other documentation resources online at:
   <http://www.gnu.org/software/gdb/documentation/>.
For help, type "help".
Type "apropos word" to search for commands related to "word"...
Reading symbols from ./vadd...
(gdb)
```

使用 `run` 命令来启动被调试程序

```
(gdb) run
```

### 3.4. 中断运行中的程序

在GDB窗口中 `ctrl+c` 命令用来中断执行中的程序

```
...
[New Thread 0x7fff58be9700 (LWP 1112)]
[New Thread 0x7fff583e8700 (LWP 1113)]
[New Thread 0x7fff57be7700 (LWP 1114)]
[New Thread 0x7fff573e6700 (LWP 1115)]
[New Thread 0x7fff56be5700 (LWP 1116)]
^C
Thread 1 "vadd" received signal SIGINT, Interrupt.
0x00007fffe65c86f0 in ?? () from /usr/lib/libefrt.so.12
(gdb)
```

### 3.5. 查看进程的线程列表

`info threads` 命令用显示当前线程列表，包括GCU的线程。

```
(gdb) info threads
 Id   Target Id                               Frame
* 1    Thread 0x7ffff7f67340 (LWP 1032) "vadd" 0x00007fffe65c86f0 in ?? () from /usr/lib/libefrt.so.12
  2    Thread 0x7fffcb02c700 (LWP 1038) "vadd" 0x00007fffe57a2ad3 in pthread_cond_wait@@GLIBC_2.3.2 () from /lib/x86_64-linux-gnu/libpthread.so.0
...
  80   Thread 0x7fff56be5700 (LWP 1116) "vadd" 0x00007fffe57a2ad3 in pthread_cond_wait@@GLIBC_2.3.2 () from /lib/x86_64-linux-gnu/libpthread.so.0
  81   GCU thread device:0 sip:0 0/(0,0,0) "vadd" 0x00000046ffff7010 in ?? ()
```

### 3.6. 查看GCU的线程列表

`info gcu threads` 命令用于显示GCU线程列表。

```
(gdb) info gcu threads
 Id   Target Id                               Frame
  81   GCU thread device:0 sip:0 0/(0,0,0) "vadd" 0x00000046ffff7010 in ?? ()
```

### 3.7. 切换线程

与标准GDB相同，通过 `thread thread_id` 命令来切换线程，同样支持切换到GCU的线程。

```
(gdb) thread 81
[Switching to thread 81, lane 0 (GCU lane 0 wave 0/(0,0))]
#0  0x00000046ffff7010 in ?? ()
(gdb)
```

### 3.8. 反汇编

查看GCU线程的反汇编指令，首先通过 thread 命令切换到GCU线程.
然后通过 `disassemble` 命令反汇编：

```
(gdb) disassemble  $pc-16,+64
Dump of assembler code from 0x46ffff7000 to 0x46ffff7040:
   0x00000046ffff7000:  { v.nop | m.nop | l.adda.u r4, r24, r4 | c.nop }
=> 0x00000046ffff7010:  { v.nop | m.nop | l.ld.w r4, [r4] | c.nop }
   0x00000046ffff7020:  { v.nop | m.nop | l.ld.w r5, [r24] | c.nop }
   0x00000046ffff7030:  { v.nop | m.nop | l.ldi16.s r6, 0 | c.nop }
End of assembler dump.
(gdb)
```

也可通过 `x /i` 的方式：

```
(gdb) x /4i $pc-16
   0x46ffff7000:        { v.nop | m.nop | l.adda.u r4, r24, r4 | c.nop }
=> 0x46ffff7010:        { v.nop | m.nop | l.ld.w r4, [r4] | c.nop }
   0x46ffff7020:        { v.nop | m.nop | l.ld.w r5, [r24] | c.nop }
   0x46ffff7030:        { v.nop | m.nop | l.ldi16.s r6, 0 | c.nop }
(gdb)
```

### 3.9. 查看GCU设备信息

通过 `info agents` 命令查看GCU设备信息

```
(gdb) info agents
Id State Target Id           Architecture Device Name Cores Threads Location
* 1  U     GCU Agent (GCUID 0) gcu200       gcu200      24    48      00:00.0
(gdb)
```

### 3.10. 读写GCU设备内存

GCU内存分为三级，分别是 `Global Memory`, `Local Memory` 和 `Private Memory`。

- `Global Memory (L3)` 同一个GCU设备内，所有线程共享。
- `Local Memory (L2)` 同一个Block内的所有线程共享。Block的相关内容请参考TopsCC用户文档。
- `Private Memory (L1)` 线程独占缓存。

此处引入了通用地址空间的概念，可使用统一通用地址空间指针访问各个层级的内存。
每个层级的内存按各自的base地址进行划分，具体的地址划分方式在不同的GCU设备上略有差异，下表为不同设备上各级内存的base地址。

| GCU device | gcu300 | gcu400 |
| --- | --- | --- |
| Global Memory | 0x2000000000 | 0x400000000000 |
| Local Memory | 0x00E0000000 | 0x040000000000 |
| Private Memory | 0x0000000000 | 0x000000000000 |

下面以gcu300为例，对其各级内存进行读写操作。

#### 读写Global Memory

```
(gdb) x/x 0x2000000000
0x2000000000:   0x159a0001
(gdb) set *(int*)0x2000000000 = 0xfafafafa
(gdb) x/x 0x2000000000
0x2000000000:   0xfafafafa
(gdb)
```

#### 读写Local Memory

```
(gdb) x/x 0xE8000000
0xe8000000:     0x7fff7fff
(gdb) set *(int*)0xE8000000 = 0xfafafafa
(gdb) x/x 0xE8000000
0xe8000000:     0xfafafafa
(gdb)
```

#### 读写Private Memory

```
(gdb) x/x 0x0
0x0:    0x00000000
(gdb) set *(int*)0x0 = 0xfafafafa
(gdb) x/x 0x0
0x0:    0xfafafafa
(gdb)
```

### 3.11. 单步执行

使用 `step` 命令来单步执行你的程序。遇到函数调用时，`step` 命令会进入函数内部执行。

```
(gdb) step
```

使用 `next` 命令来单步执行你的程序。遇到函数调用时，`next` 命令不会进入函数内部执行。

```
(gdb) next
```

### 3.12. 单步执行（汇编级）

使用 `stepi` 命令来单条指令的运行你的程序。

GCU Core 使用128比特位的指令包格式，每个指令包里面包含4~5条指令。`stepi` 命令每次执行一个指令包，而非一条指令。指令包格式参考硬件手册。

```
(gdb) disassemble $pc-16,+64
Dump of assembler code from 0x46ffff71a0 to 0x46ffff71e0:
   0x00000046ffff71a0:  { v.nop | m.nop | l.vldl vr0, [r4] | c.nop }
=> 0x00000046ffff71b0:  { v.vadda.s32 vr0, vr0, vr0, vcc_g0 | m.nop | s.nop16 | s.nop16 | c.nop }
   0x00000046ffff71c0:  { v.nop | m.nop | l.ld.w r6, [sp, 88] | c.nop }
   0x00000046ffff71d0:  { v.nop | m.nop | l.vstl vr0, [r6] | c.nop }
End of assembler dump.
(gdb) stepi
0x00000046ffff71c0 in ?? ()
(gdb) disassemble $pc-16,+64
Dump of assembler code from 0x46ffff71b0 to 0x46ffff71f0:
   0x00000046ffff71b0:  { v.vadda.s32 vr0, vr0, vr0, vcc_g0 | m.nop | s.nop16 | s.nop16 | c.nop }
=> 0x00000046ffff71c0:  { v.nop | m.nop | l.ld.w r6, [sp, 88] | c.nop }
   0x00000046ffff71d0:  { v.nop | m.nop | l.vstl vr0, [r6] | c.nop }
   0x00000046ffff71e0:  { v.nop | m.nop | l.ld.w r4, [r24] | c.nop }
End of assembler dump.
(gdb)
```

### 3.13. 继续程序的执行

使用 `continue` 命令来继续程序的执行。使用案例可参考 插入断点

### 3.14. 打印变量

当程序执行到某个函数的时候，可以打印函数的参数和局部变量。
用法： `print var_name` 或者 `p var_name`

```
__device__
void foo (int a)
{
  if (a < 10)
    bar (a);
  else
  process (a);    /* Stop here */
}

__device__
int bar (int a)
{
  foo (a + 5);
}
```

```
(gdb) p a
$1 = 10
(gdb) p bar::a
$2 = 5
(gdb) up 2
#2  0x080483d0 in foo (a=5) at foobar.c:12
(gdb) p a
$3 = 5
(gdb) p bar::a
$4 = 0
```

除了打印变量的值，你还可以使用 `ptype` 或 `whatis` 命令来查看变量的类型。

```
(gdb) ptype a
type = int
(gdb) whatis a
type = int
```

### 3.15. CallStack

当你的程序停止时，你需要知道的第一件事是它停止在哪里以及如何执行到那里的。
使用 `bt` 命令来查看函数调用栈。

**Note:**

TopsCC 编译器默认是省略帧指针的，所以在调试时需要增加编译选项 `-fno-omit-frame-pointer`。

```
(gdb) bt
#0  vec_add (from=0x4100800000， to=0x4300800000，N-512) at vadd.cpp:36
#1  0x0000004100801d70 in __boot__ () at boot_code_impl.h:495
```

### 3.16. 切换frame

GDB中大多数用于检查程序中的堆栈和其他数据的命令都用的是当前选择的堆栈帧。可以通过 `frame num` 命令来切换堆栈帧。

```
(gdb) bt
#0  vec_add (from=0x4100800000， to=0x4300800000，N-512) at vadd.cpp:36
#1  0x0000004100801d70 in __boot__ () at boot_code_impl.h:495
(gdb) frame 1
#1  0x0000004100801d70 in __boot__ () at boot_code_impl.h:495
(gdb)
```

### 3.17. 打印threadIdx/blockIdx/gridDim/blockDim

`print $threadIdx`

命令用来打印当前GCU线程的threadIdx。

`print $blockIdx`

命令用来打印当前GCU线程的blockIdx。

`print $gridDim`

命令用来打印当前GCU线程的gridDim。

`print $blockDim`

命令用来打印当前GCU线程的blockDim。

### 3.18. 打印GCU线程的隐式参数

`print $tops_implicit_params`

命令用来打印当前GCU线程的隐式参数。

### 3.19. 读写寄存器

支持 SR、SPR、VR、VACC 和 TAR 等寄存器的读写。

#### 查看寄存器的值

使用 `info registers` 命令可查看所有通用寄存器的值。
若需查看所有寄存器的值(不包括向量寄存器)，可使用 `info registers all` 命令。

```
(gdb) info registers
r0             0x0                 0
r1             0x3                 3
r2             0x7e380             516992
r3             0x16881             92289
r4             0x7e480             517248
r5             0x7e600             517632
r6             0x7e480             517248
r7             0x3ff               1023
r8             0x0                 0
r9             0x10000             65536
r10            0x1bb10             113424
r11            0x7fc00             523264
r12            0x7fbdc             523228
r13            0xfb530000          -78446592
r14            0x7fbac             523180
...
r31            0x7fd80             523648
sip_pc         0x171c0             94656
excp_pc        0x0                 0
excp_sts       0x0                 0
excp_mask      0x0                 0
excp_trap      0xffff              65535
pc             0x46ffff71c0        0x46ffff71c0
sp             0x7e380             516992
lr             0x16881             92289
(gdb)
```

使用 `info reg reg_category` 命令可查看指定类型的寄存器的值，支持的 `reg_category` 包括：
`scalar` 、 `special` 、 `vector` 、 `vacc` 、`iv` 以及 `ta` 。
例如 `info reg special` 命令可查看所有特殊寄存器的值：

```
(gdb) info reg special
mode_wrk       0x9d070f00          -1660481792
scc            0x0                 0
loop_sts       0x0                 0
svmm_spr0      0x0                 0
vab_m_s1       0x0                 0
vab_m_s2       0x0                 0
vab_m_d        0x0                 0
vab_lv_s       0x0                 0
tctl           0x0                 0
vpr            0x0                 0
mpr            0x0                 0
lpr            0x0                 0
naccovr        0x0                 0
vab_l_d        0x0                 0
vmm_vsel_ovr   0x0                 0
(gdb)
```

使用 `print $reg_name` 或 `info reg reg_name` 命令可以查看某个指定寄存器的值

```
(gdb) info reg r27
r27            0x0             0
(gdb) print $r27
$1 = 0
(gdb)
```

**Note:**

在查看与向量计算相关的寄存器如 VR、 VACC 或 TAR 前，需使用 `lane lane_id` 命令切换至目标数据通道（默认当前 lane id 为 0）。

使用 `info reg reg_name` 命令可查看 VR 、VACC 或 IV 寄存器的值。
若需查看 VR 或 VACC 寄存器中特定位置的值，可使用 `print $reg_name[index]` 命令。

```
(gdb) lane
[Current lane is 0, thread 72 (GCU lane 0 wave (0,0))]
(gdb) lane 1
[Switching to thread 72, lane 1 (GCU lane 1 wave (0,0))]
#0  vec_add (from=0x23ef193000, to=0x23ef192000, N=512) at vadd.cpp:36
36            const auto &v = tops::vload<vint>(buffer+j);
(gdb) info reg vacc8
vacc8          {0x0, 0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8, 0x9, 0xa, 0xb, 0xc, 0xd, 0xe, 0xf}
(gdb) print $vacc8
$1 = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}
(gdb) print $vacc8[6]
$2 = 6
(gdb)
```

TAR 寄存器的查看方式与 VR、 VACC 以及 IV 寄存器略有不同，单个 lane 上的 TAR 寄存器被分成若干组。
因此，你可以使用 `info reg ta_grp` 命令查看整组 TAR 寄存器，同时也支持使用 `print $ta_grp[index]` 命令读取单个 TAR 寄存器的值。

```
(gdb) info reg ta_g2
ta_g2         {0x0, 0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7}
(gdb) print $ta_g2[5]
$3 = 5
(gdb)
```

**Tip:**

使用 `whatis $reg_name` 或 `ptype $reg_name` 命令可查看寄存器中的数据类型，参考 打印变量。

#### 修改寄存器的值

`set` 命令除了可以修改内存外，还可以用于修改寄存器的值。

```
(gdb) set $r27=0xfafafafa
(gdb) info reg r27
r27            0xfafafafa          -84215046
(gdb)
```

**Note:**

与查看寄存器类似，在修改 VR、 VACC 或 TAR 寄存器的值前，也需先使用 `lane lane_id` 命令切换至目标数据通道 lane 上。

使用 `set $reg_name=` 命令可修改整个 VR 或 VACC寄存器的值。
若需针对 VR 或 VACC 寄存器中特定位置的值进行修改，可使用 `set $reg_name[index]=` 命令。

```
(gdb) lane 1
[Switching to thread 72, lane 1 (GCU lane 1 wave (0,0))]
#0  vec_add (from=0x23ef193000, to=0x23ef192000, N=512) at vadd.cpp:36
36            const auto &v = tops::vload<vint>(buffer+j);
(gdb) set $vacc8={0xf, 0xe, 0xd, 0xc, 0xb, 0xa, 0x9, 0x8, 0x7, 0x6, 0x5, 0x4, 0x3, 0x2, 0x1, 0x0}
(gdb) i r vacc8
vacc8          {0xf, 0xe, 0xd, 0xc, 0xb, 0xa, 0x9, 0x8, 0x7, 0x6, 0x5, 0x4, 0x3, 0x2, 0x1, 0x0}
(gdb) set $vacc8[6]=0xfafafafa
(gdb) i r vacc8
vacc8          {0xf, 0xe, 0xd, 0xc, 0xb, 0xa, 0xfafafafa, 0x8, 0x7, 0x6, 0x5, 0x4, 0x3, 0x2, 0x1, 0x0}
(gdb)
```

由于TAR寄存器按组划分，因此可以使用 `set $tar_grp=` 命令修改整组 TAR 寄存器的值。
若需修改组内某个特定 TAR 寄存器的值，可使用 `set $tar_grp[index]=` 命令。

```
(gdb) lane 1
[Switching to thread 72, lane 1 (GCU lane 1 wave (0,0))]
(gdb) set $tar_g2={0x7, 0x6, 0x5, 0x4, 0x3, 0x2, 0x1, 0x0}
(gdb) info reg tar_g2
tar_g2         {0x7, 0x6, 0x5, 0x4, 0x3, 0x2, 0x1, 0x0}
(gdb) set $tar_g2[0]=0xfafafafa
(gdb) info reg tar_g2
tar_g2         {0xfafafafa, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0}
(gdb)
```

### 3.20. 断点设置

与GDB相同：

`break`

（或

`b`

） 命令用来插入断点，

`temporary break`

（或

`tb`

） 命令用来插入临时断点；

`info breakpoints`

命令用来查看断点的状态；

`delete`

命令用来删除断点。

通过函数名插入断点：

**Caution:**

仅支持__device__修饰的函数。
对于__global__修饰的函数或者同时存在于 Host 和 Device 的函数，建议使用 gcu break 命令。

代码 3.20.1

函数断点

```
(gdb) break vadd_vec
```

通过文件名和行号插入断点：
文件名和行号以 `:` 分隔。不写文件名则默认为当前文件。

代码 3.20.2

行号断点

```
(gdb) break vadd.cc:10
```

通过地址插入断点：

**Caution:**

若插入的是 Device 端的地址断点，必须使用 gcu break 命令，以明确该断点地址属于 Device 端。

代码 3.20.3

插入断点

```
(gdb) break *0x00000046ffff71e0
Breakpoint 1 at 0x46ffff71e0
(gdb) c
Continuing.

Thread 81 "vadd" hit Breakpoint 1, with lanes [0-1], 0x00000046ffff71e0 in ?? ()
(gdb) disassemble $pc-16,+64
Dump of assembler code from 0x46ffff71d0 to 0x46ffff7210:
   0x00000046ffff71d0:  { v.nop | m.nop | l.vstl vr0, [r6] | c.nop }
=> 0x00000046ffff71e0:  { v.nop | m.nop | l.ld.w r4, [r24] | c.nop }
   0x00000046ffff71f0:  { v.nop | m.nop | l.sllia r4, r4, 2 | c.nop }
   0x00000046ffff7200:  { v.nop | m.nop | l.adda.s r4, r5, r4 | c.nop }
End of assembler dump.
(gdb)
```

代码 3.20.4

查看断点状态

```
(gdb) info breakpoints
Num   Type         Disp Enb Address            What
1     breakpoint   keep y   0x00000046ffff71e0 breakpoint already hit 1 time
(gdb)
```

代码 3.20.5

删除断点

```
(gdb) info breakpoints
Num   Type         Disp Enb Address            What
1     breakpoint   keep y   0x00000046ffff71e0 breakpoint already hit 1 time
(gdb) delete 1
(gdb) info breakpoints
No breakpoints or watchpoints.
(gdb)
```

#### gcu break

`gcu break` 与 `break` 功能基本一致，区别在于 `gcu break` 仅对 GCU 端的 kernel code 生效。

因此，在使用 `gcu break` 插入函数断点时：

```
(gdb) gcu break fun_name
```

- 如果 `fun_name` 函数同时存在于 Host 和 Device 端，只有 Device 端的函数上的断点会生效；
- 如果 `fun_name` 函数仅存在于 Host 端， 则断点不会生效。

#### Kernel 入口处断点

启用此功能后，每一个 Kernel 启动时，topsgdb 都会暂停其执行，并允许用户检查当前状态、变量和堆栈信息。
方便用户在不知道 Kernel 函数名称的情况下，快速定位到 Kernel 函数的入口处。

**Note:**

该功能仅起到在 kernel 函数入口处设置断点的效果，实际上并未真正地插入断点，因此 `info breakpoints` 命令并不会显示这些“断点”。
关闭该选项也不会删除相同位置的其他断点，反之亦然。

通过设置 break-on-kernel 选项以启用或禁用此功能：

- 启用 break-on-kernel
  ```
  (gdb) set gcu break-on-kernel on
  ```
- 禁用 break-on-kernel
  ```
  (gdb) set gcu break-on-kernel off
  ```

### 3.21. Core Dump

core 文件或者 core dump 是程序异常退出时，记录运行中进程的内存映像及其进程状态（寄存器等）的文件。
当 GCU kernel函数发生异常退出时，会同时生成设备端的 GCU core 文件和 Linux 系统的 CPU core 文件。
使用 TopsGDB 加载这些 core dump文件可还原程序崩溃时 Host 以及 Device 的现场，以便对程序进行调试分析。

#### 启用 core dump

需同时在 CPU 和 GCU 设备上开启 core dump 功能。

1. 启用 CPU core dump。

   在 Linux 系统中，core dump 默认是关闭的，可以通过以下命令启用：

   ```
   ulimit -c unlimited
   ```

   ```
   echo core.%p > /proc/sys/kernel/core_pattern
   ```

   可以设置 CPU core dump 的命名规则及路径，具体规则可参考 `man core`。以上命令设置 core dump 文件名为 `core.PID`（`PID` 为进程 ID），并保存在当前目录下。

2. 启用 GCU core dump。

   设置环境变量使能程序异常时的 GCU core dump：

   ```
   export EFRT_ENABLE_GCU_COREDUMP=true
   ```

3. 配置 GCU core dump 文件路径（可选）。

   GCU core 文件名使用统一格式 `gcu_core_{BDF}_{PID}_{TIME}`，其中：

   - `BDF`: PCIe 总线地址（格式为 DDDD:BB:DD.F，如 0000:2d:00.0）
   - `PID`: 进程 ID
   - `TIME`: 时间戳，指自 1970-01-01 00:00:00 +0000 (UTC) 以来的秒数

   生成路径按以下优先级确定：

   1. 若设置了 `EFRT_GCU_COREDUMP_DIR` 环境变量，则使用该目录。
   2. 使用 `/proc/sys/kernel/core_pattern` 中的目录路径。
   3. 若上述路径均不可用，则使用当前工作目录。

   ```
   export EFRT_GCU_COREDUMP_DIR="/data/coredumps/"
   ```

   这样，GCU core 文件就会被保存到 `/data/coredumps/` 目录下，文件名类似 `gcu_core_0000:2d:00.0_12345_1735603200`。

#### 生成 core 文件

在确保 CPU 和 GCU 都已启用 core dump 功能，并完成上述配置的前提下，运行编译后的可执行文件。
当 GCU kernel 函数异常退出时，会生成 CPU core 文件和 GCU core 文件。
注意，在编译时需要开启 `-g` 选项，以便生成调试信息。

- **CPU core 文件**：文件名为 `core.PID`，生成路径由 `/proc/sys/kernel/core_pattern` 决定。
- **GCU core 文件**：文件名格式为 `gcu_core_{BDF}_{PID}_{TIME}`，生成路径由 `EFRT_GCU_COREDUMP_DIR` 环境变量配置决定（参见上文）。

其中 `PID` 为进程 ID，`BDF` 为 PCIe 总线地址，`TIME` 为时间戳。GCU core 文件的个数与 GCU 设备个数一致。

#### 加载 core 文件并进行调试

1. 加载 CPU core 文件。

   既可以在进入 TopGDB 后，通过 `core` 命令加载对应的 CPU core：

   ```
   -> % topsgdb ./vadd
   ... ...
   (gdb) core core.1234
   ... ...
   ```

   也可以在进入 TopsGDB 时，直接在可执行文件后面附上 CPU core 文件来加载 CPU core：

   ```
   -> % topsgdb ./vadd core.1234
   ```

2. 加载 GCU core 文件。

   在已加载 CPU core 的前提下，通过 `target gcucore` 命令加载 **所有的** GCU core 文件。下面是4卡环境下加载 GCU core 的示例：

   ```
   target gcucore gcu_core_0000:16:00.0_12345_1735603200  gcu_core_0000:40:00.0_12345_1735603200  gcu_core_0000:6a:00.0_12345_1735603200  gcu_core_0000:94:00.0_12345_1735603200
   ```

3. 进行调试。

   待 CPU core 以及 GCU core 都加载完毕后，即可进行一些基本的调试工作，包括查看变量、寄存器、内存、线程、堆栈以及切换线程或堆栈帧等，从而深入分析程序异常退出的原因，定位问题所在，并做进一步的修复工作。
