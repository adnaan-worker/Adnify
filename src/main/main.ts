/**
 * Adnify Main Process
 * 重构后的主进程入口（集成安全模块）
 */

import { app, BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import Store from 'electron-store'
import { registerAllHandlers, cleanupAllHandlers, updateLLMServiceWindow } from './ipc'
import { lspManager } from './lspManager'
import { securityManager } from './security'

// ==========================================
// 单实例锁定 - 必须在最开始检查
// ==========================================

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // 已有实例在运行，立即退出，不执行任何后续代码
  app.exit(0)
}

// ==========================================
// Store 初始化
// ==========================================

const bootstrapStore = new Store({ name: 'bootstrap' })
let mainStore: Store

function initStore() {
  const customPath = bootstrapStore.get('customConfigPath') as string | undefined
  if (customPath && fs.existsSync(customPath)) {
    console.log('[Main] Using custom config path:', customPath)
    mainStore = new Store({ cwd: customPath })
  } else {
    console.log('[Main] Using default config path')
    mainStore = new Store()
  }
}

initStore()

// ==========================================
// 全局状态
// ==========================================

let mainWindow: BrowserWindow | null = null
let isQuitting = false

// ==========================================
// 窗口创建
// ==========================================

function createWindow() {
  // 图标路径:开发环境用 public,生产环境用 resources
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../../public/icon.png')

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    frame: false,
    titleBarStyle: 'hidden',
    icon: iconPath,
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#09090b', // 与 loader 背景色一致,避免闪烁
    show: false, // 先隐藏,等内容准备好再显示
    skipTaskbar: true, // 防止在任务栏中闪烁空白图标
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // VSCode 风格:使用 ready-to-show 事件,在页面基本加载完成后立即显示
  // 这样可以快速启动,避免托盘闪烁,同时让用户看到加载进度
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setSkipTaskbar(false) // 显示前先加入任务栏
      mainWindow.show()
      console.log('[Main] Window shown (ready-to-show)')

      // 开发模式下延迟打开 DevTools,避免影响首屏
      if (!app.isPackaged) {
        setTimeout(() => {
          mainWindow?.webContents.openDevTools({ mode: 'detach' })
        }, 1000)
      }
    }
  })

  // 窗口关闭前清理资源
  mainWindow.on('close', async (e) => {
    if (!isQuitting) {
      isQuitting = true
      e.preventDefault()

      console.log('[Main] Starting cleanup...')

      // 先清理资源,再销毁窗口
      try {
        // 同步清理,不使用 Promise.race
        cleanupAllHandlers() // 终端等资源的同步清理
        await lspManager.stopAllServers() // LSP 服务器的异步清理
        console.log('[Main] Cleanup completed')
      } catch (err) {
        console.error('[Main] Cleanup error:', err)
      }

      // 确保清理完成后再销毁窗口
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.destroy()
        mainWindow = null
      }

      // 最后退出应用
      app.quit()
    }
  })

  // 加载页面
  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // 更新 LLM 服务的窗口引用
  updateLLMServiceWindow(mainWindow)
}

// ==========================================
// 应用生命周期
// ==========================================

app.whenReady().then(() => {
  console.log('[Security] 🔒 初始化安全模块...')

  // 初始化安全模块配置
  const securityConfig = mainStore.get('securitySettings', {
    // 默认开启所有安全保护
    enablePermissionConfirm: true,
    enableAuditLog: true,
    strictWorkspaceMode: true,
    // 允许的命令白名单
    allowedShellCommands: ['npm', 'yarn', 'pnpm', 'node', 'npx', 'git'],
  })

  console.log('[Security] 安全配置:', securityConfig)

  // 初始化 SecurityManager 配置
  securityManager.updateConfig(securityConfig as any)

  console.log('[Security] ✅ 安全模块已初始化')
  console.log('[Security] 📋 审计日志已启用')
  console.log('[Security] 🛡️ 工作区边界保护已启用')

  // 注册所有 IPC handlers
  registerAllHandlers({
    getMainWindow: () => mainWindow,
    mainStore,
    bootstrapStore,
    setMainStore: (store) => {
      mainStore = store
    },
  })

  // 创建窗口
  createWindow()

  // 在窗口创建后，设置安全模块的主窗口引用
  if (mainWindow) {
    securityManager.setMainWindow(mainWindow)
  }
})

// 当第二个实例尝试启动时，聚焦到已有窗口
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
