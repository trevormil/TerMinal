import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'

// Test-time kill switch for OUTBOUND side effects.
//
// The config-dir seam (config-dir.ts) sandboxes STATE: a test can no longer
// write the developer's real ~/.config/TerMinal. It does nothing about EFFECTS.
// A test that filed a HITL still appended to the real activity feed (which the
// running app tails and mirrors to the phone) and still POSTed the Telegram Bot
// API — so the suite pinged the operator's phone twice per run.
//
// The seam has to be structural for the same reason the config-dir one is: the
// next test someone writes must be safe without knowing any of this. So every
// outbound sink asks here first, and under test the answer is always no.
//
// Nothing changes in production. `effectsBlocked()` is false unless the process
// says it is a test (`NODE_ENV=test`, which `bun test` sets, or the explicit
// `TERMINAL_BLOCK_EFFECTS=1` that src/test-preload.ts sets as a second, harder
// signal in case a test clobbers NODE_ENV). There is deliberately NO env var
// that turns the block OFF: an escape hatch is how test traffic reaches a real
// phone again.

export type BlockedEffect = {
  /** 'activity' = a feed append, 'notify' = an outbound alert dispatch. */
  kind: 'activity' | 'notify'
  /** Which sink asked — 'hitl-telegram', 'push', 'desktop', an activity kind… */
  label: string
  at: number
}

const MAX_RECORDED = 500
const recorded: BlockedEffect[] = []

/** True when side effects must not leave this process. */
export function effectsBlocked(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'test' || env.TERMINAL_BLOCK_EFFECTS === '1'
}

/**
 * Ask permission to perform one side effect. Returns true when the effect was
 * BLOCKED (and records it, so a canary can prove what would have escaped);
 * callers must return without doing anything when it returns true.
 */
export function blockEffect(kind: BlockedEffect['kind'], label: string): boolean {
  if (!effectsBlocked()) return false
  recorded.push({ kind, label, at: Date.now() })
  if (recorded.length > MAX_RECORDED) recorded.shift()
  return true
}

/** Everything the guard has stopped so far — the canary's evidence. */
export function blockedEffects(): readonly BlockedEffect[] {
  return recorded
}

export function resetBlockedEffects(): void {
  recorded.length = 0
}

/** `fetch`, except it never leaves the machine under test. */
export function guardedFetch(label: string): typeof fetch {
  const guarded = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    blockEffect('notify', label)
      ? Promise.resolve(new Response(null, { status: 204 }))
      : fetch(input, init)
  // `typeof fetch` carries Bun's extra `preconnect`; nothing here calls it.
  return guarded as unknown as typeof fetch
}

/** A ChildProcess-shaped no-op: enough surface for the fire-and-forget notify
 *  spawns (`.unref()`, `.on('error')`) without starting a process. */
function inertChild(): ChildProcess {
  const child = new EventEmitter() as EventEmitter & { unref(): void; kill(): boolean }
  child.unref = () => {}
  child.kill = () => true
  return child as unknown as ChildProcess
}

/** `spawn`, except it starts nothing under test. */
export function guardedSpawn(label: string): typeof spawn {
  return ((command: string, args?: readonly string[], options?: object) =>
    blockEffect('notify', label)
      ? inertChild()
      : (spawn as (c: string, a?: readonly string[], o?: object) => ChildProcess)(
          command,
          args,
          options,
        )) as typeof spawn
}
