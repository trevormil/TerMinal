import { test, expect, describe, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { watchRoot, unwatchRoot } from './files-watch'

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

describe('files-watch', () => {
  const roots: string[] = []
  const mkroot = () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'terminal-watch-')))
    roots.push(root)
    return root
  }
  afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
  })

  test('debounces rapid writes to the same file into one change event', async () => {
    const root = mkroot()
    const events: { root: string; paths: string[] }[] = []
    watchRoot(root, (r, paths) => events.push({ root: r, paths }))
    writeFileSync(join(root, 'a.txt'), '1')
    await sleep(50)
    writeFileSync(join(root, 'a.txt'), '2') // still inside the debounce window
    await sleep(1200)
    // fs.watch's OS-level event delivery isn't perfectly deterministic under
    // parallel test load, so assert on what's ours to control — the debounce
    // coalesces into exactly one batched event, not one per write.
    expect(events.length).toBe(1)
    expect(events[0].paths).toContain('a.txt')
    unwatchRoot(root)
  })

  test('ignores changes under .git', async () => {
    const root = mkroot()
    const events: { root: string; paths: string[] }[] = []
    watchRoot(root, (r, paths) => events.push({ root: r, paths }))
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main')
    await sleep(1200)
    expect(events.length).toBe(0)
    unwatchRoot(root)
  })

  test('is ref-counted — a second watchRoot on the same root needs two unwatches to stop', async () => {
    const root = mkroot()
    let calls = 0
    watchRoot(root, () => calls++)
    watchRoot(root, () => calls++) // same root, second subscriber
    unwatchRoot(root) // one ref remains — should still fire
    writeFileSync(join(root, 'a.txt'), '1')
    await sleep(1200)
    expect(calls).toBeGreaterThan(0)
    unwatchRoot(root) // last ref — watcher actually closes now
  })
})
