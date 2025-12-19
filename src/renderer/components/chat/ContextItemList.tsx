/**
 * 上下文项列表组件
 * 显示当前对话中的所有上下文项，支持移除操作
 */
import { X, FileText, Code, Folder, Database, GitBranch, Terminal, Tag } from 'lucide-react'
import { ContextItem } from '../../agent/core/types'

interface ContextItemListProps {
    items: ContextItem[]
    onRemove: (index: number) => void
}

// 获取上下文类型的图标
function getContextIcon(type: ContextItem['type']) {
    switch (type) {
        case 'File': return FileText
        case 'CodeSelection': return Code
        case 'Folder': return Folder
        case 'Codebase': return Database
        case 'Git': return GitBranch
        case 'Terminal': return Terminal
        case 'Symbols': return Tag
        default: return FileText
    }
}

// 获取上下文类型的标签
function getContextLabel(item: ContextItem): string {
    switch (item.type) {
        case 'File':
        case 'CodeSelection':
            const uri = (item as { uri?: string }).uri || ''
            const parts = uri.replace(/\\/g, '/').split('/')
            return parts[parts.length - 1] || uri
        case 'Folder':
            const folderUri = (item as { uri?: string }).uri || ''
            const folderParts = folderUri.replace(/\\/g, '/').split('/')
            return folderParts[folderParts.length - 1] || 'Folder'
        case 'Codebase':
            return '@codebase'
        case 'Git':
            return '@git'
        case 'Terminal':
            return '@terminal'
        case 'Symbols':
            return '@symbols'
        default:
            return 'Context'
    }
}

// 获取上下文类型的颜色
function getContextColor(type: ContextItem['type']): string {
    switch (type) {
        case 'File': return 'text-blue-400'
        case 'CodeSelection': return 'text-purple-400'
        case 'Folder': return 'text-yellow-400'
        case 'Codebase': return 'text-green-400'
        case 'Git': return 'text-orange-400'
        case 'Terminal': return 'text-cyan-400'
        case 'Symbols': return 'text-pink-400'
        default: return 'text-text-muted'
    }
}

export default function ContextItemList({ items, onRemove }: ContextItemListProps) {
    if (items.length === 0) return null

    return (
        <div className="flex flex-wrap gap-1.5 px-3 py-2 bg-surface/50 border-b border-border-subtle">
            {items.map((item, idx) => {
                const Icon = getContextIcon(item.type)
                const label = getContextLabel(item)
                const colorClass = getContextColor(item.type)

                return (
                    <div
                        key={idx}
                        className="group flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-active/50 hover:bg-surface-active text-xs transition-colors"
                        title={item.type === 'CodeSelection'
                            ? `${(item as { uri?: string }).uri} (lines ${(item as { range?: [number, number] }).range?.join('-')})`
                            : (item as { uri?: string }).uri || item.type
                        }
                    >
                        <Icon className={`w-3 h-3 ${colorClass}`} />
                        <span className="text-text-secondary max-w-[120px] truncate">{label}</span>
                        {item.type === 'CodeSelection' && (
                            <span className="text-text-muted text-[10px]">
                                L{(item as { range?: [number, number] }).range?.join('-')}
                            </span>
                        )}
                        <button
                            onClick={() => onRemove(idx)}
                            className="opacity-0 group-hover:opacity-100 hover:text-status-error transition-opacity"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                )
            })}
        </div>
    )
}
