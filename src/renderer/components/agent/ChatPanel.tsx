import { logger } from '@utils/Logger'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import {
  AlertTriangle,
  History,
  Plus,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { Logo } from '@/renderer/components/common/Logo'
import { useStore, useModeStore } from '@/renderer/store'
import { useAgent } from '@/renderer/hooks/useAgent'
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
} from '@/renderer/agent/types'

import { ChatInput, PendingImage } from '@/renderer/components/chat'
import MentionPopup from '@/renderer/components/agent/MentionPopup'
import { MentionParser, MentionCandidate } from '@/renderer/agent/utils/MentionParser'
import ChatMessageUI from './ChatMessage'
import AgentStatusBar from './AgentStatusBar'
import { keybindingService } from '@/renderer/services/keybindingService'
import { slashCommandService, SlashCommand } from '@/renderer/services/slashCommandService'
import SlashCommandPopup from './SlashCommandPopup'
import { AgentService } from '@/renderer/agent/services/AgentService'
import { Button } from '../ui'
import { useToast } from '@/renderer/components/common/ToastProvider'
import { BranchSelector } from './BranchManager'
import BranchManager from './BranchManager'
import StreamRecoveryBanner from './StreamRecoveryBanner'
import { CompactionProgressBar } from './ContextCompactionIndicator'

export default function ChatPanel() {
  const {
    llmConfig,
    workspacePath,
    openFile,
    setActiveFile,
    language,
    activeFilePath,
    setActiveDiff,
    inputPrompt,
    setInputPrompt,
    selectedCode,
  } = useStore()

  const { currentMode: chatMode, setMode: setChatMode } = useModeStore()

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
    approveAllCurrentTool,
    acceptAllChanges,
    undoAllChanges,
    acceptChange,
    undoChange,
    restoreToCheckpoint,
    getCheckpointForMessage,
    addContextItem,
    removeContextItem,
    checkContextLength,
    regenerateFromMessage,
  } = useAgent()

  const [input, setInput] = useState('')
  const [images, setImages] = useState<PendingImage[]>([])
  const [showThreads, setShowThreads] = useState(false)
  const [showFileMention, setShowFileMention] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionPosition, setMentionPosition] = useState({ x: 0, y: 0 })
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([])
  const [mentionLoading, setMentionLoading] = useState(false)
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  // 斜杠命令状态
  const [showSlashCommand, setShowSlashCommand] = useState(false)
  const [slashCommandQuery, setSlashCommandQuery] = useState('')
  const [showContextWarning, setShowContextWarning] = useState(false)
  const [showBranches, setShowBranches] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputContainerRef = useRef<HTMLDivElement>(null)

  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const [atBottom, setAtBottom] = useState(true)

  // 缓存过滤后的消息列表，避免每次渲染都创建新数组
  const filteredMessages = useMemo(() => 
    messages.filter(m => m.role === 'user' || m.role === 'assistant'),
    [messages]
  )

  // 自动滚动逻辑 - 使用节流避免频繁滚动
  const lastScrollTime = useRef(0)
  useEffect(() => {
    if (isStreaming && atBottom) {
      const now = Date.now()
      // 节流：最多每 100ms 滚动一次
      if (now - lastScrollTime.current > 100) {
        lastScrollTime.current = now
        virtuosoRef.current?.scrollToIndex({
          index: filteredMessages.length - 1,
          align: 'end',
          behavior: 'auto'
        })
      }
    }
  }, [filteredMessages.length, isStreaming, atBottom])

  // 一次性同步 inputPrompt 到本地 input
  useEffect(() => {
    if (inputPrompt) {
      setInput(inputPrompt)
      setInputPrompt('')
    }
  }, [inputPrompt, setInputPrompt])

  // 实时更新上下文统计
  useEffect(() => {
    const timer = setTimeout(() => {
      AgentService.calculateContextStats(contextItems, input)
    }, 500) // 500ms 防抖

    return () => clearTimeout(timer)
  }, [contextItems, messages, input])

  // 处理文件点击
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

    // 辅助函数：检测路径是否是文件夹
    const isDirectory = async (path: string): Promise<boolean> => {
      try {
        const result = await window.electronAPI.readDir(path)
        return Array.isArray(result)
      } catch {
        return false
      }
    }

    // 获取拖放的文件
    const files = Array.from(e.dataTransfer.files)

    if (files.length > 0) {
      // 有原生文件对象（外部文件拖入）
      const imageFiles = files.filter(f => f.type.startsWith('image/'))
      if (imageFiles.length > 0) {
        imageFiles.forEach(addImage)
        return
      }

      for (const file of files) {
        const filePath = (file as any).path
        if (filePath) {
          const exists = contextItems.some((s: ContextItem) =>
            (s.type === 'File' && (s as FileContext).uri === filePath) ||
            (s.type === 'Folder' && (s as any).uri === filePath)
          )
          if (!exists) {
            const isDir = await isDirectory(filePath)
            if (isDir) {
              addContextItem({ type: 'Folder', uri: filePath })
            } else {
              addContextItem({ type: 'File', uri: filePath })
            }
          }
        }
      }
      return
    }

    // 没有原生文件，尝试从自定义数据中获取路径
    const items = e.dataTransfer.items
    if (!items || items.length === 0) {
      return
    }

    // 尝试获取 adnify 自定义路径
    let filePath: string | null = null

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind === 'string') {
        if (item.type === 'application/adnify-file-path') {
          filePath = await new Promise<string>((resolve) => {
            item.getAsString((s) => resolve(s))
          })
          break
        } else if (item.type === 'text/uri-list' && !filePath) {
          const uriList = await new Promise<string>((resolve) => {
            item.getAsString((s) => resolve(s))
          })
          const match = uriList.match(/file:\/\/\/(.+)/)
          if (match) {
            filePath = decodeURIComponent(match[1])
          }
        }
      }
    }

    if (filePath) {
      const exists = contextItems.some((s: ContextItem) =>
        (s.type === 'File' && (s as FileContext).uri === filePath) ||
        (s.type === 'Folder' && (s as any).uri === filePath)
      )
      if (!exists) {
        const isDir = await isDirectory(filePath)
        if (isDir) {
          addContextItem({ type: 'Folder', uri: filePath })
        } else {
          addContextItem({ type: 'File', uri: filePath })
        }
      }
    }
  }, [addImage, contextItems, addContextItem, language])

  // 输入变化处理
  const handleInputChange = useCallback(async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    const cursorPos = e.target.selectionStart || 0
    setInput(value)

    // 计算弹窗位置
    const updatePopupPosition = () => {
      if (inputContainerRef.current) {
        const rect = inputContainerRef.current.getBoundingClientRect()
        setMentionPosition({ x: rect.left + 16, y: rect.top })
      }
    }

    const parseResult = MentionParser.parse(value, cursorPos)

    if (parseResult) {
      setMentionQuery(parseResult.query)
      setMentionRange(parseResult.range)
      updatePopupPosition()
      setShowFileMention(true)
      setShowSlashCommand(false)

      // Fetch suggestions
      setMentionLoading(true)
      try {
        const suggestions = await MentionParser.getSuggestions(parseResult.query, workspacePath)
        setMentionCandidates(suggestions)
      } catch (err) {
        logger.agent.error('Error fetching suggestions:', err)
      } finally {
        setMentionLoading(false)
      }
    } else if (value.startsWith('/') && !value.includes(' ') && value.length < 20) {
      // 斜杠命令：只在行首输入 / 且没有空格时触发
      setSlashCommandQuery(value)
      updatePopupPosition()
      setShowSlashCommand(true)
      setShowFileMention(false)
      setMentionQuery('')
    } else {
      setShowFileMention(false)
      setShowSlashCommand(false)
      setMentionQuery('')
      setSlashCommandQuery('')
    }
  }, [workspacePath])

  // 上下文选择
  const handleSelectMention = useCallback((candidate: MentionCandidate) => {
    if (!mentionRange) return

    const textBeforeMention = input.slice(0, mentionRange.start)
    const textAfterMention = input.slice(mentionRange.end)

    let replacement = ''
    let contextItem: ContextItem | null = null

    switch (candidate.type) {
      case 'codebase':
        replacement = '@codebase '
        contextItem = { type: 'Codebase' }
        break
      case 'git':
        replacement = '@git '
        contextItem = { type: 'Git' }
        break
      case 'terminal':
        replacement = '@terminal '
        contextItem = { type: 'Terminal' }
        break
      case 'symbols':
        replacement = '@symbols '
        contextItem = { type: 'Symbols' }
        break
      case 'file':
      case 'folder':
        replacement = `@${candidate.description || candidate.label} `
        contextItem = {
          type: candidate.type === 'folder' ? 'Folder' : 'File',
          uri: candidate.data.path
        }
        break
      case 'web':
        replacement = '@web '
        contextItem = { type: 'Web' }
        break
    }

    const newInput = textBeforeMention + replacement + textAfterMention
    setInput(newInput)

    if (contextItem) {
      // Check if exists
      const exists = contextItems.some(item => {
        if (item.type !== contextItem!.type) return false
        if (item.type === 'File' && contextItem!.type === 'File') {
          return (item as FileContext).uri === (contextItem as FileContext).uri
        }
        return true
      })

      if (!exists) {
        addContextItem(contextItem)
      }
    }

    setShowFileMention(false)
    setMentionQuery('')
    textareaRef.current?.focus()
  }, [input, mentionRange, contextItems, addContextItem])

  // 提交
  const handleSubmit = useCallback(async () => {
    if ((!input.trim() && images.length === 0) || isStreaming) return

    const contextCheck = checkContextLength()
    if (contextCheck.needsCompact) {
      setShowContextWarning(true)
      return
    }

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

    // 检查是否是斜杠命令
    if (input.startsWith('/')) {
      const result = slashCommandService.parse(input, {
        activeFilePath: activeFilePath || undefined,
        selectedCode: selectedCode || undefined,
        workspacePath: workspacePath || undefined,
      })
      if (result) {
        userMessage = result.prompt
        if (result.mode) {
          setChatMode(result.mode)
        }
      }
    }

    setInput('')
    setImages([])
    await sendMessage(userMessage)
  }, [input, images, isStreaming, sendMessage, checkContextLength, activeFilePath, selectedCode, workspacePath, setChatMode])

  // 编辑消息
  const handleEditMessage = useCallback(async (messageId: string, content: string) => {
    if (!content.trim()) return
    deleteMessagesAfter(messageId)
    await sendMessage(content.trim())
  }, [deleteMessagesAfter, sendMessage])

  // 重新生成（创建分支）
  const handleRegenerate = useCallback(async (messageId: string) => {
    // 使用分支功能重新生成
    const result = regenerateFromMessage(messageId)
    
    if (result) {
      // 成功创建分支，发送消息重新生成
      toast.success(language === 'zh' ? '已创建新分支' : 'Branch created')
      await sendMessage(result.messageContent)
    } else {
      // 回退到原来的逻辑（直接删除并重新发送）
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
    }
  }, [messages, deleteMessagesAfter, sendMessage, regenerateFromMessage, toast, language])

  // 添加当前文件
  const handleAddCurrentFile = useCallback(() => {
    if (!activeFilePath) return
    const exists = contextItems.some((s: ContextItem) => s.type === 'File' && (s as FileContext).uri === activeFilePath)
    if (exists) return
    addContextItem({ type: 'File', uri: activeFilePath })
  }, [activeFilePath, contextItems, addContextItem])

  // 处理斜杠命令选择
  const handleSlashCommand = useCallback((cmd: SlashCommand) => {
    const result = slashCommandService.parse('/' + cmd.name, {
      activeFilePath: activeFilePath || undefined,
      selectedCode: selectedCode || undefined,
      workspacePath: workspacePath || undefined,
    })
    if (result) {
      setInput(result.prompt)
      if (result.mode) {
        setChatMode(result.mode as any)
      }
    }
    setShowSlashCommand(false)
    setSlashCommandQuery('')
    textareaRef.current?.focus()
  }, [activeFilePath, selectedCode, workspacePath, setChatMode])

  // 键盘处理
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (showFileMention) {
      if (keybindingService.matches(e, 'list.cancel')) {
        e.preventDefault()
        setShowFileMention(false)
        setMentionQuery('')
      }
      if (['Enter', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.key)) {
        e.preventDefault()
        return
      }
    }

    if (keybindingService.matches(e, 'chat.send')) {
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

    const { globalConfirm } = await import('../common/ConfirmDialog')
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
      setActiveDiff(null)
    } else if (result.errors.length > 0) {
      toast.error(`Restore failed: ${result.errors[0]}`)
    }
  }, [getCheckpointForMessage, restoreToCheckpoint, setActiveDiff, toast, language])

  // 渲染消息
  const renderMessage = useCallback((msg: ChatMessageType) => {
    if (!isUserMessage(msg) && !isAssistantMessage(msg)) return null

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
        onApproveAll={approveAllCurrentTool}
        onOpenDiff={handleShowDiff}
        pendingToolId={pendingToolCall?.id}
        hasCheckpoint={hasCheckpoint}
      />
    )
  }, [handleEditMessage, handleRegenerate, handleRestore, approveCurrentTool, rejectCurrentTool, approveAllCurrentTool, handleShowDiff, pendingToolCall, messageCheckpoints])

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
      <div className="flex flex-col h-full">
        {/* Context Length Warning Modal */}
        {showContextWarning && (
          <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center animate-fade-in">
            <div className="max-w-md p-6 rounded-2xl border border-warning/20 bg-surface/95 shadow-2xl shadow-warning/10 animate-scale-in">
              <div className="flex items-start gap-4 mb-4">
                <div className="p-2 rounded-full bg-warning/10 border border-warning/20">
                  <AlertTriangle className="w-5 h-5 text-warning" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-1">
                    {language === 'zh' ? '对话较长' : 'Long Conversation'}
                  </h3>
                  <p className="text-sm text-text-muted leading-relaxed">
                    {language === 'zh'
                      ? '当前对话已较长，继续可能影响响应质量。建议开始新对话以获得最佳效果。'
                      : 'This conversation is getting long. Starting a new chat may improve response quality.'}
                  </p>
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowContextWarning(false)
                    const submitWithoutCheck = async () => {
                      let userMessage: string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> = input.trim()
                      if (images.length > 0) {
                        const readyImages = images.filter(img => img.base64)
                        userMessage = [
                          { type: 'text' as const, text: input.trim() },
                          ...readyImages.map(img => ({
                            type: 'image' as const,
                            source: { type: 'base64' as const, media_type: img.file.type, data: img.base64! },
                          })),
                        ]
                      }
                      setInput('')
                      setImages([])
                      await sendMessage(userMessage)
                    }
                    submitWithoutCheck()
                  }}
                >
                  {language === 'zh' ? '继续发送' : 'Continue Anyway'}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    setShowContextWarning(false)
                    createThread()
                    toast.success(language === 'zh' ? '已创建新对话' : 'New chat created')
                  }}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  {language === 'zh' ? '开始新对话' : 'Start New Chat'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Header - 简洁版 */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between h-10 px-3 bg-background/80 backdrop-blur-md border-b border-white/5 select-none">
          <div className="flex items-center gap-2">
            {/* 分支选择器 - 始终显示，点击展开分支管理 */}
            <BranchSelector language={language} onClick={() => setShowBranches(!showBranches)} />
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowThreads(!showThreads)}
              title={language === 'zh' ? '历史记录' : 'Chat history'}
              className="hover:bg-white/5 text-text-muted hover:text-text-primary"
            >
              <History className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => createThread()}
              title={language === 'zh' ? '新对话' : 'New chat'}
              className="hover:bg-white/5 text-text-muted hover:text-text-primary"
            >
              <Plus className="w-4 h-4" />
            </Button>
            <div className="w-px h-4 bg-white/10 mx-1" />
            <Button
              variant="ghost"
              size="icon"
              onClick={clearMessages}
              className="hover:bg-red-500/10 hover:text-red-500 text-text-muted"
              title={language === 'zh' ? '清空对话' : 'Clear chat'}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Thread list overlay */}
        {showThreads && (
          <div className="absolute top-[50px] right-0 left-0 bottom-0 bg-background/95 backdrop-blur-md z-30 overflow-hidden p-4 animate-fade-in">
            <div className="flex flex-col gap-2 max-w-2xl mx-auto">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-text-primary">Chat History</h3>
                <Button variant="ghost" size="icon" onClick={() => setShowThreads(false)} className="h-6 w-6">
                  <X className="w-4 h-4" />
                </Button>
              </div>
              {threads.map((thread: ChatThread) => {
                if (!thread) return null
                const firstUserMsg = thread.messages.find((m: ChatMessageType) => m.role === 'user')
                const preview = firstUserMsg ? getMessageText(firstUserMsg.content).slice(0, 50) : 'New chat'
                return (
                  <div
                    key={thread.id}
                    className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all duration-200 border group ${currentThreadId === thread.id
                      ? 'bg-accent/10 border-accent/20 text-accent'
                      : 'bg-surface/30 border-white/5 hover:border-white/10 hover:bg-surface/50 text-text-secondary'
                      }`}
                    onClick={() => { switchThread(thread.id); setShowThreads(false) }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{preview || 'New chat'}</p>
                      <p className="text-xs text-text-muted mt-0.5">
                        {new Date(thread.lastModified).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => { e.stopPropagation(); deleteThread(thread.id) }}
                      className="h-8 w-8 hover:bg-red-500/10 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all transform scale-90 group-hover:scale-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Branch Manager overlay */}
        {showBranches && (
          <div className="absolute top-[50px] right-0 left-0 bottom-0 bg-background/95 backdrop-blur-md z-30 overflow-auto animate-fade-in">
            <div className="max-w-2xl mx-auto">
              <BranchManager language={language} onClose={() => setShowBranches(false)} />
            </div>
          </div>
        )}

        {/* Drag Overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center pointer-events-none animate-fade-in">
            <div className="flex flex-col items-center gap-4 p-8 rounded-3xl border border-accent/30 bg-surface/90 shadow-2xl shadow-accent/20 transform scale-100 animate-scale-in">
              <div className="p-5 rounded-full bg-accent/10 border border-accent/20 relative">
                <div className="absolute inset-0 bg-accent/20 blur-xl rounded-full animate-pulse" />
                <Upload className="w-10 h-10 text-accent relative z-10" />
              </div>
              <div className="text-center">
                <p className="text-lg font-medium text-text-primary mb-1">{language === 'zh' ? '释放以添加文件' : 'Drop files to add context'}</p>
                <p className="text-sm text-text-muted">{language === 'zh' ? '支持代码和图片' : 'Supports code and images'}</p>
              </div>
            </div>
          </div>
        )
        }

        {/* Messages Area */}
        <div className="flex-1 min-h-0 relative z-0 flex flex-col pt-12">
          {/* Stream Recovery Banner */}
          <StreamRecoveryBanner language={language} />
          
          {/* Compaction Progress */}
          <CompactionProgressBar language={language} />
          
          {/* API Key Warning */}
          {!hasApiKey && (
            <div className="m-4 p-4 border border-warning/20 bg-warning/5 rounded-xl flex gap-3 backdrop-blur-sm relative z-10">
              <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />
              <div>
                <span className="font-medium text-sm text-warning block mb-1">{t('setupRequired', language)}</span>
                <p className="text-xs text-text-muted">{t('setupRequiredDesc', language)}</p>
              </div>
            </div>
          )}

          {/* Empty State */}
          {messages.length === 0 ? (
            <div className="flex flex-col h-full w-full bg-background/40 backdrop-blur-3xl relative overflow-hidden">
              {/* Background Ambience - More subtle */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] bg-accent/5 rounded-full blur-[120px] opacity-50 mix-blend-screen" />
                <div className="absolute bottom-[-10%] left-[-20%] w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-[120px] opacity-30 mix-blend-screen" />
              </div>
              <div className="flex-1 flex flex-col items-center justify-center p-8 animate-fade-in select-none">
                <div className="relative mb-8">
                  <div className="absolute inset-0 bg-accent/20 blur-3xl rounded-full animate-pulse" />
                  <div className="relative w-16 h-16 bg-surface/40 backdrop-blur-2xl rounded-2xl border border-white/10 flex items-center justify-center shadow-2xl">
                    <Logo className="w-8 h-8 text-accent opacity-80" glow />
                  </div>
                </div>
                <div className="text-center space-y-2">
                  <h1 className="text-xl font-bold text-text-primary tracking-tight opacity-90">
                    Adnify Agent
                  </h1>
                  <p className="text-sm text-text-muted max-w-[280px] leading-relaxed opacity-60">
                    {language === 'zh' ? '今天我能帮你构建什么？' : 'What can I help you build today?'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <Virtuoso
              ref={virtuosoRef}
              data={filteredMessages}
              atBottomStateChange={setAtBottom}
              initialTopMostItemIndex={Math.max(0, filteredMessages.length - 1)}
              followOutput={isStreaming ? 'smooth' : false}
              itemContent={(_, message) => renderMessage(message)}
              className="flex-1 custom-scrollbar"
              style={{ minHeight: '100px' }}
              overscan={200}
            />
          )}

          {/* File Mention Popup */}
          {
            showFileMention && (
              <MentionPopup
                position={mentionPosition}
                query={mentionQuery}
                candidates={mentionCandidates}
                loading={mentionLoading}
                onSelect={handleSelectMention}
                onClose={() => { setShowFileMention(false); setMentionQuery('') }}
              />
            )
          }

          {/* Slash Command Popup */}
          {
            showSlashCommand && (
              <SlashCommandPopup
                query={slashCommandQuery}
                position={mentionPosition}
                onSelect={handleSlashCommand}
                onClose={() => { setShowSlashCommand(false); setSlashCommandQuery('') }}
              />
            )
          }

          {/* Bottom Input Area - Unified Tray */}
          <div className="shrink-0 z-20 flex flex-col">
            <div className="mx-4 mb-4 flex flex-col">
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
                  const result = await undoAllChanges()
                  if (result.success) {
                    toast.success(`Reverted ${result.restoredFiles.length} files`)
                  } else {
                    toast.error(`Failed to revert some files: ${result.errors.join(', ')}`)
                  }
                }}
                onKeepAll={() => {
                  acceptAllChanges()
                  toast.success('All changes accepted')
                }}
              />

              {/* Input Component */}
              <ChatInput
                input={input}
                setInput={setInput}
                images={images}
                setImages={setImages}
                isStreaming={isStreaming}
                hasApiKey={hasApiKey}
                hasPendingToolCall={!!pendingToolCall}
                chatMode={chatMode}
                setChatMode={setChatMode}
                onSubmit={handleSubmit}
                onAbort={abort}
                onInputChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                textareaRef={textareaRef}
                inputContainerRef={inputContainerRef}
                contextItems={contextItems}
                onRemoveContextItem={(item) => {
                  const index = contextItems.indexOf(item)
                  if (index !== -1) {
                    removeContextItem(index)
                  }
                }}
                activeFilePath={activeFilePath}
                onAddFile={handleAddCurrentFile}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
