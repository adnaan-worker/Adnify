/**
 * Skills 设置组件
 * 
 * 管理项目 Skills（基于 agentskills.io 标准）
 * 支持从 skills.sh 市场搜索安装、GitHub URL 安装、手动创建
 */

import { useState, useEffect, useCallback } from 'react'
import { skillService, type SkillItem } from '@/renderer/agent/services/skillService'
import { api } from '@/renderer/services/electronAPI'
import { useStore } from '@store'
import { Button, Input } from '@components/ui'
import {
    Zap, Plus, Trash2, RefreshCw, Download, Search,
    ToggleLeft, ToggleRight, ExternalLink, Github, FolderOpen
} from 'lucide-react'

interface SkillSettingsProps {
    language: string
}

export function SkillSettings({ language }: SkillSettingsProps) {
    const t = (zh: string, en: string) => language === 'zh' ? zh : en
    const { workspacePath } = useStore()

    // Skills list
    const [skills, setSkills] = useState<SkillItem[]>([])
    const [loading, setLoading] = useState(true)

    // Install from marketplace
    const [searchQuery, setSearchQuery] = useState('')
    const [searchResults, setSearchResults] = useState<{ name: string; package: string; installs: number; url: string }[]>([])
    const [searching, setSearching] = useState(false)
    const [installing, setInstalling] = useState<string | null>(null)

    // Install from GitHub
    const [githubUrl, setGithubUrl] = useState('')
    const [githubInstalling, setGithubInstalling] = useState(false)

    // Create new
    const [newSkillName, setNewSkillName] = useState('')
    const [creating, setCreating] = useState(false)

    // Install mode
    const [installMode, setInstallMode] = useState<'marketplace' | 'github' | 'create' | null>(null)

    // Error/success messages
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

    const showMessage = (type: 'success' | 'error', text: string) => {
        setMessage({ type, text })
        setTimeout(() => setMessage(null), 3000)
    }

    // Load skills
    const loadSkills = useCallback(async () => {
        setLoading(true)
        const items = await skillService.getAllSkills(true)
        setSkills(items)
        setLoading(false)
    }, [])

    useEffect(() => {
        loadSkills()
    }, [loadSkills])

    // Search marketplace
    const handleSearch = async () => {
        if (!searchQuery.trim()) return
        setSearching(true)
        const results = await skillService.searchMarketplace(searchQuery)
        setSearchResults(results)
        setSearching(false)
    }

    // Install from marketplace
    const handleMarketplaceInstall = async (packageId: string) => {
        setInstalling(packageId)
        const result = await skillService.installFromMarketplace(packageId)
        if (result.success) {
            showMessage('success', t('安装成功', 'Installed successfully'))
            loadSkills()
            setSearchResults([])
            setSearchQuery('')
        } else {
            showMessage('error', result.error || t('安装失败', 'Install failed'))
        }
        setInstalling(null)
    }

    // Install from GitHub
    const handleGithubInstall = async () => {
        if (!githubUrl.trim()) return
        setGithubInstalling(true)
        const result = await skillService.installFromGitHub(githubUrl)
        if (result.success) {
            showMessage('success', t('安装成功', 'Installed successfully'))
            loadSkills()
            setGithubUrl('')
            setInstallMode(null)
        } else {
            showMessage('error', result.error || t('安装失败', 'Install failed'))
        }
        setGithubInstalling(false)
    }

    // Create new skill
    const handleCreate = async () => {
        if (!newSkillName.trim()) return
        setCreating(true)
        const result = await skillService.createSkill(newSkillName.trim())
        if (result.success) {
            showMessage('success', t('创建成功', 'Created successfully'))
            loadSkills()
            setNewSkillName('')
            setInstallMode(null)
            if (result.filePath) {
                const content = await api.file.read(result.filePath)
                if (content !== null) {
                    useStore.getState().openFile(result.filePath, content)
                }
            }
        } else {
            showMessage('error', result.error || t('创建失败', 'Create failed'))
        }
        setCreating(false)
    }

    // Delete skill
    const handleDelete = async (name: string) => {
        const success = await skillService.deleteSkill(name)
        if (success) {
            showMessage('success', t('已删除', 'Deleted'))
            loadSkills()
        }
    }

    // Toggle skill
    const handleToggle = async (name: string, currentEnabled: boolean) => {
        await skillService.toggleSkill(name, !currentEnabled)
        loadSkills()
    }

    return (
        <div className="space-y-6 animate-fade-in pb-10">
            {/* Header */}
            <section className="p-5 bg-surface/30 rounded-xl border border-border space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        <h5 className="text-sm font-medium text-text-primary">
                            {t('已安装 Skills', 'Installed Skills')}
                        </h5>
                        <span className="text-[10px] text-text-muted px-2 py-0.5 bg-black/20 rounded">
                            {skills.filter(s => s.enabled).length}/{skills.length}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={loadSkills}
                            className="p-1.5 text-text-muted hover:text-accent transition-colors"
                            title={t('刷新', 'Refresh')}
                        >
                            <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>

                <p className="text-xs text-text-muted">
                    {t(
                        'Skills 是基于 agentskills.io 标准的指令包，让 AI 在特定领域拥有专业能力。存放在 .adnify/skills/ 目录中。',
                        'Skills are instruction packages based on the agentskills.io standard. They give AI specialized capabilities. Stored in .adnify/skills/.'
                    )}
                </p>

                {/* Message */}
                {message && (
                    <div className={`p-2.5 rounded-lg text-xs ${message.type === 'success'
                        ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                        : 'bg-red-500/10 border border-red-500/20 text-red-400'
                        }`}>
                        {message.text}
                    </div>
                )}

                {/* Skills list */}
                <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                    {loading ? (
                        <div className="h-20 flex items-center justify-center text-text-muted">
                            <RefreshCw className="w-4 h-4 animate-spin" />
                        </div>
                    ) : !workspacePath ? (
                        <div className="h-20 flex items-center justify-center text-text-muted text-xs">
                            {t('请先打开一个项目', 'Please open a project first')}
                        </div>
                    ) : skills.length === 0 ? (
                        <div className="h-20 flex items-center justify-center text-text-muted text-xs">
                            {t('暂无 Skills，点击下方按钮安装或创建', 'No skills yet. Use the buttons below to install or create one.')}
                        </div>
                    ) : (
                        skills.map((skill) => (
                            <div
                                key={skill.name}
                                className={`group flex items-start gap-3 p-3 rounded-lg border transition-colors ${skill.enabled
                                    ? 'bg-black/20 border-border hover:border-accent/30'
                                    : 'bg-black/10 border-border/50 opacity-60'
                                    }`}
                            >
                                <button
                                    onClick={() => handleToggle(skill.name, skill.enabled)}
                                    className={`p-0.5 mt-0.5 transition-colors ${skill.enabled ? 'text-accent' : 'text-text-muted'}`}
                                    title={skill.enabled ? t('禁用', 'Disable') : t('启用', 'Enable')}
                                >
                                    {skill.enabled ? (
                                        <ToggleRight className="w-4 h-4" />
                                    ) : (
                                        <ToggleLeft className="w-4 h-4" />
                                    )}
                                </button>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium text-text-primary">{skill.name}</span>
                                    </div>
                                    <p className="text-[11px] text-text-muted mt-0.5 line-clamp-2">{skill.description}</p>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={async () => {
                                            const content = await api.file.read(skill.filePath)
                                            if (content !== null) {
                                                useStore.getState().openFile(skill.filePath, content)
                                            }
                                        }}
                                        className="p-1 text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-colors"
                                        title={t('编辑', 'Edit')}
                                    >
                                        <FolderOpen className="w-3 h-3" />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(skill.name)}
                                        className="p-1 text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                        title={t('删除', 'Delete')}
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </section>

            {/* Install Section */}
            <section className="p-5 bg-surface/30 rounded-xl border border-border space-y-4">
                <div className="flex items-center gap-2">
                    <Download className="w-4 h-4 text-accent" />
                    <h5 className="text-sm font-medium text-text-primary">
                        {t('安装 Skill', 'Install Skill')}
                    </h5>
                </div>

                {/* Install mode buttons */}
                <div className="flex gap-2">
                    <Button
                        variant={installMode === 'marketplace' ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setInstallMode(installMode === 'marketplace' ? null : 'marketplace')}
                        className="text-xs"
                    >
                        <Search className="w-3.5 h-3.5 mr-1.5" />
                        {t('搜索市场', 'Search Market')}
                    </Button>
                    <Button
                        variant={installMode === 'github' ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setInstallMode(installMode === 'github' ? null : 'github')}
                        className="text-xs"
                    >
                        <Github className="w-3.5 h-3.5 mr-1.5" />
                        GitHub
                    </Button>
                    <Button
                        variant={installMode === 'create' ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setInstallMode(installMode === 'create' ? null : 'create')}
                        className="text-xs"
                    >
                        <Plus className="w-3.5 h-3.5 mr-1.5" />
                        {t('手动创建', 'Create New')}
                    </Button>
                </div>

                {/* Marketplace search */}
                {installMode === 'marketplace' && (
                    <div className="space-y-3 animate-fade-in">
                        <div className="flex gap-2">
                            <Input
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={t('搜索 skills.sh 市场...', 'Search skills.sh marketplace...')}
                                className="flex-1 bg-black/20 border-border text-xs"
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            />
                            <Button
                                variant="secondary"
                                onClick={handleSearch}
                                disabled={searching || !searchQuery.trim()}
                                className="px-3"
                            >
                                {searching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                            </Button>
                        </div>

                        <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                            <ExternalLink className="w-3 h-3" />
                            <a href="https://skills.sh" className="hover:text-accent transition-colors">
                                {t('浏览 skills.sh 市场', 'Browse skills.sh marketplace')}
                            </a>
                        </div>

                        {searchResults.length > 0 && (
                            <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                                {searchResults.map((result) => (
                                    <div key={result.package} className="flex items-center justify-between p-2.5 rounded-lg bg-black/20 border border-border">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-medium text-text-primary">{result.name}</span>
                                                <span className="text-[10px] text-text-muted px-1.5 py-0.5 bg-black/30 rounded">
                                                    {result.installs >= 1000 ? `${(result.installs / 1000).toFixed(1)}K` : result.installs} installs
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-text-muted truncate mt-0.5">{result.package}</p>
                                        </div>
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            onClick={() => handleMarketplaceInstall(result.package)}
                                            disabled={installing === result.package}
                                            className="text-xs ml-2"
                                        >
                                            {installing === result.package ? (
                                                <RefreshCw className="w-3 h-3 animate-spin" />
                                            ) : (
                                                <>{t('安装', 'Install')}</>
                                            )}
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* GitHub URL */}
                {installMode === 'github' && (
                    <div className="space-y-3 animate-fade-in">
                        <div className="flex gap-2">
                            <Input
                                value={githubUrl}
                                onChange={(e) => setGithubUrl(e.target.value)}
                                placeholder="https://github.com/user/my-skill"
                                className="flex-1 bg-black/20 border-border text-xs"
                                onKeyDown={(e) => e.key === 'Enter' && handleGithubInstall()}
                            />
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={handleGithubInstall}
                                disabled={githubInstalling || !githubUrl.trim()}
                                className="text-xs"
                            >
                                {githubInstalling ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : t('克隆安装', 'Clone')}
                            </Button>
                        </div>
                        <p className="text-[11px] text-text-muted">
                            {t('输入包含 SKILL.md 的 GitHub 仓库地址', 'Enter a GitHub repo URL containing a SKILL.md file')}
                        </p>
                    </div>
                )}

                {/* Create new */}
                {installMode === 'create' && (
                    <div className="space-y-3 animate-fade-in">
                        <div className="flex gap-2">
                            <Input
                                value={newSkillName}
                                onChange={(e) => setNewSkillName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                                placeholder={t('skill-name（小写字母和连字符）', 'skill-name (lowercase and hyphens)')}
                                className="flex-1 bg-black/20 border-border text-xs"
                                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                            />
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={handleCreate}
                                disabled={creating || !newSkillName.trim()}
                                className="text-xs"
                            >
                                {creating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : t('创建', 'Create')}
                            </Button>
                        </div>
                        <p className="text-[11px] text-text-muted">
                            {t(
                                '将在 .adnify/skills/ 下创建目录和 SKILL.md 模板',
                                'Creates a directory and SKILL.md template under .adnify/skills/'
                            )}
                        </p>
                    </div>
                )}
            </section>

            {/* Tips */}
            <div className="p-3 rounded-lg bg-accent/5 border border-accent/20 text-xs text-text-muted space-y-1">
                <p className="font-medium text-accent/80">{t('💡 使用提示', '💡 Tips')}</p>
                <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                    <li>{t('Skills 基于 agentskills.io 开放标准，兼容 Claude Code / Gemini CLI / Kiro 的 Skills', 'Skills follow the agentskills.io open standard, compatible with Claude Code / Gemini CLI / Kiro')}</li>
                    <li>{t('启用的 Skill 会注入到 AI 上下文中，相关任务时自动生效', 'Enabled skills are injected into AI context and activate for relevant tasks')}</li>
                    <li>{t('可在 skills.sh 浏览社区共享的 Skills', 'Browse community skills at skills.sh')}</li>
                </ul>
            </div>
        </div>
    )
}
