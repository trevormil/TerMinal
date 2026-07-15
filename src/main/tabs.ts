import { exec } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { repoRoot } from './widgets'

// ---------------------------------------------------------------------------
// Custom tabs — full-screen repo-specific views, the tab analogue of
// widgets.json. Declarative, no React. A tab is either:
//   • url:     embed a URL / local dev server (e.g. a dashboard on :8787)
//   • command: run a shell command whose stdout is HTML, rendered in a
//              sandboxed iframe and re-polled every intervalMs
// Two sources, same as widgets:
//   • global:  ~/.config/TerMinal/tabs.json
//   • per-repo: <repo-root>/.TerMinal/tabs.json  (loaded from the attached
//              session's cwd)
//
// Security: command tabs run arbitrary shell in the session cwd; url tabs load
// arbitrary pages. Per-repo tabs come from the repo you attach to — same trust
// model as its npm scripts / widgets. Only attach to repos you trust.
// ---------------------------------------------------------------------------

export type CustomTab = {
  id: string
  title: string
  icon?: string
  source: 'global' | 'repo'
  url?: string
  command?: string
  intervalMs?: number
}

const GLOBAL_CFG = join(homedir(), '.config', 'TerMinal', 'tabs.json')

function stableKey(value: string): string {
  let hash = 5381
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash) ^ value.charCodeAt(i)
  return (hash >>> 0).toString(36)
}

function loadFile(path: string, source: 'global' | 'repo', scope = ''): CustomTab[] {
  if (!existsSync(path)) return []
  try {
    const arr = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(arr)) return []
    const prefix = source === 'repo' && scope ? `${source}:${stableKey(scope)}` : source
    return arr
      .filter(
        (t) =>
          t &&
          typeof t.title === 'string' &&
          (typeof t.url === 'string' || typeof t.command === 'string'),
      )
      .map((t, i) => ({
        id: `custom:${prefix}:${t.id || t.title.toLowerCase().replace(/\s+/g, '-')}-${i}`,
        title: String(t.title),
        icon: typeof t.icon === 'string' ? t.icon : undefined,
        source,
        url: typeof t.url === 'string' ? String(t.url) : undefined,
        command: typeof t.command === 'string' ? String(t.command) : undefined,
        intervalMs: Number(t.intervalMs) > 0 ? Number(t.intervalMs) : undefined,
      }))
  } catch {
    return []
  }
}

export function listCustomTabs(cwd: string): CustomTab[] {
  const global = loadFile(GLOBAL_CFG, 'global')
  const root = cwd ? repoRoot(cwd) : ''
  const repo = root ? loadFile(join(root, '.TerMinal', 'tabs.json'), 'repo', root) : []
  return [...global, ...repo]
}

export type TabRunResult = { ok: boolean; html: string; code: number }

// Command tabs render a full page, so allow a larger buffer / longer timeout
// than the small status widgets do.
export function runTabCommand(command: string, cwd: string): Promise<TabRunResult> {
  return new Promise((resolve) => {
    exec(
      command,
      { cwd: cwd || homedir(), timeout: 15000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        resolve({
          ok: !err,
          html: (stdout || '').trim(),
          code: err && typeof (err as any).code === 'number' ? (err as any).code : err ? 1 : 0,
        })
      },
    )
  })
}
