/**
 * 终端面板组件
 * 
 * 职责：
 * - 纯 UI 渲染
 * - 订阅 terminalManager 状态
 * - 处理用户交互，委托给 terminalManager
 */

import { api } from '@/renderer/services/electronAPI'
import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Plus, Trash2, ChevronUp, ChevronDown, Terminal as TerminalIcon, Sparkles, Play, SplitSquareHorizontal, LayoutTemplate } from 'lucide-react'
import { useStore, useModeStore } from '@store'
import { useAgentStore } from '@/renderer/agent'
import { themes } from '../editor/ThemeManager'
import { Button, Select } from '../ui'
import { terminalManager, TerminalManagerState } from '@/renderer/services/TerminalManager'
import { getFileName } from '@shared/utils/pathUtils'

// xterm 样式
const XTERM_STYLE = `
.xterm { font-feature-settings: "liga" 0; position: relative; user-select: none; -ms-user-select: none; -webkit-user-select: none; padding: 4px; }
.xterm.focus, .xterm:focus { outline: none; }
.xterm .xterm-helpers { position: absolute; z-index: 5; }
.xterm .xterm-helper-textarea { padding: 0; border: 0; margin: 0; position: absolute; opacity: 0; left: -9999em; top: 0; width: 0; height: 0; z-index: -5; overflow: hidden; white-space: nowrap; }
.xterm .composition-view { background: #000; color: #FFF; display: none; position: absolute; white-space: pre; z-index: 1; }
.xterm .composition-view.active { display: block; }
.xterm .xterm-viewport { background-color: rgb(var(--background-secondary)); overflow-y: scroll; cursor: default; position: absolute; right: 0; left: 0; top: 0; bottom: 0; }
.xterm .xterm-screen { position: relative; }
.xterm .xterm-screen canvas { position: absolute; left: 0; top: 0; }
.xterm .xterm-scroll-area { visibility: hidden; }
.xterm-char-measure-element { display: inline-block; visibility: hidden; position: absolute; left: -9999em; top: 0; }
.xterm.enable-mouse-events { cursor: default; }
.xterm.xterm-cursor-pointer { cursor: pointer; }
.xterm.xterm-cursor-crosshair { cursor: crosshair; }
.xterm .xterm-accessibility, .xterm .xterm-message-overlay { position: absolute; left: 0; top: 0; bottom: 0; right: 0; z-index: 10; color: transparent; }
.xterm-live-region { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
.xterm-dim { opacity: 0.5; }
.xterm-underline { text-decoration: underline; }
.xterm-selection-layer { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none; }
.xterm-cursor-layer { position: absolute; top: 0; left: 0; z-index: 2; pointer-events: none; }
.xterm-link-layer { position: absolute; top: 0; left: 0; z-index: 11; pointer-events: none; }
.xterm-link-layer a { cursor: pointer; color: #3b82f6; text-decoration: underline; }
`

// 生成终端主题
function getTerminalTheme(themeName: string) {
    const themeVars = themes[themeName as keyof typeof themes] || themes['adnify-dark']
    const rgbToHex = (rgb: string) => {
        if (!rgb) return '#000000'
        const [r, g, b] = rgb.split(' ').map(Number)
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
    }
    return {
        background: rgbToHex(themeVars['--background']),
        foreground: rgbToHex(themeVars['--text-primary']),
        cursor: rgbToHex(themeVars['--text-secondary']),
        selectionBackground: rgbToHex(themeVars['--accent']),
        selectionForeground: '#ffffff',
        black: rgbToHex(themeVars['--surface']),
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: rgbToHex(themeVars['--accent']),
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: rgbToHex(themeVars['--text-primary']),
    }
}

export default function TerminalPanel() {
    const { terminalVisible, setTerminalVisible, workspace, currentTheme, terminalLayout, setTerminalLayout } = useStore()
    const { setMode } = useModeStore()
    // 从 AgentStore 获取 setInputPrompt
    const setInputPrompt = useAgentStore(state => state.setInputPrompt)
    
    // UI 状态
    const [isCollapsed, setIsCollapsed] = useState(false)
    const [height, setHeight] = useState(280)
    const [isResizing, setIsResizing] = useState(false)
    const [availableShells, setAvailableShells] = useState<{ label: string; path: string }[]>([])
    const [showShellMenu, setShowShellMenu] = useState(false)
    const [selectedRoot, setSelectedRoot] = useState<string>('')
    const [scripts, setScripts] = useState<Record<string, string>>({})
    const [showScriptMenu, setShowScriptMenu] = useState(false)

    // 终端状态（来自 terminalManager）
    const [managerState, setManagerState] = useState<TerminalManagerState>(() => terminalManager.getState())
    
    const isSplitView = terminalLayout === 'split'
    const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map())
    const mountedTerminals = useRef<Set<string>>(new Set())

    // 菜单引用
    const shellMenuRef = useRef<HTMLDivElement>(null)
    const shellButtonRef = useRef<HTMLButtonElement>(null)
    const scriptMenuRef = useRef<HTMLDivElement>(null)
    const scriptButtonRef = useRef<HTMLButtonElement>(null)

    // ===== 订阅 terminalManager =====
    
    useEffect(() => {
        return terminalManager.subscribe(setManagerState)
    }, [])

    // ===== 主题同步 =====
    
    useEffect(() => {
        const theme = getTerminalTheme(currentTheme)
        terminalManager.setTheme(theme)
    }, [currentTheme])

    // ===== 挂载 xterm 到容器 =====
    
    useEffect(() => {
        for (const terminal of managerState.terminals) {
            const container = containerRefs.current.get(terminal.id)
            if (container && !mountedTerminals.current.has(terminal.id)) {
                terminalManager.mountTerminal(terminal.id, container)
                mountedTerminals.current.add(terminal.id)
            }
        }
        
        // 清理已删除的终端
        for (const id of mountedTerminals.current) {
            if (!managerState.terminals.find(t => t.id === id)) {
                mountedTerminals.current.delete(id)
            }
        }
    }, [managerState.terminals])

    // ===== 初始化 =====
    
    useEffect(() => {
        const loadShells = async () => {
            try {
                const shells = await api.terminal.getShells()
                setAvailableShells(shells)
            } catch {
                setAvailableShells([{ label: 'Terminal', path: '' }])
            }
        }
        loadShells()
    }, [])

    // 工作区切换时更新 selectedRoot 并清理旧终端
    useEffect(() => {
        const newRoot = workspace?.roots?.[0]
        if (newRoot && newRoot !== selectedRoot) {
            // 工作区变化，更新 selectedRoot
            setSelectedRoot(newRoot)
            
            // 清理旧工作区的终端（它们的 cwd 已经不在新工作区内了）
            const oldTerminals = managerState.terminals.filter(t => !workspace?.roots?.includes(t.cwd))
            oldTerminals.forEach(t => terminalManager.closeTerminal(t.id))
        }
    }, [workspace?.roots?.[0]])

    useEffect(() => {
        const loadScripts = async () => {
            if (!selectedRoot) return
            try {
                const content = await api.file.read(`${selectedRoot}/package.json`)
                if (content) {
                    const pkg = JSON.parse(content)
                    if (pkg.scripts) setScripts(pkg.scripts)
                }
            } catch {
                setScripts({})
            }
        }
        loadScripts()
    }, [selectedRoot])

    // 自动创建第一个终端
    useEffect(() => {
        // 确保有有效的工作区根目录才创建终端
        const hasValidWorkspace = selectedRoot || (workspace?.roots && workspace.roots.length > 0)
        if (terminalVisible && managerState.terminals.length === 0 && availableShells.length > 0 && hasValidWorkspace) {
            createTerminal()
        }
    }, [terminalVisible, managerState.terminals.length, availableShells.length, selectedRoot, workspace?.roots])

    // ===== 窗口大小调整 =====
    
    useEffect(() => {
        if (!terminalVisible || isCollapsed || !managerState.activeId) return
        
        const handleResize = () => {
            const targets = isSplitView ? managerState.terminals : managerState.terminals.filter(t => t.id === managerState.activeId)
            targets.forEach(t => terminalManager.fitTerminal(t.id))
        }
        
        window.addEventListener('resize', handleResize)
        setTimeout(handleResize, 100)
        return () => window.removeEventListener('resize', handleResize)
    }, [terminalVisible, isCollapsed, managerState.activeId, height, isSplitView, managerState.terminals.length])

    // ===== 拖拽调整高度 =====
    
    const startResizing = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        setIsResizing(true)
    }, [])

    useEffect(() => {
        if (!isResizing) return
        
        const handleMouseMove = (e: MouseEvent) => {
            const newHeight = window.innerHeight - e.clientY - 24
            if (newHeight > 100 && newHeight < window.innerHeight - 100) {
                setHeight(newHeight)
            }
        }
        
        const stopResizing = () => {
            setIsResizing(false)
            if (managerState.activeId) {
                terminalManager.fitTerminal(managerState.activeId)
            }
        }
        
        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', stopResizing)
        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', stopResizing)
        }
    }, [isResizing, managerState.activeId])

    // ===== 菜单点击外部关闭 =====
    
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (showShellMenu && shellMenuRef.current && !shellMenuRef.current.contains(event.target as Node) && shellButtonRef.current && !shellButtonRef.current.contains(event.target as Node)) {
                setShowShellMenu(false)
            }
            if (showScriptMenu && scriptMenuRef.current && !scriptMenuRef.current.contains(event.target as Node) && scriptButtonRef.current && !scriptButtonRef.current.contains(event.target as Node)) {
                setShowScriptMenu(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [showShellMenu, showScriptMenu])

    // ===== 操作函数 =====
    
    const createTerminal = async (shellPath?: string, shellName?: string) => {
        const cwd = selectedRoot || workspace?.roots?.[0] || ''
        if (!cwd) return
        
        await terminalManager.createTerminal({
            name: shellName || availableShells[0]?.label || 'Terminal',
            cwd,
            shell: shellPath,
        })
        setShowShellMenu(false)
    }

    const closeTerminal = (id: string, e?: React.MouseEvent) => {
        e?.stopPropagation()
        terminalManager.closeTerminal(id)
        if (managerState.terminals.length <= 2) {
            setTerminalLayout('tabs')
        }
    }

    const handleFixWithAI = () => {
        if (!managerState.activeId) return
        const buffer = terminalManager.getOutputBuffer(managerState.activeId)
        const content = buffer.join('').replace(/\u001b\[[0-9;]*m/g, '').slice(-2000).trim()
        if (!content) return
        setMode('chat')
        setInputPrompt(`I'm getting this error in the terminal. Please analyze it and fix the code:\n\n\`\`\`\n${content}\n\`\`\``)
    }

    const runScript = async (name: string) => {
        setShowScriptMenu(false)
        if (!terminalVisible) setTerminalVisible(true)
        
        let targetId = managerState.activeId
        if (!targetId && managerState.terminals.length === 0) {
            targetId = await createTerminal() as unknown as string
        }
        targetId = targetId || managerState.terminals[managerState.terminals.length - 1]?.id
        
        if (targetId) {
            terminalManager.focusTerminal(targetId)
            terminalManager.writeToTerminal(targetId, `npm run ${name}\r`)
        }
    }

    // ===== 渲染 =====
    
    if (!terminalVisible) return null

    const { terminals, activeId } = managerState

    return (
        <>
            <style>{XTERM_STYLE}</style>
            <div className="bg-transparent flex flex-col transition-none relative z-10" style={{ height: isCollapsed ? 40 : height }}>
                {/* 拖拽调整高度的区域 */}
                <div className="absolute top-0 left-0 right-0 h-1 cursor-row-resize z-50 hover:bg-accent/50 transition-colors" onMouseDown={startResizing} />
                
                {/* 标题栏 */}
                <div className="h-10 min-h-[40px] flex items-center justify-between border-t border-border bg-background select-none relative z-20">
                    {/* 左侧：图标和标签页 */}
                    <div className="flex items-center flex-1 min-w-0 overflow-hidden h-full">
                        <div className="flex-shrink-0 flex items-center justify-center px-3 cursor-pointer hover:text-text-primary text-text-muted transition-colors h-full" onClick={() => setIsCollapsed(!isCollapsed)}>
                            <TerminalIcon className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex items-center overflow-x-auto no-scrollbar flex-1 h-full pl-1">
                            {terminals.map(term => (
                                <div
                                    key={term.id}
                                    onClick={() => terminalManager.setActiveTerminal(term.id)}
                                    className={`relative flex items-center gap-2 px-3 h-full my-auto text-xs cursor-pointer min-w-[120px] max-w-[200px] flex-shrink-0 group transition-all mr-1 border-r border-border ${activeId === term.id ? 'bg-transparent text-text-primary font-medium' : 'text-text-muted hover:bg-white/5 hover:text-text-secondary'}`}
                                >
                                    <span className="truncate flex-1">{term.name}</span>
                                    {activeId === term.id && <div className="absolute top-0 left-0 right-0 h-[2px] bg-accent shadow-[0_0_8px_rgba(139,92,246,0.6)]" />}
                                    <Button variant="ghost" size="icon" onClick={(e) => closeTerminal(term.id, e)} className="h-4 w-4 opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 hover:bg-white/10">
                                        <X className="w-3 h-3" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* 中间：工作区选择和新建终端 */}
                    <div className="relative flex-shrink-0 h-full flex items-center px-1 gap-1 border-l border-border mx-1">
                        {workspace && workspace.roots.length > 1 && (
                            <div className="w-[120px]">
                                <Select value={selectedRoot} onChange={setSelectedRoot} options={workspace.roots.map(root => ({ value: root, label: getFileName(root) }))} className="h-7 text-xs border-transparent bg-transparent hover:bg-white/5" />
                            </div>
                        )}
                        <div className="relative">
                            <Button ref={shellButtonRef} variant="ghost" size="icon" onClick={() => setShowShellMenu(!showShellMenu)} className="h-7 w-7 rounded-lg">
                                <Plus className="w-3.5 h-3.5" />
                            </Button>
                            {showShellMenu && (
                                <div ref={shellMenuRef} className="absolute bottom-full left-0 mb-2 w-48 bg-background/90 backdrop-blur-xl border border-border rounded-xl shadow-xl py-1 flex flex-col max-h-64 overflow-y-auto z-[100] animate-scale-in">
                                    {availableShells.map(shell => (
                                        <button key={shell.label} onClick={() => createTerminal(shell.path, shell.label)} className="text-left px-3 py-2 text-xs text-text-primary hover:bg-white/10 w-full transition-colors">
                                            {shell.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 右侧：操作按钮 */}
                    <div className="flex items-center gap-1 px-2 flex-shrink-0">
                        <div className="relative">
                            <Button ref={scriptButtonRef} variant="ghost" size="sm" onClick={() => setShowScriptMenu(!showScriptMenu)} className="h-7 px-2 gap-1.5 text-xs font-normal rounded-lg" title="Run Task">
                                <Play className="w-3.5 h-3.5" />
                                Run
                            </Button>
                            {showScriptMenu && (
                                <div ref={scriptMenuRef} className="absolute bottom-full right-0 mb-2 bg-background/90 backdrop-blur-xl border border-border rounded-xl shadow-xl py-1 flex flex-col max-h-64 overflow-y-auto z-[100] min-w-[180px] animate-scale-in">
                                    {Object.keys(scripts).length > 0 ? Object.entries(scripts).map(([name, cmd]) => (
                                        <button key={name} onClick={() => runScript(name)} className="text-left px-3 py-2 text-xs text-text-primary hover:bg-white/10 flex flex-col gap-0.5 border-b border-border/50 last:border-0 w-full transition-colors">
                                            <span className="font-medium text-accent">{name}</span>
                                            <span className="text-[10px] text-text-muted truncate max-w-[200px] opacity-70 font-mono">{cmd}</span>
                                        </button>
                                    )) : <div className="px-3 py-2 text-xs text-text-muted italic">No scripts found</div>}
                                </div>
                            )}
                        </div>
                        <Button variant="ghost" size="sm" onClick={handleFixWithAI} className="h-7 px-2 gap-1.5 text-xs font-normal mr-2 rounded-lg" title="Fix with AI">
                            <Sparkles className="w-3.5 h-3.5" />
                            Fix
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => { createTerminal(); setTerminalLayout('split'); }} className="h-7 w-7 rounded-lg" title="Split Terminal"><SplitSquareHorizontal className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setTerminalLayout(isSplitView ? 'tabs' : 'split')} className={`h-7 w-7 rounded-lg ${isSplitView ? 'text-accent' : ''}`} title="Toggle Split View"><LayoutTemplate className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => activeId && terminalManager.getXterm(activeId)?.clear()} className="h-7 w-7 rounded-lg" title="Clear"><Trash2 className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setIsCollapsed(!isCollapsed)} className="h-7 w-7 rounded-lg">{isCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}</Button>
                        <Button variant="ghost" size="icon" onClick={() => setTerminalVisible(false)} className="h-7 w-7 rounded-lg" title="Close"><X className="w-3.5 h-3.5" /></Button>
                    </div>
                </div>

                {/* 终端内容区域 */}
                <div className={`flex-1 p-0 min-h-0 relative bg-transparent ${isCollapsed ? 'hidden' : 'block'}`}>
                    <div className={`h-full w-full ${isSplitView ? 'grid grid-cols-2 gap-1' : ''}`}>
                        {terminals.map(term => (
                            <div
                                key={term.id}
                                ref={el => { if (el) containerRefs.current.set(term.id, el) }}
                                className={`h-full w-full pl-2 pt-1 relative group/term ${isSplitView ? 'border border-border' : (activeId === term.id ? 'block' : 'hidden')} ${isSplitView && activeId === term.id ? 'ring-1 ring-accent' : ''}`}
                                onClick={() => terminalManager.setActiveTerminal(term.id)}
                            >
                                {isSplitView && (
                                    <div className="absolute top-0 right-0 p-1 z-10 opacity-0 group-hover/term:opacity-100 transition-opacity">
                                        <Button variant="ghost" size="icon" onClick={(e) => closeTerminal(term.id, e)} className="h-6 w-6 bg-background/80 hover:bg-red-500 hover:text-white">
                                            <X className="w-3 h-3" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </>
    )
}
