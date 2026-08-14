// The two scheduled entrypoints: the tick launchd fires, and the daily digest.
import { mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CFG } from '../runner/config'
import { KIND } from './compose'
import { localOutageVerdict, recordConnectivity } from './connectivity'
import { fileInbox } from './notify'
import { STATE_DIR, TICK_LOCK, log } from './paths'
import { commitOne, probeOne, type Probed } from './run'
import { readMonitors, readState } from './state'

// ---- tick lock -------------------------------------------------------------
// launchd fires the tick on a fixed interval; a cycle that runs long (a hung
// endpoint plus its confirm re-probe) would otherwise overlap the next one, and
// two processes writing the same state files interleave transitions.
const TICK_LOCK_TTL_MS = 15 * 60_000

function acquireTickLock(now: number): boolean {
  try {
    const held = JSON.parse(readFileSync(TICK_LOCK(), 'utf8')) as { at?: unknown }
    if (Number(held?.at) && now - Number(held.at) < TICK_LOCK_TTL_MS) return false
  } catch {
    /* no lock file, or an unreadable one — either way it is not held */
  }
  try {
    mkdirSync(CFG(), { recursive: true })
    writeFileSync(TICK_LOCK(), `${JSON.stringify({ pid: process.pid, at: now })}\n`)
    return true
  } catch {
    // Cannot take the lock ⇒ cannot prove we are alone. Skipping one tick is
    // strictly safer than two daemons racing on the state files.
    return false
  }
}

function releaseTickLock(): void {
  try {
    unlinkSync(TICK_LOCK())
  } catch {
    /* already gone */
  }
}

export async function tick(): Promise<void> {
  const now = Date.now()
  if (!acquireTickLock(now)) {
    log('tick skipped — previous cycle still running')
    return
  }
  try {
    // Prune orphaned state (monitor deleted).
    const ids = new Set(readMonitors().map((m) => m.id))
    try {
      for (const f of readdirSync(STATE_DIR()))
        if (f.endsWith('.json') && !ids.has(f.slice(0, -5))) rmSync(join(STATE_DIR(), f))
    } catch {
      /* no state dir yet */
    }

    const due = []
    for (const m of readMonitors()) {
      if (m.enabled === false) continue
      const prev = readState(m.id)
      const dueAt = (prev?.lastCheckedAt || 0) + (Number(m.intervalSec) || 60) * 1000
      if (now >= dueAt) due.push(m)
    }
    if (!due.length) return

    const probed: Probed[] = []
    for (const m of due) probed.push(await probeOne(m))

    const offline = await localOutageVerdict(
      probed.map((p) => ({ failed: p.res.status !== 'ok', category: p.res.category })),
    )
    recordConnectivity(offline, now)

    for (const p of probed) commitOne(p, now, offline)
  } finally {
    releaseTickLock()
  }
}

export async function digest(): Promise<void> {
  const now = new Date()
  for (const m of readMonitors()) {
    if (!m.notify?.dailyDigest) continue
    if (now.getHours() !== (Number(m.notify.digestHour) || 9)) continue
    const st = readState(m.id)
    const status = st?.status || 'unknown'
    const mood =
      status === 'ok'
        ? 'looking healthy'
        : status === 'warn'
          ? 'a little degraded'
          : 'having trouble'
    fileInbox(
      `☀️ Daily check-in · ${m.name}`,
      `Your ${KIND[String(m.type)] || 'monitor'} for ${m.name} is ${mood} today${st?.summary ? ` — ${st.summary}` : ''}.`,
      'normal',
    )
  }
}
