import React, { useEffect, ReactNode } from 'react';
import { useStore } from '@store';
import { ThemeName } from '@store/slices/themeSlice';
import { themeManager } from '@/renderer/config/themeConfig';
import { api } from '@/renderer/services/electronAPI';

interface ThemeManagerProps {
    children: ReactNode;
}

export const ThemeManager: React.FC<ThemeManagerProps> = ({ children }) => {
    const currentTheme = useStore((state) => state.currentTheme) as ThemeName;

    useEffect(() => {
        const theme = themeManager.getThemeById(currentTheme) || themeManager.getThemeById('adnify-dark')!;

        // Use the global themeManager to apply CSS vars and attributes
        themeManager.applyTheme(theme);

        const isLight = theme.type === 'light';
        const bgColors = theme.colors.background.split(' ').map(Number);

        // Convert Tailwind RGB string (e.g. "255 255 255") to Hex for Electron
        let hexColor = isLight ? '#ffffff' : '#09090b';
        if (bgColors.length === 3 && !bgColors.some(isNaN)) {
            const [r, g, b] = bgColors;
            hexColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        }

        // SYNC OS LEVEL THEME SO CHROME INVERTS CARET/CURSOR COLOR
        api.window.setTheme(isLight ? 'light' : 'dark', hexColor).catch(err => {
            console.error('Failed to sync OS native theme:', err)
        });

    }, [currentTheme]);

    return <>{children}</>;
};
