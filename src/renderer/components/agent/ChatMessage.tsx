/**
 * 聊天消息组件
 * Linear / Apple 风格：完全左对齐，用户消息右对齐气泡
 * 新设计：极致排版，支持 Tooltip
 */

import React, { useState, useCallback, useEffect } from 'react'
import { User, Copy, Check, Edit2, RotateCcw, ChevronDown, X, Wrench } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { SyntaxHighlighter } from '@renderer/utils/syntaxHighlighter'
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism'
import aiAvatar from '../../assets/icon/ai-avatar.gif'
import { themeManager } from '../../config/themeConfig'
import { motion, AnimatePresence } from 'framer-motion'
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
  isSearchPart,
  isLintCheckPart,
  ToolCall,
} from '@renderer/agent/types'
import FileChangeCard from './FileChangeCard'
import ToolCallCard from './ToolCallCard'
import { LintCheckCard } from './LintCheckCard'
import ToolCallGroup from './ToolCallGroup'
import { InteractiveCard } from './InteractiveCard'
import { MemoryApprovalInline } from './MemoryApprovalInline'
import { needsDiffPreview } from '@/shared/config/tools'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { MessageBranchActions } from './BranchControls'
import remarkGfm from 'remark-gfm'
import { Tooltip } from '../ui/Tooltip'
import { Modal } from '../ui/Modal'
import { LazyImage } from '../common/LazyImage'
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
  messageId: string
}

interface RenderPartProps {
  part: AssistantPart
  index: number
  pendingToolId?: string
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  fontSize: number
  isStreaming?: boolean
  messageId: string
}

// 代码块组件 - 更加精致的玻璃质感
const CodeBlock = React.memo(({ language, children, fontSize }: { language: string | undefined; children: React.ReactNode; fontSize: number }) => {
  const [copied, setCopied] = useState(false)
  const currentTheme = useStore(s => s.currentTheme)
  const theme = themeManager.getThemeById(currentTheme)
  const syntaxStyle = theme?.type === 'light' ? vs : vscDarkPlus

  // Handle children which might contain the cursor span
  const { codeText, hasCursor } = React.useMemo(() => {
    let text = ''
    let hasCursor = false

    React.Children.forEach(children, child => {
      if (typeof child === 'string') {
        text += child
      } else if (typeof child === 'object' && child !== null && 'props' in child && (child as React.ReactElement<{ className?: string }>).props?.className?.includes('fuzzy-cursor')) {
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
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
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
          customStyle={{ backgroundColor: 'transparent', margin: 0, fontSize: `${fontSize}px` }}
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
  // 短路优化：大部分流式 token 不含 XML 标签，无需执行正则
  if (!text.includes('<')) return text
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
  onTypingComplete?: () => void
}

// 统一上下文面板 — 单个折叠块，无边框扁平设计
interface MessageMetaGroupProps {
  autoSkills?: any[]
  manualSkills?: any[]
  searchContent?: string
  isSearchStreaming?: boolean
}

const MessageMetaGroup = React.memo(({ autoSkills, manualSkills, searchContent, isSearchStreaming }: MessageMetaGroupProps) => {
  // Hooks 必须在所有条件返回之前调用（React 规则）
  const [isExpanded, setIsExpanded] = useState(true)
  const { openFile, setActiveFile, workspacePath } = useStore(useShallow(s => ({ openFile: s.openFile, setActiveFile: s.setActiveFile, workspacePath: s.workspacePath })))

  const hasAutoSkills = autoSkills && autoSkills.length > 0
  const hasManualSkills = manualSkills && manualSkills.length > 0
  const hasSearch = searchContent !== undefined || isSearchStreaming
  const hasSkills = hasAutoSkills || hasManualSkills
  const isStreaming = isSearchStreaming

  if (!hasSkills && !hasSearch) return null

  const handleOpenSkill = async (e: React.MouseEvent, skillId: string) => {
    e.stopPropagation()
    if (!workspacePath) return
    const { api } = await import('@/renderer/services/electronAPI')
    const filePath = `${workspacePath}/.adnify/skills/${skillId}/SKILL.md`.replace(/\//g, '\\')
    const content = await api.file.read(filePath)
    if (content !== null) {
      openFile(filePath, content)
      setActiveFile(filePath)
    }
  }

  // 折叠时的摘要
  const allSkills = [...(autoSkills || []), ...(manualSkills || [])]
  const skillNames = allSkills.map((s: any) => s.skillId).join(', ')

  return (
    <div className="overflow-hidden w-full my-0.5 animate-fade-in relative z-10">
      {/* 标题行 */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 px-2 py-1.5 cursor-pointer select-none group rounded-md hover:bg-text-primary/[0.03] transition-colors"
      >
        <motion.div animate={{ rotate: isExpanded ? 0 : -90 }} transition={{ duration: 0.15 }} className="shrink-0 text-text-muted/40 group-hover:text-text-muted transition-colors">
          <ChevronDown className="w-3.5 h-3.5" />
        </motion.div>

        <div className="shrink-0 w-4 h-4 flex items-center justify-center">
          {isStreaming ? (
            <div className="w-3.5 h-3.5 rounded-full bg-accent/20 flex items-center justify-center border border-accent/30">
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            </div>
          ) : (
            <Wrench className="w-3 h-3 text-text-muted/50" />
          )}
        </div>

        <span className={`text-[12px] ${isStreaming ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary transition-colors'}`}>
          Context
        </span>

        {/* 折叠时显示 skill 名称列表 */}
        {!isExpanded && skillNames && (
          <span className="text-[11px] text-text-muted/40 truncate ml-0.5">
            — {skillNames}
          </span>
        )}
      </div>

      {/* 展开内容 — 每行一个类别摘要 */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="pb-1.5 pl-[38px] pr-3 space-y-0.5">
              {/* Skill Referenced */}
              {hasSkills && (
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className="text-text-muted/35 shrink-0">Skill Referenced</span>
                  {allSkills.map((item: any, i: number) => (
                    <React.Fragment key={item.skillId || i}>
                      {i > 0 && <span className="text-text-muted/20">,</span>}
                      <button
                        onClick={(e) => handleOpenSkill(e, item.skillId)}
                        className="font-mono text-text-muted/55 hover:text-accent transition-colors focus:outline-none"
                      >
                        {item.skillId}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              )}

              {/* File Referenced */}
              {hasSearch && (
                <div className="text-[11px]">
                  {searchContent ? (
                    <div className="flex items-start gap-1.5">
                      <span className="text-text-muted/35 shrink-0">File Referenced</span>
                      <div className="text-text-muted/40 leading-relaxed max-h-32 overflow-auto custom-scrollbar whitespace-pre-wrap">
                        {searchContent}
                      </div>
                    </div>
                  ) : (
                    <span className="text-text-muted/25 italic">Searching files...</span>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
MessageMetaGroup.displayName = 'MessageMetaGroup'

const ThinkingBlock = React.memo(({ content, startTime, isStreaming, fontSize, onTypingComplete }: ThinkingBlockProps) => {
  const [isExpanded, setIsExpanded] = useState(isStreaming)
  const [elapsed, setElapsed] = useState<number>(0)
  const lastElapsed = React.useRef<number>(0)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [shadowClass, setShadowClass] = useState('')

  // Fluid effect for thinking content
  const { displayedContent: fluidContent, isTyping } = useFluidTypewriter(content, isStreaming, {
    baseSpeed: 1,
    accelerationFactor: 0.1
  })

  // Notify parent when typing completes
  useEffect(() => {
    if (!isTyping && onTypingComplete) {
      onTypingComplete()
    }
  }, [isTyping, onTypingComplete])

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
    <div className="my-3 group/think overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-text-muted/50 hover:text-text-muted rounded-md hover:bg-text-primary/[0.03] transition-colors select-none"
      >
        <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
          <ChevronDown className="w-3.5 h-3.5" />
        </div>
        <span className="text-[12px]">
          {durationText}
        </span>
      </button>

      {isExpanded && (
        <div className={`relative animate-slide-down scroll-shadow-container ${shadowClass}`}>
          <div
            ref={scrollRef}
            className="max-h-[300px] overflow-y-auto scrollbar-none pl-[38px] pr-3 pb-3"
          >
            {content ? (
              <div
                style={{ fontSize: `${fontSize - 1}px` }}
                className="text-text-muted/70 leading-relaxed whitespace-pre-wrap font-sans thinking-content"
              >
                {fluidContent}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-text-muted/50 italic text-xs py-1">
                <span className="text-shimmer">Analyzing...</span>
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
const MarkdownContent = React.memo(({ content: rawContent, fontSize, isStreaming, onTypingComplete }: { content: string; fontSize: number; isStreaming?: boolean; onTypingComplete?: () => void }) => {
  const content = typeof rawContent === 'string' ? rawContent : String(rawContent ?? '')
  const cleanedContent = React.useMemo(() => {
    return isStreaming ? cleanStreamingContent(content) : content
  }, [content, isStreaming])

  const { displayedContent: fluidContent, isTyping } = useFluidTypewriter(cleanedContent, !!isStreaming)

  const { workspacePath, openFile, setActiveFile } = useStore(useShallow(s => ({ workspacePath: s.workspacePath, openFile: s.openFile, setActiveFile: s.setActiveFile })))

  const handleOpenFile = React.useCallback(async (filePath: string) => {
    if (!workspacePath) return
    const { toFullPath } = await import('@shared/utils/pathUtils')
    const { api } = await import('@/renderer/services/electronAPI')

    const resolvedPath = toFullPath(filePath, workspacePath)

    try {
      const content = await api.file.read(resolvedPath)
      if (content !== null) {
        openFile(resolvedPath, content)
        setActiveFile(resolvedPath)
      }
    } catch (err) {
      console.warn('Failed to open file from markdown:', err)
    }
  }, [workspacePath, openFile, setActiveFile])

  // Notify parent when typing finishes
  useEffect(() => {
    if (!isTyping && onTypingComplete) {
      // 这里的 defer 是因为 React 状态更新可能是同步的，稍微延后以确保渲染稳定
      const timer = setTimeout(onTypingComplete, 50)
      return () => clearTimeout(timer)
    }
  }, [isTyping, onTypingComplete])

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

      const looksLikePath = isInline && (
        codeContent.includes('/') ||
        codeContent.includes('\\') ||
        codeContent.match(/\.(ts|tsx|js|jsx|vue|uvue|md|json|css|scss|less|html|go|rs|py|java|c|cpp|h|hpp)$/i)
      ) && !codeContent.includes(' ') && codeContent.length > 2

      if (isInline && looksLikePath) {
        return (
          <code
            className="bg-surface-muted px-1.5 py-0.5 rounded-md text-accent font-mono text-[0.9em] border border-border break-all animate-fluid-text cursor-pointer hover:underline decoration-accent/50 underline-offset-2 transition-all"
            onClick={(e) => {
              e.preventDefault()
              handleOpenFile(codeContent)
            }}
            title="Click to open file"
            {...props}
          >
            {children}
          </code>
        )
      }

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
    th: ({ children }: any) => <th className="border border-border px-4 py-2 text-text-primary text-left font-semibold text-text-primary">{children}</th>,
    td: ({ children }: any) => <td className="border border-border px-4 py-2 text-text-secondary">{children}</td>,
  }), [fontSize, handleOpenFile])

  if (!cleanedContent) {
    // If content is empty but we're here, signaling complete immediately to avoid blocking
    if (!isTyping && onTypingComplete) {
      setTimeout(onTypingComplete, 0)
    }
    return null
  }

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

// 用于非流式 Part 的立即完成信号（避免在条件分支中直接调用 useEffect）
const CompletionSignal = ({ onComplete }: { onComplete?: () => void }) => {
  useEffect(() => {
    onComplete?.()
  }, [])
  return null
}

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
  messageId,
  onTypingComplete,
}: RenderPartProps & { onTypingComplete?: () => void }) => {
  if (isTextPart(part)) {
    const textStr = typeof part.content === 'string' ? part.content : String(part.content ?? '')
    if (!textStr.trim()) return null
    return (
      <MarkdownContent
        key={`text-${index}`}
        content={textStr}
        fontSize={fontSize}
        isStreaming={isStreaming}
        onTypingComplete={onTypingComplete}
      />
    )
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
        onTypingComplete={onTypingComplete}
      />
    )
  }

  // Search results are static for now, finish immediately
  if (isSearchPart(part)) {
    return <CompletionSignal onComplete={onTypingComplete} />
  }

  // Lint check results
  if (isLintCheckPart(part)) {
    return (
      <>
        <LintCheckCard part={part} />
        <CompletionSignal onComplete={onTypingComplete} />
      </>
    )
  }

  // Tool calls handled by RenderPart (single)
  if (isToolCallPart(part)) {

    const tc = part.toolCall
    const isPending = tc.id === pendingToolId

    // 需要 Diff 预览的工具使用 FileChangeCard
    if (needsDiffPreview(tc.name)) {
      return (
        <div className="my-3 animate-fade-in">
          <FileChangeCard
            key={`tool-${tc.id}-${index}`}
            toolCall={tc}
            isAwaitingApproval={isPending}
            onApprove={isPending ? onApproveTool : undefined}
            onReject={isPending ? onRejectTool : undefined}
            onOpenInEditor={onOpenDiff}
            messageId={messageId}
          />
        </div>
      )
    }

    // AI 记忆提议
    if (tc.name === 'remember') {
      return (
        <MemoryApprovalInline
          key={`tool-${tc.id}-${index}`}
          content={tc.arguments.content as string}
          isAwaitingApproval={isPending}
          isSuccess={tc.status === 'success'}
          messageId={messageId}
          toolCallId={tc.id}
          args={tc.arguments}
        />
      )
    }

    // ask_user 由 InteractiveCard 独立渲染，跳过原始工具卡片
    if (tc.name === 'ask_user') {
      return null
    }

    // todo_write 通过底部 TodoListPanel 展示，不在聊天流中渲染卡片
    if (tc.name === 'todo_write') {
      return null
    }

    // 其他工具使用 ToolCallCard
    return (
      <div className="my-3 animate-fade-in">
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
  messageId,
}: {
  parts: AssistantPart[]
  pendingToolId?: string
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  fontSize: number
  isStreaming?: boolean
  messageId: string
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
              messageId={messageId}
            />
          )
        }

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
              messageId={messageId}
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
            messageId={messageId}
          />
        )
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
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const { editorConfig, language } = useStore(useShallow(s => ({ editorConfig: s.editorConfig, language: s.language })))
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
      ${isUser ? 'py-1 bg-transparent' : 'py-2 border-border bg-surface'}
    `}>
      <div className="w-full px-4 flex flex-col gap-1">

        {/* User Layout */}
        {isUser && (
          <div className="w-full flex flex-col items-end gap-1.5">
            {/* Header Row */}
            <div className="flex items-center gap-2.5 px-1 select-none">
              <span className="text-[11px] font-bold text-text-muted/60 uppercase tracking-tight">You</span>
              <div className="w-7 h-7 rounded-full bg-surface/60 border border-text-primary/10 flex items-center justify-center text-text-muted shadow-sm flex-shrink-0">
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
                <div className="relative bg-surface-active text-text-primary/95 px-4 py-3 rounded-[20px] rounded-tr-[4px] shadow-sm w-fit max-w-full border border-transparent">
                  {/* Images */}
                  {images.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2 justify-end">
                      {images.map((img, i) => {
                        const imgSrc = `data:${img.source.media_type};base64,${img.source.data}`
                        return (
                          <div
                            key={`img-${img.source.media_type}-${i}`}
                            onClick={() => setPreviewImage(imgSrc)}
                            className="rounded-lg overflow-hidden border border-text-inverted/10 shadow-md h-28 max-w-[200px] group/img relative cursor-zoom-in hover:opacity-90 transition-opacity"
                          >
                            <LazyImage
                              src={imgSrc}
                              alt="Upload"
                              className="h-full w-auto object-cover"
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <Modal isOpen={!!previewImage} onClose={() => setPreviewImage(null)} size="full" noPadding showCloseButton={false}>
                    <div
                      className="w-full h-full flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 cursor-zoom-out"
                      onClick={() => setPreviewImage(null)}
                    >
                      {previewImage && (
                        <img
                          src={previewImage}
                          alt="Preview"
                          className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                        />
                      )}
                    </div>
                  </Modal>

                  <div className="text-[14px] leading-relaxed">
                    <MarkdownContent content={textContent} fontSize={fontSize} />
                  </div>
                </div>
              )}

              {/* Actions */}
              {!isEditing && (
                <div className="flex items-center gap-0.5 mt-1 mr-1 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-200">
                  <Tooltip content={tt.copy}>
                    <button onClick={handleCopy} className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all">
                      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </Tooltip>
                  {onEdit && (
                    <Tooltip content={tt.edit}>
                      <button onClick={handleStartEdit} className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all">
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </Tooltip>
                  )}
                  {hasCheckpoint && onRestore && (
                    <Tooltip content={tt.restore}>
                      <button onClick={() => onRestore(message.id)} className="p-1 rounded-md text-text-muted hover:text-amber-400 hover:bg-surface-hover transition-all">
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
                    <button onClick={handleCopy} className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all">
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
              {/* System Context Widget at the top of the content */}
              {isAssistantMessage(message) && (message.contextItems?.some((item: any) => item.type === 'Skill') || message.parts?.some(isSearchPart)) && (
                <MessageMetaGroup
                  autoSkills={message.contextItems?.filter((item: any) => item.type === 'Skill' && item.auto)}
                  manualSkills={message.contextItems?.filter((item: any) => item.type === 'Skill' && !item.auto)}
                  searchContent={message.parts?.find(isSearchPart)?.content || undefined}
                  isSearchStreaming={(message.parts?.find(isSearchPart) as any)?.isStreaming}
                />
              )}
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
                    messageId={message.id}
                  />
                )}
              </div>

              {message.interactive && !message.isStreaming && (
                <div className="mt-2 w-full">
                  <InteractiveCard
                    content={message.interactive}
                    onSelect={(selectedIds, customText) => {
                      const selectedLabels = message.interactive!.options
                        .filter(opt => selectedIds.includes(opt.id))
                        .map(opt => opt.label)
                      // 有自定义文本时，用自定义文本作为消息内容
                      const response = customText || selectedLabels.join(', ')
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



ChatMessage.displayName = 'ChatMessage'

export default ChatMessage
