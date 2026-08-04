import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Guards the tm plugin (plugin/) — the globally-installed replacement for
// per-repo bootstrapped skills. Catches malformed skills, stale per-repo
// path references, and broken hook wiring before they ship to every repo.

const ROOT = join(import.meta.dir, '..', 'plugin')
const skillDirs = readdirSync(join(ROOT, 'skills')).filter((d) =>
  statSync(join(ROOT, 'skills', d)).isDirectory()
)

function* walkFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) yield* walkFiles(p)
    else yield p
  }
}

describe('plugin manifest', () => {
  test('plugin.json parses and is named tm', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))
    expect(manifest.name).toBe('tm')
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(manifest.description.length).toBeGreaterThan(0)
  })
})

describe('skills', () => {
  test('at least the core workflow skills are present', () => {
    for (const s of ['ticket', 'session-start', 'session-end', 'pr-creation', 'code-review', 'factory', 'vibe'])
      expect(skillDirs).toContain(s)
  })

  test('personal skills are excluded', () => {
    expect(skillDirs).not.toContain('notify')
  })

  for (const dir of skillDirs) {
    test(`${dir}: SKILL.md frontmatter name matches directory`, () => {
      const md = readFileSync(join(ROOT, 'skills', dir, 'SKILL.md'), 'utf8')
      const fm = md.match(/^---\n([\s\S]*?)\n---/)
      expect(fm).not.toBeNull()
      const name = fm![1].match(/^name:\s*(\S+)\s*$/m)
      expect(name?.[1]).toBe(dir)
      expect(fm![1]).toMatch(/^description:/m)
    })
  }
})

describe('no stale per-repo machinery paths', () => {
  // .claude/forge is per-repo *config* (forge selector) and stays; everything
  // else under .claude/ was machinery that now lives in the plugin itself.
  const stale = /\.claude\/(bin|skills|hooks)\//

  for (const file of [...walkFiles(join(ROOT, 'skills')), ...walkFiles(join(ROOT, 'bin')), ...walkFiles(join(ROOT, 'hooks'))]) {
    test(file.slice(ROOT.length + 1), () => {
      const body = readFileSync(file, 'utf8')
      const hits = body.split('\n').filter((l) => stale.test(l))
      expect(hits).toEqual([])
      expect(body).not.toContain('autopilot-harness')
    })
  }
})

describe('hooks', () => {
  test('hooks.json parses and every referenced script exists and is executable', () => {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8'))
    const commands: string[] = []
    for (const matchers of Object.values(cfg.hooks) as any[])
      for (const m of matchers) for (const h of m.hooks) commands.push(h.command)
    expect(commands.length).toBeGreaterThanOrEqual(3)
    for (const cmd of commands) {
      expect(cmd.startsWith('${CLAUDE_PLUGIN_ROOT}/')) .toBe(true)
      const rel = cmd.replace('${CLAUDE_PLUGIN_ROOT}/', '')
      const p = join(ROOT, rel)
      expect(existsSync(p)).toBe(true)
      expect(statSync(p).mode & 0o111).toBeGreaterThan(0)
    }
  })
})

describe('bin', () => {
  test('every bin script is executable', () => {
    for (const f of readdirSync(join(ROOT, 'bin'))) {
      expect(statSync(join(ROOT, 'bin', f)).mode & 0o111).toBeGreaterThan(0)
    }
  })
})
