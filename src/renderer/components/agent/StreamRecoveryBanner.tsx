/**
 * 流式恢复横幅组件
 * 当检测到可恢复的中断会话时显示
 */

import { useState, useEffect, useCallback } from 'react'
import { AlertCircle, RefreshCw, X, ChevronDown, ChevronUp } from 'lucide-react'
import { streamRecoveryService } from '@/renderer/agent/services/StreamRecoveryService'
import { Button } from '../ui'

interface StreamRecoveryBannerProps {
  language?: 'zh' | 'en'
  onRecover?: () => void
  onDismiss?: () => void
}

export default function StreamRecoveryBanner({
  language = 'en',
  onRecover,
  onDismiss,
}: StreamRecoveryBannerProps) {
  const [recoverableSessions, setRecoverableSessions] = useState<ReturnType<typeof streamRecoveryService.getRecoverableSessions>>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [isRecovering, setIsRecovering] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  // 检查可恢复的会话
  useEffect(() => {
    // 清理旧的存储数据，避免误报
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i)
        if (key?.startsWith('stream-recovery-')) {
          sessionStorage.removeItem(key)
        }
      }
    } catch {
      // ignore
    }

    const checkSessions = () => {
      if (dismissed) return
      const sessions = streamRecoveryService.getRecoverableSessions()
      // 只显示最近 2 分钟内的中断会话
      const recentSessions = sessions.filter(s => Date.now() - s.timestamp < 2 * 60 * 1000)
      setRecoverableSessions(recentSessions)
    }

    // 初始检查
    checkSessions()

    // 定期检查（降低频率）
    const interval = setInterval(checkSessions, 10000)
    return () => clearInterval(interval)
  }, [dismissed])

  const handleRecover = useCallback(async (recoveryId: string) => {
    setIsRecovering(true)
    try {
      const success = streamRecoveryService.recoverFromPoint(recoveryId)
      if (success) {
        onRecover?.()
      }
    } finally {
      setIsRecovering(false)
    }
  }, [onRecover])

  const handleDismiss = useCallback(() => {
    streamRecoveryService.clearAll()
    setRecoverableSessions([])
    setDismissed(true)
    onDismiss?.()
  }, [onDismiss])

  const formatTime = (timestamp: number) => {
    const now = Date.now()
    const diff = now - timestamp
    
    if (diff < 60000) {
      return language === 'zh' ? '刚刚' : 'Just now'
    }
    if (diff < 3600000) {
      const mins = Math.floor(diff / 60000)
      return language === 'zh' ? `${mins} 分钟前` : `${mins}m ago`
    }
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000)
      return language === 'zh' ? `${hours} 小时前` : `${hours}h ago`
    }
    return new Date(timestamp).toLocaleDateString()
  }

  // 没有可恢复的会话时不显示
  if (recoverableSessions.length === 0) {
    return null
  }

  const latestSession = recoverableSessions[0]

  return (
    <div className="mx-4 mt-2 animate-slide-down">
      <div className="p-3 rounded-xl border border-warning/20 bg-warning/5 backdrop-blur-sm">
        {/* Main Banner */}
        <div className="flex items-start gap-3">
          <div className="p-1.5 rounded-lg bg-warning/10">
            <AlertCircle className="w-4 h-4 text-warning" />
          </div>
          
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-warning">
              {language === 'zh' ? '检测到中断的会话' : 'Interrupted Session Detected'}
            </p>
            <p className="text-xs text-text-muted mt-0.5">
              {language === 'zh' 
                ? `上次响应在 ${formatTime(latestSession.timestamp)} 中断`
                : `Last response was interrupted ${formatTime(latestSession.timestamp)}`}
            </p>
            
            {latestSession.partialContent && (
              <p className="text-xs text-text-muted mt-1 truncate">
                {latestSession.partialContent.slice(0, 100)}...
              </p>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleRecover(latestSession.id)}
              disabled={isRecovering}
              className="h-7 px-2 text-xs bg-warning/10 hover:bg-warning/20 text-warning"
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${isRecovering ? 'animate-spin' : ''}`} />
              {language === 'zh' ? '恢复' : 'Recover'}
            </Button>
            
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDismiss}
              className="h-7 w-7 hover:bg-white/5"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Expandable Details */}
        {recoverableSessions.length > 1 && (
          <>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1 mt-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {language === 'zh' 
                ? `还有 ${recoverableSessions.length - 1} 个可恢复的会话`
                : `${recoverableSessions.length - 1} more recoverable session${recoverableSessions.length > 2 ? 's' : ''}`}
            </button>

            {isExpanded && (
              <div className="mt-2 space-y-2 pt-2 border-t border-white/5">
                {recoverableSessions.slice(1).map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-white/5"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-text-secondary truncate">
                        {session.partialContent?.slice(0, 50) || 'Empty response'}...
                      </p>
                      <p className="text-xs text-text-muted">
                        {formatTime(session.timestamp)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRecover(session.id)}
                      disabled={isRecovering}
                      className="h-6 px-2 text-xs"
                    >
                      {language === 'zh' ? '恢复' : 'Recover'}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * 恢复进度指示器
 */
export function RecoveryProgressIndicator({
  language = 'en',
}: {
  language?: 'zh' | 'en'
}) {
  const [isRecovering, setIsRecovering] = useState(false)

  useEffect(() => {
    // 监听恢复状态
    const checkRecovering = () => {
      setIsRecovering(streamRecoveryService.canRecover())
    }
    
    const interval = setInterval(checkRecovering, 1000)
    return () => clearInterval(interval)
  }, [])

  if (!isRecovering) return null

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-xs text-accent">
      <RefreshCw className="w-3 h-3 animate-spin" />
      <span>{language === 'zh' ? '正在恢复...' : 'Recovering...'}</span>
    </div>
  )
}
