/**
 * 安全审计和权限管理模块
 * 统一管理所有敏感操作的权限校验和审计日志
 */

import { logger } from '@shared/utils/Logger'
import { toAppError } from '@shared/utils/errorHandler'
import Store from 'electron-store'
import * as path from 'path'
import * as fs from 'fs'
import { SECURITY_DEFAULTS, isSensitivePath as sharedIsSensitivePath } from '@shared/constants'
import { pathStartsWith, pathEquals } from '@shared/utils/pathUtils'

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
  SYSTEM_SHELL = 'system:shell',
}

// 审计日志接口
export interface AuditLog {
  timestamp: string
  operation: OperationType
  target: string
  success: boolean
  detail?: string
}

// 安全配置接口
export interface SecurityConfig {
  enablePermissionConfirm: boolean
  enableAuditLog: boolean
  strictWorkspaceMode: boolean
  allowedShellCommands?: string[]
  showSecurityWarnings?: boolean
}

// 安全存储（独立于主配置）
const securityStore = new Store({ name: 'security' })

// 审计日志最大条数
const MAX_AUDIT_LOGS = 1000

// 权限等级
export enum PermissionLevel {
  ALLOWED = 'allowed',      // 允许，无需确认
  ASK = 'ask',              // 每次需要用户确认
  DENIED = 'denied'         // 永远拒绝
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
  checkPermission: (operation: OperationType, target: string) => Promise<boolean>
  setPermission: (operation: OperationType, level: PermissionLevel) => void

  // 工作区设置
  setWorkspacePath: (workspacePath: string | null) => void

  // 审计日志（按工作区存储）
  logOperation: (operation: OperationType, target: string, success: boolean, detail?: any) => void
  getAuditLogs: (limit?: number) => AuditLog[]
  clearAuditLogs: () => void

  // 工作区安全边界
  validateWorkspacePath: (filePath: string, workspace: string | string[]) => boolean
  isSensitivePath: (filePath: string) => boolean

  // 白名单管理
  isAllowedCommand: (command: string, type: 'shell' | 'git') => boolean

  // 配置更新
  updateConfig: (config: Partial<SecuritySettings>) => void
}

// 默认权限配置
const DEFAULT_PERMISSIONS: PermissionConfig = {
  [OperationType.FILE_READ]: PermissionLevel.ALLOWED,
  [OperationType.FILE_WRITE]: PermissionLevel.ALLOWED,
  [OperationType.FILE_RENAME]: PermissionLevel.ALLOWED,
  [OperationType.FILE_DELETE]: PermissionLevel.ASK,
  [OperationType.SHELL_EXECUTE]: PermissionLevel.ALLOWED,
  [OperationType.TERMINAL_INTERACTIVE]: PermissionLevel.ALLOWED,
  [OperationType.GIT_EXEC]: PermissionLevel.ALLOWED,
  [OperationType.SYSTEM_SHELL]: PermissionLevel.DENIED,
}

// 命令白名单（已统一到 constants.ts）
const ALLOWED_SHELL_COMMANDS = new Set(SECURITY_DEFAULTS.SHELL_COMMANDS.map(cmd => cmd.toLowerCase()))

const ALLOWED_GIT_SUBCOMMANDS = new Set(SECURITY_DEFAULTS.GIT_SUBCOMMANDS.map(cmd => cmd.toLowerCase()))

class SecurityManager implements SecurityModule {
  private sessionStorage: Map<string, boolean> = new Map()
  private config: Partial<SecuritySettings> = {}
  private workspacePath: string | null = null

  /**
   * 设置当前工作区路径
   */
  setWorkspacePath(workspacePath: string | null) {
    this.workspacePath = workspacePath
    logger.security.info('[Security] Workspace path set:', workspacePath)
  }

  /**
   * 获取审计日志文件路径
   */
  private getAuditLogPath(): string | null {
    if (!this.workspacePath) return null
    return path.join(this.workspacePath, '.adnify', 'audit.log')
  }

  /**
   * 更新安全配置
   */
  updateConfig(config: Partial<SecuritySettings>) {
    this.config = { ...this.config, ...config }
    logger.security.info('[Security] Configuration updated:', this.config)
  }

  /**
   * 检查权限
   */
  async checkPermission(operation: OperationType, target: string): Promise<boolean> {
    const sessionKey = `${operation}:${target}`
    if (this.sessionStorage.has(sessionKey)) {
      return this.sessionStorage.get(sessionKey)!
    }

    const config = this.getPermissionConfig(operation)

    if (config === PermissionLevel.DENIED) {
      this.logOperation(operation, target, false, { reason: 'Permission denied by policy' })
      return false
    }

    if (config === PermissionLevel.ASK) {
      if (this.config.enablePermissionConfirm === false) {
        return true
      }
      return true
    }

    return true
  }

  /**
   * 设置权限
   */
  setPermission(operation: OperationType, level: PermissionLevel): void {
    const permissions = securityStore.get('permissions', {}) as PermissionConfig
    permissions[operation] = level
    securityStore.set('permissions', permissions)
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
   * 记录日志（写入工作区 .adnify/audit.log）
   */
  logOperation(operation: OperationType, target: string, success: boolean, detail?: any): void {
    // 检查是否启用审计日志
    if (!this.config.enableAuditLog) {
      return
    }

    const logPath = this.getAuditLogPath()
    if (!logPath) {
      logger.security.debug('[Security] No workspace set, skipping audit log')
      return
    }

    const timestamp = new Date().toISOString()
    const logEntry: AuditLog = {
      timestamp,
      operation,
      target,
      success,
      detail: detail ? JSON.stringify(detail) : undefined,
    }

    try {
      // 确保 .adnify 目录存在
      const adnifyDir = path.dirname(logPath)
      if (!fs.existsSync(adnifyDir)) {
        fs.mkdirSync(adnifyDir, { recursive: true })
      }

      // 追加写入日志（每行一个 JSON 对象，便于读取和截断）
      fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n', 'utf-8')

      // 检查日志文件大小，超过限制时截断
      this.truncateAuditLogIfNeeded(logPath)
    } catch (err) {
      logger.security.error('[Security] Failed to write audit log:', toAppError(err).message)
    }

    const status = success ? '✅' : '❌'
    logger.security.info(`[Security Audit] ${status} ${operation} - ${target}`)
  }

  /**
   * 截断日志文件（保留最新的 MAX_AUDIT_LOGS 条）
   */
  private truncateAuditLogIfNeeded(logPath: string): void {
    try {
      const content = fs.readFileSync(logPath, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)

      if (lines.length > MAX_AUDIT_LOGS) {
        // 保留最新的记录
        const truncated = lines.slice(-MAX_AUDIT_LOGS).join('\n') + '\n'
        fs.writeFileSync(logPath, truncated, 'utf-8')
      }
    } catch {
      // 忽略截断错误
    }
  }

  /**
   * 获取日志（从工作区 .adnify/audit.log 读取）
   */
  getAuditLogs(limit = 100): AuditLog[] {
    const logPath = this.getAuditLogPath()
    if (!logPath || !fs.existsSync(logPath)) {
      return []
    }

    try {
      const content = fs.readFileSync(logPath, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)

      // 解析日志并返回最新的 limit 条（倒序）
      const logs: AuditLog[] = []
      for (let i = lines.length - 1; i >= 0 && logs.length < limit; i--) {
        try {
          logs.push(JSON.parse(lines[i]))
        } catch {
          // 跳过解析失败的行
        }
      }
      return logs
    } catch (err) {
      logger.security.error('[Security] Failed to read audit logs:', toAppError(err).message)
      return []
    }
  }

  /**
   * 清空日志（删除工作区 .adnify/audit.log）
   */
  clearAuditLogs(): void {
    const logPath = this.getAuditLogPath()
    if (!logPath) return

    try {
      if (fs.existsSync(logPath)) {
        fs.unlinkSync(logPath)
      }
    } catch (err) {
      logger.security.error('[Security] Failed to clear audit logs:', toAppError(err).message)
    }
  }

  /**
   * 验证工作区边界
   */
  validateWorkspacePath(filePath: string, workspace: string | string[]): boolean {
    // 如果未启用严格工作区模式，允许所有路径（但仍检查敏感路径）
    if (this.config.strictWorkspaceMode === false) {
      const resolvedPath = path.resolve(filePath)
      return !this.isSensitivePath(resolvedPath)
    }
    
    if (!workspace) return false
    const workspaces = Array.isArray(workspace) ? workspace : [workspace]

    try {
      const resolvedPath = path.resolve(filePath)

      // 使用 pathStartsWith 进行路径比较（忽略大小写和分隔符差异）
      const isInside = workspaces.some(ws => {
        if (typeof ws !== 'string') return false
        const resolvedWorkspace = path.resolve(ws)
        return pathStartsWith(resolvedPath, resolvedWorkspace) || pathEquals(resolvedPath, resolvedWorkspace)
      })

      const isSensitive = typeof resolvedPath === 'string' && this.isSensitivePath(resolvedPath)

      return isInside && !isSensitive
    } catch (error) {
      logger.security.error('[Security] Path validation error:', error)
      return false
    }
  }

  /**
   * 检查敏感路径
   */
  isSensitivePath(filePath: string): boolean {
    if (typeof filePath !== 'string') return true
    return sharedIsSensitivePath(filePath)
  }

  /**
   * 检查允许的命令
   */
  isAllowedCommand(command: string, type: 'shell' | 'git'): boolean {
    const parts = command.trim().split(/\s+/)
    const baseCommand = parts[0]?.toLowerCase()

    if (type === 'git') {
      const subCommand = parts[1]?.toLowerCase()
      return ALLOWED_GIT_SUBCOMMANDS.has(subCommand)
    }

    if (type === 'shell') {
      if (this.config.allowedShellCommands && Array.isArray(this.config.allowedShellCommands)) {
        return this.config.allowedShellCommands.includes(baseCommand)
      }
      return ALLOWED_SHELL_COMMANDS.has(baseCommand)
    }

    return false
  }
}

export const securityManager = new SecurityManager()

export async function checkWorkspacePermission(
  filePath: string,
  workspace: string | string[] | null,
  operation: OperationType
): Promise<boolean> {
  if (!workspace) return false
  if (!securityManager.validateWorkspacePath(filePath, workspace)) return false
  if (securityManager.isSensitivePath(filePath)) return false
  return await securityManager.checkPermission(operation, filePath)
}
