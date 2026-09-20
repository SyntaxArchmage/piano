# DTE（Data Transformation Engine）API 概要

本文档概述 Tops C++ 中 DTE 相关类型、资源约束、数据描述、同步/异步接口及时间函数，便于查阅。

---

### 1. DTE 类定义

**GCU300**

| 类型 | 说明 |
|------|------|
| `tops::shared_dte` | 共享 DTE，多线程可共用 |
| `tops::private_cdte` | 私有 CDTE |
| `tops::private_dte` | 私有 DTE |

**GCU400**

| 类型 | 说明 |
|------|------|
| `tops::shared_dte` | 共享 DTE |
| `tops::local_dte` | 本地 DTE（对应 300 侧概念上的私有/本地资源） |
| `tops::private_dte` | 私有 DTE |

**初始化**：创建 DTE 实例后需调用 `dte.init()` 完成初始化，再执行搬运或配置。

---

### 2. DTE 资源限制

**GCU300**

- `private` 类 DTE 数量：**≤ 6**
- 合计（shared + private 等）：**≤ 16**；若使用标量线程等占用额外资源的情形下，部分文档/实现中总上限可能为 **≤ 8**（以当前平台编程指南为准）

**GCU400**（含 AGCU300+GCU400 兼容模式）

- DTE 总数：**≤ 16**
- `local` + `private` 合计：**≤ 12**

---

### 3. DTE 数据参数（mdspan）

源/目的多维张量常用 `tops::mdspan` 描述：

```cpp
tops::mdspan src(addr, N, H, W, C);   // 扁平维度参数
tops::mdspan src(addr, shape);        // 已有 shape 数组
tops::mdspan src(addr, {N, H, W, C}); // 初始化列表
```

**约束**

- `shape` 最多 **5** 维
- 每一维大小 **≤ 2^24 − 1**
- 元素总占用 **≤ 2^32 − 1** 字节

---

### 4. 同步启动接口（GCU210 + GCU300 + GCU400）

以下为阻塞式、一次调用即完成搬运的同步接口族（名称以实际头文件为准）：

| 接口 |
|------|
| `memcpy` |
| `memset` |
| `slice` |
| `deslice` |
| `transpose` |
| `slice_transpose` |
| `transpose_deslice` |
| `pad` |
| `mirror_tb` |
| `mirror_lr` |
| `broadcast` |

---

### 5. GCU300+ 新增同步接口

在 300 及后续架构上额外提供的同步类接口示例：

- `slice_pad`、`slice_deslice`、`slice_broadcast`、`slice_expand`
- `shrink_deslice`、`memset_deslice`
- `mirror_tb_pad`、`mirror_lr_pad`、`mirror_tb_deslice`、`mirror_lr_deslice`
- `sub_sample`

---

### 6. 异步启动方式

**方式一：异步 memcpy + 事件**

- 调用 `memcpy_async`（或等价异步 API）发起传输
- 使用 `tops::event` 记录完成依赖
- 在需要处调用 `ev.wait()` 等待结束

**方式二：连接 + 配置 + 触发**

- `connect()` 建立 DTE 与 buffer/端点的关联
- 多次调用 `config_xxx()` 下发参数（见第 7、8 节）
- `trigger()` 启动本次配置好的传输

---

### 7. 全量配置接口（config_xxx）

与第 4 节同步接口一一对应，名称前加 `config_` 前缀，用于在 `connect()` 之后一次性写入完整参数，再由 `trigger()` 启动。例如：

- `config_memcpy`、`config_memset`、`config_slice`、`config_deslice`
- `config_transpose`、`config_slice_transpose`、`config_transpose_deslice`
- `config_pad`、`config_mirror_tb`、`config_mirror_lr`、`config_broadcast`
- 以及 300+ 扩展对应的 `config_slice_pad`、`config_slice_deslice` 等（若平台提供）

---

### 8. 增量配置接口

在已 `connect()` 的前提下，仅修改部分参数、避免重复全量 `config_xxx` 时可使用：

- `set_dst_addr`、`set_src_addr`
- `set_dst_offset`、`set_src_offset`
- `set_dst_dim_size`、`set_src_dim_size`
- `set_total_size`
- `set_transpose_layout`
- `set_pad_config`
- `set_slice_dim_size`
- `set_dim_stride`

典型流程：首次 `config_xxx` 或多次 `set_*` 组合 → `trigger()`。

---

### 9. 时间函数

**GCU400**

- `clock64()` / `clock()`：返回值为 **纳秒**（ns）量级的时间（具体语义以编程指南为准）

**GCU300**

- `krt_reset_clock()` / `krt_close_clock()` / `krt_clock()`：以 **cycle**（周期）计

---

### 代码示例

**同步模式（示意）**

```cpp
tops::shared_dte dte;
dte.init();
tops::mdspan src(src_ptr, {N, H, W, C});
tops::mdspan dst(dst_ptr, {N, H, W, C});
dte.memcpy(dst, src);  // 阻塞至完成
```

**异步模式：event**

```cpp
tops::event ev;
tops::shared_dte dte;
dte.init();
dte.memcpy_async(dst, src, ev);  // 名称以实际 API 为准
ev.wait();
```

**异步模式：connect + config + trigger**

```cpp
tops::shared_dte dte;
dte.init();
dte.connect(/* ... */);
dte.config_memcpy(dst, src);
dte.trigger();
// 或先 set_src_addr / set_dst_offset 等增量修改后再 trigger()
```

---

*说明：具体函数签名、重载与是否在某架构可用，请以当前芯片对应的 Tops C++ 编程指南与头文件为准。*
