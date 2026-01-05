/**
 * 编辑器设置组件
 */

import { api } from '@/renderer/services/electronAPI'
import { useState } from 'react'
import { Layout, Type, Sparkles, Terminal, Check, Settings2, Zap } from 'lucide-react'
import { useStore } from '@store'
import { getEditorConfig, saveEditorConfig, EditorConfig } from '@renderer/config/editorConfig'
import { themes } from '@components/editor/ThemeManager'
import { Input, Select, Switch } from '@components/ui'
import { EditorSettingsProps } from '../types'

// 预定义的触发字符选项
const TRIGGER_CHAR_OPTIONS = [
    { char: '.', label: '.' },
    { char: '(', label: '(' },
    { char: '{', label: '{' },
    { char: '[', label: '[' },
    { char: '"', label: '"' },
    { char: "'", label: "'" },
    { char: '/', label: '/' },
    { char: ' ', label: '␣' }, // 空格用特殊符号显示
    { char: ':', label: ':' },
    { char: '<', label: '<' },
    { char: '@', label: '@' },
    { char: '#', label: '#' },
]

export function EditorSettings({ settings, setSettings, language }: EditorSettingsProps) {
    const [advancedConfig, setAdvancedConfig] = useState<EditorConfig>(getEditorConfig())
    const { currentTheme, setTheme } = useStore()
    const allThemes = Object.keys(themes)

    const handleThemeChange = (themeId: string) => {
        setTheme(themeId as any)
        api.settings.set('currentTheme', themeId)
    }

    const toggleTriggerChar = (char: string) => {
        const current = settings.completionTriggerChars
        if (current.includes(char)) {
            setSettings({ ...settings, completionTriggerChars: current.filter(c => c !== char) })
        } else {
            setSettings({ ...settings, completionTriggerChars: [...current, char] })
        }
    }

    return (
        <div className="space-y-8 animate-fade-in pb-10">
            {/* Theme Section */}
            <section>
                <div className="flex items-center gap-2 mb-4">
                    <Layout className="w-4 h-4 text-accent" />
                    <h4 className="text-sm font-semibold text-text-primary uppercase tracking-wide">
                        {language === 'zh' ? '外观' : 'Appearance'}
                    </h4>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {allThemes.map(themeId => {
                        const themeVars = themes[themeId as keyof typeof themes]
                        return (
                            <button
                                key={themeId}
                                onClick={() => handleThemeChange(themeId)}
                                className={`group relative p-4 rounded-xl border text-left transition-all duration-200 overflow-hidden ${currentTheme === themeId
                                    ? 'border-accent bg-accent/5 shadow-md ring-1 ring-accent/20'
                                    : 'border-white/5 bg-surface/40 hover:border-white/10 hover:bg-surface/60'
                                    }`}
                            >
                                <div className="flex gap-2 mb-3">
                                    <div className="w-6 h-6 rounded-full shadow-sm ring-1 ring-white/10" style={{ backgroundColor: `rgb(${themeVars['--background']})` }} title="Background" />
                                    <div className="w-6 h-6 rounded-full shadow-sm ring-1 ring-white/10" style={{ backgroundColor: `rgb(${themeVars['--surface']})` }} title="Surface" />
                                    <div className="w-6 h-6 rounded-full shadow-sm ring-1 ring-white/10" style={{ backgroundColor: `rgb(${themeVars['--accent']})` }} title="Accent" />
                                    <div className="w-6 h-6 rounded-full shadow-sm ring-1 ring-white/10" style={{ backgroundColor: `rgb(${themeVars['--text-primary']})` }} title="Text" />
                                </div>
                                <span className="text-xs font-medium capitalize block truncate text-text-secondary group-hover:text-text-primary transition-colors">
                                    {themeId.replace(/-/g, ' ')}
                                </span>
                                {currentTheme === themeId && (
                                    <div className="absolute top-3 right-3 bg-accent rounded-full p-0.5">
                                        <Check className="w-3 h-3 text-white" />
                                    </div>
                                )}
                            </button>
                        )
                    })}
                </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Typography & Layout */}
                <div className="space-y-6">
                    <section className="p-5 bg-surface/30 rounded-xl border border-white/5 space-y-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Type className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{language === 'zh' ? '排版与布局' : 'Typography & Layout'}</h5>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '字体大小' : 'Font Size'}</label>
                                <Input 
                                    type="number" 
                                    value={settings.fontSize} 
                                    onChange={(e) => setSettings({ ...settings, fontSize: parseInt(e.target.value) || 14 })} 
                                    min={10} 
                                    max={32}
                                    className="bg-black/20 border-white/10 text-xs" 
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? 'Tab 大小' : 'Tab Size'}</label>
                                <Select 
                                    value={settings.tabSize.toString()} 
                                    onChange={(value) => setSettings({ ...settings, tabSize: parseInt(value) })} 
                                    options={[{ value: '2', label: '2 Spaces' }, { value: '4', label: '4 Spaces' }, { value: '8', label: '8 Spaces' }]} 
                                    className="w-full bg-black/20 border-white/10 text-xs" 
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '自动换行' : 'Word Wrap'}</label>
                                <Select 
                                    value={settings.wordWrap} 
                                    onChange={(value) => setSettings({ ...settings, wordWrap: value as any })} 
                                    options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }, { value: 'wordWrapColumn', label: 'Column' }]} 
                                    className="w-full bg-black/20 border-white/10 text-xs" 
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '行号' : 'Line Numbers'}</label>
                                <Select 
                                    value={settings.lineNumbers} 
                                    onChange={(value) => setSettings({ ...settings, lineNumbers: value as any })} 
                                    options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }, { value: 'relative', label: 'Relative' }]} 
                                    className="w-full bg-black/20 border-white/10 text-xs" 
                                />
                            </div>
                        </div>
                    </section>

                    {/* Features Switches */}
                    <section className="p-5 bg-surface/30 rounded-xl border border-white/5 space-y-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Settings2 className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{language === 'zh' ? '功能特性' : 'Features'}</h5>
                        </div>
                        <div className="space-y-3">
                            <Switch label={language === 'zh' ? '显示小地图' : 'Show Minimap'} checked={settings.minimap} onChange={(e) => setSettings({ ...settings, minimap: e.target.checked })} />
                            <Switch label={language === 'zh' ? '括号配对着色' : 'Bracket Pair Colorization'} checked={settings.bracketPairColorization} onChange={(e) => setSettings({ ...settings, bracketPairColorization: e.target.checked })} />
                            <Switch label={language === 'zh' ? '保存时格式化' : 'Format on Save'} checked={settings.formatOnSave} onChange={(e) => setSettings({ ...settings, formatOnSave: e.target.checked })} />
                        </div>
                        
                        <div className="pt-3 border-t border-white/5">
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '自动保存' : 'Auto Save'}</label>
                                <Select 
                                    value={settings.autoSave} 
                                    onChange={(value) => setSettings({ ...settings, autoSave: value as any })} 
                                    options={[{ value: 'off', label: 'Off' }, { value: 'afterDelay', label: language === 'zh' ? '延迟后' : 'After Delay' }, { value: 'onFocusChange', label: language === 'zh' ? '失去焦点时' : 'On Focus Change' }]} 
                                    className="w-32 bg-black/20 border-white/10 text-xs h-7 min-h-0" 
                                />
                            </div>
                            {settings.autoSave === 'afterDelay' && (
                                <div className="flex items-center justify-between animate-fade-in">
                                    <label className="text-xs text-text-muted">{language === 'zh' ? '延迟 (ms)' : 'Delay (ms)'}</label>
                                    <Input 
                                        type="number" 
                                        value={settings.autoSaveDelay} 
                                        onChange={(e) => setSettings({ ...settings, autoSaveDelay: parseInt(e.target.value) || 1000 })} 
                                        min={500} 
                                        max={10000} 
                                        step={500} 
                                        className="w-24 bg-black/20 border-white/10 text-xs h-7" 
                                    />
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                {/* Right Column */}
                <div className="space-y-6">
                    {/* AI Completion */}
                    <section className="p-5 bg-gradient-to-br from-accent/5 to-transparent rounded-xl border border-accent/10 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-accent" />
                                <h5 className="text-sm font-medium text-text-primary">{language === 'zh' ? 'AI 代码补全' : 'AI Completion'}</h5>
                            </div>
                            <Switch checked={settings.completionEnabled} onChange={(e) => setSettings({ ...settings, completionEnabled: e.target.checked })} />
                        </div>

                        {settings.completionEnabled && (
                            <div className="space-y-4 pt-2 animate-fade-in">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '触发延迟 (ms)' : 'Trigger Delay'}</label>
                                        <Input 
                                            type="number" 
                                            value={settings.completionDebounceMs} 
                                            onChange={(e) => setSettings({ ...settings, completionDebounceMs: parseInt(e.target.value) || 150 })} 
                                            min={50} 
                                            max={1000} 
                                            step={50} 
                                            className="bg-black/20 border-white/10 text-xs"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '最大 Token' : 'Max Tokens'}</label>
                                        <Input 
                                            type="number" 
                                            value={settings.completionMaxTokens} 
                                            onChange={(e) => setSettings({ ...settings, completionMaxTokens: parseInt(e.target.value) || 256 })} 
                                            min={64} 
                                            max={1024} 
                                            step={64} 
                                            className="bg-black/20 border-white/10 text-xs"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '触发字符' : 'Trigger Characters'}</label>
                                    <div className="flex flex-wrap gap-1.5 p-2 bg-black/20 rounded-lg border border-white/10">
                                        {TRIGGER_CHAR_OPTIONS.map(({ char, label }) => {
                                            const isSelected = settings.completionTriggerChars.includes(char)
                                            return (
                                                <button
                                                    key={char}
                                                    type="button"
                                                    onClick={() => toggleTriggerChar(char)}
                                                    className={`w-8 h-8 rounded-md text-sm font-mono flex items-center justify-center transition-all ${
                                                        isSelected
                                                            ? 'bg-accent text-white shadow-sm'
                                                            : 'bg-surface/50 text-text-muted hover:bg-surface hover:text-text-primary border border-white/5'
                                                    }`}
                                                    title={char === ' ' ? 'Space' : char}
                                                >
                                                    {label}
                                                </button>
                                            )
                                        })}
                                    </div>
                                    <p className="text-[10px] text-text-muted opacity-70">
                                        {language === 'zh' ? '点击选择/取消触发字符' : 'Click to toggle trigger characters'}
                                    </p>
                                </div>
                            </div>
                        )}
                    </section>

                    {/* Terminal Settings */}
                    <section className="p-5 bg-surface/30 rounded-xl border border-white/5 space-y-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Terminal className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{language === 'zh' ? '终端配置' : 'Terminal'}</h5>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '字体大小' : 'Font Size'}</label>
                                <Input type="number" value={advancedConfig.terminal.fontSize} onChange={(e) => { const newConfig = { ...advancedConfig, terminal: { ...advancedConfig.terminal, fontSize: parseInt(e.target.value) || 13 } }; setAdvancedConfig(newConfig); saveEditorConfig(newConfig) }} min={10} max={24} className="bg-black/20 border-white/10 text-xs" />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '行高' : 'Line Height'}</label>
                                <Input type="number" value={advancedConfig.terminal.lineHeight} onChange={(e) => { const newConfig = { ...advancedConfig, terminal: { ...advancedConfig.terminal, lineHeight: parseFloat(e.target.value) || 1.2 } }; setAdvancedConfig(newConfig); saveEditorConfig(newConfig) }} min={1} max={2} step={0.1} className="bg-black/20 border-white/10 text-xs" />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '滚动缓冲行数' : 'Scrollback Lines'}</label>
                                <Input type="number" value={settings.terminalScrollback} onChange={(e) => setSettings({ ...settings, terminalScrollback: parseInt(e.target.value) || 1000 })} min={100} max={10000} step={100} className="bg-black/20 border-white/10 text-xs" />
                            </div>
                        </div>
                        <div className="pt-2">
                            <Switch label={language === 'zh' ? '光标闪烁' : 'Cursor Blink'} checked={advancedConfig.terminal.cursorBlink} onChange={(e) => { const newConfig = { ...advancedConfig, terminal: { ...advancedConfig.terminal, cursorBlink: e.target.checked } }; setAdvancedConfig(newConfig); saveEditorConfig(newConfig) }} />
                        </div>
                    </section>

                    {/* Git Settings */}
                    <section className="p-5 bg-surface/30 rounded-xl border border-white/5 space-y-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Settings2 className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">Git</h5>
                        </div>
                        <div className="space-y-3">
                            <Switch 
                                label={language === 'zh' ? '自动刷新 Git 状态' : 'Auto Refresh Git Status'} 
                                checked={advancedConfig.git?.autoRefresh ?? true} 
                                onChange={(e) => { 
                                    const newConfig = { ...advancedConfig, git: { ...advancedConfig.git, autoRefresh: e.target.checked } }
                                    setAdvancedConfig(newConfig)
                                    saveEditorConfig(newConfig) 
                                }} 
                            />
                            <p className="text-[10px] text-text-muted opacity-70 pl-7">
                                {language === 'zh' 
                                    ? '关闭后需手动点击刷新按钮更新 Git 状态' 
                                    : 'When disabled, click refresh button to update Git status manually'}
                            </p>
                        </div>
                    </section>

                    {/* Performance */}
                    <section className="p-5 bg-surface/30 rounded-xl border border-white/5 space-y-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Zap className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{language === 'zh' ? '性能与限制' : 'Performance'}</h5>
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-xs text-text-secondary">{language === 'zh' ? '大文件警告 (MB)' : 'Large File Warning (MB)'}</label>
                                <Input type="number" value={settings.largeFileWarningThresholdMB} onChange={(e) => setSettings({ ...settings, largeFileWarningThresholdMB: parseFloat(e.target.value) || 5 })} min={1} max={50} step={1} className="w-24 bg-black/20 border-white/10 text-xs h-7" />
                            </div>
                            <div className="flex items-center justify-between">
                                <label className="text-xs text-text-secondary">{language === 'zh' ? '命令超时 (秒)' : 'Command Timeout (s)'}</label>
                                <Input type="number" value={settings.commandTimeoutMs / 1000} onChange={(e) => setSettings({ ...settings, commandTimeoutMs: (parseInt(e.target.value) || 30) * 1000 })} min={10} max={300} step={10} className="w-24 bg-black/20 border-white/10 text-xs h-7" />
                            </div>
                            <div className="flex items-center justify-between">
                                <label className="text-xs text-text-secondary">{language === 'zh' ? '最大扫描文件数' : 'Max Project Files'}</label>
                                <Input type="number" value={settings.maxProjectFiles} onChange={(e) => setSettings({ ...settings, maxProjectFiles: parseInt(e.target.value) || 500 })} min={100} max={2000} step={100} className="w-24 bg-black/20 border-white/10 text-xs h-7" />
                            </div>
                            <div className="flex items-center justify-between">
                                <label className="text-xs text-text-secondary">{language === 'zh' ? '文件树最大深度' : 'File Tree Max Depth'}</label>
                                <Input type="number" value={settings.maxFileTreeDepth} onChange={(e) => setSettings({ ...settings, maxFileTreeDepth: parseInt(e.target.value) || 5 })} min={2} max={15} step={1} className="w-24 bg-black/20 border-white/10 text-xs h-7" />
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    )
}