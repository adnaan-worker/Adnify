/**
 * 安全审计和权限管理模块
 * 统一管理所有敏感操作的权限校验和审计日志
 */

import Store from 'electron-store'
import { BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'fs'

// 安全存储（独立于主配置）
const securityStore = new Store({ name: 'security' })

// 审计日志存储
const auditStore = new Store({ name: 'audit' })

// 权限等级
export enum PermissionLevel {
  ALLOWED = 'allowed',      // 允许，无需确认
  ASK = 'ask',              // 每次需要用户确认
  DENIED = 'denied'         // 永远拒绝
}

// 敏感操作类型
export enum OperationType {
  // 文件系统
  FILE_READ = 'file:read',
  FILE_WRITE = 'file:write',
  FILE_DELETE = 'file:delete',
  FILE_RENAME = 'file:rename',

  // 终端/命令
  SHELL_EXECUTE = 'shell:execute',
  TERMINAL_INTERACTIVE = 'terminal:interactive',

  // Git
  GIT_EXEC = 'git:exec',

  // 系统
  SYSTEM_SHELL = 'system:shell',  // 打开外部程序
}

interface PermissionConfig {
  [key: string]: PermissionLevel
}

// 来自 settingsSlice.ts 的定义
export interface SecuritySettings {
  enablePermissionConfirm: boolean
  enableAuditLog: boolean
  strictWorkspaceMode: boolean
  allowedShellCommands?: string[]
  showSecurityWarnings?: boolean
}

interface SecurityModule {
  // 权限管理（主进程底线检查，不弹窗）
  checkPermission: (operation: OperationType, target: string, context?: any) => Promise<boolean>
  setPermission: (operation: OperationType, level: PermissionLevel) => void

  // 审计日志
  logOperation: (operation: OperationType, target: string, success: boolean, detail?: any) => void
  getAuditLogs: (limit?: number) => any[]
  clearAuditLogs: () => void

  // 工作区安全边界
  validateWorkspacePath: (filePath: string, workspace: string) => boolean
  isSensitivePath: (filePath: string) => boolean

  // 白名单管理
  isAllowedCommand: (command: string, type: 'shell' | 'git') => boolean

  // 配置更新
  updateConfig: (config: Partial<SecuritySettings>) => void
}

// 默认权限配置
// 架构设计：
// ╔══════════════════════════════════════════════════════════════╗
// ║ 所有权责划分                                                   ║
// ║                                                                ║
// ║  Agent 层（渲染进程）                                          ║
// ║  ├─ 拥有 autoApprove 配置                                      ║
// ║  ├─ 用户通过 UI 界面控制是否需要确认                          ║
// ║  └─ 负责"用户体验"层面的确认流程                              ║
// ║                                                                ║
// ║  安全层（主进程）                                              ║
// ║  ├─ 绝不弹窗询问用户                                           ║
// ║  ├─ 只做硬性规则拦截                                           ║
// ║  └─ 负责"系统安全"层面的底线防御                              ║
// ╚══════════════════════════════════════════════════════════════╝
//
// 操作流程：
// 1. Agent 决定要执行动作（基于 autoApprove 配置）
// 2. 调用对应 tool（如 write_file → window.electronAPI.writeFile）
// 3. 安全层检查：
//    ├─ 工作区内正常操作 → 直接通过（不弹窗，不确认）
//    ├─ 工作区外 → 根据设置，或通过或阻止（不弹窗）
//    └─ 触犯底线规则 → 永远阻止（不弹窗，记日志）
//
// 结果：用户只需在 Agent UI 处确认一次，之后全程自动

const DEFAULT_PERMISSIONS: PermissionConfig = {
  // 文件读写 - 工作区内完全自动
  [OperationType.FILE_READ]: PermissionLevel.ALLOWED,    // 新增
  [OperationType.FILE_WRITE]: PermissionLevel.ALLOWED,
  [OperationType.FILE_RENAME]: PermissionLevel.ALLOWED,

  // 删除 - 默认 ASK，可在后续配置为自动
  [OperationType.FILE_DELETE]: PermissionLevel.ASK,

  // 命令执行 - 通过白名单机制控制
  [OperationType.SHELL_EXECUTE]: PermissionLevel.ALLOWED,

  // 终端 - 交互式需要确认（安全起见）
  [OperationType.TERMINAL_INTERACTIVE]: PermissionLevel.ALLOWED,

  // Git - 工作区内完全自动
  [OperationType.GIT_EXEC]: PermissionLevel.ALLOWED,

  // 系统操作 - 永远禁止
  [OperationType.SYSTEM_SHELL]: PermissionLevel.DENIED,
}

// 敏感路径模式（阻止访问系统关键区域）
const SENSITIVE_PATHS = [
  /^C:\\Windows\\/i,
  /^C:\\Program Files\\/i,
  /^C:\\Program Files \(x86\)\\/i,
  /^\/etc\//i,
  /^\/usr\/bin\//i,
  /^\/root\//i,
  /\/\.ssh\//i,
  /\/\.env$/i,
  /\/password|secret|credential/i,
]

// 命令白名单（仅允许安全的子命令）
const ALLOWED_SHELL_COMMANDS = new Set([
  'git', 'npm', 'yarn', 'pnpm', 'node', 'npx',
  'pwd', 'ls', 'cat', 'echo', 'mkdir', 'rmdir', 'cd',
])

const ALLOWED_GIT_SUBCOMMANDS = new Set([
  'status', 'log', 'diff', 'add', 'commit', 'push', 'pull',
  'branch', 'checkout', 'merge', 'rebase', 'clone',
  'remote', 'fetch', 'show', 'rev-parse', 'init',
])

class SecurityManager implements SecurityModule {
  private mainWindow: BrowserWindow | null = null
  private sessionStorage: Map<string, boolean> = new Map() // 会话级别的权限缓存
  private config: Partial<SecuritySettings> = {} // 动态配置

  setMainWindow(window: BrowserWindow | null) {
    this.mainWindow = window
  }

  /**
   * 更新安全配置
   */
  updateConfig(config: Partial<SecuritySettings>) {
    this.config = { ...this.config, ...config }
    console.log('[Security] Configuration updated:', this.config)
  }

  /**
   * 检查权限（主进程底线安全检查）
   * 
   * 设计原则：
   * - 主进程只做硬性规则拦截，不弹窗询问用户
   * - 用户确认流程由渲染进程的 Agent UI 负责
   */
  async checkPermission(operation: OperationType, target: string, context?: any): Promise<boolean> {
    // 从会话缓存检查
    const sessionKey = `${operation}:${target}`
    if (this.sessionStorage.has(sessionKey)) {
      return this.sessionStorage.get(sessionKey)!
    }

    // 从持久化配置检查
    const config = this.getPermissionConfig(operation)

    if (config === PermissionLevel.DENIED) {
      // 硬性拒绝，记录日志
      this.logOperation(operation, target, false, { reason: 'Permission denied by policy' })
      console.warn(`[Security] Operation denied by policy: ${operation} - ${target}`)
      return false
    }

    // 如果是 ASK 级别，检查全局确认开关
    if (config === PermissionLevel.ASK) {
      if (this.config.enablePermissionConfirm === false) {
        // 用户选择不需要确认，直接允许
        return true
      }
      // 需要确认时，默认拒绝（由渲染进程 Agent UI 处理用户确认）
      // 这里返回 true 是因为渲染进程已经处理了用户确认
      // 主进程不再弹窗，直接放行工作区内操作
      return true
    }

    // ALLOWED 级别直接允许
    return true
  }

  /**
   * 设置权限持久化配置
   */
  setPermission(operation: OperationType, level: PermissionLevel): void {
    const permissions = securityStore.get('permissions', {}) as PermissionConfig
    permissions[operation] = level
    securityStore.set('permissions', permissions)
    console.log(`[Security] Permission set: ${operation} = ${level}`)
  }

  /**
   * 获取权限配置
   */
  private getPermissionConfig(operation: OperationType): PermissionLevel {
    const permissions = securityStore.get('permissions', {}) as PermissionConfig
    if (permissions[operation]) {
      return permissions[operation]
    }
    return DEFAULT_PERMISSIONS[operation] || PermissionLevel.ASK
  }

  /**
   * 生成权限请求消息
   */
  private getPermissionMessage(operation: OperationType, target: string, context?: any): string {
    switch (operation) {
      case OperationType.FILE_WRITE:
        return '请求写入文件'
      case OperationType.FILE_DELETE:
        return '请求删除文件/目录'
      case OperationType.SHELL_EXECUTE:
        return '请求执行Shell命令'
      case OperationType.GIT_EXEC:
        return '请求执行Git命令'
      case OperationType.SYSTEM_SHELL:
        return '请求打开外部程序'
      default:
        return '请求敏感操作'
    }
  }

  /**
   * 生成权限请求详情
   */
  private getPermissionDetail(operation: OperationType, target: string, context?: any): string {
    const targetShort = target.length > 60 ? target.substring(0, 60) + '...' : target

    switch (operation) {
      case OperationType.FILE_WRITE:
        return `目标路径: ${targetShort}`
      case OperationType.FILE_DELETE:
        return `将删除: ${targetShort}\n\n⚠️ 此操作不可逆！`
      case OperationType.SHELL_EXECUTE:
        return `命令: ${targetShort}`
      case OperationType.GIT_EXEC:
        return `Git操作: ${targetShort}`
      case OperationType.SYSTEM_SHELL:
        return `程序: ${targetShort}`
      default:
        return `目标: ${targetShort}`
    }
  }

  /**
   * 记录操作审计日志
   */
  logOperation(operation: OperationType, target: string, success: boolean, detail?: any): void {
    const logs = auditStore.get('logs', []) as any[]
    const timestamp = new Date().toISOString()

    const logEntry = {
      timestamp,
      operation,
      target,
      success,
      detail: detail ? JSON.stringify(detail) : undefined,
    }

    logs.unshift(logEntry) // 添加到开头

    // 限制日志数量（最近1000条）
    if (logs.length > 1000) {
      logs.splice(1000)
    }

    auditStore.set('logs', logs)

    // 同时输出到控制台
    const status = success ? '✅' : '❌'
    console.log(`[Security Audit] ${status} ${operation} - ${target}`)
  }

  /**
   * 获取审计日志
   */
  getAuditLogs(limit = 100): any[] {
    const logs = auditStore.get('logs', []) as any[]
    return logs.slice(0, limit)
  }

  /**
   * 清空审计日志
   */
  clearAuditLogs(): void {
    auditStore.set('logs', [])
    console.log('[Security] Audit logs cleared')
  }

  /**
   * 验证工作区边界
   */
  validateWorkspacePath(filePath: string, workspace: string): boolean {
    if (!workspace) return false

    try {
      const resolvedPath = path.resolve(filePath)
      const resolvedWorkspace = path.resolve(workspace)

      // 确保路径在工作区内
      const isInside = resolvedPath.startsWith(resolvedWorkspace + path.sep) ||
        resolvedPath === resolvedWorkspace

      // 检查是否为敏感路径
      const isSensitive = this.isSensitivePath(resolvedPath)

      return isInside && !isSensitive
    } catch (error) {
      console.error('[Security] Path validation error:', error)
      return false
    }
  }

  /**
   * 检查是否为敏感系统路径
   */
  isSensitivePath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/')
    return SENSITIVE_PATHS.some(pattern => pattern.test(normalized))
  }

  /**
   * 检查是否为允许的命令（白名单）
   */
  isAllowedCommand(command: string, type: 'shell' | 'git'): boolean {
    const parts = command.trim().split(/\s+/)
    const baseCommand = parts[0]?.toLowerCase()

    if (type === 'git') {
      // Git 回退模式使用参数数组，直接检查第一个参数
      const subCommand = parts[1]?.toLowerCase()
      return ALLOWED_GIT_SUBCOMMANDS.has(subCommand)
    }

    if (type === 'shell') {
      // 优先使用配置中的白名单
      if (this.config.allowedShellCommands && Array.isArray(this.config.allowedShellCommands)) {
        return this.config.allowedShellCommands.includes(baseCommand)
      }
      // 回退到默认白名单
      return ALLOWED_SHELL_COMMANDS.has(baseCommand)
    }

    return false
  }
}

// 单例导出
export const securityManager = new SecurityManager()

// 辅助函数：简化权限检查
export async function checkWorkspacePermission(
  filePath: string,
  workspace: string | null,
  operation: OperationType
): Promise<boolean> {
  if (!workspace) {
    console.warn('[Security] No workspace set, permission denied')
    return false
  }

  // 验证工作区边界
  if (!securityManager.validateWorkspacePath(filePath, workspace)) {
    console.warn(`[Security] Path ${filePath} is outside workspace ${workspace}`)
    return false
  }

  // 检查敏感路径
  if (securityManager.isSensitivePath(filePath)) {
    console.warn(`[Security] Sensitive path detected: ${filePath}`)
    return false
  }

  // 检查权限
  return await securityManager.checkPermission(operation, filePath, { workspace })
}
