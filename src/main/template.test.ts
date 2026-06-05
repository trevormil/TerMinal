import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pickTemplateSource } from './template'

function tempDir(name: string): string {
  return mkdtempSync(join(tmpdir(), name))
}

function marker(dir: string): void {
  writeFileSync(join(dir, 'bootstrap.sh'), '#!/usr/bin/env bash\n')
}

describe('pickTemplateSource', () => {
  test('uses configured local path before source checkout candidates', () => {
    const configured = tempDir('terminal-template-configured-')
    const source = tempDir('terminal-template-source-')
    try {
      marker(configured)
      marker(source)
      const picked = pickTemplateSource({
        candidates: [{ dir: configured, explicit: true }, { dir: source }],
        marker: 'bootstrap.sh',
        templateRepo: 'https://example.com/template.git',
        cloneToTmp: () => null,
      })
      expect(picked).toMatchObject({ dir: configured })
    } finally {
      rmSync(configured, { recursive: true, force: true })
      rmSync(source, { recursive: true, force: true })
    }
  })

  test('uses source checkout candidate when no configured path is set', () => {
    const source = tempDir('terminal-template-source-')
    try {
      marker(source)
      const picked = pickTemplateSource({
        candidates: [{ dir: '' }, { dir: source }],
        marker: 'bootstrap.sh',
        templateRepo: 'https://example.com/template.git',
        cloneToTmp: () => null,
      })
      expect(picked).toMatchObject({ dir: source })
    } finally {
      rmSync(source, { recursive: true, force: true })
    }
  })

  test('falls back to clone and leaves success cleanup to caller', () => {
    const clone = tempDir('terminal-template-clone-')
    marker(clone)
    let cleanup = false
    const picked = pickTemplateSource({
      candidates: [],
      marker: 'bootstrap.sh',
      templateRepo: 'https://example.com/template.git',
      cloneToTmp: () => ({ dir: clone, cleanup: () => { cleanup = true } }),
    })
    expect(picked).toMatchObject({ dir: clone })
    expect(cleanup).toBe(false)
    if (!('error' in picked)) picked.cleanup?.()
    expect(cleanup).toBe(true)
    rmSync(clone, { recursive: true, force: true })
  })

  test('cleans up clone that is missing the marker', () => {
    const clone = tempDir('terminal-template-missing-')
    let cleanup = false
    const picked = pickTemplateSource({
      candidates: [],
      marker: 'bootstrap.sh',
      templateRepo: 'https://example.com/template.git',
      cloneToTmp: () => ({ dir: clone, cleanup: () => { cleanup = true } }),
    })
    expect('error' in picked ? picked.error : '').toContain('missing bootstrap.sh')
    expect(cleanup).toBe(true)
    rmSync(clone, { recursive: true, force: true })
  })

  test('reports clone failure and suspicious repo strings', () => {
    const failed = pickTemplateSource({
      candidates: [],
      marker: 'bootstrap.sh',
      templateRepo: 'https://example.com/template.git',
      cloneToTmp: () => null,
    })
    expect('error' in failed ? failed.error : '').toContain("couldn't fetch template")

    const suspicious = pickTemplateSource({
      candidates: [],
      marker: 'bootstrap.sh',
      templateRepo: '--upload-pack=sh',
      cloneToTmp: () => {
        throw new Error('should not clone suspicious repo')
      },
    })
    expect('error' in suspicious ? suspicious.error : '').toContain('invalid template repo')
  })

  test('explicit local path missing marker errors before clone', () => {
    const configured = tempDir('terminal-template-bad-config-')
    try {
      const picked = pickTemplateSource({
        candidates: [{ dir: configured, explicit: true }],
        marker: 'bootstrap.sh',
        templateRepo: 'https://example.com/template.git',
        cloneToTmp: () => {
          throw new Error('should not clone')
        },
      })
      expect('error' in picked ? picked.error : '').toContain('configured template path is missing bootstrap.sh')
    } finally {
      rmSync(configured, { recursive: true, force: true })
    }
  })
})
