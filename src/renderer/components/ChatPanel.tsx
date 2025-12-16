/**
 * Chat Panel
 * 聊天面板 - 支持多线程、工具调用、文件拖放
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, AlertTriangle, History, Plus, Trash2, Upload, Database, GitBranch, Terminal, File, Code, Folder, X, Search } from 'lucide-react'
import { Logo } from './Logo'
import { useStore } from '../store'
import { useAgent } from '../hooks/useAgent'
import { useChatThreads } from '../hooks/useChatThread'
import { t } from '../i18n'
import { toFullPath } from '../utils/pathUtils'

import { ChatInput, PendingImage } from './chat'
import FileMentionPopup from './FileMentionPopup'
import ChatMessageComponent from './chat/ChatMessage'
import {
  ChatMessage,
  isUserMessage,
  isAssistantMessage,
  isToolMessage,
  isCheckpoint,
  getMessageText,
  FileSelection,
  ContextItem,
  CodebaseContext,
  GitContext,
  TerminalContext,
  SymbolsContext,
} from '../agent/types/chatTypes'

export default function ChatPanel() {
  const { chatMode, setChatMode, llmConfig, workspacePath, openFile, setActiveFile, language, activeFilePath } =
    useStore()

  const {
    messages,
    streamState,
    isStreaming,
    isAwaitingApproval,
    sendMessage,
    abort,
    approveCurrentTool,
    rejectCurrentTool,
    clearMessages,
  } = useAgent()

  const {
    allThreads,
    currentThread,
    openNewThread,
    switchToThread,
    deleteThread,
    deleteMessagesAfter,
    stagingSelections,
    addStagingSelection,
    removeStagingSelection,
    clearStagingSelections,
  } = useChatThreads()

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

  // 处理文件点击
  const handleFileClick = useCallback(
    async (filePath: string) => {
      const fullPath = toFullPath(filePath, workspacePath)
      const content = await window.electronAPI.readFile(fullPath)
      if (content === null) return

      openFile(fullPath, content)
      setActiveFile(fullPath)
    },
    [workspacePath, openFile, setActiveFile]
  )

  // 图片处理
  const addImage = useCallback(async (file: File) => {
    const id = crypto.randomUUID()
    const previewUrl = URL.createObjectURL(file)

    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      setImages((prev) => prev.map((img) => (img.id === id ? { ...img, base64 } : img)))
    }
    reader.readAsDataURL(file)

    setImages((prev) => [...prev, { id, file, previewUrl }])
  }, [])

  // 粘贴处理
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (file) addImage(file)
        }
      }
    },
    [addImage]
  )

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
    const x = e.clientX
    const y = e.clientY
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      const files = Array.from(e.dataTransfer.files)
      const imageFiles = files.filter((f) => f.type.startsWith('image/'))
      if (imageFiles.length > 0) {
        imageFiles.forEach(addImage)
        return
      }

      const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala', '.vue', '.svelte', '.html', '.css', '.scss', '.less', '.json', '.yaml', '.yml', '.xml', '.md', '.txt', '.sql', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd']
      
      for (const file of files) {
        const ext = '.' + file.name.split('.').pop()?.toLowerCase()
        if (codeExtensions.includes(ext) || file.type.startsWith('text/')) {
          const filePath = (file as any).path || file.name
          const exists = stagingSelections.some(s => s.type === 'File' && (s as FileSelection).uri === filePath)
          if (!exists) {
            const selection: FileSelection = {
              type: 'File',
              uri: filePath,
              state: { wasAddedAsCurrentFile: false }
            }
            addStagingSelection(selection)
          }
        }
      }

      const textData = e.dataTransfer.getData('text/plain')
      if (textData && !files.length) {
        const lines = textData.split('\n').filter(l => l.trim())
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.includes('/') || trimmed.includes('\\')) {
            const exists = stagingSelections.some(s => s.type === 'File' && (s as FileSelection).uri === trimmed)
            if (!exists) {
              const selection: FileSelection = {
                type: 'File',
                uri: trimmed,
                state: { wasAddedAsCurrentFile: false }
              }
              addStagingSelection(selection)
            }
          }
        }
      }
    },
    [addImage, stagingSelections, addStagingSelection]
  )

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
  const handleSelectFile = useCallback(
    (selection: string) => {
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
        const typeMap: Record<string, ContextItem['type']> = {
          codebase: 'Codebase',
          git: 'Git',
          terminal: 'Terminal',
          symbols: 'Symbols',
        }
        const contextType = typeMap[selection]
        const exists = stagingSelections.some(s => s.type === contextType)
        
        if (!exists) {
          let contextItem: ContextItem
          switch (selection) {
            case 'codebase': contextItem = { type: 'Codebase' } as CodebaseContext; break
            case 'git': contextItem = { type: 'Git' } as GitContext; break
            case 'terminal': contextItem = { type: 'Terminal' } as TerminalContext; break
            case 'symbols': contextItem = { type: 'Symbols' } as SymbolsContext; break
            default: return
          }
          addStagingSelection(contextItem)
        }
      } else {
        const fullPath = workspacePath ? `${workspacePath}/${selection}` : selection
        const exists = stagingSelections.some(s => 
          s.type === 'File' && ((s as FileSelection).uri === fullPath || (s as FileSelection).uri.endsWith(selection))
        )
        if (!exists) {
          const fileSelection: FileSelection = {
            type: 'File',
            uri: fullPath,
            state: { wasAddedAsCurrentFile: false }
          }
          addStagingSelection(fileSelection)
        }
      }

      setShowFileMention(false)
      setMentionQuery('')
      textareaRef.current?.focus()
    },
    [input, workspacePath, stagingSelections, addStagingSelection]
  )

  // 提交
  const handleSubmit = useCallback(async () => {
    if ((!input.trim() && images.length === 0) || isStreaming) return

    let userMessage: string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> = input.trim()

    if (images.length > 0) {
      const readyImages = images.filter((img) => img.base64)
      if (readyImages.length !== images.length) return

      userMessage = [
        { type: 'text' as const, text: input.trim() },
        ...readyImages.map((img) => ({
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

  // 添加当前文件
  const handleAddCurrentFile = useCallback(() => {
    if (!activeFilePath) return
    const exists = stagingSelections.some(s => s.type === 'File' && s.uri === activeFilePath)
    if (exists) return
    
    const selection: FileSelection = {
      type: 'File',
      uri: activeFilePath,
      state: { wasAddedAsCurrentFile: true }
    }
    addStagingSelection(selection)
  }, [activeFilePath, stagingSelections, addStagingSelection])

  // 重新生成
  const handleRegenerate = useCallback(async (messageId: string) => {
    const msgIndex = messages.findIndex(m => m.id === messageId)
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

  // 键盘处理
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
    },
    [showFileMention, handleSubmit]
  )

  const hasApiKey = !!llmConfig.apiKey

  // 渲染消息 (使用新组件)
  const renderMessage = useCallback(
    (msg: ChatMessage) => {
      if (isCheckpoint(msg)) return null
      if (isToolMessage(msg)) return null // 工具消息不直接显示，除非作为 debug
      if (!isUserMessage(msg) && !isAssistantMessage(msg)) return null

      return (
        <ChatMessageComponent
          key={msg.id}
          message={msg}
          onEdit={handleEditMessage}
          onRegenerate={handleRegenerate}
          onApproveTool={approveCurrentTool}
          onRejectTool={rejectCurrentTool}
          onFileClick={handleFileClick}
          isAwaitingApproval={isAwaitingApproval}
        />
      )
    },
    [handleEditMessage, handleRegenerate, approveCurrentTool, rejectCurrentTool, handleFileClick, isAwaitingApproval]
  )

  return (
    <div
      className={`absolute inset-0 overflow-hidden bg-background transition-colors ${isDragging ? 'bg-accent/5 ring-2 ring-inset ring-accent' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header - Redesigned */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-3 bg-background/80 backdrop-blur-md border-b border-white/5 transition-all">
        <div className="flex items-center gap-1 bg-surface/50 rounded-lg p-0.5 border border-white/5">
          <button
            onClick={() => setChatMode('chat')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
              chatMode === 'chat' 
                ? 'bg-white/10 text-white shadow-sm' 
                : 'text-text-muted hover:text-text-secondary hover:bg-white/5'
            }`}
          >
            Chat
          </button>
          <button
            onClick={() => setChatMode('agent')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all ${
              chatMode === 'agent' 
                ? 'bg-accent/20 text-accent shadow-sm' 
                : 'text-text-muted hover:text-text-secondary hover:bg-white/5'
            }`}
          >
            <Sparkles className="w-3 h-3" />
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
            onClick={() => openNewThread()}
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
        <div className="absolute top-[53px] right-0 left-0 bottom-0 bg-background/95 backdrop-blur-md z-30 overflow-hidden p-4 animate-fade-in">
          <div className="flex flex-col gap-2 max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-text-primary">Chat History</h3>
              <button 
                onClick={() => setShowThreads(false)}
                className="p-1 rounded hover:bg-surface-active text-text-muted"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {Object.values(allThreads).map((thread) => {
              if (!thread) return null
              return (
                <div
                  key={thread.id}
                  className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-colors border ${currentThread?.id === thread.id
                      ? 'bg-accent/10 border-accent/20 text-accent'
                      : 'bg-surface border-border-subtle hover:border-accent/30 text-text-secondary'
                  }`}
                  onClick={() => {
                    switchToThread(thread.id)
                    setShowThreads(false)
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {thread.messages.length > 0
                        ? getMessageText(
                            (thread.messages.find((m) => m.role === 'user') as any)?.content || ''
                          ).slice(0, 50) || 'New chat'
                        : 'New chat'}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5">
                      {new Date(thread.lastModified).toLocaleDateString()} {new Date(thread.lastModified).toLocaleTimeString()}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteThread(thread.id)
                    }}
                    className="p-2 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
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
            <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center">
              <Upload className="w-8 h-8 text-accent animate-bounce" />
            </div>
            <div className="text-center">
              <p className="text-xl font-semibold text-text-primary mb-2">Drop files here</p>
              <p className="text-sm text-text-muted">Attach images or add code to context</p>
            </div>
          </div>
        </div>
      )}

      {/* Messages Area */}
      <div className="absolute inset-0 overflow-y-auto custom-scrollbar bg-background pt-14 pb-48 z-0">
        {/* API Key Warning */}
        {!hasApiKey && (
          <div className="m-4 p-4 border border-warning/20 bg-warning/5 rounded-lg flex gap-3 animate-slide-in">
            <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />
            <div>
              <span className="font-medium text-sm text-warning block mb-1">
                {t('setupRequired', language)}
              </span>
              <p className="text-xs text-text-muted">{t('setupRequiredDesc', language)}</p>
            </div>
          </div>
        )}

        {/* Empty State */}
        {messages.length === 0 && hasApiKey && (
          <div className="h-full flex flex-col items-center justify-center opacity-100 select-none pointer-events-none gap-8 pb-20 animate-fade-in">
             <div className="relative">
                <div className="absolute inset-0 bg-accent/20 blur-3xl rounded-full opacity-50"></div>
                <div className="w-24 h-24 rounded-[2rem] bg-gradient-to-br from-surface to-surface-active border border-border-subtle flex items-center justify-center shadow-2xl relative z-10">
                  <Logo className="w-14 h-14 text-text-primary" glow />
                </div>
             </div>
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-text-primary">Adnify Agent</h2>
              <p className="text-sm text-text-muted max-w-xs mx-auto leading-relaxed">
                {t('howCanIHelp', language)}
              </p>
            </div>
            
            <div className="grid grid-cols-2 gap-3 max-w-md w-full px-8 pointer-events-auto">
                <button 
                  onClick={() => { setInput("Analyze the current codebase structure"); textareaRef.current?.focus(); }}
                  className="flex flex-col gap-2 p-4 rounded-xl bg-surface/50 border border-border-subtle hover:border-accent/50 hover:bg-surface-active transition-all text-left group"
                >
                   <Search className="w-5 h-5 text-accent group-hover:scale-110 transition-transform" />
                   <span className="text-xs font-medium text-text-secondary">Analyze codebase</span>
                </button>
                <button 
                  onClick={() => { setInput("Refactor the selected file for better performance"); textareaRef.current?.focus(); }}
                  className="flex flex-col gap-2 p-4 rounded-xl bg-surface/50 border border-border-subtle hover:border-accent/50 hover:bg-surface-active transition-all text-left group"
                >
                   <Sparkles className="w-5 h-5 text-purple-400 group-hover:scale-110 transition-transform" />
                   <span className="text-xs font-medium text-text-secondary">Refactor code</span>
                </button>
            </div>
          </div>
        )}

        {/* Messages List */}
        <div className="flex flex-col pb-32">
          {messages.map((msg) => renderMessage(msg))}
          
          {/* Stream Tool Indicator (Global/Legacy) */}
          {streamState?.isRunning === 'LLM' && streamState.llmInfo?.toolCallSoFar && (
             null
          )}
        </div>

        <div ref={messagesEndRef} />
      </div>

      {/* File Mention Popup */}
      {showFileMention && (
        <FileMentionPopup
          position={mentionPosition}
          searchQuery={mentionQuery}
          onSelect={handleSelectFile}
          onClose={() => {
            setShowFileMention(false)
            setMentionQuery('')
          }}
        />
      )}

      {/* Bottom Input Area - Fixed at bottom */}
      <div className="absolute bottom-0 left-0 right-0 z-20 bg-background">
        {/* Gradient Mask for Scrolling */}
        <div className="h-8 bg-gradient-to-t from-background to-transparent pointer-events-none -mt-8" />

        {/* Staging Selections (Context Bar) */}
        <div className="px-6 py-2">
        <div className="flex items-center gap-2 flex-wrap">
          {activeFilePath && !stagingSelections.some(s => s.type === 'File' && s.uri === activeFilePath) && (
            <button
              onClick={handleAddCurrentFile}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-accent/10 hover:bg-accent/20 rounded-full border border-accent/20 hover:border-accent/40 text-xs text-accent transition-all group"
              title="Add current file to context"
            >
              <Plus className="w-3 h-3 group-hover:rotate-90 transition-transform" />
              <span className="truncate max-w-[120px] font-medium">{activeFilePath.split(/[\\/]/).pop()}</span>
            </button>
          )}
          
          {stagingSelections.map((selection, index) => {
            const getIconAndLabel = () => {
              switch (selection.type) {
                case 'File':
                  return { 
                    icon: <File className="w-3 h-3 text-accent" />, 
                    label: (selection as FileSelection).uri.split(/[\\/]/).pop() || 'File'
                  }
                case 'CodeSelection':
                  const codeSelection = selection as import('../agent/types/chatTypes').CodeSelection
                  return { 
                    icon: <Code className="w-3 h-3 text-blue-400" />, 
                    label: `${codeSelection.uri.split(/[\\/]/).pop()}:${codeSelection.range[0]}-${codeSelection.range[1]}`
                  }
                case 'Folder':
                  return { 
                    icon: <Folder className="w-3 h-3 text-yellow-400" />, 
                    label: (selection as import('../agent/types/chatTypes').FolderSelection).uri.split(/[\\/]/).pop() || 'Folder'
                  }
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
                key={`${selection.type}-${index}`}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface rounded-full border border-border-subtle text-xs animate-fade-in group hover:border-border-highlight transition-colors"
              >
                {icon}
                <span className="text-text-secondary truncate max-w-[150px] font-medium">
                  {label}
                </span>
                <button
                  onClick={() => removeStagingSelection(index)}
                  className="p-0.5 rounded-full hover:bg-red-500/20 text-text-muted hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )
          })}
          {stagingSelections.length > 1 && (
            <button
              onClick={clearStagingSelections}
              className="px-2 text-xs text-text-muted hover:text-text-primary transition-colors underline decoration-dotted underline-offset-4"
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