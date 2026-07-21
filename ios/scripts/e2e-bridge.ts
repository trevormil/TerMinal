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

let scrollback = ''
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
      cols: COLS,
      rows: ROWS,
    },
  ],
  write: (key, data) => {
    if (key !== KEY) return false
    return type(data.toString('utf8'))
  },
  replay: () => scrollback,
}

const dir = mkdtempSync(join(tmpdir(), 'gt-bridge-e2e-'))
const identity = ensureIdentity(dir)
const status = await startBridge(deps, { port: PORT, dir })
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
