/**
 * LSP 状态指示器
 * 显示在状态栏右下角，点击可安装 LSP 服务器
 */

import { useState, useEffect, useCallback } from 'react'
import { Zap, ZapOff, Download, Loader2, CheckCircle2 } from 'lucide-react'
import { useStore } from '@store'
import { api } from '@/renderer/services/electronAPI'
import { getLanguageId, isLanguageSupported } from '@/renderer/services/lspService'
import BottomBarPopover from '../ui/BottomBarPopover'
import { logger } from '@shared/utils/Logger'

interface LspServerStatus {
  installed: boolean
  path?: string
}

// 语言到服务器类型的映射
const LANGUAGE_TO_SERVER: Record<string, string> = {
  typescript: 'typescript',
  typescriptreact: 'typescript',
  javascript: 'typescript',
  javascriptreact: 'typescript',
  html: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  json: 'json',
  jsonc: 'json',
  python: 'python',
  go: 'go',
  rust: 'rust',
  c: 'clangd',
  cpp: 'clangd',
  vue: 'vue',
  php: 'php',
}

// 服务器显示名称
const SERVER_NAMES: Record<string, string> = {
  typescript: 'TypeScript Language Server',
  html: 'HTML Language Server',
  css: 'CSS Language Server',
  json: 'JSON Language Server',
  python: 'Pyright (Python)',
  go: 'gopls (Go)',
  rust: 'rust-analyzer',
  clangd: 'clangd (C/C++)',
  vue: 'Vue Language Server',
  php: 'Intelephense (PHP)',
}

// 安装说明
const INSTALL_HINTS: Record<string, { auto: boolean; hint: string; builtin?: boolean }> = {
  typescript: { auto: true, hint: '可自动安装', builtin: true },
  html: { auto: true, hint: '可自动安装', builtin: true },
  css: { auto: true, hint: '可自动安装', builtin: true },
  json: { auto: true, hint: '可自动安装', builtin: true },
  python: { auto: true, hint: '可自动安装 Pyright' },
  go: { auto: true, hint: '需要系统已安装 Go' },
  rust: { auto: false, hint: '请运行: rustup component add rust-analyzer' },
  clangd: { auto: false, hint: '请安装 LLVM/Clang' },
  vue: { auto: true, hint: '可自动安装' },
  php: { auto: true, hint: '可自动安装 Intelephense' },
}

export default function LspStatusIndicator() {
  const { activeFilePath, language } = useStore()
  const [serverStatus, setServerStatus] = useState<Record<string, LspServerStatus>>({})
  const [installing, setInstalling] = useState<string | null>(null)
  const [currentLanguageId, setCurrentLanguageId] = useState<string | null>(null)

  // 获取当前文件的语言 ID
  useEffect(() => {
    if (activeFilePath) {
      const langId = getLanguageId(activeFilePath)
      setCurrentLanguageId(langId)
    } else {
      setCurrentLanguageId(null)
    }
  }, [activeFilePath])

  // 获取服务器状态
  useEffect(() => {
    api.lsp.getServerStatus().then(setServerStatus).catch(() => { })
  }, [])

  // 安装服务器
  const handleInstall = useCallback(async (serverType: string) => {
    setInstalling(serverType)
    try {
      const result = await api.lsp.installServer(serverType)
      if (result.success) {
        // 刷新状态
        const newStatus = await api.lsp.getServerStatus()
        setServerStatus(newStatus)
      } else {
        logger.lsp.error('Install failed:', result.error)
      }
    } catch (error) {
      logger.lsp.error('Install error:', error)
    } finally {
      setInstalling(null)
    }
  }, [])

  // 当前语言对应的服务器类型
  const currentServerType = currentLanguageId ? LANGUAGE_TO_SERVER[currentLanguageId] : null
  const isSupported = currentLanguageId ? isLanguageSupported(currentLanguageId) : false
  const currentStatus = currentServerType ? serverStatus[currentServerType] : null
  const isInstalled = currentStatus?.installed ?? false
  const installInfo = currentServerType ? INSTALL_HINTS[currentServerType] : null

  // 如果没有打开文件或语言不支持 LSP，不显示
  if (!activeFilePath || !isSupported || !currentServerType) {
    return null
  }

  return (
    <BottomBarPopover
      icon={
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-white/5 transition-all ${isInstalled ? 'text-emerald-400' : 'text-amber-400'}`}>
          {isInstalled ? (
            <Zap className="w-3 h-3 fill-current" />
          ) : (
            <ZapOff className="w-3 h-3" />
          )}
          <span className="text-[10px] font-bold tracking-tighter">LSP</span>
        </div>
      }
      tooltip={
        isInstalled
          ? (language === 'zh' ? 'LSP 已启用' : 'LSP Enabled')
          : (language === 'zh' ? 'LSP 未安装，点击安装' : 'LSP not installed, click to install')
      }
      title={language === 'zh' ? 'LSP 语言服务器' : 'LSP Language Server'}
      width={320}
      height={200}
      language={language as 'en' | 'zh'}
    >
      <div className="p-3 space-y-3">
        {/* 当前语言服务器状态 */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-text-primary">
              {SERVER_NAMES[currentServerType] || currentServerType}
            </div>
            <div className="text-xs text-text-muted mt-0.5">
              {language === 'zh' ? '当前文件语言' : 'Current file language'}: {currentLanguageId}
            </div>
          </div>
          <div className={`flex items-center gap-1.5 ${isInstalled ? 'text-green-400' : 'text-yellow-400'}`}>
            {isInstalled ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-xs">{language === 'zh' ? '已安装' : 'Installed'}</span>
              </>
            ) : (
              <>
                <ZapOff className="w-4 h-4" />
                <span className="text-xs">{language === 'zh' ? '未安装' : 'Not installed'}</span>
              </>
            )}
          </div>
        </div>

        {/* 安装按钮或提示 */}
        {!isInstalled && installInfo && (
          <div className="space-y-2">
            <div className="text-xs text-text-muted">
              {installInfo.hint}
            </div>
            {installInfo.auto ? (
              <button
                onClick={() => handleInstall(currentServerType)}
                disabled={installing !== null}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-accent/20 hover:bg-accent/30 text-accent rounded-md transition-colors disabled:opacity-50"
              >
                {installing === currentServerType ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{language === 'zh' ? '安装中...' : 'Installing...'}</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>{language === 'zh' ? '安装语言服务器' : 'Install Language Server'}</span>
                  </>
                )}
              </button>
            ) : (
              <div className="text-xs text-orange-400 bg-orange-400/10 px-3 py-2 rounded-md">
                {language === 'zh' ? '需要手动安装' : 'Manual installation required'}
              </div>
            )}
          </div>
        )}

        {/* 已安装时显示路径 */}
        {isInstalled && currentStatus?.path && (
          <div className="space-y-1">
            {installInfo?.builtin && (
              <div className="text-xs text-blue-400">
                {language === 'zh' ? '内置语言服务器' : 'Built-in Language Server'}
              </div>
            )}
            <div className="text-xs text-text-muted bg-background-tertiary px-2 py-1.5 rounded font-mono truncate">
              {currentStatus.path}
            </div>
          </div>
        )}
      </div>
    </BottomBarPopover>
  )
}
