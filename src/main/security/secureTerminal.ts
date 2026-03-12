/**
 * 安全的终端执行模块（替代原有 terminal.ts 中的高危功能）
 */

import { logger } from '@shared/utils/Logger'
import { toAppError } from '@shared/utils/errorHandler'
import { BrowserWindow, ipcMain } from 'electron'
import { spawn, execSync, type ChildProcessWithoutNullStreams } from 'child_process'
import { EventEmitter } from 'events'
import { securityManager, OperationType } from './securityModule'
import { SECURITY_DEFAULTS } from '@shared/constants'
import { safeIpcHandle } from '../ipc/safeHandle'
import { normalizePipeTerminalInput } from './terminalInput'


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

// 白名单配置（已统一到 constants.ts）
let WHITELIST: CommandWhitelist = {
  shell: new Set(SECURITY_DEFAULTS.SHELL_COMMANDS.map(cmd => cmd.toLowerCase())),
  git: new Set(SECURITY_DEFAULTS.GIT_SUBCOMMANDS.map(cmd => cmd.toLowerCase())),
}

// 更新白名单配置
export function updateWhitelist(shellCommands: string[], gitCommands: string[]) {
  WHITELIST.shell = new Set(shellCommands.map(cmd => cmd.toLowerCase()))
  WHITELIST.git = new Set(gitCommands.map(cmd => cmd.toLowerCase()))
  logger.security.info('[Security] Whitelist updated:', {
    shell: Array.from(WHITELIST.shell),
    git: Array.from(WHITELIST.git)
  })
}

// 获取当前白名单
export function getWhitelist() {
  return {
    shell: Array.from(WHITELIST.shell),
    git: Array.from(WHITELIST.git)
  }
}

// Terminal instances storage (模块级别，便于清理)
const terminals = new Map<string, any>() // IPty instances

/**
 * 清理所有终端进程
 */
export function cleanupTerminals(): void {
  for (const [id, ptyProcess] of terminals) {
    try {
      ptyProcess.kill()
    } catch (e) { /* ignore */ }
    terminals.delete(id)
  }
  logger.security.info(`[Terminal] All terminals cleaned up`)
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
      const allowed = WHITELIST.git.has(baseCommand.toLowerCase())
      return {
        safe: allowed,
        reason: allowed ? undefined : `Git子命令"${baseCommand}"不在白名单中`,
      }
    }

    const allowed = WHITELIST.shell.has(baseCommand.toLowerCase())
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
        shell: true, // 启用 shell 以支持 && 等操作，但需依赖白名单和危险模式检测来保证安全
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

      child.on('error', (err) => {
        reject(err)
      })
    })
  }
}

/**
 * 注册安全的终端处理程序
 */
export function registerSecureTerminalHandlers(
  getMainWindow: () => BrowserWindow | null,
  getWorkspace: (event?: Electron.IpcMainInvokeEvent) => { roots: string[] } | null,
  getWindowWorkspace?: (windowId: number) => string[] | null
) {
  /**
   * 安全的命令执行（白名单 + 工作区边界）
   * 替代原来的 shell:execute
   */
  safeIpcHandle('shell:executeSecure', async (
    event,
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
    const workspace = getWorkspace(event)

    if (!mainWindow) {
      return { success: false, error: '主窗口未就绪' }
    }

    // 1. 工作区检查（支持无工作区模式）
    let targetPath: string
    if (workspace) {
      targetPath = cwd || workspace.roots[0]
      if (!securityManager.validateWorkspacePath(targetPath, workspace.roots)) {
        securityManager.logOperation(OperationType.SHELL_EXECUTE, command, false, {
          reason: '路径在工作区外',
          targetPath,
          workspace: workspace.roots,
        })
        return { success: false, error: '不允许在工作区外执行命令' }
      }
    } else {
      // 无工作区模式：使用 cwd 或当前进程工作目录
      targetPath = cwd || process.cwd()
      logger.security.info(`[Security] No workspace set, using: ${targetPath}`)
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
        fullCommand
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
    } catch (err) {
      securityManager.logOperation(OperationType.SHELL_EXECUTE, fullCommand, false, {
        error: toAppError(err).message,
      })
      return {
        success: false,
        error: `执行失败: ${toAppError(err).message}`,
      }
    }
  })

  /**
   * 安全的 Git 命令执行
   * 替代原来的 git:exec（移除 exec 拼接）
   */
  safeIpcHandle('git:execSecure', async (
    event,
    args: string[],
    cwd: string
  ): Promise<{
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
  }> => {
    // 优先使用请求来源窗口的工作区（支持多窗口隔离）
    const windowId = event.sender.id
    const windowRoots = getWindowWorkspace?.(windowId)
    const workspace = windowRoots ? { roots: windowRoots } : getWorkspace()

    // 调试日志：记录 workspace 状态
    logger.security.debug('[Git] Workspace check:', {
      windowId,
      windowRoots: windowRoots || 'null',
      workspaceFromStore: workspace?.roots || 'null',
      cwd,
    })

    // 1. 工作区检查（允许无工作区模式以支持新窗口）
    if (!workspace || workspace.roots.length === 0) {
      // 无工作区时信任传入的cwd路径
      logger.security.info('[Git] No workspace set, trusting cwd:', cwd)
    } else {
      // 2. 验证工作区边界
      if (!securityManager.validateWorkspacePath(cwd, workspace.roots)) {
        logger.security.warn('[Git] Path validation failed:', { cwd, roots: workspace.roots })
        securityManager.logOperation(OperationType.GIT_EXEC, args.join(' '), false, {
          reason: '路径在工作区外',
          cwd,
          workspace: workspace.roots,
        })
        return { success: false, error: '不允许在工作区外执行Git命令' }
      }
    }

    // 2. Git 子命令白名单验证
    if (args.length === 0) {
      return { success: false, error: '缺少Git命令' }
    }

    // 跳过全局选项探测真正的子命令
    let cmdIdx = 0
    while (cmdIdx < args.length && args[cmdIdx].startsWith('-')) {
      if (args[cmdIdx] === '-c' || args[cmdIdx] === '-C') {
        cmdIdx += 2
      } else {
        cmdIdx += 1
      }
    }
    if (cmdIdx >= args.length) {
      return { success: false, error: '未找到Git子命令' }
    }

    const gitSubCommand = args[cmdIdx].toLowerCase()
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
      `git ${fullCommand}`
    )

    if (!hasPermission) {
      securityManager.logOperation(OperationType.GIT_EXEC, fullCommand, false, {
        reason: '用户拒绝',
      })
      return { success: false, error: '用户拒绝执行Git命令' }
    }

    try {
      // 使用 dugite（安全）
      const { GitProcess } = require('dugite')
      const result = await GitProcess.exec(args, cwd)

      securityManager.logOperation(OperationType.GIT_EXEC, fullCommand, true, {
        exitCode: result.exitCode,
      })

      if (result.exitCode !== 0) {
        logger.security.error('[Git] dugite exec failed:', args, result.stderr || result.stdout)
      }

      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      }
    } catch (error) {
      logger.security.warn('[Git] dugite 不可用，尝试安全的 spawn 方式')

      try {
        // 6. 安全回退：使用 spawn 而非 exec
        const result = await SecureCommandParser.executeSecureCommand('git', args, cwd, 120000)

        securityManager.logOperation(OperationType.GIT_EXEC, fullCommand, true, {
          exitCode: result.exitCode,
        })

        if (result.exitCode !== 0) {
          logger.security.error('[Git] spawn exec failed:', args, result.stderr || result.stdout)
        }

        return {
          success: result.exitCode === 0,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        }
      } catch (err) {
        securityManager.logOperation(OperationType.GIT_EXEC, fullCommand, false, {
          error: toAppError(err).message,
        })
        return {
          success: false,
          error: `Git执行失败: ${toAppError(err).message}`,
        }
      }
    }
  })

  // ============ Interactive Terminal with node-pty ============

  const MAX_TERMINALS = 10 // 最大终端数量限制
  let pty: any = null

  // Try to load node-pty
  try {
    pty = require('node-pty')

    // 验证 node-pty 是否可用
    try {
      // 只验证模块加载，不实际创建进程
      if (typeof pty.spawn !== 'function') {
        throw new Error('node-pty.spawn is not a function')
      }
      logger.security.info('[Terminal] node-pty loaded and verified successfully')
    } catch (err) {
      logger.security.error('[Terminal] node-pty verification failed:', err)
      logger.security.error('[Terminal] This usually means node-pty needs to be rebuilt for Electron.')
      logger.security.error('[Terminal] Please run: npm run rebuild')
      pty = null
    }
  } catch (err) {
    const errorMsg = toAppError(err).message || toAppError(err).message || 'Unknown error'
    logger.security.warn('[Terminal] node-pty not available, interactive terminal disabled')
    logger.security.warn('[Terminal] Error:', errorMsg)

    // 检查是否是原生模块加载错误
    if (errorMsg.includes('Cannot find module') || errorMsg.includes('module') || errorMsg.includes('native')) {
      logger.security.error('[Terminal] node-pty native module may need to be rebuilt.')
      logger.security.error('[Terminal] Please run: npm run rebuild')
    }

    pty = null
  }

  type TerminalBackend = 'pty' | 'pipe'

  class PipeShellSession extends EventEmitter {
    constructor(private readonly child: ChildProcessWithoutNullStreams) {
      super()

      this.child.stdout.on('data', (data: Buffer) => {
        this.emit('data', data.toString())
      })

      this.child.stderr.on('data', (data: Buffer) => {
        this.emit('data', data.toString())
      })

      this.child.on('error', (err) => {
        this.emit('error', err)
      })

      this.child.on('close', (code) => {
        this.emit('exit', { exitCode: code ?? 0 })
      })
    }

    onData(listener: (data: string) => void) {
      this.on('data', listener)
      return this
    }

    onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
      this.on('exit', listener)
      return this
    }

    write(data: string) {
      if (data === String.fromCharCode(3)) {
        this.kill('SIGINT')
        return
      }

      if (!this.child.stdin.destroyed) {
        this.child.stdin.write(normalizePipeTerminalInput(data))
      }
    }

    resize(_cols: number, _rows: number) {
      // Pipe-backed sessions do not support PTY resizing.
    }

    kill(signal: NodeJS.Signals = 'SIGTERM') {
      if (this.child.killed) {
        return
      }

      if (process.platform !== 'win32' && this.child.pid) {
        try {
          process.kill(-this.child.pid, signal)
          return
        } catch {
          // Fall back to killing the shell process directly.
        }
      }

      this.child.kill(signal)
    }
  }

  let ssh2ClientCtor: any = null

  const getSsh2ClientCtor = () => {
    if (ssh2ClientCtor) return ssh2ClientCtor

    try {
      const cpuFeaturesPath = require.resolve('cpu-features')
      require.cache[cpuFeaturesPath] = {
        id: cpuFeaturesPath,
        filename: cpuFeaturesPath,
        loaded: true,
        exports: () => null,
        children: [],
        paths: [],
      } as unknown as NodeJS.Module
    } catch {
    }

    ssh2ClientCtor = require('ssh2').Client
    return ssh2ClientCtor
  }

  class SshShellSession extends EventEmitter {
    private connection: any
    private stream: any
    private closed = false
    private cols: number
    private rows: number

    constructor(private readonly server: { host: string; port?: number; username?: string; password?: string; privateKeyPath?: string; remotePath?: string }, cols = 80, rows = 24) {
      super()
      this.cols = cols
      this.rows = rows
      this.connection = null
      this.stream = null
    }

    async connect(): Promise<void> {
      const Client = getSsh2ClientCtor()
      this.connection = new Client()

      const config: Record<string, unknown> = {
        host: this.server.host.trim(),
        port: this.server.port && this.server.port > 0 ? this.server.port : 22,
        username: this.server.username?.trim() || 'root',
        readyTimeout: 15000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        tryKeyboard: Boolean(this.server.password),
      }

      if (this.server.privateKeyPath?.trim()) {
        config.privateKey = require('fs').readFileSync(this.server.privateKeyPath.trim(), 'utf8')
      }
      if (this.server.password?.trim()) {
        config.password = this.server.password
      }

      await new Promise<void>((resolve, reject) => {
        let settled = false
        const finishReject = (error: unknown) => {
          if (settled) return
          settled = true
          reject(error)
        }

        this.connection
          .on('ready', () => {
            this.connection.shell({ term: 'xterm-256color', cols: this.cols, rows: this.rows }, (error: Error | undefined, stream: any) => {
              if (error || !stream) {
                finishReject(error || new Error('Failed to open remote shell'))
                return
              }

              this.stream = stream
              stream.on('data', (data: Buffer | string) => this.emit('data', Buffer.isBuffer(data) ? data.toString() : data))
              stream.on('close', () => {
                if (this.closed) return
                this.closed = true
                this.emit('exit', { exitCode: 0 })
                this.connection.end()
              })
              stream.on('error', (err: unknown) => this.emit('error', err))

              if (this.server.remotePath?.trim()) {
                const escaped = this.server.remotePath.trim().replace(/'/g, `'\''`)
                stream.write(`cd '${escaped}'\n`)
              }

              if (!settled) {
                settled = true
                resolve()
              }
            })
          })
          .on('keyboard-interactive', (_name: string, _instructions: string, _lang: string, _prompts: Array<unknown>, finish: (responses: string[]) => void) => {
            finish([this.server.password || ''])
          })
          .on('error', (error: unknown) => {
            this.emit('error', error)
            finishReject(error)
          })
          .on('close', () => {
            if (this.closed) return
            this.closed = true
            this.emit('exit', { exitCode: 0 })
          })
          .connect(config as any)
      })
    }

    onData(listener: (data: string) => void) {
      this.on('data', listener)
      return this
    }

    onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
      this.on('exit', listener)
      return this
    }

    write(data: string) {
      if (this.stream) {
        this.stream.write(data)
      }
    }

    resize(cols: number, rows: number) {
      this.cols = cols
      this.rows = rows
      try {
        this.stream?.setWindow(rows, cols, 0, 0)
      } catch {
      }
    }

    kill() {
      if (this.closed) return
      this.closed = true
      try {
        this.stream?.end('exit\n')
      } catch {
      }
      try {
        this.connection?.end()
      } catch {
      }
      this.emit('exit', { exitCode: 0 })
    }
  }

  const bindTerminalProcess = (id: string, terminalProcess: any, mainWindow: BrowserWindow | null) => {
    terminals.set(id, terminalProcess)

    terminalProcess.onData((data: string) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:data', { id, data })
      }
    })

    terminalProcess.on('error', (err: any) => {
      logger.security.error(`[Terminal] PTY Error (id: ${id}):`, err)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:error', { id, error: toAppError(err).message })
      }
    })

    terminalProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
      logger.security.info(`[Terminal] Terminal ${id} exited with code ${exitCode}, signal ${signal}`)
      terminals.delete(id)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:exit', { id, exitCode, signal })
      }
    })
  }

  /**
   * 交互式终端创建（默认使用 node-pty；Agent 在 macOS 上可切换为 pipe 会话）
   */
  safeIpcHandle('terminal:interactive', async (
    event,
    options: { id: string; cwd?: string; shell?: string; backend?: TerminalBackend; remote?: { host: string; port?: number; username?: string; password?: string; privateKeyPath?: string; remotePath?: string } }
  ) => {
    const mainWindow = getMainWindow()
    const workspace = getWorkspace(event)
    const { id, cwd, shell, backend = 'pty', remote } = options

    if (backend === 'pty' && !pty) {
      return { success: false, error: 'node-pty not available' }
    }

    if (terminals.size >= MAX_TERMINALS && !terminals.has(id)) {
      return { success: false, error: `Maximum number of terminals (${MAX_TERMINALS}) reached` }
    }

    const targetCwd = (cwd && cwd.trim()) || workspace?.roots?.[0] || process.cwd()

    if (workspace && workspace.roots.length > 0 && !remote?.host && !securityManager.validateWorkspacePath(targetCwd, workspace.roots)) {
      securityManager.logOperation(OperationType.TERMINAL_INTERACTIVE, 'terminal:create', false, {
        reason: '路径在工作区外',
        cwd: targetCwd,
      })
      return { success: false, error: '终端只能在工作区内创建' }
    }

    try {
      const isWindows = process.platform === 'win32'
      const isMac = process.platform === 'darwin'

      let shellPath: string
      let shellArgs: string[] = []

      if (shell) {
        shellPath = shell
      } else if (isWindows) {
        shellPath = 'powershell.exe'
      } else if (isMac) {
        const fs = require('fs')
        const possibleShells = [
          process.env.SHELL,
          '/bin/zsh',
          '/bin/bash',
          '/usr/bin/zsh',
          '/usr/bin/bash',
        ].filter(Boolean) as string[]

        shellPath = possibleShells.find(s => {
          try {
            return fs.existsSync(s)
          } catch {
            return false
          }
        }) || '/bin/bash'

        logger.security.info(`[Terminal] Using shell: ${shellPath}`)
        shellArgs = backend === 'pipe' ? ['-il'] : ['-l']
      } else {
        shellPath = process.env.SHELL || '/bin/bash'
      }

      logger.security.info(`[Terminal] Spawning ${backend.toUpperCase()} terminal: ${shellPath} ${shellArgs.join(' ')} in ${targetCwd}`)

      const fs = require('fs')
      const pathModule = require('path')

      if (pathModule.isAbsolute(shellPath) && !fs.existsSync(shellPath)) {
        const error = `Shell not found: ${shellPath}`
        logger.security.error(`[Terminal] ${error}`)
        return { success: false, error }
      }

      if (!fs.existsSync(targetCwd)) {
        const error = `Working directory not found: ${targetCwd}`
        logger.security.error(`[Terminal] ${error}`)
        return { success: false, error }
      }

      let terminalProcess: any

      if (remote?.host) {
        try {
          const session = new SshShellSession(remote)
          await session.connect()
          terminalProcess = session
        } catch (err) {
          const errorMsg = toAppError(err).message || 'Failed to connect remote shell'
          logger.security.error(`[Terminal] Remote SSH spawn failed: ${errorMsg}`, err)
          return { success: false, error: `Failed to connect remote shell: ${errorMsg}` }
        }
      } else if (backend === 'pipe') {
        const child = spawn(shellPath, shellArgs, {
          cwd: targetCwd,
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
          },
          stdio: 'pipe',
          detached: process.platform !== 'win32',
          windowsHide: true,
        }) as ChildProcessWithoutNullStreams

        terminalProcess = new PipeShellSession(child)
      } else {
        try {
          await new Promise<void>((resolve, reject) => {
            setImmediate(() => {
              try {
                terminalProcess = pty.spawn(shellPath, shellArgs, {
                  name: 'xterm-256color',
                  cols: 80,
                  rows: 24,
                  cwd: targetCwd,
                  env: {
                    ...process.env,
                    TERM: 'xterm-256color',
                    COLORTERM: 'truecolor',
                  },
                })

                if (!terminalProcess) {
                  reject(new Error('PTY process is null after spawn'))
                  return
                }

                resolve()
              } catch (err) {
                reject(err)
              }
            })
          })
        } catch (err) {
          const errorMsg = toAppError(err).message || toAppError(err).message || 'Unknown spawn error'
          logger.security.error(`[Terminal] PTY spawn failed: ${errorMsg}`, err)

          if (errorMsg.includes('Napi::Error') || errorMsg.includes('native') || errorMsg.includes('module') || errorMsg.includes('libc++abi')) {
            return {
              success: false,
              error: 'node-pty native module error. The module may need to be rebuilt for this Electron version. Please run: npm run rebuild'
            }
          }

          return { success: false, error: `Failed to spawn terminal: ${errorMsg}` }
        }
      }

      bindTerminalProcess(id, terminalProcess, mainWindow)

      securityManager.logOperation(OperationType.TERMINAL_INTERACTIVE, 'terminal:create', true, {
        id,
        cwd: targetCwd,
        shell: shellPath,
        backend: remote?.host ? 'ssh2' : backend,
        remoteHost: remote?.host,
      })

      logger.security.info(`[Terminal] Created ${remote?.host ? 'ssh2' : backend} terminal ${id} with shell ${shellPath}`)
      return { success: true }
    } catch (err) {
      logger.security.error('[Terminal] Failed to create terminal:', err)
      return { success: false, error: toAppError(err).message }
    }
  })

  /**
   * 获取可用 shell 列表（通过命令检测）
   */
  safeIpcHandle('shell:getAvailableShells', async () => {
    const shells: { label: string; path: string }[] = []
    const isWindows = process.platform === 'win32'
    const fs = require('fs')
    const pathModule = require('path')

    // 检查命令是否可执行
    const canExecute = (cmd: string): boolean => {
      try {
        execSync(`${cmd} --version`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
          timeout: 3000,
          windowsHide: true,  // Windows 上隐藏控制台窗口
        })
        return true
      } catch {
        return false
      }
    }

    if (isWindows) {
      // PowerShell (always available)
      shells.push({ label: 'PowerShell', path: 'powershell.exe' })

      // Command Prompt (always available)
      shells.push({ label: 'Command Prompt', path: 'cmd.exe' })

      // Git Bash - 通过 git --exec-path 动态获取
      try {
        const gitExecPath = execSync('git --exec-path', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
          windowsHide: true,
        }).trim()
        if (gitExecPath) {
          // e.g., C:\Program Files\Git\mingw64\libexec\git-core -> C:\Program Files\Git\bin\bash.exe
          const gitRoot = pathModule.resolve(gitExecPath, '..', '..', '..')
          const bashPath = pathModule.join(gitRoot, 'bin', 'bash.exe')
          if (fs.existsSync(bashPath)) {
            shells.push({ label: 'Git Bash', path: bashPath })
          }
        }
      } catch {
        // Git 不可用
      }

      // WSL - 直接检测 wsl.exe 是否可用
      if (canExecute('wsl')) {
        shells.push({ label: 'WSL', path: 'wsl.exe' })
      }

      // PowerShell Core (pwsh)
      if (canExecute('pwsh')) {
        shells.push({ label: 'PowerShell Core', path: 'pwsh.exe' })
      }
    } else {
      // Unix: detect common shells
      const unixShells = ['bash', 'zsh', 'fish']
      for (const sh of unixShells) {
        try {
          const result = execSync(`which ${sh}`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
            windowsHide: true,
          })
          if (result.trim()) {
            shells.push({ label: sh.charAt(0).toUpperCase() + sh.slice(1), path: result.trim() })
          }
        } catch { /* not found */ }
      }
    }

    logger.security.info('[Terminal] Available shells:', shells.map(s => s.label).join(', '))
    return shells
  })

  /**
   * Write input to terminal
   */
  safeIpcHandle('terminal:input', async (_, { id, data }: { id: string; data: string }) => {
    const ptyProcess = terminals.get(id)
    if (ptyProcess) {
      try {
        ptyProcess.write(data)
      } catch (err) {
        logger.security.error(`[Terminal] Write error (id: ${id}):`, err)
      }
    }
  })

  /**
   * 后台执行命令（Agent 专用）
   * 使用 child_process.spawn，不依赖 PTY
   * 实时推送输出到前端，精确捕获 exit code
   */
  safeIpcHandle('shell:executeBackground', async (
    event,
    { command, cwd, timeout = 30000, shell: customShell }: {
      command: string
      cwd?: string
      timeout?: number
      shell?: string
    }
  ): Promise<{ success: boolean; output: string; exitCode: number; error?: string }> => {
    const mainWindow = getMainWindow()
    const workspace = getWorkspace(event)
    const workingDir = cwd || workspace?.roots[0] || process.cwd()

    // 验证工作目录
    if (workspace && !securityManager.validateWorkspacePath(workingDir, workspace.roots)) {
      return { success: false, output: '', exitCode: 1, error: 'Working directory outside workspace' }
    }

    return new Promise((resolve) => {
      const isWindows = process.platform === 'win32'
      const shell = customShell || (isWindows ? 'powershell.exe' : '/bin/bash')
      const shellArgs = isWindows
        ? ['-NoProfile', '-NoLogo', '-Command', command]
        : ['-c', command]

      logger.security.info(`[Shell] Executing: ${command} in ${workingDir}`)

      const child = spawn(shell, shellArgs, {
        cwd: workingDir,
        env: { ...process.env, TERM: 'dumb' }, // 禁用颜色输出
        windowsHide: true,
      })

      let stdout = ''
      let stderr = ''
      let timedOut = false

      // 超时处理
      const timeoutId = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        // Windows 上 SIGTERM 可能不够，延迟后强制 kill
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL')
          }
        }, 1000)
      }, timeout)

      // 实时推送输出
      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        stdout += text
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('shell:output', {
            command,
            type: 'stdout',
            data: text,
            timestamp: Date.now()
          })
        }
      })

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        stderr += text
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('shell:output', {
            command,
            type: 'stderr',
            data: text,
            timestamp: Date.now()
          })
        }
      })

      child.on('close', (code, signal) => {
        clearTimeout(timeoutId)

        // 清理输出（移除 ANSI 序列）
        const cleanOutput = (stdout + (stderr ? `\n${stderr}` : ''))
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
          .replace(/\r\n/g, '\n')
          .trim()

        logger.security.info(`[Shell] Command finished: exit=${code}, signal=${signal}`)

        if (timedOut) {
          resolve({
            success: false,
            output: cleanOutput || `Command timed out after ${timeout / 1000}s`,
            exitCode: code ?? 124, // 124 是 timeout 的标准退出码
            error: `Command timed out after ${timeout / 1000}s`
          })
        } else {
          resolve({
            success: code === 0,
            output: cleanOutput,
            exitCode: code ?? 0,
          })
        }
      })

      child.on('error', (err) => {
        clearTimeout(timeoutId)
        logger.security.error(`[Shell] Command error:`, err)
        resolve({
          success: false,
          output: stdout + stderr,
          exitCode: 1,
          error: toAppError(err).message
        })
      })
    })
  })

  /**
   * Resize terminal
   */
  safeIpcHandle('terminal:resize', async (_, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    const ptyProcess = terminals.get(id)
    if (ptyProcess) {
      try {
        ptyProcess.resize(cols, rows)
      } catch (e) {
        // Ignore resize errors
      }
    }
  })

  /**
   * Kill terminal
   */
  ipcMain.on('terminal:kill', (_, id?: string) => {
    if (id) {
      const ptyProcess = terminals.get(id)
      if (ptyProcess) {
        try {
          // Remove listeners to prevent race conditions during kill
          ptyProcess.removeAllListeners('exit')
          ptyProcess.removeAllListeners('data')
          ptyProcess.kill()
        } catch (err) {
          logger.security.error(`[Terminal] Kill error (id: ${id}):`, err)
        }
        terminals.delete(id)
      }
    } else {
      // Kill all terminals
      for (const [termId, ptyProcess] of terminals) {
        try {
          ptyProcess.removeAllListeners('exit')
          ptyProcess.removeAllListeners('data')
          ptyProcess.kill()
        } catch (err) {
          logger.security.error(`[Terminal] Kill error (id: ${termId}):`, err)
        }
        terminals.delete(termId)
      }
    }
  })
}
