
import { useEffect, useState } from 'react'
import { Search, RotateCcw } from 'lucide-react'
import { keybindingService, Command } from '@services/keybindingService'
import { registerCoreCommands } from '@renderer/config/commands'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { Input, Button, Modal } from '../ui'

export default function KeybindingPanel() {
    const { language } = useStore()
    const [commands, setCommands] = useState<Command[]>([])
    const [bindings, setBindings] = useState<Record<string, string>>({})
    const [searchQuery, setSearchQuery] = useState('')
    const [recordingId, setRecordingId] = useState<string | null>(null)

    useEffect(() => {
        registerCoreCommands()
        keybindingService.init().then(() => {
            loadData()
        })
    }, [])

    const loadData = () => {
        setCommands(keybindingService.getAllCommands())
        const newBindings: Record<string, string> = {}
        keybindingService.getAllCommands().forEach(cmd => {
            const binding = keybindingService.getBinding(cmd.id)
            if (binding) newBindings[cmd.id] = binding
        })
        setBindings(newBindings)
    }

    const handleKeyDown = async (e: React.KeyboardEvent) => {
        if (!recordingId) return
        e.preventDefault()
        e.stopPropagation()

        const modifiers = []
        if (e.ctrlKey) modifiers.push('Ctrl')
        if (e.shiftKey) modifiers.push('Shift')
        if (e.altKey) modifiers.push('Alt')
        if (e.metaKey) modifiers.push('Meta')

        let key = e.key
        if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return

        if (key === ' ') key = 'Space'
        if (key.length === 1) key = key.toUpperCase()

        const binding = [...modifiers, key].join('+')

        await keybindingService.updateBinding(recordingId, binding)
        setRecordingId(null)
        loadData()
    }

    const handleReset = async (id: string) => {
        await keybindingService.resetBinding(id)
        loadData()
    }

    const filteredCommands = commands.filter(cmd => {
        const translatedTitle = t(`cmd.${cmd.id}` as any, language) || cmd.title
        const translatedCategory = cmd.category ? (t(`kb.category.${cmd.category}` as any, language) || cmd.category) : ''

        return translatedTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
            translatedCategory.toLowerCase().includes(searchQuery.toLowerCase())
    })

    return (
        <div className="flex flex-col h-full bg-background text-text-primary">
            <div className="p-4 border-b border-border-subtle flex items-center gap-3">
                <div className="relative flex-1">
                    <Input
                        leftIcon={<Search className="w-4 h-4" />}
                        placeholder={t('kb.searchPlaceholder' as any, language) || "Search keybindings..."}
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                <div className="space-y-1">
                    {filteredCommands.map(cmd => (
                        <div key={cmd.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-surface-hover group transition-colors">
                            <div className="flex flex-col gap-0.5">
                                <span className="text-sm font-medium">{t(`cmd.${cmd.id}` as any, language) || cmd.title}</span>
                                <span className="text-xs text-text-muted">{cmd.category ? (t(`kb.category.${cmd.category}` as any, language) || cmd.category) : ''} • {cmd.id}</span>
                            </div>

                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setRecordingId(cmd.id)}
                                    className="font-mono min-w-[80px]"
                                >
                                    {bindings[cmd.id] || '-'}
                                </Button>

                                {keybindingService.isOverridden(cmd.id) && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleReset(cmd.id)}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                                        title={t('kb.resetToDefault' as any, language) || "Reset to default"}
                                    >
                                        <RotateCcw className="w-3.5 h-3.5" />
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Recording Modal */}
            <Modal
                isOpen={!!recordingId}
                onClose={() => setRecordingId(null)}
                title={t('kb.pressKeyCombination' as any, language) || "Press desired key combination"}
                size="sm"
            >
                <div
                    className="flex flex-col items-center gap-6 py-4 outline-none"
                    tabIndex={0}
                    ref={el => el?.focus()}
                    onKeyDown={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (e.key === 'Escape') {
                            setRecordingId(null)
                            return
                        }
                        handleKeyDown(e)
                    }}
                >
                    <p className="text-text-muted text-sm">{t('kb.pressEscToCancel' as any, language) || "Press Esc to cancel"}</p>

                    <div className="px-6 py-3 bg-surface-active rounded-lg border border-accent/30 text-2xl font-mono text-accent shadow-lg shadow-accent/10 animate-pulse">
                        {t('kb.recording' as any, language) || "Recording..."}
                    </div>
                </div>
            </Modal>
        </div>
    )
}
