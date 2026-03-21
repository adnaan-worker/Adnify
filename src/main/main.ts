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
import { buildRuntimeCleanupTasks, type RuntimeCleanupReason } from './lifecycle/runtimeCleanup'
import { resolveBeforeQuitAction, resolveWindowAllClosedAction } from './lifecycle/quitLifecycle'
import { bootstrapFirstWindow } from './startup/bootstrapFirstWindow'

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


// 延迟加载的模块
let ipcModule: typeof import('./ipc') | null = null
let lspManager: typeof import('./lsp/lspManager').lspManager | null = null
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

function getMainWindow(windowId?: number): BrowserWindow | null {
  // 根据窗口 ID 获取窗口
  if (windowId !== undefined) {
    return windows.get(windowId) || null
  }
  // 如果没有指定窗口 ID，则返回最后一个活跃窗口
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

function getThemeBackgroundColor(): string {
  try {
    const themeBg = configStore?.get('themeBg') as string;
    if (themeBg) {
      // If the color format is RGB with spaces like "18 18 21"
      if (themeBg.includes(' ')) {
        const [r, g, b] = themeBg.split(' ').map(Number);
        const toHex = (n: number) => n.toString(16).padStart(2, '0');
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
        }
      }
      return themeBg; // Assuming it's already a valid hex color
    }

    // Fallback dictionary for older configurations before migration
    const themeId = configStore?.get('themeId') as string || 'adnify-dark';
    const themes: Record<string, string> = {
      'adnify-dark': '#121215',
      'midnight': '#161b22',
      'cyberpunk': '#030305',
      'dawn': '#ffffff'
    };
    return themes[themeId] || WINDOW_CONFIG.BG_COLOR;
  } catch {
    return WINDOW_CONFIG.BG_COLOR;
  }
}

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
    backgroundColor: getThemeBackgroundColor(),
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

  win.on('close', () => {
    logger.system.info(`[Main] Window ${windowId} close event triggered`)
  })

  // 在 close 事件中提前捕获 webContentsId（closed 时 webContents 可能已销毁）
  let cachedWebContentsId: number | undefined
  win.on('close', () => {
    cachedWebContentsId = win.webContents?.id
  })

  win.on('closed', () => {
    // 清理该窗口关联的 LLM 服务（中止活跃流、释放 AbortController）
    if (cachedWebContentsId && ipcModule) {
      try { ipcModule.cleanupLLMService(cachedWebContentsId) } catch { /* ignore */ }
    }

    windows.delete(windowId)
    windowWorkspaces.delete(windowId)
    logger.system.info(`[Main] Window ${windowId} closed and removed from map. Remaining: ${windows.size}`)

    if (lastActiveWindow === win) {
      lastActiveWindow = Array.from(windows.values())[0] || null
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

/**
 * 集中处理运行期/退出时的异步清理逻辑
 */
async function performRuntimeCleanup(reason: RuntimeCleanupReason): Promise<void> {
  logger.system.info(`[Main] Starting runtime cleanup (${reason})...`)

  const [securityModule, indexingModule, debugModule] = await Promise.all([
    import('./security'),
    import('./indexing'),
    import('./services/debugger/DebugService'),
  ])

  const cleanupTasks = buildRuntimeCleanupTasks(reason, {
    cleanupAllHandlers: () => ipcModule?.cleanupAllHandlers(),
    stopAllLspServers: () => lspManager?.stopAllServers(),
    destroyAllIndexServices: () => indexingModule.destroyIndexService(),
    cleanupAllIsolatedWorkspaces: () => securityModule.cleanupAllIsolatedWorkspaces(),
    cleanupAllDebugSessions: () => debugModule.debugService.cleanupAllSessions(),
    pruneExitedTerminals: () => securityModule.pruneExitedTerminals(),
  })

  const results = await Promise.allSettled(cleanupTasks.map((task) => Promise.resolve().then(task)))
  const failures = results.filter((result) => result.status === 'rejected')

  if (failures.length > 0) {
    logger.system.warn(`[Main] Runtime cleanup completed with ${failures.length} failure(s)`)
    for (const failure of failures) {
      if (failure.status === 'rejected') {
        logger.system.warn('[Main] Cleanup task failed:', failure.reason)
      }
    }
    return
  }

  logger.system.info(`[Main] Runtime cleanup completed successfully (${reason})`)
}


// ==========================================
// 主进程启动
// ==========================================

async function prepareCriticalIpcHandlers() {
  const [ipc, lsp, security, lspInstaller] = await Promise.all([
    import('./ipc'),
    import('./lsp/lspManager'),
    import('./security'),
    import('./lsp/installer'),
  ])

  ipcModule = ipc
  lspManager = lsp.lspManager
  securityManager = security.securityManager

  // 从配置加载自定义 LSP 安装路径
  const customLspPath = configStore.get('lspSettings.customBinDir') as string | undefined
  if (customLspPath) {
    lspInstaller.setCustomLspBinDir(customLspPath)
  }

  const securityConfig = configStore.get('securitySettings', {
    enablePermissionConfirm: true,
    strictWorkspaceMode: true,
    allowedShellCommands: [...SECURITY_DEFAULTS.SHELL_COMMANDS],
    allowedGitSubcommands: [...SECURITY_DEFAULTS.GIT_SUBCOMMANDS],
  }) as any

  securityManager.updateConfig(securityConfig)
  security.updateWhitelist(
    securityConfig.allowedShellCommands || [...SECURITY_DEFAULTS.SHELL_COMMANDS],
    securityConfig.allowedGitSubcommands || [...SECURITY_DEFAULTS.GIT_SUBCOMMANDS]
  )

  // 在渲染进程可交互前注册全部核心 IPC，避免欢迎页点击时出现 handler 未就绪。
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
}

async function initializeWindowServices(firstWin: BrowserWindow) {
  const { updateService } = await import('./services/updater')

  updateService.initialize(firstWin)

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
  try {
    await bootstrapFirstWindow({
      initStores: async () => {
        await initStores()

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
      },
      registerWindowHandlers: async () => {
        const { registerWindowHandlers } = await import('./ipc/window')
        registerWindowHandlers(createWindow)
      },
      registerUpdaterHandlers: async () => {
        const { registerUpdaterHandlers } = await import('./ipc/updater')
        registerUpdaterHandlers()
      },
      registerCriticalIpcHandlers: prepareCriticalIpcHandlers,
      createWindow,
      initializeWindowServices,
    })
  } catch (err) {
    logger.system.error('[Main] Failed to bootstrap first window:', err)
  }
})

app.on('second-instance', () => {
  const win = getMainWindow()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  } else {
    createWindow(false)
  }
})

app.on('window-all-closed', () => {
  logger.system.info('[Main] All windows closed, platform:', process.platform)

  const action = resolveWindowAllClosedAction(process.platform, {
    cleanupDone: isCleanupDone,
    cleanupRunning: isQuitCleanupRunning,
  })

  if (action === 'cleanup-only') {
    performRuntimeCleanup('window-all-closed').catch((err) => {
      logger.system.warn('[Main] Runtime cleanup after window-all-closed failed:', err)
    })
    return
  }

  app.quit()
})

/**
 * 应用退出前的生命周期钩子
 * 在该阶段拦截退出信号并执行异步清理
 */
let isCleanupDone = false
let isQuitCleanupRunning = false
app.on('before-quit', async (e) => {
  const action = resolveBeforeQuitAction({
    cleanupDone: isCleanupDone,
    cleanupRunning: isQuitCleanupRunning,
  })

  if (action === 'allow') {
    return
  }

  e.preventDefault()

  if (action === 'wait') {
    logger.system.info('[Main] Quit cleanup already running, waiting for completion')
    return
  }

  logger.system.info('[Main] Intercepting before-quit for cleanup')
  isQuitCleanupRunning = true

  try {
    await performRuntimeCleanup('before-quit')
    isCleanupDone = true
  } finally {
    isQuitCleanupRunning = false
  }

  logger.system.info('[Main] Cleanup done, re-triggering app.quit()')
  app.quit()
})

app.on('activate', () => { if (windows.size === 0) createWindow() })
