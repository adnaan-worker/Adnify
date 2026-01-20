/**
 * 系统设置组件
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useState, useEffect, useRef } from 'react'
import { HardDrive, AlertTriangle, Monitor, Download, Upload, FileText, ExternalLink } from 'lucide-react'
import { toast } from '@components/common/ToastProvider'
import { Button, Switch } from '@components/ui'
import { Language } from '@renderer/i18n'
import { useStore } from '@store'
import { downloadSettings, importSettings, settingsService } from '@renderer/settings'
import { Agent } from '@/renderer/agent'
import { memoryService } from '@/renderer/agent/services/memoryService'
import type { ProviderModelConfig, SettingsState } from '@shared/config/settings'

interface SystemSettingsProps {
    language: Language
}

function DataPathDisplay() {
    const [path, setPath] = useState('')
    useEffect(() => {
        // @ts-ignore
        api.settings.getConfigPath?.().then(setPath)
    }, [])
    return <span>{path || '...'}</span>
}

export function SystemSettings({ language }: SystemSettingsProps) {
    const [isClearing, setIsClearing] = useState(false)
    const [includeApiKeys, setIncludeApiKeys] = useState(false)
    const [logPath, setLogPath] = useState('')
    const fileInputRef = useRef<HTMLInputElement>(null)
    const store = useStore()
    
    // 从 store 中获取 enableFileLogging
    const enableFileLogging = store.enableFileLogging

    // 获取日志文件路径
    useEffect(() => {
        const getLogPath = async () => {
            try {
                const userDataPath = await api.settings.getUserDataPath()
                if (userDataPath) {
                    setLogPath(`${userDataPath}/logs/main.log`)
                }
            } catch (err) {
                logger.settings.error('Failed to get log path:', err)
            }
        }
        getLogPath()
    }, [])

    const handleToggleFileLogging = async (enabled: boolean) => {
        try {
            // 使用 store 的统一 API
            store.set('enableFileLogging', enabled)
            await store.save()
            
            if (enabled) {
                toast.success(language === 'zh' ? '文件日志已启用，重启后生效' : 'File logging enabled, restart required')
            } else {
                toast.success(language === 'zh' ? '文件日志已禁用，重启后生效' : 'File logging disabled, restart required')
            }
        } catch (err) {
            logger.settings.error('Failed to toggle file logging:', err)
            toast.error(language === 'zh' ? '设置失败' : 'Failed to update setting')
        }
    }

    // 构建当前设置对象（直接从 settingsService 缓存获取）
    const getCurrentSettings = (): SettingsState => {
        const cached = settingsService.getCache()
        if (cached) return cached
        
        // 如果缓存不存在，从 store 构建
        return {
            llmConfig: store.llmConfig,
            language: store.language,
            autoApprove: store.autoApprove,
            promptTemplateId: store.promptTemplateId,
            providerConfigs: store.providerConfigs,
            agentConfig: store.agentConfig,
            editorConfig: store.editorConfig,
            securitySettings: store.securitySettings,
            webSearchConfig: store.webSearchConfig,
            mcpConfig: store.mcpConfig,
            aiInstructions: store.aiInstructions,
            onboardingCompleted: store.onboardingCompleted,
            enableFileLogging: store.enableFileLogging,
        }
    }

    const handleExport = () => {
        try {
            downloadSettings(getCurrentSettings(), includeApiKeys)
            toast.success(language === 'zh' ? '配置已导出' : 'Settings exported')
        } catch (error) {
            logger.settings.error('Failed to export settings:', error)
            toast.error(language === 'zh' ? '导出失败' : 'Export failed')
        }
    }

    const handleImport = () => {
        fileInputRef.current?.click()
    }

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        try {
            const text = await file.text()
            const result = importSettings(text)
            
            if (!result.success || !result.settings) {
                toast.error(result.error || (language === 'zh' ? '导入失败' : 'Import failed'))
                return
            }

            const settings = result.settings

            // 应用导入的设置
            if (settings.language) store.set('language', settings.language as 'en' | 'zh')
            if (settings.autoApprove) store.set('autoApprove', settings.autoApprove)
            if (settings.promptTemplateId) store.set('promptTemplateId', settings.promptTemplateId)
            if (settings.agentConfig) store.set('agentConfig', settings.agentConfig)
            if (settings.aiInstructions !== undefined) store.set('aiInstructions', settings.aiInstructions)
            
            // 应用 provider 配置
            if (settings.providerConfigs) {
                for (const [id, config] of Object.entries(settings.providerConfigs)) {
                    store.setProvider(id, config as ProviderModelConfig)
                }
            }

            // 应用 LLM 配置
            if (settings.llmConfig) {
                store.update('llmConfig', {
                    provider: settings.llmConfig.provider || store.llmConfig.provider,
                    model: settings.llmConfig.model || store.llmConfig.model,
                })
            }

            toast.success(language === 'zh' ? '配置已导入' : 'Settings imported')
        } catch (error) {
            logger.settings.error('Failed to import settings:', error)
            toast.error(language === 'zh' ? '导入失败' : 'Import failed')
        }

        // 清空 input
        e.target.value = ''
    }

    const handleClearCache = async () => {
        setIsClearing(true)
        try {
            // 1. 清除 localStorage 缓存
            const keysToRemove = ['adnify-editor-config', 'adnify-workspace', 'adnify-sessions', 'adnify-threads']
            keysToRemove.forEach(key => localStorage.removeItem(key))
            
            // 2. 清除代码库索引
            try {
                // @ts-ignore
                await (window.electronAPI as any).clearIndex?.()
            } catch { }
            
            // 3. 清除持久化编辑器配置
            await api.settings.set('editorConfig', undefined)
            
            // 4. 清除 Agent 文件读取缓存
            Agent.clearSession()
            
            // 5. 清除 Memory 服务缓存
            memoryService.clearCache()
            
            toast.success(language === 'zh' ? '缓存已清除' : 'Cache cleared')
        } catch (error) {
            logger.settings.error('Failed to clear cache:', error)
            toast.error(language === 'zh' ? '清除缓存失败' : 'Failed to clear cache')
        } finally {
            setIsClearing(false)
        }
    }

    const handleReset = async () => {
        const { globalConfirm } = await import('@components/common/ConfirmDialog')
        const confirmed = await globalConfirm({
            title: language === 'zh' ? '重置设置' : 'Reset Settings',
            message: language === 'zh' ? '确定要重置所有设置吗？这将丢失所有自定义配置。' : 'Are you sure you want to reset all settings? This will lose all custom configurations.',
            variant: 'danger',
        })
        if (confirmed) {
            // 清除所有持久化数据
            await api.settings.set('app-settings', undefined)
            await api.settings.set('editorConfig', undefined)
            await api.settings.set('securitySettings', undefined)
            await api.settings.set('currentTheme', undefined)
            localStorage.clear()
            window.location.reload()
        }
    }

    const handleOpenLogFile = async () => {
        try {
            if (logPath) {
                await api.file.showInFolder(logPath)
            }
        } catch (err) {
            logger.settings.error('Failed to open log file:', err)
            toast.error(language === 'zh' ? '打开日志文件失败' : 'Failed to open log file')
        }
    }

    const handleExportLogs = async () => {
        try {
            const logs = await api.settings.getRecentLogs()
            if (logs) {
                const blob = new Blob([logs], { type: 'text/plain' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `adnify-logs-${new Date().toISOString().slice(0, 10)}.log`
                a.click()
                URL.revokeObjectURL(url)
                toast.success(language === 'zh' ? '日志已导出' : 'Logs exported')
            } else {
                toast.error(language === 'zh' ? '没有可导出的日志' : 'No logs to export')
            }
        } catch (err) {
            logger.settings.error('Failed to export logs:', err)
            toast.error(language === 'zh' ? '导出日志失败' : 'Failed to export logs')
        }
    }

    return (
        <div className="space-y-8 animate-fade-in pb-10">
            <section>
                <div className="flex items-center gap-2 mb-5 ml-1">
                    <HardDrive className="w-4 h-4 text-accent" />
                    <h4 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.2em]">
                        {language === 'zh' ? '存储与缓存' : 'Storage & Cache'}
                    </h4>
                </div>
                <div className="space-y-4">
                    <div className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border space-y-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-text-primary">{language === 'zh' ? '配置存储路径' : 'Config Storage Path'}</div>
                                <div className="text-xs text-text-muted mt-1 opacity-70">
                                    {language === 'zh' 
                                        ? '所有配置文件（config.json、mcp.json 等）的存储位置' 
                                        : 'Storage location for all config files (config.json, mcp.json, etc.)'}
                                </div>
                            </div>
                            <Button variant="secondary" size="sm" className="rounded-xl px-4" onClick={async () => {
                                const newPath = await api.file.selectFolder()
                                if (newPath) {
                                    // @ts-ignore
                                    const success = await api.settings.setConfigPath?.(newPath)
                                    if (success) {
                                        toast.success(language === 'zh' ? '路径已更新，重启后生效' : 'Path updated, restart required to take effect')
                                    } else {
                                        toast.error(language === 'zh' ? '更新路径失败' : 'Failed to update path')
                                    }
                                }
                            }}>
                                {language === 'zh' ? '更改路径' : 'Change Path'}
                            </Button>
                        </div>

                        <div className="flex items-center gap-3 p-4 bg-background/50 rounded-xl border border-border shadow-inner">
                            <div className="p-1.5 bg-white/5 rounded-lg">
                                <HardDrive className="w-4 h-4 text-text-muted" />
                            </div>
                            <div className="text-xs text-text-secondary font-mono break-all opacity-90">
                                <DataPathDisplay />
                            </div>
                        </div>

                        <div className="flex items-center gap-2 text-[10px] font-medium text-yellow-500 bg-yellow-500/10 px-3 py-2 rounded-lg border border-yellow-500/20">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            {language === 'zh' ? '更改路径后需要手动重启应用以应用所有变更' : 'Restart application manually after changing path to apply all changes'}
                        </div>
                    </div>

                    <div className="flex items-center justify-between p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                        <div>
                            <div className="text-sm font-bold text-text-primary">{language === 'zh' ? '清除缓存' : 'Clear Cache'}</div>
                            <div className="text-xs text-text-muted mt-1 opacity-70">{language === 'zh' ? '清除编辑器缓存、索引数据和临时文件' : 'Clear editor cache, index data, and temporary files'}</div>
                        </div>
                        <Button variant="secondary" size="sm" onClick={handleClearCache} disabled={isClearing} className="rounded-xl px-6">
                            {isClearing ? (language === 'zh' ? '清除中...' : 'Clearing...') : (language === 'zh' ? '清除' : 'Clear')}
                        </Button>
                    </div>

                    <div className="flex items-center justify-between p-6 bg-red-500/10 rounded-2xl border border-red-500/20 shadow-sm">
                        <div>
                            <div className="text-sm font-bold text-red-400">{language === 'zh' ? '重置所有设置' : 'Reset All Settings'}</div>
                            <div className="text-xs text-red-400/70 mt-1">{language === 'zh' ? '恢复出厂设置，不可撤销' : 'Restore factory settings, irreversible'}</div>
                        </div>
                        <Button variant="danger" size="sm" onClick={handleReset} className="rounded-xl px-6">
                            {language === 'zh' ? '重置' : 'Reset'}
                        </Button>
                    </div>
                </div>
            </section>

            {/* 日志管理 */}
            <section>
                <div className="flex items-center gap-2 mb-5 ml-1">
                    <FileText className="w-4 h-4 text-accent" />
                    <h4 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.2em]">
                        {language === 'zh' ? '日志管理' : 'Log Management'}
                    </h4>
                </div>
                <div className="space-y-4">
                    <div className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border space-y-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-text-primary">
                                    {language === 'zh' ? '启用文件日志' : 'Enable File Logging'}
                                </div>
                                <div className="text-xs text-text-muted mt-1 opacity-70">
                                    {language === 'zh' 
                                        ? '将应用日志保存到文件，用于调试和问题排查' 
                                        : 'Save application logs to file for debugging and troubleshooting'}
                                </div>
                            </div>
                            <Switch 
                                checked={enableFileLogging} 
                                onChange={(e) => handleToggleFileLogging(e.target.checked)}
                            />
                        </div>

                        {enableFileLogging && (
                            <>
                                <div>
                                    <div className="text-sm font-bold text-text-primary mb-3">
                                        {language === 'zh' ? '日志文件位置' : 'Log File Location'}
                                    </div>
                                    {logPath && (
                                        <div className="flex items-center gap-3 p-4 bg-background/50 rounded-xl border border-border shadow-inner">
                                            <div className="p-1.5 bg-white/5 rounded-lg">
                                                <FileText className="w-4 h-4 text-text-muted" />
                                            </div>
                                            <div className="text-xs text-text-secondary font-mono break-all opacity-90 flex-1">
                                                {logPath}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-3">
                                    <Button 
                                        variant="secondary" 
                                        size="sm" 
                                        onClick={handleOpenLogFile}
                                        className="rounded-xl px-4 flex-1"
                                    >
                                        <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                                        {language === 'zh' ? '打开日志文件' : 'Open Log File'}
                                    </Button>
                                    <Button 
                                        variant="secondary" 
                                        size="sm" 
                                        onClick={handleExportLogs}
                                        className="rounded-xl px-4 flex-1"
                                    >
                                        <Download className="w-3.5 h-3.5 mr-1.5" />
                                        {language === 'zh' ? '导出日志' : 'Export Logs'}
                                    </Button>
                                </div>

                                <div className="flex items-start gap-2 text-[10px] font-medium text-blue-500 bg-blue-500/10 px-3 py-2 rounded-lg border border-blue-500/20">
                                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                                    <div>
                                        {language === 'zh' 
                                            ? '日志文件会自动轮转，最多保留 5 个文件（每个最大 10MB）。生产环境默认只记录警告和错误。' 
                                            : 'Log files rotate automatically, keeping up to 5 files (10MB each). Production mode logs warnings and errors only.'}
                                    </div>
                                </div>
                            </>
                        )}

                        {!enableFileLogging && (
                            <div className="flex items-start gap-2 text-[10px] font-medium text-text-muted bg-white/5 px-3 py-2 rounded-lg border border-border">
                                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                                <div>
                                    {language === 'zh' 
                                        ? '文件日志已禁用。启用后可以查看详细的应用运行日志，包括 LSP 安装、错误信息等。' 
                                        : 'File logging is disabled. Enable it to view detailed application logs including LSP installation, errors, etc.'}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* 配置导出/导入 */}
            <section>
                <div className="flex items-center gap-2 mb-5 ml-1">
                    <Download className="w-4 h-4 text-accent" />
                    <h4 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.2em]">
                        {language === 'zh' ? '配置备份' : 'Settings Backup'}
                    </h4>
                </div>
                <div className="space-y-4">
                    <div className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border space-y-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-text-primary">{language === 'zh' ? '导出配置' : 'Export Settings'}</div>
                                <div className="text-xs text-text-muted mt-1 opacity-70">
                                    {language === 'zh' 
                                        ? '将当前配置导出为 JSON 文件，方便备份或迁移' 
                                        : 'Export current settings to JSON file for backup or migration'}
                                </div>
                            </div>
                            <Button variant="secondary" size="sm" onClick={handleExport} className="rounded-xl px-4">
                                <Download className="w-3.5 h-3.5 mr-1.5" />
                                {language === 'zh' ? '导出' : 'Export'}
                            </Button>
                        </div>
                        
                        <div className="flex items-center justify-between py-2">
                            <div className="text-xs text-text-muted">
                                {language === 'zh' ? '包含 API 密钥（不推荐）' : 'Include API keys (not recommended)'}
                            </div>
                            <Switch 
                                checked={includeApiKeys} 
                                onChange={(e) => setIncludeApiKeys(e.target.checked)}
                            />
                        </div>
                        
                        {includeApiKeys && (
                            <div className="flex items-center gap-2 text-[10px] font-medium text-yellow-500 bg-yellow-500/10 px-3 py-2 rounded-lg border border-yellow-500/20">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                {language === 'zh' ? '导出文件将包含敏感的 API 密钥，请妥善保管' : 'Exported file will contain sensitive API keys, keep it safe'}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-between p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                        <div>
                            <div className="text-sm font-bold text-text-primary">{language === 'zh' ? '导入配置' : 'Import Settings'}</div>
                            <div className="text-xs text-text-muted mt-1 opacity-70">
                                {language === 'zh' ? '从 JSON 文件导入配置' : 'Import settings from JSON file'}
                            </div>
                        </div>
                        <Button variant="secondary" size="sm" onClick={handleImport} className="rounded-xl px-4">
                            <Upload className="w-3.5 h-3.5 mr-1.5" />
                            {language === 'zh' ? '导入' : 'Import'}
                        </Button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json"
                            onChange={handleFileChange}
                            className="hidden"
                        />
                    </div>
                </div>
            </section>

            <section>
                <div className="flex items-center gap-2 mb-5 ml-1">
                    <Monitor className="w-4 h-4 text-accent" />
                    <h4 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.2em]">
                        {language === 'zh' ? '关于' : 'About'}
                    </h4>
                </div>
                <div className="p-10 bg-background/50 backdrop-blur-xl rounded-3xl border border-border text-center shadow-inner relative overflow-hidden">
                    <div className="absolute inset-0 bg-accent/5 blur-3xl pointer-events-none" />
                    <div className="w-16 h-16 bg-accent/10 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-accent/20 shadow-xl shadow-accent/10 relative z-10">
                        <Monitor className="w-8 h-8 text-accent" />
                    </div>
                    <div className="text-2xl font-black text-text-primary mb-2 tracking-tight relative z-10">Adnify</div>
                    <div className="inline-block px-3 py-1 rounded-full bg-white/5 border border-white/5 text-[10px] font-mono text-text-muted mb-8 relative z-10">v0.1.0-alpha</div>
                    <div className="text-xs text-text-secondary opacity-60 font-medium relative z-10">
                        Built with Electron, React, Monaco Editor & Tailwind CSS
                    </div>
                </div>
            </section>
        </div>
    )
}
