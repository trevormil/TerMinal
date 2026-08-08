import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  legacyPluginCopies,
  legacySeedCandidates,
  sweepLegacyPluginCopies,
  sweepLegacySeeds,
} from './legacy-sweep'

// A fake installed plugin: the sweep derives what it owns from THIS tree, so
// the test never depends on the developer's real ~/.config/TerMinal.
function makePlugin(): string {
  const plugin = mkdtempSync(join(tmpdir(), 'tm-plugin-'))
  for (const s of ['ticket', 'session-start'])
    mkdirSync(join(plugin, 'skills', s), { recursive: true })
  mkdirSync(join(plugin, 'bin'), { recursive: true })
  writeFileSync(join(plugin, 'bin', 'activity'), '#!/bin/sh\n')
  mkdirSync(join(plugin, 'hooks'), { recursive: true })
  writeFileSync(join(plugin, 'hooks', 'block-main-merge.sh'), '#!/bin/sh\n')
  return plugin
}

function makeRepo(): string {
  return mkdtempSync(join(tmpdir(), 'tm-repo-'))
}

describe('legacyPluginCopies', () => {
  test('finds only plugin-served copies, never repo-authored names', () => {
    const plugin = makePlugin()
    const repo = makeRepo()
    mkdirSync(join(repo, '.claude', 'skills', 'ticket'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'skills', 'ticket', 'SKILL.md'), 'old copy')
    // A repo-authored skill whose name the plugin does NOT own must survive.
    mkdirSync(join(repo, '.claude', 'skills', 'my-own-thing'), { recursive: true })
    mkdirSync(join(repo, '.codex', 'skills', 'session-start'), { recursive: true })
    mkdirSync(join(repo, '.claude', 'bin'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'bin', 'activity'), 'old')
    mkdirSync(join(repo, '.claude', 'hooks'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'hooks', 'block-main-merge.sh'), 'old')

    const rels = legacyPluginCopies(repo, plugin)
    expect(rels.sort()).toEqual([
      '.claude/bin/activity',
      '.claude/hooks/block-main-merge.sh',
      '.claude/skills/ticket',
      '.codex/skills/session-start',
    ])
  })

  test('keeps hooks that .claude/settings.json still wires', () => {
    // TerMinal's own repo (and any repo whose settings.json wires the hooks
    // by project path) deliberately carries hook copies — banking them leaves
    // every tool call pointing at a dead path and turns the merge gate off.
    const plugin = makePlugin()
    const repo = makeRepo()
    mkdirSync(join(repo, '.claude', 'hooks'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'hooks', 'block-main-merge.sh'), 'hook')
    writeFileSync(
      join(repo, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [{ command: '$CLAUDE_PROJECT_DIR/.claude/hooks/block-main-merge.sh' }],
            },
          ],
        },
      }),
    )
    expect(legacyPluginCopies(repo, plugin)).toEqual([])
    // Unwire it and the copy becomes sweepable again.
    writeFileSync(join(repo, '.claude', 'settings.json'), '{}')
    expect(legacyPluginCopies(repo, plugin)).toEqual(['.claude/hooks/block-main-merge.sh'])
  })

  test('hooks wired only in settings.local.json are kept too', () => {
    const plugin = makePlugin()
    const repo = makeRepo()
    mkdirSync(join(repo, '.claude', 'hooks'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'hooks', 'block-main-merge.sh'), 'hook')
    writeFileSync(
      join(repo, '.claude', 'settings.local.json'),
      '{"hooks":{"PreToolUse":[{"hooks":[{"command":".claude/hooks/block-main-merge.sh"}]}]}}',
    )
    expect(legacyPluginCopies(repo, plugin)).toEqual([])
  })

  test('empty for a clean repo and for a missing plugin dir', () => {
    const plugin = makePlugin()
    const repo = makeRepo()
    expect(legacyPluginCopies(repo, plugin)).toEqual([])
    expect(legacyPluginCopies(repo, join(plugin, 'nope'))).toEqual([])
    expect(legacyPluginCopies('', plugin)).toEqual([])
  })
})

describe('sweepLegacyPluginCopies', () => {
  test('moves copies to .claude/pre-tm-backup and empties the dirs', () => {
    const plugin = makePlugin()
    const repo = makeRepo()
    mkdirSync(join(repo, '.claude', 'skills', 'ticket'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'skills', 'ticket', 'SKILL.md'), 'old copy')
    mkdirSync(join(repo, '.claude', 'bin'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'bin', 'activity'), 'old')

    const r = sweepLegacyPluginCopies(repo, plugin)
    expect(r.moved).toBe(2)
    expect(existsSync(join(repo, '.claude', 'skills', 'ticket'))).toBe(false)
    expect(existsSync(join(repo, '.claude', 'bin', 'activity'))).toBe(false)
    expect(
      readFileSync(
        join(repo, '.claude', 'pre-tm-backup', '.claude', 'skills', 'ticket', 'SKILL.md'),
        'utf8',
      ),
    ).toBe('old copy')
    // Emptied parents are pruned so the repo doesn't keep husk dirs.
    expect(existsSync(join(repo, '.claude', 'skills'))).toBe(false)
    expect(existsSync(join(repo, '.claude', 'bin'))).toBe(false)
  })

  test('never clobbers an earlier backup — banks under a numbered name', () => {
    const plugin = makePlugin()
    const repo = makeRepo()
    // Run 1 banked a customized copy…
    mkdirSync(join(repo, '.claude', 'pre-tm-backup', '.claude', 'skills', 'ticket'), {
      recursive: true,
    })
    writeFileSync(
      join(repo, '.claude', 'pre-tm-backup', '.claude', 'skills', 'ticket', 'SKILL.md'),
      'customized',
    )
    // …and git restored a vanilla copy that run 2 now sweeps.
    mkdirSync(join(repo, '.claude', 'skills', 'ticket'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'skills', 'ticket', 'SKILL.md'), 'vanilla')

    const r = sweepLegacyPluginCopies(repo, plugin)
    expect(r.moved).toBe(1)
    expect(
      readFileSync(
        join(repo, '.claude', 'pre-tm-backup', '.claude', 'skills', 'ticket', 'SKILL.md'),
        'utf8',
      ),
    ).toBe('customized')
    expect(
      readFileSync(
        join(repo, '.claude', 'pre-tm-backup', '.claude', 'skills', 'ticket.1', 'SKILL.md'),
        'utf8',
      ),
    ).toBe('vanilla')
  })

  test('idempotent: second run is a no-op', () => {
    const plugin = makePlugin()
    const repo = makeRepo()
    mkdirSync(join(repo, '.claude', 'skills', 'ticket'), { recursive: true })
    sweepLegacyPluginCopies(repo, plugin)
    expect(sweepLegacyPluginCopies(repo, plugin).moved).toBe(0)
  })
})

describe('sweepLegacySeeds', () => {
  test('banks retired seed artifacts and unmodified default script agents', () => {
    const plugin = makePlugin()
    mkdirSync(join(plugin, 'scripts'), { recursive: true })
    writeFileSync(join(plugin, 'scripts', 'health.sh'), '#!/bin/sh\ndefault\n')
    const repo = makeRepo()
    mkdirSync(join(repo, '.codex', 'hooks'), { recursive: true })
    writeFileSync(join(repo, '.codex', 'hooks', 'stop-notify.sh'), 'hook')
    writeFileSync(join(repo, '.codex', 'hooks.workflow.json'), '{}')
    mkdirSync(join(repo, '.claude'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'settings.workflow.json'), '{}')
    mkdirSync(join(repo, '.TerMinal'), { recursive: true })
    writeFileSync(join(repo, '.TerMinal', 'template.json'), '{"version":2}')
    mkdirSync(join(repo, '.agents'), { recursive: true })
    writeFileSync(join(repo, '.agents', 'health.sh'), '#!/bin/sh\ndefault\n')
    // Customized body — a repo-specific agent, must survive.
    writeFileSync(join(repo, '.agents', 'custom.sh'), '#!/bin/sh\nmine\n')

    const r = sweepLegacySeeds(repo, plugin)
    expect(r.moved).toBe(5)
    expect(existsSync(join(repo, '.codex'))).toBe(false)
    expect(existsSync(join(repo, '.claude', 'settings.workflow.json'))).toBe(false)
    expect(existsSync(join(repo, '.TerMinal'))).toBe(false)
    expect(existsSync(join(repo, '.agents', 'health.sh'))).toBe(false)
    expect(existsSync(join(repo, '.agents', 'custom.sh'))).toBe(true)
    // Everything recoverable from the backup.
    expect(existsSync(join(repo, '.claude', 'pre-tm-backup', '.TerMinal', 'template.json'))).toBe(
      true,
    )
    expect(existsSync(join(repo, '.claude', 'pre-tm-backup', '.agents', 'health.sh'))).toBe(true)
  })

  test('leaves live codex hooks config and repo-owned .TerMinal config alone', () => {
    const plugin = makePlugin()
    const repo = makeRepo()
    mkdirSync(join(repo, '.codex'), { recursive: true })
    writeFileSync(join(repo, '.codex', 'hooks.json'), '{"live":true}')
    mkdirSync(join(repo, '.TerMinal'), { recursive: true })
    writeFileSync(join(repo, '.TerMinal', 'widgets.json'), '[]')
    writeFileSync(join(repo, '.TerMinal', 'template.json'), '{}')

    const r = sweepLegacySeeds(repo, plugin)
    expect(r.moved).toBe(1)
    expect(readFileSync(join(repo, '.codex', 'hooks.json'), 'utf8')).toContain('live')
    // widgets.json is a repo-provided surface a project ships on purpose.
    expect(existsSync(join(repo, '.TerMinal', 'widgets.json'))).toBe(true)
    expect(existsSync(join(repo, '.TerMinal', 'template.json'))).toBe(false)
  })

  test('a codex stop hook still wired by the live hooks.json is kept', () => {
    // The old template's hooks.json points at $PWD/.codex/hooks/stop-notify.sh.
    // Users who merged it have LIVE wiring — banking the script silently kills
    // their completion→Inbox channel (same bug class as the settings.json
    // hooks fix). It becomes sweepable once the hooks.json entry is gone.
    const plugin = makePlugin()
    const repo = makeRepo()
    mkdirSync(join(repo, '.codex', 'hooks'), { recursive: true })
    writeFileSync(join(repo, '.codex', 'hooks', 'stop-notify.sh'), 'hook')
    writeFileSync(
      join(repo, '.codex', 'hooks.json'),
      '{"hooks":{"Stop":[{"hooks":[{"command":"bash -lc \'p=\\"$PWD/.codex/hooks/stop-notify.sh\\"; [ -x \\"$p\\" ] && \\"$p\\" || true\'"}]}]}}',
    )
    expect(sweepLegacySeeds(repo, plugin).moved).toBe(0)
    expect(existsSync(join(repo, '.codex', 'hooks', 'stop-notify.sh'))).toBe(true)
  })

  test('a .claude/forge that is not a regular file is neither counted nor swept', () => {
    const plugin = makePlugin()
    const repo = makeRepo()
    mkdirSync(join(repo, '.claude', 'forge'), { recursive: true })
    expect(legacySeedCandidates(repo, plugin)).toEqual([])
    expect(sweepLegacySeeds(repo, plugin).moved).toBe(0)
  })

  test('banks a vanilla owned.yml, keeps a customized one', () => {
    const plugin = makePlugin()
    const repo = makeRepo()
    const vanilla = 'agents:\n  changelog: docs/CHANGELOG.md\n'
    const sha = createHash('sha256').update(vanilla).digest('hex')
    mkdirSync(join(repo, '.agents'), { recursive: true })
    writeFileSync(join(repo, '.agents', 'owned.yml'), vanilla)

    const r = sweepLegacySeeds(repo, plugin, undefined, new Set([sha]))
    expect(r.backedUp).toEqual(['.agents/owned.yml'])
    expect(existsSync(join(repo, '.agents'))).toBe(false)

    // A customized registry is the repo's own decision.
    mkdirSync(join(repo, '.agents'), { recursive: true })
    writeFileSync(join(repo, '.agents', 'owned.yml'), vanilla + '  extra: apps/web\n')
    expect(sweepLegacySeeds(repo, plugin, undefined, new Set([sha])).moved).toBe(0)
    expect(existsSync(join(repo, '.agents', 'owned.yml'))).toBe(true)
  })

  test('moves .claude/forge into the sidecar override', () => {
    const plugin = makePlugin()
    const repo = makeRepo()
    const sidecar = mkdtempSync(join(tmpdir(), 'tm-sidecar-'))
    mkdirSync(join(repo, '.claude'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'forge'), 'gitlab\n')

    const r = sweepLegacySeeds(repo, plugin, (rel) => join(sidecar, rel))
    expect(r.moved).toBe(1)
    expect(existsSync(join(repo, '.claude', 'forge'))).toBe(false)
    expect(readFileSync(join(sidecar, 'forge'), 'utf8')).toContain('gitlab')
  })
})
