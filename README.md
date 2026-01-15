# Adnify

> **Connect AI to Your Code.**
> 一个拥有极致视觉体验、深度集成 AI Agent 的下一代代码编辑器。

![License](https://img.shields.io/badge/license-Custom%20License-blue.svg) ![Electron](https://img.shields.io/badge/Electron-39.0-blueviolet) ![React](https://img.shields.io/badge/React-18-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)

Adnify 不仅仅是一个编辑器，它是你的**智能编程伴侣**。它复刻并超越了传统 IDE 的体验，融合了 Cyberpunk 玻璃拟态设计风格，内置强大的 AI Agent，支持从代码生成到文件操作的全流程自动化。

<!-- 主界面截图 -->
![alt text](images/main.png)

---

## 联系与交流

欢迎加入交流群，一起讨论 Adnify 的使用和开发！

| 微信群 | QQ 群 | 作者微信 |
|:---:|:---:|:---:|
| ![微信群二维码](images/wechat-group.png) | ![QQ群二维码](images/qq-group.png) | ![作者微信](images/wechat-author.png) |
| 扫码加入微信群 | QQ群号: `1076926858` | 微信号: `adnaan_worker` |

> 💡 如有问题或建议，也可以直接在 [Gitee Issues](https://gitee.com/adnaan/adnify/issues) 或[Github Issues](https://github.com/adnaan-worker/adnify/issues)  提交

---

📋 **[查看完整更新日志 →](CHANGELOG.md)**

---

## 目录

- [核心特性](#-核心特性)
- [独特优势](#-独特优势对比-cursorwindsurfclaude-code)
- [快速开始](#-快速开始)
- [功能详解](#-功能详解)
- [快捷键](#-快捷键)
- [项目结构](#-项目结构)
- [贡献与反馈](#-贡献与反馈)

---

## ✨ 核心特性

### 🎨 极致视觉体验

- **多主题支持**: 内置 4 套精心设计的主题
  - `Adnify Dark` - 默认深色主题，柔和护眼
  - `Midnight` - 深邃午夜蓝，专注编码
  - `Cyberpunk` - 霓虹赛博朋克风格
  - `Dawn` - 明亮日间主题

- **玻璃拟态设计**: 全局采用毛玻璃风格，配合微妙的流光边框和动态阴影
- **沉浸式布局**: 无框窗口、Chrome 风格标签页、面包屑导航

![alt text](image.png)
![alt text](images/theme2.png)

### 🤖 AI Agent 深度集成

- **三种工作模式**:
  - **Chat Mode** 💬: 纯对话模式，快速问答，无工具调用
  - **Agent Mode** 🤖: 智能代理模式，单次任务执行，拥有完整的文件系统和终端操作权限
  - **Plan Mode** 📋: 项目级开发模式，分步规划，自动追踪任务进度

- **23 个内置工具**: AI 可自主调用的完整工具集
  - 文件读取: `read_file`, `read_multiple_files`, `list_directory`, `get_dir_tree`
  - 文件写入: `write_file`, `edit_file`, `replace_file_content`, `create_file_or_folder`, `delete_file_or_folder`
  - 搜索功能: `search_files`, `codebase_search`
  - LSP 分析: `find_references`, `go_to_definition`, `get_hover_info`, `get_document_symbols`, `get_lint_errors`
  - 终端执行: `run_command`
  - 网络功能: `web_search`, `read_url`
  - 任务规划: `create_plan`, `update_plan` (Plan Mode 专用)
  - UI/UX 设计: `uiux_search` (设计知识库搜索)

- **智能上下文**:
  - `@文件名` 引用文件上下文
  - `@codebase` 语义搜索代码库
  - `@git` 引用 Git 变更
  - `@terminal` 引用终端输出
  - `@symbols` 引用当前文件符号
  - `@web` 网络搜索
  - 拖拽文件/文件夹到对话框

- **多 LLM 支持**: OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Ollama, 自定义 API
- **快速模型切换**: 聊天面板底部下拉选择器，按厂商分组快速切换模型
- **MCP 协议支持**: 集成 Model Context Protocol，支持外部工具扩展
- **MCP 富文本渲染**: 工具执行结果支持 Markdown、图片、表格等富文本展示

![alt text](images/tool.png)

### 🚀 独特优势（对比 Cursor/Windsurf/Claude Code）

#### 🔄 9 策略智能替换（Smart Replace）
AI 编辑代码时，主流工具经常因为空白、缩进差异导致替换失败。Adnify 实现了 **9 种容错匹配策略**，按优先级自动尝试：
1. **精确匹配** - 完全一致
2. **行首尾空白忽略** - 忽略每行首尾空白
3. **块锚点匹配** - 首尾行锚定 + 中间相似度匹配
4. **空白归一化** - 连续空白归一为单空格
5. **缩进灵活匹配** - 移除最小公共缩进后匹配
6. **转义字符归一化** - 处理 `\n`, `\t` 等转义差异
7. **首尾修剪匹配** - 整体 trim 后匹配
8. **上下文感知匹配** - 首尾锚点 + 50% 中间行匹配
9. **多次出现匹配** - 支持 replaceAll

> 💡 这意味着 AI 即使给出的代码有轻微格式差异，也能成功应用修改，大幅提升编辑成功率。

#### ⚡ 智能并行工具执行（Parallel Tool Executor）
主流工具通常串行执行所有工具调用。Adnify 实现了**依赖感知的并行执行**：
- 自动分析工具间的依赖关系
- 独立的读操作并行执行
- 不同文件的写操作可并行
- 同一文件的写操作保持串行
- 写后读依赖自动检测

> 💡 多文件操作时速度提升 2-5 倍，同时保证数据一致性。

#### 🧠 4 级上下文压缩（Context Compression）
长对话时，主流工具要么截断历史，要么直接报错。Adnify 实现了**渐进式 4 级压缩**：
- **L1**: 移除冗余工具结果
- **L2**: 压缩旧消息，保留关键信息
- **L3**: 生成对话摘要
- **L4**: 自动创建新会话 + Handoff 文档，无缝继续任务

> 💡 支持真正的超长对话，任务不会因为上下文溢出而中断。

#### 📸 检查点系统（Checkpoint System）
AI 修改代码前自动创建文件快照，支持：
- 按消息粒度回滚
- 可配置保留策略（数量、时间、文件大小）
- 项目级存储（`.adnify/sessions.json`）
- 查看任意检查点的文件内容
- 对比两个检查点之间的变化

> 💡 比 Git 更细粒度的版本控制，AI 改错了一键回滚。

#### 🌿 对话分支（Conversation Branching）
从任意消息创建分支，探索不同方案：
- 可视化分支管理
- 分支重命名、删除
- 快速切换主线/分支
- 保留完整对话历史

> 💡 类似 Git 分支，但用于 AI 对话，方便对比不同实现方案。

#### 🔁 智能循环检测（Loop Detection）
AI 有时会陷入重复操作的死循环。Adnify 实现了**多维度循环检测**：
- 工具调用模式检测
- 文件内容变化追踪
- 相似度阈值判断
- 自动中断 + 建议

> 💡 避免 Token 浪费，及时发现并中断无效循环。

#### 🩺 自动错误修复（Auto Fix）
Agent 执行后自动检测代码错误：
- 调用 LSP 获取诊断信息
- 检测编译/语法错误
- 自动注入修复提示
- 支持开关配置

> 💡 AI 改完代码后自动检查，发现问题立即修复。

#### 💾 AI 记忆系统（Memory Service）
参考 Cursor Notepad / Claude Code Memory 设计：
- 用户手动添加项目级记忆
- 全量注入到上下文
- 支持启用/禁用单条记忆
- 项目级存储（`.adnify/memory.json`）

> 💡 让 AI 记住项目的特殊约定和偏好。

#### 🎬 流式编辑预览（Streaming Edit）
AI 生成代码时实时显示 Diff：
- 增量内容更新
- 多文件同时预览
- 全局状态订阅
- 与 Composer 集成

> 💡 不用等 AI 写完，边生成边预览变更。

#### 🎭 角色定制工具（Role-based Tools）
不同角色/模板可以拥有专属工具集：
- **模式分层**: Chat（无工具）→ Agent（核心工具）→ Plan（+计划工具）
- **角色扩展**: 在模式基础上添加角色专属工具
- **内置角色**: UI/UX 设计师（`uiux_search` 设计知识库）
- **可扩展**: 通过 `registerTemplateTools` 注册自定义角色工具

```typescript
// 示例：为 uiux-designer 角色添加专属工具
registerTemplateTools('uiux-designer', { toolGroups: ['uiux'] })
```

> 💡 让 AI 根据角色获得不同能力，前端开发者和后端开发者可以有不同的工具集。

### 📝 专业代码编辑

- **Monaco Editor**: VS Code 同款编辑器内核
- **多语言 LSP 支持**: 
  - TypeScript/JavaScript (tsserver)
  - Python (Pyright)
  - Go (gopls)
  - Rust (rust-analyzer)
  - C/C++ (clangd)
  - HTML/CSS/JSON
  - Vue (Volar)
  - Zig (zls)
  - C# (csharp-ls)
  
- **LSP 功能**:
  - 智能补全
  - 悬停提示 (Hover Info)
  - 跳转定义 (Go to Definition)
  - 查找引用 (Find References)
  - 调用层次 (Call Hierarchy)
  - 签名帮助
  - 代码诊断
  - 代码格式化
  - 重命名符号

- **智能根目录检测**: 自动识别 monorepo 子项目，为每个子项目启动独立 LSP
- **LSP 服务器管理**: 支持自定义安装目录，一键安装缺失的语言服务器
- **AI 代码补全**: 基于上下文的智能代码建议（Ghost Text）
- **内联编辑 (Ctrl+K)**: 选中代码后直接让 AI 修改
- **Diff 预览**: AI 修改代码前显示差异对比，支持接受/拒绝
- **编辑器右键菜单**: 快速访问常用操作
- **自动保存**: 可配置的自动保存功能
- **格式化保存**: 保存时自动格式化代码

[text](README.md) ![text](images/editor.png)

### 🔍 强大的搜索功能

- **快速打开 (Ctrl+P)**: 模糊搜索快速定位文件
- **全局搜索 (Ctrl+Shift+F)**: 支持正则、大小写敏感、全字匹配
- **语义搜索**: 基于 AI Embedding 的代码库语义搜索
- **混合搜索 (Hybrid Search)**: 结合语义搜索和关键词搜索，使用 RRF 算法融合结果
- **符号搜索**: 快速定位函数、类、变量
- **文件内搜索 (Ctrl+F)**: 当前文件内快速查找
- **搜索替换 (Ctrl+H)**: 支持批量替换

### 📟 集成终端

- **真·终端**: 基于 `xterm.js` + `node-pty` 的完整终端体验
- **多 Shell 支持**: PowerShell, CMD, Git Bash, WSL, Bash, Zsh
- **分屏终端**: 支持多终端并排显示
- **快捷脚本**: 一键运行 `package.json` 中的 npm scripts
- **AI 修复**: 终端报错后一键让 AI 分析并修复
- **快捷键支持**: Ctrl+C/V 复制粘贴，Ctrl+Shift+C/V 备用
- **WebGL 渲染**: 高性能终端渲染

![alt text](images/terminal.png)

### 📂 文件管理

- **资源管理器**: 完整的文件树视图
- **虚拟化渲染**: 支持超大项目，万级文件流畅浏览
- **文件操作**: 新建、重命名、删除、复制路径
- **大文件支持**: 智能检测大文件，优化加载策略
- **文件预览**: 
  - Markdown 实时预览（编辑/预览/分屏模式）
  - 图片预览
  - Plan 文件可视化
- **拖拽支持**: 拖拽文件到 AI 对话框添加上下文
- **外部链接**: 编辑器中的链接在系统浏览器中打开

### 🔀 Git 版本控制

- **源代码管理面板**: 完整的 Git 操作界面
- **变更管理**: 暂存 (Stage)、取消暂存、丢弃更改
- **提交历史**: 查看完整的提交记录，按时间线浏览
- **Diff 视图**: 并排对比文件变更
- **分支管理**: 查看和切换分支

### 🗂 代码大纲

- **文档符号**: 显示当前文件的函数、类、变量结构
- **快速导航**: 点击符号跳转到对应位置
- **层级展示**: 清晰的代码结构层次

### ⚠️ 问题面板

- **实时诊断**: 显示当前文件的错误和警告
- **快速定位**: 点击问题跳转到对应行
- **Lint 集成**: 支持 ESLint 等代码检查工具

### 🔐 安全特性

- **工作区隔离**: 严格的工作区边界检查
- **敏感路径保护**: 阻止访问系统敏感目录
- **命令白名单**: 限制可执行的 Shell 命令
- **Git 子命令白名单**: 限制可执行的 Git 操作
- **审计日志**: 记录所有敏感操作（按工作区存储到 `.adnify/audit.log`）
- **权限确认**: 危险操作需要用户确认
- **安全设置面板**: 可自定义安全策略

### 🎯 其他特性

- **命令面板 (Ctrl+Shift+O)**: 快速执行各种命令
- **多窗口支持**: 同时打开多个项目
- **多工作区支持**: 单窗口打开多个项目根目录
- **工作区恢复**: 自动记住上次的工作状态
- **欢迎页面**: 空窗口显示欢迎页，快速打开最近项目
- **会话管理**: 保存和恢复 AI 对话历史
- **Token 统计**: 实时显示对话 Token 消耗，可配置上下文限制
- **国际化**: 完整的中英文支持
- **自定义快捷键**: 可配置的键盘绑定
- **引导向导**: 首次使用的配置引导，精美动画效果
- **Tree-sitter 解析**: 支持 20+ 语言的语法树解析

---

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- Git
- Python (可选，用于某些 npm 包的编译)

### 开发环境运行

```bash
# 1. 克隆项目
git clone https://gitee.com/adnaan/adnify.git
cd adnify

# 2. 安装依赖
npm install

# 3. 启动开发服务器
npm run dev
```

### 打包发布

```bash
# 1. 生成图标资源 (首次运行或图标变更时)
node scripts/generate-icons.js

# 2. 构建安装包
npm run dist

# 生成的文件位于 release/ 目录
```

---

## 📖 功能详解

### 配置 AI 模型

1. 点击左下角 **设置** 图标或按 `Ctrl+,`
2. 在 **Provider** 选项卡选择 AI 服务商
3. 输入 API Key（本地模型如 Ollama 需填写 Base URL）
4. 选择模型并保存

支持的服务商:
- OpenAI (GPT-4, GPT-4o, GPT-4o-mini, GPT-3.5)
- Anthropic (Claude 3.5 Sonnet, Claude 3 Opus/Sonnet/Haiku)
- Google (Gemini 2.0 Flash, Gemini 1.5 Pro/Flash)
- DeepSeek (DeepSeek Chat, DeepSeek Coder)
- Ollama (本地模型)
- 自定义 OpenAI 兼容 API
- 支持自定义模型名称

### 与 AI 协作

**引用文件上下文:**
- 输入 `@` 弹出文件选择列表
- 从侧边栏拖拽文件到输入框
- 使用斜杠命令 `/file` 选择文件

**斜杠命令:**
- `/file` - 添加文件到上下文
- `/clear` - 清空对话
- `/plan` - 切换到 Plan 模式并创建任务计划
- `/chat` - 切换到 Chat 模式
- `/agent` - 切换到 Agent 模式
- 更多命令可在输入框输入 `/` 查看

**@ 上下文引用:**
- `@文件名` - 添加文件到上下文
- `@codebase` - 启用语义搜索
- `@git` - 引用 Git 变更
- `@terminal` - 引用终端输出
- `@symbols` - 引用当前文件符号
- `@web` - 启用网络搜索

**让 AI 修改代码:**
1. 切换到 **Agent Mode**
2. 输入指令（如："重构这个函数，添加错误处理"）
3. AI 生成 Diff 预览
4. 点击 "Accept" 应用更改，或 "Reject" 拒绝

**内联编辑:**
1. 选中代码
2. 按 `Ctrl+K`
3. 输入修改指令
4. 预览并应用

**AI 自定义指令:**
在设置 → Agent 中可以添加自定义指令，AI 会在每次对话中遵循这些指令。

### 代码库索引

启用语义搜索功能:

1. 打开设置 → **Index** 选项卡
2. 选择 Embedding 提供商 (Jina, Voyage, OpenAI 等)
3. 配置 API Key
4. 点击 "Start Indexing" 开始索引

索引完成后，AI 可使用 `codebase_search` 工具进行语义搜索。

支持的 Embedding 提供商:
- Jina AI (推荐，免费额度)
- Voyage AI
- OpenAI
- 自定义 API (支持配置任意兼容 API)

### 使用 Plan Mode

Plan Mode 适合复杂的项目级开发任务：

1. 切换到 **Plan Mode** (点击模式切换按钮或输入 `/plan`)
2. 描述你的任务目标
3. AI 会自动创建分步计划
4. AI 按计划逐步执行，自动更新进度
5. 可随时查看计划状态和进度

Plan Mode 特有功能：
- 自动任务分解
- 进度追踪
- 步骤状态管理
- 计划可视化预览

### 使用 Git

1. 点击侧边栏 **Source Control** 图标
2. 查看文件变更列表
3. 点击 `+` 暂存文件
4. 输入提交信息
5. 按 `Ctrl+Enter` 提交

---

## ⌨️ 快捷键

### 通用

| 快捷键 | 功能 |
|:---|:---|
| `Ctrl + P` | 快速打开文件 |
| `Ctrl + Shift + P` | 命令面板 |
| `Ctrl + ,` | 打开设置 |
| `Ctrl + \`` | 切换终端 |
| `Ctrl + B` | 切换侧边栏 |
| `Ctrl + J` | 切换底部面板 |
| `Ctrl + Shift + ?` | 快捷键帮助 |
| `F12` | 开发者工具 |

### 编辑器

| 快捷键 | 功能 |
|:---|:---|
| `Ctrl + S` | 保存文件 |
| `Ctrl + W` | 关闭当前标签 |
| `Ctrl + Z` | 撤销 |
| `Ctrl + Shift + Z` | 重做 |
| `Ctrl + D` | 选择下一个匹配 |
| `Ctrl + /` | 切换注释 |
| `Ctrl + Shift + K` | 删除行 |
| `Ctrl + K` | 内联 AI 编辑 |
| `F12` | 跳转到定义 |
| `Shift + F12` | 查找引用 |
| `Ctrl + Space` | 触发补全 |

### 搜索

| 快捷键 | 功能 |
|:---|:---|
| `Ctrl + F` | 文件内搜索 |
| `Ctrl + H` | 文件内替换 |
| `Ctrl + Shift + F` | 全局搜索 |

### 终端

| 快捷键 | 功能 |
|:---|:---|
| `Ctrl + C` | 复制选中 / 中断命令 |
| `Ctrl + V` | 粘贴 |
| `Ctrl + Shift + C` | 复制 (备用) |
| `Ctrl + Shift + V` | 粘贴 (备用) |

### AI 对话

| 快捷键 | 功能 |
|:---|:---|
| `Enter` | 发送消息 |
| `Shift + Enter` | 换行 |
| `@` | 引用文件/上下文 |
| `/` | 斜杠命令 |
| `Escape` | 停止生成 |

### 模式切换

| 模式 | 说明 |
|:---|:---|
| Chat 💬 | 纯对话，无工具调用 |
| Agent 🤖 | 单次任务，工具调用 |
| Plan 📋 | 项目级开发，分步规划 |

---

## 📂 项目结构

```
adnify/
├── resources/           # 图标资源
├── scripts/             # 构建脚本
├── src/
│   ├── main/            # Electron 主进程
│   │   ├── ipc/         # IPC 处理器
│   │   │   ├── http.ts      # HTTP 请求
│   │   │   ├── indexing.ts  # 代码索引
│   │   │   ├── llm.ts       # LLM 通信
│   │   │   ├── lsp.ts       # LSP 服务
│   │   │   ├── search.ts    # 搜索功能
│   │   │   └── settings.ts  # 设置管理
│   │   ├── indexing/    # 代码库索引服务
│   │   │   ├── chunker.ts       # 代码分块
│   │   │   ├── embedder.ts      # Embedding 生成
│   │   │   ├── indexService.ts  # 索引服务
│   │   │   └── vectorStore.ts   # 向量存储
│   │   ├── services/llm/# LLM 通信层
│   │   └── security/    # 安全模块
│   │       ├── securityModule.ts    # 安全管理器
│   │       ├── secureTerminal.ts    # 终端安全
│   │       └── workspaceHandlers.ts # 工作区处理
│   ├── renderer/        # 前端渲染进程
│   │   ├── agent/       # AI Agent 核心
│   │   │   ├── llm/     # LLM 客户端适配器
│   │   │   ├── tools/   # 工具定义与执行
│   │   │   ├── services/# Agent 服务
│   │   │   └── prompts/ # 提示词模板
│   │   ├── components/  # UI 组件
│   │   │   ├── agent/   # Agent 相关组件
│   │   │   │   ├── ChatPanel.tsx      # 对话面板
│   │   │   │   ├── ToolCallCard.tsx   # 工具调用卡片
│   │   │   │   ├── InlineDiffPreview.tsx # Diff 预览
│   │   │   │   └── PlanPreview.tsx    # 计划预览
│   │   │   ├── editor/  # 编辑器组件
│   │   │   │   ├── Editor.tsx         # Monaco 编辑器
│   │   │   │   ├── DiffViewer.tsx     # Diff 查看器
│   │   │   │   └── InlineEdit.tsx     # 内联编辑
│   │   │   ├── sidebar/ # 侧边栏组件
│   │   │   │   └── panels/
│   │   │   │       ├── ExplorerView.tsx  # 文件浏览器
│   │   │   │       ├── SearchView.tsx    # 搜索面板
│   │   │   │       ├── GitView.tsx       # Git 面板
│   │   │   │       ├── OutlineView.tsx   # 大纲视图
│   │   │   │       └── ProblemsView.tsx  # 问题面板
│   │   │   ├── panels/  # 底部面板
│   │   │   │   ├── TerminalPanel.tsx  # 终端面板
│   │   │   │   ├── SessionList.tsx    # 会话列表
│   │   │   │   └── CheckpointPanel.tsx# 检查点面板
│   │   │   ├── dialogs/ # 对话框
│   │   │   │   ├── CommandPalette.tsx # 命令面板
│   │   │   │   ├── QuickOpen.tsx      # 快速打开
│   │   │   │   └── OnboardingWizard.tsx # 引导向导
│   │   │   └── settings/# 设置组件
│   │   ├── services/    # 前端服务
│   │   │   └── TerminalManager.ts # 终端管理
│   │   ├── store/       # Zustand 状态管理
│   │   └── i18n/        # 国际化
│   └── shared/          # 共享代码
│       ├── config/      # 配置定义
│       │   ├── providers.ts # LLM 提供商配置
│       │   └── tools.ts     # 工具统一配置
│       ├── constants/   # 常量
│       └── types/       # 类型定义
└── package.json
```

---

## 🛠 技术栈

- **框架**: Electron 39 + React 18 + TypeScript 5
- **构建**: Vite 6 + electron-builder
- **编辑器**: Monaco Editor
- **终端**: xterm.js + node-pty + WebGL Addon
- **状态管理**: Zustand
- **样式**: Tailwind CSS
- **LSP**: typescript-language-server
- **Git**: dugite
- **向量存储**: LanceDB (高性能向量数据库)
- **代码解析**: tree-sitter
- **验证**: Zod

---

## 🤝 贡献与反馈

欢迎提交 Issue 或 Pull Request！

如果你喜欢这个项目，请给一个 ⭐️ Star！

---

## 📄 License

本项目采用自定义许可协议，主要条款：

- ✅ 允许个人学习、研究、非商业使用
- ✅ 允许修改和分发（需保留版权信息）
- ⚠️ **商业使用需要获得作者书面授权**
- ❌ 禁止删除软件名称、作者版权、仓库地址等信息

商业授权请联系：adnaan.worker@gmail.com

详见 [LICENSE](LICENSE) 文件

---

## 🙋 Q&A：关于开源协议

**Q: 为什么你的协议这么多要求？看起来比 MIT 复杂多了啊？**

A: 因为我被伤害过 😭

说真的，我见过太多这样的操作了：
- 把开源项目 fork 一份，改个名字换个皮肤，就说是"自主研发"
- 把作者信息、仓库地址删得干干净净，好像这代码是从石头里蹦出来的
- 拿去卖钱、接外包，一分钱不给原作者，连个 star 都舍不得点
- 更离谱的是，有人拿去培训班当教材卖，学员还以为是老师写的

我不反对商业化，真的。你想商用？来，发邮件聊聊，说不定我们还能合作。但你偷偷摸摸把我名字抹了拿去赚钱，这就过分了吧？

**Q: 那我个人学习用，会不会不小心违规？**

A: 不会！个人学习、研究、写毕业设计、做 side project，随便用！只要你：
1. 别删我名字和仓库地址
2. 别拿去卖钱
3. 如果你基于它做了新东西，说一声"基于 Adnify 开发"就行

就这么简单，我又不是要为难你 😊

**Q: 我想给公司内部用，算商业使用吗？**

A: 如果是公司内部工具、不对外销售、不产生直接收益，一般不算。但如果拿不准，发邮件问我一声，我很好说话的（真的）。

**Q: 为什么不直接用 GPL？**

A: GPL 是好协议，但它管不住"删作者信息"这种骚操作。我的协议核心就一条：**你可以用、可以改、可以分发，但别装作这是你写的**。

说白了，开源不是"免费任你糟蹋"，是"我愿意分享，但请尊重我的劳动"。

如果你认同这个理念，欢迎 star ⭐️，这比什么都重要。
