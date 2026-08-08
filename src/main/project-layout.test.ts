import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectProjectLayout } from './project-layout'

const repo = () => mkdtempSync(join(tmpdir(), 'layout-'))

describe('detectProjectLayout', () => {
  test('a clean repo is v2 — no marker required', () => {
    // The template ships no .TerMinal at all; a fresh scaffold and a
    // collaborator's clone of a fully-migrated repo must both read v2.
    expect(detectProjectLayout(repo())).toBe('v2')
  })

  test('the legacy marker still forces v2', () => {
    const r = repo()
    mkdirSync(join(r, '.TerMinal'), { recursive: true })
    writeFileSync(join(r, '.TerMinal', 'template.json'), '{"version":2}')
    expect(detectProjectLayout(r)).toBe('v2')
  })

  test('root-level v1 state dirs are the only thing that reads v1', () => {
    const r = repo()
    mkdirSync(join(r, 'backlog'), { recursive: true })
    expect(detectProjectLayout(r)).toBe('v1')
  })

  test('v2 state dirs win over v1 leftovers', () => {
    const r = repo()
    mkdirSync(join(r, '.TerMinal', 'backlog'), { recursive: true })
    mkdirSync(join(r, 'backlog'), { recursive: true })
    expect(detectProjectLayout(r)).toBe('v2')
  })
})
