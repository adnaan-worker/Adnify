/**
 * Skills IPC 处理器
 * 提供全局 Skills 目录路径等功能
 */

import * as path from 'path'
import * as fs from 'fs'
import { safeIpcHandle } from './safeHandle'
import { logger } from '@shared/utils/Logger'
import { getUserConfigDir } from '../services/configPath'

export function registerSkillsHandlers(): void {
  // 获取全局 Skills 目录路径
  safeIpcHandle('skills:getGlobalDir', async () => {
    const dir = path.join(getUserConfigDir(), 'skills')
    await fs.promises.mkdir(dir, { recursive: true })
    return dir
  })

  logger.ipc.info('[Skills IPC] Handlers registered')
}
