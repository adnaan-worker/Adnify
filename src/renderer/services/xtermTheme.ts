/**
 * xterm 主题工具 - 统一管理终端的样式常量和主题转换
 */
import { themeManager } from '@/renderer/config/themeConfig'

/** 注入到 DOM 的 xterm CSS，使用 CSS 变量跟随应用主题 */
export const XTERM_STYLE = `
.xterm { font-feature-settings: "liga" 0; position: relative; user-select: none; -ms-user-select: none; -webkit-user-select: none; padding: 4px; }
.xterm.focus, .xterm:focus { outline: none; }
.xterm .xterm-helpers { position: absolute; z-index: 5; }
.xterm .xterm-helper-textarea { padding: 0; border: 0; margin: 0; position: absolute; opacity: 0; left: -9999em; top: 0; width: 0; height: 0; z-index: -5; overflow: hidden; white-space: nowrap; }
.xterm .composition-view { background: #000; color: #FFF; display: none; position: absolute; white-space: pre; z-index: 1; }
.xterm .composition-view.active { display: block; }
.xterm .xterm-viewport { background-color: rgb(var(--background)); overflow-y: scroll; cursor: default; position: absolute; right: 0; left: 0; top: 0; bottom: 0; }
.xterm .xterm-screen { position: relative; }
.xterm .xterm-screen canvas { position: absolute; left: 0; top: 0; }
.xterm .xterm-scroll-area { visibility: hidden; }
.xterm-char-measure-element { display: inline-block; visibility: hidden; position: absolute; left: -9999em; top: 0; }
.xterm.enable-mouse-events { cursor: default; }
.xterm.xterm-cursor-pointer { cursor: pointer; }
.xterm.xterm-cursor-crosshair { cursor: crosshair; }
.xterm .xterm-accessibility, .xterm .xterm-message-overlay { position: absolute; left: 0; top: 0; bottom: 0; right: 0; z-index: 10; color: transparent; }
.xterm-live-region { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
.xterm-dim { opacity: 0.5; }
.xterm-underline { text-decoration: underline; }
.xterm-selection-layer { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none; }
.xterm-cursor-layer { position: absolute; top: 0; left: 0; z-index: 2; pointer-events: none; }
.xterm-link-layer { position: absolute; top: 0; left: 0; z-index: 11; pointer-events: none; }
.xterm-link-layer a { cursor: pointer; color: rgb(var(--accent)); text-decoration: underline; }
`

/** 将 "r g b" 格式转为 "#rrggbb" */
function rgbToHex(rgb: string): string {
  if (!rgb || typeof rgb !== 'string') return '#000000'
  const [r, g, b] = rgb.split(' ').map(Number)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/** 根据应用主题 ID 生成 xterm ITheme 对象 */
export function getTerminalTheme(themeName: string): Record<string, string> {
  const theme = themeManager.getThemeById(themeName) ?? themeManager.getThemeById('adnify-dark')!
  const c = theme.colors
  return {
    background: rgbToHex(c.background),
    foreground: rgbToHex(c.textPrimary),
    cursor: rgbToHex(c.textSecondary),
    selectionBackground: rgbToHex(c.accent),
    selectionForeground: rgbToHex(c.textInverted),
    black: rgbToHex(c.surface),
    red: rgbToHex(c.statusError),
    green: rgbToHex(c.statusSuccess),
    yellow: rgbToHex(c.statusWarning),
    blue: rgbToHex(c.statusInfo),
    magenta: rgbToHex(c.accentSubtle),
    cyan: rgbToHex(c.accent),
    white: rgbToHex(c.textPrimary),
  }
}
