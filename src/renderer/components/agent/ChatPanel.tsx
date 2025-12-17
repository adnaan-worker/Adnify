/**
 * Chat Panel
 * Agent 聊天面板 - 沉浸式设计
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Sparkles,
  AlertTriangle,
  History,
  Plus,
  Trash2,
  Upload,
  Database,
  GitBranch,
  Terminal,
  File,
  Code,
  Folder,
  X,
  MessageSquare
} from 'lucide-react'
import { Logo } from '@/renderer/components/Logo'
import { useStore } from '@/renderer/store'
import { useAgent } from '@/renderer/hooks/useAgent'
import { useToast } from '@/renderer/components/Toast'
import { t } from '@/renderer/i18n'
import { toFullPath } from '@/renderer/utils/pathUtils'
import {
  ChatMessage as ChatMessageType,
  ChatThread,
  isUserMessage,
  isAssistantMessage,
  getMessageText,
  ContextItem,
  FileContext,
  CodebaseContext,
  GitContext,
  TerminalContext,
  SymbolsContext,
} from '@/renderer/agent/core/types'

import { ChatInput, PendingImage } from '@/renderer/components/chat'
import FileMentionPopup from '@/renderer/components/FileMentionPopup'
import ChatMessageUI from './ChatMessage'
import AgentStatusBar from './AgentStatusBar'

export default function ChatPanel() {
  const {
    chatMode,
    setChatMode,
    llmConfig,
    workspacePath,
    openFile,
    setActiveFile,
    language,
    activeFilePath,
    setActiveDiff,
  } = useStore()

  const toast = useToast()

  const {
    messages,
    streamState,
    isStreaming,
    isAwaitingApproval,
    pendingToolCall,
    pendingChanges,
    messageCheckpoints,
    contextItems,
    allThreads: threads,
    currentThreadId,
    createThread,
    switchThread,
    deleteThread,
    sendMessage,
    abort,
    clearMessages,
    deleteMessagesAfter,
    approveCurrentTool,
    rejectCurrentTool,
    acceptAllChanges,
    undoAllChanges,
    acceptChange,
    undoChange,
    restoreToCheckpoint,
    getCheckpointForMessage,
    addContextItem,
    removeContextItem,
    clearContextItems,
  } = useAgent()

  const [input, setInput] = useState('')
  const [images, setImages] = useState<PendingImage[]>([])
  const [showThreads, setShowThreads] = useState(false)
  const [showFileMention, setShowFileMention] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionPosition, setMentionPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputContainerRef = useRef<HTMLDivElement>(null)

  // Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 处理文件点击 - 用于打开文件
  const handleFileClick = useCallback(async (filePath: string) => {
    const fullPath = toFullPath(filePath, workspacePath)
    const content = await window.electronAPI.readFile(fullPath)
    if (content === null) return
    openFile(fullPath, content)
    setActiveFile(fullPath)
  }, [workspacePath, openFile, setActiveFile])

  // 暴露给子组件使用
  void handleFileClick

  // 处理显示 diff
  const handleShowDiff = useCallback(async (filePath: string, oldContent: string, newContent: string) => {
    const fullPath = toFullPath(filePath, workspacePath)
    const currentContent = await window.electronAPI.readFile(fullPath)
    if (currentContent !== null) {
      openFile(fullPath, currentContent)
      setActiveFile(fullPath)
    }
    setActiveDiff({
      original: oldContent,
      modified: newContent,
      filePath: fullPath,
    })
  }, [workspacePath, openFile, setActiveFile, setActiveDiff])

  // 图片处理
  const addImage = useCallback(async (file: File) => {
    const id = crypto.randomUUID()
    const previewUrl = URL.createObjectURL(file)

    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      setImages(prev => prev.map(img => (img.id === id ? { ...img, base64 } : img)))
    }
    reader.readAsDataURL(file)

    setImages(prev => [...prev, { id, file, previewUrl }])
  }, [])

  // 粘贴处理
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) addImage(file)
      }
    }
  }, [addImage])

  // 拖放处理
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    const imageFiles = files.filter(f => f.type.startsWith('image/'))
    if (imageFiles.length > 0) {
      imageFiles.forEach(addImage)
      return
    }

    // 处理代码文件
    for (const file of files) {
      const filePath = (file as any).path || file.name
      const exists = contextItems.some((s: ContextItem) => s.type === 'File' && (s as FileContext).uri === filePath)
      if (!exists) {
        addContextItem({ type: 'File', uri: filePath })
      }
    }
  }, [addImage, contextItems, addContextItem])

  // 输入变化处理
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    const cursorPos = e.target.selectionStart || 0
    setInput(value)

    const textBeforeCursor = value.slice(0, cursorPos)
    const atMatch = textBeforeCursor.match(/@([^\s@]*)$/)

    if (atMatch) {
      setMentionQuery(atMatch[1])
      if (inputContainerRef.current) {
        const rect = inputContainerRef.current.getBoundingClientRect()
        setMentionPosition({ x: rect.left + 16, y: rect.top })
      }
      setShowFileMention(true)
    } else {
      setShowFileMention(false)
      setMentionQuery('')
    }
  }, [])

  // 上下文选择
  const handleSelectFile = useCallback((selection: string) => {
    const cursorPos = textareaRef.current?.selectionStart || input.length
    const textBeforeCursor = input.slice(0, cursorPos)
    const textAfterCursor = input.slice(cursorPos)

    const atIndex = textBeforeCursor.lastIndexOf('@')
    if (atIndex !== -1) {
      const newInput = textBeforeCursor.slice(0, atIndex) + textAfterCursor.trimStart()
      setInput(newInput)
    }

    const specialContexts = ['codebase', 'git', 'terminal', 'symbols']
    if (specialContexts.includes(selection)) {
      const exists = contextItems.some((s: ContextItem) => s.type === selection.charAt(0).toUpperCase() + selection.slice(1))
      if (!exists) {
        let contextItem: ContextItem
        switch (selection) {
          case 'codebase': contextItem = { type: 'Codebase' } as CodebaseContext; break
          case 'git': contextItem = { type: 'Git' } as GitContext; break
          case 'terminal': contextItem = { type: 'Terminal' } as TerminalContext; break
          case 'symbols': contextItem = { type: 'Symbols' } as SymbolsContext; break
          default: return
        }
        addContextItem(contextItem)
      }
    } else {
      const fullPath = workspacePath ? `${workspacePath}/${selection}` : selection
      const exists = contextItems.some((s: ContextItem) => s.type === 'File' && (s as FileContext).uri.endsWith(selection))
      if (!exists) {
        addContextItem({ type: 'File', uri: fullPath })
      }
    }

    setShowFileMention(false)
    setMentionQuery('')
    textareaRef.current?.focus()
  }, [input, workspacePath, contextItems, addContextItem])

  // 提交
  const handleSubmit = useCallback(async () => {
    if ((!input.trim() && images.length === 0) || isStreaming) return

    let userMessage: string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> = input.trim()

    if (images.length > 0) {
      const readyImages = images.filter(img => img.base64)
      if (readyImages.length !== images.length) return

      userMessage = [
        { type: 'text' as const, text: input.trim() },
        ...readyImages.map(img => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: img.file.type,
            data: img.base64!,
          },
        })),
      ]
    }

    setInput('')
    setImages([])
    await sendMessage(userMessage)
  }, [input, images, isStreaming, sendMessage])

  // 编辑消息
  const handleEditMessage = useCallback(async (messageId: string, content: string) => {
    if (!content.trim()) return
    deleteMessagesAfter(messageId)
    await sendMessage(content.trim())
  }, [deleteMessagesAfter, sendMessage])

  // 重新生成
  const handleRegenerate = useCallback(async (messageId: string) => {
    const msgIndex = messages.findIndex((m: ChatMessageType) => m.id === messageId)
    if (msgIndex <= 0) return

    let userMsgIndex = msgIndex - 1
    while (userMsgIndex >= 0 && messages[userMsgIndex].role !== 'user') {
      userMsgIndex--
    }

    if (userMsgIndex < 0) return
    const userMsg = messages[userMsgIndex]
    if (!isUserMessage(userMsg)) return

    deleteMessagesAfter(userMsg.id)
    await sendMessage(userMsg.content)
  }, [messages, deleteMessagesAfter, sendMessage])

  // 添加当前文件
  const handleAddCurrentFile = useCallback(() => {
    if (!activeFilePath) return
    const exists = contextItems.some((s: ContextItem) => s.type === 'File' && (s as FileContext).uri === activeFilePath)
    if (exists) return
    addContextItem({ type: 'File', uri: activeFilePath })
  }, [activeFilePath, contextItems, addContextItem])

  // 键盘处理
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (showFileMention) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowFileMention(false)
        setMentionQuery('')
      }
      if (['Enter', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.key)) {
        e.preventDefault()
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [showFileMention, handleSubmit])

  const hasApiKey = !!llmConfig.apiKey

  // 处理回退到检查点
  const handleRestore = useCallback(async (messageId: string) => {
    const checkpoint = getCheckpointForMessage(messageId)
    if (!checkpoint) {
      toast.error('No checkpoint found for this message')
      return
    }

    // 确认对话框
    const { globalConfirm } = await import('../ConfirmDialog')
    const confirmed = await globalConfirm({
      title: language === 'zh' ? '恢复检查点' : 'Restore Checkpoint',
      message: t('confirmRestoreCheckpoint', language),
      confirmText: language === 'zh' ? '恢复' : 'Restore',
      variant: 'warning',
    })
    if (!confirmed) return

    const result = await restoreToCheckpoint(checkpoint.id)
    if (result.success) {
      toast.success(`Restored ${result.restoredFiles.length} file(s)`)
      // 关闭 Diff 预览
      setActiveDiff(null)
    } else if (result.errors.length > 0) {
      toast.error(`Restore failed: ${result.errors[0]}`)
    }
  }, [getCheckpointForMessage, restoreToCheckpoint, setActiveDiff, toast, language])

  // 渲染消息
  const renderMessage = useCallback((msg: ChatMessageType) => {
    if (!isUserMessage(msg) && !isAssistantMessage(msg)) return null

    // 检查是否有关联的检查点
    const hasCheckpoint = isUserMessage(msg) && messageCheckpoints.some(cp => cp.messageId === msg.id)

    return (
      <ChatMessageUI
        key={msg.id}
        message={msg}
        onEdit={handleEditMessage}
        onRegenerate={handleRegenerate}
        onRestore={handleRestore}
        onApproveTool={approveCurrentTool}
        onRejectTool={rejectCurrentTool}
        onOpenDiff={handleShowDiff}
        pendingToolId={pendingToolCall?.id}
        hasCheckpoint={hasCheckpoint}
      />
    )
  }, [handleEditMessage, handleRegenerate, handleRestore, approveCurrentTool, rejectCurrentTool, handleShowDiff, pendingToolCall, messageCheckpoints])

  // 获取流式状态文本
  const getStreamingStatus = useCallback(() => {
    if (streamState.phase === 'streaming') return 'Thinking...'
    if (streamState.phase === 'tool_running') return `Running ${streamState.currentToolCall?.name || 'tool'}...`
    if (streamState.phase === 'tool_pending') return 'Waiting for approval'
    return undefined
  }, [streamState])

  return (
    <div
      className={`absolute inset-0 overflow-hidden bg-background transition-colors ${isDragging ? 'bg-accent/5 ring-2 ring-inset ring-accent' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header - Glassmorphism */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-3 bg-background/60 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center gap-1 bg-black/20 rounded-lg p-0.5 border border-white/5">
          <button
            onClick={() => setChatMode('chat')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${chatMode === 'chat'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-text-muted hover:text-text-secondary hover:bg-white/5'
              }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Chat
          </button>
          <button
            onClick={() => setChatMode('agent')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${chatMode === 'agent'
                ? 'bg-accent/20 text-accent shadow-sm shadow-accent/10'
                : 'text-text-muted hover:text-text-secondary hover:bg-white/5'
              }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Agent
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowThreads(!showThreads)}
            className="p-2 rounded-lg hover:bg-white/5 text-text-muted hover:text-text-primary transition-colors"
            title="Chat history"
          >
            <History className="w-4 h-4" />
          </button>
          <button
            onClick={() => createThread()}
            className="p-2 rounded-lg hover:bg-white/5 text-text-muted hover:text-text-primary transition-colors"
            title="New chat"
          >
            <Plus className="w-4 h-4" />
          </button>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <button
            onClick={clearMessages}
            className="p-2 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-colors"
            title="Clear chat"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Thread list overlay */}
      {showThreads && (
        <div className="absolute top-[60px] right-0 left-0 bottom-0 bg-background/95 backdrop-blur-md z-30 overflow-hidden p-4 animate-fade-in">
          <div className="flex flex-col gap-2 max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-text-primary">Chat History</h3>
              <button onClick={() => setShowThreads(false)} className="p-1 rounded hover:bg-surface-active text-text-muted">
                <X className="w-4 h-4" />
              </button>
            </div>
            {threads.map((thread: ChatThread) => {
              if (!thread) return null
              const firstUserMsg = thread.messages.find((m: ChatMessageType) => m.role === 'user')
              const preview = firstUserMsg ? getMessageText(firstUserMsg.content).slice(0, 50) : 'New chat'
              return (
                <div
                  key={thread.id}
                  className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-colors border ${currentThreadId === thread.id
                      ? 'bg-accent/10 border-accent/20 text-accent'
                      : 'bg-surface/30 border-white/5 hover:border-white/10 text-text-secondary'
                    }`}
                  onClick={() => { switchThread(thread.id); setShowThreads(false) }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{preview || 'New chat'}</p>
                    <p className="text-xs text-text-muted mt-0.5">
                      {new Date(thread.lastModified).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteThread(thread.id) }}
                    className="p-2 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Drag Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-background/90 backdrop-blur-sm flex items-center justify-center pointer-events-none animate-fade-in">
          <div className="flex flex-col items-center gap-4 p-12 rounded-2xl border-2 border-dashed border-accent bg-accent/5">
            <Upload className="w-12 h-12 text-accent animate-bounce" />
            <p className="text-lg font-semibold text-text-primary">Drop files here</p>
          </div>
        </div>
      )}

      {/* Messages Area */}
      <div className="absolute inset-0 overflow-y-auto custom-scrollbar bg-background pt-16 pb-48 z-0">
        {/* API Key Warning */}
        {!hasApiKey && (
          <div className="m-4 p-4 border border-warning/20 bg-warning/5 rounded-lg flex gap-3">
            <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />
            <div>
              <span className="font-medium text-sm text-warning block mb-1">{t('setupRequired', language)}</span>
              <p className="text-xs text-text-muted">{t('setupRequiredDesc', language)}</p>
            </div>
          </div>
        )}

        {/* Empty State */}
        {messages.length === 0 && hasApiKey && (
          <div className="h-full flex flex-col items-center justify-center gap-6 pb-20 opacity-50">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-surface to-surface-active border border-white/5 flex items-center justify-center shadow-2xl">
              <Logo className="w-12 h-12 text-text-primary" glow />
            </div>
            <div className="text-center">
              <h2 className="text-xl font-bold text-text-primary mb-1">Adnify Agent</h2>
              <p className="text-sm text-text-muted">{t('howCanIHelp', language)}</p>
            </div>
          </div>
        )}

        {/* Messages List */}
        <div className="flex flex-col pb-32">
          {messages.map((msg: ChatMessageType) => renderMessage(msg))}
        </div>

        <div ref={messagesEndRef} />
      </div>

      {/* File Mention Popup */}
      {showFileMention && (
        <FileMentionPopup
          position={mentionPosition}
          searchQuery={mentionQuery}
          onSelect={handleSelectFile}
          onClose={() => { setShowFileMention(false); setMentionQuery('') }}
        />
      )}

      {/* Bottom Input Area - Glassmorphism */}
      <div className="absolute bottom-0 left-0 right-0 z-20 bg-background/80 backdrop-blur-xl border-t border-white/5">

        {/* Status Bar */}
        <AgentStatusBar
          pendingChanges={pendingChanges}
          isStreaming={isStreaming}
          isAwaitingApproval={isAwaitingApproval}
          streamingStatus={getStreamingStatus()}
          onStop={abort}
          onReviewFile={async (filePath) => {
            const change = pendingChanges.find(c => c.filePath === filePath)
            if (!change) return

            const currentContent = await window.electronAPI.readFile(filePath)
            if (currentContent !== null) {
              openFile(filePath, currentContent)
              setActiveFile(filePath)
              setActiveDiff({
                original: change.snapshot.content || '',
                modified: currentContent,
                filePath,
              })
            }
          }}
          onAcceptFile={(filePath) => {
            acceptChange(filePath)
            toast.success(`Accepted: ${filePath.split(/[\\/]/).pop()}`)
          }}
          onRejectFile={async (filePath) => {
            const success = await undoChange(filePath)
            if (success) {
              toast.success(`Reverted: ${filePath.split(/[\\/]/).pop()}`)
            } else {
              toast.error('Failed to revert')
            }
          }}
          onUndoAll={async () => {
            if (pendingChanges.length === 0) {
              toast.info('No changes to undo')
              return
            }
            const result = await undoAllChanges()
            if (result.success && result.restoredFiles.length > 0) {
              toast.success(`Restored ${result.restoredFiles.length} file(s)`)
              setActiveDiff(null)
            } else if (result.errors.length > 0) {
              toast.error(`Undo failed: ${result.errors[0]}`)
            }
          }}
          onKeepAll={() => {
            if (pendingChanges.length === 0) {
              toast.info('No changes to accept')
              return
            }
            acceptAllChanges()
            setActiveDiff(null)
            toast.success('Changes accepted')
          }}
        />


        {/* Context Items */}
        <div className="px-6 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            {activeFilePath && !contextItems.some((s: ContextItem) => s.type === 'File' && (s as FileContext).uri === activeFilePath) && (
              <button
                onClick={handleAddCurrentFile}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-accent/10 hover:bg-accent/20 rounded-full border border-accent/20 text-xs text-accent transition-all"
              >
                <Plus className="w-3 h-3" />
                <span className="truncate max-w-[120px] font-medium">{activeFilePath.split(/[\\/]/).pop()}</span>
              </button>
            )}

            {contextItems.map((item: ContextItem, index: number) => {
              const getIconAndLabel = () => {
                switch (item.type) {
                  case 'File': return { icon: <File className="w-3 h-3 text-accent" />, label: (item as FileContext).uri.split(/[\\/]/).pop() || 'File' }
                  case 'CodeSelection': return { icon: <Code className="w-3 h-3 text-blue-400" />, label: 'Selection' }
                  case 'Folder': return { icon: <Folder className="w-3 h-3 text-yellow-400" />, label: 'Folder' }
                  case 'Codebase': return { icon: <Database className="w-3 h-3 text-purple-400" />, label: '@codebase' }
                  case 'Git': return { icon: <GitBranch className="w-3 h-3 text-orange-400" />, label: '@git' }
                  case 'Terminal': return { icon: <Terminal className="w-3 h-3 text-green-400" />, label: '@terminal' }
                  case 'Symbols': return { icon: <Code className="w-3 h-3 text-blue-400" />, label: '@symbols' }
                  default: return { icon: <File className="w-3 h-3" />, label: 'Unknown' }
                }
              }
              const { icon, label } = getIconAndLabel()

              return (
                <div
                  key={`${item.type}-${index}`}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface/50 rounded-full border border-white/10 text-xs group hover:border-white/20 transition-colors"
                >
                  {icon}
                  <span className="text-text-secondary truncate max-w-[150px] font-medium">{label}</span>
                  <button
                    onClick={() => removeContextItem(index)}
                    className="p-0.5 rounded-full hover:bg-red-500/20 text-text-muted hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )
            })}

            {contextItems.length > 1 && (
              <button
                onClick={clearContextItems}
                className="px-2 text-xs text-text-muted hover:text-text-primary transition-colors underline decoration-dotted"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* Input */}
        <ChatInput
          input={input}
          setInput={setInput}
          images={images}
          setImages={setImages}
          isStreaming={isStreaming}
          hasApiKey={hasApiKey}
          hasPendingToolCall={isAwaitingApproval}
          chatMode={chatMode}
          onSubmit={handleSubmit}
          onAbort={abort}
          onInputChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          textareaRef={textareaRef}
          inputContainerRef={inputContainerRef}
        />
      </div>
    </div>
  )
}
