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
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureIdentity, pairingPayload } from '../../src/main/bridge/identity'
import { startBridge, stopBridge, type BridgeDeps } from '../../src/main/bridge/server'
import {
  listRemoteSessions,
  messageCount,
  postMessage,
  readMessages,
  registerRemoteSession,
  takeReplies,
} from '../../src/main/remote-sessions'

const PORT = 8791 // not 8790: never collide with a real running TerMinal
const selftest = process.argv.includes('--selftest')

// A demo session so the app has something to show on a fresh machine. Real
// registrations from `terminal-cli remote register` appear alongside it.
const DEMO_ID = 'harness-demo'
if (!listRemoteSessions().some((s) => s.id === DEMO_ID)) {
  registerRemoteSession({ id: DEMO_ID, title: 'harness demo', repo: 'TerMinal' })
  postMessage(DEMO_ID, 'agent', 'Registered. This is what an update looks like.')
  postMessage(DEMO_ID, 'agent', '844 tests green — opening the PR now.')
}

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
  hitl: () => [
    {
      id: 'h1',
      title: 'Approve release to production',
      detail: 'The release script wants to publish v0.4.0 from main.',
      action: 'bun run release',
      repo: 'TerMinal',
      source: 'agent',
      createdAt: 1_784_000_004_000,
    },
  ],
  resolveHitl: () => true,
  registerDevice: () => {},
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
