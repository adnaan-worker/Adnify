import { memo, useMemo, useRef, useState } from 'react'
import { ChevronRight, Plus, Settings2, Server } from 'lucide-react'
import { Button } from '@/renderer/components/ui'
import { useClickOutside } from '@renderer/hooks/usePerformance'
import { shellService } from '../services/shellService'
import { ShellManagerDialog } from './ShellManagerDialog'
import type { AvailableShell, ShellLink, ShellPreset } from '../types'

interface ShellMenuProps {
  availableShells: AvailableShell[]
  onCreateTerminal: (shellPath?: string, shellName?: string, cwd?: string, startupCommand?: string) => void | Promise<void>
  presets?: ShellPreset[]
  links?: ShellLink[]
  defaultShell?: string
  className?: string
}

function ShellMenuComponent({
  availableShells,
  onCreateTerminal,
  presets = [],
  links = [],
  defaultShell,
  className = '',
}: ShellMenuProps) {
  const [open, setOpen] = useState(false)
  const [showManager, setShowManager] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useClickOutside(() => setOpen(false), open, [menuRef, buttonRef])

  const visiblePresets = useMemo(() => presets.filter((item) => item.visibleInMenu !== false), [presets])
  const visibleLinks = useMemo(() => links.filter((item) => item.visibleInMenu !== false), [links])

  const handleOpenShell = async (shellPath?: string, shellName?: string, cwd?: string, startupCommand?: string) => {
    await onCreateTerminal(shellPath, shellName, cwd, startupCommand)
    setOpen(false)
  }

  const handleOpenPreset = async (preset: ShellPreset) => {
    await handleOpenShell(
      preset.shellPath,
      preset.name,
      preset.cwd,
      preset.args?.join(' '),
    )
  }

  const handleOpenLink = async (link: ShellLink) => {
    const launch = shellService.resolveLinkLaunch(link, {
      availableShells,
      defaultShell,
    })

    if (!launch) return

    await handleOpenShell(
      launch.shell,
      launch.name,
      launch.cwd,
      launch.startupCommand,
    )
  }

  return (
    <>
      <div className={`relative flex-shrink-0 h-full flex items-center px-1 border-r border-border/50 ${className}`}>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen((value) => !value)}
          ref={buttonRef}
          className="h-7 w-7 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover"
          title="Shell Menu"
        >
          <Plus className="w-4 h-4" />
        </Button>
        {open && (
          <div ref={menuRef} className="absolute top-full left-0 mt-1 w-64 bg-surface border border-border rounded-xl shadow-2xl py-1 flex flex-col max-h-96 overflow-y-auto z-[100] animate-scale-in origin-top-left">
            <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-text-muted">Shell</div>
            {availableShells.map((shell) => (
              <button
                key={`${shell.label}-${shell.path}`}
                onClick={() => handleOpenShell(shell.path, shell.label)}
                className="text-left px-3 py-2 text-xs text-text-primary hover:bg-surface-hover w-full transition-colors flex items-center justify-between gap-2"
              >
                <span className="truncate">{shell.label}</span>
                {defaultShell === shell.path && <ChevronRight className="w-3 h-3 text-accent" />}
              </button>
            ))}

            {visiblePresets.length > 0 && (
              <>
                <div className="my-1 h-px bg-border/50" />
                <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-text-muted">Presets</div>
                {visiblePresets.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => handleOpenPreset(preset)}
                    className="text-left px-3 py-2 text-xs text-text-primary hover:bg-surface-hover w-full transition-colors"
                  >
                    {preset.name}
                  </button>
                ))}
              </>
            )}

            {visibleLinks.length > 0 && (
              <>
                <div className="my-1 h-px bg-border/50" />
                <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-text-muted">Links</div>
                {visibleLinks.map((link) => (
                  <button
                    key={link.id}
                    onClick={() => handleOpenLink(link)}
                    className="text-left px-3 py-2 text-xs text-text-primary hover:bg-surface-hover w-full transition-colors flex items-center gap-2"
                  >
                    {link.type === 'remote' && <Server className="w-3.5 h-3.5 text-accent" />}
                    <span className="truncate">{link.name}</span>
                  </button>
                ))}
              </>
            )}

            <div className="my-1 h-px bg-border/50" />
            <button
              onClick={() => {
                setOpen(false)
                setShowManager(true)
              }}
              className="text-left px-3 py-2 text-xs text-text-primary hover:bg-surface-hover w-full transition-colors flex items-center gap-2"
            >
              <Settings2 className="w-3.5 h-3.5" />
              Shell 管理...
            </button>
          </div>
        )}
      </div>

      <ShellManagerDialog
        isOpen={showManager}
        onClose={() => setShowManager(false)}
        availableShells={availableShells}
        presets={presets}
        links={links}
        defaultShell={defaultShell}
      />
    </>
  )
}

export const ShellMenu = memo(ShellMenuComponent)
