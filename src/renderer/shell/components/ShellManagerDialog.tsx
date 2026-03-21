import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, FolderOpen, Plus, Server, Settings2, Sparkles, Star, TerminalSquare, Trash2 } from 'lucide-react'
import packageJson from '../../../../package.json'
import { Button, Input, Modal } from '@/renderer/components/ui'
import { shellRegistryService } from '../services/shellRegistryService'
import { DEFAULT_REMOTE_PORT } from '../types'
import type { AvailableShell, RemoteServerConfig, ShellLink, ShellPreset } from '../types'

interface ShellManagerDialogProps {
  isOpen: boolean
  onClose: () => void
  availableShells: AvailableShell[]
  presets?: ShellPreset[]
  links?: ShellLink[]
  defaultShell?: string
  initialCreate?: 'preset' | 'directory' | 'remote' | 'command'
  initialEdit?: { kind: 'preset' | 'link'; id: string } | null
}

type ManagerSection = 'overview' | 'preset' | 'directory' | 'remote' | 'command'

type SelectedItem =
  | { kind: 'overview' }
  | { kind: 'preset'; id: string }
  | { kind: 'link'; id: string }

function createPreset(): ShellPreset {
  return {
    id: crypto.randomUUID(),
    name: 'New Preset',
    shellPath: '',
    cwd: '',
    visibleInMenu: true,
    group: '',
    favorite: false,
  }
}

function createDirectoryLink(): ShellLink {
  return {
    id: crypto.randomUUID(),
    name: 'New Link',
    type: 'directory',
    target: '',
    shellPath: '',
    visibleInMenu: true,
    group: '',
    favorite: false,
  }
}

function createRemoteLink(): ShellLink {
  return {
    id: crypto.randomUUID(),
    name: 'New Server',
    type: 'remote',
    target: '',
    shellPath: '',
    visibleInMenu: true,
    group: '',
    favorite: false,
    remote: {
      host: '',
      port: DEFAULT_REMOTE_PORT,
      username: '',
      password: '',
      privateKeyPath: '',
      remotePath: '',
    },
  }
}

function createCommandLink(command = ''): ShellLink {
  return {
    id: crypto.randomUUID(),
    name: 'New Command',
    type: 'command',
    target: command,
    shellPath: '',
    cwd: '',
    visibleInMenu: true,
    group: '',
    favorite: false,
  }
}

function normalizeRemote(remote?: RemoteServerConfig): RemoteServerConfig {
  return {
    host: remote?.host || '',
    port: remote?.port || DEFAULT_REMOTE_PORT,
    username: remote?.username || '',
    password: remote?.password || '',
    privateKeyPath: remote?.privateKeyPath || '',
    remotePath: remote?.remotePath || '',
  }
}

function normalizePresetForForm(preset: ShellPreset): ShellPreset {
  return {
    ...preset,
    shellPath: preset.shellPath || '',
    cwd: preset.cwd || '',
    group: preset.group || '',
    favorite: preset.favorite === true,
    visibleInMenu: preset.visibleInMenu !== false,
  }
}

function normalizeLinkForForm(link: ShellLink): ShellLink {
  return {
    ...link,
    target: link.target || '',
    shellPath: link.shellPath || '',
    cwd: link.cwd || '',
    group: link.group || '',
    favorite: link.favorite === true,
    visibleInMenu: link.visibleInMenu !== false,
    remote: link.type === 'remote' ? normalizeRemote(link.remote) : undefined,
  }
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= items.length) return items
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(nextIndex, 0, item)
  return next
}

function sectionForCreate(type?: ShellManagerDialogProps['initialCreate']): ManagerSection {
  if (type === 'preset') return 'preset'
  if (type === 'directory') return 'directory'
  if (type === 'remote') return 'remote'
  if (type === 'command') return 'command'
  return 'overview'
}

function sectionForLinkType(type: ShellLink['type']): ManagerSection {
  if (type === 'directory' || type === 'local-shell') return 'directory'
  if (type === 'remote') return 'remote'
  return 'command'
}

export function ShellManagerDialog({
  isOpen,
  onClose,
  availableShells,
  presets = [],
  links = [],
  defaultShell,
  initialCreate,
  initialEdit,
}: ShellManagerDialogProps) {
  const [saving, setSaving] = useState(false)
  const [formDefaultShell, setFormDefaultShell] = useState<string>('')
  const [formPresets, setFormPresets] = useState<ShellPreset[]>([])
  const [formLinks, setFormLinks] = useState<ShellLink[]>([])
  const [activeSection, setActiveSection] = useState<ManagerSection>('overview')
  const [selectedItem, setSelectedItem] = useState<SelectedItem>({ kind: 'overview' })

  useEffect(() => {
    if (!isOpen) return

    const nextPresets = presets.map(normalizePresetForForm)
    const nextLinks = links.map(normalizeLinkForForm)
    setFormDefaultShell(defaultShell || '')
    setFormPresets(nextPresets)
    setFormLinks(nextLinks)

    if (initialEdit?.kind === 'preset') {
      setActiveSection('preset')
      setSelectedItem({ kind: 'preset', id: initialEdit.id })
      return
    }

    if (initialEdit?.kind === 'link') {
      const target = nextLinks.find((item) => item.id === initialEdit.id)
      setActiveSection(target ? sectionForLinkType(target.type) : 'directory')
      setSelectedItem({ kind: 'link', id: initialEdit.id })
      return
    }

    if (initialCreate) {
      const section = sectionForCreate(initialCreate)
      setActiveSection(section)
      if (initialCreate === 'preset') {
        const item = createPreset()
        setFormPresets((prev) => [...prev, item])
        setSelectedItem({ kind: 'preset', id: item.id })
      } else if (initialCreate === 'directory') {
        const item = createDirectoryLink()
        setFormLinks((prev) => [...prev, item])
        setSelectedItem({ kind: 'link', id: item.id })
      } else if (initialCreate === 'remote') {
        const item = createRemoteLink()
        setFormLinks((prev) => [...prev, item])
        setSelectedItem({ kind: 'link', id: item.id })
      } else if (initialCreate === 'command') {
        const item = createCommandLink()
        setFormLinks((prev) => [...prev, item])
        setSelectedItem({ kind: 'link', id: item.id })
      }
      return
    }

    setActiveSection('overview')
    setSelectedItem({ kind: 'overview' })
  }, [isOpen, defaultShell, presets, links, initialCreate, initialEdit])

  const packageCommands = useMemo(() => {
    const scripts = packageJson?.scripts
    if (!scripts || typeof scripts !== 'object') return []

    return Object.keys(scripts)
      .filter(Boolean)
      .map((name) => (name === 'test' ? 'npm test' : `npm run ${name}`))
  }, [])

  const suggestedCommands = useMemo(() => {
    const defaults = ['npm run dev', 'npm run build', 'npm test', 'npm run rebuild']
    return [...new Set([...defaults, ...packageCommands])].slice(0, 8)
  }, [packageCommands])

  const resolvedDefaultShell = useMemo(() => {
    return formDefaultShell || availableShells[0]?.path || availableShells[0]?.label || 'Terminal'
  }, [availableShells, formDefaultShell])

  const remoteCount = useMemo(() => formLinks.filter((item) => item.type === 'remote').length, [formLinks])
  const favoriteCount = useMemo(() => formPresets.filter((item) => item.favorite).length + formLinks.filter((item) => item.favorite).length, [formLinks, formPresets])
  const commandCount = useMemo(() => formLinks.filter((item) => item.type === 'command').length, [formLinks])

  const sectionItems = useMemo(() => {
    if (activeSection === 'preset') {
      return formPresets.map((item) => ({ key: `preset-${item.id}`, label: item.name || 'New Preset', sublabel: item.group || 'Preset', kind: 'preset' as const, id: item.id, favorite: item.favorite === true }))
    }
    if (activeSection === 'directory') {
      return formLinks.filter((item) => item.type === 'directory' || item.type === 'local-shell').map((item) => ({ key: `link-${item.id}`, label: item.name || 'New Link', sublabel: item.type === 'local-shell' ? 'Local Shell' : 'Directory', kind: 'link' as const, id: item.id, favorite: item.favorite === true }))
    }
    if (activeSection === 'remote') {
      return formLinks.filter((item) => item.type === 'remote').map((item) => ({ key: `link-${item.id}`, label: item.name || 'New Server', sublabel: item.remote?.host || 'Remote Server', kind: 'link' as const, id: item.id, favorite: item.favorite === true }))
    }
    if (activeSection === 'command') {
      return formLinks.filter((item) => item.type === 'command').map((item) => ({ key: `link-${item.id}`, label: item.name || 'New Command', sublabel: item.target || 'Command', kind: 'link' as const, id: item.id, favorite: item.favorite === true }))
    }
    return []
  }, [activeSection, formLinks, formPresets])

  const selectedPreset = selectedItem.kind === 'preset' ? formPresets.find((item) => item.id === selectedItem.id) || null : null
  const selectedLink = selectedItem.kind === 'link' ? formLinks.find((item) => item.id === selectedItem.id) || null : null

  const createItem = (section: Exclude<ManagerSection, 'overview'>, presetCommand?: string) => {
    setActiveSection(section)
    if (section === 'preset') {
      const item = createPreset()
      setFormPresets((prev) => [...prev, item])
      setSelectedItem({ kind: 'preset', id: item.id })
      return
    }
    if (section === 'directory') {
      const item = createDirectoryLink()
      setFormLinks((prev) => [...prev, item])
      setSelectedItem({ kind: 'link', id: item.id })
      return
    }
    if (section === 'remote') {
      const item = createRemoteLink()
      setFormLinks((prev) => [...prev, item])
      setSelectedItem({ kind: 'link', id: item.id })
      return
    }
    const item = createCommandLink(presetCommand || '')
    if (presetCommand) item.name = presetCommand
    setFormLinks((prev) => [...prev, item])
    setSelectedItem({ kind: 'link', id: item.id })
  }

  const updatePreset = (id: string, updates: Partial<ShellPreset>) => {
    setFormPresets((prev) => prev.map((item) => item.id === id ? { ...item, ...updates } : item))
  }

  const updateLink = (id: string, updates: Partial<ShellLink>) => {
    setFormLinks((prev) => prev.map((item) => item.id === id ? normalizeLinkForForm({ ...item, ...updates }) : item))
  }

  const updateRemote = (id: string, updates: Partial<RemoteServerConfig>) => {
    setFormLinks((prev) => prev.map((item) => item.id === id ? { ...item, remote: { ...normalizeRemote(item.remote), ...updates } } : item))
  }

  const removeSelected = () => {
    if (selectedItem.kind === 'preset') setFormPresets((prev) => prev.filter((item) => item.id !== selectedItem.id))
    if (selectedItem.kind === 'link') setFormLinks((prev) => prev.filter((item) => item.id !== selectedItem.id))
    setSelectedItem({ kind: 'overview' })
  }

  const moveSelected = (direction: -1 | 1) => {
    if (selectedItem.kind === 'preset') {
      const index = formPresets.findIndex((item) => item.id === selectedItem.id)
      if (index >= 0) setFormPresets((prev) => moveItem(prev, index, direction))
      return
    }
    if (selectedItem.kind === 'link') {
      const index = formLinks.findIndex((item) => item.id === selectedItem.id)
      if (index >= 0) setFormLinks((prev) => moveItem(prev, index, direction))
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await shellRegistryService.setState({
        defaultShell: formDefaultShell || undefined,
        presets: formPresets.map((preset) => ({
          ...preset,
          name: preset.name.trim() || 'New Preset',
          shellPath: preset.shellPath || undefined,
          cwd: preset.cwd?.trim() || undefined,
          group: preset.group?.trim() || undefined,
          favorite: preset.favorite === true,
          visibleInMenu: preset.visibleInMenu !== false,
        })),
        links: formLinks.map((link) => {
          if (link.type === 'remote') {
            const remote = normalizeRemote(link.remote)
            const target = `${remote.username ? `${remote.username}@` : ''}${remote.host}${remote.port && remote.port !== 22 ? `:${remote.port}` : ''}${remote.remotePath ? `|${remote.remotePath}` : ''}`
            return {
              ...link,
              name: link.name.trim() || 'New Server',
              target,
              shellPath: link.shellPath || undefined,
              group: link.group?.trim() || undefined,
              favorite: link.favorite === true,
              visibleInMenu: link.visibleInMenu !== false,
              cwd: undefined,
              remote: {
                ...remote,
                password: remote.password?.trim() || undefined,
              },
            }
          }
          return {
            ...link,
            name: link.name.trim() || (link.type === 'command' ? 'New Command' : 'New Link'),
            target: link.target.trim(),
            shellPath: link.shellPath || undefined,
            cwd: link.type === 'command' ? link.cwd?.trim() || undefined : undefined,
            group: link.group?.trim() || undefined,
            favorite: link.favorite === true,
            visibleInMenu: link.visibleInMenu !== false,
            remote: undefined,
          }
        }),
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const sectionCardClass = (section: ManagerSection) => `w-full rounded-2xl border px-3 py-3 text-left transition-colors ${activeSection === section ? 'border-accent/50 bg-accent/10 text-text-primary' : 'border-border/60 bg-surface/30 text-text-secondary hover:bg-surface/50'}`

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Shell 管理" size="5xl">
      <div className="space-y-6 max-h-[78vh] overflow-y-auto pr-1">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-border/60 bg-surface/50 p-4"><div className="flex items-center gap-2 text-text-primary mb-2"><TerminalSquare className="w-4 h-4 text-accent" /><span className="text-sm font-medium">默认 Shell</span></div><div className="text-sm text-text-secondary break-all">{resolvedDefaultShell}</div></div>
          <div className="rounded-2xl border border-border/60 bg-surface/50 p-4"><div className="flex items-center gap-2 text-text-primary mb-2"><Star className="w-4 h-4 text-accent" /><span className="text-sm font-medium">收藏</span></div><div className="text-2xl font-semibold text-text-primary">{favoriteCount}</div></div>
          <div className="rounded-2xl border border-border/60 bg-surface/50 p-4"><div className="flex items-center gap-2 text-text-primary mb-2"><Sparkles className="w-4 h-4 text-accent" /><span className="text-sm font-medium">命令</span></div><div className="text-2xl font-semibold text-text-primary">{commandCount}</div></div>
          <div className="rounded-2xl border border-border/60 bg-surface/50 p-4"><div className="flex items-center gap-2 text-text-primary mb-2"><Server className="w-4 h-4 text-accent" /><span className="text-sm font-medium">服务器</span></div><div className="text-2xl font-semibold text-text-primary">{remoteCount}</div></div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[240px_minmax(0,280px)_minmax(0,1fr)] gap-4 min-h-[520px]">
          <div className="rounded-2xl border border-border/60 bg-surface/30 p-3 space-y-3">
            <button className={sectionCardClass('overview')} onClick={() => { setActiveSection('overview'); setSelectedItem({ kind: 'overview' }) }}><div className="flex items-center gap-2 text-sm font-medium"><Settings2 className="w-4 h-4" />总览设置</div></button>
            <div className="space-y-2">
              <button className={sectionCardClass('preset')} onClick={() => setActiveSection('preset')}><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">Presets</span><span className="text-xs">{formPresets.length}</span></div></button>
              <button className={sectionCardClass('directory')} onClick={() => setActiveSection('directory')}><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">目录 / 本地 Shell</span><span className="text-xs">{formLinks.filter((item) => item.type === 'directory' || item.type === 'local-shell').length}</span></div></button>
              <button className={sectionCardClass('remote')} onClick={() => setActiveSection('remote')}><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">服务器</span><span className="text-xs">{remoteCount}</span></div></button>
              <button className={sectionCardClass('command')} onClick={() => setActiveSection('command')}><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">命令</span><span className="text-xs">{commandCount}</span></div></button>
            </div>
            <div className="rounded-2xl border border-border/60 bg-background/30 p-3 space-y-2">
              <div className="text-xs uppercase tracking-wide text-text-muted">快速新增</div>
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => createItem('preset')}><Plus className="w-3.5 h-3.5 mr-1" />Preset</Button>
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => createItem('directory')}><FolderOpen className="w-3.5 h-3.5 mr-1" />目录链接</Button>
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => createItem('remote')}><Server className="w-3.5 h-3.5 mr-1" />服务器</Button>
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => createItem('command')}><Sparkles className="w-3.5 h-3.5 mr-1" />命令</Button>
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-surface/30 p-3">
            <div className="flex items-center justify-between gap-2 px-1 pb-3 border-b border-border/40">
              <div><div className="text-sm font-medium text-text-primary">{activeSection === 'overview' ? '总览' : activeSection === 'preset' ? 'Presets' : activeSection === 'directory' ? '目录 / 本地 Shell' : activeSection === 'remote' ? '服务器' : '命令'}</div><div className="text-xs text-text-muted">选择一个条目后在右侧编辑</div></div>
              {activeSection !== 'overview' && <Button variant="ghost" size="sm" onClick={() => createItem(activeSection)}><Plus className="w-3.5 h-3.5 mr-1" />新增</Button>}
            </div>
            <div className="mt-3 space-y-2">
              {activeSection === 'overview' && <div className="rounded-2xl border border-border/60 bg-background/30 p-4 text-sm text-text-secondary">在左侧选择分类，或直接新增一个 Shell 入口开始配置。</div>}
              {activeSection !== 'overview' && sectionItems.length === 0 && <div className="rounded-2xl border border-dashed border-border/60 bg-background/30 p-6 text-center text-sm text-text-secondary">当前分类还没有内容</div>}
              {activeSection !== 'overview' && sectionItems.map((item) => {
                const active = selectedItem.kind !== 'overview' && selectedItem.id === item.id
                return <button key={item.key} onClick={() => setSelectedItem({ kind: item.kind, id: item.id })} className={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${active ? 'border-accent/50 bg-accent/10' : 'border-border/60 bg-background/20 hover:bg-background/40'}`}><div className="flex items-center justify-between gap-2"><div className="min-w-0"><div className="truncate text-sm font-medium text-text-primary">{item.label}</div><div className="truncate text-xs text-text-muted">{item.sublabel}</div></div>{item.favorite && <Star className="w-3.5 h-3.5 text-yellow-400 fill-current flex-shrink-0" />}</div></button>
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-surface/30 p-4">
            {selectedItem.kind === 'overview' && <div className="space-y-5"><div><div className="text-sm font-medium text-text-primary">默认 Shell</div><div className="text-xs text-text-muted mt-1">用于新建终端以及未指定 Shell 的入口</div></div><select value={formDefaultShell} onChange={(e) => setFormDefaultShell(e.target.value)} className="w-full rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm text-text-primary outline-none"><option value="">系统默认 Shell</option>{availableShells.map((shell) => <option key={`${shell.label}-${shell.path}`} value={shell.path}>{shell.label} {shell.path ? `(${shell.path})` : ''}</option>)}</select><div><div className="text-sm font-medium text-text-primary mb-2">命令建议</div><div className="flex flex-wrap gap-2">{suggestedCommands.map((command) => <Button key={command} variant="ghost" size="sm" onClick={() => createItem('command', command)}>{command}</Button>)}</div></div></div>}
            {selectedPreset && <div className="space-y-4"><div className="flex items-center justify-between gap-2"><div><div className="text-sm font-medium text-text-primary">Preset 编辑</div><div className="text-xs text-text-muted">配置启动目录、参数和显示方式</div></div><div className="flex items-center gap-1"><Button variant="ghost" size="icon" onClick={() => moveSelected(-1)}><ArrowUp className="w-4 h-4" /></Button><Button variant="ghost" size="icon" onClick={() => moveSelected(1)}><ArrowDown className="w-4 h-4" /></Button><Button variant="ghost" size="sm" onClick={() => updatePreset(selectedPreset.id, { favorite: !selectedPreset.favorite })}><Star className={`w-4 h-4 ${selectedPreset.favorite ? 'fill-current text-yellow-400' : ''}`} /></Button><Button variant="ghost" size="icon" onClick={removeSelected}><Trash2 className="w-4 h-4" /></Button></div></div><div className="grid grid-cols-1 md:grid-cols-2 gap-3"><Input value={selectedPreset.name} onChange={(e) => updatePreset(selectedPreset.id, { name: e.target.value })} placeholder="名称" /><Input value={selectedPreset.group || ''} onChange={(e) => updatePreset(selectedPreset.id, { group: e.target.value })} placeholder="分组（可选）" /><Input value={selectedPreset.cwd || ''} onChange={(e) => updatePreset(selectedPreset.id, { cwd: e.target.value })} placeholder="工作目录（可选）" /><Input value={selectedPreset.args?.join(' ') || ''} onChange={(e) => updatePreset(selectedPreset.id, { args: e.target.value.trim() ? e.target.value.trim().split(/\s+/) : undefined })} placeholder="启动命令（可选）" /></div><select value={selectedPreset.shellPath || ''} onChange={(e) => updatePreset(selectedPreset.id, { shellPath: e.target.value })} className="w-full rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm text-text-primary outline-none"><option value="">默认 Shell</option>{availableShells.map((shell) => <option key={`${selectedPreset.id}-${shell.path}`} value={shell.path}>{shell.label}</option>)}</select><label className="flex items-center gap-2 text-sm text-text-secondary px-1"><input type="checkbox" checked={selectedPreset.visibleInMenu !== false} onChange={(e) => updatePreset(selectedPreset.id, { visibleInMenu: e.target.checked })} />在菜单中显示</label></div>}
            {selectedLink && <div className="space-y-4"><div className="flex items-center justify-between gap-2"><div><div className="text-sm font-medium text-text-primary">{selectedLink.type === 'remote' ? '服务器编辑' : selectedLink.type === 'command' ? '命令编辑' : '链接编辑'}</div><div className="text-xs text-text-muted">当前入口的详细配置</div></div><div className="flex items-center gap-1"><Button variant="ghost" size="icon" onClick={() => moveSelected(-1)}><ArrowUp className="w-4 h-4" /></Button><Button variant="ghost" size="icon" onClick={() => moveSelected(1)}><ArrowDown className="w-4 h-4" /></Button><Button variant="ghost" size="sm" onClick={() => updateLink(selectedLink.id, { favorite: !selectedLink.favorite })}><Star className={`w-4 h-4 ${selectedLink.favorite ? 'fill-current text-yellow-400' : ''}`} /></Button><Button variant="ghost" size="icon" onClick={removeSelected}><Trash2 className="w-4 h-4" /></Button></div></div><div className="grid grid-cols-1 md:grid-cols-2 gap-3"><Input value={selectedLink.name} onChange={(e) => updateLink(selectedLink.id, { name: e.target.value })} placeholder="名称" /><Input value={selectedLink.group || ''} onChange={(e) => updateLink(selectedLink.id, { group: e.target.value })} placeholder="分组（可选）" /><select value={selectedLink.type} onChange={(e) => updateLink(selectedLink.id, { type: e.target.value as ShellLink['type'], target: '', cwd: '', remote: e.target.value === 'remote' ? normalizeRemote(selectedLink.remote) : undefined })} className="w-full rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm text-text-primary outline-none"><option value="directory">目录</option><option value="local-shell">本地 Shell</option><option value="command">常用命令</option><option value="remote">远程服务器</option></select><select value={selectedLink.shellPath || ''} onChange={(e) => updateLink(selectedLink.id, { shellPath: e.target.value })} className="w-full rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm text-text-primary outline-none"><option value="">默认 Shell</option>{availableShells.map((shell) => <option key={`${selectedLink.id}-${shell.path}`} value={shell.path}>{shell.label}</option>)}</select></div>{selectedLink.type === 'remote' ? <div className="grid grid-cols-1 md:grid-cols-2 gap-3"><Input value={normalizeRemote(selectedLink.remote).host} onChange={(e) => updateRemote(selectedLink.id, { host: e.target.value })} placeholder="Host" /><Input value={normalizeRemote(selectedLink.remote).username || ''} onChange={(e) => updateRemote(selectedLink.id, { username: e.target.value })} placeholder="Username" /><Input type="number" value={String(normalizeRemote(selectedLink.remote).port || DEFAULT_REMOTE_PORT)} onChange={(e) => updateRemote(selectedLink.id, { port: Number(e.target.value) || DEFAULT_REMOTE_PORT })} placeholder="Port" /><Input type="password" value={normalizeRemote(selectedLink.remote).password || ''} onChange={(e) => updateRemote(selectedLink.id, { password: e.target.value })} placeholder="密码（可选）" /><Input value={normalizeRemote(selectedLink.remote).remotePath || ''} onChange={(e) => updateRemote(selectedLink.id, { remotePath: e.target.value })} placeholder="远程目录（可选）" /><div className="md:col-span-2"><Input value={normalizeRemote(selectedLink.remote).privateKeyPath || ''} onChange={(e) => updateRemote(selectedLink.id, { privateKeyPath: e.target.value })} placeholder="私钥路径（可选）" /></div></div> : selectedLink.type === 'command' ? <div className="grid grid-cols-1 md:grid-cols-2 gap-3"><Input value={selectedLink.target} onChange={(e) => updateLink(selectedLink.id, { target: e.target.value })} placeholder="命令内容，例如 npm run dev" /><Input value={selectedLink.cwd || ''} onChange={(e) => updateLink(selectedLink.id, { cwd: e.target.value })} placeholder="工作目录（可选）" /></div> : <Input value={selectedLink.target} onChange={(e) => updateLink(selectedLink.id, { target: e.target.value })} placeholder={selectedLink.type === 'local-shell' ? 'Shell 路径' : '目录路径'} />}<label className="flex items-center gap-2 text-sm text-text-secondary px-1"><input type="checkbox" checked={selectedLink.visibleInMenu !== false} onChange={(e) => updateLink(selectedLink.id, { visibleInMenu: e.target.checked })} />在菜单中显示</label></div>}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pb-1"><Button variant="ghost" onClick={onClose}>取消</Button><Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</Button></div>
      </div>
    </Modal>
  )
}
