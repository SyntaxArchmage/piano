> Imported material source: `Doc/TOPSProf User Guide.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `TOPSProf User Guide`.

# TOPSProf User Guide

## 1. 前言

### 1.1. 版权声明

以下条款适用于所有访问燧原产品和服务相关文档的用户或阅读者（以下统称“您”），本文档包括本文档提供的信息属于上海燧原科技股份有限公司和/或其子公司（以下统称“燧原”）或其许可方所有，且燧原保留不经通知随时对本文档信息或对本文档所述任何产品和服务做出修改的权利。本文档所含信息和本文档所引用燧原其他信息均“按原样”提供。燧原不担保信息、文本、图案、链接或本文档内所含其他项目的准确性或完整性。燧原不对本文档所述产品的可销售性、所有权、不侵犯知识产权、准确性、完整性、稳定性或特定用途适用性做任何暗示担保、保证。燧原可不经通知随时对本文档或本文档所述产品或服务做出更改，但不承诺因此更新本文档。

在任何情况下，燧原不对因使用或未使用本文档而导致的任何损害（包括但不限于利润损失、业务中断和信息损失等损害）承担任何责任。除非另行书面同意，燧原不对本文档承担任何责任，不论该责任因任何原因而产生或基于任何侵权理论。

本文档所列的规格参数、性能数据和等级基于特定芯片或计算机系统或组件测试所得。经该等测试，本文档所示结果反映了燧原产品在上述测试环境中的性能表现。测试系统配置及软硬件版本、环境变量等的任何变化都会影响产品或服务的实际性能，如产品或服务的实际效果与本文档描述存在差异的，均属正常现象。燧原不担保测试本文档中每种产品或服务的所有参数的准确性和稳定性。您自行承担对本文档中产品或服务是否适合并适用于您计划的应用进行评估以及进行必要测试的责任。您的使用环境、系统配置、产品设计等特性可能会影响燧原产品或服务的质量和可靠性并导致超出本文档范围的额外或不同的情况和/或要求，燧原对此不做任何担保或承担任何责任。

燧原®、Enflame ®和本文档中显示的其他所有商标、标志是上海燧原科技股份有限公司或其许可方申请和/或注册的商标。本文档并未明示或暗示地授予您任何专利、版权、商标、集成电路布图设计、商业秘密或任何其他燧原或其许可方知识产权的权利或许可。

本文档相关信息为燧原或其许可方版权和工业产权所有并受全世界版权和工业产权法律和条约条款的保护。未经燧原或其许可方的事先书面许可，任何人不可以任何方式复制、修改、出版、上传、发布、使用、传输或分发本文档相关信息。为免疑义，除了允许您按照本文档要求使用本文档相关信息外，燧原或其许可方不授予其他任何明示或暗示的权利或许可。

本文档可能保留有与第三方网站或网址的链接，访问这些链接将由您自己作出决定，燧原并不保证这些链接上所提供的任何信息、数据、观点、图片、陈述或建议的准确性、完整性、充分性和可靠性。燧原提供这些链接仅仅在于为您提供方便，并不表示燧原对这些信息的认可和推荐，也不是用于宣传或广告目的。

本文档中可能涉及第三方软件、产品或服务的信息，例如DeepSeek模型，燧原和各第三方在法律法规规定的范围内各自承担责任。燧原仅合法使用该第三方软件、产品或服务提供服务，不对该第三方软件、产品或服务的准确性、完整性、及时性、可靠性或适用性作任何明示或暗示的保证。对于因第三方软件、产品或服务输出内容导致的任何经济、法律或声誉风险，因第三方服务中断、终止或技术故障导致的功能不可用，用户违反本声明或滥用功能产生的后果等，燧原对此不做任何担保或承担任何责任。您在使用第三方软件、产品或服务时应当遵守第三方的相关要求，否则该第三方或者国家机关可能会对您提起诉讼、罚款或采取其他措施，并可能要求燧原给予协助，您应当自行承担相应的法律责任。

您同意在使用本文档及其内容时，遵守国家法律法规、社会公共道德。您不得利用本文档及其内容从事制作、查阅、复制和传播任何违法、侵犯他人权益等扰乱社会秩序、破坏社会稳定的行为，亦不得利用本文档及其内容从事任何危害或试图危害计算机系统及网络安全的活动。

您同意，与您访问或使用本文档相关的所有事项，应根据中华人民共和国法律解释、理解和管辖。您同意，中国上海市有管辖权的法院具有相关的管辖权。

燧原对本文档享有最终解释权。

### 1.2. 版本记录

| 时间 | 版本 |
| --- | --- |
| 2024-02-28 | V 1.0 |
| 2024-06-26 | V 1.1 |
| 2024-09-13 | V 1.2 |
| 2024-12-03 | V 1.3 |
| 2025-03-03 | V 1.4 |
| 2025-05-29 | V 1.5 |
| 2025-08-21 | V 1.6 |
| 2025-11-26 | V 1.7 |

### 1.3. 名词解释

| 术语 | 说明 |
| --- | --- |
| GCU | General Compute Unit，通用计算单元。 |
| DTE | Data Transformation Engine，数据转换引擎。 |
| SIP | Scalable Intelligent Processor，可扩展的智能处理器，GCU 计算单元。 |
| VPD | Visual Profiler Data，可用于 Visual Profiler 打开的文件格式。 |

### 1.4. 概述

topsprof 分析工具使您能够从命令行收集和查看分析数据。topsprof 支持在 CPU 和 GCU 上收集与 tops 相关的活动的时间线，包括内核执行、内存传输、内存集和 tops API 调用以及 tops 内核的事件或指标。分析选项通过命令行选项提供给 topsprof 。收集分析数据后，分析结果显示在控制台中，也可以保存以供 topsprof 或 Tops Visual Profiler 以后查看。

### 1.5. 使用方法

topsprof [options] [application] [application-arguments]

options 需要以 `--` 或者 `-` 开头，示例 `--print-api-summary`，`-print-api-summary`。

options 带参数可以使用空格或者等号隔开，示例 `--flag xxx` 和 `--flag=xxx` 效果是等同的。

## 2. 命令行选项

### 2.1. GCU 采集选项

| 选项 | 参数 | 默认值 | 说明 |
| --- | --- | --- | --- |
| query-activities | N/A | N/A | 列出设备所有活动。 |
| query-trace | N/A | N/A | 列出设备所有的 trace 域。 |
| enable-activities | {format activity string} | operator,memcpy | 采集指定的活动。 |
| export-activities | {filename} | N/A | 以 json 格式导出设备活动到文件。 |
| import-activities | {filename} | N/A | 从 json 格式文件导入设备活动。 |
| kernel-name | {formatted kernel name expression} | N/A | 设置表达式匹配内核。如果内核不匹配，将不会被 profile。<br>精确匹配：设置精确匹配的内核名称。<br>regex：设置用于匹配内核名称的正则表达式。在将正则表达式符号识别为特殊字符的 shell （例如 Linux bash ）上，表达式需要用引号转义，例如 `--kernel-name regex:".*foo"`。 |
| kernel-id | {formatted kernel identifier} | N/A | 设置内核标识符匹配内核。如果内核不匹配，将不会被 profile。标识符必须采用以下格式：*context-id:stream-id:[name-operator:]kernel-name:invocation-nr*。<br>> *context-id* 是 TopsRT context ID 或者正则表达式匹配 context ID。<br>> *stream-id* 是 TopsRT stream ID 或者正则表达式匹配 stream ID。<br>> *name-operator* 是可选的对 *kernel-name* 的操作符。 现在 regex 是唯一支持的操作符。<br>> *kernel-name* 是匹配内核名字的表达式。默认情况下，这是对 `--kernel-name-base` 所指定内容的完整、逐字匹配。在指定可选的正则表达式名称操作符时，这是对由 `--kernel-name-base` 指定的内容进行正则表达式匹配。<br>> *invocation-nr* 是匹配的内核的第N次调用。多次调用可以使用正则表达式来匹配。<br>如果 *context-id*/*stream-id*/*invocation-nr* 是一个正整数，它会被用来严格匹配 context ID/stream ID/调用次数。否则，它会被认为是一个正则表达式。 |
| kernel-name-base | function,demangled,mangled | function | 为 `--kernel-name` 和 `--kernel-id` 的 *kernel-name* 设置匹配名字的方式。选项包括：<br>> *function*: 不带参数的内核函数名字。 例如 vector_add。<br>> *demangled*: 包括参数的 demangled 内核函数名字。例如 vector_add(float*, float*, float*, unsigned long)。<br>> *mangled*: mangled 内核函数名字。例如 _Z10vector_addPfS_S_m。 |

### 2.2. CPU 采集选项

| 选项 | 参数 | 默认值 | 说明 |
| --- | --- | --- | --- |
| trace | {format domain string} | topstx,runtime | 采集指定 domain 的 trace。 |
| topstx-domain-include | {format domain string} | N/A | 如果使用 trace 指定的 domain 包含 topstx，可以用 topstx-domain-include 指定采集自定义的 domain 的 trace。 |
| topstx-max-bytes-size | {size} | N/A | 弃用选项，目前已无实际效果。 |
| cpu-profiling-callstack | N/A | N/A | 开启 cpu 堆栈采集，依赖 perf 工具，详情请参考附录。 |
| cpu-profiling-frequency | {frequency} | 1000Hz | 设置 cpu 堆栈采集频率，数据范围是 100 ~ 8000 Hz。 |
| cpu-utilization | N/A | N/A | 开启 cpu 使用率采集，依赖 perf 工具，详情请参考附录。 |
| memory-utilization | N/A | N/A | 开启 cpu 内存采集。 |
| utilization-frequency | {frequency} | 100Hz | 设置 memory-utilization 和 utilization-frequency 采集频率，数据范围是 1 ~ 100 Hz。 |
| kernel-callstack | N/A | N/A | 开启 kernel 堆栈采集，依赖内核工具 ftrace。 |
| kernel-callstack-filte | {filter} | current | 开启 kernel 堆栈采集过滤，"all"，"kmd"，"current"或"abc,def,ghi"。 |

### 2.3. 打印选项

| 选项 | 参数 | 默认值 | 说明 |
| --- | --- | --- | --- |
| print-gcu-summary | N/A | N/A | 输出 GCU 数据的汇总报表。 |
| print-gcu-trace | N/A | N/A | 输出 GCU 数据并按时间排序。 |
| print-summary | N/A | N/A | 输出采集数据汇总报表。注意：如果没有指明打印格式，默认按此格式输出。 |
| print-summary-per-gcu | N/A | N/A | 输出采集数据汇总报表，并按设备区分。 |
| quiet | N/A | N/A | 安静模式，不做任何输出。 |
| timeunit | {unit} | auto | 设置输出时的基本时间单位，可设值包括 auto、nsec、nanoseconds、usec、microseconds、msec、milliseconds、seconds、cycle。 |

### 2.4. 输入输出选项

| 选项 | 参数 | 默认值 | 说明 |
| --- | --- | --- | --- |
| export-profile | {filename} | N/A | 导出采集数据。 |
| export-visual-profile | {directory} | N/A | 导出采集数据，稍后可以在 visual profiler 中打开。 |
| import-profile | {filename} | N/A | 导入采集数据，可导入前一次 export-profile 或 export-visual-profiler 输出的数据。 |
| export-rawdata | {filename} | N/A | 导出原始数据。 |
| import-rawdata | {filename} | N/A | 导入原始数据。 |
| export-csv | {filename} | N/A | 以 csv 格式导出测试结果。 |
| visual-profiler-merge-from | {directory} | N/A | 选择一个目录，合并目录中的所有文件，目录中的所有文件都会被视为 visual profiler(vpd) 格式。 |
| visual-profiler-merge-to | {filename} | N/A | 合并多个 visual profiler(vpd) 格式，到一个文件，通过 visual-profiler-merge-from 指定输入项。 |
| log-file | {filename} | N/A | 开启后 topsprof 所有输出会保存到文件。如果文件不存在，会自动创建。 |
| force-overwrite | N/A | N/A | 强制重写模式（已存在的文件会被覆盖）。 |
| help | N/A | N/A | 打印帮助信息。 |
| version | N/A | N/A | 打印版本信息。 |
| debug | N/A | N/A | 运行时会打印调试信息。 |
| debug-dump | N/A | N/A | 运行时会打印调试信息，并在当前目录生成 dump 文件供调试。 |
| show-output | true，false | true | 如果为 true，则将应用的 stdout/stderr 流发送到控制台。 |
| print-app-log | N/A | N/A | 弃用选项，目前已无实际效果。 |

### 2.5. 控制选项

| 选项 | 参数 | 默认值 | 说明 |
| --- | --- | --- | --- |
| session | {string} | N/A | 标记一个已存在的 session。 |
| session-new | {string} | N/A | 指定 session 名称，只能包含英文字符、数字、‘-’ 或 ‘_’。如果不指定该选项，topsprof将用自身 pid 作为 session 名称。 |
| session-list | N/A | N/A | 列出系统上存在的 session。 |
| start | N/A | N/A | 启动采集，通过 session 选项可指定 session，若不指定 session 则控制当前用户已创建的所有 sessions。 |
| stop | N/A | N/A | 停止采集，通过 session 选项可指定 session，若不指定 session 则控制当前用户已创建的所有 sessions。 |
| cancel | N/A | N/A | 撤销采集，通过 session 选项可指定 session，若不指定 session 则控制当前用户已创建的所有 sessions。 |
| profile-from-start | on，off | on | 在启动时启用/禁用采集。如果禁用，稍后可以另启动一个 topsprof 进行控制。若显式指定了delay非0或capture-range非none，该项默认为off。 |
| delay | {seconds} | 0s | 延迟启动采集的时长。数据范围是 0 ~ 3600 seconds。 |
| duration | {seconds} | N/A | 限制采集活动持续的时长。到期时，启动的进程将强制终止。数据范围是 1 ~ 300 seconds。 |
| capture-range | none，topsProfilerApi | none | 设置为 topsProfilerApi，则采集范围为 topsProfilerStart/Stop 之间；设置为 none，则忽略 topsProfilerStart/Stop API 调用。 |
| kill | none，sigkill，sigterm，signal number | sigterm | 采集结束时，向目标应用程序的进程组发送信号。signal number 允许范围是 0 ~ 64，0 相当于 none。 |
| ring-overwrite | N/A | N/A | 使能 Ring Overwrite 模式，仅只为用户提供缓冲区中未被覆盖过的最新连续数据；该选项仅能在 GCU400/410 平台下使能。 |
| trace-fork-before-exec | true，false | false | 设置为 true 则跟踪在 fork 之后、调用 exec 函数之前的子进程。请注意：在此间隔内的跟踪依赖于未定义的行为，可能会导致应用程序崩溃或死锁。 |

### 2.6. 高级选项

| 选项 | 参数 | 默认值 | 说明 |
| --- | --- | --- | --- |
| reset | N/A | N/A | 重置 topsprof 内部状态。当 topsprof 异常退出后使用。 |
| command-file | {filename} | N/A | 打开一个包含选项的文件并解析选项。注意：命令行指定选项可以覆盖文件中指定选项。此选项可以指定多次。 |

### 2.7. 选项说明

#### 冲突选项

以下每行内的选项不能同时使用：

```
    import-rawdata, import-profile
    import-profile, export-profile, export-visual-profiler
    export-profile, export-visual-profiler
    enable-activities, import-activities
    print-api-summary, print-gcu-summary, print-summary, print-summary-per-gcu
    session, session-new
```

#### 单独使用选项

以下选项只能单独使用：

```
    export-activities, query-activities, plugin-list, help, version, reset, session-list
```

#### 控制选项

以下选项只能单独或配合 session 使用：

```
    start, stop, cancel
```

#### 启动应用采集限制项

以下选项只能启动应用采集时使用：

```
    profile-from-start, import-activities, enable-activities, trace, topstx-domain-include, export-rawdata, cpu-profiling-callstack, cpu-profiling-frequency, cpu-utilization, memory-utilization, utilization-frequency, session-new, delay, duration, capture-range
```

## 3. 采集模式

topsprof 可以运行在以下任意一种模式中。

### 3.1. 统计模式

统计模式是 topsprof 的默认模式。在此模式，topsprof 对每一个 gcu 算子或 api 输出一行结果。对每一行结果 topsprof 会输出最大值、最小值、平均值、调用信息等统计参数。topsprof 输出会增加前缀 =={pid}==， {pid} 是被采集的应用程序进程 id。
示例：

```
$ topsprof --enable-activities operator ./simpleElemwiseAdd
==4766== TOPSPROF is profiling process 4766, session: 4602, command: ./simpleElemwiseAdd
==4766== Acquiring tasks...
==4766== Got task list
[10-35-31] LOCAL: success connect to server
[10-35-31] LOCAL: profile agent config done: 11000
ok echo
==4766== TOPSPROF is attaching task 50002, session: 4602
[10-35-31] LOCAL: profile agent created: 12000
process profile data [=========================================] 100% 0.013s
==4766== GCU activities:
==4766==      Time(%)         Time    Calls          Avg          Min          Max Name
==4766==       90.38%     467.70us        1     467.70us     467.70us     467.70us scalar_add(float*, float*, float*, unsigned long)
==4766==        9.17%      47.47us        1      47.47us      47.47us      47.47us vector_add(float*, float*, float*, unsigned long)
==4766==        0.44%       2.28us        1       2.28us       2.28us       2.28us warm_up()
==4766==     Accumulate Time 517.45us, Total Calls 3
==4766==     Total Time 5.78ms
==4766==

==4766== CPU activities:
==4766==     does not contain cpu kernel data.

==4766== RUNTIME activities:
==4766==      Time(%)         Time    Calls          Avg          Min          Max Name
==4766==       25.66%     268.59ms        3      89.53ms      17.53us     268.52ms topsLaunchKernel
==4766==       24.23%     253.60ms        6      42.27ms      90.43us     253.02ms Stream_Synchronize
==4766==       24.17%     253.01ms       12      21.08ms       2.71us     252.91ms TSStream_DoHostCallback
==4766==       24.16%     252.87ms        1     252.87ms     252.87ms     252.87ms TSExecutor_ProfilerInit
==4766==        0.51%       5.30ms       62      85.56us       6.33us       2.02ms MemoryMgr_CreateBo
==4766==        0.42%       4.39ms       62      70.88us       4.92us       2.00ms Driver_BoAlloc
==4766==        0.40%       4.24ms       19     222.94us      14.21us       2.02ms MemoryMgr_AllocHost
==4766==        0.11%       1.14ms       46      24.74us     371.00ns     157.43us MemoryMgr_AllocDevice
==4766==        0.07%     739.26us        4     184.81us     148.72us     231.38us topsMemcpy
==4766==        0.06%     604.26us        2     302.13us      78.17us     526.09us topsEventSynchronize
==4766==        0.06%     579.80us       65       8.92us       2.48us      57.08us OsInterface_DtuMmap
==4766==        0.02%     206.57us        1     206.57us     206.57us     206.57us topsDeviceSynchronize
==4766==        0.02%     200.73us        5      40.15us      22.61us      74.74us StreamExecutor_GetOrCreateHostMemObj
==4766==        0.02%     190.50us        2      95.25us      71.16us     119.34us StreamExecutor_MemcpyH2DSync
==4766==        0.02%     177.27us        3      59.09us      10.49us     142.34us Stream_LaunchKernelAsync
==4766==        0.01%     134.45us        4      33.61us      15.08us      54.78us topsEventRecord
==4766==        0.01%     119.79us        2      59.90us      31.51us      88.28us TSStream_MemcpyH2D
==4766==        0.01%     112.39us        2      56.20us      52.15us      60.24us TSStream_MemcpyD2H
==4766==        0.01%      84.00us       35       2.40us       1.71us      11.58us MappedQueue_Emit
==4766==        0.01%      59.17us        4      14.79us       3.50us      32.67us Stream_RecordEventAsync
==4766==        0.01%      56.04us        4      14.01us       3.17us      31.16us TSStream_RecordEvent
==4766==        0.00%      50.59us        4      12.65us       8.20us      19.95us TSStream_CommandEmitWithReleaseFunc
==4766==        0.00%      41.86us        3      13.95us     210.00ns      41.30us TSExecutor_GetCachedOrCreateResourceBundle
==4766==        0.00%      35.22us       12       2.93us     110.00ns       7.69us TSStream_AutoReleaseResource
==4766==        0.00%      22.28us        3       7.43us       1.79us      18.57us topsMalloc
==4766==        0.00%      21.46us        3       7.15us       3.04us       9.71us TSStream_LaunchKernel
==4766==        0.00%      19.92us        3       6.64us       1.15us      17.35us topsFree
==4766==        0.00%      19.92us        4       4.98us       3.40us       9.53us Stream_DoHostCallbackAsync
==4766==        0.00%      19.49us        3       6.50us       3.28us       9.00us TSStream_Profile
==4766==        0.00%      19.44us        2       9.72us       1.10us      18.34us topsEventCreate
==4766==        0.00%       4.78us        2       2.39us     801.00ns       3.98us topsEventDestroy
==4766==        0.00%       3.97us        3       1.32us       1.01us       1.57us Stream_LaunchKernel_CaptureParam
==4766==     Accumulate Time 1.05s, Total Calls 386
==4766==
```

### 3.2. 跟踪模式

跟踪模式提供一个时间轴显示发生的活动和持续时间，每次调用会显示为一行。topsprof 输出会增加前缀 =={pid}==， {pid} 是被采集的应用程序进程 id。
示例：

```
$ topsprof --enable-activities operator --print-gcu-trace ./simpleElemwiseAdd
==5104== TOPSPROF is profiling process 5104, session: 4940, command: ./simpleElemwiseAdd
==5104== Acquiring tasks...
==5104== Got task list
[10-36-56] LOCAL: success connect to server
[10-36-56] LOCAL: profile agent config done: 11000
ok echo
==5104== TOPSPROF is attaching task 50000, session: 4940
[10-36-56] LOCAL: profile agent created: 12000
process profile data [=========================================] 100% 0.014s
==5104== GCU trace:
==5104==        Start        Duration                        Node Name Name
==5104==       0.00ns          2.29us                                  warm_up()
==5104==       3.86ms        467.26us                                  scalar_add(float*, float*, float*, unsigned long)
==5104==       5.71ms         47.59us                                  vector_add(float*, float*, float*, unsigned long)
==5104==     Accumulate Time 517.15us, Total Calls 3
==5104==     Total Time 5.75ms
```

## 4. 采集控制

### 4.1. Session

topsprof 启动应用时，会创建一个新 session 或者加入已有的 session。
start/stop/cancel 通过 `--session` 指定要控制 session，若不指定 session 则控制当前用户已创建的所有 sessions。
`topsprof --session-list` 会列出当前系统所有 session。

### 4.2. 查询采集项

选项 query-activities 可用来查询可控制的采集项。
示例：

```
$ topsprof --query-activities
==== User Activities:
    Memcpy,Memcpy_cdte,Memcpy_sdte,Operator
```

### 4.3. 使用字符串控制

topsprof 支持使用 kernel profiling 流程采集数据。kernel profiling 流程不依赖于编译期收集数据，支持 factor 和 topscc 程序，支持采集 GCU kernel、ODTE、CDTE 和 SDTE 信息。选项 enable-activities 的规则如下：
可指定的 activities 包括 Operator、Memcpy、Memcpy_cdte、Memcpy_sdte，指定多个时用逗号分隔。
指定 Operator 表示采集 GCU kernel；指定 Memcpy 表示采集 ODTE；指定 Memcpy_cdte 表示采集 CDTE；指定 Memcpy_sdte 表示采集 SDTE。
若需要采集 CDTE 或 SDTE 信息，对于 factor 程序，编译时需要 export 以下的环境变量：

```
export ENFLAME_GENERATE_PROFILE_META=true
```

对于 topscc 程序，使用 topscc 编译时需添加 -fgcu-generate-profile-meta 参数。注意：采集 Memcpy_sdte、Memcpy_cdte 会较大增加算子运行时候的采集性能信息的 Overhead，导致算子整体运行时间变长，建议根据实际情况，开启该选项。

示例：

- 指定采集 GCU kernel 和 ODTE

```
--enable-activities Operator,Memcpy
```

选项 trace 及 topstx-domain-include 指定要采集 trace events 的 domains，指定多个时用逗号分隔。其中 trace 指定已定义的 domains；当 trace 指定的 domains 包含 topstx 时，可以用 topstx-domain-include 指定自定义的 domains。

示例：

- 采集 RUNTIME 和 TOPSPROFILER 的 trace events

```
--trace runtime,topsprofiler
```

### 4.4. 使用 json 文件控制

选项 export-activities 可以导出 json 格式文件，用于编辑。json 文件是树形节点，最末尾节点的 type 为 activity。设置此节点 isCheck 项为 true，即可开启相关采集项。随后使用 import-activities 可以导入编辑后的 json 文件，用于采集项控制。

### 4.5. 采集控制

首先启动一个 topsprof 用于采集，之后在另外的终端再开启 topsprof 进行控制；支持 start/stop/cancel。
一个常见的用法是先启动应用不采集，等合适时机手动开启采集，示例：

```
topsprof --profile-from-start off --enable-activities operator python xxx
```

等合适时机，启动新终端输入

```
topsprof --start
```

## 5. 输出

### 5.1. Export/Import

选项 export-profile 可以用来生成结果文件；可以使用 import-profile 选项导入 topsprof。
选项 export-visual-profiler 可以用来生成供 visual-profiler 使用的结果文件；可以用 visual-profiler 打开，也可以使用 import-profile 选项导入生成的 vpd 文件。
选项 export-rawdata 可以用来导出采集的原始数据；可以使用 import-rawdata 选项将原始数据导入 topsprof。

### 5.2. 应用输出

选项 show-output 置为 true，则将应用的 stdout/stderr 流发送到控制台。

## 6. 分布式

### 6.1. 分布式启动采集

分布式支持通过 mpirun 和 python ddp 启动 topsprof，示例如下：

```
mpirun [mpirun-arguments] topsprof [options] [application] [application-arguments]</br>
python -m torch.distributed.launch -no-python [python-arguments] topsprof [options] [application] [application-arguments]
```

### 6.2. 合并输出结果

通过分布式调用，topsprof 会为每个进程生成一份 vpd 文件；用户需要在运行结束后，将所有文件复制到一个文件夹，并调用 topsprof 进行合并。

```
topsprof --visual-profiler-merge-from {directory} --visual-profiler-merge-to {filename}
```

## 7. 附录

### 7.1. perf 工具说明

perf 是 linux 系统中提供的性能分析工具，常见的发行版都能提供安装；topsprof 部分采集功能依赖 perf。
topsprof 会直接调用 perf xxx 进行分析，请确保 perf 在系统路径 PATH 中能够查找到。

#### ubuntu 安装

```
sudo apt-get install linux-tools-common
sudo apt-get install linux-tools-"$(uname -r)"
sudo apt-get install linux-tools-generic
```

#### centos 安装

```
yum install perf
```

#### 从源码编译

```
git clone git://git.kernel.org/pub/scm/linux/kernel/git/acme/linux.git
cd linux/tools/perf
git checkout xxx #系统对应的内核版本
make
sudo make install
```

### 7.2. release note

V 1.0 首次发布

V 1.1 版本发布

- 无。

V 1.2 版本发布

- enable-activities 选项改为 optional，不指定时默认使能 operator 与 memcpy。
- 支持 topstx-max-bytes-size 限制采集 api trace 时字节流或字符串的长度。
- 打印 summary 信息不再限制最多打印 50 条。

V 1.3 版本发布

- 支持 profile-from-start 对 api trace 也起作用。
- 支持 delay 和 duration 选项，可按需动态控制 profiling 启停。
- 支持 timeunit 选项，可控制 console 输出的 GCU 事件的时间单位。

V 1.4 版本发布

- 增加 kernel-name/kernel-id/kernel-name-base 选项，以支持 kernel filter 模式。
- 支持 capture-range 选项，可按需指定采集范围。

V 1.5 版本发布

- 支持 timeunit 选项设置为 auto，自适应时间单位。
- 支持 command-file 选项，可打开包含选项的文件并解析选项。
- 支持 show-output 选项，可按需指定应用的 stdout/stderr 流是否发送到控制台；同时废弃 print-app-log 选项。
- 支持 kill 选项，可指定采集结束时 topsprof 向目标应用程序的进程组发送的信号。

V 1.6 版本发布

- 支持使用 start/stop/cancel 选项时，缺省 session 以控制当前用户已创建的所有 sessions。

V 1.7 版本发布

- 新增 ring-overwrite 选项，以支持 GCU400/410 平台 Ring Overwrite 模式。
- 选项 topstx-max-bytes-size 默认值变更为 8192B。
- 移除将 trace 选项值设定 all/cpu_all 以采集所有 domains 的支持。
