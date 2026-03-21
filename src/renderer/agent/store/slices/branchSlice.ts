/**
 * 对话分支管理 Slice
 * 支持从任意消息点创建分支、切换分支、合并分支
 * 
 * 主线消息保存机制：
 * - 使用特殊的 __mainline__ 分支保存主线消息
 * - 切换到分支时自动保存主线消息
 * - 切换回主线时自动恢复主线消息
 */

import type { StateCreator } from 'zustand'
import type { ChatMessage, MessageContent } from '../../types'
import type { ThreadSlice } from './threadSlice'
import type { MessageSlice } from './messageSlice'

// ===== 常量 =====

/** 主线分支的特殊 ID */
const MAINLINE_BRANCH_ID = '__mainline__'

// ===== 类型定义 =====

export interface Branch {
  id: string
  name: string
  /** 分支起点的消息 ID */
  forkFromMessageId: string
  /** 分支创建时间 */
  createdAt: number
  /** 分支的消息（从分支点之后的消息） */
  messages: ChatMessage[]
  /** 是否为当前活动分支 */
  isActive: boolean
}

export interface BranchState {
  /** 当前线程的分支列表 threadId -> branches */
  branches: Record<string, Branch[]>
  /** 当前活动分支 ID threadId -> branchId */
  activeBranchId: Record<string, string | null>
}

export interface BranchActions {
  /** 从指定消息创建分支 */
  createBranch: (messageId: string, name?: string) => string | null
  /** 切换到指定分支 */
  switchBranch: (branchId: string) => boolean
  /** 切换回主线 */
  switchToMainline: () => void
  /** 删除分支 */
  deleteBranch: (branchId: string) => boolean
  /** 重命名分支 */
  renameBranch: (branchId: string, name: string) => boolean
  /** 获取当前线程的所有分支（不包含内部的主线分支） */
  getBranches: () => Branch[]
  /** 获取当前活动分支 */
  getActiveBranch: () => Branch | null
  /** 从消息重新生成（创建新分支并重新发送） */
  regenerateFromMessage: (messageId: string) => { branchId: string; messageContent: MessageContent } | null
}

export type BranchSlice = BranchState & BranchActions

// ===== 辅助函数 =====

const generateId = () => crypto.randomUUID()

/**
 * 获取或创建主线分支
 * 用于在切换到其他分支时保存主线消息
 */
function getOrCreateMainlineBranch(
  branches: Branch[],
  forkFromMessageId: string,
  messages: ChatMessage[]
): Branch {
  const existing = branches.find(b => b.id === MAINLINE_BRANCH_ID)
  if (existing) {
    return {
      ...existing,
      forkFromMessageId,
      messages: messages.map(m => ({ ...m })),
    }
  }
  return {
    id: MAINLINE_BRANCH_ID,
    name: '__mainline__',
    forkFromMessageId,
    createdAt: Date.now(),
    messages: messages.map(m => ({ ...m })),
    isActive: false,
  }
}

// ===== Slice 创建器 =====

export const createBranchSlice: StateCreator<
  ThreadSlice & MessageSlice & BranchSlice,
  [],
  [],
  BranchSlice
> = (set, get) => ({
  branches: {},
  activeBranchId: {},

  createBranch: (messageId, name) => {
    const threadId = get().currentThreadId
    if (!threadId) return null

    const thread = get().threads[threadId]
    if (!thread) return null

    const messageIndex = thread.messages.findIndex(m => m.id === messageId)
    if (messageIndex === -1) return null

    // 限制每个线程的分支数量
    const MAX_BRANCHES_PER_THREAD = 10
    const existingBranches = (get().branches[threadId] || []).filter(b => b.id !== MAINLINE_BRANCH_ID)
    if (existingBranches.length >= MAX_BRANCHES_PER_THREAD) {
      // 删除最旧的分支
      const oldest = existingBranches.sort((a, b) => a.createdAt - b.createdAt)[0]
      if (oldest) {
        // 如果最旧的分支是当前活动分支，先切换回主线
        if (get().activeBranchId[threadId] === oldest.id) {
          get().switchToMainline()
        }
        set(state => ({
          branches: {
            ...state.branches,
            [threadId]: (state.branches[threadId] || []).filter(b => b.id !== oldest.id),
          },
        }))
      }
    }

    const branchId = generateId()
    const branchName = name || `Branch ${existingBranches.length + 1}`

    const branchMessages = thread.messages.slice(messageIndex + 1).map(m => ({
      ...m,
      id: generateId(),
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

  switchBranch: (branchId) => {
    const threadId = get().currentThreadId
    if (!threadId) return false

    const branches = get().branches[threadId] || []
    const targetBranch = branches.find(b => b.id === branchId)
    if (!targetBranch) return false

    const thread = get().threads[threadId]
    if (!thread) return false

    const forkIndex = thread.messages.findIndex(m => m.id === targetBranch.forkFromMessageId)
    if (forkIndex === -1) return false

    const currentBranchId = get().activeBranchId[threadId]

    set(state => {
      const currentThread = state.threads[threadId]
      if (!currentThread) return state

      let updatedBranches = [...(state.branches[threadId] || [])]

      if (currentBranchId) {
        // 当前在某个分支上，保存该分支的消息
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
        // 当前在主线上，保存主线消息到 __mainline__ 分支
        const mainlineMessages = currentThread.messages.slice(forkIndex + 1)
        if (mainlineMessages.length > 0) {
          const mainlineBranch = getOrCreateMainlineBranch(
            updatedBranches,
            targetBranch.forkFromMessageId,
            mainlineMessages
          )
          const mainlineIndex = updatedBranches.findIndex(b => b.id === MAINLINE_BRANCH_ID)
          if (mainlineIndex !== -1) {
            updatedBranches[mainlineIndex] = mainlineBranch
          } else {
            updatedBranches.push(mainlineBranch)
          }
        }
      }

      // 更新目标分支为活动状态
      const targetIndex = updatedBranches.findIndex(b => b.id === branchId)
      if (targetIndex !== -1) {
        updatedBranches[targetIndex] = { ...updatedBranches[targetIndex], isActive: true }
      }

      // 替换消息为分支消息
      const newMessages = [
        ...currentThread.messages.slice(0, forkIndex + 1),
        ...targetBranch.messages,
      ]

      return {
        threads: {
          ...state.threads,
          [threadId]: { ...currentThread, messages: newMessages, lastModified: Date.now() },
        },
        branches: { ...state.branches, [threadId]: updatedBranches },
        activeBranchId: { ...state.activeBranchId, [threadId]: branchId },
      }
    })

    return true
  },

  switchToMainline: () => {
    const threadId = get().currentThreadId
    if (!threadId) return

    const currentBranchId = get().activeBranchId[threadId]
    if (!currentBranchId) return // 已经在主线

    const thread = get().threads[threadId]
    const branches = get().branches[threadId] || []
    const currentBranch = branches.find(b => b.id === currentBranchId)
    const mainlineBranch = branches.find(b => b.id === MAINLINE_BRANCH_ID)

    if (!thread || !currentBranch) return

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

      // 恢复主线消息
      let newMessages: ChatMessage[]
      if (mainlineBranch && mainlineBranch.messages.length > 0) {
        newMessages = [
          ...currentThread.messages.slice(0, forkIndex + 1),
          ...mainlineBranch.messages,
        ]
      } else {
        newMessages = currentThread.messages.slice(0, forkIndex + 1)
      }

      return {
        threads: {
          ...state.threads,
          [threadId]: { ...currentThread, messages: newMessages, lastModified: Date.now() },
        },
        branches: { ...state.branches, [threadId]: updatedBranches },
        activeBranchId: { ...state.activeBranchId, [threadId]: null },
      }
    })
  },

  deleteBranch: (branchId) => {
    const threadId = get().currentThreadId
    if (!threadId) return false

    // 不允许删除主线分支
    if (branchId === MAINLINE_BRANCH_ID) return false

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

  renameBranch: (branchId, name) => {
    const threadId = get().currentThreadId
    if (!threadId) return false

    // 不允许重命名主线分支
    if (branchId === MAINLINE_BRANCH_ID) return false

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

  getBranches: () => {
    const threadId = get().currentThreadId
    if (!threadId) return []
    // 过滤掉内部的主线分支
    return (get().branches[threadId] || []).filter(b => b.id !== MAINLINE_BRANCH_ID)
  },

  getActiveBranch: () => {
    const threadId = get().currentThreadId
    if (!threadId) return null

    const branchId = get().activeBranchId[threadId]
    if (!branchId) return null

    const branches = get().branches[threadId] || []
    return branches.find(b => b.id === branchId) || null
  },

  regenerateFromMessage: (messageId) => {
    const threadId = get().currentThreadId
    if (!threadId) return null

    const thread = get().threads[threadId]
    if (!thread) return null

    const messageIndex = thread.messages.findIndex(m => m.id === messageId)
    if (messageIndex === -1) return null

    const message = thread.messages[messageIndex]

    // 找到要重新生成的用户消息
    let userMessageIndex = messageIndex
    if (message.role !== 'user') {
      // 向前查找最近的用户消息
      userMessageIndex = messageIndex - 1
      while (userMessageIndex >= 0 && thread.messages[userMessageIndex].role !== 'user') {
        userMessageIndex--
      }
      if (userMessageIndex < 0) return null
    }

    const userMessage = thread.messages[userMessageIndex]
    const messageContent = (userMessage as { content: MessageContent }).content

    // 检查是否有后续消息（AI回复）
    const messagesAfterUser = thread.messages.slice(userMessageIndex + 1)
    if (messagesAfterUser.length === 0) {
      // 没有AI回复，不需要创建分支，直接返回用户消息内容
      return null
    }

    const branchId = generateId()
    const branchName = `Branch ${new Date().toLocaleTimeString()}`

    // 确定分支点
    let forkMessageId: string
    let forkMessageIndex: number
    
    if (userMessageIndex === 0) {
      // 第一条用户消息，分支点就是它自己
      forkMessageId = userMessage.id
      forkMessageIndex = 0
    } else {
      // 不是第一条，分支点是前一条消息
      forkMessageIndex = userMessageIndex - 1
      forkMessageId = thread.messages[forkMessageIndex].id
    }

    // 保存当前主线消息到 __mainline__ 分支
    const currentBranches = get().branches[threadId] || []
    const messagesAfterFork = thread.messages.slice(forkMessageIndex + 1)
    const mainlineBranch = getOrCreateMainlineBranch(
      currentBranches,
      forkMessageId,
      messagesAfterFork
    )

    const newBranch: Branch = {
      id: branchId,
      name: branchName,
      forkFromMessageId: forkMessageId,
      createdAt: Date.now(),
      messages: [],  // 新分支开始时没有消息，等待重新生成
      isActive: true,
    }

    set(state => {
      const currentThread = state.threads[threadId]
      if (!currentThread) return state

      // 更新分支列表
      let updatedBranches = [...(state.branches[threadId] || [])]
      
      // 更新或添加 mainline 分支
      const mainlineIndex = updatedBranches.findIndex(b => b.id === MAINLINE_BRANCH_ID)
      if (mainlineIndex !== -1) {
        updatedBranches[mainlineIndex] = mainlineBranch
      } else {
        updatedBranches.push(mainlineBranch)
      }
      
      // 添加新分支
      updatedBranches.push(newBranch)

      // 截断消息：删除用户消息及之后的所有消息
      // sendMessage 会重新添加用户消息
      const newMessages = currentThread.messages.slice(0, userMessageIndex)

      return {
        branches: {
          ...state.branches,
          [threadId]: updatedBranches,
        },
        threads: {
          ...state.threads,
          [threadId]: {
            ...currentThread,
            messages: newMessages,
            lastModified: Date.now(),
          },
        },
        activeBranchId: {
          ...state.activeBranchId,
          [threadId]: branchId,
        },
      }
    })

    return { branchId, messageContent }
  },
})
