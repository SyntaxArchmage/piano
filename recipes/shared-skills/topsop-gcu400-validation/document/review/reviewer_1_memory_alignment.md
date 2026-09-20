# Reviewer 1 — 向量对齐与地址空间约束检查

本 reviewer 负责审查GCU400 上向量 / TAR 访存的对齐、地址空间限定、SDMEM 静默 mismatch 风险与 `__local__` / `__valigned__` 使用规范。

加载下列 skill：

- `gcu400-dte` skill：DSM 三种视图（Private L1 / Shared Affinity / Shared Non-Affinity）、地址空间归属判定、RO/WO Hint、Private VDMEM Mirror
- `gcu400-compute-ldst` skill：向量访存规则、TAR 操作、512B / 256B / 128B 对齐与 SDMEM 静默 mismatch

## 触发条件

target 出现 `__vector*` / `__local__` / `__valigned__` / `__shared__` / SDMEM 向量访问 / TAR / `tcle::leaptr` / `reinterpret_cast` 跨地址空间转换时执行。纯标量计算 / 纯 host 接线返回 `not_applicable`。

## 地址空间先判定

判定对齐 / 预算前，先确定对象落在 `VDMEM`（L1）、`SDMEM`（L1 标量段）还是 rodata，避免把不在 L1 VDMEM 的对象按 L1 路径报错：

- 显式 `__local__` 的对象，或明确通过 `tops::Private` / `mdspan(tops::Private, ...)` / vector ld-st 路径访问的对象，按 L1 VDMEM 看待
- 未标注 `__local__` 的普通局部变量 / 局部数组，默认按线程私有栈 / parameter buffer / SDMEM 处理。"数组大 / 名字叫 workspace / 在 device 函数里"都不足以判它属于 L1 VDMEM
- 普通栈数组不等于 rodata。rodata 检查针对静态常量表、字符串、编译期常量数组等只读段，运行时局部数组不计入

## 向量对齐（命中强制规则锚点）

- `__vector4` 需要 `aligned(512)`（512B）
- `__vector2` 需要 `aligned(256)`（256B）
- `__vector` 需要 `aligned(128)`（128B）
- 承载 DTE 目标且后续会被向量 / 矩阵访问的 L1 base buffer 用 `__local__ __valigned__` 声明，保证 base allocation 具备 512B 对齐——原因：base 起点固定到 512B 后，最大向量宽度 / 矩阵路径不会从 allocation 起点开始破坏对齐。惯用写法：

  ```cpp
  __local__ __valigned__ char buffer[L1_SIZE];
  ```

- DTE 子 slice / 子偏移地址不按 512B 判 correctness；未满足 128B 地址 + dim0 字节数对齐时只记录性能风险，除非具体 DTE API / SDK 文档或实测 DTE check 证明该操作会搬错——原因：DTE 通路的满带宽条件是 128B burst 粒度，缺对齐会拆请求 / 浪费 outstanding，而不是已知 512B correctness 约束。
- 非法 `addrspacecast` / `reinterpret_cast` 跨地址空间转换会直接访问到错误地址空间——原因：V3 跨地址空间寻址走不同物理通道，强转后硬件按目标空间路径解地址即触发 illegal address

## SDMEM 向量访问 512B 对齐（命中强制规则锚点）

- SDMEM 向量访问地址不满足 512B 对齐 → 静默精度 mismatch（按 `Major` 以上处理）——原因：硬件不会触发 hot reset / dmesg 报错，只会让结果错；不主动检查就漏判
- 影响范围包括：算子内 `__local__` 数组按 SDMEM 访问、send_buffer / dte_stack_addr 之类跨 sub-thread 标量传递通道、栈上数组被向量 load / store 命中
- DTE / 向量通路的 128B 对齐属于带宽风险；性能建议归 `性能建议` 段，不在本 reviewer 的 correctness finding 里出

## 32bit 地址空间约束 / 跨地址空间寻址

- 函数参数、指针计算、intrinsic 地址参数对 L1 区域使用 `__private__ T*` / `__local__ T*` 限定；缺限定且直接在 intrinsic 里使用会落到非法地址路径
- 地址 cast 到整数做算术时按当前路径所需位宽——原因：V3 标量同时支持 32bit 与 64bit，混用 `int` / `long` / `unsigned long long` 时计算路径会被偷换，可能触发软件模拟或错误 shift

## TAR 与 leaptr

- TAR 句柄不是普通指针——原因：硬件按 group 维护 base + increment，普通指针赋值不会改 TAR 寄存器
- `tcle::leaptr<T>` 本质是带 stride 的虚拟指针，需要明确给出 stride 字节数；stride 字节数与实际元素步长不一致会按错位读写
- 同一段代码内同时保活的 TAR 数量受硬件 group 上限限制（具体上限见 `gcu400-compute-ldst` skill）；超限会发生寄存器压力 / spill

## 防误报

- 看到 `__vector` 类型不一定就在 L1 VDMEM——只有显式 `__local__` 或 vector ld-st 路径才走 L1 VDMEM；普通栈上的 `__vector` 仍按 SDMEM 判定
- 看到 `reinterpret_cast` 不一定就违规——同 namespace / 同地址空间的 byte 重解释（如 `char*` ↔ `T*`）合法；只有跨地址空间（local ↔ shared / global）才按违规 
