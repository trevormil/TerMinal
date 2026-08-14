import { describe, expect, test } from 'bun:test'
import {
  agentFileLangKey,
  artifactDefaultPath,
  classicStatusDot,
  definitionStatusDot,
  filterClassicAgents,
  filterDefinitions,
  filterPersistentAgents,
  fmtBytes,
  fmtDuration,
  lastRunByAgent,
  modelPolicyRows,
  nextArtifactId,
  parseStateSidecar,
  runSparkline,
  runStatusTone,
  shortAge,
  successRateTone,
  type UnifiedRunRow,
} from './agentsView'
import type { Agent, AgentDefinition, PersistentAgent, PersistentArtifact } from './types'

const definition = (over: Partial<AgentDefinition> = {}): AgentDefinition =>
  ({
    id: 'classic:repo:triage',
    ref: { id: 'triage', scope: 'repo', kind: 'classic' },
    title: 'Triage issues',
    description: 'Sorts the inbox',
    scope: 'repo',
    kind: 'classic',
    source: 'repo',
    runtime: { mode: 'prompt' },
    instructions: {},
    quality: {},
    metadata: {},
    ...over,
  }) as AgentDefinition

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: 'triage',
  title: 'Triage issues',
  prompt: 'do it',
  ...over,
})

describe('formatting', () => {
  test('fmtDuration walks ms → s → m → h', () => {
    expect(fmtDuration(820)).toBe('820ms')
    expect(fmtDuration(4200)).toBe('4.2s')
    expect(fmtDuration(185_000)).toBe('3m 5s')
    expect(fmtDuration(3_720_000)).toBe('1h 2m')
  })
  test('fmtDuration rejects nonsense rather than rendering NaN', () => {
    expect(fmtDuration(-1)).toBe('—')
    expect(fmtDuration(Number.NaN)).toBe('—')
  })
  test('fmtBytes switches unit at each 1024 boundary', () => {
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(1024)).toBe('1.0 KB')
    expect(fmtBytes(1024 * 1024)).toBe('1.0 MB')
    expect(fmtBytes(Number.POSITIVE_INFINITY)).toBe('')
  })
  test('shortAge has no "ago" suffix and truncates downward', () => {
    const now = 1_000_000_000
    expect(shortAge(now - 45_000, now)).toBe('45s')
    expect(shortAge(now - 90_000, now)).toBe('1m')
    expect(shortAge(now - 7_200_000, now)).toBe('2h')
  })
  test('runStatusTone maps terminal states apart from in-flight ones', () => {
    expect(runStatusTone('done')).toBe('green')
    expect(runStatusTone('failed')).toBe('red')
    expect(runStatusTone('interrupted')).toBe('yellow')
    expect(runStatusTone('canceled')).toBe('mute')
    expect(runStatusTone('running')).toBe('blue')
  })
  test('agentFileLangKey resolves by extension, case-insensitively', () => {
    expect(agentFileLangKey('MEMORY.MD')).toBe('markdown')
    expect(agentFileLangKey('run.sh')).toBe('sh')
    expect(agentFileLangKey('a/b/agent.json')).toBe('json')
    expect(agentFileLangKey('notes.txt')).toBe('')
    expect(agentFileLangKey('LICENSE')).toBe('')
  })
})

describe('modelPolicyRows', () => {
  test('falls back to the runtime model, then to "Engine default"', () => {
    expect(modelPolicyRows(definition()).map((r) => r.value)).toEqual([
      'Engine default',
      'Not set',
      'Not set',
      'Not set',
    ])
    const withModel = definition({ runtime: { mode: 'prompt', model: 'sonnet' } })
    expect(modelPolicyRows(withModel)[0].value).toBe('sonnet')
  })
  test('the judge slot falls back to the quality judge model', () => {
    const d = definition({ quality: { judge: { model: 'haiku' } } })
    expect(modelPolicyRows(d)[3]).toEqual({ label: 'Judge', value: 'haiku', tone: 'yellow' })
  })
  test('an explicit policy wins over both fallbacks', () => {
    const d = definition({
      runtime: { mode: 'prompt', model: 'sonnet', modelPolicy: { default: 'opus', judge: 'gpt' } },
      quality: { judge: { model: 'haiku' } },
    })
    const rows = modelPolicyRows(d)
    expect(rows[0].value).toBe('opus')
    expect(rows[3].value).toBe('gpt')
  })
})

describe('roster filtering', () => {
  test('filterDefinitions matches id, title, description and tags', () => {
    const defs = [
      definition({ id: 'a', ref: { id: 'alpha', scope: 'repo', kind: 'classic' }, title: 'Alpha' }),
      definition({
        id: 'b',
        ref: { id: 'beta', scope: 'repo', kind: 'classic' },
        title: 'Beta',
        description: 'runs the nightly sweep',
      }),
      definition({
        id: 'c',
        ref: { id: 'gamma', scope: 'repo', kind: 'classic' },
        title: 'Gamma',
        description: '',
        metadata: { tags: ['security', 'audit'] },
      }),
    ]
    expect(filterDefinitions(defs, 'alph').map((d) => d.id)).toEqual(['a'])
    expect(filterDefinitions(defs, 'NIGHTLY').map((d) => d.id)).toEqual(['b'])
    expect(filterDefinitions(defs, 'audit').map((d) => d.id)).toEqual(['c'])
    expect(filterDefinitions(defs, '   ')).toHaveLength(3)
  })
  test('filterClassicAgents splits built-in defaults from repo-owned ones', () => {
    const agents = [
      agent({ id: 'builtin', source: 'default' }),
      agent({ id: 'override', source: 'repo-override' }),
      agent({ id: 'custom', source: 'repo' }),
      agent({ id: 'global', source: 'global' }),
    ]
    expect(filterClassicAgents(agents, 'generic', '').map((a) => a.id)).toEqual(['builtin'])
    expect(filterClassicAgents(agents, 'per-repo', '').map((a) => a.id)).toEqual([
      'override',
      'custom',
    ])
    expect(filterClassicAgents(agents, 'all', '')).toHaveLength(4)
  })
  test('filterClassicAgents applies scope and search together', () => {
    const agents = [
      agent({ id: 'sweep-a', source: 'repo', title: 'Sweep A' }),
      agent({ id: 'sweep-b', source: 'default', title: 'Sweep B' }),
    ]
    expect(filterClassicAgents(agents, 'per-repo', 'sweep').map((a) => a.id)).toEqual(['sweep-a'])
  })
  test('filterPersistentAgents searches tags as well as text', () => {
    const list: PersistentAgent[] = [
      {
        id: 'memo',
        title: 'Memo',
        engine: 'codex',
        tags: ['journal'],
        createdAt: 0,
        updatedAt: 0,
        dir: '/x',
      },
      {
        id: 'scout',
        title: 'Scout',
        engine: 'codex',
        tags: [],
        description: 'watches deps',
        createdAt: 0,
        updatedAt: 0,
        dir: '/y',
      },
    ]
    expect(filterPersistentAgents(list, 'journal').map((a) => a.id)).toEqual(['memo'])
    expect(filterPersistentAgents(list, 'deps').map((a) => a.id)).toEqual(['scout'])
    expect(filterPersistentAgents(list, '')).toHaveLength(2)
  })
})

describe('run rollups', () => {
  const runs: UnifiedRunRow[] = [
    { id: 'r3', agentId: 'a', status: 'failed', startedAt: 300 },
    { id: 'r2', agentId: 'b', status: 'done', startedAt: 200, endedAt: 260 },
    { id: 'r1', agentId: 'a', status: 'done', startedAt: 100, endedAt: 150 },
  ]
  test('lastRunByAgent keeps the newest run per agent', () => {
    const m = lastRunByAgent(runs)
    expect(m.get('a')).toEqual({ status: 'failed', startedAt: 300 })
    expect(m.get('b')).toEqual({ status: 'done', startedAt: 200 })
    expect(m.has('c')).toBe(false)
  })
  test('runSparkline reverses to oldest → newest and caps at 20 bars', () => {
    const many: UnifiedRunRow[] = Array.from({ length: 25 }, (_, i) => ({
      id: `r${i}`,
      agentId: 'a',
      status: 'done',
      startedAt: 1000 - i,
      endedAt: 1000 - i + 10,
    }))
    const bars = runSparkline(many, 'a')
    expect(bars).toHaveLength(20)
    expect(bars[0].id).toBe('r19')
    expect(bars[19].id).toBe('r0')
  })
  test('runSparkline scales height by duration and flags running bars', () => {
    const bars = runSparkline(
      [
        { id: 'long', agentId: 'a', status: 'done', startedAt: 0, endedAt: 60_000 },
        { id: 'short', agentId: 'a', status: 'failed', startedAt: 0, endedAt: 6_000 },
        { id: 'live', agentId: 'a', status: 'running', startedAt: 0 },
      ],
      'a',
    )
    const byId = new Map(bars.map((b) => [b.id, b]))
    expect(byId.get('long')!.height).toBe(32)
    // 6s of a 60s max scales to 3px, but the floor keeps every bar visible.
    expect(byId.get('short')!.height).toBe(4)
    expect(byId.get('live')!.height).toBe(24)
    expect(byId.get('live')!.tone).toContain('gt-pulse')
    expect(byId.get('live')!.title).toContain('running')
    expect(byId.get('long')!.tone).toBe('bg-[var(--gt-green)]')
    expect(byId.get('short')!.tone).toBe('bg-[var(--gt-red)]')
  })
  test('runSparkline ignores other agents and returns nothing when empty', () => {
    expect(runSparkline(runs, 'b').map((b) => b.id)).toEqual(['r2'])
    expect(runSparkline(runs, 'zzz')).toEqual([])
  })
})

describe('status dots', () => {
  const now = 10_000_000
  test('a run in progress outranks any recorded history', () => {
    const busy = definitionStatusDot(
      definition({ metadata: { lastRunAt: now - 1000 } }),
      true,
      { status: 'failed', startedAt: now - 1000 },
      now,
    )
    expect(busy).toEqual({ dot: 'bg-[var(--gt-green)] gt-pulse', dotTitle: 'Run in progress' })
    expect(classicStatusDot(true, null, now).dot).toBe('bg-[var(--gt-green)] gt-pulse')
  })
  test('definition dot falls back to the persistent metadata stamp', () => {
    const d = definition({ kind: 'persistent', metadata: { lastRunAt: now - 60_000 } })
    const res = definitionStatusDot(d, false, null, now)
    expect(res.dot).toBe('bg-[var(--gt-accent-light)]')
    expect(res.dotTitle).toBe('Last persistent run: 1m ago')
  })
  test('definition dot stays blank with neither a run nor a stamp', () => {
    expect(definitionStatusDot(definition(), false, null, now)).toEqual({ dot: '', dotTitle: '' })
  })
  test('classic dot dims any non-terminal last run instead of going accent', () => {
    expect(classicStatusDot(false, { status: 'canceled', startedAt: now - 3600_000 }, now)).toEqual(
      {
        dot: 'bg-white/20',
        dotTitle: 'Last run: canceled · 1h ago',
      },
    )
    expect(classicStatusDot(false, { status: 'done', startedAt: now }, now).dot).toBe(
      'bg-[var(--gt-green)]',
    )
    expect(classicStatusDot(false, { status: 'failed', startedAt: now }, now).dot).toBe(
      'bg-[var(--gt-red)]',
    )
    expect(classicStatusDot(false, null, now)).toEqual({ dot: '', dotTitle: '' })
  })
})

describe('state sidecar', () => {
  test('splits the reserved keys out of the extras list', () => {
    const parsed = parseStateSidecar({
      lastScannedSha: 'abc123',
      lastScannedRef: 'main',
      lastRunAt: 42,
      lastRunId: 'run-1',
      openTickets: 3,
      note: 'hi',
    })
    expect(parsed.sha).toBe('abc123')
    expect(parsed.ref).toBe('main')
    expect(parsed.at).toBe(42)
    expect(parsed.runId).toBe('run-1')
    expect(parsed.extras).toEqual([
      ['openTickets', 3],
      ['note', 'hi'],
    ])
  })
  test('drops reserved keys carrying the wrong type rather than rendering them', () => {
    const parsed = parseStateSidecar({ lastScannedSha: 7, lastRunAt: 'yesterday' })
    expect(parsed.sha).toBe('')
    expect(parsed.at).toBe(0)
    expect(parsed.extras).toEqual([])
  })
  test('an empty sidecar yields empty slots', () => {
    expect(parseStateSidecar({})).toEqual({ sha: '', ref: '', at: 0, runId: '', extras: [] })
  })
})

describe('artifacts', () => {
  const artifact = (over: Partial<PersistentArtifact>): PersistentArtifact =>
    ({
      id: 'a1',
      title: 'Report',
      kind: 'report',
      path: '/x',
      createdAt: 0,
      files: [],
      ...over,
    }) as PersistentArtifact

  test('artifactDefaultPath prefers the declared primary file', () => {
    const a = artifact({
      primaryPath: 'r/report.md',
      files: [{ name: 'report.md', path: 'r/report.md', size: 1, mtime: 0, kind: 'markdown' }],
    })
    expect(artifactDefaultPath(a)).toBe('r/report.md')
  })
  test('artifactDefaultPath skips the artifact.json manifest', () => {
    const a = artifact({
      files: [
        { name: 'artifact.json', path: 'r/artifact.json', size: 1, mtime: 0, kind: 'json' },
        { name: 'report.md', path: 'r/report.md', size: 2, mtime: 0, kind: 'markdown' },
      ],
    })
    expect(artifactDefaultPath(a)).toBe('r/report.md')
  })
  test('artifactDefaultPath is null with nothing to show', () => {
    expect(artifactDefaultPath(null)).toBeNull()
    expect(artifactDefaultPath(artifact({ files: [] }))).toBeNull()
  })
  test('nextArtifactId keeps a surviving selection and otherwise takes the first', () => {
    const list = [artifact({ id: 'a1' }), artifact({ id: 'a2' })]
    expect(nextArtifactId(list, 'a2')).toBe('a2')
    expect(nextArtifactId(list, 'gone')).toBe('a1')
    expect(nextArtifactId(list, null)).toBe('a1')
    expect(nextArtifactId([], 'a1')).toBeNull()
  })
})

describe('successRateTone', () => {
  test('crosses at 80 and 50 percent', () => {
    expect(successRateTone(80)).toBe('text-emerald-400')
    expect(successRateTone(79)).toBe('text-amber-400')
    expect(successRateTone(50)).toBe('text-amber-400')
    expect(successRateTone(49)).toBe('text-rose-400')
  })
  test('an unknown rate is neutral, not failing', () => {
    expect(successRateTone(null)).toBe('text-zinc-500')
    expect(successRateTone(undefined)).toBe('text-zinc-500')
  })
})
