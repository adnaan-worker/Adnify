/**
 * 主进程 IPC 安全包装器
 * 确保 IPC 处理函数在发生严重错误、返回不可序列化对象时，能够被正确捕获并返回给渲染进程
 */

import { app, ipcMain, IpcMainInvokeEvent } from 'electron'
import { toAppError } from '@shared/utils/errorHandler'
import { logger } from '@shared/utils/Logger'

export interface SafeIpcResponse<T = unknown> {
    success: boolean
    data?: T
    error?: string
    code?: string
}

/**
 * 包装 ipcMain.handle
 * @param channel IPC 频道名称
 * @param handler 实际的处理器函数
 * @param domain 日志域 (缺省以频道名前缀为准)
 */
export function safeIpcHandle<T = unknown>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<T> | T,
    domain?: string
) {
    const logDomain = domain || channel.split(':')[0] || 'ipc'

    ipcMain.handle(channel, async (event, ...args) => {
        try {
            const result = await handler(event, ...args)

            // 仅开发环境验证可序列化性（避免生产环境双重序列化开销）
            // 特别注意：第三方包（比如 MCP sdk，node-pty 等）可能会返回包含循环引用或是 Native Binding 的不可序列化对象
            if (!app.isPackaged) {
                try {
                    JSON.stringify(result)
                } catch (serializeErr) {
                    const targetLogger = (logger as any)[logDomain] || logger.ipc
                    if (targetLogger && targetLogger.error) {
                        targetLogger.error(`[${channel}] Unserializable return value:`, serializeErr)
                    } else {
                        logger.ipc.error(`[${channel}] Unserializable return value:`, serializeErr)
                    }

                    return {
                        success: false,
                        error: `IPC response serialization failed for ${channel}: ${(serializeErr as Error).message}`,
                        code: 'ERR_IPC_SERIALIZATION'
                    }
                }
            }

            return result
        } catch (err) {
            const appError = toAppError(err)
            const targetLogger = (logger as any)[logDomain] || logger.ipc

            if (targetLogger && targetLogger.error) {
                targetLogger.error(`[${channel}] Unhandled error:`, appError)
            } else {
                logger.ipc.error(`[${channel}] Unhandled error:`, appError)
            }

            // 返回结构化错误
            return {
                success: false,
                error: appError.message || `Unknown error in ${channel}`,
                code: appError.code || 'ERR_IPC_UNHANDLED'
            }
        }
    })
}
