import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FolderOpen, MoreHorizontal, Plus, Server, Settings2, Star, Terminal as TerminalIcon, TerminalSquare } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { api } from '@/renderer/services/electronAPI'
import { shellRegistryService, shellService } from '@/renderer/shell'
import type { AvailableShell, ShellLink, ShellPreset, ShellState } from '@/renderer/shell'
import { terminalManager } from '@/renderer/services/TerminalManager'
import { Button } from '../../ui'
import { toast } from '../../common/ToastProvider'
import { ShellManagerDialog } from '@/renderer/shell'

type CollapsedState = Record<string, boolean>

export function ShellView() {
  const { workspace, workspacePath, language, setTerminalVisible } = useStore(useShallow(s => ({ workspace: s.workspace, workspacePath: s.workspacePath, language: s.language, setTerminalVisible: s.setTerminalVisible })))
  const [availableShells, setAvailableShells] = useState<AvailableShell[]>([])
  const [shellState, setShellState] = useState<ShellState>(() => shellRegistryService.getState())
  const [showManager, setShowManager] = useState(false)
  const [managerInitialCreate, setManagerInitialCreate] = useState<'preset' | 'directory' | 'remote' | 'command' | undefined>(undefined)
  const [managerInitialEdit, setManagerInitialEdit] = useState<{ kind: 'preset' | 'link'; id: string } | null>(null)
  const [collapsed, setCollapsed] = useState<CollapsedState>({})
  const roots = useMemo(() => (workspace?.roots || [workspacePath].filter(Boolean)) as string[], [workspace?.roots, workspacePath])
  const cwd = roots[0] || ''

  useEffect(() => {
    shellRegistryService.load().catch(() => {})
    const unsubscribe = shellRegistryService.subscribe(setShellState)
    return unsubscribe
  }, [])

  useEffect(() => {
    const loadShells = async () => {
      try {
        const shells = await api.terminal.getShells()
        setAvailableShells(Array.isArray(shells) ? shells : [])
      } catch {
        setAvailableShells([])
      }
    }
    loadShells()
  }, [])

  const createTerminal = useCallback(async (shellPath?: string, shellName?: string, customCwd?: string) => {
    const preferredShell = availableShells.find(shell => shell.path === shellState.defaultShell)
      || availableShells.find(shell => shell.label.toLowerCase().includes('zsh'))
      || availableShells[0]
    const resolvedShellPath = shellPath || shellState.defaultShell || preferredShell?.path
    const fallbackShell = availableShells.find(shell => shell.path === resolvedShellPath) || preferredShell
    const targetCwd = customCwd || cwd

    if (!targetCwd) {
      toast.error(language === 'zh' ? '请先打开工作区后再创建 Shell 终端' : 'Open a workspace before creating a shell terminal')
      return
    }

    await terminalManager.createTerminal({
      name: shellName || fallbackShell?.label || availableShells[0]?.label || 'Terminal',
      cwd: targetCwd,
      shell: resolvedShellPath,
    })

    setTerminalVisible(true)
  }, [availableShells, cwd, language, setTerminalVisible, shellState.defaultShell])

  const visiblePresets = useMemo(() => shellState.presets.filter(item => item.visibleInMenu !== false), [shellState.presets])
  const visibleLinks = useMemo(() => shellState.links.filter(item => item.visibleInMenu !== false), [shellState.links])

  const favorites = useMemo(() => {
    const presetItems = visiblePresets.filter((item) => item.favorite).map((item) => ({ kind: 'preset' as const, id: item.id, item }))
    const linkItems = visibleLinks.filter((item) => item.favorite).map((item) => ({ kind: 'link' as const, id: item.id, item }))
    return [...presetItems, ...linkItems]
  }, [visibleLinks, visiblePresets])

  const presetGroups = useMemo(() => {
    const groups = new Map<string, ShellPreset[]>()
    visiblePresets.filter((item) => !item.favorite).forEach((item) => {
      const group = item.group?.trim() || (language === 'zh' ? '未分组 Preset' : 'Ungrouped Presets')
      groups.set(group, [...(groups.get(group) || []), item])
    })
    return Array.from(groups.entries()).map(([group, items]) => ({ group, items }))
  }, [language, visiblePresets])

  const linkGroups = useMemo(() => {
    const groups = new Map<string, ShellLink[]>()
    visibleLinks.filter((item) => !item.favorite).forEach((item) => {
      const fallback = item.type === 'remote'
        ? (language === 'zh' ? '服务器' : 'Servers')
        : item.type === 'command'
          ? (language === 'zh' ? '常用命令' : 'Commands')
          : (language === 'zh' ? '快捷链接' : 'Quick Links')
      const group = item.group?.trim() || fallback
      groups.set(group, [...(groups.get(group) || []), item])
    })
    return Array.from(groups.entries()).map(([group, items]) => ({ group, items }))
  }, [language, visibleLinks])

  const openManagerCreate = useCallback((type: 'preset' | 'directory' | 'remote' | 'command') => {
    setManagerInitialEdit(null)
    setManagerInitialCreate(type)
    setShowManager(true)
  }, [])

  const openManagerEdit = useCallback((kind: 'preset' | 'link', id: string) => {
    setManagerInitialCreate(undefined)
    setManagerInitialEdit({ kind, id })
    setShowManager(true)
  }, [])

  const handleOpenPreset = useCallback(async (preset: ShellPreset) => {
    if (!cwd && preset.cwd) {
      await createTerminal(preset.shellPath, preset.name, preset.cwd)
      return
    }

    const launch = shellService.resolvePresetLaunch(preset, {
      availableShells,
      defaultShell: shellState.defaultShell,
      selectedRoot: cwd,
      workspaceRoots: roots,
    })

    await terminalManager.createTerminal({
      name: launch.name,
      cwd: launch.cwd,
      shell: launch.shell,
    })

    if (launch.startupCommand) {
      window.setTimeout(() => {
        terminalManager.writeToTerminal(launch.name, `${launch.startupCommand}\r`)
      }, 80)
    }

    setTerminalVisible(true)
  }, [availableShells, createTerminal, cwd, roots, setTerminalVisible, shellState.defaultShell])

  const handleOpenLink = useCallback(async (link: ShellLink) => {
    const launch = shellService.resolveLinkLaunch(link, {
      availableShells,
      defaultShell: shellState.defaultShell,
      selectedRoot: cwd,
      workspaceRoots: roots,
    })

    if (!launch) {
      toast.error(language === 'zh' ? '当前链接配置不完整，无法打开' : 'Link configuration is incomplete')
      return
    }

    const terminalId = await terminalManager.createTerminal({
      name: launch.name,
      cwd: launch.cwd,
      shell: launch.shell,
    })

    if (launch.startupCommand) {
      window.setTimeout(() => {
        terminalManager.writeToTerminal(terminalId, `${launch.startupCommand}\r`)
      }, 80)
    }

    setTerminalVisible(true)
  }, [availableShells, cwd, language, roots, setTerminalVisible, shellState.defaultShell])

  const toggleFavoritePreset = useCallback(async (preset: ShellPreset) => {
    await shellRegistryService.updatePreset(preset.id, { favorite: !preset.favorite })
  }, [])

  const toggleFavoriteLink = useCallback(async (link: ShellLink) => {
    await shellRegistryService.updateLink(link.id, { favorite: !link.favorite })
  }, [])

  const toggleSection = useCallback((key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const handleItemContextMenu = useCallback((event: React.MouseEvent, kind: 'preset' | 'link', item: ShellPreset | ShellLink) => {
    event.preventDefault()
    event.stopPropagation()

    if (kind === 'preset') {
      openManagerEdit('preset', item.id)
      return
    }

    openManagerEdit('link', item.id)
  }, [openManagerEdit])
  const renderSection = (key: string, title: string, items: Array<JSX.Element>) => {
    const isCollapsed = collapsed[key] === true
    return (
      <section key={key}>
        <button
          onClick={() => toggleSection(key)}
          className="w-full px-2 pb-2 text-[11px] uppercase tracking-wide text-text-muted flex items-center justify-between gap-2"
        >
          <span>{title}</span>
          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {!isCollapsed && <div className="space-y-1">{items}</div>}
      </section>
    )
  }

  return (
    <div className="w-full h-full flex flex-col bg-background">
      <div className="h-12 px-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <TerminalIcon className="w-4 h-4 text-accent" />
          <span className="text-sm font-medium text-text-primary">Shell</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg"
            onClick={() => createTerminal()}
            title={language === 'zh' ? '新建终端' : 'New Terminal'}
          >
            <Plus className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg"
            onClick={() => setShowManager(true)}
            title={language === 'zh' ? 'Shell 管理' : 'Shell Manager'}
          >
            <Settings2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <section>
          <div className="flex items-center gap-2 px-2 pb-2 text-[11px] uppercase tracking-wide text-text-muted">
            <TerminalSquare className="w-3.5 h-3.5" />
            {language === 'zh' ? '可用 Shell' : 'Available Shells'}
          </div>
          <div className="space-y-1">
            {availableShells.length > 0 ? availableShells.map((shell) => (
              <button
                key={`${shell.label}-${shell.path}`}
                onClick={() => createTerminal(shell.path, shell.label)}
                className="w-full text-left px-3 py-2 rounded-lg text-sm text-text-primary hover:bg-surface-hover transition-colors flex items-center justify-between gap-2"
              >
                <span className="truncate">{shell.label}</span>
                {shellState.defaultShell === shell.path && <ChevronRight className="w-3.5 h-3.5 text-accent flex-shrink-0" />}
              </button>
            )) : (
              <div className="px-3 py-2 text-xs text-text-muted">{language === 'zh' ? '未检测到可用 Shell' : 'No shells detected'}</div>
            )}
          </div>
        </section>

        {favorites.length > 0 && renderSection(
          'favorites',
          language === 'zh' ? '收藏' : 'Favorites',
          favorites.map(({ kind, id, item }) => (
            <div key={`${kind}-${id}`} onContextMenu={(event) => handleItemContextMenu(event, kind, item)} className="group w-full px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors flex items-center gap-2">
              <button className="flex-1 min-w-0 text-left text-sm text-text-primary" onClick={() => kind === 'preset' ? handleOpenPreset(item as ShellPreset) : handleOpenLink(item as ShellLink)}>
                <span className="truncate block">{item.name}</span>
              </button>
              <Button variant="ghost" size="icon" className="h-7 w-7 opacity-70 group-hover:opacity-100" onClick={() => kind === 'preset' ? toggleFavoritePreset(item as ShellPreset) : toggleFavoriteLink(item as ShellLink)} title={language === 'zh' ? '取消收藏' : 'Unfavorite'}>
                <Star className="w-3.5 h-3.5 fill-current text-yellow-400" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => openManagerEdit(kind, item.id)} title={language === 'zh' ? '编辑' : 'Edit'}>
                <MoreHorizontal className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))) }

        {presetGroups.map(({ group, items }) => renderSection(
          `preset-${group}`,
          group,
          items.map((preset) => (
            <div key={preset.id} onContextMenu={(event) => handleItemContextMenu(event, 'preset', preset)} className="group w-full px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors flex items-center gap-2">
              <button className="flex-1 min-w-0 text-left text-sm text-text-primary" onClick={() => handleOpenPreset(preset)}>
                <span className="truncate block">{preset.name}</span>
              </button>
              <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => toggleFavoritePreset(preset)} title={language === 'zh' ? '收藏' : 'Favorite'}>
                <Star className={`w-3.5 h-3.5 ${preset.favorite ? 'fill-current text-yellow-400' : ''}`} />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => openManagerEdit('preset', preset.id)} title={language === 'zh' ? '编辑' : 'Edit'}>
                <MoreHorizontal className="w-3.5 h-3.5" />
              </Button>
            </div>
          )),
        ))}

        {linkGroups.map(({ group, items }) => renderSection(
          `link-${group}`,
          group,
          items.map((link) => (
            <div key={link.id} onContextMenu={(event) => handleItemContextMenu(event, 'link', link)} className="group w-full px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors flex items-center gap-2">
              <button className="flex-1 min-w-0 text-left text-sm text-text-primary flex items-center gap-2" onClick={() => handleOpenLink(link)}>
                {link.type === 'remote' ? <Server className="w-3.5 h-3.5 text-accent flex-shrink-0" /> : <FolderOpen className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />}
                <span className="truncate block">{link.name}</span>
              </button>
              <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => toggleFavoriteLink(link)} title={language === 'zh' ? '收藏' : 'Favorite'}>
                <Star className={`w-3.5 h-3.5 ${link.favorite ? 'fill-current text-yellow-400' : ''}`} />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => openManagerEdit('link', link.id)} title={language === 'zh' ? '编辑' : 'Edit'}>
                <MoreHorizontal className="w-3.5 h-3.5" />
              </Button>
            </div>
          )),
        ))}

        <section>
          <div className="px-2 pb-2 text-[11px] uppercase tracking-wide text-text-muted">{language === 'zh' ? '快速新增' : 'Quick Add'}</div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" className="justify-start" onClick={() => openManagerCreate('preset')}>
              <Star className="w-4 h-4 mr-2" />Preset
            </Button>
            <Button variant="ghost" className="justify-start" onClick={() => openManagerCreate('directory')}>
              <FolderOpen className="w-4 h-4 mr-2" />{language === 'zh' ? '链接' : 'Link'}
            </Button>
            <Button variant="ghost" className="justify-start col-span-2" onClick={() => openManagerCreate('remote')}>
              <Server className="w-4 h-4 mr-2" />{language === 'zh' ? '服务器' : 'Server'}
            </Button>
          </div>
        </section>
      </div>

      <ShellManagerDialog
        isOpen={showManager}
        onClose={() => {
          setShowManager(false)
          setManagerInitialCreate(undefined)
          setManagerInitialEdit(null)
        }}
        availableShells={availableShells}
        presets={shellState.presets}
        links={shellState.links}
        defaultShell={shellState.defaultShell}
        initialCreate={managerInitialCreate}
        initialEdit={managerInitialEdit}
      />
    </div>
  )
}
