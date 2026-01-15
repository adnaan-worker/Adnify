/**
 * 聊天消息组件
 * Cursor 风格：完全扁平化，无气泡，沉浸式体验
 * 新设计：全宽布局，头像在顶部 Header
 */

import React, { useState, useCallback, useEffect } from 'react'
import { User, Copy, Check, RefreshCw, Edit2, RotateCcw, ChevronDown } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import aiAvatar from '../../assets/icon/ai-avatar.gif'
import {
  ChatMessage as ChatMessageType,
  isUserMessage,
  isAssistantMessage,
  getMessageText,
  getMessageImages,
  AssistantPart,
  isTextPart,
  isToolCallPart,
  isReasoningPart,
  ReasoningPart,
  ToolCall,
} from '@renderer/agent/types'
import FileChangeCard from './FileChangeCard'
import ToolCallCard from './ToolCallCard'
import ToolCallGroup from './ToolCallGroup'
import { OptionCard } from './OptionCard'
import { needsDiffPreview } from '@/shared/config/tools'
import { useStore } from '@store'
import { MessageBranchActions } from './BranchManager'

interface ChatMessageProps {
  message: ChatMessageType
  onEdit?: (messageId: string, newContent: string) => void
  onRegenerate?: (messageId: string) => void
  onRestore?: (messageId: string) => void
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  onSelectOption?: (messageId: string, selectedIds: string[]) => void
  pendingToolId?: string
  hasCheckpoint?: boolean
}

// 代码块组件 - 更加精致的玻璃质感
const CodeBlock = React.memo(({ language, children, fontSize }: { language: string | undefined; children: React.ReactNode; fontSize: number }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    const text = String(children).replace(/\n$/, '')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [children])

  return (
    <div className="relative group/code my-4 rounded-xl overflow-hidden border border-border bg-black/40 shadow-sm">
      <div className="flex items-center justify-between px-4 py-2 bg-white/[0.03] border-b border-border/50">
        <span className="text-[10px] text-text-muted font-bold font-mono uppercase tracking-widest opacity-70">
          {language || 'text'}
        </span>
        <button
          onClick={handleCopy}
          className="p-1.5 rounded-lg hover:bg-white/10 text-text-muted hover:text-text-primary transition-colors"
          title="Copy code"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <SyntaxHighlighter
        style={vscDarkPlus}
        language={language}
        PreTag="div"
        className="!bg-transparent !p-4 !m-0 custom-scrollbar leading-relaxed font-mono"
        customStyle={{ background: 'transparent', margin: 0, fontSize: `${fontSize}px` }}
        wrapLines
        wrapLongLines
      >
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    </div>
  )
})

CodeBlock.displayName = 'CodeBlock'

// 辅助函数：清理流式输出中的 XML 工具调用标签
const cleanStreamingContent = (text: string): string => {
  if (!text) return ''
  let cleaned = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
  cleaned = cleaned.replace(/<function[\s\S]*?<\/function>/gi, '')
  cleaned = cleaned.replace(/<tool_call>[\s\S]*$/gi, '')
  cleaned = cleaned.replace(/<function[\s\S]*$/gi, '')
  return cleaned.trim()
}

// ThinkingBlock 组件 - 扁平化折叠样式
const ThinkingBlock = React.memo(({ content, startTime, isStreaming, fontSize }: { content: string; startTime?: number; isStreaming: boolean; fontSize: number }) => {
  const [isExpanded, setIsExpanded] = useState(isStreaming)
  const [elapsed, setElapsed] = useState<number>(0)
  const lastElapsed = React.useRef<number>(0)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [shadowClass, setShadowClass] = useState('')

  useEffect(() => {
    setIsExpanded(isStreaming)
  }, [isStreaming])

  useEffect(() => {
    if (!startTime || !isStreaming) return
    const timer = setInterval(() => {
      const current = Math.floor((Date.now() - startTime) / 1000)
      setElapsed(current)
      lastElapsed.current = current
    }, 1000)
    return () => clearInterval(timer)
  }, [startTime, isStreaming])

  // 检测滚动位置，显示/隐藏阴影
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !isExpanded) return
    const checkScroll = () => {
      const hasTop = el.scrollTop > 0
      const hasBottom = el.scrollTop < el.scrollHeight - el.clientHeight - 1
      setShadowClass([hasTop ? 'shadow-top' : '', hasBottom ? 'shadow-bottom' : ''].filter(Boolean).join(' '))
    }
    checkScroll()
    el.addEventListener('scroll', checkScroll)
    return () => el.removeEventListener('scroll', checkScroll)
  }, [isExpanded, content])

  // 流式输出时自动滚动到底部
  useEffect(() => {
    if (isStreaming && isExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [content, isStreaming, isExpanded])

  const durationText = !isStreaming
    ? (lastElapsed.current > 0 ? `Thought for ${lastElapsed.current}s` : 'Thought')
    : `Thinking for ${elapsed}s...`

  return (
    <div className="my-3 group/think">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-text-muted/60 hover:text-text-muted transition-colors select-none"
      >
        <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
          <ChevronDown className="w-3 h-3" />
        </div>
        <span className="text-[11px] font-medium">
          {durationText}
        </span>
      </button>

      {isExpanded && (
        <div className={`mt-2 pl-3 border-l border-border/30 animate-slide-down scroll-shadow-container ${shadowClass}`}>
          <div
            ref={scrollRef}
            className="max-h-[200px] overflow-y-auto scrollbar-none"
          >
            {content ? (
              <div
                style={{ fontSize: `${fontSize - 1}px` }}
                className="text-text-muted/60 leading-relaxed whitespace-pre-wrap font-sans thinking-content"
              >
                {content}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-text-muted/30 italic text-xs py-1">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>Analyzing...</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})
ThinkingBlock.displayName = 'ThinkingBlock'

// Markdown 渲染组件
const MarkdownContent = React.memo(({ content, fontSize, isStreaming }: { content: string; fontSize: number; isStreaming?: boolean }) => {
  const cleanedContent = React.useMemo(() => {
    return isStreaming ? cleanStreamingContent(content) : content
  }, [content, isStreaming])

  const markdownComponents = React.useMemo(() => ({
    code({ className, children, node, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '')
      const codeContent = String(children)
      const isCodeBlock = match || node?.position?.start?.line !== node?.position?.end?.line
      const isInline = !isCodeBlock && !codeContent.includes('\n')

      return isInline ? (
        <code className="bg-white/10 px-1.5 py-0.5 rounded-md text-accent-light font-mono text-[0.9em] border border-white/5" {...props}>
          {children}
        </code>
      ) : (
        <CodeBlock language={match?.[1]} fontSize={fontSize}>{children}</CodeBlock>
      )
    },
    p: ({ children }: any) => <p className="mb-3 last:mb-0 leading-7">{children}</p>,
    ul: ({ children }: any) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
    ol: ({ children }: any) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
    li: ({ children }: any) => <li className="pl-1">{children}</li>,
    a: ({ href, children }: any) => (
      <a href={href} target="_blank" className="text-accent hover:underline decoration-accent/50 underline-offset-2 font-medium">{children}</a>
    ),
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-4 border-accent/30 pl-4 my-4 text-text-muted italic bg-surface/20 py-2 rounded-r">{children}</blockquote>
    ),
    h1: ({ children }: any) => <h1 className="text-2xl font-bold mb-4 mt-6 first:mt-0 text-text-primary tracking-tight">{children}</h1>,
    h2: ({ children }: any) => <h2 className="text-xl font-bold mb-3 mt-5 first:mt-0 text-text-primary tracking-tight">{children}</h2>,
    h3: ({ children }: any) => <h3 className="text-lg font-semibold mb-2 mt-4 first:mt-0 text-text-primary">{children}</h3>,
    table: ({ children }: any) => (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full border-collapse border border-border">{children}</table>
      </div>
    ),
    thead: ({ children }: any) => <thead className="bg-surface/50">{children}</thead>,
    tbody: ({ children }: any) => <tbody>{children}</tbody>,
    tr: ({ children }: any) => <tr className="border-b border-border hover:bg-white/5 transition-colors">{children}</tr>,
    th: ({ children }: any) => <th className="border border-border px-4 py-2 text-left font-semibold text-text-primary">{children}</th>,
    td: ({ children }: any) => <td className="border border-border px-4 py-2 text-text-secondary">{children}</td>,
  }), [fontSize])

  if (!cleanedContent) return null

  return (
    <div style={{ fontSize: `${fontSize}px` }} className="text-text-primary/90 leading-relaxed tracking-wide">
      <ReactMarkdown
        className="prose prose-invert max-w-none"
        components={markdownComponents}
      >
        {cleanedContent}
      </ReactMarkdown>
    </div>
  )
})
MarkdownContent.displayName = 'MarkdownContent'

// 渲染单个 Part
const RenderPart = React.memo(({
  part,
  index,
  pendingToolId,
  onApproveTool,
  onRejectTool,
  onOpenDiff,
  fontSize,
  isStreaming,
}: {
  part: AssistantPart
  index: number
  pendingToolId?: string
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  fontSize: number
  isStreaming?: boolean
}) => {
  if (isTextPart(part)) {
    if (!part.content.trim()) return null
    return <MarkdownContent key={`text-${index}`} content={part.content} fontSize={fontSize} isStreaming={isStreaming} />
  }

  if (isReasoningPart(part)) {
    const reasoningPart = part as ReasoningPart
    if (!reasoningPart.content?.trim() && !reasoningPart.isStreaming) return null
    return (
      <ThinkingBlock
        key={`reasoning-${index}`}
        content={reasoningPart.content}
        startTime={reasoningPart.startTime}
        isStreaming={!!reasoningPart.isStreaming}
        fontSize={fontSize}
      />
    )
  }

  if (isToolCallPart(part)) {
    const tc = part.toolCall
    const isPending = tc.id === pendingToolId

    // 需要 Diff 预览的工具使用 FileChangeCard
    if (needsDiffPreview(tc.name)) {
      return (
        <div className="my-3">
          <FileChangeCard
            key={`tool-${tc.id}-${index}`}
            toolCall={tc}
            isAwaitingApproval={isPending}
            onApprove={isPending ? onApproveTool : undefined}
            onReject={isPending ? onRejectTool : undefined}
            onOpenInEditor={onOpenDiff}
          />
        </div>
      )
    }

    // 其他工具使用 ToolCallCard
    return (
      <div className="my-3">
        <ToolCallCard
          key={`tool-${tc.id}-${index}`}
          toolCall={tc}
          isAwaitingApproval={isPending}
          onApprove={isPending ? onApproveTool : undefined}
          onReject={isPending ? onRejectTool : undefined}
        />
      </div>
    )
  }

  return null
})

RenderPart.displayName = 'RenderPart'

const ChatMessage = React.memo(({
  message,
  onEdit,
  onRegenerate,
  onRestore,
  onApproveTool,
  onRejectTool,
  onOpenDiff,
  pendingToolId,
  hasCheckpoint,
}: ChatMessageProps) => {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [copied, setCopied] = useState(false)
  const { editorConfig, language } = useStore()
  const fontSize = editorConfig.fontSize

  if (!isUserMessage(message) && !isAssistantMessage(message)) {
    return null
  }

  const isUser = isUserMessage(message)
  const textContent = getMessageText(message.content)
  const images = isUser ? getMessageImages(message.content) : []

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

  const handleCopy = () => {
    navigator.clipboard.writeText(textContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="w-full py-6 group transition-colors duration-200 border-b border-border/40 animate-fade-in">
      <div className="max-w-3xl mx-auto px-6 relative">
        {/* Header Row: Avatar + Name + Actions */}
        <div className="flex items-center gap-3 mb-3 select-none">
          <div className="flex-shrink-0">
            {isUser ? (
              <div className="w-6 h-6 rounded-lg bg-surface/50 border border-border flex items-center justify-center">
                <User className="w-3.5 h-3.5 text-text-secondary" />
              </div>
            ) : (
              <div className="w-6 h-6 rounded-lg overflow-hidden border border-accent/20 bg-black">
                <img src={aiAvatar} alt="AI" className="w-full h-full object-cover opacity-90" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 flex items-center gap-2">
            <span className="text-sm font-bold text-text-primary">
              {isUser ? 'You' : 'Adnify'}
            </span>
            {!isUser && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-accent/10 text-accent border border-accent/20 flex items-center gap-1 uppercase tracking-wide">
                AI
              </span>
            )}
          </div>

          {/* Floating Actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            {isUser && onEdit && (
              <button onClick={handleStartEdit} className="p-1.5 text-text-muted hover:text-text-primary rounded-md hover:bg-white/10 transition-colors" title="Edit">
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            )}
            {!isUser && onRegenerate && (
              <MessageBranchActions messageId={message.id} language={language} onRegenerate={onRegenerate} />
            )}
            {isUser && hasCheckpoint && onRestore && (
              <button onClick={() => onRestore(message.id)} className="p-1.5 text-text-muted hover:text-amber-400 rounded-md hover:bg-white/10 transition-colors" title="Restore Checkpoint">
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={handleCopy} className="p-1.5 text-text-muted hover:text-text-primary rounded-md hover:bg-white/10 transition-colors" title="Copy">
              {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div >

        {/* Content Row - Full Width (No Padding) */}
        <div className="w-full">
          {/* Images */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-3 mb-4">
              {images.map((img, i) => (
                <div key={i} className="rounded-xl overflow-hidden border border-border shadow-md max-w-[240px] hover:scale-[1.02] transition-transform">
                  <img
                    src={`data:${img.source.media_type};base64,${img.source.data}`}
                    alt="User upload"
                    className="max-w-full h-auto"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Editing */}
          {isEditing ? (
            <div className="space-y-3 bg-surface/20 p-4 rounded-2xl border border-border backdrop-blur-xl animate-scale-in">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full bg-black/20 border border-border rounded-xl px-4 py-3 text-sm text-text-primary resize-none focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all custom-scrollbar"
                rows={4}
                autoFocus
                style={{ fontSize: `${fontSize}px` }}
              />
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 text-xs font-bold text-text-muted hover:text-text-primary rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-4 py-2 bg-accent text-white text-xs font-bold rounded-lg hover:bg-accent-hover transition-colors shadow-lg shadow-accent/20"
                >
                  Save & Resend
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {/* User message */}
              {isUser && <MarkdownContent content={textContent} fontSize={fontSize} />}

              {/* Assistant message */}
              {isAssistantMessage(message) && message.parts && message.parts.length > 0 && (
                <>
                  {(() => {
                    const groups: Array<
                      | { type: 'part'; part: AssistantPart; index: number }
                      | { type: 'tool_group'; toolCalls: ToolCall[]; startIndex: number }
                    > = []

                    let currentToolCalls: ToolCall[] = []
                    let startIndex = -1

                    message.parts.forEach((part, index) => {
                      if (isToolCallPart(part)) {
                        if (currentToolCalls.length === 0) startIndex = index
                        currentToolCalls.push(part.toolCall)
                      } else {
                        if (currentToolCalls.length > 0) {
                          groups.push({ type: 'tool_group', toolCalls: currentToolCalls, startIndex })
                          currentToolCalls = []
                        }
                        groups.push({ type: 'part', part, index })
                      }
                    })

                    if (currentToolCalls.length > 0) {
                      groups.push({ type: 'tool_group', toolCalls: currentToolCalls, startIndex })
                    }

                    return groups.map((group) => {
                      if (group.type === 'part') {
                        return (
                          <RenderPart
                            key={`part-${group.index}`}
                            part={group.part}
                            index={group.index}
                            pendingToolId={pendingToolId}
                            onApproveTool={onApproveTool}
                            onRejectTool={onRejectTool}
                            onOpenDiff={onOpenDiff}
                            fontSize={fontSize}
                            isStreaming={message.isStreaming}
                          />
                        )
                      } else {
                        if (group.toolCalls.length === 1) {
                          return (
                            <RenderPart
                              key={`part-${group.startIndex}`}
                              part={message.parts![group.startIndex]}
                              index={group.startIndex}
                              pendingToolId={pendingToolId}
                              onApproveTool={onApproveTool}
                              onRejectTool={onRejectTool}
                              onOpenDiff={onOpenDiff}
                              fontSize={fontSize}
                              isStreaming={message.isStreaming}
                            />
                          )
                        }
                        return (
                          <ToolCallGroup
                            key={`group-${group.startIndex}`}
                            toolCalls={group.toolCalls}
                            pendingToolId={pendingToolId}
                            onApproveTool={onApproveTool}
                            onRejectTool={onRejectTool}
                            onOpenDiff={onOpenDiff}
                          />
                        )
                      }
                    })
                  })()}
                </>
              )}

              {/* Streaming indicator */}
              {isAssistantMessage(message) && message.isStreaming && (
                <StreamingIndicator />
              )}

              {/* Interactive content (options) */}
              {isAssistantMessage(message) && message.interactive && !message.isStreaming && (
                <OptionCard
                  content={message.interactive}
                  onSelect={(selectedIds) => {
                    const selectedLabels = message.interactive!.options
                      .filter(opt => selectedIds.includes(opt.id))
                      .map(opt => opt.label)
                    const response = selectedLabels.join(', ')
                    
                    window.dispatchEvent(new CustomEvent('chat-update-interactive', {
                      detail: { messageId: message.id, selectedIds }
                    }))
                    
                    window.dispatchEvent(new CustomEvent('chat-send-message', { 
                      detail: { content: response, messageId: message.id }
                    }))
                  }}
                  disabled={!!message.interactive.selectedIds?.length}
                />
              )}
            </div>
          )}
        </div >
      </div >
    </div >
  )
})

// 流式指示器组件
const THINKING_TEXTS = ['Thinking', 'Analyzing', 'Processing', 'Generating', 'Composing', 'Crafting']
const THINKING_TEXTS_ZH = ['思考中', '分析中', '处理中', '生成中', '编写中', '构思中']

function StreamingIndicator() {
  const { language } = useStore()
  const [textIndex, setTextIndex] = useState(() => Math.floor(Math.random() * THINKING_TEXTS.length))
  
  useEffect(() => {
    const interval = setInterval(() => {
      setTextIndex(prev => {
        let next = Math.floor(Math.random() * THINKING_TEXTS.length)
        while (next === prev) next = Math.floor(Math.random() * THINKING_TEXTS.length)
        return next
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  const texts = language === 'zh' ? THINKING_TEXTS_ZH : THINKING_TEXTS
  const currentText = texts[textIndex]

  return (
    <div className="flex items-center gap-2 mt-2 ml-1 opacity-80">
      <div className="flex gap-1">
        <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-xs font-bold text-accent tracking-wide animate-pulse">
        {currentText}...
      </span>
    </div>
  )
}

ChatMessage.displayName = 'ChatMessage'

export default ChatMessage