import { useEffect, useState } from 'react'
import { GitBranch, AlertCircle, XCircle, Database, Loader2, Cpu } from 'lucide-react'
import { useStore } from '../store'
import { t } from '../i18n'
import { IndexStatus } from '../types/electron'
import { indexWorkerService, IndexProgress } from '../services/indexWorkerService'

export default function StatusBar() {
  const { activeFilePath, isStreaming, workspacePath, setShowSettings, language } = useStore()
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null)
  const [workerProgress, setWorkerProgress] = useState<IndexProgress | null>(null)

  // 初始化 Worker 并监听进度
  useEffect(() => {
    indexWorkerService.initialize()

    const unsubProgress = indexWorkerService.onProgress(setWorkerProgress)
    const unsubError = indexWorkerService.onError((error) => {
      console.error('[StatusBar] Worker error:', error)
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

  return (
    <div className="h-6 bg-transparent border-t border-white/5 flex items-center justify-between px-3 text-[11px] select-none text-text-muted backdrop-blur-sm">
      <div className="flex items-center gap-4">
        <button className="flex items-center gap-1.5 hover:text-text-primary transition-colors">
          <GitBranch className="w-3 h-3" />
          <span>main</span>
        </button>

        {/* Diagnostics */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 hover:text-text-primary transition-colors cursor-pointer">
            <XCircle className="w-3 h-3" />
            <span>0</span>
          </div>
          <div className="flex items-center gap-1 hover:text-text-primary transition-colors cursor-pointer">
            <AlertCircle className="w-3 h-3" />
            <span>0</span>
          </div>
        </div>

        {/* Worker 状态 */}
        {workerProgress && !workerProgress.isComplete && (
          <div className="flex items-center gap-1.5 text-accent">
            <Cpu className="w-3 h-3 animate-pulse" />
            <span>
              Worker: {workerProgress.processed}/{workerProgress.total}
            </span>
          </div>
        )}

        {/* 索引状态 */}
        {workspacePath && (
          <button
            onClick={handleIndexClick}
            className="flex items-center gap-1.5 hover:text-text-primary transition-colors"
            title={t('codebaseIndex', language)}
          >
            {indexStatus?.isIndexing ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin text-accent" />
                <span className="text-accent">
                  {t('indexing', language)} {indexStatus.indexedFiles}/{indexStatus.totalFiles}
                </span>
              </>
            ) : indexStatus?.totalChunks ? (
              <>
                <Database className="w-3 h-3 text-green-400" />
                <span>{indexStatus.totalChunks} {t('chunks', language)}</span>
              </>
            ) : (
              <>
                <Database className="w-3 h-3 opacity-50" />
                <span className="opacity-50">{t('notIndexed', language)}</span>
              </>
            )}
          </button>
        )}
      </div>

      <div className="flex items-center gap-4">
        {isStreaming && (
          <div className="flex items-center gap-2 text-accent">
            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span>{t('aiProcessing', language)}</span>
          </div>
        )}

        <div className="flex items-center gap-4">
          {activeFilePath && (
            <span>{activeFilePath.split('.').pop()?.toUpperCase() || 'TXT'}</span>
          )}
          <span className="cursor-pointer hover:text-text-primary">UTF-8</span>
          <div className="flex items-center gap-2 cursor-pointer hover:text-text-primary">
            <span>Ln 1, Col 1</span>
          </div>
        </div>
      </div>
    </div>
  )
}
