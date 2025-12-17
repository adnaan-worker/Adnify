/**
 * 聊天消息组件
 * Cursor 风格：文字和工具调用内联显示
 */

import { useState, useCallback } from 'react'
import { User, Copy, Check, RefreshCw, Edit2 } from 'lucide-react'
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

interface ChatMessageProps {
  message: ChatMessageType
  onEdit?: (messageId: string, newContent: string) => void
  onRegenerate?: (messageId: string) => void
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  pendingToolId?: string
}

// 代码块组件
const CodeBlock = ({ language, children }: { language: string | undefined; children: React.ReactNode }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    const text = String(children).replace(/\n$/, '')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [children])

  return (
    <div className="relative group/code my-3 rounded-lg overflow-hidden border border-border-subtle bg-[#0a0a0b]/50">
      <div className="flex items-center justify-between px-3 py-1.5 bg-black/20 border-b border-white/5">
        <span className="text-[10px] text-text-muted font-mono uppercase tracking-wider">
          {language || 'text'}
        </span>
        <button
          onClick={handleCopy}
          className="p-1 rounded hover:bg-surface-active text-text-muted hover:text-text-primary transition-colors"
          title="Copy code"
        >
          {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      <SyntaxHighlighter
        style={vscDarkPlus}
        language={language}
        PreTag="div"
        className="!bg-transparent !p-3 !m-0 custom-scrollbar text-[13px]"
        customStyle={{ background: 'transparent', margin: 0 }}
        wrapLines
        wrapLongLines
      >
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    </div>
  )
}

// Markdown 渲染组件
const MarkdownContent = ({ content }: { content: string }) => (
  <ReactMarkdown
    className="prose prose-invert prose-sm max-w-none text-text-primary/90"
    components={{
      code({ className, children, node, ...props }) {
        const match = /language-(\w+)/.exec(className || '')
        const codeContent = String(children)
        const isCodeBlock = match || node?.position?.start?.line !== node?.position?.end?.line
        const isInline = !isCodeBlock && !codeContent.includes('\n')

        return isInline ? (
          <code className="bg-surface-active/80 px-1.5 py-0.5 rounded text-accent font-mono text-[0.9em]" {...props}>
            {children}
          </code>
        ) : (
          <CodeBlock language={match?.[1]}>{children}</CodeBlock>
        )
      },
      p: ({ children }) => <p className="mb-2 last:mb-0 text-sm leading-relaxed">{children}</p>,
      ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1 text-sm">{children}</ul>,
      ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1 text-sm">{children}</ol>,
      li: ({ children }) => <li className="text-sm">{children}</li>,
      a: ({ href, children }) => (
        <a href={href} target="_blank" className="text-accent hover:underline">{children}</a>
      ),
      blockquote: ({ children }) => (
        <blockquote className="border-l-2 border-accent/40 pl-3 my-2 text-text-muted italic">{children}</blockquote>
      ),
      h1: ({ children }) => <h1 className="text-lg font-bold mb-2 mt-4 first:mt-0">{children}</h1>,
      h2: ({ children }) => <h2 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h2>,
      h3: ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-2 first:mt-0">{children}</h3>,
    }}
  >
    {content}
  </ReactMarkdown>
)

// 渲染单个 Part
const RenderPart = ({
  part,
  index,
  pendingToolId,
  onApproveTool,
  onRejectTool,
  onOpenDiff,
}: {
  part: AssistantPart
  index: number
  pendingToolId?: string
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
}) => {
  if (isTextPart(part)) {
    if (!part.content.trim()) return null
    return <MarkdownContent key={`text-${index}`} content={part.content} />
  }

  if (isToolCallPart(part)) {
    const tc = part.toolCall
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
  }

  return null
}

export default function ChatMessage({
  message,
  onEdit,
  onRegenerate,
  onApproveTool,
  onRejectTool,
  onOpenDiff,
  pendingToolId,
}: ChatMessageProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [copied, setCopied] = useState(false)

  // 只处理用户和助手消息
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
    <div className={`w-full px-4 py-3 group ${isUser ? 'bg-transparent' : 'bg-surface/10'}`}>
      <div className="flex gap-3 max-w-4xl mx-auto">
        {/* Avatar */}
        <div className="flex-shrink-0 mt-0.5">
          {isUser ? (
            <div className="w-8 h-8 rounded-full bg-surface-active border border-border-subtle flex items-center justify-center">
              <User className="w-4 h-4 text-text-secondary" />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full overflow-hidden border border-accent/20">
              <img src={aiAvatar} alt="AI" className="w-full h-full object-cover" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {/* Images */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {images.map((img, i) => (
                <div key={i} className="rounded-lg overflow-hidden border border-border-subtle max-w-[180px]">
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
            <div className="space-y-2 bg-surface/30 p-3 rounded-lg border border-border-subtle">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full bg-background/50 border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary resize-none focus:outline-none focus:border-accent"
                rows={4}
                autoFocus
              />
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-3 py-1 text-xs text-text-muted hover:text-text-primary rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-3 py-1 bg-accent text-white text-xs font-medium rounded hover:bg-accent-hover transition-colors"
                >
                  Save & Resend
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* User message: 直接渲染文本 */}
              {isUser && <MarkdownContent content={textContent} />}

              {/* Assistant message: 按 parts 顺序渲染（文字和工具调用交错） */}
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
                    />
                  ))}
                </>
              )}

              {/* 兼容：如果没有 parts，使用旧的渲染方式 */}
              {isAssistantMessage(message) && (!message.parts || message.parts.length === 0) && (
                <>
                  {textContent && <MarkdownContent content={textContent} />}
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
                <span className="inline-block w-0.5 h-4 bg-text-primary/70 ml-0.5 animate-pulse rounded-full" />
              )}

              {/* Actions */}
              {!(isAssistantMessage(message) && message.isStreaming) && (
                <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {isUser && onEdit && (
                    <button
                      onClick={handleStartEdit}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs text-text-muted hover:text-text-primary hover:bg-surface-active transition-colors"
                    >
                      <Edit2 className="w-3 h-3" />
                      Edit
                    </button>
                  )}
                  {!isUser && onRegenerate && (
                    <button
                      onClick={() => onRegenerate(message.id)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs text-text-muted hover:text-text-primary hover:bg-surface-active transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Regenerate
                    </button>
                  )}
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs text-text-muted hover:text-text-primary hover:bg-surface-active transition-colors"
                  >
                    {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
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
