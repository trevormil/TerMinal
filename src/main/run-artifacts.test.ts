import { test, expect, describe } from 'bun:test'
import { parseArtifactMeta } from './run-artifacts'

describe('parseArtifactMeta', () => {
  test('maps the artifact.json meta fields', () => {
    const raw = JSON.stringify({
      title: 'Auth flow research',
      agent: 'researcher',
      ok: true,
      createdAt: '2026-07-12T10:00:00Z',
      primaryPath: '/repo/.TerMinal/agent-requests/abc/report.md',
      summary: 'found the bug',
    })
    const a = parseArtifactMeta(raw, 'abc', '/fallback/report.md')
    expect(a).toEqual({
      slug: 'abc',
      title: 'Auth flow research',
      agent: 'researcher',
      ok: true,
      createdAt: '2026-07-12T10:00:00Z',
      reportPath: '/repo/.TerMinal/agent-requests/abc/report.md',
      summary: 'found the bug',
    })
  })
  test('falls back to report path + slug title when fields are missing', () => {
    const a = parseArtifactMeta('{}', 'xyz', '/fallback/report.md')
    expect(a?.title).toBe('xyz')
    expect(a?.reportPath).toBe('/fallback/report.md')
  })
  test('returns null on invalid json', () => {
    expect(parseArtifactMeta('not json', 's', '/r')).toBeNull()
  })
})
