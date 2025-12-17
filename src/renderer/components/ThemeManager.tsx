import React, { useEffect } from 'react';
import { useStore } from '../store';
import { ThemeName } from '../store/slices/themeSlice';

// Theme definitions
export const themes: Record<ThemeName, Record<string, string>> = {
    'adnify-dark': {
        '--color-background': '13 13 15', // #0D0D0F - Deep dark
        '--color-background-secondary': '18 18 20', // #121214
        '--color-surface': '24 24 27', // #18181B
        '--color-surface-hover': '39 39 42', // #27272A
        '--color-surface-active': '63 63 70', // #3F3F46

        '--color-border': '39 39 42', // #27272A - Subtle border
        '--color-border-subtle': '24 24 27', // #18181B

        '--color-text-primary': '250 250 250', // #FAFAFA
        '--color-text-secondary': '161 161 170', // #A1A1AA
        '--color-text-muted': '82 82 91', // #52525B

        '--color-accent': '99 102 241', // #6366F1 - Indigo 500
        '--color-accent-hover': '79 70 229', // #4F46E5
        '--color-accent-foreground': '255 255 255',

        '--color-status-success': '34 197 94',
        '--color-status-warning': '234 179 8',
        '--color-status-error': '239 68 68',
        '--color-status-info': '59 130 246',
    },
    'midnight': {
        '--color-background': '2 6 23', // Slate 950
        '--color-background-secondary': '15 23 42', // Slate 900
        '--color-surface': '30 41 59', // Slate 800
        '--color-surface-hover': '51 65 85', // Slate 700
        '--color-surface-active': '71 85 105', // Slate 600

        '--color-border': '30 41 59',
        '--color-border-subtle': '15 23 42',

        '--color-text-primary': '248 250 252',
        '--color-text-secondary': '148 163 184',
        '--color-text-muted': '100 116 139',

        '--color-accent': '56 189 248', // Sky 400
        '--color-accent-hover': '14 165 233', // Sky 500
        '--color-accent-foreground': '15 23 42',

        '--color-status-success': '34 197 94',
        '--color-status-warning': '234 179 8',
        '--color-status-error': '239 68 68',
        '--color-status-info': '59 130 246',
    },
    'dawn': {
        '--color-background': '255 255 255',
        '--color-background-secondary': '248 250 252',
        '--color-surface': '241 245 249',
        '--color-surface-hover': '226 232 240',
        '--color-surface-active': '203 213 225',

        '--color-border': '226 232 240',
        '--color-border-subtle': '241 245 249',

        '--color-text-primary': '15 23 42',
        '--color-text-secondary': '71 85 105',
        '--color-text-muted': '148 163 184',

        '--color-accent': '79 70 229',
        '--color-accent-hover': '67 56 202',
        '--color-accent-foreground': '255 255 255',

        '--color-status-success': '22 163 74',
        '--color-status-warning': '202 138 4',
        '--color-status-error': '220 38 38',
        '--color-status-info': '37 99 235',
    }
};

export const ThemeManager: React.FC = () => {
    const currentTheme = useStore((state) => state.currentTheme);

    useEffect(() => {
        const root = document.documentElement;
        const themeVars = themes[currentTheme];

        Object.entries(themeVars).forEach(([key, value]) => {
            root.style.setProperty(key, value);
        });

        // Set color-scheme for browser UI (scrollbars etc)
        root.style.colorScheme = currentTheme === 'dawn' ? 'light' : 'dark';

    }, [currentTheme]);

    return null;
};
