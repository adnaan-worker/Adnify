/**
 * Git 相关状态切片
 * 包含缓存层，避免频繁重复请求 Git 数据
 */
import { StateCreator } from 'zustand'
import type { GitStatus, GitBranch, GitStashEntry, GitCommit } from '@renderer/services/gitService'

export interface GitSlice {
  gitStatus: GitStatus | null
  isGitRepo: boolean
  /** 分支列表缓存 */
  gitBranches: GitBranch[]
  /** Stash 列表缓存 */
  gitStashList: GitStashEntry[]
  /** 最近提交历史缓存 */
  gitRecentCommits: GitCommit[]
  /** 当前进行中的 Git 操作 */
  gitOperationState: 'normal' | 'merge' | 'rebase' | 'cherry-pick' | 'revert'
  /** 缓存上次刷新时间，用于节流 */
  _gitCacheTimestamp: number

  setGitStatus: (status: GitStatus | null) => void
  setIsGitRepo: (isRepo: boolean) => void
  setGitBranches: (branches: GitBranch[]) => void
  setGitStashList: (list: GitStashEntry[]) => void
  setGitRecentCommits: (commits: GitCommit[]) => void
  setGitOperationState: (state: GitSlice['gitOperationState']) => void
  /** 批量更新 Git 缓存（减少渲染次数） */
  updateGitCache: (data: Partial<Pick<GitSlice,
    'gitStatus' | 'gitBranches' | 'gitStashList' | 'gitRecentCommits' | 'gitOperationState'
  >>) => void
}

export const createGitSlice: StateCreator<GitSlice, [], [], GitSlice> = (set) => ({
  gitStatus: null,
  isGitRepo: false,
  gitBranches: [],
  gitStashList: [],
  gitRecentCommits: [],
  gitOperationState: 'normal',
  _gitCacheTimestamp: 0,

  setGitStatus: (status) => set({ gitStatus: status }),
  setIsGitRepo: (isRepo) => set({ isGitRepo: isRepo }),
  setGitBranches: (branches) => set({ gitBranches: branches }),
  setGitStashList: (list) => set({ gitStashList: list }),
  setGitRecentCommits: (commits) => set({ gitRecentCommits: commits }),
  setGitOperationState: (state) => set({ gitOperationState: state }),
  updateGitCache: (data) => set({ ...data, _gitCacheTimestamp: Date.now() }),
})
