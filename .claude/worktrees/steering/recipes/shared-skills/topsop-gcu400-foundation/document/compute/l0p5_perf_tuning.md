# L0P5 Perf Tuning

L0P5 是 SIP 内 S3 流水段的 GEMM 输入 cache,由 SMR(matrix)与 IV(vector)两个子 cache 组成。**性能瓶颈核心来自三处**:① 每条 VMM2 是 cache 查找的最小单元,SMR / IV 任一支 miss 都会延迟整条 VMM2;② SMR slice 与 IV set-way 容量决定了 K 方向上能 cache 多少个 LHS / RHS,直接限制了 footprint 重排能展开的窗口;③ GEMM 本身计算时间(64x64x64 一条 32 cycle)极短,标量发射端必须有足够带宽喂出连续 GEMM,否则 cache 命中率再高也跑不满 2D MAC 通路。

---

## 1. 在 SIP 流水中的位置

GEMM 指令从 S2 进入 S3,S3 内部按 `PISQ → PreSplit → L0P5 Cache Tag (含 L0 RFC Tag) → ROQ → PostSplit Cache Data → S4 (含 L0 SMR RFC)` 顺序工作。L0P5 Cache Tag 模块负责 IV 与 SMR 的查找与分配,Cache Data 模块负责数据存储与转发到 S4。S3 通过 `xpu_l1_ldro_req_0 / req_1` 接口直接向 L1 发只读请求,Cache Miss 时由 ROQ 把读请求转发到 L1。

完整 S3 接口组与 Cache Miss 路径(8 步)详见 `document/l0p5_invalidation.md` §1 / §2,本份不重复。本份只关心一条:**Cache Tag 模块在 PreSplit 之后立刻查找,任何一次 miss 都会推迟该 VMM2 进入 ROQ 的时机**。

---

## 2. GEMM 调度流水的 VMM2 拆分

GEMM 指令从 S2 以多 sub-thread 方式发送给 S3 PISQ。S3 内部把每条 GEMM 拆为多条 VMM2,**从 RNME 到 ROQ 以 in-order 方式执行**。VMM2 拆分有三个对算子开发可见的事实:

- **每条 VMM2 的 RHS SMR 是同一份**——在第一条 VMM2 时形成 LDSMR 的 MLI,该 MLI 在 PostSplit 被拆为 LLI。也就是说同一个 GEMM 内 RHS 只查 / 加载一次,后续 VMM2 全部命中 SMR。
- **每条 VMM2 的 LHS 可能不同**——每条 VMM2 自己生成 LD_IV 的 LLI,串行查 IV cache。
- **每条 VMM2 都更新 tag table**,后续 VMM2 / 后续 GEMM 都按更新后的结果查找。

> 算子要点:VMM2 是 cache 查找与 hit/miss 判定的最小单元,**可能出现一支 hit 一支 miss 的情况**(IV miss + SMR hit,或反之)。tag table 的更新顺序直接影响后续 GEMM 命中率,Footprint Order 调优本质上是控制这条更新序列。

---

## 3. SMR Cache 结构(12 slice,按 L1 layout)

SMR cache 共 12 个 slice,每 slice 与 L1 一行 layout 对齐。SMR cache 用 slice / 矩阵为粒度做 tag 管理,共有 5 种 tag 策略。每种策略对应不同的对齐 / dtype / overlap 场景,硬件按 MLI_GEMM 的实际参数自动选择,算子开发只需要让数据布局尽量落在"对齐 + 高复用"路径上。

### 3.1 Slice-Based Tag Management(对齐场景的基础策略)

适用 FP16 32×64 矩阵且 128B 对齐的场景:输入原始数据起始地址对齐 + stride 对齐 + 相邻矩阵无 overlap 时,L0P5 把内存中分散的多片 tensor 数据聚合到 L0P5 data 中,以矩阵或 slice 为单位做 tag 管理,用一次分配 / 一次查找的代价拿到非对称式 VMM 计算下的复用收益。

### 3.2 Decouple Matrix Size with Bus Width(64B 对齐 dtype 的带宽折半救援)

适用 INT8 / FP8 矩阵且只支持 64B 对齐的场景:矩阵访问是 64B 单位,但 L1 ↔ L0P5 总线宽度是 128B。**L0P5 Cache 把总线上取进来的额外 64B 数据保存下来供未来复用,避免每次访问浪费 50% 带宽**。

### 3.3 Per Row Dynamic Addressing(起始地址未对齐的 slice 视角延伸)

适用访问数据起始地址不对齐的场景:L0P5 仍以类似矩阵 slice 视角做"行地址计算 + 选择性加载",把"最小的、能够囊括矩阵存储的地址空间" cache 起来,同时在行方向尽量提升复用度。多行的尺寸延伸同样的长度,一起保持并扩展了 slice 的视角。

### 3.4 Pure Address Based Tagging(跨 MLI_GEMM 共享)

不仅考虑单次 MLI_GEMM 内的数据复用,还基于原始矩阵每一行的行方向上自然延伸,**用纯地址做 tagging,使得多个 MLI_GEMM 之间能够共享全部或部分数据**。多个矩阵在水平方向有 overlap 而不是地址完全相等时,L0P5 像传统地址 Cache 一样,纯靠地址 overlap 关系命中——而不是只有当矩阵参数完全相等时才能复用。

### 3.5 Adaptive Storage for Small Matrix(行间距小于行长时退回连续块)

当矩阵行间距实际很小(甚至小于行长)、直接采用 slice 视角会造成较大重复浪费时,**直接采取大块连续存储**,以避免 slice 视角下的"红区"浪费。

> 算子要点:这 5 种策略是硬件自动选择的,算子开发不需要也无法显式指定。但写矩阵布局时应尽量让数据落到 §3.1(对齐 + 无 overlap)路径上,以拿到最高 PPA 复用收益。

---

## 4. IV Cache 结构(128 B line × 16 set × 20 way)

IV cache 被管理为一个 16 set × N way 的 cache,**N 取决于 Storage Region 定义有多少行属于 IV**(总容量 40 KB,见 `document/l0p5_invalidation.md` §3)。

### 4.1 Set 内 4 subset 分配机制

为了 1 个 set 里方便分配最多 4 line,**1 个 32-way 的 set 被划分为 4 个 subset**:

- 1 cycle 内最多在 1 个 subset 里挑 1 个 cacheline 分配,4 个 subset 总共最多分配 4 line。
- subset 不改变 set-way 短相连映射;1 个 set 里所有 way 在 tag 查询时仍是全相连的,**只有 cache 分配按 sub-set 粒度走**。
- 每个 subset 内,each way 按 LRU 排队算法挑 victim。

### 4.2 2D / 1D 共用 IV Cache 的优先级

每 cycle 最多分配 **4 个 cacheline 给 2D,1 个 cacheline 给 1D**。**1D Cacheline 只会在没有 2D Cacheline Hit 的 set 里分配**。

> 算子要点:1D 与 2D 共用 IV cache,2D 优先占用;1D 算子不要假设 IV cache 全部容量都可用。

---

## 5. Cache Miss 序列与发射时机

VMM2 是 cache hit/miss 判定的最小粒度,以下三条事实对优化策略有直接影响:

- **以 VMM2 为单位处理 sequence**,所以会出现"一支 hit 一支 miss"——IV miss 与 SMR miss 不一定同时发生,Cache Tag 模块独立查 IV 与 SMR。
- **微指令不会跨 GEMM 发出**——同一条 GEMM 内的 LDSMR / LD_IV / VMM2 LLI 只会在该 GEMM 范围内调度,不会和后续 GEMM 的微指令交错;意味着 GEMM 之间的 cache 命中状态切换是离散的。
- **发射时机原则:在不引起 cache 颠簸的前提下,以尽早 trigger cache miss、从而尽早 trigger cache refill 为原则**。

---

## 6. IV / SMR 的复用粒度

K-Major 布局下 IV 与 SMR 复用单元不同:

- **IV 复用单元 128 × 1**——每条 VMM2 取一行 LHS。
- **SMR slice 复用单元 128 × 32**——一个 slice 容纳 32 行 RHS,GEMM 内同一 RHS 复用全程。

K-Major 下相邻两个 GEMM 的复用关系:GEMM0 IV miss + SMR miss(冷启动);**GEMM1 沿 K 方向继续时,IV / SMR 都可以 hit**——前提是 GEMM1 用的 LHS 行 / RHS slice 还没被新 GEMM 的分配挤出 cache。

> 算子要点:GEMM 串的 footprint 重排目标就是让 GEMM(i+1) 尽可能命中 GEMM(i) 留下的 IV 行 / SMR slice;这取决于 GEMM 的 KxN 形状决定的 cache 占用密度——见 §7。

---

## 7. Footprint(以更大颗粒度看待数据)

不同 GEMM 形状下 L0P5 容量决定的 LHS / RHS 同时缓存数(以 FP8、K-Major 为例,K-Major 下 LHS 单元 `[M, K]`、RHS 单元 `[N, K]`):

| 形状 | 计算时间 | IV Cache 支持的 LHS 数 | SMR Cache 支持的 RHS 数 |
| :-- | :-- | :-- | :-- |
| 64 × 128 × 128 | 128 cycle | 5 个 [64, 128] | 3 个 [128, 128] |
| 64 × 64 × 128 | 64 cycle | 5 个 [64, 128] | 6 个 [64, 128] |
| 64 × 64 × 64 | 32 cycle | 10 个 [64, 64] | 12 个 [64, 64] |

在容量给定的前提下,可以把多个 GEMM 串成一个调度窗口,在窗口内调整 GEMM 顺序使得后续 GEMM 命中前一 GEMM 留下的 LHS / RHS。两类控制手段:

### 7.1 控制手段 1:Primo++ 类似用 Mailbox

通过 Primo++ 框架的 Mailbox 机制把多个 GEMM 编排成一个生产 / 消费链,框架在编译期决定 footprint 调度顺序。算子开发只暴露 Mailbox 句柄,不直接管 cache 状态——这是默认推荐路径。

### 7.2 控制手段 2:Footprint Order

直接给硬件传 `footprint_order` 字段(MLI_HINT_GEMM Rs1[15:0],字段定义见 `document/l0p5_invalidation.md` §5.1),由硬件按指定顺序展开 VMM2 拆分序列,从而控制 tag table 的更新节奏 / cache 命中模式。

> 算子要点:**余数 skip 的部分可以用 real-size 的特点发出一个空计算给 S3**,使 footprint order 的生成算法不受到余数尺寸的影响——因为有 SPR `LHS_DIM1_REAL0 / 1 / 2`、`RHS_DIM0_REAL0 / 1 / 2`(完整字段见 `sip4_spr_spec.md`),硬件会按 real0 / real1 / real2 把 padding 区与有效区分开,空计算不会污染 OACC 累加结果。

---

## 8. 控制标量指令带宽

底层 GEMM 计算指令是 64 × 64 × 64,**计算时间只有 32 cycle**。这个时间窗口同时定义了"标量发射端必须每多少 cycle 生成一条 2D 指令"——如果标量发射端跟不上,2D MAC 通路出现空泡,L0P5 命中率再高也跑不满。

避免标量发射成为瓶颈的两条做法:

- **避免重复设定 SPR(`real-size` / `buf-id` 等),特别是没有动态性需求时**——原因:每条 `set_spr` 占一条 SALU slot 发射带宽,串里每条 GEMM 之前都重设一遍 SPR 会让标量发射端被 SPR 写入挤满,无法及时下发 GEMM 本身。`LHS_DIM0_STRIDE` 写入是冗余指令的特例;`real-size` / `buf-id` 同样适用,KxN 形状不变时只在 GEMM 串入口设一次。
- **NACCOVR 切换走"首迭代覆盖 + 后续累加"模式**——循环体内不动态切 NACCOVR 也属于减少 SPR 写入。

---

## 9. 与同 skill 其他文档的关系

- `l0p5_invalidation.md`:L0P5 cache 一致性 / `l0p5_inv` 计数器状态机 / buf_id 编码与规划 / `MLI_HINT_GEMM` Rs1 字段表。本文不重复 buf_id 编码与 `l0p5_inv` 时机,只涉及命中率优化。
- `primo_gemm.md`:matrix_t 模板、gemm_mode 编码、GEMM 形状约束。本文 §7 容量数字与 §8 SPR 写入避免对 GEMM 串编排提供性能层指导。

两个对齐原则,出现矛盾时本文为准:

1. **VMM2 是 cache 查找的最小单元,IV / SMR 独立查找**——本文 §2 / §5 的硬件保证;`l0p5_invalidation.md` §1 描述的 GEMM 整体流水必须在 VMM2 粒度上理解。
2. **不同 KxN 形状下 L0P5 能同时 cache 的 LHS / RHS 数量是固定的**——本文 §7 表是容量上界,不要假设 cache 容量"按需扩展"。
