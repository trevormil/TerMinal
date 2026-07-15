import type { AppearanceMode } from './types'

export type ResolvedThemeMode = 'dark' | 'light'
export type ThemeTokens = Record<`--gt-${string}`, string>
export type ThemeDefinition = {
  id: string
  title: string
  description: string
  modes: Record<ResolvedThemeMode, ThemeTokens>
}

const terminalDark: ThemeTokens = {
  '--gt-bg': '#0b0b10',
  '--gt-panel': '#131318',
  '--gt-panel-2': '#171720',
  '--gt-elevated': '#181820',
  '--gt-input': 'rgb(0 0 0 / 0.35)',
  '--gt-surface-hover': '#1a1a22',
  '--gt-border': '#26262e',
  '--gt-border-strong': '#3a3a46',
  '--gt-text': '#e7e7ee',
  '--gt-text-soft': '#d4d4dd',
  '--gt-text-muted': '#8a8a99',
  '--gt-text-muted-bright': '#a1a1aa',
  '--gt-text-faint': '#6b6b7b',
  '--gt-inverse': '#ffffff',
  '--gt-accent': '#7c6ef6',
  '--gt-accent-light': '#a89eff',
  '--gt-accent-2': '#00e0c6',
  '--gt-red': '#f87171',
  '--gt-yellow': '#fbbf24',
  '--gt-green': '#4ade80',
  '--gt-blue': '#60a5fa',
  '--gt-terminal-bg': '#0a0a0f',
  '--gt-terminal-fg': '#d4d4dd',
  '--gt-code-bg': '#0c0c11',
  '--gt-scrollbar': '#2a2a3a',
  '--gt-scrollbar-strong': '#3a3a4d',
  '--gt-grad': 'linear-gradient(135deg, #00e0c6 0%, #7c6ef6 100%)',
}

const terminalLight: ThemeTokens = {
  '--gt-bg': '#f6f7fb',
  '--gt-panel': '#ffffff',
  '--gt-panel-2': '#f1f3f8',
  '--gt-elevated': '#ffffff',
  '--gt-input': 'rgb(255 255 255 / 0.82)',
  '--gt-surface-hover': '#eef1f7',
  '--gt-border': '#d9dee8',
  '--gt-border-strong': '#b9c1d0',
  '--gt-text': '#171923',
  '--gt-text-soft': '#2b3040',
  '--gt-text-muted': '#647085',
  '--gt-text-muted-bright': '#4f5a6e',
  '--gt-text-faint': '#8b95a7',
  '--gt-inverse': '#0b0b10',
  '--gt-accent': '#6558e8',
  '--gt-accent-light': '#4f46d8',
  '--gt-accent-2': '#009f8f',
  '--gt-red': '#dc2626',
  '--gt-yellow': '#b7791f',
  '--gt-green': '#16803d',
  '--gt-blue': '#2563eb',
  '--gt-terminal-bg': '#f6f7fb',
  '--gt-terminal-fg': '#1f2937',
  '--gt-code-bg': '#f7f8fc',
  '--gt-scrollbar': '#c6ccd8',
  '--gt-scrollbar-strong': '#aeb7c8',
  '--gt-grad': 'linear-gradient(135deg, #009f8f 0%, #6558e8 100%)',
}

/* Solarized (Ethan Schoonover). Backgrounds and greys are the canonical base00–base03
   values; the accent hues are lifted off-spec where the originals fall under 4.5:1
   against their own background. */
const solarizedDark: ThemeTokens = {
  '--gt-bg': '#002b36',
  '--gt-panel': '#073642',
  '--gt-panel-2': '#08404f',
  '--gt-elevated': '#0a4a5a',
  '--gt-input': 'rgb(0 0 0 / 0.25)',
  '--gt-surface-hover': '#0b4655',
  '--gt-border': '#124f5e',
  '--gt-border-strong': '#35707c',
  '--gt-text': '#93a1a1',
  '--gt-text-soft': '#839496',
  '--gt-text-muted': '#657b83',
  '--gt-text-muted-bright': '#7d939b',
  '--gt-text-faint': '#586e75',
  '--gt-inverse': '#fdf6e3',
  '--gt-accent': '#268bd2',
  '--gt-accent-light': '#4aa3e0',
  '--gt-accent-2': '#2aa198',
  '--gt-red': '#e8635f',
  '--gt-yellow': '#c9a227',
  '--gt-green': '#9bb300',
  '--gt-blue': '#4aa3e0',
  '--gt-terminal-bg': '#00212b',
  '--gt-terminal-fg': '#93a1a1',
  '--gt-code-bg': '#01222c',
  '--gt-scrollbar': '#0f4a58',
  '--gt-scrollbar-strong': '#2b6673',
  '--gt-grad': 'linear-gradient(135deg, #2aa198 0%, #6c71c4 100%)',
}

const solarizedLight: ThemeTokens = {
  '--gt-bg': '#eee8d5',
  '--gt-panel': '#fdf6e3',
  '--gt-panel-2': '#f3ecda',
  '--gt-elevated': '#fdf6e3',
  '--gt-input': 'rgb(255 255 255 / 0.7)',
  '--gt-surface-hover': '#eae3cf',
  '--gt-border': '#ddd6c1',
  '--gt-border-strong': '#c3bda9',
  '--gt-text': '#002b36',
  '--gt-text-soft': '#073642',
  '--gt-text-muted': '#586e75',
  '--gt-text-muted-bright': '#4e646b',
  '--gt-text-faint': '#657b83',
  '--gt-inverse': '#002b36',
  '--gt-accent': '#1a6fa8',
  '--gt-accent-light': '#145a8a',
  '--gt-accent-2': '#1f8378',
  '--gt-red': '#c02722',
  '--gt-yellow': '#8a6800',
  '--gt-green': '#5f6d00',
  '--gt-blue': '#1a6fa8',
  '--gt-terminal-bg': '#fdf6e3',
  '--gt-terminal-fg': '#073642',
  '--gt-code-bg': '#f7f1de',
  '--gt-scrollbar': '#cfc9b5',
  '--gt-scrollbar-strong': '#b7b19d',
  '--gt-grad': 'linear-gradient(135deg, #1f8378 0%, #1a6fa8 100%)',
}

/* Midnight Pastel — tuned to Trevor's macOS Terminal.app profile: a deep
   indigo/navy base (#182133) with a pale-mint foreground (#bef4ec) and pastel
   pink / gold / green accents. */
const midnightPastelDark: ThemeTokens = {
  '--gt-bg': '#182133',
  '--gt-panel': '#1e2739',
  '--gt-panel-2': '#232d40',
  '--gt-elevated': '#262f43',
  '--gt-input': 'rgb(0 0 0 / 0.25)',
  '--gt-surface-hover': '#253048',
  '--gt-border': '#2c3750',
  '--gt-border-strong': '#3d4a68',
  '--gt-text': '#c8ece7',
  '--gt-text-soft': '#bef4ec',
  '--gt-text-muted': '#8a97a9',
  '--gt-text-muted-bright': '#a4aec0',
  '--gt-text-faint': '#6b7688',
  '--gt-inverse': '#182133',
  '--gt-accent': '#7fd7cf',
  '--gt-accent-light': '#a6e6df',
  '--gt-accent-2': '#f2a4c5',
  '--gt-red': '#f2a4c5',
  '--gt-yellow': '#f5bd4f',
  '--gt-green': '#a5e39a',
  '--gt-blue': '#8ab4f8',
  '--gt-terminal-bg': '#161e2e',
  '--gt-terminal-fg': '#bef4ec',
  '--gt-code-bg': '#141c2b',
  '--gt-scrollbar': '#2c3750',
  '--gt-scrollbar-strong': '#41506e',
  '--gt-grad': 'linear-gradient(135deg, #7fd7cf 0%, #f2a4c5 100%)',
}

const midnightPastelLight: ThemeTokens = {
  '--gt-bg': '#eef1f7',
  '--gt-panel': '#ffffff',
  '--gt-panel-2': '#f3f5fb',
  '--gt-elevated': '#ffffff',
  '--gt-input': 'rgb(255 255 255 / 0.8)',
  '--gt-surface-hover': '#e7ebf4',
  '--gt-border': '#d7dded',
  '--gt-border-strong': '#bcc5db',
  '--gt-text': '#1c2438',
  '--gt-text-soft': '#2a3450',
  '--gt-text-muted': '#5b6580',
  '--gt-text-muted-bright': '#495472',
  '--gt-text-faint': '#8791a8',
  '--gt-inverse': '#182133',
  '--gt-accent': '#2e9b90',
  '--gt-accent-light': '#1f8377',
  '--gt-accent-2': '#d1568a',
  '--gt-red': '#cf3d6a',
  '--gt-yellow': '#b07d10',
  '--gt-green': '#4f9a3f',
  '--gt-blue': '#3f6fd0',
  '--gt-terminal-bg': '#f3f5fb',
  '--gt-terminal-fg': '#26304a',
  '--gt-code-bg': '#f4f6fc',
  '--gt-scrollbar': '#c8cfe0',
  '--gt-scrollbar-strong': '#aeb7cd',
  '--gt-grad': 'linear-gradient(135deg, #2e9b90 0%, #d1568a 100%)',
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'terminal',
    title: 'Terminal',
    description: 'Current TerMinal palette, with coordinated light and dark token sets.',
    modes: {
      dark: terminalDark,
      light: terminalLight,
    },
  },
  {
    id: 'solarized',
    title: 'Solarized',
    description: 'Ethan Schoonover’s low-contrast palette, in both light and dark.',
    modes: {
      dark: solarizedDark,
      light: solarizedLight,
    },
  },
  {
    id: 'midnight-pastel',
    title: 'Midnight Pastel',
    description:
      'Deep indigo base with pale-mint text and pastel pink/gold accents — tuned to Trevor’s terminal profile.',
    modes: {
      dark: midnightPastelDark,
      light: midnightPastelLight,
    },
  },
]

export const ACCENT_SWATCHES = [
  { id: '', title: 'Theme', color: '' },
  { id: '#7c6ef6', title: 'Violet', color: '#7c6ef6' },
  { id: '#00a693', title: 'Teal', color: '#00a693' },
  { id: '#2563eb', title: 'Blue', color: '#2563eb' },
  { id: '#db2777', title: 'Rose', color: '#db2777' },
] as const

export function resolveThemeMode(mode: AppearanceMode): ResolvedThemeMode {
  if (mode === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

export function applyTheme(input: { mode: AppearanceMode; theme?: string; accent?: string }) {
  const theme = THEMES.find((t) => t.id === input.theme) || THEMES[0]
  const mode = resolveThemeMode(input.mode)
  const root = document.documentElement
  root.dataset.gtTheme = theme.id
  root.dataset.gtMode = mode
  for (const [key, value] of Object.entries(theme.modes[mode])) {
    root.style.setProperty(key, value)
  }
  if (input.accent?.trim()) root.style.setProperty('--gt-accent', input.accent.trim())
  window.dispatchEvent(new CustomEvent('gt.theme.changed', { detail: { mode, theme: theme.id } }))
}
