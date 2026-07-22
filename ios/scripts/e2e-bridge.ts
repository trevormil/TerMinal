#!/usr/bin/env bun
/**
 * End-to-end harness for the mobile bridge, against a REAL pty.
 *
 * Starts the same bridge the Electron main process starts, backed by an actual
 * shell, and prints a pairing code pointing at 127.0.0.1 (which the iOS
 * Simulator shares with the host). Use it to exercise the whole client without
 * running the desktop app or touching your real TerMinal config.
 *
 *   bun ios/scripts/e2e-bridge.ts            # run until Ctrl-C
 *   bun ios/scripts/e2e-bridge.ts --selftest # assert the round trip, then exit
 *
 * Everything lives in a temp identity dir, so it never disturbs the pairing of
 * a phone already paired with the real app.
 */
import qrcode from 'qrcode-generator'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureIdentity, pairingPayload } from '../../src/main/bridge/identity'
import { sessionMessages, type ChatEngine, type ChatMessage } from '../../src/main/chat/messages'
import { listSessions } from '../../src/main/data'
import { repoRootOf } from '../../src/main/repo'
import {
  bridgeBroadcast,
  bridgeBroadcastExit,
  startBridge,
  stopBridge,
  type BridgeDeps,
} from '../../src/main/bridge/server'

const PORT = 8791 // not 8790: never collide with a real running TerMinal
const KEY = 'e2e-session'
const selftest = process.argv.includes('--selftest')

// `--real <sessionId> <engine>` serves an ACTUAL transcript from disk instead
// of the scripted one, so the chat client can be exercised against real agent
// output without running the desktop app against your live config.
const realIndex = process.argv.indexOf('--real')
const real =
  realIndex >= 0
    ? {
        sessionId: process.argv[realIndex + 1] || '',
        engine: (process.argv[realIndex + 2] || 'claude') as ChatEngine,
      }
    : null

const COLS = 100
const ROWS = 30

// node-pty is built against Electron's ABI and can't load under Bun, so this
// harness allocates a real pty via ptyrelay.py instead. Same fidelity for what
// is under test: a genuine terminal on the other end of the bridge.
const proc = Bun.spawn(
  [
    'python3',
    new URL('./ptyrelay.py', import.meta.url).pathname,
    String(COLS),
    String(ROWS),
    '/bin/bash',
    '--norc',
    '--noprofile',
    '-i',
  ],
  {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: process.cwd(),
    env: { ...process.env, PS1: 'e2e$ ', TERM: 'xterm-256color' },
  },
)

// Enumerating every transcript costs ~600ms, so cache it like the app does.
let sessionCacheAt = 0
let sessionCacheValue: ReturnType<typeof listSessions> = []
function realSessions() {
  if (Date.now() - sessionCacheAt < 20_000) return sessionCacheValue
  sessionCacheValue = listSessions()
  sessionCacheAt = Date.now()
  return sessionCacheValue
}
const workspaceOf = (cwd: string) =>
  (repoRootOf(cwd) || cwd || '').replace(/\/$/, '').split('/').pop() || 'unknown'

let scrollback = ''

// ---- scripted chat state ----
const now = () => 1_784_000_000_000 + chatLog.length * 1000
const chatLog: ChatMessage[] = [
  { kind: 'user', at: 1_784_000_000_000, text: 'run the test suite' },
  {
    kind: 'assistant',
    at: 1_784_000_001_000,
    text: 'Running it now — I will report the first failure rather than the whole log.',
  },
  { kind: 'tool', at: 1_784_000_002_000, name: 'Bash', summary: 'bun test', status: 'ok' },
  {
    kind: 'assistant',
    at: 1_784_000_003_000,
    text: '844 pass, 0 fail. Anything you want me to pick up next?',
  },
]
const historyLog: ChatMessage[] = [
  { kind: 'user', at: 1_783_899_000_000, text: 'review the open PRs overnight' },
  {
    kind: 'assistant',
    at: 1_783_899_500_000,
    text: 'Reviewed 3 PRs. #117 is merge-ready; #118 needs a rebase.',
  },
]
let hitlQueue = [
  {
    id: 'h1',
    title: 'Approve release to production',
    detail: 'The release script wants to publish v0.4.0 from main.',
    action: 'bun run release',
    repo: 'TerMinal',
    source: 'agent',
    createdAt: 1_784_000_004_000,
  },
]
const pump = async (stream: ReadableStream<Uint8Array>) => {
  const decoder = new TextDecoder()
  for await (const chunk of stream) {
    const text = decoder.decode(chunk)
    scrollback = (scrollback + text).slice(-256 * 1024)
    bridgeBroadcast(KEY, text)
  }
}
void pump(proc.stdout)
void pump(proc.stderr)
void proc.exited.then((code) => bridgeBroadcastExit(KEY, code))

const writer = proc.stdin
const type = (text: string) => {
  try {
    writer.write(text)
    writer.flush()
    return true
  } catch {
    return false // the shell exited from under us
  }
}

// Let the relay allocate the pty and bash print its first prompt before typing.
// Geometry is set by the relay itself via TIOCSWINSZ.
await new Promise((r) => setTimeout(r, 600))

const deps: BridgeDeps = {
  sessions: () => [
    {
      key: KEY,
      sessionId: 'e2e',
      name: 'harness session',
      cwd: process.cwd(),
      repo: 'TerMinal',
      branch: 'feat/ios-remote-terminal',
      model: '',
      status: 'idle',
      engine: 'codex',
      cols: COLS,
      rows: ROWS,
    },
  ],
  write: (key, data) => {
    if (key !== KEY) return false
    const text = data.toString('utf8')
    // A chat send arrives as "<prompt>\r"; record both sides so the thread
    // behaves like a real conversation.
    if (text.endsWith('\r') && text.length > 1 && !text.includes('\u0003')) {
      const prompt = text.slice(0, -1)
      chatLog.push({ kind: 'user', at: now(), text: prompt })
      chatLog.push({
        kind: 'assistant',
        at: now(),
        text: `Got it — "${prompt}". (scripted harness reply)`,
      })
    }
    return type(text)
  },
  replay: () => scrollback,

  // A scripted conversation so the chat UI can be driven without a live agent.
  // Every prompt sent from the phone is appended, and the "agent" answers, so
  // the round trip is real even though the content is canned.
  messages: (key, opts) => {
    if (key.startsWith('past:')) {
      // A real resumable session: read its actual transcript.
      const sessionId = key.slice('past:'.length)
      const meta = realSessions().find((s) => s.id === sessionId)
      if (meta) return sessionMessages(sessionId, meta.engine as ChatEngine, opts)
      const after = Math.max(0, opts.after ?? 0)
      return { messages: historyLog.slice(after), unsupported: false, total: historyLog.length }
    }
    if (real) return sessionMessages(real.sessionId, real.engine, opts)
    const after = Math.max(0, opts.after ?? 0)
    return { messages: chatLog.slice(after), unsupported: false, total: chatLog.length }
  },
  // One live thread plus a finished one, so history renders in the harness too.
  threads: () => [
    {
      key: KEY,
      name: real ? `real · ${real.engine}` : 'harness session',
      repo: 'TerMinal',
      branch: 'feat/ios-remote-terminal',
      engine: real ? real.engine : 'codex',
      status: 'idle',
      needsInput: true,
      live: true,
      chat: true,
    },
    {
      key: 'past:harness-history',
      name: 'overnight review',
      repo: 'TerMinal',
      branch: 'main',
      engine: 'claude',
      status: 'done',
      needsInput: false,
      live: false,
      chat: true,
      endedAt: 1_783_900_000_000,
    },
  ],
  hitl: () => hitlQueue,
  resolveHitl: (id) => {
    const before = hitlQueue.length
    hitlQueue = hitlQueue.filter((h) => h.id !== id)
    return hitlQueue.length < before
  },
  repos: () => [
    { name: 'TerMinal', path: '/repos/TerMinal' },
    { name: 'beacon', path: '/repos/beacon' },
  ],

  // Real workspaces and history off disk, so the grouped/searchable list can be
  // exercised against the hundreds of sessions a real machine accumulates.
  workspaces: () => {
    const byRepo = new Map<string, { path: string; count: number; lastAt: number }>()
    for (const s of realSessions()) {
      const repo = workspaceOf(s.cwd)
      const e = byRepo.get(repo) || { path: s.cwd, count: 0, lastAt: 0 }
      e.count++
      if (s.mtime > e.lastAt) {
        e.lastAt = s.mtime
        e.path = repoRootOf(s.cwd) || s.cwd
      }
      byRepo.set(repo, e)
    }
    return [...byRepo.entries()]
      .map(([repo, e]) => ({ repo, path: e.path, count: e.count, lastAt: e.lastAt }))
      .sort((a, b) => b.lastAt - a.lastAt)
  },
  history: ({ workspace, q, limit }) => {
    const needle = (q || '').trim().toLowerCase()
    const out = []
    for (const s of realSessions()) {
      const repo = workspaceOf(s.cwd)
      if (workspace && repo !== workspace) continue
      const title = (s.firstUserText || '').trim() || 'session'
      if (needle && !`${title} ${repo} ${s.gitBranch}`.toLowerCase().includes(needle)) continue
      out.push({
        key: `past:${s.id}`,
        sessionId: s.id,
        title,
        repo,
        branch: s.gitBranch || '',
        engine: s.engine,
        turns: s.turns,
        at: s.mtime,
      })
      if (limit && limit > 0 && out.length >= limit) break
    }
    return out
  },
  // Resuming for real would spawn a pty this harness does not own.
  resume: () => ({ error: 'the harness cannot resume — try it against the real app' }),
  startSession: (input) => ({ key: `phone-${input.cwd.split('/').pop()}` }),
}

const dir = mkdtempSync(join(tmpdir(), 'gt-bridge-e2e-'))
const identity = ensureIdentity(dir)
const status = await startBridge(deps, {
  port: PORT,
  dir,
  // Show every client request, so a phone that "just spins" can be diagnosed
  // from this side instead of guessed at.
  onRequest: selftest
    ? undefined
    : (method, path, code) =>
        console.log(code ? `[req] ${method} ${path} -> ${code}` : `[req] ${method} ${path} …`),
})
if (!status.listening) {
  console.error('bridge failed to start:', status.error)
  process.exit(1)
}

// Real addresses first so a physical phone connects immediately; 127.0.0.1 is
// appended as a fallback for the Simulator, which shares the host network.
const payload = pairingPayload({
  port: PORT,
  identity,
  name: 'e2e harness',
  hosts: [...pairingPayload({ port: PORT, identity }).h, '127.0.0.1'],
})

/**
 * Render the pairing payload as a QR in the terminal, so a physical phone can
 * scan it straight off the screen. Half-blocks pack two module rows per text
 * row, which keeps a 49-module code inside a normal terminal window.
 */
function printQR(text: string): void {
  const qr = qrcode(0, 'L')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  const quiet = 2
  const dark = (r: number, c: number) => r >= 0 && r < n && c >= 0 && c < n && qr.isDark(r, c)
  // Inverted (dark background, light modules) reads reliably in a dark
  // terminal; scanners handle either polarity.
  const lines: string[] = []
  for (let r = -quiet; r < n + quiet; r += 2) {
    let line = ''
    for (let c = -quiet; c < n + quiet; c++) {
      const top = dark(r, c)
      const bottom = dark(r + 1, c)
      line += top && bottom ? ' ' : top ? '\u2584' : bottom ? '\u2580' : '\u2588'
    }
    lines.push(line)
  }
  console.log(lines.join('\n'))
}

if (!selftest) {
  console.log('\n=== scan this with TerMinal Remote ===\n')
  printQR(JSON.stringify(payload))
  console.log('\n=== or copy this pairing code ===')
  console.log(JSON.stringify(payload))
  if (real) {
    const t = sessionMessages(real.sessionId, real.engine)
    console.log(
      `\nserving REAL transcript ${real.sessionId} (${real.engine}) — ` +
        `${t.total} messages${t.unsupported ? ' [engine unsupported]' : ''}`,
    )
  }
  console.log(`\nlistening on https://127.0.0.1:${PORT} — Ctrl-C to stop\n`)
  process.on('SIGINT', async () => {
    proc.kill()
    await stopBridge()
    process.exit(0)
  })
} else {
  await runSelftest()
}

async function runSelftest(): Promise<void> {
  const base = `https://127.0.0.1:${PORT}`
  const auth = { authorization: `Bearer ${identity.token}` }
  const fetchTLS = (path: string, init: RequestInit = {}) =>
    fetch(base + path, { ...init, tls: { rejectUnauthorized: false } } as RequestInit)

  const fail = (msg: string) => {
    console.error('FAIL:', msg)
    proc.kill()
    void stopBridge().then(() => process.exit(1))
  }

  // 1. the stream opens and replays
  const res = await fetchTLS(`/v1/sessions/${KEY}/stream`, { headers: auth })
  if (res.status !== 200) return fail(`stream status ${res.status}`)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  const first = decoder.decode((await reader.read()).value)
  if (!first.includes('event: hello')) return fail('no hello frame')
  const hello = JSON.parse(first.split('data: ')[1].split('\n')[0])
  if (hello.cols !== COLS || hello.rows !== ROWS)
    return fail(`geometry ${hello.cols}x${hello.rows}`)
  console.log(`✓ hello frame — geometry ${hello.cols}x${hello.rows} mirrored from the pty`)

  // 2. input typed on the "phone" reaches the real shell
  const marker = `E2E_MARKER_${Date.now()}`
  await fetchTLS(`/v1/sessions/${KEY}/input`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ data: Buffer.from(`echo ${marker}\r`).toString('base64') }),
  })

  // 3. the shell's response streams back over SSE
  const deadline = Date.now() + 15_000
  let seen = ''
  let buffered = '' // SSE frames can split across read() boundaries
  while (Date.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) break
    buffered += decoder.decode(value, { stream: true })
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      seen += Buffer.from(line.slice(6).trim(), 'base64').toString('utf8')
    }
    // The echoed command line and the command's output each contain the
    // marker; seeing it twice proves the shell actually RAN it rather than
    // just echoing our keystrokes back.
    if (seen.split(marker).length > 2) break
  }
  if (seen.split(marker).length <= 2) {
    console.error('--- stream contents ---')
    console.error(JSON.stringify(seen.slice(-600)))
    return fail(`shell never echoed ${marker}`)
  }
  console.log('✓ input POSTed from the client ran in the real shell')
  console.log('✓ its output streamed back over SSE')

  await reader.cancel()
  proc.kill()
  await stopBridge()
  console.log('\nE2E PASSED — real pty ⇄ HTTPS bridge ⇄ client round trip\n')
  process.exit(0)
}
