import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { gitStatus, resetGitStatusCacheForTests } from '../src/main/repo'
import {
  findSessionFile,
  lastAssistantTurn,
  parseTranscriptFile,
  parseTranscriptFileIncremental,
  readTranscriptStats,
  resetTranscriptStatsCacheForTests,
} from '../src/main/data'
import { orderFleetSnapshotEntries } from '../src/main/fleet-snapshot'

type Args = {
  repos: string[]
  transcripts: string[]
  sessions: number
}

function parseArgs(argv: string[]): Args {
  const repos: string[] = []
  const transcripts: string[] = []
  let sessions = 6
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--repo' && argv[i + 1]) repos.push(argv[++i])
    else if (arg === '--transcript' && argv[i + 1]) transcripts.push(argv[++i])
    else if (arg === '--sessions' && argv[i + 1]) sessions = Math.max(1, Number(argv[++i]) || 6)
  }
  return { repos: repos.length ? repos : [process.cwd()], transcripts, sessions }
}

function discoverTranscripts(limit: number): string[] {
  const root = join(homedir(), '.claude', 'projects')
  if (!existsSync(root)) return []
  const files: { path: string; mtime: number }[] = []
  for (const project of readdirSync(root)) {
    const dir = join(root, project)
    try {
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.jsonl')) continue
        const path = join(dir, name)
        files.push({ path, mtime: statSync(path).mtimeMs })
      }
    } catch {
      /* skip unreadable project dirs */
    }
  }
  return files
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((f) => f.path)
}

function sessionIdFromPath(path: string): string {
  return basename(path, extname(path))
}

function ms(run: () => void): number {
  const start = performance.now()
  run()
  return performance.now() - start
}

function printRow(name: string, detail: string, durationMs: number | null) {
  const value = durationMs === null ? 'skip' : durationMs.toFixed(1)
  console.log(`${name.padEnd(28)} ${detail.padEnd(30)} ${value.padStart(8)} ms`)
}

function syntheticAssistantLine(i: number): string {
  return JSON.stringify({
    uuid: `bench-${i}`,
    message: {
      id: `bench-msg-${i}`,
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      usage: {
        input_tokens: 100 + (i % 13),
        cache_creation_input_tokens: i % 3,
        cache_read_input_tokens: i % 11,
        output_tokens: 40 + (i % 7),
      },
      content:
        i % 10 === 0
          ? [
              { type: 'text', text: `bench ${i}` },
              {
                type: 'tool_use',
                id: `bench-tool-${i}`,
                name: 'Bash',
                input: { command: `echo ${i}` },
              },
            ]
          : [{ type: 'text', text: `bench ${i}` }],
    },
  })
}

function syntheticTranscript(lines: number): string {
  const out = [
    JSON.stringify({
      cwd: process.cwd(),
      gitBranch: 'bench',
      message: { role: 'user', content: 'benchmark transcript' },
    }),
  ]
  for (let i = 0; i < lines; i++) out.push(syntheticAssistantLine(i))
  return `${out.join('\n')}\n`
}

const args = parseArgs(process.argv.slice(2))

console.log('benchmark                     detail                               total')
console.log('----------------------------  ------------------------------  ----------')

const repo = args.repos.find((path) => existsSync(path))
if (repo) {
  resetGitStatusCacheForTests()
  printRow(
    'gitStatus burst',
    `${repo} x10`,
    ms(() => {
      for (let i = 0; i < 10; i++) gitStatus(repo)
    }),
  )
} else {
  printRow('gitStatus burst', 'no existing --repo path', null)
}

const transcriptPaths = (
  args.transcripts.length ? args.transcripts : discoverTranscripts(args.sessions)
)
  .filter((path) => existsSync(path))
  .slice(0, args.sessions)
const sessionIds = transcriptPaths.map(sessionIdFromPath).filter((id) => findSessionFile(id))

if (sessionIds.length) {
  const calls = Math.max(10, sessionIds.length * 4)
  resetTranscriptStatsCacheForTests()
  printRow(
    'readTranscriptStats',
    `${sessionIds.length} ids, ${calls} calls`,
    ms(() => {
      for (let i = 0; i < calls; i++) readTranscriptStats(sessionIds[i % sessionIds.length])
    }),
  )

  resetTranscriptStatsCacheForTests()
  const entries = sessionIds.map((id) => [id, id] as [string, string])
  const activeKey = entries[0]?.[0] || ''
  printRow(
    'simulated fleetSnapshot',
    `${entries.length} sessions`,
    ms(() => {
      const rows = new Map<string, unknown>()
      for (const [key, sessionId] of orderFleetSnapshotEntries(entries, activeKey)) {
        const stats = readTranscriptStats(sessionId)
        const file = findSessionFile(sessionId)
        const turn = file ? lastAssistantTurn(file) : null
        rows.set(key, {
          sessionId,
          branch: stats.gitBranch,
          model: stats.model,
          status: turn && !turn.endTurn ? 'working' : 'idle',
          contextPct: stats.contextPct,
          contextTokens: stats.contextTokens,
          contextLimit: stats.contextLimit,
          turns: stats.turns,
          aiTitle: stats.aiTitle,
          lastAction: stats.lastAction,
        })
      }
      entries.map(([key]) => rows.get(key)).filter(Boolean)
    }),
  )
} else {
  printRow('readTranscriptStats', 'no locatable transcripts', null)
  printRow('simulated fleetSnapshot', 'no locatable transcripts', null)
}

const benchDir = mkdtempSync(join(tmpdir(), 'terminal-tick-'))
try {
  const file = join(benchDir, 'large.jsonl')
  const base = syntheticTranscript(20_000)
  writeFileSync(file, base)
  printRow(
    'parseTranscriptFile full',
    '20k synthetic lines',
    ms(() => parseTranscriptFile(file, 'bench')),
  )

  let st = statSync(file)
  let state = parseTranscriptFileIncremental(file, 'bench', null, st.size, st.mtimeMs)
  const append = `${syntheticAssistantLine(20_001)}\n${syntheticAssistantLine(20_002)}\n`
  appendFileSync(file, append)
  st = statSync(file)
  printRow(
    'incremental append parse',
    `${Buffer.byteLength(append, 'utf8')} appended bytes`,
    ms(() => {
      state = parseTranscriptFileIncremental(file, 'bench', state, st.size, st.mtimeMs)
    }),
  )
} finally {
  rmSync(benchDir, { recursive: true, force: true })
}
