/**
 * Adnify Main Process
 * 简化的启动逻辑，参考 VSCode 的快速启动模式
 */

import { app, BrowserWindow, Menu, shell } from 'electron'
import * as path from 'path'

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

const SECURITY_DEFAULTS = {
  SHELL_COMMANDS: [
    'npm', 'yarn', 'pnpm', 'bun', 'node', 'npx', 'deno', 'git',
    'python', 'python3', 'pip', 'pip3', 'java', 'javac', 'mvn', 'gradle',
    'go', 'rust', 'cargo', 'make', 'gcc', 'clang', 'cmake',
    'pwd', 'ls', 'dir', 'cat', 'type', 'echo', 'mkdir', 'touch', 'rm', 'mv', 'cp', 'cd',
  ],
  GIT_SUBCOMMANDS: [
    'status', 'log', 'diff', 'show', 'ls-files', 'rev-parse', 'rev-list', 'blame',
    'add', 'commit', 'reset', 'restore', 'push', 'pull', 'fetch', 'remote',
    'branch', 'checkout', 'switch', 'merge', 'rebase', 'cherry-pick',
    'clone', 'init', 'stash', 'tag', 'config',
  ],
}

// ==========================================
// Store（延迟初始化）
// ==========================================

let bootstrapStore: any
let mainStore: any

async function initStores() {
  const fs = await import('fs')
  const { default: Store } = await import('electron-store')
  
  bootstrapStore = new Store({ name: 'bootstrap' })
  const customConfigPath = bootstrapStore.get('customConfigPath') as string | undefined
  const storeOptions: any = { name: 'config' }
  if (customConfigPath && fs.existsSync(customConfigPath)) {
    storeOptions.cwd = customConfigPath
  }
  mainStore = new Store(storeOptions)
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
    titleBarStyle: 'hidden',
    icon: iconPath,
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: WINDOW_CONFIG.BG_COLOR,
    show: false, // 先隐藏，等 DOM 渲染完成后再显示
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      v8CacheOptions: 'bypassHeatCheck',
      backgroundThrottling: false,
    },
  })

  // 等待 DOM 渲染完成后显示窗口，避免白屏闪烁
  win.webContents.once('dom-ready', () => {
    // 等待一帧（16ms）让 CSS 动画启动
    setTimeout(() => win.show(), 16)
  })

  const windowId = win.id
  windows.set(windowId, win)
  lastActiveWindow = win

  // 窗口事件
  win.on('focus', () => {
    lastActiveWindow = win
    ipcModule?.updateLLMServiceWindow(win)
  })

  win.on('close', async (e) => {
    if (windows.size === 1 && !isQuitting) {
      isQuitting = true
      e.preventDefault()
      try {
        ipcModule?.cleanupAllHandlers()
        await lspManager?.stopAllServers()
      } catch (err) {
        console.error('[Main] Cleanup error:', err)
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
  const [ipc, lsp, security, windowIpc, lspInstaller] = await Promise.all([
    import('./ipc'),
    import('./lspManager'),
    import('./security'),
    import('./ipc/window'),
    import('./lsp/installer'),
  ])

  ipcModule = ipc
  lspManager = lsp.lspManager
  securityManager = security.securityManager

  // 从配置加载自定义 LSP 安装路径
  const customLspPath = mainStore.get('lspSettings.customBinDir') as string | undefined
  if (customLspPath) {
    lspInstaller.setCustomLspBinDir(customLspPath)
  }

  // 注册窗口控制
  windowIpc.registerWindowHandlers(createWindow)

  // 配置安全模块
  const securityConfig = mainStore.get('securitySettings', {
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
    mainStore,
    bootstrapStore,
    setMainStore: (store: any) => { mainStore = store },
    findWindowByWorkspace,
    setWindowWorkspace: (id: number, roots: string[]) => windowWorkspaces.set(id, roots),
    getWindowWorkspace: (id: number) => windowWorkspaces.get(id) || null,
  })

  securityManager.setMainWindow(firstWin)

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
          accelerator: 'CmdOrCtrl+Shift+P',
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
// 应用生命周期
// ==========================================

app.whenReady().then(async () => {
  // 1. 初始化 Store（必须在模块加载前完成）
  await initStores()

  // 2. 创建窗口
  const firstWin = createWindow()

  // 3. 后台加载模块（不阻塞窗口显示）
  initializeModules(firstWin).catch(err => {
    console.error('[Main] Module initialization failed:', err)
  })
})

app.on('second-instance', () => createWindow())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (windows.size === 0) createWindow() })
