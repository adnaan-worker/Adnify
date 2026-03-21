/**
 * 主题系统配置
 * 支持内置主题和自定义主题
 * 使用 RGB 格式以支持 Tailwind 透明度修饰符
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'

export interface ThemeColors {
  // 背景色 (RGB 格式: "r g b")
  background: string
  backgroundSecondary: string
  backgroundTertiary: string

  // 表面色
  surface: string
  surfaceHover: string
  surfaceActive: string
  surfaceMuted: string

  // 文字色
  textPrimary: string
  textSecondary: string
  textMuted: string
  textInverted: string

  // 边框色
  border: string
  borderSubtle: string
  borderActive: string

  // 强调色
  accent: string
  accentHover: string
  accentActive: string
  accentForeground: string
  accentSubtle: string

  // 状态色
  statusSuccess: string
  statusWarning: string
  statusError: string
  statusInfo: string
}

export interface Theme {
  id: string
  name: string
  type: 'dark' | 'light'
  colors: ThemeColors
  monacoTheme: string
}

// 辅助函数：将 HEX 转换为 RGB 格式 "r g b"
function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return '0 0 0'
  return `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}`
}

// 内置主题 (使用 RGB 格式)
export const builtinThemes: Theme[] = [
  {
    id: 'adnify-dark',
    name: 'Adnify Dark',
    type: 'dark',
    monacoTheme: 'vs-dark',
    colors: {
      // 背景：极深灰带微弱紫调，更有质感
      background: '18 18 21',         // #121215
      backgroundSecondary: '25 25 29', // #19191D (侧边栏/面板)
      backgroundTertiary: '32 32 37',  // #202025 (输入框/卡片背景)

      // 表面：提升层次感
      surface: '25 25 29',
      surfaceHover: '38 38 44',
      surfaceActive: '45 45 52',
      surfaceMuted: '63 63 70',

      // 文字：非纯白，更柔和
      textPrimary: '242 242 247',     // 接近纯白但不刺眼
      textSecondary: '161 161 180',   // 带冷紫调的灰色
      textMuted: '100 100 115',
      textInverted: '18 18 21',

      // 边框：极其细腻的微弱分割
      border: '40 40 48',             // 融合度更高的边框
      borderSubtle: '32 32 37',
      borderActive: '82 82 100',

      // 强调色：高级灰紫 (Desaturated Lavender)
      accent: '139 92 246',          // Violet 500 (作为基准，看起来更舒服)
      accentHover: '124 58 237',     // Violet 600
      accentActive: '109 40 217',    // Violet 700
      accentForeground: '255 255 255',
      accentSubtle: '167 139 250',   // Violet 400 (用于微光效果)

      statusSuccess: '52 211 153',    // Emerald 400 (更清新的绿)
      statusWarning: '251 191 36',    // Amber 400
      statusError: '248 113 113',     // Red 400 (不刺眼的红)
      statusInfo: '96 165 250',       // Blue 400
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    type: 'dark',
    monacoTheme: 'vs-dark',
    colors: {
      // 经典深蓝灰 (Inspired by GitHub Dark Dimmed / Nord)
      background: '22 27 34',         // 主背景：深沉的蓝灰
      backgroundSecondary: '28 33 42', // 侧边栏：稍亮
      backgroundTertiary: '37 43 54',  // 输入框：明显区分

      surface: '28 33 42',
      surfaceHover: '45 51 65',
      surfaceActive: '55 61 75',
      surfaceMuted: '70 78 94',

      textPrimary: '220 225 235',     // 柔和白，不刺眼
      textSecondary: '140 150 170',   // 清晰的灰蓝
      textMuted: '90 100 120',
      textInverted: '22 27 34',

      border: '45 51 65',             // 融合度高的边框
      borderSubtle: '30 36 48',
      borderActive: '80 90 110',

      // 强调色：冰川蓝 (Ice Blue)
      accent: '56 189 248',          // Sky 400
      accentHover: '14 165 233',     // Sky 500
      accentActive: '2 132 199',     // Sky 600
      accentForeground: '15 23 42',
      accentSubtle: '125 211 252',   // Sky 300

      statusSuccess: '46 160 90',     // 稳重的绿
      statusWarning: '210 160 30',    // 柔和黄
      statusError: '240 80 80',       // 柔和红
      statusInfo: '60 160 240',       // 柔和蓝
    },
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    type: 'dark',
    monacoTheme: 'vs-dark',
    colors: {
      // 极致深黑 (High Contrast Neon)
      background: '3 3 5',            // 几乎纯黑
      backgroundSecondary: '10 10 15', // 极深蓝黑
      backgroundTertiary: '20 20 30',

      surface: '10 10 15',
      surfaceHover: '30 30 45',
      surfaceActive: '50 50 70',
      surfaceMuted: '80 80 100',

      textPrimary: '255 255 255',     // 纯白高亮
      textSecondary: '160 160 180',   // 冷灰
      textMuted: '100 100 120',
      textInverted: '0 0 0',

      border: '40 40 60',
      borderSubtle: '20 20 30',
      borderActive: '255 0 128',      // 激活时发光边框

      // 强调色：赛博粉 (Cyber Pink)
      accent: '255 0 128',
      accentHover: '255 50 150',
      accentActive: '200 0 100',
      accentForeground: '255 255 255',
      accentSubtle: '255 100 200',

      statusSuccess: '0 255 150',     // Neon Green
      statusWarning: '255 240 0',     // Neon Yellow
      statusError: '255 50 50',       // Neon Red
      statusInfo: '0 240 255',        // Cyan
    },
  },
  {
    id: 'dawn',
    name: 'Dawn',
    type: 'light',
    monacoTheme: 'vs',
    colors: {
      // 纯净白 (Clean & Crisp)
      background: '255 255 255',      // 纯白背景
      backgroundSecondary: '248 249 250', // 极淡的灰 (侧边栏)
      backgroundTertiary: '241 243 245',  // 输入框背景

      surface: '255 255 255',
      surfaceHover: '241 243 245',    // Hover 显现
      surfaceActive: '233 236 239',
      surfaceMuted: '222 226 230',

      // 文字：高对比度，拒绝模糊
      textPrimary: '33 37 41',        // 近似纯黑的深灰，锐利清晰
      textSecondary: '73 80 87',      // 中灰，辅助信息
      textMuted: '134 142 150',       // 浅灰，仅用于不重要信息
      textInverted: '255 255 255',

      border: '222 226 230',          // 清晰的分割线
      borderSubtle: '241 243 245',
      borderActive: '173 181 189',

      // 强调色：国际奇连蓝 (Inter Klein Blue) - 专业感强
      accent: '37 99 235',           // Blue 600
      accentHover: '29 78 216',      // Blue 700
      accentActive: '30 70 190',     // Blue 800
      accentForeground: '255 255 255',
      accentSubtle: '96 165 250',    // Blue 400

      statusSuccess: '22 163 74',     // Green 600
      statusWarning: '217 119 6',     // Amber 600
      statusError: '220 38 38',       // Red 600
      statusInfo: '37 99 235',        // Blue 600
    },
  },
]

// 主题管理器
const LOCAL_STORAGE_THEME_KEY = 'adnify-theme-id'
const LOCAL_STORAGE_CUSTOM_THEMES_KEY = 'adnify-custom-themes'

/** 校验自定义主题的 colors 字段是否完整且为字符串 */
function isValidTheme(t: unknown): t is Theme {
  if (!t || typeof t !== 'object') return false
  const theme = t as Record<string, unknown>
  if (typeof theme.id !== 'string' || typeof theme.name !== 'string') return false
  if (!theme.colors || typeof theme.colors !== 'object') return false
  const colors = theme.colors as Record<string, unknown>
  return typeof colors.background === 'string' && typeof colors.accent === 'string'
}

class ThemeManager {
  private currentTheme: Theme = builtinThemes[0]
  private customThemes: Theme[] = []
  private listeners: Set<(theme: Theme) => void> = new Set()
  private initialized = false

  constructor() {
    // 从 localStorage 快速恢复主题（同步，避免闪烁）
    try {
      const savedThemeId = localStorage.getItem(LOCAL_STORAGE_THEME_KEY)
      const savedCustomThemes = localStorage.getItem(LOCAL_STORAGE_CUSTOM_THEMES_KEY)

      if (savedCustomThemes) {
        const parsed = JSON.parse(savedCustomThemes)
        if (Array.isArray(parsed)) {
          this.customThemes = parsed.filter(isValidTheme)
        }
      }

      if (savedThemeId) {
        const theme = this.getThemeById(savedThemeId)
        if (theme) {
          this.currentTheme = theme
          // 立即应用主题（避免白屏）
          this.applyTheme(theme)
        }
      }
    } catch (e) {
      // 忽略 localStorage 错误
    }
  }

  async loadFromConfig() {
    try {
      // 并行读取主题配置
      const [savedThemeId, savedCustomThemes] = await Promise.all([
        api.settings.get('themeId'),
        api.settings.get('customThemes'),
      ])

      if (savedCustomThemes && Array.isArray(savedCustomThemes)) {
        const validThemes = savedCustomThemes.filter(isValidTheme)
        this.customThemes = validThemes
        localStorage.setItem(LOCAL_STORAGE_CUSTOM_THEMES_KEY, JSON.stringify(validThemes))
      }

      if (savedThemeId && typeof savedThemeId === 'string') {
        const theme = this.getThemeById(savedThemeId)
        if (theme) {
          this.currentTheme = theme
          localStorage.setItem(LOCAL_STORAGE_THEME_KEY, savedThemeId)
          localStorage.setItem('adnify-theme-bg', theme.colors.background)
          localStorage.setItem('adnify-theme-type', theme.type)
          // Migrate old configs so main.ts can access themeBg on next startup
          try { api.settings.set('themeBg', theme.colors.background) } catch (e) { }
        }
      }
    } catch (e) {
      logger.settings.error('Failed to load theme from config:', e)
    }
  }

  private saveToConfig() {
    // 同步写入 localStorage
    try {
      localStorage.setItem(LOCAL_STORAGE_THEME_KEY, this.currentTheme.id)
      localStorage.setItem('adnify-theme-bg', this.currentTheme.colors.background)
      localStorage.setItem('adnify-theme-type', this.currentTheme.type)
      localStorage.setItem(LOCAL_STORAGE_CUSTOM_THEMES_KEY, JSON.stringify(this.customThemes))
    } catch (e) {
      // 忽略 localStorage 错误
    }
    // 异步写入文件
    try {
      api.settings.set('themeId', this.currentTheme.id)
      api.settings.set('themeBg', this.currentTheme.colors.background)
      api.settings.set('customThemes', this.customThemes)
    } catch (e) {
      logger.settings.error('Failed to save theme to config:', e)
    }
  }

  getAllThemes(): Theme[] {
    return [...builtinThemes, ...this.customThemes]
  }

  getThemeById(id: string): Theme | undefined {
    return this.getAllThemes().find(t => t.id === id)
  }

  getCurrentTheme(): Theme {
    return this.currentTheme
  }

  setTheme(themeId: string) {
    const theme = this.getThemeById(themeId)
    if (theme) {
      this.currentTheme = theme
      this.applyTheme(theme)
      this.saveToConfig()
      this.notifyListeners()
    }
  }

  addCustomTheme(theme: Theme) {
    if (this.getThemeById(theme.id)) {
      theme.id = `${theme.id}-${Date.now()}`
    }
    this.customThemes.push(theme)
    this.saveToConfig()
  }

  removeCustomTheme(themeId: string) {
    this.customThemes = this.customThemes.filter(t => t.id !== themeId)
    if (this.currentTheme.id === themeId) {
      this.setTheme('adnify-dark')
    }
    this.saveToConfig()
  }

  applyTheme(theme: Theme) {
    const root = document.documentElement
    const colors = theme.colors

    // 设置 CSS 变量 (RGB 格式) - 修复变量名以匹配 Tailwind Config
    root.style.setProperty('--background', colors.background)
    root.style.setProperty('--background-secondary', colors.backgroundSecondary)
    root.style.setProperty('--background-tertiary', colors.backgroundTertiary)

    root.style.setProperty('--surface', colors.surface)
    root.style.setProperty('--surface-hover', colors.surfaceHover)
    root.style.setProperty('--surface-active', colors.surfaceActive)
    root.style.setProperty('--surface-muted', colors.surfaceMuted)

    root.style.setProperty('--text-primary', colors.textPrimary)
    root.style.setProperty('--text-secondary', colors.textSecondary)
    root.style.setProperty('--text-muted', colors.textMuted)
    root.style.setProperty('--text-inverted', colors.textInverted)

    root.style.setProperty('--border', colors.border)
    root.style.setProperty('--border-subtle', colors.borderSubtle)
    root.style.setProperty('--border-active', colors.borderActive)

    root.style.setProperty('--accent', colors.accent)
    root.style.setProperty('--accent-hover', colors.accentHover)
    root.style.setProperty('--accent-active', colors.accentActive)
    root.style.setProperty('--accent-foreground', colors.accentForeground)
    root.style.setProperty('--accent-subtle', colors.accentSubtle)

    root.style.setProperty('--status-success', colors.statusSuccess)
    root.style.setProperty('--status-warning', colors.statusWarning)
    root.style.setProperty('--status-error', colors.statusError)
    root.style.setProperty('--status-info', colors.statusInfo)

    // 设置主题类型
    root.setAttribute('data-theme', theme.type)

    // 更新 color-scheme
    root.style.colorScheme = theme.type

    logger.settings.info('[Theme] Applied theme:', theme.name)
  }

  subscribe(callback: (theme: Theme) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  private notifyListeners() {
    this.listeners.forEach(cb => cb(this.currentTheme))
  }

  async init() {
    if (this.initialized) return
    await this.loadFromConfig()
    this.applyTheme(this.currentTheme)
    this.initialized = true
  }
}

export const themeManager = new ThemeManager()

// 导出辅助函数
export { hexToRgb }
