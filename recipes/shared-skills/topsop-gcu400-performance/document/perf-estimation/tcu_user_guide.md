> Imported material source: `Doc/TCU User Guide.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `TCU User Guide`.

# TCU User Guide

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
| 2025-02-20 | V 1.0 |
| 2025-06-20 | V 1.5 |
| 2025-08-21 | V 1.6 |
| 2025-11-26 | V 1.7 |

### 1.3. 名词解释

| 术语 | 说明 |
| --- | --- |
| GCU | General Compute Unit，通用计算单元。 |
| SIP | Scalable Intelligent Processor，可扩展的智能处理器，GCU 计算单元。 |
| DTE | Data Transformation Engine，数据转换引擎。 |
| TCD | tcu 输出的数据，可用 TopsCompute 打开的文件格式。 |

### 1.4. 概述

tcu 分析工具使您能够从命令行收集和查看分析数据。tcu 支持在 GCU 上收集内核执行的 SIP/DTE/LLC 指标，以及在CPU 上收集与 tops 相关的活动的时间线。选项通过命令行选项提供给 tcu。收集分析数据后，分析结果显示在控制台中，也可以保存以供 tcu 或 TopsCompute 以后查看。

### 1.5. 使用方法

tcu [options] [application] [application-arguments]

options 需要以 `--` 或者 `-` 开头，示例 `--print-api-summary`，`-print-api-summary`。

options 带参数可以使用空格或者等号隔开，示例 `--flag xxx` 和 `--flag=xxx` 效果是等同的。

## 2. 命令行选项

### 2.1. GCU 采集选项

| 选项 | 参数 | 默认值 | 说明 |
| --- | --- | --- | --- |
| profile-from-start | on,off | on | 在启动时启用/禁用采集。如果禁用，稍后可以另启动一个 tcu 进行控制。 |
| query-metrics | N/A | N/A | 列出设备所有支持的指标名称。 |
| enable-metrics | {format activity string} | N/A | 采集指定的指标。 |
| replay-mode | application,none | application | 指定重放模式以采集所有指定的指标。<br>application: 反复运行整个 application 以便收集所有指定的指标。<br>none: 无任何重放模式。 |
| section | {path} | N/A | 指定 section 配置文件的路径。 |
| kernel-name | {formatted kernel name expression} | N/A | 设置表达式匹配内核。如果内核不匹配，将不会被 profile。<br>*<kernel name>* 设置精确匹配的内核名称。<br>*regex:<expression>* 设置用于匹配内核名称的正则表达式。在将正则表达式符号识别为特殊字符的 shell （例如 Linux bash ）上，表达式需要用引号转义，例如 `--kernel-name regex:".*foo"`。 |
| kernel-id | {formatted kernel identifier} | N/A | 设置内核标识符匹配内核。如果内核不匹配，将不会被 profile。标识符必须采用以下格式：*context-id:stream-id:[name-operator:]kernel-name:invocation-nr*。<br>*context-id* 是 TopsRT context ID 或者正则表达式匹配 context ID。<br>*stream-id* 是 TopsRT stream ID 或者正则表达式匹配 stream ID。<br>*name-operator* 是可选的对 *kernel-name* 的操作符。现在 regex 是唯一支持的操作符。<br>*kernel-name* 是匹配内核名字的表达式。默认情况下，这是对 `--kernel-name-base` 所指定内容的完整、逐字匹配。在指定可选的正则表达式名称操作符时，这是对由 `--kernel-name-base` 指定的内容进行正则表达式匹配。<br>*invocation-nr* 是匹配的内核的第N次调用。多次调用可以使用正则表达式来匹配。<br>如果 *context-id*/*stream-id*/*invocation-nr* 是一个正整数，它会被用来严格匹配 context ID/stream ID/调用次数。否则，它会被认为是一个正则表达式。 |
| kernel-name-base | function,demangled,mangled | function | 为 `--kernel-name` 和 `--kernel-id` 的 *kernel-name* 设置匹配名字的方式。选项包括：<br>*function*: 不带参数的内核函数名字。例如 vector_add。<br>*demangled*: 包括参数的 demangled 内核函数名字。例如 vector_add(float*, float*, float*, unsigned long)。<br>*mangled*: mangled 内核函数名字。例如 _Z10vector_addPfS_S_m。 |

### 2.2. 打印选项

| 选项 | 参数 | 默认值 | 说明 |
| --- | --- | --- | --- |
| print-gcu-summary | N/A | N/A | 输出 GCU 数据的汇总报表。 |
| print-gcu-trace | N/A | N/A | 输出 GCU 数据并按时间排序。 |
| print-summary | N/A | N/A | 输出采集数据汇总报表。注意：如果没有指明打印格式，默认按此格式输出。 |
| print-summary-per-gcu | N/A | N/A | 输出采集数据汇总报表，并按设备区分。 |
| quiet | N/A | N/A | 安静模式，不做任何输出。 |
| debug | N/A | N/A | 运行时会打印调试信息。 |
| timeunit | {unit} | auto | 设置输出时的基本时间单位，可设值包括 auto、nsec、nanoseconds、usec、microseconds、msec、milliseconds、seconds、cycle。 |

### 2.3. 输入输出选项

| 选项 | 参数 | 默认值 | 说明 |
| --- | --- | --- | --- |
| export | {filename} | N/A | 导出采集数据文件，可在之后由 import 参数导入，也可以在 TopsCompute 中打开。如果文件扩展名不是 tcd，则加上 “.tcd” 后缀。 |
| import | {filename} | N/A | 导入采集数据文件，可导入前一次 export 输出的数据。 |
| export-rawdata | {filename} | N/A | 导出原始数据。 |
| import-rawdata | {filename} | N/A | 导入原始数据。 |
| force-overwrite | N/A | N/A | 强制重写模式（已存在的文件会被覆盖）。 |
| log-file | {filename} | N/A | 收集采集程序全部控制台输出到指定文件。这个文件如果存在，会被覆盖。如果不存在，会被创建。 |
| debug-dump | N/A | N/A | 打印调试信息，并在当前目录下生成以 tcu_debug_{pid}_{date}_{time}.zip 名字打包的文件。 |
| export-csv | {filename} | N/A | 以 csv 格式导出测试结果。 |
| command-file | {filename} | N/A | 打开一个包含选项的文件并解析选项。注意：命令行指定选项可以覆盖文件中指定选项。此选项可以指定多次。 |
| print-app-log | N/A | N/A | 历史版本遗留选项，目前已无实际效果。 |

### 2.4. 控制选项

| 选项 | 参数 | 默认值 | 说明 |
| --- | --- | --- | --- |
| session | {string} | N/A | 标记一个已存在的 session。session 名称只能是英文字符、数字、‘-’ 或 ’_’。 |
| session-new | {string} | {pid} | 创建一个新的 session，可用于控制标记。session 名称只能是英文字符、数字、‘-’ 或 ’_’。 |
| session-list | N/A | N/A | 列出系统上存在的 session。 |
| start | N/A | N/A | 启动采集，用于控制一个之前启动的 tcu 进程，使用 session 可指定进程。 |
| stop | N/A | N/A | 停止采集，用于控制一个之前启动的 tcu 进程，使用 session 可指定进程。 |
| cancel | N/A | N/A | 撤销采集，用于控制一个之前启动的 tcu 进程，使用 session 可指定进程。 |

### 2.5. 高级选项

| 选项 | 参数 | 默认值 | 说明 |
| --- | --- | --- | --- |
| reset | N/A | N/A | 重置 tcu 内部状态。当 tcu 异常退出后使用。 |

### 2.6. 其他选项

| 选项 | 参数 | 默认值 | 说明 |
| --- | --- | --- | --- |
| help | N/A | N/A | 打印帮助信息。 |
| version | N/A | N/A | 打印版本信息。 |

### 2.7. 选项说明

#### 2.7.1. 冲突选项

以下每行内的选项不能同时使用：

```
import-rawdata, import
import, export
print-api-summary, print-gcu-summary, print-summary, print-summary-per-gcu
session, session-new
kernel-id, kernel-name
```

#### 2.7.2. 单独使用选项

以下选项只能单独使用：

```
query-metrics, help, version, reset, session-list
```

#### 2.7.3. 控制选项

以下选项只能单独或配合 session 使用：

```
start, stop, cancel
```

#### 2.7.4. 启动应用采集限制项

以下选项只能启动应用采集时使用：

```
profile-from-start, enable-metrics, section, replay-mode, kernel-id, kernel-name, kernel-name-base, export-rawdata, session-new
```

## 3. 采集模式

tcu 可以运行在以下任意一种模式中。

### 3.1. 统计模式

统计模式是 tcu 的默认模式。在此模式，tcu 输出算子和 api 信息，以及算子 metric 信息。对算子和 api 信息，每一行会输出算子耗时最大值、最小值、平均值、调用次数等统计信息。对算子 metric 信息，按照算子调用次数从大到小，每个算子输出各个 metric 的最大值、最小值、平均值、调用次数等统计信息。tcu 输出会增加前缀 =={pid}==， {pid} 是被采集的应用程序进程 id。 示例：

```
$ tcu --enable-metrics sip/busy,sip/1d_efficiency ./simpleElemwiseAdd
==7285== TCU is profiling process 7285, session: 7122, command: ./simpleElemwiseAdd
==7285== Acquiring tasks...
[./simpleElemwiseAdd] - Starting...
==7285== Got task list
profiler: profile agent configured: 11000
ok echo
==7285== TCU is attaching task 50000
profiler: profile agent created: 12000
device name: GCU
CPU bandwidth is     1.17 GB/s
Scalar version: successful, bandwidth is     0.63 GB/s
Vector version: successful, bandwidth is     5.36 GB/s
PASS!
process profile data [=========================================] 100% 0.014s
==7285== GCU activities:
==7285==      Time(%)         Time    Calls          Avg          Min          Max Name
==7285==       97.70%       1.06ms        1       1.06ms       1.06ms       1.06ms scalar_add(float*, float*, float*, unsigned long)
==7285==        2.21%      23.97us        1      23.97us      23.97us      23.97us vector_add(float*, float*, float*, unsigned long)
==7285==        0.09%     985.00ns        1     985.00ns     985.00ns     985.00ns warm_up()
==7285==     Accumulate Time 1.08ms, Total Calls 3
==7285==     Total Time 6.77ms
==7285==

==7285== CPU activities:
==7285==     does not contain cpu kernel data.

==7285== RUNTIME activities:
==7285==     does not contain runtime api data.

==7285== GCU metrics:
==7285==     vector_add(float*, float*, float*, unsigned long) <<<4,1,1>>> <<<6,1,1>>> <<<1,1,1>>>, Invocations 1
      Metric name: SIP/BUSY, Unit: CYCLE, Value: 32467.542
        --- --- ----------------- ----------------- ----------------- -----------
        SIC SIP           Minimum           Maximum           Average Invocations
        --- --- ----------------- ----------------- ----------------- -----------
          0   0             32031             32031             32031           1
          0   1             32396             32396             32396           1
          0   2             32354             32354             32354           1
          0   3             32651             32651             32651           1
          0   4             32664             32664             32664           1
          0   5             32903             32903             32903           1
          1   0             32049             32049             32049           1
          1   1             32423             32423             32423           1
          1   2             32353             32353             32353           1
          1   3             32639             32639             32639           1
          1   4             32840             32840             32840           1
          1   5             32976             32976             32976           1
          2   0             31847             31847             31847           1
          2   1             32246             32246             32246           1
          2   2             32336             32336             32336           1
          2   3             32341             32341             32341           1
          2   4             32601             32601             32601           1
          2   5             32596             32596             32596           1
          3   0             32242             32242             32242           1
          3   1             32203             32203             32203           1
          3   2             32345             32345             32345           1
          3   3             32416             32416             32416           1
          3   4             32830             32830             32830           1
          3   5             32939             32939             32939           1
        --- --- ----------------- ----------------- ----------------- -----------

      Metric name: SIP/1D_EFFICIENCY, Unit: %, Value: 0.197
        --- --- ----------------- ----------------- ----------------- -----------
        SIC SIP           Minimum           Maximum           Average Invocations
        --- --- ----------------- ----------------- ----------------- -----------
          0   0             0.200             0.200             0.200           1
          0   1             0.198             0.198             0.198           1
          0   2             0.198             0.198             0.198           1
          0   3             0.196             0.196             0.196           1
          0   4             0.196             0.196             0.196           1
          0   5             0.195             0.195             0.195           1
          1   0             0.200             0.200             0.200           1
          1   1             0.197             0.197             0.197           1
          1   2             0.198             0.198             0.198           1
          1   3             0.196             0.196             0.196           1
          1   4             0.195             0.195             0.195           1
          1   5             0.194             0.194             0.194           1
          2   0             0.201             0.201             0.201           1
          2   1             0.198             0.198             0.198           1
          2   2             0.198             0.198             0.198           1
          2   3             0.198             0.198             0.198           1
          2   4             0.196             0.196             0.196           1
          2   5             0.196             0.196             0.196           1
          3   0             0.198             0.198             0.198           1
          3   1             0.199             0.199             0.199           1
          3   2             0.198             0.198             0.198           1
          3   3             0.197             0.197             0.197           1
          3   4             0.195             0.195             0.195           1
          3   5             0.194             0.194             0.194           1
        --- --- ----------------- ----------------- ----------------- -----------

    scalar_add(float*, float*, float*, unsigned long) <<<4,1,1>>> <<<6,1,1>>> <<<1,1,1>>>, Invocations 1
      Metric name: SIP/BUSY, Unit: CYCLE, Value: 1470914
        --- --- ----------------- ----------------- ----------------- -----------
        SIC SIP           Minimum           Maximum           Average Invocations
        --- --- ----------------- ----------------- ----------------- -----------
          0   0           1482796           1482796           1482796           1
          0   1           1482944           1482944           1482944           1
          0   2           1483562           1483562           1483562           1
          0   3           1458788           1458788           1458788           1
          0   4           1458883           1458883           1458883           1
          0   5           1483476           1483476           1483476           1
          1   0           1458666           1458666           1458666           1
          1   1           1482970           1482970           1482970           1
          1   2           1458798           1458798           1458798           1
          1   3           1458676           1458676           1458676           1
          1   4           1483424           1483424           1483424           1
          1   5           1483536           1483536           1483536           1
          2   0           1458195           1458195           1458195           1
          2   1           1458252           1458252           1458252           1
          2   2           1482904           1482904           1482904           1
          2   3           1458515           1458515           1458515           1
          2   4           1483203           1483203           1483203           1
          2   5           1483348           1483348           1483348           1
          3   0           1458254           1458254           1458254           1
          3   1           1458556           1458556           1458556           1
          3   2           1483101           1483101           1483101           1
          3   3           1458679           1458679           1458679           1
          3   4           1458881           1458881           1458881           1
          3   5           1483529           1483529           1483529           1
        --- --- ----------------- ----------------- ----------------- -----------

      Metric name: SIP/1D_EFFICIENCY, Unit: %, Value: 0.557
        --- --- ----------------- ----------------- ----------------- -----------
        SIC SIP           Minimum           Maximum           Average Invocations
        --- --- ----------------- ----------------- ----------------- -----------
          0   0             0.552             0.552             0.552           1
          0   1             0.552             0.552             0.552           1
          0   2             0.552             0.552             0.552           1
          0   3             0.562             0.562             0.562           1
          0   4             0.562             0.562             0.562           1
          0   5             0.552             0.552             0.552           1
          1   0             0.562             0.562             0.562           1
          1   1             0.552             0.552             0.552           1
          1   2             0.562             0.562             0.562           1
          1   3             0.562             0.562             0.562           1
          1   4             0.552             0.552             0.552           1
          1   5             0.552             0.552             0.552           1
          2   0             0.562             0.562             0.562           1
          2   1             0.562             0.562             0.562           1
          2   2             0.552             0.552             0.552           1
          2   3             0.562             0.562             0.562           1
          2   4             0.552             0.552             0.552           1
          2   5             0.552             0.552             0.552           1
          3   0             0.562             0.562             0.562           1
          3   1             0.562             0.562             0.562           1
          3   2             0.552             0.552             0.552           1
          3   3             0.562             0.562             0.562           1
          3   4             0.562             0.562             0.562           1
          3   5             0.552             0.552             0.552           1
        --- --- ----------------- ----------------- ----------------- -----------

    warm_up() <<<4,1,1>>> <<<6,1,1>>> <<<1,1,1>>>, Invocations 1
      Metric name: SIP/BUSY, Unit: CYCLE, Value: 892.083
        --- --- ----------------- ----------------- ----------------- -----------
        SIC SIP           Minimum           Maximum           Average Invocations
        --- --- ----------------- ----------------- ----------------- -----------
          0   0               871               871               871           1
          0   1               902               902               902           1
          0   2               894               894               894           1
          0   3               912               912               912           1
          0   4               885               885               885           1
          0   5               886               886               886           1
          1   0               891               891               891           1
          1   1               860               860               860           1
          1   2               897               897               897           1
          1   3               974               974               974           1
          1   4               902               902               902           1
          1   5               897               897               897           1
          2   0               849               849               849           1
          2   1               861               861               861           1
          2   2               885               885               885           1
          2   3               903               903               903           1
          2   4               861               861               861           1
          2   5               900               900               900           1
          3   0               889               889               889           1
          3   1               891               891               891           1
          3   2               868               868               868           1
          3   3               907               907               907           1
          3   4               928               928               928           1
          3   5               897               897               897           1
        --- --- ----------------- ----------------- ----------------- -----------

      Metric name: SIP/1D_EFFICIENCY, Unit: %, Value: 0
        --- --- ----------------- ----------------- ----------------- -----------
        SIC SIP           Minimum           Maximum           Average Invocations
        --- --- ----------------- ----------------- ----------------- -----------
          0   0                 0                 0                 0           1
          0   1                 0                 0                 0           1
          0   2                 0                 0                 0           1
          0   3                 0                 0                 0           1
          0   4                 0                 0                 0           1
          0   5                 0                 0                 0           1
          1   0                 0                 0                 0           1
          1   1                 0                 0                 0           1
          1   2                 0                 0                 0           1
          1   3                 0                 0                 0           1
          1   4                 0                 0                 0           1
          1   5                 0                 0                 0           1
          2   0                 0                 0                 0           1
          2   1                 0                 0                 0           1
          2   2                 0                 0                 0           1
          2   3                 0                 0                 0           1
          2   4                 0                 0                 0           1
          2   5                 0                 0                 0           1
          3   0                 0                 0                 0           1
          3   1                 0                 0                 0           1
          3   2                 0                 0                 0           1
          3   3                 0                 0                 0           1
          3   4                 0                 0                 0           1
          3   5                 0                 0                 0           1
        --- --- ----------------- ----------------- ----------------- -----------
```

### 3.2. 跟踪模式

跟踪模式以时间顺序依次显示算子各个 metric 信息。tcu 输出会增加前缀 =={pid}==， {pid} 是被采集的应用程序进程 id。 示例：

```
$ tcu --enable-metrics sip/busy,sip/1d_efficiency --print-gcu-trace ./simpleElemwiseAdd
==7499== TCU is profiling process 7499, session: 7336, command: ./simpleElemwiseAdd
==7499== Acquiring tasks...
[./simpleElemwiseAdd] - Starting...
==7499== Got task list
profiler: profile agent configured: 11000
ok echo
==7499== TCU is attaching task 50000
profiler: profile agent created: 12000
device name: GCU
CPU bandwidth is     0.58 GB/s
Scalar version: successful, bandwidth is     0.63 GB/s
Vector version: successful, bandwidth is     6.01 GB/s
PASS!
process profile data [=========================================] 100% 0.013s
==7499== GCU metric trace:
==7499==   Device 0, Kernel 131072  warm_up() <<<4,1,1>>> <<<6,1,1>>> <<<1,1,1>>>, Start 1755748640.11s, Duration 1.60us
    Metric name: SIP/1D_EFFICIENCY, Unit: %, Value: 0
        --- --- -----------------
        SIC SIP      Metric Value
        --- --- -----------------
          0   0                 0
          0   2                 0
          0   4                 0
          0   1                 0
          0   3                 0
          0   5                 0
          1   0                 0
          1   2                 0
          1   4                 0
          1   1                 0
          1   3                 0
          1   5                 0
          2   0                 0
          2   2                 0
          2   4                 0
          2   1                 0
          2   3                 0
          2   5                 0
          3   0                 0
          3   2                 0
          3   4                 0
          3   1                 0
          3   3                 0
          3   5                 0
        --- --- -----------------
    Metric name: SIP/BUSY, Unit: CYCLE, Value: 884.375
        --- --- -----------------
        SIC SIP      Metric Value
        --- --- -----------------
          0   0               869
          0   2               876
          0   4               891
          0   1               865
          0   3               887
          0   5               883
          1   0               883
          1   2               885
          1   4               904
          1   1               877
          1   3               915
          1   5               903
          2   0               859
          2   2               856
          2   4               895
          2   1               876
          2   3               886
          2   5               864
          3   0               891
          3   2               887
          3   4               903
          3   1               886
          3   3               885
          3   5               899
        --- --- -----------------

  Device 0, Kernel 131073  scalar_add(float*, float*, float*, unsigned long) <<<4,1,1>>> <<<6,1,1>>> <<<1,1,1>>>, Start 1755748640.12s, Duration 1.06ms
    Metric name: SIP/1D_EFFICIENCY, Unit: %, Value: 0.558
        --- --- -----------------
        SIC SIP      Metric Value
        --- --- -----------------
          0   0             0.562
          0   2             0.552
          0   4             0.562
          0   1             0.552
          0   3             0.562
          0   5             0.562
          1   0             0.562
          1   2             0.552
          1   4             0.562
          1   1             0.552
          1   3             0.552
          1   5             0.552
          2   0             0.553
          2   2             0.562
          2   4             0.552
          2   1             0.552
          2   3             0.562
          2   5             0.562
          3   0             0.552
          3   2             0.562
          3   4             0.562
          3   1             0.562
          3   3             0.562
          3   5             0.562
        --- --- -----------------
    Metric name: SIP/BUSY, Unit: CYCLE, Value: 1468883.125
        --- --- -----------------
        SIC SIP      Metric Value
        --- --- -----------------
          0   0           1458390
          0   2           1483386
          0   4           1458845
          0   1           1482912
          0   3           1458581
          0   5           1458912
          1   0           1458692
          1   2           1483714
          1   4           1458867
          1   1           1482983
          1   3           1483238
          1   5           1483552
          2   0           1482608
          2   2           1458339
          2   4           1483229
          2   1           1483052
          2   3           1458690
          2   5           1458798
          3   0           1482804
          3   2           1458544
          3   4           1458890
          3   1           1458550
          3   3           1458675
          3   5           1458944
        --- --- -----------------

  Device 0, Kernel 131074  vector_add(float*, float*, float*, unsigned long) <<<4,1,1>>> <<<6,1,1>>> <<<1,1,1>>>, Start 1755748640.12s, Duration 24.37us
    Metric name: SIP/1D_EFFICIENCY, Unit: %, Value: 0.197
        --- --- -----------------
        SIC SIP      Metric Value
        --- --- -----------------
          0   0             0.199
          0   2             0.197
          0   4             0.196
          0   1             0.199
          0   3             0.197
          0   5             0.196
          1   0             0.200
          1   2             0.196
          1   4             0.196
          1   1             0.199
          1   3             0.196
          1   5             0.194
          2   0             0.199
          2   2             0.199
          2   4             0.197
          2   1             0.200
          2   3             0.198
          2   5             0.195
          3   0             0.199
          3   2             0.198
          3   4             0.196
          3   1             0.198
          3   3             0.196
          3   5             0.194
        --- --- -----------------
    Metric name: SIP/BUSY, Unit: CYCLE, Value: 32473.417
        --- --- -----------------
        SIC SIP      Metric Value
        --- --- -----------------
          0   0             32240
          0   2             32564
          0   4             32679
          0   1             32162
          0   3             32442
          0   5             32731
          1   0             32014
          1   2             32650
          1   4             32668
          1   1             32206
          1   3             32662
          1   5             32939
          2   0             32141
          2   2             32174
          2   4             32442
          2   1             32071
          2   3             32379
          2   5             32869
          3   0             32228
          3   2             32365
          3   4             32713
          3   1             32403
          3   3             32680
          3   5             32940
        --- --- -----------------
```

## 4. 采集控制

### 4.1. GCU 采集

使用选项 enable-metrics 指定需要采集的算子 metrics，指定多个时用逗号分隔。示例：

```
$ tcu --enable-metrics sip/busy,sip/1d_efficiency --print-gcu-trace ./simpleElemwiseAdd
```

当前平台可以使用的 metrics 可以通过选项 query-metrics 来查询。

在 GCU300 平台上支持的 metrics ：

```
$ tcu --query-metrics
SIP/1D_EFFICIENCY,SIP/2D_EFFICIENCY,SIP/BUSY,SIP/MSF_EFFICIENCY
SIP/L1_ICACHE_HW_PREFETCH,SIP/L1_ICACHE_MISS,SIP/L1_ICACHE_SW_PREFETCH
```

| Engine | Metric Name | Unit | Description |
| --- | --- | --- | --- |
| SIP | SIP/1D_EFFICIENCY | % | SIP 1D 指令效率 |
| SIP | SIP/2D_EFFICIENCY | % | SIP 2D 指令效率 |
| SIP | SIP/BUSY | CYCLE | SIP 运行总 cycle 数 |
| SIP | SIP/MSF_EFFICIENCY | % | SIP MSF 指令效率 |
| SIP | SIP/L1_ICACHE_HW_PREFETCH | EVENT | SIP L1 instruction cache hardware prefetch 发生次数 |
| SIP | SIP/L1_ICACHE_MISS | EVENT | SIP L1 instruction cache miss 发生次数 |
| SIP | SIP/L1_ICACHE_SW_PREFETCH | EVENT | SIP L1 instruction cache software prefetch 发生次数 |

在 GCU400/410 平台上支持的 metrics ：

```
$ tcu --query-metrics
CDTE/READ_BANDWIDTH,CDTE/WRITE_BANDWIDTH
EDTE/READ_BANDWIDTH,EDTE/WRITE_BANDWIDTH
FUSION/LLC_READ_BANDWIDTH_WITHOUT_ICACHE,FUSION/LLC_READ_BYTE_WITHOUT_ICACHE,FUSION/LLC_READ_THROUGHPUT_WITHOUT_ICACHE
LLC/READ,LLC/READ_BANDWIDTH,LLC/READ_BYTE,LLC/READ_COUNT,LLC/READ_HIT,LLC/READ_HIT_BYTE,LLC/READ_HIT_RATE,LLC/READ_MISS,LLC/READ_MISS_BYTE,LLC/READ_THROUGHPUT,LLC/WRITE,LLC/WRITE_BANDWIDTH,LLC/WRITE_BYTE,LLC/WRITE_COUNT,LLC/WRITE_HIT,LLC/WRITE_HIT_BYTE,LLC/WRITE_HIT_RATE,LLC/WRITE_MISS,LLC/WRITE_MISS_BYTE,LLC/WRITE_THROUGHPUT
SIP/1D_EFFICIENCY,SIP/1D_ISSUE,SIP/2D_EFFICIENCY,SIP/2D_GEMM_ISSUE,SIP/2D_MSF_ISSUE,SIP/BUSY,SIP/CF0_ISSUE,SIP/CF1_ISSUE,SIP/GATHER_EFFICIENCY,SIP/L1_ICACHE_HW_PREFETCH,SIP/L1_ICACHE_MISS,SIP/L1_ICACHE_SW_PREFETCH,SIP/L1_T0_GATHER_REQ_ISSUE,SIP/L1_T0_RESP0_TAKEN,SIP/L1_T0_RESP1_TAKEN,SIP/L1_T0_RESP2_TAKEN,SIP/L1_T0_RESP3_TAKEN,SIP/L1_T0_SCATTER_REQ_ISSUE,SIP/L1_T0_VLD_REQ0_ISSUE,SIP/L1_T0_VLD_REQ1_ISSUE,SIP/L1_T0_VLD_REQ2_ISSUE,SIP/L1_T0_VLD_REQ3_ISSUE,SIP/L1_T0_VST_REQ0_ISSUE,SIP/L1_T0_VST_REQ1_ISSUE,SIP/L1_T0_VST_REQ2_ISSUE,SIP/L1_T0_VST_REQ3_ISSUE,SIP/L1_T1_RESP0_TAKEN,SIP/L1_T1_RESP1_TAKEN,SIP/L1_T1_RESP2_TAKEN,SIP/L1_T1_RESP3_TAKEN,SIP/L1_T1_VLD_REQ0_ISSUE,SIP/L1_T1_VLD_REQ1_ISSUE,SIP/L1_T1_VLD_REQ2_ISSUE,SIP/L1_T1_VLD_REQ3_ISSUE,SIP/L1_T2_RESP0_TAKEN,SIP/L1_T2_RESP1_TAKEN,SIP/L1_T2_RESP2_TAKEN,SIP/L1_T2_RESP3_TAKEN,SIP/L1_T2_VLD_REQ0_ISSUE,SIP/L1_T2_VLD_REQ1_ISSUE,SIP/L1_T2_VLD_REQ2_ISSUE,SIP/L1_T2_VLD_REQ3_ISSUE,SIP/LDSMR_EFFICIENCY,SIP/MSF_EFFICIENCY,SIP/SCALAR0_SALU_ISSUE,SIP/SCALAR0_SLDST_ISSUE,SIP/SCALAR1_SALU_ISSUE,SIP/SCALAR1_SLDST_ISSUE,SIP/SCATTER_EFFICIENCY,SIP/UISA_1D_ISSUE,SIP/UISA_2D_GEMM_ISSUE,SIP/UISA_2D_MSF_ISSUE,SIP/UISA_MOV_SMR_ISSUE,SIP/UISA_VLDA_L0P5_ISSUE,SIP/UISA_VLDA_L0_ISSUE,SIP/UISA_VLDA_L1_ISSUE,SIP/UISA_VLD_IV_ISSUE,SIP/UISA_VLD_SMR_ISSUE,SIP/UISA_VSTA_L0_ISSUE,SIP/UISA_VSTA_L1_ISSUE,SIP/VLD_BUSY,SIP/VLD_EFFICIENCY,SIP/VSTA_L0_EFFICIENCY,SIP/VST_BUSY,SIP/VST_EFFICIENCY
SIP/1D_DATA_HAZARD_ALL_STALL,SIP/1D_DATA_HAZARD_EFFICIENCY,SIP/2D_DATA_HAZARD_ALL_STALL,SIP/2D_DATA_HAZARD_EFFICIENCY,SIP/CF_CREDIT_ZERO,SIP/GROUP1_BUSY,SIP/L0_ICACHE_REQ0_ISSUE,SIP/L0_ICACHE_REQ1_ISSUE,SIP/L0_ICACHE_REQ2_ISSUE,SIP/L0_ICACHE_REQ3_ISSUE,SIP/L0_ICACHE_RESP_TAKEN,SIP/SCALAR0_DATA_HAZARD_ALL_STALL,SIP/SCALAR1_DATA_HAZARD_ALL_STALL,SIP/SCALAR_DATA_HAZARD_EFFICIENCY,SIP/SDMEM_CREDIT_ZERO,SIP/THD0_BRANCH_FLUSH,SIP/THD0_THD8_ALL_WAIT_OR_HALT,SIP/THD0_THD9_ALL_WAIT_OR_HALT,SIP/THD0_WAIT,SIP/THD1_BRANCH_FLUSH,SIP/THD1_WAIT,SIP/THD2_BRANCH_FLUSH,SIP/THD2_WAIT,SIP/THD3_BRANCH_FLUSH,SIP/THD3_WAIT,SIP/THD4_BRANCH_FLUSH,SIP/THD4_WAIT,SIP/THD5_BRANCH_FLUSH,SIP/THD5_WAIT,SIP/THD6_BRANCH_FLUSH,SIP/THD6_WAIT,SIP/THD7_BRANCH_FLUSH,SIP/THD7_WAIT,SIP/THD8_BRANCH_FLUSH,SIP/THD8_WAIT,SIP/THD9_BRANCH_FLUSH,SIP/THD9_WAIT,SIP/UISA_1D_DATA_HAZARD_ALL_STALL,SIP/UISA_2D_DATA_HAZARD_ALL_STALL,SIP/UISA_MOV_SMR_DATA_HAZARD_ALL_STALL,SIP/UISA_VLDA_DATA_HAZARD_ALL_STALL,SIP/UISA_VST_DATA_HAZARD_ALL_STALL,SIP/VLD_DATA_HAZARD_ALL_STALL,SIP/VLD_DATA_HAZARD_EFFICIENCY,SIP/VST_DATA_HAZARD_ALL_STALL,SIP/VST_DATA_HAZARD_EFFICIENCY
```

| Engine | Metric Name | Unit | Description |
| --- | --- | --- | --- |
| CDTE | CDTE/READ_BANDWIDTH | GB/s | CDTE 读带宽 |
| CDTE | CDTE/WRITE_BANDWIDTH | GB/s | CDTE 写带宽 |
| EDTE | EDTE/READ_BANDWIDTH | GB/s | EDTE 读带宽 |
| EDTE | EDTE/WRITE_BANDWIDTH | GB/s | EDTE 写带宽 |
| LLC | LLC/READ | COUNT | LLC 读次数 |
| LLC | LLC/READ_BANDWIDTH | GB/s | LLC 读带宽 |
| LLC | LLC/READ_BYTE | BYTE | LLC 读字节数 |
| LLC | LLC/READ_HIT | COUNT | LLC 读命中次数 |
| LLC | LLC/READ_HIT_BYTE | BYTE | LLC 读命中字节 |
| LLC | LLC/READ_HIT_RATE | % | LLC 读命中率 |
| LLC | LLC/READ_MISS | COUNT | LLC 读 miss 次数 |
| LLC | LLC/READ_MISS_BYTE | BYTE | LLC 读 miss 字节 |
| LLC | LLC/READ_THROUGHPUT | B/s | LLC 读吞吐量 |
| LLC | LLC/WRITE | COUNT | LLC 写次数 |
| LLC | LLC/WRITE_BANDWIDTH | GB/s | LLC 写带宽 |
| LLC | LLC/WRITE_BYTE | BYTE | LLC 写字节数 |
| LLC | LLC/WRITE_HIT | COUNT | LLC 写命中次数 |
| LLC | LLC/WRITE_HIT_BYTE | BYTE | LLC 写命中字节 |
| LLC | LLC/WRITE_HIT_RATE | % | LLC 写命中率 |
| LLC | LLC/WRITE_MISS | COUNT | LLC 写 miss 次数 |
| LLC | LLC/WRITE_MISS_BYTE | BYTE | LLC 写 miss 字节 |
| LLC | LLC/WRITE_THROUGHPUT | B/s | LLC 写吞吐量 |
| SIP | SIP/1D_EFFICIENCY | % | SIP 1D 指令效率 |
| SIP | SIP/1D_ISSUE | EVENT | SIP 1D 指令发射次数 |
| SIP | SIP/2D_EFFICIENCY | % | SIP 2D 指令效率 |
| SIP | SIP/2D_GEMM_ISSUE | EVENT |  |
| SIP | SIP/2D_MSF_ISSUE | EVENT | SIP MSF 指令发射次数 |
| SIP | SIP/BUSY | CYCLE | SIP 运行总 cycle 数 |
| SIP | SIP/CF0_ISSUE | EVENT |  |
| SIP | SIP/CF1_ISSUE | EVENT |  |
| SIP | SIP/GATHER_EFFICIENCY | % |  |
| SIP | SIP/L1_ICACHE_HW_PREFETCH | EVENT | SIP L1 instruction cache hardware prefetch 发生次数 |
| SIP | SIP/L1_ICACHE_MISS | EVENT | SIP L1 instruction cache miss 发生次数 |
| SIP | SIP/L1_ICACHE_SW_PREFETCH | EVENT | SIP L1 instruction cache software prefetch 发生次数 |
| SIP | SIP/L1_T0_GATHER_REQ_ISSUE | EVENT |  |
| SIP | SIP/L1_T0_RESP0_TAKEN | EVENT |  |
| SIP | SIP/L1_T0_RESP1_TAKEN | EVENT |  |
| SIP | SIP/L1_T0_RESP2_TAKEN | EVENT |  |
| SIP | SIP/L1_T0_RESP3_TAKEN | EVENT |  |
| SIP | SIP/L1_T0_SCATTER_REQ_ISSUE | EVENT |  |
| SIP | SIP/L1_T0_VLD_REQ0_ISSUE | EVENT |  |
| SIP | SIP/L1_T0_VLD_REQ1_ISSUE | EVENT |  |
| SIP | SIP/L1_T0_VLD_REQ2_ISSUE | EVENT |  |
| SIP | SIP/L1_T0_VLD_REQ3_ISSUE | EVENT |  |
| SIP | SIP/L1_T0_VST_REQ0_ISSUE | EVENT |  |
| SIP | SIP/L1_T0_VST_REQ1_ISSUE | EVENT |  |
| SIP | SIP/L1_T0_VST_REQ2_ISSUE | EVENT |  |
| SIP | SIP/L1_T0_VST_REQ3_ISSUE | EVENT |  |
| SIP | SIP/L1_T1_RESP0_TAKEN | EVENT |  |
| SIP | SIP/L1_T1_RESP1_TAKEN | EVENT |  |
| SIP | SIP/L1_T1_RESP2_TAKEN | EVENT |  |
| SIP | SIP/L1_T1_RESP3_TAKEN | EVENT |  |
| SIP | SIP/L1_T1_VLD_REQ0_ISSUE | EVENT |  |
| SIP | SIP/L1_T1_VLD_REQ1_ISSUE | EVENT |  |
| SIP | SIP/L1_T1_VLD_REQ2_ISSUE | EVENT |  |
| SIP | SIP/L1_T1_VLD_REQ3_ISSUE | EVENT |  |
| SIP | SIP/L1_T2_RESP0_TAKEN | EVENT |  |
| SIP | SIP/L1_T2_RESP1_TAKEN | EVENT |  |
| SIP | SIP/L1_T2_RESP2_TAKEN | EVENT |  |
| SIP | SIP/L1_T2_RESP3_TAKEN | EVENT |  |
| SIP | SIP/L1_T2_VLD_REQ0_ISSUE | EVENT |  |
| SIP | SIP/L1_T2_VLD_REQ1_ISSUE | EVENT |  |
| SIP | SIP/L1_T2_VLD_REQ2_ISSUE | EVENT |  |
| SIP | SIP/L1_T2_VLD_REQ3_ISSUE | EVENT |  |
| SIP | SIP/LDSMR_EFFICIENCY | % |  |
| SIP | SIP/MSF_EFFICIENCY | % | SIP MSF 指令效率 |
| SIP | SIP/SCALAR0_SALU_ISSUE | EVENT |  |
| SIP | SIP/SCALAR0_SLDST_ISSUE | EVENT |  |
| SIP | SIP/SCALAR1_SALU_ISSUE | EVENT |  |
| SIP | SIP/SCALAR1_SLDST_ISSUE | EVENT |  |
| SIP | SIP/SCATTER_EFFICIENCY | % |  |
| SIP | SIP/UISA_1D_ISSUE | EVENT |  |
| SIP | SIP/UISA_2D_GEMM_ISSUE | EVENT |  |
| SIP | SIP/UISA_2D_MSF_ISSUE | EVENT |  |
| SIP | SIP/UISA_MOV_SMR_ISSUE | EVENT |  |
| SIP | SIP/UISA_VLDA_L0P5_ISSUE | EVENT |  |
| SIP | SIP/UISA_VLDA_L0_ISSUE | EVENT |  |
| SIP | SIP/UISA_VLDA_L1_ISSUE | EVENT |  |
| SIP | SIP/UISA_VLD_IV_ISSUE | EVENT |  |
| SIP | SIP/UISA_VLD_SMR_ISSUE | EVENT |  |
| SIP | SIP/UISA_VSTA_L0_ISSUE | EVENT |  |
| SIP | SIP/UISA_VSTA_L1_ISSUE | EVENT |  |
| SIP | SIP/VLD_BUSY | EVENT | SIP VLD 指令发射次数 |
| SIP | SIP/VLD_EFFICIENCY | % | SIP VLD 指令效率 |
| SIP | SIP/VSTA_L0_EFFICIENCY | % |  |
| SIP | SIP/VST_BUSY | EVENT | SIP VST 指令发射次数 |
| SIP | SIP/VST_EFFICIENCY | % | SIP VST 指令效率 |
| SIP | SIP/1D_DATA_HAZARD_ALL_STALL | EVENT |  |
| SIP | SIP/1D_DATA_HAZARD_EFFICIENCY | % |  |
| SIP | SIP/2D_DATA_HAZARD_ALL_STALL | EVENT |  |
| SIP | SIP/2D_DATA_HAZARD_EFFICIENCY | % |  |
| SIP | SIP/CF_CREDIT_ZERO | EVENT |  |
| SIP | SIP/GROUP1_BUSY | CYCLE | SIP 运行总 cycle 数 |
| SIP | SIP/L0_ICACHE_REQ0_ISSUE | EVENT |  |
| SIP | SIP/L0_ICACHE_REQ1_ISSUE | EVENT |  |
| SIP | SIP/L0_ICACHE_REQ2_ISSUE | EVENT |  |
| SIP | SIP/L0_ICACHE_REQ3_ISSUE | EVENT |  |
| SIP | SIP/L0_ICACHE_RESP_TAKEN | EVENT |  |
| SIP | SIP/SCALAR0_DATA_HAZARD_ALL_STALL | EVENT |  |
| SIP | SIP/SCALAR1_DATA_HAZARD_ALL_STALL | EVENT |  |
| SIP | SIP/SCALAR_DATA_HAZARD_EFFICIENCY | % |  |
| SIP | SIP/SDMEM_CREDIT_ZERO | EVENT |  |
| SIP | SIP/THD0_BRANCH_FLUSH | EVENT |  |
| SIP | SIP/THD0_THD8_ALL_WAIT_OR_HALT | EVENT |  |
| SIP | SIP/THD0_THD9_ALL_WAIT_OR_HALT | EVENT |  |
| SIP | SIP/THD0_WAIT | EVENT |  |
| SIP | SIP/THD1_BRANCH_FLUSH | EVENT |  |
| SIP | SIP/THD1_WAIT | EVENT |  |
| SIP | SIP/THD2_BRANCH_FLUSH | EVENT |  |
| SIP | SIP/THD2_WAIT | EVENT |  |
| SIP | SIP/THD3_BRANCH_FLUSH | EVENT |  |
| SIP | SIP/THD3_WAIT | EVENT |  |
| SIP | SIP/THD4_BRANCH_FLUSH | EVENT |  |
| SIP | SIP/THD4_WAIT | EVENT |  |
| SIP | SIP/THD5_BRANCH_FLUSH | EVENT |  |
| SIP | SIP/THD5_WAIT | EVENT |  |
| SIP | SIP/THD6_BRANCH_FLUSH | EVENT |  |
| SIP | SIP/THD6_WAIT | EVENT |  |
| SIP | SIP/THD7_BRANCH_FLUSH | EVENT |  |
| SIP | SIP/THD7_WAIT | EVENT |  |
| SIP | SIP/THD8_BRANCH_FLUSH | EVENT |  |
| SIP | SIP/THD8_WAIT | EVENT |  |
| SIP | SIP/THD9_BRANCH_FLUSH | EVENT |  |
| SIP | SIP/THD9_WAIT | EVENT |  |
| SIP | SIP/UISA_1D_DATA_HAZARD_ALL_STALL | EVENT |  |
| SIP | SIP/UISA_2D_DATA_HAZARD_ALL_STALL | EVENT |  |
| SIP | SIP/UISA_MOV_SMR_DATA_HAZARD_ALL_STALL | EVENT |  |
| SIP | SIP/UISA_VLDA_DATA_HAZARD_ALL_STALL | EVENT |  |
| SIP | SIP/UISA_VST_DATA_HAZARD_ALL_STALL | EVENT |  |
| SIP | SIP/VLD_DATA_HAZARD_ALL_STALL | EVENT |  |
| SIP | SIP/VLD_DATA_HAZARD_EFFICIENCY | % |  |
| SIP | SIP/VST_DATA_HAZARD_ALL_STALL | EVENT |  |
| SIP | SIP/VST_DATA_HAZARD_EFFICIENCY | % |  |
| FUSION | FUSION/LLC_READ_BANDWIDTH_WITHOUT_ICACHE | GB/s | LLC 不包括 L1 instruction cache 的读带宽 |
| FUSION | FUSION/LLC_READ_BYTE_WITHOUT_ICACHE | BYTE | LLC 不包括 L1 instruction cache 的读字节 |
| FUSION | FUSION/LLC_READ_THROUGHPUT_WITHOUT_ICACHE | B/s | LLC 不包括 L1 instruction cache 的读吞吐量 |

其中 engine 是 FUSION 的指标是应用多 engine 的融合指标。

### 4.2. Session

tcu 启动应用时，会创建一个新 session 或者加入已有的 session。 start/stop/cancel 通过 `--session`，指定要控制 tcu 进程。当前系统只存在一个 session 时，可以省略 session 选项。 `tcu --session-list` 会列出当前系统所有 session。

### 4.3. 采集控制

首先启动一个 tcu 用于采集，之后在另外的终端再开启 tcu 进行控制；支持 start/stop/cancel。 一个常见的用法是先启动应用不采集，等合适时机手动开启采集，示例：

```
tcu --profile-from-start off --enable-metrics sip/1d_efficiency xxx
```

等合适时机，启动新终端输入

```
tcu --start
```

## 5. 输入输出

### 5.1. Export/Import

选项 export 可以用来生成 “.tcd” 后缀的结果文件，供 TopsCompute 使用；生成的 tcd 结果文件也可以使用 import 选项导入 tcu。 选项 export-rawdata 可以用来导出采集的原始数据；可以使用 import-rawdata 选项将原始数据导入 tcu。

## 6. 分布式

### 6.1. 分布式启动采集

分布式支持通过 mpirun 和 python ddp 启动 tcu，示例如下：

```
mpirun [mpirun-arguments] tcu [options] [application] [application-arguments]
```

```
python -m torch.distributed.launch -no-python [python-arguments] tcu [options] [application] [application-arguments]
```

## 7. Release Note

V 1.0 首次发布

V 1.5 版本发布

- 无。

V 1.6 版本发布

- 增加 export-csv 选项。
- 增加 timeunit 选项。
- 增加 command-file 选项。

V 1.7 版本发布

- 选项 topstx-max-bytes-size 默认值变更为 8192B。
- 新增选项 import/export，弃用选项 import-profile/export-profile/export-visual-profiler。
- 新增 GCU400/410 平台指标 SIP/VSTA_L0_EFFICIENCY 的支持。
- 新增 GCU400/410 平台多种 LLC 指标的支持。
- 新增 GCU400/410 平台指标 FUSION/LLC_READ_COUNT_WITHOUT_ICACHE 的支持。
