> Imported material source: `Doc/EFSMI User Guide.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `EFSMI User Guide`.

# EFSMI User Guide

## 工具简介

**EFSMI** (*Enflame System Management Interface*)是用于管理 GCU 设备的Linux命令行工具。
可以实时查询各种 GCU 设备信息：包含温度、功耗、时钟频率等。
有关EFSMI命令的详细用法，请参考 EFSMI 命令。
EFSMI是基于 **EFML** (*Enflame Management Library*)开发的，EFML是提供给用户的一套访问底层GCU硬件的代码库。
请参阅章节 EFML - Enflame 管理库。

## 参考文献

### 词汇表

| 名称 | 说明 |
| --- | --- |
| EFSMI | **E**n**F**lame **S**ystem **M**anagement **I**nterface **T**ool which is based on EFML library for monitoring GCU device in system |
| EFML | **E**n**F**lame **M**anagement **L**ibrary, a C/C++/Script library providing system management APIs |
| GCU | **G**eneral **C**ompute **U**nit, refer to PCIe based computing Devices delivered by Enflame |
| UUID | **U**niversally **U**nique **Id**entifier |
| TDP | **T**hermal **D**esign **P**ower, the maximum power consumption of the device at the highest temperature |
| ECC | **E**rror **C**orrection **C**ode, a type of error correction code |
| DBE | **D**ouble **B**it **E**rror, a type of uncorrectable ECC memory error |
| MCM | **M**emory **C**onsistency **M**odel |
| RMA | **R**eturn **M**erchandise **A**uthorization, a process for returning a product to the manufacturer for repair or replacement |
| DRS | **D**evice **R**esource **S**lice |
| LARE | **L**ink **A**ll **R**ound **E**ngine |
| QoS | **Q**uality **o**f **S**ervice |
| DSCP | **D**ifferentiated **S**ervices **C**ode **P**oint, a 6-bit field in the IP header for packet classification |
| NIC | **N**etwork **I**nterface **C**ard |
| TLP | **T**ransaction **L**evel **P**acket |
| DLLP | **D**ata **L**ink **L**ayer **P**acket |

## 分发包

### 安装包内容

包含 *efsmi* 在内的所有内容在TopsPlatform安装包中提供。其中有 *efsmi* 和 *efml* RPM/DEB包, 以及python语言的开发库 *pyefml*。
具体内容如下表所示:

| 内容 | 说明 |
| --- | --- |
| efsmi-x.x.x.x86_64.rpm | EFSMI RPM 软件包 |
| efsmi_x.x.x_amd64.deb | EFSMI DEB 软件包 |
| efml_x.x.x.x86_64.rpm | EFML RPM 软件包 |
| efml_x.x.x_amd64.deb | EFML DEB 软件包 |
| pyefml-x.x.x-py3-none-any.whl | EFML Python开发库软件包 |

**Attention:**

各组件安装包现已不再单独提供，如有特殊需求请联系客户支持工程师。

## 安装步骤

请参考TopsPlatform 安装指南进行安装。

## 使用须知

### 在宿主机中运行

**Attention:**

1. efsmi 的部分功能仅支持特权模式下执行，例如reset命令。
2. efsmi 在非特权模式下运行，需要依赖 enflame 提供的设备驱动程序，请确保驱动已经加载。

### 在容器中运行

efsmi 支持在容器中运行, 可以通过以下方式：

#### 赋予容器特权模式

**Attention:**

1. 在宿主机上以特权用户身份启动容器
2. 启动容器时, 使能 --privileged=true 参数以赋予容器内用户特权

#### 不赋予特权模式

**Attention:**

1. 宿主机需要加载 enflame 提供的内核模块设备驱动程序
2. 启动容器时, 使能 --device 选项映射 enflame 设备到容器内

### 在虚拟机中运行

**Attention:**

1. efsmi 不支持在使用mdev虚拟设备的虚拟机中运行

## EFSMI 命令

EFSMI是用于监控 GCU 状态的可执行程序，它基于 EFML 库。
EFSMI当前支持的命令如下表所示。

**Attention:**

EFSMI 不支持在宿主机和docker 里面同时运行。

当前支持的命令列表:

| 参数 | 说明 |
| --- | --- |
| -h, --help | 显示此帮助说明 |
| "" | 不带参数执行 'sudo efsmi' ， efsmi 将显示包含 版本号/驱动/功耗/频率/温度<br>e.g. `'sudo efsmi -i 0'`<br>显示 GCU 卡 0 的信息 |
| -i, --index | 选择指定的 GCU 卡<br>e.g. `'sudo efsmi -i 0'`<br>显示 GCU 卡 0 的信息 |
| -pf, --physical-function | 选择监控物理设备而不是虚拟设备。<br>仅支持 SRIOV 模式。 |
| --env | 显示系统环境详细信息 |
| -L, --list | 显示所有支持的 GCUs |
| -v, --version | 显示 efsmi 版本号 |
| -q, --query | 获取 GCU 状态信息<br>列出 GCUs 状态的详细信息，以 TAB 对齐<br>支持的子命令：<br>a. -d XXX<br>选择要显示的内容<br>XXX 可以设定为以下之一：<br>"POWER", "CLOCK", "DRIVER", "DEVICE", "FIRMWARE", "PCIE" "MEMORY" "TEMP" "VOLT"<br>"USAGE", "CABLE", "ECC", "MCM", "RMA", "VPU", "ERROR"<br>e.g. `'sudo efsmi -q -d CLOCK -i 0'`<br>选择显示GCU0 的频率信息<br>注意:<br>内存信息依赖 enflame 提供的设备驱动程序<br>b. -c X<br>设置循环次数 |
| --ptopo | 显示 设备的PCIE 拓扑信息 |
| -r, --reset | 该指令会复位目标 GCU 设备，在一些场景下可以用来重置 GCU 硬件状态。否则需要重启机器。<br>重置操作并不保证在所有情况下都能正常工作，应谨慎使用。<br>此命令需要依赖 enflame 提供的设备驱动程序<br>支持的子命令：<br>a. -y<br>自动确认提示。默认以“yes”作为所有提示的答案，并以非交互方式运行。<br>注意：<br>复位运行期间，请不要强杀 efsmi 进程，否则可能会导致设备复位失败。 |
| -e, --ecc | 设置设备的ECC 状态<br>ECC 状态变更后需 GCU 复位方可生效（使用'-r hot'命令）<br>用法:<br>--ecc # 查询 ECC 状态<br>--ecc on\|off # 打开/关闭 ECC 模式<br>注意：<br>该命令不支持在虚拟化环境的VF下使用。请确保在切换ECC 状态前，所有的任务都已经退出。 |
| -pl, --power-limit | 设置设备的功耗限制<br>该命令不支持在虚拟化环境下使用，包括 SRIOV 模式，MDEV 模式以及 VGCU 模式<br>用法:<br>--power-limit X # 设置功耗限制为X瓦特，X为0时，设置功耗限制为默认值<br>--power-limit # 查询当前功耗限制以及可设置的功耗限制范围，如不支持该功能，则返回N/A<br>注意:<br>功耗限制值以瓦特为单位。功耗限制值不支持持久化，重启或重新加载驱动后会恢复为默认值。 |
| --mcm | （仅支持 Enflame S60 设备）设置设备的MCM 状态<br>该命令会自动触发设备复位，以使新的MCM 状态生效。<br>用法:<br>--mcm # 查询 MCM 状态<br>--mcm single\|dual # 设置设备MCM 状态为单芯片/双芯片模式<br>注意:<br>在虚拟化环境下不支持切换MCM 状态。请确保在切换MCM 状态前，所有的任务都已经退出。状态切换期间，请不要强杀 efsmi 进程。<br>否则可能会导致状态切换失败。 |
| -lpm, --low-power-mode | 设置/获取低功耗模式或启用/禁用低功耗模式功能。<br>如果低功耗模式功能被禁用，设备将始终保持在 LP0 模式，不能被设置为其他低功耗模式。<br>如果低功耗模式功能被启用，设备将在空闲一段时间后自动进入 LP1/LP2 模式。<br>低功耗模式不能在虚拟化PF上切换。PF 将在所有 VF 都进入 LP1/LP2 模式后进入 LP0 模式，当任意 VF 进入 LP0 模式时，PF 将自动退出 LP1/LP2 模式。<br>用法:<br>--low-power-mode lp0 # 设置低功耗模式为 LP0<br>--low-power-mode lp3 # 设置低功耗模式为 LP3<br>--low-power-mode on # 启用低功耗模式功能<br>--low-power-mode off # 禁用低功耗模式功能<br>注意: LP1 模式在所有设备上都支持，但不是所有设备都支持 LP2 和 LP3 模式。设备必须先进入 LP1/LP2 模式才能进入 LP3 模式 |
| topo | 显示系统的拓扑信息<br>参考表格 topo 子命令列表 获取详细信息。 |
| dmon | 监控 GCU 设备的各种数据，刷新率为 1s。<br>按 **Ctrl + C** 退出监控。<br>参考表格 dmon 子命令列表 获取详细信息。 |
| pmon | 监控使用 GCU 设备的进程的各种数据，刷新率为 1s。<br>按 **Ctrl + C** 退出监控。<br>参考表格 pmon 子命令列表 获取详细信息。 |
| drs | 提供 DRS 管理控制。<br>该命令不支持在虚拟化环境下使用，包括 SRIOV 模式，MDEV 模式以及 VGCU 模式<br>参考表格 drs 子命令列表 获取详细信息。 |
| gculare | 显示 GCU-LARE 端口信息<br>参考表格 gculare 子命令列表 获取详细信息。 |

| 参数 | 说明 |
| --- | --- |
| -h, --help | 显示帮助信息 |
| -i, --index | 选择目标 GCU<br>e.g. `'sudo efsmi dmon -i 0'`<br>选择目标 GCU id 0 |
| -pf, --physical-function | 选择监控物理设备而不是虚拟设备。<br>仅支持 SRIOV 模式。 |
| "" | 当没有其他参数时, 以各选项的默认值运行 |
| -s, --select | 选择要显示的信息组。支持 "p", "c", "m", "t" 和 "all"。<br>e.g. `'sudo efsmi dmon -s pt'`<br>选择显示功耗和温度信息 |
| -c, --count | 指定循环次数<br>e.g. `'sudo efsmi dmon -c 10'`<br>打印10次设备监控信息 |
| -w | 设置刷新时间间隔，默认是 1 秒<br>e.g. `'sudo efsmi dmon -w 2'`<br>设置刷新时间为 2 秒 |
| -o | 选择输出信息时包含时间戳 |

| 参数 | 说明 |
| --- | --- |
| -h, --help | 显示帮助信息 |
| -i, --index | 选择目标 GCU<br>e.g. `'sudo efsmi pmon -i 0'`<br>选择目标 GCU id 0 |
| -pf, --physical-function | 选择监控物理设备而不是虚拟设备。<br>仅支持 SRIOV 模式。 |
| "" | 当没有其他参数时, 以各选项的默认值运行 |
| -c, --count | 指定循环次数<br>e.g. `'sudo efsmi pmon -c 10'`<br>打印10次设备监控信息 |
| -w | 设置刷新时间间隔，默认是 1 秒<br>e.g. `'sudo efsmi pmon -w 2'`<br>设置刷新时间为 2 秒 |
| -o | 选择输出信息时包含时间戳 |

| 参数 | 说明 |
| --- | --- |
| -h, --help | 显示帮助信息 |
| -pf, --physical-function | 选择显示物理设备而不是虚拟设备。<br>仅支持 SRIOV 模式。 |
| "" | 当没有其他参数时，等同于 '-m' 选项 |
| -m, --matrix | 以矩阵形式显示系统的拓扑信息 |

| 参数 | 说明 |
| --- | --- |
| -h, --help | 显示帮助信息 |
| -i, --index | 选择目标 GCU<br>e.g. `'sudo efsmi drs -i 0'`<br>选择目标 GCU id 0 |
| "" | 当没有其他参数时，显示 DRS 模式状态 |
| -lp, --list-profile | 列出支持的 DRS 配置 |
| -ci, --create-instance | 使用指定的配置 id 创建 DRS 实例<br>e.g. `'sudo efsmi drs -ci 0'`<br>使用配置 id 0 创建 DRS 实例 |
| -di, --destroy-instance | 销毁指定的 DRS 实例<br>e.g. `'sudo efsmi drs -di 0'`<br>销毁 DRS 实例 id 0 |
| -li, --list-instance | 列出所有的 DRS 实例<br>e.g. `'sudo efsmi drs -li'`<br>列出所有的 DRS 实例 |

| 参数 | 说明 |
| --- | --- |
| -h, --help | 显示帮助信息 |
| -i, --index | 选择目标 GCU<br>e.g. `'sudo efsmi gculare -i 0'`<br>选择目标 GCU id 0 |
| -p, --port | 选择目标 GCU-LARE 端口<br>e.g. `'sudo efsmi gculare -i 0 -p 0'`<br>选择目标 GCU-LARE 端口 0 |
| --queue | 选择目标 GCU-LARE 队列<br>e.g. `'sudo efsmi gculare --details -i 0 -p 0 --queue 0'`<br>选择目标 GCU-LARE 队列 0 |
| "" | 当没有其他参数时，显示所有 GCU-LARE 端口信息 |
| --details | 显示 GCU-LARE 端口详细队列信息<br>e.g. `'sudo efsmi gculare --details -i 0 -p 0'`<br>显示 GCU-LARE 端口 0 的详细队列信息 |
| -sqd, --set-qos-dscp | 设置 GCU-LARE 端口 QOS DSCP，支持 0 ~ 63。必须与 --set-qos-priority 一起使用<br>e.g. `'sudo efsmi gculare -sqd 40 -sqp 5 -i 0 -p 0'`<br>设置 GCU-LARE 端口 0 的 QOS DSCP 为 40 和 QOS 优先级为 5 |
| -sqp, --set-qos-priority | 设置 GCU-LARE 端口 QOS 优先级，支持 0 ~ 7。必须与 --set-qos-dscp 一起使用<br>e.g. `'sudo efsmi gculare -sqp 5 -sqd 40 -i 0 -p 0'`<br>设置 GCU-LARE 端口 0 的 QOS 优先级为 5 和 QOS DSCP 为 40 |
| -sbxn, --set-buffer-xon | 设置 GCU-LARE 端口暂停缓冲区 XON，支持 0 ~ 1023。必须与 --set-buffer-xoff 一起使用<br>e.g. `'sudo efsmi gculare -sbxn 500 -sbxf 1000 -i 0 -p 0'`<br>设置 GCU-LARE 端口 0 的暂停缓冲区 XON 为 500 和暂停缓冲区 XOFF 为 1000 |
| -sbxf, --set-buffer-xoff | 设置 GCU-LARE 端口暂停缓冲区 XOFF，支持 0 ~ 1023。必须与 --set-buffer-xon 一起使用<br>e.g. `'sudo efsmi gculare -sbxf 1000 -sbxn 500 -i 0 -p 0'`<br>设置 GCU-LARE 端口 0 的暂停缓冲区 XOFF 为 1000 和暂停缓冲区 XON 为 500 |
| --isolate | 隔离 GCU-LARE 端口<br>e.g. `'sudo efsmi gculare --isolate -i 0 -p 0'`<br>隔离 GCU-LARE 端口 0 |
| --connect | 连接 GCU-LARE 端口<br>e.g. `'sudo efsmi gculare --connect -i 0 -p 0'`<br>连接 GCU-LARE 端口 0 |

**Attention:**

GCU-LARE 1 和 ECC 在部分产品上不支持。

### 信息概览

不带参数执行 `'sudo efsmi'`， 将显示如下的看板信息:

```
$ sudo efsmi
-------------------------------------------------------------------------------
--------------------- Enflame System Management Interface ---------------------
--------- Enflame Tech, All Rights Reserved. 2024-2025 Copyright (C) ----------
-------------------------------------------------------------------------------

+2025-11-25, 17:49:52 CST-----------------------------------------------------+
| EFSMI:    1.7.0           Driver Ver: 1.7.0                                 |
+-----------------------------+-------------------+---------------------------+
| DEV    NAME                 | Boot FW VER       | BUS-ID      ECC           |
| TEMP   Lpm   Pwr(Usage/Cap) | Mem      GCU Virt | DUsed       SN            |
|=============================================================================|
| 0      Enflame S60          | 33.6.5            | 00:23:00.0  Disable       |
| 38℃    LP1      94W / 300W  | 49120MiB  Disable | 0%          A807J405I.... |
+-----------------------------+-------------------+---------------------------+

$ sudo efsmi # 存在 DRS GCU 实例时
-------------------------------------------------------------------------------
--------------------- Enflame System Management Interface ---------------------
--------- Enflame Tech, All Rights Reserved. 2024-2025 Copyright (C) ----------
-------------------------------------------------------------------------------

+2025-11-25, 17:49:52 CST-----------------------------------------------------+
| EFSMI:   1.7.0           Driver Ver: 1.7.0                                  |
+-----------------------------+-------------------+---------------------------+
| DEV    NAME                 | Boot FW VER       | BUS-ID      ECC           |
| TEMP   Lpm   Pwr(Usage/Cap) | Mem      GCU Virt | DUsed       SN            |
|=============================================================================|
| 0      Enflame S60          | 33.6.5            | 00:23:00.0  Enable        |
| 39℃    LP1      95W / 300W  | 42976MiB  DRS     | 0%          A807J405I.... |
+-----------------------------+-------------------+---------------------------+

+-----------------------------------------------------------------------------+
| GCU instances:                                                              |
|----------------------------------+----------------------------+-------------|
| GCU        Name           ID     | Mem (Usage/Total)          | SIP         |
+----------------------------------+----------------------------+-------------+
|  0         1g.6gb         1      |     0MiB /  6974MiB        | 4           |
+----------------------------------+----------------------------+-------------+
|  0         1g.6gb         2      |     0MiB /  6974MiB        | 4           |
+----------------------------------+----------------------------+-------------+
|  0         1g.6gb         3      |     0MiB /  6974MiB        | 4           |
+----------------------------------+----------------------------+-------------+
```

| 字段 | 字段内容 |
| --- | --- |
| EFSMI: | EFSMI 版本号 |
| Driver Ver: | Driver 版本号 |
| DEV: | GCU 设备的ID号，根据设备BDF升序排序 |
| NAME: | GCU 设备型号 |
| Boot FW VER: | SSM Boot 固件版本 |
| BUS-ID: | PCIe 设备 Domain/Bus/Device/Function ID |
| ECC: | Memory ECC 开/关 状态 |
| TEMP: | GCU 设备当前温度 |
| Lpm: | 低功耗模式等级, 详情参考下面表格 |
| Pwr (Usage/Cap): | 当前功耗/额定功耗 |
| Mem: | GCU 设备内存大小 |
| GCU Virt: | GCU虚拟化状态 |
| DUsed: | 设备瞬时使用率 |
| SN: | 设备序列号 |
| GCU Instance: | DRS GCU 实例信息 |

| 低功耗模式等级 | 详情 |
| --- | --- |
| LP0 | 正常模式，GCU满功耗运行。 一旦有任务运行，GCU将切换至LP0 |
| LP1 | 低功耗模式等级1。在闲置若干秒后，GCU将从LP0切换为LP1 |
| LP2 | 低功耗模式等级2。在闲置若干秒后，GCU将从LP1切换为LP2 |
| LP3 | 低功耗模式等级3。手动设置进入。 |

**Attention:**

默认条件下将展示所有设备的信息。
参数 “-i X” 可以用来获取指定的设备信息。

### 信息查询

下图显示了执行命令 `'sudo efsmi -q'` 时得到的查询信息。
部分内容定义与EFSMI 看板中定义的相同。另有更多信息展示：
例如PCIe Tx/Rx 实时吞吐量信息、GCU/Mem信息。
默认情况下， "-q" 命令将查询并显示所有检测到的 GCU 设备，
参数 "-i X" 可用于选择特定的 GCU 。
支持的子命令请参见本章
EFSMI 命令 。

```
$ sudo efsmi -q
------------------------------------------------------------------------------
-------------------- Enflame System Management Interface ---------------------
--------- Enflame Tech, All Rights Reserved. 2024-2025 Copyright (C) ---------
------------------------------------------------------------------------------

DEV ID 0
Driver Info
Ver                      : 1.7.0
Device Info
Dev Name                 : Enflame S60
Dev UUID                 : T6R23101....
Dev SN                   : A029C3051....
Dev PN                   : EFB-0000000-00
Dev MFD                  : 2023-9-12
Health                   : True
Firmware Info
AP Firmware Version      : 1.2.0
SP Firmware Version      : 3.2.8
SSM RT Firmware Version  : 33.6.5.33
VPU Firmware Version     : 3.1.6
PCIe Info
Vendor ID                : 1e36
Device ID                : c033
Domain                   : 0000
Bus                      : 07
Dev                      : 00
Func                     : 0
Receiver Error           : 0
Bad TLP                  : 0
Bad DLLP                 : 0
Link Info
Max Link Speed       : Gen5
Max Link Width       : X16
Cur Link Speed       : Gen4
Cur Link Width       : X16
Tx Throughput        : 0 MiB/s
Rx Throughput        : 0 MiB/s
Clock Info
Mem CLK                  : 7000 MHz
GCU Power Readings
Power Usage              : 94 W
Current Power Limit      : 300 W
Requested Power Limit    : 300 W
Default Power Limit      : 300 W
Min Power Limit          : N/A
Max Power Limit          : N/A
Low Power Mode
Low Power Mode           : LP0
Device Mem Info
Total Size               : 49120 MiB
Reserved Size            : 1129 MiB
Used Size                : 0 MiB
Free Size                : 47990 MiB
BAR1 Mem Info
Total Size               : 16 MiB
BAR2 Mem Info
Total Size               : 64 GiB
Temperature Info
GCU Temp                 : 39 C
Memory Temp              : N/A
Board Temp               : 37 C
Voltage Info
VDD GCU                  : 0.896 V
VDD SOC                  : 0.846 V
VDD MEMQC                : 1.347 V
Device Usage Info
GCU Usage                : 0.0 %
ECC Mode
Current                  : Disable
Pending                  : Disable
MCM Info
MCM mode                 : Dual
RMA Info
Flags                    : False
Total DBE                : 0
MC0 DBE              : 0
MC1 DBE              : 0
MC2 DBE              : 0
MC3 DBE              : 0
MC4 DBE              : 0
MC5 DBE              : 0
MC6 DBE              : 0
MC7 DBE              : 0
MC8 DBE              : 0
MC9 DBE              : 0
MC10 DBE             : 0
MC11 DBE             : 0
Power Cable
Status                   : Normal
VPU Info
Encoder Usage            : 0 %
Decoder Usage            : 0 %
Error Records
Total Error Count        : 0
Reset Count              : 0
Last Reset Date          : N/A
Error Details
User Triggered Reset     : 0
Internal Error           : 0
SIP Error                : 0
Bus Error                : 0
FW Error                 : 0
DTE Error                : 0
DRAM HBM Error           : 0
PCIE Error               : 0
Unknown Error            : 0
```

**Attention:**

efsmi 中的 RMA Info 仅为参考值，不作为最终判断依据，其只受GCU设备内存错误数量影响。当 RMA flag为 False 时，并不表示整个设备处在健康状态。

对于 S60，当下列条件中的任意一条满足时，RMA flag 会被置为 True：

1. 当前设备单个内存控制器上的不可自动纠正错误数量超过8个
2. 当前设备总的不可自动纠正错误数量超过64个
3. 发生了一次页表替换故障

当开启SRIOV虚拟化时，只有PF上会显示RMA信息，VF上不会显示。

### 设备监控

下面的图片显示了执行 `'sudo efsmi dmon'` 时得到的设备监视器信息，它将显示功耗，GCU/Mem温度，频率等的实时抓取的板卡信息
详细的子命令请参见本章中的表格
EFSMI 命令。

收集的数据将显示在一行，每秒刷新一次。循环数和刷新周期可以通过子命令 "-c
X" 和 "-w X" 调整。 ` Ctrl + C ` 可退出显示 。

```
$ sudo efsmi dmon
------------------------------------------------------------------------------
-------------------- Enflame System Management Interface ---------------------
--------- Enflame Tech, All Rights Reserved. 2024-2025 Copyright (C) ---------
------------------------------------------------------------------------------

*Dev Pwr   DTemp  Sip   DUsed Lpm      MUsed Mem    Mclk   TxPci   RxPci
*Idx W     C      %     %     Level    %     Mib    MHz    MiB/s   MiB/s
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    38     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    38     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    38     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    38     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    38     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    38     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    38     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    38     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    38     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
0    90    39     0.0   0.0   LP0      2.4   42976  7000   0       0
```

| 字段 | 字段内容 |
| --- | --- |
| Dev: | GCU卡序号 |
| Pwr: | 板卡功耗(瓦) |
| DTemp: | 板卡温度 |
| Sip: | 一个采样周期内，SIP的平均利用率 |
| DUsed: | 一个采样周期内，设备工作时间占比 |
| Lpm: | 低功耗模式等级 |
| MUsed: | GCU 内存使用率 |
| Mem: | GCU 内存的大小 |
| Mclk: | 内存频率 |
| TxPci/RxPci: | PCIe 传输/接受 吞吐量 |

**Attention:**

GCU 卡序号：按PCI 总线上Enflame GCU 设备bdf信息排列。

### 功耗限制

用户可通过 power-limit 命令查询和设置功耗限制。

```
$ sudo efsmi --power-limit
------------------------------------------------------------------------------
-------------------- Enflame System Management Interface ---------------------
--------- Enflame Tech, All Rights Reserved. 2024-2025 Copyright (C) ---------
------------------------------------------------------------------------------

+-----+----------------+------------------+----------------+------------------+
| DEV | Current PwrLmt | Requested PwrLmt | Default PwrLmt | PwrLmt Range     |
+-----+----------------+------------------+----------------+------------------+
| 0   | 300W           | 300W             | 300W           | N/A              |
+-----+----------------+------------------+----------------+------------------+
```

默认功耗限制是设备出厂时设置的功耗限制。用户可以通过 `'sudo efsmi --power-limit X'` 命令设置功耗限制，
其中X是请求的功耗限制。一些情况下，由于硬件限制，GCU可能无法达到请求的功耗限制。实际功耗限制是当前功耗限制。
不过大多数情况下，当前功耗限制与请求的功耗限制相同。

如果设备不支持功耗限制，功耗限制范围将为N/A。功耗限制值以瓦特为单位。功耗限制值不支持持久化，重启或重新加载驱动后会恢复为默认值。

### PCIE 拓扑

在PCIe的树形结构里， 每个GCU设备都是一个EP(endpoint)，它会跟PCIe Switch 的下游端口相连。
PCIe Switch的上游端口会继续跟别的Switch或者CPU的RC(Root Complex)/Host Bridge的下游端口相连。
这样构建出一个树形的topo结构。

'sudo efsmi --ptopo' 命令可以展示这种结构的详细信息

```
$ sudo efsmi --ptopo
------------------------------------------------------------------------------
-------------------- Enflame System Management Interface ---------------------
--------- Enflame Tech, All Rights Reserved. 2024-2025 Copyright (C) ---------
------------------------------------------------------------------------------

gcu 0-0000:20:00.0 --> ... --> bridge-pci0000:16 --> cpu
gcu 1-0000:35:00.0 --> ... --> bridge-pci0000:30 --> cpu
gcu 2-0000:36:00.0 --> ... --> bridge-pci0000:30 --> cpu
gcu 3-0000:39:00.0 --> ... --> bridge-pci0000:30 --> cpu
gcu 4-0000:3d:00.0 --> ... --> bridge-pci0000:30 --> cpu
gcu 5-0000:9c:00.0 --> ... --> bridge-pci0000:97 --> cpu
gcu 6-0000:9d:00.0 --> ... --> bridge-pci0000:97 --> cpu
gcu 7-0000:a0:00.0 --> ... --> bridge-pci0000:97 --> cpu
gcu 8-0000:a4:00.0 --> ... --> bridge-pci0000:97 --> cpu
gcu 9-0000:bd:00.0 --> ... --> bridge-pci0000:b0 --> cpu
```

### ECC 状态

各个 GCU 的ECC状态可能不同，以'-q' 命令获取当前模式，
可以通过 `'sudo efsmi --ecc on|off -i 0'` 设置设备0的ECC状态，'off'是禁用，'on'是启用； 设置后需按照提示复位设备方可生效。
该命令不支持在虚拟化环境中的VF上使用。

### DRS 模式

DRS 模式允许用户将 GCU 设备划分为多个实例，用户可以根据需要创建、销毁实例。每个实例都可以独立运行不同的任务。
可以通过 `'sudo efsmi drs -i 0 on/off'` 命令来开启或关闭 DRS 模式。

要创建 DRS 实例，首先需要查看当前支持的配置。使用 `'sudo efsmi drs -i 0 --list-profile'` 命令列出所有可用的配置。

```
$ sudo efsmi drs -i 0 --list-profile
-------------------------------------------------------------------------------
--------------------- Enflame System Management Interface ---------------------
--------- Enflame Tech, All Rights Reserved. 2024-2025 Copyright (C) ----------
-------------------------------------------------------------------------------

+-----------------------------------------------------------------------------+
| GCU instance profiles:                                                      |
+-----------------------------------------------------------------------------+
| DEV      Name          ID       Instance Count       Memory (MiB)       Sip |
+-----------------------------------------------------------------------------+
| 0        1g.6gb        0        6                    6974               4   |
+-----------------------------------------------------------------------------+
| 0        3g.20gb       1        2                    20923              12  |
+-----------------------------------------------------------------------------+
| 0        6g.40gb       2        1                    41846              24  |
+-----------------------------------------------------------------------------+
```

之后，可以使用 `'sudo efsmi drs -i 0 --create-instance 0'` 命令创建一个实例。
在这个例子中，配置 ID 为0的实例将被创建。创建成功后，您将看到类似于以下的输出：

```
$ sudo efsmi drs -i 0 --create-instance 0
-------------------------------------------------------------------------------
--------------------- Enflame System Management Interface ---------------------
--------- Enflame Tech, All Rights Reserved. 2024-2025 Copyright (C) ----------
-------------------------------------------------------------------------------

GCU-0 : Created GCU instance with profile id 0 successfully
```

对于已经创建的实例，可以使用 `'sudo efsmi drs -i 0 --list-instance'` 命令列出所有实例的信息。

```
$ sudo efsmi drs -i 0 --list-instance
-------------------------------------------------------------------------------
--------------------- Enflame System Management Interface ---------------------
--------- Enflame Tech, All Rights Reserved. 2024-2025 Copyright (C) ----------
-------------------------------------------------------------------------------

+-----------------------------------------------------------------------------+
| GCU instances:                                                              |
+-----------------------------------------------------------------------------+
| DEV    Profile Name    Profile ID    Instance ID     Placement (Start:Size) |
+-----------------------------------------------------------------------------+
| 0      1g.6gb          0             1               0:1                    |
+-----------------------------------------------------------------------------+
| 0      1g.6gb          0             2               1:1                    |
+-----------------------------------------------------------------------------+
| 0      1g.6gb          0             3               2:1                    |
+-----------------------------------------------------------------------------+
| 0      1g.6gb          0             4               3:1                    |
+-----------------------------------------------------------------------------+
```

如果不再需要某一个实例，可以使用 `'sudo efsmi drs -i 0 --destroy-instance 1'` 命令销毁指定实例。

```
$ sudo efsmi drs -i 0 --destroy-instance 1
-------------------------------------------------------------------------------
--------------------- Enflame System Management Interface ---------------------
--------- Enflame Tech, All Rights Reserved. 2024-2025 Copyright (C) ----------
-------------------------------------------------------------------------------

GCU-0 : Destroyed GCU instance with id 1 successfully
```

更详细的 DRS GCU 实例的使用方式，请参考TopsRuntime的使用手册

**Attention:**

DRS 模式不支持在虚拟化环境下使用，包括 SRIOV 模式，MDEV 模式以及 VGCU 模式。在关闭 DRS 模式前，请确保已删除所有的 DRS 实例。

### GCU-LARE

执行 `'sudo efsmi gculare'` 命令时，会显示所有检测到的 GCU 和它们的 GCU-LARE 端口信息。
参数 `-i X` 和 `--port X` 可以用于查询和显示特定 GCU 和它的 GCU-LARE 端口信息。

加载内核模块后，可能需要几分钟才能建立连接。如果连接未建立，请稍等片刻再尝试执行此命令。

```
$ sudo efsmi gculare
-------------------------------------------------------------------------------
--------------------- Enflame System Management Interface ---------------------
--------- Enflame Tech, All Rights Reserved. 2024-2025 Copyright (C) ----------
-------------------------------------------------------------------------------

DEV ID 0
PORT ID 0
Valid                   : False
PORT ID 1
Valid                   : True
State                   : Link Up
Max Throughput          : 200 Gbps
MAC Address             : 70:17:d7:00:00:00
IP Address              : 10.0.0.2/24
Gateway                 : 10.0.0.1
Remote UUID             : T6V52709....
NIC Name                : mod1eth0
Queues                  : 1-15
DSCP                    : 40
Priority                : 5
XON Threshold           : 500
XOFF Threshold          : 1000
```

**Attention:**

此命令在 Enflame S60 设备上不可用。
每个端口最多支持 4 个 MAC 地址、4 个 IP 地址和 255 个队列。如果为 NIC 分配超过 4 个 IP 地址，IP 地址字段可能无法正确显示。

如果端口连接到交换机，Remote UUID 将不会显示。

不建议手动设置 QoS 和暂停缓冲区 XON/XOFF 阈值。GCU复位或设备重启后，将恢复为默认值。请谨慎使用这些设置。

有关 GCU-LARE 的详细使用信息，请参阅 ECCL 用户手册。

### 拓扑

以矩阵的形式显示系统的拓扑信息，包括GCU与GCU之间的互联信息

具体支持的互联信息如下所示

```
$ sudo efsmi topo -m
-------------------------------------------------------------------------------
--------------------- Enflame System Management Interface ---------------------
--------- Enflame Tech, All Rights Reserved. 2024-2025 Copyright (C) ----------
-------------------------------------------------------------------------------

GCU0    GCU1    GCU2    GCU3    GCU4     CPU Affinity    NUMA Affinity
GCU0      X     PXB     NODE    NODE    SYS      0-17,36-53      0
GCU1    PXB       X     NODE    NODE    SYS      0-17,36-53      0
GCU2    NODE    NODE      X     PXB     SYS      0-17,36-53      0
GCU3    NODE    NODE    PXB       X     SYS      0-17,36-53      0
GCU4    SYS     SYS     SYS     SYS       X      18-35,54-71     1

Legend:

X     = Self
SYS   = Connection traversing PCIe as well as the SMP interconnect between NUMA
nodes (e.g., QPI/UPI)
NODE  = Connection traversing PCIe as well as the interconnect between PCIe Host
Bridges within a NUMA node
PHB   = Connection traversing PCIe as well as a PCIe Host Bridge (typically the
CPU)
PXB   = Connection traversing multiple PCIe bridges (without traversing the PCIe
Host Bridge)
PIX   = Connection traversing at most a single PCIe bridge
LARE# = Connection traversing a bonded set of # GCU Link All Round Engine
IDB   = Connection traversing internal DIE bus
```

## EFML - Enflame 管理库

EFML是一套基于C/C++语言开发的程序库，使用这套程序库，应用软件可以很方便的实现对Enflame 硬件设备的访问。
EFML公开提供的API可以被C/C++/Python/Go... 等语言开发的程序使用。

**EFSMI** 就是利用 EFML 实现硬件监控和管理的应用之一 。
**EFML** 是与 **EFSMI** 包一起发布的，包括它的头文件、库文件、脚本，还有一些示例代码 。

### EFML包含的文件

下表是 EFML 库包含的文件列表

| 名称: | 说明 |
| --- | --- |
| efml.h | 提供API 支持的C头文件 |
| efml_legacy.h | 提供API 支持的C头文件（旧版本） |
| libefml_static.a | 静态链接库 |
| libefml.so | 动态链接库 |
| pyefml.py | python binding APIs |
| pyefml/samples | python 示例 |

### C/C++ 示例

下面的例子展示了如何使用EFML库开发C/C++程序获取系统中GCU设备个数。

```
#include <iostream>
#include <string>
#include <string.h>
#include <stdint.h>
#include "efml.h"

int main(void)
{
   int ret = 0;

   // init library
   ret += static_cast<int>(EfmlInit(false));

   // device info structure
   efmlDeviceInfo_t dev_info;

   // call 'EfmlGetDevCount' to get total device counts in system
   uint32_t dev_cnt = 0;
   ret += static_cast<int>(EfmlGetDevCount(&dev_cnt));
   std::cout << "device count = " << dev_cnt << std::endl;

   // loop through each device get and print device VID/DID and Bus/Dev/Func info
   for (uint32_t i = 0; i < dev_cnt; i++)
   {
      memset(&dev_info, 0, sizeof(efmlDeviceInfo_t));
      ret += static_cast<int>(EfmlGetDevInfo(i, &dev_info));
      std::cout << "dev id = " << i << std::endl;
      std::cout << "name = " << dev_info.name << std::endl;
      std::cout << "vendor id = " << std::hex << dev_info.vendor_id << std::endl;
      std::cout << "device id = " << std::hex << dev_info.vendor_id << std::endl;
      std::cout << "domain = " << std::hex << dev_info.domain_id << std::endl;
      std::cout << "bus = " << std::hex << dev_info.bus_id << std::endl;
      std::cout << "dev = " << std::hex << dev_info.dev_id << std::endl;
      std::cout << "func = " << std::hex << dev_info.func_id << std::endl;
   }

   // check if error returned in above steps
   if (ret != static_cast<int>(EFML_SUCCESS))
      std::cout <<  "execute failed! check log"  << std::endl;

   // shutdown library
   EfmlShutdown();

   return ret;
}
```

上述代码是C++ 代码， 编译上述代码， 请注意以下事项：

**Attention:**

a.包含头文件efml .h

b.首先调用API 'EfmlInit()'来初始化库

c.在所有进程结束时，调用API 'EfmlShutdown()'来释放库使用的资源

d.编译时使用'-L DIR_TO_EFML_LIB'来指定库文件存在的目录

e.编译时使用'-lefml'链接库文件，当使用静态链接库进行链接时，需要使用'-lpthread'

### Script Bindings

#### Python

在人工智能行业中，Python 是开发应用程序的主要语言之一 。 **EFML** 还提供了python语言开发库。通过驱动安装包安装。目前最低支持python3.6。

安装完成后，pyefml.py已经作为python模块安装到系统操作系统中，您可以导入该模块。

如果您想快速体验python中的pyefml，请尝试以下命令。

```
python
import pyefml
pyefml.efmlInit()
0
pyefml.efmlGetDevCount()
1L
pyefml.efmlShutdown()
```

第一条返回值 '0' 表示 EFML 初始化正常。

第二条返回值 '1L' 表示系统中检测到一张 GCU 卡。

下面的例子展示如何使用EFML python库的example.py脚本获取设备信息。 安装完成后命令行执行 'python ./example.py'即可。

```
# -*- coding: utf-8 -*-
import sys
from ctypes import *
import pyefml

# init and enumerate device
pyefml.efmlInit()

# get device counts
dev_cnt = pyefml.efmlGetDevCount()
print('total device count = {}'.format(dev_cnt))

for idx in range(dev_cnt):
   dev_info = pyefml.efmlGetDevInfo(idx)
   print('device idx: {}'.format(idx))
   print('name = {}'.format(dev_info.name))
   print('vendor_id = {:04x}'.format(dev_info.vendor_id))
   print('device_id = {:04x}'.format(dev_info.device_id))
   print('domain_id = {:04x}'.format(dev_info.domain_id))
   print('bus_id = {:02x}'.format(dev_info.bus_id))
   print('dev_id = {:x}'.format(dev_info.dev_id))
   print("func_id = {:x}".format(dev_info.func_id))

# shutdown
pyefml.efmlShutdown()
```

与 C++ 的示例一样，pyefml.efmlInit()/pyefml.efmlShutdown() 需在初始化/退出的时候加载。
示例中的代码会打印出系统中所有 GCU 设备的 厂商识别码/设备识别码 Bus/Dev/Func 信息。

#### Go

Go 是一款开源编程软件，它使得代码实现更加简单，可靠和高效，也因此越来越受欢迎。
我们也提供了支持Go语言的efml 库，默认会安装在 /usr/share/gocode/src/go-efml 路径。目前最低支持Go 1.13。

**Attention:**

请参阅 Golang 的官方文档去搭建 Go 开发环境。

下面有一个简单的示例 "main.go" ，示例可以打印出基本的设备信息。

```
package main

import (
      "go-efml"
      "fmt"
)

func main() {
      efml.Init()
      cnt, _ := efml.GetDevCount()
      for dev_idx := uint(0); dev_idx < cnt; dev_idx++ {
               handle := efml.Handle{0}
               devInfo, _ := handle.GetDevInfo()

               fmt.Println("device idx:", dev_idx)
               fmt.Println("name = ", devInfo.Name)
               fmt.Printf("vendor_id = %4x\n", devInfo.Vendor_Id)
               fmt.Printf("device_id = %4x\n", devInfo.Device_Id)
               fmt.Printf("domain_id = %4x\n", devInfo.Domain_Id)
               fmt.Printf("bus_id    = %2x\n", devInfo.Bus_Id)
               fmt.Printf("dev_id    = %2x\n", devInfo.Dev_Id)
               fmt.Printf("func_id   = %2x\n", devInfo.Func_Id)
      }

      efml.Shutdown()
}
```

对于Ubuntu和其它Debian系统，上述代码可以直接编译运行。
对于其它系统，你需要正确的生成和放置库文件的源代码。
Golang 的源代码放置于名为“src"的文件夹， go-efml 库文件放在下面的子目录。 在 go-efml 目录，你可以找到如下文件：

| 名称: | 说明 |
| --- | --- |
| dl.go | go binding 库文件 |
| efml.go | go binding 文件 |

源文件的代码结构应类似于：

```
dev_info
|-- src
    |-- go-efml
        |-- dl.go
        |-- efml.go
    |-- main.go
```

重定向 "$GOPATH" to "dev_info" 链接， 你可以执行如下命令:

`'export GOPATH="/PATH/TO/dev_info"'`

返回到 "dev_info" 目录，执行 "go build"， 代码将被编译成 "dev_info" 可执行文件。

在目标机器执行生成的 "dev_info" 程序，将会输出目标设备的基本信息。

如果开启了go module，请使用“go mod init”命令初始化module，并重定向go-efml依赖到本地文件夹，然后使用“go build”编译。

**1**: GCU-LARE TM 是为支持加速卡之间互联的燧原智能互联技术。
