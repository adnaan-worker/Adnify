/**
 * MCP (Model Context Protocol) 共享类型定义
 */

// ============================================
// 配置类型
// ============================================

/** MCP 服务器类型 */
export type McpServerType = 'local' | 'remote'

/** OAuth 配置 */
export interface McpOAuthConfig {
  /** OAuth 客户端 ID（可选，不提供则尝试动态注册） */
  clientId?: string
  /** OAuth 客户端密钥 */
  clientSecret?: string
  /** OAuth 作用域 */
  scope?: string
}

/** 本地 MCP 服务器配置 */
export interface McpLocalServerConfig {
  /** 服务器类型 */
  type: 'local'
  /** 服务器唯一标识 */
  id: string
  /** 显示名称 */
  name: string
  /** 启动命令 */
  command: string
  /** 命令参数 */
  args?: string[]
  /** 环境变量 */
  env?: Record<string, string>
  /** 是否禁用 */
  disabled?: boolean
  /** 自动批准的工具列表 */
  autoApprove?: string[]
  /** 工作目录 */
  cwd?: string
  /** 连接超时（毫秒） */
  timeout?: number
  /** 来源预设 ID（用于匹配预设获取使用示例等信息） */
  presetId?: string
  /** 配置来源层级（运行时填充，不持久化） */
  source?: 'user' | 'workspace'
}

/** 远程 MCP 服务器配置 */
export interface McpRemoteServerConfig {
  /** 服务器类型 */
  type: 'remote'
  /** 服务器唯一标识 */
  id: string
  /** 显示名称 */
  name: string
  /** 远程服务器 URL */
  url: string
  /** 自定义请求头 */
  headers?: Record<string, string>
  /** OAuth 配置（设为 false 禁用 OAuth） */
  oauth?: McpOAuthConfig | false
  /** 是否禁用 */
  disabled?: boolean
  /** 自动批准的工具列表 */
  autoApprove?: string[]
  /** 连接超时（毫秒） */
  timeout?: number
  /** 来源预设 ID（用于匹配预设获取使用示例等信息） */
  presetId?: string
  /** 配置来源层级（运行时填充，不持久化） */
  source?: 'user' | 'workspace'
}

/** MCP 服务器配置（联合类型） */
export type McpServerConfig = McpLocalServerConfig | McpRemoteServerConfig

/** 判断是否为远程配置 */
export function isRemoteConfig(config: McpServerConfig): config is McpRemoteServerConfig {
  return config.type === 'remote'
}

/** 判断是否为本地配置 */
export function isLocalConfig(config: McpServerConfig): config is McpLocalServerConfig {
  return config.type === 'local'
}

/** MCP 配置文件结构 */
export interface McpConfig {
  mcpServers: Record<string, Omit<McpServerConfig, 'id'>>
}

// ============================================
// 服务器状态
// ============================================

export type McpServerStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'needs_auth'           // 需要 OAuth 认证
  | 'needs_registration'   // 需要客户端注册

/** MCP 服务器运行时状态 */
export interface McpServerState {
  id: string
  config: McpServerConfig
  status: McpServerStatus
  error?: string
  tools: McpTool[]
  resources: McpResource[]
  prompts: McpPrompt[]
  lastConnected?: number
  /** OAuth 认证状态（仅远程服务器） */
  authStatus?: 'authenticated' | 'expired' | 'not_authenticated'
  /** OAuth 授权 URL（需要认证时） */
  authUrl?: string
}

// ============================================
// MCP 协议类型
// ============================================

/** MCP 工具定义 */
export interface McpTool {
  name: string
  description?: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, McpToolProperty>
    required?: string[]
  }
}

export interface McpToolProperty {
  type: string
  description?: string
  enum?: string[]
  items?: McpToolProperty
  properties?: Record<string, McpToolProperty>
}

/** MCP 资源定义 */
export interface McpResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

/** MCP 提示模板定义 */
export interface McpPrompt {
  name: string
  description?: string
  arguments?: McpPromptArgument[]
}

export interface McpPromptArgument {
  name: string
  description?: string
  required?: boolean
}

// ============================================
// 工具调用
// ============================================

/** MCP 工具调用请求 */
export interface McpToolCallRequest {
  serverId: string
  toolName: string
  arguments: Record<string, unknown>
}

/** MCP 工具调用结果 */
export interface McpToolCallResult {
  success: boolean
  content?: McpContent[]
  error?: string
  isError?: boolean
}

/** MCP 内容类型 */
export interface McpContent {
  type: 'text' | 'image' | 'resource'
  text?: string
  data?: string
  mimeType?: string
  uri?: string
}

// ============================================
// 资源操作
// ============================================

/** 资源读取请求 */
export interface McpResourceReadRequest {
  serverId: string
  uri: string
}

/** 资源读取结果 */
export interface McpResourceReadResult {
  success: boolean
  contents?: McpResourceContent[]
  error?: string
}

export interface McpResourceContent {
  uri: string
  mimeType?: string
  text?: string
  blob?: string
}

// ============================================
// 提示操作
// ============================================

/** 提示获取请求 */
export interface McpPromptGetRequest {
  serverId: string
  promptName: string
  arguments?: Record<string, string>
}

/** 提示获取结果 */
export interface McpPromptGetResult {
  success: boolean
  description?: string
  messages?: McpPromptMessage[]
  error?: string
}

export interface McpPromptMessage {
  role: 'user' | 'assistant'
  content: McpContent
}

// ============================================
// IPC 事件类型
// ============================================

export interface McpServerStatusEvent {
  serverId: string
  status: McpServerStatus
  error?: string
  authUrl?: string
}

export interface McpToolsUpdatedEvent {
  serverId: string
  tools: McpTool[]
}

export interface McpResourcesUpdatedEvent {
  serverId: string
  resources: McpResource[]
}

// ============================================
// OAuth 相关类型
// ============================================

/** OAuth 认证请求 */
export interface McpOAuthStartRequest {
  serverId: string
}

/** OAuth 认证结果 */
export interface McpOAuthStartResult {
  success: boolean
  authorizationUrl?: string
  error?: string
}

/** OAuth 完成请求 */
export interface McpOAuthFinishRequest {
  serverId: string
  authorizationCode: string
}

/** OAuth 完成结果 */
export interface McpOAuthFinishResult {
  success: boolean
  error?: string
}

/** OAuth Token 存储 */
export interface McpOAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  tokenType?: string
  scope?: string
}
// ============================================
// 预设类型（用于内置服务器和 Registry）
// ============================================

/** 支持的平台 */
export type McpPlatform = 'windows' | 'macos' | 'linux'

/** 依赖类型 */
export type McpDependencyType = 'node' | 'python' | 'uv' | 'bun' | 'docker'

/** 依赖配置 */
export interface McpDependency {
  /** 依赖类型 */
  type: McpDependencyType
  /** 最低版本（可选） */
  minVersion?: string
  /** 检查命令（用于验证是否安装） */
  checkCommand?: string
  /** 安装说明 */
  installNote?: string
  /** 安装说明（中文） */
  installNoteZh?: string
}

/** 环境变量配置 */
export interface McpEnvConfig {
  /** 环境变量名 */
  key: string
  /** 显示名称 */
  label: string
  /** 显示名称（中文） */
  labelZh: string
  /** 描述 */
  description?: string
  /** 描述（中文） */
  descriptionZh?: string
  /** 是否必填 */
  required: boolean
  /** 是否为密钥（显示为密码输入框） */
  secret?: boolean
  /** 默认值 */
  defaultValue?: string
  /** 占位符 */
  placeholder?: string
}

/** 分类类型 */
export type McpPresetCategory =
  | 'search'      // 搜索
  | 'database'    // 数据库
  | 'filesystem'  // 文件系统
  | 'development' // 开发工具
  | 'design'      // 设计工具
  | 'productivity'// 生产力
  | 'ai'          // AI 服务
  | 'cloud'       // 云服务
  | 'other'       // 其他

/** 基础预设定义 */
export interface McpBasePreset {
  /** 预设 ID */
  id: string
  /** 显示名称 */
  name: string
  /** 描述 */
  description: string
  /** 描述（中文） */
  descriptionZh: string
  /** 分类 */
  category: McpPresetCategory
  /** 图标（lucide 图标名） */
  icon: string
  /** 环境变量配置 */
  envConfig?: McpEnvConfig[]
  /** 默认自动批准的工具 */
  defaultAutoApprove?: string[]
  /** 是否需要额外配置 */
  requiresConfig: boolean
  /** 官方文档链接 */
  docsUrl?: string
  /** 是否为官方 MCP 服务器 */
  official?: boolean
  /** 标签 */
  tags?: string[]
  /** 安装前置命令（首次使用时需要执行） */
  setupCommand?: string
  /** 安装说明 */
  setupNote?: string
  /** 安装说明（中文） */
  setupNoteZh?: string
  /** 使用示例（告诉用户怎么触发） */
  usageExamples?: string[]
  /** 使用示例（中文） */
  usageExamplesZh?: string[]
  /** 支持的平台（不指定则支持所有平台） */
  platforms?: McpPlatform[]
  /** 依赖要求 */
  dependencies?: McpDependency[]
  /** 最低版本要求（MCP 服务器版本） */
  minVersion?: string
  /** 是否已废弃 */
  deprecated?: boolean
  /** 废弃说明 */
  deprecatedNote?: string
}

/** 本地 MCP 预设 */
export interface McpLocalPreset extends McpBasePreset {
  /** 预设类型 */
  type: 'local'
  /** 启动命令 */
  command: string
  /** 命令参数 */
  args?: string[]
}

/** 远程 MCP 预设 */
export interface McpRemotePreset extends McpBasePreset {
  /** 预设类型 */
  type: 'remote'
  /** 远程 URL */
  url: string
  /** 自定义请求头模板（支持 ${ENV_VAR} 占位符替换） */
  headers?: Record<string, string>
  /** OAuth 配置，设为 false 禁用 OAuth（使用 headers 认证时需禁用） */
  oauth?: McpOAuthConfig | false
}

/** MCP 服务器预设（辨别联合类型） */
export type McpPreset = McpLocalPreset | McpRemotePreset
