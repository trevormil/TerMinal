import { mkdirSync, writeFileSync, chmodSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// ---------------------------------------------------------------------------
// Status-line shim — zero-API plan-usage + context source.
//
// Claude Code pipes a rich JSON blob to its configured `statusLine` command on
// every assistant message (model, context_window.*, rate_limits.*, cost.*).
// The `/api/oauth/usage` endpoint that backs the Plan Usage widget is heavily
// rate-limited (429s), so instead we point sessions we launch at a shim that
// tees that JSON to a per-session cache file. We read the cache (never the API)
// for the 5h/weekly gauges, and get the *authoritative* context_window_size
// (fixes the 200k-vs-1M guess). The shim then delegates to the user's own
// status line so their in-terminal display is preserved.
//
// Keyed by GT_TERMINAL_SESSION_ID — TerMinal sets it in the PTY env, and the
// statusLine command inherits it, so the shim needs no JSON parsing to know
// which file to write.
// ---------------------------------------------------------------------------

const CFG = join(homedir(), '.config', 'TerMinal')
const SHIM_PATH = join(CFG, 'bin', 'statusline-shim.sh')
const CACHE_DIR = join(CFG, 'statusline')

const SHIM = `#!/bin/bash
# Installed by TerMinal. Tees Claude Code's statusLine JSON to a per-session
# cache file, then delegates to the user's real status line. Do not edit —
# TerMinal rewrites this on launch.
input=$(cat)
dir="$HOME/.config/TerMinal/statusline"
mkdir -p "$dir" 2>/dev/null
sid="\${GT_TERMINAL_SESSION_ID:-default}"
printf '%s' "$input" > "$dir/$sid.json.tmp" 2>/dev/null && mv -f "$dir/$sid.json.tmp" "$dir/$sid.json" 2>/dev/null
# Preserve the user's own status line, if any (read from disk so we never
# recurse into this shim). Falls back to a compact model · context line.
orig=$(jq -r '.statusLine.command // empty' "$HOME/.claude/settings.json" 2>/dev/null)
if [ -n "$orig" ] && [ "$orig" != "$0" ]; then
  printf '%s' "$input" | eval "$orig"
else
  printf '%s' "$input" | jq -r '"\\(.model.display_name) · \\(.context_window.used_percentage // 0)% ctx"' 2>/dev/null || true
fi
`

/** Write the shim to the stable bin path. Idempotent; called on launch. */
export function installStatuslineShim(): void {
  try {
    mkdirSync(join(CFG, 'bin'), { recursive: true })
    writeFileSync(SHIM_PATH, SHIM, { mode: 0o755 })
    chmodSync(SHIM_PATH, 0o755)
  } catch {
    /* best effort */
  }
}

/** The `--settings` JSON string that wires a Claude session to the shim. */
export function statuslineSettingsArg(): string {
  return JSON.stringify({
    statusLine: { type: 'command', command: SHIM_PATH, padding: 1 },
  })
}

export type StatusLine = {
  ts: number // file mtime (ms)
  model?: { id?: string; display_name?: string }
  contextWindowSize?: number
  contextUsedPct?: number
  fiveHour?: { pct: number; resetsAt: number | null } | null
  sevenDay?: { pct: number; resetsAt: number | null } | null
  costUsd?: number
}

function win(w: any): { pct: number; resetsAt: number | null } | null {
  if (!w || typeof w.used_percentage !== 'number') return null
  return { pct: w.used_percentage, resetsAt: typeof w.resets_at === 'number' ? w.resets_at : null }
}

/** Read the cached statusLine JSON for a session, or null if absent/unreadable. */
export function readStatusLine(sessionId: string): StatusLine | null {
  if (!sessionId) return null
  const file = join(CACHE_DIR, `${sessionId}.json`)
  try {
    const mtime = statSync(file).mtimeMs
    const j: any = JSON.parse(readFileSync(file, 'utf8'))
    const cw = j.context_window || {}
    const rl = j.rate_limits || {}
    return {
      ts: mtime,
      model: j.model,
      contextWindowSize: typeof cw.context_window_size === 'number' ? cw.context_window_size : undefined,
      contextUsedPct: typeof cw.used_percentage === 'number' ? cw.used_percentage : undefined,
      fiveHour: win(rl.five_hour),
      sevenDay: win(rl.seven_day),
      costUsd: typeof j.cost?.total_cost_usd === 'number' ? j.cost.total_cost_usd : undefined,
    }
  } catch {
    return null
  }
}
