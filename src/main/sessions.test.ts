import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getProjectSession, hasSessions, listProjectSessions } from './sessions'

const sessionMd = (id: number, title: string) => `---
id: ${id}
title: "${title}"
status: active
goal: "test"
started: 2026-01-01T00:00:00Z
ended: null
anchor: SES-${String(id).padStart(4, '0')}
tickets: []
branches: []
prs: []
---

# ${title}
`

describe('project sessions layout', () => {
  const roots: string[] = []
  const repo = () => {
    const root = mkdtempSync(join(tmpdir(), 'terminal-sessions-'))
    roots.push(root)
    return root
  }

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  test('reads v2 sessions under .TerMinal/sessions', () => {
    const root = repo()
    const dir = join(root, '.TerMinal', 'sessions', '0004-v2-session')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(root, '.TerMinal', 'template.json'), '{"version":2}\n')
    writeFileSync(join(dir, 'session.md'), sessionMd(4, 'V2 session'))

    expect(hasSessions(root)).toBe(true)
    expect(listProjectSessions(root).map((s) => s.id)).toEqual([4])
    expect(getProjectSession(root, '0004-v2-session')?.title).toBe('V2 session')
  })
})
