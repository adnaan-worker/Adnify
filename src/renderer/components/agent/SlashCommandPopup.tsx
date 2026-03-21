/**
 * 斜杠命令弹出菜单
 * 当用户输入 / 时显示可用命令
 */

import { useMemo } from 'react'
import { Command, Sparkles, FileCode, Wrench, Bug, Zap, MessageSquare, Code } from 'lucide-react'
import { slashCommandService, SlashCommand } from '@/renderer/services/slashCommandService'
import { InputPopup, InputPopupItem } from '@/renderer/components/common/InputPopup'
import { useStore } from '@/renderer/store'

interface SlashCommandPopupProps {
    query: string // 包含 / 的输入
    position: { x: number; y: number }
    onSelect: (command: SlashCommand) => void
    onClose: () => void
}

const COMMAND_ICONS: Record<string, typeof Command> = {
    test: FileCode,
    explain: MessageSquare,
    refactor: Wrench,
    fix: Bug,
    optimize: Zap,
    comment: MessageSquare,
    type: Code,
}

// 将 SlashCommand 转换为 InputPopupItem
interface CommandItem extends InputPopupItem {
    command: SlashCommand
}

export default function SlashCommandPopup({ query, position, onSelect, onClose }: SlashCommandPopupProps) {
    const language = useStore(s => s.language)
    const matchingCommands = slashCommandService.findMatching(query)

    // 转换为 InputPopup 需要的格式
    const items: CommandItem[] = useMemo(() => {
        return matchingCommands.map(cmd => ({
            id: cmd.name,
            label: `/${cmd.name}`,
            description: cmd.description,
            icon: COMMAND_ICONS[cmd.name] || Sparkles,
            command: cmd,
        }))
    }, [matchingCommands])

    const handleSelect = (item: CommandItem) => {
        onSelect(item.command)
    }

    if (items.length === 0) return null

    return (
        <InputPopup<CommandItem>
            position={position}
            items={items}
            onSelect={handleSelect}
            onClose={onClose}
            header={<span>{language === 'zh' ? '快捷命令' : 'Quick Commands'}</span>}
            emptyText={language === 'zh' ? '没有匹配的命令' : 'No matching commands'}
        />
    )
}
