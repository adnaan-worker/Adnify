/**
 * 持久化终端面板
 * 显示和管理多个终端会话
 */

import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { Terminal, X, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { terminalService } from '../agent/terminalService'
import { PersistentTerminal } from '../agent/toolTypes'
import { useStore } from '../store'
import { t } from '../i18n'

interface TerminalTabProps {
  terminal: PersistentTerminal
  isActive: boolean
  onSelect: () => void
  onClose: () => void
}

const TerminalTab = memo(function TerminalTab({
  terminal,
  isActive,
  onSelect,
  onClose,
}: TerminalTabProps) {
  return (
    <div
      className={`
        flex items-center gap-2 px-3 py-1.5 cursor-pointer border-t-2 transition-colors min-w-[120px] max-w-[200px] group
        ${isActive
          ? 'border-accent bg-background text-text-primary'
          : 'border-transparent bg-background-secondary text-text-muted hover:bg-surface-hover'
        }
      `}
      onClick={onSelect}
    >
      <Terminal className="w-3.5 h-3.5" />
      <span className="text-xs font-mono truncate flex-1">{terminal.name}</span>
      {terminal.isRunning && (
        <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
      )}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className={`p-0.5 rounded hover:bg-surface-active opacity-0 group-hover:opacity-100 transition-opacity ${isActive ? 'opacity-100' : ''}`}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
})

interface TerminalOutputProps {
  terminal: PersistentTerminal
}

const TerminalOutput = memo(function TerminalOutput({ terminal }: TerminalOutputProps) {
  const outputRef = useRef<HTMLDivElement>(null)
  const [output, setOutput] = useState<string[]>([])
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    // 初始加载输出
    setOutput(terminalService.getOutput(terminal.id))

    // 订阅新输出
    const unsubscribe = terminalService.subscribeOutput(terminal.id, (newOutput) => {
      setOutput(prev => {
        const newLines = newOutput.split('\n')
        const combined = [...prev, ...newLines]
        // 限制显示行数
        return combined.slice(-500)
      })
    })

    return unsubscribe
  }, [terminal.id])

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output, autoScroll])

  // 检测用户滚动
  const handleScroll = useCallback(() => {
    if (!outputRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = outputRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50
    setAutoScroll(isAtBottom)
  }, [])

  return (
    <div
      ref={outputRef}
      className="flex-1 overflow-auto bg-background p-3 font-mono text-xs custom-scrollbar"
      onScroll={handleScroll}
    >
      {output.length === 0 ? (
        <div className="text-text-muted opacity-50 select-none">
          $ Terminal ready
        </div>
      ) : (
        output.map((line, idx) => (
          <div key={idx} className="whitespace-pre-wrap text-text-primary leading-relaxed break-all">
            {line}
          </div>
        ))
      )}
    </div>
  )
})

export default function TerminalPanel() {
  const { language, terminalVisible, setTerminalVisible, workspacePath } = useStore()
  const [terminals, setTerminals] = useState<PersistentTerminal[]>([])
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null)
  const [isCollapsed, setIsCollapsed] = useState(false)

  // 刷新终端列表
  const refreshTerminals = useCallback(() => {
    const allTerminals = terminalService.getAllTerminals()
    setTerminals(allTerminals)

    // 如果当前活动终端不存在，选择第一个
    if (activeTerminalId && !allTerminals.find(t => t.id === activeTerminalId)) {
      setActiveTerminalId(allTerminals[0]?.id || null)
    }
  }, [activeTerminalId])

  // 定期刷新
  useEffect(() => {
    refreshTerminals()
    const interval = setInterval(refreshTerminals, 2000)
    return () => clearInterval(interval)
  }, [refreshTerminals])

  // 创建新终端
  const createTerminal = useCallback(async () => {
    const name = `Terminal ${terminals.length + 1}`
    const terminal = await terminalService.openTerminal(name, workspacePath || undefined)
    setActiveTerminalId(terminal.id)
    refreshTerminals()
  }, [terminals.length, refreshTerminals, workspacePath])

  // 关闭终端
  const closeTerminal = useCallback((id: string) => {
    terminalService.closeTerminal(id)
    refreshTerminals()
  }, [refreshTerminals])

  // 清除当前终端输出
  const clearCurrentOutput = useCallback(() => {
    if (activeTerminalId) {
      terminalService.clearOutput(activeTerminalId)
      refreshTerminals()
    }
  }, [activeTerminalId, refreshTerminals])

  if (!terminalVisible) {
    return null
  }

  const activeTerminal = terminals.find(t => t.id === activeTerminalId)

  return (
    <div className={`flex flex-col border-t border-border-subtle bg-background-secondary transition-all duration-300 ${isCollapsed ? 'h-10' : 'h-64'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 border-b border-border-subtle select-none">
        <div className="flex items-center gap-4">
           <div className="flex items-center gap-2 text-text-muted hover:text-text-primary transition-colors cursor-pointer" onClick={() => setIsCollapsed(!isCollapsed)}>
                <Terminal className="w-3.5 h-3.5" />
                <span className="text-xs font-medium uppercase tracking-wider">
                    {t('terminal', language)}
                </span>
           </div>
           
           {/* Terminal Tabs in Header if space permits, or below */}
            {!isCollapsed && terminals.length > 0 && (
                <div className="flex items-center gap-1 h-full pt-1">
                    {terminals.map(terminal => (
                        <TerminalTab
                        key={terminal.id}
                        terminal={terminal}
                        isActive={terminal.id === activeTerminalId}
                        onSelect={() => setActiveTerminalId(terminal.id)}
                        onClose={() => closeTerminal(terminal.id)}
                        />
                    ))}
                </div>
            )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={createTerminal}
            className="p-1.5 rounded hover:bg-surface-hover transition-colors text-text-muted hover:text-text-primary"
            title="New Terminal"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={clearCurrentOutput}
            className="p-1.5 rounded hover:bg-surface-hover transition-colors text-text-muted hover:text-text-primary"
            title="Clear Output"
            disabled={!activeTerminal}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1.5 rounded hover:bg-surface-hover transition-colors text-text-muted hover:text-text-primary"
          >
            {isCollapsed ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={() => setTerminalVisible(false)}
            className="p-1.5 rounded hover:bg-surface-hover transition-colors text-text-muted hover:text-text-primary"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="flex-1 flex flex-col min-h-0">
          {activeTerminal ? (
            <TerminalOutput terminal={activeTerminal} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-muted bg-background">
              <div className="text-center">
                <Terminal className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-xs mb-3">No active terminal</p>
                <button
                  onClick={createTerminal}
                  className="px-3 py-1.5 text-xs bg-surface border border-border-subtle hover:border-text-muted rounded transition-colors"
                >
                  Create New
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
