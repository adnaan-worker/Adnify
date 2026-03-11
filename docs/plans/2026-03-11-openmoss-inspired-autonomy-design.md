# Adnify OpenMOSS 灵感自治模式设计

## Goal

在不把 Adnify 改造成服务端中台的前提下，吸收 OpenMOSS 对“长任务自治推进、多角色协作、巡查恢复、定时唤醒”的有效思路，补齐 Adnify 当前在长任务连续执行、卡住检测、运行可观测性、恢复与回滚治理方面的短板，使产品更接近“给目标，IDE 自己拆解、执行、回滚、总结”的独立 Agent IDE 形态。

## Chosen Approach

采用“本地优先自治增强方案”：继续复用现有的 execution task、work package、proposal review、rollback、isolated workspace 和 specialist profile 架构，不引入独立服务端，也不新增远程 worker 依赖。新能力通过自治运行层叠加到现有编排器上，包括：执行心跳、巡查 Agent、恢复检查点、自治模式状态机、协调器独立模型配置、诊断 UI 与后台任务入口。

## Constraints

- 保持 Electron 本地桌面产品形态，不拆成前后端中台
- 不推翻现有 `ExecutionTask / WorkPackage / Handoff / Proposal / Rollback` 模型
- 默认安全机制保持开启，自治模式必须可关闭
- 所有自治行为必须可见、可停止、可回滚、可审计
- 不能让多 Agent 并行写入失控，所有权与隔离工作区仍然是硬约束
- 必须控制成本，巡查与自治循环需要预算与熔断保护

## Why Not Direct Integration

OpenMOSS 更像多 Agent 协作中间件 / 平台后端，而 Adnify 当前是桌面 IDE。两者在目标上相关，但在运行形态、状态边界与安全模型上不同。因此不建议直接引入 OpenMOSS 代码或服务，而应抽取其方法论：

- 长任务自治推进
- 多角色职责拆分
- 巡查与恢复机制
- 定时唤醒与后台持续执行
- 明确的人机协作交接点

## Architecture

### 1. Autonomy execution layer

在现有 orchestrator 之上增加一层自治运行层。它不负责生成代码，而负责持续推进一个长任务：

- 读取执行任务与工作包状态
- 为每个运行中的工作包记录心跳、最后输出时间、最后工具活动时间、最近文件变更时间
- 在“长时间无有效进度”时触发巡查
- 在巡查失败或预算逼近时触发暂停、返工、回滚或人工介入

这一层本质上是控制平面，不替代现有 specialist execution。

### 2. Four-role runtime model

参考 OpenMOSS 的角色化协作思路，但压缩为适合单兵 IDE 的四角色：

- Planner：根据目标生成和调整 work packages
- Executor：按 specialist 执行具体工作包
- Reviewer：审核 proposal、验证目标是否达成、决定返工/继续
- Patrol：专门负责卡死检测、异常收敛、恢复建议和超时治理

其中 Patrol 不直接写业务代码，避免“为了恢复而继续脏写”。

### 3. Heartbeat and stuck classification

当前系统能展示“执行中/工具执行中/待机”，但对“是不是假活跃”判断不足。新增心跳域：

- `lastAssistantOutputAt`
- `lastToolActivityAt`
- `lastProgressAt`
- `lastFileMutationAt`
- `silentDurationMs`
- `stuckReason`

巡查器基于这些信号把任务分成：

- active：持续有推进
- silent-but-healthy：短暂无输出但仍有工具/文件活动
- suspected-stuck：长时间无推进
- abandoned：停止/崩溃后遗留运行态

### 4. Recovery checkpoint model

为 execution task 和 work package 增加可恢复检查点，而不是只依赖线程消息：

- 最近成功 proposal / handoff
- 最近已应用的 work package 集合
- 最近已创建并仍有效的隔离工作区
- 最近自治判断（为何暂停 / 为何返工 / 为何需要人工）

恢复时优先复用已经完成的产物和已确认 proposal，而不是简单重跑所有工作包。

### 5. Coordinator and specialist model separation

把“聊天窗默认模型”和“编排协调模型”明确分离。新增至少三类独立配置：

- coordinator model：负责任务拆分、重排、返工决策
- execution default models：各 specialist 的执行模型
- patrol/review model：负责巡查与审查，可偏向低成本但高稳定性模型

这样才真正实现“多 Agent”，而不是所有角色沿用当前对话模型。

### 6. Background autonomy entry

自治模式应支持“前台可见 + 后台持续推进”：

- 当前任务页中可直接切换“聊天执行 / 自治执行”
- 后台自治任务可最小化，不阻塞编辑器主流程
- 后台任务列表显示最近心跳、风险、预算、待用户决定事项
- 后续可接入定时唤醒，但第一阶段不引入完整 automation 系统耦合

### 7. Diagnosis-first UI

为避免再次出现“看起来在执行，实际没反馈”的问题，执行面板优先展示可诊断信息：

- 当前 `workspacePath`
- 当前隔离模式 `copy / worktree / current`
- 当前执行代次 / 本轮运行 ID
- 最近一次有效推进时间
- 是否被 Patrol 标记为 `suspected-stuck`
- 最近一次停止/恢复原因

诊断信息默认展示简版，细节可展开。

## Runtime Flow

1. 用户为目标创建 execution task，并选择“自治执行”
2. Planner 生成或调整 work packages
3. Executor 按所有权与隔离规则执行工作包
4. Heartbeat service 持续写入运行快照
5. Patrol service 定时扫描：
   - 若健康：保持执行
   - 若疑似卡住：生成恢复建议或自动触发保守重试
   - 若预算/循环异常：触发熔断、暂停或 adjudication
6. Reviewer 在 proposal/handoff 节点审核结果
7. 最终生成结构化总结：完成项、未完成项、风险、回滚点、下次建议

## P0 / P1 / P2 Scope

### P0

- 执行心跳与假活跃识别
- Patrol 巡查器与卡住检测
- 停止/恢复/晚到结果防污染治理
- 诊断 UI（workspace、隔离模式、最近心跳、卡住原因）
- 恢复检查点基础版

### P1

- 自治执行模式入口
- coordinator / reviewer / patrol 独立模型配置
- 后台自治任务列表
- 返工 work package 自动生成
- 结构化执行总结

### P2

- 定时唤醒
- 本机多 worker 或远程 worker
- Agent 路由评分与能力画像
- 自治任务模板库沉淀

## Safety and Cost Model

- Patrol 不直接落业务代码，只做状态判断与建议
- 任意自治重试都受 budget ledger 与 circuit breaker 限制
- 停止优先级高于任何自治动作
- 恢复时只允许在有效隔离工作区或明确可重建工作区中继续
- coordinator 的自动重排不能绕过 writable scopes 与 ownership lease

## Testing Strategy

- 类型与状态机测试：自治状态、巡查状态、恢复检查点
- 服务测试：heartbeat、patrol、recovery、autonomy coordinator
- Executor 集成测试：卡住检测、停止后晚到结果、恢复后重跑
- UI 测试：任务页、执行面板、后台任务列表、设置页
- 验收：`npm test`、`npx tsc -p tsconfig.json --noEmit`、`npm run build`、`npm run pack`、替换 `/Applications/Adnify.app` 冒烟
