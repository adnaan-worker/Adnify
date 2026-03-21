import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import type { ShellLink, ShellPreset, ShellState } from '../types'

const STORAGE_KEY = 'adnify-shell-registry'
const SETTINGS_KEY = 'shellRegistry'

const DEFAULT_STATE: ShellState = {
  defaultShell: undefined,
  presets: [],
  links: [],
}

type ShellStateListener = (state: ShellState) => void

class ShellRegistryService {
  private state: ShellState = { ...DEFAULT_STATE }
  private listeners = new Set<ShellStateListener>()
  private loaded = false
  private loadingPromise: Promise<ShellState> | null = null

  private normalizePreset(input: Partial<ShellPreset> | null | undefined): ShellPreset | null {
    if (!input || !input.id || !input.name) return null

    return {
      id: input.id,
      name: input.name,
      shellPath: input.shellPath || undefined,
      cwd: input.cwd || undefined,
      args: Array.isArray(input.args) ? input.args.filter(Boolean) : undefined,
      isDefault: input.isDefault,
      visibleInMenu: input.visibleInMenu !== false,
      group: input.group?.trim() || undefined,
      favorite: input.favorite === true,
    }
  }

  private normalizeLink(input: Partial<ShellLink> | null | undefined): ShellLink | null {
    if (!input || !input.id || !input.name || !input.type) return null

    return {
      id: input.id,
      name: input.name,
      type: input.type,
      target: input.target || '',
      shellPath: input.shellPath || undefined,
      args: Array.isArray(input.args) ? input.args.filter(Boolean) : undefined,
      visibleInMenu: input.visibleInMenu !== false,
      remote: input.remote ? {
        host: input.remote.host || '',
        port: input.remote.port,
        username: input.remote.username || undefined,
        password: input.remote.password || undefined,
        privateKeyPath: input.remote.privateKeyPath || undefined,
        remotePath: input.remote.remotePath || undefined,
      } : undefined,
      group: input.group?.trim() || undefined,
      favorite: input.favorite === true,
      cwd: input.cwd || undefined,
    }
  }

  private normalizeState(input?: Partial<ShellState> | null): ShellState {
    return {
      defaultShell: input?.defaultShell || undefined,
      presets: Array.isArray(input?.presets)
        ? input!.presets.map((item) => this.normalizePreset(item)).filter((item): item is ShellPreset => Boolean(item))
        : [],
      links: Array.isArray(input?.links)
        ? input!.links.map((item) => this.normalizeLink(item)).filter((item): item is ShellLink => Boolean(item))
        : [],
    }
  }

  private notify() {
    const snapshot = this.getState()
    this.listeners.forEach(listener => listener(snapshot))
  }

  private saveToLocalStorage(state: ShellState) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (error) {
      logger.system.warn('[ShellRegistry] Failed to save local cache:', error)
    }
  }

  private loadFromLocalStorage(): ShellState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      return this.normalizeState(JSON.parse(raw))
    } catch (error) {
      logger.system.warn('[ShellRegistry] Failed to load local cache:', error)
      return null
    }
  }

  private async persist() {
    const snapshot = this.getState()
    this.saveToLocalStorage(snapshot)

    try {
      await api.settings.set(SETTINGS_KEY, snapshot)
    } catch (error) {
      logger.system.warn('[ShellRegistry] Failed to persist settings:', error)
    }
  }

  async load(): Promise<ShellState> {
    if (this.loaded) return this.getState()
    if (this.loadingPromise) return this.loadingPromise

    this.loadingPromise = (async () => {
      const local = this.loadFromLocalStorage()
      if (local) {
        this.state = local
        this.notify()
      }

      try {
        const saved = await api.settings.get(SETTINGS_KEY)
        if (saved && typeof saved === 'object') {
          this.state = this.normalizeState(saved as Partial<ShellState>)
          this.saveToLocalStorage(this.state)
        } else if (local) {
          this.state = local
        }
      } catch (error) {
        logger.system.warn('[ShellRegistry] Failed to load settings:', error)
      }

      this.loaded = true
      this.loadingPromise = null
      this.notify()
      return this.getState()
    })()

    return this.loadingPromise
  }

  subscribe(listener: ShellStateListener): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => this.listeners.delete(listener)
  }

  getState(): ShellState {
    return {
      defaultShell: this.state.defaultShell,
      presets: [...this.state.presets],
      links: [...this.state.links],
    }
  }

  async setState(nextState: ShellState) {
    this.state = this.normalizeState(nextState)
    this.notify()
    await this.persist()
  }

  async setDefaultShell(shellPath?: string) {
    this.state.defaultShell = shellPath || undefined
    this.notify()
    await this.persist()
  }

  async setPresets(presets: ShellPreset[]) {
    this.state.presets = this.normalizeState({ presets }).presets
    this.notify()
    await this.persist()
  }

  async setLinks(links: ShellLink[]) {
    this.state.links = this.normalizeState({ links }).links
    this.notify()
    await this.persist()
  }

  async addPreset(preset: ShellPreset) {
    const normalized = this.normalizePreset(preset)
    if (!normalized) return
    this.state.presets = [...this.state.presets, normalized]
    this.notify()
    await this.persist()
  }

  async updatePreset(id: string, updates: Partial<ShellPreset>) {
    this.state.presets = this.state.presets.map((preset) =>
      preset.id === id ? this.normalizePreset({ ...preset, ...updates }) || preset : preset,
    )
    this.notify()
    await this.persist()
  }

  async removePreset(id: string) {
    this.state.presets = this.state.presets.filter(preset => preset.id !== id)
    this.notify()
    await this.persist()
  }

  async addLink(link: ShellLink) {
    const normalized = this.normalizeLink(link)
    if (!normalized) return
    this.state.links = [...this.state.links, normalized]
    this.notify()
    await this.persist()
  }

  async updateLink(id: string, updates: Partial<ShellLink>) {
    this.state.links = this.state.links.map((link) =>
      link.id === id ? this.normalizeLink({ ...link, ...updates }) || link : link,
    )
    this.notify()
    await this.persist()
  }

  async removeLink(id: string) {
    this.state.links = this.state.links.filter(link => link.id !== id)
    this.notify()
    await this.persist()
  }
}

export const shellRegistryService = new ShellRegistryService()
