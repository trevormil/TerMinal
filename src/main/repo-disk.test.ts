import { expect, test } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRepoDisk } from './repo-disk'
test('measures a local directory and reports missing paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'terminal-disk-'))
  try {
    await writeFile(join(dir, 'file'), 'x'.repeat(8192))
    const result = await readRepoDisk(dir)
    expect(result.bytes).toBeGreaterThanOrEqual(8192)
    expect((await readRepoDisk(join(dir, 'missing'))).error).toBeTruthy()
    expect((await readRepoDisk('')).error).toBeTruthy()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
