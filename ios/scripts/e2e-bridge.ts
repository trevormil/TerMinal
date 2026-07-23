#!/usr/bin/env bun
/**
 * End-to-end harness for the mobile bridge.
 *
 * Serves the REAL remote-session store (~/.config/TerMinal/remote), so anything
 * registered with `terminal-cli remote register` shows up on the phone without
 * running the desktop app. Prints a scannable pairing QR.
 *
 *   bun ios/scripts/e2e-bridge.ts            # run until Ctrl-C
 *   bun ios/scripts/e2e-bridge.ts --selftest # assert the round trip, then exit
 *
 * The bridge identity lives in a temp dir, so it never disturbs the pairing of
 * a phone already paired with the real app.
 */
import qrcode from 'qrcode-generator'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureIdentity, pairingPayload } from '../../src/main/bridge/identity'
import { startBridge, stopBridge, type BridgeDeps } from '../../src/main/bridge/server'
import { tailscalePeerAllowed } from '../../src/main/bridge/tailscale'
import {
  deleteRemoteSession,
  endRemoteSession,
  listRemoteSessions,
  messageCount,
  postMessage,
  readMessages,
  registerRemoteSession,
  takeReplies,
} from '../../src/main/remote-sessions'

// 8791 by default (never collide with a real TerMinal on 8790); override with
// PORT=8790 to exercise tailnet pairing, which assumes the bridge default.
const PORT = Number(process.env.PORT) || 8791
const selftest = process.argv.includes('--selftest')

/** Git repos the phone may start a session in — real dirs, so the flow works.
 *  Generic: TERMINAL_PROJECTS_DIR wins, then common code roots, then the parent
 *  of this checkout. No machine-specific paths. */
function scanRepos(): { name: string; path: string }[] {
  const roots = [
    process.env.TERMINAL_PROJECTS_DIR,
    join(homedir(), 'code'),
    join(homedir(), 'projects'),
    join(homedir(), 'src'),
    join(homedir(), 'Developer'),
    join(process.cwd(), '..'),
  ].filter((r): r is string => !!r && existsSync(r))
  for (const root of roots) {
    try {
      const repos = readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(root, d.name, '.git')))
        .slice(0, 40)
        .map((d) => ({ name: d.name, path: join(root, d.name) }))
      if (repos.length) return repos
    } catch {
      /* unreadable root — try the next */
    }
  }
  return [{ name: 'TerMinal', path: process.cwd() }]
}

// A demo session so the app has something to show on a fresh machine. Real
// registrations from `terminal-cli remote register` appear alongside it.
const DEMO_ID = 'harness-demo'
if (!listRemoteSessions().some((s) => s.id === DEMO_ID)) {
  registerRemoteSession({ id: DEMO_ID, title: 'harness demo', repo: 'TerMinal' })
  postMessage(DEMO_ID, 'agent', 'Registered. This is what an update looks like.')
  postMessage(DEMO_ID, 'agent', '844 tests green — opening the PR now.')
}

let hitlQueue = [
  {
    id: 'h1',
    title: 'Approve release to production',
    detail: 'The release script wants to publish v0.4.0 from main.',
    action: 'bun run release',
    repo: 'TerMinal',
    source: 'agent',
    createdAt: 1_784_000_004_000,
    severity: 'push',
    status: 'open',
  },
  {
    id: 'h2',
    title: 'Nightly digest ready to skim',
    detail: 'A normal-severity item — inbox only, no push.',
    repo: 'TerMinal',
    source: 'completion-hook',
    createdAt: 1_784_000_002_000,
    severity: 'normal',
    status: 'open',
  },
]

const deps: BridgeDeps = {
  sessions: () =>
    listRemoteSessions().map((s) => ({
      id: s.id,
      title: s.title,
      repo: s.repo,
      branch: s.branch,
      engine: s.engine,
      status: s.status,
      question: s.question,
      lastSeenAt: s.lastSeenAt,
      messages: messageCount(s.id),
    })),
  messages: (id, opts) => readMessages(id, opts),
  reply: (id, text) => !!postMessage(id, 'user', text),
  endRemote: (id) => !!endRemoteSession(id),
  deleteRemote: (id) => deleteRemoteSession(id),
  hitl: () => hitlQueue,
  // Actually remove it: a static list made Resolve flash and then reappear on
  // the next poll, which reads as a broken button.
  resolveHitl: (id) => {
    const found = hitlQueue.some((h) => h.id === id)
    hitlQueue = hitlQueue.map((h) => (h.id === id ? { ...h, status: 'resolved' } : h))
    return found
  },
  markHitlRead: (ids) => {
    let n = 0
    hitlQueue = hitlQueue.map((h) => {
      if (ids.includes(h.id) && !h.readAt) {
        n++
        return { ...h, readAt: 1_784_000_000_000 }
      }
      return h
    })
    return n
  },
  registerDevice: () => {},
  // Real git repos so the New Session sheet is exercisable. Env-overridable
  // rather than machine-specific: TERMINAL_PROJECTS_DIR wins, else a couple of
  // common roots, else just this checkout.
  repos: () => scanRepos(),
  // Demo per-workspace data so the mobile cockpit tabs render without the app.
  // The real app resolves live daemons; here we just want plausible shapes.
  workspaceTickets: (repo) => {
    const name = repo.split('/').filter(Boolean).pop() || 'repo'
    return [
      {
        slug: '0042-fix-login',
        id: 42,
        title: `Harden auth in ${name}`,
        status: 'in_progress',
        priority: 'high',
        type: 'feature',
        hitl: false,
      },
      {
        slug: '0043-flaky-test',
        id: 43,
        title: 'Flaky e2e on CI',
        status: 'todo',
        priority: 'medium',
        type: 'bug',
        hitl: true,
      },
      {
        slug: '0038-docs',
        id: 38,
        title: 'Update architecture doc',
        status: 'done',
        priority: 'low',
        type: 'chore',
        hitl: false,
      },
    ]
  },
  workspacePrs: () => [
    {
      iid: 120,
      title: 'feat: model tier routing',
      state: 'open',
      draft: false,
      author: 'trevormil',
      url: 'https://github.com/x/y/pull/120',
      labels: ['feature'],
      verdict: 'approve',
      score: 92,
    },
    {
      iid: 119,
      title: 'feat: TerMinal Remote',
      state: 'open',
      draft: true,
      author: 'trevormil',
      url: 'https://github.com/x/y/pull/119',
      labels: ['wip'],
      verdict: undefined,
      score: undefined,
    },
  ],
  workspaceRuns: () => [
    {
      id: 'run-1',
      title: 'nightly-audit',
      engine: 'codex',
      status: 'success',
      startedAt: 1_784_000_000_000,
      endedAt: 1_784_000_180_000,
      branch: 'main',
    },
    {
      id: 'run-2',
      title: 'ticket-sweep',
      engine: 'claude',
      status: 'running',
      startedAt: 1_784_000_300_000,
      branch: 'feat/x',
    },
    {
      id: 'run-3',
      title: 'error-alerts',
      engine: 'codex',
      status: 'error',
      startedAt: 1_783_990_000_000,
      endedAt: 1_783_990_060_000,
      branch: 'main',
    },
  ],
  workspaceSchedules: () => [
    {
      id: 'sch-1',
      title: 'nightly-audit',
      describe: 'every day at 2:00 AM',
      nextRun: 1_784_050_000_000,
      enabled: true,
    },
    {
      id: 'sch-2',
      title: 'ticket-sweep',
      describe: 'every 4 hours',
      nextRun: 1_784_010_000_000,
      enabled: false,
    },
  ],
  // The harness can't launch a real desktop tab, so it does what the app's
  // spawn ultimately does from the phone's side: create the remote thread up
  // front and return its id, so the phone opens it immediately.
  spawn: (input) => {
    const repo = input.cwd.split('/').filter(Boolean).pop() || 'session'
    const id = `spawn-${Date.now().toString(36)}`
    registerRemoteSession({
      id,
      title: `${input.engine ?? 'claude'} · ${repo}`,
      repo,
      engine: input.engine,
      origin: 'phone',
    })
    postMessage(
      id,
      'agent',
      input.task?.trim()
        ? `Starting on your phone's request:\n\n> ${input.task.trim()}`
        : 'Session started from your phone. Send me something to do.',
    )
    return { id }
  },
  tailscalePair: (peer) => {
    const { ok } = tailscalePeerAllowed(peer)
    if (!ok) return null
    const pl = pairingPayload({ port: PORT, identity })
    return { token: pl.t, fp: pl.fp, name: pl.n }
  },
}

const dir = mkdtempSync(join(tmpdir(), 'gt-bridge-e2e-'))
const identity = ensureIdentity(dir)
const status = await startBridge(deps, {
  port: PORT,
  dir,
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
 * row, which keeps the code inside a normal terminal window.
 */
function printQR(text: string): void {
  const qr = qrcode(0, 'L')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  const quiet = 2
  const dark = (r: number, c: number) => r >= 0 && r < n && c >= 0 && c < n && qr.isDark(r, c)
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
  console.log(`\nserving ${listRemoteSessions().length} registered session(s)`)
  console.log(`listening on https://127.0.0.1:${PORT} — Ctrl-C to stop\n`)
  process.on('SIGINT', async () => {
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
    void stopBridge().then(() => process.exit(1))
  }

  const list = await (await fetchTLS('/v1/remote', { headers: auth })).json()
  if (!list.sessions.some((s: { id: string }) => s.id === DEMO_ID)) {
    return fail('registered session missing from /v1/remote')
  }
  console.log(`✓ /v1/remote lists ${list.sessions.length} registered session(s)`)

  const before = await (await fetchTLS(`/v1/remote/${DEMO_ID}/messages`, { headers: auth })).json()
  console.log(`✓ transcript reads back (${before.messages.length} messages)`)

  // A reply from the "phone" must reach the agent exactly once.
  const marker = `selftest-${Date.now()}`
  const posted = await fetchTLS(`/v1/remote/${DEMO_ID}/reply`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ text: marker }),
  })
  if (posted.status !== 200) return fail(`reply POST status ${posted.status}`)

  const delivered = takeReplies(DEMO_ID)
  if (!delivered.includes(marker)) return fail(`agent never received the reply: ${delivered}`)
  if (takeReplies(DEMO_ID).includes(marker)) return fail('reply was delivered twice')
  console.log('✓ reply queued, delivered to the agent exactly once')

  await stopBridge()
  console.log('\nE2E PASSED — phone ⇄ bridge ⇄ registered session\n')
  process.exit(0)
}
