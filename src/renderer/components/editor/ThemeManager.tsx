import React, { useEffect, ReactNode } from 'react';
import { useStore } from '@store';
import { ThemeName } from '@store/slices/themeSlice';
import { builtinThemes } from '@/renderer/config/themeConfig';
import { api } from '@/renderer/services/electronAPI';

/**
 * 主题管理器 - 从 themeConfig 导入主题定义，确保单一数据源
 * 
 * 注意：这里的主题定义是从 themeConfig.ts 动态生成的，
 * 确保所有主题颜色只在一个地方定义，避免不一致问题
 */
export const themes: Record<ThemeName, Record<string, string>> = builtinThemes.reduce((acc, theme) => {
    acc[theme.id as ThemeName] = {
        '--background': theme.colors.background,
        '--background-secondary': theme.colors.backgroundSecondary,
        '--background-tertiary': theme.colors.backgroundTertiary,
        '--surface': theme.colors.surface,
        '--surface-hover': theme.colors.surfaceHover,
        '--surface-active': theme.colors.surfaceActive,
        '--surface-muted': theme.colors.surfaceMuted,
        '--border': theme.colors.border,
        '--border-subtle': theme.colors.borderSubtle,
        '--border-active': theme.colors.borderActive,
        '--text-primary': theme.colors.textPrimary,
        '--text-secondary': theme.colors.textSecondary,
        '--text-muted': theme.colors.textMuted,
        '--text-inverted': theme.colors.textInverted,
        '--accent': theme.colors.accent,
        '--accent-hover': theme.colors.accentHover,
        '--accent-active': theme.colors.accentActive,
        '--accent-foreground': theme.colors.accentForeground,
        '--accent-subtle': theme.colors.accentSubtle,
        '--status-success': theme.colors.statusSuccess,
        '--status-warning': theme.colors.statusWarning,
        '--status-error': theme.colors.statusError,
        '--status-info': theme.colors.statusInfo,
        '--radius-sm': '0.25rem',
        '--radius-md': '0.375rem',
        '--radius-lg': '0.5rem',
        '--radius-full': '9999px',
    };
    return acc;
}, {} as Record<ThemeName, Record<string, string>>);

interface ThemeManagerProps {
    children: ReactNode;
}

export const ThemeManager: React.FC<ThemeManagerProps> = ({ children }) => {
    const currentTheme = useStore((state) => state.currentTheme) as ThemeName;

    useEffect(() => {
        const root = document.documentElement;
        const themeVars = themes[currentTheme] || themes['adnify-dark'];

        Object.entries(themeVars).forEach(([key, value]: [string, string]) => {
            root.style.setProperty(key, value);
        });

        const isLight = currentTheme === 'dawn';
        root.style.colorScheme = isLight ? 'light' : 'dark';
        document.body.setAttribute('data-theme', isLight ? 'light' : 'dark');

        // Convert Tailwind RGB string (e.g. "255 255 255") to Hex for Electron
        let hexColor = isLight ? '#ffffff' : '#09090b';
        if (themeVars['--background']) {
            const [r, g, b] = themeVars['--background'].split(' ').map(Number);
            if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
                hexColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
            }
        }

        // SYNC OS LEVEL THEME SO CHROME INVERTS CARET/CURSOR COLOR
        api.window.setTheme(isLight ? 'light' : 'dark', hexColor).catch(err => {
            console.error('Failed to sync OS native theme:', err)
        });

    }, [currentTheme]);

    return <>{children}</>;
};
