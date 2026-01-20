/**
 * LSP 服务器安装器
 * 
 * 功能：
 * - 自动检测已安装的 LSP 服务器
 * - 从 npm/GitHub/包管理器自动下载安装
 * - 支持用户自定义安装路径
 * - 配置持久化
 */

import { app } from 'electron'
import { spawn, execSync } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { logger } from '@shared/utils/Logger'
import Store from 'electron-store'

// ============ 配置持久化 ============

const store = new Store({ name: 'lsp-config' })
const CONFIG_KEY_BIN_DIR = 'lspBinDir'

// 默认 LSP 服务器安装目录
const DEFAULT_LSP_BIN_DIR = path.join(app.getPath('userData'), 'lsp-servers')

/**
 * 设置自定义 LSP 服务器安装目录（持久化）
 */
export function setCustomLspBinDir(customPath: string | null): void {
  if (customPath) {
    store.set(CONFIG_KEY_BIN_DIR, customPath)
  } else {
    store.delete(CONFIG_KEY_BIN_DIR)
  }
  logger.lsp.info(`[LSP Installer] Bin dir set to: ${customPath || 'default'}`)
}

/**
 * 获取当前配置的 LSP 服务器安装目录
 */
export function getLspBinDir(): string {
  const customDir = store.get(CONFIG_KEY_BIN_DIR) as string | undefined
  const dir = customDir || DEFAULT_LSP_BIN_DIR
  
  logger.lsp.debug(`[LSP Installer] Using bin directory: ${dir}`, {
    isCustom: !!customDir,
    defaultDir: DEFAULT_LSP_BIN_DIR,
  })
  
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true })
      logger.lsp.info(`[LSP Installer] Created bin directory: ${dir}`)
    } catch (err: any) {
      logger.lsp.error(`[LSP Installer] Failed to create bin directory: ${dir}`, {
        error: err.message,
      })
      throw new Error(`Failed to create LSP bin directory: ${err.message}`)
    }
  }
  
  return dir
}

/**
 * 获取默认 LSP 服务器安装目录
 */
export function getDefaultLspBinDir(): string {
  return DEFAULT_LSP_BIN_DIR
}

// ============ 工具函数 ============

/**
 * 记录环境信息（用于调试安装问题）
 */
function logEnvironmentInfo(): void {
  logger.lsp.debug('[LSP Installer] Environment Info:', {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH?.slice(0, 200) + '...', // 只记录前 200 字符
      NODE_ENV: process.env.NODE_ENV,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
    },
  })
}

/**
 * 检查命令是否存在于 PATH 中
 */
export function commandExists(cmd: string): boolean {
  try {
    if (process.platform === 'win32') {
      execSync(`where ${cmd}`, { stdio: 'ignore' })
    } else {
      execSync(`which ${cmd}`, { stdio: 'ignore' })
    }
    return true
  } catch {
    return false
  }
}

/**
 * 运行 npm 安装包到指定目录
 */
async function npmInstall(packageName: string, targetDir: string): Promise<boolean> {
  return new Promise((resolve) => {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    logger.lsp.info(`[LSP Installer] Running: npm install ${packageName} in ${targetDir}`)
    logger.lsp.debug(`[LSP Installer] npm command: ${npmCmd}`)
    
    // 检查 npm 是否可用
    if (!commandExists('npm')) {
      logger.lsp.error('[LSP Installer] npm not found in PATH')
      resolve(false)
      return
    }
    
    // 确保目标目录存在
    if (!fs.existsSync(targetDir)) {
      try {
        fs.mkdirSync(targetDir, { recursive: true })
        logger.lsp.debug(`[LSP Installer] Created target directory: ${targetDir}`)
      } catch (err) {
        logger.lsp.error(`[LSP Installer] Failed to create target directory: ${targetDir}`, err)
        resolve(false)
        return
      }
    }
    
    const proc = spawn(npmCmd, ['install', packageName, '--prefix', targetDir], {
      cwd: targetDir,
      stdio: 'pipe',
      shell: true,
    })
    
    let stdout = ''
    let stderr = ''
    
    // 捕获 stdout
    proc.stdout?.on('data', (data) => {
      const text = data.toString()
      stdout += text
      logger.lsp.debug(`[LSP Installer] npm stdout: ${text.trim()}`)
    })
    
    // 捕获 stderr
    proc.stderr?.on('data', (data) => {
      const text = data.toString()
      stderr += text
      logger.lsp.warn(`[LSP Installer] npm stderr: ${text.trim()}`)
    })
    
    proc.on('close', (code) => {
      if (code === 0) {
        logger.lsp.info(`[LSP Installer] npm install succeeded for ${packageName}`)
        resolve(true)
      } else {
        logger.lsp.error(`[LSP Installer] npm install failed with code ${code}`, {
          packageName,
          targetDir,
          stdout: stdout.slice(-500), // 最后 500 字符
          stderr: stderr.slice(-500),
        })
        resolve(false)
      }
    })
    
    proc.on('error', (err) => {
      logger.lsp.error(`[LSP Installer] npm process error:`, {
        error: err.message,
        packageName,
        targetDir,
        npmCmd,
      })
      resolve(false)
    })
  })
}

/**
 * 下载文件
 */
async function downloadFile(url: string, destPath: string): Promise<boolean> {
  try {
    logger.lsp.info(`[LSP Installer] Downloading: ${url}`)
    logger.lsp.debug(`[LSP Installer] Destination: ${destPath}`)
    
    const response = await fetch(url)
    
    if (!response.ok) {
      logger.lsp.error(`[LSP Installer] Download failed: HTTP ${response.status} ${response.statusText}`, {
        url,
        status: response.status,
        statusText: response.statusText,
      })
      return false
    }
    
    logger.lsp.debug(`[LSP Installer] Download response OK, reading buffer...`)
    const buffer = await response.arrayBuffer()
    const sizeInMB = (buffer.byteLength / 1024 / 1024).toFixed(2)
    logger.lsp.debug(`[LSP Installer] Downloaded ${sizeInMB} MB`)
    
    // 确保目标目录存在
    const destDir = path.dirname(destPath)
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
      logger.lsp.debug(`[LSP Installer] Created destination directory: ${destDir}`)
    }
    
    // 写入文件
    fs.writeFileSync(destPath, Buffer.from(buffer))
    logger.lsp.info(`[LSP Installer] File saved: ${destPath} (${sizeInMB} MB)`)
    
    // 验证文件是否存在
    if (!fs.existsSync(destPath)) {
      logger.lsp.error(`[LSP Installer] File verification failed: ${destPath} does not exist after write`)
      return false
    }
    
    return true
  } catch (err: any) {
    logger.lsp.error(`[LSP Installer] Download failed with exception:`, {
      error: err.message,
      stack: err.stack,
      url,
      destPath,
    })
    return false
  }
}

/**
 * 解压 ZIP 文件
 */
async function extractZip(zipPath: string, destDir: string): Promise<boolean> {
  try {
    logger.lsp.info(`[LSP Installer] Extracting ZIP: ${zipPath}`)
    logger.lsp.debug(`[LSP Installer] Extract destination: ${destDir}`)
    
    // 验证 ZIP 文件存在
    if (!fs.existsSync(zipPath)) {
      logger.lsp.error(`[LSP Installer] ZIP file not found: ${zipPath}`)
      return false
    }
    
    // 获取文件大小
    const stats = fs.statSync(zipPath)
    const sizeInMB = (stats.size / 1024 / 1024).toFixed(2)
    logger.lsp.debug(`[LSP Installer] ZIP file size: ${sizeInMB} MB`)
    
    // 确保目标目录存在
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
      logger.lsp.debug(`[LSP Installer] Created extract directory: ${destDir}`)
    }
    
    const AdmZip = (await import('adm-zip')).default
    const zip = new AdmZip(zipPath)
    
    // 获取 ZIP 内容信息
    const entries = zip.getEntries()
    logger.lsp.debug(`[LSP Installer] ZIP contains ${entries.length} entries`)
    
    zip.extractAllTo(destDir, true)
    logger.lsp.info(`[LSP Installer] ZIP extracted successfully to ${destDir}`)
    
    return true
  } catch (err: any) {
    logger.lsp.error(`[LSP Installer] Extract failed with exception:`, {
      error: err.message,
      stack: err.stack,
      zipPath,
      destDir,
    })
    return false
  }
}

/**
 * 解压 tar.xz 文件（跨平台）
 */
async function extractTarXz(archivePath: string, destDir: string): Promise<boolean> {
  try {
    logger.lsp.info(`[LSP Installer] Extracting tar.xz: ${archivePath}`)
    logger.lsp.debug(`[LSP Installer] Extract destination: ${destDir}`)
    
    // 验证文件存在
    if (!fs.existsSync(archivePath)) {
      logger.lsp.error(`[LSP Installer] Archive file not found: ${archivePath}`)
      return false
    }
    
    // 获取文件大小
    const stats = fs.statSync(archivePath)
    const sizeInMB = (stats.size / 1024 / 1024).toFixed(2)
    logger.lsp.debug(`[LSP Installer] Archive size: ${sizeInMB} MB`)
    
    // 确保目标目录存在
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
      logger.lsp.debug(`[LSP Installer] Created extract directory: ${destDir}`)
    }
    
    if (process.platform === 'win32') {
      // Windows: 使用 tar 命令（Windows 10 1803+ 内置）
      logger.lsp.debug('[LSP Installer] Using Windows tar command')
      try {
        const output = execSync(`tar -xf "${archivePath}"`, { 
          cwd: destDir, 
          stdio: 'pipe',
          encoding: 'utf-8',
        })
        logger.lsp.debug(`[LSP Installer] tar output: ${output}`)
        logger.lsp.info('[LSP Installer] tar.xz extracted successfully (Windows)')
        return true
      } catch (err: any) {
        logger.lsp.error('[LSP Installer] tar command failed on Windows:', {
          error: err.message,
          stderr: err.stderr?.toString(),
          stdout: err.stdout?.toString(),
        })
        logger.lsp.warn('[LSP Installer] Please ensure tar is available (Windows 10 1803+ or install 7-Zip)')
        return false
      }
    } else {
      // Unix: 使用 tar 命令
      logger.lsp.debug('[LSP Installer] Using Unix tar command')
      
      // 检查 tar 命令是否可用
      if (!commandExists('tar')) {
        logger.lsp.error('[LSP Installer] tar not found in PATH')
        return false
      }
      
      try {
        const output = execSync(`tar -xf "${archivePath}"`, { 
          cwd: destDir, 
          stdio: 'pipe',
          encoding: 'utf-8',
        })
        logger.lsp.debug(`[LSP Installer] tar output: ${output}`)
        logger.lsp.info('[LSP Installer] tar.xz extracted successfully (Unix)')
        return true
      } catch (err: any) {
        logger.lsp.error('[LSP Installer] tar command failed on Unix:', {
          error: err.message,
          stderr: err.stderr?.toString(),
          stdout: err.stdout?.toString(),
        })
        return false
      }
    }
  } catch (err: any) {
    logger.lsp.error('[LSP Installer] Extract tar.xz failed with exception:', {
      error: err.message,
      stack: err.stack,
      archivePath,
      destDir,
    })
    return false
  }
}

/**
 * 设置文件可执行权限 (Unix)
 */
function setExecutable(filePath: string): void {
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(filePath, 0o755)
      logger.lsp.debug(`[LSP Installer] Set executable permission: ${filePath}`)
    } catch (err: any) {
      logger.lsp.warn(`[LSP Installer] Failed to set executable permission: ${filePath}`, {
        error: err.message,
      })
    }
  }
}

// ============ 路径查找（统一逻辑） ============

// 内置 node_modules 的基础路径
function getBuiltinBases(): string[] {
  return [
    path.join(process.cwd(), 'node_modules'),
    path.join(__dirname, '..', '..', 'node_modules'),
    path.join(__dirname, '..', 'node_modules'),
    path.join(app.getAppPath(), 'node_modules'),
    path.join(process.resourcesPath || '', 'app.asar', 'node_modules'),
    path.join(process.resourcesPath || '', 'app', 'node_modules'),
  ]
}

/**
 * 在内置 node_modules 中查找模块
 */
export function findBuiltinModule(moduleName: string, subPath: string): string | null {
  for (const base of getBuiltinBases()) {
    const fullPath = path.join(base, moduleName, subPath)
    if (fs.existsSync(fullPath)) {
      logger.lsp.debug(`[LSP] Found ${moduleName} at: ${fullPath}`)
      return fullPath
    }
  }
  return null
}

// ============ 服务器路径配置 ============

interface ServerPathConfig {
  // 用户安装目录下的相对路径
  userPaths: string[]
  // 内置 node_modules 下的相对路径
  builtinPaths: string[]
  // 系统命令名（用于检查 PATH）
  systemCommand?: string
}

const SERVER_PATHS: Record<string, ServerPathConfig> = {
  typescript: {
    userPaths: [
      'node_modules/typescript-language-server/lib/cli.mjs',
      'node_modules/typescript-language-server/lib/cli.js',
    ],
    builtinPaths: [
      'typescript-language-server/lib/cli.mjs',
      'typescript-language-server/lib/cli.js',
    ],
  },
  html: {
    userPaths: [
      'node_modules/vscode-langservers-extracted/bin/vscode-html-language-server',
      'node_modules/vscode-langservers-extracted/bin/vscode-html-language-server.js',
    ],
    builtinPaths: [
      'vscode-langservers-extracted/bin/vscode-html-language-server',
      'vscode-langservers-extracted/bin/vscode-html-language-server.js',
    ],
  },
  css: {
    userPaths: [
      'node_modules/vscode-langservers-extracted/bin/vscode-css-language-server',
      'node_modules/vscode-langservers-extracted/bin/vscode-css-language-server.js',
    ],
    builtinPaths: [
      'vscode-langservers-extracted/bin/vscode-css-language-server',
      'vscode-langservers-extracted/bin/vscode-css-language-server.js',
    ],
  },
  json: {
    userPaths: [
      'node_modules/vscode-langservers-extracted/bin/vscode-json-language-server',
      'node_modules/vscode-langservers-extracted/bin/vscode-json-language-server.js',
    ],
    builtinPaths: [
      'vscode-langservers-extracted/bin/vscode-json-language-server',
      'vscode-langservers-extracted/bin/vscode-json-language-server.js',
    ],
  },
  python: {
    userPaths: ['node_modules/pyright/dist/pyright-langserver.js'],
    builtinPaths: ['pyright/dist/pyright-langserver.js'],
    systemCommand: 'pylsp',
  },
  vue: {
    userPaths: ['node_modules/@vue/language-server/bin/vue-language-server.js'],
    builtinPaths: ['@vue/language-server/bin/vue-language-server.js'],
    systemCommand: 'vue-language-server',
  },
  go: {
    userPaths: [`gopls${process.platform === 'win32' ? '.exe' : ''}`],
    builtinPaths: [],
    systemCommand: 'gopls',
  },
  rust: {
    userPaths: [],
    builtinPaths: [],
    systemCommand: 'rust-analyzer',
  },
  clangd: {
    userPaths: [
      `clangd${process.platform === 'win32' ? '.exe' : ''}`,
      // clangd 下载后可能在子目录
      `clangd_*/bin/clangd${process.platform === 'win32' ? '.exe' : ''}`,
    ],
    builtinPaths: [],
    systemCommand: 'clangd',
  },
  zig: {
    userPaths: [`zls${process.platform === 'win32' ? '.exe' : ''}`],
    builtinPaths: [],
    systemCommand: 'zls',
  },
  csharp: {
    userPaths: [`csharp-ls${process.platform === 'win32' ? '.exe' : ''}`],
    builtinPaths: [],
    systemCommand: 'csharp-ls',
  },
  deno: {
    userPaths: [],
    builtinPaths: [],
    systemCommand: 'deno',
  },
}

/**
 * 获取已安装的 LSP 服务器路径（统一入口）
 */
export function getInstalledServerPath(serverType: string): string | null {
  const config = SERVER_PATHS[serverType]
  if (!config) return null

  const binDir = getLspBinDir()

  // 1. 检查用户安装目录
  for (const p of config.userPaths) {
    // 处理通配符路径（如 clangd_*/bin/clangd）
    if (p.includes('*')) {
      const [prefix] = p.split('*')
      const parentDir = path.join(binDir, path.dirname(prefix))
      if (fs.existsSync(parentDir)) {
        const entries = fs.readdirSync(parentDir)
        for (const entry of entries) {
          if (entry.startsWith(path.basename(prefix))) {
            const fullPath = path.join(parentDir, entry, p.split('*/')[1] || '')
            if (fs.existsSync(fullPath)) return fullPath
          }
        }
      }
    } else {
      const fullPath = path.join(binDir, p)
      if (fs.existsSync(fullPath)) return fullPath
    }
  }

  // 2. 检查内置 node_modules
  for (const base of getBuiltinBases()) {
    for (const subPath of config.builtinPaths) {
      const fullPath = path.join(base, subPath)
      if (fs.existsSync(fullPath)) return fullPath
    }
  }

  // 3. 检查系统 PATH
  if (config.systemCommand && commandExists(config.systemCommand)) {
    return config.systemCommand
  }

  return null
}

// ============ 安装结果类型 ============

export interface LspInstallResult {
  success: boolean
  path?: string
  error?: string
}

// ============ 各语言服务器安装函数 ============

/**
 * 安装 TypeScript Language Server
 */
export async function installTypeScriptServer(): Promise<LspInstallResult> {
  logger.lsp.info('[LSP Installer] Starting TypeScript Language Server installation')
  logEnvironmentInfo()
  
  const existing = getInstalledServerPath('typescript')
  if (existing) {
    logger.lsp.info(`[LSP Installer] TypeScript server already installed at: ${existing}`)
    return { success: true, path: existing }
  }

  const binDir = getLspBinDir()
  logger.lsp.info(`[LSP Installer] Installing to: ${binDir}`)
  
  const success = await npmInstall('typescript-language-server typescript', binDir)
  
  if (success) {
    logger.lsp.debug('[LSP Installer] npm install completed, verifying installation...')
    const serverPath = getInstalledServerPath('typescript')
    if (serverPath) {
      logger.lsp.info(`[LSP Installer] typescript-language-server installed successfully at: ${serverPath}`)
      return { success: true, path: serverPath }
    } else {
      logger.lsp.error('[LSP Installer] Installation succeeded but server binary not found', {
        binDir,
        expectedPaths: SERVER_PATHS.typescript.userPaths,
      })
      return { success: false, error: 'Server binary not found after installation. Check installation directory.' }
    }
  }
  
  logger.lsp.error('[LSP Installer] npm install failed for typescript-language-server')
  return { success: false, error: 'npm install failed. Check logs for details.' }
}

/**
 * 安装 VSCode Language Servers (HTML/CSS/JSON)
 */
export async function installVscodeLanguageServers(): Promise<LspInstallResult> {
  logger.lsp.info('[LSP Installer] Starting VSCode Language Servers installation')
  logEnvironmentInfo()
  
  const existing = getInstalledServerPath('html')
  if (existing) {
    logger.lsp.info(`[LSP Installer] VSCode servers already installed at: ${existing}`)
    return { success: true, path: existing }
  }

  const binDir = getLspBinDir()
  logger.lsp.info(`[LSP Installer] Installing to: ${binDir}`)
  
  const success = await npmInstall('vscode-langservers-extracted', binDir)
  
  if (success) {
    logger.lsp.debug('[LSP Installer] npm install completed, verifying installation...')
    const serverPath = getInstalledServerPath('html')
    if (serverPath) {
      logger.lsp.info(`[LSP Installer] vscode-langservers-extracted installed successfully at: ${serverPath}`)
      return { success: true, path: serverPath }
    } else {
      logger.lsp.error('[LSP Installer] Installation succeeded but server binary not found', {
        binDir,
        expectedPaths: SERVER_PATHS.html.userPaths,
      })
      return { success: false, error: 'Server binary not found after installation. Check installation directory.' }
    }
  }
  
  logger.lsp.error('[LSP Installer] npm install failed for vscode-langservers-extracted')
  return { success: false, error: 'npm install failed. Check logs for details.' }
}

/**
 * 安装 Pyright (Python LSP)
 */
export async function installPyright(): Promise<LspInstallResult> {
  logger.lsp.info('[LSP Installer] Starting Pyright installation')
  logEnvironmentInfo()
  
  const existing = getInstalledServerPath('python')
  if (existing) {
    logger.lsp.info(`[LSP Installer] Pyright already installed at: ${existing}`)
    return { success: true, path: existing }
  }

  const binDir = getLspBinDir()
  logger.lsp.info(`[LSP Installer] Installing to: ${binDir}`)
  
  const success = await npmInstall('pyright', binDir)
  
  if (success) {
    logger.lsp.debug('[LSP Installer] npm install completed, verifying installation...')
    const serverPath = getInstalledServerPath('python')
    if (serverPath) {
      logger.lsp.info(`[LSP Installer] pyright installed successfully at: ${serverPath}`)
      return { success: true, path: serverPath }
    } else {
      logger.lsp.error('[LSP Installer] Installation succeeded but server binary not found', {
        binDir,
        expectedPaths: SERVER_PATHS.python.userPaths,
      })
      return { success: false, error: 'Server binary not found after installation. Check installation directory.' }
    }
  }
  
  logger.lsp.error('[LSP Installer] npm install failed for pyright')
  return { success: false, error: 'npm install failed. Check logs for details.' }
}

/**
 * 安装 Vue Language Server
 */
export async function installVueServer(): Promise<LspInstallResult> {
  logger.lsp.info('[LSP Installer] Starting Vue Language Server installation')
  logEnvironmentInfo()
  
  const existing = getInstalledServerPath('vue')
  if (existing) {
    logger.lsp.info(`[LSP Installer] Vue server already installed at: ${existing}`)
    return { success: true, path: existing }
  }

  const binDir = getLspBinDir()
  logger.lsp.info(`[LSP Installer] Installing to: ${binDir}`)
  
  const success = await npmInstall('@vue/language-server', binDir)
  
  if (success) {
    logger.lsp.debug('[LSP Installer] npm install completed, verifying installation...')
    const serverPath = getInstalledServerPath('vue')
    if (serverPath) {
      logger.lsp.info(`[LSP Installer] @vue/language-server installed successfully at: ${serverPath}`)
      return { success: true, path: serverPath }
    } else {
      logger.lsp.error('[LSP Installer] Installation succeeded but server binary not found', {
        binDir,
        expectedPaths: SERVER_PATHS.vue.userPaths,
      })
      return { success: false, error: 'Server binary not found after installation. Check installation directory.' }
    }
  }
  
  logger.lsp.error('[LSP Installer] npm install failed for @vue/language-server')
  return { success: false, error: 'npm install failed. Check logs for details.' }
}

/**
 * 安装 gopls (Go LSP)
 */
export async function installGopls(): Promise<LspInstallResult> {
  logger.lsp.info('[LSP Installer] Starting gopls installation')
  logEnvironmentInfo()
  
  const existing = getInstalledServerPath('go')
  if (existing) {
    logger.lsp.info(`[LSP Installer] gopls already installed at: ${existing}`)
    return { success: true, path: existing }
  }

  if (!commandExists('go')) {
    const errorMsg = 'Go is not installed. Please install Go first from https://go.dev/dl/'
    logger.lsp.error('[LSP Installer] Go not found in PATH', { error: errorMsg })
    return { success: false, error: errorMsg }
  }

  const binDir = getLspBinDir()
  const ext = process.platform === 'win32' ? '.exe' : ''
  const goplsPath = path.join(binDir, 'gopls' + ext)
  
  logger.lsp.info(`[LSP Installer] Installing gopls to: ${binDir}`)
  logger.lsp.debug(`[LSP Installer] Expected binary path: ${goplsPath}`)

  return new Promise((resolve) => {
    const proc = spawn('go', ['install', 'golang.org/x/tools/gopls@latest'], {
      env: { ...process.env, GOBIN: binDir },
      stdio: 'pipe',
    })

    let stdout = ''
    let stderr = ''
    
    proc.stdout?.on('data', (data) => {
      const text = data.toString()
      stdout += text
      logger.lsp.debug(`[LSP Installer] go install stdout: ${text.trim()}`)
    })
    
    proc.stderr?.on('data', (data) => {
      const text = data.toString()
      stderr += text
      logger.lsp.warn(`[LSP Installer] go install stderr: ${text.trim()}`)
    })

    proc.on('close', (code) => {
      if (code === 0) {
        logger.lsp.debug('[LSP Installer] go install completed, verifying binary...')
        
        if (fs.existsSync(goplsPath)) {
          setExecutable(goplsPath)
          logger.lsp.info(`[LSP Installer] gopls installed successfully at: ${goplsPath}`)
          resolve({ success: true, path: goplsPath })
        } else {
          logger.lsp.error('[LSP Installer] gopls binary not found after installation', {
            expectedPath: goplsPath,
            binDir,
            dirContents: fs.existsSync(binDir) ? fs.readdirSync(binDir) : [],
          })
          resolve({ success: false, error: 'gopls binary not found after installation. Check GOBIN path.' })
        }
      } else {
        logger.lsp.error(`[LSP Installer] go install failed with code ${code}`, {
          stdout: stdout.slice(-500),
          stderr: stderr.slice(-500),
        })
        resolve({ success: false, error: `go install failed with code ${code}. Check logs for details.` })
      }
    })

    proc.on('error', (err) => {
      logger.lsp.error('[LSP Installer] go install process error:', {
        error: err.message,
        binDir,
      })
      resolve({ success: false, error: `Process error: ${err.message}` })
    })
  })
}


/**
 * 安装 clangd (C/C++ LSP)
 * 从 GitHub Releases 下载预编译二进制
 */
export async function installClangd(): Promise<LspInstallResult> {
  logger.lsp.info('[LSP Installer] Starting clangd installation')
  logEnvironmentInfo()
  
  const existing = getInstalledServerPath('clangd')
  if (existing) {
    logger.lsp.info(`[LSP Installer] clangd already installed at: ${existing}`)
    return { success: true, path: existing }
  }

  const binDir = getLspBinDir()
  logger.lsp.info(`[LSP Installer] Installing to: ${binDir}`)
  logger.lsp.info('[LSP Installer] Downloading clangd from GitHub...')

  try {
    // 获取最新 release 信息
    logger.lsp.debug('[LSP Installer] Fetching latest clangd release info...')
    const releaseRes = await fetch('https://api.github.com/repos/clangd/clangd/releases/latest')
    
    if (!releaseRes.ok) {
      logger.lsp.error(`[LSP Installer] Failed to fetch clangd release info: HTTP ${releaseRes.status}`, {
        status: releaseRes.status,
        statusText: releaseRes.statusText,
      })
      return { success: false, error: `Failed to fetch release info: HTTP ${releaseRes.status}` }
    }

    const release = await releaseRes.json() as { tag_name?: string; assets?: Array<{ name: string; browser_download_url: string }> }
    const tag = release.tag_name
    
    if (!tag) {
      logger.lsp.error('[LSP Installer] No tag found in clangd release')
      return { success: false, error: 'No release tag found' }
    }
    
    logger.lsp.info(`[LSP Installer] Latest clangd version: ${tag}`)

    // 确定平台和架构
    let platform: string
    if (process.platform === 'darwin') {
      platform = process.arch === 'arm64' ? 'mac-arm64' : 'mac'
    } else if (process.platform === 'linux') {
      platform = 'linux'
    } else if (process.platform === 'win32') {
      platform = 'windows'
    } else {
      logger.lsp.error(`[LSP Installer] Unsupported platform: ${process.platform}`)
      return { success: false, error: `Unsupported platform: ${process.platform}` }
    }
    
    logger.lsp.debug(`[LSP Installer] Target platform: ${platform}`)

    // 查找对应的 asset
    const assets = release.assets || []
    logger.lsp.debug(`[LSP Installer] Found ${assets.length} assets in release`)
    
    const asset = assets.find(a => 
      a.name.includes(platform) && 
      a.name.endsWith('.zip')
    )
    
    if (!asset) {
      logger.lsp.error(`[LSP Installer] No clangd asset found for ${platform}`, {
        availableAssets: assets.map(a => a.name),
      })
      return { success: false, error: `No clangd binary available for ${platform}` }
    }
    
    logger.lsp.info(`[LSP Installer] Found asset: ${asset.name}`)

    // 下载
    const zipPath = path.join(binDir, asset.name)
    const downloaded = await downloadFile(asset.browser_download_url, zipPath)
    
    if (!downloaded) {
      return { success: false, error: 'Failed to download clangd. Check network connection.' }
    }

    // 解压
    logger.lsp.info('[LSP Installer] Extracting clangd...')
    const extracted = await extractZip(zipPath, binDir)
    
    // 删除 zip
    try {
      fs.unlinkSync(zipPath)
      logger.lsp.debug(`[LSP Installer] Cleaned up archive: ${zipPath}`)
    } catch (err) {
      logger.lsp.warn(`[LSP Installer] Failed to delete archive: ${zipPath}`, err)
    }
    
    if (!extracted) {
      return { success: false, error: 'Failed to extract clangd archive' }
    }

    // 查找解压后的二进制
    logger.lsp.debug('[LSP Installer] Searching for clangd binary...')
    const clangdPath = getInstalledServerPath('clangd')
    
    if (clangdPath) {
      setExecutable(clangdPath)
      logger.lsp.info(`[LSP Installer] clangd installed successfully at: ${clangdPath}`)
      return { success: true, path: clangdPath }
    }

    logger.lsp.error('[LSP Installer] clangd binary not found after extraction', {
      binDir,
      dirContents: fs.existsSync(binDir) ? fs.readdirSync(binDir) : [],
    })
    return { success: false, error: 'clangd binary not found after extraction. Check installation directory.' }
  } catch (err: any) {
    logger.lsp.error('[LSP Installer] clangd installation failed with exception:', {
      error: err.message,
      stack: err.stack,
    })
    return { success: false, error: `Installation error: ${err.message}` }
  }
}

/**
 * 安装 zls (Zig LSP)
 * 从 GitHub Releases 下载预编译二进制
 */
export async function installZls(): Promise<LspInstallResult> {
  logger.lsp.info('[LSP Installer] Starting zls installation')
  logEnvironmentInfo()
  
  const existing = getInstalledServerPath('zig')
  if (existing) {
    logger.lsp.info(`[LSP Installer] zls already installed at: ${existing}`)
    return { success: true, path: existing }
  }

  // 检查 Zig 是否已安装
  if (!commandExists('zig')) {
    const errorMsg = 'Zig is not installed. Please install Zig first from https://ziglang.org/download/'
    logger.lsp.error('[LSP Installer] Zig not found in PATH', { error: errorMsg })
    return { success: false, error: errorMsg }
  }

  const binDir = getLspBinDir()
  logger.lsp.info(`[LSP Installer] Installing to: ${binDir}`)
  logger.lsp.info('[LSP Installer] Downloading zls from GitHub...')

  try {
    logger.lsp.debug('[LSP Installer] Fetching latest zls release info...')
    const releaseRes = await fetch('https://api.github.com/repos/zigtools/zls/releases/latest')
    
    if (!releaseRes.ok) {
      logger.lsp.error(`[LSP Installer] Failed to fetch zls release info: HTTP ${releaseRes.status}`, {
        status: releaseRes.status,
        statusText: releaseRes.statusText,
      })
      return { success: false, error: `Failed to fetch release info: HTTP ${releaseRes.status}` }
    }

    const release = await releaseRes.json() as { assets?: Array<{ name: string; browser_download_url: string }> }

    // 确定平台和架构
    const archMap: Record<string, string> = { x64: 'x86_64', arm64: 'aarch64', ia32: 'x86' }
    const platformMap: Record<string, string> = { darwin: 'macos', linux: 'linux', win32: 'windows' }
    
    const arch = archMap[process.arch] || process.arch
    const platform = platformMap[process.platform]
    
    if (!platform) {
      logger.lsp.error(`[LSP Installer] Unsupported platform: ${process.platform}`)
      return { success: false, error: `Unsupported platform: ${process.platform}` }
    }
    
    logger.lsp.debug(`[LSP Installer] Target: ${arch}-${platform}`)

    // Windows 使用 zip，其他平台使用 tar.xz
    const extType = process.platform === 'win32' ? 'zip' : 'tar.xz'
    const assetName = `zls-${arch}-${platform}.${extType}`
    logger.lsp.debug(`[LSP Installer] Looking for asset: ${assetName}`)

    const assets = release.assets || []
    logger.lsp.debug(`[LSP Installer] Found ${assets.length} assets in release`)
    
    const asset = assets.find(a => a.name === assetName)
    
    if (!asset) {
      logger.lsp.error(`[LSP Installer] No zls asset found: ${assetName}`, {
        availableAssets: assets.map(a => a.name),
      })
      return { success: false, error: `No zls binary available for ${arch}-${platform}` }
    }
    
    logger.lsp.info(`[LSP Installer] Found asset: ${asset.name}`)

    // 下载
    const archivePath = path.join(binDir, asset.name)
    const downloaded = await downloadFile(asset.browser_download_url, archivePath)
    
    if (!downloaded) {
      return { success: false, error: 'Failed to download zls. Check network connection.' }
    }

    // 解压
    logger.lsp.info('[LSP Installer] Extracting zls...')
    let extractSuccess = false
    
    if (extType === 'zip') {
      extractSuccess = await extractZip(archivePath, binDir)
    } else {
      extractSuccess = await extractTarXz(archivePath, binDir)
    }
    
    // 清理下载的压缩包
    try {
      fs.unlinkSync(archivePath)
      logger.lsp.debug(`[LSP Installer] Cleaned up archive: ${archivePath}`)
    } catch (err) {
      logger.lsp.warn(`[LSP Installer] Failed to delete archive: ${archivePath}`, err)
    }
    
    if (!extractSuccess) {
      return { success: false, error: 'Failed to extract zls archive' }
    }

    // 查找解压后的二进制
    logger.lsp.debug('[LSP Installer] Searching for zls binary...')
    const ext = process.platform === 'win32' ? '.exe' : ''
    const zlsPath = path.join(binDir, 'zls' + ext)
    
    if (fs.existsSync(zlsPath)) {
      setExecutable(zlsPath)
      logger.lsp.info(`[LSP Installer] zls installed successfully at: ${zlsPath}`)
      return { success: true, path: zlsPath }
    }

    logger.lsp.error('[LSP Installer] zls binary not found after extraction', {
      expectedPath: zlsPath,
      binDir,
      dirContents: fs.existsSync(binDir) ? fs.readdirSync(binDir) : [],
    })
    return { success: false, error: 'zls binary not found after extraction. Check installation directory.' }
  } catch (err: any) {
    logger.lsp.error('[LSP Installer] zls installation failed with exception:', {
      error: err.message,
      stack: err.stack,
    })
    return { success: false, error: `Installation error: ${err.message}` }
  }
}

/**
 * 安装 csharp-ls (C# LSP)
 * 通过 dotnet tool 安装
 */
export async function installCsharpLs(): Promise<LspInstallResult> {
  logger.lsp.info('[LSP Installer] Starting csharp-ls installation')
  logEnvironmentInfo()
  
  const existing = getInstalledServerPath('csharp')
  if (existing) {
    logger.lsp.info(`[LSP Installer] csharp-ls already installed at: ${existing}`)
    return { success: true, path: existing }
  }

  if (!commandExists('dotnet')) {
    const errorMsg = '.NET SDK is not installed. Please install .NET from https://dotnet.microsoft.com/download'
    logger.lsp.error('[LSP Installer] .NET SDK not found in PATH', { error: errorMsg })
    return { success: false, error: errorMsg }
  }

  const binDir = getLspBinDir()
  const ext = process.platform === 'win32' ? '.exe' : ''
  const csharpLsPath = path.join(binDir, 'csharp-ls' + ext)
  
  logger.lsp.info(`[LSP Installer] Installing csharp-ls to: ${binDir}`)
  logger.lsp.debug(`[LSP Installer] Expected binary path: ${csharpLsPath}`)

  return new Promise((resolve) => {
    const proc = spawn('dotnet', ['tool', 'install', 'csharp-ls', '--tool-path', binDir], {
      stdio: 'pipe',
    })

    let stdout = ''
    let stderr = ''
    
    proc.stdout?.on('data', (data) => {
      const text = data.toString()
      stdout += text
      logger.lsp.debug(`[LSP Installer] dotnet tool stdout: ${text.trim()}`)
    })
    
    proc.stderr?.on('data', (data) => {
      const text = data.toString()
      stderr += text
      logger.lsp.warn(`[LSP Installer] dotnet tool stderr: ${text.trim()}`)
    })

    proc.on('close', (code) => {
      logger.lsp.debug(`[LSP Installer] dotnet tool exited with code ${code}`)
      
      if (fs.existsSync(csharpLsPath)) {
        setExecutable(csharpLsPath)
        logger.lsp.info(`[LSP Installer] csharp-ls installed successfully at: ${csharpLsPath}`)
        resolve({ success: true, path: csharpLsPath })
      } else if (code === 0) {
        // 可能已安装，检查系统 PATH
        logger.lsp.debug('[LSP Installer] Binary not in tool-path, checking system PATH...')
        const existing = getInstalledServerPath('csharp')
        if (existing) {
          logger.lsp.info(`[LSP Installer] csharp-ls found in system PATH: ${existing}`)
          resolve({ success: true, path: existing })
        } else {
          logger.lsp.error('[LSP Installer] csharp-ls not found after installation', {
            expectedPath: csharpLsPath,
            binDir,
            dirContents: fs.existsSync(binDir) ? fs.readdirSync(binDir) : [],
          })
          resolve({ success: false, error: 'csharp-ls not found after installation. Check tool-path.' })
        }
      } else {
        logger.lsp.error(`[LSP Installer] dotnet tool install failed with code ${code}`, {
          stdout: stdout.slice(-500),
          stderr: stderr.slice(-500),
        })
        resolve({ success: false, error: `dotnet tool install failed with code ${code}. Check logs for details.` })
      }
    })

    proc.on('error', (err) => {
      logger.lsp.error('[LSP Installer] dotnet tool process error:', {
        error: err.message,
        binDir,
      })
      resolve({ success: false, error: `Process error: ${err.message}` })
    })
  })
}

// ============ 统一安装入口 ============

/**
 * 根据服务器 ID 安装对应的 LSP 服务器
 */
export async function installServer(serverId: string): Promise<LspInstallResult> {
  logger.lsp.info(`[LSP Installer] Install request for server: ${serverId}`)
  
  switch (serverId) {
    case 'typescript':
      return installTypeScriptServer()
    case 'html':
    case 'css':
    case 'json':
      return installVscodeLanguageServers()
    case 'python':
      return installPyright()
    case 'vue':
      return installVueServer()
    case 'go':
      return installGopls()
    case 'clangd':
      return installClangd()
    case 'zig':
      return installZls()
    case 'csharp':
      return installCsharpLs()
    case 'rust':
      logger.lsp.warn('[LSP Installer] rust-analyzer requires manual installation')
      return { success: false, error: 'rust-analyzer must be installed manually via rustup. Run: rustup component add rust-analyzer' }
    case 'deno':
      logger.lsp.warn('[LSP Installer] Deno requires manual installation')
      return { success: false, error: 'Deno must be installed manually from https://deno.land' }
    default:
      logger.lsp.error(`[LSP Installer] Unknown server ID: ${serverId}`)
      return { success: false, error: `Unknown server: ${serverId}` }
  }
}

/**
 * 获取所有 LSP 服务器的安装状态
 */
export function getLspServerStatus(): Record<string, { installed: boolean; path?: string }> {
  const servers = Object.keys(SERVER_PATHS)
  const status: Record<string, { installed: boolean; path?: string }> = {}

  for (const server of servers) {
    const serverPath = getInstalledServerPath(server)
    status[server] = {
      installed: !!serverPath,
      path: serverPath || undefined,
    }
  }

  return status
}

/**
 * 安装所有基础 LSP 服务器
 */
export async function installBasicServers(): Promise<LspInstallResult> {
  logger.lsp.info('[LSP Installer] Installing basic LSP servers...')
  logEnvironmentInfo()

  const results = await Promise.all([
    installTypeScriptServer(),
    installVscodeLanguageServers(),
  ])

  const failed = results.filter(r => !r.success)
  
  if (failed.length > 0) {
    const errorMessages = failed.map(f => f.error).join('; ')
    logger.lsp.error('[LSP Installer] Some basic servers failed to install:', {
      failedCount: failed.length,
      totalCount: results.length,
      errors: errorMessages,
    })
    return { success: false, error: errorMessages }
  }

  logger.lsp.info('[LSP Installer] All basic LSP servers installed successfully')
  return { success: true }
}
