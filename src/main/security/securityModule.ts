/**
 * 安全审计和权限管理模块
 * 统一管理所有敏感操作的权限校验和审计日志
 */

import { logger } from '@shared/utils/Logger'
import Store from 'electron-store'
import * as path from 'path'
import { dialog, BrowserWindow } from 'electron'
import { SECURITY_DEFAULTS, isSensitivePath as sharedIsSensitivePath } from '@shared/constants'
import { pathStartsWith, pathEquals } from '@shared/utils/pathUtils'
import { isRegisteredIsolatedWorkspacePath } from './isolatedWorkspace'

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

// 安全配置接口
export interface SecurityConfig {
  enablePermissionConfirm: boolean
  strictWorkspaceMode: boolean
  allowedShellCommands?: string[]
  showSecurityWarnings?: boolean
}

// 安全存储（独立于主配置）
const securityStore = new Store({ name: 'security' })

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

  // 安全操作日志（通过 logger 输出，不写文件）
  logOperation: (operation: OperationType, target: string, success: boolean, detail?: any) => void

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

function normalizeCommandName(command: string): string {
  const baseName = path.basename(command).toLowerCase()
  return process.platform === 'win32'
    ? baseName.replace(/\.(cmd|bat|exe)$/i, '')
    : baseName
}

class SecurityManager implements SecurityModule {
  private sessionStorage: Map<string, boolean> = new Map()
  private config: Partial<SecuritySettings> = {}

  /**
   * 设置当前工作区路径（保留接口兼容）
   */
  setWorkspacePath(workspacePath: string | null) {
    logger.security.info('[Security] Workspace path set:', workspacePath)
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
      // 调用 Electron 原生对话框进行确认，避免引入 IPC 循环
      const mainWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const operationLabels: Partial<Record<OperationType, string>> = {
        [OperationType.FILE_DELETE]: '删除文件',
        [OperationType.SHELL_EXECUTE]: '执行命令',
        [OperationType.GIT_EXEC]: '执行 Git 命令',
      }
      const label = operationLabels[operation] ?? operation
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['允许', '拒绝'],
        defaultId: 1,
        cancelId: 1,
        title: '操作确认',
        message: `是否允许以下操作？`,
        detail: `操作类型：${label}\n目标：${target}`,
      })
      const allowed = response === 0
      this.sessionStorage.set(sessionKey, allowed)
      return allowed
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
   * 记录安全操作日志（仅通过 logger 输出，不写文件）
   */
  logOperation(operation: OperationType, target: string, success: boolean, detail?: any): void {
    const status = success ? '✅' : '❌'
    const detailStr = detail ? ` | ${JSON.stringify(detail)}` : ''
    logger.security.info(`[Security] ${status} ${operation} - ${target}${detailStr}`)
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
      const matchedWorkspace = workspaces.find(ws => {
        if (typeof ws !== 'string') return false
        const resolvedWorkspace = path.resolve(ws)
        return pathStartsWith(resolvedPath, resolvedWorkspace) || pathEquals(resolvedPath, resolvedWorkspace)
      })

      const isSensitive = typeof resolvedPath === 'string' && this.isSensitivePath(resolvedPath)
      const allowsRegisteredIsolatedWorkspace =
        Boolean(matchedWorkspace)
        && isSensitive
        && isRegisteredIsolatedWorkspacePath(resolvedPath)
        && isRegisteredIsolatedWorkspacePath(matchedWorkspace as string)

      return Boolean(matchedWorkspace) && (!isSensitive || allowsRegisteredIsolatedWorkspace)
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
    const baseCommand = normalizeCommandName(parts[0] || '')

    if (type === 'git') {
      const subCommand = normalizeCommandName(parts[1] || '')
      return ALLOWED_GIT_SUBCOMMANDS.has(subCommand)
    }

    if (type === 'shell') {
      if (this.config.allowedShellCommands && Array.isArray(this.config.allowedShellCommands)) {
        return this.config.allowedShellCommands
          .map(cmd => normalizeCommandName(cmd))
          .includes(baseCommand)
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
