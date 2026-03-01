/**
 * Monaco 主题定义
 */
import { themeManager } from '@/renderer/config/themeConfig'
import type { ThemeName } from '@store/slices/themeSlice'

// RGB 字符串转 Hex
const rgbToHex = (rgbStr: string) => {
  const parts = rgbStr.split(' ').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return '#000000'
  const [r, g, b] = parts
  return '#' + [r, g, b].map(x => {
    const hex = Math.max(0, Math.min(255, x)).toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }).join('')
}

/**
 * 定义 Monaco 主题
 */
export function defineMonacoTheme(
  monacoInstance: typeof import('monaco-editor') | typeof import('monaco-editor/esm/vs/editor/editor.api'),
  themeName: ThemeName
) {
  const theme = themeManager.getThemeById(themeName) || themeManager.getThemeById('adnify-dark')!
  const colors = theme.colors
  const isLight = theme.type === 'light'

  const bg = rgbToHex(colors.background)
  const surface = rgbToHex(colors.surface)
  const text = rgbToHex(colors.textPrimary)
  const textMuted = rgbToHex(colors.textMuted)
  const border = rgbToHex(colors.border)
  const accent = rgbToHex(colors.accent)
  const selection = accent + '40'

  monacoInstance.editor.defineTheme('adnify-dynamic', {
    base: isLight ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: textMuted.slice(1), fontStyle: 'italic' },
      { token: 'keyword', foreground: accent.slice(1) },
      { token: 'string', foreground: isLight ? '036a07' : 'a5d6ff' },
      { token: 'number', foreground: isLight ? '098658' : 'ffc600' },
      { token: 'type', foreground: isLight ? '267f99' : '4ec9b0' },
    ],
    colors: {
      'editor.background': bg,
      'editor.foreground': text,
      'editor.lineHighlightBackground': surface,
      'editorCursor.foreground': accent,
      'editorWhitespace.foreground': border,
      'editorIndentGuide.background': border,
      'editor.selectionBackground': selection,
      'editorLineNumber.foreground': textMuted,
      'editorLineNumber.activeForeground': text,
      'editorWidget.background': surface,
      'editorWidget.border': border,
      'editorSuggestWidget.background': surface,
      'editorSuggestWidget.border': border,
      'editorSuggestWidget.selectedBackground': accent + '20',
      'editorHoverWidget.background': surface,
      'editorHoverWidget.border': border,
    }
  })
}
