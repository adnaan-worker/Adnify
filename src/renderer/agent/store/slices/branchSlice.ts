/**
 * 对话分支管理 Slice
 * 支持从任意消息点创建分支、切换分支、合并分支
 */

import type { StateCreator } from 'zustand'
import type { ChatMessage } from '../../types'
import type { ThreadSlice } from './threadSlice'
import type { MessageSlice } from './messageSlice'

// ===== 类型定义 =====

export interface Branch {
  id: string
  name: string
  // 分支起点的消息 ID
  forkFromMessageId: string
  // 分支创建时间
  createdAt: number
  // 分支的消息（从分支点之后的消息）
  messages: ChatMessage[]
  // 是否为当前活动分支
  isActive: boolean
}

export interface BranchState {
  // 当前线程的分支列表
  branches: Record<string, Branch[]> // threadId -> branches
  // 当前活动分支 ID
  activeBranchId: Record<string, string | null> // threadId -> branchId
}

export interface BranchActions {
  // 从指定消息创建分支
  createBranch: (messageId: string, name?: string) => string | null
  // 切换到指定分支
  switchBranch: (branchId: string) => boolean
  // 切换回主线
  switchToMainline: () => void
  // 删除分支
  deleteBranch: (branchId: string) => boolean
  // 重命名分支
  renameBranch: (branchId: string, name: string) => boolean
  // 获取当前线程的所有分支
  getBranches: () => Branch[]
  // 获取当前活动分支
  getActiveBranch: () => Branch | null
  // 从消息重新生成（创建新分支并重新发送）
  regenerateFromMessage: (messageId: string) => { branchId: string; messageContent: any } | null
}

export type BranchSlice = BranchState & BranchActions

// ===== 辅助函数 =====

const generateId = () => crypto.randomUUID()

// ===== Slice 创建器 =====

export const createBranchSlice: StateCreator<
  ThreadSlice & MessageSlice & BranchSlice,
  [],
  [],
  BranchSlice
> = (set, get) => ({
  branches: {},
  activeBranchId: {},

  // 创建分支
  createBranch: (messageId, name) => {
    const threadId = get().currentThreadId
    if (!threadId) return null

    const thread = get().threads[threadId]
    if (!thread) return null

    // 找到消息索引
    const messageIndex = thread.messages.findIndex(m => m.id === messageId)
    if (messageIndex === -1) return null

    const branchId = generateId()
    const branchName = name || `Branch ${(get().branches[threadId]?.length || 0) + 1}`

    // 复制分支点之后的消息
    const branchMessages = thread.messages.slice(messageIndex + 1).map(m => ({
      ...m,
      id: generateId(), // 新 ID 避免冲突
    }))

    const newBranch: Branch = {
      id: branchId,
      name: branchName,
      forkFromMessageId: messageId,
      createdAt: Date.now(),
      messages: branchMessages,
      isActive: false,
    }

    set(state => ({
      branches: {
        ...state.branches,
        [threadId]: [...(state.branches[threadId] || []), newBranch],
      },
    }))

    return branchId
  },

  // 切换分支
  switchBranch: (branchId) => {
    const threadId = get().currentThreadId
    if (!threadId) return false

    const branches = get().branches[threadId] || []
    const targetBranch = branches.find(b => b.id === branchId)
    if (!targetBranch) return false

    const thread = get().threads[threadId]
    if (!thread) return false

    // 找到分支点
    const forkIndex = thread.messages.findIndex(m => m.id === targetBranch.forkFromMessageId)
    if (forkIndex === -1) return false

    // 保存当前分支的消息（如果有活动分支）
    const currentBranchId = get().activeBranchId[threadId]
    
    set(state => {
      const currentThread = state.threads[threadId]
      if (!currentThread) return state

      // 如果当前有活动分支，保存其消息
      let updatedBranches = [...(state.branches[threadId] || [])]
      
      if (currentBranchId) {
        const currentBranchIndex = updatedBranches.findIndex(b => b.id === currentBranchId)
        if (currentBranchIndex !== -1) {
          const currentBranch = updatedBranches[currentBranchIndex]
          const currentForkIndex = currentThread.messages.findIndex(
            m => m.id === currentBranch.forkFromMessageId
          )
          if (currentForkIndex !== -1) {
            updatedBranches[currentBranchIndex] = {
              ...currentBranch,
              messages: currentThread.messages.slice(currentForkIndex + 1),
              isActive: false,
            }
          }
        }
      } else {
        // 保存主线消息到一个临时分支
        // （可选：如果需要保存主线状态）
      }

      // 更新目标分支为活动状态
      const targetIndex = updatedBranches.findIndex(b => b.id === branchId)
      if (targetIndex !== -1) {
        updatedBranches[targetIndex] = {
          ...updatedBranches[targetIndex],
          isActive: true,
        }
      }

      // 替换消息为分支消息
      const newMessages = [
        ...currentThread.messages.slice(0, forkIndex + 1),
        ...targetBranch.messages,
      ]

      return {
        threads: {
          ...state.threads,
          [threadId]: {
            ...currentThread,
            messages: newMessages,
            lastModified: Date.now(),
          },
        },
        branches: {
          ...state.branches,
          [threadId]: updatedBranches,
        },
        activeBranchId: {
          ...state.activeBranchId,
          [threadId]: branchId,
        },
      }
    })

    return true
  },

  // 切换回主线
  switchToMainline: () => {
    const threadId = get().currentThreadId
    if (!threadId) return

    const currentBranchId = get().activeBranchId[threadId]
    if (!currentBranchId) return // 已经在主线

    const thread = get().threads[threadId]
    const branches = get().branches[threadId] || []
    const currentBranch = branches.find(b => b.id === currentBranchId)

    if (!thread || !currentBranch) return

    // 找到分支点
    const forkIndex = thread.messages.findIndex(m => m.id === currentBranch.forkFromMessageId)
    if (forkIndex === -1) return

    set(state => {
      const currentThread = state.threads[threadId]
      if (!currentThread) return state

      // 保存当前分支的消息
      const updatedBranches = (state.branches[threadId] || []).map(b => {
        if (b.id === currentBranchId) {
          return {
            ...b,
            messages: currentThread.messages.slice(forkIndex + 1),
            isActive: false,
          }
        }
        return b
      })

      // 恢复主线消息（只保留到分支点）
      // 注意：这里简化处理，实际可能需要保存主线的完整状态
      const newMessages = currentThread.messages.slice(0, forkIndex + 1)

      return {
        threads: {
          ...state.threads,
          [threadId]: {
            ...currentThread,
            messages: newMessages,
            lastModified: Date.now(),
          },
        },
        branches: {
          ...state.branches,
          [threadId]: updatedBranches,
        },
        activeBranchId: {
          ...state.activeBranchId,
          [threadId]: null,
        },
      }
    })
  },

  // 删除分支
  deleteBranch: (branchId) => {
    const threadId = get().currentThreadId
    if (!threadId) return false

    const branches = get().branches[threadId] || []
    if (!branches.find(b => b.id === branchId)) return false

    // 如果删除的是当前活动分支，先切换回主线
    if (get().activeBranchId[threadId] === branchId) {
      get().switchToMainline()
    }

    set(state => ({
      branches: {
        ...state.branches,
        [threadId]: (state.branches[threadId] || []).filter(b => b.id !== branchId),
      },
    }))

    return true
  },

  // 重命名分支
  renameBranch: (branchId, name) => {
    const threadId = get().currentThreadId
    if (!threadId) return false

    set(state => ({
      branches: {
        ...state.branches,
        [threadId]: (state.branches[threadId] || []).map(b =>
          b.id === branchId ? { ...b, name } : b
        ),
      },
    }))

    return true
  },

  // 获取分支列表
  getBranches: () => {
    const threadId = get().currentThreadId
    if (!threadId) return []
    return get().branches[threadId] || []
  },

  // 获取当前活动分支
  getActiveBranch: () => {
    const threadId = get().currentThreadId
    if (!threadId) return null

    const branchId = get().activeBranchId[threadId]
    if (!branchId) return null

    const branches = get().branches[threadId] || []
    return branches.find(b => b.id === branchId) || null
  },

  // 从消息重新生成
  regenerateFromMessage: (messageId) => {
    const threadId = get().currentThreadId
    if (!threadId) return null

    const thread = get().threads[threadId]
    if (!thread) return null

    // 找到消息
    const messageIndex = thread.messages.findIndex(m => m.id === messageId)
    if (messageIndex === -1) return null

    const message = thread.messages[messageIndex]

    // 找到要重新生成的用户消息
    let userMessageIndex = messageIndex
    if (message.role !== 'user') {
      // 如果点击的是 assistant 消息，找到前一个用户消息
      userMessageIndex = messageIndex - 1
      while (userMessageIndex >= 0 && thread.messages[userMessageIndex].role !== 'user') {
        userMessageIndex--
      }
      if (userMessageIndex < 0) return null
    }

    const userMessage = thread.messages[userMessageIndex]
    const messageContent = (userMessage as any).content

    // 如果是第一条消息，不创建分支，直接返回 null（让调用方使用旧逻辑）
    if (userMessageIndex === 0) {
      return null
    }

    // 分支点：用户消息（这样分支会包含用户消息之后的 AI 回复）
    const forkMessageId = userMessage.id

    // 获取用户消息之后的所有消息（即 AI 的回复）
    const messagesAfterUser = thread.messages.slice(userMessageIndex + 1)

    // 只有当有 AI 回复时才创建分支
    if (messagesAfterUser.length === 0) {
      return null
    }

    // 创建分支保存当前的 AI 回复
    const branchId = generateId()
    const branchName = `Branch: ${new Date().toLocaleTimeString()}`

    const newBranch: Branch = {
      id: branchId,
      name: branchName,
      forkFromMessageId: forkMessageId,
      createdAt: Date.now(),
      messages: messagesAfterUser.map(m => ({ ...m })), // 复制 AI 回复
      isActive: false,
    }

    // 更新状态：添加分支 + 删除主线中用户消息之后的消息
    set(state => {
      const currentThread = state.threads[threadId]
      if (!currentThread) return state

      return {
        branches: {
          ...state.branches,
          [threadId]: [...(state.branches[threadId] || []), newBranch],
        },
        threads: {
          ...state.threads,
          [threadId]: {
            ...currentThread,
            // 保留到用户消息（包含用户消息），删除之后的 AI 回复
            messages: currentThread.messages.slice(0, userMessageIndex + 1),
            lastModified: Date.now(),
          },
        },
      }
    })

    return {
      branchId,
      messageContent,
    }
  },
})
