/**
 * 更新指示器组件
 * 显示在顶部栏，有更新时显示提示
 */

import { useState, useEffect, useRef } from 'react'
import { Download, RefreshCw, CheckCircle, AlertCircle, Loader2, ExternalLink, X, ArrowUpCircle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { updaterService, UpdateStatus } from '@services/updaterService'
import { useStore } from '@store'
import { api } from '@/renderer/services/electronAPI'

export default function UpdateIndicator() {
  const language = useStore(s => s.language)
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
          <Download className="w-4 h-4 opacity-70 group-hover:opacity-100" />
        )}
        
        {hasUpdate && (
          <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-accent rounded-full border-2 border-background animate-pulse" />
        )}
      </button>

      {/* Popover */}
      <AnimatePresence>
        {showPopover && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 400 }}
            className="absolute right-0 top-full mt-3 w-[320px] rounded-3xl bg-surface/80 backdrop-blur-3xl border border-border/50 shadow-[0_20px_50px_rgba(0,0,0,0.3)] overflow-hidden origin-top-right"
          >
            {/* Header - Minimal */}
            <div className="flex items-center justify-between px-6 py-4 bg-white/5">
              <span className="text-[10px] font-black text-text-muted uppercase tracking-[0.2em]">{t.title}</span>
              <button
                onClick={() => setShowPopover(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-text-muted transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              
              {/* Status Hero */}
              <div className="flex flex-col items-center text-center mb-6">
                <div className={`relative mb-4 group/icon`}>
                  <div className={`absolute inset-0 blur-2xl rounded-full opacity-40 transition-all duration-500 ${
                    hasUpdate ? 'bg-accent group-hover/icon:opacity-60' :
                    isError ? 'bg-red-500' : 'bg-emerald-500'
                  }`} />
                  <div className={`relative w-16 h-16 rounded-3xl flex items-center justify-center border border-white/10 shadow-xl ${
                    hasUpdate ? 'bg-accent text-white' :
                    isChecking || isDownloading ? 'bg-surface-active text-accent' :
                    isError ? 'bg-red-500/20 text-red-400' :
                    'bg-emerald-500/20 text-emerald-400'
                  }`}>
                    {isChecking || isDownloading ? <Loader2 className="w-8 h-8 animate-spin" /> :
                     hasUpdate ? <ArrowUpCircle className="w-8 h-8" /> :
                     isError ? <AlertCircle className="w-8 h-8" /> :
                     <CheckCircle className="w-8 h-8" />}
                  </div>
                </div>
                
                <h4 className="text-lg font-bold text-text-primary tracking-tight">
                  {status?.status === 'available' ? t.available :
                   status?.status === 'downloaded' ? t.downloaded :
                   status?.status === 'downloading' ? t.downloading :
                   status?.status === 'checking' ? t.checking :
                   status?.status === 'error' ? t.error :
                   t.notAvailable}
                </h4>
                
                {/* Version Flow */}
                <div className="mt-2 flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/5 text-[11px] font-medium">
                   {status?.version && hasUpdate ? (
                     <>
                      <span className="text-text-muted opacity-60">v{currentVersion}</span>
                      <div className="w-1 h-1 rounded-full bg-text-muted opacity-30" />
                      <span className="text-accent font-bold">v{status.version}</span>
                     </>
                   ) : (
                     <span className="text-text-muted">Current: v{currentVersion}</span>
                   )}
                </div>
              </div>

              {/* Download Progress */}
              {isDownloading && status?.progress !== undefined && (
                <div className="mb-6 space-y-2">
                  <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-accent shadow-[0_0_12px_rgba(var(--accent),0.8)]"
                      initial={{ width: 0 }}
                      animate={{ width: `${status.progress}%` }}
                      transition={{ ease: "circOut" }}
                    />
                  </div>
                  <div className="flex justify-between text-[9px] font-bold text-text-muted uppercase tracking-widest opacity-60">
                    <span>{t.downloading}</span>
                    <span className="text-accent">{status.progress.toFixed(0)}%</span>
                  </div>
                </div>
              )}

              {/* Portable Hint */}
              {hasUpdate && status?.isPortable && (
                <div className="mb-6 px-4 py-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200/80 leading-relaxed text-center">
                  {t.portableHint}
                </div>
              )}

              {/* Actions */}
              <div className="space-y-2">
                {hasUpdate ? (
                  status?.status === 'downloaded' ? (
                    <button
                      onClick={handleInstall}
                      className="w-full h-11 rounded-2xl bg-green-500 hover:bg-green-600 text-white text-sm font-bold shadow-[0_10px_20px_-5px_rgba(34,197,94,0.4)] transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                      <RefreshCw className="w-4 h-4" />
                      {t.install}
                    </button>
                  ) : (
                    <button
                      onClick={handleDownload}
                      className="w-full h-11 rounded-2xl bg-accent hover:bg-accent-hover text-white text-sm font-bold shadow-[0_10px_20px_-5px_rgba(var(--accent)/0.4)] transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                      {status?.isPortable ? <ExternalLink className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                      {status?.isPortable ? t.openPage : t.download}
                    </button>
                  )
                ) : (
                  (!isChecking && !isDownloading) && (
                    <button
                      onClick={handleCheck}
                      className="w-full h-11 rounded-2xl bg-surface-active hover:bg-white/10 border border-border/50 text-text-primary text-sm font-bold transition-all active:scale-95 flex items-center justify-center gap-2"
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
