# 性能诊断模板与常见误判

主 SKILL.md 给出诊断阶段流程；本 reference 提供算子性能诊断报告模板和常见误判纠正。

## 诊断报告模板

```
# 算子性能诊断报告

## 基本信息
- 算子: <name>
- 目标 shape: <shape>
- 数据类型: <in_dtype→out_dtype>
- 热点 kernel: <kernel_function_name>

## 理论分析
- 总数据量: XX MB (读 XX + 写 XX)
- roofline 口径: 判定式带宽上限(双向 3.0 / 单向 2.5 TB/s)或当前实测 L3 档位
- 理论最小时间: XX us

## 实测数据
- topsprof: Avg=XX us, Min=XX us, Max=XX us
- tcu LLC: Read=XX GB/s, Write=XX GB/s, Total=XX GB/s
- 带宽利用率: XX%

## Bound 类型判定
- 屏蔽实验: Full=XX us, IO-only=XX us, Compute-only=XX us
- Pipeline overhead: XX us (XX%)
- 判定: [IO bound / Compute bound / Pipeline overhead bound]

## 迭代级分析
- N = XX 次/block
- T_io = XX us/iter, T_comp = XX us/iter
- 模型预测: XX us, 实测: XX us, 误差: XX%

## Shape Scaling 验证
| batch | N | data | Avg | BW | util |
|-------|---|------|-----|-----|------|
| ...   |...|  ... | ... | ... | ...  |
- 饱和利用率: XX%

## 结论
- [kernel 已优化到位 / 仍有优化空间]
- 主要瓶颈: [pipeline 深度不足 / DTE 效率 / 计算效率 / ...]
- 推荐优化方向: [具体建议]
```

## 常见误判与纠正

### 误判 1: "注释掉计算后性能提升，说明是 compute bound"

**纠正**：注释掉计算后性能提升只能说明计算时间 > 0，不能直接得出 compute bound。需要同时做 IO-only 实验。如果注释掉 DTE 也能提升，说明是 **均衡型**，两侧都在互相等待（pipeline overhead bound）。

### 误判 2: "DTE event_wait 占 93% 时间，所以 DTE 效率很低"

**纠正**：`event_wait` 是 DTE 硬件正在执行真实搬运的代理指标，不是"低效"。真正的 DTE 低效标志是 `mailbox_wait`（软件空转等待对端子线程通知）。如果 `mailbox_wait` 很小而 `event_wait` 很大，说明 DTE 一直在满负荷工作。

### 误判 3: "利用率只有 XX%，还有 YY% 优化空间"

**纠正**：YY% 的 gap 不全是可消除的。需要用 shape scaling 区分：
- **结构性开销**（pipeline startup/drain）→ 由 N 决定，kernel 无法消除
- **效率损失**（DTE 配置开销、sync overhead）→ 可以微观优化

如果大 shape 下利用率已经接近同类 kernel 或当前 roofline 预期，说明当前 gap 的主要部分来自结构性开销（N 太浅），只有一小部分来自可优化的效率损失。

### 误判 4: "增加 buffer 深度（三缓冲）一定能提升性能"

**纠正**：三缓冲/多缓冲只在以下条件同时满足时有效：
1. 存在可填充的 DTE 结构性空闲（通常是 compute bound 场景）
2. 减小 buffer 后单次 DTE 搬运量仍足够大，不让固定配置开销主导
3. 增加的循环次数不会使 DTE 命令配置和 mailbox 同步的固定开销超过收益

IO bound 场景下，DTE 已满载运行，三缓冲反而因缩小搬运量而回退。

### 误判 5: "HBM 读写互相争抢带宽"

**纠正**：HBM 是全双工的，读和写有独立通道，不争抢。
