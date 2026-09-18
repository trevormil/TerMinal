import { open, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { relative } from 'node:path'
import { listTrackedFiles } from './files'
import { resolveWithin } from './path-guard'
import { localDefinitions, type FileSymbolSearchResult } from '../shared/local-symbols'

const DEFAULT_LIMITS = {
  files: 500,
  fileBytes: 256_000,
  bytes: 8_000_000,
  hits: 100,
  scanMs: 3_000,
}

export async function searchFileSymbols(
  root: string,
  query: string,
  overrides: Partial<typeof DEFAULT_LIMITS> = {},
): Promise<FileSymbolSearchResult> {
  const result: FileSymbolSearchResult = { hits: [], scanned: 0, skipped: 0, truncated: false }
  if (!root) return { ...result, error: 'Symbol search needs a local checkout.' }
  const name = query.trim()
  if (!/^[A-Za-z_$][\w$]*$/.test(name))
    return { ...result, error: 'Enter a single identifier to search tracked files.' }
  const limits = { ...DEFAULT_LIMITS, ...overrides }
  const paths = await listTrackedFiles(root)
  const deadline = Date.now() + limits.scanMs
  let bytes = 0
  let visited = 0
  const base = await realpath(root).catch(() => '')
  if (!base) return { ...result, error: 'The local checkout is unavailable.' }
  for (const path of paths) {
    if (
      visited >= limits.files ||
      bytes >= limits.bytes ||
      Date.now() >= deadline ||
      result.hits.length >= limits.hits
    ) {
      result.truncated = true
      break
    }
    visited++
    const abs = resolveWithin(base, path)
    if (!abs) {
      result.skipped++
      continue
    }
    let file: Awaited<ReturnType<typeof open>> | undefined
    try {
      const actual = await realpath(abs)
      if (!resolveWithin(base, relative(base, actual))) {
        result.skipped++
        continue
      }
      file = await open(abs, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      const stat = await file.stat()
      if (!stat.isFile()) {
        result.skipped++
        continue
      }
      if (stat.size > limits.fileBytes || bytes + stat.size > limits.bytes) {
        result.skipped++
        result.truncated = true
        continue
      }
      const buffer = Buffer.alloc(Math.min(limits.fileBytes, limits.bytes - bytes) + 1)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      bytes += bytesRead
      if (bytesRead > limits.fileBytes || bytes > limits.bytes) {
        result.skipped++
        result.truncated = true
        continue
      }
      const content = buffer.subarray(0, bytesRead)
      if (content.includes(0)) {
        result.skipped++
        continue
      }
      result.scanned++
      const hits = localDefinitions(content.toString('utf8'), name)
      const remaining = limits.hits - result.hits.length
      result.hits.push(...hits.slice(0, remaining).map((hit) => ({ ...hit, path })))
      if (hits.length > remaining) result.truncated = true
    } catch {
      result.skipped++
    } finally {
      await file?.close()
    }
  }
  return result
}
