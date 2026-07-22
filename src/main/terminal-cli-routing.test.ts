import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { MODEL_TIERS, resolveModel } from './resolve-model'
import type { AgentModelPolicy } from './agents'

const CLI = join(process.cwd(), 'bin', 'terminal-cli')

// `terminal-cli routing` is self-contained — it is copied to
// ~/.config/TerMinal/bin and cannot import resolve-model.ts, so it MIRRORS
// resolveModel(). A mirror of the thing under test is worthless as an oracle if
// it drifts, so this file pins the two together: for every combination below,
// the CLI's "WOULD LAUNCH" line must equal what the real resolveModel() returns.
// If someone changes the priority order or the tier→slot map on either side,
// these cases fail.

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'terminal-cli-routing-home-'))
  const repo = mkdtempSync(join(tmpdir(), 'terminal-cli-routing-repo-'))
  mkdirSync(join(repo, '.git'), { recursive: true }) // routing() treats this as a repo root
  mkdirSync(join(repo, 'backlog'), { recursive: true })
  mkdirSync(join(repo, '.agents'), { recursive: true })
  mkdirSync(join(home, '.config', 'TerMinal'), { recursive: true })
  return { home, repo }
}

function writeSettings(home: string, engines: Record<string, { defaultModel: string }>) {
  writeFileSync(join(home, '.config', 'TerMinal', 'settings.json'), JSON.stringify({ engines }))
}

function writeAgent(
  repo: string,
  agent: { id: string; engine?: string; model?: string; modelPolicy?: AgentModelPolicy },
) {
  writeFileSync(
    join(repo, '.agents', 'agents.json'),
    JSON.stringify([{ title: agent.id, prompt: 'x', ...agent }]),
  )
}

function writeTicket(repo: string, tier: string, agentId: string) {
  writeFileSync(
    join(repo, 'backlog', '0001-routing-fixture.md'),
    `---\nid: 0001\ntitle: "Routing fixture"\nstatus: open\nmodel_tier: ${tier}\nagent_id: ${agentId}\nagent_kind: classic\n---\n\nbody\n`,
  )
}

/** Run `terminal-cli routing` and return the model on the WOULD LAUNCH line.
 *  '' means the CLI reported "engine picks its own default" — the same thing
 *  resolveModel expresses as an empty string. */
function wouldLaunch(home: string, repo: string, extra: string[] = []): string {
  const result = spawnSync('bun', [CLI, 'routing', repo, '0001', ...extra], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home },
    encoding: 'utf8' as const,
  })
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
  const line = result.stdout.split('\n').find((l) => l.startsWith('WOULD LAUNCH:'))
  expect(line).toBeDefined()
  const model = (line as string).slice('WOULD LAUNCH:'.length).trim()
  return model === '(engine picks its own default)' ? '' : model
}

const FULL: AgentModelPolicy = {
  default: 'opus',
  cheap: 'haiku',
  deep: 'opus-deep',
  judge: 'haiku',
  allowOverride: true,
}
// A policy with an empty cheap slot must fall THROUGH to the agent model, not
// resolve to ''. This is the case most likely to drift between the two impls.
const SPARSE: AgentModelPolicy = { default: 'opus', cheap: '', deep: '', allowOverride: true }
const LOCKED: AgentModelPolicy = { ...FULL, allowOverride: false }

const POLICIES: { name: string; policy?: AgentModelPolicy }[] = [
  { name: 'full', policy: FULL },
  { name: 'sparse', policy: SPARSE },
  { name: 'locked', policy: LOCKED },
  { name: 'none', policy: undefined },
]

describe('terminal-cli routing — parity with resolveModel()', () => {
  for (const { name, policy } of POLICIES) {
    for (const tier of MODEL_TIERS) {
      for (const override of ['', 'sonnet']) {
        test(`${name} policy · ${tier} · ${override ? 'override' : 'no override'}`, () => {
          const { home, repo } = setup()
          writeSettings(home, { claude: { defaultModel: 'engine-default' } })
          writeAgent(repo, {
            id: 'owner',
            engine: 'claude',
            model: 'agent-model',
            modelPolicy: policy,
          })
          writeTicket(repo, tier, 'owner')

          const expected = resolveModel({
            override,
            // Mirrors modelPolicyFrom(): the agent's plain model backfills the
            // default slot. Kept explicit here because that helper is private.
            policy: policy ? { ...policy, default: policy.default || 'agent-model' } : undefined,
            tier,
            model: 'agent-model',
            engineDefault: 'engine-default',
            engine: 'claude',
            policyEngine: 'claude',
          })

          expect(wouldLaunch(home, repo, override ? [`--override=${override}`] : [])).toBe(expected)
        })
      }
    }
  }

  test('cross-engine run drops the policy, same as resolveModel', () => {
    const { home, repo } = setup()
    writeSettings(home, { claude: { defaultModel: 'engine-default' } })
    // Policy slugs were written for codex; the run launches on claude.
    writeAgent(repo, { id: 'owner', engine: 'codex', model: 'agent-model', modelPolicy: FULL })
    writeTicket(repo, 'cheap-raw', 'owner')

    const expected = resolveModel({
      policy: FULL,
      tier: 'cheap-raw',
      model: 'agent-model',
      engineDefault: 'engine-default',
      engine: 'claude',
      policyEngine: 'codex',
    })
    expect(expected).toBe('agent-model') // guard: the fixture really exercises the drop
    expect(wouldLaunch(home, repo, ['--engine=claude'])).toBe(expected)
  })

  test('an unroutable tier in a ticket file is reported, not silently billed', () => {
    const { home, repo } = setup()
    writeSettings(home, { claude: { defaultModel: 'engine-default' } })
    writeAgent(repo, { id: 'owner', engine: 'claude', modelPolicy: FULL })
    writeTicket(repo, 'cheep-raw', 'owner')

    const result = spawnSync('bun', [CLI, 'routing', repo, '0001'], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home },
      encoding: 'utf8' as const,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('not a routable tier')
    // ...and it routes exactly where resolveModel sends it: the default slot.
    expect(result.stdout).toContain('WOULD LAUNCH:    opus')
  })

  test('an owner agent absent from every readable layer is flagged, not assumed', () => {
    const { home, repo } = setup()
    writeSettings(home, { claude: { defaultModel: 'engine-default' } })
    writeTicket(repo, 'cheap-raw', 'ghost-agent')

    const result = spawnSync('bun', [CLI, 'routing', repo, '0001'], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home },
      encoding: 'utf8' as const,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('NOT FOUND in global/repo files')
    expect(result.stdout).toContain('may understate the routing')
  })

  test('a legacy ticket with no model_tier line reads as auto', () => {
    const { home, repo } = setup()
    writeSettings(home, { claude: { defaultModel: 'engine-default' } })
    writeAgent(repo, { id: 'owner', engine: 'claude', modelPolicy: FULL })
    writeFileSync(
      join(repo, 'backlog', '0001-routing-fixture.md'),
      `---\nid: 0001\ntitle: "Legacy"\nstatus: open\nagent_id: owner\n---\n\nbody\n`,
    )

    const result = spawnSync('bun', [CLI, 'routing', repo, '0001'], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home },
      encoding: 'utf8' as const,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('ticket declares: auto')
    expect(result.stdout).toContain('WOULD LAUNCH:    opus')
  })
})
