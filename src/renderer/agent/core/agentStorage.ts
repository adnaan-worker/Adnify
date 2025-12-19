/**
 * Agent 数据持久化存储
 * 
 * 使用 adnifyDir 服务将数据存储到 .adnify/sessions.json
 * 通过 setSessionsPartialDirty 实现延迟批量写入
 */

import { StateStorage } from 'zustand/middleware'
import { adnifyDir } from '../../services/adnifyDirService'

/**
 * 自定义 Zustand Storage
 * 通过 adnifyDir 服务存储到 .adnify/sessions.json
 * 使用 dirty flag 机制，由 adnifyDir 统一调度刷盘
 */
export const agentStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const sessions = await adnifyDir.getSessions()
    if (sessions[name]) {
      return JSON.stringify(sessions[name])
    }
    return null
  },

  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const parsed = JSON.parse(value)
      // 使用 dirty flag 机制，延迟写入
      adnifyDir.setSessionsPartialDirty(name, parsed)
    } catch (error) {
      console.error('[AgentStorage] Failed to parse:', error)
    }
  },

  removeItem: async (name: string): Promise<void> => {
    const sessions = await adnifyDir.getSessions()
    delete sessions[name]
    await adnifyDir.saveSessions(sessions)
  },
}
