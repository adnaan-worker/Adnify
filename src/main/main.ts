/**
 * Adnify Main Process
 * 重构后的主进程入口
 */

import { app, BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import Store from 'electron-store'
import { registerAllHandlers, cleanupAllHandlers, updateLLMServiceWindow } from './ipc'
import { lspManager } from './lspManager'

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
  // 图标路径：开发环境用 public，生产环境用 resources
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
    backgroundColor: '#09090b', // 与 loader 背景色一致，避免闪烁
    show: false, // 先隐藏，等内容准备好再显示
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 监听渲染进程发来的"准备好了"信号，而不是 ready-to-show
  // 这样可以等 React 完全渲染后再显示窗口
  const { ipcMain } = require('electron')
  ipcMain.once('app:ready', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      // 开发模式下延迟打开 DevTools，避免影响首屏
      if (!app.isPackaged) {
        setTimeout(() => {
          mainWindow?.webContents.openDevTools({ mode: 'detach' })
        }, 1000)
      }
    }
  })

  // 备用：如果 5 秒内没收到 ready 信号，强制显示（防止卡住）
  const showTimeout = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.warn('[Main] Timeout waiting for app:ready, forcing show')
      mainWindow.show()
    }
  }, 5000)

  mainWindow.once('closed', () => {
    clearTimeout(showTimeout)
  })

  // 窗口关闭前清理资源
  mainWindow.on('close', async (e) => {
    if (!isQuitting) {
      isQuitting = true
      e.preventDefault()
      
      // 清理资源（带超时保护）
      try {
        await Promise.race([
          (async () => {
            await cleanupAllHandlers()
            await lspManager.stopAllServers()
          })(),
          new Promise(resolve => setTimeout(resolve, 2000))
        ])
      } catch (err) {
        console.error('[Main] Cleanup error:', err)
      }
      
      // 销毁窗口并退出
      mainWindow?.destroy()
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
