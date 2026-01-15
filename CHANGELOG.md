# 更新日志 | Changelog

所有重要更改都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/)，版本号遵循 [Semantic Versioning](https://semver.org/)。

## 贡献者 | Contributors

感谢所有为 Adnify 做出贡献的开发者！

<!-- ALL-CONTRIBUTORS-LIST:START -->
<a href="https://github.com/adnaan-worker"><img src="https://github.com/adnaan-worker.png" width="50" height="50" style="border-radius:50%" alt="adnaan"/></a>
<a href="https://github.com/kerwin2046"><img src="https://github.com/kerwin2046.png" width="50" height="50" style="border-radius:50%" alt="kerwin"/></a>
<!-- ALL-CONTRIBUTORS-LIST:END -->

---

## [1.5.12] - 2026-01-15

### 新增
- 🔄 检查点回滚增强：回滚时恢复附件图片和上下文引用到输入框

### 修复
- 🐛 修复 AI 表格渲染问题，使用 remark-gfm 支持 GFM 表格 (fixes #14)(by @kerwin)

### 优化
- ⬆️ 升级 Electron 到 39.x，修复安全漏洞
- 🔧 升级 diff 和 hono 依赖，修复安全漏洞

### 重构
- 🧠 上下文压缩逻辑整合到 CompressionManager

---

## [1.5.11] - 2026-01-15

### 修复
- 🔧 修复跨平台兼容性：使用 typeof performance 替代 Performance 类型
- 📦 同步 package-lock.json 与 package.json 依赖

### 重构
- 🛡️ 类型安全改进：移除不安全的类型断言 (by @kerwin)
- 🧪 测试重组：重新组织测试结构，增加全面的测试覆盖

---

## [1.5.10] - 2026-01-14

### 新增
- ✨ Agent 富文本内容支持：重构工具执行类型

### 修复
- 🔇 生产环境禁用控制台日志
- ⏱️ 修复更新检查无限挂起问题 (#12)

### 重构
- 🛡️ 类型安全改进：替换 any 类型为具体类型 (by @kerwin)

---

## [1.5.9] - 2026-01-14

### 新增
- 📟 终端增强：添加 PTY 退出和错误事件处理

### 修复
- ⏱️ 修复更新检查挂起问题
- 🔧 改进路径处理和结果验证，增强日志记录

### 优化
- 🍎 CI 发布：重命名 macOS arm64 发布文件以保持一致性

---

## [1.5.8] - 2026-01-14

### 修复
- 🔒 改进路径验证和文件截断处理

---

## [1.5.7] - 2026-01-14

### 修复
- 🔀 改进 Git 分支检测：添加回退方法和重试逻辑
- 🐛 修复提示词预览和 MiniMax 2.1 think 标签显示问题 (by @kerwin)

### 重构
- 🏗️ Agent 工具执行优化：审批工作流和快照管理
- 🛡️ 类型安全：替换 any 类型为具体类型 (by @kerwin)
- 📝 日志统一：替换 console 调用为统一 Logger (by @kerwin)
- 📋 Prompt 系统重组：整合类型定义

---

## [1.5.6] - 2026-01-14

### 新增
- 🛠️ Agent 工具执行优化：新增审批工作流和快照管理
- 🎯 动态工具过滤：根据工作模式和角色模板过滤可用工具
- 📝 Agent 指南增强：完善工具使用文档

### 重构
- 🏗️ Agent 架构重组：新增核心循环和上下文压缩
- 🧠 上下文压缩增强：统一管理器和改进的统计信息
- 📋 Prompt 系统重组：整合类型定义
- 🔧 ToolCallCard 组件简化：增强配置

### 修复
- 🐛 修复提示词预览和 MiniMax 2.1 think 标签显示问题
- 🔧 修复 Git 分支获取失败时显示 HEAD 的问题

### 优化
- 🛡️ 类型安全：替换 any 类型为具体类型 (by @kerwin)
- 📝 日志统一：替换 console 调用为统一 Logger (by @kerwin)

## [1.5.5] - 2026-01-13

### 新增
- 📖 Agent 指南增强：完善工具使用文档

### 修复
- 🔧 Monaco 类型修复和配置覆盖说明 (by @kerwin)

## [1.5.4] - 2026-01-12

### 新增
- 🤖 Agent 指南增强：改进文件处理
- 🔄 Google Generative AI SDK 升级：增强消息处理
- 🎨 GPT Tokenizer：增强上下文管理
- 📥 API 导入向导：提供商配置解析器
- 🎯 ask_user 工具：计划模式工作流指南

### 重构
- 🛡️ TypeScript 优化：移除不安全的 any，添加类型守卫 (by @kerwin)
- ⚡ App 组件性能优化 (by @kerwin)

### 修复
- 🔧 更新安装增强：日志和延迟执行
- 📦 CI 发布：处理多架构更新元数据文件

## [1.5.2] - 2026-01-12

### 新增
- 📚 社区指南：添加贡献模板

## [1.5.1] - 2026-01-10

### 修复
- 🔧 修复 CI 构建内存溢出问题，降级 electron-builder 确保稳定性
- 🎨 修复 Regenerate 按钮弹出框位置和国际化问题
- 📝 修复 AI 编辑文件后的"外部修改"对话框问题
- 🔌 修复 Monaco Editor v0.55 InlineCompletions API 兼容性

## [1.5.0] - 2026-01-10

### 新增
- 🔄 自动更新系统：支持在线检查更新，安装版自动下载安装，便携版提示手动下载
- 🧠 上下文压缩优化：4 级压缩策略，L4 自动切换新会话并携带摘要继续对话
- 📊 压缩状态可视化：状态栏显示压缩级别和进度动画

## [1.4.0] - 2026-01-09

### 新增
- 🖼️ 视觉能力：LLM 支持图片输入，消息适配器重构
- ✨ UI 增强：卡片 shimmer 效果、滚动阴影、毛玻璃面板优化

### 重构
- 🏗️ Agent 架构重构：统一上下文管理，优化 Prompt 系统和记忆管理

## [1.3.8] - 2026-01-06

### 修复
- 🛠️ 修复 Deno LSP 错误注册问题，TypeScript 项目不再误触发 Deno
- 📋 生产环境自动禁用控制台日志，支持环境检测
- 🔄 修复 MCP 服务重复初始化问题

### 重构
- 🔧 类型系统重构：统一 `@shared/types` 为类型单一来源

## [1.3.7] - 2026-01-05

### 新增
- 🌳 Tree-sitter 扩展：新增 20+ 语言的语法解析支持
- 📁 LSP 服务器目录：支持自定义 LSP 服务器安装路径
- 🔍 智能根目录检测：LSP 自动识别 monorepo 子项目根目录
- 📊 状态栏 LSP 指示器：显示当前文件的 LSP 服务器状态

## [1.3.0] - 2026-01-02

### 新增
- 🎯 模型选择器重构：聊天面板新增模型/模式下拉选择器
- ✨ 自定义 Embedding 提供商：支持配置自定义 Embedding API
- 🔍 混合搜索 (Hybrid Search)：实现 RRF 结果融合
- ⚡ Embedding 限流：添加速率限制和重试机制

### 重构
- 🏗️ Provider 架构统一：重构厂商配置存储
- 🛠️ Result 类型：统一 IPC 处理器返回类型
- 📝 Editor 组件拆分：提取子组件

### 优化
- 🚀 流式缓冲优化：使用 requestAnimationFrame 优化刷新

## [1.2.9] - 2026-01-01

### 新增
- 🔌 MCP 协议支持：集成 Model Context Protocol
- 📄 MCP 富文本渲染：工具执行结果支持 Markdown/图片/表格
- 🎯 UI/UX 设计系统：新增设计系统数据库和工具集成

## [1.2.8] - 2025-12-31

### 安全
- 🔒 优化文件监听器和终端命令执行安全性

## [1.2.7] - 2025-12-31

### 重构
- 🍞 Toast 系统重构：全新的通知提示系统
