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
      // 注释
      { token: 'comment', foreground: textMuted.slice(1), fontStyle: 'italic' },
      { token: 'comment.doc', foreground: textMuted.slice(1), fontStyle: 'italic' },
      // 关键字 & 操作符
      { token: 'keyword', foreground: accent.slice(1) },
      { token: 'keyword.control', foreground: accent.slice(1) },
      { token: 'keyword.operator', foreground: isLight ? 'd63384' : 'ff7b72' },
      // 字面量
      { token: 'string', foreground: isLight ? '036a07' : 'a5d6ff' },
      { token: 'string.escape', foreground: isLight ? '9a6700' : 'f0c674' },
      { token: 'regexp', foreground: isLight ? '953800' : 'f97583' },
      { token: 'number', foreground: isLight ? '098658' : 'ffc600' },
      { token: 'constant', foreground: isLight ? '0550ae' : '79c0ff' },
      // 类型 & 类
      { token: 'type', foreground: isLight ? '267f99' : '4ec9b0' },
      { token: 'type.identifier', foreground: isLight ? '267f99' : '4ec9b0' },
      { token: 'class', foreground: isLight ? '953800' : 'ffa657' },
      { token: 'interface', foreground: isLight ? '267f99' : '4ec9b0' },
      { token: 'enum', foreground: isLight ? '267f99' : '4ec9b0' },
      // 函数 & 方法
      { token: 'function', foreground: isLight ? '8250df' : 'd2a8ff' },
      { token: 'function.declaration', foreground: isLight ? '8250df' : 'd2a8ff' },
      { token: 'method', foreground: isLight ? '8250df' : 'd2a8ff' },
      // 变量 & 参数
      { token: 'variable', foreground: text.slice(1) },
      { token: 'variable.predefined', foreground: isLight ? '0550ae' : '79c0ff' },
      { token: 'parameter', foreground: isLight ? '953800' : 'ffa657' },
      // 装饰器 & 注解
      { token: 'annotation', foreground: isLight ? '8250df' : 'd2a8ff' },
      { token: 'decorator', foreground: isLight ? '8250df' : 'd2a8ff' },
      // 标签 (HTML/JSX)
      { token: 'tag', foreground: isLight ? '116329' : '7ee787' },
      { token: 'attribute.name', foreground: isLight ? '0550ae' : '79c0ff' },
      { token: 'attribute.value', foreground: isLight ? '036a07' : 'a5d6ff' },
      // 元字符
      { token: 'delimiter', foreground: textMuted.slice(1) },
      { token: 'delimiter.bracket', foreground: text.slice(1) },
      { token: 'meta', foreground: textMuted.slice(1) },
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
