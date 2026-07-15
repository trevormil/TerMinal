import { Waypoints } from 'lucide-react'
import type { Engine } from '../lib/types'
// `?inline` forces each logo to a base64 data: URI baked into the bundle rather
// than an external asset file fetched at render time. The Cursor PNG (the only
// raster logo) used to exceed Vite's 4KB inline limit, so it shipped as a separate
// file that intermittently failed to resolve on Electron's custom protocol —
// making only the Cursor badge flaky. Inlining all four makes them unfailable.
import openaiLogo from '../assets/openai.svg?inline'
import claudeLogo from '../assets/claude.svg?inline'
import cursorLogo from '../assets/cursor.png?inline'
import hermesLogo from '../assets/hermes.svg?inline'
import { engineLabel } from '../lib/engines'

// OpenRouter ships no wordmark asset — render a lucide glyph for it instead.
const LOGO: Record<Engine, string> = {
  codex: openaiLogo,
  claude: claudeLogo,
  cursor: cursorLogo,
  openrouter: '',
  hermes: hermesLogo,
}

// Single source for the engine wordmark — anywhere we show an engine
// in the UI, render this alongside so the engine is identifiable at a glance.
// Defaults are sized for inline use next to small labels (badges, list rows).
export function EngineLogo({
  engine,
  size = 11,
  className = '',
}: {
  engine: Engine | string
  size?: number
  className?: string
}) {
  if (engine === 'openrouter') {
    return (
      <Waypoints
        size={size}
        strokeWidth={2}
        className={`inline-block shrink-0 ${className}`}
        aria-label="OpenRouter"
      />
    )
  }
  const src = LOGO[engine as Engine]
  if (!src) return null
  return (
    <img
      src={src}
      alt={engineLabel(engine)}
      width={size}
      height={size}
      draggable={false}
      className={`inline-block shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
