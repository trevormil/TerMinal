import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listCommandWidgets } from './widgets'

function repoWithWidget(title: string) {
  const repo = mkdtempSync(join(tmpdir(), 'terminal-widget-repo-'))
  mkdirSync(join(repo, '.git'), { recursive: true })
  mkdirSync(join(repo, '.TerMinal'), { recursive: true })
  writeFileSync(
    join(repo, '.TerMinal', 'widgets.json'),
    JSON.stringify([{ title, command: 'printf ok', intervalMs: 5000, mode: 'text' }]),
  )
  return repo
}

describe('listCommandWidgets', () => {
  test('repo widget ids are scoped by repo root', () => {
    const a = repoWithWidget('Build')
    const b = repoWithWidget('Build')

    const [wa] = listCommandWidgets(a).filter((w) => w.source === 'repo')
    const [wb] = listCommandWidgets(b).filter((w) => w.source === 'repo')

    expect(wa.title).toBe('Build')
    expect(wb.title).toBe('Build')
    expect(wa.id).not.toBe(wb.id)
  })
})
