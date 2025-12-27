import { logger } from '@utils/Logger'
import { useEffect, useState, useMemo } from 'react'
import { GitBranch, AlertCircle, XCircle, Database, Loader2, Cpu, Terminal, CheckCircle2, ScrollText, Coins, Minimize2, MessageSquare } from 'lucide-react'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { IndexStatus } from '@app-types/electron'
import { indexWorkerService, IndexProgress } from '@services/indexWorkerService'
import BottomBarPopover from '../ui/BottomBarPopover'
import ToolCallLogContent from '../panels/ToolCallLogContent'
import { PlanListPopover } from '../panels/PlanListContent'
import { useAgentStore, selectMessages, selectContextSummary } from '@renderer/agent'
import { isAssistantMessage, TokenUsage } from '@renderer/agent/types'
import { useDiagnosticsStore, getFileStats } from '@services/diagnosticsStore'

export default function StatusBar() {
  const {
    activeFilePath, isStreaming, workspacePath, setShowSettings, language,
    terminalVisible, setTerminalVisible, cursorPosition, isGitRepo, gitStatus,
    setActiveSidePanel
  } = useStore()
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null)
  const [workerProgress, setWorkerProgress] = useState<IndexProgress | null>(null)
  
  // 从全局 store 获取诊断统计
  const diagnostics = useDiagnosticsStore(state => state.diagnostics)
  const version = useDiagnosticsStore(state => state.version)
  const totalErrorCount = useDiagnosticsStore(state => state.errorCount)
  const totalWarningCount = useDiagnosticsStore(state => state.warningCount)

  // 当前文件的诊断统计（依赖 version 触发更新）
  const currentFileStats = useMemo(() => {
    return getFileStats(diagnostics, activeFilePath)
  }, [activeFilePath, version, diagnostics])

  // 获取消息列表并计算 token 统计
  const messages = useAgentStore(selectMessages)
  const contextSummary = useAgentStore(selectContextSummary)
  
  const tokenStats = useMemo(() => {
    let totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    let lastUsage: TokenUsage | undefined

    for (const msg of messages) {
      if (isAssistantMessage(msg) && msg.usage) {
        totalUsage.promptTokens += msg.usage.promptTokens
        totalUsage.completionTokens += msg.usage.completionTokens
        totalUsage.totalTokens += msg.usage.totalTokens
        lastUsage = msg.usage
      }
    }

    return { totalUsage, lastUsage }
  }, [messages])

  // 消息统计
  const messageCount = useMemo(() => {
    return messages.filter(m => m.role === 'user' || m.role === 'assistant').length
  }, [messages])

  // 初始化 Worker 并监听进度
  useEffect(() => {
    indexWorkerService.initialize()

    const unsubProgress = indexWorkerService.onProgress(setWorkerProgress)
    const unsubError = indexWorkerService.onError((error) => {
      logger.ui.error('[StatusBar] Worker error:', error)
    })

    return () => {
      unsubProgress()
      unsubError()
    }
  }, [])

  // 监听索引状态
  useEffect(() => {
    if (!workspacePath) {
      setIndexStatus(null)
      return
    }

    // 获取初始状态
    window.electronAPI.indexStatus(workspacePath).then(setIndexStatus)

    // 监听进度更新
    const unsubscribe = window.electronAPI.onIndexProgress(setIndexStatus)
    return unsubscribe
  }, [workspacePath])

  const handleIndexClick = () => {
    setShowSettings(true)
  }

  const handleDiagnosticsClick = () => {
    setActiveSidePanel('problems')
  }

  const toolCallLogs = useStore(state => state.toolCallLogs)

  return (
    <div className="h-7 bg-background-secondary border-t border-border-subtle flex items-center justify-between px-3 text-[10px] select-none text-text-muted z-50 font-medium">
      <div className="flex items-center gap-4">
        {isGitRepo && gitStatus && (
          <button className="flex items-center gap-1.5 hover:text-text-primary transition-colors group">
            <GitBranch className="w-3 h-3 text-accent group-hover:drop-shadow-[0_0_5px_rgba(var(--accent)/0.5)] transition-all" />
            <span className="group-hover:text-accent transition-colors">{gitStatus.branch}</span>
          </button>
        )}

        {/* Diagnostics - 显示当前文件的错误/警告，tooltip 显示全局统计 */}
        <button 
          onClick={handleDiagnosticsClick}
          className="flex items-center gap-3 hover:text-text-primary transition-colors"
          title={language === 'zh' 
            ? `当前文件: ${currentFileStats.errors} 错误, ${currentFileStats.warnings} 警告\n全部: ${totalErrorCount} 错误, ${totalWarningCount} 警告`
            : `Current file: ${currentFileStats.errors} errors, ${currentFileStats.warnings} warnings\nTotal: ${totalErrorCount} errors, ${totalWarningCount} warnings`}
        >
          <div className={`flex items-center gap-1 ${currentFileStats.errors > 0 ? 'text-red-400' : ''}`}>
            <XCircle className="w-3 h-3" />
            <span>{currentFileStats.errors}</span>
          </div>
          <div className={`flex items-center gap-1 ${currentFileStats.warnings > 0 ? 'text-yellow-400' : ''}`}>
            <AlertCircle className="w-3 h-3" />
            <span>{currentFileStats.warnings}</span>
          </div>
        </button>

        {/* Worker 状态 */}
        {workerProgress && !workerProgress.isComplete && (
          <div className="flex items-center gap-1.5 text-accent animate-fade-in">
            <Cpu className="w-3 h-3 animate-pulse" />
            <span>
              {Math.round((workerProgress.processed / workerProgress.total) * 100)}%
            </span>
          </div>
        )}

        {/* 索引状态 */}
        {workspacePath && (
          <button
            onClick={handleIndexClick}
            className="flex items-center gap-1.5 hover:text-text-primary transition-colors group"
            title={t('codebaseIndex', language)}
          >
            {indexStatus?.isIndexing ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin text-accent" />
                <span className="text-accent hidden sm:inline">Indexing...</span>
              </>
            ) : indexStatus?.totalChunks ? (
              <CheckCircle2 className="w-3 h-3 text-green-400/70 group-hover:text-green-400 transition-colors" />
            ) : (
              <Database className="w-3 h-3 opacity-50 group-hover:opacity-80" />
            )}
          </button>
        )}
      </div>

      <div className="flex items-center gap-4">
        {isStreaming && (
          <div className="flex items-center gap-2 text-accent animate-pulse-glow px-2 py-0.5 rounded-full bg-accent/5 border border-accent/10">
            <div className="w-1 h-1 rounded-full bg-accent animate-pulse" />
            <span className="font-medium">AI Processing</span>
          </div>
        )}

        {/* 上下文压缩状态 */}
        {contextSummary && (
          <div 
            className="flex items-center gap-1.5 text-green-400 cursor-default"
            title={language === 'zh' ? '对话已压缩' : 'Context compacted'}
          >
            <Minimize2 className="w-3 h-3" />
            <span>{language === 'zh' ? '已压缩' : 'Compacted'}</span>
          </div>
        )}

        {/* 对话消息统计 */}
        {messageCount > 0 && (
          <div 
            className="flex items-center gap-1.5 hover:text-text-primary transition-colors cursor-default"
            title={language === 'zh' ? `${messageCount} 条消息` : `${messageCount} messages`}
          >
            <MessageSquare className="w-3 h-3" />
            <span>{messageCount}</span>
          </div>
        )}

        {/* Token 统计 */}
        {tokenStats.totalUsage.totalTokens > 0 && (
          <div
            className="flex items-center gap-1.5 text-text-muted hover:text-text-primary transition-colors cursor-default group"
            title={`Prompt: ${tokenStats.totalUsage.promptTokens.toLocaleString()} | Completion: ${tokenStats.totalUsage.completionTokens.toLocaleString()} | Total: ${tokenStats.totalUsage.totalTokens.toLocaleString()}`}
          >
            <Coins className="w-3 h-3 group-hover:text-accent transition-colors" />
            <span className="font-mono text-[10px]">
              {tokenStats.totalUsage.totalTokens >= 1000
                ? `${(tokenStats.totalUsage.totalTokens / 1000).toFixed(1)}k`
                : tokenStats.totalUsage.totalTokens}
            </span>
          </div>
        )}

        <div className="flex items-center gap-4">
          {/* 终端切换按钮 */}
          <button
            onClick={() => setTerminalVisible(!terminalVisible)}
            className={`flex items-center gap-1.5 transition-colors ${terminalVisible ? 'text-text-primary' : 'hover:text-text-primary'}`}
            title={`${t('terminal', language)} (Ctrl+\`)`}
          >
            <Terminal className={`w-3 h-3 ${terminalVisible ? 'text-accent drop-shadow-[0_0_5px_rgba(var(--accent)/0.5)]' : ''}`} />
          </button>

          <BottomBarPopover
            icon={<ScrollText className="w-3 h-3" />}
            tooltip={language === 'zh' ? '工具调用日志' : 'Tool Call Logs'}
            title={language === 'zh' ? '工具调用日志' : 'Tool Call Logs'}
            width={380}
            height={280}
            badge={toolCallLogs.length || undefined}
            language={language as 'en' | 'zh'}
          >
            <ToolCallLogContent language={language as 'en' | 'zh'} />
          </BottomBarPopover>

          {/* 计划列表 - 仅在 Plan 模式下显示 */}
          <PlanListPopover language={language as 'en' | 'zh'} />

          {activeFilePath && (
            <span className="font-medium text-accent/80">{activeFilePath.split('.').pop()?.toUpperCase() || 'TXT'}</span>
          )}

          <div className="flex items-center gap-2 cursor-pointer hover:text-text-primary font-mono opacity-60 hover:opacity-100 transition-opacity">
            <span>Ln {cursorPosition?.line || 1}, Col {cursorPosition?.column || 1}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
