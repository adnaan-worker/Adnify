import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useEffect, useState, useMemo, useRef } from 'react'
import {
  GitBranch,
  AlertCircle,
  XCircle,
  Database,
  Loader2,
  Cpu,
  Terminal,
  CheckCircle2,
  ScrollText,
  Layers,
  MessageSquare,
  Bug,
  ListTodo,
} from 'lucide-react'
import { useStore } from '@store'
import type { IndexStatus } from '@shared/types'
import { indexWorkerService, IndexProgress } from '@services/indexWorkerService'
import BottomBarPopover from '../ui/BottomBarPopover'
import ToolCallLogContent from '../panels/ToolCallLogContent'
import ContextStatsContent from '../panels/ContextStatsContent'
import PlanListContent from '../panels/PlanListContent'
import { useAgentStore, selectMessages, selectCompressionStats, selectHandoffRequired, selectCompressionPhase } from '@renderer/agent'
import { isAssistantMessage, TokenUsage } from '@renderer/agent/types'
import { useDiagnosticsStore, getFileStats } from '@services/diagnosticsStore'
import LspStatusIndicator from './LspStatusIndicator'
import { EmotionStatusIndicator } from '../agent/EmotionStatusIndicator'
import { motion, AnimatePresence } from 'framer-motion'

export default function StatusBar() {
  const {
    activeFilePath, workspacePath, setShowSettings, language,
    terminalVisible, setTerminalVisible, debugVisible, setDebugVisible,
    cursorPosition, isGitRepo, gitStatus, setActiveSidePanel
  } = useStore()
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null)
  const [workerProgress, setWorkerProgress] = useState<IndexProgress | null>(null)

  const diagnostics = useDiagnosticsStore(state => state.diagnostics)
  const version = useDiagnosticsStore(state => state.version)

  const currentFileStats = useMemo(() => {
    return getFileStats(diagnostics, activeFilePath)
  }, [activeFilePath, version, diagnostics])

  const messages = useAgentStore(selectMessages)
  const compressionStats = useAgentStore(selectCompressionStats)
  const handoffRequired = useAgentStore(selectHandoffRequired)
  const compressionPhase = useAgentStore(selectCompressionPhase)
  const createHandoffSession = useAgentStore(state => state.createHandoffSession)

  // L4 自动过渡 - 用 ref 追踪是否已经开始过渡，避免重复触发
  const transitionStartedRef = useRef(false)

  useEffect(() => {
    // 当 handoffRequired 变为 false 时，重置 ref
    if (!handoffRequired) {
      transitionStartedRef.current = false
      return
    }

    // 如果已经开始过渡，不重复触发
    if (transitionStartedRef.current) return

    transitionStartedRef.current = true

    // 短暂延迟后自动创建新会话
    const timer = setTimeout(() => {
      // 再次检查 handoffRequired，可能已被用户操作取消
      if (!selectHandoffRequired(useAgentStore.getState())) {
        transitionStartedRef.current = false
        return
      }

      const result = createHandoffSession()

      // 如果有 autoResume，触发自动继续
      if (result && typeof result === 'object' && 'autoResume' in result) {
        window.dispatchEvent(new CustomEvent('handoff-auto-resume', {
          detail: {
            objective: result.objective,
            pendingSteps: result.pendingSteps,
            fileChanges: result.fileChanges,
          }
        }))
      }
    }, 1500)

    return () => clearTimeout(timer)
  }, [handoffRequired, createHandoffSession])
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

  const messageCount = useMemo(() => {
    return messages.filter(m => m.role === 'user' || m.role === 'assistant').length
  }, [messages])

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

  useEffect(() => {
    if (!workspacePath) {
      setIndexStatus(null)
      return
    }
    api.index.status(workspacePath).then(setIndexStatus)
    const unsubscribe = api.index.onProgress(setIndexStatus)
    return unsubscribe
  }, [workspacePath])

  const handleIndexClick = () => setShowSettings(true)
  const handleDiagnosticsClick = () => setActiveSidePanel('problems')
  const toolCallLogs = useStore(state => state.toolCallLogs)
  const plans = useAgentStore(state => state.plans)
  const activePlanId = useAgentStore(state => state.activePlanId)
  const loadPlansFromDisk = useAgentStore(state => state.loadPlansFromDisk)

  // 工作区变化时加载已保存的计划
  useEffect(() => {
    if (workspacePath) {
      loadPlansFromDisk(workspacePath)
    }
  }, [workspacePath, loadPlansFromDisk])

  // 计算正在执行的计划数量
  const executingPlansCount = plans.filter(p => p.status === 'executing').length

  return (
    <div className="h-8 bg-background-secondary/40 backdrop-blur-md flex items-center justify-between px-3 text-[10px] select-none text-text-muted z-50 font-medium border-t border-white/5">
      {/* Left Group */}
      <div className="flex items-center gap-2">
        {/* 情绪呼吸灯 */}
        <EmotionStatusIndicator />

        <div className="w-px h-3.5 bg-white/5" />

        {isGitRepo && gitStatus && (
          <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-full hover:bg-white/5 text-text-muted hover:text-text-primary transition-all group border border-transparent hover:border-white/5">
            <GitBranch className="w-3 h-3 text-accent opacity-80" />
            <span className="font-bold tracking-tight">{gitStatus.branch}</span>
          </button>
        )}

        <button
          onClick={handleDiagnosticsClick}
          className="flex items-center gap-3 px-2.5 py-1 rounded-full hover:bg-white/5 transition-all text-text-muted hover:text-text-primary border border-transparent hover:border-white/5"
        >
          <div className={`flex items-center gap-1.5 ${currentFileStats.errors > 0 ? 'text-red-400' : ''}`}>
            <XCircle className="w-3 h-3" />
            <span className="font-bold">{currentFileStats.errors}</span>
          </div>
          <div className={`flex items-center gap-1.5 ${currentFileStats.warnings > 0 ? 'text-amber-400' : ''}`}>
            <AlertCircle className="w-3 h-3" />
            <span className="font-bold">{currentFileStats.warnings}</span>
          </div>
        </button>

        {workerProgress && !workerProgress.isComplete && workerProgress.total > 0 && (
          <div className="flex items-center gap-1.5 text-accent animate-fade-in px-2 bg-accent/5 rounded-full py-0.5 border border-accent/10">
            <Cpu className="w-3 h-3 animate-pulse" />
            <span>{Math.round((workerProgress.processed / workerProgress.total) * 100)}%</span>
          </div>
        )}

        {workspacePath && (
          <button
            onClick={handleIndexClick}
            className="flex items-center gap-1.5 px-2 py-1 rounded-full hover:bg-white/5 hover:text-text-primary transition-colors group"
          >
            {indexStatus?.isIndexing ? (
              <Loader2 className="w-3 h-3 animate-spin text-accent" />
            ) : indexStatus?.totalChunks ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400/80 group-hover:text-emerald-400" />
            ) : (
              <Database className="w-3 h-3 opacity-50" />
            )}
          </button>
        )}
      </div>

      <div className="flex-1" />

      {/* Right Group - Clean & Minimal */}
      <div className="flex items-center gap-3 h-full">

        {/* Stats Group */}
        <div className="flex items-center gap-2 h-full">
          {/* 上下文统计（合并 Token + 压缩） */}
          <BottomBarPopover
            icon={
              <AnimatePresence mode="wait">
                {handoffRequired ? (
                  // L4 过渡动画
                  <motion.div
                    key="transitioning"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex items-center gap-1.5 text-red-400"
                  >
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    >
                      <Loader2 className="w-3 h-3" />
                    </motion.div>
                    <span className="text-[10px] font-medium">
                      {language === 'zh' ? 'Switching' : 'Switching'}
                    </span>
                  </motion.div>
                ) : compressionPhase !== 'idle' && compressionPhase !== 'done' ? (
                  // 压缩过程动画
                  <motion.div
                    key="compressing"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex items-center gap-1.5 text-accent"
                  >
                    <motion.div
                      animate={{
                        scale: [1, 1.2, 1],
                        opacity: [1, 0.7, 1]
                      }}
                      transition={{ duration: 0.8, repeat: Infinity }}
                    >
                      <Layers className="w-3 h-3" />
                    </motion.div>
                    <motion.div
                      className="flex gap-0.5"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      {[0, 1, 2].map((i) => (
                        <motion.span
                          key={i}
                          className="w-1 h-1 rounded-full bg-accent"
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.2 }}
                        />
                      ))}
                    </motion.div>
                  </motion.div>
                ) : (
                  // 正常显示：上下文使用率 + Token 累计
                  <motion.div
                    key="normal"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-2 px-2 py-1 rounded-full hover:bg-white/5 transition-all cursor-pointer group"
                  >
                    {/* 上下文使用率 */}
                    <div className={`flex items-center gap-1.5 ${compressionStats?.level === 4 ? 'text-red-400' :
                      compressionStats?.level === 3 ? 'text-orange-400' :
                        compressionStats?.level === 2 ? 'text-yellow-400' :
                          compressionStats?.level === 1 ? 'text-blue-400' :
                            'text-emerald-400'
                      }`}>
                      <Layers className="w-3 h-3 group-hover:scale-110 transition-transform" />
                      <span className="text-[10px] font-bold font-mono">
                        {compressionStats ? `${(compressionStats.ratio * 100).toFixed(1)}%` : '0%'}
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            }
            width={340} height={480} language={language as 'en' | 'zh'}
          >
            <ContextStatsContent
              totalUsage={tokenStats.totalUsage}
              lastUsage={tokenStats.lastUsage}
              language={language as 'en' | 'zh'}
            />
          </BottomBarPopover>

          {messageCount > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full cursor-default text-text-muted hover:text-text-primary hover:bg-white/5 transition-all">
              <MessageSquare className="w-3 h-3" />
              <span className="font-bold">{messageCount}</span>
            </div>
          )}
        </div>

        {/* Tools Group */}
        <div className="flex items-center gap-1 h-full">
          {/* 计划列表 */}
          {plans.length > 0 && (
            <BottomBarPopover
              icon={
                <div className="relative">
                  <ListTodo className="w-3.5 h-3.5" />
                  {executingPlansCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-accent rounded-full animate-pulse" />
                  )}
                </div>
              }
              tooltip={language === 'zh' ? '任务计划' : 'Task Plans'}
              title={language === 'zh' ? '任务计划' : 'Task Plans'}
              badge={activePlanId ? undefined : plans.length}
              width={340} height={360} language={language as 'en' | 'zh'}
            >
              <PlanListContent language={language as 'en' | 'zh'} />
            </BottomBarPopover>
          )}

          {/* 工具调用日志 */}
          <BottomBarPopover
            icon={<ScrollText className="w-3.5 h-3.5" />}
            badge={toolCallLogs.length || undefined}
            width={380} height={280} language={language as 'en' | 'zh'}
          >
            <ToolCallLogContent language={language as 'en' | 'zh'} />
          </BottomBarPopover>
        </div>

        {/* Panel Toggles */}
        <div className="flex items-center gap-1 h-full px-2">
          <button
            onClick={() => setTerminalVisible(!terminalVisible)}
            className={`p-1.5 rounded-lg transition-all ${terminalVisible ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-text-primary hover:bg-white/5'}`}
            title="Toggle Terminal"
          >
            <Terminal className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setDebugVisible(!debugVisible)}
            className={`p-1.5 rounded-lg transition-all ${debugVisible ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-text-primary hover:bg-white/5'}`}
            title="Toggle Debug"
          >
            <Bug className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Context Info */}
        <div className="flex items-center gap-4 pl-2">
          <LspStatusIndicator />

          {activeFilePath && (
            <div className="text-[9px] font-black uppercase tracking-widest text-accent opacity-60 select-none">
              {activeFilePath.split('.').pop() || 'TXT'}
            </div>
          )}

          <div className="flex items-center gap-2 cursor-pointer hover:bg-white/5 px-2 py-0.5 rounded transition-colors font-mono opacity-50 hover:opacity-100 text-[9px]">
            <span>Ln {cursorPosition?.line || 1}, Col {cursorPosition?.column || 1}</span>
          </div>
        </div>
      </div>
    </div>
  )
}