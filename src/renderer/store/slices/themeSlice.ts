import { StateCreator } from 'zustand'

export type ThemeName = 'adnify-dark' | 'midnight' | 'dawn' | 'cyberpunk';

export interface ThemeSlice {
    currentTheme: ThemeName;
    setTheme: (theme: ThemeName) => void;
}

export const createThemeSlice: StateCreator<ThemeSlice, [], [], ThemeSlice> = (set) => {
    // Attempt to read synchronous cache for immediate initialization, fallback to dark
    const savedTheme = typeof localStorage !== 'undefined' ? localStorage.getItem('adnify-theme-id') as ThemeName : 'adnify-dark';
    const validThemes = ['adnify-dark', 'midnight', 'dawn', 'cyberpunk'];
    const initialTheme = validThemes.includes(savedTheme) ? savedTheme : 'adnify-dark';

    return {
        currentTheme: initialTheme,
        setTheme: (theme) => set({ currentTheme: theme }),
    }
}
