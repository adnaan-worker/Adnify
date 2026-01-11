/**
 * 更新指示器组件
 * 显示在顶部栏，有更新时显示提示
 */

import { useState, useEffect, useRef } from 'react'
import { Download, RefreshCw, CheckCircle, AlertCircle, Loader2, ExternalLink, X, ArrowUpCircle, Sparkles, Zap } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { updaterService, UpdateStatus } from '@services/updaterService'
import { useStore } from '@store'
import { api } from '@/renderer/services/electronAPI'

export default function UpdateIndicator() {
  const { language } = useStore()
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [showPopover, setShowPopover] = useState(false)
  const [currentVersion, setCurrentVersion] = useState<string>('')
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    updaterService.initialize()
    const unsubscribe = updaterService.subscribe(setStatus)
    updaterService.getStatus().then(setStatus)
    api.getAppVersion().then(setCurrentVersion)
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPopover(false)
      }
    }
    if (showPopover) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showPopover])

  const handleCheck = async () => await updaterService.checkForUpdates()
  
  const handleDownload = async () => {
    if (status?.isPortable) updaterService.openDownloadPage()
    else await updaterService.downloadUpdate()
  }

  const handleInstall = () => updaterService.installAndRestart()

  const hasUpdate = status?.status === 'available' || status?.status === 'downloaded'
  const isChecking = status?.status === 'checking'
  const isDownloading = status?.status === 'downloading'
  const isError = status?.status === 'error'

  const t = {
    title: language === 'zh' ? '系统更新' : 'System Update',
    checking: language === 'zh' ? '正在检查新版本...' : 'Checking for updates...',
    available: language === 'zh' ? '发现新版本' : 'New Version Available',
    downloaded: language === 'zh' ? '更新已就绪' : 'Update Ready',
    downloading: language === 'zh' ? '正在下载更新' : 'Downloading Update',
    notAvailable: language === 'zh' ? '已是最新版本' : 'You are up to date',
    error: language === 'zh' ? '检查失败' : 'Update Failed',
    download: language === 'zh' ? '立即更新' : 'Update Now',
    install: language === 'zh' ? '重启生效' : 'Restart to Apply',
    openPage: language === 'zh' ? '前往下载' : 'Go to Download',
    checkNow: language === 'zh' ? '检查更新' : 'Check for Updates',
    version: language === 'zh' ? '版本' : 'Version',
    portableHint: language === 'zh' ? '便携版需手动下载安装' : 'Manual download required for portable version',
  }

  return (
    <div className="relative z-50" ref={popoverRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setShowPopover(!showPopover)}
        className={`relative flex items-center justify-center w-8 h-8 rounded-full transition-all duration-300 group ${
          hasUpdate 
            ? 'bg-accent/10 text-accent ring-1 ring-accent/20 hover:bg-accent/20 hover:shadow-[0_0_15px_-3px_rgba(var(--accent),0.3)]' 
            : isError
              ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20 hover:bg-red-500/20'
              : showPopover
                ? 'bg-surface text-text-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-white/5'
        }`}
        title={hasUpdate ? t.available : t.checkNow}
      >
        {isChecking || isDownloading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : hasUpdate ? (
          <ArrowUpCircle className="w-4 h-4" />
        ) : isError ? (
          <AlertCircle className="w-4 h-4" />
        ) : (
          <Sparkles className="w-4 h-4 opacity-70 group-hover:opacity-100" />
        )}
        
        {hasUpdate && (
          <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-accent rounded-full border-2 border-background animate-pulse" />
        )}
      </button>

      {/* Popover */}
      <AnimatePresence>
        {showPopover && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="absolute right-0 top-full mt-3 w-80 rounded-2xl bg-background/80 backdrop-blur-2xl border border-white/10 shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <h3 className="text-sm font-bold text-text-primary tracking-tight flex items-center gap-2">
                <Zap className="w-4 h-4 text-accent" />
                {t.title}
              </h3>
              <button
                onClick={() => setShowPopover(false)}
                className="p-1 rounded-full hover:bg-white/10 text-text-muted hover:text-text-primary transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-5">
              
              {/* Status Hero */}
              <div className="flex flex-col items-center text-center space-y-3 py-2">
                <div className={`p-4 rounded-full mb-1 ${
                  hasUpdate ? 'bg-accent/10 text-accent shadow-[0_0_20px_-5px_rgba(var(--accent),0.3)]' :
                  isChecking || isDownloading ? 'bg-blue-500/10 text-blue-400' :
                  isError ? 'bg-red-500/10 text-red-400' :
                  'bg-green-500/10 text-green-400'
                }`}>
                  {isChecking || isDownloading ? <Loader2 className="w-8 h-8 animate-spin" /> :
                   hasUpdate ? <ArrowUpCircle className="w-8 h-8" /> :
                   isError ? <AlertCircle className="w-8 h-8" /> :
                   <CheckCircle className="w-8 h-8" />}
                </div>
                
                <div>
                  <h4 className="text-base font-bold text-text-primary mb-1">
                    {status?.status === 'available' ? t.available :
                     status?.status === 'downloaded' ? t.downloaded :
                     status?.status === 'downloading' ? t.downloading :
                     status?.status === 'checking' ? t.checking :
                     status?.status === 'error' ? t.error :
                     t.notAvailable}
                  </h4>
                  
                  {/* Version Info */}
                  <div className="flex items-center justify-center gap-2 text-xs">
                     {status?.version && hasUpdate ? (
                       <>
                        <span className="text-text-muted line-through opacity-50">v{currentVersion}</span>
                        <span className="text-text-muted">→</span>
                        <span className="font-mono font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded">v{status.version}</span>
                       </>
                     ) : (
                       <span className="text-text-muted font-mono">v{currentVersion}</span>
                     )}
                  </div>
                </div>
              </div>

              {/* Progress Bar */}
              {isDownloading && status?.progress !== undefined && (
                <div className="space-y-1.5">
                  <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-accent shadow-[0_0_10px_rgba(var(--accent),0.5)]"
                      initial={{ width: 0 }}
                      animate={{ width: `${status.progress}%` }}
                      transition={{ ease: "linear" }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] font-medium text-text-muted uppercase">
                    <span>{t.downloading}</span>
                    <span>{status.progress.toFixed(0)}%</span>
                  </div>
                </div>
              )}

              {/* Portable Hint */}
              {hasUpdate && status?.isPortable && (
                <div className="px-3 py-2.5 rounded-lg bg-yellow-500/5 border border-yellow-500/10 text-xs text-yellow-500/90 text-center leading-relaxed">
                  {t.portableHint}
                </div>
              )}

              {/* Error Message */}
              {isError && status?.error && (
                <div className="px-3 py-2.5 rounded-lg bg-red-500/5 border border-red-500/10 text-xs text-red-400 text-center leading-relaxed">
                  {status.error}
                </div>
              )}

              {/* Actions */}
              <div className="pt-2">
                {hasUpdate ? (
                  status?.status === 'downloaded' ? (
                    <button
                      onClick={handleInstall}
                      className="w-full py-2.5 rounded-xl bg-green-500 hover:bg-green-600 text-white text-sm font-bold shadow-lg shadow-green-500/20 transition-all active:scale-[0.98]"
                    >
                      {t.install}
                    </button>
                  ) : (
                    <button
                      onClick={handleDownload}
                      className="w-full py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-bold shadow-lg shadow-accent/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                      {status?.isPortable ? <ExternalLink className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                      {status?.isPortable ? t.openPage : t.download}
                    </button>
                  )
                ) : (
                  (!isChecking && !isDownloading) && (
                    <button
                      onClick={handleCheck}
                      className="w-full py-2.5 rounded-xl bg-surface hover:bg-white/10 border border-white/5 text-text-secondary hover:text-text-primary text-sm font-bold transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                      <RefreshCw className="w-4 h-4" />
                      {t.checkNow}
                    </button>
                  )
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
