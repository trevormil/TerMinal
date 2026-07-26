import { describe, expect, test } from 'bun:test'
import { langs } from '@uiw/codemirror-extensions-langs'
import { ALL_LANG_KEYS, KNOWN_EXTENSIONS, langKeyFor } from './languages'

describe('langKeyFor', () => {
  test('maps common source extensions', () => {
    expect(langKeyFor('src/main/index.ts')).toBe('ts')
    expect(langKeyFor('App.tsx')).toBe('tsx')
    expect(langKeyFor('main.rs')).toBe('rs')
    expect(langKeyFor('server.go')).toBe('go')
    expect(langKeyFor('script.py')).toBe('python')
  })

  test('covers languages the old 31-entry map missed', () => {
    for (const p of ['a.swift', 'a.kt', 'a.dart', 'a.lua', 'a.r', 'a.scala', 'a.hs', 'a.jl'])
      expect(langKeyFor(p)).not.toBe('')
  })

  test('is case-insensitive', () => {
    expect(langKeyFor('README.MD')).toBe('markdown')
    expect(langKeyFor('Main.JAVA')).toBe('java')
  })

  test('handles extensionless files by name — previously no highlighting at all', () => {
    expect(langKeyFor('Dockerfile')).not.toBe('')
    expect(langKeyFor('Makefile')).not.toBe('')
    expect(langKeyFor('Gemfile')).not.toBe('')
    expect(langKeyFor('deploy/Jenkinsfile')).toBe('groovy')
  })

  test('handles dotfiles', () => {
    expect(langKeyFor('.zshrc')).toBe('sh')
    expect(langKeyFor('.env')).toBe('properties')
    expect(langKeyFor('.editorconfig')).toBe('ini')
  })

  test('a dotfile WITH an extension uses the extension', () => {
    expect(langKeyFor('.eslintrc.json')).toBe('json')
    expect(langKeyFor('.prettierrc.yaml')).toBe('yaml')
  })

  test('unknown things resolve to no grammar rather than a wrong one', () => {
    expect(langKeyFor('mystery.zzz')).toBe('')
    expect(langKeyFor('LICENSE')).toBe('')
    expect(langKeyFor('')).toBe('')
  })
})

describe('mapping integrity — the bug the old map warned about', () => {
  test('EVERY mapped key is a real @uiw/codemirror-extensions-langs export', () => {
    // An invented key silently yields no parser and therefore no highlighting.
    const bogus = ALL_LANG_KEYS.filter((k) => typeof (langs as never)[k] !== 'function')
    expect(bogus).toEqual([])
  })

  test('every mapped extension resolves to a loadable grammar', () => {
    for (const ext of KNOWN_EXTENSIONS) {
      const key = langKeyFor(`file.${ext}`)
      expect(key).not.toBe('')
      expect(typeof (langs as never)[key]).toBe('function')
    }
  })

  test('coverage is meaningfully wider than the 31 extensions it replaced', () => {
    expect(KNOWN_EXTENSIONS.length).toBeGreaterThan(90)
  })
})
