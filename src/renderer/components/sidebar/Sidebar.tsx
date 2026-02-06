/**
 * Sidebar 主组件
 * 重塑：沉浸式设计，去除多余色块
 */

import { useStore } from '@store'
import { ExplorerView } from './panels/ExplorerView'
import { SearchView } from './panels/SearchView'
import { GitView } from './panels/GitView'
import { ProblemsView } from './panels/ProblemsView'
import { OutlineView } from './panels/OutlineView'
import { HistoryView } from './panels/HistoryView'
import { EmotionAwarenessPanel } from '../agent/EmotionAwarenessPanel'

export default function Sidebar() {
    const { activeSidePanel } = useStore()

    if (!activeSidePanel) return null

    return (
        <div className="w-full bg-background border-r border-border flex flex-col h-full animate-fade-in relative z-10">
            {activeSidePanel === 'explorer' && <ExplorerView />}
            {activeSidePanel === 'search' && <SearchView />}
            {activeSidePanel === 'git' && <GitView />}
            {activeSidePanel === 'emotion' && <EmotionAwarenessPanel />}
            {activeSidePanel === 'problems' && <ProblemsView />}
            {activeSidePanel === 'outline' && <OutlineView />}
            {activeSidePanel === 'history' && <HistoryView />}
        </div>
    )
}