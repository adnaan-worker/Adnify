/**
 * 对话分支管理组件
 * 显示分支列表、切换分支、创建分支等操作
 */

import React, { useState, useCallback } from 'react'
import { GitBranch, Trash2, Edit2, Check, X, RotateCcw, ChevronDown } from 'lucide-react'
import { useAgentStore, selectBranches, selectActiveBranch, selectIsOnBranch } from '@/renderer/agent'
import { Button } from '../ui'
import type { Branch } from '@/renderer/agent/store/slices/branchSlice'

interface BranchManagerProps {
  language?: 'zh' | 'en'
  onClose?: () => void
}

export default function BranchManager({ language = 'en', onClose }: BranchManagerProps) {
  const branches = useAgentStore(selectBranches)
  const activeBranch = useAgentStore(selectActiveBranch)
  const isOnBranch = useAgentStore(selectIsOnBranch)
  
  const switchBranch = useAgentStore(state => state.switchBranch)
  const switchToMainline = useAgentStore(state => state.switchToMainline)
  const deleteBranch = useAgentStore(state => state.deleteBranch)
  const renameBranch = useAgentStore(state => state.renameBranch)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const handleStartEdit = useCallback((branch: Branch) => {
    setEditingId(branch.id)
    setEditName(branch.name)
  }, [])

  const handleSaveEdit = useCallback(() => {
    if (editingId && editName.trim()) {
      renameBranch(editingId, editName.trim())
    }
    setEditingId(null)
    setEditName('')
  }, [editingId, editName, renameBranch])

  const handleCancelEdit = useCallback(() => {
    setEditingId(null)
    setEditName('')
  }, [])

  const handleSwitchBranch = useCallback((branchId: string) => {
    switchBranch(branchId)
    onClose?.()
  }, [switchBranch, onClose])

  const handleSwitchToMainline = useCallback(() => {
    switchToMainline()
    onClose?.()
  }, [switchToMainline, onClose])

  const handleDeleteBranch = useCallback((branchId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    deleteBranch(branchId)
  }, [deleteBranch])

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-medium text-text-primary">
            {language === 'zh' ? '对话分支' : 'Conversation Branches'}
          </h3>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6">
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Mainline */}
      <div
        className={`p-3 rounded-xl cursor-pointer transition-all duration-200 border group ${
          !isOnBranch
            ? 'bg-accent/10 border-accent/20 text-accent'
            : 'bg-surface/30 border-white/5 hover:border-white/10 hover:bg-surface/50 text-text-secondary'
        }`}
        onClick={handleSwitchToMainline}
      >
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${!isOnBranch ? 'bg-accent' : 'bg-text-muted'}`} />
          <span className="text-sm font-medium">
            {language === 'zh' ? '主线' : 'Main'}
          </span>
          {!isOnBranch && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent">
              {language === 'zh' ? '当前' : 'Current'}
            </span>
          )}
        </div>
      </div>

      {/* Branch List */}
      {branches.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-text-muted px-1">
            {language === 'zh' ? `${branches.length} 个分支` : `${branches.length} branch${branches.length > 1 ? 'es' : ''}`}
          </p>
          {branches.map((branch) => (
            <div
              key={branch.id}
              className={`p-3 rounded-xl cursor-pointer transition-all duration-200 border group ${
                activeBranch?.id === branch.id
                  ? 'bg-accent/10 border-accent/20 text-accent'
                  : 'bg-surface/30 border-white/5 hover:border-white/10 hover:bg-surface/50 text-text-secondary'
              }`}
              onClick={() => handleSwitchBranch(branch.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <GitBranch className="w-3.5 h-3.5 flex-shrink-0" />
                  {editingId === branch.id ? (
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit()
                        if (e.key === 'Escape') handleCancelEdit()
                      }}
                      className="flex-1 bg-transparent border-b border-accent outline-none text-sm"
                      autoFocus
                    />
                  ) : (
                    <span className="text-sm font-medium truncate">{branch.name}</span>
                  )}
                  {activeBranch?.id === branch.id && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent flex-shrink-0">
                      {language === 'zh' ? '当前' : 'Current'}
                    </span>
                  )}
                </div>
                
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {editingId === branch.id ? (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => { e.stopPropagation(); handleSaveEdit() }}
                        className="h-6 w-6 hover:bg-green-500/10 hover:text-green-500"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => { e.stopPropagation(); handleCancelEdit() }}
                        className="h-6 w-6 hover:bg-red-500/10 hover:text-red-500"
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => { e.stopPropagation(); handleStartEdit(branch) }}
                        className="h-6 w-6 hover:bg-white/10"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => handleDeleteBranch(branch.id, e)}
                        className="h-6 w-6 hover:bg-red-500/10 hover:text-red-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              
              <div className="mt-1.5 flex items-center gap-2 text-xs text-text-muted">
                <span>{formatTime(branch.createdAt)}</span>
                <span>•</span>
                <span>{branch.messages.length} {language === 'zh' ? '条消息' : 'messages'}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-text-muted">
          <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">
            {language === 'zh' ? '暂无分支' : 'No branches yet'}
          </p>
          <p className="text-xs mt-1 opacity-60">
            {language === 'zh' 
              ? '点击消息的"重新生成"按钮创建分支' 
              : 'Click "Regenerate" on a message to create a branch'}
          </p>
        </div>
      )}

      {/* Help Text */}
      <div className="pt-2 border-t border-white/5">
        <p className="text-xs text-text-muted leading-relaxed">
          {language === 'zh'
            ? '分支允许你从对话的任意点探索不同的方向，而不会丢失原有的对话内容。'
            : 'Branches let you explore different directions from any point in the conversation without losing the original content.'}
        </p>
      </div>
    </div>
  )
}

/**
 * 分支选择器 - 显示在聊天面板顶部左侧
 * 始终显示当前分支状态，点击展开分支管理
 */
export function BranchSelector({ 
  language = 'en',
  onClick 
}: { 
  language?: 'zh' | 'en'
  onClick?: () => void 
}) {
  const activeBranch = useAgentStore(selectActiveBranch)
  const branches = useAgentStore(selectBranches)
  const isOnBranch = useAgentStore(selectIsOnBranch)

  // 计算显示文本
  const displayText = isOnBranch && activeBranch 
    ? activeBranch.name 
    : (language === 'zh' ? '主线' : 'Main')

  const hasBranches = branches.length > 0

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-colors ${
        isOnBranch 
          ? 'bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20' 
          : 'hover:bg-white/5 text-text-muted hover:text-text-primary'
      }`}
      title={language === 'zh' ? '点击管理分支' : 'Click to manage branches'}
    >
      <GitBranch className="w-3.5 h-3.5" />
      <span className="truncate max-w-[120px]">{displayText}</span>
      {hasBranches && !isOnBranch && (
        <span className="ml-1 px-1 py-0.5 rounded bg-white/10 text-[10px]">
          +{branches.length}
        </span>
      )}
      <ChevronDown className="w-3 h-3 opacity-50" />
    </button>
  )
}

/**
 * 分支指示器 - 简化版，只在有分支时显示
 * @deprecated 使用 BranchSelector 替代
 */
export function BranchIndicator({ 
  language = 'en',
  onClick 
}: { 
  language?: 'zh' | 'en'
  onClick?: () => void 
}) {
  const activeBranch = useAgentStore(selectActiveBranch)
  const branches = useAgentStore(selectBranches)

  if (!activeBranch && branches.length === 0) return null

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-accent/10 border border-accent/20 text-accent text-xs hover:bg-accent/20 transition-colors"
    >
      <GitBranch className="w-3 h-3" />
      {activeBranch ? (
        <span className="truncate max-w-[100px]">{activeBranch.name}</span>
      ) : (
        <span>{branches.length} {language === 'zh' ? '个分支' : 'branches'}</span>
      )}
    </button>
  )
}

/**
 * 消息操作按钮 - 创建分支/重新生成
 */
export function MessageBranchActions({
  messageId,
  language = 'en',
  onRegenerate,
}: {
  messageId: string
  language?: 'zh' | 'en'
  onRegenerate?: (messageId: string) => void
}) {
  const regenerateFromMessage = useAgentStore(state => state.regenerateFromMessage)
  const [showConfirm, setShowConfirm] = useState(false)

  const handleCreateBranch = useCallback(() => {
    const result = regenerateFromMessage(messageId)
    if (result && onRegenerate) {
      // 切换到新分支后重新发送消息
      onRegenerate(messageId)
    }
    setShowConfirm(false)
  }, [messageId, regenerateFromMessage, onRegenerate])

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowConfirm(true)}
        className="text-xs gap-1 h-6 px-2 hover:bg-white/5"
        title={language === 'zh' ? '重新生成（创建分支）' : 'Regenerate (create branch)'}
      >
        <RotateCcw className="w-3 h-3" />
        <span>{language === 'zh' ? '重新生成' : 'Regenerate'}</span>
      </Button>

      {showConfirm && (
        <div className="absolute bottom-full left-0 mb-1 p-2 rounded-lg bg-surface border border-white/10 shadow-xl z-50 min-w-[200px]">
          <p className="text-xs text-text-muted mb-2">
            {language === 'zh' 
              ? '这将创建一个新分支并重新生成回复' 
              : 'This will create a new branch and regenerate the response'}
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowConfirm(false)}
              className="flex-1 h-6 text-xs"
            >
              {language === 'zh' ? '取消' : 'Cancel'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleCreateBranch}
              className="flex-1 h-6 text-xs"
            >
              <GitBranch className="w-3 h-3 mr-1" />
              {language === 'zh' ? '创建分支' : 'Create Branch'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
