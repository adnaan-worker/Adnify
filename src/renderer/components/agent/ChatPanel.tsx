import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import {
  AlertTriangle,
  History,
  Plus,
  Trash2,
  Upload
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Logo } from '@/renderer/components/common/Logo'
import { useStore, useModeStore } from '@/renderer/store'
import { useAgent } from '@/renderer/hooks/useAgent'
import { useAgentStore, selectHandoffRequired } from '@/renderer/agent'
import { t } from '@/renderer/i18n'
import { toFullPath, getFileName } from '@shared/utils/pathUtils'
import {
  ChatMessage as ChatMessageType,
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
import { Button } from '../ui'
import { useToast } from '@/renderer/components/common/ToastProvider'
import ConversationSidebar from './ConversationSidebar'
import { BranchSelector } from './BranchControls'

export default function ChatPanel() {
  const {
    llmConfig,
    workspacePath,
    openFile,
    setActiveFile,
    language,
    activeFilePath,
    setActiveDiff,
    selectedCode,
  } = useStore()

  // 从 AgentStore 获取 inputPrompt
  const inputPrompt = useAgentStore(state => state.inputPrompt)
  const setInputPrompt = useAgentStore(state => state.setInputPrompt)

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
    createThread,
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
    regenerateFromMessage,
  } = useAgent()

  const [input, setInput] = useState('')
  const [images, setImages] = useState<PendingImage[]>([])

  // Unified Sidebar State
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<'history' | 'branches'>('history')

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

  // Handoff 状态
  const handoffRequired = useAgentStore(selectHandoffRequired)

  // 监听 Handoff 自动继续事件
  useEffect(() => {
    const handleAutoResume = (event: CustomEvent<{
      objective: string
      pendingSteps: string[]
      fileChanges: Array<{ action: string; path: string; summary: string }>
    }>) => {
      const { objective, pendingSteps, fileChanges } = event.detail

      // 构建自动继续的消息，包含文件变更信息
      let resumeMessage = ''

      // 添加文件变更信息（重要：让 AI 知道之前修改了哪些文件）
      if (fileChanges && fileChanges.length > 0) {
        const fileList = fileChanges.slice(-10).map(f => `- [${f.action}] ${f.path}`).join('\n')
        resumeMessage += language === 'zh'
          ? `**之前修改的文件**:\n${fileList}\n\n`
          : `**Previously modified files**:\n${fileList}\n\n`
      }

      // 添加待完成步骤
      if (pendingSteps && pendingSteps.length > 0) {
        resumeMessage += language === 'zh'
          ? `请继续完成以下待完成的步骤：\n${pendingSteps.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}`
          : `Please continue with the following pending steps:\n${pendingSteps.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}`
      } else if (objective) {
        resumeMessage += language === 'zh'
          ? `请继续完成目标：${objective}`
          : `Please continue with the objective: ${objective}`
      } else {
        resumeMessage += language === 'zh'
          ? '请继续完成之前的任务。'
          : 'Please continue with the previous task.'
      }

      // 发送消息继续任务
      sendMessage(resumeMessage)
    }

    window.addEventListener('handoff-auto-resume', handleAutoResume as EventListener)
    return () => window.removeEventListener('handoff-auto-resume', handleAutoResume as EventListener)
  }, [language, sendMessage])

  // 监听选项卡片选择事件
  useEffect(() => {
    const handleOptionSelect = (event: CustomEvent<{ content: string; messageId: string }>) => {
      const { content } = event.detail
      if (content) {
        sendMessage(content)
      }
    }

    const handleUpdateInteractive = (event: CustomEvent<{ messageId: string; selectedIds: string[] }>) => {
      const { messageId, selectedIds } = event.detail
      // 更新消息的 interactive.selectedIds
      const store = useAgentStore.getState()
      const thread = store.getCurrentThread()
      if (thread) {
        const msg = thread.messages.find(m => m.id === messageId)
        if (msg && msg.role === 'assistant' && (msg as any).interactive) {
          store.updateMessage(messageId, {
            interactive: {
              ...(msg as any).interactive,
              selectedIds,
            },
          } as any)
        }
      }
    }

    window.addEventListener('chat-send-message', handleOptionSelect as EventListener)
    window.addEventListener('chat-update-interactive', handleUpdateInteractive as EventListener)
    return () => {
      window.removeEventListener('chat-send-message', handleOptionSelect as EventListener)
      window.removeEventListener('chat-update-interactive', handleUpdateInteractive as EventListener)
    }
  }, [sendMessage])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputContainerRef = useRef<HTMLDivElement>(null)

  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [showScrollButton, setShowScrollButton] = useState(false)
  // 用于防止工具卡片展开/收缩时误判滚动状态
  const isAutoScrollingRef = useRef(false)

  // 缓存过滤后的消息列表，避免每次渲染都创建新数组
  const filteredMessages = useMemo(
    () => messages.filter(m => m.role === 'user' || m.role === 'assistant'),
    [messages]
  )

  // 滚动到底部的函数
  const scrollToBottom = useCallback((behavior: 'auto' | 'smooth' = 'smooth') => {
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({
        index: filteredMessages.length - 1,
        align: 'end',
        behavior
      })
    })
    setAtBottom(true)
    setShowScrollButton(false)
  }, [filteredMessages.length])

  // 流式输出时的自动滚动 - 只在用户处于底部时才滚动
  useEffect(() => {
    if (!isStreaming || !atBottom) return

    let rafId: number
    let intervalId: NodeJS.Timeout
    let lastScrollTime = 0

    const doScroll = () => {
      const now = Date.now()
      // 节流：至少间隔 200ms 才执行一次
      if (now - lastScrollTime < 200) return
      lastScrollTime = now

      isAutoScrollingRef.current = true
      rafId = requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({
          index: filteredMessages.length - 1,
          align: 'end',
          behavior: 'smooth'
        })
        // 延迟重置标志，给 Virtuoso 时间处理滚动
        setTimeout(() => {
          isAutoScrollingRef.current = false
        }, 100)
      })
    }

    // 立即滚动一次
    doScroll()

    // 每 300ms 检查并滚动（降低频率避免抖动）
    intervalId = setInterval(doScroll, 300)

    return () => {
      cancelAnimationFrame(rafId)
      clearInterval(intervalId)
      isAutoScrollingRef.current = false
    }
  }, [isStreaming, atBottom, filteredMessages.length])

  // 处理用户滚动状态变化
  const handleAtBottomStateChange = useCallback((bottom: boolean) => {
    // 如果是自动滚动触发的，忽略状态变化
    if (isAutoScrollingRef.current) return

    setAtBottom(bottom)
    // 不在底部时显示滚动按钮（流式输出时也显示，方便用户回到底部）
    setShowScrollButton(!bottom)
  }, [])

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
      // 上下文统计现在由 store 管理
    }, 500) // 500ms 防抖

    return () => clearTimeout(timer)
  }, [contextItems, messages, input])

  // 处理文件点击
  const handleFileClick = useCallback(async (filePath: string) => {
    const fullPath = toFullPath(filePath, workspacePath)
    const content = await api.file.read(fullPath)
    if (content === null) return
    openFile(fullPath, content)
    setActiveFile(fullPath)
  }, [workspacePath, openFile, setActiveFile])

  // 暴露给子组件使用
  void handleFileClick

  // 处理显示 diff
  const handleShowDiff = useCallback(async (filePath: string, oldContent: string, newContent: string) => {
    const fullPath = toFullPath(filePath, workspacePath)
    const currentContent = await api.file.read(fullPath)
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

    // 图片扩展名
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg']

    // 辅助函数：检测路径是否是文件夹
    const checkIsDirectory = async (path: string): Promise<boolean> => {
      try {
        // 先尝试读取文件，如果成功则是文件
        const content = await api.file.read(path)
        if (content !== null) {
          return false // 是文件
        }
        // 读取失败，尝试读取目录
        const result = await api.file.readDir(path)
        return Array.isArray(result) && result.length >= 0
      } catch {
        return false
      }
    }

    // 辅助函数：检测是否是图片文件
    const isImageFile = (path: string): boolean => {
      const ext = path.split('.').pop()?.toLowerCase() || ''
      return imageExtensions.includes(ext)
    }

    // 辅助函数：将文件路径转换为图片并添加
    const addImageFromPath = async (path: string) => {
      try {
        const base64 = await api.file.readBinary(path)
        if (base64) {
          const ext = path.split('.').pop()?.toLowerCase() || 'png'
          const mimeTypes: Record<string, string> = {
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/gif',
            webp: 'image/webp',
            svg: 'image/svg+xml',
            bmp: 'image/bmp',
            ico: 'image/x-icon',
          }
          const mimeType = mimeTypes[ext] || 'image/png'
          const dataUrl = `data:${mimeType};base64,${base64}`
          const fileName = path.split(/[/\\]/).pop() || 'image'
          const id = crypto.randomUUID()
          // 直接添加到 images 状态
          setImages(prev => [...prev, {
            id,
            file: new File([], fileName, { type: mimeType }),
            previewUrl: dataUrl,
            base64
          }])
          return true
        }
      } catch (err) {
        console.error('Failed to load image:', err)
      }
      return false
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
          // 检查是否是图片文件
          if (isImageFile(filePath)) {
            await addImageFromPath(filePath)
            continue
          }

          const exists = contextItems.some((s: ContextItem) =>
            (s.type === 'File' && (s as FileContext).uri === filePath) ||
            (s.type === 'Folder' && (s as any).uri === filePath)
          )
          if (!exists) {
            const isDir = await checkIsDirectory(filePath)
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
      // 检查是否是图片文件
      if (isImageFile(filePath)) {
        await addImageFromPath(filePath)
        return
      }

      const exists = contextItems.some((s: ContextItem) =>
        (s.type === 'File' && (s as FileContext).uri === filePath) ||
        (s.type === 'Folder' && (s as any).uri === filePath)
      )
      if (!exists) {
        const isDir = await checkIsDirectory(filePath)
        if (isDir) {
          addContextItem({ type: 'Folder', uri: filePath })
        } else {
          addContextItem({ type: 'File', uri: filePath })
        }
      }
    }
  }, [addImage, contextItems, addContextItem, setImages])

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

    // Handoff 现在由 StatusBar 自动处理，不再阻止发送
    // 如果正在过渡中，等待完成后会自动继续

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
  }, [input, images, isStreaming, sendMessage, activeFilePath, selectedCode, workspacePath, setChatMode, handoffRequired])

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
    // 忽略 IME 组合状态中的按键（如中文输入法确认拼音）
    if (e.nativeEvent.isComposing) return

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

    // 找到对应的用户消息内容
    const userMessage = messages.find(m => m.id === messageId)
    const userContent = userMessage && isUserMessage(userMessage)
      ? (typeof userMessage.content === 'string' ? userMessage.content : getMessageText(userMessage.content))
      : ''

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

      // 恢复用户消息文本到输入框
      if (userContent) {
        setInput(userContent)
      }

      // 恢复图片到输入框
      if (result.images && result.images.length > 0) {
        const restoredImages: PendingImage[] = result.images.map(img => {
          // 从 base64 创建 Blob 和预览 URL
          const byteCharacters = atob(img.base64)
          const byteNumbers = new Array(byteCharacters.length)
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i)
          }
          const byteArray = new Uint8Array(byteNumbers)
          const blob = new Blob([byteArray], { type: img.mimeType })
          const file = new File([blob], `restored-${img.id}.${img.mimeType.split('/')[1] || 'png'}`, { type: img.mimeType })
          const previewUrl = URL.createObjectURL(blob)

          return {
            id: img.id,
            file,
            previewUrl,
            base64: img.base64,
          }
        })
        setImages(restoredImages)
      }

      // 恢复上下文引用
      if (result.contextItems && result.contextItems.length > 0) {
        for (const item of result.contextItems) {
          addContextItem(item)
        }
      }
    } else if (result.errors.length > 0) {
      toast.error(`Restore failed: ${result.errors[0]}`)
    }
  }, [getCheckpointForMessage, restoreToCheckpoint, setActiveDiff, toast, language, messages, addContextItem])

  // 渲染消息
  const renderMessage = useCallback((msg: ChatMessageType) => {
    if (!isUserMessage(msg) && !isAssistantMessage(msg)) return null

    const hasCheckpoint = isUserMessage(msg) && messageCheckpoints.some(cp => cp.messageId === msg.id)

    return (
      <ChatMessageUI
        key={msg.id}
        messageId={msg.id}
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
  }, [handleEditMessage, handleRegenerate, handleRestore, approveCurrentTool, rejectCurrentTool, handleShowDiff, pendingToolCall?.id, messageCheckpoints])



  return (
    <div
      className={`absolute inset-0 overflow-hidden bg-background-secondary transition-colors ${isDragging ? 'bg-accent/5 ring-2 ring-inset ring-accent' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex flex-col h-full">

        {/* Header - 简洁版 */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between h-10 px-3 bg-background/80 backdrop-blur-xl select-none transition-all duration-300">
          <div className="flex items-center gap-2">
            {/* 分支选择器 - 始终显示，点击展开分支管理 */}
            <BranchSelector
              language={language}
              onClick={() => {
                setSidebarTab('branches')
                setSidebarOpen(true)
              }}
            />
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSidebarTab('history')
                setSidebarOpen(true)
              }}
              title={language === 'zh' ? '历史记录' : 'Chat history'}
              className="hover:bg-white/5 text-text-muted hover:text-text-primary transition-colors"
            >
              <History className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => createThread()}
              title={language === 'zh' ? '新对话' : 'New chat'}
              className="hover:bg-white/5 text-text-muted hover:text-text-primary transition-colors"
            >
              <Plus className="w-4 h-4" />
            </Button>
            <div className="w-px h-4 bg-white/10 mx-1" />
            <Button
              variant="ghost"
              size="icon"
              onClick={clearMessages}
              className="hover:bg-red-500/10 hover:text-red-500 text-text-muted transition-colors"
              title={language === 'zh' ? '清空对话' : 'Clear chat'}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <ConversationSidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          initialTab={sidebarTab}
        />

        {/* Drag Overlay */}
        <AnimatePresence>
          {isDragging && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center pointer-events-none"
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="flex flex-col items-center gap-4 p-8 rounded-3xl border border-accent/30 bg-surface/90 shadow-2xl shadow-accent/20"
              >
                <div className="p-5 rounded-full bg-accent/10 border border-accent/20 relative">
                  <div className="absolute inset-0 bg-accent/20 blur-xl rounded-full animate-pulse" />
                  <Upload className="w-10 h-10 text-accent relative z-10" />
                </div>
                <div className="text-center">
                  <p className="text-lg font-medium text-text-primary mb-1">{language === 'zh' ? '释放以添加文件' : 'Drop files to add context'}</p>
                  <p className="text-sm text-text-muted">{language === 'zh' ? '支持代码和图片' : 'Supports code and images'}</p>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Messages Area */}
        <div className="flex-1 min-h-0 relative z-0 flex flex-col pt-12">
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
              {/* Background Ambience - More subtle & Animated */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <motion.div
                  animate={{
                    scale: [1, 1.2, 1],
                    opacity: [0.3, 0.5, 0.3],
                    x: [0, 20, 0]
                  }}
                  transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] bg-accent/5 rounded-full blur-[120px] mix-blend-screen"
                />
                <motion.div
                  animate={{
                    scale: [1, 1.1, 1],
                    opacity: [0.2, 0.4, 0.2],
                    x: [0, -30, 0]
                  }}
                  transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                  className="absolute bottom-[-10%] left-[-20%] w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-[120px] mix-blend-screen"
                />
              </div>

              <div className="flex-1 flex flex-col items-center justify-center p-8 select-none z-10">
                <motion.div
                  initial={{ opacity: 0, scale: 0.8, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
                  className="relative mb-8"
                >
                  <motion.div
                    animate={{ opacity: [0.5, 0.8, 0.5], scale: [1, 1.05, 1] }}
                    transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute inset-0 bg-accent/20 blur-3xl rounded-full"
                  />
                  <div className="relative w-20 h-20 bg-surface/40 backdrop-blur-2xl rounded-2xl border border-border flex items-center justify-center shadow-2xl shadow-accent/10">
                    <Logo className="w-10 h-10 text-accent opacity-90" glow />
                  </div>
                </motion.div>
                <div className="text-center space-y-3">
                  <motion.h1
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, duration: 0.5 }}
                    className="text-2xl font-bold text-text-primary tracking-tight"
                  >
                    Adnify Agent
                  </motion.h1>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.5 }}
                    className="text-sm text-text-muted max-w-[280px] leading-relaxed opacity-60"
                  >
                    {language === 'zh' ? '今天我能帮你构建什么？' : 'What can I help you build today?'}
                  </motion.p>
                </div>
              </div>
            </div>
          ) : (
            <Virtuoso
              ref={virtuosoRef}
              data={filteredMessages}
              atBottomStateChange={handleAtBottomStateChange}
              initialTopMostItemIndex={Math.max(0, filteredMessages.length - 1)}
              followOutput={isStreaming ? 'smooth' : false}
              itemContent={(_, message) => renderMessage(message)}
              className="flex-1 custom-scrollbar"
              style={{ minHeight: '100px' }}
              overscan={200}
              atBottomThreshold={200}
            />
          )}

          {/* Scroll to Bottom Button */}
          <AnimatePresence>
            {showScrollButton && (
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.2 }}
                onClick={() => scrollToBottom('smooth')}
                className="absolute bottom-44 right-4 z-30 p-2.5 rounded-full bg-surface/95 border border-border shadow-xl hover:bg-surface hover:border-accent/30 hover:shadow-accent/10 transition-all"
                title={language === 'zh' ? '滚动到底部' : 'Scroll to bottom'}
              >
                <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </motion.button>
            )}
          </AnimatePresence>

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
                streamingStatus={streamState.statusText}
                onStop={abort}
                onReviewFile={async (filePath) => {
                  const change = pendingChanges.find(c => c.filePath === filePath)
                  if (!change) return

                  const currentContent = await api.file.read(filePath)
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
                  toast.success(`Accepted: ${getFileName(filePath)}`)
                }}
                onRejectFile={async (filePath) => {
                  const success = await undoChange(filePath)
                  if (success) {
                    toast.success(`Reverted: ${getFileName(filePath)}`)
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
