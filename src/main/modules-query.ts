// Admin monitoring data adapter — "fetch it however." Runs a module's DataSource
// (local file / CLI shell-out / HTTP endpoint / remote DB) and returns rows or text
// for the Admin panel widgets. DB creds resolve from .TerMinal/admin.local.json.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { DataSource } from './modules'

export type QueryResult = { rows?: unknown[]; text?: string; error?: string }

export async function runModuleQuery(repoRoot: string, source: DataSource): Promise<QueryResult> {
  try {
    if (source.kind === 'file') {
      const p = join(repoRoot, source.path)
      if (!existsSync(p)) return { rows: [] }
      const lines = readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean)
      return {
        rows: lines.map((l) => {
          try {
            return JSON.parse(l)
          } catch {
            return { line: l }
          }
        }),
      }
    }
    if (source.kind === 'cli') {
      const r = spawnSync('bash', ['-lc', source.cmd], { cwd: repoRoot, encoding: 'utf-8', timeout: 15000 })
      return { text: (r.stdout || r.stderr || '').slice(0, 20000) }
    }
    if (source.kind === 'http') {
      const res = await fetch(source.url, { signal: AbortSignal.timeout(8000) })
      const text = await res.text()
      try {
        return { rows: [JSON.parse(text)] }
      } catch {
        return { text: text.slice(0, 20000) }
      }
    }
    if (source.kind === 'db') {
      // Phase 2P: resolve conn from .TerMinal/admin.local.json and run a read-only query.
      return { error: 'db adapter not configured yet (Phase 2P)' }
    }
    return { error: 'unknown data source' }
  } catch (e) {
    return { error: (e as Error).message }
  }
}
