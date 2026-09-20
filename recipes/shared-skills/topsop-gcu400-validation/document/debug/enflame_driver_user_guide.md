> Imported material source: `Doc/Enflame Driver User Guide.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `Enflame Driver User Guide`.

# Enflame Driver User Guide

## 2. 简介

KMD是燧原硬件产品的Linux内核态驱动。本文档主要介绍KMD的安装和使用方法。

## 3. 前提

燧原KMD只支持64位系统，且必须在BIOS中打开如下设置（不同BIOS的描述可能有所不同）。

```
Enable 4G decoding in BIOS
```

## 4. KMD安装

驱动安装包有以下几个。

- **enflame-xxx.run**: GCU的基础驱动模块，需要首先安装，其它模块都依赖它。安装时会在目标机上即时编译生成enflame.ko、安装efsmi/ef-debugdump等基础工具。
- **enflame_peer_mem-xxx.run**: 分布式上基于RDMA网卡的加速模块，依赖ib_core等第三方驱动模块。
- **enflame_virt-xxx.run**: GCU的虚拟化模块，GCU虚拟化场景下才需要。

驱动包的安装参数：

sudo ./enflame-xxx.run [--no-auto-load] [--mdev-host | --with-vgcu] [--with-dkms | --no-dkms]

- --no-auto-load ：开机不自动加载kmd。默认开机自动加载。
- --mdev-host | --with-vgcu ：以mdev_host(VM monitor)或vgcu模式。默认为asic模式。（在S60上不支持）
- --virt-host [--vf-num N] ：以SRIOV模式加载kmd。N用于指定VF的个数（1/2/4)，默认为2。（只在S60上支持）
- --with-dkms | --no-dkms ：是否使用dkms加载。默认为不使用。

**Attention:**

run包仅支持asic平台，不支持仿真平台。

参考 修改KMD的模块参数，使用不同的模块参数来设置vgcu数量。

```
#空分切换为时分的命令如下，然后再安装run包。
echo 'options enflame "vgcu_num=4"' > /etc/modprobe.d/gcu_test.conf

#时分切换为空分的命令如下，然后再安装run包。
echo 'options enflame "vgcu_num=2"' > /etc/modprobe.d/gcu_test.conf
```

## 5. KMD模块签名

部分机器上Linux内核中使能了驱动模块签名，即SSL signature功能，编译出的ko不能直接加载，必须由用户签名后才能安装。

run包的--mode是隐藏参数，将编译和安装分开，中间由用户自己做模块签名。

1. sudo ./enflame*.run --mode build

2. 对生成的*.ko做签名，再拷回到同目录下

3. sudo ./enflame*.run --mode install

## 6. 修改KMD的模块参数

在安装使用KMD时，可能需要临时修改一些模块参数，比如reset_enable等，可按以下步骤操作。

```
#常规安装run包，非必须
sudo ./enflame.*.run --xxx

#卸载已安装的模块
sudo rmmod enflame_peer_mem

#卸载主模块
sudo rmmod enflame

#拷贝一份临时配置文件，如源文件不存，可忽略
cp -f /etc/modprobe.d/gcu.conf  ./gcu_test.conf

#关闭reset功能
echo 'options enflame "reset_enable=0"'     >> gcu_test.conf

#关闭ssm rfw功能
echo 'options enflame "enable_ssm_rt_fw=0"' >> gcu_test.conf

#关闭sip timeout功能
echo 'options enflame "enable_sip_timeout_interval_ms=0"' >> gcu_test.conf

#关闭ssm rfw功能和reset功能
echo 'options enflame "enable_ssm_rt_fw=0,reset_enable=0"' >> gcu_test.conf

#以指定配置文件的方式重新加载驱动
sudo modprobe enflame -C ./gcu_test.conf

#确认驱动加载成功
lsmod | grep enflame

#验证模块参数是否生效
cat /sys/module/enflame/parameters/reset_enable

#验证是否修改成功
cat /sys/module/enflame/parameters/enable_sip_timeout_interval_ms
```

以上是一次性修改，如果需要长期生效，可直接修改/etc/modprobe.d/gcu.conf。

## 7. 卸载kmd

- 临时卸载

```
lsmod | grep enflame ; sudo rmmod enflame
```

- 永久卸载

```
sudo ./enflame-xxx.run --uninstall
```

## 8. 整卡透传虚拟化

GCU设备的虚拟化整卡透传，只支持Qemu 2.6.0和Qemu 5.0.0这两个版本的Qemu虚拟机，其它版本的虚拟机整卡透传暂时没有验证过

Qemu的I440FX主板，以及Qemu-2.6.0的Q35主板，只支持FLR透传，不支持Hot Reset透传

### 8.1. GCU Qemu quirk patch功能介绍

- 对透传GCU设备提供可配置的Security寄存器访问控制

### 8.2. GCU Qemu quirk patch源文件

```
caps/qemu/qemu-2.6.0-quirks.patch      # Qemu-2.6.0的quirk patch源文件
caps/qemu/qemu-5.0.0-quirks.patch      # Qemu-5.0.0的quirk patch源文件
caps/qemu/qemu-build-sample.sh         # 编译和安装Qemu源码的参考Script脚本
caps/qemu/qirk-config-sample.conf      # 透传设备的寄存器Security安全访问控制的参考配置文件
```

### 8.3. Qemu的编译和安装

- 编译和安装的sample脚本，caps/qemu/qemu-build-sample.sh，只在Ubuntu 1604系统上验证过
- 在其他系统编译和安装Qemu工具，参考build sample脚本的步骤调试
- 使用sample脚本编译和安装Qemu 2.6.0

```
./caps/qemu/qemu-build-sample.sh 2.6.0
```

- 使用sample脚本编译和安装Qemu 5.0.0

```
./caps/qemu/qemu-build-sample.sh 5.0.0
```

- 使用sample脚本的Qemu安装位置

```
/opt/qemu-2.6.0/
/opt/qemu-5.0.0/
```

### 8.4. 检查是否安装GCU Qemu Quirk Patch

在使用Qemu命令启动VM虚拟机，整卡透传GCU设备后，如果Qemu安装了GCU Qemu Quirk patch，命令行会打印如下的log信息:

################################################################

################# GCU Qemu Quirk Patch Applied #################

################################################################

### 8.5. Security寄存器访问控制配置文件

- 访问控制配置文件是option选项，如果没有Security访问控制需求，可以不用添加配置文件
- 配置文件的编写规则，参考sample配置文件，caps/qemu/quirk-config-sample.conf
- 默认的sample配置文件，是把BAR0全部寄存器访问设置为ReadOnly只读，把BAR1全部寄存器设置为访问不受限制
- 单个配置文件与单个GCU设备对应，配置文件名为GCU设备的domain:bus:dev.func.conf
- 配置文件存放位置，/etc/qemu-quirks/enflame/domain:bus:dev.func.conf

### 8.6. GCU Qemu quirk patch log开关

- 在Security寄存器访问控制配置文件中，把logging = 0修改为logging = 1，可以打开qemu quirk patch中的log开关
- 打开log开关后，对透传设备执行Hot Reset操作，Qemu会打印“GCU Qemu Quirk Reset Passthrough ...”信息，可以用这个log信息check判断patch的hot reset功能是否生效

### 8.7. S60系列加速卡透传的Reset操作

- 使用Qemu整卡透传S60系列加速卡设备，不需要安装上述GCU Qemu Quirk Patch，就可以对GCU设备实现Reset透传操作
- Qemu虚拟机对透传S60系列加速卡设备，只支持FLR Reset透传，不支持Hot Reset透传

### 8.8. S60系列加速卡透传/SRIOV VF透传/SRIOV使能时的限制

- 流程上需要先退出VM，unbind from vfio，最后才能做rmmod host kmd
- 在SRIOV模式下，PF不能透传到VM中，只有VF才可以透传到VM
- 业务的运行的过程中，不允许删除VF

## 9. 常用调试功能

### 9.1. 查看当前KMD的版本

```
cat /sys/module/enflame/version
```

### 9.2. 查看当前KMD的模块参数

```
cat /sys/module/enflame/parameters/*
```

### 9.3. 查看所有GCU设备的PCI设备号

```
sudo update-pciids ; lspci -nD | grep -e 1ea0 -e 1e36
```

### 9.4. 查看GCU上各个firmware的版本

```
cat /sys/module/enflame/drivers/pci:enflame/0000:01:00.0/fw_informations
或
cat /sys/class/enflame/gcu0/device/fw_informations
```

### 9.5. 查看KMD日志

```
dmesg                         # 当前的kernel log
cat /var/log/kern.log         # 最近几天的kernel log
zcat /var/log/kern.log.*.gz   # 更久以前的kernel log
```

### 9.6. KMD standby相关

做错误定位时涉及到KMD、FIRMWARE、TOOLS，为了快速缩小问题范围，可以开启该功能以确定是否为驱动Bug.

- 禁用/允许IOCTL 禁用IOCTL后，除whitelist外任何工具或UMD调用KMD IOCTL的命令会失败返回

```
sudo echo 1 > /sys/class/enflame/gcu0/device/standby/disable_ioctl
sudo echo 0 > /sys/class/enflame/gcu0/device/standby/disable_ioctl
```

- 添加/删除whitelist 在禁用IOCTL后，允许在whitelist中的工具或UMD调用KMD IOCTL

```
sudo echo "add:efvs" > /sys/class/enflame/gcu0/device/standby/whitelist
sudo echo "delete:efvs" > /sys/class/enflame/gcu0/device/standby/whitelist
```

- suspend/resume KMD中的线程（gcu_sched_func，gcu_poll_task_func） 使用该接口会让KMD中的线程（gcu_sched_func，gcu_poll_task_func）进入睡眠状态

```
sudo echo 1 > /sys/class/enflame/gcu0/device/standby/suspend_thread
sudo echo 0 > /sys/class/enflame/gcu0/device/standby/suspend_thread
```

**Attention:**

该接口不会停用gcu_ih_process_work_func线程。如果需要停用该线程，请在驱动加载时，添加参数irq_poll_interval=0

- 使用举例

```
sudo echo "add:efvs" > /sys/class/enflame/gcu0/device/standby/whitelist
sudo echo 1 > /sys/class/enflame/gcu0/device/standby/disable_ioctl
sudo echo 1 > /sys/class/enflame/gcu0/device/standby/suspend_thread
bypass kmd and debug
sudo echo 0 > /sys/class/enflame/gcu0/device/standby/disable_ioctl
sudo echo 0 > /sys/class/enflame/gcu0/device/standby/suspend_thread
sudo echo "delete:efvs" > /sys/class/enflame/gcu0/device/standby/whitelist
```

### 9.7. 运行时低功耗（RPM）相关

某些情况下，用户希望手动干预KMD预设的低功耗管理功能，相关接口如下

- sysfs接口 使用sysfs可以在加载驱动后，动态管理RPM功能，在各种安装方式下都可以使用
  - 查询/修改RPM开启状态，start 表示RPM功能开启，stop表示RPM关闭。
  ```
  sudo cat /sys/class/enflame/gcu0/device/rpm/switch
  sudo echo "start" > /sys/class/enflame/gcu0/device/rpm/switch
  ```
  - 查询/修改设备参数，idle多久后会进入sleep状态，单位ms，默认值10000
  ```
  sudo cat /sys/class/enflame/gcu0/device/rpm/rpm_sleep_delay
  sudo echo 100000 > /sys/class/enflame/gcu0/device/rpm/rpm_sleep_delay
  ```
  - 查询设备是否在低功耗状态，active是正常工作状态，非active是低功耗状态
  ```
  sudo cat /sys/class/enflame/gcu0/device/rpm/status
  ```
  - 查询使用设备的进程数量，数量为0表示没有进程使用该设备
  ```
  sudo cat /sys/class/enflame/gcu0/device/rpm/usage_count
  ```
  - 查询/修改不进入usage_count计数的白名单
  ```
  sudo cat /sys/class/enflame/gcu0/device/rpm/whitelist
  sudo echo add:name0 > /sys/class/enflame/gcu0/device/rpm/whitelist
  sudo echo delete:name0 > /sys/class/enflame/gcu0/device/rpm/whitelist
  ```
  - 查询设备自加载驱动以来总共的active时间
  ```
  sudo cat /sys/class/enflame/gcu0/device/rpm/active_time
  ```
  - 查询设备自加载驱动以来总共的suspended(含sleep)时间
  ```
  sudo cat /sys/class/enflame/gcu0/device/rpm/suspended_time
  ```
  - 查询设备自加载驱动以来总共的sleep次数
  ```
  sudo cat /sys/class/enflame/gcu0/device/rpm/sleep_count
  ```
  - 查询设备自加载驱动以来总共的wake up次数
  ```
  sudo cat /sys/class/enflame/gcu0/device/rpm/wakeup_count
  ```
  - 查询最后一个使用该设备的进程结束后，距离现在多久，单位ms
  ```
  sudo cat /sys/class/enflame/gcu0/device/rpm/last_busy
  ```

## 10. GCU虚拟化用户向导

### 10.1. GCU各种虚拟化方法概要

| 虚拟化方法 | VGDI | SR-IOV | MDEV |
| --- | --- | --- | --- |
| 虚拟化层级 | 软件模拟/dev/vgcu文件节点 | 硬件生成独立的PCIe VF设备 | 基于Linux mdev框架，软件模拟mdev设备 |
| 组件 | KMD | PCIe SR-IOV规范 + KMD + VFIO + 各FW | KMD + MDEV + VFIO + XMC |
| 切分方式 | 软件空分 | 硬件空分 | 软件空分 |
| 资源隔离 | 无 | 硬件 | 软件 |
| 故障隔离 | 无 | 有 | 无 |
| 目标场景 | 宿主机或透传虚拟机后，将一张物理卡以纯驱动方式虚拟出多个设备文件节点。同张物理卡生成的虚拟设备只能给不同的docker使用 | 宿主机驱动生成独立的PCIe VF设备，每个VF可在宿主机或透传到虚拟机上使用 | 宿主机驱动生成虚拟设备mdev UUID号。其仅能透传到虚拟机后形成PCIe设备，在虚拟机内使用 |
| 虚设备支持Docker | Yes | Yes | No |
| 虚设备支持透传虚拟机 | No | Yes | Yes |
| 比裸卡性能损失 | 5% | 单die1VF:<5%/单die2VF:~10% | 训练：~5%/推理：~15% |
| 支持产品 | NA | S60系列加速卡 | NA |

### 10.2. S60系列加速卡 SR-IOV支持

- 实现基础 基于标准的PCIe SR-IOV规范，通过XMC和 HW Context ID，S60系列加速卡支持将GCU片上硬件资源做硬件级拆分与隔离，可将一张物理GCU拆分为1/2/4个PCIe VF（Virtual Function），VF间的资源与故障是硬件隔离的。

当S60系列加速卡开启SR-IOV虚拟化功能并配置VF数量后，宿主机上每个GCU将生成一个PCIe PF和对应数量的PCIe VF设备。
对普通用户而言，PF/VF都是标准的PCIe设备，只是可用的计算、存储等资源只有真正物理卡的几分之一。
驱动probe后每个VF会生成/dev/gcuX计算设备节点，与普通物理卡生成的文件节点一样，KMD以上的软件可直接使用，不感知区别。

- PF和VF功能 PF设备只负责对GCU设备全局的管理，以及VF的创建、销毁等操作，它本身没有算力资源，故不对外提供任何业务功能，也不能透传到虚拟机。 每个VF则包含部分完全空分的资源，以及部分共享的资源。VF是用户可见、能直接用于计算业务的，也可透传到docker或虚拟机内使用。
- 资源切分 片上的计算、存储、传输、同步等各种硬件资源，根据业务使用与否，以及实例是否可拆份，划分为以下几种类型：
  | 类型 | 归属 | 描述 | IP |
  | --- | --- | --- | --- |
  | PF-only | 只属于PF，不<br>属于任何VF | 业务不直接感知，全局一个<br>实例，一般做管理用 | PCIe、SSM、AASP、NoC |
  | VF-only | 只属于某个VF | 业务使用，有多个实例，且<br>足够给每个Function一份 | SIP、SDTE、L1、CBF、L3、SP HWQ、SP task core |
  | VF-shared | 多个VF共享 | 业务需要使用，但全局只有<br>一份实例 | VMsys、MIH、HWSync、GSync、SP main core、ODTE、<br>CDTE、AP、CVA、VPU等 |
- 双die 2VF切分示意图
  > ![双die 2VF切分示意图](enflame_driver_user_guide__kmd_dual_die_2vf.png)
- 双die 4VF切分示意图
  > ![双die 4VF切分示意图](enflame_driver_user_guide__kmd_dual_die_4vf.png)
- 注意： 每个VF的L3实际大小为：（48G - 2G）/ VF_NUMS，其中2GB是预留给PF的。所以2VF的话，每个VF只有23G，4VF的话，每个VF只有11.5GB。

### 10.3. 各种reset

| Reset Type | 描述 | 命令 | Reset范围 | 触发场景 |
| --- | --- | --- | --- | --- |
| VF FLR | 仅reset VF-only IP | efsmi - | VF-only IP发生故障或错误 | 宿主机或虚机上的VF |
| PF FLR | SoC上除PCIe、SSM外的所有IP都会被reset, 各FW会reload，L2/L3清0 | efsmi -pf - | VF-shared IP发生故障或错误 | 宿主机上的PF，或VF FLR失败后升级 |
| Hot Reset | 整卡做Secondary Bus Reset，所有IP都会被reset, 各FW会reload，L2/L3清0 | efsmi -r hot | PF-only IP发生故障或错误 | 宿主机上ASIC或PF FLR失败后升级 |

- VF透传到虚拟机内的reset

| 命令 | 描述 |
| --- | --- |
| efsmi -r hot | VM内不支持VF上做hot reset，故VM KMD会返回不支持。 |
| efsmi -r 或efsmi -r fl | VM KMD仅执行VF FLR，FLR失败就返回，不自动升级为hot，否则会影响其它VF。 |
| VF-only IP RAS | 此种RAS只报给VF。VM KMD仅执行VF FLR。VF FLR若失败就直接返回，不会升级到PF FLR或Hot，否则会影响其它VF。 |
| 非VF-only IP RAS | 此种RAS只报给PF，不会报给VF。PF会先将SP暂停，停止VF侧的业务，然后执行PF FLR或Hot Reset。此场景下dmesg会有信息提示用户或运维人员介入，关闭虚拟机，将VF从vfio解绑，再删除VF。 |

### 10.4. VF管理

在宿主机上安装驱动后，可通过标准的Linux sriov_numvfs 等文件来做VF的创建、销毁、驱动绑定、透传虚拟机等。

为了简化用户配置管理，推荐直接使用集成在驱动run包中一起安装的 **GcuSriovMgr** 工具。注意，此工具需sudo或root权限。

```
root@sse-jq-114-138:/usr/local/bin# GcuSriovMgr --help
Version: 0.1
Usage: sudo ./GcuSriovMgr.sh <--slot pci_slot[,pci_slot2]> [--vf-num vf_number] [--check] [--bind] [--unbind] [--query]
 --slot   : pci_slot[,pci_slot2] is BDF number of the device you want to manage.
 --vf-num : create vf_number vfs， 0 means to destroy all vfs
 --check  : check sriov configuration on system
 --bind   : bind pcidev to vfio
 --unbind : unbind pcidev from vfio
 --query  : query pcidev info

Example1: ./GcuSriovMgr.sh --slot 01:00.0[,02:00.0] --vf-num 4, create 4 vfs for device 01:00.0 [and 02:00.0]
Example2: ./GcuSriovMgr.sh --slot 01:00.0 --vf-num 0, delete all vfs from device 01:00.0
Example3: ./GcuSriovMgr.sh --slot 01:00.0 --check, check sriov configuration on system
Example4: ./GcuSriovMgr.sh --slot 01:00.0 --bind, bind pcidev to vfio
Example5: ./GcuSriovMgr.sh --slot 01:00.0 --unbind, unbind pcidev from vfio
Example6: ./GcuSriovMgr.sh --slot 01:00.0 --query, show pcidev info
```

(在AMD服务器+kernel6.0以上的OS，需配置参数vfio_pci.disable_idle_d3=1，关闭VFIO PCI驱动的进入D3模式)

### 10.5. VF的典型应用

#### 直接在宿主机中使用 VF

其中 N 表示需要创建几个 VF，有效值为 1、2、4（根据实际产品定义）。

1. 安装宿主机的驱动，参考命令：

   ```
   sudo ./enflame-xxx.run --virt-host --vf-num N
   ```

2. 宿主机上为每个 VF 生成一个设备文件节点 `/dev/gcux`。
3. 在宿主机上安装必要的上层组件，启动业务进程。

#### 把 VF 传给宿主机的 Docker 使用

其中 N 表示需要创建几个 VF，有效值为 1、2、4（根据实际产品定义）。

1. 安装宿主机的驱动，参考命令：

   ```
   sudo ./enflame-xxx.run --virt-host --vf-num N
   ```

2. 宿主机上为每个 VF 生成一个设备文件节点 `/dev/gcux`。
3. 启动 Docker，并把要使用的 VF 对应的 `/dev/gcux` 文件映射到 Docker 内。以 `gcu0` 为例，参考命令：

   ```
   sudo docker run -it --name gcu0_test --device /dev/gcu0:/dev/gcu0 --device=/dev/gcuctl:/dev/gcuctl -v <host-workdir>:<container-workdir> -v <host-root-cache>:<container-root-cache> --network host ubuntu:20.04
   sudo docker exec -it gcu0_test /bin/bash
   ```

4. 在 Docker 内安装必要的上层组件，启动业务进程。

#### 把 VF 透传到 KVM 虚拟机中使用

![把VF透传到KVM虚拟机中使用](enflame_driver_user_guide__kmd_vf_passthrough_kvm.png)

步骤：

1. 安装宿主机的驱动，参考命令：

   ```
   sudo ./enflame-xxx.run --virt-host --vf-num N
   ```

   其中 N 表示需要创建几个 VF，有效值为 1、2、4（根据实际产品定义）。

2. 将GCU VF与vfio-pci绑定，参考命令：

   ```
   GcuSriovMgr [--slot xxx] --bind
   ```

   其中参数 slot 为可选，xxx 表示 VF 的 BDF。如果不指定 slot，表示将所有的 VF 都绑定到 vfio-pci。

3. 启动KVM虚拟机，并将目标VF透传到VM内，参考命令：

   ```
   qemu-system-x86_64 -M q35 -m 16G -smp 8 -enable-kvm -vga virtio -cpu host -drive file=ubuntu-2004_60G.qcow2,if=virtio -vnc :1 -net nic,model=virtio -net user,hostfwd=tcp::2222-:22 -device ioh3420,id=root_port1,bus=pcie.0 -device x3130-upstream,id=upstream1,bus=root_port1 -device xio3130-downstream,id=downstream1,bus=upstream1,chassis=9 -device vfio-pci,bus=downstream1,host=$vf_bdf
   ```

4. 在虚拟机中加载驱动，参考命令：

   ```
   sudo ./enflame-xxx.run
   ```

5. 在虚拟机上安装必要的上层组件，启动业务进程。
6. 在虚拟机跑完业务后，关闭虚拟机。
7. 宿主机上将 GCU VF 重新绑定回 KMD，参考命令：

   ```
   GcuSriovMgr [--slot xxx] --unbind
   ```

   其中参数 slot 为可选，xxx 表示 VF 的 BDF。如果不指定 slot，表示将所有的 VF 都绑定回 KMD。

### 10.6. 限制

- S60（PN：EFB-0088800-00）仅支持2VF模式。
- S60（PN：EFB-0088000-00）支持ASIC、1VF、2VF、4VF模式。

## 11. GCU错误信息报告

enflame 驱动程序的GCU错误信息报告以Eid消息的方式，打印到操作系统的内核日志中。这些消息可能表示硬件问题、enflame 软件问题或用户应用程序问题。

**Attention:**

此功能从TopsPlatform_v1.2.2系列版本开始支持

### 11.1. GCU错误信息报告在内核日志中的格式

Eid消息在内核日志中以包含关键字“Eid [ID]”的error级别语句展示，如下图所示：

![GCU错误信息报告示例](enflame_driver_user_guide__kmd_eid_log_sample.png)

### 11.2. Eid列表

- Eid定义规则
  1. 1-128 : 设备侧反馈的进程级错误
  2. 129-256 : 其他进程级错误
  3. 257-512 : 设备侧反馈的设备级错误
  4. 513-640 : 其他设备级错误

| Eid | 故障描述 | 可能原因 | 影响范围 | 恢复方式 |
| --- | --- | --- | --- | --- |
| 1 | invalid stream pkt from sp | 驱动错误、系统内存损坏 | 业务进程 | 进程重启 |
| 2 | invalid stream pkt from other engine | 驱动错误、系统内存损坏 | 业务进程 | 进程重启 |
| 3 | sip assertion | 用户态应用错误 | 业务进程 | 进程重启 |
| 129 | invalid or corrupted buffer | 驱动错误 | 业务进程 | 报 bug 到驱动 |
| 131 | no permission | 驱动错误、用户态应用错误 | 业务进程 | 报 bug 到驱动 |
| 132 | io operation error | 硬件错误、驱动错误、系统内存损坏、总线错误 | 业务进程 | 报 bug 到驱动 |
| 133 | out of memory | 驱动错误、系统内存损坏、总线错误 | 业务进程 | 报 bug 到驱动 |
| 134 | invalid address | 驱动错误、用户态应用错误 | 业务进程 | 报 bug 到驱动 |
| 135 | no resource | 驱动错误 | 业务进程 | 报 bug 到驱动 |
| 136 | no file | 驱动错误 | 业务进程 | 报 bug 到驱动 |
| 137 | no device | 驱动错误 | 业务进程 | 报 bug 到驱动 |
| 257 | double bit error | 硬件错误 | 整卡 | 整卡reset 后用 efsmi 检查是否进入 RMA |
| 261 | PCIE engine exception | 硬件错误、驱动错误、总线错误 | 整卡 | 整卡reset |
| 271 | SSM engine exception | 硬件错误、驱动错误 | 整卡 | 整卡reset |
| 281 | VMSYS engine access pte error | 硬件错误、驱动错误、用户态应用错误、系统内存损坏 | 整卡 | 整卡reset |
| 282 | VMSYS window error | 硬件错误、驱动错误 | 整卡 | 整卡reset |
| 283 | VMSYS engine exception | 硬件错误、驱动错误 | 整卡 | 整卡reset |
| 291 | memory controller engine exception | 硬件错误 | 整卡 | 整卡reset |
| 301 | GMU GSYNC engine exception | 硬件错误 | 整卡 | 整卡reset |
| 311 | DPF engine exception | 硬件错误、驱动错误 | 整卡 | 整卡reset |
| 321 | AASP engine exception | 硬件错误、驱动错误、过热 | 整卡 | 整卡reset |
| 331 | AP engine exception | 硬件错误、驱动错误 | 整卡 | 整卡reset |
| 341 | VPU engine exception | 硬件错误、驱动错误 | 整卡 | 整卡reset |
| 351 | engine access cf bus error | 硬件错误、驱动错误 | 整卡 | 整卡reset |
| 352 | engine access df bus error | 硬件错误、驱动错误 | 整卡 | 整卡reset |
| 353 | system adapt engine exception | 硬件错误、驱动错误 | 整卡 | 整卡reset |
| 354 | system adapt engine rw error | 硬件错误、驱动错误 | 整卡 | 整卡reset |
| 361 | SP engine exception | 硬件错误、驱动错误 | 整卡 | 整卡reset |
| 371 | dma illegal vc config | 驱动错误 | 整卡 | 整卡reset |
| 372 | dma illegal programming | 驱动错误 | 整卡 | 整卡reset |
| 373 | dma execution timeout | 驱动错误、系统内存损坏、总线错误 | 整卡 | 整卡reset |
| 374 | dma engine exception | 硬件错误、驱动错误 | 整卡 | 整卡reset |
| 381 | Shared memory access exception | 硬件错误、驱动错误 | 整卡 | 整卡reset |
| 391 | SIP engine exception | 硬件错误、驱动错误、用户态应用错误 | 整卡 | 整卡reset |
| 401 | interrupt handler engine exception | 硬件错误、驱动错误、系统内存损坏 | 整卡 | 整卡reset |
| 402 | interrupt ring watermark | 硬件错误、驱动错误 | 整卡 | 整卡reset |
| 411 | ESL link error | 硬件错误、驱动错误、总线错误 | 整卡 | 整卡reset |
| 513 | low power mode error | 硬件错误、驱动错误 | 整卡 | 整卡reset |
| 514 | PCIE link down | 硬件错误、驱动错误、总线错误 | 整卡 | 整卡reset |
| 515 | PCIE error reset | 硬件错误、驱动错误、总线错误 | 整卡 | 整卡reset |
| 516 | unknown interrupt entry over count | 硬件错误、驱动错误、系统内存损坏、总线错误 | 整卡 | 整卡reset |
| 518 | mdev reset | 硬件错误、驱动错误、用户态应用错误、系统内存损坏、总线错误 | 整卡 | 整卡reset |
| 519 | user trigger reset | N/A | 整卡 | 整卡reset |

## 12. FAQ

### 12.1. KMD 依赖的编译器版本

请确保host环境安装有linux内核编译时使用的编译器版本(kernel compiler version)，该版本信息可以通过以下方式获取：

1. 查看/proc/version (运行时可见)

```
cat /proc/version
Linux version 6.8.0-49-generic (buildd@lcy02-amd64-103) (x86_64-linux-gnu-gcc-12 (Ubuntu 12.3.0-1ubuntu1~22.04) 12.3.0, GNU ld (GNU Binutils for Ubuntu) 2.38) #49~22.04.1-Ubuntu SMP PREEMPT_DYNAMIC
```

1. 进入内核源码/头文件目录中查看 include/generated/compile.h

```
cat /usr/src/linux-headers-6.8.0-49-generic/include/generated/compile.h
#define UTS_MACHINE             "x86_64"
#define LINUX_COMPILE_BY        "buildd"
#define LINUX_COMPILE_HOST      "lcy02-amd64-103"
#define LINUX_COMPILER          "x86_64-linux-gnu-gcc-12 (Ubuntu 12.3.0-1ubuntu1~22.04) 12.3.0, GNU ld (GNU Binutils for Ubuntu) 2.38"
```

### 12.2. KMD编译失败

KMD编译失败，出现类似如下log：

![KMD编译失败示例](enflame_driver_user_guide__kmd_build_fail_as_header_miss.png)

*图 12.2.1 没有kernel开发头文件导致KMD编译失败*

此时，请先在host机器上安装对应的kernel header，再次编译KMD即可。

```
sudo apt-get install linux-headers-`uname -r`
```

### 12.3. 模块正在使用而无法卸载

- 查找正在使用gcu驱动的内核模块

```
lsmod | grep enflame
```

下图表示enflame模块正在被enflame_test模块使用，需先 *rmmod enflame_test*。

![enflame模块被占用示例](enflame_driver_user_guide__kmd_in_use.png)

*图 12.3.1 正在使用enflame的其它模块*

- 查找正在使用gcu驱动的进程

```
X=(); for a in $(mount | cut -d' ' -f3); do test -e "$a" || X+=("-e$a"); done ; lsof "${X[@]}" -f -- /dev/gcu*
ps -aux | grep gcu
kill -9 <进程ID>
```

**Attention:**

如果出现进程杀不掉，则可能是docker使用方式不对

### 12.4. enflame_peer_mem驱动加载失败

enflame_peer_mem驱动加载失败，kernel.log显示如下：

![enflame_peer_mem驱动加载失败示例](enflame_driver_user_guide__kmd_peermem_load_fail_as_openibd_excetpion.png)

*图 12.4.1 openibd服务异常导致enflame_peer_mem驱动加载失败*

原因：openibd服务异常导致的问题。

```
检查openibd状态
/etc/init.d/openibd status
重启openibd服务
/etc/init.d/openibd restart
```

openibd服务重启后，再次加载enflame_peer_mem驱动即可。

### 12.5. KMD device id与PCI bdf对应关系

```
# 以0000:01:00.0为例
cat /sys/bus/pci/devices/0000\:01\:00.0/device_id
```

确定对应关系的方法如下图：

![KMD device id与PCI BDF对应关系示例](enflame_driver_user_guide__kmd_find_device_id_by_bdf.png)

注意：device_id是kmd的逻辑设备号，每次加载kmd后可能与上次不同。

### 12.6. KMD ioctl版本号使用说明

1. 获取ioctl版本号的方法：

通过kmd提供的sys 文件节点：'/sys/module/enflame/drivers/pci:enflame/gcu_ioctl_version'

**Attention:**

获取kmd版本号：'cat /sys/module/enflame/version'

2. KMD的ioctl版本号格式为：major.minor.patch
含义分别为：

```
major: 主版本号，当兼容性发生变化时，会修改此段
minor: 次版本号，当有额外的ioctl命令增加时，会修改此段
patch: 修订版本号，当kmd修复bug时，会修改此段
```

## 13. 相关参考

### 13.1. reset种类

- cold reset: reset from PWROK PAD

```
cat /sys/bus/pci/devices/xxx/power/control
```

- warm reset: Button reset from BRST# PAD or PCIE PERST# from PCIE slot

```
echo 1 > /sys/bus/pci/devices/xxx/remove
sleep 1
echo 1 > /sys/bus/pci/devices/xxx/rescan
```

**Attention:**

rescan会在相应的卡上重新加载kmd驱动

- PCIe hot/link-down reset：与warm reset类似，会复位除PCIe controller外的其它所有IP。而PCIe controller会被内部复位。

```
#直接操作 bridge port
dev=0000:01:00.0
port=$(basename $(dirname $(readlink "/sys/bus/pci/devices/$dev")))
[ -e "/sys/bus/pci/devices/$port" ] && {
bc=$(setpci -s $port BRIDGE_CONTROL)
setpci -s $port BRIDGE_CONTROL=$(printf "%04x" $((0x$bc | 0x40)))
sleep 0.01
setpci -s $port BRIDGE_CONTROL=$bc
sleep 0.5
}
```

- PCIe FLR：向PCIe cfg space的FLR位写1，PCIe controller将触发SSM MCU中断，SSM来执行FLR reset sequence。

```
echo 1 > /sys/bus/pci/devices/xxx/reset
```

- BLR：Driver直接给SSM发带参数的命令，SSM来执行指定单个block的reset，包括 "All IPs"/Cluster/VG/HCVG/VDEC。

### 13.2. Reset GCU的几种方法

-
  1. Docker内，使用如下命令重新加载指定的驱动。

```
echo 1 > /sys/bus/pci/rescan
```

-
  1. Docker内。

```
efsmi -F -r -i [ID]
```

-
  1. Docker或Host内，hot reset某个设备，如gcu0(0000:01:00.0)。

```
echo 1 > /sys/class/enflame/gcu0/device/gcu_reload
或者
echo 1 > /sys/bus/pci/devices/0000:01:00.0/gcu_reload
```

-
  1. Host内，参考 修改KMD的模块参数，重新加载KMD，且只使能指定的卡。

```
gcu_whitelist_str=00:01.0
```

### 13.3. 关闭Gcu Reset

Docker或Host内：

```
# 查看初始值，默认为全 f。以便重写后恢复默认值
cat /sys/bus/pci/drivers/enflame/reset_enable
# 关闭Gcu Reset
echo 0 > /sys/bus/pci/drivers/enflame/reset_enable
```

### 13.4. RAS后SIP coredump功能开关

- 修改KMD的模块参数: ras_dump_ip_mask
- (参见：修改KMD的模块参数 章节)

### 13.5. 如何判断KMD加载完成

```
cat /sys/module/enflame/initstate
```

- 如果数据结果为going,表示正在卸载中
- 如果输出结果为coming，表示正在加载
- 如果输出结果为live,表示加载完成，可以正常使用KMD
