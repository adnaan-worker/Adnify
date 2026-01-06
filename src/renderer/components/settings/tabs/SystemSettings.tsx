/**
 * 系统设置组件
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useState, useEffect } from 'react'
import { HardDrive, AlertTriangle, Monitor } from 'lucide-react'
import { toast } from '@components/common/ToastProvider'
import { Button } from '@components/ui'
import { Language } from '@renderer/i18n'

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

    const handleClearCache = async () => {
        setIsClearing(true)
        try {
            const keysToRemove = ['adnify-editor-config', 'adnify-workspace', 'adnify-sessions', 'adnify-threads']
            keysToRemove.forEach(key => localStorage.removeItem(key))
            try {
                // @ts-ignore
                await (window.electronAPI as any).clearIndex?.()
            } catch { }
            await api.settings.set('editorConfig', undefined)
            toast.success(language === 'zh' ? '缓存已清除' : 'Cache cleared')
        } catch (error) {
            logger.settings.error('Failed to clear cache:', error)
            toast.error(language === 'zh' ? '清除缓存失败' : 'Failed to clear cache')
        } finally {
            setIsClearing(false)
        }
    }

    const handleReset = async () => {
        if (confirm(language === 'zh' ? '确定要重置所有设置吗？这将丢失所有自定义配置。' : 'Are you sure you want to reset all settings? This will lose all custom configurations.')) {
            await api.settings.set('llmConfig', undefined)
            await api.settings.set('editorSettings', undefined)
            await api.settings.set('editorConfig', undefined)
            await api.settings.set('autoApprove', undefined)
            await api.settings.set('providerConfigs', undefined)
            await api.settings.set('promptTemplateId', undefined)
            await api.settings.set('aiInstructions', undefined)
            await api.settings.set('currentTheme', undefined)
            localStorage.clear()
            window.location.reload()
        }
    }

    return (
        <div className="space-y-8 animate-fade-in">
            <section>
                <h4 className="text-sm font-medium text-text-secondary uppercase tracking-wider text-xs mb-4">
                    {language === 'zh' ? '存储与缓存' : 'Storage & Cache'}
                </h4>
                <div className="space-y-4">
                    <div className="p-5 bg-surface/30 rounded-xl border border-border-subtle space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-medium text-text-primary">{language === 'zh' ? '配置存储路径' : 'Config Storage Path'}</div>
                                <div className="text-xs text-text-muted mt-1">
                                    {language === 'zh' 
                                        ? '所有配置文件（config.json、mcp.json 等）的存储位置' 
                                        : 'Storage location for all config files (config.json, mcp.json, etc.)'}
                                </div>
                            </div>
                            <Button variant="secondary" size="sm" onClick={async () => {
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

                        <div className="flex items-start gap-2 p-3 bg-background/50 rounded-lg border border-border-subtle">
                            <HardDrive className="w-4 h-4 text-text-muted mt-0.5" />
                            <div className="text-xs text-text-secondary font-mono break-all">
                                <DataPathDisplay />
                            </div>
                        </div>

                        <div className="flex items-center gap-2 text-[10px] text-status-warning">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            {language === 'zh' ? '更改路径后需要手动重启应用以应用所有变更' : 'Restart application manually after changing path to apply all changes'}
                        </div>
                    </div>

                    <div className="flex items-center justify-between p-5 bg-surface/30 rounded-xl border border-border-subtle">
                        <div>
                            <div className="text-sm font-medium text-text-primary">{language === 'zh' ? '清除缓存' : 'Clear Cache'}</div>
                            <div className="text-xs text-text-muted mt-1">{language === 'zh' ? '清除编辑器缓存、索引数据和临时文件' : 'Clear editor cache, index data, and temporary files'}</div>
                        </div>
                        <Button variant="secondary" size="sm" onClick={handleClearCache} disabled={isClearing}>
                            {isClearing ? (language === 'zh' ? '清除中...' : 'Clearing...') : (language === 'zh' ? '清除' : 'Clear')}
                        </Button>
                    </div>

                    <div className="flex items-center justify-between p-5 bg-red-500/5 rounded-xl border border-red-500/10">
                        <div>
                            <div className="text-sm font-medium text-red-400">{language === 'zh' ? '重置所有设置' : 'Reset All Settings'}</div>
                            <div className="text-xs text-text-muted mt-1">{language === 'zh' ? '恢复出厂设置，不可撤销' : 'Restore factory settings, irreversible'}</div>
                        </div>
                        <Button variant="danger" size="sm" onClick={handleReset}>
                            {language === 'zh' ? '重置' : 'Reset'}
                        </Button>
                    </div>
                </div>
            </section>

            <section>
                <h4 className="text-sm font-medium text-text-secondary uppercase tracking-wider text-xs mb-4">
                    {language === 'zh' ? '关于' : 'About'}
                </h4>
                <div className="p-8 bg-surface/30 rounded-xl border border-white/5 text-center">
                    <div className="w-12 h-12 bg-accent/20 rounded-xl flex items-center justify-center mx-auto mb-4">
                        <Monitor className="w-6 h-6 text-accent" />
                    </div>
                    <div className="text-xl font-bold text-text-primary mb-1">Adnify</div>
                    <div className="text-xs text-text-muted font-mono mb-6">v0.1.0-alpha</div>
                    <div className="text-xs text-text-secondary">
                        Built with Electron, React, Monaco Editor & Tailwind CSS
                    </div>
                </div>
            </section>
        </div>
    )
}
