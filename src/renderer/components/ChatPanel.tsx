import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  Send, Sparkles,
  Trash2, StopCircle,
  FileText, AlertTriangle,
  History, Image as ImageIcon, X,
  Code, GitBranch, Terminal, Database
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useStore, Message } from '../store'
import { useAgent } from '../hooks/useAgent'
import { t } from '../i18n'

import ToolCallCard from './ToolCallCard'
import SessionList from './SessionList'
import FileMentionPopup from './FileMentionPopup'
import { sessionService } from '../agent/sessionService'
import { checkpointService } from '../agent/checkpointService'


interface ChatMessageProps {
  message: Message
  onEdit?: (messageId: string, newContent: string) => void
  onRegenerate?: (messageId: string) => void
}

function ChatMessage({ message, onEdit, onRegenerate }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const { language } = useStore()

  if (message.role === 'tool') {
      return null
  }

  // Helper to extract text and images
  const textContent = typeof message.content === 'string' 
      ? message.content 
      : Array.isArray(message.content) 
        ? message.content.filter(c => c.type === 'text').map(c => (c as any).text).join('')
        : ''
  
  const images = Array.isArray(message.content) 
      ? message.content.filter(c => c.type === 'image') 
      : []

  const handleStartEdit = () => {
    setEditContent(textContent)
    setIsEditing(true)
  }

  const handleSaveEdit = () => {
    if (onEdit && editContent.trim()) {
      onEdit(message.id, editContent.trim())
    }
    setIsEditing(false)
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditContent('')
  }

  return (
    <div className={`
        w-full flex gap-3 px-4 py-4 animate-slide-up group
        ${isUser ? 'flex-row-reverse' : 'flex-row'}
    `}> 
      {/* Avatar */}
      <div className={`
        w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium shadow-sm border
        ${isUser 
            ? 'bg-surface text-text-secondary border-border-subtle' 
            : 'bg-gradient-to-br from-accent to-purple-600 text-white border-transparent shadow-glow'}
      `}> {isUser ? 'You' : <Sparkles className="w-4 h-4" />} 
      </div>

      {/* Message Bubble */}
      <div className={`
        flex-1 min-w-0 max-w-[85%] rounded-2xl p-4 shadow-sm border
        ${isUser 
            ? 'bg-surface-active/50 border-border-subtle rounded-tr-sm' 
            : 'bg-surface border-border-subtle rounded-tl-sm'}
      `}>
            {images.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                    {images.map((img: any, i) => (
                        <div key={i} className="rounded-lg overflow-hidden border border-border-subtle max-w-full">
                            <img 
                                src={img.source.type === 'base64' ? `data:${img.source.media_type};base64,${img.source.data}` : img.source.data} 
                                alt="User upload" 
                                className="max-w-full h-auto object-cover"
                            />
                        </div>
                    ))}
                </div>
            )}

            {isEditing ? (
              <div className="space-y-2">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full bg-background border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary resize-none focus:outline-none focus:border-accent"
                  rows={3}
                  autoFocus
                />
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={handleCancelEdit}
                    className="px-3 py-1 text-xs text-text-muted hover:text-text-primary transition-colors"
                  >
                    {t('cancel', language)}
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    className="px-3 py-1 bg-accent text-white text-xs rounded-lg hover:bg-accent-hover transition-colors"
                  >
                    {t('saveAndResend', language)}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <ReactMarkdown
                  className="prose prose-invert prose-sm max-w-none break-words leading-relaxed"
                  components={{
                    code({ className, children, node, ...props }) {
                      const match = /language-(\w+)/.exec(className || '')
                      const content = String(children)
                      const isCodeBlock = match || (node?.position?.start?.line !== node?.position?.end?.line)
                      const isInline = !isCodeBlock && !content.includes('\n')
                      
                      return isInline ? (
                        <code className="bg-black/30 border border-white/5 px-1.5 py-0.5 rounded text-accent font-mono text-xs" {...props}>
                          {children}
                        </code>
                      ) : (
                        <div className="relative group/code my-3 rounded-lg overflow-hidden border border-border-subtle bg-[#0d0d0d] shadow-sm">
                            <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/5">
                                <span className="text-[10px] text-text-muted font-mono">{match?.[1] || 'code'}</span>
                            </div>
                            <SyntaxHighlighter
                                style={vscDarkPlus}
                                language={match?.[1]}
                                PreTag="div"
                                className="!bg-transparent !p-4 !m-0 !text-xs custom-scrollbar"
                                customStyle={{ background: 'transparent', margin: 0 }}
                                wrapLines={true}
                                wrapLongLines={true} 
                            >
                                {String(children).replace(/\n$/, '')}
                            </SyntaxHighlighter>
                        </div>
                      )
                    },
                    p: ({children}) => <p className="mb-2 last:mb-0">{children}</p>,
                    ul: ({children}) => <ul className="list-disc pl-4 mb-2 space-y-1 marker:text-text-muted">{children}</ul>,
                    ol: ({children}) => <ol className="list-decimal pl-4 mb-2 space-y-1 marker:text-text-muted">{children}</ol>,
                    a: ({href, children}) => <a href={href} target="_blank" className="text-accent hover:underline font-medium transition-colors">{children}</a>,
                    blockquote: ({children}) => <blockquote className="border-l-2 border-accent/50 pl-4 py-1 my-2 bg-accent/5 italic text-text-muted rounded-r">{children}</blockquote>
                  }}
                >
                  {textContent}
                </ReactMarkdown>
                {message.isStreaming && (
                  <span className="inline-block w-2 h-4 bg-accent animate-pulse ml-1 align-middle rounded-sm" />
                )}
                
                {/* Message Actions */}
                {!message.isStreaming && (
                  <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {isUser && onEdit && (
                      <button
                        onClick={handleStartEdit}
                        className="p-1 text-text-muted hover:text-text-primary hover:bg-surface-hover rounded transition-colors"
                        title={t('editMessage', language)}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                    )}
                    {!isUser && onRegenerate && (
                      <button
                        onClick={() => onRegenerate(message.id)}
                        className="p-1 text-text-muted hover:text-text-primary hover:bg-surface-hover rounded transition-colors"
                        title={t('regenerateResponse', language)}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
        </div>
      </div>
  )
}

interface PendingImage {
    id: string
    file: File
    previewUrl: string
    base64?: string
}

export default function ChatPanel() {
  const {
    chatMode, setChatMode, messages, isStreaming, currentToolCalls,
    clearMessages, llmConfig, pendingToolCall,
    setCurrentSessionId, addMessage, workspacePath, openFile, setActiveFile,
    inputPrompt, setInputPrompt, editMessage, deleteMessagesAfter, language
  } = useStore()
  const {
    sendMessage,
    abort,
    approveCurrentTool,
    rejectCurrentTool,
  } = useAgent()

  const [input, setInput] = useState('')
  const [images, setImages] = useState<PendingImage[]>([])
  const [showSessions, setShowSessions] = useState(false)
  const [showFileMention, setShowFileMention] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionPosition, setMentionPosition] = useState({ x: 0, y: 0 })
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputContainerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  // External prompt (from Command Palette)
  useEffect(() => {
      if (inputPrompt) {
          setInput(inputPrompt)
          setInputPrompt('')
          setTimeout(() => textareaRef.current?.focus(), 100)
      }
  }, [inputPrompt, setInputPrompt])

  // Tool tool file handling
  const handleToolFileClick = useCallback(async (filePath: string) => {
    let fullPath = filePath
    if (workspacePath && !filePath.startsWith('/') && !filePath.match(/^[a-zA-Z]:/)) {
      const sep = workspacePath.includes('\\') ? '\\': '/'
      fullPath = `${workspacePath}${sep}${filePath}`
    }
    const currentContent = await window.electronAPI.readFile(fullPath)
    if (currentContent === null) return
    
    // Checkpoints logic
    const serviceCheckpoints = checkpointService.getCheckpoints()
    const { checkpoints: storeCheckpoints } = useStore.getState()
    const allCheckpoints = [...serviceCheckpoints, ...storeCheckpoints]
    let originalContent: string | undefined
    const normalizePath = (p: string) => p.replace(/\\/g, '/').toLowerCase()
    const normalizedFullPath = normalizePath(fullPath)
    const normalizedFilePath = normalizePath(filePath)
    
    for (let i = allCheckpoints.length - 1; i >= 0; i--) {
      const checkpoint = allCheckpoints[i]
      if (!checkpoint.snapshots) continue
      const snapshotPaths = Object.keys(checkpoint.snapshots)
      for (const snapshotPath of snapshotPaths)
 {
        const normalizedSnapshotPath = normalizePath(snapshotPath)
        if (normalizedSnapshotPath === normalizedFullPath ||
            normalizedSnapshotPath === normalizedFilePath ||
            normalizedSnapshotPath.endsWith('/' + normalizedFilePath) ||
            normalizedFullPath.endsWith('/' + normalizePath(snapshotPath.split(/[\\/]/).pop() || ''))) {
          originalContent = checkpoint.snapshots[snapshotPath].content
          break
        }
      }
      if (originalContent) break
    }
    
    if (originalContent && originalContent !== currentContent) {
      openFile(fullPath, currentContent, originalContent)
    } else {
      openFile(fullPath, currentContent)
    }
    setActiveFile(fullPath)
  }, [workspacePath, openFile, setActiveFile])

  // File mentions detection
  const fileRefs = useMemo(() => {
    const refs: string[] = []
    const regex = /@(?:file:)?([^\s@]+\.[a-zA-Z0-9]+)/g
    let match
    while ((match = regex.exec(input)) !== null) {
      if (match[1] !== 'codebase') {
        refs.push(match[1])
      }
    }
    return refs
  }, [input])

  // Special context reference detection
  const hasCodebaseRef = useMemo(() => /@codebase\b/i.test(input), [input])
  const hasSymbolsRef = useMemo(() => /@symbols\b/i.test(input), [input])
  const hasGitRef = useMemo(() => /@git\b/i.test(input), [input])
  const hasTerminalRef = useMemo(() => /@terminal\b/i.test(input), [input])

  // Image handling
  const addImage = async (file: File) => {
      const id = crypto.randomUUID()
      const previewUrl = URL.createObjectURL(file)
      
      const reader = new FileReader()
      reader.onload = () => {
          const result = reader.result as string
          const base64 = result.split(',')[1]
          setImages(prev => prev.map(img => img.id === id ? { ...img, base64 } : img))
      }
      reader.readAsDataURL(file)

      setImages(prev => [...prev, { id, file, previewUrl }])
  }

  const removeImage = (id: string) => {
      setImages(prev => prev.filter(img => img.id !== id))
  }

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
      const items = e.clipboardData.items
      for (const item of items) {
          if (item.type.startsWith('image/')) {
              e.preventDefault()
              const file = item.getAsFile()
              if (file) addImage(file)
          }
      }
  }, [])

  // Drag and Drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      
      // Check for files first (images)
      const files = Array.from(e.dataTransfer.files)
      const imageFiles = files.filter(f => f.type.startsWith('image/'))
      
      if (imageFiles.length > 0) {
          imageFiles.forEach(addImage)
          return
      }

      // If not images, check for text/paths
      let paths: string[] = []
      const internalPath = e.dataTransfer.getData('application/adnify-file-path')
      if (internalPath) {
          paths.push(internalPath)
      } else {
          const nonImages = files.filter(f => !f.type.startsWith('image/'))
          if (nonImages.length > 0) {
             paths = nonImages.map(f => (f as File & { path?: string }).path).filter((p): p is string => Boolean(p))
          }
      }
      
      if (paths.length > 0) {
          setInput(prev => {
              const prefix = prev.trim() ? prev + ' ' : ''
              const mentions = paths.map(p => {
                  const name = p.split(/[\\/]/).pop()
                  return `@${name}` 
              }).join(' ')
              return prefix + mentions + ' '
          })
          textareaRef.current?.focus()
      }
  }, [])

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

  const handleSelectFile = useCallback((filePath: string) => {
    const cursorPos = textareaRef.current?.selectionStart || input.length
    const textBeforeCursor = input.slice(0, cursorPos)
    const textAfterCursor = input.slice(cursorPos)
    
    const atIndex = textBeforeCursor.lastIndexOf('@')
    if (atIndex !== -1) {
      const newInput = textBeforeCursor.slice(0, atIndex) + '@' + filePath + ' ' + textAfterCursor
      setInput(newInput)
    }
    
    setShowFileMention(false)
    setMentionQuery('')
    textareaRef.current?.focus()
  }, [input])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentToolCalls])

  const handleSubmit = useCallback(async () => {
    if ((!input.trim() && images.length === 0) || isStreaming) return
    
    let userMessage: string | any[] = input.trim()
    
    if (images.length > 0) {
        const readyImages = images.filter(img => img.base64)
        if (readyImages.length !== images.length) {
            console.warn('Waiting for image processing...')
            return
        }

        userMessage = [
            { type: 'text', text: input.trim() },
            ...readyImages.map(img => ({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: img.file.type,
                    data: img.base64
                }
            }))
        ]
    }

    setInput('')
    setImages([])
    await sendMessage(userMessage as any)
  }, [input, images, isStreaming, sendMessage])

  const handleLoadSession = useCallback(async (sessionId: string) => {
    const session = await sessionService.getSession(sessionId)
    if (session) {
      clearMessages()
      setChatMode(session.mode)
      session.messages.forEach(msg => {
        addMessage({
          role: msg.role,
          content: msg.content as any, // Cast for compatibility
          toolCallId: msg.toolCallId,
          toolName: msg.toolName,
        })
      })
      setCurrentSessionId(sessionId)
      setShowSessions(false)
    }
  }, [clearMessages, setChatMode, addMessage, setCurrentSessionId])

  // 编辑消息并重新发送
  const handleEditMessage = useCallback(async (messageId: string, newContent: string) => {
    // 删除该消息之后的所有消息
    deleteMessagesAfter(messageId)
    // 更新消息内容
    editMessage(messageId, newContent)
    // 重新发送
    await sendMessage(newContent)
  }, [deleteMessagesAfter, editMessage, sendMessage])

  // 重新生成响应
  const handleRegenerate = useCallback(async (messageId: string) => {
    // 找到这条消息之前的用户消息
    const msgIndex = messages.findIndex(m => m.id === messageId)
    if (msgIndex <= 0) return
    
    // 找到最近的用户消息
    let userMsgIndex = msgIndex - 1
    while (userMsgIndex >= 0 && messages[userMsgIndex].role !== 'user') {
      userMsgIndex--
    }
    
    if (userMsgIndex < 0) return
    
    const userMsg = messages[userMsgIndex]
    const userContent = typeof userMsg.content === 'string' 
      ? userMsg.content 
      : userMsg.content.filter(c => c.type === 'text').map(c => (c as any).text).join('')
    
    // 删除用户消息之后的所有消息
    deleteMessagesAfter(userMsg.id)
    // 重新发送
    await sendMessage(userContent)
  }, [messages, deleteMessagesAfter, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
  }

  const hasApiKey = !!llmConfig.apiKey

  return (
    <div 
        className={`w-full h-full flex flex-col relative z-10 bg-[#09090b] transition-colors ${isDragging ? 'bg-accent/5 ring-2 ring-inset ring-accent' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
    > {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-border bg-background/50 backdrop-blur-sm z-20">
        <div className="flex bg-surface rounded-lg p-0.5 border border-border-subtle">
            <button
            onClick={() => setChatMode('chat')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${ 
                chatMode === 'chat'
                ? 'bg-background text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-primary'
            }`}
            >
            Chat
            </button>
            <button
            onClick={() => setChatMode('agent')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${ 
                chatMode === 'agent'
                ? 'text-accent bg-accent/10 shadow-sm'
                : 'text-text-muted hover:text-text-primary'
            }`}
            >
            Agent
            </button>
        </div>
        
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSessions(!showSessions)}
            className={`p-1.5 rounded-md hover:bg-surface-hover transition-colors ${showSessions ? 'text-accent' : 'text-text-muted'}`}
            title={t('history', language)}
          >
            <History className="w-4 h-4" />
          </button>
           <button
            onClick={clearMessages}
            className="p-1.5 rounded-md hover:bg-surface-hover hover:text-status-error transition-colors"
            title={t('clearChat', language)}
          >
            <Trash2 className="w-4 h-4 text-text-muted" />
          </button>
        </div>
      </div>

      {/* Overlays */}
      {showSessions && (
        <div className="absolute top-12 right-0 left-0 bottom-0 bg-background/95 backdrop-blur-md z-30 overflow-hidden animate-slide-in p-4">
          <SessionList 
            onClose={() => setShowSessions(false)} 
            onLoadSession={handleLoadSession}
          />
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar p-0 pb-4 bg-background">
        {!hasApiKey && (
          <div className="m-4 p-4 border border-warning/20 bg-warning/5 rounded-lg flex gap-3">
             <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />
             <div>
                <span className="font-medium text-sm text-warning block mb-1">{t('setupRequired', language)}</span>
                <p className="text-xs text-text-muted leading-relaxed">{t('setupRequiredDesc', language)}</p>
             </div>
          </div>
        )}

        {messages.length === 0 && hasApiKey && (
          <div className="h-full flex flex-col items-center justify-center opacity-40 select-none pointer-events-none gap-6 animate-fade-in">
             <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-surface to-surface-active border border-border-subtle flex items-center justify-center shadow-2xl">
                <Sparkles className="w-10 h-10 text-accent/80" />
             </div>
             <div className="text-center">
                 <p className="text-lg font-semibold text-text-primary mb-1">Adnify Agent</p>
                 <p className="text-sm text-text-muted">{t('howCanIHelp', language)}</p>
             </div>
          </div>
        )}

        <div className="flex flex-col gap-0 pb-4 px-2">
            {messages.map((msg, index) => {
                // 跳过 tool 类型的消息（它们会在 ToolCallCard 中显示结果）
                if (msg.role === 'tool') {
                    return null
                }
                
                // 跳过空的 assistant 消息（纯工具调用触发）
                const textContent = typeof msg.content === 'string' 
                    ? msg.content 
                    : Array.isArray(msg.content) 
                        ? msg.content.filter(c => c.type === 'text').map(c => (c as any).text).join('')
                        : ''
                
                if (msg.role === 'assistant' && !textContent.trim() && !msg.isStreaming) {
                    return null
                }
                
                // 检查这条消息后面是否紧跟着工具调用
                // 如果是最后一条 assistant 消息且有 currentToolCalls，则内联显示
                const isLastAssistant = msg.role === 'assistant' && 
                    index === messages.length - 1 || 
                    (index < messages.length - 1 && messages.slice(index + 1).every(m => m.role === 'tool'))
                
                const shouldShowToolCalls = isLastAssistant && currentToolCalls.length > 0
                
                return (
                    <div key={msg.id}>
                        <ChatMessage 
                            message={msg}
                            onEdit={handleEditMessage}
                            onRegenerate={handleRegenerate}
                        />
                        
                        {/* 内联显示工具调用 - 在最后一条 AI 消息下方 */}
                        {shouldShowToolCalls && (
                            <div className="ml-11 mr-4 mt-1 space-y-1.5 animate-fade-in">
                                {currentToolCalls.map((toolCall) => (
                                    <ToolCallCard
                                        key={toolCall.id}
                                        toolCall={toolCall}
                                        onApprove={pendingToolCall?.id === toolCall.id ? approveCurrentTool : undefined}
                                        onReject={pendingToolCall?.id === toolCall.id ? rejectCurrentTool : undefined}
                                        onFileClick={handleToolFileClick}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )
            })}
            
            {/* 如果没有消息但有工具调用（边缘情况） */}
            {messages.length === 0 && currentToolCalls.length > 0 && (
                <div className="px-4 py-2 space-y-1.5 animate-fade-in">
                    {currentToolCalls.map((toolCall) => (
                        <ToolCallCard
                            key={toolCall.id}
                            toolCall={toolCall}
                            onApprove={pendingToolCall?.id === toolCall.id ? approveCurrentTool : undefined}
                            onReject={pendingToolCall?.id === toolCall.id ? rejectCurrentTool : undefined}
                            onFileClick={handleToolFileClick}
                        />
                    ))}
                </div>
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

      {/* Input Area */}
      <div ref={inputContainerRef} className="p-4 bg-background border-t border-border z-20">
        <div className={`
            relative group rounded-xl border transition-all duration-200
            ${isStreaming 
                ? 'border-accent/50 bg-accent/5' 
                : 'border-border-subtle bg-surface focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/20 focus-within:shadow-glow'}
        `}> {/* Image Previews */}
              {images.length > 0 && (
                  <div className="flex gap-2 p-3 pb-0 overflow-x-auto custom-scrollbar">
                      {images.map(img => (
                          <div key={img.id} className="relative group/img flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-border-subtle">
                              <img src={img.previewUrl} alt="preview" className="w-full h-full object-cover" />
                              <button
                                  onClick={() => removeImage(img.id)}
                                  className="absolute top-0.5 right-0.5 p-0.5 bg-black/50 rounded-full text-white hover:bg-red-500 transition-colors opacity-0 group-hover/img:opacity-100"
                              >
                                  <X className="w-3 h-3" />
                              </button>
                          </div>
                      ))}
                  </div>
              )}

          {/* Context Chips */}
          {(fileRefs.length > 0 || hasCodebaseRef || hasSymbolsRef || hasGitRef || hasTerminalRef) && (
             <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                {hasCodebaseRef && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-500/10 text-purple-400 text-[10px] font-medium rounded-full border border-purple-500/20 animate-fade-in">
                        <Database className="w-3 h-3" />
                        @codebase
                    </span>
                )}
                {hasSymbolsRef && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 text-blue-400 text-[10px] font-medium rounded-full border border-blue-500/20 animate-fade-in">
                        <Code className="w-3 h-3" />
                        @symbols
                    </span>
                )}
                {hasGitRef && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-500/10 text-orange-400 text-[10px] font-medium rounded-full border border-orange-500/20 animate-fade-in">
                        <GitBranch className="w-3 h-3" />
                        @git
                    </span>
                )}
                {hasTerminalRef && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-500/10 text-green-400 text-[10px] font-medium rounded-full border border-green-500/20 animate-fade-in">
                        <Terminal className="w-3 h-3" />
                        @terminal
                    </span>
                )}
                {fileRefs.map((ref, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent text-[10px] font-medium rounded-full border border-accent/20 animate-fade-in">
                        <FileText className="w-3 h-3" />
                        {ref}
                    </span>
                ))}
             </div>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={hasApiKey ? t('pasteImagesHint', language) : t('configureApiKey', language)}
            disabled={!hasApiKey || !!pendingToolCall}
            className="w-full bg-transparent border-none rounded-xl px-4 py-3 pr-12
                     text-sm text-text-primary placeholder-text-muted/60 resize-none
                     focus:ring-0 focus:outline-none leading-relaxed"
            rows={1}
            style={{ minHeight: '52px', maxHeight: '200px' }}
          />
          
          <div className="absolute right-2 bottom-2 flex items-center gap-1">
            <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/*" 
                multiple 
                onChange={(e) => {
                    if (e.target.files) {
                        Array.from(e.target.files).forEach(addImage)
                    }
                    e.target.value = ''
                }}
            />
            <button
                onClick={() => fileInputRef.current?.click()}
                className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
                title={t('uploadImage', language)}
            >
                <ImageIcon className="w-4 h-4" />
            </button>

            <button
                onClick={isStreaming ? abort : handleSubmit}
                disabled={!hasApiKey || ((!input.trim() && images.length === 0) && !isStreaming) || !!pendingToolCall}
                className={`p-2 rounded-lg transition-all flex items-center justify-center
                ${isStreaming
                    ? 'bg-status-error/10 text-status-error hover:bg-status-error/20'
                    : (input.trim() || images.length > 0)
                        ? 'bg-accent text-white shadow-glow hover:bg-accent-hover' 
                        : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'}
                `}
            >
                {isStreaming ? (
                <StopCircle className="w-4 h-4" />
                ) : (
                <Send className="w-4 h-4" />
                )}
            </button>
          </div>
        </div>
        
        <div className="mt-2 flex items-center justify-between px-1">
            <div className="flex items-center gap-2 text-[10px] text-text-muted">
                {chatMode === 'agent' && (
                    <span className="flex items-center gap-1 text-accent">
                        <Sparkles className="w-3 h-3" />
                        {t('agentMode', language)}
                    </span>
                )}
            </div>
            <span className="text-[10px] text-text-muted opacity-50 font-mono">
                {t('returnToSend', language)}
            </span>
        </div>
      </div>
    </div>
  )
}
