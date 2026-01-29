import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'

const LOCAL_STORAGE_KEY = 'adnify-keybindings'

export interface Command {
    id: string
    title: string
    category?: string
    defaultKey?: string
    handler?: () => void
}

export interface Keybinding {
    commandId: string
    key: string
}

class KeybindingService {
    private commands: Map<string, Command> = new Map()
    private overrides: Map<string, string> = new Map()
    private initialized = false

    async init() {
        if (this.initialized) return
        await this.loadOverrides()
        this.initialized = true
        logger.system.info('[KeybindingService] Initialized with', this.commands.size, 'commands')
    }

    registerCommand(command: Command) {
        this.commands.set(command.id, command)
    }

    getBinding(commandId: string): string | undefined {
        const override = this.overrides.get(commandId)
        // 如果 override 存在且非空，使用 override；否则使用默认值
        if (override && override.trim()) {
            return override
        }
        return this.commands.get(commandId)?.defaultKey
    }

    getAllCommands(): Command[] {
        return Array.from(this.commands.values())
    }

    isOverridden(commandId: string): boolean {
        return this.overrides.has(commandId)
    }

    /**
     * 处理按键事件
     * @returns 如果事件被处理则返回 true
     */
    handleKeyDown(e: KeyboardEvent | React.KeyboardEvent): boolean {
        for (const [id, command] of this.commands) {
            if (this.matches(e as KeyboardEvent, id)) {
                logger.system.info(`[KeybindingService] Executing command: ${id}`)
                if (command.handler) {
                    command.handler()
                    return true
                }
            }
        }
        return false
    }

    matches(e: KeyboardEvent | React.KeyboardEvent, commandId: string): boolean {
        const binding = this.getBinding(commandId)
        if (!binding) return false

        const parts = binding.toLowerCase().split('+')
        const key = parts.pop()
        if (!key) return false

        const meta = parts.includes('meta') || parts.includes('cmd') || parts.includes('command')
        const ctrl = parts.includes('ctrl') || parts.includes('control')
        const shift = parts.includes('shift')
        const alt = parts.includes('alt') || parts.includes('option')

        // 修饰键匹配
        const modifiersMatch =
            (e.metaKey === meta) &&
            (e.ctrlKey === ctrl) &&
            (e.altKey === alt)
        // Shift 单独检查：如果绑定不需要 Shift，但用户按了 Shift，也不匹配
        const shiftMatch = shift || !e.shiftKey

        // 按键匹配（忽略大小写）
        let keyMatch = false
        if (key === 'space') {
            keyMatch = e.code === 'Space' || e.key === ' '
        } else if (key === 'escape') {
            keyMatch = e.key === 'Escape' || e.code === 'Escape'
        } else if (key === 'enter') {
            keyMatch = e.key === 'Enter' || e.code === 'Enter'
        } else if (key.startsWith('arrow')) {
            keyMatch = e.key.toLowerCase() === key || e.code.toLowerCase() === key
        } else if (key.startsWith('f') && /^f\d+$/.test(key)) {
            keyMatch = e.key.toLowerCase() === key || e.code.toLowerCase() === key
        } else if (key === '`') {
            keyMatch = e.key === '`' || e.code === 'Backquote'
        } else if (key === ',') {
            keyMatch = e.key === ',' || e.code === 'Comma'
        } else {
            keyMatch = e.key.toLowerCase() === key.toLowerCase()
        }

        return modifiersMatch && shiftMatch && keyMatch
    }

    async updateBinding(commandId: string, newKey: string | null) {
        if (newKey === null) {
            this.overrides.delete(commandId)
        } else {
            this.overrides.set(commandId, newKey)
        }
        await this.saveOverrides()
    }

    async resetBinding(commandId: string) {
        this.overrides.delete(commandId)
        await this.saveOverrides()
    }

    private async loadOverrides() {
        // 优先从 localStorage 读取（快速）
        try {
            const localData = localStorage.getItem(LOCAL_STORAGE_KEY)
            if (localData) {
                const parsed = JSON.parse(localData)
                this.overrides = new Map(Object.entries(parsed))
                // 异步同步到文件（不阻塞）
                api.settings.set('keybindings', parsed).catch(() => { })
                return
            }
        } catch (e) {
            // localStorage 读取失败，继续从文件读取
        }

        // 从文件读取
        try {
            const saved = await api.settings.get('keybindings') as Record<string, string>
            if (saved) {
                this.overrides = new Map(Object.entries(saved))
                // 同步到 localStorage
                localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(saved))
            }
        } catch (e) {
            logger.system.error('Failed to load keybindings:', e)
        }
    }

    private async saveOverrides() {
        const obj = Object.fromEntries(this.overrides)
        // 同步写入 localStorage（快速）
        try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(obj))
        } catch (e) {
            logger.system.error('Failed to save keybindings to localStorage:', e)
        }
        // 异步写入文件（持久化）
        try {
            await api.settings.set('keybindings', obj)
        } catch (e) {
            logger.system.error('Failed to save keybindings:', e)
        }
    }
}

export const keybindingService = new KeybindingService()
