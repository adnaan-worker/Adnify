/**
 * 聊天消息组件
 * Cursor 风格：完全扁平化，无气泡，沉浸式体验
 */

import { useState, useCallback, useEffect } from 'react'
import { User, Copy, Check, RefreshCw, Edit2, RotateCcw } from 'lucide-react'
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
} from '../../agent/core/types'
import FileChangeCard from './FileChangeCard'
import ToolCallCard from './ToolCallCard'
import { WRITE_TOOLS } from '../../agent/core/ToolExecutor'
import { getEditorConfig } from '../../config/editorConfig'

interface ChatMessageProps {
  message: ChatMessageType
  onEdit?: (messageId: string, newContent: string) => void
  onRegenerate?: (messageId: string) => void
  onRestore?: (messageId: string) => void
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  pendingToolId?: string
  hasCheckpoint?: boolean
}

// 代码块组件 - 更加精致的玻璃质感
const CodeBlock = ({ language, children, fontSize }: { language: string | undefined; children: React.ReactNode; fontSize: number }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    const text = String(children).replace(/\n$/, '')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [children])

  return (
    <div className="relative group/code my-3 rounded-lg overflow-hidden border border-white/5 bg-black/30 backdrop-blur-sm shadow-sm">
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/5">
        <span className="text-[10px] text-text-muted font-mono uppercase tracking-wider opacity-70">
          {language || 'text'}
        </span>
        <button
          onClick={handleCopy}
          className="p-1 rounded-md hover:bg-white/10 text-text-muted hover:text-text-primary transition-colors"
          title="Copy code"
        >
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      <SyntaxHighlighter
        style={vscDarkPlus}
        language={language}
        PreTag="div"
        className="!bg-transparent !p-3 !m-0 custom-scrollbar leading-relaxed font-mono"
        customStyle={{ background: 'transparent', margin: 0, fontSize: `${fontSize}px` }}
        wrapLines
        wrapLongLines
      >
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    </div>
  )
}

// Markdown 渲染组件 - 优化排版
const MarkdownContent = ({ content, fontSize }: { content: string; fontSize: number }) => (
  <div style={{ fontSize: `${fontSize}px` }} className="text-text-primary/90 leading-7">
    <ReactMarkdown
      className="prose prose-invert max-w-none"
      components={{
        code({ className, children, node, ...props }) {
          const match = /language-(\w+)/.exec(className || '')
          const codeContent = String(children)
          const isCodeBlock = match || node?.position?.start?.line !== node?.position?.end?.line
          const isInline = !isCodeBlock && !codeContent.includes('\n')

          return isInline ? (
            <code className="bg-white/10 px-1.5 py-0.5 rounded text-accent-light font-mono text-[0.9em]" {...props}>
              {children}
            </code>
          ) : (
            <CodeBlock language={match?.[1]} fontSize={fontSize}>{children}</CodeBlock>
          )
        },
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
        li: ({ children }) => <li className="">{children}</li>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" className="text-accent hover:underline decoration-accent/50 underline-offset-2">{children}</a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-accent/40 pl-4 my-2 text-text-muted italic bg-white/5 py-1 rounded-r">{children}</blockquote>
        ),
        h1: ({ children }) => <h1 className="text-lg font-bold mb-2 mt-4 first:mt-0 text-text-primary">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-bold mb-2 mt-3 first:mt-0 text-text-primary">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-2 first:mt-0 text-text-primary">{children}</h3>,
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
)

// 渲染单个 Part
const RenderPart = ({
  part,
  index,
  pendingToolId,
  onApproveTool,
  onRejectTool,
  onOpenDiff,
  fontSize,
}: {
  part: AssistantPart
  index: number
  pendingToolId?: string
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  fontSize: number
}) => {
  if (isTextPart(part)) {
    if (!part.content.trim()) return null
    return <MarkdownContent key={`text-${index}`} content={part.content} fontSize={fontSize} />
  }

  if (isToolCallPart(part)) {
    const tc = part.toolCall
    const isFileOp = WRITE_TOOLS.includes(tc.name)
    const isPending = tc.id === pendingToolId

    if (isFileOp) {
      return (
        <div className="my-2">
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

    return (
      <div className="my-2">
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
}

export default function ChatMessage({
  message,
  onEdit,
  onRegenerate,
  onRestore,
  onApproveTool,
  onRejectTool,
  onOpenDiff,
  pendingToolId,
  hasCheckpoint,
}: ChatMessageProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [copied, setCopied] = useState(false)
  const [fontSize, setFontSize] = useState(14)

  useEffect(() => {
    const config = getEditorConfig()
    setFontSize(config.fontSize)
  }, [])

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
    <div className={`w-full px-4 py-4 group transition-colors duration-200 ${isUser ? 'bg-transparent' : 'bg-transparent'}`}>
      <div className="flex gap-4 max-w-3xl mx-auto">
        {/* Avatar */}
        <div className="flex-shrink-0 pt-0.5">
          {isUser ? (
            <div className="w-7 h-7 rounded-full bg-surface-active/50 border border-white/10 flex items-center justify-center shadow-sm">
              <User className="w-3.5 h-3.5 text-text-secondary" />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full overflow-hidden border border-accent/20 shadow-sm shadow-accent/10">
              <img src={aiAvatar} alt="AI" className="w-full h-full object-cover" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {/* Images */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-3 mb-2">
              {images.map((img, i) => (
                <div key={i} className="rounded-lg overflow-hidden border border-white/10 shadow-sm max-w-[200px]">
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
            <div className="space-y-3 bg-surface/40 p-3 rounded-xl border border-white/10 backdrop-blur-sm">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-sm text-text-primary resize-none focus:outline-none focus:border-accent/50 transition-colors"
                rows={4}
                autoFocus
                style={{ fontSize: `${fontSize}px` }}
              />
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-3 py-1.5 bg-accent text-white text-xs font-medium rounded-md hover:bg-accent-hover transition-colors shadow-sm shadow-accent/20"
                >
                  Save & Resend
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {/* User message */}
              {isUser && <MarkdownContent content={textContent} fontSize={fontSize} />}

              {/* Assistant message */}
              {isAssistantMessage(message) && message.parts && message.parts.length > 0 && (
                <>
                  {message.parts.map((part, index) => (
                    <RenderPart
                      key={`part-${index}`}
                      part={part}
                      index={index}
                      pendingToolId={pendingToolId}
                      onApproveTool={onApproveTool}
                      onRejectTool={onRejectTool}
                      onOpenDiff={onOpenDiff}
                      fontSize={fontSize}
                    />
                  ))}
                </>
              )}

              {/* Legacy compatibility */}
              {isAssistantMessage(message) && (!message.parts || message.parts.length === 0) && (
                <>
                  {textContent && <MarkdownContent content={textContent} fontSize={fontSize} />}
                  {message.toolCalls && message.toolCalls.length > 0 && (
                    <div className="space-y-2 mt-3">
                      {message.toolCalls.map((tc, index) => {
                        const isFileOp = WRITE_TOOLS.includes(tc.name)
                        const isPending = tc.id === pendingToolId

                        if (isFileOp) {
                          return (
                            <FileChangeCard
                              key={`tool-${tc.id}-${index}`}
                              toolCall={tc}
                              isAwaitingApproval={isPending}
                              onApprove={isPending ? onApproveTool : undefined}
                              onReject={isPending ? onRejectTool : undefined}
                              onOpenInEditor={onOpenDiff}
                            />
                          )
                        }

                        return (
                          <ToolCallCard
                            key={`tool-${tc.id}-${index}`}
                            toolCall={tc}
                            isAwaitingApproval={isPending}
                            onApprove={isPending ? onApproveTool : undefined}
                            onReject={isPending ? onRejectTool : undefined}
                          />
                        )
                      })}
                    </div>
                  )}
                </>
              )}

              {/* Streaming cursor */}
              {isAssistantMessage(message) && message.isStreaming && (
                <span className="inline-block w-1.5 h-4 bg-accent ml-1 animate-pulse rounded-full align-middle" />
              )}

              {/* Actions - Subtle and minimal */}
              {!(isAssistantMessage(message) && message.isStreaming) && (
                <div className="flex items-center gap-3 mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  {isUser && onEdit && (
                    <button
                      onClick={handleStartEdit}
                      className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text-primary transition-colors"
                    >
                      <Edit2 className="w-3 h-3" />
                      Edit
                    </button>
                  )}
                  {!isUser && onRegenerate && (
                    <button
                      onClick={() => onRegenerate(message.id)}
                      className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text-primary transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Regenerate
                    </button>
                  )}
                  {isUser && hasCheckpoint && onRestore && (
                    <button
                      onClick={() => onRestore(message.id)}
                      className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-amber-400 transition-colors"
                      title="Restore to this point"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Restore
                    </button>
                  )}
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text-primary transition-colors"
                  >
                    {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                    Copy
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
