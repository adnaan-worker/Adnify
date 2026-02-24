/**
 * WorkspaceDropdown - 现代风格工作区切换器
 * 融合胶囊设计与灵动交互
 */
import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Plus, FolderOpen, History, Folder, Monitor, LayoutGrid } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@store'
import { workspaceManager } from '@services/WorkspaceManager'
import { toast } from '@components/common/ToastProvider'
import { getFileName, getDirname, getBasename } from '@shared/utils/pathUtils'

interface RecentWorkspace {
    path: string
    name: string
}

export default function WorkspaceDropdown() {
    const { workspace } = useStore()
    const [isOpen, setIsOpen] = useState(false)
    const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([])
    const containerRef = useRef<HTMLDivElement>(null)

    // 获取当前工作区显示名称
    const currentWorkspaceName = workspace?.roots[0]
        ? getFileName(workspace.roots[0]) || 'Workspace'
        : 'No Workspace'

    // 加载最近工作区列表
    const loadRecent = async () => {
        try {
            const recent = await api.workspace.getRecent()
            setRecentWorkspaces(
                recent.map((path: string) => ({
                    path,
                    name: getFileName(path),
                }))
            )
        } catch (e) {
            logger.ui.error('[WorkspaceDropdown] Failed to load recent workspaces:', e)
        }
    }

    useEffect(() => {
        if (isOpen) {
            loadRecent()
        }
    }, [isOpen])

    // 点击外部关闭
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const handleAction = async (action: () => Promise<void> | void) => {
        setIsOpen(false)
        await action()
    }

    const handleOpenRecent = async (path: string) => {
        setIsOpen(false)
        try {
            await workspaceManager.openFolder(path)
        } catch (e) {
            toast.error('文件夹不存在，已从列表移除', getFileName(path))
            loadRecent()
        }
    }

    return (
        <div ref={containerRef} className="relative">
            {/* 触发按钮 - 胶囊风格 */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`
                    flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-200 group
                    border border-transparent
                    ${isOpen
                        ? 'bg-accent/10 text-accent border-accent/20'
                        : 'hover:bg-surface-hover text-text-secondary hover:text-text-primary hover:border-text-primary/5'}
                `}
            >
                <div className={`p-1 rounded-md transition-colors ${isOpen ? 'bg-accent/20' : 'bg-text-primary/5 group-hover:bg-text-primary/10'}`}>
                    <Folder className="w-3.5 h-3.5" />
                </div>

                <div className="flex flex-col items-start text-left leading-none min-w-[80px] max-w-[160px]">
                    <span className="text-xs font-medium truncate w-full text-text-secondary group-hover:text-text-primary transition-colors">
                        {currentWorkspaceName}
                    </span>
                </div>

                <ChevronDown
                    className={`w-3.5 h-3.5 text-text-muted/50 transition-transform duration-300 ml-1 ${isOpen ? 'rotate-180 text-accent' : 'group-hover:text-text-primary'}`}
                />
            </button>

            {/* 下拉菜单 - 玻璃拟态 */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.98 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        className="absolute top-full left-0 mt-2 w-72 p-1.5 bg-background/80 backdrop-blur-xl border border-border rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden"
                    >
                        <div className="space-y-0.5">
                            <MenuItem
                                icon={Monitor}
                                label="新建窗口"
                                description="打开一个新的编辑器窗口"
                                onClick={() => handleAction(() => api.window.new())}
                            />
                            <MenuItem
                                icon={FolderOpen}
                                label="打开文件夹..."
                                onClick={() => handleAction(async () => {
                                    const result = await api.file.openFolder()
                                    if (result && typeof result === 'string') await workspaceManager.openFolder(result)
                                })}
                            />
                            <MenuItem
                                icon={LayoutGrid}
                                label="打开工作区..."
                                onClick={() => handleAction(async () => {
                                    const result = await api.workspace.open()
                                    if (result && !('redirected' in result)) await workspaceManager.switchTo(result)
                                })}
                            />
                            <MenuItem
                                icon={Plus}
                                label="添加文件夹"
                                onClick={() => handleAction(async () => {
                                    const path = await api.workspace.addFolder()
                                    if (path) await workspaceManager.addFolder(path)
                                })}
                            />
                        </div>

                        {/* 最近打开 */}
                        {recentWorkspaces.length > 0 && (
                            <>
                                <div className="h-px bg-border my-1.5 mx-2" />
                                <div className="px-3 py-1.5 flex items-center gap-2">
                                    <History className="w-3 h-3 text-accent" />
                                    <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Recent</span>
                                </div>
                                <div className="space-y-0.5 max-h-[200px] overflow-y-auto custom-scrollbar">
                                    {recentWorkspaces
                                        .filter((w) => w.path !== workspace?.roots[0])
                                        .slice(0, 5)
                                        .map((recent) => (
                                            <button
                                                key={recent.path}
                                                onClick={() => handleOpenRecent(recent.path)}
                                                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-all group relative overflow-hidden"
                                                title={recent.path}
                                            >
                                                <div className="absolute inset-0 bg-accent/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                <Folder className="w-4 h-4 text-text-muted group-hover:text-accent transition-colors" />
                                                <span className="truncate relative z-10">{recent.name}</span>
                                                <span className="ml-auto text-[10px] text-text-muted/40 group-hover:text-text-muted truncate max-w-[80px]">
                                                    {getBasename(getDirname(recent.path))}
                                                </span>
                                            </button>
                                        ))}
                                </div>
                            </>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

function MenuItem({ icon: Icon, label, description, onClick }: { icon: any, label: string, description?: string, onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-all group relative overflow-hidden"
        >
            <div className="absolute inset-0 bg-accent/5 opacity-0 group-hover:opacity-100 transition-opacity" />
            <Icon className="w-4 h-4 text-text-muted group-hover:text-accent transition-colors relative z-10" />
            <div className="flex flex-col relative z-10">
                <span className="font-medium">{label}</span>
                {description && <span className="text-[10px] text-text-muted/60">{description}</span>}
            </div>
        </button>
    )
}