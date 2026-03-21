/**
 * 安全设置组件
 */

import { useState } from 'react'
import { AlertTriangle, Plus, X, RotateCcw } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { Switch } from '@components/ui'
import { Language } from '@renderer/i18n'
import { api } from '@renderer/services/electronAPI'

interface SecuritySettingsProps {
    language: Language
}

export function SecuritySettings({ language }: SecuritySettingsProps) {
    const { securitySettings, update } = useStore(useShallow(s => ({ securitySettings: s.securitySettings, update: s.update })))
    const [newShellCmd, setNewShellCmd] = useState('')
    const [newGitCmd, setNewGitCmd] = useState('')

    const handleAddShellCommand = () => {
        const cmd = newShellCmd.trim().toLowerCase()
        if (cmd && !securitySettings.allowedShellCommands.includes(cmd)) {
            update('securitySettings', {
                allowedShellCommands: [...securitySettings.allowedShellCommands, cmd]
            })
            setNewShellCmd('')
        }
    }

    const handleRemoveShellCommand = (cmd: string) => {
        update('securitySettings', {
            allowedShellCommands: securitySettings.allowedShellCommands.filter(c => c !== cmd)
        })
    }

    const handleAddGitCommand = () => {
        const cmd = newGitCmd.trim().toLowerCase()
        if (cmd && !securitySettings.allowedGitSubcommands?.includes(cmd)) {
            update('securitySettings', {
                allowedGitSubcommands: [...(securitySettings.allowedGitSubcommands || []), cmd]
            })
            setNewGitCmd('')
        }
    }

    const handleRemoveGitCommand = (cmd: string) => {
        update('securitySettings', {
            allowedGitSubcommands: (securitySettings.allowedGitSubcommands || []).filter(c => c !== cmd)
        })
    }

    const handleResetWhitelist = async () => {
        try {
            const result = await api.settings.resetWhitelist()
            update('securitySettings', {
                allowedShellCommands: result.shell,
                allowedGitSubcommands: result.git
            })
        } catch (e) {
            console.error('Failed to reset whitelist:', e)
        }
    }

    return (
        <div className="space-y-8 animate-fade-in pb-10">
            <div className="p-5 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl flex items-start gap-4 shadow-sm">
                <div className="p-2 bg-yellow-500/10 rounded-lg shrink-0">
                    <AlertTriangle className="w-5 h-5 text-yellow-500" />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-yellow-500 mb-1 tracking-tight">
                        {language === 'zh' ? '安全沙箱 (开发中)' : 'Security Sandbox (WIP)'}
                    </h3>
                    <p className="text-xs text-text-secondary leading-relaxed opacity-90">
                        {language === 'zh'
                            ? 'Adnify 目前直接在您的系统上运行命令。请确保您只运行受信任的代码。未来版本将引入基于 Docker 的沙箱环境。'
                            : 'Adnify currently runs commands directly on your system. Ensure you only run trusted code. Future versions will introduce a Docker-based sandbox.'}
                    </p>
                </div>
            </div>

            <section className="space-y-5 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                <h4 className="text-[11px] font-bold text-text-muted uppercase tracking-widest opacity-60 ml-1">
                    {language === 'zh' ? '安全选项' : 'Security Options'}
                </h4>
                <div className="space-y-4">
                    <Switch label={language === 'zh' ? '启用操作确认' : 'Enable permission confirmation'} checked={securitySettings.enablePermissionConfirm} onChange={(e) => update('securitySettings', { enablePermissionConfirm: e.target.checked })} />
                    <Switch label={language === 'zh' ? '严格工作区模式' : 'Strict workspace mode'} checked={securitySettings.strictWorkspaceMode} onChange={(e) => update('securitySettings', { strictWorkspaceMode: e.target.checked })} />
                    <Switch label={language === 'zh' ? '显示安全警告' : 'Show security warnings'} checked={securitySettings.showSecurityWarnings} onChange={(e) => update('securitySettings', { showSecurityWarnings: e.target.checked })} />
                </div>
            </section>

            {/* Shell 命令白名单 */}
            <section className="space-y-4 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                <div className="flex items-center justify-between">
                    <h4 className="text-[11px] font-bold text-text-muted uppercase tracking-widest opacity-60">
                        {language === 'zh' ? 'Shell 命令白名单' : 'Shell Command Whitelist'}
                    </h4>
                    <button
                        onClick={handleResetWhitelist}
                        className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
                        title={language === 'zh' ? '重置为默认值' : 'Reset to defaults'}
                    >
                        <RotateCcw className="w-3 h-3" />
                        {language === 'zh' ? '重置' : 'Reset'}
                    </button>
                </div>
                <p className="text-xs text-text-secondary">
                    {language === 'zh'
                        ? '只有在此列表中的命令才能被执行'
                        : 'Only commands in this list can be executed'}
                </p>
                <div className="flex flex-wrap gap-2">
                    {securitySettings.allowedShellCommands.map(cmd => (
                        <span key={cmd} className="inline-flex items-center gap-1 px-2 py-1 bg-surface rounded text-xs text-text-secondary border border-border">
                            {cmd}
                            <button onClick={() => handleRemoveShellCommand(cmd)} className="hover:text-red-400 transition-colors">
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    ))}
                </div>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newShellCmd}
                        onChange={(e) => setNewShellCmd(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddShellCommand()}
                        placeholder={language === 'zh' ? '添加命令...' : 'Add command...'}
                        className="flex-1 px-3 py-1.5 bg-surface border border-border rounded text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                    />
                    <button
                        onClick={handleAddShellCommand}
                        disabled={!newShellCmd.trim()}
                        className="px-3 py-1.5 bg-accent text-white rounded text-sm hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
            </section>

            {/* Git 子命令白名单 */}
            <section className="space-y-4 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                <h4 className="text-[11px] font-bold text-text-muted uppercase tracking-widest opacity-60">
                    {language === 'zh' ? 'Git 子命令白名单' : 'Git Subcommand Whitelist'}
                </h4>
                <p className="text-xs text-text-secondary">
                    {language === 'zh'
                        ? '只有在此列表中的 Git 子命令才能被执行（如 status, commit, push 等）'
                        : 'Only Git subcommands in this list can be executed (e.g., status, commit, push)'}
                </p>
                <div className="flex flex-wrap gap-2">
                    {(securitySettings.allowedGitSubcommands || []).map(cmd => (
                        <span key={cmd} className="inline-flex items-center gap-1 px-2 py-1 bg-surface rounded text-xs text-text-secondary border border-border">
                            {cmd}
                            <button onClick={() => handleRemoveGitCommand(cmd)} className="hover:text-red-400 transition-colors">
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    ))}
                </div>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newGitCmd}
                        onChange={(e) => setNewGitCmd(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddGitCommand()}
                        placeholder={language === 'zh' ? '添加 Git 子命令...' : 'Add Git subcommand...'}
                        className="flex-1 px-3 py-1.5 bg-surface border border-border rounded text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                    />
                    <button
                        onClick={handleAddGitCommand}
                        disabled={!newGitCmd.trim()}
                        className="px-3 py-1.5 bg-accent text-white rounded text-sm hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
            </section>
        </div>
    )
}
