# Adnify 项目架构重构计划

## 一、问题分析

### 1.1 目录结构问题
- 组件分散在 `components/` 根目录，缺乏功能分组
- `agent/` 目录职责过重，包含 core、tools、types 等多个子系统
- `services/` 目录扁平化，缺乏分类

### 1.2 大型文件问题
| 文件 | 行数 | 问题 |
|------|------|------|
| `Sidebar.tsx` | ~1938 | 包含文件树、Git、大纲、问题面板等多个功能 |
| `SettingsModal.tsx` | ~1935 | 包含 7+ 个设置标签页的所有逻辑 |
| `AgentService.ts` | ~1656 | Agent 核心逻辑过于集中 |

### 1.3 路径引用问题
- 80+ 文件使用相对路径 `../`
- 部分使用 `@/` 别名
- 不一致导致维护困难

### 1.4 日志系统问题
- 已有 `Logger.ts` 但未统一使用
- 60+ 文件直接使用 `console.log/warn/error`

---

## 二、重构方案

### 2.1 目录结构重组

```
src/
├── main/                          # Electron 主进程 (保持不变)
│   ├── indexing/
│   ├── ipc/
│   ├── security/
│   ├── services/
│   └── utils/
│
├── renderer/                      # 渲染进程
│   ├── app/                       # 应用入口
│   │   ├── App.tsx
│   │   └── main.tsx
│   │
│   ├── components/                # UI 组件 (按功能分组)
│   │   ├── common/                # 通用组件
│   │   │   ├── ErrorBoundary.tsx
│   │   │   ├── ConfirmDialog.tsx
│   │   │   └── ToastProvider.tsx
│   │   │
│   │   ├── layout/                # 布局组件
│   │   │   ├── TitleBar.tsx
│   │   │   ├── StatusBar.tsx
│   │   │   └── ActivityBar.tsx
│   │   │
│   │   ├── sidebar/               # 侧边栏 (从 Sidebar.tsx 拆分)
│   │   │   ├── Sidebar.tsx        # 容器组件
│   │   │   ├── FileExplorer/
│   │   │   │   ├── FileTree.tsx
│   │   │   │   ├── FileTreeItem.tsx
│   │   │   │   └── FileActions.tsx
│   │   │   ├── GitPanel/
│   │   │   │   ├── GitPanel.tsx
│   │   │   │   ├── GitChanges.tsx
│   │   │   │   └── GitHistory.tsx
│   │   │   ├── OutlinePanel.tsx
│   │   │   ├── ProblemsPanel.tsx
│   │   │   └── SearchPanel.tsx
│   │   │
│   │   ├── editor/                # 编辑器相关
│   │   │   ├── Editor.tsx
│   │   │   ├── EditorContextMenu.tsx
│   │   │   ├── DiffViewer.tsx
│   │   │   └── InlineEdit.tsx
│   │   │
│   │   ├── settings/              # 设置 (从 SettingsModal.tsx 拆分)
│   │   │   ├── SettingsModal.tsx  # 容器组件
│   │   │   ├── tabs/
│   │   │   │   ├── ProviderTab.tsx
│   │   │   │   ├── EditorTab.tsx
│   │   │   │   ├── AgentTab.tsx
│   │   │   │   ├── KeybindingsTab.tsx
│   │   │   │   ├── IndexingTab.tsx
│   │   │   │   ├── SecurityTab.tsx
│   │   │   │   └── SystemTab.tsx
│   │   │   └── components/
│   │   │       ├── ProviderSelector.tsx
│   │   │       └── ModelSelector.tsx
│   │   │
│   │   ├── chat/                  # 聊天组件 (已存在)
│   │   ├── agent/                 # Agent UI 组件 (已存在)
│   │   └── ui/                    # 基础 UI 组件 (已存在)
│   │
│   ├── features/                  # 功能模块
│   │   ├── agent/                 # Agent 功能
│   │   │   ├── core/              # 核心逻辑
│   │   │   │   ├── AgentService.ts      # 拆分后的主服务
│   │   │   │   ├── AgentExecutor.ts     # 执行逻辑
│   │   │   │   ├── AgentMessageHandler.ts
│   │   │   │   └── AgentStreamHandler.ts
│   │   │   ├── tools/
│   │   │   ├── context/
│   │   │   └── store/
│   │   │
│   │   └── plan/                  # 计划功能 (已存在)
│   │
│   ├── services/                  # 服务层 (按功能分类)
│   │   ├── lsp/                   # LSP 相关
│   │   │   ├── lspService.ts
│   │   │   └── lspProviders.ts
│   │   ├── completion/            # 代码补全
│   │   │   └── completionService.ts
│   │   ├── storage/               # 存储相关
│   │   │   ├── settingsService.ts
│   │   │   ├── projectStorageService.ts
│   │   │   └── workspaceStateService.ts
│   │   └── file/                  # 文件相关
│   │       ├── ignoreService.ts
│   │       ├── largeFileService.ts
│   │       └── directoryCacheService.ts
│   │
│   ├── store/                     # 状态管理 (保持不变)
│   ├── hooks/                     # Hooks (保持不变)
│   ├── config/                    # 配置 (保持不变)
│   ├── i18n/                      # 国际化 (保持不变)
│   ├── types/                     # 类型定义 (保持不变)
│   ├── utils/                     # 工具函数 (保持不变)
│   └── styles/                    # 样式 (保持不变)
│
└── shared/                        # 共享代码 (保持不变)
    ├── config/
    ├── types/
    └── utils/
```

### 2.2 大文件拆分策略

#### Sidebar.tsx 拆分方案
```
components/sidebar/
├── Sidebar.tsx              # 主容器，管理面板切换
├── SidebarHeader.tsx        # 顶部工具栏
├── panels/
│   ├── FileExplorer/
│   │   ├── index.tsx        # 导出
│   │   ├── FileTree.tsx     # 文件树组件
│   │   ├── FileTreeItem.tsx # 单个文件/文件夹项
│   │   ├── FileActions.tsx  # 文件操作（新建、删除等）
│   │   └── hooks/
│   │       └── useFileTree.ts
│   ├── GitPanel/
│   │   ├── index.tsx
│   │   ├── GitChanges.tsx   # 变更列表
│   │   ├── GitHistory.tsx   # 提交历史
│   │   └── GitActions.tsx   # Git 操作按钮
│   ├── OutlinePanel.tsx     # 大纲面板
│   ├── ProblemsPanel.tsx    # 问题面板
│   └── SearchPanel.tsx      # 搜索面板
└── hooks/
    └── useSidebarState.ts
```

#### SettingsModal.tsx 拆分方案
```
components/settings/
├── SettingsModal.tsx        # 主容器
├── SettingsNav.tsx          # 左侧导航
├── tabs/
│   ├── ProviderTab/
│   │   ├── index.tsx
│   │   ├── ProviderSelector.tsx
│   │   ├── ModelConfig.tsx
│   │   └── ApiKeyInput.tsx
│   ├── EditorTab/
│   │   ├── index.tsx
│   │   ├── FontSettings.tsx
│   │   ├── ThemeSettings.tsx
│   │   └── CompletionSettings.tsx
│   ├── AgentTab.tsx
│   ├── KeybindingsTab.tsx
│   ├── IndexingTab.tsx
│   ├── SecurityTab.tsx
│   └── SystemTab.tsx
└── hooks/
    └── useSettingsForm.ts
```

#### AgentService.ts 拆分方案
```
features/agent/core/
├── AgentService.ts          # 主服务（精简后）
├── AgentExecutor.ts         # 执行逻辑
├── AgentMessageHandler.ts   # 消息处理
├── AgentStreamHandler.ts    # 流式响应处理
├── AgentToolHandler.ts      # 工具调用处理
└── AgentContextManager.ts   # 上下文管理
```

### 2.3 路径别名统一

#### tsconfig.json 配置
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@main/*": ["src/main/*"],
      "@renderer/*": ["src/renderer/*"],
      "@shared/*": ["src/shared/*"],
      "@components/*": ["src/renderer/components/*"],
      "@features/*": ["src/renderer/features/*"],
      "@services/*": ["src/renderer/services/*"],
      "@store/*": ["src/renderer/store/*"],
      "@hooks/*": ["src/renderer/hooks/*"],
      "@utils/*": ["src/renderer/utils/*"],
      "@types/*": ["src/renderer/types/*"]
    }
  }
}
```

#### vite.config.ts 配置
```typescript
resolve: {
  alias: {
    '@': path.resolve(__dirname, './src'),
    '@main': path.resolve(__dirname, './src/main'),
    '@renderer': path.resolve(__dirname, './src/renderer'),
    '@shared': path.resolve(__dirname, './src/shared'),
    '@components': path.resolve(__dirname, './src/renderer/components'),
    '@features': path.resolve(__dirname, './src/renderer/features'),
    '@services': path.resolve(__dirname, './src/renderer/services'),
    '@store': path.resolve(__dirname, './src/renderer/store'),
    '@hooks': path.resolve(__dirname, './src/renderer/hooks'),
    '@utils': path.resolve(__dirname, './src/renderer/utils'),
    '@types': path.resolve(__dirname, './src/renderer/types'),
  }
}
```

### 2.4 日志系统统一

#### 增强 Logger
```typescript
// src/shared/utils/Logger.ts

export type LogCategory = 
  | 'Agent' | 'LLM' | 'Tool' | 'LSP' | 'UI' | 'System' 
  | 'Completion' | 'Store' | 'File' | 'Git' | 'IPC' | 'Index'

// 添加 Main 进程支持
class Logger {
  private isMain = typeof window === 'undefined'
  
  // ... 现有实现
  
  // 添加文件日志支持（Main 进程）
  private writeToFile(entry: LogEntry): void {
    if (this.isMain && this.fileLoggingEnabled) {
      // 写入日志文件
    }
  }
}

export const logger = new Logger()
```

#### 迁移脚本
创建 ESLint 规则禁止直接使用 console：
```javascript
// .eslintrc.js
rules: {
  'no-console': ['error', { allow: [] }],
  // 或使用自定义规则强制使用 logger
}
```

---

## 三、实施计划

### Phase 1: 基础设施 ✅ 已完成
1. ✅ 更新 tsconfig.json 路径别名
2. ✅ 更新 vite.config.ts 路径别名（含 electron 配置）
3. ✅ 更新 tsconfig.main.json 路径别名
4. ✅ 更新 vitest.config.ts 路径别名
5. ✅ 统一 Logger 到 shared/utils（支持多参数）

### Phase 2: 路径迁移 ✅ 已完成
1. ✅ 批量替换相对路径为别名路径（153 处）
2. ✅ 修复 @types 别名冲突，改用 @app-types
3. ✅ 添加 @store 无斜杠别名支持

### Phase 3: 日志迁移 ✅ 已完成
1. ✅ 替换所有 console.* 为 logger.*（277 处）
2. ✅ 自动添加 logger 导入（63 个文件）
3. ✅ 根据文件路径自动推断日志分类

### Phase 4: 组件拆分 ✅ 已完成

Sidebar.tsx 拆分完成：
- ✅ 创建目录结构 `components/sidebar/`
- ✅ 创建 `utils.ts` 工具函数
- ✅ 创建 `components/InlineCreateInput.tsx`
- ✅ 创建 `components/FileTreeItem.tsx`
- ✅ 创建 `panels/ExplorerView.tsx` (262 行)
- ✅ 创建 `panels/SearchView.tsx` (435 行)
- ✅ 创建 `panels/GitView.tsx` (491 行)
- ✅ 创建 `panels/ProblemsView.tsx` (186 行)
- ✅ 创建 `panels/OutlineView.tsx` (170 行)
- ✅ 创建 `panels/HistoryView.tsx`
- ✅ 创建新的 `Sidebar.tsx` 主组件 (30 行)
- ✅ 更新 `index.ts` 导出
- ✅ 更新 `App.tsx` 导入路径
- ✅ 删除旧的 `Sidebar.tsx` (1938 行)

SettingsModal.tsx 拆分完成：
- ✅ 创建目录结构 `components/settings/`
- ✅ 创建 `types.ts` 共享类型定义
- ✅ 创建 `tabs/ProviderSettings.tsx`
- ✅ 创建 `tabs/EditorSettings.tsx`
- ✅ 创建 `tabs/AgentSettings.tsx`
- ✅ 创建 `tabs/PromptPreviewModal.tsx`
- ✅ 创建 `tabs/SecuritySettings.tsx`
- ✅ 创建 `tabs/IndexSettings.tsx`
- ✅ 创建 `tabs/SystemSettings.tsx`
- ✅ 创建 `tabs/index.ts` 导出
- ✅ 创建新的 `SettingsModal.tsx` 主组件 (~180 行)
- ✅ 更新 `App.tsx` 导入路径
- ✅ 删除旧的 `SettingsModal.tsx` (1936 行)
- ✅ 构建通过
- ✅ 测试通过

### Phase 5: AgentService 拆分 ✅ 已完成

AgentService.ts (~1656 行) 拆分完成：

**新增模块：**
- ✅ `AgentConfig.ts` (~80 行) - 配置管理
  - `getAgentConfig()` - 动态配置获取
  - `READ_TOOLS` - 只读工具列表
  - `RETRYABLE_ERROR_CODES` - 可重试错误码
  - `isRetryableError()` - 错误重试判断
  
- ✅ `LLMStreamHandler.ts` (~350 行) - 流式响应处理
  - `StreamHandlerState` - 流式状态管理
  - `handleTextChunk()` - 文本块处理
  - `handleReasoningChunk()` - 推理内容处理
  - `handleToolCallStart/Delta/End()` - 工具调用流式处理
  - `handleLLMDone()` - 完成事件处理
  - `detectStreamingXMLToolCalls()` - XML 工具调用检测
  
- ✅ `ContextBuilder.ts` (~250 行) - 上下文构建
  - `buildContextContent()` - 构建上下文内容
  - `buildUserContent()` - 构建用户消息
  - `calculateContextStats()` - 计算上下文统计

**已有模块（保持不变）：**
- `MessageBuilder.ts` - 消息构建
- `MessageConverter.ts` - 消息格式转换
- `StreamingBuffer.ts` - 流式缓冲
- `ToolExecutor.ts` - 工具执行
- `ContextCompression.ts` - 上下文压缩
- `XMLToolParser.ts` - XML 工具解析

**重构后 AgentService.ts：**
- 原始行数：~1656 行
- 重构后行数：~705 行
- 减少：~57%

**删除的重复代码：**
- 移除了顶层 `compressMessages()` 函数（与 ContextCompression.ts 重复）
- 移除了 `getConfig()` 函数（移至 AgentConfig.ts）
- 移除了流式事件处理逻辑（移至 LLMStreamHandler.ts）
- 移除了上下文构建逻辑（移至 ContextBuilder.ts）

### Phase 6: 清理与优化 ✅ 已完成

**TypeScript 错误修复：**
- ✅ 修复 `index.ts` 类型导出（使用 `export type`）
- ✅ 修复 `createPlanSlice.ts` 缺少的 `PlanStatus`/`PlanItemStatus` 导出
- ✅ 在 `types.ts` 中添加 `PlanStatus` 和 `PlanItemStatus` 枚举
- ✅ 修复 `AgentStore.ts` 类型推断问题（添加类型断言）
- ✅ 移除 `promptTemplates.ts` 未使用的 logger 导入
- ✅ 移除 `ChatPanel.tsx` 未使用的变量（clearContextItems, handleSlashCommand）
- ✅ 移除 `PlanPreview.tsx` 未使用的 id 变量
- ✅ 移除 `ToolCallGroup.tsx` 未使用的 CheckCircle2 导入

**冗余代码清理：**
- ✅ 删除 `MessageBuilder.ts`（与 ContextBuilder.ts 功能重复）
- ✅ 移除 `enums.ts` 中重复的 PlanStatus/PlanItemStatus（已在 types.ts 定义）

**已删除的未使用模块：**
- ✅ `src/renderer/features/agent/` - 未使用的重导出模块
- ✅ `src/renderer/agent/types/` - 未使用的重导出模块
- ✅ `src/renderer/hooks/agent/` - 未使用的 llmClient
- ✅ `src/renderer/plan/` - 未集成的 Plan 模块（与 agent/core/types.ts 重复）
- ✅ `src/renderer/agent/core/PlanManager.ts` - 未使用
- ✅ `src/renderer/agent/core/UndoService.ts` - 未使用
- ✅ `src/renderer/agent/core/toolRegistry.ts` - 未使用
- ✅ `src/renderer/agent/core/ElectronEnvironment.ts` - 未使用
- ✅ `src/renderer/agent/core/interfaces.ts` - 未使用
- ✅ `src/renderer/agent/core/ContextCompression.ts` - 未使用（与 ContextCompressor.ts 功能重复）

---

## 四、已完成的重构统计

| 项目 | 数量 |
|------|------|
| 路径迁移文件 | 63 |
| 路径替换次数 | 153 |
| 日志迁移文件 | 63 |
| console 替换次数 | 277 |
| 新增 logger 导入 | 63 |
| Sidebar 拆分组件 | 10 |
| 原 Sidebar.tsx 行数 | 1938 → 30 |
| SettingsModal 拆分组件 | 9 |
| 原 SettingsModal.tsx 行数 | 1936 → 180 |
| AgentService 新增模块 | 3 |
| 原 AgentService.ts 行数 | 1656 → 705 |
| TypeScript 错误修复 | 12 |
| 删除冗余文件 | 1 |
| 删除未使用模块 | 10 |
| 删除空目录 | 4 |

## 五、路径别名配置

| 别名 | 路径 | 说明 |
|------|------|------|
| `@/*` | `src/*` | 通用 |
| `@main/*` | `src/main/*` | Main 进程 |
| `@renderer/*` | `src/renderer/*` | Renderer 进程 |
| `@shared/*` | `src/shared/*` | 共享代码 |
| `@components/*` | `src/renderer/components/*` | 组件 |
| `@features/*` | `src/renderer/features/*` | 功能模块 |
| `@services/*` | `src/renderer/services/*` | 服务 |
| `@store` | `src/renderer/store` | 状态管理 |
| `@hooks/*` | `src/renderer/hooks/*` | Hooks |
| `@utils/*` | `src/renderer/utils/*` | 工具函数 |
| `@app-types/*` | `src/renderer/types/*` | 类型定义 |

## 六、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 大量文件变更导致合并冲突 | 高 | 分阶段提交，每阶段独立 PR |
| 循环依赖 | 中 | 使用依赖分析工具，提前识别 |
| 运行时错误 | 高 | 每次变更后运行测试 |
| 性能回归 | 低 | 监控构建时间和包大小 |

---

## 七、验收标准

- [x] 所有测试通过
- [x] 构建成功
- [x] TypeScript 无错误 (`npx tsc --noEmit` 通过)
- [x] 所有导入使用路径别名
- [x] Sidebar.tsx 拆分完成 (1938 → 30 行)
- [x] SettingsModal.tsx 拆分完成 (1936 → 180 行)
- [x] AgentService.ts 拆分完成 (1656 → 705 行)
- [x] 冗余代码清理完成
- [x] SettingsModal.tsx 拆分完成 (1936 → 170 行)
- [x] AgentService.ts 拆分完成 (1656 → 705 行，新增 3 个模块)
