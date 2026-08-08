import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Guards the tm plugin (plugin/) — the globally-installed replacement for
// per-repo bootstrapped skills. Catches malformed skills, stale per-repo
// path references, and broken hook wiring before they ship to every repo.

const ROOT = join(import.meta.dir, '..', 'plugin')
const skillDirs = readdirSync(join(ROOT, 'skills')).filter((d) =>
  statSync(join(ROOT, 'skills', d)).isDirectory(),
)

function* walkFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) yield* walkFiles(p)
    else yield p
  }
}

// Double-path bugs from mechanical rewrites: one absolute root pasted onto
// another. Each alternative is a bug shape actually seen in this migration:
//   $(git rev-parse --show-toplevel)/${CLAUDE_PLUGIN_ROOT}/... or .../$HOME/...
//   ~/$HOME/...
//   $HOME/$HOME/... or $HOME/${CLAUDE_PLUGIN_ROOT}/...
//   ${CLAUDE_PLUGIN_ROOT}/$HOME/... or ${CLAUDE_PLUGIN_ROOT}/${CLAUDE_PLUGIN_ROOT}/...
// It must match a second ROOT specifically — `$HOME/${some_var}` is ordinary
// shell expansion, not a bug, and matching it would flag correct code.
const ROOT_VAR = String.raw`\$\{?(?:HOME|CLAUDE_PLUGIN_ROOT)`
const DOUBLED_PATH = new RegExp(
  [
    String.raw`show-toplevel\)"?\/+"?${ROOT_VAR}`,
    String.raw`~\/\$HOME`,
    String.raw`\$HOME\/${ROOT_VAR}`,
    String.raw`\$\{CLAUDE_PLUGIN_ROOT\}\/${ROOT_VAR}`,
  ].join('|'),
)

describe('the double-path guard itself', () => {
  // A guard that silently stops matching is worse than no guard, and one that
  // over-matches blocks correct code (this regex once flagged the legitimate
  // `$HOME/${entry#~/}` expansion in the merge-gate hook).
  test.each([
    'id=$("$(git rev-parse --show-toplevel)/${CLAUDE_PLUGIN_ROOT}/skills/ticket/bin/next-ticket-id")',
    'forge="$("$(git rev-parse --show-toplevel)/$HOME/.config/TerMinal/plugin/bin/forge")"',
    '- `~/$HOME/.config/TerMinal/plugin/bin/telegram-notify.sh` — send a message',
    'x="$HOME/$HOME/nope"',
    'y="${CLAUDE_PLUGIN_ROOT}/$HOME/nope"',
  ])('flags the real bug shape: %s', (line) => {
    expect(DOUBLED_PATH.test(line)).toBe(true)
  })

  test.each([
    'entry="$HOME/${entry#\\~/}"',
    'ALLOWLIST="$HOME/.config/TerMinal/allow-direct-main"',
    'SKILL="${CLAUDE_PLUGIN_ROOT}/skills/ticket"',
    'id=$("${CLAUDE_PLUGIN_ROOT}/skills/ticket/bin/next-ticket-id")',
    'root=$(git rev-parse --show-toplevel)',
  ])('leaves correct code alone: %s', (line) => {
    expect(DOUBLED_PATH.test(line)).toBe(false)
  })
})

describe('plugin manifest', () => {
  test('plugin.json parses and is named tm', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))
    expect(manifest.name).toBe('tm')
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(manifest.description.length).toBeGreaterThan(0)
  })

  test('marketplace.json stays in version lockstep with plugin.json', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))
    const marketplace = JSON.parse(
      readFileSync(join(ROOT, '..', '.claude-plugin', 'marketplace.json'), 'utf8'),
    )
    const entry = marketplace.plugins.find((p: { name: string }) => p.name === 'tm')
    expect(entry.version).toBe(manifest.version)
    expect(entry.source).toBe('./plugin')
  })
})

describe('skills', () => {
  test('at least the core workflow skills are present', () => {
    for (const s of [
      'ticket',
      'session-start',
      'session-end',
      'pr-creation',
      'code-review',
      'factory',
      'vibe',
    ])
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
  const stale = /\.claude\/(bin|skills|hooks)[/\s`]/

  for (const file of [
    ...walkFiles(join(ROOT, 'skills')),
    ...walkFiles(join(ROOT, 'bin')),
    ...walkFiles(join(ROOT, 'hooks')),
  ]) {
    test(file.slice(ROOT.length + 1), () => {
      const body = readFileSync(file, 'utf8')
      const hits = body.split('\n').filter((l) => stale.test(l) || DOUBLED_PATH.test(l))
      expect(hits).toEqual([])
    })
  }
})

describe('no private machine references', () => {
  // Public plugin content must not name the local-only harness repo (its
  // exemption lives in the machine-local allow-direct-main file instead).
  for (const dir of ['skills', 'bin', 'hooks']) {
    test(dir, () => {
      for (const file of walkFiles(join(ROOT, dir)))
        expect(readFileSync(file, 'utf8')).not.toContain('autopilot-harness')
    })
  }
})

describe('template agent specs have no double-path bugs', () => {
  const TEMPLATE = join(import.meta.dir, '..', 'templates', 'project-template')

  // `.codex/skills` used to be checked here too. The mirror is retired: Codex
  // now loads the same skills globally from ~/.codex/skills/tm-*, synced from
  // this plugin, so `plugin/skills` above is the only copy left to guard.
  test('.agents', () => {
    const hits: string[] = []
    for (const file of walkFiles(join(TEMPLATE, '.agents'))) {
      for (const l of readFileSync(file, 'utf8').split('\n'))
        if (DOUBLED_PATH.test(l)) hits.push(`${file.slice(TEMPLATE.length + 1)}: ${l.trim()}`)
    }
    expect(hits).toEqual([])
  })
})

describe('merge gate keeps the FORCE override', () => {
  test('block-main-merge.sh implements TERMINAL_FORCE_MAIN (env + inline)', () => {
    const hook = readFileSync(join(ROOT, 'hooks', 'block-main-merge.sh'), 'utf8')
    expect(hook).toContain('"${TERMINAL_FORCE_MAIN:-}" = "1"')
    expect(hook).toContain('TERMINAL_FORCE_MAIN=1([[:space:]])')
  })
})

describe('hooks', () => {
  test('hooks.json parses and every referenced script exists and is executable', () => {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8'))
    const commands: string[] = []
    for (const matchers of Object.values(cfg.hooks) as any[])
      for (const m of matchers) for (const h of m.hooks) commands.push(h.command)
    expect(commands.length).toBeGreaterThanOrEqual(3)
    for (const cmd of commands) {
      expect(cmd).toStartWith('${CLAUDE_PLUGIN_ROOT}/')
      const rel = cmd.replace('${CLAUDE_PLUGIN_ROOT}/', '')
      const p = join(ROOT, rel)
      expect(existsSync(p)).toBe(true)
      expect(statSync(p).mode & 0o111).toBeGreaterThan(0)
    }
  })
})

describe('bin', () => {
  // Scripts here are invoked by name and carry no extension; a `.mjs` file is
  // a module the scripts import, so it is deliberately not executable.
  const scripts = () => readdirSync(join(ROOT, 'bin')).filter((f) => !f.includes('.'))

  test('every bin script is executable', () => {
    const notExecutable = scripts().filter(
      (f) => (statSync(join(ROOT, 'bin', f)).mode & 0o111) === 0,
    )
    expect(notExecutable).toEqual([])
  })

  test('the scan covers the real scripts (a guard matching nothing is not a guard)', () => {
    expect(scripts()).toContain('tm-state-dir')
    expect(scripts()).toContain('tm-state-dirs')
    expect(scripts().length).toBeGreaterThan(8)
  })
})

// The plugin is installed at ~/.config/TerMinal/plugin, so a relative link that
// climbs out of it resolves somewhere in the user's config dir — not, as these
// were written to when the skills lived at <repo>/.claude/skills/<name>/, the
// target repo. Six skills pointed at `../../../.agents/...` and
// `../../../docs/...` and would have sent the model to a path that cannot
// exist. Files in the TARGET repo must be named as plain repo-relative paths,
// which the model resolves against its working directory.
describe('plugin content never links outside the plugin', () => {
  for (const dir of ['skills', 'bin', 'hooks']) {
    test(dir, () => {
      const offenders: string[] = []
      for (const file of walkFiles(join(ROOT, dir))) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            // A markdown link climbing above the plugin root. Skill dirs are
            // one level deep, so `../..` already reaches it and anything more
            // escapes. Shell `$(dirname $0)/../../../bin/...` is a different
            // shape (not a markdown link) and stays inside by construction.
            if (/\]\(\.\.\/\.\.\/\.\.\//.test(line))
              offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}`)
          })
      }
      expect(offenders).toEqual([])
    })
  }

  test('the guard matches the shape it is meant to catch', () => {
    const bad = '[`.agents/code-review.md`](../../../.agents/code-review.md).'
    expect(/\]\(\.\.\/\.\.\/\.\.\//.test(bad)).toBe(true)
    // A link WITHIN the plugin is fine.
    expect(/\]\(\.\.\/\.\.\/\.\.\//.test('[state](../state.md)')).toBe(false)
    // The shell idiom that legitimately reaches plugin/bin is untouched.
    expect(/\]\(\.\.\/\.\.\/\.\.\//.test('"$(dirname "$0")/../../../bin/tm-state-dir"')).toBe(false)
  })
})
