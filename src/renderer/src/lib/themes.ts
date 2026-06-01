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
  '--gt-text-faint': '#8b95a7',
  '--gt-inverse': '#0b0b10',
  '--gt-accent': '#6558e8',
  '--gt-accent-light': '#4f46d8',
  '--gt-accent-2': '#009f8f',
  '--gt-red': '#dc2626',
  '--gt-yellow': '#b7791f',
  '--gt-green': '#16803d',
  '--gt-blue': '#2563eb',
  '--gt-terminal-bg': '#fbfcff',
  '--gt-terminal-fg': '#1f2937',
  '--gt-code-bg': '#f7f8fc',
  '--gt-scrollbar': '#c6ccd8',
  '--gt-scrollbar-strong': '#aeb7c8',
  '--gt-grad': 'linear-gradient(135deg, #009f8f 0%, #6558e8 100%)',
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
