import { Waypoints } from 'lucide-react'
import type { Engine } from '../lib/types'
import openaiLogo from '../assets/openai.svg'
import claudeLogo from '../assets/claude.svg'
import cursorLogo from '../assets/cursor.png'
import { engineLabel } from '../lib/engines'

// OpenRouter ships no wordmark asset — render a lucide glyph for it instead.
const LOGO: Record<Engine, string> = {
  codex: openaiLogo,
  claude: claudeLogo,
  cursor: cursorLogo,
  openrouter: '',
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
    return <Waypoints size={size} strokeWidth={2} className={`inline-block shrink-0 ${className}`} aria-label="OpenRouter" />
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
