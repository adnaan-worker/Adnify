/**
 * 文件预览组件
 * 支持 Markdown 预览、图片显示、不支持文件类型提示
 */
import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useState, useCallback, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Eye, Edit, FileQuestion, Image as ImageIcon, AlertTriangle, Columns } from 'lucide-react'
import { Button } from '../ui'
import { getFileName } from '@shared/utils/pathUtils'

// 文件类型分类
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']
const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdx']
const BINARY_EXTENSIONS = ['exe', 'dll', 'so', 'dylib', 'bin', 'zip', 'tar', 'gz', 'rar', '7z', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'mp3', 'mp4', 'avi', 'mov', 'wav', 'flac', 'psd', 'ai', 'sketch']

export type FileType = 'text' | 'markdown' | 'image' | 'binary' | 'unknown'

export function getFileType(path: string): FileType {
    const ext = path.split('.').pop()?.toLowerCase() || ''

    if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
    if (MARKDOWN_EXTENSIONS.includes(ext)) return 'markdown'
    if (BINARY_EXTENSIONS.includes(ext)) return 'binary'

    return 'text'
}

export function isPreviewableFile(path: string): boolean {
    const type = getFileType(path)
    return type === 'markdown' || type === 'image'
}

export function isBinaryFile(path: string): boolean {
    return getFileType(path) === 'binary'
}

export function isPlanFile(path: string): boolean {
    const normalizedPath = path.replace(/\\/g, '/')
    return normalizedPath.includes('.adnify/plans/') && normalizedPath.endsWith('.json')
}

// ===== Markdown 预览组件 =====

interface MarkdownPreviewProps {
    content: string
    fontSize?: number
}

export function MarkdownPreview({ content, fontSize = 14 }: MarkdownPreviewProps) {
    return (
        <div
            className="absolute inset-0 overflow-y-auto p-6 bg-background custom-scrollbar"
            style={{ fontSize: `${fontSize}px` }}
        >
            <div className="max-w-3xl mx-auto prose prose-invert">
                <ReactMarkdown
                    components={{
                        code({ className, children, node, ...props }) {
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
                                    className="!bg-surface/50 !rounded-lg !border !border-border !my-4"
                                    customStyle={{ fontSize: `${fontSize}px` }}
                                >
                                    {String(children).replace(/\n$/, '')}
                                </SyntaxHighlighter>
                            )
                        },
                        h1: ({ children }) => <h1 className="text-2xl font-bold mt-8 mb-4 text-text-primary border-b border-border pb-2">{children}</h1>,
                        h2: ({ children }) => <h2 className="text-xl font-bold mt-6 mb-3 text-text-primary">{children}</h2>,
                        h3: ({ children }) => <h3 className="text-lg font-semibold mt-4 mb-2 text-text-primary">{children}</h3>,
                        p: ({ children }) => <p className="mb-4 text-text-secondary leading-relaxed">{children}</p>,
                        ul: ({ children }) => <ul className="list-disc pl-6 mb-4 space-y-1 text-text-secondary">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-6 mb-4 space-y-1 text-text-secondary">{children}</ol>,
                        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                        a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                                {children}
                            </a>
                        ),
                        blockquote: ({ children }) => (
                            <blockquote className="border-l-4 border-accent/50 pl-4 my-4 text-text-muted italic bg-white/5 py-2 rounded-r">
                                {children}
                            </blockquote>
                        ),
                        table: ({ children }) => (
                            <div className="overflow-x-auto my-4">
                                <table className="min-w-full border-collapse border border-border">{children}</table>
                            </div>
                        ),
                        th: ({ children }) => <th className="border border-border px-4 py-2 bg-surface/50 text-left font-semibold">{children}</th>,
                        td: ({ children }) => <td className="border border-border px-4 py-2">{children}</td>,
                        img: ({ src, alt }) => (
                            <img src={src} alt={alt} className="max-w-full rounded-lg border border-border my-4" />
                        ),
                        hr: () => <hr className="border-border my-6" />,
                    }}
                >
                    {content}
                </ReactMarkdown>
            </div>
        </div>
    )
}

// ===== 图片预览组件 =====

interface ImagePreviewProps {
    path: string
}

export function ImagePreview({ path }: ImagePreviewProps) {
    const [error, setError] = useState(false)
    const [zoom, setZoom] = useState(1)
    const [imageSrc, setImageSrc] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)

    // 使用 Electron API 读取图片为 base64
    useEffect(() => {
        const loadImage = async () => {
            try {
                setLoading(true)
                // 读取文件为 base64 (已经是 base64 编码)
                const base64 = await api.file.readBinary(path)
                if (base64) {
                    // 检测图片类型
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
                    setImageSrc(`data:${mimeType};base64,${base64}`)
                } else {
                    setError(true)
                }
            } catch (e) {
                logger.file.error('Failed to load image:', e)
                setError(true)
            } finally {
                setLoading(false)
            }
        }
        loadImage()
    }, [path])

    if (error) {
        return (
            <div className="h-full flex items-center justify-center bg-background">
                <div className="text-center p-8">
                    <AlertTriangle className="w-12 h-12 text-warning mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-text-primary mb-2">无法加载图片</h3>
                    <p className="text-sm text-text-muted">{path}</p>
                </div>
            </div>
        )
    }

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center bg-background">
                <div className="text-text-muted">加载中...</div>
            </div>
        )
    }

    return (
        <div className="h-full flex flex-col bg-[#1a1a1a]">
            {/* 工具栏 */}
            <div className="flex-shrink-0 flex items-center justify-center gap-2 p-2 border-b border-border bg-surface/50">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setZoom(z => Math.max(0.1, z - 0.25))}
                    className="h-7 px-2 text-xs"
                >
                    −
                </Button>
                <span className="text-xs text-text-muted w-16 text-center">{Math.round(zoom * 100)}%</span>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setZoom(z => Math.min(5, z + 0.25))}
                    className="h-7 px-2 text-xs"
                >
                    +
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setZoom(1)}
                    className="h-7 px-2 text-xs"
                >
                    100%
                </Button>
            </div>

            {/* 图片显示 */}
            <div className="flex-1 overflow-auto flex items-center justify-center p-4 custom-scrollbar">
                {imageSrc && (
                    <img
                        src={imageSrc}
                        alt={getFileName(path)}
                        className="max-w-none transition-transform"
                        style={{ transform: `scale(${zoom})` }}
                        onError={() => setError(true)}
                    />
                )}
            </div>
        </div>
    )
}

// ===== 不支持文件提示组件 =====

interface UnsupportedFileProps {
    path: string
    fileType: 'binary' | 'unknown'
}

export function UnsupportedFile({ path, fileType }: UnsupportedFileProps) {
    const ext = path.split('.').pop()?.toLowerCase() || ''
    const fileName = getFileName(path)

    const handleOpenExternal = useCallback(() => {
        // 使用 shell:openPath IPC 打开文件
        ; (window.electronAPI as any).openPath?.(path) ||
            api.shell.executeSecure?.({ command: 'start', args: ['""', path], cwd: '.' })
    }, [path])

    return (
        <div className="h-full flex items-center justify-center bg-background">
            <div className="text-center p-8 max-w-md">
                <div className="w-16 h-16 rounded-2xl bg-surface/50 border border-border flex items-center justify-center mx-auto mb-6">
                    {fileType === 'binary' ? (
                        <FileQuestion className="w-8 h-8 text-text-muted" />
                    ) : (
                        <AlertTriangle className="w-8 h-8 text-warning" />
                    )}
                </div>

                <h3 className="text-lg font-medium text-text-primary mb-2">
                    无法在编辑器中打开此文件
                </h3>

                <p className="text-sm text-text-muted mb-6">
                    {fileType === 'binary'
                        ? `"${fileName}" 是二进制文件（.${ext}），无法作为文本编辑。`
                        : `不支持打开 .${ext} 格式的文件。`
                    }
                </p>

                <Button
                    variant="secondary"
                    onClick={handleOpenExternal}
                    className="gap-2"
                >
                    <ImageIcon className="w-4 h-4" />
                    使用默认程序打开
                </Button>
            </div>
        </div>
    )
}

// ===== Markdown 编辑器工具栏 =====

interface MarkdownToolbarProps {
    mode: 'edit' | 'preview' | 'split'
    onModeChange: (mode: 'edit' | 'preview' | 'split') => void
    isPlan?: boolean
}

export function MarkdownToolbar({ mode, onModeChange, isPlan }: MarkdownToolbarProps) {
    return (
        <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-surface/30">
            {!isPlan && (
                <>
                    <Button
                        variant={mode === 'edit' ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => onModeChange('edit')}
                        className="h-6 px-2 text-xs gap-1"
                        title="编辑模式"
                    >
                        <Edit className="w-3 h-3" />
                        编辑
                    </Button>
                    <Button
                        variant={mode === 'split' ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => onModeChange('split')}
                        className="h-6 px-2 text-xs gap-1"
                        title="分屏模式"
                    >
                        <Columns className="w-3 h-3" />
                        分屏
                    </Button>
                </>
            )}
            <Button
                variant={mode === 'preview' || isPlan ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => onModeChange('preview')}
                className="h-6 px-2 text-xs gap-1"
                title="预览模式"
                disabled={isPlan}
            >
                <Eye className="w-3 h-3" />
                预览
            </Button>
        </div>
    )
}
