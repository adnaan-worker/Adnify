/**
 * 项目级存储服务
 * 
 * 这是一个兼容层，所有操作都委托给 adnifyDir 服务
 * 新代码应该直接使用 adnifyDir
 */

import { 
  adnifyDir, 
  ADNIFY_FILES,
  ProjectSettingsData,
  DEFAULT_PROJECT_SETTINGS,
} from './adnifyDirService'

// 重新导出
export const STORAGE_FILES = ADNIFY_FILES
export type ProjectSettings = ProjectSettingsData
export { DEFAULT_PROJECT_SETTINGS }

// ============ 通用读写（兼容旧代码） ============

export async function readProjectData<T>(fileName: string): Promise<T | null> {
  return adnifyDir.readJson<T>(fileName as any)
}

export async function writeProjectData<T>(fileName: string, data: T): Promise<boolean> {
  return adnifyDir.writeJson(fileName as any, data)
}

export async function deleteProjectData(fileName: string): Promise<boolean> {
  return adnifyDir.deleteFile(fileName)
}

// ============ 检查点存储（兼容旧代码） ============

export interface CheckpointData {
  checkpoints: Array<{
    id: string
    type: 'user_message' | 'tool_edit'
    timestamp: number
    snapshots: Record<string, { path?: string; fsPath?: string; content: string | null; timestamp?: number }>
    description: string
    messageId?: string
  }>
  currentIdx: number
}

/** @deprecated 检查点现在存储在 sessions.json 中 */
export async function loadCheckpoints(): Promise<CheckpointData | null> {
  const sessions = await adnifyDir.getSessions()
  return (sessions['checkpoints'] as CheckpointData) || null
}

/** @deprecated 检查点现在存储在 sessions.json 中 */
export async function saveCheckpoints(data: CheckpointData): Promise<boolean> {
  try {
    await adnifyDir.updateSessionsPartial('checkpoints', data)
    return true
  } catch {
    return false
  }
}

// ============ 会话存储（兼容旧代码） ============

export interface SessionData {
  threads: Array<{
    id: string
    title?: string
    messages: unknown[]
    createdAt: number
    lastModified: number
  }>
  currentThreadId: string | null
}

/** @deprecated 使用 adnifyDir.getSessions() */
export async function loadSessions(): Promise<SessionData | null> {
  const sessions = await adnifyDir.getSessions()
  return (sessions['legacy-sessions'] as SessionData) || null
}

/** @deprecated 使用 adnifyDir.saveSessions() */
export async function saveSessions(data: SessionData): Promise<boolean> {
  try {
    await adnifyDir.updateSessionsPartial('legacy-sessions', data)
    return true
  } catch {
    return false
  }
}

// ============ 项目设置 ============

export async function loadProjectSettings(): Promise<ProjectSettings> {
  return adnifyDir.getSettings()
}

export async function saveProjectSettings(settings: ProjectSettings): Promise<boolean> {
  try {
    await adnifyDir.saveSettings(settings)
    return true
  } catch {
    return false
  }
}
