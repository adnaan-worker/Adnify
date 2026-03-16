import { StateCreator } from 'zustand'
import { builtinThemes } from '@/renderer/config/themeConfig'

/** 内置主题 ID 联合类型 */
export type BuiltinThemeName = 'adnify-dark' | 'midnight' | 'dawn' | 'cyberpunk'

/** 主题名称，支持内置和自定义主题 */
export type ThemeName = string

export interface ThemeSlice {
    currentTheme: ThemeName;
    setTheme: (theme: ThemeName) => void;
}

export const createThemeSlice: StateCreator<ThemeSlice, [], [], ThemeSlice> = (set) => {
    const savedTheme = typeof localStorage !== 'undefined' ? localStorage.getItem('adnify-theme-id') : null
    const validIds = builtinThemes.map(t => t.id)
    // 允许内置主题或已保存的自定义主题 ID
    const initialTheme = savedTheme && (validIds.includes(savedTheme) || savedTheme.startsWith('custom-'))
        ? savedTheme
        : 'adnify-dark'

    return {
        currentTheme: initialTheme,
        setTheme: (theme) => set({ currentTheme: theme }),
    }
}
