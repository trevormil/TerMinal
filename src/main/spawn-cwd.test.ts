import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { processSpawnCwd } from './spawn-cwd'

describe('processSpawnCwd', () => {
  it('keeps an existing directory', () => {
    const dir = join(tmpdir(), `terminal-cwd-${Date.now()}`)
    mkdirSync(dir)
    try {
      expect(processSpawnCwd(dir)).toBe(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back before process spawn when the cwd is missing', () => {
    const fallback = join(tmpdir(), `terminal-cwd-fallback-${Date.now()}`)
    mkdirSync(fallback)
    try {
      expect(processSpawnCwd(join(fallback, 'missing'), fallback)).toBe(fallback)
    } finally {
      rmSync(fallback, { recursive: true, force: true })
    }
  })
})
