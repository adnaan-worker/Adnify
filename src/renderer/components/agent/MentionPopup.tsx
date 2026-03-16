/**
 * @ 文件提及弹出菜单
 * 使用公共 InputPopup 组件
 */

import { useMemo } from 'react'
import { Search, Sparkles } from 'lucide-react'
import { t } from '@/renderer/i18n'
import { MentionCandidate } from '@/renderer/agent/utils/MentionParser'
import { useStore } from '@/renderer/store'
import { InputPopup, InputPopupItem } from '@/renderer/components/common/InputPopup'

interface MentionPopupProps {
    position: { x: number; y: number }
    query: string
    candidates: MentionCandidate[]
    loading: boolean
    onSelect: (candidate: MentionCandidate) => void
    onClose: () => void
}

// 将 MentionCandidate 转换为 InputPopupItem
interface MentionItem extends InputPopupItem {
    candidate: MentionCandidate
}

export default function MentionPopup({
    position,
    query,
    candidates,
    loading,
    onSelect,
    onClose,
}: MentionPopupProps) {
    const language = useStore(s => s.language)

    // 转换为 InputPopup 需要的格式
    const items: MentionItem[] = useMemo(() => {
        return candidates.map(candidate => ({
            id: candidate.id,
            label: candidate.label,
            description: candidate.description,
            icon: candidate.icon,
            candidate,
        }))
    }, [candidates])

    const handleSelect = (item: MentionItem) => {
        onSelect(item.candidate)
    }

    // 自定义渲染项（需要特殊处理 codebase 类型的图标）
    const renderItem = (item: MentionItem, _index: number, isSelected: boolean) => {
        const Icon = item.icon
        const candidate = item.candidate
        return (
            <div
                key={item.id}
                onClick={() => handleSelect(item)}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${isSelected ? 'bg-accent/20 text-text-primary' : 'hover:bg-surface-hover text-text-secondary'}`}
            >
                {Icon && <Icon className={`w-4 h-4 flex-shrink-0 ${candidate.type === 'file' ? 'text-text-muted' : 'text-accent'}`} />}
                <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{item.label}</div>
                    {item.description && (
                        <div className="text-[10px] text-text-muted truncate">{item.description}</div>
                    )}
                </div>
                {candidate.type === 'codebase' && <Sparkles className="w-3 h-3 text-purple-400" />}
            </div>
        )
    }

    return (
        <InputPopup<MentionItem>
            position={position}
            items={items}
            loading={loading}
            onSelect={handleSelect}
            onClose={onClose}
            header={
                <>
                    <Search className="w-3.5 h-3.5 text-text-muted" />
                    <span>{query ? `${t('searching', language)}: ${query}` : t('selectFileToReference', language)}</span>
                </>
            }
            emptyText={query ? t('noResultsFound', language) : t('noFilesInWorkspace', language)}
            renderItem={renderItem}
        />
    )
}
