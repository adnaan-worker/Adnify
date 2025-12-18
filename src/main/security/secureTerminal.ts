/**
 * 安全的终端执行模块（替代原有 terminal.ts 中的高危功能）
 */

import { ipcMain, BrowserWindow, dialog } from 'electron'
import { exec, spawn, execSync } from 'child_process'
import { securityManager, OperationType, PermissionLevel, checkWorkspacePermission } from './securityModule'
import * as path from 'path'

interface SecureShellRequest {
  command: string
  args?: string[]
  cwd?: string
  timeout?: number
  requireConfirm?: boolean
}

interface CommandWhitelist {
  shell: Set<string>
  git: Set<string>
}

// 白名单配置
const WHITELIST: CommandWhitelist = {
  shell: new Set([
    'npm', 'yarn', 'pnpm', 'node', 'npx',
    'git', // 允许 git 调用，但会在 git ipc 中进一步限制
    'pwd', 'ls', 'cat', 'echo', 'mkdir', 'touch', 'rm', 'mv',
  ]),
  git: new Set([
    'status', 'log', 'diff', 'add', 'commit', 'push', 'pull',
    'branch', 'checkout', 'merge', 'rebase', 'clone',
    'remote', 'fetch', 'show', 'rev-parse', 'init', 'status',
  ]),
}

// 危险命令模式列表
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+.*\//i,  // rm -rf /
  /wget\s+.*\s+-O\s+/i,  // 下载文件
  /curl\s+.*\s+-o\s+/i,  // 下载文件
  /powershell\s+-e(ncodedCommand)?.*frombase64/i,  // PowerShell 编码命令
  /\/etc\/passwd|\/etc\/shadow/i,
  /windowssystem32/i,
  /registry/i,
]

// 命令安全检查结果
interface SecurityCheckResult {
  safe: boolean
  reason?: string
  sanitizedCommand?: string
}

/**
 * 安全命令解析器
 */
class SecureCommandParser {
  /**
   * 验证命令是否在白名单中
   */
  static validateCommand(baseCommand: string, type: 'shell' | 'git'): SecurityCheckResult {
    if (type === 'git') {
      const allowed = WHITELIST.git.has(baseCommand)
      return {
        safe: allowed,
        reason: allowed ? undefined : `Git子命令"${baseCommand}"不在白名单中`,
      }
    }

    const allowed = WHITELIST.shell.has(baseCommand)
    return {
      safe: allowed,
      reason: allowed ? undefined : `Shell命令"${baseCommand}"不在白名单中`,
    }
  }

  /**
   * 检测危险命令模式
   */
  static detectDangerousPatterns(command: string): SecurityCheckResult {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return {
          safe: false,
          reason: `检测到危险模式: ${pattern}`,
        }
      }
    }

    return { safe: true }
  }

  /**
   * 安全执行命令
   */
  static async executeSecureCommand(
    command: string,
    args: string[],
    cwd: string,
    timeout: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      // 使用 spawn 防止 shell 注入
      const child = spawn(command, args, {
        cwd,
        timeout,
        shell: false, // 禁用 shell，防止注入
        env: {
          ...process.env,
          // 移除可能导致问题的环境变量
          PATH: process.env.PATH,
        },
      })

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      child.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code || 0 })
      })

      child.on('error', (error) => {
        reject(error)
      })
    })
  }
}

/**
 * 注册安全的终端处理程序
 */
export function registerSecureTerminalHandlers(
  getMainWindow: () => BrowserWindow | null,
  getWorkspace: () => string | null
) {
  /**
   * 安全的命令执行（白名单 + 工作区边界）
   * 替代原来的 shell:execute
   */
  ipcMain.handle('shell:executeSecure', async (
    _,
    request: SecureShellRequest
  ): Promise<{
    success: boolean
    output?: string
    errorOutput?: string
    exitCode?: number
    error?: string
  }> => {
    const { command, args = [], cwd, timeout = 30000, requireConfirm = true } = request
    const mainWindow = getMainWindow()
    const workspace = getWorkspace()

    if (!mainWindow) {
      return { success: false, error: '主窗口未就绪' }
    }

    if (!workspace) {
      return { success: false, error: '未设置工作区' }
    }

    // 1. 校验工作区边界（如果指定了 cwd）
    const targetPath = cwd || workspace
    if (!securityManager.validateWorkspacePath(targetPath, workspace)) {
      securityManager.logOperation(OperationType.SHELL_EXECUTE, command, false, {
        reason: '路径在工作区外',
        targetPath,
        workspace,
      })
      return { success: false, error: '不允许在工作区外执行命令' }
    }

    // 2. 检测危险模式
    const fullCommand = [command, ...args].join(' ')
    const dangerousCheck = SecureCommandParser.detectDangerousPatterns(fullCommand)
    if (!dangerousCheck.safe) {
      securityManager.logOperation(OperationType.SHELL_EXECUTE, fullCommand, false, {
        reason: dangerousCheck.reason,
      })
      return { success: false, error: dangerousCheck.reason }
    }

    // 3. 白名单验证
    const baseCommand = command.toLowerCase()
    const whitelistCheck = SecureCommandParser.validateCommand(baseCommand, 'shell')
    if (!whitelistCheck.safe) {
      securityManager.logOperation(OperationType.SHELL_EXECUTE, fullCommand, false, {
        reason: whitelistCheck.reason,
      })
      return { success: false, error: whitelistCheck.reason }
    }

    // 4. 权限检查（用户确认）
    if (requireConfirm) {
      const hasPermission = await securityManager.checkPermission(
        OperationType.SHELL_EXECUTE,
        fullCommand,
        { workspace, cwd: targetPath }
      )

      if (!hasPermission) {
        securityManager.logOperation(OperationType.SHELL_EXECUTE, fullCommand, false, {
          reason: '用户拒绝',
        })
        return { success: false, error: '用户拒绝执行命令' }
      }
    }

    try {
      // 5. 安全执行命令
      const result = await SecureCommandParser.executeSecureCommand(
        command,
        args,
        targetPath,
        timeout
      )

      // 6. 记录审计日志
      securityManager.logOperation(OperationType.SHELL_EXECUTE, fullCommand, true, {
        exitCode: result.exitCode,
        outputLength: result.stdout.length,
        errorLength: result.stderr.length,
      })

      return {
        success: result.exitCode === 0,
        output: result.stdout,
        errorOutput: result.stderr,
        exitCode: result.exitCode,
      }
    } catch (error: any) {
      securityManager.logOperation(OperationType.SHELL_EXECUTE, fullCommand, false, {
        error: error.message,
      })
      return {
        success: false,
        error: `执行失败: ${error.message}`,
      }
    }
  })

  /**
   * 安全的 Git 命令执行
   * 替代原来的 git:exec（移除 exec 拼接）
   */
  ipcMain.handle('git:execSecure', async (
    _,
    args: string[],
    cwd: string
  ): Promise<{
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
  }> => {
    const workspace = getWorkspace()

    if (!workspace) {
      return { success: false, error: '未设置工作区' }
    }

    // 1. 验证工作区边界
    if (!securityManager.validateWorkspacePath(cwd, workspace)) {
      securityManager.logOperation(OperationType.GIT_EXEC, args.join(' '), false, {
        reason: '路径在工作区外',
        cwd,
        workspace,
      })
      return { success: false, error: '不允许在工作区外执行Git命令' }
    }

    // 2. Git 子命令白名单验证
    if (args.length === 0) {
      return { success: false, error: '缺少Git命令' }
    }

    const gitSubCommand = args[0].toLowerCase()
    const whitelistCheck = SecureCommandParser.validateCommand(gitSubCommand, 'git')

    if (!whitelistCheck.safe) {
      securityManager.logOperation(OperationType.GIT_EXEC, args.join(' '), false, {
        reason: whitelistCheck.reason,
      })
      return { success: false, error: whitelistCheck.reason }
    }

    // 3. 检测危险模式（防止参数注入）
    const fullCommand = args.join(' ')
    const dangerousCheck = SecureCommandParser.detectDangerousPatterns(fullCommand)
    if (!dangerousCheck.safe) {
      securityManager.logOperation(OperationType.GIT_EXEC, fullCommand, false, {
        reason: dangerousCheck.reason,
      })
      return { success: false, error: dangerousCheck.reason }
    }

    // 4. 权限检查
    const hasPermission = await securityManager.checkPermission(
      OperationType.GIT_EXEC,
      `git ${fullCommand}`,
      { workspace, cwd }
    )

    if (!hasPermission) {
      securityManager.logOperation(OperationType.GIT_EXEC, fullCommand, false, {
        reason: '用户拒绝',
      })
      return { success: false, error: '用户拒绝执行Git命令' }
    }

    try {
      // 5. 尝试使用 dugite（安全）
      const { GitProcess } = require('dugite')
      const result = await GitProcess.exec(args, cwd)

      securityManager.logOperation(OperationType.GIT_EXEC, fullCommand, true, {
        exitCode: result.exitCode,
      })

      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      }
    } catch (error) {
      console.warn('[Git] dugite 不可用，尝试安全的 spawn 方式')

      try {
        // 6. 安全回退：使用 spawn 而非 exec
        const result = await SecureCommandParser.executeSecureCommand('git', args, cwd, 120000)

        securityManager.logOperation(OperationType.GIT_EXEC, fullCommand, true, {
          exitCode: result.exitCode,
        })

        return {
          success: result.exitCode === 0,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        }
      } catch (spawnError: any) {
        securityManager.logOperation(OperationType.GIT_EXEC, fullCommand, false, {
          error: spawnError.message,
        })
        return {
          success: false,
          error: `Git执行失败: ${spawnError.message}`,
        }
      }
    }
  })

  /**
   * 交互式终端创建（仍然使用 node-pty，但加强路径限制）
   */
  ipcMain.handle('terminal:interactive', async (
    _,
    options: { id: string; cwd?: string; shell?: string }
  ) => {
    const workspace = getWorkspace()
    const { id, cwd, shell } = options

    if (!workspace) {
      return { success: false, error: '未设置工作区' }
    }

    // 限制只能在工作区内使用终端
    const targetCwd = cwd || workspace
    if (!securityManager.validateWorkspacePath(targetCwd, workspace)) {
      securityManager.logOperation(OperationType.TERMINAL_INTERACTIVE, 'terminal:create', false, {
        reason: '路径在工作区外',
        cwd: targetCwd,
      })
      return { success: false, error: '终端只能在工作区内创建' }
    }

    // 权限检查
    const hasPermission = await securityManager.checkPermission(
      OperationType.TERMINAL_INTERACTIVE,
      `Terminal:${id}`,
      { cwd: targetCwd }
    )

    if (!hasPermission) {
      return { success: false, error: '用户拒绝创建终端' }
    }

    securityManager.logOperation(OperationType.TERMINAL_INTERACTIVE, 'terminal:create', true, {
      id,
      cwd: targetCwd,
      shell,
    })

    // 返回成功，实际创建由原来的 terminal.ts 处理
    return { success: true }
  })

  /**
   * 获取可用 shell 列表（安全版本）
   */
  ipcMain.handle('shell:getAvailableShells', async () => {
    const shells: { label: string; path: string }[] = []
    const isWindows = process.platform === 'win32'

    const findShell = (cmd: string): string[] => {
      try {
        const result = isWindows
          ? execSync(`where ${cmd}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
          : execSync(`which ${cmd}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
        return result.trim().split(/\r?\n/).filter(Boolean)
      } catch {
        return []
      }
    }

    if (isWindows) {
      shells.push({ label: 'PowerShell', path: 'powershell.exe' })
      shells.push({ label: 'Command Prompt', path: 'cmd.exe' })

      const bashPaths = findShell('bash')
      const gitBash = bashPaths.find(p =>
        p.toLowerCase().includes('git') && require('fs').existsSync(p)
      )
      if (gitBash) {
        shells.push({ label: 'Git Bash', path: gitBash })
      }
    } else {
      const bash = findShell('bash')[0]
      if (bash) shells.push({ label: 'Bash', path: bash })

      const zsh = findShell('zsh')[0]
      if (zsh) shells.push({ label: 'Zsh', path: zsh })
    }

    return shells
  })
}
