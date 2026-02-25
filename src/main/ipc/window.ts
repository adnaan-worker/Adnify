/**
 * 窗口控制 IPC handlers
 */

import { ipcMain, BrowserWindow, app, nativeTheme } from 'electron'
import { logger } from '@shared/utils/Logger'

// 标记是否已注册基础窗口控制
let basicHandlersRegistered = false

export function registerWindowHandlers(createWindow: (isEmpty?: boolean) => BrowserWindow) {
  // 基础窗口控制（只注册一次）
  if (!basicHandlersRegistered) {
    basicHandlersRegistered = true

    ipcMain.on('window:minimize', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      win?.minimize()
    })

    ipcMain.on('window:maximize', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win?.isMaximized()) {
        win.unmaximize()
      } else {
        win?.maximize()
      }
    })

    ipcMain.on('window:close', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      win?.close()
    })

    ipcMain.on('window:toggleDevTools', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      win?.webContents.toggleDevTools()
    })

    ipcMain.handle('app:getVersion', () => {
      return app.getVersion()
    })

    // 同步系统主题
    ipcMain.handle('window:setTheme', (event, theme: 'light' | 'dark' | 'system', bgColor?: string) => {
      nativeTheme.themeSource = theme
      if (bgColor) {
        const win = BrowserWindow.fromWebContents(event.sender)
        win?.setBackgroundColor(bgColor)
      }
      return true
    })

    // 渲染端准备完毕通知
    ipcMain.on('app:ready', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        // 窗口已经显示，这里只是日志记录
        logger.system.info('[Window] Renderer ready for window:', { windowId: win.id })
      }
    })

    // 获取当前窗口的唯一标识
    ipcMain.handle('window:getId', (event) => {
      return BrowserWindow.fromWebContents(event.sender)?.id
    })

    // 调整窗口大小
    ipcMain.handle('window:resize', (event, width: number, height: number, minWidth?: number, minHeight?: number) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        // 先设置最小尺寸
        if (minWidth !== undefined && minHeight !== undefined) {
          win.setMinimumSize(minWidth, minHeight)
        }

        // 使用 Electron 内置的动画参数
        win.setSize(width, height, true)
        win.center()
      }
    })
  }

  // 新增：打开新窗口（需要 createWindow 函数）
  // 移除旧的 handler 再注册新的
  try {
    ipcMain.removeHandler('window:new')
  } catch { }
  ipcMain.handle('window:new', () => {
    createWindow(true)
  })
}
