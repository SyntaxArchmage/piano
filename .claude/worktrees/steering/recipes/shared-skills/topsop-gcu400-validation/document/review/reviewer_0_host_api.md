# Reviewer 0 — Host API 接口契约检查

本 reviewer 负责审查 V3 `topsaten_*` Host API 的命名签名、入参防御、向下兼容、异步语义禁区与 host 侧路径判定是否满足对外接口契约。

加载 `gcu400-compute-flow` skill：Host API 语义、OpBase 模式、`CheckArgs` 覆盖范围、`topsatenStatus_t` 返回值约定与 dispatch 规范统一在此维护。

## 触发条件

target 涉及对外头文件、`topsaten_*` 入口、host OpBase 派生类、dispatch 选路或 fallback 改动时执行。block 粒度只看到 device kernel 没有 host 改动时返回 `not_applicable`。

## 命名与签名

- 公共 API 以 `topsaten` 开头；改入口名前先确认是否存在旧 `void*` / 旧 descriptor 版本仍在被调用方使用
- Tensor / buffer 参数按 `descriptor + pointer` 成对出现：
  - 输入：`const topsatenTensorDescriptor_t desc, const void* ptr`
  - 输出：`const topsatenTensorDescriptor_t desc, void* ptr`
- 返回值通常是 `topsatenStatus_t`
- `topsStream_t stream` 通常放在最后

关注会影响接口稳定性、自动接线、注册查找、协议含义或调用正确性的命名问题。`enum` 值、局部标识符、内部 helper 的"语义不够直观"这类主观可读性建议价值低，可不报。

## 入参防御

`CheckArgs()` 至少覆盖下列检查；遗漏任一项都可能在非法输入下走到 UB / 崩溃：

- 必填 tensor 的数据指针为 nullptr
- rank 合法
- dtype 合法
- shape / dims 非零
- 元素总数不超过 host 路径假设上限
- 形状之间的兼容性
- optional tensor / optional output 组合是否合法
- workspace / launch / tiling 预算是否可行（按 `gcu400-compute-flow` "Workspace 纪律" 检查）
- 不支持的 dtype / format / rank 返回 `TOPSATEN_STATUS_NOT_SUPPORT`

### 指针 / descriptor 空值判定口径

- `descriptor` 默认不为 nullptr，"descriptor 是否为 nullptr"不需要单独检查
- 一个 tensor 是否可选传入，唯一判定标准是该 tensor 的数据指针是否为 nullptr；只有在 `ptr != nullptr` 成立之后，才允许访问对应 descriptor 的成员

## 向下兼容

- 新增 TensorDescriptor 版 API 时，检查旧的 `void*` 版 API 是否仍保留；缺失会让老调用方断链
- 本次改动调整了分发条件或 fallback 路径时，检查旧入口与新入口的行为是否一致
- 如有 Python binding 同步暴露此能力，检查 binding 是否同轮更新

## Host API 不允许同步（命中强制规则锚点）

Host API 正常执行路径不应出现同步行为，否则会破坏 stream 并行。重点关注：

- `topsMemcpy(D2H)` 或其他把 device 数据拉回 host 的同步拷贝
- `topsStreamSynchronize`
- `topsEventSynchronize`
- host 侧显式等待 event / stream 完成
- 为了打印、校验或 profile 在 host API 中插入的临时 D2H / 同步逻辑

## host 侧路径判定

- shape / dtype / tile / launch 预算优先在 host 侧判定——原因：dispatch 语义应集中在 host，避免同一 API 的路径选择散落到多个执行点
- "能不能进入 fusion / fast path"的主决策应该在 host 侧；藏进 kernel 会让 dispatch 失去对路径的控制
- host 侧判定出的路径要与 kernel 内部实际消费的分支对齐（漂移细节由 reviewer_2 / reviewer_3 视角共同覆盖）
- fallback 是正式行为：语义必须正确、必须有测试覆盖；压测大面积落到 fallback 时先检查 dispatch gate

## 编译目标

- 编译目标必须是 `-arch gcu400`——原因：非 gcu400 与 gcu400 指令编码不兼容，混用会出现静默行为错误。同一 host 实现链路里出现非 gcu400 target 残留时，按 `Major` 以上处理
