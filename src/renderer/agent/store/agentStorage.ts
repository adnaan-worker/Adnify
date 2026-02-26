/**
 * Agent 数据持久化存储
 * 
 * 使用 adnifyDir 服务将数据存储到 .adnify/sessions/ 目录
 * 每个线程对应一个独立 JSON 文件，通过 dirty flag 延迟批量写入
 */

import { logger } from '@utils/Logger'
import { StateStorage } from 'zustand/middleware'
import { adnifyDir } from '@services/adnifyDirService'

/**
 * 自定义 Zustand Storage
 * 通过 adnifyDir 服务存储到 .adnify/sessions/ 目录
 * 
 * getItem: 从 _meta.json + 各线程文件组装完整的 store 数据
 * setItem: 拆分到线程级文件，只标记变化的线程为 dirty
 * removeItem: 清除所有 session 数据
 */
export const agentStorage: StateStorage = {
  getItem: async (_name: string): Promise<string | null> => {
    const data = await adnifyDir.getFullSessionData()
    if (!data) return null
    return JSON.stringify(data)
  },

  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const parsed = JSON.parse(value)
      adnifyDir.setFullSessionDataDirty(name, parsed)
    } catch (error) {
      logger.agent.error('[AgentStorage] Failed to parse:', error)
    }
  },

  removeItem: async (_name: string): Promise<void> => {
    await adnifyDir.clearAllSessions()
  },
}
