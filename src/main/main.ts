/**
 * Adnify Main Process
 * 简化的启动逻辑，参考 VSCode 的快速启动模式
 * 
 * 优化说明：
 * - 启用 TypeScript 增量编译以提升构建速度
 */

import { app, BrowserWindow, Menu, shell } from 'electron'
import * as path from 'path'
import { logger } from '@shared/utils/Logger'
import { SECURITY_DEFAULTS } from '@shared/constants'
import type Store from 'electron-store'

// ==========================================
// 常量定义
// ==========================================

const WINDOW_CONFIG = {
  WIDTH: 1600,
  HEIGHT: 1000,
  MIN_WIDTH: 1200,
  MIN_HEIGHT: 700,
  // 空窗口（欢迎页）尺寸
  EMPTY_WIDTH: 800,
  EMPTY_HEIGHT: 600,
  EMPTY_MIN_WIDTH: 600,
  EMPTY_MIN_HEIGHT: 400,
  BG_COLOR: '#09090b',
} as const

// ==========================================
// Store（延迟初始化）
// ==========================================
let bootstrapStore: Store<Record<string, unknown>>
let configStore: Store<Record<string, unknown>>

/**
 * 辅助函数：统一返回 configStore
 */
function resolveStore(_key: string): Store<Record<string, unknown>> {
  return configStore
}

async function initStores() {
  const fs = await import('fs')
  const { default: Store } = await import('electron-store')

  bootstrapStore = new Store({ name: 'bootstrap' })
  const customConfigPath = bootstrapStore.get('customConfigPath') as string | undefined
  const baseCwd = (customConfigPath && fs.existsSync(customConfigPath)) ? customConfigPath : undefined

  const mkOpts = (name: string) => baseCwd ? { name, cwd: baseCwd } : { name }

  configStore = new Store(mkOpts('config'))

}

// ==========================================
// 全局状态
// ==========================================

const windows = new Map<number, BrowserWindow>()
const windowWorkspaces = new Map<number, string[]>()
let lastActiveWindow: BrowserWindow | null = null
let isQuitting = false


// 延迟加载的模块
let ipcModule: typeof import('./ipc') | null = null
let lspManager: typeof import('./lspManager').lspManager | null = null
let securityManager: typeof import('./security').securityManager | null = null

// ==========================================
// 单例锁
// ==========================================

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// ==========================================
// 窗口辅助函数
// ==========================================

function getMainWindow() {
  return lastActiveWindow || Array.from(windows.values())[0] || null
}

function findWindowByWorkspace(roots: string[]): BrowserWindow | null {
  const normalized = roots.map(r => r.toLowerCase().replace(/\\/g, '/'))
  for (const [id, workspaceRoots] of windowWorkspaces) {
    const normalizedWs = workspaceRoots.map(r => r.toLowerCase().replace(/\\/g, '/'))
    if (normalized.some(root => normalizedWs.includes(root))) {
      const win = windows.get(id)
      if (win && !win.isDestroyed()) return win
    }
  }
  return null
}

// ==========================================
// 窗口创建
// ==========================================

function createWindow(isEmpty = false): BrowserWindow {
  // 根据平台选择正确的图标格式
  const getIconPath = () => {
    const platform = process.platform
    if (app.isPackaged) {
      if (platform === 'win32') return path.join(process.resourcesPath, 'icon.ico')
      if (platform === 'darwin') return path.join(process.resourcesPath, 'icon.icns')
      return path.join(process.resourcesPath, 'icon.png')
    } else {
      if (platform === 'win32') return path.join(app.getAppPath(), 'public/icon.ico')
      if (platform === 'darwin') return path.join(app.getAppPath(), 'resources/icon.icns')
      return path.join(app.getAppPath(), 'public/icon.png')
    }
  }
  const iconPath = getIconPath()

  // 初始使用正常窗口尺寸，引导页作为遮罩层显示
  const win = new BrowserWindow({
    width: isEmpty ? WINDOW_CONFIG.EMPTY_WIDTH : WINDOW_CONFIG.WIDTH,
    height: isEmpty ? WINDOW_CONFIG.EMPTY_HEIGHT : WINDOW_CONFIG.HEIGHT,
    minWidth: isEmpty ? WINDOW_CONFIG.EMPTY_MIN_WIDTH : WINDOW_CONFIG.MIN_WIDTH,
    minHeight: isEmpty ? WINDOW_CONFIG.EMPTY_MIN_HEIGHT : WINDOW_CONFIG.MIN_HEIGHT,
    frame: false,
    titleBarStyle: 'hiddenInset',
    icon: iconPath,
    trafficLightPosition: { x: 15, y: 14 },
    backgroundColor: WINDOW_CONFIG.BG_COLOR,
    show: false, // 先隐藏，等 DOM 渲染完成后再显示
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      v8CacheOptions: 'bypassHeatCheck',
      backgroundThrottling: false,
    },
  })

  // 添加 CSP 头以提升安全性
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // Monaco 编辑器需要
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: https: blob:",  // blob: 支持粘贴图片
          "connect-src 'self' https:",  // 允许所有 HTTPS 连接，支持自定义 baseURL
          "font-src 'self' data:",
          "media-src 'self'",
        ].join('; ')
      }
    })
  })

  // 等待 DOM 渲染完成后显示窗口，避免白屏闪烁
  win.webContents.once('dom-ready', () => {
    // 等待一帧（16ms）让 CSS 动画启动
    setTimeout(() => win.show(), 16)
  })

  // Mac 上确保 traffic lights 始终显示
  if (process.platform === 'darwin') {
    win.setWindowButtonVisibility(true)
  }

  const windowId = win.id
  windows.set(windowId, win)
  lastActiveWindow = win

  // 窗口事件
  win.on('focus', () => {
    lastActiveWindow = win
  })

  win.on('close', async (e) => {
    if (windows.size === 1 && !isQuitting) {
      isQuitting = true
      e.preventDefault()
      try {
        ipcModule?.cleanupAllHandlers()
        await lspManager?.stopAllServers()
      } catch (err) {
        logger.system.error('[Main] Cleanup error:', err)
      }
      win.destroy()
      app.quit()
    } else {
      windows.delete(windowId)
      windowWorkspaces.delete(windowId)
      if (lastActiveWindow === win) {
        lastActiveWindow = Array.from(windows.values())[0] || null
      }
    }
  })

  // 快捷键
  win.webContents.on('before-input-event', (_, input) => {
    if (input.type !== 'keyDown') return
    if ((input.control && input.shift && input.key.toLowerCase() === 'p') || input.key === 'F1') {
      win.webContents.send('workbench:execute-command', 'workbench.action.showCommands')
    }
    if (input.key === 'F12') {
      win.webContents.toggleDevTools()
    }
  })

  // 外部链接处理
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('devtools://') || url.startsWith('http://localhost')) {
      return { action: 'allow' }
    }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  // 加载页面
  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: isEmpty ? { empty: '1' } : undefined
    })
  } else {
    win.loadURL(`http://localhost:5173${isEmpty ? '?empty=1' : ''}`)
  }

  return win
}


// ==========================================
// 模块加载（后台异步）
// ==========================================

async function initializeModules(firstWin: BrowserWindow) {
  // 并行加载所有模块
  const [ipc, lsp, security, windowIpc, lspInstaller, updaterService] = await Promise.all([
    import('./ipc'),
    import('./lspManager'),
    import('./security'),
    import('./ipc/window'),
    import('./lsp/installer'),
    import('./services/updater'),
  ])

  ipcModule = ipc
  lspManager = lsp.lspManager
  securityManager = security.securityManager

  // 从配置加载自定义 LSP 安装路径
  const customLspPath = configStore.get('lspSettings.customBinDir') as string | undefined
  if (customLspPath) {
    lspInstaller.setCustomLspBinDir(customLspPath)
  }

  // 窗口控制已在创建窗口前注册，此处仅确保 window:new 等依赖 createWindow 的 handler 生效
  windowIpc.registerWindowHandlers(createWindow)

  // 更新服务：IPC 已在创建窗口前注册，此处仅初始化主窗口引用
  updaterService.updateService.initialize(firstWin)

  // 配置安全模块
  const securityConfig = configStore.get('securitySettings', {
    enablePermissionConfirm: true,
    enableAuditLog: true,
    strictWorkspaceMode: true,
    allowedShellCommands: [...SECURITY_DEFAULTS.SHELL_COMMANDS],
    allowedGitSubcommands: [...SECURITY_DEFAULTS.GIT_SUBCOMMANDS],
  }) as any

  securityManager.updateConfig(securityConfig)
  security.updateWhitelist(
    securityConfig.allowedShellCommands || [...SECURITY_DEFAULTS.SHELL_COMMANDS],
    securityConfig.allowedGitSubcommands || [...SECURITY_DEFAULTS.GIT_SUBCOMMANDS]
  )

  // 注册 IPC 处理器
  ipc.registerAllHandlers({
    getMainWindow,
    createWindow,
    resolveStore,
    credentialsStore: configStore,
    preferencesStore: configStore,
    workspaceMetaStore: configStore,
    bootstrapStore,
    findWindowByWorkspace,
    setWindowWorkspace: (id: number, roots: string[]) => windowWorkspaces.set(id, roots),
    getWindowWorkspace: (id: number) => windowWorkspaces.get(id) || null,
  })

  // 设置菜单
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [{ role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View', submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            const win = getMainWindow()
            win?.webContents.send('workbench:execute-command', 'workbench.action.showCommands')
          }
        }
      ]
    },
  ]))
}

// ==========================================
// 错误处理（捕获原生模块异常）
// ==========================================

// 捕获未处理的异常（包括原生模块异常）
process.on('uncaughtException', (error: Error) => {
  logger.system.error('[Main] Uncaught Exception:', error)

  // 如果是 node-pty 相关的错误，提供更友好的提示
  if (error.message?.includes('Napi::Error') || error.message?.includes('node-pty')) {
    logger.system.error('[Main] node-pty native module error detected. Please run: npm run rebuild')
  }

  // 不退出应用，让用户继续使用其他功能
  // 只在开发模式下显示错误
  if (!app.isPackaged) {
    console.error('Uncaught exception:', error)
  }
})

// 捕获未处理的 Promise 拒绝
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.system.error('[Main] Unhandled Rejection:', reason)

  if (!app.isPackaged) {
    console.error('Unhandled rejection at:', promise, 'reason:', reason)
  }
})

// ==========================================
// 应用生命周期
// ==========================================

app.whenReady().then(async () => {
  // 1. 初始化 Store（必须在模块加载前完成）
  await initStores()

  // 2. 检查是否启用文件日志
  const appSettings = configStore.get('app-settings') as any
  const enableFileLogging = appSettings?.enableFileLogging ?? false
  logger.system.info('[Main] File logging setting loaded:', { enableFileLogging, type: typeof enableFileLogging })

  if (enableFileLogging) {
    const { getUserConfigDir } = await import('./services/configPath')
    const logPath = path.join(getUserConfigDir(), 'logs', 'main.log')
    logger.enableFileLogging(logPath)
    logger.system.info('[Main] File logging enabled', {
      logPath,
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      isPackaged: app.isPackaged,
    })
  } else {
    logger.system.info('[Main] File logging is disabled')
  }

  // 3. 先注册窗口与更新 IPC，避免渲染进程加载时 handler 未就绪（setTheme / updater 等）
  const { registerWindowHandlers } = await import('./ipc/window')
  registerWindowHandlers(createWindow)
  const { registerUpdaterHandlers } = await import('./ipc/updater')
  registerUpdaterHandlers()

  // 4. 创建窗口
  const firstWin = createWindow()

  // 5. 后台加载模块（不阻塞窗口显示）
  initializeModules(firstWin).catch(err => {
    logger.system.error('[Main] Module initialization failed:', err)
  })
})

app.on('second-instance', () => createWindow())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (windows.size === 0) createWindow() })
