import { StateCreator } from 'zustand'

export type ThemeName = 'adnify-dark' | 'midnight' | 'dawn';

export interface ThemeSlice {
    currentTheme: ThemeName;
    setTheme: (theme: ThemeName) => void;
}

export const createThemeSlice: StateCreator<ThemeSlice, [], [], ThemeSlice> = (set) => ({
    currentTheme: 'adnify-dark',
    setTheme: (theme) => set({ currentTheme: theme }),
})
