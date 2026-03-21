/**
 * 富内容渲染器 - 深度升级版
 * 统一渲染工具返回的各种内容类型：文本、图片、代码、JSON、Markdown、HTML、文件、链接、表格
 */

import { useState, useMemo, memo } from 'react'
import { createPortal } from 'react-dom'
import {
  Image as ImageIcon, Code, FileText, Link as LinkIcon,
  Table, Copy, Check, ExternalLink, Maximize2, X
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { ToolRichContent } from '@/shared/types'
import { JsonHighlight } from '@utils/jsonHighlight'
import { getFileName } from '@shared/utils/pathUtils'
import { SafeMarkdownHTML, SafeHTML } from '@components/common/SafeHTML'

interface RichContentRendererProps {
  content: ToolRichContent[]
  maxHeight?: string
  className?: string
}

export const RichContentRenderer = memo(function RichContentRenderer({
  content,
  maxHeight = 'max-h-96',
  className = '',
}: RichContentRendererProps) {
  if (!content || content.length === 0) return null

  return (
    <div className={`space-y-3 ${className}`}>
      {content.map((item, index) => (
        <RichContentItem key={`${item.type}-${index}`} item={item} maxHeight={maxHeight} />
      ))}
    </div>
  )
})

const RichContentItem = memo(function RichContentItem({
  item,
  maxHeight,
}: {
  item: ToolRichContent
  maxHeight: string
}) {
  switch (item.type) {
    case 'image':
      return <ImageContent item={item} />
    case 'code':
      return <CodeContent item={item} maxHeight={maxHeight} />
    case 'json':
      return <JsonContent item={item} maxHeight={maxHeight} />
    case 'markdown':
      return <MarkdownContent item={item} maxHeight={maxHeight} />
    case 'html':
      return <HtmlContent item={item} maxHeight={maxHeight} />
    case 'file':
      return <FileContent item={item} />
    case 'link':
      return <LinkContent item={item} />
    case 'table':
      return <TableContent item={item} maxHeight={maxHeight} />
    case 'text':
    default:
      return <TextContent item={item} maxHeight={maxHeight} />
  }
})

// =================== 内部工具：通用容器 ===================
const ContentCard = ({ title, icon: Icon, actions, children, noPadding = false }: { title: string, icon: any, actions?: React.ReactNode, children: React.ReactNode, noPadding?: boolean }) => (
  <div className="mt-2 text-[11px]">
    <div className="flex items-center justify-between gap-1.5 text-text-muted mb-1 group/title">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3 h-3" />
        <span>{title}</span>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover/title:opacity-100 transition-opacity">
        {actions}
      </div>
    </div>
    <div className={`border-l-2 border-border/30 pl-2 ml-1 ${noPadding ? '' : 'py-1'}`}>
      {children}
    </div>
  </div>
)

// =================== 图片内容 ===================
function ImageContent({ item }: { item: ToolRichContent }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const imageSrc = useMemo(() => {
    if (!item.data) return null
    return item.data.startsWith('data:') ? item.data : `data:${item.mimeType || 'image/png'};base64,${item.data}`
  }, [item.data, item.mimeType])

  if (!imageSrc) return null

  const modal = isExpanded ? createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/95 backdrop-blur-lg p-8"
        onClick={() => setIsExpanded(false)}
        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <img
            src={imageSrc}
            alt={item.title || 'Image'}
            className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl"
          />
        </motion.div>
        <button
          onClick={() => setIsExpanded(false)}
          className="absolute top-6 right-6 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition-all z-[100000]"
        >
          <X className="w-5 h-5" />
        </button>
      </motion.div>
    </AnimatePresence>,
    document.body
  ) : null

  return (
    <>
      <ContentCard
        title={item.title || 'Image Preview'}
        icon={ImageIcon}
        noPadding
        actions={
          <>
            <button
              onClick={() => {
                navigator.clipboard.writeText(imageSrc);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="p-1.5 rounded-lg hover:bg-white/10 text-text-muted transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => setIsExpanded(true)}
              className="p-1.5 rounded-lg hover:bg-white/10 text-text-muted transition-colors"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </>
        }
      >
        <div className="flex flex-col group relative mt-1">
          <img
            src={imageSrc}
            alt={item.title || 'Image'}
            className="max-w-full max-h-64 object-contain cursor-zoom-in rounded border border-border/30"
            onClick={() => setIsExpanded(true)}
          />
        </div>
      </ContentCard>
      {modal}
    </>
  )
}

// =================== 代码内容 ===================
function CodeContent({ item, maxHeight }: { item: ToolRichContent; maxHeight: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <ContentCard
      title={item.language || 'Source Code'}
      icon={Code}
      noPadding
      actions={
        <button onClick={() => { navigator.clipboard.writeText(item.text || ''); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="p-0.5 hover:bg-surface-elevated rounded text-text-muted hover:text-text-primary">
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        </button>
      }
    >
      <pre className={`overflow-auto ${maxHeight} text-[11px] font-mono text-text-secondary custom-scrollbar`}>
        <code>{item.text}</code>
      </pre>
    </ContentCard>
  )
}

// =================== 表格内容 ===================
function TableContent({ item, maxHeight }: { item: ToolRichContent; maxHeight: string }) {
  if (!item.tableData) return null
  const { headers, rows } = item.tableData
  return (
    <ContentCard title={`Data Table (${rows.length})`} icon={Table} noPadding>
      <div className={`overflow-auto ${maxHeight} custom-scrollbar rounded border border-border/30`}>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-surface/50 sticky top-0 z-10">
              {headers.map((h, i) => <th key={h || `header-${i}`} className="px-3 py-2 text-left font-bold text-text-primary border-b border-border/50 uppercase tracking-tighter">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-surface/30 transition-colors group">
                {row.map((cell, j) => <td key={j} className="px-3 py-2 text-text-secondary border-b border-border/20 group-last:border-0">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ContentCard>
  )
}

// =================== 文件/链接内容 ===================
function FileContent({ item }: { item: ToolRichContent }) {
  const fileName = item.title || (item.uri ? getFileName(item.uri) : 'File')
  return (
    <div className="flex items-center gap-1.5 text-[11px] group mt-1">
      <FileText className="w-3 h-3 text-text-muted" />
      <span className="font-medium text-text-primary transition-colors cursor-pointer hover:underline" title={item.uri}>{fileName}</span>
      <ExternalLink className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:text-accent" />
    </div>
  )
}

function LinkContent({ item }: { item: ToolRichContent }) {
  return (
    <a href={item.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[11px] group mt-1">
      <LinkIcon className="w-3 h-3 text-text-muted" />
      <span className="font-medium text-text-primary hover:text-accent truncate transition-colors cursor-pointer hover:underline">{item.title || item.url}</span>
      <ExternalLink className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
    </a>
  )
}

// 其余类型保持简洁...
function JsonContent({ item, maxHeight }: { item: ToolRichContent; maxHeight: string }) {
  return (
    <ContentCard title="JSON Data" icon={Code} noPadding>
      <div className={`font-mono text-[11px] ${maxHeight} overflow-auto custom-scrollbar`}>
        <JsonHighlight data={item.text} maxHeight="none" />
      </div>
    </ContentCard>
  )
}

function MarkdownContent({ item, maxHeight }: { item: ToolRichContent; maxHeight: string }) {
  return (
    <ContentCard title="Markdown" icon={FileText} noPadding>
      <div className={`${maxHeight} overflow-auto custom-scrollbar prose prose-invert prose-sm max-w-none text-[12px]`}>
        <SafeMarkdownHTML html={item.text} />
      </div>
    </ContentCard>
  )
}

function HtmlContent({ item, maxHeight }: { item: ToolRichContent; maxHeight: string }) {
  return (
    <ContentCard title="HTML Preview" icon={Code} noPadding>
      <SafeHTML
        html={item.text}
        className={`p-4 bg-white/5 ${maxHeight} overflow-auto custom-scrollbar`}
      />
    </ContentCard>
  )
}

function TextContent({ item, maxHeight }: { item: ToolRichContent; maxHeight: string }) {
  return (
    <div className={`p-4 bg-surface/10 rounded-2xl border border-border text-sm text-text-secondary leading-relaxed ${maxHeight} overflow-auto custom-scrollbar`}>
      {item.text}
    </div>
  )
}

export default RichContentRenderer