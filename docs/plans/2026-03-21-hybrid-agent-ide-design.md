# Hybrid Agent IDE Design

**背景**

Adnify 当前已经具备较强的 Agent 执行底座，包括任务编排、工作包、变更提案、验证模式、隔离工作区、受控终端与工作区安全边界。但产品主入口仍然较分散：聊天、编排、Composer、终端、Diff 审核和验证结果尚未收敛成一条稳定主链路。

在已获得对 `/Applications/Codex.app`、`/Applications/Cursor.app`、`/Applications/Kiro.app` 的完全授权前提下，第一阶段目标不是模仿某一个产品的全部形态，而是整合三者的优秀能力，形成 Adnify 自己的混合式 Agent IDE 主流程。

**目标**

在不推翻现有 orchestrator、workspace safety、MCP、LSP 与 terminal 底座的前提下，构建一条清晰的产品主链路：

`任务发起 -> spec/plan -> 执行控制台 -> 补丁审核 -> 验证 -> 完成总结`

第一阶段重点是收敛体验和状态模型，而不是追求单点功能极致。

**非目标**

- 不在第一阶段重做整个编辑器外壳
- 不优先实现复杂的多 Agent 自由协作 UI
- 不在护栏未收紧前引入激进的编辑器内联自动改写
- 不重写主进程安全实现、文件系统边界或终端执行模块
- 不在第一阶段追求完全复刻 Codex / Cursor / Kiro 的全部交互细节

**方案**

## 1. 产品方向：混合最小闭环

第一阶段采用 `Codex + Cursor + Kiro` 的混合最小闭环方案：

- 借鉴 `Codex` 的任务驱动、终端协作与验证闭环
- 借鉴 `Cursor` 的补丁审阅、编辑器融合感与文件级改写体验
- 借鉴 `Kiro` 的 spec / plan / tasks 结构化流转

这个方案的核心不是做三个模式切换，而是统一成一条主链：

1. 用户创建任务并描述目标
2. Agent 先形成 plan，再拆成 work packages
3. 执行过程在统一控制台可见
4. 所有代码改动先进入补丁队列
5. 提交后的验证成为完成门禁

## 2. 核心对象模型

第一阶段不推翻现有 `ExecutionTask` / `WorkPackage` / `ChangeProposal` 类型，而是在其外侧增加产品层聚合对象：

### 2.1 TaskSession

`TaskSession` 是用户可见的主对象，代表一次完整任务会话。包含：

- 用户目标与成功标准
- 当前 trust / execution / verification 策略
- 关联工作区与隔离状态
- 当前活跃 `ExecutionTask`
- 聊天与计划上下文
- Patch 批次与验证摘要
- 最终完成总结

### 2.2 TaskThread

`TaskThread` 是任务会话下的解释层，承接对话、spec、plan、失败原因与裁决记录。它复用现有 thread/message store，不单独引入新型消息系统。

### 2.3 ExecutionRun

`ExecutionRun` 是一次执行实例，承接：

- 当前执行状态
- tool call / terminal / assistant 输出
- heartbeat / patrol / circuit breaker
- verification 结果
- 失败与重试原因

这样同一个 `TaskSession` 可以保留多轮执行，而不把所有输出混成一条消息流。

### 2.4 PatchBatch

`PatchBatch` 是产品层变更批次对象，由多个 `ChangeProposal` 聚合而成。它用于：

- 汇总本轮任务的全部待审改动
- 提供按文件与按 work package 的双重视图
- 支持批量接受、局部接受、退回重做

现有 `ChangeProposal` 继续作为最小审核单元存在，但默认 UI 不再只展示单个 proposal。

## 3. 主交互流

### 3.1 Define

用户创建 `TaskSession`，输入目标、成功标准与上下文。此阶段不直接改代码。

### 3.2 Plan

系统基于任务上下文生成 spec / plan，并形成 `ExecutionTask` 与若干 `WorkPackage`。用户可以确认、修改或中止。

### 3.3 Execute

进入统一 `Execution Console`。该视图整合：

- 当前 specialist / work package
- tool call 状态
- terminal 输出
- 中间验证
- 阻塞与熔断信息

### 3.4 Review

所有代码变更先进入 `PatchBatch` 队列，而不是直接写入主工作区。用户在这里做：

- 批次级预览
- 文件级 Diff 审核
- 应用 / 退回 / 重派 / 丢弃

### 3.5 Verify

任何被接受的补丁都必须自动进入验证。验证模式遵循现有 `static / regression / browser` 体系。

### 3.6 Complete

任务完成页展示：

- 完成摘要
- 关键变更
- 验证证据
- 风险与未完成项
- 是否保留隔离工作区

## 4. UI 形态

第一阶段采用三栏收敛布局：

- 左侧：`Task Board`
  - 任务列表
  - 当前阶段
  - work package 状态
- 中间：主工作区
  - Define / Plan / Execution Console 按阶段切换
- 右侧：审核与结果
  - PatchBatch
  - Verification 摘要
  - 风险与裁决信息

底部终端保持可展开，但其逻辑从“独立工具”调整为“ExecutionRun 的证据层”。

## 5. 护栏模型

第一阶段将现有安全能力提升为用户可理解的 5 道门：

### 5.1 Planning Gate

没有形成 `ExecutionTask + WorkPackage` 前，不进入执行。

### 5.2 Workspace Gate

根据风险、文件范围与命令需求决定是否进入隔离工作区。产品层明确展示当前执行环境，而不做隐式切换。

### 5.3 Execution Gate

命令执行必须继续走受控终端。`safe / balanced / autonomous / manual` trust mode 需要映射到真实可见的执行差异。

### 5.4 Patch Gate

所有变更必须先进入 `ChangeProposal -> PatchBatch -> Review`，不允许绕过提案门禁直接宣告完成。

### 5.5 File + Verify Gate

文件写边界继续由主进程控制。任何 apply 后必须自动进入验证，完成标准是“已应用且已验证”，而不是“已写入”。

## 6. 现有代码的落点

第一阶段尽量复用已有模块：

- 任务/编排类型：`src/renderer/agent/types/taskExecution.ts`
- Agent 状态与线程：`src/renderer/agent/store/AgentStore.ts`
- 执行任务视图：`src/renderer/components/orchestrator/ExecutionTaskPanel.tsx`
- 单 proposal 审核：`src/renderer/components/orchestrator/ChangeProposalPanel.tsx`
- Composer / 多文件改写：`src/renderer/components/panels/ComposerPanel.tsx`
- Trust policy：`src/renderer/agent/types/trustPolicy.ts`
- 隔离工作区：`src/main/security/isolatedWorkspace.ts`
- 安全终端：`src/main/security/secureTerminal.ts`
- 安全文件边界：`src/main/security/secureFile.ts`

## 7. 第一阶段实现顺序

1. 建立 `TaskSession` 聚合层，统一 thread / execution / proposal / verification 入口
2. 引入 `PatchBatch`，把多个 `ChangeProposal` 收敛成批次级审核体验
3. 重组 `Execution Console`，统一 thread、tool、terminal、verification 输出
4. 升级 `ComposerPanel`，让它同时承担任务发起与批量补丁审核角色
5. 最后再调整主界面布局，把 `Task Board / Console / Patch Review` 串成一条主链

## 8. 验证策略

第一阶段测试重点不是视觉细节，而是状态流是否稳定：

- Domain tests：任务、补丁、验证、隔离策略的状态迁移
- Store tests：`TaskSession` 与 `AgentStore` / orchestrator slice 的聚合逻辑
- Panel tests：ExecutionTaskPanel / ChangeProposalPanel / ComposerPanel 的关键交互
- Security integration tests：trust mode、isolated workspace、secure terminal、secure file 的门禁联动
- End-to-end smoke：创建任务、生成计划、产出 proposal、审核 patch、触发验证、结束任务的最小闭环

**结论**

第一阶段不应再把 Adnify 当成“聊天增强型代码编辑器”去补功能，而应把它收敛成“任务驱动、执行可见、补丁受控、验证闭环”的原生 Agent IDE。这样既能吸收 Codex / Cursor / Kiro 的优势，也能最大化复用现有的编排与安全底座。
