/**
 * 调试 IPC handlers
 */

import { ipcMain } from 'electron'
import { toAppError } from '@shared/utils/errorHandler'
import { debugService } from '../services/debugger'
import { getAdapterInfo, builtinAdapters } from '../services/debugger/adapters'
import type { DebugConfig } from '../services/debugger'

export function registerDebugHandlers() {
  // 获取支持的调试类型
  ipcMain.handle('debug:getSupportedTypes', () => {
    return builtinAdapters.map(a => ({
      type: a.type,
      label: a.label,
      languages: a.languages,
      configurationSnippets: a.configurationSnippets,
    }))
  })

  // 获取配置模板
  ipcMain.handle('debug:getConfigSnippets', (_, type: string) => {
    const adapter = getAdapterInfo(type)
    return adapter?.configurationSnippets || []
  })

  // 创建调试会话
  ipcMain.handle('debug:createSession', async (_, config: DebugConfig) => {
    try {
      const sessionId = await debugService.createSession(config)
      return { success: true, sessionId }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 启动调试
  ipcMain.handle('debug:launch', async (_, sessionId: string) => {
    try {
      await debugService.launch(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 附加到进程
  ipcMain.handle('debug:attach', async (_, sessionId: string) => {
    try {
      await debugService.attach(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 配置完成
  ipcMain.handle('debug:configurationDone', async (_, sessionId: string) => {
    try {
      await debugService.configurationDone(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 停止调试
  ipcMain.handle('debug:stop', async (_, sessionId: string) => {
    try {
      await debugService.stop(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 继续执行
  ipcMain.handle('debug:continue', async (_, sessionId: string) => {
    try {
      await debugService.continue(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 单步跳过
  ipcMain.handle('debug:stepOver', async (_, sessionId: string) => {
    try {
      await debugService.stepOver(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 单步进入
  ipcMain.handle('debug:stepInto', async (_, sessionId: string) => {
    try {
      await debugService.stepInto(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 单步跳出
  ipcMain.handle('debug:stepOut', async (_, sessionId: string) => {
    try {
      await debugService.stepOut(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 暂停
  ipcMain.handle('debug:pause', async (_, sessionId: string) => {
    try {
      await debugService.pause(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 设置断点
  ipcMain.handle('debug:setBreakpoints', async (_, sessionId: string, file: string, breakpoints: any[]) => {
    try {
      const result = await debugService.setBreakpoints(sessionId, file, breakpoints)
      return { success: true, breakpoints: result }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 获取堆栈帧
  ipcMain.handle('debug:getStackTrace', async (_, sessionId: string, threadId: number) => {
    try {
      const frames = await debugService.getStackTrace(sessionId, threadId)
      return { success: true, frames }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 获取作用域
  ipcMain.handle('debug:getScopes', async (_, sessionId: string, frameId: number) => {
    try {
      const scopes = await debugService.getScopes(sessionId, frameId)
      return { success: true, scopes }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 获取变量
  ipcMain.handle('debug:getVariables', async (_, sessionId: string, variablesReference: number) => {
    try {
      const variables = await debugService.getVariables(sessionId, variablesReference)
      return { success: true, variables }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 求值表达式
  ipcMain.handle('debug:evaluate', async (_, sessionId: string, expression: string, frameId?: number) => {
    try {
      const result = await debugService.evaluate(sessionId, expression, frameId)
      return { success: true, result }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 获取会话状态
  ipcMain.handle('debug:getSessionState', (_, sessionId: string) => {
    return debugService.getSessionState(sessionId)
  })

  // 获取所有会话
  ipcMain.handle('debug:getAllSessions', () => {
    return debugService.getAllSessions()
  })

  // 获取线程列表
  ipcMain.handle('debug:getThreads', async (_, sessionId: string) => {
    try {
      const threads = await debugService.getThreads(sessionId)
      return { success: true, threads }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 获取会话能力
  ipcMain.handle('debug:getCapabilities', (_, sessionId: string) => {
    return debugService.getCapabilities(sessionId)
  })
}
