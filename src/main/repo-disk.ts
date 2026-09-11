import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

type DiskUsage = { bytes?: number; error?: string }
let cached: { path: string; at: number; result: Promise<DiskUsage> } | undefined

export function readRepoDisk(path: string): Promise<DiskUsage> {
  if (!path || !isAbsolute(path))
    return Promise.resolve({ error: 'Open a local repo to measure disk usage.' })
  if (cached?.path === path && Date.now() - cached.at < 60000) return cached.result
  const result = measure(path)
  cached = { path, at: Date.now(), result }
  return result
}

async function measure(path: string): Promise<DiskUsage> {
  try {
    if (!(await stat(path)).isDirectory()) return { error: 'Repo path is not a directory.' }
    return await new Promise<DiskUsage>((resolve) => {
      execFile(
        '/usr/bin/du',
        ['-sk', path],
        { timeout: 5000, maxBuffer: 65536 },
        (error, stdout) => {
          const kib = Number(stdout.trim().split(/\s+/)[0])
          resolve(
            error || !Number.isFinite(kib) || kib < 0
              ? {
                  error:
                    'Could not measure repo disk usage (unavailable, unreadable, or timed out).',
                }
              : { bytes: kib * 1024 },
          )
        },
      )
    })
  } catch {
    return { error: 'Repo path is unavailable.' }
  }
}
