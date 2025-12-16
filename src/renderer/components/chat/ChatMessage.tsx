/**
 * 聊天消息组件
 * 显示单条用户或 AI 消息
 */
import { useState, useCallback } from 'react'
import { User, Copy, Check, RefreshCw, Edit2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useStore } from '../../store'
import { t } from '../../i18n'
import { getEditorConfig } from '../../config/editorConfig'
import aiAvatar from '../../assets/icon/ai-avatar.gif'
import { ChatMessage as ChatMessageType, isUserMessage, isAssistantMessage, InlineToolCall, getMessageText, MessageContent, ImageContent } from '../../agent/types/chatTypes'
import ToolCallDisplay from './ToolCallDisplay'

// Re-export getMessageText for compatibility
export { getMessageText } from '../../agent/types/chatTypes'

/**
 * 提取消息中的图片
 */
export function getMessageImages(content: MessageContent) {
  if (Array.isArray(content)) {
    return content.filter((c): c is ImageContent => c.type === 'image')
  }
  return []
}

interface ChatMessageProps {
  message: ChatMessageType
  onEdit?: (messageId: string, newContent: string) => void
  onRegenerate?: (messageId: string) => void
  onApproveTool?: () => void
  onRejectTool?: () => void
  onFileClick?: (path: string) => void
  isAwaitingApproval?: boolean
}

// 代码块组件，包含复制功能
const CodeBlock = ({ language, children, fontSize }: { language: string | undefined, children: React.ReactNode, fontSize: number }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    const text = String(children).replace(/\n$/, '')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [children])

  return (
    <div className="relative group/code my-4 rounded-xl overflow-hidden border border-border-subtle bg-[#0a0a0b]/50 backdrop-blur-sm shadow-sm transition-all hover:border-border-highlight">
      <div className="flex items-center justify-between px-3 py-2 bg-black/20 border-b border-white/5">
        <span className="text-[10px] text-text-muted font-mono uppercase tracking-wider">
          {language || 'text'}
        </span>
        <button
          onClick={handleCopy}
          className="p-1 rounded-md hover:bg-surface-active text-text-muted hover:text-text-primary transition-all duration-200"
          title="Copy code"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <SyntaxHighlighter
        style={vscDarkPlus}
        language={language}
        PreTag="div"
        className="!bg-transparent !p-4 !m-0 custom-scrollbar"
        customStyle={{ background: 'transparent', margin: 0, fontSize: fontSize - 1 }}
        wrapLines={true}
        wrapLongLines={true}
      >
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    </div>
  )
}

export default function ChatMessage({
  message,
  onEdit,
  onRegenerate,
  onApproveTool,
  onRejectTool,
  onFileClick,
  isAwaitingApproval
}: ChatMessageProps) {
  const isUser = isUserMessage(message)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const { language } = useStore()
  const editorConfig = getEditorConfig()
  const fontSize = Math.max(12, editorConfig.fontSize - 2)

  // 工具消息、Checkpoint 和中断的消息不在此处渲染
  if (message.role === 'tool' || message.role === 'checkpoint' || message.role === 'interrupted_streaming_tool') {
    return null
  }

  const textContent = getMessageText(message.content)
  // images 提取
  const images = isUser && Array.isArray(message.content) 
    ? getMessageImages(message.content)
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
    <div className={`w-full px-5 py-2 group transition-all duration-300 ${isUser ? 'bg-transparent' : 'bg-surface/10'}`}>
      <div className="flex gap-4 max-w-4xl mx-auto">
        {/* Avatar */}
        <div className="flex-shrink-0 mt-0.5">
          {isUser ? (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-surface-active to-surface border border-border-subtle flex items-center justify-center text-text-secondary shadow-sm">
              <User className="w-4 h-4" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-full overflow-hidden shadow-glow border border-accent/20">
              <img src={aiAvatar} alt="Adnify" className="w-full h-full object-cover" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 overflow-hidden relative pt-1">
          <div className="absolute right-0 top-0 text-[10px] text-text-muted opacity-0 group-hover:opacity-50 transition-opacity">
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>

          {/* Images */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {images.map((img: any, i) => (
                <div
                  key={i}
                  className="rounded-lg overflow-hidden border border-border-subtle max-w-[200px] shadow-sm hover:shadow-md transition-shadow"
                >
                  <img
                    src={
                      img.source.type === 'base64'
                        ? `data:${img.source.media_type};base64,${img.source.data}`
                        : img.source.data
                    }
                    alt="User upload"
                    className="max-w-full h-auto object-cover"
                  />
                </div>
              ))}
            </div>
          )}

          {isEditing ? (
            <div className="space-y-3 bg-surface/30 p-3 rounded-xl border border-border-subtle backdrop-blur-sm">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full bg-background/50 border border-border-subtle rounded-lg px-3 py-2 text-text-primary resize-none focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all"
                style={{ fontSize }}
                rows={4}
                autoFocus
              />
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-primary hover:bg-surface-active rounded-md transition-colors"
                >
                  {t('cancel', language)}
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-3 py-1.5 bg-accent text-white text-xs font-medium rounded-md hover:bg-accent-hover shadow-lg shadow-accent/20 transition-all"
                >
                  {t('saveAndResend', language)}
                </button>
              </div>
            </div>
          ) : (
            <div className="relative">
              <ReactMarkdown
                className="prose prose-invert max-w-none break-words leading-relaxed text-text-primary/90"
                components={{
                  code({ className, children, node, ...props }) {
                    const match = /language-(\w+)/.exec(className || '')
                    const content = String(children)
                    const isCodeBlock =
                      match || node?.position?.start?.line !== node?.position?.end?.line
                    const isInline = !isCodeBlock && !content.includes('\n')

                    return isInline ? (
                      <code
                        className="bg-surface-active/80 px-1.5 py-0.5 rounded text-accent font-mono text-[0.9em] border border-border-subtle/50"
                        {...props}
                      >
                        {children}
                      </code>
                    ) : (
                      <CodeBlock language={match?.[1]} fontSize={fontSize}>
                        {children}
                      </CodeBlock>
                    )
                  },
                  p: ({ children }) => (
                    <p className="mb-3 last:mb-0" style={{ fontSize }}>
                      {children}
                    </p>
                  ),
                  ul: ({ children }) => (
                    <ul
                      className="list-disc pl-5 mb-3 space-y-1 marker:text-accent/70"
                      style={{ fontSize }}
                    >
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol
                      className="list-decimal pl-5 mb-3 space-y-1 marker:text-accent/70"
                      style={{ fontSize }}
                    >
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => <li style={{ fontSize }}>{children}</li>,
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      target="_blank"
                      className="text-accent hover:text-accent-hover hover:underline transition-colors underline-offset-4 decoration-accent/30"
                    >
                      {children}
                    </a>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-4 border-accent/40 bg-surface/20 pl-4 py-2 my-3 rounded-r-lg text-text-muted italic">
                      {children}
                    </blockquote>
                  ),
                  h1: ({ children }) => (
                    <h1 className="text-xl font-bold mb-3 mt-6 first:mt-0 text-text-primary tracking-tight border-b border-border-subtle pb-2">{children}</h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-lg font-bold mb-3 mt-5 first:mt-0 text-text-primary tracking-tight">{children}</h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-base font-semibold mb-2 mt-4 first:mt-0 text-text-primary">{children}</h3>
                  ),
                  table: ({ children }) => (
                    <div className="overflow-x-auto my-4 rounded-lg border border-border-subtle">
                      <table className="min-w-full divide-y divide-border-subtle bg-surface/20">
                        {children}
                      </table>
                    </div>
                  ),
                  th: ({ children }) => (
                    <th className="px-4 py-2 text-left text-xs font-medium text-text-secondary uppercase tracking-wider bg-surface-active/50">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="px-4 py-2 text-sm text-text-muted border-t border-border-subtle/50">
                      {children}
                    </td>
                  ),
                }}
              >
                {textContent}
              </ReactMarkdown>
              
              {/* Tool Calls */}
              {isAssistantMessage(message) && message.toolCalls && message.toolCalls.length > 0 && (
                <div className="space-y-3 mt-4">
                  {message.toolCalls.map((tc: InlineToolCall) => {
                    // 转换状态：保持 tool_request 以显示审批按钮
                    const displayStatus: 'success' | 'error' | 'running' | 'tool_request' | 'pending' = 
                      tc.status === 'success' 
                        ? 'success' 
                        : tc.status === 'tool_error' 
                          ? 'error' 
                          : tc.status === 'running_now' 
                            ? 'running' 
                            : tc.status === 'tool_request'
                              ? 'tool_request'
                              : 'pending'
                    
                    return (
                      <ToolCallDisplay
                        key={tc.id}
                        toolCall={{
                          id: tc.id,
                          name: tc.name,
                          arguments: tc.rawParams,
                          status: displayStatus,
                          result: tc.result,
                          error: tc.error,
                        }}
                        onApprove={tc.status === 'tool_request' && isAwaitingApproval ? onApproveTool : undefined}
                        onReject={tc.status === 'tool_request' && isAwaitingApproval ? onRejectTool : undefined}
                        onFileClick={onFileClick}
                      />
                    )
                  })}
                </div>
              )}

              {isAssistantMessage(message) && message.isStreaming && (
                <span className="inline-block w-0.5 h-4 bg-text-primary/70 align-middle ml-0.5 animate-pulse rounded-full" />
              )}

              {/* Message Actions */}
              {!(isAssistantMessage(message) && message.isStreaming) && !isEditing && (
                <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-all duration-200">
                  {isUser && onEdit && (
                    <button
                      onClick={handleStartEdit}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-text-muted hover:text-text-primary hover:bg-surface-active transition-colors"
                    >
                      <Edit2 className="w-3 h-3" />
                      Edit
                    </button>
                  )}
                  {!isUser && onRegenerate && (
                    <button
                      onClick={() => onRegenerate(message.id)}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-text-muted hover:text-text-primary hover:bg-surface-active transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Regenerate
                    </button>
                  )}
                  <button
                    onClick={() => {
                       navigator.clipboard.writeText(textContent)
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-text-muted hover:text-text-primary hover:bg-surface-active transition-colors"
                  >
                    <Copy className="w-3 h-3" />
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