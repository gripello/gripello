export type ThemeName = 'light' | 'dark'

export interface ThemePalette {
    background: string
    surface: string
    scrim: string
    primary: string
    success: string
    error: string
    info: string
}

export const THEME_COLORS: Record<ThemeName, ThemePalette> = {
    light: {
        background: '#f8faf3',
        surface: '#ffffff',
        scrim: 'rgba(245, 245, 245, 0.75)',
        primary: '#38741c',
        success: '#2e7d32',
        error: '#ba1a1a',
        info: '#0061a4',
    },
    dark: {
        background: '#0d1117',
        surface: '#161b22',
        scrim: 'rgba(28, 33, 40, 0.75)',
        primary: '#238636',
        success: '#238636',
        error: '#f85149',
        info: '#58a6ff',
    },
}

export const PODIUM_ROWS: Record<number, string> = {
    1: 'bg-[#f5c542]/15',
    2: 'bg-[#9aa4ae]/15',
    3: 'bg-[#cd7f32]/12',
}

export const MEDALS: Record<number, string> = {
    1: 'bg-[#f5c542] text-[#3a2a00]',
    2: 'bg-[#c9d1d9] text-[#1f2328]',
    3: 'bg-[#cd7f32] text-[#2b1600]',
}
