/**
 * 聊天消息组件
 * Linear / Apple 风格：完全左对齐，用户消息右对齐气泡
 * 新设计：极致排版，支持 Tooltip
 */

import React, { useState, useCallback, useEffect } from 'react'
import { User, Copy, Check, RefreshCw, Edit2, RotateCcw, ChevronDown, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism'
import aiAvatar from '../../assets/icon/ai-avatar.gif'
import { themeManager } from '../../config/themeConfig'
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
import { InteractiveCard } from './InteractiveCard'
import { needsDiffPreview } from '@/shared/config/tools'
import { useStore } from '@store'
import { MessageBranchActions } from './BranchControls'
import remarkGfm from 'remark-gfm'
import { Tooltip } from '../ui/Tooltip'
import { useFluidTypewriter } from '@renderer/hooks/useFluidTypewriter'

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
  const { currentTheme } = useStore()
  const theme = themeManager.getThemeById(currentTheme)
  const syntaxStyle = theme?.type === 'light' ? vs : vscDarkPlus

  // Handle children which might contain the cursor span
  const { codeText, hasCursor } = React.useMemo(() => {
    let text = ''
    let hasCursor = false

    React.Children.forEach(children, child => {
      if (typeof child === 'string') {
        text += child
      } else if (typeof child === 'object' && child !== null && 'props' in child && (child as any).props?.className?.includes('fuzzy-cursor')) {
        hasCursor = true
      } else if (Array.isArray(child)) {
        // Handle nested arrays if any
        child.forEach(c => {
          if (typeof c === 'string') text += c
        })
      }
    })

    // Fallback
    if (!text && typeof children === 'string') text = children

    return { codeText: text.replace(/\n$/, ''), hasCursor }
  }, [children])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(codeText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [codeText])

  return (
    <div className="relative group/code my-4 rounded-xl overflow-hidden border border-border bg-background-tertiary shadow-sm">
      <div className="flex items-center justify-between px-4 py-2 bg-surface/50 border-b border-border/50">
        <span className="text-[10px] text-text-muted font-bold font-mono uppercase tracking-widest opacity-70">
          {language || 'text'}
        </span>
        <Tooltip content="Copy Code">
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-lg hover:bg-white/10 text-text-muted hover:text-text-primary transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </Tooltip>
      </div>
      <div className="relative">
        <SyntaxHighlighter
          style={syntaxStyle}
          language={language}
          PreTag="div"
          className="!bg-transparent !p-4 !m-0 custom-scrollbar leading-relaxed font-mono"
          customStyle={{ background: 'transparent', margin: 0, fontSize: `${fontSize}px` }}
          wrapLines
          wrapLongLines
        >
          {codeText}
        </SyntaxHighlighter>
        {hasCursor && <span className="fuzzy-cursor absolute bottom-4 right-4" />}
      </div>
    </div>
  )
})

CodeBlock.displayName = 'CodeBlock'

// 辅助函数：清理流式输出中的 XML 工具调用标签
const cleanStreamingContent = (text: string): string => {
  if (!text) return ''
  let cleaned = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
  cleaned = cleaned.replace(/<function>[\s\S]*?<\/function>/gi, '')
  cleaned = cleaned.replace(/<tool_call>[\s\S]*$/gi, '')
  cleaned = cleaned.replace(/<function>[\s\S]*$/gi, '')
  return cleaned.trim()
}

// ThinkingBlock 组件 - 扁平化折叠样式
interface ThinkingBlockProps {
  content: string
  startTime?: number
  isStreaming: boolean
  fontSize: number
}

const ThinkingBlock = React.memo(({ content, startTime, isStreaming, fontSize }: ThinkingBlockProps) => {
  const [isExpanded, setIsExpanded] = useState(isStreaming)
  const [elapsed, setElapsed] = useState<number>(0)
  const lastElapsed = React.useRef<number>(0)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [shadowClass, setShadowClass] = useState('')

  // Fluid effect for thinking content
  const fluidContent = useFluidTypewriter(content, isStreaming, {
    baseSpeed: 2,
    accelerationFactor: 30
  })

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
                style={{ fontSize: `${fontSize}px` }}
                className="text-text-muted/60 leading-relaxed whitespace-pre-wrap font-sans thinking-content"
              >
                {fluidContent}
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

// Fluid Rendering Hook Removed (Extracted to hooks/useFluidTypewriter.ts)

// Markdown 渲染组件
const MarkdownContent = React.memo(({ content, fontSize, isStreaming }: { content: string; fontSize: number; isStreaming?: boolean }) => {
  const cleanedContent = React.useMemo(() => {
    return isStreaming ? cleanStreamingContent(content) : content
  }, [content, isStreaming])

  const fluidContent = useFluidTypewriter(cleanedContent, !!isStreaming)

  // Add cursor to the last text node if streaming
  // Note: This is a simplified approach. Ideally we'd inject it into the AST.
  // For now, we rely on the fact that ReactMarkdown renders children.
  // We can't easily append to the markdown output directly without parsing.
  // Instead, we render the cursor as a separate element if it's streaming.

  const markdownComponents = React.useMemo(() => ({
    code({ className, children, node, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '')
      const codeContent = String(children)
      const isCodeBlock = match || node?.position?.start?.line !== node?.position?.end?.line
      const isInline = !isCodeBlock && !codeContent.includes('\n')

      return isInline ? (
        <code className="bg-surface-muted px-1.5 py-0.5 rounded-md text-accent font-mono text-[0.9em] border border-border break-all animate-fluid-text" {...props}>
          {children}
        </code>
      ) : (
        <div className="animate-fluid-block">
          <CodeBlock language={match?.[1]} fontSize={fontSize}>{children}</CodeBlock>
        </div>
      )
    },
    pre: ({ children }: any) => <div className="overflow-x-auto max-w-full animate-fluid-block">{children}</div>,
    p: ({ children }: any) => <p className="mb-3 last:mb-0 leading-7 break-words animate-fluid-block">{children}</p>,
    ul: ({ children }: any) => <ul className="list-disc pl-5 mb-3 space-y-1 animate-fluid-block">{children}</ul>,
    ol: ({ children }: any) => <ol className="list-decimal pl-5 mb-3 space-y-1 animate-fluid-block">{children}</ol>,
    li: ({ children }: any) => <li className="pl-1 animate-fluid-block">{children}</li>,
    a: ({ href, children }: any) => (
      <a href={href} target="_blank" className="text-accent hover:underline decoration-accent/50 underline-offset-2 font-medium animate-fluid-text">{children}</a>
    ),
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-4 border-accent/30 pl-4 my-4 text-text-muted italic bg-surface/20 py-2 rounded-r animate-fluid-block">{children}</blockquote>
    ),
    h1: ({ children }: any) => <h1 className="text-2xl font-bold mb-4 mt-6 first:mt-0 text-text-primary tracking-tight animate-fluid-block">{children}</h1>,
    h2: ({ children }: any) => <h2 className="text-xl font-bold mb-3 mt-5 first:mt-0 text-text-primary tracking-tight animate-fluid-block">{children}</h2>,
    h3: ({ children }: any) => <h3 className="text-lg font-semibold mb-2 mt-4 first:mt-0 text-text-primary animate-fluid-block">{children}</h3>,
    table: ({ children }: any) => (
      <div className="overflow-x-auto my-4 animate-fluid-block">
        <table className="min-w-full border-collapse border border-border">{children}</table>
      </div>
    ),
    thead: ({ children }: any) => <thead className="bg-surface/50">{children}</thead>,
    tbody: ({ children }: any) => <tbody>{children}</tbody>,
    tr: ({ children }: any) => <tr className="border-b border-border hover:bg-surface-hover transition-colors">{children}</tr>,
    th: ({ children }: any) => <th className="border border-border px-4 py-2 text-left font-semibold text-text-primary">{children}</th>,
    td: ({ children }: any) => <td className="border border-border px-4 py-2 text-text-secondary">{children}</td>,
  }), [fontSize])

  if (!cleanedContent) return null

  return (
    <div style={{ fontSize: `${fontSize}px` }} className={`text-text-primary/90 leading-relaxed tracking-wide overflow-hidden ${isStreaming ? 'streaming-ink-effect' : ''}`}>
      <ReactMarkdown
        className="prose prose-invert max-w-none"
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {fluidContent}
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

// 助手消息内容组件 - 将分组逻辑提取出来并 memoize
const AssistantMessageContent = React.memo(({
  parts,
  pendingToolId,
  onApproveTool,
  onRejectTool,
  onOpenDiff,
  fontSize,
  isStreaming,
}: {
  parts: AssistantPart[]
  pendingToolId?: string
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  fontSize: number
  isStreaming?: boolean
}) => {
  // Memoize 分组逻辑
  const groups = React.useMemo(() => {
    const result: Array<
      | { type: 'part'; part: AssistantPart; index: number }
      | { type: 'tool_group'; toolCalls: ToolCall[]; startIndex: number }
    > = []

    let currentToolCalls: ToolCall[] = []
    let startIndex = -1

    parts.forEach((part, index) => {
      if (isToolCallPart(part)) {
        if (currentToolCalls.length === 0) startIndex = index
        currentToolCalls.push(part.toolCall)
      } else {
        if (currentToolCalls.length > 0) {
          result.push({ type: 'tool_group', toolCalls: currentToolCalls, startIndex })
          currentToolCalls = []
        }
        result.push({ type: 'part', part, index })
      }
    })

    if (currentToolCalls.length > 0) {
      result.push({ type: 'tool_group', toolCalls: currentToolCalls, startIndex })
    }

    return result
  }, [parts])

  return (
    <>
      {groups.map((group) => {
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
              isStreaming={isStreaming}
            />
          )
        } else {
          if (group.toolCalls.length === 1) {
            return (
              <RenderPart
                key={`part-${group.startIndex}`}
                part={parts[group.startIndex]}
                index={group.startIndex}
                pendingToolId={pendingToolId}
                onApproveTool={onApproveTool}
                onRejectTool={onRejectTool}
                onOpenDiff={onOpenDiff}
                fontSize={fontSize}
                isStreaming={isStreaming}
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
      })}
    </>
  )
})
AssistantMessageContent.displayName = 'AssistantMessageContent'

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

  const tt = {
    copy: language === 'zh' ? '复制内容' : 'Copy Content',
    edit: language === 'zh' ? '编辑消息' : 'Edit Message',
    restore: language === 'zh' ? '恢复到此检查点' : 'Restore checkpoint',
    save: language === 'zh' ? '保存并重发' : 'Save & Resend',
    cancel: language === 'zh' ? '取消' : 'Cancel',
  }

  return (
    <div className={`
      w-full group/msg transition-colors duration-300
      ${isUser ? 'py-1 bg-transparent' : 'py-2 border-y border-border bg-surface hover:bg-surface-hover'}
    `}>
      <div className="w-full px-4 flex flex-col gap-1">

        {/* User Layout */}
        {isUser && (
          <div className="w-full flex flex-col items-end gap-1.5">
            {/* Header Row */}
            <div className="flex items-center gap-2.5 px-1 select-none">
              <span className="text-[11px] font-bold text-text-muted/60 uppercase tracking-tight">You</span>
              <div className="w-7 h-7 rounded-full bg-surface/60 border border-white/10 flex items-center justify-center text-text-muted shadow-sm flex-shrink-0">
                <User className="w-3.5 h-3.5" />
              </div>
            </div>

            {/* Bubble / Editing */}
            <div className="flex flex-col items-end max-w-[85%] sm:max-w-[75%] min-w-0 mr-8 sm:mr-12 w-full">
              {isEditing ? (
                <div className="w-full relative group/edit">
                  <div className="absolute inset-0 -m-1 rounded-[20px] bg-accent/5 opacity-0 group-focus-within/edit:opacity-100 transition-opacity duration-300 pointer-events-none" />
                  <div className="relative bg-surface/80 backdrop-blur-xl border border-accent/30 rounded-[18px] shadow-lg overflow-hidden animate-scale-in origin-right transition-all duration-200 group-focus-within/edit:border-accent group-focus-within/edit:ring-1 group-focus-within/edit:ring-accent/50">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleSaveEdit()
                        }
                        if (e.key === 'Escape') {
                          setIsEditing(false)
                        }
                      }}
                      className="w-full bg-transparent border-none outline-none px-4 py-3 text-text-primary resize-none focus:ring-0 focus:outline-none transition-all custom-scrollbar font-mono text-sm leading-relaxed placeholder:text-text-muted/30"
                      rows={Math.max(2, Math.min(15, editContent.split('\n').length))}
                      autoFocus
                      style={{ fontSize: `${fontSize}px` }}
                      placeholder="Type your message..."
                    />
                    <div className="flex items-center justify-between px-2 py-1.5 bg-black/5 border-t border-black/5">
                      <span className="text-[10px] text-text-muted/50 ml-2 font-medium">
                        Esc to cancel • Enter to save
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setIsEditing(false)}
                          className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-black/10 transition-colors"
                          title={tt.cancel}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={handleSaveEdit}
                          className="p-1.5 rounded-lg text-accent hover:text-white hover:bg-accent transition-all shadow-sm"
                          title={tt.save}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="relative bg-accent/15 text-text-primary border border-accent/20 px-4 py-2.5 rounded-[18px] rounded-tr-sm shadow-sm w-fit max-w-full">
                  {/* Images */}
                  {images.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2 justify-end">
                      {images.map((img, i) => (
                        <div key={i} className="rounded-lg overflow-hidden border border-white/10 shadow-md h-28 group/img relative cursor-zoom-in">
                          <img
                            src={`data:${img.source.media_type};base64,${img.source.data}`}
                            alt="Upload"
                            className="h-full w-auto object-cover"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="text-[14px] leading-relaxed">
                    <MarkdownContent content={textContent} fontSize={fontSize} />
                  </div>
                </div>
              )}

              {/* Actions */}
              {!isEditing && (
                <div className="flex items-center gap-0.5 mt-1 mr-1 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-200">
                  <Tooltip content={tt.copy}>
                    <button onClick={handleCopy} className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-white/5 transition-all">
                      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </Tooltip>
                  {onEdit && (
                    <Tooltip content={tt.edit}>
                      <button onClick={handleStartEdit} className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-white/5 transition-all">
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </Tooltip>
                  )}
                  {hasCheckpoint && onRestore && (
                    <Tooltip content={tt.restore}>
                      <button onClick={() => onRestore(message.id)} className="p-1 rounded-md text-text-muted hover:text-amber-400 hover:bg-white/5 transition-all">
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    </Tooltip>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Assistant Layout */}
        {!isUser && (
          <div className="w-full min-w-0 flex flex-col gap-2">
            <div className="flex items-center gap-3 px-1">
              <div className="w-9 h-9 rounded-xl overflow-hidden border border-border shadow-[0_4px_12px_-2px_rgba(0,0,0,0.1)] bg-surface/50 backdrop-blur-md relative flex-shrink-0">
                <div className="absolute inset-0 bg-accent/5 pointer-events-none" />
                <img src={aiAvatar} alt="AI" className="w-full h-full object-cover" />
              </div>
              <div className="flex items-center gap-2 select-none">
                <span className="text-[13px] font-bold tracking-tight text-text-primary">Adnify</span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-accent/10 text-accent uppercase tracking-widest border border-accent/20">AI</span>
              </div>

              {!message.isStreaming && (
                <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                  <Tooltip content={tt.copy}>
                    <button onClick={handleCopy} className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-white/5 transition-all">
                      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </Tooltip>
                  {onRegenerate && (
                    <div className="flex items-center">
                      <MessageBranchActions messageId={message.id} language={language} onRegenerate={onRegenerate} />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="w-full text-[15px] leading-relaxed text-text-primary/90 pl-1">
              <div className="prose-custom w-full max-w-none">
                {message.parts && (
                  <AssistantMessageContent
                    parts={message.parts}
                    pendingToolId={pendingToolId}
                    onApproveTool={onApproveTool}
                    onRejectTool={onRejectTool}
                    onOpenDiff={onOpenDiff}
                    fontSize={fontSize}
                    isStreaming={message.isStreaming}
                  />
                )}
                {message.isStreaming && <StreamingIndicator />}
              </div>

              {message.interactive && !message.isStreaming && (
                <div className="mt-2 w-full">
                  <InteractiveCard
                    content={message.interactive}
                    onSelect={(selectedIds) => {
                      const selectedLabels = message.interactive!.options
                        .filter(opt => selectedIds.includes(opt.id))
                        .map(opt => opt.label)
                      const response = selectedLabels.join(', ')
                      window.dispatchEvent(new CustomEvent('chat-update-interactive', { detail: { messageId: message.id, selectedIds } }))
                      window.dispatchEvent(new CustomEvent('chat-send-message', { detail: { content: response, messageId: message.id } }))
                    }}
                    disabled={!!message.interactive.selectedIds?.length}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

// 流式指示器组件
const THINKING_TEXTS = ['Thinking', 'Analyzing', 'Processing', 'Generating', 'Composing', 'Crafting']
const THINKING_TEXTS_ZH = ['思考中', '分析中', '处理中', '生成中', '编写中', '构思中']

const StreamingIndicator = React.memo(function StreamingIndicator() {
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
})

ChatMessage.displayName = 'ChatMessage'

export default ChatMessage
