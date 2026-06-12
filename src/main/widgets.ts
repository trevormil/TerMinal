import { exec } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

// ---------------------------------------------------------------------------
// Command widgets — the extensibility standard.
//
// A command widget is declarative: "run this command every N ms, render its
// stdout." No React required. Two sources:
//   • global:  ~/.config/TerMinal/widgets.json
//   • per-repo: <repo-root>/.TerMinal/widgets.json   (loaded when the
//              attached session's cwd is inside that repo)
//
// Security: these run arbitrary shell in the session cwd. Per-repo widgets come
// from the repo you attach to — only attach to repos you trust (same trust model
// as running their npm scripts).
// ---------------------------------------------------------------------------

export type CommandWidget = {
  id: string
  title: string
  icon?: string
  command: string
  intervalMs: number
  mode: 'text' | 'big' | 'kv'
  source: 'global' | 'repo'
}

const GLOBAL_CFG = join(homedir(), '.config', 'TerMinal', 'widgets.json')

function stableKey(value: string): string {
  let hash = 5381
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash) ^ value.charCodeAt(i)
  return (hash >>> 0).toString(36)
}

function loadFile(path: string, source: 'global' | 'repo', scope = ''): CommandWidget[] {
  if (!existsSync(path)) return []
  try {
    const arr = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(arr)) return []
    const prefix = source === 'repo' && scope ? `${source}:${stableKey(scope)}` : source
    return arr
      .filter((w) => w && typeof w.command === 'string' && typeof w.title === 'string')
      .map((w, i) => ({
        id: `${prefix}:${w.id || w.title.toLowerCase().replace(/\s+/g, '-')}-${i}`,
        title: String(w.title),
        icon: typeof w.icon === 'string' ? w.icon : '▸',
        command: String(w.command),
        intervalMs: Number(w.intervalMs) > 0 ? Number(w.intervalMs) : 5000,
        mode: ['text', 'big', 'kv'].includes(w.mode) ? w.mode : 'text',
        source,
      }))
  } catch {
    return []
  }
}

/** Walk up from cwd to the repo root (dir containing .git), else cwd. */
function repoRoot(cwd: string): string {
  let dir = cwd
  for (let i = 0; i < 30 && dir && dir !== '/'; i++) {
    if (existsSync(join(dir, '.git'))) return dir
    dir = dirname(dir)
  }
  return cwd
}

export function listCommandWidgets(cwd: string): CommandWidget[] {
  const global = loadFile(GLOBAL_CFG, 'global')
  const root = cwd ? repoRoot(cwd) : ''
  const repo = root ? loadFile(join(root, '.TerMinal', 'widgets.json'), 'repo', root) : []
  return [...global, ...repo]
}

export type CommandResult = { ok: boolean; stdout: string; code: number }

export function runCommand(command: string, cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    exec(
      command,
      { cwd: cwd || homedir(), timeout: 6000, maxBuffer: 256 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        resolve({
          ok: !err,
          stdout: (stdout || '').trim(),
          code: err && typeof (err as any).code === 'number' ? (err as any).code : err ? 1 : 0,
        })
      },
    )
  })
}
