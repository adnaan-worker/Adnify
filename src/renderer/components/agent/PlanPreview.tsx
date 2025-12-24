import { Play, RotateCcw, CheckCircle2, Circle, Clock, AlertCircle } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Button } from '../ui'
import { useAgent } from '@/renderer/hooks/useAgent'
import { useStore } from '@/renderer/store'
import React from 'react'

interface PlanPreviewProps {
    content: string
    fontSize?: number
    filePath: string
}

// 辅助函数：递归提取文本内容
function extractText(node: any): string {
    if (!node) return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(extractText).join('')
    if (React.isValidElement(node)) {
        // 特殊处理 react-markdown 可能生成的任务列表复选框
        const props = node.props as any
        if (props.type === 'checkbox') {
            return props.checked ? '[x]' : '[ ]'
        }
        return extractText(props.children)
    }
    return ''
}

export function PlanPreview({ content, fontSize = 14 }: PlanPreviewProps) {
    const { sendMessage } = useAgent()
    const { language } = useStore()

    const handleExecuteStep = (title: string) => {
        const prompt = language === 'zh'
            ? `请执行计划步骤：${title}`
            : `Please execute plan step: ${title}`
        sendMessage(prompt)
    }

    return (
        <div
            className="absolute inset-0 overflow-y-auto p-6 bg-background custom-scrollbar"
            style={{ fontSize: `${fontSize}px` }}
        >
            <div className="max-w-3xl mx-auto prose prose-invert">
                <ReactMarkdown
                    components={{
                        code({ className, children, ...props }) {
                            const match = /language-(\w+)/.exec(className || '')
                            const codeContent = String(children)
                            const isInline = !match && !codeContent.includes('\n')

                            return isInline ? (
                                <code className="bg-white/10 px-1.5 py-0.5 rounded text-accent-light font-mono text-[0.9em]" {...props}>
                                    {children}
                                </code>
                            ) : (
                                <SyntaxHighlighter
                                    style={vscDarkPlus}
                                    language={match?.[1] || 'text'}
                                    PreTag="div"
                                    className="!bg-surface/50 !rounded-lg !border !border-white/10 !my-4"
                                    customStyle={{ fontSize: `${fontSize}px` }}
                                >
                                    {String(children).replace(/\n$/, '')}
                                </SyntaxHighlighter>
                            )
                        },
                        li: ({ children }) => {
                            const text = extractText(children).trim()
                            // 更加宽松的正则：匹配 [ ] 或 [x] 等，后面跟着可选的图标，再跟着可选的 [id: xxx]，最后是标题
                            // 格式示例: [ ] ⬜ [id: 91ceb9a5] 优化HTML结构
                            const match = /^\[( |x|\/|!)\]\s*(?:✅|🔄|❌|⬜)?\s*(?:\[id: ([a-f0-9]+)\])?\s*(.*)/i.exec(text)

                            if (match) {
                                const [_, checkbox, _id, title] = match
                                const isCompleted = checkbox.toLowerCase() === 'x'
                                const isInProgress = checkbox === '/'
                                const isFailed = checkbox === '!'

                                return (
                                    <li className="flex items-center gap-3 group py-1 list-none">
                                        <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                                            {isCompleted ? <CheckCircle2 className="w-4 h-4 text-green-500" /> :
                                                isInProgress ? <Clock className="w-4 h-4 text-blue-400 animate-spin-slow" /> :
                                                    isFailed ? <AlertCircle className="w-4 h-4 text-red-500" /> :
                                                        <Circle className="w-4 h-4 text-text-muted" />}
                                        </span>
                                        <span className={`flex-1 ${isCompleted ? 'text-text-muted line-through' : 'text-text-primary'}`}>
                                            {title}
                                        </span>
                                        {!isInProgress && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleExecuteStep(title)}
                                                className="h-7 px-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs gap-1.5 text-accent hover:bg-accent/10"
                                            >
                                                {isCompleted ? (
                                                    <>
                                                        <RotateCcw className="w-3 h-3" />
                                                        {language === 'zh' ? '重新执行' : 'Re-run'}
                                                    </>
                                                ) : (
                                                    <>
                                                        <Play className="w-3 h-3" />
                                                        {language === 'zh' ? '执行' : 'Run'}
                                                    </>
                                                )}
                                            </Button>
                                        )}
                                    </li>
                                )
                            }
                            return <li className="leading-relaxed">{children}</li>
                        },
                        h1: ({ children }) => <h1 className="text-2xl font-bold mt-8 mb-4 text-text-primary border-b border-white/10 pb-2">{children}</h1>,
                        h2: ({ children }) => <h2 className="text-xl font-bold mt-6 mb-3 text-text-primary">{children}</h2>,
                        h3: ({ children }) => <h3 className="text-lg font-semibold mt-4 mb-2 text-text-primary">{children}</h3>,
                        p: ({ children }) => <p className="mb-4 text-text-secondary leading-relaxed">{children}</p>,
                        ul: ({ children }) => <ul className="list-none pl-0 mb-4 space-y-1 text-text-secondary">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-6 mb-4 space-y-1 text-text-secondary">{children}</ol>,
                        blockquote: ({ children }) => (
                            <blockquote className="border-l-4 border-accent/50 pl-4 my-4 text-text-muted italic bg-white/5 py-2 rounded-r">
                                {children}
                            </blockquote>
                        ),
                        hr: () => <hr className="border-white/10 my-6" />,
                    }}
                >
                    {content}
                </ReactMarkdown>
            </div>
        </div>
    )
}
