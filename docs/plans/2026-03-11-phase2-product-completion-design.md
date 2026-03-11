# Adnify 第二阶段功能补齐设计

## Goal

在当前已完成的任务编排、治理、并行执行、回滚与 UI 修复基础上，补齐产品规划中剩余的第二阶段能力：浏览器自动化验证、更丰富的专家模板、更强的验证 Agent，以及更细的模型路由与成本优化，并以最终可验收的产品化闭环为目标，而非以 MVP 为边界。

## Chosen Approach

采用“产品化平衡方案”：继续复用现有任务编排、MCP、specialist profile、proposal review 与 budget governance 架构，不新起一套浏览器执行 runtime。浏览器验证优先走现有 MCP 生态（Playwright/Puppeteer 预置），若能力缺失则显式降级并保留可见状态。模型路由在不破坏现有显式模型配置的前提下，补充基于 specialist、验证模式、风险与预算的默认决策。

## Constraints

- 不推翻现有 orchestrator / execution task / work package 数据模型
- 不引入高侵入性的主进程浏览器自动化执行器
- 显式用户配置优先于自动路由
- 浏览器验证缺失时必须降级，不允许伪造成功
- 所有新增行为都必须有测试覆盖，并纳入最终 build/pack 验证

## Architecture

### 1. Verification mode domain

为执行任务和工作包引入更明确的 verification mode：`static`、`regression`、`browser`。验证模式既可来源于模板，也可由 verifier/reviewer specialist 推断。proposal 上保留验证结果摘要，并在 UI 中清楚展示是否执行了浏览器验证、是否由于环境缺失发生降级。

### 2. Browser verification capability model

新增一个轻量 browser verification service，读取当前 MCP servers state 与已暴露工具能力，识别 Playwright/Puppeteer 是否可用于验证。如果具备浏览器工具，则生成 verifier 使用的结构化提示词；如果不具备，则返回 `unavailable` 原因与建议动作。

### 3. Template expansion

扩展任务模板库，使模板不仅描述 specialist 组合，还能携带：默认执行策略、work package 依赖、推荐 verification mode、适用任务类型。ExecutionTaskComposer 与 TaskTemplatePicker 共享同一模板源，避免硬编码分叉。

### 4. Stronger verifier flow

verifier specialist 从“普通参与者”提升为“策略化验证节点”：
- static：静态检查 / 逻辑核对
- regression：命令/测试回归
- browser：页面流程验证

当验证模式要求更高可信度时，proposal 的默认 `verificationStatus` 由 verifier 结果决定；未完成验证或浏览器验证失败时，优先进入 `require-verification` 或 adjudication，而不是直接 apply。

### 5. Model routing and budget-aware fallback

新增 model routing policy：`manual`、`balanced`、`budget-aware`。路由顺序为：
1. specialist profile 显式模型
2. task / work package 场景化默认映射
3. budget-aware 降级映射
4. 全局默认模型

当预算逼近阈值时，frontend / logic / verifier / reviewer 可自动切换到更便宜或更快的模型；若用户为角色显式指定模型，则不自动覆盖。

## Runtime Flow

1. 用户通过模板或自定义 specialist 创建 execution task
2. 模板决定默认 specialist 阵容、验证模式与依赖关系
3. executor 为每个 work package 解析 specialist profile 与 model routing
4. verifier/reviewer 节点根据 verification mode 执行对应验证
5. browser mode 时先检测 MCP 浏览器能力：
   - 可用：执行浏览器验证提示流
   - 不可用：记录降级状态，并将 proposal 标记为未完成浏览器验证
6. proposal review 根据 verification outcome 与 conflict state 决定 apply / rework / adjudication

## UI Shape

- Task composer / template picker：展示更多模板及适用说明
- Execution task panel：展示 verification mode、browser verification state、degraded reason
- Proposal panel：展示更强的 verification 摘要与阻塞原因
- Agent settings：增加 model routing 策略相关配置入口（保持保守）

## Testing Strategy

- Template service tests：模板扩展、依赖关系、verification mode 赋值
- Browser verification service tests：能力检测、降级原因、提示构造
- Model routing tests：显式模型优先、budget-aware 降级、按 specialist 路由
- Orchestrator executor tests：verifier/browser gating、proposal 状态、adjudication 触发
- UI static tests：template picker / execution panel / proposal panel / settings 文案
- Final verification：`npm test`、`npx tsc -p tsconfig.json --noEmit`、`npm run build`、`npm run pack`、替换 `/Applications/Adnify.app` 冒烟
