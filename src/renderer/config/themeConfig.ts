/**
 * 主题系统配置
 * 支持内置主题和自定义主题
 * 使用 RGB 格式以支持 Tailwind 透明度修饰符
 */

export interface ThemeColors {
  // 背景色 (RGB 格式: "r g b")
  background: string
  backgroundSecondary: string
  surface: string
  surfaceHover: string
  surfaceActive: string
  
  // 文字色
  textPrimary: string
  textSecondary: string
  textMuted: string
  
  // 边框色
  borderSubtle: string
  borderStrong: string
  
  // 强调色
  accent: string
  accentHover: string
  accentMuted: string
  
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
      background: '13 13 15',
      backgroundSecondary: '17 17 19',
      surface: '24 24 27',
      surfaceHover: '31 31 35',
      surfaceActive: '39 39 42',
      textPrimary: '250 250 250',
      textSecondary: '161 161 170',
      textMuted: '113 113 122',
      borderSubtle: '39 39 42',
      borderStrong: '63 63 70',
      accent: '139 92 246',
      accentHover: '124 58 237',
      accentMuted: '139 92 246',
      statusSuccess: '34 197 94',
      statusWarning: '245 158 11',
      statusError: '239 68 68',
      statusInfo: '59 130 246',
    },
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    type: 'dark',
    monacoTheme: 'vs-dark',
    colors: {
      background: '13 17 23',
      backgroundSecondary: '22 27 34',
      surface: '33 38 45',
      surfaceHover: '48 54 61',
      surfaceActive: '72 79 88',
      textPrimary: '201 209 217',
      textSecondary: '139 148 158',
      textMuted: '110 118 129',
      borderSubtle: '33 38 45',
      borderStrong: '48 54 61',
      accent: '88 166 255',
      accentHover: '121 192 255',
      accentMuted: '88 166 255',
      statusSuccess: '63 185 80',
      statusWarning: '210 153 34',
      statusError: '248 81 73',
      statusInfo: '88 166 255',
    },
  },
  {
    id: 'monokai',
    name: 'Monokai',
    type: 'dark',
    monacoTheme: 'vs-dark',
    colors: {
      background: '39 40 34',
      backgroundSecondary: '45 46 39',
      surface: '62 61 50',
      surfaceHover: '73 72 62',
      surfaceActive: '117 113 94',
      textPrimary: '248 248 242',
      textSecondary: '207 207 194',
      textMuted: '117 113 94',
      borderSubtle: '62 61 50',
      borderStrong: '73 72 62',
      accent: '166 226 46',
      accentHover: '184 243 57',
      accentMuted: '166 226 46',
      statusSuccess: '166 226 46',
      statusWarning: '230 219 116',
      statusError: '249 38 114',
      statusInfo: '102 217 239',
    },
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    type: 'dark',
    monacoTheme: 'vs-dark',
    colors: {
      background: '40 44 52',
      backgroundSecondary: '33 37 43',
      surface: '44 49 58',
      surfaceHover: '58 63 75',
      surfaceActive: '75 82 99',
      textPrimary: '171 178 191',
      textSecondary: '157 165 180',
      textMuted: '92 99 112',
      borderSubtle: '24 26 31',
      borderStrong: '58 63 75',
      accent: '97 175 239',
      accentHover: '116 185 240',
      accentMuted: '97 175 239',
      statusSuccess: '152 195 121',
      statusWarning: '229 192 123',
      statusError: '224 108 117',
      statusInfo: '97 175 239',
    },
  },
  {
    id: 'adnify-light',
    name: 'Adnify Light',
    type: 'light',
    monacoTheme: 'vs',
    colors: {
      background: '255 255 255',
      backgroundSecondary: '244 244 245',
      surface: '228 228 231',
      surfaceHover: '212 212 216',
      surfaceActive: '161 161 170',
      textPrimary: '24 24 27',
      textSecondary: '63 63 70',
      textMuted: '113 113 122',
      borderSubtle: '228 228 231',
      borderStrong: '212 212 216',
      accent: '124 58 237',
      accentHover: '109 40 217',
      accentMuted: '124 58 237',
      statusSuccess: '22 163 74',
      statusWarning: '217 119 6',
      statusError: '220 38 38',
      statusInfo: '37 99 235',
    },
  },
]

// 主题管理器
class ThemeManager {
  private currentTheme: Theme = builtinThemes[0]
  private customThemes: Theme[] = []
  private listeners: Set<(theme: Theme) => void> = new Set()

  constructor() {
    this.loadFromStorage()
  }

  private loadFromStorage() {
    try {
      const savedThemeId = localStorage.getItem('adnify-theme')
      const savedCustomThemes = localStorage.getItem('adnify-custom-themes')
      
      if (savedCustomThemes) {
        this.customThemes = JSON.parse(savedCustomThemes)
      }
      
      if (savedThemeId) {
        const theme = this.getThemeById(savedThemeId)
        if (theme) {
          this.currentTheme = theme
        }
      }
    } catch (e) {
      console.error('Failed to load theme from storage:', e)
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem('adnify-theme', this.currentTheme.id)
      localStorage.setItem('adnify-custom-themes', JSON.stringify(this.customThemes))
    } catch (e) {
      console.error('Failed to save theme to storage:', e)
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
      this.saveToStorage()
      this.notifyListeners()
    }
  }

  addCustomTheme(theme: Theme) {
    if (this.getThemeById(theme.id)) {
      theme.id = `${theme.id}-${Date.now()}`
    }
    this.customThemes.push(theme)
    this.saveToStorage()
  }

  removeCustomTheme(themeId: string) {
    this.customThemes = this.customThemes.filter(t => t.id !== themeId)
    if (this.currentTheme.id === themeId) {
      this.setTheme('adnify-dark')
    }
    this.saveToStorage()
  }

  applyTheme(theme: Theme) {
    const root = document.documentElement
    const colors = theme.colors

    // 设置 CSS 变量 (RGB 格式)
    root.style.setProperty('--color-background', colors.background)
    root.style.setProperty('--color-background-secondary', colors.backgroundSecondary)
    root.style.setProperty('--color-surface', colors.surface)
    root.style.setProperty('--color-surface-hover', colors.surfaceHover)
    root.style.setProperty('--color-surface-active', colors.surfaceActive)
    root.style.setProperty('--color-text-primary', colors.textPrimary)
    root.style.setProperty('--color-text-secondary', colors.textSecondary)
    root.style.setProperty('--color-text-muted', colors.textMuted)
    root.style.setProperty('--color-border-subtle', colors.borderSubtle)
    root.style.setProperty('--color-border-strong', colors.borderStrong)
    root.style.setProperty('--color-accent', colors.accent)
    root.style.setProperty('--color-accent-hover', colors.accentHover)
    root.style.setProperty('--color-accent-muted', colors.accentMuted)
    root.style.setProperty('--color-status-success', colors.statusSuccess)
    root.style.setProperty('--color-status-warning', colors.statusWarning)
    root.style.setProperty('--color-status-error', colors.statusError)
    root.style.setProperty('--color-status-info', colors.statusInfo)

    // 设置主题类型
    root.setAttribute('data-theme', theme.type)
    
    // 更新 color-scheme
    root.style.colorScheme = theme.type
    
    console.log('[Theme] Applied theme:', theme.name)
  }

  subscribe(callback: (theme: Theme) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  private notifyListeners() {
    this.listeners.forEach(cb => cb(this.currentTheme))
  }

  init() {
    this.applyTheme(this.currentTheme)
  }
}

export const themeManager = new ThemeManager()

// 导出辅助函数
export { hexToRgb }
